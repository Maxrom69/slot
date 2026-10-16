/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — Runtime State Layer (GameSession, GameState, RoundState, FeatureState)
 *
 * Strictly separates mutable/advancing gameplay runtime state from immutable
 * GameConfig. All state objects are plain JSON-serializable structures with
 * zero embedded functions.
 */

import { EngineStateError } from "../errors";
import type { Board, Position } from "../board";
import type { FeatureId, GameConfig, PaylineId } from "../config";
import type { EvaluationResult } from "../evaluation";
import type { FeatureResult } from "../features";
import { roundCurrency } from "../paytable";
import type { ReelResult } from "../reels";
import type { SeedState } from "../rng";

export type RoundLifecycleStatus =
  | "idle"
  | "spinning"
  | "evaluated"
  | "complete";

export interface FeatureState {
  readonly activeFeatureId: FeatureId | null;
  readonly freeSpinsRemaining: number;
  readonly totalFreeSpinsAwarded: number;
  readonly currentMultiplier: number;
  readonly lockedPositions: readonly Position[];
  readonly cascadeCount: number;
  readonly pendingTransitions: readonly string[];
}

export interface RoundState {
  readonly roundId: string;
  readonly roundIndex: number;
  readonly bet: number;
  readonly activePaylineIds: readonly PaylineId[];
  readonly seed: string;
  readonly reelStops: readonly number[] | null;
  readonly board: Board | null;
  readonly totalWin: number;
  readonly status: RoundLifecycleStatus;
}

export interface GameState {
  readonly sessionId: string;
  readonly gameId: string;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly roundCounter: number;
  readonly balance: number;
  readonly currentBet: number;
  readonly currentBoard: Board | null;
  readonly currentReelStops: readonly number[] | null;
  readonly currentRound: RoundState | null;
  readonly featureState: FeatureState;
  readonly lastRngState: SeedState | null;
}

export interface GameSession {
  readonly sessionId: string;
  readonly config: GameConfig;
  readonly state: GameState;
}

export interface InitialStateOptions {
  readonly sessionId?: string;
  readonly initialBalance?: number;
  readonly initialBet?: number;
}

export function createInitialFeatureState(): FeatureState {
  return Object.freeze({
    activeFeatureId: null,
    freeSpinsRemaining: 0,
    totalFreeSpinsAwarded: 0,
    currentMultiplier: 1,
    lockedPositions: Object.freeze([]),
    cascadeCount: 0,
    pendingTransitions: Object.freeze([]),
  });
}

export function createInitialGameState(
  config: GameConfig,
  options: InitialStateOptions = {},
): GameState {
  const sessionId = options.sessionId ?? `session-${config.gameId}-1`;
  const balance = options.initialBalance ?? 1000;
  const currentBet = options.initialBet ?? config.math.defaultBet;

  return Object.freeze({
    sessionId,
    gameId: config.gameId,
    schemaVersion: config.schemaVersion,
    engineVersion: config.engineVersion,
    roundCounter: 0,
    balance: roundCurrency(balance),
    currentBet: roundCurrency(currentBet),
    currentBoard: null,
    currentReelStops: null,
    currentRound: null,
    featureState: createInitialFeatureState(),
    lastRngState: null,
  });
}

export function advanceStateForSpinStart(
  prevState: GameState,
  params: {
    readonly roundId: string;
    readonly bet: number;
    readonly activePaylineIds: readonly PaylineId[];
    readonly seed: string;
    readonly chargeWager?: boolean;
  },
): { readonly nextState: GameState; readonly roundState: RoundState } {
  const roundIndex = prevState.roundCounter + 1;
  const isFreeSpin = params.chargeWager === false || (params.chargeWager === undefined && prevState.featureState.freeSpinsRemaining > 0);
  const debitedBalance = isFreeSpin
    ? prevState.balance
    : applyBalanceDelta(prevState.balance, -params.bet);

  const roundState: RoundState = Object.freeze({
    roundId: params.roundId,
    roundIndex,
    bet: roundCurrency(params.bet),
    activePaylineIds: Object.freeze([...params.activePaylineIds]),
    seed: params.seed,
    reelStops: null,
    board: null,
    totalWin: 0,
    status: "spinning",
  });

  const nextState: GameState = Object.freeze({
    ...prevState,
    roundCounter: roundIndex,
    balance: debitedBalance,
    currentBet: roundCurrency(params.bet),
    currentRound: roundState,
  });

  return Object.freeze({ nextState, roundState });
}

export function commitSpinStateTransition(
  spinningState: GameState,
  roundState: RoundState,
  reelResult: ReelResult,
  board: Board,
  evaluation: EvaluationResult,
  featureResult: FeatureResult,
  finalRngState: SeedState,
): GameState {
  const prevFeature = spinningState.featureState;
  const consumedFreeSpin =
    prevFeature.freeSpinsRemaining > 0 ? prevFeature.freeSpinsRemaining - 1 : 0;
  const nextFreeSpinsRemaining =
    consumedFreeSpin + featureResult.totalFreeSpinsAwarded;
  const nextTotalFreeSpinsAwarded =
    prevFeature.totalFreeSpinsAwarded + featureResult.totalFreeSpinsAwarded;

  const nextActiveFeatureId =
    nextFreeSpinsRemaining > 0
      ? (featureResult.activatedFeatureId ?? prevFeature.activeFeatureId)
      : featureResult.triggers.length > 0
        ? featureResult.activatedFeatureId
        : null;

  const pendingTransitions: string[] = [];
  if (featureResult.triggers.length > 0 && prevFeature.activeFeatureId === null) {
    pendingTransitions.push("ENTER_FEATURE");
  } else if (prevFeature.freeSpinsRemaining > 0 && nextFreeSpinsRemaining === 0) {
    pendingTransitions.push("EXIT_FEATURE");
  }

  const nextFeatureState: FeatureState = Object.freeze({
    activeFeatureId: nextActiveFeatureId,
    freeSpinsRemaining: nextFreeSpinsRemaining,
    totalFreeSpinsAwarded: nextTotalFreeSpinsAwarded,
    currentMultiplier:
      nextActiveFeatureId !== null ? featureResult.nextMultiplier : 1,
    lockedPositions: prevFeature.lockedPositions,
    cascadeCount: 0,
    pendingTransitions: Object.freeze(pendingTransitions),
  });

  return commitSettledRound(spinningState, roundState, reelResult, board, evaluation.totalWin, nextFeatureState, finalRngState);
}

/** Shared exact fixed-point bankroll arithmetic for B01 and the playable runtime. */
export function applyBalanceDelta(balance: number, delta: number): number {
  const a = Math.round(balance * 10_000), b = Math.round(delta * 10_000);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || !Number.isSafeInteger(a + b) || a + b < 0) throw new EngineStateError("Invalid or overflowing bankroll transition.", { balance, delta });
  return (a + b) / 10_000;
}

/** Single authoritative credit boundary. Feature accounting is supplied by B12. */
export function commitSettledRound(
  spinningState: GameState, roundState: RoundState, reelResult: ReelResult,
  board: Board, award: number, featureState: FeatureState, finalRngState: SeedState,
): GameState {
  if (!Number.isFinite(award) || award < 0) throw new EngineStateError("Settlement award must be finite and non-negative.", { award });
  return Object.freeze({
    ...spinningState,
    balance: applyBalanceDelta(spinningState.balance, award),
    currentBoard: board, currentReelStops: reelResult.stopIndexes,
    currentRound: Object.freeze({ ...roundState, reelStops: reelResult.stopIndexes, board, totalWin: award, status: "complete" as const }),
    featureState, lastRngState: finalRngState,
  });
}

export function cloneGameState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
