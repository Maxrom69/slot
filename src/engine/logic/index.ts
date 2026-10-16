/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B15 — Meters & Feature Logic Engine
 *
 * Dedicated, deterministic backend subsystem coordinating:
 *  1. Meters & Counters (named meters counting symbols landed, wins taken, spins
 *     played, or any normalized engine event across spin/feature/session scopes)
 *  2. Threshold Triggers (deterministic numeric-order threshold evaluation firing
 *     prize awards, feature entry, feature upgrades, or action sequences without
 *     unintended refiring)
 *  3. Tiered Outcomes (meter-driven outcome ladders resolved in authored numeric
 *     order from the meter's current value)
 *  4. Weighted Outcome Choice (unbiased deterministic selection from positive-weight
 *     outcome pools via B03 RandomSource)
 *  5. Chance-Driven Events (reusable chance gates where 0% never fires, 100% always
 *     fires, and intermediate probabilities use B03 RandomSource)
 *  6. Losing-Spin Triggers (evaluates the actual settled spin win across paylines,
 *     ways, clusters, pay-anywhere, scatters, and B14 values/multipliers)
 *  7. Ordered / Nested Actions & Inline Board Actions (sequential action pipeline
 *     where each action observes the previous action's state/board result, inline
 *     board mutations delegate to B13 BoardDynamicsEngine, feature requests delegate
 *     to B12 FeatureEngine, and nested sequences enforce recursion/cycle limits)
 *
 * Zero Math.random() or Date.now() usage. Zero browser/DOM dependencies.
 * Zero duplicated RNG, Reel, Win, Multiplier, Board Dynamics, or Feature lifecycle logic.
 */

import type { Position } from "../board";
import type { FeatureId, SymbolId } from "../config";
import type {
  BoardState,
  ChangedCellRecord,
  DeterministicBoardDynamicsEngine,
  DuplicationRequest,
  InsertedCellRecord,
  LaneSweepRequest,
  LockCellSpec,
  MysteryResolutionRequest,
  MysteryResolvedCellRecord,
  PlacementRequest,
  RemovalRequest,
  RemovedCellRecord,
  ResizeRequest,
  TagPositionsRequest,
} from "../dynamics";
import { createBoardDynamicsEngine } from "../dynamics";
import {
  ActionRecursionLimitExceededError,
  InvalidChanceGateError,
  InvalidFeatureLogicConfigurationError,
  InvalidLogicActionError,
  InvalidLogicMeterError,
  InvalidLosingSpinConditionError,
  InvalidThresholdConfigurationError,
  InvalidTieredOutcomeConfigurationError,
  InvalidWeightedOutcomeError,
} from "../errors";
import type { EvaluationResult } from "../evaluation";
import type {
  DeterministicFeatureEngine,
  FeatureRuntimeState,
} from "../features";
import type { SettlementMultiplierContext } from "../multipliers";
import { roundCurrency } from "../paytable";
import type {
  RandomSource,
  RngStateSnapshot,
  WeightedItem,
} from "../rng";

/* -------------------------------------------------------------------------- */
/* CORE TYPES & CONTRACTS                                                     */
/* -------------------------------------------------------------------------- */

export type MeterScope = "spin" | "feature" | "session";
export type MeterResetBehavior =
  | "onBoundary"
  | "onThresholdReached"
  | "manualOnly";

export interface MeterEventFilter {
  readonly eventType: string;
  readonly symbolIds?: readonly SymbolId[];
  readonly minAmount?: number;
  readonly stepPerMatch?: number;
}

export interface ThresholdDefinition {
  readonly thresholdId: string;
  readonly threshold: number;
  readonly repeatable?: boolean;
  readonly resetMeterOnFire?: boolean;
  readonly actions: readonly FeatureLogicAction[];
}

export interface TieredOutcomeDefinition {
  readonly tierId: string;
  readonly threshold: number;
  readonly outcomeId: string;
  readonly actions?: readonly FeatureLogicAction[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MeterDefinition {
  readonly meterId: string;
  readonly startingValue: number;
  readonly scope: MeterScope;
  readonly eventSource?: MeterEventFilter;
  readonly resetBehavior?: MeterResetBehavior;
  readonly minValue?: number;
  readonly maxValue?: number;
  readonly thresholds?: readonly ThresholdDefinition[];
  readonly tieredOutcomes?: readonly TieredOutcomeDefinition[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MeterRuntimeState {
  readonly meterId: string;
  readonly startingValue: number;
  readonly currentValue: number;
  readonly scope: MeterScope;
  readonly eventSource: MeterEventFilter | null;
  readonly resetBehavior: MeterResetBehavior;
  readonly minValue: number;
  readonly maxValue: number | null;
  readonly thresholds: readonly ThresholdDefinition[];
  readonly firedThresholdIds: readonly string[];
  readonly tieredOutcomes: readonly TieredOutcomeDefinition[];
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface MeterEvent {
  readonly eventType: string;
  readonly count?: number;
  readonly symbolId?: SymbolId;
  readonly symbolIds?: readonly SymbolId[];
  readonly winAmount?: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ThresholdResult {
  readonly meterId: string;
  readonly thresholdId: string;
  readonly threshold: number;
  readonly fired: boolean;
  readonly valueAtEvaluation: number;
  readonly actionsTriggered: readonly FeatureLogicAction[];
}

export interface SelectedTierResult {
  readonly meterId: string;
  readonly meterValue: number;
  readonly selectedTier: TieredOutcomeDefinition | null;
  readonly qualifyingTiers: readonly TieredOutcomeDefinition[];
}

export interface OutcomeDefinition {
  readonly outcomeId: string;
  readonly label?: string;
  readonly actions?: readonly FeatureLogicAction[];
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface WeightedOutcome extends OutcomeDefinition {
  readonly weight: number;
}

export interface ChanceGate {
  readonly gateId: string;
  /** Probability in [0, 1] when unit === "ratio" (default), or [0, 100] when unit === "percent". */
  readonly probability: number;
  readonly unit?: "ratio" | "percent";
}

export interface ChanceGateEvaluationResult {
  readonly gateId: string;
  readonly probability: number;
  readonly normalizedProbability: number;
  readonly passed: boolean;
  readonly sampleValue: number | null;
  readonly rngUsage?: LogicRngUsage;
}

export interface SettledSpinOutcomeSummary {
  readonly settledTotalWin?: number;
  readonly paylineWin?: number;
  readonly waysWin?: number;
  readonly clusterWin?: number;
  readonly payAnywhereWin?: number;
  readonly scatterWin?: number;
  readonly assignedOrCollectedValueWin?: number;
  readonly evaluationResult?: EvaluationResult;
  readonly settlementContext?: SettlementMultiplierContext;
}

export interface FeatureCondition {
  readonly conditionId: string;
  readonly kind: "losingSpin" | "meterAtLeast" | "flagEquals";
  readonly meterId?: string;
  readonly minMeterValue?: number;
  readonly flagKey?: string;
  readonly expectedFlagValue?: string | number | boolean;
  readonly chanceGate?: ChanceGate;
  readonly actions: readonly FeatureLogicAction[];
}

export type InlineBoardOperationSpec =
  | {
      readonly kind: "placeSymbols";
      readonly spec: PlacementRequest;
    }
  | {
      readonly kind: "removeCells";
      readonly spec: RemovalRequest;
    }
  | {
      readonly kind: "resolveMysteries";
      readonly config: MysteryResolutionRequest;
    }
  | {
      readonly kind: "duplicateSymbols";
      readonly config: DuplicationRequest;
    }
  | {
      readonly kind: "applyLaneSweep";
      readonly config: LaneSweepRequest;
    }
  | {
      readonly kind: "resizeBoard";
      readonly config: ResizeRequest;
    }
  | {
      readonly kind: "applyLocks";
      readonly locks: readonly LockCellSpec[];
    }
  | {
      readonly kind: "tagPositions";
      readonly config: TagPositionsRequest;
    };

export interface FeatureLogicRequest {
  readonly requestId: string;
  readonly requestType:
    | "enterFeature"
    | "upgradeFeature"
    | "retriggerFeature"
    | "awardFeaturePrize";
  readonly featureId: FeatureId;
  readonly targetFeatureId?: FeatureId;
  readonly extraSpins?: number;
  readonly startingMultiplier?: number;
  readonly prizeCredits?: number;
}

export type FeatureLogicAction =
  | {
      readonly actionId: string;
      readonly type: "awardPrize";
      readonly prizeAmount: number;
      readonly prizeType?: "credits" | "betMultiplier";
    }
  | {
      readonly actionId: string;
      readonly type: "updateMeter";
      readonly meterId: string;
      readonly operation: "increment" | "set" | "reset";
      readonly value?: number;
    }
  | {
      readonly actionId: string;
      readonly type: "setFlag";
      readonly flagKey: string;
      readonly flagValue: string | number | boolean;
    }
  | {
      readonly actionId: string;
      readonly type: "inlineBoardAction";
      readonly boardOperation: InlineBoardOperationSpec;
    }
  | {
      readonly actionId: string;
      readonly type: "featureRequest";
      readonly requestType:
        | "enterFeature"
        | "upgradeFeature"
        | "retriggerFeature"
        | "awardFeaturePrize";
      readonly featureId: FeatureId;
      readonly targetFeatureId?: FeatureId;
      readonly extraSpins?: number;
      readonly startingMultiplier?: number;
      readonly prizeCredits?: number;
    }
  | {
      readonly actionId: string;
      readonly type: "weightedOutcomeAction";
      readonly poolId: string;
      readonly outcomes: readonly WeightedOutcome[];
    }
  | {
      readonly actionId: string;
      readonly type: "chanceGatedAction";
      readonly gate: ChanceGate;
      readonly thenActions: readonly FeatureLogicAction[];
      readonly elseActions?: readonly FeatureLogicAction[];
    }
  | {
      readonly actionId: string;
      readonly type: "nestedSequence";
      readonly sequenceId: string;
      readonly actions: readonly FeatureLogicAction[];
    };

export interface ActionSequence {
  readonly sequenceId: string;
  readonly actions: readonly FeatureLogicAction[];
  readonly maxDepth?: number;
}

export interface ActionResult {
  readonly actionId: string;
  readonly actionType: FeatureLogicAction["type"];
  readonly depth: number;
  readonly observedPreviousActionId: string | null;
  readonly observedBoardSymbolAtOrigin: SymbolId | null;
  readonly meterChange?: {
    readonly meterId: string;
    readonly before: number;
    readonly after: number;
  };
  readonly prizeAwarded?: number;
  readonly flagChanged?: {
    readonly flagKey: string;
    readonly value: string | number | boolean;
  };
  readonly boardActionSummary?: {
    readonly operationKind: InlineBoardOperationSpec["kind"];
    readonly affectedPositions: readonly Position[];
  };
  readonly featureRequestEmitted?: FeatureLogicRequest;
  readonly featureStateAfter?: FeatureRuntimeState;
  readonly selectedWeightedOutcome?: WeightedOutcome;
  readonly chanceGateResult?: ChanceGateEvaluationResult;
  readonly childActionResults: readonly ActionResult[];
}

export interface LogicRngUsage {
  readonly drawsConsumed: number;
  readonly rngStateBefore: RngStateSnapshot;
  readonly rngStateAfter: RngStateSnapshot;
}

export interface FeatureLogicState {
  readonly metersById: Readonly<Record<string, MeterRuntimeState>>;
  readonly flags: Readonly<Record<string, string | number | boolean>>;
  readonly totalAwardedPrizes: number;
  readonly pendingFeatureRequests: readonly FeatureLogicRequest[];
  readonly lastChanceResults: Readonly<
    Record<string, ChanceGateEvaluationResult>
  >;
  readonly lastWeightedOutcomes: Readonly<Record<string, WeightedOutcome>>;
}

export interface LogicSnapshot {
  readonly version: 1;
  readonly state: FeatureLogicState;
}

export interface LogicEvaluation<T = unknown> {
  readonly operationType: string;
  readonly conditionId?: string;
  readonly meterId?: string;
  readonly valueBefore?: number;
  readonly valueAfter?: number;
  readonly thresholdsEvaluated: readonly ThresholdResult[];
  readonly thresholdsFired: readonly ThresholdResult[];
  readonly selectedTier: SelectedTierResult | null;
  readonly selectedWeightedOutcome: WeightedOutcome | null;
  readonly chanceGateResult: ChanceGateEvaluationResult | null;
  readonly actionsExecuted: readonly ActionResult[];
  readonly boardState?: BoardState;
  readonly featureState?: FeatureRuntimeState;
  readonly nextState: FeatureLogicState;
  readonly rngUsage?: LogicRngUsage;
  readonly detail: T;
}

export interface ActionExecutionContext {
  readonly rng?: RandomSource;
  readonly boardState?: BoardState;
  readonly boardDynamicsEngine?: DeterministicBoardDynamicsEngine;
  readonly featureEngine?: DeterministicFeatureEngine;
  readonly featureState?: FeatureRuntimeState;
  readonly maxDepth?: number;
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

function validateScope(scope: unknown): MeterScope {
  if (scope !== "spin" && scope !== "feature" && scope !== "session") {
    throw new InvalidLogicMeterError(
      `Invalid MeterScope "${String(scope)}". Expected "spin", "feature", or "session".`,
      { scope },
    );
  }
  return scope;
}

function validateThresholds(
  meterId: string,
  thresholds?: readonly ThresholdDefinition[],
): readonly ThresholdDefinition[] {
  if (!thresholds || thresholds.length === 0) {
    return [];
  }
  const seenIds = new Set<string>();
  let prevValue = -Infinity;

  for (let i = 0; i < thresholds.length; i += 1) {
    const t = thresholds[i]!;
    if (
      !t ||
      typeof t.thresholdId !== "string" ||
      t.thresholdId.trim().length === 0
    ) {
      throw new InvalidThresholdConfigurationError(
        `Meter "${meterId}" threshold at index ${i} must have a non-empty thresholdId.`,
        { meterId, index: i },
      );
    }
    if (seenIds.has(t.thresholdId)) {
      throw new InvalidThresholdConfigurationError(
        `Meter "${meterId}" has duplicate thresholdId "${t.thresholdId}".`,
        { meterId, thresholdId: t.thresholdId },
      );
    }
    seenIds.add(t.thresholdId);

    if (
      typeof t.threshold !== "number" ||
      !Number.isFinite(t.threshold) ||
      t.threshold <= 0
    ) {
      throw new InvalidThresholdConfigurationError(
        `Meter "${meterId}" threshold "${t.thresholdId}" must be a positive finite number.`,
        { meterId, thresholdId: t.thresholdId, threshold: t.threshold },
      );
    }
    if (t.threshold < prevValue) {
      throw new InvalidThresholdConfigurationError(
        `Meter "${meterId}" thresholds must be authored in non-decreasing numeric order (found ${t.threshold} after ${prevValue}).`,
        { meterId, thresholdId: t.thresholdId, threshold: t.threshold, prevValue },
      );
    }
    if (!Array.isArray(t.actions)) {
      throw new InvalidThresholdConfigurationError(
        `Meter "${meterId}" threshold "${t.thresholdId}" must define an actions array.`,
        { meterId, thresholdId: t.thresholdId },
      );
    }
    prevValue = t.threshold;
  }

  return thresholds.map((t) => deepFreeze({ ...t, actions: [...t.actions] }));
}

function validateTieredOutcomes(
  meterId: string,
  tiers?: readonly TieredOutcomeDefinition[],
): readonly TieredOutcomeDefinition[] {
  if (!tiers || tiers.length === 0) {
    return [];
  }
  let prevThreshold = -Infinity;
  const seenIds = new Set<string>();

  for (let i = 0; i < tiers.length; i += 1) {
    const tier = tiers[i]!;
    if (
      !tier ||
      typeof tier.tierId !== "string" ||
      tier.tierId.trim().length === 0 ||
      typeof tier.outcomeId !== "string" ||
      tier.outcomeId.trim().length === 0
    ) {
      throw new InvalidTieredOutcomeConfigurationError(
        `Meter "${meterId}" tiered outcome at index ${i} requires non-empty tierId and outcomeId.`,
        { meterId, index: i },
      );
    }
    if (seenIds.has(tier.tierId)) {
      throw new InvalidTieredOutcomeConfigurationError(
        `Meter "${meterId}" has duplicate tierId "${tier.tierId}".`,
        { meterId, tierId: tier.tierId },
      );
    }
    seenIds.add(tier.tierId);

    if (
      typeof tier.threshold !== "number" ||
      !Number.isFinite(tier.threshold) ||
      tier.threshold < 0
    ) {
      throw new InvalidTieredOutcomeConfigurationError(
        `Meter "${meterId}" tier "${tier.tierId}" threshold must be a non-negative finite number.`,
        { meterId, tierId: tier.tierId, threshold: tier.threshold },
      );
    }
    if (tier.threshold <= prevThreshold) {
      throw new InvalidTieredOutcomeConfigurationError(
        `Meter "${meterId}" tiered outcomes must be authored in strictly increasing numeric order (found ${tier.threshold} after ${prevThreshold}).`,
        { meterId, tierId: tier.tierId, threshold: tier.threshold, prevThreshold },
      );
    }
    prevThreshold = tier.threshold;
  }

  return tiers.map((t) => deepFreeze({ ...t }));
}

/* -------------------------------------------------------------------------- */
/* FEATURE LOGIC ENGINE CONTRACT & IMPLEMENTATION                             */
/* -------------------------------------------------------------------------- */

export interface FeatureLogicEngine {
  createInitialState(): FeatureLogicState;

  /* 1. Meters & Counters */
  initializeMeter(
    state: FeatureLogicState,
    definition: MeterDefinition,
  ): LogicEvaluation<MeterRuntimeState>;

  getMeter(
    state: FeatureLogicState,
    meterId: string,
  ): MeterRuntimeState | undefined;

  incrementMeter(
    state: FeatureLogicState,
    meterId: string,
    delta?: number,
    context?: ActionExecutionContext,
  ): LogicEvaluation<MeterRuntimeState>;

  setMeter(
    state: FeatureLogicState,
    meterId: string,
    newValue: number,
    context?: ActionExecutionContext,
  ): LogicEvaluation<MeterRuntimeState>;

  resetMeter(
    state: FeatureLogicState,
    meterId: string,
  ): LogicEvaluation<MeterRuntimeState>;

  recordEvent(
    state: FeatureLogicState,
    event: MeterEvent,
    context?: ActionExecutionContext,
  ): LogicEvaluation<readonly MeterRuntimeState[]>;

  /* 2. Threshold Triggers */
  evaluateThresholds(
    state: FeatureLogicState,
    meterId: string,
    context?: ActionExecutionContext,
  ): LogicEvaluation<readonly ThresholdResult[]>;

  /* 3. Tiered Outcomes */
  resolveTieredOutcome(
    state: FeatureLogicState,
    meterId: string,
    context?: ActionExecutionContext & {
      readonly executeTierActions?: boolean;
    },
  ): LogicEvaluation<SelectedTierResult>;

  /* 4. Weighted Outcome Choice */
  selectWeightedOutcome(
    state: FeatureLogicState,
    poolId: string,
    outcomes: readonly WeightedOutcome[],
    rng: RandomSource,
    context?: ActionExecutionContext & {
      readonly executeSelectedActions?: boolean;
    },
  ): LogicEvaluation<WeightedOutcome>;

  /* 5. Chance-Driven Events */
  evaluateChanceGate(
    state: FeatureLogicState,
    gate: ChanceGate,
    rng?: RandomSource,
  ): LogicEvaluation<ChanceGateEvaluationResult>;

  /* 6. Losing-Spin Triggers */
  evaluateLosingSpinCondition(
    state: FeatureLogicState,
    condition: FeatureCondition,
    spinSummary: SettledSpinOutcomeSummary,
    context?: ActionExecutionContext,
  ): LogicEvaluation<{
    readonly triggered: boolean;
    readonly totalResolvedWin: number;
  }>;

  /* 7. Ordered / Nested Actions & Inline Board Actions */
  executeActionSequence(
    state: FeatureLogicState,
    sequence: ActionSequence,
    context?: ActionExecutionContext,
  ): LogicEvaluation<readonly ActionResult[]>;

  /* Scope Boundaries & Snapshot / Restore */
  clearSpinScope(state: FeatureLogicState): FeatureLogicState;
  clearFeatureScope(state: FeatureLogicState): FeatureLogicState;
  resetSessionScope(state: FeatureLogicState): FeatureLogicState;

  snapshot(state: FeatureLogicState): LogicSnapshot;
  restore(snapshot: LogicSnapshot): FeatureLogicState;
}

export class DeterministicFeatureLogicEngine implements FeatureLogicEngine {
  public createInitialState(): FeatureLogicState {
    return deepFreeze({
      metersById: {},
      flags: {},
      totalAwardedPrizes: 0,
      pendingFeatureRequests: [],
      lastChanceResults: {},
      lastWeightedOutcomes: {},
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 1. METERS & COUNTERS                                                     */
  /* ------------------------------------------------------------------------ */

  public initializeMeter(
    state: FeatureLogicState,
    definition: MeterDefinition,
  ): LogicEvaluation<MeterRuntimeState> {
    if (
      !definition ||
      typeof definition.meterId !== "string" ||
      definition.meterId.trim().length === 0
    ) {
      throw new InvalidLogicMeterError(
        "initializeMeter requires a non-empty meterId.",
      );
    }
    const scope = validateScope(definition.scope);

    if (
      typeof definition.startingValue !== "number" ||
      !Number.isFinite(definition.startingValue) ||
      definition.startingValue < 0
    ) {
      throw new InvalidLogicMeterError(
        `Meter "${definition.meterId}" startingValue must be a non-negative finite number.`,
        { startingValue: definition.startingValue },
      );
    }

    const minValue =
      definition.minValue !== undefined ? definition.minValue : 0;
    if (
      typeof minValue !== "number" ||
      !Number.isFinite(minValue) ||
      minValue < 0
    ) {
      throw new InvalidLogicMeterError(
        `Meter "${definition.meterId}" minValue must be a non-negative finite number.`,
        { minValue },
      );
    }

    const maxValue =
      definition.maxValue !== undefined ? definition.maxValue : null;
    if (
      maxValue !== null &&
      (typeof maxValue !== "number" ||
        !Number.isFinite(maxValue) ||
        maxValue < minValue)
    ) {
      throw new InvalidLogicMeterError(
        `Meter "${definition.meterId}" maxValue must be a finite number >= minValue.`,
        { minValue, maxValue },
      );
    }

    if (
      definition.startingValue < minValue ||
      (maxValue !== null && definition.startingValue > maxValue)
    ) {
      throw new InvalidLogicMeterError(
        `Meter "${definition.meterId}" startingValue (${definition.startingValue}) must fall within [minValue, maxValue].`,
        {
          startingValue: definition.startingValue,
          minValue,
          maxValue,
        },
      );
    }

    const thresholds = validateThresholds(
      definition.meterId,
      definition.thresholds,
    );
    const tieredOutcomes = validateTieredOutcomes(
      definition.meterId,
      definition.tieredOutcomes,
    );

    const meter: MeterRuntimeState = deepFreeze({
      meterId: definition.meterId,
      startingValue: roundCurrency(definition.startingValue),
      currentValue: roundCurrency(definition.startingValue),
      scope,
      eventSource: definition.eventSource
        ? deepFreeze({ ...definition.eventSource })
        : null,
      resetBehavior: definition.resetBehavior ?? "onBoundary",
      minValue: roundCurrency(minValue),
      maxValue: maxValue !== null ? roundCurrency(maxValue) : null,
      thresholds,
      firedThresholdIds: [],
      tieredOutcomes,
      metadata: definition.metadata ? deepFreeze({ ...definition.metadata }) : {},
    });

    const nextState: FeatureLogicState = deepFreeze({
      ...state,
      metersById: {
        ...state.metersById,
        [definition.meterId]: meter,
      },
    });

    return deepFreeze({
      operationType: "initializeMeter",
      meterId: meter.meterId,
      valueBefore: meter.startingValue,
      valueAfter: meter.currentValue,
      thresholdsEvaluated: [],
      thresholdsFired: [],
      selectedTier: null,
      selectedWeightedOutcome: null,
      chanceGateResult: null,
      actionsExecuted: [],
      nextState,
      detail: meter,
    });
  }

  public getMeter(
    state: FeatureLogicState,
    meterId: string,
  ): MeterRuntimeState | undefined {
    return state.metersById[meterId];
  }

  public incrementMeter(
    state: FeatureLogicState,
    meterId: string,
    delta = 1,
    context?: ActionExecutionContext,
  ): LogicEvaluation<MeterRuntimeState> {
    const meter = state.metersById[meterId];
    if (!meter) {
      throw new InvalidLogicMeterError(`Meter "${meterId}" does not exist.`, {
        meterId,
      });
    }
    if (typeof delta !== "number" || !Number.isFinite(delta)) {
      throw new InvalidLogicMeterError(
        `incrementMeter delta for "${meterId}" must be a finite number.`,
        { meterId, delta },
      );
    }
    return this.setMeter(
      state,
      meterId,
      roundCurrency(meter.currentValue + delta),
      context,
    );
  }

  public setMeter(
    state: FeatureLogicState,
    meterId: string,
    newValue: number,
    context?: ActionExecutionContext,
  ): LogicEvaluation<MeterRuntimeState> {
    const meter = state.metersById[meterId];
    if (!meter) {
      throw new InvalidLogicMeterError(`Meter "${meterId}" does not exist.`, {
        meterId,
      });
    }
    if (
      typeof newValue !== "number" ||
      !Number.isFinite(newValue) ||
      newValue < meter.minValue
    ) {
      throw new InvalidLogicMeterError(
        `Meter "${meterId}" value (${String(newValue)}) cannot be negative or less than minValue (${meter.minValue}).`,
        { meterId, newValue, minValue: meter.minValue },
      );
    }

    const valueBefore = meter.currentValue;
    let clamped = newValue;
    if (meter.maxValue !== null) {
      clamped = Math.min(clamped, meter.maxValue);
    }
    clamped = roundCurrency(clamped);

    const updatedMeter: MeterRuntimeState = deepFreeze({
      ...meter,
      currentValue: clamped,
    });

    const intermediateState: FeatureLogicState = deepFreeze({
      ...state,
      metersById: {
        ...state.metersById,
        [meterId]: updatedMeter,
      },
    });

    // Evaluate thresholds automatically in numeric order
    const thresholdEval = this.evaluateThresholds(
      intermediateState,
      meterId,
      context,
    );
    const finalMeter = thresholdEval.nextState.metersById[meterId]!;

    return deepFreeze({
      operationType: "setMeter",
      meterId,
      valueBefore,
      valueAfter: finalMeter.currentValue,
      thresholdsEvaluated: thresholdEval.thresholdsEvaluated,
      thresholdsFired: thresholdEval.thresholdsFired,
      selectedTier: null,
      selectedWeightedOutcome: null,
      chanceGateResult: null,
      actionsExecuted: thresholdEval.actionsExecuted,
      ...(thresholdEval.boardState
        ? { boardState: thresholdEval.boardState }
        : {}),
      ...(thresholdEval.featureState
        ? { featureState: thresholdEval.featureState }
        : {}),
      ...(thresholdEval.rngUsage ? { rngUsage: thresholdEval.rngUsage } : {}),
      nextState: thresholdEval.nextState,
      detail: finalMeter,
    });
  }

  public resetMeter(
    state: FeatureLogicState,
    meterId: string,
  ): LogicEvaluation<MeterRuntimeState> {
    const meter = state.metersById[meterId];
    if (!meter) {
      throw new InvalidLogicMeterError(`Meter "${meterId}" does not exist.`, {
        meterId,
      });
    }
    const valueBefore = meter.currentValue;
    const resetMeterState: MeterRuntimeState = deepFreeze({
      ...meter,
      currentValue: meter.startingValue,
      firedThresholdIds: [],
    });

    const nextState: FeatureLogicState = deepFreeze({
      ...state,
      metersById: {
        ...state.metersById,
        [meterId]: resetMeterState,
      },
    });

    return deepFreeze({
      operationType: "resetMeter",
      meterId,
      valueBefore,
      valueAfter: resetMeterState.currentValue,
      thresholdsEvaluated: [],
      thresholdsFired: [],
      selectedTier: null,
      selectedWeightedOutcome: null,
      chanceGateResult: null,
      actionsExecuted: [],
      nextState,
      detail: resetMeterState,
    });
  }

  public recordEvent(
    state: FeatureLogicState,
    event: MeterEvent,
    context?: ActionExecutionContext,
  ): LogicEvaluation<readonly MeterRuntimeState[]> {
    if (
      !event ||
      typeof event.eventType !== "string" ||
      event.eventType.trim().length === 0
    ) {
      throw new InvalidLogicMeterError(
        "recordEvent requires a MeterEvent with a non-empty eventType.",
      );
    }

    let workingState = state;
    let workingBoardState = context?.boardState;
    let workingFeatureState = context?.featureState;
    const updatedMeters: MeterRuntimeState[] = [];
    const allEvaluated: ThresholdResult[] = [];
    const allFired: ThresholdResult[] = [];
    const allActions: ActionResult[] = [];

    const sortedMeterIds = Object.keys(workingState.metersById).sort();
    for (const meterId of sortedMeterIds) {
      const meter = workingState.metersById[meterId]!;
      const src = meter.eventSource;
      if (!src || src.eventType !== event.eventType) {
        continue;
      }

      if (
        src.minAmount !== undefined &&
        (event.winAmount === undefined || event.winAmount < src.minAmount)
      ) {
        continue;
      }

      let matchCount = event.count ?? 1;
      if (src.symbolIds && src.symbolIds.length > 0) {
        const allowed = new Set(src.symbolIds);
        if (event.symbolIds && event.symbolIds.length > 0) {
          matchCount = event.symbolIds.filter((s) => allowed.has(s)).length;
        } else if (event.symbolId !== undefined) {
          matchCount = allowed.has(event.symbolId) ? (event.count ?? 1) : 0;
        } else {
          matchCount = 0;
        }
      }

      if (matchCount <= 0) {
        continue;
      }

      const step = src.stepPerMatch ?? 1;
      const delta = roundCurrency(matchCount * step);

      const incRes = this.incrementMeter(workingState, meterId, delta, {
        ...context,
        boardState: workingBoardState,
        featureState: workingFeatureState,
      });

      workingState = incRes.nextState;
      if (incRes.boardState) {
        workingBoardState = incRes.boardState;
      }
      if (incRes.featureState) {
        workingFeatureState = incRes.featureState;
      }
      updatedMeters.push(incRes.detail);
      allEvaluated.push(...incRes.thresholdsEvaluated);
      allFired.push(...incRes.thresholdsFired);
      allActions.push(...incRes.actionsExecuted);
    }

    return deepFreeze({
      operationType: "recordEvent",
      thresholdsEvaluated: allEvaluated,
      thresholdsFired: allFired,
      selectedTier: null,
      selectedWeightedOutcome: null,
      chanceGateResult: null,
      actionsExecuted: allActions,
      ...(workingBoardState ? { boardState: workingBoardState } : {}),
      ...(workingFeatureState ? { featureState: workingFeatureState } : {}),
      nextState: workingState,
      detail: updatedMeters,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 2. THRESHOLD EVALUATION                                                  */
  /* ------------------------------------------------------------------------ */

  public evaluateThresholds(
    state: FeatureLogicState,
    meterId: string,
    context?: ActionExecutionContext,
  ): LogicEvaluation<readonly ThresholdResult[]> {
    const meter = state.metersById[meterId];
    if (!meter) {
      throw new InvalidLogicMeterError(`Meter "${meterId}" does not exist.`, {
        meterId,
      });
    }

    let workingState = state;
    let workingBoardState = context?.boardState;
    let workingFeatureState = context?.featureState;
    const firedSet = new Set(meter.firedThresholdIds);
    const evaluated: ThresholdResult[] = [];
    const fired: ThresholdResult[] = [];
    const executedActions: ActionResult[] = [];
    let shouldResetAfter = false;

    // Evaluate authored thresholds in exact numeric order
    for (const t of meter.thresholds) {
      const currentMeter = workingState.metersById[meterId]!;
      const alreadyFired = firedSet.has(t.thresholdId);
      const qualifies =
        currentMeter.currentValue >= t.threshold &&
        (!alreadyFired || Boolean(t.repeatable));

      const result: ThresholdResult = deepFreeze({
        meterId,
        thresholdId: t.thresholdId,
        threshold: t.threshold,
        fired: qualifies,
        valueAtEvaluation: currentMeter.currentValue,
        actionsTriggered: qualifies ? t.actions : [],
      });
      evaluated.push(result);

      if (qualifies) {
        fired.push(result);
        firedSet.add(t.thresholdId);

        if (
          t.resetMeterOnFire ||
          currentMeter.resetBehavior === "onThresholdReached"
        ) {
          shouldResetAfter = true;
        }

        // Persist firedThresholdIds before running actions
        const meterWithFired: MeterRuntimeState = deepFreeze({
          ...currentMeter,
          firedThresholdIds: Array.from(firedSet),
        });
        workingState = deepFreeze({
          ...workingState,
          metersById: {
            ...workingState.metersById,
            [meterId]: meterWithFired,
          },
        });

        if (t.actions.length > 0) {
          const seqRes = this.executeActionSequence(
            workingState,
            {
              sequenceId: `threshold-seq-${meterId}-${t.thresholdId}`,
              actions: t.actions,
            },
            {
              ...context,
              boardState: workingBoardState,
              featureState: workingFeatureState,
            },
          );
          workingState = seqRes.nextState;
          if (seqRes.boardState) {
            workingBoardState = seqRes.boardState;
          }
          if (seqRes.featureState) {
            workingFeatureState = seqRes.featureState;
          }
          executedActions.push(...seqRes.actionsExecuted);
        }
      }
    }

    if (shouldResetAfter) {
      const latestMeter = workingState.metersById[meterId]!;
      const resetMeterObj: MeterRuntimeState = deepFreeze({
        ...latestMeter,
        currentValue: latestMeter.startingValue,
        firedThresholdIds: [],
      });
      workingState = deepFreeze({
        ...workingState,
        metersById: {
          ...workingState.metersById,
          [meterId]: resetMeterObj,
        },
      });
    }

    const finalMeter = workingState.metersById[meterId]!;

    return deepFreeze({
      operationType: "evaluateThresholds",
      meterId,
      valueBefore: meter.currentValue,
      valueAfter: finalMeter.currentValue,
      thresholdsEvaluated: evaluated,
      thresholdsFired: fired,
      selectedTier: null,
      selectedWeightedOutcome: null,
      chanceGateResult: null,
      actionsExecuted: executedActions,
      ...(workingBoardState ? { boardState: workingBoardState } : {}),
      ...(workingFeatureState ? { featureState: workingFeatureState } : {}),
      nextState: workingState,
      detail: evaluated,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 3. TIERED OUTCOMES                                                       */
  /* ------------------------------------------------------------------------ */

  public resolveTieredOutcome(
    state: FeatureLogicState,
    meterId: string,
    context?: ActionExecutionContext & {
      readonly executeTierActions?: boolean;
    },
  ): LogicEvaluation<SelectedTierResult> {
    const meter = state.metersById[meterId];
    if (!meter) {
      throw new InvalidLogicMeterError(`Meter "${meterId}" does not exist.`, {
        meterId,
      });
    }

    // Authored tiers are already validated in numeric order
    const qualifyingTiers: TieredOutcomeDefinition[] = [];
    for (const tier of meter.tieredOutcomes) {
      if (meter.currentValue >= tier.threshold) {
        qualifyingTiers.push(tier);
      }
    }

    const selectedTier =
      qualifyingTiers.length > 0
        ? qualifyingTiers[qualifyingTiers.length - 1]!
        : null;

    const tierResult: SelectedTierResult = deepFreeze({
      meterId,
      meterValue: meter.currentValue,
      selectedTier,
      qualifyingTiers,
    });

    let workingState = state;
    let workingBoardState = context?.boardState;
    let workingFeatureState = context?.featureState;
    const actionsExecuted: ActionResult[] = [];

    if (
      (context?.executeTierActions ?? true) &&
      selectedTier?.actions &&
      selectedTier.actions.length > 0
    ) {
      const seqRes = this.executeActionSequence(
        workingState,
        {
          sequenceId: `tier-seq-${meterId}-${selectedTier.tierId}`,
          actions: selectedTier.actions,
        },
        {
          ...context,
          boardState: workingBoardState,
          featureState: workingFeatureState,
        },
      );
      workingState = seqRes.nextState;
      if (seqRes.boardState) {
        workingBoardState = seqRes.boardState;
      }
      if (seqRes.featureState) {
        workingFeatureState = seqRes.featureState;
      }
      actionsExecuted.push(...seqRes.actionsExecuted);
    }

    return deepFreeze({
      operationType: "resolveTieredOutcome",
      meterId,
      valueBefore: meter.currentValue,
      valueAfter: workingState.metersById[meterId]?.currentValue ?? meter.currentValue,
      thresholdsEvaluated: [],
      thresholdsFired: [],
      selectedTier: tierResult,
      selectedWeightedOutcome: null,
      chanceGateResult: null,
      actionsExecuted,
      ...(workingBoardState ? { boardState: workingBoardState } : {}),
      ...(workingFeatureState ? { featureState: workingFeatureState } : {}),
      nextState: workingState,
      detail: tierResult,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 4. WEIGHTED OUTCOME CHOICE                                               */
  /* ------------------------------------------------------------------------ */

  public selectWeightedOutcome(
    state: FeatureLogicState,
    poolId: string,
    outcomes: readonly WeightedOutcome[],
    rng: RandomSource,
    context?: ActionExecutionContext & {
      readonly executeSelectedActions?: boolean;
    },
  ): LogicEvaluation<WeightedOutcome> {
    if (!poolId || typeof poolId !== "string" || poolId.trim().length === 0) {
      throw new InvalidWeightedOutcomeError(
        "selectWeightedOutcome requires a non-empty poolId.",
      );
    }
    if (!Array.isArray(outcomes) || outcomes.length === 0) {
      throw new InvalidWeightedOutcomeError(
        `Weighted outcome pool "${poolId}" must be a non-empty array.`,
        { poolId },
      );
    }
    if (!rng || typeof rng.weightedPick !== "function") {
      throw new InvalidWeightedOutcomeError(
        `selectWeightedOutcome for pool "${poolId}" requires a B03 RandomSource.`,
        { poolId },
      );
    }

    const weightedItems: WeightedItem<WeightedOutcome>[] = [];
    for (let i = 0; i < outcomes.length; i += 1) {
      const outcome = outcomes[i]!;
      if (
        !outcome ||
        typeof outcome.outcomeId !== "string" ||
        outcome.outcomeId.trim().length === 0
      ) {
        throw new InvalidWeightedOutcomeError(
          `Weighted outcome at index ${i} in pool "${poolId}" requires a non-empty outcomeId.`,
          { poolId, index: i },
        );
      }
      if (
        typeof outcome.weight !== "number" ||
        !Number.isFinite(outcome.weight) ||
        outcome.weight <= 0
      ) {
        throw new InvalidWeightedOutcomeError(
          `Weighted outcome "${outcome.outcomeId}" in pool "${poolId}" must have a positive finite weight.`,
          { poolId, outcomeId: outcome.outcomeId, weight: outcome.weight },
        );
      }
      weightedItems.push({
        value: deepFreeze({ ...outcome }),
        weight: outcome.weight,
      });
    }

    const rngBefore = rng.snapshot();
    const chosen = rng.weightedPick(weightedItems);
    const rngAfter = rng.snapshot();

    const rngUsage: LogicRngUsage = deepFreeze({
      drawsConsumed: rngAfter.drawCount - rngBefore.drawCount,
      rngStateBefore: rngBefore,
      rngStateAfter: rngAfter,
    });

    let workingState: FeatureLogicState = deepFreeze({
      ...state,
      lastWeightedOutcomes: {
        ...state.lastWeightedOutcomes,
        [poolId]: chosen,
      },
    });
    let workingBoardState = context?.boardState;
    let workingFeatureState = context?.featureState;
    const actionsExecuted: ActionResult[] = [];

    if (
      (context?.executeSelectedActions ?? true) &&
      chosen.actions &&
      chosen.actions.length > 0
    ) {
      const seqRes = this.executeActionSequence(
        workingState,
        {
          sequenceId: `weighted-outcome-seq-${poolId}-${chosen.outcomeId}`,
          actions: chosen.actions,
        },
        {
          ...context,
          rng,
          boardState: workingBoardState,
          featureState: workingFeatureState,
        },
      );
      workingState = seqRes.nextState;
      if (seqRes.boardState) {
        workingBoardState = seqRes.boardState;
      }
      if (seqRes.featureState) {
        workingFeatureState = seqRes.featureState;
      }
      actionsExecuted.push(...seqRes.actionsExecuted);
    }

    return deepFreeze({
      operationType: "selectWeightedOutcome",
      thresholdsEvaluated: [],
      thresholdsFired: [],
      selectedTier: null,
      selectedWeightedOutcome: chosen,
      chanceGateResult: null,
      actionsExecuted,
      ...(workingBoardState ? { boardState: workingBoardState } : {}),
      ...(workingFeatureState ? { featureState: workingFeatureState } : {}),
      rngUsage,
      nextState: workingState,
      detail: chosen,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 5. CHANCE-DRIVEN EVENTS                                                  */
  /* ------------------------------------------------------------------------ */

  public evaluateChanceGate(
    state: FeatureLogicState,
    gate: ChanceGate,
    rng?: RandomSource,
  ): LogicEvaluation<ChanceGateEvaluationResult> {
    if (
      !gate ||
      typeof gate.gateId !== "string" ||
      gate.gateId.trim().length === 0
    ) {
      throw new InvalidChanceGateError(
        "evaluateChanceGate requires a ChanceGate with a non-empty gateId.",
      );
    }
    if (
      typeof gate.probability !== "number" ||
      !Number.isFinite(gate.probability)
    ) {
      throw new InvalidChanceGateError(
        `ChanceGate "${gate.gateId}" probability must be a finite number.`,
        { gateId: gate.gateId, probability: gate.probability },
      );
    }

    const unit = gate.unit ?? "ratio";
    if (unit !== "ratio" && unit !== "percent") {
      throw new InvalidChanceGateError(
        `ChanceGate "${gate.gateId}" unit must be "ratio" or "percent".`,
        { gateId: gate.gateId, unit },
      );
    }

    const maxAllowed = unit === "percent" ? 100 : 1;
    if (gate.probability < 0 || gate.probability > maxAllowed) {
      throw new InvalidChanceGateError(
        `ChanceGate "${gate.gateId}" probability (${gate.probability}) must be within [0, ${maxAllowed}].`,
        { gateId: gate.gateId, probability: gate.probability, unit },
      );
    }

    const normalizedProbability =
      unit === "percent" ? gate.probability / 100 : gate.probability;

    let passed: boolean;
    let sampleValue: number | null = null;
    let rngUsage: LogicRngUsage | undefined;

    if (normalizedProbability <= 0) {
      passed = false;
    } else if (normalizedProbability >= 1) {
      passed = true;
    } else {
      if (!rng || typeof rng.nextFloat !== "function") {
        throw new InvalidChanceGateError(
          `ChanceGate "${gate.gateId}" with intermediate probability (${gate.probability}) requires a B03 RandomSource.`,
          { gateId: gate.gateId, probability: gate.probability },
        );
      }
      const rngBefore = rng.snapshot();
      sampleValue = rng.nextFloat();
      const rngAfter = rng.snapshot();
      passed = sampleValue < normalizedProbability;
      rngUsage = deepFreeze({
        drawsConsumed: rngAfter.drawCount - rngBefore.drawCount,
        rngStateBefore: rngBefore,
        rngStateAfter: rngAfter,
      });
    }

    const gateResult: ChanceGateEvaluationResult = deepFreeze({
      gateId: gate.gateId,
      probability: gate.probability,
      normalizedProbability,
      passed,
      sampleValue,
      ...(rngUsage ? { rngUsage } : {}),
    });

    const nextState: FeatureLogicState = deepFreeze({
      ...state,
      lastChanceResults: {
        ...state.lastChanceResults,
        [gate.gateId]: gateResult,
      },
    });

    return deepFreeze({
      operationType: "evaluateChanceGate",
      thresholdsEvaluated: [],
      thresholdsFired: [],
      selectedTier: null,
      selectedWeightedOutcome: null,
      chanceGateResult: gateResult,
      actionsExecuted: [],
      ...(rngUsage ? { rngUsage } : {}),
      nextState,
      detail: gateResult,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 6. LOSING-SPIN TRIGGERS                                                  */
  /* ------------------------------------------------------------------------ */

  public evaluateLosingSpinCondition(
    state: FeatureLogicState,
    condition: FeatureCondition,
    spinSummary: SettledSpinOutcomeSummary,
    context?: ActionExecutionContext,
  ): LogicEvaluation<{
    readonly triggered: boolean;
    readonly totalResolvedWin: number;
  }> {
    if (
      !condition ||
      condition.kind !== "losingSpin" ||
      typeof condition.conditionId !== "string" ||
      condition.conditionId.trim().length === 0
    ) {
      throw new InvalidLosingSpinConditionError(
        'evaluateLosingSpinCondition requires a FeatureCondition with kind "losingSpin" and a non-empty conditionId.',
      );
    }
    if (!spinSummary || typeof spinSummary !== "object") {
      throw new InvalidLosingSpinConditionError(
        "evaluateLosingSpinCondition requires a SettledSpinOutcomeSummary object.",
      );
    }

    // Aggregate actual resolved win across ALL active win & value sources
    let totalResolvedWin = 0;

    if (spinSummary.settledTotalWin !== undefined) {
      if (
        typeof spinSummary.settledTotalWin !== "number" ||
        !Number.isFinite(spinSummary.settledTotalWin) ||
        spinSummary.settledTotalWin < 0
      ) {
        throw new InvalidLosingSpinConditionError(
          "settledTotalWin must be a non-negative finite number.",
          { settledTotalWin: spinSummary.settledTotalWin },
        );
      }
      totalResolvedWin = roundCurrency(
        totalResolvedWin + spinSummary.settledTotalWin,
      );
    }

    const componentWins = [
      spinSummary.paylineWin,
      spinSummary.waysWin,
      spinSummary.clusterWin,
      spinSummary.payAnywhereWin,
      spinSummary.scatterWin,
      spinSummary.assignedOrCollectedValueWin,
      spinSummary.evaluationResult?.totalWin,
      spinSummary.settlementContext?.settledWinAmount,
      spinSummary.settlementContext?.collectedValueTotal,
      spinSummary.settlementContext?.absorbedValueTotal,
    ];

    for (const w of componentWins) {
      if (w !== undefined) {
        if (typeof w !== "number" || !Number.isFinite(w) || w < 0) {
          throw new InvalidLosingSpinConditionError(
            "Win component in SettledSpinOutcomeSummary must be a non-negative finite number.",
            { winComponent: w },
          );
        }
        totalResolvedWin = roundCurrency(totalResolvedWin + w);
      }
    }

    let workingState = state;
    let chanceGateResult: ChanceGateEvaluationResult | null = null;
    let rngUsage: LogicRngUsage | undefined;

    let qualifies = totalResolvedWin === 0;

    if (qualifies && condition.meterId !== undefined) {
      const m = workingState.metersById[condition.meterId];
      if (!m || m.currentValue < (condition.minMeterValue ?? 1)) {
        qualifies = false;
      }
    }

    if (qualifies && condition.chanceGate) {
      const gateEval = this.evaluateChanceGate(
        workingState,
        condition.chanceGate,
        context?.rng,
      );
      workingState = gateEval.nextState;
      chanceGateResult = gateEval.detail;
      rngUsage = gateEval.rngUsage;
      qualifies = gateEval.detail.passed;
    }

    let workingBoardState = context?.boardState;
    let workingFeatureState = context?.featureState;
    const actionsExecuted: ActionResult[] = [];

    if (qualifies && condition.actions.length > 0) {
      const seqRes = this.executeActionSequence(
        workingState,
        {
          sequenceId: `losing-spin-seq-${condition.conditionId}`,
          actions: condition.actions,
        },
        {
          ...context,
          boardState: workingBoardState,
          featureState: workingFeatureState,
        },
      );
      workingState = seqRes.nextState;
      if (seqRes.boardState) {
        workingBoardState = seqRes.boardState;
      }
      if (seqRes.featureState) {
        workingFeatureState = seqRes.featureState;
      }
      actionsExecuted.push(...seqRes.actionsExecuted);
    }

    return deepFreeze({
      operationType: "evaluateLosingSpinCondition",
      conditionId: condition.conditionId,
      thresholdsEvaluated: [],
      thresholdsFired: [],
      selectedTier: null,
      selectedWeightedOutcome: null,
      chanceGateResult,
      actionsExecuted,
      ...(workingBoardState ? { boardState: workingBoardState } : {}),
      ...(workingFeatureState ? { featureState: workingFeatureState } : {}),
      ...(rngUsage ? { rngUsage } : {}),
      nextState: workingState,
      detail: {
        triggered: qualifies,
        totalResolvedWin,
      },
    });
  }

  /* ------------------------------------------------------------------------ */
  /* 7. ORDERED / NESTED ACTIONS & INLINE BOARD ACTIONS                       */
  /* ------------------------------------------------------------------------ */

  public executeActionSequence(
    state: FeatureLogicState,
    sequence: ActionSequence,
    context?: ActionExecutionContext,
  ): LogicEvaluation<readonly ActionResult[]> {
    return this.executeSequenceInternal(
      state,
      sequence,
      context ?? {},
      0,
      new Set<string>(),
      null,
    );
  }

  private executeSequenceInternal(
    state: FeatureLogicState,
    sequence: ActionSequence,
    context: ActionExecutionContext,
    depth: number,
    visitedSequenceIds: ReadonlySet<string>,
    initialLastActionId: string | null,
  ): LogicEvaluation<readonly ActionResult[]> {
    if (
      !sequence ||
      typeof sequence.sequenceId !== "string" ||
      sequence.sequenceId.trim().length === 0 ||
      !Array.isArray(sequence.actions)
    ) {
      throw new InvalidLogicActionError(
        "executeActionSequence requires a valid sequenceId and an actions array.",
      );
    }

    const maxDepth = sequence.maxDepth ?? context.maxDepth ?? 8;
    if (depth > maxDepth) {
      throw new ActionRecursionLimitExceededError(
        `Action sequence "${sequence.sequenceId}" exceeded maximum nesting depth (${maxDepth}).`,
        { sequenceId: sequence.sequenceId, depth, maxDepth },
      );
    }
    if (visitedSequenceIds.has(sequence.sequenceId)) {
      throw new ActionRecursionLimitExceededError(
        `Cyclic nested action sequence detected for "${sequence.sequenceId}".`,
        { sequenceId: sequence.sequenceId },
      );
    }

    const nextVisited = new Set(visitedSequenceIds);
    nextVisited.add(sequence.sequenceId);

    let workingState = state;
    let workingBoardState = context.boardState;
    let workingFeatureState = context.featureState;
    let lastActionId: string | null = initialLastActionId;
    const results: ActionResult[] = [];

    for (let i = 0; i < sequence.actions.length; i += 1) {
      const action = sequence.actions[i]!;
      if (
        !action ||
        typeof action.actionId !== "string" ||
        action.actionId.trim().length === 0
      ) {
        throw new InvalidLogicActionError(
          `Action at index ${i} in sequence "${sequence.sequenceId}" requires a non-empty actionId.`,
          { sequenceId: sequence.sequenceId, index: i },
        );
      }

      const observedOriginSymbol =
        workingBoardState?.board.cells[0]?.[0]?.symbolId ?? null;

      if (action.type === "awardPrize") {
        if (
          typeof action.prizeAmount !== "number" ||
          !Number.isFinite(action.prizeAmount) ||
          action.prizeAmount <= 0
        ) {
          throw new InvalidLogicActionError(
            `awardPrize action "${action.actionId}" requires a positive finite prizeAmount.`,
            { actionId: action.actionId, prizeAmount: action.prizeAmount },
          );
        }
        const awarded = roundCurrency(action.prizeAmount);
        workingState = deepFreeze({
          ...workingState,
          totalAwardedPrizes: roundCurrency(
            workingState.totalAwardedPrizes + awarded,
          ),
        });
        results.push(
          deepFreeze({
            actionId: action.actionId,
            actionType: action.type,
            depth,
            observedPreviousActionId: lastActionId,
            observedBoardSymbolAtOrigin: observedOriginSymbol,
            prizeAwarded: awarded,
            childActionResults: [],
          }),
        );
        lastActionId = action.actionId;
      } else if (action.type === "updateMeter") {
        const meterBefore =
          workingState.metersById[action.meterId]?.currentValue;
        if (meterBefore === undefined) {
          throw new InvalidLogicActionError(
            `updateMeter action "${action.actionId}" references unknown meter "${action.meterId}".`,
            { actionId: action.actionId, meterId: action.meterId },
          );
        }

        let evalRes: LogicEvaluation<MeterRuntimeState>;
        if (action.operation === "increment") {
          evalRes = this.incrementMeter(
            workingState,
            action.meterId,
            action.value ?? 1,
            {
              ...context,
              boardState: workingBoardState,
              featureState: workingFeatureState,
            },
          );
        } else if (action.operation === "set") {
          if (action.value === undefined) {
            throw new InvalidLogicActionError(
              `updateMeter action "${action.actionId}" with operation "set" requires a value.`,
              { actionId: action.actionId },
            );
          }
          evalRes = this.setMeter(workingState, action.meterId, action.value, {
            ...context,
            boardState: workingBoardState,
            featureState: workingFeatureState,
          });
        } else if (action.operation === "reset") {
          evalRes = this.resetMeter(workingState, action.meterId);
        } else {
          throw new InvalidLogicActionError(
            `Unsupported updateMeter operation "${String((action as { operation: unknown }).operation)}".`,
          );
        }

        workingState = evalRes.nextState;
        if (evalRes.boardState) {
          workingBoardState = evalRes.boardState;
        }
        if (evalRes.featureState) {
          workingFeatureState = evalRes.featureState;
        }

        results.push(
          deepFreeze({
            actionId: action.actionId,
            actionType: action.type,
            depth,
            observedPreviousActionId: lastActionId,
            observedBoardSymbolAtOrigin: observedOriginSymbol,
            meterChange: {
              meterId: action.meterId,
              before: meterBefore,
              after: evalRes.detail.currentValue,
            },
            childActionResults: evalRes.actionsExecuted,
          }),
        );
        lastActionId = action.actionId;
      } else if (action.type === "setFlag") {
        if (!action.flagKey || typeof action.flagKey !== "string") {
          throw new InvalidLogicActionError(
            `setFlag action "${action.actionId}" requires a non-empty flagKey.`,
          );
        }
        workingState = deepFreeze({
          ...workingState,
          flags: {
            ...workingState.flags,
            [action.flagKey]: action.flagValue,
          },
        });
        results.push(
          deepFreeze({
            actionId: action.actionId,
            actionType: action.type,
            depth,
            observedPreviousActionId: lastActionId,
            observedBoardSymbolAtOrigin: observedOriginSymbol,
            flagChanged: {
              flagKey: action.flagKey,
              value: action.flagValue,
            },
            childActionResults: [],
          }),
        );
        lastActionId = action.actionId;
      } else if (action.type === "inlineBoardAction") {
        if (!workingBoardState) {
          throw new InvalidLogicActionError(
            `inlineBoardAction "${action.actionId}" requires a B13 BoardState in context.`,
            { actionId: action.actionId },
          );
        }
        const dynamics =
          context.boardDynamicsEngine ?? createBoardDynamicsEngine();
        const op = action.boardOperation;
        let affectedPositions: readonly Position[] = [];

        if (op.kind === "placeSymbols") {
          const placed = dynamics.placeSymbols(workingBoardState, op.spec);
          workingBoardState = placed.nextState;
          affectedPositions = placed.changedCells.map(
            (c: ChangedCellRecord) => c.position,
          );
        } else if (op.kind === "removeCells") {
          const removed = dynamics.removeCells(workingBoardState, op.spec);
          workingBoardState = removed.nextState;
          affectedPositions = removed.removedCells.map(
            (c: RemovedCellRecord) => c.position,
          );
        } else if (op.kind === "resolveMysteries") {
          if (!context.rng) {
            throw new InvalidLogicActionError(
              `inlineBoardAction "${action.actionId}" ("resolveMysteries") requires a B03 RandomSource in context.`,
            );
          }
          const resolved = dynamics.resolveMysteries(
            workingBoardState,
            op.config,
            context.rng,
          );
          workingBoardState = resolved.nextState;
          affectedPositions = resolved.resolvedCells.map(
            (c: MysteryResolvedCellRecord) => c.position,
          );
        } else if (op.kind === "duplicateSymbols") {
          const dup = dynamics.duplicateSymbols(workingBoardState, op.config);
          workingBoardState = dup.nextState;
          affectedPositions = dup.changedCells.map(
            (c: ChangedCellRecord) => c.position,
          );
        } else if (op.kind === "applyLaneSweep") {
          const swept = dynamics.applyLaneSweep(
            workingBoardState,
            op.config,
            context.rng,
          );
          workingBoardState = swept.nextState;
          affectedPositions = swept.clearedCells.map(
            (c: RemovedCellRecord) => c.position,
          );
        } else if (op.kind === "resizeBoard") {
          const resized = dynamics.resizeBoard(workingBoardState, op.config);
          workingBoardState = resized.nextState;
          affectedPositions = resized.insertedCells.map(
            (c: InsertedCellRecord) => c.position,
          );
        } else if (op.kind === "applyLocks") {
          const locked = dynamics.applyLocks(workingBoardState, op.locks);
          workingBoardState = locked.nextState;
          affectedPositions = locked.lockedPositions;
        } else if (op.kind === "tagPositions") {
          const tagged = dynamics.tagPositions(
            workingBoardState,
            op.config,
            context.rng,
          );
          workingBoardState = tagged.nextState;
          affectedPositions = tagged.taggedPositions;
        } else {
          throw new InvalidLogicActionError(
            `Unsupported inlineBoardAction kind "${String((op as { kind: unknown }).kind)}".`,
          );
        }

        results.push(
          deepFreeze({
            actionId: action.actionId,
            actionType: action.type,
            depth,
            observedPreviousActionId: lastActionId,
            observedBoardSymbolAtOrigin: observedOriginSymbol,
            boardActionSummary: {
              operationKind: op.kind,
              affectedPositions,
            },
            childActionResults: [],
          }),
        );
        lastActionId = action.actionId;
      } else if (action.type === "featureRequest") {
        if (!action.featureId || typeof action.featureId !== "string") {
          throw new InvalidLogicActionError(
            `featureRequest action "${action.actionId}" requires a non-empty featureId.`,
          );
        }

        const req: FeatureLogicRequest = deepFreeze({
          requestId: `freq-${action.actionId}-${workingState.pendingFeatureRequests.length + 1}`,
          requestType: action.requestType,
          featureId: action.featureId,
          ...(action.targetFeatureId !== undefined
            ? { targetFeatureId: action.targetFeatureId }
            : {}),
          ...(action.extraSpins !== undefined
            ? { extraSpins: action.extraSpins }
            : {}),
          ...(action.startingMultiplier !== undefined
            ? { startingMultiplier: action.startingMultiplier }
            : {}),
          ...(action.prizeCredits !== undefined
            ? { prizeCredits: action.prizeCredits }
            : {}),
        });

        // Delegate to B12 FeatureEngine when provided in context
        if (context.featureEngine) {
          if (action.requestType === "enterFeature") {
            const started = context.featureEngine.startFeature(
              action.featureId,
              {
                previousState: workingFeatureState,
                startingMultiplierOverride: action.startingMultiplier,
                awardedSpinsOverride: action.extraSpins,
              },
            );
            workingFeatureState = started.nextState;
          } else if (action.requestType === "upgradeFeature") {
            if (!workingFeatureState || !action.targetFeatureId) {
              throw new InvalidLogicActionError(
                `upgradeFeature action "${action.actionId}" requires an active featureState and targetFeatureId.`,
              );
            }
            const upgraded = context.featureEngine.upgradeFeature(
              workingFeatureState,
              action.targetFeatureId,
              {
                additionalSpinsOverride: action.extraSpins,
                multiplierOverride: action.startingMultiplier,
              },
            );
            workingFeatureState = upgraded.nextState;
          } else if (action.requestType === "retriggerFeature") {
            if (!workingFeatureState) {
              throw new InvalidLogicActionError(
                `retriggerFeature action "${action.actionId}" requires an active featureState.`,
              );
            }
            const extraSpins = action.extraSpins ?? 5;
            const stepped = context.featureEngine.runFeatureStep(
              workingFeatureState,
              {
                actions: [
                  {
                    type: "awardSpins",
                    spins: extraSpins,
                  },
                  {
                    type: "modifyFeatureState",
                    remainingSpinsDelta: 1,
                  },
                ],
              },
            );
            workingFeatureState = stepped.nextState;
          } else if (action.requestType === "awardFeaturePrize") {
            if (!workingFeatureState) {
              throw new InvalidLogicActionError(
                `awardFeaturePrize action "${action.actionId}" requires an active featureState.`,
              );
            }
            const stepped = context.featureEngine.runFeatureStep(
              workingFeatureState,
              {
                actions: [
                  {
                    type: "addCredits",
                    amount: action.prizeCredits ?? 0,
                  },
                  {
                    type: "modifyFeatureState",
                    remainingSpinsDelta: 1,
                  },
                ],
              },
            );
            workingFeatureState = stepped.nextState;
          }
        }

        workingState = deepFreeze({
          ...workingState,
          pendingFeatureRequests: [
            ...workingState.pendingFeatureRequests,
            req,
          ],
        });

        results.push(
          deepFreeze({
            actionId: action.actionId,
            actionType: action.type,
            depth,
            observedPreviousActionId: lastActionId,
            observedBoardSymbolAtOrigin: observedOriginSymbol,
            featureRequestEmitted: req,
            ...(workingFeatureState
              ? { featureStateAfter: workingFeatureState }
              : {}),
            childActionResults: [],
          }),
        );
        lastActionId = action.actionId;
      } else if (action.type === "weightedOutcomeAction") {
        if (!context.rng) {
          throw new InvalidLogicActionError(
            `weightedOutcomeAction "${action.actionId}" requires a B03 RandomSource in context.`,
          );
        }
        const selected = this.selectWeightedOutcome(
          workingState,
          action.poolId,
          action.outcomes,
          context.rng,
          {
            ...context,
            boardState: workingBoardState,
            featureState: workingFeatureState,
            executeSelectedActions: true,
          },
        );
        workingState = selected.nextState;
        if (selected.boardState) {
          workingBoardState = selected.boardState;
        }
        if (selected.featureState) {
          workingFeatureState = selected.featureState;
        }
        results.push(
          deepFreeze({
            actionId: action.actionId,
            actionType: action.type,
            depth,
            observedPreviousActionId: lastActionId,
            observedBoardSymbolAtOrigin: observedOriginSymbol,
            selectedWeightedOutcome: selected.detail,
            childActionResults: selected.actionsExecuted,
          }),
        );
        lastActionId = action.actionId;
      } else if (action.type === "chanceGatedAction") {
        const gateRes = this.evaluateChanceGate(
          workingState,
          action.gate,
          context.rng,
        );
        workingState = gateRes.nextState;
        const branchActions = gateRes.detail.passed
          ? action.thenActions
          : (action.elseActions ?? []);
        let childResults: readonly ActionResult[] = [];

        if (branchActions.length > 0) {
          const subRes = this.executeSequenceInternal(
            workingState,
            {
              sequenceId: `${sequence.sequenceId}::${action.actionId}`,
              actions: branchActions,
              maxDepth,
            },
            {
              ...context,
              boardState: workingBoardState,
              featureState: workingFeatureState,
            },
            depth + 1,
            nextVisited,
            action.actionId,
          );
          workingState = subRes.nextState;
          if (subRes.boardState) {
            workingBoardState = subRes.boardState;
          }
          if (subRes.featureState) {
            workingFeatureState = subRes.featureState;
          }
          childResults = subRes.actionsExecuted;
        }

        results.push(
          deepFreeze({
            actionId: action.actionId,
            actionType: action.type,
            depth,
            observedPreviousActionId: lastActionId,
            observedBoardSymbolAtOrigin: observedOriginSymbol,
            chanceGateResult: gateRes.detail,
            childActionResults: childResults,
          }),
        );
        lastActionId = action.actionId;
      } else if (action.type === "nestedSequence") {
        const childSeqRes = this.executeSequenceInternal(
          workingState,
          {
            sequenceId: action.sequenceId,
            actions: action.actions,
            maxDepth,
          },
          {
            ...context,
            boardState: workingBoardState,
            featureState: workingFeatureState,
          },
          depth + 1,
          nextVisited,
          lastActionId,
        );
        workingState = childSeqRes.nextState;
        if (childSeqRes.boardState) {
          workingBoardState = childSeqRes.boardState;
        }
        if (childSeqRes.featureState) {
          workingFeatureState = childSeqRes.featureState;
        }

        results.push(
          deepFreeze({
            actionId: action.actionId,
            actionType: action.type,
            depth,
            observedPreviousActionId: lastActionId,
            observedBoardSymbolAtOrigin: observedOriginSymbol,
            childActionResults: childSeqRes.actionsExecuted,
          }),
        );
        lastActionId =
          childSeqRes.actionsExecuted.length > 0
            ? childSeqRes.actionsExecuted[
                childSeqRes.actionsExecuted.length - 1
              ]!.actionId
            : action.actionId;
      } else {
        throw new InvalidLogicActionError(
          `Unsupported FeatureLogicAction type "${String((action as { type: unknown }).type)}".`,
        );
      }
    }

    return deepFreeze({
      operationType: "executeActionSequence",
      thresholdsEvaluated: [],
      thresholdsFired: [],
      selectedTier: null,
      selectedWeightedOutcome: null,
      chanceGateResult: null,
      actionsExecuted: results,
      ...(workingBoardState ? { boardState: workingBoardState } : {}),
      ...(workingFeatureState ? { featureState: workingFeatureState } : {}),
      nextState: workingState,
      detail: results,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* SCOPE BOUNDARIES & SNAPSHOT / RESTORE                                    */
  /* ------------------------------------------------------------------------ */

  public clearSpinScope(state: FeatureLogicState): FeatureLogicState {
    const nextMeters: Record<string, MeterRuntimeState> = {};
    for (const [mId, meter] of Object.entries(state.metersById)) {
      if (meter.scope === "spin" && meter.resetBehavior === "onBoundary") {
        nextMeters[mId] = deepFreeze({
          ...meter,
          currentValue: meter.startingValue,
          firedThresholdIds: [],
        });
      } else {
        nextMeters[mId] = meter;
      }
    }

    return deepFreeze({
      ...state,
      metersById: nextMeters,
      pendingFeatureRequests: [],
    });
  }

  public clearFeatureScope(state: FeatureLogicState): FeatureLogicState {
    const spinCleared = this.clearSpinScope(state);
    const nextMeters: Record<string, MeterRuntimeState> = {};

    for (const [mId, meter] of Object.entries(spinCleared.metersById)) {
      if (meter.scope === "feature" && meter.resetBehavior === "onBoundary") {
        nextMeters[mId] = deepFreeze({
          ...meter,
          currentValue: meter.startingValue,
          firedThresholdIds: [],
        });
      } else {
        nextMeters[mId] = meter;
      }
    }

    return deepFreeze({
      ...spinCleared,
      metersById: nextMeters,
    });
  }

  public resetSessionScope(state: FeatureLogicState): FeatureLogicState {
    const nextMeters: Record<string, MeterRuntimeState> = {};
    for (const [mId, meter] of Object.entries(state.metersById)) {
      nextMeters[mId] = deepFreeze({
        ...meter,
        currentValue: meter.startingValue,
        firedThresholdIds: [],
      });
    }

    return deepFreeze({
      metersById: nextMeters,
      flags: {},
      totalAwardedPrizes: 0,
      pendingFeatureRequests: [],
      lastChanceResults: {},
      lastWeightedOutcomes: {},
    });
  }

  public snapshot(state: FeatureLogicState): LogicSnapshot {
    const cloned = JSON.parse(
      JSON.stringify({
        version: 1,
        state,
      }),
    ) as LogicSnapshot;
    return deepFreeze(cloned);
  }

  public restore(snapshot: LogicSnapshot): FeatureLogicState {
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      snapshot.version !== 1 ||
      !snapshot.state ||
      typeof snapshot.state !== "object"
    ) {
      throw new InvalidFeatureLogicConfigurationError(
        "Invalid LogicSnapshot provided to restore.",
      );
    }
    const cloned = JSON.parse(
      JSON.stringify(snapshot.state),
    ) as FeatureLogicState;
    return deepFreeze(cloned);
  }
}

export function createFeatureLogicEngine(): FeatureLogicEngine {
  return new DeterministicFeatureLogicEngine();
}
