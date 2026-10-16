import type {
  ElementDef,
  GameBlueprint,
  LayerDef,
  SceneDef,
} from "@/lib/blueprint/types";
import type { DesignDoc } from "./types";

export interface UsageEntry {
  id: string;
  label: string;
  detail: string;
}

export interface ElementUsageReport {
  elementId: string;
  elementName: string;
  symbolSets: UsageEntry[];
  scenes: UsageEntry[];
  layers: UsageEntry[];
  reels: UsageEntry[];
  paytable: UsageEntry[];
  animations: UsageEntry[];
  totalCount: number;
}

const ELEMENT_DEFAULT_LAYER_KIND: Partial<Record<ElementDef["type"], LayerDef["kind"]>> = {
  game_background: "background",
  reel_frame: "frame",
  symbol_set: "reels",
  symbol: "reels",
  game_title: "ui",
  button_set: "ui",
  uploaded: "overlay",
  custom: "custom",
  other_asset: "overlay",
};

/**
 * Computes where an element (and its owned symbols/assets) is used across:
 * 1. Symbol Sets
 * 2. Scenes
 * 3. Layers
 * 4. Reels
 * 5. Paytable
 * 6. Animations
 */
export function computeElementUsage(
  doc: DesignDoc,
  blueprint: GameBlueprint | null | undefined,
  elementId: string,
): ElementUsageReport {
  const element = doc.elements.find((e) => e.id === elementId);
  if (!element) {
    return {
      elementId,
      elementName: "Unknown Element",
      symbolSets: [],
      scenes: [],
      layers: [],
      reels: [],
      paytable: [],
      animations: [],
      totalCount: 0,
    };
  }

  const symbolById = new Map(doc.symbols.map((s) => [s.id, s]));
  const ownedSymbolIds = new Set(element.symbolIds);
  const activeAssetId =
    element.type === "symbol"
      ? (symbolById.get(element.symbolIds[0] ?? "")?.assetId ?? null)
      : (element.assetId ?? (element.image?.provider === "project" ? element.image.assetId ?? null : null));

  // 1. Symbol Sets
  const symbolSets: UsageEntry[] = [];
  if (element.type === "symbol_set") {
    symbolSets.push({
      id: element.id,
      label: element.name,
      detail: `Primary Symbol Set container (${element.symbolIds.length} member symbol${element.symbolIds.length === 1 ? "" : "s"})`,
    });
  } else {
    for (const setEl of doc.elements) {
      if (setEl.type !== "symbol_set") continue;
      const sharedSymbols = setEl.symbolIds.filter((sid) => ownedSymbolIds.has(sid));
      const frameMatch =
        activeAssetId &&
        setEl.symbolSet?.frame?.provider === "project" &&
        setEl.symbolSet.frame.assetId === activeAssetId;
      const bgMatch =
        activeAssetId &&
        setEl.symbolSet?.background?.provider === "project" &&
        setEl.symbolSet.background.assetId === activeAssetId;

      if (sharedSymbols.length > 0) {
        symbolSets.push({
          id: setEl.id,
          label: setEl.name,
          detail: `Contains symbol${sharedSymbols.length > 1 ? "s" : ""}: ${sharedSymbols.map((id) => symbolById.get(id)?.name ?? id).join(", ")}`,
        });
      } else if (frameMatch || bgMatch) {
        symbolSets.push({
          id: setEl.id,
          label: setEl.name,
          detail: frameMatch && bgMatch ? "Used as Set Frame & Set Background" : frameMatch ? "Used as Set Frame" : "Used as Set Background",
        });
      }
    }
  }

  // 2. Scenes & 3. Layers
  const scenesList: SceneDef[] = doc.scenes ?? blueprint?.scenes ?? [];
  const layersList: LayerDef[] = doc.layers ?? blueprint?.layers ?? [];
  const layerById = new Map(layersList.map((l) => [l.id, l]));

  const scenes: UsageEntry[] = [];
  const referencedLayerIds = new Map<string, string[]>();

  for (const scene of scenesList) {
    const reasons: string[] = [];
    for (const obj of scene.objects ?? []) {
      const matchesElement = obj.kind === "element" && obj.refId === element.id;
      const matchesSymbol = obj.kind === "symbol" && obj.refId !== null && ownedSymbolIds.has(obj.refId);
      const matchesAsset = Boolean(activeAssetId && obj.assetId === activeAssetId);
      if (matchesElement || matchesSymbol || matchesAsset) {
        reasons.push(`Object “${obj.name}” (${obj.kind})`);
        if (obj.layerId) {
          const prev = referencedLayerIds.get(obj.layerId) ?? [];
          prev.push(`Scene “${scene.name}” → ${obj.name}`);
          referencedLayerIds.set(obj.layerId, prev);
        }
      }
    }
    if (activeAssetId && scene.background?.assetId === activeAssetId) {
      reasons.push("Scene background artwork");
    }
    if (element.type === "game_background" && reasons.length === 0 && scene.kind === "base") {
      reasons.push("Canvas / Base Scene background slot");
    }
    if (reasons.length > 0) {
      scenes.push({
        id: scene.id,
        label: `${scene.name} (${scene.kind})`,
        detail: reasons.join(" · "),
      });
    }
  }

  const layers: UsageEntry[] = [];
  for (const [layerId, placements] of referencedLayerIds.entries()) {
    const layer = layerById.get(layerId);
    layers.push({
      id: layerId,
      label: layer ? `${layer.name} (${layer.kind})` : layerId,
      detail: `${placements.length} placement${placements.length === 1 ? "" : "s"}: ${placements.slice(0, 3).join(", ")}`,
    });
  }

  // Also include the default semantic target layer for this element category if not already listed
  const defaultLayerKind = ELEMENT_DEFAULT_LAYER_KIND[element.type];
  if (defaultLayerKind) {
    const matchingLayers = layersList.filter((l) => l.kind === defaultLayerKind && !referencedLayerIds.has(l.id));
    for (const layer of matchingLayers) {
      layers.push({
        id: layer.id,
        label: `${layer.name} (${layer.kind})`,
        detail: `Target ${layer.kind} composition layer (order #${layer.order})`,
      });
    }
  }

  // 4. Reels
  const reels: UsageEntry[] = [];
  if (ownedSymbolIds.size > 0) {
    doc.strips.forEach((strip, reelIdx) => {
      const matches = strip.filter((sid) => ownedSymbolIds.has(sid));
      if (matches.length > 0) {
        reels.push({
          id: `reel-${reelIdx + 1}`,
          label: `Reel ${reelIdx + 1}`,
          detail: `${matches.length} stop position${matches.length === 1 ? "" : "s"} on strip (${strip.length} total stops)`,
        });
      }
    });
  }

  // 5. Paytable
  const paytable: UsageEntry[] = [];
  if (ownedSymbolIds.size > 0) {
    const bySymbol = new Map<string, { ofAKind: number; payout: number }[]>();
    for (const row of doc.paytable) {
      if (!ownedSymbolIds.has(row.symbolId)) continue;
      const list = bySymbol.get(row.symbolId) ?? [];
      list.push({ ofAKind: row.ofAKind, payout: row.payout });
      bySymbol.set(row.symbolId, list);
    }
    for (const [sid, rows] of bySymbol.entries()) {
      const sym = symbolById.get(sid);
      const sorted = [...rows].sort((a, b) => a.ofAKind - b.ofAKind);
      paytable.push({
        id: `paytable-${sid}`,
        label: sym ? `${sym.name} (${sym.code})` : sid,
        detail: sorted.map((r) => `${r.ofAKind}× = ${r.payout}`).join(" · "),
      });
    }
  }

  // 6. Animations
  const animations: UsageEntry[] = [];
  if (element.animation && element.animation.preset !== "none") {
    animations.push({
      id: `${element.id}-anim-config`,
      label: `Element preset: ${element.animation.preset}`,
      detail: `Trigger: ${element.animation.trigger} · ${element.animation.durationMs}ms · ${element.animation.easing}${element.animation.loop ? " · loop" : ""}`,
    });
  }
  const allCues = doc.animations ?? blueprint?.animations ?? [];
  for (const cue of allCues) {
    const matchesTarget =
      cue.target === element.id ||
      ownedSymbolIds.has(cue.target) ||
      (defaultLayerKind !== undefined &&
        layersList.some((l) => l.id === cue.target && l.kind === defaultLayerKind && (element.type === "reel_frame" || element.type === "game_background")));
    if (matchesTarget) {
      animations.push({
        id: cue.id,
        label: `${cue.kind} (${cue.trigger})`,
        detail: `Target: ${cue.target} · ${cue.durationMs}ms · ${cue.easing}`,
      });
    }
  }

  const totalCount =
    symbolSets.length +
    scenes.length +
    layers.length +
    reels.length +
    paytable.length +
    animations.length;

  return {
    elementId: element.id,
    elementName: element.name,
    symbolSets,
    scenes,
    layers,
    reels,
    paytable,
    animations,
    totalCount,
  };
}
