"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetRef } from "@/lib/blueprint/types";
import { importImageFile } from "@/lib/creation/images";
import {
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
  type HistoryState,
} from "@/lib/design/history";
import type { DesignDoc, OpContext } from "@/lib/design/types";
import { ApiError, designApi } from "./design-api";
import type { Toast } from "./useWorkspace";

export type DesignSaveState = "saved" | "dirty" | "saving" | "error" | "conflict";
export interface UploadResult {
  file: File;
  asset?: AssetRef;
  error?: string;
}

const AUTOSAVE_MS = 800;

interface Options {
  projectId: string;
  initialDoc: DesignDoc;
  initialRevision: number;
  glyphs: string[];
}

/**
 * Design editor state: immutable DesignDoc + undo/redo history + autosave.
 * Every edit is a pure operation committed as one history entry. Saves are
 * serialised, debounced, revision-checked and never lose edits made mid-save.
 */
export function useDesignEditor({ projectId, initialDoc, initialRevision, glyphs }: Options) {
  const [history, setHistory] = useState<HistoryState<DesignDoc>>(() => createHistory(initialDoc));
  const historyRef = useRef(history);
  const savedRef = useRef(initialDoc);
  const revisionRef = useRef(initialRevision);
  const inflight = useRef<Promise<void> | null>(null);
  const conflict = useRef(false);
  const force = useRef(false);
  const toastSeq = useRef(0);
  const [saveState, setSaveState] = useState<DesignSaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ctx = useMemo<OpContext>(() => ({ glyphs }), [glyphs]);

  const commit = useCallback((next: HistoryState<DesignDoc>) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const pushToast = useCallback((message: string, tone: Toast["tone"] = "info", undoable = false) => {
    toastSeq.current += 1;
    const id = `design-toast-${toastSeq.current}`;
    setToasts((current) => [...current.slice(-3), { id, message, tone, undoable }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6500);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((current) => current.filter((t) => t.id !== id)), []);

  /** Runs a pure operation against the latest document; returns its value, or null when nothing changed. */
  const run = useCallback(
    function run<T>(
      label: string,
      operation: (doc: DesignDoc, ctx: OpContext) => { doc: DesignDoc; value: T },
      options?: { key?: string },
    ): T | null {
      const current = historyRef.current;
      const result = operation(current.present, ctx);
      if (result.doc === current.present) return null;
      commit(commitHistory(current, result.doc, label, { key: options?.key }));
      return result.value;
    },
    [commit, ctx],
  );

  const apply = useCallback(
    (label: string, operation: (doc: DesignDoc, ctx: OpContext) => DesignDoc, options?: { key?: string }) =>
      run(label, (doc, context) => ({ doc: operation(doc, context), value: true }), options) === true,
    [run],
  );

  const undo = useCallback(() => {
    const result = undoHistory(historyRef.current);
    if (!result) return;
    commit(result.state);
    pushToast(`Undone: ${result.label}`);
  }, [commit, pushToast]);

  const redo = useCallback(() => {
    const result = redoHistory(historyRef.current);
    if (!result) return;
    commit(result.state);
    pushToast(`Redone: ${result.label}`);
  }, [commit, pushToast]);

  /** Saves until the server has the latest document. Concurrent callers share one in-flight save. */
  const flush = useCallback((): Promise<void> => {
    if (inflight.current) return inflight.current;
    if (conflict.current || historyRef.current.present === savedRef.current) return Promise.resolve();
    const task = (async () => {
      try {
        while (!conflict.current && historyRef.current.present !== savedRef.current) {
          const doc = historyRef.current.present;
          setSaveState("saving");
          setSaveError(null);
          const result = await designApi.save(projectId, { baseRevision: revisionRef.current, doc, force: force.current });
          force.current = false;
          revisionRef.current = result.revision;
          savedRef.current = doc;
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
        inflight.current = null;
      }
    })();
    inflight.current = task;
    return task;
  }, [projectId]);

  useEffect(() => {
    if (history.present === savedRef.current) {
      setSaveState((state) => (state === "dirty" ? "saved" : state));
      return;
    }
    if (conflict.current) return;
    setSaveState((state) => (state === "saving" ? state : "dirty"));
    const timer = window.setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => window.clearTimeout(timer);
  }, [history.present, flush]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (historyRef.current.present !== savedRef.current || inflight.current) {
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

  /** True when the server holds the latest edits. */
  const isClean = useCallback(() => historyRef.current.present === savedRef.current, []);

  const overwrite = useCallback(() => {
    conflict.current = false;
    force.current = true;
    setSaveState("dirty");
    void flush();
  }, [flush]);

  /** Decodes, downsizes and stores images. Results are aligned with the input order. */
  const uploadImages = useCallback(
    async (files: File[]): Promise<UploadResult[]> => {
      setUploading((n) => n + 1);
      const results: UploadResult[] = [];
      try {
        for (const file of files) {
          try {
            const image = await importImageFile(file);
            results.push({ file, asset: await designApi.upload(projectId, image) });
          } catch (error) {
            const message = error instanceof Error ? error.message : "Upload failed.";
            results.push({ file, error: message.includes(file.name) ? message : `${file.name}: ${message}` });
          }
        }
      } finally {
        setUploading((n) => n - 1);
      }
      return results;
    },
    [projectId],
  );

  return {
    doc: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saveState,
    saveError,
    uploading: uploading > 0,
    toasts,
    ctx,
    run,
    apply,
    undo,
    redo,
    flush,
    isClean,
    retry: flush,
    overwrite,
    uploadImages,
    pushToast,
    dismissToast,
  };
}

export type DesignEditor = ReturnType<typeof useDesignEditor>;
