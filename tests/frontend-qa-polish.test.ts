import assert from "node:assert/strict";
import Module from "node:module";
import test from "node:test";

// Allow importing server services in Node tsx test runner
type ModuleLoader = (request: string, parent: unknown, isMain: boolean) => unknown;
const origLoad = (Module as unknown as { _load: ModuleLoader })._load;
(Module as unknown as { _load: ModuleLoader })._load = function (
  request: string,
  parent: unknown,
  isMain: boolean,
) {
  if (request === "server-only") return {};
  if (request === "next/cache") return { revalidatePath: () => {} };
  return origLoad.call(this, request, parent, isMain);
};

import { createBlueprint } from "../src/lib/blueprint/factory";
import type { AssetRef } from "../src/lib/blueprint/types";
import {
  clampScale,
  fitViewport,
  zoomViewport,
} from "../src/lib/canvas/geometry";
import {
  alignObjects,
  appendObject,
  createGroup,
  moveObjects,
  objectsInMarquee,
  patchObjects,
  reorderObjects,
  rotateObjects,
  scaleObjects,
  ungroup,
} from "../src/lib/canvas/operations";
import { applyDesign, designDocFromBlueprint } from "../src/lib/design/migrate";
import {
  addElement,
  addSymbols,
  addVariant,
  setSymbolImage,
} from "../src/lib/design/operations";
import { StudioEditorStore } from "../src/lib/editor/store";
import { exportBlueprintJson, exportProjectZip } from "../src/lib/export/operations";
import {
  importAndMigrateBlueprint,
  reconcileBlueprintState,
  verifyBlueprintFlowReadiness,
} from "../src/lib/integration/operations";
import {
  addPayline,
  applyPaylineConfigurationToBlueprint,
  deletePayline,
  duplicatePayline,
  paylineConfigurationFromBlueprint,
} from "../src/lib/paylines/operations";
import {
  applyPaytableConfigurationToBlueprint,
  paytableConfigurationFromBlueprint,
  setPaytableCellPayout,
  toggleSymbolWild,
} from "../src/lib/paytable/operations";
import {
  auditBlueprintDataIntegrity,
  benchmarkStudioPerformance,
  sanitizeBlueprintDataIntegrity,
  verifySection2EngineContract,
} from "../src/lib/qa";
import {
  addReel,
  appendStopToReel,
  applyReelConfigurationToBlueprint,
  applyTextStopsToReel,
  duplicateStopInReel,
  reelConfigurationFromBlueprint,
  removeStopFromReel,
  reorderStopInReel,
} from "../src/lib/reels/operations";
import {
  addSceneToBlueprint,
  deleteSceneFromBlueprint,
} from "../src/lib/scenes/operations";

test("F22.1 — All 35 Major Studio Workflows execute end-to-end with full state integrity", async () => {
  const {
    createFolder,
    createProject,
    deleteFolder,
    deleteProject,
    duplicateProject,
    getProject,
    getWorkspace,
    restoreProject,
    updateProject,
  } = await import("../src/server/workspace-service");
  await getWorkspace();

  // 1. Create project
  const created = await createProject({
    title: `F22 QA Master Slot ${Date.now().toString(36)}`,
    theme: "Olympus Lightning",
    styleGuide: "Crisp gold & cobalt",
    columns: 5,
    rows: 3,
    paylineCount: 20,
    volatility: "high",
  });
  let createdFolderId: string | null = null;

  try {
    assert.ok(created.id);
    assert.ok(created.title.startsWith("F22 QA Master Slot"));

    // 2. Rename project
    const renamedTitle = `F22 QA Master Slot Renamed ${Date.now().toString(36)}`;
    const renamed = await updateProject(created.id, {
      title: renamedTitle,
    });
    assert.equal(renamed.title, renamedTitle);
    assert.equal(renamed.blueprint.meta.title, renamedTitle);

    // 3. Duplicate project
    const duplicated = await duplicateProject(created.id);
    assert.ok(duplicated.id !== created.id);
    assert.ok(/copy/i.test(duplicated.title));

    // 4. Delete project (soft-delete + restore verification)
    await deleteProject(duplicated.id);
    const restored = await restoreProject(duplicated.id);
    assert.equal(restored.id, duplicated.id);
    await deleteProject(duplicated.id);

    // 5. Create folder
    const folderName = `F22 QA Folder ${Date.now().toString(36)}`;
    const folder = await createFolder(folderName, "");
    createdFolderId = folder.id;
    assert.equal(folder.path, folderName);

  // 6. Move project
  const moved = await updateProject(created.id, { folderPath: folder.path });
  assert.equal(moved.folderPath, folder.path);
  assert.equal(moved.blueprint.meta.folderPath, folder.path);

  let bp = moved.blueprint;

  // 7. Add symbol set
  let doc = designDocFromBlueprint(bp);
  const addedSet = addElement(
    doc,
    {
      type: "symbol_set",
      name: "F22 Mythic Relics Set",
      symbolType: "custom",
      valueTier: "high",
      count: 2,
    },
    { glyphs: ["⚡", "🏛", "🏺", "🛡"] },
  );
  doc = addedSet.doc;
  assert.ok(doc.elements.some((e) => e.id === addedSet.id));

  // 8. Add symbol
  const addedSymbolsRes = addSymbols(
    doc,
    addedSet.id,
    [{ name: "Mythic Relic Gold" }],
    { glyphs: ["⚡", "🏛", "🏺", "🛡"] },
  );
  doc = addedSymbolsRes.doc;
  assert.equal(addedSymbolsRes.ids.length, 1);
  const addedSymbolId = addedSymbolsRes.ids[0];
  assert.ok(doc.symbols.some((s) => s.id === addedSymbolId));

  // 9. Replace symbol image
  const customAsset: AssetRef = {
    id: "asset-f22-symbol-img",
    name: "relic_gold.png",
    kind: "image",
    uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    mime: "image/png",
    width: 128,
    height: 128,
    state: "linked",
    tags: ["qa", "f22"],
  };
  doc = { ...doc, assets: [...doc.assets, customAsset] };
  doc = setSymbolImage(doc, addedSymbolId, customAsset, "F22 QA symbol artwork");
  const updatedSym = doc.symbols.find((s) => s.id === addedSymbolId);
  assert.equal(updatedSym?.assetId, customAsset.id);

  // 10. Create variant
  const variantRes = addVariant(doc, addedSymbolId, {
    name: "Relic Gold Variant",
    tags: ["golden"],
  });
  doc = variantRes.doc;
  const symWithVariant = doc.symbols.find((s) => s.id === addedSymbolId);
  assert.ok((symWithVariant?.variants?.length ?? 0) >= 1);

  bp = reconcileBlueprintState(applyDesign(bp, doc));

  // 11. Add scene (delete 3rd default scene first so slot 3 is open, and use <= 18 char name)
  if (bp.scenes.length >= 3) {
    bp = deleteSceneFromBlueprint(bp, bp.scenes[bp.scenes.length - 1].id).blueprint;
  }
  const addedSceneRes = addSceneToBlueprint(bp, {
    name: "Bonus Chamber",
    kind: "bonus",
  });
  assert.equal(addedSceneRes.ok, true);
  assert.ok(addedSceneRes.addedScene);
  bp = addedSceneRes.blueprint;
  assert.ok(bp.scenes.some((s) => s.id === addedSceneRes.addedScene!.id));

  // 12–19. Canvas & Layer Operations (Move, Resize, Rotate, Hide, Lock, Group, Ungroup, Reorder)
  let sceneObjects = structuredClone(bp.scenes[0].objects ?? []);
  if (sceneObjects.length < 2) {
    const defaultLayerId = bp.layers[0]?.id ?? "layer-bg";
    const baseObj = {
      kind: "element" as const,
      refId: bp.elements[0]?.id ?? null,
      layerId: defaultLayerId,
      assetId: null,
      x: 100,
      y: 120,
      width: 240,
      height: 160,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      blur: 0,
      fill: null,
      stroke: null,
      strokeWidth: 0,
      radius: 0,
      shape: null,
      arrow: false,
      points: [],
      text: null,
      fontSize: 16,
      fontWeight: 600,
      align: "center" as const,
      groupId: null,
    };
    sceneObjects = appendObject(sceneObjects, {
      ...baseObj,
      id: "obj-f22-1",
      name: "F22 Frame Object",
    }).objects;
    sceneObjects = appendObject(sceneObjects, {
      ...baseObj,
      id: "obj-f22-2",
      name: "F22 Title Object",
      x: 400,
      y: 80,
    }).objects;
  }
  assert.ok(sceneObjects.length >= 2);
  const firstId = sceneObjects[0].id;
  const secondId = sceneObjects[1].id;
  const origX = sceneObjects[0].x;
  const origY = sceneObjects[0].y;

  // 12. Move layer
  sceneObjects = moveObjects(sceneObjects, [firstId], { x: 40, y: 25 });
  assert.equal(sceneObjects.find((o) => o.id === firstId)?.x, origX + 40);
  assert.equal(sceneObjects.find((o) => o.id === firstId)?.y, origY + 25);

  // 13. Resize layer
  const prevWidth = sceneObjects.find((o) => o.id === firstId)!.width;
  sceneObjects = scaleObjects(sceneObjects, [firstId], { x: origX + 40, y: origY + 25 }, 1.5, 1.5);
  assert.ok(sceneObjects.find((o) => o.id === firstId)!.width > prevWidth);

  // 14. Rotate layer
  sceneObjects = rotateObjects(sceneObjects, [firstId], { x: origX + 40, y: origY + 25 }, 30);
  assert.equal(sceneObjects.find((o) => o.id === firstId)?.rotation, 30);

  // 15. Hide layer
  sceneObjects = patchObjects(sceneObjects, [secondId], { visible: false });
  assert.equal(sceneObjects.find((o) => o.id === secondId)?.visible, false);
  sceneObjects = patchObjects(sceneObjects, [secondId], { visible: true });
  assert.equal(sceneObjects.find((o) => o.id === secondId)?.visible, true);

  // 16. Lock layer
  sceneObjects = patchObjects(sceneObjects, [secondId], { locked: true });
  assert.equal(sceneObjects.find((o) => o.id === secondId)?.locked, true);
  sceneObjects = patchObjects(sceneObjects, [secondId], { locked: false });
  assert.equal(sceneObjects.find((o) => o.id === secondId)?.locked, false);

  // 17. Group layers
  const grouped = createGroup(sceneObjects, [firstId, secondId], "F22 Group");
  assert.ok(grouped.groupId);
  sceneObjects = grouped.objects;
  assert.equal(sceneObjects.find((o) => o.id === firstId)?.parentId, grouped.groupId);
  assert.equal(sceneObjects.find((o) => o.id === secondId)?.parentId, grouped.groupId);

  // 18. Ungroup layers
  const ungrouped = ungroup(sceneObjects, [grouped.groupId]);
  sceneObjects = ungrouped.objects;
  assert.equal(sceneObjects.find((o) => o.id === firstId)?.parentId ?? null, null);
  assert.equal(sceneObjects.find((o) => o.id === secondId)?.parentId ?? null, null);

  // 19. Reorder layers
  sceneObjects = reorderObjects(sceneObjects, firstId, "front");
  assert.equal(sceneObjects[sceneObjects.length - 1]?.id, firstId);
  sceneObjects = reorderObjects(sceneObjects, firstId, "back");
  assert.equal(sceneObjects[0]?.id, firstId);

  bp = {
    ...bp,
    scenes: bp.scenes.map((sc, idx) => (idx === 0 ? { ...sc, objects: sceneObjects } : sc)),
  };

  // 20–25. Reel Operations (Create reel, Add stop, Duplicate stop, Move stop, Delete stop, Edit text reel)
  let reelCfg = reelConfigurationFromBlueprint(bp);
  const initialCols = reelCfg.columns;

  // 20. Create reel
  reelCfg = addReel(reelCfg, {
    initialSymbolIds: bp.symbols.slice(0, 6).map((s) => s.id),
  });
  assert.equal(reelCfg.columns, initialCols + 1);
  assert.equal(reelCfg.reels.length, initialCols + 1);

  // 21. Add reel stop
  const r0BeforeCount = reelCfg.reels[0].stops.length;
  reelCfg = appendStopToReel(reelCfg, 0, addedSymbolId, 8);
  assert.equal(reelCfg.reels[0].stops.length, r0BeforeCount + 1);

  // 22. Duplicate stop
  reelCfg = duplicateStopInReel(reelCfg, 0, 0);
  assert.equal(reelCfg.reels[0].stops.length, r0BeforeCount + 2);

  // 23. Move stop
  const stop0Id = reelCfg.reels[0].stops[0].id;
  reelCfg = reorderStopInReel(reelCfg, 0, 0, 1);
  assert.equal(reelCfg.reels[0].stops[1].id, stop0Id);
  reelCfg = reorderStopInReel(reelCfg, 0, 1, 0);
  assert.equal(reelCfg.reels[0].stops[0].id, stop0Id);

  // 24. Delete stop
  const countBeforeDelete = reelCfg.reels[0].stops.length;
  reelCfg = removeStopFromReel(reelCfg, 0, countBeforeDelete - 1);
  assert.equal(reelCfg.reels[0].stops.length, countBeforeDelete - 1);

  // 25. Edit text reel
  const textSymbolIds = bp.symbols.slice(0, 5).map((s) => s.id);
  reelCfg = applyTextStopsToReel(reelCfg, 0, textSymbolIds.join(", "));
  assert.deepEqual(
    reelCfg.reels[0].stops.map((s) => s.symbolId),
    textSymbolIds,
  );

  bp = reconcileBlueprintState(applyReelConfigurationToBlueprint(bp, reelCfg));
  assert.equal(bp.reels.columns, initialCols + 1);

  // 26–28. Payline Operations (Add payline, Duplicate payline, Delete payline)
  let paylineCfg = paylineConfigurationFromBlueprint(bp);
  const linesBefore = paylineCfg.paylines.length;

  // 26. Add payline (auto-picks next unused pattern across 6×3 grid)
  paylineCfg = addPayline(paylineCfg, {
    name: "F22 Custom Line",
  });
  assert.equal(paylineCfg.paylines.length, linesBefore + 1);
  const addedLineId = paylineCfg.paylines[paylineCfg.paylines.length - 1].id;

  // 27. Duplicate payline
  paylineCfg = duplicatePayline(paylineCfg, addedLineId, { ensureUniquePattern: true });
  assert.equal(paylineCfg.paylines.length, linesBefore + 2);
  const duplicatedLineId = paylineCfg.paylines[paylineCfg.paylines.length - 1].id;

  // 28. Delete payline
  paylineCfg = deletePayline(paylineCfg, duplicatedLineId);
  assert.equal(paylineCfg.paylines.length, linesBefore + 1);

  bp = reconcileBlueprintState(applyPaylineConfigurationToBlueprint(bp, paylineCfg));

  // 29 & 30. Edit paytable & Toggle Wild
  let paytableCfg = paytableConfigurationFromBlueprint(bp);
  const targetRow = paytableCfg.symbolRows[0];
  paytableCfg = setPaytableCellPayout(paytableCfg, targetRow.symbolId, 5, 777);
  assert.equal(
    paytableCfg.symbolRows.find((r) => r.symbolId === targetRow.symbolId)?.payouts["5"],
    777,
  );

  // 30. Toggle Wild
  const wildBefore = targetRow.isWild;
  paytableCfg = toggleSymbolWild(paytableCfg, targetRow.symbolId);
  assert.equal(
    paytableCfg.symbolRows.find((r) => r.symbolId === targetRow.symbolId)?.isWild,
    !wildBefore,
  );
  paytableCfg = toggleSymbolWild(paytableCfg, targetRow.symbolId);
  assert.equal(
    paytableCfg.symbolRows.find((r) => r.symbolId === targetRow.symbolId)?.isWild,
    wildBefore,
  );

  bp = reconcileBlueprintState(applyPaytableConfigurationToBlueprint(bp, paytableCfg));
  const updatedEntry = bp.paytable.find(
    (e) => e.symbolId === targetRow.symbolId && e.ofAKind === 5,
  );
  assert.equal(updatedEntry?.payout, 777);

  // 31, 32, 33. Save, Undo, Redo via StudioEditorStore & workspace persistence
  const store = new StudioEditorStore({
    id: created.id,
    title: renamed.title,
    revision: moved.revision,
    blueprint: bp,
  });

  store.execute(
    "UPDATE_META",
    { patch: { title: "F22 Undone Title Check" } },
    "Rename in editor",
  );
  assert.equal(store.getState().dirty, true);
  assert.equal(store.getState().activeProject?.blueprint.meta.title, "F22 Undone Title Check");

  // 32. Undo
  store.undo();
  assert.equal(store.getState().activeProject?.blueprint.meta.title, renamed.title);

  // 33. Redo
  store.redo();
  assert.equal(store.getState().activeProject?.blueprint.meta.title, "F22 Undone Title Check");

  // 31. Save
  const savedDetail = await updateProject(created.id, {
    title: store.getState().activeProject!.blueprint.meta.title,
    blueprint: store.getState().activeProject!.blueprint,
  });
  store.dispatch({
    type: "MARK_SAVED",
    revision: savedDetail.revision,
    blueprint: savedDetail.blueprint,
  });
  assert.equal(store.getState().dirty, false);

  const reloaded = await getProject(created.id);
  assert.ok(reloaded);
  assert.equal(reloaded.blueprint.meta.title, "F22 Undone Title Check");

  // 34. Export blueprint (JSON & ZIP)
  const exportedJson = exportBlueprintJson(reloaded.blueprint);
  assert.ok(exportedJson.json.length > 500);
  const exportedZip = exportProjectZip(reloaded.blueprint, {
    imageScale: "1x",
    animationOptions: {
      includeVideo: true,
      includeWebm: true,
      includeSpriteSheets: true,
      includeGif: true,
    },
  });
  assert.ok(exportedZip.bytes.byteLength > 200);

  // 35. Import blueprint
  const imported = importAndMigrateBlueprint(exportedJson.json);
  assert.equal(imported.ok, true);
  assert.ok(imported.blueprint);
  assert.equal(imported.blueprint.meta.title, "F22 Undone Title Check");
  assert.equal(imported.blueprint.reels.columns, initialCols + 1);

    const readiness = verifyBlueprintFlowReadiness(imported.blueprint);
    assert.equal(readiness.allReady, true);
    assert.equal(readiness.stages.length, 14);
  } finally {
    await deleteProject(created.id).catch(() => {});
    if (createdFolderId) {
      await deleteFolder(createdFolderId).catch(() => {});
    }
  }
});

test("F22.2 — Data QA Auditor & Sanitizer confirm 0 duplicate IDs, 0 orphaned references, and 0 corrupted scenes", () => {
  const cleanBp = reconcileBlueprintState(
    addSceneToBlueprint(
      reconcileBlueprintState(
        createBlueprint({
          id: "proj-clean-qa",
          title: "Clean QA Game",
          theme: "Olympus",
        }),
      ),
      { name: "Bonus Scene", kind: "bonus" },
    ).blueprint,
  );
  const cleanAudit = auditBlueprintDataIntegrity(cleanBp);
  assert.equal(cleanAudit.valid, true);
  assert.equal(cleanAudit.errorCount, 0);
  for (const check of Object.values(cleanAudit.checks)) {
    assert.equal(check.passed, true, `Expected ${check.id} to pass on clean blueprint`);
  }

  // Inject anomalies across all 7 Data QA categories
  const corrupted = structuredClone(cleanBp);
  // 1. Duplicate ID
  corrupted.symbols.push({ ...corrupted.symbols[0] });
  // 2. Orphaned reference
  corrupted.symbols[0].assetId = "asset-non-existent-999";
  // 3. Corrupted scene object geometry + orphaned refId
  corrupted.scenes[0].objects = [
    ...(corrupted.scenes[0].objects ?? []),
    {
      id: "obj-corrupted-geom",
      name: "Bad Object",
      kind: "element",
      refId: "el-missing-999",
      layerId: "layer-missing-999",
      assetId: "asset-missing-999",
      x: Number.NaN,
      y: 0,
      width: -50,
      height: 0,
      rotation: 0,
      opacity: 5,
      visible: true,
      locked: false,
      blur: 0,
      fill: null,
      stroke: null,
      strokeWidth: 0,
      radius: 0,
      shape: null,
      arrow: false,
      points: [],
      text: null,
      fontSize: 16,
      fontWeight: 600,
      align: "center",
      groupId: null,
    },
  ];
  // 4. Invalid symbol reelWeight
  corrupted.symbols[1].reelWeight = -10;
  // 5. Invalid reel stop symbol & weight
  corrupted.reels.strips[0][0] = "sym-unknown-ghost";
  if (corrupted.reelConfiguration) {
    corrupted.reelConfiguration.reels[0].stops[0].symbolId = "sym-unknown-ghost";
    corrupted.reelConfiguration.reels[0].stops[0].weight = 0;
  }
  // 6. Malformed payline
  corrupted.paylines[0].pattern = [0, 99];
  // 7. Malformed paytable payout
  corrupted.paytable[0].payout = -25;

  const badAudit = auditBlueprintDataIntegrity(corrupted);
  assert.equal(badAudit.valid, false);
  assert.equal(badAudit.checks.noDuplicateIds.passed, false);
  assert.equal(badAudit.checks.noOrphanedReferences.passed, false);
  assert.equal(badAudit.checks.noCorruptedScenes.passed, false);
  assert.equal(badAudit.checks.noInvalidSymbols.passed, false);
  assert.equal(badAudit.checks.noInvalidReelStops.passed, false);
  assert.equal(badAudit.checks.noMalformedPaylines.passed, false);
  assert.equal(badAudit.checks.noMalformedPaytableValues.passed, false);

  // Sanitize & verify all 7 checks pass
  const sanitized = sanitizeBlueprintDataIntegrity(corrupted);
  assert.ok(sanitized.repairedIssues.length >= 7);
  assert.equal(sanitized.audit.valid, true);
  for (const check of Object.values(sanitized.audit.checks)) {
    assert.equal(check.passed, true, `Expected ${check.id} to pass after sanitization`);
  }
});

test("F22.3 — Editor QA (zoom, pan, multi-select marquee, alignment, performance benchmarks, and Section 2 Engine Contract)", () => {
  const z1 = clampScale(0.01);
  assert.equal(z1, 0.1);
  const z2 = clampScale(20);
  assert.equal(z2, 8);

  const vp = fitViewport(
    { x: 0, y: 0, scale: 1 },
    { x: 0, y: 0, w: 1920, h: 1080 },
    { w: 1280, h: 720 },
  );
  assert.ok(vp.scale >= 0.1 && vp.scale <= 8);
  assert.ok(Number.isFinite(vp.x) && Number.isFinite(vp.y));

  const zoomed = zoomViewport(vp, 1.5, { x: 640, y: 360 });
  assert.equal(zoomed.scale, 1.5);

  const perfReport = benchmarkStudioPerformance();
  assert.equal(perfReport.passed, true);
  assert.equal(perfReport.benchmarks.length, 5);
  for (const b of perfReport.benchmarks) {
    assert.equal(b.passed, true, `Benchmark ${b.id} failed: ${b.details}`);
  }

  // Verify Section 2 Engine Contract on default & reconciled blueprint
  const imported = importAndMigrateBlueprint(
    JSON.stringify({
      version: 0,
      title: "Section 2 Contract Slot",
      theme: "Cyber Samurai",
      reels: { cols: 5, rows: 3, evaluation: "paylines" },
    }),
  );
  assert.equal(imported.ok, true);
  assert.ok(imported.blueprint);
  const contract = verifySection2EngineContract(imported.blueprint);
  assert.equal(contract.ready, true);
  assert.equal(contract.worksWithoutAi, true);
  assert.equal(contract.gridSpec.columns, 5);
  assert.equal(contract.gridSpec.rows, 3);
  assert.equal(contract.errors.length, 0);
  assert.equal(contract.architecturalBoundary.studioRoot, "SLOT STUDIO");
  assert.equal(
    contract.architecturalBoundary.producers.frontendBuilder.label,
    "FRONTEND BUILDER",
  );
  assert.equal(contract.architecturalBoundary.producers.frontendBuilder.active, true);
  assert.equal(
    contract.architecturalBoundary.producers.futureAi.label,
    "FUTURE AI (inactive)",
  );
  assert.equal(contract.architecturalBoundary.producers.futureAi.active, false);
  assert.equal(contract.architecturalBoundary.producers.futureAi.status, "inactive");
  assert.equal(contract.architecturalBoundary.contractHub.label, "GAME BLUEPRINT");
  assert.equal(contract.architecturalBoundary.contractHub.valid, true);
  assert.equal(contract.architecturalBoundary.contractPillars.artwork.label, "ARTWORK");
  assert.equal(contract.architecturalBoundary.contractPillars.artwork.ready, true);
  assert.equal(contract.architecturalBoundary.contractPillars.layout.label, "LAYOUT");
  assert.equal(contract.architecturalBoundary.contractPillars.layout.ready, true);
  assert.equal(
    contract.architecturalBoundary.contractPillars.mathConfig.label,
    "MATH CONFIG",
  );
  assert.equal(contract.architecturalBoundary.contractPillars.mathConfig.ready, true);
  assert.equal(
    contract.architecturalBoundary.consumer.label,
    "SECTION 2 — BACKEND SLOT GAME ENGINE",
  );
  assert.equal(contract.architecturalBoundary.consumer.ready, true);

  // Also verify objectsInMarquee and alignObjects work cleanly on multi-selection
  const defaultLayerId = imported.blueprint.layers[0]?.id ?? "layer-bg";
  let sceneObjects = structuredClone(imported.blueprint.scenes[0].objects ?? []);
  if (sceneObjects.length === 0) {
    sceneObjects = appendObject(sceneObjects, {
      id: "obj-marquee-1",
      name: "Marquee Item 1",
      kind: "element",
      refId: imported.blueprint.elements[0]?.id ?? null,
      layerId: defaultLayerId,
      assetId: null,
      x: 150,
      y: 150,
      width: 200,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      blur: 0,
      fill: null,
      stroke: null,
      strokeWidth: 0,
      radius: 0,
      shape: null,
      arrow: false,
      points: [],
      text: null,
      fontSize: 16,
      fontWeight: 600,
      align: "center",
      groupId: null,
    }).objects;
  }
  const boxedIds = objectsInMarquee(sceneObjects, imported.blueprint.layers, {
    x: 0,
    y: 0,
    w: 1920,
    h: 1080,
  });
  assert.ok(boxedIds.length > 0);
  const aligned = alignObjects(sceneObjects, boxedIds, "center", {
    x: 0,
    y: 0,
    w: 1920,
    h: 1080,
  });
  assert.equal(aligned.length, sceneObjects.length);
});
