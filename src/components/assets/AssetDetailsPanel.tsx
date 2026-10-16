"use client";

import { useState } from "react";
import { Button, Field } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { CommitInput } from "@/components/design/CommitInput";
import { formatBytes } from "@/lib/creation/images";
import type { ProjectAssetSummary } from "@/server/asset-service";
import { detectAssetFormat } from "@/lib/assets/usage";

interface Props {
  asset: ProjectAssetSummary | null;
  onRename: (newName: string) => void;
  onUpdateTags: (tags: string[]) => void;
  onAssign: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function AssetDetailsPanel({
  asset,
  onRename,
  onUpdateTags,
  onAssign,
  onDownload,
  onDelete,
  onClose,
}: Props) {
  const [newTag, setNewTag] = useState("");

  if (!asset) {
    return (
      <aside
        aria-label="Asset details"
        className="fixed inset-y-0 right-0 z-30 flex h-full min-h-0 w-[340px] max-w-[90vw] shrink-0 flex-col border-l border-white/[0.07] bg-ink-900 p-5 shadow-2xl shadow-black/60 xl:static xl:z-auto xl:shadow-none"
      >
        <div className="flex h-11 items-center justify-between border-b border-white/[0.07] pb-3">
          <h2 className="text-[11px] font-semibold tracking-[0.14em] text-ink-300 uppercase">
            Asset Details
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details panel"
            className="focus-ring rounded p-1 text-ink-400 hover:text-ink-100 xl:hidden"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="mt-8 text-center text-ink-400">
          <Icon name="image" size={32} className="mx-auto mb-2 text-ink-500" />
          <p className="text-[12px] font-medium text-ink-300">No asset selected</p>
          <p className="mt-1 text-[11px]">Click an asset in the library to inspect its details, usage and metadata.</p>
        </div>
      </aside>
    );
  }

  const formatInfo = detectAssetFormat(asset);
  const isImage = formatInfo.format !== "audio" && formatInfo.format !== "json-animation";

  const handleAddTag = () => {
    const clean = newTag.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    if (!clean) return;
    const current = asset.tags ?? [];
    if (!current.includes(clean)) {
      onUpdateTags([...current, clean]);
    }
    setNewTag("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const current = asset.tags ?? [];
    onUpdateTags(current.filter((t) => t !== tagToRemove));
  };

  return (
    <aside
      aria-label="Asset details"
      className="fixed inset-y-0 right-0 z-30 flex h-full min-h-0 w-[340px] max-w-[90vw] shrink-0 flex-col border-l border-white/[0.07] bg-ink-900 shadow-2xl shadow-black/60 xl:static xl:z-auto xl:shadow-none"
    >
      {/* Header */}
      <header className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
        <h2 className="text-[11px] font-semibold tracking-[0.14em] text-ink-200 uppercase">
          Asset Details
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close asset details"
          className="focus-ring rounded p-1 text-ink-400 hover:text-ink-100"
        >
          <Icon name="x" size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {/* Large Preview */}
        <div
          data-testid="asset-details-preview"
          className="relative aspect-square w-full overflow-hidden rounded-xl border border-white/10 bg-ink-950"
        >
          {isImage && asset.uri ? (
            <div className={`h-full w-full ${formatInfo.isTransparent ? "artwork-checker" : ""}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.uri}
                alt={asset.name}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className="grid h-full place-items-center text-ink-400">
              <Icon name={formatInfo.format === "audio" ? "image" : "code"} size={48} />
            </div>
          )}

          {formatInfo.isTransparent ? (
            <span className="absolute right-2 bottom-2 rounded-md border border-emerald-500/30 bg-emerald-950/80 px-2 py-0.5 text-[9px] font-medium text-emerald-200 backdrop-blur">
              Transparent Alpha
            </span>
          ) : null}
        </div>

        {/* Filename with inline commit */}
        <div data-testid="asset-details-filename">
          <Field label="Filename">
            <CommitInput
              value={asset.name}
              label="Asset filename"
              maxLength={120}
              onCommit={onRename}
            />
          </Field>
          <p className="mt-1 font-mono text-[9.5px] text-ink-500">ID: {asset.id}</p>
        </div>

        {/* Format & Dimensions Facts */}
        <section className="rounded-lg border border-white/[0.07] bg-ink-950/40 p-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[11px]">
            <dt className="text-ink-400">Format</dt>
            <dd data-testid="asset-details-format" className="text-right font-medium text-ink-100">{formatInfo.label}</dd>

            <dt className="text-ink-400">Dimensions</dt>
            <dd data-testid="asset-details-dimensions" className="text-right font-mono text-ink-200">
              {asset.width && asset.height
                ? `${asset.width} × ${asset.height} px`
                : formatInfo.format === "svg"
                ? "Scalable Vector"
                : "—"}
            </dd>

            <dt className="text-ink-400">File size</dt>
            <dd className="text-right font-mono text-ink-200">
              {asset.sizeBytes ? formatBytes(asset.sizeBytes) : "—"}
            </dd>

            <dt className="text-ink-400">MIME type</dt>
            <dd className="text-right font-mono text-ink-300">{asset.mime || "—"}</dd>

            <dt className="text-ink-400">Created</dt>
            <dd data-testid="asset-details-created" className="text-right text-ink-300">
              {asset.createdAt
                ? new Date(asset.createdAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </dd>
          </dl>
        </section>

        {/* Tags Section */}
        <section className="space-y-2">
          <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
            Tags
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {(asset.tags ?? []).map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.02] px-2 py-0.5 text-[10px] text-ink-300"
              >
                #{tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  aria-label={`Remove tag ${tag}`}
                  className="text-ink-400 hover:text-rose-300"
                >
                  <Icon name="x" size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddTag();
                }
              }}
              placeholder="Add tag and press Enter"
              aria-label="Add asset tag"
              className="focus-ring flex-1 rounded border border-white/10 bg-ink-950/70 px-2 py-1 text-[11px] text-ink-100 placeholder:text-ink-400/60"
            />
            <Button className="h-7 px-2 text-[10.5px]" onClick={handleAddTag}>
              Add
            </Button>
          </div>
        </section>

        {/* Used By Section (Usage Tracking) */}
        <section data-testid="asset-details-used-by" className="space-y-2 border-t border-white/[0.07] pt-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
              Used by ({asset.usageCount})
            </h3>
            <span
              className={`rounded border px-1.5 py-0.5 text-[9px] font-medium ${
                asset.usageCount > 0
                  ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
                  : "border-white/10 text-ink-400"
              }`}
            >
              {asset.usageCount > 0 ? "Active in project" : "Unused"}
            </span>
          </div>

          {asset.usage.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 p-3 text-[11px] text-ink-400">
              This asset is not currently referenced by any symbol, element, or scene. It can be safely deleted.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {asset.usage.map((item, idx) => (
                <li
                  key={`${item.id}-${idx}`}
                  className="rounded-md border border-white/[0.06] bg-ink-950/40 p-2 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-ink-100">{item.label}</span>
                    <span
                      className={`rounded border px-1.5 py-0 text-[9px] font-medium ${
                        item.category === "history"
                          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                          : "border-sky-500/30 bg-sky-500/10 text-sky-200"
                      }`}
                    >
                      {item.category === "history" ? "History Revision" : "Active Reference"}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[10px] text-ink-400">{item.detail}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Action Buttons: Assign, Download, Delete */}
        <section className="space-y-2 border-t border-white/[0.07] pt-3.5">
          <Button
            variant="primary"
            className="w-full py-2 text-[12px]"
            onClick={onAssign}
          >
            <Icon name="check" size={13} />
            Assign Asset to Element / Symbol
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              data-testid="asset-details-download-btn"
              className="py-1.5 text-[11px]"
              onClick={onDownload}
            >
              <Icon name="download" size={13} />
              Download
            </Button>

            <Button
              data-testid="asset-details-delete-btn"
              variant="danger"
              className="py-1.5 text-[11px]"
              onClick={onDelete}
            >
              <Icon name="trash" size={13} />
              Delete Asset
            </Button>
          </div>
        </section>
      </div>
    </aside>
  );
}
