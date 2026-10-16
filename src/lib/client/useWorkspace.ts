"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { projectPersistence } from "@/lib/persistence/project-persistence";
import { workspaceApi } from "./workspace-api";
import type {
  FolderSummary,
  ProjectSummary,
  WorkspaceSnapshot,
} from "@/lib/workspace/types";

export interface Toast {
  id: string;
  message: string;
  tone: "info" | "success" | "error";
  undoable: boolean;
}

interface HistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

const MAX_HISTORY = 50;

/**
 * Workspace state container.
 * All mutations go through the persistence service (API -> Postgres) and the
 * snapshot is re-read afterwards, so what you see is always what is stored.
 * Reversible operations are recorded on an undo/redo stack.
 */
export function useWorkspace(initial: WorkspaceSnapshot) {
  const [projects, setProjects] = useState<ProjectSummary[]>(initial.projects);
  const [folders, setFolders] = useState<FolderSummary[]>(initial.folders);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const toastSeq = useRef(0);

  const pushToast = useCallback(
    (message: string, tone: Toast["tone"] = "info", undoable = false) => {
      toastSeq.current += 1;
      const id = `toast-${toastSeq.current}`;
      setToasts((current) => [...current.slice(-3), { id, message, tone, undoable }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== id));
      }, 7000);
    },
    [],
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    const snapshot = await workspaceApi.snapshot();
    setProjects(snapshot.projects);
    setFolders(snapshot.folders);
  }, []);

  // Next may restore a previously visited dashboard. Refresh the persisted index
  // on mount, navigation restoration and cross-screen workspace changes.
  useEffect(() => {
    const reload = () => { void refresh().catch(() => undefined); };
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    reload();
    window.addEventListener("focus", reload);
    window.addEventListener("pageshow", reload);
    window.addEventListener("popstate", reload);
    window.addEventListener("studio:workspace-changed", reload);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener("pageshow", reload);
      window.removeEventListener("popstate", reload);
      window.removeEventListener("studio:workspace-changed", reload);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const record = useCallback((entry: HistoryEntry) => {
    setUndoStack((stack) => [...stack, entry].slice(-MAX_HISTORY));
    setRedoStack([]);
  }, []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, successMessage?: string): Promise<T | null> => {
      setBusy(true);
      try {
        const result = await fn();
        await refresh();
        if (successMessage) pushToast(successMessage, "success");
        return result;
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Action failed", "error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh, pushToast],
  );

  /* ------------------------- project operations ------------------------- */

  const renameProject = useCallback(
    async (project: ProjectSummary, nextTitle: string) => {
      const title = nextTitle.trim();
      if (!title || title === project.title) return;
      const previous = project.title;
      const ok = await run(
        () => projectPersistence.updateProject(project.id, { title }),
        `Renamed to “${title}”`,
      );
      if (!ok) return;
      record({
        label: `Rename “${previous}”`,
        undo: async () => {
          await projectPersistence.updateProject(project.id, { title: previous });
          await refresh();
        },
        redo: async () => {
          await projectPersistence.updateProject(project.id, { title });
          await refresh();
        },
      });
    },
    [run, record, refresh],
  );

  const moveProject = useCallback(
    async (project: ProjectSummary, folderPath: string) => {
      if (folderPath === project.folderPath) return;
      const previous = project.folderPath;
      const ok = await run(
        () => projectPersistence.updateProject(project.id, { folderPath }),
        `Moved to ${folderPath || "Your Games"}`,
      );
      if (!ok) return;
      record({
        label: `Move “${project.title}”`,
        undo: async () => {
          await projectPersistence.updateProject(project.id, { folderPath: previous });
          await refresh();
        },
        redo: async () => {
          await projectPersistence.updateProject(project.id, { folderPath });
          await refresh();
        },
      });
    },
    [run, record, refresh],
  );

  const setProjectStatus = useCallback(
    async (project: ProjectSummary, status: ProjectSummary["status"]) => {
      if (status === project.status) return;
      const previous = project.status;
      const ok = await run(() => projectPersistence.updateProject(project.id, { status }));
      if (!ok) return;
      record({
        label: `Status of “${project.title}”`,
        undo: async () => {
          await projectPersistence.updateProject(project.id, { status: previous });
          await refresh();
        },
        redo: async () => {
          await projectPersistence.updateProject(project.id, { status });
          await refresh();
        },
      });
    },
    [run, record, refresh],
  );

  const duplicateProject = useCallback(
    async (project: ProjectSummary) => {
      const created = await run(
        () => projectPersistence.duplicateProject(project.id),
        `Duplicated “${project.title}”`,
      );
      if (!created) return null;
      record({
        label: `Duplicate “${project.title}”`,
        undo: async () => {
          await projectPersistence.deleteProject(created.id);
          await refresh();
        },
        redo: async () => {
          await workspaceApi.restoreProject(created.id);
          await refresh();
        },
      });
      return created;
    },
    [run, record, refresh],
  );

  const deleteProject = useCallback(
    async (project: ProjectSummary) => {
      const ok = await run(() => projectPersistence.deleteProject(project.id));
      if (!ok) return;
      record({
        label: `Delete “${project.title}”`,
        undo: async () => {
          await workspaceApi.restoreProject(project.id);
          await refresh();
        },
        redo: async () => {
          await projectPersistence.deleteProject(project.id);
          await refresh();
        },
      });
      pushToast(`Deleted “${project.title}” — press ⌘Z to undo`, "info", true);
    },
    [run, record, refresh, pushToast],
  );

  /* -------------------------- folder operations ------------------------- */

  const createFolder = useCallback(
    async (name: string, parentPath: string) => {
      const created = await run(
        () => workspaceApi.createFolder(name, parentPath),
        `Folder “${name}” created`,
      );
      if (!created) return null;
      record({
        label: `New folder “${created.name}”`,
        undo: async () => {
          await workspaceApi.deleteFolder(created.id);
          await refresh();
        },
        redo: async () => {
          await workspaceApi.createFolder(created.name, created.parentPath);
          await refresh();
        },
      });
      return created;
    },
    [run, record, refresh],
  );

  const renameFolder = useCallback(
    async (folder: FolderSummary, nextName: string) => {
      const name = nextName.trim();
      if (!name || name === folder.name) return null;
      const updated = await run(
        () => workspaceApi.renameFolder(folder.id, name),
        `Folder renamed to “${name}”`,
      );
      if (!updated) return null;
      record({
        label: `Rename folder “${folder.name}”`,
        undo: async () => {
          await workspaceApi.renameFolder(folder.id, folder.name);
          await refresh();
        },
        redo: async () => {
          await workspaceApi.renameFolder(folder.id, name);
          await refresh();
        },
      });
      return updated;
    },
    [run, record, refresh],
  );

  const deleteFolder = useCallback(
    async (folder: FolderSummary) => {
      const ok = await run(
        () => workspaceApi.deleteFolder(folder.id),
        `Folder “${folder.name}” deleted`,
      );
      if (!ok) return false;
      record({
        label: `Delete folder “${folder.name}”`,
        undo: async () => {
          await workspaceApi.createFolder(folder.name, folder.parentPath);
          await refresh();
        },
        redo: async () => {
          const snapshot = await workspaceApi.snapshot();
          const match = snapshot.folders.find((f) => f.path === folder.path);
          if (match) await workspaceApi.deleteFolder(match.id);
          await refresh();
        },
      });
      return true;
    },
    [run, record, refresh],
  );

  /* ------------------------------ history ------------------------------- */

  const undo = useCallback(async () => {
    const entry = undoStack[undoStack.length - 1];
    if (!entry) return;
    setBusy(true);
    try {
      await entry.undo();
      setUndoStack((stack) => stack.slice(0, -1));
      setRedoStack((stack) => [...stack, entry]);
      pushToast(`Undone: ${entry.label}`, "info");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Undo failed", "error");
    } finally {
      setBusy(false);
    }
  }, [undoStack, pushToast]);

  const redo = useCallback(async () => {
    const entry = redoStack[redoStack.length - 1];
    if (!entry) return;
    setBusy(true);
    try {
      await entry.redo();
      setRedoStack((stack) => stack.slice(0, -1));
      setUndoStack((stack) => [...stack, entry]);
      pushToast(`Redone: ${entry.label}`, "info");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Redo failed", "error");
    } finally {
      setBusy(false);
    }
  }, [redoStack, pushToast]);

  return useMemo(
    () => ({
      projects,
      folders,
      busy,
      toasts,
      dismissToast,
      pushToast,
      refresh,
      renameProject,
      moveProject,
      setProjectStatus,
      duplicateProject,
      deleteProject,
      createFolder,
      renameFolder,
      deleteFolder,
      undo,
      redo,
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      lastAction: undoStack[undoStack.length - 1]?.label ?? null,
    }),
    [
      projects,
      folders,
      busy,
      toasts,
      dismissToast,
      pushToast,
      refresh,
      renameProject,
      moveProject,
      setProjectStatus,
      duplicateProject,
      deleteProject,
      createFolder,
      renameFolder,
      deleteFolder,
      undo,
      redo,
      undoStack,
      redoStack,
    ],
  );
}

export type WorkspaceController = ReturnType<typeof useWorkspace>;
