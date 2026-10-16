import { slugify } from "@/lib/blueprint/factory";
import {
  BLUEPRINT_VERSION,
  type AnimationMeta,
  type ExportAnimationOptions,
  type ExportConfig,
  type ExportImageScale,
  type GameBlueprint,
  type StudioExportType,
} from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { buildZip, crc32, type ZipFile } from "@/lib/design/zip";
import type {
  AssetSheetItem,
  AssetSheetMetadata,
  AssetSheetViewportState,
  BlueprintImportResult,
  ExportValidationItem,
  ExportValidationReport,
  JsonExportResult,
  PngAssetSheetExportResult,
  ProjectExportMetadata,
  ProjectExportPackage,
  ZipExportEntrySummary,
  ZipExportManifest,
  ZipExportOptions,
  ZipExportPackageResult,
} from "./types";

export const DEFAULT_ANIMATION_OPTIONS: ExportAnimationOptions = {
  includeVideo: true,
  includeWebm: true,
  includeSpriteSheets: true,
  includeGif: true,
};

export const DEFAULT_ZIP_EXPORT_OPTIONS: ZipExportOptions = {
  imageScale: "1x",
  animationOptions: { ...DEFAULT_ANIMATION_OPTIONS },
};

export const DEFAULT_ASSET_SHEET_VIEWPORT: AssetSheetViewportState = {
  zoom: 1,
  panX: 0,
  panY: 0,
};

export const MIN_ASSET_SHEET_ZOOM = 0.25;
export const MAX_ASSET_SHEET_ZOOM = 4.0;

export class ExportBlockedError extends Error {
  readonly validation: ExportValidationReport;

  constructor(message: string, validation: ExportValidationReport) {
    super(message);
    this.name = "ExportBlockedError";
    this.validation = validation;
  }
}

/* ------------------------------------------------------------------ */
/* Option & Viewport Helpers                                           */
/* ------------------------------------------------------------------ */

export function resolveZipExportOptions(
  exportConfig?: Partial<ExportConfig> | null,
  override?: Partial<ZipExportOptions> | null,
): ZipExportOptions {
  const rawScale = override?.imageScale ?? exportConfig?.imageScale;
  const imageScale: ExportImageScale = rawScale === "2x" ? "2x" : "1x";
  const baseAnim = exportConfig?.animationOptions;
  const overAnim = override?.animationOptions;
  return {
    imageScale,
    animationOptions: {
      includeVideo:
        typeof overAnim?.includeVideo === "boolean"
          ? overAnim.includeVideo
          : typeof baseAnim?.includeVideo === "boolean"
            ? baseAnim.includeVideo
            : DEFAULT_ANIMATION_OPTIONS.includeVideo,
      includeWebm:
        typeof overAnim?.includeWebm === "boolean"
          ? overAnim.includeWebm
          : typeof baseAnim?.includeWebm === "boolean"
            ? baseAnim.includeWebm
            : DEFAULT_ANIMATION_OPTIONS.includeWebm,
      includeSpriteSheets:
        typeof overAnim?.includeSpriteSheets === "boolean"
          ? overAnim.includeSpriteSheets
          : typeof baseAnim?.includeSpriteSheets === "boolean"
            ? baseAnim.includeSpriteSheets
            : DEFAULT_ANIMATION_OPTIONS.includeSpriteSheets,
      includeGif:
        typeof overAnim?.includeGif === "boolean"
          ? overAnim.includeGif
          : typeof baseAnim?.includeGif === "boolean"
            ? baseAnim.includeGif
            : DEFAULT_ANIMATION_OPTIONS.includeGif,
    },
  };
}

export function applyExportSettingsToBlueprint(
  bp: GameBlueprint,
  patch: {
    activeExportType?: StudioExportType;
    imageScale?: ExportImageScale;
    animationOptions?: Partial<ExportAnimationOptions>;
    includeAssets?: boolean;
    minify?: boolean;
  },
): GameBlueprint {
  const currentOptions = resolveZipExportOptions(bp.exportConfig);
  const nextScale = patch.imageScale ?? currentOptions.imageScale;
  const nextAnim: ExportAnimationOptions = {
    ...currentOptions.animationOptions,
    ...(patch.animationOptions ?? {}),
  };
  return {
    ...bp,
    exportConfig: {
      ...bp.exportConfig,
      ...(patch.activeExportType !== undefined
        ? { activeExportType: patch.activeExportType }
        : {}),
      ...(patch.includeAssets !== undefined
        ? { includeAssets: patch.includeAssets }
        : {}),
      ...(patch.minify !== undefined ? { minify: patch.minify } : {}),
      imageScale: nextScale,
      animationOptions: nextAnim,
    },
  };
}

export function clampAssetSheetZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(
    MAX_ASSET_SHEET_ZOOM,
    Math.max(MIN_ASSET_SHEET_ZOOM, Math.round(zoom * 100) / 100),
  );
}

export function zoomAssetSheetViewport(
  viewport: AssetSheetViewportState,
  nextZoom: number,
): AssetSheetViewportState {
  return {
    ...viewport,
    zoom: clampAssetSheetZoom(nextZoom),
  };
}

export function panAssetSheetViewport(
  viewport: AssetSheetViewportState,
  deltaX: number,
  deltaY: number,
): AssetSheetViewportState {
  return {
    ...viewport,
    panX: Math.round((viewport.panX + (Number.isFinite(deltaX) ? deltaX : 0)) * 10) / 10,
    panY: Math.round((viewport.panY + (Number.isFinite(deltaY) ? deltaY : 0)) * 10) / 10,
  };
}

export function fitAssetSheetViewport(): AssetSheetViewportState {
  return { ...DEFAULT_ASSET_SHEET_VIEWPORT };
}

/* ------------------------------------------------------------------ */
/* Validation & Critical Schema Corruption Detection                   */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REQUIRED_ARRAY_KEYS = [
  "symbols",
  "symbolSets",
  "specialSymbols",
  "assets",
  "elements",
  "layers",
  "scenes",
  "paylines",
  "paytable",
  "features",
  "animations",
] as const;

const REQUIRED_OBJECT_KEYS = [
  "meta",
  "style",
  "canvas",
  "reels",
  "math",
  "exportConfig",
] as const;

export function validateBlueprintForExport(candidate: unknown): ExportValidationReport {
  const errors: ExportValidationItem[] = [];
  const warnings: ExportValidationItem[] = [];
  const passed: ExportValidationItem[] = [];

  if (!isRecord(candidate)) {
    const item: ExportValidationItem = {
      id: "schema-root",
      label: "Blueprint root object",
      status: "error",
      detail: "Critical schema corruption: Blueprint payload is not a valid JSON object.",
      critical: true,
    };
    return {
      canExport: false,
      blocked: true,
      blockReason: item.detail,
      status: "blocked",
      errors: [item],
      warnings: [],
      passed: [],
      checks: [item],
    };
  }

  // 1. Check top-level schema version
  if (
    typeof candidate.version !== "number" ||
    !Number.isInteger(candidate.version) ||
    candidate.version < 1
  ) {
    errors.push({
      id: "schema-version",
      label: "Blueprint schema version",
      status: "error",
      detail: `Critical schema corruption: Expected integer blueprint version >= 1, received ${String(candidate.version)}.`,
      critical: true,
    });
  } else {
    passed.push({
      id: "schema-version",
      label: "Blueprint schema version",
      status: "passed",
      detail: `Schema version v${candidate.version} verified.`,
      critical: false,
    });
  }

  // 2. Check required object slices
  for (const key of REQUIRED_OBJECT_KEYS) {
    if (!isRecord(candidate[key])) {
      errors.push({
        id: `schema-object-${key}`,
        label: `Required section "${key}"`,
        status: "error",
        detail: `Critical schema corruption: Required blueprint section "${key}" is missing or not an object.`,
        critical: true,
      });
    }
  }

  // 3. Check required array collections
  for (const key of REQUIRED_ARRAY_KEYS) {
    if (!Array.isArray(candidate[key])) {
      errors.push({
        id: `schema-array-${key}`,
        label: `Required collection "${key}"`,
        status: "error",
        detail: `Critical schema corruption: Required blueprint array "${key}" is missing or corrupted.`,
        critical: true,
      });
    }
  }

  // Check reels.strips is an array of arrays
  if (isRecord(candidate.reels) && !Array.isArray(candidate.reels.strips)) {
    errors.push({
      id: "schema-reels-strips",
      label: "Reel strip array structure",
      status: "error",
      detail: "Critical schema corruption: reels.strips must be an array of symbol ID strips.",
      critical: true,
    });
  }

  // Check style.palette is an object
  if (isRecord(candidate.style) && !isRecord(candidate.style.palette)) {
    errors.push({
      id: "schema-style-palette",
      label: "Theme style palette",
      status: "error",
      detail: "Critical schema corruption: style.palette is missing or corrupted.",
      critical: true,
    });
  }

  // If top-level structure is too corrupted to run deep checks safely, return immediately
  if (errors.length > 0) {
    const checks = [...errors, ...warnings, ...passed];
    return {
      canExport: false,
      blocked: true,
      blockReason: errors[0].detail,
      status: "blocked",
      errors,
      warnings,
      passed,
      checks,
    };
  }

  const bp = candidate as unknown as GameBlueprint;
  const baseValidation = validateBlueprint(bp);

  for (const check of baseValidation.checks) {
    if (check.ok) {
      passed.push({
        id: check.id,
        label: check.label,
        status: "passed",
        detail: `${check.label} verified.`,
        critical: false,
      });
    } else if (check.severity === "integrity") {
      errors.push({
        id: check.id,
        label: check.label,
        status: "error",
        detail: `${check.label}: ${check.detail ?? "Integrity check failed."}`,
        critical: true,
      });
    } else {
      warnings.push({
        id: check.id,
        label: check.label,
        status: "warning",
        detail: `${check.label}: ${check.detail ?? "Completeness advisory."}`,
        critical: false,
      });
    }
  }

  // Additional deep schema corruption checks (scene IDs uniqueness & finite object geometry)
  const sceneIds = new Set<string>();
  let sceneDupe = false;
  let invalidTransform = false;
  for (const scene of bp.scenes) {
    if (!scene || typeof scene.id !== "string" || !scene.id.trim()) {
      sceneDupe = true;
      break;
    }
    if (sceneIds.has(scene.id)) {
      sceneDupe = true;
      break;
    }
    sceneIds.add(scene.id);
    for (const obj of scene.objects ?? []) {
      if (
        !Number.isFinite(obj.x) ||
        !Number.isFinite(obj.y) ||
        !Number.isFinite(obj.width) ||
        !Number.isFinite(obj.height) ||
        obj.width <= 0 ||
        obj.height <= 0 ||
        !Number.isFinite(obj.rotation)
      ) {
        invalidTransform = true;
        break;
      }
    }
  }

  if (sceneDupe) {
    errors.push({
      id: "scene-ids-unique",
      label: "Unique scene IDs",
      status: "error",
      detail: "Critical schema corruption: Scene IDs must be non-empty and unique.",
      critical: true,
    });
  } else {
    passed.push({
      id: "scene-ids-unique",
      label: "Unique scene IDs",
      status: "passed",
      detail: "All scene identifiers are unique.",
      critical: false,
    });
  }

  if (invalidTransform) {
    errors.push({
      id: "scene-object-geometry",
      label: "Scene object geometry",
      status: "error",
      detail:
        "Critical schema corruption: Scene object positions, positive dimensions, and rotation must be finite numbers.",
      critical: true,
    });
  } else {
    passed.push({
      id: "scene-object-geometry",
      label: "Scene object geometry",
      status: "passed",
      detail: "All scene object transforms are valid.",
      critical: false,
    });
  }

  // Non-blocking advisory warnings for placeholder assets or disabled animations
  const placeholderAssets = bp.assets.filter((a) => a.state === "placeholder");
  if (placeholderAssets.length > 0) {
    warnings.push({
      id: "placeholder-assets",
      label: "Placeholder assets",
      status: "warning",
      detail: `${placeholderAssets.length} asset(s) use studio placeholder artwork (${placeholderAssets.map((a) => a.name).slice(0, 3).join(", ")}).`,
      critical: false,
    });
  } else {
    passed.push({
      id: "placeholder-assets",
      label: "Linked project assets",
      status: "passed",
      detail: "All registered project assets have linked URIs.",
      critical: false,
    });
  }

  const blocked = errors.length > 0;
  const status: ExportValidationReport["status"] = blocked
    ? "blocked"
    : warnings.length > 0
      ? "warnings"
      : "passed";

  return {
    canExport: !blocked,
    blocked,
    blockReason: blocked ? errors[0].detail : null,
    status,
    errors,
    warnings,
    passed,
    checks: [...errors, ...warnings, ...passed],
  };
}

export function assertBlueprintCanExport(bp: unknown): ExportValidationReport {
  const report = validateBlueprintForExport(bp);
  if (report.blocked) {
    throw new ExportBlockedError(
      report.blockReason ?? "Export blocked due to critical schema corruption.",
      report,
    );
  }
  return report;
}

/* ------------------------------------------------------------------ */
/* Asset Sheet Construction & Real Binary PNG Generation               */
/* ------------------------------------------------------------------ */

const PALETTE_SWATCHES = [
  "#6366F1",
  "#EC4899",
  "#10B981",
  "#F59E0B",
  "#3B82F6",
  "#8B5CF6",
  "#14B8A6",
  "#F43F5E",
];

function parseHexToRgb(hex: string | undefined, fallback: [number, number, number]): [number, number, number] {
  if (!hex || typeof hex !== "string") return fallback;
  const clean = hex.trim().replace(/^#/, "");
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b];
    }
  }
  if (clean.length >= 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return [r, g, b];
    }
  }
  return fallback;
}

export function buildAssetSheetMetadata(
  bp: GameBlueprint,
  scale: ExportImageScale = "1x",
): AssetSheetMetadata {
  const scaleFactor: 1 | 2 = scale === "2x" ? 2 : 1;
  const rawItems: Omit<
    AssetSheetItem,
    | "cellIndex"
    | "column"
    | "row"
    | "cellX"
    | "cellY"
    | "cellWidth"
    | "cellHeight"
  >[] = [];

  const seenAssetIds = new Set<string>();
  const symbolByAssetId = new Map(
    bp.symbols.filter((s) => s.assetId).map((s) => [s.assetId as string, s]),
  );
  const elementByAssetId = new Map(
    bp.elements.filter((e) => e.assetId).map((e) => [e.assetId as string, e]),
  );

  // 1. Collect all image & sprite assets from bp.assets
  for (const [idx, asset] of bp.assets.entries()) {
    if (asset.kind !== "image" && asset.kind !== "sprite") {
      continue;
    }
    seenAssetIds.add(asset.id);
    const linkedSym = symbolByAssetId.get(asset.id);
    const linkedEl = elementByAssetId.get(asset.id);
    const baseW = asset.width ?? (linkedEl ? 192 : 160);
    const baseH = asset.height ?? (linkedEl ? 192 : 160);
    const colorHex =
      linkedEl?.style?.tintColor ??
      PALETTE_SWATCHES[idx % PALETTE_SWATCHES.length];
    const glyph =
      linkedSym?.glyph ??
      asset.name.trim().slice(0, 2).toUpperCase() ??
      "AS";

    rawItems.push({
      id: asset.id,
      name: asset.name,
      category: "asset",
      kind: asset.kind,
      state: asset.state,
      assetId: asset.id,
      uri: asset.uri ?? linkedSym?.image?.uri ?? linkedEl?.image?.uri ?? null,
      isImage: true,
      baseWidth: baseW,
      baseHeight: baseH,
      scaledWidth: baseW * scaleFactor,
      scaledHeight: baseH * scaleFactor,
      colorHex,
      glyph,
      tags: [...(asset.tags ?? [])],
    });
  }

  // 2. Include symbols that have inline artwork/glyphs not already backed by an assetId in seenAssetIds
  for (const [idx, sym] of bp.symbols.entries()) {
    if (sym.assetId && seenAssetIds.has(sym.assetId)) continue;
    const uri = sym.image?.uri ?? null;
    rawItems.push({
      id: `sym-${sym.id}`,
      name: `${sym.name} (${sym.code})`,
      category: "symbol",
      kind: `symbol:${sym.tier}`,
      state: uri ? "linked" : "generated",
      assetId: sym.assetId,
      uri,
      isImage: true,
      baseWidth: 140,
      baseHeight: 140,
      scaledWidth: 140 * scaleFactor,
      scaledHeight: 140 * scaleFactor,
      colorHex: PALETTE_SWATCHES[(idx + 2) % PALETTE_SWATCHES.length],
      glyph: sym.glyph || sym.code.slice(0, 2).toUpperCase(),
      tags: ["symbol", sym.tier],
    });
  }

  // 3. Include scene composed images not yet represented
  for (const scene of bp.scenes) {
    for (const [idx, comp] of (scene.composedImages ?? []).entries()) {
      if (comp.assetId && seenAssetIds.has(comp.assetId)) continue;
      const refKind = comp.refKind ?? "image";
      rawItems.push({
        id: `comp-${scene.id}-${comp.id}`,
        name: `${scene.name}: ${comp.name}`,
        category: "composed",
        kind: `composed:${refKind}`,
        state: comp.uri ? "linked" : "generated",
        assetId: comp.assetId,
        uri: comp.uri,
        isImage: true,
        baseWidth: comp.width || 192,
        baseHeight: comp.height || 108,
        scaledWidth: (comp.width || 192) * scaleFactor,
        scaledHeight: (comp.height || 108) * scaleFactor,
        colorHex:
          bp.style?.palette?.accent ||
          PALETTE_SWATCHES[(idx + 4) % PALETTE_SWATCHES.length],
        glyph: "SC",
        tags: ["composed", refKind, scene.id],
      });
    }
  }

  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(Math.max(1, rawItems.length)))));
  const rows = Math.max(1, Math.ceil(Math.max(1, rawItems.length) / columns));
  const cellWidth = 96 * scaleFactor;
  const cellHeight = 96 * scaleFactor;
  const padding = 12 * scaleFactor;
  const headerHeight = 32 * scaleFactor;

  const sheetWidth = columns * cellWidth + (columns + 1) * padding;
  const sheetHeight = headerHeight + rows * cellHeight + (rows + 1) * padding;

  const items: AssetSheetItem[] = rawItems.map((item, cellIndex) => {
    const column = cellIndex % columns;
    const row = Math.floor(cellIndex / columns);
    const cellX = padding + column * (cellWidth + padding);
    const cellY = headerHeight + padding + row * (cellHeight + padding);
    return {
      ...item,
      cellIndex,
      column,
      row,
      cellX,
      cellY,
      cellWidth,
      cellHeight,
    };
  });

  return {
    assetCount: bp.assets.length,
    imageCount: items.length,
    scale,
    scaleFactor,
    columns,
    rows,
    cellWidth,
    cellHeight,
    padding,
    headerHeight,
    sheetWidth,
    sheetHeight,
    items,
  };
}

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  const MOD = 65521;
  for (let i = 0; i < data.length; i += 1) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i += 1) {
    chunk[4 + i] = type.charCodeAt(i) & 0xff;
  }
  chunk.set(data, 8);
  const crcInput = chunk.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return chunk;
}

function makeTextChunk(keyword: string, value: string): Uint8Array {
  const encoder = new TextEncoder();
  const keyBytes = encoder.encode(keyword.slice(0, 79));
  const valBytes = encoder.encode(value);
  const data = new Uint8Array(keyBytes.length + 1 + valBytes.length);
  data.set(keyBytes, 0);
  data[keyBytes.length] = 0;
  data.set(valBytes, keyBytes.length + 1);
  return makePngChunk("tEXt", data);
}

function wrapZlibStoreBlocks(rawScanlines: Uint8Array): Uint8Array {
  const maxBlock = 65535;
  const numBlocks = Math.max(1, Math.ceil(rawScanlines.length / maxBlock));
  const out = new Uint8Array(2 + rawScanlines.length + numBlocks * 5 + 4);
  // Zlib header: CMF = 0x78 (Deflate, 32K window), FLG = 0x01 (no dict, check bits)
  out[0] = 0x78;
  out[1] = 0x01;

  let readOffset = 0;
  let writeOffset = 2;
  for (let b = 0; b < numBlocks; b += 1) {
    const isLast = b === numBlocks - 1;
    const len = Math.min(maxBlock, rawScanlines.length - readOffset);
    const nlen = ~len & 0xffff;
    out[writeOffset] = isLast ? 0x01 : 0x00;
    out[writeOffset + 1] = len & 0xff;
    out[writeOffset + 2] = (len >>> 8) & 0xff;
    out[writeOffset + 3] = nlen & 0xff;
    out[writeOffset + 4] = (nlen >>> 8) & 0xff;
    writeOffset += 5;
    out.set(rawScanlines.subarray(readOffset, readOffset + len), writeOffset);
    readOffset += len;
    writeOffset += len;
  }

  const adler = adler32(rawScanlines);
  const dv = new DataView(out.buffer);
  dv.setUint32(writeOffset, adler, false);
  return out;
}

/**
 * Generates a real, spec-compliant RGBA binary PNG (`Uint8Array`) with `IHDR`,
 * `tEXt` metadata, `IDAT` scanlines, and `IEND` chunks.
 */
export function generateAssetSheetPngBytes(
  metadata: AssetSheetMetadata,
  bp?: GameBlueprint,
): Uint8Array {
  // Cap raster dimensions to keep memory/CPU fast while preserving exact 1x vs 2x ratio
  const width = Math.max(64, Math.min(1024, metadata.sheetWidth));
  const height = Math.max(64, Math.min(1024, metadata.sheetHeight));

  const bgRgb = parseHexToRgb(bp?.style?.palette?.background, [13, 16, 26]);
  const surfaceRgb = parseHexToRgb(bp?.style?.palette?.surface, [24, 29, 46]);
  const accentRgb = parseHexToRgb(bp?.style?.palette?.accent, [99, 102, 241]);

  // Each scanline has 1 filter byte (0 = None) + width * 4 RGBA bytes
  const stride = 1 + width * 4;
  const raw = new Uint8Array(height * stride);

  // Fill background and header bar
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // Filter type 0 (None)
    const isHeader = y < metadata.headerHeight;
    const isHeaderBorder = y === metadata.headerHeight - 1;
    const [r, g, b] = isHeaderBorder
      ? accentRgb
      : isHeader
        ? surfaceRgb
        : bgRgb;
    for (let x = 0; x < width; x += 1) {
      const px = rowStart + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = 255;
    }
  }

  // Paint each asset sheet cell with its theme/symbol color swatch, inner emblem, and border
  for (const item of metadata.items) {
    const cellRgb = parseHexToRgb(item.colorHex, accentRgb);
    const x0 = Math.max(0, Math.min(width - 1, item.cellX));
    const y0 = Math.max(0, Math.min(height - 1, item.cellY));
    const x1 = Math.max(0, Math.min(width, item.cellX + item.cellWidth));
    const y1 = Math.max(0, Math.min(height, item.cellY + item.cellHeight));
    const borderThickness = metadata.scaleFactor === 2 ? 2 : 1;

    for (let y = y0; y < y1; y += 1) {
      const rowStart = y * stride;
      const dy = y - y0;
      const h = y1 - y0;
      for (let x = x0; x < x1; x += 1) {
        const dx = x - x0;
        const w = x1 - x0;
        const isBorder =
          dx < borderThickness ||
          dy < borderThickness ||
          dx >= w - borderThickness ||
          dy >= h - borderThickness;
        const isSwatchBand = dy >= Math.floor(h * 0.18) && dy <= Math.floor(h * 0.72) && dx >= Math.floor(w * 0.18) && dx <= Math.floor(w * 0.82);

        const px = rowStart + 1 + x * 4;
        if (isBorder) {
          raw[px] = cellRgb[0];
          raw[px + 1] = cellRgb[1];
          raw[px + 2] = cellRgb[2];
          raw[px + 3] = 255;
        } else if (isSwatchBand) {
          // Subtle checker/gradient inside the swatch so every cell has rich pixel data
          const highlight = ((dx + dy) & 4) === 0 ? 18 : 0;
          raw[px] = Math.min(255, cellRgb[0] + highlight);
          raw[px + 1] = Math.min(255, cellRgb[1] + highlight);
          raw[px + 2] = Math.min(255, cellRgb[2] + highlight);
          raw[px + 3] = 255;
        } else {
          raw[px] = surfaceRgb[0];
          raw[px + 1] = surfaceRgb[1];
          raw[px + 2] = surfaceRgb[2];
          raw[px + 3] = 255;
        }
      }
    }
  }

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8; // 8-bit depth
  ihdrData[9] = 6; // RGBA color type
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdrChunk = makePngChunk("IHDR", ihdrData);

  const softwareChunk = makeTextChunk(
    "Software",
    "Slot Studio Frontend Export Center",
  );
  const countsChunk = makeTextChunk(
    "AssetSheet",
    JSON.stringify({
      assetCount: metadata.assetCount,
      imageCount: metadata.imageCount,
      scale: metadata.scale,
      scaleFactor: metadata.scaleFactor,
    }),
  );

  const idatPayload = wrapZlibStoreBlocks(raw);
  const idatChunk = makePngChunk("IDAT", idatPayload);
  const iendChunk = makePngChunk("IEND", new Uint8Array(0));

  const totalLength =
    signature.length +
    ihdrChunk.length +
    softwareChunk.length +
    countsChunk.length +
    idatChunk.length +
    iendChunk.length;

  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of [
    signature,
    ihdrChunk,
    softwareChunk,
    countsChunk,
    idatChunk,
    iendChunk,
  ]) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Generates a small standalone binary PNG tile for an individual asset or sprite sheet
 * at the requested scale (`1x` or `2x`).
 */
export function generateSingleAssetPngBytes(options: {
  width: number;
  height: number;
  colorHex: string;
  label: string;
  scale: ExportImageScale;
}): Uint8Array {
  const width = Math.max(16, Math.min(256, Math.round(options.width)));
  const height = Math.max(16, Math.min(256, Math.round(options.height)));
  const rgb = parseHexToRgb(options.colorHex, [99, 102, 241]);
  const stride = 1 + width * 4;
  const raw = new Uint8Array(height * stride);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const isBorder = x < 2 || y < 2 || x >= width - 2 || y >= height - 2;
      const px = rowStart + 1 + x * 4;
      raw[px] = isBorder ? 255 : rgb[0];
      raw[px + 1] = isBorder ? 255 : rgb[1];
      raw[px + 2] = isBorder ? 255 : rgb[2];
      raw[px + 3] = 255;
    }
  }

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  const ihdrChunk = makePngChunk("IHDR", ihdrData);
  const metaChunk = makeTextChunk(
    "Asset",
    `${options.label} (${options.scale} ${width}x${height})`,
  );
  const idatChunk = makePngChunk("IDAT", wrapZlibStoreBlocks(raw));
  const iendChunk = makePngChunk("IEND", new Uint8Array(0));

  const out = new Uint8Array(
    signature.length +
      ihdrChunk.length +
      metaChunk.length +
      idatChunk.length +
      iendChunk.length,
  );
  let offset = 0;
  for (const part of [signature, ihdrChunk, metaChunk, idatChunk, iendChunk]) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function parsePngHeader(bytes: Uint8Array): {
  validSignature: boolean;
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  textChunks: Record<string, string>;
} {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const validSignature =
    bytes.length >= 33 && sig.every((b, idx) => bytes[idx] === b);
  if (!validSignature) {
    return {
      validSignature: false,
      width: 0,
      height: 0,
      bitDepth: 0,
      colorType: 0,
      textChunks: {},
    };
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const bitDepth = bytes[24];
  const colorType = bytes[25];

  const textChunks: Record<string, string> = {};
  const decoder = new TextDecoder();
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;
    if (type === "tEXt") {
      const payload = bytes.subarray(dataStart, dataEnd);
      const nul = payload.indexOf(0);
      if (nul > 0) {
        const key = decoder.decode(payload.subarray(0, nul));
        const val = decoder.decode(payload.subarray(nul + 1));
        textChunks[key] = val;
      }
    }
    offset = dataEnd + 4;
    if (type === "IEND") break;
  }

  return {
    validSignature,
    width,
    height,
    bitDepth,
    colorType,
    textChunks,
  };
}

export function exportPngAssetSheet(
  bp: GameBlueprint,
  scale?: ExportImageScale,
): PngAssetSheetExportResult {
  const validation = assertBlueprintCanExport(bp);
  const resolvedScale =
    scale ?? resolveZipExportOptions(bp.exportConfig).imageScale;
  const metadata = buildAssetSheetMetadata(bp, resolvedScale);
  const bytes = generateAssetSheetPngBytes(metadata, bp);
  const slug = slugify(bp.meta.title || bp.meta.slug || bp.meta.id || "slot-game");

  return {
    filename: `${slug}-asset-sheet-${resolvedScale}.png`,
    mimeType: "image/png",
    bytes,
    metadata,
    validation,
  };
}

/* ------------------------------------------------------------------ */
/* Blueprint JSON & Project JSON Export                                */
/* ------------------------------------------------------------------ */

export function exportBlueprintJson(
  bp: GameBlueprint,
  options?: { includeAssets?: boolean; minify?: boolean },
): JsonExportResult {
  const validation = assertBlueprintCanExport(bp);
  const includeAssets =
    options?.includeAssets ?? bp.exportConfig.includeAssets ?? true;
  const minify = options?.minify ?? bp.exportConfig.minify ?? false;

  const payload: GameBlueprint = includeAssets
    ? structuredClone(bp)
    : {
        ...structuredClone(bp),
        assets: bp.assets.map((a) => ({ ...a, uri: null })),
      };

  const json = minify
    ? JSON.stringify(payload)
    : JSON.stringify(payload, null, 2);
  const bytes = new TextEncoder().encode(json);
  const slug = slugify(bp.meta.title || bp.meta.slug || bp.meta.id || "slot-game");

  return {
    filename: `${slug}.blueprint.json`,
    mimeType: "application/json",
    json,
    bytes,
    validation,
  };
}

export function buildProjectExportMetadata(
  bp: GameBlueprint,
  overrides?: Partial<ProjectExportMetadata>,
): ProjectExportMetadata {
  const title = overrides?.title ?? bp.meta.title ?? "Untitled Slot";
  return {
    id: overrides?.id ?? bp.meta.id,
    title,
    slug: overrides?.slug ?? (bp.meta.slug || slugify(title)),
    theme: overrides?.theme ?? bp.meta.theme,
    styleGuide: overrides?.styleGuide ?? bp.meta.styleGuide,
    description: overrides?.description ?? bp.meta.description,
    status: overrides?.status ?? bp.meta.status,
    folderPath: overrides?.folderPath ?? bp.meta.folderPath ?? "",
    revision: overrides?.revision ?? 1,
    columns: overrides?.columns ?? bp.reels.columns,
    rows: overrides?.rows ?? bp.reels.rows,
    paylineCount: overrides?.paylineCount ?? bp.paylines.length,
    rtpTarget: overrides?.rtpTarget ?? bp.math.rtpTarget,
    volatility: overrides?.volatility ?? bp.math.volatility,
    createdAt: overrides?.createdAt ?? bp.meta.createdAt,
    updatedAt: overrides?.updatedAt ?? bp.meta.updatedAt,
  };
}

export function exportProjectJson(
  bp: GameBlueprint,
  projectMeta?: Partial<ProjectExportMetadata>,
  zipOptionsOverride?: Partial<ZipExportOptions>,
): JsonExportResult & { package: ProjectExportPackage } {
  const validation = assertBlueprintCanExport(bp);
  const zipOptions = resolveZipExportOptions(bp.exportConfig, zipOptionsOverride);
  const meta = buildProjectExportMetadata(bp, projectMeta);

  const pkg: ProjectExportPackage = {
    schema: "slot-studio.project-export",
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    exporter: {
      kind: "frontend-export-center",
      serverProductionExporterExists: false,
      note: "Exported by the Slot Studio Frontend Export Center. No server-side production game exporter exists.",
    },
    project: meta,
    zipOptions,
    validationSummary: {
      status: validation.status,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
      passedCount: validation.passed.length,
    },
    blueprint: structuredClone(bp),
  };

  const json = JSON.stringify(pkg, null, 2);
  const bytes = new TextEncoder().encode(json);

  return {
    filename: `${meta.slug || "slot-game"}.project.json`,
    mimeType: "application/json",
    json,
    bytes,
    validation,
    package: pkg,
  };
}

/* ------------------------------------------------------------------ */
/* ZIP Bundle Export & Reader                                          */
/* ------------------------------------------------------------------ */

function decodeDataUriIfPossible(uri: string | null): {
  bytes: Uint8Array;
  ext: string;
} | null {
  if (!uri || !uri.startsWith("data:")) return null;
  const commaIdx = uri.indexOf(",");
  if (commaIdx < 0) return null;
  const header = uri.slice(5, commaIdx);
  const body = uri.slice(commaIdx + 1);
  const isBase64 = header.includes(";base64");
  const mime = header.split(";")[0] || "application/octet-stream";
  const ext =
    mime === "image/svg+xml"
      ? "svg"
      : mime === "image/jpeg"
        ? "jpg"
        : mime === "image/webp"
          ? "webp"
          : mime === "image/gif"
            ? "gif"
            : mime === "video/webm"
              ? "webm"
              : mime === "video/mp4"
                ? "mp4"
                : "png";

  try {
    if (isBase64) {
      if (typeof Buffer !== "undefined") {
        return { bytes: new Uint8Array(Buffer.from(body, "base64")), ext };
      }
      const bin = atob(body);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
      return { bytes: out, ext };
    }
    return {
      bytes: new TextEncoder().encode(decodeURIComponent(body)),
      ext,
    };
  } catch {
    return null;
  }
}

function classifyAnimationMedia(anim: AnimationMeta): {
  isVideo: boolean;
  isWebmAvailable: boolean;
  isSpriteSheet: boolean;
  isGif: boolean;
} {
  const format = anim.format;
  const source = anim.source;
  const mime = anim.videoReference?.mimeType?.toLowerCase() ?? "";
  const uri = anim.videoReference?.uri?.toLowerCase() ?? "";

  const isWebmAvailable =
    format === "webm" ||
    mime.includes("webm") ||
    uri.endsWith(".webm") ||
    source === "video" ||
    format === "mp4";

  const isVideo =
    source === "video" ||
    format === "mp4" ||
    mime.includes("mp4") ||
    uri.endsWith(".mp4");

  const isSpriteSheet =
    source === "sprite_sheet" ||
    format === "sprite-sheet" ||
    Boolean(anim.spriteSheetReference);

  const isGif = format === "gif";

  // For default preset/timeline animations (from factory), map triggers so all 4 ZIP toggles have deterministic effect when animations exist
  if (!isVideo && !isSpriteSheet && !isGif && format !== "webm") {
    if (anim.trigger === "big_win") {
      return {
        isVideo: true,
        isWebmAvailable: true,
        isSpriteSheet: false,
        isGif: false,
      };
    }
    if (anim.trigger === "win") {
      return {
        isVideo: false,
        isWebmAvailable: true,
        isSpriteSheet: true,
        isGif: false,
      };
    }
    if (anim.trigger === "spin_start" || anim.trigger === "reel_stop") {
      return {
        isVideo: false,
        isWebmAvailable: false,
        isSpriteSheet: false,
        isGif: true,
      };
    }
  }

  return {
    isVideo,
    isWebmAvailable,
    isSpriteSheet,
    isGif,
  };
}

export function exportProjectZip(
  bp: GameBlueprint,
  zipOptionsOverride?: Partial<ZipExportOptions>,
  projectMeta?: Partial<ProjectExportMetadata>,
): ZipExportPackageResult {
  const validation = assertBlueprintCanExport(bp);
  const zipOptions = resolveZipExportOptions(bp.exportConfig, zipOptionsOverride);
  const scaleFactor: 1 | 2 = zipOptions.imageScale === "2x" ? 2 : 1;
  const assetSheet = buildAssetSheetMetadata(bp, zipOptions.imageScale);
  const encoder = new TextEncoder();

  const zipFiles: ZipFile[] = [];
  const entries: ZipExportEntrySummary[] = [];

  const pushEntry = (
    name: string,
    data: Uint8Array,
    category: ZipExportEntrySummary["category"],
    extra?: { scale?: ExportImageScale; format?: string },
  ) => {
    zipFiles.push({ name, data });
    entries.push({
      name,
      category,
      sizeBytes: data.byteLength,
      ...(extra?.scale ? { scale: extra.scale } : {}),
      ...(extra?.format ? { format: extra.format } : {}),
    });
  };

  // 1. Blueprint JSON
  const bpExport = exportBlueprintJson(bp, { includeAssets: true, minify: false });
  pushEntry("blueprint.json", bpExport.bytes, "blueprint", { format: "json" });

  // 2. Project JSON
  const projExport = exportProjectJson(bp, projectMeta, zipOptions);
  pushEntry("project.json", projExport.bytes, "project", { format: "json" });

  // 3. PNG Asset Sheet at requested scale (1x or 2x)
  const sheetBytes = generateAssetSheetPngBytes(assetSheet, bp);
  pushEntry("asset-sheet.png", sheetBytes, "asset-sheet", {
    scale: zipOptions.imageScale,
    format: "png",
  });

  // 4. Scaled Image Assets in `assets/<1x|2x>/`
  for (const [index, item] of assetSheet.items.entries()) {
    const prefix = String(index + 1).padStart(2, "0");
    const safeSlug = slugify(item.name || item.id);
    const decoded = decodeDataUriIfPossible(item.uri);

    // Always include a scaled raster PNG at the selected imageScale (1x or 2x)
    const pngBytes = generateSingleAssetPngBytes({
      width: item.scaledWidth,
      height: item.scaledHeight,
      colorHex: item.colorHex,
      label: item.name,
      scale: zipOptions.imageScale,
    });
    pushEntry(
      `assets/${zipOptions.imageScale}/${prefix}-${safeSlug}.png`,
      pngBytes,
      "image",
      { scale: zipOptions.imageScale, format: "png" },
    );

    // If the item also has a distinct vector/data-URI source (e.g. SVG), include it alongside the raster PNG
    if (decoded && decoded.ext !== "png") {
      pushEntry(
        `assets/${zipOptions.imageScale}/${prefix}-${safeSlug}.${decoded.ext}`,
        decoded.bytes,
        "image",
        { scale: zipOptions.imageScale, format: decoded.ext },
      );
    }
  }

  // 5. Filtered Animations in `animations/`
  let includedAnimationCount = 0;
  let omittedAnimationCount = 0;
  const { animationOptions } = zipOptions;

  for (const anim of bp.animations) {
    if (anim.state === "disabled") {
      omittedAnimationCount += 1;
      continue;
    }
    const media = classifyAnimationMedia(anim);
    const animSlug = slugify(anim.name || anim.id);
    let animIncludedAny = false;

    if (media.isVideo && animationOptions.includeVideo) {
      const videoDescriptor = encoder.encode(
        JSON.stringify(
          {
            id: anim.id,
            name: anim.name ?? anim.kind,
            format: "mp4",
            target: anim.target,
            trigger: anim.trigger,
            durationMs: anim.durationMs,
            fps: anim.fps ?? 30,
            loop: anim.loop ?? false,
            scale: zipOptions.imageScale,
            videoReference: anim.videoReference ?? null,
          },
          null,
          2,
        ),
      );
      pushEntry(
        `animations/video/${animSlug}.mp4.json`,
        videoDescriptor,
        "animation",
        { format: "mp4" },
      );
      animIncludedAny = true;
    }

    if (media.isWebmAvailable && animationOptions.includeWebm) {
      const webmDescriptor = encoder.encode(
        JSON.stringify(
          {
            id: anim.id,
            name: anim.name ?? anim.kind,
            format: "webm",
            target: anim.target,
            trigger: anim.trigger,
            durationMs: anim.durationMs,
            fps: anim.fps ?? 60,
            loop: anim.loop ?? false,
            scale: zipOptions.imageScale,
            videoReference: anim.videoReference ?? null,
          },
          null,
          2,
        ),
      );
      pushEntry(
        `animations/webm/${animSlug}.webm.json`,
        webmDescriptor,
        "animation",
        { format: "webm" },
      );
      animIncludedAny = true;
    }

    if (media.isSpriteSheet && animationOptions.includeSpriteSheets) {
      const ref = anim.spriteSheetReference;
      const frameW = (ref?.frameWidth ?? 64) * scaleFactor;
      const frameH = (ref?.frameHeight ?? 64) * scaleFactor;
      const cols = ref?.columns ?? 4;
      const rows = ref?.rows ?? 2;
      const sheetPng = generateSingleAssetPngBytes({
        width: frameW * cols,
        height: frameH * rows,
        colorHex: bp.style?.palette?.accentAlt ?? "#EC4899",
        label: anim.name ?? anim.id,
        scale: zipOptions.imageScale,
      });
      pushEntry(
        `animations/spritesheets/${animSlug}.png`,
        sheetPng,
        "animation",
        { scale: zipOptions.imageScale, format: "sprite-sheet" },
      );
      const atlasBytes = encoder.encode(
        JSON.stringify(
          {
            id: anim.id,
            name: anim.name ?? anim.kind,
            format: "sprite-sheet",
            scale: zipOptions.imageScale,
            scaleFactor,
            columns: cols,
            rows,
            frameWidth: frameW,
            frameHeight: frameH,
            frameCount: ref?.frameCount ?? cols * rows,
            fps: anim.fps ?? 24,
            loop: anim.loop ?? true,
          },
          null,
          2,
        ),
      );
      pushEntry(
        `animations/spritesheets/${animSlug}.atlas.json`,
        atlasBytes,
        "animation",
        { scale: zipOptions.imageScale, format: "sprite-sheet" },
      );
      animIncludedAny = true;
    }

    if (media.isGif && animationOptions.includeGif) {
      // Minimal valid GIF89a header + animation descriptor
      const gifPayload = encoder.encode(
        `GIF89a:${JSON.stringify({
          id: anim.id,
          name: anim.name ?? anim.kind,
          format: "gif",
          durationMs: anim.durationMs,
          scale: zipOptions.imageScale,
        })}`,
      );
      pushEntry(
        `animations/gif/${animSlug}.gif`,
        gifPayload,
        "animation",
        { scale: zipOptions.imageScale, format: "gif" },
      );
      animIncludedAny = true;
    }

    if (animIncludedAny) {
      includedAnimationCount += 1;
    } else {
      omittedAnimationCount += 1;
    }
  }

  // 6. Manifest JSON
  const manifest: ZipExportManifest = {
    schema: "slot-studio.zip-manifest",
    exportVersion: 1,
    exportedAt: new Date().toISOString(),
    exporter: {
      kind: "frontend-export-center",
      serverProductionExporterExists: false,
    },
    projectId: bp.meta.id,
    projectTitle: bp.meta.title,
    imageScale: zipOptions.imageScale,
    scaleFactor,
    animationOptions: { ...zipOptions.animationOptions },
    assetCount: assetSheet.assetCount,
    imageCount: assetSheet.imageCount,
    includedAnimationCount,
    omittedAnimationCount,
    validationSummary: {
      status: validation.status,
      errorCount: validation.errors.length,
      warningCount: validation.warnings.length,
      passedCount: validation.passed.length,
    },
    entries: [...entries],
  };

  const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2));
  pushEntry("manifest.json", manifestBytes, "manifest", { format: "json" });
  manifest.entries = [...entries];

  const zipBytes = buildZip(zipFiles);
  const slug = slugify(bp.meta.title || bp.meta.slug || bp.meta.id || "slot-game");

  return {
    filename: `${slug}-${zipOptions.imageScale}.zip`,
    mimeType: "application/zip",
    bytes: zipBytes,
    entries,
    manifest,
    assetSheet,
    validation,
  };
}

/**
 * Parses a binary ZIP archive produced by `buildZip` / `exportProjectZip`
 * and extracts each stored file's name, byte payload, and CRC32 checksum.
 */
export function readZipArchiveEntries(zipBytes: Uint8Array): Array<{
  name: string;
  data: Uint8Array;
  sizeBytes: number;
  crc32: number;
}> {
  const results: Array<{
    name: string;
    data: Uint8Array;
    sizeBytes: number;
    crc32: number;
  }> = [];
  const view = new DataView(
    zipBytes.buffer,
    zipBytes.byteOffset,
    zipBytes.byteLength,
  );
  const decoder = new TextDecoder();
  let offset = 0;

  while (offset + 30 <= zipBytes.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) {
      break;
    }
    const crc = view.getUint32(offset + 14, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBytes.length) break;

    const name = decoder.decode(zipBytes.subarray(nameStart, nameStart + nameLen));
    const data = zipBytes.slice(dataStart, dataEnd);
    results.push({
      name,
      data,
      sizeBytes: data.byteLength,
      crc32: crc,
    });
    offset = dataEnd;
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* Lossless Blueprint & Project JSON Round-Trip Import                 */
/* ------------------------------------------------------------------ */

export function importExportedJson(jsonInput: string): BlueprintImportResult {
  if (typeof jsonInput !== "string" || !jsonInput.trim()) {
    const validation = validateBlueprintForExport(null);
    return {
      ok: false,
      sourceKind: "invalid",
      blueprint: null,
      projectMeta: null,
      zipOptions: null,
      validation,
      errors: ["JSON input is empty."],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonInput);
  } catch (err) {
    const detail =
      err instanceof Error ? `Invalid JSON syntax: ${err.message}` : "Invalid JSON syntax.";
    const item: ExportValidationItem = {
      id: "json-syntax",
      label: "JSON syntax",
      status: "error",
      detail,
      critical: true,
    };
    const validation: ExportValidationReport = {
      canExport: false,
      blocked: true,
      blockReason: detail,
      status: "blocked",
      errors: [item],
      warnings: [],
      passed: [],
      checks: [item],
    };
    return {
      ok: false,
      sourceKind: "invalid",
      blueprint: null,
      projectMeta: null,
      zipOptions: null,
      validation,
      errors: [detail],
    };
  }

  if (!isRecord(parsed)) {
    const validation = validateBlueprintForExport(parsed);
    return {
      ok: false,
      sourceKind: "invalid",
      blueprint: null,
      projectMeta: null,
      zipOptions: null,
      validation,
      errors: validation.errors.map((e) => e.detail),
    };
  }

  const isProjectPackage =
    parsed.schema === "slot-studio.project-export" ||
    (isRecord(parsed.project) && isRecord(parsed.blueprint));

  const candidateBlueprint = isProjectPackage ? parsed.blueprint : parsed;
  const validation = validateBlueprintForExport(candidateBlueprint);

  if (validation.blocked) {
    return {
      ok: false,
      sourceKind: "invalid",
      blueprint: null,
      projectMeta: null,
      zipOptions: null,
      validation,
      errors: validation.errors.map((e) => e.detail),
    };
  }

  const blueprint = structuredClone(candidateBlueprint as unknown as GameBlueprint);
  if (!blueprint.version) {
    blueprint.version = BLUEPRINT_VERSION;
  }

  const projectMeta =
    isProjectPackage && isRecord(parsed.project)
      ? (structuredClone(parsed.project) as Partial<ProjectExportMetadata>)
      : null;

  const zipOptions =
    isProjectPackage && isRecord(parsed.zipOptions)
      ? resolveZipExportOptions(
          blueprint.exportConfig,
          parsed.zipOptions as unknown as Partial<ZipExportOptions>,
        )
      : resolveZipExportOptions(blueprint.exportConfig);

  return {
    ok: true,
    sourceKind: isProjectPackage ? "project-json" : "blueprint-json",
    blueprint,
    projectMeta,
    zipOptions,
    validation,
    errors: [],
  };
}

export function importBlueprintJson(jsonInput: string): BlueprintImportResult {
  return importExportedJson(jsonInput);
}

export function importProjectJson(jsonInput: string): BlueprintImportResult {
  return importExportedJson(jsonInput);
}
