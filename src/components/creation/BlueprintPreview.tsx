"use client";

import type { GameBlueprint } from "@/lib/blueprint/types";
import { Icon } from "@/components/ui/Icon";

/** A deterministic composition diagram, not an engine or a simulated spin. */
export function BlueprintPreview({ blueprint }: { blueprint: GameBlueprint }) {
  const { columns, rows } = blueprint.reels;
  const palette = blueprint.style.palette;
  const background = blueprint.assets.find((a) => a.id === blueprint.canvas.backgroundAssetId)?.uri;
  const titleEnabled = blueprint.elements.some((el) => el.type === "game_title");
  const frame = blueprint.elements.find((el) => el.type === "reel_frame");
  const symbols = blueprint.symbols;
  return <section className="creation-panel overflow-hidden rounded-xl border border-white/[0.08]">
    <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
      <span className="flex items-center gap-2 text-[11.5px] font-medium text-ink-200"><Icon name="grid" size={14} />Layout preview</span>
      <span className="text-[9px] tracking-wider text-ink-400 uppercase">Static</span>
    </div>
    <div className="blueprint-stage relative overflow-hidden px-5 pt-4 pb-5" style={{ backgroundColor: palette.background }}>
      {background ? <div className="absolute inset-0 bg-cover bg-center opacity-25" style={{ backgroundImage: `url(${background})` }} /> : null}
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at 50% 25%, ${palette.accent}18, transparent 70%)` }} />
      <div className="relative mb-3 text-center">
        <span className="mb-1 inline-flex items-center gap-1.5 text-[7px] tracking-[0.26em] uppercase" style={{ color: `${palette.glow}99` }}><span className="h-px w-6 bg-current opacity-40" />Game blueprint<span className="h-px w-6 bg-current opacity-40" /></span>
        <div className={`truncate font-serif text-[19px] font-bold tracking-wide ${titleEnabled ? "" : "opacity-40"}`} style={{ color: palette.glow }}>
          {blueprint.meta.title || "YOUR GAME"}
        </div>
      </div>
      <div className="relative mx-auto max-w-[295px]">
        <div className="mb-1 flex justify-around pl-4 font-mono text-[8px] text-ink-400" aria-hidden>{Array.from({ length: columns }, (_, c) => <span key={c}>0{c + 1}</span>)}</div>
        <div className="flex gap-1.5">
          <div className="flex w-2.5 flex-col justify-around font-mono text-[8px] text-ink-400" aria-hidden>{Array.from({ length: rows }, (_, r) => <span key={r}>{r + 1}</span>)}</div>
          <div className="grid flex-1 gap-1 rounded-lg border p-1.5" role="img" aria-label={`Static ${columns} reel by ${rows} row blueprint layout`}
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, borderColor: frame ? `${palette.accent}88` : "#273040", boxShadow: frame ? `0 0 0 3px ${palette.accent}0e, 0 8px 30px #0008` : "none", background: `${palette.background}e8` }}>
            {Array.from({ length: columns * rows }, (_, index) => {
              const symbol = symbols[(index * 3 + Math.floor(index / columns)) % Math.max(1, symbols.length)];
              return <div key={index} className="grid aspect-[1/1.12] place-items-center rounded-[4px] border border-white/[0.05]" style={{ background: `linear-gradient(150deg, ${palette.surface}, ${palette.background})` }}>
                {symbol?.tier === "low" ? <span className="font-serif text-[19px] font-bold" style={{ color: palette.glow }}>{symbol.code}</span>
                  : symbol?.tier === "special" ? <div className="flex flex-col items-center gap-0.5" style={{ color: palette.accentAlt }}><Icon name="sparkles" size={18} /><span className="text-[5px] font-semibold tracking-wider">{symbol.code}</span></div>
                    : <span style={{ color: symbol?.tier === "high" ? palette.accent : palette.accentAlt }}><Icon name={symbol?.tier === "high" ? "crown" : "diamond"} size={23} strokeWidth={1.5} /></span>}
              </div>;
            })}
          </div>
        </div>
      </div>
      <div className="relative mt-4 flex items-center justify-between border-t border-white/[0.06] pt-2.5 font-mono text-[8px] text-ink-300/70">
        <span>{columns} REELS × {rows} ROWS</span><span>{blueprint.reels.evaluation === "lines" ? `${blueprint.paylines.length} LINES` : blueprint.reels.evaluation.toUpperCase()}</span>
      </div>
    </div>
    <p className="border-t border-white/[0.06] px-4 py-2.5 text-[10px] leading-relaxed text-ink-300/60">Layout only. Artwork and engine behaviour are not generated.</p>
  </section>;
}
