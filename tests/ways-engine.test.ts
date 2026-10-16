import assert from "node:assert/strict";
import test from "node:test";

import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  DeterministicWaysEngine,
  InvalidBetError,
  InvalidBoardError,
  InvalidMinimumReelCountError,
  InvalidPaytableReferenceError,
  InvalidWaysConfigurationError,
  SeededRNG,
  SlotEngineError,
  UnknownWaysSymbolError,
  WaysArithmeticOverflowError,
  adaptBlueprintToGameConfig,
  createBoardFromSymbolGrid,
  createReelEngine,
  createSampleGameDefinition,
  createWaysEngine,
  createWildEngine,
  deserializeWaysEvaluationResult,
  evaluateWays,
  safeComputeEffectiveMultiplier,
  safeMultiplyWaysCount,
  serializeWaysEvaluationResult,
  toGameConfig,
  type Board,
  type PaytableDefinition,
  type SymbolFamilyDefinition,
  type WaysEngineConfigObject,
} from "../src/engine";

const PAYTABLE_FIXTURE: PaytableDefinition = Object.freeze({
  payoutType: "multiplier",
  betBasis: "totalBet",
  minMatchCount: 3,
  entries: Object.freeze([
    Object.freeze({
      symbolId: "A",
      payouts: Object.freeze({ 3: 5, 4: 10, 5: 25 }),
    }),
    Object.freeze({
      symbolId: "K",
      payouts: Object.freeze({ 3: 4, 4: 8, 5: 15 }),
    }),
    Object.freeze({
      symbolId: "Q",
      payouts: Object.freeze({ 3: 2, 4: 5, 5: 10 }),
    }),
  ]),
});

const WILD_ENGINE_FIXTURE = createWildEngine({
  enabled: true,
  symbolIds: ["WILD"],
  knownSymbolIds: ["A", "K", "Q", "WILD"],
  regularSymbolIds: ["A", "K", "Q"],
  paytable: PAYTABLE_FIXTURE,
  substitutionRules: [
    {
      wildSymbolId: "WILD",
      allowedSubstitutions: ["A", "K", "Q"],
      excludedSymbolIds: [],
      activeReels: [0, 1, 2, 3, 4],
      activeModes: ["base", "freeSpins", "bonus", "ways"],
      paysOnOwn: false,
      multiplier: 1,
    },
  ],
});

const WAYS_FIXTURE_CONFIG: WaysEngineConfigObject = Object.freeze({
  enabled: true,
  minimumConsecutiveReels: 3,
  knownSymbolIds: ["A", "K", "Q", "WILD"],
  eligibleSymbols: ["A", "K", "Q"],
  paytable: PAYTABLE_FIXTURE,
  wilds: WILD_ENGINE_FIXTURE,
});

test("B09.1 — Core Ways-to-Win counting, consecutive reel rule, Wild substitution, and 243/1024 sanity checks (TEST 1 through TEST 14)", () => {
  const waysEngine = createWaysEngine(WAYS_FIXTURE_CONFIG);

  // TEST 1: BASIC 243-STYLE EXAMPLE
  // 5 reels × 3 rows. For A: Reel 0 = 2 A, Reel 1 = 3 A, Reel 2 = 2 A, Reel 3 = 1 A, Reel 4 = 1 A -> 2×3×2×1×1 = 12 Ways
  const board1 = createBoardFromSymbolGrid([
    ["A", "K", "A"],
    ["A", "A", "A"],
    ["A", "Q", "A"],
    ["K", "A", "Q"],
    ["Q", "K", "A"],
  ]);
  const res1 = waysEngine.evaluate(board1);
  const win1A = res1.wins.find((w) => w.symbolId === "A");
  assert.ok(win1A);
  assert.equal(win1A.participatingReels, 5);
  assert.equal(win1A.waysCount, 12); // 2 * 3 * 2 * 1 * 1 = 12
  assert.deepEqual(
    win1A.reelCounts.map((r) => r.count),
    [2, 3, 2, 1, 1],
  );
  assert.deepEqual(win1A.reelCounts[0].rowIndexes, [0, 2]);
  assert.deepEqual(win1A.reelCounts[1].rowIndexes, [0, 1, 2]);
  assert.deepEqual(win1A.reelCounts[2].rowIndexes, [0, 2]);
  assert.deepEqual(win1A.reelCounts[3].rowIndexes, [1]);
  assert.deepEqual(win1A.reelCounts[4].rowIndexes, [2]);
  assert.equal(win1A.baseMultiplier, 25); // 5-reel A = 25x
  assert.equal(win1A.effectiveMultiplier, 300); // 25 * 12 = 300x

  // TEST 2: SINGLE MATCH PER REEL (A appears once across 3 reels -> 1 Way)
  const board2 = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["K", "A", "Q"],
    ["Q", "K", "A"],
    ["K", "Q", "K"],
    ["Q", "K", "Q"],
  ]);
  const res2 = waysEngine.evaluate(board2);
  const win2A = res2.wins.find((w) => w.symbolId === "A");
  assert.ok(win2A);
  assert.equal(win2A.participatingReels, 3);
  assert.equal(win2A.waysCount, 1);
  assert.equal(win2A.baseMultiplier, 5);
  assert.equal(win2A.effectiveMultiplier, 5);

  // TEST 3: MULTIPLE MATCHES (Counts: 2, 2, 3 -> 12 Ways)
  const board3 = createBoardFromSymbolGrid([
    ["A", "K", "A"],
    ["Q", "A", "A"],
    ["A", "A", "A"],
    ["K", "Q", "K"],
    ["Q", "K", "Q"],
  ]);
  const res3 = waysEngine.evaluate(board3);
  const win3A = res3.wins.find((w) => w.symbolId === "A");
  assert.ok(win3A);
  assert.equal(win3A.participatingReels, 3);
  assert.equal(win3A.waysCount, 12); // 2 * 2 * 3 = 12
  assert.equal(win3A.baseMultiplier, 5);
  assert.equal(win3A.effectiveMultiplier, 60); // 5 * 12 = 60

  // TEST 4: FIRST REEL REQUIREMENT (A absent on reel 0, A appears on reels 1-4 -> no A Ways win)
  const board4 = createBoardFromSymbolGrid([
    ["K", "Q", "K"],
    ["A", "A", "A"],
    ["A", "A", "A"],
    ["A", "A", "A"],
    ["A", "A", "A"],
  ]);
  const res4 = waysEngine.evaluate(board4);
  assert.equal(
    res4.wins.find((w) => w.symbolId === "A"),
    undefined,
  );

  // TEST 5: GAP ENDS RUN (A appears on reels 0, 1, 2, 4; absent on 3 -> only reels 0-2 participate)
  const board5 = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["A", "Q", "K"],
    ["A", "K", "Q"],
    ["K", "Q", "K"], // Reel 3 has NO A
    ["A", "A", "A"], // Reel 4 has 3 A's that must NOT reconnect
  ]);
  const res5 = waysEngine.evaluate(board5);
  const win5A = res5.wins.find((w) => w.symbolId === "A");
  assert.ok(win5A);
  assert.equal(win5A.participatingReels, 3);
  assert.equal(win5A.waysCount, 1); // 1 * 1 * 1 = 1 (reel 4 ignored)
  assert.deepEqual(
    win5A.reelCounts.map((r) => r.reelIndex),
    [0, 1, 2],
  );

  // TEST 6: MINIMUM THRESHOLD (Minimum = 3, A appears only on reels 0-1 -> no qualifying win)
  const board6 = createBoardFromSymbolGrid([
    ["A", "A", "K"],
    ["A", "A", "Q"],
    ["K", "Q", "K"],
    ["Q", "K", "Q"],
    ["K", "Q", "K"],
  ]);
  const res6 = waysEngine.evaluate(board6);
  assert.equal(
    res6.wins.find((w) => w.symbolId === "A"),
    undefined,
  );

  // TEST 7: FULL-LENGTH (A appears on all 5 reels -> all 5 participate; also test requireFullLength flag)
  const board7 = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["A", "Q", "K"],
    ["A", "K", "Q"],
    ["A", "Q", "K"],
    ["A", "K", "Q"],
  ]);
  const res7 = waysEngine.evaluate(board7, { requireFullLength: true });
  const win7A = res7.wins.find((w) => w.symbolId === "A");
  assert.ok(win7A);
  assert.equal(win7A.participatingReels, 5);
  assert.equal(win7A.waysCount, 1);

  // And when requireFullLength = true, a 3-reel partial run does not qualify
  const res7PartialBlocked = waysEngine.evaluate(board5, {
    requireFullLength: true,
  });
  assert.equal(
    res7PartialBlocked.wins.find((w) => w.symbolId === "A"),
    undefined,
  );

  // TEST 8: MULTIPLE SYMBOLS (A and K both qualify -> separate WaysWin records)
  // Reel 0: A, A, K (A=2, K=1)
  // Reel 1: A, A, K (A=2, K=1)
  // Reel 2: A, A, K (A=2, K=1)
  // Reel 3: Q, K, K (A=0, K=2)
  // Reel 4: Q, K, K (A=0, K=2)
  // -> A: 2*2*2 = 8 Ways (3 reels)
  // -> K: 1*1*1*2*2 = 4 Ways (5 reels)
  const board8 = createBoardFromSymbolGrid([
    ["A", "A", "K"],
    ["A", "A", "K"],
    ["A", "A", "K"],
    ["Q", "K", "K"],
    ["Q", "K", "K"],
  ]);
  const res8 = waysEngine.evaluate(board8);
  assert.equal(res8.wins.length, 2);
  const win8A = res8.wins.find((w) => w.symbolId === "A")!;
  const win8K = res8.wins.find((w) => w.symbolId === "K")!;
  assert.equal(win8A.participatingReels, 3);
  assert.equal(win8A.waysCount, 8);
  assert.equal(win8A.baseMultiplier, 5);
  assert.equal(win8A.effectiveMultiplier, 40);

  assert.equal(win8K.participatingReels, 5);
  assert.equal(win8K.waysCount, 4);
  assert.equal(win8K.baseMultiplier, 15);
  assert.equal(win8K.effectiveMultiplier, 60);
  assert.equal(res8.totalWays, 12); // 8 + 4
  assert.equal(res8.totalWaysMultiplier, 100); // 40 + 60

  // TEST 9: DUPLICATE SYMBOL (Multiple A cells on a reel increase Ways count without emitting duplicate WaysWin for A)
  assert.equal(
    res8.wins.filter((w) => w.symbolId === "A").length,
    1,
  );

  // TEST 10: WILD SUBSTITUTION (A + Wild combinations count according to B07, and overlapping Wild cells can serve both A and K)
  // Reel 0: A, WILD, K (A=2, K=2)
  // Reel 1: A, K, Q    (A=1, K=1)
  // Reel 2: WILD, A, K (A=2, K=2)
  const board10 = createBoardFromSymbolGrid([
    ["A", "WILD", "K"],
    ["A", "K", "Q"],
    ["WILD", "A", "K"],
    ["Q", "Q", "Q"],
    ["Q", "Q", "Q"],
  ]);
  const res10 = waysEngine.evaluate(board10);
  const win10A = res10.wins.find((w) => w.symbolId === "A")!;
  const win10K = res10.wins.find((w) => w.symbolId === "K")!;
  assert.ok(win10A);
  assert.ok(win10K);
  assert.equal(win10A.waysCount, 4); // 2 * 1 * 2 = 4
  assert.equal(win10A.wildCount, 2);
  assert.equal(win10K.waysCount, 4); // 2 * 1 * 2 = 4
  assert.equal(win10K.wildCount, 2);

  // TEST 11: WILD DISABLED (Verify Wild does not substitute when configured off)
  const res11 = waysEngine.evaluate(board10, { wilds: false });
  const win11A = res11.wins.find((w) => w.symbolId === "A")!;
  const win11K = res11.wins.find((w) => w.symbolId === "K")!;
  assert.equal(win11A.waysCount, 1); // 1 * 1 * 1 = 1 (Wilds ignored)
  assert.equal(win11A.wildCount, 0);
  assert.equal(win11K.waysCount, 1); // 1 * 1 * 1 = 1 (Wilds ignored)
  assert.equal(win11K.wildCount, 0);

  // TEST 12: FAMILY MODE (Symbol family mixed counting follows configuration)
  const sunFamily: SymbolFamilyDefinition = {
    id: "family-sun",
    name: "Sun Disk Family",
    baseSymbolId: "SUN_BASE",
    memberIds: ["SUN_BASE", "SUN_MINI", "SUN_MAJOR"],
    allowMixedCounting: true,
  };
  const familyPaytable: PaytableDefinition = {
    payoutType: "multiplier",
    betBasis: "totalBet",
    minMatchCount: 3,
    entries: [{ symbolId: "SUN_BASE", payouts: { 3: 10, 4: 25, 5: 100 } }],
  };
  const boardFamily = createBoardFromSymbolGrid([
    ["SUN_BASE", "K", "Q"],
    ["SUN_MINI", "SUN_MAJOR", "Q"],
    ["SUN_MAJOR", "K", "Q"],
    ["K", "Q", "K"],
    ["Q", "K", "Q"],
  ]);
  const familyEnabledEngine = createWaysEngine({
    enabled: true,
    minimumConsecutiveReels: 3,
    knownSymbolIds: ["SUN_BASE", "SUN_MINI", "SUN_MAJOR", "K", "Q"],
    paytable: familyPaytable,
    symbolFamilies: [sunFamily],
    familyCountingEnabled: true,
  });
  const resFamilyOn = familyEnabledEngine.evaluate(boardFamily);
  assert.equal(resFamilyOn.wins.length, 1);
  assert.equal(resFamilyOn.wins[0].symbolId, "SUN_BASE");
  assert.equal(resFamilyOn.wins[0].familyId, "family-sun");
  assert.equal(resFamilyOn.wins[0].waysCount, 2); // 1 * 2 * 1 = 2
  assert.equal(resFamilyOn.wins[0].baseMultiplier, 10);
  assert.equal(resFamilyOn.wins[0].effectiveMultiplier, 20);

  // When familyCountingEnabled is false, SUN_BASE, SUN_MINI, SUN_MAJOR do not merge
  const resFamilyOff = familyEnabledEngine.evaluate(boardFamily, {
    familyCountingEnabled: false,
  });
  assert.equal(resFamilyOff.wins.length, 0);

  // TEST 13 & TEST 14: PAYTABLE LOOKUP & WAYS MULTIPLIER (effectiveMultiplier = baseMultiplier * waysCount)
  assert.equal(win3A.baseMultiplier, 5);
  assert.equal(win3A.waysCount, 12);
  assert.equal(win3A.effectiveMultiplier, win3A.baseMultiplier * win3A.waysCount);

  // KNOWN 243 SANITY CHECK (5 reels × 3 rows all occupied by A -> 3^5 = 243 Ways)
  const board243 = createBoardFromSymbolGrid([
    ["A", "A", "A"],
    ["A", "A", "A"],
    ["A", "A", "A"],
    ["A", "A", "A"],
    ["A", "A", "A"],
  ]);
  const res243 = waysEngine.evaluate(board243);
  assert.equal(res243.wins.length, 1);
  assert.equal(res243.wins[0].symbolId, "A");
  assert.equal(res243.wins[0].participatingReels, 5);
  assert.equal(res243.wins[0].waysCount, 243);
  assert.equal(res243.wins[0].baseMultiplier, 25);
  assert.equal(res243.wins[0].effectiveMultiplier, 25 * 243);

  // KNOWN 1024 SANITY CHECK (5 reels × 4 rows all occupied by A -> 4^5 = 1024 Ways)
  const board1024 = createBoardFromSymbolGrid([
    ["A", "A", "A", "A"],
    ["A", "A", "A", "A"],
    ["A", "A", "A", "A"],
    ["A", "A", "A", "A"],
    ["A", "A", "A", "A"],
  ]);
  const res1024 = waysEngine.evaluate(board1024);
  assert.equal(res1024.wins.length, 1);
  assert.equal(res1024.wins[0].symbolId, "A");
  assert.equal(res1024.wins[0].participatingReels, 5);
  assert.equal(res1024.wins[0].waysCount, 1024);
  assert.equal(res1024.wins[0].baseMultiplier, 25);
  assert.equal(res1024.wins[0].effectiveMultiplier, 25 * 1024);
});

test("B09.2 — No payline dependency, No RNG, Determinism, Immutability, Serialization, Overflow safety, Variable reel heights, and Error model (TEST 15 through TEST 20)", () => {
  const waysEngine = new DeterministicWaysEngine(WAYS_FIXTURE_CONFIG);
  const board = createBoardFromSymbolGrid([
    ["A", "K", "A"],
    ["Q", "A", "A"],
    ["A", "K", "A"],
    ["K", "Q", "K"],
    ["Q", "K", "Q"],
  ]);

  // TEST 15: NO PAYLINE DEPENDENCY (Changing paylines in GameConfig does not change Ways results)
  const bpA = createBlueprint({
    id: "ways-no-payline-a",
    title: "Ways Game A",
    theme: "Mythic",
    columns: 5,
    rows: 3,
  });
  bpA.reels.evaluation = "ways";
  const bpB = structuredClone(bpA);
  bpB.paylines = bpB.paylines.slice(0, 1);
  bpB.paylines[0].pattern = [2, 2, 2, 2, 2];

  const cfgA = adaptBlueprintToGameConfig(bpA);
  const cfgB = adaptBlueprintToGameConfig(bpB);
  const studioBoard = createReelEngine().resolveFromStops(
    cfgA,
    [0, 0, 0, 0, 0],
  ).board;

  const waysResA = evaluateWays(studioBoard, cfgA);
  const waysResB = evaluateWays(studioBoard, cfgB);
  assert.deepEqual(waysResA, waysResB);

  // TEST 16: NO RNG (SeededRNG snapshot is untouched)
  const rng = new SeededRNG("b09-no-rng-seed");
  const snapBefore = rng.snapshot();
  const baseEval = waysEngine.evaluate(board);
  assert.deepEqual(rng.snapshot(), snapBefore);

  // TEST 17: DETERMINISM (Same board + config produces identical result across 50 runs)
  for (let i = 0; i < 50; i += 1) {
    assert.deepEqual(waysEngine.evaluate(board), baseEval);
  }

  // TEST 18: INPUT IMMUTABILITY (Board and config remain unchanged, result is deeply frozen)
  const boardJsonBefore = JSON.stringify(board);
  const cfgJsonBefore = JSON.stringify(WAYS_FIXTURE_CONFIG);
  const immutRes = waysEngine.evaluate(board);
  assert.equal(JSON.stringify(board), boardJsonBefore);
  assert.equal(JSON.stringify(WAYS_FIXTURE_CONFIG), cfgJsonBefore);
  assert.equal(Object.isFrozen(immutRes), true);
  assert.equal(Object.isFrozen(immutRes.wins), true);
  assert.equal(Object.isFrozen(immutRes.wins[0]), true);
  assert.equal(Object.isFrozen(immutRes.wins[0].reelCounts), true);
  assert.equal(Object.isFrozen(immutRes.wins[0].matchedCells), true);

  // TEST 19: SERIALIZATION (Result serializes and deserializes losslessly)
  const serialized = serializeWaysEvaluationResult(immutRes);
  const deserialized = deserializeWaysEvaluationResult(serialized);
  assert.deepEqual(deserialized, immutRes);

  // TEST 20: OVERFLOW SAFETY (Large valid counts compute exact integers; overflow/NaN/Infinity throw WaysArithmeticOverflowError)
  // Valid large Ways product: 10^6 = 1,000,000 Ways
  assert.equal(safeMultiplyWaysCount([10, 10, 10, 10, 10, 10]), 1_000_000);
  assert.equal(safeComputeEffectiveMultiplier(25, 1_000_000), 25_000_000);

  // Overflow beyond Number.MAX_SAFE_INTEGER throws structured WaysArithmeticOverflowError
  assert.throws(
    () =>
      safeMultiplyWaysCount([
        1_000_000, 1_000_000, 1_000_000,
      ]),
    (err: unknown) =>
      err instanceof WaysArithmeticOverflowError &&
      err instanceof SlotEngineError &&
      err.code === "WAYS_ARITHMETIC_OVERFLOW",
  );

  assert.throws(
    () =>
      safeComputeEffectiveMultiplier(
        Number.MAX_SAFE_INTEGER,
        10,
      ),
    (err: unknown) =>
      err instanceof WaysArithmeticOverflowError &&
      err.code === "WAYS_ARITHMETIC_OVERFLOW",
  );

  // Variable reel heights (e.g., 3-4-4-4-3 ways grid)
  const varBoard = createBoardFromSymbolGrid([
    ["A", "K", "A"],
    ["A", "A", "Q", "A"],
    ["K", "A", "Q", "A"],
    ["Q", "K", "Q", "K"],
    ["K", "Q", "K"],
  ]);
  const varRes = waysEngine.evaluate(varBoard);
  const varWinA = varRes.wins.find((w) => w.symbolId === "A")!;
  assert.ok(varWinA);
  assert.equal(varWinA.participatingReels, 3);
  assert.equal(varWinA.waysCount, 12); // 2 * 3 * 2 = 12

  // Structured Error Validation (Edge Cases 11, 13, invalid config)
  // Edge Case 11: minimumConsecutiveReels > reelCount
  assert.throws(
    () =>
      waysEngine.evaluate(board, {
        ...WAYS_FIXTURE_CONFIG,
        minimumConsecutiveReels: 6,
      }),
    (err: unknown) =>
      err instanceof InvalidMinimumReelCountError &&
      err.code === "INVALID_MINIMUM_REEL_COUNT",
  );

  assert.throws(
    () =>
      createWaysEngine({
        minimumConsecutiveReels: 0,
      }),
    (err: unknown) =>
      err instanceof InvalidMinimumReelCountError &&
      err.code === "INVALID_MINIMUM_REEL_COUNT",
  );

  // Edge Case 13: Empty / malformed board
  assert.throws(
    () =>
      waysEngine.evaluate({
        reelCount: 0,
        rowCount: 0,
        columns: 0,
        rows: 0,
        reelHeights: [],
        cells: [],
      }),
    (err: unknown) =>
      err instanceof InvalidBoardError && err.code === "INVALID_BOARD",
  );

  // UnknownWaysSymbolError
  assert.throws(
    () =>
      createWaysEngine({
        knownSymbolIds: ["A", "K", "Q"],
        eligibleSymbols: ["UNKNOWN_SYM"],
      }),
    (err: unknown) =>
      err instanceof UnknownWaysSymbolError &&
      err.code === "UNKNOWN_WAYS_SYMBOL",
  );

  // InvalidPaytableReferenceError
  assert.throws(
    () =>
      createWaysEngine({
        paytable: { A: { 3: -10 } },
      }),
    (err: unknown) =>
      err instanceof InvalidPaytableReferenceError &&
      err.code === "INVALID_PAYTABLE_REFERENCE",
  );

  // InvalidBetError when bet is negative/NaN
  assert.throws(
    () => waysEngine.evaluate(board, { bet: -5 }),
    (err: unknown) =>
      err instanceof InvalidBetError && err.code === "INVALID_BET",
  );

  // Canonical B02 GameDefinition integration
  const sampleDef = createSampleGameDefinition();
  const sampleConfig = toGameConfig(sampleDef);
  const sampleWaysEngine = createWaysEngine(sampleConfig);
  assert.equal(
    sampleWaysEngine.getNormalizedConfig().minimumConsecutiveReels,
    3,
  );
});
