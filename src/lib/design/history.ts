/** Generic snapshot history. Immutable state makes snapshots cheap (structural sharing). */
export interface HistoryEntry<T> {
  /** For `past`: state before the operation. For `future`: state after it. */
  value: T;
  label: string;
}

export interface HistoryState<T> {
  present: T;
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
  lastKey: string | null;
  lastAt: number;
}

export interface CommitOptions {
  key?: string;
  now?: number;
  windowMs?: number;
  limit?: number;
}

export function createHistory<T>(present: T): HistoryState<T> {
  return { present, past: [], future: [], lastKey: null, lastAt: 0 };
}

export function commitHistory<T>(
  history: HistoryState<T>,
  next: T,
  label: string,
  options: CommitOptions = {},
): HistoryState<T> {
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 200;
  const coalesce =
    options.key !== undefined &&
    options.key === history.lastKey &&
    history.past.length > 0 &&
    now - history.lastAt < (options.windowMs ?? 700);
  return {
    present: next,
    past: coalesce
      ? history.past
      : [...history.past, { value: history.present, label }].slice(-limit),
    future: [],
    lastKey: options.key ?? null,
    lastAt: now,
  };
}

export function undoHistory<T>(
  history: HistoryState<T>,
): { state: HistoryState<T>; label: string } | null {
  const entry = history.past[history.past.length - 1];
  if (!entry) return null;
  return {
    label: entry.label,
    state: {
      present: entry.value,
      past: history.past.slice(0, -1),
      future: [{ value: history.present, label: entry.label }, ...history.future],
      lastKey: null,
      lastAt: 0,
    },
  };
}

export function redoHistory<T>(
  history: HistoryState<T>,
): { state: HistoryState<T>; label: string } | null {
  const entry = history.future[0];
  if (!entry) return null;
  return {
    label: entry.label,
    state: {
      present: entry.value,
      past: [...history.past, { value: history.present, label: entry.label }],
      future: history.future.slice(1),
      lastKey: null,
      lastAt: 0,
    },
  };
}
