"use client";

import { Icon } from "@/components/ui/Icon";
import { formatBytes } from "@/lib/creation/images";
import type { ProjectAssetSummary } from "@/server/asset-service";
import { detectAssetFormat } from "@/lib/assets/usage";

const FORMAT_BADGES: Record<string, { label: string; tone: string }> = {
  "png-transparent": { label: "Transparent PNG", tone: "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" },
  png: { label: "PNG Image", tone: "border-sky-500/30 bg-sky-500/10 text-sky-200" },
  jpeg: { label: "JPEG", tone: "border-amber-500/30 bg-amber-500/10 text-amber-200" },
  webp: { label: "WebP", tone: "border-violet-500/30 bg-violet-500/10 text-violet-200" },
  svg: { label: "Vector (SVG)", tone: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-200" },
  "json-animation": { label: "Animation JSON", tone: "border-teal-500/30 bg-teal-500/10 text-teal-200" },
  audio: { label: "Audio", tone: "border-rose-500/30 bg-rose-500/10 text-rose-200" },
  other: { label: "Other", tone: "border-white/10 bg-white/5 text-ink-300" },
};

interface Props {
  asset: ProjectAssetSummary;
  selected: boolean;
  onSelect: () => void;
  onAssign: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

export function AssetCard({ asset, selected, onSelect, onAssign, onDownload, onDelete }: Props) {
  const formatInfo = detectAssetFormat(asset);
  const badge = FORMAT_BADGES[formatInfo.format] || FORMAT_BADGES.other;
  const isImage = formatInfo.format !== "audio" && formatInfo.format !== "json-animation";

  return (
    <article
      data-asset-card={asset.id}
      data-selected={selected ? "true" : "false"}
      aria-label={asset.name}
      onClick={onSelect}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-ink-900 transition ${
        selected
          ? "border-accent-500/70 shadow-lg shadow-accent-600/15 ring-1 ring-accent-500/50"
          : "border-white/[0.07] hover:border-white/25 hover:bg-ink-850"
      }`}
    >
      {/* Thumbnail Area */}
      <div className="relative aspect-[4/3] w-full overflow-hidden border-b border-white/[0.06] bg-ink-950">
        {isImage && asset.uri ? (
          <div
            className={`h-full w-full ${formatInfo.isTransparent ? "artwork-checker" : ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.uri}
              alt={asset.name}
              loading="lazy"
              draggable={false}
              className="h-full w-full object-contain transition-transform group-hover:scale-105"
            />
          </div>
        ) : (
          <div className="grid h-full place-items-center text-ink-400">
            <Icon
              name={formatInfo.format === "audio" ? "image" : "code"}
              size={36}
            />
          </div>
        )}

        {/* Format Badge overlay */}
        <span
          className={`absolute top-2 left-2 rounded-md border px-1.5 py-0.5 text-[9px] font-medium backdrop-blur ${badge.tone}`}
        >
          {badge.label}
        </span>

        {/* Usage Count Badge overlay */}
        <span
          title={asset.usageCount > 0 ? `Used by ${asset.usageCount} item(s)` : "Unused asset"}
          className={`absolute top-2 right-2 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider backdrop-blur ${
            asset.usageCount > 0
              ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-200"
              : "border-white/10 bg-black/60 text-ink-400"
          }`}
        >
          {asset.usageCount > 0 ? `${asset.usageCount} ${asset.usageCount === 1 ? "use" : "uses"}` : "Unused"}
        </span>

        {/* Hover Quick Action Buttons */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-x-2 bottom-2 flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <button
            type="button"
            onClick={onAssign}
            aria-label={`Assign ${asset.name}`}
            title="Assign asset to element or symbol"
            className="focus-ring grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-black/70 text-ink-200 backdrop-blur hover:bg-white/10 hover:text-ink-100"
          >
            <Icon name="check" size={13} />
          </button>
          <button
            type="button"
            onClick={onDownload}
            aria-label={`Download ${asset.name}`}
            title="Download asset"
            className="focus-ring grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-black/70 text-ink-200 backdrop-blur hover:bg-white/10 hover:text-ink-100"
          >
            <Icon name="download" size={13} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${asset.name}`}
            title="Delete asset"
            className="focus-ring grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-black/70 text-ink-200 backdrop-blur hover:bg-rose-500/20 hover:text-rose-300"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>

      {/* Card Info Area */}
      <div className="flex flex-1 flex-col justify-between p-3">
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-ink-100" title={asset.name}>
            {asset.name}
          </div>
          <div className="mt-1 flex items-center justify-between text-[10.5px] text-ink-400">
            <span>
              {asset.width && asset.height
                ? `${asset.width} × ${asset.height}`
                : formatInfo.format === "svg"
                ? "Vector"
                : formatInfo.format === "json-animation"
                ? "Animation"
                : "—"}
            </span>
            <span>{asset.sizeBytes ? formatBytes(asset.sizeBytes) : "—"}</span>
          </div>
        </div>

        {/* Tags */}
        {asset.tags && asset.tags.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {asset.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded border border-white/10 bg-white/[0.02] px-1 py-0.5 text-[9px] text-ink-400"
              >
                #{tag}
              </span>
            ))}
            {asset.tags.length > 3 ? (
              <span className="text-[9px] text-ink-500">+{asset.tags.length - 3}</span>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
