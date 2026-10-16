/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 / B06 — PAYTABLE ENGINE & O(1) PAYOUT LOOKUP
 *
 * B06 consumes:
 * - PaylineMatch[] (or PaylineEvaluationResult from B05)
 * - PaytableDefinition / GameConfig (from B01/B02)
 * - PayoutContext ({ bet })
 *
 * and resolves the configured payout multiplier and payout value for each
 * eligible symbol combination.
 *
 * STRICT ARCHITECTURAL BOUNDARY (B06):
 * - Consumes B05 PaylineMatch results as authoritative
 * - Resolves payout multipliers via O(1) pre-indexed Map<SymbolId, Map<number, number>>
 * - Separates payout multiplier from currency/credit payout (multiplier * bet)
 * - Missing match count tiers resolve to multiplier = 0, payout = 0 (non-paying)
 * - Configured 0 multiplier resolves to multiplier = 0, payout = 0 (valid non-paying)
 * - NEVER reconstructs the board, reevaluates paylines, or inspects reel strips
 * - NEVER consumes RNG or calls Math.random()
 * - NEVER implements Wild substitution (reserved for B07)
 * - NEVER implements Scatter counting (reserved for B08)
 * - NEVER implements Ways, Cluster, Pay-Anywhere, Features, or Multipliers
 * - NEVER mutates GameConfig, PaytableDefinition, or PaylineMatch inputs
 */

import type {
  GameConfig,
  NormalizedPaytableEntry,
  PaylineId,
  SymbolId,
} from "../config";
import { isGameConfig } from "../config";
import {
  InvalidBetError,
  InvalidMatchCountError,
  InvalidPaytableError,
  InvalidPayoutMultiplierError,
  InvalidSymbolReferenceError,
  UnknownPaytableSymbolError,
} from "../errors";
import type {
  PaylineCellPosition,
  PaylineEvaluationResult,
  PaylineMatch,
} from "../paylines";
import type {
  CanonicalPaytableSymbolEntry,
  PaytableDefinition,
} from "../schema";

/* -------------------------------------------------------------------------- */
/* 1. B01 COMPATIBILITY CONTRACTS & ROUNDING UTILITY                          */
/* -------------------------------------------------------------------------- */

export type PaytableEntry = NormalizedPaytableEntry;

export interface Paytable {
  readonly entries: readonly NormalizedPaytableEntry[];
  readonly bySymbolId: ReadonlyMap<
    SymbolId,
    ReadonlyMap<number, NormalizedPaytableEntry>
  >;
}

export interface Payout {
  readonly symbolId: SymbolId;
  readonly matchCount: number;
  readonly baseMultiplier: number;
  readonly appliedMultiplier: number;
  readonly betUnit: number;
  readonly amount: number;
}

export interface PaytableResolver {
  getMultiplier(
    config: GameConfig,
    symbolId: SymbolId,
    matchCount: number,
  ): number;
  resolvePayout(
    config: GameConfig,
    symbolId: SymbolId,
    matchCount: number,
    betUnit: number,
    appliedMultiplier?: number,
  ): Payout | null;
}

/**
 * Cleans binary IEEE-754 floating-point drift to 4 decimal places while leaving
 * exact integers untouched.
 */
export function roundCurrency(value: number): number {
  if (Number.isInteger(value)) {
    return value === 0 ? 0 : value;
  }
  const rounded = Math.round((value + Number.EPSILON) * 10000) / 10000;
  return rounded === 0 ? 0 : rounded;
}

export class DefaultPaytableResolver implements PaytableResolver {
  public getMultiplier(
    config: GameConfig,
    symbolId: SymbolId,
    matchCount: number,
  ): number {
    if (!config.symbolsById.has(symbolId)) {
      throw new InvalidSymbolReferenceError(
        `Paytable lookup references unknown symbol "${symbolId}".`,
        { symbolId, matchCount },
      );
    }
    if (!Number.isInteger(matchCount) || matchCount < 1) {
      throw new InvalidPaytableError(
        `Paytable lookup requires positive integer matchCount, received ${String(matchCount)}.`,
        { symbolId, matchCount },
      );
    }
    const perSymbol = config.paytableBySymbolId.get(symbolId);
    if (!perSymbol) return 0;
    const entry = perSymbol.get(matchCount);
    return entry ? entry.payoutMultiplier : 0;
  }

  public resolvePayout(
    config: GameConfig,
    symbolId: SymbolId,
    matchCount: number,
    betUnit: number,
    appliedMultiplier = 1,
  ): Payout | null {
    const baseMultiplier = this.getMultiplier(config, symbolId, matchCount);
    if (baseMultiplier <= 0) return null;

    const amount = roundCurrency(
      baseMultiplier * betUnit * appliedMultiplier,
    );

    return Object.freeze({
      symbolId,
      matchCount,
      baseMultiplier,
      appliedMultiplier,
      betUnit,
      amount,
    });
  }
}

export function createPaytableResolver(): PaytableResolver {
  return new DefaultPaytableResolver();
}

/* -------------------------------------------------------------------------- */
/* 2. B06 PAYTABLE ENGINE CONTRACTS                                           */
/* -------------------------------------------------------------------------- */

/**
 * Supported paytable configuration sources for B06:
 * - Normalized `GameConfig` (B01/B02)
 * - Canonical `PaytableDefinition` (B02)
 * - Array of `CanonicalPaytableSymbolEntry` (`{ symbolId, payouts: { [matchCount]: multiplier } }`)
 * - Record map `{ [symbolId]: { [matchCount]: multiplier } }`
 */
export type PaytableSource =
  | GameConfig
  | PaytableDefinition
  | readonly CanonicalPaytableSymbolEntry[]
  | Readonly<Record<SymbolId, Readonly<Record<number, number>>>>;

/**
 * Bet context for resolving paytable multipliers into concrete payout values.
 */
export interface PayoutContext {
  readonly bet: number;
}

export interface PaytableEngineOptions {
  /**
   * When true, unknown symbol IDs resolve to multiplier = 0 (non-paying)
   * instead of throwing `UnknownPaytableSymbolError`.
   * Defaults to `false` (strict symbol validation).
   */
  readonly allowUnknownSymbolsAsNonPaying?: boolean;
  /**
   * When true, `evaluate(...)` includes non-paying lines (`multiplier === 0`)
   * inside `result.payouts` as well as `result.allPayouts`.
   * Defaults to `false` so `result.payouts` lists paying lines while
   * `result.allPayouts` retains all evaluated lines.
   */
  readonly includeNonPaying?: boolean;
}

/**
 * Serializable payout result for a single evaluated B05 `PaylineMatch`.
 */
export interface PaylinePayout {
  readonly paylineId: PaylineId;
  readonly paylineIndex: number;
  readonly symbolId: SymbolId;
  readonly matchCount: number;
  readonly multiplier: number;
  readonly payoutMultiplier: number;
  readonly bet: number;
  readonly payout: number;
  readonly isPaying: boolean;
  readonly reelIndexes: readonly number[];
  readonly cellPositions: readonly PaylineCellPosition[];
}

/**
 * Serializable aggregate result of B06 paytable evaluation across B05 matches.
 */
export interface PaytableEvaluationResult {
  /** Paying line payouts (or all line payouts when `includeNonPaying: true`). */
  readonly payouts: readonly PaylinePayout[];
  /** Complete list of all evaluated line payouts (both paying and non-paying). */
  readonly allPayouts: readonly PaylinePayout[];
  /** Sum of individual line payouts (`sum(line.payout)`). */
  readonly totalPayout: number;
  /** Sum of individual line multipliers (`sum(line.multiplier)`). */
  readonly totalMultiplier: number;
  /** Count of lines with `multiplier > 0`. */
  readonly payingLineCount: number;
  /** Count of lines with `multiplier === 0`. */
  readonly nonPayingLineCount: number;
  /** Total number of B05 PaylineMatch items evaluated. */
  readonly evaluatedMatchCount: number;
}

export interface PaytableEngine {
  /**
   * Returns the configured payout multiplier for `(symbolId, matchCount)`.
   * Returns `0` if `symbolId` is valid but has no configured entry for `matchCount`.
   * Throws `UnknownPaytableSymbolError` if `symbolId` is unknown (unless `allowUnknownSymbolsAsNonPaying` is set).
   * Throws `InvalidMatchCountError` if `matchCount` is not a positive integer.
   */
  getMultiplier(symbolId: SymbolId, matchCount: number): number;

  /**
   * Alias for `getMultiplier(symbolId, matchCount)` for reusable cross-evaluator lookup.
   */
  getPayoutMultiplier(symbolId: SymbolId, matchCount: number): number;

  /**
   * Returns true if `symbolId` is registered in this paytable.
   */
  hasSymbol(symbolId: SymbolId): boolean;

  /**
   * Evaluates a single B05 `PaylineMatch` against the paytable and bet context.
   * Always returns a structured `PaylinePayout` (with `multiplier = 0, payout = 0, isPaying = false`
   * when the match count is non-paying or configured as `0`).
   */
  evaluateMatch(
    match: PaylineMatch,
    context: PayoutContext | number,
  ): PaylinePayout;

  /**
   * Evaluates a collection of B05 `PaylineMatch` results (or a `PaylineEvaluationResult`)
   * independently and sums `totalPayout`.
   */
  evaluate(
    matchesOrResult: readonly PaylineMatch[] | PaylineEvaluationResult,
    context: PayoutContext | number,
    options?: PaytableEngineOptions,
  ): PaytableEvaluationResult;
}

/* -------------------------------------------------------------------------- */
/* 3. VALIDATION & NORMALIZED O(1) PAYTABLE INDEXING                          */
/* -------------------------------------------------------------------------- */

export interface NormalizedPaytableLookup {
  readonly bySymbolId: ReadonlyMap<SymbolId, ReadonlyMap<number, number>>;
  readonly knownSymbolIds: ReadonlySet<SymbolId>;
}

function validateMultiplierValue(
  symbolId: string,
  matchCount: number,
  multiplier: unknown,
): number {
  if (
    typeof multiplier !== "number" ||
    !Number.isFinite(multiplier) ||
    multiplier < 0
  ) {
    throw new InvalidPayoutMultiplierError(
      `Invalid payout multiplier (${String(multiplier)}) for symbol "${symbolId}" at matchCount ${matchCount}; expected a finite number >= 0.`,
      { symbolId, matchCount, multiplier },
    );
  }
  return multiplier === 0 ? 0 : multiplier;
}

function validateMatchCountKey(symbolId: string, rawKey: unknown): number {
  const num = typeof rawKey === "number" ? rawKey : Number(rawKey);
  if (!Number.isInteger(num) || num < 1) {
    throw new InvalidMatchCountError(
      `Invalid paytable matchCount (${String(rawKey)}) for symbol "${symbolId}"; expected an integer >= 1.`,
      { symbolId, matchCount: rawKey },
    );
  }
  return num;
}

function isPaytableDefinitionObject(
  source: unknown,
): source is PaytableDefinition {
  return (
    Boolean(source) &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    "entries" in (source as Record<string, unknown>) &&
    Array.isArray((source as PaytableDefinition).entries)
  );
}

/**
 * Validates and indexes any supported `PaytableSource` into an O(1) lookup table.
 * Does not mutate or deep-clone the input source.
 */
export function normalizePaytableLookup(
  source: PaytableSource,
): NormalizedPaytableLookup {
  if (!source || typeof source !== "object") {
    throw new InvalidPaytableError(
      "Paytable Engine requires a valid GameConfig, PaytableDefinition, or paytable entry collection.",
      { source },
    );
  }

  const bySymbolId = new Map<SymbolId, ReadonlyMap<number, number>>();
  const knownSymbolIds = new Set<SymbolId>();

  // Case 1: Normalized GameConfig from B01/B02
  if (isGameConfig(source as GameConfig)) {
    const config = source as GameConfig;

    for (const sym of config.symbols) {
      knownSymbolIds.add(sym.id);
      const ladder = new Map<number, number>();
      if (sym.payoutsByCount && typeof sym.payoutsByCount === "object") {
        for (const [rawMatch, rawMult] of Object.entries(sym.payoutsByCount)) {
          const matchCount = validateMatchCountKey(sym.id, rawMatch);
          const mult = validateMultiplierValue(sym.id, matchCount, rawMult);
          ladder.set(matchCount, mult);
        }
      }
      bySymbolId.set(sym.id, ladder);
    }

    if (config.variantsById) {
      for (const [variantId] of config.variantsById.entries()) {
        knownSymbolIds.add(variantId);
        if (!bySymbolId.has(variantId)) {
          bySymbolId.set(variantId, new Map<number, number>());
        }
      }
    }

    // Also validate & overlay any entries in config.paytableEntries / config.paytableBySymbolId
    for (const entry of config.paytableEntries ?? []) {
      if (
        !entry ||
        typeof entry.symbolId !== "string" ||
        entry.symbolId.trim().length === 0
      ) {
        throw new InvalidPaytableError(
          "Paytable entry in GameConfig is missing a valid symbolId.",
          { entry },
        );
      }
      const matchCount = validateMatchCountKey(
        entry.symbolId,
        entry.matchCount,
      );
      const mult = validateMultiplierValue(
        entry.symbolId,
        matchCount,
        entry.payoutMultiplier,
      );
      knownSymbolIds.add(entry.symbolId);
      const existing = new Map<number, number>(
        bySymbolId.get(entry.symbolId) ?? [],
      );
      existing.set(matchCount, mult);
      bySymbolId.set(entry.symbolId, existing);
    }

    return Object.freeze({
      bySymbolId,
      knownSymbolIds,
    });
  }

  // Case 2: Canonical PaytableDefinition or readonly CanonicalPaytableSymbolEntry[]
  if (Array.isArray(source) || isPaytableDefinitionObject(source)) {
    const entries: readonly CanonicalPaytableSymbolEntry[] = Array.isArray(
      source,
    )
      ? source
      : source.entries;

    if (
      !Array.isArray(source) &&
      source.minMatchCount !== undefined &&
      (!Number.isInteger(source.minMatchCount) || source.minMatchCount < 1)
    ) {
      throw new InvalidMatchCountError(
        `PaytableDefinition.minMatchCount (${String(source.minMatchCount)}) must be a positive integer.`,
        { minMatchCount: source.minMatchCount },
      );
    }

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (!entry || typeof entry !== "object") {
        throw new InvalidPaytableError(
          `Paytable entry at index ${i} must be an object.`,
          { index: i, entry },
        );
      }
      if (
        typeof entry.symbolId !== "string" ||
        entry.symbolId.trim().length === 0
      ) {
        throw new InvalidPaytableError(
          `Paytable entry at index ${i} is missing a non-empty symbolId.`,
          { index: i, entry },
        );
      }
      if (knownSymbolIds.has(entry.symbolId)) {
        throw new InvalidPaytableError(
          `Duplicate paytable entry for symbol "${entry.symbolId}" at index ${i}.`,
          { symbolId: entry.symbolId, index: i },
        );
      }
      if (
        !entry.payouts ||
        typeof entry.payouts !== "object" ||
        Array.isArray(entry.payouts)
      ) {
        throw new InvalidPaytableError(
          `Paytable entry for symbol "${entry.symbolId}" must contain a payouts map.`,
          { symbolId: entry.symbolId },
        );
      }

      const ladder = new Map<number, number>();
      for (const [rawMatch, rawMult] of Object.entries(entry.payouts)) {
        const matchCount = validateMatchCountKey(entry.symbolId, rawMatch);
        const mult = validateMultiplierValue(
          entry.symbolId,
          matchCount,
          rawMult,
        );
        ladder.set(matchCount, mult);
      }

      knownSymbolIds.add(entry.symbolId);
      bySymbolId.set(entry.symbolId, ladder);
    }

    return Object.freeze({
      bySymbolId,
      knownSymbolIds,
    });
  }

  // Case 3: Plain Record<SymbolId, Record<number, number>>
  const recordSource = source as Readonly<
    Record<SymbolId, Readonly<Record<number, number>>>
  >;
  for (const [symbolId, rawPayouts] of Object.entries(recordSource)) {
    if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
      throw new InvalidPaytableError(
        "Paytable map contains an empty symbolId key.",
        { symbolId },
      );
    }
    if (
      !rawPayouts ||
      typeof rawPayouts !== "object" ||
      Array.isArray(rawPayouts)
    ) {
      throw new InvalidPaytableError(
        `Paytable map entry for symbol "${symbolId}" must be a matchCount -> multiplier object.`,
        { symbolId, rawPayouts },
      );
    }

    const ladder = new Map<number, number>();
    for (const [rawMatch, rawMult] of Object.entries(rawPayouts)) {
      const matchCount = validateMatchCountKey(symbolId, rawMatch);
      const mult = validateMultiplierValue(symbolId, matchCount, rawMult);
      ladder.set(matchCount, mult);
    }

    knownSymbolIds.add(symbolId);
    bySymbolId.set(symbolId, ladder);
  }

  return Object.freeze({
    bySymbolId,
    knownSymbolIds,
  });
}

/**
 * Validates and extracts the numeric `bet` from a `PayoutContext` or number.
 */
export function validateBetContext(context: PayoutContext | number): number {
  let rawBet: unknown;
  if (typeof context === "number") {
    rawBet = context;
  } else if (context && typeof context === "object" && "bet" in context) {
    rawBet = context.bet;
  } else {
    throw new InvalidBetError(
      "Payout calculation requires a valid PayoutContext ({ bet }) or numeric bet value.",
      { context },
    );
  }

  if (typeof rawBet !== "number" || !Number.isFinite(rawBet) || rawBet < 0) {
    throw new InvalidBetError(
      `Invalid bet value (${String(rawBet)}); expected a finite number >= 0.`,
      { bet: rawBet },
    );
  }

  return rawBet === 0 ? 0 : rawBet;
}

function validatePaylineMatchInput(match: PaylineMatch, index?: number): void {
  if (!match || typeof match !== "object") {
    throw new InvalidPaytableError(
      `PaylineMatch${index !== undefined ? ` at index ${index}` : ""} must be a valid object.`,
      { index, match },
    );
  }
  if (
    typeof match.paylineId !== "string" ||
    match.paylineId.trim().length === 0
  ) {
    throw new InvalidPaytableError(
      `PaylineMatch${index !== undefined ? ` at index ${index}` : ""} is missing a valid paylineId.`,
      { index, paylineId: match.paylineId },
    );
  }
  if (
    typeof match.symbolId !== "string" ||
    match.symbolId.trim().length === 0
  ) {
    throw new UnknownPaytableSymbolError(
      `PaylineMatch on line "${match.paylineId}" has a missing or empty symbolId.`,
      { paylineId: match.paylineId, symbolId: match.symbolId },
    );
  }
  if (
    typeof match.matchCount !== "number" ||
    !Number.isInteger(match.matchCount) ||
    match.matchCount < 1
  ) {
    throw new InvalidMatchCountError(
      `PaylineMatch on line "${match.paylineId}" has an invalid matchCount (${String(match.matchCount)}); expected an integer >= 1.`,
      {
        paylineId: match.paylineId,
        symbolId: match.symbolId,
        matchCount: match.matchCount,
      },
    );
  }
}

function extractMatchesArray(
  matchesOrResult: readonly PaylineMatch[] | PaylineEvaluationResult,
): readonly PaylineMatch[] {
  if (Array.isArray(matchesOrResult)) {
    return matchesOrResult;
  }
  if (
    matchesOrResult &&
    typeof matchesOrResult === "object" &&
    "matches" in matchesOrResult &&
    Array.isArray((matchesOrResult as PaylineEvaluationResult).matches)
  ) {
    return (matchesOrResult as PaylineEvaluationResult).matches;
  }
  throw new InvalidPaytableError(
    "Expected an array of PaylineMatch items or a PaylineEvaluationResult.",
    { matchesOrResult },
  );
}

/* -------------------------------------------------------------------------- */
/* 4. CORE PAYTABLE ENGINE IMPLEMENTATION                                     */
/* -------------------------------------------------------------------------- */

export class DeterministicPaytableEngine implements PaytableEngine {
  private readonly lookup: NormalizedPaytableLookup;
  private readonly defaultOptions: PaytableEngineOptions;

  constructor(source: PaytableSource, defaultOptions: PaytableEngineOptions = {}) {
    this.lookup = normalizePaytableLookup(source);
    this.defaultOptions = Object.freeze({ ...defaultOptions });
  }

  public hasSymbol(symbolId: SymbolId): boolean {
    if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
      return false;
    }
    return this.lookup.knownSymbolIds.has(symbolId);
  }

  public getMultiplier(symbolId: SymbolId, matchCount: number): number {
    if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
      throw new UnknownPaytableSymbolError(
        "Paytable lookup requires a non-empty symbolId.",
        { symbolId, matchCount },
      );
    }

    if (
      typeof matchCount !== "number" ||
      !Number.isInteger(matchCount) ||
      matchCount < 1
    ) {
      throw new InvalidMatchCountError(
        `Paytable lookup for symbol "${symbolId}" requires a positive integer matchCount; received ${String(matchCount)}.`,
        { symbolId, matchCount },
      );
    }

    if (!this.lookup.knownSymbolIds.has(symbolId)) {
      if (this.defaultOptions.allowUnknownSymbolsAsNonPaying) {
        return 0;
      }
      throw new UnknownPaytableSymbolError(
        `Symbol "${symbolId}" does not exist in the configured paytable.`,
        { symbolId, matchCount },
      );
    }

    const ladder = this.lookup.bySymbolId.get(symbolId);
    if (!ladder) {
      return 0;
    }

    // Missing match count tier resolves to 0 (non-paying combination).
    const configuredMultiplier = ladder.get(matchCount);
    if (configuredMultiplier === undefined) {
      return 0;
    }

    return configuredMultiplier;
  }

  public getPayoutMultiplier(symbolId: SymbolId, matchCount: number): number {
    return this.getMultiplier(symbolId, matchCount);
  }

  public evaluateMatch(
    match: PaylineMatch,
    context: PayoutContext | number,
  ): PaylinePayout {
    validatePaylineMatchInput(match);
    const bet = validateBetContext(context);
    const multiplier = this.getMultiplier(match.symbolId, match.matchCount);
    const payout =
      multiplier === 0 || bet === 0 ? 0 : roundCurrency(multiplier * bet);

    const frozenReels = Array.isArray(match.reelIndexes)
      ? Object.freeze([...match.reelIndexes])
      : Object.freeze([]);
    const frozenPositions: PaylineCellPosition[] = Array.isArray(
      match.cellPositions,
    )
      ? match.cellPositions.map((cp) =>
          Object.freeze({
            reelIndex: cp.reelIndex,
            rowIndex: cp.rowIndex,
            symbolId: cp.symbolId,
            ...(cp.stopIndex !== undefined ? { stopIndex: cp.stopIndex } : {}),
          }),
        )
      : [];

    return Object.freeze({
      paylineId: match.paylineId,
      paylineIndex:
        typeof match.paylineIndex === "number" ? match.paylineIndex : 0,
      symbolId: match.symbolId,
      matchCount: match.matchCount,
      multiplier,
      payoutMultiplier: multiplier,
      bet,
      payout,
      isPaying: multiplier > 0,
      reelIndexes: frozenReels,
      cellPositions: Object.freeze(frozenPositions),
    });
  }

  public evaluate(
    matchesOrResult: readonly PaylineMatch[] | PaylineEvaluationResult,
    context: PayoutContext | number,
    options?: PaytableEngineOptions,
  ): PaytableEvaluationResult {
    const matches = extractMatchesArray(matchesOrResult);
    const bet = validateBetContext(context);
    const includeNonPaying =
      options?.includeNonPaying ?? this.defaultOptions.includeNonPaying ?? false;
    const allowUnknown =
      options?.allowUnknownSymbolsAsNonPaying ??
      this.defaultOptions.allowUnknownSymbolsAsNonPaying ??
      false;

    const allPayouts: PaylinePayout[] = [];
    const payingPayouts: PaylinePayout[] = [];
    let rawTotalPayout = 0;
    let rawTotalMultiplier = 0;
    let payingLineCount = 0;
    let nonPayingLineCount = 0;

    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      validatePaylineMatchInput(match, i);

      let multiplier: number;
      if (allowUnknown && !this.lookup.knownSymbolIds.has(match.symbolId)) {
        multiplier = 0;
      } else {
        multiplier = this.getMultiplier(match.symbolId, match.matchCount);
      }

      const payout =
        multiplier === 0 || bet === 0 ? 0 : roundCurrency(multiplier * bet);
      const isPaying = multiplier > 0;

      const frozenReels = Array.isArray(match.reelIndexes)
        ? Object.freeze([...match.reelIndexes])
        : Object.freeze([]);
      const frozenPositions: PaylineCellPosition[] = Array.isArray(
        match.cellPositions,
      )
        ? match.cellPositions.map((cp) =>
            Object.freeze({
              reelIndex: cp.reelIndex,
              rowIndex: cp.rowIndex,
              symbolId: cp.symbolId,
              ...(cp.stopIndex !== undefined
                ? { stopIndex: cp.stopIndex }
                : {}),
            }),
          )
        : [];

      const linePayout: PaylinePayout = Object.freeze({
        paylineId: match.paylineId,
        paylineIndex:
          typeof match.paylineIndex === "number" ? match.paylineIndex : i + 1,
        symbolId: match.symbolId,
        matchCount: match.matchCount,
        multiplier,
        payoutMultiplier: multiplier,
        bet,
        payout,
        isPaying,
        reelIndexes: frozenReels,
        cellPositions: Object.freeze(frozenPositions),
      });

      allPayouts.push(linePayout);
      rawTotalMultiplier = roundCurrency(rawTotalMultiplier + multiplier);
      rawTotalPayout = roundCurrency(rawTotalPayout + payout);

      if (isPaying) {
        payingLineCount += 1;
        payingPayouts.push(linePayout);
      } else {
        nonPayingLineCount += 1;
      }
    }

    const frozenAll = Object.freeze(allPayouts);
    const frozenPaying = Object.freeze(payingPayouts);

    return Object.freeze({
      payouts: includeNonPaying ? frozenAll : frozenPaying,
      allPayouts: frozenAll,
      totalPayout: rawTotalPayout,
      totalMultiplier: rawTotalMultiplier,
      payingLineCount,
      nonPayingLineCount,
      evaluatedMatchCount: matches.length,
    });
  }
}

export function createPaytableEngine(
  source: PaytableSource,
  options?: PaytableEngineOptions,
): PaytableEngine {
  return new DeterministicPaytableEngine(source, options);
}

/**
 * Convenience helper to look up a single payout multiplier from any `PaytableSource`.
 */
export function getPayoutMultiplier(
  source: PaytableSource,
  symbolId: SymbolId,
  matchCount: number,
  options?: PaytableEngineOptions,
): number {
  return createPaytableEngine(source, options).getMultiplier(
    symbolId,
    matchCount,
  );
}

/**
 * Convenience helper to evaluate `PaylineMatch[]` (or `PaylineEvaluationResult`)
 * against any `PaytableSource` and `PayoutContext`.
 */
export function evaluatePaytable(
  source: PaytableSource,
  matchesOrResult: readonly PaylineMatch[] | PaylineEvaluationResult,
  context: PayoutContext | number,
  options?: PaytableEngineOptions,
): PaytableEvaluationResult {
  return createPaytableEngine(source, options).evaluate(
    matchesOrResult,
    context,
    options,
  );
}

/* -------------------------------------------------------------------------- */
/* 5. SERIALIZATION & DESERIALIZATION                                         */
/* -------------------------------------------------------------------------- */

export function serializePaytableEvaluationResult(
  result: PaytableEvaluationResult,
): string {
  return JSON.stringify(result);
}

export function deserializePaytableEvaluationResult(
  json: string,
): PaytableEvaluationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new InvalidPaytableError(
      `Failed to parse PaytableEvaluationResult JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidPaytableError(
      "Deserialized PaytableEvaluationResult must be a non-null object.",
    );
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    !Array.isArray(candidate.payouts) ||
    typeof candidate.totalPayout !== "number" ||
    !Number.isFinite(candidate.totalPayout)
  ) {
    throw new InvalidPaytableError(
      "Deserialized PaytableEvaluationResult is missing valid payouts or totalPayout.",
    );
  }

  const freezeLinePayout = (
    raw: unknown,
    idx: number,
  ): PaylinePayout => {
    if (!raw || typeof raw !== "object") {
      throw new InvalidPaytableError(
        `Invalid PaylinePayout at index ${idx} in serialized result.`,
      );
    }
    const p = raw as Record<string, unknown>;
    if (
      typeof p.paylineId !== "string" ||
      typeof p.symbolId !== "string" ||
      typeof p.matchCount !== "number" ||
      typeof p.multiplier !== "number" ||
      typeof p.bet !== "number" ||
      typeof p.payout !== "number"
    ) {
      throw new InvalidPaytableError(
        `Malformed PaylinePayout fields at index ${idx} in serialized result.`,
      );
    }

    const frozenReels = Array.isArray(p.reelIndexes)
      ? Object.freeze((p.reelIndexes as number[]).map((r) => Number(r)))
      : Object.freeze([]);
    const frozenPositions: PaylineCellPosition[] = Array.isArray(
      p.cellPositions,
    )
      ? (p.cellPositions as Array<Record<string, unknown>>).map((cp) =>
          Object.freeze({
            reelIndex: Number(cp.reelIndex),
            rowIndex: Number(cp.rowIndex),
            symbolId: String(cp.symbolId),
            ...(typeof cp.stopIndex === "number"
              ? { stopIndex: cp.stopIndex }
              : {}),
          }),
        )
      : [];

    return Object.freeze({
      paylineId: p.paylineId,
      paylineIndex:
        typeof p.paylineIndex === "number" ? p.paylineIndex : idx + 1,
      symbolId: p.symbolId,
      matchCount: p.matchCount,
      multiplier: p.multiplier,
      payoutMultiplier:
        typeof p.payoutMultiplier === "number"
          ? p.payoutMultiplier
          : p.multiplier,
      bet: p.bet,
      payout: p.payout,
      isPaying:
        typeof p.isPaying === "boolean" ? p.isPaying : p.multiplier > 0,
      reelIndexes: frozenReels,
      cellPositions: Object.freeze(frozenPositions),
    });
  };

  const frozenPayouts = Object.freeze(
    candidate.payouts.map((raw, idx) => freezeLinePayout(raw, idx)),
  );
  const frozenAllPayouts = Array.isArray(candidate.allPayouts)
    ? Object.freeze(
        candidate.allPayouts.map((raw, idx) => freezeLinePayout(raw, idx)),
      )
    : frozenPayouts;

  const payingLineCount =
    typeof candidate.payingLineCount === "number"
      ? candidate.payingLineCount
      : frozenAllPayouts.filter((p) => p.isPaying).length;
  const nonPayingLineCount =
    typeof candidate.nonPayingLineCount === "number"
      ? candidate.nonPayingLineCount
      : frozenAllPayouts.filter((p) => !p.isPaying).length;
  const evaluatedMatchCount =
    typeof candidate.evaluatedMatchCount === "number"
      ? candidate.evaluatedMatchCount
      : frozenAllPayouts.length;
  const totalMultiplier =
    typeof candidate.totalMultiplier === "number"
      ? candidate.totalMultiplier
      : roundCurrency(
          frozenAllPayouts.reduce((sum, item) => sum + item.multiplier, 0),
        );

  return Object.freeze({
    payouts: frozenPayouts,
    allPayouts: frozenAllPayouts,
    totalPayout: candidate.totalPayout,
    totalMultiplier,
    payingLineCount,
    nonPayingLineCount,
    evaluatedMatchCount,
  });
}
