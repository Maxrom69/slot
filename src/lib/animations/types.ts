import type {
  AnimationConfigState,
  AnimationFormat,
  AnimationMeta,
  AnimationSource,
  SpriteSheetAnimationReference,
  StudioAnimationType,
  VideoAnimationReference,
} from "@/lib/blueprint/types";

export type {
  StudioAnimationType,
  AnimationSource,
  AnimationFormat,
  AnimationConfigState,
  VideoAnimationReference,
  SpriteSheetAnimationReference,
};

export const STUDIO_ANIMATION_TYPES: readonly StudioAnimationType[] = [
  "Background",
  "Symbol Win",
  "Standalone",
  "Hover",
  "Custom",
] as const;

export const ANIMATION_SOURCES: readonly AnimationSource[] = [
  "preset",
  "video",
  "sprite_sheet",
  "custom",
] as const;

export const ANIMATION_FORMATS: readonly AnimationFormat[] = [
  "css",
  "mp4",
  "webm",
  "sprite-sheet",
  "webp",
  "gif",
  "json-animation",
] as const;

export const ANIMATION_STATES: readonly AnimationConfigState[] = [
  "enabled",
  "disabled",
] as const;

/**
 * F18 Canonical Animation Model.
 * Contains all 12 required F18 model fields (`id`, `elementId`, `name`, `source`,
 * `format`, `duration`, `loop`, `fps`, `thumbnail`, `videoReference`,
 * `spriteSheetReference`, `state`) plus `animationType`, `animationExtra`,
 * and the `AnimationMeta` serialization fields (`target`, `trigger`, `kind`,
 * `durationMs`, `easing`).
 */
export interface AnimationModel extends AnimationMeta {
  id: string;
  elementId: string;
  name: string;
  animationType: StudioAnimationType;
  source: AnimationSource;
  format: AnimationFormat;
  duration: number;
  loop: boolean;
  fps: number;
  thumbnail: string | null;
  videoReference: VideoAnimationReference | null;
  spriteSheetReference: SpriteSheetAnimationReference | null;
  state: AnimationConfigState;
  animationExtra: string;
  target: string;
  trigger: "spin_start" | "reel_stop" | "win" | "big_win" | "feature_enter";
  kind: string;
  durationMs: number;
  easing: string;
}

export type AnimationPlaybackStatus = "playing" | "paused" | "stopped";

export interface AnimationPlaybackState {
  animationId: string;
  status: AnimationPlaybackStatus;
  isPlaying: boolean;
  isPaused: boolean;
  loop: boolean;
  duration: number;
  fps: number;
  elapsedMs: number;
  progress: number;
  currentFrame: number;
  totalFrames: number;
  cycleCount: number;
}

export interface SpriteFrameRect {
  frameIndex: number;
  column: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  sheetWidth: number;
  sheetHeight: number;
}

export interface CreateAnimationInput {
  id?: string;
  elementId: string;
  name?: string;
  animationType?: StudioAnimationType;
  source?: AnimationSource;
  format?: AnimationFormat;
  duration?: number;
  durationMs?: number;
  loop?: boolean;
  fps?: number;
  thumbnail?: string | null;
  videoReference?: Partial<VideoAnimationReference> | null;
  spriteSheetReference?: Partial<SpriteSheetAnimationReference> | null;
  state?: AnimationConfigState;
  animationExtra?: string;
  target?: string;
  trigger?: AnimationMeta["trigger"];
  kind?: string;
  easing?: string;
}

export interface UpdateAnimationInput {
  elementId?: string;
  name?: string;
  animationType?: StudioAnimationType;
  source?: AnimationSource;
  format?: AnimationFormat;
  duration?: number;
  durationMs?: number;
  loop?: boolean;
  fps?: number;
  thumbnail?: string | null;
  videoReference?: Partial<VideoAnimationReference> | null;
  spriteSheetReference?: Partial<SpriteSheetAnimationReference> | null;
  state?: AnimationConfigState;
  animationExtra?: string;
  target?: string;
  trigger?: AnimationMeta["trigger"];
  kind?: string;
  easing?: string;
}

export interface StandaloneAnimationLayerInput {
  sceneId?: string;
  layerId?: string;
  createDedicatedLayer?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  visible?: boolean;
  locked?: boolean;
}
