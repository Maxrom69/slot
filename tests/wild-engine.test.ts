import assert from "node:assert/strict";
import test from "node:test";

import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  DeterministicWildEngine,
  InvalidPaytableReferenceError,
  InvalidSubstitutionRuleError,
  InvalidWildConfigurationError,
  InvalidWildContextError,
  SeededRNG,
  SlotEngineError,
  UnknownWildSymbolError,
  adaptBlueprintToGameConfig,
  createBoardFromSymbolGrid,
  createPaylineEngine,
  createPaytableEngine,
  createReelEngine,
  createSampleGameDefinition,
  createWildEngine,
  deserializeWildPaylineEvaluationResult,
  deserializeWildResolvedMatch,
  evaluatePayline,
  serializeWildPaylineEvaluationResult,
  serializeWildResolvedMatch,
  toGameConfig,
  type PaylineDefinition,
  type PaytableDefinition,
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

const PAYTABLE_FIXTURE: PaytableDefinition = Object.freeze({
  payoutType: "multiplier",
  betBasis: "perLine",
  minMatchCount: 3,
  entries: Object.freeze([
    Object.freeze({
      symbolId: "A",
      payouts: Object.freeze({ 3: 5, 4: 12, 5: 25 }),
    }),
    Object.freeze({
      symbolId: "K",
      payouts: Object.freeze({ 3: 10, 4: 20, 5: 50 }),
    }),
    Object.freeze({
      symbolId: "Q",
      payouts: Object.freeze({ 3: 3, 4: 8, 5: 15 }),
    }),
  ]),
});

test("B07.1 — Core Wild substitution rules (TEST 1 through TEST 14 + Paytable Integration)", () => {
  const wildEngine = createWildEngine({
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
        activeModes: ["base", "freeSpins", "bonus", "fixedPaylines"],
        paysOnOwn: false,
        multiplier: 1,
      },
    ],
  });

  assert.equal(wildEngine.isWild("WILD"), true);
  assert.equal(wildEngine.isWild("A"), false);
  assert.equal(wildEngine.canSubstitute("WILD", "A"), true);
  assert.equal(wildEngine.canSubstitute("WILD", "K"), true);
  assert.equal(wildEngine.canSubstitute("WILD", "Q"), true);
  assert.equal(wildEngine.canSubstitute("WILD", "WILD"), false);
  assert.equal(wildEngine.canSubstitute("A", "K"), false);

  const line0 = makePayline("line-1", 1, [0, 0, 0, 0, 0]);

  // TEST 1: BASIC SUBSTITUTION — A WILD A (followed by K Q) -> effective A A A, matchCount = 3
  const board1 = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["WILD", "Q", "K"],
    ["A", "Q", "K"],
    ["K", "A", "Q"],
    ["Q", "K", "A"],
  ]);
  const res1 = wildEngine.resolvePayline(board1, line0);
  assert.ok(res1);
  assert.equal(res1.baseSymbolId, "A");
  assert.equal(res1.symbolId, "A");
  assert.equal(res1.matchCount, 3);
  assert.deepEqual(res1.actualSymbols, ["A", "WILD", "A"]);
  assert.deepEqual(res1.effectiveSymbols, ["A", "A", "A"]);
  assert.equal(res1.wildCount, 1);
  assert.equal(res1.isAllWild, false);
  assert.equal(res1.substitutions.length, 1);
  assert.deepEqual(res1.substitutions[0], {
    reelIndex: 1,
    rowIndex: 0,
    actualSymbolId: "WILD",
    effectiveSymbolId: "A",
    wildSymbolId: "WILD",
    stopIndex: 0,
  });

  // Also verify B05 SymbolMatchPolicy extension point works identically via createMatchPolicy
  const b05WithWildPolicy = evaluatePayline(board1, line0, {
    matchPolicy: wildEngine.createMatchPolicy("A"),
  });
  assert.ok(b05WithWildPolicy);
  assert.equal(b05WithWildPolicy.matchCount, 3);
  assert.deepEqual(b05WithWildPolicy.reelIndexes, [0, 1, 2]);

  // TEST 2: MULTIPLE WILDS — A WILD WILD A (followed by Q) -> effective A A A A, matchCount = 4
  const board2 = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["WILD", "Q", "K"],
    ["WILD", "Q", "K"],
    ["A", "K", "Q"],
    ["Q", "K", "A"],
  ]);
  const res2 = wildEngine.resolvePayline(board2, line0);
  assert.ok(res2);
  assert.equal(res2.baseSymbolId, "A");
  assert.equal(res2.matchCount, 4);
  assert.deepEqual(res2.actualSymbols, ["A", "WILD", "WILD", "A"]);
  assert.deepEqual(res2.effectiveSymbols, ["A", "A", "A", "A"]);
  assert.equal(res2.substitutions.length, 2);
  assert.equal(res2.substitutions[0].reelIndex, 1);
  assert.equal(res2.substitutions[1].reelIndex, 2);

  // TEST 3: STARTING WILD — WILD A A (followed by K Q) -> effective A A A, matchCount = 3
  const board3 = createBoardFromSymbolGrid([
    ["WILD", "K", "Q"],
    ["A", "Q", "K"],
    ["A", "Q", "K"],
    ["K", "A", "Q"],
    ["Q", "K", "A"],
  ]);
  const res3 = wildEngine.resolvePayline(board3, line0);
  assert.ok(res3);
  assert.equal(res3.baseSymbolId, "A");
  assert.equal(res3.matchCount, 3);
  assert.deepEqual(res3.actualSymbols, ["WILD", "A", "A"]);
  assert.deepEqual(res3.effectiveSymbols, ["A", "A", "A"]);
  assert.equal(res3.substitutions.length, 1);
  assert.equal(res3.substitutions[0].reelIndex, 0);
  assert.equal(res3.substitutions[0].actualSymbolId, "WILD");
  assert.equal(res3.substitutions[0].effectiveSymbolId, "A");

  // TEST 4 & PAYTABLE INTEGRATION: STARTING WILD WITH DIFFERENT TARGET — WILD K K -> effective K K K
  const board4 = createBoardFromSymbolGrid([
    ["WILD", "A", "Q"],
    ["K", "Q", "A"],
    ["K", "Q", "A"],
    ["Q", "A", "K"],
    ["A", "K", "Q"],
  ]);
  const res4 = wildEngine.resolvePayline(board4, line0);
  assert.ok(res4);
  assert.equal(res4.baseSymbolId, "K");
  assert.equal(res4.matchCount, 3);
  assert.deepEqual(res4.actualSymbols, ["WILD", "K", "K"]);
  assert.deepEqual(res4.effectiveSymbols, ["K", "K", "K"]);

  // TEST 5 & TEST 10: WILD FOLLOWED BY MISMATCH / MIXED WILDS — A WILD K A A -> A run stops at K (matchCount = 2)
  const board5 = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["WILD", "Q", "K"],
    ["K", "Q", "A"],
    ["A", "A", "Q"],
    ["A", "K", "A"],
  ]);
  const res5 = wildEngine.resolvePayline(board5, line0);
  assert.ok(res5);
  assert.equal(res5.baseSymbolId, "A");
  assert.equal(res5.matchCount, 2);
  assert.deepEqual(res5.actualSymbols, ["A", "WILD"]);
  assert.deepEqual(res5.effectiveSymbols, ["A", "A"]);
  // Verify K on reel 2 on the board is untouched
  assert.equal(board5.cells[2][0].symbolId, "K");

  // TEST 6: EXCLUDED SYMBOL — Configure Wild cannot replace Q
  const engineExcludeQ = createWildEngine({
    enabled: true,
    symbolIds: ["WILD"],
    knownSymbolIds: ["A", "K", "Q", "WILD"],
    regularSymbolIds: ["A", "K", "Q"],
    paytable: PAYTABLE_FIXTURE,
    substitutionRules: [
      {
        wildSymbolId: "WILD",
        allowedSubstitutions: "allRegular",
        excludedSymbolIds: ["Q"],
        activeReels: [0, 1, 2, 3, 4],
        activeModes: ["base", "freeSpins", "bonus"],
        paysOnOwn: false,
        multiplier: 1,
      },
    ],
  });
  assert.equal(engineExcludeQ.canSubstitute("WILD", "A"), true);
  assert.equal(engineExcludeQ.canSubstitute("WILD", "Q"), false);

  // 6a: A WILD Q -> Q is not converted; A run stops at reel 2 (matchCount = 2)
  const board6a = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["WILD", "Q", "K"],
    ["Q", "K", "A"],
    ["A", "Q", "K"],
    ["A", "K", "Q"],
  ]);
  const res6a = engineExcludeQ.resolvePayline(board6a, line0);
  assert.ok(res6a);
  assert.equal(res6a.baseSymbolId, "A");
  assert.equal(res6a.matchCount, 2);
  assert.deepEqual(res6a.effectiveSymbols, ["A", "A"]);

  // 6b: Q WILD Q -> WILD cannot replace Q, so Q run stops at reel 1 (matchCount = 1)
  const board6b = createBoardFromSymbolGrid([
    ["Q", "K", "A"],
    ["WILD", "Q", "K"],
    ["Q", "K", "A"],
    ["Q", "Q", "K"],
    ["Q", "K", "Q"],
  ]);
  const res6b = engineExcludeQ.resolvePayline(board6b, line0);
  assert.ok(res6b);
  assert.equal(res6b.baseSymbolId, "Q");
  assert.equal(res6b.matchCount, 1);
  assert.equal(res6b.substitutions.length, 0);

  // TEST 7: WILD PAYING ON OWN (paysOnOwn = true)
  // Board: WILD WILD WILD Q K where Q is excluded -> resolves as a 3-of-a-kind WILD combination
  const enginePaysOnOwn = createWildEngine({
    enabled: true,
    symbolIds: ["WILD"],
    knownSymbolIds: ["A", "K", "Q", "WILD"],
    regularSymbolIds: ["A", "K", "Q"],
    substitutionRules: [
      {
        wildSymbolId: "WILD",
        allowedSubstitutions: ["A", "K"],
        excludedSymbolIds: ["Q"],
        activeReels: [0, 1, 2, 3, 4],
        activeModes: ["base"],
        paysOnOwn: true,
        multiplier: 1,
      },
    ],
  });
  const boardWildOwn = createBoardFromSymbolGrid([
    ["WILD", "A", "K"],
    ["WILD", "A", "K"],
    ["WILD", "A", "K"],
    ["Q", "A", "K"],
    ["K", "A", "Q"],
  ]);
  const res7 = enginePaysOnOwn.resolvePayline(boardWildOwn, line0);
  assert.ok(res7);
  assert.equal(res7.baseSymbolId, "WILD");
  assert.equal(res7.symbolId, "WILD");
  assert.equal(res7.matchCount, 3);
  assert.deepEqual(res7.actualSymbols, ["WILD", "WILD", "WILD"]);
  assert.deepEqual(res7.effectiveSymbols, ["WILD", "WILD", "WILD"]);
  assert.equal(res7.substitutions.length, 0);

  // TEST 8: WILD NOT PAYING ON OWN (paysOnOwn = false)
  // Same board WILD WILD WILD Q K where Q is excluded -> does NOT create an independent Wild-only combination
  const res8 = engineExcludeQ.resolvePayline(boardWildOwn, line0);
  assert.equal(res8, null);

  // TEST 9 & PAYTABLE INTEGRATION: ALL-WILD — WILD WILD WILD WILD WILD
  // Paytable has A (3->5x, 5->25x), K (3->10x, 5->50x), Q (3->3x, 5->15x)
  // Highest-value symbol in paytable is K -> effective winning symbol is K!
  const boardAllWild = createBoardFromSymbolGrid([
    ["WILD", "A", "Q"],
    ["WILD", "K", "Q"],
    ["WILD", "A", "K"],
    ["WILD", "Q", "A"],
    ["WILD", "K", "Q"],
  ]);
  const res9 = wildEngine.resolvePayline(boardAllWild, line0);
  assert.ok(res9);
  assert.equal(res9.isAllWild, true);
  assert.equal(res9.baseSymbolId, "K");
  assert.equal(res9.symbolId, "K");
  assert.equal(res9.matchCount, 5);
  assert.deepEqual(res9.actualSymbols, ["WILD", "WILD", "WILD", "WILD", "WILD"]);
  assert.deepEqual(res9.effectiveSymbols, ["K", "K", "K", "K", "K"]);
  assert.equal(res9.substitutions.length, 5);
  assert.equal(res9.wildCount, 5);
  // Confirm B07 does NOT calculate final payout amount
  assert.equal("payout" in (res9 as unknown as Record<string, unknown>), false);

  // TEST 11: ACTIVE REEL RULE — Disable Wild behavior on reel 1 (activeReels = [0, 2, 3, 4])
  const engineReelRestricted = createWildEngine({
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
        activeReels: [0, 2, 3, 4],
        activeModes: ["base"],
        paysOnOwn: false,
        multiplier: 1,
      },
    ],
  });
  assert.equal(engineReelRestricted.isWildActiveOnReel("WILD", 0), true);
  assert.equal(engineReelRestricted.isWildActiveOnReel("WILD", 1), false);
  assert.equal(engineReelRestricted.isWildActiveOnReel("WILD", 2), true);

  // On board1 (A WILD A K Q), WILD is on reel 1 where Wild substitution is inactive -> stops at reel 1 (matchCount = 1)
  const res11Inactive = engineReelRestricted.resolvePayline(board1, line0);
  assert.ok(res11Inactive);
  assert.equal(res11Inactive.baseSymbolId, "A");
  assert.equal(res11Inactive.matchCount, 1);
  assert.deepEqual(res11Inactive.actualSymbols, ["A"]);
  assert.deepEqual(res11Inactive.effectiveSymbols, ["A"]);
  assert.equal(res11Inactive.substitutions.length, 0);

  // On A A WILD A K, WILD is on reel 2 where Wild substitution IS active -> matchCount = 4
  const board11Active = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["A", "Q", "K"],
    ["WILD", "Q", "K"],
    ["A", "A", "Q"],
    ["K", "K", "A"],
  ]);
  const res11Active = engineReelRestricted.resolvePayline(board11Active, line0);
  assert.ok(res11Active);
  assert.equal(res11Active.baseSymbolId, "A");
  assert.equal(res11Active.matchCount, 4);
  assert.deepEqual(res11Active.actualSymbols, ["A", "A", "WILD", "A"]);
  assert.deepEqual(res11Active.effectiveSymbols, ["A", "A", "A", "A"]);

  // TEST 12, TEST 13, TEST 14: MULTIPLE WILDS WITHIN LINE + ACTUAL VS EFFECTIVE SYMBOL PRESERVATION
  // A WILD WILD K Q -> matchCount = 3, actual = [A, WILD, WILD], effective = [A, A, A]
  const board12 = createBoardFromSymbolGrid([
    ["A", "K", "Q"],
    ["WILD", "Q", "K"],
    ["WILD", "Q", "K"],
    ["K", "A", "Q"],
    ["Q", "K", "A"],
  ]);
  const res12 = wildEngine.resolvePayline(board12, line0);
  assert.ok(res12);
  assert.equal(res12.baseSymbolId, "A");
  assert.equal(res12.matchCount, 3);
  assert.deepEqual(res12.actualSymbols, ["A", "WILD", "WILD"]);
  assert.deepEqual(res12.effectiveSymbols, ["A", "A", "A"]);
  assert.equal(res12.cellPositions[1].actualSymbolId, "WILD");
  assert.equal(res12.cellPositions[1].effectiveSymbolId, "A");
  assert.equal(res12.cellPositions[1].isSubstituted, true);
  assert.equal(res12.cellPositions[0].actualSymbolId, "A");
  assert.equal(res12.cellPositions[0].effectiveSymbolId, "A");
  assert.equal(res12.cellPositions[0].isSubstituted, false);
  // Original board cells still hold "WILD"
  assert.equal(board12.cells[1][0].symbolId, "WILD");
  assert.equal(board12.cells[2][0].symbolId, "WILD");
});

test("B07.2 — Validation & structured error model (TEST 18, TEST 20)", () => {
  // TEST 18: INVALID WILD CONFIGURATION
  assert.throws(
    () => createWildEngine(null as unknown as Parameters<typeof createWildEngine>[0]),
    (err: unknown) =>
      err instanceof InvalidWildConfigurationError &&
      err instanceof SlotEngineError &&
      err.code === "INVALID_WILD_CONFIG",
  );

  // Contradictory allowedSubstitutions and excludedSymbolIds
  assert.throws(
    () =>
      createWildEngine({
        enabled: true,
        symbolIds: ["WILD"],
        substitutionRules: [
          {
            wildSymbolId: "WILD",
            allowedSubstitutions: ["A", "K"],
            excludedSymbolIds: ["K"],
          },
        ],
      }),
    (err: unknown) =>
      err instanceof InvalidSubstitutionRuleError &&
      err instanceof InvalidWildConfigurationError &&
      err.code === "INVALID_SUBSTITUTION_RULE",
  );

  // Invalid activeReels (negative reel index)
  assert.throws(
    () =>
      createWildEngine({
        enabled: true,
        symbolIds: ["WILD"],
        substitutionRules: [
          {
            wildSymbolId: "WILD",
            allowedSubstitutions: "allRegular",
            activeReels: [0, -1, 2],
          },
        ],
      }),
    (err: unknown) =>
      err instanceof InvalidSubstitutionRuleError &&
      err.code === "INVALID_SUBSTITUTION_RULE",
  );

  // Invalid activeModes
  assert.throws(
    () =>
      createWildEngine({
        enabled: true,
        symbolIds: ["WILD"],
        substitutionRules: [
          {
            wildSymbolId: "WILD",
            allowedSubstitutions: "allRegular",
            activeModes: ["invalidMode" as unknown as "base"],
          },
        ],
      }),
    (err: unknown) =>
      err instanceof InvalidSubstitutionRuleError &&
      err.code === "INVALID_SUBSTITUTION_RULE",
  );

  // Invalid paytable reference
  assert.throws(
    () =>
      createWildEngine({
        enabled: true,
        symbolIds: ["WILD"],
        paytable: [{ symbolId: "A", payouts: { 3: -10 } }],
        substitutionRules: [
          {
            wildSymbolId: "WILD",
            allowedSubstitutions: ["A"],
          },
        ],
      }),
    (err: unknown) =>
      err instanceof InvalidPaytableReferenceError &&
      err.code === "INVALID_PAYTABLE_REFERENCE",
  );

  // TEST 20: UNKNOWN SYMBOL
  // Unknown wildSymbolId when knownSymbolIds is specified
  assert.throws(
    () =>
      createWildEngine({
        enabled: true,
        knownSymbolIds: ["A", "K", "Q"],
        substitutionRules: [
          {
            wildSymbolId: "UNKNOWN_WILD",
            allowedSubstitutions: ["A"],
          },
        ],
      }),
    (err: unknown) =>
      err instanceof UnknownWildSymbolError &&
      err instanceof InvalidWildConfigurationError &&
      err.code === "UNKNOWN_WILD_SYMBOL",
  );

  const strictEngine = createWildEngine({
    enabled: true,
    knownSymbolIds: ["A", "K", "Q", "WILD"],
    substitutionRules: [
      {
        wildSymbolId: "WILD",
        allowedSubstitutions: ["A", "K", "Q"],
      },
    ],
  });

  assert.throws(
    () => strictEngine.isWild("NON_EXISTENT"),
    (err: unknown) =>
      err instanceof UnknownWildSymbolError &&
      err.code === "UNKNOWN_WILD_SYMBOL",
  );

  assert.throws(
    () => strictEngine.canSubstitute("WILD", "NON_EXISTENT"),
    (err: unknown) =>
      err instanceof UnknownWildSymbolError &&
      err.code === "UNKNOWN_WILD_SYMBOL",
  );

  assert.throws(
    () =>
      strictEngine.canSubstitute("WILD", "A", {
        reelIndex: -2,
      }),
    (err: unknown) =>
      err instanceof InvalidWildContextError &&
      err.code === "INVALID_WILD_CONTEXT",
  );
});

test("B07.3 — Determinism, No RNG, Immutability, Serialization, and B02+B04+B05+B06+B07 Pipeline Integration (TEST 15, 16, 17, 19)", () => {
  // Full B02 -> B04 -> B07 -> B06 integration
  const sampleDef = createSampleGameDefinition();
  const gameConfig = toGameConfig(sampleDef);
  const reelEngine = createReelEngine();
  const wildEngine = new DeterministicWildEngine(gameConfig);
  const paytableEngine = createPaytableEngine(gameConfig);

  assert.equal(wildEngine.isWild("sym-wild"), true);
  assert.equal(wildEngine.isWild("sym-low-a"), false);
  assert.equal(wildEngine.canSubstitute("sym-wild", "sym-low-a"), true);
  assert.equal(wildEngine.canSubstitute("sym-wild", "sym-scatter"), false);

  // In createSampleGameDefinition:
  // Reels 0, 1, 2 strips: [sym-low-a, sym-low-k, sym-low-q, sym-high-sun-disk, sym-wild, sym-scatter]
  // Stop 0 on Reel 0 -> row 0 = sym-low-a
  // Stop 4 on Reel 1 -> row 0 = sym-wild
  // Stop 0 on Reel 2 -> row 0 = sym-low-a
  // Stop 0 on Reel 3 -> row 0 = sym-low-k
  // Stop 0 on Reel 4 -> row 0 = sym-low-q
  // So top horizontal payline (line-2: [0,0,0,0,0]) has: sym-low-a, sym-wild, sym-low-a, sym-low-k, sym-low-q
  const b04Board = reelEngine.resolveFromStops(gameConfig, [0, 4, 0, 0, 0]).board;

  // Verify B05 without Wilds sees only matchCount = 1 on line-2
  const b05Exact = createPaylineEngine().evaluate(b04Board, gameConfig.paylines);
  const b05Line2 = b05Exact.matches.find((m) => m.paylineId === "line-2");
  assert.ok(b05Line2);
  assert.equal(b05Line2.matchCount, 1);

  // Verify B07 resolves line-2 as a 3-of-a-kind sym-low-a match with 1 Wild substitution at reel 1
  const b07Result = wildEngine.resolvePaylines(b04Board, gameConfig.paylines);
  const b07Line2 = b07Result.matches.find((m) => m.paylineId === "line-2");
  assert.ok(b07Line2);
  assert.equal(b07Line2.baseSymbolId, "sym-low-a");
  assert.equal(b07Line2.matchCount, 3);
  assert.deepEqual(b07Line2.actualSymbols, [
    "sym-low-a",
    "sym-wild",
    "sym-low-a",
  ]);
  assert.deepEqual(b07Line2.effectiveSymbols, [
    "sym-low-a",
    "sym-low-a",
    "sym-low-a",
  ]);
  assert.equal(b07Line2.substitutions.length, 1);
  assert.equal(b07Line2.substitutions[0].reelIndex, 1);

  // And B06 can evaluate B07's WildResolvedMatch directly to compute the payout!
  const b06FromB07 = paytableEngine.evaluate(b07Result.matches, { bet: 2 });
  const line2Payout = b06FromB07.payouts.find((p) => p.paylineId === "line-2");
  assert.ok(line2Payout);
  assert.equal(line2Payout.multiplier, 2); // sym-low-a 3-of-a-kind = 2x
  assert.equal(line2Payout.payout, 4);

  // TEST 15: DETERMINISM — 25 repeated calls produce identical output
  for (let i = 0; i < 25; i += 1) {
    const repeat = wildEngine.evaluate(b04Board, gameConfig);
    assert.deepEqual(repeat, b07Result);
  }

  // TEST 16: NO RNG — SeededRNG state is completely untouched
  const rng = new SeededRNG("b07-no-rng-seed");
  const snapBefore = rng.snapshot();
  wildEngine.evaluate(b04Board, gameConfig);
  assert.deepEqual(rng.snapshot(), snapBefore);

  // TEST 17: INPUT IMMUTABILITY — Board, GameConfig, and Paylines remain unchanged
  const studioBp = createBlueprint({
    id: "b07-immutability",
    title: "B07 Immutability Check",
    theme: "Ancient Egypt",
    columns: 5,
    rows: 3,
  });
  const studioConfig = adaptBlueprintToGameConfig(studioBp);
  const boardJsonBefore = JSON.stringify(b04Board);
  const configWildJsonBefore = JSON.stringify(studioConfig.wildConfiguration);
  const paylinesJsonBefore = JSON.stringify(gameConfig.paylines);

  const immutRes = wildEngine.evaluate(b04Board, gameConfig.paylines);
  assert.equal(JSON.stringify(b04Board), boardJsonBefore);
  assert.equal(
    JSON.stringify(studioConfig.wildConfiguration),
    configWildJsonBefore,
  );
  assert.equal(JSON.stringify(gameConfig.paylines), paylinesJsonBefore);
  assert.equal(Object.isFrozen(immutRes), true);
  assert.equal(Object.isFrozen(immutRes.matches), true);
  assert.equal(Object.isFrozen(b07Line2), true);
  assert.equal(Object.isFrozen(b07Line2.actualSymbols), true);
  assert.equal(Object.isFrozen(b07Line2.effectiveSymbols), true);
  assert.equal(Object.isFrozen(b07Line2.substitutions), true);

  // TEST 19: SERIALIZATION — Both single WildResolvedMatch and WildPaylineEvaluationResult round-trip cleanly
  const matchJson = serializeWildResolvedMatch(b07Line2);
  const restoredMatch = deserializeWildResolvedMatch(matchJson);
  assert.deepEqual(restoredMatch, b07Line2);

  const evalJson = serializeWildPaylineEvaluationResult(b07Result);
  const restoredEval = deserializeWildPaylineEvaluationResult(evalJson);
  assert.deepEqual(restoredEval, b07Result);
});
