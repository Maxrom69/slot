"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LayerDef, SceneObject } from "@/lib/blueprint/types";
import type { CanvasEditor } from "@/lib/client/useCanvasEditor";
import { isLinked } from "@/lib/design/model";
import {
  HANDLE_SIZE, aabbOf, centerOf, clean, handleWorld, objectContainsPoint, rotateHandleWorld,
  resizeTransform, toScreen, toWorld, unionBox, type Box, type HandleId, type Transform, type Vec, type Viewport,
} from "@/lib/canvas/geometry";
import {
  applyTransforms, expandGroupIds, hitTestObjects, objectsInMarquee, orderForRendering, previewMove, previewResize, previewRotate,
  transformOfObject,
} from "@/lib/canvas/operations";
import { createFreehandObject, createShapeObject, createStrokeObject, createTextObject } from "@/lib/canvas/create";
import { computeSnap, type Guide } from "@/lib/canvas/snapping";
import { SHAPE_TOOLS, isCreateTool, type ToolId } from "@/lib/canvas/tools";
import type { GameBlueprint } from "@/lib/blueprint/types";
import { SceneObjectView, buildResolvers } from "./SceneObjectView";

export interface CanvasPrefs {
  gridVisible: boolean;
  gridSize: number;
  gridSnap: boolean;
  safeArea: boolean;
  snapping: boolean;
}

export interface CanvasActions {
  setViewport(viewport: Viewport): void;
  setSelection(ids: string[]): void;
  setPaint(paint: { fill: string | null; stroke: string | null }): void;
  create(objects: SceneObject[], label: string): void;
  patch(ids: string[], patch: Partial<SceneObject>, label: string): void;
  requestDelete(ids: string[]): void;
  toast(message: string, tone?: "info" | "success" | "error"): void;
}

interface Props {
  blueprint: GameBlueprint;
  layers: LayerDef[];
  objects: SceneObject[];
  background: { color: string | null; assetId: string | null };
  scene: { id: string; width: number; height: number; safeArea: { top: number; right: number; bottom: number; left: number } };
  selection: string[];
  tool: ToolId;
  viewport: Viewport;
  prefs: CanvasPrefs;
  paint: { fill: string | null; stroke: string | null };
  spaceHeld: boolean;
  editor: CanvasEditor;
  actions: CanvasActions;
}

type Drag =
  | { mode: "pan"; startScreen: Vec; startView: Viewport }
  | { mode: "move"; ids: string[]; start: Vec; origin: Map<string, SceneObject> }
  | { mode: "resize"; ids: string[]; handle: Exclude<HandleId, "rotate" | "body">; start: SceneObject[]; group: Transform }
  | { mode: "rotate"; ids: string[]; center: Vec; startAngle: number; startObjects: SceneObject[] }
  | { mode: "create"; tool: ToolId; start: Vec }
  | { mode: "freehand"; points: Vec[] }
  | { mode: "marquee"; start: Vec; additive: boolean; base: string[] }
  | { mode: "erase"; removed: Set<string> };

const HANDLE_TARGETS: Exclude<HandleId, "rotate" | "body">[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_CURSOR: Record<string, string> = {
  nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
};
const NEAR = 7;
/** Handles that can start a drag: the eight resize points, or the rotate arm. */
type HandleHit = Exclude<HandleId, "body"> | null;

export function CanvasStage(props: Props) {
  const { blueprint, layers, objects, background, scene, selection, tool, viewport, prefs, paint, spaceHeld, editor, actions } = props;
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [ghost, setGhost] = useState<SceneObject | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const resolvers = useMemo(() => buildResolvers(blueprint), [blueprint]);
  /** Cleared implicitly when the hovered object no longer exists. */
  const hoverObject = useMemo(() => (hover ? (objects.find((o) => o.id === hover) ?? null) : null), [hover, objects]);
  const ordered = useMemo(() => orderForRendering(objects, layers), [objects, layers]);
  const visible = useMemo(() => {
    const state = new Map(layers.map((l) => [l.id, l]));
    return objects.filter((o) => o.visible && state.get(o.layerId)?.visible);
  }, [objects, layers]);
  const layerState = useMemo(() => new Map(layers.map((l) => [l.id, l])), [layers]);
  const selectableIds = useMemo(
    () => new Set(objects.filter((o) => o.visible && !o.locked && layerState.get(o.layerId)?.visible && !layerState.get(o.layerId)?.locked).map((o) => o.id)),
    [objects, layerState],
  );
  /** Hidden layers stop rendering (they still keep their objects). */
  const renderable = useMemo(
    () => ordered.filter((o) => o.visible && layerState.get(o.layerId)?.visible),
    [ordered, layerState],
  );

  const safe = useMemo<Box>(() => ({
    x: scene.safeArea.left,
    y: scene.safeArea.top,
    w: Math.max(0, scene.width - scene.safeArea.left - scene.safeArea.right),
    h: Math.max(0, scene.height - scene.safeArea.top - scene.safeArea.bottom),
  }), [scene]);

  const frame = useMemo<Box>(() => ({ x: 0, y: 0, w: scene.width, h: scene.height }), [scene]);

  /** The transform the handles act on: the object, or the union box of the selection. */
  const selectionTransform = useMemo<Transform | null>(() => {
    const picked = objects.filter((o) => selection.includes(o.id) && selectableIds.has(o.id));
    if (picked.length === 0) return null;

    const allPicked: SceneObject[] = [];
    for (const o of picked) {
      allPicked.push(o);
      if (o.kind === "group") {
        const children = objects.filter((c) => c.groupId === o.id || c.parentId === o.id);
        allPicked.push(...children);
      }
    }

    if (picked.length === 1 && picked[0].kind !== "group") {
      const o = picked[0];
      return { x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation };
    }
    const box = unionBox(allPicked.map((o) => aabbOf(o)));
    return { x: box.x, y: box.y, width: box.w, height: box.h, rotation: 0 };
  }, [objects, selection, selectableIds]);

  const localPoint = useCallback((event: { clientX: number; clientY: number }): Vec => {
    const rect = stage.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) };
  }, []);
  const worldAt = useCallback((event: { clientX: number; clientY: number }) => toWorld(viewport, localPoint(event)), [viewport, localPoint]);

  const hitId = useCallback((world: Vec) => {
    const found = hitTestObjects(visible, layers, world, 4 / Math.max(viewport.scale, 0.001));
    return found[0] ?? null;
  }, [visible, layers, viewport.scale]);

  const hitHandle = useCallback((screen: Vec): HandleHit => {
    if (!selectionTransform || tool !== "select") return null;
    const rotatePoint = toScreen(viewport, rotateHandleWorld(selectionTransform));
    if (Math.hypot(rotatePoint.x - screen.x, rotatePoint.y - screen.y) <= NEAR) return "rotate";
    for (const id of HANDLE_TARGETS) {
      const point = toScreen(viewport, handleWorld(selectionTransform, id));
      if (Math.hypot(point.x - screen.x, point.y - screen.y) <= NEAR) return id;
    }
    return null;
  }, [selectionTransform, tool, viewport]);

  const snapTargets = useCallback(
    (exclude: string[]) => visible.filter((o) => !exclude.includes(o.id)).map((o) => aabbOf(o)),
    [visible],
  );

  const applySnap = useCallback(
    (box: Box, exclude: string[], disabled: boolean) => {
      if (disabled || !prefs.snapping) return { dx: 0, dy: 0, guides: [] as Guide[] };
      return computeSnap({
        box,
        targets: snapTargets(exclude),
        canvas: frame,
        safe: prefs.safeArea ? safe : null,
        gridSize: prefs.gridSnap ? prefs.gridSize : null,
        threshold: 6,
        scale: viewport.scale,
      });
    },
    [prefs.snapping, prefs.safeArea, prefs.gridSnap, prefs.gridSize, snapTargets, frame, safe, viewport.scale],
  );

  /* ------------------------------- create tools ------------------------------ */
  const nextSequence = useCallback(() => objects.length + 1, [objects.length]);

  const finishCreate = useCallback(
    (start: Vec, end: Vec, shift: boolean) => {
      const width = Math.abs(end.x - start.x);
      const height = Math.abs(end.y - start.y);
      if (width < 3 && height < 3) return;
      const layerId = layers.find((l) => !l.locked)?.id ?? layers[0]?.id;
      if (!layerId) return;
      const sequence = nextSequence();
      const box = {
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width,
        height,
      };
      let object: SceneObject | null = null;
      if (tool === "rect" || tool === "ellipse" || tool === "triangle") {
        const normalized = shift
          ? { ...box, width: Math.min(width, height), height: Math.min(width, height), x: end.x < start.x ? start.x - Math.min(width, height) : box.x, y: end.y < start.y ? start.y - Math.min(width, height) : box.y }
          : box;
        object = createShapeObject(layerId, tool, normalized, blueprint.style.palette, sequence);
        object.fill = paint.fill;
        object.stroke = paint.stroke;
      } else if (tool === "line" || tool === "arrow") {
        object = createStrokeObject(layerId, tool, start, end, blueprint.style.palette, sequence);
        object.stroke = paint.stroke ?? object.stroke;
      }
      if (!object) return;
      actions.create([object], `Add ${object.name}`);
    },
    [tool, layers, nextSequence, blueprint.style.palette, paint.fill, paint.stroke, actions],
  );

  /* ------------------------------- interactions ------------------------------ */
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.button === 2) return;
      const screen = localPoint(event);
      const world = toWorld(viewport, screen);
      stage.current?.setPointerCapture(event.pointerId);
      setGuides([]);
      setGhost(null);

      if (tool === "pan" || spaceHeld || event.button === 1) {
        drag.current = { mode: "pan", startScreen: screen, startView: viewport };
        setIsPanning(true);
        return;
      }

      if (tool === "eyedropper") {
        const id = hitId(world);
        const object = id ? objects.find((o) => o.id === id) : null;
        const sample =
          object?.fill ??
          (object?.kind === "stroke" || object?.kind === "shape" ? object.stroke : null) ??
          (id ? null : background.color) ??
          blueprint.style.palette.background;
        actions.setPaint({ ...paint, fill: sample });
        actions.toast(`Sampled ${sample ?? "no colour"}`);
        return;
      }
      if (tool === "paint") {
        const id = hitId(world);
        if (!id) return;
        const object = objects.find((o) => o.id === id);
        const patch = object?.kind === "stroke" ? { stroke: paint.stroke } : { fill: paint.fill };
        actions.patch([id], patch, "Apply colour");
        return;
      }
      if (tool === "blur") {
        const id = hitId(world);
        if (!id) return;
        const current = objects.find((o) => o.id === id)?.blur ?? 0;
        actions.patch([id], { blur: current > 0 ? 0 : 8 }, current > 0 ? "Remove blur" : "Soften object");
        return;
      }
      if (tool === "eraser") {
        const removed = new Set<string>();
        const id = hitId(world);
        if (id) removed.add(id);
        drag.current = { mode: "erase", removed };
        if (id) editor.preview((content) => ({ ...content, objects: content.objects.filter((o) => !removed.has(o.id)) }));
        return;
      }
      if (tool === "text") {
        const layerId = layers.find((l) => !l.locked)?.id ?? layers[0]?.id;
        if (!layerId) return;
        const object = createTextObject(layerId, world, blueprint.style.palette, nextSequence());
        object.fill = paint.fill;
        actions.create([object], `Add ${object.name}`);
        return;
      }
      if (tool === "freehand") {
        drag.current = { mode: "freehand", points: [world] };
        return;
      }
      if (SHAPE_TOOLS.includes(tool)) {
        drag.current = { mode: "create", tool, start: world };
        return;
      }

      /* -------------------------------- select -------------------------------- */
      const handle = hitHandle(screen);
      const picked = objects.filter((o) => selection.includes(o.id) && selectableIds.has(o.id));
      if (handle === "rotate" && picked.length > 0) {
        const center = centerOf(selectionTransform!);
        editor.begin(picked.length > 1 ? "Rotate selection" : `Rotate ${picked[0].name}`);
        drag.current = { mode: "rotate", ids: picked.map((o) => o.id), center, startAngle: (Math.atan2(world.y - center.y, world.x - center.x) * 180) / Math.PI, startObjects: picked };
        return;
      }
      if (handle && handle !== "rotate" && picked.length > 0) {
        editor.begin(picked.length > 1 ? "Resize selection" : `Resize ${picked[0].name}`);
        drag.current = { mode: "resize", ids: picked.map((o) => o.id), handle, start: picked, group: selectionTransform! };
        return;
      }

      const id = hitId(world);
      if (id) {
        const already = selection.includes(id);
        let next = selection;
        if (event.shiftKey) next = already ? selection.filter((x) => x !== id) : [...selection, id];
        else if (!already) next = [id];
        actions.setSelection(next);
        const movable = next.filter((value) => selectableIds.has(value));
        if (movable.length > 0) {
          const allMovable = expandGroupIds(objects, movable);
          editor.begin(movable.length > 1 ? "Move selection" : `Move ${objects.find((o) => o.id === movable[0])?.name ?? "object"}`);
          drag.current = { mode: "move", ids: allMovable, start: world, origin: new Map(objects.filter((o) => allMovable.includes(o.id)).map((o) => [o.id, o])) };
        }
        return;
      }

      if (!event.shiftKey) actions.setSelection([]);
      drag.current = { mode: "marquee", start: screen, additive: event.shiftKey, base: event.shiftKey ? selection : [] };
      setMarquee({ x: screen.x, y: screen.y, w: 0, h: 0 });
    },
    [tool, spaceHeld, viewport, localPoint, hitId, hitHandle, objects, selection, selectableIds, selectionTransform, layers, blueprint.style.palette, nextSequence, paint, actions, editor, background.color],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const state = drag.current;
      const screen = localPoint(event);
      const world = toWorld(viewport, screen);

      if (!state) {
        if (tool === "select") setHover(hitId(world));
        return;
      }

      switch (state.mode) {
        case "pan":
          actions.setViewport({ ...state.startView, x: state.startView.x + (screen.x - state.startScreen.x), y: state.startView.y + (screen.y - state.startScreen.y) });
          return;

        case "move": {
          let dx = world.x - state.start.x;
          let dy = world.y - state.start.y;
          const starts = state.ids.map((id) => state.origin.get(id)!);
          const snap = applySnap(unionBox(previewMove(starts, dx, dy).map(aabbOf)), state.ids, event.altKey);
          dx += snap.dx;
          dy += snap.dy;
          setGuides(snap.guides);
          // Computed from the snapshot and written absolutely: see previewMove.
          editor.preview((content) => ({ ...content, objects: applyTransforms(content.objects, state.ids, previewMove(starts, dx, dy)) }));
          return;
        }

        case "resize": {
          const preview = previewResize(state.start, state.group, state.handle, world, { keepAspect: event.shiftKey });
          const snap = applySnap(aabbOf(preview.box), state.ids, event.altKey);
          const canSnapX = state.handle.includes("e") || state.handle.includes("w");
          const canSnapY = state.handle.includes("n") || state.handle.includes("s");
          const dx = canSnapX ? snap.dx : 0;
          const dy = canSnapY ? snap.dy : 0;
          setGuides(
            snap.guides.filter((g) => (g.axis === "v" && canSnapX) || (g.axis === "h" && canSnapY)),
          );
          const snappedPreview =
            dx !== 0 || dy !== 0
              ? previewResize(
                  state.start,
                  state.group,
                  state.handle,
                  { x: world.x + dx, y: world.y + dy },
                  { keepAspect: event.shiftKey },
                )
              : preview;
          editor.preview((content) => ({
            ...content,
            objects: applyTransforms(content.objects, state.ids, snappedPreview.transforms),
          }));
          return;
        }

        case "rotate": {
          const angle = (Math.atan2(world.y - state.center.y, world.x - state.center.x) * 180) / Math.PI;
          let delta = angle - state.startAngle;
          if (event.shiftKey) delta = Math.round(delta / 15) * 15;
          const targets = previewRotate(state.startObjects, state.center, delta);
          editor.preview((content) => ({ ...content, objects: applyTransforms(content.objects, state.ids, targets) }));
          return;
        }

        case "create": {
          const start = state.start;
          const width = Math.abs(world.x - start.x);
          const height = Math.abs(world.y - start.y);
          if (width < 2 && height < 2) {
            setGhost(null);
            return;
          }
          const layerId = layers.find((l) => !l.locked)?.id ?? layers[0]?.id;
          if (!layerId) return;
          const palette = blueprint.style.palette;
          const sequence = nextSequence();
          const previewObject = state.tool === "ellipse" || state.tool === "rect" || state.tool === "triangle"
            ? createShapeObject(layerId, state.tool, {
                x: Math.min(start.x, world.x), y: Math.min(start.y, world.y), width, height,
              }, palette, sequence)
            : createStrokeObject(layerId, state.tool === "arrow" ? "arrow" : "line", start, world, palette, sequence);
          previewObject.fill = paint.fill;
          previewObject.stroke = paint.stroke;
          previewObject.opacity = 0.6;
          setGhost(previewObject);
          return;
        }

        case "freehand": {
          const points = [...state.points, world];
          drag.current = { ...state, points };
          const layerId = layers.find((l) => !l.locked)?.id ?? layers[0]?.id;
          if (!layerId) return;
          const object = createFreehandObject(layerId, points, blueprint.style.palette, nextSequence());
          if (object) {
            object.stroke = paint.stroke ?? object.stroke;
            object.opacity = 0.7;
          }
          setGhost(object);
          return;
        }

        case "marquee": {
          const box = {
            x: Math.min(state.start.x, screen.x),
            y: Math.min(state.start.y, screen.y),
            w: Math.abs(screen.x - state.start.x),
            h: Math.abs(screen.y - state.start.y),
          };
          setMarquee(box);
          const worldBox = {
            x: toWorld(viewport, { x: box.x, y: box.y }).x,
            y: toWorld(viewport, { x: box.x, y: box.y }).y,
            w: box.w / viewport.scale,
            h: box.h / viewport.scale,
          };
          const found = objectsInMarquee(visible, layers, worldBox);
          const merged = Array.from(new Set([...(state.additive ? state.base : []), ...found]));
          if (merged.join() !== selection.join()) actions.setSelection(merged);
          return;
        }

        case "erase": {
          const id = hitId(world);
          if (id && !state.removed.has(id)) {
            state.removed.add(id);
            editor.preview((content) => ({ ...content, objects: content.objects.filter((o) => !state.removed.has(o.id)) }));
          }
          return;
        }
      }
    },
    [viewport, localPoint, tool, hitId, applySnap, editor, layers, blueprint.style.palette, nextSequence, paint, visible, selection, actions],
  );

  const onPointerUp = useCallback(() => {
    const state = drag.current;
    drag.current = null;
    setIsPanning(false);
    setGuides([]);
    setMarquee(null);

    if (!state) return;
    if (state.mode === "create") {
      const ghostObject = ghost;
      setGhost(null);
      if (ghostObject) {
        const finished = { ...ghostObject, opacity: 1 };
        actions.create([finished], `Add ${finished.name}`);
      }
      return;
    }
    if (state.mode === "freehand") {
      const object = ghost;
      setGhost(null);
      if (object && object.points.length >= 2) {
        actions.create([{ ...object, opacity: 1 }], `Add ${object.name}`);
      }
      return;
    }
    if (state.mode === "erase") {
      const ids = Array.from(state.removed);
      setGhost(null);
      if (ids.length === 0) {
        editor.abandon();
        return;
      }
      editor.end();
      actions.requestDelete(ids);
      return;
    }
    setGhost(null);
    editor.end();
  }, [ghost, actions, editor]);

  /* ------------------------------ wheel: pan/zoom ----------------------------- */
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const point = { x: event.clientX - node.getBoundingClientRect().left, y: event.clientY - node.getBoundingClientRect().top };
      if (event.ctrlKey || event.metaKey) {
        const factor = Math.exp(-event.deltaY * 0.0015);
        import("@/lib/canvas/geometry").then(({ zoomViewport }) => actions.setViewport(zoomViewport(viewport, viewport.scale * factor, point)));
      } else {
        actions.setViewport({ ...viewport, x: viewport.x - event.deltaX, y: viewport.y - event.deltaY });
      }
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [viewport, actions]);

  const backgroundStyle = useMemo(() => {
    const asset = background.assetId ? resolvers.assets.get(background.assetId) : null;
    const uri = isLinked(asset) ? asset.uri : null;
    return {
      backgroundColor: background.color ?? blueprint.style.palette.background,
      backgroundImage: uri ? `url(${uri})` : undefined,
      backgroundSize: "cover",
      backgroundPosition: "center",
    } as const;
  }, [background, resolvers, blueprint.style.palette.background]);

  const gridSize = Math.max(2, prefs.gridSize * viewport.scale);
  const cursor =
    isPanning ? "grabbing"
      : tool === "pan" ? (spaceHeld ? "grabbing" : "grab")
        : tool === "text" ? "text"
          : tool === "select" ? "default"
            : isCreateTool(tool) ? "crosshair"
              : "crosshair";

  const screenOf = (world: Vec) => toScreen(viewport, world);
  const outline = (t: Transform, color: string, width: number, dash?: string) => {
    const p1 = screenOf({ x: t.x, y: t.y });
    return (
      <rect
        x={p1.x} y={p1.y} width={t.width * viewport.scale} height={t.height * viewport.scale}
        transform={`rotate(${t.rotation} ${screenOf(centerOf(t)).x} ${screenOf(centerOf(t)).y})`}
        fill="none" stroke={color} strokeWidth={width} strokeDasharray={dash} pointerEvents="none"
      />
    );
  };

  return (
    <div
      ref={stage}
      role="application"
      aria-label="Scene canvas"
      className="canvas-surface relative min-h-0 flex-1 overflow-hidden"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { drag.current = null; setIsPanning(false); setGhost(null); setMarquee(null); setGuides([]); editor.abandon(); }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* world space */}
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: scene.width,
          height: scene.height,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        <div className="absolute inset-0" style={backgroundStyle} />
        {prefs.gridVisible ? (
          <div
            className="canvas-grid absolute inset-0"
            style={{ backgroundSize: `${gridSize}px ${gridSize}px, ${gridSize}px ${gridSize}px` }}
          />
        ) : null}
        {prefs.safeArea ? (
          <div
            className="canvas-safe absolute"
            style={{ left: safe.x, top: safe.y, width: safe.w, height: safe.h }}
            aria-label="Safe canvas area"
          />
        ) : null}
        {renderable.map((object) => (
          <SceneObjectView key={object.id} object={object} blueprint={blueprint} resolvers={resolvers} />
        ))}
        {ghost ? <SceneObjectView object={ghost} blueprint={blueprint} resolvers={resolvers} /> : null}
      </div>

      {/* screen space overlay */}
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {hoverObject && !selection.includes(hoverObject.id)
          ? outline(transformOfObject(hoverObject), "rgba(255,255,255,0.35)", 1)
          : null}
        {selectionTransform ? outline(selectionTransform, "#3b82f6", 1.5) : null}
        {objects.filter((o) => selection.includes(o.id) && selection.length > 1).map((o) => outline({ x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation }, "rgba(59,130,246,0.5)", 1))}
        {guides.map((guide, index) => {
          const from = guide.axis === "v" ? screenOf({ x: guide.at, y: guide.from }) : screenOf({ x: guide.from, y: guide.at });
          const to = guide.axis === "v" ? screenOf({ x: guide.at, y: guide.to }) : screenOf({ x: guide.to, y: guide.at });
          return <line key={`${guide.axis}-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#f0b429" strokeWidth={1} pointerEvents="none" />;
        })}
      </svg>

      {selectionTransform && tool === "select"
        ? HANDLE_TARGETS.map((id) => {
            const point = screenOf(handleWorld(selectionTransform, id));
            return (
              <span
                key={id}
                data-handle={id}
                className="pointer-events-none absolute rounded-[2px] border border-blue-500 bg-white"
                style={{ left: point.x - HANDLE_SIZE / 2, top: point.y - HANDLE_SIZE / 2, width: HANDLE_SIZE, height: HANDLE_SIZE, cursor: HANDLE_CURSOR[id] }}
              />
            );
          })
        : null}
      {selectionTransform && tool === "select" ? (() => {
        const point = screenOf(rotateHandleWorld(selectionTransform));
        const center = screenOf(centerOf(selectionTransform));
        return (
          <>
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <line x1={center.x} y1={center.y} x2={point.x} y2={point.y} stroke="#3b82f6" strokeWidth={1} strokeDasharray="3 3" />
            </svg>
            <span
              data-handle="rotate"
              className="pointer-events-none absolute grid h-4 w-4 place-items-center rounded-full border border-blue-500 bg-ink-900 text-[8px] text-blue-300"
              style={{ left: point.x - 8, top: point.y - 8 }}
            >
              ⟳
            </span>
          </>
        );
      })() : null}

      {marquee ? (
        <div
          className="pointer-events-none absolute border border-blue-400/80 bg-blue-500/10"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      ) : null}

      <div className="canvas-hud pointer-events-none absolute bottom-3 left-3 rounded-md border border-white/10 bg-ink-900/85 px-2 py-1 font-mono text-[10px] text-ink-300">
        {scene.width} × {scene.height} · {Math.round(viewport.scale * 100)}% · {selection.length} selected
      </div>
    </div>
  );
}
