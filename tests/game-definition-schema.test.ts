import assert from "node:assert/strict";
import test from "node:test";

import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  CANONICAL_SCHEMA_VERSION,
  GameDefinitionSchema,
  InvalidGameConfigError,
  InvalidPaylineConfigError,
  InvalidPaytableError,
  InvalidReelConfigError,
  InvalidSymbolReferenceError,
  SAMPLE_B02_GAME_ID,
  UnsupportedGameSchemaError,
  assertValidGameDefinition,
  cloneGameDefinition,
  createSampleGameDefinition,
  createSlotGameEngine,
  deserializeGameDefinition,
  migrateGameDefinition,
  normalizeGameDefinition,
  serializeGameDefinition,
  toGameConfig,
  validateGameDefinition,
} from "../src/engine";

test("B02.1 — Canonical GameDefinition schema represents all 26+ structural domains and multi-mode games", () => {
  const sample = createSampleGameDefinition();

  assert.equal(sample.schemaVersion, CANONICAL_SCHEMA_VERSION);
  assert.equal(sample.engineCompatibility.schemaVersion, "1.0");
  assert.equal(sample.id, SAMPLE_B02_GAME_ID);
  assert.equal(sample.metadata.id, SAMPLE_B02_GAME_ID);
  assert.equal(sample.metadata.title, "Solar Dynasty 5x3");
  assert.equal(sample.game.gameId, SAMPLE_B02_GAME_ID);
  assert.equal(sample.game.gameMode, "fixedPaylines");

  // Grid & StyleGuide
  assert.equal(sample.grid.reelCount, 5);
  assert.equal(sample.grid.rowCount, 3);
  assert.equal(sample.styleGuide.name, "Solar Gold");

  // Symbols, Roles, Families, Variants & Symbol Sets
  assert.equal(sample.canonicalSymbols.length, 6);
  const sunDisk = sample.canonicalSymbols.find(
    (s) => s.id === "sym-high-sun-disk",
  );
  assert.ok(sunDisk);
  assert.equal(sunDisk.familyId, "family-sun-disk");
  assert.equal(sunDisk.variants.length, 3);
  assert.deepEqual(
    sunDisk.variants.map((v) => v.id),
    [
      "var-sun-disk-collect",
      "var-sun-disk-major",
      "var-sun-disk-mini",
    ],
  );
  assert.equal(sample.symbolFamilies.length, 1);
  assert.equal(sample.symbolFamilies[0].id, "family-sun-disk");
  assert.equal(sample.symbolFamilies[0].memberIds.length, 4);

  const wildSym = sample.canonicalSymbols.find((s) => s.id === "sym-wild");
  assert.ok(wildSym);
  assert.deepEqual(wildSym.roles, ["wild"]);

  const scatterSym = sample.canonicalSymbols.find(
    (s) => s.id === "sym-scatter",
  );
  assert.ok(scatterSym);
  assert.deepEqual(scatterSym.roles, ["scatter"]);

  assert.equal(sample.canonicalSymbolSets.length, 2);
  assert.equal(sample.canonicalAssets.length, 3);
  assert.equal(sample.canonicalElements.length, 2);
  assert.equal(sample.canonicalScenes.length, 1);
  assert.equal(sample.canonicalLayers.length, 3);

  // Reels, Paylines, Paytable & Win Evaluation
  assert.equal(sample.canonicalReels.reelCount, 5);
  assert.equal(sample.canonicalReels.reels.length, 5);
  assert.deepEqual(
    sample.canonicalReels.reels.map((r) => r.index),
    [0, 1, 2, 3, 4],
  );
  assert.equal(sample.canonicalPaylines.paylines.length, 5);
  assert.equal(sample.paytableDefinition.payoutType, "multiplier");
  assert.equal(sample.winEvaluation.primaryMode, "fixedPaylines");
  assert.equal(sample.wildConfiguration.enabled, true);
  assert.deepEqual(sample.wildConfiguration.symbolIds, ["sym-wild"]);
  assert.equal(sample.scatterConfiguration.enabled, true);
  assert.deepEqual(sample.scatterConfiguration.symbolIds, ["sym-scatter"]);

  // Features, Free Spins, Multipliers, Board Dynamics & Export
  assert.equal(sample.canonicalFeatures.length, 1);
  assert.equal(sample.freeSpinsConfiguration.enabled, true);
  assert.equal(sample.freeSpinsConfiguration.initialSpins, 10);
  assert.equal(sample.multiplierConfiguration.baseMultiplier, 1);
  assert.equal(sample.boardDynamics.cascades.enabled, false);
  assert.equal(sample.variableReelHeights.perReelRowCounts.length, 5);
  assert.equal(sample.reelNudges.enabled, false);
  assert.equal(sample.linkedReels.enabled, false);
  assert.equal(sample.canonicalAnimations.length, 1);
  assert.equal(sample.export.imageScale, "1x");

  // Multi-mode compatibility: Ways (6x3) and Clusters (6x4)
  const waysBp = createBlueprint({
    id: "ways-6x3",
    title: "Cyber Ways",
    theme: "Cyberpunk",
    columns: 6,
    rows: 3,
    evaluation: "ways",
  });
  const waysDef = normalizeGameDefinition(waysBp);
  assert.equal(waysDef.winEvaluation.primaryMode, "ways");
  assert.equal(waysDef.waysConfiguration.enabled, true);
  assert.equal(waysDef.waysConfiguration.totalWaysCount, Math.pow(3, 6));

  const clusterBp = createBlueprint({
    id: "cluster-6x4",
    title: "Gem Clusters",
    theme: "Crystal Cavern",
    columns: 6,
    rows: 4,
    evaluation: "cluster",
  });
  const clusterDef = normalizeGameDefinition(clusterBp);
  assert.equal(clusterDef.winEvaluation.primaryMode, "clusters");
  assert.equal(clusterDef.clusterConfiguration.enabled, true);
  assert.equal(clusterDef.clusterConfiguration.adjacency, "edge");
});

test("B02.2 — Negative test fixtures: validation catches all 16+ dangling references, malformed configs, and forbidden runtime/UI states", () => {
  const base = createSampleGameDefinition();

  // 1. Duplicate symbol IDs
  const dupeSym = structuredClone(base);
  dupeSym.symbols.push({ ...dupeSym.symbols[0], code: "DUP_A" });
  assert.throws(
    () => assertValidGameDefinition(dupeSym),
    (err: unknown) => err instanceof InvalidSymbolReferenceError,
  );

  // 2. Unknown reel symbol
  const unknownReelSym = structuredClone(base);
  unknownReelSym.reels.strips[0][0] = "sym-does-not-exist";
  assert.throws(
    () => assertValidGameDefinition(unknownReelSym),
    (err: unknown) => err instanceof InvalidSymbolReferenceError,
  );

  // 3. Invalid payline length
  const badPaylineLen = structuredClone(base);
  badPaylineLen.paylines[0].pattern = [0, 1, 2];
  (badPaylineLen as unknown as Record<string, unknown>).canonicalPaylines =
    undefined;
  assert.throws(
    () => assertValidGameDefinition(badPaylineLen),
    (err: unknown) => err instanceof InvalidPaylineConfigError,
  );

  // 4. Payline row out of bounds
  const badPaylineRow = structuredClone(base);
  badPaylineRow.paylines[0].pattern = [0, 1, 5, 1, 0];
  (badPaylineRow as unknown as Record<string, unknown>).canonicalPaylines =
    undefined;
  assert.throws(
    () => assertValidGameDefinition(badPaylineRow),
    (err: unknown) => err instanceof InvalidPaylineConfigError,
  );

  // 5. Unknown paytable symbol
  const badPaytableSym = structuredClone(base);
  badPaytableSym.paytable.push({
    symbolId: "sym-unknown-paytable",
    ofAKind: 3,
    payout: 10,
  });
  assert.throws(
    () => assertValidGameDefinition(badPaytableSym),
    (err: unknown) => err instanceof InvalidSymbolReferenceError,
  );

  // 6. Negative payout & NaN payout
  const negPayout = structuredClone(base);
  negPayout.paytable[0].payout = -5;
  assert.throws(
    () => assertValidGameDefinition(negPayout),
    (err: unknown) => err instanceof InvalidPaytableError,
  );

  const nanPayout = structuredClone(base);
  nanPayout.paytable[0].payout = Number.NaN;
  assert.throws(
    () => assertValidGameDefinition(nanPayout),
    (err: unknown) => err instanceof InvalidPaytableError,
  );

  // 7. Invalid weight
  const badWeight = structuredClone(base);
  (badWeight.canonicalReels as { useWeights: boolean }).useWeights = true;
  (
    badWeight.canonicalReels.reels[0].stops[0] as { weight?: number }
  ).weight = 0;
  assert.throws(
    () => assertValidGameDefinition(badWeight),
    (err: unknown) => err instanceof InvalidReelConfigError,
  );

  // 8. Unknown scene layer
  const badSceneLayer = structuredClone(base);
  badSceneLayer.scenes[0].layerIds = ["layer-bg", "layer-non-existent"];
  assert.throws(
    () => assertValidGameDefinition(badSceneLayer),
    (err: unknown) => err instanceof InvalidGameConfigError,
  );

  // 9. Unknown asset
  const badAsset = structuredClone(base);
  badAsset.symbols[0].assetId = "asset-non-existent";
  assert.throws(
    () => assertValidGameDefinition(badAsset),
    (err: unknown) => err instanceof InvalidGameConfigError,
  );

  // 10. Unknown symbol set
  const badSymbolSet = structuredClone(base);
  badSymbolSet.symbols[0].symbolSetId = "set-non-existent";
  assert.throws(
    () => assertValidGameDefinition(badSymbolSet),
    (err: unknown) => err instanceof InvalidSymbolReferenceError,
  );

  // 11. Unknown wild symbol
  const badWild = structuredClone(base);
  (badWild.wildConfiguration as unknown as { symbolIds: string[] }).symbolIds =
    ["sym-missing-wild"];
  assert.throws(
    () => assertValidGameDefinition(badWild),
    (err: unknown) => err instanceof InvalidSymbolReferenceError,
  );

  // 12. Unknown scatter symbol
  const badScatter = structuredClone(base);
  (
    badScatter.scatterConfiguration as unknown as { symbolIds: string[] }
  ).symbolIds = ["sym-missing-scatter"];
  assert.throws(
    () => assertValidGameDefinition(badScatter),
    (err: unknown) => err instanceof InvalidSymbolReferenceError,
  );

  // 13. Unsupported schema version
  const badVersion = structuredClone(base) as unknown as Record<
    string,
    unknown
  >;
  badVersion.schemaVersion = "9.9";
  assert.throws(
    () => assertValidGameDefinition(badVersion),
    (err: unknown) => err instanceof UnsupportedGameSchemaError,
  );

  // 14. Unknown family member reference
  const badFamily = structuredClone(base);
  (
    badFamily.symbolFamilies[0] as unknown as { memberIds: string[] }
  ).memberIds = ["var-missing-member"];
  assert.throws(
    () => assertValidGameDefinition(badFamily),
    (err: unknown) => err instanceof InvalidSymbolReferenceError,
  );

  // 15. Forbidden Runtime State & Forbidden UI State inside GameDefinition
  const withRuntimeState = {
    ...structuredClone(base),
    currentBoard: [],
    currentBalance: 500,
  };
  const runtimeValidation = validateGameDefinition(withRuntimeState);
  assert.equal(runtimeValidation.valid, false);
  assert.ok(
    runtimeValidation.issues.some((i) => i.path === "currentBoard"),
  );

  const withUiState = {
    ...structuredClone(base),
    selectedLayer: "layer-reels",
    activeTool: "move",
    undoStack: [],
  };
  const uiValidation = validateGameDefinition(withUiState);
  assert.equal(uiValidation.valid, false);
  assert.ok(uiValidation.issues.some((i) => i.path === "selectedLayer"));

  // 16. Non-serializable function / Map inside GameDefinition
  const withFunction = {
    ...structuredClone(base),
    extensions: { computeWin: () => 100 },
  };
  assert.equal(validateGameDefinition(withFunction).valid, false);
});

test("B02.3 — Deterministic normalization, JSON serialization, migration boundary, clone safety & toGameConfig conversion", () => {
  const sample = createSampleGameDefinition();
  const snapshotBefore = JSON.stringify(sample);

  // 1. Deterministic & idempotent normalization without mutating input
  const norm1 = normalizeGameDefinition(sample);
  const norm2 = normalizeGameDefinition(norm1);
  assert.equal(JSON.stringify(sample), snapshotBefore);
  assert.equal(JSON.stringify(norm1), JSON.stringify(norm2));
  assert.equal(Object.isFrozen(norm1), true);

  // 2. GameDefinitionSchema.parse & safeParse
  const parsedSchema = GameDefinitionSchema.parse(sample);
  assert.equal(parsedSchema.id, SAMPLE_B02_GAME_ID);
  const safeOk = GameDefinitionSchema.safeParse(sample);
  assert.equal(safeOk.success, true);
  const safeFail = GameDefinitionSchema.safeParse({ version: 999 });
  assert.equal(safeFail.success, false);

  // 3. Serialization & deserialization round-trip without structural loss
  const json = serializeGameDefinition(sample, true);
  const deserialized = deserializeGameDefinition(json);
  assert.deepEqual(deserialized, sample);

  // 4. Schema migration boundary ("0.9" / "1" -> "1.0")
  const legacyV09 = {
    ...structuredClone(sample),
    version: 0.9,
  };
  const migrated = migrateGameDefinition(legacyV09, "0.9", "1.0");
  assert.equal(migrated.schemaVersion, "1.0");
  assert.equal(migrated.version, 1);

  assert.throws(
    () => migrateGameDefinition(sample, "0.1", "1.0"),
    (err: unknown) => err instanceof UnsupportedGameSchemaError,
  );
  assert.throws(
    () => migrateGameDefinition(sample, "1.0", "2.0"),
    (err: unknown) => err instanceof UnsupportedGameSchemaError,
  );

  // 5. Clone safety
  const cloned = cloneGameDefinition(sample, {
    newGameId: "solar-dynasty-clone-1",
    newTitle: "Solar Dynasty Deluxe",
    newAuthor: "Studio QA",
    folderPath: "/Clones",
    timestamp: "2026-10-12T12:00:00.000Z",
  });
  assert.equal(cloned.id, "solar-dynasty-clone-1");
  assert.equal(cloned.metadata.id, "solar-dynasty-clone-1");
  assert.equal(cloned.metadata.title, "Solar Dynasty Deluxe");
  assert.equal(cloned.metadata.author, "Studio QA");
  assert.equal(cloned.game.gameId, "solar-dynasty-clone-1");
  assert.equal(cloned.canonicalSymbols.length, sample.canonicalSymbols.length);
  assert.equal(cloned.canonicalReels.reels.length, 5);
  assert.equal(sample.id, SAMPLE_B02_GAME_ID); // original untouched

  // 6. GameDefinition -> GameConfig -> SlotGameEngine execution
  const gameConfig = toGameConfig(sample);
  assert.equal(gameConfig.gameId, SAMPLE_B02_GAME_ID);
  assert.equal(gameConfig.symbolsById.size, 6);
  assert.equal(gameConfig.variantsById?.size, 3);
  assert.deepEqual(
    gameConfig.symbolFamiliesById?.get("family-sun-disk"),
    [
      "sym-high-sun-disk",
      "var-sun-disk-collect",
      "var-sun-disk-major",
      "var-sun-disk-mini",
    ],
  );
  assert.equal(gameConfig.reelsById.size, 5);
  assert.equal(gameConfig.paylinesById.size, 5);

  // Verify a custom variant ID is independently addressable in reel strips and paytable
  const withAddressableVariant = structuredClone(sample);
  withAddressableVariant.reels.strips[0][0] = "var-sun-disk-major";
  if (withAddressableVariant.reelConfiguration) {
    withAddressableVariant.reelConfiguration.reels[0].stops[0].symbolId =
      "var-sun-disk-major";
  }
  (
    withAddressableVariant as unknown as Record<string, unknown>
  ).canonicalReels = undefined;
  withAddressableVariant.paytable.push({
    symbolId: "var-sun-disk-major",
    ofAKind: 5,
    payout: 250,
  });
  const variantGameConfig = toGameConfig(withAddressableVariant);
  assert.equal(variantGameConfig.symbolsById.has("var-sun-disk-major"), true);
  assert.equal(
    variantGameConfig.symbolsById.get("var-sun-disk-major")?.baseSymbolId,
    "sym-high-sun-disk",
  );

  const engine = createSlotGameEngine();
  const session = engine.initialize(gameConfig, { initialBalance: 200 });
  assert.equal(session.state.gameId, SAMPLE_B02_GAME_ID);
  const spinResult = engine.spin({
    gameId: SAMPLE_B02_GAME_ID,
    seed: "b02-schema-verification-seed",
    bet: 5,
  });
  assert.equal(spinResult.board.columns, 5);
  assert.equal(spinResult.board.rows, 3);
});
