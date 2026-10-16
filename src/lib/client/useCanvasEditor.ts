"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerDef, SceneBackground, SceneObject } from "@/lib/blueprint/types";
import { canvasApi } from "./design-api";
import { ApiError } from "./design-api";
import type { Toast } from "./useWorkspace";

export type CanvasSaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

export interface CanvasContent {
  objects: SceneObject[];
  background: SceneBackground;
  layers: LayerDef[];
}

interface Options {
  projectId: string;
  sceneId: string;
  initial: CanvasContent;
  initialRevision: number;
}

const AUTOSAVE_MS = 700;

/**
 * Canvas editor state. Drag interactions get exactly one history entry: `begin`
 * snapshots, `preview` mutates without history, `end` commits the difference.
 * Saves are serialised, debounced and revision-checked like the Design editor.
 */
export function useCanvasEditor({ projectId, sceneId, initial, initialRevision }: Options) {
  const [present, setPresent] = useState<CanvasContent>(initial);
  const [past, setPast] = useState<Array<{ value: CanvasContent; label: string }>>([]);
  const [future, setFuture] = useState<Array<{ value: CanvasContent; label: string }>>([]);
  const [saveState, setSaveState] = useState<CanvasSaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const live = useRef(present);
  const savedContent = useRef(initial);
  const revision = useRef(initialRevision);
  const inFlight = useRef<Promise<void> | null>(null);
  const conflict = useRef(false);
  const force = useRef(false);
  const draft = useRef<{ label: string; value: CanvasContent } | null>(null);
  const toastSeq = useRef(0);
  const coalesce = useRef<{ key: string; at: number } | null>(null);

  const commitAll = useCallback((next: CanvasContent) => {
    live.current = next;
    setPresent(next);
  }, []);

  const pushToast = useCallback((message: string, tone: Toast["tone"] = "info", undoable = false) => {
    toastSeq.current += 1;
    const id = `canvas-toast-${toastSeq.current}`;
    setToasts((current) => [...current.slice(-3), { id, message, tone, undoable }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((current) => current.filter((t) => t.id !== id)), []);

  const flush = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    if (conflict.current || live.current === savedContent.current) return Promise.resolve();
    const task = (async () => {
      try {
        while (!conflict.current && live.current !== savedContent.current) {
          const content = live.current;
          setSaveState("saving");
          setSaveError(null);
          const result = await canvasApi.save(projectId, {
            baseRevision: revision.current,
            sceneId,
            objects: content.objects,
            background: content.background,
            layers: content.layers,
            force: force.current,
          });
          force.current = false;
          revision.current = result.revision;
          savedContent.current = content;
        }
        setSaveState(conflict.current ? "conflict" : "saved");
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          conflict.current = true;
          setSaveState("conflict");
        } else {
          setSaveState("error");
          setSaveError(error instanceof Error ? error.message : "Changes could not be saved.");
        }
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = task;
    return task;
  }, [projectId, sceneId]);

  useEffect(() => {
    if (present === savedContent.current) {
      setSaveState((state) => (state === "dirty" ? "saved" : state));
      return;
    }
    if (conflict.current) return;
    setSaveState((state) => (state === "saving" ? state : "dirty"));
    const timer = window.setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [present, flush]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (live.current !== savedContent.current || inFlight.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [flush]);

  /** Commits a discrete change as one undo step. Returns true when something changed. */
  const apply = useCallback(
    (label: string, produce: (content: CanvasContent) => CanvasContent, options?: { key?: string; windowMs?: number }) => {
      const current = live.current;
      const next = produce(current);
      if (next === current) return false;
      const now = Date.now();
      const coalescing =
        options?.key !== undefined &&
        coalesce.current?.key === options.key &&
        now - coalesce.current.at < (options.windowMs ?? 700) &&
        past.length > 0;
      coalesce.current = options?.key !== undefined ? { key: options.key, at: now } : null;
      if (!coalescing) setPast((stack) => [...stack, { value: current, label }].slice(-200));
      setFuture([]);
      commitAll(next);
      return true;
    },
    [commitAll, past.length],
  );

  /* ------------------------------ drag lifecycle ----------------------------- */
  const begin = useCallback((label: string) => {
    draft.current = { label, value: live.current };
    coalesce.current = null;
  }, []);

  const preview = useCallback(
    (produce: (content: CanvasContent) => CanvasContent) => {
      commitAll(produce(live.current));
    },
    [commitAll],
  );

  const end = useCallback(() => {
    const state = draft.current;
    draft.current = null;
    if (!state || state.value === live.current) return;
    setPast((stack) => [...stack, { value: state.value, label: state.label }].slice(-200));
    setFuture([]);
  }, []);

  const abandon = useCallback(() => {
    const state = draft.current;
    draft.current = null;
    if (state && state.value !== live.current) commitAll(state.value);
  }, [commitAll]);

  const undo = useCallback(() => {
    setPast((stack) => {
      const entry = stack[stack.length - 1];
      if (!entry) return stack;
      setFuture((f) => [{ value: live.current, label: entry.label }, ...f]);
      commitAll(entry.value);
      return stack.slice(0, -1);
    });
  }, [commitAll]);

  const redo = useCallback(() => {
    setFuture((stack) => {
      const entry = stack[0];
      if (!entry) return stack;
      setPast((p) => [...p, { value: live.current, label: entry.label }]);
      commitAll(entry.value);
      return stack.slice(1);
    });
  }, [commitAll]);

  const overwrite = useCallback(() => {
    conflict.current = false;
    force.current = true;
    setSaveState("dirty");
    void flush();
  }, [flush]);

  /** True when the server already holds every edit made here. */
  const isClean = useCallback(() => live.current === savedContent.current, []);

  const getRevision = useCallback(() => revision.current, []);
  const setRevision = useCallback((nextRevision: number) => {
    revision.current = nextRevision;
  }, []);

  const resetToSaved = useCallback(() => {
    draft.current = null;
    coalesce.current = null;
    setPast([]);
    setFuture([]);
    commitAll(savedContent.current);
    setSaveState("saved");
  }, [commitAll]);

  return useMemo(
    () => ({
      content: present,
      canUndo: past.length > 0,
      canRedo: future.length > 0,
      saveState,
      saveError,
      toasts,
      apply,
      begin,
      preview,
      end,
      abandon,
      undo,
      redo,
      flush,
      isClean,
      getRevision,
      setRevision,
      resetToSaved,
      overwrite,
      pushToast,
      dismissToast,
    }),
    [
      present,
      past.length,
      future.length,
      saveState,
      saveError,
      toasts,
      apply,
      begin,
      preview,
      end,
      abandon,
      undo,
      redo,
      flush,
      isClean,
      getRevision,
      setRevision,
      resetToSaved,
      overwrite,
      pushToast,
      dismissToast,
    ],
  );
}

export type CanvasEditor = ReturnType<typeof useCanvasEditor>;
