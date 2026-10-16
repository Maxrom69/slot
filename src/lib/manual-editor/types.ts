import type { IconName } from "@/components/ui/Icon";
import type { BlendMode } from "@/lib/blueprint/types";

export type ManualToolId =
  | "select"
  | "brush"
  | "eraser"
  | "blur_brush"
  | "freehand"
  | "eyedropper"
  | "text"
  | "shapes"
  | "line_arrow";

export interface ManualToolDef {
  id: ManualToolId;
  label: string;
  shortcut: string;
  icon: IconName;
  requiresRaster: boolean;
  cursor: string;
  description: string;
}

export const MANUAL_TOOLS: ManualToolDef[] = [
  {
    id: "select",
    label: "Select / Move",
    shortcut: "V",
    icon: "pointer",
    requiresRaster: false,
    cursor: "default",
    description: "Select, move, and transform layers on the canvas (V)",
  },
  {
    id: "brush",
    label: "Paint Brush",
    shortcut: "B",
    icon: "brush",
    requiresRaster: true,
    cursor: "crosshair",
    description: "Paint strokes with configurable size, hardness, opacity, and stabilization (B)",
  },
  {
    id: "eraser",
    label: "Eraser",
    shortcut: "E",
    icon: "eraser",
    requiresRaster: true,
    cursor: "crosshair",
    description: "Erase pixels on a raster layer (E)",
  },
  {
    id: "blur_brush",
    label: "Blur Brush",
    shortcut: "U",
    icon: "droplet",
    requiresRaster: true,
    cursor: "crosshair",
    description: "Soften pixels along brush strokes on a raster layer (U)",
  },
  {
    id: "freehand",
    label: "Freehand Draw",
    shortcut: "P",
    icon: "pen",
    requiresRaster: false,
    cursor: "crosshair",
    description: "Draw smooth vector freehand paths (P)",
  },
  {
    id: "eyedropper",
    label: "Eyedropper",
    shortcut: "I",
    icon: "pipette",
    requiresRaster: false,
    cursor: "crosshair",
    description: "Sample color from any layer on the canvas (I)",
  },
  {
    id: "text",
    label: "Text",
    shortcut: "T",
    icon: "text",
    requiresRaster: false,
    cursor: "text",
    description: "Create editable vector text layers (T)",
  },
  {
    id: "shapes",
    label: "Shapes",
    shortcut: "R",
    icon: "square",
    requiresRaster: false,
    cursor: "crosshair",
    description: "Create vector rectangles, ellipses, triangles, and polygons (R)",
  },
  {
    id: "line_arrow",
    label: "Lines / Arrows",
    shortcut: "L",
    icon: "arrow",
    requiresRaster: false,
    cursor: "crosshair",
    description: "Create vector straight lines and directional arrows (L)",
  },
];

export const MANUAL_SHORTCUT_TO_TOOL: Record<string, ManualToolId> = Object.fromEntries(
  MANUAL_TOOLS.filter((t) => t.shortcut).map((t) => [t.shortcut.toLowerCase(), t.id]),
);

export type EditorBlendMode = BlendMode;

export const DOCUMENTED_BLEND_MODES: { id: EditorBlendMode; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "multiply", label: "Multiply" },
  { id: "screen", label: "Screen" },
  { id: "overlay", label: "Overlay" },
  { id: "darken", label: "Darken" },
  { id: "lighten", label: "Lighten" },
  { id: "color-dodge", label: "Color Dodge" },
  { id: "color-burn", label: "Color Burn" },
  { id: "hard-light", label: "Hard Light" },
  { id: "soft-light", label: "Soft Light" },
  { id: "difference", label: "Difference" },
  { id: "exclusion", label: "Exclusion" },
];

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface TwoStopGradient {
  enabled: boolean;
  startColor: string;
  endColor: string;
  startStop: number; // 0..100
  endStop: number;   // 0..100
  angle: number;     // 0..360
}

export interface ColorState {
  hex: string;
  rgba: RGBA;
  recentSwatches: string[];
  gradient: TwoStopGradient;
}

export interface BrushSettings {
  color: string;
  size: number;          // 1..200 px
  hardness: number;      // 0..100 %
  opacity: number;       // 0..1
  stabilization: number; // 0..100 %
}

export type TextAlignment = "left" | "center" | "right";
export type TextFontStyle = "normal" | "italic";

export interface TextLayerProps {
  text: string;
  font: string;
  weight: number;
  style: TextFontStyle;
  alignment: TextAlignment;
  size: number;
  fill: string;
  gradient: TwoStopGradient;
  outlineColor: string;
  outlineWidth: number;
  letterSpacing: number;
  lineHeight: number;
}

export type ShapeKind = "rect" | "rounded_rect" | "ellipse" | "triangle" | "polygon";

export interface ShapeLayerProps {
  shapeKind: ShapeKind;
  fill: string;
  gradient: TwoStopGradient;
  stroke: string;
  width: number;         // stroke width
  cornerRadius: number;  // 0..120 px
  polygonPoints: number; // 3..12 points
  arrowStart?: boolean;
  arrowEnd?: boolean;
}

export interface LayerAdjustments {
  brightness: number; // -100..100
  contrast: number;   // -100..100
  saturation: number; // -100..100
  vibrance: number;   // -100..100
  hue: number;        // -180..180
  blur: number;       // 0..50
  tintColor: string;  // hex
  tintAmount: number; // 0..100
  sharpen: number;    // 0..100
  grayscale: number;  // 0..100
  invert: number;     // 0..100
}

export interface DropShadowEffect {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface RasterStrokePoint {
  x: number;
  y: number;
}

export interface RasterStroke {
  id: string;
  mode: "brush" | "eraser" | "blur_brush";
  points: RasterStrokePoint[];
  color: string;
  size: number;
  hardness: number;
  opacity: number;
  stabilization: number;
}

export type EditorLayerKind =
  | "raster"
  | "vector_text"
  | "vector_shape"
  | "vector_line"
  | "vector_freehand"
  | "vector_svg";

export interface EditorLayer {
  id: string;
  name: string;
  kind: EditorLayerKind;
  isVector: boolean;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: EditorBlendMode;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  adjustments: LayerAdjustments;
  dropShadow: DropShadowEffect;
  /** ID of the top layer that masks this bottom layer ("Mask bottom with top"). */
  maskedByLayerId: string | null;
  /** ID of the bottom layer that this layer acts as a mask for. */
  isMaskSourceForLayerId: string | null;
  /** Source artwork URI when backed by an existing image/SVG. */
  imageUri?: string | null;
  /** Recorded pixel brush/eraser/blur strokes on this layer (only once raster). */
  rasterStrokes: RasterStroke[];
  /** Vector freehand points when kind === "vector_freehand". */
  freehandPoints?: RasterStrokePoint[];
  freehandBrush?: BrushSettings;
  /** Vector text properties when kind === "vector_text". */
  textProps?: TextLayerProps;
  /** Vector shape / line properties when kind === "vector_shape" | "vector_line". */
  shapeProps?: ShapeLayerProps;
}

export interface ManualEditorDoc {
  width: number;
  height: number;
  layers: EditorLayer[];
  selectedLayerId: string | null;
  activeTool: ManualToolId;
  brush: BrushSettings;
  color: ColorState;
  zoom: number;
  fullscreen: boolean;
}

export const RASTERIZE_CONFIRMATION_MESSAGE = "Rasterize this object?";
