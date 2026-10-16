"use client";

import { Icon } from "@/components/ui/Icon";
import { formatBytes } from "@/lib/creation/images";
import type { ProjectAssetSummary } from "@/server/asset-service";
import { detectAssetFormat } from "@/lib/assets/usage";

interface Props {
  asset: ProjectAssetSummary;
  selected: boolean;
  onSelect: () => void;
  onAssign: () => void;
  onDownload: () => void;
  onDelete: () => void;
}

export function AssetRow({ asset, selected, onSelect, onAssign, onDownload, onDelete }: Props) {
  const formatInfo = detectAssetFormat(asset);
  const isImage = formatInfo.format !== "audio" && formatInfo.format !== "json-animation";

  const formattedDate = asset.createdAt
    ? new Date(asset.createdAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  return (
    <tr
      data-asset-row={asset.id}
      data-selected={selected ? "true" : "false"}
      aria-selected={selected}
      aria-label={asset.name}
      onClick={onSelect}
      className={`group cursor-pointer border-b border-white/[0.05] transition ${
        selected ? "bg-accent-500/[0.08]" : "hover:bg-white/[0.02]"
      }`}
    >
      {/* Thumbnail */}
      <td className="py-2 pl-3">
        <div className="flex items-center gap-2.5">
          <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded-md border border-white/10 bg-ink-950">
            {isImage && asset.uri ? (
              <div className={`h-full w-full ${formatInfo.isTransparent ? "artwork-checker" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={asset.uri}
                  alt={asset.name}
                  loading="lazy"
                  className="h-full w-full object-contain"
                />
              </div>
            ) : (
              <div className="grid h-full place-items-center text-ink-400">
                <Icon name={formatInfo.format === "audio" ? "image" : "code"} size={18} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium text-ink-100" title={asset.name}>
              {asset.name}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-ink-500">
              <span>{asset.id}</span>
              {(asset.tags ?? []).slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-white/10 bg-white/[0.02] px-1 py-0 text-[9px] font-sans text-ink-400"
                >
                  #{tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      </td>

      {/* Format */}
      <td className="px-3 text-[11px] text-ink-300">
        <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px]">
          {formatInfo.label}
        </span>
      </td>

      {/* Dimensions */}
      <td className="px-3 text-[11px] text-ink-300">
        {asset.width && asset.height
          ? `${asset.width} × ${asset.height}`
          : formatInfo.format === "svg"
          ? "Vector"
          : "—"}
      </td>

      {/* Size */}
      <td className="px-3 text-[11px] text-ink-400">
        {asset.sizeBytes ? formatBytes(asset.sizeBytes) : "—"}
      </td>

      {/* Created Date */}
      <td className="px-3 text-[11px] text-ink-400">
        {formattedDate}
      </td>

      {/* Usage Count */}
      <td className="px-3 text-[11px]">
        <span
          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
            asset.usageCount > 0
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : "border-white/10 text-ink-400"
          }`}
        >
          {asset.usageCount > 0 ? `${asset.usageCount} uses` : "Unused"}
        </span>
      </td>

      {/* Actions */}
      <td className="py-2 pr-3 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={onAssign}
            aria-label={`Assign ${asset.name}`}
            title="Assign asset"
            className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 hover:bg-white/10 hover:text-ink-100"
          >
            <Icon name="check" size={13} />
          </button>
          <button
            type="button"
            onClick={onDownload}
            aria-label={`Download ${asset.name}`}
            title="Download asset"
            className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 hover:bg-white/10 hover:text-ink-100"
          >
            <Icon name="download" size={13} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Delete ${asset.name}`}
            title="Delete asset"
            className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 hover:bg-rose-500/20 hover:text-rose-300"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}
