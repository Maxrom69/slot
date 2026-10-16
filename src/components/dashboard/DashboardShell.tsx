"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { SideNav } from "./SideNav";
import { FolderTile } from "./FolderTile";
import { ProjectCard, ProjectRow, type ProjectCardActions } from "./ProjectCard";
import { ConfirmDialog, MoveDialog, NewFolderDialog, PromptDialog } from "./Dialogs";
import { Button, SegmentedControl, Select, TextInput } from "@/components/ui/Controls";
import { Toasts } from "@/components/ui/Toasts";
import { useWorkspace } from "@/lib/client/useWorkspace";
import {
  breadcrumbsFor,
  selectFolders,
  selectProjects,
  sortProjects,
} from "@/lib/workspace/selectors";
import type {
  FolderSummary,
  ProjectSummary,
  SortKey,
  ViewMode,
  WorkspaceSnapshot,
} from "@/lib/workspace/types";

type DialogState =
  | { kind: "none" }
  | { kind: "rename-project"; project: ProjectSummary }
  | { kind: "move-project"; project: ProjectSummary }
  | { kind: "delete-project"; project: ProjectSummary }
  | { kind: "new-folder" }
  | { kind: "rename-folder"; folder: FolderSummary }
  | { kind: "delete-folder"; folder: FolderSummary };

export function DashboardShell({
  snapshot,
  initialFolder,
}: {
  snapshot: WorkspaceSnapshot;
  initialFolder: string;
}) {
  const router = useRouter();
  const ws = useWorkspace(snapshot);

  const [folderPath, setFolderPath] = useState(initialFolder);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    if (typeof window !== "undefined") {
      const storedSort = window.localStorage.getItem("studio.dashboard.sort");
      if (storedSort) {
        const [key] = storedSort.split(":");
        if (["updated", "created", "title", "status"].includes(key)) {
          return key as SortKey;
        }
      }
    }
    return "updated";
  });
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => {
    if (typeof window !== "undefined") {
      const storedSort = window.localStorage.getItem("studio.dashboard.sort");
      if (storedSort) {
        const [, dir] = storedSort.split(":");
        return dir === "asc" ? "asc" : "desc";
      }
    }
    return "desc";
  });
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      const stored = window.localStorage.getItem("studio.dashboard.view");
      if (stored === "grid" || stored === "list") return stored;
    }
    return "grid";
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  /* ---------------------------- view preference --------------------------- */
  useEffect(() => {
    window.localStorage.setItem("studio.dashboard.view", view);
  }, [view]);

  useEffect(() => {
    window.localStorage.setItem("studio.dashboard.sort", `${sortKey}:${sortDir}`);
  }, [sortKey, sortDir]);

  /* ------------------------------ navigation ------------------------------ */
  const navigateFolder = useCallback((path: string) => {
    setFolderPath(path);
    setSelectedId(null);
    setMobileNavOpen(false);
    const baseRoute =
      typeof window !== "undefined" && window.location.pathname === "/dashboard"
        ? "/dashboard"
        : "/games";
    const url = path ? `${baseRoute}?folder=${encodeURIComponent(path)}` : baseRoute;
    window.history.replaceState(null, "", url);
  }, []);

  /* ------------------------------ derived data ---------------------------- */
  const visibleProjects = useMemo(
    () =>
      sortProjects(
        selectProjects(ws.projects, { query, folderPath, statuses: [] }),
        sortKey,
        sortDir,
      ),
    [ws.projects, query, folderPath, sortKey, sortDir],
  );

  const visibleFolders = useMemo(
    () => selectFolders(ws.folders, folderPath, query),
    [ws.folders, folderPath, query],
  );

  const crumbs = useMemo(() => breadcrumbsFor(folderPath), [folderPath]);
  const selected = useMemo(
    () => ws.projects.find((p) => p.id === selectedId) ?? null,
    [ws.projects, selectedId],
  );

  /* -------------------------------- actions ------------------------------- */
  const openProject = useCallback(
    (project: ProjectSummary) => router.push(`/projects/${project.id}`),
    [router],
  );

  const exportProject = useCallback((project: ProjectSummary) => {
    window.location.href = `/api/projects/${project.id}/export`;
  }, []);

  const actions: ProjectCardActions = useMemo(
    () => ({
      onOpen: openProject,
      onRename: (project) => setDialog({ kind: "rename-project", project }),
      onDuplicate: (project) => {
        void ws.duplicateProject(project);
      },
      onDelete: (project) => setDialog({ kind: "delete-project", project }),
      onMove: (project) => setDialog({ kind: "move-project", project }),
      onExport: exportProject,
    }),
    [openProject, exportProject, ws],
  );

  const dropProjectInFolder = useCallback(
    (projectId: string, folder: FolderSummary) => {
      const project = ws.projects.find((p) => p.id === projectId);
      if (project) void ws.moveProject(project, folder.path);
    },
    [ws],
  );

  /* ----------------------------- keyboard map ----------------------------- */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      const meta = event.metaKey || event.ctrlKey;

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) void ws.redo();
        else void ws.undo();
        return;
      }
      if (typing) {
        if (event.key === "Escape" && target === searchRef.current) {
          setQuery("");
          searchRef.current?.blur();
        }
        return;
      }
      if (dialog.kind !== "none") return;

      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key.toLowerCase() === "n" && !meta) {
        event.preventDefault();
        router.push(folderPath ? `/games/new?folder=${encodeURIComponent(folderPath)}` : "/games/new");
        return;
      }
      if (event.key.toLowerCase() === "f" && !meta) {
        event.preventDefault();
        setDialog({ kind: "new-folder" });
        return;
      }
      if (event.key === "Escape") {
        setSelectedId(null);
        return;
      }
      if (!selected) return;
      if (event.key === "Enter") {
        event.preventDefault();
        openProject(selected);
      } else if (event.key === "F2") {
        event.preventDefault();
        setDialog({ kind: "rename-project", project: selected });
      } else if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void ws.duplicateProject(selected);
      } else if (meta && event.key.toLowerCase() === "m") {
        event.preventDefault();
        setDialog({ kind: "move-project", project: selected });
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        setDialog({ kind: "delete-project", project: selected });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, dialog.kind, openProject, router, ws, folderPath]);

  const closeDialog = useCallback(() => setDialog({ kind: "none" }), []);
  const searching = query.trim().length > 0;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-ink-950">
      <div className="hidden lg:block">
        <SideNav
          folders={ws.folders}
          currentFolder={folderPath}
          onNavigateFolder={navigateFolder}
          onDropProject={(projectId, targetPath) => {
            const project = ws.projects.find((p) => p.id === projectId);
            if (project) void ws.moveProject(project, targetPath);
          }}
        />
      </div>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative z-10 h-full">
            <SideNav
              folders={ws.folders}
              currentFolder={folderPath}
              onNavigateFolder={navigateFolder}
              onDropProject={(projectId, targetPath) => {
                const project = ws.projects.find((p) => p.id === projectId);
                if (project) void ws.moveProject(project, targetPath);
              }}
            />
          </div>
        </div>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        {/* top header */}
        <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.07] bg-ink-900/80 px-5 py-3 backdrop-blur">
          <button
            type="button"
            onClick={() => setMobileNavOpen((open) => !open)}
            aria-label="Toggle workspace navigation"
            className="focus-ring grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-ink-850 text-ink-200 hover:bg-ink-800 lg:hidden"
          >
            <Icon name="panel-left" size={14} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[15px] font-semibold tracking-tight text-ink-100">
                Your Games
              </h1>
              {folderPath ? (
                <span className="rounded border border-accent-500/30 bg-accent-600/15 px-1.5 py-0.5 text-[11px] font-medium text-accent-300">
                  {crumbs[crumbs.length - 1].label}
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-400">
              {ws.projects.length} project{ws.projects.length === 1 ? "" : "s"} in
              workspace
              {ws.busy ? " · syncing…" : ""}
              {ws.lastAction ? ` · last: ${ws.lastAction}` : ""}
            </p>
          </div>

          <div className="relative w-full max-w-sm sm:w-72">
            <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-ink-400">
              ⌕
            </span>
            <TextInput
              ref={searchRef}
              value={query}
              placeholder="Search titles, themes, styles, folders…   /"
              onChange={(event) => setQuery(event.target.value)}
              className="pl-7"
              aria-label="Search projects"
            />
            {searching ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="focus-ring absolute top-1/2 right-2 -translate-y-1/2 rounded px-1 text-xs text-ink-400 hover:text-ink-100"
              >
                ✕
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              onClick={() => ws.undo()}
              disabled={!ws.canUndo}
              title="Undo (⌘Z)"
            >
              ↶
            </Button>
            <Button
              variant="ghost"
              onClick={() => ws.redo()}
              disabled={!ws.canRedo}
              title="Redo (⇧⌘Z)"
            >
              ↷
            </Button>
            <Button onClick={() => setDialog({ kind: "new-folder" })} title="New folder (F)">
              New folder
            </Button>
            <Button variant="primary" onClick={() => router.push(folderPath ? `/games/new?folder=${encodeURIComponent(folderPath)}` : "/games/new")}>
              ＋ New Game
            </Button>
          </div>
        </header>

        {/* breadcrumbs + controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-900/40 px-5 py-2">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-[11.5px]">
            {crumbs.map((crumb, index) => (
              <span key={crumb.path || "root"} className="flex items-center gap-1">
                {index > 0 ? <span className="text-ink-600">/</span> : null}
                <button
                  type="button"
                  onClick={() => navigateFolder(crumb.path)}
                  onDragOver={(event) => {
                    if (
                      event.dataTransfer.types.includes("application/x-studio-project")
                    )
                      event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData(
                      "application/x-studio-project",
                    );
                    const project = ws.projects.find((p) => p.id === id);
                    if (project) void ws.moveProject(project, crumb.path);
                  }}
                  className={`focus-ring rounded px-1.5 py-0.5 transition hover:bg-white/5 ${
                    index === crumbs.length - 1
                      ? "text-ink-100"
                      : "text-ink-400 hover:text-ink-200"
                  }`}
                >
                  {crumb.label}
                </button>
              </span>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Select
              aria-label="Sort by"
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              className="h-7 w-[132px] py-0 text-[11px]"
            >
              <option value="updated">Last modified</option>
              <option value="created">Date created</option>
              <option value="title">Title</option>
              <option value="status">Status</option>
            </Select>
            <Button
              variant="outline"
              className="h-7 px-2"
              title={sortDir === "desc" ? "Descending" : "Ascending"}
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            >
              {sortDir === "desc" ? "↓" : "↑"}
            </Button>
            <SegmentedControl<ViewMode>
              ariaLabel="View mode"
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: "Grid" },
                { value: "list", label: "List" },
              ]}
            />
          </div>
        </div>

        {/* work area */}
        <div
          className="flex-1 overflow-y-auto px-5 py-4"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("application/x-studio-project"))
              event.preventDefault();
          }}
          onDrop={(event) => {
            const id = event.dataTransfer.getData("application/x-studio-project");
            const project = ws.projects.find((p) => p.id === id);
            if (project && project.folderPath !== folderPath)
              void ws.moveProject(project, folderPath);
          }}
        >
          {visibleFolders.length > 0 ? (
            <section className="mb-5">
              <h2 className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                Folders
              </h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
                {visibleFolders.map((folder) => (
                  <FolderTile
                    key={folder.id}
                    folder={folder}
                    onOpen={(f) => navigateFolder(f.path)}
                    onRename={(f) => setDialog({ kind: "rename-folder", folder: f })}
                    onDelete={(f) => setDialog({ kind: "delete-folder", folder: f })}
                    onDropProject={dropProjectInFolder}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <h2 className="mb-2 flex items-center gap-2 text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
              {searching ? "Search results" : "Projects"}
              <span className="rounded border border-white/10 px-1 py-px text-[9.5px] text-ink-400">
                {visibleProjects.length}
              </span>
            </h2>

            {visibleProjects.length === 0 ? (
              <EmptyState
                searching={searching}
                folderPath={folderPath}
                onNewGame={() => router.push(folderPath ? `/games/new?folder=${encodeURIComponent(folderPath)}` : "/games/new")}
                onClearSearch={() => setQuery("")}
              />
            ) : view === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-3.5">
                {visibleProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    actions={actions}
                    selected={project.id === selectedId}
                    onSelect={(p) => setSelectedId(p.id)}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-white/[0.07] bg-ink-900">
                <table className="w-full min-w-[680px] table-fixed">
                  <thead>
                    <tr className="border-b border-white/[0.07] text-left text-[10px] tracking-wider text-ink-400 uppercase">
                      <th className="py-2 pl-3 font-medium">Project</th>
                      <th className="w-28 px-3 font-medium">Status</th>
                      <th className="w-20 px-3 font-medium">Grid</th>
                      <th className="w-20 px-3 font-medium">Lines</th>
                      <th className="w-44 px-3 font-medium">Folder</th>
                      <th className="w-28 px-3 font-medium">Modified</th>
                      <th className="w-12 pr-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProjects.map((project) => (
                      <ProjectRow
                        key={project.id}
                        project={project}
                        actions={actions}
                        selected={project.id === selectedId}
                        onSelect={(p) => setSelectedId(p.id)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <footer className="mt-8 rounded-lg border border-white/[0.07] bg-ink-900/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-ink-400">
              <span className="font-semibold tracking-[0.16em] text-ink-300 uppercase">
                Shortcuts
              </span>
              <Shortcut keys="/" label="search" />
              <Shortcut keys="N" label="new game" />
              <Shortcut keys="F" label="new folder" />
              <Shortcut keys="↵" label="open" />
              <Shortcut keys="F2" label="rename" />
              <Shortcut keys="⌘D" label="duplicate" />
              <Shortcut keys="⌘M" label="move" />
              <Shortcut keys="⌫" label="delete" />
              <Shortcut keys="⌘Z" label="undo" />
              <Shortcut keys="⇧⌘Z" label="redo" />
            </div>
          </footer>
        </div>
      </main>

      {/* dialogs */}
      <PromptDialog
        open={dialog.kind === "rename-project"}
        title="Rename project"
        label="Project title"
        initialValue={dialog.kind === "rename-project" ? dialog.project.title : ""}
        onCancel={closeDialog}
        onConfirm={(value) => {
          if (dialog.kind === "rename-project") void ws.renameProject(dialog.project, value);
          closeDialog();
        }}
      />

      <MoveDialog
        open={dialog.kind === "move-project"}
        projectTitle={dialog.kind === "move-project" ? dialog.project.title : ""}
        currentPath={dialog.kind === "move-project" ? dialog.project.folderPath : ""}
        folders={ws.folders}
        onCancel={closeDialog}
        onConfirm={(path) => {
          if (dialog.kind === "move-project") void ws.moveProject(dialog.project, path);
          closeDialog();
        }}
      />

      <ConfirmDialog
        open={dialog.kind === "delete-project"}
        title="Delete project"
        message={
          dialog.kind === "delete-project"
            ? `“${dialog.project.title}” will be removed from the workspace. You can undo this with ⌘Z.`
            : ""
        }
        onCancel={closeDialog}
        onConfirm={() => {
          if (dialog.kind === "delete-project") {
            void ws.deleteProject(dialog.project);
            setSelectedId(null);
          }
          closeDialog();
        }}
      />

      <NewFolderDialog
        open={dialog.kind === "new-folder"}
        parentPath={folderPath}
        onCancel={closeDialog}
        onConfirm={(name) => {
          void ws.createFolder(name, folderPath);
          closeDialog();
        }}
      />

      <PromptDialog
        open={dialog.kind === "rename-folder"}
        title="Rename folder"
        label="Folder name"
        description="Projects inside this folder keep their contents; their folder path is updated."
        initialValue={dialog.kind === "rename-folder" ? dialog.folder.name : ""}
        onCancel={closeDialog}
        onConfirm={(value) => {
          if (dialog.kind === "rename-folder") {
            const previousPath = dialog.folder.path;
            void ws.renameFolder(dialog.folder, value).then((updated) => {
              if (updated && folderPath === previousPath) navigateFolder(updated.path);
            });
          }
          closeDialog();
        }}
      />

      <ConfirmDialog
        open={dialog.kind === "delete-folder"}
        title="Delete folder"
        message={
          dialog.kind === "delete-folder"
            ? `Delete the empty folder “${dialog.folder.name}”?`
            : ""
        }
        onCancel={closeDialog}
        onConfirm={() => {
          if (dialog.kind === "delete-folder") {
            const path = dialog.folder.path;
            void ws.deleteFolder(dialog.folder).then((ok) => {
              if (ok && folderPath === path)
                navigateFolder(dialog.folder.parentPath);
            });
          }
          closeDialog();
        }}
      />

      <Toasts
        toasts={ws.toasts}
        onDismiss={ws.dismissToast}
        onUndo={() => void ws.undo()}
        canUndo={ws.canUndo}
      />
    </div>
  );
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-white/10 bg-ink-850 px-1.5 py-px font-mono text-[10px] text-ink-200">
        {keys}
      </kbd>
      {label}
    </span>
  );
}

function EmptyState({
  searching,
  folderPath,
  onNewGame,
  onClearSearch,
}: {
  searching: boolean;
  folderPath: string;
  onNewGame: () => void;
  onClearSearch: () => void;
}) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-white/10 bg-ink-900/40 px-6 py-16 text-center">
      <div className="max-w-sm">
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-lg border border-white/10 bg-ink-850 text-lg">
          {searching ? "⌕" : "▩"}
        </div>
        <h3 className="text-[13px] font-semibold text-ink-100">
          {searching
            ? "No matching projects"
            : folderPath
              ? "This folder is empty"
              : "No games yet"}
        </h3>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400">
          {searching
            ? "Search looks at titles, themes, style guides and folder paths."
            : "A game project holds the Game Blueprint: symbols, reels, paylines, scenes, features and export settings."}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          {searching ? (
            <Button onClick={onClearSearch}>Clear search</Button>
          ) : null}
          <Button variant="primary" onClick={onNewGame}>
            ＋ New Game
          </Button>
        </div>
      </div>
    </div>
  );
}
