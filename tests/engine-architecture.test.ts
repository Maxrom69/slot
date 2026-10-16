import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  ENGINE_VERSION,
  EngineStateError,
  InvalidGameConfigError,
  InvalidPaylineConfigError,
  InvalidPaytableError,
  InvalidReelConfigError,
  InvalidSpinRequestError,
  InvalidSymbolReferenceError,
  SAMPLE_GAME_ID,
  SeededRNG,
  UnsupportedGameSchemaError,
  adaptBlueprintToGameConfig,
  assertSupportedSchemaVersion,
  assertValidBlueprintForEngine,
  checkSchemaCompatibility,
  createEngineFromBlueprint,
  createSampleGameBlueprint,
  createSlotGameEngine,
  deriveMathModel,
  serializeGameConfig,
  validateBlueprintForEngine,
  verifySpinOutcomeAgainstExpected,
} from "../src/engine";

test("B01.1 — GameBlueprint validation and schema versioning boundary reject invalid configs with structured errors", () => {
  const sample = createSampleGameBlueprint();
  const validation = validateBlueprintForEngine(sample);
  assert.equal(validation.valid, true);
  assert.equal(validation.schemaVersion, 1);
  assert.equal(validation.engineVersion, ENGINE_VERSION);
  assert.equal(validation.issues.length, 0);

  // Also validate a full studio-generated GameBlueprint
  const studioBlueprint = createBlueprint({
    id: "studio-game-1",
    title: "Pharaoh's Fortune",
    theme: "Ancient Egypt",
    columns: 5,
    rows: 3,
  });
  const studioValidation = validateBlueprintForEngine(studioBlueprint);
  assert.equal(studioValidation.valid, true);

  // 1. Unsupported schemaVersion
  const unsupportedBp = {
    ...structuredClone(sample),
    version: 99,
  };
  const compat = checkSchemaCompatibility(unsupportedBp);
  assert.equal(compat.compatible, false);
  assert.throws(
    () => assertSupportedSchemaVersion(unsupportedBp),
    (err: unknown) =>
      err instanceof UnsupportedGameSchemaError &&
      err.code === "UNSUPPORTED_GAME_SCHEMA" &&
      err.context.blueprintVersion === 99,
  );

  // 2. Invalid grid dimensions
  const badGridBp = structuredClone(sample);
  badGridBp.reels.columns = 2;
  badGridBp.reels.rows = 9;
  assert.throws(
    () => assertValidBlueprintForEngine(badGridBp),
    (err: unknown) =>
      err instanceof InvalidGameConfigError &&
      err.code === "INVALID_GAME_CONFIG" &&
      Array.isArray(err.context.issues) &&
      err.context.issues.length >= 2,
  );

  // 3. Duplicate symbol IDs
  const dupeSymbolBp = structuredClone(sample);
  dupeSymbolBp.symbols.push({ ...dupeSymbolBp.symbols[0], code: "DUP" });
  assert.throws(
    () => assertValidBlueprintForEngine(dupeSymbolBp),
    (err: unknown) =>
      err instanceof InvalidSymbolReferenceError &&
      err.code === "INVALID_SYMBOL_REFERENCE",
  );

  // 4. Reel stop referencing unknown symbol
  const badStopSymBp = structuredClone(sample);
  badStopSymBp.reels.strips[0][2] = "sym-non-existent";
  assert.throws(
    () => assertValidBlueprintForEngine(badStopSymBp),
    (err: unknown) =>
      err instanceof InvalidSymbolReferenceError &&
      err.code === "INVALID_SYMBOL_REFERENCE",
  );

  // 5. Empty reel strip
  const emptyStripBp = structuredClone(sample);
  emptyStripBp.reels.strips[1] = [];
  assert.throws(
    () => assertValidBlueprintForEngine(emptyStripBp),
    (err: unknown) =>
      err instanceof InvalidReelConfigError &&
      err.code === "INVALID_REEL_CONFIG",
  );

  // 6. Invalid weights when weightsEnabled = true
  const badWeightBp = structuredClone(sample);
  badWeightBp.reels.weightsEnabled = true;
  badWeightBp.reels.reels = badWeightBp.reels.strips.map((strip, idx) => ({
    id: `reel-${idx + 1}`,
    index: idx,
    name: `Reel ${idx + 1}`,
    stops: strip.map((symbolId, stopIdx) => ({
      id: `r${idx + 1}-s${stopIdx + 1}`,
      position: stopIdx + 1,
      symbolId,
      weight: idx === 0 && stopIdx === 0 ? 0 : 1,
    })),
  }));
  assert.throws(
    () => assertValidBlueprintForEngine(badWeightBp),
    (err: unknown) =>
      err instanceof InvalidReelConfigError &&
      err.code === "INVALID_REEL_CONFIG",
  );

  // 7. Malformed payline (out-of-bounds row index)
  const badPaylineBp = structuredClone(sample);
  badPaylineBp.paylines[0].pattern = [0, 1, 5, 1, 0];
  assert.throws(
    () => assertValidBlueprintForEngine(badPaylineBp),
    (err: unknown) =>
      err instanceof InvalidPaylineConfigError &&
      err.code === "INVALID_PAYLINE_CONFIG",
  );

  // 8. Malformed paytable (negative or NaN payout)
  const badPaytableBp = structuredClone(sample);
  badPaytableBp.paytable[0].payout = -10;
  assert.throws(
    () => assertValidBlueprintForEngine(badPaytableBp),
    (err: unknown) =>
      err instanceof InvalidPaytableError && err.code === "INVALID_PAYTABLE",
  );

  const nanPaytableBp = structuredClone(sample);
  nanPaytableBp.paytable[0].payout = Number.NaN;
  assert.throws(
    () => assertValidBlueprintForEngine(nanPaytableBp),
    (err: unknown) =>
      err instanceof InvalidPaytableError && err.code === "INVALID_PAYTABLE",
  );
});

test("B01.2 — GameBlueprint adapter builds indexed O(1) lookups and preserves strict immutability of Blueprint & GameConfig", () => {
  const sample = createSampleGameBlueprint();
  const originalBlueprintSnapshot = JSON.stringify(sample);

  const config = adaptBlueprintToGameConfig(sample);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.grid), true);
  assert.equal(Object.isFrozen(config.symbols), true);
  assert.equal(Object.isFrozen(config.reels), true);
  assert.equal(Object.isFrozen(config.paylines), true);

  // O(1) indexed lookup structures
  assert.equal(config.symbolsById.size, 6);
  assert.equal(config.symbolsByCode.get("STAR")?.id, "sym-high-star");
  assert.equal(config.wildSymbolIds.has("sym-wild"), true);
  assert.equal(config.scatterSymbolIds.has("sym-scatter"), true);
  assert.equal(config.reelsById.size, 5);
  assert.equal(config.paylinesById.size, 5);
  assert.equal(
    config.paytableBySymbolId.get("sym-high-star")?.get(5)?.payoutMultiplier,
    100,
  );
  assert.equal(config.featuresById.get("feature-free-spins")?.enabled, true);

  const serializedConfigBefore = JSON.stringify(serializeGameConfig(config));

  // Run multiple spins and verify neither GameBlueprint nor GameConfig mutates
  const { engine, session } = createEngineFromBlueprint(sample, {
    initialBalance: 500,
    initialBet: 1,
  });
  assert.equal(session.state.balance, 500);
  assert.equal(session.state.roundCounter, 0);

  const spin1 = engine.spin({
    gameId: SAMPLE_GAME_ID,
    seed: "seed-alpha-001",
    bet: 2,
  });
  const spin2 = engine.spin({
    gameId: SAMPLE_GAME_ID,
    seed: "seed-alpha-002",
    bet: 2,
  });

  assert.equal(spin1.roundIndex, 1);
  assert.equal(spin2.roundIndex, 2);
  assert.equal(engine.getState().roundCounter, 2);

  // Verify original GameBlueprint and GameConfig are 100% untouched
  assert.equal(JSON.stringify(sample), originalBlueprintSnapshot);
  assert.equal(
    JSON.stringify(serializeGameConfig(engine.getConfig())),
    serializedConfigBefore,
  );

  // Math model derivation
  const mathModel = deriveMathModel(config);
  assert.equal(mathModel.gameId, SAMPLE_GAME_ID);
  assert.equal(mathModel.totalReelStopCombinations, Math.pow(6, 5));
});

test("B01.3 — Deterministic seed behavior, lifecycle validation, and forced scenario verification", () => {
  const uninitializedEngine = createSlotGameEngine();
  assert.throws(
    () => uninitializedEngine.getState(),
    (err: unknown) =>
      err instanceof EngineStateError && err.code === "ENGINE_STATE_ERROR",
  );
  assert.throws(
    () =>
      uninitializedEngine.spin({
        gameId: SAMPLE_GAME_ID,
        seed: "seed-1",
        bet: 1,
      }),
    (err: unknown) =>
      err instanceof EngineStateError && err.code === "ENGINE_STATE_ERROR",
  );

  const sample = createSampleGameBlueprint();
  const { engine: engineA } = createEngineFromBlueprint(sample, {
    initialBalance: 100,
  });
  const { engine: engineB } = createEngineFromBlueprint(sample, {
    initialBalance: 100,
  });

  // Invalid spin requests throw InvalidSpinRequestError / InvalidPaylineConfigError
  assert.throws(
    () =>
      engineA.spin({
        gameId: "wrong-game-id",
        seed: "seed-1",
        bet: 1,
      }),
    (err: unknown) =>
      err instanceof InvalidSpinRequestError &&
      err.code === "INVALID_SPIN_REQUEST",
  );
  assert.throws(
    () =>
      engineA.spin({
        gameId: SAMPLE_GAME_ID,
        seed: "seed-1",
        bet: -5,
      }),
    (err: unknown) =>
      err instanceof InvalidSpinRequestError &&
      err.code === "INVALID_SPIN_REQUEST",
  );
  assert.throws(
    () =>
      engineA.spin({
        gameId: SAMPLE_GAME_ID,
        seed: "seed-1",
        bet: 500, // exceeds balance of 100
      }),
    (err: unknown) =>
      err instanceof InvalidSpinRequestError &&
      err.code === "INVALID_SPIN_REQUEST",
  );
  assert.throws(
    () =>
      engineA.spin({
        gameId: SAMPLE_GAME_ID,
        seed: "seed-1",
        bet: 1,
        activePaylineIds: ["unknown-line"],
      }),
    (err: unknown) =>
      err instanceof InvalidPaylineConfigError &&
      err.code === "INVALID_PAYLINE_CONFIG",
  );

  // Determinism check: identical GameBlueprint + Seed + SpinRequest => identical SpinResult
  const request = {
    gameId: SAMPLE_GAME_ID,
    seed: "deterministic-b01-seed-42",
    bet: 5,
  } as const;

  const resultA = engineA.spin(request);
  const resultB = engineB.spin(request);

  assert.deepEqual(resultA.reelStops, resultB.reelStops);
  assert.deepEqual(resultA.board, resultB.board);
  assert.deepEqual(resultA.wins, resultB.wins);
  assert.equal(resultA.totalPayout, resultB.totalPayout);
  assert.deepEqual(resultA.featureTriggers, resultB.featureTriggers);
  assert.deepEqual(resultA.events, resultB.events);
  assert.deepEqual(resultA.nextState, resultB.nextState);
  assert.deepEqual(resultA.replay, resultB.replay);

  // SeededRNG clone reproducibility
  const rng1 = new SeededRNG("rng-clone-test");
  const rng2 = rng1.clone();
  for (let i = 0; i < 20; i += 1) {
    assert.equal(rng1.nextUint32(), rng2.nextUint32());
  }

  // Deterministic scenario verification using forcedStopIndexes:
  // Stop index 0 on all 5 reels places:
  // Reel 0..2: row 0 = A, row 1 = K, row 2 = Q
  // Reel 3: row 0 = K, row 1 = Q, row 2 = STAR
  // Reel 4: row 0 = Q, row 1 = STAR, row 2 = A
  // So Top Row (line-2, row 0) has 3x A (payout multiplier 2x),
  // Middle Row (line-1, row 1) has 3x K (payout multiplier 3x),
  // Bottom Row (line-3, row 2) has 3x Q (payout multiplier 4x),
  // Inverted V (line-5, pattern [2,1,0,1,2]) has Q, K, A... no 3-match,
  // V Shape (line-4, pattern [0,1,2,1,0]) has A, K, Q... no 3-match.
  // With bet = 5 across 5 lines (betPerLine = 1), totalPayout = 2 + 3 + 4 = 9.
  const forcedScenario = {
    id: "scenario-3oak-lines",
    name: "Three 3-of-a-kind line wins on rows 0, 1, 2",
    gameId: SAMPLE_GAME_ID,
    seed: "scenario-seed-1",
    bet: 5,
    forcedStopIndexes: [0, 0, 0, 0, 0],
    expected: {
      reelStops: [0, 0, 0, 0, 0],
      totalPayout: 9,
      winCount: 3,
      featureTriggerCount: 0,
    },
  };
  const { engine: scenarioEngine } = createEngineFromBlueprint(sample, {
    initialBalance: 100,
  });
  const forcedResult = scenarioEngine.spin({
    gameId: forcedScenario.gameId,
    seed: forcedScenario.seed,
    bet: forcedScenario.bet,
    forcedStopIndexes: forcedScenario.forcedStopIndexes,
  });
  const verification = verifySpinOutcomeAgainstExpected(
    forcedScenario,
    forcedResult,
  );
  assert.equal(
    verification.passed,
    true,
    JSON.stringify(verification.mismatches),
  );

  // Scatter & Wild scenario: stop index 3 on reels 0, 1, 2 places:
  // row 0 = STAR, row 1 = WILD, row 2 = SCAT across reels 0, 1, 2!
  const featureSpin = scenarioEngine.spin({
    gameId: SAMPLE_GAME_ID,
    seed: "scenario-seed-scatter",
    bet: 5,
    forcedStopIndexes: [3, 3, 3, 0, 0],
  });
  assert.equal(featureSpin.featureTriggers.length, 1);
  assert.equal(featureSpin.featureTriggers[0].featureId, "feature-free-spins");
  assert.equal(featureSpin.featureTriggers[0].awardedFreeSpins, 10);
  assert.equal(featureSpin.nextState.featureState.freeSpinsRemaining, 10);
});

test("B01.4 — Serialization, optional diagnostics, and zero browser/UI dependencies", () => {
  const sample = createSampleGameBlueprint();

  // 1. Disabled diagnostics by default
  const { engine: quietEngine } = createEngineFromBlueprint(sample, {
    diagnostics: { enabled: false },
  });
  const quietResult = quietEngine.spin({
    gameId: SAMPLE_GAME_ID,
    seed: "quiet-seed",
    bet: 1,
  });
  assert.equal(quietResult.diagnostics.length, 0);

  // 2. Enabled diagnostics records structured pipeline stage entries
  const { engine: verboseEngine } = createEngineFromBlueprint(sample, {
    diagnostics: { enabled: true, minLevel: "debug" },
  });
  const verboseResult = verboseEngine.spin({
    gameId: SAMPLE_GAME_ID,
    seed: "verbose-seed",
    bet: 1,
  });
  assert.ok(verboseResult.diagnostics.length >= 8);
  assert.equal(verboseResult.diagnostics[0].stage, "VALIDATE_REQUEST");
  assert.equal(
    verboseResult.diagnostics[verboseResult.diagnostics.length - 1].stage,
    "PRODUCE_RESULT",
  );

  // 3. Full JSON serialization round-trip of SpinResult, GameState, Events, and Replay
  const jsonString = JSON.stringify(verboseResult);
  const parsedResult = JSON.parse(jsonString) as typeof verboseResult;
  assert.deepEqual(parsedResult.reelStops, verboseResult.reelStops);
  assert.deepEqual(parsedResult.board, verboseResult.board);
  assert.deepEqual(parsedResult.events, verboseResult.events);
  assert.deepEqual(parsedResult.nextState, verboseResult.nextState);
  assert.deepEqual(parsedResult.replay, verboseResult.replay);

  // 4. Verify headless purity: no React, DOM, window, document, localStorage, or Math.random in src/engine
  const engineRoot = path.join(process.cwd(), "src", "engine");
  const collectTsFiles = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(...collectTsFiles(full));
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        out.push(full);
      }
    }
    return out;
  };

  const engineFiles = collectTsFiles(engineRoot);
  assert.ok(engineFiles.length >= 14);

  for (const filePath of engineFiles) {
    const source = fs.readFileSync(filePath, "utf8");
    // Strip comments before inspecting code tokens
    const codeOnly = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    assert.equal(
      /\bMath\.random\s*\(/.test(codeOnly),
      false,
      `Engine file ${filePath} must not call Math.random()`,
    );
    assert.equal(
      /\bDate\.now\s*\(/.test(codeOnly),
      false,
      `Engine file ${filePath} must not call Date.now()`,
    );
    assert.equal(
      /\bconsole\.(log|warn|error|info|debug)\s*\(/.test(codeOnly),
      false,
      `Engine file ${filePath} must not call console.* directly`,
    );
    assert.equal(
      /from\s+["']react["']|from\s+["']@/i.test(codeOnly) &&
        /from\s+["']@\/components/i.test(codeOnly),
      false,
      `Engine file ${filePath} must not import frontend components`,
    );
    assert.equal(
      /\b(window|document|localStorage|sessionStorage)\b/.test(codeOnly),
      false,
      `Engine file ${filePath} must not reference browser globals`,
    );
  }
});
