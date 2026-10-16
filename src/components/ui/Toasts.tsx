"use client";

import type { Toast } from "@/lib/client/useWorkspace";

export function Toasts({
  toasts,
  onDismiss,
  onUndo,
  canUndo,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`animate-fade-in pointer-events-auto flex items-center gap-3 rounded-lg border px-3.5 py-2 text-xs shadow-xl shadow-black/60 backdrop-blur ${
            toast.tone === "error"
              ? "border-rose-500/30 bg-rose-950/80 text-rose-100"
              : toast.tone === "success"
                ? "border-emerald-500/25 bg-emerald-950/70 text-emerald-100"
                : "border-white/10 bg-ink-850/95 text-ink-100"
          }`}
        >
          <span>{toast.message}</span>
          {toast.undoable && canUndo ? (
            <button
              type="button"
              onClick={() => {
                onUndo();
                onDismiss(toast.id);
              }}
              className="focus-ring rounded border border-white/15 px-2 py-0.5 font-medium text-ink-100 transition hover:bg-white/10"
            >
              Undo
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => onDismiss(toast.id)}
            className="focus-ring rounded px-1 text-ink-400 transition hover:text-ink-100"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
