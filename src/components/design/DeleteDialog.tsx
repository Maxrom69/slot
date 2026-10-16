"use client";

import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { DeletionImpact } from "@/lib/design/types";

export interface DeleteTarget {
  kind: "element" | "symbol";
  id: string;
  name: string;
  /** Human label such as "symbol set" or "reel frame". */
  label: string;
  impact: DeletionImpact;
}

/** Confirmation that states exactly what else is removed. Deletion is undoable. */
export function DeleteDialog({ target, onCancel, onConfirm }: { target: DeleteTarget | null; onCancel: () => void; onConfirm: () => void }) {
  const impact = target?.impact;
  return (
    <Modal open={Boolean(target)} onClose={onCancel} title={target ? `Delete ${target.label}?` : "Delete"}
      footer={<>
        <Button variant="ghost" onClick={onCancel} autoFocus>Cancel</Button>
        <Button variant="danger" onClick={onConfirm}><Icon name="trash" size={13} />Delete</Button>
      </>}>
      {target && impact ? (
        <div className="space-y-3 text-[12px] leading-relaxed text-ink-300">
          <p>“<span className="font-medium text-ink-100">{target.name}</span>” will be removed from this project.</p>
          {target.kind === "symbol" && (impact.stripPositions > 0 || impact.paytableRows > 0) ? (
            <div role="alert" className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] p-3 text-[11.5px] text-amber-200">
              <p className="mb-1 flex items-center gap-1.5 font-medium">
                <Icon name="alert" size={13} />Dependency warning — this symbol is referenced by
              </p>
              <ul className="space-y-1">
                {impact.stripPositions > 0 ? (
                  <li>• {impact.stripPositions} reel strip {impact.stripPositions === 1 ? "position" : "positions"} — strips will be rebuilt without it</li>
                ) : null}
                {impact.paytableRows > 0 ? (
                  <li>• {impact.paytableRows} paytable {impact.paytableRows === 1 ? "row" : "rows"} — those rows will be removed</li>
                ) : null}
              </ul>
            </div>
          ) : null}
          {impact.symbols > 1 ? (
            <ul className="space-y-1 rounded-lg border border-white/[0.07] bg-ink-950/40 p-3 text-[11.5px]">
              <li>• {impact.symbols} {impact.symbols === 1 ? "symbol" : "symbols"} and their images are unlinked</li>
              {impact.paytableRows > 0 ? <li>• {impact.paytableRows} paytable {impact.paytableRows === 1 ? "row" : "rows"} are removed</li> : null}
              {impact.stripPositions > 0 ? <li>• {impact.stripPositions} reel strip {impact.stripPositions === 1 ? "position is" : "positions are"} removed</li> : null}
            </ul>
          ) : null}
          <p className="text-[11px] text-ink-400">You can undo this with Ctrl/⌘ Z. Uploaded image files are not erased.</p>
        </div>
      ) : null}
    </Modal>
  );
}
