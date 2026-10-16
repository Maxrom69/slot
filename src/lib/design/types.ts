import type {
  AnimationMeta,
  AssetRef,
  ElementAnimationConfig,
  ElementDef,
  ElementStyleConfig,
  ElementType,
  LayerDef,
  PaytableEntry,
  SceneDef,
  SpecialSymbolDef,
  SymbolDef,
  SymbolSetMeta,
  SymbolSetType,
  SymbolVariant,
  ValueTier,
} from "@/lib/blueprint/types";

/**
 * The slice of the Game Blueprint the Design view owns. Pure serialisable data:
 * no rendering, no engine behaviour. `symbolSets` and `canvas.backgroundAssetId`
 * are derived from it when it is applied to a blueprint.
 */
export interface DesignDoc {
  elements: ElementDef[];
  symbols: SymbolDef[];
  specialSymbols: SpecialSymbolDef[];
  assets: AssetRef[];
  paytable: PaytableEntry[];
  strips: string[][];
  /** Read-only context: protects the style reference from asset pruning. */
  referenceAssetId: string | null;
  /** Assets referenced by scene layout elsewhere in the blueprint. Transient; never stored. */
  protectedAssetIds?: string[];
  /** Animation metadata cues editable from the Element Detail View (F11). */
  animations?: AnimationMeta[];
  /** Read-only scene context for element usage tracking (F11). */
  scenes?: SceneDef[];
  /** Read-only layer context for element usage tracking (F11). */
  layers?: LayerDef[];
}

export interface OpContext {
  /** Theme glyphs used as placeholder faces for new symbols. */
  glyphs: string[];
}

export type SpecialKind = "wild" | "scatter" | "bonus";

export type NewElementInput =
  | { type: "symbol_set"; name: string; symbolType: SymbolSetType; valueTier: ValueTier; count: number; description?: string; styleGuide?: string; tags?: string[] }
  | { type: "symbol"; name: string; valueTier: ValueTier; behaviour?: SpecialKind; asset?: AssetRef }
  | { type: "reel_frame"; name: string; style: string; asset?: AssetRef }
  | { type: "game_background"; name: string; aspect: string; asset?: AssetRef }
  | { type: "button_set"; name: string; buttons: string[]; asset?: AssetRef }
  | { type: "game_title" | "uploaded" | "custom" | "other_asset"; name: string; group?: string; asset?: AssetRef };

export interface SymbolSpec {
  name?: string;
  asset?: AssetRef;
}

export interface ImportItem {
  asset: AssetRef;
  elementType: ElementType;
  name: string;
}

export interface ImportSetOptions {
  name: string;
  symbolType: SymbolSetType;
  valueTier: ValueTier;
}

export interface ElementPatch {
  notes?: string;
  description?: string;
  tags?: string[];
  group?: string;
  params?: Record<string, number | string | boolean>;
  image?: import("@/lib/blueprint/types").AssetReference | null;
  imageSource?: NonNullable<ElementDef["imageHistory"]>[number]["source"];
  imageNotes?: string;
  symbolSet?: Partial<SymbolSetMeta>;
  style?: Partial<ElementStyleConfig>;
  variants?: SymbolVariant[];
  extras?: Record<string, number | string | boolean>;
  animation?: Partial<ElementAnimationConfig>;
  animationExtra?: string;
}

export interface SymbolPatch {
  name?: string;
  symbolType?: import("@/lib/blueprint/types").SymbolSetType;
  family?: string;
  tier?: import("@/lib/blueprint/types").SymbolTier;
  image?: import("@/lib/blueprint/types").AssetReference | null;
  /** Source recorded for this image revision when changing artwork. */
  imageSource?: NonNullable<SymbolDef["imageHistory"]>[number]["source"];
  /** Notes recorded for this image revision when replacing artwork. */
  imageNotes?: string;
  extras?: Record<string, number | string | boolean>;
  mathId?: string | null;
  isWild?: boolean;
  isScatter?: boolean;
  isBonus?: boolean;
  description?: string;
  tags?: string[];
  code?: string;
  glyph?: string;
  payouts?: Record<string, number>;
  reelWeight?: number;
}

export interface DeletionImpact {
  kind: "element" | "symbol";
  name: string;
  symbols: number;
  paytableRows: number;
  stripPositions: number;
}

export type Selection =
  | { kind: "element"; id: string }
  | { kind: "symbol"; id: string; elementId: string }
  | null;

export type ImageTarget = { kind: "element"; id: string } | { kind: "symbol"; id: string };
