"use client";

import { Icon } from "@/components/ui/Icon";
import { ELEMENT_TYPES } from "@/lib/blueprint/elements";
import type { GameBlueprint } from "@/lib/blueprint/types";
import type { BlueprintValidation } from "@/lib/blueprint/validate";
import { ASPECTS, STYLE_PRESETS, totalSymbols, type DraftValidation, type NewGameDraft } from "@/lib/creation/draft";
import { STATUS_LABELS } from "@/lib/workspace/types";
import { BlueprintPreview } from "./BlueprintPreview";

export function SummaryPanel({ draft, blueprint, blueprintCheck, validation, onInspect }: {
  draft: NewGameDraft; blueprint: GameBlueprint; blueprintCheck: BlueprintValidation;
  validation: DraftValidation; onInspect: () => void;
}) {
  const aspect = ASPECTS.find((a) => a.id === draft.elements.aspect);
  const style = STYLE_PRESETS.find((p) => p.id === draft.stylePreset);
  const ready = !Object.keys(validation.errors).length && blueprintCheck.ok;
  const imported = blueprint.elements.filter((e) => e.origin === "imported").length;
  return <aside className="space-y-4">
    <BlueprintPreview blueprint={blueprint} />
    <section className="creation-panel overflow-hidden rounded-xl border border-white/[0.08]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3.5">
        <h2 className="text-[12.5px] font-semibold text-ink-100">Project summary</h2>
        <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] text-ink-300">{STATUS_LABELS[draft.status]}</span>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-3 gap-2">
          {[{ label: "Reels", value: draft.grid.columns }, { label: "Rows", value: draft.grid.rows }, { label: "Symbols", value: totalSymbols(draft) }].map((metric) =>
            <div key={metric.label} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2.5 py-2"><div className="font-mono text-[19px] font-medium tracking-tight text-ink-100">{metric.value.toString().padStart(2, "0")}</div><div className="mt-0.5 text-[9px] text-ink-300/70">{metric.label}</div></div>)}
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[10.5px]">
          <Item label="Canvas" value={aspect ? `${aspect.label} · ${aspect.width} × ${aspect.height}` : "—"} />
          <Item label="Style" value={style?.label ?? "Custom"} />
          <Item label="Pay model" value={draft.evaluation === "lines" ? `${blueprint.paylines.length} paylines` : draft.evaluation} />
          <Item label="Elements" value={`${blueprint.elements.length} total · ${imported} imported`} />
          <Item label="Destination" value={blueprint.meta.folderPath || "Your Games /"} />
        </dl>
        <div className="mt-4 flex flex-wrap gap-1">
          {ELEMENT_TYPES.filter((type) => blueprint.elements.some((e) => e.type === type.id)).map((type) => <span key={type.id} className="rounded-md border border-white/[0.07] bg-white/[0.015] px-1.5 py-0.5 text-[9px] text-ink-300/80">{type.label}</span>)}
        </div>
        <div className={`mt-4 flex items-start gap-2 rounded-lg border p-2.5 ${ready ? "border-emerald-500/15 bg-emerald-500/[0.045]" : "border-white/[0.07] bg-ink-950/20"}`}>
          <Icon name={ready ? "shield" : "info"} size={15} className={`mt-px shrink-0 ${ready ? "text-emerald-400/90" : "text-ink-400"}`} />
          <div><p className={`text-[10.5px] font-medium ${ready ? "text-emerald-200" : "text-ink-200"}`}>{ready ? "Blueprint ready to create" : "Finish your game details"}</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-ink-300/70">{ready ? "Structure checked. Opens in the Design workspace." : Object.values(validation.errors)[0] || blueprintCheck.issues[0]}</p></div>
        </div>
        {validation.warnings.length ? <ul className="mt-3 space-y-1.5 text-[10px] leading-relaxed text-amber-200/65">{validation.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
        <button type="button" onClick={onInspect} className="focus-ring mt-4 flex w-full items-center justify-between rounded-md text-[10.5px] text-ink-300 transition hover:text-ink-100"><span className="flex items-center gap-1.5"><Icon name="code" size={13} />Inspect Game Blueprint</span><Icon name="arrow-right" size={12} /></button>
      </div>
    </section>
    <p className="px-1 text-[10px] leading-relaxed text-ink-300/50">Your blueprint is editable configuration, not a playable game. Real game execution is reserved for the backend engine.</p>
  </aside>;
}
function Item({ label, value }: { label: string; value: string }) {
  return <><dt className="text-ink-300/70">{label}</dt><dd className="min-w-0 truncate text-right text-ink-200" title={value}>{value}</dd></>;
}
