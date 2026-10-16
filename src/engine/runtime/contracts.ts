/** B18 — headless, JSON-safe playable-session contracts reusing B01–B17 models. */
import type { GameState, GameSession } from "../state";
import type { GameBlueprint } from "@/lib/blueprint/types";
import type { GameDefinition } from "../schema";
import type { Board } from "../board";
import type { BoardState } from "../dynamics";
import type { FeatureRuntimeState, FeatureEngineConfiguration } from "../features";
import type { FeatureLogicState, MeterDefinition, FeatureCondition } from "../logic";
import type { MultiplierValueStateSnapshot } from "../multipliers";
import type { RngStateSnapshot, SeedInput, RngAlgorithmId } from "../rng";
import type { ExecutionObservation, MechanicOperation, SimulationMultiplierConfig, VerificationCase, SimulationSpin } from "../math";
import type { SpinResult } from "../core";
import type { SerializedEngineError } from "../errors";
import type { VerificationRun } from "../verification";

export type RuntimeDefinition = GameBlueprint | GameDefinition;
export type RuntimeOperation = MechanicOperation & { readonly scope: "step" | "round" | "session"; readonly modes?: readonly string[]; readonly featureIds?: readonly string[] };
/** Authored in GameBlueprint.extensions.backendRuntime, never in a spin request. */
export interface RuntimeMechanics {
  readonly version: 1;
  readonly featureConfig?: FeatureEngineConfiguration;
  readonly tumbleConfig?: VerificationCase["tumbleConfig"];
  readonly multiplierConfig?: SimulationMultiplierConfig;
  readonly meters?: readonly MeterDefinition[];
  readonly losingSpinCondition?: FeatureCondition;
  readonly operations?: readonly RuntimeOperation[];
  readonly currency?: { readonly code: string; readonly denomination: number };
}
export interface GameRuntimeConfig {
  /** Only trusted in-process test callers can construct a verification runtime. */
  readonly verificationMode?: boolean;
  readonly historyLimit?: number;
  readonly maxRequestsPerSession?: number;
  readonly maxSessions?: number;
  readonly maxLoadedGames?: number;
  readonly maxTransitionsPerStep?: number;
}
export interface RuntimeAccess { readonly ownerId: string; }
export interface RuntimeSessionConfig {
  readonly sessionId: string;
  readonly seed: SeedInput;
  readonly rngAlgorithm?: RngAlgorithmId;
  readonly initialBalance: number;
  readonly bet?: number;
  readonly definitionHash?: string;
}
export interface RuntimeSpinRequest {
  readonly requestId: string;
  /** Required so an old request cannot be reprocessed after a reset. */
  readonly epoch: number;
  readonly bet?: number;
}
export type RuntimeStatus = "created" | "ready" | "spinning" | "feature" | "settling" | "closed";
export type RuntimeNextAction = "startSession" | "spin" | "continueFeature" | "none";
export interface RuntimeState extends GameState {
  readonly definitionRevision: string;
  readonly definitionHash: string;
  readonly epoch: number;
  readonly status: RuntimeStatus;
  readonly nextAction: RuntimeNextAction;
  readonly startingBalance: number;
  readonly totalWagered: number;
  readonly totalAwarded: number;
  readonly netResult: number;
  readonly completedSpinCount: number;
  readonly gameMode: FeatureRuntimeState["currentMode"];
  readonly featureRuntimeState: FeatureRuntimeState;
  readonly boardState: BoardState | null;
  readonly multiplierSnapshot: MultiplierValueStateSnapshot;
  readonly logicState: FeatureLogicState;
  readonly rngState: RngStateSnapshot;
  readonly roundBet: number;
  readonly roundAwarded: number;
  readonly operationHistory: readonly string[];
}
export interface RuntimeGameDescriptor {
  readonly gameId: string;
  readonly definitionHash: string;
  readonly definitionRevision: string;
  readonly engineVersion: string;
  readonly betLevels: readonly number[];
  readonly currency: RuntimeMechanics["currency"] | null;
}
export interface RuntimeEvent {
  readonly sequence: number;
  readonly type: "SESSION_STARTED" | "SPIN_STARTED" | "WAGER_DEDUCTED" | "REELS_STOPPED" | "BOARD_RESOLVED" | "WIN_EVALUATED" | "CASCADE_STARTED" | "CASCADE_COMPLETED" | "FEATURE_ENTERED" | "FEATURE_STEP_COMPLETED" | "FEATURE_RETRIGGERED" | "FEATURE_UPGRADED" | "AWARD_SETTLED" | "SPIN_COMPLETED" | "SESSION_ENDED" | "RUNTIME_ERROR";
  readonly sessionId: string;
  readonly spinId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}
export interface RuntimeReplayRecord {
  readonly version: 1;
  readonly action: "spin" | "continueFeature";
  readonly request: RuntimeSpinRequest;
  readonly startingState: RuntimeState;
  readonly startingStateHash: string;
  readonly fixedStops?: readonly number[];
  readonly resultHash: string;
}
export interface RuntimeSettlement {
  readonly wager: number;
  readonly calculatedAward: number;
  readonly award: number;
  readonly capTrimmed: number;
  readonly capReached: boolean;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
}
export interface RuntimeSpinResult extends Pick<SpinResult, "gameId" | "engineVersion" | "board" | "reelResult" | "reelStops" | "totalPayout"> {
  readonly spinId: string;
  readonly sessionId: string;
  readonly spinIndex: number;
  readonly requestId: string;
  readonly action: "spin" | "continueFeature";
  readonly bet: number;
  readonly settlement: RuntimeSettlement;
  readonly statistics: SimulationSpin;
  readonly featureState: FeatureRuntimeState;
  readonly wins: readonly ExecutionObservation[];
  readonly transitions: readonly ExecutionObservation[];
  readonly events: readonly RuntimeEvent[];
  readonly nextAction: RuntimeNextAction;
  readonly status: RuntimeStatus;
  readonly startingStateReference: string;
  readonly finalStateReference: string;
  readonly replay: RuntimeReplayRecord;
}
export interface RuntimeSessionView extends Pick<GameSession, "sessionId"> {
  readonly game: RuntimeGameDescriptor;
  readonly state: RuntimeState;
  readonly lastResult: RuntimeSpinResult | null;
  readonly errors: readonly SerializedEngineError[];
  readonly events: readonly RuntimeEvent[];
}
export interface SessionSnapshot {
  readonly version: 1;
  readonly ownerId: string;
  readonly state: RuntimeState;
  readonly initialRngState: RngStateSnapshot;
  readonly initialBet: number;
  readonly history: readonly RuntimeSpinResult[];
  readonly lastResult: RuntimeSpinResult | null;
  readonly requests: readonly { readonly id: string; readonly hash: string; readonly spinId: string; readonly action: RuntimeReplayRecord["action"] }[];
  readonly errors: readonly SerializedEngineError[];
  readonly events: readonly RuntimeEvent[];
  readonly integrityHash: string;
}
export interface GameRuntime {
  loadGame(source: RuntimeDefinition): RuntimeGameDescriptor;
  createSession(gameId: string, config: RuntimeSessionConfig, access: RuntimeAccess): RuntimeSessionView;
  getSession(sessionId: string, access: RuntimeAccess): RuntimeSessionView;
  getSessionState(sessionId: string, access: RuntimeAccess): RuntimeState;
  startSession(sessionId: string, access: RuntimeAccess): RuntimeSessionView;
  spin(sessionId: string, request: RuntimeSpinRequest, access: RuntimeAccess): RuntimeSpinResult;
  continueFeature(sessionId: string, request: RuntimeSpinRequest, access: RuntimeAccess): RuntimeSpinResult;
  snapshotSession(sessionId: string, access: RuntimeAccess): SessionSnapshot;
  restoreSession(snapshot: SessionSnapshot, access: RuntimeAccess): RuntimeSessionView;
  replaySpin(sessionId: string, spinId: string, access: RuntimeAccess): RuntimeSpinResult;
  /** Replays the retained (possibly truncated) session history only. */
  replaySession(sessionId: string, access: RuntimeAccess): readonly RuntimeSpinResult[];
  resetSession(sessionId: string, access: RuntimeAccess): RuntimeSessionView;
  closeSession(sessionId: string, access: RuntimeAccess): RuntimeSessionView;
  getLastResult(sessionId: string, access: RuntimeAccess): RuntimeSpinResult | null;
  getHistory(sessionId: string, access: RuntimeAccess, options?: { readonly offset?: number; readonly limit?: number }): readonly RuntimeSpinResult[];
  verifyCase(gameId: string, c: VerificationCase): VerificationRun;
}
export type RuntimeBoard = Board;
