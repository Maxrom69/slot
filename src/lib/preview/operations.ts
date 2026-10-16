/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F17 — Preview Controls pure deterministic operations.
 *
 * Consumes GameBlueprint to produce a deterministic presentation model for:
 * - background
 * - reel frame
 * - reel area & symbols
 * - buttons
 * - overlays (paylines, FX, grid, guides)
 * - standalone layers & scene objects
 *
 * Strictly zero fake RNG and zero frontend-generated payout calculation.
 */

import type {
  AssetRef,
  BlendMode,
  ElementDef,
  GameBlueprint,
  LayerDef,
  SymbolDef,
} from "@/lib/blueprint/types";
import { PAYLINE_COLOR_PALETTE } from "@/lib/paylines";
import { createDisconnectedRuntimeAdapter } from "./runtime-adapter";
import type {
  PreviewAnimationCapabilities,
  PreviewAnimationTrigger,
  PreviewButtonItem,
  PreviewPaylineOverlay,
  PreviewPresentationCell,
  PreviewPresentationLayerItem,
  PreviewPresentationModel,
  PreviewStandaloneLayerElement,
  PreviewState,
  PreviewToolbarState,
  RuntimeSpinResponse,
  SlotRuntimeAdapter,
} from "./types";

export const MIN_PREVIEW_ZOOM = 0.25;
export const MAX_PREVIEW_ZOOM = 2.5;
export const DEFAULT_PREVIEW_ZOOM = 1;

export function clampPreviewZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return DEFAULT_PREVIEW_ZOOM;
  return Math.round(Math.min(MAX_PREVIEW_ZOOM, Math.max(MIN_PREVIEW_ZOOM, zoom)) * 100) / 100;
}

export function createDefaultToolbarState(): PreviewToolbarState {
  return {
    zoom: DEFAULT_PREVIEW_ZOOM,
    fitMode: true,
    panX: 0,
    panY: 0,
    fullscreen: false,
    showGrid: false,
    showGuides: true,
  };
}

export function detectPreviewAnimationCapabilities(
  blueprint: GameBlueprint,
): PreviewAnimationCapabilities {
  const registeredAnimations = blueprint.animations ?? [];
  const elementAnimations = (blueprint.elements ?? [])
    .filter((el) => el.animation && el.animation.preset && el.animation.preset !== "none")
    .map((el) => ({
      elementId: el.id,
      elementName: el.name,
      preset: el.animation!.preset,
      trigger: el.animation!.trigger,
      durationMs: el.animation!.durationMs,
      loop: el.animation!.loop,
    }));

  const spriteAssets: AssetRef[] = (blueprint.assets ?? []).filter(
    (asset) =>
      asset.kind === "sprite" ||
      asset.kind === "spine" ||
      asset.format === "json-animation" ||
      asset.tags?.some((t) =>
        ["sprite", "animation", "spine", "lottie"].includes(t.toLowerCase()),
      ),
  );

  const configuredSpriteAnims = registeredAnimations.filter(
    (a) =>
      a.state !== "disabled" &&
      (a.source === "sprite_sheet" ||
        Boolean(a.spriteSheetReference?.uri) ||
        Boolean(a.spriteSheetReference?.assetId)),
  );

  const bgAnimations = registeredAnimations.filter(
    (a) =>
      a.state !== "disabled" &&
      (a.animationType === "Background" ||
        a.target === "layer-bg" ||
        a.target.toLowerCase().includes("bg") ||
        a.target.toLowerCase().includes("background") ||
        a.kind.toLowerCase().includes("ambient") ||
        a.kind.toLowerCase().includes("background")),
  );
  const bgElementAnims = (blueprint.elements ?? []).filter(
    (el) =>
      el.type === "game_background" &&
      el.animation &&
      el.animation.preset !== "none",
  );
  const hasBgLayer = (blueprint.layers ?? []).some((l) => l.kind === "background");
  const hasBackgroundAnimation =
    bgAnimations.length > 0 || bgElementAnims.length > 0 || (hasBgLayer && registeredAnimations.length > 0);

  const winAnimations = registeredAnimations.filter(
    (a) =>
      a.state !== "disabled" &&
      (a.animationType === "Symbol Win" ||
        a.trigger === "win" ||
        a.trigger === "big_win" ||
        a.target === "layer-fx" ||
        a.kind.toLowerCase().includes("symbol") ||
        a.kind.toLowerCase().includes("win")),
  );
  const hasSymbolWinAnimation = winAnimations.length > 0 || elementAnimations.length > 0;
  const hasSpriteAnimations = spriteAssets.length > 0 || configuredSpriteAnims.length > 0;

  return {
    hasBackgroundAnimation,
    backgroundAnimationReason: hasBackgroundAnimation
      ? `${Math.max(1, bgAnimations.length + bgElementAnims.length)} background/ambient animation preset(s) configured`
      : "No background animation asset or preset registered in GameBlueprint",
    hasSymbolWinAnimation,
    symbolWinAnimationReason: hasSymbolWinAnimation
      ? `${winAnimations.length + elementAnimations.length} win/symbol animation definition(s) registered`
      : "No symbol win animation registered in GameBlueprint",
    hasSpriteAnimations,
    spriteAnimationsReason: hasSpriteAnimations
      ? `${spriteAssets.length} sprite / JSON animation asset(s) registered`
      : "Unavailable — no sprite or JSON animation assets uploaded in Asset Library",
    registeredAnimations,
    elementAnimations,
    spriteAssets,
  };
}

export function createDefaultPreviewState(blueprint: GameBlueprint): PreviewState {
  const firstSceneId = blueprint.scenes[0]?.id ?? "scene-base";
  const capabilities = detectPreviewAnimationCapabilities(blueprint);
  return {
    activeSceneId: firstSceneId,
    stripOffset: 0,
    selectedSymbolId: null,
    selectedPaylineId: null,
    showPaylines: true,
    showLayerBadges: true,
    betIndex: Math.min(2, Math.max(0, (blueprint.math?.betLevels?.length ?? 1) - 1)),
    layerVisibilityOverrides: {},
    toolbar: createDefaultToolbarState(),
    layerAnimations: {
      showBackgroundAnimation: capabilities.hasBackgroundAnimation,
      showSymbolWinAnimation: false,
      playAnimationsAsSprites: false,
      activeAnimationTrigger: "idle",
    },
    lastSpinAttempt: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Preview Toolbar State Transitions                                          */
/* -------------------------------------------------------------------------- */

export function setPreviewZoom(state: PreviewState, zoom: number): PreviewState {
  return {
    ...state,
    toolbar: {
      ...state.toolbar,
      zoom: clampPreviewZoom(zoom),
      fitMode: false,
    },
  };
}

export function stepPreviewZoom(state: PreviewState, delta: number): PreviewState {
  return setPreviewZoom(state, state.toolbar.zoom + delta);
}

export function fitPreviewToViewport(
  state: PreviewState,
  viewportWidth = 960,
  viewportHeight = 560,
  canvasWidth = 1920,
  canvasHeight = 1080,
): PreviewState {
  const safeW = Math.max(240, viewportWidth - 48);
  const safeH = Math.max(180, viewportHeight - 48);
  const ratioW = safeW / Math.max(1, canvasWidth);
  const ratioH = safeH / Math.max(1, canvasHeight);
  const computedZoom = clampPreviewZoom(Math.min(1, Math.min(ratioW, ratioH)));
  return {
    ...state,
    toolbar: {
      ...state.toolbar,
      zoom: computedZoom,
      fitMode: true,
      panX: 0,
      panY: 0,
    },
  };
}

export function resetPreviewView(state: PreviewState): PreviewState {
  return {
    ...state,
    toolbar: {
      ...state.toolbar,
      zoom: DEFAULT_PREVIEW_ZOOM,
      fitMode: false,
      panX: 0,
      panY: 0,
    },
  };
}

export function setPreviewPan(
  state: PreviewState,
  panX: number,
  panY: number,
): PreviewState {
  return {
    ...state,
    toolbar: {
      ...state.toolbar,
      panX: Number.isFinite(panX) ? Math.round(panX) : 0,
      panY: Number.isFinite(panY) ? Math.round(panY) : 0,
    },
  };
}

export function togglePreviewFullscreen(
  state: PreviewState,
  force?: boolean,
): PreviewState {
  const next = force ?? !state.toolbar.fullscreen;
  return {
    ...state,
    toolbar: {
      ...state.toolbar,
      fullscreen: next,
    },
  };
}

export function togglePreviewGrid(
  state: PreviewState,
  force?: boolean,
): PreviewState {
  const next = force ?? !state.toolbar.showGrid;
  return {
    ...state,
    toolbar: {
      ...state.toolbar,
      showGrid: next,
    },
  };
}

export function togglePreviewGuides(
  state: PreviewState,
  force?: boolean,
): PreviewState {
  const next = force ?? !state.toolbar.showGuides;
  return {
    ...state,
    toolbar: {
      ...state.toolbar,
      showGuides: next,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Scene, Layer, Symbol, Payline & Animation State Transitions                */
/* -------------------------------------------------------------------------- */

export function selectPreviewScene(
  state: PreviewState,
  sceneId: string,
): PreviewState {
  return {
    ...state,
    activeSceneId: sceneId,
  };
}

export function setPreviewStripOffset(
  state: PreviewState,
  stripOffset: number,
): PreviewState {
  const normalized = Number.isFinite(stripOffset)
    ? Math.max(0, Math.floor(stripOffset))
    : 0;
  return {
    ...state,
    stripOffset: normalized,
  };
}

export function selectPreviewSymbol(
  state: PreviewState,
  symbolId: string | null,
): PreviewState {
  return {
    ...state,
    selectedSymbolId:
      state.selectedSymbolId === symbolId ? null : symbolId,
  };
}

export function selectPreviewPayline(
  state: PreviewState,
  paylineId: string | null,
): PreviewState {
  return {
    ...state,
    selectedPaylineId:
      state.selectedPaylineId === paylineId ? null : paylineId,
  };
}

export function togglePreviewPaylines(
  state: PreviewState,
  force?: boolean,
): PreviewState {
  return {
    ...state,
    showPaylines: force ?? !state.showPaylines,
  };
}

export function togglePreviewLayerVisibility(
  state: PreviewState,
  layerId: string,
  blueprintLayers: LayerDef[],
): PreviewState {
  const layer = blueprintLayers.find((l) => l.id === layerId);
  const baseVisible = layer ? layer.visible : true;
  const currentEffective =
    layerId in state.layerVisibilityOverrides
      ? state.layerVisibilityOverrides[layerId]!
      : baseVisible;

  const nextOverrides = {
    ...state.layerVisibilityOverrides,
    [layerId]: !currentEffective,
  };

  if (nextOverrides[layerId] === baseVisible) {
    delete nextOverrides[layerId];
  }

  return {
    ...state,
    layerVisibilityOverrides: nextOverrides,
  };
}

export function resetPreviewLayerVisibility(state: PreviewState): PreviewState {
  return {
    ...state,
    layerVisibilityOverrides: {},
  };
}

export function setPreviewBetIndex(
  state: PreviewState,
  betIndex: number,
  betLevelsCount: number,
): PreviewState {
  const maxIndex = Math.max(0, betLevelsCount - 1);
  const clamped = Math.min(maxIndex, Math.max(0, Math.floor(betIndex)));
  return {
    ...state,
    betIndex: clamped,
  };
}

export function toggleBackgroundAnimation(
  state: PreviewState,
  capabilities: PreviewAnimationCapabilities,
  force?: boolean,
): PreviewState {
  if (!capabilities.hasBackgroundAnimation) {
    return {
      ...state,
      layerAnimations: {
        ...state.layerAnimations,
        showBackgroundAnimation: false,
      },
    };
  }
  return {
    ...state,
    layerAnimations: {
      ...state.layerAnimations,
      showBackgroundAnimation:
        force ?? !state.layerAnimations.showBackgroundAnimation,
    },
  };
}

export function toggleSymbolWinAnimation(
  state: PreviewState,
  capabilities: PreviewAnimationCapabilities,
  force?: boolean,
): PreviewState {
  if (!capabilities.hasSymbolWinAnimation) {
    return {
      ...state,
      layerAnimations: {
        ...state.layerAnimations,
        showSymbolWinAnimation: false,
      },
    };
  }
  const next = force ?? !state.layerAnimations.showSymbolWinAnimation;
  return {
    ...state,
    layerAnimations: {
      ...state.layerAnimations,
      showSymbolWinAnimation: next,
      activeAnimationTrigger:
        next && state.layerAnimations.activeAnimationTrigger === "idle"
          ? "win"
          : !next && state.layerAnimations.activeAnimationTrigger === "win"
          ? "idle"
          : state.layerAnimations.activeAnimationTrigger,
    },
  };
}

export function togglePlayAnimationsAsSprites(
  state: PreviewState,
  capabilities: PreviewAnimationCapabilities,
  force?: boolean,
): PreviewState {
  if (!capabilities.hasSpriteAnimations) {
    return {
      ...state,
      layerAnimations: {
        ...state.layerAnimations,
        playAnimationsAsSprites: false,
      },
    };
  }
  return {
    ...state,
    layerAnimations: {
      ...state.layerAnimations,
      playAnimationsAsSprites:
        force ?? !state.layerAnimations.playAnimationsAsSprites,
    },
  };
}

export function setPreviewAnimationTrigger(
  state: PreviewState,
  trigger: PreviewAnimationTrigger,
): PreviewState {
  return {
    ...state,
    layerAnimations: {
      ...state.layerAnimations,
      activeAnimationTrigger: trigger,
      showSymbolWinAnimation:
        trigger === "win" || trigger === "big_win"
          ? true
          : state.layerAnimations.showSymbolWinAnimation,
    },
  };
}

export function recordPreviewSpinAttempt(
  state: PreviewState,
  response: RuntimeSpinResponse,
): PreviewState {
  return {
    ...state,
    lastSpinAttempt: response,
  };
}

/* -------------------------------------------------------------------------- */
/* Deterministic Presentation Model Builder                                   */
/* -------------------------------------------------------------------------- */

function resolveAssetUri(
  assetId: string | null | undefined,
  assetMap: Map<string, AssetRef>,
): string | null {
  if (!assetId) return null;
  const asset = assetMap.get(assetId);
  if (!asset || asset.state !== "linked" || !asset.uri) return null;
  return asset.uri;
}

function resolveElementAssetUri(
  element: ElementDef | undefined,
  assetMap: Map<string, AssetRef>,
): string | null {
  if (!element) return null;
  if (element.image?.provider === "external" && element.image.uri) {
    return element.image.uri;
  }
  const id = element.image?.assetId ?? element.assetId;
  return resolveAssetUri(id, assetMap);
}

function resolveSymbolThumbnailUri(
  symbol: SymbolDef | undefined,
  assetMap: Map<string, AssetRef>,
): string | null {
  if (!symbol) return null;
  if (symbol.image?.provider === "external" && symbol.image.uri) {
    return symbol.image.uri;
  }
  const id = symbol.image?.assetId ?? symbol.assetId;
  return resolveAssetUri(id, assetMap);
}

function buildStandaloneElementModel(
  element: ElementDef,
  assetMap: Map<string, AssetRef>,
  activeTrigger: PreviewAnimationTrigger,
): PreviewStandaloneLayerElement {
  const animPreset =
    element.animation && element.animation.preset !== "none"
      ? element.animation.preset
      : null;
  const animationActive = Boolean(
    animPreset &&
      (activeTrigger === "idle" ||
        element.animation?.trigger === activeTrigger ||
        element.animation?.loop),
  );
  return {
    id: element.id,
    name: element.name,
    type: element.type,
    group: element.group,
    assetId: element.assetId,
    assetUri: resolveElementAssetUri(element, assetMap),
    opacity: element.style?.opacity ?? 1,
    blendMode: element.style?.blendMode ?? "normal",
    tintColor: element.style?.tintColor ?? null,
    animationPreset: animPreset,
    animationActive,
  };
}

export function buildPreviewPresentation(
  blueprint: GameBlueprint,
  state?: PreviewState,
  runtimeAdapter?: SlotRuntimeAdapter | null,
): PreviewPresentationModel {
  const previewState = state ?? createDefaultPreviewState(blueprint);
  const adapter = runtimeAdapter ?? createDisconnectedRuntimeAdapter();
  const capabilities = detectPreviewAnimationCapabilities(blueprint);

  const assetMap = new Map<string, AssetRef>(
    (blueprint.assets ?? []).map((a) => [a.id, a]),
  );
  const symbolMap = new Map<string, SymbolDef>(
    (blueprint.symbols ?? []).map((s) => [s.id, s]),
  );

  const specialWildIds = new Set<string>(
    (blueprint.specialSymbols ?? [])
      .filter((s) => s.behaviour === "wild")
      .map((s) => s.symbolId),
  );
  const specialScatterIds = new Set<string>(
    (blueprint.specialSymbols ?? [])
      .filter((s) => s.behaviour === "scatter")
      .map((s) => s.symbolId),
  );
  const specialBonusIds = new Set<string>(
    (blueprint.specialSymbols ?? [])
      .filter((s) => s.behaviour === "bonus")
      .map((s) => s.symbolId),
  );

  // Scene resolution (scene-aware preview)
  const scenes = blueprint.scenes ?? [];
  const activeSceneDef =
    scenes.find((s) => s.id === previewState.activeSceneId) ??
    scenes[0] ?? {
      id: "scene-base",
      name: "Base game",
      kind: "base" as const,
      layerIds: (blueprint.layers ?? []).map((l) => l.id),
      entryTransition: "fade",
      objects: [],
    };

  const sceneLayerIdSet = new Set<string>(activeSceneDef.layerIds ?? []);
  const sceneObjects = (activeSceneDef.objects ?? []).filter((obj) =>
    activeSceneDef.visibility?.objects?.[obj.id] !== undefined
      ? activeSceneDef.visibility.objects[obj.id]
      : obj.visible,
  );

  // Ordered layers with scene-aware membership + visibility overrides
  const rawSceneLayers =
    activeSceneDef.layers && activeSceneDef.layers.length > 0
      ? activeSceneDef.layers
      : (blueprint.layers ?? []);
  const sortedLayers = [...rawSceneLayers].sort(
    (a, b) => a.order - b.order,
  );
  const layers: PreviewPresentationLayerItem[] = sortedLayers.map((layer) => {
    const inActiveScene =
      sceneLayerIdSet.size === 0 || sceneLayerIdSet.has(layer.id);
    const overridden = layer.id in previewState.layerVisibilityOverrides;
    const sceneVisFlag =
      activeSceneDef.visibility?.layers?.[layer.id] !== undefined
        ? activeSceneDef.visibility.layers[layer.id]!
        : layer.visible;
    const effectiveVisible = overridden
      ? previewState.layerVisibilityOverrides[layer.id]!
      : sceneVisFlag && inActiveScene;
    const objectCount = sceneObjects.filter(
      (obj) => obj.layerId === layer.id,
    ).length;

    return {
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      order: layer.order,
      blueprintVisible: layer.visible,
      inActiveScene,
      effectiveVisible,
      overridden,
      locked: layer.locked,
      opacity: layer.opacity,
      blendMode: layer.blendMode ?? "normal",
      objectCount,
    };
  });

  const findLayerByKind = (
    kind: LayerDef["kind"],
  ): PreviewPresentationLayerItem | undefined =>
    layers.find((l) => l.kind === kind);

  const bgLayer = findLayerByKind("background");
  const reelsLayer = findLayerByKind("reels");
  const frameLayer = findLayerByKind("frame");
  const uiLayer = findLayerByKind("ui");
  const fxLayer = findLayerByKind("fx");

  // Elements resolution
  const bgElement = (blueprint.elements ?? []).find(
    (el) => el.type === "game_background",
  );
  const frameElement = (blueprint.elements ?? []).find(
    (el) => el.type === "reel_frame",
  );
  const titleElementDef = (blueprint.elements ?? []).find(
    (el) => el.type === "game_title",
  );
  const buttonSetElement = (blueprint.elements ?? []).find(
    (el) => el.type === "button_set",
  );
  const standaloneElementDefs = (blueprint.elements ?? []).filter(
    (el) =>
      el.type === "uploaded" ||
      el.type === "custom" ||
      el.type === "other_asset",
  );

  // Active reels & strips resolution (prefers reelConfiguration when present)
  const columns =
    blueprint.reelConfiguration?.columns ??
    blueprint.reels?.columns ??
    blueprint.grid?.columns ??
    5;
  const rows =
    blueprint.reelConfiguration?.rows ??
    blueprint.reels?.rows ??
    blueprint.grid?.rows ??
    3;
  const evaluation =
    blueprint.reelConfiguration?.evaluation ??
    blueprint.reels?.evaluation ??
    blueprint.grid?.evaluation ??
    "lines";
  const spinDirection =
    blueprint.reelConfiguration?.spinDirection ??
    blueprint.reels?.spinDirection ??
    "down";
  const strips =
    blueprint.reelConfiguration?.strips?.length === columns
      ? blueprint.reelConfiguration.strips
      : blueprint.reels?.strips ?? [];

  const maxStripLength = Math.max(
    rows,
    ...strips.map((s) => s.length),
  );

  // Paylines resolution (prefers paylineConfiguration when present)
  const rawPaylines =
    blueprint.paylineConfiguration?.paylines ?? blueprint.paylines ?? [];

  const paylineOverlays: PreviewPaylineOverlay[] = rawPaylines.map(
    (pl, idx) => {
      const color =
        pl.color ?? PAYLINE_COLOR_PALETTE[idx % PAYLINE_COLOR_PALETTE.length]!;
      const nodeCoords = Array.from({ length: columns }, (_, colIdx) => {
        const clampedRow = Math.min(
          rows - 1,
          Math.max(0, pl.pattern[colIdx] ?? 0),
        );
        const xPct = ((colIdx + 0.5) / columns) * 100;
        const yPct = ((clampedRow + 0.5) / rows) * 100;
        return { colIdx, rowIdx: clampedRow, xPct, yPct };
      });
      const svgPoints = nodeCoords
        .map((pt) => `${pt.xPct.toFixed(2)},${pt.yPct.toFixed(2)}`)
        .join(" ");

      return {
        id: pl.id,
        index: pl.index,
        name: pl.name ?? `Line ${pl.index}`,
        pattern: pl.pattern.slice(0, columns),
        active: pl.active,
        color,
        selected: previewState.selectedPaylineId === pl.id,
        svgPoints,
        nodeCoords,
      };
    },
  );

  const visiblePaylines = previewState.showPaylines
    ? paylineOverlays.filter(
        (pl) =>
          pl.active &&
          (!previewState.selectedPaylineId ||
            pl.id === previewState.selectedPaylineId),
      )
    : [];

  // Build deterministic grid cells (rows × columns)
  const winAnimEnabled =
    capabilities.hasSymbolWinAnimation &&
    previewState.layerAnimations.showSymbolWinAnimation;
  const spriteAnimEnabled =
    capabilities.hasSpriteAnimations &&
    previewState.layerAnimations.playAnimationsAsSprites;

  const cells: PreviewPresentationCell[][] = Array.from(
    { length: rows },
    (_, rowIdx) =>
      Array.from({ length: columns }, (__, colIdx) => {
        const strip = strips[colIdx] ?? [];
        const stopIdx =
          strip.length > 0
            ? (rowIdx + previewState.stripOffset) % strip.length
            : 0;
        const fallbackSym =
          blueprint.symbols[
            (rowIdx * columns + colIdx) % Math.max(1, blueprint.symbols.length)
          ];
        const symbolId =
          strip.length > 0 ? strip[stopIdx]! : fallbackSym?.id ?? null;
        const symbol = symbolId ? symbolMap.get(symbolId) ?? null : null;
        const thumbnailUri = resolveSymbolThumbnailUri(
          symbol ?? undefined,
          assetMap,
        );

        const isWild = Boolean(
          symbol &&
            (symbol.isWild ||
              specialWildIds.has(symbol.id) ||
              symbol.code.toUpperCase() === "WILD"),
        );
        const isScatter = Boolean(
          symbol &&
            (symbol.isScatter ||
              specialScatterIds.has(symbol.id) ||
              symbol.code.toUpperCase() === "SCAT"),
        );
        const isBonus = Boolean(
          symbol &&
            (symbol.isBonus ||
              specialBonusIds.has(symbol.id) ||
              symbol.code.toUpperCase() === "BONUS"),
        );

        const paylineHits = visiblePaylines
          .filter((pl) => pl.pattern[colIdx] === rowIdx)
          .map((pl) => ({
            paylineId: pl.id,
            paylineIndex: pl.index,
            color: pl.color,
          }));

        const isSelectedSymbol = Boolean(
          symbolId && previewState.selectedSymbolId === symbolId,
        );

        // Deterministic visual highlight for symbol win animation inspection
        const winAnimationActive = Boolean(
          winAnimEnabled &&
            (isSelectedSymbol ||
              (previewState.selectedPaylineId && paylineHits.length > 0) ||
              (!previewState.selectedSymbolId &&
                !previewState.selectedPaylineId &&
                (rowIdx === Math.floor(rows / 2) || isWild || isScatter))),
        );

        return {
          colIdx,
          rowIdx,
          cellKey: `R${colIdx + 1}:C${rowIdx + 1}`,
          stopPosition: stopIdx + 1,
          symbolId,
          symbol,
          thumbnailUri,
          isWild,
          isScatter,
          isBonus,
          isSelectedSymbol,
          paylineHits,
          winAnimationActive,
          spriteAnimationActive: spriteAnimEnabled,
        };
      }),
  );

  // Buttons configuration
  const configuredButtons: Array<
    "spin" | "max" | "auto" | "turbo" | "bet" | "menu"
  > = blueprint.creation?.elements?.buttons?.length
    ? blueprint.creation.elements.buttons
    : buttonSetElement?.params?.buttons
    ? (String(buttonSetElement.params.buttons)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((k) =>
          ["spin", "max", "auto", "turbo", "bet", "menu"].includes(k),
        ) as Array<"spin" | "max" | "auto" | "turbo" | "bet" | "menu">)
    : ["menu", "bet", "auto", "turbo", "max", "spin"];

  const BUTTON_LABELS: Record<
    "spin" | "max" | "auto" | "turbo" | "bet" | "menu",
    string
  > = {
    spin: "SPIN",
    max: "MAX BET",
    auto: "AUTO",
    turbo: "TURBO",
    bet: "BET",
    menu: "MENU",
  };

  const buttonItems: PreviewButtonItem[] = configuredButtons.map((key) => ({
    id: `btn-${key}`,
    key,
    label: BUTTON_LABELS[key] ?? key.toUpperCase(),
    primary: key === "spin",
  }));

  if (!buttonItems.some((b) => b.key === "spin")) {
    buttonItems.push({
      id: "btn-spin",
      key: "spin",
      label: "SPIN",
      primary: true,
    });
  }

  const betLevels =
    blueprint.math?.betLevels?.length > 0
      ? blueprint.math.betLevels
      : [0.2, 0.5, 1, 2, 5, 10];
  const activeBet =
    betLevels[
      Math.min(betLevels.length - 1, Math.max(0, previewState.betIndex))
    ] ?? 1;

  // Frame style
  const rawFrameStyle = String(
    frameElement?.params?.style ??
      blueprint.creation?.elements?.frameStyle ??
      "ornate",
  );
  const frameStyle: "ornate" | "minimal" | "cabinet" | "themed" = (
    ["ornate", "minimal", "cabinet", "themed"].includes(rawFrameStyle)
      ? rawFrameStyle
      : "ornate"
  ) as "ornate" | "minimal" | "cabinet" | "themed";

  // Background resolution (scene-specific background overrides canvas default when set)
  const sceneBgAssetUri =
    activeSceneDef.background?.imageUri ??
    resolveAssetUri(activeSceneDef.background?.assetId, assetMap);
  const canvasBgAssetUri =
    sceneBgAssetUri ??
    resolveElementAssetUri(bgElement, assetMap) ??
    resolveAssetUri(blueprint.canvas?.backgroundAssetId, assetMap);

  const palette = blueprint.style.palette;
  const sceneBgColor = activeSceneDef.background?.color ?? palette.background;
  const backgroundGradient =
    activeSceneDef.kind === "freespins"
      ? `radial-gradient(circle at 50% 20%, ${palette.glow}44 0%, ${palette.surface} 52%, ${sceneBgColor} 100%)`
      : activeSceneDef.kind === "bonus"
      ? `radial-gradient(circle at 50% 20%, ${palette.accentAlt}44 0%, ${palette.surface} 52%, ${sceneBgColor} 100%)`
      : `radial-gradient(circle at 50% 22%, ${palette.surface} 0%, ${sceneBgColor} 78%)`;

  const matchingAnimations = (blueprint.animations ?? []).filter(
    (anim) =>
      previewState.layerAnimations.activeAnimationTrigger === "idle" ||
      anim.trigger === previewState.layerAnimations.activeAnimationTrigger,
  );

  return {
    projectId: blueprint.meta.id,
    projectTitle: blueprint.meta.title,
    theme: blueprint.meta.theme,
    styleGuide: blueprint.meta.styleGuide,
    canvas: {
      width: activeSceneDef.canvasConfiguration?.width ?? blueprint.canvas?.width ?? 1920,
      height: activeSceneDef.canvasConfiguration?.height ?? blueprint.canvas?.height ?? 1080,
      orientation:
        activeSceneDef.canvasConfiguration?.orientation ??
        blueprint.canvas?.orientation ??
        "landscape",
      safeArea:
        activeSceneDef.canvasConfiguration?.safeArea ??
        blueprint.canvas?.safeArea ?? {
          top: 64,
          right: 96,
          bottom: 96,
          left: 96,
        },
      backgroundColor: sceneBgColor,
      surfaceColor: palette.surface,
      accentColor: palette.accent,
      accentAltColor: palette.accentAlt,
      glowColor: palette.glow,
      textColor: palette.text,
      backgroundGradient,
      backgroundAssetUri: canvasBgAssetUri,
    },
    activeScene: {
      id: activeSceneDef.id,
      name: activeSceneDef.name,
      kind: activeSceneDef.kind,
      entryTransition: activeSceneDef.entryTransition,
      layerIds: activeSceneDef.layerIds ?? [],
      objectCount: sceneObjects.length,
    },
    scenes: scenes.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      entryTransition: s.entryTransition,
      layerCount: (s.layerIds ?? []).length,
      objectCount: (s.objects ?? []).filter((o) => o.visible).length,
      active: s.id === activeSceneDef.id,
    })),
    layers,
    stage: {
      background: {
        visible: bgLayer ? bgLayer.effectiveVisible : true,
        opacity: bgLayer?.opacity ?? 1,
        blendMode: bgLayer?.blendMode ?? "normal",
        assetUri: canvasBgAssetUri,
        elementName: bgElement?.name ?? "Base Background",
        animationActive: Boolean(
          capabilities.hasBackgroundAnimation &&
            previewState.layerAnimations.showBackgroundAnimation,
        ),
      },
      reelFrame: {
        visible: frameLayer ? frameLayer.effectiveVisible : true,
        opacity: frameLayer?.opacity ?? 1,
        blendMode: frameLayer?.blendMode ?? "normal",
        frameStyle,
        assetUri:
          resolveElementAssetUri(frameElement, assetMap) ??
          resolveAssetUri("asset-frame", assetMap),
        elementName: frameElement?.name ?? "Reel Frame",
      },
      reelArea: {
        visible: reelsLayer ? reelsLayer.effectiveVisible : true,
        opacity: reelsLayer?.opacity ?? 1,
        blendMode: reelsLayer?.blendMode ?? "normal",
        columns,
        rows,
        evaluation,
        spinDirection,
        stripOffset: previewState.stripOffset,
        maxStripLength,
        cells,
      },
      buttons: {
        visible: uiLayer ? uiLayer.effectiveVisible : true,
        opacity: uiLayer?.opacity ?? 1,
        blendMode: uiLayer?.blendMode ?? "normal",
        elementName: buttonSetElement?.name ?? "Control Deck Buttons",
        assetUri: resolveElementAssetUri(buttonSetElement, assetMap),
        items: buttonItems,
        activeBet,
        betLevels,
      },
      overlays: {
        fxVisible: fxLayer ? fxLayer.effectiveVisible : true,
        fxOpacity: fxLayer?.opacity ?? 1,
        showGrid: previewState.toolbar.showGrid,
        showGuides: previewState.toolbar.showGuides,
        showPaylines: previewState.showPaylines,
        paylines: visiblePaylines,
        activeAnimationTrigger:
          previewState.layerAnimations.activeAnimationTrigger,
        matchingAnimations,
      },
      standaloneLayers: {
        titleElement: titleElementDef
          ? buildStandaloneElementModel(
              titleElementDef,
              assetMap,
              previewState.layerAnimations.activeAnimationTrigger,
            )
          : null,
        standaloneElements: standaloneElementDefs.map((el) =>
          buildStandaloneElementModel(
            el,
            assetMap,
            previewState.layerAnimations.activeAnimationTrigger,
          ),
        ),
        sceneObjects,
      },
    },
    animationCapabilities: capabilities,
    runtime: {
      adapterId: adapter.id,
      adapterName: adapter.name,
      connectionState: adapter.connectionState,
      connected: adapter.isConnected(),
      statusMessage: adapter.getStatusMessage(),
      lastSpinAttempt: previewState.lastSpinAttempt,
    },
  };
}
