"use client";

import { Icon } from "@/components/ui/Icon";
import { GRID_LIMITS, GRID_PRESETS, type DraftValidation, type GridPresetId, type NewGameDraft } from "@/lib/creation/draft";
import { FieldError, SectionCard, Stepper } from "./fields";

export function GridPanel({ draft, errors, showErrors, patch }: {
  draft: NewGameDraft; errors: DraftValidation["errors"]; showErrors: boolean;
  patch: (partial: Partial<NewGameDraft>, key?: string) => void;
}) {
  const { columns, rows, preset } = draft.grid;
  const choosePreset = (id: GridPresetId) => {
    const found = GRID_PRESETS.find((p) => p.id === id);
    patch({ grid: found ? { preset: found.id, columns: found.columns, rows: found.rows } : { preset: "custom", columns, rows } });
  };
  return <SectionCard title="Grid & reels" icon="reels" number="03">
    <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Grid presets">
      {GRID_PRESETS.map((item) => <button key={item.id} type="button" aria-pressed={preset === item.id}
        onClick={() => choosePreset(item.id)} className={`focus-ring grid gap-1.5 rounded-lg border px-1 py-2 text-[10px] transition ${preset === item.id ? "border-accent-500/50 bg-accent-500/10 text-blue-200" : "border-white/10 bg-white/[0.015] text-ink-300 hover:border-white/25"}`}>
        <span className="mx-auto grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${item.columns}, 3px)` }} aria-hidden>
          {Array.from({ length: item.columns * item.rows }, (_, index) => <span key={index} className="h-[3px] w-[3px] rounded-[0.5px] bg-current opacity-70" />)}
        </span><span>{item.label}</span>
      </button>)}
      <button type="button" aria-pressed={preset === "custom"} onClick={() => choosePreset("custom")}
        className={`focus-ring grid place-items-center gap-1.5 rounded-lg border px-1 py-2 text-[10px] transition ${preset === "custom" ? "border-accent-500/50 bg-accent-500/10 text-blue-200" : "border-white/10 bg-white/[0.015] text-ink-300 hover:border-white/25"}`}>
        <Icon name="settings" size={15} /><span>Custom</span>
      </button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2.5">
      <label className="flex items-center gap-2.5 text-[11px] text-ink-300">Reels
        <Stepper label="reels" value={columns} min={GRID_LIMITS.minColumns} max={GRID_LIMITS.maxColumns}
          onChange={(value) => patch({ grid: { preset: "custom", columns: value, rows } })} />
      </label>
      <label className="flex items-center gap-2.5 text-[11px] text-ink-300">Rows
        <Stepper label="rows" value={rows} min={GRID_LIMITS.minRows} max={GRID_LIMITS.maxRows}
          onChange={(value) => patch({ grid: { preset: "custom", columns, rows: value } })} />
      </label>
    </div>
    <FieldError message={showErrors ? errors.grid : undefined} />
    <div className="flex items-center justify-between border-t border-white/[0.06] pt-2.5 text-[10px] text-ink-300/65">
      <span>3–8 reels · 2–6 rows</span><span className="font-mono text-ink-300">{columns * rows} symbol positions</span>
    </div>
  </SectionCard>;
}
