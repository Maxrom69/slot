/** B17 — exact deterministic verification, using the B16 production round runner.
 * No payouts, reel selection, transformations, or feature rules are implemented here.
 */
import type { GameBlueprint } from "@/lib/blueprint/types";
import type { Board } from "../board";
import type { GameConfig } from "../config";
import type { BoardState } from "../dynamics";
import { InvalidVerificationCaseError, InvalidVerificationSuiteError, UnknownGameDefinitionRevisionError, MalformedExpectedResultError, InconsistentExpectedDimensionsError, SlotEngineError, VerificationBaselineIntegrityError, VerificationReplayError, VerificationExecutionError, type SerializedEngineError } from "../errors";
import type { FeatureEngineResult, FeatureRuntimeState } from "../features";
import type { FeatureLogicState, LogicEvaluation } from "../logic";
import { createMathSimulationEngine, resolveNormalizedGameConfig, type SimulationSpin, type VerificationCase, type ExecutionObservation, type ExecutionStage, type RoundExecutionInput, type StageExpectation, MECHANIC_METHODS } from "../math";
import type { MultiplierState, ValueState } from "../multipliers";
import { createSeededRng, DefaultRngFactory, type RngStateSnapshot } from "../rng";
import type { GameDefinition } from "../schema";
import type { VerificationResult } from "./index";

export type VerificationStatus = "pass" | "fail" | "blocked";
export type VerificationDefinition = GameConfig | GameDefinition | GameBlueprint;
export type VerificationInput = RoundExecutionInput;
export type StructuralExpectation<T> = T extends readonly (infer U)[] ? readonly StructuralExpectation<U>[] : T extends object ? { readonly [K in keyof T]?: StructuralExpectation<T[K]> } : T;
export type BoardExpectation = StructuralExpectation<Board | BoardState>;
export type WinExpectation = StageExpectation;
export type FeatureExpectation = StructuralExpectation<FeatureEngineResult | FeatureRuntimeState>;
export type MultiplierExpectation = StructuralExpectation<MultiplierState>;
export type ValueExpectation = StructuralExpectation<ValueState>;
export type MeterExpectation = StructuralExpectation<FeatureLogicState | LogicEvaluation<unknown>>;
export type TraceExpectation = StageExpectation;

export interface VerificationDifference {
  readonly caseId: string;
  readonly path: string;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly stage: ExecutionStage;
  readonly observationIndex: number;
  readonly occurrence: number;
  readonly coordinate?: { readonly reelIndex: number; readonly rowIndex?: number };
  readonly message: string;
}
export interface VerificationReplayMetadata {
  readonly formatVersion: 1;
  readonly caseId: string;
  readonly gameId: string;
  readonly definitionRevision: string;
  readonly definitionHash: string;
  readonly caseHash: string;
  readonly engineVersion: string;
  readonly rngAlgorithmId: string;
  readonly rngAlgorithmVersion: number;
  readonly rngState: RngStateSnapshot;
  readonly configurationIds: readonly string[];
  /** Authored expectations are retained, never replaced with actual results. */
  readonly verificationCase: VerificationCase;
}
export interface VerificationRun extends VerificationResult {
  readonly caseId: string;
  readonly status: VerificationStatus;
  readonly stageReached: ExecutionStage;
  readonly reason: string;
  readonly differences: readonly VerificationDifference[];
  readonly validationErrors: readonly SerializedEngineError[];
  readonly trace?: readonly ExecutionObservation[];
  readonly traceReference?: string;
  readonly traceTruncated: boolean;
  readonly replayMetadata: VerificationReplayMetadata | null;
  readonly actualSpin?: SimulationSpin;
}
export interface VerificationSuite {
  readonly suiteId: string;
  readonly version: string;
  readonly description?: string;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly cases: readonly VerificationCase[];
  readonly baselineHash?: string;
}
export interface VerificationSelection {
  readonly caseIds?: readonly string[];
  readonly suiteIds?: readonly string[];
  /** Match any selected tag; different filters are intersected. */
  readonly tags?: readonly string[];
}
export interface VerificationOptions extends VerificationSelection {
  readonly earlyFailure?: boolean;
  readonly traceRetention?: "none" | "failures" | "all";
  readonly maxTraceEntries?: number;
  /** Optional measurement source supplied by the host; never used for outcomes. */
  readonly clock?: () => number;
}
export interface VerificationReport {
  readonly suiteId: string;
  readonly suiteVersion: string;
  readonly engineVersion: string;
  readonly definitionRevision: string;
  readonly definitionHash: string;
  readonly totalCases: number;
  readonly selectedCases: number;
  readonly passed: number;
  readonly failed: number;
  readonly blocked: number;
  readonly notRun: readonly string[];
  readonly executionTimeMs: number | null;
  readonly suiteMetadata: VerificationSuite["metadata"];
  readonly caseResults: readonly VerificationRun[];
  readonly failureSummaries: readonly { readonly caseId: string; readonly status: VerificationStatus; readonly reason: string; readonly difference?: VerificationDifference }[];
  readonly reproducibilityMetadata: { readonly suiteHash: string; readonly caseHashes: readonly string[] };
}
export interface VerificationEngine {
  runCase(definition: VerificationDefinition, verificationCase: VerificationCase, options?: VerificationOptions): VerificationRun;
  runSuite(definition: VerificationDefinition, suite: VerificationSuite, options?: VerificationOptions): VerificationReport;
  replay(definition: VerificationDefinition, metadata: VerificationReplayMetadata, options?: VerificationOptions): VerificationRun;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
/** Canonical serialization covers all normalized config fields (including Sets/Maps).
 * Fingerprints detect revision drift, not adversarial tampering; they are not signatures.
 */
function canonical(value: unknown): string {
  if (value === undefined) return '"<undefined>"';
  if (value instanceof Uint8Array) return canonical(Array.from(value));
  if (value instanceof Set) return canonical(Array.from(value).sort());
  if (value instanceof Map) return canonical(Object.fromEntries(value));
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function fingerprintVerificationData(value: unknown): string {
  const payload = canonical(value);
  let a = 2166136261;
  let b = 0x9e3779b9;
  for (let i = 0; i < payload.length; i++) {
    a = Math.imul(a ^ payload.charCodeAt(i), 16777619);
    b = Math.imul(b ^ payload.charCodeAt(i), 2246822507);
  }
  return `b17-${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}
function copy<T>(value: T): T {
  if (value instanceof Uint8Array) return Array.from(value) as T;
  if (Array.isArray(value)) return value.map(copy) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)])) as T;
  return value;
}
const STAGES: readonly ExecutionStage[] = ["ENGINE INPUT", "REELS", "BOARD", "WIN EVALUATION", "BOARD TRANSFORM", "FEATURE LOGIC", "MULTIPLIER/VALUE", "METER/LOGIC", "SETTLEMENT", "FINAL STATE"];
const EXPECTED_KEYS = ["reelStops", "boardGrid", "finalBoardGrid", "totalWin", "baseGameWin", "featureWin", "winningCombinationsCount", "winBySource", "triggeredFeatureIds", "activeFeatureId", "remainingFeatureSpins", "multiplierAfter", "cascadeCount", "meterValues"];

function invalid(message: string, path: string, context: Record<string, unknown> = {}): never {
  const detail = { path, ...context };
  if (path === "definitionRevision" || path === "definitionHash") throw new UnknownGameDefinitionRevisionError(message, detail);
  if (message.startsWith("Inconsistent expected")) throw new InconsistentExpectedDimensionsError(message, detail);
  if (message.startsWith("Malformed") || message.startsWith("Unknown expected")) throw new MalformedExpectedResultError(message, detail);
  throw new InvalidVerificationCaseError(message, detail);
}
function checkFiniteTree(value: unknown, path: string, seen = new Set<object>()): void {
  if (typeof value === "number" && !Number.isFinite(value)) invalid("Numeric data must be finite.", path, { value: String(value) });
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint" || value === undefined) invalid("Cases must contain serializable explicit values.", path);
  if (value && typeof value === "object") {
    if (seen.has(value)) invalid("Circular case data is not supported.", path);
    seen.add(value);
    for (const [key, child] of Object.entries(value)) checkFiniteTree(child, `${path}.${key}`, seen);
    seen.delete(value);
  }
}
function validateCase(config: GameConfig, revision: string, hash: string, c: VerificationCase): void {
  if (!c || typeof c !== "object" || typeof c.caseId !== "string" || !c.caseId.trim()) invalid("A stable caseId is required.", "caseId");
  checkFiniteTree(c, "case");
  if (!Number.isFinite(c.bet) || c.bet <= 0) invalid("Positive finite bet required.", "bet");
  if (c.definitionRevision !== undefined && c.definitionRevision !== revision) invalid("Unknown GameDefinition revision.", "definitionRevision", { expected: c.definitionRevision, actual: revision });
  if (c.definitionHash !== undefined && c.definitionHash !== hash) invalid("GameDefinition fingerprint does not match.", "definitionHash", { expected: c.definitionHash, actual: hash });
  if (c.engineVersion !== undefined && c.engineVersion !== config.engineVersion) invalid("Engine version does not match.", "engineVersion");
  if (!c.expected || typeof c.expected !== "object" || Array.isArray(c.expected)) invalid("Malformed expected result.", "expected");
  for (const key of Object.keys(c.expected)) if (!EXPECTED_KEYS.includes(key)) invalid("Unknown expected result field.", `expected.${key}`);
  if (!Object.keys(c.expected).length && !c.checks?.length && !c.expectedEventSequence?.length) invalid("At least one explicit expectation is required.", "expected");
  for (const [key, value] of Object.entries(c.expected)) {
    if (["totalWin", "baseGameWin", "featureWin", "winningCombinationsCount", "remainingFeatureSpins", "multiplierAfter", "cascadeCount"].includes(key) && (typeof value !== "number" || value < 0)) invalid("Malformed numeric expectation.", `expected.${key}`);
  }
  if (c.selectedMode && !["base", "freeSpins", "respin", "holdAndWin", "bonus"].includes(c.selectedMode)) invalid("Unknown game mode.", "selectedMode");
  if (c.selectedMode && c.selectedMode !== "base" && c.input?.featureState?.currentMode !== c.selectedMode) invalid("Non-base mode requires a matching explicit starting feature state.", "input.featureState.currentMode");
  if (c.input?.reelHeights && (c.input.reelHeights.length !== config.reels.length || c.input.reelHeights.some((height, i) => !Number.isSafeInteger(height) || height < 1 || height > config.reels[i]!.stops.length))) invalid("Invalid explicit reel heights.", "input.reelHeights");
  if (c.expected.winBySource && (Array.isArray(c.expected.winBySource) || Object.entries(c.expected.winBySource).some(([key, value]) => !["payline", "ways", "cluster", "payAnywhere", "scatter", "featureValue"].includes(key) || typeof value !== "number" || value < 0))) invalid("Malformed source payout expectation.", "expected.winBySource");
  if (c.expected.meterValues && (typeof c.expected.meterValues !== "object" || Array.isArray(c.expected.meterValues) || Object.values(c.expected.meterValues).some((value) => typeof value !== "number"))) invalid("Malformed meter expectation.", "expected.meterValues");
  if (c.expected.triggeredFeatureIds && !Array.isArray(c.expected.triggeredFeatureIds)) invalid("Malformed feature ID expectation.", "expected.triggeredFeatureIds");
  const symbols = new Set(config.symbols.map((s) => s.id));
  const featureIds = new Set([...(c.featureConfig?.features ?? []).map((f) => f.id), ...config.features.map((f) => f.id)]);
  const validateReferences = (value: unknown, path: string): void => {
    if (Array.isArray(value)) { value.forEach((v, i) => validateReferences(v, `${path}[${i}]`)); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const p = `${path}.${key}`;
      if (["symbolIds", "mysterySymbolIds", "collectorSymbolIds", "eligibleSourceSymbolIds", "eligibleTargetSymbolIds", "lockableSymbolIds"].includes(key) && Array.isArray(child)) for (const id of child) if (!symbols.has(id)) invalid("Unknown symbol ID.", p, { symbolId: id });
      if ((key === "symbolId" || key === "matchedSymbolId" || key === "replacementSymbolId") && typeof child === "string" && !symbols.has(child)) invalid("Unknown symbol ID.", p, { symbolId: child });
      if ((key === "featureId" || key === "activeFeatureId" || key === "targetFeatureId" || key === "selectedFeatureId") && typeof child === "string" && !featureIds.has(child)) invalid("Unknown feature ID.", p, { featureId: child });
      if (key === "triggeredFeatureIds" && Array.isArray(child)) for (const id of child) if (!featureIds.has(id)) invalid("Unknown feature ID.", p, { featureId: id });
      validateReferences(child, p);
    }
  };
  validateReferences(c, "case");
  const checkGrid = (grid: unknown, path: string, strictDimensions: boolean): void => {
    if (!Array.isArray(grid) || !grid.length || (strictDimensions && grid.length !== config.reels.length)) invalid("Inconsistent expected reel count.", path);
    for (let reel = 0; reel < grid.length; reel++) {
      const col = grid[reel];
      if (!Array.isArray(col) || !col.length || (strictDimensions && col.length !== (c.input?.reelHeights?.[reel] ?? config.grid.rows))) invalid("Inconsistent expected reel height.", `${path}[${reel}]`);
      for (let row = 0; row < col.length; row++) if (!symbols.has(col[row])) invalid("Unknown symbol ID.", `${path}[${reel}][${row}]`, { symbolId: col[row] });
    }
  };
  if (c.fixedBoardGrid) checkGrid(c.fixedBoardGrid, "fixedBoardGrid", !c.input?.operations?.length);
  if (c.expected.boardGrid) checkGrid(c.expected.boardGrid, "expected.boardGrid", !c.input?.operations?.length && !c.input?.boardState);
  if (c.expected.finalBoardGrid) checkGrid(c.expected.finalBoardGrid, "expected.finalBoardGrid", !c.input?.operations?.length && !c.input?.boardState);
  const stops = (value: readonly number[], path: string, reels = config.reels): void => {
    if (!Array.isArray(value) || value.length !== reels.length) invalid("Fixed stops must match reel count.", path);
    value.forEach((stop, i) => { if (!Number.isInteger(stop) || stop < 0 || stop >= reels[i]!.stops.length) invalid("Invalid reel stop index.", `${path}[${i}]`, { stop }); });
  };
  if (c.input?.boardState) {
    const state = c.input.boardState;
    const cells = state.board?.cells;
    if (!Array.isArray(cells) || !cells.length || !state.dimensions || state.dimensions.reelCount !== cells.length || state.dimensions.reelHeights.length !== cells.length) invalid("Inconsistent expected starting board dimensions.", "input.boardState");
    cells.forEach((col, reel) => {
      if (!col.length || state.dimensions.reelHeights[reel] !== col.length) invalid("Inconsistent expected starting board height.", `input.boardState.board.cells[${reel}]`);
      col.forEach((cell: Board["cells"][number][number], row: number) => {
        if (cell.position?.reelIndex !== reel || cell.position?.rowIndex !== row || cell.reelIndex !== reel || cell.rowIndex !== row || cell.symbol?.symbolId !== cell.symbolId) invalid("Inconsistent starting cell coordinates or symbol identity.", `input.boardState.board.cells[${reel}][${row}]`);
      });
    });
  }
  for (const [i, featureStops] of (c.input?.featureReelStops ?? []).entries()) {
    if (!Array.isArray(featureStops) || featureStops.length !== config.reels.length || featureStops.some((stop) => !Number.isSafeInteger(stop) || stop < 0)) invalid("Invalid feature fixed stop indexes.", `input.featureReelStops[${i}]`);
  }
  if (c.fixedReelStops) stops(c.fixedReelStops, "fixedReelStops");
  if (c.expected.reelStops) stops(c.expected.reelStops, "expected.reelStops");
  for (const check of c.checks ?? []) {
    if (!STAGES.includes(check.stage) || !Number.isInteger(check.occurrence ?? 0) || (check.occurrence ?? 0) < 0 || !check.expected || typeof check.expected !== "object" || Array.isArray(check.expected) || !Object.keys(check.expected).length) invalid("Malformed stage expectation.", "checks");
  }
  if (c.expectedEventSequence && (!Array.isArray(c.expectedEventSequence) || c.expectedEventSequence.some((stage) => !STAGES.includes(stage)))) invalid("Malformed expected stage sequence.", "expectedEventSequence");
  const ids = new Set<string>();
  for (const op of c.input?.operations ?? []) {
    const methods: readonly string[] = MECHANIC_METHODS[op.target] ?? [];
    if (!op.id || ids.has(op.id) || !methods.includes(op.method) || !["beforeWins", "afterValues", "beforeFeatures", "afterLogic"].includes(op.at) || !Array.isArray(op.args)) invalid("Malformed mechanic operation.", "input.operations", { operation: op.id });
    ids.add(op.id);
  }
  for (const [key, value] of Object.entries({ maxFeatureSpins: c.input?.maxFeatureSpins, maxCascadeSteps: c.input?.maxCascadeSteps })) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 1 || value > 10000)) invalid("Invalid execution guard.", `input.${key}`);
  }
}

/** Object expectations select explicit fields; array dimensions/order and primitives
 * are exact. No epsilon, currency rounding, or statistical tolerance is applied.
 */
function firstDifference(expected: unknown, actual: unknown, path: string): { path: string; expected: unknown; actual: unknown } | null {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return { path, expected, actual: actual === undefined ? { $missing: true } : actual };
    if (expected.length !== actual.length) return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    for (let i = 0; i < expected.length; i++) {
      const diff = firstDifference(expected[i], actual[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return { path, expected, actual: actual === undefined ? { $missing: true } : actual };
    // Authored field order is preserved, stage order comes from real execution.
    for (const [key, value] of Object.entries(expected)) {
      const diff = firstDifference(value, (actual as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
      if (diff) return diff;
    }
    return null;
  }
  return expected === actual ? null : { path, expected, actual: actual === undefined ? { $missing: true } : actual };
}
function coordinate(path: string, data: Readonly<Record<string, unknown>>): VerificationDifference["coordinate"] {
  const match = /(?:cells|boardGrid|finalBoardGrid|boardSnapshot|finalBoardSnapshot)\[(\d+)\](?:\[(\d+)\])?/.exec(path);
  if (match) return { reelIndex: Number(match[1]), ...(match[2] !== undefined ? { rowIndex: Number(match[2]) } : {}) };
  // For win/reel records the actual payload supplies coordinates directly.
  const reel = /reelWindows\[(\d+)\]/.exec(path);
  if (reel) return { reelIndex: Number(reel[1]) };
  const position = data.position as { reelIndex?: number; rowIndex?: number } | undefined;
  if (position?.reelIndex !== undefined) return { reelIndex: position.reelIndex, rowIndex: position.rowIndex };
  return undefined;
}
function difference(c: VerificationCase, obs: ExecutionObservation, expected: unknown, actual: unknown, path = ""): VerificationDifference | null {
  const diff = firstDifference(expected, actual, path);
  if (!diff) return null;
  return freeze({ caseId: c.caseId, ...diff, stage: obs.stage, occurrence: obs.occurrence, observationIndex: obs.index, coordinate: coordinate(diff.path, obs.data), message: `Exact mismatch at ${diff.path} in ${obs.stage} #${obs.occurrence}.` });
}
function legacyExpectations(c: VerificationCase, obs: ExecutionObservation): { expected: unknown; actual: unknown }[] {
  const exp = c.expected;
  const entries: { expected: unknown; actual: unknown }[] = [];
  if (obs.stage === "REELS" && obs.occurrence === 0 && exp.reelStops !== undefined) entries.push({ expected: { reelStops: exp.reelStops }, actual: { reelStops: (obs.data.result as { stopIndexes: unknown }).stopIndexes } });
  if (obs.stage === "BOARD" && obs.occurrence === 0 && exp.boardGrid !== undefined) entries.push({ expected: { boardGrid: exp.boardGrid }, actual: { boardGrid: (obs.data.board as Board).cells.map((col) => col.map((cell) => cell.symbolId)) } });
  if (obs.stage === "FINAL STATE" && exp.remainingFeatureSpins !== undefined) entries.push({ expected: { remainingFeatureSpins: exp.remainingFeatureSpins }, actual: { remainingFeatureSpins: (obs.data.featureState as FeatureRuntimeState | undefined)?.remainingSpins ?? 0 } });
  if (obs.stage === "SETTLEMENT") {
    const spin = obs.data.spin as SimulationSpin;
    const actual: Record<string, unknown> = { ...spin, totalWin: spin.win, boardGrid: spin.boardSnapshot, finalBoardGrid: spin.finalBoardSnapshot };
    const expected = Object.fromEntries(Object.entries(exp).filter(([k]) => !["boardGrid", "reelStops", "remainingFeatureSpins"].includes(k)));
    entries.push({ expected, actual });
  }
  return entries;
}
export function createVerificationBaseline(suite: VerificationSuite): VerificationSuite {
  const { baselineHash: _ignored, ...authored } = copy(suite);
  void _ignored;
  validateSuite(authored);
  return freeze({ ...authored, baselineHash: fingerprintVerificationData(authored) });
}
function validateSuite(suite: VerificationSuite): void {
  if (!suite || typeof suite.suiteId !== "string" || !suite.suiteId.trim() || typeof suite.version !== "string" || !suite.version.trim() || !Array.isArray(suite.cases)) throw new InvalidVerificationSuiteError("Suite requires stable ID, version and cases.");
  const ids = new Set<string>();
  for (const c of suite.cases) {
    if (!c?.caseId || ids.has(c.caseId)) throw new InvalidVerificationSuiteError("Case IDs must be nonempty and unique.", { caseId: c?.caseId });
    ids.add(c.caseId);
  }
  if (suite.baselineHash) {
    const { baselineHash, ...data } = suite;
    if (baselineHash !== fingerprintVerificationData(data)) throw new VerificationBaselineIntegrityError("Authored baseline fingerprint changed. Intentional changes require a newly authored baseline.");
  }
}

export class DeterministicVerificationEngine implements VerificationEngine {
  public runCase(definition: VerificationDefinition, supplied: VerificationCase, options: VerificationOptions = {}): VerificationRun {
    let c = supplied;
    let metadata: VerificationReplayMetadata | null = null;
    let failure: VerificationDifference | null = null;
    let stageReached: ExecutionStage = "ENGINE INPUT";
    const trace: ExecutionObservation[] = [];
    const matched = new Set<number>();
    let truncated = false;
    let actualSpin: SimulationSpin | undefined;
    let eventIndex = 0;
    const retention = options.traceRetention ?? "failures";
    const limit = options.maxTraceEntries ?? 256;
    const finish = (status: VerificationStatus, reason: string, validationErrors: readonly SerializedEngineError[] = []): VerificationRun => freeze({
      scenarioId: c?.caseId ?? "<invalid>", caseId: c?.caseId ?? "<invalid>", passed: status === "pass", status, stageReached, reason,
      mismatches: [], differences: failure ? [failure] : [], validationErrors,
      ...(retention === "all" || (retention === "failures" && status !== "pass") ? { trace, traceReference: `${metadata?.caseHash ?? "invalid"}/trace` } : {}),
      traceTruncated: truncated, replayMetadata: metadata, ...(actualSpin ? { actualSpin } : {}),
    });
    try {
      if (!Number.isSafeInteger(limit) || limit < 0) invalid("Invalid trace limit.", "maxTraceEntries");
      const { config, revision } = resolveNormalizedGameConfig(definition);
      const hash = fingerprintVerificationData(config);
      validateCase(config, revision, hash, c);
      c = copy(c);
      const rng = c.input?.rngState ? new DefaultRngFactory().restoreFromState(c.input.rngState) : createSeededRng(c.seed ?? `verify-${c.caseId}`, { algorithm: c.input?.rngAlgorithmId });
      if (c.input?.rngAlgorithmId && rng.snapshot().algorithm !== c.input.rngAlgorithmId) invalid("RNG algorithm and snapshot disagree.", "input.rngAlgorithmId");
      metadata = freeze({ formatVersion: 1, caseId: c.caseId, gameId: config.gameId, definitionRevision: revision, definitionHash: hash, engineVersion: config.engineVersion, caseHash: fingerprintVerificationData(c), rngAlgorithmId: rng.snapshot().algorithm, rngAlgorithmVersion: rng.snapshot().algorithmVersion, rngState: rng.snapshot(), configurationIds: [...config.reels.map((r) => r.id), ...config.features.map((f) => f.id)], verificationCase: copy(c) });
      // An explicit input enables the instrumented form of the SAME round runner.
      c = { ...c, input: { ...c.input, rngState: rng.snapshot() } };
      const outcome = createMathSimulationEngine().verifyCase(definition, c, {
        observe: (obs) => {
          stageReached = obs.stage;
          if (retention !== "none") {
            if (trace.length < limit) trace.push(obs);
            else truncated = true;
          }
          if (failure) return; // First divergence only; later derived defects cannot obscure it.
          if (c.expectedEventSequence) {
            const expectedStage = c.expectedEventSequence[eventIndex];
            const sequenceDiff = difference(c, obs, expectedStage ?? "<end of sequence>", obs.stage, `expectedEventSequence[${eventIndex}]`);
            eventIndex++;
            if (sequenceDiff) { failure = sequenceDiff; return; }
          }
          // An unobserved pre-settlement stage is already a divergence before
          // comparing settlement values that depend on it.
          if (obs.stage === "SETTLEMENT") {
            const missing = (c.checks ?? []).findIndex((check, i) => !matched.has(i) && check.stage !== "SETTLEMENT" && check.stage !== "FINAL STATE");
            if (missing >= 0) {
              const check = c.checks![missing]!;
              failure = freeze({ caseId: c.caseId, path: `checks[${missing}]`, expected: check, actual: null, stage: check.stage, occurrence: check.occurrence ?? 0, observationIndex: obs.index, message: "Expected intermediate stage was not executed before settlement." });
              return;
            }
          }
          const checks = c.checks ?? [];
          for (let i = 0; i < checks.length; i++) {
            const check = checks[i]!;
            if (check.stage !== obs.stage || (check.occurrence ?? 0) !== obs.occurrence) continue;
            matched.add(i);
            failure = difference(c, obs, check.expected, obs.data);
            if (failure) return;
          }
          for (const check of legacyExpectations(c, obs)) {
            failure = difference(c, obs, check.expected, check.actual);
            if (failure) return;
          }
        },
      });
      actualSpin = outcome.actualSpin;
      if (!failure && c.expectedEventSequence && eventIndex !== c.expectedEventSequence.length) {
        failure = freeze({ caseId: c.caseId, path: `expectedEventSequence[${eventIndex}]`, expected: c.expectedEventSequence[eventIndex], actual: null, stage: "FINAL STATE", occurrence: 0, observationIndex: eventIndex, message: "Expected event sequence ended prematurely." });
      }
      if (!failure) {
        const index = (c.checks ?? []).findIndex((_, i) => !matched.has(i));
        if (index >= 0) {
          const check = c.checks![index]!;
          failure = freeze({ caseId: c.caseId, path: `checks[${index}]`, expected: check, actual: null, stage: check.stage, occurrence: check.occurrence ?? 0, observationIndex: -1, message: "Expected stage occurrence was not executed." });
        }
      }
      // Legacy expectations not represented in the trace must never silently pass.
      if (!failure && !outcome.passed) {
        const d = outcome.diffs[0]!;
        failure = freeze({ caseId: c.caseId, path: d.path, expected: d.expected, actual: d.actual, stage: "SETTLEMENT", occurrence: 0, observationIndex: -1, message: d.message });
      }
      return finish(failure ? "fail" : "pass", failure ? failure.message : "All authored expectations matched exactly.");
    } catch (error) {
      const serialized = error instanceof SlotEngineError ? error.toJSON() : (metadata ? new VerificationExecutionError(error instanceof Error ? error.message : String(error), { stage: stageReached }) : new InvalidVerificationCaseError(error instanceof Error ? error.message : String(error), { stage: stageReached })).toJSON();
      if (metadata) {
        if (!failure) failure = freeze({ caseId: c.caseId, path: "execution", expected: "Successful production execution", actual: serialized, stage: stageReached, observationIndex: trace.length - 1, occurrence: 0, message: serialized.message });
        return finish(failure.path === "execution" && /^(INVALID_|UNKNOWN_|INCONSISTENT_|MALFORMED_)/.test(serialized.code) ? "blocked" : "fail", failure.message, [serialized]);
      }
      return finish("blocked", serialized.message, [serialized]);
    }
  }

  public runSuite(definition: VerificationDefinition, suite: VerificationSuite, options: VerificationOptions = {}): VerificationReport {
    validateSuite(suite);
    const { config, revision } = resolveNormalizedGameConfig(definition);
    const start = options.clock?.();
    const cases = suite.cases.filter((c) => (!options.caseIds || options.caseIds.includes(c.caseId)) && (!options.suiteIds || options.suiteIds.includes(suite.suiteId) || c.suiteIds?.some((id) => options.suiteIds!.includes(id))) && (!options.tags || c.tags?.some((tag) => options.tags!.includes(tag))));
    // Sequential isolation is deliberate; callers can schedule independent suites in workers.
    const results: VerificationRun[] = [];
    for (const c of cases) {
      const result = this.runCase(definition, c, options);
      results.push(result);
      if (options.earlyFailure && result.status !== "pass") break;
    }
    const end = options.clock?.();
    return freeze({ suiteId: suite.suiteId, suiteVersion: suite.version, engineVersion: config.engineVersion, definitionRevision: revision, definitionHash: fingerprintVerificationData(config), totalCases: results.length, selectedCases: cases.length, passed: results.filter((r) => r.status === "pass").length, failed: results.filter((r) => r.status === "fail").length, blocked: results.filter((r) => r.status === "blocked").length, notRun: cases.slice(results.length).map((c) => c.caseId), executionTimeMs: start !== undefined && end !== undefined ? end - start : null, suiteMetadata: copy(suite.metadata), caseResults: results, failureSummaries: results.filter((r) => r.status !== "pass").map((r) => ({ caseId: r.caseId, status: r.status, reason: r.reason, ...(r.differences[0] ? { difference: r.differences[0] } : {}) })), reproducibilityMetadata: { suiteHash: fingerprintVerificationData(suite), caseHashes: results.map((r) => r.replayMetadata?.caseHash ?? "invalid") } });
  }

  public replay(definition: VerificationDefinition, metadata: VerificationReplayMetadata, options: VerificationOptions = {}): VerificationRun {
    const { config, revision } = resolveNormalizedGameConfig(definition);
    if (metadata.formatVersion !== 1 || metadata.definitionHash !== fingerprintVerificationData(config) || metadata.definitionRevision !== revision || metadata.gameId !== config.gameId || metadata.engineVersion !== config.engineVersion || metadata.caseId !== metadata.verificationCase.caseId || metadata.caseHash !== fingerprintVerificationData(metadata.verificationCase)) throw new VerificationReplayError("Replay metadata or definition changed.", { caseId: metadata.caseId });
    const state = metadata.verificationCase.input?.rngState ?? createSeededRng(metadata.verificationCase.seed ?? `verify-${metadata.caseId}`, { algorithm: metadata.verificationCase.input?.rngAlgorithmId }).snapshot();
    if (canonical(state) !== canonical(metadata.rngState) || state.algorithm !== metadata.rngAlgorithmId || state.algorithmVersion !== metadata.rngAlgorithmVersion) throw new VerificationReplayError("Replay RNG metadata changed.");
    return this.runCase(definition, metadata.verificationCase, options);
  }
}
export function createVerificationEngine(): DeterministicVerificationEngine { return new DeterministicVerificationEngine(); }
/** Human-review export only: never writes any file or changes an expected baseline. */
export function exportVerificationActual(result: VerificationRun): string {
  return JSON.stringify({ caseId: result.caseId, actualSpin: result.actualSpin, trace: result.trace, replayMetadata: result.replayMetadata }, null, 2);
}
