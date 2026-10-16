import type {
  BlendMode,
  LayerDef,
  LayerTransform,
  SceneBackground,
  SceneCanvasConfiguration,
  SceneComposedImageRef,
  SceneDef,
  SceneLayoutMetadata,
  SceneObject,
  SceneVisibilityState,
  ShapeKind,
} from "@/lib/blueprint/types";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

export const BLEND_MODES: readonly BlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
] as const;

const KINDS = ["symbol", "element", "image", "text", "shape", "stroke", "group", "animation"] as const;
const SHAPES = ["rect", "ellipse", "triangle"] as const;
const ALIGNS = ["left", "center", "right"] as const;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,\s]+\)|[a-zA-Z]{3,24})$/;

const MAX_OBJECTS = 300;
const MAX_POINTS = 600;
const MAX_SCENE = 20000;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be a list.`);
  if ((value as unknown[]).length > max) fail(`${label} has too many entries (max ${max}).`);
  return value as unknown[];
}
function text(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== "string" || value.length > max || value.trim().length < min) fail(`${label} must be ${min ? `${min}–` : "up to "}${max} characters.`);
  return value as string;
}
function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} is not a valid id.`);
  return value as string;
}
function nullable(value: unknown, label: string, parse: (v: unknown) => string): string | null {
  return value === null || value === undefined ? null : parse(value);
}
function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) fail(`${label} is not supported.`);
  return value as T;
}
function num(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    fail(`${label} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`);
  return value as number;
}
function color(value: unknown, label: string): string | null {
  if (value === null) return null;
  const raw = text(value, label, 40);
  if (!COLOR.test(raw)) fail(`${label} is not a supported colour.`);
  return raw;
}

function parseLayerTransform(raw: unknown, label: string): LayerTransform | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  return {
    x: num(r.x ?? 0, `${label} transform.x`, -MAX_SCENE, MAX_SCENE),
    y: num(r.y ?? 0, `${label} transform.y`, -MAX_SCENE, MAX_SCENE),
    width: r.width !== undefined ? num(r.width, `${label} transform.width`, 0, MAX_SCENE) : undefined,
    height: r.height !== undefined ? num(r.height, `${label} transform.height`, 0, MAX_SCENE) : undefined,
    scaleX: r.scaleX !== undefined ? num(r.scaleX, `${label} transform.scaleX`, -100, 100) : undefined,
    scaleY: r.scaleY !== undefined ? num(r.scaleY, `${label} transform.scaleY`, -100, 100) : undefined,
    rotation: r.rotation !== undefined ? num(r.rotation, `${label} transform.rotation`, -3600, 3600) : undefined,
  };
}

export function parseObject(raw: unknown, index: number): SceneObject {
  const r = record(raw, `Object ${index + 1}`);
  const n = `${index + 1}`;
  const points = list(r.points ?? [], `Object ${n} points`, MAX_POINTS).map((p, k) => {
    const pr = record(p, `Object ${n} point ${k + 1}`);
    return { x: num(pr.x, `Object ${n} point ${k + 1} x`, -2, 3), y: num(pr.y, `Object ${n} point ${k + 1} y`, -2, 3) };
  });
  const kind = choice(r.kind, KINDS, `Object ${n} type`);
  const x = num(r.x, `Object ${n} x`, -MAX_SCENE, MAX_SCENE);
  const y = num(r.y, `Object ${n} y`, -MAX_SCENE, MAX_SCENE);
  const width = num(r.width, `Object ${n} width`, 1, MAX_SCENE);
  const height = num(r.height, `Object ${n} height`, 1, MAX_SCENE);
  const rotation = num(r.rotation, `Object ${n} rotation`, -3600, 3600);
  return {
    id: id(r.id, `Object ${n} id`),
    name: text(r.name, `Object ${n} name`, 80, 1),
    kind,
    type: r.type ? text(r.type, `Object ${n} type`, 60) : kind,
    layerId: id(r.layerId, `Object ${n} layer`),
    x,
    y,
    width,
    height,
    rotation,
    opacity: num(r.opacity, `Object ${n} opacity`, 0, 1),
    visible: typeof r.visible === "boolean" ? r.visible : fail(`Object ${n} visibility must be a boolean.`),
    locked: typeof r.locked === "boolean" ? r.locked : fail(`Object ${n} lock must be a boolean.`),
    blur: num(r.blur, `Object ${n} blur`, 0, 100),
    fill: color(r.fill ?? null, `Object ${n} fill`),
    stroke: color(r.stroke ?? null, `Object ${n} stroke`),
    strokeWidth: num(r.strokeWidth, `Object ${n} stroke width`, 0, 200),
    radius: num(r.radius, `Object ${n} radius`, 0, 500),
    shape: r.shape === null || r.shape === undefined ? null : choice(r.shape, SHAPES, `Object ${n} shape`),
    arrow: typeof r.arrow === "boolean" ? r.arrow : fail(`Object ${n} arrow must be a boolean.`),
    points,
    text: nullable(r.text ?? null, `Object ${n} text`, (v) => text(v, `Object ${n} text`, 400)),
    fontSize: num(r.fontSize, `Object ${n} font size`, 4, 1000),
    fontWeight: num(r.fontWeight, `Object ${n} font weight`, 100, 900, true),
    align: choice(r.align, ALIGNS, `Object ${n} alignment`),
    refId: nullable(r.refId ?? null, `Object ${n} reference`, (v) => id(v, `Object ${n} reference`)),
    ...(r.animationId !== undefined
      ? { animationId: nullable(r.animationId ?? null, `Object ${n} animation`, (v) => id(v, `Object ${n} animation`)) }
      : {}),
    assetId: nullable(r.assetId ?? null, `Object ${n} asset`, (v) => id(v, `Object ${n} asset`)),
    blendMode: r.blendMode ? choice(r.blendMode as string, BLEND_MODES, `Object ${n} blend mode`) : "normal",
    transform: parseLayerTransform(r.transform, `Object ${n}`) ?? {
      x,
      y,
      width,
      height,
      scaleX: 1,
      scaleY: 1,
      rotation,
    },
    parentId: nullable(r.parentId ?? null, `Object ${n} parent`, (v) => id(v, `Object ${n} parent`)),
    groupId: nullable(r.groupId ?? null, `Object ${n} group`, (v) => id(v, `Object ${n} group`)),
    expanded: typeof r.expanded === "boolean" ? r.expanded : true,
  };
}

export function parseBackground(raw: unknown): SceneBackground {
  const r = record(raw, "Scene background");
  const bg: SceneBackground = {
    color: color(r.color ?? null, "Scene background colour"),
    assetId: nullable(r.assetId ?? null, "Scene background asset", (v) =>
      id(v, "Scene background asset"),
    ),
  };
  if (r.imageUri !== undefined) {
    bg.imageUri = nullable(r.imageUri ?? null, "Scene background imageUri", (v) =>
      text(v, "Scene background imageUri", 500),
    );
  }
  if (r.fit !== undefined && r.fit !== null) {
    bg.fit = choice(
      r.fit,
      ["cover", "contain", "stretch"] as const,
      "Scene background fit",
    );
  }
  return bg;
}

export function parseLayer(raw: unknown, index: number): LayerDef {
  const r = record(raw, `Layer ${index + 1}`);
  const n = index + 1;
  return {
    id: id(r.id, `Layer ${n} id`),
    name: text(r.name, `Layer ${n} name`, 60, 1),
    kind: choice(r.kind, ["background", "reels", "frame", "ui", "fx", "overlay", "custom", "group"] as const, `Layer ${n} kind`),
    type: r.type ? text(r.type, `Layer ${n} type`, 60) : undefined,
    order: num(r.order, `Layer ${n} order`, 0, 100, true),
    visible: typeof r.visible === "boolean" ? r.visible : fail(`Layer ${n} visibility must be a boolean.`),
    locked: typeof r.locked === "boolean" ? r.locked : fail(`Layer ${n} lock must be a boolean.`),
    opacity: num(r.opacity, `Layer ${n} opacity`, 0, 1),
    blendMode: r.blendMode ? choice(r.blendMode as string, BLEND_MODES, `Layer ${n} blend mode`) : "normal",
    transform: parseLayerTransform(r.transform, `Layer ${n}`),
    parentId: nullable(r.parentId ?? null, `Layer ${n} parent`, (v) => id(v, `Layer ${n} parent`)),
    groupId: nullable(r.groupId ?? null, `Layer ${n} group`, (v) => id(v, `Layer ${n} group`)),
    expanded: typeof r.expanded === "boolean" ? r.expanded : true,
  };
}

export function parseCanvasConfiguration(raw: unknown): SceneCanvasConfiguration {
  const r = record(raw, "Scene canvas configuration");
  const safe = record(r.safeArea ?? { top: 64, right: 96, bottom: 96, left: 96 }, "Scene safeArea");
  return {
    width: num(r.width ?? 1920, "Scene canvas width", 100, MAX_SCENE, true),
    height: num(r.height ?? 1080, "Scene canvas height", 100, MAX_SCENE, true),
    safeArea: {
      top: num(safe.top ?? 64, "Scene safeArea.top", 0, MAX_SCENE, true),
      right: num(safe.right ?? 96, "Scene safeArea.right", 0, MAX_SCENE, true),
      bottom: num(safe.bottom ?? 96, "Scene safeArea.bottom", 0, MAX_SCENE, true),
      left: num(safe.left ?? 96, "Scene safeArea.left", 0, MAX_SCENE, true),
    },
    orientation: choice(
      r.orientation ?? "landscape",
      ["landscape", "portrait", "responsive"] as const,
      "Scene canvas orientation",
    ),
    ...(r.gridVisible !== undefined ? { gridVisible: Boolean(r.gridVisible) } : {}),
    ...(r.gridSize !== undefined ? { gridSize: num(r.gridSize, "Scene gridSize", 2, 1000, true) } : {}),
    ...(r.snapToGrid !== undefined ? { snapToGrid: Boolean(r.snapToGrid) } : {}),
  };
}

export function parseVisibility(raw: unknown): SceneVisibilityState {
  const r = record(raw, "Scene visibility");
  const layersRec = record(r.layers ?? {}, "Scene visibility.layers");
  const objectsRec = record(r.objects ?? {}, "Scene visibility.objects");
  const layers: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(layersRec)) {
    if (typeof v === "boolean") layers[id(k, "Visibility layer id")] = v;
  }
  const objects: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(objectsRec)) {
    if (typeof v === "boolean") objects[id(k, "Visibility object id")] = v;
  }
  return {
    sceneVisible: typeof r.sceneVisible === "boolean" ? r.sceneVisible : true,
    layers,
    objects,
  };
}

export function parseComposedImage(raw: unknown, index: number): SceneComposedImageRef {
  const r = record(raw, `Composed image ${index + 1}`);
  const n = index + 1;
  return {
    id: id(r.id, `Composed image ${n} id`),
    name: text(r.name, `Composed image ${n} name`, 80, 1),
    assetId: nullable(r.assetId ?? null, `Composed image ${n} assetId`, (v) =>
      id(v, `Composed image ${n} assetId`),
    ),
    uri: nullable(r.uri ?? null, `Composed image ${n} uri`, (v) =>
      text(v, `Composed image ${n} uri`, 500),
    ),
    ...(r.refKind
      ? {
          refKind: choice(
            r.refKind,
            ["symbol", "element", "image", "animation"] as const,
            `Composed image ${n} refKind`,
          ),
        }
      : {}),
    ...(r.refId !== undefined
      ? {
          refId: nullable(r.refId ?? null, `Composed image ${n} refId`, (v) =>
            id(v, `Composed image ${n} refId`),
          ),
        }
      : {}),
    layerId: id(r.layerId, `Composed image ${n} layerId`),
    x: num(r.x, `Composed image ${n} x`, -MAX_SCENE, MAX_SCENE),
    y: num(r.y, `Composed image ${n} y`, -MAX_SCENE, MAX_SCENE),
    width: num(r.width, `Composed image ${n} width`, 1, MAX_SCENE),
    height: num(r.height, `Composed image ${n} height`, 1, MAX_SCENE),
    rotation: num(r.rotation ?? 0, `Composed image ${n} rotation`, -3600, 3600),
    visible: typeof r.visible === "boolean" ? r.visible : true,
    order: num(r.order ?? index, `Composed image ${n} order`, -100000, 100000, true),
  };
}

export function parseLayoutMetadata(raw: unknown): SceneLayoutMetadata {
  const r = record(raw, "Scene layoutMetadata");
  const slotIndex = num(r.slotIndex ?? 1, "Scene slotIndex", 1, 3, true);
  const slotLabel = choice(
    r.slotLabel ?? `Scene ${slotIndex}`,
    ["Scene 1", "Scene 2", "Scene 3"] as const,
    "Scene slotLabel",
  );
  return {
    slotIndex,
    slotLabel,
    ...(r.activeLayerId !== undefined
      ? {
          activeLayerId: nullable(r.activeLayerId ?? null, "Scene activeLayerId", (v) =>
            id(v, "Scene activeLayerId"),
          ),
        }
      : {}),
    ...(r.zoom !== undefined ? { zoom: num(r.zoom, "Scene zoom", 0.05, 10) } : {}),
    ...(r.panX !== undefined ? { panX: num(r.panX, "Scene panX", -MAX_SCENE, MAX_SCENE) } : {}),
    ...(r.panY !== undefined ? { panY: num(r.panY, "Scene panY", -MAX_SCENE, MAX_SCENE) } : {}),
    ...(r.snapEnabled !== undefined ? { snapEnabled: Boolean(r.snapEnabled) } : {}),
    ...(r.guidesVisible !== undefined ? { guidesVisible: Boolean(r.guidesVisible) } : {}),
    ...(r.safeAreaVisible !== undefined ? { safeAreaVisible: Boolean(r.safeAreaVisible) } : {}),
    ...(r.updatedAt !== undefined ? { updatedAt: text(r.updatedAt, "Scene updatedAt", 80) } : {}),
    ...(r.notes !== undefined ? { notes: text(r.notes, "Scene notes", 500) } : {}),
  };
}

export function parseSceneEntry(raw: unknown, index: number): SceneDef {
  const r = record(raw, `Scene ${index + 1}`);
  const n = index + 1;
  return {
    id: id(r.id, `Scene ${n} id`),
    name: text(r.name, `Scene ${n} name`, 18, 1),
    kind: choice(
      r.kind ?? "base",
      ["intro", "base", "freespins", "bonus", "outro"] as const,
      `Scene ${n} kind`,
    ),
    layerIds: list(r.layerIds ?? [], `Scene ${n} layerIds`, 24).map((lid, k) =>
      id(lid, `Scene ${n} layerId ${k + 1}`),
    ),
    entryTransition: text(r.entryTransition ?? "fade", `Scene ${n} entryTransition`, 40, 1),
    ...(r.objects !== undefined
      ? { objects: list(r.objects, `Scene ${n} objects`, MAX_OBJECTS).map(parseObject) }
      : {}),
    ...(r.background !== undefined ? { background: parseBackground(r.background) } : {}),
    ...(r.canvasConfiguration !== undefined
      ? { canvasConfiguration: parseCanvasConfiguration(r.canvasConfiguration) }
      : {}),
    ...(r.layers !== undefined
      ? { layers: list(r.layers, `Scene ${n} layers`, 24).map(parseLayer) }
      : {}),
    ...(r.visibility !== undefined ? { visibility: parseVisibility(r.visibility) } : {}),
    ...(r.composedImages !== undefined
      ? { composedImages: list(r.composedImages, `Scene ${n} composedImages`, MAX_OBJECTS).map(parseComposedImage) }
      : {}),
    ...(r.layoutMetadata !== undefined
      ? { layoutMetadata: parseLayoutMetadata(r.layoutMetadata) }
      : {}),
  };
}

export interface ParsedSceneDoc {
  objects: SceneObject[];
  background: SceneBackground;
  layers?: LayerDef[];
  name?: string;
  canvasConfiguration?: SceneCanvasConfiguration;
  visibility?: SceneVisibilityState;
  composedImages?: SceneComposedImageRef[];
  layoutMetadata?: SceneLayoutMetadata;
  scenes?: SceneDef[];
}

/** Strictly validates untrusted canvas payloads. Returns a readable error. */
export function parseSceneDoc(raw: unknown): ParseResult<ParsedSceneDoc> {
  try {
    const r = record(raw, "Scene");
    const layers = r.layers === undefined ? undefined : list(r.layers, "Layers", 24).map(parseLayer);
    const name = r.name === undefined ? undefined : text(r.name, "Scene name", 18, 1);
    const canvasConfiguration =
      r.canvasConfiguration === undefined ? undefined : parseCanvasConfiguration(r.canvasConfiguration);
    const visibility = r.visibility === undefined ? undefined : parseVisibility(r.visibility);
    const composedImages =
      r.composedImages === undefined
        ? undefined
        : list(r.composedImages, "Composed images", MAX_OBJECTS).map(parseComposedImage);
    const layoutMetadata =
      r.layoutMetadata === undefined ? undefined : parseLayoutMetadata(r.layoutMetadata);
    let scenes: SceneDef[] | undefined;
    if (r.scenes !== undefined) {
      const rawList = list(r.scenes, "Scenes", 3);
      if (rawList.length < 1) fail("At least 1 scene is required.");
      scenes = rawList.map(parseSceneEntry);
    }
    return {
      ok: true,
      value: {
        objects: list(r.objects, "Scene objects", MAX_OBJECTS).map(parseObject),
        background: parseBackground(r.background ?? {}),
        layers,
        ...(name !== undefined ? { name } : {}),
        ...(canvasConfiguration !== undefined ? { canvasConfiguration } : {}),
        ...(visibility !== undefined ? { visibility } : {}),
        ...(composedImages !== undefined ? { composedImages } : {}),
        ...(layoutMetadata !== undefined ? { layoutMetadata } : {}),
        ...(scenes !== undefined ? { scenes } : {}),
      },
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}

export const SHAPE_KINDS = SHAPES as readonly ShapeKind[];
