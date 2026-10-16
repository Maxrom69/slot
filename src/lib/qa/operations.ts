import { createBlueprint } from "@/lib/blueprint/factory";
import type {
  GameBlueprint,
  PaylineDef,
  PaytableEntry,
  ReelStripDef,
  SceneDef,
  SceneObject,
  SymbolDef,
  SymbolTier,
} from "@/lib/blueprint/types";
import {
  createGroup,
  moveObjects,
  objectsInMarquee,
  patchObjects,
  reorderObjects,
  rotateObjects,
  scaleObjects,
  ungroup,
} from "@/lib/canvas/operations";
import { applyDesign, designDocFromBlueprint } from "@/lib/design/migrate";
import { addElement, addSymbols } from "@/lib/design/operations";
import { exportBlueprintJson } from "@/lib/export/operations";
import { importAndMigrateBlueprint, reconcileBlueprintState } from "@/lib/integration/operations";
import { reorderStopInReel } from "@/lib/reels/operations";
import type {
  DataQaAuditReport,
  DataQaCategory,
  DataQaCheckSummary,
  DataQaIssue,
  DataQaSanitizeResult,
  PerformanceBenchmarkResult,
  Section2EngineContractReport,
  StudioPerformanceReport,
} from "./types";

const VALID_SYMBOL_TIERS: ReadonlySet<SymbolTier> = new Set([
  "low",
  "mid",
  "high",
  "special",
]);

const VALID_SCENE_KINDS = new Set([
  "intro",
  "base",
  "freespins",
  "bonus",
  "outro",
]);

function makeCheckSummary(
  id: DataQaCategory,
  label: string,
  issues: DataQaIssue[],
): DataQaCheckSummary {
  const matching = issues.filter((issue) => issue.category === id);
  const errorCount = matching.filter((issue) => issue.severity === "error").length;
  return {
    id,
    label,
    passed: errorCount === 0,
    issueCount: matching.length,
    issues: matching,
  };
}

/**
 * Performs the full F22 7-point Data QA audit on a GameBlueprint:
 * 1. noDuplicateIds
 * 2. noOrphanedReferences
 * 3. noCorruptedScenes
 * 4. noInvalidSymbols
 * 5. noInvalidReelStops
 * 6. noMalformedPaylines
 * 7. noMalformedPaytableValues
 */
export function auditBlueprintDataIntegrity(bp: GameBlueprint): DataQaAuditReport {
  const issues: DataQaIssue[] = [];

  // -------------------------------------------------------------------------
  // 1. Check for duplicate IDs across every collection
  // -------------------------------------------------------------------------
  const checkDuplicateCollection = (
    items: ReadonlyArray<{ id?: string }>,
    collectionLabel: string,
    pathPrefix: string,
  ) => {
    const seen = new Set<string>();
    items.forEach((item, idx) => {
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      if (!id) {
        issues.push({
          category: "noDuplicateIds",
          severity: "error",
          path: `${pathPrefix}[${idx}].id`,
          message: `${collectionLabel} at index ${idx} has an empty or missing ID.`,
        });
        return;
      }
      if (seen.has(id)) {
        issues.push({
          category: "noDuplicateIds",
          severity: "error",
          path: `${pathPrefix}[${idx}].id`,
          entityId: id,
          message: `Duplicate ${collectionLabel} ID "${id}" at index ${idx}.`,
        });
      } else {
        seen.add(id);
      }
    });
  };

  checkDuplicateCollection(bp.symbols ?? [], "symbol", "symbols");
  checkDuplicateCollection(bp.symbolSets ?? [], "symbolSet", "symbolSets");
  checkDuplicateCollection(bp.specialSymbols ?? [], "specialSymbol", "specialSymbols");
  checkDuplicateCollection(bp.elements ?? [], "element", "elements");
  checkDuplicateCollection(bp.assets ?? [], "asset", "assets");
  checkDuplicateCollection(bp.layers ?? [], "layer", "layers");
  checkDuplicateCollection(bp.scenes ?? [], "scene", "scenes");
  checkDuplicateCollection(bp.paylines ?? [], "payline", "paylines");
  checkDuplicateCollection(bp.animations ?? [], "animation", "animations");
  checkDuplicateCollection(bp.features ?? [], "feature", "features");

  if (bp.reelConfiguration?.reels) {
    checkDuplicateCollection(
      bp.reelConfiguration.reels,
      "reelConfiguration.reel",
      "reelConfiguration.reels",
    );
    const seenStopIds = new Set<string>();
    bp.reelConfiguration.reels.forEach((reel, rIdx) => {
      (reel.stops ?? []).forEach((stop, sIdx) => {
        if (!stop.id || !stop.id.trim()) {
          issues.push({
            category: "noDuplicateIds",
            severity: "error",
            path: `reelConfiguration.reels[${rIdx}].stops[${sIdx}].id`,
            message: `Reel stop at reel ${rIdx + 1}, stop ${sIdx + 1} is missing an ID.`,
          });
        } else if (seenStopIds.has(stop.id)) {
          issues.push({
            category: "noDuplicateIds",
            severity: "error",
            path: `reelConfiguration.reels[${rIdx}].stops[${sIdx}].id`,
            entityId: stop.id,
            message: `Duplicate reel stop ID "${stop.id}" across reel configuration.`,
          });
        } else {
          seenStopIds.add(stop.id);
        }
      });
    });
  }

  (bp.scenes ?? []).forEach((scene, scIdx) => {
    checkDuplicateCollection(
      scene.objects ?? [],
      `scene("${scene.name}").object`,
      `scenes[${scIdx}].objects`,
    );
    if (scene.layers && scene.layers.length > 0) {
      checkDuplicateCollection(
        scene.layers,
        `scene("${scene.name}").layer`,
        `scenes[${scIdx}].layers`,
      );
    }
  });

  // -------------------------------------------------------------------------
  // Build lookup sets for relational reference checks
  // -------------------------------------------------------------------------
  const symbolIds = new Set((bp.symbols ?? []).map((s) => s.id).filter(Boolean));
  const symbolSetIds = new Set((bp.symbolSets ?? []).map((s) => s.id).filter(Boolean));
  const elementIds = new Set((bp.elements ?? []).map((e) => e.id).filter(Boolean));
  const assetIds = new Set((bp.assets ?? []).map((a) => a.id).filter(Boolean));
  const layerIds = new Set((bp.layers ?? []).map((l) => l.id).filter(Boolean));
  const animationIds = new Set((bp.animations ?? []).map((a) => a.id).filter(Boolean));

  // -------------------------------------------------------------------------
  // 2. Check for orphaned references across blueprint entities
  // -------------------------------------------------------------------------
  (bp.symbols ?? []).forEach((sym, idx) => {
    if (sym.assetId && !assetIds.has(sym.assetId)) {
      issues.push({
        category: "noOrphanedReferences",
        severity: "error",
        path: `symbols[${idx}].assetId`,
        entityId: sym.id,
        message: `Symbol "${sym.name}" (${sym.id}) references non-existent asset "${sym.assetId}".`,
      });
    }
    if (
      sym.symbolSetId &&
      !symbolSetIds.has(sym.symbolSetId) &&
      !elementIds.has(sym.symbolSetId) &&
      !elementIds.has(`el-set-${sym.symbolSetId}`)
    ) {
      issues.push({
        category: "noOrphanedReferences",
        severity: "error",
        path: `symbols[${idx}].symbolSetId`,
        entityId: sym.id,
        message: `Symbol "${sym.name}" (${sym.id}) references missing symbolSetId "${sym.symbolSetId}".`,
      });
    }
  });

  (bp.symbolSets ?? []).forEach((set, idx) => {
    (set.symbolIds ?? []).forEach((sid, sIdx) => {
      if (!symbolIds.has(sid)) {
        issues.push({
          category: "noOrphanedReferences",
          severity: "error",
          path: `symbolSets[${idx}].symbolIds[${sIdx}]`,
          entityId: set.id,
          message: `Symbol set "${set.name}" (${set.id}) references missing symbol "${sid}".`,
        });
      }
    });
  });

  (bp.elements ?? []).forEach((el, idx) => {
    if (el.assetId && !assetIds.has(el.assetId)) {
      issues.push({
        category: "noOrphanedReferences",
        severity: "error",
        path: `elements[${idx}].assetId`,
        entityId: el.id,
        message: `Element "${el.name}" (${el.id}) references non-existent asset "${el.assetId}".`,
      });
    }
    (el.symbolIds ?? []).forEach((sid, sIdx) => {
      if (!symbolIds.has(sid)) {
        issues.push({
          category: "noOrphanedReferences",
          severity: "error",
          path: `elements[${idx}].symbolIds[${sIdx}]`,
          entityId: el.id,
          message: `Element "${el.name}" (${el.id}) references missing symbol "${sid}".`,
        });
      }
    });
  });

  (bp.animations ?? []).forEach((anim, idx) => {
    if (
      anim.target &&
      !layerIds.has(anim.target) &&
      !symbolIds.has(anim.target) &&
      !elementIds.has(anim.target)
    ) {
      issues.push({
        category: "noOrphanedReferences",
        severity: "error",
        path: `animations[${idx}].target`,
        entityId: anim.id,
        message: `Animation "${anim.id}" targets unknown layer/symbol/element "${anim.target}".`,
      });
    }
    if (anim.elementId && !elementIds.has(anim.elementId) && !symbolIds.has(anim.elementId)) {
      issues.push({
        category: "noOrphanedReferences",
        severity: "error",
        path: `animations[${idx}].elementId`,
        entityId: anim.id,
        message: `Animation "${anim.id}" references missing elementId "${anim.elementId}".`,
      });
    }
    if (anim.videoReference?.assetId && !assetIds.has(anim.videoReference.assetId)) {
      issues.push({
        category: "noOrphanedReferences",
        severity: "error",
        path: `animations[${idx}].videoReference.assetId`,
        entityId: anim.id,
        message: `Animation "${anim.id}" videoReference points to missing asset "${anim.videoReference.assetId}".`,
      });
    }
    if (anim.spriteSheetReference?.assetId && !assetIds.has(anim.spriteSheetReference.assetId)) {
      issues.push({
        category: "noOrphanedReferences",
        severity: "error",
        path: `animations[${idx}].spriteSheetReference.assetId`,
        entityId: anim.id,
        message: `Animation "${anim.id}" spriteSheetReference points to missing asset "${anim.spriteSheetReference.assetId}".`,
      });
    }
  });

  // -------------------------------------------------------------------------
  // 3. Check for corrupted scenes (invalid dimensions, invalid objects, orphaned scene refs)
  // -------------------------------------------------------------------------
  if (!Array.isArray(bp.scenes) || bp.scenes.length === 0) {
    issues.push({
      category: "noCorruptedScenes",
      severity: "error",
      path: "scenes",
      message: "Blueprint must define at least one scene.",
    });
  } else {
    bp.scenes.forEach((scene: SceneDef, scIdx: number) => {
      if (!scene.name || !scene.name.trim()) {
        issues.push({
          category: "noCorruptedScenes",
          severity: "error",
          path: `scenes[${scIdx}].name`,
          entityId: scene.id,
          message: `Scene at index ${scIdx} has an empty name.`,
        });
      }
      if (!VALID_SCENE_KINDS.has(scene.kind)) {
        issues.push({
          category: "noCorruptedScenes",
          severity: "error",
          path: `scenes[${scIdx}].kind`,
          entityId: scene.id,
          message: `Scene "${scene.name}" has unsupported kind "${String(scene.kind)}".`,
        });
      }
      const sceneLayerIds = new Set([
        ...layerIds,
        ...(scene.layers ?? []).map((l) => l.id),
      ]);
      (scene.layerIds ?? []).forEach((lid, lIdx) => {
        if (!sceneLayerIds.has(lid)) {
          issues.push({
            category: "noOrphanedReferences",
            severity: "error",
            path: `scenes[${scIdx}].layerIds[${lIdx}]`,
            entityId: scene.id,
            message: `Scene "${scene.name}" references non-existent layerId "${lid}".`,
          });
        }
      });

      if (scene.canvasConfiguration) {
        const { width, height } = scene.canvasConfiguration;
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
          issues.push({
            category: "noCorruptedScenes",
            severity: "error",
            path: `scenes[${scIdx}].canvasConfiguration`,
            entityId: scene.id,
            message: `Scene "${scene.name}" has invalid canvasConfiguration dimensions (${width}×${height}).`,
          });
        }
      }

      if (!Array.isArray(scene.objects)) {
        issues.push({
          category: "noCorruptedScenes",
          severity: "error",
          path: `scenes[${scIdx}].objects`,
          entityId: scene.id,
          message: `Scene "${scene.name}" objects property is not an array.`,
        });
      } else {
        scene.objects.forEach((obj: SceneObject, oIdx: number) => {
          const validRef =
            !obj.refId ||
            elementIds.has(obj.refId) ||
            symbolIds.has(obj.refId) ||
            symbolSetIds.has(obj.refId) ||
            animationIds.has(obj.refId);
          if (!validRef) {
            issues.push({
              category: "noOrphanedReferences",
              severity: "error",
              path: `scenes[${scIdx}].objects[${oIdx}].refId`,
              entityId: obj.id,
              message: `Scene object "${obj.name}" (${obj.id}) in "${scene.name}" references missing refId "${obj.refId}".`,
            });
          }
          if (obj.layerId && !sceneLayerIds.has(obj.layerId)) {
            issues.push({
              category: "noOrphanedReferences",
              severity: "error",
              path: `scenes[${scIdx}].objects[${oIdx}].layerId`,
              entityId: obj.id,
              message: `Scene object "${obj.name}" (${obj.id}) in "${scene.name}" references missing layerId "${obj.layerId}".`,
            });
          }
          if (obj.assetId && !assetIds.has(obj.assetId)) {
            issues.push({
              category: "noOrphanedReferences",
              severity: "error",
              path: `scenes[${scIdx}].objects[${oIdx}].assetId`,
              entityId: obj.id,
              message: `Scene object "${obj.name}" (${obj.id}) in "${scene.name}" references missing assetId "${obj.assetId}".`,
            });
          }
          if (
            !Number.isFinite(obj.x) ||
            !Number.isFinite(obj.y) ||
            !Number.isFinite(obj.width) ||
            !Number.isFinite(obj.height) ||
            obj.width <= 0 ||
            obj.height <= 0 ||
            !Number.isFinite(obj.rotation) ||
            !Number.isFinite(obj.opacity) ||
            obj.opacity < 0 ||
            obj.opacity > 1
          ) {
            issues.push({
              category: "noCorruptedScenes",
              severity: "error",
              path: `scenes[${scIdx}].objects[${oIdx}]`,
              entityId: obj.id,
              message: `Scene object "${obj.name}" (${obj.id}) in "${scene.name}" has corrupted geometry or opacity values.`,
            });
          }
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // 4. Check for invalid symbols
  // -------------------------------------------------------------------------
  if (!Array.isArray(bp.symbols) || bp.symbols.length === 0) {
    issues.push({
      category: "noInvalidSymbols",
      severity: "error",
      path: "symbols",
      message: "Blueprint must define at least one symbol.",
    });
  } else {
    bp.symbols.forEach((sym: SymbolDef, idx: number) => {
      if (!sym.name || !sym.name.trim()) {
        issues.push({
          category: "noInvalidSymbols",
          severity: "error",
          path: `symbols[${idx}].name`,
          entityId: sym.id,
          message: `Symbol at index ${idx} (${sym.id}) has an empty name.`,
        });
      }
      if (!sym.code || !sym.code.trim()) {
        issues.push({
          category: "noInvalidSymbols",
          severity: "error",
          path: `symbols[${idx}].code`,
          entityId: sym.id,
          message: `Symbol "${sym.name}" (${sym.id}) has an empty code.`,
        });
      }
      if (!VALID_SYMBOL_TIERS.has(sym.tier)) {
        issues.push({
          category: "noInvalidSymbols",
          severity: "error",
          path: `symbols[${idx}].tier`,
          entityId: sym.id,
          message: `Symbol "${sym.name}" (${sym.id}) has invalid tier "${String(sym.tier)}".`,
        });
      }
      if (!Number.isFinite(sym.reelWeight) || sym.reelWeight <= 0) {
        issues.push({
          category: "noInvalidSymbols",
          severity: "error",
          path: `symbols[${idx}].reelWeight`,
          entityId: sym.id,
          message: `Symbol "${sym.name}" (${sym.id}) has non-positive or non-finite reelWeight (${String(sym.reelWeight)}).`,
        });
      }
    });
  }

  (bp.specialSymbols ?? []).forEach((sp, spIdx) => {
    if (!symbolIds.has(sp.symbolId)) {
      issues.push({
        category: "noOrphanedReferences",
        severity: "error",
        path: `specialSymbols[${spIdx}].symbolId`,
        entityId: sp.id,
        message: `specialSymbols[${spIdx}] (${sp.behaviour}) references missing symbol "${sp.symbolId}".`,
      });
    }
  });

  // -------------------------------------------------------------------------
  // 5. Check for invalid reel stops
  // -------------------------------------------------------------------------
  const cols = bp.reels?.columns ?? 0;
  const rows = bp.reels?.rows ?? 0;
  if (!Number.isInteger(cols) || cols < 3 || cols > 8 || !Number.isInteger(rows) || rows < 2 || rows > 6) {
    issues.push({
      category: "noInvalidReelStops",
      severity: "error",
      path: "reels",
      message: `Invalid reel grid dimensions (${cols}×${rows}). Expected columns 3..8 and rows 2..6.`,
    });
  }

  const strips = bp.reels?.strips ?? [];
  if (strips.length !== cols) {
    issues.push({
      category: "noInvalidReelStops",
      severity: "error",
      path: "reels.strips",
      message: `Reel strip count (${strips.length}) does not match reels.columns (${cols}).`,
    });
  }
  strips.forEach((strip, rIdx) => {
    if (!Array.isArray(strip) || strip.length < rows) {
      issues.push({
        category: "noInvalidReelStops",
        severity: "error",
        path: `reels.strips[${rIdx}]`,
        message: `Reel strip ${rIdx + 1} has ${strip?.length ?? 0} stops, fewer than rows (${rows}).`,
      });
      return;
    }
    strip.forEach((sid, sIdx) => {
      if (!sid || !symbolIds.has(sid)) {
        issues.push({
          category: "noInvalidReelStops",
          severity: "error",
          path: `reels.strips[${rIdx}][${sIdx}]`,
          message: `Reel ${rIdx + 1} stop ${sIdx + 1} references unknown symbol "${String(sid)}".`,
        });
      }
    });
  });

  if (bp.reelConfiguration) {
    if (bp.reelConfiguration.columns !== cols || bp.reelConfiguration.rows !== rows) {
      issues.push({
        category: "noInvalidReelStops",
        severity: "error",
        path: "reelConfiguration",
        message: `reelConfiguration dimensions (${bp.reelConfiguration.columns}×${bp.reelConfiguration.rows}) are out of sync with reels (${cols}×${rows}).`,
      });
    }
    (bp.reelConfiguration.reels ?? []).forEach((reel: ReelStripDef, rIdx: number) => {
      if (!Array.isArray(reel.stops) || reel.stops.length < rows) {
        issues.push({
          category: "noInvalidReelStops",
          severity: "error",
          path: `reelConfiguration.reels[${rIdx}].stops`,
          entityId: reel.id,
          message: `Configured reel ${rIdx + 1} has fewer stops (${reel.stops?.length ?? 0}) than rows (${rows}).`,
        });
      }
      (reel.stops ?? []).forEach((stop, sIdx) => {
        if (!stop.symbolId || !symbolIds.has(stop.symbolId)) {
          issues.push({
            category: "noInvalidReelStops",
            severity: "error",
            path: `reelConfiguration.reels[${rIdx}].stops[${sIdx}].symbolId`,
            entityId: stop.id,
            message: `Configured reel ${rIdx + 1} stop ${sIdx + 1} references unknown symbol "${String(stop.symbolId)}".`,
          });
        }
        const weight = stop.weight ?? 1;
        if (!Number.isFinite(weight) || weight <= 0) {
          issues.push({
            category: "noInvalidReelStops",
            severity: "error",
            path: `reelConfiguration.reels[${rIdx}].stops[${sIdx}].weight`,
            entityId: stop.id,
            message: `Configured reel ${rIdx + 1} stop ${sIdx + 1} has invalid weight (${String(stop.weight)}).`,
          });
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // 6. Check for malformed paylines
  // -------------------------------------------------------------------------
  (bp.paylines ?? []).forEach((line: PaylineDef, pIdx: number) => {
    if (!Array.isArray(line.pattern) || line.pattern.length !== cols) {
      issues.push({
        category: "noMalformedPaylines",
        severity: "error",
        path: `paylines[${pIdx}].pattern`,
        entityId: line.id,
        message: `Payline "${line.name ?? line.id}" has ${line.pattern?.length ?? 0} pattern stops; expected ${cols}.`,
      });
      return;
    }
    line.pattern.forEach((r, cIdx) => {
      if (!Number.isInteger(r) || r < 0 || r >= rows) {
        issues.push({
          category: "noMalformedPaylines",
          severity: "error",
          path: `paylines[${pIdx}].pattern[${cIdx}]`,
          entityId: line.id,
          message: `Payline "${line.name ?? line.id}" column ${cIdx + 1} row index ${String(r)} is out of bounds (0..${rows - 1}).`,
        });
      }
    });
  });

  if (bp.paylineConfiguration) {
    (bp.paylineConfiguration.paylines ?? []).forEach((pl, pIdx) => {
      if (!Array.isArray(pl.pattern) || pl.pattern.length !== cols) {
        issues.push({
          category: "noMalformedPaylines",
          severity: "error",
          path: `paylineConfiguration.paylines[${pIdx}].pattern`,
          entityId: pl.id,
          message: `Configured payline "${pl.name ?? pl.id}" has ${pl.pattern?.length ?? 0} stops; expected ${cols}.`,
        });
        return;
      }
      pl.pattern.forEach((r, cIdx) => {
        if (!Number.isInteger(r) || r < 0 || r >= rows) {
          issues.push({
            category: "noMalformedPaylines",
            severity: "error",
            path: `paylineConfiguration.paylines[${pIdx}].pattern[${cIdx}]`,
            entityId: pl.id,
            message: `Configured payline "${pl.name ?? pl.id}" column ${cIdx + 1} stop ${String(r)} is out of bounds (0..${rows - 1}).`,
          });
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // 7. Check for malformed paytable values
  // -------------------------------------------------------------------------
  const entries: PaytableEntry[] = Array.isArray(bp.paytable) ? bp.paytable : [];
  if (entries.length === 0) {
    issues.push({
      category: "noMalformedPaytableValues",
      severity: "error",
      path: "paytable",
      message: "Paytable has no entries.",
    });
  } else {
    entries.forEach((entry: PaytableEntry, eIdx: number) => {
      if (!entry.symbolId || !symbolIds.has(entry.symbolId)) {
        issues.push({
          category: "noMalformedPaytableValues",
          severity: "error",
          path: `paytable[${eIdx}].symbolId`,
          message: `Paytable entry ${eIdx} references unknown symbol "${String(entry.symbolId)}".`,
        });
      }
      if (!Number.isInteger(entry.ofAKind) || entry.ofAKind < 1 || entry.ofAKind > cols) {
        issues.push({
          category: "noMalformedPaytableValues",
          severity: "error",
          path: `paytable[${eIdx}].ofAKind`,
          entityId: entry.symbolId,
          message: `Paytable entry for "${entry.symbolId}" has invalid match count (${String(entry.ofAKind)}).`,
        });
      }
      if (!Number.isFinite(entry.payout) || entry.payout < 0) {
        issues.push({
          category: "noMalformedPaytableValues",
          severity: "error",
          path: `paytable[${eIdx}].payout`,
          entityId: entry.symbolId,
          message: `Paytable entry for "${entry.symbolId}" (${entry.ofAKind}-of-a-kind) has invalid payout (${String(entry.payout)}).`,
        });
      }
    });
  }

  if (bp.paytableConfiguration?.symbolRows) {
    bp.paytableConfiguration.symbolRows.forEach((row, rIdx) => {
      if (!symbolIds.has(row.symbolId)) {
        issues.push({
          category: "noMalformedPaytableValues",
          severity: "error",
          path: `paytableConfiguration.symbolRows[${rIdx}].symbolId`,
          message: `Paytable row ${rIdx} references unknown symbol "${row.symbolId}".`,
        });
      }
      Object.entries(row.payouts ?? {}).forEach(([countKey, val]) => {
        if (!Number.isFinite(val) || val < 0) {
          issues.push({
            category: "noMalformedPaytableValues",
            severity: "error",
            path: `paytableConfiguration.symbolRows[${rIdx}].payouts["${countKey}"]`,
            entityId: row.symbolId,
            message: `Paytable row "${row.name}" has negative or non-finite payout (${String(val)}) for count ${countKey}.`,
          });
        }
      });
    });
  }

  const checks: Record<DataQaCategory, DataQaCheckSummary> = {
    noDuplicateIds: makeCheckSummary("noDuplicateIds", "No Duplicate IDs", issues),
    noOrphanedReferences: makeCheckSummary(
      "noOrphanedReferences",
      "No Orphaned References",
      issues,
    ),
    noCorruptedScenes: makeCheckSummary("noCorruptedScenes", "No Corrupted Scenes", issues),
    noInvalidSymbols: makeCheckSummary("noInvalidSymbols", "No Invalid Symbols", issues),
    noInvalidReelStops: makeCheckSummary("noInvalidReelStops", "No Invalid Reel Stops", issues),
    noMalformedPaylines: makeCheckSummary(
      "noMalformedPaylines",
      "No Malformed Paylines",
      issues,
    ),
    noMalformedPaytableValues: makeCheckSummary(
      "noMalformedPaytableValues",
      "No Malformed Paytable Values",
      issues,
    ),
  };

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const passedCategories = Object.values(checks).filter((c) => c.passed).length;

  return {
    valid: errorCount === 0,
    totalIssues: issues.length,
    errorCount,
    warningCount,
    checks,
    issues,
    summary:
      errorCount === 0
        ? `All 7 Data QA checks passed (0 errors, ${warningCount} warnings).`
        : `${passedCategories}/7 Data QA checks passed (${errorCount} errors, ${warningCount} warnings).`,
  };
}

/**
 * Deterministically repairs any Data QA issues in a GameBlueprint (deduplicating IDs,
 * pruning/repairing orphaned references, normalizing corrupted scenes/objects, fixing
 * invalid symbols/stops/paylines/paytable multipliers) and runs reconcileBlueprintState.
 */
export function sanitizeBlueprintDataIntegrity(bp: GameBlueprint): DataQaSanitizeResult {
  const next: GameBlueprint = structuredClone(bp);
  const repairedIssues: string[] = [];

  const deduplicateIds = <T extends { id: string }>(
    items: T[],
    prefix: string,
    collectionName: string,
  ): T[] => {
    const seen = new Set<string>();
    return items.map((item, idx) => {
      let id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id) {
        id = `${prefix}-${idx + 1}`;
        repairedIssues.push(`Assigned missing ${collectionName} ID "${id}" at index ${idx}.`);
      } else if (seen.has(id)) {
        let suffix = 2;
        while (seen.has(`${id}-${suffix}`)) suffix++;
        const nextId = `${id}-${suffix}`;
        repairedIssues.push(
          `Renamed duplicate ${collectionName} ID "${id}" to "${nextId}" at index ${idx}.`,
        );
        id = nextId;
      }
      seen.add(id);
      return id === item.id ? item : { ...item, id };
    });
  };

  next.assets = deduplicateIds(next.assets ?? [], "asset", "asset");
  next.layers = deduplicateIds(next.layers ?? [], "layer", "layer");
  next.symbolSets = deduplicateIds(next.symbolSets ?? [], "set", "symbolSet");
  next.symbols = deduplicateIds(next.symbols ?? [], "sym", "symbol");
  next.specialSymbols = deduplicateIds(next.specialSymbols ?? [], "special", "specialSymbol");
  next.elements = deduplicateIds(next.elements ?? [], "el", "element");
  next.scenes = deduplicateIds(next.scenes ?? [], "scene", "scene");
  next.paylines = deduplicateIds(next.paylines ?? [], "line", "payline");
  next.animations = deduplicateIds(next.animations ?? [], "anim", "animation");
  next.features = deduplicateIds(next.features ?? [], "feat", "feature");

  // Repair symbols
  if (next.symbols.length === 0) {
    const fallback = createBlueprint({
      id: next.meta?.id || "proj-fallback",
      title: next.meta?.title || "Fallback Slot",
      theme: next.meta?.theme || "Classic",
    });
    next.symbols = fallback.symbols;
    repairedIssues.push("Restored default symbols because symbol list was empty.");
  }

  const assetIds = new Set(next.assets.map((a) => a.id));
  const symbolSetIds = new Set(next.symbolSets.map((s) => s.id));
  const elementIds = new Set(next.elements.map((e) => e.id));

  next.symbols = next.symbols.map((sym, idx) => {
    const updated = { ...sym };
    if (!updated.name || !updated.name.trim()) {
      updated.name = `Symbol ${idx + 1}`;
      repairedIssues.push(`Repaired empty name on symbol "${updated.id}".`);
    }
    if (!updated.code || !updated.code.trim()) {
      updated.code = `S${idx + 1}`;
      repairedIssues.push(`Repaired empty code on symbol "${updated.id}".`);
    }
    if (!VALID_SYMBOL_TIERS.has(updated.tier)) {
      updated.tier = "low";
      repairedIssues.push(`Reset invalid tier on symbol "${updated.id}" to "low".`);
    }
    if (!Number.isFinite(updated.reelWeight) || updated.reelWeight <= 0) {
      updated.reelWeight = 10;
      repairedIssues.push(`Reset non-positive reelWeight on symbol "${updated.id}" to 10.`);
    }
    if (updated.assetId && !assetIds.has(updated.assetId)) {
      repairedIssues.push(
        `Cleared orphaned assetId "${updated.assetId}" on symbol "${updated.id}".`,
      );
      updated.assetId = null;
    }
    if (
      updated.symbolSetId &&
      !symbolSetIds.has(updated.symbolSetId) &&
      !elementIds.has(updated.symbolSetId) &&
      !elementIds.has(`el-set-${updated.symbolSetId}`)
    ) {
      const fallbackSetId = next.symbolSets[0]?.id ?? null;
      repairedIssues.push(
        `Re-linked orphaned symbolSetId "${updated.symbolSetId}" on symbol "${updated.id}".`,
      );
      updated.symbolSetId = fallbackSetId;
    }
    return updated;
  });

  const symbolIds = new Set(next.symbols.map((s) => s.id));
  const fallbackSymbolId = next.symbols[0].id;

  // Repair symbol sets & elements orphaned symbolIds/assetIds
  next.symbolSets = next.symbolSets.map((set) => {
    const filtered = (set.symbolIds ?? []).filter((sid) => symbolIds.has(sid));
    if (filtered.length !== (set.symbolIds ?? []).length) {
      repairedIssues.push(`Pruned orphaned symbolIds from symbolSet "${set.id}".`);
    }
    return { ...set, symbolIds: filtered };
  });

  next.elements = next.elements.map((el) => {
    const updated = { ...el };
    if (updated.assetId && !assetIds.has(updated.assetId)) {
      repairedIssues.push(
        `Cleared orphaned assetId "${updated.assetId}" on element "${updated.id}".`,
      );
      updated.assetId = null;
    }
    if (Array.isArray(updated.symbolIds)) {
      const filtered = updated.symbolIds.filter((sid) => symbolIds.has(sid));
      if (filtered.length !== updated.symbolIds.length) {
        repairedIssues.push(`Pruned orphaned symbolIds from element "${updated.id}".`);
        updated.symbolIds = filtered;
      }
    }
    return updated;
  });

  next.specialSymbols = (next.specialSymbols ?? []).filter((sp) => {
    if (!symbolIds.has(sp.symbolId)) {
      repairedIssues.push(
        `Removed specialSymbol "${sp.id}" referencing missing symbol "${sp.symbolId}".`,
      );
      return false;
    }
    return true;
  });

  // Repair reel stops & reelConfiguration
  const cols = Math.min(8, Math.max(3, Math.round(next.reels?.columns || 5)));
  const rows = Math.min(6, Math.max(2, Math.round(next.reels?.rows || 3)));
  next.reels = {
    ...next.reels,
    columns: cols,
    rows,
  };

  if (next.reelConfiguration) {
    next.reelConfiguration.columns = cols;
    next.reelConfiguration.rows = rows;
    const seenStopIds = new Set<string>();
    next.reelConfiguration.reels = (next.reelConfiguration.reels ?? []).map((reel, rIdx) => {
      const rawStops = Array.isArray(reel.stops) && reel.stops.length >= rows
        ? reel.stops
        : Array.from({ length: Math.max(rows, 10) }, (_, sIdx) => ({
            id: `r${rIdx + 1}-s${sIdx + 1}`,
            position: sIdx + 1,
            symbolId: next.symbols[sIdx % next.symbols.length].id,
            weight: 1,
          }));
      const stops = rawStops.map((st, sIdx) => {
        let stopId = st.id && st.id.trim() ? st.id.trim() : `r${rIdx + 1}-s${sIdx + 1}`;
        if (seenStopIds.has(stopId)) {
          let suffix = 2;
          while (seenStopIds.has(`${stopId}-${suffix}`)) suffix++;
          stopId = `${stopId}-${suffix}`;
          repairedIssues.push(`Deduplicated reel stop ID to "${stopId}".`);
        }
        seenStopIds.add(stopId);
        const validSym = symbolIds.has(st.symbolId) ? st.symbolId : fallbackSymbolId;
        if (validSym !== st.symbolId) {
          repairedIssues.push(
            `Replaced unknown symbol "${st.symbolId}" at reel ${rIdx + 1} stop ${sIdx + 1} with "${validSym}".`,
          );
        }
        const stWeight = st.weight ?? 1;
        const validWeight = Number.isFinite(stWeight) && stWeight > 0 ? stWeight : 1;
        if (validWeight !== stWeight) {
          repairedIssues.push(`Reset invalid weight at reel ${rIdx + 1} stop ${sIdx + 1} to 1.`);
        }
        return {
          ...st,
          id: stopId,
          position: sIdx + 1,
          symbolId: validSym,
          weight: validWeight,
        };
      });
      return {
        ...reel,
        id: reel.id || `reel-${rIdx + 1}`,
        index: rIdx,
        name: reel.name || `Reel ${rIdx + 1}`,
        stops,
      };
    });
  }

  next.reels.strips = Array.from({ length: cols }, (_, rIdx) => {
    const existing = next.reels.strips?.[rIdx];
    const rawStops =
      Array.isArray(existing) && existing.length >= rows
        ? existing
        : Array.from(
            { length: Math.max(rows, 12) },
            (__, sIdx) => next.symbols[sIdx % next.symbols.length].id,
          );
    return rawStops.map((sid) => {
      if (!symbolIds.has(sid)) {
        repairedIssues.push(`Replaced invalid symbol "${sid}" in strip ${rIdx + 1}.`);
        return fallbackSymbolId;
      }
      return sid;
    });
  });

  // Repair paylines
  next.paylines = (next.paylines ?? []).map((line, pIdx) => {
    const rawPattern = Array.isArray(line.pattern) ? line.pattern : [];
    const repairedPattern = Array.from({ length: cols }, (_, cIdx) => {
      const r = rawPattern[cIdx];
      return Number.isInteger(r) && r >= 0 && r < rows ? r : pIdx % rows;
    });
    if (
      rawPattern.length !== cols ||
      repairedPattern.some((r, idx) => r !== rawPattern[idx])
    ) {
      repairedIssues.push(`Repaired malformed payline "${line.id}" to match ${cols}×${rows} grid.`);
    }
    return {
      ...line,
      pattern: repairedPattern,
    };
  });

  if (next.paylineConfiguration) {
    next.paylineConfiguration.columns = cols;
    next.paylineConfiguration.rows = rows;
    next.paylineConfiguration.paylines = (next.paylineConfiguration.paylines ?? []).map(
      (pl, pIdx) => {
        const rawPattern = Array.isArray(pl.pattern) ? pl.pattern : [];
        const repairedPattern = Array.from({ length: cols }, (_, cIdx) => {
          const r = rawPattern[cIdx];
          return Number.isInteger(r) && r >= 0 && r < rows ? r : pIdx % rows;
        });
        return {
          ...pl,
          pattern: repairedPattern,
        };
      },
    );
  }

  // Repair paytable entries
  const rawEntries = Array.isArray(next.paytable) ? next.paytable : [];
  next.paytable = rawEntries
    .filter((e) => symbolIds.has(e.symbolId))
    .map((e) => {
      const ofAKind =
        Number.isInteger(e.ofAKind) && e.ofAKind >= 1 && e.ofAKind <= cols ? e.ofAKind : 3;
      const payout = Number.isFinite(e.payout) && e.payout >= 0 ? e.payout : 0;
      if (ofAKind !== e.ofAKind || payout !== e.payout) {
        repairedIssues.push(`Sanitized malformed paytable entry for symbol "${e.symbolId}".`);
      }
      return {
        ...e,
        ofAKind,
        payout,
      };
    });

  if (next.paytableConfiguration?.symbolRows) {
    next.paytableConfiguration.symbolRows = next.paytableConfiguration.symbolRows
      .filter((r) => symbolIds.has(r.symbolId))
      .map((r) => {
        const sanitizedPayouts: Record<string, number> = {};
        for (const [k, v] of Object.entries(r.payouts ?? {})) {
          if (!Number.isFinite(v) || v < 0) {
            repairedIssues.push(`Sanitized negative/NaN payout on row "${r.symbolId}" count ${k}.`);
            sanitizedPayouts[k] = 0;
          } else {
            sanitizedPayouts[k] = v;
          }
        }
        return {
          ...r,
          payouts: sanitizedPayouts,
        };
      });
  }

  // Repair scenes & scene objects
  const layerIds = new Set(next.layers.map((l) => l.id));
  const defaultLayerId = next.layers[0]?.id ?? "layer-bg";
  const animIds = new Set(next.animations.map((a) => a.id));

  next.scenes = (next.scenes ?? []).map((scene, scIdx) => {
    const sceneObjects = deduplicateIds(scene.objects ?? [], `obj-${scIdx + 1}`, "sceneObject").map(
      (obj) => {
        const validRef =
          !obj.refId ||
          elementIds.has(obj.refId) ||
          symbolIds.has(obj.refId) ||
          symbolSetIds.has(obj.refId) ||
          animIds.has(obj.refId);
        const validLayer = !obj.layerId || layerIds.has(obj.layerId);
        const validAsset = !obj.assetId || assetIds.has(obj.assetId);

        if (!validRef) {
          repairedIssues.push(`Cleared orphaned refId "${obj.refId}" on scene object "${obj.id}".`);
        }
        if (!validLayer) {
          repairedIssues.push(
            `Reassigned orphaned layerId "${obj.layerId}" on scene object "${obj.id}".`,
          );
        }
        if (!validAsset) {
          repairedIssues.push(
            `Cleared orphaned assetId "${obj.assetId}" on scene object "${obj.id}".`,
          );
        }

        const x = Number.isFinite(obj.x) ? obj.x : 0;
        const y = Number.isFinite(obj.y) ? obj.y : 0;
        const width = Number.isFinite(obj.width) && obj.width > 0 ? obj.width : 120;
        const height = Number.isFinite(obj.height) && obj.height > 0 ? obj.height : 120;
        const rotation = Number.isFinite(obj.rotation) ? obj.rotation : 0;
        const opacity = Number.isFinite(obj.opacity)
          ? Math.min(1, Math.max(0, obj.opacity))
          : 1;

        if (
          x !== obj.x ||
          y !== obj.y ||
          width !== obj.width ||
          height !== obj.height ||
          rotation !== obj.rotation ||
          opacity !== obj.opacity
        ) {
          repairedIssues.push(`Normalized corrupted geometry on scene object "${obj.id}".`);
        }

        return {
          ...obj,
          refId: validRef ? obj.refId : null,
          layerId: validLayer ? obj.layerId : defaultLayerId,
          assetId: validAsset ? obj.assetId : null,
          x,
          y,
          width,
          height,
          rotation,
          opacity,
        };
      },
    );

    const validLayerIds = (scene.layerIds ?? []).filter((lid) => layerIds.has(lid));
    return {
      ...scene,
      name: scene.name && scene.name.trim() ? scene.name : `Scene ${scIdx + 1}`,
      kind: VALID_SCENE_KINDS.has(scene.kind) ? scene.kind : "base",
      layerIds: validLayerIds.length > 0 ? validLayerIds : Array.from(layerIds),
      objects: sceneObjects,
    };
  });

  // Repair animations
  next.animations = (next.animations ?? []).map((anim) => {
    const validTarget =
      layerIds.has(anim.target) || symbolIds.has(anim.target) || elementIds.has(anim.target);
    const validElement =
      !anim.elementId || elementIds.has(anim.elementId) || symbolIds.has(anim.elementId);
    const validVideoAsset =
      !anim.videoReference?.assetId || assetIds.has(anim.videoReference.assetId);
    const validSpriteAsset =
      !anim.spriteSheetReference?.assetId || assetIds.has(anim.spriteSheetReference.assetId);
    return {
      ...anim,
      target: validTarget ? anim.target : defaultLayerId,
      elementId: validElement ? anim.elementId : undefined,
      videoReference: validVideoAsset ? anim.videoReference : null,
      spriteSheetReference: validSpriteAsset ? anim.spriteSheetReference : null,
    };
  });

  const reconciled = reconcileBlueprintState(next);
  const audit = auditBlueprintDataIntegrity(reconciled);

  return {
    blueprint: reconciled,
    repairedIssues,
    audit,
  };
}

/**
 * Verifies that a GameBlueprint satisfies the Section 2 Slot Game Engine Contract
 * and works 100% without AI dependencies.
 */
export function verifySection2EngineContract(bp: GameBlueprint): Section2EngineContractReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const audit = auditBlueprintDataIntegrity(bp);
  if (!audit.valid) {
    for (const issue of audit.issues) {
      if (issue.severity === "error") {
        errors.push(`[Data QA: ${issue.category}] ${issue.message}`);
      } else {
        warnings.push(`[Data QA: ${issue.category}] ${issue.message}`);
      }
    }
  }

  if (bp.version !== 1) {
    errors.push(`Unsupported blueprint schema version ${String(bp.version)} (expected 1).`);
  }

  const wildSymbols = (bp.symbols ?? []).filter((s) => s.isWild);
  const scatterSymbols = (bp.symbols ?? []).filter((s) => s.isScatter);
  const bonusSymbols = (bp.symbols ?? []).filter((s) => s.isBonus);

  const wildSymbolId =
    (bp.specialSymbols ?? []).find((sp) => sp.behaviour === "wild")?.symbolId ??
    wildSymbols[0]?.id ??
    null;
  const scatterSymbolId =
    (bp.specialSymbols ?? []).find((sp) => sp.behaviour === "scatter")?.symbolId ??
    scatterSymbols[0]?.id ??
    null;
  const bonusSymbolIds = Array.from(
    new Set([
      ...(bp.specialSymbols ?? [])
        .filter((sp) => sp.behaviour === "bonus")
        .map((sp) => sp.symbolId),
      ...bonusSymbols.map((s) => s.id),
    ]),
  );

  if (!wildSymbolId) {
    warnings.push("No Wild symbol assigned; Section 2 engine will evaluate without wild substitution.");
  }

  const activePaylines = (bp.paylines ?? []).filter((pl) => pl.active !== false).length;
  if (bp.reels.evaluation === "lines" && activePaylines === 0) {
    errors.push("Evaluation mode is 'lines' but 0 active paylines are configured.");
  }

  const stopCountsPerReel = (bp.reels?.strips ?? []).map((s) => s.length);
  const totalStops = stopCountsPerReel.reduce((acc, count) => acc + count, 0);
  const variantCount = (bp.symbols ?? []).reduce(
    (acc, sym) => acc + (sym.variants?.length ?? 0),
    0,
  );
  const activeScene =
    (bp.scenes ?? []).find((sc) => sc.kind === "base") ??
    bp.scenes?.[0] ??
    null;
  const sceneObjectCount = (bp.scenes ?? []).reduce(
    (acc, sc) => acc + (sc.objects?.length ?? 0),
    0,
  );
  const configuredSymbolCount = new Set((bp.paytable ?? []).map((e) => e.symbolId)).size;

  const artworkReady =
    audit.checks.noInvalidSymbols.passed &&
    audit.checks.noOrphanedReferences.passed &&
    bp.symbols.length > 0 &&
    bp.symbolSets.length > 0;

  const layoutReady =
    audit.checks.noCorruptedScenes.passed &&
    bp.scenes.length > 0 &&
    bp.layers.length > 0 &&
    bp.canvas.width > 0 &&
    bp.canvas.height > 0;

  const mathConfigReady =
    audit.checks.noInvalidReelStops.passed &&
    audit.checks.noMalformedPaylines.passed &&
    audit.checks.noMalformedPaytableValues.passed &&
    bp.reels.strips.length === bp.reels.columns &&
    totalStops > 0 &&
    (bp.reels.evaluation !== "lines" || activePaylines > 0) &&
    configuredSymbolCount > 0;

  const engineTarget = bp.exportConfig?.engineTarget ?? "section2-engine";
  const ready = errors.length === 0 && artworkReady && layoutReady && mathConfigReady;

  return {
    ready,
    schemaVersion: bp.version,
    engineTarget,
    worksWithoutAi: true,
    architecturalBoundary: {
      studioRoot: "SLOT STUDIO",
      producers: {
        frontendBuilder: {
          label: "FRONTEND BUILDER",
          active: true,
          mode: "manual-deterministic",
        },
        futureAi: {
          label: "FUTURE AI (inactive)",
          active: false,
          status: "inactive",
          extensionPointReady: true,
        },
      },
      contractHub: {
        label: "GAME BLUEPRINT",
        schemaVersion: bp.version,
        valid: audit.valid && bp.version === 1,
      },
      contractPillars: {
        artwork: {
          label: "ARTWORK",
          ready: artworkReady,
          symbolSetCount: bp.symbolSets.length,
          symbolCount: bp.symbols.length,
          variantCount,
          elementCount: bp.elements.length,
          assetCount: bp.assets.length,
          animationCount: bp.animations.length,
        },
        layout: {
          label: "LAYOUT",
          ready: layoutReady,
          sceneCount: bp.scenes.length,
          activeSceneId: activeScene?.id ?? null,
          layerCount: bp.layers.length,
          sceneObjectCount,
          canvasSize: {
            width: bp.canvas.width,
            height: bp.canvas.height,
          },
        },
        mathConfig: {
          label: "MATH CONFIG",
          ready: mathConfigReady,
          columns: bp.reels.columns,
          rows: bp.reels.rows,
          evaluation: bp.reels.evaluation,
          reelStripCount: bp.reels.strips.length,
          totalStops,
          activePaylineCount: activePaylines,
          paytableRowCount: configuredSymbolCount,
          rtpTarget: bp.math.rtpTarget,
          volatility: bp.math.volatility,
          maxWinX: bp.math.maxWinX,
        },
      },
      consumer: {
        label: "SECTION 2 — BACKEND SLOT GAME ENGINE",
        engineTarget,
        ready,
      },
    },
    gridSpec: {
      columns: bp.reels.columns,
      rows: bp.reels.rows,
      evaluation: bp.reels.evaluation,
    },
    symbolSpec: {
      totalSymbols: bp.symbols.length,
      wildSymbolId,
      scatterSymbolId,
      bonusSymbolIds,
    },
    reelSpec: {
      stripCount: bp.reels.strips.length,
      stopCountsPerReel,
      weightsEnabled: Boolean(bp.reelConfiguration?.weightsEnabled),
    },
    paylineSpec: {
      activePaylines,
      totalPaylines: bp.paylines.length,
    },
    paytableSpec: {
      configuredSymbolCount,
      rtpTarget: bp.math.rtpTarget,
      volatility: bp.math.volatility,
      maxWinX: bp.math.maxWinX,
    },
    presentationSpec: {
      sceneCount: bp.scenes.length,
      layerCount: bp.layers.length,
      elementCount: bp.elements.length,
      animationCount: bp.animations.length,
      assetCount: bp.assets.length,
    },
    errors,
    warnings,
  };
}

/**
 * Runs deterministic F22 performance stress benchmarks covering:
 * 1. Large canvas performance (200 scene objects: move, resize, rotate, marquee hit-test)
 * 2. Large symbol sets (10 symbol sets, 60+ symbols reconciled across reels & paytable)
 * 3. Large layer lists (150 scene objects: group, ungroup, visibility, lock, reorder)
 * 4. Rapid drag performance (100 sequential canvas object moves + 100 reel stop reorders)
 * 5. State serialization & reconciliation round-trip (JSON export + import + reconcile)
 */
export function benchmarkStudioPerformance(): StudioPerformanceReport {
  const benchmarks: PerformanceBenchmarkResult[] = [];
  const startTotal = performance.now();

  const baseBp = createBlueprint({
    id: "proj-f22-perf",
    title: "F22 Performance Stress Slot",
    theme: "Olympus",
    columns: 5,
    rows: 3,
    paylineCount: 20,
  });

  // 1. Large Canvas Performance (200 objects)
  {
    const t0 = performance.now();
    const defaultLayerId = baseBp.layers[0]?.id ?? "layer-bg";
    let objects: SceneObject[] = Array.from({ length: 200 }, (_, i) => ({
      id: `perf-obj-${i + 1}`,
      name: `Canvas Layer ${i + 1}`,
      kind: "element",
      refId: baseBp.elements[i % baseBp.elements.length]?.id ?? null,
      layerId: defaultLayerId,
      assetId: null,
      x: (i % 20) * 80,
      y: Math.floor(i / 20) * 80,
      width: 64,
      height: 64,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      blur: 0,
      fill: null,
      stroke: null,
      strokeWidth: 0,
      radius: 0,
      shape: null,
      arrow: false,
      points: [],
      text: null,
      fontSize: 16,
      fontWeight: 600,
      align: "center",
      groupId: null,
    }));

    const selectedIds = objects.slice(0, 50).map((o) => o.id);
    objects = moveObjects(objects, selectedIds, { x: 24, y: 16 });
    objects = scaleObjects(objects, [objects[0].id], { x: 0, y: 0 }, 1.25, 1.25);
    objects = rotateObjects(objects, [objects[0].id], { x: 32, y: 32 }, 15);
    const hitIds = objectsInMarquee(objects, baseBp.layers, { x: 0, y: 0, w: 600, h: 400 });

    const elapsedMs = Number((performance.now() - t0).toFixed(2));
    benchmarks.push({
      id: "large-canvas-200-objects",
      label: "Large Canvas (200 scene objects transform & marquee hit-test)",
      itemCount: objects.length,
      elapsedMs,
      budgetMs: 250,
      passed: elapsedMs <= 250 && hitIds.length > 0,
      details: `Processed 200 objects (50 moved, scaled, rotated, ${hitIds.length} marquee-selected) in ${elapsedMs}ms.`,
    });
  }

  // 2. Large Symbol Sets (10 sets, 60+ symbols)
  {
    const t0 = performance.now();
    let doc = designDocFromBlueprint(baseBp);
    for (let s = 0; s < 8; s++) {
      const created = addElement(
        doc,
        {
          type: "symbol_set",
          name: `Stress Set ${s + 1}`,
          symbolType: "custom",
          valueTier: s % 2 === 0 ? "high" : "low",
          count: 6,
        },
        { glyphs: ["★", "♦", "♠", "♥", "♣", "♛"] },
      );
      doc = created.doc;
      doc = addSymbols(
        doc,
        created.id,
        [{ name: `Extra ${s + 1}` }],
        { glyphs: ["★", "♦", "♠", "♥", "♣", "♛"] },
      ).doc;
    }
    const merged = reconcileBlueprintState(applyDesign(baseBp, doc));
    const elapsedMs = Number((performance.now() - t0).toFixed(2));
    benchmarks.push({
      id: "large-symbol-sets-60-symbols",
      label: "Large Symbol Sets (10 sets, 60+ symbols reconciled)",
      itemCount: merged.symbols.length,
      elapsedMs,
      budgetMs: 500,
      passed: elapsedMs <= 500 && merged.symbols.length >= 60,
      details: `Created & reconciled ${merged.symbolSets.length} sets and ${merged.symbols.length} symbols across reels & paytable in ${elapsedMs}ms.`,
    });
  }

  // 3. Large Layer Lists (150 objects: group, ungroup, hide, lock, reorder)
  {
    const t0 = performance.now();
    const defaultLayerId = baseBp.layers[0]?.id ?? "layer-bg";
    let objects: SceneObject[] = Array.from({ length: 150 }, (_, i) => ({
      id: `layer-obj-${i + 1}`,
      name: `Layer Item ${i + 1}`,
      kind: "element",
      refId: baseBp.elements[0]?.id ?? null,
      layerId: defaultLayerId,
      assetId: null,
      x: i * 5,
      y: i * 5,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      blur: 0,
      fill: null,
      stroke: null,
      strokeWidth: 0,
      radius: 0,
      shape: null,
      arrow: false,
      points: [],
      text: null,
      fontSize: 16,
      fontWeight: 600,
      align: "center",
      groupId: null,
    }));

    const batchIds = objects.slice(10, 40).map((o) => o.id);
    const grouped = createGroup(objects, batchIds);
    objects = grouped.objects;
    if (grouped.groupId) {
      objects = ungroup(objects, [grouped.groupId]).objects;
    }
    objects = patchObjects(objects, batchIds, { visible: false });
    objects = patchObjects(objects, batchIds, { visible: true, locked: false });
    objects = reorderObjects(objects, objects[0].id, "front");
    objects = reorderObjects(objects, objects[objects.length - 1].id, "back");

    const elapsedMs = Number((performance.now() - t0).toFixed(2));
    benchmarks.push({
      id: "large-layer-list-150-items",
      label: "Large Layer List (150 layers group/ungroup/visibility/reorder)",
      itemCount: objects.length,
      elapsedMs,
      budgetMs: 250,
      passed: elapsedMs <= 250 && objects.length === 150,
      details: `Executed group, ungroup, visibility, lock, and z-order operations on 150 layers in ${elapsedMs}ms.`,
    });
  }

  // 4. Drag Performance (100 rapid sequential moves + 100 reel stop drag reorders)
  {
    const t0 = performance.now();
    const defaultLayerId = baseBp.layers[0]?.id ?? "layer-bg";
    let objects: SceneObject[] = Array.from({ length: 10 }, (_, i) => ({
      id: `drag-obj-${i + 1}`,
      name: `Drag Item ${i + 1}`,
      kind: "element",
      refId: baseBp.elements[0]?.id ?? null,
      layerId: defaultLayerId,
      assetId: null,
      x: i * 40,
      y: i * 30,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      blur: 0,
      fill: null,
      stroke: null,
      strokeWidth: 0,
      radius: 0,
      shape: null,
      arrow: false,
      points: [],
      text: null,
      fontSize: 16,
      fontWeight: 600,
      align: "center",
      groupId: null,
    }));
    const targetIds = objects.slice(0, 3).map((o) => o.id);
    for (let step = 0; step < 100; step++) {
      objects = moveObjects(objects, targetIds, { x: 2, y: 1 });
    }

    const reconciled = reconcileBlueprintState(baseBp);
    let reelCfg = structuredClone(reconciled.reelConfiguration!);
    for (let step = 0; step < 100; step++) {
      const stopLen = reelCfg.reels[0].stops.length;
      reelCfg = reorderStopInReel(reelCfg, 0, step % stopLen, (step + 3) % stopLen);
    }

    const elapsedMs = Number((performance.now() - t0).toFixed(2));
    benchmarks.push({
      id: "rapid-drag-200-iterations",
      label: "Rapid Drag Performance (100 canvas drags + 100 reel stop reorders)",
      itemCount: 200,
      elapsedMs,
      budgetMs: 300,
      passed: elapsedMs <= 300,
      details: `Completed 200 sequential drag/reorder state updates in ${elapsedMs}ms.`,
    });
  }

  // 5. Blueprint Serialization & Reconciliation Round-Trip
  {
    const t0 = performance.now();
    const reconciled = reconcileBlueprintState(baseBp);
    const exported = exportBlueprintJson(reconciled);
    const imported = importAndMigrateBlueprint(exported.json);
    const elapsedMs = Number((performance.now() - t0).toFixed(2));
    benchmarks.push({
      id: "blueprint-roundtrip-reconcile",
      label: "Blueprint Serialization, Import & Reconciliation Round-Trip",
      itemCount: exported.json.length,
      elapsedMs,
      budgetMs: 250,
      passed: elapsedMs <= 250 && imported.ok,
      details: `Serialized ${exported.json.length} bytes, validated, and reconciled in ${elapsedMs}ms.`,
    });
  }

  const totalElapsedMs = Number((performance.now() - startTotal).toFixed(2));
  return {
    passed: benchmarks.every((b) => b.passed),
    totalElapsedMs,
    benchmarks,
  };
}
