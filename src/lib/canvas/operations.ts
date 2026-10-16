import type { LayerDef, SceneObject } from "@/lib/blueprint/types";
import {
  aabbOf, resizeTransform, rotateAround, scaleTransforms, unionBox,
  type Box, type Transform, type Vec,
} from "./geometry";
import { newSceneObject } from "./create";

/**
 * Pure scene-layout and layer-hierarchy operations: (objects, args) -> objects.
 * They are the unit of undo/redo and never touch React or the network.
 */

export const MAX_OBJECTS = 300;
const MAX_POINTS = 600;

export function normalizeObjects(objects: SceneObject[], layerIds: string[]): SceneObject[] {
  const layers = new Set(layerIds);
  const seen = new Set<string>();
  const out: SceneObject[] = [];
  for (const object of objects) {
    if (out.length >= MAX_OBJECTS) break;
    if (seen.has(object.id)) continue;
    seen.add(object.id);
    out.push({
      ...object,
      layerId: layers.has(object.layerId) ? object.layerId : layerIds[0],
      points: object.points.slice(0, MAX_POINTS),
    });
  }
  return out;
}

export const byId = (objects: SceneObject[], id: string) => objects.find((o) => o.id === id) ?? null;

/** Returns all IDs of selected objects and any children of selected groups. */
export function expandGroupIds(objects: SceneObject[], ids: string[]): string[] {
  const result = new Set<string>(ids);
  for (const id of ids) {
    const o = byId(objects, id);
    if (o && o.kind === "group") {
      objects.filter((c) => c.groupId === o.id || c.parentId === o.id).forEach((c) => result.add(c.id));
    }
  }
  return Array.from(result);
}

function syncTransform(o: SceneObject): SceneObject {
  return {
    ...o,
    transform: {
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height,
      scaleX: o.transform?.scaleX ?? 1,
      scaleY: o.transform?.scaleY ?? 1,
      rotation: o.rotation,
    },
  };
}

export function moveObjects(objects: SceneObject[], ids: string[], delta: Vec): SceneObject[] {
  const allIds = new Set(expandGroupIds(objects, ids));
  return objects.map((o) =>
    allIds.has(o.id) ? syncTransform({ ...o, x: o.x + delta.x, y: o.y + delta.y }) : o,
  );
}

/** Applies already-computed transforms (from resize/rotate interactions). */
export function applyTransforms(objects: SceneObject[], ids: string[], transforms: Transform[]): SceneObject[] {
  const map = new Map<string, Transform>();
  transforms.forEach((t, index) => map.set(ids[index], t));
  return objects.map((o) => {
    const t = map.get(o.id);
    return t ? syncTransform({ ...o, x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation }) : o;
  });
}

export const transformOfObject = (o: SceneObject): Transform => ({ x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation });

export const transformsOf = (objects: SceneObject[], ids: string[]): Transform[] =>
  ids.map((id) => {
    const o = byId(objects, id);
    return { x: o?.x ?? 0, y: o?.y ?? 0, width: o?.width ?? 0, height: o?.height ?? 0, rotation: o?.rotation ?? 0 };
  });

export function rotateObjects(objects: SceneObject[], ids: string[], pivot: Vec, delta: number): SceneObject[] {
  const allIds = expandGroupIds(objects, ids);
  const map = new Map<string, Transform>();
  rotateAround(transformsOf(objects, allIds), pivot, delta).forEach((t, i) => map.set(allIds[i], t));
  return objects.map((o) => {
    const t = map.get(o.id);
    return t ? syncTransform({ ...o, x: t.x, y: t.y, width: t.width, height: t.height, rotation: t.rotation }) : o;
  });
}

export function scaleObjects(objects: SceneObject[], ids: string[], origin: Vec, sx: number, sy: number): SceneObject[] {
  const allIds = expandGroupIds(objects, ids);
  const map = new Map<string, Transform>();
  scaleTransforms(transformsOf(objects, allIds), origin, sx, sy).forEach((t, i) => map.set(allIds[i], t));
  return objects.map((o) => {
    const t = map.get(o.id);
    return t ? syncTransform({ ...o, x: t.x, y: t.y, width: t.width, height: t.height }) : o;
  });
}

export function appendObject(objects: SceneObject[], object: SceneObject): { objects: SceneObject[]; id: string } {
  if (objects.length >= MAX_OBJECTS) return { objects, id: "" };
  return { objects: [...objects, object], id: object.id };
}

/** "Name copy", "Name copy 2", … */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const root = base.replace(/\s+copy(\s+\d+)?$/i, "");
  let candidate = `${root} copy`;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${root} copy ${n}`;
    n += 1;
  }
  return candidate.slice(0, 80);
}

export function duplicateObjects(objects: SceneObject[], ids: string[], offset = 24): { objects: SceneObject[]; ids: string[] } {
  const taken = new Set(objects.map((o) => o.id));
  const baseNames = new Set(objects.map((o) => o.name));
  const picked = objects.filter((o) => ids.includes(o.id));
  if (picked.length === 0) return { objects, ids: [] };

  const idMap = new Map<string, string>();
  let suffix = 2;

  // First pass: generate new IDs for every selected object and group
  for (const object of picked) {
    let id = `${object.id}-copy`;
    while (taken.has(id)) id = `${object.id}-copy-${suffix++}`;
    taken.add(id);
    idMap.set(object.id, id);
  }

  // Also include children of duplicated groups even if children weren't directly selected
  const groupChildren: SceneObject[] = [];
  for (const object of picked) {
    if (object.kind === "group") {
      const children = objects.filter((c) => (c.groupId === object.id || c.parentId === object.id) && !picked.some((p) => p.id === c.id));
      for (const child of children) {
        let childId = `${child.id}-copy`;
        while (taken.has(childId)) childId = `${child.id}-copy-${suffix++}`;
        taken.add(childId);
        idMap.set(child.id, childId);
        groupChildren.push(child);
      }
    }
  }

  const allToDuplicate = [...picked, ...groupChildren];
  const clones: SceneObject[] = [];

  for (const object of allToDuplicate) {
    const id = idMap.get(object.id)!;
    const name = uniqueName(object.name, baseNames);
    baseNames.add(name);
    const newGroupId = object.groupId && idMap.has(object.groupId) ? idMap.get(object.groupId) : object.groupId;
    const newParentId = object.parentId && idMap.has(object.parentId) ? idMap.get(object.parentId) : object.parentId;

    clones.push({
      ...object,
      id,
      name,
      x: object.x + offset,
      y: object.y + offset,
      groupId: newGroupId ?? null,
      parentId: newParentId ?? null,
      points: object.points.map((p) => ({ ...p })),
    });
  }

  return {
    objects: [...objects, ...clones],
    ids: picked.map((p) => idMap.get(p.id)!),
  };
}

export function deleteObjects(objects: SceneObject[], ids: string[]): SceneObject[] {
  const allIds = new Set(expandGroupIds(objects, ids));
  return objects.filter((o) => !allIds.has(o.id));
}

/* ------------------------- Grouping Operations ------------------------- */

export function createGroup(
  objects: SceneObject[],
  selectedIds: string[],
  defaultLayerId?: string,
): { objects: SceneObject[]; groupId: string } {
  const targets = objects.filter((o) => selectedIds.includes(o.id));
  if (targets.length === 0) return { objects, groupId: "" };

  const targetLayerId = targets[targets.length - 1]?.layerId || defaultLayerId || objects[0]?.layerId || "layer-bg";
  const taken = new Set(objects.map((o) => o.id));
  const baseNames = new Set(objects.map((o) => o.name));

  let groupId = `group-${Date.now().toString(36)}`;
  let suffix = 1;
  while (taken.has(groupId)) groupId = `group-${Date.now().toString(36)}-${suffix++}`;

  const groupName = uniqueName("Group 1", baseNames);
  const box = unionBox(targets.map((o) => aabbOf(o)));

  const groupObject: SceneObject = newSceneObject({
    id: groupId,
    name: groupName,
    kind: "group",
    type: "group",
    layerId: targetLayerId,
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.max(1, Math.round(box.w)),
    height: Math.max(1, Math.round(box.h)),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    expanded: true,
    parentId: null,
    groupId: null,
  });

  const targetIdSet = new Set(targets.map((t) => t.id));
  const updatedObjects = objects.map((o) =>
    targetIdSet.has(o.id)
      ? { ...o, groupId: groupId, parentId: groupId, layerId: targetLayerId }
      : o
  );

  // Place the group container right at the position of the first grouped item
  const firstIndex = objects.findIndex((o) => targetIdSet.has(o.id));
  const insertIndex = firstIndex >= 0 ? firstIndex : updatedObjects.length;
  const result = [...updatedObjects];
  result.splice(insertIndex, 0, groupObject);

  return { objects: result, groupId };
}

export function ungroup(
  objects: SceneObject[],
  groupIds: string[],
): { objects: SceneObject[]; releasedIds: string[] } {
  const groupsToRelease = new Set(groupIds);
  for (const id of groupIds) {
    const o = byId(objects, id);
    if (o && o.groupId) groupsToRelease.add(o.groupId);
    if (o && o.parentId) groupsToRelease.add(o.parentId);
  }
  const releasedIds: string[] = [];

  const updated = objects
    .filter((o) => !groupsToRelease.has(o.id))
    .map((o) => {
      if (o.groupId && groupsToRelease.has(o.groupId)) {
        releasedIds.push(o.id);
        return { ...o, groupId: null, parentId: null };
      }
      if (o.parentId && groupsToRelease.has(o.parentId)) {
        releasedIds.push(o.id);
        return { ...o, parentId: null, groupId: o.groupId && groupsToRelease.has(o.groupId) ? null : o.groupId };
      }
      return o;
    });

  return { objects: updated, releasedIds };
}

export function renameGroup(objects: SceneObject[], groupId: string, name: string): SceneObject[] {
  const clean = name.trim();
  if (!clean) return objects;
  return objects.map((o) => (o.id === groupId ? { ...o, name: clean } : o));
}

export function toggleGroupExpand(objects: SceneObject[], groupId: string, force?: boolean): SceneObject[] {
  return objects.map((o) => {
    if (o.id === groupId) {
      return { ...o, expanded: force !== undefined ? force : !o.expanded };
    }
    return o;
  });
}

export function duplicateGroup(
  objects: SceneObject[],
  groupId: string,
): { objects: SceneObject[]; newGroupId: string } {
  const res = duplicateObjects(objects, [groupId]);
  return { objects: res.objects, newGroupId: res.ids[0] ?? "" };
}

export function deleteGroup(objects: SceneObject[], groupId: string): SceneObject[] {
  return deleteObjects(objects, [groupId]);
}

/* ------------------------- Layer & Node Hierarchy Reordering ------------------------- */

export type LayerDirection = "up" | "down" | "top" | "bottom";

/**
 * Reorders an item in the layer list.
 * Note: in the UI layer panel, Top = Foreground (rendered on top).
 * Moving "up" in the panel means increasing rendering index (towards foreground).
 * Moving "down" in the panel means decreasing rendering index (towards background).
 */
export function reorderLayerItem(
  objects: SceneObject[],
  id: string,
  direction: LayerDirection,
): SceneObject[] {
  const target = byId(objects, id);
  if (!target) return objects;

  const isRoot = !target.groupId && !target.parentId;
  const contextItems = isRoot
    ? objects.filter((o) => o.layerId === target.layerId && !o.groupId && !o.parentId)
    : objects.filter((o) => o.layerId === target.layerId && o.groupId === target.groupId);

  const contextIndex = contextItems.findIndex((o) => o.id === id);
  if (contextIndex < 0) return objects;

  let newContextIndex = contextIndex;
  if (direction === "up") newContextIndex = contextIndex + 1;
  else if (direction === "down") newContextIndex = contextIndex - 1;
  else if (direction === "top") newContextIndex = contextItems.length - 1;
  else if (direction === "bottom") newContextIndex = 0;

  if (newContextIndex < 0 || newContextIndex >= contextItems.length || newContextIndex === contextIndex) return objects;

  const otherItem = contextItems[newContextIndex];
  const itemsToMove = [target, ...objects.filter((o) => (o.groupId === id || o.parentId === id) && o.id !== id)];
  const moveIds = new Set(itemsToMove.map((o) => o.id));

  const remaining = objects.filter((o) => !moveIds.has(o.id));
  const otherIndex = remaining.findIndex((o) => o.id === otherItem.id);
  if (otherIndex < 0) return objects;

  const otherChildren = remaining.filter((o) => (o.groupId === otherItem.id || o.parentId === otherItem.id) && o.id !== otherItem.id);
  const insertIndex = direction === "up" || direction === "top"
    ? otherIndex + 1 + otherChildren.length
    : otherIndex;

  const result = [...remaining];
  result.splice(insertIndex, 0, ...itemsToMove);
  return result;
}

export function moveLayerItemToIndex(
  objects: SceneObject[],
  draggedId: string,
  targetId: string,
  position: "before" | "after",
): SceneObject[] {
  if (draggedId === targetId) return objects;
  const fromIndex = objects.findIndex((o) => o.id === draggedId);
  const toIndex = objects.findIndex((o) => o.id === targetId);
  if (fromIndex < 0 || toIndex < 0) return objects;

  const dragged = objects[fromIndex];
  const target = objects[toIndex];

  // If dropping near another object, adopt its layerId and groupId unless target is the dragged group
  const newLayerId = target.layerId;
  const newGroupId = target.kind === "group" && position === "after" ? target.id : target.groupId;

  const updatedDragged = {
    ...dragged,
    layerId: newLayerId,
    groupId: newGroupId ?? null,
    parentId: newGroupId ?? null,
  };

  const result = [...objects];
  result.splice(fromIndex, 1);
  const adjustedToIndex = result.findIndex((o) => o.id === targetId);
  const insertPos = position === "before" ? adjustedToIndex : adjustedToIndex + 1;
  result.splice(insertPos, 0, updatedDragged);

  return result;
}

export function reorderBlueprintLayers(
  layers: LayerDef[],
  sourceId: string,
  targetId: string,
  position: "before" | "after",
): LayerDef[] {
  if (sourceId === targetId) return layers;
  const from = layers.findIndex((l) => l.id === sourceId);
  const to = layers.findIndex((l) => l.id === targetId);
  if (from < 0 || to < 0) return layers;

  const result = [...layers];
  const [removed] = result.splice(from, 1);
  const adjustedTo = result.findIndex((l) => l.id === targetId);
  const insertPos = position === "before" ? adjustedTo : adjustedTo + 1;
  result.splice(insertPos, 0, removed);

  return result.map((layer, index) => ({ ...layer, order: index }));
}

/* ------------------------- drag-preview (from snapshot) ------------------------- */

export function previewMove(starts: SceneObject[], dx: number, dy: number): Transform[] {
  return starts.map((o) => ({ x: o.x + dx, y: o.y + dy, width: o.width, height: o.height, rotation: o.rotation }));
}

export function previewResize(
  starts: SceneObject[],
  group: Transform,
  handle: Parameters<typeof resizeTransform>[1],
  pointer: Vec,
  options: { keepAspect?: boolean; min?: number } = {},
): { transforms: Transform[]; box: Transform } {
  const next = resizeTransform(group, handle, pointer, options);
  if (starts.length === 1) return { transforms: [next], box: next };
  const sx = group.width ? next.width / group.width : 1;
  const sy = group.height ? next.height / group.height : 1;
  return {
    transforms: scaleTransforms(starts.map(transformOfObject), { x: group.x, y: group.y }, sx, sy).map((t) => ({
      ...t,
      x: t.x + (next.x - group.x),
      y: t.y + (next.y - group.y),
    })),
    box: next,
  };
}

export function previewRotate(starts: SceneObject[], pivot: Vec, delta: number): Transform[] {
  return rotateAround(starts.map(transformOfObject), pivot, delta);
}

export type Order = "front" | "back" | "forward" | "backward";

/** Reorders within the object's layer, since layers stack by blueprint order. */
export function reorderObjects(objects: SceneObject[], id: string, order: Order): SceneObject[] {
  const object = byId(objects, id);
  if (!object) return objects;
  const sameLayer = objects.filter((o) => o.layerId === object.layerId && o.groupId === object.groupId);
  const index = sameLayer.findIndex((o) => o.id === id);
  const target = order === "front" ? sameLayer.length - 1 : order === "back" ? 0 : order === "forward" ? index + 1 : index - 1;
  if (target < 0 || target >= sameLayer.length || target === index) return objects;
  const idsInOrder = sameLayer.map((o) => o.id);
  idsInOrder.splice(index, 1);
  idsInOrder.splice(target, 0, id);
  const rank = new Map(idsInOrder.map((value, i) => [value, i]));
  return [...objects].sort((a, b) => {
    if (a.layerId !== b.layerId || a.groupId !== b.groupId) return 0;
    return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
  });
}

export function patchObject(objects: SceneObject[], id: string, patch: Partial<SceneObject>): SceneObject[] {
  const target = byId(objects, id);
  // If patching visibility or locked on a group, propagate to children as well
  if (target && target.kind === "group" && (patch.visible !== undefined || patch.locked !== undefined)) {
    return objects.map((o) => {
      if (o.id === id || o.groupId === id || o.parentId === id) {
        return syncTransform({ ...o, ...patch });
      }
      return o;
    });
  }
  return objects.map((o) => (o.id === id ? syncTransform({ ...o, ...patch }) : o));
}

export function patchObjects(objects: SceneObject[], ids: string[], patch: Partial<SceneObject>): SceneObject[] {
  const set = new Set(expandGroupIds(objects, ids));
  return objects.map((o) => (set.has(o.id) ? syncTransform({ ...o, ...patch }) : o));
}

/** Nudges by 1 px, or 10 px with shift — the documented keyboard behaviour. */
export const nudgeDelta = (key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", coarse: boolean): Vec => ({
  x: key === "ArrowLeft" ? -(coarse ? 10 : 1) : key === "ArrowRight" ? (coarse ? 10 : 1) : 0,
  y: key === "ArrowUp" ? -(coarse ? 10 : 1) : key === "ArrowDown" ? (coarse ? 10 : 1) : 0,
});

export const objectsAabb = (objects: SceneObject[]): Box => unionBox(objects.map((o) => aabbOf(o)));

export function toggleLayer(layers: LayerDef[], id: string, patch: Partial<LayerDef>): LayerDef[] {
  return layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
}

export const layerById = (layers: LayerDef[], id: string) => layers.find((l) => l.id === id) ?? null;

/** Rendering order: blueprint layer order first, then array order inside the layer. */
export function orderForRendering(objects: SceneObject[], layers: LayerDef[]): SceneObject[] {
  const rank = new Map(layers.map((l, index) => [l.id, index]));
  return [...objects].sort((a, b) => (rank.get(a.layerId) ?? 0) - (rank.get(b.layerId) ?? 0));
}

/** Objects that can be hit by a click: visible, on a visible layer, and not locked. */
export function hitTestObjects(objects: SceneObject[], layers: LayerDef[], point: Vec, tolerable = 0): string[] {
  const layerById = new Map(layers.map((l) => [l.id, l]));
  const scored: { id: string; area: number; index: number }[] = [];
  objects.forEach((object, index) => {
    const layer = layerById.get(object.layerId);
    if (!object.visible || !layer?.visible) return;
    if (object.kind === "group") return; // groups select by their children
    if (!hitObject(object, point, tolerable)) return;
    scored.push({ id: object.id, area: object.width * object.height, index });
  });
  if (scored.length === 0) return [];
  const smallest = scored.reduce((best, current) => (current.area < best.area ? current : best));
  return [smallest.id];
}

function hitObject(object: SceneObject, point: Vec, tolerance: number): boolean {
  const box = { x: object.x, y: object.y, w: object.width, h: object.height };
  if (tolerance === 0) return pointInObject(object, point);
  const grown = { ...box, x: box.x - tolerance, y: box.y - tolerance, w: box.w + tolerance * 2, h: box.h + tolerance * 2 };
  const corners = [
    { x: grown.x, y: grown.y }, { x: grown.x + grown.w, y: grown.y },
    { x: grown.x + grown.w, y: grown.y + grown.h }, { x: grown.x, y: grown.y + grown.h },
  ];
  // cheap conservative test: point inside the rotated AABB of the grown box
  const xs = corners.map((c) => c.x), ys = corners.map((c) => c.y);
  return point.x >= Math.min(...xs) && point.x <= Math.max(...xs) && point.y >= Math.min(...ys) && point.y <= Math.max(...ys);
}

function pointInObject(object: SceneObject, point: Vec): boolean {
  const c = { x: object.x + object.width / 2, y: object.y + object.height / 2 };
  const a = (-object.rotation * Math.PI) / 180;
  const dx = point.x - c.x;
  const dy = point.y - c.y;
  const local = { x: c.x + dx * Math.cos(a) - dy * Math.sin(a), y: c.y + dx * Math.sin(a) + dy * Math.cos(a) };
  return local.x >= object.x && local.x <= object.x + object.width && local.y >= object.y && local.y <= object.y + object.height;
}

/** Every object whose AABB intersects the marquee, top-most layers first. */
export function objectsInMarquee(objects: SceneObject[], layers: LayerDef[], marquee: { x: number; y: number; w: number; h: number }): string[] {
  const layerById = new Map(layers.map((l) => [l.id, l]));
  return objects
    .filter((o) => {
      const layer = layerById.get(o.layerId);
      return o.visible && layer?.visible && !o.locked && o.kind !== "group";
    })
    .filter((o) => {
      const box = aabbOf(o);
      return box.x < marquee.x + marquee.w && box.x + box.w > marquee.x && box.y < marquee.y + marquee.h && box.y + box.h > marquee.y;
    })
    .map((o) => o.id);
}

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Aligns the selection to the scene frame, or to itself when several are selected. */
export function alignObjects(objects: SceneObject[], ids: string[], mode: AlignMode, frame: Box): SceneObject[] {
  const allIds = expandGroupIds(objects, ids);
  const picked = objects.filter((o) => allIds.includes(o.id));
  if (picked.length === 0) return objects;
  const span = picked.length > 1 ? objectsAabb(picked) : frame;
  const target = (o: SceneObject): number => {
    switch (mode) {
      case "left": return span.x;
      case "center": return span.x + span.w / 2 - o.width / 2;
      case "right": return span.x + span.w - o.width;
      case "top": return span.y;
      case "middle": return span.y + span.h / 2 - o.height / 2;
      default: return span.y + span.h - o.height;
    }
  };
  const next = new Map(picked.map((o) => [o.id, target(o)]));
  return objects.map((o) => {
    const value = next.get(o.id);
    if (value === undefined) return o;
    return mode === "left" || mode === "center" || mode === "right" ? { ...o, x: value } : { ...o, y: value };
  });
}

/** Distributes the selection evenly along one axis. Needs three or more objects. */
export function distributeObjects(objects: SceneObject[], ids: string[], axis: "x" | "y"): SceneObject[] {
  const picked = objects.filter((o) => ids.includes(o.id) && o.kind !== "group");
  if (picked.length < 3) return objects;
  const sorted = [...picked].sort((a, b) => (axis === "x" ? a.x - b.x : a.y - b.y));
  const first = sorted[0], last = sorted[sorted.length - 1];
  const spanStart = axis === "x" ? first.x : first.y;
  const spanEnd = axis === "x" ? last.x : last.y;
  const step = (spanEnd - spanStart) / (sorted.length - 1);
  const target = new Map<string, number>();
  sorted.forEach((o, index) => target.set(o.id, spanStart + step * index));
  return objects.map((o) => {
    const value = target.get(o.id);
    if (value === undefined) return o;
    return axis === "x" ? { ...o, x: value } : { ...o, y: value };
  });
}

export const selectable = (objects: SceneObject[], id: string) => {
  const object = byId(objects, id);
  return Boolean(object && object.visible && !object.locked);
};
