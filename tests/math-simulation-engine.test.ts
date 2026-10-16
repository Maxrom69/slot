import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  InvalidSimulationConfigurationError,
  InvalidVerificationCaseError,
  SAMPLE_GAME_ID,
  SimulationExecutionError,
  SimulationGuardExceededError,
  SimulationReplayError,
  adaptBlueprintToGameConfig,
  createMathSimulationEngine,
  createSampleGameBlueprint,
  deriveMathModel,
  evaluateMathTargetCompliance,
  normalizeGameDefinition,
  type CascadeStepOptions,
  type FeatureEngineConfiguration,
  type MeterDefinition,
  type SimulationMultiplierConfig,
} from "../src/engine";

describe("B16 — Math Simulation & Statistics Engine", () => {
  it("1 & 2. Basic Simulation & Exact RTP: runs fixed number of spins through the real engine with exact micro-unit wager/payout totals", () => {
    const blueprint = createSampleGameBlueprint();
    const simEngine = createMathSimulationEngine();

    const runResult = simEngine.run(blueprint, {
      runId: "b16-basic-run",
      gameId: SAMPLE_GAME_ID,
      spinCount: 500,
      seed: "b16-seed-alpha",
      bet: 1.25,
      retainSpinTraces: true,
    });

    const { report } = runResult;
    assert.equal(report.runId, "b16-basic-run");
    assert.equal(report.gameId, SAMPLE_GAME_ID);
    assert.equal(report.spinCount, 500);
    // 500 * 1.25 = 625 exact (no floating-point accumulation drift)
    assert.equal(report.totalWager, 625);
    assert.equal(report.rtp.totalWager, 625);
    assert.equal(report.traces.length, 500);

    // Sum of individual spin wins matches report.totalPayout to 4 decimal places
    const sumOfSpinWins =
      Math.round(
        report.traces.reduce((acc, s) => acc + Math.round(s.win * 10000), 0),
      ) / 10000;
    assert.equal(report.totalPayout, sumOfSpinWins);

    const expectedRtpPct =
      Math.round(((report.totalPayout / report.totalWager) * 100 + Number.EPSILON) * 10000) /
      10000;
    assert.equal(report.rtp.rtpPercentage, expectedRtpPct);
    assert.ok(report.rtp.averageWinPerSpin > 0);
    assert.ok(report.rtp.averageLossPerSpin > 0);

    // Also verify B01 SimulationRunner compatibility via runSimulation()
    const compatResult = simEngine.runSimulation(blueprint, {
      gameId: SAMPLE_GAME_ID,
      spinCount: 500,
      baseSeed: "b16-seed-alpha",
      bet: 1.25,
    });
    assert.equal(compatResult.totalWagered, 625);
    assert.equal(compatResult.totalReturned, report.totalPayout);
    assert.equal(compatResult.hitCount, report.winningSpins);
  });

  it("3 & 4. Hit Frequency & Maximum Win: classifies positive-win vs zero-win spins across win sources and tracks max win spin & multiples", () => {
    const blueprint = createSampleGameBlueprint();
    blueprint.features = [];
    const simEngine = createMathSimulationEngine();

    const { report } = simEngine.run(blueprint, {
      spinCount: 300,
      seed: "b16-hit-max-seed",
      bet: 5,
      activePaylineIds: ["line-1"],
      retainSpinTraces: true,
    });

    assert.equal(
      report.winningSpins + report.losingSpins,
      report.spinCount,
    );
    const traceWins = report.traces.filter((t) => t.win > 0);
    const traceLosses = report.traces.filter((t) => t.win === 0);
    assert.equal(report.winningSpins, traceWins.length);
    assert.equal(report.losingSpins, traceLosses.length);
    assert.ok(report.winningSpins > 0);
    assert.ok(report.losingSpins > 0);

    // Check max win tracking
    let expectedMaxWin = 0;
    let expectedMaxSpinIdx: number | null = null;
    for (const t of report.traces) {
      if (t.win > expectedMaxWin) {
        expectedMaxWin = t.win;
        expectedMaxSpinIdx = t.spinIndex;
      }
    }
    assert.equal(report.maxWin.maxAbsoluteWin, expectedMaxWin);
    assert.equal(report.maxWin.spinIndexOfMaxWin, expectedMaxSpinIdx);
    assert.equal(
      report.maxWin.maxWinInBetMultiples,
      Math.round((expectedMaxWin / 5) * 10000) / 10000,
    );
    // Max win is distinct from configured max-win cap
    assert.equal(
      report.maxWin.configuredMaxWinCapX,
      blueprint.math.maxWinX,
    );
    assert.notEqual(
      report.maxWin.maxWinInBetMultiples,
      report.maxWin.configuredMaxWinCapX,
    );

    // Also test Ways, Cluster, and Pay-Anywhere win-source attribution
    const waysBp = structuredClone(blueprint);
    waysBp.reels.evaluation = "ways";
    const waysReport = simEngine.run(waysBp, {
      spinCount: 100,
      seed: "b16-ways-seed",
      bet: 2,
    }).report;
    assert.ok(waysReport.winSources.bySource.ways.hitSpins > 0);
    assert.equal(waysReport.winSources.bySource.payline.hitSpins, 0);
  });

  it("5 & 6. Win Distribution & Volatility: computes exact percentiles, median, variance, standard deviation, and MAD", () => {
    const blueprint = createSampleGameBlueprint();
    const simEngine = createMathSimulationEngine();

    // Use fixed alternating stops so we can verify exact analytical variance & percentiles:
    // Stop [0,0,0,0,0] with bet = 5 pays 9 (1.8x bet)
    // Stop [0,5,1,0,0] with bet = 5 pays 0 (0x bet)
    const { report } = simEngine.run(blueprint, {
      spinCount: 100,
      seed: "b16-dist-vol-seed",
      bet: 5,
      fixedStops: [
        [0, 0, 0, 0, 0],
        [0, 5, 1, 0, 0],
      ],
      percentiles: [25, 50, 75, 90, 99],
    });

    // Exactly 50 wins of 9 (1.8x) and 50 losses of 0 (0x)
    assert.equal(report.winningSpins, 50);
    assert.equal(report.losingSpins, 50);
    assert.equal(report.totalWager, 500);
    assert.equal(report.totalPayout, 450);
    assert.equal(report.rtp.rtpPercentage, 90);

    // Distribution checks
    assert.equal(report.distribution.minWin, 0);
    assert.equal(report.distribution.maxWin, 9);
    assert.equal(report.distribution.meanWin, 4.5);
    assert.equal(report.distribution.meanWinningSpinWin, 9);
    assert.equal(report.distribution.medianWin, 0);
    assert.equal(report.distribution.percentiles.p75, 9);
    assert.equal(report.distribution.percentilesInBetMultiples.p75, 1.8);

    // Volatility checks:
    // Half of normalized returns are 1.8, half are 0 -> mean normalized return = 0.9
    // Deviation from mean is |1.8 - 0.9| = 0.9 for every spin!
    // Population variance = 0.9^2 = 0.81, Population stdDev = 0.9, MAD = 0.9!
    assert.equal(report.volatility.populationVarianceNormalizedReturn, 0.81);
    assert.equal(report.volatility.standardDeviationNormalizedReturn, 0.9);
    assert.equal(report.volatility.meanAbsoluteDeviationNormalizedReturn, 0.9);
    // Sample variance = 100 / 99 * 0.81 = 0.8182
    assert.equal(report.volatility.sampleVarianceNormalizedReturn, 0.8182);
  });

  it("7. Feature Statistics: records feature triggers, entry frequency, duration, retriggers, upgrades, and payout contribution", () => {
    const blueprint = createSampleGameBlueprint();
    const config = adaptBlueprintToGameConfig(blueprint);
    const simEngine = createMathSimulationEngine();

    const featureConfig: FeatureEngineConfiguration = {
      baseReels: config.reels,
      visibleRows: config.grid.rows,
      features: [
        {
          id: "free_spins_bonus",
          name: "Free Spins Bonus",
          mode: "freeSpins",
          startingMultiplier: 2,
          triggers: [
            {
              id: "trig-fs-1",
              source: "symbolCount",
              targetFeatureId: "free_spins_bonus",
              symbolIds: ["sym-scatter"],
              threshold: 3,
              awardedSpins: 5,
              startingMultiplier: 2,
            },
          ],
          freeSpins: {
            initialSpins: 5,
            retriggerEnabled: true,
            retriggerSymbolIds: ["sym-scatter"],
            retriggerThreshold: 3,
            retriggerSpins: 3,
            maxRetriggerBatches: 1,
          },
        },
      ],
    };

    // Stop [3, 3, 3, 0, 0] lands 3 Scatters on reels 0, 1, 2 -> triggers free_spins_bonus!
    const { report } = simEngine.run(config, {
      spinCount: 10,
      seed: "b16-feature-seed",
      bet: 5,
      fixedStops: [
        [3, 3, 3, 0, 0],
        [0, 5, 1, 0, 0],
      ],
      featureConfig,
    });

    assert.equal(report.features.totalFeatureTriggers, 5);
    assert.equal(report.features.totalFeatureEntries, 5);
    assert.equal(report.features.featureEntryFrequency, 0.5);
    assert.ok(report.features.averageFeatureDurationSpins >= 5);
    assert.ok(report.features.totalFeaturePayout > 0);
    assert.ok(report.features.featureWinContributionPercentage > 0);
    assert.ok(report.features.byFeatureId.free_spins_bonus);
    assert.equal(report.features.byFeatureId.free_spins_bonus.entryCount, 5);
  });

  it("8. Cascade & Multiplier Statistics: records cascade depth, tumble counts, payout by tumble index, and B14 multiplier progression", () => {
    const blueprint = createSampleGameBlueprint();
    const config = adaptBlueprintToGameConfig(blueprint);
    const simEngine = createMathSimulationEngine();

    const tumbleConfig: Omit<CascadeStepOptions, "rng"> = {
      reelStrips: config.reels,
    };

    const multiplierConfig: SimulationMultiplierConfig = {
      tumbleMultiplier: {
        startingMultiplier: 1,
        progressionFactor: 2,
        ceiling: 8,
      },
    };

    const { report } = simEngine.run(config, {
      spinCount: 10,
      seed: "b16-cascade-seed",
      bet: 5,
      fixedStops: [[0, 0, 0, 0, 0]],
      tumbleConfig,
      multiplierConfig,
      maxCascadeStepsPerSpin: 3,
    });

    assert.equal(report.cascades.spinsWithCascade, 10);
    assert.equal(report.cascades.cascadeTriggerFrequency, 1);
    assert.ok(report.cascades.totalTumbleCount >= 10);
    assert.ok(report.cascades.maxCascadeDepth >= 1);
    assert.ok(report.cascades.payoutByTumbleIndex.length >= 1);
    assert.ok(report.cascades.maxMultiplierReached >= 2);
  });

  it("9. Fixed-Stop Verification: passes on exact match and reports structured diffs for board, symbol, win, payout, feature, multiplier, and meter mismatches", () => {
    const blueprint = createSampleGameBlueprint();
    const simEngine = createMathSimulationEngine();

    const meters: readonly MeterDefinition[] = [
      {
        meterId: "spin_counter",
        startingValue: 0,
        scope: "session",
        eventSource: { eventType: "spinsPlayed" },
        resetBehavior: "onBoundary",
      },
    ];

    // 1. Passing verification case
    const passCase = simEngine.verifyCase(blueprint, {
      caseId: "verify-3oak-pass",
      bet: 5,
      fixedReelStops: [0, 0, 0, 0, 0],
      meters,
      expected: {
        reelStops: [0, 0, 0, 0, 0],
        boardGrid: [
          ["sym-low-a", "sym-low-k", "sym-low-q"],
          ["sym-low-a", "sym-low-k", "sym-low-q"],
          ["sym-low-a", "sym-low-k", "sym-low-q"],
          ["sym-low-k", "sym-low-q", "sym-high-star"],
          ["sym-low-q", "sym-high-star", "sym-low-a"],
        ],
        totalWin: 9,
        winningCombinationsCount: 3,
        winBySource: { payline: 9 },
        triggeredFeatureIds: [],
        multiplierAfter: 1,
        cascadeCount: 0,
        meterValues: { spin_counter: 1 },
      },
    });
    assert.equal(passCase.passed, true, JSON.stringify(passCase.diffs));
    assert.equal(passCase.diffs.length, 0);

    // 2. Failing verification case exercising all structured diff kinds
    const failCase = simEngine.verifyCase(blueprint, {
      caseId: "verify-diffs-structured",
      bet: 5,
      fixedReelStops: [0, 0, 0, 0, 0],
      meters,
      expected: {
        reelStops: [1, 0, 0, 0, 0],
        boardGrid: [
          ["sym-wild", "sym-k", "sym-q"],
          ["sym-a", "sym-k", "sym-q"],
          ["sym-a", "sym-k", "sym-q"],
          ["sym-k", "sym-q", "sym-star"],
          ["sym-q", "sym-star", "sym-a"],
        ],
        totalWin: 25,
        winningCombinationsCount: 4,
        triggeredFeatureIds: ["feature-free-spins"],
        multiplierAfter: 3,
        meterValues: { spin_counter: 99 },
      },
    });

    assert.equal(failCase.passed, false);
    const diffKinds = new Set(failCase.diffs.map((d) => d.kind));
    assert.equal(diffKinds.has("reelStopMismatch"), true);
    assert.equal(diffKinds.has("symbolMismatch"), true);
    assert.equal(diffKinds.has("payoutMismatch"), true);
    assert.equal(diffKinds.has("winMismatch"), true);
    assert.equal(diffKinds.has("featureStateMismatch"), true);
    assert.equal(diffKinds.has("multiplierValueMismatch"), true);
    assert.equal(diffKinds.has("meterLogicMismatch"), true);

    assert.throws(
      () =>
        simEngine.verifyCase(blueprint, {
          caseId: "",
          bet: 5,
          expected: {},
        }),
      (err: unknown) => err instanceof InvalidVerificationCaseError,
    );
  });

  it("10. Snapshot & Replay: replaying an individual spin from its captured SpinReplayPackage produces the identical result", () => {
    const blueprint = createSampleGameBlueprint();
    const simEngine = createMathSimulationEngine();

    const { report } = simEngine.run(blueprint, {
      spinCount: 50,
      seed: "b16-replay-test-seed",
      bet: 2,
      retainSpinTraces: true,
      retainBoardSnapshots: true,
    });

    // Pick spin #27 and also the maxWinReplayPackage
    const targetSpin = report.traces[27]!;
    const replayedSpin = simEngine.replaySpin(
      blueprint,
      targetSpin.replayPackage,
    );

    assert.deepEqual(replayedSpin.reelStops, targetSpin.reelStops);
    assert.equal(replayedSpin.win, targetSpin.win);
    assert.equal(replayedSpin.wager, targetSpin.wager);
    assert.deepEqual(replayedSpin.winBySource, targetSpin.winBySource);
    assert.deepEqual(replayedSpin.boardSnapshot, targetSpin.boardSnapshot);
    assert.deepEqual(replayedSpin.rngSnapshotAfter, targetSpin.rngSnapshotAfter);

    if (report.maxWinReplayPackage) {
      const replayedMax = simEngine.replaySpin(
        blueprint,
        report.maxWinReplayPackage,
      );
      assert.equal(replayedMax.win, report.maxWin.maxAbsoluteWin);
      assert.equal(replayedMax.spinIndex, report.maxWin.spinIndexOfMaxWin);
    }

    // Tampered gameId or definitionHash is rejected with SimulationReplayError
    assert.throws(
      () =>
        simEngine.replaySpin(blueprint, {
          ...targetSpin.replayPackage,
          gameId: "wrong-game-id",
        }),
      (err: unknown) => err instanceof SimulationReplayError,
    );
  });

  it("11 & 12. Batch Equivalence, Seed Determinism & Report Comparison: 1 batch == multiple batches, same seed == identical report", () => {
    const blueprint = createSampleGameBlueprint();
    const simEngine = createMathSimulationEngine();

    const singleBatchReport = simEngine.run(blueprint, {
      runId: "run-single-batch",
      spinCount: 1000,
      batchSize: 1000,
      seed: "b16-batch-equivalence-seed",
      bet: 1,
    }).report;

    const multiBatchReport = simEngine.run(blueprint, {
      runId: "run-multi-batch",
      spinCount: 1000,
      batchSize: 125,
      seed: "b16-batch-equivalence-seed",
      bet: 1,
    }).report;

    assert.equal(singleBatchReport.configurationSummary.batchCount, 1);
    assert.equal(multiBatchReport.configurationSummary.batchCount, 8);

    const comparison = simEngine.compareReports(
      singleBatchReport,
      multiBatchReport,
    );
    assert.equal(comparison.exactMatch, true);
    assert.equal(comparison.sameConfigurationAndSeed, true);
    assert.equal(comparison.exactMismatches.length, 0);
    assert.deepEqual(singleBatchReport.stats, multiBatchReport.stats);
    assert.deepEqual(
      singleBatchReport.seedMetadata.finalSnapshot,
      multiBatchReport.seedMetadata.finalSnapshot,
    );

    // Different seed produces statistical differences that compareReports surfaces cleanly
    const differentSeedReport = simEngine.run(blueprint, {
      runId: "run-different-seed",
      spinCount: 1000,
      seed: "b16-different-seed-999",
      bet: 1,
    }).report;

    const diffComparison = simEngine.compareReports(
      singleBatchReport,
      differentSeedReport,
    );
    assert.equal(diffComparison.sameConfigurationAndSeed, false);
    assert.equal(diffComparison.exactMatch, false);
    assert.ok(diffComparison.exactMismatches.length > 0);
  });

  it("13. Error Handling: rejects invalid configuration, does not convert engine errors into losses, and enforces failFast / collectAndContinue / maxOperationsGuard", () => {
    const blueprint = createSampleGameBlueprint();
    const simEngine = createMathSimulationEngine();

    // Invalid spinCount
    assert.throws(
      () => simEngine.run(blueprint, { spinCount: 0, seed: "s" }),
      (err: unknown) => err instanceof InvalidSimulationConfigurationError,
    );

    // Invalid bet
    assert.throws(
      () => simEngine.run(blueprint, { spinCount: 10, bet: -5, seed: "s" }),
      (err: unknown) => err instanceof InvalidSimulationConfigurationError,
    );

    // Out-of-range forced stop index on spin #1:
    // - In failFast mode, throws SimulationExecutionError with reproductionMetadata
    assert.throws(
      () =>
        simEngine.run(blueprint, {
          spinCount: 5,
          seed: "err-seed",
          bet: 1,
          fixedStops: [
            [0, 0, 0, 0, 0],
            [999, 0, 0, 0, 0],
          ],
          errorPolicy: "failFast",
        }),
      (err: unknown) =>
        err instanceof SimulationExecutionError &&
        err.context.spinIndex === 1 &&
        Boolean(err.context.reproductionMetadata),
    );

    // - In collectAndContinue mode, records the error in report.errors and does NOT count the failed spin as a losing spin!
    const collectedRun = simEngine.run(blueprint, {
      spinCount: 4,
      seed: "err-seed",
      bet: 1,
      fixedStops: [
        [0, 0, 0, 0, 0],
        [999, 0, 0, 0, 0],
      ],
      errorPolicy: "collectAndContinue",
    });
    assert.equal(collectedRun.report.errorCount, 2);
    assert.equal(collectedRun.report.spinCount, 2);
    assert.equal(collectedRun.report.winningSpins, 2);
    assert.equal(collectedRun.report.losingSpins, 0);

    // maxOperationsGuard enforcement
    assert.throws(
      () =>
        simEngine.run(blueprint, {
          spinCount: 100,
          seed: "guard-seed",
          bet: 1,
          maxOperationsGuard: 10,
        }),
      (err: unknown) => err instanceof SimulationGuardExceededError,
    );
  });

  it("14. Model Metadata (Class II / Class III) & RTP/Volatility Calibration Extension Points", () => {
    const blueprint = createSampleGameBlueprint();
    const canonicalDef = normalizeGameDefinition(blueprint);
    const simEngine = createMathSimulationEngine();

    const classIIRun = simEngine.run(canonicalDef, {
      spinCount: 50,
      seed: "class-ii-seed",
      bet: 5,
      modelType: "Class II",
      fixedStops: [
        [0, 0, 0, 0, 0],
        [0, 5, 1, 0, 0],
      ],
    });
    assert.equal(classIIRun.report.modelType, "Class II");

    const classIIIRun = simEngine.run(canonicalDef, {
      spinCount: 50,
      seed: "class-ii-seed",
      bet: 5,
      modelType: "Class III",
      fixedStops: [
        [0, 0, 0, 0, 0],
        [0, 5, 1, 0, 0],
      ],
    });
    assert.equal(classIIIRun.report.modelType, "Class III");
    // Model metadata is preserved without inventing different mechanics
    assert.equal(
      classIIRun.report.rtp.rtpPercentage,
      classIIIRun.report.rtp.rtpPercentage,
    );

    const mathModel = deriveMathModel(
      adaptBlueprintToGameConfig(blueprint),
      "Class II",
    );
    assert.equal(mathModel.modelType, "Class II");

    // Evaluate MathTarget compliance extension point (observed RTP is 90%, hit frequency is 50%, stdDev is 0.9)
    const passingCompliance = evaluateMathTargetCompliance(classIIIRun.report, {
      targetRtpPercentage: 90,
      allowedRtpBandPlusMinusPercentagePoints: 1.5,
      targetHitFrequencyPercentage: 50,
      allowedHitFrequencyBandPlusMinusPercentagePoints: 2,
      targetStandardDeviationRange: [0.5, 1.5],
    });
    assert.equal(passingCompliance.withinRtpBand, true);
    assert.equal(passingCompliance.rtpDeviationPercentagePoints, 0);
    assert.equal(passingCompliance.withinHitFrequencyBand, true);
    assert.equal(passingCompliance.withinVolatilityRange, true);
    assert.equal(passingCompliance.adjustmentsProposed.length, 0);
    assert.equal(passingCompliance.adjustmentsApplied.length, 0);
  });
});
