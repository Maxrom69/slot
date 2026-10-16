/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F17 — Preview Controls domain types & SlotRuntimeAdapter boundary.
 *
 * Strictly deterministic visual preview state and presentation model.
 * No fake RNG, no simulated spin math, and no fake payout generation.
 */

import type {
  AnimationMeta,
  AssetRef,
  BlendMode,
  ElementDef,
  LayerDef,
  PaylineDef,
  SceneDef,
  SceneObject,
  SymbolDef,
} from "@/lib/blueprint/types";

export const RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE =
  "Runtime Engine Not Connected" as const;

export type RuntimeConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface RuntimeSpinRequest {
  projectId: string;
  sceneId: string;
  betAmount: number;
  blueprintVersion: number;
}

export interface RuntimeSpinResponse {
  connected: boolean;
  statusMessage: string;
  timestamp: string;
  /**
   * Intentionally null in SECTION 1 when no real SECTION 2 engine is connected.
   * SECTION 1 never fabricates spin stops, RNG outcomes, or payout results.
   */
  engineResult: null;
}

/**
 * Clean interface boundary between SECTION 1 (Frontend Preview) and
 * SECTION 2 (Backend Slot Game Engine).
 */
export interface SlotRuntimeAdapter {
  readonly id: string;
  readonly name: string;
  readonly connectionState: RuntimeConnectionState;
  isConnected(): boolean;
  getStatusMessage(): string;
  requestSpin(request: RuntimeSpinRequest): Promise<RuntimeSpinResponse>;
}

export type PreviewAnimationTrigger =
  | "idle"
  | "spin_start"
  | "reel_stop"
  | "win"
  | "big_win"
  | "feature_enter";

export interface PreviewToolbarState {
  /** Zoom factor (0.25 .. 2.5). */
  zoom: number;
  /** Whether the presentation stage is automatically fitted to the viewport container. */
  fitMode: boolean;
  /** Horizontal pan offset in pixels. */
  panX: number;
  /** Vertical pan offset in pixels. */
  panY: number;
  /** Whether fullscreen presentation mode is active. */
  fullscreen: boolean;
  /** Whether the alignment/cell grid overlay is visible. */
  showGrid: boolean;
  /** Whether safe-area, center-axis, and frame guides are visible. */
  showGuides: boolean;
}

export interface PreviewLayerAnimationControls {
  /** Show background ambient/scene animation when available. */
  showBackgroundAnimation: boolean;
  /** Show symbol win highlight/pulse animation when available. */
  showSymbolWinAnimation: boolean;
  /** Play sprite/json-animation assets as animated sprites when available. */
  playAnimationsAsSprites: boolean;
  /** Selected animation state/trigger to inspect deterministically. */
  activeAnimationTrigger: PreviewAnimationTrigger;
}

export interface PreviewAnimationCapabilities {
  hasBackgroundAnimation: boolean;
  backgroundAnimationReason: string;
  hasSymbolWinAnimation: boolean;
  symbolWinAnimationReason: string;
  hasSpriteAnimations: boolean;
  spriteAnimationsReason: string;
  registeredAnimations: AnimationMeta[];
  elementAnimations: Array<{
    elementId: string;
    elementName: string;
    preset: string;
    trigger: string;
    durationMs: number;
    loop: boolean;
  }>;
  spriteAssets: AssetRef[];
}

export interface PreviewState {
  activeSceneId: string;
  stripOffset: number;
  selectedSymbolId: string | null;
  selectedPaylineId: string | null;
  showPaylines: boolean;
  showLayerBadges: boolean;
  betIndex: number;
  /** Map of layerId -> visibility override in the preview inspector. */
  layerVisibilityOverrides: Record<string, boolean>;
  toolbar: PreviewToolbarState;
  layerAnimations: PreviewLayerAnimationControls;
  lastSpinAttempt: RuntimeSpinResponse | null;
}

export interface PreviewPresentationLayerItem {
  id: string;
  name: string;
  kind: LayerDef["kind"];
  order: number;
  blueprintVisible: boolean;
  inActiveScene: boolean;
  effectiveVisible: boolean;
  overridden: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  objectCount: number;
}

export interface PreviewPresentationCell {
  colIdx: number;
  rowIdx: number;
  cellKey: string;
  stopPosition: number;
  symbolId: string | null;
  symbol: SymbolDef | null;
  thumbnailUri: string | null;
  isWild: boolean;
  isScatter: boolean;
  isBonus: boolean;
  isSelectedSymbol: boolean;
  paylineHits: Array<{
    paylineId: string;
    paylineIndex: number;
    color: string;
  }>;
  winAnimationActive: boolean;
  spriteAnimationActive: boolean;
}

export interface PreviewPaylineOverlay {
  id: string;
  index: number;
  name: string;
  pattern: number[];
  active: boolean;
  color: string;
  selected: boolean;
  /** Normalized SVG coordinates (0..100 in both axes) across the reel grid. */
  svgPoints: string;
  nodeCoords: Array<{ colIdx: number; rowIdx: number; xPct: number; yPct: number }>;
}

export interface PreviewButtonItem {
  id: string;
  key: "spin" | "max" | "auto" | "turbo" | "bet" | "menu";
  label: string;
  primary: boolean;
}

export interface PreviewStandaloneLayerElement {
  id: string;
  name: string;
  type: ElementDef["type"];
  group: string;
  assetId: string | null;
  assetUri: string | null;
  opacity: number;
  blendMode: BlendMode;
  tintColor: string | null;
  animationPreset: string | null;
  animationActive: boolean;
}

export interface PreviewPresentationModel {
  projectId: string;
  projectTitle: string;
  theme: string;
  styleGuide: string;
  canvas: {
    width: number;
    height: number;
    orientation: "landscape" | "portrait" | "responsive";
    safeArea: { top: number; right: number; bottom: number; left: number };
    backgroundColor: string;
    surfaceColor: string;
    accentColor: string;
    accentAltColor: string;
    glowColor: string;
    textColor: string;
    backgroundGradient: string;
    backgroundAssetUri: string | null;
  };
  activeScene: {
    id: string;
    name: string;
    kind: SceneDef["kind"];
    entryTransition: string;
    layerIds: string[];
    objectCount: number;
  };
  scenes: Array<{
    id: string;
    name: string;
    kind: SceneDef["kind"];
    entryTransition: string;
    layerCount: number;
    objectCount: number;
    active: boolean;
  }>;
  layers: PreviewPresentationLayerItem[];
  stage: {
    background: {
      visible: boolean;
      opacity: number;
      blendMode: BlendMode;
      assetUri: string | null;
      elementName: string;
      animationActive: boolean;
    };
    reelFrame: {
      visible: boolean;
      opacity: number;
      blendMode: BlendMode;
      frameStyle: "ornate" | "minimal" | "cabinet" | "themed";
      assetUri: string | null;
      elementName: string;
    };
    reelArea: {
      visible: boolean;
      opacity: number;
      blendMode: BlendMode;
      columns: number;
      rows: number;
      evaluation: "lines" | "ways" | "cluster";
      spinDirection: "down" | "up";
      stripOffset: number;
      maxStripLength: number;
      cells: PreviewPresentationCell[][];
    };
    buttons: {
      visible: boolean;
      opacity: number;
      blendMode: BlendMode;
      elementName: string;
      assetUri: string | null;
      items: PreviewButtonItem[];
      activeBet: number;
      betLevels: number[];
    };
    overlays: {
      fxVisible: boolean;
      fxOpacity: number;
      showGrid: boolean;
      showGuides: boolean;
      showPaylines: boolean;
      paylines: PreviewPaylineOverlay[];
      activeAnimationTrigger: PreviewAnimationTrigger;
      matchingAnimations: AnimationMeta[];
    };
    standaloneLayers: {
      titleElement: PreviewStandaloneLayerElement | null;
      standaloneElements: PreviewStandaloneLayerElement[];
      sceneObjects: SceneObject[];
    };
  };
  animationCapabilities: PreviewAnimationCapabilities;
  runtime: {
    adapterId: string;
    adapterName: string;
    connectionState: RuntimeConnectionState;
    connected: boolean;
    statusMessage: string;
    lastSpinAttempt: RuntimeSpinResponse | null;
  };
}
