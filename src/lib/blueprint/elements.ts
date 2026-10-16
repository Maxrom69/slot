import type { ElementDef, ElementType, GameBlueprint } from "./types";

export interface ElementTypeMeta {
  id: ElementType;
  label: string;
  description: string;
  /** tailwind classes for the category badge */
  tone: string;
}

export const ELEMENT_TYPES: ElementTypeMeta[] = [
  {
    id: "symbol_set",
    label: "Symbol Set",
    description: "A themed group of related symbols (royals, premium, specials).",
    tone: "bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/30",
  },
  {
    id: "symbol",
    label: "Standalone Symbol",
    description: "A standalone symbol outside of a set.",
    tone: "bg-amber-500/20 text-amber-200 border-amber-400/30",
  },
  {
    id: "game_title",
    label: "Game Title",
    description: "Logo / title lockup shown on the splash and in the frame.",
    tone: "bg-sky-500/20 text-sky-200 border-sky-400/30",
  },
  {
    id: "reel_frame",
    label: "Reel Frame",
    description: "Frame that surrounds the reel window.",
    tone: "bg-teal-500/20 text-teal-200 border-teal-400/30",
  },
  {
    id: "game_background",
    label: "Game Background",
    description: "Full-canvas background for a scene.",
    tone: "bg-emerald-500/20 text-emerald-200 border-emerald-400/30",
  },
  {
    id: "button_set",
    label: "Button Set",
    description: "Spin, bet and utility controls.",
    tone: "bg-rose-500/20 text-rose-200 border-rose-400/30",
  },
  {
    id: "uploaded",
    label: "Uploaded Element",
    description: "Artwork you imported, with editable metadata and image.",
    tone: "bg-slate-500/25 text-slate-200 border-slate-400/30",
  },
  {
    id: "custom",
    label: "Custom Element",
    description: "A free-form custom element with its own parameters.",
    tone: "bg-zinc-500/25 text-zinc-200 border-zinc-400/30",
  },
  {
    id: "other_asset",
    label: "Other / Uploaded Asset",
    description: "Legacy alias of Uploaded Element, kept for older blueprints.",
    tone: "bg-slate-500/25 text-slate-200 border-slate-400/30",
  },
];

export function elementTypeMeta(type: ElementType): ElementTypeMeta {
  return ELEMENT_TYPES.find((t) => t.id === type) ?? ELEMENT_TYPES[ELEMENT_TYPES.length - 1];
}

/**
 * Derives the element list for blueprints that predate the element model
 * (e.g. the F02 demo projects) so every project opens in the Design workspace.
 */
export function deriveElements(
  bp: Pick<GameBlueprint, "symbols" | "symbolSets" | "specialSymbols" | "assets">,
): ElementDef[] {
  const asset = (id: string) => bp.assets.find((a) => a.id === id) ?? null;
  const base = (
    id: string,
    type: ElementType,
    name: string,
    group: string,
    assetId: string | null,
  ): ElementDef => ({
    id,
    type,
    name,
    group,
    assetId: assetId && asset(assetId) ? assetId : null,
    symbolIds: [],
    notes: "",
    origin: assetId && asset(assetId)?.state === "linked" ? "imported" : "planned",
    params: {},
    description: "",
    tags: [],
    image: assetId && asset(assetId) ? { provider: "project", assetId } : null,
  });

  const elements: ElementDef[] = [
    base("el-game-title", "game_title", "Game Title", "Branding", "asset-logo"),
    base("el-background-1", "game_background", "Game Background 1", "Backgrounds", "asset-bg"),
    base("el-reel-frame-1", "reel_frame", "Reel Frame 1", "Frames", "asset-frame"),
    {
      ...base("el-button-set", "button_set", "Button Set", "Controls", null),
      params: { buttons: "spin" },
    },
  ];

  bp.symbolSets.forEach((set) => {
    elements.push({
      ...base(`el-set-${set.id}`, "symbol_set", set.name, set.name, null),
      symbolIds: set.symbolIds,
      notes: set.description,
    });
  });
  bp.specialSymbols.forEach((special) => {
    const symbol = bp.symbols.find((s) => s.id === special.symbolId);
    if (!symbol) return;
    elements.push({
      ...base(`el-special-${special.id}`, "symbol", symbol.name, "Special", null),
      symbolIds: [symbol.id],
      notes: `Behaviour: ${special.behaviour}`,
    });
  });
  return elements;
}
