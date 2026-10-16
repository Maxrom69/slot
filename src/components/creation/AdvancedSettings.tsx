"use client";

import { Field, Select } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { maxPaylines } from "@/lib/blueprint/factory";
import { STATUS_LABELS } from "@/lib/workspace/types";
import { FieldError, NumberField } from "./fields";
import type { DraftValidation, NewGameDraft } from "@/lib/creation/draft";

export function AdvancedSettings({ draft, patch, errors, showErrors }: {
  draft: NewGameDraft; patch: (value: Partial<NewGameDraft>, key?: string) => void;
  errors: DraftValidation["errors"]; showErrors: boolean;
}) {
  const lineLimit = Math.min(100, maxPaylines(draft.grid.columns, draft.grid.rows));
  return <details className="creation-panel group overflow-hidden rounded-xl border border-white/[0.08]">
    <summary className="focus-ring flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] font-medium text-ink-300 hover:text-ink-100">
      <span className="flex items-center gap-2"><Icon name="settings" size={15} />Advanced configuration</span>
      <Icon name="chevron-down" size={14} className="transition group-open:rotate-180" />
    </summary>
    <div className="grid gap-4 border-t border-white/[0.06] p-4 sm:grid-cols-2">
      <Field label="Evaluation"><Select aria-label="Evaluation" className="creation-input" value={draft.evaluation}
        onChange={(event) => patch({ evaluation: event.target.value as NewGameDraft["evaluation"] })}>
        <option value="lines">Paylines</option><option value="ways">Ways</option><option value="cluster">Cluster</option>
      </Select></Field>
      <Field label="Paylines" hint={draft.evaluation === "lines" ? `1–${lineLimit} distinct lines` : "Not used for this evaluation"}>
        <NumberField label="Paylines" min={1} max={lineLimit} value={draft.paylineCount} disabled={draft.evaluation !== "lines"}
          onChange={(paylineCount) => patch({ paylineCount }, "paylines")} /><FieldError message={showErrors ? errors.paylines : undefined} />
      </Field>
      <Field label="RTP target (%)"><NumberField label="RTP target" min={80} max={99} step={0.1} value={draft.rtpTarget}
        onChange={(rtpTarget) => patch({ rtpTarget }, "rtp")} /><FieldError message={showErrors ? errors.rtp : undefined} /></Field>
      <Field label="Volatility"><Select aria-label="Volatility" className="creation-input" value={draft.volatility}
        onChange={(event) => patch({ volatility: event.target.value as NewGameDraft["volatility"] })}>
        <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="extreme">Extreme</option>
      </Select></Field>
      <Field label="Initial status"><Select aria-label="Initial status" className="creation-input" value={draft.status}
        onChange={(event) => patch({ status: event.target.value as NewGameDraft["status"] })}>
        {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </Select></Field>
      <p className="text-[10.5px] leading-relaxed text-ink-300/70 sm:col-span-2">Math values are configuration targets, not verified results. Evaluation and game execution belong to the backend engine.</p>
    </div>
  </details>;
}
