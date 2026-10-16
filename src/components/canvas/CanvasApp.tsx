"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toasts } from "@/components/ui/Toasts";
import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";
import type { GameBlueprint, LayerDef, SceneObject } from "@/lib/blueprint/types";
import { clampScale, fitViewport, toWorld, MAX_SCALE, MIN_SCALE, type Viewport } from "@/lib/canvas/geometry";
import {
  alignObjects, createGroup, deleteObjects, distributeObjects, duplicateObjects, moveLayerItemToIndex,
  moveObjects, nudgeDelta, patchObject, reorderBlueprintLayers, reorderLayerItem, reorderObjects,
  toggleGroupExpand, toggleLayer, ungroup, type AlignMode,
} from "@/lib/canvas/operations";
import { createStandaloneAnimationSceneObject, normalizeAnimationModel } from "@/lib/animations";
import { createRefObject } from "@/lib/canvas/create";
import { SHORTCUT_TO_TOOL, isCreateTool, type ToolId } from "@/lib/canvas/tools";
import { canvasApi } from "@/lib/client/design-api";
import { useCanvasEditor } from "@/lib/client/useCanvasEditor";
import {
  addSceneToState,
  buildSceneSelectorCards,
  createSceneCompositionState,
  deleteSceneFromState,
  duplicateSceneInState,
  getEffectiveSceneModel,
  isSceneDirty,
  renameSceneInState,
  requestSceneSwitch,
  resolveUnsavedSceneSwitch,
  saveActiveSceneLayout,
  syncScenesListToBlueprint,
  updateSceneLayoutDraft,
  type SceneCompositionWorkspaceState,
  type UnsavedSwitchResolution,
} from "@/lib/scenes";
import { CanvasStage, type CanvasPrefs } from "./CanvasStage";
import { CanvasTopBar } from "./CanvasTopBar";
import { ObjectInspector } from "./ObjectInspector";
import { ScenePanel } from "./ScenePanel";
import { SceneSelectorCards } from "./SceneSelectorCards";
import { LayersPanel, type LayersPanelActions } from "./LayersPanel";

export interface CanvasAppProps {
  project: { id: string; title: string };
  blueprint: GameBlueprint;
  revision: number;
}

interface PrefsState extends CanvasPrefs {
  rightSidebarTab: "layers" | "inspector";
}
const DEFAULT_PREFS: PrefsState = {
  gridVisible: true,
  gridSize: 40,
  gridSnap: false,
  safeArea: true,
  snapping: true,
  rightSidebarTab: "layers",
};
const DEFAULT_PAINT = { fill: "#3b82f6", stroke: "#e8edf5" };

/** Per-element default placement size, derived from the element's role. */
function placeSize(type: string, scene: { width: number; height: number }): { width: number; height: number } {
  switch (type) {
    case "game_background": return { width: scene.width, height: scene.height };
    case "reel_frame": return { width: Math.round(scene.width * 0.72), height: Math.round(scene.height * 0.62) };
    case "game_title": return { width: Math.round(scene.width * 0.42), height: Math.round(scene.height * 0.16) };
    case "button_set": return { width: Math.round(scene.width * 0.22), height: Math.round(scene.height * 0.09) };
    case "symbol_set": return { width: Math.round(scene.width * 0.2), height: Math.round(scene.width * 0.2) };
    default: return { width: 320, height: 240 };
  }
}

export function CanvasApp({ project, blueprint, revision }: CanvasAppProps) {
  const [liveBlueprint, setLiveBlueprint] = useState<GameBlueprint>(blueprint);
  const [liveRevision, setLiveRevision] = useState<number>(revision);
  const [sceneState, setSceneState] = useState<SceneCompositionWorkspaceState>(() =>
    createSceneCompositionState(blueprint),
  );
  const [prefs, setPrefs] = useState<PrefsState>(DEFAULT_PREFS);
  const prefsKey = `studio.canvas.prefs.${project.id}`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(prefsKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as Partial<PrefsState>;
      queueMicrotask(() => {
        setPrefs((current) => ({
          gridVisible: typeof stored.gridVisible === "boolean" ? stored.gridVisible : current.gridVisible,
          gridSize: typeof stored.gridSize === "number" && stored.gridSize >= 8 && stored.gridSize <= 200 ? stored.gridSize : current.gridSize,
          gridSnap: typeof stored.gridSnap === "boolean" ? stored.gridSnap : current.gridSnap,
          safeArea: typeof stored.safeArea === "boolean" ? stored.safeArea : current.safeArea,
          snapping: typeof stored.snapping === "boolean" ? stored.snapping : current.snapping,
          rightSidebarTab: stored.rightSidebarTab === "inspector" ? "inspector" : "layers",
        }));
      });
    } catch { /* unreadable preferences fall back to defaults */ }
  }, [prefsKey]);

  const updatePrefs = useCallback((patch: Partial<PrefsState>) => {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      try { window.localStorage.setItem(prefsKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
      return next;
    });
  }, [prefsKey]);

  const scenes = useMemo(
    () =>
      sceneState.scenes.map((scene) => ({
        id: scene.id,
        name: sceneState.draftsBySceneId[scene.id]?.draft.name ?? scene.name,
        kind: scene.kind,
      })),
    [sceneState],
  );

  return (
    <CanvasWorkspace
      key={sceneState.activeSceneId}
      project={project}
      blueprint={liveBlueprint}
      sceneId={sceneState.activeSceneId}
      scenes={scenes}
      sceneState={sceneState}
      onSceneState={setSceneState}
      onBlueprint={setLiveBlueprint}
      revision={liveRevision}
      onRevision={setLiveRevision}
      prefs={prefs}
      onPrefs={updatePrefs}
    />
  );
}

interface WorkspaceProps {
  project: { id: string; title: string };
  blueprint: GameBlueprint;
  sceneId: string;
  scenes: Array<{ id: string; name: string; kind: string }>;
  sceneState: SceneCompositionWorkspaceState;
  onSceneState: React.Dispatch<React.SetStateAction<SceneCompositionWorkspaceState>>;
  onBlueprint: React.Dispatch<React.SetStateAction<GameBlueprint>>;
  revision: number;
  onRevision: React.Dispatch<React.SetStateAction<number>>;
  prefs: PrefsState;
  onPrefs: (patch: Partial<PrefsState>) => void;
}

function CanvasWorkspace({
  project,
  blueprint,
  sceneId,
  scenes,
  sceneState,
  onSceneState,
  onBlueprint,
  revision,
  onRevision,
  prefs,
  onPrefs,
}: WorkspaceProps) {
  const effectiveScene = useMemo(
    () => getEffectiveSceneModel(sceneState, sceneId, blueprint),
    [sceneState, sceneId, blueprint],
  );
  const scene = blueprint.scenes.find((s) => s.id === sceneId) ?? blueprint.scenes[0];
  const editor = useCanvasEditor({
    projectId: project.id,
    sceneId,
    initial: {
      objects: effectiveScene?.objects ?? scene?.objects ?? [],
      background:
        effectiveScene?.background ??
        scene?.background ?? { color: blueprint.style.palette.background, assetId: null },
      layers:
        effectiveScene?.layers && effectiveScene.layers.length > 0
          ? effectiveScene.layers
          : blueprint.layers,
    },
    initialRevision: revision,
  });
  const { content } = editor;

  // Keep per-scene draft in sync with active canvas edits
  useEffect(() => {
    onSceneState((prev) =>
      updateSceneLayoutDraft(
        prev,
        sceneId,
        (draft) => ({
          ...draft,
          objects: content.objects,
          background: content.background,
          layers: content.layers,
        }),
        blueprint,
      ),
    );
  }, [content, sceneId, blueprint, onSceneState]);

  const persistScenesRoster = useCallback(
    async (nextState: SceneCompositionWorkspaceState, targetSceneId: string) => {
      const nextBp = syncScenesListToBlueprint(blueprint, nextState);
      onBlueprint(nextBp);
      const targetModel =
        getEffectiveSceneModel(nextState, targetSceneId, nextBp) ?? nextState.scenes[0]!;
      try {
        const res = await canvasApi.save(project.id, {
          baseRevision: editor.getRevision(),
          sceneId: targetModel.id,
          name: targetModel.name,
          objects: targetModel.objects,
          background: targetModel.background,
          layers: targetModel.layers,
          canvasConfiguration: targetModel.canvasConfiguration,
          visibility: targetModel.visibility,
          composedImages: targetModel.composedImages,
          layoutMetadata: targetModel.layoutMetadata,
          scenes: nextBp.scenes,
        });
        editor.setRevision(res.revision);
        onRevision(res.revision);
      } catch {
        // Toast handled if needed; local state remains interactive
      }
    },
    [blueprint, editor, onBlueprint, onRevision, project.id],
  );

  const handleSelectScene = useCallback(
    (targetId: string) => {
      const res = requestSceneSwitch(sceneState, targetId);
      onSceneState(res.state);
      if (res.switchedImmediately) {
        onRevision(editor.getRevision());
      }
    },
    [sceneState, onSceneState, onRevision, editor],
  );

  const handleResolveUnsavedSwitch = useCallback(
    (resolution: UnsavedSwitchResolution) => {
      if (resolution === "save") {
        void editor.flush().then(() => {
          const resolved = resolveUnsavedSceneSwitch(sceneState, blueprint, "save");
          onSceneState(resolved.state);
          onBlueprint(resolved.blueprint);
          onRevision(editor.getRevision());
        });
        return;
      }
      if (resolution === "discard") {
        editor.resetToSaved();
      }
      const resolved = resolveUnsavedSceneSwitch(sceneState, blueprint, resolution);
      onSceneState(resolved.state);
      onBlueprint(resolved.blueprint);
      onRevision(editor.getRevision());
    },
    [sceneState, blueprint, editor, onSceneState, onBlueprint, onRevision],
  );

  const handleAddScene = useCallback(
    (slotLabel?: string) => {
      const res = addSceneToState(sceneState, blueprint, {
        name: slotLabel,
        activate: false,
      });
      if (!res.ok) {
        editor.pushToast(res.error ?? "Cannot add scene.", "error");
        return;
      }
      onSceneState(res.state);
      void persistScenesRoster(res.state, res.state.activeSceneId);
      editor.pushToast(`Added ${res.addedScene?.name ?? "scene"}.`, "info");
    },
    [sceneState, blueprint, editor, onSceneState, persistScenesRoster],
  );

  const handleDuplicateScene = useCallback(
    (sourceId: string) => {
      const res = duplicateSceneInState(sceneState, blueprint, sourceId);
      if (!res.ok) {
        editor.pushToast(res.error ?? "Cannot duplicate scene.", "error");
        return;
      }
      onSceneState(res.state);
      void persistScenesRoster(res.state, res.state.activeSceneId);
      editor.pushToast(`Duplicated as "${res.duplicatedScene?.name}".`, "info");
    },
    [sceneState, blueprint, editor, onSceneState, persistScenesRoster],
  );

  const handleRenameScene = useCallback(
    (targetId: string, newName: string): { ok: boolean; error?: string } => {
      const res = renameSceneInState(sceneState, targetId, newName);
      if (!res.ok) return { ok: false, error: res.error };
      onSceneState(res.state);
      void persistScenesRoster(res.state, res.state.activeSceneId);
      return { ok: true };
    },
    [sceneState, onSceneState, persistScenesRoster],
  );

  const handleDeleteScene = useCallback(
    (targetId: string) => {
      const res = deleteSceneFromState(sceneState, targetId);
      if (!res.ok) {
        editor.pushToast(res.error ?? "Cannot delete scene.", "error");
        return;
      }
      onSceneState(res.state);
      void persistScenesRoster(res.state, res.state.activeSceneId);
      editor.pushToast("Scene deleted.", "info");
    },
    [sceneState, editor, onSceneState, persistScenesRoster],
  );

  const handleSaveActiveLayout = useCallback(() => {
    const saved = saveActiveSceneLayout(sceneState, blueprint);
    onSceneState(saved.state);
    onBlueprint(saved.blueprint);
    void editor.flush().then(() => {
      onRevision(editor.getRevision());
      editor.pushToast(`Saved layout for "${saved.savedScene.name}".`, "info");
    });
  }, [sceneState, blueprint, editor, onSceneState, onBlueprint, onRevision]);

  const selectorCards = useMemo(
    () => buildSceneSelectorCards(sceneState, blueprint),
    [sceneState, blueprint],
  );
  const activeSceneDirty =
    isSceneDirty(sceneState, sceneId) || editor.saveState === "dirty";

  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<ToolId>("select");
  const [viewport, setViewport] = useState<Viewport>({ scale: 1, x: 0, y: 0 });
  const [paint, setPaint] = useState<{ fill: string | null; stroke: string | null }>(DEFAULT_PAINT);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const lastStageSize = useRef<{ w: number; h: number } | null>(null);

  const frame = useMemo(() => ({ x: 0, y: 0, w: blueprint.canvas.width, h: blueprint.canvas.height }), [blueprint.canvas]);

  const fit = useCallback(() => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect) return;
    lastStageSize.current = { w: rect.width, h: rect.height };
    setViewport((current) => fitViewport(current, frame, { w: rect.width, h: rect.height }));
  }, [frame]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const applyFit = (w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      const prev = lastStageSize.current;
      if (prev && Math.abs(prev.w - w) < 2 && Math.abs(prev.h - h) < 2) return;
      lastStageSize.current = { w, h };
      setViewport((current) => fitViewport(current, frame, { w, h }));
    };
    const rect = el.getBoundingClientRect();
    applyFit(rect.width, rect.height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      applyFit(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [frame]);

  const zoomAt = useCallback((scale: number) => {
    const rect = area.current?.getBoundingClientRect();
    if (!rect) {
      setViewport((current) => ({ ...current, scale: clampScale(scale) }));
      return;
    }
    setViewport((current) => {
      const center = toWorld(current, { x: rect.width / 2, y: rect.height / 2 });
      const next = clampScale(scale);
      return { scale: next, x: rect.width / 2 - center.x * next, y: rect.height / 2 - center.y * next };
    });
  }, []);

  const selectable = useCallback(
    (ids: string[]) => content.objects.filter((o) => ids.includes(o.id) && o.visible && !o.locked).map((o) => o.id),
    [content.objects],
  );

  const create = useCallback((objects: SceneObject[], label: string) => {
    if (objects.length === 0) return;
    editor.apply(label, (current) => ({ ...current, objects: [...current.objects, ...objects] }));
    setSelection(objects.map((o) => o.id));
    if (!isCreateTool(tool)) setTool("select");
    editor.pushToast(`Added ${objects[0].name}`, "success");
  }, [editor, tool]);

  const patch = useCallback((ids: string[], change: Partial<SceneObject>, label: string, key?: string) => {
    editor.apply(label, (current) => ({ ...current, objects: ids.reduce((acc, id) => patchObject(acc, id, change), current.objects) }), { key });
  }, [editor]);

  const requestDelete = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const names = content.objects.filter((o) => ids.includes(o.id)).map((o) => o.name);
    editor.apply(`Delete ${names.length === 1 ? names[0] : `${names.length} objects`}`, (current) => ({ ...current, objects: deleteObjects(current.objects, ids) }));
    setSelection([]);
    editor.pushToast(`Deleted ${names.length === 1 ? `“${names[0]}”` : `${names.length} objects`}`, "info", true);
  }, [content.objects, editor]);

  const duplicate = useCallback(() => {
    if (selection.length === 0) return;
    const result = duplicateObjects(content.objects, selection);
    editor.apply(`Duplicate ${selection.length === 1 ? content.objects.find((o) => o.id === selection[0])?.name ?? "object" : `${selection.length} objects`}`,
      (current) => ({ ...current, objects: result.objects }));
    setSelection(result.ids);
    editor.pushToast("Duplicated selection", "success", true);
  }, [content.objects, editor, selection]);

  const reorder = useCallback((order: "front" | "forward" | "backward" | "back") => {
    const picked = selectable(selection);
    if (picked.length === 0) return;
    editor.apply("Reorder objects", (current) => ({ ...current, objects: picked.reduce((acc, id) => reorderObjects(acc, id, order), current.objects) }));
  }, [editor, selectable, selection]);

  const align = useCallback((mode: AlignMode) => {
    const picked = selectable(selection);
    if (picked.length === 0) return;
    editor.apply("Align objects", (current) => ({ ...current, objects: alignObjects(current.objects, picked, mode, frame) }));
  }, [editor, frame, selectable, selection]);

  const distribute = useCallback((axis: "x" | "y") => {
    const picked = selectable(selection);
    if (picked.length < 3) return;
    editor.apply("Distribute objects", (current) => ({ ...current, objects: distributeObjects(current.objects, picked, axis) }));
  }, [editor, selectable, selection]);

  const changeLayer = useCallback((id: string, change: Partial<LayerDef>) => {
    editor.apply("Update layer", (current) => ({ ...current, layers: toggleLayer(current.layers, id, change) }));
  }, [editor]);

  const changeBackground = useCallback((color: string | null) => {
    editor.apply("Change scene background", (current) => ({
      ...current,
      background: { ...current.background, color },
    }));
  }, [editor]);

  /* ------------------- Group & Layer Actions for LayersPanel ------------------- */

  const handleCreateGroup = useCallback((selectedIds: string[]) => {
    if (selectedIds.length === 0) return;
    let createdGroupId = "";
    editor.apply("Create Group", (current) => {
      const res = createGroup(current.objects, selectedIds);
      createdGroupId = res.groupId;
      return { ...current, objects: res.objects };
    });
    if (createdGroupId) {
      setSelection([createdGroupId]);
      editor.pushToast("Created group", "success");
    }
  }, [editor]);

  const handleUngroup = useCallback((groupIds: string[]) => {
    if (groupIds.length === 0) return;
    let released: string[] = [];
    editor.apply("Ungroup", (current) => {
      const res = ungroup(current.objects, groupIds);
      released = res.releasedIds;
      return { ...current, objects: res.objects };
    });
    if (released.length > 0) {
      setSelection(released);
      editor.pushToast("Ungrouped", "info");
    }
  }, [editor]);

  const handleRename = useCallback((id: string, newName: string) => {
    if (!newName.trim()) return;
    patch([id], { name: newName.trim() }, `Rename to ${newName}`);
  }, [patch]);

  const handleReorderLayerItem = useCallback((draggedId: string, targetId: string, position: "before" | "after") => {
    editor.apply("Reorder Layer Item", (current) => ({
      ...current,
      objects: moveLayerItemToIndex(current.objects, draggedId, targetId, position),
    }));
  }, [editor]);

  const handleMoveStep = useCallback((id: string, direction: "up" | "down") => {
    editor.apply(`Move ${direction === "up" ? "Up" : "Down"}`, (current) => ({
      ...current,
      objects: reorderLayerItem(current.objects, id, direction),
    }));
  }, [editor]);

  const handleToggleGroupExpand = useCallback((groupId: string) => {
    editor.apply("Toggle Group", (current) => ({
      ...current,
      objects: toggleGroupExpand(current.objects, groupId),
    }));
  }, [editor]);

  const handleReorderBlueprintLayer = useCallback((sourceId: string, targetId: string, position: "before" | "after") => {
    editor.apply("Reorder Layer", (current) => ({
      ...current,
      layers: reorderBlueprintLayers(current.layers, sourceId, targetId, position),
    }));
  }, [editor]);

  const layersPanelActions: LayersPanelActions = useMemo(() => ({
    onSelect: (ids) => setSelection(ids),
    onToggleVisible: (id, current) => patch([id], { visible: !current }, "Toggle visibility"),
    onToggleLock: (id, current) => patch([id], { locked: !current }, "Toggle lock"),
    onRename: handleRename,
    onDuplicate: (ids) => {
      if (ids.length === 0) return;
      const res = duplicateObjects(content.objects, ids);
      editor.apply("Duplicate layer", (curr) => ({ ...curr, objects: res.objects }));
      setSelection(res.ids);
      editor.pushToast("Duplicated layer", "success", true);
    },
    onDelete: requestDelete,
    onReorder: handleReorderLayerItem,
    onMoveStep: handleMoveStep,
    onCreateGroup: handleCreateGroup,
    onUngroup: handleUngroup,
    onToggleExpand: handleToggleGroupExpand,
    onToggleLayerVisible: (layerId, current) => changeLayer(layerId, { visible: !current }),
    onToggleLayerLock: (layerId, current) => changeLayer(layerId, { locked: !current }),
    onReorderLayer: handleReorderBlueprintLayer,
  }), [handleRename, content.objects, editor, requestDelete, handleReorderLayerItem, handleMoveStep, handleCreateGroup, handleUngroup, handleToggleGroupExpand, changeLayer, handleReorderBlueprintLayer, patch]);

  const place = useCallback((kind: "symbol" | "element" | "animation", refId: string) => {
    const rect = area.current?.getBoundingClientRect();
    const at = rect ? toWorld(viewport, { x: rect.width / 2, y: rect.height / 2 }) : { x: frame.w / 2, y: frame.h / 2 };
    const layerId = content.layers.find((l) => !l.locked)?.id ?? content.layers[0]?.id;
    if (!layerId) return;

    if (kind === "animation") {
      const rawAnim = (blueprint.animations ?? []).find((a) => a.id === refId);
      if (!rawAnim) return;
      const anim = normalizeAnimationModel(rawAnim, blueprint.elements, blueprint.assets);
      const animObj = createStandaloneAnimationSceneObject(anim, {
        layerId,
        sequence: content.objects.length + 1,
        canvasSize: { width: frame.w, height: frame.h },
      });
      const positioned: SceneObject = {
        ...animObj,
        x: Math.round(at.x - animObj.width / 2),
        y: Math.round(at.y - animObj.height / 2),
      };
      create([positioned], `Place animation ${anim.name}`);
      return;
    }

    let name = refId;
    let size = { width: 200, height: 200 };
    let assetId: string | null = null;
    if (kind === "symbol") {
      const symbol = blueprint.symbols.find((s) => s.id === refId);
      if (!symbol) return;
      name = symbol.name;
      size = { width: Math.round(frame.w * 0.12), height: Math.round(frame.w * 0.12) };
      assetId = symbol.assetId;
    } else {
      const element = blueprint.elements.find((e) => e.id === refId);
      if (!element) return;
      name = element.name;
      size = placeSize(element.type, { width: frame.w, height: frame.h });
      assetId = element.assetId;
    }
    create([createRefObject({
      sequence: content.objects.length + 1,
      layerId,
      refKind: kind,
      refId,
      name,
      at,
      size,
      assetId: assetId && blueprint.assets.some((a) => a.id === assetId) ? assetId : null,
    })], `Place ${name}`);
  }, [blueprint, content.layers, content.objects.length, create, frame, viewport]);

  /* -------------------------------- keyboard -------------------------------- */
  const live = useRef({ tool, selection, viewport, content });
  useEffect(() => {
    live.current = { tool, selection, viewport, content };
  });

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      return !!el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === "Space" && !isTyping(event.target)) {
        setSpaceHeld(true);
        event.preventDefault();
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key;
      const S = live.current;

      if (meta && key.toLowerCase() === "z") { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); return; }
      if (meta && key.toLowerCase() === "y") { event.preventDefault(); editor.redo(); return; }
      if (meta && key.toLowerCase() === "s") { event.preventDefault(); void editor.flush(); return; }
      if (meta && key.toLowerCase() === "d") { event.preventDefault(); duplicate(); return; }
      if (meta && key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) {
          handleUngroup(S.selection);
        } else {
          handleCreateGroup(S.selection);
        }
        return;
      }
      if (meta && key.toLowerCase() === "a") {
        event.preventDefault();
        setSelection(content.objects.filter((o) => o.visible && !o.locked).map((o) => o.id));
        return;
      }
      if (meta) return;
      if (isTyping(event.target)) return;

      if (key === "Escape") { setSelection([]); return; }
      if (key === "Delete" || key === "Backspace") {
        if (S.selection.length === 0) return;
        event.preventDefault();
        requestDelete(S.selection);
        return;
      }
      if (key.startsWith("Arrow")) {
        if (S.selection.length === 0) return;
        event.preventDefault();
        const delta = nudgeDelta(key as "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", event.shiftKey);
        editor.apply("Nudge selection", (current) => ({ ...current, objects: moveObjects(current.objects, S.selection, delta) }), { key: "nudge" });
        return;
      }
      if (key === "+" || key === "=") { event.preventDefault(); zoomAt(S.viewport.scale * 1.2); return; }
      if (key === "-" || key === "_") { event.preventDefault(); zoomAt(S.viewport.scale / 1.2); return; }
      if (key === "0") { event.preventDefault(); zoomAt(1); return; }
      if (event.shiftKey && key === "!") { event.preventDefault(); fit(); return; }
      if (key.length === 1) {
        const next = SHORTCUT_TO_TOOL[key.toLowerCase()];
        if (next && next !== S.tool) setTool(next);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [editor, duplicate, requestDelete, fit, zoomAt, content.objects, handleCreateGroup, handleUngroup]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden">
      <ProjectTopNav projectId={project.id} projectTitle={project.title} />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {navOpen ? <button type="button" aria-label="Close panel" className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setNavOpen(false)} /> : null}

        <aside aria-label="Canvas panel"
          className={`fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col border-r border-white/[0.07] bg-ink-900 transition-transform lg:static lg:z-auto lg:translate-x-0 ${navOpen ? "translate-x-0" : "invisible -translate-x-full lg:visible"}`}>
          <ScenePanel
            blueprint={blueprint}
            layers={content.layers}
            objects={content.objects}
            sceneId={sceneId}
            scenes={scenes}
            selection={selection}
            prefs={prefs}
            onScene={(id) => {
              setNavOpen(false);
              handleSelectScene(id);
            }}
            onLayer={(id, patch) => changeLayer(id, patch)}
            onPlace={place}
            onSelectObject={(id) => setSelection([id])}
            onPrefs={(patch) => onPrefs(patch)}
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <CanvasTopBar
            project={project}
            sceneName={effectiveScene?.name ?? scene?.name ?? "Scene"}
            saveState={editor.saveState}
            saveError={editor.saveError}
            canUndo={editor.canUndo}
            canRedo={editor.canRedo}
            tool={tool}
            viewport={viewport}
            gridVisible={prefs.gridVisible}
            snapping={prefs.snapping}
            safeArea={prefs.safeArea}
            navOpen={navOpen}
            inspectorOpen={inspectorOpen}
            onTool={setTool}
            onUndo={editor.undo}
            onRedo={editor.redo}
            onRetry={() => void editor.flush()}
            onZoom={zoomAt}
            onFit={fit}
            onActual={() => zoomAt(1)}
            onToggle={(patch) => onPrefs(patch)}
            onToggleNav={() => setNavOpen((open) => !open)}
            onToggleInspector={() => setInspectorOpen((open) => !open)}
          />

          <SceneSelectorCards
            cards={selectorCards}
            activeSceneId={sceneId}
            activeSceneDirty={activeSceneDirty}
            pendingSwitch={sceneState.pendingSceneSwitch}
            sharedGlobalConfig={sceneState.sharedGlobalConfig}
            saving={editor.saveState === "saving"}
            compact
            onSelectScene={handleSelectScene}
            onAddScene={handleAddScene}
            onDuplicateScene={handleDuplicateScene}
            onRenameScene={handleRenameScene}
            onDeleteScene={handleDeleteScene}
            onSaveActiveLayout={handleSaveActiveLayout}
            onResolveUnsavedSwitch={handleResolveUnsavedSwitch}
          />

          {editor.saveState === "conflict" ? (
            <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-[11.5px] text-rose-100">
              <Icon name="alert" size={14} />
              <p className="min-w-0 flex-1">This scene was changed in another tab or window. Your latest edits here are not saved.</p>
              <Button className="h-7 text-[11px]" onClick={() => window.location.reload()}>Reload latest</Button>
              <Button variant="danger" className="h-7 text-[11px]" onClick={editor.overwrite}>Overwrite with my version</Button>
            </div>
          ) : null}
          {editor.saveState === "error" ? (
            <div role="alert" className="flex items-center gap-3 border-b border-amber-400/25 bg-amber-400/10 px-4 py-2 text-[11.5px] text-amber-100">
              <Icon name="alert" size={14} /><p>Changes could not be saved: {editor.saveError}</p>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div ref={area} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <CanvasStage
                blueprint={blueprint}
                layers={content.layers}
                objects={content.objects}
                background={content.background}
                scene={{ id: sceneId, width: blueprint.canvas.width, height: blueprint.canvas.height, safeArea: blueprint.canvas.safeArea }}
                selection={selection}
                tool={tool}
                viewport={viewport}
                prefs={prefs}
                paint={paint}
                spaceHeld={spaceHeld}
                editor={editor}
                actions={{
                  setViewport,
                  setSelection: (ids) => setSelection(ids),
                  setPaint,
                  create,
                  patch,
                  requestDelete,
                  toast: editor.pushToast,
                }}
              />
            </div>

            {inspectorOpen ? (
              <button
                type="button"
                aria-label="Close inspector"
                className="fixed inset-0 z-30 bg-black/60 xl:hidden"
                onClick={() => setInspectorOpen(false)}
              />
            ) : null}

            {/* Right Sidebar: Layers Panel & Inspector with Tab Switcher */}
            <div
              className={`fixed inset-y-0 right-0 z-40 h-full min-h-0 w-[300px] max-w-[92vw] shrink-0 flex-col border-l border-white/[0.07] bg-ink-900 transition-transform xl:static xl:z-auto xl:flex xl:translate-x-0 ${
                inspectorOpen ? "flex translate-x-0" : "hidden xl:flex"
              }`}
            >
              {/* Tab Switcher at the top of Right Sidebar */}
              <div role="tablist" aria-label="Right sidebar panels" className="flex shrink-0 items-center border-b border-white/[0.07] bg-ink-950/60 p-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={prefs.rightSidebarTab === "layers"}
                  onClick={() => onPrefs({ rightSidebarTab: "layers" })}
                  className={`focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-[11.5px] font-medium transition ${
                    prefs.rightSidebarTab === "layers"
                      ? "border border-white/10 bg-white/10 text-ink-100"
                      : "text-ink-400 hover:text-ink-200"
                  }`}
                >
                  <Icon name="layers" size={13} />
                  Layers ({content.objects.length})
                </button>

                <button
                  type="button"
                  role="tab"
                  aria-selected={prefs.rightSidebarTab === "inspector"}
                  onClick={() => onPrefs({ rightSidebarTab: "inspector" })}
                  className={`focus-ring flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-[11.5px] font-medium transition ${
                    prefs.rightSidebarTab === "inspector"
                      ? "border border-white/10 bg-white/10 text-ink-100"
                      : "text-ink-400 hover:text-ink-200"
                  }`}
                >
                  <Icon name="settings" size={13} />
                  Inspector
                </button>
              </div>

              {/* Stacked Layers & Inspector Panels */}
              <div className="flex min-h-0 flex-1 flex-col">
                <div className={`min-h-0 ${prefs.rightSidebarTab === "layers" ? "flex-[1.25]" : "flex-1"}`}>
                  <LayersPanel
                    blueprint={blueprint}
                    layers={content.layers}
                    objects={content.objects}
                    selection={selection}
                    actions={layersPanelActions}
                    onClose={() => setInspectorOpen(false)}
                  />
                </div>
                <div className={`min-h-0 border-t border-white/[0.08] ${prefs.rightSidebarTab === "inspector" ? "flex-[1.25]" : "flex-1"}`}>
                  <ObjectInspector
                    objects={content.objects}
                    layers={content.layers}
                    selection={selection}
                    background={content.background}
                    defaultBackgroundColor={blueprint.style.palette.background}
                    onBackgroundColorChange={changeBackground}
                    onChange={patch}
                    onAlign={align}
                    onDistribute={distribute}
                    onOrder={reorder}
                    onDuplicate={duplicate}
                    onDelete={() => requestDelete(selection)}
                    onSelectGroup={(groupId) => setSelection([groupId])}
                    onUngroup={handleUngroup}
                    onClose={() => setInspectorOpen(false)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Toasts toasts={editor.toasts} onDismiss={editor.dismissToast} onUndo={editor.undo} canUndo={editor.canUndo} />
    </div>
  );
}

export { MAX_SCALE, MIN_SCALE };
