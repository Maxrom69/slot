import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptBlueprintToGameConfig, createSampleGameBlueprint, createVerificationEngine, createFeatureEngine,
  createMathSimulationEngine, createReelResolver, createSeededRng,
  createVerificationBaseline, exportVerificationActual, fingerprintVerificationData,
  VerificationBaselineIntegrityError, VerificationReplayError,
  type VerificationCase, type VerificationRun, type FeatureEngineConfiguration,
  type VerificationDefinition, type StageExpectation,
} from "../src/engine";
import { A, K, Q, S, SC, ZERO_GRID, exactCase, lossCase, authoredBaseline } from "./fixtures/verification-baseline";

function game() { const b = createSampleGameBlueprint(); b.features = []; return b; }
const verifier = createVerificationEngine();
function passed(result: VerificationRun) { assert.equal(result.status, "pass", JSON.stringify({ differences: result.differences, errors: result.validationErrors })); }
function board(grid: readonly (readonly string[])[]) {
  return { cells: grid.map((col, reelIndex) => col.map((symbolId, rowIndex) => ({ symbolId, position: { reelIndex, rowIndex } }))) };
}
function featureCase(): VerificationCase {
  const config = adaptBlueprintToGameConfig(game());
  const featureConfig: FeatureEngineConfiguration = {
    baseReels: config.reels, visibleRows: 3,
    features: [{ id: "fs", name: "Authored single spin", mode: "freeSpins", startingMultiplier: 2,
      alternateReels: [[K, K, K], [Q, Q, Q], [S, S, S], [A, A, A], [K, K, K]],
      triggers: [{ id: "scatter-three", source: "symbolCount", targetFeatureId: "fs", symbolIds: [SC], threshold: 3 }],
      freeSpins: { initialSpins: 1, retriggerEnabled: false },
    }],
  };
  return { caseId: "FS-001", bet: 5, seed: "b17-feature", fixedReelStops: [3, 3, 3, 0, 0], featureConfig,
    input: { featureReelStops: [[0, 0, 0, 0, 0]] }, expected: { triggeredFeatureIds: ["fs"], featureWin: 0, remainingFeatureSpins: 0 },
    checks: [
      { stage: "FEATURE LOGIC", occurrence: 1, expected: { result: { currentMode: "freeSpins", nextState: { remainingSpins: 1, currentMultiplier: 2 } } } },
      { stage: "BOARD", occurrence: 1, expected: { featureSpin: 1, board: board([[K,K,K],[Q,Q,Q],[S,S,S],[A,A,A],[K,K,K]]) } },
      { stage: "FEATURE LOGIC", occurrence: 2, expected: { result: { endReason: "spinsExhausted", nextState: { remainingSpins: 0 } } } },
    ],
  };
}
function cascadeCase(): VerificationCase {
  const final = [[K,K,K],[Q,Q,Q],[S,S,S],[K,Q,S],[Q,S,A]];
  return { caseId: "CAS-001", bet: 5, fixedReelStops: [0,0,0,0,0],
    tumbleConfig: { reelStrips: [[K,K,K],[Q,Q,Q],[S,S,S],[K,Q,S],[Q,S,A]] },
    expected: { totalWin: 9, cascadeCount: 1, finalBoardGrid: final },
    checks: [
      { stage: "BOARD", expected: { board: board(ZERO_GRID) } },
      { stage: "WIN EVALUATION", expected: { stepIndex: 0, result: { totalWin: 9 } } },
      { stage: "BOARD TRANSFORM", expected: { stepIndex: 0, board: board(final) } },
      { stage: "WIN EVALUATION", occurrence: 1, expected: { stepIndex: 1, board: board(final), result: { totalWin: 0 } } },
    ],
  };
}

describe("B17 — dedicated deterministic verification infrastructure", () => {
  it("1. exact fixed-stop board and payout pass through production B04–B16", () => {
    const r = verifier.runCase(game(), exactCase, { traceRetention: "all" }); passed(r);
    assert.equal(r.actualSpin?.win, 9);
    assert.equal(r.trace?.find((o) => o.stage === "REELS")?.data.source, "fixedStops");
    assert.ok(r.replayMetadata?.definitionHash.startsWith("b17-"));
    assert.equal(r.replayMetadata?.rngAlgorithmId, "mulberry32-v1");
  });
  it("2. symbol mismatch identifies exact coordinate and path before payout", () => {
    const grid = ZERO_GRID.map((col) => [...col]); grid[1]![2] = A;
    const r = verifier.runCase(game(), { ...exactCase, expected: { boardGrid: grid, totalWin: 999 } });
    assert.equal(r.status, "fail"); assert.equal(r.differences.length, 1);
    assert.equal(r.differences[0]?.path, "boardGrid[1][2]");
    assert.deepEqual(r.differences[0]?.coordinate, { reelIndex: 1, rowIndex: 2 });
    assert.equal(r.differences[0]?.stage, "BOARD");
  });
  it("3. payout uses exact numeric comparison, not epsilon tolerances", () => {
    const r = verifier.runCase(game(), { ...exactCase, expected: { totalWin: 9.00000001 } });
    assert.equal(r.status, "fail"); assert.equal(r.differences[0]?.path, "totalWin");
    assert.equal(r.differences[0]?.expected, 9.00000001); assert.equal(r.differences[0]?.actual, 9);
  });
  it("4. feature flow is board-by-board, alternate B04 reels, feature mismatch diagnosable", () => {
    passed(verifier.runCase(game(), featureCase()));
    const c = featureCase(); const checks = [...c.checks!];
    checks[0] = { stage: "FEATURE LOGIC", occurrence: 1, expected: { result: { nextState: { remainingSpins: 2 } } } };
    const r = verifier.runCase(game(), { ...c, checks });
    assert.equal(r.status, "fail"); assert.equal(r.differences[0]?.path, "result.nextState.remainingSpins");
    assert.equal(r.differences[0]?.actual, 1);
  });
  it("5. exact B14 multiplier and value sources are observable", () => {
    const c: VerificationCase = { ...lossCase, input: { operations: [
      { id: "cell-x3", target: "multiplier", method: "addCellMultipliers", at: "beforeWins", args: [{ $ref: "board" }, [{ position: { reelIndex: 0, rowIndex: 0 }, value: 3, sourceConfigId: "authored-x3" }]] },
      { id: "fixed-7", target: "multiplier", method: "assignCellValues", at: "beforeWins", args: [{ $ref: "board" }, [{ id: "authored-seven", symbolIds: [A], mode: "fixed", fixedValue: 7 }]] },
    ] }, checks: [
      { stage: "MULTIPLIER/VALUE", expected: { operationId: "cell-x3", result: { detail: [{ value: 3, sourceConfigId: "authored-x3", position: { reelIndex: 0, rowIndex: 0 } }] } } },
      { stage: "MULTIPLIER/VALUE", occurrence: 1, expected: { operationId: "fixed-7", valueState: { cellValuesByCoord: { "0:0": { value: 7, originConfigId: "authored-seven" } } } } },
    ] };
    passed(verifier.runCase(game(), c));
    const r = verifier.runCase(game(), { ...c, checks: [{ stage: "MULTIPLIER/VALUE", expected: { result: { detail: [{ value: 4 }] } } }] });
    assert.equal(r.differences[0]?.path, "result.detail[0].value"); assert.equal(r.differences[0]?.actual, 3);
  });
  it("6. B15 thresholds, nested ordered actions and inline board results", () => {
    const c: VerificationCase = { ...lossCase, meters: [{ meterId: "spins", scope: "session", startingValue: 0, eventSource: { eventType: "spinsPlayed" }, thresholds: [{ thresholdId: "one", threshold: 1, actions: [{ actionId: "award", type: "awardPrize", prizeAmount: 4 }] }] }],
      expected: { totalWin: 4, meterValues: { spins: 1 } },
      checks: [{ stage: "METER/LOGIC", expected: { event: { eventType: "spinsPlayed" }, result: { thresholdsFired: [{ thresholdId: "one", fired: true }], actionsExecuted: [{ actionId: "award", prizeAwarded: 4 }] } } }],
    };
    passed(verifier.runCase(game(), c));
    const r = verifier.runCase(game(), { ...c, checks: [{ stage: "METER/LOGIC", expected: { result: { actionsExecuted: [{ actionId: "award", prizeAwarded: 5 }] } } }] });
    assert.equal(r.differences[0]?.path, "result.actionsExecuted[0].prizeAwarded"); assert.equal(r.differences[0]?.actual, 4);
    const nested: VerificationCase = { ...lossCase, input: { operations: [{ id: "ordered", target: "logic", method: "executeActionSequence", at: "afterLogic", args: [{ sequenceId: "outer", actions: [
      { actionId: "nested", type: "nestedSequence", sequenceId: "inner", actions: [{ actionId: "credit", type: "awardPrize", prizeAmount: 2 }] },
      { actionId: "place", type: "inlineBoardAction", boardOperation: { kind: "placeSymbols", spec: { placements: [{ position: { reelIndex: 0, rowIndex: 0 }, symbolId: Q }] } } },
    ] }, { boardState: { $ref: "boardState" }, rng: { $ref: "rng" } }] }] }, expected: { totalWin: 2 }, checks: [{ stage: "METER/LOGIC", occurrence: 6, expected: { operationId: "ordered", result: { actionsExecuted: [{ actionId: "nested", childActionResults: [{ actionId: "credit", prizeAwarded: 2 }] }, { actionId: "place", observedPreviousActionId: "credit" }] } } }] };
    passed(verifier.runCase(game(), nested));
  });
  it("7. cascade identifies first divergent refill board, ignoring later derived mismatches", () => {
    passed(verifier.runCase(game(), cascadeCase()));
    const c = cascadeCase(); const checks = [...c.checks!];
    checks[2] = { stage: "BOARD TRANSFORM", expected: { board: board([[A,K,K],[Q,Q,Q],[S,S,S],[K,Q,S],[Q,S,A]]) } };
    checks[3] = { stage: "WIN EVALUATION", occurrence: 1, expected: { result: { totalWin: 999 } } };
    const r = verifier.runCase(game(), { ...c, checks });
    assert.equal(r.differences.length, 1); assert.equal(r.differences[0]?.stage, "BOARD TRANSFORM");
    assert.equal(r.differences[0]?.path, "board.cells[0][0].symbolId");
  });
  it("8. circular fixed stops, B04 variable heights, real B13 nudges/links/locks/tags", () => {
    const bp = game(), config = adaptBlueprintToGameConfig(bp);
    const direct = createReelResolver().resolveReels(config, createSeededRng(7), { roundId: "direct", forcedStopIndexes: [5,5,5,5,5] });
    assert.deepEqual(direct.reelWindows[0]?.visibleSymbolIds, [SC,A,K]);
    const r = verifier.runCase(bp, { ...lossCase, fixedReelStops: [5,5,5,5,5], expected: {}, input: { reelHeights: [4,3,3,3,3] }, checks: [{ stage: "REELS", expected: { source: "fixedStops", result: { stopIndexes: [5,5,5,5,5] } } }, { stage: "BOARD", expected: { board: board([[SC,A,K,Q],[SC,A,K],[SC,A,K],[SC,K,Q],[SC,Q,S]]) } }] }); passed(r);
    const c: VerificationCase = { ...lossCase, expected: {}, input: { operations: [
      { id: "lock", target: "board", method: "applyLocks", at: "beforeWins", args: [[{ position: { reelIndex: 0, rowIndex: 0 }, lifetimeType: "round" }]] },
      { id: "nudge", target: "board", method: "nudgeReel", at: "beforeWins", args: [{ reelIndex: 0, direction: "up", steps: 1, reelStrip: [A,K,Q,S,"sym-wild",SC] }] },
      { id: "link", target: "board", method: "applyLinkedReels", at: "beforeWins", args: [[{ sourceReel: 0, targetReels: [1] }]] },
      { id: "tag", target: "board", method: "tagPositions", at: "beforeWins", args: [{ tag: "held", mode: "configured", positions: [{ reelIndex: 0, rowIndex: 0 }], lifetime: "feature" }] },
    ] }, checks: [{ stage: "BOARD TRANSFORM", occurrence: 1, expected: { operationId: "nudge", result: { stopIndexAfter: 1, symbolIdsAfter: [A,Q,S] } } }, { stage: "BOARD TRANSFORM", occurrence: 2, expected: { boardState: { board: { cells: [[{symbolId:A},{symbolId:Q},{symbolId:S}],[{symbolId:A},{symbolId:Q},{symbolId:S}],[{},{},{}],[{},{},{}],[{},{},{}]] } } } }, { stage: "BOARD TRANSFORM", occurrence: 3, expected: { boardState: { tagsByCoord: { "0:0": [{ tag: "held", lifetime: "feature" }] } } } }] };
    passed(verifier.runCase(bp, c));
  });
  it("9. fixed B03 state reproduces a nontrivial chance gate and mystery", () => {
    const rng = createSeededRng("b17-fixed-rng", { algorithm: "sfc32-v1" }); rng.nextUint32();
    const c: VerificationCase = { ...lossCase, input: { rngState: rng.snapshot(), rngAlgorithmId: "sfc32-v1", operations: [
      { id: "mystery", target: "board", method: "resolveMysteries", at: "beforeWins", args: [{ mysterySymbolIds: [A], mode: "independent", candidatePool: [K,Q] }, { $ref: "rng" }] },
      { id: "gate", target: "logic", method: "evaluateChanceGate", at: "afterLogic", args: [{ gateId: "half", probability: 0.5 }, { $ref: "rng" }] },
    ] }, expected: {}, checks: [{ stage: "METER/LOGIC", occurrence: 5, expected: { operationId: "gate", result: { chanceGateResult: { gateId: "half", normalizedProbability: 0.5 } } } }] };
    const first = verifier.runCase(game(), c, { traceRetention: "all" }); passed(first);
    assert.deepEqual(first, verifier.runCase(game(), c, { traceRetention: "all" }));
    assert.equal(first.replayMetadata?.rngAlgorithmId, "sfc32-v1");
    assert.equal(first.replayMetadata?.rngState.drawCount, 1);
    assert.ok(first.trace?.some((o) => o.stage === "BOARD TRANSFORM"));
  });
  it("10. failed case replays identical failure and rejects revision/RNG tampering", () => {
    const r = verifier.runCase(game(), { ...exactCase, expected: { totalWin: 8 } });
    assert.equal(r.status, "fail"); assert.ok(r.replayMetadata);
    assert.deepEqual(verifier.replay(game(), JSON.parse(JSON.stringify(r.replayMetadata))), r);
    const modified = game(); modified.math.maxWinX += 1;
    assert.throws(() => verifier.replay(modified, r.replayMetadata!), VerificationReplayError);
    assert.throws(() => verifier.replay(game(), { ...r.replayMetadata!, rngAlgorithmVersion: 9 }), VerificationReplayError);
  });
  it("11. suite, case and tag filtering; continue and early stop summaries", () => {
    const suite = { suiteId: "regression", version: "1", cases: [exactCase, lossCase] };
    assert.equal(verifier.runSuite(game(), suite).passed, 2);
    assert.equal(verifier.runSuite(game(), suite, { suiteIds: ["win-evaluation"] }).passed, 1);
    assert.equal(verifier.runSuite(game(), suite, { caseIds: ["WF-002"] }).passed, 1);
    assert.equal(verifier.runSuite(game(), suite, { tags: ["critical"] }).passed, 1);
    assert.equal(verifier.runSuite(game(), suite, { tags: ["missing"] }).totalCases, 0);
    const broken = { ...suite, cases: [{ ...exactCase, expected: { totalWin: 7 } }, lossCase] };
    const early = verifier.runSuite(game(), broken, { earlyFailure: true });
    assert.equal(early.failed, 1); assert.deepEqual(early.notRun, ["WF-002"]);
    assert.equal(verifier.runSuite(game(), broken).caseResults.length, 2);
    let ticks = 0; const measured = verifier.runSuite(game(), suite, { clock: () => ticks++ * 2 }); assert.equal(measured.executionTimeMs, 2);
  });
  it("12. authored baseline IDs, expected outputs and ordering stay stable", () => {
    const before = JSON.stringify(authoredBaseline);
    const first = verifier.runSuite(game(), authoredBaseline);
    assert.deepEqual(first, verifier.runSuite(game(), authoredBaseline));
    assert.deepEqual(first.caseResults.map((r) => r.caseId), ["WF-001", "WF-002"]);
    assert.equal(first.passed, 2); assert.equal(JSON.stringify(authoredBaseline), before);
  });
  it("13. baseline protection and actual-only review export never rewrite expectations", () => {
    const suite = createVerificationBaseline({ suiteId: "protected", version: "1", cases: [{ ...exactCase, expected: { totalWin: 8 } }] });
    assert.ok(Object.isFrozen(suite.cases[0]?.expected));
    const before = fingerprintVerificationData(suite);
    const r = verifier.runSuite(game(), suite).caseResults[0]!;
    assert.equal(r.status, "fail"); assert.ok(exportVerificationActual(r).includes('"win": 9'));
    assert.equal(fingerprintVerificationData(suite), before);
    const changed = JSON.parse(JSON.stringify(suite)); changed.cases[0].expected.totalWin = 9;
    assert.throws(() => verifier.runSuite(game(), changed), VerificationBaselineIntegrityError);
  });
  it("14. invalid cases return structured validation errors, no silent repair", () => {
    const cases: VerificationCase[] = [
      { ...exactCase, definitionRevision: "unknown" }, { ...exactCase, definitionHash: "unknown" },
      { ...exactCase, fixedReelStops: [6,0,0,0,0] }, { ...exactCase, bet: Number.NaN },
      { ...exactCase, expected: { totalWin: Number.POSITIVE_INFINITY } },
      { ...exactCase, expected: { boardGrid: [["not-a-symbol"]] } },
      { ...exactCase, expected: { boardGrid: [[A,K,Q]] } },
      { ...exactCase, expected: { triggeredFeatureIds: ["missing-feature"] } },
      { ...exactCase, expected: {} }, { ...exactCase, expected: { totalWin: "9" } as unknown as VerificationCase["expected"] },
    ];
    for (const c of cases) { const r = verifier.runCase(game(), c); assert.equal(r.status, "blocked", JSON.stringify(r)); assert.ok(r.validationErrors[0]?.context.path); }
    assert.equal(verifier.runCase(undefined as unknown as VerificationDefinition, exactCase).status, "blocked");
  });
  it("15. B16 statistics stay separate; old verifyCase and production results compatible", () => {
    const bp = game(); const sim = createMathSimulationEngine();
    const b16 = sim.verifyCase(bp, exactCase); assert.equal(b16.passed, true);
    assert.deepEqual(verifier.runCase(bp, exactCase).actualSpin?.winBySource, b16.actualSpin.winBySource);
    const run = sim.run(bp, { spinCount: 2, seed: "b17-compat", bet: 5, fixedStops: [[0,0,0,0,0]] });
    assert.equal(run.report.totalPayout, 18); assert.equal(run.report.rtp.rtpPercentage, 180);
  });
  it("16. identical revision yields identical results; trace retention and absent stages", () => {
    const config = adaptBlueprintToGameConfig(game());
    const c = { ...exactCase, definitionHash: fingerprintVerificationData(config), definitionRevision: `${config.schemaVersion}:${config.engineVersion}` };
    assert.deepEqual(verifier.runCase(config, c), verifier.runCase(config, c));
    const none = verifier.runCase(config, { ...c, expected: { totalWin: 1 } }, { traceRetention: "none" }); assert.equal(none.trace, undefined); assert.ok(none.replayMetadata);
    const bounded = verifier.runCase(config, c, { traceRetention: "all", maxTraceEntries: 2 }); assert.equal(bounded.trace?.length, 2); assert.equal(bounded.traceTruncated, true); passed(bounded);
    const missing: StageExpectation = { stage: "BOARD TRANSFORM", expected: { stepIndex: 0 } };
    const r = verifier.runCase(config, { ...c, checks: [missing] }); assert.equal(r.status, "fail"); assert.equal(r.differences[0]?.path, "checks[0]");
  });
  it("17. authored event sequence detects stage reordering at its first event", () => {
    const sequence: readonly import("../src/engine").ExecutionStage[] = [
      "ENGINE INPUT", "REELS", "BOARD", "WIN EVALUATION", "MULTIPLIER/VALUE",
      ...Array<import("../src/engine").ExecutionStage>(7).fill("METER/LOGIC"), "SETTLEMENT", "FINAL STATE",
    ];
    passed(verifier.runCase(game(), { ...lossCase, expectedEventSequence: sequence }));
    const r = verifier.runCase(game(), { ...lossCase, expectedEventSequence: ["ENGINE INPUT", "BOARD"] });
    assert.equal(r.differences[0]?.path, "expectedEventSequence[1]");
    assert.equal(r.differences[0]?.expected, "BOARD"); assert.equal(r.differences[0]?.actual, "REELS");
  });
  it("18. explicit starting feature runtime, B12 max-win and winning-spin caps", () => {
    for (const roundControl of [{ winCap: 10 }, { winningSpinCap: 1 }]) {
      const config = adaptBlueprintToGameConfig(game());
      const featureConfig: FeatureEngineConfiguration = { baseReels: config.reels, visibleRows: 3, features: [{ id: "capped", name: "Capped FS", mode: "freeSpins", startingMultiplier: 2, alternateReels: Array.from({ length: 5 }, () => [A,A,A]), freeSpins: { initialSpins: 3 }, roundControl }] };
      const featureState = createFeatureEngine(featureConfig).startFeature("capped").nextState;
      const r = verifier.runCase(game(), { ...lossCase, caseId: "CAP-001", selectedMode: "freeSpins", featureConfig, input: { featureState, featureReelStops: [[0,0,0,0,0]] }, expected: {}, checks: [{ stage: "FEATURE LOGIC", occurrence: 1, expected: { result: { endReason: "winCap" in roundControl ? "winCapReached" : "winningSpinCapReached", capStatus: "winCap" in roundControl ? { winCapReached: true } : { winningSpinCapReached: true } } } }] });
      passed(r); assert.equal(r.actualSpin?.featureSpinsPlayedInRound, 1);
      assert.deepEqual(verifier.replay(game(), r.replayMetadata!), r);
    }
  });
  it("19. missing intermediate expectations precede derived settlement failures", () => {
    const r = verifier.runCase(game(), { ...lossCase, expected: { totalWin: 900 }, checks: [{ stage: "BOARD TRANSFORM", expected: { stepIndex: 0 } }] });
    assert.equal(r.differences[0]?.path, "checks[0]"); assert.equal(r.differences[0]?.stage, "BOARD TRANSFORM");
  });
  it("20. configuration fingerprint includes math/caps and RNG cases keep caller state immutable", () => {
    const bp = game(); const first = fingerprintVerificationData(adaptBlueprintToGameConfig(bp));
    bp.math.maxWinX += 1; assert.notEqual(fingerprintVerificationData(adaptBlueprintToGameConfig(bp)), first);
    const c: VerificationCase = { ...exactCase, seed: new Uint8Array([1,2,3]), input: { operations: [{ id: "memory", target: "multiplier", method: "recordSymbolMultiplierMemory", at: "beforeWins", args: [[{ symbolId: A, multiplier: 3 }]] }, { id: "resolve-memory", target: "multiplier", method: "resolveSymbolMultiplierMemory", at: "beforeWins", args: [[A]] }] } };
    const before = JSON.stringify(c); passed(verifier.runCase(game(), c)); assert.equal(JSON.stringify(c), before);
    const report = verifier.runCase(game(), c); assert.deepEqual(verifier.replay(game(), JSON.parse(JSON.stringify(report.replayMetadata))), report);
  });

});
