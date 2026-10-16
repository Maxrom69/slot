import assert from "node:assert/strict";
import test from "node:test";

import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  EXACT_SYMBOL_MATCH_POLICY,
  FixedPaylineEngine,
  InvalidBoardError,
  InvalidPaylineConfigError,
  InvalidPaylineError,
  InvalidRowIndexError,
  MissingPaylineError,
  PaylineGridMismatchError,
  SeededRNG,
  SlotEngineError,
  adaptBlueprintToGameConfig,
  createBoardFromSymbolGrid,
  createPaylineEngine,
  createReelEngine,
  createSampleGameDefinition,
  deserializePaylineEvaluationResult,
  evaluatePayline,
  evaluatePaylines,
  serializePaylineEvaluationResult,
  toGameConfig,
  type PaylineDefinition,
  type SymbolMatchPolicy,
} from "../src/engine";

/**
 * Helper to create a canonical PaylineDefinition for tests.
 */
function makePayline(
  id: string,
  index: number,
  pattern: readonly number[],
  enabled = true,
  color = "#f59e0b",
): PaylineDefinition {
  return Object.freeze({
    id,
    index,
    name: `Line ${index}`,
    pattern: Object.freeze([...pattern]),
    enabled,
    color,
  });
}

test("B05.1 — Core fixed-payline evaluation (TEST 1 through TEST 7: 5-of-a-kind, 3-match, 1-match, diagonal, zigzag, multi-line, disabled)", () => {
  const engine = createPaylineEngine();

  // DETERMINISTIC 5x3 BOARD FIXTURE FROM SPECIFICATION:
  // Reel 0: A K Q
  // Reel 1: A J Q
  // Reel 2: A K 10
  // Reel 3: A Q J
  // Reel 4: A 10 K
  const fixtureBoard = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["A", "J", "Q"],
    ["A", "K", "10"],
    ["A", "Q", "J"],
    ["A", "10", "K"],
  ]);

  // TEST 1: HORIZONTAL 5-OF-A-KIND — Pattern [0,0,0,0,0] produces A A A A A -> matchCount = 5
  const topLine = makePayline("line-1", 1, [0, 0, 0, 0, 0]);
  const match5 = engine.evaluatePayline(fixtureBoard, topLine);
  assert.ok(match5);
  assert.equal(match5.paylineId, "line-1");
  assert.equal(match5.paylineIndex, 1);
  assert.equal(match5.symbolId, "A");
  assert.equal(match5.baseSymbolId, "A");
  assert.equal(match5.matchCount, 5);
  assert.deepEqual(match5.reelIndexes, [0, 1, 2, 3, 4]);
  assert.deepEqual(match5.matchedReels, [0, 1, 2, 3, 4]);
  assert.deepEqual(
    match5.cellPositions.map((c) => ({
      reelIndex: c.reelIndex,
      rowIndex: c.rowIndex,
      symbolId: c.symbolId,
    })),
    [
      { reelIndex: 0, rowIndex: 0, symbolId: "A" },
      { reelIndex: 1, rowIndex: 0, symbolId: "A" },
      { reelIndex: 2, rowIndex: 0, symbolId: "A" },
      { reelIndex: 3, rowIndex: 0, symbolId: "A" },
      { reelIndex: 4, rowIndex: 0, symbolId: "A" },
    ],
  );

  // TEST 2: THREE MATCHES THEN MISMATCH — A A A K Q -> matchCount = 3
  const threeMatchBoard = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["A", "J", "Q"],
    ["A", "K", "10"],
    ["K", "Q", "J"],
    ["Q", "10", "K"],
  ]);
  const match3 = engine.evaluatePayline(threeMatchBoard, topLine);
  assert.ok(match3);
  assert.equal(match3.symbolId, "A");
  assert.equal(match3.matchCount, 3);
  assert.deepEqual(match3.reelIndexes, [0, 1, 2]);
  assert.equal(match3.cellPositions.length, 3);

  // TEST 3: ONE MATCH (MISMATCH ON REEL 1) — A K A A A -> matchCount = 1 (does not continue scanning reels 2..4)
  const oneMatchBoard = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["K", "J", "Q"],
    ["A", "K", "10"],
    ["A", "Q", "J"],
    ["A", "10", "K"],
  ]);
  const match1 = engine.evaluatePayline(oneMatchBoard, topLine);
  assert.ok(match1);
  assert.equal(match1.symbolId, "A");
  assert.equal(match1.matchCount, 1);
  assert.deepEqual(match1.reelIndexes, [0]);
  assert.deepEqual(
    match1.cellPositions.map((c) => ({
      reelIndex: c.reelIndex,
      rowIndex: c.rowIndex,
      symbolId: c.symbolId,
    })),
    [{ reelIndex: 0, rowIndex: 0, symbolId: "A" }],
  );

  // MINIMUM PAYING MATCH BOUNDARY: A A K Q J -> reports actual contiguous matchCount = 2 without paytable filtering
  const twoMatchBoard = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["A", "J", "Q"],
    ["K", "K", "10"],
    ["Q", "Q", "J"],
    ["J", "10", "K"],
  ]);
  const match2 = engine.evaluatePayline(twoMatchBoard, topLine);
  assert.ok(match2);
  assert.equal(match2.symbolId, "A");
  assert.equal(match2.matchCount, 2);
  assert.deepEqual(match2.reelIndexes, [0, 1]);

  // TEST 4: DIAGONAL (V-SHAPE) — Pattern [0,1,2,1,0] reads exact board cells (0,0), (1,1), (2,2), (3,1), (4,0)
  const diagonalBoard = createBoardFromSymbolGrid([
    ["SUN", "K", "Q"],     // row 0 = SUN
    ["A", "SUN", "Q"],     // row 1 = SUN
    ["A", "K", "SUN"],     // row 2 = SUN
    ["A", "SUN", "J"],     // row 1 = SUN
    ["Q", "10", "K"],      // row 0 = Q (mismatch at reel 4)
  ]);
  const diagonalLine = makePayline("line-diag-v", 4, [0, 1, 2, 1, 0]);
  const diagMatch = engine.evaluatePayline(diagonalBoard, diagonalLine);
  assert.ok(diagMatch);
  assert.equal(diagMatch.symbolId, "SUN");
  assert.equal(diagMatch.matchCount, 4);
  assert.deepEqual(diagMatch.reelIndexes, [0, 1, 2, 3]);
  assert.deepEqual(
    diagMatch.cellPositions.map((c) => [c.reelIndex, c.rowIndex, c.symbolId]),
    [
      [0, 0, "SUN"],
      [1, 1, "SUN"],
      [2, 2, "SUN"],
      [3, 1, "SUN"],
    ],
  );

  // TEST 5: ZIGZAG — Pattern [2,0,2,0,2] reads exact board cells (0,2), (1,0), (2,2), (3,0), (4,2)
  const zigzagBoard = createBoardFromSymbolGrid([
    ["A", "K", "777"],     // row 2 = 777
    ["777", "J", "Q"],     // row 0 = 777
    ["A", "K", "777"],     // row 2 = 777
    ["777", "Q", "J"],     // row 0 = 777
    ["A", "10", "777"],    // row 2 = 777
  ]);
  const zigzagLine = makePayline("line-zigzag", 5, [2, 0, 2, 0, 2]);
  const zigzagMatch = engine.evaluatePayline(zigzagBoard, zigzagLine);
  assert.ok(zigzagMatch);
  assert.equal(zigzagMatch.symbolId, "777");
  assert.equal(zigzagMatch.matchCount, 5);
  assert.deepEqual(
    zigzagMatch.cellPositions.map((c) => [c.reelIndex, c.rowIndex, c.symbolId]),
    [
      [0, 2, "777"],
      [1, 0, "777"],
      [2, 2, "777"],
      [3, 0, "777"],
      [4, 2, "777"],
    ],
  );

  // TEST 6 & TEST 7: MULTIPLE PAYLINES & DISABLED PAYLINE
  // Payline 1 ([0,0,0,0,0], enabled) -> A A A K Q (matchCount = 3)
  // Payline 2 ([1,1,1,1,1], enabled) -> K K K Q J (matchCount = 3)
  // Payline 3 ([2,2,2,2,2], disabled) -> Q Q Q Q Q (disabled, must produce NO result)
  const multiLineBoard = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["A", "K", "Q"],
    ["A", "K", "Q"],
    ["K", "Q", "Q"],
    ["Q", "J", "Q"],
  ]);
  const paylines: PaylineDefinition[] = [
    makePayline("line-top", 1, [0, 0, 0, 0, 0], true),
    makePayline("line-mid", 2, [1, 1, 1, 1, 1], true),
    makePayline("line-bot-disabled", 3, [2, 2, 2, 2, 2], false),
  ];

  // Disabled payline evaluated directly returns null
  assert.equal(engine.evaluatePayline(multiLineBoard, paylines[2]), null);

  const multiResult = engine.evaluate(multiLineBoard, paylines);
  assert.equal(multiResult.totalPaylineCount, 3);
  assert.equal(multiResult.evaluatedPaylineCount, 2);
  assert.equal(multiResult.disabledPaylineCount, 1);
  assert.equal(multiResult.matches.length, 2);
  assert.equal(multiResult.totalMatchedLines, 2);
  assert.deepEqual(multiResult.winningPaylines, ["line-top", "line-mid"]);

  assert.equal(multiResult.matches[0].paylineId, "line-top");
  assert.equal(multiResult.matches[0].symbolId, "A");
  assert.equal(multiResult.matches[0].matchCount, 3);
  assert.deepEqual(multiResult.matches[0].reelIndexes, [0, 1, 2]);

  assert.equal(multiResult.matches[1].paylineId, "line-mid");
  assert.equal(multiResult.matches[1].symbolId, "K");
  assert.equal(multiResult.matches[1].matchCount, 3);
  assert.deepEqual(multiResult.matches[1].reelIndexes, [0, 1, 2]);
});

test("B05.2 — Validation & structured error model (TEST 8, TEST 9, TEST 10)", () => {
  const board5x3 = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["A", "J", "Q"],
    ["A", "K", "10"],
    ["A", "Q", "J"],
    ["A", "10", "K"],
  ]);

  // TEST 8: INVALID PAYLINE LENGTH (pattern length != board.reelCount)
  const shortPatternLine = makePayline("line-short", 1, [0, 0, 0, 0]);
  assert.throws(
    () => evaluatePayline(board5x3, shortPatternLine),
    (err: unknown) =>
      err instanceof PaylineGridMismatchError &&
      err instanceof InvalidPaylineError &&
      err instanceof InvalidPaylineConfigError &&
      err instanceof SlotEngineError &&
      err.code === "PAYLINE_GRID_MISMATCH" &&
      err.context.patternLength === 4 &&
      err.context.reelCount === 5,
  );

  const longPatternLine = makePayline("line-long", 1, [0, 0, 0, 0, 0, 0]);
  assert.throws(
    () => evaluatePaylines(board5x3, [longPatternLine]),
    (err: unknown) =>
      err instanceof PaylineGridMismatchError &&
      err.code === "PAYLINE_GRID_MISMATCH",
  );

  // TEST 9: INVALID ROW INDEX (< 0, >= rowCount, non-integer)
  const negativeRowLine = makePayline("line-neg-row", 1, [0, -1, 0, 0, 0]);
  assert.throws(
    () => evaluatePayline(board5x3, negativeRowLine),
    (err: unknown) =>
      err instanceof InvalidRowIndexError &&
      err instanceof InvalidPaylineError &&
      err.code === "INVALID_ROW_INDEX" &&
      err.context.reelIndex === 1 &&
      err.context.rowIndex === -1,
  );

  const overflowRowLine = makePayline("line-overflow-row", 1, [0, 1, 3, 1, 0]);
  assert.throws(
    () => evaluatePayline(board5x3, overflowRowLine),
    (err: unknown) =>
      err instanceof InvalidRowIndexError &&
      err.code === "INVALID_ROW_INDEX" &&
      err.context.reelIndex === 2 &&
      err.context.rowIndex === 3 &&
      err.context.rowCount === 3,
  );

  const floatRowLine = makePayline("line-float-row", 1, [0, 1.5, 0, 0, 0]);
  assert.throws(
    () => evaluatePayline(board5x3, floatRowLine),
    (err: unknown) =>
      err instanceof InvalidRowIndexError && err.code === "INVALID_ROW_INDEX",
  );

  // TEST 10: BOARD / PAYLINE MISMATCH, MISSING ID, DUPLICATE IDS, INVALID ENABLED STATE, INVALID BOARD
  const missingIdLine = makePayline("", 1, [0, 0, 0, 0, 0]);
  assert.throws(
    () => evaluatePayline(board5x3, missingIdLine),
    (err: unknown) =>
      err instanceof MissingPaylineError &&
      err instanceof InvalidPaylineError &&
      err.code === "MISSING_PAYLINE",
  );

  const duplicateLines = [
    makePayline("line-dup", 1, [0, 0, 0, 0, 0]),
    makePayline("line-dup", 2, [1, 1, 1, 1, 1]),
  ];
  assert.throws(
    () => evaluatePaylines(board5x3, duplicateLines),
    (err: unknown) =>
      err instanceof InvalidPaylineError &&
      err.code === "INVALID_PAYLINE" &&
      err.context.paylineId === "line-dup",
  );

  const badEnabledLine = {
    id: "line-bad-enabled",
    index: 1,
    name: "Bad Enabled",
    pattern: [0, 0, 0, 0, 0],
    enabled: "yes" as unknown as boolean,
    color: "#fff",
  };
  assert.throws(
    () => evaluatePayline(board5x3, badEnabledLine),
    (err: unknown) =>
      err instanceof InvalidPaylineError && err.code === "INVALID_PAYLINE",
  );

  const malformedBoard = {
    reelCount: 5,
    rowCount: 3,
    columns: 5,
    rows: 3,
    reelHeights: [3, 3, 3],
    cells: board5x3.cells.slice(0, 3),
  } as unknown as typeof board5x3;
  assert.throws(
    () => evaluatePaylines(malformedBoard, [makePayline("l1", 1, [0, 0, 0, 0, 0])]),
    (err: unknown) =>
      err instanceof InvalidBoardError && err.code === "INVALID_BOARD",
  );
});

test("B05.3 — Determinism, No RNG, No Paytable, Immutability, Serialization, Wild/Scatter Boundaries, and B04 Integration (TEST 11 through TEST 15 + Boundaries)", () => {
  // B04 + B05 INTEGRATION: Resolve authoritative Board via B04 ReelEngine and evaluate via B05 PaylineEngine
  const canonicalDef = createSampleGameDefinition();
  const gameConfig = toGameConfig(canonicalDef);
  const reelEngine = createReelEngine();
  const paylineEngine = new FixedPaylineEngine();

  // In createSampleGameDefinition:
  // Reels 0, 1, 2 have sym-low-a at stop 0; Reel 3 has sym-low-a at stop 3; Reel 4 has sym-low-a at stop 2
  const b04Resolution = reelEngine.resolveFromStops(gameConfig, [0, 0, 0, 3, 2]);
  const b04Board = b04Resolution.board;

  // TEST 11: DETERMINISTIC — Same Board + GameConfig produces identical PaylineEvaluationResult
  const baselineEval = paylineEngine.evaluate(b04Board, gameConfig.paylines);
  for (let i = 0; i < 25; i += 1) {
    const repeatEval = paylineEngine.evaluate(b04Board, gameConfig);
    assert.deepEqual(repeatEval, baselineEval);
  }

  // Verify B04 stopIndexes are preserved on matched cellPositions
  assert.ok(baselineEval.matches.length >= 3);
  const topRowLineMatch = baselineEval.matches.find(
    (m) => m.pattern.every((r) => r === 0),
  );
  assert.ok(topRowLineMatch);
  assert.equal(topRowLineMatch.symbolId, "sym-low-a");
  assert.equal(topRowLineMatch.matchCount, 5);
  assert.deepEqual(topRowLineMatch.matchedStopIndexes, [0, 0, 0, 3, 2]);
  assert.equal(topRowLineMatch.cellPositions[0].stopIndex, 0);
  assert.equal(topRowLineMatch.cellPositions[3].stopIndex, 3);
  assert.equal(topRowLineMatch.cellPositions[4].stopIndex, 2);

  // TEST 12: NO RNG — PaylineEngine does not require or consume RNG
  const untouchedRng = new SeededRNG("b05-no-rng-seed");
  const snapBefore = untouchedRng.snapshot();
  paylineEngine.evaluate(b04Board, gameConfig.paylines);
  assert.deepEqual(untouchedRng.snapshot(), snapBefore);

  // TEST 13: NO PAYTABLE — Result contains match metadata only, zero payout/multiplier/SymbolDefinition fields
  const rawEvalRecord = baselineEval as unknown as Record<string, unknown>;
  assert.equal("totalWin" in rawEvalRecord, false);
  assert.equal("payout" in rawEvalRecord, false);
  for (const match of baselineEval.matches) {
    const rawMatch = match as unknown as Record<string, unknown>;
    assert.equal("payout" in rawMatch, false);
    assert.equal("winAmount" in rawMatch, false);
    assert.equal("baseMultiplier" in rawMatch, false);
    assert.equal("appliedMultiplier" in rawMatch, false);
    assert.equal("symbol" in rawMatch, false);
    for (const cp of match.cellPositions) {
      const rawCellPos = cp as unknown as Record<string, unknown>;
      assert.equal("symbol" in rawCellPos, false);
      assert.equal("x" in rawCellPos, false);
      assert.equal("y" in rawCellPos, false);
    }
  }

  // TEST 14: INPUT IMMUTABILITY — Freeze/snapshot Board, GameConfig, and PaylineDefinitions
  const studioBp = createBlueprint({
    id: "b05-immutability",
    title: "B05 Immutability Check",
    theme: "Ancient Egypt",
    columns: 5,
    rows: 3,
  });
  const studioConfig = adaptBlueprintToGameConfig(studioBp);
  const studioBoard = reelEngine.resolveFromStops(studioConfig, [1, 2, 0, 3, 1]).board;
  const boardJsonBefore = JSON.stringify(studioBoard);
  const paylinesJsonBefore = JSON.stringify(studioConfig.paylines);

  const studioEval = paylineEngine.evaluate(studioBoard, studioConfig.paylines);
  assert.equal(JSON.stringify(studioBoard), boardJsonBefore);
  assert.equal(JSON.stringify(studioConfig.paylines), paylinesJsonBefore);
  assert.equal(Object.isFrozen(studioEval), true);
  assert.equal(Object.isFrozen(studioEval.matches), true);
  if (studioEval.matches.length > 0) {
    assert.equal(Object.isFrozen(studioEval.matches[0]), true);
    assert.equal(Object.isFrozen(studioEval.matches[0].cellPositions), true);
    assert.equal(Object.isFrozen(studioEval.matches[0].reelIndexes), true);
  }

  // TEST 15: SERIALIZATION — Round-trip serialize/deserialize preserves PaylineEvaluationResult
  const serialized = serializePaylineEvaluationResult(baselineEval);
  const deserialized = deserializePaylineEvaluationResult(serialized);
  assert.deepEqual(deserialized, baselineEval);

  // WILD TEST BOUNDARY: Prove B05 does NOT silently implement Wild substitution
  // Board along payline [0,0,0,0,0]: A WILD A A A -> with exact matching policy, baseSymbolId = A, matchCount = 1
  const wildBoundaryBoard = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["WILD", "J", "Q"],
    ["A", "K", "10"],
    ["A", "Q", "J"],
    ["A", "10", "K"],
  ]);
  const line0 = makePayline("line-wild-boundary", 1, [0, 0, 0, 0, 0]);
  const exactWildResult = paylineEngine.evaluatePayline(wildBoundaryBoard, line0);
  assert.ok(exactWildResult);
  assert.equal(EXACT_SYMBOL_MATCH_POLICY.id, "exact");
  assert.equal(exactWildResult.baseSymbolId, "A");
  assert.equal(exactWildResult.symbolId, "A");
  assert.equal(exactWildResult.matchCount, 1);
  assert.deepEqual(exactWildResult.reelIndexes, [0]);

  // Verify SymbolMatchPolicy extension point allows future B07 policy injection without modifying PaylineEngine
  const mockFuturePolicy: SymbolMatchPolicy = {
    id: "mock-b07-wild-extension",
    matches: (baseSymbolId, candidateSymbolId) =>
      baseSymbolId === candidateSymbolId || candidateSymbolId === "WILD",
  };
  const extendedResult = paylineEngine.evaluatePayline(wildBoundaryBoard, line0, {
    matchPolicy: mockFuturePolicy,
  });
  assert.ok(extendedResult);
  assert.equal(extendedResult.matchCount, 5);

  // SCATTER TEST BOUNDARY: Scattered symbols off the payline are never counted as a payline match
  // SCAT appears at (0,0), (1,2), (2,1), (3,2), (4,1) — only reel 0 is on payline [0,0,0,0,0]
  const scatterBoundaryBoard = createBoardFromSymbolGrid([
    ["SCAT", "K", "Q"],
    ["K", "J", "SCAT"],
    ["Q", "SCAT", "10"],
    ["J", "Q", "SCAT"],
    ["10", "SCAT", "K"],
  ]);
  const scatterOnLine0 = paylineEngine.evaluatePayline(scatterBoundaryBoard, line0);
  assert.ok(scatterOnLine0);
  assert.equal(scatterOnLine0.symbolId, "SCAT");
  assert.equal(scatterOnLine0.matchCount, 1);
  assert.deepEqual(scatterOnLine0.reelIndexes, [0]);
});
