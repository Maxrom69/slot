import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";

// Bypass Next.js "server-only" and "next/cache" guards in Node test runner before importing server services
const mod = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const origLoad = mod._load;
mod._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "next/cache") {
    return { revalidatePath: () => undefined };
  }
  return origLoad.call(this, request, parent, isMain);
};

import { createBlueprint } from "../src/lib/blueprint/factory";
import type { AssetRef, GameBlueprint, SceneObject } from "../src/lib/blueprint/types";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { computeElementUsage } from "../src/lib/design/element-usage";
import { applyDesign, designDocFromBlueprint, migrateDoc } from "../src/lib/design/migrate";
import {
  addElement,
  addElementAnimationCue,
  addElementVariant,
  annotateElementImageRevision,
  clearElementArtwork,
  deleteElement,
  duplicateElement,
  duplicateElementVariant,
  editElementVariant,
  removeElementAnimationCue,
  removeElementVariant,
  renameElement,
  replaceElementArtwork,
  restoreElementImageRevision,
  restorePreviousElementImageRevision,
  updateElement,
  updateElementAnimationCue,
} from "../src/lib/design/operations";
import { parseDesignDoc } from "../src/lib/design/parse";
import { applyLibraryToBlueprint, libraryFromBlueprint } from "../src/lib/elements/blueprint-adapter";

function makeAsset(id: string, name: string): AssetRef {
  return {
    id,
    name,
    kind: "image",
    uri: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
    state: "linked",
    format: "png-transparent",
    mime: "image/png",
    width: 512,
    height: 512,
    sizeBytes: 1024,
    hasAlpha: true,
    tags: ["element-art"],
  };
}

test("F11 Sections 1–7: Identity, Artwork, Style, Variants, Extras, Animation, and History on an Element", () => {
  const bp = createBlueprint({ id: "prj-f11-1", title: "Olympus Gold", theme: "Greek Mythology" });
  let doc = migrateDoc(designDocFromBlueprint(bp));

  const added = addElement(
    doc,
    { type: "reel_frame", name: "Temple Frame", style: "Ornate" },
    { glyphs: ["★", "◆"] },
  );
  doc = added.doc;
  const frameId = added.id;

  // 1. Identity: rename, group, description, tags (preserving stable ID)
  doc = renameElement(doc, frameId, "Golden Temple Frame");
  doc = updateElement(doc, frameId, {
    group: "Sacred Frames",
    description: "Corinthian column frame with lightning crest",
    tags: ["frame", "gold", "olympus"],
    notes: "Render with 24px outer glow",
  });

  let frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.id, frameId, "Stable ID never changes on rename");
  assert.equal(frame.name, "Golden Temple Frame");
  assert.equal(frame.group, "Sacred Frames");
  assert.equal(frame.description, "Corinthian column frame with lightning crest");
  assert.deepEqual(frame.tags, ["frame", "gold", "olympus"]);
  assert.equal(frame.notes, "Render with 24px outer glow");

  // 2. Artwork & 7. History: upload v1, upload v2, annotate, clear, restore previous, restore specific revision
  const artV1 = makeAsset("ast-frame-v1", "temple-frame-v1.png");
  const artV2 = makeAsset("ast-frame-v2", "temple-frame-v2.png");

  doc = replaceElementArtwork(
    doc,
    frameId,
    artV1,
    { source: "upload", notes: "Initial frame art" },
  );
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.assetId, "ast-frame-v1");
  assert.equal(frame.imageHistory?.length, 1);

  doc = replaceElementArtwork(
    doc,
    frameId,
    artV2,
    { source: "upload", notes: "Refined marble columns" },
  );
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.assetId, "ast-frame-v2");
  assert.equal(frame.imageHistory?.length, 2);

  const v1RevId = frame.imageHistory![1]!.id;
  doc = annotateElementImageRevision(doc, frameId, v1RevId, "Annotated v1 column art");
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.imageHistory![1]!.notes, "Annotated v1 column art");

  // Restore previous revision -> should restore v1
  doc = restorePreviousElementImageRevision(doc, frameId, "Restored v1");
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.assetId, "ast-frame-v1");
  assert.equal(frame.imageHistory![0]!.source, "restore");

  // Clear artwork, then restore v2 by revision ID
  doc = clearElementArtwork(doc, frameId);
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.assetId, null);
  assert.equal(frame.image, null);

  const v2RevId = frame.imageHistory!.find((r) => r.asset?.assetId === "ast-frame-v2")!.id;
  doc = restoreElementImageRevision(doc, frameId, v2RevId, "Restored v2");
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.assetId, "ast-frame-v2");

  // 3. Style: styleGuide, tintColor, opacity, blendMode, params
  doc = updateElement(doc, frameId, {
    style: {
      styleGuide: "Brushed gold with bevel highlights",
      tintColor: "#f5c542",
      opacity: 0.9,
      blendMode: "screen",
    },
    params: { style: "Ornate" },
  });
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.style?.styleGuide, "Brushed gold with bevel highlights");
  assert.equal(frame.style?.tintColor, "#f5c542");
  assert.equal(frame.style?.opacity, 0.9);
  assert.equal(frame.style?.blendMode, "screen");
  assert.equal(frame.params.style, "Ornate");

  // 4. Variants: add, edit, assign image, duplicate, remove
  const vAdded = addElementVariant(doc, frameId, { name: "Golden Temple Frame — Free Spins" });
  doc = vAdded.doc;
  const variantId = vAdded.id;
  assert.ok(variantId.startsWith(`${frameId}-var`));

  doc = editElementVariant(doc, frameId, variantId, {
    name: "Golden Temple Frame — Storm Mode",
    description: "Electrified free spins variant",
    image: { provider: "project", assetId: "ast-frame-v1" },
  });
  const vDup = duplicateElementVariant(doc, frameId, variantId);
  doc = vDup.doc;
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.variants?.length, 2);
  assert.notEqual(frame.variants![0]!.id, frame.variants![1]!.id);
  assert.equal(frame.variants![0]!.description, "Electrified free spins variant");

  doc = removeElementVariant(doc, frameId, vDup.id);
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.equal(frame.variants?.length, 1);

  // 5. Extras: custom key-value extras & params
  doc = updateElement(doc, frameId, {
    extras: { hoverGlow: true, borderThickness: 12, shaderPreset: "lightning" },
    params: { style: "Ornate", hoverGlow: true, borderThickness: 12 },
  });
  frame = doc.elements.find((e) => e.id === frameId)!;
  assert.deepEqual(frame.extras, { hoverGlow: true, borderThickness: 12, shaderPreset: "lightning" });

  // 6. Animation: element animation config + blueprint animation cues
  doc = updateElement(doc, frameId, {
    animation: {
      preset: "spin_glow",
      trigger: "spin_start",
      durationMs: 850,
      easing: "ease-in-out",
      loop: true,
    },
  });
  const cueAdded = addElementAnimationCue(doc, frameId, {
    trigger: "big_win",
    kind: "Lightning Surge",
    durationMs: 1200,
    easing: "spring",
  });
  doc = cueAdded.doc;
  assert.equal(doc.animations?.some((a) => a.id === cueAdded.id && a.target === frameId), true);

  doc = updateElementAnimationCue(doc, cueAdded.id, { durationMs: 1500 });
  assert.equal(doc.animations?.find((a) => a.id === cueAdded.id)?.durationMs, 1500);

  doc = removeElementAnimationCue(doc, cueAdded.id);
  assert.equal(doc.animations?.some((a) => a.id === cueAdded.id), false);

  // Re-add one cue and verify parse + validate + ElementLibrary round-trip
  const cueAdded2 = addElementAnimationCue(doc, frameId, {
    trigger: "win",
    kind: "Frame Flash",
    durationMs: 500,
    easing: "ease-out",
  });
  doc = cueAdded2.doc;
  frame = doc.elements.find((e) => e.id === frameId)!;

  const parsed = parseDesignDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(parsed.ok, true);
  const updatedBp = applyDesign(bp, doc);
  const validation = validateBlueprint(updatedBp);
  assert.equal(validation.integrityOk, true);
  assert.deepEqual(validation.integrityIssues, []);

  // ElementLibrary adapter round-trip preserves style, variants, extras, animation, and imageHistory
  const lib = libraryFromBlueprint(updatedBp);
  const roundTrippedBp = applyLibraryToBlueprint(updatedBp, lib);
  const rtFrame = roundTrippedBp.elements.find((e) => e.id === frameId)!;
  assert.deepEqual(rtFrame.style, frame.style);
  assert.equal(rtFrame.variants?.length, 1);
  assert.deepEqual(rtFrame.extras, frame.extras);
  assert.deepEqual(rtFrame.animation, frame.animation);
  assert.equal(rtFrame.imageHistory?.length, frame.imageHistory?.length);
});

test("F11 Section 8 — Usage: computeElementUsage reports Symbol Sets, Scenes, Layers, Reels, Paytable, and Animations", () => {
  const bp = createBlueprint({ id: "prj-f11-2", title: "Pharaoh Riches", theme: "Ancient Egypt" });
  let doc = migrateDoc(designDocFromBlueprint(bp));

  const setEl = doc.elements.find((e) => e.type === "symbol_set")!;
  const firstSymbolId = setEl.symbolIds[0]!;

  // Place a scene object referencing firstSymbolId on the base scene
  const reelsLayerId = bp.layers.find((l) => l.kind === "reels")?.id ?? bp.layers[0]!.id;
  const placedSymbolObj: SceneObject = {
    id: "scene-obj-sym-1",
    name: "Placed Symbol",
    kind: "symbol",
    type: "symbol",
    layerId: reelsLayerId,
    x: 100,
    y: 100,
    width: 160,
    height: 160,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blendMode: "normal",
    blur: 0,
    strokeWidth: 0,
    radius: 0,
    arrow: false,
    fontSize: 32,
    fontWeight: 700,
    align: "center",
    fill: null,
    stroke: null,
    shape: null,
    points: [],
    text: null,
    refId: firstSymbolId,
    assetId: null,
    parentId: null,
    groupId: null,
    expanded: true,
  };
  const bpWithScene: GameBlueprint = {
    ...bp,
    scenes: bp.scenes.map((s, i) => (i === 0 ? { ...s, objects: [...(s.objects ?? []), placedSymbolObj] } : s)),
  };
  doc = migrateDoc(designDocFromBlueprint(bpWithScene));
  doc = addElementAnimationCue(doc, setEl.id, { trigger: "win", kind: "Pulse Set", durationMs: 500 }).doc;

  const usage = computeElementUsage(doc, bpWithScene, setEl.id);
  assert.ok(usage.symbolSets.length >= 1, "Reports Symbol Sets usage");
  assert.ok(usage.scenes.length >= 1, "Reports Scenes usage");
  assert.ok(usage.layers.length >= 1, "Reports Layers usage");
  assert.ok(usage.reels.length >= 1, "Reports Reels usage");
  assert.ok(usage.paytable.length >= 1, "Reports Paytable usage");
  assert.ok(usage.animations.length >= 1, "Reports Animations usage");
  assert.ok(usage.totalCount >= 6);
});

test("F11 Acceptance: editing, duplicating, or deleting an element updates all dependent views and persists to GameBlueprint", async () => {
  const { createProject, deleteProject, getProject } = await import("../src/server/workspace-service");
  const { saveDesign, uploadAsset } = await import("../src/server/design-service");

  const created = await createProject({
    title: "F11 Dependent Views Test",
    theme: "Norse",
  });

  try {
    let doc = migrateDoc(designDocFromBlueprint(created.blueprint));
    const addedTitle = addElement(
      doc,
      { type: "game_title", name: "Game Title" },
      { glyphs: ["★", "◆"] },
    );
    doc = addedTitle.doc;
    const titleId = addedTitle.id;

    // Place the game_title element onto Scene 0 so Scene view depends on it
    const uiLayerId = created.blueprint.layers.find((l) => l.kind === "ui")?.id ?? created.blueprint.layers[0]!.id;
    const placedElementObj: SceneObject = {
      id: "scene-obj-title",
      name: "Game Title",
      kind: "element",
      type: "element",
      layerId: uiLayerId,
      x: 400,
      y: 40,
      width: 480,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      blendMode: "normal",
      blur: 0,
      strokeWidth: 0,
      radius: 0,
      arrow: false,
      fontSize: 32,
      fontWeight: 700,
      align: "center",
      fill: null,
      stroke: null,
      shape: null,
      points: [],
      text: null,
      refId: titleId,
      assetId: null,
      parentId: null,
      groupId: null,
      expanded: true,
    };

    const bpWithPlaced: GameBlueprint = {
      ...applyDesign(created.blueprint, doc),
      scenes: created.blueprint.scenes.map((s, idx) =>
        idx === 0 ? { ...s, objects: [placedElementObj] } : s,
      ),
    };
    doc = designDocFromBlueprint(bpWithPlaced);

    // Edit the element in Element Detail View: rename, replace image, add animation cue, edit background element
    const svgTitle = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60"><rect width="240" height="60" fill="#d4af37"/></svg>`;
    const svgBg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#1e293b"/></svg>`;
    const upTitle = await uploadAsset(created.id, {
      name: "valhalla-banner.svg",
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svgTitle).toString("base64")}`,
    });
    const upBg = await uploadAsset(created.id, {
      name: "asgard-sky.svg",
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svgBg).toString("base64")}`,
    });
    const titleArt = upTitle.asset;
    const bgArt = upBg.asset;

    doc = renameElement(doc, titleId, "Valhalla Crown Banner");
    doc = replaceElementArtwork(doc, titleId, titleArt, { source: "upload", notes: "Uploaded banner" });
    doc = addElementAnimationCue(doc, titleId, { trigger: "win", kind: "Banner Shine", durationMs: 700 }).doc;

    const bgEl = doc.elements.find((e) => e.type === "game_background")!;
    doc = replaceElementArtwork(doc, bgEl.id, bgArt, { source: "upload", notes: "Uploaded background" });

    // Duplicate the title element
    const duped = duplicateElement(doc, titleId);
    assert.ok(duped);
    doc = duped.doc;
    assert.ok(duped.id);
    assert.equal(
      doc.elements.find((e) => e.id === duped.id)?.name,
      "Valhalla Crown Banner copy",
    );

    const updatedBp = applyDesign(bpWithPlaced, doc);

    // Dependent Scene Object updated automatically with new element name and new assetId
    const sceneObjAfterEdit = updatedBp.scenes[0]!.objects!.find((o) => o.id === "scene-obj-title")!;
    assert.equal(sceneObjAfterEdit.name, "Valhalla Crown Banner");
    assert.equal(sceneObjAfterEdit.assetId, titleArt.id);

    // Dependent Canvas background updated automatically
    assert.equal(updatedBp.canvas.backgroundAssetId, bgArt.id);

    // Dependent Animations list includes the new element animation cue
    assert.equal(updatedBp.animations.some((a) => a.target === titleId && a.kind === "Banner Shine"), true);

    // Persist through saveDesign and reload project
    await saveDesign(created.id, {
      baseRevision: created.revision,
      doc,
    });

    const reloaded = await getProject(created.id);
    assert.ok(reloaded);
    const reloadedTitle = reloaded.blueprint.elements.find((e) => e.id === titleId)!;
    assert.equal(reloadedTitle.name, "Valhalla Crown Banner");
    assert.equal(reloadedTitle.assetId, titleArt.id);
    assert.equal(reloadedTitle.imageHistory?.length, 1);

    // Deleting the element cleans up dependent animations and unbinds dependent scene objects
    const afterDeleteDoc = deleteElement(designDocFromBlueprint(updatedBp), titleId);
    const bpAfterDelete = applyDesign(updatedBp, afterDeleteDoc);
    assert.equal(bpAfterDelete.elements.some((e) => e.id === titleId), false);
    assert.equal(bpAfterDelete.animations.some((a) => a.target === titleId), false);
    assert.equal(bpAfterDelete.scenes[0]!.objects![0]!.refId, null);
  } finally {
    await deleteProject(created.id);
  }
});
