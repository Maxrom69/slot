import type { ColorState, ManualEditorDoc, RGBA, TwoStopGradient } from "./types";

function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clampAlpha(a: number): number {
  if (!Number.isFinite(a)) return 1;
  return Math.max(0, Math.min(1, Math.round(a * 100) / 100));
}

export function normalizeHex(input: string, fallback = "#d4af37"): string {
  const cleaned = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    const [r, g, b] = cleaned.split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return `#${cleaned}`.toLowerCase();
  }
  return fallback.toLowerCase();
}

export function hexToRgba(hex: string, alpha = 1): RGBA {
  const norm = normalizeHex(hex);
  const r = parseInt(norm.slice(1, 3), 16);
  const g = parseInt(norm.slice(3, 5), 16);
  const b = parseInt(norm.slice(5, 7), 16);
  return {
    r: clampByte(r),
    g: clampByte(g),
    b: clampByte(b),
    a: clampAlpha(alpha),
  };
}

export function rgbaToHex(rgba: RGBA): string {
  const r = clampByte(rgba.r).toString(16).padStart(2, "0");
  const g = clampByte(rgba.g).toString(16).padStart(2, "0");
  const b = clampByte(rgba.b).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`.toLowerCase();
}

export function rgbaToCss(rgba: RGBA): string {
  const r = clampByte(rgba.r);
  const g = clampByte(rgba.g);
  const b = clampByte(rgba.b);
  const a = clampAlpha(rgba.a);
  if (a >= 1) return rgbaToHex(rgba);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function parseColorToRgba(input: string, fallbackHex = "#d4af37"): RGBA {
  const str = (input ?? "").trim();
  const rgbaMatch = str.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (rgbaMatch) {
    return {
      r: clampByte(Number(rgbaMatch[1])),
      g: clampByte(Number(rgbaMatch[2])),
      b: clampByte(Number(rgbaMatch[3])),
      a: rgbaMatch[4] !== undefined ? clampAlpha(Number(rgbaMatch[4])) : 1,
    };
  }
  return hexToRgba(str, 1);
}

export function pushRecentSwatch(swatches: string[], hex: string, max = 12): string[] {
  const norm = normalizeHex(hex);
  const without = swatches.filter((s) => normalizeHex(s) !== norm);
  return [norm, ...without].slice(0, max);
}

export function gradientToCss(gradient: TwoStopGradient): string {
  const angle = Number.isFinite(gradient.angle) ? ((gradient.angle % 360) + 360) % 360 : 135;
  const s1 = Math.max(0, Math.min(100, gradient.startStop ?? 0));
  const s2 = Math.max(0, Math.min(100, gradient.endStop ?? 100));
  return `linear-gradient(${angle}deg, ${gradient.startColor} ${s1}%, ${gradient.endColor} ${s2}%)`;
}

export function updateColorFromHex(
  state: ColorState,
  hexInput: string,
  addSwatch = true,
): ColorState {
  const hex = normalizeHex(hexInput, state.hex);
  const rgba = hexToRgba(hex, state.rgba.a);
  return {
    ...state,
    hex,
    rgba,
    recentSwatches: addSwatch ? pushRecentSwatch(state.recentSwatches, hex) : state.recentSwatches,
  };
}

export function updateColorFromRgba(
  state: ColorState,
  patch: Partial<RGBA>,
  addSwatch = true,
): ColorState {
  const rgba: RGBA = {
    r: clampByte(patch.r ?? state.rgba.r),
    g: clampByte(patch.g ?? state.rgba.g),
    b: clampByte(patch.b ?? state.rgba.b),
    a: clampAlpha(patch.a ?? state.rgba.a),
  };
  const hex = rgbaToHex(rgba);
  return {
    ...state,
    hex,
    rgba,
    recentSwatches: addSwatch ? pushRecentSwatch(state.recentSwatches, hex) : state.recentSwatches,
  };
}

export function updateTwoStopGradient(
  state: ColorState,
  patch: Partial<TwoStopGradient>,
): ColorState {
  return {
    ...state,
    gradient: {
      ...state.gradient,
      ...patch,
      startStop: Math.max(0, Math.min(100, patch.startStop ?? state.gradient.startStop)),
      endStop: Math.max(0, Math.min(100, patch.endStop ?? state.gradient.endStop)),
      angle: ((patch.angle ?? state.gradient.angle) % 360 + 360) % 360,
    },
  };
}

/**
 * Samples the topmost visible layer color at canvas coordinate (x, y) for the Eyedropper tool (I).
 */
export function sampleLayerColorAtPoint(
  doc: ManualEditorDoc,
  x: number,
  y: number,
  fallbackHex = "#d4af37",
): { hex: string; rgba: RGBA; sourceLayerId: string | null } {
  // Iterate from top layer (index 0) to bottom layer
  for (const layer of doc.layers) {
    if (!layer.visible) continue;

    // Check raster strokes first
    for (let i = layer.rasterStrokes.length - 1; i >= 0; i--) {
      const stroke = layer.rasterStrokes[i]!;
      if (stroke.mode === "eraser") continue;
      const radius = Math.max(6, stroke.size / 2);
      const hit = stroke.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) <= radius);
      if (hit) {
        const rgba = parseColorToRgba(stroke.color, fallbackHex);
        return { hex: rgbaToHex(rgba), rgba, sourceLayerId: layer.id };
      }
    }

    const insideBounds =
      x >= layer.x &&
      x <= layer.x + layer.width &&
      y >= layer.y &&
      y <= layer.y + layer.height;

    if (!insideBounds) continue;

    if (layer.kind === "vector_text" && layer.textProps) {
      const color = layer.textProps.gradient.enabled
        ? layer.textProps.gradient.startColor
        : layer.textProps.fill;
      const rgba = parseColorToRgba(color, fallbackHex);
      return { hex: rgbaToHex(rgba), rgba, sourceLayerId: layer.id };
    }

    if ((layer.kind === "vector_shape" || layer.kind === "vector_line") && layer.shapeProps) {
      const color = layer.shapeProps.gradient.enabled
        ? layer.shapeProps.gradient.startColor
        : layer.shapeProps.fill || layer.shapeProps.stroke;
      const rgba = parseColorToRgba(color, fallbackHex);
      return { hex: rgbaToHex(rgba), rgba, sourceLayerId: layer.id };
    }

    if (layer.kind === "vector_freehand" && layer.freehandBrush) {
      const rgba = parseColorToRgba(layer.freehandBrush.color, fallbackHex);
      return { hex: rgbaToHex(rgba), rgba, sourceLayerId: layer.id };
    }

    if (layer.adjustments.tintAmount > 0 && layer.adjustments.tintColor) {
      const rgba = parseColorToRgba(layer.adjustments.tintColor, fallbackHex);
      return { hex: rgbaToHex(rgba), rgba, sourceLayerId: layer.id };
    }
  }

  const rgba = hexToRgba(fallbackHex, 1);
  return { hex: rgbaToHex(rgba), rgba, sourceLayerId: null };
}
