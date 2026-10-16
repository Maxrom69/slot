"use client";

import { useMemo, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import type { GameBlueprint, LayerDef, SceneObject } from "@/lib/blueprint/types";
import { isLinked } from "@/lib/design/model";
import { CommitInput } from "@/components/design/CommitInput";
import { buildResolvers, type Resolvers } from "./SceneObjectView";

export interface LayersPanelActions {
  onSelect: (ids: string[]) => void;
  onToggleVisible: (id: string, current: boolean) => void;
  onToggleLock: (id: string, current: boolean) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (ids: string[]) => void;
  onDelete: (ids: string[]) => void;
  onReorder: (draggedId: string, targetId: string, position: "before" | "after") => void;
  onMoveStep: (id: string, direction: "up" | "down") => void;
  onCreateGroup: (selectedIds: string[]) => void;
  onUngroup: (groupIds: string[]) => void;
  onToggleExpand: (groupId: string) => void;
  onToggleLayerVisible: (layerId: string, current: boolean) => void;
  onToggleLayerLock: (layerId: string, current: boolean) => void;
  onReorderLayer: (sourceId: string, targetId: string, position: "before" | "after") => void;
}

interface Props {
  blueprint: GameBlueprint;
  layers: LayerDef[];
  objects: SceneObject[];
  selection: string[];
  actions: LayersPanelActions;
  onClose?: () => void;
}

interface HierarchyNode {
  id: string;
  name: string;
  kind: string;
  type: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode?: string;
  isGroup: boolean;
  isLayer: boolean;
  groupId?: string | null;
  parentId?: string | null;
  layerId: string;
  expanded?: boolean;
  childCount?: number;
  depth: number;
  object?: SceneObject;
  layer?: LayerDef;
}

function ItemThumbnail({ node, resolvers, blueprint }: { node: HierarchyNode; resolvers: Resolvers; blueprint: GameBlueprint }) {
  const palette = blueprint.style.palette;
  const o = node.object;

  if (node.isGroup) {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-accent-500/15 text-accent-400">
        <Icon name="group" size={13} />
      </span>
    );
  }

  if (node.isLayer) {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-white/5 text-ink-300">
        <Icon name="layers" size={13} />
      </span>
    );
  }

  if (o) {
    const asset = o.assetId ? resolvers.assets.get(o.assetId) : null;
    if (asset && isLinked(asset)) {
      return (
        <span className="relative grid h-6 w-6 shrink-0 overflow-hidden rounded border border-white/10 bg-ink-950">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset.uri} alt="" className="h-full w-full object-contain" />
        </span>
      );
    }

    if (o.kind === "animation") {
      return (
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded border border-accent-500/40 bg-accent-500/15 text-accent-400"
          title="Standalone Animated Layer"
        >
          <Icon name="play" size={11} />
        </span>
      );
    }

    if (o.kind === "symbol") {
      const sym = o.refId ? resolvers.symbols.get(o.refId) : null;
      return (
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded border border-white/10 text-[11px] font-bold"
          style={{ background: `${palette.surface}dd`, color: palette.glow }}
        >
          {sym?.glyph ?? "◆"}
        </span>
      );
    }

    if (o.kind === "shape") {
      return (
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded border text-[10px]"
          style={{
            background: o.fill || "transparent",
            borderColor: o.stroke || "rgba(255,255,255,0.15)",
            color: palette.glow,
          }}
        >
          <Icon name={o.shape === "ellipse" ? "circle" : o.shape === "triangle" ? "triangle" : "square"} size={11} />
        </span>
      );
    }

    if (o.kind === "text") {
      return (
        <span
          className="grid h-6 w-6 shrink-0 place-items-center rounded border border-white/10 text-[10px] font-bold"
          style={{ background: "rgba(255,255,255,0.04)", color: o.fill || palette.text }}
        >
          T
        </span>
      );
    }

    if (o.kind === "stroke") {
      return (
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-white/5 text-ink-300">
          <Icon name={o.arrow ? "arrow" : "line"} size={12} />
        </span>
      );
    }
  }

  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-white/5 text-ink-400">
      <Icon name="image" size={12} />
    </span>
  );
}

export function LayersPanel({ blueprint, layers, objects, selection, actions, onClose }: Props) {
  const [filter, setFilter] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const resolvers = useMemo(() => buildResolvers(blueprint), [blueprint]);

  // Build Top-to-Bottom order (Foreground to Background)
  const items = useMemo<HierarchyNode[]>(() => {
    // 1. Sort blueprint layers in descending order (highest order = foreground = top of panel)
    const sortedLayers = [...layers].sort((a, b) => b.order - a.order);

    const result: HierarchyNode[] = [];

    for (const layer of sortedLayers) {
      // Find objects on this layer (in reverse array order for Top-to-Bottom display)
      const layerObjects = objects.filter((o) => o.layerId === layer.id);

      // Separate root objects and groups
      const rootItems = layerObjects.filter((o) => !o.groupId && !o.parentId);
      // Reverse array order so the top-most rendered is at the top of the list
      const reversedRoots = [...rootItems].reverse();

      for (const item of reversedRoots) {
        if (item.kind === "group") {
          const children = layerObjects.filter((c) => c.groupId === item.id || c.parentId === item.id).reverse();
          result.push({
            id: item.id,
            name: item.name,
            kind: "group",
            type: "group",
            visible: item.visible,
            locked: item.locked,
            opacity: item.opacity,
            blendMode: item.blendMode,
            isGroup: true,
            isLayer: false,
            layerId: layer.id,
            expanded: item.expanded !== false,
            childCount: children.length,
            depth: 0,
            object: item,
          });

          if (item.expanded !== false) {
            for (const child of children) {
              result.push({
                id: child.id,
                name: child.name,
                kind: child.kind,
                type: child.type || child.kind,
                visible: child.visible,
                locked: child.locked,
                opacity: child.opacity,
                blendMode: child.blendMode,
                isGroup: false,
                isLayer: false,
                groupId: item.id,
                parentId: item.id,
                layerId: layer.id,
                depth: 1,
                object: child,
              });
            }
          }
        } else {
          result.push({
            id: item.id,
            name: item.name,
            kind: item.kind,
            type: item.type || item.kind,
            visible: item.visible,
            locked: item.locked,
            opacity: item.opacity,
            blendMode: item.blendMode,
            isGroup: false,
            isLayer: false,
            layerId: layer.id,
            depth: 0,
            object: item,
          });
        }
      }
    }

    return result;
  }, [layers, objects]);

  const filteredItems = useMemo(() => {
    if (!filter.trim()) return items;
    const q = filter.toLowerCase().trim();
    return items.filter((item) => item.name.toLowerCase().includes(q) || item.kind.toLowerCase().includes(q));
  }, [items, filter]);

  const selectedGroups = useMemo(() => {
    return objects.filter((o) => o.kind === "group" && selection.includes(o.id)).map((g) => g.id);
  }, [objects, selection]);

  const canGroup = selection.length > 0;
  const canUngroup = selectedGroups.length > 0 || objects.some((o) => selection.includes(o.id) && (o.groupId || o.parentId));

  const handleRowClick = (node: HierarchyNode, event: React.MouseEvent) => {
    if (event.shiftKey) {
      // Shift-click: toggle in multi-selection
      if (selection.includes(node.id)) {
        actions.onSelect(selection.filter((id) => id !== node.id));
      } else {
        actions.onSelect([...selection, node.id]);
      }
    } else {
      // Single click: select item
      actions.onSelect([node.id]);
    }
  };

  const handleDragStart = (node: HierarchyNode, event: DragEvent) => {
    setDraggedId(node.id);
    event.dataTransfer.setData("application/x-layer-item", node.id);
    event.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (node: HierarchyNode, event: DragEvent) => {
    event.preventDefault();
    if (!draggedId || draggedId === node.id) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = event.clientY < midY ? "before" : "after";

    setDragOverId(node.id);
    setDropPosition(pos);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
    setDropPosition(null);
  };

  const handleDrop = (node: HierarchyNode, event: DragEvent) => {
    event.preventDefault();
    const sourceId = draggedId || event.dataTransfer.getData("application/x-layer-item");
    setDraggedId(null);
    setDragOverId(null);
    setDropPosition(null);

    if (!sourceId || sourceId === node.id || !dropPosition) return;

    // LayersPanel renders Top = Foreground (reverse array order), so dropping visually
    // "before" (above) a row corresponds to placing it "after" (higher render index) in `objects`.
    const arrayPosition = dropPosition === "before" ? "after" : "before";
    if (node.isLayer) {
      actions.onReorderLayer(sourceId, node.id, arrayPosition);
    } else {
      actions.onReorder(sourceId, node.id, arrayPosition);
    }
  };

  const handleGroupAction = () => {
    if (canGroup) {
      actions.onCreateGroup(selection);
    }
  };

  const handleUngroupAction = () => {
    if (selectedGroups.length > 0) {
      actions.onUngroup(selectedGroups);
    } else {
      // find groups of selected children
      const parentGroups = Array.from(
        new Set(objects.filter((o) => selection.includes(o.id) && o.groupId).map((o) => o.groupId!))
      );
      if (parentGroups.length > 0) {
        actions.onUngroup(parentGroups);
      }
    }
  };

  return (
    <aside
      aria-label="Layers panel"
      className="flex h-full min-h-0 w-full flex-col bg-ink-900"
    >
      {/* Top Header & Actions */}
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-white/[0.07] px-3">
        <div className="flex items-center gap-2">
          <Icon name="layers" size={15} className="text-ink-300" />
          <h2 className="text-[11px] font-semibold tracking-[0.14em] text-ink-200 uppercase">
            Layers
          </h2>
          <span className="rounded border border-white/10 bg-white/5 px-1.5 py-px font-mono text-[9.5px] text-ink-400">
            {items.length}
          </span>
        </div>

        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close layers panel"
            className="focus-ring rounded p-1 text-ink-400 hover:text-ink-100 xl:hidden"
          >
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </header>

      {/* Layer Tools & Actions Bar */}
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-white/[0.06] bg-ink-950/40 px-2 py-1.5">
        <div className="flex items-center gap-1">
          <Button
            className="h-7 px-2 text-[10.5px]"
            disabled={!canGroup}
            onClick={handleGroupAction}
            title={canGroup ? "Create group from selection" : "Select objects to group"}
          >
            <Icon name="group" size={12} />
            Group
          </Button>

          <Button
            className="h-7 px-2 text-[10.5px]"
            disabled={!canUngroup}
            onClick={handleUngroupAction}
            title={canUngroup ? "Ungroup selected group" : "Select a group to ungroup"}
          >
            <Icon name="ungroup" size={12} />
            Ungroup
          </Button>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={selection.length === 0}
            onClick={() => selection[0] && actions.onMoveStep(selection[0], "up")}
            aria-label="Move layer up (foreground)"
            title="Move up (towards foreground)"
            className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 transition hover:bg-white/5 hover:text-ink-100 disabled:opacity-30"
          >
            <Icon name="arrow-up" size={13} />
          </button>

          <button
            type="button"
            disabled={selection.length === 0}
            onClick={() => selection[0] && actions.onMoveStep(selection[0], "down")}
            aria-label="Move layer down (background)"
            title="Move down (towards background)"
            className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 transition hover:bg-white/5 hover:text-ink-100 disabled:opacity-30"
          >
            <Icon name="arrow-down" size={13} />
          </button>

          <button
            type="button"
            disabled={selection.length === 0}
            onClick={() => actions.onDuplicate(selection)}
            aria-label="Duplicate selected layer"
            title="Duplicate layer"
            className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 transition hover:bg-white/5 hover:text-ink-100 disabled:opacity-30"
          >
            <Icon name="copy" size={13} />
          </button>

          <button
            type="button"
            disabled={selection.length === 0}
            onClick={() => actions.onDelete(selection)}
            aria-label="Delete selected layer"
            title="Delete layer"
            className="focus-ring grid h-7 w-7 place-items-center rounded text-ink-300 transition hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-30"
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>

      {/* Filter / Search Input */}
      <div className="shrink-0 border-b border-white/[0.06] p-2">
        <div className="relative">
          <Icon name="search" size={12} className="pointer-events-none absolute top-2 left-2.5 text-ink-400" />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter layers"
            placeholder="Filter layers by name..."
            className="focus-ring w-full rounded border border-white/10 bg-ink-950/70 py-1 pr-2.5 pl-7 text-[11px] text-ink-100 placeholder:text-ink-400/60 hover:border-white/20"
          />
        </div>
      </div>

      {/* Layer Stack Order Notice */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/[0.04] bg-white/[0.01] px-3 py-1 text-[9px] text-ink-400">
        <span>▲ Foreground (Top)</span>
        <span>Background (Bottom) ▼</span>
      </div>

      {/* Layer Rows List */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 space-y-0.5" role="tree" aria-label="Layer hierarchy">
        {filteredItems.length === 0 ? (
          <div className="p-6 text-center text-[11px] text-ink-400">
            {filter ? "No layers match your search filter." : "No layers on this scene yet."}
          </div>
        ) : (
          filteredItems.map((node) => {
            const isSelected = selection.includes(node.id);
            const isDragTarget = dragOverId === node.id;
            const isEditing = editingId === node.id;

            return (
              <div
                key={node.id}
                role="treeitem"
                data-layer-row-id={node.id}
                aria-selected={isSelected}
                draggable={!isEditing}
                onDragStart={(e) => handleDragStart(node, e)}
                onDragOver={(e) => handleDragOver(node, e)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(node, e)}
                onClick={(e) => handleRowClick(node, e)}
                onDoubleClick={() => !node.isLayer && setEditingId(node.id)}
                className={`group relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] transition cursor-pointer select-none ${
                  isSelected
                    ? "border border-accent-500/60 bg-accent-500/15 text-ink-100"
                    : "border border-transparent hover:bg-white/[0.04] text-ink-300"
                } ${
                  isDragTarget && dropPosition === "before"
                    ? "border-t-2 border-t-accent-400"
                    : isDragTarget && dropPosition === "after"
                    ? "border-b-2 border-b-accent-400"
                    : ""
                }`}
                style={{ paddingLeft: `${6 + node.depth * 14}px` }}
              >
                {/* Drag Handle */}
                <span
                  title="Drag to reorder"
                  className="grid h-5 w-4 shrink-0 place-items-center text-ink-500 hover:text-ink-200 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Icon name="drag" size={11} />
                </span>

                {/* Expand/Collapse Chevron (for Groups) */}
                {node.isGroup ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.onToggleExpand(node.id);
                    }}
                    aria-label={node.expanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                    className="focus-ring grid h-5 w-5 shrink-0 place-items-center rounded text-ink-400 hover:text-ink-100"
                  >
                    <Icon
                      name="chevron-right"
                      size={12}
                      className={`transition-transform ${node.expanded ? "rotate-90" : ""}`}
                    />
                  </button>
                ) : (
                  <span className="w-2" />
                )}

                {/* Thumbnail Preview */}
                <ItemThumbnail node={node} resolvers={resolvers} blueprint={blueprint} />

                {/* Name & Type */}
                <div className="min-w-0 flex-1 truncate">
                  {isEditing ? (
                    <div onClick={(e) => e.stopPropagation()}>
                      <CommitInput
                        value={node.name}
                        label="Rename layer"
                        className="h-6 py-0 text-[11px]"
                        onCommit={(newName) => {
                          setEditingId(null);
                          actions.onRename(node.id, newName);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <span className={`truncate font-medium ${isSelected ? "text-ink-100" : "text-ink-200"}`}>
                        {node.name}
                      </span>
                      {node.isGroup && node.childCount !== undefined ? (
                        <span className="shrink-0 font-mono text-[9px] text-ink-400">
                          ({node.childCount})
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Action Buttons: Visibility, Lock, Duplicate & Delete */}
                <div className="flex shrink-0 items-center gap-0.5">
                  {/* Visibility Toggle */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (node.isLayer) {
                        actions.onToggleLayerVisible(node.id, node.visible);
                      } else {
                        actions.onToggleVisible(node.id, node.visible);
                      }
                    }}
                    aria-label={node.visible ? `Hide ${node.name}` : `Show ${node.name}`}
                    title={node.visible ? "Visible (click to hide)" : "Hidden (click to show)"}
                    className={`focus-ring grid h-6 w-6 place-items-center rounded transition ${
                      node.visible
                        ? "text-ink-400 hover:text-ink-100 opacity-0 group-hover:opacity-100"
                        : "text-amber-400/80 hover:text-amber-300 opacity-100"
                    }`}
                  >
                    <Icon name={node.visible ? "eye" : "eye-off"} size={13} />
                  </button>

                  {/* Lock Toggle */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (node.isLayer) {
                        actions.onToggleLayerLock(node.id, node.locked);
                      } else {
                        actions.onToggleLock(node.id, node.locked);
                      }
                    }}
                    aria-label={node.locked ? `Unlock ${node.name}` : `Lock ${node.name}`}
                    title={node.locked ? "Locked (click to unlock)" : "Unlocked (click to lock)"}
                    className={`focus-ring grid h-6 w-6 place-items-center rounded transition ${
                      node.locked
                        ? "text-amber-400/90 hover:text-amber-300 opacity-100"
                        : "text-ink-400 hover:text-ink-100 opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <Icon name={node.locked ? "lock" : "unlock"} size={13} />
                  </button>

                  {/* Row Duplicate */}
                  {!node.isLayer ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.onDuplicate([node.id]);
                      }}
                      aria-label={`Duplicate ${node.name}`}
                      title={`Duplicate ${node.name}`}
                      className="focus-ring grid h-6 w-6 place-items-center rounded text-ink-400 opacity-0 transition group-hover:opacity-100 hover:text-ink-100"
                    >
                      <Icon name="copy" size={12} />
                    </button>
                  ) : null}

                  {/* Row Delete */}
                  {!node.isLayer ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.onDelete([node.id]);
                      }}
                      aria-label={`Delete ${node.name}`}
                      title={`Delete ${node.name}`}
                      className="focus-ring grid h-6 w-6 place-items-center rounded text-ink-400 opacity-0 transition group-hover:opacity-100 hover:text-rose-300"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Layer Count Info */}
      <footer className="flex shrink-0 items-center justify-between border-t border-white/[0.06] bg-ink-950/40 px-3 py-2 text-[10px] text-ink-400">
        <span>{selection.length} selected</span>
        <span>Shift+Click multi-select</span>
      </footer>
    </aside>
  );
}
