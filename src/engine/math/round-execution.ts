/** Shared B16 production-round instrumentation and authored mechanic commands.
 * Commands only dispatch to existing B12–B15 APIs; no mechanic is implemented here.
 */
import type { GameConfig } from "../config";
import { createBoardDynamicsEngine, type BoardState } from "../dynamics";
import { InvalidVerificationCaseError } from "../errors";
import { createFeatureEngine, type FeatureRuntimeState, type FeatureEngineConfiguration } from "../features";
import { createFeatureLogicEngine, type FeatureLogicState } from "../logic";
import { createMultiplierValueEngine, type MultiplierState, type ValueState, type MultiplierValueStateSnapshot } from "../multipliers";
import type { RandomSource, RngStateSnapshot, RngAlgorithmId } from "../rng";

export type ExecutionStage = "ENGINE INPUT" | "REELS" | "BOARD" | "WIN EVALUATION" |
  "BOARD TRANSFORM" | "FEATURE LOGIC" | "MULTIPLIER/VALUE" | "METER/LOGIC" | "SETTLEMENT" | "FINAL STATE";
export interface ExecutionObservation {
  readonly index: number;
  readonly stage: ExecutionStage;
  readonly occurrence: number;
  readonly data: Readonly<Record<string, unknown>>;
}
export interface StageExpectation {
  readonly stage: ExecutionStage;
  /** Zero-based occurrence within this stage, in actual execution order. */
  readonly occurrence?: number;
  /** Explicit fields are checked recursively; arrays have exact length and order. */
  readonly expected: Readonly<Record<string, unknown>>;
}

export const MECHANIC_METHODS = {
  board: ["resolveMysteries", "applyLocks", "expireLocks", "placeSymbols", "removeCells", "applyTumble", "resizeBoard", "nudgeReel", "applyLinkedReels", "resolveVariableReelHeights", "duplicateSymbols", "applyLaneSweep", "tagPositions", "expireTags"],
  feature: ["evaluateTriggers", "startFeature", "runFeatureStep", "upgradeFeature", "buyFeature", "endFeature", "applyAction"],
  multiplier: ["addCellMultipliers", "resolveSpinCellMultiplier", "initializeTumbleMultiplier", "settleCurrentTumble", "advanceTumbleMultiplier", "initializeFeatureMultiplier", "assignCellValues", "collectValues", "broadcastValues", "initializeMeter", "stepMeter", "addMeterValue", "setMeterValue", "resetMeter", "harvestBoardMultipliersToMeter", "settleMeter", "recordSymbolMultiplierMemory", "resolveSymbolMultiplierMemory", "initializeCollectLadder", "advanceCollectLadder", "absorbValues", "buildSettlementContext", "syncWithBoardTransition", "clearSpinState", "clearFeatureState"],
  logic: ["initializeMeter", "incrementMeter", "setMeter", "resetMeter", "recordEvent", "evaluateThresholds", "resolveTieredOutcome", "selectWeightedOutcome", "evaluateChanceGate", "evaluateLosingSpinCondition", "executeActionSequence"],
} as const;
export type MechanicTarget = keyof typeof MECHANIC_METHODS;
export type ExecutionReferenceName = "board" | "boardState" | "featureState" | "logicState" | "multiplierState" | "valueState" | "rng" | "config" | "featureEngine" | "boardDynamicsEngine";
export interface ExecutionReference { readonly $ref: ExecutionReferenceName; }
/** Arguments after the implicit state(s), matching the real public method signature.
 * {$ref:"board"}, {$ref:"rng"}, etc. can occur anywhere within the argument tree.
 */
type MechanicEngine = {
  board: ReturnType<typeof createBoardDynamicsEngine>;
  feature: ReturnType<typeof createFeatureEngine>;
  multiplier: ReturnType<typeof createMultiplierValueEngine>;
  logic: ReturnType<typeof createFeatureLogicEngine>;
};
type WithoutFirst<T extends unknown[]> = T extends [unknown, ...infer Rest] ? Rest : [];
type WithoutTwo<T extends unknown[]> = WithoutFirst<WithoutFirst<T>>;
/** Derive arguments from the authoritative APIs rather than duplicate requests. */
type MethodArguments<T extends MechanicTarget, M extends PropertyKey> = M extends keyof MechanicEngine[T]
  ? MechanicEngine[T][M] extends (...args: infer P) => unknown
    ? T extends "multiplier" ? M extends "resolveSpinCellMultiplier" ? WithoutFirst<P> : WithoutTwo<P>
      : T extends "feature" ? M extends "startFeature" | "buyFeature" ? P : WithoutFirst<P>
      : WithoutFirst<P>
    : never : never;
type Referenced<T> = T extends (...args: never[]) => unknown ? T | ExecutionReference
  : T extends object ? { readonly [K in keyof T]: Referenced<T[K]> } | ExecutionReference : T | ExecutionReference;
type ReferencedArguments<T extends unknown[]> = { readonly [K in keyof T]: Referenced<T[K]> };
export type MechanicOperation = {
  [T in MechanicTarget]: {
    [M in (typeof MECHANIC_METHODS)[T][number]]: {
      readonly id: string;
      readonly target: T;
      readonly method: M;
      readonly at: "beforeWins" | "afterValues" | "beforeFeatures" | "afterLogic";
      readonly args: ReferencedArguments<MethodArguments<T, M>>;
    }
  }[(typeof MECHANIC_METHODS)[T][number]]
}[MechanicTarget];
export interface RoundExecutionInput {
  /** B18 opt-in boundary; absent preserves complete B16/B17 round execution. */
  readonly executionKind?: "baseStep" | "featureStep";
  readonly spinIndex?: number;
  readonly winModes?: readonly import("../config").EngineEvaluationMode[];
  readonly rngState?: RngStateSnapshot;
  readonly reelHeights?: readonly number[];
  readonly rngAlgorithmId?: RngAlgorithmId;
  readonly boardState?: BoardState;
  readonly persistentBoardState?: BoardState;
  readonly featureState?: FeatureRuntimeState;
  readonly multiplierSnapshot?: MultiplierValueStateSnapshot;
  readonly logicState?: FeatureLogicState;
  readonly operations?: readonly MechanicOperation[];
  /** Explicit B04 stops per feature spin; omission uses B03. */
  readonly featureReelStops?: readonly (readonly number[])[];
  readonly maxFeatureSpins?: number;
  readonly maxCascadeSteps?: number;
}
export interface RoundObservationOptions {
  readonly observe?: (observation: ExecutionObservation) => void;
}
export interface MechanicRuntime {
  boardState: BoardState;
  featureState?: FeatureRuntimeState;
  logicState?: FeatureLogicState;
  multiplierState: MultiplierState;
  valueState: ValueState;
}

/** Inputs are cloned by the caller. This dispatch never receives or writes expectations. */
export function runMechanicOperations(
  input: RoundExecutionInput | undefined,
  at: MechanicOperation["at"],
  runtime: MechanicRuntime,
  config: GameConfig,
  featureConfig: FeatureEngineConfiguration | undefined,
  rng: RandomSource,
  observe: (stage: ExecutionStage, data: Readonly<Record<string, unknown>>) => void,
): void {
  const engines = {
    board: createBoardDynamicsEngine(),
    feature: featureConfig ? createFeatureEngine(featureConfig) : undefined,
    multiplier: createMultiplierValueEngine(),
    logic: createFeatureLogicEngine(),
  };
  for (const op of input?.operations ?? []) {
    if (op.at !== at) continue;
    const allowed: readonly string[] = MECHANIC_METHODS[op.target] ?? [];
    const engine = engines[op.target];
    if (!engine || !allowed.includes(op.method)) {
      throw new InvalidVerificationCaseError("Unknown or unconfigured mechanic operation.", { operation: op.id, target: op.target, method: op.method });
    }
    const refs: Record<ExecutionReferenceName, unknown> = {
      ...runtime, featureState: runtime.featureState, logicState: runtime.logicState, board: runtime.boardState.board, config, rng, featureEngine: engines.feature, boardDynamicsEngine: engines.board,
    };
    const resolve = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(resolve);
      if (value && typeof value === "object") {
        const record = value as Record<string, unknown>;
        if ("$ref" in record) {
          if (Object.keys(record).length !== 1 || !(String(record.$ref) in refs)) {
            throw new InvalidVerificationCaseError("Invalid execution reference.", { reference: record });
          }
          return refs[record.$ref as ExecutionReferenceName];
        }
        return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, resolve(child)]));
      }
      return value;
    };
    const args = op.args.map(resolve);
    let prefix: unknown[];
    if (op.target === "board") prefix = [runtime.boardState];
    else if (op.target === "logic") prefix = [runtime.logicState];
    else if (op.target === "multiplier") prefix = op.method === "resolveSpinCellMultiplier" ? [runtime.multiplierState] : [runtime.multiplierState, runtime.valueState];
    else prefix = op.method === "startFeature" || op.method === "buyFeature" ? [] : [runtime.featureState];
    const fn = (engine as unknown as Record<string, (...args: unknown[]) => unknown>)[op.method]!;
    const result = fn.apply(engine, [...prefix, ...args]);
    const out = result as Record<string, unknown>;
    if (op.target === "board") runtime.boardState = (out.nextState ?? result) as BoardState;
    if (op.target === "feature") runtime.featureState = out.nextState as FeatureRuntimeState;
    if (op.target === "multiplier") {
      if (out.multiplierState) runtime.multiplierState = out.multiplierState as MultiplierState;
      if (out.valueState) runtime.valueState = out.valueState as ValueState;
    }
    if (op.target === "logic") {
      runtime.logicState = out.nextState as FeatureLogicState;
      if (out.boardState) runtime.boardState = out.boardState as BoardState;
      if (out.featureState) runtime.featureState = out.featureState as FeatureRuntimeState;
    }
    const stages = { board: "BOARD TRANSFORM", feature: "FEATURE LOGIC", multiplier: "MULTIPLIER/VALUE", logic: "METER/LOGIC" } as const;
    observe(stages[op.target], { operationId: op.id, method: op.method, result, ...runtime });
  }
}
