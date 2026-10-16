"use client";

import { Icon } from "@/components/ui/Icon";
import type { StylePalette } from "@/lib/blueprint/types";
import type { SetView } from "@/lib/design/selectors";
import type { DesignDoc, Selection } from "@/lib/design/types";
import type { DesignActions } from "./actions";
import { SetTypeBadge, StatusBadge, TierBadge } from "./Badges";
import { QuickActions } from "./QuickActions";
import { SymbolThumb } from "./Thumb";

interface Props {
  view: SetView;
  doc: DesignDoc;
  palette: StylePalette;
  expanded: boolean;
  selection: Selection;
  actions: DesignActions;
  onToggle: () => void;
}

/** One expandable symbol set: header summary (type, tier, status, count, thumbnails) + symbol tiles. */
export function SymbolSetGroup({ view, doc, palette, expanded, selection, actions, onToggle }: Props) {
  const { element, symbols, status } = view;
  const meta = element.symbolSet ?? { symbolType: "custom" as const, valueTier: "medium" as const };
  const selectedSet = selection?.kind === "element" && selection.id === element.id;
  const bodyId = `set-body-${element.id}`;

  return (
    <section data-element-id={element.id} aria-label={`${element.name} symbol set`}
      className={`overflow-hidden rounded-xl border bg-ink-900 transition ${selectedSet ? "border-accent-500/60" : "border-white/[0.07]"}`}>
      <div className={`group relative flex flex-wrap items-center gap-2 px-2.5 py-2.5 ${selectedSet ? "bg-accent-500/[0.05]" : "hover:bg-white/[0.02]"}`}>
        <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={bodyId}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${element.name}`}
          className="focus-ring grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-300 transition hover:bg-white/5 hover:text-ink-100">
          <Icon name="chevron-right" size={15} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>

        <button type="button" onClick={() => actions.select({ kind: "element", id: element.id })} onDoubleClick={() => actions.open(element.id)}
          aria-pressed={selectedSet} aria-label={`Select ${element.name}`} data-select-target
          className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-lg px-1 py-0.5 text-left">
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-ink-100">{element.name}</span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5">
              <SetTypeBadge type={meta.symbolType} />
              <TierBadge tier={meta.valueTier} />
              <StatusBadge status={status} />
              <span className="font-mono text-[10px] text-ink-300" aria-label={`${symbols.length} symbols`}>{symbols.length} {symbols.length === 1 ? "symbol" : "symbols"}</span>
            </span>
          </span>
          {!expanded ? (
            <span className="ml-auto hidden items-center gap-1 pr-2 2xl:flex" aria-hidden>
              {symbols.slice(0, 7).map((symbol) => <SymbolThumb key={symbol.id} doc={doc} symbol={symbol} palette={palette} className="h-8 w-8 rounded-md" />)}
              {symbols.length > 7 ? <span className="pl-1 font-mono text-[10px] text-ink-400">+{symbols.length - 7}</span> : null}
            </span>
          ) : null}
        </button>

        <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => actions.manageSet(element.id)}
            aria-label={`Manage ${element.name} symbol set`} title="Open symbol set manager"
            className="focus-ring hidden items-center gap-1.5 rounded-md border border-white/10 bg-ink-950/60 px-2 py-1 text-[11px] text-ink-200 transition hover:border-white/25 hover:text-ink-100 md:inline-flex group-hover:flex">
            <Icon name="settings" size={13} />Manage set
          </button>
          <QuickActions element={element} doc={doc} actions={actions} show={selectedSet} />
        </div>
      </div>

      {expanded ? (
        <div id={bodyId} className="border-t border-white/[0.06] p-3">
          <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(max(76px, calc(var(--tile) * 0.55)), 1fr))" }}>
            {symbols.map((symbol) => {
              const picked = selection?.kind === "symbol" && selection.id === symbol.id;
              const vCount = (symbol.variants ?? []).length;
              return (
                <button key={symbol.id} type="button" data-select-target data-symbol-id={symbol.id} aria-pressed={picked} aria-label={`Symbol ${symbol.name}`}
                  onClick={() => actions.select({ kind: "symbol", id: symbol.id, elementId: element.id })}
                  onDoubleClick={() => actions.open(element.id)}
                  className={`focus-ring rounded-lg border p-1.5 text-left transition ${picked ? "border-accent-500/70 bg-accent-500/[0.07]" : "border-white/[0.06] bg-ink-950/40 hover:border-white/20"}`}>
                  <div className="relative">
                    <SymbolThumb doc={doc} symbol={symbol} palette={palette} className="aspect-square w-full rounded-md" />
                    {symbol.isWild || symbol.isScatter ? (
                      <span className="absolute right-0.5 top-0.5 flex gap-0.5">
                        {symbol.isWild ? <span className="rounded bg-accent-500/85 px-1 py-px text-[8px] font-semibold uppercase text-white">W</span> : null}
                        {symbol.isScatter ? <span className="rounded bg-emerald-500/85 px-1 py-px text-[8px] font-semibold uppercase text-white">S</span> : null}
                      </span>
                    ) : null}
                  </div>
                  <span className="mt-1.5 block truncate text-[10.5px] text-ink-200">{symbol.name}</span>
                  <span className="flex items-center justify-between gap-1 font-mono text-[9px] text-ink-400">
                    <span>{symbol.code}</span>
                    {vCount > 0 ? <span title={`${vCount} variants`}>{vCount}v</span> : null}
                  </span>
                </button>
              );
            })}
            <button type="button" onClick={() => actions.addSymbol(element.id)} aria-label={`Add a symbol to ${element.name}`}
              className="focus-ring grid aspect-square min-h-[76px] place-items-center rounded-lg border border-dashed border-white/15 text-ink-300 transition hover:border-white/30 hover:text-ink-100">
              <span className="grid justify-items-center gap-1 text-[10px]"><Icon name="plus" size={16} />Add symbol</span>
            </button>
          </div>
          {symbols.length === 0 ? <p className="mt-3 text-[11px] text-ink-400">This set is empty. Add a symbol, or open the set to import images.</p> : null}
        </div>
      ) : null}
    </section>
  );
}
