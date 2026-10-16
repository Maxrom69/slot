import type { GameBlueprint } from "@/lib/blueprint/types";
import {
  createEditorCommand,
  executeEditorCommand,
  type CommandHistoryEntry,
  type CommandPayloadMap,
  type EditorCommand,
  type EditorCommandType,
} from "./commands";

export type StudioToolId =
  | "select"
  | "move"
  | "brush"
  | "eraser"
  | "blur"
  | "eyedropper"
  | "hand"
  | "rect"
  | "ellipse"
  | "triangle"
  | "line"
  | "arrow"
  | "pen"
  | "text";

export type StudioPanelId =
  | "navigation"
  | "inspector"
  | "layers"
  | "scenes"
  | "history"
  | "blueprint"
  | null;

export interface StudioViewportState {
  panX: number;
  panY: number;
  zoom: number;
  fullscreen: boolean;
  gridVisible: boolean;
  snapping: boolean;
  safeArea: boolean;
}

export interface ActiveProjectState {
  id: string;
  title: string;
  revision: number;
  blueprint: GameBlueprint;
}

export interface StudioEditorState {
  activeProject: ActiveProjectState | null;
  activeScene: string | null;
  selectedElementIds: string[];
  activeTool: StudioToolId;
  activePanel: StudioPanelId;
  undoStack: CommandHistoryEntry[];
  redoStack: CommandHistoryEntry[];
  dirty: boolean;
  autosaveEnabled: boolean;
  viewport: StudioViewportState;
}

export const DEFAULT_VIEWPORT_STATE: StudioViewportState = {
  panX: 0,
  panY: 0,
  zoom: 1,
  fullscreen: false,
  gridVisible: true,
  snapping: true,
  safeArea: true,
};

export function createInitialEditorState(
  project?: ActiveProjectState | null,
): StudioEditorState {
  return {
    activeProject: project ?? null,
    activeScene: project?.blueprint.scenes[0]?.id ?? null,
    selectedElementIds: [],
    activeTool: "select",
    activePanel: "inspector",
    undoStack: [],
    redoStack: [],
    dirty: false,
    autosaveEnabled: false,
    viewport: { ...DEFAULT_VIEWPORT_STATE },
  };
}

export type EditorStateAction =
  | { type: "SET_ACTIVE_PROJECT"; project: ActiveProjectState | null }
  | { type: "SET_ACTIVE_SCENE"; sceneId: string | null }
  | { type: "SET_SELECTED_ELEMENTS"; ids: string[] }
  | { type: "TOGGLE_SELECT_ELEMENT"; id: string; additive?: boolean }
  | { type: "CLEAR_SELECTION" }
  | { type: "SET_ACTIVE_TOOL"; tool: StudioToolId }
  | { type: "SET_ACTIVE_PANEL"; panel: StudioPanelId }
  | { type: "SET_AUTOSAVE_ENABLED"; enabled: boolean }
  | { type: "UPDATE_VIEWPORT"; patch: Partial<StudioViewportState> }
  | { type: "DISPATCH_COMMAND"; command: EditorCommand }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "MARK_SAVED"; revision?: number; blueprint?: GameBlueprint };

const MAX_HISTORY_ENTRIES = 100;

export function editorStateReducer(
  state: StudioEditorState,
  action: EditorStateAction,
): StudioEditorState {
  switch (action.type) {
    case "SET_ACTIVE_PROJECT": {
      const nextScene =
        action.project?.blueprint.scenes.find((s) => s.id === state.activeScene)?.id ??
        action.project?.blueprint.scenes[0]?.id ??
        null;
      return {
        ...state,
        activeProject: action.project,
        activeScene: nextScene,
        selectedElementIds: [],
        undoStack: [],
        redoStack: [],
        dirty: false,
      };
    }

    case "SET_ACTIVE_SCENE":
      return {
        ...state,
        activeScene: action.sceneId,
        selectedElementIds: [],
      };

    case "SET_SELECTED_ELEMENTS":
      return {
        ...state,
        selectedElementIds: [...action.ids],
      };

    case "TOGGLE_SELECT_ELEMENT": {
      if (!action.additive) {
        return { ...state, selectedElementIds: [action.id] };
      }
      const exists = state.selectedElementIds.includes(action.id);
      return {
        ...state,
        selectedElementIds: exists
          ? state.selectedElementIds.filter((id) => id !== action.id)
          : [...state.selectedElementIds, action.id],
      };
    }

    case "CLEAR_SELECTION":
      return { ...state, selectedElementIds: [] };

    case "SET_ACTIVE_TOOL":
      return { ...state, activeTool: action.tool };

    case "SET_ACTIVE_PANEL":
      return { ...state, activePanel: action.panel };

    case "SET_AUTOSAVE_ENABLED":
      return { ...state, autosaveEnabled: action.enabled };

    case "UPDATE_VIEWPORT": {
      const nextZoom =
        action.patch.zoom !== undefined
          ? Math.max(0.1, Math.min(8, action.patch.zoom))
          : state.viewport.zoom;
      return {
        ...state,
        viewport: {
          ...state.viewport,
          ...action.patch,
          zoom: nextZoom,
        },
      };
    }

    case "DISPATCH_COMMAND": {
      if (!state.activeProject) return state;
      const before = state.activeProject.blueprint;
      const after = executeEditorCommand(before, action.command);
      if (after === before) return state;

      const entry: CommandHistoryEntry = {
        command: action.command,
        before,
        after,
      };
      const nextUndo = [...state.undoStack, entry].slice(-MAX_HISTORY_ENTRIES);

      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          title: after.meta.title,
          blueprint: after,
        },
        undoStack: nextUndo,
        redoStack: [],
        dirty: true,
      };
    }

    case "UNDO": {
      if (!state.activeProject || state.undoStack.length === 0) return state;
      const nextUndo = [...state.undoStack];
      const lastEntry = nextUndo.pop()!;
      const nextRedo = [...state.redoStack, lastEntry];
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          title: lastEntry.before.meta.title,
          blueprint: lastEntry.before,
        },
        undoStack: nextUndo,
        redoStack: nextRedo,
        dirty: nextUndo.length > 0,
      };
    }

    case "REDO": {
      if (!state.activeProject || state.redoStack.length === 0) return state;
      const nextRedo = [...state.redoStack];
      const entry = nextRedo.pop()!;
      const nextUndo = [...state.undoStack, entry];
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          title: entry.after.meta.title,
          blueprint: entry.after,
        },
        undoStack: nextUndo,
        redoStack: nextRedo,
        dirty: true,
      };
    }

    case "MARK_SAVED": {
      if (!state.activeProject) return state;
      const bp = action.blueprint ?? state.activeProject.blueprint;
      return {
        ...state,
        activeProject: {
          ...state.activeProject,
          title: bp.meta.title,
          revision: action.revision ?? state.activeProject.revision + 1,
          blueprint: bp,
        },
        dirty: false,
      };
    }

    default:
      return state;
  }
}

/**
 * Imperative store wrapper around `StudioEditorState` for services and tests.
 */
export class StudioEditorStore {
  private state: StudioEditorState;
  private listeners = new Set<(state: StudioEditorState) => void>();

  constructor(initialProject?: ActiveProjectState | null) {
    this.state = createInitialEditorState(initialProject);
  }

  getState(): StudioEditorState {
    return this.state;
  }

  subscribe(listener: (state: StudioEditorState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispatch(action: EditorStateAction): StudioEditorState {
    this.state = editorStateReducer(this.state, action);
    for (const listener of this.listeners) {
      listener(this.state);
    }
    return this.state;
  }

  execute<T extends EditorCommandType>(
    type: T,
    payload: CommandPayloadMap[T],
    label?: string,
  ): EditorCommand<T> {
    const command = createEditorCommand(type, payload, label);
    this.dispatch({ type: "DISPATCH_COMMAND", command });
    return command;
  }

  undo(): StudioEditorState {
    return this.dispatch({ type: "UNDO" });
  }

  redo(): StudioEditorState {
    return this.dispatch({ type: "REDO" });
  }

  canUndo(): boolean {
    return this.state.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.state.redoStack.length > 0;
  }

  setAutosaveEnabled(enabled: boolean): StudioEditorState {
    return this.dispatch({ type: "SET_AUTOSAVE_ENABLED", enabled });
  }

  replaceBlueprint(blueprint: GameBlueprint, label = "Update blueprint"): EditorCommand<"REPLACE_BLUEPRINT"> {
    return this.execute("REPLACE_BLUEPRINT", { blueprint }, label);
  }
}
