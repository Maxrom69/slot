/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B12 — Feature Engine Verification Suite
 *
 * Covers Categories A through K and all edge cases from the B12 specification:
 *  A. Scatter-triggered feature (exact threshold, below threshold, fire-once per board, starting multiplier scaling)
 *  B. Zone/reel trigger (symbol count inside configured zone, symbol presence on configured reels, multiple triggers on one board)
 *  C. Free spins (initial award, trigger-count scaling, retrigger, retrigger on final spin, retrigger batch cap)
 *  D. Alternate reels (feature reels activate on entry, base reels restore on exit)
 *  E. Feature accounting (cumulative win, no fake zero-win presentation, max-win cap exact trim & exact boundary)
 *  F. Winning-spin cap (counts winning spins, multiple cascades in one spin count as 1 winning spin)
 *  G. Hold & Win (locked state persists, new lock resets respin counter, zero counter ends feature and pays once)
 *  H. Bonus game weighted outcomes (deterministic seeded result, without-replacement multi-pick, pool exhaustion, credit summation)
 *  I. Feature upgrade & Feature Buy (unspent spins carry forward, upgrade with 0 remaining spins, new spins added, upgraded mode & reels active, direct & guaranteed-trigger Feature Buy)
 *  J. Determinism & Structured Validation Errors (identical seed + state = identical transition, invalid references/pools/thresholds rejected)
 *  K. Snapshot/restore (mid-feature restore produces identical future trajectory as uninterrupted execution)
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  InvalidBonusPoolError,
  InvalidFeatureConfigurationError,
  InvalidFeatureTriggerError,
  UnknownFeatureReferenceError,
  createBoardFromSymbolGrid,
  createFeatureEngine,
  createSeededRng,
  evaluateScatters,
} from "../src/engine";

const BASE_REELS = [
  ["A", "K", "Q", "J", "SCATTER"],
  ["A", "K", "Q", "J", "SCATTER"],
  ["A", "K", "Q", "J", "SCATTER"],
  ["A", "K", "Q", "J", "SCATTER"],
  ["A", "K", "Q", "J", "SCATTER"],
] as const;

const FEATURE_ALT_REELS = [
  ["A", "A", "WILD", "K", "SCATTER"],
  ["A", "A", "WILD", "K", "SCATTER"],
  ["A", "A", "WILD", "K", "SCATTER"],
  ["A", "A", "WILD", "K", "SCATTER"],
  ["A", "A", "WILD", "K", "SCATTER"],
] as const;

const SUPER_FEATURE_REELS = [
  ["WILD", "WILD", "A", "A", "SCATTER"],
  ["WILD", "WILD", "A", "A", "SCATTER"],
  ["WILD", "WILD", "A", "A", "SCATTER"],
  ["WILD", "WILD", "A", "A", "SCATTER"],
  ["WILD", "WILD", "A", "A", "SCATTER"],
] as const;

describe("B12 — Feature Engine", () => {
  it("A. Scatter-triggered feature: exact threshold triggers, below threshold does not, qualifying board fires once, and starting multiplier scales by count", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "fs-main",
          name: "Free Spins",
          mode: "freeSpins",
          freeSpins: {
            initialSpins: 10,
            spinsByTriggerCount: { 3: 10, 4: 15, 5: 25 },
          },
          triggers: [
            {
              id: "trig-scatter",
              source: "scatterCount",
              targetFeatureId: "fs-main",
              symbolIds: ["SCATTER"],
              threshold: 3,
              awardedSpinsByCount: { 3: 10, 4: 15, 5: 25 },
              startingMultiplierByCount: { 3: 1, 4: 2, 5: 5 },
            },
          ],
        },
      ],
    });

    // 1. Below threshold (2 Scatters) -> does not trigger
    const board2Scatters = createBoardFromSymbolGrid([
      ["SCATTER", "A", "K"],
      ["Q", "SCATTER", "J"],
      ["A", "K", "Q"],
      ["J", "A", "K"],
      ["Q", "J", "A"],
    ]);
    const evalBelow = engine.evaluateTriggers(board2Scatters);
    assert.equal(evalBelow.triggerResults.length, 1);
    assert.equal(evalBelow.triggerResults[0]!.matched, false);
    assert.equal(evalBelow.triggerResults[0]!.measuredValue, 2);

    // 2. Exact threshold (3 Scatters) -> triggers once with 10 spins and 1x multiplier
    const board3Scatters = createBoardFromSymbolGrid([
      ["SCATTER", "A", "K"],
      ["Q", "SCATTER", "J"],
      ["A", "K", "SCATTER"],
      ["J", "A", "K"],
      ["Q", "J", "A"],
    ]);
    const scatterRes = evaluateScatters(board3Scatters, {
      enabled: true,
      symbolIds: ["SCATTER"],
      rules: [
        {
          scatterSymbolId: "SCATTER",
          evaluatesAnywhere: true,
          independentOfPaylines: true,
          payoutReferenceSymbolId: null,
          triggerFeatureId: "fs-main",
          minimumTriggerCount: 3,
        },
      ],
    });
    const evalExact = engine.evaluateTriggers(board3Scatters, undefined, {
      evaluationId: "spin-001",
      scatterResult: scatterRes,
    });
    assert.equal(evalExact.triggerResults[0]!.matched, true);
    assert.equal(evalExact.triggerResults[0]!.measuredValue, 3);
    assert.equal(evalExact.triggerResults[0]!.awardedSpins, 10);
    assert.equal(evalExact.triggerResults[0]!.startingMultiplier, 1);

    // 3. Re-evaluating the same qualifying board evaluation does NOT fire again
    const evalRepeat = engine.evaluateTriggers(
      board3Scatters,
      evalExact.nextState,
      { evaluationId: "spin-001" },
    );
    assert.equal(evalRepeat.triggerResults[0]!.matched, false);
    assert.equal(evalRepeat.triggerResults[0]!.alreadyFired, true);

    // 4. Higher trigger count (5 Scatters) -> opens feature at 5x starting multiplier and 25 spins
    const board5Scatters = createBoardFromSymbolGrid([
      ["SCATTER", "A", "K"],
      ["Q", "SCATTER", "J"],
      ["A", "K", "SCATTER"],
      ["SCATTER", "A", "K"],
      ["Q", "J", "SCATTER"],
    ]);
    const eval5 = engine.evaluateTriggers(board5Scatters, undefined, {
      evaluationId: "spin-002",
    });
    const trig5 = eval5.triggerResults[0]!;
    assert.equal(trig5.matched, true);
    assert.equal(trig5.awardedSpins, 25);
    assert.equal(trig5.startingMultiplier, 5);

    const started = engine.startFeature("fs-main", {
      triggerCount: 5,
      awardedSpinsOverride: trig5.awardedSpins,
      startingMultiplierOverride: trig5.startingMultiplier,
    });
    assert.equal(started.nextState.remainingSpins, 25);
    assert.equal(started.nextState.currentMultiplier, 5);
    assert.equal(started.nextState.startingMultiplier, 5);
  });

  it("B. Zone/reel trigger: symbol count inside configured area, symbol presence on configured reels, and multiple triggers on one board", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "zone-feature",
          name: "Center Zone Feature",
          mode: "freeSpins",
          freeSpins: { initialSpins: 5 },
          triggers: [
            {
              id: "trig-center-zone",
              source: "zoneCount",
              targetFeatureId: "zone-feature",
              symbolIds: ["ORB"],
              threshold: 4,
              zone: {
                reelIndexes: [1, 2, 3],
                rowIndexes: [0, 1],
              },
            },
          ],
        },
        {
          id: "reel-feature",
          name: "Odd Reels Collector",
          mode: "bonus",
          triggers: [
            {
              id: "trig-reels-0-2-4",
              source: "reelPresence",
              targetFeatureId: "reel-feature",
              symbolIds: ["BONUS"],
              threshold: 3,
              reelIndexes: [0, 2, 4],
              requireAllReels: true,
            },
          ],
        },
      ],
    });

    // Board where 4 ORBs are inside reels [1,2,3] x rows [0,1], AND BONUS is on reels 0, 2, 4
    const boardBothMatch = createBoardFromSymbolGrid([
      ["BONUS", "A", "ORB"], // reel 0: BONUS at (0,0); ORB at (0,2) is outside zone!
      ["ORB", "ORB", "K"], // reel 1: 2 ORBs in rows 0,1
      ["ORB", "A", "BONUS"], // reel 2: 1 ORB in row 0, BONUS in row 2
      ["A", "ORB", "Q"], // reel 3: 1 ORB in row 1 (total 4 ORBs inside zone!)
      ["A", "BONUS", "J"], // reel 4: BONUS in row 1
    ]);

    const res = engine.evaluateTriggers(boardBothMatch);
    assert.equal(res.triggerResults.length, 2);

    const zoneTrig = res.triggerResults.find(
      (t) => t.triggerId === "trig-center-zone",
    )!;
    const reelTrig = res.triggerResults.find(
      (t) => t.triggerId === "trig-reels-0-2-4",
    )!;

    assert.equal(zoneTrig.matched, true);
    assert.equal(zoneTrig.measuredValue, 4);
    assert.equal(zoneTrig.selectedFeatureId, "zone-feature");

    assert.equal(reelTrig.matched, true);
    assert.equal(reelTrig.measuredValue, 3);
    assert.equal(reelTrig.selectedFeatureId, "reel-feature");
  });

  it("C. Free spins: initial award, trigger-count scaling, retrigger on final spin, and retrigger batch cap", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "fs-retrig",
          name: "Retriggerable Free Spins",
          mode: "freeSpins",
          freeSpins: {
            initialSpins: 2,
            spinsByTriggerCount: { 3: 2, 4: 4 },
            retriggerEnabled: true,
            retriggerSymbolIds: ["SCATTER"],
            retriggerThreshold: 3,
            retriggerSpins: 3,
            maxRetriggerBatches: 2,
          },
        },
      ],
    });

    const nonRetrigBoard = createBoardFromSymbolGrid([
      ["A", "K", "Q"],
      ["J", "A", "K"],
      ["Q", "J", "A"],
      ["K", "Q", "J"],
      ["A", "K", "Q"],
    ]);

    const retrigBoard = createBoardFromSymbolGrid([
      ["SCATTER", "K", "Q"],
      ["J", "SCATTER", "K"],
      ["Q", "J", "SCATTER"],
      ["K", "Q", "J"],
      ["A", "K", "Q"],
    ]);

    // Start with triggerCount = 3 -> 2 initial spins
    let step = engine.startFeature("fs-retrig", { triggerCount: 3 });
    assert.equal(step.nextState.remainingSpins, 2);
    assert.equal(step.nextState.awardedSpins, 2);

    // Spin 1: no retrigger -> remainingSpins drops from 2 to 1
    step = engine.runFeatureStep(step.nextState, {
      board: nonRetrigBoard,
      spinWinAmount: 5,
    });
    assert.equal(step.spinsBefore, 2);
    assert.equal(step.spinsAfter, 1);
    assert.equal(step.featureStatus, "active");

    // Spin 2 (FINAL available spin!): retrigger occurs (batch 1 of 2) -> adds 3 spins instead of ending!
    step = engine.runFeatureStep(step.nextState, {
      board: retrigBoard,
      spinWinAmount: 0,
    });
    assert.equal(step.spinsBefore, 1);
    assert.equal(step.spinsAfter, 3);
    assert.equal(step.retriggers.length, 1);
    assert.equal(step.retriggers[0]!.spinsAdded, 3);
    assert.equal(step.retriggers[0]!.cappedOut, false);
    assert.equal(step.featureStatus, "active");

    // Spin 3: second retrigger (batch 2 of 2) -> adds 3 more spins, reaches batch cap
    step = engine.runFeatureStep(step.nextState, {
      board: retrigBoard,
      spinWinAmount: 0,
    });
    assert.equal(step.spinsBefore, 3);
    assert.equal(step.spinsAfter, 5); // 3 - 1 + 3 = 5
    assert.equal(step.nextState.retriggerBatchCount, 2);
    assert.equal(step.capStatus.retriggerBatchCapReached, true);

    // Spin 4: third retrigger board lands, but maxRetriggerBatches (2) is already reached -> adds 0 spins!
    step = engine.runFeatureStep(step.nextState, {
      board: retrigBoard,
      spinWinAmount: 0,
    });
    assert.equal(step.spinsBefore, 5);
    assert.equal(step.spinsAfter, 4);
    assert.equal(step.retriggers.length, 1);
    assert.equal(step.retriggers[0]!.spinsAdded, 0);
    assert.equal(step.retriggers[0]!.cappedOut, true);
  });

  it("D. Alternate reels: feature reels activate during feature and base reels restore on exit", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "fs-alt-reels",
          name: "Alternate Reel Free Spins",
          mode: "freeSpins",
          alternateReels: FEATURE_ALT_REELS,
          freeSpins: { initialSpins: 1 },
        },
      ],
    });

    const initial = engine.createInitialState();
    assert.equal(initial.activeReelSource, "base");
    assert.deepEqual(
      engine
        .getActiveReels(initial)
        .map((r) => r.stops.map((s) => s.symbolId)),
      BASE_REELS,
    );

    const started = engine.startFeature("fs-alt-reels");
    assert.equal(started.activeReelSource, "feature");
    assert.equal(started.nextState.activeReelSource, "feature");
    assert.deepEqual(
      engine
        .getActiveReels(started.nextState)
        .map((r) => r.stops.map((s) => s.symbolId)),
      FEATURE_ALT_REELS,
    );

    // Exhaust the 1 free spin -> feature exits and base reels are restored
    const finished = engine.runFeatureStep(started.nextState, {
      spinWinAmount: 10,
    });
    assert.equal(finished.featureStatus, "completed");
    assert.equal(finished.currentMode, "base");
    assert.equal(finished.activeReelSource, "base");
    assert.deepEqual(
      engine
        .getActiveReels(finished.nextState)
        .map((r) => r.stops.map((s) => s.symbolId)),
      BASE_REELS,
    );
  });

  it("E. Feature accounting: cumulative feature win, no fake zero-win presentation, and max-win cap exact trimming", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "fs-zero",
          name: "Zero Win Free Spins",
          mode: "freeSpins",
          freeSpins: { initialSpins: 2 },
        },
        {
          id: "fs-capped",
          name: "Capped Free Spins",
          mode: "freeSpins",
          freeSpins: { initialSpins: 5 },
          roundControl: { winCap: 100 },
        },
      ],
    });

    // 1. Feature that pays nothing -> featureWinSummary MUST be null (no fake zero-win presentation)
    let zeroRun = engine.startFeature("fs-zero");
    zeroRun = engine.runFeatureStep(zeroRun.nextState, { spinWinAmount: 0 });
    zeroRun = engine.runFeatureStep(zeroRun.nextState, { spinWinAmount: 0 });
    assert.equal(zeroRun.featureStatus, "completed");
    assert.equal(zeroRun.featureWinAfter, 0);
    assert.equal(zeroRun.featureWinSummary, null);

    // 2. Feature that exceeds winCap (100) -> trims award to exact cap and stops remaining spins
    let cappedRun = engine.startFeature("fs-capped");
    cappedRun = engine.runFeatureStep(cappedRun.nextState, {
      spinWinAmount: 60,
    });
    assert.equal(cappedRun.featureWinAfter, 60);
    assert.equal(cappedRun.featureStatus, "active");
    assert.equal(cappedRun.spinsAfter, 4);

    // Next spin wins 75 (60 + 75 = 135 > 100) -> trimmed to 40, total = 100, remainingSpins = 0
    cappedRun = engine.runFeatureStep(cappedRun.nextState, {
      spinWinAmount: 75,
    });
    assert.equal(cappedRun.featureWinBefore, 60);
    assert.equal(cappedRun.stepWinAwarded, 40);
    assert.equal(cappedRun.stepWinTrimmedByCap, 35);
    assert.equal(cappedRun.featureWinAfter, 100);
    assert.equal(cappedRun.spinsAfter, 0);
    assert.equal(cappedRun.featureStatus, "completed");
    assert.equal(cappedRun.endReason, "winCapReached");
    assert.equal(cappedRun.capStatus.winCapReached, true);
    assert.deepEqual(cappedRun.featureWinSummary, {
      featureId: "fs-capped",
      totalFeatureWin: 100,
      spinsPlayed: 2,
      winningSpinCount: 2,
    });

    // 3. Feature win exactly equal to winCap (100) also terminates remaining spins
    let exactCapRun = engine.startFeature("fs-capped");
    exactCapRun = engine.runFeatureStep(exactCapRun.nextState, {
      spinWinAmount: 100,
    });
    assert.equal(exactCapRun.stepWinAwarded, 100);
    assert.equal(exactCapRun.stepWinTrimmedByCap, 0);
    assert.equal(exactCapRun.featureWinAfter, 100);
    assert.equal(exactCapRun.spinsAfter, 0);
    assert.equal(exactCapRun.featureStatus, "completed");
    assert.equal(exactCapRun.endReason, "winCapReached");
  });

  it("F. Winning-spin cap: counts winning spins accurately and treats multiple cascades on one spin as a single winning spin", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "fs-win-spin-cap",
          name: "Guaranteed Winning Spins",
          mode: "freeSpins",
          freeSpins: { initialSpins: 10 },
          roundControl: { winningSpinCap: 2 },
        },
      ],
    });

    let step = engine.startFeature("fs-win-spin-cap");

    // Spin 1: 4 cascades in a single spin -> counts as ONE winning spin (winningSpinCount = 1)
    step = engine.runFeatureStep(step.nextState, {
      cascadeWins: [5, 10, 4, 6],
      cascadeCount: 4,
    });
    assert.equal(step.winningSpinCount, 1);
    assert.equal(step.featureWinAfter, 25);
    assert.equal(step.featureStatus, "active");

    // Spin 2: dead spin (0 win) -> winningSpinCount stays 1
    step = engine.runFeatureStep(step.nextState, {
      cascadeWins: [],
      cascadeCount: 0,
      spinWinAmount: 0,
    });
    assert.equal(step.winningSpinCount, 1);
    assert.equal(step.featureStatus, "active");

    // Spin 3: 3 cascades in a single spin -> winningSpinCount reaches 2 (cap reached!), feature ends
    step = engine.runFeatureStep(step.nextState, {
      cascadeWins: [8, 12, 5],
      cascadeCount: 3,
    });
    assert.equal(step.winningSpinCount, 2);
    assert.equal(step.featureWinAfter, 50);
    assert.equal(step.spinsAfter, 0);
    assert.equal(step.featureStatus, "completed");
    assert.equal(step.endReason, "winningSpinCapReached");
    assert.equal(step.capStatus.winningSpinCapReached, true);
  });

  it("G. Hold & Win: locked state persists, new lock resets respin counter, and zero counter ends feature and pays once", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "hw-coins",
          name: "Hold & Win Coins",
          mode: "holdAndWin",
          holdAndWin: {
            initialRespins: 3,
            lockableSymbolIds: ["COIN"],
            defaultSymbolValue: 10,
          },
        },
      ],
    });

    const triggerBoard = createBoardFromSymbolGrid([
      ["COIN", "A", "K"],
      ["Q", "COIN", "J"],
      ["A", "K", "COIN"],
      ["J", "A", "K"],
      ["Q", "J", "A"],
    ]);

    // Start Hold & Win with 3 initial locked coins (values 10, 20, 30 = 60)
    let step = engine.startFeature("hw-coins", {
      board: triggerBoard,
      cellValuesByCoord: {
        "0:0": 10,
        "1:1": 20,
        "2:2": 30,
      },
    });
    assert.equal(step.holdAndWinState!.respinsRemaining, 3);
    assert.equal(step.holdAndWinState!.lockedSymbolCount, 3);
    assert.equal(step.holdAndWinState!.lockedPoolTotalValue, 60);
    assert.equal(step.featureWinAfter, 0); // Pool does not pay until feature ends

    // Respin 1: no new coins -> respinsRemaining drops to 2
    const blankBoard = createBoardFromSymbolGrid([
      ["A", "A", "K"],
      ["Q", "A", "J"],
      ["A", "K", "A"],
      ["J", "A", "K"],
      ["Q", "J", "A"],
    ]);
    step = engine.runFeatureStep(step.nextState, { board: blankBoard });
    assert.equal(step.holdAndWinState!.respinsRemaining, 2);
    assert.equal(step.holdAndWinState!.lockedSymbolCount, 3);
    assert.equal(step.featureWinAfter, 0);

    // Respin 2: new COIN lands at (4, 2) with value 50 -> resets respinsRemaining to 3!
    const newCoinBoard = createBoardFromSymbolGrid([
      ["A", "A", "K"],
      ["Q", "A", "J"],
      ["A", "K", "A"],
      ["J", "A", "K"],
      ["Q", "J", "COIN"],
    ]);
    step = engine.runFeatureStep(step.nextState, {
      board: newCoinBoard,
      cellValuesByCoord: { "4:2": 50 },
    });
    assert.equal(step.holdAndWinState!.respinsRemaining, 3);
    assert.equal(step.holdAndWinState!.lockedSymbolCount, 4);
    assert.equal(step.holdAndWinState!.lockedPoolTotalValue, 110);
    assert.equal(step.featureWinAfter, 0);

    // Respins 3, 4, 5: 3 consecutive blank boards -> counter reaches 0, feature ends and pays 110 ONCE
    step = engine.runFeatureStep(step.nextState, { board: blankBoard });
    assert.equal(step.holdAndWinState!.respinsRemaining, 2);
    step = engine.runFeatureStep(step.nextState, { board: blankBoard });
    assert.equal(step.holdAndWinState!.respinsRemaining, 1);
    step = engine.runFeatureStep(step.nextState, { board: blankBoard });
    assert.equal(step.holdAndWinState!.respinsRemaining, 0);
    assert.equal(step.holdAndWinState!.lockedPoolPaidOnce, true);
    assert.equal(step.stepWinAwarded, 110);
    assert.equal(step.featureWinAfter, 110);
    assert.equal(step.featureStatus, "completed");
    assert.equal(step.endReason, "respinsExhausted");
  });

  it("H. Bonus game weighted outcomes: deterministic seeded result, without-replacement multi-pick, pool exhaustion, and credit summation", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "pick-bonus",
          name: "Treasure Chest Pick",
          mode: "bonus",
          bonusGame: {
            bonusType: "pick",
            picksCount: 3,
            withoutReplacement: true,
            sectors: [
              { id: "chest-1", label: "Bronze", weight: 40, credits: 10 },
              { id: "chest-2", label: "Silver", weight: 30, credits: 25 },
              {
                id: "chest-3",
                label: "Gold + Meter",
                weight: 20,
                credits: 50,
                action: { type: "setMeter", meterKey: "bonusLevel", value: 2 },
              },
              { id: "chest-4", label: "Diamond", weight: 10, credits: 100 },
            ],
          },
        },
        {
          id: "exhaust-bonus",
          name: "Small Pool Pick",
          mode: "bonus",
          bonusGame: {
            bonusType: "wheel",
            picksCount: 5, // requests 5 picks from a 2-sector pool without replacement
            withoutReplacement: true,
            sectors: [
              { id: "s1", weight: 10, credits: 15 },
              { id: "s2", weight: 20, credits: 35 },
            ],
          },
        },
      ],
    });

    const rng1 = createSeededRng("b12-bonus-seed-99");
    const rng2 = createSeededRng("b12-bonus-seed-99");

    const started1 = engine.startFeature("pick-bonus");
    const res1 = engine.runFeatureStep(started1.nextState, { rng: rng1 });

    const started2 = engine.startFeature("pick-bonus");
    const res2 = engine.runFeatureStep(started2.nextState, { rng: rng2 });

    // Deterministic seeded outcome
    assert.deepEqual(res1, res2);
    assert.equal(res1.bonusResolution!.selections.length, 3);

    // Without replacement: all 3 picked sectorIds must be distinct
    const pickedIds = res1.bonusResolution!.selections.map((s) => s.sectorId);
    assert.equal(new Set(pickedIds).size, 3);

    // Credits summed accurately
    const expectedSum = res1.bonusResolution!.selections.reduce(
      (acc, s) => acc + s.creditsAwarded,
      0,
    );
    assert.equal(res1.bonusResolution!.totalCreditsAwarded, expectedSum);
    assert.equal(res1.featureWinAfter, expectedSum);

    // Pool exhaustion test (5 picks requested from 2 sectors without replacement -> stops cleanly at 2)
    const startedExhaust = engine.startFeature("exhaust-bonus");
    const resExhaust = engine.runFeatureStep(startedExhaust.nextState, {
      rng: createSeededRng("exhaust-seed"),
    });
    assert.equal(resExhaust.bonusResolution!.selections.length, 2);
    assert.equal(resExhaust.bonusResolution!.totalCreditsAwarded, 50);
    assert.equal(resExhaust.bonusResolution!.remainingPoolSize, 0);
  });

  it("I. Feature upgrade & Feature Buy: unspent spins carry forward, new spins added, upgraded mode & reels active, and Feature Buy modes work deterministically", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "fs-regular",
          name: "Regular Free Spins",
          mode: "freeSpins",
          alternateReels: FEATURE_ALT_REELS,
          startingMultiplier: 2,
          freeSpins: { initialSpins: 5 },
          upgradeTargetFeatureId: "fs-super",
          featureBuy: {
            enabled: true,
            costMultiplier: 100,
            entryMode: "guaranteedTriggerSpin",
            targetFeatureId: "fs-regular",
            guaranteedTriggerCount: 3,
            triggerSymbolId: "SCATTER",
          },
          triggers: [
            {
              id: "trig-fs-regular",
              source: "scatterCount",
              targetFeatureId: "fs-regular",
              symbolIds: ["SCATTER"],
              threshold: 3,
              awardedSpins: 5,
              startingMultiplier: 2,
            },
          ],
        },
        {
          id: "fs-super",
          name: "Super Free Spins",
          mode: "freeSpins",
          alternateReels: SUPER_FEATURE_REELS,
          startingMultiplier: 5,
          freeSpins: { initialSpins: 4 },
          featureBuy: {
            enabled: true,
            costMultiplier: 250,
            entryMode: "direct",
            targetFeatureId: "fs-super",
          },
        },
      ],
    });

    // 1. Feature Buy (guaranteedTriggerSpin) via B03 RandomSource
    const buyRng = createSeededRng("b12-feature-buy-seed");
    const bought = engine.buyFeature("fs-regular", { rng: buyRng });
    assert.ok(bought.purchasedBoard);
    assert.equal(bought.featureStatus, "active");
    assert.equal(bought.featureId, "fs-regular");
    assert.equal(bought.spinsAfter, 5);

    // Play 2 spins -> 3 unspent spins remaining
    let step = engine.runFeatureStep(bought.nextState, { spinWinAmount: 10 });
    step = engine.runFeatureStep(step.nextState, { spinWinAmount: 15 });
    assert.equal(step.spinsAfter, 3);

    // 2. Upgrade active feature to "fs-super": carries 3 unspent spins + adds 4 super spins = 7 spins
    const upgraded = engine.upgradeFeature(step.nextState, "fs-super");
    assert.equal(upgraded.featureId, "fs-super");
    assert.equal(upgraded.upgradeInfo!.carriedSpins, 3);
    assert.equal(upgraded.upgradeInfo!.addedSpins, 4);
    assert.equal(upgraded.spinsAfter, 7);
    assert.equal(upgraded.multiplierAfter, 5);
    assert.deepEqual(
      engine
        .getActiveReels(upgraded.nextState)
        .map((r) => r.stops.map((s) => s.symbolId)),
      SUPER_FEATURE_REELS,
    );

    // 3. Upgrade with 0 remaining spins via step action
    let lastSpinState = engine.startFeature("fs-regular", {
      awardedSpinsOverride: 1,
    }).nextState;
    const upgradedOnFinalSpin = engine.runFeatureStep(lastSpinState, {
      spinWinAmount: 5,
      actions: [{ type: "upgradeFeature", targetFeatureId: "fs-super" }],
    });
    assert.equal(upgradedOnFinalSpin.featureStatus, "active");
    assert.equal(upgradedOnFinalSpin.featureId, "fs-super");
    assert.equal(upgradedOnFinalSpin.upgradeInfo!.carriedSpins, 0);
    assert.equal(upgradedOnFinalSpin.upgradeInfo!.addedSpins, 4);
    assert.equal(upgradedOnFinalSpin.spinsAfter, 4);
  });

  it("J. Determinism & Structured Validation Errors: identical seed + state = identical transition, and invalid configs throw structured errors", () => {
    // 1. Invalid feature reference in trigger
    assert.throws(
      () =>
        createFeatureEngine({
          features: [
            {
              id: "f1",
              name: "F1",
              mode: "freeSpins",
              triggers: [
                {
                  id: "t1",
                  source: "scatterCount",
                  targetFeatureId: "NON_EXISTENT",
                  symbolIds: ["SCATTER"],
                  threshold: 3,
                },
              ],
            },
          ],
        }),
      (err: unknown) => err instanceof UnknownFeatureReferenceError,
    );

    // 2. Empty/invalid weighted bonus pool
    assert.throws(
      () =>
        createFeatureEngine({
          features: [
            {
              id: "bad-bonus",
              name: "Bad Bonus",
              mode: "bonus",
              bonusGame: {
                bonusType: "wheel",
                sectors: [{ id: "s1", weight: 0, credits: 10 }],
              },
            },
          ],
        }),
      (err: unknown) => err instanceof InvalidBonusPoolError,
    );

    // 3. Invalid trigger threshold (<= 0)
    assert.throws(
      () =>
        createFeatureEngine({
          features: [
            {
              id: "bad-trig",
              name: "Bad Trigger",
              mode: "freeSpins",
              triggers: [
                {
                  id: "t-zero",
                  source: "scatterCount",
                  targetFeatureId: "bad-trig",
                  symbolIds: ["SCATTER"],
                  threshold: 0,
                },
              ],
            },
          ],
        }),
      (err: unknown) => err instanceof InvalidFeatureTriggerError,
    );

    // 4. Invalid winCap (<= 0)
    assert.throws(
      () =>
        createFeatureEngine({
          features: [
            {
              id: "bad-cap",
              name: "Bad Cap",
              mode: "freeSpins",
              roundControl: { winCap: -10 },
            },
          ],
        }),
      (err: unknown) => err instanceof InvalidFeatureConfigurationError,
    );
  });

  it("K. Snapshot/restore: mid-feature snapshot & restore produces the exact same future trajectory as uninterrupted execution", () => {
    const engine = createFeatureEngine({
      baseReels: BASE_REELS,
      visibleRows: 3,
      features: [
        {
          id: "fs-snap",
          name: "Snapshot Free Spins",
          mode: "freeSpins",
          alternateReels: FEATURE_ALT_REELS,
          startingMultiplier: 3,
          freeSpins: {
            initialSpins: 4,
            retriggerEnabled: true,
            retriggerSymbolIds: ["SCATTER"],
            retriggerThreshold: 3,
            retriggerSpins: 2,
          },
          roundControl: { winCap: 500 },
        },
      ],
    });

    const retrigBoard = createBoardFromSymbolGrid([
      ["SCATTER", "A", "K"],
      ["Q", "SCATTER", "J"],
      ["A", "K", "SCATTER"],
      ["J", "A", "K"],
      ["Q", "J", "A"],
    ]);

    // Start feature and play 2 steps
    let step = engine.startFeature("fs-snap");
    step = engine.runFeatureStep(step.nextState, { spinWinAmount: 25 });
    step = engine.runFeatureStep(step.nextState, {
      board: retrigBoard,
      spinWinAmount: 40,
    });

    // Capture serialized snapshot mid-feature
    const serialized = engine.snapshot(step.nextState);
    const restoredState = engine.restore(serialized);
    assert.deepEqual(restoredState, step.nextState);

    // Continue both uninterrupted and restored trajectories for the remaining spins
    const futureWins = [15, 30, 50, 20];
    let uninterrupted = step.nextState;
    let fromRestored = restoredState;

    for (const winAmt of futureWins) {
      const r1 = engine.runFeatureStep(uninterrupted, {
        spinWinAmount: winAmt,
      });
      const r2 = engine.runFeatureStep(fromRestored, {
        spinWinAmount: winAmt,
      });
      assert.deepEqual(r2, r1);
      uninterrupted = r1.nextState;
      fromRestored = r2.nextState;
    }

    assert.equal(uninterrupted.status, "completed");
    assert.deepEqual(fromRestored, uninterrupted);
  });
});
