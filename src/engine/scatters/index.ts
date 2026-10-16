/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B08 — SCATTER ENGINE
 *
 * Implements deterministic, board-wide, count-based Scatter evaluation and
 * trigger eligibility reporting without mutating the authoritative B04 Board,
 * inspecting B05 paylines, performing B07 Wild substitution, consuming B03 RNG,
 * or executing B12 features.
 *
 * STRICT ARCHITECTURAL BOUNDARY (B08):
 * - Consumes authoritative B04 Board + B02/B01 ScatterConfiguration / GameConfig
 * - Counts configured Scatter symbols across the entire board (position-independent)
 * - Evaluates count-based payout ladders (reusing B06 Paytable lookup & currency rounding)
 * - Applies configurable minimum paying count (`minimumCount`)
 * - Applies explicit over-cap policy (`"highestTier"` default or `"exactOnly"`)
 * - Reports feature trigger eligibility (`triggerEligible`, `triggerFeatureId`) separately from payout eligibility
 * - Evaluates multiple Scatter symbol types independently (unless explicitly grouped by family/group config)
 * - NEVER counts Wild symbols as Scatters unless explicitly configured as Scatter
 * - NEVER inspects B05 PaylineMatch, Ways, Cluster, or Pay-Anywhere results
 * - NEVER starts or executes Free Spins or any other feature (reserved for B12)
 * - NEVER consumes RNG or calls Math.random()
 * - NEVER mutates Board, GameConfig, or ScatterConfiguration inputs
 */

import type { Board, Position } from "../board";
import type { GameConfig, SymbolId } from "../config";
import { isGameConfig } from "../config";
import {
  InvalidBetError,
  InvalidBoardError,
  InvalidScatterConfigurationError,
  InvalidScatterPayoutError,
  InvalidScatterThresholdError,
  SlotEngineError,
  UnknownScatterSymbolError,
} from "../errors";
import {
  normalizePaytableLookup,
  roundCurrency,
  type NormalizedPaytableLookup,
  type PaytableEvaluationResult,
  type PaytableEngine,
  type PaytableSource,
  type PayoutContext,
} from "../paytable";
import type {
  GameDefinition,
  ScatterConfiguration,
  ScatterOverCapPolicy,
  ScatterRule,
  SymbolFamilyDefinition,
} from "../schema";

/* -------------------------------------------------------------------------- */
/* 1. SCATTER CONFIGURATION & INPUT CONTRACTS                                 */
/* -------------------------------------------------------------------------- */

export type { PayoutContext, ScatterOverCapPolicy };

/**
 * Input rule accepted by B08. Compatible with canonical B02 `ScatterRule`
 * plus ergonomic aliases for standalone or test configurations.
 */
export interface ScatterRuleInput {
  readonly scatterSymbolId: SymbolId;
  readonly evaluatesAnywhere?: boolean;
  readonly independentOfPaylines?: boolean;
  readonly payoutReferenceSymbolId?: SymbolId | null;
  readonly triggerFeatureId?: string | null;
  readonly triggersFeature?: boolean;
  readonly minimumTriggerCount?: number;
  readonly minimumCount?: number;
  readonly payouts?: Readonly<Record<number, number>>;
  readonly familyId?: string | null;
  readonly groupSymbolIds?: readonly SymbolId[];
  readonly overCapPolicy?: ScatterOverCapPolicy;
}

/**
 * Flexible Scatter configuration object accepted by `createScatterEngine` /
 * `DeterministicScatterEngine` and `evaluateScatters`.
 */
export interface ScatterEngineConfigObject {
  readonly enabled?: boolean;
  readonly symbolIds?: readonly SymbolId[];
  readonly rules?: readonly (ScatterRule | ScatterRuleInput)[];
  /**
   * Optional shorthand payout map when configuring a single or multi-symbol
   * scatter ladder directly (`{ [symbolId]: { [count]: multiplier } }` or `{ [count]: multiplier }`).
   */
  readonly payouts?:
    | Readonly<Record<number, number>>
    | Readonly<Record<SymbolId, Readonly<Record<number, number>>>>;
  /**
   * Optional B06 PaytableSource or PaytableEngine for resolving Scatter payout multipliers.
   */
  readonly paytable?: PaytableSource | PaytableEngine;
  /**
   * Default minimum paying Scatter count across rules when not set on individual rules.
   */
  readonly minimumCount?: number;
  /**
   * Default minimum feature-trigger Scatter count across rules when not set on individual rules.
   */
  readonly minimumTriggerCount?: number;
  /**
   * Default feature ID triggered when `minimumTriggerCount` is reached.
   */
  readonly triggerFeatureId?: string | null;
  /**
   * Explicit flag enabling feature trigger eligibility even when `triggerFeatureId` is null.
   */
  readonly triggersFeature?: boolean;
  /**
   * Policy when board count exceeds the highest configured payout tier.
   * Defaults to `"highestTier"` (uses highest configured payout tier that applies).
   */
  readonly overCapPolicy?: ScatterOverCapPolicy;
  /**
   * Optional set/list of known symbol IDs in the game for strict symbol validation.
   */
  readonly knownSymbolIds?: readonly SymbolId[];
  /**
   * Optional symbol family definitions for explicit Scatter family/group counting.
   */
  readonly symbolFamilies?: readonly SymbolFamilyDefinition[];
  /**
   * Whether symbol family mixed counting is enabled (defaults to true when a rule specifies `familyId` or `groupSymbolIds`).
   */
  readonly familyCountingEnabled?: boolean;
}

export type ScatterEngineSource =
  | GameConfig
  | GameDefinition
  | ScatterConfiguration
  | ScatterEngineConfigObject;

/* -------------------------------------------------------------------------- */
/* 2. SCATTER EVALUATION RESULT CONTRACTS                                     */
/* -------------------------------------------------------------------------- */

/**
 * Board coordinate where a configured Scatter symbol landed.
 * Included for frontend presentation and replay diagnostics; position never
 * affects Scatter count or payout calculation.
 */
export interface ScatterCellPosition extends Position {
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly symbolId: SymbolId;
  readonly stopIndex?: number;
}

/**
 * Serializable evaluation result for a single configured Scatter symbol/rule.
 * Matches both `ScatterResult` and `ScatterEvaluation` conceptual contracts.
 */
export interface ScatterResult {
  readonly symbolId: SymbolId;
  readonly countedSymbolIds: readonly SymbolId[];
  readonly count: number;
  readonly minimumCount: number;
  readonly matchedTier: number | null;
  readonly overCapApplied: boolean;
  readonly eligible: boolean;
  readonly payoutMultiplier: number;
  readonly payout: number;
  readonly triggerEligible: boolean;
  readonly minimumTriggerCount: number | null;
  readonly triggerFeatureId: string | null;
  readonly positions: readonly ScatterCellPosition[];
}

export type ScatterEvaluation = ScatterResult;

/**
 * Serializable aggregate result produced by B08 `ScatterEngine.evaluate(...)`.
 */
export interface ScatterEvaluationResult {
  readonly scatters: readonly ScatterResult[];
  readonly bet: number;
  readonly totalScatterMultiplier: number;
  readonly totalScatterPayout: number;
  readonly triggered: boolean;
  readonly triggeredFeatureIds: readonly string[];
}

/**
 * Combined additive payout summary proving that B05/B06 regular line payouts
 * and B08 Scatter payouts remain separate and additive.
 */
export interface CombinedLineAndScatterPayoutResult {
  readonly bet: number;
  readonly linePayoutResult: PaytableEvaluationResult;
  readonly scatterResult: ScatterEvaluationResult;
  readonly totalLinePayout: number;
  readonly totalScatterPayout: number;
  readonly totalAdditivePayout: number;
  readonly totalAdditiveMultiplier: number;
  readonly triggered: boolean;
}

export interface NormalizedScatterRule {
  readonly scatterSymbolId: SymbolId;
  readonly countedSymbolIds: ReadonlySet<SymbolId>;
  readonly countedSymbolIdList: readonly SymbolId[];
  readonly evaluatesAnywhere: boolean;
  readonly independentOfPaylines: boolean;
  readonly payoutReferenceSymbolId: SymbolId;
  readonly minimumCount: number;
  readonly tiers: ReadonlyMap<number, number>;
  readonly sortedTierCounts: readonly number[];
  readonly minConfiguredTier: number | null;
  readonly maxConfiguredTier: number | null;
  readonly overCapPolicy: ScatterOverCapPolicy;
  readonly hasTrigger: boolean;
  readonly minimumTriggerCount: number | null;
  readonly triggerFeatureId: string | null;
}

export interface NormalizedScatterConfig {
  readonly enabled: boolean;
  readonly symbolIds: readonly SymbolId[];
  readonly rules: readonly NormalizedScatterRule[];
  readonly rulesBySymbolId: ReadonlyMap<SymbolId, NormalizedScatterRule>;
}

export interface ScatterEngine {
  readonly config?: NormalizedScatterConfig;
  evaluate(
    board: Board,
    configOrContext?: ScatterEngineSource | PayoutContext,
    maybeContext?: PayoutContext,
  ): ScatterEvaluationResult;
  evaluateSymbol(
    board: Board,
    symbolId: SymbolId,
    configOrContext?: ScatterEngineSource | PayoutContext,
    maybeContext?: PayoutContext,
  ): ScatterResult;
  isScatterSymbol(symbolId: SymbolId, config?: ScatterEngineSource): boolean;
  getNormalizedConfig(config?: ScatterEngineSource): NormalizedScatterConfig;
}

/* -------------------------------------------------------------------------- */
/* 3. VALIDATION & NORMALIZATION                                              */
/* -------------------------------------------------------------------------- */

const VALID_OVER_CAP_POLICIES = new Set<string>(["highestTier", "exactOnly"]);

function isPayoutContext(candidate: unknown): candidate is PayoutContext {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }
  const rec = candidate as Record<string, unknown>;
  return (
    "bet" in rec &&
    !("rules" in rec) &&
    !("symbolIds" in rec) &&
    !("symbolsById" in rec) &&
    !("scatterConfiguration" in rec)
  );
}

function isCanonicalGameDefinition(
  candidate: unknown,
): candidate is GameDefinition {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    "scatterConfiguration" in (candidate as Record<string, unknown>) &&
    "paytableDefinition" in (candidate as Record<string, unknown>) &&
    "canonicalSymbols" in (candidate as Record<string, unknown>)
  );
}

function isPaytableEngineLike(candidate: unknown): candidate is PaytableEngine {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    typeof (candidate as PaytableEngine).getMultiplier === "function"
  );
}

function isNumericTierRecord(
  candidate: unknown,
): candidate is Readonly<Record<number, number>> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }
  const entries = Object.entries(candidate as Record<string, unknown>);
  if (entries.length === 0) return true;
  return entries.every(([, val]) => typeof val === "number");
}

/**
 * Validates that `board` is a well-formed authoritative B04 `Board`.
 * Throws `InvalidBoardError` on any structural corruption.
 */
export function validateBoardForScatters(board: Board): void {
  if (!board || typeof board !== "object") {
    throw new InvalidBoardError(
      "Scatter evaluation requires a valid non-null B04 Board object.",
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
      column.length !== expectedRows
    ) {
      throw new InvalidBoardError(
        `Board column at reelIndex ${reelIndex} must contain ${expectedRows} cells, received ${Array.isArray(column) ? column.length : "non-array"}.`,
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

/**
 * Validates `PayoutContext` (`{ bet }`), ensuring `bet` is a finite non-negative number.
 * Defaults to `bet = 1` when `context` is undefined.
 */
export function validateScatterPayoutContext(context?: PayoutContext): number {
  if (context === undefined) {
    return 1;
  }
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new InvalidBetError(
      "PayoutContext must be a valid object containing a numeric bet.",
      { context: String(context) },
    );
  }
  const { bet } = context;
  if (typeof bet !== "number" || !Number.isFinite(bet) || bet < 0) {
    throw new InvalidBetError(
      `Scatter payout requires a finite non-negative bet, received ${String(bet)}.`,
      { bet },
    );
  }
  return bet === 0 ? 0 : bet;
}

function validateAndFreezeTiers(
  rawPayouts: Readonly<Record<number, number>> | ReadonlyMap<number, number> | undefined,
  symbolId: SymbolId,
): {
  tiers: ReadonlyMap<number, number>;
  sortedTierCounts: readonly number[];
  minConfiguredTier: number | null;
  maxConfiguredTier: number | null;
} {
  const tierMap = new Map<number, number>();

  if (rawPayouts instanceof Map) {
    for (const [rawCount, rawMult] of rawPayouts.entries()) {
      const count = Number(rawCount);
      if (!Number.isInteger(count) || count < 1) {
        throw new InvalidScatterThresholdError(
          `Scatter symbol "${symbolId}" has invalid payout tier count "${String(rawCount)}"; count must be a positive integer >= 1.`,
          { symbolId, count: rawCount },
        );
      }
      if (typeof rawMult !== "number" || !Number.isFinite(rawMult) || rawMult < 0) {
        throw new InvalidScatterPayoutError(
          `Scatter symbol "${symbolId}" at count ${count} has invalid payout multiplier "${String(rawMult)}"; multiplier must be a finite number >= 0.`,
          { symbolId, count, multiplier: rawMult },
        );
      }
      tierMap.set(count, rawMult === 0 ? 0 : rawMult);
    }
  } else if (rawPayouts !== undefined) {
    if (!rawPayouts || typeof rawPayouts !== "object" || Array.isArray(rawPayouts)) {
      throw new InvalidScatterPayoutError(
        `Scatter symbol "${symbolId}" payouts must be a map of count -> multiplier.`,
        { symbolId },
      );
    }
    for (const [rawKey, rawMult] of Object.entries(rawPayouts)) {
      const count = Number(rawKey);
      if (!Number.isInteger(count) || count < 1) {
        throw new InvalidScatterThresholdError(
          `Scatter symbol "${symbolId}" has invalid payout tier count "${rawKey}"; count must be a positive integer >= 1.`,
          { symbolId, count: rawKey },
        );
      }
      if (typeof rawMult !== "number" || !Number.isFinite(rawMult) || rawMult < 0) {
        throw new InvalidScatterPayoutError(
          `Scatter symbol "${symbolId}" at count ${count} has invalid payout multiplier "${String(rawMult)}"; multiplier must be a finite number >= 0.`,
          { symbolId, count, multiplier: rawMult },
        );
      }
      tierMap.set(count, rawMult === 0 ? 0 : rawMult);
    }
  }

  const sortedTierCounts = Array.from(tierMap.keys()).sort((a, b) => a - b);
  return {
    tiers: tierMap,
    sortedTierCounts: Object.freeze(sortedTierCounts),
    minConfiguredTier:
      sortedTierCounts.length > 0 ? sortedTierCounts[0] : null,
    maxConfiguredTier:
      sortedTierCounts.length > 0
        ? sortedTierCounts[sortedTierCounts.length - 1]
        : null,
  };
}

/**
 * Normalizes any supported `ScatterEngineSource` into an immutable, validated
 * `NormalizedScatterConfig` with O(1) payout tier maps.
 */
export function normalizeScatterConfiguration(
  source: ScatterEngineSource,
): NormalizedScatterConfig {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new InvalidScatterConfigurationError(
      "ScatterConfiguration must be a non-null object.",
      { source: String(source) },
    );
  }

  let knownSymbols: ReadonlySet<SymbolId> | null = null;
  let paytableLookup: NormalizedPaytableLookup | null = null;
  let symbolPayoutFallback = new Map<SymbolId, Readonly<Record<number, number>>>();
  let familiesById = new Map<string, readonly SymbolId[]>();
  let familyCountingAllowed = new Map<string, boolean>();
  let defaultOverCapPolicy: ScatterOverCapPolicy = "highestTier";
  let defaultMinCount: number | undefined;
  let defaultMinTriggerCount: number | undefined;
  let defaultTriggerFeatureId: string | null | undefined;
  let defaultTriggersFeature: boolean | undefined;
  let enabled = true;
  let rawSymbolIds: readonly SymbolId[] = [];
  let rawRules: readonly (ScatterRule | ScatterRuleInput)[] = [];
  let shorthandPayoutsBySymbol = new Map<SymbolId, Readonly<Record<number, number>>>();
  let sharedShorthandPayouts: Readonly<Record<number, number>> | undefined;

  if (isGameConfig(source as GameConfig)) {
    // 1. Normalized GameConfig from B01/B02
    const gameCfg = source as GameConfig;
    const known = new Set<SymbolId>(gameCfg.symbolsById.keys());
    if (gameCfg.variantsById) {
      for (const vId of gameCfg.variantsById.keys()) {
        known.add(vId);
      }
    }
    knownSymbols = known;
    paytableLookup = normalizePaytableLookup(gameCfg);

    for (const sym of gameCfg.symbols) {
      symbolPayoutFallback.set(sym.id, sym.payoutsByCount);
    }

    if (gameCfg.symbolFamiliesById) {
      for (const [fId, members] of gameCfg.symbolFamiliesById.entries()) {
        familiesById.set(fId, members);
        familyCountingAllowed.set(fId, true);
      }
    }

    const sc = gameCfg.scatterConfiguration;
    if (sc) {
      enabled = Boolean(sc.enabled);
      rawSymbolIds = sc.symbolIds ?? [];
      rawRules = sc.rules ?? [];
      if (sc.overCapPolicy !== undefined) {
        defaultOverCapPolicy = sc.overCapPolicy;
      }
    } else {
      enabled = gameCfg.scatterSymbolIds.size > 0;
      rawSymbolIds = Array.from(gameCfg.scatterSymbolIds);
      const freeSpinFeature = gameCfg.features.find(
        (f) => f.kind === "free_spins" && f.enabled,
      );
      rawRules = Array.from(gameCfg.scatterSymbolIds).map((sId) => {
        const symDef = gameCfg.symbolsById.get(sId);
        return {
          scatterSymbolId: sId,
          evaluatesAnywhere: true,
          independentOfPaylines: true,
          payoutReferenceSymbolId: sId,
          triggerFeatureId: freeSpinFeature?.id ?? null,
          minimumTriggerCount: symDef?.role.scatterTriggerCount ?? 3,
          payouts: symDef?.payoutsByCount,
        };
      });
    }
  } else if (isCanonicalGameDefinition(source)) {
    // 2. CanonicalGameDefinition from B02
    const known = new Set<SymbolId>();
    for (const sym of source.canonicalSymbols) {
      known.add(sym.id);
      const numericPayouts: Record<number, number> = {};
      for (const [k, v] of Object.entries(sym.payouts ?? {})) {
        const count = Number(k);
        if (Number.isInteger(count) && count > 0 && typeof v === "number") {
          numericPayouts[count] = v;
        }
      }
      symbolPayoutFallback.set(sym.id, numericPayouts);
      for (const v of sym.variants ?? []) {
        known.add(v.id);
      }
    }
    knownSymbols = known;
    paytableLookup = normalizePaytableLookup(source.paytableDefinition);

    for (const fam of source.symbolFamilies ?? []) {
      familiesById.set(fam.id, fam.memberIds);
      familyCountingAllowed.set(
        fam.id,
        Boolean(fam.allowMixedCounting && source.winEvaluation?.familyCountingEnabled !== false),
      );
    }

    const sc = source.scatterConfiguration;
    enabled = Boolean(sc.enabled);
    rawSymbolIds = sc.symbolIds ?? [];
    rawRules = sc.rules ?? [];
    if (sc.overCapPolicy !== undefined) {
      defaultOverCapPolicy = sc.overCapPolicy;
    }
  } else {
    // 3. ScatterConfiguration or ScatterEngineConfigObject
    const cfg = source as ScatterEngineConfigObject;
    enabled = cfg.enabled !== undefined ? Boolean(cfg.enabled) : true;

    if (cfg.knownSymbolIds !== undefined) {
      if (!Array.isArray(cfg.knownSymbolIds)) {
        throw new InvalidScatterConfigurationError(
          "knownSymbolIds must be an array of symbol IDs when provided.",
        );
      }
      knownSymbols = new Set(cfg.knownSymbolIds);
    }

    if (cfg.symbolFamilies !== undefined) {
      if (!Array.isArray(cfg.symbolFamilies)) {
        throw new InvalidScatterConfigurationError(
          "symbolFamilies must be an array of SymbolFamilyDefinition objects.",
        );
      }
      for (const fam of cfg.symbolFamilies) {
        familiesById.set(fam.id, fam.memberIds);
        familyCountingAllowed.set(
          fam.id,
          Boolean(
            fam.allowMixedCounting && cfg.familyCountingEnabled !== false,
          ),
        );
      }
    }

    if (cfg.paytable !== undefined) {
      if (!isPaytableEngineLike(cfg.paytable)) {
        try {
          paytableLookup = normalizePaytableLookup(cfg.paytable);
        } catch (err) {
          if (err instanceof SlotEngineError) {
            throw new InvalidScatterPayoutError(err.message, {
              ...err.context,
              originalCode: err.code,
            });
          }
          throw err;
        }
      }
    }

    if (cfg.payouts !== undefined) {
      if (!cfg.payouts || typeof cfg.payouts !== "object" || Array.isArray(cfg.payouts)) {
        throw new InvalidScatterPayoutError(
          "ScatterConfiguration payouts must be a valid tier map or symbol -> tier map.",
        );
      }
      if (isNumericTierRecord(cfg.payouts)) {
        sharedShorthandPayouts = cfg.payouts;
      } else {
        for (const [symId, symTiers] of Object.entries(
          cfg.payouts as Record<string, Readonly<Record<number, number>>>,
        )) {
          shorthandPayoutsBySymbol.set(symId, symTiers);
        }
      }
    }

    if (cfg.overCapPolicy !== undefined) {
      defaultOverCapPolicy = cfg.overCapPolicy;
    }
    defaultMinCount = cfg.minimumCount;
    defaultMinTriggerCount = cfg.minimumTriggerCount;
    defaultTriggerFeatureId = cfg.triggerFeatureId;
    defaultTriggersFeature = cfg.triggersFeature;

    if (cfg.symbolIds !== undefined) {
      if (!Array.isArray(cfg.symbolIds)) {
        throw new InvalidScatterConfigurationError(
          "ScatterConfiguration symbolIds must be an array of symbol IDs.",
        );
      }
      rawSymbolIds = cfg.symbolIds;
    }

    if (cfg.rules !== undefined) {
      if (!Array.isArray(cfg.rules)) {
        throw new InvalidScatterConfigurationError(
          "ScatterConfiguration rules must be an array of ScatterRule objects.",
        );
      }
      rawRules = cfg.rules;
    } else if (rawSymbolIds.length > 0) {
      // Synthesize rules from symbolIds + shorthand payouts/thresholds
      rawRules = rawSymbolIds.map((symId) => ({
        scatterSymbolId: symId,
        evaluatesAnywhere: true,
        independentOfPaylines: true,
        payoutReferenceSymbolId: symId,
        triggerFeatureId: defaultTriggerFeatureId ?? null,
        triggersFeature: defaultTriggersFeature,
        minimumTriggerCount: defaultMinTriggerCount ?? 3,
        minimumCount: defaultMinCount,
        payouts:
          shorthandPayoutsBySymbol.get(symId) ?? sharedShorthandPayouts,
        overCapPolicy: defaultOverCapPolicy,
      }));
    } else if (shorthandPayoutsBySymbol.size > 0) {
      rawSymbolIds = Array.from(shorthandPayoutsBySymbol.keys());
      rawRules = rawSymbolIds.map((symId) => ({
        scatterSymbolId: symId,
        evaluatesAnywhere: true,
        independentOfPaylines: true,
        payoutReferenceSymbolId: symId,
        triggerFeatureId: defaultTriggerFeatureId ?? null,
        triggersFeature: defaultTriggersFeature,
        minimumTriggerCount: defaultMinTriggerCount ?? 3,
        minimumCount: defaultMinCount,
        payouts: shorthandPayoutsBySymbol.get(symId),
        overCapPolicy: defaultOverCapPolicy,
      }));
    } else if (cfg.rules === undefined && cfg.symbolIds === undefined) {
      throw new InvalidScatterConfigurationError(
        "ScatterConfiguration must specify rules or symbolIds.",
      );
    }
  }

  if (!VALID_OVER_CAP_POLICIES.has(defaultOverCapPolicy)) {
    throw new InvalidScatterConfigurationError(
      `Unsupported overCapPolicy "${String(defaultOverCapPolicy)}"; expected "highestTier" or "exactOnly".`,
      { overCapPolicy: defaultOverCapPolicy },
    );
  }

  if (
    defaultMinCount !== undefined &&
    (!Number.isInteger(defaultMinCount) || defaultMinCount < 1)
  ) {
    throw new InvalidScatterThresholdError(
      `Scatter minimumCount must be a positive integer >= 1, received ${String(defaultMinCount)}.`,
      { minimumCount: defaultMinCount },
    );
  }

  if (
    defaultMinTriggerCount !== undefined &&
    (!Number.isInteger(defaultMinTriggerCount) || defaultMinTriggerCount < 1)
  ) {
    throw new InvalidScatterThresholdError(
      `Scatter minimumTriggerCount must be a positive integer >= 1, received ${String(defaultMinTriggerCount)}.`,
      { minimumTriggerCount: defaultMinTriggerCount },
    );
  }

  // Validate symbolIds list
  const normalizedSymbolIds: SymbolId[] = [];
  const seenSymbolIds = new Set<SymbolId>();

  for (let i = 0; i < rawSymbolIds.length; i += 1) {
    const symId = rawSymbolIds[i];
    if (typeof symId !== "string" || symId.trim().length === 0) {
      throw new InvalidScatterConfigurationError(
        `ScatterConfiguration.symbolIds[${i}] must be a non-empty string.`,
        { index: i, symbolId: symId },
      );
    }
    if (knownSymbols && !knownSymbols.has(symId)) {
      throw new UnknownScatterSymbolError(
        `ScatterConfiguration references unknown symbol "${symId}".`,
        { symbolId: symId },
      );
    }
    if (!seenSymbolIds.has(symId)) {
      seenSymbolIds.add(symId);
      normalizedSymbolIds.push(symId);
    }
  }

  const normalizedRules: NormalizedScatterRule[] = [];
  const rulesBySymbolId = new Map<SymbolId, NormalizedScatterRule>();

  for (let rIdx = 0; rIdx < rawRules.length; rIdx += 1) {
    const rule = rawRules[rIdx];
    if (!rule || typeof rule !== "object") {
      throw new InvalidScatterConfigurationError(
        `ScatterRule at index ${rIdx} must be a valid object.`,
        { index: rIdx },
      );
    }

    const scatterSymbolId = rule.scatterSymbolId;
    if (
      typeof scatterSymbolId !== "string" ||
      scatterSymbolId.trim().length === 0
    ) {
      throw new InvalidScatterConfigurationError(
        `ScatterRule at index ${rIdx} must define a non-empty scatterSymbolId.`,
        { index: rIdx, scatterSymbolId },
      );
    }

    if (knownSymbols && !knownSymbols.has(scatterSymbolId)) {
      throw new UnknownScatterSymbolError(
        `ScatterRule references unknown scatterSymbolId "${scatterSymbolId}".`,
        { index: rIdx, symbolId: scatterSymbolId },
      );
    }

    if (rulesBySymbolId.has(scatterSymbolId)) {
      throw new InvalidScatterConfigurationError(
        `Duplicate ScatterRule for scatterSymbolId "${scatterSymbolId}".`,
        { index: rIdx, symbolId: scatterSymbolId },
      );
    }

    const evaluatesAnywhere =
      rule.evaluatesAnywhere !== undefined ? rule.evaluatesAnywhere : true;
    const independentOfPaylines =
      rule.independentOfPaylines !== undefined
        ? rule.independentOfPaylines
        : true;

    if (typeof evaluatesAnywhere !== "boolean" || !evaluatesAnywhere) {
      throw new InvalidScatterConfigurationError(
        `ScatterRule for "${scatterSymbolId}" must have evaluatesAnywhere = true in B08 Scatter Engine.`,
        { symbolId: scatterSymbolId, evaluatesAnywhere },
      );
    }
    if (typeof independentOfPaylines !== "boolean" || !independentOfPaylines) {
      throw new InvalidScatterConfigurationError(
        `ScatterRule for "${scatterSymbolId}" must have independentOfPaylines = true in B08 Scatter Engine.`,
        { symbolId: scatterSymbolId, independentOfPaylines },
      );
    }

    const payoutRefId =
      rule.payoutReferenceSymbolId !== undefined &&
      rule.payoutReferenceSymbolId !== null
        ? rule.payoutReferenceSymbolId
        : scatterSymbolId;

    if (typeof payoutRefId !== "string" || payoutRefId.trim().length === 0) {
      throw new InvalidScatterConfigurationError(
        `ScatterRule for "${scatterSymbolId}" has invalid payoutReferenceSymbolId "${String(payoutRefId)}".`,
        { symbolId: scatterSymbolId, payoutReferenceSymbolId: payoutRefId },
      );
    }

    if (knownSymbols && !knownSymbols.has(payoutRefId)) {
      throw new UnknownScatterSymbolError(
        `ScatterRule for "${scatterSymbolId}" references unknown payoutReferenceSymbolId "${payoutRefId}".`,
        {
          symbolId: scatterSymbolId,
          payoutReferenceSymbolId: payoutRefId,
        },
      );
    }

    const ruleOverCapPolicy = rule.overCapPolicy ?? defaultOverCapPolicy;
    if (!VALID_OVER_CAP_POLICIES.has(ruleOverCapPolicy)) {
      throw new InvalidScatterConfigurationError(
        `ScatterRule for "${scatterSymbolId}" has unsupported overCapPolicy "${String(ruleOverCapPolicy)}".`,
        { symbolId: scatterSymbolId, overCapPolicy: ruleOverCapPolicy },
      );
    }

    // Resolve payout tiers:
    // 1. Explicit rule.payouts
    // 2. Shorthand payouts on config object
    // 3. B06 Paytable lookup for payoutRefId
    // 4. Symbol definition payouts fallback
    const rawTierSource:
      | Readonly<Record<number, number>>
      | ReadonlyMap<number, number>
      | undefined =
      rule.payouts ??
      shorthandPayoutsBySymbol.get(payoutRefId) ??
      shorthandPayoutsBySymbol.get(scatterSymbolId) ??
      sharedShorthandPayouts ??
      paytableLookup?.bySymbolId.get(payoutRefId) ??
      symbolPayoutFallback.get(payoutRefId);

    const { tiers, sortedTierCounts, minConfiguredTier, maxConfiguredTier } =
      validateAndFreezeTiers(rawTierSource, scatterSymbolId);

    // Resolve minimum paying count
    const rawMinCount = rule.minimumCount ?? defaultMinCount;
    if (
      rawMinCount !== undefined &&
      (!Number.isInteger(rawMinCount) || rawMinCount < 1)
    ) {
      throw new InvalidScatterThresholdError(
        `ScatterRule for "${scatterSymbolId}" has invalid minimumCount "${String(rawMinCount)}"; must be a positive integer >= 1.`,
        { symbolId: scatterSymbolId, minimumCount: rawMinCount },
      );
    }
    const minimumCount =
      rawMinCount ?? minConfiguredTier ?? rule.minimumTriggerCount ?? defaultMinTriggerCount ?? 3;
    if (!Number.isInteger(minimumCount) || minimumCount < 1) {
      throw new InvalidScatterThresholdError(
        `ScatterRule for "${scatterSymbolId}" resolved to an invalid minimumCount "${String(minimumCount)}".`,
        { symbolId: scatterSymbolId, minimumCount },
      );
    }

    // Resolve trigger configuration separately from payout qualification
    const triggerFeatureId =
      rule.triggerFeatureId !== undefined
        ? rule.triggerFeatureId
        : (defaultTriggerFeatureId ?? null);
    if (
      triggerFeatureId !== null &&
      (typeof triggerFeatureId !== "string" ||
        triggerFeatureId.trim().length === 0)
    ) {
      throw new InvalidScatterConfigurationError(
        `ScatterRule for "${scatterSymbolId}" has invalid triggerFeatureId "${String(triggerFeatureId)}".`,
        { symbolId: scatterSymbolId, triggerFeatureId },
      );
    }

    const triggersFeature =
      rule.triggersFeature !== undefined
        ? rule.triggersFeature
        : defaultTriggersFeature !== undefined
          ? defaultTriggersFeature
          : Boolean(triggerFeatureId);

    const rawMinTrigger =
      rule.minimumTriggerCount !== undefined
        ? rule.minimumTriggerCount
        : defaultMinTriggerCount;

    if (
      rawMinTrigger !== undefined &&
      (!Number.isInteger(rawMinTrigger) || rawMinTrigger < 1)
    ) {
      throw new InvalidScatterThresholdError(
        `ScatterRule for "${scatterSymbolId}" has invalid minimumTriggerCount "${String(rawMinTrigger)}"; must be a positive integer >= 1.`,
        { symbolId: scatterSymbolId, minimumTriggerCount: rawMinTrigger },
      );
    }

    const hasTrigger = Boolean(triggersFeature);
    const minimumTriggerCount = hasTrigger ? (rawMinTrigger ?? 3) : (rawMinTrigger ?? null);

    // Resolve counted symbol IDs (strictly this symbol unless an explicit family/group is configured)
    const countedSet = new Set<SymbolId>([scatterSymbolId]);
    if (rule.groupSymbolIds !== undefined) {
      if (!Array.isArray(rule.groupSymbolIds)) {
        throw new InvalidScatterConfigurationError(
          `ScatterRule for "${scatterSymbolId}" groupSymbolIds must be an array of symbol IDs.`,
          { symbolId: scatterSymbolId },
        );
      }
      for (const memberId of rule.groupSymbolIds) {
        if (typeof memberId !== "string" || memberId.trim().length === 0) {
          throw new InvalidScatterConfigurationError(
            `ScatterRule for "${scatterSymbolId}" contains an empty groupSymbolId.`,
            { symbolId: scatterSymbolId, memberId },
          );
        }
        if (knownSymbols && !knownSymbols.has(memberId)) {
          throw new UnknownScatterSymbolError(
            `ScatterRule for "${scatterSymbolId}" references unknown groupSymbolId "${memberId}".`,
            { symbolId: scatterSymbolId, memberId },
          );
        }
        countedSet.add(memberId);
      }
    }

    if (rule.familyId !== undefined && rule.familyId !== null) {
      const familyMembers = familiesById.get(rule.familyId);
      if (!familyMembers) {
        throw new InvalidScatterConfigurationError(
          `ScatterRule for "${scatterSymbolId}" references unknown familyId "${rule.familyId}".`,
          { symbolId: scatterSymbolId, familyId: rule.familyId },
        );
      }
      if (familyCountingAllowed.get(rule.familyId) !== false) {
        for (const memberId of familyMembers) {
          countedSet.add(memberId);
        }
      }
    }

    if (!seenSymbolIds.has(scatterSymbolId)) {
      seenSymbolIds.add(scatterSymbolId);
      normalizedSymbolIds.push(scatterSymbolId);
    }

    const normalizedRule: NormalizedScatterRule = Object.freeze({
      scatterSymbolId,
      countedSymbolIds: countedSet,
      countedSymbolIdList: Object.freeze(Array.from(countedSet)),
      evaluatesAnywhere,
      independentOfPaylines,
      payoutReferenceSymbolId: payoutRefId,
      minimumCount,
      tiers,
      sortedTierCounts,
      minConfiguredTier,
      maxConfiguredTier,
      overCapPolicy: ruleOverCapPolicy,
      hasTrigger,
      minimumTriggerCount,
      triggerFeatureId,
    });

    normalizedRules.push(normalizedRule);
    rulesBySymbolId.set(scatterSymbolId, normalizedRule);
  }

  return Object.freeze({
    enabled,
    symbolIds: Object.freeze(normalizedSymbolIds),
    rules: Object.freeze(normalizedRules),
    rulesBySymbolId,
  });
}

/* -------------------------------------------------------------------------- */
/* 4. CORE SCATTER COUNTING & EVALUATION                                      */
/* -------------------------------------------------------------------------- */

function evaluateSingleScatterRule(
  board: Board,
  rule: NormalizedScatterRule,
  bet: number,
  enabled: boolean,
): ScatterResult {
  const positions: ScatterCellPosition[] = [];
  const reelCount =
    typeof board.reelCount === "number" ? board.reelCount : board.columns;

  for (let reelIndex = 0; reelIndex < reelCount; reelIndex += 1) {
    const column = board.cells[reelIndex];
    for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
      const cell = column[rowIndex];
      const cellSymbolId =
        typeof cell.symbolId === "string"
          ? cell.symbolId
          : cell.symbol.symbolId;
      if (rule.countedSymbolIds.has(cellSymbolId)) {
        positions.push(
          Object.freeze({
            reelIndex,
            rowIndex,
            symbolId: cellSymbolId,
            ...(typeof cell.stopIndex === "number"
              ? { stopIndex: cell.stopIndex }
              : {}),
          }),
        );
      }
    }
  }

  const count = positions.length;

  if (!enabled) {
    return Object.freeze({
      symbolId: rule.scatterSymbolId,
      countedSymbolIds: rule.countedSymbolIdList,
      count,
      minimumCount: rule.minimumCount,
      matchedTier: null,
      overCapApplied: false,
      eligible: false,
      payoutMultiplier: 0,
      payout: 0,
      triggerEligible: false,
      minimumTriggerCount: rule.minimumTriggerCount,
      triggerFeatureId: rule.triggerFeatureId,
      positions: Object.freeze(positions),
    });
  }

  // 1. Payout qualification (count-based ladder with minimumCount and over-cap policy)
  let matchedTier: number | null = null;
  let overCapApplied = false;
  let payoutMultiplier = 0;

  if (count >= rule.minimumCount && rule.tiers.size > 0) {
    if (rule.tiers.has(count)) {
      matchedTier = count;
      payoutMultiplier = rule.tiers.get(count) ?? 0;
    } else if (
      rule.maxConfiguredTier !== null &&
      count > rule.maxConfiguredTier &&
      rule.overCapPolicy === "highestTier"
    ) {
      matchedTier = rule.maxConfiguredTier;
      overCapApplied = true;
      payoutMultiplier = rule.tiers.get(rule.maxConfiguredTier) ?? 0;
    }
  }

  const eligible = matchedTier !== null && payoutMultiplier > 0;
  const payout = eligible ? roundCurrency(payoutMultiplier * bet) : 0;

  // 2. Feature trigger eligibility (strictly separate from payout qualification)
  const triggerEligible =
    rule.hasTrigger &&
    rule.minimumTriggerCount !== null &&
    count >= rule.minimumTriggerCount;

  return Object.freeze({
    symbolId: rule.scatterSymbolId,
    countedSymbolIds: rule.countedSymbolIdList,
    count,
    minimumCount: rule.minimumCount,
    matchedTier,
    overCapApplied,
    eligible,
    payoutMultiplier,
    payout,
    triggerEligible,
    minimumTriggerCount: rule.minimumTriggerCount,
    triggerFeatureId: rule.triggerFeatureId,
    positions: Object.freeze(positions),
  });
}

/**
 * Evaluates all configured Scatter symbols across the authoritative B04 `Board`.
 */
export function evaluateScatters(
  board: Board,
  config: ScatterEngineSource | NormalizedScatterConfig,
  context?: PayoutContext,
): ScatterEvaluationResult {
  validateBoardForScatters(board);
  const bet = validateScatterPayoutContext(context);
  const normalized = isNormalizedScatterConfig(config)
    ? config
    : normalizeScatterConfiguration(config);

  const scatters: ScatterResult[] = [];
  const triggeredFeatureIds: string[] = [];
  let totalScatterMultiplier = 0;
  let totalScatterPayout = 0;
  let triggered = false;

  for (const rule of normalized.rules) {
    const res = evaluateSingleScatterRule(
      board,
      rule,
      bet,
      normalized.enabled,
    );
    scatters.push(res);
    totalScatterMultiplier = roundCurrency(
      totalScatterMultiplier + res.payoutMultiplier,
    );
    totalScatterPayout = roundCurrency(totalScatterPayout + res.payout);
    if (res.triggerEligible) {
      triggered = true;
      if (
        res.triggerFeatureId &&
        !triggeredFeatureIds.includes(res.triggerFeatureId)
      ) {
        triggeredFeatureIds.push(res.triggerFeatureId);
      }
    }
  }

  return Object.freeze({
    scatters: Object.freeze(scatters),
    bet,
    totalScatterMultiplier,
    totalScatterPayout,
    triggered,
    triggeredFeatureIds: Object.freeze(triggeredFeatureIds),
  });
}

function isNormalizedScatterConfig(
  candidate: unknown,
): candidate is NormalizedScatterConfig {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    "rulesBySymbolId" in (candidate as Record<string, unknown>) &&
    (candidate as NormalizedScatterConfig).rulesBySymbolId instanceof Map
  );
}

/* -------------------------------------------------------------------------- */
/* 5. DETERMINISTIC SCATTER ENGINE IMPLEMENTATION                             */
/* -------------------------------------------------------------------------- */

export class DeterministicScatterEngine implements ScatterEngine {
  public readonly config?: NormalizedScatterConfig;

  constructor(source?: ScatterEngineSource) {
    if (source !== undefined) {
      this.config = normalizeScatterConfiguration(source);
    }
  }

  public getNormalizedConfig(
    source?: ScatterEngineSource,
  ): NormalizedScatterConfig {
    if (source !== undefined) {
      return normalizeScatterConfiguration(source);
    }
    if (this.config) {
      return this.config;
    }
    throw new InvalidScatterConfigurationError(
      "ScatterEngine requires a ScatterConfiguration either at construction or per evaluate(...) call.",
    );
  }

  public isScatterSymbol(
    symbolId: SymbolId,
    source?: ScatterEngineSource,
  ): boolean {
    const cfg = this.getNormalizedConfig(source);
    return cfg.enabled && cfg.rulesBySymbolId.has(symbolId);
  }

  public evaluate(
    board: Board,
    configOrContext?: ScatterEngineSource | PayoutContext,
    maybeContext?: PayoutContext,
  ): ScatterEvaluationResult {
    if (isPayoutContext(configOrContext)) {
      const cfg = this.getNormalizedConfig();
      return evaluateScatters(board, cfg, configOrContext);
    }
    const cfg = this.getNormalizedConfig(configOrContext);
    return evaluateScatters(board, cfg, maybeContext);
  }

  public evaluateSymbol(
    board: Board,
    symbolId: SymbolId,
    configOrContext?: ScatterEngineSource | PayoutContext,
    maybeContext?: PayoutContext,
  ): ScatterResult {
    validateBoardForScatters(board);
    const context = isPayoutContext(configOrContext)
      ? configOrContext
      : maybeContext;
    const source = isPayoutContext(configOrContext)
      ? undefined
      : configOrContext;
    const bet = validateScatterPayoutContext(context);
    const cfg = this.getNormalizedConfig(source);

    const rule = cfg.rulesBySymbolId.get(symbolId);
    if (!rule) {
      throw new UnknownScatterSymbolError(
        `Symbol "${symbolId}" is not configured as a Scatter symbol.`,
        { symbolId },
      );
    }
    return evaluateSingleScatterRule(board, rule, bet, cfg.enabled);
  }
}

export function createScatterEngine(
  source?: ScatterEngineSource,
): ScatterEngine {
  return new DeterministicScatterEngine(source);
}

/* -------------------------------------------------------------------------- */
/* 6. ADDITIVE LINE + SCATTER PAYOUT COMBINER & SERIALIZATION                 */
/* -------------------------------------------------------------------------- */

/**
 * Combines regular fixed-payline payouts (from B05/B06/B07) with B08 Scatter
 * payouts additively, without replacing one with the other.
 */
export function combineLineAndScatterPayouts(
  linePayoutResult: PaytableEvaluationResult,
  scatterResult: ScatterEvaluationResult,
): CombinedLineAndScatterPayoutResult {
  const totalLinePayout = roundCurrency(linePayoutResult.totalPayout);
  const totalScatterPayout = roundCurrency(scatterResult.totalScatterPayout);
  const totalAdditivePayout = roundCurrency(
    totalLinePayout + totalScatterPayout,
  );
  const totalAdditiveMultiplier = roundCurrency(
    linePayoutResult.totalMultiplier + scatterResult.totalScatterMultiplier,
  );

  return Object.freeze({
    bet: scatterResult.bet,
    linePayoutResult,
    scatterResult,
    totalLinePayout,
    totalScatterPayout,
    totalAdditivePayout,
    totalAdditiveMultiplier,
    triggered: scatterResult.triggered,
  });
}

export function serializeScatterEvaluationResult(
  result: ScatterEvaluationResult,
): string {
  return JSON.stringify(result);
}

export function deserializeScatterEvaluationResult(
  serialized: string,
): ScatterEvaluationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (err) {
    throw new InvalidScatterConfigurationError(
      `Failed to parse serialized ScatterEvaluationResult JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidScatterConfigurationError(
      "Deserialized ScatterEvaluationResult must be a JSON object.",
    );
  }

  const obj = parsed as Record<string, unknown>;
  if (
    !Array.isArray(obj.scatters) ||
    typeof obj.bet !== "number" ||
    !Number.isFinite(obj.bet) ||
    typeof obj.totalScatterPayout !== "number" ||
    !Number.isFinite(obj.totalScatterPayout) ||
    typeof obj.triggered !== "boolean"
  ) {
    throw new InvalidScatterConfigurationError(
      "Deserialized ScatterEvaluationResult is missing required fields (scatters, bet, totalScatterPayout, triggered).",
    );
  }

  const scatters: ScatterResult[] = obj.scatters.map((raw, idx) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new InvalidScatterConfigurationError(
        `Deserialized scatters[${idx}] must be an object.`,
      );
    }
    const item = raw as Record<string, unknown>;
    if (
      typeof item.symbolId !== "string" ||
      typeof item.count !== "number" ||
      typeof item.eligible !== "boolean" ||
      typeof item.payoutMultiplier !== "number" ||
      typeof item.payout !== "number" ||
      typeof item.triggerEligible !== "boolean"
    ) {
      throw new InvalidScatterConfigurationError(
        `Deserialized scatters[${idx}] is missing required ScatterResult fields.`,
      );
    }
    const positions: ScatterCellPosition[] = Array.isArray(item.positions)
      ? item.positions.map((p: Record<string, unknown>) =>
          Object.freeze({
            reelIndex: Number(p.reelIndex),
            rowIndex: Number(p.rowIndex),
            symbolId: String(p.symbolId),
            ...(typeof p.stopIndex === "number"
              ? { stopIndex: p.stopIndex }
              : {}),
          }),
        )
      : [];

    return Object.freeze({
      symbolId: item.symbolId,
      countedSymbolIds: Object.freeze(
        Array.isArray(item.countedSymbolIds)
          ? item.countedSymbolIds.map(String)
          : [item.symbolId],
      ),
      count: item.count,
      minimumCount:
        typeof item.minimumCount === "number" ? item.minimumCount : 1,
      matchedTier:
        typeof item.matchedTier === "number" ? item.matchedTier : null,
      overCapApplied: Boolean(item.overCapApplied),
      eligible: item.eligible,
      payoutMultiplier: item.payoutMultiplier,
      payout: item.payout,
      triggerEligible: item.triggerEligible,
      minimumTriggerCount:
        typeof item.minimumTriggerCount === "number"
          ? item.minimumTriggerCount
          : null,
      triggerFeatureId:
        typeof item.triggerFeatureId === "string"
          ? item.triggerFeatureId
          : null,
      positions: Object.freeze(positions),
    });
  });

  const totalScatterMultiplier =
    typeof obj.totalScatterMultiplier === "number" &&
    Number.isFinite(obj.totalScatterMultiplier)
      ? obj.totalScatterMultiplier
      : roundCurrency(
          scatters.reduce((sum, s) => sum + s.payoutMultiplier, 0),
        );

  const triggeredFeatureIds = Array.isArray(obj.triggeredFeatureIds)
    ? Object.freeze(obj.triggeredFeatureIds.map(String))
    : Object.freeze(
        scatters
          .filter((s) => s.triggerEligible && s.triggerFeatureId)
          .map((s) => s.triggerFeatureId as string),
      );

  return Object.freeze({
    scatters: Object.freeze(scatters),
    bet: obj.bet,
    totalScatterMultiplier,
    totalScatterPayout: obj.totalScatterPayout,
    triggered: obj.triggered,
    triggeredFeatureIds,
  });
}
