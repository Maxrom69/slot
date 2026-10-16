/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F19 — SCENES AND LAYOUT COMPOSITION
 *
 * Pure, deterministic operations for the F19 Scene System:
 * - Up to 3 scenes (Scene 1, Scene 2, Scene 3)
 * - 18-character rename limit enforcement
 * - Add Scene, Duplicate, Rename, Delete
 * - Independent per-scene layout storage (positions, sizes, rotation, layer order,
 *   visibility, background selection, composed image references)
 * - Shared global game configuration preservation (reels, math, symbols)
 * - Per-scene unsaved state tracking & Save / Discard / Cancel scene switch workflow
 * - Active-scene-only layout saving
 */

import type {
  AssetRef,
  ElementDef,
  GameBlueprint,
  LayerDef,
  SceneBackground,
  SceneCanvasConfiguration,
  SceneComposedImageRef,
  SceneDef,
  SceneLayoutMetadata,
  SceneObject,
  SceneVisibilityState,
  SymbolDef,
} from "@/lib/blueprint/types";
import {
  duplicateObjects,
  reorderBlueprintLayers,
  reorderObjects,
  type Order,
} from "@/lib/canvas/operations";
import {
  MAX_SCENES,
  MAX_SCENE_NAME_LENGTH,
  MIN_SCENES,
  SCENE_SLOT_LABELS,
  type PendingSceneSwitchPrompt,
  type PerSceneDraftRecord,
  type SceneCompositionWorkspaceState,
  type SceneLayoutSnapshot,
  type SceneModel,
  type SceneSelectorCardModel,
  type SceneSharedGlobalConfig,
  type SceneSlotLabel,
  type UnsavedSwitchResolution,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Scene Name Validation & Formatting (Max 18 Characters)                     */
/* -------------------------------------------------------------------------- */

export interface SceneNameValidationResult {
  ok: boolean;
  sanitized: string;
  error?: string;
}

export function validateSceneName(rawName: string): SceneNameValidationResult {
  if (typeof rawName !== "string") {
    return {
      ok: false,
      sanitized: "",
      error: "Scene name must be a string.",
    };
  }
  const trimmed = rawName.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      sanitized: "",
      error: "Scene name cannot be empty.",
    };
  }
  if (trimmed.length > MAX_SCENE_NAME_LENGTH) {
    return {
      ok: false,
      sanitized: trimmed.slice(0, MAX_SCENE_NAME_LENGTH).trim(),
      error: `Scene name must be at most ${MAX_SCENE_NAME_LENGTH} characters.`,
    };
  }
  return {
    ok: true,
    sanitized: trimmed,
  };
}

export function sanitizeSceneName(rawName: string, fallback = "Scene 1"): string {
  const trimmed = (rawName ?? "").trim();
  if (!trimmed) {
    return fallback.slice(0, MAX_SCENE_NAME_LENGTH);
  }
  return trimmed.slice(0, MAX_SCENE_NAME_LENGTH).trim() || fallback.slice(0, MAX_SCENE_NAME_LENGTH);
}

export function uniqueSceneName(
  baseName: string,
  takenNames: Iterable<string>,
  isCopy = false,
): string {
  const used = new Set(Array.from(takenNames, (n) => n.toLowerCase()));
  const cleanBase = sanitizeSceneName(
    baseName.replace(/\s+copy(\s+\d+)?$/i, ""),
    "Scene",
  );

  if (!isCopy && !used.has(cleanBase.toLowerCase())) {
    return cleanBase;
  }

  const suffixOne = " Copy";
  const maxRootOne = MAX_SCENE_NAME_LENGTH - suffixOne.length;
  const candidateOne = `${cleanBase.slice(0, maxRootOne).trim()}${suffixOne}`;
  if (!used.has(candidateOne.toLowerCase())) {
    return candidateOne;
  }

  for (let i = 2; i <= 99; i += 1) {
    const suffix = ` Copy ${i}`;
    const maxRoot = Math.max(1, MAX_SCENE_NAME_LENGTH - suffix.length);
    const candidate = `${cleanBase.slice(0, maxRoot).trim()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return cleanBase.slice(0, MAX_SCENE_NAME_LENGTH);
}

export function slotLabelForIndex(index: number): SceneSlotLabel {
  const clamped = Math.max(0, Math.min(MAX_SCENES - 1, index));
  return SCENE_SLOT_LABELS[clamped] ?? "Scene 1";
}

/* -------------------------------------------------------------------------- */
/* Deep Clone & Snapshot Equality Helpers                                     */
/* -------------------------------------------------------------------------- */

function cloneLayers(layers: LayerDef[]): LayerDef[] {
  return layers.map((layer, index) => ({
    ...layer,
    order: typeof layer.order === "number" ? layer.order : index,
    transform: layer.transform ? { ...layer.transform } : undefined,
  }));
}

function cloneObjects(objects: SceneObject[]): SceneObject[] {
  return objects.map((obj) => ({
    ...obj,
    points: (obj.points ?? []).map((pt) => ({ ...pt })),
    transform: obj.transform
      ? { ...obj.transform }
      : {
          x: obj.x,
          y: obj.y,
          width: obj.width,
          height: obj.height,
          scaleX: 1,
          scaleY: 1,
          rotation: obj.rotation,
        },
  }));
}

function cloneComposedImages(images: SceneComposedImageRef[]): SceneComposedImageRef[] {
  return images.map((img) => ({ ...img }));
}

function cloneVisibility(vis: SceneVisibilityState): SceneVisibilityState {
  return {
    sceneVisible: vis.sceneVisible,
    layers: { ...vis.layers },
    objects: { ...vis.objects },
  };
}

function cloneCanvasConfiguration(
  cfg: SceneCanvasConfiguration,
): SceneCanvasConfiguration {
  return {
    ...cfg,
    safeArea: { ...cfg.safeArea },
  };
}

function cloneLayoutMetadata(meta: SceneLayoutMetadata): SceneLayoutMetadata {
  return { ...meta };
}

export function cloneSceneLayoutSnapshot(
  snapshot: SceneLayoutSnapshot,
): SceneLayoutSnapshot {
  return {
    sceneId: snapshot.sceneId,
    name: snapshot.name,
    canvasConfiguration: cloneCanvasConfiguration(snapshot.canvasConfiguration),
    background: { ...snapshot.background },
    layers: cloneLayers(snapshot.layers),
    layerIds: [...snapshot.layerIds],
    objects: cloneObjects(snapshot.objects),
    visibility: cloneVisibility(snapshot.visibility),
    composedImages: cloneComposedImages(snapshot.composedImages),
    layoutMetadata: cloneLayoutMetadata(snapshot.layoutMetadata),
  };
}

export function areSceneLayoutsEqual(
  a: SceneLayoutSnapshot,
  b: SceneLayoutSnapshot,
): boolean {
  if (a === b) return true;
  if (a.name !== b.name) return false;
  if (
    a.background.color !== b.background.color ||
    a.background.assetId !== b.background.assetId ||
    (a.background.imageUri ?? null) !== (b.background.imageUri ?? null) ||
    (a.background.fit ?? "cover") !== (b.background.fit ?? "cover")
  ) {
    return false;
  }
  if (
    a.canvasConfiguration.width !== b.canvasConfiguration.width ||
    a.canvasConfiguration.height !== b.canvasConfiguration.height ||
    a.canvasConfiguration.orientation !== b.canvasConfiguration.orientation ||
    a.canvasConfiguration.safeArea.top !== b.canvasConfiguration.safeArea.top ||
    a.canvasConfiguration.safeArea.right !== b.canvasConfiguration.safeArea.right ||
    a.canvasConfiguration.safeArea.bottom !== b.canvasConfiguration.safeArea.bottom ||
    a.canvasConfiguration.safeArea.left !== b.canvasConfiguration.safeArea.left ||
    Boolean(a.canvasConfiguration.gridVisible ?? true) !==
      Boolean(b.canvasConfiguration.gridVisible ?? true) ||
    (a.canvasConfiguration.gridSize ?? 40) !== (b.canvasConfiguration.gridSize ?? 40) ||
    Boolean(a.canvasConfiguration.snapToGrid ?? false) !==
      Boolean(b.canvasConfiguration.snapToGrid ?? false)
  ) {
    return false;
  }
  if (a.visibility.sceneVisible !== b.visibility.sceneVisible) return false;
  if (JSON.stringify(a.visibility.layers) !== JSON.stringify(b.visibility.layers)) {
    return false;
  }
  if (JSON.stringify(a.visibility.objects) !== JSON.stringify(b.visibility.objects)) {
    return false;
  }
  if (JSON.stringify(a.layers) !== JSON.stringify(b.layers)) return false;
  if (JSON.stringify(a.objects) !== JSON.stringify(b.objects)) return false;
  if (JSON.stringify(a.composedImages) !== JSON.stringify(b.composedImages)) {
    return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Normalization & Derivation Helpers                                         */
/* -------------------------------------------------------------------------- */

function resolveAssetUriForRef(
  assetId: string | null | undefined,
  assets: AssetRef[],
): string | null {
  if (!assetId) return null;
  const found = assets.find((a) => a.id === assetId);
  return found && found.state === "linked" && found.uri ? found.uri : null;
}

export function deriveComposedImages(
  objects: SceneObject[],
  layers: LayerDef[],
  bp?: Pick<GameBlueprint, "assets" | "symbols" | "elements">,
  existing?: SceneComposedImageRef[],
): SceneComposedImageRef[] {
  const assets = bp?.assets ?? [];
  const symbols = bp?.symbols ?? [];
  const elements = bp?.elements ?? [];
  const layerOrderMap = new Map(layers.map((l, idx) => [l.id, l.order ?? idx]));

  const derivedById = new Map<string, SceneComposedImageRef>();

  // Include any explicit composed image refs that do not correspond to a removed scene object
  const objectIds = new Set(objects.map((o) => o.id));
  for (const ref of existing ?? []) {
    if (!ref.id.startsWith("comp-obj-") || objectIds.has(ref.id.replace(/^comp-obj-/, ""))) {
      derivedById.set(ref.id, { ...ref });
    }
  }

  objects.forEach((obj, idx) => {
    if (
      obj.kind !== "image" &&
      obj.kind !== "symbol" &&
      obj.kind !== "element" &&
      obj.kind !== "animation"
    ) {
      return;
    }
    let resolvedAssetId = obj.assetId ?? null;
    let resolvedUri: string | null = null;
    if (!resolvedAssetId && obj.kind === "symbol" && obj.refId) {
      const sym: SymbolDef | undefined = symbols.find((s) => s.id === obj.refId);
      resolvedAssetId = sym?.assetId ?? sym?.image?.assetId ?? null;
      resolvedUri = sym?.image?.uri ?? null;
    } else if (!resolvedAssetId && obj.kind === "element" && obj.refId) {
      const el: ElementDef | undefined = elements.find((e) => e.id === obj.refId);
      resolvedAssetId = el?.assetId ?? el?.image?.assetId ?? null;
      resolvedUri = el?.image?.uri ?? null;
    }
    if (!resolvedUri) {
      resolvedUri = resolveAssetUriForRef(resolvedAssetId, assets);
    }

    const compId = `comp-obj-${obj.id}`;
    const layerRank = layerOrderMap.get(obj.layerId) ?? 0;
    derivedById.set(compId, {
      id: compId,
      name: obj.name,
      assetId: resolvedAssetId,
      uri: resolvedUri,
      refKind: obj.kind,
      refId: obj.refId ?? obj.animationId ?? null,
      layerId: obj.layerId,
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      rotation: obj.rotation,
      visible: obj.visible,
      order: layerRank * 1000 + idx,
    });
  });

  return Array.from(derivedById.values()).sort((a, b) => a.order - b.order);
}

export function deriveSceneVisibility(
  layers: LayerDef[],
  objects: SceneObject[],
  existing?: Partial<SceneVisibilityState>,
): SceneVisibilityState {
  const layerVis: Record<string, boolean> = {};
  for (const layer of layers) {
    layerVis[layer.id] = layer.visible;
  }
  const objectVis: Record<string, boolean> = {};
  for (const obj of objects) {
    objectVis[obj.id] = obj.visible;
  }
  return {
    sceneVisible: existing?.sceneVisible ?? true,
    layers: layerVis,
    objects: objectVis,
  };
}

export function normalizeSceneModel(
  scene: SceneDef,
  bp: GameBlueprint,
  index: number,
): SceneModel {
  const slotIndex = Math.max(1, Math.min(MAX_SCENES, index + 1));
  const slotLabel = slotLabelForIndex(index);

  const baseLayers =
    scene.layers && scene.layers.length > 0
      ? cloneLayers(scene.layers)
      : cloneLayers(bp.layers ?? []).map((layer) => ({
          ...layer,
          visible:
            scene.visibility?.layers?.[layer.id] !== undefined
              ? scene.visibility.layers[layer.id]!
              : scene.layerIds && scene.layerIds.length > 0
                ? layer.visible && scene.layerIds.includes(layer.id)
                : layer.visible,
        }));

  // Keep layerIds valid against bp.layers so validateBlueprint always passes
  const blueprintLayerIdSet = new Set((bp.layers ?? []).map((l) => l.id));
  const validLayerIds = baseLayers
    .filter((l) => l.visible && (blueprintLayerIdSet.size === 0 || blueprintLayerIdSet.has(l.id)))
    .map((l) => l.id);
  const layerIds =
    validLayerIds.length > 0
      ? validLayerIds
      : (scene.layerIds ?? []).filter(
          (id) => blueprintLayerIdSet.size === 0 || blueprintLayerIdSet.has(id),
        );

  const objects = cloneObjects(scene.objects ?? []).map((obj) => ({
    ...obj,
    visible:
      scene.visibility?.objects?.[obj.id] !== undefined
        ? scene.visibility.objects[obj.id]!
        : obj.visible,
  }));

  const visibility = deriveSceneVisibility(baseLayers, objects, scene.visibility);
  const composedImages = deriveComposedImages(
    objects,
    baseLayers,
    bp,
    scene.composedImages,
  );

  const canvasConfiguration: SceneCanvasConfiguration = scene.canvasConfiguration
    ? cloneCanvasConfiguration(scene.canvasConfiguration)
    : {
        width: bp.canvas?.width ?? 1920,
        height: bp.canvas?.height ?? 1080,
        safeArea: bp.canvas?.safeArea
          ? { ...bp.canvas.safeArea }
          : { top: 64, right: 96, bottom: 96, left: 96 },
        orientation: bp.canvas?.orientation ?? "landscape",
        gridVisible: true,
        gridSize: 40,
        snapToGrid: false,
      };

  const background: SceneBackground = {
    color: scene.background?.color ?? bp.style?.palette?.background ?? "#0b1020",
    assetId: scene.background?.assetId ?? null,
    imageUri:
      scene.background?.imageUri ??
      resolveAssetUriForRef(scene.background?.assetId ?? null, bp.assets ?? []),
    fit: scene.background?.fit ?? "cover",
  };

  const layoutMetadata: SceneLayoutMetadata = {
    slotIndex,
    slotLabel,
    activeLayerId:
      scene.layoutMetadata?.activeLayerId ??
      baseLayers.find((l) => !l.locked)?.id ??
      baseLayers[0]?.id ??
      null,
    zoom: scene.layoutMetadata?.zoom ?? 1,
    panX: scene.layoutMetadata?.panX ?? 0,
    panY: scene.layoutMetadata?.panY ?? 0,
    snapEnabled: scene.layoutMetadata?.snapEnabled ?? true,
    guidesVisible: scene.layoutMetadata?.guidesVisible ?? true,
    safeAreaVisible: scene.layoutMetadata?.safeAreaVisible ?? true,
    updatedAt: scene.layoutMetadata?.updatedAt ?? bp.meta?.updatedAt,
    notes: scene.layoutMetadata?.notes ?? "",
  };

  return {
    id: scene.id,
    name: sanitizeSceneName(scene.name, slotLabel),
    kind: scene.kind ?? "base",
    entryTransition: scene.entryTransition ?? "fade",
    canvasConfiguration,
    background,
    layers: baseLayers,
    layerIds,
    objects,
    visibility,
    composedImages,
    layoutMetadata,
  };
}

export function createSnapshotFromSceneModel(model: SceneModel): SceneLayoutSnapshot {
  return {
    sceneId: model.id,
    name: model.name,
    canvasConfiguration: cloneCanvasConfiguration(model.canvasConfiguration),
    background: { ...model.background },
    layers: cloneLayers(model.layers),
    layerIds: [...model.layerIds],
    objects: cloneObjects(model.objects),
    visibility: cloneVisibility(model.visibility),
    composedImages: cloneComposedImages(model.composedImages),
    layoutMetadata: cloneLayoutMetadata(model.layoutMetadata),
  };
}

export function applySnapshotToSceneModel(
  model: SceneModel,
  snapshot: SceneLayoutSnapshot,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneModel {
  const layers = cloneLayers(snapshot.layers);
  const objects = cloneObjects(snapshot.objects);
  const visibility = deriveSceneVisibility(layers, objects, snapshot.visibility);
  const composedImages = deriveComposedImages(
    objects,
    layers,
    bp,
    snapshot.composedImages,
  );
  const blueprintLayerIdSet = new Set((bp?.layers ?? []).map((l) => l.id));
  const computedLayerIds = layers
    .filter((l) => l.visible && (blueprintLayerIdSet.size === 0 || blueprintLayerIdSet.has(l.id)))
    .map((l) => l.id);
  const layerIds =
    computedLayerIds.length > 0
      ? computedLayerIds
      : snapshot.layerIds.filter(
          (id) => blueprintLayerIdSet.size === 0 || blueprintLayerIdSet.has(id),
        );

  return {
    ...model,
    name: sanitizeSceneName(snapshot.name, model.name),
    canvasConfiguration: cloneCanvasConfiguration(snapshot.canvasConfiguration),
    background: { ...snapshot.background },
    layers,
    layerIds,
    objects,
    visibility,
    composedImages,
    layoutMetadata: cloneLayoutMetadata(snapshot.layoutMetadata),
  };
}

export function sceneModelToSceneDef(model: SceneModel): SceneDef {
  return {
    id: model.id,
    name: sanitizeSceneName(model.name, model.layoutMetadata.slotLabel),
    kind: model.kind,
    layerIds: [...model.layerIds],
    entryTransition: model.entryTransition,
    objects: cloneObjects(model.objects),
    background: { ...model.background },
    canvasConfiguration: cloneCanvasConfiguration(model.canvasConfiguration),
    layers: cloneLayers(model.layers),
    visibility: cloneVisibility(model.visibility),
    composedImages: cloneComposedImages(model.composedImages),
    layoutMetadata: cloneLayoutMetadata(model.layoutMetadata),
  };
}

export function extractSharedGlobalConfig(
  bp: GameBlueprint,
): SceneSharedGlobalConfig {
  return {
    reels: bp.reels,
    reelConfiguration: bp.reelConfiguration,
    math: bp.math,
    symbols: bp.symbols,
    symbolSets: bp.symbolSets,
    specialSymbols: bp.specialSymbols,
    paylines: bp.paylines,
    paytable: bp.paytable,
  };
}

/* -------------------------------------------------------------------------- */
/* Scene Composition Workspace State Initialization & Selector Cards          */
/* -------------------------------------------------------------------------- */

export function createSceneCompositionState(
  bp: GameBlueprint,
  initialActiveSceneId?: string,
): SceneCompositionWorkspaceState {
  const rawScenes = (bp.scenes ?? []).slice(0, MAX_SCENES);
  const fallbackScenes: SceneDef[] =
    rawScenes.length > 0
      ? rawScenes
      : [
          {
            id: "scene-1",
            name: "Scene 1",
            kind: "base",
            layerIds: (bp.layers ?? []).map((l) => l.id),
            entryTransition: "fade",
            objects: [],
          },
        ];

  const scenes = fallbackScenes.map((scene, index) =>
    normalizeSceneModel(scene, bp, index),
  );
  const activeSceneId =
    initialActiveSceneId && scenes.some((s) => s.id === initialActiveSceneId)
      ? initialActiveSceneId
      : scenes[0]!.id;

  const draftsBySceneId: Record<string, PerSceneDraftRecord> = {};
  for (const scene of scenes) {
    const saved = createSnapshotFromSceneModel(scene);
    const draft = cloneSceneLayoutSnapshot(saved);
    draftsBySceneId[scene.id] = {
      sceneId: scene.id,
      saved,
      draft,
      isDirty: false,
      lastModifiedAt: null,
    };
  }

  return {
    activeSceneId,
    scenes,
    draftsBySceneId,
    pendingSceneSwitch: null,
    sharedGlobalConfig: extractSharedGlobalConfig(bp),
  };
}

export function getEffectiveSceneModel(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneModel | null {
  const base = state.scenes.find((s) => s.id === sceneId);
  if (!base) return null;
  const record = state.draftsBySceneId[sceneId];
  if (!record) return base;
  return applySnapshotToSceneModel(base, record.draft, bp);
}

export function getActiveSceneModel(
  state: SceneCompositionWorkspaceState,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneModel {
  return (
    getEffectiveSceneModel(state, state.activeSceneId, bp) ??
    state.scenes[0]!
  );
}

export function isSceneDirty(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
): boolean {
  return Boolean(state.draftsBySceneId[sceneId]?.isDirty);
}

export function getDirtySceneIds(
  state: SceneCompositionWorkspaceState,
): string[] {
  return state.scenes
    .filter((scene) => state.draftsBySceneId[scene.id]?.isDirty)
    .map((scene) => scene.id);
}

export function buildSceneSelectorCards(
  state: SceneCompositionWorkspaceState,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneSelectorCardModel[] {
  return ([0, 1, 2] as const).map((idx) => {
    const slotIndex = (idx + 1) as 1 | 2 | 3;
    const slotLabel = SCENE_SLOT_LABELS[idx]!;
    const rawScene = state.scenes[idx];
    if (!rawScene) {
      return {
        slotIndex,
        slotLabel,
        occupied: false,
        sceneId: null,
        name: slotLabel,
        kind: null,
        active: false,
        isDirty: false,
        objectCount: 0,
        layerCount: 0,
        visibleLayerCount: 0,
        composedImageCount: 0,
        backgroundColor: null,
        backgroundAssetId: null,
      };
    }

    const effective = getEffectiveSceneModel(state, rawScene.id, bp) ?? rawScene;
    return {
      slotIndex,
      slotLabel,
      occupied: true,
      sceneId: effective.id,
      name: effective.name,
      kind: effective.kind,
      active: state.activeSceneId === effective.id,
      isDirty: isSceneDirty(state, effective.id),
      objectCount: effective.objects.length,
      layerCount: effective.layers.length,
      visibleLayerCount: effective.layers.filter((l) => l.visible).length,
      composedImageCount: effective.composedImages.length,
      backgroundColor: effective.background.color,
      backgroundAssetId: effective.background.assetId,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Scene Management Actions: Add Scene, Duplicate, Rename, Delete             */
/* -------------------------------------------------------------------------- */

function reindexScenes(scenes: SceneModel[]): SceneModel[] {
  return scenes.slice(0, MAX_SCENES).map((scene, idx) => ({
    ...scene,
    layoutMetadata: {
      ...scene.layoutMetadata,
      slotIndex: idx + 1,
      slotLabel: slotLabelForIndex(idx),
    },
  }));
}

export function addSceneToState(
  state: SceneCompositionWorkspaceState,
  bp: GameBlueprint,
  input?: {
    id?: string;
    name?: string;
    kind?: SceneDef["kind"];
    activate?: boolean;
  },
): {
  ok: boolean;
  state: SceneCompositionWorkspaceState;
  addedScene?: SceneModel;
  error?: string;
} {
  if (state.scenes.length >= MAX_SCENES) {
    return {
      ok: false,
      state,
      error: `Scene limit reached (maximum ${MAX_SCENES} scenes).`,
    };
  }

  const slotIdx = state.scenes.length;
  const defaultLabel = slotLabelForIndex(slotIdx);
  const takenNames = state.scenes.map((s) => s.name);

  if (input?.name !== undefined) {
    const check = validateSceneName(input.name);
    if (!check.ok) {
      return { ok: false, state, error: check.error };
    }
  }

  const desiredName = input?.name
    ? sanitizeSceneName(input.name, defaultLabel)
    : uniqueSceneName(defaultLabel, takenNames, false);

  const existingIds = new Set(state.scenes.map((s) => s.id));
  let newId = input?.id ?? `scene-${slotIdx + 1}`;
  let suffix = 2;
  while (existingIds.has(newId)) {
    newId = `scene-${slotIdx + 1}-${suffix++}`;
  }

  const defaultKinds: Array<SceneDef["kind"]> = ["base", "freespins", "bonus"];
  const kind = input?.kind ?? defaultKinds[slotIdx] ?? "bonus";

  const rawSceneDef: SceneDef = {
    id: newId,
    name: desiredName,
    kind,
    layerIds: (bp.layers ?? []).map((l) => l.id),
    entryTransition: "fade",
    objects: [],
    background: {
      color: bp.style?.palette?.background ?? "#0b1020",
      assetId: bp.canvas?.backgroundAssetId ?? null,
    },
  };

  const addedScene = normalizeSceneModel(rawSceneDef, bp, slotIdx);
  const saved = createSnapshotFromSceneModel(addedScene);
  const draft = cloneSceneLayoutSnapshot(saved);

  const nextScenes = reindexScenes([...state.scenes, addedScene]);
  const nextDrafts: Record<string, PerSceneDraftRecord> = {
    ...state.draftsBySceneId,
    [addedScene.id]: {
      sceneId: addedScene.id,
      saved,
      draft,
      isDirty: false,
      lastModifiedAt: null,
    },
  };

  return {
    ok: true,
    addedScene,
    state: {
      ...state,
      scenes: nextScenes,
      draftsBySceneId: nextDrafts,
      activeSceneId: input?.activate ? addedScene.id : state.activeSceneId,
    },
  };
}

export function duplicateSceneInState(
  state: SceneCompositionWorkspaceState,
  bp: GameBlueprint,
  sourceSceneId: string,
  customName?: string,
): {
  ok: boolean;
  state: SceneCompositionWorkspaceState;
  duplicatedScene?: SceneModel;
  error?: string;
} {
  if (state.scenes.length >= MAX_SCENES) {
    return {
      ok: false,
      state,
      error: `Scene limit reached (maximum ${MAX_SCENES} scenes).`,
    };
  }

  const sourceEffective = getEffectiveSceneModel(state, sourceSceneId, bp);
  if (!sourceEffective) {
    return {
      ok: false,
      state,
      error: `Scene "${sourceSceneId}" not found.`,
    };
  }

  if (customName !== undefined) {
    const check = validateSceneName(customName);
    if (!check.ok) {
      return { ok: false, state, error: check.error };
    }
  }

  const takenNames = state.scenes.map((s) => s.name);
  const dupName = customName
    ? sanitizeSceneName(customName, sourceEffective.name)
    : uniqueSceneName(sourceEffective.name, takenNames, true);

  const existingIds = new Set(state.scenes.map((s) => s.id));
  let dupId = `${sourceEffective.id}-copy`;
  let suffix = 2;
  while (existingIds.has(dupId)) {
    dupId = `${sourceEffective.id}-copy-${suffix++}`;
  }

  // Deep-clone objects with new IDs while preserving exact positions, sizes, rotation, layer order, and visibility
  const sourceObjects = cloneObjects(sourceEffective.objects);
  const dupObjectsResult = duplicateObjects(
    sourceObjects,
    sourceObjects.filter((o) => !o.groupId && !o.parentId).map((o) => o.id),
    0, // offset = 0 so duplicated scene preserves exact object positions
  );
  const clonedObjects =
    sourceObjects.length > 0
      ? dupObjectsResult.objects.slice(sourceObjects.length)
      : [];

  const slotIdx = state.scenes.length;
  const slotLabel = slotLabelForIndex(slotIdx);
  const clonedLayers = cloneLayers(sourceEffective.layers);
  const clonedVisibility = deriveSceneVisibility(
    clonedLayers,
    clonedObjects,
    sourceEffective.visibility,
  );
  const clonedComposedImages = deriveComposedImages(
    clonedObjects,
    clonedLayers,
    bp,
    sourceEffective.composedImages.filter((c) => !c.id.startsWith("comp-obj-")),
  );

  const duplicatedScene: SceneModel = {
    id: dupId,
    name: dupName,
    kind: sourceEffective.kind,
    entryTransition: sourceEffective.entryTransition,
    canvasConfiguration: cloneCanvasConfiguration(
      sourceEffective.canvasConfiguration,
    ),
    background: { ...sourceEffective.background },
    layers: clonedLayers,
    layerIds: [...sourceEffective.layerIds],
    objects: clonedObjects,
    visibility: clonedVisibility,
    composedImages: clonedComposedImages,
    layoutMetadata: {
      ...cloneLayoutMetadata(sourceEffective.layoutMetadata),
      slotIndex: slotIdx + 1,
      slotLabel,
      updatedAt: new Date().toISOString(),
    },
  };

  const saved = createSnapshotFromSceneModel(duplicatedScene);
  const draft = cloneSceneLayoutSnapshot(saved);

  return {
    ok: true,
    duplicatedScene,
    state: {
      ...state,
      scenes: reindexScenes([...state.scenes, duplicatedScene]),
      draftsBySceneId: {
        ...state.draftsBySceneId,
        [duplicatedScene.id]: {
          sceneId: duplicatedScene.id,
          saved,
          draft,
          isDirty: false,
          lastModifiedAt: null,
        },
      },
    },
  };
}

export function renameSceneInState(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  newName: string,
): {
  ok: boolean;
  state: SceneCompositionWorkspaceState;
  error?: string;
} {
  const check = validateSceneName(newName);
  if (!check.ok) {
    return {
      ok: false,
      state,
      error: check.error,
    };
  }

  const target = state.scenes.find((s) => s.id === sceneId);
  if (!target) {
    return {
      ok: false,
      state,
      error: `Scene "${sceneId}" not found.`,
    };
  }

  const cleanName = check.sanitized;
  const nextScenes = state.scenes.map((scene) =>
    scene.id === sceneId ? { ...scene, name: cleanName } : scene,
  );

  const record = state.draftsBySceneId[sceneId];
  const nextDrafts = { ...state.draftsBySceneId };
  if (record) {
    const nextDraft = { ...record.draft, name: cleanName };
    const nextSaved = { ...record.saved, name: cleanName };
    nextDrafts[sceneId] = {
      ...record,
      saved: nextSaved,
      draft: nextDraft,
      isDirty: !areSceneLayoutsEqual(nextSaved, nextDraft),
      lastModifiedAt: new Date().toISOString(),
    };
  }

  return {
    ok: true,
    state: {
      ...state,
      scenes: nextScenes,
      draftsBySceneId: nextDrafts,
    },
  };
}

export function deleteSceneFromState(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
): {
  ok: boolean;
  state: SceneCompositionWorkspaceState;
  error?: string;
} {
  if (state.scenes.length <= MIN_SCENES) {
    return {
      ok: false,
      state,
      error: "At least 1 scene must remain in the project.",
    };
  }

  const index = state.scenes.findIndex((s) => s.id === sceneId);
  if (index < 0) {
    return {
      ok: false,
      state,
      error: `Scene "${sceneId}" not found.`,
    };
  }

  const remaining = reindexScenes(
    state.scenes.filter((s) => s.id !== sceneId),
  );
  const nextDrafts: Record<string, PerSceneDraftRecord> = {};
  for (const scene of remaining) {
    const rec = state.draftsBySceneId[scene.id];
    if (rec) {
      nextDrafts[scene.id] = {
        ...rec,
        saved: {
          ...rec.saved,
          layoutMetadata: {
            ...rec.saved.layoutMetadata,
            slotIndex: scene.layoutMetadata.slotIndex,
            slotLabel: scene.layoutMetadata.slotLabel,
          },
        },
        draft: {
          ...rec.draft,
          layoutMetadata: {
            ...rec.draft.layoutMetadata,
            slotIndex: scene.layoutMetadata.slotIndex,
            slotLabel: scene.layoutMetadata.slotLabel,
          },
        },
      };
    }
  }

  const nextActiveSceneId =
    state.activeSceneId === sceneId
      ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? remaining[0]!.id)
      : state.activeSceneId;

  const pendingSceneSwitch =
    state.pendingSceneSwitch &&
    (state.pendingSceneSwitch.fromSceneId === sceneId ||
      state.pendingSceneSwitch.toSceneId === sceneId)
      ? null
      : state.pendingSceneSwitch;

  return {
    ok: true,
    state: {
      ...state,
      activeSceneId: nextActiveSceneId,
      scenes: remaining,
      draftsBySceneId: nextDrafts,
      pendingSceneSwitch,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Direct Blueprint Helpers for Scene Actions                                 */
/* -------------------------------------------------------------------------- */

export function syncScenesListToBlueprint(
  bp: GameBlueprint,
  state: SceneCompositionWorkspaceState,
): GameBlueprint {
  // Persist each scene's SAVED layout snapshot (not unsaved drafts on other scenes)
  const nextScenes: SceneDef[] = state.scenes.map((scene) => {
    const rec = state.draftsBySceneId[scene.id];
    const model = rec
      ? applySnapshotToSceneModel(scene, rec.saved, bp)
      : scene;
    return sceneModelToSceneDef(model);
  });

  return {
    ...bp,
    scenes: nextScenes,
  };
}

export function addSceneToBlueprint(
  bp: GameBlueprint,
  input?: { id?: string; name?: string; kind?: SceneDef["kind"] },
): {
  ok: boolean;
  blueprint: GameBlueprint;
  addedScene?: SceneDef;
  error?: string;
} {
  const initialState = createSceneCompositionState(bp);
  const res = addSceneToState(initialState, bp, input);
  if (!res.ok || !res.addedScene) {
    return { ok: false, blueprint: bp, error: res.error };
  }
  const updatedBp = syncScenesListToBlueprint(bp, res.state);
  const addedDef = updatedBp.scenes.find((s) => s.id === res.addedScene!.id);
  return {
    ok: true,
    blueprint: updatedBp,
    addedScene: addedDef,
  };
}

export function duplicateSceneInBlueprint(
  bp: GameBlueprint,
  sourceSceneId: string,
  customName?: string,
): {
  ok: boolean;
  blueprint: GameBlueprint;
  duplicatedScene?: SceneDef;
  error?: string;
} {
  const initialState = createSceneCompositionState(bp);
  const res = duplicateSceneInState(initialState, bp, sourceSceneId, customName);
  if (!res.ok || !res.duplicatedScene) {
    return { ok: false, blueprint: bp, error: res.error };
  }
  const updatedBp = syncScenesListToBlueprint(bp, res.state);
  const dupDef = updatedBp.scenes.find((s) => s.id === res.duplicatedScene!.id);
  return {
    ok: true,
    blueprint: updatedBp,
    duplicatedScene: dupDef,
  };
}

export function renameSceneInBlueprint(
  bp: GameBlueprint,
  sceneId: string,
  newName: string,
): {
  ok: boolean;
  blueprint: GameBlueprint;
  error?: string;
} {
  const check = validateSceneName(newName);
  if (!check.ok) {
    return { ok: false, blueprint: bp, error: check.error };
  }
  if (!bp.scenes.some((s) => s.id === sceneId)) {
    return { ok: false, blueprint: bp, error: `Scene "${sceneId}" not found.` };
  }
  return {
    ok: true,
    blueprint: {
      ...bp,
      scenes: bp.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, name: check.sanitized } : scene,
      ),
    },
  };
}

export function deleteSceneFromBlueprint(
  bp: GameBlueprint,
  sceneId: string,
): {
  ok: boolean;
  blueprint: GameBlueprint;
  activeSceneId: string;
  error?: string;
} {
  const initialState = createSceneCompositionState(bp);
  const res = deleteSceneFromState(initialState, sceneId);
  if (!res.ok) {
    return {
      ok: false,
      blueprint: bp,
      activeSceneId: initialState.activeSceneId,
      error: res.error,
    };
  }
  return {
    ok: true,
    blueprint: syncScenesListToBlueprint(bp, res.state),
    activeSceneId: res.state.activeSceneId,
  };
}

/* -------------------------------------------------------------------------- */
/* Independent Per-Scene Layout Mutations                                     */
/* -------------------------------------------------------------------------- */

export function updateSceneLayoutDraft(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  updater: (draft: SceneLayoutSnapshot) => SceneLayoutSnapshot,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  const record = state.draftsBySceneId[sceneId];
  if (!record) return state;

  const updatedRaw = updater(cloneSceneLayoutSnapshot(record.draft));
  const visibility = deriveSceneVisibility(
    updatedRaw.layers,
    updatedRaw.objects,
    updatedRaw.visibility,
  );
  const composedImages = deriveComposedImages(
    updatedRaw.objects,
    updatedRaw.layers,
    bp,
    updatedRaw.composedImages,
  );

  const blueprintLayerIdSet = new Set((bp?.layers ?? []).map((l) => l.id));
  const computedLayerIds = updatedRaw.layers
    .filter(
      (l) =>
        l.visible &&
        (blueprintLayerIdSet.size === 0 || blueprintLayerIdSet.has(l.id)),
    )
    .map((l) => l.id);

  const nextDraft: SceneLayoutSnapshot = {
    ...updatedRaw,
    name: sanitizeSceneName(updatedRaw.name, record.draft.name),
    layerIds:
      computedLayerIds.length > 0 ? computedLayerIds : updatedRaw.layerIds,
    visibility,
    composedImages,
    layoutMetadata: {
      ...updatedRaw.layoutMetadata,
      updatedAt: new Date().toISOString(),
    },
  };

  const isDirty = !areSceneLayoutsEqual(record.saved, nextDraft);

  return {
    ...state,
    draftsBySceneId: {
      ...state.draftsBySceneId,
      [sceneId]: {
        ...record,
        draft: nextDraft,
        isDirty,
        lastModifiedAt: new Date().toISOString(),
      },
    },
  };
}

export function setSceneObjectPosition(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  objectId: string,
  position: { x: number; y: number },
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      objects: draft.objects.map((obj) =>
        obj.id === objectId
          ? {
              ...obj,
              x: position.x,
              y: position.y,
              transform: {
                ...(obj.transform ?? {
                  width: obj.width,
                  height: obj.height,
                  scaleX: 1,
                  scaleY: 1,
                  rotation: obj.rotation,
                }),
                x: position.x,
                y: position.y,
              },
            }
          : obj,
      ),
    }),
    bp,
  );
}

export function setSceneObjectSize(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  objectId: string,
  size: { width: number; height: number },
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      objects: draft.objects.map((obj) =>
        obj.id === objectId
          ? {
              ...obj,
              width,
              height,
              transform: {
                ...(obj.transform ?? {
                  x: obj.x,
                  y: obj.y,
                  scaleX: 1,
                  scaleY: 1,
                  rotation: obj.rotation,
                }),
                width,
                height,
              },
            }
          : obj,
      ),
    }),
    bp,
  );
}

export function setSceneObjectRotation(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  objectId: string,
  rotation: number,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      objects: draft.objects.map((obj) =>
        obj.id === objectId
          ? {
              ...obj,
              rotation,
              transform: {
                ...(obj.transform ?? {
                  x: obj.x,
                  y: obj.y,
                  width: obj.width,
                  height: obj.height,
                  scaleX: 1,
                  scaleY: 1,
                }),
                rotation,
              },
            }
          : obj,
      ),
    }),
    bp,
  );
}

export function reorderSceneLayers(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  sourceLayerId: string,
  targetLayerId: string,
  position: "before" | "after",
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      layers: reorderBlueprintLayers(
        draft.layers,
        sourceLayerId,
        targetLayerId,
        position,
      ),
    }),
    bp,
  );
}

export function reorderSceneObjects(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  objectId: string,
  order: Order,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      objects: reorderObjects(draft.objects, objectId, order),
    }),
    bp,
  );
}

export function setSceneLayerVisibility(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  layerId: string,
  visible: boolean,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      layers: draft.layers.map((layer) =>
        layer.id === layerId ? { ...layer, visible } : layer,
      ),
      visibility: {
        ...draft.visibility,
        layers: {
          ...draft.visibility.layers,
          [layerId]: visible,
        },
      },
    }),
    bp,
  );
}

export function setSceneObjectVisibility(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  objectId: string,
  visible: boolean,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      objects: draft.objects.map((obj) =>
        obj.id === objectId ? { ...obj, visible } : obj,
      ),
      visibility: {
        ...draft.visibility,
        objects: {
          ...draft.visibility.objects,
          [objectId]: visible,
        },
      },
    }),
    bp,
  );
}

export function setSceneBackgroundSelection(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  backgroundPatch: Partial<SceneBackground>,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      background: {
        ...draft.background,
        ...backgroundPatch,
      },
    }),
    bp,
  );
}

export function upsertSceneComposedImage(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  imageRef: SceneComposedImageRef,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => {
      const exists = draft.composedImages.some((c) => c.id === imageRef.id);
      const nextComposed = exists
        ? draft.composedImages.map((c) =>
            c.id === imageRef.id ? { ...imageRef } : c,
          )
        : [...draft.composedImages, { ...imageRef }];
      return {
        ...draft,
        composedImages: nextComposed,
      };
    },
    bp,
  );
}

export function removeSceneComposedImage(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  imageId: string,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      composedImages: draft.composedImages.filter((c) => c.id !== imageId),
    }),
    bp,
  );
}

export function setSceneCanvasConfiguration(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  patch: Partial<SceneCanvasConfiguration>,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      canvasConfiguration: {
        ...draft.canvasConfiguration,
        ...patch,
        safeArea: patch.safeArea
          ? { ...patch.safeArea }
          : { ...draft.canvasConfiguration.safeArea },
      },
    }),
    bp,
  );
}

export function setSceneLayoutMetadata(
  state: SceneCompositionWorkspaceState,
  sceneId: string,
  patch: Partial<SceneLayoutMetadata>,
  bp?: Pick<GameBlueprint, "layers" | "assets" | "symbols" | "elements">,
): SceneCompositionWorkspaceState {
  return updateSceneLayoutDraft(
    state,
    sceneId,
    (draft) => ({
      ...draft,
      layoutMetadata: {
        ...draft.layoutMetadata,
        ...patch,
      },
    }),
    bp,
  );
}

/* -------------------------------------------------------------------------- */
/* Save Layout & Unsaved Changes Scene Switch Flow (Save / Discard / Cancel)  */
/* -------------------------------------------------------------------------- */

/**
 * Saving only saves the active scene's layout changes.
 * Any unsaved draft changes on non-active scenes remain in their draft state
 * and are NOT written to the persisted blueprint.
 * Shared global game configuration (reels, math, symbols) is preserved intact.
 */
export function saveActiveSceneLayout(
  state: SceneCompositionWorkspaceState,
  bp: GameBlueprint,
): {
  state: SceneCompositionWorkspaceState;
  blueprint: GameBlueprint;
  savedScene: SceneDef;
} {
  const activeId = state.activeSceneId;
  const activeModel = state.scenes.find((s) => s.id === activeId) ?? state.scenes[0]!;
  const record = state.draftsBySceneId[activeModel.id];

  const committedSnapshot = record
    ? cloneSceneLayoutSnapshot(record.draft)
    : createSnapshotFromSceneModel(activeModel);

  const updatedSceneModel = applySnapshotToSceneModel(
    activeModel,
    committedSnapshot,
    bp,
  );
  const savedSceneDef = sceneModelToSceneDef(updatedSceneModel);

  const nextScenes = state.scenes.map((s) =>
    s.id === activeModel.id ? updatedSceneModel : s,
  );

  const nextDrafts: Record<string, PerSceneDraftRecord> = {
    ...state.draftsBySceneId,
    [activeModel.id]: {
      sceneId: activeModel.id,
      saved: cloneSceneLayoutSnapshot(committedSnapshot),
      draft: cloneSceneLayoutSnapshot(committedSnapshot),
      isDirty: false,
      lastModifiedAt: new Date().toISOString(),
    },
  };

  // Only update the active scene in blueprint.scenes; preserve other scenes' saved state
  // and preserve all shared global configuration (reels, math, symbols, paylines, paytable).
  const existingSceneIds = new Set((bp.scenes ?? []).map((s) => s.id));
  const updatedBlueprintScenes: SceneDef[] = nextScenes.map((sceneModel) => {
    if (sceneModel.id === activeModel.id) {
      return savedSceneDef;
    }
    const existingInBp = (bp.scenes ?? []).find((s) => s.id === sceneModel.id);
    if (existingInBp && existingSceneIds.has(sceneModel.id)) {
      return existingInBp;
    }
    const savedRec = nextDrafts[sceneModel.id];
    const cleanModel = savedRec
      ? applySnapshotToSceneModel(sceneModel, savedRec.saved, bp)
      : sceneModel;
    return sceneModelToSceneDef(cleanModel);
  });

  const nextBlueprint: GameBlueprint = {
    ...bp,
    scenes: updatedBlueprintScenes,
  };

  return {
    state: {
      ...state,
      scenes: nextScenes,
      draftsBySceneId: nextDrafts,
      sharedGlobalConfig: extractSharedGlobalConfig(nextBlueprint),
    },
    blueprint: nextBlueprint,
    savedScene: savedSceneDef,
  };
}

export function discardSceneChanges(
  state: SceneCompositionWorkspaceState,
  sceneId = state.activeSceneId,
): SceneCompositionWorkspaceState {
  const record = state.draftsBySceneId[sceneId];
  if (!record) return state;

  const revertedDraft = cloneSceneLayoutSnapshot(record.saved);
  return {
    ...state,
    draftsBySceneId: {
      ...state.draftsBySceneId,
      [sceneId]: {
        ...record,
        draft: revertedDraft,
        isDirty: false,
        lastModifiedAt: null,
      },
    },
  };
}

export function requestSceneSwitch(
  state: SceneCompositionWorkspaceState,
  targetSceneId: string,
): {
  switchedImmediately: boolean;
  promptRequired: boolean;
  state: SceneCompositionWorkspaceState;
} {
  if (targetSceneId === state.activeSceneId) {
    return {
      switchedImmediately: false,
      promptRequired: false,
      state: { ...state, pendingSceneSwitch: null },
    };
  }

  const targetScene = state.scenes.find((s) => s.id === targetSceneId);
  const currentScene = state.scenes.find((s) => s.id === state.activeSceneId);
  if (!targetScene || !currentScene) {
    return {
      switchedImmediately: false,
      promptRequired: false,
      state,
    };
  }

  const currentDirty = isSceneDirty(state, state.activeSceneId);
  if (!currentDirty) {
    return {
      switchedImmediately: true,
      promptRequired: false,
      state: {
        ...state,
        activeSceneId: targetSceneId,
        pendingSceneSwitch: null,
      },
    };
  }

  const prompt: PendingSceneSwitchPrompt = {
    fromSceneId: currentScene.id,
    toSceneId: targetScene.id,
    fromSceneName:
      state.draftsBySceneId[currentScene.id]?.draft.name ?? currentScene.name,
    toSceneName:
      state.draftsBySceneId[targetScene.id]?.draft.name ?? targetScene.name,
  };

  return {
    switchedImmediately: false,
    promptRequired: true,
    state: {
      ...state,
      pendingSceneSwitch: prompt,
    },
  };
}

export function resolveUnsavedSceneSwitch(
  state: SceneCompositionWorkspaceState,
  bp: GameBlueprint,
  resolution: UnsavedSwitchResolution,
): {
  state: SceneCompositionWorkspaceState;
  blueprint: GameBlueprint;
  savedSceneId: string | null;
} {
  const prompt = state.pendingSceneSwitch;
  if (!prompt) {
    return { state, blueprint: bp, savedSceneId: null };
  }

  if (resolution === "cancel") {
    return {
      state: {
        ...state,
        pendingSceneSwitch: null,
      },
      blueprint: bp,
      savedSceneId: null,
    };
  }

  if (resolution === "discard") {
    const discardedState = discardSceneChanges(state, prompt.fromSceneId);
    return {
      state: {
        ...discardedState,
        activeSceneId: prompt.toSceneId,
        pendingSceneSwitch: null,
      },
      blueprint: bp,
      savedSceneId: null,
    };
  }

  // resolution === "save": Save ONLY the active scene's layout changes, then switch to toSceneId
  const savedResult = saveActiveSceneLayout(state, bp);
  return {
    state: {
      ...savedResult.state,
      activeSceneId: prompt.toSceneId,
      pendingSceneSwitch: null,
    },
    blueprint: savedResult.blueprint,
    savedSceneId: prompt.fromSceneId,
  };
}
