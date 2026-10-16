"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SceneObjectView, buildResolvers } from "@/components/canvas/SceneObjectView";
import { SceneSelectorCards } from "@/components/canvas/SceneSelectorCards";
import { StudioShell } from "@/components/shell/StudioShell";
import {
  Badge,
  Button,
  Panel,
  PropertyRow,
  Section,
  Select,
  Slider,
  Thumbnail,
  Toggle,
} from "@/components/ui";
import { canvasApi } from "@/lib/client/design-api";
import { StudioEditorProvider, useStudioEditor } from "@/lib/editor/EditorProvider";
import {
  addSceneToState,
  buildSceneSelectorCards,
  createSceneCompositionState,
  deleteSceneFromState,
  duplicateSceneInState,
  getEffectiveSceneModel,
  isSceneDirty,
  renameSceneInState,
  requestSceneSwitch,
  resolveUnsavedSceneSwitch,
  saveActiveSceneLayout,
  setSceneLayerVisibility,
  syncScenesListToBlueprint,
  type SceneCompositionWorkspaceState,
  type UnsavedSwitchResolution,
} from "@/lib/scenes";
import {
  RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE,
  buildPreviewPresentation,
  createDefaultPreviewState,
  createDisconnectedRuntimeAdapter,
  detectPreviewAnimationCapabilities,
  fitPreviewToViewport,
  invokeRuntimeSpin,
   recordPreviewSpinAttempt,
  resetPreviewLayerVisibility,
  resetPreviewView,
  selectPreviewPayline,
  selectPreviewScene,
  selectPreviewSymbol,
  setPreviewAnimationTrigger,
  setPreviewBetIndex,
  setPreviewStripOffset,
  setPreviewZoom,
  stepPreviewZoom,
  toggleBackgroundAnimation,
  togglePlayAnimationsAsSprites,
  togglePreviewFullscreen,
  togglePreviewGrid,
  togglePreviewGuides,
  togglePreviewLayerVisibility,
  togglePreviewPaylines,
  toggleSymbolWinAnimation,
  type PreviewAnimationTrigger,
  type PreviewState,
  type SlotRuntimeAdapter,
} from "@/lib/preview";
import type { ProjectDetail } from "@/lib/workspace/types";

const ANIMATION_TRIGGERS: Array<{ value: PreviewAnimationTrigger; label: string }> = [
  { value: "idle", label: "Idle / Default State" },
  { value: "spin_start", label: "Spin Start (spin_start)" },
  { value: "reel_stop", label: "Reel Stop (reel_stop)" },
  { value: "win", label: "Symbol Win (win)" },
  { value: "big_win", label: "Big Win (big_win)" },
  { value: "feature_enter", label: "Feature Enter (feature_enter)" },
];

export function PreviewWorkspace({
  project,
  runtimeAdapter,
}: {
  project: ProjectDetail;
  runtimeAdapter?: SlotRuntimeAdapter;
}) {
  return (
    <StudioEditorProvider
      initialProject={{
        id: project.id,
        title: project.title,
        revision: project.revision,
        blueprint: project.blueprint,
      }}
    >
      <PreviewWorkspaceInner runtimeAdapter={runtimeAdapter} />
    </StudioEditorProvider>
  );
}

function PreviewWorkspaceInner({
  runtimeAdapter,
}: {
  runtimeAdapter?: SlotRuntimeAdapter;
}) {
  const editor = useStudioEditor();
  const active = editor.state.activeProject;
  const bp = active?.blueprint;

  const adapter = useMemo(
    () => runtimeAdapter ?? createDisconnectedRuntimeAdapter(),
    [runtimeAdapter],
  );

  const [previewState, setPreviewState] = useState<PreviewState>(() =>
    bp
      ? createDefaultPreviewState(bp)
      : {
          activeSceneId: "scene-base",
          stripOffset: 0,
          selectedSymbolId: null,
          selectedPaylineId: null,
          showPaylines: true,
          showLayerBadges: true,
          betIndex: 0,
          layerVisibilityOverrides: {},
          toolbar: {
            zoom: 1,
            fitMode: true,
            panX: 0,
            panY: 0,
            fullscreen: false,
            showGrid: false,
            showGuides: true,
          },
          layerAnimations: {
            showBackgroundAnimation: false,
            showSymbolWinAnimation: false,
            playAnimationsAsSprites: false,
            activeAnimationTrigger: "idle",
          },
          lastSpinAttempt: null,
        },
  );

  const stageViewportRef = useRef<HTMLDivElement | null>(null);
  const [inspectorTab, setInspectorTab] = useState<
    "scenes" | "layers" | "symbols" | "paylines" | "animations" | "runtime"
  >("scenes");
  const [savingSceneLayout, setSavingSceneLayout] = useState(false);

  const [sceneState, setSceneState] = useState<SceneCompositionWorkspaceState | null>(() =>
    bp ? createSceneCompositionState(bp, previewState.activeSceneId) : null,
  );

  // Keep editor's activeScene synchronized when user switches scenes in preview
  const handleSelectScene = useCallback(
    (sceneId: string) => {
      if (sceneState) {
        const res = requestSceneSwitch(sceneState, sceneId);
        setSceneState(res.state);
        if (!res.switchedImmediately) {
          return;
        }
      }
      setPreviewState((prev) => selectPreviewScene(prev, sceneId));
      editor.setActiveScene(sceneId);
    },
    [editor, sceneState],
  );

  const persistScenesToServer = useCallback(
    async (nextState: SceneCompositionWorkspaceState, nextBp: NonNullable<typeof bp>) => {
      if (!active) return;
      const targetModel =
        getEffectiveSceneModel(nextState, nextState.activeSceneId, nextBp) ??
        nextState.scenes[0]!;
      try {
        await canvasApi.save(active.id, {
          baseRevision: active.revision,
          sceneId: targetModel.id,
          name: targetModel.name,
          objects: targetModel.objects,
          background: targetModel.background,
          layers: targetModel.layers,
          canvasConfiguration: targetModel.canvasConfiguration,
          visibility: targetModel.visibility,
          composedImages: targetModel.composedImages,
          layoutMetadata: targetModel.layoutMetadata,
          scenes: nextBp.scenes,
          force: true,
        });
      } catch {
        // Local blueprint state remains updated
      }
    },
    [active],
  );

  const handleResolveUnsavedSwitch = useCallback(
    (resolution: UnsavedSwitchResolution) => {
      if (!sceneState || !bp || !active) return;
      const resolved = resolveUnsavedSceneSwitch(sceneState, bp, resolution);
      setSceneState(resolved.state);
      if (resolution === "save") {
        editor.setActiveProject({ ...active, blueprint: resolved.blueprint });
        void persistScenesToServer(resolved.state, resolved.blueprint);
      }
      if (resolution !== "cancel") {
        setPreviewState((prev) => ({
          ...selectPreviewScene(prev, resolved.state.activeSceneId),
          layerVisibilityOverrides: {},
        }));
        editor.setActiveScene(resolved.state.activeSceneId);
      }
    },
    [sceneState, bp, active, editor, persistScenesToServer],
  );

  const handleAddScene = useCallback(
    (slotLabel?: string) => {
      if (!sceneState || !bp || !active) return;
      const res = addSceneToState(sceneState, bp, { name: slotLabel, activate: false });
      if (!res.ok) return;
      const nextBp = syncScenesListToBlueprint(bp, res.state);
      setSceneState(res.state);
      editor.setActiveProject({ ...active, blueprint: nextBp });
      void persistScenesToServer(res.state, nextBp);
    },
    [sceneState, bp, active, editor, persistScenesToServer],
  );

  const handleDuplicateScene = useCallback(
    (sourceId: string) => {
      if (!sceneState || !bp || !active) return;
      const res = duplicateSceneInState(sceneState, bp, sourceId);
      if (!res.ok) return;
      const nextBp = syncScenesListToBlueprint(bp, res.state);
      setSceneState(res.state);
      editor.setActiveProject({ ...active, blueprint: nextBp });
      void persistScenesToServer(res.state, nextBp);
    },
    [sceneState, bp, active, editor, persistScenesToServer],
  );

  const handleRenameScene = useCallback(
    (targetId: string, newName: string): { ok: boolean; error?: string } => {
      if (!sceneState || !bp || !active) return { ok: false, error: "No active project." };
      const res = renameSceneInState(sceneState, targetId, newName);
      if (!res.ok) return { ok: false, error: res.error };
      const nextBp = syncScenesListToBlueprint(bp, res.state);
      setSceneState(res.state);
      editor.setActiveProject({ ...active, blueprint: nextBp });
      void persistScenesToServer(res.state, nextBp);
      return { ok: true };
    },
    [sceneState, bp, active, editor, persistScenesToServer],
  );

  const handleDeleteScene = useCallback(
    (targetId: string) => {
      if (!sceneState || !bp || !active) return;
      const res = deleteSceneFromState(sceneState, targetId);
      if (!res.ok) return;
      const nextBp = syncScenesListToBlueprint(bp, res.state);
      setSceneState(res.state);
      setPreviewState((prev) => selectPreviewScene(prev, res.state.activeSceneId));
      editor.setActiveScene(res.state.activeSceneId);
      editor.setActiveProject({ ...active, blueprint: nextBp });
      void persistScenesToServer(res.state, nextBp);
    },
    [sceneState, bp, active, editor, persistScenesToServer],
  );

  const handleSaveActiveLayout = useCallback(() => {
    if (!sceneState || !bp || !active) return;
    setSavingSceneLayout(true);
    const saved = saveActiveSceneLayout(sceneState, bp);
    setSceneState(saved.state);
    editor.setActiveProject({ ...active, blueprint: saved.blueprint });
    void persistScenesToServer(saved.state, saved.blueprint).finally(() =>
      setSavingSceneLayout(false),
    );
  }, [sceneState, bp, active, editor, persistScenesToServer]);

  const selectorCards = useMemo(
    () => (sceneState && bp ? buildSceneSelectorCards(sceneState, bp) : []),
    [sceneState, bp],
  );

  const capabilities = useMemo(
    () => (bp ? detectPreviewAnimationCapabilities(bp) : null),
    [bp],
  );

  const presentation = useMemo(
    () => (bp ? buildPreviewPresentation(bp, previewState, adapter) : null),
    [bp, previewState, adapter],
  );

  const resolvers = useMemo(() => (bp ? buildResolvers(bp) : null), [bp]);

  const handleFitView = useCallback(() => {
    if (!bp) return;
    const rect = stageViewportRef.current?.getBoundingClientRect();
    const vw = rect?.width ?? 960;
    const vh = rect?.height ?? 560;
    // The presentation stage is already responsive (`w-full`) inside the viewport,
    // so fitting to the viewport restores a clean 100% scale (`zoom = 1`) with zero pan.
    setPreviewState((prev) =>
      fitPreviewToViewport(
        prev,
        vw,
        vh,
        Math.max(1, vw - 32),
        Math.max(1, vh - 32),
      ),
    );
  }, [bp]);

  useEffect(() => {
    if (!previewState.toolbar.fitMode || !bp) return;
    const el = stageViewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      setPreviewState((prev) =>
        prev.toolbar.fitMode
          ? fitPreviewToViewport(
              prev,
              width,
              height,
              Math.max(1, width - 32),
              Math.max(1, height - 32),
            )
          : prev,
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [previewState.toolbar.fitMode, bp]);

  const handleResetView = useCallback(() => {
    setPreviewState((prev) => resetPreviewView(prev));
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    setPreviewState((prev) => {
      const next = togglePreviewFullscreen(prev);
      editor.updateViewport({ fullscreen: next.toolbar.fullscreen });
      if (typeof document !== "undefined") {
        if (next.toolbar.fullscreen && document.documentElement.requestFullscreen) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else if (
          !next.toolbar.fullscreen &&
          document.fullscreenElement &&
          document.exitFullscreen
        ) {
          document.exitFullscreen().catch(() => {});
        }
      }
      return next;
    });
  }, [editor]);

  const handleRequestSpin = useCallback(async () => {
    if (!bp || !presentation) return;
    const response = await invokeRuntimeSpin(adapter, {
      projectId: bp.meta.id,
      sceneId: presentation.activeScene.id,
      betAmount: presentation.stage.buttons.activeBet,
      blueprintVersion: bp.version,
    });
    setPreviewState((prev) => recordPreviewSpinAttempt(prev, response));
  }, [adapter, bp, presentation]);

  // Keyboard shortcuts for zoom/fit/reset in preview
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        handleResetView();
      } else if ((event.ctrlKey || event.metaKey) && event.key === "=") {
        event.preventDefault();
        setPreviewState((prev) => stepPreviewZoom(prev, 0.1));
      } else if ((event.ctrlKey || event.metaKey) && event.key === "-") {
        event.preventDefault();
        setPreviewState((prev) => stepPreviewZoom(prev, -0.1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleResetView]);

  if (!active || !bp || !presentation || !capabilities || !resolvers) {
    return null;
  }

  const { stage, canvas, activeScene } = presentation;
  const zoomPct = Math.round(previewState.toolbar.zoom * 100);
  const overrideCount = Object.keys(previewState.layerVisibilityOverrides).length;

  // Compute visible symbol counts in current reel window
  const visibleSymbolCounts = new Map<string, number>();
  stage.reelArea.cells.forEach((row) =>
    row.forEach((cell) => {
      if (cell.symbolId) {
        visibleSymbolCounts.set(
          cell.symbolId,
          (visibleSymbolCounts.get(cell.symbolId) ?? 0) + 1,
        );
      }
    }),
  );

  const selectedSymbolDef = previewState.selectedSymbolId
    ? bp.symbols.find((s) => s.id === previewState.selectedSymbolId) ?? null
    : null;

  const rightPanel = (
    <div className="space-y-4" data-testid="preview-inspector">
      {/* Inspector Tab Switcher */}
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-white/10 bg-ink-950 p-1 text-[10.5px]">
        {(
          [
            { id: "scenes", label: "Scenes" },
            { id: "layers", label: "Layers" },
            { id: "animations", label: "Animations" },
            { id: "symbols", label: "Symbols" },
            { id: "paylines", label: "Paylines" },
            { id: "runtime", label: "Runtime" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setInspectorTab(tab.id)}
            className={`rounded px-2 py-1 font-medium transition ${
              inspectorTab === tab.id
                ? "bg-accent-600/25 text-ink-100 ring-1 ring-accent-500/40"
                : "text-ink-400 hover:bg-white/5 hover:text-ink-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 1. SCENES & LAYOUT INSPECTION */}
      {inspectorTab === "scenes" ? (
        <>
          <Section title="Scene-Aware Preview">
            <PropertyRow label="Active Scene">
              <Select
                aria-label="Preview scene"
                value={activeScene.id}
                onChange={(e) => handleSelectScene(e.target.value)}
                className="w-40 text-xs"
              >
                {presentation.scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.name} ({scene.kind})
                  </option>
                ))}
              </Select>
            </PropertyRow>
            <div className="space-y-1.5 pt-1">
              {presentation.scenes.map((scene) => (
                <button
                  key={scene.id}
                  type="button"
                  onClick={() => handleSelectScene(scene.id)}
                  className={`flex w-full items-center justify-between rounded-md border px-2.5 py-2 text-left text-xs transition ${
                    scene.active
                      ? "border-accent-500/40 bg-accent-500/15 text-ink-100"
                      : "border-white/[0.07] bg-ink-950/60 text-ink-300 hover:border-white/15"
                  }`}
                >
                  <div>
                    <div className="font-semibold">{scene.name}</div>
                    <div className="text-[10px] text-ink-400">
                      Kind: <span className="uppercase">{scene.kind}</span> · Transition:{" "}
                      {scene.entryTransition}
                    </div>
                  </div>
                  <Badge tone={scene.active ? "accent" : "muted"}>
                    {scene.layerCount} layers
                  </Badge>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Deterministic Layout & Strip Window">
            <PropertyRow label="Canvas Size">
              <span className="font-mono text-xs text-ink-200">
                {canvas.width} × {canvas.height} ({canvas.orientation})
              </span>
            </PropertyRow>
            <PropertyRow label="Reel Grid">
              <span className="font-mono text-xs text-ink-200">
                {stage.reelArea.columns} × {stage.reelArea.rows} (
                {stage.reelArea.evaluation.toUpperCase()})
              </span>
            </PropertyRow>
            <PropertyRow label="Frame Style">
              <Badge tone="default">{stage.reelFrame.frameStyle}</Badge>
            </PropertyRow>
            <PropertyRow label="Strip Window">
              <Slider
                label="Strip window offset"
                min={0}
                max={Math.max(0, stage.reelArea.maxStripLength - 1)}
                step={1}
                value={previewState.stripOffset}
                onChange={(val) =>
                  setPreviewState((prev) => setPreviewStripOffset(prev, val))
                }
              />
            </PropertyRow>
            <p className="text-[10.5px] text-ink-400">
              Scrubs the deterministic reel strip window (Stop #{previewState.stripOffset + 1})
              without invoking RNG.
            </p>
          </Section>
        </>
      ) : null}

      {/* 2. LAYERS & VISIBILITY INSPECTION */}
      {inspectorTab === "layers" ? (
        <Section
          title="Layers & Visibility"
          actions={
            overrideCount > 0 ? (
              <button
                type="button"
                onClick={() =>
                  setPreviewState((prev) => resetPreviewLayerVisibility(prev))
                }
                className="text-[10.5px] text-accent-400 hover:underline"
              >
                Reset ({overrideCount})
              </button>
            ) : null
          }
        >
          <p className="text-[11px] text-ink-400">
            Inspect layer hierarchy, scene membership, blend modes, and toggle visibility in
            the presentation stage.
          </p>
          <div className="space-y-1.5 pt-1">
            {presentation.layers.map((layer) => (
              <div
                key={layer.id}
                data-testid={`preview-layer-row-${layer.id}`}
                className={`flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-xs ${
                  layer.effectiveVisible
                    ? "border-white/10 bg-ink-950/80 text-ink-100"
                    : "border-white/5 bg-ink-950/30 text-ink-400 opacity-65"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{layer.name}</span>
                    <Badge tone="muted">{layer.kind}</Badge>
                    {!layer.inActiveScene ? (
                      <Badge tone="warning">Not in Scene</Badge>
                    ) : null}
                    {layer.overridden ? (
                      <Badge tone="accent">Overridden</Badge>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-400">
                    Order #{layer.order} · Opacity {Math.round(layer.opacity * 100)}% ·{" "}
                    {layer.blendMode}
                  </div>
                </div>
                <Button
                  variant={layer.effectiveVisible ? "outline" : "ghost"}
                  onClick={() => {
                    const nextVisible = !layer.effectiveVisible;
                    setPreviewState((prev) =>
                      togglePreviewLayerVisibility(prev, layer.id, bp.layers),
                    );
                    if (sceneState) {
                      setSceneState((prev) =>
                        prev
                          ? setSceneLayerVisibility(
                              prev,
                              prev.activeSceneId,
                              layer.id,
                              nextVisible,
                              bp,
                            )
                          : prev,
                      );
                    }
                  }}
                  aria-label={`Toggle layer ${layer.name}`}
                >
                  {layer.effectiveVisible ? "Visible" : "Hidden"}
                </Button>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* 3. LAYERS ANIMATION CONTROLS & ANIMATION STATES */}
      {inspectorTab === "animations" ? (
        <>
          <Section title="Layers Animation Controls">
            <div className="space-y-2.5">
              <div className="rounded-md border border-white/10 bg-ink-950/70 p-2.5">
                <Toggle
                  label="Show background animation"
                  checked={
                    capabilities.hasBackgroundAnimation &&
                    previewState.layerAnimations.showBackgroundAnimation
                  }
                  disabled={!capabilities.hasBackgroundAnimation}
                  onChange={(checked) =>
                    setPreviewState((prev) =>
                      toggleBackgroundAnimation(prev, capabilities, checked),
                    )
                  }
                />
                <div className="mt-1 text-[10px] text-ink-400">
                  {capabilities.backgroundAnimationReason}
                </div>
              </div>

              <div className="rounded-md border border-white/10 bg-ink-950/70 p-2.5">
                <Toggle
                  label="Show symbol win animation"
                  checked={
                    capabilities.hasSymbolWinAnimation &&
                    previewState.layerAnimations.showSymbolWinAnimation
                  }
                  disabled={!capabilities.hasSymbolWinAnimation}
                  onChange={(checked) =>
                    setPreviewState((prev) =>
                      toggleSymbolWinAnimation(prev, capabilities, checked),
                    )
                  }
                />
                <div className="mt-1 text-[10px] text-ink-400">
                  {capabilities.symbolWinAnimationReason}
                </div>
              </div>

              <div className="rounded-md border border-white/10 bg-ink-950/70 p-2.5">
                <Toggle
                  label="Play animations as sprites"
                  checked={
                    capabilities.hasSpriteAnimations &&
                    previewState.layerAnimations.playAnimationsAsSprites
                  }
                  disabled={!capabilities.hasSpriteAnimations}
                  onChange={(checked) =>
                    setPreviewState((prev) =>
                      togglePlayAnimationsAsSprites(prev, capabilities, checked),
                    )
                  }
                />
                <div className="mt-1 text-[10px] text-ink-400">
                  {capabilities.spriteAnimationsReason}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Inspect Animation Trigger State">
            <PropertyRow label="Trigger State">
              <Select
                aria-label="Animation state trigger"
                value={previewState.layerAnimations.activeAnimationTrigger}
                onChange={(e) =>
                  setPreviewState((prev) =>
                    setPreviewAnimationTrigger(
                      prev,
                      e.target.value as PreviewAnimationTrigger,
                    ),
                  )
                }
                className="w-44 text-xs"
              >
                {ANIMATION_TRIGGERS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </PropertyRow>

            <div className="space-y-1.5 pt-1">
              {stage.overlays.matchingAnimations.map((anim) => (
                <div
                  key={anim.id}
                  className="flex items-center justify-between rounded border border-white/[0.07] bg-ink-950 px-2.5 py-1.5 text-[11px]"
                >
                  <div>
                    <div className="font-medium text-ink-100">{anim.kind}</div>
                    <div className="text-[10px] text-ink-400">
                      Target: {anim.target} · {anim.durationMs}ms ({anim.easing})
                    </div>
                  </div>
                  <Badge tone="accent">{anim.trigger}</Badge>
                </div>
              ))}
              {stage.overlays.matchingAnimations.length === 0 ? (
                <div className="rounded border border-white/5 bg-ink-950/50 p-2 text-[11px] text-ink-400">
                  No blueprint animations bound to trigger{" "}
                  <code>{previewState.layerAnimations.activeAnimationTrigger}</code>.
                </div>
              ) : null}
            </div>
          </Section>
        </>
      ) : null}

      {/* 4. SYMBOLS INSPECTION */}
      {inspectorTab === "symbols" ? (
        <Section title="Symbols in Presentation Grid">
          <p className="text-[11px] text-ink-400">
            Click any symbol below or on the reel grid to highlight all matching stops and
            inspect its configured payouts.
          </p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1 pt-1">
            {bp.symbols.map((sym) => {
              const visibleCount = visibleSymbolCounts.get(sym.id) ?? 0;
              const isSelected = previewState.selectedSymbolId === sym.id;
              return (
                <button
                  key={sym.id}
                  type="button"
                  onClick={() =>
                    setPreviewState((prev) => selectPreviewSymbol(prev, sym.id))
                  }
                  className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                    isSelected
                      ? "border-accent-500/50 bg-accent-500/15 text-ink-100"
                      : "border-white/[0.07] bg-ink-950/60 text-ink-200 hover:border-white/15"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-sm">{sym.glyph}</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{sym.name}</div>
                      <div className="text-[10px] text-ink-400 uppercase">
                        {sym.code} · {sym.tier}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {sym.isWild ? <Badge tone="warning">Wild</Badge> : null}
                    {sym.isScatter ? <Badge tone="success">Scat</Badge> : null}
                    {sym.isBonus ? <Badge tone="accent">Bonus</Badge> : null}
                    <Badge tone={visibleCount > 0 ? "default" : "muted"}>
                      {visibleCount} on grid
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedSymbolDef ? (
            <div className="mt-2 rounded-lg border border-accent-500/30 bg-ink-950 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-ink-100">
                  {selectedSymbolDef.name} ({selectedSymbolDef.code})
                </span>
                <Link
                  href={`/projects/${bp.meta.id}/paytable`}
                  className="text-[10.5px] text-accent-400 hover:underline"
                >
                  Edit in Paytable →
                </Link>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {Object.entries(selectedSymbolDef.payouts).map(([count, payout]) => (
                  <div
                    key={count}
                    className="rounded border border-white/10 bg-ink-900 px-2 py-1 text-center"
                  >
                    <div className="text-[10px] text-ink-400">{count}× Match</div>
                    <div className="font-mono font-semibold text-ink-100">{payout}x</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}

      {/* 5. PAYLINES INSPECTION */}
      {inspectorTab === "paylines" ? (
        <Section title="Payline Overlay Inspection">
          <Toggle
            label="Show Payline Overlays"
            checked={previewState.showPaylines}
            onChange={(checked) =>
              setPreviewState((prev) => togglePreviewPaylines(prev, checked))
            }
          />
          {previewState.selectedPaylineId ? (
            <Button
              variant="ghost"
              onClick={() =>
                setPreviewState((prev) => selectPreviewPayline(prev, null))
              }
              className="w-full text-xs"
            >
              Show All Active Paylines ({stage.overlays.paylines.length})
            </Button>
          ) : null}
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1 pt-1">
            {(bp.paylineConfiguration?.paylines ?? bp.paylines).map((pl, idx) => {
              const color = pl.color ?? "#38bdf8";
              const isSelected = previewState.selectedPaylineId === pl.id;
              return (
                <button
                  key={pl.id}
                  type="button"
                  onClick={() =>
                    setPreviewState((prev) => selectPreviewPayline(prev, pl.id))
                  }
                  className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                    isSelected
                      ? "border-accent-500/50 bg-accent-500/15 text-ink-100"
                      : "border-white/[0.07] bg-ink-950/60 text-ink-200 hover:border-white/15"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-medium">
                      #{pl.index ?? idx + 1} {pl.name ?? `Line ${pl.index ?? idx + 1}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-ink-400">
                      [{pl.pattern.map((r) => r + 1).join("-")}]
                    </span>
                    <Badge tone={pl.active ? "success" : "muted"}>
                      {pl.active ? "Active" : "Off"}
                    </Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </Section>
      ) : null}

      {/* 6. SLOT RUNTIME ADAPTER BOUNDARY */}
      {inspectorTab === "runtime" ? (
        <Section title="SlotRuntimeAdapter Boundary">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            <div className="flex items-center justify-between font-semibold">
              <span>Status:</span>
              <Badge tone="warning">{presentation.runtime.statusMessage}</Badge>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-amber-100/85">
              Adapter: <code>{presentation.runtime.adapterId}</code> (
              {presentation.runtime.connectionState}). The actual mathematical slot runtime,
              RNG evaluation, and payout engine belong to{" "}
              <strong>SECTION 2 — Backend Slot Game Engine</strong>.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void handleRequestSpin()}
            className="w-full"
          >
            Test Spin via SlotRuntimeAdapter
          </Button>
          {previewState.lastSpinAttempt ? (
            <div
              data-testid="runtime-spin-response"
              className="rounded-md border border-white/10 bg-ink-950 p-2.5 text-[11px] text-ink-200"
            >
              <div className="font-semibold text-amber-300">
                {previewState.lastSpinAttempt.statusMessage}
              </div>
              <div className="mt-0.5 text-[10px] text-ink-400">
                Connected: {String(previewState.lastSpinAttempt.connected)} · Engine Result:{" "}
                <code>null</code> (Zero fake RNG)
              </div>
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  );

  return (
    <StudioShell
      activeSection="preview"
      sectionTitle="Preview Controls & Presentation Stage"
      rightPanel={rightPanel}
      rightPanelTitle="Preview Inspector"
    >
      <div className="space-y-4" data-testid="preview-workspace">
        {/* F19 Scene Selector Cards placed directly near the preview canvas */}
        {sceneState ? (
          <div className="overflow-hidden rounded-xl border border-white/10 shadow-lg">
            <SceneSelectorCards
              cards={selectorCards}
              activeSceneId={sceneState.activeSceneId}
              activeSceneDirty={isSceneDirty(sceneState, sceneState.activeSceneId)}
              pendingSwitch={sceneState.pendingSceneSwitch}
              sharedGlobalConfig={sceneState.sharedGlobalConfig}
              saving={savingSceneLayout}
              onSelectScene={handleSelectScene}
              onAddScene={handleAddScene}
              onDuplicateScene={handleDuplicateScene}
              onRenameScene={handleRenameScene}
              onDeleteScene={handleDeleteScene}
              onSaveActiveLayout={handleSaveActiveLayout}
              onResolveUnsavedSwitch={handleResolveUnsavedSwitch}
            />
          </div>
        ) : null}

        {/* Top Preview Toolbar */}
        <div
          role="toolbar"
          aria-label="Preview Toolbar"
          data-testid="preview-toolbar"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-ink-900/95 px-3.5 py-2.5 shadow-lg"
        >
          {/* Left group: Scene selector + Zoom / Fit / Reset View / Fullscreen */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 pr-2">
              <span className="text-[10.5px] font-semibold tracking-wider text-ink-400 uppercase">
                Scene
              </span>
              <Select
                aria-label="Toolbar scene selector"
                value={activeScene.id}
                onChange={(e) => handleSelectScene(e.target.value)}
                className="w-36 text-xs"
              >
                {presentation.scenes.map((scene) => (
                  <option key={scene.id} value={scene.id}>
                    {scene.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="h-4 w-px bg-white/10" />

            {/* Zoom Controls */}
            <div className="flex items-center gap-1" aria-label="Zoom controls">
              <Button
                variant="ghost"
                onClick={() =>
                  setPreviewState((prev) => stepPreviewZoom(prev, -0.1))
                }
                aria-label="Zoom out"
                title="Zoom Out (Ctrl/Cmd -)"
              >
                −
              </Button>
              <Select
                aria-label="Zoom level"
                value={String(Math.round(previewState.toolbar.zoom * 100))}
                onChange={(e) =>
                  setPreviewState((prev) =>
                    setPreviewZoom(prev, Number(e.target.value) / 100),
                  )
                }
                className="w-24 text-center font-mono text-xs"
              >
                {[25, 50, 75, 90, 100, 125, 150, 200, 250].map((pct) => (
                  <option key={pct} value={String(pct)}>
                    {pct}%
                  </option>
                ))}
                {![25, 50, 75, 90, 100, 125, 150, 200, 250].includes(zoomPct) ? (
                  <option value={String(zoomPct)}>{zoomPct}%</option>
                ) : null}
              </Select>
              <Button
                variant="ghost"
                onClick={() =>
                  setPreviewState((prev) => stepPreviewZoom(prev, 0.1))
                }
                aria-label="Zoom in"
                title="Zoom In (Ctrl/Cmd +)"
              >
                +
              </Button>
            </div>

            <Button
              variant={previewState.toolbar.fitMode ? "primary" : "outline"}
              onClick={handleFitView}
              aria-label="Fit"
              title="Fit presentation canvas to viewport"
            >
              Fit
            </Button>

            <Button
              variant="outline"
              onClick={handleResetView}
              aria-label="Reset View"
              title="Reset zoom to 100% (Ctrl/Cmd 0)"
            >
              Reset View
            </Button>

            <Button
              variant={previewState.toolbar.fullscreen ? "primary" : "outline"}
              onClick={handleToggleFullscreen}
              aria-label="Fullscreen"
              title="Toggle fullscreen presentation mode"
            >
              {previewState.toolbar.fullscreen ? "Exit Fullscreen" : "Fullscreen"}
            </Button>
          </div>

          {/* Right group: Show Grid / Show Guides / Paylines / Runtime Badge */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={previewState.toolbar.showGrid ? "primary" : "outline"}
              onClick={() =>
                setPreviewState((prev) => togglePreviewGrid(prev))
              }
              aria-pressed={previewState.toolbar.showGrid}
              aria-label="Show Grid"
            >
              Show Grid
            </Button>

            <Button
              variant={previewState.toolbar.showGuides ? "primary" : "outline"}
              onClick={() =>
                setPreviewState((prev) => togglePreviewGuides(prev))
              }
              aria-pressed={previewState.toolbar.showGuides}
              aria-label="Show Guides"
            >
              Show Guides
            </Button>

            <Button
              variant={previewState.showPaylines ? "primary" : "outline"}
              onClick={() =>
                setPreviewState((prev) => togglePreviewPaylines(prev))
              }
              aria-pressed={previewState.showPaylines}
              aria-label="Toggle Paylines"
            >
              Paylines ({stage.overlays.paylines.length})
            </Button>

            <Badge tone="warning" data-testid="runtime-status-badge">
              {presentation.runtime.statusMessage}
            </Badge>
          </div>
        </div>

        {/* Layers Animation Quick Bar */}
        <div
          data-testid="preview-layers-controls-bar"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.08] bg-ink-900/60 px-4 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-[10.5px] font-semibold tracking-wider text-ink-400 uppercase">
              Layers Controls:
            </span>

            <label
              className={`flex items-center gap-2 ${
                capabilities.hasBackgroundAnimation
                  ? "cursor-pointer text-ink-200"
                  : "cursor-not-allowed text-ink-400/60"
              }`}
              title={capabilities.backgroundAnimationReason}
            >
              <input
                type="checkbox"
                checked={
                  capabilities.hasBackgroundAnimation &&
                  previewState.layerAnimations.showBackgroundAnimation
                }
                disabled={!capabilities.hasBackgroundAnimation}
                onChange={(e) =>
                  setPreviewState((prev) =>
                    toggleBackgroundAnimation(prev, capabilities, e.target.checked),
                  )
                }
                className="rounded border-white/20 bg-ink-950"
              />
              <span>Show background animation</span>
            </label>

            <label
              className={`flex items-center gap-2 ${
                capabilities.hasSymbolWinAnimation
                  ? "cursor-pointer text-ink-200"
                  : "cursor-not-allowed text-ink-400/60"
              }`}
              title={capabilities.symbolWinAnimationReason}
            >
              <input
                type="checkbox"
                checked={
                  capabilities.hasSymbolWinAnimation &&
                  previewState.layerAnimations.showSymbolWinAnimation
                }
                disabled={!capabilities.hasSymbolWinAnimation}
                onChange={(e) =>
                  setPreviewState((prev) =>
                    toggleSymbolWinAnimation(prev, capabilities, e.target.checked),
                  )
                }
                className="rounded border-white/20 bg-ink-950"
              />
              <span>Show symbol win animation</span>
            </label>

            <label
              className={`flex items-center gap-2 ${
                capabilities.hasSpriteAnimations
                  ? "cursor-pointer text-ink-200"
                  : "cursor-not-allowed text-ink-400/60"
              }`}
              title={capabilities.spriteAnimationsReason}
            >
              <input
                type="checkbox"
                checked={
                  capabilities.hasSpriteAnimations &&
                  previewState.layerAnimations.playAnimationsAsSprites
                }
                disabled={!capabilities.hasSpriteAnimations}
                onChange={(e) =>
                  setPreviewState((prev) =>
                    togglePlayAnimationsAsSprites(
                      prev,
                      capabilities,
                      e.target.checked,
                    ),
                  )
                }
                className="rounded border-white/20 bg-ink-950"
              />
              <span>
                Play animations as sprites
                {!capabilities.hasSpriteAnimations ? " (No Sprite Assets)" : ""}
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-ink-300">
            <span>Strip Offset:</span>
            <Button
              variant="ghost"
              onClick={() =>
                setPreviewState((prev) =>
                  setPreviewStripOffset(
                    prev,
                    (prev.stripOffset - 1 + stage.reelArea.maxStripLength) %
                      Math.max(1, stage.reelArea.maxStripLength),
                  ),
                )
              }
              aria-label="Previous strip stop"
            >
              ◀
            </Button>
            <span className="font-mono text-ink-100">
              Stop #{previewState.stripOffset + 1} / {stage.reelArea.maxStripLength}
            </span>
            <Button
              variant="ghost"
              onClick={() =>
                setPreviewState((prev) =>
                  setPreviewStripOffset(
                    prev,
                    (prev.stripOffset + 1) %
                      Math.max(1, stage.reelArea.maxStripLength),
                  ),
                )
              }
              aria-label="Next strip stop"
            >
              ▶
            </Button>
          </div>
        </div>

        {/* Large Presentation Stage */}
        <Panel
          title={`${bp.meta.title} — ${activeScene.name} (${stage.reelArea.columns}×${stage.reelArea.rows})`}
          subtitle={`Canvas ${canvas.width}×${canvas.height} · Zoom ${zoomPct}% · Scene Transition: ${activeScene.entryTransition} · Deterministic Blueprint Composition`}
        >
          <div
            ref={stageViewportRef}
            data-testid="preview-presentation-viewport"
            className="relative flex min-h-[640px] w-full items-center justify-center overflow-auto rounded-xl border border-white/10 bg-black/70 p-3 sm:p-4"
          >
            {/* Scaled Presentation Stage Container */}
            <div
              data-testid="preview-presentation-canvas"
              className="relative w-full overflow-hidden rounded-2xl border border-white/15 p-5 sm:p-7 shadow-2xl transition-transform duration-150"
              style={{
                transform: `translate(${previewState.toolbar.panX}px, ${previewState.toolbar.panY}px) scale(${previewState.toolbar.zoom})`,
                transformOrigin: "center center",
                background: stage.background.visible
                  ? canvas.backgroundGradient
                  : "#090b10",
              }}
            >
              {/* 1. BACKGROUND LAYER */}
              {stage.background.visible ? (
                <div
                  data-testid="preview-stage-background"
                  className={`pointer-events-none absolute inset-0 transition-opacity ${
                    stage.background.animationActive ? "animate-pulse" : ""
                  }`}
                  style={{
                    opacity: stage.background.opacity,
                    mixBlendMode: stage.background.blendMode as React.CSSProperties["mixBlendMode"],
                  }}
                >
                  {stage.background.assetUri ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={stage.background.assetUri}
                      alt={stage.background.elementName}
                      className="h-full w-full object-cover opacity-45"
                    />
                  ) : null}
                  {stage.background.animationActive ? (
                    <div
                      aria-label="Background ambient animation active"
                      className="absolute inset-0"
                      style={{
                        background: `radial-gradient(circle at 50% 50%, ${canvas.glowColor}22, transparent 70%)`,
                      }}
                    />
                  ) : null}
                </div>
              ) : null}

              {/* 2. SHOW GRID OVERLAY */}
              {stage.overlays.showGrid ? (
                <div
                  aria-label="Presentation grid overlay"
                  data-testid="preview-grid-overlay"
                  className="pointer-events-none absolute inset-0 z-20"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.08) 1px, transparent 1px)",
                    backgroundSize: "32px 32px",
                  }}
                />
              ) : null}

              {/* 3. SHOW GUIDES OVERLAY (Safe area + Center axes) */}
              {stage.overlays.showGuides ? (
                <div
                  aria-label="Presentation guides overlay"
                  data-testid="preview-guides-overlay"
                  className="pointer-events-none absolute inset-3 z-20 rounded-xl border border-dashed border-sky-400/45"
                >
                  <div className="absolute top-1.5 left-2 rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-[9px] text-sky-200">
                    SAFE AREA ({canvas.safeArea.top}/{canvas.safeArea.right}/
                    {canvas.safeArea.bottom}/{canvas.safeArea.left})
                  </div>
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-sky-400/25" />
                  <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-sky-400/25" />
                </div>
              ) : null}

              {/* 4. STANDALONE LAYERS: GAME TITLE & SCENE OBJECTS */}
              <div
                data-testid="preview-stage-standalone-layers"
                className="relative z-10 mb-4 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div
                      className={`text-base font-extrabold tracking-wide uppercase ${
                        stage.standaloneLayers.titleElement?.animationActive
                          ? "animate-pulse"
                          : ""
                      }`}
                      style={{
                        color:
                          stage.standaloneLayers.titleElement?.tintColor ??
                          canvas.textColor,
                        textShadow: `0 0 18px ${canvas.glowColor}55`,
                      }}
                    >
                      {stage.standaloneLayers.titleElement?.name ?? bp.meta.title}
                    </div>
                    <div className="text-[11px] text-ink-300">
                      {bp.meta.theme} · Scene:{" "}
                      <span className="font-semibold text-ink-100">
                        {activeScene.name}
                      </span>{" "}
                      ({activeScene.kind.toUpperCase()}) ·{" "}
                      {stage.reelArea.evaluation.toUpperCase()}
                    </div>
                  </div>
                </div>

                {/* Standalone custom/uploaded element badges */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {stage.standaloneLayers.standaloneElements.map((el) => (
                    <Badge key={el.id} tone="default">
                      {el.name} ({el.type})
                    </Badge>
                  ))}
                  {stage.overlays.fxVisible ? (
                    <Badge tone="accent">
                      FX Layer ({stage.overlays.activeAnimationTrigger})
                    </Badge>
                  ) : null}
                </div>
              </div>

              {/* Positioned Scene Objects (when present on the active scene) */}
              {stage.standaloneLayers.sceneObjects.length > 0 ? (
                <div
                  data-testid="preview-scene-objects-summary"
                  className="relative z-10 mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-white/10 bg-black/35 px-3 py-1.5 text-[11px] text-ink-200"
                >
                  <span className="font-semibold text-ink-300">
                    Scene Canvas Objects ({stage.standaloneLayers.sceneObjects.length}):
                  </span>
                  {stage.standaloneLayers.sceneObjects.slice(0, 8).map((obj) => (
                    <span
                      key={obj.id}
                      className="rounded border border-white/10 bg-ink-900/80 px-1.5 py-0.5 text-[10px]"
                    >
                      {obj.name} ({obj.kind})
                    </span>
                  ))}
                  {/* Hidden deterministic DOM mount for SceneObjectView inspection */}
                  <div className="sr-only" aria-hidden>
                    {stage.standaloneLayers.sceneObjects.map((obj) => (
                      <SceneObjectView
                        key={obj.id}
                        object={obj}
                        blueprint={bp}
                        resolvers={resolvers}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {/* 5. REEL FRAME & 6. REEL AREA + SYMBOLS + PAYLINE OVERLAYS */}
              <div
                data-testid="preview-stage-reel-frame"
                className="relative z-10 rounded-2xl p-4 transition-all"
                style={{
                  border: stage.reelFrame.visible
                    ? stage.reelFrame.frameStyle === "ornate"
                      ? `3px solid ${canvas.accentColor}`
                      : stage.reelFrame.frameStyle === "cabinet"
                      ? `4px double ${canvas.accentAltColor}`
                      : stage.reelFrame.frameStyle === "themed"
                      ? `2px solid ${canvas.glowColor}`
                      : "1px solid rgba(255,255,255,0.18)"
                    : "1px dashed rgba(255,255,255,0.08)",
                  boxShadow: stage.reelFrame.visible
                    ? `0 0 28px ${canvas.accentColor}26, inset 0 0 24px rgba(0,0,0,0.65)`
                    : undefined,
                  backgroundColor: "rgba(7, 9, 14, 0.72)",
                  opacity: stage.reelFrame.visible ? stage.reelFrame.opacity : 0.65,
                }}
              >
                {/* Frame header bar */}
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-[10px] tracking-wider text-ink-400 uppercase">
                  <span className="truncate">
                    {stage.reelFrame.visible
                      ? `${stage.reelFrame.elementName} (${stage.reelFrame.frameStyle})`
                      : "Reel Frame Hidden"}
                  </span>
                  <span className="truncate">
                    Strip Stop #{previewState.stripOffset + 1} · Spin Direction:{" "}
                    {stage.reelArea.spinDirection.toUpperCase()}
                  </span>
                </div>

                {/* Reel Area Grid */}
                {stage.reelArea.visible ? (
                  <div
                    data-testid="preview-stage-reel-area"
                    className="relative"
                    style={{ opacity: stage.reelArea.opacity }}
                  >
                    <div
                      className="grid gap-1.5 sm:gap-2.5"
                      style={{
                        gridTemplateColumns: `repeat(${stage.reelArea.columns}, minmax(0, 1fr))`,
                      }}
                    >
                      {stage.reelArea.cells.map((row) =>
                        row.map((cell) => {
                          const sym = cell.symbol;
                          const hitColor = cell.paylineHits[0]?.color;
                          return (
                            <button
                              key={cell.cellKey}
                              type="button"
                              data-testid={`preview-cell-${cell.colIdx}-${cell.rowIdx}`}
                              onClick={() =>
                                cell.symbolId &&
                                setPreviewState((prev) =>
                                  selectPreviewSymbol(prev, cell.symbolId),
                                )
                              }
                              className={`group relative flex min-h-[104px] min-w-0 flex-col items-center justify-center overflow-hidden rounded-xl border p-2.5 text-center transition sm:min-h-[124px] sm:p-3.5 ${
                                cell.winAnimationActive
                                  ? "animate-pulse border-amber-400/80 bg-amber-500/15 shadow-[0_0_20px_rgba(251,191,36,0.28)]"
                                  : cell.isSelectedSymbol
                                  ? "border-accent-400 bg-accent-500/15"
                                  : "border-white/10 bg-ink-900/90 hover:border-white/25"
                              }`}
                              style={{
                                boxShadow: hitColor
                                  ? `inset 0 0 0 1px ${hitColor}66`
                                  : undefined,
                              }}
                            >
                              <Thumbnail
                                src={cell.thumbnailUri}
                                alt={sym?.name ?? "Cell"}
                                glyph={sym?.glyph ?? "◆"}
                                size="lg"
                              />
                              <span className="mt-2 max-w-full truncate text-xs font-semibold text-ink-100">
                                {sym?.name ?? "Empty"}
                              </span>

                              {/* Role badges */}
                              {cell.isWild || cell.isScatter || cell.isBonus ? (
                                <span className="mt-0.5 flex items-center gap-1">
                                  {cell.isWild ? (
                                    <span className="rounded bg-amber-500/30 px-1 py-px text-[8.5px] font-bold tracking-wider text-amber-200 uppercase">
                                      Wild
                                    </span>
                                  ) : null}
                                  {cell.isScatter ? (
                                    <span className="rounded bg-emerald-500/30 px-1 py-px text-[8.5px] font-bold tracking-wider text-emerald-200 uppercase">
                                      Scat
                                    </span>
                                  ) : null}
                                  {cell.isBonus ? (
                                    <span className="rounded bg-fuchsia-500/30 px-1 py-px text-[8.5px] font-bold tracking-wider text-fuchsia-200 uppercase">
                                      Bonus
                                    </span>
                                  ) : null}
                                </span>
                              ) : null}

                              {cell.winAnimationActive ? (
                                <span className="mt-0.5 rounded bg-amber-400/25 px-1.5 py-px text-[8px] font-bold tracking-wider text-amber-200 uppercase">
                                  Win Anim
                                </span>
                              ) : null}

                              <span className="mt-0.5 font-mono text-[9px] text-ink-400">
                                {cell.cellKey} · #{cell.stopPosition}
                              </span>
                            </button>
                          );
                        }),
                      )}
                    </div>

                    {/* SVG Payline Overlays */}
                    {stage.overlays.showPaylines &&
                    stage.overlays.paylines.length > 0 ? (
                      <svg
                        aria-label="Payline overlays"
                        data-testid="preview-paylines-svg"
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
                      >
                        {stage.overlays.paylines.slice(0, 20).map((pl) => (
                          <g key={pl.id}>
                            <polyline
                              fill="none"
                              stroke={pl.color}
                              strokeWidth={pl.selected ? 1.4 : 0.65}
                              strokeOpacity={pl.selected ? 0.95 : 0.45}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={pl.svgPoints}
                            />
                            {pl.nodeCoords.map((pt) => (
                              <circle
                                key={`${pl.id}-${pt.colIdx}`}
                                cx={pt.xPct}
                                cy={pt.yPct}
                                r={pl.selected ? 1.6 : 0.9}
                                fill={pl.color}
                                fillOpacity={pl.selected ? 1 : 0.65}
                              />
                            ))}
                          </g>
                        ))}
                      </svg>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-xs text-ink-400">
                    Reels Layer is currently hidden in Layer Controls.
                  </div>
                )}
              </div>

              {/* 7. BUTTONS / CONTROL DECK & SPIN RUNTIME BOUNDARY */}
              {stage.buttons.visible ? (
                <div
                  data-testid="preview-stage-buttons"
                  className="relative z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-950/90 px-4 py-3"
                  style={{ opacity: stage.buttons.opacity }}
                >
                  {/* Balance / Bet Display (Static Configuration Values Only — No Fake Winnings) */}
                  <div className="flex flex-wrap items-center gap-4">
                    <div>
                      <div className="text-[9.5px] font-semibold tracking-wider text-ink-400 uppercase">
                        Configured Bet Level
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setPreviewState((prev) =>
                              setPreviewBetIndex(
                                prev,
                                prev.betIndex - 1,
                                stage.buttons.betLevels.length,
                              ),
                            )
                          }
                          aria-label="Decrease bet"
                        >
                          −
                        </Button>
                        <span className="font-mono text-sm font-bold text-ink-100">
                          {stage.buttons.activeBet.toFixed(2)}
                        </span>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            setPreviewState((prev) =>
                              setPreviewBetIndex(
                                prev,
                                prev.betIndex + 1,
                                stage.buttons.betLevels.length,
                              ),
                            )
                          }
                          aria-label="Increase bet"
                        >
                          +
                        </Button>
                      </div>
                    </div>

                    <div className="h-6 w-px bg-white/10" />

                    <div>
                      <div className="text-[9.5px] font-semibold tracking-wider text-ink-400 uppercase">
                        Payout Evaluation
                      </div>
                      <div className="text-[11px] font-medium text-amber-300">
                        {RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE} (No Fake Payouts)
                      </div>
                    </div>
                  </div>

                  {/* Configured Button Set */}
                  <div className="flex flex-wrap items-center gap-2">
                    {stage.buttons.items.map((btn) =>
                      btn.key === "spin" ? (
                        <Button
                          key={btn.id}
                          variant="primary"
                          onClick={() => void handleRequestSpin()}
                          data-testid="preview-spin-button"
                          aria-label="Spin"
                        >
                          {btn.label}
                        </Button>
                      ) : btn.key === "max" ? (
                        <Button
                          key={btn.id}
                          variant="outline"
                          onClick={() =>
                            setPreviewState((prev) =>
                              setPreviewBetIndex(
                                prev,
                                stage.buttons.betLevels.length - 1,
                                stage.buttons.betLevels.length,
                              ),
                            )
                          }
                        >
                          {btn.label}
                        </Button>
                      ) : (
                        <Button
                          key={btn.id}
                          variant="ghost"
                          onClick={() => void handleRequestSpin()}
                        >
                          {btn.label}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              ) : null}

              {/* Spin Attempt Banner when Runtime Engine is Disconnected */}
              {previewState.lastSpinAttempt &&
              !previewState.lastSpinAttempt.connected ? (
                <div
                  role="status"
                  data-testid="preview-runtime-not-connected-banner"
                  className="relative z-10 mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs text-amber-100"
                >
                  <div>
                    <strong>{previewState.lastSpinAttempt.statusMessage}:</strong>{" "}
                    <code>SlotRuntimeAdapter</code> is not connected to the SECTION 2
                    Backend Slot Game Engine. No fake RNG or simulated payout was
                    generated.
                  </div>
                  <Badge tone="warning">SlotRuntimeAdapter · Disconnected</Badge>
                </div>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>
    </StudioShell>
  );
}
