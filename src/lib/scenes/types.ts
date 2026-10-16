/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F19 — SCENES AND LAYOUT COMPOSITION
 *
 * Typed domain model for multi-scene layout composition (up to 3 scenes),
 * independent per-scene layout storage, shared global game configuration,
 * scene selector cards (Scene 1, Scene 2, Scene 3), 18-character rename limit,
 * and per-scene unsaved state tracking with Save / Discard / Cancel switch resolution.
 */

import type {
  GameBlueprint,
  LayerDef,
  SceneBackground,
  SceneCanvasConfiguration,
  SceneComposedImageRef,
  SceneDef,
  SceneLayoutMetadata,
  SceneObject,
  SceneVisibilityState,
} from "@/lib/blueprint/types";

export type {
  SceneBackground,
  SceneCanvasConfiguration,
  SceneComposedImageRef,
  SceneDef,
  SceneLayoutMetadata,
  SceneObject,
  SceneVisibilityState,
};

export const MAX_SCENES = 3 as const;
export const MIN_SCENES = 1 as const;
export const MAX_SCENE_NAME_LENGTH = 18 as const;

export const SCENE_SLOT_LABELS = ["Scene 1", "Scene 2", "Scene 3"] as const;
export type SceneSlotLabel = (typeof SCENE_SLOT_LABELS)[number];

/**
 * Normalized F19 Scene model containing all required F19 fields:
 * - id
 * - name (max 18 chars)
 * - canvasConfiguration
 * - background
 * - layers
 * - visibility
 * - composedImages
 * - layoutMetadata
 */
export interface SceneModel {
  id: string;
  name: string;
  kind: SceneDef["kind"];
  entryTransition: string;
  canvasConfiguration: SceneCanvasConfiguration;
  background: SceneBackground;
  layers: LayerDef[];
  layerIds: string[];
  objects: SceneObject[];
  visibility: SceneVisibilityState;
  composedImages: SceneComposedImageRef[];
  layoutMetadata: SceneLayoutMetadata;
}

/**
 * Shared global game configuration preserved across all scene switches and saves:
 * - reels
 * - math configuration
 * - symbol definitions
 */
export interface SceneSharedGlobalConfig {
  reels: GameBlueprint["reels"];
  reelConfiguration?: GameBlueprint["reelConfiguration"];
  math: GameBlueprint["math"];
  symbols: GameBlueprint["symbols"];
  symbolSets: GameBlueprint["symbolSets"];
  specialSymbols: GameBlueprint["specialSymbols"];
  paylines: GameBlueprint["paylines"];
  paytable: GameBlueprint["paytable"];
}

/**
 * Independent layout snapshot stored per scene:
 * - positions (x, y on objects & composedImages)
 * - sizes (width, height on objects, composedImages, canvasConfiguration)
 * - rotation (degrees on objects & composedImages)
 * - layer order (layers order & objects stacking order)
 * - visibility (scene, layer, and object visibility)
 * - background selection (color, assetId, imageUri, fit)
 * - composed image references (composedImages)
 */
export interface SceneLayoutSnapshot {
  sceneId: string;
  name: string;
  canvasConfiguration: SceneCanvasConfiguration;
  background: SceneBackground;
  layers: LayerDef[];
  layerIds: string[];
  objects: SceneObject[];
  visibility: SceneVisibilityState;
  composedImages: SceneComposedImageRef[];
  layoutMetadata: SceneLayoutMetadata;
}

/**
 * Per-scene unsaved state tracking record.
 */
export interface PerSceneDraftRecord {
  sceneId: string;
  saved: SceneLayoutSnapshot;
  draft: SceneLayoutSnapshot;
  isDirty: boolean;
  lastModifiedAt: string | null;
}

/**
 * Prompt state surfaced when switching away from a scene that has unsaved changes.
 */
export interface PendingSceneSwitchPrompt {
  fromSceneId: string;
  toSceneId: string;
  fromSceneName: string;
  toSceneName: string;
}

export type UnsavedSwitchResolution = "save" | "discard" | "cancel";

/**
 * View model for a Scene Selector card ("Scene 1", "Scene 2", "Scene 3").
 */
export interface SceneSelectorCardModel {
  slotIndex: 1 | 2 | 3;
  slotLabel: SceneSlotLabel;
  occupied: boolean;
  sceneId: string | null;
  name: string;
  kind: SceneDef["kind"] | null;
  active: boolean;
  isDirty: boolean;
  objectCount: number;
  layerCount: number;
  visibleLayerCount: number;
  composedImageCount: number;
  backgroundColor: string | null;
  backgroundAssetId: string | null;
}

/**
 * Full F19 Scene & Layout Composition workspace state.
 */
export interface SceneCompositionWorkspaceState {
  activeSceneId: string;
  scenes: SceneModel[];
  draftsBySceneId: Record<string, PerSceneDraftRecord>;
  pendingSceneSwitch: PendingSceneSwitchPrompt | null;
  sharedGlobalConfig: SceneSharedGlobalConfig;
}
