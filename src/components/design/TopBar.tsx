"use client";

import { Button, SegmentedControl } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import type { DesignSaveState } from "@/lib/client/useDesignEditor";

const SAVE_LABEL: Record<DesignSaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved changes",
  error: "Save failed",
  conflict: "Out of sync",
};
const SAVE_DOT: Record<DesignSaveState, string> = {
  saved: "bg-emerald-400",
  saving: "bg-sky-400 animate-pulse",
  dirty: "bg-amber-300",
  error: "bg-rose-400",
  conflict: "bg-rose-400",
};

interface Props {
  title: string;
  subtitle: string;
  saveState: DesignSaveState;
  saveError: string | null;
  uploading: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  mode: "grid" | "list";
  modeDisabled: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
  onZoom: (value: number) => void;
  onMode: (value: "grid" | "list") => void;
  onImport: () => void;
  onAdd: () => void;
  onToggleNav: () => void;
  onToggleInspector: () => void;
}

export function TopBar(p: Props) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/[0.07] bg-ink-900/70 px-3 py-2 sm:px-4">
      <button type="button" onClick={p.onToggleNav} aria-label="Toggle navigation" className="focus-ring rounded-md p-1.5 text-ink-300 hover:text-ink-100 lg:hidden"><Icon name="panel-left" size={17} /></button>
      <div className="min-w-0 flex-1 basis-40">
        <h1 className="truncate text-[15px] leading-tight font-semibold tracking-tight text-ink-100" title={p.title}>{p.title}</h1>
        <p className="truncate text-[10.5px] text-ink-400">{p.subtitle}</p>
      </div>

      <div className="flex items-center gap-2">
        <span role="status" aria-live="polite" title={p.saveError ?? undefined} className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.07] px-2 py-1 text-[10.5px] text-ink-300">
          <span className={`h-1.5 w-1.5 rounded-full ${SAVE_DOT[p.saveState]}`} />{p.uploading ? "Uploading image…" : SAVE_LABEL[p.saveState]}
        </span>
        {p.saveState === "error" ? <Button className="h-7 px-2 text-[11px]" onClick={p.onRetry}>Retry</Button> : null}
      </div>

      <div className="flex items-center gap-0.5" role="group" aria-label="History">
        <Button variant="ghost" className="h-8 px-2" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!p.canUndo} onClick={p.onUndo}><Icon name="undo" size={15} /></Button>
        <Button variant="ghost" className="h-8 px-2" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!p.canRedo} onClick={p.onRedo}><Icon name="redo" size={15} /></Button>
      </div>

      <div className="flex items-center gap-2" role="group" aria-label="View controls">
        <button type="button" aria-label="Zoom out" onClick={() => p.onZoom(p.zoom - 20)} disabled={p.zoom <= 110} className="focus-ring rounded p-1 text-ink-300 hover:text-ink-100 disabled:opacity-30"><Icon name="minus" size={13} /></button>
        <input type="range" min={110} max={320} step={10} value={p.zoom} onChange={(e) => p.onZoom(Number(e.target.value))} aria-label="Zoom" className="w-24 accent-blue-500" />
        <button type="button" aria-label="Zoom in" onClick={() => p.onZoom(p.zoom + 20)} disabled={p.zoom >= 320} className="focus-ring rounded p-1 text-ink-300 hover:text-ink-100 disabled:opacity-30"><Icon name="plus" size={13} /></button>
        <span className={p.modeDisabled ? "pointer-events-none opacity-40" : ""} title={p.modeDisabled ? "Grid/list applies to the elements overview" : undefined}>
          <SegmentedControl ariaLabel="View mode" value={p.mode} onChange={p.onMode} options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} />
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button onClick={p.onImport}><Icon name="upload" size={13} />Import</Button>
        <Button variant="primary" onClick={p.onAdd} title="Add element (N)"><Icon name="plus" size={13} />Add Element</Button>
        <button type="button" onClick={p.onToggleInspector} aria-label="Toggle inspector" className="focus-ring rounded-md p-1.5 text-ink-300 hover:text-ink-100 xl:hidden"><Icon name="panel-right" size={17} /></button>
      </div>
    </header>
  );
}
