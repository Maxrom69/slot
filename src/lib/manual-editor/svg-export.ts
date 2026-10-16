import type { AssetRef } from "@/lib/blueprint/types";
import { updateImageRevisionLabel } from "@/lib/design/image-history";
import { replaceElementArtwork, replaceSymbolArtwork } from "@/lib/design/operations";
import type { DesignDoc } from "@/lib/design/types";
import type {
  DropShadowEffect,
  EditorLayer,
  LayerAdjustments,
  ManualEditorDoc,
  RasterStrokePoint,
} from "./types";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Builds a CSS `filter` string from a layer's non-destructive adjustments and drop shadow.
 */
export function buildLayerCssFilter(
  adj: LayerAdjustments,
  dropShadow: DropShadowEffect,
): string {
  const parts: string[] = [];

  if (adj.brightness !== 0) {
    parts.push(`brightness(${Math.max(0, 100 + adj.brightness)}%)`);
  }
  if (adj.contrast !== 0 || adj.sharpen > 0) {
    // Sharpen boosts micro-contrast alongside SVG convolution filter
    const boost = adj.contrast + Math.round(adj.sharpen * 0.35);
    parts.push(`contrast(${Math.max(0, 100 + boost)}%)`);
  }
  if (adj.saturation !== 0 || adj.vibrance !== 0) {
    const sat = adj.saturation + Math.round(adj.vibrance * 0.65);
    parts.push(`saturate(${Math.max(0, 100 + sat)}%)`);
  }
  if (adj.hue !== 0) {
    parts.push(`hue-rotate(${adj.hue}deg)`);
  }
  if (adj.blur > 0) {
    parts.push(`blur(${adj.blur}px)`);
  }
  if (adj.grayscale > 0) {
    parts.push(`grayscale(${Math.max(0, Math.min(100, adj.grayscale))}%)`);
  }
  if (adj.invert > 0) {
    parts.push(`invert(${Math.max(0, Math.min(100, adj.invert))}%)`);
  }
  if (dropShadow.enabled) {
    parts.push(
      `drop-shadow(${dropShadow.offsetX}px ${dropShadow.offsetY}px ${Math.max(0, dropShadow.blur)}px ${dropShadow.color})`,
    );
  }

  return parts.length > 0 ? parts.join(" ") : "none";
}

/**
 * Generates SVG polygon vertex coordinates for a regular N-point polygon or star inside a bounding box.
 */
export function buildPolygonPointsAttr(
  x: number,
  y: number,
  width: number,
  height: number,
  pointsCount: number,
): string {
  const n = Math.max(3, Math.min(12, Math.round(pointsCount)));
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const coords: string[] = [];

  for (let i = 0; i < n; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const px = Math.round((cx + rx * Math.cos(angle)) * 10) / 10;
    const py = Math.round((cy + ry * Math.sin(angle)) * 10) / 10;
    coords.push(`${px},${py}`);
  }
  return coords.join(" ");
}

function buildPolylinePoints(points: RasterStrokePoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

function renderSingleLayerContent(layer: EditorLayer, defs: string[]): string {
  const { x, y, width, height, id } = layer;
  const elements: string[] = [];

  // Base image if present, or base canvas surface for raster/vector_svg layers
  if (layer.imageUri) {
    elements.push(
      `<image href="${escapeXml(layer.imageUri)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet" />`,
    );
  } else if (layer.kind === "raster" || layer.kind === "vector_svg") {
    elements.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="rgba(15,23,42,0.35)" />`,
    );
  }

  // Vector shape
  if (layer.shapeProps && (layer.kind === "vector_shape" || (!layer.isVector && layer.shapeProps && !layer.textProps && layer.name !== "Vector Line" && layer.name !== "Vector Arrow"))) {
    const sp = layer.shapeProps;
    let fillAttr = sp.fill || "none";
    if (sp.gradient.enabled) {
      const gradId = `grad-shape-${id}`;
      const rad = ((sp.gradient.angle - 90) * Math.PI) / 180;
      const x1 = Math.round(50 - Math.cos(rad) * 50);
      const y1 = Math.round(50 - Math.sin(rad) * 50);
      const x2 = Math.round(50 + Math.cos(rad) * 50);
      const y2 = Math.round(50 + Math.sin(rad) * 50);
      defs.push(
        `<linearGradient id="${gradId}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">` +
          `<stop offset="${sp.gradient.startStop}%" stop-color="${escapeXml(sp.gradient.startColor)}" />` +
          `<stop offset="${sp.gradient.endStop}%" stop-color="${escapeXml(sp.gradient.endColor)}" />` +
          `</linearGradient>`,
      );
      fillAttr = `url(#${gradId})`;
    }

    const strokeAttr =
      sp.width > 0 && sp.stroke
        ? `stroke="${escapeXml(sp.stroke)}" stroke-width="${sp.width}"`
        : "";

    if (sp.shapeKind === "rect" || sp.shapeKind === "rounded_rect") {
      const rx = sp.shapeKind === "rounded_rect" ? sp.cornerRadius : sp.cornerRadius;
      elements.push(
        `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" fill="${fillAttr}" ${strokeAttr} />`,
      );
    } else if (sp.shapeKind === "ellipse") {
      elements.push(
        `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${fillAttr}" ${strokeAttr} />`,
      );
    } else if (sp.shapeKind === "triangle") {
      const pts = buildPolygonPointsAttr(x, y, width, height, 3);
      elements.push(`<polygon points="${pts}" fill="${fillAttr}" ${strokeAttr} />`);
    } else if (sp.shapeKind === "polygon") {
      const pts = buildPolygonPointsAttr(x, y, width, height, sp.polygonPoints);
      elements.push(`<polygon points="${pts}" fill="${fillAttr}" ${strokeAttr} />`);
    }
  }

  // Vector line / arrow
  if (layer.shapeProps && (layer.kind === "vector_line" || layer.shapeProps.arrowEnd !== undefined)) {
    const sp = layer.shapeProps;
    const strokeColor = sp.gradient.enabled ? sp.gradient.startColor : sp.stroke || sp.fill || "#d4af37";
    const sw = Math.max(2, sp.width || 4);
    const yMid = y + height / 2;
    const x1 = x + 8;
    const x2 = x + width - (sp.arrowEnd ? 18 : 8);
    elements.push(
      `<line x1="${x1}" y1="${yMid}" x2="${x2}" y2="${yMid}" stroke="${escapeXml(strokeColor)}" stroke-width="${sw}" stroke-linecap="round" />`,
    );
    if (sp.arrowEnd) {
      const tipX = x + width - 4;
      const baseX = x + width - 22;
      const halfHead = Math.max(8, sw * 2);
      elements.push(
        `<polygon points="${tipX},${yMid} ${baseX},${yMid - halfHead} ${baseX},${yMid + halfHead}" fill="${escapeXml(strokeColor)}" />`,
      );
    }
  }

  // Vector freehand
  if (layer.freehandPoints && layer.freehandPoints.length > 0) {
    const fb = layer.freehandBrush;
    const strokeColor = fb?.color ?? "#d4af37";
    const sw = fb?.size ?? 8;
    elements.push(
      `<polyline points="${buildPolylinePoints(layer.freehandPoints)}" fill="none" stroke="${escapeXml(strokeColor)}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity="${fb?.opacity ?? 1}" />`,
    );
  }

  // Vector text
  if (layer.textProps) {
    const tp = layer.textProps;
    let fillAttr = tp.fill || "#ffffff";
    if (tp.gradient.enabled) {
      const gradId = `grad-text-${id}`;
      const rad = ((tp.gradient.angle - 90) * Math.PI) / 180;
      const x1 = Math.round(50 - Math.cos(rad) * 50);
      const y1 = Math.round(50 - Math.sin(rad) * 50);
      const x2 = Math.round(50 + Math.cos(rad) * 50);
      const y2 = Math.round(50 + Math.sin(rad) * 50);
      defs.push(
        `<linearGradient id="${gradId}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">` +
          `<stop offset="${tp.gradient.startStop}%" stop-color="${escapeXml(tp.gradient.startColor)}" />` +
          `<stop offset="${tp.gradient.endStop}%" stop-color="${escapeXml(tp.gradient.endColor)}" />` +
          `</linearGradient>`,
      );
      fillAttr = `url(#${gradId})`;
    }

    const anchor =
      tp.alignment === "left" ? "start" : tp.alignment === "right" ? "end" : "middle";
    const textX =
      tp.alignment === "left"
        ? x + 12
        : tp.alignment === "right"
          ? x + width - 12
          : x + width / 2;
    const textY = y + height / 2 + tp.size * 0.35;
    const outlineAttr =
      tp.outlineWidth > 0
        ? `stroke="${escapeXml(tp.outlineColor)}" stroke-width="${tp.outlineWidth}" paint-order="stroke fill"`
        : "";

    elements.push(
      `<text x="${textX}" y="${textY}" text-anchor="${anchor}" font-family="${escapeXml(tp.font)}" font-size="${tp.size}" font-weight="${tp.weight}" font-style="${tp.style}" letter-spacing="${tp.letterSpacing}" fill="${fillAttr}" ${outlineAttr}>${escapeXml(tp.text)}</text>`,
    );
  }

  // Recorded pixel strokes (Paint Brush, Eraser, Blur Brush)
  for (const stroke of layer.rasterStrokes) {
    if (stroke.points.length === 0) continue;
    if (stroke.mode === "eraser") {
      elements.push(
        `<polyline points="${buildPolylinePoints(stroke.points)}" fill="none" stroke="#0b0d14" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round" opacity="${stroke.opacity}" data-stroke-mode="eraser" />`,
      );
    } else if (stroke.mode === "blur_brush") {
      const blurFilterId = `blur-stroke-${stroke.id}`;
      defs.push(
        `<filter id="${blurFilterId}"><feGaussianBlur stdDeviation="4" /></filter>`,
      );
      elements.push(
        `<polyline points="${buildPolylinePoints(stroke.points)}" fill="none" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round" opacity="${Math.min(0.65, stroke.opacity)}" filter="url(#${blurFilterId})" data-stroke-mode="blur_brush" />`,
      );
    } else {
      const softBlur = stroke.hardness < 70 ? Math.round(((100 - stroke.hardness) / 100) * 6) : 0;
      const filterAttr = softBlur > 0 ? `style="filter: blur(${softBlur}px)"` : "";
      elements.push(
        `<polyline points="${buildPolylinePoints(stroke.points)}" fill="none" stroke="${escapeXml(stroke.color)}" stroke-width="${stroke.size}" stroke-linecap="round" stroke-linejoin="round" opacity="${stroke.opacity}" ${filterAttr} data-stroke-mode="brush" />`,
      );
    }
  }

  // Tint overlay if tintAmount > 0
  if (layer.adjustments.tintAmount > 0 && layer.adjustments.tintColor) {
    const tintOpacity = Math.round((layer.adjustments.tintAmount / 100) * 65) / 100;
    elements.push(
      `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${escapeXml(layer.adjustments.tintColor)}" opacity="${tintOpacity}" style="mix-blend-mode: color" />`,
    );
  }

  return elements.join("");
}

/**
 * Renders the complete ManualEditorDoc (all visible layers, masks, adjustments,
 * drop shadows, blend modes, vector shapes/text, and raster strokes) into an SVG string.
 */
export function renderManualEditorToSvg(doc: ManualEditorDoc): string {
  const defs: string[] = [];
  const bodyGroups: string[] = [];

  // Render from bottom layer to top layer
  const layersBottomToTop = [...doc.layers].reverse();

  for (const layer of layersBottomToTop) {
    if (!layer.visible) continue;
    // If this layer acts as a mask source for another layer, define it in <defs><mask>
    if (layer.isMaskSourceForLayerId) {
      const maskId = `mask-from-${layer.id}`;
      const maskContent = renderSingleLayerContent(layer, defs);
      defs.push(
        `<mask id="${maskId}"><rect width="${doc.width}" height="${doc.height}" fill="black" /><g fill="white" stroke="white">${maskContent}</g></mask>`,
      );
      continue;
    }

    const content = renderSingleLayerContent(layer, defs);
    if (!content) continue;

    const filterCss = buildLayerCssFilter(layer.adjustments, layer.dropShadow);
    const styleParts: string[] = [];
    if (filterCss !== "none") styleParts.push(`filter: ${filterCss}`);
    if (layer.blendMode && layer.blendMode !== "normal") {
      styleParts.push(`mix-blend-mode: ${layer.blendMode}`);
    }
    const styleAttr = styleParts.length > 0 ? `style="${escapeXml(styleParts.join("; "))}"` : "";
    const maskAttr = layer.maskedByLayerId
      ? `mask="url(#mask-from-${escapeXml(layer.maskedByLayerId)})"`
      : "";
    const cx = layer.x + layer.width / 2;
    const cy = layer.y + layer.height / 2;
    const transformAttr =
      layer.rotation !== 0 ? `transform="rotate(${layer.rotation} ${cx} ${cy})"` : "";

    bodyGroups.push(
      `<g data-layer-id="${escapeXml(layer.id)}" opacity="${layer.opacity}" ${maskAttr} ${transformAttr} ${styleAttr}>${content}</g>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${doc.width} ${doc.height}" width="${doc.width}" height="${doc.height}">` +
    (defs.length > 0 ? `<defs>${defs.join("")}</defs>` : "") +
    bodyGroups.join("") +
    `</svg>`
  );
}

/**
 * Encodes `ManualEditorDoc` into a `data:image/svg+xml;base64,...` URI.
 */
export function renderManualEditorToDataUrl(doc: ManualEditorDoc): {
  svg: string;
  dataUrl: string;
  sizeBytes: number;
} {
  const svg = renderManualEditorToSvg(doc);
  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(svg, "utf8").toString("base64")
      : btoa(unescape(encodeURIComponent(svg)));
  return {
    svg,
    dataUrl: `data:image/svg+xml;base64,${base64}`,
    sizeBytes: svg.length,
  };
}

/**
 * F13 SAVE & ACCEPTANCE:
 * Commits a manual editor document onto a DesignDoc target (`element` or `symbol`),
 * producing a brand-new `AssetRef` and a new `ImageRevision` while keeping the original
 * asset preserved in `designDoc.assets` and `imageHistory`.
 */
export function saveManualEditToDesignDoc(
  designDoc: DesignDoc,
  target: { kind: "element" | "symbol"; id: string },
  editorDoc: ManualEditorDoc,
  options?: {
    customAsset?: AssetRef;
    label?: string;
    notes?: string;
  },
): {
  doc: DesignDoc;
  newAsset: AssetRef;
} {
  const rendered = renderManualEditorToDataUrl(editorDoc);
  const ownerName =
    target.kind === "symbol"
      ? (designDoc.symbols.find((s) => s.id === target.id)?.name ?? target.id)
      : (designDoc.elements.find((e) => e.id === target.id)?.name ?? target.id);

  const safeSlug = ownerName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "artwork";

  const newAsset: AssetRef = options?.customAsset ?? {
    id: `ast-manual-${target.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: `${safeSlug}-edited-${Date.now().toString(36).slice(-4)}.svg`,
    kind: "image",
    uri: rendered.dataUrl,
    state: "linked",
    format: "svg",
    mime: "image/svg+xml",
    width: editorDoc.width,
    height: editorDoc.height,
    sizeBytes: rendered.sizeBytes,
    hasAlpha: true,
    tags: ["manual-editor"],
  };

  const notes =
    options?.notes?.trim() ||
    options?.label?.trim() ||
    `Manual edit saved (${editorDoc.layers.length} layers)`;

  if (target.kind === "symbol") {
    let nextDoc = replaceSymbolArtwork(designDoc, target.id, newAsset, {
      source: "upload",
      notes,
    });
    const latestRevId = nextDoc.symbols.find((s) => s.id === target.id)?.imageHistory?.[0]?.id;
    if (options?.label?.trim() && latestRevId) {
      nextDoc = updateImageRevisionLabel(
        nextDoc,
        { kind: "symbol", id: target.id },
        latestRevId,
        { label: options.label.trim(), notes },
      );
    }
    return { doc: nextDoc, newAsset };
  }

  const targetEl = designDoc.elements.find((e) => e.id === target.id);
  if (targetEl?.type === "symbol" && targetEl.symbolIds[0]) {
    const symId = targetEl.symbolIds[0];
    let nextDoc = replaceSymbolArtwork(designDoc, symId, newAsset, {
      source: "upload",
      notes,
    });
    const latestRevId = nextDoc.symbols.find((s) => s.id === symId)?.imageHistory?.[0]?.id;
    if (options?.label?.trim() && latestRevId) {
      nextDoc = updateImageRevisionLabel(
        nextDoc,
        { kind: "symbol", id: symId },
        latestRevId,
        { label: options.label.trim(), notes },
      );
    }
    return { doc: nextDoc, newAsset };
  }

  let nextDoc = replaceElementArtwork(designDoc, target.id, newAsset, {
    source: "upload",
    notes,
  });
  const latestRevId = nextDoc.elements.find((e) => e.id === target.id)?.imageHistory?.[0]?.id;
  if (options?.label?.trim() && latestRevId) {
    nextDoc = updateImageRevisionLabel(
      nextDoc,
      { kind: "element", id: target.id },
      latestRevId,
      { label: options.label.trim(), notes },
    );
  }
  return { doc: nextDoc, newAsset };
}
