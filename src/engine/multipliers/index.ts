/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B14 — Multiplier & Symbol Value Engine
 *
 * Dedicated, deterministic backend subsystem modeling multiplier and symbol-value
 * state and transformations across all 10 documented Slots Studio mechanics:
 *  1. Win Multipliers (cell-attached multipliers independent of visual symbol,
 *     configurable combination rules, applied once at settlement, no cross-spin leak)
 *  2. Geometric Tumble Multiplier (deterministic progression 1x -> 2x -> 4x -> 8x...
 *     up to a declared ceiling; each tumble uses its active multiplier; no double
 *     advancement within a single tumble)
 *  3. Free-Spins Starting Multiplier (configuration-driven feature entry multiplier
 *     derived from trigger context without hard-coded 8x/16x/32x values)
 *  4. Assigned-Value Symbols (coin/cash symbols carrying fixed or B03 weighted-pool
 *     bet-multiple values per cell on landing)
 *  5. Value Collection / Broadcast (collector symbols gathering source values and
 *     payer symbols broadcasting values to eligible targets with explicit transfers)
 *  6. Collection Zones (row, reel, rectangular, and tag-filtered board zones that
 *     support ragged boards with B13 variable reel heights)
 *  7. Multiplier Meters (named spin/feature/session meters supporting initialize,
 *     harvest, step, add, set, reset, snapshot/restore, and settlement application)
 *  8. Symbol Multiplier Memory (symbol-keyed best-multiplier memory with session or
 *     consume-on-first-pay persistence and no double consumption)
 *  9. Collect Ladders (ordered threshold rungs advancing collection multipliers and
 *     emitting explicit retrigger signals for B12 FeatureEngine)
 * 10. Value Absorption (collector cells pulling values into themselves and growing
 *     across the round, with configurable locked-collector and locked-source handling)
 *
 * Zero Math.random() or Date.now() usage. Zero browser/DOM dependencies.
 * Zero duplicated win/paytable/reel/feature evaluation logic.
 */

import type { Board, Cell, Position } from "../board";
import { positionKey } from "../board";
import type { FeatureId, SymbolId } from "../config";
import type { BoardState } from "../dynamics";
import {
  InvalidAssignedValueConfigError,
  InvalidCellMultiplierError,
  InvalidCollectLadderError,
  InvalidCollectionConfigurationError,
  InvalidCollectionZoneError,
  InvalidFeatureMultiplierConfigError,
  InvalidMultiplierConfigurationError,
  InvalidMultiplierMemoryError,
  InvalidMultiplierMeterError,
  InvalidTumbleMultiplierConfigError,
  InvalidValueAbsorptionError,
} from "../errors";
import { roundCurrency } from "../paytable";
import type {
  RandomSource,
  RngStateSnapshot,
  WeightedItem,
} from "../rng";

/* -------------------------------------------------------------------------- */
/* CORE TYPES & CONTRACTS                                                     */
/* -------------------------------------------------------------------------- */

export type MultiplierPersistenceScope = "spin" | "tumble" | "feature" | "session";
export type MultiplierCombinationRule = "add" | "multiply" | "max";
export type CellMultiplierWinContext =
  | "allWins"
  | "participatingWinOnly"
  | "tumbleWin";

export interface MultiplierDefinition {
  readonly id: string;
  readonly combinationRule: MultiplierCombinationRule;
  readonly baseMultiplier?: number;
  readonly maxMultiplier?: number;
  readonly eligibleSymbolIds?: readonly SymbolId[];
  readonly scope?: MultiplierPersistenceScope;
}

export interface CellMultiplier {
  readonly id: string;
  readonly value: number;
  readonly position: Position;
  readonly symbolId: SymbolId | null;
  readonly scope: MultiplierPersistenceScope;
  readonly winContext: CellMultiplierWinContext;
  readonly active: boolean;
  readonly sourceConfigId: string;
}

export interface GeometricTumbleMultiplierConfig {
  readonly id?: string;
  readonly startingMultiplier: number;
  readonly progressionFactor: number;
  readonly ceiling: number;
}

export interface TumbleMultiplierHistoryEntry {
  readonly tumbleIndex: number;
  readonly appliedMultiplier: number;
}

export interface TumbleMultiplierState {
  readonly configId: string;
  readonly startingMultiplier: number;
  readonly progressionFactor: number;
  readonly ceiling: number;
  readonly currentMultiplier: number;
  readonly tumbleIndex: number;
  readonly lastSettledTumbleIndex: number | null;
  readonly lastAdvancedTumbleIndex: number | null;
  readonly atCeiling: boolean;
  readonly history: readonly TumbleMultiplierHistoryEntry[];
}

export interface FeatureStartingMultiplierRule {
  readonly ruleId?: string;
  readonly triggerCount?: number;
  readonly minTriggerCount?: number;
  readonly triggerStrength?: string | number;
  readonly startingMultiplier: number;
}

export interface FeatureStartingMultiplierConfig {
  readonly id: string;
  readonly featureId: FeatureId;
  readonly defaultStartingMultiplier: number;
  readonly rules?: readonly FeatureStartingMultiplierRule[];
  readonly maxStartingMultiplier?: number;
}

export interface FeatureMultiplierTriggerContext {
  readonly triggerConfigId?: string;
  readonly triggerCount?: number;
  readonly triggerStrength?: string | number;
  readonly explicitStartingMultiplier?: number;
}

export interface ActiveFeatureMultiplierState {
  readonly featureId: FeatureId;
  readonly startingMultiplier: number;
  readonly currentMultiplier: number;
  readonly sourceConfigId: string;
}

export type AssignedValueMode = "fixed" | "weightedPool";
export type AssignedValuePersistence =
  | "spin"
  | "feature"
  | "session"
  | "consumeOnCollect";

export interface AssignedValueDefinition {
  readonly id: string;
  readonly symbolIds: readonly SymbolId[];
  readonly mode: AssignedValueMode;
  readonly fixedValue?: number;
  readonly weightedPool?: readonly WeightedItem<number>[];
  readonly persistence?: AssignedValuePersistence;
  readonly isCollector?: boolean;
}

export interface CellValue {
  readonly symbolId: SymbolId;
  readonly position: Position;
  readonly value: number;
  readonly originConfigId: string;
  readonly persistence: AssignedValuePersistence;
  readonly consumed: boolean;
  readonly isCollector: boolean;
}

export interface CollectionZone {
  readonly id: string;
  readonly rows?: readonly number[];
  readonly reels?: readonly number[];
  readonly rect?: {
    readonly minReel: number;
    readonly maxReel: number;
    readonly minRow: number;
    readonly maxRow: number;
  };
  readonly requiredTags?: readonly string[];
}

export type SourceValuePersistence = "retain" | "consume";
export type BroadcastAggregationMode = "add" | "multiply" | "replace";

export interface CollectionDefinition {
  readonly id: string;
  readonly mode: "collect" | "broadcast";
  readonly collectorSymbolIds: readonly SymbolId[];
  readonly eligibleSourceSymbolIds?: readonly SymbolId[];
  readonly eligibleTargetSymbolIds?: readonly SymbolId[];
  readonly sourceZone?: CollectionZone;
  readonly targetZone?: CollectionZone;
  readonly sourcePersistence?: SourceValuePersistence;
  readonly broadcastAggregation?: BroadcastAggregationMode;
  readonly excludeSelf?: boolean;
  readonly ladderId?: string;
}

export interface ValueTransfer {
  readonly transferId: string;
  readonly mode: "collect" | "broadcast" | "absorb";
  readonly sourcePosition: Position;
  readonly sourceSymbolId: SymbolId;
  readonly targetPosition: Position;
  readonly targetSymbolId: SymbolId;
  readonly transferredValue: number;
  readonly appliedMultiplier: number;
  readonly effectiveTransferredValue: number;
  readonly sourceConsumed: boolean;
  readonly configId: string;
}

export type MultiplierMeterScope = "spin" | "feature" | "session";
export type MultiplierMeterSettlementBehavior = "retain" | "resetOnSettle";

export interface MultiplierMeterDefinition {
  readonly meterId: string;
  readonly startingValue: number;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly scope: MultiplierMeterScope;
  readonly persistence?: MultiplierMeterScope;
  readonly stepAmount?: number;
  readonly settlementBehavior?: MultiplierMeterSettlementBehavior;
}

export interface MultiplierMeter {
  readonly meterId: string;
  readonly currentValue: number;
  readonly startingValue: number;
  readonly minValue: number;
  readonly maxValue: number | null;
  readonly scope: MultiplierMeterScope;
  readonly persistence: MultiplierMeterScope;
  readonly stepAmount: number;
  readonly settlementBehavior: MultiplierMeterSettlementBehavior;
  readonly active: boolean;
}

export type MultiplierMemoryPersistence = "session" | "consumeOnFirstPay";

export interface MultiplierMemoryDefinition {
  readonly id: string;
  readonly eligibleSymbolIds?: readonly SymbolId[];
  readonly persistence: MultiplierMemoryPersistence;
}

export interface MultiplierMemory {
  readonly symbolId: SymbolId;
  readonly rememberedMultiplier: number;
  readonly persistence: MultiplierMemoryPersistence;
  readonly consumed: boolean;
  readonly originConfigId: string;
}

export interface CollectLadderRung {
  readonly rungIndex: number;
  readonly threshold: number;
  readonly multiplier: number;
  readonly retriggerActionId?: string;
  readonly awardedExtraSpins?: number;
}

export interface CollectLadderDefinition {
  readonly ladderId: string;
  readonly rungs: readonly {
    readonly threshold: number;
    readonly multiplier: number;
    readonly retriggerActionId?: string;
    readonly awardedExtraSpins?: number;
  }[];
  readonly baseMultiplier?: number;
  readonly scope?: "spin" | "feature" | "session";
}

export interface CollectLadderRetriggerSignal {
  readonly ladderId: string;
  readonly rungIndex: number;
  readonly threshold: number;
  readonly newMultiplier: number;
  readonly retriggerActionId: string;
  readonly awardedExtraSpins: number;
}

export interface CollectLadder {
  readonly ladderId: string;
  readonly baseMultiplier: number;
  readonly rungs: readonly CollectLadderRung[];
  readonly collectorCount: number;
  readonly currentRungIndex: number;
  readonly currentMultiplier: number;
  readonly triggeredRungIndexes: readonly number[];
  readonly scope: "spin" | "feature" | "session";
}

export type LockedCollectorBehavior =
  | "absorbWhileLocked"
  | "excludeWhileLocked";

export interface ValueAbsorptionDefinition {
  readonly id: string;
  readonly collectorSymbolIds: readonly SymbolId[];
  readonly eligibleSourceSymbolIds?: readonly SymbolId[];
  readonly sourceZone?: CollectionZone;
  readonly collectorZone?: CollectionZone;
  readonly requiredSourceTags?: readonly string[];
  readonly requiredCollectorTags?: readonly string[];
  readonly sourcePersistence?: SourceValuePersistence;
  readonly lockedCollectorBehavior?: LockedCollectorBehavior;
  readonly respectLockedSources?: boolean;
  readonly ladderId?: string;
}

export interface ValueAbsorption {
  readonly configId: string;
  readonly collectorPosition: Position;
  readonly collectorSymbolId: SymbolId;
  readonly valueBefore: number;
  readonly absorbedDelta: number;
  readonly valueAfter: number;
  readonly transfers: readonly ValueTransfer[];
  readonly skippedLockedCollectors: readonly Position[];
  readonly skippedProtectedSources: readonly Position[];
}

export interface MultiplierState {
  readonly cellMultipliersByCoord: Readonly<
    Record<string, readonly CellMultiplier[]>
  >;
  readonly combinationRule: MultiplierCombinationRule;
  readonly tumbleState: TumbleMultiplierState | null;
  readonly featureMultiplier: ActiveFeatureMultiplierState | null;
  readonly metersById: Readonly<Record<string, MultiplierMeter>>;
  readonly memoryBySymbolId: Readonly<Record<SymbolId, MultiplierMemory>>;
}

export interface ValueState {
  readonly cellValuesByCoord: Readonly<Record<string, CellValue>>;
  readonly laddersById: Readonly<Record<string, CollectLadder>>;
  readonly lastTransfers: readonly ValueTransfer[];
  readonly lastAbsorptions: readonly ValueAbsorption[];
}

export interface MultiplierValueStateSnapshot {
  readonly version: 1;
  readonly multiplierState: MultiplierState;
  readonly valueState: ValueState;
}

export interface MultiplierContributor {
  readonly sourceType:
    | "cell"
    | "tumble"
    | "feature"
    | "meter"
    | "symbolMemory"
    | "collectLadder";
  readonly sourceId: string;
  readonly value: number;
  readonly position?: Position;
}

export interface SettlementMultiplierContext {
  readonly baseWin: number;
  readonly spinMultiplier: number;
  readonly tumbleMultiplier: number;
  readonly featureMultiplier: number;
  readonly meterMultiplier: number;
  readonly symbolMemoryMultiplier: number;
  readonly effectiveMultiplier: number;
  readonly settledWinAmount: number;
  readonly assignedValueTotal: number;
  readonly collectedValueTotal: number;
  readonly absorbedValueTotal: number;
  readonly valueTransfers: readonly ValueTransfer[];
  readonly contributingCells: readonly Position[];
  readonly multiplierSources: readonly MultiplierContributor[];
}

export interface MeterChangeRecord {
  readonly meterId: string;
  readonly before: number;
  readonly after: number;
}

export interface MemoryChangeRecord {
  readonly symbolId: SymbolId;
  readonly before: number | null;
  readonly after: number | null;
  readonly consumed: boolean;
}

export interface LadderChangeRecord {
  readonly ladderId: string;
  readonly collectorCountBefore: number;
  readonly collectorCountAfter: number;
  readonly multiplierBefore: number;
  readonly multiplierAfter: number;
  readonly retriggerSignals: readonly CollectLadderRetriggerSignal[];
}

export interface MultiplierRngUsage {
  readonly drawsConsumed: number;
  readonly rngStateBefore: RngStateSnapshot;
  readonly rngStateAfter: RngStateSnapshot;
}

export interface MultiplierValueResult<T = unknown> {
  readonly operationType: string;
  readonly sourceConfigId: string;
  readonly multiplierState: MultiplierState;
  readonly valueState: ValueState;
  readonly affectedCells: readonly Position[];
  readonly transferredValues: readonly ValueTransfer[];
  readonly multiplierContributors: readonly MultiplierContributor[];
  readonly effectiveMultiplier: number;
  readonly meterChanges: readonly MeterChangeRecord[];
  readonly memoryChanges: readonly MemoryChangeRecord[];
  readonly ladderChanges: readonly LadderChangeRecord[];
  readonly rngUsage?: MultiplierRngUsage;
  readonly persistenceScope: MultiplierPersistenceScope;
  readonly detail: T;
}

/* -------------------------------------------------------------------------- */
/* INTERNAL IMMUTABILITY & VALIDATION HELPERS                                 */
/* -------------------------------------------------------------------------- */

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i += 1) {
      deepFreeze(obj[i]);
    }
  } else {
    const keys = Object.keys(obj as Record<string, unknown>);
    for (const k of keys) {
      deepFreeze((obj as Record<string, unknown>)[k]);
    }
  }
  return obj;
}

function assertPositiveFiniteNumber(
  value: unknown,
  fieldName: string,
  ErrorClass: new (
    msg: string,
    ctx?: Record<string, unknown>,
  ) => Error = InvalidMultiplierConfigurationError,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new ErrorClass(`${fieldName} must be a positive finite number.`, {
      [fieldName]: value,
    });
  }
  return value;
}

function assertNonNegativeFiniteNumber(
  value: unknown,
  fieldName: string,
  ErrorClass: new (
    msg: string,
    ctx?: Record<string, unknown>,
  ) => Error = InvalidMultiplierConfigurationError,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ErrorClass(
      `${fieldName} must be a non-negative finite number.`,
      {
        [fieldName]: value,
      },
    );
  }
  return value;
}

function isPositionValidOnBoard(board: Board, pos: Position): boolean {
  if (
    !Number.isInteger(pos.reelIndex) ||
    !Number.isInteger(pos.rowIndex) ||
    pos.reelIndex < 0 ||
    pos.reelIndex >= board.cells.length
  ) {
    return false;
  }
  const col = board.cells[pos.reelIndex];
  return Boolean(col && pos.rowIndex >= 0 && pos.rowIndex < col.length);
}

/**
 * Evaluates whether a board position falls inside an explicit CollectionZone.
 * Safely handles ragged boards (B13 variable reel heights) without assuming
 * uniform row counts across reels.
 */
export function isPositionInCollectionZone(
  board: Board,
  pos: Position,
  zone?: CollectionZone,
  boardState?: BoardState,
): boolean {
  if (!isPositionValidOnBoard(board, pos)) {
    return false;
  }
  if (!zone) {
    return true;
  }

  if (zone.reels !== undefined) {
    if (!Array.isArray(zone.reels) || zone.reels.length === 0) {
      throw new InvalidCollectionZoneError(
        `CollectionZone "${zone.id}" reels filter must be a non-empty array when provided.`,
        { zoneId: zone.id },
      );
    }
    if (!zone.reels.includes(pos.reelIndex)) {
      return false;
    }
  }

  if (zone.rows !== undefined) {
    if (!Array.isArray(zone.rows) || zone.rows.length === 0) {
      throw new InvalidCollectionZoneError(
        `CollectionZone "${zone.id}" rows filter must be a non-empty array when provided.`,
        { zoneId: zone.id },
      );
    }
    if (!zone.rows.includes(pos.rowIndex)) {
      return false;
    }
  }

  if (zone.rect !== undefined) {
    const { minReel, maxReel, minRow, maxRow } = zone.rect;
    if (
      !Number.isInteger(minReel) ||
      !Number.isInteger(maxReel) ||
      !Number.isInteger(minRow) ||
      !Number.isInteger(maxRow) ||
      minReel < 0 ||
      maxReel < minReel ||
      minRow < 0 ||
      maxRow < minRow
    ) {
      throw new InvalidCollectionZoneError(
        `CollectionZone "${zone.id}" has invalid rectangular bounds.`,
        { zoneId: zone.id, rect: zone.rect },
      );
    }
    if (
      pos.reelIndex < minReel ||
      pos.reelIndex > maxReel ||
      pos.rowIndex < minRow ||
      pos.rowIndex > maxRow
    ) {
      return false;
    }
  }

  if (zone.requiredTags !== undefined && zone.requiredTags.length > 0) {
    if (!boardState) {
      return false;
    }
    const key = positionKey(pos);
    const cellTags = boardState.tagsByCoord[key] ?? [];
    const tagNames = new Set(cellTags.map((t) => t.tag));
    for (const reqTag of zone.requiredTags) {
      if (!tagNames.has(reqTag)) {
        return false;
      }
    }
  }

  return true;
}

function combineMultiplierValues(
  values: readonly number[],
  rule: MultiplierCombinationRule,
): number {
  if (values.length === 0) {
    return 1;
  }
  if (rule === "add") {
    let sum = 0;
    for (const v of values) {
      sum += v;
    }
    return roundCurrency(sum);
  }
  if (rule === "multiply") {
    let prod = 1;
    for (const v of values) {
      prod *= v;
    }
    return roundCurrency(prod);
  }
  if (rule === "max") {
    let maxVal = values[0]!;
    for (let i = 1; i < values.length; i += 1) {
      if (values[i]! > maxVal) {
        maxVal = values[i]!;
      }
    }
    return roundCurrency(maxVal);
  }
  throw new InvalidMultiplierConfigurationError(
    `Unsupported multiplier combination rule: "${String(rule)}".`,
    { combinationRule: rule },
  );
}

/* -------------------------------------------------------------------------- */
/* MULTIPLIER & SYMBOL VALUE ENGINE IMPLEMENTATION                            */
/* -------------------------------------------------------------------------- */

export interface MultiplierValueEngine {
  createInitialState(options?: {
    readonly combinationRule?: MultiplierCombinationRule;
  }): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  };

  /* 1. Cell Multipliers */
  addCellMultipliers(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    multipliers: readonly {
      readonly id?: string;
      readonly value: number;
      readonly position: Position;
      readonly symbolId?: SymbolId | null;
      readonly scope?: MultiplierPersistenceScope;
      readonly winContext?: CellMultiplierWinContext;
      readonly active?: boolean;
      readonly sourceConfigId?: string;
    }[],
    options?: {
      readonly combinationRule?: MultiplierCombinationRule;
      readonly maxMultiplier?: number;
    },
  ): MultiplierValueResult<readonly CellMultiplier[]>;

  resolveSpinCellMultiplier(
    multiplierState: MultiplierState,
    options?: {
      readonly participatingPositions?: readonly Position[];
      readonly includeTumbleContext?: boolean;
      readonly combinationRule?: MultiplierCombinationRule;
      readonly maxMultiplier?: number;
    },
  ): {
    readonly spinMultiplier: number;
    readonly contributors: readonly MultiplierContributor[];
    readonly contributingPositions: readonly Position[];
  };

  /* 2. Geometric Tumble Multiplier */
  initializeTumbleMultiplier(
    multiplierState: MultiplierState,
    valueState: ValueState,
    config: GeometricTumbleMultiplierConfig,
  ): MultiplierValueResult<TumbleMultiplierState>;

  getCurrentTumbleMultiplier(multiplierState: MultiplierState): number;

  settleCurrentTumble(
    multiplierState: MultiplierState,
    valueState: ValueState,
    tumbleWinAmount: number,
  ): MultiplierValueResult<{
    readonly tumbleIndex: number;
    readonly activeMultiplier: number;
    readonly baseTumbleWin: number;
    readonly multipliedTumbleWin: number;
  }>;

  advanceTumbleMultiplier(
    multiplierState: MultiplierState,
    valueState: ValueState,
    options?: {
      readonly forTumbleIndex?: number;
    },
  ): MultiplierValueResult<TumbleMultiplierState>;

  /* 3. Free-Spins Starting Multiplier */
  initializeFeatureMultiplier(
    multiplierState: MultiplierState,
    valueState: ValueState,
    featureId: FeatureId,
    triggerContext: FeatureMultiplierTriggerContext,
    config?: FeatureStartingMultiplierConfig,
  ): MultiplierValueResult<{
    readonly startingMultiplier: number;
    readonly sourceConfigId: string;
    readonly featureMultiplier: ActiveFeatureMultiplierState;
  }>;

  /* 4. Assigned-Value Symbols */
  assignCellValues(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    definitions: readonly AssignedValueDefinition[],
    rng?: RandomSource,
    options?: {
      readonly targetPositions?: readonly Position[];
      readonly overwriteExisting?: boolean;
    },
  ): MultiplierValueResult<readonly CellValue[]>;

  /* 5 & 6. Value Collection / Broadcast & Collection Zones */
  collectValues(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    definition: CollectionDefinition,
    options?: {
      readonly boardState?: BoardState;
    },
  ): MultiplierValueResult<{
    readonly transfers: readonly ValueTransfer[];
    readonly totalCollectedValue: number;
    readonly collectorTotalsByCoord: Readonly<Record<string, number>>;
  }>;

  broadcastValues(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    definition: CollectionDefinition,
    options?: {
      readonly boardState?: BoardState;
    },
  ): MultiplierValueResult<{
    readonly transfers: readonly ValueTransfer[];
    readonly totalBroadcastValue: number;
    readonly updatedTargetValuesByCoord: Readonly<Record<string, number>>;
  }>;

  /* 7. Multiplier Meters */
  initializeMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    definition: MultiplierMeterDefinition,
  ): MultiplierValueResult<MultiplierMeter>;

  stepMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
    steps?: number,
  ): MultiplierValueResult<MultiplierMeter>;

  addMeterValue(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
    delta: number,
  ): MultiplierValueResult<MultiplierMeter>;

  setMeterValue(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
    newValue: number,
  ): MultiplierValueResult<MultiplierMeter>;

  resetMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
  ): MultiplierValueResult<MultiplierMeter>;

  harvestBoardMultipliersToMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
    options?: {
      readonly consumeHarvestedCellMultipliers?: boolean;
    },
  ): MultiplierValueResult<{
    readonly meter: MultiplierMeter;
    readonly harvestedPositions: readonly Position[];
    readonly harvestedTotal: number;
  }>;

  settleMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
  ): MultiplierValueResult<{
    readonly appliedMultiplier: number;
    readonly meterAfterSettle: MultiplierMeter;
  }>;

  /* 8. Symbol Multiplier Memory */
  recordSymbolMultiplierMemory(
    multiplierState: MultiplierState,
    valueState: ValueState,
    entries: readonly {
      readonly symbolId: SymbolId;
      readonly multiplier: number;
      readonly persistence?: MultiplierMemoryPersistence;
      readonly originConfigId?: string;
    }[],
  ): MultiplierValueResult<readonly MultiplierMemory[]>;

  resolveSymbolMultiplierMemory(
    multiplierState: MultiplierState,
    valueState: ValueState,
    winningSymbolIds: readonly SymbolId[],
    options?: {
      readonly consumeOnPay?: boolean;
      readonly combinationRule?: MultiplierCombinationRule;
    },
  ): MultiplierValueResult<{
    readonly appliedSymbolMultiplier: number;
    readonly matchedMemories: readonly MultiplierMemory[];
  }>;

  /* 9. Collect Ladders */
  initializeCollectLadder(
    multiplierState: MultiplierState,
    valueState: ValueState,
    definition: CollectLadderDefinition,
  ): MultiplierValueResult<CollectLadder>;

  advanceCollectLadder(
    multiplierState: MultiplierState,
    valueState: ValueState,
    ladderId: string,
    collectorCountDelta: number,
  ): MultiplierValueResult<{
    readonly ladder: CollectLadder;
    readonly retriggerSignals: readonly CollectLadderRetriggerSignal[];
  }>;

  /* 10. Value Absorption */
  absorbValues(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    definition: ValueAbsorptionDefinition,
    options?: {
      readonly boardState?: BoardState;
    },
  ): MultiplierValueResult<readonly ValueAbsorption[]>;

  /* Settlement Context, Scope Boundaries, B13 Sync & Snapshot/Restore */
  buildSettlementContext(
    multiplierState: MultiplierState,
    valueState: ValueState,
    params: {
      readonly baseWin: number;
      readonly winningPositions?: readonly Position[];
      readonly winningSymbolIds?: readonly SymbolId[];
      readonly activeMeterIds?: readonly string[];
      readonly consumeSymbolMemoryOnPay?: boolean;
      readonly settleMeters?: boolean;
      readonly globalCombinationRule?: MultiplierCombinationRule;
    },
  ): MultiplierValueResult<SettlementMultiplierContext>;

  syncWithBoardTransition(
    multiplierState: MultiplierState,
    valueState: ValueState,
    transition: {
      readonly nextBoard: Board;
      readonly removedPositions?: readonly Position[];
      readonly movedCells?: readonly {
        readonly from: Position;
        readonly to: Position;
      }[];
      readonly shiftOffset?: {
        readonly reelShift: number;
        readonly rowShift: number;
      };
      readonly lockedCoords?: Readonly<Record<string, boolean>>;
    },
  ): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  };

  clearSpinState(
    multiplierState: MultiplierState,
    valueState: ValueState,
  ): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  };

  clearFeatureState(
    multiplierState: MultiplierState,
    valueState: ValueState,
  ): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  };

  snapshotState(
    multiplierState: MultiplierState,
    valueState: ValueState,
  ): MultiplierValueStateSnapshot;

  restoreState(snapshot: MultiplierValueStateSnapshot): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  };
}

export class DeterministicMultiplierValueEngine
  implements MultiplierValueEngine
{
  public createInitialState(options?: {
    readonly combinationRule?: MultiplierCombinationRule;
  }): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  } {
    const combinationRule = options?.combinationRule ?? "add";
    if (
      combinationRule !== "add" &&
      combinationRule !== "multiply" &&
      combinationRule !== "max"
    ) {
      throw new InvalidMultiplierConfigurationError(
        `Invalid combinationRule "${String(combinationRule)}".`,
        { combinationRule },
      );
    }

    const multiplierState: MultiplierState = deepFreeze({
      cellMultipliersByCoord: {},
      combinationRule,
      tumbleState: null,
      featureMultiplier: null,
      metersById: {},
      memoryBySymbolId: {},
    });

    const valueState: ValueState = deepFreeze({
      cellValuesByCoord: {},
      laddersById: {},
      lastTransfers: [],
      lastAbsorptions: [],
    });

    return Object.freeze({ multiplierState, valueState });
  }

  /* ------------------------------------------------------------------------ */
  /* 1. WIN MULTIPLIERS (CELL MULTIPLIERS)                                    */
  /* ------------------------------------------------------------------------ */

  public addCellMultipliers(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    multipliers: readonly {
      readonly id?: string;
      readonly value: number;
      readonly position: Position;
      readonly symbolId?: SymbolId | null;
      readonly scope?: MultiplierPersistenceScope;
      readonly winContext?: CellMultiplierWinContext;
      readonly active?: boolean;
      readonly sourceConfigId?: string;
    }[],
    options?: {
      readonly combinationRule?: MultiplierCombinationRule;
      readonly maxMultiplier?: number;
    },
  ): MultiplierValueResult<readonly CellMultiplier[]> {
    if (!Array.isArray(multipliers)) {
      throw new InvalidCellMultiplierError(
        "addCellMultipliers requires an array of multiplier specifications.",
      );
    }

    const nextMap: Record<string, CellMultiplier[]> = {};
    for (const [k, list] of Object.entries(
      multiplierState.cellMultipliersByCoord,
    )) {
      nextMap[k] = [...list];
    }

    const addedInstances: CellMultiplier[] = [];
    const affectedCells: Position[] = [];

    for (let i = 0; i < multipliers.length; i += 1) {
      const spec = multipliers[i]!;
      assertPositiveFiniteNumber(
        spec.value,
        "cellMultiplier.value",
        InvalidCellMultiplierError,
      );
      if (!isPositionValidOnBoard(board, spec.position)) {
        throw new InvalidCellMultiplierError(
          `Cell multiplier position (${spec.position.reelIndex}, ${spec.position.rowIndex}) is out of bounds for the current board.`,
          { position: spec.position },
        );
      }

      const key = positionKey(spec.position);
      const cell =
        board.cells[spec.position.reelIndex]![spec.position.rowIndex]!;
      const instance: CellMultiplier = deepFreeze({
        id: spec.id ?? `cm-${key}-${(nextMap[key]?.length ?? 0) + 1}`,
        value: roundCurrency(spec.value),
        position: {
          reelIndex: spec.position.reelIndex,
          rowIndex: spec.position.rowIndex,
        },
        symbolId:
          spec.symbolId !== undefined ? spec.symbolId : cell.symbolId,
        scope: spec.scope ?? "spin",
        winContext: spec.winContext ?? "allWins",
        active: spec.active ?? true,
        sourceConfigId: spec.sourceConfigId ?? "cell-multiplier-config",
      });

      if (!nextMap[key]) {
        nextMap[key] = [];
      }
      nextMap[key]!.push(instance);
      addedInstances.push(instance);
      affectedCells.push(instance.position);
    }

    const nextMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      combinationRule:
        options?.combinationRule ?? multiplierState.combinationRule,
      cellMultipliersByCoord: nextMap,
    });

    const resolved = this.resolveSpinCellMultiplier(nextMultiplierState, {
      combinationRule: nextMultiplierState.combinationRule,
      maxMultiplier: options?.maxMultiplier,
    });

    return deepFreeze({
      operationType: "addCellMultipliers",
      sourceConfigId:
        multipliers[0]?.sourceConfigId ?? "cell-multiplier-config",
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells,
      transferredValues: [],
      multiplierContributors: resolved.contributors,
      effectiveMultiplier: resolved.spinMultiplier,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: multipliers[0]?.scope ?? "spin",
      detail: addedInstances,
    });
  }

  public resolveSpinCellMultiplier(
    multiplierState: MultiplierState,
    options?: {
      readonly participatingPositions?: readonly Position[];
      readonly includeTumbleContext?: boolean;
      readonly combinationRule?: MultiplierCombinationRule;
      readonly maxMultiplier?: number;
    },
  ): {
    readonly spinMultiplier: number;
    readonly contributors: readonly MultiplierContributor[];
    readonly contributingPositions: readonly Position[];
  } {
    const rule = options?.combinationRule ?? multiplierState.combinationRule;
    const participatingKeys = options?.participatingPositions
      ? new Set(options.participatingPositions.map((p) => positionKey(p)))
      : null;

    const activeValues: number[] = [];
    const contributors: MultiplierContributor[] = [];
    const contributingPositions: Position[] = [];
    const seenCoords = new Set<string>();

    const sortedKeys = Object.keys(
      multiplierState.cellMultipliersByCoord,
    ).sort();
    for (const key of sortedKeys) {
      const list = multiplierState.cellMultipliersByCoord[key]!;
      for (const cm of list) {
        if (!cm.active) {
          continue;
        }
        if (
          cm.winContext === "participatingWinOnly" &&
          participatingKeys !== null &&
          !participatingKeys.has(key)
        ) {
          continue;
        }
        if (
          cm.winContext === "tumbleWin" &&
          options?.includeTumbleContext === false
        ) {
          continue;
        }
        activeValues.push(cm.value);
        contributors.push({
          sourceType: "cell",
          sourceId: cm.id,
          value: cm.value,
          position: cm.position,
        });
        if (!seenCoords.has(key)) {
          seenCoords.add(key);
          contributingPositions.push(cm.position);
        }
      }
    }

    let combined = combineMultiplierValues(activeValues, rule);
    if (
      options?.maxMultiplier !== undefined &&
      Number.isFinite(options.maxMultiplier) &&
      options.maxMultiplier > 0
    ) {
      combined = Math.min(combined, options.maxMultiplier);
    }

    return deepFreeze({
      spinMultiplier: combined,
      contributors,
      contributingPositions,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 2. GEOMETRIC TUMBLE MULTIPLIER                                           */
  /* ------------------------------------------------------------------------ */

  public initializeTumbleMultiplier(
    multiplierState: MultiplierState,
    valueState: ValueState,
    config: GeometricTumbleMultiplierConfig,
  ): MultiplierValueResult<TumbleMultiplierState> {
    if (!config || typeof config !== "object") {
      throw new InvalidTumbleMultiplierConfigError(
        "initializeTumbleMultiplier requires a configuration object.",
      );
    }
    const startingMultiplier = assertPositiveFiniteNumber(
      config.startingMultiplier,
      "startingMultiplier",
      InvalidTumbleMultiplierConfigError,
    );
    const progressionFactor = assertPositiveFiniteNumber(
      config.progressionFactor,
      "progressionFactor",
      InvalidTumbleMultiplierConfigError,
    );
    if (progressionFactor < 1) {
      throw new InvalidTumbleMultiplierConfigError(
        "progressionFactor must be >= 1.",
        { progressionFactor },
      );
    }
    const ceiling = assertPositiveFiniteNumber(
      config.ceiling,
      "ceiling",
      InvalidTumbleMultiplierConfigError,
    );
    if (ceiling < startingMultiplier) {
      throw new InvalidTumbleMultiplierConfigError(
        "ceiling must be >= startingMultiplier.",
        { startingMultiplier, ceiling },
      );
    }

    const initialCurrent = Math.min(startingMultiplier, ceiling);
    const tumbleState: TumbleMultiplierState = deepFreeze({
      configId: config.id ?? "geometric-tumble-multiplier",
      startingMultiplier,
      progressionFactor,
      ceiling,
      currentMultiplier: initialCurrent,
      tumbleIndex: 0,
      lastSettledTumbleIndex: null,
      lastAdvancedTumbleIndex: null,
      atCeiling: initialCurrent >= ceiling,
      history: [],
    });

    const nextMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      tumbleState,
    });

    return deepFreeze({
      operationType: "initializeTumbleMultiplier",
      sourceConfigId: tumbleState.configId,
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: [
        {
          sourceType: "tumble",
          sourceId: tumbleState.configId,
          value: tumbleState.currentMultiplier,
        },
      ],
      effectiveMultiplier: tumbleState.currentMultiplier,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: "spin",
      detail: tumbleState,
    });
  }

  public getCurrentTumbleMultiplier(multiplierState: MultiplierState): number {
    return multiplierState.tumbleState?.currentMultiplier ?? 1;
  }

  public settleCurrentTumble(
    multiplierState: MultiplierState,
    valueState: ValueState,
    tumbleWinAmount: number,
  ): MultiplierValueResult<{
    readonly tumbleIndex: number;
    readonly activeMultiplier: number;
    readonly baseTumbleWin: number;
    readonly multipliedTumbleWin: number;
  }> {
    assertNonNegativeFiniteNumber(
      tumbleWinAmount,
      "tumbleWinAmount",
      InvalidTumbleMultiplierConfigError,
    );
    if (!multiplierState.tumbleState) {
      throw new InvalidTumbleMultiplierConfigError(
        "Cannot settle tumble win before initializeTumbleMultiplier has been called.",
      );
    }

    const ts = multiplierState.tumbleState;
    const activeMultiplier = ts.currentMultiplier;
    const multipliedTumbleWin = roundCurrency(
      tumbleWinAmount * activeMultiplier,
    );

    const updatedTumbleState: TumbleMultiplierState = deepFreeze({
      ...ts,
      lastSettledTumbleIndex: ts.tumbleIndex,
      history: [
        ...ts.history,
        {
          tumbleIndex: ts.tumbleIndex,
          appliedMultiplier: activeMultiplier,
        },
      ],
    });

    const nextMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      tumbleState: updatedTumbleState,
    });

    return deepFreeze({
      operationType: "settleCurrentTumble",
      sourceConfigId: ts.configId,
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: [
        {
          sourceType: "tumble",
          sourceId: ts.configId,
          value: activeMultiplier,
        },
      ],
      effectiveMultiplier: activeMultiplier,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: "tumble",
      detail: {
        tumbleIndex: ts.tumbleIndex,
        activeMultiplier,
        baseTumbleWin: roundCurrency(tumbleWinAmount),
        multipliedTumbleWin,
      },
    });
  }

  public advanceTumbleMultiplier(
    multiplierState: MultiplierState,
    valueState: ValueState,
    options?: {
      readonly forTumbleIndex?: number;
    },
  ): MultiplierValueResult<TumbleMultiplierState> {
    if (!multiplierState.tumbleState) {
      throw new InvalidTumbleMultiplierConfigError(
        "Cannot advance tumble multiplier before initializeTumbleMultiplier has been called.",
      );
    }

    const ts = multiplierState.tumbleState;
    const targetTumbleIdx = options?.forTumbleIndex ?? ts.tumbleIndex;

    // Prevent accidental double advancement for the same tumble index
    if (
      ts.lastAdvancedTumbleIndex !== null &&
      targetTumbleIdx <= ts.lastAdvancedTumbleIndex
    ) {
      return deepFreeze({
        operationType: "advanceTumbleMultiplier",
        sourceConfigId: ts.configId,
        multiplierState,
        valueState,
        affectedCells: [],
        transferredValues: [],
        multiplierContributors: [
          {
            sourceType: "tumble",
            sourceId: ts.configId,
            value: ts.currentMultiplier,
          },
        ],
        effectiveMultiplier: ts.currentMultiplier,
        meterChanges: [],
        memoryChanges: [],
        ladderChanges: [],
        persistenceScope: "spin",
        detail: ts,
      });
    }

    const rawNext = roundCurrency(
      ts.currentMultiplier * ts.progressionFactor,
    );
    const nextMultiplier = Math.min(rawNext, ts.ceiling);
    const nextTumbleState: TumbleMultiplierState = deepFreeze({
      ...ts,
      currentMultiplier: nextMultiplier,
      tumbleIndex: ts.tumbleIndex + 1,
      lastAdvancedTumbleIndex: targetTumbleIdx,
      atCeiling: nextMultiplier >= ts.ceiling,
    });

    const nextMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      tumbleState: nextTumbleState,
    });

    return deepFreeze({
      operationType: "advanceTumbleMultiplier",
      sourceConfigId: ts.configId,
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: [
        {
          sourceType: "tumble",
          sourceId: ts.configId,
          value: nextTumbleState.currentMultiplier,
        },
      ],
      effectiveMultiplier: nextTumbleState.currentMultiplier,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: "spin",
      detail: nextTumbleState,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 3. FREE-SPINS STARTING MULTIPLIER                                        */
  /* ------------------------------------------------------------------------ */

  public initializeFeatureMultiplier(
    multiplierState: MultiplierState,
    valueState: ValueState,
    featureId: FeatureId,
    triggerContext: FeatureMultiplierTriggerContext,
    config?: FeatureStartingMultiplierConfig,
  ): MultiplierValueResult<{
    readonly startingMultiplier: number;
    readonly sourceConfigId: string;
    readonly featureMultiplier: ActiveFeatureMultiplierState;
  }> {
    if (!featureId || typeof featureId !== "string") {
      throw new InvalidFeatureMultiplierConfigError(
        "initializeFeatureMultiplier requires a non-empty featureId.",
      );
    }
    if (!triggerContext || typeof triggerContext !== "object") {
      throw new InvalidFeatureMultiplierConfigError(
        "initializeFeatureMultiplier requires a triggerContext object.",
      );
    }

    let resolvedMultiplier: number | null = null;
    let sourceConfigId =
      triggerContext.triggerConfigId ??
      config?.id ??
      `feature-mult-${featureId}`;

    if (triggerContext.explicitStartingMultiplier !== undefined) {
      resolvedMultiplier = assertPositiveFiniteNumber(
        triggerContext.explicitStartingMultiplier,
        "explicitStartingMultiplier",
        InvalidFeatureMultiplierConfigError,
      );
    } else if (config) {
      if (config.featureId !== featureId) {
        throw new InvalidFeatureMultiplierConfigError(
          `FeatureStartingMultiplierConfig featureId "${config.featureId}" does not match "${featureId}".`,
          { expected: featureId, actual: config.featureId },
        );
      }
      assertPositiveFiniteNumber(
        config.defaultStartingMultiplier,
        "defaultStartingMultiplier",
        InvalidFeatureMultiplierConfigError,
      );

      if (Array.isArray(config.rules) && config.rules.length > 0) {
        // Match exact triggerStrength or triggerCount first, then highest qualifying minTriggerCount
        for (const rule of config.rules) {
          assertPositiveFiniteNumber(
            rule.startingMultiplier,
            "rule.startingMultiplier",
            InvalidFeatureMultiplierConfigError,
          );
          if (
            rule.triggerStrength !== undefined &&
            triggerContext.triggerStrength !== undefined &&
            rule.triggerStrength === triggerContext.triggerStrength
          ) {
            resolvedMultiplier = rule.startingMultiplier;
            if (rule.ruleId) {
              sourceConfigId = rule.ruleId;
            }
            break;
          }
          if (
            rule.triggerCount !== undefined &&
            triggerContext.triggerCount !== undefined &&
            rule.triggerCount === triggerContext.triggerCount
          ) {
            resolvedMultiplier = rule.startingMultiplier;
            if (rule.ruleId) {
              sourceConfigId = rule.ruleId;
            }
            break;
          }
        }

        if (
          resolvedMultiplier === null &&
          triggerContext.triggerCount !== undefined
        ) {
          let bestMinCount = -1;
          for (const rule of config.rules) {
            if (
              rule.minTriggerCount !== undefined &&
              triggerContext.triggerCount >= rule.minTriggerCount &&
              rule.minTriggerCount > bestMinCount
            ) {
              bestMinCount = rule.minTriggerCount;
              resolvedMultiplier = rule.startingMultiplier;
              if (rule.ruleId) {
                sourceConfigId = rule.ruleId;
              }
            }
          }
        }
      }

      if (resolvedMultiplier === null) {
        resolvedMultiplier = config.defaultStartingMultiplier;
      }
      if (
        config.maxStartingMultiplier !== undefined &&
        Number.isFinite(config.maxStartingMultiplier) &&
        config.maxStartingMultiplier > 0
      ) {
        resolvedMultiplier = Math.min(
          resolvedMultiplier,
          config.maxStartingMultiplier,
        );
      }
    } else {
      throw new InvalidFeatureMultiplierConfigError(
        `initializeFeatureMultiplier for "${featureId}" requires either explicitStartingMultiplier in triggerContext or a FeatureStartingMultiplierConfig.`,
        { featureId },
      );
    }

    const finalStarting = roundCurrency(resolvedMultiplier);
    const featureMultiplier: ActiveFeatureMultiplierState = deepFreeze({
      featureId,
      startingMultiplier: finalStarting,
      currentMultiplier: finalStarting,
      sourceConfigId,
    });

    const nextMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      featureMultiplier,
    });

    return deepFreeze({
      operationType: "initializeFeatureMultiplier",
      sourceConfigId,
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: [
        {
          sourceType: "feature",
          sourceId: sourceConfigId,
          value: finalStarting,
        },
      ],
      effectiveMultiplier: finalStarting,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: "feature",
      detail: {
        startingMultiplier: finalStarting,
        sourceConfigId,
        featureMultiplier,
      },
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 4. ASSIGNED-VALUE SYMBOLS                                                */
  /* ------------------------------------------------------------------------ */

  public assignCellValues(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    definitions: readonly AssignedValueDefinition[],
    rng?: RandomSource,
    options?: {
      readonly targetPositions?: readonly Position[];
      readonly overwriteExisting?: boolean;
    },
  ): MultiplierValueResult<readonly CellValue[]> {
    if (!Array.isArray(definitions) || definitions.length === 0) {
      throw new InvalidAssignedValueConfigError(
        "assignCellValues requires at least one AssignedValueDefinition.",
      );
    }

    const defBySymbolId = new Map<SymbolId, AssignedValueDefinition>();
    for (const def of definitions) {
      if (
        !def ||
        typeof def.id !== "string" ||
        !Array.isArray(def.symbolIds) ||
        def.symbolIds.length === 0
      ) {
        throw new InvalidAssignedValueConfigError(
          "AssignedValueDefinition must specify a non-empty id and symbolIds array.",
        );
      }
      if (def.mode === "fixed") {
        assertNonNegativeFiniteNumber(
          def.fixedValue,
          "fixedValue",
          InvalidAssignedValueConfigError,
        );
      } else if (def.mode === "weightedPool") {
        if (
          !Array.isArray(def.weightedPool) ||
          def.weightedPool.length === 0
        ) {
          throw new InvalidAssignedValueConfigError(
            `AssignedValueDefinition "${def.id}" with mode "weightedPool" requires a non-empty weightedPool.`,
            { definitionId: def.id },
          );
        }
        for (const item of def.weightedPool) {
          assertNonNegativeFiniteNumber(
            item.value,
            "weightedPool.value",
            InvalidAssignedValueConfigError,
          );
          assertPositiveFiniteNumber(
            item.weight,
            "weightedPool.weight",
            InvalidAssignedValueConfigError,
          );
        }
      } else {
        throw new InvalidAssignedValueConfigError(
          `Unsupported AssignedValueMode "${String(def.mode)}".`,
          { mode: def.mode },
        );
      }

      for (const symId of def.symbolIds) {
        defBySymbolId.set(symId, def);
      }
    }

    const targetKeys = options?.targetPositions
      ? new Set(options.targetPositions.map((p) => positionKey(p)))
      : null;

    const nextCellValues: Record<string, CellValue> = {
      ...valueState.cellValuesByCoord,
    };
    const assignedList: CellValue[] = [];
    const affectedCells: Position[] = [];

    const rngBefore = rng ? rng.snapshot() : null;
    let drawsConsumed = 0;

    for (let reelIndex = 0; reelIndex < board.cells.length; reelIndex += 1) {
      const col = board.cells[reelIndex]!;
      for (let rowIndex = 0; rowIndex < col.length; rowIndex += 1) {
        const cell: Cell = col[rowIndex]!;
        const pos: Position = { reelIndex, rowIndex };
        const key = positionKey(pos);

        if (targetKeys !== null && !targetKeys.has(key)) {
          continue;
        }
        if (
          nextCellValues[key] !== undefined &&
          options?.overwriteExisting !== true
        ) {
          continue;
        }

        const def = defBySymbolId.get(cell.symbolId);
        if (!def) {
          continue;
        }

        let val: number;
        if (def.mode === "fixed") {
          val = roundCurrency(def.fixedValue!);
        } else {
          if (!rng) {
            throw new InvalidAssignedValueConfigError(
              `AssignedValueDefinition "${def.id}" uses mode "weightedPool" and requires a B03 RandomSource.`,
              { definitionId: def.id },
            );
          }
          val = roundCurrency(rng.weightedPick(def.weightedPool!));
          drawsConsumed += 1;
        }

        const cv: CellValue = deepFreeze({
          symbolId: cell.symbolId,
          position: pos,
          value: val,
          originConfigId: def.id,
          persistence: def.persistence ?? "spin",
          consumed: false,
          isCollector: Boolean(def.isCollector),
        });

        nextCellValues[key] = cv;
        assignedList.push(cv);
        affectedCells.push(pos);
      }
    }

    const rngUsage: MultiplierRngUsage | undefined =
      rng && rngBefore
        ? deepFreeze({
            drawsConsumed,
            rngStateBefore: rngBefore,
            rngStateAfter: rng.snapshot(),
          })
        : undefined;

    const nextValueState: ValueState = deepFreeze({
      ...valueState,
      cellValuesByCoord: nextCellValues,
    });

    return deepFreeze({
      operationType: "assignCellValues",
      sourceConfigId: definitions[0]!.id,
      multiplierState,
      valueState: nextValueState,
      affectedCells,
      transferredValues: [],
      multiplierContributors: [],
      effectiveMultiplier: 1,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [],
      ...(rngUsage ? { rngUsage } : {}),
      persistenceScope:
        definitions[0]!.persistence === "consumeOnCollect"
          ? "spin"
          : (definitions[0]!.persistence ?? "spin"),
      detail: assignedList,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 5 & 6. VALUE COLLECTION / BROADCAST & COLLECTION ZONES                   */
  /* ------------------------------------------------------------------------ */

  public collectValues(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    definition: CollectionDefinition,
    options?: {
      readonly boardState?: BoardState;
    },
  ): MultiplierValueResult<{
    readonly transfers: readonly ValueTransfer[];
    readonly totalCollectedValue: number;
    readonly collectorTotalsByCoord: Readonly<Record<string, number>>;
  }> {
    if (
      !definition ||
      definition.mode !== "collect" ||
      !Array.isArray(definition.collectorSymbolIds) ||
      definition.collectorSymbolIds.length === 0
    ) {
      throw new InvalidCollectionConfigurationError(
        'collectValues requires a CollectionDefinition with mode "collect" and non-empty collectorSymbolIds.',
      );
    }

    const collectorSet = new Set(definition.collectorSymbolIds);
    const eligibleSourceSet = definition.eligibleSourceSymbolIds
      ? new Set(definition.eligibleSourceSymbolIds)
      : null;
    const excludeSelf = definition.excludeSelf ?? true;
    const sourcePersistence = definition.sourcePersistence ?? "retain";

    const activeLadder = definition.ladderId
      ? valueState.laddersById[definition.ladderId]
      : undefined;
    const collectionMultiplier = activeLadder?.currentMultiplier ?? 1;

    // 1. Identify collector cells on the board inside targetZone (if configured)
    const collectors: { readonly pos: Position; readonly symbolId: SymbolId }[] =
      [];
    for (let reelIndex = 0; reelIndex < board.cells.length; reelIndex += 1) {
      const col = board.cells[reelIndex]!;
      for (let rowIndex = 0; rowIndex < col.length; rowIndex += 1) {
        const pos: Position = { reelIndex, rowIndex };
        const cell = col[rowIndex]!;
        if (!collectorSet.has(cell.symbolId)) {
          continue;
        }
        if (
          !isPositionInCollectionZone(
            board,
            pos,
            definition.targetZone,
            options?.boardState,
          )
        ) {
          continue;
        }
        collectors.push({ pos, symbolId: cell.symbolId });
      }
    }

    // 2. Identify eligible source cells in valueState inside sourceZone
    const nextCellValues: Record<string, CellValue> = {
      ...valueState.cellValuesByCoord,
    };
    const transfers: ValueTransfer[] = [];
    const collectorTotalsByCoord: Record<string, number> = {};
    const affectedCoords = new Set<string>();
    const affectedCells: Position[] = [];
    let totalCollectedValue = 0;

    const sortedSourceKeys = Object.keys(nextCellValues).sort();

    for (const collector of collectors) {
      const collectorKey = positionKey(collector.pos);
      collectorTotalsByCoord[collectorKey] =
        collectorTotalsByCoord[collectorKey] ?? 0;

      for (const sourceKey of sortedSourceKeys) {
        const sourceCv = nextCellValues[sourceKey]!;
        if (sourceCv.consumed || sourceCv.value <= 0) {
          continue;
        }
        if (excludeSelf && sourceKey === collectorKey) {
          continue;
        }
        if (
          eligibleSourceSet !== null &&
          !eligibleSourceSet.has(sourceCv.symbolId)
        ) {
          continue;
        }
        if (
          !isPositionInCollectionZone(
            board,
            sourceCv.position,
            definition.sourceZone,
            options?.boardState,
          )
        ) {
          continue;
        }

        const shouldConsume =
          sourcePersistence === "consume" ||
          sourceCv.persistence === "consumeOnCollect";
        const effectiveValue = roundCurrency(
          sourceCv.value * collectionMultiplier,
        );

        const transfer: ValueTransfer = deepFreeze({
          transferId: `collect-${definition.id}-${sourceKey}->${collectorKey}-${transfers.length + 1}`,
          mode: "collect",
          sourcePosition: sourceCv.position,
          sourceSymbolId: sourceCv.symbolId,
          targetPosition: collector.pos,
          targetSymbolId: collector.symbolId,
          transferredValue: sourceCv.value,
          appliedMultiplier: collectionMultiplier,
          effectiveTransferredValue: effectiveValue,
          sourceConsumed: shouldConsume,
          configId: definition.id,
        });

        transfers.push(transfer);
        collectorTotalsByCoord[collectorKey] = roundCurrency(
          collectorTotalsByCoord[collectorKey]! + effectiveValue,
        );
        totalCollectedValue = roundCurrency(
          totalCollectedValue + effectiveValue,
        );

        if (shouldConsume) {
          nextCellValues[sourceKey] = deepFreeze({
            ...sourceCv,
            consumed: true,
          });
        }

        for (const p of [sourceCv.position, collector.pos]) {
          const pk = positionKey(p);
          if (!affectedCoords.has(pk)) {
            affectedCoords.add(pk);
            affectedCells.push(p);
          }
        }
      }
    }

    const nextValueState: ValueState = deepFreeze({
      ...valueState,
      cellValuesByCoord: nextCellValues,
      lastTransfers: transfers,
    });

    return deepFreeze({
      operationType: "collectValues",
      sourceConfigId: definition.id,
      multiplierState,
      valueState: nextValueState,
      affectedCells,
      transferredValues: transfers,
      multiplierContributors: activeLadder
        ? [
            {
              sourceType: "collectLadder",
              sourceId: activeLadder.ladderId,
              value: collectionMultiplier,
            },
          ]
        : [],
      effectiveMultiplier: collectionMultiplier,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: "spin",
      detail: {
        transfers,
        totalCollectedValue,
        collectorTotalsByCoord,
      },
    });
  }

  public broadcastValues(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    definition: CollectionDefinition,
    options?: {
      readonly boardState?: BoardState;
    },
  ): MultiplierValueResult<{
    readonly transfers: readonly ValueTransfer[];
    readonly totalBroadcastValue: number;
    readonly updatedTargetValuesByCoord: Readonly<Record<string, number>>;
  }> {
    if (
      !definition ||
      definition.mode !== "broadcast" ||
      !Array.isArray(definition.collectorSymbolIds) ||
      definition.collectorSymbolIds.length === 0
    ) {
      throw new InvalidCollectionConfigurationError(
        'broadcastValues requires a CollectionDefinition with mode "broadcast" and non-empty collectorSymbolIds (payer symbol IDs).',
      );
    }

    const payerSet = new Set(definition.collectorSymbolIds);
    const eligibleTargetSet = definition.eligibleTargetSymbolIds
      ? new Set(definition.eligibleTargetSymbolIds)
      : null;
    const excludeSelf = definition.excludeSelf ?? true;
    const aggregation: BroadcastAggregationMode =
      definition.broadcastAggregation ?? "add";
    const sourcePersistence = definition.sourcePersistence ?? "retain";

    const nextCellValues: Record<string, CellValue> = {
      ...valueState.cellValuesByCoord,
    };

    // 1. Identify payer cells in valueState inside sourceZone
    const sortedKeys = Object.keys(nextCellValues).sort();
    const payers: CellValue[] = [];
    for (const k of sortedKeys) {
      const cv = nextCellValues[k]!;
      if (cv.consumed || cv.value <= 0) {
        continue;
      }
      if (!payerSet.has(cv.symbolId)) {
        continue;
      }
      if (
        !isPositionInCollectionZone(
          board,
          cv.position,
          definition.sourceZone,
          options?.boardState,
        )
      ) {
        continue;
      }
      payers.push(cv);
    }

    const transfers: ValueTransfer[] = [];
    const updatedTargetValuesByCoord: Record<string, number> = {};
    const affectedCoords = new Set<string>();
    const affectedCells: Position[] = [];
    let totalBroadcastValue = 0;

    for (const payer of payers) {
      const payerKey = positionKey(payer.position);

      for (let reelIndex = 0; reelIndex < board.cells.length; reelIndex += 1) {
        const col = board.cells[reelIndex]!;
        for (let rowIndex = 0; rowIndex < col.length; rowIndex += 1) {
          const targetPos: Position = { reelIndex, rowIndex };
          const targetKey = positionKey(targetPos);
          if (excludeSelf && targetKey === payerKey) {
            continue;
          }

          const targetCell = col[rowIndex]!;
          if (
            eligibleTargetSet !== null &&
            !eligibleTargetSet.has(targetCell.symbolId)
          ) {
            continue;
          }
          if (
            !isPositionInCollectionZone(
              board,
              targetPos,
              definition.targetZone,
              options?.boardState,
            )
          ) {
            continue;
          }

          const existingTargetCv = nextCellValues[targetKey];
          const baseVal = existingTargetCv ? existingTargetCv.value : 0;
          let nextVal: number;
          if (aggregation === "add") {
            nextVal = roundCurrency(baseVal + payer.value);
          } else if (aggregation === "multiply") {
            nextVal = roundCurrency((baseVal > 0 ? baseVal : 1) * payer.value);
          } else {
            nextVal = roundCurrency(payer.value);
          }

          nextCellValues[targetKey] = deepFreeze({
            symbolId: targetCell.symbolId,
            position: targetPos,
            value: nextVal,
            originConfigId: existingTargetCv?.originConfigId ?? definition.id,
            persistence: existingTargetCv?.persistence ?? "spin",
            consumed: false,
            isCollector: existingTargetCv?.isCollector ?? false,
          });

          updatedTargetValuesByCoord[targetKey] = nextVal;
          totalBroadcastValue = roundCurrency(
            totalBroadcastValue + payer.value,
          );

          const transfer: ValueTransfer = deepFreeze({
            transferId: `broadcast-${definition.id}-${payerKey}->${targetKey}-${transfers.length + 1}`,
            mode: "broadcast",
            sourcePosition: payer.position,
            sourceSymbolId: payer.symbolId,
            targetPosition: targetPos,
            targetSymbolId: targetCell.symbolId,
            transferredValue: payer.value,
            appliedMultiplier: 1,
            effectiveTransferredValue: payer.value,
            sourceConsumed: sourcePersistence === "consume",
            configId: definition.id,
          });
          transfers.push(transfer);

          for (const p of [payer.position, targetPos]) {
            const pk = positionKey(p);
            if (!affectedCoords.has(pk)) {
              affectedCoords.add(pk);
              affectedCells.push(p);
            }
          }
        }
      }

      if (sourcePersistence === "consume") {
        nextCellValues[payerKey] = deepFreeze({
          ...nextCellValues[payerKey]!,
          consumed: true,
        });
      }
    }

    const nextValueState: ValueState = deepFreeze({
      ...valueState,
      cellValuesByCoord: nextCellValues,
      lastTransfers: transfers,
    });

    return deepFreeze({
      operationType: "broadcastValues",
      sourceConfigId: definition.id,
      multiplierState,
      valueState: nextValueState,
      affectedCells,
      transferredValues: transfers,
      multiplierContributors: [],
      effectiveMultiplier: 1,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: "spin",
      detail: {
        transfers,
        totalBroadcastValue,
        updatedTargetValuesByCoord,
      },
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 7. MULTIPLIER METERS                                                     */
  /* ------------------------------------------------------------------------ */

  public initializeMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    definition: MultiplierMeterDefinition,
  ): MultiplierValueResult<MultiplierMeter> {
    if (
      !definition ||
      typeof definition.meterId !== "string" ||
      definition.meterId.trim().length === 0
    ) {
      throw new InvalidMultiplierMeterError(
        "initializeMeter requires a non-empty meterId.",
      );
    }
    const startingValue = assertPositiveFiniteNumber(
      definition.startingValue,
      "startingValue",
      InvalidMultiplierMeterError,
    );
    const minValue =
      definition.minValue !== undefined
        ? assertPositiveFiniteNumber(
            definition.minValue,
            "minValue",
            InvalidMultiplierMeterError,
          )
        : startingValue;
    const maxValue =
      definition.maxValue !== undefined
        ? assertPositiveFiniteNumber(
            definition.maxValue,
            "maxValue",
            InvalidMultiplierMeterError,
          )
        : null;
    if (maxValue !== null && maxValue < minValue) {
      throw new InvalidMultiplierMeterError(
        "MultiplierMeter maxValue must be >= minValue.",
        { minValue, maxValue },
      );
    }
    if (
      definition.scope !== "spin" &&
      definition.scope !== "feature" &&
      definition.scope !== "session"
    ) {
      throw new InvalidMultiplierMeterError(
        `Invalid MultiplierMeter scope "${String(definition.scope)}".`,
        { scope: definition.scope },
      );
    }
    const stepAmount =
      definition.stepAmount !== undefined
        ? assertPositiveFiniteNumber(
            definition.stepAmount,
            "stepAmount",
            InvalidMultiplierMeterError,
          )
        : 1;

    const clampedStart =
      maxValue !== null
        ? Math.min(Math.max(startingValue, minValue), maxValue)
        : Math.max(startingValue, minValue);

    const meter: MultiplierMeter = deepFreeze({
      meterId: definition.meterId,
      currentValue: roundCurrency(clampedStart),
      startingValue: roundCurrency(startingValue),
      minValue: roundCurrency(minValue),
      maxValue: maxValue !== null ? roundCurrency(maxValue) : null,
      scope: definition.scope,
      persistence: definition.persistence ?? definition.scope,
      stepAmount: roundCurrency(stepAmount),
      settlementBehavior: definition.settlementBehavior ?? "retain",
      active: true,
    });

    const prevMeter = multiplierState.metersById[definition.meterId];
    const nextMeters = {
      ...multiplierState.metersById,
      [definition.meterId]: meter,
    };

    const nextMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      metersById: nextMeters,
    });

    return deepFreeze({
      operationType: "initializeMeter",
      sourceConfigId: definition.meterId,
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: [
        {
          sourceType: "meter",
          sourceId: meter.meterId,
          value: meter.currentValue,
        },
      ],
      effectiveMultiplier: meter.currentValue,
      meterChanges: [
        {
          meterId: meter.meterId,
          before: prevMeter?.currentValue ?? meter.startingValue,
          after: meter.currentValue,
        },
      ],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: meter.persistence,
      detail: meter,
    });
  }

  public stepMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
    steps = 1,
  ): MultiplierValueResult<MultiplierMeter> {
    const meter = multiplierState.metersById[meterId];
    if (!meter) {
      throw new InvalidMultiplierMeterError(
        `MultiplierMeter "${meterId}" does not exist.`,
        { meterId },
      );
    }
    if (!Number.isInteger(steps) || steps <= 0) {
      throw new InvalidMultiplierMeterError(
        "stepMeter steps must be a positive integer.",
        { steps },
      );
    }
    return this.addMeterValue(
      multiplierState,
      valueState,
      meterId,
      roundCurrency(meter.stepAmount * steps),
    );
  }

  public addMeterValue(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
    delta: number,
  ): MultiplierValueResult<MultiplierMeter> {
    const meter = multiplierState.metersById[meterId];
    if (!meter) {
      throw new InvalidMultiplierMeterError(
        `MultiplierMeter "${meterId}" does not exist.`,
        { meterId },
      );
    }
    if (typeof delta !== "number" || !Number.isFinite(delta)) {
      throw new InvalidMultiplierMeterError(
        "addMeterValue delta must be a finite number.",
        { delta },
      );
    }
    return this.setMeterValue(
      multiplierState,
      valueState,
      meterId,
      roundCurrency(meter.currentValue + delta),
    );
  }

  public setMeterValue(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
    newValue: number,
  ): MultiplierValueResult<MultiplierMeter> {
    const meter = multiplierState.metersById[meterId];
    if (!meter) {
      throw new InvalidMultiplierMeterError(
        `MultiplierMeter "${meterId}" does not exist.`,
        { meterId },
      );
    }
    assertPositiveFiniteNumber(
      newValue,
      "newValue",
      InvalidMultiplierMeterError,
    );

    let clamped = Math.max(newValue, meter.minValue);
    if (meter.maxValue !== null) {
      clamped = Math.min(clamped, meter.maxValue);
    }
    clamped = roundCurrency(clamped);

    const updatedMeter: MultiplierMeter = deepFreeze({
      ...meter,
      currentValue: clamped,
    });

    const nextMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      metersById: {
        ...multiplierState.metersById,
        [meterId]: updatedMeter,
      },
    });

    return deepFreeze({
      operationType: "setMeterValue",
      sourceConfigId: meterId,
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: [
        {
          sourceType: "meter",
          sourceId: meterId,
          value: updatedMeter.currentValue,
        },
      ],
      effectiveMultiplier: updatedMeter.currentValue,
      meterChanges: [
        {
          meterId,
          before: meter.currentValue,
          after: updatedMeter.currentValue,
        },
      ],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: updatedMeter.persistence,
      detail: updatedMeter,
    });
  }

  public resetMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
  ): MultiplierValueResult<MultiplierMeter> {
    const meter = multiplierState.metersById[meterId];
    if (!meter) {
      throw new InvalidMultiplierMeterError(
        `MultiplierMeter "${meterId}" does not exist.`,
        { meterId },
      );
    }
    const res = this.setMeterValue(
      multiplierState,
      valueState,
      meterId,
      meter.startingValue,
    );
    return deepFreeze({
      ...res,
      operationType: "resetMeter",
    });
  }

  public harvestBoardMultipliersToMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
    options?: {
      readonly consumeHarvestedCellMultipliers?: boolean;
    },
  ): MultiplierValueResult<{
    readonly meter: MultiplierMeter;
    readonly harvestedPositions: readonly Position[];
    readonly harvestedTotal: number;
  }> {
    const meter = multiplierState.metersById[meterId];
    if (!meter) {
      throw new InvalidMultiplierMeterError(
        `MultiplierMeter "${meterId}" does not exist.`,
        { meterId },
      );
    }

    const consumeHarvested = options?.consumeHarvestedCellMultipliers ?? true;
    const nextCellMultipliers: Record<string, CellMultiplier[]> = {};
    const harvestedPositions: Position[] = [];
    let harvestedTotal = 0;

    const sortedKeys = Object.keys(
      multiplierState.cellMultipliersByCoord,
    ).sort();
    for (const key of sortedKeys) {
      const list = multiplierState.cellMultipliersByCoord[key]!;
      const updatedList: CellMultiplier[] = [];
      let harvestedOnCell = false;

      for (const cm of list) {
        if (cm.active) {
          harvestedTotal = roundCurrency(harvestedTotal + cm.value);
          harvestedOnCell = true;
          updatedList.push(
            consumeHarvested ? deepFreeze({ ...cm, active: false }) : cm,
          );
        } else {
          updatedList.push(cm);
        }
      }

      if (harvestedOnCell && list[0]) {
        harvestedPositions.push(list[0].position);
      }
      nextCellMultipliers[key] = updatedList;
    }

    const intermediateMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      cellMultipliersByCoord: nextCellMultipliers,
    });

    const stepped = this.addMeterValue(
      intermediateMultiplierState,
      valueState,
      meterId,
      harvestedTotal,
    );

    return deepFreeze({
      ...stepped,
      operationType: "harvestBoardMultipliersToMeter",
      affectedCells: harvestedPositions,
      detail: {
        meter: stepped.detail,
        harvestedPositions,
        harvestedTotal,
      },
    });
  }

  public settleMeter(
    multiplierState: MultiplierState,
    valueState: ValueState,
    meterId: string,
  ): MultiplierValueResult<{
    readonly appliedMultiplier: number;
    readonly meterAfterSettle: MultiplierMeter;
  }> {
    const meter = multiplierState.metersById[meterId];
    if (!meter) {
      throw new InvalidMultiplierMeterError(
        `MultiplierMeter "${meterId}" does not exist.`,
        { meterId },
      );
    }

    const appliedMultiplier = meter.currentValue;
    let nextMultiplierState = multiplierState;
    let meterAfterSettle = meter;
    const meterChanges: MeterChangeRecord[] = [];

    if (meter.settlementBehavior === "resetOnSettle") {
      meterAfterSettle = deepFreeze({
        ...meter,
        currentValue: meter.startingValue,
      });
      nextMultiplierState = deepFreeze({
        ...multiplierState,
        metersById: {
          ...multiplierState.metersById,
          [meterId]: meterAfterSettle,
        },
      });
      meterChanges.push({
        meterId,
        before: appliedMultiplier,
        after: meterAfterSettle.currentValue,
      });
    }

    return deepFreeze({
      operationType: "settleMeter",
      sourceConfigId: meterId,
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: [
        {
          sourceType: "meter",
          sourceId: meterId,
          value: appliedMultiplier,
        },
      ],
      effectiveMultiplier: appliedMultiplier,
      meterChanges,
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: meter.persistence,
      detail: {
        appliedMultiplier,
        meterAfterSettle,
      },
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 8. SYMBOL MULTIPLIER MEMORY                                              */
  /* ------------------------------------------------------------------------ */

  public recordSymbolMultiplierMemory(
    multiplierState: MultiplierState,
    valueState: ValueState,
    entries: readonly {
      readonly symbolId: SymbolId;
      readonly multiplier: number;
      readonly persistence?: MultiplierMemoryPersistence;
      readonly originConfigId?: string;
    }[],
  ): MultiplierValueResult<readonly MultiplierMemory[]> {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new InvalidMultiplierMemoryError(
        "recordSymbolMultiplierMemory requires a non-empty entries array.",
      );
    }

    const nextMemory: Record<SymbolId, MultiplierMemory> = {
      ...multiplierState.memoryBySymbolId,
    };
    const memoryChanges: MemoryChangeRecord[] = [];
    const updatedMemories: MultiplierMemory[] = [];

    for (const entry of entries) {
      if (!entry.symbolId || typeof entry.symbolId !== "string") {
        throw new InvalidMultiplierMemoryError(
          "SymbolMultiplierMemory entry requires a valid symbolId.",
        );
      }
      assertPositiveFiniteNumber(
        entry.multiplier,
        "entry.multiplier",
        InvalidMultiplierMemoryError,
      );

      const persistence = entry.persistence ?? "session";
      if (persistence !== "session" && persistence !== "consumeOnFirstPay") {
        throw new InvalidMultiplierMemoryError(
          `Invalid MultiplierMemoryPersistence "${String(persistence)}".`,
          { persistence },
        );
      }

      const prev = nextMemory[entry.symbolId];
      // Remember the best multiplier seen on the symbol (or replace if previously consumed)
      const prevActiveMultiplier =
        prev && !prev.consumed ? prev.rememberedMultiplier : 0;
      const bestMultiplier = roundCurrency(
        Math.max(prevActiveMultiplier, entry.multiplier),
      );

      const mem: MultiplierMemory = deepFreeze({
        symbolId: entry.symbolId,
        rememberedMultiplier: bestMultiplier,
        persistence,
        consumed: false,
        originConfigId: entry.originConfigId ?? "symbol-multiplier-memory",
      });

      nextMemory[entry.symbolId] = mem;
      updatedMemories.push(mem);
      memoryChanges.push({
        symbolId: entry.symbolId,
        before: prev ? prev.rememberedMultiplier : null,
        after: bestMultiplier,
        consumed: false,
      });
    }

    const nextMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      memoryBySymbolId: nextMemory,
    });

    return deepFreeze({
      operationType: "recordSymbolMultiplierMemory",
      sourceConfigId:
        entries[0]?.originConfigId ?? "symbol-multiplier-memory",
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: updatedMemories.map((m) => ({
        sourceType: "symbolMemory" as const,
        sourceId: m.symbolId,
        value: m.rememberedMultiplier,
      })),
      effectiveMultiplier: combineMultiplierValues(
        updatedMemories.map((m) => m.rememberedMultiplier),
        multiplierState.combinationRule,
      ),
      meterChanges: [],
      memoryChanges,
      ladderChanges: [],
      persistenceScope: "session",
      detail: updatedMemories,
    });
  }

  public resolveSymbolMultiplierMemory(
    multiplierState: MultiplierState,
    valueState: ValueState,
    winningSymbolIds: readonly SymbolId[],
    options?: {
      readonly consumeOnPay?: boolean;
      readonly combinationRule?: MultiplierCombinationRule;
    },
  ): MultiplierValueResult<{
    readonly appliedSymbolMultiplier: number;
    readonly matchedMemories: readonly MultiplierMemory[];
  }> {
    if (!Array.isArray(winningSymbolIds)) {
      throw new InvalidMultiplierMemoryError(
        "resolveSymbolMultiplierMemory requires an array of winningSymbolIds.",
      );
    }

    const nextMemory: Record<SymbolId, MultiplierMemory> = {
      ...multiplierState.memoryBySymbolId,
    };
    const matchedMemories: MultiplierMemory[] = [];
    const memoryChanges: MemoryChangeRecord[] = [];
    const seenSymbols = new Set<SymbolId>();

    for (const symId of winningSymbolIds) {
      if (seenSymbols.has(symId)) {
        continue;
      }
      seenSymbols.add(symId);

      const mem = nextMemory[symId];
      if (!mem || mem.consumed) {
        continue;
      }

      matchedMemories.push(mem);
      const shouldConsume =
        mem.persistence === "consumeOnFirstPay" &&
        (options?.consumeOnPay ?? true);

      if (shouldConsume) {
        const consumedMem: MultiplierMemory = deepFreeze({
          ...mem,
          consumed: true,
        });
        nextMemory[symId] = consumedMem;
        memoryChanges.push({
          symbolId: symId,
          before: mem.rememberedMultiplier,
          after: mem.rememberedMultiplier,
          consumed: true,
        });
      }
    }

    const appliedSymbolMultiplier = combineMultiplierValues(
      matchedMemories.map((m) => m.rememberedMultiplier),
      options?.combinationRule ?? multiplierState.combinationRule,
    );

    const nextMultiplierState: MultiplierState = deepFreeze({
      ...multiplierState,
      memoryBySymbolId: nextMemory,
    });

    return deepFreeze({
      operationType: "resolveSymbolMultiplierMemory",
      sourceConfigId: "symbol-multiplier-memory",
      multiplierState: nextMultiplierState,
      valueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: matchedMemories.map((m) => ({
        sourceType: "symbolMemory" as const,
        sourceId: m.symbolId,
        value: m.rememberedMultiplier,
      })),
      effectiveMultiplier: appliedSymbolMultiplier,
      meterChanges: [],
      memoryChanges,
      ladderChanges: [],
      persistenceScope: "session",
      detail: {
        appliedSymbolMultiplier,
        matchedMemories,
      },
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 9. COLLECT LADDERS                                                       */
  /* ------------------------------------------------------------------------ */

  public initializeCollectLadder(
    multiplierState: MultiplierState,
    valueState: ValueState,
    definition: CollectLadderDefinition,
  ): MultiplierValueResult<CollectLadder> {
    if (
      !definition ||
      typeof definition.ladderId !== "string" ||
      definition.ladderId.trim().length === 0 ||
      !Array.isArray(definition.rungs) ||
      definition.rungs.length === 0
    ) {
      throw new InvalidCollectLadderError(
        "initializeCollectLadder requires a valid ladderId and a non-empty rungs array.",
      );
    }

    const baseMultiplier =
      definition.baseMultiplier !== undefined
        ? assertPositiveFiniteNumber(
            definition.baseMultiplier,
            "baseMultiplier",
            InvalidCollectLadderError,
          )
        : 1;

    const normalizedRungs: CollectLadderRung[] = [];
    let prevThreshold = 0;

    for (let i = 0; i < definition.rungs.length; i += 1) {
      const r = definition.rungs[i]!;
      if (!Number.isInteger(r.threshold) || r.threshold <= prevThreshold) {
        throw new InvalidCollectLadderError(
          `CollectLadder "${definition.ladderId}" rungs must have strictly increasing integer thresholds.`,
          { ladderId: definition.ladderId, rungIndex: i, threshold: r.threshold },
        );
      }
      assertPositiveFiniteNumber(
        r.multiplier,
        "rung.multiplier",
        InvalidCollectLadderError,
      );
      prevThreshold = r.threshold;
      normalizedRungs.push(
        deepFreeze({
          rungIndex: i,
          threshold: r.threshold,
          multiplier: roundCurrency(r.multiplier),
          ...(r.retriggerActionId !== undefined
            ? { retriggerActionId: r.retriggerActionId }
            : {}),
          ...(r.awardedExtraSpins !== undefined
            ? { awardedExtraSpins: r.awardedExtraSpins }
            : {}),
        }),
      );
    }

    const ladder: CollectLadder = deepFreeze({
      ladderId: definition.ladderId,
      baseMultiplier: roundCurrency(baseMultiplier),
      rungs: normalizedRungs,
      collectorCount: 0,
      currentRungIndex: -1,
      currentMultiplier: roundCurrency(baseMultiplier),
      triggeredRungIndexes: [],
      scope: definition.scope ?? "feature",
    });

    const nextValueState: ValueState = deepFreeze({
      ...valueState,
      laddersById: {
        ...valueState.laddersById,
        [definition.ladderId]: ladder,
      },
    });

    return deepFreeze({
      operationType: "initializeCollectLadder",
      sourceConfigId: definition.ladderId,
      multiplierState,
      valueState: nextValueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: [
        {
          sourceType: "collectLadder",
          sourceId: ladder.ladderId,
          value: ladder.currentMultiplier,
        },
      ],
      effectiveMultiplier: ladder.currentMultiplier,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [
        {
          ladderId: ladder.ladderId,
          collectorCountBefore: 0,
          collectorCountAfter: 0,
          multiplierBefore: ladder.baseMultiplier,
          multiplierAfter: ladder.currentMultiplier,
          retriggerSignals: [],
        },
      ],
      persistenceScope: ladder.scope,
      detail: ladder,
    });
  }

  public advanceCollectLadder(
    multiplierState: MultiplierState,
    valueState: ValueState,
    ladderId: string,
    collectorCountDelta: number,
  ): MultiplierValueResult<{
    readonly ladder: CollectLadder;
    readonly retriggerSignals: readonly CollectLadderRetriggerSignal[];
  }> {
    const ladder = valueState.laddersById[ladderId];
    if (!ladder) {
      throw new InvalidCollectLadderError(
        `CollectLadder "${ladderId}" does not exist.`,
        { ladderId },
      );
    }
    if (!Number.isInteger(collectorCountDelta) || collectorCountDelta < 0) {
      throw new InvalidCollectLadderError(
        "collectorCountDelta must be a non-negative integer.",
        { collectorCountDelta },
      );
    }

    const countBefore = ladder.collectorCount;
    const countAfter = countBefore + collectorCountDelta;
    const multiplierBefore = ladder.currentMultiplier;

    const triggeredSet = new Set(ladder.triggeredRungIndexes);
    const retriggerSignals: CollectLadderRetriggerSignal[] = [];

    let nextRungIndex = ladder.currentRungIndex;
    let nextMultiplier = ladder.currentMultiplier;

    for (const rung of ladder.rungs) {
      if (countAfter >= rung.threshold) {
        nextRungIndex = rung.rungIndex;
        nextMultiplier = rung.multiplier;
        if (!triggeredSet.has(rung.rungIndex)) {
          triggeredSet.add(rung.rungIndex);
          if (
            rung.retriggerActionId !== undefined ||
            (rung.awardedExtraSpins !== undefined && rung.awardedExtraSpins > 0)
          ) {
            retriggerSignals.push(
              deepFreeze({
                ladderId,
                rungIndex: rung.rungIndex,
                threshold: rung.threshold,
                newMultiplier: rung.multiplier,
                retriggerActionId:
                  rung.retriggerActionId ?? `ladder-retrigger-${rung.rungIndex}`,
                awardedExtraSpins: rung.awardedExtraSpins ?? 0,
              }),
            );
          }
        }
      }
    }

    const updatedLadder: CollectLadder = deepFreeze({
      ...ladder,
      collectorCount: countAfter,
      currentRungIndex: nextRungIndex,
      currentMultiplier: nextMultiplier,
      triggeredRungIndexes: Array.from(triggeredSet).sort((a, b) => a - b),
    });

    const nextValueState: ValueState = deepFreeze({
      ...valueState,
      laddersById: {
        ...valueState.laddersById,
        [ladderId]: updatedLadder,
      },
    });

    const ladderChange: LadderChangeRecord = deepFreeze({
      ladderId,
      collectorCountBefore: countBefore,
      collectorCountAfter: countAfter,
      multiplierBefore,
      multiplierAfter: nextMultiplier,
      retriggerSignals,
    });

    return deepFreeze({
      operationType: "advanceCollectLadder",
      sourceConfigId: ladderId,
      multiplierState,
      valueState: nextValueState,
      affectedCells: [],
      transferredValues: [],
      multiplierContributors: [
        {
          sourceType: "collectLadder",
          sourceId: ladderId,
          value: nextMultiplier,
        },
      ],
      effectiveMultiplier: nextMultiplier,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [ladderChange],
      persistenceScope: updatedLadder.scope,
      detail: {
        ladder: updatedLadder,
        retriggerSignals,
      },
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 10. VALUE ABSORPTION                                                     */
  /* ------------------------------------------------------------------------ */

  public absorbValues(
    multiplierState: MultiplierState,
    valueState: ValueState,
    board: Board,
    definition: ValueAbsorptionDefinition,
    options?: {
      readonly boardState?: BoardState;
    },
  ): MultiplierValueResult<readonly ValueAbsorption[]> {
    if (
      !definition ||
      typeof definition.id !== "string" ||
      !Array.isArray(definition.collectorSymbolIds) ||
      definition.collectorSymbolIds.length === 0
    ) {
      throw new InvalidValueAbsorptionError(
        "absorbValues requires a ValueAbsorptionDefinition with non-empty collectorSymbolIds.",
      );
    }

    const collectorSet = new Set(definition.collectorSymbolIds);
    const eligibleSourceSet = definition.eligibleSourceSymbolIds
      ? new Set(definition.eligibleSourceSymbolIds)
      : null;
    const sourcePersistence = definition.sourcePersistence ?? "consume";
    const lockedCollectorBehavior: LockedCollectorBehavior =
      definition.lockedCollectorBehavior ?? "absorbWhileLocked";
    const respectLockedSources = definition.respectLockedSources ?? false;

    const activeLadder = definition.ladderId
      ? valueState.laddersById[definition.ladderId]
      : undefined;
    const ladderMultiplier = activeLadder?.currentMultiplier ?? 1;

    const nextCellValues: Record<string, CellValue> = {
      ...valueState.cellValuesByCoord,
    };

    const isCellLocked = (pos: Position, cell: Cell): boolean => {
      const k = positionKey(pos);
      return Boolean(
        cell.locked || options?.boardState?.locksByCoord[k]?.locked,
      );
    };

    const hasRequiredTags = (
      pos: Position,
      requiredTags?: readonly string[],
    ): boolean => {
      if (!requiredTags || requiredTags.length === 0) {
        return true;
      }
      if (!options?.boardState) {
        return false;
      }
      const k = positionKey(pos);
      const cellTags = options.boardState.tagsByCoord[k] ?? [];
      const tagSet = new Set(cellTags.map((t) => t.tag));
      return requiredTags.every((rt) => tagSet.has(rt));
    };

    const absorptions: ValueAbsorption[] = [];
    const allTransfers: ValueTransfer[] = [];
    const skippedLockedCollectors: Position[] = [];
    const activeCollectors: {
      readonly pos: Position;
      readonly cell: Cell;
    }[] = [];
    const affectedCoords = new Set<string>();
    const affectedCells: Position[] = [];

    for (let reelIndex = 0; reelIndex < board.cells.length; reelIndex += 1) {
      const col = board.cells[reelIndex]!;
      for (let rowIndex = 0; rowIndex < col.length; rowIndex += 1) {
        const collectorPos: Position = { reelIndex, rowIndex };
        const collectorCell = col[rowIndex]!;
        if (!collectorSet.has(collectorCell.symbolId)) {
          continue;
        }
        if (
          !isPositionInCollectionZone(
            board,
            collectorPos,
            definition.collectorZone,
            options?.boardState,
          )
        ) {
          continue;
        }
        if (!hasRequiredTags(collectorPos, definition.requiredCollectorTags)) {
          continue;
        }

        if (
          isCellLocked(collectorPos, collectorCell) &&
          lockedCollectorBehavior === "excludeWhileLocked"
        ) {
          skippedLockedCollectors.push(collectorPos);
          continue;
        }
        activeCollectors.push({ pos: collectorPos, cell: collectorCell });
      }
    }

    for (const activeCollector of activeCollectors) {
      const collectorPos = activeCollector.pos;
      const collectorCell = activeCollector.cell;
      {
        const collectorKey = positionKey(collectorPos);
        const existingCollectorCv = nextCellValues[collectorKey];
        const valueBefore = existingCollectorCv ? existingCollectorCv.value : 0;
        let absorbedDelta = 0;
        const collectorTransfers: ValueTransfer[] = [];
        const skippedProtectedSources: Position[] = [];

        const sortedSourceKeys = Object.keys(nextCellValues).sort();
        for (const sourceKey of sortedSourceKeys) {
          if (sourceKey === collectorKey) {
            continue;
          }
          const sourceCv = nextCellValues[sourceKey]!;
          if (sourceCv.consumed || sourceCv.value <= 0) {
            continue;
          }
          if (
            eligibleSourceSet !== null &&
            !eligibleSourceSet.has(sourceCv.symbolId)
          ) {
            continue;
          }
          if (
            !isPositionInCollectionZone(
              board,
              sourceCv.position,
              definition.sourceZone,
              options?.boardState,
            )
          ) {
            continue;
          }
          if (
            !hasRequiredTags(sourceCv.position, definition.requiredSourceTags)
          ) {
            continue;
          }

          const sourceBoardCell =
            board.cells[sourceCv.position.reelIndex]?.[
              sourceCv.position.rowIndex
            ];
          if (
            respectLockedSources &&
            sourceBoardCell &&
            isCellLocked(sourceCv.position, sourceBoardCell)
          ) {
            skippedProtectedSources.push(sourceCv.position);
            continue;
          }

          const shouldConsume =
            sourcePersistence === "consume" ||
            sourceCv.persistence === "consumeOnCollect";
          const effectiveAbsorbed = roundCurrency(
            sourceCv.value * ladderMultiplier,
          );

          const transfer: ValueTransfer = deepFreeze({
            transferId: `absorb-${definition.id}-${sourceKey}->${collectorKey}-${allTransfers.length + 1}`,
            mode: "absorb",
            sourcePosition: sourceCv.position,
            sourceSymbolId: sourceCv.symbolId,
            targetPosition: collectorPos,
            targetSymbolId: collectorCell.symbolId,
            transferredValue: sourceCv.value,
            appliedMultiplier: ladderMultiplier,
            effectiveTransferredValue: effectiveAbsorbed,
            sourceConsumed: shouldConsume,
            configId: definition.id,
          });

          collectorTransfers.push(transfer);
          allTransfers.push(transfer);
          absorbedDelta = roundCurrency(absorbedDelta + effectiveAbsorbed);

          if (shouldConsume) {
            nextCellValues[sourceKey] = deepFreeze({
              ...sourceCv,
              consumed: true,
            });
          }

          for (const p of [sourceCv.position, collectorPos]) {
            const pk = positionKey(p);
            if (!affectedCoords.has(pk)) {
              affectedCoords.add(pk);
              affectedCells.push(p);
            }
          }
        }

        const valueAfter = roundCurrency(valueBefore + absorbedDelta);
        nextCellValues[collectorKey] = deepFreeze({
          symbolId: collectorCell.symbolId,
          position: collectorPos,
          value: valueAfter,
          originConfigId: existingCollectorCv?.originConfigId ?? definition.id,
          persistence: existingCollectorCv?.persistence ?? "feature",
          consumed: false,
          isCollector: true,
        });

        absorptions.push(
          deepFreeze({
            configId: definition.id,
            collectorPosition: collectorPos,
            collectorSymbolId: collectorCell.symbolId,
            valueBefore,
            absorbedDelta,
            valueAfter,
            transfers: collectorTransfers,
            skippedLockedCollectors: [...skippedLockedCollectors],
            skippedProtectedSources,
          }),
        );
      }
    }

    const nextValueState: ValueState = deepFreeze({
      ...valueState,
      cellValuesByCoord: nextCellValues,
      lastTransfers: allTransfers,
      lastAbsorptions: absorptions,
    });

    return deepFreeze({
      operationType: "absorbValues",
      sourceConfigId: definition.id,
      multiplierState,
      valueState: nextValueState,
      affectedCells,
      transferredValues: allTransfers,
      multiplierContributors: activeLadder
        ? [
            {
              sourceType: "collectLadder",
              sourceId: activeLadder.ladderId,
              value: ladderMultiplier,
            },
          ]
        : [],
      effectiveMultiplier: ladderMultiplier,
      meterChanges: [],
      memoryChanges: [],
      ladderChanges: [],
      persistenceScope: "feature",
      detail: absorptions,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* SETTLEMENT CONTEXT, B13 BOARD SYNC, SCOPE BOUNDARIES & SNAPSHOT/RESTORE  */
  /* ------------------------------------------------------------------------ */

  public buildSettlementContext(
    multiplierState: MultiplierState,
    valueState: ValueState,
    params: {
      readonly baseWin: number;
      readonly winningPositions?: readonly Position[];
      readonly winningSymbolIds?: readonly SymbolId[];
      readonly activeMeterIds?: readonly string[];
      readonly consumeSymbolMemoryOnPay?: boolean;
      readonly settleMeters?: boolean;
      readonly globalCombinationRule?: MultiplierCombinationRule;
    },
  ): MultiplierValueResult<SettlementMultiplierContext> {
    assertNonNegativeFiniteNumber(
      params.baseWin,
      "baseWin",
      InvalidMultiplierConfigurationError,
    );

    let workingMultiplierState = multiplierState;
    const multiplierSources: MultiplierContributor[] = [];
    const contributingCells: Position[] = [];
    const seenCells = new Set<string>();
    const meterChanges: MeterChangeRecord[] = [];
    const memoryChanges: MemoryChangeRecord[] = [];

    // 1. Spin / Cell Multipliers
    const cellResolved = this.resolveSpinCellMultiplier(
      workingMultiplierState,
      {
        participatingPositions: params.winningPositions,
      },
    );
    const spinMultiplier = cellResolved.spinMultiplier;
    for (const c of cellResolved.contributors) {
      multiplierSources.push(c);
    }
    for (const pos of cellResolved.contributingPositions) {
      const k = positionKey(pos);
      if (!seenCells.has(k)) {
        seenCells.add(k);
        contributingCells.push(pos);
      }
    }

    // 2. Tumble Multiplier
    const tumbleMultiplier = this.getCurrentTumbleMultiplier(
      workingMultiplierState,
    );
    if (workingMultiplierState.tumbleState) {
      multiplierSources.push({
        sourceType: "tumble",
        sourceId: workingMultiplierState.tumbleState.configId,
        value: tumbleMultiplier,
      });
    }

    // 3. Feature Starting / Active Multiplier
    const featureMultiplier =
      workingMultiplierState.featureMultiplier?.currentMultiplier ?? 1;
    if (workingMultiplierState.featureMultiplier) {
      multiplierSources.push({
        sourceType: "feature",
        sourceId: workingMultiplierState.featureMultiplier.sourceConfigId,
        value: featureMultiplier,
      });
    }

    // 4. Multiplier Meters
    const meterIds =
      params.activeMeterIds ??
      Object.keys(workingMultiplierState.metersById).sort();
    const meterValues: number[] = [];
    for (const mId of meterIds) {
      const meter = workingMultiplierState.metersById[mId];
      if (!meter || !meter.active) {
        continue;
      }
      meterValues.push(meter.currentValue);
      multiplierSources.push({
        sourceType: "meter",
        sourceId: mId,
        value: meter.currentValue,
      });
      if (params.settleMeters) {
        const settled = this.settleMeter(
          workingMultiplierState,
          valueState,
          mId,
        );
        workingMultiplierState = settled.multiplierState;
        for (const mc of settled.meterChanges) {
          meterChanges.push(mc);
        }
      }
    }
    const meterMultiplier = combineMultiplierValues(
      meterValues,
      workingMultiplierState.combinationRule,
    );

    // 5. Symbol Multiplier Memory (only consumed if baseWin > 0 or winningSymbolIds provided)
    let symbolMemoryMultiplier = 1;
    if (
      params.winningSymbolIds &&
      params.winningSymbolIds.length > 0 &&
      params.baseWin > 0
    ) {
      const memRes = this.resolveSymbolMultiplierMemory(
        workingMultiplierState,
        valueState,
        params.winningSymbolIds,
        {
          consumeOnPay: params.consumeSymbolMemoryOnPay ?? true,
        },
      );
      workingMultiplierState = memRes.multiplierState;
      symbolMemoryMultiplier = memRes.detail.appliedSymbolMultiplier;
      for (const c of memRes.multiplierContributors) {
        multiplierSources.push(c);
      }
      for (const mc of memRes.memoryChanges) {
        memoryChanges.push(mc);
      }
    }

    // 6. Compute Effective Settlement Multiplier (applied once at settlement)
    const activeFactorContributors: number[] = [];
    if (cellResolved.contributors.length > 0) {
      activeFactorContributors.push(spinMultiplier);
    }
    if (workingMultiplierState.tumbleState) {
      activeFactorContributors.push(tumbleMultiplier);
    }
    if (workingMultiplierState.featureMultiplier) {
      activeFactorContributors.push(featureMultiplier);
    }
    if (meterValues.length > 0) {
      activeFactorContributors.push(meterMultiplier);
    }
    if (symbolMemoryMultiplier > 1) {
      activeFactorContributors.push(symbolMemoryMultiplier);
    }

    const globalRule = params.globalCombinationRule ?? "multiply";
    const effectiveMultiplier =
      activeFactorContributors.length > 0
        ? combineMultiplierValues(activeFactorContributors, globalRule)
        : 1;

    // 7. Value Totals
    let assignedValueTotal = 0;
    const sortedValueKeys = Object.keys(valueState.cellValuesByCoord).sort();
    for (const k of sortedValueKeys) {
      const cv = valueState.cellValuesByCoord[k]!;
      if (!cv.consumed) {
        assignedValueTotal = roundCurrency(assignedValueTotal + cv.value);
        if (!seenCells.has(k)) {
          seenCells.add(k);
          contributingCells.push(cv.position);
        }
      }
    }

    let collectedValueTotal = 0;
    for (const tr of valueState.lastTransfers) {
      if (tr.mode === "collect") {
        collectedValueTotal = roundCurrency(
          collectedValueTotal + tr.effectiveTransferredValue,
        );
      }
    }

    let absorbedValueTotal = 0;
    for (const ab of valueState.lastAbsorptions) {
      absorbedValueTotal = roundCurrency(absorbedValueTotal + ab.valueAfter);
    }

    const settledWinAmount = roundCurrency(
      params.baseWin * effectiveMultiplier,
    );

    const context: SettlementMultiplierContext = deepFreeze({
      baseWin: roundCurrency(params.baseWin),
      spinMultiplier,
      tumbleMultiplier,
      featureMultiplier,
      meterMultiplier,
      symbolMemoryMultiplier,
      effectiveMultiplier,
      settledWinAmount,
      assignedValueTotal,
      collectedValueTotal,
      absorbedValueTotal,
      valueTransfers: valueState.lastTransfers,
      contributingCells,
      multiplierSources,
    });

    return deepFreeze({
      operationType: "buildSettlementContext",
      sourceConfigId: "settlement-context",
      multiplierState: workingMultiplierState,
      valueState,
      affectedCells: contributingCells,
      transferredValues: valueState.lastTransfers,
      multiplierContributors: multiplierSources,
      effectiveMultiplier,
      meterChanges,
      memoryChanges,
      ladderChanges: [],
      persistenceScope: "spin",
      detail: context,
    });
  }

  public syncWithBoardTransition(
    multiplierState: MultiplierState,
    valueState: ValueState,
    transition: {
      readonly nextBoard: Board;
      readonly removedPositions?: readonly Position[];
      readonly movedCells?: readonly {
        readonly from: Position;
        readonly to: Position;
      }[];
      readonly shiftOffset?: {
        readonly reelShift: number;
        readonly rowShift: number;
      };
      readonly lockedCoords?: Readonly<Record<string, boolean>>;
    },
  ): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  } {
    const removedSet = new Set(
      (transition.removedPositions ?? []).map((p) => positionKey(p)),
    );
    const moveMap = new Map<string, Position>();
    for (const mv of transition.movedCells ?? []) {
      moveMap.set(positionKey(mv.from), mv.to);
    }
    const reelShift = transition.shiftOffset?.reelShift ?? 0;
    const rowShift = transition.shiftOffset?.rowShift ?? 0;

    const mapPosition = (pos: Position): Position | null => {
      const key = positionKey(pos);
      const isLocked = Boolean(transition.lockedCoords?.[key]);
      if (removedSet.has(key) && !isLocked) {
        return null;
      }
      if (moveMap.has(key)) {
        return moveMap.get(key)!;
      }
      const shifted: Position = {
        reelIndex: pos.reelIndex + reelShift,
        rowIndex: pos.rowIndex + rowShift,
      };
      if (!isPositionValidOnBoard(transition.nextBoard, shifted)) {
        return null;
      }
      return shifted;
    };

    const nextCellMultipliers: Record<string, CellMultiplier[]> = {};
    for (const [k, list] of Object.entries(
      multiplierState.cellMultipliersByCoord,
    )) {
      if (list.length === 0) continue;
      const mappedPos = mapPosition(list[0]!.position);
      if (!mappedPos) {
        continue;
      }
      const newKey = positionKey(mappedPos);
      nextCellMultipliers[newKey] = list.map((cm) =>
        deepFreeze({
          ...cm,
          position: mappedPos,
        }),
      );
      void k;
    }

    const nextCellValues: Record<string, CellValue> = {};
    for (const [, cv] of Object.entries(valueState.cellValuesByCoord)) {
      const mappedPos = mapPosition(cv.position);
      if (!mappedPos) {
        continue;
      }
      const newKey = positionKey(mappedPos);
      nextCellValues[newKey] = deepFreeze({
        ...cv,
        position: mappedPos,
      });
    }

    return Object.freeze({
      multiplierState: deepFreeze({
        ...multiplierState,
        cellMultipliersByCoord: nextCellMultipliers,
      }),
      valueState: deepFreeze({
        ...valueState,
        cellValuesByCoord: nextCellValues,
      }),
    });
  }

  public clearSpinState(
    multiplierState: MultiplierState,
    valueState: ValueState,
  ): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  } {
    // Retain only feature/session cell multipliers
    const retainedCellMultipliers: Record<string, CellMultiplier[]> = {};
    for (const [k, list] of Object.entries(
      multiplierState.cellMultipliersByCoord,
    )) {
      const kept = list.filter(
        (cm) => cm.scope === "feature" || cm.scope === "session",
      );
      if (kept.length > 0) {
        retainedCellMultipliers[k] = kept;
      }
    }

    // Reset spin-scoped meters; retain feature & session meters
    const nextMeters: Record<string, MultiplierMeter> = {};
    for (const [mId, meter] of Object.entries(multiplierState.metersById)) {
      if (meter.persistence === "spin") {
        nextMeters[mId] = deepFreeze({
          ...meter,
          currentValue: meter.startingValue,
        });
      } else {
        nextMeters[mId] = meter;
      }
    }

    // Retain only feature/session cell values (that are not consumed)
    const retainedCellValues: Record<string, CellValue> = {};
    for (const [k, cv] of Object.entries(valueState.cellValuesByCoord)) {
      if (
        !cv.consumed &&
        (cv.persistence === "feature" || cv.persistence === "session")
      ) {
        retainedCellValues[k] = cv;
      }
    }

    // Reset spin-scoped ladders; retain feature & session ladders
    const nextLadders: Record<string, CollectLadder> = {};
    for (const [lId, ladder] of Object.entries(valueState.laddersById)) {
      if (ladder.scope === "spin") {
        nextLadders[lId] = deepFreeze({
          ...ladder,
          collectorCount: 0,
          currentRungIndex: -1,
          currentMultiplier: ladder.baseMultiplier,
          triggeredRungIndexes: [],
        });
      } else {
        nextLadders[lId] = ladder;
      }
    }

    return Object.freeze({
      multiplierState: deepFreeze({
        ...multiplierState,
        cellMultipliersByCoord: retainedCellMultipliers,
        tumbleState: null,
        metersById: nextMeters,
      }),
      valueState: deepFreeze({
        cellValuesByCoord: retainedCellValues,
        laddersById: nextLadders,
        lastTransfers: [],
        lastAbsorptions: [],
      }),
    });
  }

  public clearFeatureState(
    multiplierState: MultiplierState,
    valueState: ValueState,
  ): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  } {
    const spinCleared = this.clearSpinState(multiplierState, valueState);

    // Retain only session cell multipliers
    const retainedCellMultipliers: Record<string, CellMultiplier[]> = {};
    for (const [k, list] of Object.entries(
      spinCleared.multiplierState.cellMultipliersByCoord,
    )) {
      const kept = list.filter((cm) => cm.scope === "session");
      if (kept.length > 0) {
        retainedCellMultipliers[k] = kept;
      }
    }

    // Reset feature-scoped meters; retain session meters
    const nextMeters: Record<string, MultiplierMeter> = {};
    for (const [mId, meter] of Object.entries(
      spinCleared.multiplierState.metersById,
    )) {
      if (meter.persistence === "feature") {
        nextMeters[mId] = deepFreeze({
          ...meter,
          currentValue: meter.startingValue,
        });
      } else {
        nextMeters[mId] = meter;
      }
    }

    // Retain only session cell values
    const retainedCellValues: Record<string, CellValue> = {};
    for (const [k, cv] of Object.entries(
      spinCleared.valueState.cellValuesByCoord,
    )) {
      if (!cv.consumed && cv.persistence === "session") {
        retainedCellValues[k] = cv;
      }
    }

    // Reset feature-scoped ladders; retain session ladders
    const nextLadders: Record<string, CollectLadder> = {};
    for (const [lId, ladder] of Object.entries(
      spinCleared.valueState.laddersById,
    )) {
      if (ladder.scope === "feature") {
        nextLadders[lId] = deepFreeze({
          ...ladder,
          collectorCount: 0,
          currentRungIndex: -1,
          currentMultiplier: ladder.baseMultiplier,
          triggeredRungIndexes: [],
        });
      } else {
        nextLadders[lId] = ladder;
      }
    }

    return Object.freeze({
      multiplierState: deepFreeze({
        ...spinCleared.multiplierState,
        cellMultipliersByCoord: retainedCellMultipliers,
        featureMultiplier: null,
        metersById: nextMeters,
      }),
      valueState: deepFreeze({
        cellValuesByCoord: retainedCellValues,
        laddersById: nextLadders,
        lastTransfers: [],
        lastAbsorptions: [],
      }),
    });
  }

  public snapshotState(
    multiplierState: MultiplierState,
    valueState: ValueState,
  ): MultiplierValueStateSnapshot {
    const cloned = JSON.parse(
      JSON.stringify({
        version: 1,
        multiplierState,
        valueState,
      }),
    ) as MultiplierValueStateSnapshot;
    return deepFreeze(cloned);
  }

  public restoreState(snapshot: MultiplierValueStateSnapshot): {
    readonly multiplierState: MultiplierState;
    readonly valueState: ValueState;
  } {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.version !== 1 ||
      !snapshot.multiplierState ||
      !snapshot.valueState
    ) {
      throw new InvalidMultiplierConfigurationError(
        "Invalid MultiplierValueStateSnapshot provided to restoreState.",
      );
    }

    const cloned = JSON.parse(JSON.stringify(snapshot)) as {
      readonly multiplierState: MultiplierState;
      readonly valueState: ValueState;
    };

    return Object.freeze({
      multiplierState: deepFreeze(cloned.multiplierState),
      valueState: deepFreeze(cloned.valueState),
    });
  }
}

export function createMultiplierValueEngine(): MultiplierValueEngine {
  return new DeterministicMultiplierValueEngine();
}
