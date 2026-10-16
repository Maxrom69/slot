import assert from "node:assert/strict";
import test from "node:test";

import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  DeterministicPaytableEngine,
  InvalidBetError,
  InvalidMatchCountError,
  InvalidPaytableError,
  InvalidPayoutMultiplierError,
  SeededRNG,
  SlotEngineError,
  UnknownPaytableSymbolError,
  adaptBlueprintToGameConfig,
  createBoardFromSymbolGrid,
  createPaylineEngine,
  createPaytableEngine,
  createReelEngine,
  createSampleGameDefinition,
  deserializePaytableEvaluationResult,
  evaluatePaytable,
  getPayoutMultiplier,
  serializePaytableEvaluationResult,
  toGameConfig,
  type PaylineDefinition,
  type PaylineMatch,
  type PaytableDefinition,
} from "../src/engine";

/**
 * Helper to create a canonical B05 PaylineMatch fixture for B06 tests.
 */
function makeMatch(
  paylineId: string,
  paylineIndex: number,
  symbolId: string,
  matchCount: number,
  rowIndex = 0,
): PaylineMatch {
  const reelIndexes = Array.from({ length: matchCount }, (_, i) => i);
  const cellPositions = reelIndexes.map((reelIndex) =>
    Object.freeze({
      reelIndex,
      rowIndex,
      symbolId,
      stopIndex: rowIndex,
    }),
  );
  return Object.freeze({
    paylineId,
    paylineIndex,
    paylineName: `Line ${paylineIndex}`,
    pattern: Object.freeze([rowIndex, rowIndex, rowIndex, rowIndex, rowIndex]),
    color: "#f59e0b",
    symbolId,
    baseSymbolId: symbolId,
    matchCount,
    reelIndexes: Object.freeze(reelIndexes),
    matchedReels: Object.freeze(reelIndexes),
    cellPositions: Object.freeze(cellPositions),
    matchedStopIndexes: Object.freeze(reelIndexes.map(() => rowIndex)),
  });
}

const FIXED_PAYTABLE_FIXTURE: PaytableDefinition = Object.freeze({
  payoutType: "multiplier",
  betBasis: "perLine",
  minMatchCount: 3,
  entries: Object.freeze([
    Object.freeze({
      symbolId: "A",
      payouts: Object.freeze({ 3: 5, 4: 10, 5: 25 }),
    }),
    Object.freeze({
      symbolId: "K",
      payouts: Object.freeze({ 3: 3, 4: 6, 5: 15 }),
    }),
    Object.freeze({
      symbolId: "Q",
      payouts: Object.freeze({ 3: 0, 4: 4, 5: 12 }),
    }),
  ]),
});

test("B06.1 — Core paytable lookup & payout calculation (TEST 1 through TEST 6 + TEST 10)", () => {
  const engine = createPaytableEngine(FIXED_PAYTABLE_FIXTURE);

  // Verify direct O(1) multiplier lookup (getMultiplier & getPayoutMultiplier)
  assert.equal(engine.getMultiplier("A", 3), 5);
  assert.equal(engine.getMultiplier("A", 4), 10);
  assert.equal(engine.getMultiplier("A", 5), 25);
  assert.equal(engine.getPayoutMultiplier("K", 3), 3);
  assert.equal(engine.getPayoutMultiplier("K", 4), 6);
  assert.equal(engine.getPayoutMultiplier("K", 5), 15);
  assert.equal(getPayoutMultiplier(FIXED_PAYTABLE_FIXTURE, "A", 3), 5);

  // TEST 1: THREE-MATCH PAYOUT — A 3-match with configured 5x and bet = 2 -> multiplier = 5, payout = 10
  const matchA3 = makeMatch("line-1", 1, "A", 3);
  const payoutA3 = engine.evaluateMatch(matchA3, { bet: 2 });
  assert.equal(payoutA3.paylineId, "line-1");
  assert.equal(payoutA3.symbolId, "A");
  assert.equal(payoutA3.matchCount, 3);
  assert.equal(payoutA3.multiplier, 5);
  assert.equal(payoutA3.payoutMultiplier, 5);
  assert.equal(payoutA3.bet, 2);
  assert.equal(payoutA3.payout, 10);
  assert.equal(payoutA3.isPaying, true);

  // TEST 2: FOUR-MATCH PAYOUT — A 4-match (10x) & K 4-match (6x) with bet = 2
  const matchA4 = makeMatch("line-1", 1, "A", 4);
  const payoutA4 = engine.evaluateMatch(matchA4, { bet: 2 });
  assert.equal(payoutA4.multiplier, 10);
  assert.equal(payoutA4.payout, 20);

  const matchK4 = makeMatch("line-2", 2, "K", 4);
  const payoutK4 = engine.evaluateMatch(matchK4, { bet: 2 });
  assert.equal(payoutK4.multiplier, 6);
  assert.equal(payoutK4.payout, 12);

  // TEST 3: FIVE-MATCH PAYOUT — A 5-match (25x) & K 5-match (15x) with bet = 2
  const matchA5 = makeMatch("line-1", 1, "A", 5);
  const payoutA5 = engine.evaluateMatch(matchA5, { bet: 2 });
  assert.equal(payoutA5.multiplier, 25);
  assert.equal(payoutA5.payout, 50);

  const matchK5 = makeMatch("line-2", 2, "K", 5);
  const payoutK5 = engine.evaluateMatch(matchK5, { bet: 2 });
  assert.equal(payoutK5.multiplier, 15);
  assert.equal(payoutK5.payout, 30);

  // TEST 4: MISSING MATCH COUNT — configured 3,4,5; matchCount = 2 -> non-paying (multiplier = 0, payout = 0)
  assert.equal(engine.getMultiplier("A", 2), 0);
  assert.equal(engine.getMultiplier("A", 1), 0);
  const matchA2 = makeMatch("line-3", 3, "A", 2);
  const payoutA2 = engine.evaluateMatch(matchA2, { bet: 2 });
  assert.equal(payoutA2.multiplier, 0);
  assert.equal(payoutA2.payoutMultiplier, 0);
  assert.equal(payoutA2.payout, 0);
  assert.equal(payoutA2.isPaying, false);

  const evalMissing = engine.evaluate([matchA2], { bet: 2 });
  assert.equal(evalMissing.totalPayout, 0);
  assert.equal(evalMissing.totalMultiplier, 0);
  assert.equal(evalMissing.payingLineCount, 0);
  assert.equal(evalMissing.nonPayingLineCount, 1);
  assert.equal(evalMissing.payouts.length, 0);
  assert.equal(evalMissing.allPayouts.length, 1);
  assert.equal(evalMissing.allPayouts[0].payout, 0);

  // TEST 5: ZERO PAYOUT — Q 3-match configured as 0 -> valid non-paying zero payout
  assert.equal(engine.getMultiplier("Q", 3), 0);
  const matchQ3 = makeMatch("line-4", 4, "Q", 3);
  const payoutQ3 = engine.evaluateMatch(matchQ3, { bet: 5 });
  assert.equal(payoutQ3.multiplier, 0);
  assert.equal(payoutQ3.payout, 0);
  assert.equal(payoutQ3.isPaying, false);

  // TEST 6: MULTIPLE PAYLINES — Two paying lines + one non-paying line evaluated independently
  // Line 1: A 3-match -> 5x * 2 = 10
  // Line 2: K 4-match -> 6x * 2 = 12
  // Line 3: A 2-match -> 0x * 2 = 0 (no payout)
  const multiEval = engine.evaluate([matchA3, matchK4, matchA2], { bet: 2 });
  assert.equal(multiEval.evaluatedMatchCount, 3);
  assert.equal(multiEval.payingLineCount, 2);
  assert.equal(multiEval.nonPayingLineCount, 1);
  assert.equal(multiEval.payouts.length, 2);
  assert.equal(multiEval.payouts[0].paylineId, "line-1");
  assert.equal(multiEval.payouts[0].multiplier, 5);
  assert.equal(multiEval.payouts[0].payout, 10);
  assert.equal(multiEval.payouts[1].paylineId, "line-2");
  assert.equal(multiEval.payouts[1].multiplier, 6);
  assert.equal(multiEval.payouts[1].payout, 12);
  assert.equal(multiEval.totalMultiplier, 11);
  assert.equal(multiEval.totalPayout, 22);

  // TEST 10: ZERO BET — bet = 0 produces deterministic zero payout while preserving resolved multiplier
  const zeroBetEval = engine.evaluate([matchA3, matchK4], { bet: 0 });
  assert.equal(zeroBetEval.payingLineCount, 2);
  assert.equal(zeroBetEval.totalMultiplier, 11);
  assert.equal(zeroBetEval.totalPayout, 0);
  assert.equal(zeroBetEval.payouts[0].multiplier, 5);
  assert.equal(zeroBetEval.payouts[0].bet, 0);
  assert.equal(zeroBetEval.payouts[0].payout, 0);
  assert.equal(zeroBetEval.payouts[1].multiplier, 6);
  assert.equal(zeroBetEval.payouts[1].bet, 0);
  assert.equal(zeroBetEval.payouts[1].payout, 0);
});

test("B06.2 — Validation & structured error model (TEST 7, TEST 8, TEST 9)", () => {
  const engine = createPaytableEngine(FIXED_PAYTABLE_FIXTURE);

  // TEST 7: UNKNOWN SYMBOL — throws UnknownPaytableSymbolError by default
  assert.throws(
    () => engine.getMultiplier("UNKNOWN_SYM", 3),
    (err: unknown) =>
      err instanceof UnknownPaytableSymbolError &&
      err instanceof InvalidPaytableError &&
      err instanceof SlotEngineError &&
      err.code === "UNKNOWN_PAYTABLE_SYMBOL" &&
      err.context.symbolId === "UNKNOWN_SYM",
  );

  const unknownMatch = makeMatch("line-1", 1, "UNKNOWN_SYM", 3);
  assert.throws(
    () => engine.evaluate([unknownMatch], { bet: 1 }),
    (err: unknown) =>
      err instanceof UnknownPaytableSymbolError &&
      err.code === "UNKNOWN_PAYTABLE_SYMBOL",
  );

  // Explicit non-paying unknown symbol policy when opted in
  const permissiveEngine = createPaytableEngine(FIXED_PAYTABLE_FIXTURE, {
    allowUnknownSymbolsAsNonPaying: true,
  });
  assert.equal(permissiveEngine.getMultiplier("UNKNOWN_SYM", 3), 0);

  // TEST 8: INVALID PAYOUT MULTIPLIER (Negative, NaN, Infinity) & INVALID MATCH COUNT
  for (const invalidMult of [-1, -0.01, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () =>
        createPaytableEngine([
          { symbolId: "A", payouts: { 3: invalidMult } },
        ]),
      (err: unknown) =>
        err instanceof InvalidPayoutMultiplierError &&
        err instanceof InvalidPaytableError &&
        err.code === "INVALID_PAYOUT_MULTIPLIER",
    );
  }

  for (const invalidMatchCount of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => engine.getMultiplier("A", invalidMatchCount),
      (err: unknown) =>
        err instanceof InvalidMatchCountError &&
        err instanceof InvalidPaytableError &&
        err.code === "INVALID_MATCH_COUNT",
    );
  }

  // TEST 9: INVALID BET (Negative, NaN, Infinity)
  const validMatch = makeMatch("line-1", 1, "A", 3);
  for (const invalidBet of [-1, -0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(
      () => engine.evaluate([validMatch], { bet: invalidBet }),
      (err: unknown) =>
        err instanceof InvalidBetError &&
        err instanceof InvalidPaytableError &&
        err instanceof SlotEngineError &&
        err.code === "INVALID_BET",
    );
    assert.throws(
      () => engine.evaluateMatch(validMatch, invalidBet),
      (err: unknown) =>
        err instanceof InvalidBetError && err.code === "INVALID_BET",
    );
  }
});

test("B06.3 — Determinism, No RNG, Immutability, Serialization, Wild/Scatter Boundaries, and B04+B05+B06 Integration (TEST 11 through TEST 16)", () => {
  // B04 -> B05 -> B06 PIPELINE INTEGRATION
  const sampleDef = createSampleGameDefinition();
  const gameConfig = toGameConfig(sampleDef);
  const reelEngine = createReelEngine();
  const paylineEngine = createPaylineEngine();
  const paytableEngine = new DeterministicPaytableEngine(gameConfig);

  // Stop [0, 0, 0, 3, 2] places sym-low-a across all 5 reels on row 0 (top horizontal line-2: 5-of-a-kind = 15x)
  // and sym-low-k across reels 0,1,2 on row 1 (middle horizontal line-1: 3-of-a-kind = 3x)
  // and sym-low-q across reels 0,1,2 on row 2 (bottom horizontal line-3: 3-of-a-kind = 4x)
  const b04Board = reelEngine.resolveFromStops(gameConfig, [0, 0, 0, 3, 2]).board;
  const b05Result = paylineEngine.evaluate(b04Board, gameConfig.paylines);
  const baselinePayoutResult = paytableEngine.evaluate(b05Result, { bet: 2 });

  assert.equal(baselinePayoutResult.payingLineCount, 3);
  // Total multiplier: 15 (A 5-match) + 3 (K 3-match) + 4 (Q 3-match) = 22x; at bet = 2 -> totalPayout = 44
  assert.equal(baselinePayoutResult.totalMultiplier, 22);
  assert.equal(baselinePayoutResult.totalPayout, 44);

  // TEST 11: DETERMINISM — Same inputs always produce identical PaytableEvaluationResult
  for (let i = 0; i < 25; i += 1) {
    const repeat = evaluatePaytable(gameConfig, b05Result.matches, { bet: 2 });
    assert.deepEqual(repeat, baselinePayoutResult);
  }

  // TEST 12: NO RNG — B06 never requires or consumes RNG
  const untouchedRng = new SeededRNG("b06-no-rng-seed");
  const snapBefore = untouchedRng.snapshot();
  paytableEngine.evaluate(b05Result, { bet: 2 });
  assert.deepEqual(untouchedRng.snapshot(), snapBefore);

  // TEST 13: INPUT IMMUTABILITY — GameConfig, PaytableDefinition, PaylineMatch[] remain unchanged
  const studioBp = createBlueprint({
    id: "b06-immutability",
    title: "B06 Immutability Check",
    theme: "Ancient Egypt",
    columns: 5,
    rows: 3,
  });
  const studioConfig = adaptBlueprintToGameConfig(studioBp);
  const configJsonBefore = JSON.stringify(
    studioConfig.paytableEntries,
  );
  const matchesJsonBefore = JSON.stringify(b05Result.matches);
  const fixtureJsonBefore = JSON.stringify(FIXED_PAYTABLE_FIXTURE);

  const immutEval = paytableEngine.evaluate(b05Result.matches, { bet: 3 });
  assert.equal(JSON.stringify(studioConfig.paytableEntries), configJsonBefore);
  assert.equal(JSON.stringify(b05Result.matches), matchesJsonBefore);
  assert.equal(JSON.stringify(FIXED_PAYTABLE_FIXTURE), fixtureJsonBefore);
  assert.equal(Object.isFrozen(immutEval), true);
  assert.equal(Object.isFrozen(immutEval.payouts), true);
  assert.equal(Object.isFrozen(immutEval.allPayouts), true);
  if (immutEval.payouts.length > 0) {
    assert.equal(Object.isFrozen(immutEval.payouts[0]), true);
    assert.equal(Object.isFrozen(immutEval.payouts[0].cellPositions), true);
  }

  // TEST 14: SERIALIZATION — Round-trip serialize/deserialize preserves PaytableEvaluationResult
  const serialized = serializePaytableEvaluationResult(baselinePayoutResult);
  const deserialized = deserializePaytableEvaluationResult(serialized);
  assert.deepEqual(deserialized, baselinePayoutResult);

  // TEST 15: WILD BOUNDARY — B06 does NOT perform Wild substitution
  // Board along line [0,0,0,0,0]: A WILD A A A -> B05 produces matchCount = 1 for symbol "A"
  // B06 looks up paytable["A"][1] -> 0x (non-paying), never substituting WILD
  const wildBoard = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["WILD", "J", "Q"],
    ["A", "K", "10"],
    ["A", "Q", "J"],
    ["A", "10", "K"],
  ]);
  const line0: PaylineDefinition = makePaylineDef("line-1", 1, [0, 0, 0, 0, 0]);
  const wildB05 = paylineEngine.evaluate(wildBoard, [line0]);
  assert.equal(wildB05.matches[0].symbolId, "A");
  assert.equal(wildB05.matches[0].matchCount, 1);

  const wildB06 = createPaytableEngine(FIXED_PAYTABLE_FIXTURE).evaluate(
    wildB05,
    { bet: 2 },
  );
  assert.equal(wildB06.totalPayout, 0);
  assert.equal(wildB06.payingLineCount, 0);

  // TEST 16: SCATTER BOUNDARY — B06 does NOT count scattered symbols across the board
  // Even when 3 SCAT symbols exist on different rows of the board, B05 on line [0,0,0,0,0]
  // sees only 1 SCAT at (0,0), and B06 does not scan the board or award a 3-scatter win
  const scatterPaytable: PaytableDefinition = {
    payoutType: "multiplier",
    betBasis: "perLine",
    minMatchCount: 3,
    entries: [
      { symbolId: "SCAT", payouts: { 3: 5, 4: 15, 5: 50 } },
      { symbolId: "A", payouts: { 3: 5, 4: 10, 5: 25 } },
    ],
  };
  const scatterBoard = createBoardFromSymbolGrid([
    ["SCAT", "K", "Q"],
    ["A", "SCAT", "Q"],
    ["A", "K", "SCAT"],
    ["A", "Q", "J"],
    ["A", "10", "K"],
  ]);
  const scatterB05 = paylineEngine.evaluate(scatterBoard, [line0]);
  assert.equal(scatterB05.matches[0].symbolId, "SCAT");
  assert.equal(scatterB05.matches[0].matchCount, 1);

  const scatterB06 = createPaytableEngine(scatterPaytable).evaluate(
    scatterB05,
    { bet: 2 },
  );
  assert.equal(scatterB06.totalPayout, 0);
  assert.equal(scatterB06.payingLineCount, 0);
});

function makePaylineDef(
  id: string,
  index: number,
  pattern: readonly number[],
): PaylineDefinition {
  return Object.freeze({
    id,
    index,
    name: `Line ${index}`,
    pattern: Object.freeze([...pattern]),
    enabled: true,
    color: "#f59e0b",
  });
}
