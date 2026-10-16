import assert from "node:assert/strict";
import test from "node:test";
import { createBlueprint } from "../src/lib/blueprint/factory";
import { getReelConfiguration } from "../src/lib/blueprint/model";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import {
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
} from "../src/lib/design/history";
import { migrateBlueprint } from "../src/lib/design/migrate";
import { createEditorCommand, executeEditorCommand } from "../src/lib/editor/commands";
import { LocalProjectPersistenceService } from "../src/lib/persistence/project-persistence";
import {
  addReel,
  appendStopToReel,
  applyReelConfigurationToBlueprint,
  applyTextStopsToReel,
  buildSymbolPalette,
  duplicateReel,
  duplicateStopInReel,
  filterSymbolPalette,
  formatReelStopsToText,
  moveStopBetweenReels,
  parseReelStopsText,
  reelConfigurationFromBlueprint,
  removeReel,
  removeStopFromReel,
  reorderStopInReel,
  repairStopCorruption,
  setWeightsEnabled,
  updateStopWeight,
  validateReelConfiguration,
} from "../src/lib/reels";

function createSampleBlueprint() {
  return createBlueprint({
    id: "prj_f14_reels",
    title: "Imperial Reels",
    theme: "Ancient Rome",
    columns: 5,
    rows: 3,
    symbolArt: {
      H1: "/api/assets/ast_emperor",
      WILD: "/api/assets/ast_eagle_wild",
    },
  });
}

test("F14 — Reel Editor: Symbol Palette search (symbol ID, name, artwork) & appending stops repeatedly", () => {
  const bp = createSampleBlueprint();
  const palette = buildSymbolPalette(bp);
  assert.ok(palette.length >= 9, "Palette contains all project symbols");

  // Linked artwork thumbnails resolved for H1 and WILD
  const h1Item = palette.find((p) => p.code === "H1")!;
  assert.ok(h1Item);
  assert.equal(h1Item.hasArtwork, true);
  assert.equal(h1Item.artworkUri, "/api/assets/ast_emperor");

  // Search by symbol ID
  const byId = filterSymbolPalette(palette, h1Item.id);
  assert.equal(byId.length, 1);
  assert.equal(byId[0].id, h1Item.id);

  // Search by symbol name
  const byName = filterSymbolPalette(palette, h1Item.name);
  assert.ok(byName.some((item) => item.id === h1Item.id));

  // Search by artwork (asset URI, asset name, or "linked" / "placeholder")
  const byArtUri = filterSymbolPalette(palette, "ast_eagle_wild");
  assert.equal(byArtUri.length, 1);
  assert.equal(byArtUri[0].code, "WILD");

  const linkedOnly = filterSymbolPalette(palette, "", { artwork: "linked" });
  assert.equal(linkedOnly.length, 2);

  // Selecting a symbol appends a stop; selecting it again adds another stop
  let config = reelConfigurationFromBlueprint(bp);
  const initialCount = config.reels[0].stops.length;

  config = appendStopToReel(config, 0, h1Item.id, h1Item.reelWeight);
  assert.equal(config.reels[0].stops.length, initialCount + 1);
  const firstAppended = config.reels[0].stops[initialCount];
  assert.equal(firstAppended.symbolId, h1Item.id);
  assert.equal(firstAppended.position, initialCount + 1);

  config = appendStopToReel(config, 0, h1Item.id, h1Item.reelWeight);
  assert.equal(config.reels[0].stops.length, initialCount + 2);
  const secondAppended = config.reels[0].stops[initialCount + 1];
  assert.equal(secondAppended.symbolId, h1Item.id);
  assert.equal(secondAppended.position, initialCount + 2);
  assert.notEqual(
    firstAppended.id,
    secondAppended.id,
    "Repeatedly appending the same symbol creates distinct stop IDs",
  );
});

test("F14 — Reel Editor: Stop operations (duplicate, remove, weights toggle & per-stop weight input)", () => {
  const bp = createSampleBlueprint();
  let config = reelConfigurationFromBlueprint(bp);

  // Start with known stops on Reel 1
  const symA = bp.symbols[0].id;
  const symB = bp.symbols[1].id;
  config = applyTextStopsToReel(config, 0, `${symA}, ${symB}`);
  assert.equal(config.reels[0].stops.length, 2);
  assert.equal(config.reels[0].stops[0].position, 1);
  assert.equal(config.reels[0].stops[1].position, 2);

  // Duplicate stop #1
  config = duplicateStopInReel(config, 0, 0);
  assert.equal(config.reels[0].stops.length, 3);
  assert.deepEqual(
    config.reels[0].stops.map((s) => s.symbolId),
    [symA, symA, symB],
  );
  assert.deepEqual(
    config.reels[0].stops.map((s) => s.position),
    [1, 2, 3],
  );
  assert.notEqual(config.reels[0].stops[0].id, config.reels[0].stops[1].id);

  // Remove stop #2
  config = removeStopFromReel(config, 0, 1);
  assert.equal(config.reels[0].stops.length, 2);
  assert.deepEqual(
    config.reels[0].stops.map((s) => s.symbolId),
    [symA, symB],
  );
  assert.deepEqual(
    config.reels[0].stops.map((s) => s.position),
    [1, 2],
  );

  // Weights toggle & per-stop weight editing
  assert.equal(config.weightsEnabled, false);
  config = setWeightsEnabled(config, true);
  assert.equal(config.weightsEnabled, true);

  config = updateStopWeight(config, 0, 0, 15);
  config = updateStopWeight(config, 0, 1, 25);
  assert.equal(config.reels[0].stops[0].weight, 15);
  assert.equal(config.reels[0].stops[1].weight, 25);
});

test("F14 — Reel Editor: Drag reorder within reel & move stop to another reel, plus Add / Remove / Duplicate Reel", () => {
  const bp = createSampleBlueprint();
  let config = reelConfigurationFromBlueprint(bp);
  const [s1, s2, s3] = bp.symbols.map((s) => s.id);

  config = applyTextStopsToReel(config, 0, `${s1}, ${s2}, ${s3}`);
  config = applyTextStopsToReel(config, 1, `${s2}, ${s3}`);

  // Reorder within Reel 1: move stop 0 (s1) to index 2
  config = reorderStopInReel(config, 0, 0, 2);
  assert.deepEqual(
    config.reels[0].stops.map((s) => s.symbolId),
    [s2, s3, s1],
  );
  assert.deepEqual(
    config.reels[0].stops.map((s) => s.position),
    [1, 2, 3],
  );
  assert.deepEqual(config.strips[0], [s2, s3, s1]);

  // Move stop from Reel 1 (stop index 2 -> s1) to Reel 2 (at stop index 1)
  const movedStopId = config.reels[0].stops[2].id;
  config = moveStopBetweenReels(config, 0, 2, 1, 1);
  assert.deepEqual(
    config.reels[0].stops.map((s) => s.symbolId),
    [s2, s3],
  );
  assert.deepEqual(
    config.reels[1].stops.map((s) => s.symbolId),
    [s2, s1, s3],
  );
  assert.equal(config.reels[1].stops[1].id, movedStopId);
  assert.deepEqual(
    config.reels[1].stops.map((s) => s.position),
    [1, 2, 3],
  );

  // Add Reel (5 -> 6 reels)
  config = addReel(config, { initialSymbolIds: [s1, s2] });
  assert.equal(config.reels.length, 6);
  assert.equal(config.columns, 6);
  assert.equal(config.reels[5].name, "Reel 6");
  assert.deepEqual(config.strips[5], [s1, s2]);

  // Duplicate Reel 1 (6 -> 7 reels)
  config = duplicateReel(config, 0, true);
  assert.equal(config.reels.length, 7);
  assert.equal(config.columns, 7);
  assert.deepEqual(
    config.reels[1].stops.map((s) => s.symbolId),
    config.reels[0].stops.map((s) => s.symbolId),
  );
  // Duplicated reel stops have brand-new unique stop IDs (no duplicate stop corruption)
  assert.notEqual(config.reels[1].stops[0].id, config.reels[0].stops[0].id);

  // Remove Reel (7 -> 6 reels)
  config = removeReel(config, 1);
  assert.equal(config.reels.length, 6);
  assert.equal(config.columns, 6);
  assert.deepEqual(
    config.reels.map((r) => r.name),
    ["Reel 1", "Reel 2", "Reel 3", "Reel 4", "Reel 5", "Reel 6"],
  );
});

test("F14 — Reel Editor: Text View accepts whitespace or comma-separated IDs and validates IDs", () => {
  const bp = createSampleBlueprint();
  const knownIds = bp.symbols.map((s) => s.id);
  const [s1, s2, s3] = knownIds;

  // Accept comma, space, tab, and newline separated IDs
  const mixedText = `  ${s1}, ${s2}\n${s3}\t${s1} ,  ${s2}  `;
  const parsedValid = parseReelStopsText(mixedText, knownIds);
  assert.equal(parsedValid.isValid, true);
  assert.deepEqual(parsedValid.tokens, [s1, s2, s3, s1, s2]);
  assert.equal(parsedValid.unknownSymbolIds.length, 0);

  // Detect unknown IDs in Text View
  const badText = `${s1}, sym-unknown-99, ${s2} bogus_id`;
  const parsedInvalid = parseReelStopsText(badText, knownIds);
  assert.equal(parsedInvalid.isValid, false);
  assert.deepEqual(parsedInvalid.unknownSymbolIds, [
    "sym-unknown-99",
    "bogus_id",
  ]);

  // Apply text stops to reel and format back
  let config = reelConfigurationFromBlueprint(bp);
  config = applyTextStopsToReel(config, 2, mixedText);
  assert.deepEqual(config.strips[2], [s1, s2, s3, s1, s2]);
  assert.equal(
    formatReelStopsToText(config.reels[2], "comma"),
    `${s1}, ${s2}, ${s3}, ${s1}, ${s2}`,
  );
});

test("F14 — Reel Editor: Validation detects unknown symbol IDs, empty reel, invalid weights, duplicate stop corruption, and invalid reel count", () => {
  const bp = createSampleBlueprint();
  let config = reelConfigurationFromBlueprint(bp);

  // Baseline valid configuration
  const baselineReport = validateReelConfiguration(config, bp.symbols);
  assert.equal(baselineReport.valid, true);
  assert.equal(baselineReport.issues.length, 0);

  // 1. Unknown symbol ID
  const withUnknown = appendStopToReel(config, 0, "sym-does-not-exist", 1);
  const repUnknown = validateReelConfiguration(withUnknown, bp.symbols);
  assert.equal(repUnknown.valid, false);
  assert.deepEqual(repUnknown.unknownSymbolIds, ["sym-does-not-exist"]);
  assert.ok(repUnknown.issues.some((i) => i.kind === "unknown_symbol_id"));

  // 2. Empty reel
  const withEmpty = applyTextStopsToReel(config, 1, "   ");
  const repEmpty = validateReelConfiguration(withEmpty, bp.symbols);
  assert.equal(repEmpty.valid, false);
  assert.deepEqual(repEmpty.emptyReelIndices, [1]);
  assert.ok(repEmpty.issues.some((i) => i.kind === "empty_reel"));

  // 3. Invalid weights
  let withInvalidWeight = setWeightsEnabled(config, true);
  withInvalidWeight = updateStopWeight(withInvalidWeight, 0, 0, 0);
  withInvalidWeight = updateStopWeight(withInvalidWeight, 0, 1, -5);
  const repWeight = validateReelConfiguration(withInvalidWeight, bp.symbols);
  assert.equal(repWeight.valid, false);
  assert.equal(repWeight.invalidWeightStops.length, 2);
  assert.ok(repWeight.issues.some((i) => i.kind === "invalid_weight"));

  // 4. Duplicate stop corruption (duplicate stop ID & corrupted position)
  const corrupted: typeof config = {
    ...config,
    reels: config.reels.map((r, rIdx) =>
      rIdx === 0
        ? {
            ...r,
            stops: r.stops.map((st, sIdx) =>
              sIdx === 1
                ? { ...st, id: r.stops[0].id, position: 99 }
                : st,
            ),
          }
        : r,
    ),
  };
  const repCorrupted = validateReelConfiguration(corrupted, bp.symbols);
  assert.equal(repCorrupted.valid, false);
  assert.ok(repCorrupted.duplicateStopIds.includes(config.reels[0].stops[0].id));
  assert.ok(repCorrupted.corruptedPositionStops.length >= 1);
  assert.ok(
    repCorrupted.issues.some((i) => i.kind === "duplicate_stop_corruption"),
  );

  // Repair stop corruption restores full validity
  const repaired = repairStopCorruption(corrupted);
  const repRepaired = validateReelConfiguration(repaired, bp.symbols);
  assert.equal(repRepaired.valid, true);

  // 5. Invalid reel count (< 3 reels or > 8 reels)
  let tooFewReels = removeReel(config, 4);
  tooFewReels = removeReel(tooFewReels, 3);
  tooFewReels = removeReel(tooFewReels, 2); // now 2 reels (< 3)
  const repCount = validateReelConfiguration(tooFewReels, bp.symbols);
  assert.equal(repCount.valid, false);
  assert.equal(repCount.invalidReelCount, true);
  assert.ok(repCount.issues.some((i) => i.kind === "invalid_reel_count"));
});

test("F14 — Reel Editor: Save into GameBlueprint.reelConfiguration, Undo/Redo, and local persistence without backend", async () => {
  const bp = createSampleBlueprint();
  const [s1, s2, s3] = bp.symbols.map((s) => s.id);

  let history = createHistory(reelConfigurationFromBlueprint(bp));
  assert.equal(history.past.length, 0);

  // Perform edits with Undo/Redo
  const edited1 = applyTextStopsToReel(
    history.present,
    0,
    `${s1}, ${s2}, ${s3}, ${s1}`,
  );
  history = commitHistory(history, edited1, "Update Reel 1 stops");
  assert.equal(history.past.length, 1);

  const edited2 = setWeightsEnabled(history.present, true);
  const edited3 = updateStopWeight(edited2, 0, 0, 42);
  history = commitHistory(history, edited3, "Set stop #1 weight");
  assert.equal(history.present.reels[0].stops[0].weight, 42);

  // Undo & Redo
  const undone = undoHistory(history);
  assert.ok(undone);
  history = undone.state;
  assert.equal(history.present.weightsEnabled, false);
  assert.equal(history.future.length, 1);

  const redone = redoHistory(history);
  assert.ok(redone);
  history = redone.state;
  assert.equal(history.present.weightsEnabled, true);
  assert.equal(history.present.reels[0].stops[0].weight, 42);

  // Save into GameBlueprint.reelConfiguration
  const savedBp = applyReelConfigurationToBlueprint(bp, history.present);
  assert.ok(savedBp.reelConfiguration, "GameBlueprint.reelConfiguration is populated");
  assert.equal(savedBp.reelConfiguration?.weightsEnabled, true);
  assert.equal(savedBp.reelConfiguration?.reels[0].stops[0].weight, 42);
  assert.deepEqual(savedBp.reelConfiguration?.strips[0], [s1, s2, s3, s1]);
  assert.deepEqual(savedBp.reels.strips[0], [s1, s2, s3, s1]);
  assert.equal(getReelConfiguration(savedBp), savedBp.reelConfiguration);

  // Validate blueprint integrity & migration preservation
  assert.equal(validateBlueprint(savedBp).integrityOk, true);
  const migrated = migrateBlueprint(savedBp);
  assert.deepEqual(migrated.reelConfiguration?.strips[0], [s1, s2, s3, s1]);
  assert.equal(migrated.reelConfiguration?.reels[0].stops[0].weight, 42);

  // Also test UPDATE_REEL command integration & LocalProjectPersistenceService
  const cmdBp = executeEditorCommand(
    bp,
    createEditorCommand("UPDATE_REEL", { reelConfiguration: history.present }),
  );
  assert.deepEqual(cmdBp.reelConfiguration?.strips[0], [s1, s2, s3, s1]);

  const localStore = new LocalProjectPersistenceService("test:f14:reels");
  const created = await localStore.createProject({
    title: "Local Reel Test",
    theme: "Roman",
  });
  await localStore.saveProject(created.id, savedBp);
  const reloaded = await localStore.loadProject(created.id);
  assert.ok(reloaded?.blueprint.reelConfiguration);
  assert.deepEqual(reloaded?.blueprint.reelConfiguration?.strips[0], [
    s1,
    s2,
    s3,
    s1,
  ]);
  assert.equal(
    reloaded?.blueprint.reelConfiguration?.reels[0].stops[0].weight,
    42,
  );
});
