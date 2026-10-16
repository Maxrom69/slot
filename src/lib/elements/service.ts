/**
 * Element service boundary. Every operation is a pure function
 * `(library, args) -> library` (or a narrow result): the unit of undo/redo,
 * replayable from serialised input. No React, no I/O, no payout evaluation.
 * Gameplay flags (`mathId`, `isWild`, `isScatter`) are stored as opaque
 * configuration for the SECTION 2 engine.
 */

import type { AssetReference } from "@/lib/blueprint/types";
import { copyName, copyStableId, isStableId, newStableId } from "./ids";
import type {
  CustomElement,
  ElementKind,
  GameBackground,
  StandaloneElement,
  Symbol,
  SymbolSet,
  SymbolType,
  UploadedElement,
  ValueTier,
} from "./types";
import { SYMBOL_TYPE_TO_STORED } from "./types";

export interface ServiceResult<T> {
  library: T;
}

function takenIds(lib: { sets: { id: string }[]; symbols: { id: string }[]; standalone: { id: string }[] }): Set<string> {
  return new Set([...lib.sets.map((s) => s.id), ...lib.symbols.map((s) => s.id), ...lib.standalone.map((s) => s.id)]);
}

function variantIds(symbols: Symbol[]): Set<string> {
  const taken = new Set<string>();
  for (const s of symbols) for (const v of s.variants) taken.add(v.id);
  return taken;
}

export interface CreateSetInput {
  name: string;
  symbolType?: SymbolType;
  valueTier?: ValueTier;
  frame?: AssetReference | null;
  background?: AssetReference | null;
  styleGuide?: string;
  description?: string;
  tags?: string[];
}

export function createSymbolSet(
  lib: import("./types").ElementLibrary,
  input: CreateSetInput,
): { library: import("./types").ElementLibrary; id: string } {
  const taken = takenIds(lib);
  const id = newStableId("set", taken);
  const name = (input.name.trim() || "New Symbol Set").slice(0, 80);
  const set: SymbolSet = {
    id,
    kind: "symbol-set",
    name,
    description: (input.description ?? "").slice(0, 800),
    tags: (input.tags ?? []).filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
    image: null,
    symbolType: input.symbolType ?? "custom",
    valueTier: input.valueTier ?? "medium",
    frame: input.frame ?? null,
    background: input.background ?? null,
    symbols: [],
    styleGuide: (input.styleGuide ?? "").slice(0, 800),
  };
  return { library: { ...lib, sets: [...lib.sets, set] }, id };
}

export function renameSymbolSet(
  lib: import("./types").ElementLibrary,
  id: string,
  name: string,
): import("./types").ElementLibrary {
  const next = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!next) return lib;
  return { ...lib, sets: lib.sets.map((s) => (s.id === id ? { ...s, name: next } : s)) };
}

export function editSymbolSet(
  lib: import("./types").ElementLibrary,
  id: string,
  patch: Partial<Pick<SymbolSet, "name" | "symbolType" | "valueTier" | "frame" | "background" | "styleGuide" | "description" | "tags">>,
): import("./types").ElementLibrary {
  return {
    ...lib,
    sets: lib.sets.map((s) => {
      if (s.id !== id) return s;
      const out = { ...s };
      if (patch.name !== undefined) {
        const name = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
        if (name) out.name = name;
      }
      if (patch.symbolType !== undefined) out.symbolType = patch.symbolType;
      if (patch.valueTier !== undefined) out.valueTier = patch.valueTier;
      if (patch.frame !== undefined) out.frame = patch.frame;
      if (patch.background !== undefined) out.background = patch.background;
      if (patch.styleGuide !== undefined) out.styleGuide = patch.styleGuide.slice(0, 800);
      if (patch.description !== undefined) out.description = patch.description.slice(0, 800);
      if (patch.tags !== undefined) out.tags = patch.tags.filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
      return out;
    }),
  };
}

export function duplicateSymbolSet(
  lib: import("./types").ElementLibrary,
  id: string,
): { library: import("./types").ElementLibrary; id: string } {
  const source = lib.sets.find((s) => s.id === id);
  if (!source) return { library: lib, id: "" };
  const taken = takenIds(lib);
  const variantsTaken = variantIds(lib.symbols);
  const newSetId = copyStableId(source.id, taken);
  const name = copyName(source.name, lib.sets.map((s) => s.name));
  const symbolIdMap = new Map<string, string>();
  const symbols: Symbol[] = [...lib.symbols];
  for (const memberId of source.symbols) {
    const original = lib.symbols.find((s) => s.id === memberId);
    if (!original) continue;
    const newId = copyStableId(original.id, taken);
    symbolIdMap.set(original.id, newId);
    symbols.push({
      ...original,
      id: newId,
      name: original.name,
      symbolSetId: newSetId,
      image: original.image ? { ...original.image } : null,
      variants: original.variants.map((v) => {
        const vid = copyStableId(v.id, variantsTaken);
        return { ...v, id: vid, image: v.image ? { ...v.image } : null, extras: { ...v.extras }, tags: [...(v.tags ?? [])] };
      }),
      extras: { ...original.extras },
      tags: [...original.tags],
      payouts: { ...original.payouts },
    });
  }
  void symbolIdMap;
  const set: SymbolSet = {
    ...source,
    id: newSetId,
    name,
    frame: source.frame ? { ...source.frame } : null,
    background: source.background ? { ...source.background } : null,
    image: null,
    symbols: source.symbols.map((mid) => symbolIdMap.get(mid)).filter((v): v is string => Boolean(v)),
    tags: [...source.tags],
  };
  return { library: { ...lib, sets: [...lib.sets, set], symbols }, id: newSetId };
}

export function removeSymbolSet(
  lib: import("./types").ElementLibrary,
  id: string,
): import("./types").ElementLibrary {
  const set = lib.sets.find((s) => s.id === id);
  if (!set) return lib;
  const drop = new Set(set.symbols);
  return {
    sets: lib.sets.filter((s) => s.id !== id),
    symbols: lib.symbols.filter((s) => !drop.has(s.id)),
    standalone: lib.standalone,
  };
}

/* --------------------------------- symbols --------------------------------- */

export interface CreateSymbolInput {
  name?: string;
  setId?: string | null;
  symbolType?: SymbolType;
  tier?: ValueTier;
  image?: AssetReference | null;
  mathId?: string | null;
  isWild?: boolean;
  isScatter?: boolean;
  isBonus?: boolean;
  family?: string;
  description?: string;
  tags?: string[];
}

let symbolCodeCounter = 0;

export function createSymbol(
  lib: import("./types").ElementLibrary,
  input: CreateSymbolInput = {},
): { library: import("./types").ElementLibrary; id: string } {
  const taken = takenIds(lib);
  const id = newStableId("sym", taken);
  const set = input.setId ? lib.sets.find((s) => s.id === input.setId) : undefined;
  const symbolType = input.symbolType ?? set?.symbolType ?? "custom";
  const tier = input.tier ?? (set && set.valueTier !== undefined ? (set.valueTier as ValueTier) : "medium");
  symbolCodeCounter += 1;
  const symbol: Symbol = {
    id,
    name: (input.name?.trim() || `Symbol ${lib.symbols.length + 1}`).slice(0, 80),
    symbolSetId: set ? set.id : null,
    symbolType,
    tier,
    image: input.image ?? null,
    variants: [],
    extras: {},
    mathId: input.mathId ?? null,
    isWild: input.isWild ?? tier === "special",
    isScatter: input.isScatter ?? false,
    isBonus: input.isBonus ?? false,
    ...(input.family ? { family: input.family.replace(/\s+/g, " ").trim().slice(0, 60) } : {}),
    imageHistory: [],
    code: `S${lib.symbols.length + 1}`,
    glyph: "◆",
    reelWeight: 5,
    payouts: {},
    description: (input.description ?? "").slice(0, 800),
    tags: (input.tags ?? []).filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
  };
  const sets = set ? lib.sets.map((s) => (s.id === set.id ? { ...s, symbols: [...s.symbols, id] } : s)) : lib.sets;
  return { library: { ...lib, sets, symbols: [...lib.symbols, symbol] }, id };
}

export function editSymbol(
  lib: import("./types").ElementLibrary,
  id: string,
  patch: Partial<Pick<Symbol, "name" | "symbolType" | "tier" | "image" | "extras" | "mathId" | "isWild" | "isScatter" | "isBonus" | "family" | "imageHistory" | "description" | "tags" | "code" | "glyph" | "reelWeight" | "payouts">>,
): import("./types").ElementLibrary {
  return {
    ...lib,
    symbols: lib.symbols.map((s) => {
      if (s.id !== id) return s;
      const out = { ...s };
      if (patch.name !== undefined) {
        const name = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
        if (name) out.name = name;
      }
      if (patch.symbolType !== undefined) out.symbolType = patch.symbolType;
      if (patch.tier !== undefined) out.tier = patch.tier;
      if (patch.image !== undefined) out.image = patch.image;
      if (patch.extras !== undefined) out.extras = { ...patch.extras };
      if (patch.mathId !== undefined) out.mathId = patch.mathId;
      if (patch.isWild !== undefined) out.isWild = patch.isWild;
      if (patch.isScatter !== undefined) out.isScatter = patch.isScatter;
      if (patch.isBonus !== undefined) out.isBonus = patch.isBonus;
      if (patch.family !== undefined) out.family = patch.family.replace(/\s+/g, " ").trim().slice(0, 60) || undefined;
      if (patch.imageHistory !== undefined) out.imageHistory = patch.imageHistory.map((r) => ({ ...r, asset: r.asset ? { ...r.asset } : null }));
      if (patch.description !== undefined) out.description = patch.description.slice(0, 800);
      if (patch.tags !== undefined) out.tags = patch.tags.filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
      if (patch.code !== undefined) out.code = patch.code.slice(0, 16);
      if (patch.glyph !== undefined) out.glyph = patch.glyph.slice(0, 12);
      if (patch.reelWeight !== undefined && Number.isInteger(patch.reelWeight)) out.reelWeight = patch.reelWeight;
      if (patch.payouts !== undefined) out.payouts = { ...patch.payouts };
      return out;
    }),
  };
}

export function moveSymbolToSet(
  lib: import("./types").ElementLibrary,
  symbolId: string,
  setId: string | null,
): import("./types").ElementLibrary {
  if (!lib.symbols.some((s) => s.id === symbolId)) return lib;
  if (setId !== null && !lib.sets.some((s) => s.id === setId)) return lib;
  return {
    ...lib,
    sets: lib.sets.map((s) => ({
      ...s,
      symbols: s.id === setId
        ? (s.symbols.includes(symbolId) ? s.symbols : [...s.symbols, symbolId])
        : s.symbols.filter((id) => id !== symbolId),
    })),
    symbols: lib.symbols.map((s) => (s.id === symbolId ? { ...s, symbolSetId: setId } : s)),
  };
}

export function duplicateSymbol(
  lib: import("./types").ElementLibrary,
  id: string,
): { library: import("./types").ElementLibrary; id: string } {
  const source = lib.symbols.find((s) => s.id === id);
  if (!source) return { library: lib, id: "" };
  const taken = takenIds(lib);
  const variantsTaken = variantIds(lib.symbols);
  const newId = copyStableId(source.id, taken);
  const name = copyName(source.name, lib.symbols.map((s) => s.name));
  const clone: Symbol = {
    ...source,
    id: newId,
    name,
    image: source.image ? { ...source.image } : null,
    variants: source.variants.map((v) => {
      const vid = copyStableId(v.id, variantsTaken);
      return { ...v, id: vid, image: v.image ? { ...v.image } : null, extras: { ...v.extras }, tags: [...(v.tags ?? [])] };
    }),
    extras: { ...source.extras },
    tags: [...source.tags],
    payouts: { ...source.payouts },
  };
  const sets = source.symbolSetId
    ? lib.sets.map((s) => (s.id === source.symbolSetId ? { ...s, symbols: [...s.symbols, newId] } : s))
    : lib.sets;
  return { library: { ...lib, sets, symbols: [...lib.symbols, clone] }, id: newId };
}

export function removeSymbol(
  lib: import("./types").ElementLibrary,
  id: string,
): import("./types").ElementLibrary {
  if (!lib.symbols.some((s) => s.id === id)) return lib;
  return {
    sets: lib.sets.map((s) => ({ ...s, symbols: s.symbols.filter((sid) => sid !== id) })),
    symbols: lib.symbols.filter((s) => s.id !== id),
    standalone: lib.standalone,
  };
}

/* --------------------------------- variants -------------------------------- */

export function addVariant(
  lib: import("./types").ElementLibrary,
  symbolId: string,
  input: { name?: string; image?: AssetReference | null; extras?: Record<string, number | string | boolean>; tags?: string[] } = {},
): { library: import("./types").ElementLibrary; id: string } {
  const symbol = lib.symbols.find((s) => s.id === symbolId);
  if (!symbol) return { library: lib, id: "" };
  const taken = variantIds(lib.symbols);
  taken.add(symbolId);
  const id = newStableId(`${symbolId}-var`, taken);
  const variant = {
    id,
    name: (input.name?.trim() || `Variant ${symbol.variants.length + 1}`).slice(0, 80),
    image: input.image ?? null,
    extras: input.extras ? { ...input.extras } : {},
    tags: (input.tags ?? []).filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
  };
  return {
    library: { ...lib, symbols: lib.symbols.map((s) => (s.id === symbolId ? { ...s, variants: [...s.variants, variant] } : s)) },
    id,
  };
}

export function editVariant(
  lib: import("./types").ElementLibrary,
  symbolId: string,
  variantId: string,
  patch: Partial<{ name: string; image: AssetReference | null; extras: Record<string, number | string | boolean>; tags: string[] }>,
): import("./types").ElementLibrary {
  return {
    ...lib,
    symbols: lib.symbols.map((s) => {
      if (s.id !== symbolId) return s;
      return {
        ...s,
        variants: s.variants.map((v) => {
          if (v.id !== variantId) return v;
          const out = { ...v };
          if (patch.name !== undefined) {
            const name = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
            if (name) out.name = name;
          }
          if (patch.image !== undefined) out.image = patch.image;
          if (patch.extras !== undefined) out.extras = { ...patch.extras };
          if (patch.tags !== undefined) out.tags = patch.tags.filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
          return out;
        }),
      };
    }),
  };
}

export function duplicateVariant(
  lib: import("./types").ElementLibrary,
  symbolId: string,
  variantId: string,
): { library: import("./types").ElementLibrary; id: string } {
  const symbol = lib.symbols.find((s) => s.id === symbolId);
  const source = symbol?.variants.find((v) => v.id === variantId);
  if (!symbol || !source) return { library: lib, id: "" };
  const taken = variantIds(lib.symbols);
  const id = copyStableId(source.id, taken);
  const clone = {
    ...source,
    id,
    name: copyName(source.name, symbol.variants.map((v) => v.name)),
    image: source.image ? { ...source.image } : null,
    extras: { ...source.extras },
    tags: [...(source.tags ?? [])],
  };
  return {
    library: { ...lib, symbols: lib.symbols.map((s) => (s.id === symbolId ? { ...s, variants: [...s.variants, clone] } : s)) },
    id,
  };
}

export function removeVariant(
  lib: import("./types").ElementLibrary,
  symbolId: string,
  variantId: string,
): import("./types").ElementLibrary {
  return {
    ...lib,
    symbols: lib.symbols.map((s) => (s.id === symbolId ? { ...s, variants: s.variants.filter((v) => v.id !== variantId) } : s)),
  };
}

/* --------------------------- standalone elements --------------------------- */

export type StandaloneKind = StandaloneElement["kind"];

export function createStandalone(
  lib: import("./types").ElementLibrary,
  kind: StandaloneKind,
  input: { name?: string; description?: string; tags?: string[]; image?: AssetReference | null; group?: string } = {},
): { library: import("./types").ElementLibrary; id: string } {
  const taken = takenIds(lib);
  const prefix = kind === "game-title" ? "title" : kind === "game-background" ? "bg" : kind === "reel-frame" ? "frame" : kind === "button-set" ? "buttons" : kind === "uploaded" ? "upload" : "custom";
  const id = newStableId(`el-${prefix}`, taken);
  const base = {
    id,
    name: (input.name?.trim() || defaultStandaloneName(kind)).slice(0, 80),
    description: (input.description ?? "").slice(0, 800),
    tags: (input.tags ?? []).filter((t): t is string => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12),
    image: input.image ?? null,
  };
  let element: StandaloneElement;
  switch (kind) {
    case "game-title":
      element = { ...base, kind };
      break;
    case "game-background":
      element = { ...base, kind, aspect: "16:9" };
      break;
    case "reel-frame":
      element = { ...base, kind, style: "Themed" };
      break;
    case "button-set":
      element = { ...base, kind, buttons: ["spin"] };
      break;
    case "uploaded":
      element = { ...base, kind, group: (input.group ?? "Uploaded art").slice(0, 60) };
      break;
    case "custom":
      element = { ...base, kind, group: (input.group ?? "Other").slice(0, 60), params: {} };
      break;
  }
  return { library: { ...lib, standalone: [...lib.standalone, element] }, id };
}

function defaultStandaloneName(kind: StandaloneKind): string {
  switch (kind) {
    case "game-title":
      return "Game Title";
    case "game-background":
      return "Game Background";
    case "reel-frame":
      return "Reel Frame";
    case "button-set":
      return "Button Set";
    case "uploaded":
      return "Uploaded Element";
    case "custom":
      return "Custom Element";
  }
}

export function editStandalone(
  lib: import("./types").ElementLibrary,
  id: string,
  patch: Partial<{ name: string; description: string; tags: string[]; image: AssetReference | null; group: string; aspect: string; style: string; buttons: string[]; params: Record<string, number | string | boolean> }>,
): import("./types").ElementLibrary {
  return {
    ...lib,
    standalone: lib.standalone.map((el) => {
      if (el.id !== id) return el;
      const out = { ...el } as StandaloneElement & Record<string, unknown>;
      if (patch.name !== undefined) {
        const name = patch.name.replace(/\s+/g, " ").trim().slice(0, 80);
        if (name) out.name = name;
      }
      if (patch.description !== undefined) out.description = patch.description.slice(0, 800);
      if (patch.tags !== undefined) out.tags = patch.tags.filter((t) => typeof t === "string").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
      if (patch.image !== undefined) out.image = patch.image;
      if (patch.group !== undefined && (out.kind === "uploaded" || out.kind === "custom")) out.group = patch.group.slice(0, 60);
      if (patch.aspect !== undefined && out.kind === "game-background") (out as GameBackground).aspect = patch.aspect.slice(0, 40);
      if (patch.style !== undefined && out.kind === "reel-frame") (out as { style: string }).style = patch.style.slice(0, 40);
      if (patch.buttons !== undefined && out.kind === "button-set") {
        (out as { buttons: string[] }).buttons = Array.from(new Set(["spin", ...patch.buttons])).slice(0, 12);
      }
      if (patch.params !== undefined && out.kind === "custom") (out as CustomElement).params = { ...patch.params };
      return out as StandaloneElement;
    }),
  };
}

export function duplicateStandalone(
  lib: import("./types").ElementLibrary,
  id: string,
): { library: import("./types").ElementLibrary; id: string } {
  const source = lib.standalone.find((s) => s.id === id);
  if (!source) return { library: lib, id: "" };
  const taken = takenIds(lib);
  const newId = copyStableId(source.id, taken);
  const clone = {
    ...source,
    id: newId,
    name: copyName(source.name, lib.standalone.map((s) => s.name)),
    image: source.image ? { ...source.image } : null,
    tags: [...source.tags],
  } as StandaloneElement;
  if (clone.kind === "button-set") clone.buttons = [...(source as { buttons: string[] }).buttons];
  if (clone.kind === "custom") (clone as CustomElement).params = { ...(source as CustomElement).params };
  return { library: { ...lib, standalone: [...lib.standalone, clone] }, id: newId };
}

export function removeStandalone(
  lib: import("./types").ElementLibrary,
  id: string,
): import("./types").ElementLibrary {
  return { ...lib, standalone: lib.standalone.filter((s) => s.id !== id) };
}

/* --------------------------------- queries --------------------------------- */

export function membersOfSet(lib: import("./types").ElementLibrary, setId: string) {
  const set = lib.sets.find((s) => s.id === setId);
  if (!set) return [];
  const byId = new Map(lib.symbols.map((s) => [s.id, s]));
  return set.symbols.map((id) => byId.get(id)).filter((s): s is Symbol => Boolean(s));
}

export function ownerOfSymbol(lib: import("./types").ElementLibrary, symbolId: string) {
  return lib.sets.find((s) => s.symbols.includes(symbolId)) ?? null;
}

/** Resolves an independently addressable custom variant by its stable ID across the library. */
export function findVariantInLibrary(lib: import("./types").ElementLibrary, variantId: string) {
  for (const symbol of lib.symbols) {
    const variant = symbol.variants.find((v) => v.id === variantId);
    if (variant) {
      return { symbol, variant, set: ownerOfSymbol(lib, symbol.id) };
    }
  }
  return null;
}

export type ElementKindFilter = ElementKind | "all";

/** Validates stable ids and every reference. Returns human-readable issues. */
export function validateLibrary(lib: import("./types").ElementLibrary): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  const claim = (id: string, label: string) => {
    if (!isStableId(id)) issues.push(`${label} has an invalid id.`);
    else if (ids.has(id)) issues.push(`Duplicate id "${id}".`);
    else ids.add(id);
  };
  for (const s of lib.sets) claim(s.id, `Symbol set "${s.name}"`);
  for (const s of lib.symbols) {
    claim(s.id, `Symbol "${s.name}"`);
    for (const v of s.variants) claim(v.id, `Variant "${v.name}" of symbol "${s.name}"`);
  }
  for (const s of lib.standalone) claim(s.id, `Element "${s.name}"`);

  const symbolIds = new Set(lib.symbols.map((s) => s.id));
  for (const set of lib.sets) {
    for (const member of set.symbols) {
      if (!symbolIds.has(member)) issues.push(`Symbol set "${set.name}" references missing symbol "${member}".`);
    }
  }
  for (const symbol of lib.symbols) {
    if (symbol.symbolSetId !== null && !lib.sets.some((s) => s.id === symbol.symbolSetId)) {
      issues.push(`Symbol "${symbol.name}" references missing set "${symbol.symbolSetId}".`);
    }
    if (symbol.symbolSetId !== null && !lib.sets.find((s) => s.id === symbol.symbolSetId)?.symbols.includes(symbol.id)) {
      issues.push(`Symbol "${symbol.name}" is not listed as a member of its set.`);
    }
  }
  return issues;
}

export function storedSymbolTypeOf(canonical: SymbolType): import("@/lib/blueprint/types").SymbolSetType {
  return SYMBOL_TYPE_TO_STORED[canonical];
}

export function uploadedLabel(kind: ElementKind): string {
  const labels: Record<ElementKind, string> = {
    "symbol-set": "Symbol Set",
    symbol: "Symbol",
    "game-title": "Game Title",
    "game-background": "Game Background",
    "reel-frame": "Reel Frame",
    "button-set": "Button Set",
    uploaded: "Uploaded Element",
    custom: "Custom Element",
  };
  return labels[kind];
}

export type { UploadedElement, CustomElement };
