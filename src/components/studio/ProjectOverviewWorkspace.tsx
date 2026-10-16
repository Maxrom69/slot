"use client";

import { useState } from "react";
import Link from "next/link";
import { StudioShell } from "@/components/shell/StudioShell";
import {
  ElementDeleteConfirmModal,
  GridSizeChangeConfirmModal,
  IntegrationFlowBar,
} from "@/components/studio/IntegrationModals";
import {
  Badge,
  Button,
  Field,
  Icon,
  Panel,
  PropertyRow,
  Section,
  Select,
  TextArea,
  TextInput,
} from "@/components/ui";
import type { ProjectStatus } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { StudioEditorProvider, useStudioEditor } from "@/lib/editor/EditorProvider";
import {
  auditBlueprintDataIntegrity,
  sanitizeBlueprintDataIntegrity,
  verifySection2EngineContract,
} from "@/lib/qa";
import {
  STATUS_LABELS,
  type FolderSummary,
  type ProjectDetail,
} from "@/lib/workspace/types";

export function ProjectOverviewWorkspace({
  project,
  folders,
}: {
  project: ProjectDetail;
  folders: FolderSummary[];
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
      <ProjectOverviewInner folders={folders} />
    </StudioEditorProvider>
  );
}

function ProjectOverviewInner({ folders }: { folders: FolderSummary[] }) {
  const editor = useStudioEditor();
  const active = editor.state.activeProject;
  const [pendingGridSize, setPendingGridSize] = useState<{ columns: number; rows: number } | null>(null);
  const [pendingDeleteElementId, setPendingDeleteElementId] = useState<string | null>(null);
  if (!active) return null;

  const bp = active.blueprint;
  const meta = bp.meta;
  const check = validateBlueprint(bp);
  const dataQa = auditBlueprintDataIntegrity(bp);
  const engineContract = verifySection2EngineContract(bp);

  const rightPanel = (
    <div className="space-y-4">
      <Section title="Blueprint Integrity & Engine Contract">
        <div className="space-y-2 text-xs">
          <PropertyRow label="Status">
            <Badge tone={check.ok ? "success" : check.integrityOk ? "warning" : "danger"}>
              {check.ok ? "Valid" : check.integrityOk ? "Draft" : "Issues"}
            </Badge>
          </PropertyRow>
          <PropertyRow label="Section 2 Contract">
            <Badge tone={engineContract.ready ? "success" : "warning"}>
              {engineContract.ready ? "Contract Ready" : "Needs Attention"}
            </Badge>
          </PropertyRow>
          <PropertyRow label="AI Independence">
            <Badge tone="accent">100% Manual Ready</Badge>
          </PropertyRow>
          <PropertyRow label="Schema">
            <span className="font-mono text-ink-200">v{bp.version}</span>
          </PropertyRow>
          <PropertyRow label="Revision">
            <span className="font-mono text-ink-200">#{active.revision}</span>
          </PropertyRow>
          {check.issues.length > 0 ? (
            <ul className="mt-2 space-y-1 rounded-md border border-white/[0.07] bg-ink-950 p-2 text-[11px] text-ink-300">
              {check.issues.map((issue, idx) => (
                <li key={idx}>• {issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </Section>

      <Section title="Data QA Audit (7 Checks)">
        <div className="space-y-1.5 text-[11px]">
          {Object.values(dataQa.checks).map((item) => (
            <div
              key={item.id}
              data-testid={`data-qa-check-${item.id}`}
              className="flex items-center justify-between rounded border border-white/[0.06] bg-ink-950/60 px-2 py-1"
            >
              <span className="truncate text-ink-200">{item.label}</span>
              <Badge tone={item.passed ? "success" : "danger"}>
                {item.passed ? "PASS" : `${item.issueCount} Issue(s)`}
              </Badge>
            </div>
          ))}
          {!dataQa.valid ? (
            <div className="pt-1.5">
              <Button
                variant="outline"
                onClick={() => {
                  const sanitized = sanitizeBlueprintDataIntegrity(bp);
                  editor.dispatchCommand(
                    "REPLACE_BLUEPRINT",
                    {
                      blueprint: sanitized.blueprint,
                    },
                    `Sanitize Blueprint Data QA (${sanitized.repairedIssues.length} repaired)`,
                  );
                }}
              >
                Repair Data QA Issues
              </Button>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title={`Command History (${editor.state.undoStack.length})`}>
        {editor.state.undoStack.length === 0 ? (
          <p className="text-[11px] text-ink-400">
            No commands recorded in this session yet. Edit metadata or blueprint properties to record undoable commands.
          </p>
        ) : (
          <ul className="space-y-1 text-[11px]">
            {[...editor.state.undoStack].reverse().map((entry) => (
              <li
                key={entry.command.id}
                className="flex items-center justify-between rounded border border-white/[0.07] bg-ink-950 px-2 py-1"
              >
                <span className="truncate text-ink-200">{entry.command.label}</span>
                <span className="font-mono text-[9.5px] text-ink-400">
                  {entry.command.type}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );

  const modules = [
    {
      title: "Design Workspace",
      href: `/project/${active.id}/design`,
      meta: `${bp.symbolSets.length} sets · ${bp.elements.length} elements`,
      description: "Organize symbol sets, standalone elements, and visual composition.",
      badge: "Active",
    },
    {
      title: "Symbols & Paytable",
      href: `/project/${active.id}/symbols`,
      meta: `${bp.symbols.length} symbols · ${bp.specialSymbols.length} specials`,
      description: "Inspect and configure symbol tiers, glyphs, weights, and payouts.",
      badge: "Active",
    },
    {
      title: "Asset Library",
      href: `/project/${active.id}/assets`,
      meta: `${bp.assets.length} assets`,
      description: "Manage raster, vector, and animation metadata assets and bindings.",
      badge: "Active",
    },
    {
      title: "Scenes & Canvas",
      href: `/project/${active.id}/scenes`,
      meta: `${bp.scenes.length} scenes · ${bp.layers.length} layers`,
      description: "Compose scene objects, layer hierarchy, transforms, and safe areas.",
      badge: "Active",
    },
    {
      title: "Reel Strip Editor",
      href: `/project/${active.id}/reels`,
      meta: `${bp.reels.columns}×${bp.reels.rows} · ${bp.reels.evaluation}`,
      description: "Configure reel strips, symbol stop weights, grid dimensions, and spin direction.",
      badge: "Active",
    },
    {
      title: "Payline Editor",
      href: `/project/${active.id}/paylines`,
      meta: `${bp.paylines.length} paylines`,
      description: "Create, edit, and validate geometric payline patterns across the slot grid.",
      badge: "Active",
    },
    {
      title: "Paytable Editor",
      href: `/project/${active.id}/paytable`,
      meta: `${bp.paytable.length} payout entries`,
      description: "Configure symbol payout multipliers, special symbol rules, and win-tier thresholds.",
      badge: "Active",
    },
    {
      title: "Preview",
      href: `/project/${active.id}/preview`,
      meta: `${bp.reels.columns}×${bp.reels.rows} static grid`,
      description: "Deterministic non-playable composition preview of the Game Blueprint.",
      badge: "Static",
    },
    {
      title: "Math & Features",
      href: `/project/${active.id}/math`,
      meta: `${bp.math.rtpTarget}% RTP · ${bp.features.length} features`,
      description: "Declarative reel, payline, RTP, volatility, and feature configuration.",
      badge: "Config",
    },
    {
      title: "Export Blueprint",
      href: `/project/${active.id}/export`,
      meta: bp.exportConfig.format,
      description: "Validate and export the Game Blueprint JSON for the SECTION 2 engine.",
      badge: "Ready",
    },
  ];

  return (
    <StudioShell
      activeSection="projects"
      sectionTitle="Project Overview"
      rightPanel={rightPanel}
      rightPanelTitle="Project & History"
    >
      <div className="mb-5">
        <IntegrationFlowBar blueprint={bp} activeStage="project" />
      </div>

      <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel title="Project Metadata" subtitle="Updates blueprint.meta with undo/redo">
          <div className="space-y-3">
            <Field label="Title" required>
              <TextInput
                aria-label="Project title"
                value={meta.title}
                onChange={(e) =>
                  editor.dispatchCommand(
                    "UPDATE_META",
                    { patch: { title: e.target.value } },
                    "Rename project",
                  )
                }
              />
            </Field>
            <Field label="Theme">
              <TextInput
                aria-label="Project theme"
                value={meta.theme}
                onChange={(e) =>
                  editor.dispatchCommand(
                    "UPDATE_META",
                    { patch: { theme: e.target.value } },
                    "Update theme",
                  )
                }
              />
            </Field>
            <Field label="Style Guide">
              <TextInput
                aria-label="Style guide"
                value={meta.styleGuide}
                onChange={(e) =>
                  editor.dispatchCommand(
                    "UPDATE_META",
                    { patch: { styleGuide: e.target.value } },
                    "Update style guide",
                  )
                }
              />
            </Field>
            <Field label="Description">
              <TextArea
                aria-label="Project description"
                rows={3}
                value={meta.description}
                onChange={(e) =>
                  editor.dispatchCommand(
                    "UPDATE_META",
                    { patch: { description: e.target.value } },
                    "Update description",
                  )
                }
              />
            </Field>
            <Field label="Status">
              <Select
                aria-label="Project status"
                value={meta.status}
                onChange={(e) =>
                  editor.dispatchCommand(
                    "UPDATE_META",
                    { patch: { status: e.target.value as ProjectStatus } },
                    "Update project status",
                  )
                }
              >
                {Object.entries(STATUS_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Folder">
              <Select
                aria-label="Project folder"
                value={meta.folderPath ?? ""}
                onChange={(e) =>
                  editor.dispatchCommand(
                    "UPDATE_META",
                    { patch: { folderPath: e.target.value } },
                    "Move project folder",
                  )
                }
              >
                <option value="">Your Games (root)</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.path}>
                    {folder.path}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="pt-1">
              <Button
                variant="primary"
                disabled={!editor.state.dirty || editor.saving}
                onClick={() => void editor.saveActiveProject()}
                className="w-full"
              >
                <Icon name="save" size={13} />
                {editor.saving ? "Saving…" : "Save Project Changes"}
              </Button>
            </div>
          </div>
        </Panel>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-white/[0.07] bg-ink-900 px-3.5 py-2.5">
              <div className="text-[10px] tracking-wider text-ink-400 uppercase">Grid</div>
              <div className="mt-0.5 text-base font-semibold text-ink-100">
                {bp.reels.columns}×{bp.reels.rows}
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-ink-900 px-3.5 py-2.5">
              <div className="text-[10px] tracking-wider text-ink-400 uppercase">Evaluation</div>
              <div className="mt-0.5 text-base font-semibold text-ink-100 capitalize">
                {bp.reels.evaluation}
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-ink-900 px-3.5 py-2.5">
              <div className="text-[10px] tracking-wider text-ink-400 uppercase">Symbols</div>
              <div className="mt-0.5 text-base font-semibold text-ink-100">
                {bp.symbols.length}
              </div>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-ink-900 px-3.5 py-2.5">
              <div className="text-[10px] tracking-wider text-ink-400 uppercase">Paylines</div>
              <div className="mt-0.5 text-base font-semibold text-ink-100">
                {bp.paylines.length}
              </div>
            </div>
          </div>

          <Panel
            title="Critical Architectural Boundary (F22)"
            subtitle="Slot Studio Builder contract feeding the Section 2 Backend Slot Game Engine"
          >
            <div
              data-testid="critical-architectural-boundary"
              className="space-y-3 rounded-lg border border-white/[0.07] bg-ink-950/70 p-3.5 text-xs"
            >
              {/* Top Root: SLOT STUDIO */}
              <div className="flex flex-col items-center">
                <div className="rounded-md border border-accent-500/40 bg-accent-500/10 px-3 py-1 font-mono text-[11px] font-semibold tracking-wider text-accent-300 uppercase">
                  {engineContract.architecturalBoundary.studioRoot}
                </div>
                <div className="my-1.5 h-3 w-px bg-white/15" />
                <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div
                    data-testid="boundary-producer-frontend"
                    className="flex items-center justify-between rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2"
                  >
                    <div>
                      <div className="font-mono text-[11px] font-semibold text-emerald-200">
                        {engineContract.architecturalBoundary.producers.frontendBuilder.label}
                      </div>
                      <div className="text-[10.5px] text-ink-300">
                        Deterministic manual visual & math builder
                      </div>
                    </div>
                    <Badge tone="success">Active</Badge>
                  </div>

                  <div
                    data-testid="boundary-producer-future-ai"
                    className="flex items-center justify-between rounded-md border border-dashed border-white/15 bg-ink-900/60 px-3 py-2 opacity-80"
                  >
                    <div>
                      <div className="font-mono text-[11px] font-semibold text-ink-300">
                        {engineContract.architecturalBoundary.producers.futureAi.label}
                      </div>
                      <div className="text-[10.5px] text-ink-400">
                        Reserved extension point · Zero runtime AI dependency
                      </div>
                    </div>
                    <Badge tone="muted">Inactive</Badge>
                  </div>
                </div>
              </div>

              {/* Contract Hub: GAME BLUEPRINT */}
              <div className="flex flex-col items-center">
                <div className="mb-1.5 h-3 w-px bg-white/15" />
                <div
                  data-testid="boundary-contract-hub"
                  className="flex w-full items-center justify-between rounded-md border border-accent-500/40 bg-ink-900 px-3.5 py-2"
                >
                  <div>
                    <span className="font-mono text-xs font-semibold text-ink-100">
                      {engineContract.architecturalBoundary.contractHub.label}
                    </span>
                    <span className="ml-2 font-mono text-[10.5px] text-ink-400">
                      schema v{engineContract.architecturalBoundary.contractHub.schemaVersion} · single source of truth
                    </span>
                  </div>
                  <Badge
                    tone={
                      engineContract.architecturalBoundary.contractHub.valid
                        ? "success"
                        : "warning"
                    }
                  >
                    {engineContract.architecturalBoundary.contractHub.valid
                      ? "Validated"
                      : "Draft"}
                  </Badge>
                </div>
                <div className="mt-1.5 h-3 w-px bg-white/15" />
              </div>

              {/* Three Contract Pillars: ARTWORK | LAYOUT | MATH CONFIG */}
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                <div
                  data-testid="boundary-pillar-artwork"
                  className="rounded-md border border-white/[0.08] bg-ink-900/90 p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-ink-100">
                      {engineContract.architecturalBoundary.contractPillars.artwork.label}
                    </span>
                    <Badge
                      tone={
                        engineContract.architecturalBoundary.contractPillars.artwork.ready
                          ? "success"
                          : "warning"
                      }
                    >
                      {engineContract.architecturalBoundary.contractPillars.artwork.ready
                        ? "Ready"
                        : "Check"}
                    </Badge>
                  </div>
                  <div className="mt-1.5 space-y-0.5 font-mono text-[10.5px] text-ink-300">
                    <div>
                      {engineContract.architecturalBoundary.contractPillars.artwork.symbolSetCount} sets ·{" "}
                      {engineContract.architecturalBoundary.contractPillars.artwork.symbolCount} symbols
                    </div>
                    <div>
                      {engineContract.architecturalBoundary.contractPillars.artwork.elementCount} elements ·{" "}
                      {engineContract.architecturalBoundary.contractPillars.artwork.assetCount} assets
                    </div>
                    <div>
                      {engineContract.architecturalBoundary.contractPillars.artwork.animationCount} animations ·{" "}
                      {engineContract.architecturalBoundary.contractPillars.artwork.variantCount} variants
                    </div>
                  </div>
                </div>

                <div
                  data-testid="boundary-pillar-layout"
                  className="rounded-md border border-white/[0.08] bg-ink-900/90 p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-ink-100">
                      {engineContract.architecturalBoundary.contractPillars.layout.label}
                    </span>
                    <Badge
                      tone={
                        engineContract.architecturalBoundary.contractPillars.layout.ready
                          ? "success"
                          : "warning"
                      }
                    >
                      {engineContract.architecturalBoundary.contractPillars.layout.ready
                        ? "Ready"
                        : "Check"}
                    </Badge>
                  </div>
                  <div className="mt-1.5 space-y-0.5 font-mono text-[10.5px] text-ink-300">
                    <div>
                      {engineContract.architecturalBoundary.contractPillars.layout.sceneCount} scenes ·{" "}
                      {engineContract.architecturalBoundary.contractPillars.layout.layerCount} layers
                    </div>
                    <div>
                      {engineContract.architecturalBoundary.contractPillars.layout.sceneObjectCount} scene objects
                    </div>
                    <div>
                      {engineContract.architecturalBoundary.contractPillars.layout.canvasSize.width}×
                      {engineContract.architecturalBoundary.contractPillars.layout.canvasSize.height}px canvas
                    </div>
                  </div>
                </div>

                <div
                  data-testid="boundary-pillar-math-config"
                  className="rounded-md border border-white/[0.08] bg-ink-900/90 p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-semibold text-ink-100">
                      {engineContract.architecturalBoundary.contractPillars.mathConfig.label}
                    </span>
                    <Badge
                      tone={
                        engineContract.architecturalBoundary.contractPillars.mathConfig.ready
                          ? "success"
                          : "warning"
                      }
                    >
                      {engineContract.architecturalBoundary.contractPillars.mathConfig.ready
                        ? "Ready"
                        : "Check"}
                    </Badge>
                  </div>
                  <div className="mt-1.5 space-y-0.5 font-mono text-[10.5px] text-ink-300">
                    <div>
                      {engineContract.architecturalBoundary.contractPillars.mathConfig.columns}×
                      {engineContract.architecturalBoundary.contractPillars.mathConfig.rows} ·{" "}
                      {engineContract.architecturalBoundary.contractPillars.mathConfig.totalStops} reel stops
                    </div>
                    <div>
                      {engineContract.architecturalBoundary.contractPillars.mathConfig.activePaylineCount} paylines ·{" "}
                      {engineContract.architecturalBoundary.contractPillars.mathConfig.paytableRowCount} paytable rows
                    </div>
                    <div>
                      {engineContract.architecturalBoundary.contractPillars.mathConfig.rtpTarget}% RTP ·{" "}
                      {engineContract.architecturalBoundary.contractPillars.mathConfig.volatility}
                    </div>
                  </div>
                </div>
              </div>

              {/* Consumer Target: SECTION 2 — BACKEND SLOT GAME ENGINE */}
              <div className="flex flex-col items-center">
                <div className="mb-1.5 h-3 w-px bg-white/15" />
                <div
                  data-testid="boundary-consumer-section2"
                  className="flex w-full items-center justify-between rounded-md border border-white/15 bg-ink-900 px-3.5 py-2"
                >
                  <div>
                    <span className="font-mono text-xs font-semibold text-ink-100">
                      {engineContract.architecturalBoundary.consumer.label}
                    </span>
                    <span className="ml-2 font-mono text-[10.5px] text-ink-400">
                      target: {engineContract.architecturalBoundary.consumer.engineTarget}
                    </span>
                  </div>
                  <Badge
                    tone={
                      engineContract.architecturalBoundary.consumer.ready
                        ? "success"
                        : "warning"
                    }
                  >
                    {engineContract.architecturalBoundary.consumer.ready
                      ? "Contract Ready"
                      : "Needs Attention"}
                  </Badge>
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Grid Dimensions & Element Dependencies"
            subtitle="Resize grid or manage elements with live cross-editor dependency checks"
          >
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-[11px] font-semibold text-ink-200">
                  Change Grid Size (Current: {bp.reels.columns}×{bp.reels.rows})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { columns: 3, rows: 3, label: "3×3 Classic" },
                    { columns: 5, rows: 3, label: "5×3 Standard" },
                    { columns: 5, rows: 4, label: "5×4 Video" },
                    { columns: 6, rows: 4, label: "6×4 Ways" },
                    { columns: 6, rows: 5, label: "6×5 Megaways" },
                  ].map((preset) => {
                    const isCurrent =
                      bp.reels.columns === preset.columns && bp.reels.rows === preset.rows;
                    return (
                      <Button
                        key={preset.label}
                        variant={isCurrent ? "primary" : "outline"}
                        data-testid={`grid-preset-${preset.columns}x${preset.rows}`}
                        onClick={() => {
                          if (!isCurrent) {
                            setPendingGridSize({
                              columns: preset.columns,
                              rows: preset.rows,
                            });
                          }
                        }}
                      >
                        {preset.label}
                      </Button>
                    );
                  })}
                </div>
              </div>

              <div className="border-t border-white/[0.07] pt-3">
                <div className="mb-1.5 text-[11px] font-semibold text-ink-200">
                  Design Elements ({bp.elements.length})
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {bp.elements.map((el) => (
                    <div
                      key={el.id}
                      className="flex items-center justify-between rounded-md border border-white/[0.07] bg-ink-850 px-2.5 py-1.5 text-xs"
                    >
                      <div className="min-w-0 truncate">
                        <span className="font-medium text-ink-100">{el.name}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-ink-400">
                          {el.type}
                        </span>
                      </div>
                      <button
                        type="button"
                        data-testid={`delete-element-btn-${el.id}`}
                        onClick={() => setPendingDeleteElementId(el.id)}
                        className="ml-2 rounded px-1.5 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/15"
                        title={`Delete element ${el.name} with dependency check`}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title="Studio Workspaces"
            subtitle="Open a dedicated section of the Slot Studio Builder"
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {modules.map((mod) => (
                <Link
                  key={mod.href}
                  href={mod.href}
                  className="focus-ring group flex flex-col justify-between rounded-lg border border-white/[0.07] bg-ink-850 p-3.5 transition hover:border-accent-500/40 hover:bg-ink-800/80"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-ink-100 group-hover:text-accent-400">
                        {mod.title}
                      </span>
                      <Badge tone="accent">{mod.badge}</Badge>
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-400">
                      {mod.description}
                    </p>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 font-mono text-[10.5px] text-ink-300">
                    <span>{mod.meta}</span>
                    <span>Open →</span>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {pendingGridSize ? (
        <GridSizeChangeConfirmModal
          blueprint={bp}
          nextColumns={pendingGridSize.columns}
          nextRows={pendingGridSize.rows}
          onCancel={() => setPendingGridSize(null)}
          onConfirm={(paylineResolution) => {
            editor.dispatchCommand(
              "CHANGE_GRID_SIZE",
              {
                columns: pendingGridSize.columns,
                rows: pendingGridSize.rows,
                paylineResolution,
              },
              `Resize grid to ${pendingGridSize.columns}×${pendingGridSize.rows}`,
            );
            setPendingGridSize(null);
          }}
        />
      ) : null}

      {pendingDeleteElementId ? (
        <ElementDeleteConfirmModal
          blueprint={bp}
          elementId={pendingDeleteElementId}
          onCancel={() => setPendingDeleteElementId(null)}
          onConfirm={() => {
            editor.dispatchCommand(
              "DELETE_ELEMENT",
              { id: pendingDeleteElementId },
              `Delete element ${pendingDeleteElementId}`,
            );
            setPendingDeleteElementId(null);
          }}
        />
      ) : null}
    </StudioShell>
  );
}
