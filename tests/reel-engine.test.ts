import assert from "node:assert/strict";
import test from "node:test";

import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  EmptyReelError,
  InvalidReelCountError,
  InvalidReelResolutionError,
  InvalidReelWeightError,
  InvalidStopIndexError,
  InvalidVisibleRowCountError,
  type NormalizedReelStop,
  type NormalizedReelStrip,
  ShortReelStripError,
  UnknownSymbolReferenceError,
  ZeroWeightReelError,
  adaptBlueprintToGameConfig,
  createReelEngine,
  createSampleGameBlueprint,
  createSampleGameDefinition,
  createSeededRng,
  deserializeReelResolution,
  resolveSingleReel,
  serializeReelResolution,
  toGameConfig,
} from "../src/engine";

function makeTestReelStrip(
  symbolIds: readonly string[],
  options?: {
    readonly id?: string;
    readonly index?: number;
    readonly weights?: readonly number[];
    readonly height?: number;
  },
): NormalizedReelStrip {
  const id = options?.id ?? "reel-test-0";
  const index = options?.index ?? 0;
  const height = options?.height ?? 3;
  let cumulative = 0;

  const stops: NormalizedReelStop[] = symbolIds.map((symbolId, idx) => {
    const w = options?.weights ? options.weights[idx] : 1;
    cumulative += w > 0 ? w : 0;
    return Object.freeze({
      id: `${id}-stop-${idx + 1}`,
      position: idx + 1,
      stopIndex: idx,
      symbolId,
      weight: w,
      cumulativeWeight: cumulative,
    });
  });

  return Object.freeze({
    id,
    index,
    name: `Reel ${index + 1}`,
    height,
    stops: Object.freeze(stops),
    totalWeight: cumulative,
  });
}

test("B04.1 — Single-reel circular resolution (Tests 1, 2, 3, 12, 13, 14, 19) & duplicate/weighted stop semantics (Tests 4, 5, 6, 7)", () => {
  const strip5 = makeTestReelStrip(["A", "B", "C", "D", "E"]);

  // TEST 1 — SINGLE REEL: [A, B, C, D, E], rows = 3, selectedStop = 0 -> [A, B, C]
  const res0 = resolveSingleReel(strip5, {
    visibleRows: 3,
    selectedStopIndex: 0,
  });
  assert.equal(res0.selectedStopIndex, 0);
  assert.equal(res0.initialSelectedStopIndex, 0);
  assert.equal(res0.nudgeOffset, 0);
  assert.deepEqual(res0.visibleStopIndexes, [0, 1, 2]);
  assert.deepEqual(res0.visibleSymbolIds, ["A", "B", "C"]);
  assert.equal(res0.drawCount, 0);
  assert.equal(res0.rngStream, null);

  // TEST 2 — WRAPAROUND: selectedStop = 3 -> [D, E, A] (indexes [3, 4, 0])
  const res3 = resolveSingleReel(strip5, {
    visibleRows: 3,
    selectedStopIndex: 3,
  });
  assert.equal(res3.selectedStopIndex, 3);
  assert.deepEqual(res3.visibleStopIndexes, [3, 4, 0]);
  assert.deepEqual(res3.visibleSymbolIds, ["D", "E", "A"]);

  // TEST 3 — LAST STOP: selectedStop = 4 -> [E, A, B] (indexes [4, 0, 1])
  const res4 = resolveSingleReel(strip5, {
    visibleRows: 3,
    selectedStopIndex: 4,
  });
  assert.equal(res4.selectedStopIndex, 4);
  assert.deepEqual(res4.visibleStopIndexes, [4, 0, 1]);
  assert.deepEqual(res4.visibleSymbolIds, ["E", "A", "B"]);

  // TEST 19 — EDGE WRAP: visibleRows === strip.length (5 rows on a 5-stop strip)
  const edgeWrap = resolveSingleReel(strip5, {
    visibleRows: 5,
    selectedStopIndex: 3,
  });
  assert.deepEqual(edgeWrap.visibleStopIndexes, [3, 4, 0, 1, 2]);
  assert.deepEqual(edgeWrap.visibleSymbolIds, ["D", "E", "A", "B", "C"]);

  // Edge case: strip length = 1 with visibleRows = 1
  const strip1 = makeTestReelStrip(["ONLY"], { height: 1 });
  const resSingleStop = resolveSingleReel(strip1, {
    visibleRows: 1,
    selectedStopIndex: 0,
  });
  assert.deepEqual(resSingleStop.visibleStopIndexes, [0]);
  assert.deepEqual(resSingleStop.visibleSymbolIds, ["ONLY"]);

  // TEST 4 — DUPLICATE SYMBOLS: [A, A, B] has 3 distinct physical stops (never collapsed)
  const dupStrip = makeTestReelStrip(["A", "A", "B"], { height: 2 });
  assert.equal(dupStrip.stops.length, 3);
  const rngDup = createSeededRng("B04-duplicate-stops-seed");
  const stopHitCounts = [0, 0, 0];
  const topSymCounts: Record<string, number> = { A: 0, B: 0 };

  for (let i = 0; i < 900; i += 1) {
    const r = resolveSingleReel(dupStrip, {
      visibleRows: 2,
      useWeights: false,
      rng: rngDup,
    });
    stopHitCounts[r.selectedStopIndex] += 1;
    topSymCounts[r.visibleSymbolIds[0]] += 1;
  }
  // Each of the 3 physical stops (~300 hits) is hit independently; A is ~2/3 (~600), B is ~1/3 (~300)
  assert.ok(stopHitCounts[0] > 230 && stopHitCounts[0] < 370);
  assert.ok(stopHitCounts[1] > 230 && stopHitCounts[1] < 370);
  assert.ok(stopHitCounts[2] > 230 && stopHitCounts[2] < 370);
  assert.ok(topSymCounts.A > 520 && topSymCounts.A < 680);
  assert.ok(topSymCounts.B > 220 && topSymCounts.B < 380);

  // TEST 5 — WEIGHTED STOPS: A(weight 1), A(weight 3), B(weight 2)
  const weightedStrip = makeTestReelStrip(["A", "A", "B"], {
    weights: [1, 3, 2],
    height: 2,
  });
  const rngWeighted = createSeededRng("B04-weighted-stops-seed");
  const weightedStopHits = [0, 0, 0];
  for (let i = 0; i < 1200; i += 1) {
    const r = resolveSingleReel(weightedStrip, {
      visibleRows: 2,
      useWeights: true,
      rng: rngWeighted,
    });
    weightedStopHits[r.selectedStopIndex] += 1;
  }
  // Stop 0 (weight 1/6 ≈ 200), Stop 1 (weight 3/6 ≈ 600), Stop 2 (weight 2/6 ≈ 400)
  assert.ok(weightedStopHits[0] > 140 && weightedStopHits[0] < 260);
  assert.ok(weightedStopHits[1] > 510 && weightedStopHits[1] < 690);
  assert.ok(weightedStopHits[2] > 320 && weightedStopHits[2] < 480);

  // TEST 6 — ZERO WEIGHT: A(weight 0), B(weight 1), C(weight 2) -> A (stop 0) is NEVER selected
  const zeroWeightStrip = makeTestReelStrip(["A", "B", "C"], {
    weights: [0, 1, 2],
    height: 2,
  });
  const rngZero = createSeededRng("B04-zero-weight-seed");
  for (let i = 0; i < 500; i += 1) {
    const r = resolveSingleReel(zeroWeightStrip, {
      visibleRows: 2,
      useWeights: true,
      rng: rngZero,
    });
    assert.notEqual(r.selectedStopIndex, 0);
    assert.notEqual(r.visibleSymbolIds[0], "A");
  }

  // TEST 7 — ALL ZERO WEIGHTS: A(weight 0), B(weight 0) -> ZeroWeightReelError
  const allZeroStrip = makeTestReelStrip(["A", "B"], {
    weights: [0, 0],
    height: 1,
  });
  assert.throws(
    () =>
      resolveSingleReel(allZeroStrip, {
        visibleRows: 1,
        useWeights: true,
        rng: rngZero,
      }),
    (err: unknown) =>
      err instanceof ZeroWeightReelError && err.code === "ZERO_WEIGHT_REEL",
  );

  // Negative or NaN stop weight -> InvalidReelWeightError
  const negWeightStrip = makeTestReelStrip(["A", "B"], {
    weights: [-1, 2],
    height: 1,
  });
  assert.throws(
    () =>
      resolveSingleReel(negWeightStrip, {
        visibleRows: 1,
        useWeights: true,
        rng: rngZero,
      }),
    (err: unknown) =>
      err instanceof InvalidReelWeightError &&
      err.code === "INVALID_REEL_WEIGHT",
  );

  // TEST 12 — SHORT REEL: strip [A, B] with visibleRows = 3 -> ShortReelStripError
  const shortStrip = makeTestReelStrip(["A", "B"], { height: 3 });
  assert.throws(
    () =>
      resolveSingleReel(shortStrip, {
        visibleRows: 3,
        selectedStopIndex: 0,
      }),
    (err: unknown) =>
      err instanceof ShortReelStripError && err.code === "SHORT_REEL_STRIP",
  );

  // Empty reel -> EmptyReelError
  const emptyStrip = makeTestReelStrip([], { height: 3 });
  assert.throws(
    () =>
      resolveSingleReel(emptyStrip, {
        visibleRows: 3,
        selectedStopIndex: 0,
      }),
    (err: unknown) =>
      err instanceof EmptyReelError && err.code === "EMPTY_REEL",
  );

  // TEST 13 — INVALID STOP (999) & TEST 14 — INVALID NEGATIVE STOP (-1)
  assert.throws(
    () =>
      resolveSingleReel(strip5, {
        visibleRows: 3,
        selectedStopIndex: 999,
      }),
    (err: unknown) =>
      err instanceof InvalidStopIndexError &&
      err.code === "INVALID_STOP_INDEX",
  );
  assert.throws(
    () =>
      resolveSingleReel(strip5, {
        visibleRows: 3,
        selectedStopIndex: -1,
      }),
    (err: unknown) =>
      err instanceof InvalidStopIndexError &&
      err.code === "INVALID_STOP_INDEX",
  );

  // Unknown symbol reference on stop -> UnknownSymbolReferenceError
  assert.throws(
    () =>
      resolveSingleReel(strip5, {
        visibleRows: 3,
        selectedStopIndex: 0,
        validSymbolIds: new Set(["A", "B"]),
      }),
    (err: unknown) =>
      err instanceof UnknownSymbolReferenceError &&
      err.code === "INVALID_SYMBOL_REFERENCE",
  );

  // Invalid visibleRows -> InvalidVisibleRowCountError
  assert.throws(
    () =>
      resolveSingleReel(strip5, {
        visibleRows: 0,
        selectedStopIndex: 0,
      }),
    (err: unknown) =>
      err instanceof InvalidVisibleRowCountError &&
      err.code === "INVALID_VISIBLE_ROW_COUNT",
  );
});

test("B04.2 — Multi-reel resolution, explicit stop mode, board orientation & multi-grid support (Tests 8, 9, 10, 11, 15)", () => {
  const studioBp = createBlueprint({
    id: "b04-5x3-studio",
    title: "B04 Studio 5x3",
    theme: "Solar Dynasty",
    columns: 5,
    rows: 3,
  });
  const config = toGameConfig(studioBp);
  const reelEngine = createReelEngine();

  // TEST 8 — EXPLICIT STOPS: [3, 4, 0, 2, 7] without RNG
  const explicitStops = [3, 4, 0, 2, 7] as const;
  const explicitRes = reelEngine.resolveFromStops(config, explicitStops);

  assert.equal(explicitRes.mode, "explicit");
  assert.deepEqual(explicitRes.selectedStopIndexes, explicitStops);
  assert.deepEqual(
    explicitRes.reels.map((r) => r.selectedStopIndex),
    explicitStops,
  );
  for (let r = 0; r < 5; r += 1) {
    assert.equal(explicitRes.reels[r].rngStream, null);
    assert.equal(explicitRes.reels[r].drawCount, 0);
  }

  // TEST 9 — MULTI-REEL BOARD: reel 0 = leftmost, row 0 = top, every cell references exact physical stop
  const board = explicitRes.board;
  assert.equal(board.reelCount, 5);
  assert.equal(board.rowCount, 3);
  assert.equal(board.cells.length, 5);

  for (let reelIndex = 0; reelIndex < 5; reelIndex += 1) {
    const reelCfg = config.reels[reelIndex];
    const reelRes = explicitRes.reels[reelIndex];
    assert.equal(board.cells[reelIndex].length, 3);

    for (let rowIndex = 0; rowIndex < 3; rowIndex += 1) {
      const cell = board.cells[reelIndex][rowIndex];
      const expectedStopIdx =
        (explicitStops[reelIndex] + rowIndex) % reelCfg.stops.length;
      const expectedSymId = reelCfg.stops[expectedStopIdx].symbolId;

      assert.equal(cell.reelIndex, reelIndex);
      assert.equal(cell.rowIndex, rowIndex);
      assert.deepEqual(cell.position, { reelIndex, rowIndex });
      assert.equal(cell.stopIndex, expectedStopIdx);
      assert.equal(cell.symbolId, expectedSymId);
      assert.equal(cell.symbol.symbolId, expectedSymId);
      assert.equal(reelRes.visibleStopIndexes[rowIndex], expectedStopIdx);
      assert.equal(reelRes.visibleSymbolIds[rowIndex], expectedSymId);
    }
  }

  // TEST 10 — DETERMINISTIC RANDOM: same GameConfig + same seed => identical resolution & board
  const rngA = createSeededRng("B04-deterministic-spin-seed");
  const rngB = createSeededRng("B04-deterministic-spin-seed");
  const randResA = reelEngine.resolve(config, rngA);
  const randResB = reelEngine.resolve(config, rngB);

  assert.equal(randResA.mode, "random");
  assert.deepEqual(randResA.selectedStopIndexes, randResB.selectedStopIndexes);
  assert.deepEqual(randResA.reels, randResB.reels);
  assert.deepEqual(randResA.board, randResB.board);

  // Verify seed-based replay and explicit-stop replay converge on the exact same board!
  const replayExplicit = reelEngine.resolveFromStops(
    config,
    randResA.selectedStopIndexes,
  );
  assert.deepEqual(replayExplicit.board, randResA.board);

  // TEST 11 — DIFFERENT SEEDS produce distinct results across a deterministic fixture
  const rngC = createSeededRng("B04-different-spin-seed-99");
  const randResC = reelEngine.resolve(config, rngC);
  assert.notDeepEqual(
    randResA.selectedStopIndexes,
    randResC.selectedStopIndexes,
  );

  // Multi-grid & variable reel height support (6x4 grid + custom per-reel heights [3, 4, 5, 4, 3])
  const bp6x4 = createBlueprint({
    id: "b04-6x4-grid",
    title: "Six By Four",
    theme: "Space",
    columns: 6,
    rows: 4,
  });
  const cfg6x4 = adaptBlueprintToGameConfig(bp6x4);
  const res6x4 = reelEngine.resolve(cfg6x4, createSeededRng("b04-6x4-seed"));
  assert.equal(res6x4.board.reelCount, 6);
  assert.equal(res6x4.board.rowCount, 4);

  const varHeightRes = reelEngine.resolve(
    config,
    createSeededRng("b04-var-height"),
    { visibleRowCounts: [2, 3, 4, 3, 2] },
  );
  assert.deepEqual(
    varHeightRes.reels.map((r) => r.visibleRows),
    [2, 3, 4, 3, 2],
  );
  assert.deepEqual(varHeightRes.board.reelHeights, [2, 3, 4, 3, 2]);
  assert.equal(varHeightRes.board.cells[2].length, 4);

  // Also verify B02 sample game definition resolves cleanly
  const sampleDefConfig = toGameConfig(createSampleGameDefinition());
  const sampleDefRes = reelEngine.resolveFromStops(
    sampleDefConfig,
    [0, 1, 2, 3, 4],
  );
  assert.equal(sampleDefRes.board.reelCount, 5);
  assert.equal(sampleDefRes.board.rowCount, 3);

  // TEST 15 — REEL COUNT MISMATCH: grid 5 reels, configuration 4 reels -> InvalidReelCountError
  const mismatchedConfig = {
    ...config,
    reels: config.reels.slice(0, 4),
  };
  assert.throws(
    () => reelEngine.resolve(mismatchedConfig, createSeededRng("mismatch")),
    (err: unknown) =>
      err instanceof InvalidReelCountError &&
      err.code === "INVALID_REEL_COUNT",
  );
  assert.throws(
    () => reelEngine.resolveFromStops(config, [0, 1, 2]),
    (err: unknown) =>
      err instanceof InvalidReelCountError &&
      err.code === "INVALID_REEL_COUNT",
  );
  assert.throws(
    () =>
      reelEngine.resolve(
        undefined as unknown as typeof config,
        createSeededRng("undef"),
      ),
    (err: unknown) =>
      err instanceof InvalidReelResolutionError &&
      err.code === "INVALID_REEL_RESOLUTION",
  );
});

test("B04.3 — Serialization, immutability, B03 stream isolation, debug trace, and property invariants (Tests 16, 17, 18, 20)", () => {
  const sampleBp = createSampleGameBlueprint();
  const config = adaptBlueprintToGameConfig(sampleBp);
  const configSnapshotBefore = JSON.stringify(
    config.reels.map((r) => r.stops),
  );
  const reelEngine = createReelEngine();

  // TEST 16 — SERIALIZATION: serialize & deserialize ReelResolution with exact structural equality
  const rng = createSeededRng("B04-serialization-seed");
  const resolution = reelEngine.resolve(config, rng);
  const json = serializeReelResolution(resolution);
  const deserialized = deserializeReelResolution(json);
  assert.deepEqual(deserialized, resolution);

  // TEST 17 — NO INPUT MUTATION: config and reel strips remain untouched and deep-frozen
  assert.equal(
    JSON.stringify(config.reels.map((r) => r.stops)),
    configSnapshotBefore,
  );
  assert.equal(Object.isFrozen(resolution), true);
  assert.equal(Object.isFrozen(resolution.reels), true);
  assert.equal(Object.isFrozen(resolution.board), true);

  // TEST 18 — STREAM ISOLATION: unrelated random draws on root or sibling streams never change reel outcomes
  const rootClean = createSeededRng("B04-stream-isolation-seed");
  const rootNoisy = createSeededRng("B04-stream-isolation-seed");

  // Consume 250 draws on rootNoisy and a sibling "features" stream before resolving reels
  const noisyFeatures = rootNoisy.fork("features");
  for (let i = 0; i < 250; i += 1) {
    rootNoisy.nextUint32();
    noisyFeatures.nextFloat();
  }

  const cleanReelRes = reelEngine.resolve(config, rootClean);
  const noisyReelRes = reelEngine.resolve(config, rootNoisy);

  assert.deepEqual(
    cleanReelRes.selectedStopIndexes,
    noisyReelRes.selectedStopIndexes,
  );
  assert.deepEqual(cleanReelRes.board, noisyReelRes.board);
  assert.deepEqual(
    cleanReelRes.reels.map((r) => r.rngStream),
    [
      "root/reels/reel-0",
      "root/reels/reel-1",
      "root/reels/reel-2",
      "root/reels/reel-3",
      "root/reels/reel-4",
    ],
  );

  // TEST 20 — DEBUG TRACE: enabling trace generates structured trace without altering result or RNG state
  const rngUntraced = createSeededRng("B04-trace-test-seed");
  const rngTraced = createSeededRng("B04-trace-test-seed");

  const untracedRes = reelEngine.resolve(config, rngUntraced, { trace: false });
  const tracedRes = reelEngine.resolve(config, rngTraced, { trace: true });

  assert.equal(untracedRes.trace, undefined);
  assert.ok(Array.isArray(tracedRes.trace));
  assert.equal(tracedRes.trace.length, 5);
  assert.deepEqual(
    tracedRes.selectedStopIndexes,
    untracedRes.selectedStopIndexes,
  );
  assert.deepEqual(tracedRes.board, untracedRes.board);
  assert.deepEqual(rngTraced.snapshot(), rngUntraced.snapshot());

  // PROPERTY-STYLE INVARIANT TESTS across 100 spins
  for (let spinIdx = 0; spinIdx < 100; spinIdx += 1) {
    const spinRng = createSeededRng(`B04-invariant-spin-${spinIdx}`);
    const res = reelEngine.resolve(config, spinRng);

    assert.equal(res.reels.length, config.grid.columns);
    assert.equal(res.board.reelCount, config.grid.columns);
    assert.equal(res.board.rowCount, config.grid.rows);

    for (let r = 0; r < config.grid.columns; r += 1) {
      const reelCfg = config.reels[r];
      const reelResult = res.reels[r];
      const stripLen = reelCfg.stops.length;
      const expectedRows = config.grid.rows;

      assert.ok(
        reelResult.selectedStopIndex >= 0 &&
          reelResult.selectedStopIndex < stripLen,
      );
      assert.equal(reelResult.visibleStopIndexes.length, expectedRows);
      assert.equal(reelResult.visibleSymbolIds.length, expectedRows);

      for (let row = 0; row < expectedRows; row += 1) {
        const stopIdx = reelResult.visibleStopIndexes[row];
        const symId = reelResult.visibleSymbolIds[row];
        assert.ok(stopIdx >= 0 && stopIdx < stripLen);
        assert.equal(
          stopIdx,
          (reelResult.selectedStopIndex + row) % stripLen,
        );
        assert.equal(symId, reelCfg.stops[stopIdx].symbolId);
        assert.equal( config.symbolsById.has(symId), true);
        assert.equal(res.board.cells[r][row].symbolId, symId);
        assert.equal(res.board.cells[r][row].stopIndex, stopIdx);
      }
    }
  }
});
