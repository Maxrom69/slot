import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";

// Bypass Next.js "server-only" and "next/cache" guards in Node test runner before importing server services
const mod = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const origLoad = mod._load;
mod._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "next/cache") {
    return { revalidatePath: () => undefined };
  }
  return origLoad.call(this, request, parent, isMain);
};

import { createBlueprint } from "../src/lib/blueprint/factory";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { commitHistory, createHistory, redoHistory, undoHistory } from "../src/lib/design/history";
import { designDocFromBlueprint, migrateDoc } from "../src/lib/design/migrate";
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
  buildLayerCssFilter,
  buildPolygonPointsAttr,
  createInitialManualEditorDoc,
  maskBottomWithTop,
  rasterizeLayer,
  removeMask,
  renderManualEditorToDataUrl,
  renderManualEditorToSvg,
  requiresRasterizationConfirmation,
  resetLayerAdjustments,
  sampleEyedropperAtPoint,
  saveManualEditToDesignDoc,
  selectTool,
  setEditorFullscreen,
  setEditorZoom,
  stabilizePoints,
  updateBrushSettings,
  updateEditorColorHex,
  updateEditorColorRgba,
  updateEditorGradient,
  updateLayer,
  updateLayerAdjustments,
  updateLayerDropShadow,
  updateLayerShapeProps,
  updateLayerTextProps,
} from "../src/lib/manual-editor";

test("F13 Tools, Top Controls & Properties: registers all 9 tools with shortcuts and supports brush, text, and shape properties", () => {
  const toolIds = MANUAL_TOOLS.map((t) => t.id);
  assert.deepEqual(toolIds, [
    "select",
    "brush",
    "eraser",
    "blur_brush",
    "freehand",
    "eyedropper",
    "text",
    "shapes",
    "line_arrow",
  ]);
  assert.equal(MANUAL_SHORTCUT_TO_TOOL.v, "select");
  assert.equal(MANUAL_SHORTCUT_TO_TOOL.b, "brush");
  assert.equal(MANUAL_SHORTCUT_TO_TOOL.e, "eraser");
  assert.equal(MANUAL_SHORTCUT_TO_TOOL.u, "blur_brush");
  assert.equal(MANUAL_SHORTCUT_TO_TOOL.i, "eyedropper");

  let doc = createInitialManualEditorDoc({ width: 640, height: 480 });
  doc = setEditorZoom(doc, 150);
  doc = setEditorFullscreen(doc, true);
  assert.equal(doc.zoom, 150);
  assert.equal(doc.fullscreen, true);

  // 1. Brush properties: color, size, hardness, opacity, stabilization
  doc = updateBrushSettings(doc, {
    color: "#ff3366",
    size: 42,
    hardness: 65,
    opacity: 0.8,
    stabilization: 60,
  });
  assert.equal(doc.brush.color, "#ff3366");
  assert.equal(doc.brush.size, 42);
  assert.equal(doc.brush.hardness, 65);
  assert.equal(doc.brush.opacity, 0.8);
  assert.equal(doc.brush.stabilization, 60);

  const rawPts = [
    { x: 10, y: 10 },
    { x: 50, y: 90 },
    { x: 90, y: 20 },
  ];
  const smoothed = stabilizePoints(rawPts, 60);
  assert.equal(smoothed.length, 3);
  assert.notEqual(smoothed[1]!.y, 90, "Stabilization smooths intermediate point");

  // 2. Text properties: font, weight, style, alignment, size, fill, gradient, outline, letter spacing, line height
  const addedText = addVectorTextLayer(doc, { text: "JACKPOT" });
  doc = addedText.doc;
  doc = updateLayerTextProps(doc, addedText.layerId, {
    font: "Playfair Display",
    weight: 800,
    style: "italic",
    alignment: "right",
    size: 64,
    fill: "#ffd700",
    gradient: {
      enabled: true,
      startColor: "#fffbeb",
      endColor: "#d97706",
      startStop: 10,
      endStop: 90,
      angle: 180,
    },
    outlineColor: "#1e1b4b",
    outlineWidth: 4,
    letterSpacing: 6,
    lineHeight: 1.4,
  });
  const textLayer = doc.layers.find((l) => l.id === addedText.layerId)!;
  assert.equal(textLayer.textProps?.font, "Playfair Display");
  assert.equal(textLayer.textProps?.weight, 800);
  assert.equal(textLayer.textProps?.style, "italic");
  assert.equal(textLayer.textProps?.alignment, "right");
  assert.equal(textLayer.textProps?.size, 64);
  assert.equal(textLayer.textProps?.fill, "#ffd700");
  assert.equal(textLayer.textProps?.gradient.enabled, true);
  assert.equal(textLayer.textProps?.outlineColor, "#1e1b4b");
  assert.equal(textLayer.textProps?.outlineWidth, 4);
  assert.equal(textLayer.textProps?.letterSpacing, 6);
  assert.equal(textLayer.textProps?.lineHeight, 1.4);

  // 3. Shape properties: fill, gradient, stroke, width, corner radius, polygon points
  const addedShape = addVectorShapeLayer(doc, "polygon");
  doc = addedShape.doc;
  doc = updateLayerShapeProps(doc, addedShape.layerId, {
    fill: "#10b981",
    gradient: {
      enabled: true,
      startColor: "#34d399",
      endColor: "#065f46",
      startStop: 0,
      endStop: 100,
      angle: 45,
    },
    stroke: "#ecfdf5",
    width: 5,
    cornerRadius: 18,
    polygonPoints: 8,
  });
  const shapeLayer = doc.layers.find((l) => l.id === addedShape.layerId)!;
  assert.equal(shapeLayer.shapeProps?.fill, "#10b981");
  assert.equal(shapeLayer.shapeProps?.gradient.enabled, true);
  assert.equal(shapeLayer.shapeProps?.stroke, "#ecfdf5");
  assert.equal(shapeLayer.shapeProps?.width, 5);
  assert.equal(shapeLayer.shapeProps?.cornerRadius, 18);
  assert.equal(shapeLayer.shapeProps?.polygonPoints, 8);
  assert.equal(buildPolygonPointsAttr(0, 0, 100, 100, 8).split(" ").length, 8);

  // 4. Lines / Arrows & Freehand Draw
  doc = addVectorLineArrowLayer(doc, true).doc;
  doc = addFreehandVectorLayer(doc, rawPts).doc;
  const svg = renderManualEditorToSvg(doc);
  assert.ok(svg.includes("<polygon"), "Renders polygon and arrowhead");
  assert.ok(svg.includes("JACKPOT"), "Renders vector text");
  assert.ok(svg.includes("<linearGradient"), "Renders two-stop gradients");
});

test("F13 Color, RGBA, Recent Swatches, Two-Stop Gradients, and Eyedropper", () => {
  let doc = createInitialManualEditorDoc({ width: 400, height: 400 });

  // Hex update syncs RGBA and recentSwatches
  doc = updateEditorColorHex(doc, "#3b82f6");
  assert.equal(doc.color.hex, "#3b82f6");
  assert.deepEqual(doc.color.rgba, { r: 59, g: 130, b: 246, a: 1 });
  assert.equal(doc.color.recentSwatches[0], "#3b82f6");

  // RGBA update syncs Hex and recentSwatches
  doc = updateEditorColorRgba(doc, { r: 239, g: 68, b: 68, a: 0.75 });
  assert.equal(doc.color.hex, "#ef4444");
  assert.equal(doc.color.rgba.a, 0.75);
  assert.equal(doc.color.recentSwatches[0], "#ef4444");

  // Two-stop gradient configuration
  doc = updateEditorGradient(doc, {
    enabled: true,
    startColor: "#a855f7",
    endColor: "#ec4899",
    startStop: 5,
    endStop: 95,
    angle: 225,
  });
  assert.equal(doc.color.gradient.enabled, true);
  assert.equal(doc.color.gradient.startColor, "#a855f7");
  assert.equal(doc.color.gradient.endColor, "#ec4899");
  assert.equal(doc.color.gradient.angle, 225);

  // Eyedropper samples color from a placed shape layer at (200, 200)
  const added = addVectorShapeLayer(doc, "rect", {
    fill: "#22c55e",
    gradient: { ...doc.color.gradient, enabled: false },
    x: 100,
    y: 100,
    width: 200,
    height: 200,
  });
  doc = added.doc;
  const sampled = sampleEyedropperAtPoint(doc, 200, 200);
  doc = sampled.doc;
  assert.equal(sampled.sampledHex, "#22c55e");
  assert.equal(sampled.sourceLayerId, added.layerId);
  assert.equal(doc.color.hex, "#22c55e");
});

test("F13 Adjustments, Layer Effects (Drop Shadow), Blend Modes, and Masking", () => {
  let doc = createInitialManualEditorDoc({ width: 512, height: 512 });
  const baseId = doc.layers[0]!.id;

  // Verify all 12 documented blend modes
  assert.equal(DOCUMENTED_BLEND_MODES.length, 12);
  for (const bm of DOCUMENTED_BLEND_MODES) {
    doc = updateLayer(doc, baseId, { blendMode: bm.id });
    assert.equal(doc.layers[0]!.blendMode, bm.id);
  }

  // Verify all 10 adjustments: Brightness, Contrast, Saturation, Vibrance, Hue, Blur, Tint, Sharpen, Grayscale, Invert
  doc = updateLayerAdjustments(doc, baseId, {
    brightness: 20,
    contrast: 15,
    saturation: 30,
    vibrance: 25,
    hue: 45,
    blur: 4,
    tintColor: "#f59e0b",
    tintAmount: 40,
    sharpen: 50,
    grayscale: 10,
    invert: 5,
  });
  const adj = doc.layers[0]!.adjustments;
  assert.equal(adj.brightness, 20);
  assert.equal(adj.contrast, 15);
  assert.equal(adj.saturation, 30);
  assert.equal(adj.vibrance, 25);
  assert.equal(adj.hue, 45);
  assert.equal(adj.blur, 4);
  assert.equal(adj.tintColor, "#f59e0b");
  assert.equal(adj.tintAmount, 40);
  assert.equal(adj.sharpen, 50);
  assert.equal(adj.grayscale, 10);
  assert.equal(adj.invert, 5);

  // Drop Shadow: color, blur, X offset, Y offset
  doc = updateLayerDropShadow(doc, baseId, {
    enabled: true,
    color: "#111827",
    blur: 18,
    offsetX: 6,
    offsetY: 10,
  });
  const ds = doc.layers[0]!.dropShadow;
  assert.equal(ds.enabled, true);
  assert.equal(ds.color, "#111827");
  assert.equal(ds.blur, 18);
  assert.equal(ds.offsetX, 6);
  assert.equal(ds.offsetY, 10);

  const filterCss = buildLayerCssFilter(adj, ds);
  assert.ok(filterCss.includes("brightness(120%)"));
  assert.ok(filterCss.includes("contrast("));
  assert.ok(filterCss.includes("saturate("));
  assert.ok(filterCss.includes("hue-rotate(45deg)"));
  assert.ok(filterCss.includes("blur(4px)"));
  assert.ok(filterCss.includes("grayscale(10%)"));
  assert.ok(filterCss.includes("invert(5%)"));
  assert.ok(filterCss.includes("drop-shadow(6px 10px 18px #111827)"));

  // Reset adjustments
  doc = resetLayerAdjustments(doc, baseId);
  assert.equal(doc.layers[0]!.adjustments.brightness, 0);

  // Masking: Mask bottom with top & Remove mask
  const topAdded = addVectorShapeLayer(doc, "ellipse");
  doc = topAdded.doc;
  const topId = topAdded.layerId;

  doc = maskBottomWithTop(doc, baseId, topId);
  const bottomAfterMask = doc.layers.find((l) => l.id === baseId)!;
  const topAfterMask = doc.layers.find((l) => l.id === topId)!;
  assert.equal(bottomAfterMask.maskedByLayerId, topId);
  assert.equal(topAfterMask.isMaskSourceForLayerId, baseId);

  const maskedSvg = renderManualEditorToSvg(doc);
  assert.ok(maskedSvg.includes(`mask="url(#mask-from-${topId})"`), "SVG contains <mask> binding");

  doc = removeMask(doc, baseId);
  assert.equal(doc.layers.find((l) => l.id === baseId)!.maskedByLayerId, null);
  assert.equal(doc.layers.find((l) => l.id === topId)!.isMaskSourceForLayerId, null);
});

test("F13 Vector/Raster Rule: blocks silent flattening of vector objects and prompts 'Rasterize this object?'", () => {
  let doc = createInitialManualEditorDoc({ width: 512, height: 512 });
  const addedShape = addVectorShapeLayer(doc, "rounded_rect");
  doc = addedShape.doc;
  const shapeLayerId = addedShape.layerId;

  const shapeLayer = doc.layers.find((l) => l.id === shapeLayerId)!;
  assert.equal(shapeLayer.isVector, true);
  assert.equal(requiresRasterizationConfirmation(shapeLayer, "brush"), true);
  assert.equal(requiresRasterizationConfirmation(shapeLayer, "eraser"), true);
  assert.equal(requiresRasterizationConfirmation(shapeLayer, "blur_brush"), true);
  assert.equal(requiresRasterizationConfirmation(shapeLayer, "select"), false);

  // Attempting to apply a pixel brush stroke WITHOUT confirmation must NOT flatten the vector layer!
  const unconfirmed = applyPixelToolStroke(doc, shapeLayerId, {
    mode: "brush",
    points: [
      { x: 100, y: 100 },
      { x: 180, y: 160 },
    ],
  });
  assert.equal(unconfirmed.applied, false);
  assert.equal(unconfirmed.requiresRasterizeConfirmation, true);
  assert.equal(unconfirmed.promptMessage, RASTERIZE_CONFIRMATION_MESSAGE);
  assert.equal(unconfirmed.promptMessage, "Rasterize this object?");
  assert.equal(
    unconfirmed.doc.layers.find((l) => l.id === shapeLayerId)!.isVector,
    true,
    "Vector object was NOT silently flattened",
  );

  // Confirming rasterization converts the layer to raster and records the pixel stroke
  const confirmed = applyPixelToolStroke(
    doc,
    shapeLayerId,
    {
      mode: "brush",
      points: [
        { x: 100, y: 100 },
        { x: 180, y: 160 },
      ],
    },
    { confirmRasterize: true },
  );
  assert.equal(confirmed.applied, true);
  assert.equal(confirmed.requiresRasterizeConfirmation, false);
  doc = confirmed.doc;
  const afterRaster = doc.layers.find((l) => l.id === shapeLayerId)!;
  assert.equal(afterRaster.isVector, false);
  assert.equal(afterRaster.kind, "raster");
  assert.equal(afterRaster.rasterStrokes.length, 1);

  // Explicit rasterizeLayer also converts any vector layer to raster
  const textAdded = addVectorTextLayer(doc, { text: "BONUS" });
  doc = rasterizeLayer(textAdded.doc, textAdded.layerId);
  assert.equal(doc.layers.find((l) => l.id === textAdded.layerId)!.isVector, false);
});

test("F13 Acceptance: manual edits support Undo/Redo, save as a new image revision, and never destroy the original asset", async () => {
  const { createProject, deleteProject, getProject } = await import("../src/server/workspace-service");
  const { saveDesign, uploadAsset } = await import("../src/server/design-service");

  const project = await createProject({
    title: "F13 Manual Editor Persistence Test",
    theme: "Golden Empire",
  });

  try {
    let designDoc = migrateDoc(designDocFromBlueprint(project.blueprint));
    const bgEl = designDoc.elements.find((e) => e.type === "game_background")!;
    const originalAssetId = bgEl.assetId!;
    assert.ok(originalAssetId, "Background element starts with an original factory asset");

    // Initialize ManualEditorDoc from the element's original asset
    const origAsset = designDoc.assets.find((a) => a.id === originalAssetId)!;
    let history = createHistory(
      createInitialManualEditorDoc({
        width: origAsset.width ?? 640,
        height: origAsset.height ?? 360,
        baseImageUri: origAsset.uri,
        baseImageName: origAsset.name,
      }),
    );

    // Perform manual edits with Undo/Redo
    history = commitHistory(
      history,
      addBlankRasterLayer(history.present, "Glow Paint Layer").doc,
      "Add paint layer",
    );
    const paintLayerId = history.present.selectedLayerId!;

    history = commitHistory(
      history,
      applyPixelToolStroke(history.present, paintLayerId, {
        mode: "brush",
        points: [
          { x: 120, y: 120 },
          { x: 260, y: 180 },
        ],
        color: "#ffd700",
        size: 24,
      }).doc,
      "Paint golden stroke",
    );

    history = commitHistory(
      history,
      addVectorTextLayer(history.present, { text: "MEGA WIN" }).doc,
      "Add MEGA WIN text",
    );
    assert.equal(history.present.layers.length, 3);

    // Undo removing the text layer, then Redo bringing it back
    const undone = undoHistory(history);
    assert.ok(undone);
    assert.equal(undone.state.present.layers.length, 2, "Undo removes the last added layer");

    const redone = redoHistory(undone.state);
    assert.ok(redone);
    history = redone.state;
    assert.equal(history.present.layers.length, 3, "Redo restores the added layer");

    // Render and upload the new manual artwork to the project asset store
    const rendered = renderManualEditorToDataUrl(history.present);
    const uploaded = await uploadAsset(project.id, {
      name: "golden-empire-bg-manual-v2.svg",
      dataUrl: rendered.dataUrl,
    });

    // Save manual edit onto DesignDoc as a new revision
    const saved = saveManualEditToDesignDoc(
      designDoc,
      { kind: "element", id: bgEl.id },
      history.present,
      {
        customAsset: uploaded.asset,
        label: "v2 — Manual Gold Stroke & Text",
        notes: "Added golden brush stroke and MEGA WIN text",
      },
    );
    designDoc = saved.doc;

    await saveDesign(project.id, {
      baseRevision: project.revision,
      doc: designDoc,
    });

    const reloaded = await getProject(project.id);
    assert.ok(reloaded);
    assert.equal(validateBlueprint(reloaded.blueprint).integrityOk, true);

    const reloadedBg = reloaded.blueprint.elements.find((e) => e.id === bgEl.id)!;
    assert.equal(reloadedBg.assetId, uploaded.asset.id, "New manual revision is now active");
    assert.notEqual(reloadedBg.assetId, originalAssetId, "Active asset ID is the new version");
    assert.ok(
      reloadedBg.imageHistory && reloadedBg.imageHistory.length >= 2,
      "Image history contains both the original version and the new manual version",
    );
    assert.equal(
      reloadedBg.imageHistory![0]!.label,
      "v2 — Manual Gold Stroke & Text",
      "Saved revision label persisted",
    );
    assert.ok(
      reloaded.blueprint.assets.some((a) => a.id === originalAssetId),
      "Original asset is preserved in blueprint.assets and NOT destroyed",
    );
    assert.ok(
      reloaded.blueprint.assets.some((a) => a.id === uploaded.asset.id),
      "New manually edited asset is persisted in blueprint.assets",
    );
  } finally {
    await deleteProject(project.id);
  }
});
