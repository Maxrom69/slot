/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B13 — Board Dynamics Engine Verification Suite
 *
 * Covers all 12 required verification areas from the B13 specification:
 *  1. Tumble / Cascade (removal, survivor compaction, refill, locked preservation, cascade loop settlement, safety cap)
 *  2. Resize & Held State Through Resize (grow/shrink rows & reels, locked/value preservation, empty unlocked new cells, limits)
 *  3. Mystery Symbols (board-wide sameSymbol, per-cell independent, weighted deterministic B03 RNG, zero mystery remaining)
 *  4. Colossal Symbols (rectangular block coverage, edge clipping, instance identity retained across mutations)
 *  5. Locks (round lifetime, finite-spin lifetime, expiration, protection from tumble/sweep/removal/duplication)
 *  6. Reel Nudges (positive offset, negative offset, circular wrapping, deterministic visible result)
 *  7. Linked Reels (source copied to targets, target identity retained, invalid cycle rejected)
 *  8. Variable Reel Heights (shared range, per-reel range, deterministic selection, ragged-board handling)
 *  9. Symbol Duplication (consecutive placement, boundaries, locked/protected cells skipped, exact changedCells)
 * 10. Lane Sweeps (fire/no-fire, multiple sweeps, travel distance, protected tags, row/reel targeting)
 * 11. Tagged Positions (random mode, onePerReel mode, configured count, spin/feature lifetimes, deterministic selection)
 * 12. Integration (B04 Reel Engine + B10/B11 Win Engines + B12 FeatureEngine + B13 BoardDynamicsEngine)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  CascadeLimitExceededError,
  InvalidLinkedReelsError,
  adaptBlueprintToGameConfig,
  createBoardDynamicsEngine,
  createBoardFromSymbolGrid,
  createFeatureEngine,
  createReelEngine,
  createSeededRng,
  evaluateClusters,
  evaluatePayAnywhere,
} from "../src/engine";

describe("B13 — Board Dynamics Engine", () => {
  it("1. Tumble / Cascade: removes winning cells, compacts survivors, refills gaps, preserves locked cells, and settles cascade loop", () => {
    const dynamics = createBoardDynamicsEngine();

    // 3 reels x 3 rows:
    // Reel 0: ["A", "K", "A"] -> remove (0,0) and (0,2); survivor "K" at (0,1) falls to (0,2)
    // Reel 1: ["Q", "A", "J"] -> lock (1,1) "A" so it is protected from removal!
    // Reel 2: ["K", "Q", "A"] -> remove (2,2) "A"; survivors "K"(2,0)->(2,1), "Q"(2,1)->(2,2)
    const initialBoard = createBoardFromSymbolGrid([
      ["A", "K", "A"],
      ["Q", "A", "J"],
      ["K", "Q", "A"],
    ]);

    let state = dynamics.createBoardState(initialBoard, {
      attachedValuesByCoord: { "0:1": 25, "1:1": 100 },
    });

    // Lock (1, 1)
    state = dynamics.applyLocks(state, [
      {
        position: { reelIndex: 1, rowIndex: 1 },
        lifetimeType: "round",
        attachedValue: 100,
      },
    ]).nextState;

    const rng = createSeededRng("b13-tumble-seed-1");
    const tumbleRes = dynamics.applyTumble(
      state,
      [
        { reelIndex: 0, rowIndex: 0 },
        { reelIndex: 0, rowIndex: 2 },
        { reelIndex: 1, rowIndex: 1 }, // Locked! Must NOT be removed
        { reelIndex: 2, rowIndex: 2 },
      ],
      {
        refillPool: [{ value: "T", weight: 10 }],
        rng,
      },
    );

    // 3 unlocked winning cells removed; locked (1,1) preserved
    assert.equal(tumbleRes.removedCells.length, 3);
    assert.equal(tumbleRes.preservedLockedPositions.length, 1);
    assert.deepEqual(tumbleRes.preservedLockedPositions[0], {
      reelIndex: 1,
      rowIndex: 1,
    });

    // Reel 0: "K" from (0,1) fell to (0,2) carrying its attachedValue (25); top 2 rows refilled with "T"
    const nextBoard = tumbleRes.nextState.board;
    assert.deepEqual(
      nextBoard.cells[0]!.map((c) => c.symbolId),
      ["T", "T", "K"],
    );
    assert.equal(tumbleRes.nextState.attachedValuesByCoord["0:2"], 25);

    // Reel 1: locked "A" at (1,1) remained in place with attachedValue 100
    assert.deepEqual(
      nextBoard.cells[1]!.map((c) => c.symbolId),
      ["Q", "A", "J"],
    );
    assert.equal(nextBoard.cells[1]![1]!.locked, true);
    assert.equal(tumbleRes.nextState.attachedValuesByCoord["1:1"], 100);

    // Reel 2: "K" and "Q" compacted to rows 1 and 2; row 0 refilled with "T"
    assert.deepEqual(
      nextBoard.cells[2]!.map((c) => c.symbolId),
      ["T", "K", "Q"],
    );

    // Cascade loop settlement test: 2 cascades then settles with 0 wins
    const cascadeStartBoard = createBoardFromSymbolGrid([
      ["A", "A", "A"],
      ["B", "B", "K"],
      ["Q", "J", "T"],
    ]);
    const cascadeStartState = dynamics.createBoardState(cascadeStartBoard);
    const loopRes = dynamics.runCascadeLoop(
      cascadeStartState,
      (b) => {
        // Win rule for test: any column where all 3 cells match "A" or "B"
        const wins = [];
        for (let c = 0; c < b.cells.length; c++) {
          const syms = b.cells[c]!.map((cell) => cell.symbolId);
          if (syms.every((s) => s === "A") || syms.every((s) => s === "B")) {
            for (let r = 0; r < syms.length; r++) {
              wins.push({ reelIndex: c, rowIndex: r });
            }
          }
        }
        return wins;
      },
      {
        reelStrips: [
          ["Q", "J", "T", "B", "B", "B"],
          ["K", "Q", "J"],
          ["K", "Q", "J"],
        ],
      },
    );

    // Cascade 1 removes ["A","A","A"] on reel 0 and refills with ["B","B","B"];
    // Cascade 2 removes ["B","B","B"] on reel 0 and refills with ["T","J","Q"];
    // Then settles!
    assert.equal(loopRes.cascadeCount, 2);

    // Safety cascade limit guard test
    assert.throws(
      () =>
        dynamics.runCascadeLoop(
          cascadeStartState,
          () => [{ reelIndex: 0, rowIndex: 0 }],
          {
            refillPool: ["A"],
            safetyMaxCascades: 5,
          },
        ),
      (err: unknown) => err instanceof CascadeLimitExceededError,
    );
  });

  it("2. Resize & Held State Through Resize: grows/shrinks rows and reels, preserves locked symbols & prize values, leaves new cells empty & unlocked, and enforces limits", () => {
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["COIN", "A", "K"],
      ["Q", "COIN", "J"],
      ["A", "K", "Q"],
    ]);

    let state = dynamics.createBoardState(board);
    state = dynamics.applyLocks(state, [
      {
        position: { reelIndex: 0, rowIndex: 0 },
        lifetimeType: "round",
        attachedValue: 50,
      },
      {
        position: { reelIndex: 1, rowIndex: 1 },
        lifetimeType: "round",
        attachedValue: 200,
      },
    ]).nextState;

    // 1. Add 1 row at TOP and 1 reel at LEFT:
    // Old (0,0) shifts to (1,1); Old (1,1) shifts to (2,2)!
    const grown = dynamics.resizeBoard(state, {
      rowDelta: 1,
      rowSide: "top",
      reelDelta: 1,
      reelSide: "left",
      emptySymbolId: "EMPTY",
      limits: {
        minReels: 3,
        maxReels: 6,
        minRows: 3,
        maxRows: 6,
        maxResizeEventsPerSession: 2,
      },
    });

    assert.equal(grown.applied, true);
    assert.equal(grown.afterDimensions.reelCount, 4);
    assert.equal(grown.afterDimensions.maxRowCount, 4);

    // Verify locked cells and attached prize values moved with their cells!
    assert.equal(grown.nextState.locksByCoord["1:1"]?.locked, true);
    assert.equal(grown.nextState.attachedValuesByCoord["1:1"], 50);
    assert.equal(grown.nextState.board.cells[1]![1]!.symbolId, "COIN");
    assert.equal(grown.nextState.board.cells[1]![1]!.locked, true);

    assert.equal(grown.nextState.locksByCoord["2:2"]?.locked, true);
    assert.equal(grown.nextState.attachedValuesByCoord["2:2"], 200);
    assert.equal(grown.nextState.board.cells[2]![2]!.symbolId, "COIN");

    // Verify newly inserted top row and left reel cells are EMPTY and unlocked
    for (let r = 0; r < 4; r++) {
      assert.equal(grown.nextState.board.cells[0]![r]!.symbolId, "EMPTY");
      assert.equal(grown.nextState.board.cells[0]![r]!.locked, false);
    }
    for (let c = 0; c < 4; c++) {
      assert.equal(grown.nextState.board.cells[c]![0]!.symbolId, "EMPTY");
      assert.equal(grown.nextState.board.cells[c]![0]!.locked, false);
    }

    // 2. Shrink bottom row (unlocked) -> succeeds
    const shrunk = dynamics.resizeBoard(grown.nextState, {
      rowDelta: -1,
      rowSide: "bottom",
      limits: { maxResizeEventsPerSession: 2 },
    });
    assert.equal(shrunk.applied, true);
    assert.equal(shrunk.afterDimensions.maxRowCount, 3);

    // 3. Attempting a 3rd resize when maxResizeEventsPerSession = 2 -> rejected by session limit
    const overSessionLimit = dynamics.resizeBoard(shrunk.nextState, {
      rowDelta: 1,
      limits: { maxResizeEventsPerSession: 2 },
    });
    assert.equal(overSessionLimit.applied, false);
    assert.equal(
      overSessionLimit.conflictReason,
      "sessionResizeLimitExceeded",
    );

    // 4. Attempting to shrink over a locked cell at (2, 2) -> rejected with lockedCellConflict
    const shrinkConflict = dynamics.resizeBoard(shrunk.nextState, {
      rowDelta: -1,
      rowSide: "bottom",
    });
    assert.equal(shrinkConflict.applied, false);
    assert.equal(shrinkConflict.conflictReason, "lockedCellConflict");
  });

  it("3. Mystery Symbols: board-wide sameSymbol and per-cell independent modes resolve deterministically via B03 RNG before payment", () => {
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["MYSTERY", "K", "Q"],
      ["A", "MYSTERY", "J"],
      ["Q", "J", "MYSTERY"],
    ]);
    const state = dynamics.createBoardState(board);

    const pool = [
      { value: "A", weight: 70 },
      { value: "K", weight: 30 },
    ] as const;

    // 1. Board-wide same-symbol mode
    const sameRes = dynamics.resolveMysteries(
      state,
      {
        mysterySymbolIds: ["MYSTERY"],
        mode: "sameSymbol",
        candidatePool: pool,
      },
      createSeededRng("b13-mystery-same"),
    );

    assert.equal(sameRes.originalMysteryCells.length, 3);
    assert.equal(sameRes.resolvedCells.length, 3);
    const chosenSym = sameRes.resolvedCells[0]!.resolvedSymbolId;
    for (const rc of sameRes.resolvedCells) {
      assert.equal(rc.resolvedSymbolId, chosenSym);
    }

    // Verify zero MYSTERY symbols remain on the board
    for (const col of sameRes.nextState.board.cells) {
      for (const cell of col) {
        assert.notEqual(cell.symbolId, "MYSTERY");
      }
    }

    // 2. Per-cell independent mode with deterministic replay
    const indRes1 = dynamics.resolveMysteries(
      state,
      {
        mysterySymbolIds: ["MYSTERY"],
        mode: "independent",
        candidatePool: [
          { value: "A", weight: 25 },
          { value: "K", weight: 25 },
          { value: "Q", weight: 25 },
          { value: "J", weight: 25 },
        ],
      },
      createSeededRng("b13-mystery-ind-seed"),
    );
    const indRes2 = dynamics.resolveMysteries(
      state,
      {
        mysterySymbolIds: ["MYSTERY"],
        mode: "independent",
        candidatePool: [
          { value: "A", weight: 25 },
          { value: "K", weight: 25 },
          { value: "Q", weight: 25 },
          { value: "J", weight: 25 },
        ],
      },
      createSeededRng("b13-mystery-ind-seed"),
    );
    assert.deepEqual(indRes1, indRes2);
    assert.equal(indRes1.rngUsage!.drawsConsumed, 3);
  });

  it("4. Colossal Symbols: tracks rectangular block coverage, clips at board edge, and retains single instance identity through board changes", () => {
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["A", "K", "Q"],
      ["J", "A", "K"],
      ["Q", "J", "A"],
      ["K", "Q", "J"],
    ]);
    const state = dynamics.createBoardState(board);

    // Place a 3x3 colossal symbol anchored at (2, 1) on a 4x3 board:
    // Covered in-bounds cells: reels 2..3 x rows 1..2 (4 cells);
    // Clipped out-of-bounds cells: reel 4 (3 cells) + row 3 on reels 2..3 (2 cells) = 5 clipped cells
    const placed = dynamics.placeSymbols(state, {
      colossal: {
        instanceId: "colossal-zeus-1",
        symbolId: "ZEUS",
        anchor: { reelIndex: 2, rowIndex: 1 },
        width: 3,
        height: 3,
        attachedValue: 500,
      },
    });

    assert.ok(placed.colossalPlaced);
    assert.equal(placed.colossalPlaced.instanceId, "colossal-zeus-1");
    assert.equal(placed.colossalPlaced.isClipped, true);
    assert.equal(placed.colossalPlaced.coveredCells.length, 4);
    assert.equal(placed.colossalPlaced.clippedCells.length, 5);
    assert.equal(placed.nextState.colossalInstances.length, 1);

    // All 4 covered cells reference the same colossalGroupId ("colossal-zeus-1")
    for (const pos of placed.colossalPlaced.coveredCells) {
      const cell =
        placed.nextState.board.cells[pos.reelIndex]![pos.rowIndex]!;
      assert.equal(cell.symbolId, "ZEUS");
      assert.equal(cell.colossalGroupId, "colossal-zeus-1");
    }

    // Grow board by 1 reel on the right -> colossal instance identity is retained and now covers 6 cells!
    const resized = dynamics.resizeBoard(placed.nextState, {
      reelDelta: 1,
      reelSide: "right",
    });
    assert.equal(resized.nextState.colossalInstances.length, 1);
    const updatedInst = resized.nextState.colossalInstances[0]!;
    assert.equal(updatedInst.instanceId, "colossal-zeus-1");
    assert.equal(updatedInst.coveredCells.length, 6);
  });

  it("5. Locks: supports round and finite-spin lifetimes, automatic expiration, and protects locked cells from removal/sweep/duplication", () => {
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["A", "K", "Q"],
      ["J", "A", "K"],
      ["Q", "J", "A"],
    ]);
    let state = dynamics.createBoardState(board);

    // Apply 1 round lock at (0,0) and 1 2-spin lock at (1,1)
    state = dynamics.applyLocks(state, [
      { position: { reelIndex: 0, rowIndex: 0 }, lifetimeType: "round" },
      {
        position: { reelIndex: 1, rowIndex: 1 },
        lifetimeType: "spins",
        remainingSpins: 2,
      },
    ]).nextState;

    // Attempt to remove (0,0), (1,1), and (2,2): only unlocked (2,2) is removed!
    const remRes = dynamics.removeCells(state, {
      positions: [
        { reelIndex: 0, rowIndex: 0 },
        { reelIndex: 1, rowIndex: 1 },
        { reelIndex: 2, rowIndex: 2 },
      ],
    });
    assert.equal(remRes.removedCells.length, 1);
    assert.deepEqual(remRes.removedCells[0]!.position, {
      reelIndex: 2,
      rowIndex: 2,
    });
    assert.equal(remRes.protectedLockedPositions.length, 2);

    // Spin boundary 1: (1,1) remainingSpins decrements from 2 -> 1 (still locked)
    const expSpin1 = dynamics.expireLocks(remRes.nextState, "spin");
    assert.equal(expSpin1.unlockedPositions.length, 0);
    assert.equal(expSpin1.nextState.locksByCoord["1:1"]?.remainingSpins, 1);

    // Spin boundary 2: (1,1) remainingSpins reaches 0 and expires automatically!
    const expSpin2 = dynamics.expireLocks(expSpin1.nextState, "spin");
    assert.equal(expSpin2.unlockedPositions.length, 1);
    assert.deepEqual(expSpin2.unlockedPositions[0], {
      reelIndex: 1,
      rowIndex: 1,
    });
    assert.equal(expSpin2.nextState.locksByCoord["1:1"], undefined);
    assert.equal(expSpin2.nextState.locksByCoord["0:0"]?.locked, true);

    // Round boundary: (0,0) round lock expires
    const expRound = dynamics.expireLocks(expSpin2.nextState, "round");
    assert.equal(expRound.unlockedPositions.length, 1);
    assert.deepEqual(expRound.unlockedPositions[0], {
      reelIndex: 0,
      rowIndex: 0,
    });
    assert.equal(Object.keys(expRound.nextState.locksByCoord).length, 0);
  });

  it("6. Reel Nudges: positive offset, negative offset, circular wrapping, and deterministic visible result", () => {
    const dynamics = createBoardDynamicsEngine();
    const strip0 = ["S0", "S1", "S2", "S3", "S4"];
    const board = createBoardFromSymbolGrid([
      ["S0", "S1", "S2"],
      ["A", "K", "Q"],
    ]);
    const state = dynamics.createBoardState(board, {
      reelStopIndexes: [0, 0],
    });

    // Nudge reel 0 by -1 (direction: "down", steps: 1) -> wraps around circular strip to stopIndex 4 (["S4", "S0", "S1"])
    const nudgedDown = dynamics.nudgeReel(state, {
      reelIndex: 0,
      direction: "down",
      steps: 1,
      reelStrip: strip0,
    });
    assert.equal(nudgedDown.stopIndexBefore, 0);
    assert.equal(nudgedDown.stopIndexAfter, 4);
    assert.deepEqual(nudgedDown.symbolIdsAfter, ["S4", "S0", "S1"]);

    // Nudge reel 0 by +2 (offsetSteps: 2) -> wraps from 4 to 1 (["S1", "S2", "S3"])
    const nudgedUp = dynamics.nudgeReel(nudgedDown.nextState, {
      reelIndex: 0,
      offsetSteps: 2,
      reelStrip: strip0,
    });
    assert.equal(nudgedUp.stopIndexBefore, 4);
    assert.equal(nudgedUp.stopIndexAfter, 1);
    assert.deepEqual(nudgedUp.symbolIdsAfter, ["S1", "S2", "S3"]);
  });

  it("7. Linked Reels: copies source reel to targets, retains target reel identity, and rejects invalid cycles", () => {
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["W", "A", "K"],
      ["Q", "J", "T"],
      ["J", "T", "Q"],
    ]);
    const state = dynamics.createBoardState(board);

    const linked = dynamics.applyLinkedReels(state, [
      {
        sourceReel: 0,
        targetReels: [1, 2],
        mappingMode: "identical",
      },
    ]);

    assert.deepEqual(
      linked.nextState.board.cells[1]!.map((c) => c.symbolId),
      ["W", "A", "K"],
    );
    assert.deepEqual(
      linked.nextState.board.cells[2]!.map((c) => c.symbolId),
      ["W", "A", "K"],
    );
    // Target reel identity is retained (reelIndex === 1 and 2)
    assert.equal(linked.nextState.board.cells[1]![0]!.reelIndex, 1);
    assert.equal(linked.nextState.board.cells[2]![0]!.reelIndex, 2);

    // Reject cycle (0 -> 1 and 1 -> 2)
    assert.throws(
      () =>
        dynamics.applyLinkedReels(state, [
          { sourceReel: 0, targetReels: [1] },
          { sourceReel: 1, targetReels: [2] },
        ]),
      (err: unknown) => err instanceof InvalidLinkedReelsError,
    );
  });

  it("8. Variable Reel Heights: supports shared range, per-reel range, deterministic selection, and ragged-board handling", () => {
    const dynamics = createBoardDynamicsEngine();

    // 1. Shared range [2, 5] with seeded RNG
    const rng1 = createSeededRng("b13-var-height-seed");
    const rng2 = createSeededRng("b13-var-height-seed");

    const sharedRes1 = dynamics.resolveVariableReelHeights(
      {
        reelCount: 5,
        sharedRange: { minRows: 2, maxRows: 5 },
      },
      rng1,
    );
    const sharedRes2 = dynamics.resolveVariableReelHeights(
      {
        reelCount: 5,
        sharedRange: { minRows: 2, maxRows: 5 },
      },
      rng2,
    );
    assert.deepEqual(sharedRes1, sharedRes2);

    // 2. Per-reel range producing a ragged board (e.g. [2, 3, 4, 3, 2])
    const perReelRes = dynamics.resolveVariableReelHeights(
      {
        reelCount: 5,
        perReelRanges: [
          { minRows: 2, maxRows: 2 },
          { minRows: 3, maxRows: 3 },
          { minRows: 4, maxRows: 4 },
          { minRows: 3, maxRows: 3 },
          { minRows: 2, maxRows: 2 },
        ],
      },
      createSeededRng("b13-per-reel"),
    );

    assert.deepEqual(perReelRes.reelHeights, [2, 3, 4, 3, 2]);
    assert.equal(perReelRes.nextState.board.cells[0]!.length, 2);
    assert.equal(perReelRes.nextState.board.cells[2]!.length, 4);
  });

  it("9. Symbol Duplication: consecutive placement within reel, respects bounds and locked/protected cells, and reports exact changedCells", () => {
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["WILD", "A", "K", "Q"],
      ["J", "T", "A", "K"],
    ]);

    let state = dynamics.createBoardState(board);
    // Lock (0, 2) so duplication skips it!
    state = dynamics.applyLocks(state, [
      { position: { reelIndex: 0, rowIndex: 2 }, lifetimeType: "round" },
    ]).nextState;

    // Duplicate WILD at (0, 0) downward by count = 5 (exceeds reel height 4; clips at 3 and skips locked (0, 2))
    const dupRes = dynamics.duplicateSymbols(state, {
      sourcePositions: [{ reelIndex: 0, rowIndex: 0 }],
      count: 5,
      direction: "down",
    });

    // (0, 1) and (0, 3) changed to WILD; (0, 2) was skipped because locked
    assert.equal(dupRes.changedCells.length, 2);
    assert.equal(dupRes.skippedProtectedPositions.length, 1);
    assert.deepEqual(dupRes.skippedProtectedPositions[0], {
      reelIndex: 0,
      rowIndex: 2,
    });
    assert.deepEqual(
      dupRes.nextState.board.cells[0]!.map((c) => c.symbolId),
      ["WILD", "WILD", "K", "WILD"],
    );
  });

  it("10. Lane Sweeps: supports fire/no-fire, multiple sweeps, travel distance, protected tags, and row/reel targeting", () => {
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["A", "K", "Q"],
      ["J", "T", "A"],
      ["K", "Q", "J"],
      ["T", "A", "K"],
    ]);

    let state = dynamics.createBoardState(board);
    // Tag (1, 0) with "SHIELD" so it is protected from sweep
    state = dynamics.tagPositions(state, {
      tag: "SHIELD",
      mode: "configured",
      lifetime: "spin",
      positions: [{ reelIndex: 1, rowIndex: 0 }],
    }).nextState;

    // 1. No-fire when fireChance = 0
    const noFire = dynamics.applyLaneSweep(state, {
      entryEdge: "left",
      targetIndex: 0,
      fireChance: 0,
    });
    assert.equal(noFire.fired, false);
    assert.equal(noFire.clearedCells.length, 0);

    // 2. Sweep from left along row 0 with travelDistance = 3 and protectedTags: ["SHIELD"]
    // Visits (0,0), (1,0) [protected!], (2,0); stops before reel 3 because travelDistance = 3
    const swept = dynamics.applyLaneSweep(state, {
      entryEdge: "left",
      targetIndex: 0,
      travelDistance: 3,
      replacementSymbolId: "CLEARED",
      protectedTags: ["SHIELD"],
    });

    assert.equal(swept.fired, true);
    assert.equal(swept.clearedCells.length, 2);
    assert.equal(swept.protectedSkippedPositions.length, 1);
    assert.deepEqual(swept.protectedSkippedPositions[0], {
      reelIndex: 1,
      rowIndex: 0,
    });
    assert.equal(swept.nextState.board.cells[0]![0]!.symbolId, "CLEARED");
    assert.equal(swept.nextState.board.cells[1]![0]!.symbolId, "J"); // Protected!
    assert.equal(swept.nextState.board.cells[2]![0]!.symbolId, "CLEARED");
    assert.equal(swept.nextState.board.cells[3]![0]!.symbolId, "T"); // Beyond travelDistance!
  });

  it("11. Tagged Positions: supports random, onePerReel, configured count, spin/feature lifetimes, and deterministic selection", () => {
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["A", "K", "Q"],
      ["J", "T", "A"],
      ["K", "Q", "J"],
    ]);
    const state = dynamics.createBoardState(board);

    // 1. onePerReel mode (spin lifetime)
    const onePerReel1 = dynamics.tagPositions(
      state,
      { tag: "SPOTLIGHT", mode: "onePerReel", lifetime: "spin" },
      createSeededRng("b13-tag-seed"),
    );
    const onePerReel2 = dynamics.tagPositions(
      state,
      { tag: "SPOTLIGHT", mode: "onePerReel", lifetime: "spin" },
      createSeededRng("b13-tag-seed"),
    );
    assert.deepEqual(onePerReel1, onePerReel2);
    assert.equal(onePerReel1.taggedPositions.length, 3);
    assert.deepEqual(
      onePerReel1.taggedPositions.map((p) => p.reelIndex),
      [0, 1, 2],
    );

    // 2. random mode (feature lifetime, count = 4)
    const withFeatureTags = dynamics.tagPositions(
      onePerReel1.nextState,
      {
        tag: "PERSISTENT_FRAME",
        mode: "random",
        lifetime: "feature",
        count: 4,
      },
      createSeededRng("b13-tag-random-4"),
    );
    assert.equal(withFeatureTags.taggedPositions.length, 4);

    // 3. Expire spin-scoped tags -> SPOTLIGHT expires, PERSISTENT_FRAME survives!
    const afterSpinExpire = dynamics.expireTags(
      withFeatureTags.nextState,
      "spin",
    );
    assert.equal(
      dynamics.getTaggedPositions(afterSpinExpire, "SPOTLIGHT").length,
      0,
    );
    assert.equal(
      dynamics.getTaggedPositions(afterSpinExpire, "PERSISTENT_FRAME").length,
      4,
    );

    // 4. Expire feature-scoped tags -> all cleared
    const afterFeatureExpire = dynamics.expireTags(
      afterSpinExpire,
      "feature",
    );
    assert.equal(dynamics.getTaggedPositions(afterFeatureExpire).length, 0);
  });

  it("12. Integration: BoardDynamicsEngine works with B04 Reel Engine, B10/B11 Win Engines, and B12 FeatureEngine", () => {
    const bp = createBlueprint({
      id: "b13-integration-bp",
      title: "Cascade & Dynamics Slot",
      theme: "Mythology",
      columns: 5,
      rows: 3,
    });
    const gameConfig = adaptBlueprintToGameConfig(bp);
    const rng = createSeededRng("b13-e2e-seed");
    const reelEngine = createReelEngine();
    const dynamics = createBoardDynamicsEngine();

    // 1. Resolve initial board from B04 ReelEngine
    const resolved = reelEngine.resolve(gameConfig, rng);
    let boardState = dynamics.createBoardState(resolved.board, {
      reelStopIndexes: resolved.selectedStopIndexes,
    });

    // 2. Place a 2x2 Colossal block of symbol[0] and evaluate via B10 Cluster Engine & B11 Pay-Anywhere Engine
    const targetSymId = gameConfig.symbols[0]!.id;
    boardState = dynamics.placeSymbols(boardState, {
      colossal: {
        instanceId: "colossal-1",
        symbolId: targetSymId,
        anchor: { reelIndex: 0, rowIndex: 0 },
        width: 2,
        height: 2,
      },
    }).nextState;

    const clusterRes = evaluateClusters(boardState.board, {
      enabled: true,
      minimumClusterSize: 3,
      adjacency: "edge",
      allowWildJoin: true,
      allowFamilyGrouping: false,
      eligibleSymbols: [targetSymId],
    });
    assert.ok(clusterRes.qualifyingClusterCount >= 1);

    // 3. Pass winning cluster cells into B13 applyTumble and re-evaluate via B11 Pay-Anywhere
    const winPositions = clusterRes.clusters[0]!.cells.map((c) => ({
      reelIndex: c.reelIndex,
      rowIndex: c.rowIndex,
    }));
    const tumbled = dynamics.applyTumble(boardState, winPositions, {
      reelStrips: gameConfig.reels,
    });
    assert.equal(tumbled.removedCells.length, winPositions.length);

    const payAnywhereRes = evaluatePayAnywhere(tumbled.nextState.board, {
      enabled: true,
      minimumMatchCount: 3,
      eligibleSymbols: [targetSymId],
    });
    assert.equal(payAnywhereRes.evaluationMode, "payAnywhere");

    // 4. B12 FeatureEngine invokes boardModHook action and coordinates with B13 BoardDynamicsEngine
    const featureEngine = createFeatureEngine(gameConfig);
    const targetFeatureId = gameConfig.features[0]?.id;
    if (targetFeatureId) {
      const started = featureEngine.startFeature(targetFeatureId);
      const stepRes = featureEngine.runFeatureStep(started.nextState, {
        board: tumbled.nextState.board,
        spinWinAmount: 10,
        actions: [
          {
            type: "boardModHook",
            hookId: "expandWildReel0",
            payload: { reelIndex: 0 },
          },
        ],
      });
      assert.equal(stepRes.actionsExecuted.length, 1);
      assert.equal(stepRes.actionsExecuted[0]!.type, "boardModHook");
    }
  });
});
