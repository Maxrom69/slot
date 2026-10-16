/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F16 — Paytable Editor Pure Operations, Defaults, Overrides & Validation.
 *
 * IMPORTANT: This is math configuration UI/data logic, NOT the math engine.
 * Do NOT calculate RTP, hit rate, or implement spin simulations here.
 */

import { defaultSymbolStats } from "@/lib/blueprint/factory";
import type {
  AssetRef,
  GameBlueprint,
  PaytableEntry,
  SpecialSymbolDef,
  SymbolDef,
  SymbolSetType,
} from "@/lib/blueprint/types";
import {
  MAX_SUPPORTED_MATCH_COUNT,
  MIN_SUPPORTED_MATCH_COUNT,
  type PaytableCellIssue,
  type PaytableConfigurationData,
  type PaytableSymbolRowConfig,
  type PaytableValidationIssue,
  type PaytableValidationReport,
} from "./types";

/**
 * Derives visible match counts (e.g. [2, 3, 4, 5] or [2, 3, 4, 5, 6])
 * directly from the active grid/reel column configuration.
 */
export function deriveMatchCountsFromReels(
  columns: number,
  minMatchCount: number = MIN_SUPPORTED_MATCH_COUNT,
): number[] {
  const safeCols = Math.max(
    MIN_SUPPORTED_MATCH_COUNT,
    Math.min(
      MAX_SUPPORTED_MATCH_COUNT,
      Number.isInteger(columns) ? columns : 5,
    ),
  );
  const safeMin = Math.max(
    MIN_SUPPORTED_MATCH_COUNT,
    Math.min(safeCols, Number.isInteger(minMatchCount) ? minMatchCount : 2),
  );
  const counts: number[] = [];
  for (let c = safeMin; c <= safeCols; c += 1) {
    counts.push(c);
  }
  return counts;
}

/**
 * Resolves the display thumbnail URI for a symbol from project/external assets.
 */
export function resolveSymbolThumbnailUri(
  symbol: SymbolDef,
  assets: AssetRef[],
): string | null {
  if (symbol.image?.provider === "external" && symbol.image.uri) {
    return symbol.image.uri;
  }
  const targetAssetId =
    symbol.image?.provider === "project"
      ? (symbol.image.assetId ?? symbol.assetId)
      : symbol.assetId;
  if (!targetAssetId) return null;
  const found = assets.find(
    (a) => a.id === targetAssetId && a.state === "linked" && Boolean(a.uri),
  );
  return found?.uri ?? null;
}

/**
 * Resolves the human-readable symbol family for a symbol from its explicit `family`,
 * its owning symbol set, or its value tier.
 */
export function resolveSymbolFamily(
  symbol: SymbolDef,
  bp: Pick<GameBlueprint, "elements" | "symbolSets">,
): { family: string; symbolType?: SymbolSetType } {
  const owningElement = (bp.elements ?? []).find(
    (el) => el.type === "symbol_set" && el.symbolIds.includes(symbol.id),
  );
  const owningSet = (bp.symbolSets ?? []).find((set) =>
    set.symbolIds.includes(symbol.id),
  );
  const symbolType =
    symbol.symbolType ??
    owningElement?.symbolSet?.symbolType ??
    owningSet?.symbolType;

  if (symbol.family && symbol.family.trim()) {
    return { family: symbol.family.trim(), symbolType };
  }
  if (owningElement?.name) {
    return { family: owningElement.name, symbolType };
  }
  if (owningSet?.name) {
    return { family: owningSet.name, symbolType };
  }
  if (symbol.tier === "special") {
    return { family: "Special", symbolType: symbolType ?? "custom" };
  }
  if (symbol.tier === "high") {
    return { family: "High Symbols", symbolType: symbolType ?? "custom" };
  }
  if (symbol.tier === "mid") {
    return { family: "Medium Symbols", symbolType: symbolType ?? "custom" };
  }
  return { family: "Royals", symbolType: symbolType ?? "royals" };
}

/**
 * Computes canonical baseline default payouts for a symbol across match counts `2..maxCount`.
 */
export function computeCanonicalSymbolDefaults(
  symbol: SymbolDef,
  tierIndex: number,
  maxColumns: number,
  specialBehaviour?: string,
): Record<string, number> {
  const maxCol = Math.max(5, Math.min(MAX_SUPPORTED_MATCH_COUNT, maxColumns));
  let base345: Record<string, number>;

  const codeUpper = symbol.code.toUpperCase();
  if (
    symbol.id === "sym-wild" ||
    specialBehaviour === "wild" ||
    (symbol.tier === "special" && codeUpper === "WILD")
  ) {
    base345 = { "3": 25, "4": 100, "5": 500 };
  } else if (
    symbol.id === "sym-scatter" ||
    specialBehaviour === "scatter" ||
    (symbol.tier === "special" && codeUpper === "SCAT")
  ) {
    base345 = { "3": 5, "4": 20, "5": 100 };
  } else if (
    symbol.id === "sym-bonus" ||
    specialBehaviour === "bonus" ||
    (symbol.tier === "special" && codeUpper === "BONUS")
  ) {
    base345 = { "3": 10, "4": 40, "5": 200 };
  } else {
    base345 = defaultSymbolStats(symbol.tier, tierIndex).payouts;
  }

  const out: Record<string, number> = {
    "2": 0,
    "3": base345["3"] ?? 5,
    "4": base345["4"] ?? 20,
    "5": base345["5"] ?? 60,
  };

  for (let m = 6; m <= maxCol; m += 1) {
    const prev = out[String(m - 1)] ?? out["5"] ?? 50;
    out[String(m)] = Math.round(prev * 2 * 100) / 100;
  }

  return out;
}

/**
 * Rebuilds flattened `PaytableEntry[]` from `symbolRows` and `matchCounts`.
 */
export function buildPaytableEntriesFromRows(
  symbolRows: PaytableSymbolRowConfig[],
  matchCounts: number[],
): PaytableEntry[] {
  const entries: PaytableEntry[] = [];
  const validMatchSet = new Set(matchCounts);
  const maxMatchCount = matchCounts.length > 0 ? Math.max(...matchCounts) : 5;

  for (const row of symbolRows) {
    // Include all visible match counts plus any existing positive match counts within 2..maxMatchCount
    const keys = new Set<number>([
      ...matchCounts,
      ...Object.keys(row.payouts)
        .map((k) => Number(k))
        .filter(
          (n) =>
            Number.isInteger(n) &&
            n >= MIN_SUPPORTED_MATCH_COUNT &&
            n <= maxMatchCount,
        ),
    ]);
    const sortedCounts = Array.from(keys).sort((a, b) => a - b);

    for (const count of sortedCounts) {
      const val = row.payouts[String(count)];
      if (val === undefined) continue;
      // Always include entries for active matchCounts or positive payouts
      if (validMatchSet.has(count) || val > 0) {
        entries.push({
          symbolId: row.symbolId,
          ofAKind: count,
          payout: val,
        });
      }
    }
  }
  return entries;
}

/**
 * Extracts or constructs a `PaytableConfigurationData` from a `GameBlueprint`.
 */
export function paytableConfigurationFromBlueprint(
  bp: GameBlueprint,
): PaytableConfigurationData {
  const columns = bp.reelConfiguration?.columns ?? bp.reels?.columns ?? 5;
  const rows = bp.reelConfiguration?.rows ?? bp.reels?.rows ?? 3;
  const evaluation =
    bp.reelConfiguration?.evaluation ?? bp.reels?.evaluation ?? "lines";
  const minMatchCount =
    bp.paytableConfiguration?.minMatchCount ?? MIN_SUPPORTED_MATCH_COUNT;
  const matchCounts = deriveMatchCountsFromReels(columns, minMatchCount);

  const existingRowBySymbolId = new Map<string, PaytableSymbolRowConfig>();
  for (const r of bp.paytableConfiguration?.symbolRows ?? []) {
    existingRowBySymbolId.set(r.symbolId, r);
  }

  // Group paytable array entries by symbolId
  const paytableMap = new Map<string, Record<string, number>>();
  for (const entry of bp.paytable ?? []) {
    const map = paytableMap.get(entry.symbolId) ?? {};
    map[String(entry.ofAKind)] = entry.payout;
    paytableMap.set(entry.symbolId, map);
  }

  // Track tier indices to compute deterministic defaults matching factory.ts
  const tierCounters: Record<SymbolDef["tier"], number> = {
    low: 0,
    mid: 0,
    high: 0,
    special: 0,
  };

  const specialBySymbolId = new Map<string, SpecialSymbolDef[]>();
  for (const sp of bp.specialSymbols ?? []) {
    const list = specialBySymbolId.get(sp.symbolId) ?? [];
    list.push(sp);
    specialBySymbolId.set(sp.symbolId, list);
  }

  const symbolRows: PaytableSymbolRowConfig[] = (bp.symbols ?? []).map(
    (symbol) => {
      const tierIdx = tierCounters[symbol.tier] ?? 0;
      tierCounters[symbol.tier] = tierIdx + 1;

      const specials = specialBySymbolId.get(symbol.id) ?? [];
      const primaryBehaviour = specials[0]?.behaviour;
      const canonicalDefaults = computeCanonicalSymbolDefaults(
        symbol,
        tierIdx,
        Math.max(columns, MAX_SUPPORTED_MATCH_COUNT),
        primaryBehaviour,
      );

      const savedRow = existingRowBySymbolId.get(symbol.id);
      const fromTable = paytableMap.get(symbol.id) ?? {};

      // Determine baseline default payouts for this symbol
      const defaultPayouts: Record<string, number> = {};
      const payouts: Record<string, number> = {};

      const allCounts = new Set<number>([
        ...matchCounts,
        ...Object.keys(symbol.payouts ?? {}).map(Number),
        ...Object.keys(fromTable).map(Number),
        ...Object.keys(savedRow?.payouts ?? {}).map(Number),
        ...Object.keys(savedRow?.defaultPayouts ?? {}).map(Number),
      ]);

      for (const c of allCounts) {
        if (
          !Number.isInteger(c) ||
          c < MIN_SUPPORTED_MATCH_COUNT ||
          c > columns
        ) {
          continue;
        }
        const key = String(c);
        const defVal =
          savedRow?.defaultPayouts?.[key] !== undefined
            ? savedRow.defaultPayouts[key]
            : (canonicalDefaults[key] ?? 0);
        defaultPayouts[key] = defVal;

        if (savedRow?.payouts?.[key] !== undefined) {
          payouts[key] = savedRow.payouts[key];
        } else if (symbol.payouts?.[key] !== undefined) {
          payouts[key] = symbol.payouts[key];
        } else if (fromTable[key] !== undefined) {
          payouts[key] = fromTable[key];
        } else {
          payouts[key] = defVal;
        }
      }

      const hasWildSpecial = specials.some((s) => s.behaviour === "wild");
      const hasScatterSpecial = specials.some((s) => s.behaviour === "scatter");
      const hasBonusSpecial = specials.some((s) => s.behaviour === "bonus");

      const defaultIsWild =
        savedRow?.defaultIsWild ??
        (symbol.id === "sym-wild" ||
          symbol.code.toUpperCase() === "WILD" ||
          hasWildSpecial);
      const defaultIsScatter =
        savedRow?.defaultIsScatter ??
        (symbol.id === "sym-scatter" ||
          symbol.code.toUpperCase() === "SCAT" ||
          hasScatterSpecial);
      const defaultIsBonus =
        savedRow?.defaultIsBonus ??
        (symbol.id === "sym-bonus" ||
          symbol.code.toUpperCase() === "BONUS" ||
          hasBonusSpecial);

      const isWild =
        symbol.isWild !== undefined
          ? Boolean(symbol.isWild)
          : (savedRow?.isWild ?? defaultIsWild);
      const isScatter =
        symbol.isScatter !== undefined
          ? Boolean(symbol.isScatter)
          : (savedRow?.isScatter ?? defaultIsScatter);
      const isBonus =
        symbol.isBonus !== undefined
          ? Boolean(symbol.isBonus)
          : (savedRow?.isBonus ?? defaultIsBonus);

      const { family, symbolType } = resolveSymbolFamily(symbol, bp);

      return {
        symbolId: symbol.id,
        code: symbol.code,
        name: symbol.name,
        tier: symbol.tier,
        family: savedRow?.family || family,
        symbolType,
        glyph: symbol.glyph,
        assetId: symbol.assetId,
        thumbnailUri: resolveSymbolThumbnailUri(symbol, bp.assets ?? []),
        isWild,
        isScatter,
        isBonus,
        defaultIsWild,
        defaultIsScatter,
        defaultIsBonus,
        payouts,
        defaultPayouts,
      };
    },
  );

  const entries = buildPaytableEntriesFromRows(symbolRows, matchCounts);

  return {
    columns,
    rows,
    evaluation,
    minMatchCount,
    matchCounts,
    symbolRows,
    entries,
    updatedAt: bp.paytableConfiguration?.updatedAt ?? bp.meta?.updatedAt,
  };
}

/**
 * Checks whether a single cell `(row, matchCount)` differs from its configured default.
 */
export function isPayoutCellModified(
  row: PaytableSymbolRowConfig,
  matchCount: number,
): boolean {
  const key = String(matchCount);
  if (row.rawInputs && row.rawInputs[key] !== undefined) {
    const parsed = Number(row.rawInputs[key]);
    if (!Number.isFinite(parsed)) return true;
  }
  const current = row.payouts[key] ?? 0;
  const def = row.defaultPayouts[key] ?? 0;
  return Math.abs(current - def) > 1e-9;
}

/**
 * Returns all matchCounts in `matchCounts` where `row` has a modified payout value.
 */
export function getModifiedMatchCountsForRow(
  row: PaytableSymbolRowConfig,
  matchCounts: number[],
): number[] {
  return matchCounts.filter((mc) => isPayoutCellModified(row, mc));
}

/**
 * Checks whether a symbol row has any modified payout cell or modified role flag.
 */
export function isPaytableRowModified(
  row: PaytableSymbolRowConfig,
  matchCounts: number[],
): boolean {
  if (getModifiedMatchCountsForRow(row, matchCounts).length > 0) return true;
  if (row.isWild !== row.defaultIsWild) return true;
  if (row.isScatter !== row.defaultIsScatter) return true;
  if (row.isBonus !== row.defaultIsBonus) return true;
  return false;
}

/**
 * Counts total modified rows and modified cells across the active paytable.
 */
export function countModifiedPaytableCells(config: PaytableConfigurationData): {
  modifiedRows: number;
  modifiedCells: number;
} {
  let modifiedRows = 0;
  let modifiedCells = 0;
  for (const row of config.symbolRows) {
    const cells = getModifiedMatchCountsForRow(row, config.matchCounts);
    modifiedCells += cells.length;
    if (
      cells.length > 0 ||
      row.isWild !== row.defaultIsWild ||
      row.isScatter !== row.defaultIsScatter ||
      row.isBonus !== row.defaultIsBonus
    ) {
      modifiedRows += 1;
    }
  }
  return { modifiedRows, modifiedCells };
}

/**
 * Validates a single payout value and match count.
 * Rejects negative payouts, invalid numeric values, NaN, and invalid match counts.
 */
export function validatePaytableCellValue(
  rawValue: unknown,
  matchCount: number,
  maxColumns: number,
): {
  ok: boolean;
  kind?: "negative_payout" | "nan_payout" | "invalid_numeric" | "invalid_match_count";
  numericValue: number;
  message?: string;
} {
  if (
    typeof matchCount !== "number" ||
    !Number.isInteger(matchCount) ||
    matchCount < MIN_SUPPORTED_MATCH_COUNT ||
    matchCount > Math.max(maxColumns, MAX_SUPPORTED_MATCH_COUNT) ||
    matchCount > maxColumns
  ) {
    return {
      ok: false,
      kind: "invalid_match_count",
      numericValue: NaN,
      message: `Invalid match count ${String(matchCount)} (must be an integer between ${MIN_SUPPORTED_MATCH_COUNT} and ${maxColumns}).`,
    };
  }

  if (typeof rawValue === "number") {
    if (Number.isNaN(rawValue)) {
      return {
        ok: false,
        kind: "nan_payout",
        numericValue: NaN,
        message: `Payout for ${matchCount}-of-a-kind cannot be NaN.`,
      };
    }
    if (!Number.isFinite(rawValue)) {
      return {
        ok: false,
        kind: "invalid_numeric",
        numericValue: NaN,
        message: `Payout for ${matchCount}-of-a-kind must be a finite number.`,
      };
    }
    if (rawValue < 0) {
      return {
        ok: false,
        kind: "negative_payout",
        numericValue: rawValue,
        message: `Payout for ${matchCount}-of-a-kind cannot be negative (${rawValue}).`,
      };
    }
    return { ok: true, numericValue: rawValue };
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (trimmed === "") {
      return {
        ok: false,
        kind: "invalid_numeric",
        numericValue: NaN,
        message: `Payout for ${matchCount}-of-a-kind cannot be empty.`,
      };
    }
    if (trimmed.toLowerCase() === "nan") {
      return {
        ok: false,
        kind: "nan_payout",
        numericValue: NaN,
        message: `Payout for ${matchCount}-of-a-kind cannot be NaN.`,
      };
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      return {
        ok: false,
        kind: "invalid_numeric",
        numericValue: NaN,
        message: `Payout "${rawValue}" for ${matchCount}-of-a-kind is not a valid number.`,
      };
    }
    if (parsed < 0) {
      return {
        ok: false,
        kind: "negative_payout",
        numericValue: parsed,
        message: `Payout for ${matchCount}-of-a-kind cannot be negative (${parsed}).`,
      };
    }
    return { ok: true, numericValue: parsed };
  }

  return {
    ok: false,
    kind: "invalid_numeric",
    numericValue: NaN,
    message: `Payout for ${matchCount}-of-a-kind has an invalid numeric value.`,
  };
}

/**
 * Updates a single payout cell `(symbolId, matchCount)` in `PaytableConfigurationData`.
 * Preserves invalid/negative/NaN inputs in state so `validatePaytableConfiguration`
 * can highlight and reject them before saving.
 */
export function setPaytableCellPayout(
  config: PaytableConfigurationData,
  symbolId: string,
  matchCount: number,
  rawValue: number | string,
): PaytableConfigurationData {
  const key = String(matchCount);
  const symbolRows = config.symbolRows.map((row) => {
    if (row.symbolId !== symbolId) return row;

    const nextRawInputs = { ...(row.rawInputs ?? {}) };
    let numericVal: number;

    if (typeof rawValue === "string") {
      const trimmed = rawValue.trim();
      const parsed = trimmed === "" ? NaN : Number(trimmed);
      numericVal = parsed;
      if (
        trimmed === "" ||
        Number.isNaN(parsed) ||
        !Number.isFinite(parsed) ||
        parsed < 0
      ) {
        nextRawInputs[key] = rawValue;
      } else {
        delete nextRawInputs[key];
      }
    } else {
      numericVal = rawValue;
      if (
        Number.isNaN(rawValue) ||
        !Number.isFinite(rawValue) ||
        rawValue < 0
      ) {
        nextRawInputs[key] = String(rawValue);
      } else {
        delete nextRawInputs[key];
      }
    }

    const nextPayouts = {
      ...row.payouts,
      [key]: numericVal,
    };

    return {
      ...row,
      payouts: nextPayouts,
      rawInputs:
        Object.keys(nextRawInputs).length > 0 ? nextRawInputs : undefined,
    };
  });

  // If matchCount is invalid (e.g. <= 1 or > columns or non-integer) and not in config.matchCounts,
  // still keep it in row.payouts so validation detects `invalid_match_count`.
  const entries = buildPaytableEntriesFromRows(symbolRows, config.matchCounts);

  return {
    ...config,
    symbolRows,
    entries,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Restores a single symbol row's payouts and role flags to its configured defaults.
 */
export function resetPaytableRowToDefaults(
  config: PaytableConfigurationData,
  symbolId: string,
): PaytableConfigurationData {
  const symbolRows = config.symbolRows.map((row) => {
    if (row.symbolId !== symbolId) return row;
    return {
      ...row,
      payouts: { ...row.defaultPayouts },
      isWild: row.defaultIsWild,
      isScatter: row.defaultIsScatter,
      isBonus: row.defaultIsBonus,
      rawInputs: undefined,
    };
  });

  return {
    ...config,
    symbolRows,
    entries: buildPaytableEntriesFromRows(symbolRows, config.matchCounts),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Restores all symbol rows in the paytable to their configured defaults.
 */
export function resetAllPaytableToDefaults(
  config: PaytableConfigurationData,
): PaytableConfigurationData {
  const symbolRows = config.symbolRows.map((row) => ({
    ...row,
    payouts: { ...row.defaultPayouts },
    isWild: row.defaultIsWild,
    isScatter: row.defaultIsScatter,
    isBonus: row.defaultIsBonus,
    rawInputs: undefined,
  }));

  return {
    ...config,
    symbolRows,
    entries: buildPaytableEntriesFromRows(symbolRows, config.matchCounts),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Toggles or sets the Wild flag on a symbol row.
 */
export function toggleSymbolWild(
  config: PaytableConfigurationData,
  symbolId: string,
  nextWild?: boolean,
): PaytableConfigurationData {
  const symbolRows = config.symbolRows.map((row) => {
    if (row.symbolId !== symbolId) return row;
    const isWild = nextWild !== undefined ? nextWild : !row.isWild;
    return {
      ...row,
      isWild,
    };
  });
  return {
    ...config,
    symbolRows,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Toggles or sets the Scatter flag on a symbol row.
 */
export function toggleSymbolScatter(
  config: PaytableConfigurationData,
  symbolId: string,
  nextScatter?: boolean,
): PaytableConfigurationData {
  const symbolRows = config.symbolRows.map((row) => {
    if (row.symbolId !== symbolId) return row;
    const isScatter = nextScatter !== undefined ? nextScatter : !row.isScatter;
    return {
      ...row,
      isScatter,
    };
  });
  return {
    ...config,
    symbolRows,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Toggles or sets the Bonus flag on a symbol row.
 */
export function toggleSymbolBonus(
  config: PaytableConfigurationData,
  symbolId: string,
  nextBonus?: boolean,
): PaytableConfigurationData {
  const symbolRows = config.symbolRows.map((row) => {
    if (row.symbolId !== symbolId) return row;
    const isBonus = nextBonus !== undefined ? nextBonus : !row.isBonus;
    return {
      ...row,
      isBonus,
    };
  });
  return {
    ...config,
    symbolRows,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates the family label for a symbol row.
 */
export function setSymbolFamily(
  config: PaytableConfigurationData,
  symbolId: string,
  family: string,
): PaytableConfigurationData {
  const clean = family.trim().slice(0, 60) || "Custom";
  const symbolRows = config.symbolRows.map((row) =>
    row.symbolId === symbolId ? { ...row, family: clean } : row,
  );
  return {
    ...config,
    symbolRows,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Updates the minimum match count (e.g. 2 vs 3) or syncs with new reel column counts.
 */
export function syncPaytableWithReels(
  config: PaytableConfigurationData,
  columns: number,
  rows: number,
  evaluation?: "lines" | "ways" | "cluster",
  minMatchCount?: number,
): PaytableConfigurationData {
  const nextMin = minMatchCount ?? config.minMatchCount ?? MIN_SUPPORTED_MATCH_COUNT;
  const matchCounts = deriveMatchCountsFromReels(columns, nextMin);

  const symbolRows = config.symbolRows.map((row) => {
    const nextPayouts: Record<string, number> = {};
    const nextDefaults: Record<string, number> = {};
    for (const [k, v] of Object.entries(row.payouts ?? {})) {
      const mc = Number(k);
      if (
        Number.isInteger(mc) &&
        mc >= MIN_SUPPORTED_MATCH_COUNT &&
        mc <= columns
      ) {
        nextPayouts[k] = v;
      }
    }
    for (const [k, v] of Object.entries(row.defaultPayouts ?? {})) {
      const mc = Number(k);
      if (
        Number.isInteger(mc) &&
        mc >= MIN_SUPPORTED_MATCH_COUNT &&
        mc <= columns
      ) {
        nextDefaults[k] = v;
      }
    }
    for (const mc of matchCounts) {
      const key = String(mc);
      if (nextDefaults[key] === undefined) {
        const prevDef = nextDefaults[String(mc - 1)] ?? nextDefaults["5"] ?? 10;
        nextDefaults[key] = mc === 2 ? 0 : Math.round(prevDef * 2 * 100) / 100;
      }
      if (nextPayouts[key] === undefined) {
        nextPayouts[key] = nextDefaults[key];
      }
    }
    const nextRawInputs = row.rawInputs
      ? Object.fromEntries(
          Object.entries(row.rawInputs).filter(([k]) => {
            const mc = Number(k);
            return (
              Number.isInteger(mc) &&
              mc >= MIN_SUPPORTED_MATCH_COUNT &&
              mc <= columns
            );
          }),
        )
      : undefined;
    return {
      ...row,
      payouts: nextPayouts,
      defaultPayouts: nextDefaults,
      ...(nextRawInputs ? { rawInputs: nextRawInputs } : {}),
    };
  });

  return {
    ...config,
    columns,
    rows,
    evaluation: evaluation ?? config.evaluation,
    minMatchCount: nextMin,
    matchCounts,
    symbolRows,
    entries: buildPaytableEntriesFromRows(symbolRows, matchCounts),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Validates the entire `PaytableConfigurationData`.
 * Rejects:
 *  - negative payouts
 *  - invalid numeric values
 *  - NaN
 *  - invalid match count
 */
export function validatePaytableConfiguration(
  config: PaytableConfigurationData,
): PaytableValidationReport {
  const issues: PaytableValidationIssue[] = [];
  const invalidCellsBySymbolId: Record<string, number[]> = {};
  const cellIssueMap: Record<string, PaytableCellIssue> = {};

  let matchCountsValid = true;
  let noNegativePayouts = true;
  let noNaNOrInvalidNumeric = true;
  let symbolsConsistent = true;

  const markInvalidCell = (
    symbolId: string,
    symbolName: string,
    matchCount: number,
    kind: PaytableCellIssue["kind"],
    rawValue: string | number,
    message: string,
  ) => {
    if (!invalidCellsBySymbolId[symbolId]) {
      invalidCellsBySymbolId[symbolId] = [];
    }
    if (!invalidCellsBySymbolId[symbolId].includes(matchCount)) {
      invalidCellsBySymbolId[symbolId].push(matchCount);
    }
    cellIssueMap[`${symbolId}:${matchCount}`] = {
      symbolId,
      symbolName,
      matchCount,
      kind,
      rawValue,
      message,
    };
  };

  // 1. Validate `config.matchCounts` against `config.columns`
  if (!Array.isArray(config.matchCounts) || config.matchCounts.length === 0) {
    matchCountsValid = false;
    issues.push({
      id: "empty-match-counts",
      severity: "error",
      kind: "invalid_match_count",
      message: "Paytable must define at least one visible match count column.",
    });
  } else {
    for (const mc of config.matchCounts) {
      if (
        typeof mc !== "number" ||
        !Number.isInteger(mc) ||
        mc < MIN_SUPPORTED_MATCH_COUNT ||
        mc > config.columns
      ) {
        matchCountsValid = false;
        issues.push({
          id: `invalid-column-match-count-${String(mc)}`,
          severity: "error",
          kind: "invalid_match_count",
          matchCount: mc,
          message: `Match count column "${String(mc)}" is invalid for a ${config.columns}-reel grid (allowed: ${MIN_SUPPORTED_MATCH_COUNT}..${config.columns}).`,
        });
      }
    }
  }

  // 2. Validate symbol uniqueness and payout cells
  const seenSymbols = new Set<string>();
  for (const row of config.symbolRows) {
    if (!row.symbolId || seenSymbols.has(row.symbolId)) {
      symbolsConsistent = false;
      issues.push({
        id: `duplicate-symbol-${row.symbolId}`,
        severity: "error",
        kind: "duplicate_symbol",
        symbolId: row.symbolId,
        symbolName: row.name,
        message: `Symbol "${row.name}" (${row.symbolId}) appears more than once in the paytable.`,
      });
    }
    seenSymbols.add(row.symbolId);

    // Check all keys in row.payouts and row.rawInputs, plus all visible config.matchCounts
    const allMatchKeys = new Set<string>([
      ...config.matchCounts.map(String),
      ...Object.keys(row.payouts ?? {}),
      ...Object.keys(row.rawInputs ?? {}),
    ]);

    for (const key of allMatchKeys) {
      const mc = Number(key);
      const rawVal =
        row.rawInputs && row.rawInputs[key] !== undefined
          ? row.rawInputs[key]
          : row.payouts[key];

      // Check match count validity
      if (
        !Number.isInteger(mc) ||
        mc < MIN_SUPPORTED_MATCH_COUNT ||
        mc > config.columns
      ) {
        // Only flag match counts outside 2..columns if they were explicitly added or have non-zero/invalid values
        const isExplicitlyInvalidCount =
          !Number.isInteger(mc) ||
          mc < MIN_SUPPORTED_MATCH_COUNT ||
          (mc > config.columns &&
            (config.matchCounts.includes(mc) ||
              (typeof rawVal === "number" && (rawVal !== 0 || Number.isNaN(rawVal))) ||
              typeof rawVal === "string"));

        if (isExplicitlyInvalidCount) {
          matchCountsValid = false;
          const msg = `${row.name} (${row.code}): invalid match count "${key}" (grid has ${config.columns} reels).`;
          markInvalidCell(
            row.symbolId,
            row.name,
            mc,
            "invalid_match_count",
            rawVal ?? key,
            msg,
          );
          issues.push({
            id: `invalid-mc-${row.symbolId}-${key}`,
            severity: "error",
            kind: "invalid_match_count",
            symbolId: row.symbolId,
            symbolName: row.name,
            matchCount: mc,
            message: msg,
          });
          continue;
        } else {
          // Dormant default key for higher reel count (e.g. 6 when grid is 5) with value 0: skip
          continue;
        }
      }

      const check = validatePaytableCellValue(rawVal, mc, config.columns);
      if (!check.ok && check.kind) {
        if (check.kind === "negative_payout") {
          noNegativePayouts = false;
        } else if (
          check.kind === "nan_payout" ||
          check.kind === "invalid_numeric"
        ) {
          noNaNOrInvalidNumeric = false;
        } else if (check.kind === "invalid_match_count") {
          matchCountsValid = false;
        }

        const msg = `${row.name} (${row.code}) [${mc}-of-a-kind]: ${check.message}`;
        markInvalidCell(
          row.symbolId,
          row.name,
          mc,
          check.kind,
          rawVal as string | number,
          msg,
        );
        issues.push({
          id: `cell-error-${row.symbolId}-${mc}`,
          severity: "error",
          kind: check.kind,
          symbolId: row.symbolId,
          symbolName: row.name,
          matchCount: mc,
          message: msg,
        });
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");

  return {
    valid: !hasErrors,
    canSave:
      !hasErrors &&
      matchCountsValid &&
      noNegativePayouts &&
      noNaNOrInvalidNumeric &&
      symbolsConsistent,
    issues,
    invalidCellsBySymbolId,
    cellIssueMap,
    checks: {
      matchCountsValid,
      noNegativePayouts,
      noNaNOrInvalidNumeric,
      symbolsConsistent,
    },
  };
}

/**
 * Applies `PaytableConfigurationData` into `GameBlueprint`:
 *  - Rejects invalid configurations (negative payouts, NaN, invalid numeric values, invalid match counts)
 *  - Saves `GameBlueprint.paytableConfiguration`
 *  - Synchronizes `GameBlueprint.paytable` (`PaytableEntry[]`)
 *  - Synchronizes `GameBlueprint.symbols` (`payouts`, `isWild`, `isScatter`, `isBonus`, `family`)
 *  - Synchronizes `GameBlueprint.specialSymbols` so Wild/Scatter/Bonus configuration is visible across the entire frontend
 */
export function applyPaytableConfigurationToBlueprint(
  bp: GameBlueprint,
  config: PaytableConfigurationData,
): GameBlueprint {
  const report = validatePaytableConfiguration(config);
  if (!report.canSave) {
    const firstError =
      report.issues.find((i) => i.severity === "error")?.message ??
      "Paytable configuration contains invalid payouts or match counts.";
    throw new Error(`Cannot save invalid paytable: ${firstError}`);
  }

  const now = new Date().toISOString();
  const rowBySymbolId = new Map(
    config.symbolRows.map((row) => [row.symbolId, row]),
  );

  // 1. Update symbols with payouts, role flags (isWild, isScatter, isBonus), and family
  const nextSymbols: SymbolDef[] = bp.symbols.map((sym) => {
    const row = rowBySymbolId.get(sym.id);
    if (!row) return sym;

    const cleanPayouts: Record<string, number> = {};
    for (const mc of config.matchCounts) {
      const key = String(mc);
      const val = row.payouts[key];
      if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
        // Keep 3..columns always, and keep 2-of-a-kind if > 0 or already in sym.payouts
        if (mc >= 3 || val > 0 || sym.payouts[key] !== undefined) {
          cleanPayouts[key] = val;
        }
      }
    }

    return {
      ...sym,
      payouts: cleanPayouts,
      isWild: row.isWild,
      isScatter: row.isScatter,
      isBonus: row.isBonus,
      family: row.family || sym.family,
    };
  });

  // 2. Synchronize `bp.specialSymbols` with `isWild`, `isScatter`, `isBonus`
  const nextSpecialSymbols: SpecialSymbolDef[] = [];
  const existingSpecials = bp.specialSymbols ?? [];

  // Preserve non-role behaviours ("multiplier", "expanding", "sticky")
  for (const sp of existingSpecials) {
    if (
      sp.behaviour !== "wild" &&
      sp.behaviour !== "scatter" &&
      sp.behaviour !== "bonus"
    ) {
      nextSpecialSymbols.push(sp);
    }
  }

  for (const sym of nextSymbols) {
    if (sym.isWild) {
      const existing = existingSpecials.find(
        (s) => s.symbolId === sym.id && s.behaviour === "wild",
      );
      nextSpecialSymbols.push(
        existing ?? {
          id: sym.id === "sym-wild" ? "special-wild" : `special-wild-${sym.id}`,
          symbolId: sym.id,
          behaviour: "wild",
          params: { substitutesScatter: false, multiplier: 1 },
        },
      );
    }
    if (sym.isScatter) {
      const existing = existingSpecials.find(
        (s) => s.symbolId === sym.id && s.behaviour === "scatter",
      );
      nextSpecialSymbols.push(
        existing ?? {
          id:
            sym.id === "sym-scatter"
              ? "special-scatter"
              : `special-scatter-${sym.id}`,
          symbolId: sym.id,
          behaviour: "scatter",
          params: { triggerCount: 3, awardsFreeSpins: 10 },
        },
      );
    }
    if (sym.isBonus) {
      const existing = existingSpecials.find(
        (s) => s.symbolId === sym.id && s.behaviour === "bonus",
      );
      nextSpecialSymbols.push(
        existing ?? {
          id:
            sym.id === "sym-bonus" ? "special-bonus" : `special-bonus-${sym.id}`,
          symbolId: sym.id,
          behaviour: "bonus",
          params: { triggerCount: 3, feature: "pick_bonus" },
        },
      );
    }
  }

  // 3. Build normalized PaytableEntry[] and PaytableConfigurationData
  const normalizedRows: PaytableSymbolRowConfig[] = config.symbolRows.map(
    (row) => {
      const cleanPayouts: Record<string, number> = {};
      for (const [k, v] of Object.entries(row.payouts)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
          cleanPayouts[k] = v;
        }
      }
      return {
        ...row,
        payouts: cleanPayouts,
        rawInputs: undefined,
      };
    },
  );

  const entries = buildPaytableEntriesFromRows(
    normalizedRows,
    config.matchCounts,
  );

  const nextPaytableConfiguration: PaytableConfigurationData = {
    columns: config.columns,
    rows: config.rows,
    evaluation: config.evaluation,
    minMatchCount: config.minMatchCount,
    matchCounts: [...config.matchCounts],
    symbolRows: normalizedRows,
    entries,
    updatedAt: now,
  };

  return {
    ...bp,
    symbols: nextSymbols,
    specialSymbols: nextSpecialSymbols,
    paytable: entries,
    paytableConfiguration: nextPaytableConfiguration,
    meta: {
      ...bp.meta,
      updatedAt: now,
    },
  };
}
