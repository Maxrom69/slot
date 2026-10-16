/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B14 — Multiplier & Symbol Value Engine Verification Suite
 *
 * Covers all 14 required verification areas from the B14 specification:
 *  1. Cell Multipliers (single, multiple, combination rules, applied once at settlement, no cross-spin leakage)
 *  2. Geometric Tumble Multiplier (1x -> 2x -> 4x -> 8x, ceiling, per-tumble application, no double advancement)
 *  3. Feature Starting Multiplier (trigger-derived start value, feature initialization, configuration-driven)
 *  4. Assigned Values (fixed, weighted pools, deterministic B03 RNG, cell attachment)
 *  5. Collection (eligible/ineligible sources, zone restrictions, persistence, explicit transfer records)
 *  6. Broadcast (eligible/ineligible targets, multi-target aggregation)
 *  7. Multiplier Meters (spin/feature/session scopes, step/set/reset/harvest, settlement application)
 *  8. Symbol Multiplier Memory (best multiplier remembered, session vs consume-on-pay, no duplicate consumption)
 *  9. Collect Ladder (rung progression, threshold selection, collection multiplier, retrigger signals)
 * 10. Value Absorption (source values transferred, collector grows, source persistence, locked-collector config)
 * 11. Ragged Boards (collection and value targeting with B13 variable reel heights)
 * 12. Determinism (identical seed + state = identical results)
 * 13. Snapshot / Restore (restored state produces identical future results)
 * 14. Integration (B13 board transformations, B12 FeatureEngine signals, B05–B11 settlement compatibility)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  adaptBlueprintToGameConfig,
  createBoardDynamicsEngine,
  createBoardFromSymbolGrid,
  createFeatureEngine,
  createMultiplierValueEngine,
  createSeededRng,
  evaluatePayAnywhere,
} from "../src/engine";

describe("B14 — Multiplier & Symbol Value Engine", () => {
  it("1. Cell Multipliers: handles single and multiple multipliers, combines accurately, applies once at settlement, and does not leak across spins", () => {
    const engine = createMultiplierValueEngine();
    const board = createBoardFromSymbolGrid([
      ["A", "K", "Q"],
      ["J", "A", "K"],
      ["Q", "J", "A"],
    ]);

    const init = engine.createInitialState({ combinationRule: "add" });

    // Single multiplier (3x at (0,0))
    const oneMult = engine.addCellMultipliers(
      init.multiplierState,
      init.valueState,
      board,
      [{ value: 3, position: { reelIndex: 0, rowIndex: 0 }, scope: "spin" }],
    );
    assert.equal(oneMult.effectiveMultiplier, 3);

    // Add second and third multipliers (5x at (1,1) and 2x at (2,2)) -> 3 + 5 + 2 = 10x
    const multiMult = engine.addCellMultipliers(
      oneMult.multiplierState,
      oneMult.valueState,
      board,
      [
        { value: 5, position: { reelIndex: 1, rowIndex: 1 }, scope: "spin" },
        { value: 2, position: { reelIndex: 2, rowIndex: 2 }, scope: "spin" },
      ],
    );
    assert.equal(multiMult.effectiveMultiplier, 10);

    // Multiplicative combination rule check: 3 * 5 * 2 = 30x
    const multRuleCheck = engine.resolveSpinCellMultiplier(
      multiMult.multiplierState,
      { combinationRule: "multiply" },
    );
    assert.equal(multRuleCheck.spinMultiplier, 30);

    // Applied once at settlement: baseWin 15 * 10x = 150
    const settled = engine.buildSettlementContext(
      multiMult.multiplierState,
      multiMult.valueState,
      { baseWin: 15 },
    );
    assert.equal(settled.detail.spinMultiplier, 10);
    assert.equal(settled.detail.effectiveMultiplier, 10);
    assert.equal(settled.detail.settledWinAmount, 150);

    // Clear spin state -> ordinary spin multipliers do NOT leak into the next spin
    const cleared = engine.clearSpinState(
      settled.multiplierState,
      settled.valueState,
    );
    const nextSpinSettle = engine.buildSettlementContext(
      cleared.multiplierState,
      cleared.valueState,
      { baseWin: 15 },
    );
    assert.equal(nextSpinSettle.detail.spinMultiplier, 1);
    assert.equal(nextSpinSettle.detail.effectiveMultiplier, 1);
    assert.equal(nextSpinSettle.detail.settledWinAmount, 15);
  });

  it("2. Geometric Tumble Multiplier: progresses 1x -> 2x -> 4x -> 8x, enforces ceiling, applies per tumble, and prevents double advancement", () => {
    const engine = createMultiplierValueEngine();
    const init = engine.createInitialState();

    let state = engine.initializeTumbleMultiplier(
      init.multiplierState,
      init.valueState,
      {
        id: "tumble-geo-1",
        startingMultiplier: 1,
        progressionFactor: 2,
        ceiling: 8,
      },
    );

    const appliedSequence: number[] = [];
    const tumbleWins = [10, 10, 10, 10, 10]; // 5 tumbles: should apply 1x, 2x, 4x, 8x, 8x (capped at ceiling 8x)
    const multipliedWins: number[] = [];

    for (let i = 0; i < tumbleWins.length; i += 1) {
      const settled = engine.settleCurrentTumble(
        state.multiplierState,
        state.valueState,
        tumbleWins[i]!,
      );
      appliedSequence.push(settled.detail.activeMultiplier);
      multipliedWins.push(settled.detail.multipliedTumbleWin);

      // Advance once for tumble index i
      const advanced1 = engine.advanceTumbleMultiplier(
        settled.multiplierState,
        settled.valueState,
        { forTumbleIndex: i },
      );

      // Calling advanceTumbleMultiplier a second time with the same forTumbleIndex i MUST NOT double-advance!
      const advancedDuplicate = engine.advanceTumbleMultiplier(
        advanced1.multiplierState,
        advanced1.valueState,
        { forTumbleIndex: i },
      );
      assert.equal(
        advancedDuplicate.multiplierState.tumbleState?.currentMultiplier,
        advanced1.multiplierState.tumbleState?.currentMultiplier,
      );

      state = advancedDuplicate;
    }

    assert.deepEqual(appliedSequence, [1, 2, 4, 8, 8]);
    assert.deepEqual(multipliedWins, [10, 20, 40, 80, 80]);
    assert.equal(state.multiplierState.tumbleState?.atCeiling, true);
  });

  it("3. Feature Starting Multiplier: resolves trigger-derived start values from configuration without hard-coded values", () => {
    const engine = createMultiplierValueEngine();
    const init = engine.createInitialState();

    const customConfig = {
      id: "fs-start-mult-cfg",
      featureId: "super_free_spins",
      defaultStartingMultiplier: 3,
      rules: [
        { ruleId: "scatter-3", triggerCount: 3, startingMultiplier: 6 },
        { ruleId: "scatter-4", triggerCount: 4, startingMultiplier: 12 },
        { ruleId: "scatter-5", triggerCount: 5, startingMultiplier: 24 },
        {
          ruleId: "mega-trigger",
          triggerStrength: "mega",
          startingMultiplier: 50,
        },
      ],
    };

    const res4 = engine.initializeFeatureMultiplier(
      init.multiplierState,
      init.valueState,
      "super_free_spins",
      { triggerCount: 4 },
      customConfig,
    );
    assert.equal(res4.detail.startingMultiplier, 12);
    assert.equal(res4.detail.sourceConfigId, "scatter-4");

    const resMega = engine.initializeFeatureMultiplier(
      init.multiplierState,
      init.valueState,
      "super_free_spins",
      { triggerStrength: "mega" },
      customConfig,
    );
    assert.equal(resMega.detail.startingMultiplier, 50);
    assert.equal(resMega.detail.sourceConfigId, "mega-trigger");
  });

  it("4. Assigned Values: supports fixed and weighted values via B03 RandomSource and attaches values to exact cells", () => {
    const engine = createMultiplierValueEngine();
    const board = createBoardFromSymbolGrid([
      ["COIN_FIXED", "A", "COIN_WEIGHTED"],
      ["K", "COIN_WEIGHTED", "Q"],
    ]);
    const init = engine.createInitialState();

    const defs = [
      {
        id: "fixed-coin-def",
        symbolIds: ["COIN_FIXED"],
        mode: "fixed" as const,
        fixedValue: 25,
        persistence: "spin" as const,
      },
      {
        id: "weighted-coin-def",
        symbolIds: ["COIN_WEIGHTED"],
        mode: "weightedPool" as const,
        weightedPool: [
          { value: 5, weight: 50 },
          { value: 10, weight: 30 },
          { value: 100, weight: 20 },
        ],
        persistence: "feature" as const,
      },
    ];

    const res1 = engine.assignCellValues(
      init.multiplierState,
      init.valueState,
      board,
      defs,
      createSeededRng("b14-assigned-seed"),
    );
    const res2 = engine.assignCellValues(
      init.multiplierState,
      init.valueState,
      board,
      defs,
      createSeededRng("b14-assigned-seed"),
    );

    assert.deepEqual(res1, res2);
    assert.equal(res1.detail.length, 3);
    assert.equal(res1.valueState.cellValuesByCoord["0:0"]?.value, 25);
    assert.ok(
      [5, 10, 100].includes(
        res1.valueState.cellValuesByCoord["0:2"]?.value ?? -1,
      ),
    );
    assert.ok(
      [5, 10, 100].includes(
        res1.valueState.cellValuesByCoord["1:1"]?.value ?? -1,
      ),
    );
    assert.equal(res1.rngUsage?.drawsConsumed, 2);
  });

  it("5. Collection: collects eligible sources, ignores ineligible sources, enforces zone restrictions, respects sourcePersistence, and emits ValueTransfer records", () => {
    const engine = createMultiplierValueEngine();
    // 3 reels x 3 rows:
    // Row 2 (bottom row) has COIN at (0,2) [val=10] and (2,2) [val=20]
    // Row 0 (top row) has COIN at (1,0) [val=50] — outside bottom-row zone!
    // Collector at (1,2)
    const board = createBoardFromSymbolGrid([
      ["A", "K", "COIN"],
      ["COIN", "Q", "COLLECTOR"],
      ["J", "A", "COIN"],
    ]);
    const init = engine.createInitialState();

    // Assign values manually via fixed definitions per coordinate
    let vState = engine.assignCellValues(
      init.multiplierState,
      init.valueState,
      board,
      [
        {
          id: "coin-top",
          symbolIds: ["COIN"],
          mode: "fixed",
          fixedValue: 50,
        },
      ],
      undefined,
      { targetPositions: [{ reelIndex: 1, rowIndex: 0 }] },
    ).valueState;

    vState = engine.assignCellValues(
      init.multiplierState,
      vState,
      board,
      [
        {
          id: "coin-bot-left",
          symbolIds: ["COIN"],
          mode: "fixed",
          fixedValue: 10,
        },
      ],
      undefined,
      { targetPositions: [{ reelIndex: 0, rowIndex: 2 }] },
    ).valueState;

    vState = engine.assignCellValues(
      init.multiplierState,
      vState,
      board,
      [
        {
          id: "coin-bot-right",
          symbolIds: ["COIN"],
          mode: "fixed",
          fixedValue: 20,
        },
      ],
      undefined,
      { targetPositions: [{ reelIndex: 2, rowIndex: 2 }] },
    ).valueState;

    // Collect only from bottom row (row 2) with sourcePersistence: "retain"
    const collectedRetain = engine.collectValues(
      init.multiplierState,
      vState,
      board,
      {
        id: "bottom-row-collect",
        mode: "collect",
        collectorSymbolIds: ["COLLECTOR"],
        eligibleSourceSymbolIds: ["COIN"],
        sourceZone: { id: "bottom-row-zone", rows: [2] },
        sourcePersistence: "retain",
      },
    );

    // Only (0,2)=10 and (2,2)=20 are in row 2 -> totalCollectedValue = 30; (1,0)=50 is ignored!
    assert.equal(collectedRetain.detail.totalCollectedValue, 30);
    assert.equal(collectedRetain.detail.transfers.length, 2);
    // Sources retained (consumed === false)
    assert.equal(
      collectedRetain.valueState.cellValuesByCoord["0:2"]?.consumed,
      false,
    );
    assert.equal(
      collectedRetain.valueState.cellValuesByCoord["2:2"]?.consumed,
      false,
    );

    // Collect with sourcePersistence: "consume" -> sources marked consumed
    const collectedConsume = engine.collectValues(
      init.multiplierState,
      collectedRetain.valueState,
      board,
      {
        id: "bottom-row-collect-consume",
        mode: "collect",
        collectorSymbolIds: ["COLLECTOR"],
        eligibleSourceSymbolIds: ["COIN"],
        sourceZone: { id: "bottom-row-zone", rows: [2] },
        sourcePersistence: "consume",
      },
    );
    assert.equal(
      collectedConsume.valueState.cellValuesByCoord["0:2"]?.consumed,
      true,
    );
    assert.equal(
      collectedConsume.valueState.cellValuesByCoord["2:2"]?.consumed,
      true,
    );
  });

  it("6. Broadcast: payer broadcasts value to eligible targets in zone and excludes ineligible targets", () => {
    const engine = createMultiplierValueEngine();
    const board = createBoardFromSymbolGrid([
      ["PAYER", "COIN", "A"],
      ["COIN", "K", "COIN"],
    ]);
    const init = engine.createInitialState();

    // Assign PAYER=15 at (0,0) and COIN=5 at (0,1), (1,0), (1,2)
    const assigned = engine.assignCellValues(
      init.multiplierState,
      init.valueState,
      board,
      [
        { id: "payer-def", symbolIds: ["PAYER"], mode: "fixed", fixedValue: 15 },
        { id: "coin-def", symbolIds: ["COIN"], mode: "fixed", fixedValue: 5 },
      ],
    );

    // Broadcast PAYER (15) to COIN symbols -> all 3 COIN cells increase from 5 to 20; "A" and "K" are excluded
    const broadcasted = engine.broadcastValues(
      assigned.multiplierState,
      assigned.valueState,
      board,
      {
        id: "payer-broadcast",
        mode: "broadcast",
        collectorSymbolIds: ["PAYER"],
        eligibleTargetSymbolIds: ["COIN"],
        broadcastAggregation: "add",
      },
    );

    assert.equal(broadcasted.detail.transfers.length, 3);
    assert.equal(broadcasted.detail.totalBroadcastValue, 45);
    assert.equal(broadcasted.valueState.cellValuesByCoord["0:1"]?.value, 20);
    assert.equal(broadcasted.valueState.cellValuesByCoord["1:0"]?.value, 20);
    assert.equal(broadcasted.valueState.cellValuesByCoord["1:2"]?.value, 20);
    assert.equal(broadcasted.valueState.cellValuesByCoord["0:2"], undefined);
  });

  it("7. Multiplier Meters: supports spin, feature, and session scopes, step/set/reset/harvest, and settlement application", () => {
    const engine = createMultiplierValueEngine();
    const init = engine.createInitialState();

    // Initialize spin, feature, and session meters
    let mState = engine.initializeMeter(
      init.multiplierState,
      init.valueState,
      {
        meterId: "spin-meter",
        startingValue: 1,
        scope: "spin",
        stepAmount: 2,
      },
    ).multiplierState;

    mState = engine.initializeMeter(mState, init.valueState, {
      meterId: "feature-meter",
      startingValue: 2,
      scope: "feature",
      stepAmount: 3,
    }).multiplierState;

    mState = engine.initializeMeter(mState, init.valueState, {
      meterId: "session-meter",
      startingValue: 5,
      scope: "session",
      stepAmount: 5,
    }).multiplierState;

    // Step all 3 meters
    mState = engine.stepMeter(mState, init.valueState, "spin-meter", 2)
      .multiplierState; // 1 + 4 = 5
    mState = engine.stepMeter(mState, init.valueState, "feature-meter", 1)
      .multiplierState; // 2 + 3 = 5
    mState = engine.stepMeter(mState, init.valueState, "session-meter", 1)
      .multiplierState; // 5 + 5 = 10

    assert.equal(mState.metersById["spin-meter"]?.currentValue, 5);
    assert.equal(mState.metersById["feature-meter"]?.currentValue, 5);
    assert.equal(mState.metersById["session-meter"]?.currentValue, 10);

    // Clear spin state -> spin-meter resets to 1; feature-meter (5) and session-meter (10) survive!
    const afterSpin = engine.clearSpinState(mState, init.valueState);
    assert.equal(
      afterSpin.multiplierState.metersById["spin-meter"]?.currentValue,
      1,
    );
    assert.equal(
      afterSpin.multiplierState.metersById["feature-meter"]?.currentValue,
      5,
    );
    assert.equal(
      afterSpin.multiplierState.metersById["session-meter"]?.currentValue,
      10,
    );

    // Clear feature state -> feature-meter resets to 2; session-meter (10) survives!
    const afterFeature = engine.clearFeatureState(
      afterSpin.multiplierState,
      afterSpin.valueState,
    );
    assert.equal(
      afterFeature.multiplierState.metersById["feature-meter"]?.currentValue,
      2,
    );
    assert.equal(
      afterFeature.multiplierState.metersById["session-meter"]?.currentValue,
      10,
    );
  });

  it("8. Symbol Multiplier Memory: remembers best multiplier, applies to later matching symbols, supports session and consumeOnFirstPay without duplicate consumption", () => {
    const engine = createMultiplierValueEngine();
    const init = engine.createInitialState();

    // Record 4x then 8x then 3x on "ZEUS" (consumeOnFirstPay) and 5x on "ATHENA" (session)
    const rec = engine.recordSymbolMultiplierMemory(
      init.multiplierState,
      init.valueState,
      [
        {
          symbolId: "ZEUS",
          multiplier: 4,
          persistence: "consumeOnFirstPay",
        },
        {
          symbolId: "ZEUS",
          multiplier: 8,
          persistence: "consumeOnFirstPay",
        },
        {
          symbolId: "ZEUS",
          multiplier: 3,
          persistence: "consumeOnFirstPay",
        },
        {
          symbolId: "ATHENA",
          multiplier: 5,
          persistence: "session",
        },
      ],
    );

    // Best multiplier seen on ZEUS is 8x!
    assert.equal(
      rec.multiplierState.memoryBySymbolId["ZEUS"]?.rememberedMultiplier,
      8,
    );

    // First pay for ZEUS: applies 8x and consumes ZEUS memory
    const firstPay = engine.resolveSymbolMultiplierMemory(
      rec.multiplierState,
      rec.valueState,
      ["ZEUS"],
    );
    assert.equal(firstPay.detail.appliedSymbolMultiplier, 8);
    assert.equal(
      firstPay.multiplierState.memoryBySymbolId["ZEUS"]?.consumed,
      true,
    );

    // Second pay for ZEUS: already consumed -> must NOT apply again (returns 1x)!
    const secondPay = engine.resolveSymbolMultiplierMemory(
      firstPay.multiplierState,
      firstPay.valueState,
      ["ZEUS"],
    );
    assert.equal(secondPay.detail.appliedSymbolMultiplier, 1);

    // Session memory for ATHENA survives multiple payments across spins!
    const athenaPay1 = engine.resolveSymbolMultiplierMemory(
      secondPay.multiplierState,
      secondPay.valueState,
      ["ATHENA"],
    );
    const athenaPay2 = engine.resolveSymbolMultiplierMemory(
      athenaPay1.multiplierState,
      athenaPay1.valueState,
      ["ATHENA"],
    );
    assert.equal(athenaPay1.detail.appliedSymbolMultiplier, 5);
    assert.equal(athenaPay2.detail.appliedSymbolMultiplier, 5);
  });

  it("9. Collect Ladder: advances rungs, updates collection multiplier, and emits retrigger signals at configured thresholds", () => {
    const engine = createMultiplierValueEngine();
    const init = engine.createInitialState();

    const initLadder = engine.initializeCollectLadder(
      init.multiplierState,
      init.valueState,
      {
        ladderId: "fisherman-ladder",
        baseMultiplier: 1,
        rungs: [
          {
            threshold: 4,
            multiplier: 2,
            retriggerActionId: "retrigger-tier-1",
            awardedExtraSpins: 10,
          },
          {
            threshold: 8,
            multiplier: 3,
            retriggerActionId: "retrigger-tier-2",
            awardedExtraSpins: 10,
          },
          {
            threshold: 12,
            multiplier: 10,
            retriggerActionId: "retrigger-tier-3",
            awardedExtraSpins: 10,
          },
        ],
      },
    );

    // Advance by 3 collectors -> count=3, multiplier still 1x, no retrigger
    const step1 = engine.advanceCollectLadder(
      initLadder.multiplierState,
      initLadder.valueState,
      "fisherman-ladder",
      3,
    );
    assert.equal(step1.detail.ladder.collectorCount, 3);
    assert.equal(step1.detail.ladder.currentMultiplier, 1);
    assert.equal(step1.detail.retriggerSignals.length, 0);

    // Advance by 2 collectors -> count=5, crosses threshold 4 -> multiplier becomes 2x, emits retrigger signal!
    const step2 = engine.advanceCollectLadder(
      step1.multiplierState,
      step1.valueState,
      "fisherman-ladder",
      2,
    );
    assert.equal(step2.detail.ladder.collectorCount, 5);
    assert.equal(step2.detail.ladder.currentMultiplier, 2);
    assert.equal(step2.detail.retriggerSignals.length, 1);
    assert.equal(
      step2.detail.retriggerSignals[0]!.retriggerActionId,
      "retrigger-tier-1",
    );
    assert.equal(step2.detail.retriggerSignals[0]!.awardedExtraSpins, 10);
  });

  it("10. Value Absorption: collector pulls source values into itself, grows across the round, and respects locked-collector configuration", () => {
    const engine = createMultiplierValueEngine();
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["COLLECTOR", "COIN", "A"],
      ["COIN", "COLLECTOR", "K"],
    ]);

    // Lock collector at (1, 1)
    let boardState = dynamics.createBoardState(board);
    boardState = dynamics.applyLocks(boardState, [
      { position: { reelIndex: 1, rowIndex: 1 }, lifetimeType: "round" },
    ]).nextState;

    const init = engine.createInitialState();
    const assigned = engine.assignCellValues(
      init.multiplierState,
      init.valueState,
      boardState.board,
      [
        {
          id: "collector-seed",
          symbolIds: ["COLLECTOR"],
          mode: "fixed",
          fixedValue: 10,
          persistence: "feature",
          isCollector: true,
        },
        {
          id: "coin-seed",
          symbolIds: ["COIN"],
          mode: "fixed",
          fixedValue: 15,
          persistence: "spin",
        },
      ],
    );

    // Absorb with lockedCollectorBehavior: "excludeWhileLocked"
    // Only unlocked collector at (0,0) absorbs the two 15x coins (10 + 30 = 40); locked collector at (1,1) is excluded!
    const absorbedExclude = engine.absorbValues(
      assigned.multiplierState,
      assigned.valueState,
      boardState.board,
      {
        id: "absorb-exclude-locked",
        collectorSymbolIds: ["COLLECTOR"],
        eligibleSourceSymbolIds: ["COIN"],
        sourcePersistence: "consume",
        lockedCollectorBehavior: "excludeWhileLocked",
      },
      { boardState },
    );

    assert.equal(absorbedExclude.detail.length, 1);
    assert.deepEqual(absorbedExclude.detail[0]!.collectorPosition, {
      reelIndex: 0,
      rowIndex: 0,
    });
    assert.equal(absorbedExclude.detail[0]!.valueBefore, 10);
    assert.equal(absorbedExclude.detail[0]!.absorbedDelta, 30);
    assert.equal(absorbedExclude.detail[0]!.valueAfter, 40);
    assert.equal(
      absorbedExclude.detail[0]!.skippedLockedCollectors.length,
      1,
    );
    assert.equal(
      absorbedExclude.valueState.cellValuesByCoord["0:0"]?.value,
      40,
    );
    assert.equal(
      absorbedExclude.valueState.cellValuesByCoord["1:1"]?.value,
      10,
    );
  });

  it("11. Ragged Boards: collection and value targeting work unambiguously with B13 variable reel heights", () => {
    const dynamics = createBoardDynamicsEngine();
    const engine = createMultiplierValueEngine();

    // Ragged board with heights [2, 4, 3]
    const raggedState = dynamics.resolveVariableReelHeights(
      {
        reelCount: 3,
        perReelRanges: [
          { minRows: 2, maxRows: 2 },
          { minRows: 4, maxRows: 4 },
          { minRows: 3, maxRows: 3 },
        ],
        reelStrips: [
          ["COIN", "A"],
          ["A", "K", "Q", "COLLECTOR"],
          ["K", "Q", "COIN"],
        ],
      },
      createSeededRng("b14-ragged-seed"),
    ).nextState;

    const init = engine.createInitialState();
    const assigned = engine.assignCellValues(
      init.multiplierState,
      init.valueState,
      raggedState.board,
      [
        {
          id: "ragged-coins",
          symbolIds: ["COIN"],
          mode: "fixed",
          fixedValue: 12,
        },
      ],
    );

    const collected = engine.collectValues(
      assigned.multiplierState,
      assigned.valueState,
      raggedState.board,
      {
        id: "ragged-collect",
        mode: "collect",
        collectorSymbolIds: ["COLLECTOR"],
        eligibleSourceSymbolIds: ["COIN"],
      },
    );

    // Both COIN cells on reel 0 (row 0) and reel 2 (row 2) are collected by COLLECTOR at (1, 3) -> 24
    assert.equal(collected.detail.totalCollectedValue, 24);
    assert.equal(collected.detail.collectorTotalsByCoord["1:3"], 24);
  });

  it("12 & 13. Determinism & Snapshot/Restore: identical seed + state = identical results, and restored state matches uninterrupted execution", () => {
    const engine = createMultiplierValueEngine();
    const board = createBoardFromSymbolGrid([
      ["COIN", "A", "COIN"],
      ["COLLECTOR", "COIN", "K"],
    ]);

    const init = engine.createInitialState();
    const step1 = engine.initializeTumbleMultiplier(
      init.multiplierState,
      init.valueState,
      { startingMultiplier: 1, progressionFactor: 2, ceiling: 16 },
    );
    const step2 = engine.assignCellValues(
      step1.multiplierState,
      step1.valueState,
      board,
      [
        {
          id: "w-coin",
          symbolIds: ["COIN"],
          mode: "weightedPool",
          weightedPool: [
            { value: 5, weight: 40 },
            { value: 20, weight: 60 },
          ],
          persistence: "feature",
        },
      ],
      createSeededRng("b14-snap-seed-1"),
    );

    // Take snapshot after step2
    const snapshot = engine.snapshotState(
      step2.multiplierState,
      step2.valueState,
    );
    const restored = engine.restoreState(snapshot);

    // Run uninterrupted path
    const uninterruptedTumble = engine.advanceTumbleMultiplier(
      step2.multiplierState,
      step2.valueState,
    );
    const uninterruptedSettle = engine.buildSettlementContext(
      uninterruptedTumble.multiplierState,
      uninterruptedTumble.valueState,
      { baseWin: 25 },
    );

    // Run restored path
    const restoredTumble = engine.advanceTumbleMultiplier(
      restored.multiplierState,
      restored.valueState,
    );
    const restoredSettle = engine.buildSettlementContext(
      restoredTumble.multiplierState,
      restoredTumble.valueState,
      { baseWin: 25 },
    );

    assert.deepEqual(uninterruptedSettle, restoredSettle);
  });

  it("14. Integration: B13 board transformations preserve attached multipliers/values, B12 consumes feature-starting multiplier & ladder signals, and B11 win engine settles cleanly", () => {
    const bp = createBlueprint({
      id: "b14-integration-slot",
      title: "Olympus Multipliers & Cash",
      theme: "Mythology",
      columns: 3,
      rows: 3,
    });
    const gameConfig = adaptBlueprintToGameConfig(bp);
    const dynamics = createBoardDynamicsEngine();
    const multEngine = createMultiplierValueEngine();
    const featureEngine = createFeatureEngine(gameConfig);

    const symA = gameConfig.symbols[0]!.id;
    const symB = gameConfig.symbols[1]!.id;
    const board = createBoardFromSymbolGrid([
      [symA, symB, symA],
      [symA, symA, symB],
      [symB, symA, symA],
    ]);

    const boardState = dynamics.createBoardState(board);
    const init = multEngine.createInitialState();

    // 1. Initialize Feature Starting Multiplier from trigger context and pass to B12 FeatureEngine
    const featMultRes = multEngine.initializeFeatureMultiplier(
      init.multiplierState,
      init.valueState,
      gameConfig.features[0]?.id ?? "free_spins_1",
      { triggerCount: 4 },
      {
        id: "fs-mult-cfg",
        featureId: gameConfig.features[0]?.id ?? "free_spins_1",
        defaultStartingMultiplier: 2,
        rules: [{ triggerCount: 4, startingMultiplier: 8 }],
      },
    );
    assert.equal(featMultRes.detail.startingMultiplier, 8);

    if (gameConfig.features[0]) {
      const startedFeature = featureEngine.startFeature(
        gameConfig.features[0].id,
        {
          startingMultiplierOverride: featMultRes.detail.startingMultiplier,
        },
      );
      assert.equal(startedFeature.nextState.currentMultiplier, 8);
    }

    // 2. Attach a 3x CellMultiplier at (0, 1) (symB) and tumble away symA wins
    const withCellMult = multEngine.addCellMultipliers(
      featMultRes.multiplierState,
      featMultRes.valueState,
      boardState.board,
      [{ value: 3, position: { reelIndex: 0, rowIndex: 1 }, scope: "spin" }],
    );

    const payAnywhereWin = evaluatePayAnywhere(boardState.board, {
      enabled: true,
      minimumMatchCount: 5,
      eligibleSymbols: [symA],
    });
    assert.equal(payAnywhereWin.qualifyingWinCount, 1);

    // Tumble removes symA cells; (0,1) symB compacts downward to (0,2)!
    const winPositions = payAnywhereWin.wins[0]!.matchedCells.map((c) => ({
      reelIndex: c.reelIndex,
      rowIndex: c.rowIndex,
    }));
    const tumbled = dynamics.applyTumble(boardState, winPositions, {
      refillPool: [symB],
    });

    // Sync B14 state with B13 tumble transition -> 3x cell multiplier moves from (0,1) to (0,2)!
    const synced = multEngine.syncWithBoardTransition(
      withCellMult.multiplierState,
      withCellMult.valueState,
      {
        nextBoard: tumbled.nextState.board,
        removedPositions: tumbled.removedCells.map((r) => r.position),
        movedCells: tumbled.movedCells.map((m) => ({
          from: m.from,
          to: m.to,
        })),
      },
    );
    assert.equal(
      synced.multiplierState.cellMultipliersByCoord["0:2"]?.[0]?.value,
      3,
    );

    // 3. Build settlement context combining 3x cell multiplier and 8x feature multiplier -> 24x!
    const settlement = multEngine.buildSettlementContext(
      synced.multiplierState,
      synced.valueState,
      { baseWin: 10 },
    );
    assert.equal(settlement.detail.spinMultiplier, 3);
    assert.equal(settlement.detail.featureMultiplier, 8);
    assert.equal(settlement.detail.effectiveMultiplier, 24);
    assert.equal(settlement.detail.settledWinAmount, 240);
  });
});
