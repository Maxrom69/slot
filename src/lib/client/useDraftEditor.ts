"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDefaultDraft, normalizeDraft, type NewGameDraft } from "@/lib/creation/draft";
import { draftToBlueprint } from "@/lib/creation/blueprint-from-draft";
import { draftDocument, draftStore } from "./draft-store";

const MAX_HISTORY = 80;
const COALESCE_MS = 700;
interface HistoryState { present: NewGameDraft; past: NewGameDraft[]; future: NewGameDraft[] }
export type DraftSaveState = "loading" | "saving" | "saved" | "error";

/** Immutable form history + durable full-Blueprint browser persistence. No engine logic. */
export function useDraftEditor(initialFolder: string) {
  const [state, setState] = useState<HistoryState>({ present: createDefaultDraft(), past: [], future: [] });
  const stateRef = useRef(state);
  const lastEdit = useRef<{ key: string; at: number } | null>(null);
  const ready = useRef(false);
  const discarded = useRef(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  const createdAt = useRef("1970-01-01T00:00:00.000Z");
  const draftId = useRef("draft-manual");
  const [draftMeta, setDraftMeta] = useState({ id: "draft-manual", createdAt: "1970-01-01T00:00:00.000Z" });
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const [persistWarning, setPersistWarning] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<DraftSaveState>("loading");

  const persist = useCallback(async (form: NewGameDraft): Promise<boolean> => {
    if (discarded.current) return true;
    const writeRevision = ++revision.current;
    if (mounted.current) setSaveState("saving");
    try {
      await draftStore.save(draftDocument(form, draftId.current, createdAt.current));
      if (mounted.current && revision.current === writeRevision && !discarded.current) {
        setSaveState("saved");
        setPersistWarning(null);
      }
      return true;
    } catch {
      if (mounted.current && revision.current === writeRevision) {
        setSaveState("error");
        setPersistWarning("Browser storage is unavailable or full. Your draft is still in this session; download the blueprint to keep a copy.");
      }
      return false;
    }
  }, []);

  const commit = useCallback((next: HistoryState) => {
    stateRef.current = next;
    setState(next);
    if (ready.current && !discarded.current) void persist(next.present);
  }, [persist]);

  useEffect(() => {
    let active = true;
    mounted.current = true;
    void draftStore.load().then((document) => {
      if (!active) return;
      const form = document?.form ?? { ...createDefaultDraft(), folderPath: initialFolder };
      const nextCreatedAt = document?.createdAt ?? new Date().toISOString();
      const nextId = document?.id ?? `draft_${crypto.randomUUID()}`;
      createdAt.current = nextCreatedAt;
      draftId.current = nextId;
      setDraftMeta({ id: nextId, createdAt: nextCreatedAt });
      ready.current = true;
      setRestored(Boolean(document && JSON.stringify(form) !== JSON.stringify(createDefaultDraft())));
      commit({ present: form, past: [], future: [] });
      setHydrated(true);
    });
    return () => { active = false; mounted.current = false; };
  }, [initialFolder, commit]);

  const update = useCallback((updater: (draft: NewGameDraft) => NewGameDraft, coalesceKey?: string) => {
    if (!ready.current || discarded.current) return;
    const current = stateRef.current;
    const next = normalizeDraft(updater(current.present));
    if (JSON.stringify(next) === JSON.stringify(current.present)) return;
    const now = Date.now();
    const coalesce = coalesceKey !== undefined && lastEdit.current?.key === coalesceKey && now - lastEdit.current.at < COALESCE_MS;
    lastEdit.current = coalesceKey !== undefined ? { key: coalesceKey, at: now } : null;
    commit({ present: next, past: coalesce ? current.past : [...current.past, current.present].slice(-MAX_HISTORY), future: [] });
  }, [commit]);

  const patch = useCallback((partial: Partial<NewGameDraft>, key?: string) => update((draft) => ({ ...draft, ...partial }), key), [update]);
  const undo = useCallback(() => {
    if (discarded.current) return;
    const current = stateRef.current, previous = current.past.at(-1);
    if (!previous) return;
    lastEdit.current = null;
    commit({ present: previous, past: current.past.slice(0, -1), future: [current.present, ...current.future] });
  }, [commit]);
  const redo = useCallback(() => {
    if (discarded.current) return;
    const current = stateRef.current, next = current.future[0];
    if (!next) return;
    lastEdit.current = null;
    commit({ present: next, past: [...current.past, current.present].slice(-MAX_HISTORY), future: current.future.slice(1) });
  }, [commit]);
  const reset = useCallback(() => {
    update(() => ({ ...createDefaultDraft(), folderPath: initialFolder }));
    setRestored(false);
  }, [update, initialFolder]);
  const flush = useCallback(() => persist(stateRef.current.present), [persist]);
  const discardStored = useCallback(async () => {
    discarded.current = true;
    try { await draftStore.clear(); } catch {
      // Project creation already succeeded. A failed local clear must not trigger a second create.
      if (mounted.current) setPersistWarning("Project saved, but the previous browser draft could not be cleared.");
    }
  }, []);

  const blueprint = useMemo(() => draftToBlueprint(state.present, { id: draftMeta.id, now: draftMeta.createdAt }), [state.present, draftMeta.id, draftMeta.createdAt]);
  return {
    draft: state.present, blueprint, hydrated, restored, persistWarning, saveState,
    update, patch, undo, redo, reset, flush, discardStored,
    canUndo: state.past.length > 0, canRedo: state.future.length > 0,
  };
}
export type DraftEditor = ReturnType<typeof useDraftEditor>;
