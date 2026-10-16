import assert from "node:assert/strict";
import Module from "node:module";
import { describe, it } from "node:test";

// Allow importing server-only modules in Node test runner
const origLoad = (
  Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown }
)._load;
(
  Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown }
)._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/cache") return { revalidatePath: () => {} };
  return origLoad.call(this, request, parent, isMain);
};

import { createBlueprint } from "../src/lib/blueprint/factory";
import type { SceneObject } from "../src/lib/blueprint/types";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { parseSceneDoc } from "../src/lib/canvas/parse";
import {
  buildPreviewPresentation,
  createDefaultPreviewState,
  selectPreviewScene,
} from "../src/lib/preview";
import {
  MAX_SCENES,
  MAX_SCENE_NAME_LENGTH,
  SCENE_SLOT_LABELS,
  addSceneToBlueprint,
  addSceneToState,
  buildSceneSelectorCards,
  createSceneCompositionState,
  deleteSceneFromBlueprint,
  deleteSceneFromState,
  discardSceneChanges,
  duplicateSceneInBlueprint,
  duplicateSceneInState,
  getActiveSceneModel,
  getDirtySceneIds,
  getEffectiveSceneModel,
  isSceneDirty,
  removeSceneComposedImage,
  renameSceneInBlueprint,
  renameSceneInState,
  reorderSceneLayers,
  reorderSceneObjects,
  requestSceneSwitch,
  resolveUnsavedSceneSwitch,
  saveActiveSceneLayout,
  setSceneBackgroundSelection,
  setSceneCanvasConfiguration,
  setSceneLayerVisibility,
  setSceneLayoutMetadata,
  setSceneObjectPosition,
  setSceneObjectRotation,
  setSceneObjectSize,
  setSceneObjectVisibility,
  upsertSceneComposedImage,
  validateSceneName,
} from "../src/lib/scenes";

function makeSceneObject(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: overrides.id ?? "obj-1",
    name: overrides.name ?? "Hero Banner",
    kind: overrides.kind ?? "image",
    type: overrides.type ?? overrides.kind ?? "image",
    layerId: overrides.layerId ?? "layer-ui",
    x: overrides.x ?? 120,
    y: overrides.y ?? 160,
    width: overrides.width ?? 320,
    height: overrides.height ?? 180,
    rotation: overrides.rotation ?? 0,
    opacity: overrides.opacity ?? 1,
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? false,
    blur: overrides.blur ?? 0,
    fill: overrides.fill ?? "#3b82f6",
    stroke: overrides.stroke ?? null,
    strokeWidth: overrides.strokeWidth ?? 0,
    radius: overrides.radius ?? 8,
    shape: overrides.shape ?? null,
    arrow: overrides.arrow ?? false,
    points: overrides.points ?? [],
    text: overrides.text ?? null,
    fontSize: overrides.fontSize ?? 32,
    fontWeight: overrides.fontWeight ?? 700,
    align: overrides.align ?? "center",
    refId: overrides.refId ?? null,
    assetId: overrides.assetId ?? null,
    blendMode: overrides.blendMode ?? "normal",
    transform: overrides.transform ?? {
      x: overrides.x ?? 120,
      y: overrides.y ?? 160,
      width: overrides.width ?? 320,
      height: overrides.height ?? 180,
      scaleX: 1,
      scaleY: 1,
      rotation: overrides.rotation ?? 0,
    },
    parentId: overrides.parentId ?? null,
    groupId: overrides.groupId ?? null,
    expanded: overrides.expanded ?? true,
  };
}

describe("F19 — Scenes and Layout Composition", () => {
  it("1. enforces up to 3 scenes with required per-scene fields and shared global configuration", () => {
    const bp = createBlueprint({
      id: "proj-f19-1",
      title: "Olympus Multi-Scene",
      theme: "Mythology",
      columns: 5,
      rows: 3,
    });

    const state0 = createSceneCompositionState(bp);
    // Factory creates 2 scenes by default ("Base game", "Free spins")
    assert.equal(state0.scenes.length, 2);

    // Verify every scene has all required F19 fields
    for (const scene of state0.scenes) {
      assert.ok(scene.id, "scene has id");
      assert.ok(scene.name.length > 0 && scene.name.length <= MAX_SCENE_NAME_LENGTH, "scene has name <= 18 chars");
      assert.ok(scene.canvasConfiguration, "scene has canvasConfiguration");
      assert.equal(typeof scene.canvasConfiguration.width, "number");
      assert.equal(typeof scene.canvasConfiguration.height, "number");
      assert.ok(scene.background, "scene has background");
      assert.ok(Array.isArray(scene.layers) && scene.layers.length > 0, "scene has layers");
      assert.ok(scene.visibility, "scene has visibility");
      assert.equal(typeof scene.visibility.sceneVisible, "boolean");
      assert.ok(Array.isArray(scene.composedImages), "scene has composedImages");
      assert.ok(scene.layoutMetadata, "scene has layoutMetadata");
    }

    // Verify shared global configuration is captured
    assert.deepEqual(state0.sharedGlobalConfig.reels, bp.reels);
    assert.deepEqual(state0.sharedGlobalConfig.math, bp.math);
    assert.deepEqual(state0.sharedGlobalConfig.symbols, bp.symbols);

    // Add 3rd scene -> succeeds
    const add3 = addSceneToState(state0, bp, { name: "Scene 3" });
    assert.equal(add3.ok, true);
    assert.equal(add3.state.scenes.length, MAX_SCENES);

    // Attempt to add a 4th scene -> blocked by MAX_SCENES = 3
    const add4 = addSceneToState(add3.state, bp, { name: "Scene 4" });
    assert.equal(add4.ok, false);
    assert.equal(add4.state.scenes.length, MAX_SCENES);
    assert.match(add4.error ?? "", /maximum 3 scenes/i);

    // Blueprint helper also enforces 3-scene limit
    const bp3 = addSceneToBlueprint(bp, { name: "Bonus Stage" });
    assert.equal(bp3.ok, true);
    assert.equal(bp3.blueprint.scenes.length, 3);
    const bp4 = addSceneToBlueprint(bp3.blueprint, { name: "Extra Scene" });
    assert.equal(bp4.ok, false);
  });

  it("2. builds Scene Selector cards (Scene 1, Scene 2, Scene 3) and highlights active scene clearly", () => {
    const bp = createBlueprint({
      id: "proj-f19-2",
      title: "Selector Cards Slot",
      theme: "Cyberpunk",
    });

    let state = createSceneCompositionState(bp);
    const cards2 = buildSceneSelectorCards(state, bp);
    assert.equal(cards2.length, 3);
    assert.deepEqual(
      cards2.map((c) => c.slotLabel),
      [...SCENE_SLOT_LABELS],
    );
    assert.equal(cards2[0]!.occupied, true);
    assert.equal(cards2[0]!.active, true);
    assert.equal(cards2[1]!.occupied, true);
    assert.equal(cards2[1]!.active, false);
    assert.equal(cards2[2]!.occupied, false);
    assert.equal(cards2[2]!.active, false);

    // Add 3rd scene and switch active scene to Scene 2
    const added = addSceneToState(state, bp, { name: "Bonus Pick" });
    assert.equal(added.ok, true);
    state = added.state;

    const switched = requestSceneSwitch(state, state.scenes[1]!.id);
    assert.equal(switched.switchedImmediately, true);
    state = switched.state;

    const cards3 = buildSceneSelectorCards(state, bp);
    assert.equal(cards3[0]!.active, false);
    assert.equal(cards3[1]!.active, true, "Scene 2 is highlighted active");
    assert.equal(cards3[2]!.occupied, true);
    assert.equal(cards3[2]!.active, false);
  });

  it("3. supports Rename (max 18 chars), Duplicate, Delete, and Add Scene actions", () => {
    const bp = createBlueprint({
      id: "proj-f19-3",
      title: "Scene Actions Slot",
      theme: "Adventure",
    });

    let state = createSceneCompositionState(bp);
    const scene1Id = state.scenes[0]!.id;

    // Place an object and customize background on Scene 1 before duplicating
    state = setSceneBackgroundSelection(
      state,
      scene1Id,
      { color: "#1e293b" },
      bp,
    );
    state = upsertSceneComposedImage(
      state,
      scene1Id,
      {
        id: "comp-custom-1",
        name: "Treasure Chest",
        assetId: null,
        uri: "https://example.com/chest.png",
        refKind: "image",
        refId: null,
        layerId: "layer-ui",
        x: 340,
        y: 220,
        width: 240,
        height: 200,
        rotation: 25,
        visible: true,
        order: 1,
      },
      bp,
    );

    // Rename validation: max 18 characters
    assert.equal(validateSceneName("Valid 18 Char Name").ok, true);
    assert.equal("Valid 18 Char Name".length, 18);
    assert.equal(validateSceneName("This Name Is 19 Chr").ok, false);
    assert.equal(validateSceneName("   ").ok, false);

    const badRename = renameSceneInState(state, scene1Id, "Too Long Scene Name Over 18");
    assert.equal(badRename.ok, false);
    assert.match(badRename.error ?? "", /18 characters/i);

    const goodRename = renameSceneInState(state, scene1Id, "Main Base Reel 18!");
    assert.equal(goodRename.ok, true);
    state = goodRename.state;
    assert.equal(state.scenes[0]!.name, "Main Base Reel 18!");
    assert.ok(state.scenes[0]!.name.length <= MAX_SCENE_NAME_LENGTH);

    // Duplicate Scene 1 -> creates 3rd scene with cloned layout and name <= 18 chars
    const dupRes = duplicateSceneInState(state, bp, scene1Id);
    assert.equal(dupRes.ok, true);
    assert.ok(dupRes.duplicatedScene);
    assert.ok(dupRes.duplicatedScene!.name.length <= MAX_SCENE_NAME_LENGTH);
    assert.equal(dupRes.duplicatedScene!.background.color, "#1e293b");
    assert.equal(dupRes.duplicatedScene!.composedImages.length, 1);
    assert.equal(dupRes.duplicatedScene!.composedImages[0]!.x, 340);
    assert.equal(dupRes.duplicatedScene!.composedImages[0]!.rotation, 25);
    state = dupRes.state;
    assert.equal(state.scenes.length, 3);

    // Duplicate when already at 3 scenes -> fails
    const dupOverLimit = duplicateSceneInState(state, bp, scene1Id);
    assert.equal(dupOverLimit.ok, false);

    // Delete Scene 2 and Scene 3, then verify last scene cannot be deleted
    const del2 = deleteSceneFromState(state, state.scenes[1]!.id);
    assert.equal(del2.ok, true);
    state = del2.state;
    assert.equal(state.scenes.length, 2);

    const del3 = deleteSceneFromState(state, state.scenes[1]!.id);
    assert.equal(del3.ok, true);
    state = del3.state;
    assert.equal(state.scenes.length, 1);

    const delLast = deleteSceneFromState(state, state.scenes[0]!.id);
    assert.equal(delLast.ok, false);
    assert.match(delLast.error ?? "", /at least 1 scene/i);

    // Also verify blueprint-level rename and delete helpers
    const bpRenameFail = renameSceneInBlueprint(bp, bp.scenes[0]!.id, "1234567890123456789");
    assert.equal(bpRenameFail.ok, false);
    const bpRenameOk = renameSceneInBlueprint(bp, bp.scenes[0]!.id, "Base Arena");
    assert.equal(bpRenameOk.ok, true);
    assert.equal(bpRenameOk.blueprint.scenes[0]!.name, "Base Arena");

    const bpDup = duplicateSceneInBlueprint(bpRenameOk.blueprint, bp.scenes[0]!.id);
    assert.equal(bpDup.ok, true);
    assert.equal(bpDup.blueprint.scenes.length, 3);

    const bpDel = deleteSceneFromBlueprint(bpDup.blueprint, bpDup.duplicatedScene!.id);
    assert.equal(bpDel.ok, true);
    assert.equal(bpDel.blueprint.scenes.length, 2);
  });

  it("4. stores independent per-scene layout: positions, sizes, rotation, layer order, visibility, background selection, and composed image references", () => {
    const bp = createBlueprint({
      id: "proj-f19-4",
      title: "Independent Layouts Slot",
      theme: "Space",
    });

    // Seed Scene 1 and Scene 2 with objects having identical starting coordinates
    const obj1 = makeSceneObject({
      id: "obj-shared-shape",
      name: "Logo Emblem",
      kind: "image",
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      rotation: 0,
      visible: true,
    });
    const obj2 = makeSceneObject({
      id: "obj-secondary",
      name: "Frame Accent",
      kind: "shape",
      shape: "rect",
      x: 400,
      y: 300,
      width: 300,
      height: 200,
      rotation: 0,
      visible: true,
    });

    bp.scenes[0]!.objects = [obj1, obj2];
    bp.scenes[1]!.objects = [
      makeSceneObject({ ...obj1, id: "obj-s2-1", x: 100, y: 100, width: 200, height: 120, rotation: 0 }),
      makeSceneObject({ ...obj2, id: "obj-s2-2", x: 400, y: 300, width: 300, height: 200, rotation: 0 }),
    ];

    let state = createSceneCompositionState(bp);
    const scene1Id = state.scenes[0]!.id;
    const scene2Id = state.scenes[1]!.id;

    // Mutate Scene 1 layout across all 7 independent layout dimensions:
    // 1) positions
    state = setSceneObjectPosition(state, scene1Id, "obj-shared-shape", { x: 550, y: 420 }, bp);
    // 2) sizes (object + canvas configuration)
    state = setSceneObjectSize(state, scene1Id, "obj-shared-shape", { width: 480, height: 260 }, bp);
    state = setSceneCanvasConfiguration(state, scene1Id, { width: 1080, height: 1920, orientation: "portrait" }, bp);
    // 3) rotation
    state = setSceneObjectRotation(state, scene1Id, "obj-shared-shape", 45, bp);
    // 4) layer order (both blueprint layers order and object stacking order)
    state = reorderSceneLayers(state, scene1Id, "layer-ui", "layer-bg", "before", bp);
    state = reorderSceneObjects(state, scene1Id, "obj-secondary", "back", bp);
    // 5) visibility (layer + object visibility)
    state = setSceneLayerVisibility(state, scene1Id, "layer-fx", false, bp);
    state = setSceneObjectVisibility(state, scene1Id, "obj-secondary", false, bp);
    // 6) background selection
    state = setSceneBackgroundSelection(
      state,
      scene1Id,
      { color: "#311042", imageUri: "https://example.com/nebula.png", fit: "contain" },
      bp,
    );
    // 7) composed image references + layout metadata
    state = upsertSceneComposedImage(
      state,
      scene1Id,
      {
        id: "comp-nebula-overlay",
        name: "Nebula Overlay",
        assetId: null,
        uri: "https://example.com/nebula-overlay.png",
        refKind: "image",
        refId: null,
        layerId: "layer-ui",
        x: 80,
        y: 90,
        width: 600,
        height: 400,
        rotation: 12,
        visible: true,
        order: 99,
      },
      bp,
    );
    state = setSceneLayoutMetadata(state, scene1Id, { zoom: 1.25, notes: "Portrait Free Spin Intro" }, bp);

    const s1 = getEffectiveSceneModel(state, scene1Id, bp)!;
    const s2 = getEffectiveSceneModel(state, scene2Id, bp)!;

    // Verify Scene 1 reflects all updated layout values
    const s1Logo = s1.objects.find((o) => o.id === "obj-shared-shape")!;
    assert.equal(s1Logo.x, 550);
    assert.equal(s1Logo.y, 420);
    assert.equal(s1Logo.width, 480);
    assert.equal(s1Logo.height, 260);
    assert.equal(s1Logo.rotation, 45);
    assert.equal(s1.canvasConfiguration.width, 1080);
    assert.equal(s1.canvasConfiguration.orientation, "portrait");
    assert.equal(s1.objects[0]!.id, "obj-secondary", "obj-secondary moved to back");
    assert.equal(s1.visibility.layers["layer-fx"], false);
    assert.equal(s1.visibility.objects["obj-secondary"], false);
    assert.equal(s1.background.color, "#311042");
    assert.equal(s1.background.imageUri, "https://example.com/nebula.png");
    assert.equal(s1.background.fit, "contain");
    assert.ok(s1.composedImages.some((c) => c.id === "comp-nebula-overlay"));
    assert.equal(s1.layoutMetadata.zoom, 1.25);

    // Verify Scene 2 remained 100% independent and untouched
    const s2Logo = s2.objects.find((o) => o.id === "obj-s2-1")!;
    assert.equal(s2Logo.x, 100);
    assert.equal(s2Logo.y, 100);
    assert.equal(s2Logo.width, 200);
    assert.equal(s2Logo.height, 120);
    assert.equal(s2Logo.rotation, 0);
    assert.equal(s2.canvasConfiguration.width, 1920);
    assert.equal(s2.canvasConfiguration.orientation, "landscape");
    assert.equal(s2.visibility.layers["layer-fx"], true);
    assert.equal(s2.visibility.objects["obj-s2-2"], true);
    assert.notEqual(s2.background.color, "#311042");
    assert.equal(s2.composedImages.some((c) => c.id === "comp-nebula-overlay"), false);

    // Remove composed image on Scene 1 and verify removal
    state = removeSceneComposedImage(state, scene1Id, "comp-nebula-overlay", bp);
    assert.equal(
      getEffectiveSceneModel(state, scene1Id, bp)!.composedImages.some(
        (c) => c.id === "comp-nebula-overlay",
      ),
      false,
    );
  });

  it("5. tracks unsaved state independently per scene and handles Save / Discard / Cancel when switching scenes", () => {
    let bp = createBlueprint({
      id: "proj-f19-5",
      title: "Unsaved Switch Slot",
      theme: "Egypt",
    });

    let state = createSceneCompositionState(bp);
    const scene1Id = state.scenes[0]!.id;
    const scene2Id = state.scenes[1]!.id;

    assert.equal(isSceneDirty(state, scene1Id), false);
    assert.equal(isSceneDirty(state, scene2Id), false);
    assert.deepEqual(getDirtySceneIds(state), []);

    // Edit Scene 1 background -> only Scene 1 becomes dirty
    state = setSceneBackgroundSelection(state, scene1Id, { color: "#451a03" }, bp);
    assert.equal(isSceneDirty(state, scene1Id), true);
    assert.equal(isSceneDirty(state, scene2Id), false);
    assert.deepEqual(getDirtySceneIds(state), [scene1Id]);

    // Attempt to switch from dirty Scene 1 to Scene 2 -> prompts Save / Discard / Cancel
    const switchAttempt = requestSceneSwitch(state, scene2Id);
    assert.equal(switchAttempt.switchedImmediately, false);
    assert.equal(switchAttempt.promptRequired, true);
    assert.equal(switchAttempt.state.activeSceneId, scene1Id, "does not switch before user resolves prompt");
    assert.deepEqual(switchAttempt.state.pendingSceneSwitch, {
      fromSceneId: scene1Id,
      toSceneId: scene2Id,
      fromSceneName: state.scenes[0]!.name,
      toSceneName: state.scenes[1]!.name,
    });
    state = switchAttempt.state;

    // 1) Resolve with "cancel" -> stays on Scene 1, preserves dirty state
    const canceled = resolveUnsavedSceneSwitch(state, bp, "cancel");
    assert.equal(canceled.state.activeSceneId, scene1Id);
    assert.equal(canceled.state.pendingSceneSwitch, null);
    assert.equal(isSceneDirty(canceled.state, scene1Id), true);
    assert.equal(
      getEffectiveSceneModel(canceled.state, scene1Id, bp)!.background.color,
      "#451a03",
    );

    // 2) Re-request switch and resolve with "discard" -> reverts Scene 1 to saved and switches to Scene 2
    const switchAttempt2 = requestSceneSwitch(canceled.state, scene2Id);
    const discarded = resolveUnsavedSceneSwitch(switchAttempt2.state, bp, "discard");
    assert.equal(discarded.state.activeSceneId, scene2Id);
    assert.equal(discarded.state.pendingSceneSwitch, null);
    assert.equal(isSceneDirty(discarded.state, scene1Id), false);
    assert.notEqual(
      getEffectiveSceneModel(discarded.state, scene1Id, bp)!.background.color,
      "#451a03",
    );

    // 3) Now on Scene 2: edit Scene 2, request switch back to Scene 1, and resolve with "save"
    state = setSceneBackgroundSelection(discarded.state, scene2Id, { color: "#064e3b" }, bp);
    assert.equal(isSceneDirty(state, scene2Id), true);

    const switchAttempt3 = requestSceneSwitch(state, scene1Id);
    assert.equal(switchAttempt3.promptRequired, true);
    const savedSwitch = resolveUnsavedSceneSwitch(switchAttempt3.state, bp, "save");
    state = savedSwitch.state;
    bp = savedSwitch.blueprint;

    assert.equal(state.activeSceneId, scene1Id);
    assert.equal(state.pendingSceneSwitch, null);
    assert.equal(isSceneDirty(state, scene2Id), false);
    assert.equal(savedSwitch.savedSceneId, scene2Id);
    assert.equal(
      bp.scenes.find((s) => s.id === scene2Id)?.background?.color,
      "#064e3b",
    );
  });

  it("6. Save Layout only saves the active scene's layout changes while preserving unsaved drafts on other scenes and shared global config", () => {
    const bp = createBlueprint({
      id: "proj-f19-6",
      title: "Active Save Only Slot",
      theme: "Norse",
      columns: 6,
      rows: 4,
    });

    const originalReels = structuredClone(bp.reels);
    const originalMath = structuredClone(bp.math);
    const originalSymbols = structuredClone(bp.symbols);

    let state = createSceneCompositionState(bp);
    const scene1Id = state.scenes[0]!.id;
    const scene2Id = state.scenes[1]!.id;

    // Make unsaved layout edits to BOTH Scene 1 and Scene 2
    state = setSceneBackgroundSelection(state, scene1Id, { color: "#1d4ed8" }, bp);
    state = setSceneBackgroundSelection(state, scene2Id, { color: "#b91c1c" }, bp);
    assert.equal(isSceneDirty(state, scene1Id), true);
    assert.equal(isSceneDirty(state, scene2Id), true);

    // Active scene is Scene 1 -> Save Layout
    assert.equal(state.activeSceneId, scene1Id);
    const saved1 = saveActiveSceneLayout(state, bp);
    state = saved1.state;
    const updatedBp = saved1.blueprint;

    // Scene 1 is now saved in blueprint and clean in state
    assert.equal(isSceneDirty(state, scene1Id), false);
    assert.equal(
      updatedBp.scenes.find((s) => s.id === scene1Id)?.background?.color,
      "#1d4ed8",
    );

    // Scene 2 was NOT active, so its draft changes were NOT saved to blueprint and it remains dirty!
    assert.equal(isSceneDirty(state, scene2Id), true);
    assert.notEqual(
      updatedBp.scenes.find((s) => s.id === scene2Id)?.background?.color,
      "#b91c1c",
    );
    assert.equal(
      getEffectiveSceneModel(state, scene2Id, updatedBp)!.background.color,
      "#b91c1c",
      "Scene 2 still holds its unsaved draft in memory",
    );

    // Discard Scene 2 changes explicitly
    state = discardSceneChanges(state, scene2Id);
    assert.equal(isSceneDirty(state, scene2Id), false);

    // Verify shared global game config (reels, math, symbols) is 100% preserved
    assert.deepEqual(updatedBp.reels, originalReels);
    assert.deepEqual(updatedBp.math, originalMath);
    assert.deepEqual(updatedBp.symbols, originalSymbols);
  });

  it("7. switching scenes changes visual composition in Preview & Canvas while preserving shared game configuration and persisting via saveScene", async () => {
    const { createProject, deleteProject, getProject } = await import(
      "../src/server/workspace-service"
    );
    const { saveScene } = await import("../src/server/canvas-service");

    const created = await createProject({
      title: "F19 Multi-Scene Persistence",
      theme: "Atlantis",
    });

    try {
      let state = createSceneCompositionState(created.blueprint);
      // Add 3rd scene
      const added = addSceneToState(state, created.blueprint, {
        name: "Bonus Vault",
        kind: "bonus",
      });
      assert.equal(added.ok, true);
      state = added.state;

      const s1Id = state.scenes[0]!.id;
      const s2Id = state.scenes[1]!.id;
      const s3Id = state.scenes[2]!.id;

      // Customize Scene 1 and Scene 3 visual compositions differently
      state = setSceneBackgroundSelection(state, s1Id, { color: "#0f172a" }, created.blueprint);
      state = setSceneCanvasConfiguration(
        state,
        s1Id,
        { width: 1920, height: 1080, orientation: "landscape" },
        created.blueprint,
      );
      const savedS1 = saveActiveSceneLayout(state, created.blueprint);
      state = savedS1.state;
      let bp = savedS1.blueprint;

      // Switch to Scene 3 and customize its visual composition
      state = requestSceneSwitch(state, s3Id).state;
      state = setSceneBackgroundSelection(state, s3Id, { color: "#581c87" }, bp);
      state = setSceneLayerVisibility(state, s3Id, "layer-frame", false, bp);
      const savedS3 = saveActiveSceneLayout(state, bp);
      state = savedS3.state;
      bp = savedS3.blueprint;

      // Verify PreviewPresentation changes visual composition when switching scenes while preserving reels/math/symbols
      let previewState = createDefaultPreviewState(bp);
      const pres1 = buildPreviewPresentation(bp, selectPreviewScene(previewState, s1Id));
      const pres3 = buildPreviewPresentation(bp, selectPreviewScene(previewState, s3Id));

      assert.equal(pres1.activeScene.id, s1Id);
      assert.equal(pres3.activeScene.id, s3Id);
      assert.equal(pres1.canvas.backgroundColor, "#0f172a");
      assert.equal(pres3.canvas.backgroundColor, "#581c87");
      assert.equal(pres1.stage.reelFrame.visible, true);
      assert.equal(pres3.stage.reelFrame.visible, false);

      // Shared reels/symbols are identical across both scene presentations
      assert.equal(pres1.stage.reelArea.columns, pres3.stage.reelArea.columns);
      assert.equal(pres1.stage.reelArea.rows, pres3.stage.reelArea.rows);
      assert.deepEqual(
        pres1.stage.reelArea.cells.map((r) => r.map((c) => c.symbolId)),
        pres3.stage.reelArea.cells.map((r) => r.map((c) => c.symbolId)),
      );

      // Persist Scene 3 and the 3-scene roster via saveScene
      const s3Model = getActiveSceneModel(state, bp);
      await saveScene(created.id, {
        baseRevision: created.revision,
        sceneId: s3Model.id,
        name: s3Model.name,
        objects: s3Model.objects,
        background: s3Model.background,
        layers: s3Model.layers,
        canvasConfiguration: s3Model.canvasConfiguration,
        visibility: s3Model.visibility,
        composedImages: s3Model.composedImages,
        layoutMetadata: s3Model.layoutMetadata,
        scenes: bp.scenes,
      });

      const reloaded = await getProject(created.id);
      assert.ok(reloaded);
      assert.equal(reloaded.blueprint.scenes.length, 3);
      assert.equal(reloaded.blueprint.scenes[2]!.name, "Bonus Vault");
      assert.equal(reloaded.blueprint.scenes[2]!.background?.color, "#581c87");
      assert.equal(reloaded.blueprint.scenes[2]!.visibility?.layers["layer-frame"], false);
      assert.equal(validateBlueprint(reloaded.blueprint).integrityOk, true);

      // Verify parseSceneDoc rejects scene names > 18 chars or > 3 scenes
      assert.equal(
        parseSceneDoc({
          objects: [],
          background: { color: "#000", assetId: null },
          name: "Scene Name Exceeding 18 Chars",
        }).ok,
        false,
      );
      assert.equal(
        parseSceneDoc({
          objects: [],
          background: { color: "#000", assetId: null },
          scenes: [
            ...reloaded.blueprint.scenes,
            { id: "scene-4", name: "Scene 4", kind: "bonus", layerIds: [], entryTransition: "fade" },
          ],
        }).ok,
        false,
      );
      void s2Id;
    } finally {
      await deleteProject(created.id);
    }
  });
});
