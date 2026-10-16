"use client";

import { Button, SegmentedControl } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import type { CanvasSaveState } from "@/lib/client/useCanvasEditor";
import { SHORTCUT_TO_TOOL, TOOLS, UNAVAILABLE_TOOLS, type ToolId } from "@/lib/canvas/tools";
import type { Viewport } from "@/lib/canvas/geometry";

const SAVE_LABEL: Record<CanvasSaveState, string> = {
  saved: "Saved", saving: "Saving…", dirty: "Unsaved", error: "Save failed", conflict: "Out of sync",
};
const SAVE_DOT: Record<CanvasSaveState, string> = {
  saved: "bg-emerald-400", saving: "bg-sky-400 animate-pulse", dirty: "bg-amber-300", error: "bg-rose-400", conflict: "bg-rose-400",
};

interface Props {
  project: { id: string; title: string };
  sceneName: string;
  saveState: CanvasSaveState;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  tool: ToolId;
  viewport: Viewport;
  gridVisible: boolean;
  snapping: boolean;
  safeArea: boolean;
  navOpen: boolean;
  inspectorOpen: boolean;
  onTool: (tool: ToolId) => void;
  onUndo: () => void;
  onRedo: () => void;
  onRetry: () => void;
  onZoom: (scale: number) => void;
  onFit: () => void;
  onActual: () => void;
  onToggle: (patch: { gridVisible?: boolean; snapping?: boolean; safeArea?: boolean }) => void;
  onToggleNav: () => void;
  onToggleInspector: () => void;
}

export function CanvasTopBar(p: Props) {
  const zoomPercent = Math.round(p.viewport.scale * 100);
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-white/[0.07] bg-ink-900/70 px-3 py-1.5">
      <button type="button" onClick={p.onToggleNav} aria-label="Toggle panel" className="focus-ring rounded-md p-1.5 text-ink-300 hover:text-ink-100 lg:hidden">
        <Icon name="panel-left" size={17} />
      </button>
      <span className="max-w-[140px] truncate rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] font-medium text-ink-200">
        {p.sceneName}
      </span>

      <div role="group" aria-label="History" className="flex items-center gap-0.5">
        <Button variant="ghost" className="h-8 px-2" aria-label="Undo" title="Undo (Ctrl/⌘ Z)" disabled={!p.canUndo} onClick={p.onUndo}><Icon name="undo" size={15} /></Button>
        <Button variant="ghost" className="h-8 px-2" aria-label="Redo" title="Redo (Ctrl/⌘ Shift Z)" disabled={!p.canRedo} onClick={p.onRedo}><Icon name="redo" size={15} /></Button>
      </div>

      <span role="status" aria-live="polite" title={p.saveError ?? undefined} className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.07] px-2 py-1 text-[10.5px] text-ink-300">
        <span className={`h-1.5 w-1.5 rounded-full ${SAVE_DOT[p.saveState]}`} />{SAVE_LABEL[p.saveState]}
      </span>
      {p.saveState === "error" ? <Button className="h-7 px-2 text-[11px]" onClick={p.onRetry}>Retry</Button> : null}

      <div role="toolbar" aria-label="Tools" className="order-last flex w-full flex-wrap items-center gap-0.5 border-t border-white/[0.06] pt-2 lg:order-none lg:w-auto lg:border-0 lg:pt-0">
        {TOOLS.map((item) => (
          <button
            key={item.id} type="button" disabled={!item.available} aria-pressed={p.tool === item.id}
            aria-label={item.available ? item.label : `${item.label} (unavailable)`}
            title={item.available ? `${item.label} (${item.shortcut}) — ${item.hint}` : item.unavailableReason}
            onClick={() => p.onTool(item.id)}
            className={`focus-ring grid h-8 w-8 place-items-center rounded-md border text-ink-200 transition disabled:cursor-not-allowed disabled:text-ink-400/40 ${
              p.tool === item.id ? "border-accent-500/60 bg-accent-500/15 text-blue-200" : "border-transparent hover:bg-white/5 hover:text-ink-100"
            }`}
          >
            <Icon name={item.icon} size={15} />
          </button>
        ))}
        <span aria-hidden className="mx-1 h-5 w-px bg-white/10" />
        {UNAVAILABLE_TOOLS.map((item) => (
          <button key={`reserved-${item.label}`} type="button" disabled
            title={`${item.label} — ${item.unavailableReason}`}
            aria-label={`${item.label} (unavailable)`}
            className="focus-ring grid h-8 w-8 place-items-center rounded-md border border-dashed border-white/[0.08] text-ink-400/40">
            <Icon name={item.icon} size={15} />
          </button>
        ))}
        <span className="ml-1 hidden text-[10px] text-ink-400 xl:inline">
          {TOOLS.find((t) => t.id === p.tool)?.label} · {TOOLS.find((t) => t.id === p.tool)?.hint}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div role="group" aria-label="Viewport" className="flex items-center gap-0.5">
          <button type="button" aria-label="Zoom out" onClick={() => p.onZoom(p.viewport.scale / 1.2)} className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 hover:text-ink-100"><Icon name="minus" size={12} /></button>
          <button type="button" onClick={p.onActual} aria-label="Reset zoom to 100%" title="Reset to 100% (0)" className="focus-ring w-12 rounded font-mono text-[11px] text-ink-200 hover:text-ink-100">{zoomPercent}%</button>
          <button type="button" aria-label="Zoom in" onClick={() => p.onZoom(p.viewport.scale * 1.2)} className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 hover:text-ink-100"><Icon name="plus" size={12} /></button>
          <button type="button" onClick={p.onFit} aria-label="Zoom to fit" title="Zoom to fit (Shift+1)" className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 hover:text-ink-100"><Icon name="fit" size={14} /></button>
        </div>

        <SegmentedControl
          ariaLabel="Canvas overlays"
          value={p.gridVisible ? "grid" : "plain"}
          onChange={(value) => p.onToggle({ gridVisible: value === "grid" })}
          options={[{ value: "grid", label: "Grid", title: "Toggle grid (G is the triangle tool shortcut; use this control)" }, { value: "plain", label: "No grid" }]}
        />
        <Button variant={p.snapping ? "outline" : "ghost"} className="h-7 px-2 text-[10.5px]" aria-pressed={p.snapping} onClick={() => p.onToggle({ snapping: !p.snapping })} title="Toggle snapping">
          <Icon name="check" size={12} />Snap
        </Button>
        <Button variant={p.safeArea ? "outline" : "ghost"} className="h-7 px-2 text-[10.5px]" aria-pressed={p.safeArea} onClick={() => p.onToggle({ safeArea: !p.safeArea })} title="Toggle the safe canvas area">
          <Icon name="frame" size={12} />Safe
        </Button>
        <button type="button" onClick={p.onToggleInspector} aria-label="Toggle inspector" className="focus-ring rounded-md p-1.5 text-ink-300 hover:text-ink-100 xl:hidden">
          <Icon name="panel-right" size={17} />
        </button>
      </div>
    </header>
  );
}

export const TOOL_HINTS = TOOLS;
export const TOOL_SHORTCUTS = SHORTCUT_TO_TOOL;
