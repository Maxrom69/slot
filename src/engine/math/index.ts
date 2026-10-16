/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 / B16 — Math Simulation, Verification, Replay & Statistics Engine
 *
 * Implements the dedicated MathSimulationEngine (`DeterministicMathSimulationEngine`,
 * `createMathSimulationEngine`) that executes complete game rounds through the
 * real B01–B15 backend engine subsystems, collects exact mathematical statistics
 * (RTP, Hit Frequency, Maximum Win, Win Distribution, Volatility, Feature Stats,
 * Win-Source Stats, Tumble/Cascade Stats, Bankroll Stats), runs deterministic
 * fixed-stop verification with structured board-by-board diffs, replays individual
 * spins from captured reproduction packages, compares simulation reports, and
 * exposes clean extension points for future RTP/volatility calibration.
 *
 * Pure TypeScript — zero React, DOM, browser globals, Date.now(), or Math.random().
 */

import { canonicalSimulationData, hashSimulationData, validateSimulationOptions, safeSimulationUnits, safeSimulationSum, reconcileSimulationSources, SIMULATION_SOURCES } from "./simulation-support";
import { runMechanicOperations, type ExecutionStage, type RoundExecutionInput, type RoundObservationOptions, type StageExpectation } from "./round-execution";
export * from "./round-execution";
import type { GameBlueprint, Volatility } from "@/lib/blueprint/types";
import type { Board, Position } from "../board";
import { createBoardBuilder } from "../board";
import { createClusterEngine } from "../clusters";
import type { EngineEvaluationMode, GameConfig, PaylineId } from "../config";
import { adaptBlueprintToGameConfig, isGameConfig } from "../config";
import type {
  CascadeStepOptions,
  DeterministicBoardDynamicsEngine,
} from "../dynamics";
import { createBoardDynamicsEngine } from "../dynamics";
import {
  InvalidSimulationConfigurationError,
  InvalidVerificationCaseError,
  SimulationComparisonError,
  SimulationExecutionError,
  SimulationGuardExceededError,
  SimulationReplayError,
  SlotEngineError,
} from "../errors";
import { createWinEvaluator } from "../evaluation";
import type {
  DeterministicFeatureEngine,
  FeatureEngineConfiguration,
  FeatureRuntimeState,
  FeatureSpec,
  FeatureTriggerEvaluation,
} from "../features";
import { createFeatureEngine } from "../features";
import type {
  ActionSequence,
  FeatureCondition,
  FeatureLogicEngine,
  FeatureLogicState,
  LogicSnapshot,
  MeterDefinition,
} from "../logic";
import { createFeatureLogicEngine } from "../logic";
import type {
  AssignedValueDefinition,
  CollectionDefinition,
  GeometricTumbleMultiplierConfig,
  MultiplierValueEngine,
  MultiplierValueStateSnapshot,
  SettlementMultiplierContext,
} from "../multipliers";
import { createMultiplierValueEngine } from "../multipliers";
import { createPayAnywhereEngine } from "../payanywhere";
import { createBoardFromSymbolGrid } from "../paylines";
import { createPaytableResolver, roundCurrency } from "../paytable";
import { createReelResolver } from "../reels";
import type {
  DeterministicGameRng,
  RngAlgorithmId,
  RngAlgorithmName,
  RngStateSnapshot,
  SeedInput,
} from "../rng";
import { DefaultRngFactory, createSeededRng, normalizeSeed } from "../rng";
import { createScatterEngine } from "../scatters";
import type { GameDefinition } from "../schema";
import { toGameConfig, assertValidGameDefinition } from "../schema";
import { createWaysEngine } from "../ways";

/* -------------------------------------------------------------------------- */
/* 1. B01 COMPATIBILITY MODEL & CORE IDENTIFIERS                              */
/* -------------------------------------------------------------------------- */

export type GameMathModelType = "Class II" | "Class III";

export type SimulationExecutionMode = "statistical" | "verification";

export type SimulationErrorPolicy = "failFast" | "collectAndContinue";

export type WinSourceKind =
  | "payline"
  | "ways"
  | "cluster"
  | "payAnywhere"
  | "scatter"
  | "featureValue";

export interface MathModel {
  readonly gameId: string;
  readonly evaluationMode: EngineEvaluationMode;
  readonly rtpTarget: number;
  readonly volatility: Volatility;
  readonly maxWinX: number;
  readonly hitFrequencyTarget: number;
  readonly betLevels: readonly number[];
  readonly totalReelStopCombinations: number;
  readonly modelType?: GameMathModelType;
}

export function deriveMathModel(
  config: GameConfig,
  modelType?: GameMathModelType,
): MathModel {
  const totalReelStopCombinations = config.reels.reduce(
    (product, reel) => product * Math.max(1, reel.stops.length),
    1,
  );

  return Object.freeze({
    gameId: config.gameId,
    evaluationMode: config.grid.evaluationMode,
    rtpTarget: config.math.rtpTarget,
    volatility: config.math.volatility,
    maxWinX: config.math.maxWinX,
    hitFrequencyTarget: config.math.hitFrequency,
    betLevels: config.math.betLevels,
    totalReelStopCombinations,
    ...(modelType !== undefined ? { modelType } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* 2. SIMULATION CONFIGURATION & SEED METADATA                                */
/* -------------------------------------------------------------------------- */

export interface SimulationMultiplierConfig {
  readonly tumbleMultiplier?: GeometricTumbleMultiplierConfig;
  readonly assignedValues?: readonly AssignedValueDefinition[];
  readonly collection?: CollectionDefinition;
}

export interface SimulationSeed {
  readonly seed: SeedInput;
  readonly canonicalSeed: string;
  readonly algorithmId: RngAlgorithmId;
  readonly initialSnapshot: RngStateSnapshot;
  readonly finalSnapshot: RngStateSnapshot;
  readonly totalDrawsConsumed: number;
}

export interface SimulationConfig {
  readonly runId?: string;
  readonly gameId?: string;
  readonly spinCount: number;
  readonly seed?: SeedInput;
  /** B01 alias for `seed`. */
  readonly baseSeed?: SeedInput;
  readonly rngAlgorithm?: RngAlgorithmName;
  readonly selectedMode?: "base" | "freeSpins" | "respin" | "holdAndWin" | "bonus";
  readonly modelType?: GameMathModelType;
  readonly initialBankroll?: number;
  readonly bet?: number;
  readonly selectedBetLevelIndex?: number;
  readonly activePaylineIds?: readonly PaylineId[];
  /**
   * Fixed-stop configuration:
   * - Single array of reel stop indexes applied to every spin (`[0, 0, 0, 0, 0]`)
   * - Or per-spin array of reel stop index arrays (`[[0, 0, 0, 0, 0], [1, 1, 1, 1, 1]]`)
   */
  readonly fixedStops?: readonly number[] | readonly (readonly number[])[];
  readonly batchSize?: number;
  readonly maxOperationsGuard?: number;
  readonly maxExecutionTimeMs?: number;
  readonly retainSpinTraces?: boolean;
  readonly retainBoardSnapshots?: boolean;
  readonly retainRawWinSamples?: boolean;
  readonly percentiles?: readonly number[];
  readonly winDistributionBuckets?: readonly { readonly label: string; readonly minMultipleInclusive: number; readonly maxMultipleExclusive: number | null }[];
  readonly maxFeatureStepsPerRound?: number;
  readonly mechanicOperations?: readonly import("./round-execution").MechanicOperation[];
  readonly mode?: SimulationExecutionMode;
  readonly errorPolicy?: SimulationErrorPolicy;
  readonly collectDiagnostics?: boolean;
  /** Optional B12 feature configuration for simulation runs with extended feature specs. */
  readonly featureConfig?: FeatureEngineConfiguration;
  /** Optional B13 tumble/cascade options for simulation runs with cascades enabled. */
  readonly tumbleConfig?: Omit<CascadeStepOptions, "rng">;
  /** Optional B13 max cascade steps per spin (default 25). */
  readonly maxCascadeStepsPerSpin?: number;
  /** Optional B14 multiplier & symbol value configuration. */
  readonly multiplierConfig?: SimulationMultiplierConfig;
  /** Optional B15 meter definitions. */
  readonly meters?: readonly MeterDefinition[];
  /** Optional B15 losing-spin condition and actions. */
  readonly losingSpinCondition?: FeatureCondition;
  readonly losingSpinActions?: ActionSequence;
}

/* -------------------------------------------------------------------------- */
/* 3. SPIN TRACE, REPLAY PACKAGE & ERROR RECORDS                              */
/* -------------------------------------------------------------------------- */

export interface SimulationReplayConfiguration {
  readonly featureConfig?: FeatureEngineConfiguration;
  readonly tumbleConfig?: Omit<CascadeStepOptions, "rng">;
  readonly multiplierConfig?: SimulationMultiplierConfig;
  readonly meters?: readonly MeterDefinition[];
  readonly losingSpinCondition?: FeatureCondition;
  readonly losingSpinActions?: ActionSequence;
  readonly maxCascadeStepsPerSpin?: number;
  readonly maxFeatureStepsPerRound?: number;
  readonly mechanicOperations?: readonly import("./round-execution").MechanicOperation[];
  readonly retainSpinTraces?: boolean;
  readonly retainBoardSnapshots?: boolean;
}
export interface MathSimulationEngineOptions { readonly monotonicNowMs?: () => number; }
export interface SpinReplayPackage {
  readonly gameId: string;
  readonly definitionRevision: string;
  readonly definitionHash: string;
  readonly modelType: GameMathModelType;
  readonly rngAlgorithmId: RngAlgorithmId;
  readonly rngSnapshotBeforeSpin: RngStateSnapshot;
  readonly spinIndex: number;
  readonly bet: number;
  readonly selectedMode: string;
  readonly activePaylineIds: readonly PaylineId[];
  readonly fixedStopIndexes?: readonly number[];
  readonly executionVersion?: 2;
  readonly executionConfiguration?: SimulationReplayConfiguration;
  readonly executionConfigurationHash?: string;
  readonly boardStateBeforeSpin?: import("../dynamics").BoardState;
  readonly stepKind?: "featureStep";
  readonly featureStateBeforeSpin?: FeatureRuntimeState;
  readonly multiplierSnapshotBeforeSpin?: MultiplierValueStateSnapshot;
  readonly logicSnapshotBeforeSpin?: LogicSnapshot;
}

export interface FeatureRoundContribution {
  readonly featureId: string; readonly triggerCount: number; readonly entryCount: number;
  readonly spinsPlayed: number; readonly retriggers: number; readonly upgrades: number; readonly award: number;
}
export interface SimulationSpin {
  readonly spinIndex: number;
  readonly roundId: string;
  readonly rngSnapshotBefore: RngStateSnapshot;
  readonly rngSnapshotAfter: RngStateSnapshot;
  readonly drawsConsumed: number;
  readonly reelStops: readonly number[];
  readonly wager: number;
  readonly win: number;
  readonly netResult: number;
  readonly winMultiplier: number;
  readonly isWinningSpin: boolean;
  readonly baseGameWin: number;
  readonly featureWin: number;
  readonly winBySource: Readonly<Record<WinSourceKind, number>>;
  readonly winningCombinationsCount: number;
  readonly paylineWinCount: number;
  readonly waysWinCount: number;
  readonly clusterWinCount: number;
  readonly payAnywhereWinCount: number;
  readonly scatterWinCount: number;
  readonly featureValueWinAmount: number;
  readonly cascadeCount: number;
  readonly cascadePayouts: readonly number[];
  readonly multiplierBefore: number;
  readonly multiplierAfter: number;
  readonly activeFeatureId: string | null;
  readonly triggeredFeatureIds: readonly string[];
  readonly featureSpinsPlayedInRound: number;
  readonly featureRetriggersInRound: number;
  readonly featureUpgradesInRound: number;
  readonly boardSnapshot?: readonly (readonly string[])[];
  readonly finalBoardSnapshot?: readonly (readonly string[])[];
  readonly meterValues?: Readonly<Record<string, number>>;
  readonly featureSteps?: readonly SimulationSpin[];
  readonly featureBreakdown?: readonly FeatureRoundContribution[];
  readonly uncappedWin?: number;
  readonly capTrimmed?: number;
  readonly replayPackage: SpinReplayPackage;
}

export interface SimulationErrorRecord {
  readonly spinIndex: number;
  readonly batchIndex: number;
  readonly errorCode: string;
  readonly message: string;
  readonly reproductionMetadata: SpinReplayPackage;
}

/* -------------------------------------------------------------------------- */
/* 4. MATHEMATICAL STATISTICS CONTRACTS                                       */
/* -------------------------------------------------------------------------- */

export interface RtpStats {
  readonly totalWager: number;
  readonly totalPayout: number;
  readonly netReturn: number;
  /** Ratio `totalPayout / totalWager` (e.g., `0.96`). */
  readonly rtp: number;
  /** Percentage `rtp * 100` (e.g., `96.0`). */
  readonly rtpPercentage: number;
  readonly averageWinPerSpin: number;
  readonly averageLossPerSpin: number;
  readonly baseGamePayout: number;
  readonly featurePayout: number;
  readonly baseGameRtpPercentage: number;
  readonly featureRtpPercentage: number;
}

export interface HitFrequencyStats {
  readonly totalSpins: number;
  readonly winningSpins: number;
  readonly losingSpins: number;
  /** Ratio `winningSpins / totalSpins` in `[0, 1]`. */
  readonly hitFrequency: number;
  /** Percentage `hitFrequency * 100` in `[0, 100]`. */
  readonly hitFrequencyPercentage: number;
  readonly hitCountBySource: Readonly<Record<WinSourceKind, number>>;
  readonly hitFrequencyBySource: Readonly<Record<WinSourceKind, number>>;
}

export interface MaxWinStats {
  readonly maxAbsoluteWin: number;
  readonly maxWinInBetMultiples: number;
  readonly spinIndexOfMaxWin: number | null;
  readonly featureIdAtMaxWin: string | null;
  readonly modeAtMaxWin: string | null;
  readonly configuredMaxWinCapX: number | null;
}

export interface WinDistributionBucket {
  readonly label: string;
  readonly minMultipleInclusive: number;
  readonly maxMultipleExclusive: number | null;
  readonly spinCount: number;
  readonly totalPayout: number;
  readonly shareOfSpins: number;
  readonly shareOfTotalPayout: number;
}

export interface WinDistribution {
  readonly minWin: number;
  readonly maxWin: number;
  readonly meanWin: number;
  readonly meanWinningSpinWin: number;
  readonly medianWin: number;
  readonly nonWinningSpinCount: number;
  readonly winningSpinCount: number;
  readonly percentiles: Readonly<Record<string, number>>;
  readonly percentilesInBetMultiples: Readonly<Record<string, number>>;
  readonly winningSpinDistributionBuckets: readonly WinDistributionBucket[];
}

export interface VolatilityStats {
  /** Population variance of normalized spin returns (`win / wager`). */
  readonly populationVarianceNormalizedReturn: number;
  /** Sample variance (Bessel-corrected `N - 1`) of normalized spin returns (`win / wager`). */
  readonly sampleVarianceNormalizedReturn: number;
  /** Population standard deviation of normalized spin returns (`win / wager`). */
  readonly standardDeviationNormalizedReturn: number;
  /** Sample standard deviation of normalized spin returns (`win / wager`). */
  readonly sampleStandardDeviationNormalizedReturn: number;
  /** Mean absolute deviation of normalized spin returns from the observed mean return. */
  readonly meanAbsoluteDeviationNormalizedReturn: number;
  /** Standard error of the observed RTP (`sampleStdDev / sqrt(N)`). */
  readonly rtpStandardError: number;
  /** 95% confidence interval half-width in RTP percentage points (`1.96 * rtpStandardError * 100`). */
  readonly rtpConfidenceInterval95PercentagePoints: number;
  readonly winSizeBucketsInBetMultiples: Readonly<Record<string, number>>;
  readonly percentilesNormalizedReturn: Readonly<Record<string, number>>;
}

export interface PerFeatureStats {
  readonly featureId: string;
  readonly triggerCount: number;
  readonly entryCount: number;
  readonly retriggerCount: number;
  readonly upgradeCount: number;
  readonly totalSpinsPlayed: number;
  readonly totalPayout: number;
  readonly averagePayout: number;
  readonly maxPayout: number;
  readonly averageDurationSpins: number;
}

export interface FeatureStatistics {
  readonly totalFeatureTriggers: number;
  readonly totalFeatureEntries: number;
  readonly featureEntryFrequency: number;
  readonly totalRetriggers: number;
  readonly totalUpgrades: number;
  readonly totalFeaturePayout: number;
  readonly averageFeaturePayout: number;
  readonly maxFeaturePayout: number;
  readonly featureWinContributionRatio: number;
  readonly featureWinContributionPercentage: number;
  readonly averageFeatureDurationSpins: number;
  readonly byFeatureId: Readonly<Record<string, PerFeatureStats>>;
}

export interface WinSourceStatEntry {
  readonly source: WinSourceKind;
  readonly hitSpins: number;
  readonly hitFrequency: number;
  readonly winningCombinationsCount: number;
  readonly totalPayout: number;
  readonly averageWinWhenHit: number;
  readonly maxSingleSpinWin: number;
  readonly contributionRatioToTotalPayout: number;
}

export interface WinSourceStatistics {
  readonly bySource: Readonly<Record<WinSourceKind, WinSourceStatEntry>>;
}

export interface CascadeStatistics {
  readonly spinsWithCascade: number;
  readonly cascadeTriggerFrequency: number;
  readonly totalTumbleCount: number;
  readonly averageTumblesPerTriggeringSpin: number;
  readonly maxCascadeDepth: number;
  readonly payoutByTumbleIndex: readonly number[];
  readonly maxMultiplierReached: number;
  readonly averageEndingMultiplierOnCascadeSpins: number;
}

export interface BankrollStats {
  readonly startingBalance: number;
  readonly totalWagered: number;
  readonly totalWon: number;
  readonly endingBalance: number;
  readonly peakBalance: number;
  readonly minBalance: number;
  readonly depletionEvents: number;
}

export interface SimulationStats {
  readonly rtp: RtpStats;
  readonly hitFrequency: HitFrequencyStats;
  readonly maxWin: MaxWinStats;
  readonly distribution: WinDistribution;
  readonly volatility: VolatilityStats;
  readonly features: FeatureStatistics;
  readonly winSources: WinSourceStatistics;
  readonly cascades: CascadeStatistics;
  readonly bankroll: BankrollStats;
}

/* -------------------------------------------------------------------------- */
/* 5. SIMULATION REPORT, RUN & B01 SIMULATION RESULT                          */
/* -------------------------------------------------------------------------- */

export interface SimulationReport {
  readonly runId: string;
  readonly gameId: string;
  readonly definitionRevision: string;
  readonly definitionHash: string;
  readonly modelType: GameMathModelType;
  readonly configurationSummary: {
    readonly spinCount: number;
    readonly bet: number;
    readonly selectedBetLevelIndex: number;
    readonly selectedMode: string;
    readonly batchSize: number;
    readonly batchCount: number;
    readonly mode: SimulationExecutionMode;
    readonly errorPolicy: SimulationErrorPolicy;
    readonly retainSpinTraces: boolean;
    readonly retainBoardSnapshots: boolean;
  };
  readonly seedMetadata: SimulationSeed;
  readonly spinCount: number;
  readonly totalWager: number;
  readonly totalPayout: number;
  readonly rtp: RtpStats;
  readonly winningSpins: number;
  readonly losingSpins: number;
  readonly hitFrequency: HitFrequencyStats;
  readonly averageWin: number;
  readonly maxWin: MaxWinStats;
  readonly distribution: WinDistribution;
  readonly volatility: VolatilityStats;
  readonly features: FeatureStatistics;
  readonly winSources: WinSourceStatistics;
  readonly cascades: CascadeStatistics;
  readonly bankroll: BankrollStats;
  readonly stats: SimulationStats;
  readonly errorCount: number;
  readonly errors: readonly SimulationErrorRecord[];
  readonly rawWinSamples?: readonly number[];
  readonly executionConfigurationHash?: string;
  readonly configurationFingerprint?: string;
  readonly diagnostics?: { readonly attemptedRounds: number; readonly completedRounds: number; readonly failedRounds: number; readonly parentDrawsConsumed: number };
  readonly traces: readonly SimulationSpin[];
  readonly sampleReplayPackage: SpinReplayPackage | null;
  readonly maxWinReplayPackage: SpinReplayPackage | null;
  readonly totalOperationsExecuted: number;
}

export interface SimulationRun {
  readonly runId: string;
  readonly config: SimulationConfig;
  readonly report: SimulationReport;
}

/**
 * Backward-compatible with B01 `SimulationResult` while exposing the complete
 * B16 `report` and `stats`.
 */
export interface SimulationResult {
  readonly gameId: string;
  readonly spinCount: number;
  readonly baseSeed: string;
  readonly totalWagered: number;
  readonly totalReturned: number;
  readonly observedRtp: number;
  readonly hitCount: number;
  readonly observedHitFrequency: number;
  readonly maxObservedWinX: number;
  readonly standardDeviation: number;
  readonly featureTriggerCounts: Readonly<Record<string, number>>;
  readonly report: SimulationReport;
  readonly stats: SimulationStats;
}

export interface SimulationRunner {
  runSimulation(
    config: GameConfig | GameDefinition | GameBlueprint,
    simulationConfig: SimulationConfig,
  ): SimulationResult;
}

/* -------------------------------------------------------------------------- */
/* 6. DETERMINISTIC FIXED-STOP VERIFICATION CONTRACTS                         */
/* -------------------------------------------------------------------------- */

export type VerificationDiffKind =
  | "reelStopMismatch"
  | "boardMismatch"
  | "symbolMismatch"
  | "winMismatch"
  | "payoutMismatch"
  | "featureStateMismatch"
  | "multiplierValueMismatch"
  | "meterLogicMismatch";

export interface VerificationDiffEntry {
  readonly kind: VerificationDiffKind;
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly message: string;
}

export interface VerificationCase {
  readonly caseId: string;
  readonly description?: string;
  readonly definitionRevision?: string;
  readonly definitionHash?: string;
  readonly engineVersion?: string;
  readonly tags?: readonly string[];
  readonly suiteIds?: readonly string[];
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly input?: RoundExecutionInput;
  readonly checks?: readonly StageExpectation[];
  readonly expectedEventSequence?: readonly ExecutionStage[];
  readonly seed?: SeedInput;
  readonly bet: number;
  readonly selectedMode?: "base" | "freeSpins" | "respin" | "holdAndWin" | "bonus";
  readonly activePaylineIds?: readonly PaylineId[];
  readonly fixedReelStops?: readonly number[];
  readonly fixedBoardGrid?: readonly (readonly string[])[];
  readonly featureConfig?: FeatureEngineConfiguration;
  readonly tumbleConfig?: Omit<CascadeStepOptions, "rng">;
  readonly multiplierConfig?: SimulationMultiplierConfig;
  readonly meters?: readonly MeterDefinition[];
  readonly losingSpinCondition?: FeatureCondition;
  readonly expected: {
    readonly reelStops?: readonly number[];
    readonly boardGrid?: readonly (readonly string[])[];
    readonly finalBoardGrid?: readonly (readonly string[])[];
    readonly totalWin?: number;
    readonly baseGameWin?: number;
    readonly featureWin?: number;
    readonly winningCombinationsCount?: number;
    readonly winBySource?: Partial<Readonly<Record<WinSourceKind, number>>>;
    readonly triggeredFeatureIds?: readonly string[];
    readonly activeFeatureId?: string | null;
    readonly remainingFeatureSpins?: number;
    readonly multiplierAfter?: number;
    readonly cascadeCount?: number;
    readonly meterValues?: Readonly<Record<string, number>>;
  };
}

export interface VerificationCaseResult {
  readonly caseId: string;
  readonly passed: boolean;
  readonly diffs: readonly VerificationDiffEntry[];
  readonly actualSpin: SimulationSpin;
}

/* -------------------------------------------------------------------------- */
/* 7. REPORT COMPARISON & RTP/VOLATILITY CALIBRATION EXTENSION POINTS         */
/* -------------------------------------------------------------------------- */

export interface MetricComparisonDelta {
  readonly metric: string;
  readonly baselineValue: number;
  readonly candidateValue: number;
  readonly absoluteDelta: number;
  readonly relativeDeltaPercentage: number | null;
  readonly exactMatch: boolean;
}

export interface SimulationComparisonResult {
  readonly baselineRunId: string;
  readonly candidateRunId: string;
  readonly exactMatch: boolean;
  readonly sameConfigurationAndSeed: boolean;
  readonly exactMismatches: readonly string[];
  readonly metricDeltas: {
    readonly totalSpins: MetricComparisonDelta;
    readonly totalWager: MetricComparisonDelta;
    readonly totalPayout: MetricComparisonDelta;
    readonly rtpPercentage: MetricComparisonDelta;
    readonly hitFrequencyPercentage: MetricComparisonDelta;
    readonly maxWinInBetMultiples: MetricComparisonDelta;
    readonly featureEntryFrequency: MetricComparisonDelta;
    readonly averageWinPerSpin: MetricComparisonDelta;
    readonly standardDeviationNormalizedReturn: MetricComparisonDelta;
    readonly sampleVarianceNormalizedReturn: MetricComparisonDelta;
    readonly medianWin: MetricComparisonDelta;
    readonly p90WinMultiple: MetricComparisonDelta;
    readonly p99WinMultiple: MetricComparisonDelta;
  };
}

export interface MathCalibrationConstraint {
  readonly parameterPath: string;
  readonly minAllowed: number;
  readonly maxAllowed: number;
  readonly locked?: boolean;
}

export interface MathTarget {
  readonly targetRtpPercentage: number;
  readonly allowedRtpBandPlusMinusPercentagePoints: number;
  readonly targetHitFrequencyPercentage?: number;
  readonly allowedHitFrequencyBandPlusMinusPercentagePoints?: number;
  readonly targetVolatility?: Volatility;
  readonly targetStandardDeviationRange?: readonly [number, number];
  readonly maxWinCapX?: number;
  readonly constraints?: readonly MathCalibrationConstraint[];
}

export interface MathCalibrationAdjustment {
  readonly parameterPath: string;
  readonly previousValue: number | string;
  readonly proposedValue: number | string;
  readonly applied: boolean;
  readonly rationale: string;
}

export interface MathCalibrationResult {
  readonly requestedTarget: MathTarget;
  readonly measuredReport: SimulationReport;
  readonly withinRtpBand: boolean;
  readonly rtpDeviationPercentagePoints: number;
  readonly withinHitFrequencyBand: boolean | null;
  readonly withinVolatilityRange: boolean | null;
  readonly adjustmentsProposed: readonly MathCalibrationAdjustment[];
  readonly adjustmentsApplied: readonly MathCalibrationAdjustment[];
}

/* -------------------------------------------------------------------------- */
/* 8. INTERNAL FIXED-POINT ACCUMULATORS & HISTOGRAM QUANTILES                 */
/* -------------------------------------------------------------------------- */

const CURRENCY_SCALE_NUM = 10_000;

/**
 * Converts a currency amount to exact integer micro-units (`1 unit = 0.0001`).
 * Using safe integer micro-units prevents IEEE-754 floating-point drift across
 * millions of simulated spins.
 */
function toMicroUnits(amount: number): number { return safeSimulationUnits(amount); }

function fromMicroUnits(units: number): number {
  return roundCurrency(units / CURRENCY_SCALE_NUM);
}

function extractBoardSymbolGrid(board: Board): readonly (readonly string[])[] {
  return Object.freeze(
    board.cells.map((col) =>
      Object.freeze(col.map((cell) => cell.symbol.symbolId)),
    ),
  );
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object" || Object.isFrozen(obj)) {
    return obj;
  }
  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    deepFreeze(record[key]);
  }
  return Object.freeze(obj);
}

/**
 * Deterministic hash of the normalized GameConfig so every report and replay
 * package records a reproducible revision fingerprint.
 */
export function computeGameConfigHash(config: GameConfig): string {
  return hashSimulationData(config);
}

const WIN_DISTRIBUTION_BUCKETS_SPEC: ReadonlyArray<{
  readonly label: string;
  readonly min: number;
  readonly max: number | null;
}> = Object.freeze([
  { label: "0x - 1x", min: 0, max: 1 },
  { label: "1x - 2x", min: 1, max: 2 },
  { label: "2x - 5x", min: 2, max: 5 },
  { label: "5x - 10x", min: 5, max: 10 },
  { label: "10x - 25x", min: 10, max: 25 },
  { label: "25x - 50x", min: 25, max: 50 },
  { label: "50x - 100x", min: 50, max: 100 },
  { label: "100x+", min: 100, max: null },
]);

/**
 * Memory-efficient exact-value frequency map (`Map<number, number>`) that tracks
 * distinct settled win amounts (in integer micro-units) and their exact counts.
 * Uses O(distinct payouts) memory regardless of whether `spinCount` is 1,000 or
 * 1,000,000, and computes exact percentiles, median, and mean absolute deviation
 * identically whether run in 1 batch or 100 batches.
 */
class DiscreteDistributionTracker {
  private readonly countsByWinMicroUnits = new Map<number, number>();
  private totalCount = 0;

  public record(winAmount: number): void {
    const units = toMicroUnits(winAmount);
    this.countsByWinMicroUnits.set(
      units,
      (this.countsByWinMicroUnits.get(units) ?? 0) + 1,
    );
    this.totalCount += 1;
  }

  public getSortedEntries(): Array<{ readonly units: number; readonly count: number }> {
    return Array.from(this.countsByWinMicroUnits.entries())
      .map(([units, count]) => ({ units, count }))
      .sort((a, b) => a.units - b.units);
  }

  public getPercentileWin(
    percentile: number,
    sortedEntries?: Array<{ readonly units: number; readonly count: number }>,
  ): number {
    if (this.totalCount === 0) {
      return 0;
    }
    const entries = sortedEntries ?? this.getSortedEntries();
    const clampedP = Math.max(0, Math.min(100, percentile));
    if (clampedP === 0) {
      return fromMicroUnits(entries[0]!.units);
    }
    if (clampedP === 100) {
      return fromMicroUnits(entries[entries.length - 1]!.units);
    }

    const targetRank = Math.ceil((clampedP / 100) * this.totalCount);
    let cumulative = 0;
    for (const entry of entries) {
      cumulative += entry.count;
      if (cumulative >= targetRank) {
        return fromMicroUnits(entry.units);
      }
    }
    return fromMicroUnits(entries[entries.length - 1]!.units);
  }

  public computeMeanAbsoluteDeviationNormalized(
    meanNormalizedReturn: number,
    bet: number,
    sortedEntries?: Array<{ readonly units: number; readonly count: number }>,
  ): number {
    if (this.totalCount === 0 || bet <= 0) {
      return 0;
    }
    const entries = sortedEntries ?? this.getSortedEntries();
    let weightedAbsDiffSum = 0;
    for (const entry of entries) {
      const winAmount = fromMicroUnits(entry.units);
      const normalized = winAmount / bet;
      weightedAbsDiffSum +=
        Math.abs(normalized - meanNormalizedReturn) * entry.count;
    }
    return roundCurrency(weightedAbsDiffSum / this.totalCount);
  }
}

/* -------------------------------------------------------------------------- */
/* 9. NORMALIZATION & VALIDATION HELPERS                                      */
/* -------------------------------------------------------------------------- */

function isCanonicalGameDefinition(
  candidate: unknown,
): candidate is GameDefinition {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const obj = candidate as Record<string, unknown>;
  return (
    typeof obj.metadata === "object" &&
    obj.metadata !== null &&
    typeof obj.canonicalReels === "object" &&
    obj.canonicalReels !== null &&
    typeof obj.winEvaluation === "object" &&
    obj.winEvaluation !== null
  );
}

export function resolveNormalizedGameConfig(
  source: GameConfig | GameDefinition | GameBlueprint,
): {
  readonly config: GameConfig;
  readonly revision: string;
  readonly modelType?: GameMathModelType;
  readonly winModes?: readonly EngineEvaluationMode[];
  readonly includeScatters?: boolean;
} {
  if (!source || typeof source !== "object") {
    throw new InvalidSimulationConfigurationError(
      "Simulation requires a valid GameConfig, GameDefinition, or GameBlueprint.",
    );
  }

  const rawSource = source as unknown as {
    readonly modelType?: GameMathModelType;
  };

  if (isGameConfig(source)) {
    return {
      config: source,
      revision: `${source.schemaVersion}:${source.engineVersion}`,
      modelType: rawSource.modelType,
    };
  }

  assertValidGameDefinition(source);
  const enabled = (source as Partial<GameDefinition>).winEvaluation?.enabledModes;
  const winModes = enabled?.filter((mode) => mode !== "scatters").map((mode) => mode === "fixedPaylines" ? "lines" : mode === "clusters" ? "cluster" : mode === "payAnywhere" ? "pay_anywhere" : mode) as readonly EngineEvaluationMode[] | undefined;
  const modeSettings = { winModes, includeScatters: enabled ? enabled.includes("scatters") : undefined };
  if (isCanonicalGameDefinition(source)) {
    const config = toGameConfig(source);
    return {
      config,
      revision: `${source.metadata.version}:${config.engineVersion}`,
      modelType: rawSource.modelType,
      ...modeSettings,
    };
  }

  const config = adaptBlueprintToGameConfig(source as GameBlueprint);
  return {
    config,
    revision: `${config.schemaVersion}:${config.engineVersion}`,
    modelType: rawSource.modelType,
    ...modeSettings,
  };
}

export function buildDefaultFeatureSpecsFromGameConfig(
  config: GameConfig,
): readonly FeatureSpec[] {
  const specs: FeatureSpec[] = [];
  for (const feat of config.features) {
    if (!feat.enabled) continue;
    if (feat.kind === "free_spins") {
      const initialSpins =
        typeof feat.params.spins === "number" && feat.params.spins > 0 ? feat.params.spins :
        typeof feat.params.awardsFreeSpins === "number" &&
        feat.params.awardsFreeSpins > 0
          ? feat.params.awardsFreeSpins
          : typeof feat.params.freeSpins === "number" &&
              feat.params.freeSpins > 0
            ? feat.params.freeSpins
            : 10;
      const startingMultiplier =
        typeof feat.params.multiplier === "number" &&
        feat.params.multiplier > 0
          ? feat.params.multiplier
          : 1;
      specs.push(
        Object.freeze({
          id: feat.id,
          name: feat.name,
          mode: "freeSpins" as const,
          startingMultiplier,
          triggers: Object.freeze([
            Object.freeze({
              id: `${feat.id}-trigger-1`,
              source: "symbolCount" as const,
              targetFeatureId: feat.id,
              symbolIds: feat.triggerSymbolIds,
              threshold: feat.triggerCount,
              awardedSpins: initialSpins,
              startingMultiplier,
            }),
          ]),
          freeSpins: Object.freeze({
            initialSpins,
            retriggerEnabled: Boolean(feat.params.retrigger ?? true),
            retriggerSymbolIds: feat.triggerSymbolIds,
            retriggerThreshold: feat.triggerCount,
            retriggerSpins: initialSpins,
            maxRetriggerBatches:
              typeof feat.params.maxRetriggerBatches === "number"
                ? feat.params.maxRetriggerBatches
                : 1,
          }),
        }),
      );
    }
  }
  return Object.freeze(specs);
}

/* -------------------------------------------------------------------------- */
/* 10. MATH SIMULATION ENGINE IMPLEMENTATION                                  */
/* -------------------------------------------------------------------------- */

export interface MathSimulationEngine extends SimulationRunner {
  run(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    simulationConfig: SimulationConfig,
  ): SimulationRun;

  runSimulation(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    simulationConfig: SimulationConfig,
  ): SimulationResult;

  verifyCase(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    verificationCase: VerificationCase,
  ): VerificationCaseResult;

  verifyCases(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    cases: readonly VerificationCase[],
  ): readonly VerificationCaseResult[];

  replaySpin(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    replayPackage: SpinReplayPackage,
    options?: SimulationReplayConfiguration,
  ): SimulationSpin;

  compareReports(
    baseline: SimulationReport,
    candidate: SimulationReport,
  ): SimulationComparisonResult;

  evaluateTargetCompliance(
    report: SimulationReport,
    target: MathTarget,
  ): MathCalibrationResult;
}

interface ActiveSimulationContext {
  readonly config: GameConfig;
  readonly definitionRevision: string;
  readonly definitionHash: string;
  readonly modelType: GameMathModelType;
  readonly bet: number;
  readonly selectedBetLevelIndex: number;
  readonly selectedMode: "base" | "freeSpins" | "respin" | "holdAndWin" | "bonus";
  readonly activePaylineIds: readonly PaylineId[];
  readonly reelResolver: ReturnType<typeof createReelResolver>;
  readonly boardBuilder: ReturnType<typeof createBoardBuilder>;
  readonly paytableResolver: ReturnType<typeof createPaytableResolver>;
  readonly winEvaluator: ReturnType<typeof createWinEvaluator>;
  readonly scatterEngine: ReturnType<typeof createScatterEngine>;
  readonly waysEngine: ReturnType<typeof createWaysEngine>;
  readonly clusterEngine: ReturnType<typeof createClusterEngine>;
  readonly payAnywhereEngine: ReturnType<typeof createPayAnywhereEngine>;
  readonly featureEngine: DeterministicFeatureEngine | null;
  readonly dynamicsEngine: DeterministicBoardDynamicsEngine | null;
  readonly multiplierEngine: MultiplierValueEngine | null;
  readonly logicEngine: FeatureLogicEngine | null;
  readonly simConfig: SimulationConfig;
  readonly winModes?: readonly EngineEvaluationMode[];
  readonly checkExecutionGuard?: (additionalOperations?: number) => void;
  readonly cascadeLimitIsPolicy?: boolean;
  readonly includeScatters?: boolean;
}

export class DeterministicMathSimulationEngine implements MathSimulationEngine {
  constructor(private readonly host: MathSimulationEngineOptions = {}) {}
  public runSimulation(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    simulationConfig: SimulationConfig,
  ): SimulationResult {
    const runResult = this.run(definitionOrConfig, simulationConfig);
    const { report } = runResult;

    const featureTriggerCounts: Record<string, number> = {};
    for (const [featureId, fStats] of Object.entries(report.features.byFeatureId)) {
      featureTriggerCounts[featureId] = fStats.triggerCount;
    }

    return deepFreeze({
      gameId: report.gameId,
      spinCount: report.spinCount,
      baseSeed: report.seedMetadata.canonicalSeed,
      totalWagered: report.totalWager,
      totalReturned: report.totalPayout,
      observedRtp: roundCurrency(report.rtp.rtp),
      hitCount: report.winningSpins,
      observedHitFrequency: roundCurrency(report.hitFrequency.hitFrequency),
      maxObservedWinX: report.maxWin.maxWinInBetMultiples,
      standardDeviation: report.volatility.standardDeviationNormalizedReturn,
      featureTriggerCounts: Object.freeze(featureTriggerCounts),
      report,
      stats: report.stats,
    });
  }

  public run(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    simulationConfig: SimulationConfig,
  ): SimulationRun {
    if (!simulationConfig || typeof simulationConfig !== "object") {
      throw new InvalidSimulationConfigurationError(
        "SimulationConfig must be a non-null object.",
      );
    }

    const {
      config,
      revision: definitionRevision,
      modelType: sourceModelType,
      winModes, includeScatters,
    } = resolveNormalizedGameConfig(definitionOrConfig);
    validateSimulationOptions(simulationConfig, typeof this.host.monotonicNowMs === "function");
    const bucketSpecs = simulationConfig.winDistributionBuckets?.map((b) => ({ label: b.label, min: b.minMultipleInclusive, max: b.maxMultipleExclusive })) ?? WIN_DISTRIBUTION_BUCKETS_SPEC;
    const executionConfiguration: SimulationReplayConfiguration = JSON.parse(JSON.stringify({ featureConfig: simulationConfig.featureConfig, tumbleConfig: simulationConfig.tumbleConfig, multiplierConfig: simulationConfig.multiplierConfig, meters: simulationConfig.meters, losingSpinCondition: simulationConfig.losingSpinCondition, losingSpinActions: simulationConfig.losingSpinActions, maxCascadeStepsPerSpin: simulationConfig.maxCascadeStepsPerSpin, maxFeatureStepsPerRound: simulationConfig.maxFeatureStepsPerRound, mechanicOperations: simulationConfig.mechanicOperations, retainSpinTraces: simulationConfig.retainSpinTraces, retainBoardSnapshots: simulationConfig.retainBoardSnapshots }));
    let lastClock = simulationConfig.maxExecutionTimeMs === undefined ? 0 : this.host.monotonicNowMs!();
    const startClock = lastClock;
    if (!Number.isFinite(lastClock)) throw new InvalidSimulationConfigurationError("Injected clock must return finite monotonic milliseconds.");
    const checkExecutionGuard = (additionalOperations = 0): void => {
      totalOperationsExecuted += additionalOperations;
      if (totalOperationsExecuted > maxOperationsGuard) throw new SimulationGuardExceededError("Simulation operation guard exceeded inside a round.", { totalOperationsExecuted, maxOperationsGuard });
      if (simulationConfig.maxExecutionTimeMs !== undefined) {
        const now = this.host.monotonicNowMs!();
        if (!Number.isFinite(now) || now < lastClock) throw new InvalidSimulationConfigurationError("Injected clock moved backwards or became non-finite.");
        lastClock = now;
        if (now - startClock >= simulationConfig.maxExecutionTimeMs) throw new SimulationGuardExceededError("Simulation elapsed-time guard exceeded.", { elapsedMs: now - startClock, limitMs: simulationConfig.maxExecutionTimeMs });
      }
    };

    if (
      simulationConfig.gameId !== undefined &&
      simulationConfig.gameId !== config.gameId
    ) {
      throw new InvalidSimulationConfigurationError(
        `SimulationConfig gameId "${simulationConfig.gameId}" does not match GameConfig gameId "${config.gameId}".`,
        {
          expectedGameId: config.gameId,
          actualGameId: simulationConfig.gameId,
        },
      );
    }

    if (
      typeof simulationConfig.spinCount !== "number" ||
      !Number.isInteger(simulationConfig.spinCount) ||
      simulationConfig.spinCount <= 0
    ) {
      throw new InvalidSimulationConfigurationError(
        `SimulationConfig.spinCount must be a positive integer, received ${String(simulationConfig.spinCount)}.`,
        { spinCount: simulationConfig.spinCount },
      );
    }

    const spinCount = simulationConfig.spinCount;
    const batchSize =
      simulationConfig.batchSize !== undefined
        ? simulationConfig.batchSize
        : spinCount;
    if (!Number.isInteger(batchSize) || batchSize <= 0) {
      throw new InvalidSimulationConfigurationError(
        `SimulationConfig.batchSize must be a positive integer, received ${String(batchSize)}.`,
        { batchSize },
      );
    }

    // Resolve bet amount and selectedBetLevelIndex
    let selectedBetLevelIndex = 0;
    let bet = config.math.defaultBet;
    if (simulationConfig.selectedBetLevelIndex !== undefined) {
      if (
        !Number.isInteger(simulationConfig.selectedBetLevelIndex) ||
        simulationConfig.selectedBetLevelIndex < 0 ||
        simulationConfig.selectedBetLevelIndex >= config.math.betLevels.length
      ) {
        throw new InvalidSimulationConfigurationError(
          `selectedBetLevelIndex ${simulationConfig.selectedBetLevelIndex} is out of bounds for betLevels (length ${config.math.betLevels.length}).`,
          { selectedBetLevelIndex: simulationConfig.selectedBetLevelIndex },
        );
      }
      selectedBetLevelIndex = simulationConfig.selectedBetLevelIndex;
      bet = config.math.betLevels[selectedBetLevelIndex]!;
    }
    if (simulationConfig.bet !== undefined) {
      if (
        typeof simulationConfig.bet !== "number" ||
        !Number.isFinite(simulationConfig.bet) ||
        simulationConfig.bet <= 0
      ) {
        throw new InvalidSimulationConfigurationError(
          `SimulationConfig.bet must be a positive finite number, received ${String(simulationConfig.bet)}.`,
          { bet: simulationConfig.bet },
        );
      }
      bet = roundCurrency(simulationConfig.bet);
      const foundIdx = config.math.betLevels.findIndex(
        (b) => Math.abs(b - bet) < 1e-6,
      );
      if (foundIdx >= 0) {
        selectedBetLevelIndex = foundIdx;
      }
    }

    const activePaylineIds: readonly PaylineId[] = simulationConfig.activePaylineIds
      ? Object.freeze([...simulationConfig.activePaylineIds])
      : Object.freeze(config.activePaylines.map((l) => l.id));

    if (
      (winModes ?? [config.grid.evaluationMode]).includes("lines") &&
      activePaylineIds.length === 0
    ) {
      throw new InvalidSimulationConfigurationError(
        "Line-evaluated simulation requires at least one active payline ID.",
      );
    }
    for (const lineId of activePaylineIds) {
      if (!config.paylinesById.has(lineId)) {
        throw new InvalidSimulationConfigurationError(
          `SimulationConfig references unknown payline ID "${lineId}".`,
          { paylineId: lineId },
        );
      }
    }

    const rawSeed =
      simulationConfig.seed !== undefined
        ? simulationConfig.seed
        : simulationConfig.baseSeed !== undefined
          ? simulationConfig.baseSeed
          : `sim-seed-${config.gameId}`;

    const rng = createSeededRng(rawSeed, {
      algorithm: simulationConfig.rngAlgorithm,
    });
    const initialRngSnapshot = rng.snapshot();

    const modelType: GameMathModelType =
      simulationConfig.modelType ?? sourceModelType ?? "Class III";
    if (modelType !== "Class II" && modelType !== "Class III") {
      throw new InvalidSimulationConfigurationError(
        `Unsupported modelType "${String(modelType)}". Expected "Class II" or "Class III".`,
        { modelType },
      );
    }

    const selectedMode = simulationConfig.selectedMode ?? "base";
    const mode: SimulationExecutionMode =
      simulationConfig.mode ?? "statistical";
    const errorPolicy: SimulationErrorPolicy =
      simulationConfig.errorPolicy ?? "failFast";
    const retainSpinTraces = Boolean(simulationConfig.retainSpinTraces);
    const retainBoardSnapshots = Boolean(simulationConfig.retainBoardSnapshots);
    const maxOperationsGuard =
      simulationConfig.maxOperationsGuard ?? spinCount * 500;

    if (maxOperationsGuard <= 0) {
      throw new InvalidSimulationConfigurationError(
        `maxOperationsGuard must be positive, received ${maxOperationsGuard}.`,
      );
    }

    if (!Number.isSafeInteger(toMicroUnits(bet) * spinCount)) throw new InvalidSimulationConfigurationError("Requested total wager exceeds safe fixed-point precision.");
    const definitionHash = computeGameConfigHash(config);
    const runId =
      simulationConfig.runId ??
      `sim-${config.gameId}-${initialRngSnapshot.canonicalSeed}-${spinCount}`;

    // Initialize real B04–B15 engines
    const reelResolver = createReelResolver();
    const boardBuilder = createBoardBuilder();
    const paytableResolver = createPaytableResolver();
    const winEvaluator = createWinEvaluator();
    const scatterEngine = createScatterEngine(config);
    const waysEngine = createWaysEngine(config);
    const clusterEngine = createClusterEngine({ config });
    const payAnywhereEngine = createPayAnywhereEngine({ config });

    if (!simulationConfig.featureConfig && config.features.some((f) => f.enabled && f.kind !== "free_spins")) throw new InvalidSimulationConfigurationError("Enabled non-free-spin features require an explicit B12 featureConfig; they cannot be silently ignored.");
    let defaultFeatures = buildDefaultFeatureSpecsFromGameConfig(config);
    if (isCanonicalGameDefinition(definitionOrConfig) && !simulationConfig.featureConfig) {
      const fs = definitionOrConfig.freeSpinsConfiguration;
      if (fs.enabled && (fs.multiplierMode === "progressive" || fs.reelConfigurationReference !== null)) throw new InvalidSimulationConfigurationError("Advanced canonical feature policy requires an authored B12 featureConfig.");
      if (fs.enabled && fs.initialSpins > fs.maxSpins) throw new InvalidSimulationConfigurationError("Canonical initial free spins exceed their maximum.");
      defaultFeatures = defaultFeatures.map((f) => f.id !== fs.featureId ? f : { ...f, startingMultiplier: fs.multiplierMode === "none" ? 1 : fs.baseMultiplier, triggers: f.triggers?.map((t) => ({ ...t, awardedSpins: fs.initialSpins, startingMultiplier: fs.multiplierMode === "none" ? 1 : fs.baseMultiplier })), freeSpins: { ...f.freeSpins!, initialSpins: fs.initialSpins, retriggerEnabled: fs.retriggers, retriggerSpins: fs.retriggerSpinsAwarded, maxRetriggerBatches: Math.max(0, Math.floor((fs.maxSpins - fs.initialSpins) / Math.max(1, fs.retriggerSpinsAwarded))) } });
    }
    const effectiveFeatureConfig: FeatureEngineConfiguration | null =
      simulationConfig.featureConfig ??
      (defaultFeatures.length > 0
        ? {
            baseReels: config.reels,
            visibleRows: config.grid.rows,
            features: defaultFeatures,
          }
        : null);

    const featureEngine = effectiveFeatureConfig
      ? createFeatureEngine(effectiveFeatureConfig)
      : null;

    const dynamicsEngine = simulationConfig.tumbleConfig || effectiveFeatureConfig || simulationConfig.mechanicOperations
      ? createBoardDynamicsEngine()
      : null;

    const multiplierEngine = simulationConfig.multiplierConfig || effectiveFeatureConfig || simulationConfig.mechanicOperations
      ? createMultiplierValueEngine()
      : null;

    const logicEngine =
      (simulationConfig.meters && simulationConfig.meters.length > 0) ||
      simulationConfig.losingSpinCondition || simulationConfig.losingSpinActions || simulationConfig.mechanicOperations
        ? createFeatureLogicEngine()
        : null;

    const ctx: ActiveSimulationContext = {
      config,
      definitionRevision,
      definitionHash,
      modelType,
      bet,
      selectedBetLevelIndex,
      selectedMode,
      activePaylineIds,
      reelResolver,
      boardBuilder,
      paytableResolver,
      winEvaluator,
      scatterEngine,
      waysEngine,
      clusterEngine,
      payAnywhereEngine,
      featureEngine,
      dynamicsEngine,
      multiplierEngine,
      logicEngine,
      simConfig: simulationConfig,
      checkExecutionGuard,
      winModes, includeScatters,
      cascadeLimitIsPolicy: simulationConfig.maxCascadeStepsPerSpin !== undefined,
    };

    // Runtime states across the simulation session
    let featureState: FeatureRuntimeState | undefined = featureEngine
      ? featureEngine.createInitialState()
      : undefined;
    let multiplierSnapshot: MultiplierValueStateSnapshot | undefined;
    if (multiplierEngine) {
      const initMult = multiplierEngine.createInitialState();
      multiplierSnapshot = multiplierEngine.snapshotState(
        initMult.multiplierState,
        initMult.valueState,
      );
    }
    let logicState: FeatureLogicState | undefined;
    if (logicEngine) {
      logicState = logicEngine.createInitialState();
      for (const mDef of simulationConfig.meters ?? []) {
        logicState = logicEngine.initializeMeter(logicState, mDef).nextState;
      }
    }

    // Incremental statistical accumulators (safe integer micro-units)
    let totalWagerUnits = 0;
    let totalPayoutUnits = 0;
    let baseGamePayoutUnits = 0;
    let featurePayoutUnits = 0;

    let completedSpins = 0;
    let winningSpins = 0;
    let losingSpins = 0;
    let totalLossOnLosingSpinsUnits = 0;

    let minWin: number | null = null;
    let maxAbsoluteWin = 0;
    let maxWinInBetMultiples = 0;
    let spinIndexOfMaxWin: number | null = null;
    let featureIdAtMaxWin: string | null = null;
    let modeAtMaxWin: string | null = null;
    let maxWinReplayPackage: SpinReplayPackage | null = null;
    let sampleReplayPackage: SpinReplayPackage | null = null;

    // Welford online variance on normalized return (x_i = win_i / wager_i)
    let welfordCount = 0;
    let welfordMean = 0;
    let welfordM2 = 0;

    // Discrete distribution tracker for exact median/percentiles/MAD without storing all spins
    const distributionTracker = new DiscreteDistributionTracker();
    const winningBucketCounts = new Array<number>(
      bucketSpecs.length,
    ).fill(0);
    const winningBucketPayoutUnits = new Array<number>(
      bucketSpecs.length,
    ).fill(0);

    // Win-source accumulators
    const allSources: readonly WinSourceKind[] = [
      "payline",
      "ways",
      "cluster",
      "payAnywhere",
      "scatter",
      "featureValue",
    ];
    const sourceHitSpins: Record<WinSourceKind, number> = {
      payline: 0,
      ways: 0,
      cluster: 0,
      payAnywhere: 0,
      scatter: 0,
      featureValue: 0,
    };
    const sourceComboCounts: Record<WinSourceKind, number> = {
      payline: 0,
      ways: 0,
      cluster: 0,
      payAnywhere: 0,
      scatter: 0,
      featureValue: 0,
    };
    const sourcePayoutUnits: Record<WinSourceKind, number> = {
      payline: 0,
      ways: 0,
      cluster: 0,
      payAnywhere: 0,
      scatter: 0,
      featureValue: 0,
    };
    const sourceMaxWin: Record<WinSourceKind, number> = {
      payline: 0,
      ways: 0,
      cluster: 0,
      payAnywhere: 0,
      scatter: 0,
      featureValue: 0,
    };

    // Feature accumulators
    let totalFeatureTriggers = 0;
    let totalFeatureEntries = 0;
    let totalRetriggers = 0;
    let totalUpgrades = 0;
    let maxFeaturePayout = 0;
    let totalFeatureDurationSpins = 0;
    const perFeatureAccum = new Map<
      string,
      {
        triggerCount: number;
        entryCount: number;
        retriggerCount: number;
        upgradeCount: number;
        totalSpinsPlayed: number;
        totalPayoutUnits: number;
        maxPayout: number;
      }
    >();

    // Cascade accumulators
    let spinsWithCascade = 0;
    let totalTumbleCount = 0;
    let maxCascadeDepth = 0;
    const payoutUnitsByTumbleIndex: number[] = [];
    let maxMultiplierReached = 1;
    let sumEndingMultiplierOnCascadeSpins = 0;

    // Bankroll accumulators
    const startingBalance = roundCurrency(
      simulationConfig.initialBankroll ?? bet * 1000,
    );
    let currentBalanceUnits = toMicroUnits(startingBalance);
    let peakBalanceUnits = currentBalanceUnits;
    let minBalanceUnits = currentBalanceUnits;
    let depletionEvents = 0;

    const traces: SimulationSpin[] = [];
    const rawWinSamples: number[] = [];
    let boardState: import("../dynamics").BoardState | undefined;
    const errors: SimulationErrorRecord[] = [];
    let totalOperationsExecuted = 0;

    const totalBatches = Math.ceil(spinCount / batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex += 1) {
      const startSpin = batchIndex * batchSize;
      const endSpin = Math.min(spinCount, startSpin + batchSize);

      for (let spinIndex = startSpin; spinIndex < endSpin; spinIndex += 1) {
        checkExecutionGuard(1);
        if (totalOperationsExecuted > maxOperationsGuard) {
          throw new SimulationGuardExceededError(
            `Simulation exceeded maxOperationsGuard (${maxOperationsGuard}) at spinIndex ${spinIndex}.`,
            { spinIndex, maxOperationsGuard, totalOperationsExecuted },
          );
        }

        const fixedStopForSpin = this.resolveFixedStopForSpin(
          simulationConfig.fixedStops,
          spinIndex,
        );

        const rngSnapshotBefore = rng.snapshot();
        const replayPackage: SpinReplayPackage = deepFreeze({
          gameId: config.gameId,
          definitionRevision,
          definitionHash,
          modelType,
          executionVersion: 2,
          executionConfiguration: JSON.parse(JSON.stringify({ ...executionConfiguration, featureConfig: effectiveFeatureConfig ?? undefined })) as SimulationReplayConfiguration,
          executionConfigurationHash: hashSimulationData({ ...executionConfiguration, featureConfig: effectiveFeatureConfig ?? undefined }),
          ...(boardState ? { boardStateBeforeSpin: boardState } : {}),
          rngAlgorithmId: rng.algorithm,
          rngSnapshotBeforeSpin: rngSnapshotBefore,
          spinIndex,
          bet,
          selectedMode,
          activePaylineIds,
          ...(fixedStopForSpin !== undefined
            ? { fixedStopIndexes: Object.freeze([...fixedStopForSpin]) }
            : {}),
          ...(featureState !== undefined
            ? { featureStateBeforeSpin: featureState }
            : {}),
          ...(multiplierSnapshot !== undefined
            ? { multiplierSnapshotBeforeSpin: multiplierSnapshot }
            : {}),
          ...(logicState !== undefined && logicEngine !== null
            ? { logicSnapshotBeforeSpin: logicEngine.snapshot(logicState) }
            : {}),
        });

        try {
          const spinOutcome = this.executeStatisticalRound(
            ctx,
            rng,
            spinIndex,
            fixedStopForSpin,
            undefined,
            featureState,
            multiplierSnapshot,
            logicState,
            replayPackage,
            retainBoardSnapshots,
            boardState,
          );
          checkExecutionGuard();
          const prospective = [
            [totalWagerUnits, toMicroUnits(spinOutcome.spin.wager)], [totalPayoutUnits, toMicroUnits(spinOutcome.spin.win)], [baseGamePayoutUnits, toMicroUnits(spinOutcome.spin.baseGameWin)], [featurePayoutUnits, toMicroUnits(spinOutcome.spin.featureWin)], [currentBalanceUnits, toMicroUnits(spinOutcome.spin.win) - toMicroUnits(spinOutcome.spin.wager)],
            ...SIMULATION_SOURCES.map((source) => [sourcePayoutUnits[source], toMicroUnits(spinOutcome.spin.winBySource[source])]),
          ];
          prospective.forEach(([a,b]) => safeSimulationSum(a!, b!));
          boardState = spinOutcome.boardState;
          featureState = spinOutcome.nextFeatureState;
          multiplierSnapshot = spinOutcome.nextMultiplierSnapshot;
          logicState = spinOutcome.nextLogicState;


          if (totalOperationsExecuted > maxOperationsGuard) {
            throw new SimulationGuardExceededError(
              `Simulation exceeded maxOperationsGuard (${maxOperationsGuard}) during spinIndex ${spinIndex}.`,
              { spinIndex, maxOperationsGuard, totalOperationsExecuted },
            );
          }

          const { spin } = spinOutcome;
          if (sampleReplayPackage === null) sampleReplayPackage = replayPackage;
          completedSpins += 1;
          if (simulationConfig.retainRawWinSamples) rawWinSamples.push(spin.win);

          const wagerUnits = toMicroUnits(spin.wager);
          const winUnits = toMicroUnits(spin.win);
          const baseWinUnits = toMicroUnits(spin.baseGameWin);
          const featWinUnits = toMicroUnits(spin.featureWin);

          totalWagerUnits += wagerUnits;
          totalPayoutUnits += winUnits;
          baseGamePayoutUnits += baseWinUnits;
          featurePayoutUnits += featWinUnits;

          // Bankroll update
          const balanceAfterDebit = currentBalanceUnits - wagerUnits;
          if (balanceAfterDebit + winUnits <= 0 && currentBalanceUnits > 0) {
            depletionEvents += 1;
          }
          currentBalanceUnits = balanceAfterDebit + winUnits;
          if (currentBalanceUnits > peakBalanceUnits) {
            peakBalanceUnits = currentBalanceUnits;
          }
          if (currentBalanceUnits < minBalanceUnits) {
            minBalanceUnits = currentBalanceUnits;
          }

          if (minWin === null || spin.win < minWin) {
            minWin = spin.win;
          }

          if (spin.isWinningSpin) {
            winningSpins += 1;
            const winMultiple = spin.wager > 0 ? spin.win / spin.wager : 0;
            for (let bIdx = 0; bIdx < bucketSpecs.length; bIdx += 1) {
              const bSpec = bucketSpecs[bIdx]!;
              if (
                winMultiple >= bSpec.min &&
                (bSpec.max === null || winMultiple < bSpec.max)
              ) {
                winningBucketCounts[bIdx]! += 1;
                winningBucketPayoutUnits[bIdx]! += winUnits;
                break;
              }
            }
          } else {
            losingSpins += 1;
            totalLossOnLosingSpinsUnits += wagerUnits;
          }

          if (spin.win > maxAbsoluteWin) {
            maxAbsoluteWin = spin.win;
            maxWinInBetMultiples = spin.winMultiplier;
            spinIndexOfMaxWin = spinIndex;
            featureIdAtMaxWin = spin.activeFeatureId;
            modeAtMaxWin =
              spin.activeFeatureId !== null ? "feature" : selectedMode;
            maxWinReplayPackage = spin.replayPackage;
          }

          // Welford update on normalized spin return (win / wager)
          const normalizedReturn = spin.wager > 0 ? spin.win / spin.wager : 0;
          welfordCount += 1;
          const delta = normalizedReturn - welfordMean;
          welfordMean += delta / welfordCount;
          const delta2 = normalizedReturn - welfordMean;
          welfordM2 += delta * delta2;

          // Discrete distribution update
          distributionTracker.record(spin.win);

          // Win-source updates
          for (const src of allSources) {
            const srcWin = spin.winBySource[src];
            if (srcWin > 0) {
              sourceHitSpins[src] += 1;
              sourcePayoutUnits[src] += toMicroUnits(srcWin);
              if (srcWin > sourceMaxWin[src]) {
                sourceMaxWin[src] = srcWin;
              }
            }
          }
          sourceComboCounts.payline += spin.paylineWinCount;
          sourceComboCounts.ways += spin.waysWinCount;
          sourceComboCounts.cluster += spin.clusterWinCount;
          sourceComboCounts.payAnywhere += spin.payAnywhereWinCount;
          sourceComboCounts.scatter += spin.scatterWinCount;
          if (spin.featureValueWinAmount > 0) {
            sourceComboCounts.featureValue += 1;
          }

          // Feature stats updates
          if (spin.triggeredFeatureIds.length > 0) {
            totalFeatureTriggers += spin.triggeredFeatureIds.length;
            totalFeatureEntries += 1;
            totalRetriggers += spin.featureRetriggersInRound;
            totalUpgrades += spin.featureUpgradesInRound;
            totalFeatureDurationSpins += spin.featureSpinsPlayedInRound;
            if (spin.featureWin > maxFeaturePayout) {
              maxFeaturePayout = spin.featureWin;
            }

            for (const contribution of spin.featureBreakdown ?? []) {
              const existing = perFeatureAccum.get(contribution.featureId) ?? { triggerCount: 0, entryCount: 0, retriggerCount: 0, upgradeCount: 0, totalSpinsPlayed: 0, totalPayoutUnits: 0, maxPayout: 0 };
              existing.triggerCount += contribution.triggerCount; existing.entryCount += contribution.entryCount;
              existing.retriggerCount += contribution.retriggers; existing.upgradeCount += contribution.upgrades;
              existing.totalSpinsPlayed += contribution.spinsPlayed; existing.totalPayoutUnits = safeSimulationSum(existing.totalPayoutUnits, toMicroUnits(contribution.award));
              existing.maxPayout = Math.max(existing.maxPayout, contribution.award);
              perFeatureAccum.set(contribution.featureId, existing);
            }
          }

          // Cascade stats updates
          if (spin.cascadeCount > 0) {
            spinsWithCascade += 1;
            totalTumbleCount += spin.cascadeCount;
            if (spin.cascadeCount > maxCascadeDepth) {
              maxCascadeDepth = spin.cascadeCount;
            }
            for (let tIdx = 0; tIdx < spin.cascadePayouts.length; tIdx += 1) {
              while (payoutUnitsByTumbleIndex.length <= tIdx) {
                payoutUnitsByTumbleIndex.push(0);
              }
              payoutUnitsByTumbleIndex[tIdx]! += toMicroUnits(
                spin.cascadePayouts[tIdx]!,
              );
            }
            sumEndingMultiplierOnCascadeSpins += spin.multiplierAfter;
          }
          if (spin.multiplierAfter > maxMultiplierReached) {
            maxMultiplierReached = spin.multiplierAfter;
          }

          if (retainSpinTraces) {
            traces.push(spin);
          }
        } catch (err: unknown) {
          if (err instanceof SimulationGuardExceededError) {
            throw err;
          }
          // Failed rounds are not settled and cannot leak feature/meter state.
          // Reserve exactly one deterministic parent draw for the failed attempt.
          rng.restore(rngSnapshotBefore); rng.nextUint32();
          const errorCode =
            err instanceof SlotEngineError ? err.code : "SIMULATION_EXECUTION_ERROR";
          const message =
            err instanceof Error ? err.message : String(err);

          const errorRecord: SimulationErrorRecord = deepFreeze({
            spinIndex,
            batchIndex,
            errorCode,
            message,
            reproductionMetadata: replayPackage,
          });
          errors.push(errorRecord);

          if (errorPolicy === "failFast") {
            throw new SimulationExecutionError(
              `Simulation failed at spinIndex ${spinIndex}: ${message}`,
              {
                spinIndex,
                batchIndex,
                originalErrorCode: errorCode,
                reproductionMetadata: replayPackage,
              },
            );
          }
        }
      }
    }

    const finalRngSnapshot = rng.snapshot();
    const totalDrawsConsumed =
      finalRngSnapshot.drawCount - initialRngSnapshot.drawCount;

    const seedMetadata: SimulationSeed = deepFreeze({
      seed: rawSeed instanceof Uint8Array ? Array.from(rawSeed) : JSON.parse(JSON.stringify(rawSeed)) as SeedInput,
      canonicalSeed: initialRngSnapshot.canonicalSeed,
      algorithmId: rng.algorithm,
      initialSnapshot: initialRngSnapshot,
      finalSnapshot: finalRngSnapshot,
      totalDrawsConsumed,
    });

    // Finalize RTP Stats
    const totalWager = fromMicroUnits(totalWagerUnits);
    const totalPayout = fromMicroUnits(totalPayoutUnits);
    const baseGamePayout = fromMicroUnits(baseGamePayoutUnits);
    const featurePayout = fromMicroUnits(featurePayoutUnits);
    const netReturn = roundCurrency(totalPayout - totalWager);
    const rtpRatio =
      totalWagerUnits > 0 ? totalPayoutUnits / totalWagerUnits : 0;
    const rtpPercentage = roundCurrency(rtpRatio * 100);
    const baseGameRtpPercentage =
      totalWagerUnits > 0
        ? roundCurrency((baseGamePayoutUnits / totalWagerUnits) * 100)
        : 0;
    const featureRtpPercentage =
      totalWagerUnits > 0
        ? roundCurrency((featurePayoutUnits / totalWagerUnits) * 100)
        : 0;
    const averageWinPerSpin =
      completedSpins > 0
        ? roundCurrency(totalPayout / completedSpins)
        : 0;
    const averageLossPerSpin =
      completedSpins > 0
        ? roundCurrency(
            fromMicroUnits(totalLossOnLosingSpinsUnits) / completedSpins,
          )
        : 0;

    const rtpStats: RtpStats = deepFreeze({
      totalWager,
      totalPayout,
      netReturn,
      rtp: roundCurrency(rtpRatio),
      rtpPercentage,
      averageWinPerSpin,
      averageLossPerSpin,
      baseGamePayout,
      featurePayout,
      baseGameRtpPercentage,
      featureRtpPercentage,
    });

    // Finalize Hit Frequency Stats
    const hitFrequencyRatio =
      completedSpins > 0 ? winningSpins / completedSpins : 0;
    const hitFrequencyBySource: Record<WinSourceKind, number> = {
      payline:
        completedSpins > 0
          ? roundCurrency(sourceHitSpins.payline / completedSpins)
          : 0,
      ways:
        completedSpins > 0
          ? roundCurrency(sourceHitSpins.ways / completedSpins)
          : 0,
      cluster:
        completedSpins > 0
          ? roundCurrency(sourceHitSpins.cluster / completedSpins)
          : 0,
      payAnywhere:
        completedSpins > 0
          ? roundCurrency(sourceHitSpins.payAnywhere / completedSpins)
          : 0,
      scatter:
        completedSpins > 0
          ? roundCurrency(sourceHitSpins.scatter / completedSpins)
          : 0,
      featureValue:
        completedSpins > 0
          ? roundCurrency(sourceHitSpins.featureValue / completedSpins)
          : 0,
    };

    const hitFrequencyStats: HitFrequencyStats = deepFreeze({
      totalSpins: completedSpins,
      winningSpins,
      losingSpins,
      hitFrequency: roundCurrency(hitFrequencyRatio),
      hitFrequencyPercentage: roundCurrency(hitFrequencyRatio * 100),
      hitCountBySource: Object.freeze({ ...sourceHitSpins }),
      hitFrequencyBySource: Object.freeze(hitFrequencyBySource),
    });

    // Finalize Max Win Stats
    const maxWinStats: MaxWinStats = deepFreeze({
      maxAbsoluteWin,
      maxWinInBetMultiples,
      spinIndexOfMaxWin,
      featureIdAtMaxWin,
      modeAtMaxWin,
      configuredMaxWinCapX: config.math.maxWinX ?? null,
    });

    // Finalize Win Distribution & Volatility Stats
    const sortedDistributionEntries = distributionTracker.getSortedEntries();
    const requestedPercentiles = simulationConfig.percentiles ?? [
      50, 75, 90, 95, 99,
    ];
    const percentilesMap: Record<string, number> = {};
    const percentilesInBetMultiples: Record<string, number> = {};
    for (const p of requestedPercentiles) {
      const key = `p${p}`;
      const pWin = distributionTracker.getPercentileWin(
        p,
        sortedDistributionEntries,
      );
      percentilesMap[key] = pWin;
      percentilesInBetMultiples[key] =
        bet > 0 ? roundCurrency(pWin / bet) : 0;
    }

    const medianWin =
      percentilesMap.p50 ??
      distributionTracker.getPercentileWin(50, sortedDistributionEntries);
    const meanWinningSpinWin =
      winningSpins > 0 ? roundCurrency(totalPayout / winningSpins) : 0;

    const distributionBuckets: WinDistributionBucket[] =
      bucketSpecs.map((bSpec, idx) => {
        const count = winningBucketCounts[idx]!;
        const bucketPayout = fromMicroUnits(winningBucketPayoutUnits[idx]!);
        return Object.freeze({
          label: bSpec.label,
          minMultipleInclusive: bSpec.min,
          maxMultipleExclusive: bSpec.max,
          spinCount: count,
          totalPayout: bucketPayout,
          shareOfSpins:
            completedSpins > 0 ? roundCurrency(count / completedSpins) : 0,
          shareOfTotalPayout:
            totalPayoutUnits > 0
              ? roundCurrency(
                  winningBucketPayoutUnits[idx]! / totalPayoutUnits,
                )
              : 0,
        });
      });

    const distributionStats: WinDistribution = deepFreeze({
      minWin: minWin ?? 0,
      maxWin: maxAbsoluteWin,
      meanWin: averageWinPerSpin,
      meanWinningSpinWin,
      medianWin,
      nonWinningSpinCount: losingSpins,
      winningSpinCount: winningSpins,
      percentiles: Object.freeze(percentilesMap),
      percentilesInBetMultiples: Object.freeze(percentilesInBetMultiples),
      winningSpinDistributionBuckets: Object.freeze(distributionBuckets),
    });

    const popVariance = welfordCount > 0 ? welfordM2 / welfordCount : 0;
    const sampleVariance =
      welfordCount > 1 ? welfordM2 / (welfordCount - 1) : popVariance;
    const popStdDev = Math.sqrt(Math.max(0, popVariance));
    const sampleStdDev = Math.sqrt(Math.max(0, sampleVariance));
    const madNormalized =
      distributionTracker.computeMeanAbsoluteDeviationNormalized(
        welfordMean,
        bet,
        sortedDistributionEntries,
      );
    const rtpStdError =
      welfordCount > 0 ? sampleStdDev / Math.sqrt(welfordCount) : 0;
    const rtpCi95 = 1.96 * rtpStdError * 100;

    const winSizeBucketsInBetMultiples: Record<string, number> = {
      "0x (No Win)": losingSpins,
    };
    for (let idx = 0; idx < bucketSpecs.length; idx += 1) {
      winSizeBucketsInBetMultiples[bucketSpecs[idx]!.label] =
        winningBucketCounts[idx]!;
    }

    const volatilityStats: VolatilityStats = deepFreeze({
      populationVarianceNormalizedReturn: roundCurrency(popVariance),
      sampleVarianceNormalizedReturn: roundCurrency(sampleVariance),
      standardDeviationNormalizedReturn: roundCurrency(popStdDev),
      sampleStandardDeviationNormalizedReturn: roundCurrency(sampleStdDev),
      meanAbsoluteDeviationNormalizedReturn: madNormalized,
      rtpStandardError: roundCurrency(rtpStdError),
      rtpConfidenceInterval95PercentagePoints: roundCurrency(rtpCi95),
      winSizeBucketsInBetMultiples: Object.freeze(winSizeBucketsInBetMultiples),
      percentilesNormalizedReturn: Object.freeze({ ...percentilesInBetMultiples }),
    });

    // Finalize Feature Statistics
    const byFeatureId: Record<string, PerFeatureStats> = {};
    for (const [fId, fAcc] of perFeatureAccum.entries()) {
      const fTotalPayout = fromMicroUnits(fAcc.totalPayoutUnits);
      byFeatureId[fId] = Object.freeze({
        featureId: fId,
        triggerCount: fAcc.triggerCount,
        entryCount: fAcc.entryCount,
        retriggerCount: fAcc.retriggerCount,
        upgradeCount: fAcc.upgradeCount,
        totalSpinsPlayed: fAcc.totalSpinsPlayed,
        totalPayout: fTotalPayout,
        averagePayout:
          fAcc.entryCount > 0
            ? roundCurrency(fTotalPayout / fAcc.entryCount)
            : 0,
        maxPayout: fAcc.maxPayout,
        averageDurationSpins:
          fAcc.entryCount > 0
            ? roundCurrency(fAcc.totalSpinsPlayed / fAcc.entryCount)
            : 0,
      });
    }

    const featureContributionRatio =
      totalPayoutUnits > 0 ? featurePayoutUnits / totalPayoutUnits : 0;

    const featureStats: FeatureStatistics = deepFreeze({
      totalFeatureTriggers,
      totalFeatureEntries,
      featureEntryFrequency:
        completedSpins > 0
          ? roundCurrency(totalFeatureEntries / completedSpins)
          : 0,
      totalRetriggers,
      totalUpgrades,
      totalFeaturePayout: featurePayout,
      averageFeaturePayout:
        totalFeatureEntries > 0
          ? roundCurrency(featurePayout / totalFeatureEntries)
          : 0,
      maxFeaturePayout,
      featureWinContributionRatio: roundCurrency(featureContributionRatio),
      featureWinContributionPercentage: roundCurrency(
        featureContributionRatio * 100,
      ),
      averageFeatureDurationSpins:
        totalFeatureEntries > 0
          ? roundCurrency(totalFeatureDurationSpins / totalFeatureEntries)
          : 0,
      byFeatureId: Object.freeze(byFeatureId),
    });

    // Finalize Win-Source Statistics
    const bySource: Record<WinSourceKind, WinSourceStatEntry> = {} as Record<
      WinSourceKind,
      WinSourceStatEntry
    >;
    for (const src of allSources) {
      const srcHits = sourceHitSpins[src];
      const srcPayout = fromMicroUnits(sourcePayoutUnits[src]);
      const contrib =
        totalPayoutUnits > 0 ? sourcePayoutUnits[src] / totalPayoutUnits : 0;
      bySource[src] = Object.freeze({
        source: src,
        hitSpins: srcHits,
        hitFrequency:
          completedSpins > 0 ? roundCurrency(srcHits / completedSpins) : 0,
        winningCombinationsCount: sourceComboCounts[src],
        totalPayout: srcPayout,
        averageWinWhenHit:
          srcHits > 0 ? roundCurrency(srcPayout / srcHits) : 0,
        maxSingleSpinWin: sourceMaxWin[src],
        contributionRatioToTotalPayout: roundCurrency(contrib),
      });
    }
    const winSourceStats: WinSourceStatistics = deepFreeze({
      bySource: Object.freeze(bySource),
    });

    // Finalize Cascade Statistics
    const cascadeStats: CascadeStatistics = deepFreeze({
      spinsWithCascade,
      cascadeTriggerFrequency:
        completedSpins > 0
          ? roundCurrency(spinsWithCascade / completedSpins)
          : 0,
      totalTumbleCount,
      averageTumblesPerTriggeringSpin:
        spinsWithCascade > 0
          ? roundCurrency(totalTumbleCount / spinsWithCascade)
          : 0,
      maxCascadeDepth,
      payoutByTumbleIndex: Object.freeze(
        payoutUnitsByTumbleIndex.map((u) => fromMicroUnits(u)),
      ),
      maxMultiplierReached,
      averageEndingMultiplierOnCascadeSpins:
        spinsWithCascade > 0
          ? roundCurrency(sumEndingMultiplierOnCascadeSpins / spinsWithCascade)
          : 1,
    });

    // Finalize Bankroll Statistics
    const bankrollStats: BankrollStats = deepFreeze({
      startingBalance,
      totalWagered: totalWager,
      totalWon: totalPayout,
      endingBalance: fromMicroUnits(currentBalanceUnits),
      peakBalance: fromMicroUnits(peakBalanceUnits),
      minBalance: fromMicroUnits(minBalanceUnits),
      depletionEvents,
    });

    const stats: SimulationStats = deepFreeze({
      rtp: rtpStats,
      hitFrequency: hitFrequencyStats,
      maxWin: maxWinStats,
      distribution: distributionStats,
      volatility: volatilityStats,
      features: featureStats,
      winSources: winSourceStats,
      cascades: cascadeStats,
      bankroll: bankrollStats,
    });

    const report: SimulationReport = deepFreeze({
      runId,
      gameId: config.gameId,
      definitionRevision,
      definitionHash,
      modelType,
      configurationSummary: Object.freeze({
        spinCount,
        bet,
        selectedBetLevelIndex,
        selectedMode,
        batchSize,
        batchCount: totalBatches,
        mode,
        errorPolicy,
        retainSpinTraces,
        retainBoardSnapshots,
      }),
      seedMetadata,
      spinCount: completedSpins,
      totalWager,
      totalPayout,
      rtp: rtpStats,
      winningSpins,
      losingSpins,
      hitFrequency: hitFrequencyStats,
      averageWin: averageWinPerSpin,
      maxWin: maxWinStats,
      distribution: distributionStats,
      volatility: volatilityStats,
      features: featureStats,
      winSources: winSourceStats,
      cascades: cascadeStats,
      bankroll: bankrollStats,
      stats,
      errorCount: errors.length,
      errors: Object.freeze(errors),
      traces: Object.freeze(traces),
      sampleReplayPackage,
      maxWinReplayPackage,
      totalOperationsExecuted,
      executionConfigurationHash: hashSimulationData({ ...executionConfiguration, featureConfig: effectiveFeatureConfig ?? undefined }),
      configurationFingerprint: hashSimulationData({ definitionHash, executionConfiguration: { ...executionConfiguration, featureConfig: effectiveFeatureConfig ?? undefined, retainSpinTraces: undefined, retainBoardSnapshots: undefined }, activePaylineIds, fixedStops: simulationConfig.fixedStops, bet, selectedMode, modelType, initialBankroll: simulationConfig.initialBankroll ?? bet * 1000 }),
      ...(simulationConfig.retainRawWinSamples ? { rawWinSamples: Object.freeze(rawWinSamples) } : {}),
      ...(simulationConfig.collectDiagnostics ? { diagnostics: { attemptedRounds: spinCount, completedRounds: completedSpins, failedRounds: errors.length, parentDrawsConsumed: totalDrawsConsumed } } : {}),
    });

    return deepFreeze({
      runId,
      config: JSON.parse(JSON.stringify({ ...simulationConfig, ...(rawSeed instanceof Uint8Array ? { seed: normalizeSeed(rawSeed), baseSeed: undefined } : {}) })) as SimulationConfig,
      report,
    });
  }

  /**
   * Executes a single deterministic verification case with fixed reel stops or
   * fixed board state and returns structured board-by-board and field-by-field diffs.
   */
  private executeConfiguredRound(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    verificationCase: VerificationCase,
    observation: RoundObservationOptions = {},
  ): ReturnType<DeterministicMathSimulationEngine["executeSingleRound"]> {
    if (!verificationCase || typeof verificationCase !== "object") {
      throw new InvalidVerificationCaseError(
        "VerificationCase must be a non-null object.",
      );
    }
    if (!verificationCase.caseId || verificationCase.caseId.trim().length === 0) {
      throw new InvalidVerificationCaseError(
        "VerificationCase.caseId must be a non-empty string.",
      );
    }
    if (
      typeof verificationCase.bet !== "number" ||
      !Number.isFinite(verificationCase.bet) ||
      verificationCase.bet <= 0
    ) {
      throw new InvalidVerificationCaseError(
        `VerificationCase "${verificationCase.caseId}" requires a positive bet.`,
        { caseId: verificationCase.caseId, bet: verificationCase.bet },
      );
    }

    const { config, revision: definitionRevision } =
      resolveNormalizedGameConfig(definitionOrConfig);
    const definitionHash = computeGameConfigHash(config);

    const rng = verificationCase.input?.rngState
      ? new DefaultRngFactory().restoreFromState(verificationCase.input.rngState)
      : createSeededRng(verificationCase.seed ?? `verify-${verificationCase.caseId}`, { algorithm: verificationCase.input?.rngAlgorithmId });
    const rngSnapshotBefore = rng.snapshot();

    const activePaylineIds: readonly PaylineId[] =
      verificationCase.activePaylineIds
        ? Object.freeze([...verificationCase.activePaylineIds])
        : Object.freeze(config.activePaylines.map((l) => l.id));

    const defaultFeatures = buildDefaultFeatureSpecsFromGameConfig(config);
    const effectiveFeatureConfig: FeatureEngineConfiguration | null =
      verificationCase.featureConfig ??
      (defaultFeatures.length > 0
        ? {
            baseReels: config.reels,
            visibleRows: config.grid.rows,
            features: defaultFeatures,
          }
        : null);

    const featureEngine = effectiveFeatureConfig
      ? createFeatureEngine(effectiveFeatureConfig)
      : null;
    const dynamicsEngine = verificationCase.tumbleConfig || verificationCase.input
      ? createBoardDynamicsEngine()
      : null;
    const multiplierEngine = verificationCase.multiplierConfig || verificationCase.input
      ? createMultiplierValueEngine()
      : null;
    const logicEngine =
      (verificationCase.meters && verificationCase.meters.length > 0) || verificationCase.input
        ? createFeatureLogicEngine()
        : null;

    const ctx: ActiveSimulationContext = {
      config,
      definitionRevision,
      definitionHash,
      modelType: "Class III",
      bet: roundCurrency(verificationCase.bet),
      selectedBetLevelIndex: 0,
      selectedMode: verificationCase.selectedMode ?? "base",
      activePaylineIds,
      reelResolver: createReelResolver(),
      boardBuilder: createBoardBuilder(),
      paytableResolver: createPaytableResolver(),
      winEvaluator: createWinEvaluator(),
      scatterEngine: createScatterEngine(config),
      waysEngine: createWaysEngine(config),
      clusterEngine: createClusterEngine({ config }),
      payAnywhereEngine: createPayAnywhereEngine({ config }),
      featureEngine,
      dynamicsEngine,
      multiplierEngine,
      logicEngine,
      winModes: verificationCase.input?.winModes,
      simConfig: {
        spinCount: 1,
        bet: verificationCase.bet,
        mode: "verification",
        retainBoardSnapshots: true,
        featureConfig: effectiveFeatureConfig ?? undefined,
        tumbleConfig: verificationCase.tumbleConfig,
        multiplierConfig: verificationCase.multiplierConfig,
        meters: verificationCase.meters,
        losingSpinCondition: verificationCase.losingSpinCondition,
        maxCascadeStepsPerSpin: verificationCase.input?.maxCascadeSteps,
      },
    };

    const replayPackage: SpinReplayPackage = deepFreeze({
      gameId: config.gameId,
      definitionRevision,
      definitionHash,
      modelType: "Class III",
      rngAlgorithmId: rng.snapshot().algorithm,
      rngSnapshotBeforeSpin: rngSnapshotBefore,
      spinIndex: verificationCase.input?.spinIndex ?? 0,
      bet: roundCurrency(verificationCase.bet),
      selectedMode: verificationCase.selectedMode ?? "base",
      activePaylineIds,
      ...(verificationCase.fixedReelStops !== undefined
        ? { fixedStopIndexes: Object.freeze([...verificationCase.fixedReelStops]) }
        : {}),
    });

    let initMultSnapshot: MultiplierValueStateSnapshot | undefined;
    if (multiplierEngine) {
      const mInit = multiplierEngine.createInitialState();
      initMultSnapshot = multiplierEngine.snapshotState(
        mInit.multiplierState,
        mInit.valueState,
      );
    }

    let initLogicState: FeatureLogicState | undefined;
    if (logicEngine) {
      initLogicState = logicEngine.createInitialState();
      for (const mDef of verificationCase.meters ?? []) {
        initLogicState = logicEngine.initializeMeter(
          initLogicState,
          mDef,
        ).nextState;
      }
    }

    const outcome = this.executeSingleRound(
      ctx,
      rng,
      verificationCase.input?.spinIndex ?? 0,
      verificationCase.fixedReelStops,
      verificationCase.fixedBoardGrid,
      verificationCase.input?.featureState ?? (featureEngine ? featureEngine.createInitialState() : undefined),
      verificationCase.input?.multiplierSnapshot ?? initMultSnapshot,
      verificationCase.input?.logicState ?? initLogicState,
      replayPackage,
      true,
      verificationCase.input,
      observation,
    );

    return outcome;
  }

  /** Production playable boundary: same B04–B15 executor, no expected-result checks. */
  public executePlayableStep(
    source: GameConfig | GameDefinition | GameBlueprint,
    request: Omit<VerificationCase, "expected" | "checks" | "expectedEventSequence">,
    observe: RoundObservationOptions = {},
  ): ReturnType<DeterministicMathSimulationEngine["executeSingleRound"]> {
    if (!request.input?.executionKind) throw new InvalidSimulationConfigurationError("Playable execution requires an explicit step boundary.");
    return this.executeConfiguredRound(source, { ...request, expected: {} }, observe);
  }

  public verifyCase(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    verificationCase: VerificationCase,
    observation: RoundObservationOptions = {},
  ): VerificationCaseResult {
    const outcome = this.executeConfiguredRound(definitionOrConfig, verificationCase, observation);
    const { spin } = outcome;
    const diffs: VerificationDiffEntry[] = [];
    const { expected } = verificationCase;

    // 1. Compare reel stops
    if (expected.reelStops !== undefined) {
      const stopsMatch =
        expected.reelStops.length === spin.reelStops.length &&
        expected.reelStops.every((s, idx) => s === spin.reelStops[idx]);
      if (!stopsMatch) {
        diffs.push(
          Object.freeze({
            kind: "reelStopMismatch",
            path: "reelStops",
            expected: expected.reelStops,
            actual: spin.reelStops,
            message: `Expected reelStops [${expected.reelStops.join(", ")}], received [${spin.reelStops.join(", ")}].`,
          }),
        );
      }
    }

    // 2. Compare initial board grid cell-by-cell
    if (expected.boardGrid !== undefined && spin.boardSnapshot) {
      this.compareBoardGrids(
        "boardGrid",
        expected.boardGrid,
        spin.boardSnapshot,
        diffs,
      );
    }

    // 3. Compare final board grid cell-by-cell (after cascades/dynamics)
    if (expected.finalBoardGrid !== undefined && spin.finalBoardSnapshot) {
      this.compareBoardGrids(
        "finalBoardGrid",
        expected.finalBoardGrid,
        spin.finalBoardSnapshot,
        diffs,
      );
    }

    // 4. Compare totalWin / baseGameWin / featureWin (payoutMismatch)
    if (
      expected.totalWin !== undefined &&
      toMicroUnits(expected.totalWin) !== toMicroUnits(spin.win)
    ) {
      diffs.push(
        Object.freeze({
          kind: "payoutMismatch",
          path: "totalWin",
          expected: expected.totalWin,
          actual: spin.win,
          message: `Expected totalWin ${expected.totalWin}, received ${spin.win}.`,
        }),
      );
    }
    if (
      expected.baseGameWin !== undefined &&
      toMicroUnits(expected.baseGameWin) !== toMicroUnits(spin.baseGameWin)
    ) {
      diffs.push(
        Object.freeze({
          kind: "payoutMismatch",
          path: "baseGameWin",
          expected: expected.baseGameWin,
          actual: spin.baseGameWin,
          message: `Expected baseGameWin ${expected.baseGameWin}, received ${spin.baseGameWin}.`,
        }),
      );
    }
    if (
      expected.featureWin !== undefined &&
      toMicroUnits(expected.featureWin) !== toMicroUnits(spin.featureWin)
    ) {
      diffs.push(
        Object.freeze({
          kind: "payoutMismatch",
          path: "featureWin",
          expected: expected.featureWin,
          actual: spin.featureWin,
          message: `Expected featureWin ${expected.featureWin}, received ${spin.featureWin}.`,
        }),
      );
    }

    // 5. Compare winningCombinationsCount and winBySource (winMismatch)
    if (
      expected.winningCombinationsCount !== undefined &&
      expected.winningCombinationsCount !== spin.winningCombinationsCount
    ) {
      diffs.push(
        Object.freeze({
          kind: "winMismatch",
          path: "winningCombinationsCount",
          expected: expected.winningCombinationsCount,
          actual: spin.winningCombinationsCount,
          message: `Expected winningCombinationsCount ${expected.winningCombinationsCount}, received ${spin.winningCombinationsCount}.`,
        }),
      );
    }
    if (expected.winBySource !== undefined) {
      for (const [srcKey, expVal] of Object.entries(expected.winBySource)) {
        if (expVal === undefined) continue;
        const actualVal = spin.winBySource[srcKey as WinSourceKind] ?? 0;
        if (toMicroUnits(expVal) !== toMicroUnits(actualVal)) {
          diffs.push(
            Object.freeze({
              kind: "winMismatch",
              path: `winBySource.${srcKey}`,
              expected: expVal,
              actual: actualVal,
              message: `Expected winBySource.${srcKey} = ${expVal}, received ${actualVal}.`,
            }),
          );
        }
      }
    }

    // 6. Compare feature state (featureStateMismatch)
    if (expected.triggeredFeatureIds !== undefined) {
      const trigMatch =
        expected.triggeredFeatureIds.length ===
          spin.triggeredFeatureIds.length &&
        expected.triggeredFeatureIds.every(
          (id, idx) => id === spin.triggeredFeatureIds[idx],
        );
      if (!trigMatch) {
        diffs.push(
          Object.freeze({
            kind: "featureStateMismatch",
            path: "triggeredFeatureIds",
            expected: expected.triggeredFeatureIds,
            actual: spin.triggeredFeatureIds,
            message: `Expected triggeredFeatureIds [${expected.triggeredFeatureIds.join(", ")}], received [${spin.triggeredFeatureIds.join(", ")}].`,
          }),
        );
      }
    }
    if (
      expected.activeFeatureId !== undefined &&
      expected.activeFeatureId !== spin.activeFeatureId
    ) {
      diffs.push(
        Object.freeze({
          kind: "featureStateMismatch",
          path: "activeFeatureId",
          expected: expected.activeFeatureId,
          actual: spin.activeFeatureId,
          message: `Expected activeFeatureId ${String(expected.activeFeatureId)}, received ${String(spin.activeFeatureId)}.`,
        }),
      );
    }
    if (
      expected.remainingFeatureSpins !== undefined &&
      outcome.nextFeatureState &&
      expected.remainingFeatureSpins !== outcome.nextFeatureState.remainingSpins
    ) {
      diffs.push(
        Object.freeze({
          kind: "featureStateMismatch",
          path: "remainingFeatureSpins",
          expected: expected.remainingFeatureSpins,
          actual: outcome.nextFeatureState.remainingSpins,
          message: `Expected remainingFeatureSpins ${expected.remainingFeatureSpins}, received ${outcome.nextFeatureState.remainingSpins}.`,
        }),
      );
    }

    // 7. Compare multiplier / cascade state (multiplierValueMismatch)
    if (
      expected.multiplierAfter !== undefined &&
      Math.abs(expected.multiplierAfter - spin.multiplierAfter) > 1e-6
    ) {
      diffs.push(
        Object.freeze({
          kind: "multiplierValueMismatch",
          path: "multiplierAfter",
          expected: expected.multiplierAfter,
          actual: spin.multiplierAfter,
          message: `Expected multiplierAfter ${expected.multiplierAfter}, received ${spin.multiplierAfter}.`,
        }),
      );
    }
    if (
      expected.cascadeCount !== undefined &&
      expected.cascadeCount !== spin.cascadeCount
    ) {
      diffs.push(
        Object.freeze({
          kind: "multiplierValueMismatch",
          path: "cascadeCount",
          expected: expected.cascadeCount,
          actual: spin.cascadeCount,
          message: `Expected cascadeCount ${expected.cascadeCount}, received ${spin.cascadeCount}.`,
        }),
      );
    }

    // 8. Compare meter / logic state (meterLogicMismatch)
    if (expected.meterValues !== undefined) {
      const actualMeters = spin.meterValues ?? {};
      for (const [mId, expVal] of Object.entries(expected.meterValues)) {
        const actVal = actualMeters[mId];
        if (actVal !== expVal) {
          diffs.push(
            Object.freeze({
              kind: "meterLogicMismatch",
              path: `meterValues.${mId}`,
              expected: expVal,
              actual: actVal,
              message: `Expected meter "${mId}" = ${expVal}, received ${String(actVal)}.`,
            }),
          );
        }
      }
    }

    return deepFreeze({
      caseId: verificationCase.caseId,
      passed: diffs.length === 0,
      diffs: Object.freeze(diffs),
      actualSpin: spin,
    });
  }

  public verifyCases(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    cases: readonly VerificationCase[],
  ): readonly VerificationCaseResult[] {
    if (!Array.isArray(cases)) {
      throw new InvalidVerificationCaseError("cases must be an array.");
    }
    return deepFreeze(
      cases.map((c) => this.verifyCase(definitionOrConfig, c)),
    );
  }

  /**
   * Replays an individual simulated spin from its recorded `SpinReplayPackage`.
   */
  public replaySpin(source: GameConfig | GameDefinition | GameBlueprint, replayPackage: SpinReplayPackage, options: SimulationReplayConfiguration = {}): SimulationSpin {
    try { return this.replaySpinInternal(source, JSON.parse(JSON.stringify(replayPackage)) as SpinReplayPackage, JSON.parse(JSON.stringify(options)) as SimulationReplayConfiguration); }
    catch (cause) { if (cause instanceof SimulationReplayError) throw cause; throw new SimulationReplayError("Replay could not be executed with the recorded inputs.", { cause: cause instanceof SlotEngineError ? cause.toJSON() : String(cause) }); }
  }

  private replaySpinInternal(
    definitionOrConfig: GameConfig | GameDefinition | GameBlueprint,
    replayPackage: SpinReplayPackage,
    options: SimulationReplayConfiguration = {},
  ): SimulationSpin {
    if (!replayPackage || typeof replayPackage !== "object") {
      throw new SimulationReplayError(
        "SpinReplayPackage must be a non-null object.",
      );
    }

    const { config, revision: definitionRevision, winModes, includeScatters } =
      resolveNormalizedGameConfig(definitionOrConfig);
    const definitionHash = computeGameConfigHash(config);

    if (replayPackage.gameId !== config.gameId) {
      throw new SimulationReplayError(
        `Replay package gameId "${replayPackage.gameId}" does not match GameConfig gameId "${config.gameId}".`,
        {
          expectedGameId: config.gameId,
          actualGameId: replayPackage.gameId,
        },
      );
    }
    if (replayPackage.definitionHash !== definitionHash) {
      throw new SimulationReplayError(
        `Replay package definitionHash "${replayPackage.definitionHash}" does not match current GameConfig hash "${definitionHash}".`,
        {
          expectedHash: definitionHash,
          actualHash: replayPackage.definitionHash,
        },
      );
    }

    if (replayPackage.definitionRevision !== definitionRevision || replayPackage.rngAlgorithmId !== replayPackage.rngSnapshotBeforeSpin?.algorithm || !Number.isSafeInteger(replayPackage.spinIndex) || replayPackage.spinIndex < 0 || !Number.isFinite(replayPackage.bet) || replayPackage.bet <= 0) throw new SimulationReplayError("Invalid replay identity, revision, algorithm or wager.");
    if (replayPackage.executionVersion !== undefined && replayPackage.executionVersion !== 2) throw new SimulationReplayError("Unsupported simulation replay execution version.");
    if (!Array.isArray(replayPackage.activePaylineIds) || new Set(replayPackage.activePaylineIds).size !== replayPackage.activePaylineIds.length) throw new SimulationReplayError("Invalid replay payline selection.");
    const replayOptions = replayPackage.executionConfiguration ?? options;
    const retainReplayBoards = replayPackage.executionVersion === 2 ? Boolean(replayOptions.retainBoardSnapshots) : replayOptions.retainBoardSnapshots ?? true;
    if (replayPackage.executionConfiguration && replayPackage.executionConfigurationHash !== hashSimulationData(replayOptions)) throw new SimulationReplayError("Replay execution configuration fingerprint changed.");
    for (const key of Object.keys(options) as (keyof SimulationReplayConfiguration)[]) if (replayPackage.executionConfiguration && canonicalSimulationData(options[key]) !== canonicalSimulationData(replayOptions[key])) throw new SimulationReplayError("Caller replay settings conflict with the recorded execution configuration.", { key });
    for (const id of replayPackage.activePaylineIds) if (!config.paylinesById.has(id)) throw new SimulationReplayError("Replay contains an unknown active payline.", { id });
    const rng = new DefaultRngFactory().restoreFromState(
      replayPackage.rngSnapshotBeforeSpin,
    );

    const defaultFeatures = buildDefaultFeatureSpecsFromGameConfig(config);
    const effectiveFeatureConfig: FeatureEngineConfiguration | null =
      replayOptions.featureConfig ??
      (defaultFeatures.length > 0
        ? {
            baseReels: config.reels,
            visibleRows: config.grid.rows,
            features: defaultFeatures,
          }
        : null);

    const featureEngine = effectiveFeatureConfig
      ? createFeatureEngine(effectiveFeatureConfig)
      : null;
    const dynamicsEngine = replayOptions.tumbleConfig || effectiveFeatureConfig || replayOptions.mechanicOperations
      ? createBoardDynamicsEngine()
      : null;
    const multiplierEngine = replayOptions.multiplierConfig || effectiveFeatureConfig || replayOptions.mechanicOperations
      ? createMultiplierValueEngine()
      : null;
    const logicEngine =
      (replayOptions.meters && replayOptions.meters.length > 0) || replayOptions.losingSpinCondition || replayOptions.losingSpinActions || replayOptions.mechanicOperations || replayPackage.logicSnapshotBeforeSpin
        ? createFeatureLogicEngine()
        : null;

    const ctx: ActiveSimulationContext = {
      config,
      definitionRevision,
      definitionHash,
      modelType: replayPackage.modelType,
      bet: replayPackage.bet,
      selectedBetLevelIndex: 0,
      selectedMode: replayPackage.selectedMode as
        | "base"
        | "freeSpins"
        | "respin"
        | "holdAndWin"
        | "bonus",
      activePaylineIds: replayPackage.activePaylineIds,
      reelResolver: createReelResolver(),
      boardBuilder: createBoardBuilder(),
      paytableResolver: createPaytableResolver(),
      winEvaluator: createWinEvaluator(),
      scatterEngine: createScatterEngine(config),
      waysEngine: createWaysEngine(config),
      clusterEngine: createClusterEngine({ config }),
      payAnywhereEngine: createPayAnywhereEngine({ config }),
      featureEngine,
      dynamicsEngine,
      multiplierEngine,
      logicEngine,
      winModes, includeScatters,
      cascadeLimitIsPolicy: replayOptions.maxCascadeStepsPerSpin !== undefined,
      simConfig: {
        spinCount: 1,
        bet: replayPackage.bet,
        ...replayOptions,
        retainBoardSnapshots: retainReplayBoards,
        featureConfig: replayOptions.featureConfig,
        tumbleConfig: replayOptions.tumbleConfig,
        multiplierConfig: replayOptions.multiplierConfig,
        meters: replayOptions.meters,
      },
    };

    let restoredLogicState: FeatureLogicState | undefined;
    if (logicEngine) {
      if (replayPackage.logicSnapshotBeforeSpin) {
        restoredLogicState = logicEngine.restore(
          replayPackage.logicSnapshotBeforeSpin,
        );
      } else {
        restoredLogicState = logicEngine.createInitialState();
        for (const mDef of replayOptions.meters ?? []) {
          restoredLogicState = logicEngine.initializeMeter(
            restoredLogicState,
            mDef,
          ).nextState;
        }
      }
    }

    let initMultSnapshot = replayPackage.multiplierSnapshotBeforeSpin;
    if (!initMultSnapshot && multiplierEngine) {
      const mInit = multiplierEngine.createInitialState();
      initMultSnapshot = multiplierEngine.snapshotState(
        mInit.multiplierState,
        mInit.valueState,
      );
    }

    const outcome = replayPackage.executionVersion === 2 && replayPackage.stepKind !== "featureStep" ? this.executeStatisticalRound(
      ctx, rng, replayPackage.spinIndex, replayPackage.fixedStopIndexes, undefined,
      replayPackage.featureStateBeforeSpin ?? featureEngine?.createInitialState(), initMultSnapshot, restoredLogicState, replayPackage,
      retainReplayBoards, replayPackage.boardStateBeforeSpin,
    ) : this.executeSingleRound(
      ctx,
      rng,
      replayPackage.spinIndex,
      replayPackage.fixedStopIndexes,
      undefined,
      replayPackage.featureStateBeforeSpin ??
        (featureEngine ? featureEngine.createInitialState() : undefined),
      initMultSnapshot,
      restoredLogicState,
      replayPackage,
      retainReplayBoards,
      replayPackage.stepKind === "featureStep" ? { executionKind: "featureStep", operations: replayOptions.mechanicOperations, persistentBoardState: replayPackage.boardStateBeforeSpin } : undefined,
    );

    return outcome.spin;
  }

  /**
   * Compares two simulation reports and distinguishes exact deterministic matches
   * from statistical differences without declaring one configuration "better" or "worse".
   */
  public compareReports(
    baseline: SimulationReport,
    candidate: SimulationReport,
  ): SimulationComparisonResult {
    if (!baseline || !candidate) {
      throw new SimulationComparisonError(
        "compareReports requires both baseline and candidate SimulationReport objects.",
      );
    }

    const buildDelta = (
      metric: string,
      baseVal: number,
      candVal: number,
    ): MetricComparisonDelta => {
      const absDelta = roundCurrency(candVal - baseVal);
      const exactMatch = candVal === baseVal;
      const relPct =
        Math.abs(baseVal) > 1e-9
          ? roundCurrency(((candVal - baseVal) / baseVal) * 100)
          : null;
      return Object.freeze({
        metric,
        baselineValue: baseVal,
        candidateValue: candVal,
        absoluteDelta: absDelta,
        relativeDeltaPercentage: relPct,
        exactMatch,
      });
    };

    const metricDeltas = {
      totalSpins: buildDelta("totalSpins", baseline.spinCount, candidate.spinCount),
      totalWager: buildDelta("totalWager", baseline.totalWager, candidate.totalWager),
      totalPayout: buildDelta(
        "totalPayout",
        baseline.totalPayout,
        candidate.totalPayout,
      ),
      rtpPercentage: buildDelta(
        "rtpPercentage",
        baseline.rtp.rtpPercentage,
        candidate.rtp.rtpPercentage,
      ),
      hitFrequencyPercentage: buildDelta(
        "hitFrequencyPercentage",
        baseline.hitFrequency.hitFrequencyPercentage,
        candidate.hitFrequency.hitFrequencyPercentage,
      ),
      maxWinInBetMultiples: buildDelta(
        "maxWinInBetMultiples",
        baseline.maxWin.maxWinInBetMultiples,
        candidate.maxWin.maxWinInBetMultiples,
      ),
      featureEntryFrequency: buildDelta(
        "featureEntryFrequency",
        baseline.features.featureEntryFrequency,
        candidate.features.featureEntryFrequency,
      ),
      averageWinPerSpin: buildDelta(
        "averageWinPerSpin",
        baseline.averageWin,
        candidate.averageWin,
      ),
      standardDeviationNormalizedReturn: buildDelta(
        "standardDeviationNormalizedReturn",
        baseline.volatility.standardDeviationNormalizedReturn,
        candidate.volatility.standardDeviationNormalizedReturn,
      ),
      sampleVarianceNormalizedReturn: buildDelta(
        "sampleVarianceNormalizedReturn",
        baseline.volatility.sampleVarianceNormalizedReturn,
        candidate.volatility.sampleVarianceNormalizedReturn,
      ),
      medianWin: buildDelta(
        "medianWin",
        baseline.distribution.medianWin,
        candidate.distribution.medianWin,
      ),
      p90WinMultiple: buildDelta(
        "p90WinMultiple",
        baseline.distribution.percentilesInBetMultiples.p90 ?? 0,
        candidate.distribution.percentilesInBetMultiples.p90 ?? 0,
      ),
      p99WinMultiple: buildDelta(
        "p99WinMultiple",
        baseline.distribution.percentilesInBetMultiples.p99 ?? 0,
        candidate.distribution.percentilesInBetMultiples.p99 ?? 0,
      ),
    };

    const exactMismatches: string[] = [];
    for (const [key, delta] of Object.entries(metricDeltas)) {
      if (!delta.exactMatch) {
        exactMismatches.push(key);
      }
    }
    if (
      baseline.seedMetadata.finalSnapshot.drawCount !==
      candidate.seedMetadata.finalSnapshot.drawCount
    ) {
      exactMismatches.push("seedMetadata.totalDrawsConsumed");
    }

    if (canonicalSimulationData(baseline.stats) !== canonicalSimulationData(candidate.stats)) exactMismatches.push("stats");
    if (canonicalSimulationData(baseline.seedMetadata.finalSnapshot) !== canonicalSimulationData(candidate.seedMetadata.finalSnapshot)) exactMismatches.push("seedMetadata.finalSnapshot");
    const sameConfigurationAndSeed =
      baseline.configurationFingerprint === candidate.configurationFingerprint &&
      baseline.definitionHash === candidate.definitionHash &&
      baseline.seedMetadata.canonicalSeed ===
        candidate.seedMetadata.canonicalSeed &&
      baseline.seedMetadata.algorithmId ===
        candidate.seedMetadata.algorithmId &&
      baseline.configurationSummary.spinCount ===
        candidate.configurationSummary.spinCount &&
      Math.abs(
        baseline.configurationSummary.bet - candidate.configurationSummary.bet,
      ) < 1e-9;

    return deepFreeze({
      baselineRunId: baseline.runId,
      candidateRunId: candidate.runId,
      exactMatch: exactMismatches.length === 0,
      sameConfigurationAndSeed,
      exactMismatches: Object.freeze(exactMismatches),
      metricDeltas: Object.freeze(metricDeltas),
    });
  }

  /**
   * Evaluates whether a `SimulationReport` satisfies a `MathTarget` specification.
   * Exposes the B16 extension point for RTP targeting and volatility compliance
   * without inventing an undocumented autonomous balancing algorithm.
   */
  public evaluateTargetCompliance(
    report: SimulationReport,
    target: MathTarget,
  ): MathCalibrationResult {
    if (!report || !target || !Number.isFinite(target.targetRtpPercentage) || target.targetRtpPercentage < 0 || !Number.isFinite(target.allowedRtpBandPlusMinusPercentagePoints) || target.allowedRtpBandPlusMinusPercentagePoints < 0) throw new InvalidSimulationConfigurationError("Math target RTP and tolerance must be finite and non-negative.");
    if ((target.targetHitFrequencyPercentage === undefined) !== (target.allowedHitFrequencyBandPlusMinusPercentagePoints === undefined)) throw new InvalidSimulationConfigurationError("Hit-frequency target and tolerance must be supplied together.");
    if (target.targetHitFrequencyPercentage !== undefined && (!Number.isFinite(target.targetHitFrequencyPercentage) || target.targetHitFrequencyPercentage < 0 || target.targetHitFrequencyPercentage > 100 || !Number.isFinite(target.allowedHitFrequencyBandPlusMinusPercentagePoints) || target.allowedHitFrequencyBandPlusMinusPercentagePoints! < 0)) throw new InvalidSimulationConfigurationError("Invalid hit-frequency target.");
    if (target.targetStandardDeviationRange && (target.targetStandardDeviationRange.length !== 2 || target.targetStandardDeviationRange.some((v) => !Number.isFinite(v) || v < 0) || target.targetStandardDeviationRange[0] > target.targetStandardDeviationRange[1])) throw new InvalidSimulationConfigurationError("Invalid standard-deviation target range.");
    const rtpDeviation = roundCurrency(
      report.rtp.rtpPercentage - target.targetRtpPercentage,
    );
    const withinRtpBand =
      Math.abs(rtpDeviation) <=
      target.allowedRtpBandPlusMinusPercentagePoints + 1e-9;

    let withinHitFrequencyBand: boolean | null = null;
    if (
      target.targetHitFrequencyPercentage !== undefined &&
      target.allowedHitFrequencyBandPlusMinusPercentagePoints !== undefined
    ) {
      const hfDev = Math.abs(
        report.hitFrequency.hitFrequencyPercentage -
          target.targetHitFrequencyPercentage,
      );
      withinHitFrequencyBand =
        hfDev <= target.allowedHitFrequencyBandPlusMinusPercentagePoints + 1e-9;
    }

    let withinVolatilityRange: boolean | null = null;
    if (target.targetStandardDeviationRange !== undefined) {
      const [minSd, maxSd] = target.targetStandardDeviationRange;
      const sd = report.volatility.standardDeviationNormalizedReturn;
      withinVolatilityRange = sd >= minSd - 1e-9 && sd <= maxSd + 1e-9;
    }

    return deepFreeze({
      requestedTarget: target,
      measuredReport: report,
      withinRtpBand,
      rtpDeviationPercentagePoints: rtpDeviation,
      withinHitFrequencyBand,
      withinVolatilityRange,
      adjustmentsProposed: Object.freeze([]),
      adjustmentsApplied: Object.freeze([]),
    });
  }

  /* ------------------------------------------------------------------------ */
  /* INTERNAL SINGLE-ROUND EXECUTION VIA REAL B04–B15 SUBSYSTEMS              */
  /* ------------------------------------------------------------------------ */

  /** B16 full round is composed from the same real base/feature step executor.
   * Each feature board gets B04, B13, B05–B11, B14 and B15, then B12 settles it.
   */
  private executeStatisticalRound(
    ctx: ActiveSimulationContext, rng: DeterministicGameRng, spinIndex: number,
    fixedStops: readonly number[] | undefined, _fixedBoard: undefined,
    featureState: FeatureRuntimeState | undefined, multiplierSnapshot: MultiplierValueStateSnapshot | undefined,
    logicState: FeatureLogicState | undefined, replayPackage: SpinReplayPackage,
    retainBoardSnapshot: boolean, previousBoardState?: import("../dynamics").BoardState,
  ): ReturnType<DeterministicMathSimulationEngine["executeSingleRound"]> {
    const dynamics = createBoardDynamicsEngine();
    let persistent = previousBoardState;
    if (persistent) { persistent = dynamics.expireLocks(persistent, "round").nextState; persistent = dynamics.expireLocks(persistent, "spin").nextState; persistent = dynamics.expireTags(persistent, "spin"); }
    const base = this.executeSingleRound(ctx, rng, spinIndex, fixedStops, undefined, featureState, multiplierSnapshot, logicState, replayPackage, retainBoardSnapshot, { executionKind: "baseStep", spinIndex, operations: ctx.simConfig.mechanicOperations, persistentBoardState: persistent });
    let latest = base;
    const steps: SimulationSpin[] = [];
    const cap = toMicroUnits(roundCurrency(ctx.bet * ctx.config.math.maxWinX));
    let payoutUnits = toMicroUnits(base.spin.win), featureUnits = 0;
    let rawSources = { ...base.spin.winBySource };
    const limit = ctx.simConfig.maxFeatureStepsPerRound ?? 200;
    while (latest.nextFeatureState?.status === "active") {
      if (payoutUnits >= cap) {
        latest = { ...latest, nextFeatureState: ctx.featureEngine!.endFeature(latest.nextFeatureState, "winCapReached").nextState }; break;
      }
      if (steps.length >= limit) throw new SimulationGuardExceededError("Feature round did not complete before its step guard.", { spinIndex, limit });
      ctx.checkExecutionGuard?.(1);
      const current = latest.nextFeatureState;
      const boundedFeature = { ...current, winCap: Math.min(current.winCap ?? Number.MAX_SAFE_INTEGER, (toMicroUnits(current.accumulatedFeatureWin) + cap - payoutUnits) / 10000) };
      let heldBoard = latest.boardState;
      if (heldBoard) { heldBoard = dynamics.expireLocks(heldBoard, "spin").nextState; heldBoard = dynamics.expireTags(heldBoard, "spin"); }
      const childPackage: SpinReplayPackage = deepFreeze(JSON.parse(JSON.stringify({ ...replayPackage, spinIndex, stepKind: "featureStep", fixedStopIndexes: undefined, rngSnapshotBeforeSpin: rng.snapshot(), featureStateBeforeSpin: boundedFeature, multiplierSnapshotBeforeSpin: latest.nextMultiplierSnapshot, ...(latest.nextLogicState && ctx.logicEngine ? { logicSnapshotBeforeSpin: ctx.logicEngine.snapshot(latest.nextLogicState) } : {}), ...(heldBoard ? { boardStateBeforeSpin: heldBoard } : {}) })) as SpinReplayPackage);
      latest = this.executeSingleRound(ctx, rng, spinIndex, undefined, undefined, boundedFeature, latest.nextMultiplierSnapshot, latest.nextLogicState, childPackage, retainBoardSnapshot, { executionKind: "featureStep", spinIndex, operations: ctx.simConfig.mechanicOperations, persistentBoardState: heldBoard });
      steps.push(latest.spin);
      featureUnits = safeSimulationSum(featureUnits, toMicroUnits(latest.spin.win));
      payoutUnits = safeSimulationSum(payoutUnits, toMicroUnits(latest.spin.win));
      const sources = reconcileSimulationSources(latest.spin.winBySource, latest.spin.win);
      rawSources = Object.fromEntries(SIMULATION_SOURCES.map((key) => [key, safeSimulationSum(toMicroUnits(rawSources[key]), toMicroUnits(sources[key])) / 10000])) as Record<WinSourceKind, number>;
    }
    const awardUnits = Math.min(payoutUnits, cap);
    featureUnits = Math.min(featureUnits, Math.max(0, cap - Math.min(toMicroUnits(base.spin.win), cap)));
    const sources = reconcileSimulationSources(rawSources, awardUnits / 10000);
    const triggered = base.spin.triggeredFeatureIds.length ? base.spin.triggeredFeatureIds : base.nextFeatureState?.status === "active" && base.nextFeatureState.featureId ? [base.nextFeatureState.featureId] : [];
    const contributions = new Map<string, { featureId: string; triggerCount: number; entryCount: number; spinsPlayed: number; retriggers: number; upgrades: number; award: number }>();
    const contribution = (id: string) => { let value = contributions.get(id); if (!value) { value = { featureId: id, triggerCount: 0, entryCount: 0, spinsPlayed: 0, retriggers: 0, upgrades: 0, award: 0 }; contributions.set(id, value); } return value; };
    for (const id of triggered) contribution(id).triggerCount += 1;
    if (base.nextFeatureState?.featureId) contribution(base.nextFeatureState.featureId).entryCount += 1;
    let featureBudget = featureUnits;
    for (const step of steps) {
      const id = step.replayPackage.featureStateBeforeSpin?.featureId;
      if (!id) continue;
      const value = contribution(id); if (!value.entryCount) value.entryCount = 1;
      value.spinsPlayed += 1; value.retriggers += step.featureRetriggersInRound; value.upgrades += step.featureUpgradesInRound;
      const paid = Math.min(featureBudget, toMicroUnits(step.win)); featureBudget -= paid; value.award = safeSimulationSum(toMicroUnits(value.award), paid) / 10000;
    }
    const components = [base.spin, ...steps];
    const addCount = (field: "paylineWinCount" | "waysWinCount" | "clusterWinCount" | "payAnywhereWinCount" | "scatterWinCount" | "winningCombinationsCount" | "cascadeCount" | "featureRetriggersInRound" | "featureUpgradesInRound") => components.reduce((sum, spin) => sum + spin[field], 0);
    const win = awardUnits / 10000;
    const spin: SimulationSpin = deepFreeze({ ...base.spin, rngSnapshotAfter: rng.snapshot(), drawsConsumed: rng.snapshot().drawCount - base.spin.rngSnapshotBefore.drawCount, win, netResult: roundCurrency(win - ctx.bet), winMultiplier: roundCurrency(win / ctx.bet), isWinningSpin: win > 0, baseGameWin: (awardUnits - featureUnits) / 10000, featureWin: featureUnits / 10000, winBySource: sources,
      paylineWinCount: addCount("paylineWinCount"), waysWinCount: addCount("waysWinCount"), clusterWinCount: addCount("clusterWinCount"), payAnywhereWinCount: addCount("payAnywhereWinCount"), scatterWinCount: addCount("scatterWinCount"), winningCombinationsCount: addCount("winningCombinationsCount"), featureValueWinAmount: sources.featureValue,
      cascadeCount: addCount("cascadeCount"), cascadePayouts: components.flatMap((part) => [...part.cascadePayouts]), multiplierAfter: Math.max(...components.map((part) => part.multiplierAfter)),
      triggeredFeatureIds: triggered, featureBreakdown: [...contributions.values()],
      activeFeatureId: base.spin.triggeredFeatureIds[0] ?? base.nextFeatureState?.featureId ?? (steps.length ? featureState?.featureId ?? null : null), featureSpinsPlayedInRound: steps.length, featureRetriggersInRound: addCount("featureRetriggersInRound"), featureUpgradesInRound: addCount("featureUpgradesInRound"),
      ...(retainBoardSnapshot ? { finalBoardSnapshot: extractBoardSymbolGrid(latest.board) } : {}),
      ...(ctx.simConfig.retainSpinTraces ? { featureSteps: steps } : {}),
      ...(latest.spin.meterValues ? { meterValues: latest.spin.meterValues } : {}),
      uncappedWin: payoutUnits / 10000, capTrimmed: (payoutUnits - awardUnits) / 10000,
    });
    const mult = ctx.multiplierEngine && latest.nextMultiplierSnapshot ? ctx.multiplierEngine.restoreState(latest.nextMultiplierSnapshot) : undefined;
    const cleared = mult && ctx.multiplierEngine ? ctx.multiplierEngine.clearFeatureState(mult.multiplierState, mult.valueState) : undefined;
    let boardState = latest.boardState;
    if (boardState) { boardState = dynamics.expireLocks(boardState, "round").nextState; boardState = dynamics.expireTags(boardState, "feature"); }
    return { ...latest, spin, boardState, nextFeatureState: ctx.featureEngine?.createInitialState(), nextMultiplierSnapshot: cleared && ctx.multiplierEngine ? ctx.multiplierEngine.snapshotState(cleared.multiplierState, cleared.valueState) : latest.nextMultiplierSnapshot, nextLogicState: latest.nextLogicState && ctx.logicEngine ? ctx.logicEngine.clearFeatureScope(latest.nextLogicState) : latest.nextLogicState };
  }

  private resolveFixedStopForSpin(
    fixedStops: SimulationConfig["fixedStops"],
    spinIndex: number,
  ): readonly number[] | undefined {
    if (!fixedStops || fixedStops.length === 0) {
      return undefined;
    }
    const first = fixedStops[0];
    if (typeof first === "number") {
      return fixedStops as readonly number[];
    }
    const list = fixedStops as readonly (readonly number[])[];
    return list[spinIndex % list.length];
  }

  private executeSingleRound(
    ctx: ActiveSimulationContext,
    rng: DeterministicGameRng,
    spinIndex: number,
    fixedStopIndexes: readonly number[] | undefined,
    fixedBoardGrid: readonly (readonly string[])[] | undefined,
    featureState: FeatureRuntimeState | undefined,
    multiplierSnapshot: MultiplierValueStateSnapshot | undefined,
    logicState: FeatureLogicState | undefined,
    replayPackage: SpinReplayPackage,
    retainBoardSnapshot: boolean,
    executionInput?: RoundExecutionInput,
    observation: RoundObservationOptions = {},
  ): {
    readonly board: Board;
    readonly boardState: import("../dynamics").BoardState | undefined;
    readonly reelResult: import("../reels").ReelResult;
    readonly spin: SimulationSpin;
    readonly nextFeatureState: FeatureRuntimeState | undefined;
    readonly nextMultiplierSnapshot: MultiplierValueStateSnapshot | undefined;
    readonly nextLogicState: FeatureLogicState | undefined;
  } {
    const { config, bet } = ctx;
    let observationIndex = 0;
    const occurrences = new Map<ExecutionStage, number>();
    const emit = (stage: ExecutionStage, data: Readonly<Record<string, unknown>>): void => {
      if (!observation.observe) return;
      const occurrence = occurrences.get(stage) ?? 0;
      occurrences.set(stage, occurrence + 1);
      // Copy before freezing: observers cannot mutate production state or case inputs.
      observation.observe(deepFreeze({ index: observationIndex++, stage, occurrence, data: JSON.parse(JSON.stringify(data)) as Record<string, unknown> }));
    };
    emit("ENGINE INPUT", { config, bet, fixedStopIndexes, executionInput, rngState: rng.snapshot() });
    const roundId = `sim-round-${config.gameId}-${spinIndex + 1}`;
    const rngSnapshotBefore = rng.snapshot();

    // Advance the master simulation RNG by one deterministic 32-bit draw per round
    // to derive an independent B03 round RNG tree while preserving exact snapshot
    // replay and batch equivalence.
    const roundSeed = rng.nextUint32();
    const roundRng = createSeededRng(roundSeed, executionInput ? { algorithm: rngSnapshotBefore.algorithm } : undefined);

    // 1. Resolve reel stops via B04 ReelResolver & build initial Board via B04 BoardBuilder
    const playable = executionInput?.executionKind;
    const reelConfig = playable === "featureStep" && featureState?.status === "active" ? { ...config, reels: featureState.activeReels } : config;
    if (fixedStopIndexes && (fixedStopIndexes.length !== reelConfig.reels.length || fixedStopIndexes.some((stop, i) => !Number.isInteger(stop) || stop < 0 || stop >= reelConfig.reels[i]!.stops.length))) {
      throw new InvalidVerificationCaseError("Explicit stops do not match the active reel source.");
    }
    const reelResult = ctx.reelResolver.resolveReels(reelConfig, roundRng, {
      roundId,
      forcedStopIndexes: fixedStopIndexes,
      reelHeights: executionInput?.reelHeights,
      trace: !!observation.observe,
    });

    emit("REELS", { source: fixedStopIndexes ? "fixedStops" : "rng", result: reelResult });
    let initialBoard = executionInput?.boardState?.board ?? (fixedBoardGrid
      ? createBoardFromSymbolGrid(fixedBoardGrid)
      : ctx.boardBuilder.buildBoard(reelConfig, reelResult));
    emit("BOARD", { source: executionInput?.boardState ? "startingRuntimeState" : fixedBoardGrid ? "explicitInitialBoard" : "B04", board: initialBoard });

    let initialBoardSnapshot = retainBoardSnapshot
      ? extractBoardSymbolGrid(initialBoard)
      : undefined;

    let workingMultState =
      ctx.multiplierEngine && multiplierSnapshot
        ? ctx.multiplierEngine.restoreState(multiplierSnapshot)
        : ctx.multiplierEngine
          ? ctx.multiplierEngine.createInitialState()
          : undefined;

    if (
      ctx.multiplierEngine &&
      workingMultState &&
      ctx.simConfig.multiplierConfig?.tumbleMultiplier
    ) {
      const initTumble = ctx.multiplierEngine.initializeTumbleMultiplier(
        workingMultState.multiplierState,
        workingMultState.valueState,
        ctx.simConfig.multiplierConfig.tumbleMultiplier,
      );
      workingMultState = {
        multiplierState: initTumble.multiplierState,
        valueState: initTumble.valueState,
      };
    }

    if (playable === "featureStep" && ctx.multiplierEngine && workingMultState && featureState?.featureId && (workingMultState.multiplierState.featureMultiplier?.featureId !== featureState.featureId || workingMultState.multiplierState.featureMultiplier?.startingMultiplier !== featureState.currentMultiplier)) {
      const initialized = ctx.multiplierEngine.initializeFeatureMultiplier(workingMultState.multiplierState, workingMultState.valueState, featureState.featureId, { explicitStartingMultiplier: featureState.currentMultiplier });
      workingMultState = { multiplierState: initialized.multiplierState, valueState: initialized.valueState };
    }

    const multiplierBefore =
      ctx.multiplierEngine && workingMultState
        ? ctx.multiplierEngine.getCurrentTumbleMultiplier(
            workingMultState.multiplierState,
          )
        : 1;
    let multiplierAfter = multiplierBefore;

    const winBySourceUnits: Record<WinSourceKind, number> = {
      payline: 0,
      ways: 0,
      cluster: 0,
      payAnywhere: 0,
      scatter: 0,
      featureValue: 0,
    };

    let paylineWinCount = 0;
    let waysWinCount = 0;
    let clusterWinCount = 0;
    let payAnywhereWinCount = 0;
    let scatterWinCount = 0;
    let featureValueWinAmount = 0;

    // 2. Evaluate initial board and any B13 Tumble/Cascade steps
    let currentBoard = initialBoard;
    let workingBoardState = ctx.dynamicsEngine
      ? ctx.dynamicsEngine.createBoardState(initialBoard, {
          reelStopIndexes: reelResult.stopIndexes,
        })
      : undefined;
    workingBoardState = executionInput?.boardState ?? workingBoardState;
    if (playable && executionInput?.persistentBoardState && ctx.dynamicsEngine) {
      const previous = executionInput.persistentBoardState;
      workingBoardState = ctx.dynamicsEngine.createBoardState(initialBoard, { locksByCoord: previous.locksByCoord, attachedValuesByCoord: Object.fromEntries(Object.entries(previous.attachedValuesByCoord).filter(([coord]) => previous.locksByCoord[coord]?.locked)), tagsByCoord: previous.tagsByCoord, colossalInstances: previous.colossalInstances, resizeEventsUsedInSession: previous.resizeEventsUsedInSession, reelStopIndexes: reelResult.stopIndexes });
      const placements = Object.values(previous.locksByCoord).filter((lock) => lock.locked).map((lock) => ({ position: { reelIndex: lock.reelIndex, rowIndex: lock.rowIndex }, symbolId: previous.board.cells[lock.reelIndex]![lock.rowIndex]!.symbolId, respectLocks: false }));
      if (placements.length) {
        const held = ctx.dynamicsEngine.placeSymbols(workingBoardState, { placements, respectLocks: false });
        workingBoardState = held.nextState;
        emit("BOARD TRANSFORM", { result: held, reason: "persistentLocks" });
      }
      currentBoard = workingBoardState.board;
    }
    if (playable === "featureStep" && featureState?.currentMode === "holdAndWin" && featureState.lockedCells.length && ctx.dynamicsEngine && workingBoardState) {
      const held = ctx.dynamicsEngine.placeSymbols(workingBoardState, { placements: featureState.lockedCells.map((cell) => ({ position: { reelIndex: cell.reelIndex, rowIndex: cell.rowIndex }, symbolId: cell.symbolId })), respectLocks: false });
      workingBoardState = held.nextState; currentBoard = held.nextState.board;
      emit("BOARD TRANSFORM", { result: held, reason: "B12HeldCells" });
    }
    let workingFeatureState = featureState;
    let workingLogicState = logicState;
    let operationPrizeUnitsBeforeLogic = 0;
    const runOperations = (at: "beforeWins" | "afterValues" | "beforeFeatures" | "afterLogic"): void => {
      if (!executionInput?.operations?.some((op) => op.at === at)) return;
      const mult = workingMultState ?? createMultiplierValueEngine().createInitialState();
      const runtime = {
        boardState: workingBoardState ?? createBoardDynamicsEngine().createBoardState(currentBoard, { reelStopIndexes: reelResult.stopIndexes }),
        featureState: workingFeatureState, logicState: workingLogicState,
        multiplierState: mult.multiplierState, valueState: mult.valueState,
      };
      const prizesBefore = workingLogicState?.totalAwardedPrizes ?? 0;
      runMechanicOperations(executionInput, at, runtime, config, ctx.simConfig.featureConfig, roundRng.fork(`operations-${at}`), emit);
      if (playable && at !== "afterLogic") operationPrizeUnitsBeforeLogic += toMicroUnits((runtime.logicState?.totalAwardedPrizes ?? prizesBefore) - prizesBefore);
      workingBoardState = runtime.boardState;
      currentBoard = runtime.boardState.board;
      workingFeatureState = runtime.featureState;
      workingLogicState = runtime.logicState;
      workingMultState = { multiplierState: runtime.multiplierState, valueState: runtime.valueState };
    };
    runOperations("beforeWins");
    initialBoard = currentBoard;
    initialBoardSnapshot = retainBoardSnapshot ? extractBoardSymbolGrid(initialBoard) : undefined;
    let settlementContext: SettlementMultiplierContext | undefined;
    let cascadeCount = 0;
    const cascadePayouts: number[] = [];
    const maxCascadeSteps = ctx.simConfig.maxCascadeStepsPerSpin ?? 25;

    for (let stepIndex = 0; stepIndex <= maxCascadeSteps; stepIndex += 1) {
      ctx.checkExecutionGuard?.(stepIndex > 0 ? 1 : 0);
      const stepEval = this.evaluateBoardAcrossActiveWinEngines(
        ctx,
        currentBoard,
        bet,
        stepIndex === 0,
      );

      emit("WIN EVALUATION", { stepIndex, board: currentBoard, result: stepEval });
      let activeMult =
        ctx.multiplierEngine && workingMultState
          ? ctx.multiplierEngine.getCurrentTumbleMultiplier(
              workingMultState.multiplierState,
            )
          : 1;

      let authoritativeStepWin: number | undefined;
      if (playable && ctx.multiplierEngine && workingMultState) {
        const settled = ctx.multiplierEngine.buildSettlementContext(workingMultState.multiplierState, workingMultState.valueState, {
          baseWin: stepEval.totalWin, winningPositions: stepEval.winningPositions,
          winningSymbolIds: Array.from(new Set(stepEval.winningPositions.map((p) => currentBoard.cells[p.reelIndex]![p.rowIndex]!.symbolId))),
          settleMeters: true,
        });
        activeMult = settled.detail.effectiveMultiplier;
        multiplierAfter = Math.max(multiplierAfter, activeMult);
        authoritativeStepWin = settled.detail.settledWinAmount;
        settlementContext = settled.detail;
        workingMultState = { multiplierState: settled.multiplierState, valueState: settled.valueState };
        emit("MULTIPLIER/VALUE", { stepIndex, result: settled });
      }
      let stepRawWin = stepEval.totalWin;
      if (activeMult !== 1 && stepRawWin > 0) {
        stepRawWin = roundCurrency(stepRawWin * activeMult);
      }

      if (authoritativeStepWin !== undefined) stepRawWin = authoritativeStepWin;
      const sourceUnitsBefore = Object.values(winBySourceUnits).reduce((sum, v) => sum + v, 0);
      // Accumulate win sources scaled by active multiplier
      winBySourceUnits.payline += toMicroUnits(
        roundCurrency(stepEval.paylineWin * activeMult),
      );
      winBySourceUnits.ways += toMicroUnits(
        roundCurrency(stepEval.waysWin * activeMult),
      );
      winBySourceUnits.cluster += toMicroUnits(
        roundCurrency(stepEval.clusterWin * activeMult),
      );
      winBySourceUnits.payAnywhere += toMicroUnits(
        roundCurrency(stepEval.payAnywhereWin * activeMult),
      );
      winBySourceUnits.scatter += toMicroUnits(
        roundCurrency(stepEval.scatterWin * activeMult),
      );

      if (playable) {
        const sourceDelta = Object.values(winBySourceUnits).reduce((sum, v) => sum + v, 0) - sourceUnitsBefore;
        winBySourceUnits.featureValue += toMicroUnits(stepRawWin) - sourceDelta;
      }
      paylineWinCount += stepEval.paylineWinCount;
      waysWinCount += stepEval.waysWinCount;
      clusterWinCount += stepEval.clusterWinCount;
      payAnywhereWinCount += stepEval.payAnywhereWinCount;
      scatterWinCount += stepEval.scatterWinCount;

      if (stepRawWin > 0) {
        cascadePayouts.push(stepRawWin);
      }

      if (!ctx.cascadeLimitIsPolicy && ctx.simConfig.tumbleConfig && stepIndex === maxCascadeSteps && stepEval.winningPositions.length > 0) {
        throw new SimulationGuardExceededError("Cascade execution guard reached before settlement.", { maxCascadeSteps, stepIndex });
      }
      // Check if B13 Tumble / Cascade is configured and there are removable winning positions
      if (
        !ctx.dynamicsEngine ||
        !workingBoardState ||
        !ctx.simConfig.tumbleConfig ||
        stepEval.winningPositions.length === 0 ||
        stepIndex === maxCascadeSteps
      ) {
        break;
      }

      const tumbleRes = ctx.dynamicsEngine.applyTumble(
        workingBoardState,
        stepEval.winningPositions,
        {
          ...ctx.simConfig.tumbleConfig,
          reelStrips: ctx.simConfig.tumbleConfig.reelStrips ?? config.reels,
          rng: roundRng.fork(`tumble-${stepIndex + 1}`),
        },
      );

      emit("BOARD TRANSFORM", { stepIndex, result: tumbleRes, board: tumbleRes.nextState.board });
      if (tumbleRes.removedCells.length === 0) {
        break;
      }

      cascadeCount += 1;
      workingBoardState = tumbleRes.nextState;
      currentBoard = workingBoardState.board;

      if (playable && ctx.multiplierEngine && workingMultState) {
        const synced = ctx.multiplierEngine.syncWithBoardTransition(workingMultState.multiplierState, workingMultState.valueState, {
          nextBoard: currentBoard, removedPositions: tumbleRes.removedCells.map((c) => c.position), movedCells: tumbleRes.movedCells,
        });
        workingMultState = { multiplierState: synced.multiplierState, valueState: synced.valueState };
      }
      if (ctx.multiplierEngine && workingMultState?.multiplierState.tumbleState) {
        const settledStep = ctx.multiplierEngine.settleCurrentTumble(
          workingMultState.multiplierState,
          workingMultState.valueState,
          stepEval.totalWin,
        );
        const advStep = ctx.multiplierEngine.advanceTumbleMultiplier(
          settledStep.multiplierState,
          settledStep.valueState,
        );
        workingMultState = {
          multiplierState: advStep.multiplierState,
          valueState: advStep.valueState,
        };
        emit("MULTIPLIER/VALUE", { stepIndex, result: advStep });
        multiplierAfter = ctx.multiplierEngine.getCurrentTumbleMultiplier(
          workingMultState.multiplierState,
        );
      }
    }

    // 3. Evaluate B14 Assigned Symbol Values & Collection if configured
    if (
      ctx.multiplierEngine &&
      workingMultState &&
      ctx.simConfig.multiplierConfig?.assignedValues
    ) {
      const assigned = ctx.multiplierEngine.assignCellValues(
        workingMultState.multiplierState,
        workingMultState.valueState,
        currentBoard,
        ctx.simConfig.multiplierConfig.assignedValues,
        roundRng.fork("assigned-values"),
      );
      workingMultState = {
        multiplierState: assigned.multiplierState,
        valueState: assigned.valueState,
      };

      emit("MULTIPLIER/VALUE", { result: assigned });
      if (ctx.simConfig.multiplierConfig.collection) {
        const collected = ctx.multiplierEngine.collectValues(
          workingMultState.multiplierState,
          workingMultState.valueState,
          currentBoard,
          ctx.simConfig.multiplierConfig.collection,
        );
        workingMultState = {
          multiplierState: collected.multiplierState,
          valueState: collected.valueState,
        };
        emit("MULTIPLIER/VALUE", { result: collected });
        if (collected.detail.totalCollectedValue > 0) {
          const collectedCredits = roundCurrency(
            collected.detail.totalCollectedValue * bet,
          );
          featureValueWinAmount = roundCurrency(
            featureValueWinAmount + collectedCredits,
          );
          winBySourceUnits.featureValue += toMicroUnits(collectedCredits);
        }
      }

      if (!playable) {
      const preBaseWin = fromMicroUnits(
        winBySourceUnits.payline +
          winBySourceUnits.ways +
          winBySourceUnits.cluster +
          winBySourceUnits.payAnywhere +
          winBySourceUnits.scatter,
      );
      const settled = ctx.multiplierEngine.buildSettlementContext(
        workingMultState.multiplierState,
        workingMultState.valueState,
        {
          baseWin: preBaseWin,
          ...(playable ? { consumeSymbolMemoryOnPay: false } : {}),
        },
      );
      settlementContext = settled.detail;
      }
    }

    runOperations("afterValues");
    if (ctx.multiplierEngine && workingMultState) {
      emit("MULTIPLIER/VALUE", { multiplierState: workingMultState.multiplierState, valueState: workingMultState.valueState, settlementContext });
      if (!playable) workingMultState = ctx.multiplierEngine.clearSpinState(
        workingMultState.multiplierState,
        workingMultState.valueState,
      );
    }

    const baseGameWin = fromMicroUnits(
      winBySourceUnits.payline +
        winBySourceUnits.ways +
        winBySourceUnits.cluster +
        winBySourceUnits.payAnywhere +
        winBySourceUnits.scatter +
        winBySourceUnits.featureValue,
    );

    const featureCellValues = playable ? { ...workingBoardState?.attachedValuesByCoord, ...Object.fromEntries(Object.entries(workingMultState?.valueState.cellValuesByCoord ?? {}).filter(([, value]) => !value.consumed).map(([coord, value]) => [coord, value.value])) } : undefined;

    // 4. Evaluate B12 Feature Triggers & Execute Triggered Feature Lifecycle
    runOperations("beforeFeatures");
    const triggeredFeatureIds: string[] = [];
    let featureSpinsPlayedInRound = 0;
    let featureRetriggersInRound = 0;
    let featureUpgradesInRound = 0;
    let featureWinUnits = 0;
    let activeFeatureIdAtEnd: string | null = null;

    if (playable === "featureStep") {
      if (!ctx.featureEngine || !workingFeatureState || workingFeatureState.status !== "active") throw new SimulationExecutionError("No active feature to continue.");
      const stepped = ctx.featureEngine.runFeatureStep(workingFeatureState, { board: currentBoard, spinWinAmount: baseGameWin, rng: roundRng.fork("feature-step"), cellValuesByCoord: featureCellValues });
      workingFeatureState = stepped.nextState;
      featureSpinsPlayedInRound = 1;
      featureRetriggersInRound = stepped.retriggers.filter((r) => !r.cappedOut && r.spinsAdded > 0).length;
      featureUpgradesInRound = stepped.upgradeInfo ? 1 : 0;
      featureWinUnits = toMicroUnits(stepped.stepWinAwarded);
      activeFeatureIdAtEnd = workingFeatureState.featureId;
      emit("FEATURE LOGIC", { result: stepped, board: currentBoard });
    } else if (ctx.featureEngine && workingFeatureState) {
      const trigEval = ctx.featureEngine.evaluateTriggers(
        currentBoard,
        workingFeatureState,
        {
          evaluationId: `${roundId}-trig`,
        },
      );
      workingFeatureState = trigEval.nextState;
      emit("FEATURE LOGIC", { result: trigEval });

      for (const tr of trigEval.triggerResults) {
        if (tr.matched && tr.selectedFeatureId) {
          triggeredFeatureIds.push(tr.selectedFeatureId);
        }
      }

      if (triggeredFeatureIds.length > 0 || workingFeatureState.status === "active") {
        const primaryFeatureId = triggeredFeatureIds[0] ?? workingFeatureState.featureId!;
        const primaryTrig = trigEval.triggerResults.find(
          (t: FeatureTriggerEvaluation) =>
            t.selectedFeatureId === primaryFeatureId && t.matched,
        );
        const started = triggeredFeatureIds.length > 0 ? ctx.featureEngine.startFeature(primaryFeatureId, {
          previousState: workingFeatureState,
          triggerCount: primaryTrig?.measuredValue,
          board: currentBoard,
          ...(playable ? { cellValuesByCoord: featureCellValues } : {}),
        }) : null;
        if (started) {
          workingFeatureState = started.nextState;
          emit("FEATURE LOGIC", { result: started, board: currentBoard });
        }
        activeFeatureIdAtEnd = workingFeatureState.featureId;

        const maxFeatureSpinsGuard = executionInput?.maxFeatureSpins ?? 200;
        while (
          !playable && workingFeatureState.status === "active" &&
          featureSpinsPlayedInRound < maxFeatureSpinsGuard
        ) {
          featureSpinsPlayedInRound += 1;
          const fRoundId = `${roundId}-fs-${featureSpinsPlayedInRound}`;
          const fSubRng = roundRng.fork(`fs-${featureSpinsPlayedInRound}`);
          const explicitFeatureStops = executionInput?.featureReelStops?.[featureSpinsPlayedInRound - 1];
          if (explicitFeatureStops && (explicitFeatureStops.length !== workingFeatureState.activeReels.length || explicitFeatureStops.some((stop, i) => !Number.isInteger(stop) || stop < 0 || stop >= workingFeatureState!.activeReels[i]!.stops.length))) {
            throw new InvalidVerificationCaseError("Feature stops do not match the active B04 reel source.", { path: `input.featureReelStops[${featureSpinsPlayedInRound - 1}]`, fixedStops: explicitFeatureStops });
          }
          const fReelResult = ctx.reelResolver.resolveReels(
            executionInput ? { ...config, reels: workingFeatureState.activeReels } : config,
            fSubRng,
            { roundId: fRoundId, forcedStopIndexes: executionInput?.featureReelStops?.[featureSpinsPlayedInRound - 1] },
          );
          const fBoard = ctx.boardBuilder.buildBoard(executionInput ? { ...config, reels: workingFeatureState.activeReels } : config, fReelResult);
          emit("REELS", { featureSpin: featureSpinsPlayedInRound, source: executionInput?.featureReelStops?.[featureSpinsPlayedInRound - 1] ? "fixedStops" : "rng", result: fReelResult });
          emit("BOARD", { featureSpin: featureSpinsPlayedInRound, board: fBoard });
          const fEval = this.evaluateBoardAcrossActiveWinEngines(
            ctx,
            fBoard,
            bet,
            true,
          );

          emit("WIN EVALUATION", { featureSpin: featureSpinsPlayedInRound, board: fBoard, result: fEval });
          const stepped = ctx.featureEngine.runFeatureStep(
            workingFeatureState,
            {
              board: fBoard,
              spinWinAmount: fEval.totalWin,
              rng: fSubRng.fork("step"),
            },
          );
          workingFeatureState = stepped.nextState;
          emit("FEATURE LOGIC", { featureSpin: featureSpinsPlayedInRound, board: fBoard, result: stepped });
          if (stepped.stepWinAwarded > 0) {
            featureWinUnits += toMicroUnits(stepped.stepWinAwarded);
          }
          if (stepped.retriggers.length > 0) {
            featureRetriggersInRound += stepped.retriggers.filter(
              (r) => !r.cappedOut && r.spinsAdded > 0,
            ).length;
          }
          if (stepped.upgradeInfo) {
            featureUpgradesInRound += 1;
          }
        }
        if (!playable && workingFeatureState.status === "active") {
          throw new SimulationGuardExceededError("Feature execution guard reached before settlement.", { maxFeatureSpinsGuard });
        }
        emit("FEATURE LOGIC", { finalFeatureState: workingFeatureState });
        if (!playable) workingFeatureState = ctx.featureEngine.createInitialState();
      }
    }

    if (executionInput?.featureReelStops && executionInput.featureReelStops.length > featureSpinsPlayedInRound) {
      throw new InvalidVerificationCaseError("Unused explicit feature-spin stops.", { path: "input.featureReelStops", featureSpinsPlayedInRound });
    }
    const featureWin = fromMicroUnits(featureWinUnits);
    let totalSpinWin = fromMicroUnits(
      (playable === "featureStep" ? 0 : toMicroUnits(baseGameWin)) + featureWinUnits,
    );

    if (operationPrizeUnitsBeforeLogic > 0) {
      totalSpinWin = fromMicroUnits(toMicroUnits(totalSpinWin) + operationPrizeUnitsBeforeLogic);
      featureValueWinAmount = fromMicroUnits(toMicroUnits(featureValueWinAmount) + operationPrizeUnitsBeforeLogic);
      winBySourceUnits.featureValue += operationPrizeUnitsBeforeLogic;
    }
    // 5. Evaluate B15 Meters & Feature Logic Engine if configured
    let meterValuesSnapshot: Readonly<Record<string, number>> | undefined;
    if (ctx.logicEngine && workingLogicState) {
      // B15 recordEvent can itself fire thresholds and ordered actions. Preserve
      // its real result and settle only the newly awarded prize delta.
      const recordLogicEvent = (event: import("../logic").MeterEvent): void => {
        if (!ctx.logicEngine || !workingLogicState) return;
        const before = workingLogicState.totalAwardedPrizes;
        const result = ctx.logicEngine.recordEvent(workingLogicState, event, {
          rng: roundRng.fork(`logic-event-${event.eventType}-${event.symbolId ?? "all"}`),
          boardState: workingBoardState,
          featureState: workingFeatureState,
          featureEngine: ctx.featureEngine ?? undefined,
        });
        workingLogicState = result.nextState;
        if (result.boardState) { workingBoardState = result.boardState; currentBoard = result.boardState.board; }
        if (result.featureState) workingFeatureState = result.featureState;
        emit("METER/LOGIC", { event, result });
        const delta = roundCurrency(workingLogicState.totalAwardedPrizes - before);
        if (delta > 0) {
          totalSpinWin = roundCurrency(totalSpinWin + delta);
          featureValueWinAmount = roundCurrency(featureValueWinAmount + delta);
          winBySourceUnits.featureValue += toMicroUnits(delta);
        }
      };
      // Record spinsPlayed event
      recordLogicEvent({
        eventType: "spinsPlayed",
        count: 1,
      });

      // Record symbolsLanded events from final visible board
      const symbolCounts = new Map<string, number>();
      for (const col of currentBoard.cells) {
        for (const cell of col) {
          const sId = cell.symbol.symbolId;
          symbolCounts.set(sId, (symbolCounts.get(sId) ?? 0) + 1);
        }
      }
      for (const [symbolId, count] of symbolCounts.entries()) {
        recordLogicEvent({ eventType: "symbolsLanded", symbolId, count });
      }

      if (totalSpinWin > 0) {
        recordLogicEvent({ eventType: "winsTaken", count: 1, winAmount: totalSpinWin });
      }

      // Evaluate thresholds across all meters
      for (const meterId of Object.keys(workingLogicState.metersById)) {
        const prizesBefore = workingLogicState.totalAwardedPrizes;
        const threshEval = ctx.logicEngine.evaluateThresholds(
          workingLogicState,
          meterId,
        );
        workingLogicState = threshEval.nextState;
        emit("METER/LOGIC", { meterId, result: threshEval });
        const prizeDelta = roundCurrency(
          workingLogicState.totalAwardedPrizes - prizesBefore,
        );
        if (prizeDelta > 0) {
          totalSpinWin = roundCurrency(totalSpinWin + prizeDelta);
          featureValueWinAmount = roundCurrency(
            featureValueWinAmount + prizeDelta,
          );
          winBySourceUnits.featureValue += toMicroUnits(prizeDelta);
        }
      }

      // Evaluate losing-spin condition if configured
      if (ctx.simConfig.losingSpinCondition || ctx.simConfig.losingSpinActions) {
        const losingPrizesBefore = workingLogicState.totalAwardedPrizes;
        const losingEval = ctx.logicEngine.evaluateLosingSpinCondition(
          workingLogicState,
          ctx.simConfig.losingSpinCondition ?? { conditionId: ctx.simConfig.losingSpinActions!.sequenceId, kind: "losingSpin", actions: ctx.simConfig.losingSpinActions!.actions },
          {
            settledTotalWin: totalSpinWin,
            paylineWin: fromMicroUnits(winBySourceUnits.payline),
            waysWin: fromMicroUnits(winBySourceUnits.ways),
            clusterWin: fromMicroUnits(winBySourceUnits.cluster),
            payAnywhereWin: fromMicroUnits(winBySourceUnits.payAnywhere),
            scatterWin: fromMicroUnits(winBySourceUnits.scatter),
            settlementContext,
          },
          { rng, ...(playable ? { boardState: workingBoardState, featureState: workingFeatureState, featureEngine: ctx.featureEngine ?? undefined } : {}) },
        );
        workingLogicState = losingEval.nextState;
        if (playable) {
          if (losingEval.boardState) { workingBoardState = losingEval.boardState; currentBoard = losingEval.boardState.board; }
          if (losingEval.featureState) workingFeatureState = losingEval.featureState;
          const delta = roundCurrency(workingLogicState.totalAwardedPrizes - losingPrizesBefore);
          totalSpinWin = roundCurrency(totalSpinWin + delta);
          featureValueWinAmount = roundCurrency(featureValueWinAmount + delta);
          winBySourceUnits.featureValue += toMicroUnits(delta);
        }
        emit("METER/LOGIC", { result: losingEval });
      }

      const operationPrizesBefore = workingLogicState.totalAwardedPrizes;
      runOperations("afterLogic");
      const operationPrizeDelta = roundCurrency(workingLogicState.totalAwardedPrizes - operationPrizesBefore);
      if (operationPrizeDelta > 0) {
        totalSpinWin = roundCurrency(totalSpinWin + operationPrizeDelta);
        featureValueWinAmount = roundCurrency(featureValueWinAmount + operationPrizeDelta);
        winBySourceUnits.featureValue += toMicroUnits(operationPrizeDelta);
      }
      emit("METER/LOGIC", { logicState: workingLogicState });
      const metersMap: Record<string, number> = {};
      for (const [mId, mState] of Object.entries(workingLogicState.metersById)) {
        metersMap[mId] = mState.currentValue;
      }
      meterValuesSnapshot = Object.freeze(metersMap);
      workingLogicState = ctx.logicEngine.clearSpinScope(workingLogicState);
    }

    if (playable && ctx.multiplierEngine && workingMultState) workingMultState = ctx.multiplierEngine.clearSpinState(workingMultState.multiplierState, workingMultState.valueState);
    if (playable && workingFeatureState) {
      featureUpgradesInRound = Math.max(featureUpgradesInRound, workingFeatureState.upgradeHistory.length - (featureState?.upgradeHistory.length ?? 0));
      featureRetriggersInRound = Math.max(featureRetriggersInRound, workingFeatureState.retriggerBatchCount - (featureState?.retriggerBatchCount ?? 0));
    }
    const rngSnapshotAfter = rng.snapshot();
    const drawsConsumed =
      rngSnapshotAfter.drawCount - rngSnapshotBefore.drawCount;

    const finalBoardSnapshot = retainBoardSnapshot
      ? extractBoardSymbolGrid(currentBoard)
      : undefined;

    const winBySource: Readonly<Record<WinSourceKind, number>> = Object.freeze({
      payline: fromMicroUnits(winBySourceUnits.payline),
      ways: fromMicroUnits(winBySourceUnits.ways),
      cluster: fromMicroUnits(winBySourceUnits.cluster),
      payAnywhere: fromMicroUnits(winBySourceUnits.payAnywhere),
      scatter: fromMicroUnits(winBySourceUnits.scatter),
      featureValue: fromMicroUnits(winBySourceUnits.featureValue),
    });

    const winningCombinationsCount =
      paylineWinCount +
      waysWinCount +
      clusterWinCount +
      payAnywhereWinCount +
      scatterWinCount +
      (featureValueWinAmount > 0 ? 1 : 0);

    const spin: SimulationSpin = deepFreeze({
      spinIndex,
      roundId,
      rngSnapshotBefore,
      rngSnapshotAfter,
      drawsConsumed,
      reelStops: reelResult.stopIndexes,
      wager: bet,
      win: totalSpinWin,
      netResult: roundCurrency(totalSpinWin - bet),
      winMultiplier: bet > 0 ? roundCurrency(totalSpinWin / bet) : 0,
      isWinningSpin: totalSpinWin > 0,
      baseGameWin: roundCurrency(totalSpinWin - featureWin),
      featureWin,
      winBySource,
      winningCombinationsCount,
      paylineWinCount,
      waysWinCount,
      clusterWinCount,
      payAnywhereWinCount,
      scatterWinCount,
      featureValueWinAmount,
      cascadeCount,
      cascadePayouts: Object.freeze(cascadePayouts),
      multiplierBefore,
      multiplierAfter,
      activeFeatureId: activeFeatureIdAtEnd,
      triggeredFeatureIds: Object.freeze(triggeredFeatureIds),
      featureSpinsPlayedInRound,
      featureRetriggersInRound,
      featureUpgradesInRound,
      ...(initialBoardSnapshot !== undefined
        ? { boardSnapshot: initialBoardSnapshot }
        : {}),
      ...(finalBoardSnapshot !== undefined
        ? { finalBoardSnapshot }
        : {}),
      ...(meterValuesSnapshot !== undefined
        ? { meterValues: meterValuesSnapshot }
        : {}),
      replayPackage,
    });

    emit("SETTLEMENT", { spin });
    emit("FINAL STATE", { board: currentBoard, boardState: workingBoardState, featureState: workingFeatureState, multiplierState: workingMultState?.multiplierState, valueState: workingMultState?.valueState, logicState: workingLogicState, rngState: rng.snapshot() });
    const nextMultiplierSnapshot =
      ctx.multiplierEngine && workingMultState
        ? ctx.multiplierEngine.snapshotState(
            workingMultState.multiplierState,
            workingMultState.valueState,
          )
        : undefined;

    return {
      board: currentBoard, boardState: workingBoardState, reelResult,
      spin,
      nextFeatureState: workingFeatureState,
      nextMultiplierSnapshot,
      nextLogicState: workingLogicState,
    };
  }

  private evaluateBoardAcrossActiveWinEngines(
    ctx: ActiveSimulationContext,
    board: Board,
    bet: number,
    includeScatters: boolean,
  ): {
    readonly wins: Readonly<Record<string, unknown>>;
    readonly totalWin: number;
    readonly paylineWin: number;
    readonly waysWin: number;
    readonly clusterWin: number;
    readonly payAnywhereWin: number;
    readonly scatterWin: number;
    readonly paylineWinCount: number;
    readonly waysWinCount: number;
    readonly clusterWinCount: number;
    readonly payAnywhereWinCount: number;
    readonly scatterWinCount: number;
    readonly winningPositions: readonly Position[];
  } {
    const { config } = ctx;
    const wins: Record<string, unknown> = {};
    const modes = ctx.winModes ?? [config.grid.evaluationMode];

    let paylineWin = 0;
    let waysWin = 0;
    let clusterWin = 0;
    let payAnywhereWin = 0;
    let scatterWin = 0;

    let paylineWinCount = 0;
    let waysWinCount = 0;
    let clusterWinCount = 0;
    let payAnywhereWinCount = 0;
    let scatterWinCount = 0;

    const winningPosMap = new Map<string, Position>();
    const addPos = (reelIndex: number, rowIndex: number): void => {
      const k = `${reelIndex}:${rowIndex}`;
      if (!winningPosMap.has(k)) {
        winningPosMap.set(k, Object.freeze({ reelIndex, rowIndex }));
      }
    };

    if (modes.includes("lines")) {
      const lineEval = ctx.winEvaluator.evaluate(board, {
        config,
        bet,
        activePaylineIds: ctx.activePaylineIds,
        roundMultiplier: 1,
        paytableResolver: ctx.paytableResolver,
      });

      wins.paylines = lineEval;
      for (const wl of lineEval.winLines) {
        if (wl.payout > 0) {
          paylineWin = roundCurrency(paylineWin + wl.payout);
          paylineWinCount += 1;
          for (const pos of wl.positions) {
            addPos(pos.reelIndex, pos.rowIndex);
          }
        }
      }
    }
    if (modes.includes("ways")) {
      const waysRes = ctx.waysEngine.evaluate(board, { bet });
      wins.ways = waysRes;
      waysWin = waysRes.totalPayout ?? 0;
      waysWinCount = waysRes.wins.length;
      for (const w of waysRes.wins) {
        for (const c of w.matchedCells) {
          addPos(c.reelIndex, c.rowIndex);
        }
      }
    }
    if (modes.includes("cluster")) {
      const clusterRes = ctx.clusterEngine.evaluate(board, config, {
        payoutContext: { bet },
      });
      wins.clusters = clusterRes;
      clusterWin = clusterRes.totalPayout ?? 0;
      clusterWinCount = clusterRes.qualifyingClusterCount;
      for (const c of clusterRes.winningCells) {
        addPos(c.reelIndex, c.rowIndex);
      }
    }
    if (modes.includes("pay_anywhere")) {
      const paRes = ctx.payAnywhereEngine.evaluate(board, config, {
        payoutContext: { bet },
      });
      wins.payAnywhere = paRes;
      payAnywhereWin = paRes.totalPayout ?? 0;
      payAnywhereWinCount = paRes.qualifyingWinCount;
      for (const w of paRes.wins) {
        for (const c of w.matchedCells) {
          addPos(c.reelIndex, c.rowIndex);
        }
      }
    }

    if (includeScatters && ctx.includeScatters !== false && config.scatterSymbolIds.size > 0) {
      const scatRes = ctx.scatterEngine.evaluate(board, { bet });
      wins.scatters = scatRes;
      scatterWin = scatRes.totalScatterPayout;
      scatterWinCount = scatRes.scatters.filter(
        (s) => s.eligible && s.payout > 0,
      ).length;
    }

    const totalWin = roundCurrency(
      paylineWin + waysWin + clusterWin + payAnywhereWin + scatterWin,
    );

    return {
      wins,
      totalWin,
      paylineWin,
      waysWin,
      clusterWin,
      payAnywhereWin,
      scatterWin,
      paylineWinCount,
      waysWinCount,
      clusterWinCount,
      payAnywhereWinCount,
      scatterWinCount,
      winningPositions: Object.freeze(Array.from(winningPosMap.values())),
    };
  }

  private compareBoardGrids(
    basePath: string,
    expectedGrid: readonly (readonly string[])[],
    actualGrid: readonly (readonly string[])[],
    diffs: VerificationDiffEntry[],
  ): void {
    if (expectedGrid.length !== actualGrid.length) {
      diffs.push(
        Object.freeze({
          kind: "boardMismatch",
          path: `${basePath}.columns`,
          expected: expectedGrid.length,
          actual: actualGrid.length,
          message: `Expected ${expectedGrid.length} columns in ${basePath}, received ${actualGrid.length}.`,
        }),
      );
      return;
    }

    for (let col = 0; col < expectedGrid.length; col += 1) {
      const expCol = expectedGrid[col]!;
      const actCol = actualGrid[col]!;
      if (expCol.length !== actCol.length) {
        diffs.push(
          Object.freeze({
            kind: "boardMismatch",
            path: `${basePath}[${col}].rows`,
            expected: expCol.length,
            actual: actCol.length,
            message: `Expected ${expCol.length} rows on reel ${col} in ${basePath}, received ${actCol.length}.`,
          }),
        );
        continue;
      }
      for (let row = 0; row < expCol.length; row += 1) {
        if (expCol[row] !== actCol[row]) {
          diffs.push(
            Object.freeze({
              kind: "symbolMismatch",
              path: `${basePath}[${col}][${row}]`,
              expected: expCol[row],
              actual: actCol[row],
              message: `Symbol mismatch at reel ${col}, row ${row}: expected "${expCol[row]}", received "${actCol[row]}".`,
            }),
          );
        }
      }
    }
  }
}

export function createMathSimulationEngine(options: MathSimulationEngineOptions = {}): DeterministicMathSimulationEngine {
  return new DeterministicMathSimulationEngine(options);
}

export function evaluateMathTargetCompliance(
  report: SimulationReport,
  target: MathTarget,
): MathCalibrationResult {
  return createMathSimulationEngine().evaluateTargetCompliance(report, target);
}
