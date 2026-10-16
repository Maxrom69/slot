"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Icon, Select, TextArea, TextInput, Toggle } from "@/components/ui";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";
import { GridSizeChangeConfirmModal } from "@/components/studio/IntegrationModals";
import type { GameBlueprint, SymbolTier } from "@/lib/blueprint/types";
import { workspaceApi } from "@/lib/client/workspace-api";
import {
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
} from "@/lib/design/history";
import { clearCrossRouteEditorCache } from "@/lib/editor/EditorProvider";
import { changeBlueprintGridSize } from "@/lib/integration";
import { studioToastStore } from "@/lib/notifications/toast-store";
import { projectPersistence } from "@/lib/persistence/project-persistence";
import {
  addReel,
  appendStopToReel,
  applyReelConfigurationToBlueprint,
  applyTextStopsToReel,
  buildSymbolPalette,
  duplicateReel,
  duplicateStopInReel,
  filterSymbolPalette,
  formatReelStopsToText,
  MAX_REEL_COUNT,
  MIN_REEL_COUNT,
  moveStopBetweenReels,
  parseReelStopsText,
  reelConfigurationFromBlueprint,
  removeReel,
  removeStopFromReel,
  reorderStopInReel,
  repairStopCorruption,
  setWeightsEnabled,
  syncReelConfiguration,
  updateStopWeight,
  validateReelConfiguration,
  type ReelConfigurationData,
  type SymbolPaletteItem,
} from "@/lib/reels";
import type { ProjectDetail } from "@/lib/workspace/types";

interface DragStopPayload {
  fromReelIndex: number;
  fromStopIndex: number;
  stopId: string;
}

const TIER_BADGE_STYLE: Record<SymbolTier, string> = {
  high: "border-amber-400/30 bg-amber-500/15 text-amber-200",
  mid: "border-sky-400/30 bg-sky-500/15 text-sky-200",
  low: "border-slate-400/30 bg-slate-500/15 text-slate-300",
  special: "border-fuchsia-400/30 bg-fuchsia-500/15 text-fuchsia-200",
};

export function ReelEditorWorkspace({ project }: { project: ProjectDetail }) {
  const [blueprint, setBlueprint] = useState<GameBlueprint>(project.blueprint);
  const initialConfig = useMemo(
    () => reelConfigurationFromBlueprint(project.blueprint),
    [project.blueprint],
  );

  const [history, setHistory] = useState(() => createHistory(initialConfig));
  const config = history.present;

  const [selectedReelIndex, setSelectedReelIndex] = useState(0);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteTier, setPaletteTier] = useState<SymbolTier | "all">("all");
  const [paletteArtwork, setPaletteArtwork] = useState<
    "all" | "linked" | "placeholder"
  >("all");

  const [textSeparator, setTextSeparator] = useState<
    "comma" | "newline" | "space"
  >("comma");
  const [textDraft, setTextDraft] = useState<string>("");
  const [textDirty, setTextDirty] = useState(false);
  const [showTextView, setShowTextView] = useState(true);
  const [showMultiReelBoard, setShowMultiReelBoard] = useState(false);

  const [dragState, setDragState] = useState<DragStopPayload | null>(null);
  const [dropTargetReel, setDropTargetReel] = useState<number | null>(null);
  const [dropTargetStop, setDropTargetStop] = useState<{
    reelIndex: number;
    stopIndex: number;
  } | null>(null);

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const [pendingGridSize, setPendingGridSize] = useState<{ columns: number; rows: number } | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Clamp selectedReelIndex if reels are removed
  const activeReelIndex = Math.max(
    0,
    Math.min(config.reels.length - 1, selectedReelIndex),
  );
  const selectedReel = config.reels[activeReelIndex] ?? config.reels[0];

  const paletteItems = useMemo(() => buildSymbolPalette(blueprint), [blueprint]);
  const symbolById = useMemo(
    () => new Map<string, SymbolPaletteItem>(paletteItems.map((s) => [s.id, s])),
    [paletteItems],
  );
  const defaultSymbolWeights = useMemo(
    () => new Map<string, number>(paletteItems.map((s) => [s.id, s.reelWeight])),
    [paletteItems],
  );
  const knownSymbolIds = useMemo(
    () => new Set<string>(paletteItems.map((s) => s.id)),
    [paletteItems],
  );

  const filteredPalette = useMemo(
    () =>
      filterSymbolPalette(paletteItems, paletteQuery, {
        tier: paletteTier,
        artwork: paletteArtwork,
      }),
    [paletteItems, paletteQuery, paletteTier, paletteArtwork],
  );

  // Keep text editor synchronized when switching reels or modifying stops via UI
  const formattedReelText = useMemo(
    () => formatReelStopsToText(selectedReel, textSeparator),
    [selectedReel, textSeparator],
  );
  const effectiveTextDraft = textDirty ? textDraft : formattedReelText;

  const textValidation = useMemo(
    () => parseReelStopsText(effectiveTextDraft, knownSymbolIds),
    [effectiveTextDraft, knownSymbolIds],
  );

  const validation = useMemo(
    () => validateReelConfiguration(config, blueprint.symbols),
    [config, blueprint.symbols],
  );

  const commitConfig = useCallback(
    (next: ReelConfigurationData, label = "Edit reel configuration") => {
      setHistory((prev) => commitHistory(prev, next, label));
      setDirty(true);
      setTextDirty(false);
      setSaveMessage(null);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      const undone = undoHistory(prev);
      return undone ? undone.state : prev;
    });
    setTextDirty(false);
    setDirty(true);
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((prev) => {
      const redone = redoHistory(prev);
      return redone ? redone.state : prev;
    });
    setTextDirty(false);
    setDirty(true);
  }, []);

  // Save configuration into GameBlueprint.reelConfiguration (both local & server)
  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMessage(null);
    const nextBlueprint = applyReelConfigurationToBlueprint(blueprint, config);
    setBlueprint(nextBlueprint);

    // Always persist locally in LocalProjectPersistenceService so offline/local mode works
    try {
      await projectPersistence.saveProject(project.id, nextBlueprint);
    } catch {
      // Ignore if not seeded in localStorage yet
    }

    try {
      const updated = await workspaceApi.updateProject(project.id, {
        blueprint: nextBlueprint,
      });
      setBlueprint(updated.blueprint);
      clearCrossRouteEditorCache(project.id);
      setDirty(false);
      setSaveMessage("Saved to GameBlueprint.reelConfiguration");
      studioToastStore.push(
        "Reel configuration saved to GameBlueprint.reelConfiguration",
        "success",
      );
    } catch (error) {
      // Even if backend call fails (or when running offline), local blueprint state is updated
      clearCrossRouteEditorCache(project.id);
      setDirty(false);
      const detail =
        error instanceof Error
          ? error.message
          : "Saved locally to GameBlueprint.reelConfiguration";
      setSaveMessage(`Saved locally (${detail})`);
      studioToastStore.push(
        "Reel configuration updated in local GameBlueprint",
        "info",
      );
    } finally {
      setSaving(false);
    }
  }, [blueprint, config, project.id]);

  useEffect(() => {
    if (!autosaveEnabled || !dirty || saving) return;
    const timer = setTimeout(() => {
      void handleSave();
    }, 900);
    return () => clearTimeout(timer);
  }, [autosaveEnabled, dirty, saving, handleSave]);

  // Keyboard shortcuts for Undo / Redo / Save
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleSave, handleUndo]);

  /* ------------------------------------------------------------------------ */
  /* Handlers for Reels, Stops, Drag & Drop, Text View, and Weights           */
  /* ------------------------------------------------------------------------ */

  const handleSelectSymbolFromPalette = useCallback(
    (item: SymbolPaletteItem) => {
      const next = appendStopToReel(
        config,
        activeReelIndex,
        item.id,
        item.reelWeight,
      );
      commitConfig(next);
    },
    [activeReelIndex, commitConfig, config],
  );

  const handleDuplicateStop = useCallback(
    (reelIdx: number, stopIdx: number) => {
      commitConfig(duplicateStopInReel(config, reelIdx, stopIdx));
    },
    [commitConfig, config],
  );

  const handleRemoveStop = useCallback(
    (reelIdx: number, stopIdx: number) => {
      commitConfig(removeStopFromReel(config, reelIdx, stopIdx));
    },
    [commitConfig, config],
  );

  const handleReorderStop = useCallback(
    (reelIdx: number, fromIdx: number, toIdx: number) => {
      commitConfig(reorderStopInReel(config, reelIdx, fromIdx, toIdx));
    },
    [commitConfig, config],
  );

  const handleMoveStopToReel = useCallback(
    (
      fromReelIdx: number,
      fromStopIdx: number,
      toReelIdx: number,
      toStopIdx?: number,
    ) => {
      commitConfig(
        moveStopBetweenReels(
          config,
          fromReelIdx,
          fromStopIdx,
          toReelIdx,
          toStopIdx,
        ),
      );
    },
    [commitConfig, config],
  );

  const handleAddReel = useCallback(() => {
    const starterSymbols = paletteItems.slice(0, 3).map((s) => s.id);
    const next = addReel(config, {
      initialSymbolIds: starterSymbols,
      defaultWeights: defaultSymbolWeights,
    });
    commitConfig(next);
    setSelectedReelIndex(next.reels.length - 1);
  }, [commitConfig, config, defaultSymbolWeights, paletteItems]);

  const handleDuplicateReel = useCallback(
    (reelIdx: number) => {
      const next = duplicateReel(config, reelIdx, true);
      commitConfig(next);
      setSelectedReelIndex(reelIdx + 1);
    },
    [commitConfig, config],
  );

  const handleRemoveReel = useCallback(
    (reelIdx: number) => {
      if (config.reels.length <= 1) return;
      const next = removeReel(config, reelIdx);
      commitConfig(next);
      setSelectedReelIndex((prev) => Math.max(0, Math.min(next.reels.length - 1, prev)));
    },
    [commitConfig, config],
  );

  const handleClearReelStops = useCallback(
    (reelIdx: number) => {
      const nextReels = config.reels.map((r, idx) =>
        idx === reelIdx ? { ...r, stops: [] } : r,
      );
      commitConfig(syncReelConfiguration({ ...config, reels: nextReels }));
    },
    [commitConfig, config],
  );

  const handleToggleWeights = useCallback(
    (enabled: boolean) => {
      commitConfig(setWeightsEnabled(config, enabled, defaultSymbolWeights));
    },
    [commitConfig, config, defaultSymbolWeights],
  );

  const handleWeightChange = useCallback(
    (reelIdx: number, stopIdx: number, rawValue: string) => {
      const parsed = rawValue.trim() === "" ? 0 : Number(rawValue);
      commitConfig(updateStopWeight(config, reelIdx, stopIdx, parsed));
    },
    [commitConfig, config],
  );

  const handleApplyTextView = useCallback(() => {
    const next = applyTextStopsToReel(config, activeReelIndex, effectiveTextDraft, {
      defaultWeights: defaultSymbolWeights,
    });
    commitConfig(next);
    setTextDirty(false);
  }, [activeReelIndex, commitConfig, config, defaultSymbolWeights, effectiveTextDraft]);

  const handleRepairCorruption = useCallback(() => {
    commitConfig(repairStopCorruption(config));
  }, [commitConfig, config]);

  // Count how many stops of each symbol exist on the active reel
  const activeReelSymbolCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const stop of selectedReel?.stops ?? []) {
      counts.set(stop.symbolId, (counts.get(stop.symbolId) ?? 0) + 1);
    }
    return counts;
  }, [selectedReel]);

  const activeReelTotalWeight = useMemo(() => {
    return (selectedReel?.stops ?? []).reduce(
      (sum, stop) =>
        sum +
        (typeof stop.weight === "number" && Number.isFinite(stop.weight) && stop.weight > 0
          ? stop.weight
          : 0),
      0,
    );
  }, [selectedReel]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950 text-ink-100">
      <ProjectTopNav projectId={project.id} projectTitle={project.title} />

      {/* TOP HEADER BAR */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-900 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-sm font-semibold tracking-tight text-ink-100">
                Reel Configuration Editor
              </h1>
              <Badge tone="accent">F14 · Config Only</Badge>
              <span className="hidden text-[11px] text-ink-400 md:inline">
                {project.title} · {config.columns}×{config.rows} ({config.evaluation})
              </span>
            </div>
            <p className="truncate text-[10.5px] text-ink-400">
              Declarative reel strips &amp; stop weights for{" "}
              <code className="font-mono text-ink-300">
                GameBlueprint.reelConfiguration
              </code>
              . RNG &amp; spin outcomes belong to Section 2.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Undo / Redo */}
          <div
            className="flex items-center gap-1 rounded-md border border-white/[0.07] bg-ink-850 p-0.5"
            role="group"
            aria-label="Reel history"
          >
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              aria-label="Undo"
              title="Undo (Ctrl/⌘ Z)"
              disabled={history.past.length === 0}
              onClick={handleUndo}
            >
              <Icon name="undo" size={13} />
              Undo
            </Button>
            <Button
              variant="ghost"
              className="h-7 px-2 text-xs"
              aria-label="Redo"
              title="Redo (Ctrl/⌘ Shift Z)"
              disabled={history.future.length === 0}
              onClick={handleRedo}
            >
              <Icon name="redo" size={13} />
              Redo
            </Button>
          </div>

          {/* Optional Weights Toggle */}
          <div className="flex items-center gap-2 rounded-md border border-white/[0.07] bg-ink-850 px-2.5 py-1">
            <span className="text-[11px] font-medium text-ink-200">
              Stop Weights
            </span>
            <Toggle
              label="Enable per-stop weights"
              checked={config.weightsEnabled}
              onChange={handleToggleWeights}
            />
          </div>

          {/* View toggles */}
          <button
            type="button"
            onClick={() => setShowTextView((v) => !v)}
            aria-pressed={showTextView}
            className={`focus-ring rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              showTextView
                ? "border-accent-500/40 bg-accent-600/15 text-ink-100"
                : "border-white/10 bg-ink-850 text-ink-300 hover:text-ink-100"
            }`}
          >
            Text View
          </button>

          <button
            type="button"
            onClick={() => setShowMultiReelBoard((v) => !v)}
            aria-pressed={showMultiReelBoard}
            className={`focus-ring rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
              showMultiReelBoard
                ? "border-accent-500/40 bg-accent-600/15 text-ink-100"
                : "border-white/10 bg-ink-850 text-ink-300 hover:text-ink-100"
            }`}
          >
            All Reels Board
          </button>

          {/* Validation Badge */}
          <span
            role="status"
            aria-label="Reel validation status"
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${
              validation.valid
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/40 bg-rose-500/15 text-rose-200"
            }`}
          >
            <Icon name={validation.valid ? "check" : "alert"} size={13} />
            {validation.valid
              ? "Valid Configuration"
              : `${validation.issues.length} ${
                  validation.issues.length === 1 ? "Issue" : "Issues"
                }`}
          </span>

          {/* Grid Resize with Dependency Check */}
          <Select
            aria-label="Grid size preset"
            value={`${config.columns}x${config.rows}`}
            onChange={(e) => {
              const [cStr, rStr] = e.target.value.split("x");
              const c = Number(cStr);
              const r = Number(rStr);
              if (c && r && (c !== config.columns || r !== config.rows)) {
                setPendingGridSize({ columns: c, rows: r });
              }
            }}
            className="h-8 w-28 text-xs"
          >
            <option value="3x3">3×3 Grid</option>
            <option value="5x3">5×3 Grid</option>
            <option value="5x4">5×4 Grid</option>
            <option value="6x4">6×4 Grid</option>
            <option value="6x5">6×5 Grid</option>
            {!["3x3", "5x3", "5x4", "6x4", "6x5"].includes(`${config.columns}x${config.rows}`) && (
              <option value={`${config.columns}x${config.rows}`}>
                {config.columns}×{config.rows} Custom
              </option>
            )}
          </Select>

          {/* Dirty indicator & Autosave */}
          <Badge tone={dirty ? "warning" : "success"}>
            {saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}
          </Badge>

          <button
            type="button"
            role="switch"
            aria-checked={autosaveEnabled}
            onClick={() => setAutosaveEnabled((v) => !v)}
            className={`rounded-md border px-2 py-1 text-[11px] font-medium transition ${
              autosaveEnabled
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                : "border-white/10 bg-ink-850 text-ink-300 hover:text-ink-100"
            }`}
          >
            Autosave {autosaveEnabled ? "On" : "Off"}
          </button>

          {/* Save Button */}
          <Button
            variant="primary"
            onClick={() => void handleSave()}
            disabled={saving}
            aria-label="Save reel configuration"
          >
            <Icon name="save" size={13} />
            {saving ? "Saving…" : dirty ? "Save Reels*" : "Save Reels"}
          </Button>
        </div>
      </header>

      {/* TOP REEL SELECTOR BAR: Reel 1 | Reel 2 | Reel 3 | ... + Add / Duplicate / Remove Reel */}
      <nav
        aria-label="Reel tabs"
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-ink-900/60 px-4 py-2"
      >
        <div className="flex flex-wrap items-center gap-1.5" role="tablist">
          {config.reels.map((reel, reelIdx) => {
            const isSelected = reelIdx === activeReelIndex;
            const reelIssues = validation.issues.filter(
              (iss) => iss.reelIndex === reelIdx,
            );
            const isDropTarget = dropTargetReel === reelIdx;
            const reelWeightSum = reel.stops.reduce(
              (acc, st) =>
                acc +
                (typeof st.weight === "number" && Number.isFinite(st.weight) && st.weight > 0
                  ? st.weight
                  : 0),
              0,
            );

            return (
              <button
                key={reel.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-reel-tab={reelIdx + 1}
                onClick={() => {
                  setSelectedReelIndex(reelIdx);
                  setTextDirty(false);
                }}
                onDragOver={(e) => {
                  if (!dragState) return;
                  e.preventDefault();
                  setDropTargetReel(reelIdx);
                }}
                onDragLeave={() => {
                  if (dropTargetReel === reelIdx) setDropTargetReel(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTargetReel(null);
                  if (!dragState) return;
                  handleMoveStopToReel(
                    dragState.fromReelIndex,
                    dragState.fromStopIndex,
                    reelIdx,
                  );
                  setDragState(null);
                }}
                className={`focus-ring group relative flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
                  isDropTarget
                    ? "border-sky-400 bg-sky-500/20 text-white ring-2 ring-sky-400/40"
                    : isSelected
                      ? "border-accent-500/50 bg-accent-600/20 text-ink-100"
                      : "border-white/10 bg-ink-850 text-ink-300 hover:border-white/20 hover:text-ink-100"
                }`}
              >
                <span>{reel.name}</span>
                <span className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[10px] text-ink-300">
                  {reel.stops.length}
                </span>
                {config.weightsEnabled ? (
                  <span
                    className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-200"
                    title="Total weight on this reel"
                  >
                    w:{reelWeightSum}
                  </span>
                ) : null}
                {reelIssues.length > 0 ? (
                  <span
                    className="h-2 w-2 rounded-full bg-rose-400"
                    title={reelIssues.map((i) => i.message).join("\n")}
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Reel Strip Actions: Add Reel, Duplicate Reel, Remove Reel */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            onClick={handleAddReel}
            aria-label="Add Reel"
            title={`Add Reel (recommended ${MIN_REEL_COUNT}–${MAX_REEL_COUNT} reels)`}
          >
            <Icon name="plus" size={13} />
            Add Reel
          </Button>
          <Button
            onClick={() => handleDuplicateReel(activeReelIndex)}
            aria-label="Duplicate Reel"
            title={`Duplicate ${selectedReel?.name ?? "Reel"}`}
          >
            <Icon name="copy" size={13} />
            Duplicate Reel
          </Button>
          <Button
            variant="danger"
            onClick={() => handleRemoveReel(activeReelIndex)}
            disabled={config.reels.length <= 1}
            aria-label="Remove Reel"
            title={`Remove ${selectedReel?.name ?? "Reel"}`}
          >
            <Icon name="trash" size={13} />
            Remove Reel
          </Button>
        </div>
      </nav>

      {/* MAIN WORKSPACE: Selected Reel Strip (Center/Left) + Symbol Palette & Validation (Right) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* LEFT / CENTER COLUMN: SELECTED REEL STRIP + OPTIONAL MULTI-REEL BOARD + TEXT VIEW */}
        <main className="flex min-h-0 flex-col overflow-y-auto p-4 space-y-4">
          {saveMessage ? (
            <div className="flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              <span>{saveMessage}</span>
              <button
                type="button"
                onClick={() => setSaveMessage(null)}
                className="text-emerald-300 hover:text-white"
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {/* SELECTED REEL STRIP CARD */}
          {selectedReel ? (
            <section
              aria-label={`Selected reel strip ${selectedReel.name}`}
              className="flex flex-col rounded-xl border border-white/[0.08] bg-ink-900 shadow-lg"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] px-4 py-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-sm font-semibold text-ink-100">
                      {selectedReel.name} Strip
                    </h2>
                    <span className="rounded border border-white/10 bg-ink-850 px-2 py-0.5 font-mono text-[11px] text-ink-300">
                      {selectedReel.stops.length}{" "}
                      {selectedReel.stops.length === 1 ? "stop" : "stops"}
                    </span>
                    {config.weightsEnabled ? (
                      <span className="rounded border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[11px] text-amber-200">
                        Total Weight: {activeReelTotalWeight}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-400">
                    Drag stops to reorder within {selectedReel.name}, or drag onto any{" "}
                    <strong className="font-medium text-ink-200">Reel N</strong> tab above
                    to move a stop to another reel.
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => handleClearReelStops(activeReelIndex)}
                    disabled={selectedReel.stops.length === 0}
                  >
                    Clear Stops
                  </Button>
                </div>
              </div>

              {/* REEL STOPS LIST */}
              <div className="divide-y divide-white/[0.05] p-3">
                {selectedReel.stops.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-rose-500/40 bg-rose-500/5 p-6 text-center">
                    <div className="text-xs font-semibold text-rose-200">
                      {selectedReel.name} is empty
                    </div>
                    <p className="mt-1 text-[11px] text-ink-400">
                      Click any symbol in the Symbol Palette on the right or enter symbol IDs
                      in the Text View below to populate this reel strip.
                    </p>
                  </div>
                ) : (
                  selectedReel.stops.map((stop, stopIdx) => {
                    const sym = symbolById.get(stop.symbolId);
                    const isUnknown = !sym;
                    const weightInvalid =
                      config.weightsEnabled &&
                      (typeof stop.weight !== "number" ||
                        !Number.isFinite(stop.weight) ||
                        stop.weight <= 0);
                    const isDropHere =
                      dropTargetStop?.reelIndex === activeReelIndex &&
                      dropTargetStop?.stopIndex === stopIdx;
                    const weightShare =
                      config.weightsEnabled &&
                      activeReelTotalWeight > 0 &&
                      typeof stop.weight === "number" &&
                      stop.weight > 0
                        ? `${((stop.weight / activeReelTotalWeight) * 100).toFixed(1)}%`
                        : null;

                    return (
                      <div
                        key={stop.id || `${activeReelIndex}-${stopIdx}`}
                        draggable
                        data-stop-id={stop.id}
                        data-stop-position={stop.position}
                        onDragStart={(e) => {
                          setDragState({
                            fromReelIndex: activeReelIndex,
                            fromStopIndex: stopIdx,
                            stopId: stop.id,
                          });
                          e.dataTransfer.effectAllowed = "move";
                          try {
                            e.dataTransfer.setData(
                              "text/plain",
                              JSON.stringify({
                                fromReelIndex: activeReelIndex,
                                fromStopIndex: stopIdx,
                                stopId: stop.id,
                              }),
                            );
                          } catch {
                            // Ignore dataTransfer restrictions in headless environments
                          }
                        }}
                        onDragEnd={() => {
                          setDragState(null);
                          setDropTargetReel(null);
                          setDropTargetStop(null);
                        }}
                        onDragOver={(e) => {
                          if (!dragState) return;
                          e.preventDefault();
                          setDropTargetStop({
                            reelIndex: activeReelIndex,
                            stopIndex: stopIdx,
                          });
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDropTargetStop(null);
                          if (!dragState) return;
                          if (dragState.fromReelIndex === activeReelIndex) {
                            handleReorderStop(
                              activeReelIndex,
                              dragState.fromStopIndex,
                              stopIdx,
                            );
                          } else {
                            handleMoveStopToReel(
                              dragState.fromReelIndex,
                              dragState.fromStopIndex,
                              activeReelIndex,
                              stopIdx,
                            );
                          }
                          setDragState(null);
                        }}
                        className={`flex flex-wrap items-center justify-between gap-2.5 rounded-lg px-2.5 py-2 transition ${
                          isDropHere
                            ? "border border-sky-400 bg-sky-500/15"
                            : isUnknown || weightInvalid
                              ? "bg-rose-500/10 hover:bg-rose-500/15"
                              : "hover:bg-white/[0.03]"
                        }`}
                      >
                        {/* Left: Drag Handle + Position + Thumbnail + Symbol ID + Name */}
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <span
                            className="cursor-grab text-ink-400 hover:text-ink-200 active:cursor-grabbing"
                            title="Drag to reorder or move to another reel"
                            aria-hidden="true"
                          >
                            ⋮⋮
                          </span>

                          {/* Position */}
                          <span
                            className="w-10 shrink-0 rounded border border-white/10 bg-ink-850 px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold text-ink-200"
                            title={`Stop position ${stop.position}`}
                          >
                            #{stop.position}
                          </span>

                          {/* Thumbnail */}
                          <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-ink-850">
                            {sym?.hasArtwork && sym.artworkUri ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={sym.artworkUri}
                                alt={sym.name}
                                className="h-full w-full object-contain"
                              />
                            ) : isUnknown ? (
                              <span className="text-xs font-bold text-rose-400">
                                ?
                              </span>
                            ) : (
                              <span className="text-sm font-semibold text-ink-100">
                                {sym.glyph}
                              </span>
                            )}
                          </div>

                          {/* Symbol ID + Name */}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-xs font-semibold text-ink-100">
                                {sym ? sym.name : "Unknown Symbol"}
                              </span>
                              <code className="rounded border border-white/10 bg-black/30 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-300">
                                {stop.symbolId}
                              </code>
                              {sym ? (
                                <span
                                  className={`rounded border px-1.5 py-0.2 text-[9.5px] font-semibold uppercase ${
                                    TIER_BADGE_STYLE[sym.tier]
                                  }`}
                                >
                                  {sym.tier}
                                </span>
                              ) : (
                                <span className="rounded border border-rose-500/40 bg-rose-500/20 px-1.5 py-0.5 text-[9.5px] font-semibold text-rose-200 uppercase">
                                  Unknown ID
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-ink-400">
                              Stop ID: {stop.id}
                              {sym?.artworkName ? ` · Art: ${sym.artworkName}` : ""}
                            </div>
                          </div>
                        </div>

                        {/* Right: Weight (when enabled) + Reorder + Move to Reel + Duplicate + Remove */}
                        <div className="flex flex-wrap items-center gap-1.5">
                          {config.weightsEnabled ? (
                            <label className="flex items-center gap-1.5 rounded-md border border-white/10 bg-ink-850 px-2 py-1 text-[11px] text-ink-300">
                              <span>Weight</span>
                              <input
                                type="number"
                                min={0.1}
                                step="any"
                                aria-label={`Weight for stop ${stop.position}`}
                                value={
                                  stop.weight !== undefined &&
                                  !Number.isNaN(stop.weight)
                                    ? stop.weight
                                    : ""
                                }
                                onChange={(e) =>
                                  handleWeightChange(
                                    activeReelIndex,
                                    stopIdx,
                                    e.target.value,
                                  )
                                }
                                className={`w-16 rounded border px-1.5 py-0.5 font-mono text-xs focus:outline-none ${
                                  weightInvalid
                                    ? "border-rose-500 bg-rose-950/50 text-rose-200"
                                    : "border-white/10 bg-ink-900 text-ink-100"
                                }`}
                              />
                              {weightShare ? (
                                <span className="font-mono text-[10px] text-ink-400">
                                  ({weightShare})
                                </span>
                              ) : null}
                            </label>
                          ) : null}

                          {/* Up / Down Reorder */}
                          <button
                            type="button"
                            aria-label={`Move stop ${stop.position} up`}
                            title="Move stop up"
                            disabled={stopIdx === 0}
                            onClick={() =>
                              handleReorderStop(
                                activeReelIndex,
                                stopIdx,
                                stopIdx - 1,
                              )
                            }
                            className="focus-ring rounded border border-white/10 bg-ink-850 px-1.5 py-1 text-[11px] text-ink-300 hover:text-ink-100 disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            aria-label={`Move stop ${stop.position} down`}
                            title="Move stop down"
                            disabled={stopIdx === selectedReel.stops.length - 1}
                            onClick={() =>
                              handleReorderStop(
                                activeReelIndex,
                                stopIdx,
                                stopIdx + 1,
                              )
                            }
                            className="focus-ring rounded border border-white/10 bg-ink-850 px-1.5 py-1 text-[11px] text-ink-300 hover:text-ink-100 disabled:opacity-30"
                          >
                            ↓
                          </button>

                          {/* Move stop to another reel selector */}
                          {config.reels.length > 1 ? (
                            <Select
                              aria-label={`Move stop ${stop.position} to another reel`}
                              value=""
                              onChange={(e) => {
                                const targetReelIdx = Number(e.target.value);
                                if (
                                  Number.isInteger(targetReelIdx) &&
                                  targetReelIdx !== activeReelIndex
                                ) {
                                  handleMoveStopToReel(
                                    activeReelIndex,
                                    stopIdx,
                                    targetReelIdx,
                                  );
                                }
                              }}
                              className="h-7 w-28 text-[11px]"
                            >
                              <option value="">Move to…</option>
                              {config.reels.map((r, rIdx) =>
                                rIdx === activeReelIndex ? null : (
                                  <option key={r.id} value={rIdx}>
                                    → {r.name}
                                  </option>
                                ),
                              )}
                            </Select>
                          ) : null}

                          {/* Duplicate stop */}
                          <Button
                            variant="ghost"
                            className="h-7 px-2 text-[11px]"
                            aria-label={`Duplicate stop ${stop.position}`}
                            title="Duplicate this stop"
                            onClick={() =>
                              handleDuplicateStop(activeReelIndex, stopIdx)
                            }
                          >
                            <Icon name="copy" size={12} />
                            Duplicate
                          </Button>

                          {/* Remove stop */}
                          <Button
                            variant="ghost"
                            className="h-7 px-2 text-[11px] text-rose-300 hover:text-rose-200"
                            aria-label={`Remove stop ${stop.position}`}
                            title="Remove this stop"
                            onClick={() =>
                              handleRemoveStop(activeReelIndex, stopIdx)
                            }
                          >
                            <Icon name="trash" size={12} />
                            Remove
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          ) : null}

          {/* MULTI-REEL OVERVIEW & CROSS-REEL DRAG BOARD */}
          {showMultiReelBoard ? (
            <section
              aria-label="All reels overview board"
              className="rounded-xl border border-white/[0.08] bg-ink-900 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-semibold tracking-wider text-ink-200 uppercase">
                    All Reels Strip Board (Cross-Reel Drag &amp; Drop)
                  </h3>
                  <p className="text-[11px] text-ink-400">
                    Drag any stop chip between reel columns to move stops across reels
                    or reorder within a reel.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
                {config.reels.map((reel, rIdx) => (
                  <div
                    key={reel.id}
                    onDragOver={(e) => {
                      if (!dragState) return;
                      e.preventDefault();
                      setDropTargetReel(rIdx);
                    }}
                    onDragLeave={() => {
                      if (dropTargetReel === rIdx) setDropTargetReel(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDropTargetReel(null);
                      if (!dragState) return;
                      handleMoveStopToReel(
                        dragState.fromReelIndex,
                        dragState.fromStopIndex,
                        rIdx,
                      );
                      setDragState(null);
                    }}
                    className={`flex flex-col rounded-lg border p-2.5 transition ${
                      dropTargetReel === rIdx
                        ? "border-sky-400 bg-sky-500/15"
                        : rIdx === activeReelIndex
                          ? "border-accent-500/40 bg-ink-850"
                          : "border-white/[0.07] bg-ink-950/60"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setSelectedReelIndex(rIdx)}
                        className="text-xs font-semibold text-ink-100 hover:text-accent-400"
                      >
                        {reel.name}
                      </button>
                      <span className="font-mono text-[10px] text-ink-400">
                        {reel.stops.length} stops
                      </span>
                    </div>

                    <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                      {reel.stops.map((st, sIdx) => {
                        const sym = symbolById.get(st.symbolId);
                        return (
                          <div
                            key={st.id}
                            draggable
                            onDragStart={() =>
                              setDragState({
                                fromReelIndex: rIdx,
                                fromStopIndex: sIdx,
                                stopId: st.id,
                              })
                            }
                            onDragEnd={() => {
                              setDragState(null);
                              setDropTargetReel(null);
                            }}
                            className="flex cursor-grab items-center justify-between gap-1.5 rounded border border-white/10 bg-ink-900 px-2 py-1 text-[11px]"
                          >
                            <span className="font-mono text-[10px] text-ink-400">
                              #{st.position}
                            </span>
                            <span className="truncate font-mono text-ink-200">
                              {sym ? sym.code : st.symbolId}
                            </span>
                            {config.weightsEnabled ? (
                              <span className="font-mono text-[10px] text-amber-300">
                                w:{st.weight ?? 1}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* TEXT VIEW REPRESENTATION OF REEL STOPS */}
          {showTextView && selectedReel ? (
            <section
              aria-label="Reel stops text view"
              className="rounded-xl border border-white/[0.08] bg-ink-900 p-4"
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-xs font-semibold tracking-wider text-ink-100 uppercase">
                    Text View — {selectedReel.name} Stops
                  </h3>
                  <p className="text-[11px] text-ink-400">
                    Enter whitespace- or comma-separated symbol IDs. All IDs are validated
                    against known project symbols.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    aria-label="Text separator format"
                    value={textSeparator}
                    onChange={(e) => {
                      const nextSep = e.target.value as
                        | "comma"
                        | "newline"
                        | "space";
                      setTextSeparator(nextSep);
                      setTextDraft(formatReelStopsToText(selectedReel, nextSep));
                      setTextDirty(false);
                    }}
                    className="h-7 w-36 text-xs"
                  >
                    <option value="comma">Comma-separated</option>
                    <option value="space">Space-separated</option>
                    <option value="newline">One ID per line</option>
                  </Select>

                  <Button
                    variant="primary"
                    className="h-7 px-3 text-xs"
                    onClick={handleApplyTextView}
                    aria-label="Apply text stops to reel"
                  >
                    Apply to {selectedReel.name}
                  </Button>
                </div>
              </div>

              <TextArea
                aria-label="Reel stops text editor"
                rows={4}
                value={effectiveTextDraft}
                onChange={(e) => {
                  setTextDraft(e.target.value);
                  setTextDirty(true);
                }}
                placeholder="sym-low-1, sym-low-2, sym-mid-1, sym-high-1, sym-wild"
                className="font-mono text-xs"
              />

              {/* Live Text Validation Feedback */}
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-300">
                    Parsed Stops: <strong>{textValidation.tokens.length}</strong>
                  </span>
                  {textValidation.isValid ? (
                    <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                      <Icon name="check" size={12} />
                      All {textValidation.validSymbolIds.length} symbol IDs valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[11px] text-rose-200">
                      <Icon name="alert" size={12} />
                      Unknown symbol IDs:{" "}
                      <code className="font-mono">
                        {textValidation.unknownSymbolIds.join(", ")}
                      </code>
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-ink-400">
                  Known IDs:{" "}
                  <code className="font-mono text-ink-300">
                    {paletteItems
                      .slice(0, 6)
                      .map((s) => s.id)
                      .join(", ")}
                    {paletteItems.length > 6 ? "…" : ""}
                  </code>
                </div>
              </div>
            </section>
          ) : null}
        </main>

        {/* RIGHT COLUMN: SYMBOL PALETTE + VALIDATION INSPECTOR */}
        <aside className="flex min-h-0 flex-col border-t border-white/[0.07] bg-ink-900 lg:border-t-0 lg:border-l">
          {/* SYMBOL PALETTE SECTION */}
          <div className="flex min-h-0 flex-1 flex-col border-b border-white/[0.07] p-4">
            <div className="mb-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wider text-ink-100 uppercase">
                  Symbol Palette ({filteredPalette.length} / {paletteItems.length})
                </h2>
                <span className="text-[11px] text-ink-400">
                  Click to append to{" "}
                  <strong className="text-ink-200">{selectedReel?.name}</strong>
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-ink-400">
                Search by symbol ID, name, or artwork. Clicking a symbol appends a stop;
                clicking again adds another stop.
              </p>
            </div>

            {/* Search Input & Filters */}
            <div className="mb-3 space-y-2">
              <TextInput
                aria-label="Search symbol palette"
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                placeholder="Search by symbol ID, name, or artwork…"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1">
                  {(["all", "high", "mid", "low", "special"] as const).map(
                    (tier) => (
                      <button
                        key={tier}
                        type="button"
                        onClick={() => setPaletteTier(tier)}
                        className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase transition ${
                          paletteTier === tier
                            ? "border-accent-500/50 bg-accent-600/20 text-ink-100"
                            : "border-white/10 bg-ink-850 text-ink-400 hover:text-ink-200"
                        }`}
                      >
                        {tier}
                      </button>
                    ),
                  )}
                </div>

                <Select
                  aria-label="Filter symbol palette by artwork"
                  value={paletteArtwork}
                  onChange={(e) =>
                    setPaletteArtwork(
                      e.target.value as "all" | "linked" | "placeholder",
                    )
                  }
                  className="h-6 w-28 text-[10.5px]"
                >
                  <option value="all">All Artwork</option>
                  <option value="linked">Linked Art</option>
                  <option value="placeholder">Placeholder</option>
                </Select>
              </div>
            </div>

            {/* Symbol Palette List */}
            <div
              className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1"
              role="list"
              aria-label="Symbol palette items"
            >
              {filteredPalette.length === 0 ? (
                <div className="rounded-lg border border-dashed border-white/10 p-6 text-center text-xs text-ink-400">
                  No symbols match &ldquo;{paletteQuery}&rdquo;.
                </div>
              ) : (
                filteredPalette.map((item) => {
                  const countOnReel = activeReelSymbolCounts.get(item.id) ?? 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="listitem"
                      data-palette-symbol-id={item.id}
                      onClick={() => handleSelectSymbolFromPalette(item)}
                      className="focus-ring group flex w-full items-center justify-between gap-2.5 rounded-lg border border-white/[0.07] bg-ink-850 p-2 text-left transition hover:border-accent-500/40 hover:bg-ink-800"
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        {/* Thumbnail */}
                        <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-ink-900">
                          {item.hasArtwork && item.artworkUri ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.artworkUri}
                              alt={item.name}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="text-sm font-semibold text-ink-100">
                              {item.glyph}
                            </span>
                          )}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-xs font-semibold text-ink-100">
                              {item.name}
                            </span>
                            <span
                              className={`rounded border px-1.5 py-0.2 text-[9px] font-semibold uppercase ${
                                TIER_BADGE_STYLE[item.tier]
                              }`}
                            >
                              {item.tier}
                            </span>
                            {item.isWild ? (
                              <span className="rounded bg-amber-500/25 px-1.5 py-px text-[9px] font-bold tracking-wider text-amber-200 uppercase">
                                Wild
                              </span>
                            ) : null}
                            {item.isScatter ? (
                              <span className="rounded bg-emerald-500/25 px-1.5 py-px text-[9px] font-bold tracking-wider text-emerald-200 uppercase">
                                Scat
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-ink-400">
                            <code className="text-ink-300">{item.id}</code>
                            <span>·</span>
                            <span>
                              {item.hasArtwork
                                ? `Art: ${item.artworkName}`
                                : "Placeholder"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {countOnReel > 0 ? (
                          <span
                            className="rounded bg-accent-600/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-accent-300"
                            title={`${countOnReel} stops on ${selectedReel?.name}`}
                          >
                            ×{countOnReel}
                          </span>
                        ) : null}
                        <span className="rounded border border-white/10 bg-ink-900 px-2 py-1 text-[10.5px] font-medium text-ink-200 group-hover:border-accent-500/40 group-hover:text-white">
                          + Stop
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* VALIDATION PANEL (NO RNG OUTCOMES) */}
          <div
            className="max-h-72 shrink-0 overflow-y-auto p-4"
            aria-label="Reel configuration validation"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold tracking-wider text-ink-100 uppercase">
                Validation Checks
              </h3>
              {(validation.duplicateStopIds.length > 0 ||
                validation.corruptedPositionStops.length > 0) && (
                <Button
                  variant="ghost"
                  className="h-6 px-2 text-[10.5px] text-amber-300"
                  onClick={handleRepairCorruption}
                >
                  Repair Stop Corruption
                </Button>
              )}
            </div>

            {/* 5 Documented Validation Check Indicators */}
            <div className="space-y-1.5 text-[11px]">
              {[
                {
                  label: "Unknown symbol IDs",
                  ok: validation.unknownSymbolIds.length === 0,
                  detail:
                    validation.unknownSymbolIds.length === 0
                      ? "All stops reference known symbols"
                      : `Unknown: ${validation.unknownSymbolIds.join(", ")}`,
                },
                {
                  label: "Empty reel check",
                  ok: validation.emptyReelIndices.length === 0,
                  detail:
                    validation.emptyReelIndices.length === 0
                      ? `All ${config.reels.length} reels populated`
                      : `Empty: ${validation.emptyReelIndices
                          .map((i) => `Reel ${i + 1}`)
                          .join(", ")}`,
                },
                {
                  label: "Stop weights check",
                  ok: validation.invalidWeightStops.length === 0,
                  detail:
                    validation.invalidWeightStops.length === 0
                      ? config.weightsEnabled
                        ? "All per-stop weights positive & finite"
                        : "Per-stop weights disabled (valid)"
                      : `${validation.invalidWeightStops.length} invalid weight(s)`,
                },
                {
                  label: "Duplicate stop corruption",
                  ok:
                    validation.duplicateStopIds.length === 0 &&
                    validation.corruptedPositionStops.length === 0,
                  detail:
                    validation.duplicateStopIds.length === 0 &&
                    validation.corruptedPositionStops.length === 0
                      ? "All stop IDs unique & positions sequential"
                      : "Duplicate stop ID or position mismatch detected",
                },
                {
                  label: `Reel count (${MIN_REEL_COUNT}–${MAX_REEL_COUNT})`,
                  ok: !validation.invalidReelCount,
                  detail: !validation.invalidReelCount
                    ? `${config.reels.length} reels configured`
                    : `Invalid reel count (${config.reels.length})`,
                },
              ].map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-ink-850 px-2.5 py-1.5"
                >
                  <span className="font-medium text-ink-200">{row.label}</span>
                  <span
                    className={`truncate font-mono text-[10.5px] ${
                      row.ok ? "text-emerald-300" : "text-rose-300"
                    }`}
                    title={row.detail}
                  >
                    {row.ok ? "PASS" : row.detail}
                  </span>
                </div>
              ))}
            </div>

            {validation.issues.length > 0 ? (
              <ul className="mt-2.5 space-y-1 rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px] text-rose-200">
                {validation.issues.map((issue) => (
                  <li key={issue.id}>• {issue.message}</li>
                ))}
              </ul>
            ) : null}

            <p className="mt-2.5 text-[10px] text-ink-400">
              Structural validation only — RNG outcomes are not calculated here.
            </p>
          </div>
        </aside>
      </div>
      {pendingGridSize ? (
        <GridSizeChangeConfirmModal
          blueprint={applyReelConfigurationToBlueprint(blueprint, config)}
          nextColumns={pendingGridSize.columns}
          nextRows={pendingGridSize.rows}
          onCancel={() => setPendingGridSize(null)}
          onConfirm={(paylineResolution) => {
            const currentBp = applyReelConfigurationToBlueprint(blueprint, config);
            const { blueprint: resizedBp } = changeBlueprintGridSize(currentBp, {
              columns: pendingGridSize.columns,
              rows: pendingGridSize.rows,
              paylineResolution,
            });
            setBlueprint(resizedBp);
            commitConfig(
              reelConfigurationFromBlueprint(resizedBp),
              `Resize grid to ${pendingGridSize.columns}×${pendingGridSize.rows}`,
            );
            setPendingGridSize(null);
          }}
        />
      ) : null}
    </div>
  );
}
