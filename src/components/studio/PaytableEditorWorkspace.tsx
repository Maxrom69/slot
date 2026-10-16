"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge, Button, Icon, Thumbnail, Toggle } from "@/components/ui";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";
import type { GameBlueprint, SymbolTier } from "@/lib/blueprint/types";
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
  applyPaytableConfigurationToBlueprint,
  countModifiedPaytableCells,
  getModifiedMatchCountsForRow,
  isPayoutCellModified,
  isPaytableRowModified,
  paytableConfigurationFromBlueprint,
  resetAllPaytableToDefaults,
  resetPaytableRowToDefaults,
  setPaytableCellPayout,
  setSymbolFamily,
  syncPaytableWithReels,
  toggleSymbolBonus,
  toggleSymbolScatter,
  toggleSymbolWild,
  validatePaytableConfiguration,
  type PaytableConfigurationData,
  type PaytableSymbolRowConfig,
} from "@/lib/paytable";
import { projectPersistence } from "@/lib/persistence/project-persistence";
import type { ProjectDetail } from "@/lib/workspace/types";

type RowFilter = "all" | SymbolTier | "wild" | "modified";

const TIER_TONE: Record<SymbolTier, "accent" | "default" | "warning" | "muted"> = {
  high: "accent",
  mid: "default",
  low: "muted",
  special: "warning",
};

const TIER_LABEL: Record<SymbolTier, string> = {
  high: "High",
  mid: "Mid",
  low: "Low",
  special: "Special",
};

export function PaytableEditorWorkspace({
  project,
}: {
  project: ProjectDetail;
}) {
  const [blueprint, setBlueprint] = useState<GameBlueprint>(project.blueprint);
  const initialConfig = useMemo(
    () => paytableConfigurationFromBlueprint(project.blueprint),
    [project.blueprint],
  );

  const [history, setHistory] = useState(() => createHistory(initialConfig));
  const config = history.present;

  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(
    () => initialConfig.symbolRows[0]?.symbolId ?? null,
  );
  const [filter, setFilter] = useState<RowFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const validation = useMemo(
    () => validatePaytableConfiguration(config),
    [config],
  );

  const overrideSummary = useMemo(
    () => countModifiedPaytableCells(config),
    [config],
  );

  const wildSymbols = useMemo(
    () => config.symbolRows.filter((r) => r.isWild),
    [config.symbolRows],
  );

  const scatterSymbols = useMemo(
    () => config.symbolRows.filter((r) => r.isScatter),
    [config.symbolRows],
  );

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return config.symbolRows.filter((row) => {
      if (filter === "wild" && !row.isWild) return false;
      if (
        filter === "modified" &&
        !isPaytableRowModified(row, config.matchCounts)
      ) {
        return false;
      }
      if (
        (filter === "high" ||
          filter === "mid" ||
          filter === "low" ||
          filter === "special") &&
        row.tier !== filter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        row.name.toLowerCase().includes(q) ||
        row.code.toLowerCase().includes(q) ||
        row.family.toLowerCase().includes(q) ||
        row.symbolId.toLowerCase().includes(q)
      );
    });
  }, [config.symbolRows, config.matchCounts, filter, searchQuery]);

  const selectedRow: PaytableSymbolRowConfig | null = useMemo(
    () =>
      config.symbolRows.find((r) => r.symbolId === selectedSymbolId) ??
      config.symbolRows[0] ??
      null,
    [config.symbolRows, selectedSymbolId],
  );

  const commitConfig = useCallback(
    (next: PaytableConfigurationData, label = "Edit paytable configuration") => {
      setHistory((prev) => commitHistory(prev, next, label));
      setDirty(true);
      setSaveMessage(null);
    },
    [],
  );

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      const undone = undoHistory(prev);
      return undone ? undone.state : prev;
    });
    setDirty(true);
    setSaveMessage(null);
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((prev) => {
      const redone = redoHistory(prev);
      return redone ? redone.state : prev;
    });
    setDirty(true);
    setSaveMessage(null);
  }, []);

  const handleCellChange = useCallback(
    (symbolId: string, matchCount: number, rawValue: string) => {
      const next = setPaytableCellPayout(
        config,
        symbolId,
        matchCount,
        rawValue,
      );
      commitConfig(next, `Edit ${symbolId} ${matchCount}-of-a-kind payout`);
    },
    [config, commitConfig],
  );

  const handleResetRow = useCallback(
    (symbolId: string, symbolName: string) => {
      const next = resetPaytableRowToDefaults(config, symbolId);
      commitConfig(next, `Reset ${symbolName} payouts to defaults`);
      studioToastStore.push(
        `Restored ${symbolName} payouts and role flags to configured defaults`,
        "info",
      );
    },
    [config, commitConfig],
  );

  const handleResetAll = useCallback(() => {
    const next = resetAllPaytableToDefaults(config);
    commitConfig(next, "Reset all paytable values to defaults");
    studioToastStore.push(
      "Restored all paytable rows to configured defaults",
      "info",
    );
  }, [config, commitConfig]);

  const handleToggleWild = useCallback(
    (symbolId: string, symbolName: string, nextVal: boolean) => {
      const next = toggleSymbolWild(config, symbolId, nextVal);
      commitConfig(
        next,
        `${nextVal ? "Enable" : "Disable"} Wild on ${symbolName}`,
      );
    },
    [config, commitConfig],
  );

  const handleToggleScatter = useCallback(
    (symbolId: string, symbolName: string, nextVal: boolean) => {
      const next = toggleSymbolScatter(config, symbolId, nextVal);
      commitConfig(
        next,
        `${nextVal ? "Enable" : "Disable"} Scatter on ${symbolName}`,
      );
    },
    [config, commitConfig],
  );

  const handleToggleBonus = useCallback(
    (symbolId: string, symbolName: string, nextVal: boolean) => {
      const next = toggleSymbolBonus(config, symbolId, nextVal);
      commitConfig(
        next,
        `${nextVal ? "Enable" : "Disable"} Bonus on ${symbolName}`,
      );
    },
    [config, commitConfig],
  );

  const handleFamilyChange = useCallback(
    (symbolId: string, family: string) => {
      const next = setSymbolFamily(config, symbolId, family);
      commitConfig(next, `Update symbol family for ${symbolId}`);
    },
    [config, commitConfig],
  );

  const handleMinMatchChange = useCallback(
    (nextMin: number) => {
      const next = syncPaytableWithReels(
        config,
        config.columns,
        config.rows,
        config.evaluation,
        nextMin,
      );
      commitConfig(next, `Set minimum match count to ${nextMin}`);
    },
    [config, commitConfig],
  );

  const handlePreviewReelCount = useCallback(
    (nextCols: number) => {
      const next = syncPaytableWithReels(
        config,
        nextCols,
        config.rows,
        config.evaluation,
        config.minMatchCount,
      );
      commitConfig(
        next,
        `Sync match counts with ${nextCols}×${config.rows} grid`,
      );
    },
    [config, commitConfig],
  );

  const handleSave = useCallback(async () => {
    const check = validatePaytableConfiguration(config);
    if (!check.canSave) {
      const firstErr =
        check.issues.find((i) => i.severity === "error")?.message ??
        "Cannot save invalid paytable.";
      setSaveMessage(`Validation blocked save: ${firstErr}`);
      studioToastStore.push(firstErr, "error");
      return;
    }

    setSaving(true);
    setSaveMessage(null);

    try {
      const nextBlueprint = applyPaytableConfigurationToBlueprint(
        blueprint,
        config,
      );
      setBlueprint(nextBlueprint);

      try {
        await projectPersistence.saveProject(project.id, nextBlueprint);
      } catch {
        // Ignore if local storage is unavailable
      }

      try {
        const updated = await workspaceApi.updateProject(project.id, {
          blueprint: nextBlueprint,
        });
        setBlueprint(updated.blueprint);
        clearCrossRouteEditorCache(project.id);
        setDirty(false);
        setSaveMessage(
          "Saved to GameBlueprint.paytableConfiguration, paytable & symbols",
        );
        studioToastStore.push(
          "Paytable configuration saved to GameBlueprint",
          "success",
        );
      } catch (err) {
        clearCrossRouteEditorCache(project.id);
        setDirty(false);
        const detail =
          err instanceof Error
            ? err.message
            : "Saved locally to GameBlueprint.paytableConfiguration";
        setSaveMessage(`Saved locally (${detail})`);
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Failed to save paytable";
      setSaveMessage(msg);
      studioToastStore.push(msg, "error");
    } finally {
      setSaving(false);
    }
  }, [blueprint, config, project.id]);

  useEffect(() => {
    if (!autosaveEnabled || !dirty || saving || !validation.canSave) return;
    const timer = setTimeout(() => {
      void handleSave();
    }, 900);
    return () => clearTimeout(timer);
  }, [autosaveEnabled, dirty, saving, validation.canSave, handleSave]);

  // Keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl/Cmd+S)
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
          if (canRedo) handleRedo();
        } else if (canUndo) {
          handleUndo();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canUndo, canRedo, handleUndo, handleRedo, handleSave]);

  return (
    <div
      data-testid="paytable-editor-workspace"
      className="flex h-screen flex-col overflow-hidden bg-ink-950 text-ink-100"
    >
      <ProjectTopNav projectId={project.id} projectTitle={project.title} />

      {/* Top Header */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] bg-ink-900/90 px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-sm font-semibold tracking-tight text-ink-100">
                Paytable Configuration Editor
              </h1>
              <Badge tone="accent">F16 · Math Config UI</Badge>
              <Badge tone="default">
                {config.columns}×{config.rows} Grid
              </Badge>
              <Badge tone="default">
                Match Counts: {config.matchCounts.join(", ")}
              </Badge>
              {overrideSummary.modifiedCells > 0 ? (
                <Badge tone="warning">
                  {overrideSummary.modifiedCells} Modified{" "}
                  {overrideSummary.modifiedCells === 1 ? "Value" : "Values"}
                </Badge>
              ) : (
                <Badge tone="success">All Defaults</Badge>
              )}
              {!validation.canSave ? (
                <Badge tone="danger">
                  {validation.issues.length} Validation{" "}
                  {validation.issues.length === 1 ? "Error" : "Errors"}
                </Badge>
              ) : null}
            </div>
            <p className="truncate text-[11px] text-ink-400">
              {project.title} · Declarative symbol payout matrix &amp; Wild role
              configuration (no RTP, hit-rate, or spin simulation executed here)
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            disabled={!canUndo}
            onClick={handleUndo}
            title="Undo (⌘Z)"
          >
            <Icon name="undo" size={13} />
            Undo
          </Button>
          <Button
            variant="ghost"
            disabled={!canRedo}
            onClick={handleRedo}
            title="Redo (⌘⇧Z)"
          >
            <Icon name="redo" size={13} />
            Redo
          </Button>
          <Button
            variant="outline"
            disabled={overrideSummary.modifiedRows === 0}
            onClick={handleResetAll}
            title="Restore all symbol rows and payout cells to configured defaults"
          >
            <Icon name="refresh-ccw" size={13} />
            Reset All
          </Button>
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
            disabled={!validation.canSave || saving}
            onClick={() => void handleSave()}
            title={
              validation.canSave
                ? "Save paytable configuration into GameBlueprint (⌘S)"
                : "Resolve validation errors before saving"
            }
          >
            <Icon name="check" size={13} />
            {saving
              ? "Saving…"
              : dirty
                ? "Save Paytable*"
                : "Save Paytable"}
          </Button>
        </div>
      </header>

      {/* Secondary Controls Bar: Filters, Search, Match Count Derivation & Wild Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-900/50 px-4 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "all", label: `All (${config.symbolRows.length})` },
              {
                id: "high",
                label: `High (${config.symbolRows.filter((r) => r.tier === "high").length})`,
              },
              {
                id: "mid",
                label: `Mid (${config.symbolRows.filter((r) => r.tier === "mid").length})`,
              },
              {
                id: "low",
                label: `Low (${config.symbolRows.filter((r) => r.tier === "low").length})`,
              },
              {
                id: "special",
                label: `Special (${config.symbolRows.filter((r) => r.tier === "special").length})`,
              },
              { id: "wild", label: `Wild (${wildSymbols.length})` },
              {
                id: "modified",
                label: `Modified (${overrideSummary.modifiedRows})`,
              },
            ] as Array<{ id: RowFilter; label: string }>
          ).map((tab) => {
            const activeTab = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`focus-ring rounded-md border px-2.5 py-1 text-xs font-medium transition ${
                  activeTab
                    ? "border-accent-500 bg-accent-600/20 text-ink-100"
                    : "border-white/10 bg-ink-850 text-ink-300 hover:border-white/20 hover:text-ink-100"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-ink-300">
            <span className="font-semibold tracking-wider text-ink-400 uppercase">
              Min Match:
            </span>
            {[2, 3].map((minVal) => (
              <button
                key={minVal}
                type="button"
                onClick={() => handleMinMatchChange(minVal)}
                className={`focus-ring rounded border px-2 py-0.5 font-mono text-[11px] transition ${
                  config.minMatchCount === minVal
                    ? "border-accent-500 bg-accent-600/20 text-ink-100"
                    : "border-white/10 bg-ink-850 text-ink-400 hover:text-ink-200"
                }`}
              >
                {minVal}+ ({minVal}..{config.columns})
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5 border-l border-white/10 pl-2.5 text-[11px] text-ink-300">
            <span className="font-semibold tracking-wider text-ink-400 uppercase">
              Grid Reels:
            </span>
            {[3, 4, 5, 6].map((colCount) => (
              <button
                key={colCount}
                type="button"
                onClick={() => handlePreviewReelCount(colCount)}
                title={`Derive match count columns for a ${colCount}-reel configuration`}
                className={`focus-ring rounded border px-2 py-0.5 font-mono text-[11px] transition ${
                  config.columns === colCount
                    ? "border-accent-500 bg-accent-600/20 text-ink-100"
                    : "border-white/10 bg-ink-850 text-ink-400 hover:text-ink-200"
                }`}
              >
                {colCount}R
              </button>
            ))}
          </div>

          <input
            type="search"
            aria-label="Search paytable symbols"
            placeholder="Filter symbol, code, family…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="focus-ring h-7 w-48 rounded-md border border-white/10 bg-ink-950 px-2.5 text-xs text-ink-100 placeholder:text-ink-400"
          />
        </div>
      </div>

      {/* Save / Status Banner */}
      {saveMessage ? (
        <div
          className={`flex items-center justify-between border-b px-4 py-1.5 text-xs ${
            validation.canSave
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-rose-500/40 bg-rose-500/15 text-rose-200"
          }`}
        >
          <span>{saveMessage}</span>
          <button
            type="button"
            onClick={() => setSaveMessage(null)}
            className="text-[11px] underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Main 2-Pane Workspace: Paytable Matrix + Right Inspector */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_350px] lg:overflow-hidden">
        {/* Left/Center: Paytable Matrix Table */}
        <main className="flex flex-col overflow-auto p-5">
          {/* Wild & Role Summary Bar */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-ink-900/80 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold tracking-wider text-ink-300 uppercase">
                Active Wild Symbols ({wildSymbols.length}):
              </span>
              {wildSymbols.length === 0 ? (
                <span className="text-xs text-ink-400">
                  None enabled — toggle Wild on any symbol row below
                </span>
              ) : (
                wildSymbols.map((w) => (
                  <span
                    key={w.symbolId}
                    className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-200"
                  >
                    <span>{w.glyph}</span>
                    <span>{w.name}</span>
                    <span className="font-mono text-[10px] opacity-80">
                      ({w.code})
                    </span>
                  </span>
                ))
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-300">
              <span>
                Scatter:{" "}
                <strong className="text-emerald-300">
                  {scatterSymbols.map((s) => s.code).join(", ") || "None"}
                </strong>
              </span>
              <span>·</span>
              <span>
                Match Columns:{" "}
                <strong className="font-mono text-ink-100">
                  [{config.matchCounts.join(", ")}]
                </strong>{" "}
                (derived from {config.columns} reels)
              </span>
            </div>
          </div>

          {/* Paytable Matrix Table */}
          <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-ink-900/90 shadow-2xl">
            <table
              aria-label="Paytable configuration matrix"
              className="w-full border-collapse text-left text-xs"
            >
              <thead>
                <tr className="border-b border-white/[0.08] bg-ink-950/80 text-[10.5px] font-semibold tracking-wider text-ink-300 uppercase">
                  <th className="px-3.5 py-3">Symbol</th>
                  <th className="px-3 py-3">Tier</th>
                  <th className="px-3 py-3">Family</th>
                  <th className="px-3 py-3">Wild &amp; Role Flags</th>
                  {config.matchCounts.map((mc) => (
                    <th
                      key={mc}
                      className="min-w-[112px] border-l border-white/[0.06] px-3 py-3 text-center font-mono"
                    >
                      <div className="text-xs font-bold text-ink-100">
                        {mc}
                      </div>
                      <div className="text-[9.5px] font-normal text-ink-400">
                        {mc} of a kind
                      </div>
                    </th>
                  ))}
                  <th className="border-l border-white/[0.06] px-3.5 py-3 text-right">
                    Row Overrides
                  </th>
                </tr>
              </thead>

              <tbody className="divide-y divide-white/[0.06]">
                {filteredRows.map((row) => {
                  const isSelected = selectedRow?.symbolId === row.symbolId;
                  const modifiedCounts = getModifiedMatchCountsForRow(
                    row,
                    config.matchCounts,
                  );
                  const rowModified = isPaytableRowModified(
                    row,
                    config.matchCounts,
                  );
                  const invalidCells =
                    validation.invalidCellsBySymbolId[row.symbolId] ?? [];

                  return (
                    <tr
                      key={row.symbolId}
                      data-testid={`paytable-row-${row.symbolId}`}
                      onClick={() => setSelectedSymbolId(row.symbolId)}
                      className={`transition ${
                        isSelected
                          ? "bg-accent-600/[0.09]"
                          : "hover:bg-white/[0.02]"
                      }`}
                    >
                      {/* Symbol Thumbnail + Name + Code */}
                      <td className="px-3.5 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="relative shrink-0">
                            <Thumbnail
                              src={row.thumbnailUri}
                              alt={row.name}
                              glyph={row.glyph}
                              checkerboard
                            />
                            {row.isWild ? (
                              <span
                                title="Wild symbol"
                                className="absolute -top-1 -right-1 rounded bg-amber-500 px-1 py-px text-[8px] font-bold tracking-wider text-ink-950 uppercase shadow"
                              >
                                W
                              </span>
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-semibold text-ink-100">
                                {row.name}
                              </span>
                              <span className="rounded bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-ink-300">
                                {row.code}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] text-ink-400">
                              <span>{row.symbolId}</span>
                              <Link
                                href={`/projects/${project.id}/symbols/${row.symbolId}`}
                                onClick={(e) => e.stopPropagation()}
                                className="text-accent-400 hover:underline"
                              >
                                Edit symbol →
                              </Link>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Tier */}
                      <td className="px-3 py-2.5">
                        <Badge tone={TIER_TONE[row.tier]}>
                          {TIER_LABEL[row.tier]}
                        </Badge>
                      </td>

                      {/* Family */}
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center rounded-md border border-white/10 bg-ink-850 px-2 py-1 text-[11px] text-ink-200">
                          {row.family}
                        </span>
                      </td>

                      {/* Wild Toggle + Scatter / Bonus Role Flags */}
                      <td
                        className="px-3 py-2.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Toggle
                            label="Wild"
                            checked={row.isWild}
                            onChange={(nextVal) =>
                              handleToggleWild(
                                row.symbolId,
                                row.name,
                                nextVal,
                              )
                            }
                          />
                          <button
                            type="button"
                            aria-pressed={row.isScatter}
                            aria-label={`Toggle Scatter for ${row.name}`}
                            onClick={() =>
                              handleToggleScatter(
                                row.symbolId,
                                row.name,
                                !row.isScatter,
                              )
                            }
                            className={`focus-ring rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition ${
                              row.isScatter
                                ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
                                : "border-white/10 bg-ink-950/60 text-ink-400 hover:text-ink-200"
                            }`}
                          >
                            {row.isScatter ? "★ Scatter" : "Scatter"}
                          </button>
                          {row.isBonus || row.tier === "special" ? (
                            <button
                              type="button"
                              aria-pressed={row.isBonus}
                              aria-label={`Toggle Bonus for ${row.name}`}
                              onClick={() =>
                                handleToggleBonus(
                                  row.symbolId,
                                  row.name,
                                  !row.isBonus,
                                )
                              }
                              className={`focus-ring rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase transition ${
                                row.isBonus
                                  ? "border-fuchsia-400/50 bg-fuchsia-500/20 text-fuchsia-200"
                                  : "border-white/10 bg-ink-950/60 text-ink-400 hover:text-ink-200"
                              }`}
                            >
                              {row.isBonus ? "✦ Bonus" : "Bonus"}
                            </button>
                          ) : null}
                        </div>
                      </td>

                      {/* Editable Payout Cells per Match Count */}
                      {config.matchCounts.map((mc) => {
                        const key = String(mc);
                        const rawOverride = row.rawInputs?.[key];
                        const currentVal = row.payouts[key] ?? 0;
                        const defaultVal = row.defaultPayouts[key] ?? 0;
                        const displayVal =
                          rawOverride !== undefined
                            ? rawOverride
                            : Number.isNaN(currentVal)
                              ? "NaN"
                              : String(currentVal);
                        const isModified = isPayoutCellModified(row, mc);
                        const isInvalid = invalidCells.includes(mc);
                        const cellIssue =
                          validation.cellIssueMap[`${row.symbolId}:${mc}`];

                        return (
                          <td
                            key={mc}
                            className={`border-l border-white/[0.06] px-2.5 py-2 align-top ${
                              isInvalid
                                ? "bg-rose-500/15"
                                : isModified
                                  ? "bg-amber-500/[0.08]"
                                  : ""
                            }`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="relative flex flex-col gap-1">
                              <div className="relative flex items-center">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  aria-label={`${row.name} ${mc}-of-a-kind payout`}
                                  data-testid={`payout-input-${row.symbolId}-${mc}`}
                                  value={displayVal}
                                  onFocus={() =>
                                    setSelectedSymbolId(row.symbolId)
                                  }
                                  onChange={(e) =>
                                    handleCellChange(
                                      row.symbolId,
                                      mc,
                                      e.target.value,
                                    )
                                  }
                                  className={`focus-ring h-8 w-full rounded-md border px-2 pr-6 text-right font-mono text-xs font-semibold transition ${
                                    isInvalid
                                      ? "border-rose-400 bg-rose-950/60 text-rose-100"
                                      : isModified
                                        ? "border-amber-400/70 bg-amber-950/30 text-amber-100"
                                        : "border-white/10 bg-ink-950 text-ink-100 hover:border-white/25"
                                  }`}
                                />
                                <span className="pointer-events-none absolute right-2 font-mono text-[10px] text-ink-400">
                                  x
                                </span>
                              </div>

                              <div className="flex items-center justify-between text-[9.5px]">
                                <span className="font-mono text-ink-400">
                                  def: {defaultVal}x
                                </span>
                                {isInvalid ? (
                                  <span
                                    title={cellIssue?.message}
                                    className="rounded bg-rose-500/30 px-1 py-px font-mono font-bold text-rose-200 uppercase"
                                  >
                                    ERR
                                  </span>
                                ) : isModified ? (
                                  <span
                                    data-testid={`modified-indicator-${row.symbolId}-${mc}`}
                                    title={`Modified from default (${defaultVal}x → ${displayVal}x)`}
                                    className="rounded bg-amber-500/25 px-1 py-px font-mono font-bold text-amber-300 uppercase"
                                  >
                                    MOD
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                        );
                      })}

                      {/* Row Reset Action */}
                      <td
                        className="border-l border-white/[0.06] px-3.5 py-2.5 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-end gap-2">
                          {rowModified ? (
                            <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-200">
                              {modifiedCounts.length > 0
                                ? `${modifiedCounts.length} cell${modifiedCounts.length === 1 ? "" : "s"}`
                                : "role"}
                            </span>
                          ) : (
                            <span className="text-[10.5px] text-ink-400">
                              Default
                            </span>
                          )}
                          <Button
                            variant="outline"
                            disabled={!rowModified}
                            onClick={() =>
                              handleResetRow(row.symbolId, row.name)
                            }
                            title={`Restore ${row.name} payouts and role flags to configured defaults`}
                          >
                            <Icon name="refresh-ccw" size={12} />
                            Reset Row
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredRows.length === 0 ? (
              <div className="p-8 text-center text-xs text-ink-400">
                No symbols match the current filter or search query.
              </div>
            ) : null}
          </div>
        </main>

        {/* Right Panel: Selected Symbol Inspector, Validation & Blueprint Status */}
        <aside className="flex flex-col border-t border-white/[0.08] bg-ink-900/90 lg:border-t-0 lg:border-l">
          <div className="border-b border-white/[0.08] px-4 py-3">
            <h2 className="text-xs font-semibold tracking-wider text-ink-200 uppercase">
              Symbol &amp; Validation Inspector
            </h2>
            <p className="mt-0.5 text-[11px] text-ink-400">
              Overrides, Wild role status, and structural validation
            </p>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {/* Selected Symbol Detail */}
            {selectedRow ? (
              <section className="rounded-lg border border-white/[0.07] bg-ink-850 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <Thumbnail
                      src={selectedRow.thumbnailUri}
                      alt={selectedRow.name}
                      glyph={selectedRow.glyph}
                      checkerboard
                    />
                    <div>
                      <div className="text-xs font-semibold text-ink-100">
                        {selectedRow.name}{" "}
                        <span className="font-mono text-ink-400">
                          ({selectedRow.code})
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <Badge tone={TIER_TONE[selectedRow.tier]}>
                          {TIER_LABEL[selectedRow.tier]}
                        </Badge>
                        {selectedRow.isWild ? (
                          <Badge tone="warning">WILD</Badge>
                        ) : null}
                        {selectedRow.isScatter ? (
                          <Badge tone="success">SCATTER</Badge>
                        ) : null}
                        {selectedRow.isBonus ? (
                          <Badge tone="accent">BONUS</Badge>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 space-y-2 border-t border-white/[0.06] pt-3 text-xs">
                  <label className="block">
                    <span className="mb-1 block text-[10.5px] text-ink-400">
                      Symbol Family
                    </span>
                    <input
                      type="text"
                      aria-label="Selected symbol family"
                      value={selectedRow.family}
                      onChange={(e) =>
                        handleFamilyChange(selectedRow.symbolId, e.target.value)
                      }
                      className="focus-ring h-7 w-full rounded border border-white/10 bg-ink-950 px-2 text-xs text-ink-100"
                    />
                  </label>

                  <div className="space-y-1.5 pt-1">
                    <Toggle
                      label="Wild Status (substitutes in SECTION 2)"
                      checked={selectedRow.isWild}
                      onChange={(v) =>
                        handleToggleWild(
                          selectedRow.symbolId,
                          selectedRow.name,
                          v,
                        )
                      }
                    />
                    <Toggle
                      label="Scatter Status"
                      checked={selectedRow.isScatter}
                      onChange={(v) =>
                        handleToggleScatter(
                          selectedRow.symbolId,
                          selectedRow.name,
                          v,
                        )
                      }
                    />
                    <Toggle
                      label="Bonus Status"
                      checked={selectedRow.isBonus}
                      onChange={(v) =>
                        handleToggleBonus(
                          selectedRow.symbolId,
                          selectedRow.name,
                          v,
                        )
                      }
                    />
                  </div>

                  <div className="pt-2">
                    <Button
                      variant="outline"
                      disabled={
                        !isPaytableRowModified(selectedRow, config.matchCounts)
                      }
                      onClick={() =>
                        handleResetRow(selectedRow.symbolId, selectedRow.name)
                      }
                      className="w-full justify-center"
                    >
                      <Icon name="refresh-ccw" size={12} />
                      Reset {selectedRow.name} to Defaults
                    </Button>
                  </div>
                </div>
              </section>
            ) : null}

            {/* Validation Status */}
            <section className="rounded-lg border border-white/[0.07] bg-ink-850 p-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-[11px] font-semibold tracking-wider text-ink-300 uppercase">
                  Structural Validation
                </h3>
                <Badge tone={validation.canSave ? "success" : "danger"}>
                  {validation.canSave ? "Ready to Save" : "Save Blocked"}
                </Badge>
              </div>

              <ul className="space-y-1.5 text-[11px]">
                <li className="flex items-center justify-between">
                  <span className="text-ink-300">
                    Match counts valid ({config.minMatchCount}..{config.columns})
                  </span>
                  <Badge
                    tone={
                      validation.checks.matchCountsValid ? "success" : "danger"
                    }
                  >
                    {validation.checks.matchCountsValid ? "PASS" : "FAIL"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-ink-300">No negative payouts</span>
                  <Badge
                    tone={
                      validation.checks.noNegativePayouts ? "success" : "danger"
                    }
                  >
                    {validation.checks.noNegativePayouts ? "PASS" : "FAIL"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-ink-300">
                    Valid numeric values (no NaN)
                  </span>
                  <Badge
                    tone={
                      validation.checks.noNaNOrInvalidNumeric
                        ? "success"
                        : "danger"
                    }
                  >
                    {validation.checks.noNaNOrInvalidNumeric ? "PASS" : "FAIL"}
                  </Badge>
                </li>
                <li className="flex items-center justify-between">
                  <span className="text-ink-300">Symbol roster consistent</span>
                  <Badge
                    tone={
                      validation.checks.symbolsConsistent ? "success" : "danger"
                    }
                  >
                    {validation.checks.symbolsConsistent ? "PASS" : "FAIL"}
                  </Badge>
                </li>
              </ul>

              {validation.issues.length > 0 ? (
                <div className="mt-3 space-y-1.5 border-t border-white/[0.07] pt-2.5">
                  <div className="text-[10.5px] font-semibold text-rose-300">
                    Issues Preventing Save ({validation.issues.length}):
                  </div>
                  <ul className="max-h-44 space-y-1.5 overflow-y-auto pr-1 text-[11px]">
                    {validation.issues.map((issue) => (
                      <li
                        key={issue.id}
                        className="flex items-start justify-between gap-2 rounded border border-rose-500/30 bg-rose-500/10 p-2 text-rose-200"
                      >
                        <span>{issue.message}</span>
                        {issue.symbolId ? (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedSymbolId(issue.symbolId ?? null)
                            }
                            className="shrink-0 rounded border border-rose-400/40 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-rose-500/20"
                          >
                            Focus
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            {/* Future Math Compatibility & Section 1 Boundary Notice */}
            <section className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3.5 text-[11px] leading-relaxed text-amber-100">
              <div className="font-semibold tracking-wider text-amber-200 uppercase">
                Future Math Compatibility (SECTION 1 Boundary)
              </div>
              <p className="mt-1 text-amber-100/90">
                Paytable values and Wild/Scatter role flags are stored as
                structured declarative configuration in{" "}
                <code className="font-mono">
                  GameBlueprint.paytableConfiguration
                </code>
                , <code className="font-mono">GameBlueprint.paytable</code>, and{" "}
                <code className="font-mono">GameBlueprint.symbols</code>. RTP
                calculation, hit-rate calculation, and Monte Carlo simulation
                are intentionally not performed here and belong to{" "}
                <strong>SECTION 2 — Backend Slot Game Engine</strong>.
              </p>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
