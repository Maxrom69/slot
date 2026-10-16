/**
 * Lossless mapping between the Game Blueprint storage form and the F07
 * ElementLibrary domain model. Legacy fields (glyph, code, payouts,
 * reelWeight, params, assetId) are preserved on both sides so existing
 * projects round-trip unchanged.
 */

import type {
  AssetReference,
  ElementDef,
  GameBlueprint,
  SymbolDef,
  SymbolSetType,
  ValueTier,
} from "@/lib/blueprint/types";
import { projectAssetIdOf } from "./assets";
import { canonicalSymbolType, type ElementLibrary, type StandaloneElement, type Symbol, type SymbolType } from "./types";
import { SYMBOL_TYPE_TO_STORED } from "./types";

const LEGACY_SET_TYPE: Record<string, SymbolSetType> = {
  character: "character",
  royals: "royals",
  suits: "suits",
  seven: "seven",
  bar: "bar",
  custom: "custom",
};

function storedSetType(symbolType: SymbolType): SymbolSetType {
  return SYMBOL_TYPE_TO_STORED[symbolType] ?? "custom";
}

function imageFromAssetId(assetId: string | null): AssetReference | null {
  if (!assetId) return null;
  return { provider: "project", assetId };
}

function symbolFromDef(
  def: SymbolDef,
  ownerSetId: string | null,
  elementBySymbol: Map<string, ElementDef>,
): Symbol {
  const owner = elementBySymbol.get(def.id);
  const setType = (owner?.symbolSet?.symbolType ?? def.symbolType ?? "custom") as SymbolSetType;
  return {
    id: def.id,
    name: def.name,
    symbolSetId: ownerSetId,
    symbolType: canonicalSymbolType(LEGACY_SET_TYPE[setType] ?? "custom"),
    tier: def.tier === "mid" ? "medium" : def.tier === "low" ? "low" : def.tier === "high" ? "high" : "special",
    image: def.image ?? imageFromAssetId(def.assetId),
    variants: (def.variants ?? []).map((v) => ({
      id: v.id,
      name: v.name,
      image: v.image ?? null,
      extras: { ...(v.extras ?? {}) },
      tags: [...(v.tags ?? [])],
    })),
    extras: { ...(def.extras ?? {}) },
    mathId: def.mathId ?? null,
    isWild: def.isWild ?? def.tier === "special",
    isScatter: def.isScatter ?? false,
    isBonus: def.isBonus ?? false,
    family: def.family,
    imageHistory: (def.imageHistory ?? []).map((r) => ({ ...r, asset: r.asset ? { ...r.asset } : null })),
    code: def.code,
    glyph: def.glyph,
    reelWeight: def.reelWeight,
    payouts: { ...def.payouts },
    description: def.description ?? "",
    tags: [...(def.tags ?? [])],
  };
}

function standaloneFromDef(def: ElementDef): StandaloneElement | null {
  const base = {
    id: def.id,
    name: def.name,
    description: def.description || def.notes || "",
    tags: [...(def.tags ?? [])],
    image: def.image ?? imageFromAssetId(def.assetId),
    ...(def.imageHistory !== undefined
      ? { imageHistory: def.imageHistory.map((r) => ({ ...r, asset: r.asset ? { ...r.asset } : null })) }
      : {}),
    ...(def.variants !== undefined
      ? { variants: def.variants.map((v) => ({ ...v, image: v.image ? { ...v.image } : null, extras: { ...v.extras }, tags: [...(v.tags ?? [])] })) }
      : {}),
    ...(def.extras !== undefined ? { extras: { ...def.extras } } : {}),
    ...(def.style !== undefined ? { styleConfig: { ...def.style } } : {}),
    ...(def.animation !== undefined ? { animation: { ...def.animation } } : {}),
  };
  switch (def.type) {
    case "game_title":
      return { ...base, kind: "game-title" as const };
    case "game_background":
      return { ...base, kind: "game-background" as const, aspect: String(def.params.aspect ?? "16:9") };
    case "reel_frame":
      return { ...base, kind: "reel-frame" as const, style: String(def.params.style ?? "Themed") };
    case "button_set": {
      const buttons = String(def.params.buttons ?? "spin").split(",").filter(Boolean);
      return { ...base, kind: "button-set" as const, buttons: buttons.length ? buttons : ["spin"] };
    }
    case "uploaded":
    case "other_asset":
      return { ...base, kind: "uploaded" as const, group: def.group || "Uploaded art" };
    case "custom":
      return { ...base, kind: "custom" as const, group: def.group || "Other", params: { ...def.params } };
    default:
      return null;
  }
}

/** Blueprint storage -> canonical library. Never throws; unknown shapes are skipped. */
export function libraryFromBlueprint(bp: Pick<GameBlueprint, "elements" | "symbols">): ElementLibrary {
  const elementBySymbol = new Map<string, ElementDef>();
  for (const el of bp.elements ?? []) {
    if (el.type === "symbol_set" || el.type === "symbol") {
      for (const sid of el.symbolIds) if (!elementBySymbol.has(sid)) elementBySymbol.set(sid, el);
    }
  }
  const sets = (bp.elements ?? [])
    .filter((el) => el.type === "symbol_set")
    .map((el) => ({
      id: el.id,
      kind: "symbol-set" as const,
      name: el.name,
      description: el.symbolSet?.description || el.description || el.notes || "",
      tags: [...(el.symbolSet?.tags ?? el.tags ?? [])],
      image: null,
      symbolType: canonicalSymbolType((el.symbolSet?.symbolType ?? "custom") as SymbolSetType),
      valueTier: (el.symbolSet?.valueTier ?? "medium") as ValueTier,
      frame: el.symbolSet?.frame ?? null,
      background: el.symbolSet?.background ?? null,
      symbols: [...el.symbolIds],
      styleGuide: el.symbolSet?.styleGuide ?? "",
    }));
  const setIds = new Map<string, string>();
  for (const el of bp.elements ?? []) {
    if (el.type !== "symbol_set") continue;
    for (const sid of el.symbolIds) if (!setIds.has(sid)) setIds.set(sid, el.id);
  }
  const symbols = (bp.symbols ?? []).map((s) => symbolFromDef(s, setIds.get(s.id) ?? null, elementBySymbol));
  const standalone = (bp.elements ?? [])
    .map(standaloneFromDef)
    .filter((s): s is StandaloneElement => s !== null);
  return { sets, symbols, standalone };
}

/** Writes library state back onto blueprint symbol/element defs, preserving legacy fields. */
export function applyLibraryToSymbols(
  symbols: SymbolDef[],
  lib: ElementLibrary,
): SymbolDef[] {
  const byId = new Map(symbols.map((s) => [s.id, s]));
  return lib.symbols.map((s) => {
    const def = byId.get(s.id);
    const tier = s.tier === "medium" ? "mid" : s.tier;
    return {
      ...(def ?? {
        id: s.id,
        code: s.code,
        name: s.name,
        tier,
        glyph: s.glyph,
        assetId: projectAssetIdOf(s.image),
        payouts: { ...s.payouts },
        reelWeight: s.reelWeight,
      }),
      name: s.name,
      tier,
      code: s.code,
      glyph: s.glyph,
      reelWeight: s.reelWeight,
      payouts: { ...s.payouts },
      symbolSetId: s.symbolSetId,
      symbolType: storedSetType(s.symbolType),
      image: s.image,
      assetId: s.image?.provider === "project" ? (projectAssetIdOf(s.image) ?? null) : (def?.assetId ?? null),
      variants: s.variants.map((v) => ({ id: v.id, name: v.name, image: v.image, extras: { ...v.extras }, tags: [...(v.tags ?? [])] })),
      extras: { ...s.extras },
      mathId: s.mathId,
      isWild: s.isWild,
      isScatter: s.isScatter,
      isBonus: s.isBonus ?? def?.isBonus ?? false,
      ...(s.family !== undefined ? { family: s.family } : def?.family ? { family: def.family } : {}),
      ...(s.imageHistory !== undefined ? { imageHistory: s.imageHistory.map((r) => ({ ...r, asset: r.asset ? { ...r.asset } : null })) } : def?.imageHistory ? { imageHistory: def.imageHistory } : {}),
      description: s.description,
      tags: [...s.tags],
    };
  });
}

/** Writes ElementLibrary sets and standalone elements back onto ElementDef[], preserving existing fields. */
export function applyLibraryToElements(
  existing: ElementDef[],
  lib: ElementLibrary,
): ElementDef[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const setElements: ElementDef[] = lib.sets.map((s) => {
    const prev = byId.get(s.id);
    const symbolType = prev?.symbolSet?.symbolType && canonicalSymbolType(prev.symbolSet.symbolType) === s.symbolType
      ? prev.symbolSet.symbolType
      : storedSetType(s.symbolType);
    return {
      id: s.id,
      type: "symbol_set",
      name: s.name,
      group: prev?.group || (symbolType === "character" ? "Character" : symbolType === "royals" ? "Royals" : symbolType === "suits" ? "Suits" : "Custom"),
      assetId: null,
      image: null,
      symbolIds: [...s.symbols],
      notes: s.description || prev?.notes || "",
      description: s.description,
      tags: [...s.tags],
      origin: prev?.origin ?? "planned",
      params: { ...(prev?.params ?? {}) },
      symbolSet: {
        symbolType,
        valueTier: s.valueTier,
        frame: s.frame,
        background: s.background,
        styleGuide: s.styleGuide,
        description: s.description,
        tags: [...s.tags],
      },
    };
  });

  const standaloneSymbols: ElementDef[] = lib.symbols
    .filter((s) => s.symbolSetId === null)
    .map((s) => {
      const prev = existing.find((e) => e.type === "symbol" && e.symbolIds.includes(s.id));
      return {
        id: prev?.id ?? `el-sym-${s.id}`,
        type: "symbol",
        name: s.name,
        group: prev?.group || (s.tier === "special" ? "Special" : "Symbol"),
        assetId: null,
        image: null,
        symbolIds: [s.id],
        notes: s.description || prev?.notes || "",
        description: s.description,
        tags: [...s.tags],
        origin: s.image ? "imported" : (prev?.origin ?? "planned"),
        params: { ...(prev?.params ?? {}) },
      };
    });

  const standaloneElements: ElementDef[] = lib.standalone.map((el) => {
    const prev = byId.get(el.id);
    const assetId = projectAssetIdOf(el.image);
    const base: ElementDef = {
      id: el.id,
      type: el.kind === "game-title" ? "game_title"
        : el.kind === "game-background" ? "game_background"
        : el.kind === "reel-frame" ? "reel_frame"
        : el.kind === "button-set" ? "button_set"
        : el.kind === "uploaded" ? (prev?.type === "other_asset" ? "other_asset" : "uploaded")
        : "custom",
      name: el.name,
      group: prev?.group || (
        el.kind === "game-title" ? "Branding"
        : el.kind === "game-background" ? "Backgrounds"
        : el.kind === "reel-frame" ? "Frames"
        : el.kind === "button-set" ? "Controls"
        : el.group
      ),
      assetId,
      image: el.image,
      symbolIds: [],
      notes: el.description || prev?.notes || "",
      description: el.description,
      tags: [...el.tags],
      origin: el.image ? "imported" : (prev?.origin ?? "planned"),
      params: { ...(prev?.params ?? {}) },
      ...(el.imageHistory !== undefined ? { imageHistory: el.imageHistory.map((r) => ({ ...r, asset: r.asset ? { ...r.asset } : null })) } : prev?.imageHistory ? { imageHistory: prev.imageHistory } : {}),
      ...(el.variants !== undefined ? { variants: el.variants.map((v) => ({ ...v, image: v.image ? { ...v.image } : null, extras: { ...v.extras }, tags: [...(v.tags ?? [])] })) } : prev?.variants ? { variants: prev.variants } : {}),
      ...(el.extras !== undefined ? { extras: { ...el.extras } } : prev?.extras ? { extras: prev.extras } : {}),
      ...(el.styleConfig !== undefined ? { style: { ...el.styleConfig } } : prev?.style ? { style: prev.style } : {}),
      ...(el.animation !== undefined ? { animation: { ...el.animation } } : prev?.animation ? { animation: prev.animation } : {}),
    };
    if (el.kind === "game-background") base.params = { ...base.params, aspect: el.aspect };
    if (el.kind === "reel-frame") base.params = { ...base.params, style: el.style };
    if (el.kind === "button-set") base.params = { ...base.params, buttons: el.buttons.join(","), count: el.buttons.length };
    if (el.kind === "custom") base.params = { ...el.params };
    return base;
  });

  return [...setElements, ...standaloneSymbols, ...standaloneElements];
}

/** Applies an ElementLibrary back onto a GameBlueprint and syncs symbolSets. */
export function applyLibraryToBlueprint(bp: GameBlueprint, lib: ElementLibrary): GameBlueprint {
  const symbols = applyLibraryToSymbols(bp.symbols, lib);
  const elements = applyLibraryToElements(bp.elements, lib);
  const symbolSets: GameBlueprint["symbolSets"] = lib.sets.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    symbolIds: [...s.symbols],
    symbolType: storedSetType(s.symbolType),
    valueTier: s.valueTier,
    frame: s.frame,
    background: s.background,
    styleGuide: s.styleGuide,
    tags: [...s.tags],
  }));
  return {
    ...bp,
    symbols,
    elements,
    symbolSets,
  };
}
