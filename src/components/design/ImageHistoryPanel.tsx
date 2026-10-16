"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import type { GameBlueprint, ImageRevision, StylePalette } from "@/lib/blueprint/types";
import {
  checkRevisionDeletionImpact,
  deleteImageRevision,
  getImageHistoryItems,
  setRevisionAsCurrent,
  updateImageRevisionLabel,
  type ImageHistoryTarget,
  type RevisionDeletionImpact,
  type RevisionViewItem,
} from "@/lib/design/image-history";
import type { DesignDoc } from "@/lib/design/types";

const SOURCE_ICON: Record<ImageRevision["source"], IconName> = {
  create: "plus",
  import: "upload",
  upload: "upload",
  duplicate: "copy",
  variant: "layers",
  restore: "refresh-ccw",
};

function thumbStyle(uri: string | null, palette: StylePalette): CSSProperties {
  if (!uri) {
    return {
      background: `radial-gradient(110% 100% at 50% 0%, ${palette.accent}2e, ${palette.surface} 55%, ${palette.background})`,
    };
  }
  return {
    backgroundImage: `url("${uri}")`,
    backgroundSize: "contain",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  };
}

function triggerDownload(uri: string, filename: string) {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = uri;
  a.download = filename || "revision-artwork";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export interface ImageHistoryPanelProps {
  doc: DesignDoc;
  blueprint?: GameBlueprint | null;
  target: ImageHistoryTarget;
  palette: StylePalette;
  fallbackGlyph?: string;
  onApply: (label: string, fn: (doc: DesignDoc) => DesignDoc) => void;
  onNotify?: (message: string, kind?: "info" | "success" | "error") => void;
}

/**
 * F12 — Image History Interface.
 *
 * Displays recorded image versions in either Timeline or Grid mode.
 * Each revision displays:
 *  - thumbnail
 *  - timestamp
 *  - source
 *  - label
 *  - current indicator
 *
 * Supports actions:
 *  - Preview (modal with full metadata & side-by-side comparison)
 *  - Set as Current (creates a normal, undoable state change)
 *  - Download
 *  - Delete revision (checks dependencies first and shows a dependency warning
 *    modal if any component still requires the version)
 */
export function ImageHistoryPanel({
  doc,
  blueprint,
  target,
  palette,
  fallbackGlyph = "◆",
  onApply,
  onNotify,
}: ImageHistoryPanelProps) {
  const [viewMode, setViewMode] = useState<"timeline" | "grid">("timeline");
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [editingRevId, setEditingRevId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [pendingDeleteImpact, setPendingDeleteImpact] = useState<RevisionDeletionImpact | null>(null);

  const items = useMemo(() => getImageHistoryItems(doc, target), [doc, target]);
  const previewItem = useMemo(
    () => (previewItemId ? items.find((i) => i.id === previewItemId) ?? null : null),
    [items, previewItemId],
  );
  const currentItem = useMemo(() => items.find((i) => i.isCurrent) ?? null, [items]);

  const handleSetCurrent = (item: RevisionViewItem) => {
    onApply(`Set revision ${item.displayLabel} as current`, (d) =>
      setRevisionAsCurrent(d, target, item.id, {
        notes: `Restored ${item.displayLabel} (${item.id})`,
      }),
    );
    onNotify?.(`Set “${item.displayLabel}” as current artwork`, "success");
  };

  const handleDownload = (item: RevisionViewItem) => {
    if (!item.thumbnailUri) return;
    const safeName = (item.assetName || item.id).replace(/[^a-zA-Z0-9._-]+/g, "_");
    triggerDownload(item.thumbnailUri, safeName);
    onNotify?.(`Downloaded “${item.displayLabel}”`, "info");
  };

  const handleRequestDelete = (item: RevisionViewItem) => {
    const impact = checkRevisionDeletionImpact(doc, target, item.id, blueprint);
    if (impact.requiresWarning) {
      setPendingDeleteImpact(impact);
      return;
    }
    onApply(`Delete image revision ${item.displayLabel}`, (d) =>
      deleteImageRevision(d, target, item.id, { blueprint }).doc,
    );
    if (previewItemId === item.id) setPreviewItemId(null);
    onNotify?.(`Deleted revision “${item.displayLabel}”`, "info");
  };

  const handleConfirmDeleteWithDependencies = () => {
    if (!pendingDeleteImpact) return;
    const revId = pendingDeleteImpact.revisionId;
    const revLabel = pendingDeleteImpact.revisionLabel;
    setPendingDeleteImpact(null);
    onApply(`Delete image revision ${revLabel}`, (d) =>
      deleteImageRevision(d, target, revId, {
        confirmWithDependencies: true,
        blueprint,
      }).doc,
    );
    if (previewItemId === revId) setPreviewItemId(null);
    onNotify?.(`Removed revision “${revLabel}” from history (shared asset preserved)`, "info");
  };

  const startEditing = (item: RevisionViewItem) => {
    setEditingRevId(item.id);
    setLabelDraft(item.revision.label ?? item.displayLabel);
    setNotesDraft(item.notes);
  };

  const saveEditing = (revisionId: string) => {
    onApply("Update image revision label & notes", (d) =>
      updateImageRevisionLabel(d, target, revisionId, {
        label: labelDraft,
        notes: notesDraft,
      }),
    );
    setEditingRevId(null);
  };

  return (
    <div data-testid="image-history-panel" className="space-y-3">
      {/* Header & Timeline/Grid View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[10px] text-ink-300">
            {items.length} version{items.length === 1 ? "" : "s"}
          </span>
          <span className="text-[10px] text-ink-400">Non-destructive version history</span>
        </div>

        <div
          role="group"
          aria-label="History view mode"
          className="inline-flex rounded-lg border border-white/10 bg-ink-950/70 p-0.5"
        >
          <button
            type="button"
            data-testid="history-view-timeline"
            aria-pressed={viewMode === "timeline"}
            onClick={() => setViewMode("timeline")}
            className={`focus-ring flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition ${
              viewMode === "timeline"
                ? "bg-accent-500/20 text-blue-200"
                : "text-ink-400 hover:text-ink-200"
            }`}
          >
            <Icon name="list" size={11} />
            Timeline
          </button>
          <button
            type="button"
            data-testid="history-view-grid"
            aria-pressed={viewMode === "grid"}
            onClick={() => setViewMode("grid")}
            className={`focus-ring flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition ${
              viewMode === "grid"
                ? "bg-accent-500/20 text-blue-200"
                : "text-ink-400 hover:text-ink-200"
            }`}
          >
            <Icon name="grid" size={11} />
            Grid
          </button>
        </div>
      </div>

      {/* Empty State */}
      {items.length === 0 ? (
        <div
          data-empty-state="image-history"
          className="rounded-lg border border-dashed border-white/10 bg-ink-950/40 px-3 py-4 text-center"
        >
          <p className="text-[11px] font-medium text-ink-300">No image revisions recorded yet</p>
          <p className="mt-0.5 text-[10px] text-ink-400">
            Uploading or assigning artwork records a timestamped version here without erasing prior versions.
          </p>
        </div>
      ) : viewMode === "timeline" ? (
        /* TIMELINE VIEW */
        <ol data-testid="image-history-timeline" className="relative space-y-2.5 before:absolute before:top-3 before:bottom-3 before:left-3.5 before:w-px before:bg-white/10">
          {items.map((item) => {
            const isEditing = editingRevId === item.id;
            return (
              <li
                key={item.id}
                data-revision-id={item.id}
                className={`relative rounded-xl border p-2.5 pl-3 transition ${
                  item.isCurrent
                    ? "border-accent-500/50 bg-accent-500/[0.07]"
                    : "border-white/[0.07] bg-ink-950/50 hover:border-white/15"
                }`}
              >
                <div className="flex items-start gap-2.5">
                  {/* 1. Thumbnail */}
                  <button
                    type="button"
                    data-testid="revision-thumbnail"
                    onClick={() => setPreviewItemId(item.id)}
                    title="Click to preview this revision"
                    className="artwork-checker focus-ring relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-white/15"
                    style={thumbStyle(item.thumbnailUri, palette)}
                  >
                    {!item.thumbnailUri ? (
                      <span className="grid h-full w-full place-items-center text-[13px] font-bold text-ink-200">
                        {fallbackGlyph}
                      </span>
                    ) : null}
                  </button>

                  <div className="min-w-0 flex-1">
                    {/* Top row: Label, Current Indicator, Source, Timestamp */}
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 font-mono text-[9.5px] font-semibold text-ink-100">
                          v{item.versionNumber}
                        </span>
                        {/* 4. Label */}
                        <span
                          data-testid="revision-label"
                          className="truncate text-[11px] font-semibold text-ink-100"
                          title={item.displayLabel}
                        >
                          {item.displayLabel}
                        </span>
                        {/* 5. Current Indicator */}
                        {item.isCurrent ? (
                          <span
                            data-testid="revision-current-indicator"
                            className="rounded border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0 text-[9px] font-semibold text-emerald-200 uppercase"
                          >
                            Current
                          </span>
                        ) : null}
                      </div>

                      {/* 2. Timestamp */}
                      <time
                        data-testid="revision-timestamp"
                        dateTime={item.timestamp}
                        title={item.timestamp}
                        className="font-mono text-[9.5px] text-ink-400"
                      >
                        {item.formattedTimestamp}
                      </time>
                    </div>

                    {/* Second row: 3. Source + Asset Reference */}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[9.5px]">
                      <span
                        data-testid="revision-source"
                        className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-ink-300"
                      >
                        <Icon name={SOURCE_ICON[item.source]} size={10} />
                        {item.sourceLabel}
                      </span>
                      <span className="truncate font-mono text-ink-400" title={item.assetRefText}>
                        {item.assetName} ({item.assetRefText})
                      </span>
                    </div>

                    {/* Inline Label & Notes Editor */}
                    {isEditing ? (
                      <div className="mt-2 space-y-1.5 rounded-lg border border-white/10 bg-ink-950 p-2">
                        <input
                          type="text"
                          aria-label={`Label for revision ${item.id}`}
                          value={labelDraft}
                          placeholder="Revision label (e.g. v2 — Gold Trim)"
                          onChange={(e) => setLabelDraft(e.target.value)}
                          className="focus-ring w-full rounded border border-white/15 bg-ink-900 px-2 py-1 text-[10.5px] text-ink-100"
                        />
                        <input
                          type="text"
                          aria-label={`Notes for revision ${item.id}`}
                          value={notesDraft}
                          placeholder="Revision notes…"
                          onChange={(e) => setNotesDraft(e.target.value)}
                          className="focus-ring w-full rounded border border-white/15 bg-ink-900 px-2 py-1 text-[10px] text-ink-200"
                        />
                        <div className="flex justify-end gap-1.5">
                          <Button className="h-6 px-2 text-[10px]" onClick={() => setEditingRevId(null)}>
                            Cancel
                          </Button>
                          <Button
                            variant="primary"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => saveEditing(item.id)}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    ) : item.notes ? (
                      <p className="mt-1 text-[10px] italic text-ink-300">{item.notes}</p>
                    ) : null}

                    {/* Actions Row: Preview, Set as Current, Download, Edit label, Delete revision */}
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        data-testid="revision-preview-btn"
                        aria-label={`Preview revision ${item.id}`}
                        onClick={() => setPreviewItemId(item.id)}
                        className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-ink-200 transition hover:border-white/25 hover:text-ink-100"
                      >
                        <Icon name="eye" size={11} />
                        Preview
                      </button>

                      <button
                        type="button"
                        data-testid="revision-set-current-btn"
                        aria-label={
                          item.matchesActiveAsset
                            ? "Current image"
                            : `Set revision ${item.id} as current`
                        }
                        disabled={item.matchesActiveAsset}
                        onClick={() => handleSetCurrent(item)}
                        className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-ink-200 transition hover:border-accent-500/50 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Icon name="refresh-ccw" size={11} />
                        Set as Current
                      </button>

                      <button
                        type="button"
                        data-testid="revision-download-btn"
                        aria-label={`Download revision ${item.id}`}
                        disabled={!item.thumbnailUri}
                        onClick={() => handleDownload(item)}
                        title={item.thumbnailUri ? "Download this version" : "No downloadable image linked"}
                        className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-ink-200 transition hover:border-white/25 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Icon name="download" size={11} />
                        Download
                      </button>

                      <button
                        type="button"
                        aria-label={`Edit label and notes for revision ${item.id}`}
                        onClick={() => startEditing(item)}
                        className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-ink-300 transition hover:border-white/25 hover:text-ink-100"
                      >
                        <Icon name="pencil" size={10} />
                        Label
                      </button>

                      <button
                        type="button"
                        data-testid="revision-delete-btn"
                        aria-label={`Delete revision ${item.id}`}
                        onClick={() => handleRequestDelete(item)}
                        className="focus-ring inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-ink-300 transition hover:border-rose-500/40 hover:text-rose-200"
                      >
                        <Icon name="trash" size={11} />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        /* GRID VIEW */
        <div
          data-testid="image-history-grid"
          className="grid grid-cols-2 gap-2.5"
        >
          {items.map((item) => (
            <article
              key={item.id}
              data-revision-id={item.id}
              className={`flex flex-col justify-between rounded-xl border p-2.5 transition ${
                item.isCurrent
                  ? "border-accent-500/50 bg-accent-500/[0.07]"
                  : "border-white/[0.07] bg-ink-950/50 hover:border-white/15"
              }`}
            >
              <div>
                <div className="relative">
                  <button
                    type="button"
                    data-testid="revision-thumbnail"
                    onClick={() => setPreviewItemId(item.id)}
                    className="artwork-checker focus-ring relative aspect-square w-full overflow-hidden rounded-lg border border-white/10"
                    style={thumbStyle(item.thumbnailUri, palette)}
                  >
                    {!item.thumbnailUri ? (
                      <span className="grid h-full w-full place-items-center text-lg font-bold text-ink-200">
                        {fallbackGlyph}
                      </span>
                    ) : null}
                  </button>
                  {item.isCurrent ? (
                    <span
                      data-testid="revision-current-indicator"
                      className="absolute top-1.5 right-1.5 rounded border border-emerald-500/40 bg-emerald-500/80 px-1.5 py-0.5 text-[9px] font-semibold text-white uppercase shadow"
                    >
                      Current
                    </span>
                  ) : null}
                </div>

                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="rounded border border-white/10 bg-white/[0.05] px-1.5 py-0 font-mono text-[9px] font-semibold text-ink-100">
                      v{item.versionNumber}
                    </span>
                    <time
                      data-testid="revision-timestamp"
                      dateTime={item.timestamp}
                      className="font-mono text-[9px] text-ink-400"
                    >
                      {item.formattedTimestamp}
                    </time>
                  </div>
                  <p
                    data-testid="revision-label"
                    className="truncate text-[10.5px] font-semibold text-ink-100"
                    title={item.displayLabel}
                  >
                    {item.displayLabel}
                  </p>
                  <span
                    data-testid="revision-source"
                    className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-1.5 py-0 text-[9px] text-ink-300"
                  >
                    <Icon name={SOURCE_ICON[item.source]} size={9} />
                    {item.sourceLabel}
                  </span>
                </div>
              </div>

              <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-white/[0.06] pt-2">
                <button
                  type="button"
                  data-testid="revision-preview-btn"
                  aria-label={`Preview revision ${item.id}`}
                  onClick={() => setPreviewItemId(item.id)}
                  className="focus-ring rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] text-ink-200 hover:border-white/25"
                >
                  Preview
                </button>
                <button
                  type="button"
                  data-testid="revision-set-current-btn"
                  aria-label={
                    item.matchesActiveAsset
                      ? "Current image"
                      : `Set revision ${item.id} as current`
                  }
                  disabled={item.matchesActiveAsset}
                  onClick={() => handleSetCurrent(item)}
                  className="focus-ring rounded border border-white/10 px-1.5 py-0.5 text-[9.5px] text-ink-200 hover:border-accent-500/40 disabled:opacity-40"
                >
                  Set Current
                </button>
                <button
                  type="button"
                  data-testid="revision-download-btn"
                  aria-label={`Download revision ${item.id}`}
                  disabled={!item.thumbnailUri}
                  onClick={() => handleDownload(item)}
                  className="focus-ring rounded border border-white/10 p-1 text-ink-300 hover:text-ink-100 disabled:opacity-40"
                >
                  <Icon name="download" size={11} />
                </button>
                <button
                  type="button"
                  data-testid="revision-delete-btn"
                  aria-label={`Delete revision ${item.id}`}
                  onClick={() => handleRequestDelete(item)}
                  className="focus-ring rounded border border-white/10 p-1 text-ink-300 hover:text-rose-300"
                >
                  <Icon name="trash" size={11} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {/* PREVIEW MODAL */}
      {previewItem ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Preview image revision"
          data-testid="revision-preview-modal"
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setPreviewItemId(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-white/15 bg-ink-900 p-5 text-ink-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-white/[0.08] pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded border border-white/15 bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] font-semibold">
                    v{previewItem.versionNumber}
                  </span>
                  <h4 className="text-[14px] font-semibold text-ink-100">
                    {previewItem.displayLabel}
                  </h4>
                  {previewItem.isCurrent ? (
                    <span className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 uppercase">
                      Current
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 font-mono text-[10.5px] text-ink-400">
                  Revision ID: {previewItem.id} · {previewItem.sourceLabel} · {previewItem.formattedTimestamp}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close preview"
                onClick={() => setPreviewItemId(null)}
                className="focus-ring rounded-lg p-1.5 text-ink-400 hover:bg-white/10 hover:text-ink-100"
              >
                <Icon name="x" size={15} />
              </button>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_220px]">
              <div className="space-y-2">
                <div
                  className="artwork-checker grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-xl border border-white/10"
                  style={thumbStyle(previewItem.thumbnailUri, palette)}
                >
                  {!previewItem.thumbnailUri ? (
                    <span className="text-4xl font-bold text-ink-200">{fallbackGlyph}</span>
                  ) : null}
                </div>
                {currentItem && currentItem.id !== previewItem.id ? (
                  <div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-ink-950/60 px-3 py-2 text-[10.5px]">
                    <span className="text-ink-300">
                      Active current version: <strong className="text-ink-100">{currentItem.displayLabel}</strong>
                    </span>
                    <span className="font-mono text-ink-400">v{currentItem.versionNumber}</span>
                  </div>
                ) : null}
              </div>

              <dl className="space-y-2 rounded-xl border border-white/[0.07] bg-ink-950/50 p-3 text-[11px]">
                <div>
                  <dt className="text-[9.5px] tracking-wider text-ink-400 uppercase">Source</dt>
                  <dd className="font-medium text-ink-100">{previewItem.sourceLabel}</dd>
                </div>
                <div>
                  <dt className="text-[9.5px] tracking-wider text-ink-400 uppercase">Timestamp</dt>
                  <dd className="font-mono text-[10px] text-ink-200">{previewItem.timestamp}</dd>
                </div>
                <div>
                  <dt className="text-[9.5px] tracking-wider text-ink-400 uppercase">Asset Reference</dt>
                  <dd className="break-all font-mono text-[10px] text-ink-200">{previewItem.assetRefText}</dd>
                </div>
                <div>
                  <dt className="text-[9.5px] tracking-wider text-ink-400 uppercase">Dimensions &amp; Format</dt>
                  <dd className="font-mono text-[10px] text-ink-200">
                    {previewItem.dimensionsText} · {previewItem.formatText}
                  </dd>
                </div>
                {previewItem.notes ? (
                  <div>
                    <dt className="text-[9.5px] tracking-wider text-ink-400 uppercase">Notes</dt>
                    <dd className="text-[10.5px] text-ink-200">{previewItem.notes}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] pt-3">
              <Button
                variant="danger"
                onClick={() => handleRequestDelete(previewItem)}
              >
                <Icon name="trash" size={13} />
                Delete Revision
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={!previewItem.thumbnailUri}
                  onClick={() => handleDownload(previewItem)}
                >
                  <Icon name="download" size={13} />
                  Download
                </Button>
                <Button
                  variant="primary"
                  disabled={previewItem.matchesActiveAsset}
                  onClick={() => {
                    handleSetCurrent(previewItem);
                    setPreviewItemId(null);
                  }}
                >
                  <Icon name="refresh-ccw" size={13} />
                  Set as Current
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* DEPENDENCY WARNING MODAL BEFORE REVISION DELETION */}
      {pendingDeleteImpact ? (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-label="Revision dependency warning"
          data-testid="revision-dependency-warning-modal"
          className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-4 backdrop-blur-xs"
          onClick={() => setPendingDeleteImpact(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-amber-500/40 bg-ink-900 p-5 text-ink-100 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-amber-500/40 bg-amber-500/15 text-amber-300">
                <Icon name="alert" size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-[14px] font-semibold text-ink-100">
                  Dependency Warning — Version Still in Use
                </h4>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-300">
                  Revision <strong className="text-ink-100">“{pendingDeleteImpact.revisionLabel}”</strong> (
                  <code className="font-mono text-[10.5px]">{pendingDeleteImpact.revisionId}</code>) is still
                  referenced by {pendingDeleteImpact.dependencies.length} component
                  {pendingDeleteImpact.dependencies.length === 1 ? "" : "s"}:
                </p>
              </div>
            </div>

            <ul className="mt-3 max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-ink-950/70 p-3 text-[11px]">
              {pendingDeleteImpact.dependencies.map((dep) => (
                <li key={dep.id} className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-amber-200">{dep.label}</span>
                  <span className="text-right text-[10px] text-ink-400">{dep.detail}</span>
                </li>
              ))}
            </ul>

            <p className="mt-3 text-[11px] text-ink-400">
              If you proceed, this revision entry will be removed from the version history list, while the
              underlying artwork asset will remain intact so dependent components are not broken.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setPendingDeleteImpact(null)}>Cancel — Keep Revision</Button>
              <Button
                variant="danger"
                data-testid="confirm-delete-revision-with-deps"
                onClick={handleConfirmDeleteWithDependencies}
              >
                <Icon name="trash" size={13} />
                Delete Revision Anyway
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
