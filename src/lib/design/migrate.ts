import { deriveElements } from "@/lib/blueprint/elements";
import { ROYAL_CODES, defaultSymbolStats } from "@/lib/blueprint/factory";
import type { ElementDef, GameBlueprint, SymbolDef } from "@/lib/blueprint/types";
import { SET_TYPE_LABELS, finalizeDoc, uniqueCode, uniqueId, valueOfTier } from "./model";
import type { DesignDoc } from "./types";

/** Assets used by scene layout, which the design editor must never prune. */
export function sceneAssetIds(bp: GameBlueprint): string[] {
  const ids: string[] = [];
  for (const scene of bp.scenes ?? []) {
    if (scene.background?.assetId) ids.push(scene.background.assetId);
    for (const object of scene.objects ?? []) if (object.assetId) ids.push(object.assetId);
    for (const comp of scene.composedImages ?? []) if (comp.assetId) ids.push(comp.assetId);
  }
  for (const anim of bp.animations ?? []) {
    if (anim.videoReference?.assetId) ids.push(anim.videoReference.assetId);
    if (anim.spriteSheetReference?.assetId) ids.push(anim.spriteSheetReference.assetId);
  }
  return Array.from(new Set(ids));
}

export function designDocFromBlueprint(bp: GameBlueprint): DesignDoc {
  return {
    elements: bp.elements ?? deriveElements(bp),
    symbols: bp.symbols,
    specialSymbols: bp.specialSymbols,
    assets: bp.assets,
    paytable: bp.paytable,
    strips: bp.reels.strips,
    referenceAssetId: bp.style.referenceAssetId ?? null,
    protectedAssetIds: sceneAssetIds(bp),
    animations: bp.animations ?? [],
    scenes: bp.scenes ?? [],
    layers: bp.layers ?? [],
  };
}

/** Writes the design slice back into a blueprint, deriving symbolSets, canvas background, and dependent scene/animation views. */
export function applyDesign(bp: GameBlueprint, doc: DesignDoc): GameBlueprint {
  const backgrounds = doc.elements.filter((e) => e.type === "game_background");
  const linked = backgrounds.find((e) => e.assetId && doc.assets.some((a) => a.id === e.assetId && a.state === "linked"));
  const background = linked?.assetId ?? backgrounds[0]?.assetId ?? null;

  const prevElementById = new Map((bp.elements ?? []).map((e) => [e.id, e]));
  const prevSymbolById = new Map((bp.symbols ?? []).map((s) => [s.id, s]));
  const elementById = new Map(doc.elements.map((e) => [e.id, e]));
  const symbolById = new Map(doc.symbols.map((s) => [s.id, s]));
  const layerIds = new Set((bp.layers ?? []).map((l) => l.id));

  const elementAssetOf = (el: ElementDef | undefined, symbolsMap: Map<string, SymbolDef>) => {
    if (!el) return null;
    if (el.type === "symbol") {
      return symbolsMap.get(el.symbolIds[0] ?? "")?.assetId ?? null;
    }
    return el.assetId ?? (el.image?.provider === "project" ? el.image.assetId ?? null : null);
  };

  const symbolAssetOf = (sym: SymbolDef | undefined) => {
    if (!sym) return null;
    return sym.assetId ?? (sym.image?.provider === "project" ? sym.image.assetId ?? null : null);
  };

  const rawAnimations = doc.animations ?? bp.animations ?? [];
  const animations = rawAnimations.filter(
    (anim) =>
      anim.target === "standalone" ||
      layerIds.has(anim.target) ||
      symbolById.has(anim.target) ||
      elementById.has(anim.target),
  );
  const animById = new Map(animations.map((a) => [a.id, a]));
  const docSceneMap = new Map((doc.scenes ?? []).map((s) => [s.id, s]));

  // Propagate element/symbol/animation updates to dependent scene objects and merge newly added animation scene layers
  const scenes = (bp.scenes ?? []).map((scene) => {
    const docScene = docSceneMap.get(scene.id);
    const existingObjects = scene.objects ?? [];
    const existingObjIds = new Set(existingObjects.map((o) => o.id));
    const docAddedAnimObjects = (docScene?.objects ?? []).filter(
      (o) => !existingObjIds.has(o.id) && (o.kind === "animation" || Boolean(o.animationId)),
    );
    const mergedObjects = [...existingObjects, ...docAddedAnimObjects];
    if (mergedObjects.length === 0) return scene;
    return {
      ...scene,
      objects: mergedObjects.map((obj) => {
        if (obj.kind === "element" && obj.refId) {
          const el = elementById.get(obj.refId);
          const prevEl = prevElementById.get(obj.refId);
          if (!el) {
            return prevEl ? { ...obj, refId: null, assetId: null } : obj;
          }
          const resolvedAssetId = elementAssetOf(el, symbolById);
          const prevAssetId = elementAssetOf(prevEl, prevSymbolById);
          const nameChanged = prevEl !== undefined && prevEl.name !== el.name;
          const assetChanged = prevEl !== undefined && prevAssetId !== resolvedAssetId;
          if (!nameChanged && !assetChanged) return obj;
          return {
            ...obj,
            ...(nameChanged ? { name: el.name } : {}),
            ...(assetChanged ? { assetId: resolvedAssetId } : {}),
          };
        }
        if (obj.kind === "symbol" && obj.refId) {
          const sym = symbolById.get(obj.refId);
          const prevSym = prevSymbolById.get(obj.refId);
          if (!sym) {
            return prevSym ? { ...obj, refId: null, assetId: null } : obj;
          }
          const resolvedAssetId = symbolAssetOf(sym);
          const prevAssetId = symbolAssetOf(prevSym);
          const nameChanged = prevSym !== undefined && prevSym.name !== sym.name;
          const assetChanged = prevSym !== undefined && prevAssetId !== resolvedAssetId;
          if (!nameChanged && !assetChanged) return obj;
          return {
            ...obj,
            ...(nameChanged ? { name: sym.name } : {}),
            ...(assetChanged ? { assetId: resolvedAssetId } : {}),
          };
        }
        if (obj.kind === "animation" && (obj.refId || obj.animationId)) {
          const animId = obj.animationId ?? obj.refId ?? "";
          const anim = animById.get(animId);
          if (!anim) {
            return { ...obj, refId: null, animationId: null };
          }
        }
        return obj;
      }),
    };
  });

  return {
    ...bp,
    elements: doc.elements,
    symbols: doc.symbols,
    symbolSets: doc.elements
      .filter((e) => e.type === "symbol_set")
      .map((e) => ({
        id: e.id,
        name: e.name,
        description: e.symbolSet?.description ?? e.notes,
        symbolIds: e.symbolIds,
        symbolType: e.symbolSet?.symbolType ?? "custom",
        valueTier: e.symbolSet?.valueTier ?? "medium",
        frame: e.symbolSet?.frame ?? null,
        background: e.symbolSet?.background ?? null,
        styleGuide: e.symbolSet?.styleGuide ?? "",
        tags: [...(e.symbolSet?.tags ?? [])],
      })),
    specialSymbols: doc.specialSymbols,
    assets: doc.assets,
    paytable: doc.paytable,
    reels: { ...bp.reels, strips: doc.strips },
    canvas: { ...bp.canvas, backgroundAssetId: background },
    scenes,
    animations,
    exportConfig: { ...bp.exportConfig, includeAssets: doc.assets.some((a) => a.state === "linked") },
  };
}

const TIER_NAMES = { low: "Low", mid: "Medium", high: "High" } as const;

/**
 * Upgrades blueprints created before F04 (idempotent, deterministic):
 *  - sets gain a symbol type + value tier; mixed medium/high sets are split by tier
 *  - special symbols live as standalone symbols, never inside a set
 *  - imported symbol artwork that had no symbol becomes a real symbol
 *  - symbols nobody owns are adopted into sets so they stay visible
 */
export function migrateDoc(input: DesignDoc): DesignDoc {
  const symbols = [...input.symbols];
  const byId = new Map(symbols.map((s) => [s.id, s]));
  const elementIds = new Set(input.elements.map((e) => e.id));
  const symbolIds = new Set(symbols.map((s) => s.id));
  const codes = new Set(symbols.map((s) => s.code));
  const standaloneOwned = new Set(input.elements.filter((e) => e.type === "symbol").flatMap((e) => e.symbolIds));

  const artSymbol = (name: string, assetId: string): SymbolDef => {
    const symbol: SymbolDef = {
      id: uniqueId("sym-mid", symbolIds),
      code: uniqueCode("M", codes),
      name,
      tier: "mid",
      glyph: "◆",
      assetId,
      ...defaultSymbolStats("mid", symbols.filter((s) => s.tier === "mid").length),
    };
    symbols.push(symbol);
    byId.set(symbol.id, symbol);
    return symbol;
  };
  const isRoyals = (group: SymbolDef[]) => group.length > 0 && group.every((s) => ROYAL_CODES.includes(s.code));
  const setFor = (base: ElementDef, id: string, name: string, group: SymbolDef[], tier: SymbolDef["tier"]): ElementDef => {
    const royals = isRoyals(group);
    return {
      ...base,
      id,
      name,
      group: royals ? SET_TYPE_LABELS.royals : SET_TYPE_LABELS.custom,
      symbolIds: group.map((s) => s.id),
      assetId: null,
      symbolSet: { symbolType: royals ? "royals" : "custom", valueTier: valueOfTier(tier) },
    };
  };

  const out: ElementDef[] = [];
  for (const el of input.elements) {
    if (el.type === "symbol" && el.symbolIds.length === 0 && el.assetId) {
      out.push({ ...el, symbolIds: [artSymbol(el.name, el.assetId).id], assetId: null });
      continue;
    }
    if (el.type !== "symbol_set" || el.symbolSet) {
      out.push(el);
      continue;
    }
    const members = el.symbolIds.map((id) => byId.get(id)).filter((s): s is SymbolDef => Boolean(s));
    if (members.length === 0) {
      const art = el.assetId ? [artSymbol(el.name, el.assetId)] : [];
      out.push({ ...el, assetId: null, symbolIds: art.map((s) => s.id), symbolSet: { symbolType: "custom", valueTier: "medium" } });
      continue;
    }
    const regular = members.filter((s) => s.tier !== "special" && !standaloneOwned.has(s.id));
    const tiers = (["low", "mid", "high"] as const).filter((t) => regular.some((s) => s.tier === t));
    tiers.forEach((tier) => {
      const group = regular.filter((s) => s.tier === tier);
      out.push(
        tiers.length === 1
          ? setFor(el, el.id, el.name, group, tier)
          : setFor(el, uniqueId(el.id, elementIds), `${TIER_NAMES[tier]} Symbols`, group, tier),
      );
    });
  }

  const owned = new Set(out.flatMap((e) => e.symbolIds));
  const orphans = symbols.filter((s) => !owned.has(s.id));
  for (const symbol of orphans.filter((s) => s.tier === "special")) {
    out.push({
      id: uniqueId("el-special", elementIds),
      type: "symbol",
      name: symbol.name,
      group: "Special",
      assetId: null,
      symbolIds: [symbol.id],
      notes: "",
      origin: "planned",
      params: {},
    });
  }
  for (const tier of ["low", "mid", "high"] as const) {
    const group = orphans.filter((s) => s.tier === tier);
    if (group.length === 0) continue;
    out.push(setFor(
      { id: "", type: "symbol_set", name: "", group: "", assetId: null, symbolIds: [], notes: "", origin: "planned", params: {} },
      uniqueId("el-symbol-set", elementIds),
      `${TIER_NAMES[tier]} Symbols`,
      group,
      tier,
    ));
  }

  return finalizeDoc({ ...input, elements: out, symbols });
}

/** Normalises any stored blueprint to the current Design model. */
export function migrateBlueprint(bp: GameBlueprint): GameBlueprint {
  const migratedDoc = migrateDoc(designDocFromBlueprint(bp));
  const next = applyDesign(bp, migratedDoc);

  // If the blueprint already has an explicit F14 reelConfiguration whose symbols all
  // still exist and the symbol roster did not change during migration, preserve it.
  if (bp.reelConfiguration) {
    const symbolIds = new Set(next.symbols.map((s) => s.id));
    const sameSymbolRoster =
      bp.symbols.length === next.symbols.length &&
      bp.symbols.every((s) => symbolIds.has(s.id));
    const allStopSymbolsKnown = bp.reelConfiguration.reels.every((r) =>
      r.stops.every((st) => symbolIds.has(st.symbolId)),
    );
    if (sameSymbolRoster && allStopSymbolsKnown) {
      return {
        ...next,
        reels: {
          ...bp.reels,
          columns: bp.reelConfiguration.columns,
          strips: bp.reelConfiguration.strips,
          weightsEnabled: bp.reelConfiguration.weightsEnabled,
          reels: bp.reelConfiguration.reels,
        },
        reelConfiguration: bp.reelConfiguration,
        ...(bp.paylineConfiguration
          ? {
              paylines: bp.paylines,
              paylineConfiguration: bp.paylineConfiguration,
            }
          : {}),
        ...(bp.paytableConfiguration
          ? {
              paytable: bp.paytable,
              paytableConfiguration: bp.paytableConfiguration,
            }
          : {}),
      };
    }
  }
  if (bp.paylineConfiguration || bp.paytableConfiguration) {
    return {
      ...next,
      ...(bp.paylineConfiguration
        ? {
            paylines: bp.paylines,
            paylineConfiguration: bp.paylineConfiguration,
          }
        : {}),
      ...(bp.paytableConfiguration
        ? {
            paytable: bp.paytable,
            paytableConfiguration: bp.paytableConfiguration,
          }
        : {}),
    };
  }
  return next;
}
