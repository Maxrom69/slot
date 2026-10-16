/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F14 — Reel Configuration Editor Domain Model & Types.
 *
 * CONFIGURATION ONLY:
 * Defines declarative reel strips, stop positions, per-stop weights, symbol
 * palette search metadata, text-view parsing, and structural validation.
 * Actual RNG and reel-spin evaluation belong strictly to SECTION 2.
 */

import type { SymbolSetType, SymbolTier } from "@/lib/blueprint/types";

export const MIN_REEL_COUNT = 3;
export const MAX_REEL_COUNT = 8;

/** One stop entry on a reel strip. */
export interface ReelStopConfig {
  /** Unique stop instance identifier (used for drag-and-drop and corruption detection). */
  id: string;
  /** 1-based position along the reel strip (1..N). */
  position: number;
  /** Symbol ID referenced at this stop. */
  symbolId: string;
  /** Optional weight for this stop when per-stop weights are enabled. */
  weight?: number;
}

/** One reel strip definition ("Reel 1", "Reel 2", ...). */
export interface ReelStripDef {
  /** Stable reel identifier (e.g., "reel-1"). */
  id: string;
  /** 0-based reel index (0..columns-1). */
  index: number;
  /** Human-readable reel label ("Reel 1", "Reel 2", ...). */
  name: string;
  /** Ordered stops on this reel. */
  stops: ReelStopConfig[];
}

/** Complete Reel Configuration stored in `GameBlueprint.reelConfiguration`. */
export interface ReelConfigurationData {
  /** Number of reels. */
  columns: number;
  /** Number of visible rows per reel. */
  rows: number;
  /** Evaluation mode configured for the game. */
  evaluation: "lines" | "ways" | "cluster";
  /** Visual spin direction. */
  spinDirection: "down" | "up";
  /** Compact symbol-ID matrix (`strips[reelIndex][stopIndex]`), kept in sync with `reels`. */
  strips: string[][];
  /** Whether per-stop weights are enabled. */
  weightsEnabled: boolean;
  /** Rich per-reel stop list with stop IDs, positions, and weights. */
  reels: ReelStripDef[];
  /** Last modified ISO timestamp. */
  updatedAt?: string;
}

/** Searchable item in the F14 Symbol Palette. */
export interface SymbolPaletteItem {
  id: string;
  code: string;
  name: string;
  tier: SymbolTier;
  glyph: string;
  assetId: string | null;
  artworkUri: string | null;
  artworkName: string;
  hasArtwork: boolean;
  reelWeight: number;
  symbolSetId: string | null;
  symbolType: SymbolSetType;
  tags: string[];
  isWild?: boolean;
  isScatter?: boolean;
  isBonus?: boolean;
}

/** Filter options for the Symbol Palette. */
export interface SymbolPaletteFilter {
  query?: string;
  tier?: SymbolTier | "all";
  artwork?: "all" | "linked" | "placeholder";
}

/** Validation issue categories required by F14. */
export type ReelValidationIssueKind =
  | "unknown_symbol_id"
  | "empty_reel"
  | "invalid_weight"
  | "duplicate_stop_corruption"
  | "invalid_reel_count";

/** One structural validation issue detected in the reel configuration. */
export interface ReelValidationIssue {
  id: string;
  kind: ReelValidationIssueKind;
  severity: "error" | "warning";
  reelIndex?: number;
  reelId?: string;
  stopIndex?: number;
  stopId?: string;
  symbolId?: string;
  message: string;
}

/** Complete non-RNG validation report for a ReelConfigurationData. */
export interface ReelValidationReport {
  valid: boolean;
  issues: ReelValidationIssue[];
  unknownSymbolIds: string[];
  emptyReelIndices: number[];
  invalidWeightStops: Array<{
    reelIndex: number;
    stopIndex: number;
    stopId: string;
    weight: unknown;
  }>;
  duplicateStopIds: string[];
  corruptedPositionStops: Array<{
    reelIndex: number;
    stopIndex: number;
    expectedPosition: number;
    actualPosition: number;
  }>;
  invalidReelCount: boolean;
  summary: {
    totalReels: number;
    totalStops: number;
    uniqueSymbolsUsed: number;
  };
}

/** Result of parsing whitespace- or comma-separated stop IDs in Text View. */
export interface ReelTextParseResult {
  tokens: string[];
  validSymbolIds: string[];
  unknownSymbolIds: string[];
  isValid: boolean;
}
