"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { GameBlueprint } from "@/lib/blueprint/types";
import { saveWorkspaceBlueprint } from "@/lib/client/workspace-api";
import {
  importAndMigrateBlueprint,
  reconcileBlueprintState,
  type BlueprintImportResult,
} from "@/lib/integration";
import { projectPersistence } from "@/lib/persistence/project-persistence";
import {
  createEditorCommand,
  type CommandPayloadMap,
  type EditorCommand,
  type EditorCommandType,
} from "./commands";
import {
  createInitialEditorState,
  editorStateReducer,
  type ActiveProjectState,
  type StudioEditorState,
  type StudioPanelId,
  type StudioToolId,
  type StudioViewportState,
} from "./store";

export interface StudioEditorContextValue {
  state: StudioEditorState;
  saving: boolean;
  lastSavedAt: string | null;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  autosaveEnabled: boolean;
  setAutosaveEnabled: (enabled: boolean) => void;
  setActiveProject: (project: ActiveProjectState | null) => void;
  setActiveScene: (sceneId: string | null) => void;
  setSelectedElementIds: (ids: string[]) => void;
  selectElement: (id: string, additive?: boolean) => void;
  clearSelection: () => void;
  setActiveTool: (tool: StudioToolId) => void;
  setActivePanel: (panel: StudioPanelId) => void;
  updateViewport: (patch: Partial<StudioViewportState>) => void;
  dispatchCommand: <T extends EditorCommandType>(
    type: T,
    payload: CommandPayloadMap[T],
    label?: string,
  ) => EditorCommand<T>;
  replaceBlueprint: (blueprint: GameBlueprint, label?: string) => EditorCommand<"REPLACE_BLUEPRINT">;
  importBlueprintJson: (rawJson: string) => BlueprintImportResult;
  undo: () => void;
  redo: () => void;
  saveActiveProject: () => Promise<boolean>;
}

const StudioEditorContext = createContext<StudioEditorContextValue | null>(null);

/**
 * Cross-route in-memory editor state cache keyed by projectId.
 * Ensures navigating between Studio tabs/routes (Overview -> Symbols -> Reels ->
 * Paylines -> Paytable -> Math -> Preview -> Export) preserves the unified
 * GameBlueprint, undo/redo history, dirty flag, and autosave preference.
 */
const crossRouteEditorCache = new Map<string, StudioEditorState>();

export function clearCrossRouteEditorCache(projectId?: string): void {
  if (projectId) {
    crossRouteEditorCache.delete(projectId);
  } else {
    crossRouteEditorCache.clear();
  }
}

export function getCrossRouteEditorState(projectId: string): StudioEditorState | undefined {
  return crossRouteEditorCache.get(projectId);
}

function resolveInitialProviderState(
  initialProject: ActiveProjectState | null,
): StudioEditorState {
  if (!initialProject) {
    return createInitialEditorState(null);
  }
  const cached = crossRouteEditorCache.get(initialProject.id);
  if (cached && cached.activeProject) {
    // If cached state has unsaved edits or is at/above the server revision, preserve it
    if (
      cached.dirty ||
      cached.activeProject.revision >= initialProject.revision
    ) {
      return cached;
    }
  }
  const normalizedProject: ActiveProjectState = {
    ...initialProject,
    blueprint: reconcileBlueprintState(initialProject.blueprint),
  };
  const fresh = createInitialEditorState(normalizedProject);
  if (cached) {
    fresh.autosaveEnabled = cached.autosaveEnabled;
  }
  crossRouteEditorCache.set(initialProject.id, fresh);
  return fresh;
}

export function StudioEditorProvider({
  initialProject = null,
  children,
}: {
  initialProject?: ActiveProjectState | null;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(
    editorStateReducer,
    initialProject,
    resolveInitialProviderState,
  );
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(
    state.activeProject?.blueprint.meta.updatedAt ??
      initialProject?.blueprint.meta.updatedAt ??
      null,
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep cross-route cache synchronized whenever state changes
  useEffect(() => {
    if (state.activeProject?.id) {
      crossRouteEditorCache.set(state.activeProject.id, state);
    }
  }, [state]);

  const setActiveProject = useCallback((project: ActiveProjectState | null) => {
    const normalized = project
      ? {
          ...project,
          blueprint: reconcileBlueprintState(project.blueprint),
        }
      : null;
    dispatch({ type: "SET_ACTIVE_PROJECT", project: normalized });
  }, []);

  const setActiveScene = useCallback((sceneId: string | null) => {
    dispatch({ type: "SET_ACTIVE_SCENE", sceneId });
  }, []);

  const setSelectedElementIds = useCallback((ids: string[]) => {
    dispatch({ type: "SET_SELECTED_ELEMENTS", ids });
  }, []);

  const selectElement = useCallback((id: string, additive = false) => {
    dispatch({ type: "TOGGLE_SELECT_ELEMENT", id, additive });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: "CLEAR_SELECTION" });
  }, []);

  const setActiveTool = useCallback((tool: StudioToolId) => {
    dispatch({ type: "SET_ACTIVE_TOOL", tool });
  }, []);

  const setActivePanel = useCallback((panel: StudioPanelId) => {
    dispatch({ type: "SET_ACTIVE_PANEL", panel });
  }, []);

  const setAutosaveEnabled = useCallback((enabled: boolean) => {
    dispatch({ type: "SET_AUTOSAVE_ENABLED", enabled });
  }, []);

  const updateViewport = useCallback((patch: Partial<StudioViewportState>) => {
    dispatch({ type: "UPDATE_VIEWPORT", patch });
  }, []);

  const dispatchCommand = useCallback(
    <T extends EditorCommandType>(
      type: T,
      payload: CommandPayloadMap[T],
      label?: string,
    ): EditorCommand<T> => {
      const command = createEditorCommand(type, payload, label);
      dispatch({ type: "DISPATCH_COMMAND", command });
      return command;
    },
    [],
  );

  const replaceBlueprint = useCallback(
    (blueprint: GameBlueprint, label = "Update blueprint"): EditorCommand<"REPLACE_BLUEPRINT"> => {
      const reconciled = reconcileBlueprintState(blueprint);
      const command = createEditorCommand(
        "REPLACE_BLUEPRINT",
        { blueprint: reconciled },
        label,
      );
      dispatch({ type: "DISPATCH_COMMAND", command });
      return command;
    },
    [],
  );

  const importBlueprintJson = useCallback(
    (rawJson: string): BlueprintImportResult => {
      const result = importAndMigrateBlueprint(rawJson);
      if (result.ok && result.blueprint) {
        const activeId = state.activeProject?.id ?? result.blueprint.meta.id;
        const importedBp: GameBlueprint = {
          ...result.blueprint,
          meta: {
            ...result.blueprint.meta,
            id: activeId,
          },
        };
        const command = createEditorCommand(
          "REPLACE_BLUEPRINT",
          { blueprint: importedBp },
          `Import blueprint "${importedBp.meta.title}"`,
        );
        dispatch({ type: "DISPATCH_COMMAND", command });
      }
      return result;
    },
    [state.activeProject?.id],
  );

  const undo = useCallback(() => {
    dispatch({ type: "UNDO" });
  }, []);

  const redo = useCallback(() => {
    dispatch({ type: "REDO" });
  }, []);

  const saveActiveProject = useCallback(async (): Promise<boolean> => {
    if (!state.activeProject) return false;
    setSaving(true);
    setSaveError(null);
    const projectId = state.activeProject.id;
    const reconciledBp = reconcileBlueprintState(state.activeProject.blueprint);
    const currentRevision = state.activeProject.revision;

    try {
      let nextRevision = currentRevision + 1;
      let savedBp = reconciledBp;
      let updatedAt = new Date().toISOString();

      // 1. Persist to server workspace API when running in browser
      if (typeof window !== "undefined" && typeof fetch === "function") {
        try {
          let serverSaved = await saveWorkspaceBlueprint(
            projectId,
            reconciledBp,
            currentRevision,
          );
          if (!serverSaved.ok && serverSaved.conflict) {
            // Retry with latest server revision so single-user studio edits never get stuck
            serverSaved = await saveWorkspaceBlueprint(
              projectId,
              reconciledBp,
              serverSaved.conflict.currentRevision,
            );
          }
          if (serverSaved.ok) {
            nextRevision = serverSaved.data.revision;
            savedBp = reconcileBlueprintState(serverSaved.data.blueprint);
            updatedAt = savedBp.meta.updatedAt;
          }
        } catch {
          // Fallback to local persistence if offline or in isolated environment
        }
      }

      // 2. Also synchronize local project persistence store
      try {
        const localSaved = await projectPersistence.saveProject(projectId, savedBp);
        if (!updatedAt) {
          updatedAt = localSaved.updatedAt;
        }
      } catch {
        // Ignore local storage errors
      }

      dispatch({
        type: "MARK_SAVED",
        revision: nextRevision,
        blueprint: savedBp,
      });
      setLastSavedAt(updatedAt);
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save project");
      return false;
    } finally {
      setSaving(false);
    }
  }, [state.activeProject]);

  // Optional debounced autosave when autosaveEnabled && dirty
  useEffect(() => {
    if (!state.autosaveEnabled || !state.dirty || saving || !state.activeProject) {
      return;
    }
    const timer = setTimeout(() => {
      void saveActiveProject();
    }, 900);
    return () => clearTimeout(timer);
  }, [
    state.autosaveEnabled,
    state.dirty,
    state.activeProject?.blueprint,
    state.activeProject,
    saving,
    saveActiveProject,
  ]);

  return (
    <StudioEditorContext.Provider
      value={{
        state,
        saving,
        lastSavedAt,
        saveError,
        canUndo: state.undoStack.length > 0,
        canRedo: state.redoStack.length > 0,
        autosaveEnabled: state.autosaveEnabled,
        setAutosaveEnabled,
        setActiveProject,
        setActiveScene,
        setSelectedElementIds,
        selectElement,
        clearSelection,
        setActiveTool,
        setActivePanel,
        updateViewport,
        dispatchCommand,
        replaceBlueprint,
        importBlueprintJson,
        undo,
        redo,
        saveActiveProject,
      }}
    >
      {children}
    </StudioEditorContext.Provider>
  );
}

export function useStudioEditor(): StudioEditorContextValue {
  const ctx = useContext(StudioEditorContext);
  if (!ctx) {
    throw new Error("useStudioEditor must be used within a StudioEditorProvider");
  }
  return ctx;
}
