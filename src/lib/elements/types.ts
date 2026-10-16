/**
 * F07 — Typed element system.
 *
 * Canonical domain model for everything the Studio constructs. These types are
 * the contract: visual configuration data lives here, rendering components
 * only read it. The Game Blueprint remains the persisted form; see
 * `blueprint-adapter.ts` for the lossless mapping.
 *
 * No gameplay evaluation lives here. `mathId`, `isWild` and `isScatter` are
 * opaque configuration flags consumed only by the SECTION 2 engine.
 */

import type {
  AssetReference,
  CanonicalSymbolType,
  ElementAnimationConfig,
  ElementStyleConfig,
  ImageRevision,
  SymbolSetType,
  SymbolVariant,
  ValueTier,
} from "@/lib/blueprint/types";

/** Element kinds used throughout the Studio. */
export type ElementKind =
  | "symbol-set"
  | "symbol"
  | "game-title"
  | "game-background"
  | "reel-frame"
  | "button-set"
  | "uploaded"
  | "custom";

/** Conceptual symbol types from the spec. */
export type SymbolType = CanonicalSymbolType;

/** Documented F07 display labels for conceptual symbol types. */
export type ConceptualSymbolTypeLabel = "Characters" | "Deck Ranks" | "Suits" | "Custom";

export const CONCEPTUAL_SYMBOL_TYPES: readonly SymbolType[] = [
  "characters",
  "ranks",
  "suits",
  "custom",
] as const;

export const VALUE_TIERS_LIST: readonly ValueTier[] = [
  "high",
  "medium",
  "low",
  "special",
] as const;

export type { AssetReference, SymbolVariant };
export type { ValueTier };

/** Maps the canonical symbol type to the stored SymbolSetType union. */
export const SYMBOL_TYPE_TO_STORED: Record<SymbolType, SymbolSetType> = {
  characters: "character",
  ranks: "royals",
  suits: "suits",
  custom: "custom",
};

/** Maps a stored SymbolSetType to its canonical conceptual type. */
export function canonicalSymbolType(stored: SymbolSetType): SymbolType {
  switch (stored) {
    case "character":
      return "characters";
    case "royals":
      return "ranks";
    case "suits":
      return "suits";
    case "custom":
      return "custom";
    case "seven":
    case "bar":
    default:
      return "custom";
  }
}

export const SYMBOL_TYPE_LABELS: Record<SymbolType, string> = {
  characters: "Characters",
  ranks: "Deck Ranks",
  suits: "Suits",
  custom: "Custom",
};

export const VALUE_TIER_LABELS: Record<ValueTier, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  special: "Special",
};

export interface ElementBase {
  id: string;
  kind: ElementKind;
  name: string;
  description: string;
  tags: string[];
  /** Storage-agnostic image reference. Null = deterministic placeholder. */
  image: AssetReference | null;
  imageHistory?: ImageRevision[];
  variants?: SymbolVariant[];
  extras?: Record<string, number | string | boolean>;
  styleConfig?: ElementStyleConfig;
  animation?: ElementAnimationConfig;
}

export interface SymbolSet extends ElementBase {
  kind: "symbol-set";
  symbolType: SymbolType;
  valueTier: ValueTier;
  frame: AssetReference | null;
  background: AssetReference | null;
  /** Member symbol ids, in display order. */
  symbols: string[];
  styleGuide: string;
}

export interface Symbol {
  id: string;
  name: string;
  /** Owning set id. Null for standalone symbols. */
  symbolSetId: string | null;
  symbolType: SymbolType;
  tier: ValueTier;
  image: AssetReference | null;
  /** Independent custom variants, each with its own stable id. */
  variants: SymbolVariant[];
  /** Free-form custom data. Never evaluated by the studio. */
  extras: Record<string, number | string | boolean>;
  /** Opaque gameplay identifier for the SECTION 2 engine. */
  mathId: string | null;
  isWild: boolean;
  isScatter: boolean;
  isBonus?: boolean;
  family?: string;
  imageHistory?: ImageRevision[];
  /** Legacy presentation fields preserved for existing blueprints. */
  code: string;
  glyph: string;
  reelWeight: number;
  payouts: Record<string, number>;
  description: string;
  tags: string[];
}

export interface GameTitle extends ElementBase {
  kind: "game-title";
}

export interface GameBackground extends ElementBase {
  kind: "game-background";
  aspect: string;
}

export interface ReelFrame extends ElementBase {
  kind: "reel-frame";
  style: string;
}

export interface ButtonSet extends ElementBase {
  kind: "button-set";
  buttons: string[];
}

export interface UploadedElement extends ElementBase {
  kind: "uploaded";
  group: string;
}

export interface CustomElement extends ElementBase {
  kind: "custom";
  group: string;
  params: Record<string, number | string | boolean>;
}

export type StandaloneElement =
  | GameTitle
  | GameBackground
  | ReelFrame
  | ButtonSet
  | UploadedElement
  | CustomElement;

export type StudioElement = SymbolSet | StandaloneElement;

/** Normalized in-memory library: the unit the element service operates on. */
export interface ElementLibrary {
  sets: SymbolSet[];
  symbols: Symbol[];
  standalone: StandaloneElement[];
}

export const EMPTY_LIBRARY: ElementLibrary = { sets: [], symbols: [], standalone: [] };
