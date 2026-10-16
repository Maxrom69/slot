"use client";

import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { ProjectAssetSummary } from "@/server/asset-service";

interface Props {
  asset: ProjectAssetSummary | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AssetDeleteDialog({ asset, onCancel, onConfirm }: Props) {
  if (!asset) return null;
  const inUse = asset.usageCount > 0;

  return (
    <Modal
      open={Boolean(asset)}
      onClose={onCancel}
      title={inUse ? "Delete Asset in Use?" : "Delete Asset"}
      width="md"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} autoFocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            <Icon name="trash" size={13} />
            {inUse ? "Unlink & Delete Asset" : "Delete Asset"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5 text-[12px] leading-relaxed text-ink-300">
        <p>
          Are you sure you want to delete “
          <span className="font-semibold text-ink-100">{asset.name}</span>”?
        </p>

        {inUse ? (
          <div
            role="alert"
            className="rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-3 text-amber-200"
          >
            <div className="flex items-center gap-2 font-medium">
              <Icon name="alert" size={15} className="text-amber-400" />
              <span>Warning: This asset is currently referenced by {asset.usageCount} item(s):</span>
            </div>

            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto pl-6 text-[11px] list-disc">
              {asset.usage.map((u, i) => (
                <li key={`${u.id}-${i}`}>
                  <strong>{u.label}</strong> — {u.detail}
                </li>
              ))}
            </ul>

            <p className="mt-2 text-[10.5px] leading-relaxed text-amber-300/80">
              Confirming deletion will safely unlink this asset across all referenced elements and symbols (restoring them to placeholder states). The GameBlueprint will not be corrupted.
            </p>
          </div>
        ) : (
          <p className="rounded-lg border border-white/[0.07] bg-ink-950/40 p-3 text-[11px] text-ink-400">
            This asset is not in use. It will be removed from your project library and storage.
          </p>
        )}
      </div>
    </Modal>
  );
}
