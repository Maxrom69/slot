import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import type { LayerDef, SceneObject } from "../src/lib/blueprint/types";

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
import { newSceneObject } from "../src/lib/canvas/create";
import {
  createGroup, ungroup, renameGroup, duplicateGroup, deleteGroup, toggleGroupExpand,
  reorderLayerItem, moveLayerItemToIndex, reorderBlueprintLayers, toggleLayer,
  moveObjects, rotateObjects, scaleObjects, deleteObjects, duplicateObjects,
} from "../src/lib/canvas/operations";
import { parseSceneDoc, parseObject, parseLayer, BLEND_MODES } from "../src/lib/canvas/parse";

const obj = (over: Partial<SceneObject> = {}): SceneObject =>
  newSceneObject({ id: "obj-1", name: "Object 1", kind: "shape", layerId: "layer-reels", x: 10, y: 20, width: 100, height: 100, ...over });

/* --------------------------------- Group Operations --------------------------------- */

test("createGroup creates a group enclosing selected objects and sets parentId/groupId", () => {
  const o1 = obj({ id: "o1", name: "Box 1", x: 100, y: 100, width: 50, height: 50 });
  const o2 = obj({ id: "o2", name: "Box 2", x: 200, y: 150, width: 80, height: 60 });
  const initial = [o1, o2];

  const { objects, groupId } = createGroup(initial, ["o1", "o2"]);
  assert.ok(groupId);
  assert.equal(objects.length, 3, "adds group object container");

  const group = objects.find((o) => o.id === groupId)!;
  assert.equal(group.kind, "group");
  assert.equal(group.type, "group");
  assert.equal(group.x, 100);
  assert.equal(group.y, 100);
  assert.equal(group.width, 180, "width encompasses 100 to 280");
  assert.equal(group.height, 110, "height encompasses 100 to 210");
  assert.equal(group.expanded, true);

  const child1 = objects.find((o) => o.id === "o1")!;
  const child2 = objects.find((o) => o.id === "o2")!;
  assert.equal(child1.groupId, groupId);
  assert.equal(child1.parentId, groupId);
  assert.equal(child2.groupId, groupId);
  assert.equal(child2.parentId, groupId);
});

test("ungroup removes the group container and clears groupId/parentId on children", () => {
  const o1 = obj({ id: "o1", name: "Box 1", groupId: "g1", parentId: "g1" });
  const o2 = obj({ id: "o2", name: "Box 2", groupId: "g1", parentId: "g1" });
  const group = obj({ id: "g1", name: "Group 1", kind: "group" });
  const initial = [group, o1, o2];

  const { objects, releasedIds } = ungroup(initial, ["g1"]);
  assert.equal(objects.length, 2);
  assert.equal(objects.some((o) => o.id === "g1"), false);
  assert.deepEqual(releasedIds.sort(), ["o1", "o2"].sort());

  const child1 = objects.find((o) => o.id === "o1")!;
  assert.equal(child1.groupId, null);
  assert.equal(child1.parentId, null);
});

test("renameGroup updates the group name", () => {
  const group = obj({ id: "g1", name: "Group 1", kind: "group" });
  const renamed = renameGroup([group], "g1", "Reel Elements");
  assert.equal(renamed[0].name, "Reel Elements");
  // blank name is ignored
  assert.equal(renameGroup([group], "g1", "   ")[0].name, "Group 1");
});

test("duplicateGroup duplicates the group container and all its children with new IDs", () => {
  const o1 = obj({ id: "o1", name: "Box 1", groupId: "g1", parentId: "g1", x: 10, y: 10 });
  const o2 = obj({ id: "o2", name: "Box 2", groupId: "g1", parentId: "g1", x: 50, y: 50 });
  const group = obj({ id: "g1", name: "Group 1", kind: "group", x: 10, y: 10 });
  const initial = [group, o1, o2];

  const result = duplicateObjects(initial, ["g1"]);
  assert.equal(result.objects.length, 6, "3 original + 3 duplicates");
  const cloneGroup = result.objects.find((o) => o.id === result.ids[0])!;
  assert.equal(cloneGroup.kind, "group");
  assert.ok(cloneGroup.name.includes("Group 1"));

  const clonedChildren = result.objects.filter((o) => o.groupId === cloneGroup.id);
  assert.equal(clonedChildren.length, 2, "children belong to cloned group");
  assert.ok(clonedChildren.every((c) => c.id !== "o1" && c.id !== "o2"));
});

test("deleteGroup or deleteObjects deletes the group and all its children", () => {
  const o1 = obj({ id: "o1", name: "Box 1", groupId: "g1", parentId: "g1" });
  const o2 = obj({ id: "o2", name: "Box 2", groupId: "g1", parentId: "g1" });
  const o3 = obj({ id: "o3", name: "Independent Box" });
  const group = obj({ id: "g1", name: "Group 1", kind: "group" });
  const initial = [group, o1, o2, o3];

  const afterDelete = deleteObjects(initial, ["g1"]);
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].id, "o3");
});

test("toggleGroupExpand toggles expanded state", () => {
  const group = obj({ id: "g1", name: "Group 1", kind: "group", expanded: true });
  const collapsed = toggleGroupExpand([group], "g1");
  assert.equal(collapsed[0].expanded, false);
  const expanded = toggleGroupExpand(collapsed, "g1");
  assert.equal(expanded[0].expanded, true);
});

test("moveObjects moves group and all its children together", () => {
  const o1 = obj({ id: "o1", name: "Box 1", groupId: "g1", x: 10, y: 20 });
  const o2 = obj({ id: "o2", name: "Box 2", groupId: "g1", x: 50, y: 60 });
  const group = obj({ id: "g1", name: "Group 1", kind: "group", x: 10, y: 20 });
  const initial = [group, o1, o2];

  const moved = moveObjects(initial, ["g1"], { x: 30, y: 40 });
  const g = moved.find((o) => o.id === "g1")!;
  const c1 = moved.find((o) => o.id === "o1")!;
  const c2 = moved.find((o) => o.id === "o2")!;

  assert.equal(g.x, 40);
  assert.equal(g.y, 60);
  assert.equal(c1.x, 40);
  assert.equal(c1.y, 60);
  assert.equal(c2.x, 80);
  assert.equal(c2.y, 100);
});

/* --------------------------- Layer Reordering --------------------------- */

test("reorderLayerItem moves items up and down in layer stack", () => {
  const a = obj({ id: "a", name: "A", layerId: "layer-1" });
  const b = obj({ id: "b", name: "B", layerId: "layer-1" });
  const c = obj({ id: "c", name: "C", layerId: "layer-1" });
  const initial = [a, b, c]; // rendering order: a (bottom), b (mid), c (top)

  // In layers panel: Top = Foreground (c), Bottom = Background (a)
  // Move 'a' up (towards foreground): should swap with b
  const up = reorderLayerItem(initial, "a", "up");
  assert.deepEqual(up.map((o) => o.id), ["b", "a", "c"]);

  // Move 'c' down (towards background): should swap with b
  const down = reorderLayerItem(initial, "c", "down");
  assert.deepEqual(down.map((o) => o.id), ["a", "c", "b"]);

  // Move 'a' to top (foreground)
  const top = reorderLayerItem(initial, "a", "top");
  assert.deepEqual(top.map((o) => o.id), ["b", "c", "a"]);

  // Move 'c' to bottom (background)
  const bottom = reorderLayerItem(initial, "c", "bottom");
  assert.deepEqual(bottom.map((o) => o.id), ["c", "a", "b"]);
});

test("moveLayerItemToIndex moves dragged item before or after target", () => {
  const a = obj({ id: "a", layerId: "layer-1" });
  const b = obj({ id: "b", layerId: "layer-1" });
  const c = obj({ id: "c", layerId: "layer-1" });
  const initial = [a, b, c];

  const res1 = moveLayerItemToIndex(initial, "c", "a", "before");
  assert.deepEqual(res1.map((o) => o.id), ["c", "a", "b"]);

  const res2 = moveLayerItemToIndex(initial, "a", "c", "after");
  assert.deepEqual(res2.map((o) => o.id), ["b", "c", "a"]);
});

test("reorderBlueprintLayers reorders blueprint layers and updates order indices", () => {
  const l1: LayerDef = { id: "l1", name: "Layer 1", kind: "background", order: 0, visible: true, locked: true, opacity: 1 };
  const l2: LayerDef = { id: "l2", name: "Layer 2", kind: "reels", order: 1, visible: true, locked: false, opacity: 1 };
  const l3: LayerDef = { id: "l3", name: "Layer 3", kind: "ui", order: 2, visible: true, locked: false, opacity: 1 };
  const initial = [l1, l2, l3];

  const reordered = reorderBlueprintLayers(initial, "l3", "l1", "before");
  assert.deepEqual(reordered.map((l) => l.id), ["l3", "l1", "l2"]);
  assert.deepEqual(reordered.map((l) => l.order), [0, 1, 2]);
});

test("toggleLayer updates layer properties (visible, locked, opacity, blendMode)", () => {
  const layer: LayerDef = { id: "l1", name: "Layer 1", kind: "reels", order: 0, visible: true, locked: false, opacity: 1 };
  const updated = toggleLayer([layer], "l1", { visible: false, locked: true, opacity: 0.75, blendMode: "multiply" });
  assert.equal(updated[0].visible, false);
  assert.equal(updated[0].locked, true);
  assert.equal(updated[0].opacity, 0.75);
  assert.equal(updated[0].blendMode, "multiply");
});

/* --------------------------- Background & Layer States --------------------------- */

test("default blueprint background layer defaults to locked: true", () => {
  const bp = createBlueprint({ id: "test-bp", title: "Test", theme: "Roman Empire" });
  const bgLayer = bp.layers.find((l) => l.id === "layer-bg" || l.kind === "background")!;
  assert.ok(bgLayer, "background layer exists");
  assert.equal(bgLayer.locked, true, "background layer is locked by default");
});

test("all layer states (id, type, name, visible, locked, opacity, blendMode, transform, parentId, groupId) parse correctly", () => {
  const rawObj = {
    id: "obj-test",
    name: "Custom Hero",
    kind: "shape",
    type: "hero_shape",
    layerId: "layer-reels",
    x: 50,
    y: 75,
    width: 200,
    height: 150,
    rotation: 45,
    opacity: 0.85,
    visible: true,
    locked: false,
    blur: 2,
    fill: "#3b82f6",
    stroke: "#ffffff",
    strokeWidth: 3,
    radius: 12,
    shape: "rect",
    arrow: false,
    points: [],
    text: null,
    fontSize: 48,
    fontWeight: 700,
    align: "center",
    refId: null,
    assetId: null,
    blendMode: "screen",
    transform: { x: 50, y: 75, width: 200, height: 150, scaleX: 1, scaleY: 1, rotation: 45 },
    parentId: "group-1",
    groupId: "group-1",
    expanded: true,
  };

  const parsed = parseObject(rawObj, 0);
  assert.equal(parsed.id, "obj-test");
  assert.equal(parsed.type, "hero_shape");
  assert.equal(parsed.blendMode, "screen");
  assert.equal(parsed.groupId, "group-1");
  assert.equal(parsed.parentId, "group-1");
  assert.equal(parsed.transform?.rotation, 45);

  const rawLayer = {
    id: "layer-fx",
    name: "FX Overlays",
    kind: "fx",
    type: "fx_layer",
    order: 4,
    visible: true,
    locked: false,
    opacity: 0.9,
    blendMode: "color-dodge",
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1 },
    parentId: null,
    groupId: null,
    expanded: true,
  };

  const parsedLayer = parseLayer(rawLayer, 0);
  assert.equal(parsedLayer.id, "layer-fx");
  assert.equal(parsedLayer.type, "fx_layer");
  assert.equal(parsedLayer.blendMode, "color-dodge");

  const fullDoc = parseSceneDoc({
    objects: [rawObj],
    background: { color: "#101010", assetId: null },
    layers: [rawLayer],
  });
  assert.equal(fullDoc.ok, true);
  if (fullDoc.ok) {
    assert.equal(fullDoc.value.objects.length, 1);
    assert.equal(fullDoc.value.layers?.length, 1);
    assert.ok(BLEND_MODES.includes(fullDoc.value.objects[0].blendMode!));
  }
});

test("F06 acceptance: layer hierarchy, groups, ordering, and all 10 layer states persist to GameBlueprint across refresh", async () => {
  const { createProject, deleteProject, getProject } = await import("../src/server/workspace-service");
  const { saveScene } = await import("../src/server/canvas-service");

  const created = await createProject({
    title: "F06 Layers Persistence Test",
    theme: "Jungle Temple",
  });

  try {
    // 1. Background layer defaults to locked: true
    const bgLayer = created.blueprint.layers.find((l) => l.id === "layer-bg" || l.kind === "background")!;
    assert.equal(bgLayer.locked, true);

    const sceneId = created.blueprint.scenes[0].id;
    const layerId = created.blueprint.layers.find((l) => !l.locked)!.id;

    // 2. Create three objects on the unlocked layer
    const itemA = obj({ id: "item-a", name: "Idol A", layerId, x: 100, y: 100, width: 120, height: 120, blendMode: "screen" });
    const itemB = obj({ id: "item-b", name: "Idol B", layerId, x: 250, y: 100, width: 120, height: 120, blendMode: "multiply" });
    const itemC = obj({ id: "item-c", name: "Banner C", layerId, x: 400, y: 100, width: 200, height: 80 });
    let objects: SceneObject[] = [itemA, itemB, itemC];

    // 3. Create Group from itemA and itemB, rename group, move group, duplicate group, and delete duplicate
    const grouped = createGroup(objects, ["item-a", "item-b"], layerId);
    objects = grouped.objects;
    objects = renameGroup(objects, grouped.groupId, "Idol Pair");
    objects = moveObjects(objects, [grouped.groupId], { x: 20, y: 30 });

    const dupGroup = duplicateGroup(objects, grouped.groupId);
    assert.ok(dupGroup.newGroupId);
    objects = deleteGroup(dupGroup.objects, dupGroup.newGroupId);

    // 4. Reorder itemC towards background (down)
    objects = reorderLayerItem(objects, "item-c", "down");

    // 5. Save scene to GameBlueprint and reload
    await saveScene(created.id, {
      baseRevision: created.revision,
      sceneId,
      objects,
      background: { color: "#0b131e", assetId: null },
      layers: created.blueprint.layers,
    });

    const reloaded = await getProject(created.id);
    assert.ok(reloaded);
    const savedObjects = reloaded.blueprint.scenes.find((s) => s.id === sceneId)!.objects!;
    const savedGroup = savedObjects.find((o) => o.id === grouped.groupId)!;
    assert.equal(savedGroup.name, "Idol Pair");
    assert.equal(savedGroup.kind, "group");
    assert.equal(savedGroup.type, "group");

    const savedChildA = savedObjects.find((o) => o.id === "item-a")!;
    // Verify all 10 required layer state fields are stored on reloaded GameBlueprint
    assert.equal(savedChildA.id, "item-a");
    assert.equal(savedChildA.type, "shape");
    assert.equal(savedChildA.name, "Idol A");
    assert.equal(savedChildA.visible, true);
    assert.equal(savedChildA.locked, false);
    assert.equal(savedChildA.opacity, 1);
    assert.equal(savedChildA.blendMode, "screen");
    assert.equal(savedChildA.transform?.x, 120);
    assert.equal(savedChildA.transform?.y, 130);
    assert.equal(savedChildA.parentId, grouped.groupId);
    assert.equal(savedChildA.groupId, grouped.groupId);

    // 6. Ungroup and verify persistence
    const ungrouped = ungroup(savedObjects, [grouped.groupId]);
    await saveScene(created.id, {
      baseRevision: reloaded.revision,
      sceneId,
      objects: ungrouped.objects,
      background: { color: "#0b131e", assetId: null },
      layers: reloaded.blueprint.layers,
    });
    const afterUngroup = await getProject(created.id);
    const finalObjects = afterUngroup!.blueprint.scenes.find((s) => s.id === sceneId)!.objects!;
    assert.equal(finalObjects.some((o) => o.id === grouped.groupId), false);
    assert.equal(finalObjects.find((o) => o.id === "item-a")?.groupId, null);
  } finally {
    await deleteProject(created.id);
  }
});
