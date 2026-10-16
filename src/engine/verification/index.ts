/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — Deterministic Verification Layer (Scenario, ExpectedResult, VerificationResult)
 *
 * Defines the contract for deterministic scenario verification against expected
 * reel stops, payouts, win counts, and feature triggers.
 */

import type { SeedInput } from "../rng";
import type { VerificationCase } from "../math";
type RoundExpectedResult = VerificationCase["expected"];
import type { ExecutionStage, ExecutionObservation } from "../math/round-execution";
import type { VerificationStatus, VerificationDifference, VerificationReplayMetadata } from "./deterministic";

export interface ExpectedResult extends RoundExpectedResult {
  readonly reelStops?: readonly number[];
  readonly totalPayout?: number;
  readonly winCount?: number;
  readonly featureTriggerCount?: number;
}

export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly gameId: string;
  readonly seed: SeedInput;
  readonly bet: number;
  readonly activePaylineIds?: readonly string[];
  readonly forcedStopIndexes?: readonly number[];
  readonly expected: ExpectedResult;
}

export interface VerificationMismatch {
  readonly field: keyof ExpectedResult;
  readonly expected: unknown;
  readonly actual: unknown;
  readonly message: string;
}

export interface VerificationResult {
  readonly scenarioId: string;
  readonly passed: boolean;
  readonly mismatches: readonly VerificationMismatch[];
  /** B17 detailed fields. Optional here to preserve B01's outcome-only helper. */
  readonly caseId?: string;
  readonly status?: VerificationStatus;
  readonly stageReached?: ExecutionStage;
  readonly reason?: string;
  readonly differences?: readonly VerificationDifference[];
  readonly trace?: readonly ExecutionObservation[];
  readonly replayMetadata?: VerificationReplayMetadata | null;
}

export interface EngineVerifier<TSpinResult> {
  verifyOutcome(
    scenario: Scenario,
    actualResult: TSpinResult,
  ): VerificationResult;
}

export function verifySpinOutcomeAgainstExpected(
  scenario: Scenario,
  actual: {
    readonly reelStops: readonly number[];
    readonly totalPayout: number;
    readonly wins: readonly unknown[];
    readonly featureTriggers: readonly unknown[];
  },
): VerificationResult {
  const mismatches: VerificationMismatch[] = [];
  const { expected } = scenario;

  if (expected.reelStops !== undefined) {
    const matches =
      expected.reelStops.length === actual.reelStops.length &&
      expected.reelStops.every((stop, idx) => stop === actual.reelStops[idx]);
    if (!matches) {
      mismatches.push({
        field: "reelStops",
        expected: expected.reelStops,
        actual: actual.reelStops,
        message: `Expected reelStops [${expected.reelStops.join(", ")}], received [${actual.reelStops.join(", ")}].`,
      });
    }
  }

  if (
    expected.totalPayout !== undefined &&
    Math.abs(expected.totalPayout - actual.totalPayout) > 1e-6
  ) {
    mismatches.push({
      field: "totalPayout",
      expected: expected.totalPayout,
      actual: actual.totalPayout,
      message: `Expected totalPayout ${expected.totalPayout}, received ${actual.totalPayout}.`,
    });
  }

  if (
    expected.winCount !== undefined &&
    expected.winCount !== actual.wins.length
  ) {
    mismatches.push({
      field: "winCount",
      expected: expected.winCount,
      actual: actual.wins.length,
      message: `Expected winCount ${expected.winCount}, received ${actual.wins.length}.`,
    });
  }

  if (
    expected.featureTriggerCount !== undefined &&
    expected.featureTriggerCount !== actual.featureTriggers.length
  ) {
    mismatches.push({
      field: "featureTriggerCount",
      expected: expected.featureTriggerCount,
      actual: actual.featureTriggers.length,
      message: `Expected featureTriggerCount ${expected.featureTriggerCount}, received ${actual.featureTriggers.length}.`,
    });
  }

  return Object.freeze({
    scenarioId: scenario.id,
    passed: mismatches.length === 0,
    mismatches: Object.freeze(mismatches),
  });
}

export * from "./deterministic";
