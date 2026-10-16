import type { AssetRef, ElementDef, ElementType, SymbolDef } from "@/lib/blueprint/types";
import { isLinked } from "./model";
import type { DesignDoc } from "./types";

export type StatusKey = "empty" | "planned" | "partial" | "ready";
export interface StatusInfo {
  key: StatusKey;
  label: string;
  detail: string;
}
export interface SetView {
  element: ElementDef;
  symbols: SymbolDef[];
  withArt: number;
  status: StatusInfo;
}

export const assetOf = (doc: DesignDoc, id: string | null): AssetRef | null =>
  id ? (doc.assets.find((a) => a.id === id) ?? null) : null;

export function symbolImage(doc: DesignDoc, symbol: SymbolDef): (AssetRef & { uri: string }) | null {
  const asset = assetOf(doc, symbol.assetId);
  if (isLinked(asset)) return asset;
  if (symbol.image?.provider === "project" && symbol.image.assetId) {
    const proj = assetOf(doc, symbol.image.assetId);
    if (isLinked(proj)) return proj;
  }
  if (symbol.image?.provider === "external" && symbol.image.uri) {
    return {
      id: `ext-${symbol.id}`,
      name: symbol.image.name ?? symbol.image.uri,
      kind: "image",
      uri: symbol.image.uri,
      state: "linked",
      tags: [],
    };
  }
  return null;
}

/** The single image an element shows. Sets have none (they show their members). */
export function elementImage(doc: DesignDoc, element: ElementDef): (AssetRef & { uri: string }) | null {
  if (element.type === "symbol_set") return null;
  if (element.type === "symbol") {
    const symbol = doc.symbols.find((s) => s.id === element.symbolIds[0]);
    return symbol ? symbolImage(doc, symbol) : null;
  }
  const asset = assetOf(doc, element.assetId);
  if (isLinked(asset)) return asset;
  if (element.image?.provider === "project" && element.image.assetId) {
    const proj = assetOf(doc, element.image.assetId);
    if (isLinked(proj)) return proj;
  }
  if (element.image?.provider === "external" && element.image.uri) {
    return {
      id: `ext-${element.id}`,
      name: element.image.name ?? element.image.uri,
      kind: "image",
      uri: element.image.uri,
      state: "linked",
      tags: [],
    };
  }
  return null;
}

export function setStatus(withArt: number, total: number): StatusInfo {
  if (total === 0) return { key: "empty", label: "Empty", detail: "No symbols yet" };
  if (withArt === 0) return { key: "planned", label: "Planned", detail: "No artwork linked" };
  if (withArt < total) return { key: "partial", label: "Partial", detail: `${withArt} of ${total} have artwork` };
  return { key: "ready", label: "Ready", detail: "All symbols have artwork" };
}

export function standaloneStatus(doc: DesignDoc, element: ElementDef): StatusInfo {
  return elementImage(doc, element)
    ? { key: "ready", label: "Ready", detail: "Artwork linked" }
    : { key: "planned", label: "Planned", detail: "No artwork linked" };
}

export function elementStatus(doc: DesignDoc, element: ElementDef): StatusInfo {
  if (element.type !== "symbol_set") return standaloneStatus(doc, element);
  const symbols = membersOf(doc, element);
  return setStatus(symbols.filter((s) => symbolImage(doc, s)).length, symbols.length);
}

export function membersOf(doc: DesignDoc, element: ElementDef): SymbolDef[] {
  const byId = new Map(doc.symbols.map((s) => [s.id, s]));
  return element.symbolIds.map((id) => byId.get(id)).filter((s): s is SymbolDef => Boolean(s));
}

export function selectSets(doc: DesignDoc): SetView[] {
  return doc.elements
    .filter((e) => e.type === "symbol_set")
    .map((element) => {
      const symbols = membersOf(doc, element);
      const withArt = symbols.filter((s) => symbolImage(doc, s)).length;
      return { element, symbols, withArt, status: setStatus(withArt, symbols.length) };
    });
}

export const selectStandalone = (doc: DesignDoc): ElementDef[] => doc.elements.filter((e) => e.type !== "symbol_set");
export const findElement = (doc: DesignDoc, id: string | null | undefined) =>
  id ? (doc.elements.find((e) => e.id === id) ?? null) : null;

export function findSymbol(doc: DesignDoc, id: string) {
  const symbol = doc.symbols.find((s) => s.id === id);
  if (!symbol) return null;
  return { symbol, owner: doc.elements.find((e) => e.symbolIds.includes(id)) ?? null };
}

/** Resolves any custom symbol variant by its own independent stable ID. */
export function findVariant(doc: DesignDoc, variantId: string) {
  for (const symbol of doc.symbols) {
    const variant = (symbol.variants ?? []).find((v) => v.id === variantId);
    if (variant) {
      return {
        symbol,
        variant,
        owner: doc.elements.find((e) => e.symbolIds.includes(symbol.id)) ?? null,
      };
    }
  }
  return null;
}

export function matchesQuery(query: string, ...parts: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = parts.join(" ").toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export type StandaloneFilter = "all" | Exclude<ElementType, "symbol_set">;
export const STANDALONE_FILTERS: { id: StandaloneFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "symbol", label: "Symbols" },
  { id: "game_title", label: "Title" },
  { id: "game_background", label: "Backgrounds" },
  { id: "reel_frame", label: "Frames" },
  { id: "button_set", label: "Buttons" },
  { id: "uploaded", label: "Uploaded" },
  { id: "custom", label: "Custom" },
  { id: "other_asset", label: "Other" },
];
