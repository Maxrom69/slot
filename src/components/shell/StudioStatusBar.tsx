"use client";

import { useMemo } from "react";
import type { StudioEditorState } from "@/lib/editor/store";
import { auditBlueprintDataIntegrity, verifySection2EngineContract } from "@/lib/qa";

export function StudioStatusBar({ state }: { state: StudioEditorState }) {
  const project = state.activeProject;
  const bp = project?.blueprint;
  const zoomPct = Math.round(state.viewport.zoom * 100);

  const qaStatus = useMemo(() => {
    if (!bp) return null;
    const audit = auditBlueprintDataIntegrity(bp);
    const contract = verifySection2EngineContract(bp);
    const passedChecks = Object.values(audit.checks).filter((c) => c.passed).length;
    return { audit, contract, passedChecks };
  }, [bp]);

  return (
    <footer
      role="status"
      aria-label="Studio status bar"
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] bg-ink-900/90 px-4 py-1.5 text-[10.5px] text-ink-400"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-ink-300">SECTION 1 · SLOTS STUDIO BUILDER</span>
        {bp && project ? (
          <>
            <span>·</span>
            <span>
              Blueprint v{bp.version} · rev {project.revision}
            </span>
            <span>·</span>
            <span>
              Grid {bp.reels.columns}×{bp.reels.rows} ({bp.reels.evaluation})
            </span>
            <span>·</span>
            <span>{bp.symbols.length} symbols</span>
            {qaStatus ? (
              <>
                <span>·</span>
                <span
                  title={qaStatus.audit.summary}
                  className={
                    qaStatus.audit.valid && qaStatus.contract.ready
                      ? "font-medium text-emerald-300"
                      : "font-medium text-amber-300"
                  }
                >
                  Data QA {qaStatus.passedChecks}/7 ·{" "}
                  {qaStatus.contract.ready ? "Engine Contract Ready" : "Contract Warnings"}
                </span>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 font-mono">
        {state.activeScene ? <span>Scene: {state.activeScene}</span> : null}
        <span>Tool: {state.activeTool.toUpperCase()}</span>
        <span>Selected: {state.selectedElementIds.length}</span>
        <span title="Undo / Redo stack depth (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z)">
          History: {state.undoStack.length}u / {state.redoStack.length}r
        </span>
        <span title="Canvas viewport zoom">Zoom: {zoomPct}%</span>
        <span
          title="Keyboard shortcuts: Ctrl/Cmd+S Save, Ctrl/Cmd+Z Undo, Ctrl/Cmd+Shift+Z Redo"
          className="hidden text-ink-400 lg:inline"
        >
          ⌘S Save · ⌘Z Undo · ⇧⌘Z Redo
        </span>
        <span className="text-ink-300" title="Full studio functionality works without AI">
          AI: Manual Mode
        </span>
      </div>
    </footer>
  );
}
