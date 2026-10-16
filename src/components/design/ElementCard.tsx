"use client";

import { elementTypeMeta } from "@/lib/blueprint/elements";
import type { ElementDef, StylePalette } from "@/lib/blueprint/types";
import { standaloneStatus } from "@/lib/design/selectors";
import type { DesignDoc } from "@/lib/design/types";
import type { DesignActions } from "./actions";
import { StatusBadge, TypeBadge } from "./Badges";
import { QuickActions } from "./QuickActions";
import { ElementThumb } from "./Thumb";

interface Props {
  element: ElementDef;
  doc: DesignDoc;
  palette: StylePalette;
  title: string;
  selected: boolean;
  actions: DesignActions;
  mode: "grid" | "list";
}

/** The select target is a sibling overlay button, so interactive controls are never nested. */
export function ElementCard({ element, doc, palette, title, selected, actions, mode }: Props) {
  const status = standaloneStatus(doc, element);
  const select = () => actions.select({ kind: "element", id: element.id });
  const overlay = (
    <button type="button" data-select-target className="focus-ring absolute inset-0 z-0 rounded-[inherit]" aria-label={`Select ${element.name}`} aria-pressed={selected}
      onClick={select} onDoubleClick={() => actions.open(element.id)} />
  );

  if (mode === "list") {
    return (
      <article data-element-id={element.id} aria-label={element.name}
        className={`group relative flex items-center gap-3 rounded-lg border px-2.5 py-2 transition ${selected ? "border-accent-500/60 bg-accent-500/[0.06]" : "border-white/[0.07] bg-ink-900 hover:border-white/20"}`}>
        {overlay}
        <ElementThumb doc={doc} element={element} palette={palette} title={title} className="pointer-events-none h-11 w-16 shrink-0 rounded-md border border-white/10" />
        <div className="pointer-events-none min-w-0 flex-1">
          <div className="truncate text-[12.5px] font-medium text-ink-100">{element.name}</div>
          <div className="mt-0.5 flex items-center gap-1.5"><TypeBadge element={element} /></div>
        </div>
        <div className="pointer-events-none hidden sm:block"><StatusBadge status={status} /></div>
        <div className="relative z-10"><QuickActions element={element} doc={doc} actions={actions} show={selected} /></div>
      </article>
    );
  }

  return (
    <article data-element-id={element.id} aria-label={element.name}
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-ink-900 transition ${selected ? "border-accent-500/70 shadow-lg shadow-accent-600/10" : "border-white/[0.07] hover:border-white/25"}`}>
      {overlay}
      <div className="pointer-events-none relative aspect-[5/4]">
        <ElementThumb doc={doc} element={element} palette={palette} title={title} className="absolute inset-0" />
        <div className="absolute bottom-2 left-2 max-w-[calc(100%-1rem)]"><TypeBadge element={element} /></div>
      </div>
      <div className="pointer-events-none flex items-center justify-between gap-2 border-t border-white/[0.06] px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-medium text-ink-100">{element.name}</div>
          <div className="truncate text-[10px] text-ink-400">{elementTypeMeta(element.type).label}</div>
        </div>
        <StatusBadge status={status} />
      </div>
      <div className="pointer-events-none absolute top-1.5 right-1.5 left-1.5 z-10 flex justify-end"><div className="pointer-events-auto max-w-full"><QuickActions element={element} doc={doc} actions={actions} show={selected} compact /></div></div>
    </article>
  );
}
