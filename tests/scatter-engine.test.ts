import assert from "node:assert/strict";
import test from "node:test";

import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  DeterministicScatterEngine,
  InvalidBetError,
  InvalidBoardError,
  InvalidScatterConfigurationError,
  InvalidScatterPayoutError,
  InvalidScatterThresholdError,
  SeededRNG,
  SlotEngineError,
  UnknownScatterSymbolError,
  adaptBlueprintToGameConfig,
  combineLineAndScatterPayouts,
  createBoardFromSymbolGrid,
  createPaylineEngine,
  createPaytableEngine,
  createReelEngine,
  createSampleGameDefinition,
  createScatterEngine,
  createWildEngine,
  deserializeScatterEvaluationResult,
  evaluateScatters,
  serializeScatterEvaluationResult,
  toGameConfig,
  type Board,
  type PaylineDefinition,
  type PaytableDefinition,
  type ScatterEngineConfigObject,
} from "../src/engine";

function makePayline(
  id: string,
  index: number,
  pattern: readonly number[],
  enabled = true,
): PaylineDefinition {
  return Object.freeze({
    id,
    index,
    name: `Line ${index}`,
    pattern: Object.freeze([...pattern]),
    enabled,
    color: "#f59e0b",
  });
}

const SCATTER_FIXTURE_CONFIG: ScatterEngineConfigObject = Object.freeze({
  enabled: true,
  symbolIds: ["SCATTER"],
  knownSymbolIds: ["A", "K", "Q", "J", "WILD", "SCATTER"],
  rules: [
    {
      scatterSymbolId: "SCATTER",
      evaluatesAnywhere: true,
      independentOfPaylines: true,
      payoutReferenceSymbolId: "SCATTER",
      triggerFeatureId: "feature-free-spins",
      minimumTriggerCount: 3,
      minimumCount: 3,
      payouts: {
        3: 5,
        4: 10,
        5: 25,
      },
      overCapPolicy: "highestTier" as const,
    },
  ],
});

test("B08.1 — Core Scatter counting, payout ladder, position independence, and additive behavior (TEST 1 through TEST 11 + Over-Cap)", () => {
  const scatterEngine = createScatterEngine(SCATTER_FIXTURE_CONFIG);
  assert.equal(scatterEngine.isScatterSymbol("SCATTER"), true);
  assert.equal(scatterEngine.isScatterSymbol("WILD"), false);
  assert.equal(scatterEngine.isScatterSymbol("A"), false);

  // TEST 1: THREE SCATTERS (count = 3, multiplier = 5x, bet = 2 -> payout = 10)
  const board3 = createBoardFromSymbolGrid([
    ["SCATTER", "A", "K"],
    ["Q", "J", "A"],
    ["K", "SCATTER", "Q"],
    ["A", "K", "J"],
    ["J", "Q", "SCATTER"],
  ]);
  const res1 = scatterEngine.evaluate(board3, { bet: 2 });
  assert.equal(res1.scatters.length, 1);
  assert.equal(res1.scatters[0].symbolId, "SCATTER");
  assert.equal(res1.scatters[0].count, 3);
  assert.equal(res1.scatters[0].eligible, true);
  assert.equal(res1.scatters[0].matchedTier, 3);
  assert.equal(res1.scatters[0].payoutMultiplier, 5);
  assert.equal(res1.scatters[0].payout, 10);
  assert.equal(res1.scatters[0].triggerEligible, true);
  assert.equal(res1.totalScatterMultiplier, 5);
  assert.equal(res1.totalScatterPayout, 10);
  assert.equal(res1.triggered, true);

  // TEST 2: FOUR SCATTERS (count = 4, multiplier = 10x, bet = 2 -> payout = 20)
  const board4 = createBoardFromSymbolGrid([
    ["SCATTER", "A", "K"],
    ["Q", "SCATTER", "A"],
    ["K", "A", "SCATTER"],
    ["SCATTER", "K", "J"],
    ["J", "Q", "A"],
  ]);
  const res2 = scatterEngine.evaluate(board4, { bet: 2 });
  assert.equal(res2.scatters[0].count, 4);
  assert.equal(res2.scatters[0].eligible, true);
  assert.equal(res2.scatters[0].matchedTier, 4);
  assert.equal(res2.scatters[0].payoutMultiplier, 10);
  assert.equal(res2.scatters[0].payout, 20);
  assert.equal(res2.totalScatterPayout, 20);

  // TEST 3: FIVE SCATTERS (count = 5, multiplier = 25x, bet = 2 -> payout = 50)
  const board5 = createBoardFromSymbolGrid([
    ["A", "SCATTER", "K"],
    ["SCATTER", "J", "A"],
    ["K", "Q", "SCATTER"],
    ["A", "SCATTER", "J"],
    ["SCATTER", "Q", "K"],
  ]);
  const res3 = scatterEngine.evaluate(board5, { bet: 2 });
  assert.equal(res3.scatters[0].count, 5);
  assert.equal(res3.scatters[0].eligible, true);
  assert.equal(res3.scatters[0].matchedTier, 5);
  assert.equal(res3.scatters[0].payoutMultiplier, 25);
  assert.equal(res3.scatters[0].payout, 50);
  assert.equal(res3.totalScatterPayout, 50);

  // TEST 4: BELOW MINIMUM (minimum = 3, count = 2 -> eligible = false, payout = 0)
  const board2 = createBoardFromSymbolGrid([
    ["SCATTER", "A", "K"],
    ["Q", "J", "A"],
    ["K", "A", "Q"],
    ["A", "K", "J"],
    ["J", "Q", "SCATTER"],
  ]);
  const res4 = scatterEngine.evaluate(board2, { bet: 2 });
  assert.equal(res4.scatters[0].count, 2);
  assert.equal(res4.scatters[0].eligible, false);
  assert.equal(res4.scatters[0].matchedTier, null);
  assert.equal(res4.scatters[0].payoutMultiplier, 0);
  assert.equal(res4.scatters[0].payout, 0);
  assert.equal(res4.scatters[0].triggerEligible, false);
  assert.equal(res4.totalScatterPayout, 0);
  assert.equal(res4.triggered, false);

  // TEST 5: POSITION INDEPENDENCE (Move same number of Scatters to completely different board positions)
  const board3AltA = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["J", "A", "K"],
    ["Q", "J", "A"],
    ["K", "Q", "J"],
    ["SCATTER", "SCATTER", "SCATTER"], // All 3 stacked on rightmost reel!
  ]);
  const board3AltB = createBoardFromSymbolGrid([
    ["A", "SCATTER", "Q"],
    ["J", "A", "K"],
    ["Q", "J", "SCATTER"],
    ["SCATTER", "Q", "J"],
    ["A", "K", "Q"],
  ]);
  const res5A = scatterEngine.evaluate(board3AltA, { bet: 2 });
  const res5B = scatterEngine.evaluate(board3AltB, { bet: 2 });
  assert.equal(res5A.scatters[0].count, 3);
  assert.equal(res5B.scatters[0].count, 3);
  assert.equal(res5A.scatters[0].eligible, res1.scatters[0].eligible);
  assert.equal(
    res5A.scatters[0].payoutMultiplier,
    res1.scatters[0].payoutMultiplier,
  );
  assert.equal(res5A.scatters[0].payout, res1.scatters[0].payout);
  assert.equal(
    res5A.scatters[0].triggerEligible,
    res1.scatters[0].triggerEligible,
  );
  assert.equal(res5B.scatters[0].payout, res1.scatters[0].payout);
  assert.equal(res5A.totalScatterPayout, res5B.totalScatterPayout);

  // TEST 6: SCATTER NOT ON PAYLINE (A Scatter counts even when not on any active payline)
  // Active payline is only row 0 ([0,0,0,0,0]), while all 3 Scatters are on row 2
  const activeTopLineOnly = [makePayline("line-top", 0, [0, 0, 0, 0, 0])];
  const boardOffPayline = createBoardFromSymbolGrid([
    ["A", "K", "SCATTER"],
    ["K", "Q", "A"],
    ["Q", "J", "SCATTER"],
    ["J", "A", "K"],
    ["A", "K", "SCATTER"],
  ]);
  const paylineEngine = createPaylineEngine();
  const lineEval6 = paylineEngine.evaluate(boardOffPayline, activeTopLineOnly);
  assert.equal(lineEval6.matches[0].matchCount, 1); // No line win on top line
  const res6 = scatterEngine.evaluate(boardOffPayline, { bet: 2 });
  assert.equal(res6.scatters[0].count, 3);
  assert.equal(res6.scatters[0].eligible, true);
  assert.equal(res6.scatters[0].payout, 10);

  // TEST 7: ADDITIVE RESULT (3 SCATTER symbols + A pays on a fixed payline -> regular line payout + Scatter payout)
  const boardAdditive = createBoardFromSymbolGrid([
    ["A", "K", "SCATTER"],
    ["A", "Q", "J"],
    ["A", "J", "SCATTER"],
    ["K", "A", "Q"],
    ["Q", "K", "SCATTER"],
  ]);
  const paytableDef: PaytableDefinition = {
    payoutType: "multiplier",
    betBasis: "perLine",
    minMatchCount: 3,
    entries: [
      { symbolId: "A", payouts: { 3: 4, 4: 10, 5: 20 } },
      { symbolId: "K", payouts: { 3: 3, 4: 8, 5: 15 } },
      { symbolId: "Q", payouts: { 3: 2, 4: 5, 5: 10 } },
      { symbolId: "J", payouts: { 3: 1, 4: 3, 5: 6 } },
    ],
  };
  const paytableEngine = createPaytableEngine(paytableDef);
  const lineMatches = paylineEngine.evaluate(boardAdditive, activeTopLineOnly);
  const linePayouts = paytableEngine.evaluate(lineMatches, { bet: 2 });
  const scatterPayouts = scatterEngine.evaluate(boardAdditive, { bet: 2 });
  const combined = combineLineAndScatterPayouts(linePayouts, scatterPayouts);

  assert.equal(linePayouts.totalPayout, 8); // 3x A @ 4x * bet 2 = 8
  assert.equal(scatterPayouts.totalScatterPayout, 10); // 3x SCATTER @ 5x * bet 2 = 10
  assert.equal(combined.totalLinePayout, 8);
  assert.equal(combined.totalScatterPayout, 10);
  assert.equal(combined.totalAdditivePayout, 18); // 8 + 10 = 18 (additive!)

  // TEST 8: WILD NOT SCATTER (Wild symbols are not counted as Scatter unless explicitly configured)
  const boardWithWilds = createBoardFromSymbolGrid([
    ["SCATTER", "A", "K"],
    ["WILD", "J", "A"],
    ["K", "SCATTER", "Q"],
    ["A", "WILD", "J"],
    ["J", "Q", "WILD"],
  ]);
  const res8 = scatterEngine.evaluate(boardWithWilds, { bet: 2 });
  assert.equal(res8.scatters[0].count, 2); // Only the 2 actual SCATTER cells count; the 3 WILDs are ignored
  assert.equal(res8.scatters[0].eligible, false);
  assert.equal(res8.scatters[0].payout, 0);

  // TEST 9: MULTIPLE SCATTER SYMBOLS (Remain separate and sum into totalScatterPayout)
  const multiScatterEngine = createScatterEngine({
    enabled: true,
    symbolIds: ["SCATTER_GOLD", "SCATTER_SILVER"],
    knownSymbolIds: ["A", "K", "SCATTER_GOLD", "SCATTER_SILVER"],
    rules: [
      {
        scatterSymbolId: "SCATTER_GOLD",
        evaluatesAnywhere: true,
        independentOfPaylines: true,
        payoutReferenceSymbolId: "SCATTER_GOLD",
        triggerFeatureId: "feature-gold-spins",
        minimumTriggerCount: 3,
        minimumCount: 3,
        payouts: { 3: 5, 4: 15, 5: 50 },
      },
      {
        scatterSymbolId: "SCATTER_SILVER",
        evaluatesAnywhere: true,
        independentOfPaylines: true,
        payoutReferenceSymbolId: "SCATTER_SILVER",
        triggerFeatureId: null,
        minimumTriggerCount: 3,
        minimumCount: 2,
        payouts: { 2: 2, 3: 6, 4: 12 },
      },
    ],
  });
  const boardMulti = createBoardFromSymbolGrid([
    ["SCATTER_GOLD", "SCATTER_SILVER", "A"],
    ["A", "SCATTER_GOLD", "K"],
    ["K", "A", "SCATTER_GOLD"],
    ["SCATTER_SILVER", "K", "A"],
    ["A", "K", "A"],
  ]);
  const res9 = multiScatterEngine.evaluate(boardMulti, { bet: 2 });
  assert.equal(res9.scatters.length, 2);
  const goldRes = res9.scatters.find((s) => s.symbolId === "SCATTER_GOLD")!;
  const silverRes = res9.scatters.find((s) => s.symbolId === "SCATTER_SILVER")!;
  assert.equal(goldRes.count, 3);
  assert.equal(goldRes.payoutMultiplier, 5);
  assert.equal(goldRes.payout, 10);
  assert.equal(goldRes.triggerEligible, true);

  assert.equal(silverRes.count, 2);
  assert.equal(silverRes.payoutMultiplier, 2);
  assert.equal(silverRes.payout, 4);
  assert.equal(silverRes.triggerEligible, false);

  assert.equal(res9.totalScatterMultiplier, 7);
  assert.equal(res9.totalScatterPayout, 14); // 10 + 4
  assert.equal(res9.triggered, true);
  assert.deepEqual(res9.triggeredFeatureIds, ["feature-gold-spins"]);

  // TEST 10: ZERO PAYOUT (Configured Scatter payout = 0 -> valid non-paying result)
  const zeroPayoutEngine = createScatterEngine({
    enabled: true,
    symbolIds: ["SCATTER"],
    rules: [
      {
        scatterSymbolId: "SCATTER",
        evaluatesAnywhere: true,
        independentOfPaylines: true,
        payoutReferenceSymbolId: "SCATTER",
        triggerFeatureId: "feature-free-spins",
        minimumTriggerCount: 3,
        minimumCount: 3,
        payouts: { 3: 0, 4: 0, 5: 0 },
      },
    ],
  });
  const res10 = zeroPayoutEngine.evaluate(board3, { bet: 2 });
  assert.equal(res10.scatters[0].count, 3);
  assert.equal(res10.scatters[0].matchedTier, 3);
  assert.equal(res10.scatters[0].payoutMultiplier, 0);
  assert.equal(res10.scatters[0].payout, 0);
  assert.equal(res10.scatters[0].eligible, false);
  assert.equal(res10.scatters[0].triggerEligible, true);
  assert.equal(res10.totalScatterPayout, 0);

  // TEST 11: NO PAYOUT TIER (No configured tier for count -> no payout, never silently uses another tier below max)
  const gappedTierEngine = createScatterEngine({
    enabled: true,
    symbolIds: ["SCATTER"],
    rules: [
      {
        scatterSymbolId: "SCATTER",
        evaluatesAnywhere: true,
        independentOfPaylines: true,
        payoutReferenceSymbolId: "SCATTER",
        triggerFeatureId: null,
        minimumTriggerCount: 3,
        minimumCount: 3,
        payouts: { 3: 5, 5: 25 }, // Tier 4 is intentionally missing
      },
    ],
  });
  const res11 = gappedTierEngine.evaluate(board4, { bet: 2 });
  assert.equal(res11.scatters[0].count, 4);
  assert.equal(res11.scatters[0].matchedTier, null);
  assert.equal(res11.scatters[0].eligible, false);
  assert.equal(res11.scatters[0].payoutMultiplier, 0);
  assert.equal(res11.scatters[0].payout, 0);

  // OVER-CAP COUNT: Board contains 6 Scatters when highest configured tier is 5
  const board6 = createBoardFromSymbolGrid([
    ["SCATTER", "SCATTER", "K"],
    ["SCATTER", "J", "A"],
    ["K", "Q", "SCATTER"],
    ["A", "SCATTER", "J"],
    ["SCATTER", "Q", "K"],
  ]);
  const resOverCap = scatterEngine.evaluate(board6, { bet: 2 });
  assert.equal(resOverCap.scatters[0].count, 6);
  assert.equal(resOverCap.scatters[0].matchedTier, 5);
  assert.equal(resOverCap.scatters[0].overCapApplied, true);
  assert.equal(resOverCap.scatters[0].eligible, true);
  assert.equal(resOverCap.scatters[0].payoutMultiplier, 25);
  assert.equal(resOverCap.scatters[0].payout, 50);

  // Over-cap with explicit exactOnly policy returns non-paying when exceeding max tier
  const exactOnlyEngine = createScatterEngine({
    ...SCATTER_FIXTURE_CONFIG,
    overCapPolicy: "exactOnly",
    rules: [
      {
        ...SCATTER_FIXTURE_CONFIG.rules![0],
        overCapPolicy: "exactOnly",
      },
    ],
  });
  const resExactOnly = exactOnlyEngine.evaluate(board6, { bet: 2 });
  assert.equal(resExactOnly.scatters[0].count, 6);
  assert.equal(resExactOnly.scatters[0].matchedTier, null);
  assert.equal(resExactOnly.scatters[0].overCapApplied, false);
  assert.equal(resExactOnly.scatters[0].eligible, false);
  assert.equal(resExactOnly.scatters[0].payout, 0);
});

test("B08.2 — Validation & structured error model (TEST 12 + Config & Board Error Handling)", () => {
  const scatterEngine = createScatterEngine(SCATTER_FIXTURE_CONFIG);
  const validBoard = createBoardFromSymbolGrid([
    ["SCATTER", "A", "K"],
    ["Q", "J", "A"],
    ["K", "SCATTER", "Q"],
    ["A", "K", "J"],
    ["J", "Q", "SCATTER"],
  ]);

  // TEST 12: BET VALIDATION (Reject negative, NaN, Infinity)
  for (const invalidBet of [-1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => scatterEngine.evaluate(validBoard, { bet: invalidBet }),
      (err: unknown) =>
        err instanceof InvalidBetError &&
        err instanceof SlotEngineError &&
        err.code === "INVALID_BET",
      `Expected InvalidBetError for bet=${String(invalidBet)}`,
    );
  }

  // Zero bet is valid and produces 0 currency payout while preserving multiplier
  const zeroBetRes = scatterEngine.evaluate(validBoard, { bet: 0 });
  assert.equal(zeroBetRes.scatters[0].count, 3);
  assert.equal(zeroBetRes.scatters[0].payoutMultiplier, 5);
  assert.equal(zeroBetRes.scatters[0].payout, 0);

  // Invalid Board errors
  assert.throws(
    () => scatterEngine.evaluate(null as unknown as Board, { bet: 1 }),
    (err: unknown) =>
      err instanceof InvalidBoardError && err.code === "INVALID_BOARD",
  );
  assert.throws(
    () =>
      scatterEngine.evaluate(
        {
          reelCount: 5,
          rowCount: 3,
          columns: 5,
          rows: 3,
          reelHeights: [3, 3, 3, 3, 3],
          cells: [],
        },
        { bet: 1 },
      ),
    (err: unknown) =>
      err instanceof InvalidBoardError && err.code === "INVALID_BOARD",
  );

  // UnknownScatterSymbolError
  assert.throws(
    () =>
      createScatterEngine({
        knownSymbolIds: ["A", "K", "Q"],
        symbolIds: ["GHOST_SCATTER"],
      }),
    (err: unknown) =>
      err instanceof UnknownScatterSymbolError &&
      err.code === "UNKNOWN_SCATTER_SYMBOL",
  );

  assert.throws(
    () => scatterEngine.evaluateSymbol(validBoard, "NOT_A_SCATTER", { bet: 2 }),
    (err: unknown) =>
      err instanceof UnknownScatterSymbolError &&
      err.code === "UNKNOWN_SCATTER_SYMBOL",
  );

  // InvalidScatterThresholdError
  assert.throws(
    () =>
      createScatterEngine({
        symbolIds: ["SCATTER"],
        minimumCount: 0,
      }),
    (err: unknown) =>
      err instanceof InvalidScatterThresholdError &&
      err.code === "INVALID_SCATTER_THRESHOLD",
  );

  assert.throws(
    () =>
      createScatterEngine({
        symbolIds: ["SCATTER"],
        minimumTriggerCount: -2,
      }),
    (err: unknown) =>
      err instanceof InvalidScatterThresholdError &&
      err.code === "INVALID_SCATTER_THRESHOLD",
  );

  // InvalidScatterPayoutError
  assert.throws(
    () =>
      createScatterEngine({
        symbolIds: ["SCATTER"],
        payouts: { 3: -5 },
      }),
    (err: unknown) =>
      err instanceof InvalidScatterPayoutError &&
      err.code === "INVALID_SCATTER_PAYOUT",
  );

  assert.throws(
    () =>
      createScatterEngine({
        symbolIds: ["SCATTER"],
        payouts: { 3: Number.NaN },
      }),
    (err: unknown) =>
      err instanceof InvalidScatterPayoutError &&
      err.code === "INVALID_SCATTER_PAYOUT",
  );

  // InvalidScatterConfigurationError
  assert.throws(
    () => createScatterEngine({} as ScatterEngineConfigObject),
    (err: unknown) =>
      err instanceof InvalidScatterConfigurationError &&
      err.code === "INVALID_SCATTER_CONFIG",
  );
});

test("B08.3 — Determinism, No RNG, Immutability, Serialization, Trigger Separation, Feature Non-Execution, and B02+B04+B05+B06+B07+B08 Pipeline (TEST 13 through TEST 18)", () => {
  const scatterEngine = new DeterministicScatterEngine(SCATTER_FIXTURE_CONFIG);
  const board = createBoardFromSymbolGrid([
    ["SCATTER", "A", "K"],
    ["WILD", "J", "A"],
    ["A", "SCATTER", "Q"],
    ["A", "K", "J"],
    ["J", "Q", "SCATTER"],
  ]);

  const boardSnapshotBefore = JSON.stringify(board);
  const configSnapshotBefore = JSON.stringify(SCATTER_FIXTURE_CONFIG);

  // TEST 13: DETERMINISM (Same Board + Config = identical result across 50 runs)
  const firstRun = scatterEngine.evaluate(board, { bet: 2 });
  for (let i = 0; i < 50; i += 1) {
    const nextRun = scatterEngine.evaluate(board, { bet: 2 });
    assert.deepEqual(nextRun, firstRun);
  }

  // TEST 14: NO RNG (Verify B08 requires no RandomSource and accepts only Board + Config + PayoutContext)
  assert.equal(scatterEngine.evaluate.length <= 3, true);
  const standaloneResult = evaluateScatters(board, SCATTER_FIXTURE_CONFIG, {
    bet: 2,
  });
  assert.deepEqual(standaloneResult, firstRun);

  // TEST 15: INPUT IMMUTABILITY (Board and config remain completely unchanged and frozen)
  assert.equal(JSON.stringify(board), boardSnapshotBefore);
  assert.equal(JSON.stringify(SCATTER_FIXTURE_CONFIG), configSnapshotBefore);
  assert.equal(Object.isFrozen(firstRun), true);
  assert.equal(Object.isFrozen(firstRun.scatters), true);
  assert.equal(Object.isFrozen(firstRun.scatters[0]), true);
  assert.equal(Object.isFrozen(firstRun.scatters[0].positions), true);

  // TEST 16: SERIALIZATION (Result serializes and deserializes losslessly)
  const json = serializeScatterEvaluationResult(firstRun);
  const restored = deserializeScatterEvaluationResult(json);
  assert.deepEqual(restored, firstRun);

  // TEST 17: TRIGGER SEPARATION
  // Case A: Pays without triggering a feature (2 Scatters pay 2x, trigger requires 3)
  // Case B: Triggers a feature without paying (3 Scatters pay 0x, trigger requires 3)
  const separatedEngine = createScatterEngine({
    enabled: true,
    symbolIds: ["SCATTER"],
    rules: [
      {
        scatterSymbolId: "SCATTER",
        evaluatesAnywhere: true,
        independentOfPaylines: true,
        payoutReferenceSymbolId: "SCATTER",
        triggerFeatureId: "feature-free-spins",
        minimumTriggerCount: 4,
        minimumCount: 2,
        payouts: { 2: 2, 3: 5, 4: 0 },
      },
    ],
  });
  const resPaysNoTrigger = separatedEngine.evaluate(board, { bet: 2 }); // 3 Scatters
  assert.equal(resPaysNoTrigger.scatters[0].count, 3);
  assert.equal(resPaysNoTrigger.scatters[0].eligible, true);
  assert.equal(resPaysNoTrigger.scatters[0].payout, 10);
  assert.equal(resPaysNoTrigger.scatters[0].triggerEligible, false);
  assert.equal(resPaysNoTrigger.triggered, false);

  const board4Scatters = createBoardFromSymbolGrid([
    ["SCATTER", "A", "K"],
    ["Q", "SCATTER", "A"],
    ["K", "A", "SCATTER"],
    ["SCATTER", "K", "J"],
    ["J", "Q", "A"],
  ]);
  const resTriggersNoPayout = separatedEngine.evaluate(board4Scatters, {
    bet: 2,
  });
  assert.equal(resTriggersNoPayout.scatters[0].count, 4);
  assert.equal(resTriggersNoPayout.scatters[0].eligible, false);
  assert.equal(resTriggersNoPayout.scatters[0].payout, 0);
  assert.equal(resTriggersNoPayout.scatters[0].triggerEligible, true);
  assert.equal(resTriggersNoPayout.triggered, true);

  // TEST 18: FEATURE NON-EXECUTION
  // Verify B08 only reports triggerEligible / triggeredFeatureIds and never creates or mutates feature session state
  assert.equal("freeSpinsRemaining" in resTriggersNoPayout, false);
  assert.equal("nextState" in resTriggersNoPayout, false);
  assert.deepEqual(Object.keys(resTriggersNoPayout).sort(), [
    "bet",
    "scatters",
    "totalScatterMultiplier",
    "totalScatterPayout",
    "triggered",
    "triggeredFeatureIds",
  ]);

  // Full B02 -> B03 -> B04 -> B05 -> B06 -> B07 -> B08 pipeline integration test
  const canonicalDef = createSampleGameDefinition();
  const gameConfig = toGameConfig(canonicalDef);
  const rng = new SeededRNG("b08-pipeline-seed");
  const rngSnapBefore = rng.snapshot();
  const reelEngine = createReelEngine();
  // Stop 3 on Reels 0, 1, 2 places row 0 = sym-high-sun-disk, row 1 = sym-wild, row 2 = sym-scatter
  const resolvedBoard = reelEngine.resolveFromStops(
    gameConfig,
    [3, 3, 3, 0, 0],
  ).board;

  const wildEngine = createWildEngine(gameConfig);
  const paytableEngine = createPaytableEngine(gameConfig);
  const gameScatterEngine = createScatterEngine(gameConfig);

  const wildLineEval = wildEngine.resolvePaylines(
    resolvedBoard,
    gameConfig.paylines,
  );
  const linePayoutResult = paytableEngine.evaluate(wildLineEval.matches, {
    bet: 2,
  });
  const scatterEvalResult = gameScatterEngine.evaluate(resolvedBoard, {
    bet: 2,
  });
  // Verify SeededRNG state was never touched by B08
  assert.deepEqual(rng.snapshot(), rngSnapBefore);
  const combinedPipeline = combineLineAndScatterPayouts(
    linePayoutResult,
    scatterEvalResult,
  );

  assert.equal(scatterEvalResult.scatters.length, 1);
  assert.equal(scatterEvalResult.scatters[0].symbolId, "sym-scatter");
  assert.equal(scatterEvalResult.scatters[0].count, 3);
  assert.equal(scatterEvalResult.scatters[0].eligible, true);
  assert.equal(scatterEvalResult.scatters[0].triggerEligible, true);
  assert.ok(linePayoutResult.totalPayout > 0);
  assert.ok(scatterEvalResult.totalScatterPayout > 0);
  assert.equal(
    combinedPipeline.totalAdditivePayout,
    linePayoutResult.totalPayout + scatterEvalResult.totalScatterPayout,
  );

  // Also verify studio-created GameBlueprint works seamlessly with B08
  const studioBlueprint = createBlueprint({
    id: "b08-studio-test",
    title: "Temple of Scatters",
    theme: "Aztec Gold",
    columns: 5,
    rows: 3,
  });
  const studioConfig = adaptBlueprintToGameConfig(studioBlueprint);
  const studioScatterEngine = createScatterEngine(studioConfig);
  assert.equal(studioScatterEngine.getNormalizedConfig().enabled, true);
  assert.ok(studioScatterEngine.getNormalizedConfig().rules.length >= 1);
});
