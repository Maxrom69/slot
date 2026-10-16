/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F15 — Payline Editor Pure Operations, Presets, Shapes, Geometry & Validation
 *
 * Strictly visual configuration and structural validation.
 * Does NOT calculate winnings, RNG outcomes, or RTP metrics.
 */

import { generatePaylines, maxPaylines } from "@/lib/blueprint/factory";
import type { GameBlueprint, PaylineDef } from "@/lib/blueprint/types";
import type {
  PaylineColumnIssue,
  PaylineConfigurationData,
  PaylineItemConfig,
  PaylinePathGeometry,
  PaylinePathPoint,
  PaylinePreset,
  PaylineShapeKind,
  PaylineValidationIssue,
  PaylineValidationReport,
} from "./types";

/**
 * Deterministic 25-color studio palette for visually differentiating paylines.
 */
export const PAYLINE_COLOR_PALETTE: readonly string[] = [
  "#f59e0b", // #1 Amber
  "#38bdf8", // #2 Sky
  "#ec4899", // #3 Pink
  "#10b981", // #4 Emerald
  "#a855f7", // #5 Purple
  "#f97316", // #6 Orange
  "#06b6d4", // #7 Cyan
  "#eab308", // #8 Yellow
  "#ef4444", // #9 Red
  "#22c55e", // #10 Green
  "#6366f1", // #11 Indigo
  "#14b8a6", // #12 Teal
  "#f43f5e", // #13 Rose
  "#84cc16", // #14 Lime
  "#8b5cf6", // #15 Violet
  "#0ea5e9", // #16 Light Blue
  "#d946ef", // #17 Fuchsia
  "#fb923c", // #18 Light Orange
  "#2dd4bf", // #19 Aqua
  "#facc15", // #20 Gold
  "#60a5fa", // #21 Blue
  "#fb7185", // #22 Coral
  "#34d399", // #23 Mint
  "#c084fc", // #24 Lavender
  "#fbbf24", // #25 Warm Amber
] as const;

/**
 * Deterministically assigns a color to a payline based on its 1-based payline number.
 */
export function getPaylineColor(paylineNumber: number): string {
  const normalized = Math.max(1, Math.floor(paylineNumber)) - 1;
  return PAYLINE_COLOR_PALETTE[normalized % PAYLINE_COLOR_PALETTE.length]!;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Re-indexes paylines sequentially (1..N) and ensures deterministic colors.
 */
export function normalizePaylineItems(
  items: PaylineItemConfig[],
): PaylineItemConfig[] {
  const seenIds = new Set<string>();
  return items.map((item, idx) => {
    const number = idx + 1;
    let id = item.id?.trim() || `line-${number}`;
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}-${suffix}`)) suffix += 1;
      id = `${id}-${suffix}`;
    }
    seenIds.add(id);
    return {
      ...item,
      id,
      index: number,
      name: item.name?.trim() || `Payline #${number}`,
      pattern: [...item.pattern],
      active: Boolean(item.active),
      color: getPaylineColor(number),
    };
  });
}

/**
 * Detects whether a set of paylines matches one of the standard presets (5, 10, 20)
 * or is a custom configuration.
 */
export function detectPaylinePreset(
  paylines: Array<{ pattern: number[]; active?: boolean }>,
  columns: number,
  rows: number,
): PaylinePreset {
  const counts: Array<{ preset: PaylinePreset; count: number }> = [
    { preset: "5", count: 5 },
    { preset: "10", count: 10 },
    { preset: "20", count: 20 },
  ];

  for (const { preset, count } of counts) {
    const canonical = generatePaylines(columns, rows, count);
    if (
      paylines.length === canonical.length &&
      paylines.every(
        (line, i) =>
          line.pattern.length === canonical[i]!.pattern.length &&
          line.pattern.every((r, c) => r === canonical[i]!.pattern[c]),
      )
    ) {
      return preset;
    }
  }
  return "custom";
}

/**
 * Extracts or derives a full `PaylineConfigurationData` from a `GameBlueprint`.
 */
export function paylineConfigurationFromBlueprint(
  bp: GameBlueprint,
): PaylineConfigurationData {
  const columns = bp.reelConfiguration?.columns ?? bp.reels?.columns ?? 5;
  const rows = bp.reelConfiguration?.rows ?? bp.reels?.rows ?? 3;
  const evaluation =
    bp.reelConfiguration?.evaluation ?? bp.reels?.evaluation ?? "lines";

  if (bp.paylineConfiguration && Array.isArray(bp.paylineConfiguration.paylines)) {
    const cfg = bp.paylineConfiguration;
    const rawItems: PaylineItemConfig[] = cfg.paylines.map((line, idx) => ({
      id: line.id || `line-${idx + 1}`,
      index: idx + 1,
      name: line.name || `Payline #${idx + 1}`,
      pattern: [...line.pattern],
      active: Boolean(line.active),
      color: line.color || getPaylineColor(idx + 1),
    }));
    const normalized = normalizePaylineItems(rawItems);
    return {
      columns,
      rows,
      evaluation,
      preset:
        cfg.preset ?? detectPaylinePreset(normalized, columns, rows),
      paylines: normalized,
      requestedCount:
        cfg.requestedCount ??
        bp.creation?.requestedPaylineCount ??
        normalized.length,
      updatedAt: cfg.updatedAt ?? bp.meta?.updatedAt,
    };
  }

  const rawPaylines = bp.paylines ?? [];
  const items: PaylineItemConfig[] = rawPaylines.map((line, idx) => ({
    id: line.id || `line-${idx + 1}`,
    index: idx + 1,
    name: `Payline #${idx + 1}`,
    pattern: [...line.pattern],
    active: Boolean(line.active),
    color: getPaylineColor(idx + 1),
  }));
  const normalized = normalizePaylineItems(items);

  return {
    columns,
    rows,
    evaluation,
    preset: detectPaylinePreset(normalized, columns, rows),
    paylines: normalized,
    requestedCount: bp.creation?.requestedPaylineCount ?? normalized.length,
    updatedAt: bp.meta?.updatedAt,
  };
}

/**
 * Converts `PaylineItemConfig[]` to blueprint `PaylineDef[]`.
 */
export function toBlueprintPaylines(
  items: PaylineItemConfig[],
): PaylineDef[] {
  return normalizePaylineItems(items).map((item) => ({
    id: item.id,
    index: item.index,
    pattern: [...item.pattern],
    active: item.active,
    color: item.color,
    name: item.name,
  }));
}

/**
 * Saves `PaylineConfigurationData` into `GameBlueprint.paylineConfiguration`
 * and synchronizes `GameBlueprint.paylines`.
 *
 * Throws an error if `options.allowMalformed` is not true and the configuration
 * contains malformed paylines (preventing saving malformed paylines).
 */
export function applyPaylineConfigurationToBlueprint(
  bp: GameBlueprint,
  config: PaylineConfigurationData,
  options?: { allowMalformed?: boolean },
): GameBlueprint {
  const validation = validatePaylineConfiguration(config);
  if (!options?.allowMalformed && !validation.canSave) {
    const firstError =
      validation.issues.find((i) => i.severity === "error")?.message ??
      "Cannot save malformed paylines.";
    throw new Error(firstError);
  }

  const now = new Date().toISOString();
  const normalizedItems = normalizePaylineItems(config.paylines);
  const nextPaylineConfiguration: PaylineConfigurationData = {
    columns: config.columns,
    rows: config.rows,
    evaluation: config.evaluation,
    preset: config.preset,
    paylines: normalizedItems,
    requestedCount: config.requestedCount ?? normalizedItems.length,
    updatedAt: now,
  };

  return {
    ...bp,
    meta: {
      ...bp.meta,
      updatedAt: now,
    },
    reels: {
      ...bp.reels,
      evaluation: config.evaluation,
    },
    ...(bp.reelConfiguration
      ? {
          reelConfiguration: {
            ...bp.reelConfiguration,
            evaluation: config.evaluation,
          },
        }
      : {}),
    paylines:
      config.evaluation === "lines" ? toBlueprintPaylines(normalizedItems) : [],
    paylineConfiguration: nextPaylineConfiguration,
  };
}

/**
 * RULE: Each payline must contain exactly one cell per reel.
 * Clicking a cell `(columnIndex, rowIndex)` sets that reel column's row index
 * on the target payline, replacing whatever row was previously selected in that column.
 */
export function setPaylineCell(
  config: PaylineConfigurationData,
  paylineId: string,
  columnIndex: number,
  rowIndex: number,
): PaylineConfigurationData {
  if (columnIndex < 0 || columnIndex >= config.columns) return config;
  const clampedRow = clamp(Math.round(rowIndex), 0, config.rows - 1);

  const nextPaylines = config.paylines.map((line) => {
    if (line.id !== paylineId) return line;
    const nextPattern = Array.from({ length: config.columns }, (_, col) => {
      if (col === columnIndex) return clampedRow;
      return line.pattern[col] !== undefined ? line.pattern[col]! : -1;
    });
    return {
      ...line,
      pattern: nextPattern,
    };
  });

  return {
    ...config,
    preset: "custom",
    paylines: nextPaylines,
  };
}

/**
 * Unsets a column on a payline (sets `pattern[columnIndex] = -1`),
 * causing that column to be flagged and highlighted as invalid until a cell is selected.
 */
export function clearPaylineColumn(
  config: PaylineConfigurationData,
  paylineId: string,
  columnIndex: number,
): PaylineConfigurationData {
  if (columnIndex < 0 || columnIndex >= config.columns) return config;

  const nextPaylines = config.paylines.map((line) => {
    if (line.id !== paylineId) return line;
    const nextPattern = Array.from({ length: config.columns }, (_, col) =>
      col === columnIndex ? -1 : (line.pattern[col] ?? -1),
    );
    return {
      ...line,
      pattern: nextPattern,
    };
  });

  return {
    ...config,
    preset: "custom",
    paylines: nextPaylines,
  };
}

/**
 * Sets the full pattern array on a payline (e.g. from a shape generator or direct edit).
 */
export function setPaylinePattern(
  config: PaylineConfigurationData,
  paylineId: string,
  pattern: number[],
): PaylineConfigurationData {
  const nextPaylines = config.paylines.map((line) =>
    line.id === paylineId
      ? {
          ...line,
          pattern: [...pattern],
        }
      : line,
  );
  return {
    ...config,
    preset: "custom",
    paylines: nextPaylines,
  };
}

/**
 * Generates a canonical pattern shape across `columns` and `rows` so designers
 * can quickly create straight, V, inverted-V, zigzag, or diagonal patterns and
 * refine them cell-by-cell.
 */
export function buildPatternShape(
  columns: number,
  rows: number,
  shape: PaylineShapeKind,
  baseRow = 0,
): number[] {
  const maxRow = Math.max(0, rows - 1);
  const midRow = Math.floor(maxRow / 2);
  const midCol = (columns - 1) / 2;

  switch (shape) {
    case "top":
      return new Array(columns).fill(0);
    case "middle":
      return new Array(columns).fill(midRow);
    case "bottom":
      return new Array(columns).fill(maxRow);
    case "v":
      return Array.from({ length: columns }, (_, c) => {
        const distFromEdge = Math.min(c, columns - 1 - c);
        const maxDist = Math.max(1, Math.floor(midCol));
        const depth = Math.round((distFromEdge / maxDist) * maxRow);
        return clamp(depth, 0, maxRow);
      });
    case "inverted_v":
      return Array.from({ length: columns }, (_, c) => {
        const distFromEdge = Math.min(c, columns - 1 - c);
        const maxDist = Math.max(1, Math.floor(midCol));
        const depth = Math.round((distFromEdge / maxDist) * maxRow);
        return clamp(maxRow - depth, 0, maxRow);
      });
    case "zigzag":
      return Array.from({ length: columns }, (_, c) =>
        clamp(baseRow + (c % 2 === 0 ? 0 : 1), 0, maxRow),
      );
    case "zigzag_inv":
      return Array.from({ length: columns }, (_, c) =>
        clamp(maxRow - baseRow - (c % 2 === 0 ? 0 : 1), 0, maxRow),
      );
    case "diagonal_down":
      return Array.from({ length: columns }, (_, c) => {
        if (columns <= 1) return 0;
        return clamp(Math.round((c / (columns - 1)) * maxRow), 0, maxRow);
      });
    case "diagonal_up":
      return Array.from({ length: columns }, (_, c) => {
        if (columns <= 1) return maxRow;
        return clamp(
          maxRow - Math.round((c / (columns - 1)) * maxRow),
          0,
          maxRow,
        );
      });
    default:
      return new Array(columns).fill(midRow);
  }
}

/**
 * Applies one of the F15 presets:
 * - "5": 5 canonical lines
 * - "10": 10 canonical lines
 * - "20": 20 canonical lines
 * - "custom": switches preset flag to "custom" without overwriting current lines
 */
export function applyPaylinePreset(
  config: PaylineConfigurationData,
  preset: PaylinePreset,
): PaylineConfigurationData {
  if (preset === "custom") {
    return {
      ...config,
      preset: "custom",
    };
  }

  const targetCount = preset === "5" ? 5 : preset === "10" ? 10 : 20;
  const generated = generatePaylines(config.columns, config.rows, targetCount);
  const items: PaylineItemConfig[] = generated.map((line, idx) => ({
    id: `line-${idx + 1}`,
    index: idx + 1,
    name: `Payline #${idx + 1}`,
    pattern: [...line.pattern],
    active: true,
    color: getPaylineColor(idx + 1),
  }));

  return {
    ...config,
    preset,
    requestedCount: items.length,
    paylines: normalizePaylineItems(items),
  };
}

/**
 * Picks the next unused valid pattern for the grid so `Add Payline` creates a
 * distinct valid line immediately ready for customization.
 */
export function findNextUnusedPattern(
  existingPaylines: PaylineItemConfig[],
  columns: number,
  rows: number,
): number[] {
  const taken = new Set(existingPaylines.map((p) => p.pattern.join(",")));
  const poolSize = Math.min(maxPaylines(columns, rows), existingPaylines.length + 32);
  const candidates = generatePaylines(columns, rows, poolSize);
  for (const candidate of candidates) {
    if (!taken.has(candidate.pattern.join(","))) {
      return [...candidate.pattern];
    }
  }
  // Fallback: middle row
  const mid = Math.floor(Math.max(0, rows - 1) / 2);
  return new Array(columns).fill(mid);
}

/**
 * Adds a new payline to the configuration.
 */
export function addPayline(
  config: PaylineConfigurationData,
  options?: {
    pattern?: number[];
    blank?: boolean;
    afterPaylineId?: string;
    name?: string;
    active?: boolean;
  },
): PaylineConfigurationData {
  const nextNumber = config.paylines.length + 1;
  const pattern = options?.pattern
    ? [...options.pattern]
    : options?.blank
      ? new Array(config.columns).fill(-1)
      : findNextUnusedPattern(config.paylines, config.columns, config.rows);

  const newItem: PaylineItemConfig = {
    id: `line-${nextNumber}`,
    index: nextNumber,
    name: options?.name ?? `Payline #${nextNumber}`,
    pattern,
    active: options?.active ?? true,
    color: getPaylineColor(nextNumber),
  };

  let nextList: PaylineItemConfig[];
  if (options?.afterPaylineId) {
    const idx = config.paylines.findIndex((p) => p.id === options.afterPaylineId);
    if (idx >= 0) {
      nextList = [
        ...config.paylines.slice(0, idx + 1),
        newItem,
        ...config.paylines.slice(idx + 1),
      ];
    } else {
      nextList = [...config.paylines, newItem];
    }
  } else {
    nextList = [...config.paylines, newItem];
  }

  const normalized = normalizePaylineItems(nextList);
  return {
    ...config,
    preset: "custom",
    requestedCount: normalized.length,
    paylines: normalized,
  };
}

/**
 * Deletes a payline by ID and re-indexes remaining paylines.
 */
export function deletePayline(
  config: PaylineConfigurationData,
  paylineId: string,
): PaylineConfigurationData {
  const filtered = config.paylines.filter((line) => line.id !== paylineId);
  if (filtered.length === config.paylines.length) return config;

  const normalized = normalizePaylineItems(filtered);
  return {
    ...config,
    preset: "custom",
    requestedCount: normalized.length,
    paylines: normalized,
  };
}

/**
 * Duplicates an existing payline right after the source payline.
 * When `options.ensureUniquePattern` is true (default false), it shifts the last column's row
 * by +1 (modulo `rows`) if needed to avoid a duplicate pattern warning; when false, it creates
 * an exact copy of the pattern so the designer can see/edit the duplicated pattern directly.
 */
export function duplicatePayline(
  config: PaylineConfigurationData,
  paylineId: string,
  options?: { ensureUniquePattern?: boolean },
): PaylineConfigurationData {
  const sourceIndex = config.paylines.findIndex((line) => line.id === paylineId);
  if (sourceIndex < 0) return config;

  const source = config.paylines[sourceIndex]!;
  let nextPattern = [...source.pattern];

  if (options?.ensureUniquePattern && nextPattern.length === config.columns) {
    const taken = new Set(config.paylines.map((p) => p.pattern.join(",")));
    for (let col = config.columns - 1; col >= 0 && taken.has(nextPattern.join(",")); col -= 1) {
      const currentRow = nextPattern[col] ?? 0;
      for (let delta = 1; delta < config.rows; delta += 1) {
        const candidate = [...nextPattern];
        candidate[col] = (Math.max(0, currentRow) + delta) % config.rows;
        if (!taken.has(candidate.join(","))) {
          nextPattern = candidate;
          break;
        }
      }
    }
  }

  const duplicated: PaylineItemConfig = {
    id: `${source.id}-copy`,
    index: source.index + 1,
    name: `${source.name ?? `Payline #${source.index}`} Copy`,
    pattern: nextPattern,
    active: source.active,
    color: getPaylineColor(source.index + 1),
  };

  const nextList = [
    ...config.paylines.slice(0, sourceIndex + 1),
    duplicated,
    ...config.paylines.slice(sourceIndex + 1),
  ];

  const normalized = normalizePaylineItems(nextList);
  return {
    ...config,
    preset: "custom",
    requestedCount: normalized.length,
    paylines: normalized,
  };
}

/**
 * Clears all paylines from the configuration (`Clear All` action).
 */
export function clearAllPaylines(
  config: PaylineConfigurationData,
): PaylineConfigurationData {
  return {
    ...config,
    preset: "custom",
    requestedCount: 0,
    paylines: [],
  };
}

/**
 * Toggles the `active` state of a single payline.
 */
export function togglePaylineActive(
  config: PaylineConfigurationData,
  paylineId: string,
  active?: boolean,
): PaylineConfigurationData {
  return {
    ...config,
    paylines: config.paylines.map((line) =>
      line.id === paylineId
        ? { ...line, active: active !== undefined ? active : !line.active }
        : line,
    ),
  };
}

/**
 * Sets `active` on all paylines at once.
 */
export function setAllPaylinesActive(
  config: PaylineConfigurationData,
  active: boolean,
): PaylineConfigurationData {
  return {
    ...config,
    paylines: config.paylines.map((line) => ({ ...line, active })),
  };
}

/**
 * Repairs any malformed paylines by ensuring every column 0..columns-1 has a valid
 * integer row in 0..rows-1 and resolving any duplicate patterns.
 */
export function repairMalformedPaylines(
  config: PaylineConfigurationData,
  targetPaylineId?: string,
): PaylineConfigurationData {
  const maxRow = Math.max(0, config.rows - 1);
  const midRow = Math.floor(maxRow / 2);
  const taken = new Set<string>();

  const repaired = config.paylines.map((line) => {
    const shouldRepair = !targetPaylineId || line.id === targetPaylineId;
    if (!shouldRepair) {
      taken.add(line.pattern.join(","));
      return line;
    }

    let nextPattern = Array.from({ length: config.columns }, (_, col) => {
      const val = line.pattern[col];
      if (val === undefined || val === null || !Number.isInteger(val) || val < 0) {
        return midRow;
      }
      return clamp(val, 0, maxRow);
    });

    if (taken.has(nextPattern.join(","))) {
      const candidates = generatePaylines(
        config.columns,
        config.rows,
        Math.min(maxPaylines(config.columns, config.rows), config.paylines.length + 25),
      );
      const unused = candidates.find((c) => !taken.has(c.pattern.join(",")));
      if (unused) {
        nextPattern = [...unused.pattern];
      }
    }

    taken.add(nextPattern.join(","));
    return {
      ...line,
      pattern: nextPattern,
    };
  });

  return {
    ...config,
    paylines: normalizePaylineItems(repaired),
  };
}

/**
 * Structural validation for F15 Payline Editor.
 * Detects:
 * - Missing/unset cells in any reel column (Rule: each payline must contain exactly one cell per reel)
 * - Row indices out of bounds (< 0 or >= rows) or non-integer
 * - Pattern length mismatch (pattern.length !== columns)
 * - Duplicate payline patterns
 * - Empty payline list in lines evaluation mode
 *
 * Strictly structural — does NOT calculate winnings or RNG outcomes.
 */
export function validatePaylineConfiguration(
  config: PaylineConfigurationData,
): PaylineValidationReport {
  const issues: PaylineValidationIssue[] = [];
  const columnIssues: PaylineColumnIssue[] = [];
  const invalidColumnsByPaylineId: Record<string, number[]> = {};

  let issueSeq = 0;
  const pushIssue = (issue: Omit<PaylineValidationIssue, "id">) => {
    issueSeq += 1;
    issues.push({
      id: `payline-issue-${issueSeq}`,
      ...issue,
    });
  };

  const addInvalidCol = (paylineId: string, colIdx: number) => {
    const list = invalidColumnsByPaylineId[paylineId] ?? [];
    if (!list.includes(colIdx)) {
      list.push(colIdx);
      list.sort((a, b) => a - b);
      invalidColumnsByPaylineId[paylineId] = list;
    }
  };

  // 1. Grid dimensions check
  const gridDimensionsValid =
    Number.isInteger(config.columns) &&
    config.columns >= 3 &&
    config.columns <= 8 &&
    Number.isInteger(config.rows) &&
    config.rows >= 2 &&
    config.rows <= 6;

  if (!gridDimensionsValid) {
    pushIssue({
      kind: "invalid_grid_dimensions",
      severity: "error",
      message: `Grid dimensions (${config.columns}×${config.rows}) must be 3–8 reels and 2–6 rows.`,
    });
  }

  // 2. Per-payline column & row checks
  let oneCellPerReelValid = true;
  let rowBoundsValid = true;

  for (const line of config.paylines) {
    if (line.pattern.length !== config.columns) {
      oneCellPerReelValid = false;
      pushIssue({
        kind: "pattern_length_mismatch",
        severity: "error",
        paylineId: line.id,
        paylineIndex: line.index,
        message: `Payline #${line.index} has ${line.pattern.length} cells instead of ${config.columns} (must have 1 cell per reel).`,
      });
    }

    const maxCols = Math.max(config.columns, line.pattern.length);
    for (let col = 0; col < maxCols; col += 1) {
      const rowVal = line.pattern[col];
      if (col >= config.columns) {
        oneCellPerReelValid = false;
        addInvalidCol(line.id, col);
        const colIssue: PaylineColumnIssue = {
          paylineId: line.id,
          paylineIndex: line.index,
          columnIndex: col,
          rowValue: rowVal,
          reason: "extra_column",
          message: `Payline #${line.index}, Reel ${col + 1} exceeds grid column count (${config.columns}).`,
        };
        columnIssues.push(colIssue);
        continue;
      }

      if (rowVal === undefined || rowVal === null || rowVal === -1 || Number.isNaN(rowVal)) {
        oneCellPerReelValid = false;
        addInvalidCol(line.id, col);
        const msg = `Payline #${line.index}, Reel ${col + 1}: missing cell selection (each payline must contain 1 cell per reel).`;
        columnIssues.push({
          paylineId: line.id,
          paylineIndex: line.index,
          columnIndex: col,
          rowValue: rowVal,
          reason: "missing_cell",
          message: msg,
        });
        pushIssue({
          kind: "missing_cell_in_reel",
          severity: "error",
          paylineId: line.id,
          paylineIndex: line.index,
          columnIndex: col,
          message: msg,
        });
      } else if (!Number.isInteger(rowVal)) {
        oneCellPerReelValid = false;
        rowBoundsValid = false;
        addInvalidCol(line.id, col);
        const msg = `Payline #${line.index}, Reel ${col + 1}: row value (${rowVal}) must be an integer.`;
        columnIssues.push({
          paylineId: line.id,
          paylineIndex: line.index,
          columnIndex: col,
          rowValue: rowVal,
          reason: "non_integer_row",
          message: msg,
        });
        pushIssue({
          kind: "row_out_of_bounds",
          severity: "error",
          paylineId: line.id,
          paylineIndex: line.index,
          columnIndex: col,
          message: msg,
        });
      } else if (rowVal < 0 || rowVal >= config.rows) {
        rowBoundsValid = false;
        addInvalidCol(line.id, col);
        const msg = `Payline #${line.index}, Reel ${col + 1}: row ${rowVal + 1} is outside the 1..${config.rows} grid range.`;
        columnIssues.push({
          paylineId: line.id,
          paylineIndex: line.index,
          columnIndex: col,
          rowValue: rowVal,
          reason: "row_out_of_bounds",
          message: msg,
        });
        pushIssue({
          kind: "row_out_of_bounds",
          severity: "error",
          paylineId: line.id,
          paylineIndex: line.index,
          columnIndex: col,
          message: msg,
        });
      }
    }
  }

  // 3. Unique patterns check
  let uniquePatternsValid = true;
  const patternFirstSeen = new Map<string, PaylineItemConfig>();
  for (const line of config.paylines) {
    // Only check duplicate patterns for lines that have all columns populated
    if ((invalidColumnsByPaylineId[line.id]?.length ?? 0) > 0) continue;
    const key = line.pattern.join(",");
    const prev = patternFirstSeen.get(key);
    if (prev) {
      uniquePatternsValid = false;
      pushIssue({
        kind: "duplicate_payline_pattern",
        severity: "error",
        paylineId: line.id,
        paylineIndex: line.index,
        message: `Payline #${line.index} duplicates the exact pattern of Payline #${prev.index} ([${line.pattern.map((r) => r + 1).join("-")}]); each payline must be distinct.`,
      });
    } else {
      patternFirstSeen.set(key, line);
    }
  }

  // 4. Paylines defined check (completeness)
  const paylinesDefined =
    config.evaluation !== "lines" || config.paylines.length > 0;
  if (!paylinesDefined) {
    pushIssue({
      kind: "empty_paylines",
      severity: "warning",
      message: "No paylines are currently defined. Add at least one payline or choose a preset.",
    });
  }

  const hasMalformedError = issues.some((i) => i.severity === "error");

  return {
    valid: issues.length === 0,
    canSave: !hasMalformedError,
    invalidColumnsByPaylineId,
    columnIssues,
    issues,
    checks: {
      gridDimensionsValid,
      oneCellPerReelValid,
      rowBoundsValid,
      uniquePatternsValid,
      paylinesDefined,
    },
  };
}

/**
 * Computes SVG path & node coordinates for rendering a payline across a grid of `width × height`.
 */
export function computePaylinePathGeometry(
  payline: Pick<PaylineItemConfig, "id" | "pattern" | "color">,
  columns: number,
  rows: number,
  width = 500,
  height = 300,
): PaylinePathGeometry {
  const safeCols = Math.max(1, columns);
  const safeRows = Math.max(1, rows);
  const colWidth = width / safeCols;
  const rowHeight = height / safeRows;

  const points: PaylinePathPoint[] = [];
  for (let col = 0; col < safeCols; col += 1) {
    const row = payline.pattern[col];
    if (
      row === undefined ||
      row === null ||
      !Number.isInteger(row) ||
      row < 0 ||
      row >= safeRows
    ) {
      continue;
    }
    points.push({
      columnIndex: col,
      rowIndex: row,
      x: Number(((col + 0.5) * colWidth).toFixed(2)),
      y: Number(((row + 0.5) * rowHeight).toFixed(2)),
    });
  }

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const svgPathD = points
    .map((p, idx) => `${idx === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  return {
    paylineId: payline.id,
    color: payline.color,
    points,
    polylinePoints,
    svgPathD,
    complete: points.length === safeCols,
  };
}
