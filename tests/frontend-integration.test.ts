import assert from "node:assert/strict";
import test from "node:test";

import { createBlueprint } from "../src/lib/blueprint/factory";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { createEditorCommand, executeEditorCommand } from "../src/lib/editor/commands";
import { StudioEditorStore } from "../src/lib/editor/store";
import {
  exportBlueprintJson,
  exportProjectJson,
} from "../src/lib/export/operations";
import {
  analyzeDeleteElementDependencies,
  analyzeDeleteSymbolDependencies,
  analyzeGridSizeChangeDependencies,
  changeBlueprintGridSize,
  deleteElementFromBlueprint,
  deleteSymbolFromBlueprint,
  importAndMigrateBlueprint,
  INTEGRATION_FLOW_STAGES,
  reconcileBlueprintState,
  verifyBlueprintFlowReadiness,
} from "../src/lib/integration";
import { LocalProjectPersistenceService } from "../src/lib/persistence/project-persistence";
import {
  buildPreviewPresentation,
  createDefaultPreviewState,
} from "../src/lib/preview";

test("F21.1: 14-Stage End-to-End Studio Flow Readiness & Pipeline Verification", () => {
  assert.equal(INTEGRATION_FLOW_STAGES.length, 14);
  assert.deepEqual(
    INTEGRATION_FLOW_STAGES.map((s) => s.label),
    [
      "Dashboard",
      "New Game",
      "Project",
      "Design",
      "Symbol Set",
      "Symbol",
      "Canvas",
      "Layers",
      "Scenes",
      "Reels",
      "Paylines",
      "Paytable",
      "Preview",
      "Export",
    ],
  );

  const bp = createBlueprint({
    id: "prj_f21_flow",
    title: "valhalla-kronos",
    theme: "Norse Mythology",
    styleGuide: "Runic Gold & Ice",
    columns: 5,
    rows: 3,
    paylineCount: 20,
    rtpTarget: 96.4,
    volatility: "high",
  });

  const report = verifyBlueprintFlowReadiness(bp);
  assert.equal(report.projectId, "prj_f21_flow");
  assert.equal(report.totalCount, 14);
  assert.equal(report.readyCount, 14);
  assert.equal(report.allReady, true);
  assert.equal(report.allStagesReady, true);

  for (const stage of report.stages) {
    assert.equal(stage.ready, true, `Stage ${stage.id} should be ready`);
    assert.equal(stage.status, "ready");
    assert.ok(stage.href.length > 0);
    assert.ok(stage.summary.length > 0);
  }
});

test("F21.2: Cross-Editor Single Source of Truth Reconciliation (Zero State Drift)", () => {
  let bp = createBlueprint({
    id: "prj_f21_sync",
    title: "Solar Dynasty",
    theme: "Imperial Sun",
    columns: 5,
    rows: 3,
    paylineCount: 20,
  });

  // 1. Add a new symbol via ADD_SYMBOL command
  const customSymbolId = "sym-phoenix-emperor";
  bp = executeEditorCommand(
    bp,
    createEditorCommand("ADD_SYMBOL", {
      symbol: {
        id: customSymbolId,
        code: "PHX",
        name: "Phoenix Emperor",
        tier: "high",
        glyph: "🦅",
        assetId: null,
        payouts: { "3": 25, "4": 100, "5": 500 },
        reelWeight: 8,
        symbolSetId: bp.symbolSets[0]?.id ?? null,
        isWild: true,
      },
      symbolSetId: bp.symbolSets[0]?.id ?? null,
    }),
  );

  // Verify symbol is reflected in symbols, specialSymbols, symbolSets, elements, and paytableConfiguration
  assert.ok(bp.symbols.some((s) => s.id === customSymbolId));
  assert.ok(
    bp.specialSymbols.some(
      (sp) => sp.symbolId === customSymbolId && sp.behaviour === "wild",
    ),
    "Wild symbol flag must sync to specialSymbols",
  );
  assert.ok(
    bp.symbolSets[0]?.symbolIds.includes(customSymbolId),
    "Symbol set must include newly added symbol",
  );
  assert.ok(
    bp.paytable.some(
      (pt) => pt.symbolId === customSymbolId && pt.ofAKind === 5 && pt.payout === 500,
    ),
    "Paytable entries must include newly added symbol payouts",
  );
  assert.ok(
    bp.paytableConfiguration?.symbolRows.some((r) => r.symbolId === customSymbolId),
    "F16 paytableConfiguration must include newly added symbol row",
  );

  // 2. Update symbol payout in Symbol Editor and verify Paytable, Preview, and Export reflect it
  bp = executeEditorCommand(
    bp,
    createEditorCommand("UPDATE_SYMBOL", {
      symbolId: customSymbolId,
      patch: {
        name: "Grand Phoenix Emperor",
        payouts: { "3": 40, "4": 160, "5": 888 },
      },
    }),
  );

  assert.equal(
    bp.paytable.find((pt) => pt.symbolId === customSymbolId && pt.ofAKind === 5)?.payout,
    888,
  );
  assert.equal(
    bp.paytableConfiguration?.symbolRows.find((r) => r.symbolId === customSymbolId)
      ?.payouts[5],
    888,
  );

  // Verify Preview presentation reflects updated symbol and grid
  const previewState = createDefaultPreviewState(bp);
  const previewPresentation = buildPreviewPresentation(bp, previewState);
  assert.equal(previewPresentation.stage.reelArea.columns, 5);
  assert.equal(previewPresentation.stage.reelArea.rows, 3);

  // Verify Export reflects the exact updated state
  const exportedJson = exportBlueprintJson(bp);
  assert.ok(exportedJson.json.includes("Grand Phoenix Emperor"));
  assert.ok(exportedJson.json.includes("888"));
});

test("F21.3: Delete Symbol Dependency Analysis (Reel, Paytable, Payline, Feature) & Safe Deletion", () => {
  let bp = createBlueprint({
    id: "prj_f21_del_sym",
    title: "Temple of Lightning",
    theme: "Mythology",
    columns: 5,
    rows: 3,
    paylineCount: 20,
  });

  // Pick a Wild or Scatter symbol or configure one that is used across reel, paytable, paylines, and features
  const targetSymbol = bp.symbols.find((s) => s.isWild) ?? bp.symbols[0]!;
  // Ensure targetSymbol is also referenced by an enabled feature and on every reel
  bp = reconcileBlueprintState({
    ...bp,
    symbols: bp.symbols.map((s) =>
      s.id === targetSymbol.id
        ? { ...s, isWild: true, isScatter: true }
        : s,
    ),
    reels: {
      ...bp.reels,
      strips: bp.reels.strips.map((strip) =>
        strip.includes(targetSymbol.id) ? strip : [targetSymbol.id, ...strip],
      ),
    },
    features: bp.features.map((f, idx) =>
      idx === 0
        ? {
            ...f,
            kind: "free_spins",
            enabled: true,
            params: { ...f.params, triggerSymbolId: targetSymbol.id },
          }
        : f,
    ),
  });

  const report = analyzeDeleteSymbolDependencies(bp, targetSymbol.id);
  assert.equal(report.exists, true);
  assert.equal(report.hasWarnings, true);
  assert.ok(report.reelReferences.length > 0, "Must warn about reel strip references");
  assert.ok(
    report.paytableReferences.length > 0,
    "Must warn about paytable references",
  );
  assert.ok(
    report.paylineReferences.length > 0,
    "Must warn about payline-related configuration references",
  );
  assert.ok(
    report.featureReferences.length > 0,
    "Must warn about feature configuration references",
  );

  const warningCategories = new Set(report.warnings.map((w) => w.category));
  assert.ok(warningCategories.has("reel"));
  assert.ok(warningCategories.has("paytable"));
  assert.ok(warningCategories.has("payline"));
  assert.ok(warningCategories.has("feature"));

  // Execute safe deletion with replacement symbol
  const replacementSymbol = bp.symbols.find((s) => s.id !== targetSymbol.id)!;
  const { blueprint: afterDelete } = deleteSymbolFromBlueprint(bp, targetSymbol.id, {
    replacementSymbolId: replacementSymbol.id,
  });

  assert.equal(
    afterDelete.symbols.some((s) => s.id === targetSymbol.id),
    false,
    "Deleted symbol must be removed from symbols[]",
  );
  assert.equal(
    afterDelete.paytable.some((pt) => pt.symbolId === targetSymbol.id),
    false,
    "Deleted symbol must be removed from paytable[]",
  );
  assert.equal(
    afterDelete.reels.strips.some((strip) => strip.includes(targetSymbol.id)),
    false,
    "Deleted symbol must be replaced/removed from all reel strips",
  );
  assert.equal(
    afterDelete.symbolSets.some((set) => set.symbolIds.includes(targetSymbol.id)),
    false,
    "Deleted symbol must be removed from symbolSets",
  );
  assert.equal(validateBlueprint(afterDelete).integrityOk, true);
});

test("F21.4: Delete Element Dependency Analysis (Scene Layer, Symbol Set, Animation, Asset Reference) & Safe Deletion", () => {
  let bp = createBlueprint({
    id: "prj_f21_del_el",
    title: "Dragon Fortress",
    theme: "Fantasy",
    columns: 5,
    rows: 3,
  });

  const targetElement = bp.elements.find((el) => el.type === "symbol_set") ?? bp.elements[0]!;
  const primaryAssetId = bp.assets[0]?.id ?? "ast-test-1";

  // Ensure the element is referenced by a scene object on a layer, a symbol set, an animation, and an asset
  bp = {
    ...bp,
    elements: bp.elements.map((el) =>
      el.id === targetElement.id
        ? {
            ...el,
            assetId: primaryAssetId,
            imageHistory: [
              {
                id: "rev-1",
                asset: { provider: "project", assetId: primaryAssetId },
                createdAt: new Date().toISOString(),
                source: "upload",
                label: "Initial Upload",
              },
            ],
          }
        : el,
    ),
    scenes: bp.scenes.map((scene, idx) =>
      idx === 0
        ? {
            ...scene,
            objects: [
              ...(scene.objects ?? []),
              {
                id: "obj-el-ref",
                name: "Placed Element Object",
                kind: "element",
                refId: targetElement.id,
                assetId: primaryAssetId,
                layerId: bp.layers[0]!.id,
                x: 100,
                y: 100,
                width: 200,
                height: 200,
                rotation: 0,
                opacity: 1,
                visible: true,
                locked: false,
                blur: 0,
                fill: null,
                stroke: null,
                strokeWidth: 0,
                radius: 0,
                shape: "rect",
                arrow: false,
                points: [],
                text: null,
                fontSize: 16,
                fontWeight: 600,
                align: "center",
              },
            ],
          }
        : scene,
    ),
    animations: [
      ...bp.animations,
      {
        id: "anim-el-target",
        name: "Element Pulse",
        target: targetElement.id,
        trigger: "win",
        kind: "pulse",
        durationMs: 600,
        loop: false,
        easing: "ease-in-out",
      },
    ],
  };

  const report = analyzeDeleteElementDependencies(bp, targetElement.id);
  assert.equal(report.exists, true);
  assert.equal(report.hasWarnings, true);
  assert.ok(
    report.sceneLayerReferences.length > 0,
    "Must warn about scene layer usage",
  );
  assert.ok(
    report.symbolSetReferences.length > 0,
    "Must warn about symbol set usage",
  );
  assert.ok(
    report.animationReferences.length > 0,
    "Must warn about animation bindings",
  );
  assert.ok(
    report.assetReferences.length > 0,
    "Must warn about asset references",
  );

  const categories = new Set(report.warnings.map((w) => w.category));
  assert.ok(categories.has("scene_layer"));
  assert.ok(categories.has("symbol_set"));
  assert.ok(categories.has("animation"));
  assert.ok(categories.has("asset_reference"));

  // Delete the element and verify cleanup
  const { blueprint: afterDelete } = deleteElementFromBlueprint(bp, targetElement.id);
  assert.equal(
    afterDelete.elements.some((el) => el.id === targetElement.id),
    false,
  );
  assert.equal(
    afterDelete.scenes[0]?.objects?.some(
      (obj) => obj.kind === "element" && obj.refId === targetElement.id,
    ),
    false,
  );
  assert.equal(
    afterDelete.animations.some((a) => a.target === targetElement.id),
    false,
  );
});

test("F21.5: Change Grid Size Dependency Analysis (Incompatible Paylines & Layout Structures) & Safe Resize", () => {
  let bp = createBlueprint({
    id: "prj_f21_grid",
    title: "Mega Grid Quest",
    theme: "Adventure",
    columns: 5,
    rows: 4,
    paylineCount: 20,
  });

  // Place a reel_frame element object on Scene 1 so layout warnings are also exercised
  const frameEl = bp.elements.find((e) => e.type === "reel_frame");
  if (frameEl) {
    bp = {
      ...bp,
      scenes: bp.scenes.map((s, idx) =>
        idx === 0
          ? {
              ...s,
              objects: [
                ...(s.objects ?? []),
                {
                  id: "obj-reel-frame",
                  name: "Main Reel Frame",
                  kind: "element",
                  refId: frameEl.id,
                  assetId: frameEl.assetId,
                  layerId: bp.layers[0]!.id,
                  x: 80,
                  y: 60,
                  width: 800,
                  height: 500,
                  rotation: 0,
                  opacity: 1,
                  visible: true,
                  locked: false,
                  blur: 0,
                  fill: null,
                  stroke: null,
                  strokeWidth: 0,
                  radius: 0,
                  shape: "rect",
                  arrow: false,
                  points: [],
                  text: null,
                  fontSize: 16,
                  fontWeight: 600,
                  align: "center",
                },
              ],
            }
          : s,
      ),
    };
  }

  // Analyze shrinking from 5x4 -> 3x3 (triggers length mismatch + row index >= 3 clipping + reel truncation + layout warning)
  const shrinkReport = analyzeGridSizeChangeDependencies(bp, 3, 3);
  assert.equal(shrinkReport.changed, true);
  assert.equal(shrinkReport.hasWarnings, true);
  assert.ok(
    shrinkReport.incompatiblePaylines.length > 0,
    "Shrinking 5x4 -> 3x3 must flag incompatible paylines",
  );
  assert.equal(shrinkReport.truncatedColumnsCount, 2);
  assert.ok(
    shrinkReport.sceneLayoutWarnings.length > 0,
    "Must warn about scene reel-area / frame layout structures",
  );

  // Apply grid resize to 6x4 via changeBlueprintGridSize
  const { blueprint: expandedBp, report: expandReport } = changeBlueprintGridSize(bp, {
    columns: 6,
    rows: 4,
    paylineResolution: "adapt",
  });
  assert.equal(expandReport.addedColumnsCount, 1);
  assert.equal(expandedBp.reels.columns, 6);
  assert.equal(expandedBp.reels.rows, 4);
  assert.equal(expandedBp.grid?.columns, 6);
  assert.equal(expandedBp.grid?.rows, 4);
  assert.equal(expandedBp.reels.strips.length, 6);
  assert.equal(expandedBp.reelConfiguration?.reels.length, 6);
  assert.ok(
    expandedBp.paylines.every((pl) => pl.pattern.length === 6),
    "All paylines must be adapted to 6 columns",
  );
  assert.ok(
    expandedBp.paytableConfiguration?.matchCounts.includes(6),
    "Paytable match counts must include 6-of-a-kind after resizing to 6 columns",
  );
  assert.equal(validateBlueprint(expandedBp).integrityOk, true);
});

test("F21.6: Blueprint Import, Schema Validation & Legacy v0 Version Migration", () => {
  // 1. Legacy v0 unversioned blueprint with root-level title/theme, reels.cols, and missing F14/F15/F16 slices
  const legacyV0Payload = JSON.stringify({
    version: 0,
    title: "Legacy Golden Pharaoh",
    theme: "Ancient Egypt",
    reels: {
      cols: 5,
      rows: 3,
      evaluation: "lines",
      spinDirection: "down",
      strips: [
        ["sym-1", "sym-2", "sym-3", "sym-4"],
        ["sym-1", "sym-2", "sym-3", "sym-4"],
        ["sym-1", "sym-2", "sym-3", "sym-4"],
        ["sym-1", "sym-2", "sym-3", "sym-4"],
        ["sym-1", "sym-2", "sym-3", "sym-4"],
      ],
    },
    symbols: [
      { id: "sym-1", code: "PHR", name: "Pharaoh", tier: "high", glyph: "👑" },
      { id: "sym-2", code: "ANK", name: "Ankh", tier: "mid", glyph: "☥" },
      { id: "sym-3", code: "SCB", name: "Scarab", tier: "low", glyph: "🪲" },
      { id: "sym-4", code: "WLD", name: "Horus Wild", tier: "special", glyph: "🦅", isWild: true },
    ],
  });

  const legacyResult = importAndMigrateBlueprint(legacyV0Payload, {
    preserveProjectId: "prj_migrated_v0",
  });
  assert.equal(legacyResult.ok, true);
  assert.equal(legacyResult.migrated, true);
  assert.equal(legacyResult.sourceFormat, "blueprint-legacy");
  assert.equal(legacyResult.sourceVersion, 0);
  assert.equal(legacyResult.targetVersion, 1);
  assert.ok(legacyResult.migrationLog.length >= 3);
  assert.ok(legacyResult.blueprint);
  assert.equal(legacyResult.blueprint.version, 1);
  assert.equal(legacyResult.blueprint.meta.id, "prj_migrated_v0");
  assert.equal(legacyResult.blueprint.meta.title, "Legacy Golden Pharaoh");
  assert.equal(legacyResult.blueprint.reels.columns, 5);
  assert.ok(legacyResult.blueprint.reelConfiguration);
  assert.ok(legacyResult.blueprint.paylineConfiguration);
  assert.ok(legacyResult.blueprint.paytableConfiguration);
  assert.ok(legacyResult.blueprint.elements.length > 0);

  // 2. Round-trip import of a ProjectExportPackage envelope
  const fullProjectPkg = exportProjectJson(legacyResult.blueprint);
  const pkgResult = importAndMigrateBlueprint(fullProjectPkg.json);
  assert.equal(pkgResult.ok, true);
  assert.equal(pkgResult.sourceFormat, "project-json");
  assert.equal(pkgResult.blueprint?.meta.title, "Legacy Golden Pharaoh");

  // 3. Reject invalid JSON, future unsupported version, and corrupted schema
  const badSyntax = importAndMigrateBlueprint("{not-valid-json");
  assert.equal(badSyntax.ok, false);
  assert.ok(badSyntax.errors[0]?.includes("Invalid JSON"));

  const futureVer = importAndMigrateBlueprint(
    JSON.stringify({ version: 99, meta: { title: "Future" }, reels: {}, symbols: [] }),
  );
  assert.equal(futureVer.ok, false);
  assert.ok(futureVer.errors[0]?.includes("Unsupported future blueprint version"));

  const corrupted = importAndMigrateBlueprint(
    JSON.stringify({ version: 1, meta: null, reels: null, symbols: null }),
  );
  assert.equal(corrupted.ok, false);
  assert.ok(corrupted.errors[0]?.includes("Critical schema corruption"));
});

test("F21.7: Consistent Cross-Editor Undo/Redo, Autosave Toggle, Dirty Indicator & Reload Persistence", async () => {
  const persistence = new LocalProjectPersistenceService("test:f21:persistence");
  const created = await persistence.createProject({
    title: "Atlantis Odyssey",
    theme: "Underwater Kingdom",
    styleGuide: "Bioluminescent Coral & Gold",
    columns: 5,
    rows: 3,
    paylineCount: 20,
    rtpTarget: 96.0,
    volatility: "medium",
  });

  const store = new StudioEditorStore({
    id: created.id,
    title: created.title,
    revision: created.revision,
    blueprint: created.blueprint,
  });

  // Initial state: clean, autosave off
  assert.equal(store.getState().dirty, false);
  assert.equal(store.getState().autosaveEnabled, false);

  // Toggle optional autosave on
  store.setAutosaveEnabled(true);
  assert.equal(store.getState().autosaveEnabled, true);

  // Execute a sequence of commands across 5 different editors:
  // 1) Project Overview (UPDATE_META)
  store.execute("UPDATE_META", { patch: { title: "Atlantis Odyssey Deluxe" } });
  assert.equal(store.getState().dirty, true);

  // 2) Symbol Editor (UPDATE_SYMBOL)
  const firstSymId = store.getState().activeProject!.blueprint.symbols[0]!.id;
  store.execute("UPDATE_SYMBOL", {
    symbolId: firstSymId,
    patch: { name: "Trident Crown", reelWeight: 15 },
  });

  // 3) Reel / Grid Editor (CHANGE_GRID_SIZE -> 6x4)
  store.execute("CHANGE_GRID_SIZE", {
    columns: 6,
    rows: 4,
    paylineResolution: "adapt",
  });
  assert.equal(store.getState().activeProject?.blueprint.reels.columns, 6);
  assert.equal(store.getState().activeProject?.blueprint.paylines[0]?.pattern.length, 6);

  // 4) Layers Editor (REORDER_LAYER)
  const firstLayerId = store.getState().activeProject!.blueprint.layers[0]!.id;
  store.execute("REORDER_LAYER", { layerId: firstLayerId, targetIndex: 2 });

  // 5) Math & Features Editor (UPDATE_MATH)
  store.execute("UPDATE_MATH", { patch: { rtpTarget: 96.8 } });

  assert.equal(store.getState().undoStack.length, 5);
  assert.equal(store.canUndo(), true);

  // Undo step-by-step across editors and verify consistent state rollback
  store.undo(); // undo UPDATE_MATH
  assert.equal(store.getState().activeProject?.blueprint.math.rtpTarget, 96.0);

  store.undo(); // undo REORDER_LAYER
  assert.equal(store.getState().activeProject?.blueprint.layers[0]?.id, firstLayerId);

  store.undo(); // undo CHANGE_GRID_SIZE
  assert.equal(store.getState().activeProject?.blueprint.reels.columns, 5);
  assert.equal(store.getState().activeProject?.blueprint.paylines[0]?.pattern.length, 5);

  // Redo CHANGE_GRID_SIZE and UPDATE_LAYER and UPDATE_MATH
  store.redo();
  store.redo();
  store.redo();
  assert.equal(store.getState().activeProject?.blueprint.reels.columns, 6);
  assert.equal(store.getState().activeProject?.blueprint.math.rtpTarget, 96.8);

  // Save project and verify dirty indicator clears
  const currentBp = store.getState().activeProject!.blueprint;
  const savedRecord = await persistence.saveProject(created.id, currentBp);
  store.dispatch({
    type: "MARK_SAVED",
    revision: savedRecord.revision,
    blueprint: savedRecord.blueprint,
  });
  assert.equal(store.getState().dirty, false);

  // Reload project from persistence and verify zero data loss
  const reloaded = await persistence.loadProject(created.id);
  assert.ok(reloaded);
  assert.equal(reloaded.blueprint.meta.title, "Atlantis Odyssey Deluxe");
  assert.equal(reloaded.blueprint.symbols[0]?.name, "Trident Crown");
  assert.equal(reloaded.blueprint.reels.columns, 6);
  assert.equal(reloaded.blueprint.reels.rows, 4);
  assert.equal(reloaded.blueprint.math.rtpTarget, 96.8);
});
