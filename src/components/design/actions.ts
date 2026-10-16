import type { AssetReference, ValueTier } from "@/lib/blueprint/types";
import type { ElementPatch, ImageTarget, Selection, SymbolPatch } from "@/lib/design/types";

/** Everything the Design UI can do. Implemented once in DesignApp; components only call it. */
export interface DesignActions {
  select(selection: Selection): void;
  /** Select and focus the name field in the inspector. */
  edit(elementId: string): void;
  open(elementId: string): void;
  duplicate(elementId: string): void;
  requestDelete(target: { kind: "element" | "symbol"; id: string }): void;
  replaceImage(target: ImageTarget): void;
  removeImage(target: ImageTarget): void;
  download(target: ImageTarget): void;
  rename(elementId: string, name: string): void;
  renameSymbol(symbolId: string, name: string): void;
  updateElement(elementId: string, patch: ElementPatch, label: string): void;
  updateSymbol(symbolId: string, patch: SymbolPatch, label: string): void;
  setSymbolTier(symbolId: string, tier: ValueTier): void;
  addSymbol(setId: string): void;
  importIntoSet(setId: string): void;
  /** Duplicates one symbol in its set under fresh stable ids. */
  duplicateSymbol(symbolId: string): void;
  /** Moves a symbol one step within its owning set. */
  moveSymbol(setId: string, symbolId: string, delta: number): void;
  /** Opens the dedicated Symbol Set management interface. */
  manageSet(setId: string): void;
  /** Opens the dedicated Symbol editor interface. */
  openSymbol?(symbolId: string): void;
  addVariant(symbolId: string): void;
  renameVariant(symbolId: string, variantId: string, name: string): void;
  duplicateVariant(symbolId: string, variantId: string): void;
  removeVariant(symbolId: string, variantId: string): void;
  setVariantImage(symbolId: string, variantId: string, image: AssetReference | null): void;
}
