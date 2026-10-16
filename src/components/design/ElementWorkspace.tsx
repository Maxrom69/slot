"use client";

import type { CSSProperties, Ref } from "react";
import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import type { ElementDef, ElementType, StylePalette } from "@/lib/blueprint/types";
import { STANDALONE_FILTERS, type SetView, type StandaloneFilter } from "@/lib/design/selectors";
import type { DesignDoc, Selection } from "@/lib/design/types";
import type { DesignActions } from "./actions";
import { ElementCard } from "./ElementCard";
import { SymbolSetGroup } from "./SymbolSetGroup";

interface Props {
  doc: DesignDoc;
  palette: StylePalette;
  title: string;
  sets: SetView[];
  standalone: ElementDef[];
  totals: { sets: number; standalone: number };
  selection: Selection;
  collapsed: Set<string>;
  zoom: number;
  mode: "grid" | "list";
  query: string;
  filter: StandaloneFilter;
  searchRef: Ref<HTMLInputElement>;
  actions: DesignActions;
  onQuery: (value: string) => void;
  onFilter: (value: StandaloneFilter) => void;
  onToggleSet: (id: string) => void;
  onSetAll: (expanded: boolean) => void;
  onAdd: (type?: ElementType) => void;
  onImport: () => void;
}

/** Center workspace: the two organising sections, "Symbol Sets" and "Standalone Elements". */
export function ElementWorkspace({
  doc,
  palette,
  title,
  sets,
  standalone,
  totals,
  selection,
  collapsed,
  zoom,
  mode,
  query,
  filter,
  searchRef,
  actions,
  onQuery,
  onFilter,
  onToggleSet,
  onSetAll,
  onAdd,
  onImport,
}: Props) {
  const filtering = query.trim().length > 0 || filter !== "all";
  const counts = new Map<string, number>();
  doc.elements.forEach((e) => counts.set(e.type, (counts.get(e.type) ?? 0) + 1));
  const empty = totals.sets + totals.standalone === 0;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6" style={{ "--tile": `${zoom}px` } as CSSProperties}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-semibold tracking-tight text-ink-100">Game elements</h2>
          <p className="mt-0.5 text-[11px] text-ink-400">{totals.sets} symbol sets · {totals.standalone} standalone elements · {doc.symbols.length} symbols</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Icon name="search" size={14} className="pointer-events-none absolute top-2.5 left-2.5 text-ink-400" />
          <input ref={searchRef} type="search" value={query} onChange={(e) => onQuery(e.target.value)} aria-label="Search elements" placeholder="Search elements and symbols   /"
            className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/70 py-1.5 pr-3 pl-8 text-[12px] text-ink-100 placeholder:text-ink-400/70 hover:border-white/20 focus:border-accent-500" />
        </div>
      </div>

      {empty ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-white/10 bg-ink-900/40 px-6 py-16 text-center">
          <div className="max-w-sm">
            <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-lg border border-white/10 bg-ink-850 text-ink-300"><Icon name="layers" size={20} /></div>
            <h3 className="text-[13px] font-semibold text-ink-100">This project has no elements</h3>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400">Add a symbol set, a title, a background or any other element — or import your own artwork.</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={onImport}><Icon name="upload" size={13} />Import artwork</Button>
              <Button variant="primary" onClick={() => onAdd()}><Icon name="plus" size={13} />Add element</Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <section aria-labelledby="sets-heading" className="mb-8">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <h3 id="sets-heading" className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.16em] text-ink-300 uppercase">
                Symbol Sets <span className="rounded border border-white/10 px-1.5 py-px font-mono text-[9.5px] text-ink-400">{totals.sets}</span>
              </h3>
              <div className="flex items-center gap-1">
                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onSetAll(true)} disabled={sets.length === 0}><Icon name="expand" size={13} />Expand all</Button>
                <Button variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onSetAll(false)} disabled={sets.length === 0}><Icon name="collapse" size={13} />Collapse all</Button>
                <Button className="h-7 px-2.5 text-[11px]" onClick={() => onAdd("symbol_set")}><Icon name="plus" size={13} />New set</Button>
              </div>
            </div>
            {sets.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-[11.5px] text-ink-400">
                {filtering ? "No symbol sets match your search." : "No symbol sets yet. Create one to group royals, premium or custom symbols."}
              </p>
            ) : (
              <div className="space-y-2.5">
                {sets.map((view) => (
                  <SymbolSetGroup key={view.element.id} view={view} doc={doc} palette={palette} expanded={!collapsed.has(view.element.id)}
                    selection={selection} actions={actions} onToggle={() => onToggleSet(view.element.id)} />
                ))}
              </div>
            )}
          </section>

          <section aria-labelledby="standalone-heading">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <h3 id="standalone-heading" className="flex items-center gap-2 text-[10.5px] font-semibold tracking-[0.16em] text-ink-300 uppercase">
                Standalone Elements <span className="rounded border border-white/10 px-1.5 py-px font-mono text-[9.5px] text-ink-400">{totals.standalone}</span>
              </h3>
              <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter standalone elements">
                {STANDALONE_FILTERS.filter((f) => f.id === "all" || counts.has(f.id)).map((f) => (
                  <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => onFilter(f.id)}
                    className={`focus-ring rounded-full border px-2.5 py-1 text-[10.5px] transition ${filter === f.id ? "border-accent-500/50 bg-accent-500/10 text-blue-200" : "border-white/10 text-ink-300 hover:text-ink-100"}`}>
                    {f.label}
                  </button>
                ))}
                <Button className="ml-1 h-7 px-2.5 text-[11px]" onClick={() => onAdd()}><Icon name="plus" size={13} />Add element</Button>
              </div>
            </div>
            {standalone.length === 0 ? (
              <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-[11.5px] text-ink-400">
                {filtering ? "No standalone elements match your search or filter." : "No standalone elements yet."}
              </p>
            ) : (
              <div className={mode === "grid" ? "grid gap-3" : "grid gap-2"}
                style={mode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(var(--tile), 1fr))" } : undefined}>
                {standalone.map((element) => (
                  <ElementCard key={element.id} element={element} doc={doc} palette={palette} title={title} mode={mode}
                    selected={selection?.kind === "element" && selection.id === element.id} actions={actions} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
