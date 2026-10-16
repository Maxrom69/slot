/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — Engine Core, Modular Spin Pipeline & SlotGameEngine Contract
 *
 * Implements the central SlotGameEngine abstraction and the replaceable,
 * independently testable 9-stage spin pipeline.
 * Pure TypeScript — zero React, DOM, Canvas, window, or Math.random() dependencies.
 */

import type { GameBlueprint } from "@/lib/blueprint/types";
import type { Board, BoardBuildContext, BoardBuilder } from "../board";
import { createBoardBuilder } from "../board";
import type { GameConfig, PaylineId } from "../config";
import { adaptBlueprintToGameConfig, isGameConfig } from "../config";
import type {
  DiagnosticEntry,
  DiagnosticsOptions,
  EngineDiagnosticsSink,
} from "../diagnostics";
import { createDiagnosticsCollector } from "../diagnostics";
import {
  EngineStateError,
  InvalidPaylineConfigError,
  InvalidSpinRequestError,
} from "../errors";
import type { EngineEvent } from "../events";
import { EngineEventBuffer } from "../events";
import type {
  EvaluationContext,
  EvaluationResult,
  WinCombination,
  WinEvaluator,
} from "../evaluation";
import { createWinEvaluator } from "../evaluation";
import type {
  FeatureExecutionContext,
  FeatureProcessor,
  FeatureResult,
  FeatureTrigger,
} from "../features";
import { createFeatureProcessor } from "../features";
import type { PaytableResolver } from "../paytable";
import { createPaytableResolver } from "../paytable";
import type {
  ReelResolutionContext,
  ReelResolver,
  ReelResult,
} from "../reels";
import { createReelResolver } from "../reels";
import type { SerializedSpinRequest, SpinReplayRecord } from "../replay";
import { createSpinReplayRecord } from "../replay";
import type {
  RandomNumberGenerator,
  RngFactory,
  SeedInput,
  SeedState,
} from "../rng";
import { DefaultRngFactory } from "../rng";
import type {
  GameSession,
  GameState,
  InitialStateOptions,
  RoundState,
} from "../state";
import {
  advanceStateForSpinStart,
  commitSpinStateTransition,
  createInitialGameState,
} from "../state";

export interface SpinRequest {
  readonly gameId: string;
  readonly seed?: SeedInput;
  readonly rng?: RandomNumberGenerator;
  readonly bet: number;
  readonly activePaylineIds?: readonly PaylineId[];
  readonly roundId?: string;
  readonly forcedStopIndexes?: readonly number[];
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface SpinResult {
  readonly request: SerializedSpinRequest;
  readonly gameId: string;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly roundId: string;
  readonly roundIndex: number;
  readonly seedState: {
    readonly seed: string;
    readonly initial: SeedState;
    readonly final: SeedState;
  };
  readonly reelResult: ReelResult;
  readonly reelStops: readonly number[];
  readonly board: Board;
  readonly evaluation: EvaluationResult;
  readonly wins: readonly WinCombination[];
  readonly totalPayout: number;
  readonly totalWinMultiplier: number;
  readonly featureTriggers: readonly FeatureTrigger[];
  readonly featureResult: FeatureResult;
  readonly events: readonly EngineEvent[];
  readonly nextState: GameState;
  readonly replay: SpinReplayRecord;
  readonly diagnostics: readonly DiagnosticEntry[];
}

export interface GameContext {
  readonly config: GameConfig;
  readonly state: GameState;
  readonly diagnostics: EngineDiagnosticsSink;
}

export interface ValidatedSpinContext {
  readonly roundId: string;
  readonly seed: string;
  readonly bet: number;
  readonly activePaylineIds: readonly PaylineId[];
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly serializedRequest: SerializedSpinRequest;
}

/**
 * Replaceable Spin Pipeline Stages.
 * Each stage is a pure/controlled function that can be tested independently
 * or overridden as advanced mechanics (B02+) are introduced.
 */
export interface SpinPipelineStages {
  validateRequest(
    config: GameConfig,
    state: GameState,
    request: SpinRequest,
    diagnostics: EngineDiagnosticsSink,
  ): ValidatedSpinContext;

  advanceRoundState(
    config: GameConfig,
    state: GameState,
    validated: ValidatedSpinContext,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ): { readonly spinningState: GameState; readonly roundState: RoundState };

  resolveRng(
    validated: ValidatedSpinContext,
    request: SpinRequest,
    rngFactory: RngFactory,
    diagnostics: EngineDiagnosticsSink,
  ): { readonly rng: RandomNumberGenerator; readonly initialRngState: SeedState };

  resolveReelStops(
    config: GameConfig,
    rng: RandomNumberGenerator,
    context: ReelResolutionContext,
    reelResolver: ReelResolver,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ): ReelResult;

  buildVisibleBoard(
    config: GameConfig,
    reelResult: ReelResult,
    context: BoardBuildContext | undefined,
    boardBuilder: BoardBuilder,
    diagnostics: EngineDiagnosticsSink,
  ): Board;

  evaluateWins(
    config: GameConfig,
    board: Board,
    context: EvaluationContext,
    winEvaluator: WinEvaluator,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ): EvaluationResult;

  resolveFeatures(
    config: GameConfig,
    board: Board,
    evaluation: EvaluationResult,
    context: FeatureExecutionContext,
    featureProcessor: FeatureProcessor,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ): FeatureResult;

  applyStateChanges(
    spinningState: GameState,
    roundState: RoundState,
    reelResult: ReelResult,
    board: Board,
    evaluation: EvaluationResult,
    featureResult: FeatureResult,
    finalRngState: SeedState,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ): GameState;
}

export const defaultSpinPipelineStages: SpinPipelineStages = Object.freeze({
  validateRequest(
    config: GameConfig,
    state: GameState,
    request: SpinRequest,
    diagnostics: EngineDiagnosticsSink,
  ): ValidatedSpinContext {
    if (!request || typeof request !== "object") {
      throw new InvalidSpinRequestError("SpinRequest must be an object.");
    }
    if (!request.gameId || request.gameId !== config.gameId) {
      throw new InvalidSpinRequestError(
        `SpinRequest gameId "${String(request.gameId)}" does not match initialized engine gameId "${config.gameId}".`,
        { expectedGameId: config.gameId, actualGameId: request.gameId },
      );
    }
    if (
      typeof request.bet !== "number" ||
      !Number.isFinite(request.bet) ||
      request.bet <= 0
    ) {
      throw new InvalidSpinRequestError(
        `SpinRequest bet must be a positive finite number, received ${String(request.bet)}.`,
        { bet: request.bet },
      );
    }

    const isFreeSpin = state.featureState.freeSpinsRemaining > 0;
    if (!isFreeSpin && state.balance < request.bet) {
      throw new InvalidSpinRequestError(
        `Insufficient balance (${state.balance}) for bet (${request.bet}).`,
        { balance: state.balance, bet: request.bet },
      );
    }

    if (request.seed === undefined && !request.rng) {
      throw new InvalidSpinRequestError(
        "SpinRequest must provide either a deterministic seed or a RandomNumberGenerator instance.",
      );
    }

    const seedString =
      request.seed !== undefined
        ? String(request.seed)
        : request.rng!.getState().originalSeed;

    if (seedString.trim().length === 0) {
      throw new InvalidSpinRequestError("SpinRequest seed must not be empty.", {
        seed: request.seed,
      });
    }

    let activePaylineIds: readonly PaylineId[];
    if (request.activePaylineIds) {
      if (
        config.grid.evaluationMode === "lines" &&
        request.activePaylineIds.length === 0
      ) {
        throw new InvalidPaylineConfigError(
          "Line-evaluated spins require at least one active payline ID.",
        );
      }
      for (const lineId of request.activePaylineIds) {
        if (!config.paylinesById.has(lineId)) {
          throw new InvalidPaylineConfigError(
            `SpinRequest references unknown payline ID "${lineId}".`,
            { paylineId: lineId },
          );
        }
      }
      activePaylineIds = Object.freeze([...request.activePaylineIds]);
    } else {
      activePaylineIds = Object.freeze(
        config.activePaylines.map((line) => line.id),
      );
    }

    const nextRoundIndex = state.roundCounter + 1;
    const roundId =
      request.roundId && request.roundId.trim().length > 0
        ? request.roundId
        : `round-${config.gameId}-${nextRoundIndex}`;
    const metadata = Object.freeze({ ...(request.metadata ?? {}) });

    const serializedRequest: SerializedSpinRequest = Object.freeze({
      gameId: config.gameId,
      seed: seedString,
      bet: request.bet,
      activePaylineIds,
      roundId,
      metadata,
    });

    diagnostics.record(
      "debug",
      "VALIDATE_REQUEST",
      "REQUEST_VALIDATED",
      `Validated spin request for round "${roundId}".`,
      {
        roundId,
        bet: request.bet,
        paylineCount: activePaylineIds.length,
      },
    );

    return Object.freeze({
      roundId,
      seed: seedString,
      bet: request.bet,
      activePaylineIds,
      metadata,
      serializedRequest,
    });
  },

  advanceRoundState(
    _config: GameConfig,
    state: GameState,
    validated: ValidatedSpinContext,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ) {
    const { nextState: spinningState, roundState } = advanceStateForSpinStart(
      state,
      {
        roundId: validated.roundId,
        bet: validated.bet,
        activePaylineIds: validated.activePaylineIds,
        seed: validated.seed,
      },
    );

    events.emit("SPIN_STARTED", {
      roundId: roundState.roundId,
      roundIndex: roundState.roundIndex,
      bet: roundState.bet,
      balanceAfterDebit: spinningState.balance,
      activePaylineCount: validated.activePaylineIds.length,
    });

    diagnostics.record(
      "debug",
      "ADVANCE_ROUND",
      "ROUND_STARTED",
      `Advanced round counter to ${roundState.roundIndex}.`,
      {
        roundId: roundState.roundId,
        roundIndex: roundState.roundIndex,
        balanceAfterDebit: spinningState.balance,
      },
    );

    return Object.freeze({ spinningState, roundState });
  },

  resolveRng(
    validated: ValidatedSpinContext,
    request: SpinRequest,
    rngFactory: RngFactory,
    diagnostics: EngineDiagnosticsSink,
  ) {
    const rng = request.rng
      ? (request.rng.clone() as RandomNumberGenerator)
      : rngFactory.createFromSeed(validated.seed);
    const initialRngState = rng.getState();

    diagnostics.record(
      "debug",
      "RESOLVE_RNG",
      "RNG_INITIALIZED",
      `Initialized RNG stream (${rng.algorithm}).`,
      {
        algorithm: rng.algorithm,
        seed: initialRngState.originalSeed,
        internalState: initialRngState.internalState,
      },
    );

    return Object.freeze({ rng, initialRngState });
  },

  resolveReelStops(
    config: GameConfig,
    rng: RandomNumberGenerator,
    context: ReelResolutionContext,
    reelResolver: ReelResolver,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ): ReelResult {
    const reelResult = reelResolver.resolveReels(config, rng, context);

    events.emit("REELS_STOPPED", {
      stopIndexes: reelResult.stopIndexes,
      stopPositions: reelResult.stopPositions,
    });

    diagnostics.record(
      "debug",
      "RESOLVE_REELS",
      "REELS_RESOLVED",
      `Resolved ${reelResult.stopIndexes.length} reel stops.`,
      {
        stops: reelResult.stopIndexes.join(","),
      },
    );

    return reelResult;
  },

  buildVisibleBoard(
    config: GameConfig,
    reelResult: ReelResult,
    context: BoardBuildContext | undefined,
    boardBuilder: BoardBuilder,
    diagnostics: EngineDiagnosticsSink,
  ): Board {
    const board = boardBuilder.buildBoard(config, reelResult, context);

    diagnostics.record(
      "debug",
      "BUILD_BOARD",
      "BOARD_BUILT",
      `Constructed ${board.columns}x${board.rows} visible board.`,
      {
        columns: board.columns,
        rows: board.rows,
      },
    );

    return board;
  },

  evaluateWins(
    _config: GameConfig,
    board: Board,
    context: EvaluationContext,
    winEvaluator: WinEvaluator,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ): EvaluationResult {
    const evaluation = winEvaluator.evaluate(board, context);

    if (evaluation.combinations.length > 0) {
      events.emit("WIN_DETECTED", {
        winCount: evaluation.combinations.length,
        totalWin: evaluation.totalWin,
        totalWinMultiplier: evaluation.totalWinMultiplier,
      });
      events.emit("PAYOUT_AWARDED", {
        amount: evaluation.totalWin,
        multiplier: evaluation.totalWinMultiplier,
      });
    }

    diagnostics.record(
      "debug",
      "EVALUATE_WINS",
      "WINS_EVALUATED",
      `Evaluated board (${evaluation.combinations.length} winning combinations, payout=${evaluation.totalWin}).`,
      {
        winCount: evaluation.combinations.length,
        totalWin: evaluation.totalWin,
      },
    );

    return evaluation;
  },

  resolveFeatures(
    _config: GameConfig,
    board: Board,
    evaluation: EvaluationResult,
    context: FeatureExecutionContext,
    featureProcessor: FeatureProcessor,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ): FeatureResult {
    const featureResult = featureProcessor.processFeatures(
      board,
      evaluation,
      context,
    );

    for (const trigger of featureResult.triggers) {
      events.emit("FEATURE_TRIGGERED", {
        featureId: trigger.featureId,
        featureName: trigger.featureName,
        kind: trigger.kind,
        triggerSymbolId: trigger.triggerSymbolId,
        triggerCount: trigger.triggerCount,
        awardedFreeSpins: trigger.awardedFreeSpins,
      });
    }

    if (
      context.currentActiveFeatureId === null &&
      featureResult.activatedFeatureId !== null
    ) {
      events.emit("FEATURE_STARTED", {
        featureId: featureResult.activatedFeatureId,
        freeSpinsAwarded: featureResult.totalFreeSpinsAwarded,
        multiplier: featureResult.nextMultiplier,
      });
    }

    diagnostics.record(
      "debug",
      "RESOLVE_FEATURES",
      "FEATURES_RESOLVED",
      `Processed feature triggers (${featureResult.triggers.length} triggered).`,
      {
        triggerCount: featureResult.triggers.length,
        freeSpinsAwarded: featureResult.totalFreeSpinsAwarded,
      },
    );

    return featureResult;
  },

  applyStateChanges(
    spinningState: GameState,
    roundState: RoundState,
    reelResult: ReelResult,
    board: Board,
    evaluation: EvaluationResult,
    featureResult: FeatureResult,
    finalRngState: SeedState,
    events: EngineEventBuffer,
    diagnostics: EngineDiagnosticsSink,
  ): GameState {
    const prevActiveFeatureId = spinningState.featureState.activeFeatureId;
    const nextState = commitSpinStateTransition(
      spinningState,
      roundState,
      reelResult,
      board,
      evaluation,
      featureResult,
      finalRngState,
    );

    if (
      prevActiveFeatureId !== null &&
      nextState.featureState.activeFeatureId === null
    ) {
      events.emit("FEATURE_ENDED", {
        featureId: prevActiveFeatureId,
      });
    }

    events.emit("ROUND_COMPLETE", {
      roundId: roundState.roundId,
      roundIndex: roundState.roundIndex,
      totalPayout: evaluation.totalWin,
      finalBalance: nextState.balance,
    });

    diagnostics.record(
      "debug",
      "APPLY_STATE",
      "STATE_COMMITTED",
      `Committed state transition for round ${roundState.roundIndex}.`,
      {
        roundIndex: roundState.roundIndex,
        finalBalance: nextState.balance,
      },
    );

    return nextState;
  },
});

export interface EngineInitOptions extends InitialStateOptions {
  readonly diagnostics?: DiagnosticsOptions;
}

export interface SlotGameEngineDependencies {
  readonly rngFactory?: RngFactory;
  readonly reelResolver?: ReelResolver;
  readonly boardBuilder?: BoardBuilder;
  readonly paytableResolver?: PaytableResolver;
  readonly winEvaluator?: WinEvaluator;
  readonly featureProcessor?: FeatureProcessor;
  readonly pipeline?: Partial<SpinPipelineStages>;
  readonly diagnostics?: DiagnosticsOptions;
}

export interface SlotGameEngine {
  initialize(
    blueprintOrConfig: GameBlueprint | GameConfig,
    options?: EngineInitOptions,
  ): GameSession;
  spin(request: SpinRequest): SpinResult;
  evaluate(
    board: Board,
    context?: Partial<Omit<EvaluationContext, "config">>,
  ): EvaluationResult;
  getState(): GameState;
  getConfig(): GameConfig;
}

export class DefaultSlotGameEngine implements SlotGameEngine {
  private readonly rngFactory: RngFactory;
  private readonly reelResolver: ReelResolver;
  private readonly boardBuilder: BoardBuilder;
  private readonly paytableResolver: PaytableResolver;
  private readonly winEvaluator: WinEvaluator;
  private readonly featureProcessor: FeatureProcessor;
  private readonly pipeline: SpinPipelineStages;
  private diagnosticsOptions: DiagnosticsOptions;

  private config: GameConfig | null = null;
  private state: GameState | null = null;

  constructor(dependencies: SlotGameEngineDependencies = {}) {
    this.rngFactory = dependencies.rngFactory ?? new DefaultRngFactory();
    this.reelResolver = dependencies.reelResolver ?? createReelResolver();
    this.boardBuilder = dependencies.boardBuilder ?? createBoardBuilder();
    this.paytableResolver =
      dependencies.paytableResolver ?? createPaytableResolver();
    this.winEvaluator = dependencies.winEvaluator ?? createWinEvaluator();
    this.featureProcessor =
      dependencies.featureProcessor ?? createFeatureProcessor();
    this.pipeline = Object.freeze({
      ...defaultSpinPipelineStages,
      ...(dependencies.pipeline ?? {}),
    });
    this.diagnosticsOptions = dependencies.diagnostics ?? { enabled: false };
  }

  public initialize(
    blueprintOrConfig: GameBlueprint | GameConfig,
    options: EngineInitOptions = {},
  ): GameSession {
    if (options.diagnostics) {
      this.diagnosticsOptions = options.diagnostics;
    }

    const normalizedConfig = isGameConfig(blueprintOrConfig)
      ? blueprintOrConfig
      : adaptBlueprintToGameConfig(blueprintOrConfig);

    const initialState = createInitialGameState(normalizedConfig, options);

    this.config = normalizedConfig;
    this.state = initialState;

    return Object.freeze({
      sessionId: initialState.sessionId,
      config: normalizedConfig,
      state: initialState,
    });
  }

  public getConfig(): GameConfig {
    if (!this.config) {
      throw new EngineStateError(
        "SlotGameEngine has not been initialized. Call initialize(blueprint) before accessing config.",
      );
    }
    return this.config;
  }

  public getState(): GameState {
    if (!this.state) {
      throw new EngineStateError(
        "SlotGameEngine has not been initialized. Call initialize(blueprint) before accessing state.",
      );
    }
    return this.state;
  }

  public evaluate(
    board: Board,
    context: Partial<Omit<EvaluationContext, "config">> = {},
  ): EvaluationResult {
    const config = this.getConfig();
    const state = this.getState();

    return this.winEvaluator.evaluate(board, {
      config,
      bet: context.bet ?? state.currentBet,
      activePaylineIds: context.activePaylineIds,
      roundMultiplier:
        context.roundMultiplier ?? state.featureState.currentMultiplier,
      paytableResolver: context.paytableResolver ?? this.paytableResolver,
    });
  }

  public spin(request: SpinRequest): SpinResult {
    const config = this.getConfig();
    const currentState = this.getState();
    const diagnostics = createDiagnosticsCollector(this.diagnosticsOptions);

    // Stage 1: Validate Request
    const validated = this.pipeline.validateRequest(
      config,
      currentState,
      request,
      diagnostics,
    );

    const events = new EngineEventBuffer(
      config.gameId,
      validated.roundId,
      currentState.roundCounter + 1,
    );

    // Stage 2: Create / Advance Round State
    const { spinningState, roundState } = this.pipeline.advanceRoundState(
      config,
      currentState,
      validated,
      events,
      diagnostics,
    );

    // Stage 3: Resolve RNG
    const { rng, initialRngState } = this.pipeline.resolveRng(
      validated,
      request,
      this.rngFactory,
      diagnostics,
    );

    // Stage 4: Resolve Reel Stops
    const reelResult = this.pipeline.resolveReelStops(
      config,
      rng,
      {
        roundId: roundState.roundId,
        forcedStopIndexes: request.forcedStopIndexes,
      },
      this.reelResolver,
      events,
      diagnostics,
    );

    // Stage 5: Build Visible Board
    const board = this.pipeline.buildVisibleBoard(
      config,
      reelResult,
      undefined,
      this.boardBuilder,
      diagnostics,
    );

    // Stage 6: Evaluate Wins
    const evaluation = this.pipeline.evaluateWins(
      config,
      board,
      {
        config,
        bet: roundState.bet,
        activePaylineIds: roundState.activePaylineIds,
        roundMultiplier: spinningState.featureState.currentMultiplier,
        paytableResolver: this.paytableResolver,
      },
      this.winEvaluator,
      events,
      diagnostics,
    );

    // Stage 7: Resolve Features
    const featureResult = this.pipeline.resolveFeatures(
      config,
      board,
      evaluation,
      {
        config,
        currentActiveFeatureId: spinningState.featureState.activeFeatureId,
        currentFreeSpinsRemaining: spinningState.featureState.freeSpinsRemaining,
        currentMultiplier: spinningState.featureState.currentMultiplier,
      },
      this.featureProcessor,
      events,
      diagnostics,
    );

    // Stage 8: Apply State Changes
    const finalRngState = rng.getState();
    const nextState = this.pipeline.applyStateChanges(
      spinningState,
      roundState,
      reelResult,
      board,
      evaluation,
      featureResult,
      finalRngState,
      events,
      diagnostics,
    );

    this.state = nextState;

    // Stage 9: Produce SpinResult & Replay Record
    const replay = createSpinReplayRecord({
      schemaVersion: config.schemaVersion,
      engineVersion: config.engineVersion,
      gameId: config.gameId,
      seed: validated.seed,
      initialRngState,
      finalRngState,
      request: validated.serializedRequest,
      outcomeSnapshot: {
        reelStops: reelResult.stopIndexes,
        totalPayout: evaluation.totalWin,
        totalWinMultiplier: evaluation.totalWinMultiplier,
        winCount: evaluation.combinations.length,
        featureTriggerCount: featureResult.triggers.length,
      },
    });

    diagnostics.record(
      "info",
      "PRODUCE_RESULT",
      "SPIN_COMPLETED",
      `Completed spin for round "${roundState.roundId}".`,
      {
        roundId: roundState.roundId,
        totalPayout: evaluation.totalWin,
      },
    );

    return Object.freeze({
      request: validated.serializedRequest,
      gameId: config.gameId,
      schemaVersion: config.schemaVersion,
      engineVersion: config.engineVersion,
      roundId: roundState.roundId,
      roundIndex: roundState.roundIndex,
      seedState: Object.freeze({
        seed: validated.seed,
        initial: initialRngState,
        final: finalRngState,
      }),
      reelResult,
      reelStops: reelResult.stopIndexes,
      board,
      evaluation,
      wins: evaluation.combinations,
      totalPayout: evaluation.totalWin,
      totalWinMultiplier: evaluation.totalWinMultiplier,
      featureTriggers: featureResult.triggers,
      featureResult,
      events: events.getEvents(),
      nextState,
      replay,
      diagnostics: diagnostics.getEntries(),
    });
  }
}

export function createSlotGameEngine(
  dependencies?: SlotGameEngineDependencies,
): SlotGameEngine {
  return new DefaultSlotGameEngine(dependencies);
}

/**
 * Frontend/Service integration boundary: creates and initializes a headless
 * SlotGameEngine instance directly from a GameBlueprint.
 */
export function createEngineFromBlueprint(
  blueprint: GameBlueprint,
  options: EngineInitOptions & SlotGameEngineDependencies = {},
): {
  readonly engine: SlotGameEngine;
  readonly session: GameSession;
  readonly config: GameConfig;
} {
  const engine = createSlotGameEngine(options);
  const session = engine.initialize(blueprint, options);
  return Object.freeze({
    engine,
    session,
    config: session.config,
  });
}
