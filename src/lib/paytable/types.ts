/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F16 — Paytable Editor Typed Domain Model.
 *
 * Purely declarative paytable configuration and structural validation contracts.
 * Does NOT calculate RTP, hit rate, or Monte Carlo simulations (those belong to SECTION 2).
 */

import type {
  PaytableEntry,
  SymbolSetType,
  SymbolTier,
} from "@/lib/blueprint/types";

export const MIN_SUPPORTED_MATCH_COUNT = 2 as const;
export const MAX_SUPPORTED_MATCH_COUNT = 8 as const;

export interface PaytableSymbolRowConfig {
  /** Stable symbol ID from `GameBlueprint.symbols`. */
  symbolId: string;
  /** Short symbol code (e.g., "A", "K", "M1", "H1", "WILD", "SCAT"). */
  code: string;
  /** Display name of the symbol. */
  name: string;
  /** Value tier ("low" | "mid" | "high" | "special"). */
  tier: SymbolTier;
  /** Symbol family / group label (e.g., "Royals", "Medium Symbols", "High Symbols", "Special"). */
  family: string;
  /** Optional conceptual symbol set type ("character" | "royals" | "suits" | "custom" | ...). */
  symbolType?: SymbolSetType;
  /** Fallback glyph when no raster/vector asset is linked. */
  glyph: string;
  /** Linked project asset ID, if any. */
  assetId: string | null;
  /** Resolved image URI for thumbnail rendering. */
  thumbnailUri: string | null;
  /** Wild role flag (editable via Wild toggle in F16). */
  isWild: boolean;
  /** Scatter role flag (visible and editable where relevant). */
  isScatter: boolean;
  /** Bonus role flag (visible where relevant). */
  isBonus: boolean;
  /** Baseline default Wild flag for override detection and row reset. */
  defaultIsWild: boolean;
  /** Baseline default Scatter flag for override detection and row reset. */
  defaultIsScatter: boolean;
  /** Baseline default Bonus flag for override detection and row reset. */
  defaultIsBonus: boolean;
  /** Current payout multiplier keyed by match count string ("2", "3", "4", "5", "6", ...). */
  payouts: Record<string, number>;
  /** Configured default payout multiplier keyed by match count string. */
  defaultPayouts: Record<string, number>;
  /** Optional raw string input map for in-progress cell editing and validation of non-numeric text. */
  rawInputs?: Record<string, string>;
}

export interface PaytableConfigurationData {
  /** Active reel column count derived from `GameBlueprint.reels` / `reelConfiguration`. */
  columns: number;
  /** Active row count derived from `GameBlueprint.reels` / `reelConfiguration`. */
  rows: number;
  /** Evaluation mode ("lines" | "ways" | "cluster"). */
  evaluation: "lines" | "ways" | "cluster";
  /** Minimum visible match count (defaults to 2 so 2..columns are shown). */
  minMatchCount: number;
  /** Ordered visible match counts derived from the grid/reel configuration (e.g., [2, 3, 4, 5, 6]). */
  matchCounts: number[];
  /** Ordered symbol rows in the paytable matrix. */
  symbolRows: PaytableSymbolRowConfig[];
  /** Flattened `PaytableEntry[]` synchronized with `symbolRows` and `GameBlueprint.paytable`. */
  entries: PaytableEntry[];
  /** ISO timestamp of last paytable configuration edit. */
  updatedAt?: string;
}

export type PaytableValidationErrorKind =
  | "negative_payout"
  | "nan_payout"
  | "invalid_numeric"
  | "invalid_match_count"
  | "unknown_symbol"
  | "duplicate_symbol";

export interface PaytableCellIssue {
  symbolId: string;
  symbolName: string;
  matchCount: number;
  kind: PaytableValidationErrorKind;
  rawValue: string | number;
  message: string;
}

export interface PaytableValidationIssue {
  id: string;
  severity: "error" | "warning";
  kind: PaytableValidationErrorKind;
  symbolId?: string;
  symbolName?: string;
  matchCount?: number;
  message: string;
}

export interface PaytableValidationReport {
  valid: boolean;
  canSave: boolean;
  issues: PaytableValidationIssue[];
  /** Map of `symbolId -> matchCount[]` with invalid cells for instant UI highlighting. */
  invalidCellsBySymbolId: Record<string, number[]>;
  /** Map of `${symbolId}:${matchCount}` -> PaytableCellIssue. */
  cellIssueMap: Record<string, PaytableCellIssue>;
  checks: {
    matchCountsValid: boolean;
    noNegativePayouts: boolean;
    noNaNOrInvalidNumeric: boolean;
    symbolsConsistent: boolean;
  };
}
