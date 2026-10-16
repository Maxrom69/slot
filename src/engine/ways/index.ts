/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B09 — WAYS-TO-WIN ENGINE
 *
 * Implements the deterministic 243/1024-style Ways-to-Win evaluation model
 * consuming the authoritative B04 Board, B02/B01 WaysConfiguration / GameConfig,
 * B07 Wild substitution policies, and B06 Paytable multiplier lookups.
 *
 * STRICT ARCHITECTURAL BOUNDARY (B09):
 * - Every Ways run MUST begin on reel 0 (`startReelIndex = 0`)
 * - Continues only across consecutive neighboring reels (`0, 1, 2, ...`) and stops at the first gap
 * - Counts EVERY qualifying occurrence on each participating reel (no unique-symbol collapsing)
 * - Calculates `waysCount` as the product of per-reel qualifying symbol counts (`c0 * c1 * ...`)
 * - Enforces configurable `minimumConsecutiveReels` (and optional `requireFullLength` / `maximumReels`)
 * - Reuses B07 `WildEngine` for Wild substitution (never implements a second Wild engine)
 * - Supports B02 Symbol Families only when `familyCountingEnabled` is explicitly enabled
 * - Reuses B06 `normalizePaytableLookup` for `baseMultiplier` and computes `effectiveMultiplier = baseMultiplier * waysCount`
 * - Performs a single-pass board scan to index per-reel occurrences without mutating or deep-cloning `Board`
 * - NEVER consults B05 Paylines, B08 Scatters, Cluster adjacency, or Pay-Anywhere counts
 * - NEVER consumes RNG or calls Math.random()
 * - NEVER executes features or modifies player balance / session state
 */

import type { Board, Cell, Position } from "../board";
import type { GameConfig, SymbolId } from "../config";
import { isGameConfig } from "../config";
import {
  InvalidBetError,
  InvalidBoardError,
  InvalidMinimumReelCountError,
  InvalidPaytableReferenceError,
  InvalidWaysConfigurationError,
  SlotEngineError,
  UnknownWaysSymbolError,
  WaysArithmeticOverflowError,
} from "../errors";
import {
  normalizePaytableLookup,
  roundCurrency,
  type NormalizedPaytableLookup,
  type PaytableEngine,
  type PaytableSource,
  type PayoutContext,
} from "../paytable";
import type {
  GameDefinition,
  SymbolFamilyDefinition,
  WaysConfiguration,
  WildConfiguration,
} from "../schema";
import {
  createWildEngine,
  type WildEngine,
  type WildEngineConfigObject,
  type WildEvaluationContext,
  type WildRoundMode,
} from "../wilds";

/* -------------------------------------------------------------------------- */
/* 1. WAYS CONFIGURATION & CONTEXT CONTRACTS                                  */
/* -------------------------------------------------------------------------- */

export type WaysCountingRule =
  | "multiplyMatchingReelPositions"
  | "singlePathPerReel";

export interface WaysEngineConfigObject {
  readonly enabled?: boolean;
  readonly startReelIndex?: number;
  readonly endReelIndex?: number;
  readonly minimumConsecutiveReels?: number;
  readonly maximumReels?: number;
  readonly requireFullLength?: boolean;
  readonly countingRule?: WaysCountingRule;
  readonly totalWaysCount?: number;
  readonly eligibleSymbols?: readonly SymbolId[];
  readonly knownSymbolIds?: readonly SymbolId[];
  readonly scatterSymbolIds?: readonly SymbolId[];
  readonly bonusSymbolIds?: readonly SymbolId[];
  readonly paytable?: PaytableSource | PaytableEngine;
  readonly payouts?: Readonly<Record<SymbolId, Readonly<Record<number, number>>>>;
  readonly wilds?: WildEngine | WildConfiguration | WildEngineConfigObject | boolean;
  readonly symbolFamilies?: readonly SymbolFamilyDefinition[];
  readonly familyCountingEnabled?: boolean;
  readonly mode?: WildRoundMode;
}

export type WaysEngineSource =
  | GameConfig
  | GameDefinition
  | WaysConfiguration
  | WaysEngineConfigObject;

export interface WaysEvaluationContext {
  readonly bet?: number;
  readonly mode?: WildRoundMode;
  readonly paytable?: PaytableSource | PaytableEngine;
  readonly wilds?: WildEngine | WildConfiguration | WildEngineConfigObject | boolean;
  readonly familyCountingEnabled?: boolean;
  readonly requireFullLength?: boolean;
}

/* -------------------------------------------------------------------------- */
/* 2. WAYS EVALUATION RESULT CONTRACTS                                        */
/* -------------------------------------------------------------------------- */

/**
 * Physical board coordinate contributing to a WaysWin.
 * Preserves both the actual landed symbol and the effective symbol so a
 * frontend can highlight all contributing cells without UI coordinates.
 */
export interface WaysMatchedCell extends Position {
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly actualSymbolId: SymbolId;
  readonly effectiveSymbolId: SymbolId;
  readonly isWildSubstituted: boolean;
  readonly stopIndex?: number;
}

/**
 * Per-reel symbol count and row positions for a participating reel in a WaysWin.
 */
export interface WaysReelCount {
  readonly reelIndex: number;
  readonly rowIndexes: readonly number[];
  readonly count: number;
  readonly actualSymbolIds: readonly SymbolId[];
  readonly wildCount: number;
}

/**
 * Serializable Ways-to-Win evaluation record for a single qualifying symbol.
 */
export interface WaysWin {
  readonly symbolId: SymbolId;
  readonly participatingReels: number;
  readonly matchCount: number;
  readonly reelCounts: readonly WaysReelCount[];
  readonly waysCount: number;
  readonly minimumReels: number;
  readonly baseMultiplier: number;
  readonly effectiveMultiplier: number;
  readonly matchedCells: readonly WaysMatchedCell[];
  readonly wildCount: number;
  readonly isAllWild: boolean;
  readonly familyId: string | null;
  readonly payout?: number;
}

/**
 * Serializable aggregate result produced by B09 `WaysEngine.evaluate(...)`.
 */
export interface WaysEvaluationResult {
  readonly wins: readonly WaysWin[];
  readonly totalWays: number;
  readonly totalWaysMultiplier: number;
  readonly totalPayout?: number;
}

export interface NormalizedWaysConfig {
  readonly enabled: boolean;
  readonly startReelIndex: number;
  readonly endReelIndex: number | null;
  readonly minimumConsecutiveReels: number;
  readonly maximumReels: number | null;
  readonly requireFullLength: boolean;
  readonly countingRule: WaysCountingRule;
  readonly knownSymbols: ReadonlySet<SymbolId> | null;
  readonly eligibleSymbols: ReadonlySet<SymbolId> | null;
  readonly eligibleSymbolOrder: readonly SymbolId[];
  readonly excludedSpecialSymbols: ReadonlySet<SymbolId>;
  readonly paytableLookup: NormalizedPaytableLookup | null;
  readonly wildEngine: WildEngine | null;
  readonly wildSymbolIds: ReadonlySet<SymbolId>;
  readonly wildPaysOnOwnBySymbol: ReadonlyMap<SymbolId, boolean>;
  readonly familyCountingEnabled: boolean;
  readonly memberToFamilyTarget: ReadonlyMap<
    SymbolId,
    { readonly targetSymbolId: SymbolId; readonly familyId: string }
  >;
  readonly mode: WildRoundMode;
}

export interface WaysEngine {
  readonly config?: NormalizedWaysConfig;
  evaluate(
    board: Board,
    configOrContext?: WaysEngineSource | WaysEvaluationContext | PayoutContext,
    maybeContext?: WaysEvaluationContext | PayoutContext,
  ): WaysEvaluationResult;
  getNormalizedConfig(source?: WaysEngineSource): NormalizedWaysConfig;
}

/* -------------------------------------------------------------------------- */
/* 3. ARITHMETIC SAFETY & VALIDATION HELPERS                                  */
/* -------------------------------------------------------------------------- */

const VALID_COUNTING_RULES = new Set<string>([
  "multiplyMatchingReelPositions",
  "singlePathPerReel",
]);

function isPaytableEngineLike(candidate: unknown): candidate is PaytableEngine {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    typeof (candidate as PaytableEngine).getMultiplier === "function"
  );
}

function isWildEngineLike(candidate: unknown): candidate is WildEngine {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    typeof (candidate as WildEngine).isWild === "function" &&
    typeof (candidate as WildEngine).canSubstitute === "function"
  );
}

function isCanonicalGameDefinition(
  candidate: unknown,
): candidate is GameDefinition {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    "waysConfiguration" in (candidate as Record<string, unknown>) &&
    "paytableDefinition" in (candidate as Record<string, unknown>) &&
    "canonicalSymbols" in (candidate as Record<string, unknown>)
  );
}

function isWaysEvaluationContext(
  candidate: unknown,
): candidate is WaysEvaluationContext {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }
  const rec = candidate as Record<string, unknown>;
  if (
    "minimumConsecutiveReels" in rec ||
    "startReelIndex" in rec ||
    "endReelIndex" in rec ||
    "countingRule" in rec ||
    "eligibleSymbols" in rec ||
    "symbolsById" in rec ||
    "waysConfiguration" in rec
  ) {
    return false;
  }
  return (
    "bet" in rec ||
    "mode" in rec ||
    "paytable" in rec ||
    "wilds" in rec ||
    "familyCountingEnabled" in rec ||
    "requireFullLength" in rec
  );
}

/**
 * Checked integer product for Ways counts (`c_0 * c_1 * ... * c_{k-1}`).
 * Detects `NaN`, `Infinity`, negative factors, and `Number.MAX_SAFE_INTEGER` overflow.
 */
export function safeMultiplyWaysCount(counts: readonly number[]): number {
  if (!Array.isArray(counts) || counts.length === 0) {
    return 0;
  }
  let product = 1;
  for (let i = 0; i < counts.length; i += 1) {
    const count = counts[i];
    if (
      typeof count !== "number" ||
      !Number.isFinite(count) ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      throw new WaysArithmeticOverflowError(
        `Invalid per-reel symbol count at index ${i}: ${String(count)}.`,
        { index: i, count },
      );
    }
    if (count === 0) {
      return 0;
    }
    const next = product * count;
    if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER || next < 0) {
      throw new WaysArithmeticOverflowError(
        `Ways product overflowed safe integer bounds when multiplying ${product} by ${count}.`,
        { counts, partialProduct: product, factor: count },
      );
    }
    product = next;
  }
  return product;
}

/**
 * Checked multiplication of `baseMultiplier * waysCount`.
 * Prevents silent `Infinity`, `NaN`, or negative effective multipliers.
 */
export function safeComputeEffectiveMultiplier(
  baseMultiplier: number,
  waysCount: number,
): number {
  if (
    typeof baseMultiplier !== "number" ||
    !Number.isFinite(baseMultiplier) ||
    baseMultiplier < 0
  ) {
    throw new WaysArithmeticOverflowError(
      `Invalid baseMultiplier in Ways calculation: ${String(baseMultiplier)}.`,
      { baseMultiplier, waysCount },
    );
  }
  if (
    typeof waysCount !== "number" ||
    !Number.isFinite(waysCount) ||
    waysCount < 0
  ) {
    throw new WaysArithmeticOverflowError(
      `Invalid waysCount in Ways calculation: ${String(waysCount)}.`,
      { baseMultiplier, waysCount },
    );
  }
  if (baseMultiplier === 0 || waysCount === 0) {
    return 0;
  }
  const raw = baseMultiplier * waysCount;
  if (!Number.isFinite(raw) || raw < 0 || raw > Number.MAX_SAFE_INTEGER) {
    throw new WaysArithmeticOverflowError(
      `Effective Ways multiplier overflowed safe numeric bounds (${baseMultiplier} * ${waysCount}).`,
      { baseMultiplier, waysCount },
    );
  }
  return roundCurrency(raw);
}

/**
 * Validates that `board` is a well-formed authoritative B04 `Board`.
 * Supports both uniform grids and variable reel heights (`board.reelHeights`).
 */
export function validateBoardForWays(board: Board): void {
  if (!board || typeof board !== "object" || Array.isArray(board)) {
    throw new InvalidBoardError(
      "Ways evaluation requires a valid non-null B04 Board object.",
      { board: String(board) },
    );
  }

  const reelCount =
    typeof board.reelCount === "number" ? board.reelCount : board.columns;
  const rowCount =
    typeof board.rowCount === "number" ? board.rowCount : board.rows;

  if (!Number.isInteger(reelCount) || reelCount < 1) {
    throw new InvalidBoardError(
      `Board must have a positive integer reelCount/columns, received ${String(reelCount)}.`,
      { reelCount },
    );
  }

  if (!Number.isInteger(rowCount) || rowCount < 1) {
    throw new InvalidBoardError(
      `Board must have a positive integer rowCount/rows, received ${String(rowCount)}.`,
      { rowCount },
    );
  }

  if (!Array.isArray(board.cells) || board.cells.length !== reelCount) {
    throw new InvalidBoardError(
      `Board cells column count (${Array.isArray(board.cells) ? board.cells.length : "non-array"}) does not match reelCount (${reelCount}).`,
      {
        reelCount,
        actualColumns: Array.isArray(board.cells) ? board.cells.length : null,
      },
    );
  }

  for (let reelIndex = 0; reelIndex < reelCount; reelIndex += 1) {
    const column = board.cells[reelIndex];
    const expectedRows =
      Array.isArray(board.reelHeights) &&
      typeof board.reelHeights[reelIndex] === "number"
        ? board.reelHeights[reelIndex]
        : rowCount;

    if (
      !Array.isArray(column) ||
      column.length < 1 ||
      !Number.isInteger(expectedRows) ||
      expectedRows < 1 ||
      column.length !== expectedRows
    ) {
      throw new InvalidBoardError(
        `Board column at reelIndex ${reelIndex} must contain ${String(expectedRows)} cells, received ${Array.isArray(column) ? column.length : "non-array"}.`,
        {
          reelIndex,
          expectedRows,
          actualRows: Array.isArray(column) ? column.length : null,
        },
      );
    }

    for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
      const cell = column[rowIndex];
      const symbolId =
        cell && typeof cell === "object"
          ? typeof cell.symbolId === "string"
            ? cell.symbolId
            : cell.symbol?.symbolId
          : undefined;
      if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
        throw new InvalidBoardError(
          `Board cell at reel ${reelIndex}, row ${rowIndex} is missing a valid symbolId.`,
          { reelIndex, rowIndex },
        );
      }
    }
  }
}

function buildPaytableLookup(
  paytableOption: PaytableSource | PaytableEngine | undefined,
): NormalizedPaytableLookup | null {
  if (paytableOption === undefined || paytableOption === null) {
    return null;
  }
  if (isPaytableEngineLike(paytableOption)) {
    return null;
  }
  try {
    return normalizePaytableLookup(paytableOption);
  } catch (err) {
    if (err instanceof SlotEngineError) {
      throw new InvalidPaytableReferenceError(
        `Invalid paytable reference in WaysEngine: ${err.message}`,
        { originalCode: err.code, ...err.context },
      );
    }
    throw new InvalidPaytableReferenceError(
      `Invalid paytable reference in WaysEngine: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Normalizes any supported `WaysEngineSource` into an immutable, validated
 * `NormalizedWaysConfig`.
 */
export function normalizeWaysConfiguration(
  source: WaysEngineSource = {},
): NormalizedWaysConfig {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new InvalidWaysConfigurationError(
      "WaysConfiguration must be a valid non-null object.",
      { source: String(source) },
    );
  }

  let enabled = true;
  let startReelIndex = 0;
  let endReelIndex: number | null = null;
  let minimumConsecutiveReels = 3;
  let maximumReels: number | null = null;
  let requireFullLength = false;
  let countingRule: WaysCountingRule = "multiplyMatchingReelPositions";
  let knownSymbols: Set<SymbolId> | null = null;
  let eligibleSymbols: Set<SymbolId> | null = null;
  const eligibleSymbolOrder: SymbolId[] = [];
  const excludedSpecialSymbols = new Set<SymbolId>();
  let paytableLookup: NormalizedPaytableLookup | null = null;
  let wildEngine: WildEngine | null = null;
  const wildSymbolIds = new Set<SymbolId>();
  const wildPaysOnOwnBySymbol = new Map<SymbolId, boolean>();
  let familyCountingEnabled = false;
  const memberToFamilyTarget = new Map<
    SymbolId,
    { readonly targetSymbolId: SymbolId; readonly familyId: string }
  >();
  let mode: WildRoundMode = "base";
  let configuredGridReels: number | null = null;

  if (isGameConfig(source as GameConfig)) {
    // 1. Normalized GameConfig from B01/B02
    const gameCfg = source as GameConfig;
    configuredGridReels = gameCfg.grid.columns;
    knownSymbols = new Set<SymbolId>(gameCfg.symbolsById.keys());
    if (gameCfg.variantsById) {
      for (const vId of gameCfg.variantsById.keys()) {
        knownSymbols.add(vId);
      }
    }

    for (const sId of gameCfg.scatterSymbolIds) {
      excludedSpecialSymbols.add(sId);
    }
    for (const bId of gameCfg.bonusSymbolIds) {
      excludedSpecialSymbols.add(bId);
    }
    for (const wId of gameCfg.wildSymbolIds) {
      wildSymbolIds.add(wId);
    }

    for (const sym of gameCfg.symbols) {
      if (!sym.role.isWild && !sym.role.isScatter && !sym.role.isBonus) {
        eligibleSymbolOrder.push(sym.id);
      }
    }

    paytableLookup = normalizePaytableLookup(gameCfg);

    if (
      gameCfg.wildConfiguration
        ? gameCfg.wildConfiguration.enabled
        : gameCfg.wildSymbolIds.size > 0
    ) {
      wildEngine = createWildEngine(gameCfg);
      for (const rule of gameCfg.wildConfiguration?.substitutionRules ?? []) {
        wildPaysOnOwnBySymbol.set(rule.wildSymbolId, Boolean(rule.paysOnOwn));
      }
    }

    const wc = gameCfg.waysConfiguration;
    if (wc) {
      enabled = Boolean(wc.enabled);
      startReelIndex = wc.startReelIndex ?? 0;
      endReelIndex = wc.endReelIndex ?? gameCfg.grid.columns - 1;
      minimumConsecutiveReels = wc.minimumConsecutiveReels ?? 3;
      if (wc.maximumReels !== undefined) {
        maximumReels = wc.maximumReels;
      }
      if (wc.requireFullLength !== undefined) {
        requireFullLength = Boolean(wc.requireFullLength);
      }
      if (wc.countingRule !== undefined) {
        countingRule = wc.countingRule;
      }
      if (wc.familyCountingEnabled !== undefined) {
        familyCountingEnabled = Boolean(wc.familyCountingEnabled);
      }
      if (wc.eligibleSymbols !== undefined) {
        eligibleSymbols = new Set(wc.eligibleSymbols);
      }
    } else {
      enabled = true;
      endReelIndex = gameCfg.grid.columns - 1;
    }

    if (familyCountingEnabled && gameCfg.symbolFamiliesById) {
      for (const [fId, memberIds] of gameCfg.symbolFamiliesById.entries()) {
        const targetSymbolId = memberIds[0];
        if (targetSymbolId) {
          for (const mId of memberIds) {
            memberToFamilyTarget.set(mId, {
              targetSymbolId,
              familyId: fId,
            });
          }
        }
      }
    }
  } else if (isCanonicalGameDefinition(source)) {
    // 2. Canonical GameDefinition from B02
    configuredGridReels = source.grid.reelCount;
    knownSymbols = new Set<SymbolId>();
    for (const sym of source.canonicalSymbols) {
      knownSymbols.add(sym.id);
      for (const v of sym.variants ?? []) {
        knownSymbols.add(v.id);
      }
      const isWild = sym.roles.includes("wild");
      const isScatter = sym.roles.includes("scatter");
      const isBonus = sym.roles.includes("bonus");
      if (isWild) {
        wildSymbolIds.add(sym.id);
      }
      if (isScatter) {
        excludedSpecialSymbols.add(sym.id);
      }
      if (isBonus) {
        excludedSpecialSymbols.add(sym.id);
      }
      if (!isWild && !isScatter && !isBonus) {
        eligibleSymbolOrder.push(sym.id);
      }
    }

    paytableLookup = normalizePaytableLookup(source.paytableDefinition);

    if (source.wildConfiguration?.enabled) {
      wildEngine = createWildEngine({
        ...source.wildConfiguration,
        knownSymbolIds: Array.from(knownSymbols),
        regularSymbolIds: eligibleSymbolOrder,
        scatterSymbolIds: Array.from(excludedSpecialSymbols),
        paytable: source.paytableDefinition,
        reelCount: source.grid.reelCount,
      });
      for (const rule of source.wildConfiguration.substitutionRules) {
        wildPaysOnOwnBySymbol.set(rule.wildSymbolId, Boolean(rule.paysOnOwn));
      }
    }

    const wc = source.waysConfiguration;
    enabled = Boolean(wc.enabled);
    startReelIndex = wc.startReelIndex ?? 0;
    endReelIndex = wc.endReelIndex ?? source.grid.reelCount - 1;
    minimumConsecutiveReels = wc.minimumConsecutiveReels ?? 3;
    if (wc.maximumReels !== undefined) {
      maximumReels = wc.maximumReels;
    }
    if (wc.requireFullLength !== undefined) {
      requireFullLength = Boolean(wc.requireFullLength);
    }
    if (wc.countingRule !== undefined) {
      countingRule = wc.countingRule;
    }
    familyCountingEnabled = Boolean(
      wc.familyCountingEnabled ?? source.winEvaluation?.familyCountingEnabled,
    );
    if (wc.eligibleSymbols !== undefined) {
      eligibleSymbols = new Set(wc.eligibleSymbols);
    }

    if (familyCountingEnabled) {
      for (const fam of source.symbolFamilies ?? []) {
        if (fam.allowMixedCounting) {
          const targetSymbolId =
            fam.baseSymbolId ?? fam.memberIds[0] ?? fam.id;
          for (const mId of fam.memberIds) {
            memberToFamilyTarget.set(mId, {
              targetSymbolId,
              familyId: fam.id,
            });
          }
        }
      }
    }
  } else {
    // 3. WaysConfiguration or WaysEngineConfigObject
    const cfg = source as WaysEngineConfigObject;
    if (cfg.enabled !== undefined) {
      if (typeof cfg.enabled !== "boolean") {
        throw new InvalidWaysConfigurationError(
          "WaysConfiguration.enabled must be a boolean.",
          { enabled: cfg.enabled },
        );
      }
      enabled = cfg.enabled;
    }
    if (cfg.startReelIndex !== undefined) {
      startReelIndex = cfg.startReelIndex;
    }
    if (cfg.endReelIndex !== undefined) {
      endReelIndex = cfg.endReelIndex;
    }
    if (cfg.minimumConsecutiveReels !== undefined) {
      minimumConsecutiveReels = cfg.minimumConsecutiveReels;
    }
    if (cfg.maximumReels !== undefined) {
      maximumReels = cfg.maximumReels;
    }
    if (cfg.requireFullLength !== undefined) {
      if (typeof cfg.requireFullLength !== "boolean") {
        throw new InvalidWaysConfigurationError(
          "WaysConfiguration.requireFullLength must be a boolean.",
          { requireFullLength: cfg.requireFullLength },
        );
      }
      requireFullLength = cfg.requireFullLength;
    }
    if (cfg.countingRule !== undefined) {
      countingRule = cfg.countingRule;
    }
    if (cfg.mode !== undefined) {
      mode = cfg.mode;
    }

    if (cfg.knownSymbolIds !== undefined) {
      if (!Array.isArray(cfg.knownSymbolIds)) {
        throw new InvalidWaysConfigurationError(
          "knownSymbolIds must be an array of symbol IDs.",
        );
      }
      knownSymbols = new Set<SymbolId>();
      for (const id of cfg.knownSymbolIds) {
        if (typeof id !== "string" || id.trim().length === 0) {
          throw new UnknownWaysSymbolError(
            "knownSymbolIds contains an empty or non-string symbol ID.",
            { symbolId: id },
          );
        }
        knownSymbols.add(id);
      }
    }

    if (cfg.scatterSymbolIds !== undefined) {
      for (const id of cfg.scatterSymbolIds) {
        excludedSpecialSymbols.add(id);
      }
    }
    if (cfg.bonusSymbolIds !== undefined) {
      for (const id of cfg.bonusSymbolIds) {
        excludedSpecialSymbols.add(id);
      }
    }

    if (cfg.payouts !== undefined) {
      paytableLookup = buildPaytableLookup(cfg.payouts);
    } else if (cfg.paytable !== undefined) {
      paytableLookup = buildPaytableLookup(cfg.paytable);
    }

    if (paytableLookup) {
      for (const symId of paytableLookup.knownSymbolIds) {
        if (!excludedSpecialSymbols.has(symId)) {
          eligibleSymbolOrder.push(symId);
        }
      }
    }

    if (cfg.eligibleSymbols !== undefined) {
      if (!Array.isArray(cfg.eligibleSymbols)) {
        throw new InvalidWaysConfigurationError(
          "WaysConfiguration.eligibleSymbols must be an array of symbol IDs.",
        );
      }
      eligibleSymbols = new Set<SymbolId>();
      for (const symId of cfg.eligibleSymbols) {
        if (typeof symId !== "string" || symId.trim().length === 0) {
          throw new UnknownWaysSymbolError(
            "eligibleSymbols contains an empty or non-string symbol ID.",
            { symbolId: symId },
          );
        }
        if (knownSymbols && !knownSymbols.has(symId)) {
          throw new UnknownWaysSymbolError(
            `WaysConfiguration.eligibleSymbols references unknown symbol "${symId}".`,
            { symbolId: symId },
          );
        }
        eligibleSymbols.add(symId);
        if (!eligibleSymbolOrder.includes(symId)) {
          eligibleSymbolOrder.push(symId);
        }
      }
    }

    if (cfg.wilds !== undefined && cfg.wilds !== false) {
      if (isWildEngineLike(cfg.wilds)) {
        wildEngine = cfg.wilds;
      } else if (typeof cfg.wilds === "object") {
        wildEngine = createWildEngine(cfg.wilds);
        if ("substitutionRules" in cfg.wilds && Array.isArray(cfg.wilds.substitutionRules)) {
          for (const rule of cfg.wilds.substitutionRules) {
            wildSymbolIds.add(rule.wildSymbolId);
            wildPaysOnOwnBySymbol.set(rule.wildSymbolId, Boolean(rule.paysOnOwn));
          }
        }
        if ("symbolIds" in cfg.wilds && Array.isArray(cfg.wilds.symbolIds)) {
          for (const wId of cfg.wilds.symbolIds) {
            wildSymbolIds.add(wId);
          }
        }
      }
    }

    familyCountingEnabled = Boolean(cfg.familyCountingEnabled);
    if (cfg.symbolFamilies !== undefined) {
      if (!Array.isArray(cfg.symbolFamilies)) {
        throw new InvalidWaysConfigurationError(
          "symbolFamilies must be an array of SymbolFamilyDefinition objects.",
        );
      }
      if (familyCountingEnabled) {
        for (const fam of cfg.symbolFamilies) {
          if (!fam || typeof fam !== "object" || !Array.isArray(fam.memberIds)) {
            throw new InvalidWaysConfigurationError(
              "Invalid SymbolFamilyDefinition in WaysConfiguration.",
            );
          }
          if (fam.allowMixedCounting) {
            const targetSymbolId =
              fam.baseSymbolId ?? fam.memberIds[0] ?? fam.id;
            for (const mId of fam.memberIds) {
              if (knownSymbols && !knownSymbols.has(mId)) {
                throw new UnknownWaysSymbolError(
                  `SymbolFamily "${fam.id}" references unknown member symbol "${mId}".`,
                  { familyId: fam.id, symbolId: mId },
                );
              }
              memberToFamilyTarget.set(mId, {
                targetSymbolId,
                familyId: fam.id,
              });
            }
          }
        }
      }
    }
  }

  // Validate startReelIndex, endReelIndex, minimumConsecutiveReels, maximumReels, countingRule
  if (!Number.isInteger(startReelIndex) || startReelIndex !== 0) {
    throw new InvalidWaysConfigurationError(
      `Ways evaluation requires startReelIndex = 0, received ${String(startReelIndex)}.`,
      { startReelIndex },
    );
  }

  if (
    endReelIndex !== null &&
    (!Number.isInteger(endReelIndex) || endReelIndex < 0)
  ) {
    throw new InvalidWaysConfigurationError(
      `WaysConfiguration.endReelIndex must be a non-negative integer, received ${String(endReelIndex)}.`,
      { endReelIndex },
    );
  }

  if (
    maximumReels !== null &&
    (!Number.isInteger(maximumReels) || maximumReels < 1)
  ) {
    throw new InvalidWaysConfigurationError(
      `WaysConfiguration.maximumReels must be a positive integer >= 1, received ${String(maximumReels)}.`,
      { maximumReels },
    );
  }

  if (
    typeof minimumConsecutiveReels !== "number" ||
    !Number.isInteger(minimumConsecutiveReels) ||
    minimumConsecutiveReels < 1
  ) {
    throw new InvalidMinimumReelCountError(
      `WaysConfiguration.minimumConsecutiveReels must be a positive integer >= 1, received ${String(minimumConsecutiveReels)}.`,
      { minimumConsecutiveReels },
    );
  }

  const knownMaxReels =
    maximumReels ??
    (endReelIndex !== null ? endReelIndex + 1 : configuredGridReels);

  if (knownMaxReels !== null && minimumConsecutiveReels > knownMaxReels) {
    throw new InvalidMinimumReelCountError(
      `minimumConsecutiveReels (${minimumConsecutiveReels}) cannot exceed available reel count (${knownMaxReels}).`,
      { minimumConsecutiveReels, availableReels: knownMaxReels },
    );
  }

  if (!VALID_COUNTING_RULES.has(countingRule)) {
    throw new InvalidWaysConfigurationError(
      `Unsupported Ways countingRule "${String(countingRule)}".`,
      { countingRule },
    );
  }

  if (eligibleSymbols && knownSymbols) {
    for (const symId of eligibleSymbols) {
      if (!knownSymbols.has(symId)) {
        throw new UnknownWaysSymbolError(
          `WaysConfiguration.eligibleSymbols references unknown symbol "${symId}".`,
          { symbolId: symId },
        );
      }
    }
  }

  return Object.freeze({
    enabled,
    startReelIndex,
    endReelIndex,
    minimumConsecutiveReels,
    maximumReels,
    requireFullLength,
    countingRule,
    knownSymbols,
    eligibleSymbols,
    eligibleSymbolOrder: Object.freeze(eligibleSymbolOrder),
    excludedSpecialSymbols,
    paytableLookup,
    wildEngine,
    wildSymbolIds,
    wildPaysOnOwnBySymbol,
    familyCountingEnabled,
    memberToFamilyTarget,
    mode,
  });
}

function isNormalizedWaysConfig(
  candidate: unknown,
): candidate is NormalizedWaysConfig {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    "memberToFamilyTarget" in (candidate as Record<string, unknown>) &&
    (candidate as NormalizedWaysConfig).memberToFamilyTarget instanceof Map
  );
}

/* -------------------------------------------------------------------------- */
/* 4. SINGLE-PASS BOARD INDEXING & CORE WAYS EVALUATION                       */
/* -------------------------------------------------------------------------- */

interface IndexedCellEntry {
  readonly rowIndex: number;
  readonly actualSymbolId: SymbolId;
  readonly canonicalSymbolId: SymbolId;
  readonly familyId: string | null;
  readonly isWildOnReel: boolean;
  readonly stopIndex?: number;
}

function resolveWildEngineFromContext(
  baseWildEngine: WildEngine | null,
  contextWilds: WaysEvaluationContext["wilds"],
): WildEngine | null {
  if (contextWilds === undefined) {
    return baseWildEngine;
  }
  if (contextWilds === false) {
    return null;
  }
  if (contextWilds === true) {
    return baseWildEngine;
  }
  if (isWildEngineLike(contextWilds)) {
    return contextWilds;
  }
  return createWildEngine(contextWilds);
}

/**
 * Evaluates all Ways-to-Win combinations on the authoritative B04 `Board`.
 */
export function evaluateWays(
  board: Board,
  config: WaysEngineSource | NormalizedWaysConfig = {},
  context?: WaysEvaluationContext | PayoutContext,
): WaysEvaluationResult {
  validateBoardForWays(board);

  const normalized = isNormalizedWaysConfig(config)
    ? config
    : normalizeWaysConfiguration(config);

  const ctx = (context ?? {}) as WaysEvaluationContext;
  let bet: number | undefined;
  if (ctx.bet !== undefined) {
    if (typeof ctx.bet !== "number" || !Number.isFinite(ctx.bet) || ctx.bet < 0) {
      throw new InvalidBetError(
        `Ways evaluation requires a finite non-negative bet when provided, received ${String(ctx.bet)}.`,
        { bet: ctx.bet },
      );
    }
    bet = ctx.bet === 0 ? 0 : ctx.bet;
  }

  const boardReels =
    typeof board.reelCount === "number" ? board.reelCount : board.columns;
  const maxConfiguredReels =
    normalized.maximumReels !== null
      ? Math.min(boardReels, normalized.maximumReels)
      : normalized.endReelIndex !== null
        ? Math.min(boardReels, normalized.endReelIndex + 1)
        : boardReels;

  if (normalized.minimumConsecutiveReels > maxConfiguredReels) {
    throw new InvalidMinimumReelCountError(
      `minimumConsecutiveReels (${normalized.minimumConsecutiveReels}) exceeds board/configured reel count (${maxConfiguredReels}).`,
      {
        minimumConsecutiveReels: normalized.minimumConsecutiveReels,
        boardReels: maxConfiguredReels,
      },
    );
  }

  if (!normalized.enabled) {
    return Object.freeze({
      wins: Object.freeze([]),
      totalWays: 0,
      totalWaysMultiplier: 0,
      ...(bet !== undefined ? { totalPayout: 0 } : {}),
    });
  }

  const activeMode: WildRoundMode = ctx.mode ?? normalized.mode;
  const requireFullLength =
    ctx.requireFullLength ?? normalized.requireFullLength;
  const familyCountingEnabled =
    ctx.familyCountingEnabled ?? normalized.familyCountingEnabled;
  const wildEngine = resolveWildEngineFromContext(
    normalized.wildEngine,
    ctx.wilds,
  );
  const paytableLookup =
    ctx.paytable !== undefined
      ? buildPaytableLookup(ctx.paytable)
      : normalized.paytableLookup;

  const wildEvalBaseCtx: WildEvaluationContext = {
    mode: activeMode,
    winMode: "ways",
  };

  // Helper to check if a symbol is eligible to be evaluated as a Ways target symbol
  const isEligibleTargetSymbol = (symId: SymbolId): boolean => {
    if (normalized.eligibleSymbols) {
      return normalized.eligibleSymbols.has(symId);
    }
    if (normalized.excludedSpecialSymbols.has(symId)) {
      return false;
    }
    if (wildEngine && wildEngine.isWild(symId)) {
      return false;
    }
    if (
      paytableLookup &&
      paytableLookup.bySymbolId.size > 0 &&
      !paytableLookup.bySymbolId.has(symId)
    ) {
      return false;
    }
    return true;
  };

  // Single-pass board scan across reels 0 .. maxConfiguredReels - 1
  const indexedReels: IndexedCellEntry[][] = [];
  const candidateOrder: SymbolId[] = [];
  const candidateSeen = new Set<SymbolId>();
  let reel0HasActiveWild = false;

  for (let reelIndex = 0; reelIndex < maxConfiguredReels; reelIndex += 1) {
    const column: readonly Cell[] = board.cells[reelIndex];
    const entries: IndexedCellEntry[] = [];

    for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
      const cell = column[rowIndex];
      const actualSymbolId =
        typeof cell.symbolId === "string"
          ? cell.symbolId
          : cell.symbol.symbolId;

      if (
        normalized.knownSymbols &&
        !normalized.knownSymbols.has(actualSymbolId)
      ) {
        throw new UnknownWaysSymbolError(
          `Board cell at reel ${reelIndex}, row ${rowIndex} contains unknown symbol "${actualSymbolId}".`,
          { reelIndex, rowIndex, symbolId: actualSymbolId },
        );
      }

      const isWildOnReel = Boolean(
        wildEngine &&
          wildEngine.isWildActiveOnReel(actualSymbolId, reelIndex, {
            ...wildEvalBaseCtx,
            reelIndex,
          }),
      );

      let canonicalSymbolId = actualSymbolId;
      let familyId: string | null = null;
      if (familyCountingEnabled) {
        const famMapping = normalized.memberToFamilyTarget.get(actualSymbolId);
        if (famMapping) {
          canonicalSymbolId = famMapping.targetSymbolId;
          familyId = famMapping.familyId;
        }
      }

      entries.push({
        rowIndex,
        actualSymbolId,
        canonicalSymbolId,
        familyId,
        isWildOnReel,
        ...(typeof cell.stopIndex === "number"
          ? { stopIndex: cell.stopIndex }
          : {}),
      });

      if (reelIndex === 0) {
        if (isWildOnReel) {
          reel0HasActiveWild = true;
        }
        if (
          !isWildOnReel &&
          isEligibleTargetSymbol(canonicalSymbolId) &&
          !candidateSeen.has(canonicalSymbolId)
        ) {
          candidateSeen.add(canonicalSymbolId);
          candidateOrder.push(canonicalSymbolId);
        }
      }
    }

    indexedReels.push(entries);
  }

  // If reel 0 has an active Wild, also check if any eligible symbol on reel 1+
  // can start on reel 0 via that Wild substitution (while still requiring at least
  // one actual occurrence of that symbol in the consecutive run so Wild-only
  // runs are not duplicated across all symbols).
  if (reel0HasActiveWild && wildEngine) {
    const reel0Wilds = indexedReels[0].filter((e) => e.isWildOnReel);
    for (let reelIndex = 1; reelIndex < maxConfiguredReels; reelIndex += 1) {
      for (const entry of indexedReels[reelIndex]) {
        const symId = entry.canonicalSymbolId;
        if (
          !entry.isWildOnReel &&
          !candidateSeen.has(symId) &&
          isEligibleTargetSymbol(symId) &&
          reel0Wilds.some((w) =>
            wildEngine.canSubstitute(w.actualSymbolId, symId, {
              ...wildEvalBaseCtx,
              reelIndex: 0,
            }),
          )
        ) {
          candidateSeen.add(symId);
          candidateOrder.push(symId);
        }
      }
    }
  }

  const wins: WaysWin[] = [];

  const evaluateCandidate = (
    targetSymbolId: SymbolId,
    allowPureWildRun: boolean,
  ): WaysWin | null => {
    const reelCounts: WaysReelCount[] = [];
    const matchedCells: WaysMatchedCell[] = [];
    let totalWildsInRun = 0;
    let totalActualTargetInRun = 0;
    let detectedFamilyId: string | null = null;

    for (let reelIndex = 0; reelIndex < maxConfiguredReels; reelIndex += 1) {
      const reelEntries = indexedReels[reelIndex];
      const rowIndexes: number[] = [];
      const actualSymbolIds: SymbolId[] = [];
      let reelWildCount = 0;

      for (let i = 0; i < reelEntries.length; i += 1) {
        const entry = reelEntries[i];
        let matches = false;
        let substituted = false;

        if (entry.canonicalSymbolId === targetSymbolId && !entry.isWildOnReel) {
          matches = true;
          totalActualTargetInRun += 1;
          if (entry.familyId && !detectedFamilyId) {
            detectedFamilyId = entry.familyId;
          }
        } else if (entry.actualSymbolId === targetSymbolId) {
          matches = true;
          if (entry.isWildOnReel) {
            reelWildCount += 1;
            totalWildsInRun += 1;
          } else {
            totalActualTargetInRun += 1;
          }
        } else if (
          entry.isWildOnReel &&
          wildEngine &&
          wildEngine.canSubstitute(entry.actualSymbolId, targetSymbolId, {
            ...wildEvalBaseCtx,
            reelIndex,
          })
        ) {
          matches = true;
          substituted = true;
          reelWildCount += 1;
          totalWildsInRun += 1;
        }

        if (matches) {
          rowIndexes.push(entry.rowIndex);
          actualSymbolIds.push(entry.actualSymbolId);
          matchedCells.push(
            Object.freeze({
              reelIndex,
              rowIndex: entry.rowIndex,
              actualSymbolId: entry.actualSymbolId,
              effectiveSymbolId: targetSymbolId,
              isWildSubstituted: substituted,
              ...(entry.stopIndex !== undefined
                ? { stopIndex: entry.stopIndex }
                : {}),
            }),
          );
        }
      }

      if (rowIndexes.length === 0) {
        // Consecutive rule: stop at first reel with 0 qualifying cells
        break;
      }

      reelCounts.push(
        Object.freeze({
          reelIndex,
          rowIndexes: Object.freeze(rowIndexes),
          count: rowIndexes.length,
          actualSymbolIds: Object.freeze(actualSymbolIds),
          wildCount: reelWildCount,
        }),
      );
    }

    const participatingReels = reelCounts.length;
    if (participatingReels < normalized.minimumConsecutiveReels) {
      return null;
    }
    if (requireFullLength && participatingReels < maxConfiguredReels) {
      return null;
    }
    if (!allowPureWildRun && totalActualTargetInRun === 0) {
      return null;
    }

    const waysCount =
      normalized.countingRule === "singlePathPerReel"
        ? 1
        : safeMultiplyWaysCount(reelCounts.map((r) => r.count));

    if (waysCount <= 0) {
      return null;
    }

    let baseMultiplier = 0;
    if (paytableLookup) {
      const symTiers = paytableLookup.bySymbolId.get(targetSymbolId);
      if (symTiers) {
        baseMultiplier = symTiers.get(participatingReels) ?? 0;
      }
    }

    const effectiveMultiplier = safeComputeEffectiveMultiplier(
      baseMultiplier,
      waysCount,
    );

    const winRecord: WaysWin = Object.freeze({
      symbolId: targetSymbolId,
      participatingReels,
      matchCount: participatingReels,
      reelCounts: Object.freeze(reelCounts),
      waysCount,
      minimumReels: normalized.minimumConsecutiveReels,
      baseMultiplier,
      effectiveMultiplier,
      matchedCells: Object.freeze(matchedCells),
      wildCount: totalWildsInRun,
      isAllWild: totalActualTargetInRun === 0 && totalWildsInRun > 0,
      familyId: detectedFamilyId,
      ...(bet !== undefined
        ? { payout: roundCurrency(effectiveMultiplier * bet) }
        : {}),
    });

    return winRecord;
  };

  for (const candidateSymbolId of candidateOrder) {
    const win = evaluateCandidate(candidateSymbolId, false);
    if (win) {
      wins.push(win);
    }
  }

  // WILD-ONLY handling:
  // If reel 0..k-1 contains active Wilds and no regular candidate win occurred
  // (or a pure-Wild consecutive run exists when paysOnOwn = true or All-Wild policy applies):
  if (reel0HasActiveWild && wildEngine) {
    // Count consecutive reels starting from reel 0 that have at least one active Wild
    let pureWildReels = 0;
    const reel0WildIds = new Set<SymbolId>();
    for (const e of indexedReels[0]) {
      if (e.isWildOnReel) {
        reel0WildIds.add(e.actualSymbolId);
      }
    }

    for (let reelIndex = 0; reelIndex < maxConfiguredReels; reelIndex += 1) {
      const hasWild = indexedReels[reelIndex].some((e) => e.isWildOnReel);
      if (!hasWild) break;
      pureWildReels += 1;
    }

    if (
      pureWildReels >= normalized.minimumConsecutiveReels &&
      (!requireFullLength || pureWildReels === maxConfiguredReels)
    ) {
      for (const wildSymId of reel0WildIds) {
        const paysOnOwn =
          normalized.wildPaysOnOwnBySymbol.get(wildSymId) ??
          Boolean(paytableLookup?.bySymbolId.has(wildSymId));

        if (paysOnOwn && wins.every((w) => w.symbolId !== wildSymId)) {
          const wildWin = evaluateCandidate(wildSymId, true);
          if (wildWin) {
            wins.push(wildWin);
          }
        } else if (!paysOnOwn && wins.length === 0 && paytableLookup) {
          // B07 shared All-Wild policy: resolve to highest-value eligible symbol in paytable
          let bestSymId: SymbolId | null = null;
          let bestMult = -1;
          const candidatePool =
            normalized.eligibleSymbolOrder.length > 0
              ? normalized.eligibleSymbolOrder
              : Array.from(paytableLookup.bySymbolId.keys());

          for (const symId of candidatePool) {
            if (!isEligibleTargetSymbol(symId)) continue;
            const canSubAll = Array.from(
              { length: pureWildReels },
              (_, rIdx) =>
                wildEngine.canSubstitute(wildSymId, symId, {
                  ...wildEvalBaseCtx,
                  reelIndex: rIdx,
                }),
            ).every(Boolean);
            if (!canSubAll) continue;
            const mult =
              paytableLookup.bySymbolId.get(symId)?.get(pureWildReels) ?? 0;
            if (mult > bestMult) {
              bestMult = mult;
              bestSymId = symId;
            }
          }

          if (bestSymId !== null) {
            const allWildWin = evaluateCandidate(bestSymId, true);
            if (allWildWin) {
              wins.push(allWildWin);
            }
          }
        }
      }
    }
  }

  let totalWays = 0;
  let totalWaysMultiplier = 0;
  let totalPayout = 0;

  for (const win of wins) {
    const nextTotalWays = totalWays + win.waysCount;
    if (
      !Number.isFinite(nextTotalWays) ||
      nextTotalWays > Number.MAX_SAFE_INTEGER
    ) {
      throw new WaysArithmeticOverflowError(
        "Total Ways count overflowed safe integer bounds.",
        { totalWays, addedWays: win.waysCount },
      );
    }
    totalWays = nextTotalWays;

    const nextTotalMult = roundCurrency(
      totalWaysMultiplier + win.effectiveMultiplier,
    );
    if (!Number.isFinite(nextTotalMult)) {
      throw new WaysArithmeticOverflowError(
        "Total Ways multiplier overflowed finite numeric bounds.",
        { totalWaysMultiplier, addedMultiplier: win.effectiveMultiplier },
      );
    }
    totalWaysMultiplier = nextTotalMult;

    if (bet !== undefined && win.payout !== undefined) {
      totalPayout = roundCurrency(totalPayout + win.payout);
    }
  }

  return Object.freeze({
    wins: Object.freeze(wins),
    totalWays,
    totalWaysMultiplier,
    ...(bet !== undefined ? { totalPayout } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* 5. DETERMINISTIC WAYS ENGINE IMPLEMENTATION                                */
/* -------------------------------------------------------------------------- */

export class DeterministicWaysEngine implements WaysEngine {
  public readonly config?: NormalizedWaysConfig;

  constructor(source?: WaysEngineSource) {
    if (source !== undefined) {
      this.config = normalizeWaysConfiguration(source);
    }
  }

  public getNormalizedConfig(source?: WaysEngineSource): NormalizedWaysConfig {
    if (source !== undefined) {
      return normalizeWaysConfiguration(source);
    }
    if (this.config) {
      return this.config;
    }
    return normalizeWaysConfiguration({});
  }

  public evaluate(
    board: Board,
    configOrContext?: WaysEngineSource | WaysEvaluationContext | PayoutContext,
    maybeContext?: WaysEvaluationContext | PayoutContext,
  ): WaysEvaluationResult {
    if (isWaysEvaluationContext(configOrContext)) {
      const cfg = this.getNormalizedConfig();
      return evaluateWays(board, cfg, configOrContext);
    }
    const cfg = this.getNormalizedConfig(
      configOrContext as WaysEngineSource | undefined,
    );
    return evaluateWays(board, cfg, maybeContext);
  }
}

export function createWaysEngine(source?: WaysEngineSource): WaysEngine {
  return new DeterministicWaysEngine(source);
}

/* -------------------------------------------------------------------------- */
/* 6. SERIALIZATION HELPERS                                                   */
/* -------------------------------------------------------------------------- */

export function serializeWaysEvaluationResult(
  result: WaysEvaluationResult,
): string {
  return JSON.stringify(result);
}

export function deserializeWaysEvaluationResult(
  serialized: string,
): WaysEvaluationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (err) {
    throw new InvalidWaysConfigurationError(
      `Failed to parse serialized WaysEvaluationResult JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidWaysConfigurationError(
      "Deserialized WaysEvaluationResult must be a JSON object.",
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (
    !Array.isArray(obj.wins) ||
    typeof obj.totalWays !== "number" ||
    !Number.isFinite(obj.totalWays) ||
    typeof obj.totalWaysMultiplier !== "number" ||
    !Number.isFinite(obj.totalWaysMultiplier)
  ) {
    throw new InvalidWaysConfigurationError(
      "Deserialized WaysEvaluationResult is missing required fields (wins, totalWays, totalWaysMultiplier).",
    );
  }

  const wins: WaysWin[] = obj.wins.map((raw, idx) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new InvalidWaysConfigurationError(
        `Deserialized wins[${idx}] must be an object.`,
      );
    }
    const item = raw as Record<string, unknown>;
    if (
      typeof item.symbolId !== "string" ||
      typeof item.participatingReels !== "number" ||
      !Array.isArray(item.reelCounts) ||
      typeof item.waysCount !== "number" ||
      typeof item.minimumReels !== "number" ||
      typeof item.baseMultiplier !== "number" ||
      typeof item.effectiveMultiplier !== "number"
    ) {
      throw new InvalidWaysConfigurationError(
        `Deserialized wins[${idx}] is missing required WaysWin fields.`,
      );
    }

    const reelCounts: WaysReelCount[] = item.reelCounts.map(
      (rc: Record<string, unknown>) =>
        Object.freeze({
          reelIndex: Number(rc.reelIndex),
          rowIndexes: Object.freeze(
            Array.isArray(rc.rowIndexes) ? rc.rowIndexes.map(Number) : [],
          ),
          count: Number(rc.count),
          actualSymbolIds: Object.freeze(
            Array.isArray(rc.actualSymbolIds)
              ? rc.actualSymbolIds.map(String)
              : [],
          ),
          wildCount: typeof rc.wildCount === "number" ? rc.wildCount : 0,
        }),
    );

    const matchedCells: WaysMatchedCell[] = Array.isArray(item.matchedCells)
      ? item.matchedCells.map((mc: Record<string, unknown>) =>
          Object.freeze({
            reelIndex: Number(mc.reelIndex),
            rowIndex: Number(mc.rowIndex),
            actualSymbolId: String(mc.actualSymbolId ?? item.symbolId),
            effectiveSymbolId: String(mc.effectiveSymbolId ?? item.symbolId),
            isWildSubstituted: Boolean(mc.isWildSubstituted),
            ...(typeof mc.stopIndex === "number"
              ? { stopIndex: mc.stopIndex }
              : {}),
          }),
        )
      : [];

    return Object.freeze({
      symbolId: item.symbolId,
      participatingReels: item.participatingReels,
      matchCount:
        typeof item.matchCount === "number"
          ? item.matchCount
          : item.participatingReels,
      reelCounts: Object.freeze(reelCounts),
      waysCount: item.waysCount,
      minimumReels: item.minimumReels,
      baseMultiplier: item.baseMultiplier,
      effectiveMultiplier: item.effectiveMultiplier,
      matchedCells: Object.freeze(matchedCells),
      wildCount: typeof item.wildCount === "number" ? item.wildCount : 0,
      isAllWild: Boolean(item.isAllWild),
      familyId: typeof item.familyId === "string" ? item.familyId : null,
      ...(typeof item.payout === "number" ? { payout: item.payout } : {}),
    });
  });

  return Object.freeze({
    wins: Object.freeze(wins),
    totalWays: obj.totalWays,
    totalWaysMultiplier: obj.totalWaysMultiplier,
    ...(typeof obj.totalPayout === "number"
      ? { totalPayout: obj.totalPayout }
      : {}),
  });
}
