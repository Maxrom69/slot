/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — Deterministic Replay Boundary
 *
 * Records the exact schemaVersion, engineVersion, seed, RNG state, request,
 * and outcome snapshot so any spin can be replayed and verified deterministically.
 */

import type { PaylineId } from "../config";
import type { SeedState } from "../rng";

export interface SerializedSpinRequest {
  readonly gameId: string;
  readonly seed: string;
  readonly bet: number;
  readonly activePaylineIds: readonly PaylineId[];
  readonly roundId: string;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface ReplayOutcomeSnapshot {
  readonly reelStops: readonly number[];
  readonly totalPayout: number;
  readonly totalWinMultiplier: number;
  readonly winCount: number;
  readonly featureTriggerCount: number;
}

export interface SpinReplayRecord {
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly gameId: string;
  readonly seed: string;
  readonly initialRngState: SeedState;
  readonly finalRngState: SeedState;
  readonly request: SerializedSpinRequest;
  readonly outcomeSnapshot: ReplayOutcomeSnapshot;
}

export function createSpinReplayRecord(params: {
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly gameId: string;
  readonly seed: string;
  readonly initialRngState: SeedState;
  readonly finalRngState: SeedState;
  readonly request: SerializedSpinRequest;
  readonly outcomeSnapshot: ReplayOutcomeSnapshot;
}): SpinReplayRecord {
  return Object.freeze({
    schemaVersion: params.schemaVersion,
    engineVersion: params.engineVersion,
    gameId: params.gameId,
    seed: params.seed,
    initialRngState: params.initialRngState,
    finalRngState: params.finalRngState,
    request: params.request,
    outcomeSnapshot: Object.freeze({
      reelStops: Object.freeze([...params.outcomeSnapshot.reelStops]),
      totalPayout: params.outcomeSnapshot.totalPayout,
      totalWinMultiplier: params.outcomeSnapshot.totalWinMultiplier,
      winCount: params.outcomeSnapshot.winCount,
      featureTriggerCount: params.outcomeSnapshot.featureTriggerCount,
    }),
  });
}
