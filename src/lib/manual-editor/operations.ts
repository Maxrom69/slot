import {
  hexToRgba,
  normalizeHex,
  pushRecentSwatch,
  sampleLayerColorAtPoint,
  updateColorFromHex,
  updateColorFromRgba,
  updateTwoStopGradient,
} from "./color";
import {
  MANUAL_TOOLS,
  RASTERIZE_CONFIRMATION_MESSAGE,
  type BrushSettings,
  type DropShadowEffect,
  type EditorBlendMode,
  type EditorLayer,
  type LayerAdjustments,
  type ManualEditorDoc,
  type ManualToolId,
  type RGBA,
  type RasterStroke,
  type RasterStrokePoint,
  type ShapeKind,
  type ShapeLayerProps,
  type TextLayerProps,
  type TwoStopGradient,
} from "./types";

let seqCounter = 1;
function nextEditorId(prefix: string): string {
  seqCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${seqCounter.toString(36)}`;
}

export function createDefaultAdjustments(): LayerAdjustments {
  return {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    vibrance: 0,
    hue: 0,
    blur: 0,
    tintColor: "#d4af37",
    tintAmount: 0,
    sharpen: 0,
    grayscale: 0,
    invert: 0,
  };
}

export function createDefaultDropShadow(): DropShadowEffect {
  return {
    enabled: false,
    color: "#000000",
    blur: 12,
    offsetX: 0,
    offsetY: 6,
  };
}

export function createDefaultGradient(
  startColor = "#f5d061",
  endColor = "#b45309",
): TwoStopGradient {
  return {
    enabled: false,
    startColor: normalizeHex(startColor),
    endColor: normalizeHex(endColor),
    startStop: 0,
    endStop: 100,
    angle: 135,
  };
}

export interface InitManualEditorOptions {
  width?: number;
  height?: number;
  baseImageUri?: string | null;
  baseImageName?: string;
  baseIsVector?: boolean;
  initialTintColor?: string;
  initialOpacity?: number;
  initialBlendMode?: EditorBlendMode;
  paletteSwatches?: string[];
}

export function createInitialManualEditorDoc(
  options: InitManualEditorOptions = {},
): ManualEditorDoc {
  const width = options.width && options.width > 0 ? options.width : 512;
  const height = options.height && options.height > 0 ? options.height : 512;
  const baseIsVector =
    options.baseIsVector ??
    Boolean(
      options.baseImageUri &&
        (options.baseImageUri.startsWith("data:image/svg+xml") ||
          options.baseImageUri.toLowerCase().endsWith(".svg")),
    );

  const primaryHex = normalizeHex(options.paletteSwatches?.[0] ?? "#d4af37");
  const secondaryHex = normalizeHex(options.paletteSwatches?.[1] ?? "#7c3aed");
  const defaultSwatches = [
    primaryHex,
    secondaryHex,
    "#ffffff",
    "#f59e0b",
    "#ef4444",
    "#10b981",
    "#3b82f6",
    "#0f172a",
  ];
  const uniqueSwatches: string[] = [];
  for (const sw of [...(options.paletteSwatches ?? []), ...defaultSwatches]) {
    const n = normalizeHex(sw);
    if (!uniqueSwatches.includes(n)) uniqueSwatches.push(n);
  }

  const adjustments = createDefaultAdjustments();
  if (options.initialTintColor) {
    adjustments.tintColor = normalizeHex(options.initialTintColor);
    adjustments.tintAmount = 35;
  }

  const baseLayer: EditorLayer = {
    id: "layer-base",
    name: options.baseImageName?.trim() || "Base Artwork",
    kind: baseIsVector ? "vector_svg" : "raster",
    isVector: baseIsVector,
    visible: true,
    locked: false,
    opacity: options.initialOpacity ?? 1,
    blendMode: options.initialBlendMode ?? "normal",
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    adjustments,
    dropShadow: createDefaultDropShadow(),
    maskedByLayerId: null,
    isMaskSourceForLayerId: null,
    imageUri: options.baseImageUri ?? null,
    rasterStrokes: [],
  };

  return {
    width,
    height,
    layers: [baseLayer],
    selectedLayerId: baseLayer.id,
    activeTool: "select",
    brush: {
      color: primaryHex,
      size: 16,
      hardness: 85,
      opacity: 1,
      stabilization: 35,
    },
    color: {
      hex: primaryHex,
      rgba: hexToRgba(primaryHex, 1),
      recentSwatches: uniqueSwatches.slice(0, 12),
      gradient: createDefaultGradient(primaryHex, secondaryHex),
    },
    zoom: 100,
    fullscreen: false,
  };
}

export function selectTool(doc: ManualEditorDoc, tool: ManualToolId): ManualEditorDoc {
  if (!MANUAL_TOOLS.some((t) => t.id === tool)) return doc;
  return { ...doc, activeTool: tool };
}

export function selectLayer(doc: ManualEditorDoc, layerId: string | null): ManualEditorDoc {
  if (layerId !== null && !doc.layers.some((l) => l.id === layerId)) return doc;
  return { ...doc, selectedLayerId: layerId };
}

export function setEditorZoom(doc: ManualEditorDoc, zoom: number): ManualEditorDoc {
  const clamped = Math.max(25, Math.min(400, Math.round(zoom)));
  return { ...doc, zoom: clamped };
}

export function setEditorFullscreen(doc: ManualEditorDoc, fullscreen: boolean): ManualEditorDoc {
  return { ...doc, fullscreen };
}

export function updateBrushSettings(
  doc: ManualEditorDoc,
  patch: Partial<BrushSettings>,
): ManualEditorDoc {
  const nextColor = patch.color ? normalizeHex(patch.color, doc.brush.color) : doc.brush.color;
  const nextBrush: BrushSettings = {
    color: nextColor,
    size: Math.max(1, Math.min(200, Math.round(patch.size ?? doc.brush.size))),
    hardness: Math.max(0, Math.min(100, Math.round(patch.hardness ?? doc.brush.hardness))),
    opacity: Math.max(0.05, Math.min(1, Number((patch.opacity ?? doc.brush.opacity).toFixed(2)))),
    stabilization: Math.max(
      0,
      Math.min(100, Math.round(patch.stabilization ?? doc.brush.stabilization)),
    ),
  };
  const nextColorState = patch.color ? updateColorFromHex(doc.color, nextColor) : doc.color;
  return {
    ...doc,
    brush: nextBrush,
    color: nextColorState,
  };
}

export function updateEditorColorHex(doc: ManualEditorDoc, hex: string): ManualEditorDoc {
  const nextColor = updateColorFromHex(doc.color, hex, true);
  return {
    ...doc,
    color: nextColor,
    brush: {
      ...doc.brush,
      color: nextColor.hex,
    },
  };
}

export function updateEditorColorRgba(
  doc: ManualEditorDoc,
  patch: Partial<RGBA>,
): ManualEditorDoc {
  const nextColor = updateColorFromRgba(doc.color, patch, true);
  return {
    ...doc,
    color: nextColor,
    brush: {
      ...doc.brush,
      color: nextColor.hex,
      opacity: nextColor.rgba.a,
    },
  };
}

export function updateEditorGradient(
  doc: ManualEditorDoc,
  patch: Partial<TwoStopGradient>,
): ManualEditorDoc {
  return {
    ...doc,
    color: updateTwoStopGradient(doc.color, patch),
  };
}

export function sampleEyedropperAtPoint(
  doc: ManualEditorDoc,
  x: number,
  y: number,
): { doc: ManualEditorDoc; sampledHex: string; sourceLayerId: string | null } {
  const sampled = sampleLayerColorAtPoint(doc, x, y, doc.color.hex);
  const nextDoc = updateEditorColorHex(doc, sampled.hex);
  return {
    doc: nextDoc,
    sampledHex: sampled.hex,
    sourceLayerId: sampled.sourceLayerId,
  };
}

export function addBlankRasterLayer(
  doc: ManualEditorDoc,
  name?: string,
): { doc: ManualEditorDoc; layerId: string } {
  const layerId = nextEditorId("layer-raster");
  const count = doc.layers.filter((l) => l.kind === "raster").length + 1;
  const newLayer: EditorLayer = {
    id: layerId,
    name: name?.trim() || `Paint Layer ${count}`,
    kind: "raster",
    isVector: false,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
    rotation: 0,
    adjustments: createDefaultAdjustments(),
    dropShadow: createDefaultDropShadow(),
    maskedByLayerId: null,
    isMaskSourceForLayerId: null,
    imageUri: null,
    rasterStrokes: [],
  };
  return {
    doc: {
      ...doc,
      layers: [newLayer, ...doc.layers],
      selectedLayerId: layerId,
    },
    layerId,
  };
}

export function addVectorTextLayer(
  doc: ManualEditorDoc,
  partial?: Partial<TextLayerProps> & { name?: string; x?: number; y?: number },
): { doc: ManualEditorDoc; layerId: string } {
  const layerId = nextEditorId("layer-text");
  const textProps: TextLayerProps = {
    text: partial?.text ?? "WIN BIG",
    font: partial?.font ?? "Cinzel",
    weight: partial?.weight ?? 700,
    style: partial?.style ?? "normal",
    alignment: partial?.alignment ?? "center",
    size: partial?.size ?? 48,
    fill: normalizeHex(partial?.fill ?? doc.color.hex),
    gradient: partial?.gradient ?? { ...doc.color.gradient },
    outlineColor: normalizeHex(partial?.outlineColor ?? "#000000"),
    outlineWidth: partial?.outlineWidth ?? 2,
    letterSpacing: partial?.letterSpacing ?? 2,
    lineHeight: partial?.lineHeight ?? 1.2,
  };

  const newLayer: EditorLayer = {
    id: layerId,
    name: partial?.name?.trim() || `Text: ${textProps.text.slice(0, 18)}`,
    kind: "vector_text",
    isVector: true,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: partial?.x ?? Math.round(doc.width * 0.15),
    y: partial?.y ?? Math.round(doc.height * 0.38),
    width: Math.round(doc.width * 0.7),
    height: Math.max(72, Math.round(textProps.size * textProps.lineHeight * 1.6)),
    rotation: 0,
    adjustments: createDefaultAdjustments(),
    dropShadow: {
      enabled: true,
      color: "#000000",
      blur: 10,
      offsetX: 0,
      offsetY: 4,
    },
    maskedByLayerId: null,
    isMaskSourceForLayerId: null,
    rasterStrokes: [],
    textProps,
  };

  return {
    doc: {
      ...doc,
      layers: [newLayer, ...doc.layers],
      selectedLayerId: layerId,
      color: {
        ...doc.color,
        recentSwatches: pushRecentSwatch(doc.color.recentSwatches, textProps.fill),
      },
    },
    layerId,
  };
}

export function addVectorShapeLayer(
  doc: ManualEditorDoc,
  shapeKind: ShapeKind = "rounded_rect",
  partial?: Partial<ShapeLayerProps> & {
    name?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  },
): { doc: ManualEditorDoc; layerId: string } {
  const layerId = nextEditorId("layer-shape");
  const shapeProps: ShapeLayerProps = {
    shapeKind: partial?.shapeKind ?? shapeKind,
    fill: normalizeHex(partial?.fill ?? doc.color.hex),
    gradient: partial?.gradient ?? { ...doc.color.gradient },
    stroke: normalizeHex(partial?.stroke ?? "#ffffff"),
    width: partial?.width ?? 3,
    cornerRadius:
      partial?.cornerRadius ?? (shapeKind === "rounded_rect" ? 20 : 0),
    polygonPoints: Math.max(3, Math.min(12, Math.round(partial?.polygonPoints ?? 5))),
  };

  const labels: Record<ShapeKind, string> = {
    rect: "Rectangle",
    rounded_rect: "Rounded Rect",
    ellipse: "Ellipse",
    triangle: "Triangle",
    polygon: `${shapeProps.polygonPoints}-Point Polygon`,
  };

  const w = partial?.width && partial.width > 20 ? partial.width : Math.round(doc.width * 0.45);
  const h = partial?.height && partial.height > 20 ? partial.height : Math.round(doc.height * 0.45);

  const newLayer: EditorLayer = {
    id: layerId,
    name: partial?.name?.trim() || labels[shapeProps.shapeKind],
    kind: "vector_shape",
    isVector: true,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: partial?.x ?? Math.round((doc.width - w) / 2),
    y: partial?.y ?? Math.round((doc.height - h) / 2),
    width: w,
    height: h,
    rotation: 0,
    adjustments: createDefaultAdjustments(),
    dropShadow: createDefaultDropShadow(),
    maskedByLayerId: null,
    isMaskSourceForLayerId: null,
    rasterStrokes: [],
    shapeProps,
  };

  return {
    doc: {
      ...doc,
      layers: [newLayer, ...doc.layers],
      selectedLayerId: layerId,
    },
    layerId,
  };
}

export function addVectorLineArrowLayer(
  doc: ManualEditorDoc,
  arrowEnd = true,
  partial?: Partial<ShapeLayerProps> & {
    name?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  },
): { doc: ManualEditorDoc; layerId: string } {
  const layerId = nextEditorId("layer-line");
  const shapeProps: ShapeLayerProps = {
    shapeKind: "rect",
    fill: normalizeHex(partial?.fill ?? doc.color.hex),
    gradient: partial?.gradient ?? { ...doc.color.gradient },
    stroke: normalizeHex(partial?.stroke ?? doc.color.hex),
    width: partial?.width ?? 6,
    cornerRadius: 0,
    polygonPoints: 3,
    arrowStart: partial?.arrowStart ?? false,
    arrowEnd: partial?.arrowEnd ?? arrowEnd,
  };

  const w = partial?.width ?? Math.round(doc.width * 0.55);
  const h = partial?.height ?? 64;

  const newLayer: EditorLayer = {
    id: layerId,
    name: partial?.name?.trim() || (shapeProps.arrowEnd ? "Vector Arrow" : "Vector Line"),
    kind: "vector_line",
    isVector: true,
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: "normal",
    x: partial?.x ?? Math.round((doc.width - w) / 2),
    y: partial?.y ?? Math.round((doc.height - h) / 2),
    width: w,
    height: h,
    rotation: 0,
    adjustments: createDefaultAdjustments(),
    dropShadow: createDefaultDropShadow(),
    maskedByLayerId: null,
    isMaskSourceForLayerId: null,
    rasterStrokes: [],
    shapeProps,
  };

  return {
    doc: {
      ...doc,
      layers: [newLayer, ...doc.layers],
      selectedLayerId: layerId,
    },
    layerId,
  };
}

/**
 * Smooths raw pointer coordinates according to `stabilization` (0..100).
 */
export function stabilizePoints(
  points: RasterStrokePoint[],
  stabilization: number,
): RasterStrokePoint[] {
  if (points.length <= 2 || stabilization <= 0) {
    return points.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
  }
  const weight = Math.max(0, Math.min(0.85, (stabilization / 100) * 0.85));
  const result: RasterStrokePoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = points[i]!;
    result.push({
      x: Math.round((prev.x * weight + curr.x * (1 - weight)) * 10) / 10,
      y: Math.round((prev.y * weight + curr.y * (1 - weight)) * 10) / 10,
    });
  }
  return result;
}

export function addFreehandVectorLayer(
  doc: ManualEditorDoc,
  rawPoints: RasterStrokePoint[],
  customBrush?: Partial<BrushSettings>,
): { doc: ManualEditorDoc; layerId: string } {
  const layerId = nextEditorId("layer-freehand");
  const brush: BrushSettings = {
    ...doc.brush,
    ...customBrush,
  };
  const points = stabilizePoints(
    rawPoints.length > 0
      ? rawPoints
      : [
          { x: doc.width * 0.25, y: doc.height * 0.5 },
          { x: doc.width * 0.5, y: doc.height * 0.35 },
          { x: doc.width * 0.75, y: doc.height * 0.55 },
        ],
    brush.stabilization,
  );

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.max(0, Math.min(...xs) - brush.size);
  const minY = Math.max(0, Math.min(...ys) - brush.size);
  const maxX = Math.min(doc.width, Math.max(...xs) + brush.size);
  const maxY = Math.min(doc.height, Math.max(...ys) + brush.size);

  const newLayer: EditorLayer = {
    id: layerId,
    name: `Freehand Path`,
    kind: "vector_freehand",
    isVector: true,
    visible: true,
    locked: false,
    opacity: brush.opacity,
    blendMode: "normal",
    x: Math.round(minX),
    y: Math.round(minY),
    width: Math.max(32, Math.round(maxX - minX)),
    height: Math.max(32, Math.round(maxY - minY)),
    rotation: 0,
    adjustments: createDefaultAdjustments(),
    dropShadow: createDefaultDropShadow(),
    maskedByLayerId: null,
    isMaskSourceForLayerId: null,
    rasterStrokes: [],
    freehandPoints: points,
    freehandBrush: brush,
  };

  return {
    doc: {
      ...doc,
      layers: [newLayer, ...doc.layers],
      selectedLayerId: layerId,
    },
    layerId,
  };
}

export function updateLayer(
  doc: ManualEditorDoc,
  layerId: string,
  patch: Partial<
    Pick<
      EditorLayer,
      | "name"
      | "visible"
      | "locked"
      | "opacity"
      | "blendMode"
      | "x"
      | "y"
      | "width"
      | "height"
      | "rotation"
    >
  >,
): ManualEditorDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id !== layerId) return l;
      return {
        ...l,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
        ...(patch.locked !== undefined ? { locked: patch.locked } : {}),
        ...(patch.opacity !== undefined
          ? { opacity: Math.max(0, Math.min(1, patch.opacity)) }
          : {}),
        ...(patch.blendMode !== undefined ? { blendMode: patch.blendMode } : {}),
        ...(patch.x !== undefined ? { x: Math.round(patch.x) } : {}),
        ...(patch.y !== undefined ? { y: Math.round(patch.y) } : {}),
        ...(patch.width !== undefined ? { width: Math.max(16, Math.round(patch.width)) } : {}),
        ...(patch.height !== undefined ? { height: Math.max(16, Math.round(patch.height)) } : {}),
        ...(patch.rotation !== undefined ? { rotation: Math.round(patch.rotation) } : {}),
      };
    }),
  };
}

export function updateLayerTextProps(
  doc: ManualEditorDoc,
  layerId: string,
  patch: Partial<TextLayerProps>,
): ManualEditorDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id !== layerId || !l.textProps) return l;
      const nextTextProps: TextLayerProps = {
        ...l.textProps,
        ...patch,
        ...(patch.gradient ? { gradient: { ...l.textProps.gradient, ...patch.gradient } } : {}),
      };
      return {
        ...l,
        textProps: nextTextProps,
      };
    }),
  };
}

export function updateLayerShapeProps(
  doc: ManualEditorDoc,
  layerId: string,
  patch: Partial<ShapeLayerProps>,
): ManualEditorDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id !== layerId || !l.shapeProps) return l;
      const nextShapeProps: ShapeLayerProps = {
        ...l.shapeProps,
        ...patch,
        ...(patch.polygonPoints !== undefined
          ? { polygonPoints: Math.max(3, Math.min(12, Math.round(patch.polygonPoints))) }
          : {}),
        ...(patch.cornerRadius !== undefined
          ? { cornerRadius: Math.max(0, Math.min(200, Math.round(patch.cornerRadius))) }
          : {}),
        ...(patch.width !== undefined
          ? { width: Math.max(0, Math.min(60, Number(patch.width))) }
          : {}),
        ...(patch.gradient ? { gradient: { ...l.shapeProps.gradient, ...patch.gradient } } : {}),
      };
      return {
        ...l,
        shapeProps: nextShapeProps,
      };
    }),
  };
}

export function updateLayerAdjustments(
  doc: ManualEditorDoc,
  layerId: string,
  patch: Partial<LayerAdjustments>,
): ManualEditorDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id !== layerId) return l;
      return {
        ...l,
        adjustments: {
          ...l.adjustments,
          ...patch,
        },
      };
    }),
  };
}

export function resetLayerAdjustments(
  doc: ManualEditorDoc,
  layerId: string,
): ManualEditorDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) =>
      l.id === layerId ? { ...l, adjustments: createDefaultAdjustments() } : l,
    ),
  };
}

export function updateLayerDropShadow(
  doc: ManualEditorDoc,
  layerId: string,
  patch: Partial<DropShadowEffect>,
): ManualEditorDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id !== layerId) return l;
      return {
        ...l,
        dropShadow: {
          ...l.dropShadow,
          ...patch,
        },
      };
    }),
  };
}

export function reorderLayer(
  doc: ManualEditorDoc,
  layerId: string,
  direction: "up" | "down",
): ManualEditorDoc {
  const idx = doc.layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return doc;
  const targetIdx = direction === "up" ? idx - 1 : idx + 1;
  if (targetIdx < 0 || targetIdx >= doc.layers.length) return doc;
  const next = [...doc.layers];
  const [moved] = next.splice(idx, 1);
  next.splice(targetIdx, 0, moved!);
  return { ...doc, layers: next };
}

export function duplicateLayer(
  doc: ManualEditorDoc,
  layerId: string,
): { doc: ManualEditorDoc; newLayerId: string | null } {
  const idx = doc.layers.findIndex((l) => l.id === layerId);
  if (idx < 0) return { doc, newLayerId: null };
  const orig = doc.layers[idx]!;
  const newLayerId = nextEditorId("layer-copy");
  const copy: EditorLayer = {
    ...JSON.parse(JSON.stringify(orig)),
    id: newLayerId,
    name: `${orig.name} copy`,
    x: orig.x + 12,
    y: orig.y + 12,
    maskedByLayerId: null,
    isMaskSourceForLayerId: null,
  };
  const next = [...doc.layers];
  next.splice(idx, 0, copy);
  return {
    doc: { ...doc, layers: next, selectedLayerId: newLayerId },
    newLayerId,
  };
}

export function deleteLayer(doc: ManualEditorDoc, layerId: string): ManualEditorDoc {
  if (doc.layers.length <= 1) return doc;
  const filtered = doc.layers
    .filter((l) => l.id !== layerId)
    .map((l) => ({
      ...l,
      maskedByLayerId: l.maskedByLayerId === layerId ? null : l.maskedByLayerId,
      isMaskSourceForLayerId:
        l.isMaskSourceForLayerId === layerId ? null : l.isMaskSourceForLayerId,
    }));
  const nextSelected =
    doc.selectedLayerId === layerId ? (filtered[0]?.id ?? null) : doc.selectedLayerId;
  return {
    ...doc,
    layers: filtered,
    selectedLayerId: nextSelected,
  };
}

/**
 * F13 VECTOR / RASTER RULE:
 * Checks whether applying `tool` to `layer` requires pixel editing on a vector object.
 * If true, the UI MUST display a confirmation: "Rasterize this object?" and must not
 * silently flatten artwork.
 */
export function requiresRasterizationConfirmation(
  layer: EditorLayer | null | undefined,
  tool: ManualToolId,
): boolean {
  if (!layer) return false;
  const isPixelTool = tool === "brush" || tool === "eraser" || tool === "blur_brush";
  return isPixelTool && layer.isVector;
}

/**
 * Explicitly rasterizes a vector layer after the user confirms "Rasterize this object?".
 */
export function rasterizeLayer(doc: ManualEditorDoc, layerId: string): ManualEditorDoc {
  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id !== layerId) return l;
      return {
        ...l,
        kind: "raster",
        isVector: false,
      };
    }),
  };
}

/**
 * Applies a pixel tool stroke (`brush`, `eraser`, or `blur_brush`) to `layerId`.
 *
 * Enforces the F13 Vector/Raster Rule:
 * If the target layer is a vector object (`layer.isVector === true`) and
 * `options?.confirmRasterize !== true`, this function DOES NOT modify or flatten the layer
 * and returns `requiresRasterizeConfirmation: true` with `promptMessage: "Rasterize this object?"`.
 */
export function applyPixelToolStroke(
  doc: ManualEditorDoc,
  layerId: string,
  strokeInput: {
    mode: "brush" | "eraser" | "blur_brush";
    points: RasterStrokePoint[];
    color?: string;
    size?: number;
    hardness?: number;
    opacity?: number;
    stabilization?: number;
  },
  options?: { confirmRasterize?: boolean },
): {
  doc: ManualEditorDoc;
  applied: boolean;
  requiresRasterizeConfirmation: boolean;
  promptMessage: string | null;
} {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.locked) {
    return {
      doc,
      applied: false,
      requiresRasterizeConfirmation: false,
      promptMessage: null,
    };
  }

  if (layer.isVector && options?.confirmRasterize !== true) {
    return {
      doc,
      applied: false,
      requiresRasterizeConfirmation: true,
      promptMessage: RASTERIZE_CONFIRMATION_MESSAGE,
    };
  }

  const stabilization = strokeInput.stabilization ?? doc.brush.stabilization;
  const smoothedPoints = stabilizePoints(strokeInput.points, stabilization);
  const stroke: RasterStroke = {
    id: nextEditorId("stroke"),
    mode: strokeInput.mode,
    points: smoothedPoints,
    color: normalizeHex(strokeInput.color ?? doc.brush.color),
    size: strokeInput.size ?? doc.brush.size,
    hardness: strokeInput.hardness ?? doc.brush.hardness,
    opacity: strokeInput.opacity ?? doc.brush.opacity,
    stabilization,
  };

  const nextDoc: ManualEditorDoc = {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id !== layerId) return l;
      return {
        ...l,
        kind: "raster",
        isVector: false,
        rasterStrokes: [...l.rasterStrokes, stroke],
      };
    }),
  };

  return {
    doc: nextDoc,
    applied: true,
    requiresRasterizeConfirmation: false,
    promptMessage: null,
  };
}

/**
 * F13 MASKING — "Mask bottom with top":
 * Pairs a bottom layer with the layer directly above it (or explicit `bottomLayerId` + `topLayerId`)
 * so that the top layer masks the bottom layer.
 */
export function maskBottomWithTop(
  doc: ManualEditorDoc,
  bottomLayerId?: string,
  topLayerId?: string,
): ManualEditorDoc {
  let bottomIdx = -1;
  let topIdx = -1;

  if (bottomLayerId && topLayerId) {
    bottomIdx = doc.layers.findIndex((l) => l.id === bottomLayerId);
    topIdx = doc.layers.findIndex((l) => l.id === topLayerId);
  } else {
    const selectedIdx = doc.layers.findIndex((l) => l.id === doc.selectedLayerId);
    if (selectedIdx >= 0) {
      if (selectedIdx > 0) {
        // Selected layer is below `selectedIdx - 1`: mask selected (bottom) with the layer above it (top)
        bottomIdx = selectedIdx;
        topIdx = selectedIdx - 1;
      } else if (doc.layers.length >= 2) {
        // Selected layer is topmost (index 0): mask the layer below it (index 1) with index 0
        topIdx = 0;
        bottomIdx = 1;
      }
    }
  }

  if (bottomIdx < 0 || topIdx < 0 || bottomIdx === topIdx) return doc;
  const bottomLayer = doc.layers[bottomIdx]!;
  const topLayer = doc.layers[topIdx]!;

  return {
    ...doc,
    layers: doc.layers.map((l) => {
      // Clear any previous mask links involving either layer first
      let maskedByLayerId =
        l.maskedByLayerId === topLayer.id || l.id === bottomLayer.id
          ? null
          : l.maskedByLayerId;
      let isMaskSourceForLayerId =
        l.isMaskSourceForLayerId === bottomLayer.id || l.id === topLayer.id
          ? null
          : l.isMaskSourceForLayerId;

      if (l.id === bottomLayer.id) {
        maskedByLayerId = topLayer.id;
      }
      if (l.id === topLayer.id) {
        isMaskSourceForLayerId = bottomLayer.id;
      }
      return {
        ...l,
        maskedByLayerId,
        isMaskSourceForLayerId,
      };
    }),
  };
}

/**
 * F13 MASKING — "Remove mask":
 * Removes the mask relationship from the specified layer (whether it is the masked bottom layer
 * or the top mask source layer).
 */
export function removeMask(doc: ManualEditorDoc, layerId?: string): ManualEditorDoc {
  const targetId = layerId ?? doc.selectedLayerId;
  if (!targetId) return doc;
  const target = doc.layers.find((l) => l.id === targetId);
  if (!target) return doc;

  const partnerId = target.maskedByLayerId ?? target.isMaskSourceForLayerId;
  if (!partnerId) return doc;

  return {
    ...doc,
    layers: doc.layers.map((l) => {
      if (l.id === target.id || l.id === partnerId) {
        return {
          ...l,
          maskedByLayerId: null,
          isMaskSourceForLayerId: null,
        };
      }
      return l;
    }),
  };
}
