"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, SegmentedControl } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Toasts } from "@/components/ui/Toasts";
import type { AssetFormat, GameBlueprint, ProjectStatus } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { selectSets, selectStandalone } from "@/lib/design/selectors";
import { designDocFromBlueprint } from "@/lib/design/migrate";
import { LeftNav } from "@/components/design/LeftNav";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";
import { assetApi } from "@/lib/client/asset-api";
import { triggerDownload } from "@/lib/client/downloads";
import type { Toast } from "@/lib/client/useWorkspace";
import type { ProjectAssetSummary } from "@/server/asset-service";
import { detectAssetFormat, type AssignTarget } from "@/lib/assets/usage";
import type { ValidatedUpload } from "@/lib/assets/upload-helper";

import { AssetCard } from "./AssetCard";
import { AssetRow } from "./AssetRow";
import { AssetDetailsPanel } from "./AssetDetailsPanel";
import { AssetUploadZone } from "./AssetUploadZone";
import { AssetDeleteDialog } from "./AssetDeleteDialog";
import { AssetAssignDialog } from "./AssetAssignDialog";

export interface AssetLibraryAppProps {
  project: {
    id: string;
    title: string;
    theme: string;
    status: ProjectStatus;
    folderPath: string;
  };
  blueprint: GameBlueprint;
  initialAssets: ProjectAssetSummary[];
  totalStorageBytes: number;
}

export type ViewMode = "grid" | "list";
export type FilterType =
  | "all"
  | "images"
  | "png-transparent"
  | "jpeg"
  | "webp"
  | "svg"
  | "json-animation"
  | "other";

const FILTER_OPTIONS: { id: FilterType; label: string }[] = [
  { id: "all", label: "All Assets" },
  { id: "images", label: "Images" },
  { id: "png-transparent", label: "Transparent PNG" },
  { id: "jpeg", label: "JPEG" },
  { id: "webp", label: "WebP" },
  { id: "svg", label: "Vector (SVG)" },
  { id: "json-animation", label: "Animation Metadata" },
  { id: "other", label: "Other" },
];

export function AssetLibraryApp({
  project,
  blueprint: initialBlueprint,
  initialAssets,
}: AssetLibraryAppProps) {
  const router = useRouter();
  const [blueprint, setBlueprint] = useState<GameBlueprint>(initialBlueprint);
  const [assets, setAssets] = useState<ProjectAssetSummary[]>(initialAssets);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(initialAssets[0]?.id ?? null);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const [detailsOpen, setDetailsOpen] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ProjectAssetSummary | null>(null);
  const [assignTarget, setAssignTarget] = useState<ProjectAssetSummary | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const pushToast = useCallback((message: string, tone: Toast["tone"] = "info") => {
    toastSeq.current += 1;
    const id = `asset-toast-${toastSeq.current}`;
    setToasts((current) => [...current.slice(-3), { id, message, tone, undoable: false }]);
    window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 6000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  // Sync assets from server if refreshed
  const reloadAssets = useCallback(async () => {
    try {
      const res = await assetApi.fetchAssets(project.id);
      setAssets(res.assets);
      const projRes = await fetch(`/api/projects/${project.id}`, { cache: "no-store" });
      if (projRes.ok) {
        const pData = await projRes.json();
        if (pData.blueprint) setBlueprint(pData.blueprint);
      }
    } catch {
      // offline/reload fallback
    }
  }, [project.id]);

  // Derived LeftNav data
  const designDoc = useMemo(() => designDocFromBlueprint(blueprint), [blueprint]);
  const sets = useMemo(() => selectSets(designDoc), [designDoc]);
  const standalone = useMemo(() => selectStandalone(designDoc), [designDoc]);
  const check = useMemo(() => validateBlueprint(blueprint), [blueprint]);

  // Selected asset
  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  // All unique tags across project assets
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) {
      for (const t of a.tags ?? []) set.add(t);
    }
    return Array.from(set).sort();
  }, [assets]);

  // Filtered and searched assets
  const filteredAssets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return assets.filter((asset) => {
      const formatInfo = detectAssetFormat(asset);

      // 1. Type filter
      if (activeFilter === "images") {
        const isImg =
          formatInfo.format === "png" ||
          formatInfo.format === "png-transparent" ||
          formatInfo.format === "jpeg" ||
          formatInfo.format === "webp";
        if (!isImg) return false;
      } else if (activeFilter === "png-transparent") {
        if (formatInfo.format !== "png-transparent") return false;
      } else if (activeFilter === "jpeg") {
        if (formatInfo.format !== "jpeg") return false;
      } else if (activeFilter === "webp") {
        if (formatInfo.format !== "webp") return false;
      } else if (activeFilter === "svg") {
        if (formatInfo.format !== "svg") return false;
      } else if (activeFilter === "json-animation") {
        if (formatInfo.format !== "json-animation") return false;
      } else if (activeFilter === "other") {
        const isStandard =
          formatInfo.format === "png" ||
          formatInfo.format === "png-transparent" ||
          formatInfo.format === "jpeg" ||
          formatInfo.format === "webp" ||
          formatInfo.format === "svg" ||
          formatInfo.format === "json-animation";
        if (isStandard) return false;
      }

      // 2. Tag filter
      if (selectedTag && !(asset.tags ?? []).includes(selectedTag)) {
        return false;
      }

      // 3. Search query
      if (q) {
        const matchName = asset.name.toLowerCase().includes(q);
        const matchFormat = formatInfo.label.toLowerCase().includes(q);
        const matchTags = (asset.tags ?? []).some((t) => t.toLowerCase().includes(q));
        const matchUsage = asset.usage.some(
          (u) => u.name.toLowerCase().includes(q) || u.label.toLowerCase().includes(q),
        );
        if (!matchName && !matchFormat && !matchTags && !matchUsage) return false;
      }

      return true;
    });
  }, [assets, activeFilter, selectedTag, searchQuery]);

  // Upload handler
  const handleUploadFiles = async (uploads: ValidatedUpload[]) => {
    setUploading(true);
    let successCount = 0;
    const errors: string[] = [];

    for (const item of uploads) {
      try {
        const res = await assetApi.uploadAsset(project.id, {
          name: item.name,
          dataUrl: item.dataUrl,
          tags: ["library", item.format],
        });
        successCount += 1;
        setAssets((curr) => {
          const exists = curr.some((a) => a.id === res.asset.id);
          return exists ? curr.map((a) => (a.id === res.asset.id ? res.asset : a)) : [res.asset, ...curr];
        });
        setSelectedAssetId(res.asset.id);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : `Failed to upload “${item.name}”.`);
      }
    }

    setUploading(false);
    if (successCount > 0) {
      pushToast(`Uploaded ${successCount} asset${successCount === 1 ? "" : "s"} successfully.`, "success");
      void reloadAssets();
    }
    if (errors.length > 0) {
      pushToast(errors.join(" "), "error");
    }
  };

  // Download handler
  const handleDownload = async (asset: ProjectAssetSummary) => {
    if (!asset.uri) {
      pushToast("Cannot download placeholder asset.", "error");
      return;
    }
    try {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error();
      const blob = await response.blob();
      triggerDownload(blob, asset.name);
      pushToast(`Downloaded “${asset.name}”`, "info");
    } catch {
      pushToast("Download failed. Could not fetch asset binary.", "error");
    }
  };

  // Rename handler
  const handleRename = async (newName: string) => {
    if (!selectedAsset) return;
    try {
      const res = await assetApi.updateAsset(project.id, selectedAsset.id, { name: newName });
      setAssets((curr) =>
        curr.map((a) => (a.id === selectedAsset.id ? { ...a, name: res.asset.name } : a)),
      );
      pushToast(`Renamed asset to “${res.asset.name}”`, "success");
      void reloadAssets();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to rename asset.", "error");
    }
  };

  // Update tags handler
  const handleUpdateTags = async (tags: string[]) => {
    if (!selectedAsset) return;
    try {
      const res = await assetApi.updateAsset(project.id, selectedAsset.id, { tags });
      setAssets((curr) =>
        curr.map((a) => (a.id === selectedAsset.id ? { ...a, tags: res.asset.tags } : a)),
      );
      pushToast("Updated asset tags.", "success");
      void reloadAssets();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to update tags.", "error");
    }
  };

  // Delete handler
  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    try {
      const res = await assetApi.deleteAsset(project.id, target.id);
      setAssets((curr) => curr.filter((a) => a.id !== target.id));
      if (selectedAssetId === target.id) {
        setSelectedAssetId(null);
      }
      if (res.unlinkedCount > 0) {
        pushToast(`Deleted “${target.name}” and unlinked ${res.unlinkedCount} reference(s).`, "info");
      } else {
        pushToast(`Deleted “${target.name}”.`, "info");
      }
      void reloadAssets();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Failed to delete asset.", "error");
    }
  };

  // Assign handler
  const handleConfirmAssign = async (target: AssignTarget) => {
    if (!assignTarget) return;
    const asset = assignTarget;
    try {
      await assetApi.assignAsset(project.id, asset.id, target);
      setAssignTarget(null);
      pushToast(`Assigned “${asset.name}” successfully.`, "success");
      void reloadAssets();
    } catch (err) {
      pushToast(err instanceof Error ? err.message : "Assignment failed.", "error");
    }
  };

  return (
    <div className="creation-studio flex h-dvh flex-col overflow-hidden">
      <ProjectTopNav projectId={project.id} projectTitle={project.title} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left Navigation */}
        <LeftNav
          project={project}
          palette={blueprint.style.palette}
          sets={sets}
          standalone={standalone}
          selection={null}
          check={check}
          open={navOpen}
          activeNav="assets"
          onClose={() => setNavOpen(false)}
          onNavigate={(path) => router.push(path)}
          onPick={() => undefined}
          onExport={() => {
            window.location.href = `/api/projects/${project.id}/export`;
          }}
        />

        {/* Main Workspace Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Header */}
          <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-900/80 px-4 py-2 sm:px-6 backdrop-blur">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setNavOpen((o) => !o)}
                aria-label="Toggle navigation"
                className="focus-ring rounded-md p-1.5 text-ink-300 hover:text-ink-100 lg:hidden"
              >
                <Icon name="panel-left" size={17} />
              </button>

              <div className="flex min-w-0 items-center gap-3">
                <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[11px] text-ink-400">
                  <span className="truncate text-ink-300">{project.title}</span>
                  <Icon name="chevron-right" size={11} />
                  <h1 className="truncate text-[12px] font-semibold text-ink-100">Asset Library</h1>
                </nav>
              </div>
            </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <SegmentedControl
              ariaLabel="Asset view mode"
              value={viewMode}
              onChange={(v) => setViewMode(v)}
              options={[
                { value: "grid", label: "Grid" },
                { value: "list", label: "List" },
              ]}
            />

            {/* Toggle Details Panel */}
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              aria-label="Toggle asset details"
              className="focus-ring rounded-md p-1.5 text-ink-300 hover:text-ink-100 xl:hidden"
            >
              <Icon name="panel-right" size={17} />
            </button>
          </div>
        </header>

        {/* Sub-Header: Search, Filter Tabs & Tag Chips */}
        <div className="shrink-0 space-y-2 border-b border-white/[0.07] bg-ink-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative w-full max-w-sm sm:w-80">
              <Icon name="search" size={13} className="pointer-events-none absolute top-2.5 left-3 text-ink-400" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search filename, tag, format..."
                aria-label="Search assets"
                className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/80 py-1.5 pr-8 pl-8 text-[12px] text-ink-100 placeholder:text-ink-400/60 hover:border-white/20"
              />
              {searchQuery ? (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                  className="focus-ring absolute top-2.5 right-2 text-ink-400 hover:text-ink-100"
                >
                  <Icon name="x" size={12} />
                </button>
              ) : null}
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-ink-400">
                {filteredAssets.length} of {assets.length} assets
              </span>
            </div>
          </div>

          {/* Type Filter Chips */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1" role="tablist" aria-label="Asset type filters">
            {FILTER_OPTIONS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={activeFilter === f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`focus-ring rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
                  activeFilter === f.id
                    ? "border-accent-500/50 bg-accent-500/15 text-blue-200"
                    : "border-white/10 bg-white/[0.02] text-ink-300 hover:border-white/20 hover:text-ink-100"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Tags Chips Bar */}
          {allTags.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1 pt-1 text-[10px]">
              <span className="text-ink-500">Tags:</span>
              <button
                type="button"
                onClick={() => setSelectedTag(null)}
                className={`focus-ring rounded px-1.5 py-0.5 ${
                  selectedTag === null ? "bg-white/10 text-ink-100 font-semibold" : "text-ink-400 hover:text-ink-200"
                }`}
              >
                All
              </button>
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={`focus-ring rounded px-1.5 py-0.5 transition ${
                    selectedTag === tag
                      ? "bg-accent-500/20 text-accent-300 font-semibold"
                      : "text-ink-400 hover:text-ink-200"
                  }`}
                >
                  #{tag}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Work Area + Details Sidebar */}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {/* Main List / Grid Canvas */}
          <main className="min-h-0 min-w-0 flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
            {/* Upload Zone */}
            <AssetUploadZone
              uploading={uploading}
              onUpload={handleUploadFiles}
              onError={(err) => pushToast(err, "error")}
            />

            {/* Assets Grid or List */}
            {filteredAssets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 p-12 text-center text-ink-400">
                <Icon name="image" size={32} className="mx-auto mb-2 text-ink-500" />
                <p className="text-[13px] font-medium text-ink-200">No assets found</p>
                <p className="mt-1 text-[11.5px]">
                  {searchQuery || activeFilter !== "all" || selectedTag
                    ? "Try adjusting your search terms or filters."
                    : "Upload your first asset using the dropzone above."}
                </p>
                {(searchQuery || activeFilter !== "all" || selectedTag) && (
                  <Button
                    className="mt-4 text-[11px]"
                    onClick={() => {
                      setSearchQuery("");
                      setActiveFilter("all");
                      setSelectedTag(null);
                    }}
                  >
                    Reset filters
                  </Button>
                )}
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3.5">
                {filteredAssets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    selected={asset.id === selectedAssetId}
                    onSelect={() => {
                      setSelectedAssetId(asset.id);
                      setDetailsOpen(true);
                    }}
                    onAssign={() => setAssignTarget(asset)}
                    onDownload={() => void handleDownload(asset)}
                    onDelete={() => setDeleteTarget(asset)}
                  />
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/[0.07] bg-ink-900">
                <table className="w-full min-w-[640px] text-left" aria-label="Assets table">
                  <thead>
                    <tr className="border-b border-white/[0.08] text-[10px] tracking-wider text-ink-400 uppercase">
                      <th className="py-2.5 pl-3">Asset</th>
                      <th className="px-3">Format</th>
                      <th className="px-3">Dimensions</th>
                      <th className="px-3">Size</th>
                      <th className="px-3">Created</th>
                      <th className="px-3">Usage</th>
                      <th className="py-2.5 pr-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.map((asset) => (
                      <AssetRow
                        key={asset.id}
                        asset={asset}
                        selected={asset.id === selectedAssetId}
                        onSelect={() => {
                          setSelectedAssetId(asset.id);
                          setDetailsOpen(true);
                        }}
                        onAssign={() => setAssignTarget(asset)}
                        onDownload={() => void handleDownload(asset)}
                        onDelete={() => setDeleteTarget(asset)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </main>

          {/* Right Details Panel */}
          {detailsOpen ? (
            <AssetDetailsPanel
              asset={selectedAsset}
              onRename={handleRename}
              onUpdateTags={handleUpdateTags}
              onAssign={() => selectedAsset && setAssignTarget(selectedAsset)}
              onDownload={() => selectedAsset && void handleDownload(selectedAsset)}
              onDelete={() => selectedAsset && setDeleteTarget(selectedAsset)}
              onClose={() => setDetailsOpen(false)}
            />
          ) : null}
        </div>
      </div>
      </div>

      {/* Delete Confirmation Dialog with Deletion Safety */}
      <AssetDeleteDialog
        asset={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleConfirmDelete()}
      />

      {/* Assign Dialog */}
      <AssetAssignDialog
        asset={assignTarget}
        blueprint={blueprint}
        onCancel={() => setAssignTarget(null)}
        onAssign={handleConfirmAssign}
      />

      {/* Toasts */}
      <Toasts
        toasts={toasts}
        onDismiss={dismissToast}
        onUndo={() => undefined}
        canUndo={false}
      />
    </div>
  );
}
