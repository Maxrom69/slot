import type { LayerDef, SceneBackground, SceneObject, ShapeKind, StylePalette } from "@/lib/blueprint/types";
import { clean } from "./geometry";
import type { SceneDoc } from "./types";

export const OBJECT_DEFAULTS = {
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  blur: 0,
  strokeWidth: 0,
  radius: 0,
  arrow: false,
  fontSize: 48,
  fontWeight: 700,
  align: "center" as const,
};

/** Fills every field so stored objects are always complete. */
export function newSceneObject(partial: Partial<SceneObject> & Pick<SceneObject, "id" | "name" | "kind" | "layerId" | "x" | "y" | "width" | "height">): SceneObject {
  const rotation = partial.rotation ?? OBJECT_DEFAULTS.rotation;
  return {
    ...OBJECT_DEFAULTS,
    type: partial.type ?? partial.kind,
    fill: null,
    stroke: null,
    shape: null,
    points: [],
    text: null,
    refId: null,
    assetId: null,
    blendMode: partial.blendMode ?? "normal",
    parentId: partial.parentId ?? null,
    groupId: partial.groupId ?? null,
    expanded: partial.expanded ?? true,
    transform: partial.transform ?? {
      x: partial.x,
      y: partial.y,
      width: partial.width,
      height: partial.height,
      scaleX: 1,
      scaleY: 1,
      rotation,
    },
    ...partial,
  };
}

export interface CreateBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function createTextObject(layerId: string, at: Vec2, palette: StylePalette, sequence: number): SceneObject {
  return newSceneObject({
    id: `obj-text-${sequence}`,
    name: `Text ${sequence}`,
    kind: "text",
    layerId,
    x: Math.round(at.x),
    y: Math.round(at.y),
    width: 420,
    height: 110,
    text: "Text",
    fill: palette.text,
    fontSize: 56,
  });
}

type Vec2 = { x: number; y: number };

export function createShapeObject(layerId: string, shape: ShapeKind, box: CreateBox, palette: StylePalette, sequence: number): SceneObject {
  return newSceneObject({
    id: `obj-${shape}-${sequence}`,
    name: `${shape[0].toUpperCase()}${shape.slice(1)} ${sequence}`,
    kind: "shape",
    layerId,
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
    shape,
    fill: palette.accent,
    stroke: palette.glow,
    strokeWidth: shape === "rect" ? 0 : 2,
    radius: shape === "rect" ? 8 : 0,
  });
}

export function createStrokeObject(layerId: string, kind: "line" | "arrow", from: Vec2, to: Vec2, palette: StylePalette, sequence: number): SceneObject {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const width = Math.max(2, Math.abs(to.x - from.x));
  const height = Math.max(2, Math.abs(to.y - from.y));
  return newSceneObject({
    id: `obj-${kind}-${sequence}`,
    name: `${kind === "arrow" ? "Arrow" : "Line"} ${sequence}`,
    kind: "stroke",
    layerId,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    stroke: palette.glow,
    strokeWidth: 3,
    arrow: kind === "arrow",
    // start/end are kept so a line drawn right-to-left does not flip
    points: [
      { x: clean((from.x - x) / width), y: clean((from.y - y) / height) },
      { x: clean((to.x - x) / width), y: clean((to.y - y) / height) },
    ],
  });
}

/** Freehand paths are stored normalised to the object box, so resize and rotate stay cheap. */
export function createFreehandObject(layerId: string, points: Vec2[], palette: StylePalette, sequence: number): SceneObject | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const width = Math.max(2, Math.max(...xs) - x);
  const height = Math.max(2, Math.max(...ys) - y);
  return newSceneObject({
    id: `obj-draw-${sequence}`,
    name: `Path ${sequence}`,
    kind: "stroke",
    layerId,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    stroke: palette.accentAlt,
    strokeWidth: 3,
    points: points.map((p) => ({ x: clean((p.x - x) / width), y: clean((p.y - y) / height) })),
  });
}

/** Places an existing symbol or element on the scene as an instance. */
export function createRefObject(input: {
  sequence: number;
  layerId: string;
  refKind: "symbol" | "element";
  refId: string;
  name: string;
  at: Vec2;
  size: { width: number; height: number };
  assetId: string | null;
}): SceneObject {
  return newSceneObject({
    id: `obj-${input.refKind}-${input.sequence}`,
    name: input.name,
    kind: input.refKind,
    layerId: input.layerId,
    x: Math.round(input.at.x - input.size.width / 2),
    y: Math.round(input.at.y - input.size.height / 2),
    width: Math.round(input.size.width),
    height: Math.round(input.size.height),
    refId: input.refId,
    assetId: input.assetId,
  });
}

export const PAINTABLE = new Set(["shape", "text"]);

export function sceneBackground(palette: StylePalette): SceneBackground {
  return { color: palette.background, assetId: null };
}

/** Guarantees every scene has layout data, so the canvas can always render. */
export function prepareScenes(bp: {
  scenes: Array<{ id: string; objects?: SceneObject[]; background?: SceneBackground }>;
  layers: LayerDef[];
  style: { palette: StylePalette };
}): Array<{ id: string; objects: SceneObject[]; background: SceneBackground }> {
  const layerId = bp.layers[0]?.id ?? "layer-bg";
  return bp.scenes.map((scene) => ({
    id: scene.id,
    objects: Array.isArray(scene.objects) ? scene.objects : [],
    background: scene.background ?? sceneBackground(bp.style.palette),
  }));
}

/** Scene content the canvas editor owns. */
export function sceneDoc(bp: Parameters<typeof prepareScenes>[0], sceneId: string): SceneDoc {
  const scenes = prepareScenes(bp);
  const found = scenes.find((s) => s.id === sceneId) ?? scenes[0];
  return { objects: found.objects, background: found.background };
}

export const layerIdFor = (layers: LayerDef[], preferred?: string | null) =>
  (preferred && layers.some((l) => l.id === preferred && !l.locked) ? preferred : null) ??
  layers.find((l) => !l.locked)?.id ??
  layers[0]?.id ??
  "layer-bg";
