/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B07 — WILD ENGINE
 *
 * Implements configurable, deterministic Wild substitution behavior for
 * fixed payline evaluation without mutating the authoritative B04 Board
 * or calculating final B06 cash/credit payouts.
 *
 * STRICT ARCHITECTURAL BOUNDARY (B07):
 * - Wild status and substitution rules come strictly from GameConfig / WildConfiguration
 * - Never hard-codes a symbol ID such as "WILD"
 * - Preserves BOTH actual landed symbols (`actualSymbols`) and effective symbols (`effectiveSymbols`)
 * - Supports allowedSubstitutions ("allRegular" or explicit symbol ID list) and excludedSymbolIds
 * - Supports per-reel activation (`activeReels`), mode activation (`activeModes`), and `paysOnOwn`
 * - Supports All-Wild paylines by resolving to the highest-value eligible symbol in the paytable
 * - Provides a B05-compatible `SymbolMatchPolicy` factory (`createMatchPolicy`)
 * - NEVER mutates Board, GameConfig, or PaylineDefinition inputs
 * - NEVER consumes RNG or calls Math.random()
 * - NEVER calculates bet * multiplier cash/credit payouts (reserved for B06)
 * - NEVER implements Scatter, Ways, Cluster, Pay-Anywhere, or Feature mutations
 */

import type { Board, Cell } from "../board";
import type {
  GameConfig,
  NormalizedPayline,
  PaylineId,
  SymbolId,
} from "../config";
import { isGameConfig } from "../config";
import {
  InvalidPaylineError,
  InvalidPaytableReferenceError,
  InvalidSubstitutionRuleError,
  InvalidWildConfigurationError,
  InvalidWildContextError,
  MissingPaylineError,
  SlotEngineError,
  UnknownWildSymbolError,
} from "../errors";
import {
  validateBoardForPaylines,
  validatePaylineForBoard,
  validatePaylinesForBoard,
  type PaylineCellPosition,
  type PaylineInput,
  type SymbolMatchPolicy,
} from "../paylines";
import {
  normalizePaytableLookup,
  type NormalizedPaytableLookup,
  type PaytableEngine,
  type PaytableSource,
} from "../paytable";
import type {
  PaylineDefinition,
  WildConfiguration,
  WildSubstitutionRule,
} from "../schema";

/* -------------------------------------------------------------------------- */
/* 1. WILD CONFIGURATION & CONTEXT CONTRACTS                                  */
/* -------------------------------------------------------------------------- */

export type WildRoundMode = "base" | "freeSpins" | "bonus";

export type WildWinEvaluationMode =
  | "fixedPaylines"
  | "lines"
  | "ways"
  | "clusters"
  | "payAnywhere"
  | "scatters";

export type WildActiveMode = WildRoundMode | WildWinEvaluationMode;

const VALID_ROUND_MODES = new Set<string>(["base", "freeSpins", "bonus"]);
const VALID_WIN_MODES = new Set<string>([
  "fixedPaylines",
  "lines",
  "ways",
  "clusters",
  "payAnywhere",
  "scatters",
]);

/**
 * Input substitution rule accepted by B07. Compatible with canonical B02
 * `WildSubstitutionRule` as well as ergonomic `allowedSymbols` / `excludedSymbols` aliases.
 */
export interface WildRuleInput {
  readonly wildSymbolId: SymbolId;
  readonly allowedSubstitutions?: "allRegular" | readonly SymbolId[];
  readonly allowedSymbols?: "allRegular" | readonly SymbolId[];
  readonly excludedSymbolIds?: readonly SymbolId[];
  readonly excludedSymbols?: readonly SymbolId[];
  readonly activeReels?: readonly number[];
  readonly activeModes?: readonly WildActiveMode[];
  readonly paysOnOwn?: boolean;
  readonly multiplier?: number;
}

/**
 * Flexible Wild configuration input accepted by `createWildEngine` / `DeterministicWildEngine`.
 * Accepts a full `GameConfig`, a canonical B02 `WildConfiguration`, or an inline rule definition.
 */
export interface WildEngineConfigObject {
  readonly enabled?: boolean;
  readonly symbolIds?: readonly SymbolId[];
  readonly substitutionRules: readonly (WildSubstitutionRule | WildRuleInput)[];
  readonly knownSymbolIds?: readonly SymbolId[];
  readonly regularSymbolIds?: readonly SymbolId[];
  readonly scatterSymbolIds?: readonly SymbolId[];
  readonly bonusSymbolIds?: readonly SymbolId[];
  readonly paytable?: PaytableSource | PaytableEngine;
  readonly reelCount?: number;
}

export type WildEngineSource =
  | GameConfig
  | WildConfiguration
  | WildEngineConfigObject;

export interface WildEvaluationContext {
  /**
   * Reel index (`0 <= reelIndex < reelCount`) when testing `canSubstitute` at a specific reel.
   */
  readonly reelIndex?: number;
  /**
   * Active game round mode (default: `"base"`).
   */
  readonly mode?: WildRoundMode;
  /**
   * Active win evaluation model (default: `"fixedPaylines"`).
   */
  readonly winMode?: WildWinEvaluationMode;
  /**
   * Optional paytable source or engine used for All-Wild highest-value symbol resolution
   * and ambiguous starting-Wild candidate comparison.
   */
  readonly paytable?: PaytableSource | PaytableEngine;
  /**
   * Optional minimum contiguous match count filter (defaults to `1`).
   */
  readonly minMatchCount?: number;
}

/* -------------------------------------------------------------------------- */
/* 2. WILD RESOLUTION RESULT CONTRACTS                                        */
/* -------------------------------------------------------------------------- */

/**
 * Records a single cell where an active Wild substituted for a target symbol.
 */
export interface WildSubstitutionEntry {
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly actualSymbolId: SymbolId;
  readonly effectiveSymbolId: SymbolId;
  readonly wildSymbolId: SymbolId;
  readonly stopIndex?: number;
}

/**
 * Matched cell coordinate preserving both actual landed symbol and effective symbol.
 */
export interface WildResolvedCellPosition extends PaylineCellPosition {
  readonly reelIndex: number;
  readonly rowIndex: number;
  /** Effective symbol ID (compatible with B05/B06 PaylineCellPosition). */
  readonly symbolId: SymbolId;
  readonly actualSymbolId: SymbolId;
  readonly effectiveSymbolId: SymbolId;
  readonly isSubstituted: boolean;
  readonly stopIndex?: number;
}

/**
 * Serializable Wild-resolved payline match.
 * Preserves both actual landed symbols and effective substituted symbols,
 * and is structurally compatible with B05 `PaylineMatch` so B06 can consume it directly.
 * Intentionally excludes any cash/credit payout or bet calculation.
 */
export interface WildResolvedMatch {
  readonly paylineId: PaylineId;
  readonly paylineIndex: number;
  readonly paylineName: string;
  readonly pattern: readonly number[];
  readonly color?: string;
  /** Effective winning symbol ID (matches `baseSymbolId`). */
  readonly symbolId: SymbolId;
  readonly baseSymbolId: SymbolId;
  readonly matchCount: number;
  readonly reelIndexes: readonly number[];
  readonly matchedReels: readonly number[];
  readonly actualSymbols: readonly SymbolId[];
  readonly effectiveSymbols: readonly SymbolId[];
  readonly substitutions: readonly WildSubstitutionEntry[];
  readonly wildCount: number;
  readonly isAllWild: boolean;
  readonly cellPositions: readonly WildResolvedCellPosition[];
  readonly matchedStopIndexes: readonly number[];
}

export interface WildPaylineEvaluationResult {
  readonly matches: readonly WildResolvedMatch[];
  readonly evaluatedPaylineCount: number;
  readonly totalPaylineCount: number;
  readonly disabledPaylineCount: number;
  readonly winningPaylines: readonly PaylineId[];
  readonly totalMatchedLines: number;
}

export interface WildEngine {
  /**
   * Returns true if `symbolId` is configured as a Wild symbol in the game configuration.
   * Throws `UnknownWildSymbolError` if `symbolId` is empty or unknown to a strict symbol catalog.
   */
  isWild(symbolId: SymbolId): boolean;

  /**
   * Returns true if `symbolId` is a configured Wild symbol AND its substitution behavior
   * is active on `reelIndex` in the given `context`.
   */
  isWildActiveOnReel(
    symbolId: SymbolId,
    reelIndex: number,
    context?: WildEvaluationContext,
  ): boolean;

  /**
   * Returns true if `wildSymbolId` is allowed to substitute for `targetSymbolId`
   * under the configured rules, active reels, and active win/round modes.
   */
  canSubstitute(
    wildSymbolId: SymbolId,
    targetSymbolId: SymbolId,
    context?: WildEvaluationContext,
  ): boolean;

  /**
   * Creates a B05-compatible `SymbolMatchPolicy` for a fixed `baseSymbolId` and `context`.
   */
  createMatchPolicy(
    baseSymbolId: SymbolId,
    context?: WildEvaluationContext,
  ): SymbolMatchPolicy;

  /**
   * Resolves a single fixed payline with Wild substitution rules.
   * Returns `null` if the payline is disabled or if no valid combination exists
   * (e.g. a Wild-only run when `paysOnOwn === false` and no target substitution applies).
   */
  resolvePayline(
    board: Board,
    payline: PaylineDefinition | NormalizedPayline | PaylineInput,
    context?: WildEvaluationContext,
  ): WildResolvedMatch | null;

  /**
   * Alias for `resolvePayline`.
   */
  resolvePaylineMatch(
    board: Board,
    payline: PaylineDefinition | NormalizedPayline | PaylineInput,
    context?: WildEvaluationContext,
  ): WildResolvedMatch | null;

  /**
   * Evaluates all enabled fixed paylines on `board` with Wild substitution rules.
   */
  resolvePaylines(
    board: Board,
    paylinesOrConfig:
      | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
      | GameConfig,
    context?: WildEvaluationContext,
  ): WildPaylineEvaluationResult;

  /**
   * Alias for `resolvePaylines`.
   */
  evaluate(
    board: Board,
    paylinesOrConfig:
      | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
      | GameConfig,
    context?: WildEvaluationContext,
  ): WildPaylineEvaluationResult;
}

/* -------------------------------------------------------------------------- */
/* 3. NORMALIZED INTERNAL WILD RULE REPRESENTATION & VALIDATION               */
/* -------------------------------------------------------------------------- */

interface NormalizedWildRule {
  readonly wildSymbolId: SymbolId;
  readonly allowedMode: "allRegular" | "explicit";
  readonly allowedSet: ReadonlySet<SymbolId>;
  readonly allowedOrder: readonly SymbolId[];
  readonly excludedSet: ReadonlySet<SymbolId>;
  readonly activeReelSet: ReadonlySet<number> | null; // null means all reels active
  readonly activeRoundModes: ReadonlySet<WildRoundMode>;
  readonly activeWinModes: ReadonlySet<WildWinEvaluationMode>;
  readonly paysOnOwn: boolean;
  readonly multiplier: number;
}

interface NormalizedWildEngineState {
  readonly enabled: boolean;
  readonly wildSymbolIds: ReadonlySet<SymbolId>;
  readonly rulesByWildId: ReadonlyMap<SymbolId, NormalizedWildRule>;
  readonly knownSymbolIds: ReadonlySet<SymbolId>;
  readonly strictKnownCatalog: boolean;
  readonly regularSymbolOrder: readonly SymbolId[];
  readonly regularSymbolSet: ReadonlySet<SymbolId>;
  readonly scatterSymbolSet: ReadonlySet<SymbolId>;
  readonly bonusSymbolSet: ReadonlySet<SymbolId>;
  readonly defaultPaytable: NormalizedPaytableLookup | null;
}

function isPaytableEngineLike(candidate: unknown): candidate is PaytableEngine {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    typeof (candidate as PaytableEngine).getMultiplier === "function"
  );
}

function buildPaytableLookupFromOption(
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
        `Invalid paytable reference in WildEngine: ${err.message}`,
        { originalCode: err.code, ...err.context },
      );
    }
    throw new InvalidPaytableReferenceError(
      `Invalid paytable reference in WildEngine: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function normalizeWildEngineSource(
  source: WildEngineSource,
): NormalizedWildEngineState {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new InvalidWildConfigurationError(
      "WildEngine requires a valid GameConfig or WildConfiguration object.",
      { source },
    );
  }

  let enabled = true;
  const knownSymbolIds = new Set<SymbolId>();
  let strictKnownCatalog = false;
  const regularSymbolOrder: SymbolId[] = [];
  const regularSymbolSet = new Set<SymbolId>();
  const scatterSymbolSet = new Set<SymbolId>();
  const bonusSymbolSet = new Set<SymbolId>();
  const declaredWildIds = new Set<SymbolId>();
  let rawRules: readonly (WildSubstitutionRule | WildRuleInput)[] = [];
  let defaultPaytable: NormalizedPaytableLookup | null = null;
  let maxReelsCount: number | null = null;

  if (isGameConfig(source as GameConfig)) {
    const config = source as GameConfig;
    strictKnownCatalog = true;
    maxReelsCount = config.grid.columns;
    defaultPaytable = normalizePaytableLookup(config);

    for (const sym of config.symbols) {
      knownSymbolIds.add(sym.id);
      if (sym.role.isWild) {
        declaredWildIds.add(sym.id);
      } else if (sym.role.isScatter) {
        scatterSymbolSet.add(sym.id);
      } else if (sym.role.isBonus) {
        bonusSymbolSet.add(sym.id);
      } else {
        regularSymbolOrder.push(sym.id);
        regularSymbolSet.add(sym.id);
      }
    }

    if (config.variantsById) {
      for (const [varId] of config.variantsById.entries()) {
        knownSymbolIds.add(varId);
      }
    }

    if (config.wildConfiguration) {
      enabled = Boolean(config.wildConfiguration.enabled);
      for (const id of config.wildConfiguration.symbolIds) {
        declaredWildIds.add(id);
      }
      rawRules = config.wildConfiguration.substitutionRules;
    } else {
      enabled = config.wildSymbolIds.size > 0;
      const allReels = Array.from({ length: config.grid.columns }, (_, i) => i);
      const nonRegular = [
        ...Array.from(scatterSymbolSet),
        ...Array.from(bonusSymbolSet),
        ...Array.from(declaredWildIds),
      ];
      rawRules = config.symbols
        .filter((s) => s.role.isWild)
        .map((wSym) => ({
          wildSymbolId: wSym.id,
          allowedSubstitutions: "allRegular" as const,
          excludedSymbolIds: wSym.role.substitutesScatter
            ? nonRegular.filter((id) => !scatterSymbolSet.has(id))
            : nonRegular,
          activeReels: allReels,
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: Object.keys(wSym.payoutsByCount).length > 0,
          multiplier: wSym.role.wildMultiplier,
        }));
    }
  } else {
    const cfg = source as WildEngineConfigObject & WildConfiguration;
    if (cfg.enabled !== undefined && typeof cfg.enabled !== "boolean") {
      throw new InvalidWildConfigurationError(
        `WildConfiguration.enabled must be a boolean; received ${typeof cfg.enabled}.`,
        { enabled: cfg.enabled },
      );
    }
    enabled = cfg.enabled ?? true;

    if (!Array.isArray(cfg.substitutionRules)) {
      throw new InvalidWildConfigurationError(
        "WildConfiguration.substitutionRules must be an array.",
        { substitutionRules: cfg.substitutionRules },
      );
    }
    rawRules = cfg.substitutionRules;

    if (cfg.reelCount !== undefined) {
      if (!Number.isInteger(cfg.reelCount) || cfg.reelCount < 1) {
        throw new InvalidWildConfigurationError(
          `Invalid reelCount (${String(cfg.reelCount)}) in WildConfiguration.`,
          { reelCount: cfg.reelCount },
        );
      }
      maxReelsCount = cfg.reelCount;
    }

    if (cfg.paytable !== undefined) {
      defaultPaytable = buildPaytableLookupFromOption(cfg.paytable);
      if (defaultPaytable) {
        for (const symId of defaultPaytable.knownSymbolIds) {
          knownSymbolIds.add(symId);
        }
      }
    }

    if (Array.isArray(cfg.knownSymbolIds)) {
      strictKnownCatalog = true;
      for (const symId of cfg.knownSymbolIds) {
        if (typeof symId !== "string" || symId.trim().length === 0) {
          throw new UnknownWildSymbolError(
            "knownSymbolIds contains an empty or non-string symbol ID.",
            { symId },
          );
        }
        knownSymbolIds.add(symId);
      }
    }

    if (Array.isArray(cfg.scatterSymbolIds)) {
      for (const id of cfg.scatterSymbolIds) {
        scatterSymbolSet.add(id);
        knownSymbolIds.add(id);
      }
    }

    if (Array.isArray(cfg.bonusSymbolIds)) {
      for (const id of cfg.bonusSymbolIds) {
        bonusSymbolSet.add(id);
        knownSymbolIds.add(id);
      }
    }

    if (Array.isArray(cfg.symbolIds)) {
      for (const id of cfg.symbolIds) {
        if (typeof id !== "string" || id.trim().length === 0) {
          throw new UnknownWildSymbolError(
            "WildConfiguration.symbolIds contains an empty or non-string symbol ID.",
            { symbolId: id },
          );
        }
        if (strictKnownCatalog && !knownSymbolIds.has(id)) {
          throw new UnknownWildSymbolError(
            `Wild symbol "${id}" is not present in knownSymbolIds.`,
            { wildSymbolId: id },
          );
        }
        declaredWildIds.add(id);
        knownSymbolIds.add(id);
      }
    }

    if (Array.isArray(cfg.regularSymbolIds)) {
      for (const id of cfg.regularSymbolIds) {
        regularSymbolOrder.push(id);
        regularSymbolSet.add(id);
        knownSymbolIds.add(id);
      }
    }
  }

  const rulesByWildId = new Map<SymbolId, NormalizedWildRule>();

  for (let i = 0; i < rawRules.length; i += 1) {
    const rawRule = rawRules[i] as WildRuleInput;
    if (!rawRule || typeof rawRule !== "object") {
      throw new InvalidSubstitutionRuleError(
        `Wild substitution rule at index ${i} must be an object.`,
        { index: i, rule: rawRule },
      );
    }

    const wildId = rawRule.wildSymbolId;
    if (typeof wildId !== "string" || wildId.trim().length === 0) {
      throw new UnknownWildSymbolError(
        `Wild substitution rule at index ${i} is missing a non-empty wildSymbolId.`,
        { index: i, wildSymbolId: wildId },
      );
    }

    if (strictKnownCatalog && !knownSymbolIds.has(wildId)) {
      throw new UnknownWildSymbolError(
        `Wild substitution rule references unknown wildSymbolId "${wildId}".`,
        { index: i, wildSymbolId: wildId },
      );
    }

    if (rulesByWildId.has(wildId)) {
      throw new InvalidSubstitutionRuleError(
        `Duplicate substitution rule for wildSymbolId "${wildId}".`,
        { index: i, wildSymbolId: wildId },
      );
    }

    declaredWildIds.add(wildId);
    knownSymbolIds.add(wildId);

    // Resolve allowedSubstitutions / allowedSymbols
    const rawAllowed =
      rawRule.allowedSubstitutions !== undefined
        ? rawRule.allowedSubstitutions
        : rawRule.allowedSymbols !== undefined
          ? rawRule.allowedSymbols
          : "allRegular";

    let allowedMode: "allRegular" | "explicit";
    const allowedSet = new Set<SymbolId>();
    const allowedOrder: SymbolId[] = [];

    if (rawAllowed === "allRegular") {
      allowedMode = "allRegular";
    } else if (Array.isArray(rawAllowed)) {
      allowedMode = "explicit";
      for (const targetId of rawAllowed) {
        if (typeof targetId !== "string" || targetId.trim().length === 0) {
          throw new UnknownWildSymbolError(
            `Wild "${wildId}" allowedSubstitutions contains an empty or non-string target symbol ID.`,
            { wildSymbolId: wildId, targetId },
          );
        }
        if (strictKnownCatalog && !knownSymbolIds.has(targetId)) {
          throw new UnknownWildSymbolError(
            `Wild "${wildId}" allowedSubstitutions references unknown symbol "${targetId}".`,
            { wildSymbolId: wildId, targetSymbolId: targetId },
          );
        }
        if (!allowedSet.has(targetId)) {
          allowedSet.add(targetId);
          allowedOrder.push(targetId);
          if (!declaredWildIds.has(targetId) && !regularSymbolSet.has(targetId)) {
            regularSymbolOrder.push(targetId);
            regularSymbolSet.add(targetId);
          }
          knownSymbolIds.add(targetId);
        }
      }
    } else {
      throw new InvalidSubstitutionRuleError(
        `Wild "${wildId}" has invalid allowedSubstitutions; expected "allRegular" or an array of symbol IDs.`,
        { wildSymbolId: wildId, allowedSubstitutions: rawAllowed },
      );
    }

    // Resolve excludedSymbolIds / excludedSymbols
    const rawExcluded =
      rawRule.excludedSymbolIds !== undefined
        ? rawRule.excludedSymbolIds
        : rawRule.excludedSymbols !== undefined
          ? rawRule.excludedSymbols
          : [];

    if (!Array.isArray(rawExcluded)) {
      throw new InvalidSubstitutionRuleError(
        `Wild "${wildId}" excludedSymbolIds must be an array of symbol IDs.`,
        { wildSymbolId: wildId, excludedSymbolIds: rawExcluded },
      );
    }

    const excludedSet = new Set<SymbolId>();
    for (const exId of rawExcluded) {
      if (typeof exId !== "string" || exId.trim().length === 0) {
        throw new UnknownWildSymbolError(
          `Wild "${wildId}" excludedSymbolIds contains an empty or non-string symbol ID.`,
          { wildSymbolId: wildId, excludedSymbolId: exId },
        );
      }
      if (strictKnownCatalog && !knownSymbolIds.has(exId)) {
        throw new UnknownWildSymbolError(
          `Wild "${wildId}" excludedSymbolIds references unknown symbol "${exId}".`,
          { wildSymbolId: wildId, excludedSymbolId: exId },
        );
      }
      if (allowedMode === "explicit" && allowedSet.has(exId)) {
        throw new InvalidSubstitutionRuleError(
          `Contradictory substitution rule for Wild "${wildId}": symbol "${exId}" is listed in both allowedSubstitutions and excludedSymbolIds.`,
          { wildSymbolId: wildId, symbolId: exId },
        );
      }
      excludedSet.add(exId);
      knownSymbolIds.add(exId);
    }

    // Validate activeReels
    let activeReelSet: Set<number> | null = null;
    if (rawRule.activeReels !== undefined) {
      if (!Array.isArray(rawRule.activeReels)) {
        throw new InvalidSubstitutionRuleError(
          `Wild "${wildId}" activeReels must be an array of non-negative reel indexes.`,
          { wildSymbolId: wildId, activeReels: rawRule.activeReels },
        );
      }
      activeReelSet = new Set<number>();
      for (const rIdx of rawRule.activeReels) {
        if (
          typeof rIdx !== "number" ||
          !Number.isInteger(rIdx) ||
          rIdx < 0 ||
          (maxReelsCount !== null && rIdx >= maxReelsCount)
        ) {
          throw new InvalidSubstitutionRuleError(
            `Wild "${wildId}" activeReels contains invalid reel index ${String(rIdx)}.`,
            {
              wildSymbolId: wildId,
              reelIndex: rIdx,
              reelCount: maxReelsCount,
            },
          );
        }
        activeReelSet.add(rIdx);
      }
    }

    // Validate activeModes
    const activeRoundModes = new Set<WildRoundMode>();
    const activeWinModes = new Set<WildWinEvaluationMode>();

    if (rawRule.activeModes !== undefined) {
      if (
        !Array.isArray(rawRule.activeModes) ||
        rawRule.activeModes.length === 0
      ) {
        throw new InvalidSubstitutionRuleError(
          `Wild "${wildId}" activeModes must be a non-empty array of valid modes.`,
          { wildSymbolId: wildId, activeModes: rawRule.activeModes },
        );
      }
      for (const mode of rawRule.activeModes) {
        if (VALID_ROUND_MODES.has(mode)) {
          activeRoundModes.add(mode as WildRoundMode);
        } else if (VALID_WIN_MODES.has(mode)) {
          activeWinModes.add(mode as WildWinEvaluationMode);
          if (mode === "lines") {
            activeWinModes.add("fixedPaylines");
          } else if (mode === "fixedPaylines") {
            activeWinModes.add("lines");
          }
        } else {
          throw new InvalidSubstitutionRuleError(
            `Wild "${wildId}" activeModes contains unsupported mode "${String(mode)}".`,
            { wildSymbolId: wildId, mode },
          );
        }
      }
    }

    if (activeRoundModes.size === 0) {
      activeRoundModes.add("base");
      activeRoundModes.add("freeSpins");
      activeRoundModes.add("bonus");
    }
    if (activeWinModes.size === 0) {
      activeWinModes.add("fixedPaylines");
      activeWinModes.add("lines");
      activeWinModes.add("ways");
      activeWinModes.add("clusters");
      activeWinModes.add("payAnywhere");
    }

    // Validate paysOnOwn
    const paysOnOwn =
      rawRule.paysOnOwn !== undefined ? rawRule.paysOnOwn : false;
    if (typeof paysOnOwn !== "boolean") {
      throw new InvalidSubstitutionRuleError(
        `Wild "${wildId}" paysOnOwn must be a boolean; received ${typeof paysOnOwn}.`,
        { wildSymbolId: wildId, paysOnOwn },
      );
    }

    // Validate multiplier
    const multiplier =
      rawRule.multiplier !== undefined ? rawRule.multiplier : 1;
    if (
      typeof multiplier !== "number" ||
      !Number.isFinite(multiplier) ||
      multiplier <= 0
    ) {
      throw new InvalidSubstitutionRuleError(
        `Wild "${wildId}" multiplier (${String(multiplier)}) must be a finite number > 0.`,
        { wildSymbolId: wildId, multiplier },
      );
    }

    rulesByWildId.set(
      wildId,
      Object.freeze({
        wildSymbolId: wildId,
        allowedMode,
        allowedSet,
        allowedOrder: Object.freeze(allowedOrder),
        excludedSet,
        activeReelSet,
        activeRoundModes,
        activeWinModes,
        paysOnOwn,
        multiplier,
      }),
    );
  }

  // Ensure every declared wild symbol in symbolIds has a rule when enabled
  for (const wildId of declaredWildIds) {
    if (!rulesByWildId.has(wildId)) {
      throw new InvalidWildConfigurationError(
        `Wild symbol "${wildId}" is listed in symbolIds but has no substitution rule.`,
        { wildSymbolId: wildId },
      );
    }
  }

  // Populate regularSymbolOrder from paytable if not already populated
  if (regularSymbolOrder.length === 0 && defaultPaytable) {
    for (const symId of defaultPaytable.knownSymbolIds) {
      if (
        !declaredWildIds.has(symId) &&
        !scatterSymbolSet.has(symId) &&
        !bonusSymbolSet.has(symId) &&
        !regularSymbolSet.has(symId)
      ) {
        regularSymbolOrder.push(symId);
        regularSymbolSet.add(symId);
      }
    }
  }

  return Object.freeze({
    enabled,
    wildSymbolIds: declaredWildIds,
    rulesByWildId,
    knownSymbolIds,
    strictKnownCatalog,
    regularSymbolOrder: Object.freeze(regularSymbolOrder),
    regularSymbolSet,
    scatterSymbolSet,
    bonusSymbolSet,
    defaultPaytable,
  });
}

function validateWildContext(context?: WildEvaluationContext): {
  readonly reelIndex: number | undefined;
  readonly mode: WildRoundMode;
  readonly winMode: WildWinEvaluationMode;
  readonly minMatchCount: number;
} {
  if (context === undefined) {
    return {
      reelIndex: undefined,
      mode: "base",
      winMode: "fixedPaylines",
      minMatchCount: 1,
    };
  }
  if (!context || typeof context !== "object") {
    throw new InvalidWildContextError(
      "WildEvaluationContext must be a valid object when provided.",
      { context },
    );
  }

  if (context.reelIndex !== undefined) {
    if (
      typeof context.reelIndex !== "number" ||
      !Number.isInteger(context.reelIndex) ||
      context.reelIndex < 0
    ) {
      throw new InvalidWildContextError(
        `Invalid reelIndex (${String(context.reelIndex)}) in WildEvaluationContext; expected a non-negative integer.`,
        { reelIndex: context.reelIndex },
      );
    }
  }

  const mode = context.mode ?? "base";
  if (!VALID_ROUND_MODES.has(mode)) {
    throw new InvalidWildContextError(
      `Invalid round mode "${String(mode)}" in WildEvaluationContext.`,
      { mode },
    );
  }

  const winMode = context.winMode ?? "fixedPaylines";
  if (!VALID_WIN_MODES.has(winMode)) {
    throw new InvalidWildContextError(
      `Invalid winMode "${String(winMode)}" in WildEvaluationContext.`,
      { winMode },
    );
  }

  const minMatchCount = context.minMatchCount ?? 1;
  if (
    typeof minMatchCount !== "number" ||
    !Number.isInteger(minMatchCount) ||
    minMatchCount < 1
  ) {
    throw new InvalidWildContextError(
      `Invalid minMatchCount (${String(minMatchCount)}) in WildEvaluationContext.`,
      { minMatchCount },
    );
  }

  return {
    reelIndex: context.reelIndex,
    mode,
    winMode,
    minMatchCount,
  };
}

function resolvePaylineEnabled(payline: PaylineInput): boolean {
  if ("enabled" in payline && payline.enabled !== undefined) {
    return Boolean(payline.enabled);
  }
  if ("active" in payline && payline.active !== undefined) {
    return Boolean(payline.active);
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* 4. DETERMINISTIC WILD ENGINE IMPLEMENTATION                                */
/* -------------------------------------------------------------------------- */

export class DeterministicWildEngine implements WildEngine {
  private readonly state: NormalizedWildEngineState;

  constructor(source: WildEngineSource) {
    this.state = normalizeWildEngineSource(source);
  }

  private assertValidSymbolId(symbolId: unknown, roleLabel: string): SymbolId {
    if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
      throw new UnknownWildSymbolError(
        `${roleLabel} must be a non-empty string symbol ID.`,
        { symbolId, role: roleLabel },
      );
    }
    if (
      this.state.strictKnownCatalog &&
      !this.state.knownSymbolIds.has(symbolId)
    ) {
      throw new UnknownWildSymbolError(
        `Unknown ${roleLabel} "${symbolId}" is not defined in the game configuration.`,
        { symbolId, role: roleLabel },
      );
    }
    return symbolId;
  }

  public isWild(symbolId: SymbolId): boolean {
    const validId = this.assertValidSymbolId(symbolId, "symbolId");
    return this.state.wildSymbolIds.has(validId);
  }

  public isWildActiveOnReel(
    symbolId: SymbolId,
    reelIndex: number,
    context?: WildEvaluationContext,
  ): boolean {
    const validId = this.assertValidSymbolId(symbolId, "symbolId");
    const validatedCtx = validateWildContext({
      ...context,
      reelIndex,
    });

    if (!this.state.enabled) {
      return false;
    }

    const rule = this.state.rulesByWildId.get(validId);
    if (!rule) {
      return false;
    }

    if (!rule.activeRoundModes.has(validatedCtx.mode)) {
      return false;
    }

    if (!rule.activeWinModes.has(validatedCtx.winMode)) {
      return false;
    }

    if (rule.activeReelSet !== null && !rule.activeReelSet.has(reelIndex)) {
      return false;
    }

    return true;
  }

  public canSubstitute(
    wildSymbolId: SymbolId,
    targetSymbolId: SymbolId,
    context?: WildEvaluationContext,
  ): boolean {
    const validWildId = this.assertValidSymbolId(wildSymbolId, "wildSymbolId");
    const validTargetId = this.assertValidSymbolId(
      targetSymbolId,
      "targetSymbolId",
    );
    const validatedCtx = validateWildContext(context);

    if (!this.state.enabled) {
      return false;
    }

    const rule = this.state.rulesByWildId.get(validWildId);
    if (!rule) {
      return false;
    }

    // Check active round mode & win mode
    if (!rule.activeRoundModes.has(validatedCtx.mode)) {
      return false;
    }
    if (!rule.activeWinModes.has(validatedCtx.winMode)) {
      return false;
    }

    // Check active reel when reelIndex is specified
    if (
      validatedCtx.reelIndex !== undefined &&
      rule.activeReelSet !== null &&
      !rule.activeReelSet.has(validatedCtx.reelIndex)
    ) {
      return false;
    }

    // Explicit exclusions always take precedence
    if (rule.excludedSet.has(validTargetId)) {
      return false;
    }

    // One Wild does not automatically substitute for itself or another Wild
    // unless explicitly listed in allowedSubstitutions
    if (this.state.wildSymbolIds.has(validTargetId)) {
      return (
        rule.allowedMode === "explicit" && rule.allowedSet.has(validTargetId)
      );
    }

    if (rule.allowedMode === "explicit") {
      return rule.allowedSet.has(validTargetId);
    }

    // allowedMode === "allRegular":
    // Scatter and Bonus symbols are not regular symbols and are excluded by default
    // unless not in excludedSet AND not a scatter/bonus (or explicitly allowed via empty excludedSet for scatter when substitutesScatter is true).
    if (this.state.bonusSymbolSet.has(validTargetId)) {
      return false;
    }
    if (
      this.state.scatterSymbolSet.has(validTargetId) &&
      rule.excludedSet.has(validTargetId)
    ) {
      return false;
    }

    return true;
  }

  public createMatchPolicy(
    baseSymbolId: SymbolId,
    context?: WildEvaluationContext,
  ): SymbolMatchPolicy {
    const validBase = this.assertValidSymbolId(baseSymbolId, "baseSymbolId");
    validateWildContext(context);

    return Object.freeze({
      id: `wild-policy:${validBase}`,
      matches: (
        policyBaseSymbolId: SymbolId,
        candidateSymbolId: SymbolId,
        reelIndex: number,
      ): boolean => {
        if (policyBaseSymbolId === candidateSymbolId) {
          return true;
        }
        return this.canSubstitute(candidateSymbolId, policyBaseSymbolId, {
          ...context,
          reelIndex,
        });
      },
    });
  }

  private resolvePaytableLookup(
    context?: WildEvaluationContext,
  ): {
    getMultiplier(symbolId: SymbolId, matchCount: number): number;
    getMaxMultiplier(symbolId: SymbolId): number;
    candidateSymbols: readonly SymbolId[];
  } | null {
    if (context?.paytable) {
      if (isPaytableEngineLike(context.paytable)) {
        const ptEngine = context.paytable;
        return {
          getMultiplier: (symId, count) => {
            try {
              return ptEngine.getMultiplier(symId, count);
            } catch {
              return 0;
            }
          },
          getMaxMultiplier: (symId) => {
            let max = 0;
            for (let c = 1; c <= 10; c += 1) {
              try {
                const m = ptEngine.getMultiplier(symId, c);
                if (m > max) max = m;
              } catch {
                // ignore
              }
            }
            return max;
          },
          candidateSymbols: this.state.regularSymbolOrder,
        };
      }

      const lookup = buildPaytableLookupFromOption(context.paytable);
      if (lookup) {
        return this.wrapNormalizedLookup(lookup);
      }
    }

    if (this.state.defaultPaytable) {
      return this.wrapNormalizedLookup(this.state.defaultPaytable);
    }

    return null;
  }

  private wrapNormalizedLookup(lookup: NormalizedPaytableLookup) {
    const candidateSymbols: SymbolId[] = [];
    for (const symId of this.state.regularSymbolOrder) {
      candidateSymbols.push(symId);
    }
    for (const symId of lookup.knownSymbolIds) {
      if (
        !this.state.wildSymbolIds.has(symId) &&
        !this.state.scatterSymbolSet.has(symId) &&
        !this.state.bonusSymbolSet.has(symId) &&
        !candidateSymbols.includes(symId)
      ) {
        candidateSymbols.push(symId);
      }
    }

    return {
      getMultiplier: (symId: SymbolId, count: number): number => {
        const ladder = lookup.bySymbolId.get(symId);
        return ladder?.get(count) ?? 0;
      },
      getMaxMultiplier: (symId: SymbolId): number => {
        const ladder = lookup.bySymbolId.get(symId);
        if (!ladder) return 0;
        let max = 0;
        for (const val of ladder.values()) {
          if (val > max) max = val;
        }
        return max;
      },
      candidateSymbols: Object.freeze(candidateSymbols),
    };
  }

  private getEligibleTargetsForWilds(
    wildCells: readonly { readonly reelIndex: number; readonly symbolId: SymbolId }[],
    context: WildEvaluationContext | undefined,
    paytableHelper: ReturnType<DeterministicWildEngine["resolvePaytableLookup"]>,
  ): readonly SymbolId[] {
    const orderedCandidates: SymbolId[] = [];
    const seen = new Set<SymbolId>();

    const addCandidate = (symId: SymbolId) => {
      if (
        !seen.has(symId) &&
        !this.state.wildSymbolIds.has(symId) &&
        !this.state.scatterSymbolSet.has(symId) &&
        !this.state.bonusSymbolSet.has(symId)
      ) {
        seen.add(symId);
        orderedCandidates.push(symId);
      }
    };

    for (const symId of this.state.regularSymbolOrder) {
      addCandidate(symId);
    }
    if (paytableHelper) {
      for (const symId of paytableHelper.candidateSymbols) {
        addCandidate(symId);
      }
    }
    for (const wc of wildCells) {
      const rule = this.state.rulesByWildId.get(wc.symbolId);
      if (rule && rule.allowedMode === "explicit") {
        for (const symId of rule.allowedOrder) {
          addCandidate(symId);
        }
      }
    }

    return orderedCandidates.filter((targetId) =>
      wildCells.every((wc) =>
        this.canSubstitute(wc.symbolId, targetId, {
          ...context,
          reelIndex: wc.reelIndex,
        }),
      ),
    );
  }

  private buildResolvedMatch(
    payline: PaylineInput,
    lineCells: readonly {
      readonly reelIndex: number;
      readonly rowIndex: number;
      readonly cell: Cell;
      readonly actualSymbolId: SymbolId;
    }[],
    baseSymbolId: SymbolId,
    matchCount: number,
    isAllWild: boolean,
  ): WildResolvedMatch {
    const reelIndexes: number[] = [];
    const actualSymbols: SymbolId[] = [];
    const effectiveSymbols: SymbolId[] = [];
    const substitutions: WildSubstitutionEntry[] = [];
    const cellPositions: WildResolvedCellPosition[] = [];
    const matchedStopIndexes: number[] = [];
    let wildCount = 0;

    for (let i = 0; i < matchCount; i += 1) {
      const item = lineCells[i];
      const actualId = item.actualSymbolId;
      const effectiveId = baseSymbolId;
      const isWildCell = this.state.wildSymbolIds.has(actualId);
      const isSubstituted = actualId !== effectiveId;

      if (isWildCell) {
        wildCount += 1;
      }

      const stopIdx =
        typeof item.cell.stopIndex === "number" &&
        Number.isInteger(item.cell.stopIndex)
          ? item.cell.stopIndex
          : undefined;

      if (isSubstituted) {
        substitutions.push(
          Object.freeze({
            reelIndex: item.reelIndex,
            rowIndex: item.rowIndex,
            actualSymbolId: actualId,
            effectiveSymbolId: effectiveId,
            wildSymbolId: actualId,
            ...(stopIdx !== undefined ? { stopIndex: stopIdx } : {}),
          }),
        );
      }

      reelIndexes.push(item.reelIndex);
      actualSymbols.push(actualId);
      effectiveSymbols.push(effectiveId);
      if (stopIdx !== undefined) {
        matchedStopIndexes.push(stopIdx);
      }

      cellPositions.push(
        Object.freeze({
          reelIndex: item.reelIndex,
          rowIndex: item.rowIndex,
          symbolId: effectiveId,
          actualSymbolId: actualId,
          effectiveSymbolId: effectiveId,
          isSubstituted,
          ...(stopIdx !== undefined ? { stopIndex: stopIdx } : {}),
        }),
      );
    }

    const frozenReels = Object.freeze(reelIndexes);

    return Object.freeze({
      paylineId: payline.id,
      paylineIndex: payline.index,
      paylineName:
        typeof payline.name === "string" && payline.name.trim().length > 0
          ? payline.name
          : `Line ${payline.index}`,
      pattern: Object.freeze([...payline.pattern]),
      ...(typeof payline.color === "string" && payline.color.trim().length > 0
        ? { color: payline.color }
        : {}),
      symbolId: baseSymbolId,
      baseSymbolId,
      matchCount,
      reelIndexes: frozenReels,
      matchedReels: frozenReels,
      actualSymbols: Object.freeze(actualSymbols),
      effectiveSymbols: Object.freeze(effectiveSymbols),
      substitutions: Object.freeze(substitutions),
      wildCount,
      isAllWild,
      cellPositions: Object.freeze(cellPositions),
      matchedStopIndexes: Object.freeze(matchedStopIndexes),
    });
  }

  private computeContiguousRunForTarget(
    lineCells: readonly {
      readonly reelIndex: number;
      readonly rowIndex: number;
      readonly cell: Cell;
      readonly actualSymbolId: SymbolId;
    }[],
    targetSymbolId: SymbolId,
    context?: WildEvaluationContext,
  ): number {
    let count = 0;
    for (let r = 0; r < lineCells.length; r += 1) {
      const actualId = lineCells[r].actualSymbolId;
      if (actualId === targetSymbolId) {
        count += 1;
      } else if (
        this.canSubstitute(actualId, targetSymbolId, {
          ...context,
          reelIndex: r,
        })
      ) {
        count += 1;
      } else {
        break;
      }
    }
    return count;
  }

  public resolvePayline(
    board: Board,
    payline: PaylineDefinition | NormalizedPayline | PaylineInput,
    context?: WildEvaluationContext,
  ): WildResolvedMatch | null {
    validateBoardForPaylines(board);
    validatePaylineForBoard(board, payline);
    const validatedCtx = validateWildContext(context);
    const paytableHelper = this.resolvePaytableLookup(context);

    if (!resolvePaylineEnabled(payline)) {
      return null;
    }

    const reelCount = board.reelCount ?? board.columns;
    const lineCells: {
      readonly reelIndex: number;
      readonly rowIndex: number;
      readonly cell: Cell;
      readonly actualSymbolId: SymbolId;
    }[] = [];

    for (let reelIndex = 0; reelIndex < reelCount; reelIndex += 1) {
      const rowIndex = payline.pattern[reelIndex];
      const cell = board.cells[reelIndex][rowIndex];
      const actualSymbolId = cell.symbolId ?? cell.symbol.symbolId;
      this.assertValidSymbolId(actualSymbolId, "board cell symbolId");
      lineCells.push({
        reelIndex,
        rowIndex,
        cell,
        actualSymbolId,
      });
    }

    const firstSymbolId = lineCells[0].actualSymbolId;
    const isReel0ActiveWild = this.isWildActiveOnReel(
      firstSymbolId,
      0,
      context,
    );

    // CASE 1: Reel 0 is NOT an active substituting Wild.
    if (!isReel0ActiveWild) {
      // If Reel 0 holds a Wild symbol whose rule has paysOnOwn = false and is inactive on reel 0,
      // it cannot form an independent Wild-only combination.
      const reel0WildRule = this.state.rulesByWildId.get(firstSymbolId);
      if (reel0WildRule && !reel0WildRule.paysOnOwn) {
        return null;
      }

      const matchCount = this.computeContiguousRunForTarget(
        lineCells,
        firstSymbolId,
        context,
      );
      if (matchCount < validatedCtx.minMatchCount) {
        return null;
      }
      return this.buildResolvedMatch(
        payline,
        lineCells,
        firstSymbolId,
        matchCount,
        false,
      );
    }

    // CASE 2: Reel 0 IS an active Wild.
    // Count how many consecutive reels from 0 hold active Wilds.
    let leadingActiveWildCount = 0;
    for (let r = 0; r < reelCount; r += 1) {
      const symId = lineCells[r].actualSymbolId;
      if (this.isWildActiveOnReel(symId, r, context)) {
        leadingActiveWildCount += 1;
      } else {
        break;
      }
    }

    const firstWildRule = this.state.rulesByWildId.get(firstSymbolId)!;

    // SUBCASE 2A: All symbols on the payline are active Wilds (ALL-WILD COMBINATION).
    if (leadingActiveWildCount === reelCount) {
      const wildCells = lineCells.map((lc) => ({
        reelIndex: lc.reelIndex,
        symbolId: lc.actualSymbolId,
      }));
      const eligibleTargets = this.getEligibleTargetsForWilds(
        wildCells,
        context,
        paytableHelper,
      );

      // Select highest-value symbol in the paytable (documented All-Wild rule)
      if (paytableHelper && eligibleTargets.length > 0) {
        let bestSymbol: SymbolId = eligibleTargets[0];
        let bestCountScore = paytableHelper.getMultiplier(
          bestSymbol,
          reelCount,
        );
        let bestMaxScore = paytableHelper.getMaxMultiplier(bestSymbol);

        for (let i = 1; i < eligibleTargets.length; i += 1) {
          const candidate = eligibleTargets[i];
          const countScore = paytableHelper.getMultiplier(candidate, reelCount);
          const maxScore = paytableHelper.getMaxMultiplier(candidate);

          if (
            countScore > bestCountScore ||
            (countScore === bestCountScore && maxScore > bestMaxScore)
          ) {
            bestSymbol = candidate;
            bestCountScore = countScore;
            bestMaxScore = maxScore;
          }
        }

        if (bestCountScore > 0 || bestMaxScore > 0 || !firstWildRule.paysOnOwn) {
          if (reelCount < validatedCtx.minMatchCount) {
            return null;
          }
          return this.buildResolvedMatch(
            payline,
            lineCells,
            bestSymbol,
            reelCount,
            true,
          );
        }
      }

      // If no paytable is provided:
      // - If paysOnOwn is true, resolve as a pure Wild combination
      // - Otherwise resolve to the first eligible target symbol in canonical order
      if (firstWildRule.paysOnOwn) {
        if (reelCount < validatedCtx.minMatchCount) {
          return null;
        }
        return this.buildResolvedMatch(
          payline,
          lineCells,
          firstSymbolId,
          reelCount,
          true,
        );
      }

      if (eligibleTargets.length > 0) {
        if (reelCount < validatedCtx.minMatchCount) {
          return null;
        }
        return this.buildResolvedMatch(
          payline,
          lineCells,
          eligibleTargets[0],
          reelCount,
          true,
        );
      }

      return null;
    }

    // SUBCASE 2B: Leading Wild(s) followed by a first non-Wild symbol at `leadingActiveWildCount`.
    const firstNonWildCell = lineCells[leadingActiveWildCount];
    const targetSymbolId = firstNonWildCell.actualSymbolId;

    // Check if all leading active Wilds (0 .. leadingActiveWildCount - 1) can substitute for targetSymbolId
    const canLeadingWildsReplaceTarget = lineCells
      .slice(0, leadingActiveWildCount)
      .every((lc) =>
        this.canSubstitute(lc.actualSymbolId, targetSymbolId, {
          ...context,
          reelIndex: lc.reelIndex,
        }),
      );

    const targetMatchCount = canLeadingWildsReplaceTarget
      ? this.computeContiguousRunForTarget(lineCells, targetSymbolId, context)
      : 0;

    // Determine how many consecutive reels from 0 match `firstSymbolId` as a pure-Wild run
    let pureWildMatchCount = 1;
    for (let r = 1; r < leadingActiveWildCount; r += 1) {
      const symId = lineCells[r].actualSymbolId;
      if (
        symId === firstSymbolId ||
        this.canSubstitute(symId, firstSymbolId, { ...context, reelIndex: r })
      ) {
        pureWildMatchCount += 1;
      } else {
        break;
      }
    }

    const canFormPureWild = firstWildRule.paysOnOwn;

    if (canLeadingWildsReplaceTarget && canFormPureWild) {
      // Both target substitution and pure leading Wild are valid candidates.
      // Compare by paytable multiplier if available; otherwise prefer the longer / target combination
      // unless pure Wild has a strictly higher configured multiplier.
      if (paytableHelper) {
        const targetMult = paytableHelper.getMultiplier(
          targetSymbolId,
          targetMatchCount,
        );
        const wildMult = paytableHelper.getMultiplier(
          firstSymbolId,
          pureWildMatchCount,
        );
        if (wildMult > targetMult && wildMult > 0) {
          if (pureWildMatchCount < validatedCtx.minMatchCount) {
            return null;
          }
          return this.buildResolvedMatch(
            payline,
            lineCells,
            firstSymbolId,
            pureWildMatchCount,
            false,
          );
        }
      }

      if (targetMatchCount < validatedCtx.minMatchCount) {
        return null;
      }
      return this.buildResolvedMatch(
        payline,
        lineCells,
        targetSymbolId,
        targetMatchCount,
        false,
      );
    }

    if (canLeadingWildsReplaceTarget) {
      if (targetMatchCount < validatedCtx.minMatchCount) {
        return null;
      }
      return this.buildResolvedMatch(
        payline,
        lineCells,
        targetSymbolId,
        targetMatchCount,
        false,
      );
    }

    // Leading Wilds CANNOT replace `targetSymbolId` (e.g. targetSymbolId is in excludedSymbolIds).
    if (canFormPureWild) {
      if (pureWildMatchCount < validatedCtx.minMatchCount) {
        return null;
      }
      return this.buildResolvedMatch(
        payline,
        lineCells,
        firstSymbolId,
        pureWildMatchCount,
        false,
      );
    }

    // paysOnOwn === false AND leading Wilds cannot substitute for the following symbol:
    // Wild does not create an independent Wild-only combination.
    return null;
  }

  public resolvePaylineMatch(
    board: Board,
    payline: PaylineDefinition | NormalizedPayline | PaylineInput,
    context?: WildEvaluationContext,
  ): WildResolvedMatch | null {
    return this.resolvePayline(board, payline, context);
  }

  public resolvePaylines(
    board: Board,
    paylinesOrConfig:
      | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
      | GameConfig,
    context?: WildEvaluationContext,
  ): WildPaylineEvaluationResult {
    const paylines: readonly PaylineInput[] = Array.isArray(paylinesOrConfig)
      ? paylinesOrConfig
      : paylinesOrConfig &&
          typeof paylinesOrConfig === "object" &&
          isGameConfig(paylinesOrConfig as GameConfig)
        ? (paylinesOrConfig as GameConfig).paylines
        : (() => {
            throw new MissingPaylineError(
              "Expected an array of PaylineDefinition items or a normalized GameConfig.",
              { paylinesOrConfig },
            );
          })();

    validatePaylinesForBoard(board, paylines);
    validateWildContext(context);

    const matches: WildResolvedMatch[] = [];
    let evaluatedPaylineCount = 0;
    let disabledPaylineCount = 0;

    for (let i = 0; i < paylines.length; i += 1) {
      const payline = paylines[i];
      if (!resolvePaylineEnabled(payline)) {
        disabledPaylineCount += 1;
        continue;
      }

      evaluatedPaylineCount += 1;
      const resolved = this.resolvePayline(board, payline, context);
      if (resolved) {
        matches.push(resolved);
      }
    }

    const winningPaylines = Object.freeze(matches.map((m) => m.paylineId));

    return Object.freeze({
      matches: Object.freeze(matches),
      evaluatedPaylineCount,
      totalPaylineCount: paylines.length,
      disabledPaylineCount,
      winningPaylines,
      totalMatchedLines: matches.length,
    });
  }

  public evaluate(
    board: Board,
    paylinesOrConfig:
      | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
      | GameConfig,
    context?: WildEvaluationContext,
  ): WildPaylineEvaluationResult {
    return this.resolvePaylines(board, paylinesOrConfig, context);
  }
}

export function createWildEngine(source: WildEngineSource): WildEngine {
  return new DeterministicWildEngine(source);
}

/* -------------------------------------------------------------------------- */
/* 5. SERIALIZATION & DESERIALIZATION                                         */
/* -------------------------------------------------------------------------- */

export function serializeWildResolvedMatch(match: WildResolvedMatch): string {
  return JSON.stringify(match);
}

export function deserializeWildResolvedMatch(json: string): WildResolvedMatch {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new InvalidWildConfigurationError(
      `Failed to parse WildResolvedMatch JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidWildConfigurationError(
      "Deserialized WildResolvedMatch must be a non-null object.",
    );
  }

  const m = parsed as Record<string, unknown>;
  if (
    typeof m.paylineId !== "string" ||
    typeof m.baseSymbolId !== "string" ||
    typeof m.matchCount !== "number" ||
    !Array.isArray(m.actualSymbols) ||
    !Array.isArray(m.effectiveSymbols) ||
    !Array.isArray(m.substitutions)
  ) {
    throw new InvalidWildConfigurationError(
      "Malformed WildResolvedMatch fields in serialized JSON.",
    );
  }

  const frozenReels = Array.isArray(m.reelIndexes)
    ? Object.freeze((m.reelIndexes as number[]).map((r) => Number(r)))
    : Object.freeze(
        Array.from({ length: m.matchCount }, (_, idx) => idx),
      );

  const frozenActual = Object.freeze(
    (m.actualSymbols as unknown[]).map((s) => String(s)),
  );
  const frozenEffective = Object.freeze(
    (m.effectiveSymbols as unknown[]).map((s) => String(s)),
  );
  const frozenSubstitutions: WildSubstitutionEntry[] = (
    m.substitutions as Array<Record<string, unknown>>
  ).map((sub) =>
    Object.freeze({
      reelIndex: Number(sub.reelIndex),
      rowIndex: Number(sub.rowIndex),
      actualSymbolId: String(sub.actualSymbolId),
      effectiveSymbolId: String(sub.effectiveSymbolId),
      wildSymbolId: String(sub.wildSymbolId ?? sub.actualSymbolId),
      ...(typeof sub.stopIndex === "number"
        ? { stopIndex: sub.stopIndex }
        : {}),
    }),
  );

  const frozenPositions: WildResolvedCellPosition[] = Array.isArray(
    m.cellPositions,
  )
    ? (m.cellPositions as Array<Record<string, unknown>>).map((cp) =>
        Object.freeze({
          reelIndex: Number(cp.reelIndex),
          rowIndex: Number(cp.rowIndex),
          symbolId: String(cp.symbolId ?? cp.effectiveSymbolId),
          actualSymbolId: String(cp.actualSymbolId),
          effectiveSymbolId: String(cp.effectiveSymbolId),
          isSubstituted: Boolean(cp.isSubstituted),
          ...(typeof cp.stopIndex === "number"
            ? { stopIndex: cp.stopIndex }
            : {}),
        }),
      )
    : [];

  const frozenStops = Array.isArray(m.matchedStopIndexes)
    ? Object.freeze((m.matchedStopIndexes as number[]).map((s) => Number(s)))
    : Object.freeze([]);
  const frozenPattern = Array.isArray(m.pattern)
    ? Object.freeze((m.pattern as number[]).map((p) => Number(p)))
    : Object.freeze([]);

  const paylineIndex =
    typeof m.paylineIndex === "number" ? m.paylineIndex : 1;

  return Object.freeze({
    paylineId: m.paylineId,
    paylineIndex,
    paylineName:
      typeof m.paylineName === "string"
        ? m.paylineName
        : `Line ${paylineIndex}`,
    pattern: frozenPattern,
    ...(typeof m.color === "string" ? { color: m.color } : {}),
    symbolId: typeof m.symbolId === "string" ? m.symbolId : m.baseSymbolId,
    baseSymbolId: m.baseSymbolId,
    matchCount: m.matchCount,
    reelIndexes: frozenReels,
    matchedReels: frozenReels,
    actualSymbols: frozenActual,
    effectiveSymbols: frozenEffective,
    substitutions: Object.freeze(frozenSubstitutions),
    wildCount:
      typeof m.wildCount === "number"
        ? m.wildCount
        : frozenSubstitutions.length,
    isAllWild: Boolean(m.isAllWild),
    cellPositions: Object.freeze(frozenPositions),
    matchedStopIndexes: frozenStops,
  });
}

export function serializeWildPaylineEvaluationResult(
  result: WildPaylineEvaluationResult,
): string {
  return JSON.stringify(result);
}

export function deserializeWildPaylineEvaluationResult(
  json: string,
): WildPaylineEvaluationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new InvalidPaylineError(
      `Failed to parse WildPaylineEvaluationResult JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidWildConfigurationError(
      "Deserialized WildPaylineEvaluationResult must be a non-null object.",
    );
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    !Array.isArray(candidate.matches) ||
    typeof candidate.evaluatedPaylineCount !== "number"
  ) {
    throw new InvalidWildConfigurationError(
      "Malformed WildPaylineEvaluationResult fields in serialized JSON.",
    );
  }

  const frozenMatches = Object.freeze(
    candidate.matches.map((raw) =>
      deserializeWildResolvedMatch(JSON.stringify(raw)),
    ),
  );
  const winningPaylines = Array.isArray(candidate.winningPaylines)
    ? Object.freeze(candidate.winningPaylines.map((id) => String(id)))
    : Object.freeze(frozenMatches.map((m) => m.paylineId));

  const totalPaylineCount =
    typeof candidate.totalPaylineCount === "number"
      ? candidate.totalPaylineCount
      : candidate.evaluatedPaylineCount;
  const disabledPaylineCount =
    typeof candidate.disabledPaylineCount === "number"
      ? candidate.disabledPaylineCount
      : Math.max(0, totalPaylineCount - candidate.evaluatedPaylineCount);

  return Object.freeze({
    matches: frozenMatches,
    evaluatedPaylineCount: candidate.evaluatedPaylineCount,
    totalPaylineCount,
    disabledPaylineCount,
    winningPaylines,
    totalMatchedLines: frozenMatches.length,
  });
}
