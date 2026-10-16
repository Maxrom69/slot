import { elementTypeMeta } from "@/lib/blueprint/elements";
import type { AssetFormat, AssetRef, GameBlueprint, ImageRevision } from "@/lib/blueprint/types";

export interface AssetUsageItem {
  id: string;
  name: string;
  category:
    | "symbol"
    | "element"
    | "symbol_set_frame"
    | "symbol_set_bg"
    | "variant"
    | "history"
    | "scene_object"
    | "scene_background"
    | "canvas_background"
    | "style_reference";
  label: string;
  detail: string;
}

/** Determines all elements, symbols, scenes, revisions, and decorations referencing this asset. */
export function findAssetUsage(bp: GameBlueprint, assetId: string): AssetUsageItem[] {
  if (!assetId) return [];
  const matches: AssetUsageItem[] = [];

  // 1. Elements & Element Image History
  for (const el of bp.elements ?? []) {
    const isPrimary = el.assetId === assetId || el.image?.assetId === assetId;
    if (isPrimary) {
      matches.push({
        id: el.id,
        name: el.name,
        category: "element",
        label: `${el.name} (${elementTypeMeta(el.type).label})`,
        detail: "Element primary artwork",
      });
    } else {
      const histRev = (el.imageHistory ?? []).find((h) => h.asset?.assetId === assetId);
      if (histRev) {
        matches.push({
          id: histRev.id,
          name: el.name,
          category: "history",
          label: `Revision: ${el.name}`,
          detail: `Recorded element image revision (${histRev.source})`,
        });
      }
    }

    if (el.symbolSet?.frame?.assetId === assetId) {
      matches.push({
        id: el.id,
        name: el.name,
        category: "symbol_set_frame",
        label: `${el.name} (Frame)`,
        detail: "Symbol set frame decoration",
      });
    }
    if (el.symbolSet?.background?.assetId === assetId) {
      matches.push({
        id: el.id,
        name: el.name,
        category: "symbol_set_bg",
        label: `${el.name} (Background)`,
        detail: "Symbol set background decoration",
      });
    }
  }

  // 2. Symbols & Variants & History
  for (const sym of bp.symbols ?? []) {
    const isPrimary = sym.assetId === assetId || sym.image?.assetId === assetId;
    if (isPrimary) {
      matches.push({
        id: sym.id,
        name: sym.name,
        category: "symbol",
        label: `Symbol: ${sym.name}`,
        detail: `Primary symbol artwork (${sym.code})`,
      });
    } else {
      const histRev = (sym.imageHistory ?? []).find((h) => h.asset?.assetId === assetId);
      if (histRev) {
        matches.push({
          id: histRev.id,
          name: sym.name,
          category: "history",
          label: `Revision: ${sym.name}`,
          detail: `Recorded image revision (${histRev.source})`,
        });
      }
    }

    for (const v of sym.variants ?? []) {
      if (v.image?.assetId === assetId) {
        matches.push({
          id: v.id,
          name: v.name,
          category: "variant",
          label: `Variant: ${v.name} (${sym.name})`,
          detail: "Symbol custom variant image",
        });
      }
    }
  }

  // 3. Canvas Background
  if (bp.canvas?.backgroundAssetId === assetId) {
    matches.push({
      id: "canvas-bg",
      name: "Canvas Background",
      category: "canvas_background",
      label: "Canvas Background",
      detail: "Default scene canvas background asset",
    });
  }

  // 4. Style Reference
  if (bp.style?.referenceAssetId === assetId) {
    matches.push({
      id: "style-ref",
      name: "Style Reference",
      category: "style_reference",
      label: "Style Reference",
      detail: "Art direction moodboard image",
    });
  }

  // 5. Scenes (Background and Objects)
  for (const scene of bp.scenes ?? []) {
    if (scene.background?.assetId === assetId) {
      matches.push({
        id: scene.id,
        name: scene.name,
        category: "scene_background",
        label: `Scene: ${scene.name} (Background)`,
        detail: "Scene backdrop asset",
      });
    }
    for (const obj of scene.objects ?? []) {
      if (obj.assetId === assetId) {
        matches.push({
          id: obj.id,
          name: obj.name,
          category: "scene_object",
          label: `Scene: ${scene.name} (Object: ${obj.name})`,
          detail: `Positioned ${obj.kind} in scene`,
        });
      }
    }
  }

  return matches;
}

/**
 * Safely unbinds an asset from every location in the GameBlueprint.
 * No references are left dangling; placeholder states are restored cleanly.
 */
export function safeUnbindAsset(bp: GameBlueprint, assetId: string): GameBlueprint {
  // Elements
  const elements = (bp.elements ?? []).map((el) => {
    let changed = false;
    let nextAssetId = el.assetId;
    let nextImage = el.image;
    let nextOrigin = el.origin;
    let nextSymbolSet = el.symbolSet;
    let nextHistory = el.imageHistory;

    if (el.assetId === assetId) {
      nextAssetId = null;
      nextOrigin = "planned";
      changed = true;
    }
    if (el.image?.assetId === assetId) {
      nextImage = null;
      changed = true;
    }
    if (el.imageHistory?.some((h) => h.asset?.assetId === assetId)) {
      nextHistory = el.imageHistory.map((h) =>
        h.asset?.assetId === assetId ? { ...h, asset: null } : h,
      );
      changed = true;
    }
    if (el.symbolSet?.frame?.assetId === assetId) {
      nextSymbolSet = { ...el.symbolSet, frame: null };
      changed = true;
    }
    if (el.symbolSet?.background?.assetId === assetId) {
      nextSymbolSet = { ...el.symbolSet, background: null };
      changed = true;
    }

    if (!changed) return el;
    return {
      ...el,
      assetId: nextAssetId,
      image: nextImage,
      ...(nextHistory !== undefined ? { imageHistory: nextHistory } : {}),
      origin: nextOrigin,
      symbolSet: nextSymbolSet,
    };
  });

  // Symbols & Variants & History
  const symbols = (bp.symbols ?? []).map((sym) => {
    let changed = false;
    let nextAssetId = sym.assetId;
    let nextImage = sym.image;
    let nextVariants = sym.variants;
    let nextHistory = sym.imageHistory;

    if (sym.assetId === assetId) {
      nextAssetId = null;
      changed = true;
    }
    if (sym.image?.assetId === assetId) {
      nextImage = null;
      changed = true;
    }
    if (sym.variants?.some((v) => v.image?.assetId === assetId)) {
      nextVariants = sym.variants.map((v) =>
        v.image?.assetId === assetId ? { ...v, image: null } : v,
      );
      changed = true;
    }
    if (sym.imageHistory?.some((h) => h.asset?.assetId === assetId)) {
      nextHistory = sym.imageHistory.map((h) =>
        h.asset?.assetId === assetId ? { ...h, asset: null } : h,
      );
      changed = true;
    }

    if (!changed) return sym;
    return {
      ...sym,
      assetId: nextAssetId,
      image: nextImage,
      variants: nextVariants,
      imageHistory: nextHistory,
    };
  });

  // Canvas background
  const canvas = {
    ...bp.canvas,
    backgroundAssetId: bp.canvas?.backgroundAssetId === assetId ? null : bp.canvas?.backgroundAssetId ?? null,
  };

  // Style reference
  const style = {
    ...bp.style,
    referenceAssetId: bp.style?.referenceAssetId === assetId ? null : bp.style?.referenceAssetId ?? null,
  };

  // Scenes
  const scenes = (bp.scenes ?? []).map((scene) => {
    let changed = false;
    let nextBg = scene.background;
    let nextObjects = scene.objects;

    if (scene.background?.assetId === assetId) {
      nextBg = { ...scene.background, assetId: null };
      changed = true;
    }
    if (scene.objects?.some((obj) => obj.assetId === assetId)) {
      nextObjects = scene.objects.map((obj) =>
        obj.assetId === assetId ? { ...obj, assetId: null } : obj,
      );
      changed = true;
    }

    if (!changed) return scene;
    return {
      ...scene,
      background: nextBg,
      objects: nextObjects,
    };
  });

  // Assets list: remove the deleted asset
  const assets = (bp.assets ?? []).filter((a) => a.id !== assetId);

  return {
    ...bp,
    elements,
    symbols,
    canvas,
    style,
    scenes,
    assets,
  };
}

export type AssignTargetType =
  | "symbol"
  | "symbol_variant"
  | "element"
  | "symbol_set_frame"
  | "symbol_set_bg"
  | "scene_background"
  | "canvas_background"
  | "style_reference";

export interface AssignTarget {
  type: AssignTargetType;
  targetId: string;
}

function appendHistoryRevision(
  ownerId: string,
  prevImage: { provider: "project" | "external" | "placeholder"; assetId?: string | null; uri?: string | null; name?: string } | null,
  nextImage: { provider: "project"; assetId: string; name?: string },
  existingHistory: ImageRevision[] | undefined,
  notes: string,
  source: ImageRevision["source"] = "upload",
): ImageRevision[] {
  let history = [...(existingHistory ?? [])];
  if (
    prevImage &&
    prevImage.provider === "project" &&
    prevImage.assetId &&
    prevImage.assetId !== nextImage.assetId &&
    !history.some((r) => r.asset?.provider === "project" && r.asset.assetId === prevImage.assetId)
  ) {
    history = [
      {
        id: `${ownerId}-rev-init-${Date.now().toString(36)}`,
        asset: prevImage,
        createdAt: new Date(Date.now() - 1).toISOString(),
        source: "create",
        notes: "Initial artwork",
      },
      ...history,
    ];
  }
  const historyRevision: ImageRevision = {
    id: `${ownerId}-rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    asset: nextImage,
    createdAt: new Date().toISOString(),
    source,
    notes,
  };
  return [historyRevision, ...history].slice(0, 100);
}

/** Assigns an asset to an element, symbol, variant, scene background, or canvas setting. */
export function assignAsset(bp: GameBlueprint, assetId: string, target: AssignTarget): GameBlueprint {
  const asset = bp.assets.find((a) => a.id === assetId);
  const assetRef = asset
    ? { provider: "project" as const, assetId: asset.id, name: asset.name }
    : { provider: "project" as const, assetId };

  if (target.type === "symbol") {
    const symbols = (bp.symbols ?? []).map((sym) => {
      if (sym.id !== target.targetId) return sym;
      const prevImage = sym.image ?? (sym.assetId ? { provider: "project" as const, assetId: sym.assetId } : null);
      const imageHistory = appendHistoryRevision(
        sym.id,
        prevImage,
        assetRef,
        sym.imageHistory,
        `Assigned asset “${asset?.name ?? assetId}” from Asset Library`,
      );
      return {
        ...sym,
        assetId,
        image: assetRef,
        imageHistory,
      };
    });
    return { ...bp, symbols };
  }

  if (target.type === "symbol_variant") {
    const [maybeSymbolId, maybeVariantId] = target.targetId.includes("::")
      ? target.targetId.split("::", 2)
      : ["", target.targetId];
    const symbols = (bp.symbols ?? []).map((sym) => {
      if (maybeSymbolId && sym.id !== maybeSymbolId) return sym;
      if (!(sym.variants ?? []).some((v) => v.id === maybeVariantId)) return sym;
      return {
        ...sym,
        variants: (sym.variants ?? []).map((v) =>
          v.id === maybeVariantId ? { ...v, image: assetRef } : v,
        ),
      };
    });
    return { ...bp, symbols };
  }

  if (target.type === "element") {
    const targetEl = (bp.elements ?? []).find((el) => el.id === target.targetId);
    if (targetEl?.type === "symbol" && targetEl.symbolIds[0]) {
      return assignAsset(bp, assetId, { type: "symbol", targetId: targetEl.symbolIds[0] });
    }
    const elements = (bp.elements ?? []).map((el) => {
      if (el.id !== target.targetId) return el;
      const prevImage = el.image ?? (el.assetId ? { provider: "project" as const, assetId: el.assetId } : null);
      const imageHistory = appendHistoryRevision(
        el.id,
        prevImage,
        assetRef,
        el.imageHistory,
        `Assigned asset “${asset?.name ?? assetId}” from Asset Library`,
      );
      return {
        ...el,
        assetId,
        image: assetRef,
        imageHistory,
        origin: "imported" as const,
      };
    });
    return { ...bp, elements };
  }

  if (target.type === "symbol_set_frame") {
    const elements = (bp.elements ?? []).map((el) => {
      if (el.id !== target.targetId || !el.symbolSet) return el;
      return {
        ...el,
        symbolSet: { ...el.symbolSet, frame: assetRef },
      };
    });
    return { ...bp, elements };
  }

  if (target.type === "symbol_set_bg") {
    const elements = (bp.elements ?? []).map((el) => {
      if (el.id !== target.targetId || !el.symbolSet) return el;
      return {
        ...el,
        symbolSet: { ...el.symbolSet, background: assetRef },
      };
    });
    return { ...bp, elements };
  }

  if (target.type === "scene_background") {
    const scenes = (bp.scenes ?? []).map((scene) => {
      if (scene.id !== target.targetId) return scene;
      return {
        ...scene,
        background: { ...scene.background, color: scene.background?.color ?? null, assetId },
      };
    });
    return { ...bp, scenes };
  }

  if (target.type === "canvas_background") {
    return {
      ...bp,
      canvas: { ...bp.canvas, backgroundAssetId: assetId },
    };
  }

  if (target.type === "style_reference") {
    return {
      ...bp,
      style: { ...bp.style, referenceAssetId: assetId },
    };
  }

  return bp;
}

/**
 * Restores a symbol or standalone element in a GameBlueprint to a specific
 * recorded image revision while preserving the full revision history.
 */
export function restoreBlueprintImageRevision(
  bp: GameBlueprint,
  target: { kind: "symbol" | "element"; id: string; revisionId: string },
): GameBlueprint {
  if (target.kind === "symbol") {
    const symbols = (bp.symbols ?? []).map((sym) => {
      if (sym.id !== target.id) return sym;
      const rev = (sym.imageHistory ?? []).find((r) => r.id === target.revisionId);
      if (!rev) return sym;
      const nextImage = rev.asset ?? null;
      const nextAssetId = nextImage?.provider === "project" ? (nextImage.assetId ?? null) : null;
      const restoreRev: ImageRevision = {
        id: `${sym.id}-rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        asset: nextImage,
        createdAt: new Date().toISOString(),
        source: "restore",
        notes: `Restored from revision ${rev.id}`,
      };
      return {
        ...sym,
        assetId: nextAssetId,
        image: nextImage,
        imageHistory: [restoreRev, ...(sym.imageHistory ?? [])].slice(0, 100),
      };
    });
    return { ...bp, symbols };
  }

  const elements = (bp.elements ?? []).map((el) => {
    if (el.id !== target.id) return el;
    const rev = (el.imageHistory ?? []).find((r) => r.id === target.revisionId);
    if (!rev) return el;
    const nextImage = rev.asset ?? null;
    const nextAssetId = nextImage?.provider === "project" ? (nextImage.assetId ?? null) : null;
    const restoreRev: ImageRevision = {
      id: `${el.id}-rev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      asset: nextImage,
      createdAt: new Date().toISOString(),
      source: "restore",
      notes: `Restored from revision ${rev.id}`,
    };
    return {
      ...el,
      assetId: nextAssetId,
      image: nextImage,
      origin: nextAssetId ? ("imported" as const) : ("planned" as const),
      imageHistory: [restoreRev, ...(el.imageHistory ?? [])].slice(0, 100),
    };
  });
  return { ...bp, elements };
}

/** Determines format and transparency tag for display and filtering. */
export function detectAssetFormat(asset: AssetRef): {
  format: AssetFormat;
  label: string;
  isTransparent: boolean;
} {
  if (asset.format) {
    const isTrans = asset.format === "png-transparent" || asset.format === "svg" || Boolean(asset.hasAlpha);
    const labels: Record<AssetFormat, string> = {
      "png-transparent": "Transparent PNG",
      png: "PNG Image",
      jpeg: "JPEG Image",
      webp: "WebP Image",
      svg: "Vector (SVG)",
      "json-animation": "Animation JSON",
      audio: "Audio",
      other: "Other Asset",
    };
    return { format: asset.format, label: labels[asset.format] || "Asset", isTransparent: isTrans };
  }

  const uri = (asset.uri ?? "").toLowerCase();
  const mime = (asset.mime ?? "").toLowerCase();

  if (uri.endsWith(".svg") || mime.includes("svg")) {
    return { format: "svg", label: "Vector (SVG)", isTransparent: true };
  }
  if (uri.endsWith(".json") || mime.includes("json") || asset.kind === "spine") {
    return { format: "json-animation", label: "Animation JSON", isTransparent: false };
  }
  if (uri.endsWith(".jpg") || uri.endsWith(".jpeg") || mime.includes("jpeg")) {
    return { format: "jpeg", label: "JPEG Image", isTransparent: false };
  }
  if (uri.endsWith(".webp") || mime.includes("webp")) {
    const hasAlpha = Boolean(asset.hasAlpha);
    return { format: "webp", label: hasAlpha ? "WebP (Alpha)" : "WebP Image", isTransparent: hasAlpha };
  }
  if (uri.endsWith(".png") || mime.includes("png")) {
    const isTrans = asset.hasAlpha !== false; // PNGs in slot machines are typically transparent
    return { format: isTrans ? "png-transparent" : "png", label: isTrans ? "Transparent PNG" : "PNG Image", isTransparent: isTrans };
  }
  if (asset.kind === "audio" || uri.match(/\.(mp3|wav|ogg|aac)$/i)) {
    return { format: "audio", label: "Audio", isTransparent: false };
  }

  return { format: "other", label: "Other Asset", isTransparent: false };
}
