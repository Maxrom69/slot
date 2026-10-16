/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B11 — Pay-Anywhere Engine
 *
 * Pure, deterministic board-wide symbol counting engine.
 * Consumes an authoritative B04 Board and B02 PayAnywhereConfiguration,
 * performs a single-pass board scan to count qualifying symbol occurrences
 * anywhere on the board (independent of paylines, consecutive reels, or
 * spatial adjacency), integrates with B07 Wild substitution and B02 Symbol
 * Families when explicitly configured, resolves configured B06 paytable count
 * tiers, and returns an immutable, JSON-serializable PayAnywhereEvaluationResult.
 *
 * Zero RNG dependencies. Zero Payline (B05), Ways (B09), Cluster (B10), or
 * Scatter (B08) dependencies. Zero browser/UI dependencies.
 */

import type { Board, Cell } from "../board";
import {
  type GameConfig,
  type NormalizedSymbolDefinition,
  isGameConfig,
} from "../config";
import {
  InvalidBetError,
  InvalidBoardError,
  InvalidPayAnywhereConfigurationError,
  InvalidPaytableReferenceError,
  SlotEngineError,
  UnknownPayAnywhereSymbolError,
} from "../errors";
import {
  type PaytableEngine,
  type PaytableSource,
  type PayoutContext,
  normalizePaytableLookup,
  roundCurrency,
} from "../paytable";
import type {
  CanonicalSymbolDefinition,
  GameDefinition,
  PayAnywhereConfiguration,
  PayAnywhereSymbolRule,
  SymbolFamilyDefinition,
} from "../schema/types";
import {
  type WildEngine,
  type WildEngineSource,
  createWildEngine,
} from "../wilds";

/* -------------------------------------------------------------------------- */
/* PUBLIC TYPES & CONTRACTS                                                   */
/* -------------------------------------------------------------------------- */

export type { PayAnywhereConfiguration, PayAnywhereSymbolRule };

export interface PayAnywhereSymbolInfo {
  readonly id: string;
  readonly isWild?: boolean;
  readonly isScatter?: boolean;
  readonly isBonus?: boolean;
  readonly familyId?: string | null;
}

export type PayAnywhereSymbolRegistrySource =
  | GameConfig
  | GameDefinition
  | ReadonlyMap<
      string,
      | PayAnywhereSymbolInfo
      | NormalizedSymbolDefinition
      | CanonicalSymbolDefinition
    >
  | Readonly<
      Record<
        string,
        | PayAnywhereSymbolInfo
        | NormalizedSymbolDefinition
        | CanonicalSymbolDefinition
      >
    >
  | readonly (
      | PayAnywhereSymbolInfo
      | NormalizedSymbolDefinition
      | CanonicalSymbolDefinition
    )[];

export interface PayAnywhereFamilyEntry {
  readonly id: string;
  readonly name?: string;
  readonly label?: string;
  readonly memberIds: readonly string[];
}

export type PayAnywhereFamilySource =
  | readonly (SymbolFamilyDefinition | PayAnywhereFamilyEntry)[]
  | ReadonlyMap<string, readonly string[]>
  | Readonly<Record<string, readonly string[]>>;

export type PayAnywherePaytableOption =
  | PaytableSource
  | PaytableEngine
  | Readonly<Record<string, Readonly<Record<number, number>>>>;

export interface PayAnywhereConfigInput {
  readonly enabled?: boolean;
  readonly minimumMatchCount?: number;
  readonly eligibleSymbols?: readonly string[];
  readonly symbolRules?: readonly PayAnywhereSymbolRule[];
  readonly allowWildSubstitution?: boolean;
  readonly allowFamilyGrouping?: boolean;
  readonly includeNonQualifying?: boolean;
}

export interface NormalizedPayAnywhereSymbolRule {
  readonly symbolId: string;
  readonly minCount: number;
  readonly maxCount?: number;
}

export interface NormalizedPayAnywhereConfiguration {
  readonly enabled: boolean;
  readonly minimumMatchCount: number;
  readonly eligibleSymbols: readonly string[];
  readonly symbolRulesBySymbolId: ReadonlyMap<
    string,
    NormalizedPayAnywhereSymbolRule
  >;
  readonly allowWildSubstitution: boolean;
  readonly allowFamilyGrouping: boolean;
  readonly includeNonQualifying: boolean;
}

export interface PayAnywhereMatchedCell {
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly symbolId: string;
  readonly actualSymbolId: string;
  readonly effectiveSymbolId: string;
  readonly isWild: boolean;
  readonly stopIndex?: number;
}

export interface PayAnywhereWin {
  readonly symbolId: string;
  readonly familyId?: string;
  readonly count: number;
  readonly eligible: boolean;
  readonly qualifying: boolean;
  readonly minimumCount: number;
  readonly matchedTierCount: number | null;
  readonly baseMultiplier: number;
  readonly effectiveMultiplier: number;
  readonly finalPayout?: number;
  readonly totalPayout?: number;
  readonly wildCount: number;
  readonly naturalCount: number;
  readonly matchedCells: readonly PayAnywhereMatchedCell[];
}

export interface PayAnywhereEvaluationResult {
  readonly evaluationMode: "payAnywhere";
  readonly enabled: boolean;
  readonly wins: readonly PayAnywhereWin[];
  readonly evaluatedSymbols: readonly PayAnywhereWin[];
  readonly bySymbolId: Readonly<Record<string, PayAnywhereWin>>;
  readonly evaluatedSymbolCount: number;
  readonly qualifyingWinCount: number;
  readonly totalBaseMultiplier: number;
  readonly totalEffectiveMultiplier: number;
  readonly totalPayout?: number;
}

export interface PayAnywhereEvaluationOptions {
  readonly symbolRegistry?: PayAnywhereSymbolRegistrySource | null;
  readonly wildEngine?: WildEngine | WildEngineSource | null;
  readonly paytable?: PayAnywherePaytableOption | null;
  readonly payoutContext?: PayoutContext | number;
  readonly families?: PayAnywhereFamilySource | null;
  readonly includeNonQualifying?: boolean;
}

export interface PayAnywhereEngine {
  evaluate(
    board: Board,
    config?:
      | PayAnywhereConfigInput
      | PayAnywhereConfiguration
      | GameConfig
      | GameDefinition,
    options?: PayAnywhereEvaluationOptions,
  ): PayAnywhereEvaluationResult;

  evaluateSymbol(
    board: Board,
    symbolId: string,
    config?:
      | PayAnywhereConfigInput
      | PayAnywhereConfiguration
      | GameConfig
      | GameDefinition,
    options?: PayAnywhereEvaluationOptions,
  ): PayAnywhereWin;
}

/* -------------------------------------------------------------------------- */
/* BOARD & CONFIGURATION VALIDATION                                           */
/* -------------------------------------------------------------------------- */

function getBoardColumns(
  board: Board,
): readonly (readonly Cell[])[] | undefined {
  if (!board || typeof board !== "object") {
    return undefined;
  }
  if (Array.isArray(board.cells)) {
    return board.cells;
  }
  const legacyReels = (
    board as unknown as { reels?: readonly (readonly Cell[])[] }
  ).reels;
  if (Array.isArray(legacyReels)) {
    return legacyReels;
  }
  return undefined;
}

/**
 * Validates the authoritative B04 Board before Pay-Anywhere evaluation.
 */
export function validateBoardForPayAnywhere(board: Board): void {
  if (!board || typeof board !== "object") {
    throw new InvalidBoardError("Board must be a non-null object.", {
      board: String(board),
    });
  }

  const columnsMatrix = getBoardColumns(board);
  if (!Array.isArray(columnsMatrix)) {
    throw new InvalidBoardError(
      "Board.cells must be an array of reel columns.",
      {
        cells: String((board as unknown as Record<string, unknown>).cells),
      },
    );
  }

  const reelCount =
    typeof board.reelCount === "number" ? board.reelCount : board.columns;

  if (
    typeof reelCount !== "number" ||
    !Number.isInteger(reelCount) ||
    reelCount < 1 ||
    columnsMatrix.length !== reelCount
  ) {
    throw new InvalidBoardError(
      `Board.reelCount (${String(reelCount)}) must be a positive integer matching board.cells.length (${columnsMatrix.length}).`,
      {
        reelCount,
        reelsLength: columnsMatrix.length,
      },
    );
  }

  for (let reelIndex = 0; reelIndex < columnsMatrix.length; reelIndex++) {
    const column = columnsMatrix[reelIndex];
    if (!Array.isArray(column) || column.length < 1) {
      throw new InvalidBoardError(
        `Board reel column at index ${reelIndex} must be a non-empty array of cells.`,
        { reelIndex },
      );
    }

    for (let rowIndex = 0; rowIndex < column.length; rowIndex++) {
      const cell = column[rowIndex];
      if (!cell || typeof cell !== "object") {
        throw new InvalidBoardError(
          `Board cell at (${reelIndex}, ${rowIndex}) must be an object.`,
          { reelIndex, rowIndex },
        );
      }
      if (cell.reelIndex !== reelIndex || cell.rowIndex !== rowIndex) {
        throw new InvalidBoardError(
          `Board cell coordinate mismatch at (${reelIndex}, ${rowIndex}): found (${String(cell.reelIndex)}, ${String(cell.rowIndex)}).`,
          {
            expectedReelIndex: reelIndex,
            expectedRowIndex: rowIndex,
            actualReelIndex: cell.reelIndex,
            actualRowIndex: cell.rowIndex,
          },
        );
      }
      const symbolId =
        typeof cell.symbolId === "string"
          ? cell.symbolId
          : cell.symbol?.symbolId;
      if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
        throw new InvalidBoardError(
          `Board cell at (${reelIndex}, ${rowIndex}) must have a non-empty string symbolId.`,
          { reelIndex, rowIndex, symbolId },
        );
      }
    }
  }
}

interface NormalizedSymbolInfo {
  readonly id: string;
  readonly isWild: boolean;
  readonly isScatter: boolean;
  readonly isBonus: boolean;
  readonly familyId: string | null;
}

function extractSymbolInfo(
  raw:
    | PayAnywhereSymbolInfo
    | NormalizedSymbolDefinition
    | CanonicalSymbolDefinition,
): NormalizedSymbolInfo {
  if (
    !raw ||
    typeof raw !== "object" ||
    typeof raw.id !== "string" ||
    !raw.id.trim()
  ) {
    throw new UnknownPayAnywhereSymbolError(
      "Symbol definition in registry must have a non-empty string id.",
      { symbol: raw },
    );
  }

  if ("role" in raw && raw.role && typeof raw.role === "object") {
    const r = raw.role as NormalizedSymbolDefinition["role"];
    return Object.freeze({
      id: raw.id,
      isWild: Boolean(r.isWild),
      isScatter: Boolean(r.isScatter),
      isBonus: Boolean(r.isBonus),
      familyId: raw.familyId ?? null,
    });
  }

  if ("roles" in raw && Array.isArray(raw.roles)) {
    const symDef = raw as CanonicalSymbolDefinition;
    return Object.freeze({
      id: raw.id,
      isWild: symDef.roles.includes("wild"),
      isScatter: symDef.roles.includes("scatter"),
      isBonus: symDef.roles.includes("bonus"),
      familyId: symDef.familyId ?? null,
    });
  }

  const info = raw as PayAnywhereSymbolInfo;
  return Object.freeze({
    id: info.id,
    isWild: Boolean(info.isWild),
    isScatter: Boolean(info.isScatter),
    isBonus: Boolean(info.isBonus),
    familyId: info.familyId ?? null,
  });
}

function normalizeSymbolRegistry(
  source: PayAnywhereSymbolRegistrySource | undefined | null,
): ReadonlyMap<string, NormalizedSymbolInfo> | null {
  if (!source) {
    return null;
  }

  const map = new Map<string, NormalizedSymbolInfo>();

  if (isGameConfig(source as GameConfig)) {
    const gc = source as GameConfig;
    for (const [id, sym] of gc.symbolsById.entries()) {
      map.set(id, extractSymbolInfo(sym));
    }
    if (gc.variantsById) {
      for (const [id, sym] of gc.variantsById.entries()) {
        if (!map.has(id)) {
          map.set(id, extractSymbolInfo(sym));
        }
      }
    }
    return map;
  }

  if (source instanceof Map) {
    for (const [id, raw] of source.entries()) {
      map.set(id, extractSymbolInfo(raw));
    }
    return map;
  }

  if (Array.isArray(source)) {
    for (const raw of source) {
      const normalized = extractSymbolInfo(raw);
      map.set(normalized.id, normalized);
    }
    return map;
  }

  if (
    "canonicalSymbols" in source &&
    Array.isArray((source as GameDefinition).canonicalSymbols)
  ) {
    for (const sym of (source as GameDefinition).canonicalSymbols) {
      const normalized = extractSymbolInfo(sym);
      map.set(normalized.id, normalized);
    }
    return map;
  }

  if (typeof source === "object") {
    for (const [key, raw] of Object.entries(
      source as Record<
        string,
        | PayAnywhereSymbolInfo
        | NormalizedSymbolDefinition
        | CanonicalSymbolDefinition
      >,
    )) {
      map.set(key, extractSymbolInfo(raw));
    }
    return map;
  }

  return null;
}

/**
 * Validates and normalizes PayAnywhereConfiguration from a config input,
 * GameConfig, or GameDefinition.
 */
export function normalizePayAnywhereConfiguration(
  source:
    | PayAnywhereConfigInput
    | PayAnywhereConfiguration
    | GameConfig
    | GameDefinition
    | undefined
    | null,
  symbolRegistry?: ReadonlyMap<string, NormalizedSymbolInfo> | null,
): NormalizedPayAnywhereConfiguration {
  if (!source || typeof source !== "object") {
    throw new InvalidPayAnywhereConfigurationError(
      "Pay-Anywhere configuration source must be a non-null object.",
      { source: String(source) },
    );
  }

  let rawConfig: PayAnywhereConfigInput;
  let fallbackRegularSymbolIds: string[] | null = null;

  if (isGameConfig(source as GameConfig)) {
    const gc = source as GameConfig;
    fallbackRegularSymbolIds = gc.symbols
      .filter((s) => !s.role.isWild && !s.role.isScatter && !s.role.isBonus)
      .map((s) => s.id);
    if (gc.payAnywhereConfiguration) {
      rawConfig = gc.payAnywhereConfiguration;
    } else {
      rawConfig = {
        enabled: (gc.grid.evaluationMode as string) === "payAnywhere",
        minimumMatchCount: 3,
        eligibleSymbols: fallbackRegularSymbolIds,
        allowWildSubstitution: false,
        allowFamilyGrouping: false,
      };
    }
  } else if (
    "payAnywhereConfiguration" in source &&
    source.payAnywhereConfiguration &&
    typeof source.payAnywhereConfiguration === "object"
  ) {
    const gd = source as GameDefinition;
    if (Array.isArray(gd.canonicalSymbols)) {
      fallbackRegularSymbolIds = gd.canonicalSymbols
        .filter(
          (s) =>
            !s.roles.includes("wild") &&
            !s.roles.includes("scatter") &&
            !s.roles.includes("bonus"),
        )
        .map((s) => s.id);
    }
    rawConfig = gd.payAnywhereConfiguration;
  } else {
    rawConfig = source as PayAnywhereConfigInput;
  }

  const enabled =
    rawConfig.enabled === undefined ? true : Boolean(rawConfig.enabled);

  const minimumMatchCount = rawConfig.minimumMatchCount ?? 3;
  if (
    typeof minimumMatchCount !== "number" ||
    !Number.isInteger(minimumMatchCount) ||
    minimumMatchCount < 1
  ) {
    throw new InvalidPayAnywhereConfigurationError(
      `minimumMatchCount must be a positive integer >= 1, received ${String(minimumMatchCount)}.`,
      { minimumMatchCount },
    );
  }

  const symbolRulesBySymbolId = new Map<
    string,
    NormalizedPayAnywhereSymbolRule
  >();
  const orderedEligibleSymbolIds: string[] = [];
  const seenEligible = new Set<string>();

  const addEligibleSymbol = (symId: string) => {
    if (typeof symId !== "string" || symId.trim().length === 0) {
      throw new UnknownPayAnywhereSymbolError(
        "Pay-Anywhere eligible symbol ID must be a non-empty string.",
        { symbolId: symId },
      );
    }
    if (symbolRegistry && !symbolRegistry.has(symId)) {
      throw new UnknownPayAnywhereSymbolError(
        `Pay-Anywhere configuration references unknown symbol "${symId}".`,
        { symbolId: symId },
      );
    }
    if (!seenEligible.has(symId)) {
      seenEligible.add(symId);
      orderedEligibleSymbolIds.push(symId);
    }
  };

  if (rawConfig.eligibleSymbols !== undefined) {
    if (!Array.isArray(rawConfig.eligibleSymbols)) {
      throw new InvalidPayAnywhereConfigurationError(
        "eligibleSymbols must be an array of symbol IDs.",
        { eligibleSymbols: rawConfig.eligibleSymbols },
      );
    }
    for (const symId of rawConfig.eligibleSymbols) {
      addEligibleSymbol(symId);
    }
  }

  if (rawConfig.symbolRules !== undefined) {
    if (!Array.isArray(rawConfig.symbolRules)) {
      throw new InvalidPayAnywhereConfigurationError(
        "symbolRules must be an array of PayAnywhereSymbolRule objects.",
        { symbolRules: rawConfig.symbolRules },
      );
    }
    for (const rule of rawConfig.symbolRules) {
      if (!rule || typeof rule !== "object") {
        throw new InvalidPayAnywhereConfigurationError(
          "Each entry in symbolRules must be an object.",
          { rule },
        );
      }
      addEligibleSymbol(rule.symbolId);
      if (
        typeof rule.minCount !== "number" ||
        !Number.isInteger(rule.minCount) ||
        rule.minCount < 1
      ) {
        throw new InvalidPayAnywhereConfigurationError(
          `symbolRules entry for "${rule.symbolId}" must have an integer minCount >= 1, received ${String(rule.minCount)}.`,
          { rule },
        );
      }
      if (
        rule.maxCount !== undefined &&
        (typeof rule.maxCount !== "number" ||
          !Number.isInteger(rule.maxCount) ||
          rule.maxCount < rule.minCount)
      ) {
        throw new InvalidPayAnywhereConfigurationError(
          `symbolRules entry for "${rule.symbolId}" has invalid maxCount (${String(rule.maxCount)}).`,
          { rule },
        );
      }
      symbolRulesBySymbolId.set(
        rule.symbolId,
        Object.freeze({
          symbolId: rule.symbolId,
          minCount: rule.minCount,
          ...(rule.maxCount !== undefined ? { maxCount: rule.maxCount } : {}),
        }),
      );
    }
  }

  // When normalized from a GameConfig/GameDefinition whose payAnywhereConfiguration
  // had no explicit eligibleSymbols or symbolRules yet, fall back to regular symbols
  if (
    orderedEligibleSymbolIds.length === 0 &&
    rawConfig.eligibleSymbols === undefined &&
    fallbackRegularSymbolIds &&
    fallbackRegularSymbolIds.length > 0
  ) {
    for (const symId of fallbackRegularSymbolIds) {
      addEligibleSymbol(symId);
    }
  }

  return Object.freeze({
    enabled,
    minimumMatchCount,
    eligibleSymbols: Object.freeze(orderedEligibleSymbolIds),
    symbolRulesBySymbolId,
    allowWildSubstitution: Boolean(rawConfig.allowWildSubstitution),
    allowFamilyGrouping: Boolean(rawConfig.allowFamilyGrouping),
    includeNonQualifying: Boolean(rawConfig.includeNonQualifying),
  });
}

/* -------------------------------------------------------------------------- */
/* FAMILY & PAYTABLE HELPERS                                                  */
/* -------------------------------------------------------------------------- */

interface NormalizedFamilyInfo {
  readonly familyMembersByFamilyId: ReadonlyMap<string, readonly string[]>;
  readonly familyIdBySymbolId: ReadonlyMap<string, string>;
}

function buildFamilyLookup(
  symbolRegistry: ReadonlyMap<string, NormalizedSymbolInfo> | null,
  familySource: PayAnywhereFamilySource | undefined | null,
  configSource?: unknown,
): NormalizedFamilyInfo {
  const membersByFamily = new Map<string, Set<string>>();
  const symbolToFamily = new Map<string, string>();

  const addMember = (familyId: string, symbolId: string) => {
    if (!familyId || typeof familyId !== "string" || !familyId.trim()) {
      throw new InvalidPayAnywhereConfigurationError(
        "Symbol family ID must be a non-empty string.",
        { familyId, symbolId },
      );
    }
    if (!symbolId || typeof symbolId !== "string" || !symbolId.trim()) {
      throw new UnknownPayAnywhereSymbolError(
        `Symbol family "${familyId}" contains an invalid symbol ID.`,
        { familyId, symbolId },
      );
    }
    if (symbolRegistry && !symbolRegistry.has(symbolId)) {
      throw new UnknownPayAnywhereSymbolError(
        `Symbol family "${familyId}" references unknown symbol "${symbolId}".`,
        { familyId, symbolId },
      );
    }
    symbolToFamily.set(symbolId, familyId);
    let set = membersByFamily.get(familyId);
    if (!set) {
      set = new Set<string>();
      membersByFamily.set(familyId, set);
    }
    set.add(symbolId);
  };

  if (symbolRegistry) {
    for (const sym of symbolRegistry.values()) {
      if (sym.familyId) {
        addMember(sym.familyId, sym.id);
      }
    }
  }

  if (configSource && typeof configSource === "object") {
    if (isGameConfig(configSource as GameConfig)) {
      const gc = configSource as GameConfig;
      if (gc.symbolFamiliesById) {
        for (const [famId, memberIds] of gc.symbolFamiliesById.entries()) {
          for (const mId of memberIds) {
            addMember(famId, mId);
          }
        }
      }
    } else if (
      "symbolFamilies" in configSource &&
      Array.isArray((configSource as GameDefinition).symbolFamilies)
    ) {
      for (const fam of (configSource as GameDefinition).symbolFamilies ?? []) {
        for (const mId of fam.memberIds ?? []) {
          addMember(fam.id, mId);
        }
      }
    }
  }

  if (familySource) {
    if (familySource instanceof Map) {
      for (const [famId, memberIds] of familySource.entries()) {
        for (const mId of memberIds) {
          addMember(famId, mId);
        }
      }
    } else if (Array.isArray(familySource)) {
      for (const fam of familySource) {
        const members =
          "memberIds" in fam
            ? fam.memberIds
            : (fam as unknown as { symbolIds?: readonly string[] }).symbolIds ??
              [];
        for (const mId of members) {
          addMember(fam.id, mId);
        }
      }
    } else if (typeof familySource === "object") {
      for (const [famId, memberIds] of Object.entries(
        familySource as Record<string, readonly string[]>,
      )) {
        for (const mId of memberIds) {
          addMember(famId, mId);
        }
      }
    }
  }

  const frozenMembers = new Map<string, readonly string[]>();
  for (const [famId, set] of membersByFamily.entries()) {
    frozenMembers.set(
      famId,
      Object.freeze(Array.from(set).sort((a, b) => a.localeCompare(b))),
    );
  }

  return {
    familyMembersByFamilyId: frozenMembers,
    familyIdBySymbolId: symbolToFamily,
  };
}

function resolveTierMultiplier(
  paytableLookup: ReadonlyMap<string, ReadonlyMap<number, number>> | null,
  paytableEngineInstance: PaytableEngine | null,
  symbolId: string,
  count: number,
  minRequiredCount: number,
  maxAllowedCount?: number,
): { matchedTierCount: number | null; baseMultiplier: number } {
  if (count < minRequiredCount) {
    return { matchedTierCount: null, baseMultiplier: 0 };
  }

  const effectiveCount =
    maxAllowedCount !== undefined ? Math.min(count, maxAllowedCount) : count;

  if (paytableLookup) {
    const byCount = paytableLookup.get(symbolId);
    if (!byCount || byCount.size === 0) {
      return { matchedTierCount: null, baseMultiplier: 0 };
    }
    const exact = byCount.get(effectiveCount);
    if (exact !== undefined && exact > 0) {
      return { matchedTierCount: effectiveCount, baseMultiplier: exact };
    }
    // Check highest configured tier <= effectiveCount and >= minRequiredCount
    let bestTier = -1;
    let bestMult = 0;
    for (const [tierCount, mult] of byCount.entries()) {
      if (
        tierCount >= minRequiredCount &&
        tierCount <= effectiveCount &&
        tierCount > bestTier &&
        mult > 0
      ) {
        bestTier = tierCount;
        bestMult = mult;
      }
    }
    if (bestTier > 0) {
      return { matchedTierCount: bestTier, baseMultiplier: bestMult };
    }
    return { matchedTierCount: null, baseMultiplier: 0 };
  }

  if (paytableEngineInstance) {
    if (!paytableEngineInstance.hasSymbol(symbolId)) {
      return { matchedTierCount: null, baseMultiplier: 0 };
    }
    // Try exact count first, then step down to minRequiredCount if over-cap
    for (let c = effectiveCount; c >= minRequiredCount; c--) {
      const mult = paytableEngineInstance.getMultiplier(symbolId, c);
      if (mult > 0) {
        return { matchedTierCount: c, baseMultiplier: mult };
      }
    }
    return { matchedTierCount: null, baseMultiplier: 0 };
  }

  // If no paytable was provided, qualify purely on count >= minRequiredCount
  return {
    matchedTierCount: effectiveCount,
    baseMultiplier: 0,
  };
}

function validateBetContext(
  payoutContext: PayoutContext | number | undefined,
): number | null {
  if (payoutContext === undefined) {
    return null;
  }
  const bet =
    typeof payoutContext === "number" ? payoutContext : payoutContext.bet;
  if (typeof bet !== "number" || !Number.isFinite(bet) || bet <= 0) {
    throw new InvalidBetError(
      `Invalid bet (${String(bet)}) in PayAnywhereEngine payoutContext; expected a finite positive number.`,
      { bet },
    );
  }
  return bet;
}

/* -------------------------------------------------------------------------- */
/* CORE PAY-ANYWHERE EVALUATION                                               */
/* -------------------------------------------------------------------------- */

/**
 * Evaluates Pay-Anywhere counts and payouts across the entire B04 Board in a single pass.
 */
export function evaluatePayAnywhere(
  board: Board,
  configInput?:
    | PayAnywhereConfigInput
    | PayAnywhereConfiguration
    | GameConfig
    | GameDefinition,
  options: PayAnywhereEvaluationOptions = {},
): PayAnywhereEvaluationResult {
  validateBoardForPayAnywhere(board);
  const boardColumns = getBoardColumns(board)!;

  const bet = validateBetContext(options.payoutContext);

  // Extract symbol registry if provided
  const symbolRegistry = normalizeSymbolRegistry(
    options.symbolRegistry !== undefined
      ? options.symbolRegistry
      : isGameConfig(configInput as GameConfig) ||
          (configInput &&
            typeof configInput === "object" &&
            "canonicalSymbols" in configInput)
        ? (configInput as GameConfig | GameDefinition)
        : null,
  );

  // Resolve Paytable lookup (B06) first so we can also know paytable symbols if needed
  let paytableLookup: ReadonlyMap<string, ReadonlyMap<number, number>> | null =
    null;
  let paytableEngineInstance: PaytableEngine | null = null;
  const rawPaytableSource =
    options.paytable !== undefined
      ? options.paytable
      : isGameConfig(configInput as GameConfig)
        ? (configInput as GameConfig)
        : configInput &&
            typeof configInput === "object" &&
            "paytableDefinition" in configInput &&
            (configInput as GameDefinition).paytableDefinition
          ? (configInput as GameDefinition).paytableDefinition
          : null;

  if (rawPaytableSource !== null && rawPaytableSource !== undefined) {
    if (
      typeof (rawPaytableSource as PaytableEngine).getMultiplier ===
        "function" &&
      typeof (rawPaytableSource as PaytableEngine).hasSymbol === "function"
    ) {
      paytableEngineInstance = rawPaytableSource as PaytableEngine;
    } else if (
      typeof rawPaytableSource === "object" &&
      !Array.isArray(rawPaytableSource) &&
      !isGameConfig(rawPaytableSource as GameConfig) &&
      !("entries" in rawPaytableSource) &&
      !("bySymbolId" in rawPaytableSource)
    ) {
      const map = new Map<string, ReadonlyMap<number, number>>();
      for (const [symId, ladderObj] of Object.entries(
        rawPaytableSource as Record<string, Record<number, number>>,
      )) {
        if (!ladderObj || typeof ladderObj !== "object") {
          throw new InvalidPaytableReferenceError(
            `Invalid paytable ladder for symbol "${symId}" in PayAnywhereEngine.`,
            { symbolId: symId },
          );
        }
        const inner = new Map<number, number>();
        for (const [cntStr, mult] of Object.entries(ladderObj)) {
          const cnt = Number(cntStr);
          if (
            !Number.isInteger(cnt) ||
            cnt < 1 ||
            typeof mult !== "number" ||
            !Number.isFinite(mult) ||
            mult < 0
          ) {
            throw new InvalidPaytableReferenceError(
              `Invalid paytable tier (${cntStr} -> ${String(mult)}) for symbol "${symId}".`,
              { symbolId: symId, matchCount: cntStr, multiplier: mult },
            );
          }
          inner.set(cnt, mult);
        }
        map.set(symId, inner);
      }
      paytableLookup = map;
    } else {
      try {
        const normalizedPt = normalizePaytableLookup(
          rawPaytableSource as PaytableSource,
        );
        paytableLookup = normalizedPt.bySymbolId;
      } catch (err) {
        if (err instanceof SlotEngineError) {
          throw new InvalidPaytableReferenceError(
            `Invalid paytable reference in PayAnywhereEngine: ${err.message}`,
            { originalCode: err.code, ...err.context },
          );
        }
        throw new InvalidPaytableReferenceError(
          err instanceof Error
            ? err.message
            : "Invalid paytable source for PayAnywhereEngine.",
          { cause: String(err) },
        );
      }
    }
  }

  const normalizedConfig = normalizePayAnywhereConfiguration(
    configInput ?? {
      enabled: true,
      minimumMatchCount: 3,
      eligibleSymbols: paytableLookup
        ? Array.from(paytableLookup.keys())
        : [],
    },
    symbolRegistry,
  );

  // If symbolRegistry was not explicitly passed, but paytableLookup is present,
  // also verify that every configured eligibleSymbol exists in paytableLookup or familyRegistry
  const familyLookup = buildFamilyLookup(
    symbolRegistry,
    options.families,
    configInput,
  );

  if (!symbolRegistry && paytableLookup) {
    for (const symId of normalizedConfig.eligibleSymbols) {
      const isKnownInPaytable = paytableLookup.has(symId);
      const isKnownFamily =
        normalizedConfig.allowFamilyGrouping &&
        (familyLookup.familyMembersByFamilyId.has(symId) ||
          familyLookup.familyIdBySymbolId.has(symId));
      if (!isKnownInPaytable && !isKnownFamily) {
        throw new UnknownPayAnywhereSymbolError(
          `Pay-Anywhere eligible symbol "${symId}" is not present in the configured paytable or symbol registry.`,
          { symbolId: symId },
        );
      }
    }
  }

  // Validate board symbols against symbolRegistry when provided
  if (symbolRegistry) {
    for (let c = 0; c < boardColumns.length; c++) {
      const col = boardColumns[c]!;
      for (let r = 0; r < col.length; r++) {
        const cell = col[r]!;
        const symbolId =
          typeof cell.symbolId === "string"
            ? cell.symbolId
            : cell.symbol?.symbolId;
        if (!symbolRegistry.has(symbolId)) {
          throw new UnknownPayAnywhereSymbolError(
            `Board cell at (${c}, ${r}) references unknown symbol "${symbolId}".`,
            { reelIndex: c, rowIndex: r, symbolId },
          );
        }
      }
    }
  }

  // Early return when Pay-Anywhere engine is disabled
  if (!normalizedConfig.enabled) {
    return Object.freeze({
      evaluationMode: "payAnywhere",
      enabled: false,
      wins: Object.freeze([]),
      evaluatedSymbols: Object.freeze([]),
      bySymbolId: Object.freeze({}),
      evaluatedSymbolCount: 0,
      qualifyingWinCount: 0,
      totalBaseMultiplier: 0,
      totalEffectiveMultiplier: 0,
      ...(bet !== null ? { totalPayout: 0 } : {}),
    });
  }

  // Resolve B07 WildEngine when allowWildSubstitution is enabled
  let wildEngine: WildEngine | null = null;
  if (normalizedConfig.allowWildSubstitution) {
    if (options.wildEngine !== undefined && options.wildEngine !== null) {
      if (
        typeof (options.wildEngine as WildEngine).canSubstitute ===
          "function" &&
        typeof (options.wildEngine as WildEngine).isWild === "function"
      ) {
        wildEngine = options.wildEngine as WildEngine;
      } else {
        wildEngine = createWildEngine(options.wildEngine as WildEngineSource);
      }
    } else if (isGameConfig(configInput as GameConfig)) {
      const gc = configInput as GameConfig;
      if (
        gc.wildConfiguration
          ? gc.wildConfiguration.enabled
          : gc.wildSymbolIds.size > 0
      ) {
        wildEngine = createWildEngine(gc);
      }
    } else if (
      configInput &&
      typeof configInput === "object" &&
      "wildConfiguration" in configInput &&
      (configInput as GameDefinition).wildConfiguration
    ) {
      const gd = configInput as GameDefinition;
      if (gd.wildConfiguration) {
        wildEngine = createWildEngine(gd.wildConfiguration);
      }
    }
  }

  const isCellWild = (symbolId: string): boolean => {
    if (wildEngine) {
      try {
        if (wildEngine.isWild(symbolId)) {
          return true;
        }
      } catch {
        // Fallback to symbolRegistry
      }
    }
    return Boolean(symbolRegistry?.get(symbolId)?.isWild);
  };

  // ONE-PASS BOARD SCAN: O(totalBoardCells)
  // Build map: symbolId -> Cell[] and collect wildCells in a single traversal
  const cellsBySymbolId = new Map<string, Cell[]>();
  const wildCellsOnBoard: Cell[] = [];

  for (let reelIndex = 0; reelIndex < boardColumns.length; reelIndex++) {
    const col = boardColumns[reelIndex]!;
    for (let rowIndex = 0; rowIndex < col.length; rowIndex++) {
      const cell = col[rowIndex]!;
      const actualId =
        typeof cell.symbolId === "string"
          ? cell.symbolId
          : cell.symbol.symbolId;

      let bucket = cellsBySymbolId.get(actualId);
      if (!bucket) {
        bucket = [];
        cellsBySymbolId.set(actualId, bucket);
      }
      bucket.push(cell);

      if (normalizedConfig.allowWildSubstitution && isCellWild(actualId)) {
        wildCellsOnBoard.push(cell);
      }
    }
  }

  const evaluatedSymbols: PayAnywhereWin[] = [];
  const qualifyingWins: PayAnywhereWin[] = [];
  const bySymbolIdRecord: Record<string, PayAnywhereWin> = {};
  const evaluatedTargetKeys = new Set<string>();

  for (const configuredSymbolId of normalizedConfig.eligibleSymbols) {
    // Determine if this symbol participates in a configured B02 family
    const familyId = normalizedConfig.allowFamilyGrouping
      ? familyLookup.familyMembersByFamilyId.has(configuredSymbolId)
        ? configuredSymbolId
        : familyLookup.familyIdBySymbolId.get(configuredSymbolId)
      : undefined;

    const targetKey = familyId ? `family:${familyId}` : `symbol:${configuredSymbolId}`;
    if (evaluatedTargetKeys.has(targetKey)) {
      continue;
    }
    evaluatedTargetKeys.add(targetKey);

    const memberIds: readonly string[] = familyId
      ? (familyLookup.familyMembersByFamilyId.get(familyId) ?? [
          configuredSymbolId,
        ])
      : [configuredSymbolId];

    const matchedCells: PayAnywhereMatchedCell[] = [];
    const matchedCellCoordKeys = new Set<string>();
    let naturalCount = 0;
    let wildCount = 0;

    // 1. Collect all natural occurrences of memberIds from the one-pass map
    for (const memberId of memberIds) {
      const bucket = cellsBySymbolId.get(memberId);
      if (!bucket) continue;
      for (const cell of bucket) {
        const coordKey = `${cell.reelIndex}:${cell.rowIndex}`;
        if (matchedCellCoordKeys.has(coordKey)) continue;
        matchedCellCoordKeys.add(coordKey);
        naturalCount++;
        matchedCells.push(
          Object.freeze({
            reelIndex: cell.reelIndex,
            rowIndex: cell.rowIndex,
            symbolId: cell.symbolId,
            actualSymbolId: cell.symbolId,
            effectiveSymbolId: configuredSymbolId,
            isWild: false,
            ...(cell.stopIndex !== undefined
              ? { stopIndex: cell.stopIndex }
              : {}),
          }),
        );
      }
    }

    // 2. If Wild substitution is explicitly enabled, check B07 Wild cells
    if (
      normalizedConfig.allowWildSubstitution &&
      wildEngine &&
      wildCellsOnBoard.length > 0 &&
      !isCellWild(configuredSymbolId)
    ) {
      for (const wCell of wildCellsOnBoard) {
        const coordKey = `${wCell.reelIndex}:${wCell.rowIndex}`;
        if (matchedCellCoordKeys.has(coordKey)) continue;
        const wildId = wCell.symbolId;
        if (!wildEngine.isWildActiveOnReel(wildId, wCell.reelIndex)) {
          continue;
        }
        let substitutes = false;
        for (const memberId of memberIds) {
          if (wildEngine.canSubstitute(wildId, memberId)) {
            substitutes = true;
            break;
          }
        }
        if (substitutes) {
          matchedCellCoordKeys.add(coordKey);
          wildCount++;
          matchedCells.push(
            Object.freeze({
              reelIndex: wCell.reelIndex,
              rowIndex: wCell.rowIndex,
              symbolId: wildId,
              actualSymbolId: wildId,
              effectiveSymbolId: configuredSymbolId,
              isWild: true,
              ...(wCell.stopIndex !== undefined
                ? { stopIndex: wCell.stopIndex }
                : {}),
            }),
          );
        }
      }
    }

    // Deterministically sort matchedCells by reelIndex ASC, rowIndex ASC
    matchedCells.sort(
      (a, b) => a.reelIndex - b.reelIndex || a.rowIndex - b.rowIndex,
    );

    const count = matchedCells.length;
    const rule = normalizedConfig.symbolRulesBySymbolId.get(configuredSymbolId);

    // Determine minimum paying count for this symbol:
    // 1. Explicit symbolRule.minCount if present
    // 2. Otherwise lowest positive tier in paytableLookup for this symbol if smaller than minimumMatchCount
    // 3. Otherwise normalizedConfig.minimumMatchCount
    let minRequiredCount =
      rule?.minCount ?? normalizedConfig.minimumMatchCount;
    if (!rule && paytableLookup) {
      const byCount = paytableLookup.get(configuredSymbolId);
      if (byCount && byCount.size > 0) {
        let lowestPositiveTier = Infinity;
        for (const [tierCnt, mult] of byCount.entries()) {
          if (mult > 0 && tierCnt < lowestPositiveTier) {
            lowestPositiveTier = tierCnt;
          }
        }
        if (Number.isFinite(lowestPositiveTier)) {
          minRequiredCount = lowestPositiveTier;
        }
      }
    }

    const { matchedTierCount, baseMultiplier } = resolveTierMultiplier(
      paytableLookup,
      paytableEngineInstance,
      configuredSymbolId,
      count,
      minRequiredCount,
      rule?.maxCount,
    );

    const hasPaytable =
      paytableLookup !== null || paytableEngineInstance !== null;
    const qualifying = hasPaytable
      ? count >= minRequiredCount && baseMultiplier > 0
      : count >= minRequiredCount;

    const effectiveMultiplier = qualifying ? baseMultiplier : 0;
    const payoutAmount =
      bet !== null ? roundCurrency(effectiveMultiplier * bet) : undefined;

    const winEntry: PayAnywhereWin = Object.freeze({
      symbolId: configuredSymbolId,
      ...(familyId !== undefined ? { familyId } : {}),
      count,
      eligible: true,
      qualifying,
      minimumCount: minRequiredCount,
      matchedTierCount: qualifying ? matchedTierCount : null,
      baseMultiplier: qualifying ? baseMultiplier : 0,
      effectiveMultiplier,
      ...(payoutAmount !== undefined
        ? { finalPayout: payoutAmount, totalPayout: payoutAmount }
        : {}),
      wildCount,
      naturalCount,
      matchedCells: Object.freeze(matchedCells),
    });

    evaluatedSymbols.push(winEntry);
    bySymbolIdRecord[configuredSymbolId] = winEntry;
    if (qualifying) {
      qualifyingWins.push(winEntry);
    }
  }

  const includeNonQualifying =
    options.includeNonQualifying ?? normalizedConfig.includeNonQualifying;
  const reportedWins = includeNonQualifying
    ? evaluatedSymbols
    : qualifyingWins;

  let totalBaseMultiplier = 0;
  let totalEffectiveMultiplier = 0;
  let totalPayout = 0;

  for (const w of qualifyingWins) {
    totalBaseMultiplier = roundCurrency(
      totalBaseMultiplier + w.baseMultiplier,
    );
    totalEffectiveMultiplier = roundCurrency(
      totalEffectiveMultiplier + w.effectiveMultiplier,
    );
    if (w.totalPayout !== undefined) {
      totalPayout = roundCurrency(totalPayout + w.totalPayout);
    }
  }

  return Object.freeze({
    evaluationMode: "payAnywhere",
    enabled: true,
    wins: Object.freeze([...reportedWins]),
    evaluatedSymbols: Object.freeze(evaluatedSymbols),
    bySymbolId: Object.freeze(bySymbolIdRecord),
    evaluatedSymbolCount: evaluatedSymbols.length,
    qualifyingWinCount: qualifyingWins.length,
    totalBaseMultiplier,
    totalEffectiveMultiplier,
    ...(bet !== null ? { totalPayout } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* SERIALIZATION & DESERIALIZATION                                            */
/* -------------------------------------------------------------------------- */

export function serializePayAnywhereEvaluationResult(
  result: PayAnywhereEvaluationResult,
): string {
  return JSON.stringify(result);
}

export function deserializePayAnywhereEvaluationResult(
  payload: string,
): PayAnywhereEvaluationResult {
  if (typeof payload !== "string" || payload.trim().length === 0) {
    throw new InvalidPayAnywhereConfigurationError(
      "Serialized PayAnywhereEvaluationResult payload must be a non-empty JSON string.",
      { payload },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    throw new InvalidPayAnywhereConfigurationError(
      `Failed to parse serialized PayAnywhereEvaluationResult JSON: ${err instanceof Error ? err.message : String(err)}`,
      { payload },
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidPayAnywhereConfigurationError(
      "Deserialized PayAnywhereEvaluationResult must be an object.",
      { parsed },
    );
  }

  const candidate = parsed as Partial<PayAnywhereEvaluationResult>;
  if (
    candidate.evaluationMode !== "payAnywhere" ||
    typeof candidate.enabled !== "boolean" ||
    !Array.isArray(candidate.wins) ||
    typeof candidate.evaluatedSymbolCount !== "number"
  ) {
    throw new InvalidPayAnywhereConfigurationError(
      "Deserialized object does not match PayAnywhereEvaluationResult contract.",
      { parsed },
    );
  }

  const freezeWin = (w: PayAnywhereWin): PayAnywhereWin => {
    const frozenCells = Array.isArray(w.matchedCells)
      ? w.matchedCells.map((cell: PayAnywhereMatchedCell) =>
          Object.freeze({
            reelIndex: cell.reelIndex,
            rowIndex: cell.rowIndex,
            symbolId: cell.symbolId,
            actualSymbolId: cell.actualSymbolId ?? cell.symbolId,
            effectiveSymbolId: cell.effectiveSymbolId ?? w.symbolId,
            isWild: Boolean(cell.isWild),
            ...(cell.stopIndex !== undefined
              ? { stopIndex: cell.stopIndex }
              : {}),
          }),
        )
      : [];

    return Object.freeze({
      symbolId: w.symbolId,
      ...(w.familyId !== undefined ? { familyId: w.familyId } : {}),
      count: w.count,
      eligible: w.eligible ?? true,
      qualifying: Boolean(w.qualifying),
      minimumCount: w.minimumCount ?? 3,
      matchedTierCount: w.matchedTierCount ?? null,
      baseMultiplier: w.baseMultiplier,
      effectiveMultiplier: w.effectiveMultiplier,
      ...(w.finalPayout !== undefined ? { finalPayout: w.finalPayout } : {}),
      ...(w.totalPayout !== undefined ? { totalPayout: w.totalPayout } : {}),
      wildCount: w.wildCount ?? 0,
      naturalCount: w.naturalCount ?? frozenCells.length,
      matchedCells: Object.freeze(frozenCells),
    });
  };

  const frozenWins = Object.freeze(candidate.wins.map(freezeWin));
  const frozenEvaluatedSymbols = Object.freeze(
    Array.isArray(candidate.evaluatedSymbols)
      ? candidate.evaluatedSymbols.map(freezeWin)
      : frozenWins,
  );

  const bySymbolIdRecord: Record<string, PayAnywhereWin> = {};
  for (const entry of frozenEvaluatedSymbols) {
    bySymbolIdRecord[entry.symbolId] = entry;
  }

  return Object.freeze({
    evaluationMode: "payAnywhere",
    enabled: candidate.enabled,
    wins: frozenWins,
    evaluatedSymbols: frozenEvaluatedSymbols,
    bySymbolId: Object.freeze(bySymbolIdRecord),
    evaluatedSymbolCount: candidate.evaluatedSymbolCount,
    qualifyingWinCount:
      candidate.qualifyingWinCount ??
      frozenWins.filter((w) => w.qualifying).length,
    totalBaseMultiplier: candidate.totalBaseMultiplier ?? 0,
    totalEffectiveMultiplier: candidate.totalEffectiveMultiplier ?? 0,
    ...(candidate.totalPayout !== undefined
      ? { totalPayout: candidate.totalPayout }
      : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* PAY-ANYWHERE ENGINE CLASS & FACTORY                                        */
/* -------------------------------------------------------------------------- */

export interface PayAnywhereEngineDefaults {
  readonly config?:
    | PayAnywhereConfigInput
    | PayAnywhereConfiguration
    | GameConfig
    | GameDefinition;
  readonly options?: PayAnywhereEvaluationOptions;
}

export class DeterministicPayAnywhereEngine implements PayAnywhereEngine {
  private readonly defaultConfig?:
    | PayAnywhereConfigInput
    | PayAnywhereConfiguration
    | GameConfig
    | GameDefinition;
  private readonly defaultOptions: PayAnywhereEvaluationOptions;

  constructor(defaults: PayAnywhereEngineDefaults = {}) {
    this.defaultConfig = defaults.config;
    this.defaultOptions = defaults.options ?? {};
  }

  public evaluate(
    board: Board,
    config?:
      | PayAnywhereConfigInput
      | PayAnywhereConfiguration
      | GameConfig
      | GameDefinition,
    options?: PayAnywhereEvaluationOptions,
  ): PayAnywhereEvaluationResult {
    const effectiveConfig = config ?? this.defaultConfig;
    const effectiveOptions: PayAnywhereEvaluationOptions = {
      ...this.defaultOptions,
      ...options,
    };
    return evaluatePayAnywhere(board, effectiveConfig, effectiveOptions);
  }

  public evaluateSymbol(
    board: Board,
    symbolId: string,
    config?:
      | PayAnywhereConfigInput
      | PayAnywhereConfiguration
      | GameConfig
      | GameDefinition,
    options?: PayAnywhereEvaluationOptions,
  ): PayAnywhereWin {
    const res = this.evaluate(board, config, {
      ...options,
      includeNonQualifying: true,
    });
    const entry = res.bySymbolId[symbolId];
    if (!entry) {
      throw new UnknownPayAnywhereSymbolError(
        `Symbol "${symbolId}" is not configured as an eligible Pay-Anywhere symbol.`,
        { symbolId },
      );
    }
    return entry;
  }
}

export function createPayAnywhereEngine(
  defaults: PayAnywhereEngineDefaults = {},
): PayAnywhereEngine {
  return new DeterministicPayAnywhereEngine(defaults);
}
