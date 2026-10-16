import { deriveElements } from "@/lib/blueprint/elements";
import { createBlueprint, defaultSymbolStats, slugify } from "@/lib/blueprint/factory";
import {
  BLUEPRINT_VERSION,
  type ElementDef,
  type FeatureConfig,
  type GameBlueprint,
  type GridConfiguration,
  type PaylineDef,
  type PaytableEntry,
  type SpecialSymbolDef,
  type SymbolDef,
} from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { applyDesign, designDocFromBlueprint, migrateBlueprint } from "@/lib/design/migrate";
import { validateBlueprintForExport } from "@/lib/export/operations";
import {
  applyPaylineConfigurationToBlueprint,
  applyPaylinePreset,
  paylineConfigurationFromBlueprint,
  repairMalformedPaylines,
} from "@/lib/paylines/operations";
import {
  applyPaytableConfigurationToBlueprint,
  paytableConfigurationFromBlueprint,
  syncPaytableWithReels,
} from "@/lib/paytable/operations";
import {
  applyReelConfigurationToBlueprint,
  reelConfigurationFromBlueprint,
  syncReelConfiguration,
} from "@/lib/reels/operations";
import {
  createSceneCompositionState,
  syncScenesListToBlueprint,
} from "@/lib/scenes/operations";
import type {
  BlueprintFlowReadinessReport,
  BlueprintMigrationImportResult,
  ElementDeleteDependencyReport,
  ElementDependencyWarningItem,
  GridChangeOptions,
  GridChangeWarningItem,
  GridPaylineResolutionMode,
  GridSizeChangeDependencyReport,
  StudioFlowStageMeta,
  StudioFlowStageStatus,
  SymbolDeleteDependencyReport,
  SymbolDependencyWarningItem,
} from "./types";

/* -------------------------------------------------------------------------- */
/* 1. End-to-End Studio Flow Stages (14 Stages)                               */
/* -------------------------------------------------------------------------- */

export const INTEGRATION_FLOW_STAGES: readonly StudioFlowStageMeta[] = [
  {
    id: "dashboard",
    order: 1,
    label: "Dashboard",
    description: "Browse, search, filter, and organize slot projects and folders.",
    href: () => "/dashboard",
  },
  {
    id: "new-game",
    order: 2,
    label: "New Game",
    description: "Create a new slot project with grid, theme, style guide, and symbol defaults.",
    href: () => "/project/new",
  },
  {
    id: "project",
    order: 3,
    label: "Project",
    description: "Inspect and edit project metadata, blueprint summary, and history.",
    href: (projectId) => `/project/${projectId}`,
  },
  {
    id: "design",
    order: 4,
    label: "Design",
    description: "Manage symbol sets, standalone elements, artwork, and visual structure.",
    href: (projectId) => `/project/${projectId}/design`,
  },
  {
    id: "symbol-set",
    order: 5,
    label: "Symbol Set",
    description: "Configure symbol set headers, tiers, frames, backgrounds, and member symbols.",
    href: (projectId, setId) =>
      setId ? `/projects/${projectId}/sets/${setId}` : `/project/${projectId}/design`,
  },
  {
    id: "symbol",
    order: 6,
    label: "Symbol",
    description: "Edit individual symbol metadata, role flags, payouts, variants, and extras.",
    href: (projectId, symbolId) =>
      symbolId
        ? `/projects/${projectId}/symbols/${symbolId}`
        : `/project/${projectId}/symbols`,
  },
  {
    id: "canvas",
    order: 7,
    label: "Canvas",
    description: "Position, resize, rotate, snap, and inspect visual objects on the stage.",
    href: (projectId) => `/projects/${projectId}/canvas`,
  },
  {
    id: "layers",
    order: 8,
    label: "Layers",
    description: "Manage layer z-order, visibility, lock state, opacity, and blend modes.",
    href: (projectId) => `/projects/${projectId}/canvas`,
  },
  {
    id: "scenes",
    order: 9,
    label: "Scenes",
    description: "Switch and compose up to 3 independent scenes (Base Game, Free Spins, Bonus).",
    href: (projectId) => `/project/${projectId}/scenes`,
  },
  {
    id: "reels",
    order: 10,
    label: "Reels",
    description: "Configure reel strips, stop ordering, weights, and text/visual stop editing.",
    href: (projectId) => `/project/${projectId}/reels`,
  },
  {
    id: "paylines",
    order: 11,
    label: "Paylines",
    description: "Edit payline patterns, presets, quick shapes, and active line toggles.",
    href: (projectId) => `/project/${projectId}/paylines`,
  },
  {
    id: "paytable",
    order: 12,
    label: "Paytable",
    description: "Configure symbol payout multipliers across N-of-a-kind match counts.",
    href: (projectId) => `/project/${projectId}/paytable`,
  },
  {
    id: "preview",
    order: 13,
    label: "Preview",
    description: "Inspect deterministic static presentation across scenes and layers.",
    href: (projectId) => `/project/${projectId}/preview`,
  },
  {
    id: "export",
    order: 14,
    label: "Export",
    description: "Validate and export Download ZIP, PNG Asset Sheet, Blueprint JSON, and Project JSON.",
    href: (projectId) => `/project/${projectId}/export`,
  },
];

export function verifyBlueprintFlowReadiness(
  bp: GameBlueprint,
): BlueprintFlowReadinessReport {
  const projectId = bp.meta?.id || "prj-unknown";
  const firstSetId = bp.symbolSets?.[0]?.id;
  const firstSymId = bp.symbols?.[0]?.id;
  const validation = validateBlueprint(bp);
  const totalSceneObjects = (bp.scenes ?? []).reduce(
    (sum, s) => sum + (s.objects?.length ?? 0),
    0,
  );

  const rawStages = INTEGRATION_FLOW_STAGES.map((stage) => {
    switch (stage.id) {
      case "dashboard":
        return {
          id: stage.id,
          label: stage.label,
          ready: Boolean(bp.meta?.id && bp.meta?.title),
          itemCount: 1,
          summary: `Project "${bp.meta?.title || "Untitled"}" indexed`,
          href: stage.href(projectId),
        };
      case "new-game":
        return {
          id: stage.id,
          label: stage.label,
          ready: Boolean(bp.reels?.columns >= 3 && bp.reels?.rows >= 2),
          itemCount: bp.symbols?.length ?? 0,
          summary: `${bp.reels?.columns ?? 0}×${bp.reels?.rows ?? 0} (${bp.reels?.evaluation ?? "lines"})`,
          href: stage.href(projectId),
        };
      case "project":
        return {
          id: stage.id,
          label: stage.label,
          ready: Boolean(bp.meta?.title?.trim()),
          itemCount: Object.keys(bp.meta ?? {}).length,
          summary: `${bp.meta?.theme || "Default"} · ${bp.meta?.status || "draft"}`,
          href: stage.href(projectId),
        };
      case "design":
        return {
          id: stage.id,
          label: stage.label,
          ready: (bp.elements?.length ?? 0) > 0,
          itemCount: bp.elements?.length ?? 0,
          summary: `${bp.elements?.length ?? 0} elements · ${bp.assets?.length ?? 0} assets`,
          href: stage.href(projectId),
        };
      case "symbol-set":
        return {
          id: stage.id,
          label: stage.label,
          ready: (bp.symbolSets?.length ?? 0) > 0,
          itemCount: bp.symbolSets?.length ?? 0,
          summary: `${bp.symbolSets?.length ?? 0} symbol sets`,
          href: stage.href(projectId, firstSetId),
        };
      case "symbol":
        return {
          id: stage.id,
          label: stage.label,
          ready: (bp.symbols?.length ?? 0) >= 4,
          itemCount: bp.symbols?.length ?? 0,
          summary: `${bp.symbols?.length ?? 0} symbols (${bp.specialSymbols?.length ?? 0} specials)`,
          href: stage.href(projectId, firstSymId),
        };
      case "canvas":
        return {
          id: stage.id,
          label: stage.label,
          ready: Boolean(bp.canvas?.width > 0 && bp.canvas?.height > 0),
          itemCount: totalSceneObjects,
          summary: `${bp.canvas?.width ?? 0}×${bp.canvas?.height ?? 0}px · ${totalSceneObjects} objects`,
          href: stage.href(projectId),
        };
      case "layers":
        return {
          id: stage.id,
          label: stage.label,
          ready: (bp.layers?.length ?? 0) > 0,
          itemCount: bp.layers?.length ?? 0,
          summary: `${bp.layers?.length ?? 0} layers`,
          href: stage.href(projectId),
        };
      case "scenes":
        return {
          id: stage.id,
          label: stage.label,
          ready: (bp.scenes?.length ?? 0) >= 1 && (bp.scenes?.length ?? 0) <= 3,
          itemCount: bp.scenes?.length ?? 0,
          summary: `${bp.scenes?.length ?? 0} scene(s)`,
          href: stage.href(projectId),
        };
      case "reels":
        return {
          id: stage.id,
          label: stage.label,
          ready:
            (bp.reels?.strips?.length ?? 0) === bp.reels?.columns &&
            (bp.reels?.strips ?? []).every((st) => st.length > 0),
          itemCount: bp.reels?.strips?.length ?? 0,
          summary: `${bp.reels?.strips?.length ?? 0} reels configured`,
          href: stage.href(projectId),
        };
      case "paylines":
        return {
          id: stage.id,
          label: stage.label,
          ready:
            bp.reels?.evaluation !== "lines" ||
            ((bp.paylines?.length ?? 0) > 0 &&
              bp.paylines.every((pl) => pl.pattern.length === bp.reels.columns)),
          itemCount: bp.paylines?.length ?? 0,
          summary: `${bp.paylines?.filter((p) => p.active).length ?? 0}/${bp.paylines?.length ?? 0} active lines`,
          href: stage.href(projectId),
        };
      case "paytable":
        return {
          id: stage.id,
          label: stage.label,
          ready: (bp.paytable?.length ?? 0) > 0,
          itemCount: bp.paytable?.length ?? 0,
          summary: `${bp.paytable?.length ?? 0} payout entries`,
          href: stage.href(projectId),
        };
      case "preview":
        return {
          id: stage.id,
          label: stage.label,
          ready: validation.integrityOk && (bp.scenes?.length ?? 0) > 0,
          itemCount: bp.scenes?.length ?? 0,
          summary: validation.integrityOk ? "Presentation ready" : "Integrity issues",
          href: stage.href(projectId),
        };
      case "export":
        return {
          id: stage.id,
          label: stage.label,
          ready: validation.integrityOk,
          itemCount: 4,
          summary: validation.integrityOk ? "4 export formats ready" : "Export blocked",
          href: stage.href(projectId),
        };
    }
  });

  const stages: StudioFlowStageStatus[] = rawStages.map((s) => ({
    ...s,
    status: s.ready ? "ready" : "warning",
    detail: s.summary,
  }));
  const readyCount = stages.filter((s) => s.ready).length;
  const allReady = readyCount === stages.length && validation.integrityOk;

  return {
    projectId,
    projectTitle: bp.meta?.title || "Untitled",
    allStagesReady: allReady,
    allReady,
    readyCount,
    totalCount: stages.length,
    stages,
    issues: validation.issues,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Central State Reconciliation (Zero-Drift Synchronization)               */
/* -------------------------------------------------------------------------- */

function syncSpecialSymbolsFromRoster(
  symbols: SymbolDef[],
  existingSpecials: SpecialSymbolDef[],
): SpecialSymbolDef[] {
  const existingMap = new Map(existingSpecials.map((sp) => [sp.symbolId, sp]));
  const nextSpecials: SpecialSymbolDef[] = [];

  for (const sym of symbols) {
    const prev = existingMap.get(sym.id);
    if (sym.isWild) {
      nextSpecials.push({
        id:
          prev?.behaviour === "wild"
            ? prev.id
            : sym.id === "sym-wild"
              ? "special-wild"
              : `special-wild-${sym.id}`,
        symbolId: sym.id,
        behaviour: "wild",
        params:
          prev?.behaviour === "wild"
            ? { ...prev.params }
            : { substitutesScatter: false, multiplier: 1 },
      });
    } else if (sym.isScatter) {
      nextSpecials.push({
        id:
          prev?.behaviour === "scatter"
            ? prev.id
            : sym.id === "sym-scatter"
              ? "special-scatter"
              : `special-scatter-${sym.id}`,
        symbolId: sym.id,
        behaviour: "scatter",
        params:
          prev?.behaviour === "scatter"
            ? { ...prev.params }
            : { triggerCount: 3, awardsFreeSpins: 10 },
      });
    } else if (sym.isBonus) {
      nextSpecials.push({
        id:
          prev?.behaviour === "bonus"
            ? prev.id
            : sym.id === "sym-bonus"
              ? "special-bonus"
              : `special-bonus-${sym.id}`,
        symbolId: sym.id,
        behaviour: "bonus",
        params:
          prev?.behaviour === "bonus"
            ? { ...prev.params }
            : { triggerCount: 3, feature: "pick_bonus" },
      });
    } else if (prev && sym.tier === "special") {
      nextSpecials.push({
        ...prev,
        params: { ...prev.params },
      });
    }
  }

  return nextSpecials;
}

/**
 * Reconciles every slice of `GameBlueprint` so that modifying any section
 * (Design, Symbol Sets, Symbols, Canvas, Layers, Scenes, Reels, Paylines,
 * Paytable, Math, Features, Export) is immediately and deterministically
 * reflected everywhere else with zero state drift.
 */
export function reconcileBlueprintState(bp: GameBlueprint): GameBlueprint {
  const columns = Math.max(3, Math.min(8, Math.round(bp.reels?.columns ?? 5)));
  const rows = Math.max(2, Math.min(6, Math.round(bp.reels?.rows ?? 3)));
  const evaluation = bp.reels?.evaluation ?? "lines";
  const presetKey = `${columns}x${rows}`;
  const gridPreset: GridConfiguration["preset"] =
    presetKey === "5x3" ||
    presetKey === "5x4" ||
    presetKey === "6x3" ||
    presetKey === "6x4"
      ? presetKey
      : "custom";

  // 1. Synchronize special symbol rules & symbol role flags
  const specialBySymbolId = new Map(
    (bp.specialSymbols ?? []).map((sp) => [sp.symbolId, sp]),
  );
  const symbols: SymbolDef[] = (bp.symbols ?? []).map((sym) => {
    const sp = specialBySymbolId.get(sym.id);
    const isWild =
      sym.isWild !== undefined ? sym.isWild : sp?.behaviour === "wild";
    const isScatter =
      sym.isScatter !== undefined ? sym.isScatter : sp?.behaviour === "scatter";
    const isBonus =
      sym.isBonus !== undefined ? sym.isBonus : sp?.behaviour === "bonus";
    return {
      ...sym,
      isWild: Boolean(isWild),
      isScatter: Boolean(isScatter),
      isBonus: Boolean(isBonus),
    };
  });

  const specialSymbols = syncSpecialSymbolsFromRoster(
    symbols,
    bp.specialSymbols ?? [],
  );

  // 2. Synchronize elements & symbolSets with symbol roster
  const symbolIdSet = new Set(symbols.map((s) => s.id));
  const symbolById = new Map(symbols.map((s) => [s.id, s]));
  const rawElements = bp.elements?.length ? bp.elements : deriveElements(bp);

  const cleanedElements: ElementDef[] = rawElements
    .map((el) => {
      if (el.type === "symbol") {
        const validIds = el.symbolIds.filter((id) => symbolIdSet.has(id));
        if (validIds.length === 0) return null;
        const sym = symbolById.get(validIds[0]!);
        return sym
          ? {
              ...el,
              name: sym.name,
              symbolIds: [sym.id],
              assetId: sym.assetId ?? el.assetId,
            }
          : el;
      }
      if (el.type === "symbol_set") {
        return {
          ...el,
          symbolIds: el.symbolIds.filter((id) => symbolIdSet.has(id)),
        };
      }
      return el;
    })
    .filter((el): el is ElementDef => el !== null);

  // Ensure every symbol is owned by either a symbol_set or a standalone symbol element
  const ownedSymbolIds = new Set(cleanedElements.flatMap((el) => el.symbolIds));
  for (const sym of symbols) {
    if (ownedSymbolIds.has(sym.id)) continue;
    const explicitSetEl = sym.symbolSetId
      ? cleanedElements.find(
          (el) =>
            el.type === "symbol_set" &&
            (el.id === sym.symbolSetId ||
              el.id === `el-set-${sym.symbolSetId}` ||
              el.id === `el-symbol-${sym.symbolSetId}`),
        )
      : undefined;
    if (explicitSetEl) {
      explicitSetEl.symbolIds = [...explicitSetEl.symbolIds, sym.id];
      continue;
    }
    if (sym.tier === "special" || sym.isWild || sym.isScatter || sym.isBonus) {
      cleanedElements.push({
        id: `el-special-${sym.id}`,
        type: "symbol",
        name: sym.name,
        group: "Special",
        assetId: sym.assetId,
        symbolIds: [sym.id],
        notes: "",
        origin: sym.assetId ? "imported" : "planned",
        params: {},
      });
    } else {
      const targetSet = cleanedElements.find((el) => el.type === "symbol_set");
      if (targetSet) {
        targetSet.symbolIds = [...targetSet.symbolIds, sym.id];
      } else {
        cleanedElements.push({
          id: "el-symbol-set-auto",
          type: "symbol_set",
          name: "Game Symbols",
          group: "Custom Symbols",
          assetId: null,
          symbolIds: [sym.id],
          notes: "",
          origin: "planned",
          params: {},
          symbolSet: {
            symbolType: "custom",
            valueTier: sym.tier === "high" ? "high" : sym.tier === "mid" ? "medium" : "low",
          },
        });
      }
    }
  }

  let next: GameBlueprint = {
    ...bp,
    version: BLUEPRINT_VERSION,
    grid: {
      columns,
      rows,
      preset: gridPreset,
      evaluation,
    },
    reels: {
      ...bp.reels,
      columns,
      rows,
      evaluation,
    },
    symbols,
    specialSymbols,
    elements: cleanedElements,
  };

  // Apply design slice so symbolSets, canvas.backgroundAssetId, and scene objects stay synced
  const designDoc = designDocFromBlueprint(next);
  next = applyDesign(next, designDoc);

  // Ensure every symbol's symbolSetId matches its owning symbolSet id
  const ownerSetBySymbolId = new Map<string, string>();
  for (const set of next.symbolSets ?? []) {
    for (const sid of set.symbolIds) {
      if (!ownerSetBySymbolId.has(sid)) {
        ownerSetBySymbolId.set(sid, set.id);
      }
    }
  }
  next = {
    ...next,
    symbols: next.symbols.map((sym) => ({
      ...sym,
      symbolSetId: ownerSetBySymbolId.get(sym.id) ?? null,
    })),
  };

  // 3. Synchronize ReelConfiguration & Reels strips with symbol roster and column count
  const fallbackSymbolId = next.symbols[0]?.id ?? "sym-fallback";
  const cleanedStrips: string[][] = Array.from({ length: columns }, (_, colIdx) => {
    const existingStrip = next.reels.strips[colIdx] ?? next.reels.strips[0] ?? [];
    const validStops = existingStrip.filter((sid) => symbolIdSet.has(sid));
    if (validStops.length > 0) return validStops;
    return next.symbols.length > 0
      ? next.symbols.map((s) => s.id)
      : [fallbackSymbolId];
  });

  next = {
    ...next,
    reels: {
      ...next.reels,
      columns,
      rows,
      strips: cleanedStrips,
    },
  };

  const baseReelConfig = reelConfigurationFromBlueprint({
    ...next,
    reelConfiguration: next.reelConfiguration
      ? {
          ...next.reelConfiguration,
          columns,
          rows,
          evaluation,
          reels: Array.from({ length: columns }, (_, idx) => {
            const existingReel =
              next.reelConfiguration!.reels[idx] ??
              next.reelConfiguration!.reels[next.reelConfiguration!.reels.length - 1];
            const filteredStops = (existingReel?.stops ?? []).filter((st) =>
              symbolIdSet.has(st.symbolId),
            );
            return {
              id: `reel-${idx + 1}`,
              index: idx + 1,
              name: existingReel?.name || `Reel ${idx + 1}`,
              stops:
                filteredStops.length > 0
                  ? filteredStops.map((st, sIdx) => ({
                      ...st,
                      position: sIdx + 1,
                    }))
                  : cleanedStrips[idx]!.map((sid, sIdx) => ({
                      id: `reel-${idx + 1}-stop-${sIdx + 1}`,
                      position: sIdx + 1,
                      symbolId: sid,
                      weight: Math.max(1, symbolById.get(sid)?.reelWeight ?? 1),
                    })),
            };
          }),
        }
      : undefined,
  });
  const syncedReelConfig = syncReelConfiguration(baseReelConfig);
  next = applyReelConfigurationToBlueprint(next, syncedReelConfig);

  // 4. Synchronize Paylines & PaylineConfiguration with grid dimensions
  const basePaylineConfig = paylineConfigurationFromBlueprint({
    ...next,
    paylineConfiguration: next.paylineConfiguration
      ? {
          ...next.paylineConfiguration,
          columns,
          rows,
          evaluation,
        }
      : undefined,
  });
  const repairedPaylineConfig = repairMalformedPaylines({
    ...basePaylineConfig,
    columns,
    rows,
    evaluation,
  });
  next = applyPaylineConfigurationToBlueprint(next, repairedPaylineConfig);

  // 5. Synchronize Paytable & PaytableConfiguration with symbols and grid columns
  const basePaytableConfig = paytableConfigurationFromBlueprint(next);
  const syncedPaytableConfig = syncPaytableWithReels(
    basePaytableConfig,
    columns,
    rows,
    evaluation,
  );
  next = applyPaytableConfigurationToBlueprint(next, syncedPaytableConfig);

  // 6. Normalize scenes (1..3 scenes, layers, visibility, canvasConfiguration, layoutMetadata)
  const sceneState = createSceneCompositionState(next);
  next = syncScenesListToBlueprint(next, sceneState);

  return next;
}

/* -------------------------------------------------------------------------- */
/* 3. Delete Symbol Dependency Analysis & Safe Deletion                       */
/* -------------------------------------------------------------------------- */

export function analyzeDeleteSymbolDependencies(
  bp: GameBlueprint,
  symbolId: string,
): SymbolDeleteDependencyReport {
  const symbol = bp.symbols.find((s) => s.id === symbolId);
  if (!symbol) {
    return {
      symbolId,
      symbolName: "Unknown Symbol",
      symbolCode: "?",
      exists: false,
      hasWarnings: false,
      totalReferences: 0,
      reelReferences: [],
      paytableReferences: [],
      paylineReferences: [],
      featureReferences: [],
      warnings: [],
    };
  }

  const warnings: SymbolDependencyWarningItem[] = [];

  // 1. Reel references
  const reelConfig = reelConfigurationFromBlueprint(bp);
  const reelReferences = reelConfig.reels
    .map((reel, idx) => {
      const stopCount = reel.stops.filter((st) => st.symbolId === symbolId).length;
      return {
        reelIndex: idx + 1,
        reelId: reel.id,
        reelName: reel.name,
        stopCount,
        totalStopsInReel: reel.stops.length,
        leavesReelEmpty: stopCount > 0 && stopCount === reel.stops.length,
      };
    })
    .filter((ref) => ref.stopCount > 0);

  if (reelReferences.length > 0) {
    const totalStops = reelReferences.reduce((sum, r) => sum + r.stopCount, 0);
    const leavesAnyEmpty = reelReferences.some((r) => r.leavesReelEmpty);
    warnings.push({
      category: "reel",
      severity: leavesAnyEmpty ? "critical" : "warning",
      title: `Referenced in ${reelReferences.length} reel(s) (${totalStops} stop${totalStops === 1 ? "" : "s"})`,
      message: leavesAnyEmpty
        ? `Deleting "${symbol.name}" (${symbol.code}) would leave ${reelReferences
            .filter((r) => r.leavesReelEmpty)
            .map((r) => r.reelName)
            .join(", ")} with 0 stops.`
        : `Symbol "${symbol.name}" (${symbol.code}) is used across ${reelReferences
            .map((r) => `${r.reelName} (${r.stopCount}×)`)
            .join(", ")}.`,
      targetId: reelReferences[0]!.reelId,
    });
  }

  // 2. Paytable references
  const paytableConfig = paytableConfigurationFromBlueprint(bp);
  const symbolRow = paytableConfig.symbolRows.find((r) => r.symbolId === symbolId);
  const paytableEntries = bp.paytable.filter((e) => e.symbolId === symbolId);
  const paytableReferences = paytableEntries.map((entry) => ({
    ofAKind: entry.ofAKind,
    payout: entry.payout,
    isCustomOverride: Boolean(
      symbolRow &&
        symbolRow.defaultPayouts[entry.ofAKind] !== undefined &&
        symbolRow.defaultPayouts[entry.ofAKind] !== entry.payout,
    ),
  }));

  if (paytableReferences.length > 0) {
    const hasCustom = paytableReferences.some((r) => r.isCustomOverride);
    warnings.push({
      category: "paytable",
      severity: hasCustom ? "critical" : "warning",
      title: `Referenced in Paytable (${paytableReferences.length} payout tier${paytableReferences.length === 1 ? "" : "s"})`,
      message: `Deleting "${symbol.name}" (${symbol.code}) will remove ${paytableReferences
        .map((r) => `${r.ofAKind}OAK=${r.payout}x`)
        .join(", ")} from the paytable.`,
      targetId: `paytable-${symbolId}`,
    });
  }

  // 3. Payline-related configuration references
  const paylineReferences: SymbolDeleteDependencyReport["paylineReferences"] = [];
  const activePaylines = (bp.paylines ?? []).filter((pl) => pl.active);
  const remainingSymbolCount = bp.symbols.length - 1;

  if (bp.reels.evaluation === "lines" && activePaylines.length > 0) {
    if (symbol.isWild || bp.specialSymbols.some((sp) => sp.symbolId === symbolId && sp.behaviour === "wild")) {
      paylineReferences.push({
        id: "paylines-wild-substitution",
        label: `Wild substitution across ${activePaylines.length} active paylines`,
        detail: `"${symbol.name}" (${symbol.code}) substitutes along ${activePaylines.length} active payline patterns.`,
      });
    }
    if (remainingSymbolCount < 4) {
      paylineReferences.push({
        id: "paylines-min-symbols",
        label: "Minimum symbol threshold for payline evaluation",
        detail: `Deleting "${symbol.name}" reduces symbol roster to ${remainingSymbolCount} (minimum 4 required for valid line evaluation).`,
      });
    }
    // Check if any payline or paylineConfiguration metadata references this symbol
    const previewSymbolId = (bp.extensions as Record<string, unknown> | undefined)?.paylinePreviewSymbolId;
    if (previewSymbolId === symbolId) {
      paylineReferences.push({
        id: "paylines-preview-symbol",
        label: "Payline preview target symbol",
        detail: `"${symbol.name}" is configured as the highlighted payline preview symbol.`,
      });
    }
    // Also record line evaluation participation if symbol is on every reel for active lines
    if (reelReferences.length === bp.reels.columns && paylineReferences.length === 0) {
      paylineReferences.push({
        id: "paylines-full-line-coverage",
        label: `${activePaylines.length} active paylines evaluate ${symbol.code}`,
        detail: `"${symbol.name}" appears on all ${bp.reels.columns} reels and can form full ${bp.reels.columns}-of-a-kind line wins across ${activePaylines.length} paylines.`,
      });
    }
  }

  for (const plRef of paylineReferences) {
    warnings.push({
      category: "payline",
      severity: plRef.id === "paylines-min-symbols" ? "critical" : "warning",
      title: plRef.label,
      message: plRef.detail,
      targetId: plRef.id,
    });
  }

  // 4. Feature configuration references
  const featureReferences: SymbolDeleteDependencyReport["featureReferences"] = [];
  for (const feature of bp.features ?? []) {
    const paramEntries = Object.entries(feature.params ?? {});
    const mentionsSymbolInParams = paramEntries.some(
      ([, val]) =>
        val === symbol.id ||
        (typeof val === "string" && val.toUpperCase() === symbol.code.toUpperCase()),
    );

    if (mentionsSymbolInParams) {
      featureReferences.push({
        featureId: feature.id,
        featureName: feature.name,
        featureKind: feature.kind,
        reason: `Feature "${feature.name}" parameter explicitly references symbol "${symbol.name}" (${symbol.code}).`,
      });
      continue;
    }

    if (feature.enabled) {
      if (feature.kind === "free_spins" && symbol.isScatter) {
        const otherScatters = bp.symbols.filter(
          (s) => s.id !== symbol.id && s.isScatter,
        );
        featureReferences.push({
          featureId: feature.id,
          featureName: feature.name,
          featureKind: feature.kind,
          reason:
            otherScatters.length === 0
              ? `Enabled feature "${feature.name}" relies on Scatter symbol "${symbol.name}" (${symbol.code}) as its sole trigger.`
              : `Enabled feature "${feature.name}" uses Scatter symbol "${symbol.name}" (${symbol.code}) as a trigger.`,
        });
      } else if (
        (feature.kind === "hold_and_win" || feature.kind === "pick_bonus") &&
        symbol.isBonus
      ) {
        const otherBonus = bp.symbols.filter(
          (s) => s.id !== symbol.id && s.isBonus,
        );
        featureReferences.push({
          featureId: feature.id,
          featureName: feature.name,
          featureKind: feature.kind,
          reason:
            otherBonus.length === 0
              ? `Enabled feature "${feature.name}" relies on Bonus symbol "${symbol.name}" (${symbol.code}) as its sole trigger.`
              : `Enabled feature "${feature.name}" uses Bonus symbol "${symbol.name}" (${symbol.code}) as a trigger.`,
        });
      } else if (
        (String(feature.kind) === "expanding_wilds" ||
          feature.name.toLowerCase().includes("wild")) &&
        symbol.isWild
      ) {
        featureReferences.push({
          featureId: feature.id,
          featureName: feature.name,
          featureKind: feature.kind,
          reason: `Enabled feature "${feature.name}" relies on Wild symbol "${symbol.name}" (${symbol.code}).`,
        });
      }
    }
  }

  for (const featRef of featureReferences) {
    warnings.push({
      category: "feature",
      severity: "warning",
      title: `Referenced by feature "${featRef.featureName}"`,
      message: featRef.reason,
      targetId: featRef.featureId,
    });
  }

  const totalReferences =
    reelReferences.length +
    paytableReferences.length +
    paylineReferences.length +
    featureReferences.length;

  return {
    symbolId,
    symbolName: symbol.name,
    symbolCode: symbol.code,
    exists: true,
    hasWarnings: warnings.length > 0,
    totalReferences,
    reelReferences,
    paytableReferences,
    paylineReferences,
    featureReferences,
    warnings,
  };
}

export function deleteSymbolFromBlueprint(
  bp: GameBlueprint,
  symbolId: string,
  options?: { replacementSymbolId?: string },
): { blueprint: GameBlueprint; report: SymbolDeleteDependencyReport } {
  const report = analyzeDeleteSymbolDependencies(bp, symbolId);
  if (!report.exists) {
    return { blueprint: bp, report };
  }

  const remainingSymbols = bp.symbols.filter((s) => s.id !== symbolId);
  const fallbackSymbolId =
    options?.replacementSymbolId &&
    remainingSymbols.some((s) => s.id === options.replacementSymbolId)
      ? options.replacementSymbolId
      : (remainingSymbols[0]?.id ?? null);

  // Replace or remove stops in reels
  const nextStrips = bp.reels.strips.map((strip) => {
    const filtered = strip
      .map((sid) => (sid === symbolId ? (options?.replacementSymbolId ?? null) : sid))
      .filter((sid): sid is string => Boolean(sid) && sid !== symbolId);
    if (filtered.length > 0) return filtered;
    return fallbackSymbolId ? [fallbackSymbolId] : [];
  });

  const nextReelConfig = bp.reelConfiguration
    ? {
        ...bp.reelConfiguration,
        reels: bp.reelConfiguration.reels.map((r) => {
          const nextStops = r.stops
            .map((st) =>
              st.symbolId === symbolId
                ? options?.replacementSymbolId
                  ? { ...st, symbolId: options.replacementSymbolId }
                  : null
                : st,
            )
            .filter((st): st is NonNullable<typeof st> => st !== null);
          return {
            ...r,
            stops:
              nextStops.length > 0
                ? nextStops.map((st, idx) => ({ ...st, position: idx + 1 }))
                : fallbackSymbolId
                  ? [
                      {
                        id: `${r.id}-stop-fallback`,
                        position: 1,
                        symbolId: fallbackSymbolId,
                        weight: 1,
                      },
                    ]
                  : [],
          };
        }),
      }
    : undefined;

  // Clean features params referencing deleted symbol
  const nextFeatures: FeatureConfig[] = (bp.features ?? []).map((feat) => {
    const nextParams: Record<string, number | string | boolean> = {};
    for (const [k, v] of Object.entries(feat.params ?? {})) {
      if (v === symbolId && fallbackSymbolId) {
        nextParams[k] = fallbackSymbolId;
      } else if (v !== symbolId) {
        nextParams[k] = v;
      }
    }
    return { ...feat, params: nextParams };
  });

  // Unbind scene objects referencing the deleted symbol
  const nextScenes = (bp.scenes ?? []).map((scene) => ({
    ...scene,
    objects: (scene.objects ?? []).filter(
      (obj) => !(obj.kind === "symbol" && obj.refId === symbolId),
    ),
  }));

  const rawNext: GameBlueprint = {
    ...bp,
    symbols: remainingSymbols,
    specialSymbols: (bp.specialSymbols ?? [])
      .filter((sp) => sp.symbolId !== symbolId)
      .map((sp) => {
        const nextParams: Record<string, number | string | boolean> = {};
        for (const [k, v] of Object.entries(sp.params ?? {})) {
          if (v !== symbolId) {
            nextParams[k] = v;
          }
        }
        return {
          ...sp,
          params: nextParams,
        };
      }),
    elements: (bp.elements ?? [])
      .map((el) => {
        if (el.type === "symbol" && el.symbolIds.includes(symbolId)) {
          return null;
        }
        if (el.symbolIds.includes(symbolId)) {
          return {
            ...el,
            symbolIds: el.symbolIds.filter((id) => id !== symbolId),
          };
        }
        return el;
      })
      .filter((el): el is ElementDef => el !== null),
    symbolSets: (bp.symbolSets ?? []).map((set) => ({
      ...set,
      symbolIds: set.symbolIds.filter((id) => id !== symbolId),
    })),
    reels: {
      ...bp.reels,
      strips: nextStrips,
    },
    reelConfiguration: nextReelConfig,
    paytable: (bp.paytable ?? []).filter((e) => e.symbolId !== symbolId),
    paytableConfiguration: bp.paytableConfiguration
      ? {
          ...bp.paytableConfiguration,
          symbolRows: bp.paytableConfiguration.symbolRows.filter(
            (r) => r.symbolId !== symbolId,
          ),
          entries: bp.paytableConfiguration.entries.filter(
            (e) => e.symbolId !== symbolId,
          ),
        }
      : undefined,
    features: nextFeatures,
    scenes: nextScenes,
  };

  return {
    blueprint: reconcileBlueprintState(rawNext),
    report,
  };
}

/* -------------------------------------------------------------------------- */
/* 4. Delete Element Dependency Analysis & Safe Deletion                      */
/* -------------------------------------------------------------------------- */

export function analyzeDeleteElementDependencies(
  bp: GameBlueprint,
  elementId: string,
): ElementDeleteDependencyReport {
  const element = (bp.elements ?? []).find((el) => el.id === elementId);
  if (!element) {
    return {
      elementId,
      elementName: "Unknown Element",
      elementType: "unknown",
      exists: false,
      hasWarnings: false,
      totalReferences: 0,
      sceneLayerReferences: [],
      symbolSetReferences: [],
      animationReferences: [],
      assetReferences: [],
      warnings: [],
    };
  }

  const warnings: ElementDependencyWarningItem[] = [];
  const ownedSymbolIds = new Set(element.symbolIds ?? []);
  const assetById = new Map((bp.assets ?? []).map((a) => [a.id, a]));
  const symbolById = new Map((bp.symbols ?? []).map((s) => [s.id, s]));

  const primaryAssetId =
    element.type === "symbol"
      ? (symbolById.get(element.symbolIds[0] ?? "")?.assetId ?? element.assetId)
      : (element.assetId ??
        (element.image?.provider === "project" ? element.image.assetId ?? null : null));

  // 1. Scene Layer references
  const sceneLayerReferences: ElementDeleteDependencyReport["sceneLayerReferences"] = [];
  const globalLayerMap = new Map((bp.layers ?? []).map((l) => [l.id, l]));

  for (const scene of bp.scenes ?? []) {
    const sceneLayers = scene.layers?.length ? scene.layers : bp.layers ?? [];
    const layerMap = new Map(sceneLayers.map((l) => [l.id, l]));

    for (const obj of scene.objects ?? []) {
      const matchesElement = obj.kind === "element" && obj.refId === element.id;
      const matchesOwnedSymbol =
        obj.kind === "symbol" && obj.refId !== null && ownedSymbolIds.has(obj.refId);
      const matchesAsset = Boolean(primaryAssetId && obj.assetId === primaryAssetId);

      if (matchesElement || matchesOwnedSymbol || matchesAsset) {
        const layer = layerMap.get(obj.layerId) ?? globalLayerMap.get(obj.layerId);
        sceneLayerReferences.push({
          sceneId: scene.id,
          sceneName: scene.name,
          layerId: obj.layerId,
          layerName: layer?.name ?? obj.layerId,
          objectId: obj.id,
          objectName: obj.name,
          detail: matchesElement
            ? `Scene "${scene.name}" layer "${layer?.name ?? obj.layerId}" places element object "${obj.name}".`
            : matchesOwnedSymbol
              ? `Scene "${scene.name}" layer "${layer?.name ?? obj.layerId}" places member symbol "${obj.name}".`
              : `Scene "${scene.name}" layer "${layer?.name ?? obj.layerId}" uses shared artwork on "${obj.name}".`,
        });
      }
    }

    for (const comp of scene.composedImages ?? []) {
      const matchesCompElement =
        comp.refKind === "element" && comp.refId === element.id;
      if (matchesCompElement || (primaryAssetId && comp.assetId === primaryAssetId)) {
        const layer = comp.layerId ? layerMap.get(comp.layerId) : undefined;
        sceneLayerReferences.push({
          sceneId: scene.id,
          sceneName: scene.name,
          layerId: comp.layerId ?? "layer-bg",
          layerName: layer?.name ?? "Composed Image",
          objectId: comp.id,
          objectName: comp.name,
          detail: `Scene "${scene.name}" composed image "${comp.name}" references this element.`,
        });
      }
    }

    if (primaryAssetId && scene.background?.assetId === primaryAssetId) {
      sceneLayerReferences.push({
        sceneId: scene.id,
        sceneName: scene.name,
        layerId: "layer-bg",
        layerName: "Background",
        objectId: null,
        objectName: `${scene.name} Background`,
        detail: `Scene "${scene.name}" background uses this element's artwork.`,
      });
    }
  }

  for (const sRef of sceneLayerReferences) {
    warnings.push({
      category: "scene_layer",
      severity: "warning",
      title: `Used in scene "${sRef.sceneName}" (${sRef.layerName})`,
      message: sRef.detail,
      targetId: sRef.objectId ?? sRef.sceneId,
    });
  }

  // 2. Symbol Set references
  const symbolSetReferences: ElementDeleteDependencyReport["symbolSetReferences"] = [];
  if (element.type === "symbol_set") {
    symbolSetReferences.push({
      setId: element.id,
      setName: element.name,
      detail: `Element "${element.name}" is a Symbol Set containing ${element.symbolIds.length} member symbol(s).`,
    });
  } else {
    for (const setEl of bp.elements ?? []) {
      if (setEl.type !== "symbol_set" || setEl.id === element.id) continue;
      const sharedSyms = setEl.symbolIds.filter((sid) => ownedSymbolIds.has(sid));
      const usesFrameAsset =
        primaryAssetId &&
        setEl.symbolSet?.frame?.provider === "project" &&
        setEl.symbolSet.frame.assetId === primaryAssetId;
      const usesBgAsset =
        primaryAssetId &&
        setEl.symbolSet?.background?.provider === "project" &&
        setEl.symbolSet.background.assetId === primaryAssetId;

      if (sharedSyms.length > 0) {
        symbolSetReferences.push({
          setId: setEl.id,
          setName: setEl.name,
          detail: `Symbol Set "${setEl.name}" contains member symbol(s) linked to "${element.name}".`,
        });
      } else if (usesFrameAsset || usesBgAsset) {
        symbolSetReferences.push({
          setId: setEl.id,
          setName: setEl.name,
          detail: `Symbol Set "${setEl.name}" uses "${element.name}" artwork as its ${usesFrameAsset ? "Frame" : "Background"}.`,
        });
      }
    }
  }

  for (const setRef of symbolSetReferences) {
    warnings.push({
      category: "symbol_set",
      severity: element.type === "symbol_set" ? "critical" : "warning",
      title: `Symbol Set dependency: "${setRef.setName}"`,
      message: setRef.detail,
      targetId: setRef.setId,
    });
  }

  // 3. Animation references
  const animationReferences: ElementDeleteDependencyReport["animationReferences"] = [];
  for (const anim of bp.animations ?? []) {
    const targetsElement = anim.target === element.id;
    const targetsOwnedSymbol = ownedSymbolIds.has(anim.target);
    const usesElementAsset =
      primaryAssetId &&
      (anim.videoReference?.assetId === primaryAssetId ||
        anim.spriteSheetReference?.assetId === primaryAssetId);

    if (targetsElement || targetsOwnedSymbol || usesElementAsset) {
      animationReferences.push({
        animationId: anim.id,
        animationName: anim.name || anim.kind,
        trigger: anim.trigger,
        detail: targetsElement
          ? `Animation "${anim.name || anim.kind}" (${anim.trigger}) directly targets element "${element.name}".`
          : targetsOwnedSymbol
            ? `Animation "${anim.name || anim.kind}" (${anim.trigger}) targets a symbol owned by "${element.name}".`
            : `Animation "${anim.name || anim.kind}" (${anim.trigger}) references "${element.name}" artwork.`,
      });
    }
  }

  for (const animRef of animationReferences) {
    warnings.push({
      category: "animation",
      severity: "warning",
      title: `Referenced by animation "${animRef.animationName}"`,
      message: animRef.detail,
      targetId: animRef.animationId,
    });
  }

  // 4. Asset references
  const assetReferences: ElementDeleteDependencyReport["assetReferences"] = [];
  const seenAssets = new Set<string>();

  if (primaryAssetId) {
    const asset = assetById.get(primaryAssetId);
    seenAssets.add(primaryAssetId);
    assetReferences.push({
      assetId: primaryAssetId,
      assetName: asset?.name ?? primaryAssetId,
      role: "primary",
      detail: `Element "${element.name}" holds primary asset reference "${asset?.name ?? primaryAssetId}".`,
    });
  }

  for (const rev of element.imageHistory ?? []) {
    const revAssetId = rev.asset?.provider === "project" ? rev.asset.assetId ?? null : null;
    if (revAssetId && !seenAssets.has(revAssetId)) {
      const asset = assetById.get(revAssetId);
      seenAssets.add(revAssetId);
      assetReferences.push({
        assetId: revAssetId,
        assetName: asset?.name ?? revAssetId,
        role: "revision",
        detail: `Element "${element.name}" image revision (${rev.label || rev.id}) references asset "${asset?.name ?? revAssetId}".`,
      });
    }
  }

  for (const sid of ownedSymbolIds) {
    const sym = symbolById.get(sid);
    if (sym?.assetId && !seenAssets.has(sym.assetId)) {
      const asset = assetById.get(sym.assetId);
      seenAssets.add(sym.assetId);
      assetReferences.push({
        assetId: sym.assetId,
        assetName: asset?.name ?? sym.assetId,
        role: "symbol_asset",
        detail: `Member symbol "${sym.name}" references asset "${asset?.name ?? sym.assetId}".`,
      });
    }
  }

  for (const aRef of assetReferences) {
    warnings.push({
      category: "asset_reference",
      severity: "warning",
      title: `Asset reference: "${aRef.assetName}" (${aRef.role})`,
      message: aRef.detail,
      targetId: aRef.assetId,
    });
  }

  const totalReferences =
    sceneLayerReferences.length +
    symbolSetReferences.length +
    animationReferences.length +
    assetReferences.length;

  return {
    elementId,
    elementName: element.name,
    elementType: element.type,
    exists: true,
    hasWarnings: warnings.length > 0,
    totalReferences,
    sceneLayerReferences,
    symbolSetReferences,
    animationReferences,
    assetReferences,
    warnings,
  };
}

export function deleteElementFromBlueprint(
  bp: GameBlueprint,
  elementId: string,
): { blueprint: GameBlueprint; report: ElementDeleteDependencyReport } {
  const report = analyzeDeleteElementDependencies(bp, elementId);
  if (!report.exists) {
    return { blueprint: bp, report };
  }

  const nextElements = (bp.elements ?? []).filter((el) => el.id !== elementId);
  const nextSymbolSets = (bp.symbolSets ?? []).filter((s) => s.id !== elementId);
  const nextAnimations = (bp.animations ?? []).filter(
    (anim) => anim.target !== elementId,
  );
  const nextScenes = (bp.scenes ?? []).map((scene) => ({
    ...scene,
    objects: (scene.objects ?? []).filter(
      (obj) => !(obj.kind === "element" && obj.refId === elementId),
    ),
    composedImages: (scene.composedImages ?? []).filter(
      (comp) => !(comp.refKind === "element" && comp.refId === elementId),
    ),
  }));

  const rawNext: GameBlueprint = {
    ...bp,
    elements: nextElements,
    symbolSets: nextSymbolSets,
    animations: nextAnimations,
    scenes: nextScenes,
  };

  return {
    blueprint: reconcileBlueprintState(rawNext),
    report,
  };
}

/* -------------------------------------------------------------------------- */
/* 5. Change Grid Size Dependency Analysis & Safe Grid Resize                 */
/* -------------------------------------------------------------------------- */

export function analyzeGridSizeChangeDependencies(
  bp: GameBlueprint,
  nextColumns: number,
  nextRows: number,
): GridSizeChangeDependencyReport {
  const previousColumns = bp.reels.columns;
  const previousRows = bp.reels.rows;
  const targetColumns = Math.max(3, Math.min(8, Math.round(nextColumns)));
  const targetRows = Math.max(2, Math.min(6, Math.round(nextRows)));
  const changed =
    previousColumns !== targetColumns || previousRows !== targetRows;

  const warnings: GridChangeWarningItem[] = [];
  const incompatiblePaylines: GridSizeChangeDependencyReport["incompatiblePaylines"] = [];
  const incompatibleReels: GridSizeChangeDependencyReport["incompatibleReels"] = [];
  const incompatibleLayouts: GridSizeChangeDependencyReport["incompatibleLayouts"] = [];

  const previousWays = Math.pow(previousRows, previousColumns);
  const nextWays = Math.pow(targetRows, targetColumns);

  if (!changed) {
    return {
      previousColumns,
      previousRows,
      nextColumns: targetColumns,
      nextRows: targetRows,
      changed: false,
      hasWarnings: false,
      incompatiblePaylines,
      incompatibleReels,
      incompatibleLayouts,
      sceneLayoutWarnings: [],
      waysSummary: { previousWays, nextWays },
      addedColumnsCount: 0,
      truncatedColumnsCount: 0,
      warnings,
    };
  }

  // 1. Check paylines for length mismatch or out-of-bounds row indices
  for (const pl of bp.paylines ?? []) {
    const lengthMismatch = pl.pattern.length !== targetColumns;
    const outOfBoundsColumns: number[] = [];
    pl.pattern.slice(0, targetColumns).forEach((rowIdx, colIdx) => {
      if (rowIdx < 0 || rowIdx >= targetRows) {
        outOfBoundsColumns.push(colIdx + 1);
      }
    });

    if (lengthMismatch || outOfBoundsColumns.length > 0) {
      const reasons: string[] = [];
      if (lengthMismatch) {
        reasons.push(
          `pattern length is ${pl.pattern.length} (grid requires ${targetColumns} columns)`,
        );
      }
      if (outOfBoundsColumns.length > 0) {
        reasons.push(
          `row index >= ${targetRows} at column(s) ${outOfBoundsColumns.join(", ")}`,
        );
      }
      const reason = `Payline #${pl.index} (${pl.id}): ${reasons.join(" and ")}.`;
      incompatiblePaylines.push({
        paylineId: pl.id,
        paylineName: pl.name || `Payline #${pl.index}`,
        paylineIndex: pl.index,
        pattern: [...pl.pattern],
        outOfBoundsColumns,
        lengthMismatch,
        reason,
        detail: reason,
      });
    }
  }

  if (incompatiblePaylines.length > 0) {
    const hasRowClipping = incompatiblePaylines.some(
      (p) => p.outOfBoundsColumns.length > 0,
    );
    warnings.push({
      category: "payline",
      severity: hasRowClipping ? "critical" : "warning",
      title: `${incompatiblePaylines.length} incompatible payline(s) for ${targetColumns}×${targetRows} grid`,
      message: hasRowClipping
        ? `${incompatiblePaylines.filter((p) => p.outOfBoundsColumns.length > 0).length} payline(s) reference row indices outside 0..${targetRows - 1} and will be clamped.`
        : `${incompatiblePaylines.length} payline pattern(s) will be resized from ${previousColumns} to ${targetColumns} columns.`,
      targetId: incompatiblePaylines[0]!.paylineId,
    });
  }

  // 2. Check reel strips & reelConfiguration changes
  if (targetColumns < previousColumns) {
    for (let idx = targetColumns; idx < previousColumns; idx++) {
      const reelId = `reel-${idx + 1}`;
      const reason = `Reel ${idx + 1} (${reelId}) exceeds the new ${targetColumns}-column grid and will be truncated.`;
      incompatibleReels.push({
        reelIndex: idx + 1,
        reelId,
        action: "truncated",
        reason,
      });
    }
    warnings.push({
      category: "reel",
      severity: "warning",
      title: `${previousColumns - targetColumns} reel(s) will be removed`,
      message: `Shrinking columns from ${previousColumns} to ${targetColumns} removes Reel ${targetColumns + 1}${previousColumns > targetColumns + 1 ? `..${previousColumns}` : ""}.`,
      targetId: `reel-${targetColumns + 1}`,
    });
  } else if (targetColumns > previousColumns) {
    for (let idx = previousColumns; idx < targetColumns; idx++) {
      const reelId = `reel-${idx + 1}`;
      const reason = `Reel ${idx + 1} (${reelId}) will be added to populate the ${targetColumns}-column grid.`;
      incompatibleReels.push({
        reelIndex: idx + 1,
        reelId,
        action: "added",
        reason,
      });
    }
  }

  // 3. Check scene layout structures & paytable match counts
  if (previousColumns !== targetColumns) {
    const paytableReason =
      targetColumns < previousColumns
        ? `Paytable match counts above ${targetColumns}-of-a-kind (${targetColumns + 1}..${previousColumns}OAK) exceed the ${targetColumns}-reel grid.`
        : `Paytable will gain ${previousColumns + 1}..${targetColumns}-of-a-kind payout columns for the ${targetColumns}-reel grid.`;
    incompatibleLayouts.push({
      sceneId: "global-paytable",
      sceneName: "Paytable",
      targetId: "paytable",
      targetName: "Paytable Match Tiers",
      kind: "paytable",
      reason: paytableReason,
      detail: paytableReason,
    });
    warnings.push({
      category: "paytable",
      severity: "warning",
      title: `Paytable match tiers affected (${previousColumns} → ${targetColumns} reels)`,
      message: paytableReason,
      targetId: "paytable",
    });
  }

  for (const scene of bp.scenes ?? []) {
    const reelsLayer = (scene.layers ?? bp.layers ?? []).find(
      (l) => l.kind === "reels" || l.type === "reels",
    );
    if (reelsLayer) {
      const reason = `Scene "${scene.name}" reel area layer "${reelsLayer.name}" changes grid cell matrix from ${previousColumns}×${previousRows} to ${targetColumns}×${targetRows}.`;
      incompatibleLayouts.push({
        sceneId: scene.id,
        sceneName: scene.name,
        targetId: reelsLayer.id,
        targetName: reelsLayer.name,
        kind: "layer",
        reason,
        detail: reason,
      });
    }

    for (const obj of scene.objects ?? []) {
      const refEl = (bp.elements ?? []).find((e) => e.id === obj.refId);
      if (refEl?.type === "reel_frame" || refEl?.type === "symbol_set") {
        const reason = `Scene "${scene.name}" object "${obj.name}" (${refEl.type}) was sized for a ${previousColumns}×${previousRows} aspect ratio and may require layout adjustment for ${targetColumns}×${targetRows}.`;
        incompatibleLayouts.push({
          sceneId: scene.id,
          sceneName: scene.name,
          targetId: obj.id,
          targetName: obj.name,
          kind: "object",
          reason,
          detail: reason,
        });
      }
    }
  }

  const sceneLayoutItems = incompatibleLayouts.filter((l) => l.kind !== "paytable");
  if (sceneLayoutItems.length > 0) {
    warnings.push({
      category: "layout",
      severity: "warning",
      title: `${sceneLayoutItems.length} scene layout structure(s) affected by ${previousColumns}×${previousRows} → ${targetColumns}×${targetRows}`,
      message: `Reel matrix and frame geometry across ${(bp.scenes ?? []).map((s) => s.name).join(", ")} change aspect ratio from ${(previousColumns / previousRows).toFixed(2)} to ${(targetColumns / targetRows).toFixed(2)}.`,
      targetId: sceneLayoutItems[0]!.targetId,
    });
  }

  return {
    previousColumns,
    previousRows,
    nextColumns: targetColumns,
    nextRows: targetRows,
    changed: true,
    hasWarnings: warnings.length > 0,
    incompatiblePaylines,
    incompatibleReels,
    incompatibleLayouts,
    sceneLayoutWarnings: sceneLayoutItems,
    waysSummary: { previousWays, nextWays },
    addedColumnsCount: Math.max(0, targetColumns - previousColumns),
    truncatedColumnsCount: Math.max(0, previousColumns - targetColumns),
    warnings,
  };
}

export function changeBlueprintGridSize(
  bp: GameBlueprint,
  nextColumnsOrOptions: number | GridChangeOptions,
  nextRowsArg?: number,
  optionsArg?: { paylineResolution?: GridPaylineResolutionMode },
): { blueprint: GameBlueprint; report: GridSizeChangeDependencyReport } {
  const nextColumns =
    typeof nextColumnsOrOptions === "number"
      ? nextColumnsOrOptions
      : nextColumnsOrOptions.columns;
  const nextRows =
    typeof nextColumnsOrOptions === "number"
      ? (nextRowsArg ?? bp.reels.rows)
      : nextColumnsOrOptions.rows;
  const paylineResolution: GridPaylineResolutionMode =
    typeof nextColumnsOrOptions === "number"
      ? (optionsArg?.paylineResolution ?? "adapt")
      : (nextColumnsOrOptions.paylineResolution ?? "adapt");

  const report = analyzeGridSizeChangeDependencies(bp, nextColumns, nextRows);
  if (!report.changed) {
    return { blueprint: bp, report };
  }

  const targetColumns = report.nextColumns;
  const targetRows = report.nextRows;
  const incompatibleIds = new Set(
    report.incompatiblePaylines.map((pl) => pl.paylineId),
  );

  let migratedPaylines: PaylineDef[] = (bp.paylines ?? []).map((pl) => {
    const nextPattern = Array.from({ length: targetColumns }, (_, colIdx) => {
      const rawRow =
        pl.pattern[colIdx] ?? pl.pattern[pl.pattern.length - 1] ?? 0;
      return Math.max(0, Math.min(targetRows - 1, Math.round(rawRow)));
    });
    return {
      ...pl,
      pattern: nextPattern,
      active:
        paylineResolution === "disable_incompatible" && incompatibleIds.has(pl.id)
          ? false
          : pl.active,
    };
  });

  if (paylineResolution === "regenerate_standard") {
    const presetConfig = applyPaylinePreset(
      {
        ...paylineConfigurationFromBlueprint(bp),
        columns: targetColumns,
        rows: targetRows,
      },
      "20",
    );
    migratedPaylines = presetConfig.paylines.map((pl) => ({
      id: pl.id,
      index: pl.index,
      name: pl.name,
      pattern: [...pl.pattern],
      active: pl.active,
      color: pl.color,
    }));
  }

  const nextPaylineConfig = bp.paylineConfiguration
    ? repairMalformedPaylines({
        ...bp.paylineConfiguration,
        columns: targetColumns,
        rows: targetRows,
        paylines: migratedPaylines.map((pl, idx) => ({
          id: pl.id,
          index: pl.index ?? idx + 1,
          name: pl.name ?? `Payline #${idx + 1}`,
          pattern: [...pl.pattern],
          active: pl.active,
          color: pl.color ?? "#38bdf8",
        })),
      })
    : undefined;

  const rawNext: GameBlueprint = {
    ...bp,
    reels: {
      ...bp.reels,
      columns: targetColumns,
      rows: targetRows,
    },
    paylines: migratedPaylines,
    paylineConfiguration: nextPaylineConfig,
  };

  return {
    blueprint: reconcileBlueprintState(rawNext),
    report,
  };
}

/* -------------------------------------------------------------------------- */
/* 6. Blueprint Import, Schema Validation & Legacy Migration                  */
/* -------------------------------------------------------------------------- */

function isPlainRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Imports a `GameBlueprint` (or `ProjectExportPackage`, or legacy `v0`/partial
 * blueprint), migrates older versions where practical, reconciles all cross-editor
 * state, and validates schema integrity.
 */
export function importAndMigrateBlueprint(
  rawInput: string | unknown,
  options?: { preserveProjectId?: string; preserveFolderPath?: string },
): BlueprintMigrationImportResult {
  let parsed: unknown = rawInput;
  if (typeof rawInput === "string") {
    const trimmed = rawInput.trim();
    if (!trimmed) {
      return {
        ok: false,
        blueprint: null,
        sourceFormat: "invalid",
        migrated: false,
        sourceVersion: null,
        targetVersion: BLUEPRINT_VERSION,
        migratedFromVersion: null,
        migrationsApplied: [],
        migrationLog: [],
        validation: null,
        exportValidation: null,
        errors: ["Blueprint import payload is empty."],
      };
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      return {
        ok: false,
        blueprint: null,
        sourceFormat: "invalid",
        migrated: false,
        sourceVersion: null,
        targetVersion: BLUEPRINT_VERSION,
        migratedFromVersion: null,
        migrationsApplied: [],
        migrationLog: [],
        validation: null,
        exportValidation: null,
        errors: [
          `Invalid JSON syntax: ${err instanceof Error ? err.message : "Failed to parse JSON"}`,
        ],
      };
    }
  }

  if (!isPlainRecord(parsed)) {
    return {
      ok: false,
      blueprint: null,
      sourceFormat: "invalid",
      migrated: false,
      sourceVersion: null,
      targetVersion: BLUEPRINT_VERSION,
      migratedFromVersion: null,
      migrationsApplied: [],
      migrationLog: [],
      validation: null,
      exportValidation: null,
      errors: ["Blueprint import must be a JSON object."],
    };
  }

  const migrationsApplied: string[] = [];
  let sourceFormat: BlueprintMigrationImportResult["sourceFormat"] = "blueprint-v1";

  // Unwrap ProjectExportPackage if present
  let candidate: Record<string, unknown> = parsed;
  if (
    parsed.format === "slot-studio-project-json" ||
    (isPlainRecord(parsed.blueprint) && isPlainRecord(parsed.project))
  ) {
    if (!isPlainRecord(parsed.blueprint)) {
      return {
        ok: false,
        blueprint: null,
        sourceFormat: "project-json",
        migrated: false,
        sourceVersion: null,
        targetVersion: BLUEPRINT_VERSION,
        migratedFromVersion: null,
        migrationsApplied: [],
        migrationLog: [],
        validation: null,
        exportValidation: null,
        errors: ["Project JSON package is missing a valid 'blueprint' object."],
      };
    }
    sourceFormat = "project-json";
    candidate = { ...parsed.blueprint };
    migrationsApplied.push("Unwrapped GameBlueprint from ProjectExportPackage envelope.");
  }

  const rawVersion =
    typeof candidate.version === "number" ? candidate.version : null;

  // Reject future unsupported versions (> BLUEPRINT_VERSION)
  if (rawVersion !== null && rawVersion > BLUEPRINT_VERSION) {
    return {
      ok: false,
      blueprint: null,
      sourceFormat: "invalid",
      migrated: false,
      sourceVersion: rawVersion,
      targetVersion: BLUEPRINT_VERSION,
      migratedFromVersion: rawVersion,
      migrationsApplied: [],
      migrationLog: [],
      validation: null,
      exportValidation: null,
      errors: [
        `Unsupported future blueprint version ${rawVersion} (maximum supported version is ${BLUEPRINT_VERSION}).`,
      ],
    };
  }

  // Detect if candidate is a legacy v0 or unversioned blueprint
  const isLegacyVersion = rawVersion === null || rawVersion < BLUEPRINT_VERSION;
  if (isLegacyVersion && sourceFormat !== "project-json") {
    sourceFormat = "blueprint-legacy";
  }

  // Reject critically corrupted payloads where core fields are explicitly null/invalid primitives
  if (
    candidate.meta === null ||
    candidate.reels === null ||
    candidate.symbols === null ||
    (candidate.meta === undefined &&
      candidate.title === undefined &&
      candidate.symbols === undefined &&
      candidate.reels === undefined)
  ) {
    return {
      ok: false,
      blueprint: null,
      sourceFormat: "invalid",
      migrated: false,
      sourceVersion: rawVersion,
      targetVersion: BLUEPRINT_VERSION,
      migratedFromVersion: rawVersion,
      migrationsApplied: [],
      migrationLog: [],
      validation: null,
      exportValidation: null,
      errors: [
        "Critical schema corruption: Blueprint is missing required core sections (meta, reels, symbols).",
      ],
    };
  }

  // Build baseline factory blueprint for any missing legacy sections
  const rawMeta = isPlainRecord(candidate.meta) ? candidate.meta : {};
  const legacyTitle =
    typeof rawMeta.title === "string" && rawMeta.title.trim()
      ? rawMeta.title.trim()
      : typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : "Imported Slot Project";
  const legacyTheme =
    typeof rawMeta.theme === "string" && rawMeta.theme.trim()
      ? rawMeta.theme.trim()
      : typeof candidate.theme === "string" && candidate.theme.trim()
        ? candidate.theme.trim()
        : "Cosmic";

  const rawReels = isPlainRecord(candidate.reels) ? candidate.reels : {};
  const legacyCols =
    typeof rawReels.columns === "number"
      ? rawReels.columns
      : typeof rawReels.cols === "number"
        ? rawReels.cols
        : 5;
  const legacyRows =
    typeof rawReels.rows === "number" ? rawReels.rows : 3;

  const fallbackBp = createBlueprint({
    id:
      options?.preserveProjectId ??
      (typeof rawMeta.id === "string" && rawMeta.id ? rawMeta.id : "prj-imported"),
    title: legacyTitle,
    theme: legacyTheme,
    columns: Math.max(3, Math.min(8, legacyCols)),
    rows: Math.max(2, Math.min(6, legacyRows)),
  });

  if (isLegacyVersion) {
    migrationsApplied.push(
      `Upgraded blueprint schema version from ${rawVersion ?? "unversioned (v0)"} to v${BLUEPRINT_VERSION}.`,
    );
  }
  if (!isPlainRecord(candidate.meta) && typeof candidate.title === "string") {
    migrationsApplied.push("Migrated root-level title/theme fields into blueprint.meta.");
  }
  if (typeof rawReels.cols === "number" && rawReels.columns === undefined) {
    migrationsApplied.push("Migrated legacy reels.cols field to reels.columns.");
  }
  if (!Array.isArray(candidate.elements)) {
    migrationsApplied.push("Derived missing elements[] hierarchy from symbols and symbolSets.");
  }
  if (!isPlainRecord(candidate.reelConfiguration)) {
    migrationsApplied.push("Constructed F14 reelConfiguration from reels.strips.");
  }
  if (!isPlainRecord(candidate.paylineConfiguration)) {
    migrationsApplied.push("Constructed F15 paylineConfiguration from paylines.");
  }
  if (!isPlainRecord(candidate.paytableConfiguration)) {
    migrationsApplied.push("Constructed F16 paytableConfiguration from symbols and paytable.");
  }

  // Normalize legacy symbols if any lack payouts or reelWeight
  const rawSymbols = Array.isArray(candidate.symbols)
    ? candidate.symbols
    : fallbackBp.symbols;
  const normalizedSymbols: SymbolDef[] = rawSymbols
    .filter(isPlainRecord)
    .map((sym, idx) => {
      const tier =
        sym.tier === "low" ||
        sym.tier === "mid" ||
        sym.tier === "high" ||
        sym.tier === "special"
          ? sym.tier
          : "mid";
      const defaults = defaultSymbolStats(tier, idx);
      return {
        id: typeof sym.id === "string" && sym.id ? sym.id : `sym-legacy-${idx + 1}`,
        code:
          typeof sym.code === "string" && sym.code
            ? sym.code
            : `S${idx + 1}`,
        name:
          typeof sym.name === "string" && sym.name
            ? sym.name
            : `Symbol ${idx + 1}`,
        tier,
        glyph: typeof sym.glyph === "string" && sym.glyph ? sym.glyph : "◆",
        assetId: typeof sym.assetId === "string" ? sym.assetId : null,
        payouts: isPlainRecord(sym.payouts)
          ? (sym.payouts as Record<number, number>)
          : defaults.payouts,
        reelWeight:
          typeof sym.reelWeight === "number" && sym.reelWeight > 0
            ? sym.reelWeight
            : defaults.reelWeight,
        ...(typeof sym.isWild === "boolean" ? { isWild: sym.isWild } : {}),
        ...(typeof sym.isScatter === "boolean" ? { isScatter: sym.isScatter } : {}),
        ...(typeof sym.isBonus === "boolean" ? { isBonus: sym.isBonus } : {}),
        ...(sym.description !== undefined ? { description: String(sym.description) } : {}),
        ...(sym.family !== undefined ? { family: String(sym.family) } : {}),
        ...(sym.mathId !== undefined ? { mathId: String(sym.mathId) } : {}),
        ...(Array.isArray(sym.tags) ? { tags: sym.tags.map(String) } : {}),
        ...(isPlainRecord(sym.image) ? { image: sym.image as unknown as SymbolDef["image"] } : {}),
        ...(Array.isArray(sym.imageHistory) ? { imageHistory: sym.imageHistory as SymbolDef["imageHistory"] } : {}),
        ...(Array.isArray(sym.variants) ? { variants: sym.variants as SymbolDef["variants"] } : {}),
        ...(isPlainRecord(sym.extras)
          ? { extras: sym.extras as Record<string, number | string | boolean> }
          : {}),
      };
    });

  // Merge candidate into a complete GameBlueprint structure
  const mergedBp: GameBlueprint = {
    ...fallbackBp,
    ...(candidate as Partial<GameBlueprint>),
    version: BLUEPRINT_VERSION,
    meta: {
      ...fallbackBp.meta,
      ...(rawMeta as Partial<GameBlueprint["meta"]>),
      id:
        options?.preserveProjectId ??
        (typeof rawMeta.id === "string" && rawMeta.id
          ? rawMeta.id
          : fallbackBp.meta.id),
      title: legacyTitle,
      slug:
        typeof rawMeta.slug === "string" && rawMeta.slug
          ? rawMeta.slug
          : slugify(legacyTitle),
      theme: legacyTheme,
      schemaVersion: BLUEPRINT_VERSION,
      ...(options?.preserveFolderPath !== undefined
        ? { folderPath: options.preserveFolderPath }
        : {}),
    },
    reels: {
      ...fallbackBp.reels,
      ...(rawReels as Partial<GameBlueprint["reels"]>),
      columns: Math.max(3, Math.min(8, legacyCols)),
      rows: Math.max(2, Math.min(6, legacyRows)),
      strips:
        Array.isArray(rawReels.strips) && rawReels.strips.length > 0
          ? (rawReels.strips as string[][])
          : fallbackBp.reels.strips,
    },
    symbols: normalizedSymbols.length > 0 ? normalizedSymbols : fallbackBp.symbols,
    paylines: Array.isArray(candidate.paylines)
      ? (candidate.paylines as PaylineDef[])
      : Array.isArray(candidate.lines)
        ? (candidate.lines as PaylineDef[])
        : fallbackBp.paylines,
    paytable: Array.isArray(candidate.paytable)
      ? (candidate.paytable as PaytableEntry[])
      : fallbackBp.paytable,
  };

  // Run design migration & full cross-editor state reconciliation
  const migrated = reconcileBlueprintState(migrateBlueprint(mergedBp));
  const validation = validateBlueprint(migrated);
  const exportValidation = validateBlueprintForExport(migrated);

  const migratedFlag = isLegacyVersion || migrationsApplied.length > 0;

  if (!validation.integrityOk) {
    return {
      ok: false,
      blueprint: null,
      sourceFormat,
      migrated: migratedFlag,
      sourceVersion: rawVersion ?? 0,
      targetVersion: BLUEPRINT_VERSION,
      migratedFromVersion: rawVersion ?? 0,
      migrationsApplied,
      migrationLog: migrationsApplied,
      validation,
      exportValidation,
      errors: validation.integrityIssues,
    };
  }

  return {
    ok: true,
    blueprint: migrated,
    sourceFormat,
    migrated: migratedFlag,
    sourceVersion: rawVersion ?? 0,
    targetVersion: BLUEPRINT_VERSION,
    migratedFromVersion: rawVersion ?? 0,
    migrationsApplied,
    migrationLog: migrationsApplied,
    validation,
    exportValidation,
    errors: [],
  };
}
