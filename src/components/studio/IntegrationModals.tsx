"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { GameBlueprint } from "@/lib/blueprint/types";
import {
  analyzeDeleteElementDependencies,
  analyzeDeleteSymbolDependencies,
  analyzeGridSizeChangeDependencies,
  importAndMigrateBlueprint,
  verifyBlueprintFlowReadiness,
  type BlueprintImportResult,
  type ElementDeleteDependencyReport,
  type GridPaylineResolutionMode,
  type GridSizeDependencyReport,
  type IntegrationFlowStageId,
  type SymbolDeleteDependencyReport,
} from "@/lib/integration";
import { Badge, Button } from "@/components/ui";

/* -------------------------------------------------------------------------- */
/* 1. 14-Stage Integration Flow Readiness Bar                                 */
/* -------------------------------------------------------------------------- */

export function IntegrationFlowBar({
  blueprint,
  activeStage,
  compact = false,
}: {
  blueprint: GameBlueprint;
  activeStage?: IntegrationFlowStageId;
  compact?: boolean;
}) {
  const report = useMemo(() => verifyBlueprintFlowReadiness(blueprint), [blueprint]);

  return (
    <section
      aria-label="Studio Integration Flow"
      data-testid="integration-flow-bar"
      className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]/90 p-3"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--fg-muted)]">
            Blueprint Integration Pipeline (14 Stages)
          </span>
          <Badge tone={report.allReady ? "success" : "warning"}>
            {report.readyCount}/{report.totalCount} Ready
          </Badge>
        </div>
        <span className="text-[11px] text-[var(--fg-muted)]">
          Single Source of Truth: <strong className="text-[var(--fg-primary)]">{blueprint.meta.title}</strong> ({blueprint.reels.columns}×{blueprint.reels.rows} · {blueprint.symbols.length} symbols · {blueprint.paylines.length} lines)
        </span>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {report.stages.map((stage, idx) => {
          const isCurrent = activeStage === stage.id;
          const dotColor =
            stage.status === "ready"
              ? "bg-emerald-400"
              : stage.status === "warning"
                ? "bg-amber-400"
                : "bg-rose-400";

          return (
            <div key={stage.id} className="flex shrink-0 items-center gap-1">
              <Link
                href={stage.href}
                data-testid={`flow-stage-${stage.id}`}
                title={`${stage.label}: ${stage.detail}`}
                className={`group flex flex-col rounded-lg border px-2.5 py-1.5 transition ${
                  isCurrent
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--fg-primary)]"
                    : "border-[var(--border)] bg-[var(--bg-panel)]/70 text-[var(--fg-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--fg-primary)]"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
                  <span className="text-[11px] font-semibold whitespace-nowrap">
                    {stage.label}
                  </span>
                </div>
                {!compact && (
                  <span className="mt-0.5 text-[10px] font-mono text-[var(--fg-muted)] whitespace-nowrap">
                    {stage.summary}
                  </span>
                )}
              </Link>
              {idx < report.stages.length - 1 && (
                <span className="text-[10px] text-[var(--fg-subtle)] select-none">→</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Delete Symbol Dependency Warning Modal                                  */
/* -------------------------------------------------------------------------- */

export function SymbolDeleteConfirmModal({
  blueprint,
  symbolId,
  onCancel,
  onConfirm,
}: {
  blueprint: GameBlueprint;
  symbolId: string;
  onCancel: () => void;
  onConfirm: (replacementSymbolId?: string) => void;
}) {
  const report: SymbolDeleteDependencyReport = useMemo(
    () => analyzeDeleteSymbolDependencies(blueprint, symbolId),
    [blueprint, symbolId],
  );

  const candidateReplacements = useMemo(
    () => blueprint.symbols.filter((s) => s.id !== symbolId),
    [blueprint.symbols, symbolId],
  );

  const [replacementId, setReplacementId] = useState<string>(
    candidateReplacements[0]?.id ?? "",
  );

  if (!report.exists) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Delete symbol ${report.symbolName}`}
      data-testid="delete-symbol-dependency-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone={report.hasWarnings ? "warning" : "muted"}>
                Dependency Check
              </Badge>
              <h3 className="text-base font-semibold text-[var(--fg-primary)]">
                Delete Symbol “{report.symbolName}” ({report.symbolCode})?
              </h3>
            </div>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              Deleting this symbol updates the central GameBlueprint across Symbol Sets, Reels, Paytable, Paylines, Features, and Canvas Scenes.
            </p>
          </div>
        </div>

        <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
          {/* 1. Reel references */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                1. Reel Strip References
              </span>
              <Badge tone={report.reelReferences.length > 0 ? "warning" : "success"}>
                {report.reelReferences.length > 0
                  ? `${report.reelReferences.length} reel(s) affected`
                  : "No reel references"}
              </Badge>
            </div>
            {report.reelReferences.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-[var(--fg-secondary)]">
                {report.reelReferences.map((r) => (
                  <li key={r.reelId} className="flex items-center justify-between">
                    <span>{r.reelName}</span>
                    <span className="font-mono text-[11px] text-amber-300">
                      {r.stopCount}/{r.totalStopsInReel} stops
                      {r.leavesReelEmpty ? " (leaves reel empty!)" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 2. Paytable references */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                2. Paytable Entries
              </span>
              <Badge tone={report.paytableReferences.length > 0 ? "warning" : "success"}>
                {report.paytableReferences.length > 0
                  ? `${report.paytableReferences.length} payout tier(s)`
                  : "No paytable entries"}
              </Badge>
            </div>
            {report.paytableReferences.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {report.paytableReferences.map((pt) => (
                  <span
                    key={pt.ofAKind}
                    className="rounded border border-[var(--border)] bg-[var(--bg-panel)] px-2 py-0.5 font-mono text-[11px] text-[var(--fg-secondary)]"
                  >
                    {pt.ofAKind}× = {pt.payout}x
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 3. Payline-related configuration */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                3. Payline-Related Configuration
              </span>
              <Badge tone={report.paylineReferences.length > 0 ? "warning" : "success"}>
                {report.paylineReferences.length > 0
                  ? `${report.paylineReferences.length} warning(s)`
                  : "Compatible"}
              </Badge>
            </div>
            {report.paylineReferences.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
                {report.paylineReferences.map((pl) => (
                  <li key={pl.id}>• {pl.detail}</li>
                ))}
              </ul>
            )}
          </div>

          {/* 4. Feature configuration */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                4. Feature Configuration
              </span>
              <Badge tone={report.featureReferences.length > 0 ? "warning" : "success"}>
                {report.featureReferences.length > 0
                  ? `${report.featureReferences.length} feature(s) affected`
                  : "No feature conflicts"}
              </Badge>
            </div>
            {report.featureReferences.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
                {report.featureReferences.map((feat) => (
                  <li key={feat.featureId}>• {feat.reason}</li>
                ))}
              </ul>
            )}
          </div>

          {/* Replacement selector when referenced on reels */}
          {report.reelReferences.length > 0 && candidateReplacements.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] p-3">
              <label className="block text-xs font-semibold text-[var(--fg-primary)]">
                Reel Stop Replacement Policy
              </label>
              <p className="mt-0.5 text-[11px] text-[var(--fg-muted)]">
                Choose how reel stops referencing “{report.symbolName}” should be updated:
              </p>
              <select
                aria-label="Replacement symbol"
                value={replacementId}
                onChange={(e) => setReplacementId(e.target.value)}
                className="mt-2 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-xs text-[var(--fg-primary)]"
              >
                <option value="">Remove stops from reels (auto-fallback if empty)</option>
                {candidateReplacements.map((sym) => (
                  <option key={sym.id} value={sym.id}>
                    Replace stops with {sym.name} ({sym.code})
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            data-testid="confirm-delete-symbol-btn"
            onClick={() => onConfirm(replacementId || undefined)}
          >
            Delete Symbol & Reconcile Blueprint
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 3. Delete Element Dependency Warning Modal                                 */
/* -------------------------------------------------------------------------- */

export function ElementDeleteConfirmModal({
  blueprint,
  elementId,
  onCancel,
  onConfirm,
}: {
  blueprint: GameBlueprint;
  elementId: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const report: ElementDeleteDependencyReport = useMemo(
    () => analyzeDeleteElementDependencies(blueprint, elementId),
    [blueprint, elementId],
  );

  if (!report.exists) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Delete element ${report.elementName}`}
      data-testid="delete-element-dependency-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-5 shadow-2xl">
        <div className="border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2">
            <Badge tone={report.hasWarnings ? "warning" : "muted"}>
              Element Dependency Check
            </Badge>
            <h3 className="text-base font-semibold text-[var(--fg-primary)]">
              Delete Element “{report.elementName}” ({report.elementType})?
            </h3>
          </div>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            Checks references across Scene Layers, Symbol Sets, Animations, and Asset References.
          </p>
        </div>

        <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
          {/* 1. Scene Layers */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                1. Scene Layer Usage
              </span>
              <Badge tone={report.sceneLayerReferences.length > 0 ? "warning" : "success"}>
                {report.sceneLayerReferences.length} reference(s)
              </Badge>
            </div>
            {report.sceneLayerReferences.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
                {report.sceneLayerReferences.map((s, idx) => (
                  <li key={`${s.sceneId}-${s.objectId ?? idx}`}>• {s.detail}</li>
                ))}
              </ul>
            )}
          </div>

          {/* 2. Symbol Sets */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                2. Symbol Set Usage
              </span>
              <Badge tone={report.symbolSetReferences.length > 0 ? "warning" : "success"}>
                {report.symbolSetReferences.length} reference(s)
              </Badge>
            </div>
            {report.symbolSetReferences.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
                {report.symbolSetReferences.map((s) => (
                  <li key={s.setId}>• {s.detail}</li>
                ))}
              </ul>
            )}
          </div>

          {/* 3. Animations */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                3. Animation Bindings
              </span>
              <Badge tone={report.animationReferences.length > 0 ? "warning" : "success"}>
                {report.animationReferences.length} reference(s)
              </Badge>
            </div>
            {report.animationReferences.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
                {report.animationReferences.map((a) => (
                  <li key={a.animationId}>• {a.detail}</li>
                ))}
              </ul>
            )}
          </div>

          {/* 4. Asset References */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                4. Asset References
              </span>
              <Badge tone={report.assetReferences.length > 0 ? "warning" : "success"}>
                {report.assetReferences.length} asset(s)
              </Badge>
            </div>
            {report.assetReferences.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-[var(--fg-secondary)]">
                {report.assetReferences.map((a) => (
                  <li key={a.assetId}>• {a.detail}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            data-testid="confirm-delete-element-btn"
            onClick={onConfirm}
          >
            Delete Element
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Change Grid Size Dependency Warning Modal                               */
/* -------------------------------------------------------------------------- */

export function GridSizeChangeConfirmModal({
  blueprint,
  nextColumns,
  nextRows,
  onCancel,
  onConfirm,
}: {
  blueprint: GameBlueprint;
  nextColumns: number;
  nextRows: number;
  onCancel: () => void;
  onConfirm: (paylineResolution: GridPaylineResolutionMode) => void;
}) {
  const report: GridSizeDependencyReport = useMemo(
    () => analyzeGridSizeChangeDependencies(blueprint, nextColumns, nextRows),
    [blueprint, nextColumns, nextRows],
  );

  const [resolution, setResolution] = useState<GridPaylineResolutionMode>("adapt");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Change Grid Size to ${nextColumns}x${nextRows}`}
      data-testid="change-grid-dependency-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-xl rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-5 shadow-2xl">
        <div className="border-b border-[var(--border)] pb-3">
          <div className="flex items-center gap-2">
            <Badge tone={report.hasWarnings ? "warning" : "accent"}>
              Grid Size Impact Check
            </Badge>
            <h3 className="text-base font-semibold text-[var(--fg-primary)]">
              Resize Grid: {report.previousColumns}×{report.previousRows} → {report.nextColumns}×{report.nextRows}
            </h3>
          </div>
          <p className="mt-1 text-xs text-[var(--fg-muted)]">
            Changing grid dimensions affects Payline Patterns, Reel Strips, Paytable Of-A-Kind Tiers, and Scene Reel Zone Layouts.
          </p>
        </div>

        <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
          {/* Incompatible Paylines */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                Incompatible Paylines
              </span>
              <Badge tone={report.incompatiblePaylines.length > 0 ? "warning" : "success"}>
                {report.incompatiblePaylines.length} payline(s)
              </Badge>
            </div>
            {report.incompatiblePaylines.length > 0 ? (
              <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto text-xs text-amber-200/90">
                {report.incompatiblePaylines.slice(0, 8).map((pl) => (
                  <li key={pl.paylineId}>
                    • <strong>{pl.paylineName}</strong>: {pl.detail}
                  </li>
                ))}
                {report.incompatiblePaylines.length > 8 && (
                  <li className="text-[11px] text-[var(--fg-muted)]">
                    …and {report.incompatiblePaylines.length - 8} more payline(s).
                  </li>
                )}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                All existing paylines fit within the target grid dimensions.
              </p>
            )}
          </div>

          {/* Scene & Layout Warnings */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--fg-primary)]">
                Scene & Layout Structures
              </span>
              <Badge tone={report.sceneLayoutWarnings.length > 0 ? "warning" : "success"}>
                {report.sceneLayoutWarnings.length} layout notice(s)
              </Badge>
            </div>
            {report.sceneLayoutWarnings.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-amber-200/90">
                {report.sceneLayoutWarnings.map((sw, idx) => (
                  <li key={`${sw.sceneId}-${idx}`}>• {sw.detail}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-xs text-[var(--fg-muted)]">
                No incompatible scene reel-zone containers detected.
              </p>
            )}
          </div>

          {/* Ways & Strip Summary */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs text-[var(--fg-secondary)]">
            <div className="flex items-center justify-between">
              <span>Way Evaluation Capacity:</span>
              <span className="font-mono">
                {report.waysSummary.previousWays.toLocaleString()} →{" "}
                <strong className="text-[var(--fg-primary)]">
                  {report.waysSummary.nextWays.toLocaleString()} ways
                </strong>
              </span>
            </div>
            {report.addedColumnsCount > 0 && (
              <p className="mt-1 text-[11px] text-[var(--fg-muted)]">
                +{report.addedColumnsCount} new reel strip(s) will be seeded automatically.
              </p>
            )}
            {report.truncatedColumnsCount > 0 && (
              <p className="mt-1 text-[11px] text-amber-300">
                {report.truncatedColumnsCount} trailing reel column(s) will be removed from active evaluation.
              </p>
            )}
          </div>

          {/* Resolution policy */}
          {report.incompatiblePaylines.length > 0 && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] p-3">
              <label className="block text-xs font-semibold text-[var(--fg-primary)]">
                Payline Compatibility Resolution
              </label>
              <select
                aria-label="Payline compatibility resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value as GridPaylineResolutionMode)}
                className="mt-2 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg-elevated)] px-2.5 text-xs text-[var(--fg-primary)]"
              >
                <option value="adapt">
                  Adapt existing paylines (resize length to {nextColumns} & clamp rows to 0..{nextRows - 1})
                </option>
                <option value="regenerate_standard">
                  Regenerate standard geometric paylines for {nextColumns}×{nextRows}
                </option>
                <option value="disable_incompatible">
                  Adapt patterns & mark previously incompatible paylines inactive
                </option>
              </select>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            data-testid="confirm-grid-change-btn"
            onClick={() => onConfirm(resolution)}
          >
            Apply {nextColumns}×{nextRows} Grid Across Blueprint
          </Button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* 5. Blueprint Import & Schema Migration Modal                               */
/* -------------------------------------------------------------------------- */

export function BlueprintImportModal({
  onClose,
  onImportSuccess,
}: {
  onClose: () => void;
  onImportSuccess: (blueprint: GameBlueprint, result: BlueprintImportResult) => void;
}) {
  const [rawJson, setRawJson] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewResult = useMemo<BlueprintImportResult | null>(() => {
    if (!rawJson.trim()) return null;
    return importAndMigrateBlueprint(rawJson);
  }, [rawJson]);

  const handleFileUpload = async (file: File) => {
    const text = await file.text();
    setRawJson(text);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import Game Blueprint"
      data-testid="blueprint-import-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-2xl rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge tone="accent">Blueprint Import</Badge>
              <h3 className="text-base font-semibold text-[var(--fg-primary)]">
                Import & Migrate GameBlueprint JSON
              </h3>
            </div>
            <p className="mt-1 text-xs text-[var(--fg-muted)]">
              Validates schema integrity, automatically migrates older blueprint formats (v0 → v1), and reconciles all cross-editor slices.
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFileUpload(f);
            }}
          />
          <Button
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose JSON File…
          </Button>
        </div>

        <div className="mt-4 space-y-3">
          <textarea
            aria-label="Blueprint JSON input"
            data-testid="blueprint-import-textarea"
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            placeholder='Paste GameBlueprint JSON, Project Archive JSON, or legacy v0 blueprint JSON here...'
            rows={8}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-canvas)] p-3 font-mono text-xs text-[var(--fg-primary)] focus:border-[var(--accent)] focus:outline-none"
          />

          {previewResult && (
            <div
              data-testid="blueprint-import-preview"
              className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Badge tone={previewResult.ok ? "success" : "danger"}>
                    {previewResult.ok ? "Schema Valid" : "Validation Failed"}
                  </Badge>
                  {previewResult.migrated && (
                    <Badge tone="warning">
                      Migrated v{previewResult.sourceVersion ?? 0} → v{previewResult.targetVersion}
                    </Badge>
                  )}
                </div>
                {previewResult.blueprint && (
                  <span className="font-mono text-[11px] text-[var(--fg-secondary)]">
                    “{previewResult.blueprint.meta.title}” · {previewResult.blueprint.reels.columns}×{previewResult.blueprint.reels.rows} · {previewResult.blueprint.symbols.length} symbols
                  </span>
                )}
              </div>

              {previewResult.migrationLog.length > 0 && (
                <div className="mt-2 border-t border-[var(--border)] pt-2">
                  <div className="text-[11px] font-semibold text-amber-300">
                    Migration Steps Applied ({previewResult.migrationLog.length}):
                  </div>
                  <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto text-[11px] text-[var(--fg-secondary)]">
                    {previewResult.migrationLog.map((step, i) => (
                      <li key={i}>• {step}</li>
                    ))}
                  </ul>
                </div>
              )}

              {previewResult.errors.length > 0 && (
                <div className="mt-2 border-t border-[var(--border)] pt-2">
                  <div className="text-[11px] font-semibold text-rose-400">
                    Schema Validation Errors ({previewResult.errors.length}):
                  </div>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-rose-300">
                    {previewResult.errors.map((err, i) => (
                      <li key={i}>• {err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[var(--border)] pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            data-testid="confirm-import-blueprint-btn"
            disabled={!previewResult?.ok || !previewResult.blueprint}
            onClick={() => {
              if (previewResult?.ok && previewResult.blueprint) {
                onImportSuccess(previewResult.blueprint, previewResult);
              }
            }}
          >
            Apply Imported Blueprint
          </Button>
        </div>
      </div>
    </div>
  );
}
