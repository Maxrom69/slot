/** B18 — isolated, transactional, deterministic playable sessions. No game rules here. */
import { createMathSimulationEngine, type ExecutionObservation, type VerificationCase } from "../math";
import { createFeatureEngine } from "../features";
import { createFeatureLogicEngine } from "../logic";
import { createMultiplierValueEngine } from "../multipliers";
import { createBoardDynamicsEngine } from "../dynamics";
import { createSeededRng } from "../rng";
import { RuntimeError, SlotEngineError } from "../errors";
import { advanceStateForSpinStart, applyBalanceDelta, commitSettledRound, createInitialGameState } from "../state";
import { createVerificationEngine, fingerprintVerificationData } from "../verification";
import { compileRuntimeGame, immutable, validMoney, type LoadedRuntimeGame } from "./configuration";
import type { GameRuntime, GameRuntimeConfig, RuntimeAccess, RuntimeDefinition, RuntimeEvent, RuntimeGameDescriptor, RuntimeReplayRecord, RuntimeSessionConfig, RuntimeSessionView, RuntimeSpinRequest, RuntimeSpinResult, RuntimeState, SessionSnapshot } from "./contracts";
export * from "./contracts";

interface SessionEntry {
  ownerId: string;
  game: LoadedRuntimeGame;
  state: RuntimeState;
  initialRngState: RuntimeState["rngState"];
  initialBet: number;
  history: RuntimeSpinResult[];
  lastResult: RuntimeSpinResult | null;
  requests: Map<string, { hash: string; spinId: string; action: RuntimeReplayRecord["action"] }>;
  errors: RuntimeSessionView["errors"];
  events: readonly RuntimeEvent[];
}
const hash = fingerprintVerificationData;
function requireId(id: string, field: string): void {
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)) throw new RuntimeError("RUNTIME_INVALID_REQUEST", `Invalid ${field}.`, { field });
}
function event(sessionId: string, type: RuntimeEvent["type"], sequence: number, payload: Record<string, unknown>, spinId: string | null = null): RuntimeEvent {
  return { sessionId, type, sequence, spinId, payload };
}

export class DeterministicGameRuntime implements GameRuntime {
  private readonly games = new Map<string, LoadedRuntimeGame>();
  private readonly latest = new Map<string, string>();
  private readonly sessions = new Map<string, SessionEntry>();
  /** Only snapshots issued by this local runtime may be restored from untrusted callers. */
  private readonly issuedSnapshots = new Map<string, { ownerId: string; sessionId: string; data: string }>();
  private readonly options: Required<GameRuntimeConfig>;
  constructor(options: GameRuntimeConfig = {}) {
    this.options = { verificationMode: false, historyLimit: 32, maxRequestsPerSession: 10000, maxSessions: 64, maxLoadedGames: 64, maxTransitionsPerStep: 512, ...options };
    if (typeof this.options.verificationMode !== "boolean") throw new RuntimeError("RUNTIME_INVALID_CONFIG", "verificationMode must be an explicit boolean.");
    for (const key of ["historyLimit", "maxRequestsPerSession", "maxSessions", "maxLoadedGames", "maxTransitionsPerStep"] as const) if (!Number.isSafeInteger(this.options[key]) || this.options[key] < (key === "historyLimit" ? 0 : 1) || this.options[key] > 100000) throw new RuntimeError("RUNTIME_INVALID_CONFIG", `Invalid ${key}.`);
  }
  public loadGame(source: RuntimeDefinition): RuntimeGameDescriptor {
    const game = compileRuntimeGame(source);
    const key = `${game.descriptor.gameId}:${game.descriptor.definitionHash}`;
    requireId(game.descriptor.gameId, "gameId");
    const previous = this.games.get(key);
    if (previous && JSON.stringify(previous.source) !== JSON.stringify(game.source)) throw new RuntimeError("RUNTIME_INVALID_CONFIG", "Definition fingerprint collision or noncanonical reload; do not overwrite a pinned game.");
    if (!previous && this.games.size >= this.options.maxLoadedGames) throw new RuntimeError("RUNTIME_LIMIT_EXCEEDED", "Loaded game revision limit reached.");
    this.games.set(key, game); this.latest.set(game.descriptor.gameId, key);
    return immutable(game.descriptor);
  }
  private game(gameId: string, definitionHash?: string): LoadedRuntimeGame {
    requireId(gameId, "gameId");
    const key = definitionHash ? `${gameId}:${definitionHash}` : this.latest.get(gameId);
    const game = key ? this.games.get(key) : undefined;
    if (!game) throw new RuntimeError("RUNTIME_INVALID_CONFIG", "Game revision has not been loaded.", { gameId, definitionHash });
    return game;
  }
  private entry(id: string, access: RuntimeAccess): SessionEntry {
    requireId(id, "sessionId"); requireId(access?.ownerId, "ownerId");
    const entry = this.sessions.get(id);
    if (!entry || entry.ownerId !== access.ownerId) throw new RuntimeError("RUNTIME_SESSION_NOT_FOUND", "Session not found in this local owner scope.");
    return entry;
  }
  private view(entry: SessionEntry): RuntimeSessionView { return immutable({ sessionId: entry.state.sessionId, game: entry.game.descriptor, state: entry.state, lastResult: entry.lastResult, errors: entry.errors, events: entry.events }); }
  private initial(game: LoadedRuntimeGame, config: RuntimeSessionConfig, epoch = 0, rngState = createSeededRng(config.seed, { algorithm: config.rngAlgorithm }).snapshot()): RuntimeState {
    validMoney(config.initialBalance, "initialBalance");
    const bet = config.bet ?? game.config.math.defaultBet;
    this.validateBet(game, bet);
    const featureRuntimeState = createFeatureEngine(game.mechanics.featureConfig!).createInitialState();
    const logic = createFeatureLogicEngine(); let logicState = logic.createInitialState();
    for (const meter of game.mechanics.meters ?? []) logicState = logic.initializeMeter(logicState, meter).nextState;
    const mult = createMultiplierValueEngine(), initial = mult.createInitialState();
    return immutable({ ...createInitialGameState(game.config, { sessionId: config.sessionId, initialBalance: config.initialBalance, initialBet: bet }), definitionRevision: game.descriptor.definitionRevision, definitionHash: game.descriptor.definitionHash, epoch, status: "created", nextAction: "startSession", startingBalance: config.initialBalance, totalWagered: 0, totalAwarded: 0, netResult: 0, completedSpinCount: 0, gameMode: "base", featureRuntimeState, boardState: null, multiplierSnapshot: mult.snapshotState(initial.multiplierState, initial.valueState), logicState, rngState, roundBet: bet, roundAwarded: 0, operationHistory: [] });
  }
  private validateBet(game: LoadedRuntimeGame, bet: number): void {
    if (!game.config.math.betLevels.includes(bet)) throw new RuntimeError("RUNTIME_INVALID_BET", "Bet is not a configured game level.", { bet, available: game.config.math.betLevels });
    validMoney(bet, "bet", true);
  }
  public createSession(gameId: string, config: RuntimeSessionConfig, access: RuntimeAccess): RuntimeSessionView {
    requireId(config?.sessionId, "sessionId"); requireId(access?.ownerId, "ownerId");
    if (this.sessions.has(config.sessionId)) throw new RuntimeError("RUNTIME_INVALID_REQUEST", "Session ID is already in use.");
    if (this.sessions.size >= this.options.maxSessions) throw new RuntimeError("RUNTIME_LIMIT_EXCEEDED", "Runtime session limit reached.");
    const game = this.game(gameId, config.definitionHash), state = this.initial(game, config);
    const entry: SessionEntry = { ownerId: access.ownerId, game, state, initialRngState: state.rngState, initialBet: state.currentBet, history: [], lastResult: null, requests: new Map(), errors: [], events: [] };
    this.sessions.set(config.sessionId, entry); return this.view(entry);
  }
  public getSession(id: string, access: RuntimeAccess): RuntimeSessionView { return this.view(this.entry(id, access)); }
  public getSessionState(id: string, access: RuntimeAccess): RuntimeState { return this.getSession(id, access).state; }
  public startSession(id: string, access: RuntimeAccess): RuntimeSessionView {
    const entry = this.entry(id, access);
    if (entry.state.status === "closed") throw new RuntimeError("RUNTIME_INVALID_TRANSITION", "Closed sessions must be reset before starting.");
    if (entry.state.status === "created") {
      entry.state = immutable({ ...entry.state, status: "ready", nextAction: "spin" });
      entry.events = immutable([event(id, "SESSION_STARTED", 0, { epoch: entry.state.epoch })]);
    }
    return this.view(entry);
  }
  public spin(id: string, request: RuntimeSpinRequest, access: RuntimeAccess): RuntimeSpinResult { return this.submit(id, request, access, "spin"); }
  public continueFeature(id: string, request: RuntimeSpinRequest, access: RuntimeAccess): RuntimeSpinResult { return this.submit(id, request, access, "continueFeature"); }
  public spinForVerification(id: string, request: RuntimeSpinRequest, access: RuntimeAccess, fixedStops: readonly number[]): RuntimeSpinResult {
    if (!this.options.verificationMode) throw new RuntimeError("RUNTIME_FORBIDDEN", "Fixed stops require a trusted verification runtime.");
    const entry = this.entry(id, access);
    return this.submit(id, request, access, entry.requests.get(request.requestId)?.action ?? (entry.state.nextAction === "continueFeature" ? "continueFeature" : "spin"), fixedStops);
  }
  public verifyCase(gameId: string, c: VerificationCase) {
    if (!this.options.verificationMode) throw new RuntimeError("RUNTIME_FORBIDDEN", "B17 verification is not enabled.");
    return createVerificationEngine().runCase(this.game(gameId).source, c);
  }
  private submit(id: string, supplied: RuntimeSpinRequest, access: RuntimeAccess, action: RuntimeReplayRecord["action"], fixedStops?: readonly number[]): RuntimeSpinResult {
    const entry = this.entry(id, access);
    if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new RuntimeError("RUNTIME_INVALID_REQUEST", "Spin request must be an object.");
    for (const key of Object.keys(supplied)) if (!["requestId","epoch","bet"].includes(key)) throw new RuntimeError("RUNTIME_FORBIDDEN", "Spin requests cannot supply stops, seeds, mechanics or runtime state.", { key });
    requireId(supplied.requestId, "requestId");
    if (!Number.isSafeInteger(supplied.epoch) || supplied.epoch !== entry.state.epoch) throw new RuntimeError("RUNTIME_INVALID_TRANSITION", "Request belongs to a stale session epoch.");
    const request = immutable(supplied), requestHash = hash({ action, request, fixedStops: fixedStops ?? null });
    const previous = entry.requests.get(request.requestId);
    if (previous) {
      if (previous.hash !== requestHash) throw new RuntimeError("RUNTIME_IDEMPOTENCY_CONFLICT", "Request ID was already used with different inputs.");
      const result = entry.lastResult?.spinId === previous.spinId ? entry.lastResult : entry.history.find((r) => r.spinId === previous.spinId);
      if (!result) throw new RuntimeError("RUNTIME_RESULT_EXPIRED", "Request already completed; result has expired from retained history. It will not be processed again.", { spinId: previous.spinId });
      return immutable(result);
    }
    if (entry.state.nextAction !== action) throw new RuntimeError("RUNTIME_INVALID_TRANSITION", "Action is not permitted in the current state.", { status: entry.state.status, nextAction: entry.state.nextAction });
    if (entry.requests.size >= this.options.maxRequestsPerSession) throw new RuntimeError("RUNTIME_LIMIT_EXCEEDED", "Request ledger is full; reset this Playtest session.");
    try {
      const { state, result } = this.perform(entry.game, entry.state, request, action, fixedStops);
      // Atomic commit: no session/RNG/balance changes before all stages succeed.
      entry.state = state; entry.lastResult = result; entry.events = result.events;
      entry.requests.set(request.requestId, { hash: requestHash, spinId: result.spinId, action });
      entry.history = this.options.historyLimit ? [...entry.history, result].slice(-this.options.historyLimit) : [];
      return immutable(result);
    } catch (cause) {
      const error = cause instanceof RuntimeError ? cause : new RuntimeError("RUNTIME_EXECUTION_FAILED", "Spin aborted; pre-spin bankroll, RNG and gameplay state were preserved.", { requestId: request.requestId, cause: cause instanceof SlotEngineError ? cause.toJSON() : String(cause) });
      entry.errors = immutable([...entry.errors, error.toJSON()].slice(-16));
      entry.events = immutable([event(id, "RUNTIME_ERROR", 0, { error: error.toJSON(), requestId: request.requestId })]);
      throw error;
    }
  }
  private perform(game: LoadedRuntimeGame, before: RuntimeState, request: RuntimeSpinRequest, action: RuntimeReplayRecord["action"], fixedStops?: readonly number[]): { state: RuntimeState; result: RuntimeSpinResult } {
    const base = action === "spin", bet = base ? request.bet ?? before.currentBet : before.roundBet;
    this.validateBet(game, bet);
    if (!base && request.bet !== undefined && request.bet !== bet) throw new RuntimeError("RUNTIME_INVALID_BET", "A feature keeps the triggering bet context.");
    if (base && before.balance < bet) throw new RuntimeError("RUNTIME_INSUFFICIENT_BALANCE", "Insufficient balance.", { balance: before.balance, wager: bet });
    const wager = base ? bet : 0, spinIndex = before.completedSpinCount;
    const cap = Math.round(game.config.math.maxWinX * bet * 10000);
    if (!Number.isSafeInteger(cap) || cap < 0) throw new RuntimeError("RUNTIME_INVALID_CONFIG", "Unsafe round cap.");
    const priorAward = base ? 0 : before.roundAwarded;
    const spinId = `${before.sessionId}:${before.epoch}:${spinIndex + 1}`;
    const events: RuntimeEvent[] = [];
    const emit = (type: RuntimeEvent["type"], payload: Record<string, unknown>) => events.push(event(before.sessionId, type, events.length, payload, spinId));
    emit("SPIN_STARTED", { action, spinIndex });
    const advanced = advanceStateForSpinStart(before, { roundId: spinId, bet, activePaylineIds: game.config.activePaylines.map((l) => l.id), seed: before.rngState.canonicalSeed, chargeWager: base });
    if (wager) emit("WAGER_DEDUCTED", { wager, balance: advanced.nextState.balance });
    const featureEngine = createFeatureEngine(game.mechanics.featureConfig!);
    const featureState = base ? featureEngine.createInitialState() : { ...before.featureRuntimeState,
      // B12 remains responsible for trimming its feature total against the remaining round budget.
      winCap: Math.min(before.featureRuntimeState.winCap ?? Number.MAX_SAFE_INTEGER, (Math.round(before.featureRuntimeState.accumulatedFeatureWin * 10000) + Math.max(0, cap - Math.round(priorAward * 10000))) / 10000),
    };
    const history = base ? before.operationHistory.filter((key) => key.startsWith("session:")) : [...before.operationHistory];
    const mode = base ? "base" : featureState.currentMode;
    const operations = (game.mechanics.operations ?? []).filter((op) => (!op.modes || op.modes.includes(mode)) && (!op.featureIds || (featureState.featureId !== null && op.featureIds.includes(featureState.featureId))) && (op.scope === "step" || !history.includes(`${op.scope}:${op.id}`)));
    const dynamics = createBoardDynamicsEngine();
    let persistent = before.boardState;
    if (persistent) { persistent = dynamics.expireLocks(persistent, "spin").nextState; persistent = dynamics.expireTags(persistent, "spin"); }
    const transitions: ExecutionObservation[] = [];
    const outcome = createMathSimulationEngine().executePlayableStep(game.config, {
      caseId: spinId, bet, activePaylineIds: game.config.activePaylines.map((l) => l.id),
      ...(fixedStops ? { fixedReelStops: fixedStops } : {}),
      featureConfig: game.mechanics.featureConfig, tumbleConfig: game.mechanics.tumbleConfig, multiplierConfig: game.mechanics.multiplierConfig, meters: game.mechanics.meters, losingSpinCondition: game.mechanics.losingSpinCondition,
      input: { executionKind: base ? "baseStep" : "featureStep", spinIndex, rngState: before.rngState, featureState, multiplierSnapshot: before.multiplierSnapshot, logicState: before.logicState, operations, persistentBoardState: persistent ?? undefined, winModes: game.winModes,
        ...(game.definition.variableReelHeights.enabled ? { reelHeights: game.definition.variableReelHeights.perReelRowCounts } : {}),
        maxCascadeSteps: game.definition.boardDynamics.cascades.maxCascades,
      },
    }, { observe: (obs) => {
      if (transitions.length >= this.options.maxTransitionsPerStep) throw new RuntimeError("RUNTIME_LIMIT_EXCEEDED", "Step exceeded transition retention guard; no partial result committed.");
      transitions.push(obs);
      if (obs.stage === "REELS") emit("REELS_STOPPED", { result: obs.data.result });
      if (obs.stage === "BOARD") emit("BOARD_RESOLVED", { board: obs.data.board });
      if (obs.stage === "WIN EVALUATION") emit("WIN_EVALUATED", { result: obs.data.result });
      if (obs.stage === "BOARD TRANSFORM" && Array.isArray((obs.data.result as { removedCells?: unknown[] })?.removedCells) && (obs.data.result as { removedCells: unknown[] }).removedCells.length > 0) {
        emit("CASCADE_STARTED", { stepIndex: obs.data.stepIndex }); emit("CASCADE_COMPLETED", { result: obs.data.result });
      }
      if (obs.stage === "FEATURE LOGIC") {
        const result = obs.data.result as { actionsExecuted?: readonly { type: string }[]; retriggers?: readonly unknown[]; upgradeInfo?: unknown; spinsBefore?: number; spinsAfter?: number } | undefined;
        if (base && (result as { nextState?: { status?: string } } | undefined)?.nextState?.status === "active") emit("FEATURE_ENTERED", { result });
        if (result?.retriggers?.length) emit("FEATURE_RETRIGGERED", { retriggers: result.retriggers });
        if (result?.upgradeInfo) emit("FEATURE_UPGRADED", { upgrade: result.upgradeInfo });
        if (!base && result?.spinsBefore !== undefined) emit("FEATURE_STEP_COMPLETED", { result });
      }
    } });
    let nextFeature = outcome.nextFeatureState ?? featureEngine.createInitialState();
    const calculatedAward = outcome.spin.win;
    validMoney(calculatedAward, "calculatedAward");

    const award = Math.min(Math.round(calculatedAward * 10000), Math.max(0, cap - Math.round(priorAward * 10000))) / 10000;
    const capReached = Math.round((priorAward + award) * 10000) >= cap;
    if (capReached && nextFeature.status === "active") nextFeature = featureEngine.endFeature(nextFeature, "winCapReached").nextState;
    const active = nextFeature.status === "active";
    const featureEnded = !active;
    const multEngine = createMultiplierValueEngine();
    let mult = multEngine.restoreState(outcome.nextMultiplierSnapshot ?? before.multiplierSnapshot);
    let logic = outcome.nextLogicState ?? before.logicState;
    let boardState = outcome.boardState ?? null;
    if (featureEnded) {
      mult = multEngine.clearFeatureState(mult.multiplierState, mult.valueState);
      logic = createFeatureLogicEngine().clearFeatureScope(logic);
      if (boardState) boardState = dynamics.expireTags(boardState, "feature");
    }
    if (!active && boardState) boardState = dynamics.expireLocks(boardState, "round").nextState;
    const legacyFeature = { activeFeatureId: nextFeature.featureId, freeSpinsRemaining: nextFeature.currentMode === "freeSpins" ? nextFeature.remainingSpins : 0, totalFreeSpinsAwarded: nextFeature.awardedSpins, currentMultiplier: nextFeature.currentMultiplier, lockedPositions: nextFeature.lockedCells.map((cell) => ({ reelIndex: cell.reelIndex, rowIndex: cell.rowIndex })), cascadeCount: outcome.spin.cascadeCount, pendingTransitions: active ? ["CONTINUE_FEATURE"] : [] };
    const committed = commitSettledRound(advanced.nextState, advanced.roundState, outcome.reelResult, outcome.board, award, legacyFeature, outcome.spin.rngSnapshotAfter);
    const totalWagered = applyBalanceDelta(before.totalWagered, wager), totalAwarded = applyBalanceDelta(before.totalAwarded, award);
    const state: RuntimeState = immutable({ ...before, ...committed, status: active ? "feature" : "ready", nextAction: active ? "continueFeature" : "spin", totalWagered, totalAwarded, netResult: (Math.round(totalAwarded * 10000) - Math.round(totalWagered * 10000)) / 10000, completedSpinCount: spinIndex + 1, gameMode: nextFeature.currentMode, featureRuntimeState: nextFeature, boardState, multiplierSnapshot: multEngine.snapshotState(mult.multiplierState, mult.valueState), logicState: logic, rngState: outcome.spin.rngSnapshotAfter, roundBet: bet, roundAwarded: applyBalanceDelta(priorAward, award), operationHistory: [...history, ...operations.filter((op) => op.scope !== "step").map((op) => `${op.scope}:${op.id}`)] });
    if (before.featureRuntimeState.upgradeHistory.length < nextFeature.upgradeHistory.length && !events.some((e) => e.type === "FEATURE_UPGRADED")) emit("FEATURE_UPGRADED", { upgrades: nextFeature.upgradeHistory.slice(before.featureRuntimeState.upgradeHistory.length) });
    emit("AWARD_SETTLED", { award, balance: state.balance }); emit("SPIN_COMPLETED", { nextAction: state.nextAction });
    const core = immutable({ gameId: state.gameId, engineVersion: state.engineVersion, spinId, sessionId: state.sessionId, spinIndex, requestId: request.requestId, action, bet, board: outcome.board, reelResult: outcome.reelResult, reelStops: outcome.reelResult.stopIndexes, totalPayout: award, settlement: { wager, calculatedAward, award, capTrimmed: (Math.round(calculatedAward * 10000) - Math.round(award * 10000)) / 10000, capReached, balanceBefore: before.balance, balanceAfter: state.balance }, statistics: outcome.spin, featureState: nextFeature, wins: transitions.filter((obs) => obs.stage === "WIN EVALUATION"), transitions, events, nextAction: state.nextAction, status: state.status, startingStateReference: hash(before), finalStateReference: hash(state) });
    const replay: RuntimeReplayRecord = immutable({ version: 1, action, request, startingState: before, startingStateHash: hash(before), ...(fixedStops ? { fixedStops } : {}), resultHash: hash(core) });
    return { state, result: immutable({ ...core, replay }) };
  }
  public getLastResult(id: string, access: RuntimeAccess) { return this.getSession(id, access).lastResult; }
  public getHistory(id: string, access: RuntimeAccess, options: { readonly offset?: number; readonly limit?: number } = {}) {
    const entry = this.entry(id, access), offset = options.offset ?? 0, limit = options.limit ?? this.options.historyLimit;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 0 || limit > this.options.historyLimit) throw new RuntimeError("RUNTIME_INVALID_REQUEST", "Invalid history range.");
    return immutable(entry.history.slice(offset, offset + limit));
  }
  public snapshotSession(id: string, access: RuntimeAccess): SessionSnapshot {
    const entry = this.entry(id, access);
    const data = immutable({ version: 1 as const, ownerId: entry.ownerId, state: entry.state, initialRngState: entry.initialRngState, initialBet: entry.initialBet, history: entry.history, lastResult: entry.lastResult, requests: Array.from(entry.requests, ([id, value]) => ({ id, ...value })), errors: entry.errors, events: entry.events });
    const integrityHash = hash(data);
    // Bound issued snapshots per runtime; dropping a receipt never changes gameplay.
    if (this.issuedSnapshots.size >= 256) this.issuedSnapshots.delete(this.issuedSnapshots.keys().next().value!);
    this.issuedSnapshots.set(integrityHash, { ownerId: entry.ownerId, sessionId: id, data: JSON.stringify(data) });
    return immutable({ ...data, integrityHash });
  }
  public restoreSession(snapshot: SessionSnapshot, access: RuntimeAccess): RuntimeSessionView {
    if (!snapshot || typeof snapshot !== "object") throw new RuntimeError("RUNTIME_INVALID_SNAPSHOT", "Malformed snapshot.");
    const { integrityHash, ...data } = snapshot;
    if (snapshot.version !== 1 || access.ownerId !== snapshot.ownerId || this.issuedSnapshots.get(integrityHash)?.ownerId !== access.ownerId || this.issuedSnapshots.get(integrityHash)?.data !== JSON.stringify(data) || hash(data) !== integrityHash) throw new RuntimeError("RUNTIME_INVALID_SNAPSHOT", "Snapshot was altered, is foreign, or was not issued by this local runtime.");
    this.entry(snapshot.state.sessionId, access);
    const game = this.game(snapshot.state.gameId, snapshot.state.definitionHash);
    const restored = immutable(snapshot);
    const entry: SessionEntry = { ownerId: restored.ownerId, game, state: restored.state, initialRngState: restored.initialRngState, initialBet: restored.initialBet, history: [...restored.history], lastResult: restored.lastResult, requests: new Map(restored.requests.map(({ id, ...value }) => [id, value])), errors: restored.errors, events: restored.events };
    this.sessions.set(restored.state.sessionId, entry); return this.view(entry);
  }
  public replaySpin(id: string, spinId: string, access: RuntimeAccess): RuntimeSpinResult {
    const entry = this.entry(id, access);
    const retained = entry.lastResult?.spinId === spinId ? entry.lastResult : entry.history.find((result) => result.spinId === spinId);
    if (!retained) throw new RuntimeError("RUNTIME_RESULT_EXPIRED", "Spin is not in retained history.", { spinId });
    const replay = retained.replay;
    if (hash(replay.startingState) !== replay.startingStateHash) throw new RuntimeError("RUNTIME_REPLAY_FAILED", "Replay starting state changed.");
    const { result } = this.perform(entry.game, replay.startingState, replay.request, replay.action, replay.fixedStops);
    if (result.replay.resultHash !== replay.resultHash || hash(result) !== hash(retained)) throw new RuntimeError("RUNTIME_REPLAY_FAILED", "Replay diverged from recorded production execution.");
    return immutable(result);
  }
  public replaySession(id: string, access: RuntimeAccess): readonly RuntimeSpinResult[] { return immutable(this.entry(id, access).history.map((r) => this.replaySpin(id, r.spinId, access))); }
  public resetSession(id: string, access: RuntimeAccess): RuntimeSessionView {
    const entry = this.entry(id, access);
    entry.state = this.initial(entry.game, { sessionId: id, seed: 0, initialBalance: entry.state.startingBalance, bet: entry.initialBet }, entry.state.epoch + 1, entry.initialRngState);
    entry.history = []; entry.lastResult = null; entry.requests.clear(); entry.events = []; entry.errors = [];
    for (const [key, receipt] of this.issuedSnapshots) if (receipt.sessionId === id) this.issuedSnapshots.delete(key);
    return this.view(entry);
  }
  public closeSession(id: string, access: RuntimeAccess): RuntimeSessionView {
    const entry = this.entry(id, access);
    if (entry.state.status !== "closed") { entry.state = immutable({ ...entry.state, status: "closed", nextAction: "none" }); entry.events = immutable([event(id, "SESSION_ENDED", 0, { epoch: entry.state.epoch })]); }
    return this.view(entry);
  }
}
export function createGameRuntime(config: GameRuntimeConfig = {}): DeterministicGameRuntime { return new DeterministicGameRuntime(config); }
