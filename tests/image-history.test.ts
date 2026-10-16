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
import { commitHistory, createHistory, redoHistory, undoHistory } from "../src/lib/design/history";
import {
  checkRevisionDeletionImpact,
  deleteImageRevision,
  getImageHistoryItems,
  setRevisionAsCurrent,
  updateImageRevisionLabel,
} from "../src/lib/design/image-history";
import { designDocFromBlueprint, migrateDoc } from "../src/lib/design/migrate";
import {
  addElement,
  addVariant,
  replaceElementArtwork,
  replaceSymbolArtwork,
} from "../src/lib/design/operations";
import { parseDesignDoc } from "../src/lib/design/parse";

function makeAsset(id: string, name: string): AssetRef {
  return {
    id,
    name,
    kind: "image",
    uri: `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==`,
    state: "linked",
    format: "png-transparent",
    mime: "image/png",
    width: 256,
    height: 256,
    sizeBytes: 2048,
    hasAlpha: true,
    tags: ["history-test"],
  };
}

test("F12 Build & Display: getImageHistoryItems exposes thumbnail, timestamp, source, label, and current indicator across multiple versions", () => {
  const bp = createBlueprint({ id: "prj-f12-1", title: "Chrono Spins", theme: "Time Travel" });
  let doc = migrateDoc(designDocFromBlueprint(bp));

  const symId = doc.symbols[0]!.id;
  const v1 = makeAsset("ast-sym-v1", "clock-face-v1.png");
  const v2 = makeAsset("ast-sym-v2", "clock-face-v2.png");
  const v3 = makeAsset("ast-sym-v3", "clock-face-v3.png");

  doc = replaceSymbolArtwork(doc, symId, v1, { source: "create", notes: "Initial clock concept" });
  doc = replaceSymbolArtwork(doc, symId, v2, { source: "upload", notes: "Added brass gears" });
  doc = replaceSymbolArtwork(doc, symId, v3, { source: "import", notes: "Final polished gold bezel" });

  // Changing current artwork never erases prior versions or their assets
  const items = getImageHistoryItems(doc, { kind: "symbol", id: symId });
  assert.equal(items.length, 3, "Keeps all 3 recorded versions");
  assert.ok(doc.assets.some((a) => a.id === "ast-sym-v1"), "Prior v1 asset preserved");
  assert.ok(doc.assets.some((a) => a.id === "ast-sym-v2"), "Prior v2 asset preserved");
  assert.ok(doc.assets.some((a) => a.id === "ast-sym-v3"), "Active v3 asset preserved");

  // Verify each revision displays thumbnail, timestamp, source, label, and current indicator
  const latest = items[0]!;
  const middle = items[1]!;
  const oldest = items[2]!;

  assert.equal(latest.versionNumber, 3);
  assert.ok(latest.thumbnailUri?.startsWith("data:image/png;base64,"), "Has thumbnail URI");
  assert.ok(latest.timestamp.length > 0 && latest.formattedTimestamp.length > 0, "Has timestamp");
  assert.equal(latest.source, "import");
  assert.equal(latest.sourceLabel, "Imported");
  assert.ok(latest.displayLabel.includes("Final polished gold bezel"), "Has display label");
  assert.equal(latest.isCurrent, true, "Latest matching revision is marked Current");

  assert.equal(middle.versionNumber, 2);
  assert.equal(middle.source, "upload");
  assert.equal(middle.sourceLabel, "Uploaded");
  assert.equal(middle.isCurrent, false);

  assert.equal(oldest.versionNumber, 1);
  assert.equal(oldest.source, "create");
  assert.equal(oldest.sourceLabel, "Created");
  assert.equal(oldest.isCurrent, false);

  // Edit revision custom label and notes
  doc = updateImageRevisionLabel(
    doc,
    { kind: "symbol", id: symId },
    middle.id,
    { label: "v2 — Brass Gears Milestone", notes: "Approved by art director" },
  );
  const updatedItems = getImageHistoryItems(doc, { kind: "symbol", id: symId });
  assert.equal(updatedItems[1]!.displayLabel, "v2 — Brass Gears Milestone");
  assert.equal(updatedItems[1]!.notes, "Approved by art director");
});

test("F12 Restore (Set as Current) & Undo/Redo: restoring an image creates a normal undoable state change without erasing prior versions", () => {
  const bp = createBlueprint({ id: "prj-f12-2", title: "Chrono Spins", theme: "Time Travel" });
  const initialDoc = migrateDoc(designDocFromBlueprint(bp));
  let history = createHistory(initialDoc);

  const added = addElement(history.present, { type: "game_title", name: "Chrono Banner" }, { glyphs: ["★"] });
  history = commitHistory(history, added.doc, "Add title element");
  const titleId = added.id;

  const artV1 = makeAsset("ast-banner-v1", "banner-v1.png");
  const artV2 = makeAsset("ast-banner-v2", "banner-v2.png");

  history = commitHistory(
    history,
    replaceElementArtwork(history.present, titleId, artV1, { source: "upload", notes: "Banner v1" }),
    "Upload banner v1",
  );
  history = commitHistory(
    history,
    replaceElementArtwork(history.present, titleId, artV2, { source: "upload", notes: "Banner v2" }),
    "Upload banner v2",
  );

  const itemsBeforeRestore = getImageHistoryItems(history.present, { kind: "element", id: titleId });
  assert.equal(itemsBeforeRestore.length, 2);
  const v1RevId = itemsBeforeRestore.find((i) => i.revision.asset?.assetId === "ast-banner-v1")!.id;

  // Set v1 as Current -> normal state change pushed to editor history
  const restoredDoc = setRevisionAsCurrent(
    history.present,
    { kind: "element", id: titleId },
    v1RevId,
    { notes: "Set v1 as current" },
  );
  history = commitHistory(history, restoredDoc, "Set v1 as current");

  let el = history.present.elements.find((e) => e.id === titleId)!;
  assert.equal(el.assetId, "ast-banner-v1", "v1 is now the active element artwork");
  assert.equal(el.imageHistory?.length, 3, "Prior v1 and v2 revisions are preserved alongside restore entry");
  assert.ok(history.present.assets.some((a) => a.id === "ast-banner-v2"), "v2 asset was not erased");

  // Undo the restore -> returns to v2!
  const undone = undoHistory(history);
  assert.ok(undone);
  history = undone.state;
  el = history.present.elements.find((e) => e.id === titleId)!;
  assert.equal(el.assetId, "ast-banner-v2", "Undo reverts active artwork back to v2");
  assert.equal(el.imageHistory?.length, 2);

  // Redo the restore -> returns to v1!
  const redone = redoHistory(history);
  assert.ok(redone);
  history = redone.state;
  el = history.present.elements.find((e) => e.id === titleId)!;
  assert.equal(el.assetId, "ast-banner-v1", "Redo re-applies Set as Current to v1");
});

test("F12 Delete Revision & Dependency Warning: blocks unconfirmed deletion when another component requires the version", () => {
  const bp = createBlueprint({ id: "prj-f12-3", title: "Relic Hunter", theme: "Adventure" });
  let doc = migrateDoc(designDocFromBlueprint(bp));

  const symId = doc.symbols[0]!.id;
  const artV1 = makeAsset("ast-relic-v1", "relic-v1.png");
  const artV2 = makeAsset("ast-relic-v2", "relic-v2.png");
  const artV3 = makeAsset("ast-relic-v3", "relic-v3.png");

  doc = replaceSymbolArtwork(doc, symId, artV1, { source: "upload", notes: "Relic v1" });
  doc = replaceSymbolArtwork(doc, symId, artV2, { source: "upload", notes: "Relic v2" });
  doc = replaceSymbolArtwork(doc, symId, artV3, { source: "upload", notes: "Relic v3" });

  // Bind artV1 to a variant on this symbol, and place artV1 onto a SceneObject
  doc = addVariant(doc, symId, {
    name: "Relic — Golden Variant",
    image: { provider: "project", assetId: "ast-relic-v1" },
  }).doc;

  const sceneObj: SceneObject = {
    id: "scene-obj-relic-v1",
    name: "Placed Relic V1",
    kind: "image",
    type: "image",
    layerId: bp.layers[0]!.id,
    x: 50,
    y: 50,
    width: 120,
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
    fontSize: 24,
    fontWeight: 600,
    align: "center",
    fill: null,
    stroke: null,
    shape: null,
    points: [],
    text: null,
    refId: null,
    assetId: "ast-relic-v1",
    parentId: null,
    groupId: null,
    expanded: true,
  };
  const bpWithScene: GameBlueprint = {
    ...bp,
    scenes: bp.scenes.map((s, idx) => (idx === 0 ? { ...s, objects: [sceneObj] } : s)),
  };

  const items = getImageHistoryItems(doc, { kind: "symbol", id: symId });
  const v1Item = items.find((i) => i.revision.asset?.assetId === "ast-relic-v1")!;
  const v2Item = items.find((i) => i.revision.asset?.assetId === "ast-relic-v2")!;
  const v3Item = items.find((i) => i.revision.asset?.assetId === "ast-relic-v3")!;

  // 1. v1 is required by a Variant and a SceneObject -> requiresWarning must be true!
  const v1Impact = checkRevisionDeletionImpact(doc, { kind: "symbol", id: symId }, v1Item.id, bpWithScene);
  assert.equal(v1Impact.requiresWarning, true);
  assert.ok(v1Impact.dependencies.some((d) => d.category === "variant"), "Detects variant dependency");
  assert.ok(v1Impact.dependencies.some((d) => d.category === "scene"), "Detects scene object dependency");

  // Attempting to delete v1 WITHOUT confirmWithDependencies must NOT delete it
  const blockedAttempt = deleteImageRevision(doc, { kind: "symbol", id: symId }, v1Item.id, {
    blueprint: bpWithScene,
  });
  assert.equal(blockedAttempt.deleted, false);
  assert.equal(blockedAttempt.blockedByDependencies, true);
  assert.equal(
    blockedAttempt.doc.symbols.find((s) => s.id === symId)?.imageHistory?.length,
    3,
    "Revision v1 was NOT deleted without confirmation",
  );

  // 2. v3 is the active Current image -> requiresWarning must be true!
  const v3Impact = checkRevisionDeletionImpact(doc, { kind: "symbol", id: symId }, v3Item.id, bpWithScene);
  assert.equal(v3Impact.isCurrentActive, true);
  assert.equal(v3Impact.requiresWarning, true);
  const blockedCurrent = deleteImageRevision(doc, { kind: "symbol", id: symId }, v3Item.id, {
    blueprint: bpWithScene,
  });
  assert.equal(blockedCurrent.deleted, false);
  assert.equal(blockedCurrent.blockedByDependencies, true);

  // 3. v2 has NO dependencies -> can be deleted cleanly without warning
  const v2Impact = checkRevisionDeletionImpact(doc, { kind: "symbol", id: symId }, v2Item.id, bpWithScene);
  assert.equal(v2Impact.requiresWarning, false);
  assert.equal(v2Impact.dependencies.length, 0);

  const cleanDelete = deleteImageRevision(doc, { kind: "symbol", id: symId }, v2Item.id, {
    blueprint: bpWithScene,
  });
  assert.equal(cleanDelete.deleted, true);
  assert.equal(cleanDelete.blockedByDependencies, false);
  doc = cleanDelete.doc;
  assert.equal(doc.symbols.find((s) => s.id === symId)?.imageHistory?.length, 2);

  // 4. Confirming deletion of v1 after warning removes the revision entry while keeping ast-relic-v1 in doc.assets for the variant & scene
  const confirmedDelete = deleteImageRevision(doc, { kind: "symbol", id: symId }, v1Item.id, {
    confirmWithDependencies: true,
    blueprint: bpWithScene,
  });
  assert.equal(confirmedDelete.deleted, true);
  doc = confirmedDelete.doc;
  assert.equal(doc.symbols.find((s) => s.id === symId)?.imageHistory?.length, 1);
  assert.ok(doc.assets.some((a) => a.id === "ast-relic-v1"), "Underlying asset preserved for dependent variant & scene");
});

test("F12 Acceptance: Image history survives project persistence and changing current artwork never erases prior versions", async () => {
  const { createProject, deleteProject, getProject } = await import("../src/server/workspace-service");
  const { saveDesign, uploadAsset } = await import("../src/server/design-service");

  const project = await createProject({
    title: "F12 Image History Persistence Test",
    theme: "Cyberpunk",
  });

  try {
    let doc = migrateDoc(designDocFromBlueprint(project.blueprint));
    const bgEl = doc.elements.find((e) => e.type === "game_background")!;

    const svg1 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#0f172a"/></svg>`;
    const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#1e1b4b"/></svg>`;
    const svg3 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180"><rect width="320" height="180" fill="#311042"/></svg>`;

    const up1 = await uploadAsset(project.id, {
      name: "neon-city-v1.svg",
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg1).toString("base64")}`,
    });
    const up2 = await uploadAsset(project.id, {
      name: "neon-city-v2.svg",
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg2).toString("base64")}`,
    });
    const up3 = await uploadAsset(project.id, {
      name: "neon-city-v3.svg",
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg3).toString("base64")}`,
    });

    doc = replaceElementArtwork(doc, bgEl.id, up1.asset, { source: "upload", notes: "Neon City v1" });
    doc = replaceElementArtwork(doc, bgEl.id, up2.asset, { source: "upload", notes: "Neon City v2" });
    doc = replaceElementArtwork(doc, bgEl.id, up3.asset, { source: "upload", notes: "Neon City v3" });

    const items = getImageHistoryItems(doc, { kind: "element", id: bgEl.id });
    assert.equal(items.length, 4, "Preserves initial factory background + 3 uploaded revisions");
    const v1RevId = items.find((i) => i.revision.asset?.assetId === up1.asset.id)!.id;

    // Label v1 and restore v1 as current
    doc = updateImageRevisionLabel(
      doc,
      { kind: "element", id: bgEl.id },
      v1RevId,
      { label: "v1 — Midnight Rain", notes: "Original rain atmosphere" },
    );
    doc = setRevisionAsCurrent(doc, { kind: "element", id: bgEl.id }, v1RevId, {
      notes: "Restored Midnight Rain v1",
    });

    const parsed = parseDesignDoc(JSON.parse(JSON.stringify(doc)));
    assert.equal(parsed.ok, true);

    await saveDesign(project.id, {
      baseRevision: project.revision,
      doc,
    });

    const reloaded = await getProject(project.id);
    assert.ok(reloaded);
    assert.equal(validateBlueprint(reloaded.blueprint).integrityOk, true);

    const reloadedBg = reloaded.blueprint.elements.find((e) => e.id === bgEl.id)!;
    assert.equal(reloadedBg.assetId, up1.asset.id, "Restored v1 is active after reload");
    assert.equal(
      reloadedBg.imageHistory?.length,
      5,
      "Initial factory artwork + 3 uploads + 1 restore revision persisted",
    );
    assert.equal(
      reloadedBg.imageHistory?.find((r) => r.id === v1RevId)?.label,
      "v1 — Midnight Rain",
      "Custom revision label persisted",
    );
    assert.ok(reloaded.blueprint.assets.some((a) => a.id === up1.asset.id), "v1 asset persisted");
    assert.ok(reloaded.blueprint.assets.some((a) => a.id === up2.asset.id), "v2 asset persisted");
    assert.ok(reloaded.blueprint.assets.some((a) => a.id === up3.asset.id), "v3 asset persisted");
  } finally {
    await deleteProject(project.id);
  }
});
