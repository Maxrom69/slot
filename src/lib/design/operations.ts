import { ROYAL_CODES, defaultSymbolStats } from "@/lib/blueprint/factory";
import type {
  AssetRef,
  ElementDef,
  SpecialSymbolDef,
  SymbolDef,
  SymbolSetMeta,
  SymbolSetType,
  ValueTier,
} from "@/lib/blueprint/types";
import {
  DEFAULT_NAMES,
  SET_TYPE_LABELS,
  SPECIALS,
  cleanName,
  finalizeDoc,
  tierOfValue,
  uniqueCode,
  uniqueId,
  uniqueName,
} from "./model";
import type {
  DeletionImpact,
  DesignDoc,
  ElementPatch,
  ImportItem,
  ImportSetOptions,
  NewElementInput,
  OpContext,
  SymbolSpec,
} from "./types";

/**
 * Every Design operation is a pure function: (doc, args) -> doc.
 * They are the unit of undo/redo and can be replayed from serialised input.
 * None of them evaluates or simulates a game.
 */
export const MAX_SET_SYMBOLS = 12;

const withAsset = (assets: AssetRef[], asset?: AssetRef | null) =>
  asset && !assets.some((a) => a.id === asset.id) ? [...assets, asset] : assets;

const slugType = (type: string) => type.replace(/_/g, "-");

function symbolLabel(type: SymbolSetType, index: number, tier: "low" | "mid" | "high" | "special", ctx: OpContext) {
  switch (type) {
    case "royals": {
      const code = ROYAL_CODES[index] ?? `R${index + 1}`;
      return { code, glyph: code };
    }
    case "suits": {
      const i = index % 4;
      return { code: `${"SHDC"[i]}${index >= 4 ? Math.floor(index / 4) + 1 : ""}`, glyph: "♠♥♦♣"[i] };
    }
    case "seven":
      return { code: index === 0 ? "7" : `7-${index + 1}`, glyph: "7" };
    case "bar":
      return { code: index === 0 ? "BAR" : `BAR-${index + 1}`, glyph: "BAR" };
    default:
      return {
        code: `${tier === "low" ? "L" : tier === "mid" ? "M" : "H"}${index + 1}`,
        glyph: ctx.glyphs[index % Math.max(1, ctx.glyphs.length)] ?? "◆",
      };
  }
}

function createSymbols(
  doc: DesignDoc,
  meta: SymbolSetMeta,
  setName: string,
  specs: SymbolSpec[],
  startIndex: number,
  ctx: OpContext,
): SymbolDef[] {
  const tier = tierOfValue(meta.valueTier);
  const ids = new Set(doc.symbols.map((s) => s.id));
  const codes = new Set(doc.symbols.map((s) => s.code));
  const sameTier = doc.symbols.filter((s) => s.tier === tier).length;
  return specs.map((spec, k) => {
    const index = startIndex + k;
    const label = symbolLabel(meta.symbolType, index, tier, ctx);
    const assetId = spec.asset?.id ?? null;
    return {
      id: uniqueId(`sym-${tier}`, ids),
      code: uniqueCode(label.code, codes),
      name: cleanName(spec.name, `${setName} ${index + 1}`),
      tier,
      glyph: label.glyph,
      assetId,
      image: assetId ? { provider: "project", assetId } : null,
      variants: [],
      extras: {},
      mathId: null,
      isWild: tier === "special",
      isScatter: false,
      description: "",
      tags: [],
      symbolSetId: null,
      symbolType: meta.symbolType,
      ...defaultSymbolStats(tier, sameTier + k),
    };
  });
}

export function addElement(
  doc: DesignDoc,
  input: NewElementInput,
  ctx: OpContext,
): { doc: DesignDoc; id: string } {
  const id = uniqueId(`el-${slugType(input.type)}`, new Set(doc.elements.map((e) => e.id)));
  const name = cleanName(input.name, DEFAULT_NAMES[input.type]);
  const asset = "asset" in input ? input.asset : undefined;
  const base: ElementDef = {
    id,
    type: input.type,
    name,
    group: "",
    assetId: null,
    symbolIds: [],
    notes: "",
    origin: "planned",
    params: {},
  };
  let next: DesignDoc = { ...doc, assets: withAsset(doc.assets, asset) };

  switch (input.type) {
    case "symbol_set": {
      const meta: SymbolSetMeta = {
        symbolType: input.symbolType,
        valueTier: input.valueTier,
        frame: null,
        background: null,
        styleGuide: (input.description !== undefined || input.styleGuide !== undefined) ? (input.styleGuide ?? "").slice(0, 800) : "",
        description: (input.description ?? "").slice(0, 800),
        tags: (input.tags ?? []).filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
      };
      const count = Math.max(0, Math.min(MAX_SET_SYMBOLS, Math.round(input.count)));
      const created = createSymbols(next, meta, name, Array.from({ length: count }, () => ({})), 0, ctx);
      // New symbols belong to this set.
      const setId = id;
      for (const s of created) {
        s.symbolSetId = setId;
        s.symbolType = meta.symbolType;
      }
      next = {
        ...next,
        symbols: [...next.symbols, ...created],
        elements: [
          ...next.elements,
          { ...base, group: SET_TYPE_LABELS[meta.symbolType], symbolIds: created.map((s) => s.id), symbolSet: meta, description: meta.description, tags: [...meta.tags ?? []] },
        ],
      };
      break;
    }
    case "symbol": {
      const specials = [...next.specialSymbols];
      let symbol: SymbolDef;
      if (input.behaviour) {
        const def = SPECIALS[input.behaviour];
        const assetId = asset?.id ?? null;
        symbol = {
          id: uniqueId(`sym-${input.behaviour}`, new Set(next.symbols.map((s) => s.id))),
          code: uniqueCode(def.code, new Set(next.symbols.map((s) => s.code))),
          name,
          tier: "special",
          glyph: def.glyph,
          assetId,
          image: assetId ? { provider: "project", assetId } : null,
          variants: [],
          extras: {},
          mathId: null,
          isWild: input.behaviour === "wild",
          isScatter: input.behaviour === "scatter",
          description: "",
          tags: [],
          symbolSetId: null,
          symbolType: "custom",
          payouts: { ...def.payouts },
          reelWeight: def.reelWeight,
        };
        specials.push({
          id: uniqueId(`special-${input.behaviour}`, new Set(specials.map((s) => s.id))),
          symbolId: symbol.id,
          behaviour: input.behaviour,
          params: { ...def.params },
        });
      } else {
        symbol = createSymbols(next, { symbolType: "custom", valueTier: input.valueTier }, name, [{ name, asset }], 0, ctx)[0];
      }
      next = {
        ...next,
        symbols: [...next.symbols, symbol],
        specialSymbols: specials,
        elements: [...next.elements, { ...base, group: input.behaviour ? "Special" : "Symbol", symbolIds: [symbol.id] }],
      };
      break;
    }
    case "reel_frame":
      next = { ...next, elements: [...next.elements, { ...base, group: "Frames", assetId: asset?.id ?? null, image: asset?.id ? { provider: "project", assetId: asset.id } : null, params: { style: input.style } }] };
      break;
    case "game_background":
      next = { ...next, elements: [...next.elements, { ...base, group: "Backgrounds", assetId: asset?.id ?? null, image: asset?.id ? { provider: "project", assetId: asset.id } : null, params: { aspect: input.aspect } }] };
      break;
    case "button_set": {
      const buttons = Array.from(new Set(["spin", ...input.buttons]));
      next = {
        ...next,
        elements: [...next.elements, { ...base, group: "Controls", assetId: asset?.id ?? null, image: asset?.id ? { provider: "project", assetId: asset.id } : null, params: { buttons: buttons.join(","), count: buttons.length } }],
      };
      break;
    }
    case "game_title":
      next = { ...next, elements: [...next.elements, { ...base, group: "Branding", assetId: asset?.id ?? null, image: asset?.id ? { provider: "project", assetId: asset.id } : null }] };
      break;
    case "uploaded":
    case "custom":
    case "other_asset": {
      const storedType = input.type === "other_asset" ? "other_asset" : input.type;
      const fallbackGroup = storedType === "custom" ? "Other" : "Uploaded art";
      next = {
        ...next,
        elements: [...next.elements, {
          ...base,
          type: storedType,
          group: cleanName(input.group, asset ? "Uploaded art" : fallbackGroup, 60),
          assetId: asset?.id ?? null,
          image: asset?.id ? { provider: "project", assetId: asset.id } : null,
        }],
      };
      break;
    }
    default:
      next = {
        ...next,
        elements: [...next.elements, { ...base, group: cleanName((input as { group?: string }).group, asset ? "Uploaded art" : "Other", 60), assetId: asset?.id ?? null }],
      };
  }
  return { doc: finalizeDoc(next), id };
}

export function addSymbols(
  doc: DesignDoc,
  setId: string,
  specs: SymbolSpec[],
  ctx: OpContext,
): { doc: DesignDoc; ids: string[] } {
  const set = doc.elements.find((e) => e.id === setId && e.type === "symbol_set");
  if (!set?.symbolSet || specs.length === 0) return { doc, ids: [] };
  const room = Math.max(0, 48 - set.symbolIds.length);
  const limited = specs.slice(0, room);
  const created = createSymbols(doc, set.symbolSet, set.name, limited, set.symbolIds.length, ctx);
  const assets = limited.reduce((list, spec) => withAsset(list, spec.asset), doc.assets);
  return {
    ids: created.map((s) => s.id),
    doc: finalizeDoc({
      ...doc,
      assets,
      symbols: [...doc.symbols, ...created],
      elements: doc.elements.map((e) => (e.id === setId ? { ...e, symbolIds: [...e.symbolIds, ...created.map((s) => s.id)] } : e)),
    }),
  };
}

export function renameElement(doc: DesignDoc, id: string, rawName: string): DesignDoc {
  const element = doc.elements.find((e) => e.id === id);
  if (!element) return doc;
  const name = cleanName(rawName, element.name);
  if (name === element.name) return doc;
  const owned = new Set(element.type === "symbol" ? element.symbolIds : []);
  return finalizeDoc({
    ...doc,
    elements: doc.elements.map((e) => (e.id === id ? { ...e, name } : e)),
    symbols: doc.symbols.map((s) => (owned.has(s.id) ? { ...s, name } : s)),
  });
}

export function updateElement(doc: DesignDoc, id: string, patch: ElementPatch): DesignDoc {
  const element = doc.elements.find((e) => e.id === id);
  if (!element) return doc;
  const symbolSet = element.symbolSet && patch.symbolSet
    ? {
        ...element.symbolSet,
        ...patch.symbolSet,
        styleGuide: patch.symbolSet.styleGuide !== undefined ? patch.symbolSet.styleGuide.slice(0, 800) : (element.symbolSet.styleGuide ?? ""),
        description: patch.symbolSet.description !== undefined ? patch.symbolSet.description.slice(0, 800) : (element.symbolSet.description ?? ""),
        tags: patch.symbolSet.tags !== undefined
          ? patch.symbolSet.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12)
          : (element.symbolSet.tags ?? []),
      }
    : element.symbolSet;
  const tierChanged = Boolean(symbolSet && element.symbolSet && symbolSet.valueTier !== element.symbolSet.valueTier);
  const members = new Set(element.symbolIds);
  const primarySymId = element.type === "symbol" ? element.symbolIds[0] : undefined;
  return finalizeDoc({
    ...doc,
    symbols: doc.symbols.map((s) => {
      let nextSym = s;
      if (tierChanged && symbolSet && members.has(s.id) && s.tier !== "special") {
        nextSym = { ...nextSym, tier: tierOfValue(symbolSet.valueTier) };
      }
      if (primarySymId && s.id === primarySymId) {
        if (patch.description !== undefined) nextSym = { ...nextSym, description: patch.description.slice(0, 800) };
        if (patch.tags !== undefined) {
          nextSym = {
            ...nextSym,
            tags: patch.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
          };
        }
        if (patch.extras !== undefined) nextSym = { ...nextSym, extras: { ...patch.extras } };
        if (patch.variants !== undefined) nextSym = { ...nextSym, variants: [...patch.variants] };
      }
      return nextSym;
    }),
    elements: doc.elements.map((e) => {
      if (e.id !== id) return e;
      let out: ElementDef = {
        ...e,
        notes: patch.notes !== undefined ? patch.notes.slice(0, 800) : e.notes,
        description: patch.description !== undefined ? patch.description.slice(0, 800) : (e.description ?? ""),
        tags: patch.tags !== undefined
          ? patch.tags.filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12)
          : (e.tags ?? []),
        group: symbolSet && patch.symbolSet?.symbolType ? SET_TYPE_LABELS[symbolSet.symbolType] : patch.group !== undefined ? cleanName(patch.group, e.group, 60) : e.group,
        params: patch.params ? { ...e.params, ...patch.params } : e.params,
        ...(patch.style !== undefined ? { style: { ...(e.style ?? {}), ...patch.style } } : {}),
        ...(patch.variants !== undefined ? { variants: [...patch.variants] } : {}),
        ...(patch.extras !== undefined ? { extras: { ...patch.extras } } : {}),
        ...(patch.animationExtra !== undefined ? { animationExtra: patch.animationExtra.slice(0, 800) } : {}),
        ...(patch.animation !== undefined
          ? {
              animation: {
                preset: patch.animation.preset ?? e.animation?.preset ?? "none",
                trigger: patch.animation.trigger ?? e.animation?.trigger ?? "win",
                durationMs: patch.animation.durationMs ?? e.animation?.durationMs ?? 600,
                easing: patch.animation.easing ?? e.animation?.easing ?? "ease-out",
                loop: patch.animation.loop ?? e.animation?.loop ?? false,
              },
            }
          : {}),
        ...(symbolSet ? { symbolSet } : {}),
      };
      if (patch.image !== undefined && e.type !== "symbol_set" && e.type !== "symbol") {
        out = withElementImageChange(
          out,
          patch.image?.provider === "project"
            ? { ...patch.image, assetId: patch.image.assetId ?? null }
            : patch.image,
          patch.imageSource ?? "upload",
          patch.imageNotes,
        );
      }
      return out;
    }),
  });
}

/** Value-equality check for AssetReference values across serialization boundaries. */
export function sameAssetRef(
  a: SymbolDef["image"] | undefined,
  b: SymbolDef["image"] | undefined,
): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (left.provider !== right.provider) return false;
  if (left.provider === "project") return (left.assetId ?? null) === (right.assetId ?? null);
  if (left.provider === "external") return (left.uri ?? "") === (right.uri ?? "");
  return (left.name ?? "") === (right.name ?? "");
}

/** Records a new image revision (newest first) when the image changes, preserving any prior asset reference. */
function withImageChange(
  symbol: SymbolDef,
  image: NonNullable<SymbolDef["image"]> | null,
  source: NonNullable<SymbolDef["imageHistory"]>[number]["source"],
  notes?: string,
): SymbolDef {
  const prevImage = symbol.image ?? (symbol.assetId ? { provider: "project" as const, assetId: symbol.assetId } : null);
  const nextImage = image ?? null;
  const nextAssetId = nextImage?.provider === "project" ? (nextImage.assetId ?? null) : null;
  const out: SymbolDef = { ...symbol, image: nextImage, assetId: nextAssetId };
  if (sameAssetRef(prevImage, nextImage) && source !== "restore") return out;

  const existingIds = new Set((symbol.imageHistory ?? []).map((r) => r.id));
  let history = [...(symbol.imageHistory ?? [])];

  // If the symbol already had artwork that was not yet recorded in history, preserve it first so replacement never destroys it.
  if (prevImage !== null && !history.some((r) => sameAssetRef(r.asset, prevImage))) {
    const baseRev: NonNullable<SymbolDef["imageHistory"]>[number] = {
      id: uniqueId(`${symbol.id}-rev`, existingIds),
      asset: prevImage,
      createdAt: new Date(Date.now() - 1).toISOString(),
      source: "create",
      notes: "Initial artwork",
    };
    history = [baseRev, ...history];
  }

  const revision: NonNullable<SymbolDef["imageHistory"]>[number] = {
    id: uniqueId(`${symbol.id}-rev`, existingIds),
    asset: nextImage,
    createdAt: new Date().toISOString(),
    source,
    ...(notes ? { notes: notes.slice(0, 320) } : {}),
  };
  out.imageHistory = [revision, ...history].slice(0, 100);
  return out;
}

/** Patches symbol metadata, flags and extras. Tier changes never touch special symbols. */
export function updateSymbol(doc: DesignDoc, symbolId: string, patch: import("./types").SymbolPatch): DesignDoc {
  const existing = doc.symbols.find((s) => s.id === symbolId);
  if (!existing) return doc;
  const standaloneOwner = doc.elements.find((e) => e.type === "symbol" && e.symbolIds.includes(symbolId));
  let syncedName: string | null = null;
  let updatedPayouts: Record<string, number> | null = null;
  const symbols = doc.symbols.map((s) => {
    if (s.id !== symbolId) return s;
    let out = { ...s };
    if (patch.name !== undefined) {
      const name = cleanName(patch.name, s.name);
      if (name !== s.name) {
        out.name = name;
        syncedName = name;
      }
    }
    if (patch.tier !== undefined && s.tier !== "special") out.tier = patch.tier;
    if (patch.symbolType !== undefined) out.symbolType = patch.symbolType;
    if (patch.family !== undefined) out.family = patch.family.replace(/\s+/g, " ").trim().slice(0, 60) || undefined;
    if (patch.image !== undefined) {
      out = withImageChange(
        out,
        patch.image?.provider === "project"
          ? { ...patch.image, assetId: patch.image.assetId ?? null }
          : patch.image,
        patch.imageSource ?? "upload",
        patch.imageNotes,
      );
    }
    if (patch.extras !== undefined) out.extras = { ...patch.extras };
    if (patch.mathId !== undefined) out.mathId = patch.mathId ? patch.mathId.slice(0, 80) : null;
    if (patch.isWild !== undefined) out.isWild = patch.isWild;
    if (patch.isScatter !== undefined) out.isScatter = patch.isScatter;
    if (patch.isBonus !== undefined) out.isBonus = patch.isBonus;
    if (patch.description !== undefined) out.description = patch.description.slice(0, 800);
    if (patch.tags !== undefined) out.tags = patch.tags.filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
    if (patch.code !== undefined) out.code = patch.code.slice(0, 16) || s.code;
    if (patch.glyph !== undefined) out.glyph = patch.glyph.slice(0, 12) || s.glyph;
    if (patch.reelWeight !== undefined && Number.isFinite(patch.reelWeight)) {
      out.reelWeight = Math.max(0, Math.min(100, Math.round(patch.reelWeight)));
    }
    if (patch.payouts !== undefined) {
      const nextPayouts: Record<string, number> = { ...out.payouts };
      for (const [k, v] of Object.entries(patch.payouts)) {
        if (Number.isFinite(v) && v >= 0) nextPayouts[k] = v;
      }
      out.payouts = nextPayouts;
      updatedPayouts = nextPayouts;
    }
    return out;
  });
  const paytable = updatedPayouts
    ? doc.paytable.map((row) =>
        row.symbolId === symbolId && updatedPayouts![String(row.ofAKind)] !== undefined
          ? { ...row, payout: updatedPayouts![String(row.ofAKind)] }
          : row,
      )
    : doc.paytable;
  return finalizeDoc({
    ...doc,
    symbols,
    paytable,
    elements: standaloneOwner && syncedName
      ? doc.elements.map((e) => (e.id === standaloneOwner.id ? { ...e, name: syncedName! } : e))
      : doc.elements,
  });
}

/** Adds a custom variant with its own stable id. */
export function addVariant(
  doc: DesignDoc,
  symbolId: string,
  input: { name?: string; image?: import("@/lib/blueprint/types").AssetReference | null; extras?: Record<string, number | string | boolean>; tags?: string[] } = {},
): { doc: DesignDoc; id: string } {
  const symbol = doc.symbols.find((s) => s.id === symbolId);
  if (!symbol) return { doc, id: "" };
  const taken = new Set<string>();
  for (const s of doc.symbols) for (const v of s.variants ?? []) taken.add(v.id);
  taken.add(symbolId);
  const id = uniqueId(`${symbolId}-var`, taken);
  const variant = {
    id,
    name: cleanName(input.name, `Variant ${(symbol.variants ?? []).length + 1}`),
    image: input.image ?? null,
    extras: input.extras ? { ...input.extras } : {},
    tags: (input.tags ?? []).filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
  };
  return {
    doc: finalizeDoc({
      ...doc,
      assets: input.image?.provider === "project" && input.image.assetId ? withAsset(doc.assets, { id: input.image.assetId, name: input.image.name ?? input.image.assetId, kind: "image", uri: `/api/assets/${input.image.assetId}`, state: "linked", tags: [] } as AssetRef) : doc.assets,
      symbols: doc.symbols.map((s) => (s.id === symbolId ? { ...s, variants: [...(s.variants ?? []), variant] } : s)),
    }),
    id,
  };
}

export function editVariant(
  doc: DesignDoc,
  symbolId: string,
  variantId: string,
  patch: Partial<{ name: string; image: import("@/lib/blueprint/types").AssetReference | null; extras: Record<string, number | string | boolean>; tags: string[] }>,
): DesignDoc {
  return finalizeDoc({
    ...doc,
    symbols: doc.symbols.map((s) => {
      if (s.id !== symbolId) return s;
      return {
        ...s,
        variants: (s.variants ?? []).map((v) => {
          if (v.id !== variantId) return v;
          const out = { ...v };
          if (patch.name !== undefined) {
            const name = cleanName(patch.name, v.name);
            if (name !== v.name) out.name = name;
          }
          if (patch.image !== undefined) out.image = patch.image;
          if (patch.extras !== undefined) out.extras = { ...patch.extras };
          if (patch.tags !== undefined) out.tags = patch.tags.filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
          return out;
        }),
      };
    }),
  });
}

export function duplicateVariant(
  doc: DesignDoc,
  symbolId: string,
  variantId: string,
): { doc: DesignDoc; id: string } {
  const symbol = doc.symbols.find((s) => s.id === symbolId);
  const source = symbol?.variants?.find((v) => v.id === variantId);
  if (!symbol || !source) return { doc, id: "" };
  const taken = new Set<string>();
  for (const s of doc.symbols) for (const v of s.variants ?? []) taken.add(v.id);
  const id = uniqueId(`${source.id}-copy`.replace(/-copy(-\d+)?$/i, ""), taken);
  const clone = {
    ...source,
    id,
    name: uniqueName(source.name, (symbol.variants ?? []).map((v) => v.name)),
    image: source.image ? { ...source.image } : null,
    extras: { ...source.extras },
  };
  return {
    doc: finalizeDoc({
      ...doc,
      symbols: doc.symbols.map((s) => (s.id === symbolId ? { ...s, variants: [...(s.variants ?? []), clone] } : s)),
    }),
    id,
  };
}

/** Finds the most recent image revision whose asset differs from the symbol's current image. */
export function findPreviousImageRevision(
  symbol: SymbolDef,
): NonNullable<SymbolDef["imageHistory"]>[number] | null {
  const current = symbol.image ?? (symbol.assetId ? { provider: "project" as const, assetId: symbol.assetId } : null);
  const history = symbol.imageHistory ?? [];
  for (const rev of history) {
    if (!sameAssetRef(rev.asset, current)) return rev;
  }
  return null;
}

/** Restores the symbol's image to an earlier recorded revision. History records this restore. */
export function restoreImageRevision(
  doc: DesignDoc,
  symbolId: string,
  revisionId: string,
  notes?: string,
): DesignDoc {
  const symbol = doc.symbols.find((s) => s.id === symbolId);
  if (!symbol) return doc;
  const revision = (symbol.imageHistory ?? []).find((r) => r.id === revisionId);
  if (!revision) return doc;
  const resolvedNotes = notes && notes.trim() ? notes.trim() : `Restored from revision ${revisionId}`;
  return finalizeDoc({
    ...doc,
    symbols: doc.symbols.map((s) =>
      s.id === symbolId ? withImageChange(s, revision.asset ?? null, "restore", resolvedNotes) : s,
    ),
  });
}

/** Restores the symbol's image to the most recent revision that differs from its current state. */
export function restorePreviousImageRevision(
  doc: DesignDoc,
  symbolId: string,
  notes?: string,
): DesignDoc {
  const symbol = doc.symbols.find((s) => s.id === symbolId);
  if (!symbol) return doc;
  const prev = findPreviousImageRevision(symbol);
  if (!prev) return doc;
  return restoreImageRevision(doc, symbolId, prev.id, notes);
}

/**
 * Replaces (or clears) a symbol's artwork from either a newly uploaded AssetRef,
 * an existing AssetReference, or null, recording a revision in imageHistory
 * without destroying previous references.
 */
export function replaceSymbolArtwork(
  doc: DesignDoc,
  symbolId: string,
  assetOrRef: AssetRef | NonNullable<SymbolDef["image"]> | null,
  options?: {
    source?: NonNullable<SymbolDef["imageHistory"]>[number]["source"];
    notes?: string;
  },
): DesignDoc {
  if (!doc.symbols.some((s) => s.id === symbolId)) return doc;
  const isAssetRef = Boolean(assetOrRef && "kind" in assetOrRef && "state" in assetOrRef);
  const newAsset = isAssetRef ? (assetOrRef as AssetRef) : null;
  const nextImage: SymbolDef["image"] = isAssetRef
    ? { provider: "project", assetId: (assetOrRef as AssetRef).id, ...(newAsset?.name ? { name: newAsset.name } : {}) }
    : (assetOrRef as SymbolDef["image"]);
  const source = options?.source ?? "upload";
  const notes = options?.notes;
  return finalizeDoc({
    ...doc,
    assets: withAsset(doc.assets, newAsset),
    symbols: doc.symbols.map((s) =>
      s.id === symbolId ? withImageChange(s, nextImage ?? null, source, notes) : s,
    ),
  });
}

/** Clears a symbol's current artwork while preserving all previous references in history. */
export function clearSymbolArtwork(
  doc: DesignDoc,
  symbolId: string,
  notes?: string,
): DesignDoc {
  return replaceSymbolArtwork(doc, symbolId, null, {
    source: "upload",
    notes: notes && notes.trim() ? notes.trim() : "Cleared artwork",
  });
}

/** Adds a note to a recorded revision without changing the image. */
export function annotateImageRevision(doc: DesignDoc, symbolId: string, revisionId: string, notes: string): DesignDoc {
  return finalizeDoc({
    ...doc,
    symbols: doc.symbols.map((s) =>
      s.id === symbolId
        ? {
            ...s,
            imageHistory: (s.imageHistory ?? []).map((r) => (r.id === revisionId ? { ...r, notes: notes.slice(0, 320) } : r)),
          }
        : s,
    ),
  });
}

export function removeVariant(doc: DesignDoc, symbolId: string, variantId: string): DesignDoc {
  return finalizeDoc({
    ...doc,
    symbols: doc.symbols.map((s) => (s.id === symbolId ? { ...s, variants: (s.variants ?? []).filter((v) => v.id !== variantId) } : s)),
  });
}

/**
 * Creates a sequence of named variants on a base symbol (for example,
 * base symbol "Sun Disk" with suffixes ["Collect", "Major", "Mini"] produces
 * "Sun Disk — Collect", "Sun Disk — Major", and "Sun Disk — Mini"),
 * each with its own independent stable ID.
 */
export function createNamedVariants(
  doc: DesignDoc,
  symbolId: string,
  suffixes: string[],
): { doc: DesignDoc; ids: string[] } {
  const symbol = doc.symbols.find((s) => s.id === symbolId);
  if (!symbol || suffixes.length === 0) return { doc, ids: [] };
  let next = doc;
  const ids: string[] = [];
  for (const suffix of suffixes) {
    const trimmed = suffix.trim();
    if (!trimmed) continue;
    const fullName = trimmed.includes("—") ? trimmed : `${symbol.name} — ${trimmed}`;
    const res = addVariant(next, symbolId, { name: fullName });
    next = res.doc;
    if (res.id) ids.push(res.id);
  }
  return { doc: next, ids };
}

export function setSymbolTier(doc: DesignDoc, symbolId: string, valueTier: ValueTier): DesignDoc {
  const symbol = doc.symbols.find((s) => s.id === symbolId);
  if (!symbol || symbol.tier === "special") return doc;
  return finalizeDoc({ ...doc, symbols: doc.symbols.map((s) => (s.id === symbolId ? { ...s, tier: tierOfValue(valueTier) } : s)) });
}

export function renameSymbol(doc: DesignDoc, symbolId: string, rawName: string): DesignDoc {
  const symbol = doc.symbols.find((s) => s.id === symbolId);
  if (!symbol) return doc;
  const name = cleanName(rawName, symbol.name);
  if (name === symbol.name) return doc;
  const owner = doc.elements.find((e) => e.type === "symbol" && e.symbolIds.includes(symbolId));
  return finalizeDoc({
    ...doc,
    symbols: doc.symbols.map((s) => (s.id === symbolId ? { ...s, name } : s)),
    elements: owner ? doc.elements.map((e) => (e.id === owner.id ? { ...e, name } : e)) : doc.elements,
  });
}

/** Link (or unlink with null) the image of a standalone element. Sets have no single image. */
export function setElementImage(doc: DesignDoc, elementId: string, asset: AssetRef | null): DesignDoc {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element || element.type === "symbol_set") return doc;
  const assets = withAsset(doc.assets, asset);
  const image = asset?.id ? { provider: "project" as const, assetId: asset.id } : null;
  if (element.type === "symbol") {
    const symbolId = element.symbolIds[0];
    if (!symbolId) return doc;
    return replaceSymbolArtwork(doc, symbolId, asset);
  }
  return finalizeDoc({ ...doc, assets, elements: doc.elements.map((e) => (e.id === elementId ? { ...e, assetId: asset?.id ?? null, image } : e)) });
}

function withElementImageChange(
  element: ElementDef,
  image: NonNullable<ElementDef["image"]> | null,
  source: NonNullable<ElementDef["imageHistory"]>[number]["source"],
  notes?: string,
): ElementDef {
  const prevImage = element.image ?? (element.assetId ? { provider: "project" as const, assetId: element.assetId } : null);
  const nextImage = image ?? null;
  const nextAssetId = nextImage?.provider === "project" ? (nextImage.assetId ?? null) : null;
  const out: ElementDef = { ...element, image: nextImage, assetId: nextAssetId };
  if (sameAssetRef(prevImage, nextImage) && source !== "restore") return out;

  const existingIds = new Set((element.imageHistory ?? []).map((r) => r.id));
  let history = [...(element.imageHistory ?? [])];

  if (prevImage !== null && !history.some((r) => sameAssetRef(r.asset, prevImage))) {
    const baseRev: NonNullable<ElementDef["imageHistory"]>[number] = {
      id: uniqueId(`${element.id}-rev`, existingIds),
      asset: prevImage,
      createdAt: new Date(Date.now() - 1).toISOString(),
      source: "create",
      notes: "Initial element artwork",
    };
    history = [baseRev, ...history];
  }

  const revision: NonNullable<ElementDef["imageHistory"]>[number] = {
    id: uniqueId(`${element.id}-rev`, existingIds),
    asset: nextImage,
    createdAt: new Date().toISOString(),
    source,
    ...(notes ? { notes: notes.slice(0, 320) } : {}),
  };
  out.imageHistory = [revision, ...history].slice(0, 100);
  return out;
}

/**
 * Replaces (or clears) a standalone element's artwork while recording a revision
 * in element.imageHistory so the element can point to multiple image revisions.
 */
export function replaceElementArtwork(
  doc: DesignDoc,
  elementId: string,
  assetOrRef: AssetRef | NonNullable<ElementDef["image"]> | null,
  options?: {
    source?: NonNullable<ElementDef["imageHistory"]>[number]["source"];
    notes?: string;
  },
): DesignDoc {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element || element.type === "symbol_set") return doc;
  if (element.type === "symbol") {
    const symbolId = element.symbolIds[0];
    if (!symbolId) return doc;
    return replaceSymbolArtwork(doc, symbolId, assetOrRef, options);
  }
  const isAssetRef = Boolean(assetOrRef && "kind" in assetOrRef && "state" in assetOrRef);
  const newAsset = isAssetRef ? (assetOrRef as AssetRef) : null;
  const nextImage: ElementDef["image"] = isAssetRef
    ? { provider: "project", assetId: (assetOrRef as AssetRef).id, ...(newAsset?.name ? { name: newAsset.name } : {}) }
    : (assetOrRef as ElementDef["image"]);
  const source = options?.source ?? "upload";
  const notes = options?.notes;
  return finalizeDoc({
    ...doc,
    assets: withAsset(doc.assets, newAsset),
    elements: doc.elements.map((e) =>
      e.id === elementId ? withElementImageChange(e, nextImage ?? null, source, notes) : e,
    ),
  });
}

/** Finds the most recent image revision on an element whose asset differs from its current image. */
export function findPreviousElementImageRevision(
  element: ElementDef,
): NonNullable<ElementDef["imageHistory"]>[number] | null {
  const current = element.image ?? (element.assetId ? { provider: "project" as const, assetId: element.assetId } : null);
  for (const rev of element.imageHistory ?? []) {
    if (!sameAssetRef(rev.asset, current)) return rev;
  }
  return null;
}

/** Restores a standalone element's image to an earlier recorded revision. */
export function restoreElementImageRevision(
  doc: DesignDoc,
  elementId: string,
  revisionId: string,
  notes?: string,
): DesignDoc {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) return doc;
  if (element.type === "symbol" && element.symbolIds[0]) {
    return restoreImageRevision(doc, element.symbolIds[0], revisionId, notes);
  }
  const revision = (element.imageHistory ?? []).find((r) => r.id === revisionId);
  if (!revision) return doc;
  const resolvedNotes = notes && notes.trim() ? notes.trim() : `Restored from revision ${revisionId}`;
  return finalizeDoc({
    ...doc,
    elements: doc.elements.map((e) =>
      e.id === elementId ? withElementImageChange(e, revision.asset ?? null, "restore", resolvedNotes) : e,
    ),
  });
}

/** Restores a standalone element's image to the most recent revision that differs from its current state. */
export function restorePreviousElementImageRevision(
  doc: DesignDoc,
  elementId: string,
  notes?: string,
): DesignDoc {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) return doc;
  if (element.type === "symbol" && element.symbolIds[0]) {
    return restorePreviousImageRevision(doc, element.symbolIds[0], notes);
  }
  const prev = findPreviousElementImageRevision(element);
  if (!prev) return doc;
  return restoreElementImageRevision(doc, elementId, prev.id, notes);
}

/** Clears a standalone element's artwork while recording the cleared state in imageHistory. */
export function clearElementArtwork(
  doc: DesignDoc,
  elementId: string,
  notes?: string,
): DesignDoc {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) return doc;
  if (element.type === "symbol" && element.symbolIds[0]) {
    return clearSymbolArtwork(doc, element.symbolIds[0], notes);
  }
  return replaceElementArtwork(doc, elementId, null, {
    source: "upload",
    notes: notes && notes.trim() ? notes.trim() : "Cleared artwork",
  });
}

/** Updates revision notes on a standalone element's imageHistory entry. */
export function annotateElementImageRevision(
  doc: DesignDoc,
  elementId: string,
  revisionId: string,
  notes: string,
): DesignDoc {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) return doc;
  if (element.type === "symbol" && element.symbolIds[0]) {
    return annotateImageRevision(doc, element.symbolIds[0], revisionId, notes);
  }
  return finalizeDoc({
    ...doc,
    elements: doc.elements.map((e) =>
      e.id === elementId
        ? {
            ...e,
            imageHistory: (e.imageHistory ?? []).map((r) =>
              r.id === revisionId ? { ...r, notes: notes.slice(0, 320) } : r,
            ),
          }
        : e,
    ),
  });
}

function allVariantIdsInDoc(doc: DesignDoc): Set<string> {
  const taken = new Set<string>(doc.symbols.map((s) => s.id));
  for (const e of doc.elements) taken.add(e.id);
  for (const s of doc.symbols) for (const v of s.variants ?? []) taken.add(v.id);
  for (const e of doc.elements) for (const v of e.variants ?? []) taken.add(v.id);
  return taken;
}

/** Adds a custom variant with a stable ID to a standalone element (or its underlying symbol). */
export function addElementVariant(
  doc: DesignDoc,
  elementId: string,
  spec: {
    name?: string;
    description?: string;
    image?: NonNullable<ElementDef["image"]> | null;
    extras?: Record<string, number | string | boolean>;
    tags?: string[];
  },
): { doc: DesignDoc; id: string } {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) return { doc, id: "" };
  if (element.type === "symbol" && element.symbolIds[0]) {
    return addVariant(doc, element.symbolIds[0], spec);
  }
  const existing = element.variants ?? [];
  if (existing.length >= 24) return { doc, id: "" };
  const taken = allVariantIdsInDoc(doc);
  const name = cleanName(spec.name, `${element.name} — Variant ${existing.length + 1}`);
  const id = uniqueId(`${element.id}-var`, taken);
  const variant = {
    id,
    name,
    ...(spec.description !== undefined ? { description: spec.description.slice(0, 800) } : {}),
    image: spec.image ?? element.image ?? (element.assetId ? { provider: "project" as const, assetId: element.assetId } : null),
    extras: spec.extras ? { ...spec.extras } : {},
    tags: spec.tags ? [...spec.tags] : [],
  };
  return {
    id,
    doc: finalizeDoc({
      ...doc,
      elements: doc.elements.map((e) =>
        e.id === elementId ? { ...e, variants: [...existing, variant] } : e,
      ),
    }),
  };
}

/** Edits a custom variant on a standalone element (or its underlying symbol) without changing its stable ID. */
export function editElementVariant(
  doc: DesignDoc,
  elementId: string,
  variantId: string,
  patch: {
    name?: string;
    description?: string;
    image?: NonNullable<ElementDef["image"]> | null;
    extras?: Record<string, number | string | boolean>;
    tags?: string[];
  },
): DesignDoc {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) return doc;
  if (element.type === "symbol" && element.symbolIds[0]) {
    return editVariant(doc, element.symbolIds[0], variantId, patch);
  }
  return finalizeDoc({
    ...doc,
    elements: doc.elements.map((e) =>
      e.id !== elementId
        ? e
        : {
            ...e,
            variants: (e.variants ?? []).map((v) =>
              v.id !== variantId
                ? v
                : {
                    ...v,
                    name: patch.name !== undefined ? cleanName(patch.name, v.name) : v.name,
                    ...(patch.description !== undefined ? { description: patch.description.slice(0, 800) } : {}),
                    image: patch.image !== undefined ? patch.image : v.image,
                    extras: patch.extras !== undefined ? { ...patch.extras } : v.extras,
                    tags: patch.tags !== undefined ? [...patch.tags] : v.tags,
                  },
            ),
          },
    ),
  });
}

/** Duplicates a custom variant on a standalone element under a fresh stable ID. */
export function duplicateElementVariant(
  doc: DesignDoc,
  elementId: string,
  variantId: string,
): { doc: DesignDoc; id: string } {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) return { doc, id: "" };
  if (element.type === "symbol" && element.symbolIds[0]) {
    return duplicateVariant(doc, element.symbolIds[0], variantId);
  }
  const existing = element.variants ?? [];
  const idx = existing.findIndex((v) => v.id === variantId);
  if (idx < 0 || existing.length >= 24) return { doc, id: "" };
  const source = existing[idx];
  const taken = allVariantIdsInDoc(doc);
  const id = uniqueId(`${element.id}-var`, taken);
  const copy = {
    ...source,
    id,
    name: uniqueName(source.name, existing.map((v) => v.name)),
    image: source.image ? { ...source.image } : null,
    extras: { ...source.extras },
    tags: [...(source.tags ?? [])],
  };
  const nextVariants = [...existing];
  nextVariants.splice(idx + 1, 0, copy);
  return {
    id,
    doc: finalizeDoc({
      ...doc,
      elements: doc.elements.map((e) => (e.id === elementId ? { ...e, variants: nextVariants } : e)),
    }),
  };
}

/** Removes a custom variant from a standalone element. */
export function removeElementVariant(
  doc: DesignDoc,
  elementId: string,
  variantId: string,
): DesignDoc {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) return doc;
  if (element.type === "symbol" && element.symbolIds[0]) {
    return removeVariant(doc, element.symbolIds[0], variantId);
  }
  return finalizeDoc({
    ...doc,
    elements: doc.elements.map((e) =>
      e.id === elementId
        ? { ...e, variants: (e.variants ?? []).filter((v) => v.id !== variantId) }
        : e,
    ),
  });
}

/** Adds an AnimationMeta cue targeting an element (or its primary symbol) in doc.animations. */
export function addElementAnimationCue(
  doc: DesignDoc,
  elementId: string,
  input?: Partial<Omit<import("@/lib/blueprint/types").AnimationMeta, "id">>,
): { doc: DesignDoc; id: string } {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) return { doc, id: "" };
  const current = doc.animations ?? [];
  const taken = new Set(current.map((a) => a.id));
  const id = uniqueId(`anim-${element.id}`, taken);
  const target = input?.target ?? (element.type === "symbol" && element.symbolIds[0] ? element.symbolIds[0] : element.id);
  const durationVal = Math.max(0, Math.min(60_000, Math.round(input?.duration ?? input?.durationMs ?? element.animation?.durationMs ?? 600)));
  const kindVal = (input?.kind ?? (element.animation?.preset && element.animation.preset !== "none" ? element.animation.preset : "pulse")).slice(0, 64);
  const animType: import("@/lib/blueprint/types").StudioAnimationType =
    input?.animationType ??
    (element.type === "game_background"
      ? "Background"
      : element.type === "symbol" || element.type === "symbol_set"
        ? "Symbol Win"
        : element.type === "button_set"
          ? "Hover"
          : "Custom");
  const cue: import("@/lib/blueprint/types").AnimationMeta = {
    id,
    elementId: input?.elementId ?? element.id,
    name: (input?.name ?? `${element.name} ${kindVal}`).slice(0, 80),
    animationType: animType,
    source: input?.source ?? "preset",
    format: input?.format ?? "css",
    duration: durationVal,
    loop: input?.loop ?? element.animation?.loop ?? (animType === "Background"),
    fps: input?.fps ?? 24,
    thumbnail: input?.thumbnail ?? null,
    videoReference: input?.videoReference ?? null,
    spriteSheetReference: input?.spriteSheetReference ?? null,
    state: input?.state ?? "enabled",
    animationExtra: input?.animationExtra ?? element.animationExtra ?? "",
    target,
    trigger: input?.trigger ?? element.animation?.trigger ?? "win",
    kind: kindVal,
    durationMs: durationVal,
    easing: (input?.easing ?? element.animation?.easing ?? "ease-out").slice(0, 64),
  };
  return {
    id,
    doc: finalizeDoc({
      ...doc,
      animations: [...current, cue],
    }),
  };
}

/** Updates an existing AnimationMeta cue in doc.animations. */
export function updateElementAnimationCue(
  doc: DesignDoc,
  cueId: string,
  patch: Partial<Omit<import("@/lib/blueprint/types").AnimationMeta, "id">>,
): DesignDoc {
  const current = doc.animations ?? [];
  if (!current.some((a) => a.id === cueId)) return doc;
  return finalizeDoc({
    ...doc,
    animations: current.map((a) => {
      if (a.id !== cueId) return a;
      const nextDuration =
        patch.duration !== undefined && Number.isFinite(patch.duration)
          ? Math.max(0, Math.min(60_000, Math.round(patch.duration)))
          : patch.durationMs !== undefined && Number.isFinite(patch.durationMs)
            ? Math.max(0, Math.min(60_000, Math.round(patch.durationMs)))
            : (a.duration ?? a.durationMs);
      return {
        ...a,
        ...(patch.elementId !== undefined ? { elementId: patch.elementId } : {}),
        ...(patch.name !== undefined && patch.name.trim() ? { name: patch.name.trim().slice(0, 80) } : {}),
        ...(patch.animationType !== undefined ? { animationType: patch.animationType } : {}),
        ...(patch.source !== undefined ? { source: patch.source } : {}),
        ...(patch.format !== undefined ? { format: patch.format } : {}),
        duration: nextDuration,
        durationMs: nextDuration,
        ...(patch.loop !== undefined ? { loop: patch.loop } : {}),
        ...(patch.fps !== undefined && Number.isFinite(patch.fps) ? { fps: Math.max(1, Math.min(240, Math.round(patch.fps))) } : {}),
        ...(patch.thumbnail !== undefined ? { thumbnail: patch.thumbnail } : {}),
        ...(patch.videoReference !== undefined ? { videoReference: patch.videoReference } : {}),
        ...(patch.spriteSheetReference !== undefined ? { spriteSheetReference: patch.spriteSheetReference } : {}),
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.animationExtra !== undefined ? { animationExtra: patch.animationExtra.slice(0, 800) } : {}),
        ...(patch.target !== undefined ? { target: patch.target } : {}),
        ...(patch.trigger !== undefined ? { trigger: patch.trigger } : {}),
        ...(patch.kind !== undefined ? { kind: patch.kind.slice(0, 64) || a.kind } : {}),
        ...(patch.easing !== undefined ? { easing: patch.easing.slice(0, 64) || a.easing } : {}),
      };
    }),
  });
}

/** Removes an AnimationMeta cue from doc.animations. */
export function removeElementAnimationCue(doc: DesignDoc, cueId: string): DesignDoc {
  const current = doc.animations ?? [];
  return finalizeDoc({
    ...doc,
    animations: current.filter((a) => a.id !== cueId),
  });
}

export function setSymbolImage(doc: DesignDoc, symbolId: string, asset: AssetRef | null, notes?: string): DesignDoc {
  return replaceSymbolArtwork(doc, symbolId, asset, { source: "upload", notes });
}

export function duplicateElement(doc: DesignDoc, id: string): { doc: DesignDoc; id: string } | null {
  const index = doc.elements.findIndex((e) => e.id === id);
  if (index < 0) return null;
  const source = doc.elements[index];
  const newId = uniqueId(`el-${slugType(source.type)}`, new Set(doc.elements.map((e) => e.id)));
  const name = uniqueName(source.name, doc.elements.map((e) => e.name));
  const symbolIds = new Set(doc.symbols.map((s) => s.id));
  const codes = new Set(doc.symbols.map((s) => s.code));
  const specialIds = new Set(doc.specialSymbols.map((s) => s.id));
  const clones: SymbolDef[] = [];
  const specials: SpecialSymbolDef[] = [];

  const variantTaken = new Set<string>();
  for (const s of doc.symbols) for (const v of s.variants ?? []) variantTaken.add(v.id);
  for (const symbolId of source.symbolIds) {
    const original = doc.symbols.find((s) => s.id === symbolId);
    if (!original) continue;
    const clone: SymbolDef = {
      ...original,
      id: uniqueId(original.id.replace(/-\d+$/, ""), symbolIds),
      code: uniqueCode(original.code, codes),
      name: source.type === "symbol" ? name : original.name,
      payouts: { ...original.payouts },
      image: original.image ? { ...original.image } : null,
      variants: (original.variants ?? []).map((v) => {
        const vid = uniqueId(`${v.id}-copy`.replace(/-copy(-\d+)?$/i, ""), variantTaken);
        return { ...v, id: vid, image: v.image ? { ...v.image } : null, extras: { ...v.extras }, tags: [...(v.tags ?? [])] };
      }),
      extras: { ...(original.extras ?? {}) },
      tags: [...(original.tags ?? [])],
      symbolSetId: null,
    };
    clones.push(clone);
    doc.specialSymbols
      .filter((s) => s.symbolId === symbolId)
      .forEach((s) =>
        specials.push({ ...s, id: uniqueId(`special-${s.behaviour}`, specialIds), symbolId: clone.id, params: { ...s.params } }),
      );
  }

  const copy: ElementDef = {
    ...source,
    id: newId,
    name,
    symbolIds: clones.map((s) => s.id),
    params: { ...source.params },
    image: source.image ? { ...source.image } : null,
    description: source.description ?? "",
    tags: [...(source.tags ?? [])],
    ...(source.style ? { style: { ...source.style } } : {}),
    ...(source.extras ? { extras: { ...source.extras } } : {}),
    ...(source.animation ? { animation: { ...source.animation } } : {}),
    ...(source.animationExtra !== undefined ? { animationExtra: source.animationExtra } : {}),
    ...(source.variants
      ? {
          variants: source.variants.map((v) => {
            const vid = uniqueId(`${v.id}-copy`.replace(/-copy(-\d+)?$/i, ""), variantTaken);
            return {
              ...v,
              id: vid,
              image: v.image ? { ...v.image } : null,
              extras: { ...v.extras },
              tags: [...(v.tags ?? [])],
            };
          }),
        }
      : {}),
    ...(source.symbolSet ? { symbolSet: { ...source.symbolSet, tags: [...(source.symbolSet.tags ?? [])] } } : {}),
  };
  const elements = [...doc.elements];
  elements.splice(index + 1, 0, copy);
  return {
    id: newId,
    doc: finalizeDoc({
      ...doc,
      elements,
      symbols: [...doc.symbols, ...clones],
      specialSymbols: [...doc.specialSymbols, ...specials],
    }),
  };
}

/** Duplicates one symbol (with its variants) under fresh stable ids, inserting it after the original. */
export function duplicateSymbol(doc: DesignDoc, symbolId: string): { doc: DesignDoc; id: string } | null {
  const original = doc.symbols.find((s) => s.id === symbolId);
  if (!original) return null;
  const owner = doc.elements.find((e) => e.symbolIds.includes(symbolId));
  const ids = new Set(doc.symbols.map((s) => s.id));
  const codes = new Set(doc.symbols.map((s) => s.code));
  const variantTaken = new Set<string>();
  for (const s of doc.symbols) for (const v of s.variants ?? []) variantTaken.add(v.id);

  const clone: SymbolDef = {
    ...original,
    id: uniqueId(original.id.replace(/-\d+$/, ""), ids),
    code: uniqueCode(original.code, codes),
    name: uniqueName(original.name, doc.symbols.map((s) => s.name)),
    image: original.image ? { ...original.image } : null,
    variants: (original.variants ?? []).map((v) => ({
      ...v,
      id: uniqueId(`${v.id}-copy`.replace(/-copy(-\d+)?$/i, ""), variantTaken),
      image: v.image ? { ...v.image } : null,
      extras: { ...v.extras },
      tags: [...(v.tags ?? [])],
    })),
    extras: { ...(original.extras ?? {}) },
    tags: [...(original.tags ?? [])],
    symbolSetId: original.symbolSetId,
  };

  let elements = doc.elements;
  if (owner) {
    const index = owner.symbolIds.indexOf(symbolId);
    elements = doc.elements.map((e) =>
      e.id === owner.id
        ? { ...e, symbolIds: [...e.symbolIds.slice(0, index + 1), clone.id, ...e.symbolIds.slice(index + 1)] }
        : e,
    );
  }
  return { doc: finalizeDoc({ ...doc, elements, symbols: [...doc.symbols, clone] }), id: clone.id };
}

/** Reorders a symbol within its owning set. Out-of-range moves are no-ops. */
export function moveSymbolInSet(doc: DesignDoc, setId: string, symbolId: string, delta: number): DesignDoc {
  const set = doc.elements.find((e) => e.id === setId && e.type === "symbol_set");
  if (!set || !set.symbolIds.includes(symbolId)) return doc;
  const index = set.symbolIds.indexOf(symbolId);
  const target = index + delta;
  if (target < 0 || target >= set.symbolIds.length) return doc;
  const ids = [...set.symbolIds];
  const [moved] = ids.splice(index, 1);
  ids.splice(target, 0, moved);
  return finalizeDoc({ ...doc, elements: doc.elements.map((e) => (e.id === setId ? { ...e, symbolIds: ids } : e)) });
}

export function deleteElement(doc: DesignDoc, id: string): DesignDoc {
  const element = doc.elements.find((e) => e.id === id);
  if (!element) return doc;
  const drop = new Set(element.symbolIds);
  return finalizeDoc({
    ...doc,
    elements: doc.elements.filter((e) => e.id !== id),
    symbols: doc.symbols.filter((s) => !drop.has(s.id)),
    specialSymbols: doc.specialSymbols.filter((s) => !drop.has(s.symbolId)),
  });
}

/** Deleting a symbol inside a set removes it from the set; a standalone symbol removes its element. */
export function deleteSymbol(doc: DesignDoc, symbolId: string): DesignDoc {
  const owner = doc.elements.find((e) => e.symbolIds.includes(symbolId));
  if (owner?.type === "symbol") return deleteElement(doc, owner.id);
  return finalizeDoc({
    ...doc,
    symbols: doc.symbols.filter((s) => s.id !== symbolId),
    specialSymbols: doc.specialSymbols.filter((s) => s.symbolId !== symbolId),
    elements: doc.elements.map((e) => ({ ...e, symbolIds: e.symbolIds.filter((id) => id !== symbolId) })),
  });
}

function impactOf(doc: DesignDoc, ids: Set<string>, kind: DeletionImpact["kind"], name: string): DeletionImpact {
  return {
    kind,
    name,
    symbols: ids.size,
    paytableRows: doc.paytable.filter((row) => ids.has(row.symbolId)).length,
    stripPositions: doc.strips.reduce((sum, strip) => sum + strip.filter((id) => ids.has(id)).length, 0),
  };
}

export function deletionImpact(doc: DesignDoc, elementId: string): DeletionImpact | null {
  const element = doc.elements.find((e) => e.id === elementId);
  return element ? impactOf(doc, new Set(element.symbolIds), "element", element.name) : null;
}

export function symbolDeletionImpact(doc: DesignDoc, symbolId: string): DeletionImpact | null {
  const symbol = doc.symbols.find((s) => s.id === symbolId);
  return symbol ? impactOf(doc, new Set([symbolId]), "symbol", symbol.name) : null;
}

function importInput(item: ImportItem): NewElementInput {
  const { asset, name } = item;
  switch (item.elementType) {
    case "symbol":
      return { type: "symbol", name, valueTier: "medium", asset };
    case "reel_frame":
      return { type: "reel_frame", name, style: "Themed", asset };
    case "game_background":
      return { type: "game_background", name, aspect: "16:9", asset };
    case "button_set":
      return { type: "button_set", name, buttons: ["spin"], asset };
    case "game_title":
      return { type: "game_title", name, asset };
    case "uploaded":
      return { type: "uploaded", name, asset };
    case "custom":
      return { type: "custom", name, asset };
    default:
      return { type: "other_asset", name, asset };
  }
}

/** Artwork typed "Symbol Set" becomes the symbols of one new set; everything else is one element per file. */
export function importArtwork(
  doc: DesignDoc,
  items: ImportItem[],
  setOptions: ImportSetOptions,
  ctx: OpContext,
): { doc: DesignDoc; ids: string[] } {
  let next = doc;
  const ids: string[] = [];
  for (const item of items) {
    if (item.elementType === "symbol_set") continue;
    const added = addElement(next, importInput(item), ctx);
    next = added.doc;
    ids.push(added.id);
  }
  const setItems = items.filter((item) => item.elementType === "symbol_set");
  if (setItems.length > 0) {
    const created = addElement(
      next,
      { type: "symbol_set", name: setOptions.name, symbolType: setOptions.symbolType, valueTier: setOptions.valueTier, count: 0 },
      ctx,
    );
    next = addSymbols(created.doc, created.id, setItems.map((i) => ({ name: i.name.replace(/\.[a-z0-9]+$/i, ""), asset: i.asset })), ctx).doc;
    ids.push(created.id);
  }
  return { doc: next, ids };
}
