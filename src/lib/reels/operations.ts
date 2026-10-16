/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F14 — Reel Configuration Pure Operations & Validation Engine.
 *
 * Strictly declarative configuration operations and structural validation.
 * Does NOT calculate RNG outcomes, spin results, or RTP simulations.
 */

import { generatePaylines } from "@/lib/blueprint/factory";
import type { AssetRef, GameBlueprint, SymbolDef } from "@/lib/blueprint/types";
import {
  MAX_REEL_COUNT,
  MIN_REEL_COUNT,
  type ReelConfigurationData,
  type ReelStopConfig,
  type ReelStripDef,
  type ReelTextParseResult,
  type ReelValidationIssue,
  type ReelValidationReport,
  type SymbolPaletteFilter,
  type SymbolPaletteItem,
} from "./types";

let stopCounter = 1;

/** Generates a unique stop ID not present in `taken`. */
export function createUniqueStopId(
  reelIndex: number,
  stopIndex: number,
  taken: Set<string>,
): string {
  const base = `stop_r${reelIndex + 1}_s${stopIndex + 1}`;
  if (!taken.has(base)) {
    taken.add(base);
    return base;
  }
  while (true) {
    const candidate = `${base}_${stopCounter++}`;
    if (!taken.has(candidate)) {
      taken.add(candidate);
      return candidate;
    }
  }
}

/** Collects all stop IDs currently present in a reel configuration. */
export function collectStopIds(reels: ReelStripDef[]): Set<string> {
  const ids = new Set<string>();
  for (const reel of reels) {
    for (const stop of reel.stops) {
      if (stop.id) ids.add(stop.id);
    }
  }
  return ids;
}

/** Re-indexes stop `position` values (1..N) for a single reel and syncs `strips`. */
function normalizeReelStops(stops: ReelStopConfig[]): ReelStopConfig[] {
  return stops.map((stop, idx) => ({
    ...stop,
    position: idx + 1,
  }));
}

/** Synchronizes reel indices, names ("Reel 1", "Reel 2", ...), stop positions, and `strips`. */
export function syncReelConfiguration(
  config: ReelConfigurationData,
  options?: { preservePositions?: boolean; preserveColumns?: boolean },
): ReelConfigurationData {
  const reels: ReelStripDef[] = config.reels.map((reel, reelIdx) => ({
    ...reel,
    id: `reel-${reelIdx + 1}`,
    index: reelIdx,
    name: `Reel ${reelIdx + 1}`,
    stops: options?.preservePositions
      ? reel.stops.map((s) => ({ ...s }))
      : normalizeReelStops(reel.stops),
  }));
  const strips = reels.map((reel) => reel.stops.map((stop) => stop.symbolId));
  return {
    ...config,
    columns: options?.preserveColumns ? config.columns : reels.length,
    reels,
    strips,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Extracts or constructs a `ReelConfigurationData` from a `GameBlueprint`.
 */
export function reelConfigurationFromBlueprint(
  bp: GameBlueprint,
): ReelConfigurationData {
  const symbolWeightMap = new Map<string, number>();
  for (const sym of bp.symbols ?? []) {
    symbolWeightMap.set(
      sym.id,
      Number.isFinite(sym.reelWeight) && sym.reelWeight > 0 ? sym.reelWeight : 1,
    );
  }

  const existing = bp.reelConfiguration;
  if (
    existing &&
    Array.isArray(existing.reels) &&
    existing.reels.length > 0
  ) {
    return {
      columns: existing.columns ?? existing.reels.length,
      rows: existing.rows ?? bp.reels.rows ?? 3,
      evaluation: existing.evaluation ?? bp.reels.evaluation ?? "lines",
      spinDirection: existing.spinDirection ?? bp.reels.spinDirection ?? "down",
      weightsEnabled: Boolean(existing.weightsEnabled),
      reels: existing.reels.map((r, rIdx) => ({
        id: r.id || `reel-${rIdx + 1}`,
        index: typeof r.index === "number" ? r.index : rIdx,
        name: r.name || `Reel ${rIdx + 1}`,
        stops: (r.stops ?? []).map((s, sIdx) => ({
          id: s.id || `stop_r${rIdx + 1}_s${sIdx + 1}`,
          position: typeof s.position === "number" ? s.position : sIdx + 1,
          symbolId: s.symbolId,
          weight:
            s.weight !== undefined
              ? s.weight
              : symbolWeightMap.get(s.symbolId) ?? 1,
        })),
      })),
      strips: Array.isArray(existing.strips)
        ? existing.strips.map((s) => [...s])
        : existing.reels.map((r) => (r.stops ?? []).map((s) => s.symbolId)),
      updatedAt: existing.updatedAt ?? bp.meta?.updatedAt,
    };
  }

  // Fallback to `bp.reels.reels` if present, otherwise build from `bp.reels.strips`
  const taken = new Set<string>();
  const rawStrips =
    Array.isArray(bp.reels?.strips) && bp.reels.strips.length > 0
      ? bp.reels.strips
      : Array.from({ length: bp.reels?.columns ?? 5 }, () => [] as string[]);

  const reels: ReelStripDef[] = rawStrips.map((strip, rIdx) => {
    const existingReel = bp.reels?.reels?.[rIdx];
    const stops: ReelStopConfig[] = strip.map((symbolId, sIdx) => {
      const existingStop = existingReel?.stops?.[sIdx];
      const id =
        existingStop?.id && !taken.has(existingStop.id)
          ? (taken.add(existingStop.id), existingStop.id)
          : createUniqueStopId(rIdx, sIdx, taken);
      return {
        id,
        position: sIdx + 1,
        symbolId,
        weight:
          existingStop?.weight !== undefined
            ? existingStop.weight
            : symbolWeightMap.get(symbolId) ?? 1,
      };
    });
    return {
      id: `reel-${rIdx + 1}`,
      index: rIdx,
      name: `Reel ${rIdx + 1}`,
      stops,
    };
  });

  return {
    columns: bp.reels?.columns ?? reels.length,
    rows: bp.reels?.rows ?? 3,
    evaluation: bp.reels?.evaluation ?? "lines",
    spinDirection: bp.reels?.spinDirection ?? "down",
    strips: reels.map((r) => r.stops.map((s) => s.symbolId)),
    weightsEnabled: Boolean(bp.reels?.weightsEnabled),
    reels,
    updatedAt: bp.meta?.updatedAt,
  };
}

/**
 * Saves `ReelConfigurationData` into `GameBlueprint.reelConfiguration` and
 * synchronizes `GameBlueprint.reels` (and paylines when column count changes).
 */
export function applyReelConfigurationToBlueprint(
  bp: GameBlueprint,
  config: ReelConfigurationData,
): GameBlueprint {
  const synced = syncReelConfiguration(config);
  const now = new Date().toISOString();

  // Keep payline pattern lengths synchronized with `synced.columns` when in lines mode
  let nextPaylines = bp.paylines ?? [];
  if (synced.evaluation === "lines") {
    const needsResize = nextPaylines.some(
      (line) => line.pattern.length !== synced.columns,
    );
    if (
      needsResize &&
      synced.columns >= MIN_REEL_COUNT &&
      synced.columns <= MAX_REEL_COUNT
    ) {
      const count = Math.max(1, nextPaylines.length || 20);
      nextPaylines = generatePaylines(synced.columns, synced.rows, count);
    }
  } else {
    nextPaylines = [];
  }

  const nextReelConfiguration: ReelConfigurationData = {
    ...synced,
    updatedAt: now,
  };

  return {
    ...bp,
    meta: {
      ...bp.meta,
      updatedAt: now,
    },
    reels: {
      ...bp.reels,
      columns: synced.columns,
      rows: synced.rows,
      evaluation: synced.evaluation,
      spinDirection: synced.spinDirection,
      strips: synced.strips.map((s) => [...s]),
      weightsEnabled: synced.weightsEnabled,
      reels: synced.reels.map((r) => ({
        ...r,
        stops: r.stops.map((st) => ({ ...st })),
      })),
    },
    reelConfiguration: nextReelConfiguration,
    paylines: nextPaylines,
  };
}

/* -------------------------------------------------------------------------- */
/* SYMBOL PALETTE & SEARCH                                                    */
/* -------------------------------------------------------------------------- */

function resolveSymbolArtwork(
  symbol: SymbolDef,
  assetById: Map<string, AssetRef>,
): { artworkUri: string | null; artworkName: string; hasArtwork: boolean } {
  if (symbol.image?.provider === "external" && symbol.image.uri) {
    return {
      artworkUri: symbol.image.uri,
      artworkName: symbol.image.name || symbol.name,
      hasArtwork: true,
    };
  }
  const projectAssetId =
    symbol.image?.provider === "project"
      ? symbol.image.assetId ?? symbol.assetId
      : symbol.assetId;
  if (projectAssetId) {
    const asset = assetById.get(projectAssetId);
    if (asset && asset.state === "linked" && asset.uri) {
      return {
        artworkUri: asset.uri,
        artworkName: asset.name || symbol.image?.name || projectAssetId,
        hasArtwork: true,
      };
    }
    if (asset) {
      return {
        artworkUri: null,
        artworkName: asset.name || projectAssetId,
        hasArtwork: false,
      };
    }
  }
  return {
    artworkUri: null,
    artworkName: symbol.image?.name || "placeholder",
    hasArtwork: false,
  };
}

/** Builds the list of symbol palette items with thumbnail & artwork metadata. */
export function buildSymbolPalette(bp: GameBlueprint): SymbolPaletteItem[] {
  const assetById = new Map<string, AssetRef>(
    (bp.assets ?? []).map((a) => [a.id, a]),
  );
  const specialBySymbolId = new Map<string, Set<string>>();
  for (const sp of bp.specialSymbols ?? []) {
    const set = specialBySymbolId.get(sp.symbolId) ?? new Set<string>();
    set.add(sp.behaviour);
    specialBySymbolId.set(sp.symbolId, set);
  }
  return (bp.symbols ?? []).map((sym) => {
    const art = resolveSymbolArtwork(sym, assetById);
    const behaviours = specialBySymbolId.get(sym.id);
    const isWild =
      sym.isWild !== undefined
        ? Boolean(sym.isWild)
        : Boolean(behaviours?.has("wild") || sym.id === "sym-wild");
    const isScatter =
      sym.isScatter !== undefined
        ? Boolean(sym.isScatter)
        : Boolean(behaviours?.has("scatter") || sym.id === "sym-scatter");
    const isBonus =
      sym.isBonus !== undefined
        ? Boolean(sym.isBonus)
        : Boolean(behaviours?.has("bonus") || sym.id === "sym-bonus");
    return {
      id: sym.id,
      code: sym.code,
      name: sym.name,
      tier: sym.tier,
      glyph: sym.glyph || sym.code.slice(0, 2),
      assetId: sym.assetId,
      artworkUri: art.artworkUri,
      artworkName: art.artworkName,
      hasArtwork: art.hasArtwork,
      reelWeight:
        Number.isFinite(sym.reelWeight) && sym.reelWeight > 0
          ? sym.reelWeight
          : 1,
      symbolSetId: sym.symbolSetId ?? null,
      symbolType: sym.symbolType ?? "custom",
      tags: sym.tags ?? [],
      isWild,
      isScatter,
      isBonus,
    };
  });
}

/**
 * Filters the Symbol Palette by:
 * - symbol ID (`id` or `code`)
 * - name (`name`)
 * - artwork (`assetId`, `artworkName`, `artworkUri`, or `"linked"` / `"placeholder"` / `"artwork"`)
 * Plus optional tier and artwork state filters.
 */
export function filterSymbolPalette(
  items: SymbolPaletteItem[],
  query = "",
  filter?: Omit<SymbolPaletteFilter, "query">,
): SymbolPaletteItem[] {
  const q = query.trim().toLowerCase();
  return items.filter((item) => {
    if (filter?.tier && filter.tier !== "all" && item.tier !== filter.tier) {
      return false;
    }
    if (filter?.artwork === "linked" && !item.hasArtwork) {
      return false;
    }
    if (filter?.artwork === "placeholder" && item.hasArtwork) {
      return false;
    }
    if (!q) return true;

    const artworkStateLabel = item.hasArtwork
      ? "linked imported artwork image"
      : "placeholder no artwork";
    const haystack = [
      item.id,
      item.code,
      item.name,
      item.assetId ?? "",
      item.artworkName,
      item.artworkUri ?? "",
      artworkStateLabel,
      ...item.tags,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });
}

/* -------------------------------------------------------------------------- */
/* STOP OPERATIONS                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Appends a stop to the selected reel strip.
 * Selecting a symbol appends a stop; selecting it again adds another stop with
 * a distinct stop ID and incremented position.
 */
export function appendStopToReel(
  config: ReelConfigurationData,
  reelIndex: number,
  symbolId: string,
  defaultWeight = 1,
): ReelConfigurationData {
  if (reelIndex < 0 || reelIndex >= config.reels.length) return config;
  const taken = collectStopIds(config.reels);
  const targetReel = config.reels[reelIndex];
  const nextStopIndex = targetReel.stops.length;
  const newStop: ReelStopConfig = {
    id: createUniqueStopId(reelIndex, nextStopIndex, taken),
    position: nextStopIndex + 1,
    symbolId,
    weight:
      Number.isFinite(defaultWeight) && defaultWeight > 0 ? defaultWeight : 1,
  };

  const nextReels = config.reels.map((reel, idx) =>
    idx === reelIndex
      ? { ...reel, stops: normalizeReelStops([...reel.stops, newStop]) }
      : reel,
  );
  return syncReelConfiguration({ ...config, reels: nextReels });
}

/** Inserts a stop at a specific 0-based index on a reel strip. */
export function insertStopInReel(
  config: ReelConfigurationData,
  reelIndex: number,
  atStopIndex: number,
  symbolId: string,
  weight = 1,
): ReelConfigurationData {
  if (reelIndex < 0 || reelIndex >= config.reels.length) return config;
  const taken = collectStopIds(config.reels);
  const targetReel = config.reels[reelIndex];
  const clampedIndex = Math.max(
    0,
    Math.min(targetReel.stops.length, atStopIndex),
  );
  const newStop: ReelStopConfig = {
    id: createUniqueStopId(reelIndex, clampedIndex, taken),
    position: clampedIndex + 1,
    symbolId,
    weight,
  };
  const copy = [...targetReel.stops];
  copy.splice(clampedIndex, 0, newStop);

  const nextReels = config.reels.map((reel, idx) =>
    idx === reelIndex ? { ...reel, stops: normalizeReelStops(copy) } : reel,
  );
  return syncReelConfiguration({ ...config, reels: nextReels });
}

/** Duplicates a stop in-place right after `stopIndex` with a fresh stop ID. */
export function duplicateStopInReel(
  config: ReelConfigurationData,
  reelIndex: number,
  stopIndex: number,
): ReelConfigurationData {
  const reel = config.reels[reelIndex];
  if (!reel) return config;
  const source = reel.stops[stopIndex];
  if (!source) return config;

  const taken = collectStopIds(config.reels);
  const duplicate: ReelStopConfig = {
    id: createUniqueStopId(reelIndex, stopIndex + 1, taken),
    position: stopIndex + 2,
    symbolId: source.symbolId,
    weight: source.weight ?? 1,
  };

  const nextStops = [...reel.stops];
  nextStops.splice(stopIndex + 1, 0, duplicate);

  const nextReels = config.reels.map((r, idx) =>
    idx === reelIndex ? { ...r, stops: normalizeReelStops(nextStops) } : r,
  );
  return syncReelConfiguration({ ...config, reels: nextReels });
}

/** Removes the stop at `stopIndex` from `reels[reelIndex]`. */
export function removeStopFromReel(
  config: ReelConfigurationData,
  reelIndex: number,
  stopIndex: number,
): ReelConfigurationData {
  const reel = config.reels[reelIndex];
  if (!reel || stopIndex < 0 || stopIndex >= reel.stops.length) return config;

  const nextStops = reel.stops.filter((_, idx) => idx !== stopIndex);
  const nextReels = config.reels.map((r, idx) =>
    idx === reelIndex ? { ...r, stops: normalizeReelStops(nextStops) } : r,
  );
  return syncReelConfiguration({ ...config, reels: nextReels });
}

/** Updates the weight of a specific stop (stores raw number so validation can flag invalid values). */
export function updateStopWeight(
  config: ReelConfigurationData,
  reelIndex: number,
  stopIndex: number,
  weight: number,
): ReelConfigurationData {
  const reel = config.reels[reelIndex];
  if (!reel || stopIndex < 0 || stopIndex >= reel.stops.length) return config;

  const nextReels = config.reels.map((r, rIdx) =>
    rIdx === reelIndex
      ? {
          ...r,
          stops: r.stops.map((s, sIdx) =>
            sIdx === stopIndex ? { ...s, weight } : s,
          ),
        }
      : r,
  );
  return syncReelConfiguration({ ...config, reels: nextReels });
}

/** Toggles per-stop weights on or off. */
export function setWeightsEnabled(
  config: ReelConfigurationData,
  enabled: boolean,
  defaultSymbolWeights?: Map<string, number>,
): ReelConfigurationData {
  const nextReels = config.reels.map((reel) => ({
    ...reel,
    stops: reel.stops.map((stop) => ({
      ...stop,
      weight:
        stop.weight !== undefined
          ? stop.weight
          : defaultSymbolWeights?.get(stop.symbolId) ?? 1,
    })),
  }));
  return syncReelConfiguration({
    ...config,
    weightsEnabled: enabled,
    reels: nextReels,
  });
}

/* -------------------------------------------------------------------------- */
/* DRAG: REORDER WITHIN REEL & MOVE STOP TO ANOTHER REEL                      */
/* -------------------------------------------------------------------------- */

/** Reorders a stop within the same reel from `fromStopIndex` to `toStopIndex`. */
export function reorderStopInReel(
  config: ReelConfigurationData,
  reelIndex: number,
  fromStopIndex: number,
  toStopIndex: number,
): ReelConfigurationData {
  const reel = config.reels[reelIndex];
  if (!reel) return config;
  if (
    fromStopIndex < 0 ||
    fromStopIndex >= reel.stops.length ||
    toStopIndex < 0 ||
    toStopIndex >= reel.stops.length ||
    fromStopIndex === toStopIndex
  ) {
    return config;
  }

  const nextStops = [...reel.stops];
  const [moved] = nextStops.splice(fromStopIndex, 1);
  nextStops.splice(toStopIndex, 0, moved);

  const nextReels = config.reels.map((r, idx) =>
    idx === reelIndex ? { ...r, stops: normalizeReelStops(nextStops) } : r,
  );
  return syncReelConfiguration({ ...config, reels: nextReels });
}

/** Moves a stop from `fromReelIndex` (`fromStopIndex`) to `toReelIndex` (at `toStopIndex` or appended). */
export function moveStopBetweenReels(
  config: ReelConfigurationData,
  fromReelIndex: number,
  fromStopIndex: number,
  toReelIndex: number,
  toStopIndex?: number,
): ReelConfigurationData {
  if (fromReelIndex === toReelIndex) {
    if (toStopIndex === undefined) return config;
    const clampedTarget = Math.max(
      0,
      Math.min(
        (config.reels[fromReelIndex]?.stops.length ?? 1) - 1,
        toStopIndex,
      ),
    );
    return reorderStopInReel(
      config,
      fromReelIndex,
      fromStopIndex,
      clampedTarget,
    );
  }

  const sourceReel = config.reels[fromReelIndex];
  const targetReel = config.reels[toReelIndex];
  if (!sourceReel || !targetReel) return config;
  if (fromStopIndex < 0 || fromStopIndex >= sourceReel.stops.length) {
    return config;
  }

  const movedStop = sourceReel.stops[fromStopIndex];
  const nextSourceStops = sourceReel.stops.filter(
    (_, idx) => idx !== fromStopIndex,
  );

  const nextTargetStops = [...targetReel.stops];
  const insertAt =
    toStopIndex === undefined
      ? nextTargetStops.length
      : Math.max(0, Math.min(nextTargetStops.length, toStopIndex));
  nextTargetStops.splice(insertAt, 0, { ...movedStop });

  const nextReels = config.reels.map((r, idx) => {
    if (idx === fromReelIndex) {
      return { ...r, stops: normalizeReelStops(nextSourceStops) };
    }
    if (idx === toReelIndex) {
      return { ...r, stops: normalizeReelStops(nextTargetStops) };
    }
    return r;
  });

  return syncReelConfiguration({ ...config, reels: nextReels });
}

/* -------------------------------------------------------------------------- */
/* REEL MANAGEMENT: ADD REEL, REMOVE REEL, DUPLICATE REEL                     */
/* -------------------------------------------------------------------------- */

/** Adds a new reel to the configuration (with optional initial symbol IDs). */
export function addReel(
  config: ReelConfigurationData,
  options?: {
    initialSymbolIds?: string[];
    defaultWeights?: Map<string, number>;
  },
): ReelConfigurationData {
  const taken = collectStopIds(config.reels);
  const newReelIndex = config.reels.length;
  const initialSymbolIds = options?.initialSymbolIds ?? [];
  const stops: ReelStopConfig[] = initialSymbolIds.map((symbolId, sIdx) => ({
    id: createUniqueStopId(newReelIndex, sIdx, taken),
    position: sIdx + 1,
    symbolId,
    weight: options?.defaultWeights?.get(symbolId) ?? 1,
  }));

  const newReel: ReelStripDef = {
    id: `reel-${newReelIndex + 1}`,
    index: newReelIndex,
    name: `Reel ${newReelIndex + 1}`,
    stops,
  };

  return syncReelConfiguration({
    ...config,
    reels: [...config.reels, newReel],
  });
}

/** Removes the reel at `reelIndex` (keeps at least 1 reel in the editor). */
export function removeReel(
  config: ReelConfigurationData,
  reelIndex: number,
): ReelConfigurationData {
  if (config.reels.length <= 1) return config;
  if (reelIndex < 0 || reelIndex >= config.reels.length) return config;

  const nextReels = config.reels.filter((_, idx) => idx !== reelIndex);
  return syncReelConfiguration({
    ...config,
    reels: nextReels,
  });
}

/** Duplicates the reel at `reelIndex` with brand-new unique stop IDs. */
export function duplicateReel(
  config: ReelConfigurationData,
  reelIndex: number,
  insertAfter = true,
): ReelConfigurationData {
  const source = config.reels[reelIndex];
  if (!source) return config;

  const taken = collectStopIds(config.reels);
  const targetReelIndex = insertAfter ? reelIndex + 1 : config.reels.length;
  const clonedStops: ReelStopConfig[] = source.stops.map((stop, sIdx) => ({
    id: createUniqueStopId(targetReelIndex, sIdx, taken),
    position: sIdx + 1,
    symbolId: stop.symbolId,
    weight: stop.weight ?? 1,
  }));

  const duplicate: ReelStripDef = {
    id: `reel-${targetReelIndex + 1}`,
    index: targetReelIndex,
    name: `Reel ${targetReelIndex + 1}`,
    stops: clonedStops,
  };

  const nextReels = [...config.reels];
  if (insertAfter) {
    nextReels.splice(reelIndex + 1, 0, duplicate);
  } else {
    nextReels.push(duplicate);
  }

  return syncReelConfiguration({
    ...config,
    reels: nextReels,
  });
}

/* -------------------------------------------------------------------------- */
/* TEXT VIEW: FORMAT, PARSE & VALIDATE WHITESPACE / COMMA-SEPARATED IDS       */
/* -------------------------------------------------------------------------- */

/** Formats a reel's stops into a text representation (comma, newline, or space separated). */
export function formatReelStopsToText(
  reel: ReelStripDef | undefined,
  mode: "comma" | "newline" | "space" = "comma",
): string {
  if (!reel || reel.stops.length === 0) return "";
  const ids = reel.stops.map((s) => s.symbolId);
  if (mode === "newline") return ids.join("\n");
  if (mode === "space") return ids.join(" ");
  return ids.join(", ");
}

/**
 * Parses whitespace- or comma-separated symbol IDs and validates them against
 * the known symbol IDs in the project.
 */
export function parseReelStopsText(
  text: string,
  knownSymbolIds: Iterable<string>,
): ReelTextParseResult {
  const known = new Set(knownSymbolIds);
  const tokens = text
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const validSymbolIds: string[] = [];
  const unknownSymbolIds: string[] = [];

  for (const token of tokens) {
    if (known.has(token)) {
      validSymbolIds.push(token);
    } else {
      unknownSymbolIds.push(token);
    }
  }

  return {
    tokens,
    validSymbolIds,
    unknownSymbolIds: Array.from(new Set(unknownSymbolIds)),
    isValid: unknownSymbolIds.length === 0,
  };
}

/**
 * Applies a whitespace- or comma-separated text string of symbol IDs to a reel.
 * Preserves existing stop weights where positions/symbolIds match, or falls back
 * to default symbol weights.
 */
export function applyTextStopsToReel(
  config: ReelConfigurationData,
  reelIndex: number,
  text: string,
  options?: { defaultWeights?: Map<string, number> },
): ReelConfigurationData {
  const reel = config.reels[reelIndex];
  if (!reel) return config;

  const tokens = text
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const otherReels = config.reels.filter((_, idx) => idx !== reelIndex);
  const taken = collectStopIds(otherReels);

  const nextStops: ReelStopConfig[] = tokens.map((symbolId, sIdx) => {
    const prevAtPos = reel.stops[sIdx];
    const preservedWeight =
      prevAtPos && prevAtPos.symbolId === symbolId && prevAtPos.weight !== undefined
        ? prevAtPos.weight
        : options?.defaultWeights?.get(symbolId) ?? 1;
    const id =
      prevAtPos?.id && !taken.has(prevAtPos.id)
        ? (taken.add(prevAtPos.id), prevAtPos.id)
        : createUniqueStopId(reelIndex, sIdx, taken);
    return {
      id,
      position: sIdx + 1,
      symbolId,
      weight: preservedWeight,
    };
  });

  const nextReels = config.reels.map((r, idx) =>
    idx === reelIndex ? { ...r, stops: nextStops } : r,
  );

  return syncReelConfiguration({ ...config, reels: nextReels });
}

/* -------------------------------------------------------------------------- */
/* VALIDATION ENGINE (NO RNG OUTCOME CALCULATION)                             */
/* -------------------------------------------------------------------------- */

/**
 * Repairs duplicate stop IDs, non-sequential stop positions, and strip desync.
 */
export function repairStopCorruption(
  config: ReelConfigurationData,
): ReelConfigurationData {
  const taken = new Set<string>();
  const repairedReels: ReelStripDef[] = config.reels.map((reel, rIdx) => ({
    ...reel,
    id: `reel-${rIdx + 1}`,
    index: rIdx,
    name: `Reel ${rIdx + 1}`,
    stops: reel.stops.map((stop, sIdx) => {
      const id =
        stop.id && !taken.has(stop.id)
          ? (taken.add(stop.id), stop.id)
          : createUniqueStopId(rIdx, sIdx, taken);
      return {
        ...stop,
        id,
        position: sIdx + 1,
      };
    }),
  }));

  return syncReelConfiguration({
    ...config,
    columns: repairedReels.length,
    reels: repairedReels,
  });
}

/**
 * Validates a `ReelConfigurationData` against project symbols.
 * Detects:
 * 1. unknown symbol IDs (`unknown_symbol_id`)
 * 2. empty reel (`empty_reel`)
 * 3. invalid weights (`invalid_weight`)
 * 4. duplicate stop corruption (`duplicate_stop_corruption`)
 * 5. invalid reel count (`invalid_reel_count`)
 *
 * Strictly structural validation — does NOT calculate RNG outcomes.
 */
export function validateReelConfiguration(
  config: ReelConfigurationData,
  symbols: Array<Pick<SymbolDef, "id">> | Iterable<string>,
): ReelValidationReport {
  const knownSymbolIds = new Set<string>();
  for (const item of symbols) {
    if (typeof item === "string") {
      knownSymbolIds.add(item);
    } else if (item && typeof item.id === "string") {
      knownSymbolIds.add(item.id);
    }
  }

  const issues: ReelValidationIssue[] = [];
  const unknownSymbolSet = new Set<string>();
  const emptyReelIndices: number[] = [];
  const invalidWeightStops: ReelValidationReport["invalidWeightStops"] = [];
  const duplicateStopIdSet = new Set<string>();
  const corruptedPositionStops: ReelValidationReport["corruptedPositionStops"] = [];
  const seenStopIds = new Set<string>();
  const usedSymbolIds = new Set<string>();

  let totalStops = 0;

  // 1. Check reel count (3..8 reels and alignment with `columns` and `strips`)
  const reelCount = config.reels.length;
  const countOutOfRange =
    !Number.isInteger(reelCount) ||
    reelCount < MIN_REEL_COUNT ||
    reelCount > MAX_REEL_COUNT;
  const columnsMismatch = config.columns !== reelCount;
  const stripsCountMismatch =
    !Array.isArray(config.strips) || config.strips.length !== reelCount;
  const invalidReelCount =
    countOutOfRange || columnsMismatch || stripsCountMismatch;

  if (countOutOfRange) {
    issues.push({
      id: "issue_invalid_reel_count_range",
      kind: "invalid_reel_count",
      severity: "error",
      message: `Invalid reel count (${reelCount}). Supported grid configuration requires ${MIN_REEL_COUNT}–${MAX_REEL_COUNT} reels.`,
    });
  }
  if (columnsMismatch) {
    issues.push({
      id: "issue_invalid_reel_count_columns_mismatch",
      kind: "invalid_reel_count",
      severity: "error",
      message: `Reel count mismatch: configuration declares columns=${config.columns} but contains ${reelCount} reel strips.`,
    });
  }
  if (stripsCountMismatch) {
    issues.push({
      id: "issue_invalid_reel_count_strips_mismatch",
      kind: "invalid_reel_count",
      severity: "error",
      message: `Reel strip array count (${config.strips?.length ?? 0}) does not match reel definitions (${reelCount}).`,
    });
  }

  // Per-reel checks
  config.reels.forEach((reel, reelIndex) => {
    const stops = reel.stops ?? [];
    totalStops += stops.length;

    // 2. Empty reel check
    if (stops.length === 0) {
      emptyReelIndices.push(reelIndex);
      issues.push({
        id: `issue_empty_reel_${reelIndex + 1}`,
        kind: "empty_reel",
        severity: "error",
        reelIndex,
        reelId: reel.id,
        message: `${reel.name || `Reel ${reelIndex + 1}`} is empty. Add at least one symbol stop.`,
      });
    }

    // Check strip synchronization corruption on this reel
    const stripForReel = config.strips?.[reelIndex];
    if (
      Array.isArray(stripForReel) &&
      (stripForReel.length !== stops.length ||
        stops.some((st, idx) => stripForReel[idx] !== st.symbolId))
    ) {
      issues.push({
        id: `issue_strip_sync_corruption_${reelIndex + 1}`,
        kind: "duplicate_stop_corruption",
        severity: "error",
        reelIndex,
        reelId: reel.id,
        message: `${reel.name || `Reel ${reelIndex + 1}`} strip array is out of sync with its stop list.`,
      });
    }

    stops.forEach((stop, stopIndex) => {
      // 3. Unknown symbol ID check
      if (!stop.symbolId || !knownSymbolIds.has(stop.symbolId)) {
        const badId = stop.symbolId || "(empty)";
        unknownSymbolSet.add(badId);
        issues.push({
          id: `issue_unknown_symbol_${reelIndex + 1}_${stopIndex + 1}`,
          kind: "unknown_symbol_id",
          severity: "error",
          reelIndex,
          reelId: reel.id,
          stopIndex,
          stopId: stop.id,
          symbolId: badId,
          message: `${reel.name || `Reel ${reelIndex + 1}`} stop #${stopIndex + 1} references unknown symbol ID "${badId}".`,
        });
      } else {
        usedSymbolIds.add(stop.symbolId);
      }

      // 4. Duplicate stop ID or corrupted stop position check
      if (!stop.id || typeof stop.id !== "string" || !stop.id.trim()) {
        duplicateStopIdSet.add("(missing-id)");
        issues.push({
          id: `issue_missing_stop_id_${reelIndex + 1}_${stopIndex + 1}`,
          kind: "duplicate_stop_corruption",
          severity: "error",
          reelIndex,
          reelId: reel.id,
          stopIndex,
          message: `${reel.name || `Reel ${reelIndex + 1}`} stop #${stopIndex + 1} is missing a stop ID.`,
        });
      } else if (seenStopIds.has(stop.id)) {
        duplicateStopIdSet.add(stop.id);
        issues.push({
          id: `issue_duplicate_stop_id_${reelIndex + 1}_${stopIndex + 1}_${stop.id}`,
          kind: "duplicate_stop_corruption",
          severity: "error",
          reelIndex,
          reelId: reel.id,
          stopIndex,
          stopId: stop.id,
          message: `Duplicate stop ID corruption detected: "${stop.id}" appears multiple times (${reel.name || `Reel ${reelIndex + 1}`} stop #${stopIndex + 1}).`,
        });
      } else {
        seenStopIds.add(stop.id);
      }

      const expectedPosition = stopIndex + 1;
      if (stop.position !== expectedPosition) {
        corruptedPositionStops.push({
          reelIndex,
          stopIndex,
          expectedPosition,
          actualPosition: stop.position,
        });
        issues.push({
          id: `issue_corrupted_position_${reelIndex + 1}_${stopIndex + 1}`,
          kind: "duplicate_stop_corruption",
          severity: "error",
          reelIndex,
          reelId: reel.id,
          stopIndex,
          stopId: stop.id,
          message: `Stop position corruption on ${reel.name || `Reel ${reelIndex + 1}`} stop #${stopIndex + 1}: expected position ${expectedPosition} but found ${String(stop.position)}.`,
        });
      }

      // 5. Invalid weights check (always checked when weightsEnabled is true, or if an explicit invalid weight was assigned)
      const hasExplicitWeight = stop.weight !== undefined;
      if (config.weightsEnabled || hasExplicitWeight) {
        const w = stop.weight;
        const validWeight =
          typeof w === "number" && Number.isFinite(w) && w > 0;
        if (!validWeight) {
          invalidWeightStops.push({
            reelIndex,
            stopIndex,
            stopId: stop.id,
            weight: w,
          });
          issues.push({
            id: `issue_invalid_weight_${reelIndex + 1}_${stopIndex + 1}`,
            kind: "invalid_weight",
            severity: "error",
            reelIndex,
            reelId: reel.id,
            stopIndex,
            stopId: stop.id,
            symbolId: stop.symbolId,
            message: `${reel.name || `Reel ${reelIndex + 1}`} stop #${stopIndex + 1} (${stop.symbolId}) has an invalid weight (${String(w)}). Weight must be a positive number.`,
          });
        }
      }
    });
  });

  return {
    valid: issues.length === 0,
    issues,
    unknownSymbolIds: Array.from(unknownSymbolSet),
    emptyReelIndices,
    invalidWeightStops,
    duplicateStopIds: Array.from(duplicateStopIdSet),
    corruptedPositionStops,
    invalidReelCount,
    summary: {
      totalReels: reelCount,
      totalStops,
      uniqueSymbolsUsed: usedSymbolIds.size,
    },
  };
}
