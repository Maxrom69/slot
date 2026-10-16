import type { LayerDef, SceneBackground, SceneObject } from "@/lib/blueprint/types";
import type { DesignDoc } from "@/lib/design/types";

export interface SceneDoc {
  objects: SceneObject[];
  background: SceneBackground;
}

/** The slice of the blueprint the canvas editor writes. */
export interface CanvasSavePayload {
  baseRevision: number;
  sceneId: string;
  objects: SceneObject[];
  background: SceneBackground;
  layers?: LayerDef[];
  force?: boolean;
}

export interface CanvasProjectContext {
  canvas: { width: number; height: number; safeArea: { top: number; right: number; bottom: number; left: number } };
  scenes: Array<{ id: string; name: string; kind: string; layerIds: string[] }>;
  symbols: DesignDoc["symbols"];
  elements: DesignDoc["elements"];
}

export type SelectionId = string;
