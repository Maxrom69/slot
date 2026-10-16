"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Button, Field, Select } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import {
  ANIMATION_FORMATS,
  ANIMATION_SOURCES,
  STUDIO_ANIMATION_TYPES,
  addAnimationLayerToDesignDoc,
  addElementAnimation,
  configureAnimationSpriteSheet,
  configureAnimationVideo,
  createAnimationPlaybackState,
  defaultDurationForAnimationType,
  defaultFormatForSource,
  defaultFpsForAnimationType,
  defaultLoopForAnimationType,
  deleteElementAnimation,
  getElementAnimations,
  pauseAnimation,
  playAnimation,
  renameElementAnimation,
   resolveSpriteFrameRect,
  restartAnimation,
  seekAnimationPlayback,
  setAnimationPlaybackLoop,
  setElementAnimationExtra,
  stepAnimationPlayback,
  toggleElementAnimationState,
  updateElementAnimation,
  type AnimationFormat,
  type AnimationModel,
  type AnimationPlaybackState,
  type AnimationSource,
  type StudioAnimationType,
} from "@/lib/animations";
import type { ElementDef, GameBlueprint, StylePalette } from "@/lib/blueprint/types";
import type { DesignDoc } from "@/lib/design/types";
import { CommitInput, CommitTextArea } from "./CommitInput";

interface ElementAnimationPanelProps {
  doc: DesignDoc;
  element: ElementDef;
  palette: StylePalette;
  projectId?: string;
  blueprint?: GameBlueprint | null;
  compact?: boolean;
  onApply: (label: string, fn: (doc: DesignDoc) => DesignDoc) => void;
  onPlacedLayer?: (message: string) => void;
}

export function ElementAnimationPanel({
  doc,
  element,
  palette,
  projectId,
  blueprint,
  compact = false,
  onApply,
  onPlacedLayer,
}: ElementAnimationPanelProps) {
  const animations = useMemo(
    () => getElementAnimations(doc, element.id),
    [doc, element.id],
  );

  const defaultAnimType: StudioAnimationType = useMemo(() => {
    if (element.type === "game_background") return "Background";
    if (element.type === "symbol" || element.type === "symbol_set") return "Symbol Win";
    if (element.type === "button_set") return "Hover";
    return "Standalone";
  }, [element.type]);

  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<StudioAnimationType>(defaultAnimType);
  const [newSource, setNewSource] = useState<AnimationSource>("preset");
  const [newFormat, setNewFormat] = useState<AnimationFormat>("css");
  const [newDuration, setNewDuration] = useState<number>(defaultDurationForAnimationType(defaultAnimType));
  const [newFps, setNewFps] = useState<number>(defaultFpsForAnimationType(defaultAnimType));
  const [newLoop, setNewLoop] = useState<boolean>(defaultLoopForAnimationType(defaultAnimType));

  const [selectedAnimId, setSelectedAnimId] = useState<string | null>(animations[0]?.id ?? null);
  const activeAnimation: AnimationModel | null = useMemo(() => {
    if (selectedAnimId) {
      const found = animations.find((a) => a.id === selectedAnimId);
      if (found) return found;
    }
    return animations[0] ?? null;
  }, [animations, selectedAnimId]);

  const [playback, setPlayback] = useState<AnimationPlaybackState>(() =>
    createAnimationPlaybackState(
      activeAnimation ?? {
        id: "preview-default",
        duration: newDuration,
        fps: newFps,
        loop: newLoop,
        spriteSheetReference: null,
      },
    ),
  );

  const scenes = useMemo(
    () =>
      (doc.scenes && doc.scenes.length > 0 ? doc.scenes : blueprint?.scenes) ?? [
        { id: "scene-base", name: "Base Game", kind: "base" as const, layerIds: ["layer-fx"], entryTransition: "fade", objects: [] },
      ],
    [doc.scenes, blueprint?.scenes],
  );
  const [targetSceneId, setTargetSceneId] = useState<string>(scenes[0]?.id ?? "scene-base");
  const animSignature = activeAnimation
    ? `${activeAnimation.id}:${activeAnimation.duration}:${activeAnimation.fps}:${activeAnimation.loop}:${activeAnimation.spriteSheetReference?.frameCount ?? 0}`
    : "";
  const [prevAnimSignature, setPrevAnimSignature] = useState(animSignature);
  if (prevAnimSignature !== animSignature) {
    setPrevAnimSignature(animSignature);
    if (activeAnimation) {
      setPlayback((prev) => {
        if (prev.animationId === activeAnimation.id) {
          const nextBase = createAnimationPlaybackState(activeAnimation);
          return {
            ...nextBase,
            status: prev.status,
            isPlaying: prev.isPlaying,
            isPaused: prev.isPaused,
            loop: activeAnimation.loop,
            elapsedMs: Math.min(prev.elapsedMs, nextBase.duration),
          };
        }
        return createAnimationPlaybackState(activeAnimation);
      });
    }
  }

  // Step playback timer when playing
  useEffect(() => {
    if (!playback.isPlaying) return;
    const intervalMs = Math.max(16, Math.round(1000 / Math.max(12, playback.fps)));
    const handle = window.setInterval(() => {
      setPlayback((curr) => stepAnimationPlayback(curr, intervalMs));
    }, intervalMs);
    return () => window.clearInterval(handle);
  }, [playback.isPlaying, playback.fps]);

  const handleTypeSelectChange = (type: StudioAnimationType) => {
    setNewType(type);
    setNewDuration(defaultDurationForAnimationType(type));
    setNewFps(defaultFpsForAnimationType(type));
    setNewLoop(defaultLoopForAnimationType(type));
  };

  const handleSourceSelectChange = (source: AnimationSource) => {
    setNewSource(source);
    setNewFormat(defaultFormatForSource(source));
  };

  const handleAddAnimation = () => {
    let createdId = "";
    onApply(`Add ${newType} animation to ${element.name}`, (d) => {
      const res = addElementAnimation(d, {
        elementId: element.id,
        name: newName.trim() || `${element.name} — ${newType}`,
        animationType: newType,
        source: newSource,
        format: newFormat,
        duration: newDuration,
        fps: newFps,
        loop: newLoop,
        state: "enabled",
      });
      createdId = res.id;
      return res.doc;
    });
    setNewName("");
    if (createdId) {
      setSelectedAnimId(createdId);
    }
  };

  const handlePreviewAnimation = (anim: AnimationModel) => {
    setSelectedAnimId(anim.id);
    const fresh = createAnimationPlaybackState(anim);
    setPlayback(playAnimation(fresh));
  };

  const handlePlaceAsSceneLayer = async (anim: AnimationModel) => {
    const canvasSize = blueprint?.canvas
      ? { width: blueprint.canvas.width, height: blueprint.canvas.height }
      : { width: 1920, height: 1080 };
    let placedObjName = anim.name;
    let updatedSceneObjects: import("@/lib/blueprint/types").SceneObject[] | null = null;
    let updatedSceneBg: import("@/lib/blueprint/types").SceneBackground | null = null;

    onApply(`Add animation “${anim.name}” to scene as layer`, (d) => {
      const res = addAnimationLayerToDesignDoc(d, anim.id, {
        sceneId: targetSceneId,
        canvasSize,
      });
      if (!res) return d;
      placedObjName = res.object.name;
      const sc = res.doc.scenes?.find((s) => s.id === res.sceneId);
      if (sc) {
        updatedSceneObjects = sc.objects ?? [];
        updatedSceneBg = sc.background ?? { color: palette.background, assetId: null };
      }
      return res.doc;
    });

    if (projectId && updatedSceneObjects && blueprint) {
      try {
        await fetch(`/api/projects/${encodeURIComponent(projectId)}/canvas`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseRevision: 0,
            force: true,
            sceneId: targetSceneId,
            objects: updatedSceneObjects,
            background: updatedSceneBg ?? { color: palette.background, assetId: null },
            layers: doc.layers ?? blueprint.layers,
          }),
        });
      } catch {
        // Scene layer is also preserved in DesignDoc state
      }
    }

    onPlacedLayer?.(`Added standalone animated layer “${placedObjName}” to scene`);
  };

  const activeSpriteRect = useMemo(() => {
    if (!activeAnimation?.spriteSheetReference) return null;
    return resolveSpriteFrameRect(activeAnimation.spriteSheetReference, playback.currentFrame);
  }, [activeAnimation, playback.currentFrame]);

  // Dynamic CSS preview transform for preset/custom animations
  const previewMotionStyle: CSSProperties = useMemo(() => {
    if (!activeAnimation || activeAnimation.state === "disabled") {
      return { opacity: 0.45 };
    }
    const p = playback.progress;
    const rad = p * Math.PI * 2;
    switch (activeAnimation.animationType) {
      case "Background":
        return {
          transform: `translateY(${Math.sin(rad) * -6}px) scale(${1 + Math.sin(rad) * 0.03})`,
          boxShadow: playback.isPlaying ? `0 0 22px ${palette.accent}55` : undefined,
        };
      case "Symbol Win":
        return {
          transform: `scale(${1 + Math.sin(rad) * 0.14}) rotate(${Math.sin(rad * 2) * 3}deg)`,
          boxShadow: `0 0 28px ${palette.glow}88`,
        };
      case "Hover":
        return {
          transform: `scale(${1 + Math.sin(rad) * 0.06})`,
          filter: `brightness(${1 + Math.sin(rad) * 0.25})`,
        };
      case "Standalone":
        return {
          transform: `translate(${Math.cos(rad) * 5}px, ${Math.sin(rad) * 5}px) scale(${1 + Math.sin(rad) * 0.08})`,
          boxShadow: `0 0 20px ${palette.accent}66`,
        };
      case "Custom":
      default:
        return {
          transform: `scale(${1 + Math.sin(rad) * 0.08})`,
        };
    }
  }, [activeAnimation, playback.progress, playback.isPlaying, palette.accent, palette.glow]);

  return (
    <div className="space-y-4" data-testid="element-animation-panel">
      {/* 1. Element-level Animation Extra */}
      <div className="rounded-lg border border-white/[0.08] bg-ink-950/60 p-3">
        <Field label="Animation Extra (Element Parameters & Notes)">
          <CommitTextArea
            value={element.animationExtra ?? ""}
            label="Animation Extra"
            placeholder="Extra animation parameters, shader hooks, timing notes, or spine/sprite triggers for this element…"
            onCommit={(animationExtra) =>
              onApply(`Update Animation Extra of ${element.name}`, (d) =>
                setElementAnimationExtra(d, element.id, animationExtra),
              )
            }
          />
        </Field>
      </div>

      {/* 2. Add Animation Builder */}
      <div className="rounded-lg border border-white/[0.08] bg-ink-950/60 p-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-300">
              Add Animation
            </p>
            <p className="text-[11px] text-ink-400">
              Create a Background, Symbol Win, Standalone, Hover, or Custom animation for “{element.name}”.
            </p>
          </div>
          <Button
            variant="primary"
            className="h-7 px-3 text-[11px]"
            data-testid="add-animation-btn"
            aria-label="Add Animation"
            onClick={handleAddAnimation}
          >
            <Icon name="plus" size={12} />
            Add Animation
          </Button>
        </div>

        <div className={`grid gap-2.5 ${compact ? "grid-cols-1" : "sm:grid-cols-3"}`}>
          <Field label="Animation Name">
            <input
              type="text"
              aria-label="New animation name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`${element.name} — ${newType}`}
              className="creation-input w-full"
            />
          </Field>
          <Field label="Animation Type">
            <Select
              aria-label="New animation type"
              className="creation-input"
              value={newType}
              onChange={(e) => handleTypeSelectChange(e.target.value as StudioAnimationType)}
            >
              {STUDIO_ANIMATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source">
            <Select
              aria-label="New animation source"
              className="creation-input"
              value={newSource}
              onChange={(e) => handleSourceSelectChange(e.target.value as AnimationSource)}
            >
              {ANIMATION_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s === "sprite_sheet" ? "Sprite Sheet" : s === "video" ? "Video" : s === "preset" ? "Preset" : "Custom"}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className={`grid gap-2.5 ${compact ? "grid-cols-2" : "sm:grid-cols-4"}`}>
          <Field label="Format">
            <Select
              aria-label="New animation format"
              className="creation-input"
              value={newFormat}
              onChange={(e) => setNewFormat(e.target.value as AnimationFormat)}
            >
              {ANIMATION_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Duration (ms)">
            <input
              type="number"
              aria-label="New animation duration"
              min={50}
              max={60000}
              step={50}
              value={newDuration}
              onChange={(e) => setNewDuration(Math.max(50, Math.min(60000, Number(e.target.value) || 600)))}
              className="creation-input w-full font-mono"
            />
          </Field>
          <Field label="FPS">
            <input
              type="number"
              aria-label="New animation FPS"
              min={1}
              max={240}
              value={newFps}
              onChange={(e) => setNewFps(Math.max(1, Math.min(240, Number(e.target.value) || 24)))}
              className="creation-input w-full font-mono"
            />
          </Field>
          <Field label="Loop">
            <label className="mt-1 inline-flex cursor-pointer items-center gap-2 text-[11.5px] text-ink-200">
              <input
                type="checkbox"
                aria-label="New animation loop"
                checked={newLoop}
                onChange={(e) => setNewLoop(e.target.checked)}
                className="accent-blue-500"
              />
              Loop continuously
            </label>
          </Field>
        </div>
      </div>

      {/* 3. Interactive Playback Preview Stage (play, pause, restart, loop) */}
      <div
        className="rounded-lg border border-white/[0.08] bg-ink-950/70 p-3 space-y-3"
        data-testid="animation-playback-stage"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon name="play" size={13} className="text-accent-400" />
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-200">
              Animation Preview & Playback
            </span>
            {activeAnimation ? (
              <span className="rounded bg-accent-500/15 px-2 py-0.5 font-mono text-[10px] text-blue-200">
                {activeAnimation.name} · {activeAnimation.animationType} · {activeAnimation.fps} FPS
              </span>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant={playback.isPlaying ? "primary" : "ghost"}
              className="h-7 px-2.5 text-[11px]"
              data-testid="playback-play"
              aria-label="Play animation"
              disabled={!activeAnimation}
              onClick={() => setPlayback((curr) => playAnimation(curr))}
            >
              <Icon name="play" size={12} />
              Play
            </Button>
            <Button
              variant={playback.isPaused ? "primary" : "ghost"}
              className="h-7 px-2.5 text-[11px]"
              data-testid="playback-pause"
              aria-label="Pause animation"
              disabled={!activeAnimation}
              onClick={() => setPlayback((curr) => pauseAnimation(curr))}
            >
              <Icon name="pause" size={12} />
              Pause
            </Button>
            <Button
              variant="ghost"
              className="h-7 px-2.5 text-[11px]"
              data-testid="playback-restart"
              aria-label="Restart animation"
              disabled={!activeAnimation}
              onClick={() => setPlayback((curr) => restartAnimation(curr, true))}
            >
              <Icon name="refresh-ccw" size={12} />
              Restart
            </Button>
            <Button
              variant={playback.loop ? "primary" : "ghost"}
              className="h-7 px-2.5 text-[11px]"
              data-testid="playback-loop"
              aria-label="Loop animation"
              aria-pressed={playback.loop}
              disabled={!activeAnimation}
              onClick={() => {
                const nextLoop = !playback.loop;
                setPlayback((curr) => setAnimationPlaybackLoop(curr, nextLoop));
                if (activeAnimation) {
                  onApply(`Toggle loop on ${activeAnimation.name}`, (d) =>
                    updateElementAnimation(d, activeAnimation.id, { loop: nextLoop }),
                  );
                }
              }}
            >
              <Icon name="repeat" size={12} />
              Loop: {playback.loop ? "On" : "Off"}
            </Button>
          </div>
        </div>

        {activeAnimation ? (
          <div className="grid gap-3 md:grid-cols-[200px_1fr]">
            <div
              className="relative grid h-36 place-items-center overflow-hidden rounded-lg border border-white/10"
              style={{
                background: `radial-gradient(circle at 50% 35%, ${palette.surface}, ${palette.background})`,
              }}
            >
              <div
                style={previewMotionStyle}
                className="flex flex-col items-center justify-center rounded-lg border border-white/15 bg-ink-900/80 px-4 py-3 text-center transition-transform duration-75"
              >
                <span className="text-[11px] font-semibold text-ink-100">{activeAnimation.name}</span>
                <span className="mt-0.5 font-mono text-[9.5px] text-ink-400">
                  {activeAnimation.source === "sprite_sheet"
                    ? `Sprite Frame #${activeSpriteRect?.frameIndex ?? playback.currentFrame}`
                    : activeAnimation.source === "video"
                      ? `Video (${activeAnimation.format})`
                      : `${activeAnimation.kind} (${activeAnimation.format})`}
                </span>
              </div>
              <span className="absolute bottom-1.5 right-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9.5px] text-ink-300">
                {playback.status.toUpperCase()}
              </span>
            </div>

            <div className="flex flex-col justify-between space-y-2.5 rounded-lg border border-white/[0.06] bg-ink-900/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                <span className="font-mono text-ink-200">
                  Frame {playback.currentFrame + 1} / {playback.totalFrames}
                </span>
                <span className="font-mono text-ink-300">
                  {Math.round(playback.elapsedMs)} ms / {playback.duration} ms ({Math.round(playback.progress * 100)}%)
                </span>
                <span className="font-mono text-ink-400">
                  Cycles: {playback.cycleCount}
                </span>
              </div>

              <input
                type="range"
                aria-label="Animation timeline scrubber"
                min={0}
                max={Math.max(50, playback.duration)}
                value={Math.round(playback.elapsedMs)}
                onChange={(e) =>
                  setPlayback((curr) => seekAnimationPlayback(curr, Number(e.target.value)))
                }
                className="h-1.5 w-full accent-blue-500"
              />

              {activeSpriteRect ? (
                <div className="rounded border border-white/[0.06] bg-ink-950/60 px-2.5 py-1.5 font-mono text-[10px] text-ink-300">
                  Sprite Slice: col {activeSpriteRect.column}, row {activeSpriteRect.row} · rect ({activeSpriteRect.x}px, {activeSpriteRect.y}px, {activeSpriteRect.width}×{activeSpriteRect.height}px) on {activeSpriteRect.sheetWidth}×{activeSpriteRect.sheetHeight}px sheet
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10.5px] text-ink-400">Scene target:</span>
                  <Select
                    aria-label="Target scene for standalone animation layer"
                    value={targetSceneId}
                    onChange={(e) => setTargetSceneId(e.target.value)}
                    className="creation-input h-7 py-0 text-[11px]"
                  >
                    {scenes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button
                  variant="outline"
                  className="h-7 px-2.5 text-[11px]"
                  data-testid="place-active-animation-in-scene"
                  onClick={() => void handlePlaceAsSceneLayer(activeAnimation)}
                >
                  <Icon name="layers" size={12} />
                  Add to Scene as Layer
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-ink-400">
            No animation selected yet. Click “Add Animation” above to configure an animation for this element.
          </p>
        )}
      </div>

      {/* 4. Configured Element Animations List (Preview, Enable/Disable, Rename, Delete, Sprites/Video Config) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-300">
            Configured Animations ({animations.length})
          </p>
          <span className="text-[10px] text-ink-400">
            Serialized into GameBlueprint.animations
          </span>
        </div>

        {animations.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-[11.5px] text-ink-400">
            No animations configured for “{element.name}”. Use <strong className="text-ink-200">Add Animation</strong> above to register one.
          </div>
        ) : (
          <div className="space-y-3">
            {animations.map((anim) => {
              const isSelected = activeAnimation?.id === anim.id;
              const isEnabled = anim.state === "enabled";
              return (
                <div
                  key={anim.id}
                  data-testid={`animation-card-${anim.id}`}
                  className={`rounded-lg border p-3 transition ${
                    isSelected
                      ? "border-accent-500/45 bg-accent-500/[0.05]"
                      : "border-white/[0.08] bg-ink-950/60"
                  }`}
                >
                  {/* Top action bar: Rename, Type/State badges, Preview, Enable/Disable, Add Layer, Delete */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="min-w-[180px] flex-1">
                        <CommitInput
                          value={anim.name}
                          label={`Rename animation ${anim.name}`}
                          onCommit={(name) =>
                            onApply(`Rename animation to ${name}`, (d) =>
                              renameElementAnimation(d, anim.id, name),
                            )
                          }
                        />
                      </div>
                      <span className="shrink-0 rounded border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-medium text-ink-200">
                        {anim.animationType}
                      </span>
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          isEnabled
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "bg-white/[0.06] text-ink-400"
                        }`}
                      >
                        {anim.state}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant={isSelected && playback.isPlaying ? "primary" : "ghost"}
                        className="h-7 px-2.5 text-[11px]"
                        data-testid={`preview-animation-${anim.id}`}
                        onClick={() => handlePreviewAnimation(anim)}
                      >
                        <Icon name="play" size={12} />
                        Preview
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-7 px-2.5 text-[11px]"
                        data-testid={`toggle-animation-${anim.id}`}
                        aria-pressed={isEnabled}
                        onClick={() =>
                          onApply(
                            `${isEnabled ? "Disable" : "Enable"} animation ${anim.name}`,
                            (d) => toggleElementAnimationState(d, anim.id),
                          )
                        }
                      >
                        <Icon name={isEnabled ? "check" : "x"} size={12} />
                        {isEnabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-7 px-2.5 text-[11px]"
                        data-testid={`place-animation-layer-${anim.id}`}
                        onClick={() => void handlePlaceAsSceneLayer(anim)}
                      >
                        <Icon name="layers" size={12} />
                        Add Layer
                      </Button>
                      <Button
                        variant="danger"
                        className="h-7 px-2.5 text-[11px]"
                        data-testid={`delete-animation-${anim.id}`}
                        aria-label={`Delete animation ${anim.name}`}
                        onClick={() =>
                          onApply(`Delete animation ${anim.name}`, (d) =>
                            deleteElementAnimation(d, anim.id),
                          )
                        }
                      >
                        <Icon name="trash" size={12} />
                        Delete
                      </Button>
                    </div>
                  </div>

                  {/* Core model fields grid */}
                  <div className={`mt-3 grid gap-2.5 ${compact ? "grid-cols-2" : "sm:grid-cols-5"}`}>
                    <Field label="Type">
                      <Select
                        aria-label={`Animation type for ${anim.name}`}
                        className="creation-input"
                        value={anim.animationType}
                        onChange={(e) =>
                          onApply(`Change type of ${anim.name}`, (d) =>
                            updateElementAnimation(d, anim.id, {
                              animationType: e.target.value as StudioAnimationType,
                            }),
                          )
                        }
                      >
                        {STUDIO_ANIMATION_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field label="Source">
                      <Select
                        aria-label={`Animation source for ${anim.name}`}
                        className="creation-input"
                        value={anim.source}
                        onChange={(e) =>
                          onApply(`Change source of ${anim.name}`, (d) =>
                            updateElementAnimation(d, anim.id, {
                              source: e.target.value as AnimationSource,
                            }),
                          )
                        }
                      >
                        {ANIMATION_SOURCES.map((s) => (
                          <option key={s} value={s}>
                            {s === "sprite_sheet" ? "Sprite Sheet" : s === "video" ? "Video" : s === "preset" ? "Preset" : "Custom"}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field label="Format">
                      <Select
                        aria-label={`Animation format for ${anim.name}`}
                        className="creation-input"
                        value={anim.format}
                        onChange={(e) =>
                          onApply(`Change format of ${anim.name}`, (d) =>
                            updateElementAnimation(d, anim.id, {
                              format: e.target.value as AnimationFormat,
                            }),
                          )
                        }
                      >
                        {ANIMATION_FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </Select>
                    </Field>

                    <Field label="Duration (ms)">
                      <CommitInput
                        value={String(anim.duration)}
                        label={`Duration of ${anim.name}`}
                        onCommit={(val) => {
                          const n = Number(val);
                          if (!Number.isFinite(n) || n < 0) return;
                          onApply(`Change duration of ${anim.name}`, (d) =>
                            updateElementAnimation(d, anim.id, { duration: Math.round(n) }),
                          );
                        }}
                      />
                    </Field>

                    <Field label="FPS & Loop">
                      <div className="flex items-center gap-2">
                        <div className="w-20">
                          <CommitInput
                            value={String(anim.fps)}
                            label={`FPS of ${anim.name}`}
                            onCommit={(val) => {
                              const n = Number(val);
                              if (!Number.isFinite(n) || n < 1) return;
                              onApply(`Change FPS of ${anim.name}`, (d) =>
                                updateElementAnimation(d, anim.id, { fps: Math.round(n) }),
                              );
                            }}
                          />
                        </div>
                        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-ink-200">
                          <input
                            type="checkbox"
                            aria-label={`Loop ${anim.name}`}
                            checked={anim.loop}
                            onChange={(e) =>
                              onApply(`Toggle loop on ${anim.name}`, (d) =>
                                updateElementAnimation(d, anim.id, { loop: e.target.checked }),
                              )
                            }
                            className="accent-blue-500"
                          />
                          Loop
                        </label>
                      </div>
                    </Field>
                  </div>

                  {/* Thumbnail & Animation Extra per animation */}
                  <div className={`mt-2.5 grid gap-2.5 ${compact ? "grid-cols-1" : "sm:grid-cols-2"}`}>
                    <Field label="Thumbnail URI">
                      <CommitInput
                        value={anim.thumbnail ?? ""}
                        allowEmpty
                        placeholder="/api/assets/ast_... or thumbnail URI"
                        label={`Thumbnail of ${anim.name}`}
                        onCommit={(val) =>
                          onApply(`Update thumbnail of ${anim.name}`, (d) =>
                            updateElementAnimation(d, anim.id, {
                              thumbnail: val.trim() ? val.trim() : null,
                            }),
                          )
                        }
                      />
                    </Field>
                    <Field label="Animation Extra (Cue Notes / Params)">
                      <CommitInput
                        value={anim.animationExtra ?? ""}
                        allowEmpty
                        placeholder="Custom easing, frame tags, or cue notes"
                        label={`Animation Extra for ${anim.name}`}
                        onCommit={(animationExtra) =>
                          onApply(`Update Animation Extra of ${anim.name}`, (d) =>
                            updateElementAnimation(d, anim.id, { animationExtra }),
                          )
                        }
                      />
                    </Field>
                  </div>

                  {/* Video Reference Configuration */}
                  {anim.source === "video" || anim.videoReference ? (
                    <div className="mt-3 rounded-md border border-white/[0.07] bg-ink-900/60 p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-blue-300">
                          Video Configuration (videoReference)
                        </span>
                        <span className="font-mono text-[10px] text-ink-400">
                          {anim.videoReference?.mimeType ?? "video/mp4"}
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-4">
                        <Field label="Project Asset">
                          <Select
                            aria-label={`Video asset for ${anim.name}`}
                            className="creation-input"
                            value={anim.videoReference?.assetId ?? ""}
                            onChange={(e) => {
                              const assetId = e.target.value || null;
                              const asset = assetId ? doc.assets.find((a) => a.id === assetId) : null;
                              onApply(`Configure video asset for ${anim.name}`, (d) =>
                                configureAnimationVideo(d, anim.id, {
                                  ...(anim.videoReference ?? {}),
                                  assetId,
                                  uri: asset?.uri ?? anim.videoReference?.uri ?? null,
                                }),
                              );
                            }}
                          >
                            <option value="">None (External / URI)</option>
                            {doc.assets.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} ({a.kind})
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Video URI">
                          <CommitInput
                            value={anim.videoReference?.uri ?? ""}
                            allowEmpty
                            placeholder="/assets/animations/win.mp4"
                            label={`Video URI for ${anim.name}`}
                            onCommit={(uri) =>
                              onApply(`Update video URI for ${anim.name}`, (d) =>
                                configureAnimationVideo(d, anim.id, {
                                  ...(anim.videoReference ?? {}),
                                  uri: uri.trim() || null,
                                }),
                              )
                            }
                          />
                        </Field>
                        <Field label="Dimensions (W×H)">
                          <div className="grid grid-cols-2 gap-1.5">
                            <CommitInput
                              value={String(anim.videoReference?.width ?? 512)}
                              label={`Video width for ${anim.name}`}
                              onCommit={(w) =>
                                onApply(`Update video width for ${anim.name}`, (d) =>
                                  configureAnimationVideo(d, anim.id, {
                                    ...(anim.videoReference ?? { uri: null }),
                                    width: Math.max(1, Number(w) || 512),
                                  }),
                                )
                              }
                            />
                            <CommitInput
                              value={String(anim.videoReference?.height ?? 512)}
                              label={`Video height for ${anim.name}`}
                              onCommit={(h) =>
                                onApply(`Update video height for ${anim.name}`, (d) =>
                                  configureAnimationVideo(d, anim.id, {
                                    ...(anim.videoReference ?? { uri: null }),
                                    height: Math.max(1, Number(h) || 512),
                                  }),
                                )
                              }
                            />
                          </div>
                        </Field>
                        <Field label="Playback Rate">
                          <CommitInput
                            value={String(anim.videoReference?.playbackRate ?? 1)}
                            label={`Video playback rate for ${anim.name}`}
                            onCommit={(rate) =>
                              onApply(`Update video playback rate for ${anim.name}`, (d) =>
                                configureAnimationVideo(d, anim.id, {
                                  ...(anim.videoReference ?? { uri: null }),
                                  playbackRate: Math.max(0.1, Math.min(4, Number(rate) || 1)),
                                }),
                              )
                            }
                          />
                        </Field>
                      </div>
                    </div>
                  ) : null}

                  {/* Sprite Sheet Reference Configuration */}
                  {anim.source === "sprite_sheet" || anim.spriteSheetReference ? (
                    <div className="mt-3 rounded-md border border-white/[0.07] bg-ink-900/60 p-2.5 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-300">
                          Sprite Sheet Configuration (spriteSheetReference)
                        </span>
                        <span className="text-[10px] text-ink-400">
                          Manual sprite configuration · AI sprite generation is disabled
                        </span>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Field label="Sprite Sheet Asset">
                          <Select
                            aria-label={`Sprite sheet asset for ${anim.name}`}
                            className="creation-input"
                            value={anim.spriteSheetReference?.assetId ?? ""}
                            onChange={(e) => {
                              const assetId = e.target.value || null;
                              const asset = assetId ? doc.assets.find((a) => a.id === assetId) : null;
                              onApply(`Set sprite sheet asset for ${anim.name}`, (d) =>
                                configureAnimationSpriteSheet(d, anim.id, {
                                  ...(anim.spriteSheetReference ?? {
                                    columns: 4,
                                    rows: 4,
                                    frameWidth: 128,
                                    frameHeight: 128,
                                    frameCount: 16,
                                  }),
                                  assetId,
                                  uri: asset?.uri ?? anim.spriteSheetReference?.uri ?? null,
                                }),
                              );
                            }}
                          >
                            <option value="">None (External / URI)</option>
                            {doc.assets.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} ({a.kind})
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Sprite Sheet URI">
                          <CommitInput
                            value={anim.spriteSheetReference?.uri ?? ""}
                            allowEmpty
                            placeholder="/api/assets/ast_sprite_1"
                            label={`Sprite sheet URI for ${anim.name}`}
                            onCommit={(uri) =>
                              onApply(`Update sprite sheet URI for ${anim.name}`, (d) =>
                                configureAnimationSpriteSheet(d, anim.id, {
                                  ...(anim.spriteSheetReference ?? {
                                    columns: 4,
                                    rows: 4,
                                    frameWidth: 128,
                                    frameHeight: 128,
                                    frameCount: 16,
                                  }),
                                  uri: uri.trim() || null,
                                }),
                              )
                            }
                          />
                        </Field>
                        <Field label="Grid (Columns × Rows)">
                          <div className="grid grid-cols-2 gap-1.5">
                            <CommitInput
                              value={String(anim.spriteSheetReference?.columns ?? 4)}
                              label={`Sprite columns for ${anim.name}`}
                              onCommit={(cols) => {
                                const c = Math.max(1, Math.round(Number(cols) || 4));
                                const r = anim.spriteSheetReference?.rows ?? 4;
                                onApply(`Update sprite columns for ${anim.name}`, (d) =>
                                  configureAnimationSpriteSheet(d, anim.id, {
                                    ...(anim.spriteSheetReference ?? { uri: null, rows: r, frameWidth: 128, frameHeight: 128 }),
                                    columns: c,
                                    frameCount: c * r,
                                  }),
                                );
                              }}
                            />
                            <CommitInput
                              value={String(anim.spriteSheetReference?.rows ?? 4)}
                              label={`Sprite rows for ${anim.name}`}
                              onCommit={(rows) => {
                                const r = Math.max(1, Math.round(Number(rows) || 4));
                                const c = anim.spriteSheetReference?.columns ?? 4;
                                onApply(`Update sprite rows for ${anim.name}`, (d) =>
                                  configureAnimationSpriteSheet(d, anim.id, {
                                    ...(anim.spriteSheetReference ?? { uri: null, columns: c, frameWidth: 128, frameHeight: 128 }),
                                    rows: r,
                                    frameCount: c * r,
                                  }),
                                );
                              }}
                            />
                          </div>
                        </Field>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-3">
                        <Field label="Frame Size (W × H px)">
                          <div className="grid grid-cols-2 gap-1.5">
                            <CommitInput
                              value={String(anim.spriteSheetReference?.frameWidth ?? 128)}
                              label={`Sprite frame width for ${anim.name}`}
                              onCommit={(fw) =>
                                onApply(`Update sprite frame width for ${anim.name}`, (d) =>
                                  configureAnimationSpriteSheet(d, anim.id, {
                                    ...(anim.spriteSheetReference ?? { uri: null, columns: 4, rows: 4, frameHeight: 128, frameCount: 16 }),
                                    frameWidth: Math.max(1, Math.round(Number(fw) || 128)),
                                  }),
                                )
                              }
                            />
                            <CommitInput
                              value={String(anim.spriteSheetReference?.frameHeight ?? 128)}
                              label={`Sprite frame height for ${anim.name}`}
                              onCommit={(fh) =>
                                onApply(`Update sprite frame height for ${anim.name}`, (d) =>
                                  configureAnimationSpriteSheet(d, anim.id, {
                                    ...(anim.spriteSheetReference ?? { uri: null, columns: 4, rows: 4, frameWidth: 128, frameCount: 16 }),
                                    frameHeight: Math.max(1, Math.round(Number(fh) || 128)),
                                  }),
                                )
                              }
                            />
                          </div>
                        </Field>
                        <Field label="Frame Count">
                          <CommitInput
                            value={String(anim.spriteSheetReference?.frameCount ?? 16)}
                            label={`Sprite frame count for ${anim.name}`}
                            onCommit={(fc) =>
                              onApply(`Update sprite frame count for ${anim.name}`, (d) =>
                                configureAnimationSpriteSheet(d, anim.id, {
                                  ...(anim.spriteSheetReference ?? { uri: null, columns: 4, rows: 4, frameWidth: 128, frameHeight: 128 }),
                                  frameCount: Math.max(1, Math.round(Number(fc) || 16)),
                                }),
                              )
                            }
                          />
                        </Field>
                        <Field label="Spacing / Margin (px)">
                          <div className="grid grid-cols-2 gap-1.5">
                            <CommitInput
                              value={String(anim.spriteSheetReference?.spacing ?? 0)}
                              label={`Sprite spacing for ${anim.name}`}
                              onCommit={(sp) =>
                                onApply(`Update sprite spacing for ${anim.name}`, (d) =>
                                  configureAnimationSpriteSheet(d, anim.id, {
                                    ...(anim.spriteSheetReference ?? { uri: null, columns: 4, rows: 4, frameWidth: 128, frameHeight: 128, frameCount: 16 }),
                                    spacing: Math.max(0, Math.round(Number(sp) || 0)),
                                  }),
                                )
                              }
                            />
                            <CommitInput
                              value={String(anim.spriteSheetReference?.margin ?? 0)}
                              label={`Sprite margin for ${anim.name}`}
                              onCommit={(mg) =>
                                onApply(`Update sprite margin for ${anim.name}`, (d) =>
                                  configureAnimationSpriteSheet(d, anim.id, {
                                    ...(anim.spriteSheetReference ?? { uri: null, columns: 4, rows: 4, frameWidth: 128, frameHeight: 128, frameCount: 16 }),
                                    margin: Math.max(0, Math.round(Number(mg) || 0)),
                                  }),
                                )
                              }
                            />
                          </div>
                        </Field>
                      </div>
                    </div>
                  ) : null}

                  {/* Metadata footer showing serialized ID and Element ID */}
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.05] pt-2 font-mono text-[10px] text-ink-400">
                    <span>id: {anim.id}</span>
                    <span>elementId: {anim.elementId}</span>
                    <span>target: {anim.target}</span>
                    <span>trigger: {anim.trigger}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
