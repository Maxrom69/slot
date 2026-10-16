import type {
  AssetRef,
  AssetReference,
  ElementDef,
  GameBlueprint,
  ImageRevision,
  SymbolDef,
} from "@/lib/blueprint/types";
import { finalizeDoc } from "./model";
import {
  restoreElementImageRevision,
  restoreImageRevision,
  sameAssetRef,
} from "./operations";
import type { DesignDoc } from "./types";

export type ImageHistoryTarget =
  | { kind: "element"; id: string }
  | { kind: "symbol"; id: string };

export const REVISION_SOURCE_LABELS: Record<ImageRevision["source"], string> = {
  create: "Created",
  import: "Imported",
  upload: "Uploaded",
  duplicate: "Duplicated",
  variant: "From variant",
  restore: "Restored",
};

export interface RevisionViewItem {
  id: string;
  revision: ImageRevision;
  versionNumber: number;
  displayLabel: string;
  notes: string;
  thumbnailUri: string | null;
  assetName: string;
  assetRefText: string;
  dimensionsText: string;
  formatText: string;
  sizeText: string;
  timestamp: string;
  formattedTimestamp: string;
  source: ImageRevision["source"];
  sourceLabel: string;
  isCurrent: boolean;
  matchesActiveAsset: boolean;
}

export interface RevisionDependencyEntry {
  id: string;
  category:
    | "current"
    | "variant"
    | "element"
    | "symbol"
    | "scene"
    | "canvas"
    | "style"
    | "history";
  label: string;
  detail: string;
}

export interface RevisionDeletionImpact {
  revisionId: string;
  revisionLabel: string;
  asset: AssetReference | null;
  isCurrentActive: boolean;
  dependencies: RevisionDependencyEntry[];
  requiresWarning: boolean;
}

export function formatRevisionAssetRef(ref: AssetReference | null | undefined): string {
  if (!ref) return "none (placeholder)";
  if (ref.provider === "project") return `project:${ref.assetId ?? "—"}`;
  if (ref.provider === "external") return `external:${ref.uri ?? "—"}`;
  return `placeholder:${ref.name ?? "default"}`;
}

export function formatRevisionTimestamp(ts: string): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function resolveRevisionAsset(
  doc: DesignDoc,
  ref: AssetReference | null | undefined,
): { uri: string | null; asset: AssetRef | null; name: string } {
  if (!ref) {
    return { uri: null, asset: null, name: "Cleared / Placeholder" };
  }
  if (ref.provider === "project" && ref.assetId) {
    const found = doc.assets.find((a) => a.id === ref.assetId) ?? null;
    const uri = found && found.state === "linked" && found.uri ? found.uri : null;
    return {
      uri,
      asset: found,
      name: found?.name ?? ref.name ?? ref.assetId,
    };
  }
  if (ref.provider === "external" && ref.uri) {
    return {
      uri: ref.uri,
      asset: null,
      name: ref.name ?? ref.uri,
    };
  }
  return {
    uri: null,
    asset: null,
    name: ref.name ?? "Placeholder",
  };
}

function resolveTargetHolder(
  doc: DesignDoc,
  target: ImageHistoryTarget,
): {
  kind: "element" | "symbol";
  id: string;
  name: string;
  currentImage: AssetReference | null;
  history: ImageRevision[];
} | null {
  if (target.kind === "symbol") {
    const sym = doc.symbols.find((s) => s.id === target.id);
    if (!sym) return null;
    const currentImage =
      sym.image ?? (sym.assetId ? { provider: "project", assetId: sym.assetId } : null);
    return {
      kind: "symbol",
      id: sym.id,
      name: sym.name,
      currentImage,
      history: sym.imageHistory ?? [],
    };
  }

  const el = doc.elements.find((e) => e.id === target.id);
  if (!el) return null;
  if (el.type === "symbol" && el.symbolIds[0]) {
    const sym = doc.symbols.find((s) => s.id === el.symbolIds[0]);
    if (sym) {
      const currentImage =
        sym.image ?? (sym.assetId ? { provider: "project", assetId: sym.assetId } : null);
      return {
        kind: "symbol",
        id: sym.id,
        name: el.name || sym.name,
        currentImage,
        history: sym.imageHistory ?? [],
      };
    }
  }

  const currentImage =
    el.image ?? (el.assetId ? { provider: "project", assetId: el.assetId } : null);
  return {
    kind: "element",
    id: el.id,
    name: el.name,
    currentImage,
    history: el.imageHistory ?? [],
  };
}

/**
 * Builds the normalized list of revision view items for the F12 Image History
 * timeline/grid, including thumbnail, timestamp, source, label, and current indicator.
 */
export function getImageHistoryItems(
  doc: DesignDoc,
  target: ImageHistoryTarget,
): RevisionViewItem[] {
  const holder = resolveTargetHolder(doc, target);
  if (!holder) return [];

  const total = holder.history.length;
  let markedCurrent = false;

  return holder.history.map((rev, idx) => {
    const versionNumber = total - idx;
    const resolved = resolveRevisionAsset(doc, rev.asset);
    const matchesActiveAsset = sameAssetRef(rev.asset, holder.currentImage);
    const isCurrent = !markedCurrent && matchesActiveAsset;
    if (isCurrent) markedCurrent = true;

    const defaultLabel = `v${versionNumber} — ${
      rev.label?.trim() || rev.notes?.trim() || resolved.name
    }`;

    return {
      id: rev.id,
      revision: rev,
      versionNumber,
      displayLabel: rev.label?.trim() || defaultLabel,
      notes: rev.notes ?? "",
      thumbnailUri: resolved.uri,
      assetName: resolved.name,
      assetRefText: formatRevisionAssetRef(rev.asset),
      dimensionsText:
        resolved.asset?.width && resolved.asset?.height
          ? `${resolved.asset.width} × ${resolved.asset.height} px`
          : "Auto",
      formatText: resolved.asset?.format ?? (rev.asset?.provider === "external" ? "External URL" : "Vector / Standard"),
      sizeText: formatBytes(resolved.asset?.sizeBytes),
      timestamp: rev.createdAt,
      formattedTimestamp: formatRevisionTimestamp(rev.createdAt),
      source: rev.source,
      sourceLabel: REVISION_SOURCE_LABELS[rev.source] ?? rev.source,
      isCurrent,
      matchesActiveAsset,
    };
  });
}

/**
 * Computes all components that depend on a revision's image asset or active state
 * before allowing deletion.
 *
 * Per F12 rules: DO NOT actually delete a version if another component still
 * requires it without showing a dependency warning.
 */
export function checkRevisionDeletionImpact(
  doc: DesignDoc,
  target: ImageHistoryTarget,
  revisionId: string,
  blueprint?: GameBlueprint | null,
): RevisionDeletionImpact {
  const holder = resolveTargetHolder(doc, target);
  const rev = holder?.history.find((r) => r.id === revisionId) ?? null;

  if (!holder || !rev) {
    return {
      revisionId,
      revisionLabel: revisionId,
      asset: null,
      isCurrentActive: false,
      dependencies: [],
      requiresWarning: false,
    };
  }

  const resolved = resolveRevisionAsset(doc, rev.asset);
  const revisionLabel = rev.label?.trim() || rev.notes?.trim() || resolved.name || rev.id;
  const dependencies: RevisionDependencyEntry[] = [];
  const isCurrentActive = sameAssetRef(rev.asset, holder.currentImage);

  if (isCurrentActive) {
    dependencies.push({
      id: `current-${holder.kind}-${holder.id}`,
      category: "current",
      label: `${holder.name} (Active Current Artwork)`,
      detail: "This version is currently set as the active image on this item.",
    });
  }

  const ref = rev.asset;
  if (ref) {
    const projectAssetId = ref.provider === "project" ? (ref.assetId ?? null) : null;

    // 1. Check other elements and their variants / set frame / set background
    for (const el of doc.elements) {
      const elRef = el.image ?? (el.assetId ? { provider: "project" as const, assetId: el.assetId } : null);
      const isSameTarget =
        (holder.kind === "element" && el.id === holder.id) ||
        (holder.kind === "symbol" && el.type === "symbol" && el.symbolIds[0] === holder.id);

      if (!isSameTarget && sameAssetRef(elRef, ref)) {
        dependencies.push({
          id: `el-${el.id}`,
          category: "element",
          label: `Element “${el.name}”`,
          detail: `Active artwork on ${el.type.replace(/_/g, " ")} (${el.id})`,
        });
      }

      if (el.symbolSet?.frame && sameAssetRef(el.symbolSet.frame, ref)) {
        dependencies.push({
          id: `set-frame-${el.id}`,
          category: "element",
          label: `Symbol Set “${el.name}” Frame`,
          detail: `Used as the shared frame artwork for set ${el.id}`,
        });
      }
      if (el.symbolSet?.background && sameAssetRef(el.symbolSet.background, ref)) {
        dependencies.push({
          id: `set-bg-${el.id}`,
          category: "element",
          label: `Symbol Set “${el.name}” Background`,
          detail: `Used as the shared background artwork for set ${el.id}`,
        });
      }

      for (const v of el.variants ?? []) {
        if (sameAssetRef(v.image, ref)) {
          dependencies.push({
            id: `el-var-${v.id}`,
            category: "variant",
            label: `Variant “${v.name}”`,
            detail: `Used by variant ${v.id} on element “${el.name}”`,
          });
        }
      }

      for (const h of el.imageHistory ?? []) {
        if (h.id !== revisionId && sameAssetRef(h.asset, ref)) {
          dependencies.push({
            id: `el-hist-${el.id}-${h.id}`,
            category: "history",
            label: `History Revision on “${el.name}”`,
            detail: `Referenced by revision ${h.id}`,
          });
        }
      }
    }

    // 2. Check symbols and their variants
    for (const sym of doc.symbols) {
      const symRef = sym.image ?? (sym.assetId ? { provider: "project" as const, assetId: sym.assetId } : null);
      const isSameTarget = holder.kind === "symbol" && sym.id === holder.id;

      if (!isSameTarget && sameAssetRef(symRef, ref)) {
        dependencies.push({
          id: `sym-${sym.id}`,
          category: "symbol",
          label: `Symbol “${sym.name}” (${sym.code})`,
          detail: `Active artwork on symbol ${sym.id}`,
        });
      }

      for (const v of sym.variants ?? []) {
        if (sameAssetRef(v.image, ref)) {
          dependencies.push({
            id: `sym-var-${v.id}`,
            category: "variant",
            label: `Variant “${v.name}”`,
            detail: `Used by variant ${v.id} on symbol “${sym.name}”`,
          });
        }
      }

      for (const h of sym.imageHistory ?? []) {
        if (h.id !== revisionId && sameAssetRef(h.asset, ref)) {
          dependencies.push({
            id: `sym-hist-${sym.id}-${h.id}`,
            category: "history",
            label: `History Revision on “${sym.name}”`,
            detail: `Referenced by revision ${h.id}`,
          });
        }
      }
    }

    // 3. Check scenes, canvas, and style reference if projectAssetId is present
    if (projectAssetId) {
      const scenes = blueprint?.scenes ?? doc.scenes ?? [];
      for (const scene of scenes) {
        if (scene.background?.assetId === projectAssetId) {
          dependencies.push({
            id: `scene-bg-${scene.id}`,
            category: "scene",
            label: `Scene “${scene.name}” Background`,
            detail: `Used as background artwork on scene ${scene.id}`,
          });
        }
        for (const obj of scene.objects ?? []) {
          if (obj.assetId === projectAssetId) {
            dependencies.push({
              id: `scene-obj-${scene.id}-${obj.id}`,
              category: "scene",
              label: `Scene Object “${obj.name}”`,
              detail: `Placed on scene “${scene.name}” (${obj.id})`,
            });
          }
        }
      }

      if (blueprint?.canvas?.backgroundAssetId === projectAssetId) {
        dependencies.push({
          id: `canvas-bg`,
          category: "canvas",
          label: "Canvas Background",
          detail: "Bound as the active canvas background asset",
        });
      }

      if (doc.referenceAssetId === projectAssetId) {
        dependencies.push({
          id: `style-ref`,
          category: "style",
          label: "Project Style Reference",
          detail: "Used as the project style reference image",
        });
      }
    }
  }

  return {
    revisionId,
    revisionLabel,
    asset: rev.asset ?? null,
    isCurrentActive,
    dependencies,
    requiresWarning: isCurrentActive || dependencies.length > 0,
  };
}

/**
 * Sets a specific revision from imageHistory as the current artwork.
 * Creates a normal state change on DesignDoc so it is undoable/redoable via useDesignEditor,
 * and preserves all prior image revisions.
 */
export function setRevisionAsCurrent(
  doc: DesignDoc,
  target: ImageHistoryTarget,
  revisionId: string,
  options?: { label?: string; notes?: string },
): DesignDoc {
  const notes = options?.notes ?? options?.label;
  if (target.kind === "symbol") {
    return restoreImageRevision(doc, target.id, revisionId, notes);
  }
  return restoreElementImageRevision(doc, target.id, revisionId, notes);
}

/**
 * Updates the human-readable label and/or notes on an ImageRevision entry.
 */
export function updateImageRevisionLabel(
  doc: DesignDoc,
  target: ImageHistoryTarget,
  revisionId: string,
  patch: { label?: string; notes?: string },
): DesignDoc {
  const holder = resolveTargetHolder(doc, target);
  if (!holder) return doc;

  const updateRev = (r: ImageRevision): ImageRevision => {
    if (r.id !== revisionId) return r;
    const next: ImageRevision = { ...r };
    if (patch.label !== undefined) {
      const cleaned = patch.label.trim().slice(0, 120);
      if (cleaned) next.label = cleaned;
      else delete next.label;
    }
    if (patch.notes !== undefined) {
      next.notes = patch.notes.slice(0, 320);
    }
    return next;
  };

  if (holder.kind === "symbol") {
    return finalizeDoc({
      ...doc,
      symbols: doc.symbols.map((s) =>
        s.id === holder.id
          ? { ...s, imageHistory: (s.imageHistory ?? []).map(updateRev) }
          : s,
      ),
    });
  }

  return finalizeDoc({
    ...doc,
    elements: doc.elements.map((e) =>
      e.id === holder.id
        ? { ...e, imageHistory: (e.imageHistory ?? []).map(updateRev) }
        : e,
    ),
  });
}

/**
 * Deletes an image revision from a symbol or element's imageHistory.
 *
 * Enforces the F12 requirement:
 * "DO NOT actually delete a version if another component still requires it
 *  without showing a dependency warning."
 *
 * When `impact.requiresWarning` is true and `options?.confirmWithDependencies !== true`,
 * the revision is NOT deleted and `blockedByDependencies: true` is returned along with `impact`.
 * When confirmed (or when no dependencies exist), the revision entry is removed from `imageHistory`
 * while `finalizeDoc` keeps any still-referenced AssetRef intact in `doc.assets`.
 */
export function deleteImageRevision(
  doc: DesignDoc,
  target: ImageHistoryTarget,
  revisionId: string,
  options?: {
    confirmWithDependencies?: boolean;
    blueprint?: GameBlueprint | null;
  },
): {
  doc: DesignDoc;
  deleted: boolean;
  blockedByDependencies: boolean;
  impact: RevisionDeletionImpact;
} {
  const impact = checkRevisionDeletionImpact(doc, target, revisionId, options?.blueprint);
  const holder = resolveTargetHolder(doc, target);

  if (!holder || !holder.history.some((r) => r.id === revisionId)) {
    return {
      doc,
      deleted: false,
      blockedByDependencies: false,
      impact,
    };
  }

  if (impact.requiresWarning && options?.confirmWithDependencies !== true) {
    return {
      doc,
      deleted: false,
      blockedByDependencies: true,
      impact,
    };
  }

  // Protect the underlying asset if any other component still requires it
  const assetIdToProtect =
    impact.dependencies.length > 0 && impact.asset?.provider === "project"
      ? (impact.asset.assetId ?? null)
      : null;

  const nextProtected =
    assetIdToProtect && !(doc.protectedAssetIds ?? []).includes(assetIdToProtect)
      ? [...(doc.protectedAssetIds ?? []), assetIdToProtect]
      : doc.protectedAssetIds;

  if (holder.kind === "symbol") {
    const nextDoc = finalizeDoc({
      ...doc,
      protectedAssetIds: nextProtected,
      symbols: doc.symbols.map((s) =>
        s.id === holder.id
          ? {
              ...s,
              imageHistory: (s.imageHistory ?? []).filter((r) => r.id !== revisionId),
            }
          : s,
      ),
    });
    return {
      doc: nextDoc,
      deleted: true,
      blockedByDependencies: false,
      impact,
    };
  }

  const nextDoc = finalizeDoc({
    ...doc,
    protectedAssetIds: nextProtected,
    elements: doc.elements.map((e) =>
      e.id === holder.id
        ? {
            ...e,
            imageHistory: (e.imageHistory ?? []).filter((r) => r.id !== revisionId),
          }
        : e,
    ),
  });

  return {
    doc: nextDoc,
    deleted: true,
    blockedByDependencies: false,
    impact,
  };
}
