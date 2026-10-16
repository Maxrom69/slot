import { unionBox, type Box, type Vec } from "./geometry";

export interface Guide {
  axis: "v" | "h";
  /** Position in scene coordinates along the axis. */
  at: number;
  from: number;
  to: number;
}

export interface SnapInput {
  /** The moving box (axis-aligned, already includes rotation bounds). */
  box: Box;
  /** Other objects' boxes; highest priority. */
  targets?: Box[];
  /** The scene frame. */
  canvas: Box;
  /** Safe area frame, if shown. */
  safe?: Box | null;
  /** Grid spacing, when grid snapping is on. */
  gridSize?: number | null;
  /** Snap distance in screen pixels. */
  threshold: number;
  scale: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

interface Line {
  at: number;
  low: number;
  high: number;
  priority: number;
}

const EPS = 0.01;

function linesOf(box: Box, priority: number, vertical: boolean): Line[] {
  if (vertical) {
    const mid = box.x + box.w / 2;
    return [
      { at: box.x, low: box.y, high: box.y + box.h, priority },
      { at: mid, low: box.y, high: box.y + box.h, priority },
      { at: box.x + box.w, low: box.y, high: box.y + box.h, priority },
    ];
  }
  const mid = box.y + box.h / 2;
  return [
    { at: box.y, low: box.x, high: box.x + box.w, priority },
    { at: mid, low: box.x, high: box.x + box.w, priority },
    { at: box.y + box.h, low: box.x, high: box.x + box.w, priority },
  ];
}

const movingLines = (box: Box, vertical: boolean) => linesOf(box, 0, vertical).map((l) => l.at);

/**
 * Finds the smallest snap offset for one axis. Object edges/centres win over the
 * scene frame, which wins over the safe area, which wins over the grid.
 */
function resolve(moving: Box, candidates: Line[], vertical: boolean, thresholdWorld: number, gridSize: number | null): { delta: number; guide: Guide | null } {
  const mine = movingLines(moving, vertical);
  let best: { delta: number; line: Line } | null = null;
  for (const line of candidates) {
    for (const value of mine) {
      const delta = line.at - value;
      if (Math.abs(delta) > thresholdWorld) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta) - EPS) best = { delta, line };
    }
  }
  if (best) {
    return {
      delta: best.delta,
      guide: { axis: vertical ? "v" : "h", at: best.line.at, from: Math.min(best.line.low, best.line.high), to: Math.max(best.line.low, best.line.high) },
    };
  }
  if (gridSize && gridSize > 0) {
    let gridDelta: number | null = null;
    for (const value of mine) {
      const target = Math.round(value / gridSize) * gridSize;
      const delta = target - value;
      if (Math.abs(delta) > thresholdWorld) continue;
      if (gridDelta === null || Math.abs(delta) < Math.abs(gridDelta)) gridDelta = delta;
    }
    if (gridDelta !== null) return { delta: gridDelta, guide: null };
  }
  return { delta: 0, guide: null };
}

/** Computes snapping for a move or a resize, plus the smart guides to draw. */
export function computeSnap(input: SnapInput): SnapResult {
  const thresholdWorld = input.threshold / Math.max(input.scale, 0.0001);
  const others = input.targets ?? [];
  const frame = [input.canvas, ...(input.safe ? [input.safe] : [])];
  const guides: Guide[] = [];

  const build = (vertical: boolean): Line[] => [
    ...others.flatMap((box) => linesOf(box, 0, vertical)),
    ...frame.flatMap((box, index) => linesOf(box, 1 + index, vertical)),
  ];

  const x = resolve(input.box, build(true), true, thresholdWorld, input.gridSize ?? null);
  const y = resolve(input.box, build(false), false, thresholdWorld, input.gridSize ?? null);
  if (x.guide) guides.push(x.guide);
  if (y.guide) guides.push(y.guide);
  return { dx: x.delta, dy: y.delta, guides };
}

/** Alignment targets used by the align/distribute controls. */
export function alignBoxes(boxes: Box[], mode: "left" | "center" | "right" | "top" | "middle" | "bottom", frame: Box): number[] {
  if (boxes.length === 0) return [];
  const span = unionBox(boxes);
  const edge = (box: Box): number => {
    switch (mode) {
      case "left": return span.x - box.x;
      case "center": return span.x + span.w / 2 - (box.x + box.w / 2);
      case "right": return span.x + span.w - (box.x + box.w);
      case "top": return span.y - box.y;
      case "middle": return span.y + span.h / 2 - (box.y + box.h / 2);
      default: return span.y + span.h - (box.y + box.h);
    }
  };
  void frame;
  return boxes.map(edge);
}

export const snapPointToGrid = (point: Vec, gridSize: number | null): Vec =>
  gridSize && gridSize > 0
    ? { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize }
    : point;
