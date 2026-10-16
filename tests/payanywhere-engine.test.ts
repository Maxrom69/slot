/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B11 — Pay-Anywhere Engine Verification Suite
 *
 * Covers TEST 1 through TEST 22, the Position Independence Test,
 * and end-to-end B02 + B03 + B04 + B06 + B07 + B11 pipeline integration.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  type Board,
  InvalidBoardError,
  InvalidPayAnywhereConfigurationError,
  UnknownPayAnywhereSymbolError,
  adaptBlueprintToGameConfig,
  createBoardFromSymbolGrid,
  createPayAnywhereEngine,
  createPaytableEngine,
  createReelEngine,
  createSeededRng,
  createWildEngine,
  deserializePayAnywhereEvaluationResult,
  evaluatePayAnywhere,
  serializePayAnywhereEvaluationResult,
} from "../src/engine";

const STANDARD_SYMBOL_REGISTRY = [
  { id: "A" },
  { id: "B" },
  { id: "C" },
  { id: "D" },
  { id: "X" },
  { id: "SPECIAL" },
  { id: "SCATTER", isScatter: true },
  { id: "W", isWild: true },
  { id: "GEM_1", familyId: "GEM_FAMILY" },
  { id: "GEM_2", familyId: "GEM_FAMILY" },
] as const;

const STANDARD_PAYTABLE = {
  A: {
    8: 2,
    9: 3,
    10: 5,
    11: 8,
    12: 15,
  },
  B: {
    8: 1.5,
    9: 2.5,
    10: 4,
    12: 10,
  },
  C: {
    8: 1,
    9: 2,
    10: 3.5,
    12: 8,
  },
  SPECIAL: {
    8: 10,
    10: 25,
    12: 50,
  },
  GEM_FAMILY: {
    8: 4,
    9: 6,
    10: 10,
    12: 20,
  },
  GEM_1: {
    8: 4,
    9: 6,
    10: 10,
    12: 20,
  },
  GEM_2: {
    8: 4,
    9: 6,
    10: 10,
    12: 20,
  },
} as const;

describe("B11 — Pay-Anywhere Engine", () => {
  it("TEST 1: Qualifying Pay-Anywhere win (8 scattered symbols of A awards tier 8)", () => {
    // 6 columns x 5 rows board with 8 scattered "A" symbols (no adjacency needed)
    const board = createBoardFromSymbolGrid([
      ["A", "D", "B", "D", "A"],
      ["C", "D", "A", "B", "D"],
      ["D", "A", "C", "D", "B"],
      ["B", "D", "D", "A", "C"],
      ["A", "C", "D", "B", "A"],
      ["D", "B", "A", "C", "D"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A", "B", "C"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
      },
    );

    assert.equal(result.wins.length, 1);
    const winA = result.wins[0]!;
    assert.equal(winA.symbolId, "A");
    assert.equal(winA.count, 8);
    assert.equal(winA.qualifying, true);
    assert.equal(winA.eligible, true);
    assert.equal(winA.matchedTierCount, 8);
    assert.equal(winA.baseMultiplier, 2);
    assert.equal(winA.effectiveMultiplier, 2);
    assert.equal(winA.matchedCells.length, 8);
    for (const cell of winA.matchedCells) {
      assert.equal(cell.actualSymbolId, "A");
      assert.equal(cell.effectiveSymbolId, "A");
      assert.equal(cell.isWild, false);
    }
  });

  it("TEST 2: Below-threshold count does not pay (7 of A when minimum is 8)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "D", "B", "D", "A"],
      ["C", "D", "A", "B", "D"],
      ["D", "A", "C", "D", "B"],
      ["B", "D", "D", "A", "C"],
      ["A", "C", "D", "B", "D"], // 7th A at (4,0), removed (4,4)
      ["D", "B", "A", "C", "D"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
      },
    );

    assert.equal(result.wins.length, 0);
    assert.equal(result.qualifyingWinCount, 0);
    assert.equal(result.evaluatedSymbolCount, 1);
    const entryA = result.bySymbolId.A!;
    assert.equal(entryA.count, 7);
    assert.equal(entryA.qualifying, false);
    assert.equal(entryA.baseMultiplier, 0);
    assert.equal(entryA.effectiveMultiplier, 0);
  });

  it("TEST 3: Higher count tier award (12 of A selects tier 12 multiplier)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "D", "A", "D", "B"],
      ["A", "C", "A", "B", "D"],
      ["A", "D", "A", "C", "B"],
      ["A", "B", "A", "D", "C"],
      ["A", "C", "A", "B", "D"],
      ["A", "D", "A", "C", "B"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
      },
    );

    assert.equal(result.wins.length, 1);
    const winA = result.wins[0]!;
    assert.equal(winA.count, 12);
    assert.equal(winA.matchedTierCount, 12);
    assert.equal(winA.baseMultiplier, 15);
    assert.equal(winA.effectiveMultiplier, 15);
  });

  it("TEST 4: Position independence (8 copies of A in corners/edges vs 8 copies in middle rows)", () => {
    // Board A: 8 copies of "A" only on outer corners/edges (row 0 and row 4)
    const boardA = createBoardFromSymbolGrid([
      ["A", "D", "B", "C", "A"],
      ["A", "D", "B", "C", "A"],
      ["D", "C", "B", "D", "C"],
      ["D", "B", "C", "D", "B"],
      ["A", "D", "B", "C", "A"],
      ["A", "D", "B", "C", "A"],
    ]);

    // Board B: 8 copies of "A" only in interior middle rows (rows 1, 2, 3)
    const boardB = createBoardFromSymbolGrid([
      ["D", "B", "C", "D", "B"],
      ["D", "A", "A", "A", "C"],
      ["B", "A", "D", "A", "B"],
      ["C", "A", "A", "A", "D"],
      ["D", "B", "C", "D", "C"],
      ["B", "C", "D", "B", "D"],
    ]);

    const config = {
      enabled: true,
      minimumMatchCount: 8,
      eligibleSymbols: ["A"],
    };
    const options = {
      symbolRegistry: STANDARD_SYMBOL_REGISTRY,
      paytable: STANDARD_PAYTABLE,
      payoutContext: { bet: 2 },
    };

    const resA = evaluatePayAnywhere(boardA, config, options);
    const resB = evaluatePayAnywhere(boardB, config, options);

    assert.equal(resA.wins.length, 1);
    assert.equal(resB.wins.length, 1);
    assert.equal(resA.wins[0]!.count, 8);
    assert.equal(resB.wins[0]!.count, 8);
    assert.equal(resA.wins[0]!.baseMultiplier, resB.wins[0]!.baseMultiplier);
    assert.equal(
      resA.wins[0]!.effectiveMultiplier,
      resB.wins[0]!.effectiveMultiplier,
    );
    assert.equal(resA.wins[0]!.finalPayout, resB.wins[0]!.finalPayout);
    assert.notDeepEqual(
      resA.wins[0]!.matchedCells,
      resB.wins[0]!.matchedCells,
    );
  });

  it("TEST 5: No adjacency required (8 matching symbols with zero shared edges or corners)", () => {
    // 6x5 checkerboard-spaced coordinates where no two "A" cells share an edge or diagonal corner
    // Let's place 8 isolated "A" cells on a larger 7x5 board so no two share even a corner:
    // Positions: (0,0), (0,2), (0,4), (2,0), (2,2), (2,4), (4,0), (4,2)
    const board = createBoardFromSymbolGrid([
      ["A", "D", "A", "D", "A"],
      ["D", "B", "C", "B", "D"],
      ["A", "D", "A", "D", "A"],
      ["D", "C", "B", "C", "D"],
      ["A", "D", "A", "D", "B"],
      ["D", "B", "C", "B", "D"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
      },
    );

    assert.equal(result.wins.length, 1);
    const winA = result.wins[0]!;
    assert.equal(winA.count, 8);
    assert.equal(winA.qualifying, true);
    assert.equal(winA.baseMultiplier, 2);

    // Verify no two matched cells share an edge or corner (Chebyshev distance >= 2)
    for (let i = 0; i < winA.matchedCells.length; i++) {
      for (let j = i + 1; j < winA.matchedCells.length; j++) {
        const c1 = winA.matchedCells[i]!;
        const c2 = winA.matchedCells[j]!;
        const dist = Math.max(
          Math.abs(c1.reelIndex - c2.reelIndex),
          Math.abs(c1.rowIndex - c2.rowIndex),
        );
        assert.ok(dist >= 2, `Cells (${c1.reelIndex},${c1.rowIndex}) and (${c2.reelIndex},${c2.rowIndex}) are too close`);
      }
    }
  });

  it("TEST 6: No consecutive reel requirement (8 matching symbols only on reels 0, 2, and 4; zero on reels 1 and 3)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "A", "A", "D", "B"], // reel 0: 3 A's
      ["D", "B", "C", "D", "B"], // reel 1: 0 A's
      ["A", "A", "A", "C", "D"], // reel 2: 3 A's
      ["B", "C", "D", "B", "C"], // reel 3: 0 A's
      ["A", "A", "D", "C", "B"], // reel 4: 2 A's
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
      },
    );

    assert.equal(result.wins.length, 1);
    assert.equal(result.wins[0]!.symbolId, "A");
    assert.equal(result.wins[0]!.count, 8);
    assert.equal(result.wins[0]!.baseMultiplier, 2);
  });

  it("TEST 7: Multiple symbols winning in same spin (8 of A, 9 of B, 10 of C -> 3 independent PayAnywhereWin records)", () => {
    // 6x5 = 30 cells: 8 of A, 9 of B, 10 of C, 3 of D
    const board = createBoardFromSymbolGrid([
      ["A", "A", "A", "A", "A"], // 5 A
      ["A", "A", "A", "B", "B"], // 3 A (total 8), 2 B
      ["B", "B", "B", "B", "B"], // 5 B (total 7)
      ["B", "B", "C", "C", "C"], // 2 B (total 9), 3 C
      ["C", "C", "C", "C", "C"], // 5 C (total 8)
      ["C", "C", "D", "D", "D"], // 2 C (total 10), 3 D
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A", "B", "C", "D"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: {
          ...STANDARD_PAYTABLE,
          D: { 8: 0.5, 10: 1, 12: 2 },
        },
      },
    );

    assert.equal(result.wins.length, 3);
    assert.equal(result.qualifyingWinCount, 3);
    assert.equal(result.evaluatedSymbolCount, 4);

    const winA = result.bySymbolId.A!;
    const winB = result.bySymbolId.B!;
    const winC = result.bySymbolId.C!;
    const winD = result.bySymbolId.D!;

    assert.equal(winA.count, 8);
    assert.equal(winA.baseMultiplier, 2);

    assert.equal(winB.count, 9);
    assert.equal(winB.baseMultiplier, 2.5);

    assert.equal(winC.count, 10);
    assert.equal(winC.baseMultiplier, 3.5);

    assert.equal(winD.count, 3);
    assert.equal(winD.qualifying, false);

    assert.equal(result.totalBaseMultiplier, 2 + 2.5 + 3.5);
    assert.equal(result.totalEffectiveMultiplier, 8);
  });

  it("TEST 8: Non-eligible symbol does not pay as Pay-Anywhere (X appears 10 times, not in eligibleSymbols)", () => {
    const board = createBoardFromSymbolGrid([
      ["X", "X", "X", "X", "X"],
      ["X", "X", "X", "X", "X"],
      ["A", "B", "C", "D", "A"],
      ["B", "C", "D", "A", "B"],
      ["C", "D", "A", "B", "C"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A", "B", "C"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: {
          ...STANDARD_PAYTABLE,
          X: { 8: 50, 10: 100 },
        },
      },
    );

    assert.equal(result.wins.length, 0);
    assert.equal(result.bySymbolId.X, undefined);
  });

  it("TEST 9: Scatter does not automatically pay as Pay-Anywhere (SCATTER appears 8 times, not in eligibleSymbols)", () => {
    const board = createBoardFromSymbolGrid([
      ["SCATTER", "SCATTER", "SCATTER", "SCATTER", "A"],
      ["SCATTER", "SCATTER", "SCATTER", "SCATTER", "B"],
      ["C", "D", "A", "B", "C"],
      ["D", "A", "B", "C", "D"],
      ["A", "B", "C", "D", "A"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A", "B", "C"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: {
          ...STANDARD_PAYTABLE,
          SCATTER: { 3: 5, 4: 20, 5: 100, 8: 500 },
        },
      },
    );

    assert.equal(result.wins.length, 0);
    assert.equal(result.bySymbolId.SCATTER, undefined);
  });

  it("TEST 10: Wild substitution disabled (allowWildSubstitution = false, 7 of A + 2 of W -> A count stays 7, no win)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "A", "A", "A", "B"], // 4 A
      ["A", "A", "A", "C", "D"], // 3 A (7 natural A)
      ["W", "W", "B", "C", "D"], // 2 W
      ["B", "C", "D", "B", "C"],
      ["C", "D", "B", "C", "D"],
    ]);

    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["W"],
      substitutionRules: [
        {
          wildSymbolId: "W",
          allowedSubstitutions: ["A", "B", "C"],
          excludedSymbolIds: ["SCATTER"],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A"],
        allowWildSubstitution: false,
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
        wildEngine,
      },
    );

    assert.equal(result.wins.length, 0);
    assert.equal(result.bySymbolId.A!.count, 7);
    assert.equal(result.bySymbolId.A!.wildCount, 0);
    assert.equal(result.bySymbolId.A!.qualifying, false);
  });

  it("TEST 11: Wild substitution enabled (allowWildSubstitution = true, 7 of A + 2 of W -> A count = 9, matchedCells preserves actualSymbolId/effectiveSymbolId)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "A", "A", "A", "B"], // 4 A
      ["A", "A", "A", "C", "D"], // 3 A (7 natural A)
      ["W", "W", "B", "C", "D"], // 2 W at (2,0) and (2,1)
      ["B", "C", "D", "B", "C"],
      ["C", "D", "B", "C", "D"],
    ]);

    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["W"],
      substitutionRules: [
        {
          wildSymbolId: "W",
          allowedSubstitutions: ["A", "B", "C"],
          excludedSymbolIds: ["SCATTER"],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A"],
        allowWildSubstitution: true,
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
        wildEngine,
      },
    );

    assert.equal(result.wins.length, 1);
    const winA = result.wins[0]!;
    assert.equal(winA.symbolId, "A");
    assert.equal(winA.count, 9);
    assert.equal(winA.naturalCount, 7);
    assert.equal(winA.wildCount, 2);
    assert.equal(winA.matchedTierCount, 9);
    assert.equal(winA.baseMultiplier, 3);

    const wildCells = winA.matchedCells.filter((c) => c.isWild);
    assert.equal(wildCells.length, 2);
    for (const wc of wildCells) {
      assert.equal(wc.actualSymbolId, "W");
      assert.equal(wc.effectiveSymbolId, "A");
    }
  });

  it("TEST 12: Wild blocked for restricted symbol (W cannot substitute for SPECIAL, 7 of SPECIAL + 2 of W -> count stays 7)", () => {
    const board = createBoardFromSymbolGrid([
      ["SPECIAL", "SPECIAL", "SPECIAL", "SPECIAL", "B"],
      ["SPECIAL", "SPECIAL", "SPECIAL", "C", "D"],
      ["W", "W", "B", "C", "D"],
      ["B", "C", "D", "B", "C"],
      ["C", "D", "B", "C", "D"],
    ]);

    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["W"],
      substitutionRules: [
        {
          wildSymbolId: "W",
          allowedSubstitutions: ["A", "B", "C"],
          excludedSymbolIds: ["SPECIAL", "SCATTER"],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["SPECIAL"],
        allowWildSubstitution: true,
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
        wildEngine,
      },
    );

    assert.equal(result.wins.length, 0);
    assert.equal(result.bySymbolId.SPECIAL!.count, 7);
    assert.equal(result.bySymbolId.SPECIAL!.wildCount, 0);
    assert.equal(result.bySymbolId.SPECIAL!.qualifying, false);
  });

  it("TEST 13: Wild reel restriction respected (W active only on reels [1,2,3], W on reel 0 does not contribute to A)", () => {
    const board = createBoardFromSymbolGrid([
      ["W", "A", "A", "A", "B"], // W on reel 0 (restricted!), 3 A
      ["A", "A", "A", "A", "C"], // 4 A on reel 1 (total 7 natural A)
      ["B", "C", "D", "B", "C"],
      ["C", "D", "B", "C", "D"],
      ["D", "B", "C", "D", "B"],
    ]);

    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["W"],
      substitutionRules: [
        {
          wildSymbolId: "W",
          allowedSubstitutions: ["A", "B", "C"],
          excludedSymbolIds: ["SCATTER"],
          activeReels: [1, 2, 3],
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A"],
        allowWildSubstitution: true,
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
        wildEngine,
      },
    );

    assert.equal(result.wins.length, 0);
    assert.equal(result.bySymbolId.A!.count, 7);
    assert.equal(result.bySymbolId.A!.wildCount, 0);
  });

  it("TEST 14: Wild contributes to multiple eligible symbols independently (7 of A, 7 of B, 1 of W -> both A and B reach 8 and win)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "A", "A", "A", "A"], // 5 A
      ["A", "A", "B", "B", "B"], // 2 A (total 7), 3 B
      ["B", "B", "B", "B", "W"], // 4 B (total 7), 1 W at (2,4)
      ["C", "D", "C", "D", "C"],
      ["D", "C", "D", "C", "D"],
    ]);

    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["W"],
      substitutionRules: [
        {
          wildSymbolId: "W",
          allowedSubstitutions: ["A", "B", "C"],
          excludedSymbolIds: ["SCATTER"],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A", "B"],
        allowWildSubstitution: true,
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
        wildEngine,
      },
    );

    assert.equal(result.wins.length, 2);
    const winA = result.bySymbolId.A!;
    const winB = result.bySymbolId.B!;

    assert.equal(winA.count, 8);
    assert.equal(winA.naturalCount, 7);
    assert.equal(winA.wildCount, 1);
    assert.equal(winA.baseMultiplier, 2);

    assert.equal(winB.count, 8);
    assert.equal(winB.naturalCount, 7);
    assert.equal(winB.wildCount, 1);
    assert.equal(winB.baseMultiplier, 1.5);
  });

  it("TEST 15: Family grouping disabled (allowFamilyGrouping = false, 5 of GEM_1 + 4 of GEM_2 -> neither reaches 8, no win)", () => {
    const board = createBoardFromSymbolGrid([
      ["GEM_1", "GEM_1", "GEM_1", "GEM_1", "GEM_1"], // 5 GEM_1
      ["GEM_2", "GEM_2", "GEM_2", "GEM_2", "C"], // 4 GEM_2
      ["B", "C", "D", "B", "C"],
      ["C", "D", "B", "C", "D"],
      ["D", "B", "C", "D", "B"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["GEM_1", "GEM_2"],
        allowFamilyGrouping: false,
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
        families: [
          {
            id: "GEM_FAMILY",
            name: "Gem Family",
            memberIds: ["GEM_1", "GEM_2"],
          },
        ],
      },
    );

    assert.equal(result.wins.length, 0);
    assert.equal(result.bySymbolId.GEM_1!.count, 5);
    assert.equal(result.bySymbolId.GEM_2!.count, 4);
  });

  it("TEST 16: Family grouping enabled (allowFamilyGrouping = true, 5 of GEM_1 + 4 of GEM_2 -> combined count = 9, qualifying family win)", () => {
    const board = createBoardFromSymbolGrid([
      ["GEM_1", "GEM_1", "GEM_1", "GEM_1", "GEM_1"], // 5 GEM_1
      ["GEM_2", "GEM_2", "GEM_2", "GEM_2", "C"], // 4 GEM_2
      ["B", "C", "D", "B", "C"],
      ["C", "D", "B", "C", "D"],
      ["D", "B", "C", "D", "B"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["GEM_1", "GEM_2"],
        allowFamilyGrouping: true,
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
        families: [
          {
            id: "GEM_FAMILY",
            name: "Gem Family",
            memberIds: ["GEM_1", "GEM_2"],
          },
        ],
      },
    );

    assert.equal(result.wins.length, 1);
    const familyWin = result.wins[0]!;
    assert.equal(familyWin.familyId, "GEM_FAMILY");
    assert.equal(familyWin.count, 9);
    assert.equal(familyWin.qualifying, true);
    assert.equal(familyWin.matchedTierCount, 9);
    assert.equal(familyWin.baseMultiplier, 6);
    assert.equal(familyWin.matchedCells.length, 9);
  });

  it("TEST 17: Over-max count handling (A appears 15 times on 6x5 board, highest tier is 12 -> count is 15, tier 12 multiplier awarded)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "A", "A", "A", "A"], // 5 A
      ["A", "A", "A", "A", "A"], // 5 A
      ["A", "A", "A", "A", "A"], // 5 A (total 15)
      ["B", "C", "D", "B", "C"],
      ["C", "D", "B", "C", "D"],
      ["D", "B", "C", "D", "B"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
      },
    );

    assert.equal(result.wins.length, 1);
    const winA = result.wins[0]!;
    assert.equal(winA.count, 15);
    assert.equal(winA.matchedTierCount, 12);
    assert.equal(winA.baseMultiplier, 15);
    assert.equal(winA.effectiveMultiplier, 15);
  });

  it("TEST 18: Bet scaling (effectiveMultiplier = 10, bet = 2.5 -> finalPayout = 25)", () => {
    // B has tier 12 -> 10x multiplier
    const board = createBoardFromSymbolGrid([
      ["B", "B", "B", "B", "B"],
      ["B", "B", "B", "B", "B"],
      ["B", "B", "C", "D", "C"],
      ["C", "D", "C", "D", "C"],
      ["D", "C", "D", "C", "D"],
    ]);

    const result = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["B"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
        payoutContext: { bet: 2.5 },
      },
    );

    assert.equal(result.wins.length, 1);
    const winB = result.wins[0]!;
    assert.equal(winB.count, 12);
    assert.equal(winB.baseMultiplier, 10);
    assert.equal(winB.effectiveMultiplier, 10);
    assert.equal(winB.finalPayout, 25);
    assert.equal(winB.totalPayout, 25);
    assert.equal(result.totalPayout, 25);
  });

  it("TEST 19: Board immutability (Board snapshot before evaluation equals Board after evaluation)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "A", "A", "A", "D"],
      ["A", "A", "A", "A", "C"],
      ["B", "C", "D", "B", "C"],
      ["C", "D", "B", "C", "D"],
      ["D", "B", "C", "D", "B"],
    ]);

    const snapshotBefore = JSON.stringify(board);

    evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A", "B", "C"],
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
      },
    );

    const snapshotAfter = JSON.stringify(board);
    assert.equal(snapshotAfter, snapshotBefore);
  });

  it("TEST 20: Determinism (100 identical evaluations on the same board and config produce deeply equal results)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "B", "A", "B", "A"],
      ["B", "A", "B", "A", "B"],
      ["A", "B", "A", "B", "A"],
      ["B", "W", "B", "C", "D"],
      ["C", "D", "C", "D", "C"],
      ["D", "C", "D", "C", "D"],
    ]);

    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["W"],
      substitutionRules: [
        {
          wildSymbolId: "W",
          allowedSubstitutions: ["A", "B"],
          excludedSymbolIds: ["SCATTER"],
          activeReels: [0, 1, 2, 3, 4, 5],
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    const config = {
      enabled: true,
      minimumMatchCount: 8,
      eligibleSymbols: ["A", "B", "C"],
      allowWildSubstitution: true,
    };

    const options = {
      symbolRegistry: STANDARD_SYMBOL_REGISTRY,
      paytable: STANDARD_PAYTABLE,
      wildEngine,
      payoutContext: { bet: 1.5 },
    };

    const baseline = evaluatePayAnywhere(board, config, options);
    for (let i = 0; i < 100; i++) {
      const current = evaluatePayAnywhere(board, config, options);
      assert.deepEqual(current, baseline);
    }
  });

  it("TEST 21: Invalid configuration rejection (negative minimum count / unknown eligible symbol / malformed board)", () => {
    const validBoard = createBoardFromSymbolGrid([
      ["A", "B", "C"],
      ["A", "B", "C"],
      ["A", "B", "C"],
    ]);

    // 1. Negative / zero minimumMatchCount
    assert.throws(
      () =>
        evaluatePayAnywhere(validBoard, {
          enabled: true,
          minimumMatchCount: 0,
          eligibleSymbols: ["A"],
        }),
      (err: unknown) => err instanceof InvalidPayAnywhereConfigurationError,
    );

    assert.throws(
      () =>
        evaluatePayAnywhere(validBoard, {
          enabled: true,
          minimumMatchCount: -5,
          eligibleSymbols: ["A"],
        }),
      (err: unknown) => err instanceof InvalidPayAnywhereConfigurationError,
    );

    // 2. Unknown eligible symbol
    assert.throws(
      () =>
        evaluatePayAnywhere(
          validBoard,
          {
            enabled: true,
            minimumMatchCount: 8,
            eligibleSymbols: ["NON_EXISTENT_SYMBOL"],
          },
          {
            symbolRegistry: STANDARD_SYMBOL_REGISTRY,
            paytable: STANDARD_PAYTABLE,
          },
        ),
      (err: unknown) => err instanceof UnknownPayAnywhereSymbolError,
    );

    // 3. Malformed board
    assert.throws(
      () =>
        evaluatePayAnywhere(null as unknown as Board, {
          enabled: true,
          minimumMatchCount: 8,
          eligibleSymbols: ["A"],
        }),
      (err: unknown) => err instanceof InvalidBoardError,
    );
  });

  it("TEST 22: Serialization round-trip (PayAnywhereEvaluationResult -> JSON.stringify -> JSON.parse -> deeply equal)", () => {
    const board = createBoardFromSymbolGrid([
      ["A", "A", "A", "A", "B"],
      ["A", "A", "A", "W", "B"],
      ["B", "B", "B", "B", "B"],
      ["B", "C", "D", "C", "D"],
      ["C", "D", "C", "D", "C"],
    ]);

    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["W"],
      substitutionRules: [
        {
          wildSymbolId: "W",
          allowedSubstitutions: ["A", "B"],
          excludedSymbolIds: ["SCATTER"],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    const original = evaluatePayAnywhere(
      board,
      {
        enabled: true,
        minimumMatchCount: 8,
        eligibleSymbols: ["A", "B", "C"],
        allowWildSubstitution: true,
      },
      {
        symbolRegistry: STANDARD_SYMBOL_REGISTRY,
        paytable: STANDARD_PAYTABLE,
        wildEngine,
        payoutContext: { bet: 2 },
      },
    );

    const json = serializePayAnywhereEvaluationResult(original);
    const restored = deserializePayAnywhereEvaluationResult(json);

    assert.deepEqual(restored, original);
  });

  it("End-to-end B02 + B03 + B04 + B06 + B07 + B11 pipeline integration with GameConfig and PaytableEngine", () => {
    const blueprint = createBlueprint({
      id: "bp-payanywhere-e2e",
      title: "Olympus Gates Pay Anywhere",
      theme: "Ancient Greek",
      columns: 6,
      rows: 5,
    });

    const gameConfig = adaptBlueprintToGameConfig(blueprint);
    const rng = createSeededRng("b11-payanywhere-seed-2026");
    const reelEngine = createReelEngine();
    const board = reelEngine.resolve(gameConfig, rng).board;

    const paytableEngine = createPaytableEngine(gameConfig);
    const payAnywhereEngine = createPayAnywhereEngine({
      config: {
        enabled: true,
        minimumMatchCount: 3,
        eligibleSymbols: gameConfig.symbols
          .filter(
            (s) => !s.role.isWild && !s.role.isScatter && !s.role.isBonus,
          )
          .map((s) => s.id),
        allowWildSubstitution: true,
      },
      options: {
        symbolRegistry: gameConfig,
        paytable: paytableEngine,
        payoutContext: { bet: 1 },
      },
    });

    const result = payAnywhereEngine.evaluate(board);
    assert.equal(result.evaluationMode, "payAnywhere");
    assert.equal(result.enabled, true);
    assert.ok(result.evaluatedSymbolCount >= 1);
  });
});
