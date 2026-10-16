"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Icon, Toggle } from "@/components/ui";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";
import type { GameBlueprint } from "@/lib/blueprint/types";
import { workspaceApi } from "@/lib/client/workspace-api";
import {
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
} from "@/lib/design/history";
import { clearCrossRouteEditorCache } from "@/lib/editor/EditorProvider";
import { studioToastStore } from "@/lib/notifications/toast-store";
import {
  addPayline,
  applyPaylineConfigurationToBlueprint,
  applyPaylinePreset,
  buildPatternShape,
  clearAllPaylines,
  clearPaylineColumn,
  computePaylinePathGeometry,
  deletePayline,
  duplicatePayline,
  paylineConfigurationFromBlueprint,
  repairMalformedPaylines,
  setAllPaylinesActive,
  setPaylineCell,
  setPaylinePattern,
  togglePaylineActive,
  validatePaylineConfiguration,
  type PaylineConfigurationData,
  type PaylineItemConfig,
  type PaylinePreset,
  type PaylineShapeKind,
} from "@/lib/paylines";
import { projectPersistence } from "@/lib/persistence/project-persistence";
import type { ProjectDetail } from "@/lib/workspace/types";

const PRESET_OPTIONS: Array<{ id: PaylinePreset; label: string }> = [
  { id: "5", label: "5 Lines" },
  { id: "10", label: "10 Lines" },
  { id: "20", label: "20 Lines" },
  { id: "custom", label: "Custom" },
];

const QUICK_SHAPES: Array<{ id: PaylineShapeKind; label: string; hint: string }> = [
  { id: "top", label: "Top Row", hint: "Straight line across top row" },
  { id: "middle", label: "Middle Row", hint: "Straight line across center row" },
  { id: "bottom", label: "Bottom Row", hint: "Straight line across bottom row" },
  { id: "v", label: "V-Shape", hint: "Symmetric V pattern across reels" },
  { id: "inverted_v", label: "Inverted V", hint: "Symmetric caret (^) pattern" },
  { id: "zigzag", label: "Zigzag", hint: "Alternating up/down zigzag" },
  { id: "zigzag_inv", label: "Zigzag Inv", hint: "Inverted alternating zigzag" },
  { id: "diagonal_down", label: "Diagonal ↘", hint: "Top-left to bottom-right sweep" },
  { id: "diagonal_up", label: "Diagonal ↗", hint: "Bottom-left to top-right sweep" },
];

function MiniPaylinePreview({
  payline,
  columns,
  rows,
  invalidCols,
}: {
  payline: PaylineItemConfig;
  columns: number;
  rows: number;
  invalidCols: number[];
}) {
  const width = 88;
  const height = 34;
  const geometry = useMemo(
    () => computePaylinePathGeometry(payline, columns, rows, width, height),
    [payline, columns, rows],
  );
  const invalidSet = useMemo(() => new Set(invalidCols), [invalidCols]);
  const colW = width / Math.max(1, columns);
  const rowH = height / Math.max(1, rows);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-label={`Pattern preview for payline ${payline.index}`}
      className="shrink-0 rounded border border-white/10 bg-ink-950/90"
    >
      {/* Mini grid cells & invalid column highlights */}
      {Array.from({ length: columns }, (_, c) => (
        <g key={`mini-col-${c}`}>
          {invalidSet.has(c) ? (
            <rect
              x={c * colW}
              y={0}
              width={colW}
              height={height}
              fill="rgba(244, 63, 94, 0.28)"
            />
          ) : null}
          {Array.from({ length: rows }, (_, r) => (
            <rect
              key={`mini-cell-${c}-${r}`}
              x={c * colW + 1}
              y={r * rowH + 1}
              width={Math.max(1, colW - 2)}
              height={Math.max(1, rowH - 2)}
              rx={1.5}
              fill="rgba(255,255,255,0.03)"
            />
          ))}
        </g>
      ))}

      {/* Path polyline */}
      {geometry.points.length >= 2 ? (
        <polyline
          fill="none"
          stroke={payline.color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={geometry.polylinePoints}
          opacity={payline.active ? 1 : 0.45}
        />
      ) : null}

      {/* Cell nodes */}
      {geometry.points.map((pt) => (
        <circle
          key={`pt-${pt.columnIndex}`}
          cx={pt.x}
          cy={pt.y}
          r={2.6}
          fill={payline.color}
          opacity={payline.active ? 1 : 0.45}
        />
      ))}
    </svg>
  );
}

export function PaylineEditorWorkspace({ project }: { project: ProjectDetail }) {
  const [blueprint, setBlueprint] = useState<GameBlueprint>(project.blueprint);
  const initialConfig = useMemo(
    () => paylineConfigurationFromBlueprint(project.blueprint),
    [project.blueprint],
  );

  const [history, setHistory] = useState(() => createHistory(initialConfig));
  const config = history.present;

  const [selectedPaylineId, setSelectedPaylineId] = useState<string | null>(
    () => initialConfig.paylines[0]?.id ?? null,
  );
  const [hoveredPaylineId, setHoveredPaylineId] = useState<string | null>(null);
  const [showAllActivePaths, setShowAllActivePaths] = useState<boolean>(false);
  const [filterMode, setFilterMode] = useState<"all" | "active" | "inactive" | "invalid">("all");

  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Keep selectedPaylineId valid when lines are added/deleted/cleared
  const selectedPayline = useMemo(() => {
    if (config.paylines.length === 0) return null;
    if (selectedPaylineId) {
      const found = config.paylines.find((l) => l.id === selectedPaylineId);
      if (found) return found;
    }
    return config.paylines[0] ?? null;
  }, [config.paylines, selectedPaylineId]);

  const validation = useMemo(
    () => validatePaylineConfiguration(config),
    [config],
  );

  const selectedInvalidColumns = useMemo(() => {
    if (!selectedPayline) return new Set<number>();
    return new Set(validation.invalidColumnsByPaylineId[selectedPayline.id] ?? []);
  }, [selectedPayline, validation.invalidColumnsByPaylineId]);

  const commitChange = useCallback(
    (nextConfig: PaylineConfigurationData, label: string) => {
      setHistory((prev) => commitHistory(prev, nextConfig, label));
      setDirty(true);
      setSaveMessage(null);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    const res = undoHistory(history);
    if (!res) return;
    setHistory(res.state);
    setDirty(true);
    studioToastStore.push(`Undo: ${res.label}`, "info");
  }, [history]);

  const handleRedo = useCallback(() => {
    const res = redoHistory(history);
    if (!res) return;
    setHistory(res.state);
    setDirty(true);
    studioToastStore.push(`Redo: ${res.label}`, "info");
  }, [history]);

  const handleSelectPreset = useCallback(
    (preset: PaylinePreset) => {
      const next = applyPaylinePreset(config, preset);
      commitChange(
        next,
        preset === "custom"
          ? "Switch to Custom payline mode"
          : `Apply ${preset} Lines preset`,
      );
      if (next.paylines.length > 0) {
        setSelectedPaylineId(next.paylines[0]!.id);
      }
      studioToastStore.push(
        preset === "custom"
          ? "Switched to Custom payline mode"
          : `Loaded ${preset} Lines preset`,
        "info",
      );
    },
    [commitChange, config],
  );

  const handleAddPayline = useCallback(
    (blank = false) => {
      const next = addPayline(config, {
        blank,
        afterPaylineId: selectedPayline?.id,
      });
      commitChange(next, blank ? "Add blank payline draft" : "Add payline");
      // Select the newly created line
      const prevIds = new Set(config.paylines.map((l) => l.id));
      const added = next.paylines.find((l) => !prevIds.has(l.id)) ?? next.paylines[next.paylines.length - 1];
      if (added) {
        setSelectedPaylineId(added.id);
      }
      studioToastStore.push(
        blank
          ? "Added blank payline — click 1 cell in each reel column"
          : `Added Payline #${next.paylines.length}`,
        "success",
      );
    },
    [commitChange, config, selectedPayline?.id],
  );

  const handleDuplicatePayline = useCallback(
    (paylineId?: string) => {
      const targetId = paylineId ?? selectedPayline?.id;
      if (!targetId) return;
      const next = duplicatePayline(config, targetId, {
        ensureUniquePattern: false,
      });
      commitChange(next, "Duplicate payline");
      const sourceIdx = config.paylines.findIndex((l) => l.id === targetId);
      const duplicated = next.paylines[sourceIdx + 1] ?? next.paylines[next.paylines.length - 1];
      if (duplicated) {
        setSelectedPaylineId(duplicated.id);
      }
      studioToastStore.push("Duplicated payline", "info");
    },
    [commitChange, config, selectedPayline?.id],
  );

  const handleDeletePayline = useCallback(
    (paylineId?: string) => {
      const targetId = paylineId ?? selectedPayline?.id;
      if (!targetId) return;
      const targetIdx = config.paylines.findIndex((l) => l.id === targetId);
      const next = deletePayline(config, targetId);
      commitChange(next, "Delete payline");
      if (next.paylines.length === 0) {
        setSelectedPaylineId(null);
      } else {
        const nextSelected =
          next.paylines[Math.min(targetIdx, next.paylines.length - 1)] ??
          next.paylines[0];
        setSelectedPaylineId(nextSelected?.id ?? null);
      }
      studioToastStore.push("Deleted payline", "info");
    },
    [commitChange, config, selectedPayline?.id],
  );

  const handleClearAll = useCallback(() => {
    const next = clearAllPaylines(config);
    commitChange(next, "Clear all paylines");
    setSelectedPaylineId(null);
    studioToastStore.push("Cleared all paylines", "info");
  }, [commitChange, config]);

  const handleCellClick = useCallback(
    (columnIndex: number, rowIndex: number) => {
      if (!selectedPayline) {
        // If no payline exists yet, create one and set the clicked cell
        const created = addPayline(config);
        const first = created.paylines[0];
        if (!first) return;
        const updated = setPaylineCell(created, first.id, columnIndex, rowIndex);
        commitChange(
          updated,
          `Create Payline #1 and set Reel ${columnIndex + 1} to Row ${rowIndex + 1}`,
        );
        setSelectedPaylineId(first.id);
        return;
      }

      const next = setPaylineCell(
        config,
        selectedPayline.id,
        columnIndex,
        rowIndex,
      );
      commitChange(
        next,
        `Set Payline #${selectedPayline.index} Reel ${columnIndex + 1} → Row ${rowIndex + 1}`,
      );
    },
    [commitChange, config, selectedPayline],
  );

  const handleClearColumn = useCallback(
    (columnIndex: number) => {
      if (!selectedPayline) return;
      const next = clearPaylineColumn(config, selectedPayline.id, columnIndex);
      commitChange(
        next,
        `Clear Reel ${columnIndex + 1} on Payline #${selectedPayline.index}`,
      );
    },
    [commitChange, config, selectedPayline],
  );

  const handleApplyQuickShape = useCallback(
    (shape: PaylineShapeKind) => {
      if (!selectedPayline) return;
      const pattern = buildPatternShape(config.columns, config.rows, shape);
      const next = setPaylinePattern(config, selectedPayline.id, pattern);
      commitChange(
        next,
        `Apply ${shape} pattern to Payline #${selectedPayline.index}`,
      );
    },
    [commitChange, config, selectedPayline],
  );

  const handleToggleActive = useCallback(
    (paylineId: string, nextActive?: boolean) => {
      const next = togglePaylineActive(config, paylineId, nextActive);
      commitChange(next, "Toggle payline active state");
    },
    [commitChange, config],
  );

  const handleRepairMalformed = useCallback(
    (targetPaylineId?: string) => {
      const next = repairMalformedPaylines(config, targetPaylineId);
      commitChange(next, "Repair malformed paylines");
      studioToastStore.push("Repaired malformed payline columns", "success");
    },
    [commitChange, config],
  );

  const handleSave = useCallback(async () => {
    if (!validation.canSave) {
      const firstErr =
        validation.issues.find((i) => i.severity === "error")?.message ??
        "Fix malformed payline columns before saving.";
      setSaveMessage(firstErr);
      studioToastStore.push(firstErr, "error");
      return;
    }

    setSaving(true);
    setSaveMessage(null);
    try {
      const nextBlueprint = applyPaylineConfigurationToBlueprint(blueprint, config);
      setBlueprint(nextBlueprint);

      try {
        await projectPersistence.saveProject(project.id, nextBlueprint);
      } catch {
        // Ignore if not seeded in localStorage yet
      }

      await workspaceApi.updateProject(project.id, {
        blueprint: nextBlueprint,
      });

      clearCrossRouteEditorCache(project.id);
      setDirty(false);
      setSaveMessage("Saved to GameBlueprint.paylineConfiguration");
      studioToastStore.push(
        "Payline configuration saved to GameBlueprint.paylineConfiguration",
        "success",
      );
    } catch (err) {
      clearCrossRouteEditorCache(project.id);
      const msg =
        err instanceof Error ? err.message : "Failed to save payline configuration";
      setSaveMessage(msg);
      studioToastStore.push(msg, "error");
    } finally {
      setSaving(false);
    }
  }, [blueprint, config, project.id, validation]);

  useEffect(() => {
    if (!autosaveEnabled || !dirty || saving || !validation.canSave) return;
    const timer = setTimeout(() => {
      void handleSave();
    }, 900);
    return () => clearTimeout(timer);
  }, [autosaveEnabled, dirty, saving, validation.canSave, handleSave]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
        return;
      }
      if (inInput) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "y"
      ) {
        event.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleSave, handleUndo]);

  const filteredPaylines = useMemo(() => {
    return config.paylines.filter((line) => {
      if (filterMode === "active") return line.active;
      if (filterMode === "inactive") return !line.active;
      if (filterMode === "invalid") {
        return (validation.invalidColumnsByPaylineId[line.id]?.length ?? 0) > 0;
      }
      return true;
    });
  }, [config.paylines, filterMode, validation.invalidColumnsByPaylineId]);

  const gridSvgWidth = 600;
  const gridSvgHeight = 360;

  const selectedPathGeometry = useMemo(() => {
    if (!selectedPayline) return null;
    return computePaylinePathGeometry(
      selectedPayline,
      config.columns,
      config.rows,
      gridSvgWidth,
      gridSvgHeight,
    );
  }, [selectedPayline, config.columns, config.rows]);

  const hoveredPayline = useMemo(() => {
    if (!hoveredPaylineId || hoveredPaylineId === selectedPayline?.id) return null;
    return config.paylines.find((l) => l.id === hoveredPaylineId) ?? null;
  }, [config.paylines, hoveredPaylineId, selectedPayline?.id]);

  const hoveredPathGeometry = useMemo(() => {
    if (!hoveredPayline) return null;
    return computePaylinePathGeometry(
      hoveredPayline,
      config.columns,
      config.rows,
      gridSvgWidth,
      gridSvgHeight,
    );
  }, [hoveredPayline, config.columns, config.rows]);

  const backgroundActiveGeometries = useMemo(() => {
    if (!showAllActivePaths) return [];
    return config.paylines
      .filter((l) => l.active && l.id !== selectedPayline?.id)
      .map((l) =>
        computePaylinePathGeometry(
          l,
          config.columns,
          config.rows,
          gridSvgWidth,
          gridSvgHeight,
        ),
      );
  }, [showAllActivePaths, config.paylines, config.columns, config.rows, selectedPayline?.id]);

  const activeCount = useMemo(
    () => config.paylines.filter((l) => l.active).length,
    [config.paylines],
  );

  // Representative symbols per grid cell (visual context only — no RNG)
  const cellPreviewSymbol = useCallback(
    (colIdx: number, rowIdx: number) => {
      const strip = blueprint.reels.strips[colIdx] ?? [];
      const symId = strip[rowIdx % Math.max(1, strip.length)];
      const sym = blueprint.symbols.find((s) => s.id === symId);
      return sym ?? null;
    },
    [blueprint.reels.strips, blueprint.symbols],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950 text-ink-100">
      <ProjectTopNav projectId={project.id} projectTitle={blueprint.meta.title} />

      {/* Top Studio Bar */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-900/90 px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-semibold tracking-tight text-ink-100">
                Payline Configuration Editor
              </span>
              <Badge tone="accent">F15 · Config Only</Badge>
              <Badge tone="default">
                {config.columns}×{config.rows} Grid
              </Badge>
              <Badge tone="default">
                Active: {activeCount} / {config.paylines.length}
              </Badge>
              <Badge
                tone={
                  validation.canSave
                    ? validation.valid
                      ? "success"
                      : "warning"
                    : "danger"
                }
              >
                {validation.canSave
                  ? validation.valid
                    ? "Valid"
                    : `${validation.issues.length} Warning`
                  : `${validation.issues.filter((i) => i.severity === "error").length} Error`}
              </Badge>
            </div>
            <p className="truncate text-[11px] text-ink-400">
              {blueprint.meta.title} · Rule: 1 cell per reel · No winnings calculation (SECTION 2 Engine)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            disabled={history.past.length === 0}
            onClick={handleUndo}
            title="Undo (⌘Z)"
          >
            <Icon name="undo" size={13} />
            Undo
          </Button>
          <Button
            variant="ghost"
            disabled={history.future.length === 0}
            onClick={handleRedo}
            title="Redo (⌘⇧Z)"
          >
            <Icon name="redo" size={13} />
            Redo
          </Button>

          {!validation.canSave ? (
            <Button
              variant="outline"
              onClick={() => handleRepairMalformed()}
              title="Repair missing or out-of-bounds columns so paylines can be saved"
            >
              <Icon name="sparkles" size={13} />
              Repair Malformed
            </Button>
          ) : null}

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

          <Button
            variant="primary"
            disabled={saving || !validation.canSave}
            onClick={() => void handleSave()}
            title={
              validation.canSave
                ? "Save into GameBlueprint.paylineConfiguration (⌘S)"
                : "Cannot save while malformed paylines exist"
            }
          >
            <Icon name="check" size={13} />
            {saving
              ? "Saving…"
              : !validation.canSave
                ? "Fix Malformed to Save"
                : dirty
                  ? "Save Paylines *"
                  : "Save Paylines"}
          </Button>
        </div>
      </header>

      {/* Preset & Action Toolbar */}
      <div
        aria-label="Payline presets and actions"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-900/60 px-4 py-2"
      >
        {/* Presets: 5 Lines | 10 Lines | 20 Lines | Custom */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[10.5px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
            Presets:
          </span>
          {PRESET_OPTIONS.map((preset) => {
            const isActive = config.preset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                data-testid={`payline-preset-${preset.id}`}
                aria-pressed={isActive}
                onClick={() => handleSelectPreset(preset.id)}
                className={`focus-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition ${
                  isActive
                    ? "border-accent-500/60 bg-accent-600/20 text-ink-100 shadow-sm"
                    : "border-white/10 bg-ink-850 text-ink-300 hover:border-white/20 hover:text-ink-100"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Actions: Add Payline | Duplicate | Delete Payline | Clear All */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            onClick={() => handleAddPayline(false)}
            data-testid="add-payline-btn"
          >
            <Icon name="plus" size={12} />
            Add Payline
          </Button>
          <Button
            variant="ghost"
            onClick={() => handleAddPayline(true)}
            data-testid="add-blank-payline-btn"
            title="Add an empty payline draft with unset columns to click-build from scratch"
          >
            <Icon name="plus" size={12} />
            Add Blank Draft
          </Button>
          <Button
            variant="outline"
            disabled={!selectedPayline}
            onClick={() => handleDuplicatePayline()}
            data-testid="duplicate-payline-btn"
          >
            <Icon name="copy" size={12} />
            Duplicate
          </Button>
          <Button
            variant="danger"
            disabled={!selectedPayline}
            onClick={() => handleDeletePayline()}
            data-testid="delete-payline-btn"
          >
            <Icon name="trash" size={12} />
            Delete Payline
          </Button>
          <Button
            variant="ghost"
            disabled={config.paylines.length === 0}
            onClick={handleClearAll}
            data-testid="clear-all-paylines-btn"
          >
            <Icon name="x" size={12} />
            Clear All
          </Button>
        </div>
      </div>

      {/* Main Workspace: Left Payline List | Center Interactive Grid & Path Preview | Right Validation Inspector */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[320px_minmax(0,1fr)_300px] xl:overflow-hidden">
        {/* Left Column: Payline List */}
        <aside
          aria-label="Payline list"
          className="flex min-h-0 flex-col border-r border-white/[0.07] bg-ink-900/70"
        >
          <div className="border-b border-white/[0.07] p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold tracking-wider text-ink-200 uppercase">
                  Payline List ({filteredPaylines.length}/{config.paylines.length})
                </h2>
                <p className="text-[11px] text-ink-400">
                  Number, deterministic color, pattern preview &amp; active state
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    commitChange(setAllPaylinesActive(config, true), "Enable all paylines")
                  }
                  disabled={config.paylines.length === 0}
                  className="rounded border border-white/10 bg-ink-850 px-1.5 py-0.5 text-[10px] text-ink-300 hover:text-ink-100 disabled:opacity-40"
                >
                  All On
                </button>
                <button
                  type="button"
                  onClick={() =>
                    commitChange(setAllPaylinesActive(config, false), "Disable all paylines")
                  }
                  disabled={config.paylines.length === 0}
                  className="rounded border border-white/10 bg-ink-850 px-1.5 py-0.5 text-[10px] text-ink-300 hover:text-ink-100 disabled:opacity-40"
                >
                  All Off
                </button>
              </div>
            </div>

            <div className="mt-2.5 flex items-center gap-1">
              {(["all", "active", "inactive", "invalid"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setFilterMode(mode)}
                  className={`rounded px-2 py-0.5 text-[10.5px] font-medium capitalize transition ${
                    filterMode === mode
                      ? "bg-accent-600/25 text-ink-100"
                      : "text-ink-400 hover:bg-white/5 hover:text-ink-200"
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
            {filteredPaylines.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-ink-900/40 p-6 text-center">
                <p className="text-xs font-semibold text-ink-200">
                  No paylines in this view
                </p>
                <p className="mt-1 text-[11px] text-ink-400">
                  Click &ldquo;Add Payline&rdquo; or choose a preset (5 / 10 / 20 Lines).
                </p>
              </div>
            ) : (
              filteredPaylines.map((line) => {
                const isSelected = selectedPayline?.id === line.id;
                const invalidCols =
                  validation.invalidColumnsByPaylineId[line.id] ?? [];
                const isMalformed = invalidCols.length > 0;

                return (
                  <div
                    key={line.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    data-testid={`payline-list-item-${line.index}`}
                    onClick={() => setSelectedPaylineId(line.id)}
                    onMouseEnter={() => setHoveredPaylineId(line.id)}
                    onMouseLeave={() => setHoveredPaylineId(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedPaylineId(line.id);
                      }
                    }}
                    className={`group flex cursor-pointer items-center justify-between gap-2.5 rounded-lg border px-2.5 py-2 transition ${
                      isMalformed
                        ? "border-rose-500/60 bg-rose-500/10"
                        : isSelected
                          ? "border-accent-500/60 bg-accent-600/15 shadow-sm"
                          : "border-white/[0.07] bg-ink-850/90 hover:border-white/20 hover:bg-ink-850"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      {/* Deterministic Color & Number Badge */}
                      <span
                        className="inline-flex h-6 min-w-[34px] shrink-0 items-center justify-center rounded font-mono text-[11px] font-bold text-ink-950 shadow-sm"
                        style={{ backgroundColor: line.color }}
                        title={`Payline #${line.index} (${line.color})`}
                      >
                        #{line.index}
                      </span>

                      {/* Pattern Preview SVG */}
                      <MiniPaylinePreview
                        payline={line}
                        columns={config.columns}
                        rows={config.rows}
                        invalidCols={invalidCols}
                      />

                      {/* Coordinates & Status */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-ink-100">
                            Line #{line.index}
                          </span>
                          {isSelected ? (
                            <span className="rounded bg-accent-500/25 px-1 py-px text-[9px] font-semibold text-accent-300 uppercase">
                              Selected
                            </span>
                          ) : null}
                          {isMalformed ? (
                            <span className="rounded bg-rose-500/25 px-1 py-px text-[9px] font-semibold text-rose-200 uppercase">
                              Invalid
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 font-mono text-[10px] text-ink-400">
                          [
                          {line.pattern
                            .map((r) => (r >= 0 && r < config.rows ? r + 1 : "?"))
                            .join(", ")}
                          ]
                        </div>
                      </div>
                    </div>

                    {/* Active / Inactive Toggle + Row Actions */}
                    <div
                      className="flex shrink-0 items-center gap-1.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Toggle
                        label={`Active state for payline ${line.index}`}
                        checked={line.active}
                        onChange={(checked) => handleToggleActive(line.id, checked)}
                      />
                      <button
                        type="button"
                        onClick={() => handleDuplicatePayline(line.id)}
                        title={`Duplicate Payline #${line.index}`}
                        className="rounded border border-white/10 bg-ink-900 p-1 text-ink-400 opacity-80 transition hover:border-white/25 hover:text-ink-100"
                      >
                        <Icon name="copy" size={11} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeletePayline(line.id)}
                        title={`Delete Payline #${line.index}`}
                        className="rounded border border-rose-500/20 bg-rose-500/10 p-1 text-rose-300 opacity-80 transition hover:border-rose-500/40 hover:bg-rose-500/20"
                      >
                        <Icon name="trash" size={11} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Center Column: Interactive Reel/Row Grid & Path Preview */}
        <main className="flex min-h-0 flex-col overflow-y-auto p-5">
          {/* Active Payline Header */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-ink-900/80 px-4 py-3">
            {selectedPayline ? (
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="inline-flex h-8 min-w-[44px] items-center justify-center rounded-md px-2 font-mono text-xs font-bold text-ink-950 shadow"
                  style={{ backgroundColor: selectedPayline.color }}
                >
                  #{selectedPayline.index}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-ink-100">
                      Editing Payline #{selectedPayline.index}
                    </h2>
                    <span
                      className="font-mono text-[11px]"
                      style={{ color: selectedPayline.color }}
                    >
                      {selectedPayline.color}
                    </span>
                    <Badge tone={selectedPayline.active ? "success" : "muted"}>
                      {selectedPayline.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-ink-400">
                    Click any cell in a reel column to set that reel&apos;s stop row (exactly 1 cell per reel).
                  </p>
                </div>
              </div>
            ) : (
              <div>
                <h2 className="text-sm font-semibold text-ink-100">
                  No Payline Selected
                </h2>
                <p className="text-[11px] text-ink-400">
                  Click any cell on the grid below or click &ldquo;Add Payline&rdquo; to begin.
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <Toggle
                label="Overlay all active paylines"
                checked={showAllActivePaths}
                onChange={setShowAllActivePaths}
              />
            </div>
          </div>

          {/* Quick Shape Generators for Zigzag / V / Diagonal / Straight Patterns */}
          <div className="mb-4 rounded-xl border border-white/[0.07] bg-ink-900/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10.5px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
                Quick Pattern Shapes (Apply to Selected Payline &amp; Customize Any Cell)
              </span>
              {selectedPayline ? (
                <span className="font-mono text-[11px] text-ink-300">
                  Row Pattern: [
                  {selectedPayline.pattern
                    .map((r) => (r >= 0 && r < config.rows ? `R${r + 1}` : "—"))
                    .join(" → ")}
                  ]
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SHAPES.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  disabled={!selectedPayline}
                  title={shape.hint}
                  data-testid={`quick-shape-${shape.id}`}
                  onClick={() => handleApplyQuickShape(shape.id)}
                  className="focus-ring rounded-md border border-white/10 bg-ink-850 px-2.5 py-1 text-xs text-ink-200 transition hover:border-accent-500/40 hover:bg-accent-600/15 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {shape.label}
                </button>
              ))}
            </div>
          </div>

          {/* Interactive Reel/Row Grid + Path SVG Preview */}
          <div className="rounded-xl border border-white/[0.08] bg-ink-900/90 p-4 shadow-lg">
            {/* Column Headers (Reel 1 .. Reel C) with Invalid Column Highlighting */}
            <div
              className="mb-2 grid gap-2.5"
              style={{
                gridTemplateColumns: `repeat(${config.columns}, minmax(0, 1fr))`,
              }}
            >
              {Array.from({ length: config.columns }, (_, colIdx) => {
                const isColInvalid = selectedInvalidColumns.has(colIdx);
                const selectedRow = selectedPayline?.pattern[colIdx];
                return (
                  <div
                    key={`col-header-${colIdx}`}
                    data-testid={`payline-column-header-${colIdx}`}
                    data-column-invalid={isColInvalid ? "true" : "false"}
                    className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs ${
                      isColInvalid
                        ? "border-rose-500/80 bg-rose-500/20 text-rose-100"
                        : "border-white/[0.08] bg-ink-850 text-ink-200"
                    }`}
                  >
                    <div>
                      <div className="font-semibold">Reel {colIdx + 1}</div>
                      <div className="font-mono text-[10px] opacity-80">
                        {isColInvalid
                          ? "INVALID · Pick 1 cell"
                          : selectedRow !== undefined && selectedRow >= 0
                            ? `Row ${selectedRow + 1} (idx ${selectedRow})`
                            : "Unset"}
                      </div>
                    </div>
                    {selectedPayline ? (
                      <button
                        type="button"
                        onClick={() => handleClearColumn(colIdx)}
                        title={`Unset Reel ${colIdx + 1} cell to test or clear column`}
                        data-testid={`clear-column-${colIdx}`}
                        className="rounded border border-white/10 bg-ink-900/80 px-1.5 py-0.5 text-[10px] text-ink-400 transition hover:border-rose-400/40 hover:text-rose-200"
                      >
                        Unset
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {/* Grid Container with Overlaid SVG Path Preview */}
            <div className="relative">
              {/* SVG Path Overlay */}
              <svg
                data-testid="payline-path-preview"
                viewBox={`0 0 ${gridSvgWidth} ${gridSvgHeight}`}
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 z-10 h-full w-full"
              >
                {/* All active paylines background overlay when enabled */}
                {backgroundActiveGeometries.map((geo) =>
                  geo.points.length >= 2 ? (
                    <polyline
                      key={`bg-geo-${geo.paylineId}`}
                      fill="none"
                      stroke={geo.color}
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={geo.polylinePoints}
                      opacity={0.28}
                    />
                  ) : null,
                )}

                {/* Hovered payline preview */}
                {hoveredPathGeometry && hoveredPathGeometry.points.length >= 2 ? (
                  <polyline
                    fill="none"
                    stroke={hoveredPathGeometry.color}
                    strokeWidth={3.5}
                    strokeDasharray="6 4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={hoveredPathGeometry.polylinePoints}
                    opacity={0.65}
                  />
                ) : null}

                {/* Selected payline path glow + crisp line + nodes */}
                {selectedPathGeometry && selectedPathGeometry.points.length >= 2 ? (
                  <g>
                    <polyline
                      fill="none"
                      stroke={selectedPathGeometry.color}
                      strokeWidth={10}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={selectedPathGeometry.polylinePoints}
                      opacity={0.22}
                    />
                    <polyline
                      fill="none"
                      stroke={selectedPathGeometry.color}
                      strokeWidth={4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={selectedPathGeometry.polylinePoints}
                    />
                  </g>
                ) : null}

                {selectedPathGeometry?.points.map((pt) => (
                  <g key={`node-${pt.columnIndex}`}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={9}
                      fill="#090d16"
                      stroke={selectedPathGeometry.color}
                      strokeWidth={3}
                    />
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={4}
                      fill={selectedPathGeometry.color}
                    />
                  </g>
                ))}
              </svg>

              {/* Clickable Reel × Row Grid */}
              <div
                role="grid"
                aria-label="Payline reel and row grid"
                className="grid gap-2.5"
                style={{
                  gridTemplateColumns: `repeat(${config.columns}, minmax(0, 1fr))`,
                }}
              >
                {Array.from({ length: config.columns }, (_, colIdx) => {
                  const isColInvalid = selectedInvalidColumns.has(colIdx);
                  return (
                    <div
                      key={`col-cells-${colIdx}`}
                      data-testid={`payline-grid-column-${colIdx}`}
                      data-column-invalid={isColInvalid ? "true" : "false"}
                      className={`flex flex-col gap-2.5 rounded-xl p-1.5 transition ${
                        isColInvalid
                          ? "bg-rose-500/15 ring-2 ring-rose-500/80"
                          : "bg-ink-950/50"
                      }`}
                    >
                      {Array.from({ length: config.rows }, (_, rowIdx) => {
                        const isSelectedCell =
                          selectedPayline?.pattern[colIdx] === rowIdx;
                        const sym = cellPreviewSymbol(colIdx, rowIdx);

                        // Other active lines passing through this cell
                        const otherLinesAtCell = showAllActivePaths
                          ? config.paylines.filter(
                              (l) =>
                                l.active &&
                                l.id !== selectedPayline?.id &&
                                l.pattern[colIdx] === rowIdx,
                            )
                          : [];

                        return (
                          <button
                            key={`cell-${colIdx}-${rowIdx}`}
                            type="button"
                            data-testid={`payline-grid-cell-${colIdx}-${rowIdx}`}
                            aria-pressed={isSelectedCell}
                            aria-label={`Reel ${colIdx + 1}, Row ${rowIdx + 1}${isSelectedCell ? " (Selected on active payline)" : ""}`}
                            onClick={() => handleCellClick(colIdx, rowIdx)}
                            style={
                              isSelectedCell && selectedPayline
                                ? {
                                    borderColor: selectedPayline.color,
                                    boxShadow: `0 0 0 1px ${selectedPayline.color}, 0 0 22px -4px ${selectedPayline.color}66`,
                                  }
                                : undefined
                            }
                            className={`focus-ring relative flex h-24 flex-col justify-between rounded-lg border p-2.5 text-left transition ${
                              isSelectedCell
                                ? "bg-ink-850 text-ink-100"
                                : isColInvalid
                                  ? "border-rose-500/40 bg-ink-900/90 text-ink-300 hover:border-rose-400 hover:bg-ink-850"
                                  : "border-white/[0.08] bg-ink-900/90 text-ink-300 hover:border-white/25 hover:bg-ink-850"
                            }`}
                          >
                            <div className="flex w-full items-center justify-between gap-1">
                              <span className="font-mono text-[10px] text-ink-400">
                                R{colIdx + 1}·Row {rowIdx + 1}
                              </span>
                              {isSelectedCell && selectedPayline ? (
                                <span
                                  className="rounded px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-ink-950"
                                  style={{ backgroundColor: selectedPayline.color }}
                                >
                                  #{selectedPayline.index}
                                </span>
                              ) : null}
                            </div>

                            {/* Subtle background symbol glyph for studio context */}
                            <div className="flex items-center justify-center opacity-35">
                              <span className="text-lg">
                                {sym?.glyph ?? "◆"}
                              </span>
                            </div>

                            <div className="flex w-full items-center justify-between gap-1">
                              <span className="text-[10px] text-ink-400">
                                {isSelectedCell
                                  ? "Selected Stop"
                                  : "Click to select"}
                              </span>
                              {otherLinesAtCell.length > 0 ? (
                                <div className="flex items-center gap-0.5">
                                  {otherLinesAtCell.slice(0, 5).map((ol) => (
                                    <span
                                      key={ol.id}
                                      className="h-2 w-2 rounded-full"
                                      style={{ backgroundColor: ol.color }}
                                      title={`Line #${ol.index}`}
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </main>

        {/* Right Column: Validation & Blueprint Inspector */}
        <aside
          aria-label="Payline validation and blueprint inspector"
          className="flex min-h-0 flex-col border-l border-white/[0.07] bg-ink-900/70 p-4"
        >
          <div className="space-y-4 overflow-y-auto">
            {/* Structural Validation Section */}
            <div className="rounded-xl border border-white/[0.08] bg-ink-850 p-3.5">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-wider text-ink-200 uppercase">
                  Payline Validation
                </h2>
                <Badge
                  tone={
                    validation.canSave
                      ? validation.valid
                        ? "success"
                        : "warning"
                      : "danger"
                  }
                >
                  {validation.canSave ? "Save Ready" : "Save Blocked"}
                </Badge>
              </div>
              <p className="mt-1 text-[11px] text-ink-400">
                Prevents saving malformed paylines and highlights invalid reel columns.
              </p>

              <ul className="mt-3 space-y-2 text-xs">
                <li className="flex items-center justify-between rounded-md border border-white/[0.06] bg-ink-900 px-2.5 py-1.5">
                  <span className="text-ink-200">1 Cell Per Reel Rule</span>
                  <Badge
                    tone={validation.checks.oneCellPerReelValid ? "success" : "danger"}
                  >
                    {validation.checks.oneCellPerReelValid ? "PASS" : "FAIL"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between rounded-md border border-white/[0.06] bg-ink-900 px-2.5 py-1.5">
                  <span className="text-ink-200">
                    Row Bounds (1..{config.rows})
                  </span>
                  <Badge
                    tone={validation.checks.rowBoundsValid ? "success" : "danger"}
                  >
                    {validation.checks.rowBoundsValid ? "PASS" : "FAIL"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between rounded-md border border-white/[0.06] bg-ink-900 px-2.5 py-1.5">
                  <span className="text-ink-200">Distinct Line Patterns</span>
                  <Badge
                    tone={validation.checks.uniquePatternsValid ? "success" : "danger"}
                  >
                    {validation.checks.uniquePatternsValid ? "PASS" : "FAIL"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between rounded-md border border-white/[0.06] bg-ink-900 px-2.5 py-1.5">
                  <span className="text-ink-200">Grid Dimensions</span>
                  <Badge
                    tone={validation.checks.gridDimensionsValid ? "success" : "danger"}
                  >
                    {validation.checks.gridDimensionsValid ? "PASS" : "FAIL"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between rounded-md border border-white/[0.06] bg-ink-900 px-2.5 py-1.5">
                  <span className="text-ink-200">Paylines Defined</span>
                  <Badge
                    tone={validation.checks.paylinesDefined ? "success" : "warning"}
                  >
                    {validation.checks.paylinesDefined ? "PASS" : "EMPTY"}
                  </Badge>
                </li>
              </ul>

              {validation.issues.length > 0 ? (
                <div className="mt-3 space-y-1.5">
                  <div className="text-[10.5px] font-semibold tracking-wider text-rose-300 uppercase">
                    Detected Issues ({validation.issues.length})
                  </div>
                  {validation.issues.map((issue) => (
                    <div
                      key={issue.id}
                      data-testid="payline-validation-issue"
                      className={`rounded-md border p-2 text-[11px] ${
                        issue.severity === "error"
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                          : "border-amber-500/40 bg-amber-500/10 text-amber-200"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span>{issue.message}</span>
                        {issue.paylineId ? (
                          <button
                            type="button"
                            onClick={() => setSelectedPaylineId(issue.paylineId!)}
                            className="shrink-0 rounded border border-white/15 bg-ink-900 px-1.5 py-0.5 text-[10px] font-semibold text-ink-100 hover:border-white/30"
                          >
                            Focus
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-[11px] text-emerald-200">
                  All {config.paylines.length} paylines have 1 valid cell per reel and unique patterns.
                </div>
              )}
            </div>

            {/* Blueprint Target Summary */}
            <div className="rounded-xl border border-white/[0.08] bg-ink-850 p-3.5">
              <h3 className="text-xs font-semibold tracking-wider text-ink-200 uppercase">
                Blueprint Persistence
              </h3>
              <p className="mt-1 text-[11px] text-ink-400">
                Saves into <code className="text-ink-200">GameBlueprint.paylineConfiguration</code> and synchronizes <code className="text-ink-200">GameBlueprint.paylines</code>.
              </p>

              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-ink-400">Preset Mode</span>
                  <span className="font-mono text-ink-100 uppercase">
                    {config.preset === "custom" ? "Custom" : `${config.preset} Lines`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-400">Total Paylines</span>
                  <span className="font-mono text-ink-100">
                    {config.paylines.length}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-400">Active Paylines</span>
                  <span className="font-mono text-ink-100">{activeCount}</span>
                </div>
              </div>

              {saveMessage ? (
                <div
                  data-testid="payline-save-message"
                  className={`mt-3 rounded-md border px-2.5 py-1.5 text-[11px] ${
                    validation.canSave
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                      : "border-rose-500/40 bg-rose-500/10 text-rose-200"
                  }`}
                >
                  {saveMessage}
                </div>
              ) : null}
            </div>

            {/* Section 1 Scope Notice */}
            <div className="rounded-xl border border-white/[0.06] bg-ink-900/80 p-3 text-[11px] leading-relaxed text-ink-400">
              <strong className="text-ink-200">Configuration Only:</strong> The F15 Payline Editor defines geometric line paths across reels. It does not calculate winnings, symbol payouts, or RNG outcomes.
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
