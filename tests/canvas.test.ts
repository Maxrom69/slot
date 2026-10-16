import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import type { AssetRef, GameBlueprint, SceneObject } from "../src/lib/blueprint/types";

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
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { draftToBlueprint } from "../src/lib/creation/blueprint-from-draft";
import { createDefaultDraft } from "../src/lib/creation/draft";
import {
  DEG, aabbOf, boxContainsPoint, centerOf, clean, fitViewport, handleWorld, normalizeAngle, objectContainsPoint,
  objectCorners, resizeTransform, rotateAround, rotatePoint, scaleTransforms, snapAngle, toScreen, toWorld, unionBox,
  zoomViewport, type Transform,
} from "../src/lib/canvas/geometry";
import { createFreehandObject, createShapeObject, createStrokeObject, createTextObject, newSceneObject } from "../src/lib/canvas/create";
import { parseSceneDoc } from "../src/lib/canvas/parse";
import { computeSnap, alignBoxes } from "../src/lib/canvas/snapping";
import {
  alignObjects, applyTransforms, deleteObjects, distributeObjects, duplicateObjects, hitTestObjects, moveObjects, nudgeDelta,
  previewMove, previewResize, previewRotate,
  objectsInMarquee, patchObjects, reorderObjects, rotateObjects, scaleObjects,
} from "../src/lib/canvas/operations";
import { SHORTCUT_TO_TOOL, TOOLS, isCreateTool, type ToolId } from "../src/lib/canvas/tools";
import { applyDesign, designDocFromBlueprint, migrateBlueprint, sceneAssetIds } from "../src/lib/design/migrate";
import { finalizeDoc } from "../src/lib/design/model";

const NOW = "2026-01-01T00:00:00.000Z";
const bp = (): GameBlueprint => draftToBlueprint({ ...createDefaultDraft(), title: "Canvas Test", theme: "Roman Empire" }, { id: "t", now: NOW });
const layer = bp().layers[0].id;
const T = (x: number, y: number, width: number, height: number, rotation = 0): Transform => ({ x, y, width, height, rotation });
const obj = (over: Partial<SceneObject> = {}): SceneObject =>
  newSceneObject({ id: "obj-1", name: "Object 1", kind: "shape", layerId: layer, x: 0, y: 0, width: 100, height: 100, ...over });

/* --------------------------------- geometry --------------------------------- */

test("rotation maths round-trips and reports rotated bounds", () => {
  const point = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
  assert.deepEqual(point, { x: 6.123233995736766e-16, y: 10 });
  const t = T(0, 0, 100, 50, 90);
  const box = aabbOf(t);
  assert.equal(Math.round(box.w), 50);
  assert.equal(Math.round(box.h), 100);
  assert.deepEqual(centerOf(t), { x: 50, y: 25 });
  assert.equal(boxContainsPoint(box, { x: 26, y: 25 }), true);
  assert.equal(objectContainsPoint(t, { x: 50, y: 0 }), true, "inside the rotated object");
  assert.equal(objectContainsPoint(t, { x: 0, y: 0 }), false, "outside the rotated object");
  assert.equal(objectCorners(t).length, 4);
});

test("resizeTransform keeps the opposite handle anchored, even when rotated", () => {
  const flat = resizeTransform(T(0, 0, 100, 100), "se", { x: 150, y: 120 });
  assert.deepEqual({ x: flat.x, y: flat.y, w: flat.width, h: flat.height }, { x: 0, y: 0, w: 150, h: 120 });

  const grown = resizeTransform(T(0, 0, 100, 100), "nw", { x: -40, y: -20 });
  assert.equal(grown.x, -40);
  assert.equal(grown.y, -20);
  assert.equal(grown.width, 140);
  assert.equal(grown.height, 120);

  // dragging the se handle of a 90°-rotated box must not move its nw corner
  const rotated = T(0, 0, 100, 100, 90);
  const next = resizeTransform(rotated, "se", { x: 200, y: 100 });
  const before = handleWorld(rotated, "nw");
  const after = handleWorld(next, "nw");
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < 0.001, "north-west corner stays put");

  const aspect = resizeTransform(T(0, 0, 100, 50), "se", { x: 400, y: 400 }, { keepAspect: true });
  assert.equal(Math.round(aspect.width / aspect.height), 2);
  assert.deepEqual(
    resizeTransform(T(10, 20, 100, 80), "n", { x: 30, y: -10 }),
    { x: 10, y: -10, width: 100, height: 110, rotation: 0 },
    "north edge handle keeps x/width/bottom anchored regardless of pointer x",
  );
  assert.deepEqual(
    resizeTransform(T(10, 20, 100, 80), "s", { x: 95, y: 140 }),
    { x: 10, y: 20, width: 100, height: 120, rotation: 0 },
    "south edge handle keeps x/y/width anchored regardless of pointer x",
  );
  assert.deepEqual(
    resizeTransform(T(10, 20, 100, 80), "e", { x: 160, y: 35 }),
    { x: 10, y: 20, width: 150, height: 80, rotation: 0 },
    "east edge handle keeps x/y/height anchored regardless of pointer y",
  );
  assert.deepEqual(
    resizeTransform(T(10, 20, 100, 80), "w", { x: -20, y: 85 }),
    { x: -20, y: 20, width: 130, height: 80, rotation: 0 },
    "west edge handle keeps y/height/right anchored regardless of pointer y",
  );
  assert.equal(resizeTransform(T(0, 0, 10, 10), "se", { x: -2, y: -2 }).width, 4, "minimum size is enforced");
  assert.equal(resizeTransform(T(0, 0, 10, 10), "se", { x: -2, y: -2 }).x, -4, "growing north-west moves the origin");
});

test("group rotation and scaling transform every member about the shared pivot", () => {
  const list = [T(0, 0, 10, 10), T(20, 0, 10, 10)];
  const rotated = rotateAround(list, { x: 15, y: 5 }, 180);
  assert.equal(Math.round(rotated[0].rotation), 180);
  assert.ok(Math.abs(rotated[1].x) < 0.001, "the far object rotates to the near side");
  const scaled = scaleTransforms(list, { x: 0, y: 0 }, 2, 1);
  assert.equal(scaled[1].x, 40);
  assert.equal(scaled[0].width, 20);
  assert.deepEqual(unionBox([aabbOf(list[0]), aabbOf(list[1])]), { x: 0, y: 0, w: 30, h: 10 });
});

test("viewport maths keeps the point under the cursor still while zooming", () => {
  const view = { scale: 1, x: 0, y: 0 };
  const anchor = { x: 400, y: 300 };
  assert.deepEqual(toWorld(view, anchor), { x: 400, y: 300 });
  const zoomed = zoomViewport(view, 2, anchor);
  assert.deepEqual(toWorld(zoomed, anchor), { x: 400, y: 300 });
  assert.deepEqual(toScreen(zoomed, { x: 400, y: 300 }), anchor);
  assert.equal(zoomViewport(view, 999, anchor).scale, 8, "clamped to the maximum");
  assert.equal(zoomViewport(view, 0.0001, anchor).scale, 0.1, "clamped to the minimum");
  const fit = fitViewport(view, { x: 0, y: 0, w: 1920, h: 1080 }, { w: 1000, h: 800 });
  assert.ok(fit.scale < 1 && fit.scale > 0.1);
  assert.ok(toScreen(fit, { x: 0, y: 0 }).x >= 0);
  assert.equal(normalizeAngle(270), -90);
  assert.equal(snapAngle(17), 15);
  assert.equal(clean(100.5), 100.5);
  assert.equal(clean(1.000000001), 1);
  assert.equal(Math.round(1 * DEG), 0);
});

/* --------------------------------- snapping --------------------------------- */

test("snapping aligns edges, centres, the scene frame, the safe area and the grid", () => {
  const targets = [{ x: 200, y: 0, w: 100, h: 100 }];
  const canvas = { x: 0, y: 0, w: 1000, h: 800 };
  const edge = computeSnap({ box: { x: 195, y: 0, w: 100, h: 100 }, targets, canvas, threshold: 6, scale: 1 });
  assert.equal(edge.dx, 5, "snaps the moving edge onto the target edge");
  assert.equal(edge.guides[0].axis, "v");
  assert.equal(edge.guides[0].at, 200);

  const centre = computeSnap({ box: { x: 444, y: 0, w: 100, h: 100 }, targets: [], canvas, threshold: 8, scale: 1 });
  assert.equal(centre.dx, 6, "snaps to the scene centre at 500");
  assert.equal(centre.guides[0].at, 500);

  const safe = computeSnap({ box: { x: 96, y: 0, w: 100, h: 100 }, targets: [], canvas, safe: { x: 100, y: 50, w: 800, h: 700 }, threshold: 6, scale: 1 });
  assert.equal(safe.dx, 4);

  // away from the frame so only the grid can attract it
  const grid = computeSnap({ box: { x: 41, y: 41, w: 100, h: 100 }, targets: [], canvas, gridSize: 40, threshold: 6, scale: 1 });
  assert.equal(grid.dx, -1);
  assert.equal(grid.guides.length, 0, "grid snapping draws no guide");

  const far = computeSnap({ box: { x: 500, y: 0, w: 100, h: 100 }, targets, canvas, threshold: 6, scale: 1 });
  assert.equal(far.dx, 0, "beyond the threshold nothing snaps");

  const zoomed = computeSnap({ box: { x: 194, y: 0, w: 100, h: 100 }, targets, canvas, threshold: 6, scale: 0.1 });
  assert.equal(zoomed.dx, 6, "the threshold is expressed in screen pixels");

  assert.deepEqual(alignBoxes(targets, "right", canvas), [0]);
});

/* -------------------------------- operations -------------------------------- */

test("scene operations move, resize, rotate, duplicate, delete and reorder", () => {
  let objects = [obj({ id: "a", name: "A" }), obj({ id: "b", name: "B", x: 150 }), obj({ id: "c", name: "C", x: 300 })];
  objects = moveObjects(objects, ["a"], { x: 10, y: 5 });
  assert.deepEqual({ x: objects[0].x, y: objects[0].y }, { x: 10, y: 5 });

  objects = rotateObjects(objects, ["b"], { x: 200, y: 50 }, 90);
  assert.equal(Math.round(objects[1].rotation), 90);
  objects = scaleObjects(objects, ["b"], { x: 0, y: 0 }, 2, 1);
  assert.equal(objects[1].width, 200);

  const copy = duplicateObjects(objects, ["a", "b"]);
  assert.equal(copy.ids.length, 2);
  assert.ok(copy.objects.some((o) => o.name === "A copy"));
  assert.ok(copy.objects.every((o) => !["a", "b"].includes(o.id) || !copy.ids.includes(o.id)));
  const clone = copy.objects.find((o) => o.id === copy.ids[0])!;
  assert.equal(clone.x, 10 + 24);

  const smaller = deleteObjects(copy.objects, copy.ids);
  assert.equal(smaller.length, 3);

  const ordered = reorderObjects(objects, "c", "back");
  assert.equal(ordered[0].id, "c");
  assert.equal(reorderObjects(objects, "c", "forward"), objects, "already at the end");
  const patched = patchObjects(objects, ["a"], { opacity: 0.5 });
  assert.equal(patched[0].opacity, 0.5);

  const aligned = alignObjects(objects, ["a", "b"], "right", { x: 0, y: 0, w: 1000, h: 800 });
  assert.equal(aligned[0].x + aligned[0].width, aligned[1].x + aligned[1].width);
  const spread = alignObjects(objects, ["a", "b", "c"], "middle", { x: 0, y: 0, w: 1000, h: 800 });
  assert.ok(spread.every((o) => o.height === 100));

  const distributed = distributeObjects(objects, ["a", "b", "c"], "x");
  assert.equal(distributed[1].x, 155);

  assert.deepEqual(nudgeDelta("ArrowLeft", true), { x: -10, y: 0 });
  assert.deepEqual(nudgeDelta("ArrowUp", false), { x: 0, y: -1 });
});

test("drag previews are absolute, so repeated pointer events never compound", () => {
  const starts = [obj({ id: "m", x: 100, y: 50, width: 40, height: 30 }), obj({ id: "n", x: 200, y: 50, width: 40, height: 30 })];
  // Five pointermove events, each applying the full delta measured from the drag start.
  let objects = starts;
  for (const step of [1, 2, 3, 4, 5]) {
    objects = applyTransforms(objects, starts.map((o) => o.id), previewMove(starts, step * 2, step));
  }
  const moved = objects.find((o) => o.id === "m")!;
  assert.equal(moved.x, 110);
  assert.equal(moved.y, 55);
  assert.equal(moved.width, 40);

  const resized = previewResize(starts, { x: 100, y: 50, width: 140, height: 30, rotation: 0 }, "se", { x: 300, y: 120 });
  let scaled = starts;
  for (let i = 0; i < 4; i += 1) scaled = applyTransforms(scaled, starts.map((o) => o.id), resized.transforms);
  assert.ok(Math.abs(scaled[1].x + scaled[1].width - 300) < 0.001, "the group edge lands where the drag ended");
  assert.equal(scaled[0].x, 100, "the group origin stays anchored");

  const rotated = previewRotate(starts, { x: 170, y: 65 }, 90);
  let spun = starts;
  for (let i = 0; i < 4; i += 1) spun = applyTransforms(spun, starts.map((o) => o.id), rotated);
  assert.equal(Math.round(spun[0].rotation), 90, "rotation is absolute, not accumulated");
});

test("hit testing picks the smallest object and the marquee picks intersecting ones", () => {
  const layers = bp().layers;
  const objects = [
    obj({ id: "big", x: 0, y: 0, width: 500, height: 500 }),
    obj({ id: "small", x: 100, y: 100, width: 50, height: 50 }),
    obj({ id: "hidden", x: 100, y: 100, width: 10, height: 10, visible: false }),
    obj({ id: "locked", x: 100, y: 100, width: 10, height: 10, locked: true }),
  ];
  assert.deepEqual(hitTestObjects(objects, layers, { x: 120, y: 120 }), ["small"]);
  assert.deepEqual(objectsInMarquee(objects, layers, { x: 0, y: 0, w: 1000, h: 1000 }).sort(), ["big", "small"]);
});

/* ------------------------------ objects and parse ------------------------------ */

test("created objects are complete and freehand paths normalise into their box", () => {
  const palette = bp().style.palette;
  const text = createTextObject(layer, { x: 10, y: 20 }, palette, 1);
  assert.equal(text.kind, "text");
  assert.equal(text.text, "Text");
  const shape = createShapeObject(layer, "ellipse", { x: 0, y: 0, width: 80, height: 60 }, palette, 2);
  assert.equal(shape.shape, "ellipse");
  const stroke = createStrokeObject(layer, "arrow", { x: 100, y: 100 }, { x: 40, y: 60 }, palette, 3);
  assert.equal(stroke.arrow, true);
  assert.deepEqual(stroke.points[0], { x: 1, y: 1 }, "start point is preserved");
  assert.ok(stroke.points[1].x < 0.01);
  const path = createFreehandObject(layer, [{ x: 10, y: 10 }, { x: 50, y: 30 }, { x: 30, y: 60 }], palette, 4);
  assert.ok(path);
  assert.equal(path!.x, 10);
  assert.equal(path!.width, 40);
  assert.ok(path!.points.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1));
  assert.equal(createFreehandObject(layer, [{ x: 1, y: 1 }], palette, 5), null);
});

test("parseSceneDoc accepts real data and rejects hostile values", () => {
  const good = parseSceneDoc({ objects: [obj({ id: "ok-1" })], background: { color: "#0a0c11", assetId: null } });
  assert.equal(good.ok, true);
  const layers = parseSceneDoc({ objects: [], background: {}, layers: bp().layers });
  assert.equal(layers.ok, true);
  const swap = (fn: (data: Record<string, unknown>) => void) => {
    const data: Record<string, unknown> = { objects: [JSON.parse(JSON.stringify(obj({ id: "x-1" })))], background: {} };
    fn(data);
    return parseSceneDoc(data);
  };
  assert.equal(parseSceneDoc(null).ok, false);
  assert.equal(swap((d) => { (d.objects as { kind: string }[])[0].kind = "portal"; }).ok, false);
  assert.equal(swap((d) => { (d.objects as { id: string }[])[0].id = "../../x"; }).ok, false);
  assert.equal(swap((d) => { (d.objects as { width: number }[])[0].width = -5; }).ok, false);
  assert.equal(swap((d) => { (d.objects as { fill: string }[])[0].fill = "javascript:alert(1)"; }).ok, false);
  assert.equal(swap((d) => { (d.objects as { name: string }[])[0].name = ""; }).ok, false);
  assert.equal(swap((d) => { (d.objects as { points: unknown[] }[])[0].points = new Array(700).fill({ x: 0, y: 0 }); }).ok, false);
  assert.equal(swap((d) => { d.objects = new Array(400).fill(d.objects); }).ok, false);
  assert.equal(swap((d) => { (d.objects as { opacity: number }[])[0].opacity = 4; }).ok, false);
});

/* --------------------------- blueprint integration --------------------------- */

test("scene layout is stored on the blueprint and survives design edits and migration", () => {
  const project = bp();
  const asset: AssetRef = { id: "canvas-art", name: "art.png", kind: "image", uri: "/api/assets/ast_x", state: "linked", tags: [] };
  const withScene: GameBlueprint = {
    ...project,
    assets: [...project.assets, asset],
    scenes: project.scenes.map((scene, index) => ({
      ...scene,
      objects: [obj({ id: "placed-1", kind: "symbol", refId: project.symbols[0].id, assetId: "canvas-art", width: 200, height: 200, rotation: 15 })],
      background: { color: "#101820", assetId: index === 0 ? "canvas-art" : null },
    })),
  };
  assert.deepEqual(sceneAssetIds(withScene), ["canvas-art"]);

  // A design edit must not prune artwork referenced by the scene.
  const doc = designDocFromBlueprint(withScene);
  assert.ok(finalizeDoc(doc).assets.some((a) => a.id === "canvas-art"), "scene artwork survives pruning");
  const stray: AssetRef = { id: "stray", name: "stray.png", kind: "image", uri: "/api/assets/ast_y", state: "linked", tags: [] };
  const unprotected = finalizeDoc({ ...doc, assets: [...doc.assets, stray], protectedAssetIds: [] });
  assert.equal(unprotected.assets.some((a) => a.id === "stray"), false, "unreferenced, unprotected artwork is pruned");

  const migrated = migrateBlueprint(withScene);
  assert.deepEqual(migrated.scenes[0].objects, withScene.scenes[0].objects);
  assert.deepEqual(migrated.scenes[0].background, withScene.scenes[0].background);
  assert.deepEqual(migrateBlueprint(migrated), migrated, "idempotent");
  assert.deepEqual(validateBlueprint(applyDesign(withScene, doc)).integrityIssues, []);

  // Objects referencing a missing symbol are a real integrity problem for the canvas service.
  const broken: GameBlueprint = {
    ...withScene,
    scenes: withScene.scenes.map((scene) => ({ ...scene, objects: [obj({ id: "dangling-1", refId: "nope" })] })),
  };
  const refIds = new Set([...broken.symbols.map((s) => s.id), ...broken.elements.map((e) => e.id)]);
  assert.equal(broken.scenes[0].objects?.some((o) => o.refId && !refIds.has(o.refId)) ?? false, true);
});

test("every tool is registered, shortcut-bound and either available or explained", () => {
  const ids = new Set(TOOLS.map((t) => t.id));
  const expected: ToolId[] = ["select", "pan", "text", "rect", "ellipse", "triangle", "line", "arrow", "freehand", "paint", "eraser", "blur", "eyedropper"];
  assert.ok(expected.every((id) => ids.has(id)));
  for (const tool of TOOLS) {
    if (tool.available) assert.ok(tool.shortcut, `${tool.label} should have a shortcut`);
    else assert.ok(tool.unavailableReason, `${tool.label} must explain why it is unavailable`);
  }
  assert.equal(SHORTCUT_TO_TOOL.v, "select");
  assert.equal(isCreateTool("rect"), true);
  assert.equal(isCreateTool("select"), false);
});

test("F05 acceptance: scene objects (select, move, resize, rotate, duplicate, delete, background) persist to GameBlueprint", async () => {
  const { createProject, deleteProject, getProject } = await import("../src/server/workspace-service");
  const { saveScene } = await import("../src/server/canvas-service");

  const created = await createProject({
    title: "F05 Canvas Persistence Test",
    theme: "Neon Arcade",
  });

  try {
    const sceneId = created.blueprint.scenes[0].id;
    const targetLayerId = created.blueprint.layers.find((l) => !l.locked)?.id ?? created.blueprint.layers[0].id;

    // 1. Create a rectangle and text object on the canvas
    const rectObj = createShapeObject(
      targetLayerId,
      "rect",
      { x: 100, y: 120, width: 200, height: 150 },
      created.blueprint.style.palette,
      1,
    );
    const textObj = createTextObject(
      targetLayerId,
      { x: 400, y: 200 },
      created.blueprint.style.palette,
      2,
    );
    let objects: SceneObject[] = [rectObj, textObj];

    // 2. Move, resize, and rotate the rectangle
    objects = moveObjects(objects, [rectObj.id], { x: 25, y: 15 });
    const resized = resizeTransform(
      {
        x: objects[0].x,
        y: objects[0].y,
        width: objects[0].width,
        height: objects[0].height,
        rotation: objects[0].rotation,
      },
      "se",
      { x: objects[0].x + 300, y: objects[0].y + 220 },
    );
    objects = applyTransforms(objects, [rectObj.id], [resized]);
    objects = rotateObjects(objects, [rectObj.id], centerOf(resized), 30);

    // 3. Duplicate the transformed rectangle
    const dup = duplicateObjects(objects, [rectObj.id]);
    objects = dup.objects;
    assert.equal(objects.length, 3);

    // 4. Delete the text object
    objects = deleteObjects(objects, [textObj.id]);
    assert.equal(objects.length, 2);

    // 5. Persist scene layout and configurable background to GameBlueprint
    const saved = await saveScene(created.id, {
      baseRevision: created.revision,
      sceneId,
      objects,
      background: { color: "#121a2b", assetId: null },
      layers: created.blueprint.layers,
    });
    assert.ok(saved.revision > created.revision);

    // 6. Reload project and verify GameBlueprint scene layout
    const reloaded = await getProject(created.id);
    assert.ok(reloaded);
    const persistedScene = reloaded.blueprint.scenes.find((s) => s.id === sceneId)!;
    assert.equal(persistedScene.objects?.length, 2);
    assert.equal(persistedScene.background?.color, "#121a2b");
    const persistedRect = persistedScene.objects!.find((o) => o.id === rectObj.id)!;
    assert.equal(Math.round(persistedRect.width), 300);
    assert.equal(Math.round(persistedRect.height), 220);
    assert.equal(Math.round(persistedRect.rotation), 30);
    assert.ok(persistedScene.objects!.some((o) => o.id === dup.ids[0]));
  } finally {
    await deleteProject(created.id);
  }
});
