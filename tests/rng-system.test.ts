import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_RNG_ALGORITHM_ID,
   DEFAULT_RNG_ALGORITHM_VERSION,
  EmptySelectionError,
  InvalidProbabilityError,
  InvalidRangeError,
  InvalidRngStateError,
  InvalidSeedError,
  InvalidWeightError,
  SAMPLE_GAME_ID,
  SeededRNG,
  UnsupportedRngAlgorithmError,
  ZeroTotalWeightError,
  createEngineFromBlueprint,
  createRandomSource,
  createRngFromReplayInput,
  createSampleGameBlueprint,
  createSeededRng,
  deriveSeed,
  deserializeRngState,
  normalizeSeed,
  serializeRngState,
} from "../src/engine";

test("B03.1 — Fixed-seed determinism, seed normalization, and algorithm versioning", () => {
  // 1. Fixed-seed deterministic vector test ("B03-test-seed")
  const rng = createSeededRng("B03-test-seed");
  assert.equal(rng.algorithm, DEFAULT_RNG_ALGORITHM_ID);
  assert.equal(rng.algorithmName, "mulberry32");
  assert.equal(rng.algorithmVersion, DEFAULT_RNG_ALGORITHM_VERSION);
  assert.equal(rng.getDrawCount(), 0);

  const uints = Array.from({ length: 10 }, () => rng.nextUint32());
  const floats = Array.from({ length: 10 }, () => rng.nextFloat());
  const ints = Array.from({ length: 10 }, () => rng.nextInt(0, 100));

  assert.deepEqual(uints, [
    1528678011,
    1824278341,
    1082710365,
    3308721325,
    3270308546,
    1295612987,
    2421685189,
    310286686,
    28981704,
    592114879,
  ]);

  assert.deepEqual(floats, [
    0.7398834084160626,
    0.7819810395594686,
    0.21114825806580484,
    0.25328171090222895,
    0.47603055415675044,
    0.6708778813481331,
    0.2171276321168989,
    0.7759751931298524,
    0.00025180634111166,
    0.28295475780032575,
  ]);

  assert.deepEqual(ints, [16, 11, 9, 47, 17, 78, 98, 62, 73, 0]);
  assert.equal(rng.getDrawCount(), 30);

  // Re-running with the same seed reproduces the exact 30 values
  const rngRepeat = createSeededRng("B03-test-seed");
  assert.deepEqual(
    Array.from({ length: 10 }, () => rngRepeat.nextUint32()),
    uints,
  );
  assert.deepEqual(
    Array.from({ length: 10 }, () => rngRepeat.nextFloat()),
    floats,
  );
  assert.deepEqual(
    Array.from({ length: 10 }, () => rngRepeat.nextInt(0, 100)),
    ints,
  );

  // 2. Different seeds produce distinct sequences
  const rngOther = createSeededRng("B03-other-seed");
  const otherUints = Array.from({ length: 10 }, () => rngOther.nextUint32());
  assert.notDeepEqual(uints, otherUints);

  // 3. Seed normalization across string, number, -0/0, Uint8Array, and number[]
  const normStr1 = normalizeSeed("alpha-seed");
  const normStr2 = normalizeSeed("alpha-seed");
  assert.deepEqual(normStr1, normStr2);

  const normZeroPos = normalizeSeed(0);
  const normZeroNeg = normalizeSeed(-0);
  assert.deepEqual(normZeroPos, normZeroNeg);

  const normBytes1 = normalizeSeed(new Uint8Array([1, 2, 3, 4]));
  const normBytes2 = normalizeSeed([1, 2, 3, 4]);
  assert.deepEqual(normBytes1, normBytes2);

  // 4. Invalid seeds are rejected with InvalidSeedError
  for (const badSeed of [
    "",
    "    ",
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    [],
    new Uint8Array(0),
    [1, Number.NaN],
    null as unknown as string,
    undefined as unknown as string,
  ]) {
    assert.throws(
      () => normalizeSeed(badSeed),
      (err: unknown) =>
        err instanceof InvalidSeedError && err.code === "INVALID_SEED",
    );
  }

  // 5. Versioned sfc32-v1 algorithm support & unsupported algorithm rejection
  const sfcA = createRandomSource({
    seed: "B03-sfc32-seed",
    algorithm: "sfc32",
    algorithmVersion: 1,
  });
  const sfcB = createRandomSource({
    seed: "B03-sfc32-seed",
    algorithm: "sfc32-v1",
  });
  assert.equal(sfcA.algorithm, "sfc32-v1");
  const sfcSeqA = Array.from({ length: 10 }, () => sfcA.nextUint32());
  const sfcSeqB = Array.from({ length: 10 }, () => sfcB.nextUint32());
  assert.deepEqual(sfcSeqA, sfcSeqB);

  assert.throws(
    () =>
      createRandomSource({
        seed: "B03-test-seed",
        algorithm: "unknown-prng" as "mulberry32",
      }),
    (err: unknown) =>
      err instanceof UnsupportedRngAlgorithmError &&
      err.code === "UNSUPPORTED_RNG_ALGORITHM",
  );
  assert.throws(
    () =>
      createRandomSource({
        seed: "B03-test-seed",
        algorithm: "mulberry32",
        algorithmVersion: 99,
      }),
    (err: unknown) =>
      err instanceof UnsupportedRngAlgorithmError &&
      err.code === "UNSUPPORTED_RNG_ALGORITHM",
  );
});

test("B03.2 — Bounded integer unbiased rejection sampling, float bounds, boolean, and uniform array pick", () => {
  const rng = createSeededRng("B03-bounds-and-pick-seed");

  // 1. nextFloat bounds [0, 1)
  for (let i = 0; i < 2000; i += 1) {
    const f = rng.nextFloat();
    assert.ok(f >= 0 && f < 1, `Expected float in [0, 1), got ${f}`);
  }

  // 2. Bounded integer tests: nextInt(0, 1), (0, 2), (0, 10), (0, 100), (0, 1000), (-25, 25), and large ranges
  for (let i = 0; i < 100; i += 1) {
    assert.equal(rng.nextInt(0, 1), 0);
    const b2 = rng.nextInt(0, 2);
    assert.ok(b2 === 0 || b2 === 1);
    const b10 = rng.nextInt(0, 10);
    assert.ok(Number.isInteger(b10) && b10 >= 0 && b10 < 10);
    const b100 = rng.nextInt(0, 100);
    assert.ok(Number.isInteger(b100) && b100 >= 0 && b100 < 100);
    const b1000 = rng.nextInt(0, 1000);
    assert.ok(Number.isInteger(b1000) && b1000 >= 0 && b1000 < 1000);
    const negPos = rng.nextInt(-25, 25);
    assert.ok(Number.isInteger(negPos) && negPos >= -25 && negPos < 25);
    const largeRange = rng.nextInt(0, 3_000_000_000);
    assert.ok(
      Number.isInteger(largeRange) &&
        largeRange >= 0 &&
        largeRange < 3_000_000_000,
    );
  }

  // Full 2^32 span
  const fullSpanVal = rng.nextInt(0, 0x100000000);
  assert.ok(fullSpanVal >= 0 && fullSpanVal < 0x100000000);

  // Statistical sanity check across 5 buckets
  const counts = [0, 0, 0, 0, 0];
  for (let i = 0; i < 5000; i += 1) {
    counts[rng.nextInt(0, 5)] += 1;
  }
  for (const c of counts) {
    assert.ok(c > 850 && c < 1150, `Expected ~1000 per bucket, got ${c}`);
  }

  // Invalid integer ranges throw InvalidRangeError
  for (const badArgs of [
    [0],
    [-5],
    [1.5],
    [Number.NaN],
    [5, 5],
    [10, 5],
    [0, 1.5],
    [0, 0x100000001],
  ] as const) {
    assert.throws(
      () =>
        badArgs.length === 1
          ? rng.nextInt(badArgs[0])
          : rng.nextInt(badArgs[0], badArgs[1]),
      (err: unknown) =>
        err instanceof InvalidRangeError && err.code === "INVALID_RANGE",
    );
  }

  // 3. nextBoolean() and nextBoolean(probability)
  for (let i = 0; i < 100; i += 1) {
    assert.equal(rng.nextBoolean(0), false);
    assert.equal(rng.nextBoolean(1), true);
    assert.equal(typeof rng.nextBoolean(), "boolean");
  }

  for (const badProb of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => rng.nextBoolean(badProb),
      (err: unknown) =>
        err instanceof InvalidProbabilityError &&
        err.code === "INVALID_PROBABILITY",
    );
  }

  // 4. pick(items)
  const single = ["ONLY_ITEM"] as const;
  for (let i = 0; i < 20; i += 1) {
    assert.equal(rng.pick(single), "ONLY_ITEM");
  }

  const symbols = ["SYM_A", "SYM_B", "SYM_C", "SYM_D"];
  const symbolsCopy = [...symbols];
  const seen = new Set<string>();
  for (let i = 0; i < 200; i += 1) {
    seen.add(rng.pick(symbols));
  }
  assert.equal(seen.size, 4);
  assert.deepEqual(symbols, symbolsCopy); // never mutates input

  assert.throws(
    () => rng.pick([]),
    (err: unknown) =>
      err instanceof EmptySelectionError && err.code === "EMPTY_SELECTION",
  );
});

test("B03.3 — Weighted selection, relative weight invariance, zero-weight exclusion, large weights, and error handling", () => {
  // 1. Deterministic weighted fixture with zero-weight items at start, middle, and end
  const items = [
    { value: "ZERO_START", weight: 0 },
    { value: "A", weight: 1 },
    { value: "ZERO_MID", weight: 0 },
    { value: "B", weight: 3 },
    { value: "ZERO_END", weight: 0 },
  ] as const;
  const snapshotItems = JSON.stringify(items);

  const rng1 = createSeededRng("B03-weighted-fixture");
  const rng2 = createSeededRng("B03-weighted-fixture");

  const picks1: string[] = [];
  const picks2: string[] = [];
  const tally: Record<string, number> = { A: 0, B: 0 };

  for (let i = 0; i < 1000; i += 1) {
    const p1 = rng1.weightedPick(items);
    const p2 = rng2.weightedPick(items);
    assert.ok(p1 === "A" || p1 === "B", `Unexpected weighted pick: ${p1}`);
    picks1.push(p1);
    picks2.push(p2);
    tally[p1] += 1;
  }

  assert.deepEqual(picks1, picks2);
  assert.equal(JSON.stringify(items), snapshotItems); // input never mutated
  assert.ok(tally.B > tally.A * 2);

  // 2. Relative weight precision invariance: [1, 2, 7] vs [10, 20, 70] vs [0.1, 0.2, 0.7]
  const rngRelA = createSeededRng("B03-relative-weights");
  const rngRelB = createSeededRng("B03-relative-weights");
  const listSmall = [
    { value: "LOW", weight: 1 },
    { value: "MID", weight: 2 },
    { value: "HIGH", weight: 7 },
  ];
  const listScaled = [
    { value: "LOW", weight: 10 },
    { value: "MID", weight: 20 },
    { value: "HIGH", weight: 70 },
  ];
  for (let i = 0; i < 100; i += 1) {
    assert.equal(
      rngRelA.weightedPick(listSmall),
      rngRelB.weightedPick(listScaled),
    );
  }

  // 3. Very large finite weights (> 2^32) work safely
  const rngLarge = createSeededRng("B03-huge-weights");
  const hugeItems = [
    { value: "HUGE_1", weight: 1e12 },
    { value: "HUGE_2", weight: 3e12 },
  ];
  for (let i = 0; i < 50; i += 1) {
    const picked = rngLarge.weightedPick(hugeItems);
    assert.ok(picked === "HUGE_1" || picked === "HUGE_2");
  }

  // 4. Rejects empty, negative, NaN, Infinity, overflow, and zero-total weights
  assert.throws(
    () => rng1.weightedPick([]),
    (err: unknown) =>
      err instanceof EmptySelectionError && err.code === "EMPTY_SELECTION",
  );
  assert.throws(
    () =>
      rng1.weightedPick([
        { value: "A", weight: 5 },
        { value: "B", weight: -1 },
      ]),
    (err: unknown) =>
      err instanceof InvalidWeightError && err.code === "INVALID_WEIGHT",
  );
  assert.throws(
    () =>
      rng1.weightedPick([
        { value: "A", weight: Number.NaN },
        { value: "B", weight: 1 },
      ]),
    (err: unknown) =>
      err instanceof InvalidWeightError && err.code === "INVALID_WEIGHT",
  );
  assert.throws(
    () =>
      rng1.weightedPick([
        { value: "A", weight: Number.POSITIVE_INFINITY },
        { value: "B", weight: 1 },
      ]),
    (err: unknown) =>
      err instanceof InvalidWeightError && err.code === "INVALID_WEIGHT",
  );
  assert.throws(
    () =>
      rng1.weightedPick([
        { value: "A", weight: Number.MAX_VALUE },
        { value: "B", weight: Number.MAX_VALUE },
      ]),
    (err: unknown) =>
      err instanceof InvalidWeightError && err.code === "INVALID_WEIGHT",
  );
  assert.throws(
    () =>
      rng1.weightedPick([
        { value: "A", weight: 0 },
        { value: "B", weight: 0 },
      ]),
    (err: unknown) =>
      err instanceof ZeroTotalWeightError && err.code === "ZERO_TOTAL_WEIGHT",
  );
});

test("B03.4 — State snapshot/restore, serialization, fork substream isolation, multi-engine isolation, audit trail, and zero Math.random", () => {
  // 1. State snapshot & restore test (both mulberry32-v1 and sfc32-v1)
  for (const algorithm of ["mulberry32-v1", "sfc32-v1"] as const) {
    const rng = createRandomSource({
      seed: "B03-state-test-seed",
      algorithm,
    });
    const drawA = rng.nextUint32();
    assert.equal(typeof drawA, "number");
    assert.equal(rng.getDrawCount(), 1);

    const snap = rng.snapshot();
    assert.equal(snap.drawCount, 1);

    const drawB1 = rng.nextUint32();
    const drawC1 = rng.nextFloat();
    const drawD1 = rng.nextInt(0, 500);
    assert.equal(rng.getDrawCount(), 4);

    // Restore snapshot and redraw B, C, D
    rng.restore(snap);
    assert.equal(rng.getDrawCount(), 1);
    const drawB2 = rng.nextUint32();
    const drawC2 = rng.nextFloat();
    const drawD2 = rng.nextInt(0, 500);

    assert.equal(drawB1, drawB2);
    assert.equal(drawC1, drawC2);
    assert.equal(drawD1, drawD2);

    // 2. Serialization & deserialization round-trip
    const midSnap = rng.snapshot();
    const json = serializeRngState(midSnap);
    const restoredRng = deserializeRngState(json);
    for (let i = 0; i < 20; i += 1) {
      assert.equal(rng.nextUint32(), restoredRng.nextUint32());
    }

    // 3. Replay contract (createRngFromReplayInput)
    const replayRng = createRngFromReplayInput({
      seed: "B03-state-test-seed",
      rngAlgorithm: algorithm,
      algorithmVersion: 1,
      stateSnapshot: midSnap,
    });
    const freshFromMid = deserializeRngState(json);
    for (let i = 0; i < 10; i += 1) {
      assert.equal(replayRng.nextUint32(), freshFromMid.nextUint32());
    }
  }

  // Invalid state restoration throws InvalidRngStateError
  const baseRng = createSeededRng("B03-state-validation");
  assert.throws(
    () => baseRng.restore(null as unknown as ReturnType<typeof baseRng.snapshot>),
    (err: unknown) =>
      err instanceof InvalidRngStateError && err.code === "INVALID_RNG_STATE",
  );
  assert.throws(
    () => deserializeRngState("not-valid-json"),
    (err: unknown) =>
      err instanceof InvalidRngStateError && err.code === "INVALID_RNG_STATE",
  );

  // 4. Fork determinism & substream isolation
  const root1 = createSeededRng("B03-root-stream-seed");
  const root2 = createSeededRng("B03-root-stream-seed");

  const reels1 = root1.fork("reels");
  const features1 = root1.fork("features");
  const bonuses1 = root1.fork("bonuses");

  // Forking never consumes draws on the parent stream
  assert.equal(root1.getDrawCount(), 0);
  assert.equal(reels1.streamNamespace, "root/reels");
  assert.equal(features1.streamNamespace, "root/features");
  assert.equal(bonuses1.streamNamespace, "root/bonuses");

  // Consume 500 draws on features1, bonuses1, and root1 before forking reels2 from root2
  for (let i = 0; i < 500; i += 1) {
    features1.nextUint32();
    bonuses1.nextFloat();
    root2.nextUint32();
  }
  const reels2 = root2.fork("reels");

  // reels1 and reels2 produce the EXACT same sequence despite root2 and sibling streams advancing!
  const reelSeq1 = Array.from({ length: 25 }, () => reels1.nextInt(0, 32));
  const reelSeq2 = Array.from({ length: 25 }, () => reels2.nextInt(0, 32));
  assert.deepEqual(reelSeq1, reelSeq2);

  // Different namespaces from the same root seed produce independent sequences
  const features2 = root2.fork("features");
  const featureSeq = Array.from({ length: 25 }, () => features2.nextInt(0, 32));
  assert.notDeepEqual(reelSeq1, featureSeq);

  // deriveSeed helper matches deterministic namespace separation
  const derivedA = deriveSeed("B03-root-stream-seed", "root/reels");
  const derivedB = deriveSeed("B03-root-stream-seed", "root/reels");
  assert.deepEqual(derivedA, derivedB);

  // 5. Multi-engine isolation test
  const rngEngineA = new SeededRNG("engine-a-seed");
  const rngEngineB = new SeededRNG("engine-b-seed");
  const rngEngineC = new SeededRNG("engine-a-seed");

  const bp = createSampleGameBlueprint();
  const { engine: engineA } = createEngineFromBlueprint(bp, {
    initialBalance: 1000,
  });
  const { engine: engineB } = createEngineFromBlueprint(bp, {
    initialBalance: 1000,
  });

  // Advance Engine B and rngEngineB 50 times
  for (let i = 0; i < 50; i += 1) {
    rngEngineB.nextUint32();
    engineB.spin({
      gameId: SAMPLE_GAME_ID,
      seed: `engine-b-spin-${i}`,
      bet: 1,
    });
  }

  // Verify rngEngineA and Engine A remain completely isolated from Engine B
  for (let i = 0; i < 20; i += 1) {
    assert.equal(rngEngineA.nextUint32(), rngEngineC.nextUint32());
  }

  const { engine: engineC } = createEngineFromBlueprint(bp, {
    initialBalance: 1000,
  });

  const spinA = engineA.spin({
    gameId: SAMPLE_GAME_ID,
    seed: "shared-spin-seed-1",
    bet: 5,
  });
  const spinC = engineC.spin({
    gameId: SAMPLE_GAME_ID,
    seed: "shared-spin-seed-1",
    bet: 5,
  });
  assert.deepEqual(spinA.reelStops, spinC.reelStops);
  assert.deepEqual(spinA.board, spinC.board);
  assert.equal(spinA.totalPayout, spinC.totalPayout);

  // 6. Optional RNG Audit Trail
  const auditedRng = createRandomSource({
    seed: "B03-audit-seed",
    recordAudit: true,
  });
  auditedRng.nextUint32();
  auditedRng.nextFloat();
  auditedRng.nextInt(1, 10);
  auditedRng.nextBoolean(0.5);
  auditedRng.pick(["X", "Y"]);
  auditedRng.weightedPick([
    { value: "W1", weight: 1 },
    { value: "W2", weight: 3 },
  ]);
  auditedRng.fork("reels");

  const trail = auditedRng.getAuditTrail();
  assert.equal(trail.length, 7);
  assert.deepEqual(
    trail.map((r) => r.operation),
    [
      "nextUint32",
      "nextFloat",
      "nextInt",
      "nextBoolean",
      "pick",
      "weightedPick",
      "fork",
    ],
  );
  auditedRng.clearAuditTrail();
  assert.equal(auditedRng.getAuditTrail().length, 0);

  // 7. Static source scan: zero Math.random() or Date.now() calls in src/engine/**
  const engineRoot = path.resolve(process.cwd(), "src/engine");
  const collectTsFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectTsFiles(full));
      } else if (entry.name.endsWith(".ts")) {
        out.push(full);
      }
    }
    return out;
  };
  for (const file of collectTsFiles(engineRoot)) {
    const source = fs.readFileSync(file, "utf8");
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.equal(
      /Math\.random\s*\(/.test(codeOnly),
      false,
      `Forbidden Math.random() call in ${file}`,
    );
    assert.equal(
      /Date\.now\s*\(/.test(codeOnly),
      false,
      `Forbidden Date.now() call in ${file}`,
    );
    assert.equal(
      /performance\.now\s*\(/.test(codeOnly),
      false,
      `Forbidden performance.now() call in ${file}`,
    );
  }
});
