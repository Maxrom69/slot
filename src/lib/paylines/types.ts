/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F15 — Payline Editor Typed Domain Model
 *
 * Visual configuration only.
 * Actual winning evaluation, RNG, and payout calculation belong to
 * SECTION 2 — BACKEND / SLOT GAME ENGINE.
 */

export type PaylinePreset = "5" | "10" | "20" | "custom";

export type PaylineShapeKind =
  | "top"
  | "middle"
  | "bottom"
  | "v"
  | "inverted_v"
  | "zigzag"
  | "zigzag_inv"
  | "diagonal_down"
  | "diagonal_up";

export interface PaylineItemConfig {
  /** Stable payline identifier (e.g., "line-1"). */
  id: string;
  /** 1-based payline number (1..N). */
  index: number;
  /** Optional display label (defaults to `Payline #${index}`). */
  name?: string;
  /**
   * Row index (0..rows-1) for each reel column (0..columns-1).
   * A value of -1 (or out-of-range / NaN) indicates an unset or invalid column
   * that is visually highlighted in the editor and blocked from saving.
   */
  pattern: number[];
  /** Whether this payline is active in the game configuration. */
  active: boolean;
  /** Deterministic hex color assigned to this payline for visual differentiation. */
  color: string;
}

export interface PaylineConfigurationData {
  /** Number of reel columns in the grid (e.g., 5). */
  columns: number;
  /** Number of visible rows per reel in the grid (e.g., 3). */
  rows: number;
  /** Evaluation mode from the blueprint ("lines" | "ways" | "cluster"). */
  evaluation: "lines" | "ways" | "cluster";
  /** Active preset ("5" | "10" | "20" | "custom"). */
  preset: PaylinePreset;
  /** Ordered list of configured paylines. */
  paylines: PaylineItemConfig[];
  /** Optional requested count preserved from creation metadata. */
  requestedCount?: number;
  /** ISO timestamp of the last payline configuration update. */
  updatedAt?: string;
}

export type PaylineColumnIssueReason =
  | "missing_cell"
  | "row_out_of_bounds"
  | "non_integer_row"
  | "extra_column";

export interface PaylineColumnIssue {
  paylineId: string;
  paylineIndex: number;
  columnIndex: number;
  rowValue: number | undefined;
  reason: PaylineColumnIssueReason;
  message: string;
}

export type PaylineValidationIssueKind =
  | "missing_cell_in_reel"
  | "row_out_of_bounds"
  | "pattern_length_mismatch"
  | "duplicate_payline_pattern"
  | "duplicate_payline_id"
  | "empty_paylines"
  | "invalid_grid_dimensions";

export interface PaylineValidationIssue {
  id: string;
  kind: PaylineValidationIssueKind;
  severity: "error" | "warning";
  paylineId?: string;
  paylineIndex?: number;
  columnIndex?: number;
  message: string;
}

export interface PaylineValidationReport {
  /** True when all integrity & completeness checks pass. */
  valid: boolean;
  /**
   * True when no malformed paylines exist (prevents saving malformed paylines).
   * Every payline must have a valid row index (0..rows-1) for every column (0..columns-1)
   * and no duplicate patterns.
   */
  canSave: boolean;
  /** Map of paylineId -> sorted array of invalid 0-based column indices. */
  invalidColumnsByPaylineId: Record<string, number[]>;
  /** Detailed column-level issues across all paylines. */
  columnIssues: PaylineColumnIssue[];
  /** All structural validation issues. */
  issues: PaylineValidationIssue[];
  /** Summary booleans for the 5 core structural checks. */
  checks: {
    gridDimensionsValid: boolean;
    oneCellPerReelValid: boolean;
    rowBoundsValid: boolean;
    uniquePatternsValid: boolean;
    paylinesDefined: boolean;
  };
}

export interface PaylinePathPoint {
  columnIndex: number;
  rowIndex: number;
  /** Normalized X coordinate in [0..width]. */
  x: number;
  /** Normalized Y coordinate in [0..height]. */
  y: number;
}

export interface PaylinePathGeometry {
  paylineId: string;
  color: string;
  points: PaylinePathPoint[];
  /** SVG `<polyline points="...">` attribute string. */
  polylinePoints: string;
  /** SVG `<path d="...">` attribute string. */
  svgPathD: string;
  /** True if every column 0..columns-1 had a valid row in 0..rows-1. */
  complete: boolean;
}
