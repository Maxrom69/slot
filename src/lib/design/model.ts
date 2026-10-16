import { buildPaytable, buildStrips } from "@/lib/blueprint/factory";
import type {
  AssetRef,
  ElementDef,
  ElementType,
  SymbolDef,
  SymbolSetMeta,
  SymbolSetType,
  SymbolTier,
  ValueTier,
} from "@/lib/blueprint/types";
import type { DesignDoc, SpecialKind } from "./types";

export const SET_TYPES: { id: SymbolSetType; label: string; hint: string }[] = [
  { id: "character", label: "Character", hint: "People, creatures and heroes" },
  { id: "royals", label: "Royals", hint: "A · K · Q · J · 10 · 9" },
  { id: "suits", label: "Suits", hint: "♠ ♥ ♦ ♣" },
  { id: "seven", label: "7", hint: "Lucky sevens" },
  { id: "bar", label: "BAR", hint: "Classic BAR symbols" },
  { id: "custom", label: "Custom", hint: "Anything else" },
];
export const SET_TYPE_LABELS = Object.fromEntries(SET_TYPES.map((t) => [t.id, t.label])) as Record<SymbolSetType, string>;

export const VALUE_TIERS: { id: ValueTier; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "special", label: "Special" },
];
export const VALUE_TIER_LABELS: Record<ValueTier, string> = { low: "Low", medium: "Medium", high: "High", special: "Special" };

export const tierOfValue = (value: ValueTier): SymbolTier =>
  value === "medium" ? "mid" : value === "special" ? "special" : value;
export const valueOfTier = (tier: SymbolTier): ValueTier =>
  tier === "mid" ? "medium" : tier === "low" ? "low" : tier === "high" ? "high" : "special";

export const DEFAULT_NAMES: Record<ElementType, string> = {
  symbol_set: "New Symbol Set",
  symbol: "New Symbol",
  game_title: "Game Title",
  reel_frame: "Reel Frame",
  game_background: "Game Background",
  button_set: "Button Set",
  uploaded: "Uploaded Element",
  custom: "Custom Element",
  other_asset: "Uploaded Art",
};

export const DEFAULT_SET_META: SymbolSetMeta = { symbolType: "custom", valueTier: "medium" };

export const SPECIALS: Record<
  SpecialKind,
  { name: string; code: string; glyph: string; payouts: Record<string, number>; reelWeight: number; params: Record<string, number | string | boolean> }
> = {
  wild: { name: "Wild", code: "WILD", glyph: "🃏", payouts: { "3": 25, "4": 100, "5": 500 }, reelWeight: 3, params: { substitutesScatter: false, multiplier: 1 } },
  scatter: { name: "Scatter", code: "SCAT", glyph: "✴️", payouts: { "3": 5, "4": 20, "5": 100 }, reelWeight: 2, params: { triggerCount: 3, awardsFreeSpins: 10 } },
  bonus: { name: "Bonus", code: "BONUS", glyph: "🎁", payouts: { "3": 10, "4": 40, "5": 200 }, reelWeight: 2, params: { triggerCount: 3, feature: "pick_bonus" } },
};

export function cleanName(raw: unknown, fallback: string, max = 80): string {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return text || fallback;
}

/** Returns `${prefix}-${n}` for the smallest free n and reserves it. */
export function uniqueId(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${prefix}-${n}`)) n += 1;
  const id = `${prefix}-${n}`;
  taken.add(id);
  return id;
}

export function uniqueCode(base: string, taken: Set<string>): string {
  let code = base;
  let n = 2;
  while (taken.has(code)) {
    code = `${base}-${n}`;
    n += 1;
  }
  taken.add(code);
  return code;
}

/** "Name copy", "Name copy 2", … */
export function uniqueName(base: string, taken: string[]): string {
  const root = base.replace(/\s+copy(\s+\d+)?$/i, "");
  let candidate = `${root} copy`;
  let n = 2;
  while (taken.includes(candidate)) {
    candidate = `${root} copy ${n}`;
    n += 1;
  }
  return candidate.slice(0, 80);
}

export function isLinked(asset: AssetRef | null | undefined): asset is AssetRef & { uri: string } {
  return Boolean(asset && asset.state === "linked" && asset.uri);
}

/**
 * Restores every cross-reference invariant after an edit. Pure and idempotent:
 * the client and the server run the same function, so they always agree.
 *  - each symbol has at most one owning element
 *  - references to missing symbols/assets are removed
 *  - reel strips are rebuilt only when symbols appeared or disappeared
 *  - paytable rows follow the symbols
 *  - unreferenced image assets are pruned (the style reference is protected)
 */
/** Normalizes a stored AssetReference against known project assets. */
function normalizeImageRef(
  image: SymbolDef["image"],
  assetId: string | null,
  knownAsset: (id: string | null) => string | null,
): SymbolDef["image"] {
  if (image && typeof image === "object") {
    if (image.provider === "project") {
      const resolved = knownAsset(image.assetId ?? assetId);
      if (!resolved) return null;
      return { provider: "project", assetId: resolved, ...(image.name ? { name: image.name.slice(0, 120) } : {}) };
    }
    if (image.provider === "external") {
      return typeof image.uri === "string" && image.uri
        ? { provider: "external", uri: image.uri.slice(0, 500), ...(image.name ? { name: image.name.slice(0, 120) } : {}) }
        : null;
    }
    return { provider: "placeholder", ...(image.name ? { name: image.name.slice(0, 120) } : {}) };
  }
  const resolved = knownAsset(assetId);
  return resolved ? { provider: "project", assetId: resolved } : null;
}

/** Normalizes each recorded image revision against known project assets. */
function sanitizeRevisions(
  holder: { imageHistory?: SymbolDef["imageHistory"] },
  knownAsset: (id: string | null) => string | null,
): SymbolDef["imageHistory"] {
  const seen = new Set<string>();
  const out: NonNullable<SymbolDef["imageHistory"]> = [];
  for (const r of holder.imageHistory ?? []) {
    if (typeof r?.id !== "string" || !r.id || seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id.slice(0, 80),
      asset: normalizeImageRef(r.asset ?? null, null, knownAsset) ?? null,
      createdAt: typeof r.createdAt === "string" ? r.createdAt.slice(0, 40) : "",
      source: r.source,
      ...(typeof r.label === "string" && r.label.trim() ? { label: r.label.trim().slice(0, 120) } : {}),
      ...(r.notes ? { notes: String(r.notes).slice(0, 320) } : {}),
    });
    if (out.length >= 100) break;
  }
  return out;
}

function sanitizeVariants(entity: { variants?: SymbolDef["variants"] }): SymbolDef["variants"] {
  const seen = new Set<string>();
  const out: NonNullable<SymbolDef["variants"]> = [];
  for (const v of entity.variants ?? []) {
    if (typeof v?.id !== "string" || !v.id || seen.has(v.id)) continue;
    seen.add(v.id);
    const extras: Record<string, number | string | boolean> = {};
    for (const [k, val] of Object.entries(v.extras ?? {})) {
      if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") extras[k.slice(0, 40)] = typeof val === "string" ? val.slice(0, 300) : val;
    }
    out.push({
      id: v.id.slice(0, 80),
      name: (typeof v.name === "string" ? v.name : "").replace(/\s+/g, " ").trim().slice(0, 80) || "Variant",
      ...(typeof v.description === "string" ? { description: v.description.slice(0, 800) } : {}),
      image: v.image && typeof v.image === "object" ? v.image : null,
      extras,
      tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12) : [],
    });
    if (out.length >= 24) break;
  }
  return out;
}

export function finalizeDoc(doc: DesignDoc): DesignDoc {
  const assetById = new Map<string, AssetRef>();
  for (const asset of doc.assets) if (!assetById.has(asset.id)) assetById.set(asset.id, asset);
  const knownAsset = (id: string | null) => (id && assetById.has(id) ? id : null);
  const linked = (id: string | null) => isLinked(id ? assetById.get(id) : null);

  const symbolMap = new Map<string, SymbolDef>();
  for (const symbol of doc.symbols) {
    if (!symbolMap.has(symbol.id)) {
      const assetId = knownAsset(symbol.assetId);
      symbolMap.set(symbol.id, {
        ...symbol,
        assetId,
        image: normalizeImageRef(symbol.image, assetId, knownAsset),
        imageHistory: sanitizeRevisions(symbol, knownAsset),
        variants: sanitizeVariants(symbol),
        extras: symbol.extras && typeof symbol.extras === "object" ? { ...symbol.extras } : {},
        mathId: typeof symbol.mathId === "string" ? symbol.mathId.slice(0, 80) : null,
        isWild: symbol.isWild ?? symbol.tier === "special",
        isScatter: symbol.isScatter ?? false,
        isBonus: symbol.isBonus ?? false,
        description: typeof symbol.description === "string" ? symbol.description.slice(0, 800) : "",
        tags: Array.isArray(symbol.tags) ? symbol.tags.filter((t): t is string => typeof t === "string").slice(0, 12) : [],
        symbolSetId: symbol.symbolSetId ?? null,
        family: symbol.family ? symbol.family.slice(0, 60) : undefined,
      });
    }
  }
  const symbols = Array.from(symbolMap.values());

  const claimed = new Set<string>();
  const ownerOf = new Map<string, string>();
  const elements = doc.elements.map((element): ElementDef => {
    if (element.type === "symbol_set" || element.type === "symbol") {
      const symbolIds: string[] = [];
      for (const id of element.symbolIds) {
        if (symbolMap.has(id) && !claimed.has(id)) {
          claimed.add(id);
          if (element.type === "symbol_set") ownerOf.set(id, element.id);
          symbolIds.push(id);
        }
      }
      const hasArt = symbolIds.some((id) => linked(symbolMap.get(id)?.assetId ?? null));
      const { symbolSet, ...rest } = element;
      const meta = element.type === "symbol_set" ? (symbolSet ?? DEFAULT_SET_META) : undefined;
      return {
        ...rest,
        assetId: null,
        image: null,
        symbolIds,
        origin: hasArt ? "imported" : "planned",
        description: typeof element.description === "string" ? element.description.slice(0, 800) : (element.notes ?? ""),
        tags: Array.isArray(element.tags) ? element.tags.filter((t): t is string => typeof t === "string").slice(0, 12) : [],
        ...(typeof element.animationExtra === "string" ? { animationExtra: element.animationExtra.slice(0, 800) } : {}),
        ...(element.type === "symbol_set"
          ? {
              symbolSet: {
                symbolType: meta!.symbolType,
                valueTier: meta!.valueTier,
                frame: meta!.frame ?? null,
                background: meta!.background ?? null,
                styleGuide: typeof meta!.styleGuide === "string" ? meta!.styleGuide.slice(0, 800) : "",
                description: typeof meta!.description === "string" ? meta!.description.slice(0, 800) : "",
                tags: Array.isArray(meta!.tags) ? meta!.tags.filter((t): t is string => typeof t === "string").slice(0, 12) : [],
              },
            }
          : {}),
      };
    }
    const assetId = knownAsset(element.assetId);
    const { symbolSet: _ignored, ...rest } = element;
    void _ignored;
    return {
      ...rest,
      assetId,
      image: normalizeImageRef(element.image, assetId, knownAsset),
      ...(element.imageHistory !== undefined ? { imageHistory: sanitizeRevisions(element, knownAsset) } : {}),
      ...(element.variants !== undefined ? { variants: sanitizeVariants(element) } : {}),
      ...(element.extras !== undefined && element.extras && typeof element.extras === "object" ? { extras: { ...element.extras } } : {}),
      ...(element.style !== undefined && element.style && typeof element.style === "object" ? { style: { ...element.style } } : {}),
      ...(element.animation !== undefined && element.animation && typeof element.animation === "object" ? { animation: { ...element.animation } } : {}),
      ...(typeof element.animationExtra === "string" ? { animationExtra: element.animationExtra.slice(0, 800) } : {}),
      symbolIds: [],
      origin: linked(assetId) ? "imported" : "planned",
      description: typeof element.description === "string" ? element.description.slice(0, 800) : "",
      tags: Array.isArray(element.tags) ? element.tags.filter((t): t is string => typeof t === "string").slice(0, 12) : [],
    };
  });

  for (const symbol of symbols) {
    symbol.symbolSetId = ownerOf.get(symbol.id) ?? null;
    // Mirror the canonical image reference back to the legacy assetId.
    if (symbol.image?.provider === "project" && symbol.image.assetId) {
      symbol.assetId = knownAsset(symbol.image.assetId);
      if (!symbol.assetId) symbol.image = null;
    } else if (symbol.image && symbol.image.provider !== "project") {
      symbol.assetId = knownAsset(symbol.assetId);
    }
  }

  const specialIds = new Set<string>();
  const specialSymbols = doc.specialSymbols.filter((special) => {
    if (!symbolMap.has(special.symbolId) || specialIds.has(special.id)) return false;
    specialIds.add(special.id);
    return true;
  });

  const known = new Set(symbols.map((s) => s.id));
  const stripsValid =
    doc.strips.every((strip) => strip.every((id) => known.has(id))) &&
    symbols.every((s) => s.reelWeight === 0 || doc.strips.every((strip) => strip.includes(s.id)));
  const strips = stripsValid ? doc.strips : buildStrips(symbols, doc.strips.length);

  const keptRows = doc.paytable.filter((row) => known.has(row.symbolId));
  const haveRows = new Set(keptRows.map((row) => row.symbolId));
  const paytable = [...keptRows, ...buildPaytable(symbols.filter((s) => !haveRows.has(s.id)))];

  const referenced = new Set<string>();
  if (doc.referenceAssetId) referenced.add(doc.referenceAssetId);
  for (const id of doc.protectedAssetIds ?? []) referenced.add(id);
  const trackRef = (ref: { provider: string; assetId?: string | null } | null | undefined) => {
    if (ref?.provider === "project" && ref.assetId) referenced.add(ref.assetId);
  };
  elements.forEach((el) => {
    el.assetId && referenced.add(el.assetId);
    trackRef(el.image);
    for (const v of el.variants ?? []) trackRef(v.image);
    for (const h of el.imageHistory ?? []) trackRef(h.asset);
    trackRef(el.symbolSet?.frame);
    trackRef(el.symbolSet?.background);
  });
  symbols.forEach((s) => {
    s.assetId && referenced.add(s.assetId);
    trackRef(s.image);
    for (const v of s.variants ?? []) trackRef(v.image);
    for (const h of s.imageHistory ?? []) trackRef(h.asset);
  });
  for (const anim of doc.animations ?? []) {
    if (anim.videoReference?.assetId) referenced.add(anim.videoReference.assetId);
    if (anim.spriteSheetReference?.assetId) referenced.add(anim.spriteSheetReference.assetId);
  }
  const assets = Array.from(assetById.values()).filter(
    (a) =>
      a.kind !== "image" ||
      referenced.has(a.id) ||
      Boolean(a.createdAt) ||
      a.tags?.includes("library") ||
      a.tags?.includes("asset-library"),
  );

  return {
    elements,
    symbols,
    specialSymbols,
    assets,
    paytable,
    strips,
    referenceAssetId: doc.referenceAssetId,
    protectedAssetIds: doc.protectedAssetIds,
    ...(doc.animations !== undefined ? { animations: doc.animations } : {}),
    ...(doc.scenes !== undefined ? { scenes: doc.scenes } : {}),
    ...(doc.layers !== undefined ? { layers: doc.layers } : {}),
  };
}
