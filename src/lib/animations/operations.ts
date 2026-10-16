import type {
  AnimationConfigState,
  AnimationFormat,
  AnimationMeta,
  AnimationSource,
  AssetRef,
  ElementAnimationConfig,
  ElementDef,
  ElementType,
  GameBlueprint,
  LayerDef,
  SceneObject,
  SpriteSheetAnimationReference,
  StudioAnimationType,
  VideoAnimationReference,
} from "@/lib/blueprint/types";
import { moveObjects, patchObject, reorderLayerItem, reorderObjects } from "@/lib/canvas/operations";
import { finalizeDoc, uniqueId } from "@/lib/design/model";
import type { DesignDoc } from "@/lib/design/types";
import {
  ANIMATION_FORMATS,
  ANIMATION_SOURCES,
  ANIMATION_STATES,
  STUDIO_ANIMATION_TYPES,
  type AnimationModel,
  type AnimationPlaybackState,
  type CreateAnimationInput,
  type SpriteFrameRect,
  type StandaloneAnimationLayerInput,
  type UpdateAnimationInput,
} from "./types";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

export function defaultTriggerForAnimationType(
  animationType: StudioAnimationType,
): AnimationMeta["trigger"] {
  switch (animationType) {
    case "Background":
      return "spin_start";
    case "Symbol Win":
      return "win";
    case "Standalone":
      return "feature_enter";
    case "Hover":
      return "reel_stop";
    case "Custom":
    default:
      return "win";
  }
}

export function defaultPresetForAnimationType(
  animationType: StudioAnimationType,
): ElementAnimationConfig["preset"] {
  switch (animationType) {
    case "Background":
      return "float";
    case "Symbol Win":
      return "win_pop";
    case "Standalone":
      return "idle_pulse";
    case "Hover":
      return "spin_glow";
    case "Custom":
    default:
      return "custom";
  }
}

export function defaultDurationForAnimationType(
  animationType: StudioAnimationType,
): number {
  switch (animationType) {
    case "Background":
      return 2400;
    case "Symbol Win":
      return 800;
    case "Standalone":
      return 1200;
    case "Hover":
      return 400;
    case "Custom":
    default:
      return 600;
  }
}

export function defaultLoopForAnimationType(
  animationType: StudioAnimationType,
): boolean {
  return animationType === "Background" || animationType === "Standalone";
}

export function defaultFpsForAnimationType(
  animationType: StudioAnimationType,
): number {
  switch (animationType) {
    case "Hover":
      return 60;
    case "Symbol Win":
      return 30;
    case "Background":
    case "Standalone":
    case "Custom":
    default:
      return 24;
  }
}

export function inferAnimationType(
  anim: Partial<AnimationMeta>,
  elementType?: ElementType,
): StudioAnimationType {
  if (anim.animationType && (STUDIO_ANIMATION_TYPES as readonly string[]).includes(anim.animationType)) {
    return anim.animationType;
  }
  if (elementType === "game_background" || anim.target === "layer-bg" || anim.target === "background") {
    return "Background";
  }
  if (elementType === "symbol" || elementType === "symbol_set" || anim.trigger === "win" || anim.trigger === "big_win") {
    return "Symbol Win";
  }
  if (elementType === "button_set" || anim.trigger === "reel_stop") {
    return "Hover";
  }
  if (anim.elementId === "standalone" || anim.target === "standalone" || anim.target === "layer-fx") {
    return "Standalone";
  }
  return "Custom";
}

export function defaultFormatForSource(source: AnimationSource): AnimationFormat {
  switch (source) {
    case "video":
      return "mp4";
    case "sprite_sheet":
      return "sprite-sheet";
    case "custom":
      return "json-animation";
    case "preset":
    default:
      return "css";
  }
}

export function normalizeVideoReference(
  raw: Partial<VideoAnimationReference> | null | undefined,
  assets?: AssetRef[],
): VideoAnimationReference | null {
  if (!raw || typeof raw !== "object") return null;
  const assetId = typeof raw.assetId === "string" && raw.assetId.trim() ? raw.assetId.trim() : null;
  const linkedAsset = assetId && assets ? assets.find((a) => a.id === assetId) : null;
  const uri =
    typeof raw.uri === "string" && raw.uri.trim()
      ? raw.uri.trim().slice(0, 500)
      : linkedAsset?.uri ?? null;
  return {
    assetId,
    uri,
    mimeType: typeof raw.mimeType === "string" && raw.mimeType.trim() ? raw.mimeType.trim().slice(0, 80) : linkedAsset?.mime ?? "video/mp4",
    width: typeof raw.width === "number" && Number.isFinite(raw.width) ? clamp(Math.round(raw.width), 1, 8192) : (linkedAsset?.width ?? 512),
    height: typeof raw.height === "number" && Number.isFinite(raw.height) ? clamp(Math.round(raw.height), 1, 8192) : (linkedAsset?.height ?? 512),
    playbackRate: typeof raw.playbackRate === "number" && Number.isFinite(raw.playbackRate) ? clamp(raw.playbackRate, 0.1, 4) : 1,
    muted: typeof raw.muted === "boolean" ? raw.muted : true,
  };
}

export function normalizeSpriteSheetReference(
  raw: Partial<SpriteSheetAnimationReference> | null | undefined,
  assets?: AssetRef[],
): SpriteSheetAnimationReference | null {
  if (!raw || typeof raw !== "object") return null;
  const assetId = typeof raw.assetId === "string" && raw.assetId.trim() ? raw.assetId.trim() : null;
  const linkedAsset = assetId && assets ? assets.find((a) => a.id === assetId) : null;
  const uri =
    typeof raw.uri === "string" && raw.uri.trim()
      ? raw.uri.trim().slice(0, 500)
      : linkedAsset?.uri ?? null;
  const columns = typeof raw.columns === "number" && Number.isFinite(raw.columns) ? clamp(Math.round(raw.columns), 1, 128) : 4;
  const rows = typeof raw.rows === "number" && Number.isFinite(raw.rows) ? clamp(Math.round(raw.rows), 1, 128) : 4;
  const maxFrames = columns * rows;
  const frameCount = typeof raw.frameCount === "number" && Number.isFinite(raw.frameCount)
    ? clamp(Math.round(raw.frameCount), 1, maxFrames)
    : maxFrames;
  const frameWidth = typeof raw.frameWidth === "number" && Number.isFinite(raw.frameWidth)
    ? clamp(Math.round(raw.frameWidth), 1, 4096)
    : 128;
  const frameHeight = typeof raw.frameHeight === "number" && Number.isFinite(raw.frameHeight)
    ? clamp(Math.round(raw.frameHeight), 1, 4096)
    : 128;
  const startFrame = typeof raw.startFrame === "number" && Number.isFinite(raw.startFrame)
    ? clamp(Math.round(raw.startFrame), 0, frameCount - 1)
    : 0;
  const endFrame = typeof raw.endFrame === "number" && Number.isFinite(raw.endFrame)
    ? clamp(Math.round(raw.endFrame), startFrame, frameCount - 1)
    : frameCount - 1;
  const spacing = typeof raw.spacing === "number" && Number.isFinite(raw.spacing) ? clamp(Math.round(raw.spacing), 0, 256) : 0;
  const margin = typeof raw.margin === "number" && Number.isFinite(raw.margin) ? clamp(Math.round(raw.margin), 0, 256) : 0;

  return {
    assetId,
    uri,
    columns,
    rows,
    frameWidth,
    frameHeight,
    frameCount,
    startFrame,
    endFrame,
    spacing,
    margin,
  };
}

export function normalizeAnimationModel(
  raw: AnimationMeta,
  elements?: ElementDef[],
  assets?: AssetRef[],
): AnimationModel {
  const matchedElement = elements?.find(
    (el) =>
      el.id === raw.elementId ||
      el.id === raw.target ||
      el.symbolIds.includes(raw.target),
  );
  const elementId =
    typeof raw.elementId === "string" && raw.elementId.trim()
      ? raw.elementId.trim()
      : matchedElement?.id ?? (raw.target || "standalone");
  const animationType = inferAnimationType(raw, matchedElement?.type);
  const source: AnimationSource =
    raw.source && (ANIMATION_SOURCES as readonly string[]).includes(raw.source)
      ? raw.source
      : raw.spriteSheetReference
        ? "sprite_sheet"
        : raw.videoReference
          ? "video"
          : "preset";
  const format: AnimationFormat =
    raw.format && (ANIMATION_FORMATS as readonly string[]).includes(raw.format)
      ? raw.format
      : defaultFormatForSource(source);
  const rawDuration =
    typeof raw.duration === "number" && Number.isFinite(raw.duration)
      ? raw.duration
      : typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs)
        ? raw.durationMs
        : defaultDurationForAnimationType(animationType);
  const duration = clamp(Math.round(rawDuration), 0, 60_000);
  const loop =
    typeof raw.loop === "boolean"
      ? raw.loop
      : matchedElement?.animation?.loop ?? defaultLoopForAnimationType(animationType);
  const fps =
    typeof raw.fps === "number" && Number.isFinite(raw.fps)
      ? clamp(Math.round(raw.fps), 1, 240)
      : defaultFpsForAnimationType(animationType);
  const videoReference = normalizeVideoReference(raw.videoReference, assets);
  const spriteSheetReference = normalizeSpriteSheetReference(raw.spriteSheetReference, assets);
  const resolvedThumbAsset =
    matchedElement?.assetId && assets
      ? assets.find((a) => a.id === matchedElement.assetId)?.uri ?? null
      : null;
  const thumbnail =
    raw.thumbnail !== undefined
      ? raw.thumbnail
      : spriteSheetReference?.uri ?? videoReference?.uri ?? resolvedThumbAsset ?? null;
  const state: AnimationConfigState =
    raw.state && (ANIMATION_STATES as readonly string[]).includes(raw.state)
      ? raw.state
      : "enabled";
  const name =
    typeof raw.name === "string" && raw.name.trim()
      ? raw.name.trim().slice(0, 80)
      : raw.kind
        ? `${matchedElement ? `${matchedElement.name} ` : ""}${raw.kind}`.slice(0, 80)
        : `${animationType} Animation`;
  const target =
    typeof raw.target === "string" && raw.target.trim()
      ? raw.target.trim()
      : matchedElement
        ? matchedElement.type === "symbol" && matchedElement.symbolIds[0]
          ? matchedElement.symbolIds[0]
          : matchedElement.id
        : elementId || "standalone";
  const trigger = raw.trigger ?? defaultTriggerForAnimationType(animationType);
  const kind =
    typeof raw.kind === "string" && raw.kind.trim()
      ? raw.kind.trim().slice(0, 64)
      : defaultPresetForAnimationType(animationType);
  const easing =
    typeof raw.easing === "string" && raw.easing.trim()
      ? raw.easing.trim().slice(0, 64)
      : "ease-out";
  const animationExtra =
    typeof raw.animationExtra === "string"
      ? raw.animationExtra.slice(0, 800)
      : "";

  return {
    id: raw.id,
    elementId,
    name,
    animationType,
    source,
    format,
    duration,
    loop,
    fps,
    thumbnail,
    videoReference,
    spriteSheetReference,
    state,
    animationExtra,
    target,
    trigger,
    kind,
    durationMs: duration,
    easing,
  };
}

/**
 * Returns all animations associated with a specific element (by `elementId`, `target`, or owned `symbolIds`).
 */
export function getElementAnimations(
  docOrBp: { animations?: AnimationMeta[]; elements?: ElementDef[]; assets?: AssetRef[] },
  elementId: string,
): AnimationModel[] {
  const elements = docOrBp.elements ?? [];
  const assets = docOrBp.assets ?? [];
  const element = elements.find((e) => e.id === elementId);
  const matchTargets = new Set<string>([elementId, ...(element?.symbolIds ?? [])]);
  return (docOrBp.animations ?? [])
    .filter((a) => a.elementId === elementId || matchTargets.has(a.target))
    .map((a) => normalizeAnimationModel(a, elements, assets));
}

/**
 * Returns all normalized AnimationModel definitions in the document or blueprint.
 */
export function getAllAnimations(
  docOrBp: { animations?: AnimationMeta[]; elements?: ElementDef[]; assets?: AssetRef[] },
): AnimationModel[] {
  const elements = docOrBp.elements ?? [];
  const assets = docOrBp.assets ?? [];
  return (docOrBp.animations ?? []).map((a) => normalizeAnimationModel(a, elements, assets));
}

/**
 * Synchronizes an element's primary `element.animation` summary with its active `AnimationModel` entries.
 */
function syncElementPrimaryAnimation(
  elements: ElementDef[],
  animations: AnimationMeta[],
  elementId: string,
): ElementDef[] {
  const element = elements.find((e) => e.id === elementId);
  if (!element) return elements;
  const elementAnims = getElementAnimations({ animations, elements }, elementId);
  const active = elementAnims.find((a) => a.state === "enabled") ?? elementAnims[0];
  if (!active) {
    return elements.map((el) =>
      el.id === elementId && el.animation
        ? {
            ...el,
            animation: {
              ...el.animation,
              preset: "none",
            },
          }
        : el,
    );
  }
  const preset = (["none", "idle_pulse", "float", "spin_glow", "win_pop", "custom"] as const).includes(
    active.kind as ElementAnimationConfig["preset"],
  )
    ? (active.kind as ElementAnimationConfig["preset"])
    : defaultPresetForAnimationType(active.animationType);
  return elements.map((el) =>
    el.id === elementId
      ? {
          ...el,
          animation: {
            preset: active.state === "enabled" ? preset : "none",
            trigger: active.trigger,
            durationMs: active.duration,
            easing: active.easing,
            loop: active.loop,
          },
        }
      : el,
  );
}

/**
 * Updates the per-element `Animation Extra` configuration field.
 */
export function setElementAnimationExtra(
  doc: DesignDoc,
  elementId: string,
  animationExtra: string,
): DesignDoc {
  if (!doc.elements.some((e) => e.id === elementId)) return doc;
  const cleaned = animationExtra.slice(0, 800);
  return finalizeDoc({
    ...doc,
    elements: doc.elements.map((el) =>
      el.id === elementId ? { ...el, animationExtra: cleaned } : el,
    ),
  });
}

/**
 * Adds a new F18 AnimationModel to `doc.animations` for an element (or standalone).
 */
export function addElementAnimation(
  doc: DesignDoc,
  input: CreateAnimationInput,
): { doc: DesignDoc; animation: AnimationModel; id: string } {
  const current = doc.animations ?? [];
  const taken = new Set(current.map((a) => a.id));
  const element = doc.elements.find((e) => e.id === input.elementId);
  const rawElementId = element?.id ?? (input.elementId.trim() || "standalone");
  const animationType: StudioAnimationType =
    input.animationType && (STUDIO_ANIMATION_TYPES as readonly string[]).includes(input.animationType)
      ? input.animationType
      : inferAnimationType({ elementId: rawElementId, trigger: input.trigger }, element?.type);
  const source: AnimationSource =
    input.source && (ANIMATION_SOURCES as readonly string[]).includes(input.source)
      ? input.source
      : input.spriteSheetReference
        ? "sprite_sheet"
        : input.videoReference
          ? "video"
          : "preset";
  const format: AnimationFormat =
    input.format && (ANIMATION_FORMATS as readonly string[]).includes(input.format)
      ? input.format
      : defaultFormatForSource(source);
  const duration = clamp(
    Math.round(
      input.duration ??
        input.durationMs ??
        element?.animation?.durationMs ??
        defaultDurationForAnimationType(animationType),
    ),
    0,
    60_000,
  );
  const loop =
    typeof input.loop === "boolean"
      ? input.loop
      : element?.animation?.loop ?? defaultLoopForAnimationType(animationType);
  const fps = clamp(
    Math.round(input.fps ?? defaultFpsForAnimationType(animationType)),
    1,
    240,
  );
  const id =
    input.id && !taken.has(input.id)
      ? input.id
      : uniqueId(`anim-${rawElementId.replace(/[^A-Za-z0-9_-]/g, "-")}`, taken);
  const defaultName = element
    ? `${element.name} ${animationType}`
    : `${animationType} Animation`;
  const name = (input.name?.trim() || defaultName).slice(0, 80);
  const target =
    input.target?.trim() ||
    (element
      ? element.type === "symbol" && element.symbolIds[0]
        ? element.symbolIds[0]
        : element.id
      : rawElementId);
  const trigger = input.trigger ?? defaultTriggerForAnimationType(animationType);
  const kind = (input.kind?.trim() || defaultPresetForAnimationType(animationType)).slice(0, 64);
  const easing = (input.easing?.trim() || element?.animation?.easing || "ease-out").slice(0, 64);
  const videoReference =
    input.videoReference !== undefined
      ? normalizeVideoReference(input.videoReference, doc.assets)
      : source === "video"
        ? normalizeVideoReference({ uri: null, mimeType: "video/mp4" }, doc.assets)
        : null;
  const spriteSheetReference =
    input.spriteSheetReference !== undefined
      ? normalizeSpriteSheetReference(input.spriteSheetReference, doc.assets)
      : source === "sprite_sheet"
        ? normalizeSpriteSheetReference({ uri: null, columns: 4, rows: 4, frameWidth: 128, frameHeight: 128, frameCount: 16 }, doc.assets)
        : null;

  const animation = normalizeAnimationModel(
    {
      id,
      elementId: rawElementId,
      name,
      animationType,
      source,
      format,
      duration,
      loop,
      fps,
      thumbnail: input.thumbnail ?? null,
      videoReference,
      spriteSheetReference,
      state: input.state ?? "enabled",
      animationExtra: input.animationExtra ?? element?.animationExtra ?? "",
      target,
      trigger,
      kind,
      durationMs: duration,
      easing,
    },
    doc.elements,
    doc.assets,
  );

  const nextAnimations = [...current, animation];
  const nextElements = element
    ? syncElementPrimaryAnimation(doc.elements, nextAnimations, element.id)
    : doc.elements;

  return {
    id: animation.id,
    animation,
    doc: finalizeDoc({
      ...doc,
      elements: nextElements,
      animations: nextAnimations,
    }),
  };
}

/**
 * Renames an existing animation in `doc.animations` and updates any standalone scene layer referencing it.
 */
export function renameElementAnimation(
  doc: DesignDoc,
  animationId: string,
  name: string,
): DesignDoc {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed) return doc;
  return updateElementAnimation(doc, animationId, { name: trimmed });
}

/**
 * Toggles an animation's state between `"enabled"` and `"disabled"`.
 */
export function toggleElementAnimationState(
  doc: DesignDoc,
  animationId: string,
  enabled?: boolean,
): DesignDoc {
  const existing = (doc.animations ?? []).find((a) => a.id === animationId);
  if (!existing) return doc;
  const currentNorm = normalizeAnimationModel(existing, doc.elements, doc.assets);
  const nextState: AnimationConfigState =
    enabled !== undefined
      ? enabled
        ? "enabled"
        : "disabled"
      : currentNorm.state === "enabled"
        ? "disabled"
        : "enabled";
  return updateElementAnimation(doc, animationId, { state: nextState });
}

/**
 * Updates an animation in `doc.animations` with partial F18 fields.
 */
export function updateElementAnimation(
  doc: DesignDoc,
  animationId: string,
  patch: UpdateAnimationInput,
): DesignDoc {
  const current = doc.animations ?? [];
  const existing = current.find((a) => a.id === animationId);
  if (!existing) return doc;
  const base = normalizeAnimationModel(existing, doc.elements, doc.assets);

  const nextType =
    patch.animationType && (STUDIO_ANIMATION_TYPES as readonly string[]).includes(patch.animationType)
      ? patch.animationType
      : base.animationType;
  const nextSource =
    patch.source && (ANIMATION_SOURCES as readonly string[]).includes(patch.source)
      ? patch.source
      : base.source;
  const nextFormat =
    patch.format && (ANIMATION_FORMATS as readonly string[]).includes(patch.format)
      ? patch.format
      : patch.source && patch.source !== base.source
        ? defaultFormatForSource(nextSource)
        : base.format;
  const nextDurationRaw =
    patch.duration !== undefined
      ? patch.duration
      : patch.durationMs !== undefined
        ? patch.durationMs
        : base.duration;
  const nextDuration = Number.isFinite(nextDurationRaw)
    ? clamp(Math.round(nextDurationRaw), 0, 60_000)
    : base.duration;
  const nextFps =
    patch.fps !== undefined && Number.isFinite(patch.fps)
      ? clamp(Math.round(patch.fps), 1, 240)
      : base.fps;
  const nextVideoRef =
    patch.videoReference !== undefined
      ? patch.videoReference === null
        ? null
        : normalizeVideoReference({ ...(base.videoReference ?? {}), ...patch.videoReference }, doc.assets)
      : nextSource === "video" && !base.videoReference
        ? normalizeVideoReference({ uri: null, mimeType: "video/mp4" }, doc.assets)
        : base.videoReference;
  const nextSpriteRef =
    patch.spriteSheetReference !== undefined
      ? patch.spriteSheetReference === null
        ? null
        : normalizeSpriteSheetReference({ ...(base.spriteSheetReference ?? {}), ...patch.spriteSheetReference }, doc.assets)
      : nextSource === "sprite_sheet" && !base.spriteSheetReference
        ? normalizeSpriteSheetReference({ uri: null, columns: 4, rows: 4, frameWidth: 128, frameHeight: 128, frameCount: 16 }, doc.assets)
        : base.spriteSheetReference;

  const updated = normalizeAnimationModel(
    {
      ...base,
      ...(patch.elementId !== undefined ? { elementId: patch.elementId.trim() || base.elementId } : {}),
      ...(patch.name !== undefined && patch.name.trim() ? { name: patch.name.trim().slice(0, 80) } : {}),
      animationType: nextType,
      source: nextSource,
      format: nextFormat,
      duration: nextDuration,
      durationMs: nextDuration,
      loop: patch.loop !== undefined ? Boolean(patch.loop) : base.loop,
      fps: nextFps,
      thumbnail: patch.thumbnail !== undefined ? patch.thumbnail : base.thumbnail,
      videoReference: nextVideoRef,
      spriteSheetReference: nextSpriteRef,
      state:
        patch.state && (ANIMATION_STATES as readonly string[]).includes(patch.state)
          ? patch.state
          : base.state,
      animationExtra:
        patch.animationExtra !== undefined
          ? patch.animationExtra.slice(0, 800)
          : base.animationExtra,
      target: patch.target !== undefined && patch.target.trim() ? patch.target.trim() : base.target,
      trigger:
        patch.trigger ??
        (patch.animationType && patch.animationType !== base.animationType
          ? defaultTriggerForAnimationType(nextType)
          : base.trigger),
      kind:
        patch.kind !== undefined && patch.kind.trim()
          ? patch.kind.trim().slice(0, 64)
          : patch.animationType && patch.animationType !== base.animationType
            ? defaultPresetForAnimationType(nextType)
            : base.kind,
      easing: patch.easing !== undefined && patch.easing.trim() ? patch.easing.trim().slice(0, 64) : base.easing,
    },
    doc.elements,
    doc.assets,
  );

  const nextAnimations = current.map((a) => (a.id === animationId ? updated : a));
  const nextElements = syncElementPrimaryAnimation(doc.elements, nextAnimations, updated.elementId);
  const nextScenes = doc.scenes
    ? doc.scenes.map((scene) => ({
        ...scene,
        objects: (scene.objects ?? []).map((obj) =>
          (obj.kind === "animation" || obj.animationId === animationId) &&
          (obj.refId === animationId || obj.animationId === animationId) &&
          obj.name === base.name
            ? { ...obj, name: updated.name }
            : obj,
        ),
      }))
    : undefined;

  return finalizeDoc({
    ...doc,
    elements: nextElements,
    animations: nextAnimations,
    ...(nextScenes !== undefined ? { scenes: nextScenes } : {}),
  });
}

/**
 * Configures video settings (`videoReference`, `source: "video"`, `format`) on an animation.
 */
export function configureAnimationVideo(
  doc: DesignDoc,
  animationId: string,
  videoReference: Partial<VideoAnimationReference> | null,
  format?: Extract<AnimationFormat, "mp4" | "webm">,
): DesignDoc {
  return updateElementAnimation(doc, animationId, {
    source: videoReference ? "video" : "preset",
    format: videoReference ? (format ?? "mp4") : "css",
    videoReference,
  });
}

/**
 * Configures sprite sheet settings (`spriteSheetReference`, `source: "sprite_sheet"`, `format: "sprite-sheet"`) on an animation.
 */
export function configureAnimationSpriteSheet(
  doc: DesignDoc,
  animationId: string,
  spriteSheetReference: Partial<SpriteSheetAnimationReference> | null,
): DesignDoc {
  return updateElementAnimation(doc, animationId, {
    source: spriteSheetReference ? "sprite_sheet" : "preset",
    format: spriteSheetReference ? "sprite-sheet" : "css",
    spriteSheetReference,
  });
}

/**
 * Deletes an animation from `doc.animations` and synchronizes the element's primary animation.
 */
export function deleteElementAnimation(
  doc: DesignDoc,
  animationId: string,
): DesignDoc {
  const current = doc.animations ?? [];
  const targetAnim = current.find((a) => a.id === animationId);
  if (!targetAnim) return doc;
  const norm = normalizeAnimationModel(targetAnim, doc.elements, doc.assets);
  const nextAnimations = current.filter((a) => a.id !== animationId);
  const nextElements = syncElementPrimaryAnimation(doc.elements, nextAnimations, norm.elementId);
  const nextScenes = doc.scenes
    ? doc.scenes.map((scene) => ({
        ...scene,
        objects: (scene.objects ?? []).filter(
          (obj) => !(obj.kind === "animation" && (obj.refId === animationId || obj.animationId === animationId)),
        ),
      }))
    : undefined;

  return finalizeDoc({
    ...doc,
    elements: nextElements,
    animations: nextAnimations,
    ...(nextScenes !== undefined ? { scenes: nextScenes } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* Playback Controls (play, pause, restart, loop)                             */
/* -------------------------------------------------------------------------- */

export function computeTotalFrames(
  animation: Pick<AnimationModel, "duration" | "fps" | "spriteSheetReference">,
): number {
  if (animation.spriteSheetReference) {
    const start = animation.spriteSheetReference.startFrame ?? 0;
    const end = animation.spriteSheetReference.endFrame ?? Math.max(0, animation.spriteSheetReference.frameCount - 1);
    return Math.max(1, end - start + 1);
  }
  const durationSec = Math.max(0.05, (animation.duration || 600) / 1000);
  const fps = clamp(animation.fps || 24, 1, 240);
  return Math.max(1, Math.round(durationSec * fps));
}

export function createAnimationPlaybackState(
  animation: Pick<AnimationModel, "id" | "duration" | "fps" | "loop" | "spriteSheetReference">,
): AnimationPlaybackState {
  const duration = Math.max(50, animation.duration || 600);
  const fps = clamp(animation.fps || 24, 1, 240);
  const totalFrames = computeTotalFrames(animation);
  return {
    animationId: animation.id,
    status: "stopped",
    isPlaying: false,
    isPaused: false,
    loop: Boolean(animation.loop),
    duration,
    fps,
    elapsedMs: 0,
    progress: 0,
    currentFrame: 0,
    totalFrames,
    cycleCount: 0,
  };
}

export function playAnimation(state: AnimationPlaybackState): AnimationPlaybackState {
  const restartFromEnd = state.progress >= 1 && !state.loop;
  return {
    ...state,
    status: "playing",
    isPlaying: true,
    isPaused: false,
    ...(restartFromEnd ? { elapsedMs: 0, progress: 0, currentFrame: 0 } : {}),
  };
}

export function pauseAnimation(state: AnimationPlaybackState): AnimationPlaybackState {
  return {
    ...state,
    status: "paused",
    isPlaying: false,
    isPaused: true,
  };
}

export function restartAnimation(
  state: AnimationPlaybackState,
  autoPlay = true,
): AnimationPlaybackState {
  return {
    ...state,
    status: autoPlay ? "playing" : "stopped",
    isPlaying: autoPlay,
    isPaused: false,
    elapsedMs: 0,
    progress: 0,
    currentFrame: 0,
    cycleCount: 0,
  };
}

export function setAnimationPlaybackLoop(
  state: AnimationPlaybackState,
  loop?: boolean,
): AnimationPlaybackState {
  return {
    ...state,
    loop: loop !== undefined ? loop : !state.loop,
  };
}

export function seekAnimationPlayback(
  state: AnimationPlaybackState,
  elapsedMs: number,
): AnimationPlaybackState {
  const duration = Math.max(50, state.duration);
  const clamped = clamp(elapsedMs, 0, duration);
  const progress = clamped / duration;
  const currentFrame = Math.min(
    state.totalFrames - 1,
    Math.floor(progress * state.totalFrames),
  );
  return {
    ...state,
    elapsedMs: clamped,
    progress,
    currentFrame,
  };
}

export function stepAnimationPlayback(
  state: AnimationPlaybackState,
  deltaMs: number,
): AnimationPlaybackState {
  if (!state.isPlaying || deltaMs <= 0) return state;
  const duration = Math.max(50, state.duration);
  const rawElapsed = state.elapsedMs + deltaMs;
  if (rawElapsed >= duration) {
    if (state.loop) {
      const cycles = Math.floor(rawElapsed / duration);
      const wrapped = rawElapsed % duration;
      const progress = wrapped / duration;
      const currentFrame = Math.min(
        state.totalFrames - 1,
        Math.floor(progress * state.totalFrames),
      );
      return {
        ...state,
        elapsedMs: wrapped,
        progress,
        currentFrame,
        cycleCount: state.cycleCount + cycles,
      };
    }
    return {
      ...state,
      status: "paused",
      isPlaying: false,
      isPaused: true,
      elapsedMs: duration,
      progress: 1,
      currentFrame: Math.max(0, state.totalFrames - 1),
    };
  }
  const progress = rawElapsed / duration;
  const currentFrame = Math.min(
    state.totalFrames - 1,
    Math.floor(progress * state.totalFrames),
  );
  return {
    ...state,
    elapsedMs: rawElapsed,
    progress,
    currentFrame,
  };
}

/**
 * Resolves the exact pixel frame rectangle on a sprite sheet for a 0-based `frameIndex`.
 */
export function resolveSpriteFrameRect(
  spriteRef: SpriteSheetAnimationReference,
  frameIndex: number,
): SpriteFrameRect {
  const cols = Math.max(1, spriteRef.columns || 1);
  const rows = Math.max(1, spriteRef.rows || 1);
  const start = spriteRef.startFrame ?? 0;
  const end = spriteRef.endFrame ?? Math.max(0, (spriteRef.frameCount || cols * rows) - 1);
  const activeCount = Math.max(1, end - start + 1);
  const absoluteFrame = start + (((frameIndex % activeCount) + activeCount) % activeCount);
  const column = absoluteFrame % cols;
  const row = Math.floor(absoluteFrame / cols) % rows;
  const margin = spriteRef.margin ?? 0;
  const spacing = spriteRef.spacing ?? 0;
  const width = Math.max(1, spriteRef.frameWidth || 128);
  const height = Math.max(1, spriteRef.frameHeight || 128);
  const x = margin + column * (width + spacing);
  const y = margin + row * (height + spacing);
  const sheetWidth = margin * 2 + cols * width + Math.max(0, cols - 1) * spacing;
  const sheetHeight = margin * 2 + rows * height + Math.max(0, rows - 1) * spacing;
  return {
    frameIndex: absoluteFrame,
    column,
    row,
    x,
    y,
    width,
    height,
    sheetWidth,
    sheetHeight,
  };
}

/* -------------------------------------------------------------------------- */
/* Standalone Animated Scene Layers (moveable, resizable, reorderable,        */
/* visible/hidden, lockable)                                                  */
/* -------------------------------------------------------------------------- */

export function createStandaloneAnimationSceneObject(
  animation: AnimationModel,
  options?: StandaloneAnimationLayerInput & {
    sequence?: number;
    canvasSize?: { width: number; height: number };
    resolvedAssetId?: string | null;
  },
): SceneObject {
  const canvasW = options?.canvasSize?.width ?? 1920;
  const canvasH = options?.canvasSize?.height ?? 1080;
  const defaultSize =
    animation.animationType === "Background"
      ? { width: canvasW, height: canvasH }
      : animation.spriteSheetReference
        ? {
            width: clamp(animation.spriteSheetReference.frameWidth * 2, 120, canvasW),
            height: clamp(animation.spriteSheetReference.frameHeight * 2, 120, canvasH),
          }
        : animation.videoReference?.width && animation.videoReference?.height
          ? {
              width: clamp(animation.videoReference.width, 120, canvasW),
              height: clamp(animation.videoReference.height, 120, canvasH),
            }
          : { width: 320, height: 240 };

  const width = Math.max(8, Math.round(options?.width ?? defaultSize.width));
  const height = Math.max(8, Math.round(options?.height ?? defaultSize.height));
  const x = Math.round(options?.x ?? (canvasW - width) / 2);
  const y = Math.round(options?.y ?? (canvasH - height) / 2);
  const seq = options?.sequence ?? 1;
  const id = `obj_anim_${animation.id.replace(/[^A-Za-z0-9_-]/g, "_")}_${seq}`;
  const layerId = options?.layerId ?? "layer-fx";
  const assetId =
    options?.resolvedAssetId ??
    animation.spriteSheetReference?.assetId ??
    animation.videoReference?.assetId ??
    null;

  return {
    id,
    name: (options?.name?.trim() || animation.name || "Animated Layer").slice(0, 80),
    kind: "animation",
    type: "animation",
    layerId,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: options?.visible ?? true,
    locked: options?.locked ?? false,
    blur: 0,
    fill: null,
    stroke: null,
    strokeWidth: 0,
    radius: 0,
    shape: null,
    arrow: false,
    points: [],
    text: null,
    fontSize: 32,
    fontWeight: 600,
    align: "center",
    refId: animation.id,
    animationId: animation.id,
    assetId,
    blendMode: "normal",
    transform: {
      x,
      y,
      width,
      height,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
    },
    parentId: null,
    groupId: null,
    expanded: true,
  };
}

/**
 * Places an animation into a scene of a `GameBlueprint` as a standalone animated layer.
 * The placed scene object is moveable, resizable, reorderable, visible/hidden, and lockable.
 */
export function addAnimationLayerToScene(
  bp: GameBlueprint,
  animationId: string,
  options?: StandaloneAnimationLayerInput,
): {
  blueprint: GameBlueprint;
  object: SceneObject;
  layer: LayerDef;
  sceneId: string;
} | null {
  const rawAnim = (bp.animations ?? []).find((a) => a.id === animationId);
  if (!rawAnim) return null;
  const animation = normalizeAnimationModel(rawAnim, bp.elements, bp.assets);
  const targetScene =
    (options?.sceneId ? bp.scenes.find((s) => s.id === options.sceneId) : null) ??
    bp.scenes[0];
  if (!targetScene) return null;

  let layers = [...bp.layers];
  let chosenLayer: LayerDef | undefined;

  if (options?.createDedicatedLayer) {
    const takenLayerIds = new Set(layers.map((l) => l.id));
    const newLayerId = uniqueId(`layer-anim-${animation.id.slice(0, 20)}`, takenLayerIds);
    const maxOrder = layers.reduce((m, l) => Math.max(m, l.order), 0);
    chosenLayer = {
      id: newLayerId,
      name: `${animation.name} Layer`.slice(0, 60),
      kind: "fx",
      type: "animation",
      order: Math.min(100, maxOrder + 1),
      visible: options?.visible ?? true,
      locked: options?.locked ?? false,
      opacity: 1,
      blendMode: "normal",
    };
    layers = [...layers, chosenLayer];
  } else {
    chosenLayer =
      (options?.layerId ? layers.find((l) => l.id === options.layerId) : undefined) ??
      layers.find((l) => !l.locked && (l.kind === "fx" || l.kind === "overlay")) ??
      layers.find((l) => !l.locked) ??
      layers[0];
  }

  if (!chosenLayer) return null;

  const ownerElement = bp.elements.find((e) => e.id === animation.elementId);
  const fallbackAssetId =
    animation.spriteSheetReference?.assetId ??
    animation.videoReference?.assetId ??
    ownerElement?.assetId ??
    (ownerElement?.type === "symbol"
      ? bp.symbols.find((s) => s.id === ownerElement.symbolIds[0])?.assetId ?? null
      : null);
  const validAssetId =
    fallbackAssetId && bp.assets.some((a) => a.id === fallbackAssetId) ? fallbackAssetId : null;

  const existingObjects = targetScene.objects ?? [];
  const baseObj = createStandaloneAnimationSceneObject(animation, {
    ...options,
    layerId: chosenLayer.id,
    sequence: existingObjects.length + 1,
    canvasSize: { width: bp.canvas.width, height: bp.canvas.height },
    resolvedAssetId: validAssetId,
  });
  const takenObjIds = new Set(existingObjects.map((o) => o.id));
  const finalObj: SceneObject = takenObjIds.has(baseObj.id)
    ? { ...baseObj, id: uniqueId(baseObj.id, takenObjIds) }
    : baseObj;

  const nextScenes = bp.scenes.map((scene) => {
    if (scene.id !== targetScene.id) return scene;
    const layerIds = scene.layerIds.includes(chosenLayer!.id)
      ? scene.layerIds
      : [...scene.layerIds, chosenLayer!.id];
    return {
      ...scene,
      layerIds,
      objects: [...existingObjects, finalObj],
    };
  });

  return {
    blueprint: {
      ...bp,
      layers,
      scenes: nextScenes,
    },
    object: finalObj,
    layer: chosenLayer,
    sceneId: targetScene.id,
  };
}

/**
 * Places an animation into a `DesignDoc` scene as a standalone animated layer.
 */
export function addAnimationLayerToDesignDoc(
  doc: DesignDoc,
  animationId: string,
  options?: StandaloneAnimationLayerInput & { canvasSize?: { width: number; height: number } },
): { doc: DesignDoc; object: SceneObject; sceneId: string } | null {
  const rawAnim = (doc.animations ?? []).find((a) => a.id === animationId);
  if (!rawAnim) return null;
  const animation = normalizeAnimationModel(rawAnim, doc.elements, doc.assets);
  const scenes = doc.scenes && doc.scenes.length > 0
    ? doc.scenes
    : [{ id: "scene-base", name: "Base Game", kind: "base" as const, layerIds: ["layer-bg", "layer-reels", "layer-fx", "layer-ui"], entryTransition: "fade", objects: [] }];
  const targetScene =
    (options?.sceneId ? scenes.find((s) => s.id === options.sceneId) : null) ??
    scenes[0];
  if (!targetScene) return null;

  const layers = doc.layers ?? [];
  const chosenLayerId =
    options?.layerId ??
    layers.find((l) => !l.locked && (l.kind === "fx" || l.kind === "overlay"))?.id ??
    layers.find((l) => !l.locked)?.id ??
    targetScene.layerIds[0] ??
    "layer-fx";

  const ownerElement = doc.elements.find((e) => e.id === animation.elementId);
  const fallbackAssetId =
    animation.spriteSheetReference?.assetId ??
    animation.videoReference?.assetId ??
    ownerElement?.assetId ??
    (ownerElement?.type === "symbol"
      ? doc.symbols.find((s) => s.id === ownerElement.symbolIds[0])?.assetId ?? null
      : null);
  const validAssetId =
    fallbackAssetId && doc.assets.some((a) => a.id === fallbackAssetId) ? fallbackAssetId : null;

  const existingObjects = targetScene.objects ?? [];
  const baseObj = createStandaloneAnimationSceneObject(animation, {
    ...options,
    layerId: chosenLayerId,
    sequence: existingObjects.length + 1,
    canvasSize: options?.canvasSize ?? { width: 1920, height: 1080 },
    resolvedAssetId: validAssetId,
  });
  const takenObjIds = new Set(existingObjects.map((o) => o.id));
  const finalObj: SceneObject = takenObjIds.has(baseObj.id)
    ? { ...baseObj, id: uniqueId(baseObj.id, takenObjIds) }
    : baseObj;

  const nextScenes = scenes.map((scene) =>
    scene.id === targetScene.id
      ? { ...scene, objects: [...existingObjects, finalObj] }
      : scene,
  );

  return {
    object: finalObj,
    sceneId: targetScene.id,
    doc: finalizeDoc({
      ...doc,
      scenes: nextScenes,
    }),
  };
}

export function moveAnimationSceneLayer(
  objects: SceneObject[],
  objectId: string,
  delta: { x: number; y: number },
): SceneObject[] {
  const target = objects.find((o) => o.id === objectId);
  if (!target || target.locked) return objects;
  return moveObjects(objects, [objectId], delta);
}

export function resizeAnimationSceneLayer(
  objects: SceneObject[],
  objectId: string,
  box: { x?: number; y?: number; width: number; height: number },
): SceneObject[] {
  const target = objects.find((o) => o.id === objectId);
  if (!target || target.locked) return objects;
  const width = Math.max(8, Math.round(box.width));
  const height = Math.max(8, Math.round(box.height));
  const x = box.x !== undefined ? Math.round(box.x) : target.x;
  const y = box.y !== undefined ? Math.round(box.y) : target.y;
  return patchObject(objects, objectId, { x, y, width, height });
}

export function reorderAnimationSceneLayer(
  objects: SceneObject[],
  objectId: string,
  order: "front" | "forward" | "backward" | "back" | "up" | "down",
): SceneObject[] {
  if (order === "up" || order === "down") {
    return reorderLayerItem(objects, objectId, order);
  }
  return reorderObjects(objects, objectId, order);
}

export function setAnimationSceneLayerVisibility(
  objects: SceneObject[],
  objectId: string,
  visible: boolean,
): SceneObject[] {
  return patchObject(objects, objectId, { visible });
}

export function setAnimationSceneLayerLocked(
  objects: SceneObject[],
  objectId: string,
  locked: boolean,
): SceneObject[] {
  return patchObject(objects, objectId, { locked });
}

export function serializeAnimationsToBlueprint(
  bp: GameBlueprint,
  animations: AnimationMeta[],
): GameBlueprint {
  const normalized = animations.map((a) => normalizeAnimationModel(a, bp.elements, bp.assets));
  return {
    ...bp,
    animations: normalized,
  };
}

export function validateAnimationModel(
  anim: AnimationModel,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!anim.id || !anim.id.trim()) errors.push("Animation id is required.");
  if (!anim.elementId || !anim.elementId.trim()) errors.push("Animation elementId is required.");
  if (!anim.name || !anim.name.trim()) errors.push("Animation name is required.");
  if (!(STUDIO_ANIMATION_TYPES as readonly string[]).includes(anim.animationType)) {
    errors.push(`Unsupported animation type "${anim.animationType}".`);
  }
  if (!(ANIMATION_SOURCES as readonly string[]).includes(anim.source)) {
    errors.push(`Unsupported animation source "${anim.source}".`);
  }
  if (!(ANIMATION_FORMATS as readonly string[]).includes(anim.format)) {
    errors.push(`Unsupported animation format "${anim.format}".`);
  }
  if (!Number.isFinite(anim.duration) || anim.duration < 0 || anim.duration > 60_000) {
    errors.push("Animation duration must be between 0 and 60,000 ms.");
  }
  if (!Number.isFinite(anim.fps) || anim.fps < 1 || anim.fps > 240) {
    errors.push("Animation fps must be between 1 and 240.");
  }
  if (typeof anim.loop !== "boolean") {
    errors.push("Animation loop must be a boolean.");
  }
  if (!(ANIMATION_STATES as readonly string[]).includes(anim.state)) {
    errors.push(`Unsupported animation state "${anim.state}".`);
  }
  if (anim.source === "sprite_sheet" && anim.spriteSheetReference) {
    const s = anim.spriteSheetReference;
    if (s.columns < 1 || s.rows < 1 || s.frameWidth < 1 || s.frameHeight < 1 || s.frameCount < 1) {
      errors.push("Sprite sheet dimensions and frame count must be positive.");
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
}
