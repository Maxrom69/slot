/**
 * Pure scene geometry. No React, no I/O: every function is deterministic so the
 * client and the server agree, and so interaction math is unit-testable.
 * Objects store the unrotated top-left plus a rotation about their own centre.
 */

export interface Vec {
  x: number;
  y: number;
}

/** Axis-aligned bounding box in scene coordinates. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Transform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export const MIN_SIZE = 4;
export const DEG = Math.PI / 180;
const rad = (degrees: number) => degrees * DEG;

export const centerOf = (t: Transform): Vec => ({ x: t.x + t.width / 2, y: t.y + t.height / 2 });

export function rotatePoint(point: Vec, pivot: Vec, degrees: number): Vec {
  if (!degrees) return { x: point.x, y: point.y };
  const a = rad(degrees);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = point.x - pivot.x;
  const dy = point.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

export function objectCorners(t: Transform): Vec[] {
  const c = centerOf(t);
  return [
    { x: t.x, y: t.y },
    { x: t.x + t.width, y: t.y },
    { x: t.x + t.width, y: t.y + t.height },
    { x: t.x, y: t.y + t.height },
  ].map((p) => rotatePoint(p, c, t.rotation));
}

export function aabbOf(t: Transform): Box {
  const pts = objectCorners(t);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

export const boxCenter = (b: Box): Vec => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const unionBox = (boxes: Box[]): Box => ({
  x: Math.min(...boxes.map((b) => b.x)),
  y: Math.min(...boxes.map((b) => b.y)),
  w: Math.max(...boxes.map((b) => b.x + b.w)) - Math.min(...boxes.map((b) => b.x)),
  h: Math.max(...boxes.map((b) => b.y + b.h)) - Math.min(...boxes.map((b) => b.y)),
});
export const inflate = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, w: b.w + by * 2, h: b.h + by * 2 });
export const boxContainsPoint = (b: Box, p: Vec) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
export const boxesIntersect = (a: Box, b: Box) =>
  a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;

/** Point-in-rotated-rect test, used for accurate selection clicks. */
export function objectContainsPoint(t: Transform, point: Vec): boolean {
  const c = centerOf(t);
  const local = rotatePoint(point, c, -t.rotation);
  return local.x >= t.x && local.x <= t.x + t.width && local.y >= t.y && local.y <= t.y + t.height;
}

/* ------------------------------- viewport -------------------------------- */

export interface Viewport {
  /** screen = world * scale + pan */
  scale: number;
  x: number;
  y: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 8;

export const clampScale = (scale: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
export const toWorld = (v: Viewport, screen: Vec): Vec => ({ x: (screen.x - v.x) / v.scale, y: (screen.y - v.y) / v.scale });
export const toScreen = (v: Viewport, world: Vec): Vec => ({ x: world.x * v.scale + v.x, y: world.y * v.scale + v.y });

/** Zooms about a screen anchor so the point under the cursor stays put. */
export function zoomViewport(v: Viewport, nextScale: number, anchor: Vec): Viewport {
  const scale = clampScale(nextScale);
  const world = toWorld(v, anchor);
  return { scale, x: anchor.x - world.x * scale, y: anchor.y - world.y * scale };
}

export function fitViewport(v: Viewport, content: Box, viewportSize: { w: number; h: number }, padding = 72): Viewport {
  if (content.w <= 0 || content.h <= 0 || viewportSize.w <= 0 || viewportSize.h <= 0) return v;
  const scale = clampScale(
    Math.min((viewportSize.w - padding * 2) / content.w, (viewportSize.h - padding * 2) / content.h),
  );
  return {
    scale,
    x: (viewportSize.w - content.w * scale) / 2 - content.x * scale,
    y: (viewportSize.h - content.h * scale) / 2 - content.y * scale,
  };
}

/* -------------------------------- handles -------------------------------- */

export const HANDLE_SIZE = 9;
export type HandleId =
  | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w"
  | "rotate" | "body";

/** Handle positions in object-local space (fractions of width/height). */
const HANDLE_LOCAL: Record<Exclude<HandleId, "rotate" | "body">, Vec> = {
  nw: { x: 0, y: 0 }, n: { x: 0.5, y: 0 }, ne: { x: 1, y: 0 },
  e: { x: 1, y: 0.5 }, se: { x: 1, y: 1 }, s: { x: 0.5, y: 1 },
  sw: { x: 0, y: 1 }, w: { x: 0, y: 0.5 },
};

export function handleWorld(t: Transform, id: Exclude<HandleId, "rotate" | "body">): Vec {
  const local = HANDLE_LOCAL[id];
  return rotatePoint({ x: t.x + t.width * local.x, y: t.y + t.height * local.y }, centerOf(t), t.rotation);
}

export function rotateHandleWorld(t: Transform, distance = 28): Vec {
  const c = centerOf(t);
  return rotatePoint({ x: c.x, y: t.y - distance }, c, t.rotation);
}

/** Opposite handle, which stays anchored while resizing. */
export function oppositeHandle(id: Exclude<HandleId, "rotate" | "body">): Vec {
  return HANDLE_LOCAL[
    id === "nw" ? "se" : id === "n" ? "s" : id === "ne" ? "sw" : id === "e" ? "w"
      : id === "se" ? "nw" : id === "s" ? "n" : id === "sw" ? "ne" : "e"
  ];
}

/** Normalises an angle to -180..180. */
export function normalizeAngle(degrees: number): number {
  let a = degrees % 360;
  if (a > 180) a -= 360;
  if (a < -180) a += 360;
  return a;
}

export const roundTo = (value: number, step: number) => (step ? Math.round(value / step) * step : value);
export const snapAngle = (degrees: number, step = 15) => roundTo(normalizeAngle(degrees), step);
export const clean = (value: number) => Math.round(value * 100) / 100;

/**
 * Resizes from a handle. The opposite handle is the anchor: it stays fixed in
 * world space while the box grows, which is what makes resizing a rotated
 * object feel right. Shift keeps the aspect ratio for corner handles.
 */
export function resizeTransform(
  start: Transform,
  handle: Exclude<HandleId, "rotate" | "body">,
  pointer: Vec,
  options: { keepAspect?: boolean; min?: number } = {},
): Transform {
  const min = options.min ?? MIN_SIZE;
  const c0 = centerOf(start);
  const pointerLocal = rotatePoint(pointer, c0, -start.rotation);
  const anchor = oppositeHandle(handle);
  const anchorLocal = { x: start.x + start.width * anchor.x, y: start.y + start.height * anchor.y };

  let width = Math.max(min, Math.abs(pointerLocal.x - anchorLocal.x));
  let height = Math.max(min, Math.abs(pointerLocal.y - anchorLocal.y));

  const corner = handle.length === 2;
  if (options.keepAspect && corner && start.width > 0 && start.height > 0) {
    const ratio = start.width / start.height;
    if (width / height > ratio) height = width / ratio;
    else width = height * ratio;
  }
  // An edge handle only changes one span and keeps the orthogonal axis anchored.
  if (handle === "n" || handle === "s") width = start.width;
  if (handle === "e" || handle === "w") height = start.height;

  const left =
    handle === "n" || handle === "s"
      ? start.x
      : pointerLocal.x < anchorLocal.x
        ? anchorLocal.x - width
        : anchorLocal.x;
  const top =
    handle === "e" || handle === "w"
      ? start.y
      : pointerLocal.y < anchorLocal.y
        ? anchorLocal.y - height
        : anchorLocal.y;
  const newCenterLocal = { x: left + width / 2, y: top + height / 2 };
  const offset = { x: newCenterLocal.x - anchorLocal.x, y: newCenterLocal.y - anchorLocal.y };
  const worldCenter = rotatePoint(offset, { x: 0, y: 0 }, start.rotation);
  return {
    x: anchorLocal.x + worldCenter.x - width / 2,
    y: anchorLocal.y + worldCenter.y - height / 2,
    width,
    height,
    rotation: start.rotation,
  };
}

/** Rotates every transform about a shared pivot, adding the same angle delta. */
export function rotateAround(transforms: Transform[], pivot: Vec, delta: number): Transform[] {
  return transforms.map((t) => {
    const c = centerOf(t);
    const next = rotatePoint(c, pivot, delta);
    return { ...t, x: next.x - t.width / 2, y: next.y - t.height / 2, rotation: normalizeAngle(t.rotation + delta) };
  });
}

/** Scales transforms about a box origin (group resize). */
export function scaleTransforms(transforms: Transform[], origin: Vec, sx: number, sy: number): Transform[] {
  return transforms.map((t) => ({
    ...t,
    x: origin.x + (t.x - origin.x) * sx,
    y: origin.y + (t.y - origin.y) * sy,
    width: Math.max(MIN_SIZE, t.width * sx),
    height: Math.max(MIN_SIZE, t.height * sy),
  }));
}

/** Rotates a direction vector into object-local space (used for inner points). */
export function toLocalSpace(t: Transform, point: Vec): Vec {
  return rotatePoint(point, centerOf(t), -t.rotation);
}
