"use client";

import { useMemo, useRef, useState } from "react";
import { StudioShell } from "@/components/shell/StudioShell";
import {
  Badge,
  Button,
  Icon,
  Panel,
  PropertyRow,
  Section,
  Toggle,
} from "@/components/ui";
import type {
  ExportAnimationOptions,
  ExportImageScale,
  GameBlueprint,
  StudioExportType,
} from "@/lib/blueprint/types";
import { triggerDownload } from "@/lib/client/downloads";
import { workspaceApi } from "@/lib/client/workspace-api";
import { StudioEditorProvider, useStudioEditor } from "@/lib/editor/EditorProvider";
import {
  DEFAULT_ASSET_SHEET_VIEWPORT,
  EXPORT_TYPES,
  buildAssetSheetMetadata,
  exportBlueprintJson,
  exportPngAssetSheet,
  exportProjectJson,
  exportProjectZip,
  fitAssetSheetViewport,
  importExportedJson,
  panAssetSheetViewport,
  resolveZipExportOptions,
  validateBlueprintForExport,
  zoomAssetSheetViewport,
  type AssetSheetViewportState,
} from "@/lib/export";
import type { ProjectDetail } from "@/lib/workspace/types";

export function ExportWorkspace({ project }: { project: ProjectDetail }) {
  return (
    <StudioEditorProvider
      initialProject={{
        id: project.id,
        title: project.title,
        revision: project.revision,
        blueprint: project.blueprint,
      }}
    >
      <ExportWorkspaceInner initialProject={project} />
    </StudioEditorProvider>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function ExportWorkspaceInner({
  initialProject,
}: {
  initialProject: ProjectDetail;
}) {
  const editor = useStudioEditor();
  const active = editor.state.activeProject;

  const [selectedType, setSelectedType] = useState<StudioExportType>(
    active?.blueprint.exportConfig.activeExportType ?? "zip",
  );
  const [viewport, setViewport] = useState<AssetSheetViewportState>(
    DEFAULT_ASSET_SHEET_VIEWPORT,
  );
  const [isPanning, setIsPanning] = useState(false);
  const panOriginRef = useRef<{ startX: number; startY: number } | null>(null);

  const [validationFilter, setValidationFilter] = useState<
    "all" | "errors" | "warnings" | "passed"
  >("all");
  const [simulateCorruption, setSimulateCorruption] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importFeedback, setImportFeedback] = useState<{
    tone: "success" | "danger" | "info";
    message: string;
  } | null>(null);
  const [statusMessage, setStatusMessage] = useState<{
    tone: "success" | "danger" | "info";
    message: string;
  } | null>(null);
  const [persistingImport, setPersistingImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentProject = active ?? initialProject;
  const bp = currentProject.blueprint;
  const { exportConfig } = bp;
  const zipOptions = resolveZipExportOptions(exportConfig);

  // Effective blueprint evaluated by validation (supports testing critical schema corruption blocking)
  const effectiveBlueprintForValidation = useMemo<unknown>(() => {
    if (!simulateCorruption) return bp;
    return {
      ...bp,
      version: 0,
      meta: { ...bp.meta, title: "" },
      reels: { ...bp.reels, columns: 0, strips: "corrupted" },
    };
  }, [bp, simulateCorruption]);

  const validation = useMemo(
    () => validateBlueprintForExport(effectiveBlueprintForValidation),
    [effectiveBlueprintForValidation],
  );

  const assetSheetMeta = useMemo(
    () => buildAssetSheetMetadata(bp, zipOptions.imageScale),
    [bp, zipOptions.imageScale],
  );

  const zipPreview = useMemo(() => {
    if (validation.blocked) return null;
    try {
      return exportProjectZip(bp, zipOptions, {
        id: currentProject.id,
        title: currentProject.title,
        revision: currentProject.revision,
        folderPath: initialProject.folderPath,
      });
    } catch {
      return null;
    }
  }, [
    currentProject.id,
    currentProject.revision,
    currentProject.title,
    bp,
    initialProject.folderPath,
    validation.blocked,
    zipOptions,
  ]);

  const blueprintJsonString = useMemo(() => {
    const payload: GameBlueprint = exportConfig.includeAssets
      ? bp
      : {
          ...bp,
          assets: bp.assets.map((a) => ({ ...a, uri: null })),
        };
    return exportConfig.minify
      ? JSON.stringify(payload)
      : JSON.stringify(payload, null, 2);
  }, [bp, exportConfig.includeAssets, exportConfig.minify]);

  const projectJsonString = useMemo(() => {
    if (validation.blocked) {
      return JSON.stringify(
        {
          schema: "slot-studio.project-export",
          blocked: true,
          reason: validation.blockReason,
        },
        null,
        2,
      );
    }
    try {
      return exportProjectJson(
        bp,
        {
          id: currentProject.id,
          title: currentProject.title,
          revision: currentProject.revision,
          folderPath: initialProject.folderPath,
        },
        zipOptions,
      ).json;
    } catch {
      return "";
    }
  }, [
    currentProject.id,
    currentProject.revision,
    currentProject.title,
    bp,
    initialProject.folderPath,
    validation.blockReason,
    validation.blocked,
    zipOptions,
  ]);

  if (!active) return null;

  const updateExportConfig = (
    patch: Partial<typeof exportConfig>,
    label: string,
  ) => {
    editor.dispatchCommand("UPDATE_EXPORT", { patch }, label);
  };

  const handleSelectExportType = (type: StudioExportType) => {
    setSelectedType(type);
    updateExportConfig({ activeExportType: type }, `Select ${type} export`);
  };

  const handleScaleChange = (imageScale: ExportImageScale) => {
    updateExportConfig(
      { imageScale, animationOptions: zipOptions.animationOptions },
      `Set ZIP image scale to ${imageScale}`,
    );
  };

  const handleAnimationOptionChange = (
    key: keyof ExportAnimationOptions,
    value: boolean,
  ) => {
    const nextAnim: ExportAnimationOptions = {
      ...zipOptions.animationOptions,
      [key]: value,
    };
    updateExportConfig(
      { imageScale: zipOptions.imageScale, animationOptions: nextAnim },
      `Toggle ZIP animation option ${key}`,
    );
  };

  /* ---------------------------------------------------------------- */
  /* Download Handlers (Real Data, Blocked on Schema Corruption)       */
  /* ---------------------------------------------------------------- */

  const handleDownloadZip = () => {
    if (validation.blocked) {
      setStatusMessage({
        tone: "danger",
        message:
          validation.blockReason ??
          "Export blocked: critical schema corruption exists.",
      });
      return;
    }
    try {
      const res = exportProjectZip(bp, zipOptions, {
        id: active.id,
        title: active.title,
        revision: active.revision,
        folderPath: initialProject.folderPath,
      });
      const blob = new Blob([new Uint8Array(res.bytes)], {
        type: res.mimeType,
      });
      triggerDownload(blob, res.filename);
      setStatusMessage({
        tone: "success",
        message: `Downloaded ${res.filename} (${formatBytes(res.bytes.byteLength)}, ${res.entries.length} files at ${zipOptions.imageScale}).`,
      });
    } catch (err) {
      setStatusMessage({
        tone: "danger",
        message: err instanceof Error ? err.message : "ZIP export failed.",
      });
    }
  };

  const handleDownloadAssetSheet = () => {
    if (validation.blocked) {
      setStatusMessage({
        tone: "danger",
        message:
          validation.blockReason ??
          "Export blocked: critical schema corruption exists.",
      });
      return;
    }
    try {
      const res = exportPngAssetSheet(bp, zipOptions.imageScale);
      const blob = new Blob([new Uint8Array(res.bytes)], {
        type: res.mimeType,
      });
      triggerDownload(blob, res.filename);
      setStatusMessage({
        tone: "success",
        message: `Downloaded ${res.filename} (${formatBytes(res.bytes.byteLength)}, ${res.metadata.imageCount} images / ${res.metadata.assetCount} assets).`,
      });
    } catch (err) {
      setStatusMessage({
        tone: "danger",
        message:
          err instanceof Error ? err.message : "PNG Asset Sheet export failed.",
      });
    }
  };

  const handleDownloadBlueprintJson = () => {
    if (validation.blocked) {
      setStatusMessage({
        tone: "danger",
        message:
          validation.blockReason ??
          "Export blocked: critical schema corruption exists.",
      });
      return;
    }
    try {
      const res = exportBlueprintJson(bp, {
        includeAssets: exportConfig.includeAssets,
        minify: exportConfig.minify,
      });
      const blob = new Blob([new Uint8Array(res.bytes)], {
        type: "application/json;charset=utf-8",
      });
      triggerDownload(blob, res.filename);
      setStatusMessage({
        tone: "success",
        message: `Downloaded ${res.filename} (${formatBytes(res.bytes.byteLength)}).`,
      });
    } catch (err) {
      setStatusMessage({
        tone: "danger",
        message:
          err instanceof Error ? err.message : "Blueprint JSON export failed.",
      });
    }
  };

  const handleDownloadProjectJson = () => {
    if (validation.blocked) {
      setStatusMessage({
        tone: "danger",
        message:
          validation.blockReason ??
          "Export blocked: critical schema corruption exists.",
      });
      return;
    }
    try {
      const res = exportProjectJson(
        bp,
        {
          id: active.id,
          title: active.title,
          revision: active.revision,
          folderPath: initialProject.folderPath,
        },
        zipOptions,
      );
      const blob = new Blob([new Uint8Array(res.bytes)], {
        type: "application/json;charset=utf-8",
      });
      triggerDownload(blob, res.filename);
      setStatusMessage({
        tone: "success",
        message: `Downloaded ${res.filename} (${formatBytes(res.bytes.byteLength)}).`,
      });
    } catch (err) {
      setStatusMessage({
        tone: "danger",
        message:
          err instanceof Error ? err.message : "Project JSON export failed.",
      });
    }
  };

  const handlePrimaryExportAction = () => {
    switch (selectedType) {
      case "zip":
        handleDownloadZip();
        break;
      case "png-asset-sheet":
        handleDownloadAssetSheet();
        break;
      case "blueprint-json":
        handleDownloadBlueprintJson();
        break;
      case "project-json":
        handleDownloadProjectJson();
        break;
    }
  };

  /* ---------------------------------------------------------------- */
  /* Round-Trip Import Handlers                                        */
  /* ---------------------------------------------------------------- */

  const handleImportJsonContent = async (
    rawJson: string,
    persistToServer: boolean,
  ) => {
    const result = importExportedJson(rawJson);
    if (!result.ok || !result.blueprint) {
      setImportFeedback({
        tone: "danger",
        message:
          result.errors[0] ??
          "Import blocked: JSON contains critical schema corruption.",
      });
      return;
    }

    const restoredBp: GameBlueprint = {
      ...result.blueprint,
      meta: {
        ...result.blueprint.meta,
        id: active.id,
      },
    };

    editor.setActiveProject({
      id: active.id,
      title: restoredBp.meta.title || active.title,
      revision: active.revision,
      blueprint: restoredBp,
    });

    if (persistToServer) {
      setPersistingImport(true);
      try {
        const saved = await workspaceApi.saveProject(active.id, restoredBp);
        editor.setActiveProject({
          id: saved.id,
          title: saved.title,
          revision: saved.revision,
          blueprint: saved.blueprint,
        });
        setImportFeedback({
          tone: "success",
          message: `Imported and saved ${result.sourceKind === "project-json" ? "Project JSON" : "Blueprint JSON"} ("${saved.title}", revision ${saved.revision}) with full structure preserved.`,
        });
      } catch (err) {
        setImportFeedback({
          tone: "info",
          message: `Imported ${result.sourceKind} into active editor state (${err instanceof Error ? err.message : "local state updated"}).`,
        });
      } finally {
        setPersistingImport(false);
      }
    } else {
      setImportFeedback({
        tone: "success",
        message: `Imported ${result.sourceKind === "project-json" ? "Project JSON" : "Blueprint JSON"} ("${restoredBp.meta.title}") into studio state with ${restoredBp.symbols.length} symbols, ${restoredBp.scenes.length} scenes, and ${restoredBp.paylines.length} paylines preserved.`,
      });
    }
  };

  /* ---------------------------------------------------------------- */
  /* Asset Sheet Interactive Viewport Handlers                         */
  /* ---------------------------------------------------------------- */

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    setIsPanning(true);
    panOriginRef.current = { startX: e.clientX, startY: e.clientY };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPanning || !panOriginRef.current) return;
    const dx = e.clientX - panOriginRef.current.startX;
    const dy = e.clientY - panOriginRef.current.startY;
    panOriginRef.current = { startX: e.clientX, startY: e.clientY };
    setViewport((prev) => panAssetSheetViewport(prev, dx, dy));
  };

  const handlePointerUp = () => {
    setIsPanning(false);
    panOriginRef.current = null;
  };

  /* ---------------------------------------------------------------- */
  /* Right Panel: Export Controls, ZIP Options, Validation Summary     */
  /* ---------------------------------------------------------------- */

  const rightPanel = (
    <div className="space-y-4">
      <Section title="Export Types">
        <div className="grid grid-cols-1 gap-1.5">
          {EXPORT_TYPES.map((item, idx) => {
            const isSelected = selectedType === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => handleSelectExportType(item.id)}
                className={`focus-ring flex items-center justify-between rounded-md border px-2.5 py-2 text-left text-xs transition ${
                  isSelected
                    ? "border-accent-500/60 bg-accent-500/15 text-ink-50"
                    : "border-white/[0.07] bg-ink-950/70 text-ink-300 hover:border-white/15 hover:text-ink-100"
                }`}
              >
                <span className="font-medium">
                  {idx + 1}. {item.label}
                </span>
                <Badge tone={isSelected ? "accent" : "default"}>
                  {item.extension}
                </Badge>
              </button>
            );
          })}
        </div>
      </Section>

      <Section title="ZIP Options">
        <div className="space-y-3">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-ink-300">
              <span>Image scale</span>
              <span className="font-mono text-ink-400">
                {zipOptions.imageScale} ({zipOptions.imageScale === "2x" ? "200%" : "100%"})
              </span>
            </div>
            <div
              role="group"
              aria-label="ZIP Image Scale"
              className="grid grid-cols-2 gap-1.5"
            >
              {(["1x", "2x"] as const).map((scale) => {
                const activeScale = zipOptions.imageScale === scale;
                return (
                  <button
                    key={scale}
                    type="button"
                    aria-pressed={activeScale}
                    onClick={() => handleScaleChange(scale)}
                    className={`focus-ring rounded-md border px-3 py-1.5 font-mono text-xs font-semibold transition ${
                      activeScale
                        ? "border-accent-500 bg-accent-500/20 text-accent-300"
                        : "border-white/10 bg-ink-950 text-ink-300 hover:border-white/20 hover:text-ink-100"
                    }`}
                  >
                    {scale}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 border-t border-white/[0.06] pt-2.5">
            <div className="text-[11px] font-medium text-ink-300">
              Animation options
            </div>
            <Toggle
              label="Include video"
              checked={zipOptions.animationOptions.includeVideo}
              onChange={(val) => handleAnimationOptionChange("includeVideo", val)}
            />
            <Toggle
              label="Include WebM when available"
              checked={zipOptions.animationOptions.includeWebm}
              onChange={(val) => handleAnimationOptionChange("includeWebm", val)}
            />
            <Toggle
              label="Include sprite sheets"
              checked={zipOptions.animationOptions.includeSpriteSheets}
              onChange={(val) =>
                handleAnimationOptionChange("includeSpriteSheets", val)
              }
            />
            <Toggle
              label="Include GIF"
              checked={zipOptions.animationOptions.includeGif}
              onChange={(val) => handleAnimationOptionChange("includeGif", val)}
            />
          </div>
        </div>
      </Section>

      <Section title="Blueprint JSON Options">
        <div className="space-y-2">
          <Toggle
            label="Include Asset URIs"
            checked={exportConfig.includeAssets}
            onChange={(includeAssets) =>
              updateExportConfig({ includeAssets }, "Toggle export asset URIs")
            }
          />
          <Toggle
            label="Minify JSON Output"
            checked={exportConfig.minify}
            onChange={(minify) =>
              updateExportConfig({ minify }, "Toggle JSON minification")
            }
          />
        </div>
      </Section>

      <Section title="Validation Status">
        <div className="space-y-2 text-xs">
          <PropertyRow label="Export Gate">
            <Badge
              tone={
                validation.blocked
                  ? "danger"
                  : validation.warnings.length > 0
                    ? "warning"
                    : "success"
              }
            >
              {validation.blocked
                ? "Blocked (Schema Error)"
                : validation.warnings.length > 0
                  ? "Ready with Warnings"
                  : "Passed"}
            </Badge>
          </PropertyRow>
          <PropertyRow label="Errors">
            <Badge tone={validation.errors.length > 0 ? "danger" : "default"}>
              {validation.errors.length}
            </Badge>
          </PropertyRow>
          <PropertyRow label="Warnings">
            <Badge tone={validation.warnings.length > 0 ? "warning" : "default"}>
              {validation.warnings.length}
            </Badge>
          </PropertyRow>
          <PropertyRow label="Passed">
            <Badge tone="success">{validation.passed.length}</Badge>
          </PropertyRow>
        </div>
      </Section>

      <Section title="Direct Downloads">
        <div className="space-y-2">
          <Button
            variant="primary"
            disabled={validation.blocked}
            onClick={handleDownloadZip}
            className="w-full"
          >
            <Icon name="download" size={13} />
            Download ZIP ({zipOptions.imageScale})
          </Button>
          <Button
            disabled={validation.blocked}
            onClick={handleDownloadAssetSheet}
            className="w-full"
          >
            <Icon name="image" size={13} />
            Download PNG Asset Sheet
          </Button>
          <Button
            disabled={validation.blocked}
            onClick={handleDownloadBlueprintJson}
            className="w-full"
          >
            <Icon name="code" size={13} />
            Download Blueprint JSON
          </Button>
          <Button
            disabled={validation.blocked}
            onClick={handleDownloadProjectJson}
            className="w-full"
          >
            <Icon name="download" size={13} />
            Download Project JSON
          </Button>
        </div>
      </Section>
    </div>
  );

  const visibleValidationChecks =
    validationFilter === "errors"
      ? validation.errors
      : validationFilter === "warnings"
        ? validation.warnings
        : validationFilter === "passed"
          ? validation.passed
          : validation.checks;

  return (
    <StudioShell
      activeSection="export"
      sectionTitle="Frontend Export Center"
      rightPanel={rightPanel}
      rightPanelTitle="Export Center Controls"
      headerActions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setImportOpen((v) => !v);
              if (!importText) {
                setImportText(blueprintJsonString);
              }
            }}
          >
            <Icon name="upload" size={13} />
            Import Blueprint / Project JSON
          </Button>
          <Button
            variant="primary"
            disabled={validation.blocked}
            onClick={handlePrimaryExportAction}
          >
            <Icon name="download" size={13} />
            {selectedType === "zip"
              ? `Download ZIP (${zipOptions.imageScale})`
              : selectedType === "png-asset-sheet"
                ? "Download PNG Asset Sheet"
                : selectedType === "blueprint-json"
                  ? "Download Blueprint JSON"
                  : "Download Project JSON"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Explicit Truthfulness Notice */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-ink-900/90 px-4 py-2.5 text-xs text-ink-300">
          <div className="flex items-center gap-2">
            <Icon name="info" size={14} className="text-accent-400" />
            <span>
              <strong className="text-ink-100">Frontend Export Center:</strong>{" "}
              Packages real client-side studio archives (ZIP, PNG Asset Sheet,
              Blueprint JSON, and Project JSON). No server-side production game
              exporter exists.
            </span>
          </div>
          <Badge tone="default">Client-Side Studio Packaging</Badge>
        </div>

        {/* Status Toast / Feedback */}
        {statusMessage ? (
          <div
            role="status"
            className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-xs ${
              statusMessage.tone === "danger"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                : statusMessage.tone === "success"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-accent-500/40 bg-accent-500/10 text-ink-100"
            }`}
          >
            <span>{statusMessage.message}</span>
            <button
              type="button"
              onClick={() => setStatusMessage(null)}
              className="text-[11px] underline opacity-80 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {/* Critical Schema Corruption Blocker Banner */}
        {validation.blocked ? (
          <div
            role="alert"
            data-testid="export-blocked-banner"
            className="rounded-lg border border-rose-500/50 bg-rose-950/40 p-4 text-xs text-rose-200"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-rose-100">
                <Icon name="info" size={15} className="text-rose-400" />
                Export Blocked — Critical Schema Corruption Detected
              </div>
              {simulateCorruption ? (
                <Button
                  variant="outline"
                  onClick={() => setSimulateCorruption(false)}
                >
                  Clear Simulated Corruption
                </Button>
              ) : null}
            </div>
            <p className="mt-1 text-rose-200/90">
              All exports (Download ZIP, PNG Asset Sheet, Blueprint JSON, and
              Project JSON) are blocked until critical schema errors are
              resolved:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[11px] text-rose-100">
              {validation.errors.map((err) => (
                <li key={err.id}>{err.detail}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Round-Trip Blueprint / Project JSON Import Drawer */}
        {importOpen ? (
          <Panel
            title="Import Blueprint JSON or Project JSON"
            subtitle="Lossless round-trip import: validates schema before restoring the GameBlueprint into the studio"
            actions={
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    setImportText(text);
                    await handleImportJsonContent(text, false);
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Choose .json File
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setImportOpen(false)}
                >
                  Close
                </Button>
              </div>
            }
          >
            <div className="space-y-3">
              <textarea
                aria-label="Blueprint or Project JSON input"
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                rows={8}
                className="w-full rounded-md border border-white/10 bg-ink-950 p-3 font-mono text-[11px] text-ink-100 focus:border-accent-500 focus:outline-none"
                placeholder="Paste exported Blueprint JSON or Project JSON here..."
              />
              {importFeedback ? (
                <div
                  className={`rounded-md border px-3 py-2 text-xs ${
                    importFeedback.tone === "danger"
                      ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                      : importFeedback.tone === "success"
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                        : "border-accent-500/40 bg-accent-500/10 text-ink-200"
                  }`}
                >
                  {importFeedback.message}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  disabled={persistingImport}
                  onClick={() => void handleImportJsonContent(importText, false)}
                >
                  Validate &amp; Restore to Editor
                </Button>
                <Button
                  variant="outline"
                  disabled={persistingImport}
                  onClick={() => void handleImportJsonContent(importText, true)}
                >
                  {persistingImport
                    ? "Saving to Project Store…"
                    : "Validate, Restore & Save to Store"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setImportText(blueprintJsonString)}
                >
                  Load Current Blueprint JSON
                </Button>
              </div>
            </div>
          </Panel>
        ) : null}

        {/* 4 Export Type Cards */}
        <div
          role="tablist"
          aria-label="Export Types"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4"
        >
          {EXPORT_TYPES.map((item, idx) => {
            const isSelected = selectedType === item.id;
            return (
              <div
                key={item.id}
                role="tab"
                aria-selected={isSelected}
                onClick={() => handleSelectExportType(item.id)}
                className={`cursor-pointer rounded-xl border p-3.5 transition ${
                  isSelected
                    ? "border-accent-500 bg-accent-500/10 shadow-sm"
                    : "border-white/[0.08] bg-ink-900 hover:border-white/15"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-100">
                    {idx + 1}. {item.label}
                  </span>
                  <Badge tone={isSelected ? "accent" : "default"}>
                    {item.extension}
                  </Badge>
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-400">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>

        {/* Active Export Type Workspace */}
        {selectedType === "zip" ? (
          <Panel
            title={`Download ZIP Package (${zipOptions.imageScale})`}
            subtitle={
              zipPreview
                ? `${zipPreview.entries.length} packaged files · ${formatBytes(zipPreview.bytes.byteLength)} archive · Image scale ${zipOptions.imageScale}`
                : "Archive blocked by schema validation"
            }
            actions={
              <Button
                variant="primary"
                disabled={validation.blocked}
                onClick={handleDownloadZip}
              >
                <Icon name="download" size={13} />
                Download ZIP
              </Button>
            }
          >
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
              <div className="space-y-3 rounded-lg border border-white/[0.07] bg-ink-950 p-3.5 text-xs">
                <div className="font-semibold text-ink-100">
                  Active ZIP Configuration
                </div>
                <PropertyRow label="Image Scale">
                  <Badge tone="accent">{zipOptions.imageScale}</Badge>
                </PropertyRow>
                <PropertyRow label="Include video">
                  <Badge
                    tone={
                      zipOptions.animationOptions.includeVideo
                        ? "success"
                        : "default"
                    }
                  >
                    {zipOptions.animationOptions.includeVideo
                      ? "Included"
                      : "Excluded"}
                  </Badge>
                </PropertyRow>
                <PropertyRow label="Include WebM when available">
                  <Badge
                    tone={
                      zipOptions.animationOptions.includeWebm
                        ? "success"
                        : "default"
                    }
                  >
                    {zipOptions.animationOptions.includeWebm
                      ? "Included"
                      : "Excluded"}
                  </Badge>
                </PropertyRow>
                <PropertyRow label="Include sprite sheets">
                  <Badge
                    tone={
                      zipOptions.animationOptions.includeSpriteSheets
                        ? "success"
                        : "default"
                    }
                  >
                    {zipOptions.animationOptions.includeSpriteSheets
                      ? "Included"
                      : "Excluded"}
                  </Badge>
                </PropertyRow>
                <PropertyRow label="Include GIF">
                  <Badge
                    tone={
                      zipOptions.animationOptions.includeGif
                        ? "success"
                        : "default"
                    }
                  >
                    {zipOptions.animationOptions.includeGif
                      ? "Included"
                      : "Excluded"}
                  </Badge>
                </PropertyRow>
                <PropertyRow label="Asset Count">
                  <span className="font-mono text-ink-100">
                    {assetSheetMeta.assetCount}
                  </span>
                </PropertyRow>
                <PropertyRow label="Image Count">
                  <span className="font-mono text-ink-100">
                    {assetSheetMeta.imageCount}
                  </span>
                </PropertyRow>
              </div>

              <div className="rounded-lg border border-white/[0.07] bg-ink-950 p-3.5">
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-100">
                    Archive Contents ({zipPreview?.entries.length ?? 0} entries)
                  </span>
                  <span className="font-mono text-[11px] text-ink-400">
                    {zipPreview
                      ? `Total ${formatBytes(zipPreview.bytes.byteLength)}`
                      : "Blocked"}
                  </span>
                </div>
                <div className="max-h-[340px] overflow-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="border-b border-white/[0.07] text-ink-400">
                      <tr>
                        <th className="py-1.5 pr-3">File Path</th>
                        <th className="py-1.5 pr-3">Category</th>
                        <th className="py-1.5 pr-3">Scale / Format</th>
                        <th className="py-1.5 text-right">Size</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04] font-mono text-ink-200">
                      {(zipPreview?.entries ?? []).map((entry) => (
                        <tr key={entry.name}>
                          <td className="py-1.5 pr-3">{entry.name}</td>
                          <td className="py-1.5 pr-3">
                            <Badge tone="default">{entry.category}</Badge>
                          </td>
                          <td className="py-1.5 pr-3 text-ink-400">
                            {[entry.scale, entry.format]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                          <td className="py-1.5 text-right text-ink-300">
                            {formatBytes(entry.sizeBytes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </Panel>
        ) : null}

        {/* PNG Asset Sheet View */}
        <Panel
          title="PNG Asset Sheet"
          subtitle={`Asset Count: ${assetSheetMeta.assetCount} · Image Count: ${assetSheetMeta.imageCount} · Resolution ${assetSheetMeta.sheetWidth}×${assetSheetMeta.sheetHeight}px (${assetSheetMeta.scale})`}
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <div
                data-testid="asset-sheet-counts"
                className="mr-2 flex items-center gap-2 text-xs"
              >
                <Badge tone="default">
                  Asset Count: {assetSheetMeta.assetCount}
                </Badge>
                <Badge tone="accent">
                  Image Count: {assetSheetMeta.imageCount}
                </Badge>
              </div>
              <Button
                variant="outline"
                aria-label="Zoom out asset sheet"
                onClick={() =>
                  setViewport((v) => zoomAssetSheetViewport(v, v.zoom - 0.25))
                }
              >
                − Zoom
              </Button>
              <span
                data-testid="asset-sheet-zoom-value"
                className="min-w-[52px] text-center font-mono text-xs text-ink-200"
              >
                {Math.round(viewport.zoom * 100)}%
              </span>
              <Button
                variant="outline"
                aria-label="Zoom in asset sheet"
                onClick={() =>
                  setViewport((v) => zoomAssetSheetViewport(v, v.zoom + 0.25))
                }
              >
                + Zoom
              </Button>
              <Button
                variant="outline"
                aria-label="Pan asset sheet left"
                onClick={() =>
                  setViewport((v) => panAssetSheetViewport(v, -32, 0))
                }
              >
                ← Pan
              </Button>
              <Button
                variant="outline"
                aria-label="Pan asset sheet right"
                onClick={() =>
                  setViewport((v) => panAssetSheetViewport(v, 32, 0))
                }
              >
                Pan →
              </Button>
              <Button
                variant="outline"
                aria-label="Fit asset sheet"
                onClick={() => setViewport(fitAssetSheetViewport())}
              >
                Fit
              </Button>
              <Button
                variant="primary"
                disabled={validation.blocked}
                aria-label="Download PNG Asset Sheet"
                onClick={handleDownloadAssetSheet}
              >
                <Icon name="download" size={12} />
                Download
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-400">
              <div className="flex items-center gap-3">
                <span>
                  <strong className="text-ink-200">Asset Count:</strong>{" "}
                  {assetSheetMeta.assetCount}
                </span>
                <span>
                  <strong className="text-ink-200">Image Count:</strong>{" "}
                  {assetSheetMeta.imageCount}
                </span>
                <span>
                  <strong className="text-ink-200">Grid:</strong>{" "}
                  {assetSheetMeta.columns}×{assetSheetMeta.rows} cells
                </span>
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span>Zoom: {Math.round(viewport.zoom * 100)}%</span>
                <span>
                  Pan: ({viewport.panX}px, {viewport.panY}px)
                </span>
                <span className="text-ink-400">
                  Drag canvas to pan · Use Zoom / Fit controls
                </span>
              </div>
            </div>

            <div
              role="region"
              aria-label="PNG Asset Sheet Viewport"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              className="relative h-[380px] overflow-hidden rounded-lg border border-white/[0.08] bg-ink-950 select-none"
              style={{ cursor: isPanning ? "grabbing" : "grab" }}
            >
              <div
                className="flex h-full w-full items-center justify-center p-6"
                style={{
                  transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
                  transformOrigin: "center center",
                  transition: isPanning ? "none" : "transform 120ms ease-out",
                }}
              >
                <div
                  className="rounded-xl border border-white/15 bg-ink-900 p-4 shadow-2xl"
                  style={{
                    minWidth: Math.min(720, assetSheetMeta.columns * 150),
                  }}
                >
                  <div className="mb-3 flex items-center justify-between border-b border-white/10 pb-2 text-[11px]">
                    <span className="font-semibold text-ink-100">
                      {bp.meta.title} — PNG Asset Sheet ({assetSheetMeta.scale})
                    </span>
                    <span className="font-mono text-ink-400">
                      {assetSheetMeta.assetCount} assets ·{" "}
                      {assetSheetMeta.imageCount} images
                    </span>
                  </div>

                  <div
                    className="grid gap-3"
                    style={{
                      gridTemplateColumns: `repeat(${assetSheetMeta.columns}, minmax(120px, 1fr))`,
                    }}
                  >
                    {assetSheetMeta.items.map((item) => (
                      <div
                        key={item.id}
                        className="flex flex-col items-center justify-between rounded-lg border border-white/10 bg-ink-950 p-2.5 text-center"
                      >
                        <div
                          className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-white/15 font-bold text-white shadow-inner"
                          style={{ backgroundColor: item.colorHex }}
                        >
                          {item.uri ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.uri}
                              alt={item.name}
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <span className="text-lg">{item.glyph}</span>
                          )}
                        </div>
                        <div className="mt-2 w-full truncate text-[11px] font-medium text-ink-100">
                          {item.name}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1 font-mono text-[10px] text-ink-400">
                          <span>{item.category}</span>
                          <span>·</span>
                          <span>
                            {item.scaledWidth}×{item.scaledHeight}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Panel>

        {/* Blueprint JSON & Project JSON Inspector */}
        {(selectedType === "blueprint-json" ||
          selectedType === "project-json") ? (
          <Panel
            title={
              selectedType === "blueprint-json"
                ? "Blueprint JSON Export"
                : "Project JSON Export"
            }
            subtitle={
              selectedType === "blueprint-json"
                ? `${blueprintJsonString.length.toLocaleString()} characters · Readable GameBlueprint JSON`
                : `${projectJsonString.length.toLocaleString()} characters · Project metadata + GameBlueprint envelope`
            }
            actions={
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  disabled={validation.blocked}
                  onClick={
                    selectedType === "blueprint-json"
                      ? handleDownloadBlueprintJson
                      : handleDownloadProjectJson
                  }
                >
                  <Icon name="download" size={13} />
                  {selectedType === "blueprint-json"
                    ? "Download Blueprint JSON"
                    : "Download Project JSON"}
                </Button>
              </div>
            }
          >
            <pre className="max-h-[420px] overflow-auto rounded-lg border border-white/[0.07] bg-ink-950 p-4 font-mono text-[11px] leading-relaxed text-ink-200">
              {selectedType === "blueprint-json"
                ? blueprintJsonString
                : projectJsonString}
            </pre>
          </Panel>
        ) : null}

        {/* Validation Results Panel (Errors, Warnings, Passed) */}
        <Panel
          title="Export Validation Results"
          subtitle="Validates blueprint integrity and completeness before export; critical schema corruption blocks export"
          actions={
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setValidationFilter("all")}
                className={`rounded-md border px-2 py-1 text-[11px] ${
                  validationFilter === "all"
                    ? "border-accent-500 bg-accent-500/20 text-ink-100"
                    : "border-white/10 bg-ink-950 text-ink-300"
                }`}
              >
                All ({validation.checks.length})
              </button>
              <button
                type="button"
                onClick={() => setValidationFilter("errors")}
                className={`rounded-md border px-2 py-1 text-[11px] ${
                  validationFilter === "errors"
                    ? "border-rose-500 bg-rose-500/20 text-rose-200"
                    : "border-white/10 bg-ink-950 text-ink-300"
                }`}
              >
                Errors ({validation.errors.length})
              </button>
              <button
                type="button"
                onClick={() => setValidationFilter("warnings")}
                className={`rounded-md border px-2 py-1 text-[11px] ${
                  validationFilter === "warnings"
                    ? "border-amber-500 bg-amber-500/20 text-amber-200"
                    : "border-white/10 bg-ink-950 text-ink-300"
                }`}
              >
                Warnings ({validation.warnings.length})
              </button>
              <button
                type="button"
                onClick={() => setValidationFilter("passed")}
                className={`rounded-md border px-2 py-1 text-[11px] ${
                  validationFilter === "passed"
                    ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                    : "border-white/10 bg-ink-950 text-ink-300"
                }`}
              >
                Passed ({validation.passed.length})
              </button>
              <Button
                variant="ghost"
                onClick={() => setSimulateCorruption((v) => !v)}
              >
                {simulateCorruption
                  ? "Restore Valid Blueprint"
                  : "Test Schema Corruption Blocker"}
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            {/* Summary Cards for Errors, Warnings, Passed */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div
                data-testid="validation-errors-card"
                className="rounded-lg border border-rose-500/30 bg-rose-500/[0.06] p-3"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-rose-200">
                  <span>Errors</span>
                  <Badge
                    tone={validation.errors.length > 0 ? "danger" : "default"}
                  >
                    {validation.errors.length}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-400">
                  Critical schema corruption or broken references. Blocks export
                  when non-zero.
                </p>
              </div>

              <div
                data-testid="validation-warnings-card"
                className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-amber-200">
                  <span>Warnings</span>
                  <Badge
                    tone={
                      validation.warnings.length > 0 ? "warning" : "default"
                    }
                  >
                    {validation.warnings.length}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-400">
                  Completeness advisories (such as placeholder assets). Export
                  remains allowed.
                </p>
              </div>

              <div
                data-testid="validation-passed-card"
                className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-emerald-200">
                  <span>Passed</span>
                  <Badge tone="success">{validation.passed.length}</Badge>
                </div>
                <p className="mt-1 text-[11px] text-ink-400">
                  Verified schema, reel strips, paylines, paytable, scenes, and
                  math contracts.
                </p>
              </div>
            </div>

            {/* Detailed Validation Check List */}
            <ul className="max-h-[260px] divide-y divide-white/[0.05] overflow-auto rounded-lg border border-white/[0.07] bg-ink-950">
              {visibleValidationChecks.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-medium text-ink-100">{item.label}</div>
                    <div className="truncate text-[11px] text-ink-400">
                      {item.detail}
                    </div>
                  </div>
                  <Badge
                    tone={
                      item.status === "error"
                        ? "danger"
                        : item.status === "warning"
                          ? "warning"
                          : "success"
                    }
                  >
                    {item.status === "error"
                      ? "Error"
                      : item.status === "warning"
                        ? "Warning"
                        : "Passed"}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>
    </StudioShell>
  );
}
