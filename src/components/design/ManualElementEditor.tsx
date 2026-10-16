"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { Toasts } from "@/components/ui/Toasts";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";
import type { GameBlueprint } from "@/lib/blueprint/types";
import { glyphsForTheme } from "@/lib/blueprint/palette";
import { useDesignEditor } from "@/lib/client/useDesignEditor";
import { commitHistory, createHistory, redoHistory, undoHistory } from "@/lib/design/history";
import { designDocFromBlueprint } from "@/lib/design/migrate";
import { elementImage, symbolImage } from "@/lib/design/selectors";
import {
  DOCUMENTED_BLEND_MODES,
  MANUAL_SHORTCUT_TO_TOOL,
  MANUAL_TOOLS,
  RASTERIZE_CONFIRMATION_MESSAGE,
  addBlankRasterLayer,
  addFreehandVectorLayer,
  addVectorLineArrowLayer,
  addVectorShapeLayer,
  addVectorTextLayer,
  applyPixelToolStroke,
  createInitialManualEditorDoc,
  deleteLayer,
  duplicateLayer,
  gradientToCss,
  maskBottomWithTop,
  rasterizeLayer,
  removeMask,
  renderManualEditorToDataUrl,
  renderManualEditorToSvg,
  reorderLayer,
   requiresRasterizationConfirmation,
  resetLayerAdjustments,
  sampleEyedropperAtPoint,
  saveManualEditToDesignDoc,
  selectLayer,
  selectTool,
  setEditorFullscreen,
  setEditorZoom,
  updateBrushSettings,
  updateEditorColorHex,
  updateEditorColorRgba,
  updateEditorGradient,
  updateLayer,
  updateLayerAdjustments,
  updateLayerDropShadow,
  updateLayerShapeProps,
  updateLayerTextProps,
  type EditorBlendMode,
  type ManualEditorDoc,
  type ManualToolId,
  type RasterStrokePoint,
  type ShapeKind,
  type TextAlignment,
  type TextFontStyle,
} from "@/lib/manual-editor";

const FONT_FAMILIES = [
  "Cinzel",
  "Inter",
  "Playfair Display",
  "JetBrains Mono",
  "Impact",
  "Georgia",
  "System Sans",
];

const FONT_WEIGHTS = [400, 500, 600, 700, 800, 900];

export interface ManualElementEditorProps {
  project: {
    id: string;
    title: string;
    theme: string;
    status: string;
    folderPath: string;
  };
  blueprint: GameBlueprint;
  revision: number;
  elementId: string;
  onCloseModal?: () => void;
}

export function ManualElementEditor({
  project,
  blueprint,
  revision,
  elementId,
  onCloseModal,
}: ManualElementEditorProps) {
  const router = useRouter();
  const glyphs = useMemo(
    () => glyphsForTheme(project.theme || project.title),
    [project.theme, project.title],
  );
  const initialDesignDoc = useMemo(() => designDocFromBlueprint(blueprint), [blueprint]);
  const designEditor = useDesignEditor({
    projectId: project.id,
    initialDoc: initialDesignDoc,
    initialRevision: revision,
    glyphs,
  });
  const { doc } = designEditor;
  const palette = blueprint.style.palette;

  const element = doc.elements.find((e) => e.id === elementId) ?? null;
  const linkedSymbol =
    element?.type === "symbol" && element.symbolIds[0]
      ? (doc.symbols.find((s) => s.id === element.symbolIds[0]) ?? null)
      : null;

  const currentAsset = useMemo(() => {
    if (!element) return null;
    if (linkedSymbol) return symbolImage(doc, linkedSymbol);
    return elementImage(doc, element);
  }, [doc, element, linkedSymbol]);

  const initialEditorDoc = useMemo(() => {
    return createInitialManualEditorDoc({
      width: currentAsset?.width ?? 512,
      height: currentAsset?.height ?? 512,
      baseImageUri: currentAsset?.uri ?? null,
      baseImageName: currentAsset?.name ?? element?.name ?? "Base Artwork",
      baseIsVector:
        currentAsset?.format === "svg" ||
        Boolean(currentAsset?.uri?.startsWith("data:image/svg+xml")),
      initialTintColor: element?.style?.tintColor,
      initialOpacity: element?.style?.opacity ?? 1,
      initialBlendMode: (element?.style?.blendMode ?? "normal") as EditorBlendMode,
      paletteSwatches: [
        palette.accent,
        palette.accentAlt,
        palette.glow,
        palette.surface,
        palette.text,
        palette.background,
      ].filter(Boolean),
    });
  }, [currentAsset, element, palette]);

  const [history, setHistory] = useState(() => createHistory<ManualEditorDoc>(initialEditorDoc));
  const editorDoc = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const commit = (label: string, updater: (prev: ManualEditorDoc) => ManualEditorDoc, key?: string) => {
    setHistory((h) => {
      const next = updater(h.present);
      if (next === h.present) return h;
      return commitHistory(h, next, label, key ? { key } : {});
    });
  };

  const handleUndo = () => {
    setHistory((h) => undoHistory(h)?.state ?? h);
  };

  const handleRedo = () => {
    setHistory((h) => redoHistory(h)?.state ?? h);
  };

  const [checkerboard, setCheckerboard] = useState(true);
  const [guides, setGuides] = useState(true);
  const [shapePreset, setShapePreset] = useState<ShapeKind>("rounded_rect");
  const [lineArrowEnd, setLineArrowEnd] = useState(true);
  const [saveRevisionLabel, setSaveRevisionLabel] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Vector/Raster confirmation modal state ("Rasterize this object?")
  const [rasterizeModalState, setRasterizeModalState] = useState<{
    layerId: string;
    layerName: string;
    pendingStroke?: {
      mode: "brush" | "eraser" | "blur_brush";
      points: RasterStrokePoint[];
    };
  } | null>(null);

  // Interactive pointer drawing / dragging state
  const stageSvgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [activePoints, setActivePoints] = useState<RasterStrokePoint[]>([]);
  const [dragMoveState, setDragMoveState] = useState<{
    layerId: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);

  const selectedLayer = useMemo(
    () =>
      editorDoc.layers.find((l) => l.id === editorDoc.selectedLayerId) ??
      editorDoc.layers[0] ??
      null,
    [editorDoc.layers, editorDoc.selectedLayerId],
  );

  // Keyboard shortcuts: V, B, E, U, P, I, T, R, L + Undo/Redo
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (inInput) return;

      const mappedTool = MANUAL_SHORTCUT_TO_TOOL[e.key.toLowerCase()];
      if (mappedTool) {
        e.preventDefault();
        commit(`Select ${mappedTool} tool`, (d) => selectTool(d, mappedTool));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const handleToggleFullscreen = async () => {
    const nextFs = !editorDoc.fullscreen;
    commit("Toggle fullscreen", (d) => setEditorFullscreen(d, nextFs));
    try {
      if (nextFs && containerRef.current && document.fullscreenElement === null) {
        await containerRef.current.requestFullscreen?.();
      } else if (!nextFs && document.fullscreenElement) {
        await document.exitFullscreen?.();
      }
    } catch {
      // Fullscreen API may be restricted in iframe preview; layout fullscreen state still applies.
    }
  };

  const handleCancel = () => {
    if (onCloseModal) {
      onCloseModal();
      return;
    }
    router.push(
      `/projects/${encodeURIComponent(project.id)}/elements/${encodeURIComponent(elementId)}`,
    );
  };

  const handleSaveNewRevision = async () => {
    if (!element || isSaving) return;
    setIsSaving(true);
    try {
      const rendered = renderManualEditorToDataUrl(editorDoc);
      const safeSlug =
        element.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "element";
      const fileName = `${safeSlug}-manual-${Date.now().toString(36).slice(-4)}.svg`;
      const svgBlob = new Blob([rendered.svg], { type: "image/svg+xml" });
      const file = new File([svgBlob], fileName, { type: "image/svg+xml" });

      const [uploaded] = await designEditor.uploadImages([file]);
      const customAsset = uploaded?.asset;
      const notes =
        saveRevisionLabel.trim() ||
        `Manual editor revision (${editorDoc.layers.length} layers)`;

      designEditor.apply(`Save manual edit for ${element.name}`, (d) => {
        const res = saveManualEditToDesignDoc(
          d,
          { kind: "element", id: element.id },
          editorDoc,
          {
            customAsset: customAsset ?? undefined,
            label: saveRevisionLabel.trim() || undefined,
            notes,
          },
        );
        return res.doc;
      });

      await designEditor.flush();
      setSaveRevisionLabel("");
      designEditor.pushToast(
        `Saved new image version for “${element.name}” (original asset preserved).`,
        "success",
      );
    } catch {
      designEditor.pushToast("Could not save manual image revision.", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const toCanvasCoords = (clientX: number, clientY: number): RasterStrokePoint => {
    const svg = stageSvgRef.current;
    if (!svg) return { x: editorDoc.width / 2, y: editorDoc.height / 2 };
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return { x: editorDoc.width / 2, y: editorDoc.height / 2 };
    }
    const x = ((clientX - rect.left) / rect.width) * editorDoc.width;
    const y = ((clientY - rect.top) / rect.height) * editorDoc.height;
    return {
      x: Math.max(0, Math.min(editorDoc.width, Math.round(x * 10) / 10)),
      y: Math.max(0, Math.min(editorDoc.height, Math.round(y * 10) / 10)),
    };
  };

  const handleStagePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!selectedLayer) return;
    const pt = toCanvasCoords(e.clientX, e.clientY);
    const tool = editorDoc.activeTool;

    if (tool === "eyedropper") {
      const sampled = sampleEyedropperAtPoint(editorDoc, pt.x, pt.y);
      commit(`Sample color ${sampled.sampledHex}`, () => sampled.doc);
      designEditor.pushToast(`Sampled color ${sampled.sampledHex}`, "info");
      return;
    }

    if (tool === "text") {
      commit(
        "Add vector text layer",
        (d) => addVectorTextLayer(d, { x: Math.round(pt.x - 100), y: Math.round(pt.y - 28) }).doc,
      );
      return;
    }

    if (tool === "shapes") {
      commit(
        `Add ${shapePreset} shape`,
        (d) =>
          addVectorShapeLayer(d, shapePreset, {
            x: Math.round(pt.x - 90),
            y: Math.round(pt.y - 70),
            width: 180,
            height: 140,
          }).doc,
      );
      return;
    }

    if (tool === "line_arrow") {
      commit(
        lineArrowEnd ? "Add vector arrow" : "Add vector line",
        (d) =>
          addVectorLineArrowLayer(d, lineArrowEnd, {
            x: Math.round(pt.x - 110),
            y: Math.round(pt.y - 24),
            width: 220,
            height: 48,
          }).doc,
      );
      return;
    }

    // F13 VECTOR / RASTER RULE:
    // If an operation requires pixel editing on a vector object, display "Rasterize this object?"
    if (requiresRasterizationConfirmation(selectedLayer, tool)) {
      setRasterizeModalState({
        layerId: selectedLayer.id,
        layerName: selectedLayer.name,
        pendingStroke: {
          mode: tool as "brush" | "eraser" | "blur_brush",
          points: [pt, { x: pt.x + 1, y: pt.y + 1 }],
        },
      });
      return;
    }

    if (tool === "brush" || tool === "eraser" || tool === "blur_brush" || tool === "freehand") {
      setActivePoints([pt]);
      return;
    }

    if (tool === "select" && !selectedLayer.locked) {
      setDragMoveState({
        layerId: selectedLayer.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        origX: selectedLayer.x,
        origY: selectedLayer.y,
      });
    }
  };

  const handleStagePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (activePoints.length > 0) {
      const pt = toCanvasCoords(e.clientX, e.clientY);
      setActivePoints((prev) => [...prev, pt]);
      return;
    }
    if (dragMoveState) {
      const scale = editorDoc.zoom / 100;
      const dx = (e.clientX - dragMoveState.startClientX) / scale;
      const dy = (e.clientY - dragMoveState.startClientY) / scale;
      commit(
        "Move layer",
        (d) =>
          updateLayer(d, dragMoveState.layerId, {
            x: Math.round(dragMoveState.origX + dx),
            y: Math.round(dragMoveState.origY + dy),
          }),
        `move-${dragMoveState.layerId}`,
      );
    }
  };

  const handleStagePointerUp = () => {
    if (dragMoveState) {
      setDragMoveState(null);
    }
    if (activePoints.length > 0 && selectedLayer) {
      const pts =
        activePoints.length === 1
          ? [activePoints[0]!, { x: activePoints[0]!.x + 1, y: activePoints[0]!.y + 1 }]
          : activePoints;
      const tool = editorDoc.activeTool;

      if (tool === "freehand") {
        commit("Draw freehand path", (d) => addFreehandVectorLayer(d, pts).doc);
      } else if (tool === "brush" || tool === "eraser" || tool === "blur_brush") {
        commit(`Apply ${tool} stroke`, (d) => {
          const res = applyPixelToolStroke(d, selectedLayer.id, {
            mode: tool,
            points: pts,
          });
          return res.doc;
        });
      }
      setActivePoints([]);
    }
  };

  const renderedSvgMarkup = useMemo(() => renderManualEditorToSvg(editorDoc), [editorDoc]);

  if (!element) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-ink-950 text-ink-100">
        <main className="mx-auto max-w-md px-6 py-20 text-center">
          <h2 className="text-[15px] font-semibold text-ink-100">Element not found</h2>
          <p className="mt-2 text-[12px] text-ink-400">
            The element “{elementId}” could not be found in this project.
          </p>
          <Button
            className="mt-5"
            variant="primary"
            onClick={() => router.push(`/projects/${encodeURIComponent(project.id)}/design`)}
          >
            <Icon name="arrow-left" size={13} />
            Back to Design
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="manual-element-editor"
      className={`flex flex-col overflow-hidden bg-ink-950 text-ink-100 ${
        editorDoc.fullscreen ? "fixed inset-0 z-50 h-screen w-screen" : "h-screen"
      }`}
    >
      {!editorDoc.fullscreen ? (
        <ProjectTopNav projectId={project.id} projectTitle={project.title} />
      ) : null}

      {/* TOP BAR: undo, redo, save, cancel, zoom, fullscreen */}
      <header
        data-testid="manual-editor-topbar"
        className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.07] bg-ink-900/95 px-3.5 py-2"
      >
        <div className="flex items-center gap-2">
          <Button
            onClick={handleCancel}
            aria-label="Cancel"
            data-testid="manual-editor-cancel"
          >
            <Icon name="x" size={13} />
            Cancel
          </Button>
          <div className="h-4 w-px bg-white/10" />
          <span className="text-[12px] font-semibold text-ink-100">{element.name}</span>
          <span className="rounded border border-accent-500/30 bg-accent-500/10 px-2 py-0.5 font-mono text-[10px] text-accent-300">
            Manual Element Editor
          </span>
        </div>

        {/* Zoom & Fullscreen Controls */}
        <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-ink-950/80 px-2 py-1">
          <Button
            className="h-6 px-2 text-[11px]"
            aria-label="Zoom out"
            onClick={() => commit("Zoom out", (d) => setEditorZoom(d, d.zoom - 25))}
          >
            <Icon name="minus" size={11} />
          </Button>
          <span
            data-testid="manual-editor-zoom-value"
            className="w-12 text-center font-mono text-[11px] text-ink-200"
          >
            {editorDoc.zoom}%
          </span>
          <Button
            className="h-6 px-2 text-[11px]"
            aria-label="Zoom in"
            onClick={() => commit("Zoom in", (d) => setEditorZoom(d, d.zoom + 25))}
          >
            <Icon name="plus" size={11} />
          </Button>
          <Button
            className="h-6 px-2 text-[10px]"
            onClick={() => commit("Reset zoom", (d) => setEditorZoom(d, 100))}
          >
            100%
          </Button>
          <div className="h-3.5 w-px bg-white/10" />
          <Button
            className="h-6 px-2 text-[11px]"
            aria-label="Fullscreen"
            data-testid="manual-editor-fullscreen"
            onClick={() => void handleToggleFullscreen()}
          >
            <Icon name="maximize" size={12} />
            {editorDoc.fullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </Button>
        </div>

        {/* Undo, Redo, Revision Label & Save */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={!canUndo}
            onClick={handleUndo}
            aria-label="Undo"
            data-testid="manual-editor-undo"
            title="Undo (Ctrl/Cmd+Z)"
          >
            <Icon name="undo" size={13} />
            Undo
          </Button>
          <Button
            disabled={!canRedo}
            onClick={handleRedo}
            aria-label="Redo"
            data-testid="manual-editor-redo"
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            <Icon name="redo" size={13} />
            Redo
          </Button>
          <input
            type="text"
            aria-label="Revision label"
            value={saveRevisionLabel}
            onChange={(e) => setSaveRevisionLabel(e.target.value)}
            placeholder="Version label (optional)..."
            className="creation-input h-8 w-44 text-[11px]"
          />
          <Button
            variant="primary"
            disabled={isSaving}
            onClick={() => void handleSaveNewRevision()}
            aria-label="Save"
            data-testid="manual-editor-save"
          >
            <Icon name="save" size={13} />
            {isSaving ? "Saving..." : "Save"}
          </Button>
          <button
            type="button"
            disabled
            data-testid="manual-editor-ai-disabled"
            title="Future functionality — AI image editing is not implemented in this version."
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-white/15 bg-white/[0.02] px-2.5 py-1.5 text-[10.5px] text-ink-400/60"
          >
            <Icon name="sparkles" size={12} />
            AI Edit (Unavailable)
          </button>
        </div>
      </header>

      {/* WORKSPACE BODY: Left Toolbox | Center Editing Canvas | Right Layers & Properties */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[210px_1fr_380px] lg:overflow-hidden">
        {/* LEFT: TOOLBOX */}
        <aside
          data-testid="manual-editor-toolbox"
          aria-label="Toolbox"
          className="flex flex-col justify-between overflow-y-auto border-r border-white/[0.07] bg-ink-900/90 p-3"
        >
          <div className="space-y-3">
            <div>
              <div className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
                Tools
              </div>
              <div className="space-y-1">
                {MANUAL_TOOLS.map((tool) => {
                  const isActive = editorDoc.activeTool === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      data-testid={`manual-tool-${tool.id}`}
                      aria-pressed={isActive}
                      title={tool.description}
                      onClick={() => commit(`Select ${tool.label}`, (d) => selectTool(d, tool.id))}
                      className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-[11.5px] transition ${
                        isActive
                          ? "border border-accent-500/50 bg-accent-500/20 font-semibold text-ink-50"
                          : "border border-transparent text-ink-300 hover:bg-white/[0.04] hover:text-ink-100"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon name={tool.icon} size={13} />
                        <span>{tool.label}</span>
                      </span>
                      <kbd className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-ink-300">
                        {tool.shortcut}
                      </kbd>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Create Vector / Raster Objects */}
            <div className="border-t border-white/[0.07] pt-3">
              <div className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
                Quick Insert Layer
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                <Button
                  className="h-7 justify-start px-2.5 text-[11px]"
                  data-testid="add-raster-layer-btn"
                  onClick={() =>
                    commit("Add raster paint layer", (d) => addBlankRasterLayer(d).doc)
                  }
                >
                  <Icon name="brush" size={12} />
                  + Paint Layer (Raster)
                </Button>
                <Button
                  className="h-7 justify-start px-2.5 text-[11px]"
                  data-testid="add-text-layer-btn"
                  onClick={() =>
                    commit("Add vector text layer", (d) => addVectorTextLayer(d).doc)
                  }
                >
                  <Icon name="text" size={12} />
                  + Vector Text
                </Button>
                <Button
                  className="h-7 justify-start px-2.5 text-[11px]"
                  data-testid="add-shape-layer-btn"
                  onClick={() =>
                    commit(
                      "Add vector shape layer",
                      (d) => addVectorShapeLayer(d, shapePreset).doc,
                    )
                  }
                >
                  <Icon name="square" size={12} />
                  + Vector Shape
                </Button>
                <Button
                  className="h-7 justify-start px-2.5 text-[11px]"
                  data-testid="add-line-layer-btn"
                  onClick={() =>
                    commit(
                      "Add vector line/arrow",
                      (d) => addVectorLineArrowLayer(d, lineArrowEnd).doc,
                    )
                  }
                >
                  <Icon name="arrow" size={12} />
                  + Vector Line / Arrow
                </Button>
              </div>
            </div>

            {/* Stage Display Toggles */}
            <div className="border-t border-white/[0.07] pt-3">
              <div className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">
                Canvas Guides
              </div>
              <div className="flex flex-col gap-1.5">
                <Button
                  className="h-7 justify-start px-2.5 text-[11px]"
                  onClick={() => setCheckerboard((c) => !c)}
                >
                  Alpha Checker: {checkerboard ? "On" : "Off"}
                </Button>
                <Button
                  className="h-7 justify-start px-2.5 text-[11px]"
                  onClick={() => setGuides((g) => !g)}
                >
                  Safe Frame: {guides ? "On" : "Off"}
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-white/[0.07] bg-ink-950/70 p-2.5 text-[10.5px] text-ink-400">
            <div className="font-semibold text-ink-200">Non-Destructive Save</div>
            <p className="mt-0.5">
              Saving creates a new revision in Image History while preserving the original asset.
            </p>
          </div>
        </aside>

        {/* CENTER: EDITING CANVAS */}
        <main
          data-testid="manual-editor-canvas-stage"
          className="relative flex flex-col items-center justify-center overflow-auto bg-ink-950 p-6"
        >
          <div className="mb-2.5 flex items-center gap-3 text-[11px] text-ink-400">
            <span>
              Canvas: <strong className="font-mono text-ink-200">{editorDoc.width} × {editorDoc.height} px</strong>
            </span>
            <span>·</span>
            <span>
              Active Tool:{" "}
              <strong className="text-accent-300">
                {MANUAL_TOOLS.find((t) => t.id === editorDoc.activeTool)?.label}
              </strong>
            </span>
            {selectedLayer ? (
              <>
                <span>·</span>
                <span>
                  Target Layer:{" "}
                  <strong className="text-ink-100">{selectedLayer.name}</strong> (
                  {selectedLayer.isVector ? "Vector" : "Raster"})
                </span>
              </>
            ) : null}
          </div>

          <div
            className={`relative overflow-hidden rounded-xl border border-white/15 shadow-2xl ${
              checkerboard ? "artwork-checker" : "bg-ink-900"
            }`}
            style={{
              width: `${Math.round(editorDoc.width * (editorDoc.zoom / 100))}px`,
              height: `${Math.round(editorDoc.height * (editorDoc.zoom / 100))}px`,
            }}
          >
            <svg
              ref={stageSvgRef}
              data-testid="manual-editor-svg-surface"
              viewBox={`0 0 ${editorDoc.width} ${editorDoc.height}`}
              width="100%"
              height="100%"
              style={{
                cursor:
                  MANUAL_TOOLS.find((t) => t.id === editorDoc.activeTool)?.cursor ??
                  "default",
                userSelect: "none",
                touchAction: "none",
              }}
              onPointerDown={handleStagePointerDown}
              onPointerMove={handleStagePointerMove}
              onPointerUp={handleStagePointerUp}
            >
              {/* Rendered composite of all visible layers */}
              <g
                dangerouslySetInnerHTML={{
                  __html: renderedSvgMarkup
                    .replace(/^<svg[^>]*>/i, "")
                    .replace(/<\/svg>$/i, ""),
                }}
              />

              {/* Live stroke preview while dragging brush/freehand */}
              {activePoints.length > 1 ? (
                <polyline
                  points={activePoints.map((p) => `${p.x},${p.y}`).join(" ")}
                  fill="none"
                  stroke={
                    editorDoc.activeTool === "eraser"
                      ? "#ef4444"
                      : editorDoc.brush.color
                  }
                  strokeWidth={editorDoc.brush.size}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={editorDoc.brush.opacity}
                />
              ) : null}

              {/* Selected layer bounding box guide */}
              {selectedLayer && guides ? (
                <rect
                  x={selectedLayer.x}
                  y={selectedLayer.y}
                  width={selectedLayer.width}
                  height={selectedLayer.height}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  pointerEvents="none"
                />
              ) : null}
            </svg>

            {guides ? (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-4 rounded-lg border border-dashed border-white/15"
              />
            ) : null}
          </div>
        </main>

        {/* RIGHT: LAYERS AND PROPERTIES */}
        <aside
          data-testid="manual-editor-inspector"
          aria-label="Layers and Properties"
          className="space-y-4 overflow-y-auto border-l border-white/[0.07] bg-ink-900/95 p-4 text-[11.5px]"
        >
          {/* 1. LAYERS & MASKING PANEL */}
          <section className="rounded-xl border border-white/[0.08] bg-ink-950/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10.5px] font-semibold tracking-[0.14em] text-ink-300 uppercase">
                Layers ({editorDoc.layers.length})
              </h3>
              <div className="flex items-center gap-1">
                <Button
                  className="h-6 px-2 text-[10px]"
                  data-testid="mask-bottom-with-top-btn"
                  title="Mask bottom layer with the top layer"
                  disabled={editorDoc.layers.length < 2}
                  onClick={() =>
                    commit("Mask bottom with top", (d) => maskBottomWithTop(d))
                  }
                >
                  Mask bottom with top
                </Button>
                <Button
                  className="h-6 px-2 text-[10px]"
                  data-testid="remove-mask-btn"
                  title="Remove active clipping mask"
                  disabled={
                    !selectedLayer ||
                    (!selectedLayer.maskedByLayerId && !selectedLayer.isMaskSourceForLayerId)
                  }
                  onClick={() =>
                    commit("Remove mask", (d) => removeMask(d, selectedLayer?.id))
                  }
                >
                  Remove mask
                </Button>
              </div>
            </div>

            <div className="max-h-48 space-y-1 overflow-y-auto pr-0.5">
              {editorDoc.layers.map((layer, idx) => {
                const isSelected = layer.id === selectedLayer?.id;
                return (
                  <div
                    key={layer.id}
                    data-testid={`editor-layer-row-${layer.id}`}
                    onClick={() => commit("Select layer", (d) => selectLayer(d, layer.id))}
                    className={`flex cursor-pointer items-center justify-between gap-1.5 rounded-md border px-2 py-1.5 transition ${
                      isSelected
                        ? "border-accent-500/50 bg-accent-500/15 text-ink-50"
                        : "border-white/[0.05] bg-ink-900/70 text-ink-300 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      <button
                        type="button"
                        aria-label={layer.visible ? "Hide layer" : "Show layer"}
                        onClick={(e) => {
                          e.stopPropagation();
                          commit("Toggle layer visibility", (d) =>
                            updateLayer(d, layer.id, { visible: !layer.visible }),
                          );
                        }}
                        className="text-ink-400 hover:text-ink-100"
                      >
                        <Icon name={layer.visible ? "eye" : "eye-off"} size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
                        onClick={(e) => {
                          e.stopPropagation();
                          commit("Toggle layer lock", (d) =>
                            updateLayer(d, layer.id, { locked: !layer.locked }),
                          );
                        }}
                        className="text-ink-400 hover:text-ink-100"
                      >
                        <Icon name={layer.locked ? "lock" : "unlock"} size={12} />
                      </button>
                      <span className="truncate font-medium">{layer.name}</span>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] ${
                          layer.isVector
                            ? "border border-sky-500/30 bg-sky-500/15 text-sky-300"
                            : "border border-emerald-500/30 bg-emerald-500/15 text-emerald-300"
                        }`}
                      >
                        {layer.isVector ? "Vector" : "Raster"}
                      </span>
                      {layer.maskedByLayerId ? (
                        <span className="rounded border border-amber-500/40 bg-amber-500/15 px-1 py-0.5 font-mono text-[9px] text-amber-300">
                          Masked
                        </span>
                      ) : null}
                      {layer.isMaskSourceForLayerId ? (
                        <span className="rounded border border-purple-500/40 bg-purple-500/15 px-1 py-0.5 font-mono text-[9px] text-purple-300">
                          Mask Top
                        </span>
                      ) : null}
                      <button
                        type="button"
                        title="Move layer up"
                        disabled={idx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          commit("Move layer up", (d) => reorderLayer(d, layer.id, "up"));
                        }}
                        className="p-0.5 text-ink-400 hover:text-ink-100 disabled:opacity-30"
                      >
                        <Icon name="arrow-up" size={11} />
                      </button>
                      <button
                        type="button"
                        title="Move layer down"
                        disabled={idx === editorDoc.layers.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          commit("Move layer down", (d) => reorderLayer(d, layer.id, "down"));
                        }}
                        className="p-0.5 text-ink-400 hover:text-ink-100 disabled:opacity-30"
                      >
                        <Icon name="arrow-down" size={11} />
                      </button>
                      <button
                        type="button"
                        title="Duplicate layer"
                        onClick={(e) => {
                          e.stopPropagation();
                          commit("Duplicate layer", (d) => duplicateLayer(d, layer.id).doc);
                        }}
                        className="p-0.5 text-ink-400 hover:text-ink-100"
                      >
                        <Icon name="copy" size={11} />
                      </button>
                      <button
                        type="button"
                        title="Delete layer"
                        disabled={editorDoc.layers.length <= 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          commit("Delete layer", (d) => deleteLayer(d, layer.id));
                        }}
                        className="p-0.5 text-rose-400 hover:text-rose-300 disabled:opacity-30"
                      >
                        <Icon name="trash" size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedLayer ? (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/[0.06] pt-2.5">
                <Field label="Blend mode">
                  <Select
                    aria-label="Blend mode"
                    data-testid="layer-blend-mode-select"
                    className="creation-input h-7 text-[11px]"
                    value={selectedLayer.blendMode}
                    onChange={(e) =>
                      commit("Change layer blend mode", (d) =>
                        updateLayer(d, selectedLayer.id, {
                          blendMode: e.target.value as EditorBlendMode,
                        }),
                      )
                    }
                  >
                    {DOCUMENTED_BLEND_MODES.map((bm) => (
                      <option key={bm.id} value={bm.id}>
                        {bm.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={`Layer Opacity (${Math.round(selectedLayer.opacity * 100)}%)`}>
                  <input
                    type="range"
                    aria-label="Layer opacity"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedLayer.opacity}
                    onChange={(e) =>
                      commit(
                        "Change layer opacity",
                        (d) =>
                          updateLayer(d, selectedLayer.id, {
                            opacity: Number(e.target.value),
                          }),
                        `opacity-${selectedLayer.id}`,
                      )
                    }
                    className="mt-1.5 w-full accent-accent-500"
                  />
                </Field>

                {selectedLayer.isVector ? (
                  <div className="col-span-2 flex items-center justify-between rounded border border-sky-500/25 bg-sky-500/10 px-2.5 py-1.5 text-[10.5px]">
                    <span className="text-sky-200">
                      Vector object — pixel tools require rasterization.
                    </span>
                    <Button
                      className="h-6 px-2 text-[10px]"
                      data-testid="rasterize-vector-btn"
                      onClick={() =>
                        setRasterizeModalState({
                          layerId: selectedLayer.id,
                          layerName: selectedLayer.name,
                        })
                      }
                    >
                      Rasterize...
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          {/* 2. COLOR & TWO-STOP GRADIENT PANEL */}
          <section className="rounded-xl border border-white/[0.08] bg-ink-950/60 p-3">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10.5px] font-semibold tracking-[0.14em] text-ink-300 uppercase">
                Color & Gradients
              </h3>
              <Button
                className="h-6 px-2 text-[10px]"
                data-testid="color-eyedropper-btn"
                onClick={() => commit("Activate eyedropper", (d) => selectTool(d, "eyedropper"))}
              >
                <Icon name="pipette" size={11} />
                Eyedropper (I)
              </Button>
            </div>

            <div className="grid grid-cols-[auto_1fr] items-center gap-2">
              <input
                type="color"
                aria-label="Color picker"
                value={editorDoc.color.hex}
                onChange={(e) =>
                  commit("Pick hex color", (d) => updateEditorColorHex(d, e.target.value))
                }
                className="h-8 w-10 cursor-pointer rounded border border-white/15 bg-transparent"
              />
              <Field label="Hex">
                <input
                  type="text"
                  aria-label="Hex color"
                  data-testid="color-hex-input"
                  value={editorDoc.color.hex}
                  onChange={(e) =>
                    commit("Edit hex color", (d) => updateEditorColorHex(d, e.target.value))
                  }
                  className="creation-input h-7 font-mono text-[11px]"
                />
              </Field>
            </div>

            {/* RGBA numeric fields */}
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              <Field label="R">
                <input
                  type="number"
                  aria-label="Red"
                  min={0}
                  max={255}
                  value={editorDoc.color.rgba.r}
                  onChange={(e) =>
                    commit("Edit RGBA R", (d) =>
                      updateEditorColorRgba(d, { r: Number(e.target.value) }),
                    )
                  }
                  className="creation-input h-7 font-mono text-[11px]"
                />
              </Field>
              <Field label="G">
                <input
                  type="number"
                  aria-label="Green"
                  min={0}
                  max={255}
                  value={editorDoc.color.rgba.g}
                  onChange={(e) =>
                    commit("Edit RGBA G", (d) =>
                      updateEditorColorRgba(d, { g: Number(e.target.value) }),
                    )
                  }
                  className="creation-input h-7 font-mono text-[11px]"
                />
              </Field>
              <Field label="B">
                <input
                  type="number"
                  aria-label="Blue"
                  min={0}
                  max={255}
                  value={editorDoc.color.rgba.b}
                  onChange={(e) =>
                    commit("Edit RGBA B", (d) =>
                      updateEditorColorRgba(d, { b: Number(e.target.value) }),
                    )
                  }
                  className="creation-input h-7 font-mono text-[11px]"
                />
              </Field>
              <Field label="A">
                <input
                  type="number"
                  aria-label="Alpha"
                  min={0}
                  max={1}
                  step={0.05}
                  value={editorDoc.color.rgba.a}
                  onChange={(e) =>
                    commit("Edit RGBA A", (d) =>
                      updateEditorColorRgba(d, { a: Number(e.target.value) }),
                    )
                  }
                  className="creation-input h-7 font-mono text-[11px]"
                />
              </Field>
            </div>

            {/* Recent Swatches */}
            <div className="mt-2.5">
              <div className="mb-1 text-[10px] text-ink-400">Recent Swatches</div>
              <div
                data-testid="recent-swatches"
                className="flex flex-wrap items-center gap-1.5"
              >
                {editorDoc.color.recentSwatches.map((sw) => (
                  <button
                    key={sw}
                    type="button"
                    title={sw}
                    aria-label={`Swatch ${sw}`}
                    onClick={() => commit(`Select swatch ${sw}`, (d) => updateEditorColorHex(d, sw))}
                    className={`h-5 w-5 rounded border transition ${
                      editorDoc.color.hex === sw
                        ? "scale-110 border-white ring-1 ring-accent-400"
                        : "border-white/20 hover:scale-105"
                    }`}
                    style={{ backgroundColor: sw }}
                  />
                ))}
              </div>
            </div>

            {/* Two-Stop Gradient */}
            <div className="mt-3 border-t border-white/[0.06] pt-2.5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-ink-200">
                  <input
                    type="checkbox"
                    aria-label="Enable two-stop gradient"
                    checked={editorDoc.color.gradient.enabled}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      commit("Toggle two-stop gradient", (d) => {
                        let next = updateEditorGradient(d, { enabled });
                        if (selectedLayer?.textProps) {
                          next = updateLayerTextProps(next, selectedLayer.id, {
                            gradient: { ...next.color.gradient, enabled },
                          });
                        }
                        if (selectedLayer?.shapeProps) {
                          next = updateLayerShapeProps(next, selectedLayer.id, {
                            gradient: { ...next.color.gradient, enabled },
                          });
                        }
                        return next;
                      });
                    }}
                  />
                  Two-Stop Gradient
                </label>
                <div
                  className="h-4 w-20 rounded border border-white/15"
                  style={{ background: gradientToCss(editorDoc.color.gradient) }}
                />
              </div>

              <div className="mt-2 grid grid-cols-3 gap-1.5">
                <Field label="Stop 1">
                  <input
                    type="text"
                    aria-label="Gradient stop 1 color"
                    value={editorDoc.color.gradient.startColor}
                    onChange={(e) =>
                      commit("Edit gradient stop 1", (d) => {
                        const next = updateEditorGradient(d, { startColor: e.target.value });
                        if (selectedLayer?.shapeProps) {
                          return updateLayerShapeProps(next, selectedLayer.id, {
                            gradient: next.color.gradient,
                          });
                        }
                        if (selectedLayer?.textProps) {
                          return updateLayerTextProps(next, selectedLayer.id, {
                            gradient: next.color.gradient,
                          });
                        }
                        return next;
                      })
                    }
                    className="creation-input h-7 font-mono text-[10.5px]"
                  />
                </Field>
                <Field label="Stop 2">
                  <input
                    type="text"
                    aria-label="Gradient stop 2 color"
                    value={editorDoc.color.gradient.endColor}
                    onChange={(e) =>
                      commit("Edit gradient stop 2", (d) => {
                        const next = updateEditorGradient(d, { endColor: e.target.value });
                        if (selectedLayer?.shapeProps) {
                          return updateLayerShapeProps(next, selectedLayer.id, {
                            gradient: next.color.gradient,
                          });
                        }
                        if (selectedLayer?.textProps) {
                          return updateLayerTextProps(next, selectedLayer.id, {
                            gradient: next.color.gradient,
                          });
                        }
                        return next;
                      })
                    }
                    className="creation-input h-7 font-mono text-[10.5px]"
                  />
                </Field>
                <Field label="Angle (°)">
                  <input
                    type="number"
                    aria-label="Gradient angle"
                    min={0}
                    max={360}
                    value={editorDoc.color.gradient.angle}
                    onChange={(e) =>
                      commit("Edit gradient angle", (d) =>
                        updateEditorGradient(d, { angle: Number(e.target.value) }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[10.5px]"
                  />
                </Field>
              </div>
            </div>
          </section>

          {/* 3. BRUSH PROPERTIES (color, size, hardness, opacity, stabilization) */}
          <section
            data-testid="brush-properties-panel"
            className="rounded-xl border border-white/[0.08] bg-ink-950/60 p-3"
          >
            <h3 className="mb-2 text-[10.5px] font-semibold tracking-[0.14em] text-ink-300 uppercase">
              Brush Properties
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Brush Color">
                <input
                  type="text"
                  aria-label="Brush color"
                  value={editorDoc.brush.color}
                  onChange={(e) =>
                    commit("Change brush color", (d) =>
                      updateBrushSettings(d, { color: e.target.value }),
                    )
                  }
                  className="creation-input h-7 font-mono text-[11px]"
                />
              </Field>
              <Field label={`Size (${editorDoc.brush.size}px)`}>
                <input
                  type="range"
                  aria-label="Brush size"
                  min={1}
                  max={200}
                  value={editorDoc.brush.size}
                  onChange={(e) =>
                    commit(
                      "Change brush size",
                      (d) => updateBrushSettings(d, { size: Number(e.target.value) }),
                      "brush-size",
                    )
                  }
                  className="mt-1.5 w-full accent-accent-500"
                />
              </Field>
              <Field label={`Hardness (${editorDoc.brush.hardness}%)`}>
                <input
                  type="range"
                  aria-label="Brush hardness"
                  min={0}
                  max={100}
                  value={editorDoc.brush.hardness}
                  onChange={(e) =>
                    commit(
                      "Change brush hardness",
                      (d) => updateBrushSettings(d, { hardness: Number(e.target.value) }),
                      "brush-hardness",
                    )
                  }
                  className="mt-1.5 w-full accent-accent-500"
                />
              </Field>
              <Field label={`Opacity (${Math.round(editorDoc.brush.opacity * 100)}%)`}>
                <input
                  type="range"
                  aria-label="Brush opacity"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={editorDoc.brush.opacity}
                  onChange={(e) =>
                    commit(
                      "Change brush opacity",
                      (d) => updateBrushSettings(d, { opacity: Number(e.target.value) }),
                      "brush-opacity",
                    )
                  }
                  className="mt-1.5 w-full accent-accent-500"
                />
              </Field>
              <div className="col-span-2">
                <Field label={`Stabilization (${editorDoc.brush.stabilization}%)`}>
                  <input
                    type="range"
                    aria-label="Brush stabilization"
                    min={0}
                    max={100}
                    value={editorDoc.brush.stabilization}
                    onChange={(e) =>
                      commit(
                        "Change brush stabilization",
                        (d) => updateBrushSettings(d, { stabilization: Number(e.target.value) }),
                        "brush-stabilization",
                      )
                    }
                    className="mt-1 w-full accent-accent-500"
                  />
                </Field>
              </div>
            </div>
          </section>

          {/* 4. TEXT PROPERTIES (font, weight, style, alignment, size, fill, gradient, outline, letter spacing, line height) */}
          <section
            data-testid="text-properties-panel"
            className="rounded-xl border border-white/[0.08] bg-ink-950/60 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10.5px] font-semibold tracking-[0.14em] text-ink-300 uppercase">
                Text Properties
              </h3>
              {!selectedLayer?.textProps ? (
                <Button
                  className="h-6 px-2 text-[10px]"
                  onClick={() => commit("Create text layer", (d) => addVectorTextLayer(d).doc)}
                >
                  + Add Text Layer
                </Button>
              ) : null}
            </div>

            {selectedLayer?.textProps ? (
              <div className="space-y-2">
                <Field label="Text Content">
                  <input
                    type="text"
                    aria-label="Text content"
                    value={selectedLayer.textProps.text}
                    onChange={(e) =>
                      commit("Edit text content", (d) =>
                        updateLayerTextProps(d, selectedLayer.id, { text: e.target.value }),
                      )
                    }
                    className="creation-input h-7 text-[11px]"
                  />
                </Field>

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Font">
                    <Select
                      aria-label="Text font"
                      className="creation-input h-7 text-[11px]"
                      value={selectedLayer.textProps.font}
                      onChange={(e) =>
                        commit("Change text font", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, { font: e.target.value }),
                        )
                      }
                    >
                      {FONT_FAMILIES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Weight">
                    <Select
                      aria-label="Text weight"
                      className="creation-input h-7 text-[11px]"
                      value={String(selectedLayer.textProps.weight)}
                      onChange={(e) =>
                        commit("Change text weight", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, {
                            weight: Number(e.target.value),
                          }),
                        )
                      }
                    >
                      {FONT_WEIGHTS.map((w) => (
                        <option key={w} value={w}>
                          {w}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="Style">
                    <Select
                      aria-label="Text style"
                      className="creation-input h-7 text-[11px]"
                      value={selectedLayer.textProps.style}
                      onChange={(e) =>
                        commit("Change text style", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, {
                            style: e.target.value as TextFontStyle,
                          }),
                        )
                      }
                    >
                      <option value="normal">Normal</option>
                      <option value="italic">Italic</option>
                    </Select>
                  </Field>

                  <Field label="Alignment">
                    <Select
                      aria-label="Text alignment"
                      className="creation-input h-7 text-[11px]"
                      value={selectedLayer.textProps.alignment}
                      onChange={(e) =>
                        commit("Change text alignment", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, {
                            alignment: e.target.value as TextAlignment,
                          }),
                        )
                      }
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </Select>
                  </Field>

                  <Field label="Size (px)">
                    <input
                      type="number"
                      aria-label="Text size"
                      min={8}
                      max={240}
                      value={selectedLayer.textProps.size}
                      onChange={(e) =>
                        commit("Change text size", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, {
                            size: Number(e.target.value),
                          }),
                        )
                      }
                      className="creation-input h-7 font-mono text-[11px]"
                    />
                  </Field>

                  <Field label="Fill">
                    <input
                      type="text"
                      aria-label="Text fill"
                      value={selectedLayer.textProps.fill}
                      onChange={(e) =>
                        commit("Change text fill", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, { fill: e.target.value }),
                        )
                      }
                      className="creation-input h-7 font-mono text-[11px]"
                    />
                  </Field>

                  <Field label="Outline Color">
                    <input
                      type="text"
                      aria-label="Text outline color"
                      value={selectedLayer.textProps.outlineColor}
                      onChange={(e) =>
                        commit("Change text outline color", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, {
                            outlineColor: e.target.value,
                          }),
                        )
                      }
                      className="creation-input h-7 font-mono text-[11px]"
                    />
                  </Field>

                  <Field label="Outline Width">
                    <input
                      type="number"
                      aria-label="Text outline width"
                      min={0}
                      max={24}
                      value={selectedLayer.textProps.outlineWidth}
                      onChange={(e) =>
                        commit("Change text outline width", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, {
                            outlineWidth: Number(e.target.value),
                          }),
                        )
                      }
                      className="creation-input h-7 font-mono text-[11px]"
                    />
                  </Field>

                  <Field label="Letter Spacing">
                    <input
                      type="number"
                      aria-label="Text letter spacing"
                      min={-10}
                      max={40}
                      value={selectedLayer.textProps.letterSpacing}
                      onChange={(e) =>
                        commit("Change letter spacing", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, {
                            letterSpacing: Number(e.target.value),
                          }),
                        )
                      }
                      className="creation-input h-7 font-mono text-[11px]"
                    />
                  </Field>

                  <Field label="Line Height">
                    <input
                      type="number"
                      aria-label="Text line height"
                      min={0.8}
                      max={2.5}
                      step={0.1}
                      value={selectedLayer.textProps.lineHeight}
                      onChange={(e) =>
                        commit("Change line height", (d) =>
                          updateLayerTextProps(d, selectedLayer.id, {
                            lineHeight: Number(e.target.value),
                          }),
                        )
                      }
                      className="creation-input h-7 font-mono text-[11px]"
                    />
                  </Field>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-ink-400">
                Select or add a Text layer to configure font, weight, style, alignment, size, fill,
                gradient, outline, letter spacing, and line height.
              </p>
            )}
          </section>

          {/* 5. SHAPE & LINE PROPERTIES (fill, gradient, stroke, width, corner radius, polygon points) */}
          <section
            data-testid="shape-properties-panel"
            className="rounded-xl border border-white/[0.08] bg-ink-950/60 p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[10.5px] font-semibold tracking-[0.14em] text-ink-300 uppercase">
                Shape & Line Properties
              </h3>
              <div className="flex items-center gap-1">
                <Select
                  aria-label="New shape preset"
                  className="creation-input h-6 px-1.5 text-[10px]"
                  value={shapePreset}
                  onChange={(e) => setShapePreset(e.target.value as ShapeKind)}
                >
                  <option value="rounded_rect">Rounded Rect</option>
                  <option value="rect">Rectangle</option>
                  <option value="ellipse">Ellipse</option>
                  <option value="triangle">Triangle</option>
                  <option value="polygon">Polygon</option>
                </Select>
                <label className="flex items-center gap-1 text-[10px] text-ink-300">
                  <input
                    type="checkbox"
                    checked={lineArrowEnd}
                    onChange={(e) => setLineArrowEnd(e.target.checked)}
                  />
                  Arrow
                </label>
              </div>
            </div>

            {selectedLayer?.shapeProps ? (
              <div className="grid grid-cols-2 gap-2">
                <Field label="Shape Type">
                  <Select
                    aria-label="Shape type"
                    className="creation-input h-7 text-[11px]"
                    value={selectedLayer.shapeProps.shapeKind}
                    onChange={(e) =>
                      commit("Change shape kind", (d) =>
                        updateLayerShapeProps(d, selectedLayer.id, {
                          shapeKind: e.target.value as ShapeKind,
                        }),
                      )
                    }
                  >
                    <option value="rect">Rectangle</option>
                    <option value="rounded_rect">Rounded Rect</option>
                    <option value="ellipse">Ellipse</option>
                    <option value="triangle">Triangle</option>
                    <option value="polygon">Polygon</option>
                  </Select>
                </Field>

                <Field label="Fill">
                  <input
                    type="text"
                    aria-label="Shape fill"
                    value={selectedLayer.shapeProps.fill}
                    onChange={(e) =>
                      commit("Change shape fill", (d) =>
                        updateLayerShapeProps(d, selectedLayer.id, { fill: e.target.value }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>

                <Field label="Stroke">
                  <input
                    type="text"
                    aria-label="Shape stroke"
                    value={selectedLayer.shapeProps.stroke}
                    onChange={(e) =>
                      commit("Change shape stroke", (d) =>
                        updateLayerShapeProps(d, selectedLayer.id, { stroke: e.target.value }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>

                <Field label="Stroke Width">
                  <input
                    type="number"
                    aria-label="Shape stroke width"
                    min={0}
                    max={60}
                    value={selectedLayer.shapeProps.width}
                    onChange={(e) =>
                      commit("Change shape stroke width", (d) =>
                        updateLayerShapeProps(d, selectedLayer.id, {
                          width: Number(e.target.value),
                        }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>

                <Field label="Corner Radius">
                  <input
                    type="number"
                    aria-label="Shape corner radius"
                    min={0}
                    max={200}
                    value={selectedLayer.shapeProps.cornerRadius}
                    onChange={(e) =>
                      commit("Change corner radius", (d) =>
                        updateLayerShapeProps(d, selectedLayer.id, {
                          cornerRadius: Number(e.target.value),
                        }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>

                <Field label="Polygon Points">
                  <input
                    type="number"
                    aria-label="Shape polygon points"
                    min={3}
                    max={12}
                    value={selectedLayer.shapeProps.polygonPoints}
                    onChange={(e) =>
                      commit("Change polygon points", (d) =>
                        updateLayerShapeProps(d, selectedLayer.id, {
                          polygonPoints: Number(e.target.value),
                        }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>
              </div>
            ) : (
              <p className="text-[11px] text-ink-400">
                Select or add a Shape / Line layer to edit fill, gradient, stroke, width, corner
                radius, and polygon points.
              </p>
            )}
          </section>

          {/* 6. ADJUSTMENTS PANEL (Brightness, Contrast, Saturation, Vibrance, Hue, Blur, Tint, Sharpen, Grayscale, Invert) */}
          {selectedLayer ? (
            <section
              data-testid="adjustments-panel"
              className="rounded-xl border border-white/[0.08] bg-ink-950/60 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[10.5px] font-semibold tracking-[0.14em] text-ink-300 uppercase">
                  Adjustments
                </h3>
                <Button
                  className="h-6 px-2 text-[10px]"
                  onClick={() =>
                    commit("Reset layer adjustments", (d) =>
                      resetLayerAdjustments(d, selectedLayer.id),
                    )
                  }
                >
                  Reset
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label={`Brightness (${selectedLayer.adjustments.brightness})`}>
                  <input
                    type="range"
                    aria-label="Brightness"
                    min={-100}
                    max={100}
                    value={selectedLayer.adjustments.brightness}
                    onChange={(e) =>
                      commit(
                        "Adjust brightness",
                        (d) =>
                          updateLayerAdjustments(d, selectedLayer.id, {
                            brightness: Number(e.target.value),
                          }),
                        `adj-brightness-${selectedLayer.id}`,
                      )
                    }
                    className="w-full accent-accent-500"
                  />
                </Field>

                <Field label={`Contrast (${selectedLayer.adjustments.contrast})`}>
                  <input
                    type="range"
                    aria-label="Contrast"
                    min={-100}
                    max={100}
                    value={selectedLayer.adjustments.contrast}
                    onChange={(e) =>
                      commit(
                        "Adjust contrast",
                        (d) =>
                          updateLayerAdjustments(d, selectedLayer.id, {
                            contrast: Number(e.target.value),
                          }),
                        `adj-contrast-${selectedLayer.id}`,
                      )
                    }
                    className="w-full accent-accent-500"
                  />
                </Field>

                <Field label={`Saturation (${selectedLayer.adjustments.saturation})`}>
                  <input
                    type="range"
                    aria-label="Saturation"
                    min={-100}
                    max={100}
                    value={selectedLayer.adjustments.saturation}
                    onChange={(e) =>
                      commit(
                        "Adjust saturation",
                        (d) =>
                          updateLayerAdjustments(d, selectedLayer.id, {
                            saturation: Number(e.target.value),
                          }),
                        `adj-saturation-${selectedLayer.id}`,
                      )
                    }
                    className="w-full accent-accent-500"
                  />
                </Field>

                <Field label={`Vibrance (${selectedLayer.adjustments.vibrance})`}>
                  <input
                    type="range"
                    aria-label="Vibrance"
                    min={-100}
                    max={100}
                    value={selectedLayer.adjustments.vibrance}
                    onChange={(e) =>
                      commit(
                        "Adjust vibrance",
                        (d) =>
                          updateLayerAdjustments(d, selectedLayer.id, {
                            vibrance: Number(e.target.value),
                          }),
                        `adj-vibrance-${selectedLayer.id}`,
                      )
                    }
                    className="w-full accent-accent-500"
                  />
                </Field>

                <Field label={`Hue (${selectedLayer.adjustments.hue}°)`}>
                  <input
                    type="range"
                    aria-label="Hue"
                    min={-180}
                    max={180}
                    value={selectedLayer.adjustments.hue}
                    onChange={(e) =>
                      commit(
                        "Adjust hue",
                        (d) =>
                          updateLayerAdjustments(d, selectedLayer.id, {
                            hue: Number(e.target.value),
                          }),
                        `adj-hue-${selectedLayer.id}`,
                      )
                    }
                    className="w-full accent-accent-500"
                  />
                </Field>

                <Field label={`Blur (${selectedLayer.adjustments.blur}px)`}>
                  <input
                    type="range"
                    aria-label="Blur"
                    min={0}
                    max={50}
                    value={selectedLayer.adjustments.blur}
                    onChange={(e) =>
                      commit(
                        "Adjust blur",
                        (d) =>
                          updateLayerAdjustments(d, selectedLayer.id, {
                            blur: Number(e.target.value),
                          }),
                        `adj-blur-${selectedLayer.id}`,
                      )
                    }
                    className="w-full accent-accent-500"
                  />
                </Field>

                <Field label="Tint Color">
                  <input
                    type="text"
                    aria-label="Tint color"
                    value={selectedLayer.adjustments.tintColor}
                    onChange={(e) =>
                      commit("Change tint color", (d) =>
                        updateLayerAdjustments(d, selectedLayer.id, {
                          tintColor: e.target.value,
                        }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>

                <Field label={`Tint (${selectedLayer.adjustments.tintAmount}%)`}>
                  <input
                    type="range"
                    aria-label="Tint amount"
                    min={0}
                    max={100}
                    value={selectedLayer.adjustments.tintAmount}
                    onChange={(e) =>
                      commit(
                        "Adjust tint amount",
                        (d) =>
                          updateLayerAdjustments(d, selectedLayer.id, {
                            tintAmount: Number(e.target.value),
                          }),
                        `adj-tint-${selectedLayer.id}`,
                      )
                    }
                    className="mt-1.5 w-full accent-accent-500"
                  />
                </Field>

                <Field label={`Sharpen (${selectedLayer.adjustments.sharpen}%)`}>
                  <input
                    type="range"
                    aria-label="Sharpen"
                    min={0}
                    max={100}
                    value={selectedLayer.adjustments.sharpen}
                    onChange={(e) =>
                      commit(
                        "Adjust sharpen",
                        (d) =>
                          updateLayerAdjustments(d, selectedLayer.id, {
                            sharpen: Number(e.target.value),
                          }),
                        `adj-sharpen-${selectedLayer.id}`,
                      )
                    }
                    className="w-full accent-accent-500"
                  />
                </Field>

                <Field label={`Grayscale (${selectedLayer.adjustments.grayscale}%)`}>
                  <input
                    type="range"
                    aria-label="Grayscale"
                    min={0}
                    max={100}
                    value={selectedLayer.adjustments.grayscale}
                    onChange={(e) =>
                      commit(
                        "Adjust grayscale",
                        (d) =>
                          updateLayerAdjustments(d, selectedLayer.id, {
                            grayscale: Number(e.target.value),
                          }),
                        `adj-grayscale-${selectedLayer.id}`,
                      )
                    }
                    className="w-full accent-accent-500"
                  />
                </Field>

                <div className="col-span-2">
                  <Field label={`Invert (${selectedLayer.adjustments.invert}%)`}>
                    <input
                      type="range"
                      aria-label="Invert"
                      min={0}
                      max={100}
                      value={selectedLayer.adjustments.invert}
                      onChange={(e) =>
                        commit(
                          "Adjust invert",
                          (d) =>
                            updateLayerAdjustments(d, selectedLayer.id, {
                              invert: Number(e.target.value),
                            }),
                          `adj-invert-${selectedLayer.id}`,
                        )
                      }
                      className="w-full accent-accent-500"
                    />
                  </Field>
                </div>
              </div>
            </section>
          ) : null}

          {/* 7. LAYER EFFECTS — DROP SHADOW (color, blur, X offset, Y offset) */}
          {selectedLayer ? (
            <section
              data-testid="drop-shadow-panel"
              className="rounded-xl border border-white/[0.08] bg-ink-950/60 p-3"
            >
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[10.5px] font-semibold tracking-[0.14em] text-ink-300 uppercase">
                  Layer Effects — Drop Shadow
                </h3>
                <label className="flex items-center gap-1.5 text-[11px] text-ink-200">
                  <input
                    type="checkbox"
                    aria-label="Enable drop shadow"
                    checked={selectedLayer.dropShadow.enabled}
                    onChange={(e) =>
                      commit("Toggle drop shadow", (d) =>
                        updateLayerDropShadow(d, selectedLayer.id, {
                          enabled: e.target.checked,
                        }),
                      )
                    }
                  />
                  Enabled
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Shadow Color">
                  <input
                    type="text"
                    aria-label="Drop shadow color"
                    value={selectedLayer.dropShadow.color}
                    onChange={(e) =>
                      commit("Change drop shadow color", (d) =>
                        updateLayerDropShadow(d, selectedLayer.id, {
                          color: e.target.value,
                        }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>
                <Field label="Blur (px)">
                  <input
                    type="number"
                    aria-label="Drop shadow blur"
                    min={0}
                    max={100}
                    value={selectedLayer.dropShadow.blur}
                    onChange={(e) =>
                      commit("Change drop shadow blur", (d) =>
                        updateLayerDropShadow(d, selectedLayer.id, {
                          blur: Number(e.target.value),
                        }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>
                <Field label="X Offset (px)">
                  <input
                    type="number"
                    aria-label="Drop shadow X offset"
                    min={-100}
                    max={100}
                    value={selectedLayer.dropShadow.offsetX}
                    onChange={(e) =>
                      commit("Change drop shadow X offset", (d) =>
                        updateLayerDropShadow(d, selectedLayer.id, {
                          offsetX: Number(e.target.value),
                        }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>
                <Field label="Y Offset (px)">
                  <input
                    type="number"
                    aria-label="Drop shadow Y offset"
                    min={-100}
                    max={100}
                    value={selectedLayer.dropShadow.offsetY}
                    onChange={(e) =>
                      commit("Change drop shadow Y offset", (d) =>
                        updateLayerDropShadow(d, selectedLayer.id, {
                          offsetY: Number(e.target.value),
                        }),
                      )
                    }
                    className="creation-input h-7 font-mono text-[11px]"
                  />
                </Field>
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {/* VECTOR / RASTER CONFIRMATION MODAL: "Rasterize this object?" */}
      {rasterizeModalState ? (
        <Modal
          open={true}
          onClose={() => setRasterizeModalState(null)}
          title={RASTERIZE_CONFIRMATION_MESSAGE}
          description={`Layer “${rasterizeModalState.layerName}” is currently a vector object.`}
        >
          <div data-testid="rasterize-confirm-modal" className="space-y-4">
            <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 text-[12px] text-amber-200">
              <p className="font-semibold">{RASTERIZE_CONFIRMATION_MESSAGE}</p>
              <p className="mt-1 text-[11.5px] text-amber-200/85">
                Pixel-editing tools (Paint Brush, Eraser, Blur Brush) operate on raster pixels.
                Confirming will convert “{rasterizeModalState.layerName}” into a raster layer so
                you can paint or erase on it.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                data-testid="cancel-rasterize-btn"
                onClick={() => setRasterizeModalState(null)}
              >
                Keep Vector (Cancel)
              </Button>
              <Button
                variant="primary"
                data-testid="confirm-rasterize-btn"
                onClick={() => {
                  const target = rasterizeModalState;
                  setRasterizeModalState(null);
                  commit(`Rasterize ${target.layerName}`, (d) => {
                    if (target.pendingStroke) {
                      return applyPixelToolStroke(
                        d,
                        target.layerId,
                        target.pendingStroke,
                        { confirmRasterize: true },
                      ).doc;
                    }
                    return rasterizeLayer(d, target.layerId);
                  });
                }}
              >
                Rasterize Object
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}

      <Toasts
        toasts={designEditor.toasts}
        onDismiss={designEditor.dismissToast}
        onUndo={handleUndo}
        canUndo={canUndo}
      />
    </div>
  );
}
