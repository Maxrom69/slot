/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 / B12 — Feature Engine
 *
 * Deterministic backend Feature Engine implementing:
 *  1. Feature Triggers (Scatter count via B08/board, Zone symbol count, Reel presence,
 *     Symbol count, and declarative board conditions with exact threshold matching
 *     and fire-once per qualifying board evaluation guarantees)
 *  2. Feature Modes & Alternate Reels (feature-specific reel strips/symbol mixes
 *     while active, restoring base-game reels upon exit)
 *  3. Free Spins (initial award, trigger-count scaling, retriggers, and optional
 *     retrigger batch caps)
 *  4. Feature Win Accounting (cumulative feature win tracking; never fabricates a
 *     zero-value feature-win presentation for a feature that paid nothing)
 *  5. Hold & Win / Respin State (locked coin/value cells, respin counter, counter
 *     reset on new locks, and single pool payout readiness when counter reaches 0)
 *  6. Feature Buy (direct feature entry and purchased spin guaranteed to land the
 *     exact trigger-symbol count using B03 RandomSource)
 *  7. Bonus Games (Wheel, Pick, Trail, Crash, Instant Reveal weighted outcome pools
 *     with credits, actions, or both; without-replacement multi-pick and credit summation)
 *  8. Feature Upgrades (carry unspent spins, add new feature's awarded spins,
 *     continue under upgraded feature's rules and reels)
 *  9. Feature Starting Multiplier (trigger-defined and trigger-count-scaled starting
 *     multipliers)
 * 10. Round Control (maximum cumulative feature win cap with exact trimming +
 *     immediate spin termination, and winning-spin cap where multiple cascades
 *     within one spin count as a single winning spin)
 *
 * Preserves all B01 FeatureProcessor exports for backward compatibility.
 * Zero Math.random() or Date.now() usage. Zero browser/DOM dependencies.
 */

import type { Board, Position } from "../board";
import { createBoardFromSymbolGrid } from "../paylines";
import type {
  FeatureId,
  GameConfig,
  NormalizedFeatureDefinition,
  NormalizedReelStop,
  NormalizedReelStrip,
  SymbolId,
} from "../config";
import {
  InvalidBonusPoolError,
  InvalidFeatureActionError,
  InvalidFeatureConfigurationError,
  InvalidFeatureStateError,
  InvalidFeatureTriggerError,
  UnknownFeatureReferenceError,
} from "../errors";
import type { EvaluationResult } from "../evaluation";
import { roundCurrency } from "../paytable";
import type {
  RandomSource,
  RngStateSnapshot,
  WeightedItem,
} from "../rng";
import type { ScatterEvaluationResult } from "../scatters";

/* -------------------------------------------------------------------------- */
/* B01 ARCHITECTURAL COMPATIBILITY EXPORTS (PRESERVED)                        */
/* -------------------------------------------------------------------------- */

export type Feature = NormalizedFeatureDefinition;

export interface FeatureTrigger {
  readonly featureId: FeatureId;
  readonly featureName: string;
  readonly kind: NormalizedFeatureDefinition["kind"];
  readonly triggerSymbolId: SymbolId;
  readonly triggerCount: number;
  readonly positions: readonly Position[];
  readonly awardedFreeSpins: number;
  readonly awardedMultiplier: number;
}

export interface FeatureResult {
  readonly triggers: readonly FeatureTrigger[];
  readonly totalFreeSpinsAwarded: number;
  readonly nextMultiplier: number;
  readonly activatedFeatureId: FeatureId | null;
}

export interface FeatureExecutionContext {
  readonly config: GameConfig;
  readonly currentActiveFeatureId: FeatureId | null;
  readonly currentFreeSpinsRemaining: number;
  readonly currentMultiplier: number;
}

export interface FeatureProcessor {
  processFeatures(
    board: Board,
    evaluation: EvaluationResult,
    context: FeatureExecutionContext,
  ): FeatureResult;
}

export class ArchitecturalFeatureProcessor implements FeatureProcessor {
  public processFeatures(
    board: Board,
    _evaluation: EvaluationResult,
    context: FeatureExecutionContext,
  ): FeatureResult {
    const { config } = context;
    const triggers: FeatureTrigger[] = [];
    let totalFreeSpinsAwarded = 0;
    let nextMultiplier = context.currentMultiplier;
    let activatedFeatureId: FeatureId | null = context.currentActiveFeatureId;

    const positionsBySymbolId = new Map<SymbolId, Position[]>();
    for (const col of board.cells) {
      for (const cell of col) {
        const list = positionsBySymbolId.get(cell.symbol.symbolId) ?? [];
        list.push(cell.position);
        positionsBySymbolId.set(cell.symbol.symbolId, list);
      }
    }

    for (const feature of config.features) {
      if (!feature.enabled) continue;

      for (const triggerSymId of feature.triggerSymbolIds) {
        const matchedPositions = positionsBySymbolId.get(triggerSymId) ?? [];
        if (matchedPositions.length >= feature.triggerCount) {
          const spinsParam = feature.params.spins;
          const awardedFreeSpins =
            feature.kind === "free_spins" &&
            typeof spinsParam === "number" &&
            Number.isInteger(spinsParam) &&
            spinsParam > 0
              ? spinsParam
              : 0;
          const multParam = feature.params.multiplier;
          const awardedMultiplier =
            typeof multParam === "number" &&
            Number.isFinite(multParam) &&
            multParam > 0
              ? multParam
              : 1;

          triggers.push(
            Object.freeze({
              featureId: feature.id,
              featureName: feature.name,
              kind: feature.kind,
              triggerSymbolId: triggerSymId,
              triggerCount: matchedPositions.length,
              positions: Object.freeze([...matchedPositions]),
              awardedFreeSpins,
              awardedMultiplier,
            }),
          );

          totalFreeSpinsAwarded += awardedFreeSpins;
          if (awardedMultiplier > nextMultiplier) {
            nextMultiplier = awardedMultiplier;
          }
          if (!activatedFeatureId) {
            activatedFeatureId = feature.id;
          }
        }
      }
    }

    return Object.freeze({
      triggers: Object.freeze(triggers),
      totalFreeSpinsAwarded,
      nextMultiplier,
      activatedFeatureId,
    });
  }
}

export function createFeatureProcessor(): FeatureProcessor {
  return new ArchitecturalFeatureProcessor();
}

/* -------------------------------------------------------------------------- */
/* B12 — FEATURE ENGINE TYPES & CONTRACTS                                     */
/* -------------------------------------------------------------------------- */

export type FeatureModeKind =
  | "base"
  | "freeSpins"
  | "holdAndWin"
  | "bonus"
  | "custom";

export type FeatureStatus = "idle" | "active" | "completed";

export type FeatureEndReason =
  | "spinsExhausted"
  | "respinsExhausted"
  | "boardFull"
  | "winCapReached"
  | "winningSpinCapReached"
  | "bonusCompleted"
  | "explicitEnd";

export type BonusGameType =
  | "wheel"
  | "pick"
  | "trail"
  | "crash"
  | "instantReveal";

export interface FeatureTriggerZone {
  readonly reelIndexes?: readonly number[];
  readonly rowIndexes?: readonly number[];
  readonly positions?: readonly Position[];
}

export interface FeatureTriggerSpec {
  readonly id: string;
  readonly source:
    | "scatterCount"
    | "zoneCount"
    | "reelPresence"
    | "symbolCount"
    | "boardCondition";
  readonly targetFeatureId: string;
  readonly symbolIds: readonly string[];
  readonly threshold: number;
  readonly comparison?: "atLeast" | "exact";
  readonly zone?: FeatureTriggerZone;
  readonly reelIndexes?: readonly number[];
  readonly requireAllReels?: boolean;
  readonly awardedSpins?: number;
  readonly awardedSpinsByCount?: Readonly<Record<number, number>>;
  readonly startingMultiplier?: number;
  readonly startingMultiplierByCount?: Readonly<Record<number, number>>;
}

export interface FeatureFreeSpinsSpec {
  readonly initialSpins: number;
  readonly spinsByTriggerCount?: Readonly<Record<number, number>>;
  readonly retriggerEnabled?: boolean;
  readonly retriggerSymbolIds?: readonly string[];
  readonly retriggerThreshold?: number;
  readonly retriggerSpins?: number;
  readonly retriggerSpinsByCount?: Readonly<Record<number, number>>;
  readonly maxRetriggerBatches?: number;
}

export interface FeatureHoldAndWinSpec {
  readonly initialRespins: number;
  readonly lockableSymbolIds: readonly string[];
  readonly symbolValuesBySymbolId?: Readonly<Record<string, number>>;
  readonly defaultSymbolValue?: number;
}

export type FeatureAction =
  | {
      readonly type: "awardSpins";
      readonly spins: number;
      readonly reason?: string;
    }
  | {
      readonly type: "retrigger";
      readonly spins: number;
      readonly triggerCount?: number;
    }
  | {
      readonly type: "enterFeature";
      readonly featureId: string;
      readonly awardedSpins?: number;
      readonly startingMultiplier?: number;
    }
  | {
      readonly type: "upgradeFeature";
      readonly targetFeatureId: string;
      readonly additionalSpins?: number;
      readonly multiplierOverride?: number;
    }
  | {
      readonly type: "addCredits";
      readonly amount: number;
      readonly countsAsWinningSpin?: boolean;
      readonly cascadeCount?: number;
    }
  | {
      readonly type: "setMeter";
      readonly meterKey: string;
      readonly value: number;
    }
  | {
      readonly type: "incrementMeter";
      readonly meterKey: string;
      readonly delta: number;
    }
  | {
      readonly type: "modifyFeatureState";
      readonly multiplier?: number;
      readonly remainingSpinsDelta?: number;
      readonly respinsRemaining?: number;
    }
  | {
      readonly type: "boardModHook";
      readonly hookId: string;
      readonly payload?: Readonly<Record<string, string | number | boolean>>;
    }
  | {
      readonly type: "endFeature";
      readonly reason?: FeatureEndReason;
    };

export interface BonusOutcomeSector {
  readonly id: string;
  readonly label?: string;
  readonly weight: number;
  readonly credits?: number;
  readonly action?: FeatureAction;
  readonly actions?: readonly FeatureAction[];
  readonly endsBonus?: boolean;
}

export interface BonusGameSpec {
  readonly bonusType: BonusGameType;
  readonly picksCount?: number;
  readonly withoutReplacement?: boolean;
  readonly sectors: readonly BonusOutcomeSector[];
}

export interface FeatureBuySpec {
  readonly enabled: boolean;
  readonly costMultiplier: number;
  readonly entryMode: "direct" | "guaranteedTriggerSpin";
  readonly targetFeatureId: string;
  readonly guaranteedTriggerCount?: number;
  readonly triggerSymbolId?: string;
}

export interface FeatureRoundControlSpec {
  readonly winCap?: number;
  readonly winningSpinCap?: number;
}

export interface FeatureSpec {
  readonly id: string;
  readonly name: string;
  readonly mode: FeatureModeKind;
  readonly enabled?: boolean;
  readonly triggers?: readonly FeatureTriggerSpec[];
  readonly alternateReels?:
    | readonly NormalizedReelStrip[]
    | readonly (readonly string[])[];
  readonly startingMultiplier?: number;
  readonly freeSpins?: FeatureFreeSpinsSpec;
  readonly holdAndWin?: FeatureHoldAndWinSpec;
  readonly bonusGame?: BonusGameSpec;
  readonly featureBuy?: FeatureBuySpec;
  readonly roundControl?: FeatureRoundControlSpec;
  readonly upgradeTargetFeatureId?: string;
}

export interface FeatureEngineConfiguration {
  readonly baseReels?:
    | readonly NormalizedReelStrip[]
    | readonly (readonly string[])[];
  readonly visibleRows?: number;
  readonly features: readonly FeatureSpec[];
  readonly triggers?: readonly FeatureTriggerSpec[];
}

export interface LockedFeatureCell {
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly symbolId: string;
  readonly creditValue: number;
  readonly lockedAtStep: number;
}

export interface HoldAndWinRuntimeState {
  readonly initialRespins: number;
  readonly respinsRemaining: number;
  readonly lockedCells: readonly LockedFeatureCell[];
  readonly lockedSymbolCount: number;
  readonly lockedPoolTotalValue: number;
  readonly lockedPoolReadyToPay: boolean;
  readonly lockedPoolPaidOnce: boolean;
}

export interface FeatureUpgradeRecord {
  readonly fromFeatureId: string;
  readonly toFeatureId: string;
  readonly carriedSpins: number;
  readonly addedSpins: number;
  readonly totalSpinsAfterUpgrade: number;
  readonly multiplierAfterUpgrade: number;
}

export interface FeatureRetriggerRecord {
  readonly featureId: string;
  readonly batchIndex: number;
  readonly triggerCount: number;
  readonly spinsAdded: number;
  readonly cappedOut: boolean;
}

export interface BonusSelectionRecord {
  readonly pickIndex: number;
  readonly sectorId: string;
  readonly label?: string;
  readonly creditsAwarded: number;
  readonly actionsTriggered: readonly FeatureAction[];
}

export interface BonusGameResolution {
  readonly bonusType: BonusGameType;
  readonly selections: readonly BonusSelectionRecord[];
  readonly totalCreditsAwarded: number;
  readonly remainingPoolSize: number;
}

export interface FeatureWinSummary {
  readonly featureId: string;
  readonly totalFeatureWin: number;
  readonly spinsPlayed: number;
  readonly winningSpinCount: number;
}

export interface FeatureTriggerEvaluation {
  readonly triggerId: string;
  readonly matched: boolean;
  readonly alreadyFired: boolean;
  readonly measuredValue: number;
  readonly threshold: number;
  readonly selectedFeatureId: string | null;
  readonly matchedPositions: readonly Position[];
  readonly awardedSpins: number;
  readonly startingMultiplier: number;
}

export interface FeatureCapStatus {
  readonly winCapReached: boolean;
  readonly winningSpinCapReached: boolean;
  readonly retriggerBatchCapReached: boolean;
}

export interface FeatureRngMetadata {
  readonly drawsConsumed: number;
  readonly snapshotBefore: RngStateSnapshot;
  readonly snapshotAfter: RngStateSnapshot;
}

export interface FeatureRuntimeState {
  readonly status: FeatureStatus;
  readonly featureId: string | null;
  readonly parentMode: FeatureModeKind;
  readonly currentMode: FeatureModeKind;
  readonly activeReelSource: "base" | "feature";
  readonly activeReels: readonly NormalizedReelStrip[];
  readonly remainingSpins: number;
  readonly awardedSpins: number;
  readonly spinsPlayed: number;
  readonly retriggerBatchCount: number;
  readonly maxRetriggerBatches: number | null;
  readonly accumulatedFeatureWin: number;
  readonly winningSpinCount: number;
  readonly winCap: number | null;
  readonly winningSpinCap: number | null;
  readonly currentMultiplier: number;
  readonly startingMultiplier: number;
  readonly holdAndWinState: HoldAndWinRuntimeState | null;
  readonly lockedCells: readonly LockedFeatureCell[];
  readonly upgradeHistory: readonly FeatureUpgradeRecord[];
  readonly meters: Readonly<Record<string, number>>;
  readonly firedEvaluationKeys: readonly string[];
  readonly bonusHistory: readonly BonusSelectionRecord[];
  readonly endReason: FeatureEndReason | null;
  readonly featureWinSummary: FeatureWinSummary | null;
}

export interface FeatureStepInput {
  readonly board?: Board;
  readonly evaluationId?: string;
  readonly spinWinAmount?: number;
  readonly cascadeWins?: readonly number[];
  readonly cascadeCount?: number;
  readonly scatterResult?: ScatterEvaluationResult;
  readonly cellValuesByCoord?: Readonly<Record<string, number>>;
  readonly actions?: readonly FeatureAction[];
  readonly rng?: RandomSource;
}

export interface FeatureEngineResult {
  readonly featureStatus: FeatureStatus;
  readonly featureId: string | null;
  readonly currentMode: FeatureModeKind;
  readonly activeReelSource: "base" | "feature";
  readonly activeReels: readonly NormalizedReelStrip[];
  readonly triggerResults: readonly FeatureTriggerEvaluation[];
  readonly actionsExecuted: readonly FeatureAction[];
  readonly spinsBefore: number;
  readonly spinsAfter: number;
  readonly awardedSpinsBefore: number;
  readonly awardedSpinsAfter: number;
  readonly retriggers: readonly FeatureRetriggerRecord[];
  readonly upgradeInfo: FeatureUpgradeRecord | null;
  readonly multiplierBefore: number;
  readonly multiplierAfter: number;
  readonly featureWinBefore: number;
  readonly featureWinAfter: number;
  readonly stepWinAwarded: number;
  readonly stepWinTrimmedByCap: number;
  readonly winningSpinCount: number;
  readonly holdAndWinState: HoldAndWinRuntimeState | null;
  readonly bonusResolution: BonusGameResolution | null;
  readonly capStatus: FeatureCapStatus;
  readonly endReason: FeatureEndReason | null;
  readonly featureWinSummary: FeatureWinSummary | null;
  readonly rngMetadata: FeatureRngMetadata | null;
  readonly purchasedBoard?: Board;
  readonly nextState: FeatureRuntimeState;
}

/* -------------------------------------------------------------------------- */
/* REEL NORMALIZATION & VALIDATION HELPERS                                    */
/* -------------------------------------------------------------------------- */

function normalizeReelStrips(
  rawReels:
    | readonly NormalizedReelStrip[]
    | readonly (readonly string[])[]
    | undefined,
  prefix = "reel",
): readonly NormalizedReelStrip[] {
  if (!rawReels || rawReels.length === 0) {
    return Object.freeze([]);
  }

  const first = rawReels[0];
  if (
    first &&
    typeof first === "object" &&
    !Array.isArray(first) &&
    "stops" in first
  ) {
    return Object.freeze([...(rawReels as readonly NormalizedReelStrip[])]);
  }

  const matrix = rawReels as readonly (readonly string[])[];
  const strips: NormalizedReelStrip[] = matrix.map((col, reelIndex) => {
    if (!Array.isArray(col) || col.length === 0) {
      throw new InvalidFeatureConfigurationError(
        `Reel strip at index ${reelIndex} must be a non-empty array of symbol IDs.`,
        { reelIndex },
      );
    }
    const stops: NormalizedReelStop[] = col.map((symId, stopIndex) =>
      Object.freeze({
        id: `${prefix}-${reelIndex}-stop-${stopIndex}`,
        stopIndex,
        position: stopIndex + 1,
        symbolId: symId,
        weight: 1,
        cumulativeWeight: stopIndex + 1,
      }),
    );
    return Object.freeze({
      id: `${prefix}-${reelIndex + 1}`,
      index: reelIndex,
      name: `${prefix.toUpperCase()} ${reelIndex + 1}`,
      height: stops.length,
      stops: Object.freeze(stops),
      totalWeight: stops.length,
    });
  });

  return Object.freeze(strips);
}

function validateFeatureSpec(spec: FeatureSpec): void {
  if (!spec || typeof spec !== "object") {
    throw new InvalidFeatureConfigurationError(
      "FeatureSpec must be a non-null object.",
      { spec },
    );
  }
  if (typeof spec.id !== "string" || spec.id.trim().length === 0) {
    throw new InvalidFeatureConfigurationError(
      "FeatureSpec.id must be a non-empty string.",
      { spec },
    );
  }
  if (typeof spec.name !== "string" || spec.name.trim().length === 0) {
    throw new InvalidFeatureConfigurationError(
      `FeatureSpec "${spec.id}" must have a non-empty name.`,
      { featureId: spec.id },
    );
  }

  if (spec.freeSpins) {
    if (
      typeof spec.freeSpins.initialSpins !== "number" ||
      !Number.isInteger(spec.freeSpins.initialSpins) ||
      spec.freeSpins.initialSpins < 0
    ) {
      throw new InvalidFeatureConfigurationError(
        `Feature "${spec.id}" freeSpins.initialSpins must be a non-negative integer.`,
        { featureId: spec.id, initialSpins: spec.freeSpins.initialSpins },
      );
    }
    if (
      spec.freeSpins.maxRetriggerBatches !== undefined &&
      (!Number.isInteger(spec.freeSpins.maxRetriggerBatches) ||
        spec.freeSpins.maxRetriggerBatches < 0)
    ) {
      throw new InvalidFeatureConfigurationError(
        `Feature "${spec.id}" freeSpins.maxRetriggerBatches must be a non-negative integer.`,
        {
          featureId: spec.id,
          maxRetriggerBatches: spec.freeSpins.maxRetriggerBatches,
        },
      );
    }
    if (
      spec.freeSpins.retriggerThreshold !== undefined &&
      (!Number.isInteger(spec.freeSpins.retriggerThreshold) ||
        spec.freeSpins.retriggerThreshold < 1)
    ) {
      throw new InvalidFeatureTriggerError(
        `Feature "${spec.id}" freeSpins.retriggerThreshold must be >= 1.`,
        {
          featureId: spec.id,
          retriggerThreshold: spec.freeSpins.retriggerThreshold,
        },
      );
    }
  }

  if (spec.holdAndWin) {
    if (
      typeof spec.holdAndWin.initialRespins !== "number" ||
      !Number.isInteger(spec.holdAndWin.initialRespins) ||
      spec.holdAndWin.initialRespins < 1
    ) {
      throw new InvalidFeatureConfigurationError(
        `Feature "${spec.id}" holdAndWin.initialRespins must be an integer >= 1.`,
        {
          featureId: spec.id,
          initialRespins: spec.holdAndWin.initialRespins,
        },
      );
    }
    if (
      !Array.isArray(spec.holdAndWin.lockableSymbolIds) ||
      spec.holdAndWin.lockableSymbolIds.length === 0
    ) {
      throw new InvalidFeatureConfigurationError(
        `Feature "${spec.id}" holdAndWin.lockableSymbolIds must be a non-empty array.`,
        { featureId: spec.id },
      );
    }
  }

  if (spec.bonusGame) {
    validateBonusGameSpec(spec.id, spec.bonusGame);
  }

  if (spec.roundControl) {
    if (
      spec.roundControl.winCap !== undefined &&
      (typeof spec.roundControl.winCap !== "number" ||
        !Number.isFinite(spec.roundControl.winCap) ||
        spec.roundControl.winCap <= 0)
    ) {
      throw new InvalidFeatureConfigurationError(
        `Feature "${spec.id}" roundControl.winCap must be a positive finite number.`,
        { featureId: spec.id, winCap: spec.roundControl.winCap },
      );
    }
    if (
      spec.roundControl.winningSpinCap !== undefined &&
      (typeof spec.roundControl.winningSpinCap !== "number" ||
        !Number.isInteger(spec.roundControl.winningSpinCap) ||
        spec.roundControl.winningSpinCap < 1)
    ) {
      throw new InvalidFeatureConfigurationError(
        `Feature "${spec.id}" roundControl.winningSpinCap must be a positive integer >= 1.`,
        {
          featureId: spec.id,
          winningSpinCap: spec.roundControl.winningSpinCap,
        },
      );
    }
  }

  if (spec.triggers) {
    for (const trig of spec.triggers) {
      validateTriggerSpec(trig);
    }
  }
}

function validateTriggerSpec(trigger: FeatureTriggerSpec): void {
  if (!trigger || typeof trigger !== "object") {
    throw new InvalidFeatureTriggerError(
      "FeatureTriggerSpec must be a non-null object.",
      { trigger },
    );
  }
  if (typeof trigger.id !== "string" || trigger.id.trim().length === 0) {
    throw new InvalidFeatureTriggerError(
      "FeatureTriggerSpec.id must be a non-empty string.",
      { trigger },
    );
  }
  if (
    typeof trigger.targetFeatureId !== "string" ||
    trigger.targetFeatureId.trim().length === 0
  ) {
    throw new InvalidFeatureTriggerError(
      `Trigger "${trigger.id}" must specify a non-empty targetFeatureId.`,
      { triggerId: trigger.id },
    );
  }
  if (
    typeof trigger.threshold !== "number" ||
    !Number.isInteger(trigger.threshold) ||
    trigger.threshold < 1
  ) {
    throw new InvalidFeatureTriggerError(
      `Trigger "${trigger.id}" threshold must be an integer >= 1, received ${String(trigger.threshold)}.`,
      { triggerId: trigger.id, threshold: trigger.threshold },
    );
  }
  if (!Array.isArray(trigger.symbolIds) || trigger.symbolIds.length === 0) {
    throw new InvalidFeatureTriggerError(
      `Trigger "${trigger.id}" must specify a non-empty symbolIds array.`,
      { triggerId: trigger.id },
    );
  }
}

function validateBonusGameSpec(
  featureId: string,
  bonusSpec: BonusGameSpec,
): void {
  if (
    !bonusSpec ||
    typeof bonusSpec !== "object" ||
    !Array.isArray(bonusSpec.sectors) ||
    bonusSpec.sectors.length === 0
  ) {
    throw new InvalidBonusPoolError(
      `Feature "${featureId}" bonusGame must have a non-empty sectors array.`,
      { featureId },
    );
  }

  let totalPositiveWeight = 0;
  for (const sector of bonusSpec.sectors) {
    if (
      !sector ||
      typeof sector !== "object" ||
      typeof sector.id !== "string" ||
      sector.id.trim().length === 0
    ) {
      throw new InvalidBonusPoolError(
        `Feature "${featureId}" bonusGame sector must have a non-empty string id.`,
        { featureId, sector },
      );
    }
    if (
      typeof sector.weight !== "number" ||
      !Number.isFinite(sector.weight) ||
      sector.weight < 0
    ) {
      throw new InvalidBonusPoolError(
        `Feature "${featureId}" bonusGame sector "${sector.id}" has invalid weight (${String(sector.weight)}).`,
        { featureId, sectorId: sector.id, weight: sector.weight },
      );
    }
    if (
      sector.credits === undefined &&
      sector.action === undefined &&
      (!sector.actions || sector.actions.length === 0)
    ) {
      throw new InvalidBonusPoolError(
        `Feature "${featureId}" bonusGame sector "${sector.id}" must define credits, action, or both.`,
        { featureId, sectorId: sector.id },
      );
    }
    totalPositiveWeight += sector.weight;
  }

  if (totalPositiveWeight <= 0) {
    throw new InvalidBonusPoolError(
      `Feature "${featureId}" bonusGame sector pool has zero total positive weight.`,
      { featureId, totalPositiveWeight },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* DETERMINISTIC FEATURE ENGINE IMPLEMENTATION                                */
/* -------------------------------------------------------------------------- */

export class DeterministicFeatureEngine {
  private readonly baseReels: readonly NormalizedReelStrip[];
  private readonly visibleRows: number;
  private readonly featuresById: ReadonlyMap<string, FeatureSpec>;
  private readonly triggers: readonly FeatureTriggerSpec[];
  private readonly alternateReelsByFeatureId: ReadonlyMap<
    string,
    readonly NormalizedReelStrip[]
  >;

  constructor(config: FeatureEngineConfiguration | GameConfig) {
    if (!config || typeof config !== "object") {
      throw new InvalidFeatureConfigurationError(
        "FeatureEngine configuration must be a non-null object.",
        { config },
      );
    }

    if ("symbolsById" in config && config.symbolsById instanceof Map) {
      // Initialized from B01 GameConfig
      const gc = config as GameConfig;
      this.baseReels = gc.reels;
      this.visibleRows = gc.grid.rows;
      const specs: FeatureSpec[] = gc.features.map((f) => {
        const mode: FeatureModeKind =
          f.kind === "free_spins"
            ? "freeSpins"
            : f.kind === "hold_and_win"
              ? "holdAndWin"
              : f.kind === "pick_bonus"
                ? "bonus"
                : "custom";
        const initialSpins =
          typeof f.params.spins === "number" && f.params.spins > 0
            ? f.params.spins
            : 8;
        const startingMultiplier =
          typeof f.params.multiplier === "number" && f.params.multiplier > 0
            ? f.params.multiplier
            : 1;
        return Object.freeze({
          id: f.id,
          name: f.name,
          mode,
          enabled: f.enabled,
          startingMultiplier,
          ...(mode === "freeSpins"
            ? {
                freeSpins: Object.freeze({
                  initialSpins,
                  retriggerEnabled: true,
                  retriggerSymbolIds: f.triggerSymbolIds,
                  retriggerThreshold: f.triggerCount,
                  retriggerSpins: initialSpins,
                }),
              }
            : {}),
          triggers: Object.freeze(
            f.triggerSymbolIds.map((symId, idx) =>
              Object.freeze({
                id: `${f.id}-trigger-${idx + 1}`,
                source: "scatterCount" as const,
                targetFeatureId: f.id,
                symbolIds: Object.freeze([symId]),
                threshold: f.triggerCount,
                awardedSpins: mode === "freeSpins" ? initialSpins : 0,
                startingMultiplier,
              }),
            ),
          ),
        });
      });

      const fMap = new Map<string, FeatureSpec>();
      const altMap = new Map<string, readonly NormalizedReelStrip[]>();
      const allTriggers: FeatureTriggerSpec[] = [];

      for (const s of specs) {
        validateFeatureSpec(s);
        fMap.set(s.id, s);
        if (s.triggers) {
          allTriggers.push(...s.triggers);
        }
      }

      this.featuresById = fMap;
      this.alternateReelsByFeatureId = altMap;
      this.triggers = Object.freeze(allTriggers);
      return;
    }

    const fc = config as FeatureEngineConfiguration;
    this.baseReels = normalizeReelStrips(fc.baseReels, "base-reel");
    this.visibleRows = fc.visibleRows ?? 3;

    if (!Array.isArray(fc.features)) {
      throw new InvalidFeatureConfigurationError(
        "FeatureEngineConfiguration.features must be an array.",
        { features: fc.features },
      );
    }

    const fMap = new Map<string, FeatureSpec>();
    const altMap = new Map<string, readonly NormalizedReelStrip[]>();
    const collectedTriggers: FeatureTriggerSpec[] = [];

    for (const spec of fc.features) {
      validateFeatureSpec(spec);
      if (fMap.has(spec.id)) {
        throw new InvalidFeatureConfigurationError(
          `Duplicate feature ID "${spec.id}" in FeatureEngineConfiguration.`,
          { featureId: spec.id },
        );
      }
      fMap.set(spec.id, spec);
      if (spec.alternateReels && spec.alternateReels.length > 0) {
        altMap.set(
          spec.id,
          normalizeReelStrips(spec.alternateReels, `${spec.id}-reel`),
        );
      }
      if (spec.triggers) {
        for (const trig of spec.triggers) {
          collectedTriggers.push(trig);
        }
      }
    }

    if (fc.triggers) {
      for (const trig of fc.triggers) {
        validateTriggerSpec(trig);
        collectedTriggers.push(trig);
      }
    }

    // Validate all trigger targetFeatureId and upgradeTargetFeatureId references
    for (const trig of collectedTriggers) {
      if (!fMap.has(trig.targetFeatureId)) {
        throw new UnknownFeatureReferenceError(
          `Trigger "${trig.id}" references unknown targetFeatureId "${trig.targetFeatureId}".`,
          { triggerId: trig.id, targetFeatureId: trig.targetFeatureId },
        );
      }
    }

    for (const spec of fMap.values()) {
      if (
        spec.upgradeTargetFeatureId !== undefined &&
        !fMap.has(spec.upgradeTargetFeatureId)
      ) {
        throw new UnknownFeatureReferenceError(
          `Feature "${spec.id}" references unknown upgradeTargetFeatureId "${spec.upgradeTargetFeatureId}".`,
          {
            featureId: spec.id,
            upgradeTargetFeatureId: spec.upgradeTargetFeatureId,
          },
        );
      }
    }

    this.featuresById = fMap;
    this.alternateReelsByFeatureId = altMap;
    this.triggers = Object.freeze(collectedTriggers);
  }

  /**
   * Creates a clean, immutable base-mode FeatureRuntimeState.
   */
  public createInitialState(): FeatureRuntimeState {
    return Object.freeze({
      status: "idle",
      featureId: null,
      parentMode: "base",
      currentMode: "base",
      activeReelSource: "base",
      activeReels: this.baseReels,
      remainingSpins: 0,
      awardedSpins: 0,
      spinsPlayed: 0,
      retriggerBatchCount: 0,
      maxRetriggerBatches: null,
      accumulatedFeatureWin: 0,
      winningSpinCount: 0,
      winCap: null,
      winningSpinCap: null,
      currentMultiplier: 1,
      startingMultiplier: 1,
      holdAndWinState: null,
      lockedCells: Object.freeze([]),
      upgradeHistory: Object.freeze([]),
      meters: Object.freeze({}),
      firedEvaluationKeys: Object.freeze([]),
      bonusHistory: Object.freeze([]),
      endReason: null,
      featureWinSummary: null,
    });
  }

  /**
   * Returns the active reel strips for the given runtime state (feature reels while
   * a feature with alternateReels is active; base reels otherwise).
   */
  public getActiveReels(
    state: FeatureRuntimeState,
  ): readonly NormalizedReelStrip[] {
    if (state.status === "active" && state.featureId) {
      const alt = this.alternateReelsByFeatureId.get(state.featureId);
      if (alt && alt.length > 0) {
        return alt;
      }
    }
    return this.baseReels;
  }

  /**
   * Computes a deterministic board evaluation signature so the same qualifying
   * board evaluation never fires the same trigger more than once.
   */
  private getBoardEvaluationKey(
    triggerId: string,
    board: Board,
    evaluationId?: string,
  ): string {
    if (evaluationId && evaluationId.trim().length > 0) {
      return `${triggerId}::eval:${evaluationId.trim()}`;
    }
    const cellParts: string[] = [];
    for (let c = 0; c < board.cells.length; c++) {
      const col = board.cells[c]!;
      for (let r = 0; r < col.length; r++) {
        cellParts.push(col[r]!.symbolId);
      }
    }
    return `${triggerId}::grid:${cellParts.join(",")}`;
  }

  /**
   * Evaluates configured feature triggers against a resolved B04 Board.
   * Ensures each qualifying board evaluation fires that trigger at most once.
   */
  public evaluateTriggers(
    board: Board,
    state: FeatureRuntimeState = this.createInitialState(),
    options: {
      readonly evaluationId?: string;
      readonly scatterResult?: ScatterEvaluationResult;
    } = {},
  ): {
    readonly triggerResults: readonly FeatureTriggerEvaluation[];
    readonly nextState: FeatureRuntimeState;
  } {
    const firedSet = new Set<string>(state.firedEvaluationKeys);
    const results: FeatureTriggerEvaluation[] = [];

    for (const trig of this.triggers) {
      const featureSpec = this.featuresById.get(trig.targetFeatureId);
      if (featureSpec && featureSpec.enabled === false) {
        continue;
      }

      const evalKey = this.getBoardEvaluationKey(
        trig.id,
        board,
        options.evaluationId,
      );
      const alreadyFired = firedSet.has(evalKey);

      const { measuredValue, matchedPositions } = this.measureTriggerCondition(
        trig,
        board,
        options.scatterResult,
      );

      const meetsThreshold =
        trig.comparison === "exact"
          ? measuredValue === trig.threshold
          : measuredValue >= trig.threshold;

      const matched = meetsThreshold && !alreadyFired;
      if (matched) {
        firedSet.add(evalKey);
      }

      const awardedSpins = matched
        ? this.resolveAwardedSpinsForTrigger(
            trig,
            featureSpec,
            measuredValue,
          )
        : 0;
      const startingMultiplier = matched
        ? this.resolveStartingMultiplierForTrigger(
            trig,
            featureSpec,
            measuredValue,
          )
        : 1;

      results.push(
        Object.freeze({
          triggerId: trig.id,
          matched,
          alreadyFired: meetsThreshold && alreadyFired,
          measuredValue,
          threshold: trig.threshold,
          selectedFeatureId: matched ? trig.targetFeatureId : null,
          matchedPositions: Object.freeze(matchedPositions),
          awardedSpins,
          startingMultiplier,
        }),
      );
    }

    const nextState: FeatureRuntimeState = Object.freeze({
      ...state,
      firedEvaluationKeys: Object.freeze(Array.from(firedSet)),
    });

    return Object.freeze({
      triggerResults: Object.freeze(results),
      nextState,
    });
  }

  private measureTriggerCondition(
    trig: FeatureTriggerSpec,
    board: Board,
    scatterResult?: ScatterEvaluationResult,
  ): {
    readonly measuredValue: number;
    readonly matchedPositions: readonly Position[];
  } {
    const symbolSet = new Set<string>(trig.symbolIds);
    const matchedPositions: Position[] = [];

    if (trig.source === "scatterCount" && scatterResult) {
      for (const sWin of scatterResult.scatters) {
        if (symbolSet.has(sWin.symbolId)) {
          for (const pos of sWin.positions) {
            matchedPositions.push(
              Object.freeze({
                reelIndex: pos.reelIndex,
                rowIndex: pos.rowIndex,
              }),
            );
          }
        }
      }
      if (matchedPositions.length > 0) {
        return {
          measuredValue: matchedPositions.length,
          matchedPositions,
        };
      }
    }

    if (trig.source === "zoneCount") {
      const zone = trig.zone;
      const allowedReels = zone?.reelIndexes
        ? new Set<number>(zone.reelIndexes)
        : null;
      const allowedRows = zone?.rowIndexes
        ? new Set<number>(zone.rowIndexes)
        : null;
      const allowedCoordKeys = zone?.positions
        ? new Set<string>(
            zone.positions.map((p) => `${p.reelIndex}:${p.rowIndex}`),
          )
        : null;

      for (let c = 0; c < board.cells.length; c++) {
        if (allowedReels && !allowedReels.has(c)) continue;
        const col = board.cells[c]!;
        for (let r = 0; r < col.length; r++) {
          if (allowedRows && !allowedRows.has(r)) continue;
          if (allowedCoordKeys && !allowedCoordKeys.has(`${c}:${r}`)) continue;
          const cell = col[r]!;
          if (symbolSet.has(cell.symbolId)) {
            matchedPositions.push(
              Object.freeze({ reelIndex: c, rowIndex: r }),
            );
          }
        }
      }

      return {
        measuredValue: matchedPositions.length,
        matchedPositions,
      };
    }

    if (trig.source === "reelPresence") {
      const targetReels = trig.reelIndexes ?? [];
      let reelsWithSymbolCount = 0;

      for (const reelIdx of targetReels) {
        const col = board.cells[reelIdx];
        if (!col) continue;
        let foundOnThisReel = false;
        for (let r = 0; r < col.length; r++) {
          const cell = col[r]!;
          if (symbolSet.has(cell.symbolId)) {
            foundOnThisReel = true;
            matchedPositions.push(
              Object.freeze({ reelIndex: reelIdx, rowIndex: r }),
            );
          }
        }
        if (foundOnThisReel) {
          reelsWithSymbolCount++;
        }
      }

      if (
        trig.requireAllReels &&
        targetReels.length > 0 &&
        reelsWithSymbolCount < targetReels.length
      ) {
        return {
          measuredValue: reelsWithSymbolCount,
          matchedPositions: [],
        };
      }

      return {
        measuredValue: reelsWithSymbolCount,
        matchedPositions,
      };
    }

    // Default: scatterCount / symbolCount / boardCondition across entire board
    for (let c = 0; c < board.cells.length; c++) {
      const col = board.cells[c]!;
      for (let r = 0; r < col.length; r++) {
        const cell = col[r]!;
        if (symbolSet.has(cell.symbolId)) {
          matchedPositions.push(Object.freeze({ reelIndex: c, rowIndex: r }));
        }
      }
    }

    return {
      measuredValue: matchedPositions.length,
      matchedPositions,
    };
  }

  private resolveAwardedSpinsForTrigger(
    trig: FeatureTriggerSpec,
    featureSpec: FeatureSpec | undefined,
    measuredCount: number,
  ): number {
    const scaleMap =
      trig.awardedSpinsByCount ?? featureSpec?.freeSpins?.spinsByTriggerCount;
    if (scaleMap) {
      if (scaleMap[measuredCount] !== undefined) {
        return scaleMap[measuredCount]!;
      }
      // Check highest configured count <= measuredCount
      let bestKey = -1;
      let bestVal = 0;
      for (const [kStr, val] of Object.entries(scaleMap)) {
        const k = Number(kStr);
        if (k <= measuredCount && k > bestKey) {
          bestKey = k;
          bestVal = val;
        }
      }
      if (bestKey > 0) {
        return bestVal;
      }
    }
    if (trig.awardedSpins !== undefined) {
      return trig.awardedSpins;
    }
    return featureSpec?.freeSpins?.initialSpins ?? 0;
  }

  private resolveStartingMultiplierForTrigger(
    trig: FeatureTriggerSpec,
    featureSpec: FeatureSpec | undefined,
    measuredCount: number,
  ): number {
    if (trig.startingMultiplierByCount) {
      if (trig.startingMultiplierByCount[measuredCount] !== undefined) {
        return trig.startingMultiplierByCount[measuredCount]!;
      }
      let bestKey = -1;
      let bestMult = 1;
      for (const [kStr, mult] of Object.entries(
        trig.startingMultiplierByCount,
      )) {
        const k = Number(kStr);
        if (k <= measuredCount && k > bestKey) {
          bestKey = k;
          bestMult = mult;
        }
      }
      if (bestKey > 0) {
        return bestMult;
      }
    }
    if (trig.startingMultiplier !== undefined) {
      return trig.startingMultiplier;
    }
    return featureSpec?.startingMultiplier ?? 1;
  }

  /**
   * Starts a configured feature by ID, initializing its runtime mode, alternate reels,
   * initial spins or Hold & Win respins, starting multiplier, and round caps.
   */
  public startFeature(
    featureId: string,
    options: {
      readonly previousState?: FeatureRuntimeState;
      readonly triggerCount?: number;
      readonly awardedSpinsOverride?: number;
      readonly startingMultiplierOverride?: number;
      readonly initialLockedCells?: readonly LockedFeatureCell[];
      readonly board?: Board;
      readonly cellValuesByCoord?: Readonly<Record<string, number>>;
    } = {},
  ): FeatureEngineResult {
    const spec = this.featuresById.get(featureId);
    if (!spec) {
      throw new UnknownFeatureReferenceError(
        `Cannot start unknown feature "${featureId}".`,
        { featureId },
      );
    }
    if (spec.enabled === false) {
      throw new InvalidFeatureStateError(
        `Cannot start disabled feature "${featureId}".`,
        { featureId },
      );
    }

    const prev = options.previousState ?? this.createInitialState();
    const altReels = this.alternateReelsByFeatureId.get(featureId);
    const activeReelSource: "base" | "feature" =
      altReels && altReels.length > 0 ? "feature" : "base";
    const activeReels =
      activeReelSource === "feature" ? altReels! : this.baseReels;

    let initialSpins = options.awardedSpinsOverride ?? 0;
    if (options.awardedSpinsOverride === undefined && spec.freeSpins) {
      if (
        options.triggerCount !== undefined &&
        spec.freeSpins.spinsByTriggerCount
      ) {
        const byCnt = spec.freeSpins.spinsByTriggerCount;
        if (byCnt[options.triggerCount] !== undefined) {
          initialSpins = byCnt[options.triggerCount]!;
        } else {
          let bestCnt = -1;
          let bestSpins = spec.freeSpins.initialSpins;
          for (const [cStr, sp] of Object.entries(byCnt)) {
            const c = Number(cStr);
            if (c <= options.triggerCount && c > bestCnt) {
              bestCnt = c;
              bestSpins = sp;
            }
          }
          initialSpins = bestSpins;
        }
      } else {
        initialSpins = spec.freeSpins.initialSpins;
      }
    }

    const startingMultiplier =
      options.startingMultiplierOverride ?? spec.startingMultiplier ?? 1;

    let holdAndWinState: HoldAndWinRuntimeState | null = null;
    let lockedCells: readonly LockedFeatureCell[] = Object.freeze([]);

    if (spec.holdAndWin) {
      const initialLocked: LockedFeatureCell[] = [];
      if (options.initialLockedCells) {
        for (const lc of options.initialLockedCells) {
          initialLocked.push(Object.freeze({ ...lc }));
        }
      } else if (options.board) {
        const lockSet = new Set<string>(spec.holdAndWin.lockableSymbolIds);
        for (let c = 0; c < options.board.cells.length; c++) {
          const col = options.board.cells[c]!;
          for (let r = 0; r < col.length; r++) {
            const cell = col[r]!;
            if (lockSet.has(cell.symbolId)) {
              const coordKey = `${c}:${r}`;
              const val =
                options.cellValuesByCoord?.[coordKey] ??
                spec.holdAndWin.symbolValuesBySymbolId?.[cell.symbolId] ??
                spec.holdAndWin.defaultSymbolValue ??
                1;
              initialLocked.push(
                Object.freeze({
                  reelIndex: c,
                  rowIndex: r,
                  symbolId: cell.symbolId,
                  creditValue: roundCurrency(val),
                  lockedAtStep: 0,
                }),
              );
            }
          }
        }
      }

      lockedCells = Object.freeze(initialLocked);
      const poolTotal = roundCurrency(
        initialLocked.reduce((acc, item) => acc + item.creditValue, 0),
      );
      holdAndWinState = Object.freeze({
        initialRespins: spec.holdAndWin.initialRespins,
        respinsRemaining: spec.holdAndWin.initialRespins,
        lockedCells,
        lockedSymbolCount: lockedCells.length,
        lockedPoolTotalValue: poolTotal,
        lockedPoolReadyToPay: false,
        lockedPoolPaidOnce: false,
      });
    }

    const nextState: FeatureRuntimeState = Object.freeze({
      status: "active",
      featureId: spec.id,
      parentMode: "base",
      currentMode: spec.mode,
      activeReelSource,
      activeReels,
      remainingSpins: initialSpins,
      awardedSpins: initialSpins,
      spinsPlayed: 0,
      retriggerBatchCount: 0,
      maxRetriggerBatches: spec.freeSpins?.maxRetriggerBatches ?? null,
      accumulatedFeatureWin: 0,
      winningSpinCount: 0,
      winCap: spec.roundControl?.winCap ?? null,
      winningSpinCap: spec.roundControl?.winningSpinCap ?? null,
      currentMultiplier: startingMultiplier,
      startingMultiplier,
      holdAndWinState,
      lockedCells,
      upgradeHistory: Object.freeze([]),
      meters: Object.freeze({}),
      firedEvaluationKeys: prev.firedEvaluationKeys,
      bonusHistory: Object.freeze([]),
      endReason: null,
      featureWinSummary: null,
    });

    const enterAction: FeatureAction = Object.freeze({
      type: "enterFeature",
      featureId: spec.id,
      awardedSpins: initialSpins,
      startingMultiplier,
    });

    return Object.freeze({
      featureStatus: "active",
      featureId: spec.id,
      currentMode: spec.mode,
      activeReelSource,
      activeReels,
      triggerResults: Object.freeze([]),
      actionsExecuted: Object.freeze([enterAction]),
      spinsBefore: prev.remainingSpins,
      spinsAfter: nextState.remainingSpins,
      awardedSpinsBefore: prev.awardedSpins,
      awardedSpinsAfter: nextState.awardedSpins,
      retriggers: Object.freeze([]),
      upgradeInfo: null,
      multiplierBefore: prev.currentMultiplier,
      multiplierAfter: nextState.currentMultiplier,
      featureWinBefore: prev.accumulatedFeatureWin,
      featureWinAfter: 0,
      stepWinAwarded: 0,
      stepWinTrimmedByCap: 0,
      winningSpinCount: 0,
      holdAndWinState,
      bonusResolution: null,
      capStatus: Object.freeze({
        winCapReached: false,
        winningSpinCapReached: false,
        retriggerBatchCapReached: false,
      }),
      endReason: null,
      featureWinSummary: null,
      rngMetadata: null,
      nextState,
    });
  }

  /**
   * Executes a single feature step (Free Spin step, Hold & Win respin step, or Bonus Game step).
   */
  public runFeatureStep(
    state: FeatureRuntimeState,
    input: FeatureStepInput = {},
  ): FeatureEngineResult {
    if (state.status !== "active" || !state.featureId) {
      throw new InvalidFeatureStateError(
        "Cannot runFeatureStep when no feature is currently active.",
        { status: state.status, featureId: state.featureId },
      );
    }

    const spec = this.featuresById.get(state.featureId);
    if (!spec) {
      throw new UnknownFeatureReferenceError(
        `Active feature "${state.featureId}" does not exist in FeatureEngine.`,
        { featureId: state.featureId },
      );
    }

    if (spec.mode === "holdAndWin" && state.holdAndWinState) {
      return this.runHoldAndWinStep(state, spec, input);
    }

    if (spec.mode === "bonus" && spec.bonusGame) {
      return this.runBonusGameStep(state, spec, input);
    }

    return this.runFreeSpinsOrCustomStep(state, spec, input);
  }

  private runFreeSpinsOrCustomStep(
    state: FeatureRuntimeState,
    spec: FeatureSpec,
    input: FeatureStepInput,
  ): FeatureEngineResult {
    const spinsBefore = state.remainingSpins;
    const awardedSpinsBefore = state.awardedSpins;
    const multiplierBefore = state.currentMultiplier;
    const featureWinBefore = state.accumulatedFeatureWin;

    if (spinsBefore <= 0 && spec.mode === "freeSpins") {
      return this.endFeature(state, "spinsExhausted");
    }

    // Consume 1 spin
    let remainingSpins = Math.max(0, spinsBefore - 1);
    let awardedSpins = awardedSpinsBefore;
    const spinsPlayed = state.spinsPlayed + 1;
    let retriggerBatchCount = state.retriggerBatchCount;
    let currentMultiplier = state.currentMultiplier;
    const actionsExecuted: FeatureAction[] = [];
    const retriggers: FeatureRetriggerRecord[] = [];
    let retriggerBatchCapReached = false;

    // Calculate raw win from this spin (or sum of cascade wins on this spin)
    let rawSpinWin = input.spinWinAmount ?? 0;
    if (
      input.spinWinAmount === undefined &&
      input.cascadeWins &&
      input.cascadeWins.length > 0
    ) {
      rawSpinWin = roundCurrency(
        input.cascadeWins.reduce((sum, w) => sum + w, 0),
      );
    }

    // Check whether this spin is a winning spin:
    // IMPORTANT RULE 10: A spin containing several cascades still counts as ONE winning spin!
    const isWinningSpin =
      rawSpinWin > 0 ||
      (input.cascadeWins !== undefined &&
        input.cascadeWins.some((w) => w > 0));
    let winningSpinCount =
      state.winningSpinCount + (isWinningSpin ? 1 : 0);

    // Check for retrigger on board if freeSpins.retriggerEnabled
    if (
      spec.freeSpins?.retriggerEnabled &&
      input.board &&
      spec.freeSpins.retriggerSymbolIds &&
      spec.freeSpins.retriggerSymbolIds.length > 0
    ) {
      const retrigSet = new Set<string>(spec.freeSpins.retriggerSymbolIds);
      let countOnBoard = 0;
      for (const col of input.board.cells) {
        for (const cell of col) {
          if (retrigSet.has(cell.symbolId)) {
            countOnBoard++;
          }
        }
      }
      const threshold = spec.freeSpins.retriggerThreshold ?? 3;
      if (countOnBoard >= threshold) {
        const maxBatches = state.maxRetriggerBatches;
        if (maxBatches !== null && retriggerBatchCount >= maxBatches) {
          retriggerBatchCapReached = true;
          retriggers.push(
            Object.freeze({
              featureId: spec.id,
              batchIndex: retriggerBatchCount,
              triggerCount: countOnBoard,
              spinsAdded: 0,
              cappedOut: true,
            }),
          );
        } else {
          let spinsToAdd = spec.freeSpins.retriggerSpins ?? 0;
          if (spec.freeSpins.retriggerSpinsByCount) {
            const byCnt = spec.freeSpins.retriggerSpinsByCount;
            if (byCnt[countOnBoard] !== undefined) {
              spinsToAdd = byCnt[countOnBoard]!;
            } else {
              let bestK = -1;
              for (const [kStr, sp] of Object.entries(byCnt)) {
                const k = Number(kStr);
                if (k <= countOnBoard && k > bestK) {
                  bestK = k;
                  spinsToAdd = sp;
                }
              }
            }
          }
          if (spinsToAdd > 0) {
            retriggerBatchCount += 1;
            remainingSpins += spinsToAdd;
            awardedSpins += spinsToAdd;
            if (maxBatches !== null && retriggerBatchCount >= maxBatches) {
              retriggerBatchCapReached = true;
            }
            const retrigAction: FeatureAction = Object.freeze({
              type: "retrigger",
              spins: spinsToAdd,
              triggerCount: countOnBoard,
            });
            actionsExecuted.push(retrigAction);
            retriggers.push(
              Object.freeze({
                featureId: spec.id,
                batchIndex: retriggerBatchCount,
                triggerCount: countOnBoard,
                spinsAdded: spinsToAdd,
                cappedOut: false,
              }),
            );
          }
        }
      }
    }

    // Apply any explicit step actions
    const meters: Record<string, number> = { ...state.meters };
    let upgradeInfo: FeatureUpgradeRecord | null = null;
    let activeFeatureId = state.featureId!;
    let currentMode = state.currentMode;
    let activeReelSource = state.activeReelSource;
    let activeReels = state.activeReels;
    let upgradeHistory = [...state.upgradeHistory];

    if (input.actions) {
      for (const act of input.actions) {
        actionsExecuted.push(act);
        if (act.type === "awardSpins") {
          remainingSpins += act.spins;
          awardedSpins += act.spins;
        } else if (act.type === "addCredits") {
          rawSpinWin = roundCurrency(rawSpinWin + act.amount);
          if (act.countsAsWinningSpin && !isWinningSpin && act.amount > 0) {
            winningSpinCount += 1;
          }
        } else if (act.type === "setMeter") {
          meters[act.meterKey] = act.value;
        } else if (act.type === "incrementMeter") {
          meters[act.meterKey] = (meters[act.meterKey] ?? 0) + act.delta;
        } else if (act.type === "modifyFeatureState") {
          if (act.multiplier !== undefined) {
            currentMultiplier = act.multiplier;
          }
          if (act.remainingSpinsDelta !== undefined) {
            remainingSpins = Math.max(
              0,
              remainingSpins + act.remainingSpinsDelta,
            );
          }
        } else if (act.type === "upgradeFeature") {
          const targetSpec = this.featuresById.get(act.targetFeatureId);
          if (!targetSpec) {
            throw new UnknownFeatureReferenceError(
              `Cannot upgrade to unknown feature "${act.targetFeatureId}".`,
              { targetFeatureId: act.targetFeatureId },
            );
          }
          const addedSpins =
            act.additionalSpins ?? targetSpec.freeSpins?.initialSpins ?? 0;
          const carriedSpins = remainingSpins;
          remainingSpins = carriedSpins + addedSpins;
          awardedSpins += addedSpins;
          if (act.multiplierOverride !== undefined) {
            currentMultiplier = act.multiplierOverride;
          } else if (
            targetSpec.startingMultiplier !== undefined &&
            targetSpec.startingMultiplier > currentMultiplier
          ) {
            currentMultiplier = targetSpec.startingMultiplier;
          }
          upgradeInfo = Object.freeze({
            fromFeatureId: activeFeatureId,
            toFeatureId: targetSpec.id,
            carriedSpins,
            addedSpins,
            totalSpinsAfterUpgrade: remainingSpins,
            multiplierAfterUpgrade: currentMultiplier,
          });
          upgradeHistory.push(upgradeInfo);
          activeFeatureId = targetSpec.id;
          currentMode = targetSpec.mode;
          const targetAltReels = this.alternateReelsByFeatureId.get(
            targetSpec.id,
          );
          if (targetAltReels && targetAltReels.length > 0) {
            activeReelSource = "feature";
            activeReels = targetAltReels;
          }
        }
      }
    }

    // Apply win cap & winning-spin cap (Rule 10)
    let stepWinAwarded = roundCurrency(rawSpinWin);
    let stepWinTrimmedByCap = 0;
    let accumulatedFeatureWin = roundCurrency(
      featureWinBefore + stepWinAwarded,
    );
    let winCapReached = false;
    let winningSpinCapReached = false;

    if (state.winCap !== null && accumulatedFeatureWin >= state.winCap) {
      winCapReached = true;
      const allowedStepWin = Math.max(
        0,
        roundCurrency(state.winCap - featureWinBefore),
      );
      stepWinTrimmedByCap = roundCurrency(stepWinAwarded - allowedStepWin);
      stepWinAwarded = allowedStepWin;
      accumulatedFeatureWin = roundCurrency(state.winCap);
      remainingSpins = 0;
    }

    if (
      state.winningSpinCap !== null &&
      winningSpinCount >= state.winningSpinCap
    ) {
      winningSpinCapReached = true;
      remainingSpins = 0;
    }

    const shouldComplete =
      winCapReached || winningSpinCapReached || remainingSpins === 0;
    const endReason: FeatureEndReason | null = winCapReached
      ? "winCapReached"
      : winningSpinCapReached
        ? "winningSpinCapReached"
        : remainingSpins === 0
          ? "spinsExhausted"
          : null;

    // Rule 4: Do NOT fabricate a zero-value feature-win event for a feature that paid nothing
    const featureWinSummary: FeatureWinSummary | null =
      shouldComplete && accumulatedFeatureWin > 0
        ? Object.freeze({
            featureId: activeFeatureId,
            totalFeatureWin: accumulatedFeatureWin,
            spinsPlayed,
            winningSpinCount,
          })
        : null;

    const nextState: FeatureRuntimeState = Object.freeze({
      ...state,
      status: shouldComplete ? "completed" : "active",
      featureId: shouldComplete ? null : activeFeatureId,
      currentMode: shouldComplete ? state.parentMode : currentMode,
      activeReelSource: shouldComplete ? "base" : activeReelSource,
      activeReels: shouldComplete ? this.baseReels : activeReels,
      remainingSpins,
      awardedSpins,
      spinsPlayed,
      retriggerBatchCount,
      accumulatedFeatureWin,
      winningSpinCount,
      currentMultiplier: shouldComplete ? 1 : currentMultiplier,
      upgradeHistory: Object.freeze(upgradeHistory),
      meters: Object.freeze(meters),
      endReason,
      featureWinSummary,
    });

    return Object.freeze({
      featureStatus: nextState.status,
      featureId: activeFeatureId,
      currentMode: nextState.currentMode,
      activeReelSource: nextState.activeReelSource,
      activeReels: nextState.activeReels,
      triggerResults: Object.freeze([]),
      actionsExecuted: Object.freeze(actionsExecuted),
      spinsBefore,
      spinsAfter: remainingSpins,
      awardedSpinsBefore,
      awardedSpinsAfter: awardedSpins,
      retriggers: Object.freeze(retriggers),
      upgradeInfo,
      multiplierBefore,
      multiplierAfter: nextState.currentMultiplier,
      featureWinBefore,
      featureWinAfter: accumulatedFeatureWin,
      stepWinAwarded,
      stepWinTrimmedByCap,
      winningSpinCount,
      holdAndWinState: null,
      bonusResolution: null,
      capStatus: Object.freeze({
        winCapReached,
        winningSpinCapReached,
        retriggerBatchCapReached,
      }),
      endReason,
      featureWinSummary,
      rngMetadata: null,
      nextState,
    });
  }

  /**
   * Executes a Hold & Win respin step (Rule 5):
   * - Locked coin/value symbols persist
   * - Newly locked symbols reset the respin counter to initialRespins
   * - If no new symbols lock, respinsRemaining decrements by 1
   * - When respinsRemaining reaches 0 (or board is full), the locked pool pays once
   */
  private runHoldAndWinStep(
    state: FeatureRuntimeState,
    spec: FeatureSpec,
    input: FeatureStepInput,
  ): FeatureEngineResult {
    const hwSpec = spec.holdAndWin!;
    const prevHw = state.holdAndWinState!;
    const spinsBefore = prevHw.respinsRemaining;
    const featureWinBefore = state.accumulatedFeatureWin;

    const lockedByCoord = new Map<string, LockedFeatureCell>();
    for (const lc of prevHw.lockedCells) {
      lockedByCoord.set(`${lc.reelIndex}:${lc.rowIndex}`, lc);
    }

    const lockableSet = new Set<string>(hwSpec.lockableSymbolIds);
    const stepIndex = state.spinsPlayed + 1;
    let newlyLockedCount = 0;
    let totalBoardCells = 0;

    if (input.board) {
      for (let c = 0; c < input.board.cells.length; c++) {
        const col = input.board.cells[c]!;
        totalBoardCells += col.length;
        for (let r = 0; r < col.length; r++) {
          const coordKey = `${c}:${r}`;
          if (lockedByCoord.has(coordKey)) {
            continue;
          }
          const cell = col[r]!;
          if (lockableSet.has(cell.symbolId)) {
            const val =
              input.cellValuesByCoord?.[coordKey] ??
              hwSpec.symbolValuesBySymbolId?.[cell.symbolId] ??
              hwSpec.defaultSymbolValue ??
              1;
            lockedByCoord.set(
              coordKey,
              Object.freeze({
                reelIndex: c,
                rowIndex: r,
                symbolId: cell.symbolId,
                creditValue: roundCurrency(val),
                lockedAtStep: stepIndex,
              }),
            );
            newlyLockedCount++;
          }
        }
      }
    }

    const updatedLockedCells = Object.freeze(
      Array.from(lockedByCoord.values()).sort(
        (a, b) => a.reelIndex - b.reelIndex || a.rowIndex - b.rowIndex,
      ),
    );
    const poolTotal = roundCurrency(
      updatedLockedCells.reduce((acc, item) => acc + item.creditValue, 0),
    );

    const boardIsFull =
      totalBoardCells > 0 && updatedLockedCells.length >= totalBoardCells;
    const respinsRemaining = boardIsFull
      ? 0
      : newlyLockedCount > 0
        ? hwSpec.initialRespins
        : Math.max(0, prevHw.respinsRemaining - 1);

    const isEnding = respinsRemaining === 0 || boardIsFull;
    const endReason: FeatureEndReason | null = boardIsFull
      ? "boardFull"
      : respinsRemaining === 0
        ? "respinsExhausted"
        : null;

    // When counter reaches 0 (or board is full), the locked pool pays ONCE
    let stepWinAwarded = 0;
    let stepWinTrimmedByCap = 0;
    let accumulatedFeatureWin = featureWinBefore;
    let winCapReached = false;
    let lockedPoolPaidOnce = prevHw.lockedPoolPaidOnce;

    if (isEnding && !prevHw.lockedPoolPaidOnce) {
      lockedPoolPaidOnce = true;
      stepWinAwarded = poolTotal;
      accumulatedFeatureWin = roundCurrency(featureWinBefore + stepWinAwarded);
      if (state.winCap !== null && accumulatedFeatureWin >= state.winCap) {
        winCapReached = true;
        const allowed = Math.max(
          0,
          roundCurrency(state.winCap - featureWinBefore),
        );
        stepWinTrimmedByCap = roundCurrency(stepWinAwarded - allowed);
        stepWinAwarded = allowed;
        accumulatedFeatureWin = roundCurrency(state.winCap);
      }
    }

    const nextHoldAndWinState: HoldAndWinRuntimeState = Object.freeze({
      initialRespins: hwSpec.initialRespins,
      respinsRemaining,
      lockedCells: updatedLockedCells,
      lockedSymbolCount: updatedLockedCells.length,
      lockedPoolTotalValue: poolTotal,
      lockedPoolReadyToPay: isEnding,
      lockedPoolPaidOnce,
    });

    const winningSpinCount =
      state.winningSpinCount + (stepWinAwarded > 0 ? 1 : 0);

    const featureWinSummary: FeatureWinSummary | null =
      isEnding && accumulatedFeatureWin > 0
        ? Object.freeze({
            featureId: state.featureId!,
            totalFeatureWin: accumulatedFeatureWin,
            spinsPlayed: stepIndex,
            winningSpinCount,
          })
        : null;

    const nextState: FeatureRuntimeState = Object.freeze({
      ...state,
      status: isEnding ? "completed" : "active",
      featureId: isEnding ? null : state.featureId,
      currentMode: isEnding ? state.parentMode : state.currentMode,
      activeReelSource: isEnding ? "base" : state.activeReelSource,
      activeReels: isEnding ? this.baseReels : state.activeReels,
      remainingSpins: respinsRemaining,
      spinsPlayed: stepIndex,
      accumulatedFeatureWin,
      winningSpinCount,
      holdAndWinState: nextHoldAndWinState,
      lockedCells: updatedLockedCells,
      endReason: winCapReached ? "winCapReached" : endReason,
      featureWinSummary,
    });

    return Object.freeze({
      featureStatus: nextState.status,
      featureId: state.featureId,
      currentMode: nextState.currentMode,
      activeReelSource: nextState.activeReelSource,
      activeReels: nextState.activeReels,
      triggerResults: Object.freeze([]),
      actionsExecuted: Object.freeze([]),
      spinsBefore,
      spinsAfter: respinsRemaining,
      awardedSpinsBefore: state.awardedSpins,
      awardedSpinsAfter: state.awardedSpins,
      retriggers: Object.freeze([]),
      upgradeInfo: null,
      multiplierBefore: state.currentMultiplier,
      multiplierAfter: nextState.currentMultiplier,
      featureWinBefore,
      featureWinAfter: accumulatedFeatureWin,
      stepWinAwarded,
      stepWinTrimmedByCap,
      winningSpinCount,
      holdAndWinState: nextHoldAndWinState,
      bonusResolution: null,
      capStatus: Object.freeze({
        winCapReached,
        winningSpinCapReached: false,
        retriggerBatchCapReached: false,
      }),
      endReason: nextState.endReason,
      featureWinSummary,
      rngMetadata: null,
      nextState,
    });
  }

  /**
   * Resolves a Bonus Game (Wheel, Pick, Trail, Crash, Instant Reveal) using B03 RandomSource.
   * Multi-pick selection is strictly without replacement, and credits are summed.
   */
  private runBonusGameStep(
    state: FeatureRuntimeState,
    spec: FeatureSpec,
    input: FeatureStepInput,
  ): FeatureEngineResult {
    const rng = input.rng;
    if (!rng) {
      throw new InvalidFeatureStateError(
        `Bonus game "${spec.id}" requires a B03 RandomSource in input.rng.`,
        { featureId: spec.id },
      );
    }

    const bonusSpec = spec.bonusGame!;
    validateBonusGameSpec(spec.id, bonusSpec);

    const snapshotBefore = rng.snapshot();
    const drawsBefore = rng.getDrawCount();

    const picksRequested = bonusSpec.picksCount ?? 1;
    const withoutReplacement = bonusSpec.withoutReplacement ?? true;

    const alreadyPickedIds = new Set<string>(
      state.bonusHistory.map((b) => b.sectorId),
    );
    let candidatePool: BonusOutcomeSector[] = withoutReplacement
      ? bonusSpec.sectors.filter(
          (s) => !alreadyPickedIds.has(s.id) && s.weight > 0,
        )
      : bonusSpec.sectors.filter((s) => s.weight > 0);

    const selections: BonusSelectionRecord[] = [];
    const actionsExecuted: FeatureAction[] = [];
    let totalCreditsAwarded = 0;

    for (let p = 0; p < picksRequested; p++) {
      if (candidatePool.length === 0) {
        break;
      }

      const weightedItems: WeightedItem<BonusOutcomeSector>[] =
        candidatePool.map((sector) => ({
          value: sector,
          weight: sector.weight,
        }));

      const picked = rng.weightedPick(weightedItems);
      const credits = picked.credits !== undefined ? roundCurrency(picked.credits) : 0;
      totalCreditsAwarded = roundCurrency(totalCreditsAwarded + credits);

      const sectorActions: FeatureAction[] = [];
      if (picked.action) {
        sectorActions.push(picked.action);
        actionsExecuted.push(picked.action);
      }
      if (picked.actions) {
        for (const a of picked.actions) {
          sectorActions.push(a);
          actionsExecuted.push(a);
        }
      }

      selections.push(
        Object.freeze({
          pickIndex: state.bonusHistory.length + selections.length,
          sectorId: picked.id,
          ...(picked.label !== undefined ? { label: picked.label } : {}),
          creditsAwarded: credits,
          actionsTriggered: Object.freeze(sectorActions),
        }),
      );

      if (withoutReplacement) {
        candidatePool = candidatePool.filter((s) => s.id !== picked.id);
      }

      if (picked.endsBonus) {
        break;
      }
    }

    const snapshotAfter = rng.snapshot();
    const drawsAfter = rng.getDrawCount();

    // Apply any actions triggered by picked sectors (e.g., enterFeature, upgradeFeature, setMeter)
    const meters: Record<string, number> = { ...state.meters };
    let currentMultiplier = state.currentMultiplier;

    for (const act of actionsExecuted) {
      if (act.type === "addCredits") {
        totalCreditsAwarded = roundCurrency(totalCreditsAwarded + act.amount);
      } else if (act.type === "setMeter") {
        meters[act.meterKey] = act.value;
      } else if (act.type === "incrementMeter") {
        meters[act.meterKey] = (meters[act.meterKey] ?? 0) + act.delta;
      } else if (
        act.type === "modifyFeatureState" &&
        act.multiplier !== undefined
      ) {
        currentMultiplier = act.multiplier;
      }
    }

    const featureWinBefore = state.accumulatedFeatureWin;
    let stepWinAwarded = totalCreditsAwarded;
    let stepWinTrimmedByCap = 0;
    let accumulatedFeatureWin = roundCurrency(
      featureWinBefore + stepWinAwarded,
    );
    let winCapReached = false;

    if (state.winCap !== null && accumulatedFeatureWin >= state.winCap) {
      winCapReached = true;
      const allowed = Math.max(
        0,
        roundCurrency(state.winCap - featureWinBefore),
      );
      stepWinTrimmedByCap = roundCurrency(stepWinAwarded - allowed);
      stepWinAwarded = allowed;
      accumulatedFeatureWin = roundCurrency(state.winCap);
    }

    const winningSpinCount =
      state.winningSpinCount + (stepWinAwarded > 0 ? 1 : 0);
    const updatedBonusHistory = Object.freeze([
      ...state.bonusHistory,
      ...selections,
    ]);

    const bonusResolution: BonusGameResolution = Object.freeze({
      bonusType: bonusSpec.bonusType,
      selections: Object.freeze(selections),
      totalCreditsAwarded: stepWinAwarded,
      remainingPoolSize: candidatePool.length,
    });

    const endReason: FeatureEndReason = winCapReached
      ? "winCapReached"
      : "bonusCompleted";

    const featureWinSummary: FeatureWinSummary | null =
      accumulatedFeatureWin > 0
        ? Object.freeze({
            featureId: spec.id,
            totalFeatureWin: accumulatedFeatureWin,
            spinsPlayed: state.spinsPlayed + 1,
            winningSpinCount,
          })
        : null;

    const nextState: FeatureRuntimeState = Object.freeze({
      ...state,
      status: "completed",
      featureId: null,
      currentMode: state.parentMode,
      activeReelSource: "base",
      activeReels: this.baseReels,
      spinsPlayed: state.spinsPlayed + 1,
      accumulatedFeatureWin,
      winningSpinCount,
      currentMultiplier: 1,
      meters: Object.freeze(meters),
      bonusHistory: updatedBonusHistory,
      endReason,
      featureWinSummary,
    });

    return Object.freeze({
      featureStatus: "completed",
      featureId: spec.id,
      currentMode: nextState.currentMode,
      activeReelSource: "base",
      activeReels: this.baseReels,
      triggerResults: Object.freeze([]),
      actionsExecuted: Object.freeze(actionsExecuted),
      spinsBefore: state.remainingSpins,
      spinsAfter: 0,
      awardedSpinsBefore: state.awardedSpins,
      awardedSpinsAfter: state.awardedSpins,
      retriggers: Object.freeze([]),
      upgradeInfo: null,
      multiplierBefore: state.currentMultiplier,
      multiplierAfter: currentMultiplier,
      featureWinBefore,
      featureWinAfter: accumulatedFeatureWin,
      stepWinAwarded,
      stepWinTrimmedByCap,
      winningSpinCount,
      holdAndWinState: null,
      bonusResolution,
      capStatus: Object.freeze({
        winCapReached,
        winningSpinCapReached: false,
        retriggerBatchCapReached: false,
      }),
      endReason,
      featureWinSummary,
      rngMetadata: Object.freeze({
        drawsConsumed: drawsAfter - drawsBefore,
        snapshotBefore,
        snapshotAfter,
      }),
      nextState,
    });
  }

  /**
   * Upgrades an active feature into another configured feature (Rule 8):
   * - Carries the current feature's unspent spins
   * - Adds the new feature's awarded spins
   * - Continues under the upgraded feature's rules, mode, and alternate reels
   */
  public upgradeFeature(
    state: FeatureRuntimeState,
    targetFeatureId: string,
    options: {
      readonly additionalSpinsOverride?: number;
      readonly multiplierOverride?: number;
    } = {},
  ): FeatureEngineResult {
    if (state.status !== "active" || !state.featureId) {
      throw new InvalidFeatureStateError(
        "Cannot upgradeFeature when no feature is currently active.",
        { status: state.status, featureId: state.featureId },
      );
    }

    const targetSpec = this.featuresById.get(targetFeatureId);
    if (!targetSpec) {
      throw new UnknownFeatureReferenceError(
        `Cannot upgrade to unknown feature "${targetFeatureId}".`,
        { targetFeatureId },
      );
    }

    const spinsBefore = state.remainingSpins;
    const awardedSpinsBefore = state.awardedSpins;
    const multiplierBefore = state.currentMultiplier;

    const addedSpins =
      options.additionalSpinsOverride ??
      targetSpec.freeSpins?.initialSpins ??
      0;
    const carriedSpins = spinsBefore;
    const totalSpinsAfterUpgrade = carriedSpins + addedSpins;
    const awardedSpinsAfter = awardedSpinsBefore + addedSpins;

    const multiplierAfter =
      options.multiplierOverride ??
      targetSpec.startingMultiplier ??
      state.currentMultiplier;

    const altReels = this.alternateReelsByFeatureId.get(targetSpec.id);
    const activeReelSource: "base" | "feature" =
      altReels && altReels.length > 0 ? "feature" : "base";
    const activeReels =
      activeReelSource === "feature" ? altReels! : this.baseReels;

    const upgradeRecord: FeatureUpgradeRecord = Object.freeze({
      fromFeatureId: state.featureId,
      toFeatureId: targetSpec.id,
      carriedSpins,
      addedSpins,
      totalSpinsAfterUpgrade,
      multiplierAfterUpgrade: multiplierAfter,
    });

    const upgradeAction: FeatureAction = Object.freeze({
      type: "upgradeFeature",
      targetFeatureId: targetSpec.id,
      additionalSpins: addedSpins,
      multiplierOverride: multiplierAfter,
    });

    const nextState: FeatureRuntimeState = Object.freeze({
      ...state,
      featureId: targetSpec.id,
      currentMode: targetSpec.mode,
      activeReelSource,
      activeReels,
      remainingSpins: totalSpinsAfterUpgrade,
      awardedSpins: awardedSpinsAfter,
      maxRetriggerBatches:
        targetSpec.freeSpins?.maxRetriggerBatches ?? state.maxRetriggerBatches,
      winCap: targetSpec.roundControl?.winCap ?? state.winCap,
      winningSpinCap:
        targetSpec.roundControl?.winningSpinCap ?? state.winningSpinCap,
      currentMultiplier: multiplierAfter,
      upgradeHistory: Object.freeze([...state.upgradeHistory, upgradeRecord]),
    });

    return Object.freeze({
      featureStatus: "active",
      featureId: targetSpec.id,
      currentMode: targetSpec.mode,
      activeReelSource,
      activeReels,
      triggerResults: Object.freeze([]),
      actionsExecuted: Object.freeze([upgradeAction]),
      spinsBefore,
      spinsAfter: totalSpinsAfterUpgrade,
      awardedSpinsBefore,
      awardedSpinsAfter,
      retriggers: Object.freeze([]),
      upgradeInfo: upgradeRecord,
      multiplierBefore,
      multiplierAfter,
      featureWinBefore: state.accumulatedFeatureWin,
      featureWinAfter: state.accumulatedFeatureWin,
      stepWinAwarded: 0,
      stepWinTrimmedByCap: 0,
      winningSpinCount: state.winningSpinCount,
      holdAndWinState: nextState.holdAndWinState,
      bonusResolution: null,
      capStatus: Object.freeze({
        winCapReached: false,
        winningSpinCapReached: false,
        retriggerBatchCapReached: false,
      }),
      endReason: null,
      featureWinSummary: null,
      rngMetadata: null,
      nextState,
    });
  }

  /**
   * Executes a Feature Buy (Rule 6):
   * - "direct" entry: immediately starts the target feature
   * - "guaranteedTriggerSpin": uses B03 RandomSource to construct a deterministic
   *   board guaranteed to contain the exact required trigger-symbol count, then
   *   evaluates triggers and enters the feature.
   */
  public buyFeature(
    featureId: string,
    options: {
      readonly rng?: RandomSource;
      readonly previousState?: FeatureRuntimeState;
      readonly fillerSymbolIds?: readonly string[];
    } = {},
  ): FeatureEngineResult {
    const spec = this.featuresById.get(featureId);
    if (!spec) {
      throw new UnknownFeatureReferenceError(
        `Cannot buy unknown feature "${featureId}".`,
        { featureId },
      );
    }
    if (!spec.featureBuy || !spec.featureBuy.enabled) {
      throw new InvalidFeatureConfigurationError(
        `Feature "${featureId}" does not have featureBuy enabled.`,
        { featureId },
      );
    }

    const buySpec = spec.featureBuy;
    if (buySpec.entryMode === "direct") {
      return this.startFeature(buySpec.targetFeatureId, {
        previousState: options.previousState,
        triggerCount: buySpec.guaranteedTriggerCount,
      });
    }

    // "guaranteedTriggerSpin": use B03 RandomSource to place exact trigger symbols
    if (!options.rng) {
      throw new InvalidFeatureStateError(
        `Feature buy in "guaranteedTriggerSpin" mode for "${featureId}" requires a B03 RandomSource.`,
        { featureId },
      );
    }

    const rng = options.rng;
    const snapshotBefore = rng.snapshot();
    const drawsBefore = rng.getDrawCount();

    const reelCount =
      this.baseReels.length > 0 ? this.baseReels.length : 5;
    const rowCount = this.visibleRows > 0 ? this.visibleRows : 3;
    const triggerCount = buySpec.guaranteedTriggerCount ?? 3;
    const triggerSymId =
      buySpec.triggerSymbolId ??
      spec.triggers?.[0]?.symbolIds[0] ??
      "SCATTER";
    const fillers =
      options.fillerSymbolIds && options.fillerSymbolIds.length > 0
        ? options.fillerSymbolIds
        : ["A", "K", "Q", "J"];

    // Build all candidate board coordinates and pick exact `triggerCount` positions via B03 RandomSource
    const allCoords: { reelIndex: number; rowIndex: number }[] = [];
    for (let c = 0; c < reelCount; c++) {
      for (let r = 0; r < rowCount; r++) {
        allCoords.push({ reelIndex: c, rowIndex: r });
      }
    }

    if (triggerCount > allCoords.length) {
      throw new InvalidFeatureConfigurationError(
        `guaranteedTriggerCount (${triggerCount}) exceeds total board cells (${allCoords.length}).`,
        { featureId, triggerCount, totalCells: allCoords.length },
      );
    }

    const selectedTriggerCoords = new Set<string>();
    const availableCoords = [...allCoords];
    for (let i = 0; i < triggerCount; i++) {
      const pickedIdx = rng.nextInt(availableCoords.length);
      const coord = availableCoords[pickedIdx]!;
      selectedTriggerCoords.add(`${coord.reelIndex}:${coord.rowIndex}`);
      availableCoords.splice(pickedIdx, 1);
    }

    const gridColumns: string[][] = [];
    for (let c = 0; c < reelCount; c++) {
      const col: string[] = [];
      for (let r = 0; r < rowCount; r++) {
        if (selectedTriggerCoords.has(`${c}:${r}`)) {
          col.push(triggerSymId);
        } else {
          col.push(rng.pick(fillers));
        }
      }
      gridColumns.push(col);
    }

    const purchasedBoard = createBoardFromSymbolGrid(gridColumns);
    const trigEval = this.evaluateTriggers(
      purchasedBoard,
      options.previousState ?? this.createInitialState(),
    );
    const matchedTrig = trigEval.triggerResults.find(
      (t) => t.matched && t.selectedFeatureId === buySpec.targetFeatureId,
    );

    const started = this.startFeature(buySpec.targetFeatureId, {
      previousState: trigEval.nextState,
      triggerCount,
      awardedSpinsOverride: matchedTrig?.awardedSpins,
      startingMultiplierOverride: matchedTrig?.startingMultiplier,
      board: purchasedBoard,
    });

    const snapshotAfter = rng.snapshot();
    const drawsAfter = rng.getDrawCount();

    return Object.freeze({
      ...started,
      triggerResults: trigEval.triggerResults,
      purchasedBoard,
      rngMetadata: Object.freeze({
        drawsConsumed: drawsAfter - drawsBefore,
        snapshotBefore,
        snapshotAfter,
      }),
    });
  }

  /**
   * Explicitly ends the active feature, restoring base-game mode and reels,
   * and exposing the total feature win only if > 0 (Rule 4).
   */
  public endFeature(
    state: FeatureRuntimeState,
    reason: FeatureEndReason = "explicitEnd",
  ): FeatureEngineResult {
    const activeId = state.featureId;
    const totalWin = state.accumulatedFeatureWin;

    // Rule 4: Do NOT fabricate a zero-value feature-win event for a feature that paid nothing
    const featureWinSummary: FeatureWinSummary | null =
      activeId && totalWin > 0
        ? Object.freeze({
            featureId: activeId,
            totalFeatureWin: totalWin,
            spinsPlayed: state.spinsPlayed,
            winningSpinCount: state.winningSpinCount,
          })
        : null;

    const nextState: FeatureRuntimeState = Object.freeze({
      ...state,
      status: "completed",
      featureId: null,
      currentMode: state.parentMode,
      activeReelSource: "base",
      activeReels: this.baseReels,
      remainingSpins: 0,
      currentMultiplier: 1,
      endReason: reason,
      featureWinSummary,
    });

    return Object.freeze({
      featureStatus: "completed",
      featureId: activeId,
      currentMode: nextState.currentMode,
      activeReelSource: "base",
      activeReels: this.baseReels,
      triggerResults: Object.freeze([]),
      actionsExecuted: Object.freeze([
        Object.freeze({ type: "endFeature", reason }),
      ]),
      spinsBefore: state.remainingSpins,
      spinsAfter: 0,
      awardedSpinsBefore: state.awardedSpins,
      awardedSpinsAfter: state.awardedSpins,
      retriggers: Object.freeze([]),
      upgradeInfo: null,
      multiplierBefore: state.currentMultiplier,
      multiplierAfter: 1,
      featureWinBefore: totalWin,
      featureWinAfter: totalWin,
      stepWinAwarded: 0,
      stepWinTrimmedByCap: 0,
      winningSpinCount: state.winningSpinCount,
      holdAndWinState: nextState.holdAndWinState,
      bonusResolution: null,
      capStatus: Object.freeze({
        winCapReached: reason === "winCapReached",
        winningSpinCapReached: reason === "winningSpinCapReached",
        retriggerBatchCapReached: false,
      }),
      endReason: reason,
      featureWinSummary,
      rngMetadata: null,
      nextState,
    });
  }

  /**
   * Applies a single typed FeatureAction to the given FeatureRuntimeState.
   */
  public applyAction(
    state: FeatureRuntimeState,
    action: FeatureAction,
  ): FeatureEngineResult {
    if (!action || typeof action !== "object" || typeof action.type !== "string") {
      throw new InvalidFeatureActionError(
        "FeatureAction must be a non-null object with a string type.",
        { action },
      );
    }

    if (action.type === "enterFeature") {
      return this.startFeature(action.featureId, {
        previousState: state,
        awardedSpinsOverride: action.awardedSpins,
        startingMultiplierOverride: action.startingMultiplier,
      });
    }

    if (action.type === "upgradeFeature") {
      return this.upgradeFeature(state, action.targetFeatureId, {
        additionalSpinsOverride: action.additionalSpins,
        multiplierOverride: action.multiplierOverride,
      });
    }

    if (action.type === "endFeature") {
      return this.endFeature(state, action.reason ?? "explicitEnd");
    }

    return this.runFeatureStep(state, { actions: [action] });
  }

  /**
   * Serializes a FeatureRuntimeState into a deterministic JSON string snapshot.
   */
  public snapshot(state: FeatureRuntimeState): string {
    return JSON.stringify(state);
  }

  /**
   * Restores an immutable FeatureRuntimeState from a JSON snapshot.
   */
  public restore(serializedSnapshot: string): FeatureRuntimeState {
    if (
      typeof serializedSnapshot !== "string" ||
      serializedSnapshot.trim().length === 0
    ) {
      throw new InvalidFeatureStateError(
        "FeatureRuntimeState snapshot must be a non-empty JSON string.",
        { serializedSnapshot },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(serializedSnapshot);
    } catch (err) {
      throw new InvalidFeatureStateError(
        `Failed to parse FeatureRuntimeState snapshot: ${err instanceof Error ? err.message : String(err)}`,
        { serializedSnapshot },
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw new InvalidFeatureStateError(
        "Restored FeatureRuntimeState must be a non-null object.",
        { parsed },
      );
    }

    const candidate = parsed as Partial<FeatureRuntimeState>;
    if (
      typeof candidate.status !== "string" ||
      typeof candidate.currentMode !== "string" ||
      typeof candidate.remainingSpins !== "number"
    ) {
      throw new InvalidFeatureStateError(
        "Restored object does not match FeatureRuntimeState contract.",
        { parsed },
      );
    }

    const activeReelSource =
      candidate.activeReelSource === "feature" ? "feature" : "base";
    const activeReels =
      activeReelSource === "feature" && candidate.featureId
        ? (this.alternateReelsByFeatureId.get(candidate.featureId) ??
          this.baseReels)
        : this.baseReels;

    return Object.freeze({
      status: candidate.status,
      featureId: candidate.featureId ?? null,
      parentMode: candidate.parentMode ?? "base",
      currentMode: candidate.currentMode,
      activeReelSource,
      activeReels,
      remainingSpins: candidate.remainingSpins,
      awardedSpins: candidate.awardedSpins ?? 0,
      spinsPlayed: candidate.spinsPlayed ?? 0,
      retriggerBatchCount: candidate.retriggerBatchCount ?? 0,
      maxRetriggerBatches: candidate.maxRetriggerBatches ?? null,
      accumulatedFeatureWin: candidate.accumulatedFeatureWin ?? 0,
      winningSpinCount: candidate.winningSpinCount ?? 0,
      winCap: candidate.winCap ?? null,
      winningSpinCap: candidate.winningSpinCap ?? null,
      currentMultiplier: candidate.currentMultiplier ?? 1,
      startingMultiplier: candidate.startingMultiplier ?? 1,
      holdAndWinState: candidate.holdAndWinState
        ? Object.freeze({
            ...candidate.holdAndWinState,
            lockedCells: Object.freeze(
              (candidate.holdAndWinState.lockedCells ?? []).map((lc) =>
                Object.freeze({ ...lc }),
              ),
            ),
          })
        : null,
      lockedCells: Object.freeze(
        (candidate.lockedCells ?? []).map((lc) => Object.freeze({ ...lc })),
      ),
      upgradeHistory: Object.freeze(
        (candidate.upgradeHistory ?? []).map((u) => Object.freeze({ ...u })),
      ),
      meters: Object.freeze({ ...(candidate.meters ?? {}) }),
      firedEvaluationKeys: Object.freeze([
        ...(candidate.firedEvaluationKeys ?? []),
      ]),
      bonusHistory: Object.freeze(
        (candidate.bonusHistory ?? []).map((b) =>
          Object.freeze({
            ...b,
            actionsTriggered: Object.freeze([...(b.actionsTriggered ?? [])]),
          }),
        ),
      ),
      endReason: candidate.endReason ?? null,
      featureWinSummary: candidate.featureWinSummary
        ? Object.freeze({ ...candidate.featureWinSummary })
        : null,
    });
  }
}

export function createFeatureEngine(
  config: FeatureEngineConfiguration | GameConfig,
): DeterministicFeatureEngine {
  return new DeterministicFeatureEngine(config);
}
