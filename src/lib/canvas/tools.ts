import type { IconName } from "@/components/ui/Icon";

/**
 * Tool registry. Every tool is registered here; `available: false` means it is
 * genuinely not implemented in this phase and the UI renders it disabled with a
 * reason. Adding a later tool means adding one entry plus an interaction case.
 */
export type ToolId =
  | "select" | "pan"
  | "text"
  | "rect" | "ellipse" | "triangle"
  | "line" | "arrow" | "freehand"
  | "paint" | "eraser" | "blur" | "eyedropper";

export type ToolFamily = "navigate" | "create" | "raster";

export interface ToolDef {
  id: ToolId;
  label: string;
  shortcut: string;
  icon: IconName;
  family: ToolFamily;
  hint: string;
  available: boolean;
  unavailableReason?: string;
  /** Cursor shown over the canvas surface. */
  cursor: string;
}

export const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", shortcut: "V", icon: "pointer", family: "navigate", hint: "Select, move, resize and rotate", available: true, cursor: "default" },
  { id: "pan", label: "Pan", shortcut: "H", icon: "hand", family: "navigate", hint: "Drag to pan the canvas (or hold Space)", available: true, cursor: "grab" },
  { id: "text", label: "Text", shortcut: "T", icon: "text", family: "create", hint: "Click to place text", available: true, cursor: "text" },
  { id: "rect", label: "Rectangle", shortcut: "R", icon: "square", family: "create", hint: "Drag to draw a rectangle", available: true, cursor: "crosshair" },
  { id: "ellipse", label: "Ellipse", shortcut: "O", icon: "circle", family: "create", hint: "Drag to draw an ellipse", available: true, cursor: "crosshair" },
  { id: "triangle", label: "Triangle", shortcut: "G", icon: "triangle", family: "create", hint: "Drag to draw a triangle", available: true, cursor: "crosshair" },
  { id: "line", label: "Line", shortcut: "L", icon: "line", family: "create", hint: "Drag to draw a straight line", available: true, cursor: "crosshair" },
  { id: "arrow", label: "Arrow", shortcut: "A", icon: "arrow", family: "create", hint: "Drag to draw an arrow", available: true, cursor: "crosshair" },
  { id: "freehand", label: "Draw", shortcut: "P", icon: "pen", family: "create", hint: "Draw a freehand path", available: true, cursor: "crosshair" },
  {
    id: "paint", label: "Paint", shortcut: "B", icon: "brush", family: "create",
    hint: "Apply the current colour to an object's fill", available: true,
    cursor: "crosshair",
  },
  { id: "eraser", label: "Eraser", shortcut: "E", icon: "eraser", family: "create", hint: "Drag over objects to remove them", available: true, cursor: "crosshair" },
  { id: "blur", label: "Blur", shortcut: "U", icon: "droplet", family: "create", hint: "Click an object to soften or sharpen it", available: true, cursor: "crosshair" },
  {
    id: "eyedropper", label: "Eyedropper", shortcut: "I", icon: "pipette", family: "create",
    hint: "Sample a colour from an object or the scene background", available: true,
    cursor: "crosshair",
  },
];

/** Raster pixel editing is not part of this phase and is registered as unavailable. */
export const UNAVAILABLE_TOOLS: ToolDef[] = [
  {
    id: "paint", label: "Pixel paint", shortcut: "", icon: "brush", family: "raster",
    hint: "Pixel-level painting on artwork", available: false,
    unavailableReason: "Pixel painting needs raster editing, which is not part of this phase. Use Paint to change an object's colour.",
    cursor: "not-allowed",
  },
  {
    id: "eraser", label: "Pixel eraser", shortcut: "", icon: "eraser", family: "raster",
    hint: "Erase pixels from artwork", available: false,
    unavailableReason: "Pixel erasing needs raster editing, which is not part of this phase. Use Eraser to remove whole objects.",
    cursor: "not-allowed",
  },
  {
    id: "blur", label: "Pixel blur", shortcut: "", icon: "droplet", family: "raster",
    hint: "Blur regions of artwork", available: false,
    unavailableReason: "Pixel blurring needs raster editing, which is not part of this phase. Use Blur to soften a whole object.",
    cursor: "not-allowed",
  },
  {
    id: "eyedropper", label: "Pixel eyedropper", shortcut: "", icon: "pipette", family: "raster",
    hint: "Sample any pixel on the canvas", available: false,
    unavailableReason: "Pixel sampling is not part of this phase. Eyedropper samples object and background colours.",
    cursor: "not-allowed",
  },
];

export const toolById = (id: ToolId): ToolDef => TOOLS.find((t) => t.id === id) ?? TOOLS[0];

export const SHORTCUT_TO_TOOL: Record<string, ToolId> = Object.fromEntries(
  TOOLS.filter((t) => t.shortcut).map((t) => [t.shortcut.toLowerCase(), t.id]),
);

/** Shape-family tools create an object by dragging a box. */
export const SHAPE_TOOLS: ToolId[] = ["rect", "ellipse", "triangle", "line", "arrow"];

export const isCreateTool = (id: ToolId) => id === "text" || SHAPE_TOOLS.includes(id) || id === "freehand";
