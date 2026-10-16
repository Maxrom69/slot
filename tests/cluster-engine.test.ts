/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B10 — Cluster Engine Unit & Integration Test Suite
 *
 * Covers TEST 1 through TEST 23 from the B10 specification:
 *  1. Basic Edge Cluster (size = 4, exact member cells)
 *  2. Exact Minimum (3 connected A cells -> 1 qualifying cluster)
 *  3. Below Minimum (2 connected A cells -> 0 qualifying clusters)
 *  4. Large Cluster (6+ connected A cells -> 1 cluster with all cells)
 *  5. Two Separate Clusters (two disconnected A groups -> 2 ClusterWin results)
 *  6. Diagonal Only (corner-touching cells do NOT form a cluster in edge mode)
 *  7. Edge Adjacency (horizontally and vertically touching cells form 1 cluster)
 *  8. Hex Adjacency (hex-staggered connected cells form 1 cluster in hex mode, 0 in edge mode)
 *  9. Disabled Engine (enabled: false -> 0 cluster results)
 * 10. Wild Substitution (Wild joins A cluster according to B07, preserves actualSymbolId/effectiveSymbolId)
 * 11. Wild Cannot Substitute (disabled substitution or restricted Wild does not join A cluster)
 * 12. Multiple Wilds (multiple Wild cells participate in cluster when allowed)
 * 13. Symbol Family (configured B02 family members form 1 cluster when allowFamilyGrouping: true)
 * 14. Non-Family Symbols (unrelated symbol IDs remain separate)
 * 15. Multiple Symbol Types (A cluster and K cluster on same board produce independent results)
 * 16. No Payline Dependency (changing/clearing paylines has zero effect on cluster results)
 * 17. No RNG (zero RandomSource or Math.random usage)
 * 18. Determinism (100 identical runs produce deep-equal output and deterministic ordering)
 * 19. Input Immutability (Board, ClusterConfiguration, and frozen results cannot be mutated)
 * 20. Serialization (serializeClusterEvaluationResult / deserializeClusterEvaluationResult round-trip)
 * 21. Invalid Minimum (minimumClusterSize <= 0 throws InvalidMinimumClusterSizeError)
 * 22. Invalid Adjacency (unsupported adjacency mode throws InvalidAdjacencyModeError)
 * 23. Empty Board (empty board throws InvalidBoardError)
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  type Board,
  type ClusterConfiguration,
  InvalidAdjacencyModeError,
  InvalidBoardError,
  InvalidClusterConfigurationError,
  InvalidFamilyReferenceError,
  InvalidMinimumClusterSizeError,
  UnknownSymbolReferenceError,
  adaptBlueprintToGameConfig,
  createBoardFromSymbolGrid,
  createClusterEngine,
  createPaytableEngine,
  createReelEngine,
  createSeededRng,
  createWildEngine,
  deserializeClusterEvaluationResult,
  evaluateClusters,
  getAdjacentPositions,
  serializeClusterEvaluationResult,
} from "../src/engine";
import { createBlueprint } from "../src/lib/blueprint/factory";

/**
 * Helper to build an authoritative B04-compatible 5x3 Board from a row-major
 * 3x5 visual matrix (3 rows, 5 reels).
 *
 * Rows array has 3 rows, each of length 5:
 * rows[rowIndex][reelIndex]
 */
function buildBoardFromRows(rowsMatrix: readonly (readonly string[])[]): Board {
  const rowCount = rowsMatrix.length;
  const reelCount = rowsMatrix[0]?.length ?? 0;
  const columnsMatrix: string[][] = [];

  for (let reelIndex = 0; reelIndex < reelCount; reelIndex++) {
    const col: string[] = [];
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      col.push(rowsMatrix[rowIndex]![reelIndex]!);
    }
    columnsMatrix.push(col);
  }

  return createBoardFromSymbolGrid(columnsMatrix);
}

const TEST_SYMBOL_REGISTRY = [
  { id: "A", isWild: false, isScatter: false, isBonus: false },
  { id: "K", isWild: false, isScatter: false, isBonus: false },
  { id: "Q", isWild: false, isScatter: false, isBonus: false },
  { id: "J", isWild: false, isScatter: false, isBonus: false },
  { id: "T", isWild: false, isScatter: false, isBonus: false },
  { id: "WILD", isWild: true, isScatter: false, isBonus: false },
  { id: "SCATTER", isWild: false, isScatter: true, isBonus: false },
] as const;

const TEST_PAYTABLE = {
  A: { 3: 2, 4: 5, 5: 12, 6: 25, 7: 50 },
  K: { 3: 1.5, 4: 4, 5: 10, 6: 20 },
  Q: { 3: 1, 4: 2.5, 5: 6, 6: 12 },
} as const;

const DEFAULT_CLUSTER_CONFIG: ClusterConfiguration = Object.freeze({
  enabled: true,
  minimumClusterSize: 3,
  adjacency: "edge",
  allowWildJoin: true,
  allowFamilyGrouping: false,
});

test("B10.1 — Core Connected-Component Cluster Discovery, Edge vs Hex Adjacency, Wilds, and Symbol Families (TEST 1 through TEST 15)", () => {
  const engine = createClusterEngine({
    config: DEFAULT_CLUSTER_CONFIG,
    options: {
      symbolRegistry: TEST_SYMBOL_REGISTRY,
      paytable: TEST_PAYTABLE,
    },
  });

  // TEST 1: BASIC EDGE CLUSTER (size = 4, exact member cells)
  // Visual 3x5 board:
  // A A Q J T
  // A K Q J T
  // A K Q J T
  {
    const board = buildBoardFromRows([
      ["A", "A", "Q", "J", "T"],
      ["A", "K", "Q", "J", "T"],
      ["A", "K", "Q", "J", "T"],
    ]);

    const result = engine.evaluate(board, {
      enabled: true,
      minimumClusterSize: 3,
      adjacency: "edge",
      eligibleSymbols: ["A"],
    });

    assert.equal(result.qualifyingClusterCount, 1);
    assert.equal(result.totalClusterCells, 4);
    const cluster = result.clusters[0]!;
    assert.equal(cluster.symbolId, "A");
    assert.equal(cluster.size, 4);
    assert.equal(cluster.clusterSize, 4);
    assert.equal(cluster.baseMultiplier, 5);
    assert.deepEqual(
      cluster.cells.map((c) => [c.reelIndex, c.rowIndex, c.symbolId]),
      [
        [0, 0, "A"],
        [0, 1, "A"],
        [0, 2, "A"],
        [1, 0, "A"],
      ],
    );
  }

  // TEST 2: EXACT MINIMUM (3 connected A cells -> 1 qualifying cluster)
  {
    const board = buildBoardFromRows([
      ["A", "A", "K", "Q", "J"],
      ["A", "K", "Q", "J", "T"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    const result = engine.evaluate(board);
    assert.equal(result.qualifyingClusterCount, 1);
    assert.equal(result.clusters[0]!.symbolId, "A");
    assert.equal(result.clusters[0]!.size, 3);
    assert.equal(result.clusters[0]!.baseMultiplier, 2);
  }

  // TEST 3: BELOW MINIMUM (2 connected A cells with minimumClusterSize = 3 -> 0 clusters)
  {
    const board = buildBoardFromRows([
      ["A", "A", "K", "Q", "J"],
      ["K", "Q", "J", "T", "K"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    const result = engine.evaluate(board);
    assert.equal(result.qualifyingClusterCount, 0);
    assert.equal(result.clusters.length, 0);
    assert.equal(result.totalClusterCells, 0);
  }

  // TEST 4: LARGE CLUSTER (7 connected A cells -> 1 cluster containing every connected cell)
  {
    const board = buildBoardFromRows([
      ["A", "A", "A", "K", "Q"],
      ["A", "A", "K", "Q", "J"],
      ["A", "A", "Q", "J", "T"],
    ]);

    const result = engine.evaluate(board);
    assert.equal(result.qualifyingClusterCount, 1);
    const cluster = result.clusters[0]!;
    assert.equal(cluster.symbolId, "A");
    assert.equal(cluster.size, 7);
    assert.equal(cluster.baseMultiplier, 50);
    assert.deepEqual(
      cluster.cells.map((c) => [c.reelIndex, c.rowIndex]),
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [1, 0],
        [1, 1],
        [1, 2],
        [2, 0],
      ],
    );
  }

  // TEST 5: TWO SEPARATE CLUSTERS (two disconnected A groups -> 2 separate ClusterWin results)
  // A A . . A
  // A . . . A
  // . . . . A
  {
    const board = buildBoardFromRows([
      ["A", "A", "K", "Q", "A"],
      ["A", "Q", "J", "T", "A"],
      ["K", "J", "T", "Q", "A"],
    ]);

    const result = engine.evaluate(board);
    assert.equal(result.qualifyingClusterCount, 2);
    assert.equal(result.totalClusterCells, 6);

    const [first, second] = result.clusters;
    assert.equal(first!.symbolId, "A");
    assert.equal(first!.size, 3);
    assert.deepEqual(
      first!.cells.map((c) => [c.reelIndex, c.rowIndex]),
      [
        [0, 0],
        [0, 1],
        [1, 0],
      ],
    );

    assert.equal(second!.symbolId, "A");
    assert.equal(second!.size, 3);
    assert.deepEqual(
      second!.cells.map((c) => [c.reelIndex, c.rowIndex]),
      [
        [4, 0],
        [4, 1],
        [4, 2],
      ],
    );
  }

  // TEST 6: DIAGONAL ONLY (corner-only contact does NOT form a cluster in edge mode)
  {
    const board = buildBoardFromRows([
      ["A", "K", "Q", "J", "T"],
      ["K", "A", "Q", "J", "T"],
      ["Q", "K", "A", "J", "T"],
    ]);

    const result = engine.evaluate(board, {
      enabled: true,
      minimumClusterSize: 3,
      adjacency: "edge",
      eligibleSymbols: ["A"],
    });
    assert.equal(result.qualifyingClusterCount, 0);
  }

  // TEST 7: EDGE ADJACENCY (L-shaped horizontally + vertically touching cells form 1 cluster)
  {
    const board = buildBoardFromRows([
      ["K", "A", "Q", "J", "T"],
      ["K", "A", "A", "A", "T"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    const result = engine.evaluate(board, {
      enabled: true,
      minimumClusterSize: 3,
      adjacency: "edge",
      eligibleSymbols: ["A"],
    });
    assert.equal(result.qualifyingClusterCount, 1);
    assert.equal(result.clusters[0]!.size, 4);
    assert.deepEqual(
      result.clusters[0]!.cells.map((c) => [c.reelIndex, c.rowIndex]),
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [3, 1],
      ],
    );
  }

  // TEST 8: HEX ADJACENCY
  // Under odd-q hex topology:
  // (0, 1) [even col 0, row 1] is hex-adjacent to (1, 0) [odd col 1, row 0],
  // and (1, 0) [odd col 1, row 0] is hex-adjacent to (2, 1) [even col 2, row 1].
  // None of (0, 1), (1, 0), (2, 1) share an orthogonal edge!
  {
    const board = buildBoardFromRows([
      ["K", "A", "Q", "J", "T"],
      ["A", "K", "A", "J", "T"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    // Verify in edge mode: 0 clusters for A
    const edgeResult = engine.evaluate(board, {
      enabled: true,
      minimumClusterSize: 3,
      adjacency: "edge",
      eligibleSymbols: ["A"],
    });
    assert.equal(edgeResult.qualifyingClusterCount, 0);

    // Verify in hex mode: 1 cluster of size 3 for A: (0,1) - (1,0) - (2,1)
    const hexResult = engine.evaluate(board, {
      enabled: true,
      minimumClusterSize: 3,
      adjacency: "hex",
      eligibleSymbols: ["A"],
    });
    assert.equal(hexResult.qualifyingClusterCount, 1);
    assert.equal(hexResult.clusters[0]!.size, 3);
    assert.equal(hexResult.clusters[0]!.adjacency, "hex");
    assert.deepEqual(
      hexResult.clusters[0]!.cells.map((c) => [c.reelIndex, c.rowIndex]),
      [
        [0, 1],
        [1, 0],
        [2, 1],
      ],
    );

    // Also verify symmetry of getAdjacentPositions in hex mode
    const neighborsOf0_1 = getAdjacentPositions(
      board,
      { reelIndex: 0, rowIndex: 1 },
      "hex",
    );
    assert.ok(
      neighborsOf0_1.some((p) => p.reelIndex === 1 && p.rowIndex === 0),
    );
    const neighborsOf1_0 = getAdjacentPositions(
      board,
      { reelIndex: 1, rowIndex: 0 },
      "hex",
    );
    assert.ok(
      neighborsOf1_0.some((p) => p.reelIndex === 0 && p.rowIndex === 1),
    );
  }

  // TEST 9: DISABLED ENGINE (enabled: false -> 0 cluster results)
  {
    const board = buildBoardFromRows([
      ["A", "A", "A", "A", "A"],
      ["A", "A", "A", "A", "A"],
      ["A", "A", "A", "A", "A"],
    ]);

    const disabledResult = engine.evaluate(board, {
      enabled: false,
      minimumClusterSize: 3,
      adjacency: "edge",
    });
    assert.equal(disabledResult.enabled, false);
    assert.equal(disabledResult.qualifyingClusterCount, 0);
    assert.equal(disabledResult.clusters.length, 0);
    assert.equal(disabledResult.totalClusterCells, 0);
  }

  // TEST 10: WILD SUBSTITUTION (Wild joins A cluster via B07 and preserves actual/effective symbol IDs)
  // A A
  // WILD A
  {
    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["WILD"],
      substitutionRules: [
        {
          wildSymbolId: "WILD",
          allowedSubstitutions: "allRegular",
          excludedSymbolIds: ["SCATTER"],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    const board = buildBoardFromRows([
      ["A", "A", "K", "Q", "J"],
      ["WILD", "A", "Q", "J", "T"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    const result = engine.evaluate(
      board,
      {
        enabled: true,
        minimumClusterSize: 3,
        adjacency: "edge",
        allowWildJoin: true,
      },
      { wildEngine },
    );

    assert.equal(result.qualifyingClusterCount, 1);
    const cluster = result.clusters[0]!;
    assert.equal(cluster.symbolId, "A");
    assert.equal(cluster.size, 4);
    assert.equal(cluster.wildCount, 1);
    assert.equal(cluster.naturalCount, 3);
    assert.deepEqual(cluster.participatingSymbols, ["A", "WILD"]);

    const wildCell = cluster.cells.find(
      (c) => c.reelIndex === 0 && c.rowIndex === 1,
    )!;
    assert.equal(wildCell.symbolId, "WILD");
    assert.equal(wildCell.actualSymbolId, "WILD");
    assert.equal(wildCell.effectiveSymbolId, "A");
    assert.equal(wildCell.isWild, true);
  }

  // TEST 11: WILD CANNOT SUBSTITUTE (B07 excludes A OR allowWildJoin: false)
  {
    const restrictedWildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["WILD"],
      substitutionRules: [
        {
          wildSymbolId: "WILD",
          allowedSubstitutions: ["K", "Q"],
          excludedSymbolIds: ["A", "SCATTER"],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base", "freeSpins", "bonus"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    // Only 2 natural A cells + 1 WILD cell -> if Wild cannot substitute for A, size is 2 (< 3)
    const board = buildBoardFromRows([
      ["A", "A", "K", "Q", "J"],
      ["WILD", "T", "J", "T", "K"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    const resultRestrictedTarget = engine.evaluate(
      board,
      {
        enabled: true,
        minimumClusterSize: 3,
        adjacency: "edge",
        allowWildJoin: true,
      },
      { wildEngine: restrictedWildEngine },
    );
    assert.equal(resultRestrictedTarget.qualifyingClusterCount, 0);

    // Even with unrestricted WildEngine, allowWildJoin: false prevents Wild from joining
    const unrestrictedWildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["WILD"],
      substitutionRules: [
        {
          wildSymbolId: "WILD",
          allowedSubstitutions: "allRegular",
          excludedSymbolIds: [],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    const resultDisallowedConfig = engine.evaluate(
      board,
      {
        enabled: true,
        minimumClusterSize: 3,
        adjacency: "edge",
        allowWildJoin: false,
      },
      { wildEngine: unrestrictedWildEngine },
    );
    assert.equal(resultDisallowedConfig.qualifyingClusterCount, 0);
  }

  // TEST 12: MULTIPLE WILDS (multiple Wild cells bridge and join an A cluster)
  {
    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["WILD"],
      substitutionRules: [
        {
          wildSymbolId: "WILD",
          allowedSubstitutions: "allRegular",
          excludedSymbolIds: ["SCATTER"],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    // A(0,0) - WILD(1,0) - WILD(2,0) - A(3,0) -> connected cluster of size 4
    const board = buildBoardFromRows([
      ["A", "WILD", "WILD", "A", "J"],
      ["K", "SCATTER", "SCATTER", "T", "K"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    const result = engine.evaluate(
      board,
      {
        enabled: true,
        minimumClusterSize: 3,
        adjacency: "edge",
        allowWildJoin: true,
      },
      { wildEngine },
    );

    assert.equal(result.qualifyingClusterCount, 1);
    const cluster = result.clusters[0]!;
    assert.equal(cluster.symbolId, "A");
    assert.equal(cluster.size, 4);
    assert.equal(cluster.wildCount, 2);
    assert.equal(cluster.naturalCount, 2);
    assert.equal(cluster.baseMultiplier, 5);
  }

  // TEST 13: SYMBOL FAMILY (B02 family members form 1 cluster when allowFamilyGrouping: true)
  // TEST 14: NON-FAMILY SYMBOLS (remain separate when allowFamilyGrouping: false or unrelated)
  {
    const familySymbolRegistry = [
      { id: "SUN_MINOR", familyId: "SUN_FAMILY" },
      { id: "SUN_MAJOR", familyId: "SUN_FAMILY" },
      { id: "SUN_MEGA", familyId: "SUN_FAMILY" },
      { id: "K", familyId: null },
      { id: "Q", familyId: null },
      { id: "J", familyId: null },
      { id: "T", familyId: null },
    ];

    const board = buildBoardFromRows([
      ["SUN_MINOR", "SUN_MAJOR", "SUN_MEGA", "K", "Q"],
      ["K", "Q", "J", "T", "K"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    // When allowFamilyGrouping: true -> 1 cluster for SUN_FAMILY of size 3
    const familyEnabledResult = evaluateClusters(
      board,
      {
        enabled: true,
        minimumClusterSize: 3,
        adjacency: "edge",
        allowWildJoin: false,
        allowFamilyGrouping: true,
      },
      {
        symbolRegistry: familySymbolRegistry,
      },
    );

    assert.equal(familyEnabledResult.qualifyingClusterCount, 1);
    const famCluster = familyEnabledResult.clusters[0]!;
    assert.equal(famCluster.symbolId, "SUN_FAMILY");
    assert.equal(famCluster.familyId, "SUN_FAMILY");
    assert.equal(famCluster.size, 3);
    assert.deepEqual(famCluster.participatingSymbols, [
      "SUN_MAJOR",
      "SUN_MEGA",
      "SUN_MINOR",
    ]);
    assert.deepEqual(famCluster.symbolCounts, {
      SUN_MAJOR: 1,
      SUN_MEGA: 1,
      SUN_MINOR: 1,
    });
    // Because no familyPayoutSymbolByFamilyId was configured and 3 distinct members participated,
    // B10 does NOT silently invent a payout symbol
    assert.equal(famCluster.payoutSymbolId, undefined);
    assert.equal(famCluster.baseMultiplier, undefined);

    // When allowFamilyGrouping: false (TEST 14) -> each variant has only 1 cell (< 3), so 0 clusters
    const familyDisabledResult = evaluateClusters(
      board,
      {
        enabled: true,
        minimumClusterSize: 3,
        adjacency: "edge",
        allowWildJoin: false,
        allowFamilyGrouping: false,
      },
      {
        symbolRegistry: familySymbolRegistry,
      },
    );
    assert.equal(familyDisabledResult.qualifyingClusterCount, 0);
  }

  // TEST 15: MULTIPLE SYMBOL TYPES (A cluster and K cluster on same board, even sharing a Wild)
  {
    const wildEngine = createWildEngine({
      enabled: true,
      symbolIds: ["WILD"],
      substitutionRules: [
        {
          wildSymbolId: "WILD",
          allowedSubstitutions: "allRegular",
          excludedSymbolIds: ["SCATTER"],
          activeReels: [0, 1, 2, 3, 4],
          activeModes: ["base"],
          paysOnOwn: false,
          multiplier: 1,
        },
      ],
    });

    // A at (0,0), (0,1) + WILD at (1,1) -> A cluster of size 3
    // K at (2,1), (2,2) + WILD at (1,1) -> K cluster of size 3
    const board = buildBoardFromRows([
      ["A", "Q", "J", "T", "Q"],
      ["A", "WILD", "K", "Q", "J"],
      ["Q", "J", "K", "T", "Q"],
    ]);

    const result = engine.evaluate(
      board,
      {
        enabled: true,
        minimumClusterSize: 3,
        adjacency: "edge",
        allowWildJoin: true,
      },
      { wildEngine },
    );

    assert.equal(result.qualifyingClusterCount, 2);
    assert.equal(result.clusters[0]!.symbolId, "A");
    assert.equal(result.clusters[0]!.size, 3);
    assert.equal(result.clusters[0]!.baseMultiplier, 2);

    assert.equal(result.clusters[1]!.symbolId, "K");
    assert.equal(result.clusters[1]!.size, 3);
    assert.equal(result.clusters[1]!.baseMultiplier, 1.5);

    // Total cluster cells = 3 + 3 = 6; unique winning cells = 5 (since WILD at (1,1) is shared)
    assert.equal(result.totalClusterCells, 6);
    assert.equal(result.uniqueWinningCellCount, 5);
    assert.equal(result.totalBaseMultiplier, 3.5);
  }
});

test("B10.2 — No Paylines, No RNG, Determinism, Immutability, Serialization, Error Model, and Full Pipeline (TEST 16 through TEST 23)", () => {
  // TEST 16: NO PAYLINE DEPENDENCY
  {
    const bp1 = createBlueprint({
      id: "cluster-test-1",
      title: "Cluster Test 1",
      theme: "Cosmic",
      columns: 5,
      rows: 3,
    });
    bp1.reels.evaluation = "cluster";
    bp1.paylines = bp1.paylines.slice(0, 1);
    const bp2 = structuredClone(bp1);
    bp2.paylines = [];

    const config1 = adaptBlueprintToGameConfig(bp1);
    const config2 = adaptBlueprintToGameConfig(bp2);

    const symA = config1.symbols[0]!.id;
    const symB = config1.symbols[1]!.id;
    const symC = config1.symbols[2]!.id;

    const board = buildBoardFromRows([
      [symA, symA, symA, symB, symC],
      [symA, symA, symB, symC, symB],
      [symB, symC, symB, symC, symB],
    ]);

    const res1 = evaluateClusters(board, config1);
    const res2 = evaluateClusters(board, config2);
    assert.deepEqual(res1, res2);
    assert.equal(res1.qualifyingClusterCount, 1);
    assert.equal(res1.clusters[0]!.size, 5);
  }

  // TEST 17: NO RNG (static source verification + zero Math.random invocation)
  {
    const clustersSource = fs.readFileSync(
      path.resolve(process.cwd(), "src/engine/clusters/index.ts"),
      "utf8",
    );
    assert.equal(/Math\.random/.test(clustersSource), false);
    assert.equal(/RandomSource/.test(clustersSource), false);
  }

  // TEST 18: DETERMINISM (100 identical runs produce deep-equal results and deterministic ordering)
  {
    const board = buildBoardFromRows([
      ["K", "K", "K", "A", "A"],
      ["Q", "J", "T", "A", "A"],
      ["A", "A", "A", "Q", "J"],
    ]);

    const baseline = evaluateClusters(board, DEFAULT_CLUSTER_CONFIG, {
      symbolRegistry: TEST_SYMBOL_REGISTRY,
      paytable: TEST_PAYTABLE,
    });

    // Verify deterministic ordering:
    // 1. A cluster anchored at (0, 2)
    // 2. A cluster anchored at (3, 0)
    // 3. K cluster anchored at (0, 0)
    assert.equal(baseline.qualifyingClusterCount, 3);
    assert.deepEqual(
      baseline.clusters.map((c) => c.id),
      ["cluster:A:r0c2", "cluster:A:r3c0", "cluster:K:r0c0"],
    );

    for (let i = 0; i < 100; i++) {
      const repeat = evaluateClusters(board, DEFAULT_CLUSTER_CONFIG, {
        symbolRegistry: TEST_SYMBOL_REGISTRY,
        paytable: TEST_PAYTABLE,
      });
      assert.deepEqual(repeat, baseline);
    }
  }

  // TEST 19: INPUT IMMUTABILITY & FROZEN OUTPUT
  {
    const board = buildBoardFromRows([
      ["A", "A", "A", "K", "Q"],
      ["K", "Q", "J", "T", "K"],
      ["Q", "J", "T", "K", "Q"],
    ]);
    const boardSnapshot = JSON.stringify(board);

    const config: ClusterConfiguration = {
      enabled: true,
      minimumClusterSize: 3,
      adjacency: "edge",
      allowWildJoin: true,
      allowFamilyGrouping: false,
    };
    const configSnapshot = JSON.stringify(config);

    const result = evaluateClusters(board, config, {
      symbolRegistry: TEST_SYMBOL_REGISTRY,
      paytable: TEST_PAYTABLE,
    });

    assert.equal(JSON.stringify(board), boardSnapshot);
    assert.equal(JSON.stringify(config), configSnapshot);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.clusters), true);
    assert.equal(Object.isFrozen(result.clusters[0]), true);
    assert.equal(Object.isFrozen(result.clusters[0]!.cells), true);
    assert.equal(Object.isFrozen(result.clusters[0]!.cells[0]), true);
  }

  // TEST 20: SERIALIZATION ROUND-TRIP
  {
    const board = buildBoardFromRows([
      ["A", "A", "A", "K", "Q"],
      ["A", "K", "K", "K", "Q"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    const original = evaluateClusters(board, DEFAULT_CLUSTER_CONFIG, {
      symbolRegistry: TEST_SYMBOL_REGISTRY,
      paytable: TEST_PAYTABLE,
      payoutContext: { bet: 2 },
    });

    const json = serializeClusterEvaluationResult(original);
    const restored = deserializeClusterEvaluationResult(json);

    assert.deepEqual(restored, original);
    assert.equal(Object.isFrozen(restored), true);
    assert.equal(Object.isFrozen(restored.clusters[0]), true);
  }

  // TEST 21: INVALID MINIMUM (minimumClusterSize <= 0 or non-integer)
  {
    const board = buildBoardFromRows([
      ["A", "A", "A", "K", "Q"],
      ["K", "Q", "J", "T", "K"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    assert.throws(
      () =>
        evaluateClusters(board, {
          enabled: true,
          minimumClusterSize: 0,
          adjacency: "edge",
        }),
      (err: unknown) =>
        err instanceof InvalidMinimumClusterSizeError &&
        err.code === "INVALID_MINIMUM_CLUSTER_SIZE",
    );

    assert.throws(
      () =>
        evaluateClusters(board, {
          enabled: true,
          minimumClusterSize: -3,
          adjacency: "edge",
        }),
      (err: unknown) =>
        err instanceof InvalidMinimumClusterSizeError &&
        err.code === "INVALID_MINIMUM_CLUSTER_SIZE",
    );
  }

  // TEST 22: INVALID ADJACENCY (unsupported adjacency mode)
  {
    const board = buildBoardFromRows([
      ["A", "A", "A", "K", "Q"],
      ["K", "Q", "J", "T", "K"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    assert.throws(
      () =>
        evaluateClusters(board, {
          enabled: true,
          minimumClusterSize: 3,
          adjacency: "diagonal" as unknown as "edge",
        }),
      (err: unknown) =>
        err instanceof InvalidAdjacencyModeError &&
        err.code === "INVALID_ADJACENCY_MODE",
    );
  }

  // TEST 23: EMPTY BOARD & STRUCTURED SYMBOL / FAMILY ERRORS
  {
    assert.throws(
      () =>
        evaluateClusters(
          {
            reelCount: 0,
            rowCount: 0,
            columns: 0,
            rows: 0,
            reelHeights: [],
            cells: [],
          },
          DEFAULT_CLUSTER_CONFIG,
        ),
      (err: unknown) =>
        err instanceof InvalidBoardError && err.code === "INVALID_BOARD",
    );

    const boardWithUnknown = buildBoardFromRows([
      ["UNKNOWN_SYM", "A", "A", "K", "Q"],
      ["K", "Q", "J", "T", "K"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    assert.throws(
      () =>
        evaluateClusters(boardWithUnknown, DEFAULT_CLUSTER_CONFIG, {
          symbolRegistry: TEST_SYMBOL_REGISTRY,
        }),
      (err: unknown) =>
        err instanceof UnknownSymbolReferenceError &&
        err.code === "INVALID_SYMBOL_REFERENCE",
    );

    const validBoard = buildBoardFromRows([
      ["A", "A", "A", "K", "Q"],
      ["K", "Q", "J", "T", "K"],
      ["Q", "J", "T", "K", "Q"],
    ]);

    assert.throws(
      () =>
        evaluateClusters(
          validBoard,
          {
            enabled: true,
            minimumClusterSize: 3,
            adjacency: "edge",
            allowFamilyGrouping: true,
            familyPayoutSymbolByFamilyId: {
              NON_EXISTENT_FAMILY: "A",
            },
          },
          { symbolRegistry: TEST_SYMBOL_REGISTRY },
        ),
      (err: unknown) =>
        err instanceof InvalidFamilyReferenceError &&
        err.code === "INVALID_FAMILY_REFERENCE",
    );

    assert.throws(
      () => deserializeClusterEvaluationResult("not-valid-json"),
      (err: unknown) => err instanceof InvalidClusterConfigurationError,
    );
  }

  // End-to-End B02 + B03 + B04 + B06 + B07 + B10 Pipeline Integration
  {
    const bp = createBlueprint({
      id: "cluster-pipeline-test",
      title: "Cluster Pipeline Test",
      theme: "Cosmic",
      columns: 5,
      rows: 3,
    });
    bp.reels.evaluation = "cluster";
    const gameConfig = adaptBlueprintToGameConfig(bp);
    const rng = createSeededRng("b10-cluster-pipeline-seed");
    const reelEngine = createReelEngine();
    const paytableEngine = createPaytableEngine(gameConfig);
    const wildEngine = createWildEngine(gameConfig);
    const clusterEngine = createClusterEngine({
      config: {
        enabled: true,
        minimumClusterSize: 3,
        adjacency: "edge",
        allowWildJoin: true,
        allowFamilyGrouping: false,
      },
      options: {
        symbolRegistry: gameConfig,
        wildEngine,
        paytable: paytableEngine,
      },
    });

    const board = reelEngine.resolve(gameConfig, rng).board;
    const clusterResult = clusterEngine.evaluate(board);
    assert.equal(clusterResult.evaluationMode, "cluster");
    assert.ok(clusterResult.qualifyingClusterCount >= 0);
  }
});
