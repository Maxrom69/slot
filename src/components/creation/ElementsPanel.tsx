"use client";

import { Icon } from "@/components/ui/Icon";
import { ASPECTS, BUTTONS, FRAME_STYLES, specialsForCount, totalSymbols, type ButtonId, type DraftValidation, type NewGameDraft, type SpecialKind } from "@/lib/creation/draft";
import { Chip, FieldError, Row, SectionCard, Stepper, Toggle } from "./fields";

const SPECIALS: { id: SpecialKind; label: string; hint: string }[] = [
  { id: "wild", label: "Wild", hint: "Substitution behaviour" },
  { id: "scatter", label: "Scatter", hint: "Free-spin trigger configuration" },
  { id: "bonus", label: "Bonus", hint: "Bonus trigger configuration" },
];

export function ElementsPanel({ draft, errors, showErrors, update }: {
  draft: NewGameDraft; errors: DraftValidation["errors"]; showErrors: boolean;
  update: (updater: (draft: NewGameDraft) => NewGameDraft, key?: string) => void;
}) {
  const setSymbols = (partial: Partial<NewGameDraft["symbols"]>) => update((d) => ({ ...d, symbols: { ...d.symbols, ...partial } }));
  const setElements = (partial: Partial<NewGameDraft["elements"]>) => update((d) => ({ ...d, elements: { ...d.elements, ...partial } }));
  const toggleSpecial = (kind: SpecialKind) => setSymbols({ specials: draft.symbols.specials.includes(kind) ? draft.symbols.specials.filter((s) => s !== kind) : [...draft.symbols.specials, kind] });
  const toggleButton = (id: ButtonId) => setElements({ buttons: draft.elements.buttons.includes(id) ? draft.elements.buttons.filter((b) => b !== id) : [...draft.elements.buttons, id] });

  return <div className="space-y-4">
    <SectionCard title="Symbol configuration" icon="diamond"
      aside={<span className="rounded-md border border-white/10 bg-white/[0.025] px-1.5 py-0.5 font-mono text-[10px] text-ink-300">{totalSymbols(draft)} total</span>}>
      <Row label="High symbols" hint="Premium theme symbols" icon="crown" tone="text-amber-300/80">
        <Stepper label="high symbols" value={draft.symbols.high} min={0} max={6} onChange={(high) => setSymbols({ high })} />
      </Row>
      <Row label="Medium symbols" hint="Themed mid-value symbols" icon="diamond" tone="text-sky-300/80">
        <Stepper label="medium symbols" value={draft.symbols.medium} min={0} max={6} onChange={(medium) => setSymbols({ medium })} />
      </Row>
      <Row label="Royals" hint="A · K · Q · J · 10 · 9" icon="royals" tone="text-violet-300/80">
        <Stepper label="royals" value={draft.symbols.royals} min={0} max={6} onChange={(royals) => setSymbols({ royals })} />
      </Row>
      <div className="border-t border-white/[0.06] pt-3.5">
        <Row label="Special symbols" hint="Feature-triggering symbols" icon="sparkles" tone="text-emerald-300/80">
          <Stepper label="special symbols" value={draft.symbols.specials.length} min={0} max={3}
            onChange={(count) => setSymbols({ specials: specialsForCount(draft.symbols.specials, count) })} />
        </Row>
        <div className="mt-2.5 flex flex-wrap gap-1.5 pl-[42px]">
          {SPECIALS.map((special) => <Chip key={special.id} active={draft.symbols.specials.includes(special.id)} onClick={() => toggleSpecial(special.id)} title={special.hint}>
            {draft.symbols.specials.includes(special.id) ? <Icon name="check" size={10} /> : null}{special.label}
          </Chip>)}
        </div>
      </div>
      <FieldError message={showErrors ? errors.symbols : undefined} />
    </SectionCard>

    <SectionCard title="Game elements" icon="layers" number="04">
      <Row label="Game title" hint="Logo and title lockup" icon="file">
        <Toggle label="Game title element" checked={draft.elements.gameTitle} onChange={(gameTitle) => setElements({ gameTitle })} />
      </Row>
      <div className="border-t border-white/[0.06] pt-3.5">
        <Row label="Background" hint="Scene artwork" icon="image">
          <Stepper label="backgrounds" value={draft.elements.backgrounds} min={0} max={3} onChange={(backgrounds) => setElements({ backgrounds })} />
        </Row>
        <div className="mt-2.5 flex flex-wrap gap-1 pl-[42px]" aria-label="Canvas aspect ratio">
          {ASPECTS.map((aspect) => <Chip key={aspect.id} active={draft.elements.aspect === aspect.id} onClick={() => setElements({ aspect: aspect.id })} title={aspect.hint}>{aspect.label}</Chip>)}
        </div>
      </div>
      <div className="border-t border-white/[0.06] pt-3.5">
        <Row label="Reel frame" hint="Surrounds the reel window" icon="frame">
          <Stepper label="reel frames" value={draft.elements.reelFrames} min={0} max={2} onChange={(reelFrames) => setElements({ reelFrames })} />
        </Row>
        <div className="mt-2.5 flex flex-wrap gap-1 pl-[42px]">
          {FRAME_STYLES.map((style) => <Chip key={style.id} active={draft.elements.frameStyle === style.id} disabled={draft.elements.reelFrames === 0}
            title={draft.elements.reelFrames === 0 ? "Add a reel frame to choose its style" : `${style.label} frame style`}
            onClick={() => setElements({ frameStyle: style.id })}>{style.label}</Chip>)}
        </div>
      </div>
      <div className="border-t border-white/[0.06] pt-3.5">
        <Row label="Button set" hint={`${draft.elements.buttons.length} controls planned`} icon="pointer"><span className="text-[10px] text-ink-400">Spin required</span></Row>
        <div className="mt-2.5 flex flex-wrap gap-1.5 pl-[42px]">
          {BUTTONS.map((button) => <Chip key={button.id} active={draft.elements.buttons.includes(button.id)} disabled={button.required}
            title={button.required ? "Spin is required for every project" : `Include ${button.label}`}
            onClick={() => toggleButton(button.id)}>{button.required ? <Icon name="lock" size={10} /> : null}{button.label}</Chip>)}
        </div>
      </div>
    </SectionCard>
  </div>;
}
