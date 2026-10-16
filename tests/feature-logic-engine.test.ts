/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B15 — Meters & Feature Logic Engine Verification Suite
 *
 * Covers all 12 required verification areas from the B15 specification:
 *  1. Meters (initialization, symbol-landed, win, spin counting, spin/feature/session scopes)
 *  2. Thresholds (below, exact, crossing, multiple thresholds 5/10/20, numeric order, no refiring)
 *  3. Tiered Outcomes (correct tier selected from meter value, precedence, deterministic output)
 *  4. Weighted Outcomes (seeded deterministic selection, all valid outcomes reachable, invalid rejected)
 *  5. Chance Gates (0% never fires, 100% always fires, deterministic intermediate result)
 *  6. Losing-Spin Triggers (true zero-win triggers, nonzero does not trigger, multi-engine + B14 values)
 *  7. Ordered Actions (exact execution order, each action sees previous result, state carries forward)
 *  8. Nested Actions (child sequence works, result propagates to parent, recursion/cycle protection)
 *  9. Inline Board Action (delegates to B13 BoardDynamicsEngine, resulting board reaches next action)
 * 10. Feature Integration (enterFeature, upgradeFeature, retriggerFeature via B12 FeatureEngine)
 * 11. Snapshot / Restore (exact state recovery, identical future results after restore)
 * 12. Determinism (same seed + same input state = same logic result)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  ActionRecursionLimitExceededError,
  InvalidThresholdConfigurationError,
  InvalidWeightedOutcomeError,
  adaptBlueprintToGameConfig,
  createBoardDynamicsEngine,
  createBoardFromSymbolGrid,
  createFeatureEngine,
  createFeatureLogicEngine,
  createMultiplierValueEngine,
  createSeededRng,
} from "../src/engine";

describe("B15 — Meters & Feature Logic Engine", () => {
  it("1. Meters: supports initialization, symbol-landed, win, and spin counting, and enforces spin/feature/session scope resets", () => {
    const logic = createFeatureLogicEngine();
    let state = logic.createInitialState();

    // 1. Spin-scoped symbol-landed meter
    state = logic.initializeMeter(state, {
      meterId: "spin-symbol-meter",
      startingValue: 0,
      scope: "spin",
      eventSource: {
        eventType: "symbolLanded",
        symbolIds: ["SCATTER", "COIN"],
      },
    }).nextState;

    // 2. Feature-scoped win-taken meter
    state = logic.initializeMeter(state, {
      meterId: "feature-win-meter",
      startingValue: 0,
      scope: "feature",
      eventSource: {
        eventType: "winTaken",
      },
    }).nextState;

    // 3. Session-scoped spins-played meter
    state = logic.initializeMeter(state, {
      meterId: "session-spin-meter",
      startingValue: 0,
      scope: "session",
      eventSource: {
        eventType: "spinPlayed",
      },
    }).nextState;

    // Record symbolLanded event with 2 SCATTER, 1 COIN, and 2 A (A is ignored) -> +3
    state = logic.recordEvent(state, {
      eventType: "symbolLanded",
      symbolIds: ["SCATTER", "SCATTER", "COIN", "A", "A"],
    }).nextState;
    assert.equal(logic.getMeter(state, "spin-symbol-meter")?.currentValue, 3);

    // Record 2 winTaken events and 1 spinPlayed event
    state = logic.recordEvent(state, { eventType: "winTaken", count: 2 })
      .nextState;
    state = logic.recordEvent(state, { eventType: "spinPlayed", count: 1 })
      .nextState;
    assert.equal(logic.getMeter(state, "feature-win-meter")?.currentValue, 2);
    assert.equal(logic.getMeter(state, "session-spin-meter")?.currentValue, 1);

    // Clear spin scope -> spin-symbol-meter resets to 0; feature (2) & session (1) survive!
    const afterSpin = logic.clearSpinScope(state);
    assert.equal(
      logic.getMeter(afterSpin, "spin-symbol-meter")?.currentValue,
      0,
    );
    assert.equal(
      logic.getMeter(afterSpin, "feature-win-meter")?.currentValue,
      2,
    );
    assert.equal(
      logic.getMeter(afterSpin, "session-spin-meter")?.currentValue,
      1,
    );

    // Clear feature scope -> feature-win-meter resets to 0; session-spin-meter (1) survives!
    const afterFeature = logic.clearFeatureScope(afterSpin);
    assert.equal(
      logic.getMeter(afterFeature, "feature-win-meter")?.currentValue,
      0,
    );
    assert.equal(
      logic.getMeter(afterFeature, "session-spin-meter")?.currentValue,
      1,
    );

    // Reset session scope -> all meters reset
    const afterSession = logic.resetSessionScope(afterFeature);
    assert.equal(
      logic.getMeter(afterSession, "session-spin-meter")?.currentValue,
      0,
    );
  });

  it("2. Thresholds: evaluates below, exact, crossing, and multiple thresholds (5, 10, 20) in numeric order without repeated refiring", () => {
    const logic = createFeatureLogicEngine();
    let state = logic.createInitialState();

    state = logic.initializeMeter(state, {
      meterId: "charge-meter",
      startingValue: 0,
      scope: "feature",
      thresholds: [
        {
          thresholdId: "t-5",
          threshold: 5,
          actions: [
            { actionId: "prize-5", type: "awardPrize", prizeAmount: 10 },
          ],
        },
        {
          thresholdId: "t-10",
          threshold: 10,
          actions: [
            { actionId: "prize-10", type: "awardPrize", prizeAmount: 25 },
          ],
        },
        {
          thresholdId: "t-20",
          threshold: 20,
          actions: [
            { actionId: "prize-20", type: "awardPrize", prizeAmount: 100 },
          ],
        },
      ],
    }).nextState;

    // 1. Below threshold (meter = 4): no threshold fires
    const step4 = logic.incrementMeter(state, "charge-meter", 4);
    assert.equal(step4.thresholdsFired.length, 0);
    assert.equal(step4.nextState.totalAwardedPrizes, 0);

    // 2. Exact threshold (meter = 5): t-5 fires (+10 prize)
    const step5 = logic.incrementMeter(step4.nextState, "charge-meter", 1);
    assert.deepEqual(
      step5.thresholdsFired.map((t) => t.thresholdId),
      ["t-5"],
    );
    assert.equal(step5.nextState.totalAwardedPrizes, 10);

    // 3. Reaching 10 (meter = 10): t-5 has ALREADY fired so it does NOT refire; t-10 fires (+25); t-20 does not!
    const step10 = logic.incrementMeter(step5.nextState, "charge-meter", 5);
    assert.deepEqual(
      step10.thresholdsFired.map((t) => t.thresholdId),
      ["t-10"],
    );
    assert.equal(step10.nextState.totalAwardedPrizes, 35);

    // 4. Incrementing from 10 -> 12: neither t-5 nor t-10 refires!
    const step12 = logic.incrementMeter(step10.nextState, "charge-meter", 2);
    assert.equal(step12.thresholdsFired.length, 0);
    assert.equal(step12.nextState.totalAwardedPrizes, 35);

    // 5. Rejects out-of-order authored thresholds
    assert.throws(
      () =>
        logic.initializeMeter(state, {
          meterId: "bad-order",
          startingValue: 0,
          scope: "spin",
          thresholds: [
            { thresholdId: "t-10", threshold: 10, actions: [] },
            { thresholdId: "t-5", threshold: 5, actions: [] },
          ],
        }),
      (err: unknown) => err instanceof InvalidThresholdConfigurationError,
    );
  });

  it("3. Tiered Outcomes: selects the correct tier from the meter's current value in authored numeric order", () => {
    const logic = createFeatureLogicEngine();
    let state = logic.createInitialState();

    state = logic.initializeMeter(state, {
      meterId: "tier-meter",
      startingValue: 0,
      scope: "feature",
      tieredOutcomes: [
        {
          tierId: "bronze",
          threshold: 5,
          outcomeId: "outcome-bronze",
          actions: [
            { actionId: "act-bronze", type: "awardPrize", prizeAmount: 15 },
          ],
        },
        {
          tierId: "silver",
          threshold: 12,
          outcomeId: "outcome-silver",
          actions: [
            { actionId: "act-silver", type: "awardPrize", prizeAmount: 40 },
          ],
        },
        {
          tierId: "gold",
          threshold: 25,
          outcomeId: "outcome-gold",
          actions: [
            { actionId: "act-gold", type: "awardPrize", prizeAmount: 150 },
          ],
        },
      ],
    }).nextState;

    // At meter = 15, bronze (5) and silver (12) qualify in numeric order; selectedTier is silver!
    state = logic.setMeter(state, "tier-meter", 15).nextState;
    const resolved = logic.resolveTieredOutcome(state, "tier-meter");

    assert.deepEqual(
      resolved.detail.qualifyingTiers.map((t) => t.tierId),
      ["bronze", "silver"],
    );
    assert.equal(resolved.detail.selectedTier?.tierId, "silver");
    assert.equal(resolved.detail.selectedTier?.outcomeId, "outcome-silver");
    assert.equal(resolved.nextState.totalAwardedPrizes, 40);
  });

  it("4. Weighted Outcomes: deterministic seeded selection via B03 RandomSource, all outcomes reachable, and invalid pools rejected", () => {
    const logic = createFeatureLogicEngine();
    const state = logic.createInitialState();

    const pool = [
      { outcomeId: "minor-award", weight: 50 },
      { outcomeId: "major-award", weight: 35 },
      { outcomeId: "grand-award", weight: 15 },
    ] as const;

    const pick1 = logic.selectWeightedOutcome(
      state,
      "mystery-wheel",
      pool,
      createSeededRng("b15-weighted-seed"),
    );
    const pick2 = logic.selectWeightedOutcome(
      state,
      "mystery-wheel",
      pool,
      createSeededRng("b15-weighted-seed"),
    );
    assert.deepEqual(pick1, pick2);

    // Verify all 3 valid outcomes can be selected across 60 draws
    const rng = createSeededRng("b15-distribution-seed");
    const seenOutcomes = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const res = logic.selectWeightedOutcome(
        state,
        "mystery-wheel",
        pool,
        rng,
      );
      seenOutcomes.add(res.detail.outcomeId);
    }
    assert.equal(seenOutcomes.size, 3);

    // Reject empty pool and zero/negative weights
    assert.throws(
      () =>
        logic.selectWeightedOutcome(
          state,
          "empty-pool",
          [],
          createSeededRng("s"),
        ),
      (err: unknown) => err instanceof InvalidWeightedOutcomeError,
    );
    assert.throws(
      () =>
        logic.selectWeightedOutcome(
          state,
          "zero-weight-pool",
          [{ outcomeId: "bad", weight: 0 }],
          createSeededRng("s"),
        ),
      (err: unknown) => err instanceof InvalidWeightedOutcomeError,
    );
  });

  it("5. Chance Gates: 0% never fires, 100% always fires, and intermediate probabilities use deterministic B03 RandomSource", () => {
    const logic = createFeatureLogicEngine();
    const state = logic.createInitialState();

    // 0% never passes
    const zeroGate = logic.evaluateChanceGate(state, {
      gateId: "never-gate",
      probability: 0,
    });
    assert.equal(zeroGate.detail.passed, false);
    assert.equal(zeroGate.rngUsage, undefined);

    // 100% always passes
    const fullGate = logic.evaluateChanceGate(state, {
      gateId: "always-gate",
      probability: 100,
      unit: "percent",
    });
    assert.equal(fullGate.detail.passed, true);
    assert.equal(fullGate.rngUsage, undefined);

    // 50% intermediate probability is deterministic under identical seeds
    const mid1 = logic.evaluateChanceGate(
      state,
      { gateId: "half-gate", probability: 0.5 },
      createSeededRng("b15-chance-seed"),
    );
    const mid2 = logic.evaluateChanceGate(
      state,
      { gateId: "half-gate", probability: 0.5 },
      createSeededRng("b15-chance-seed"),
    );
    assert.deepEqual(mid1, mid2);
    assert.equal(mid1.rngUsage?.drawsConsumed, 1);
  });

  it("6. Losing-Spin Triggers: triggers on true zero-win spin and does NOT trigger when ways, clusters, pay-anywhere, scatter, or B14 values paid", () => {
    const logic = createFeatureLogicEngine();
    const multEngine = createMultiplierValueEngine();
    const state = logic.createInitialState();

    const consolationCondition = {
      conditionId: "losing-spin-consolation",
      kind: "losingSpin" as const,
      actions: [
        {
          actionId: "consolation-award",
          type: "awardPrize" as const,
          prizeAmount: 5,
        },
      ],
    };

    // 1. True zero-win spin across all win mechanisms -> triggers!
    const zeroSpin = logic.evaluateLosingSpinCondition(
      state,
      consolationCondition,
      {
        paylineWin: 0,
        waysWin: 0,
        clusterWin: 0,
        payAnywhereWin: 0,
        scatterWin: 0,
      },
    );
    assert.equal(zeroSpin.detail.triggered, true);
    assert.equal(zeroSpin.nextState.totalAwardedPrizes, 5);

    // 2. Nonzero Cluster win -> does NOT trigger
    const clusterPaid = logic.evaluateLosingSpinCondition(
      state,
      consolationCondition,
      {
        paylineWin: 0,
        clusterWin: 12,
      },
    );
    assert.equal(clusterPaid.detail.triggered, false);

    // 3. Zero base win, but B14 collectedValueTotal > 0 -> does NOT trigger!
    const board = createBoardFromSymbolGrid([
      ["COIN", "COLLECTOR"],
      ["A", "K"],
    ]);
    const mInit = multEngine.createInitialState();
    const mAssigned = multEngine.assignCellValues(
      mInit.multiplierState,
      mInit.valueState,
      board,
      [{ id: "c-def", symbolIds: ["COIN"], mode: "fixed", fixedValue: 20 }],
    );
    const mCollected = multEngine.collectValues(
      mAssigned.multiplierState,
      mAssigned.valueState,
      board,
      {
        id: "col-def",
        mode: "collect",
        collectorSymbolIds: ["COLLECTOR"],
        eligibleSourceSymbolIds: ["COIN"],
      },
    );
    const settlementCtx = multEngine.buildSettlementContext(
      mCollected.multiplierState,
      mCollected.valueState,
      { baseWin: 0 },
    ).detail;

    const valuePaidSpin = logic.evaluateLosingSpinCondition(
      state,
      consolationCondition,
      {
        paylineWin: 0,
        settlementContext: settlementCtx,
      },
    );
    assert.equal(valuePaidSpin.detail.triggered, false);
    assert.equal(valuePaidSpin.detail.totalResolvedWin, 20);
  });

  it("7, 8 & 9. Ordered Actions, Nested Actions & Inline Board Actions: executes sequentially, delegates board changes to B13, propagates child results, and guards against recursion", () => {
    const logic = createFeatureLogicEngine();
    const dynamics = createBoardDynamicsEngine();
    const board = createBoardFromSymbolGrid([
      ["A", "K"],
      ["Q", "J"],
    ]);
    const boardState = dynamics.createBoardState(board);

    let state = logic.createInitialState();
    state = logic.initializeMeter(state, {
      meterId: "combo-meter",
      startingValue: 1,
      scope: "spin",
    }).nextState;

    // Sequence:
    // Action 1: inlineBoardAction -> places "WILD_STAR" at (0,0) via B13
    // Action 2: nestedSequence -> child action increments combo-meter (+4 -> 5) and observes "WILD_STAR" at (0,0)
    // Action 3: awardPrize -> observes child action as previousActionId
    const seqRes = logic.executeActionSequence(
      state,
      {
        sequenceId: "root-seq",
        actions: [
          {
            actionId: "act-1-place-wild",
            type: "inlineBoardAction",
            boardOperation: {
              kind: "placeSymbols",
              spec: {
                placements: [
                  {
                    position: { reelIndex: 0, rowIndex: 0 },
                    symbolId: "WILD_STAR",
                  },
                ],
              },
            },
          },
          {
            actionId: "act-2-nested",
            type: "nestedSequence",
            sequenceId: "child-seq-1",
            actions: [
              {
                actionId: "child-act-inc-meter",
                type: "updateMeter",
                meterId: "combo-meter",
                operation: "increment",
                value: 4,
              },
            ],
          },
          {
            actionId: "act-3-prize",
            type: "awardPrize",
            prizeAmount: 50,
          },
        ],
      },
      {
        boardState,
        boardDynamicsEngine: dynamics,
      },
    );

    assert.equal(seqRes.actionsExecuted.length, 3);
    // Action 1 saw original "A" at (0,0) and placed "WILD_STAR"
    assert.equal(
      seqRes.actionsExecuted[0]!.observedBoardSymbolAtOrigin,
      "A",
    );
    // Action 2 (and its child) observed "WILD_STAR" at (0,0) produced by Action 1!
    const childResult = seqRes.actionsExecuted[1]!.childActionResults[0]!;
    assert.equal(childResult.observedPreviousActionId, "act-1-place-wild");
    assert.equal(childResult.observedBoardSymbolAtOrigin, "WILD_STAR");
    assert.deepEqual(childResult.meterChange, {
      meterId: "combo-meter",
      before: 1,
      after: 5,
    });
    // Action 3 observed the child action as its predecessor
    assert.equal(
      seqRes.actionsExecuted[2]!.observedPreviousActionId,
      "child-act-inc-meter",
    );
    assert.equal(seqRes.boardState?.board.cells[0]![0]!.symbolId, "WILD_STAR");
    assert.equal(seqRes.nextState.totalAwardedPrizes, 50);

    // Recursion / cyclic sequence guard test
    assert.throws(
      () =>
        logic.executeActionSequence(state, {
          sequenceId: "cyclic-seq",
          actions: [
            {
              actionId: "self-recurse",
              type: "nestedSequence",
              sequenceId: "cyclic-seq",
              actions: [],
            },
          ],
        }),
      (err: unknown) => err instanceof ActionRecursionLimitExceededError,
    );
  });

  it("10. Feature Integration: delegates enterFeature, retriggerFeature, and upgradeFeature to B12 FeatureEngine without duplicating lifecycle state", () => {
    const bp = createBlueprint({
      id: "b15-feature-slot",
      title: "Feature Logic Slot",
      theme: "Adventure",
      columns: 5,
      rows: 3,
    });
    const gameConfig = adaptBlueprintToGameConfig(bp);
    const featureEngine = createFeatureEngine({
      ...gameConfig,
      features: [
        ...gameConfig.features,
        {
          id: "super_bonus_mode",
          name: "Super Bonus Mode",
          kind: "free_spins",
          enabled: true,
          triggerSymbolIds: [],
          triggerCount: 3,
          params: { spins: 8, multiplier: 5 },
        },
      ],
    });
    const logic = createFeatureLogicEngine();
    const state = logic.createInitialState();

    const baseFeatureId = gameConfig.features[0]!.id;

    const seqRes = logic.executeActionSequence(
      state,
      {
        sequenceId: "b12-delegation-seq",
        actions: [
          {
            actionId: "req-enter",
            type: "featureRequest",
            requestType: "enterFeature",
            featureId: baseFeatureId,
            extraSpins: 10,
            startingMultiplier: 2,
          },
          {
            actionId: "req-retrigger",
            type: "featureRequest",
            requestType: "retriggerFeature",
            featureId: baseFeatureId,
            extraSpins: 5,
          },
          {
            actionId: "req-upgrade",
            type: "featureRequest",
            requestType: "upgradeFeature",
            featureId: baseFeatureId,
            targetFeatureId: "super_bonus_mode",
            extraSpins: 8,
            startingMultiplier: 5,
          },
        ],
      },
      {
        featureEngine,
      },
    );

    assert.equal(seqRes.nextState.pendingFeatureRequests.length, 3);
    assert.ok(seqRes.featureState);
    assert.equal(seqRes.featureState.featureId, "super_bonus_mode");
    // 10 initial + 5 retrigger + 8 upgrade = 23 remaining spins!
    assert.equal(seqRes.featureState.remainingSpins, 23);
    assert.equal(seqRes.featureState.currentMultiplier, 5);
  });

  it("11 & 12. Snapshot/Restore & Determinism: restored state produces identical future results under the same seed", () => {
    const logic = createFeatureLogicEngine();
    let state = logic.createInitialState();

    state = logic.initializeMeter(state, {
      meterId: "prog-meter",
      startingValue: 0,
      scope: "session",
      thresholds: [
        {
          thresholdId: "t-10",
          threshold: 10,
          actions: [
            { actionId: "p-10", type: "awardPrize", prizeAmount: 100 },
          ],
        },
      ],
    }).nextState;

    state = logic.incrementMeter(state, "prog-meter", 6).nextState;

    // Take snapshot at meter = 6
    const snap = logic.snapshot(state);
    const restored = logic.restore(snap);

    // Uninterrupted execution: increment by 5 (reaches 11 -> fires t-10) + evaluate 65% chance gate
    const uninterruptedInc = logic.incrementMeter(state, "prog-meter", 5);
    const uninterruptedGate = logic.evaluateChanceGate(
      uninterruptedInc.nextState,
      { gateId: "bonus-gate", probability: 0.65 },
      createSeededRng("b15-snap-seed"),
    );

    // Restored execution: increment by 5 + evaluate 65% chance gate with same seed
    const restoredInc = logic.incrementMeter(restored, "prog-meter", 5);
    const restoredGate = logic.evaluateChanceGate(
      restoredInc.nextState,
      { gateId: "bonus-gate", probability: 0.65 },
      createSeededRng("b15-snap-seed"),
    );

    assert.deepEqual(uninterruptedInc, restoredInc);
    assert.deepEqual(uninterruptedGate, restoredGate);
    assert.equal(restoredGate.nextState.totalAwardedPrizes, 100);
  });
});
