/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — GameBlueprint Adapter & Immutable Normalized GameConfig
 *
 * Centralizes GameBlueprint parsing, reference resolution, and O(1) lookup
 * indexing so the engine never scans the raw GameBlueprint during spins
 * and never mutates the input blueprint.
 */

import type {
  FeatureConfig,
  GameBlueprint,
  SpecialBehaviour,
  SymbolTier,
  Volatility,
} from "@/lib/blueprint/types";
import type {
  ClusterConfiguration,
  PayAnywhereConfiguration,
  ScatterConfiguration,
  ScatterRule,
  WaysConfiguration,
  WildConfiguration,
  WildSubstitutionRule,
} from "../schema/types";
import {
  ENGINE_VERSION,
  assertValidBlueprintForEngine,
} from "../validation";

export type SymbolId = string;
export type ReelId = string;
export type PaylineId = string;
export type FeatureId = string;

export type EngineEvaluationMode =
  | "lines"
  | "ways"
  | "cluster"
  | "pay_anywhere";

export interface NormalizedSymbolRole {
  readonly isWild: boolean;
  readonly isScatter: boolean;
  readonly isBonus: boolean;
  readonly specialBehaviours: readonly SpecialBehaviour[];
  readonly substitutesScatter: boolean;
  readonly wildMultiplier: number;
  readonly scatterTriggerCount: number;
  readonly scatterFreeSpinsAwarded: number;
}

export interface NormalizedSymbolDefinition {
  readonly id: SymbolId;
  readonly code: string;
  readonly name: string;
  readonly tier: SymbolTier;
  readonly reelWeight: number;
  readonly mathId: string;
  readonly familyId?: string | null;
  readonly baseSymbolId?: string | null;
  readonly role: NormalizedSymbolRole;
  readonly payoutsByCount: Readonly<Record<number, number>>;
}

export interface NormalizedReelStop {
  readonly id: string;
  readonly position: number;
  readonly stopIndex: number;
  readonly symbolId: SymbolId;
  readonly weight: number;
  readonly cumulativeWeight: number;
}

export interface NormalizedReelStrip {
  readonly id: ReelId;
  readonly index: number;
  readonly name: string;
  readonly height: number;
  readonly stops: readonly NormalizedReelStop[];
  readonly totalWeight: number;
}

export interface NormalizedPayline {
  readonly id: PaylineId;
  readonly index: number;
  readonly name: string;
  readonly pattern: readonly number[];
  readonly active: boolean;
  readonly enabled: boolean;
  readonly color: string;
}

export interface NormalizedPaytableEntry {
  readonly symbolId: SymbolId;
  readonly matchCount: number;
  readonly payoutMultiplier: number;
}

export interface NormalizedFeatureDefinition {
  readonly id: FeatureId;
  readonly name: string;
  readonly kind: FeatureConfig["kind"];
  readonly enabled: boolean;
  readonly triggerSymbolIds: readonly SymbolId[];
  readonly triggerCount: number;
  readonly params: Readonly<Record<string, number | string | boolean>>;
}

export interface NormalizedMathTargets {
  readonly rtpTarget: number;
  readonly volatility: Volatility;
  readonly maxWinX: number;
  readonly betLevels: readonly number[];
  readonly defaultBet: number;
  readonly hitFrequency: number;
}

export interface NormalizedGridSpec {
  readonly columns: number;
  readonly rows: number;
  readonly reelHeights: readonly number[];
  readonly evaluationMode: EngineEvaluationMode;
  readonly spinDirection: "down" | "up";
  readonly weightsEnabled: boolean;
}

export interface GameConfig {
  readonly gameId: string;
  readonly title: string;
  readonly slug: string;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly grid: NormalizedGridSpec;
  readonly symbols: readonly NormalizedSymbolDefinition[];
  readonly symbolsById: ReadonlyMap<SymbolId, NormalizedSymbolDefinition>;
  readonly symbolsByCode: ReadonlyMap<string, NormalizedSymbolDefinition>;
  readonly variantsById?: ReadonlyMap<SymbolId, NormalizedSymbolDefinition>;
  readonly symbolFamiliesById?: ReadonlyMap<string, readonly SymbolId[]>;
  readonly wildSymbolIds: ReadonlySet<SymbolId>;
  readonly scatterSymbolIds: ReadonlySet<SymbolId>;
  readonly bonusSymbolIds: ReadonlySet<SymbolId>;
  readonly wildConfiguration?: WildConfiguration;
  readonly scatterConfiguration?: ScatterConfiguration;
  readonly waysConfiguration?: WaysConfiguration;
  readonly clusterConfiguration?: ClusterConfiguration;
  readonly payAnywhereConfiguration?: PayAnywhereConfiguration;
  readonly reels: readonly NormalizedReelStrip[];
  readonly reelsById: ReadonlyMap<ReelId, NormalizedReelStrip>;
  readonly paylines: readonly NormalizedPayline[];
  readonly activePaylines: readonly NormalizedPayline[];
  readonly paylinesById: ReadonlyMap<PaylineId, NormalizedPayline>;
  readonly paytableEntries: readonly NormalizedPaytableEntry[];
  readonly paytableBySymbolId: ReadonlyMap<
    SymbolId,
    ReadonlyMap<number, NormalizedPaytableEntry>
  >;
  readonly features: readonly NormalizedFeatureDefinition[];
  readonly featuresById: ReadonlyMap<FeatureId, NormalizedFeatureDefinition>;
  readonly math: NormalizedMathTargets;
}

export interface SerializedGameConfig {
  readonly gameId: string;
  readonly title: string;
  readonly slug: string;
  readonly schemaVersion: number;
  readonly engineVersion: string;
  readonly grid: NormalizedGridSpec;
  readonly symbols: readonly NormalizedSymbolDefinition[];
  readonly reels: readonly NormalizedReelStrip[];
  readonly paylines: readonly NormalizedPayline[];
  readonly paytableEntries: readonly NormalizedPaytableEntry[];
  readonly features: readonly NormalizedFeatureDefinition[];
  readonly math: NormalizedMathTargets;
}

export function adaptBlueprintToGameConfig(
  blueprint: GameBlueprint,
): GameConfig {
  assertValidBlueprintForEngine(blueprint);

  const columns = blueprint.reels.columns;
  const rows = blueprint.reels.rows;
  const evaluationMode = blueprint.reels.evaluation as EngineEvaluationMode;
  const weightsEnabled = Boolean(
    blueprint.reelConfiguration?.weightsEnabled ??
      blueprint.reels.weightsEnabled,
  );

  // Build special symbol behaviour map by symbolId
  const specialsBySymbolId = new Map<
    SymbolId,
    Array<{
      behaviour: SpecialBehaviour;
      params: Record<string, number | string | boolean>;
    }>
  >();
  for (const special of blueprint.specialSymbols ?? []) {
    const existing = specialsBySymbolId.get(special.symbolId) ?? [];
    existing.push({
      behaviour: special.behaviour,
      params: { ...special.params },
    });
    specialsBySymbolId.set(special.symbolId, existing);
  }

  // Merge paytable entries per symbol
  const mergedPayoutsBySymbolId = new Map<SymbolId, Map<number, number>>();
  for (const sym of blueprint.symbols) {
    const map = new Map<number, number>();
    for (const [rawMatch, payout] of Object.entries(sym.payouts ?? {})) {
      const count = Number(rawMatch);
      if (Number.isInteger(count) && count >= 1 && payout >= 0) {
        map.set(count, payout);
      }
    }
    mergedPayoutsBySymbolId.set(sym.id, map);
  }
  for (const entry of blueprint.paytable) {
    const map =
      mergedPayoutsBySymbolId.get(entry.symbolId) ?? new Map<number, number>();
    map.set(entry.ofAKind, entry.payout);
    mergedPayoutsBySymbolId.set(entry.symbolId, map);
  }

  const symbols: NormalizedSymbolDefinition[] = [];
  const symbolsById = new Map<SymbolId, NormalizedSymbolDefinition>();
  const symbolsByCode = new Map<string, NormalizedSymbolDefinition>();
  const variantsById = new Map<SymbolId, NormalizedSymbolDefinition>();
  const symbolFamiliesMap = new Map<string, SymbolId[]>();
  const wildSymbolIds = new Set<SymbolId>();
  const scatterSymbolIds = new Set<SymbolId>();
  const bonusSymbolIds = new Set<SymbolId>();

  const referencedInMath = new Set<string>();
  for (const strip of blueprint.reels.strips) {
    for (const stopSymId of strip) {
      referencedInMath.add(stopSymId);
    }
  }
  for (const entry of blueprint.paytable) {
    referencedInMath.add(entry.symbolId);
  }

  for (const sym of blueprint.symbols) {
    const specials = specialsBySymbolId.get(sym.id) ?? [];
    const specialBehaviours = specials.map((s) => s.behaviour);
    const isWild = Boolean(sym.isWild || specialBehaviours.includes("wild"));
    const isScatter = Boolean(
      sym.isScatter || specialBehaviours.includes("scatter"),
    );
    const isBonus = Boolean(sym.isBonus || specialBehaviours.includes("bonus"));

    const wildSpec = specials.find((s) => s.behaviour === "wild");
    const scatterSpec = specials.find((s) => s.behaviour === "scatter");

    const substitutesScatter = Boolean(
      wildSpec?.params.substitutesScatter ?? false,
    );
    const wildMultiplier =
      typeof wildSpec?.params.multiplier === "number" &&
      Number.isFinite(wildSpec.params.multiplier) &&
      wildSpec.params.multiplier > 0
        ? wildSpec.params.multiplier
        : 1;
    const scatterTriggerCount =
      typeof scatterSpec?.params.triggerCount === "number" &&
      Number.isInteger(scatterSpec.params.triggerCount) &&
      scatterSpec.params.triggerCount > 0
        ? scatterSpec.params.triggerCount
        : 3;
    const scatterFreeSpinsAwarded =
      typeof scatterSpec?.params.awardsFreeSpins === "number" &&
      Number.isInteger(scatterSpec.params.awardsFreeSpins) &&
      scatterSpec.params.awardsFreeSpins >= 0
        ? scatterSpec.params.awardsFreeSpins
        : 10;

    const payoutsMap =
      mergedPayoutsBySymbolId.get(sym.id) ?? new Map<number, number>();
    const payoutsObj: Record<number, number> = {};
    for (const [count, val] of Array.from(payoutsMap.entries()).sort(
      (a, b) => a[0] - b[0],
    )) {
      payoutsObj[count] = val;
    }

    const role: NormalizedSymbolRole = Object.freeze({
      isWild,
      isScatter,
      isBonus,
      specialBehaviours: Object.freeze([...specialBehaviours]),
      substitutesScatter,
      wildMultiplier,
      scatterTriggerCount,
      scatterFreeSpinsAwarded,
    });

    const normalizedSymbol: NormalizedSymbolDefinition = Object.freeze({
      id: sym.id,
      code: sym.code,
      name: sym.name,
      tier: sym.tier,
      reelWeight: sym.reelWeight,
      mathId: sym.mathId ?? sym.code,
      familyId: sym.family ?? null,
      baseSymbolId: null,
      role,
      payoutsByCount: Object.freeze(payoutsObj),
    });

    symbols.push(normalizedSymbol);
    symbolsById.set(sym.id, normalizedSymbol);
    symbolsByCode.set(sym.code, normalizedSymbol);
    if (isWild) wildSymbolIds.add(sym.id);
    if (isScatter) scatterSymbolIds.add(sym.id);
    if (isBonus) bonusSymbolIds.add(sym.id);

    if (sym.family) {
      const famList = symbolFamiliesMap.get(sym.family) ?? [];
      famList.push(sym.id);
      symbolFamiliesMap.set(sym.family, famList);
    }

    if (Array.isArray(sym.variants)) {
      for (const variant of sym.variants) {
        const varPayoutsMap =
          mergedPayoutsBySymbolId.get(variant.id) ?? payoutsMap;
        const varPayoutsObj: Record<number, number> = {};
        for (const [count, val] of Array.from(varPayoutsMap.entries()).sort(
          (a, b) => a[0] - b[0],
        )) {
          varPayoutsObj[count] = val;
        }
        const normalizedVariant: NormalizedSymbolDefinition = Object.freeze({
          id: variant.id,
          code: variant.id.toUpperCase().replace(/[^A-Z0-9_]/g, "_"),
          name: variant.name,
          tier: sym.tier,
          reelWeight: sym.reelWeight,
          mathId: variant.id,
          familyId: sym.family ?? null,
          baseSymbolId: sym.id,
          role,
          payoutsByCount: Object.freeze(varPayoutsObj),
        });
        variantsById.set(variant.id, normalizedVariant);
        if (referencedInMath.has(variant.id)) {
          symbolsById.set(variant.id, normalizedVariant);
        }
        if (sym.family) {
          const famList = symbolFamiliesMap.get(sym.family) ?? [];
          famList.push(variant.id);
          symbolFamiliesMap.set(sym.family, famList);
        }
      }
    }
  }

  const symbolFamiliesById = new Map<string, readonly SymbolId[]>();
  for (const [famId, memberIds] of symbolFamiliesMap.entries()) {
    symbolFamiliesById.set(famId, Object.freeze([...memberIds]));
  }

  // Normalize reel strips
  const detailedReels =
    blueprint.reelConfiguration?.reels ?? blueprint.reels.reels;
  const reels: NormalizedReelStrip[] = [];
  const reelsById = new Map<ReelId, NormalizedReelStrip>();

  for (let reelIndex = 0; reelIndex < columns; reelIndex += 1) {
    const detailed = detailedReels?.[reelIndex];
    const reelId = detailed?.id ?? `reel-${reelIndex + 1}`;
    const reelName = detailed?.name ?? `Reel ${reelIndex + 1}`;
    const rawStops =
      detailed && detailed.stops.length > 0
        ? detailed.stops.map((stop, idx) => ({
            id: stop.id || `${reelId}-stop-${idx + 1}`,
            position: stop.position || idx + 1,
            stopIndex: idx,
            symbolId: stop.symbolId,
            weight: weightsEnabled ? (stop.weight ?? 1) : 1,
          }))
        : blueprint.reels.strips[reelIndex].map((symbolId, idx) => ({
            id: `${reelId}-stop-${idx + 1}`,
            position: idx + 1,
            stopIndex: idx,
            symbolId,
            weight: 1,
          }));

    let cumulative = 0;
    const normalizedStops: NormalizedReelStop[] = rawStops.map((stop) => {
      cumulative += stop.weight;
      return Object.freeze({
        id: stop.id,
        position: stop.position,
        stopIndex: stop.stopIndex,
        symbolId: stop.symbolId,
        weight: stop.weight,
        cumulativeWeight: cumulative,
      });
    });

    const normalizedReel: NormalizedReelStrip = Object.freeze({
      id: reelId,
      index: reelIndex,
      name: reelName,
      height: rows,
      stops: Object.freeze(normalizedStops),
      totalWeight: cumulative,
    });

    reels.push(normalizedReel);
    reelsById.set(reelId, normalizedReel);
  }

  // Normalize paylines
  const DEFAULT_PAYLINE_COLORS = [
    "#f59e0b",
    "#3b82f6",
    "#10b981",
    "#ec4899",
    "#8b5cf6",
    "#ef4444",
    "#06b6d4",
    "#84cc16",
    "#f97316",
    "#eab308",
  ];
  const paylines: NormalizedPayline[] = [];
  const activePaylines: NormalizedPayline[] = [];
  const paylinesById = new Map<PaylineId, NormalizedPayline>();

  for (let i = 0; i < blueprint.paylines.length; i += 1) {
    const line = blueprint.paylines[i];
    const rawLine = line as unknown as {
      enabled?: boolean;
      color?: string;
    };
    const isEnabled =
      typeof rawLine.enabled === "boolean"
        ? rawLine.enabled
        : line.active !== false;
    const color =
      typeof rawLine.color === "string" && rawLine.color.trim().length > 0
        ? rawLine.color
        : DEFAULT_PAYLINE_COLORS[i % DEFAULT_PAYLINE_COLORS.length];

    const normalizedLine: NormalizedPayline = Object.freeze({
      id: line.id,
      index: line.index,
      name: line.name ?? `Line ${line.index}`,
      pattern: Object.freeze([...line.pattern]),
      active: isEnabled,
      enabled: isEnabled,
      color,
    });
    paylines.push(normalizedLine);
    if (normalizedLine.enabled) {
      activePaylines.push(normalizedLine);
    }
    paylinesById.set(normalizedLine.id, normalizedLine);
  }

  // Normalize paytable entries and lookup maps
  const paytableEntries: NormalizedPaytableEntry[] = [];
  const paytableBySymbolId = new Map<
    SymbolId,
    ReadonlyMap<number, NormalizedPaytableEntry>
  >();

  for (const sym of symbols) {
    const perSymbolMap = new Map<number, NormalizedPaytableEntry>();
    for (const [rawMatch, payoutMultiplier] of Object.entries(
      sym.payoutsByCount,
    )) {
      const matchCount = Number(rawMatch);
      const entry: NormalizedPaytableEntry = Object.freeze({
        symbolId: sym.id,
        matchCount,
        payoutMultiplier,
      });
      paytableEntries.push(entry);
      perSymbolMap.set(matchCount, entry);
    }
    paytableBySymbolId.set(sym.id, perSymbolMap);
  }

  // Normalize features
  const features: NormalizedFeatureDefinition[] = [];
  const featuresById = new Map<FeatureId, NormalizedFeatureDefinition>();
  const scatterIdsList = Array.from(scatterSymbolIds);
  const bonusIdsList = Array.from(bonusSymbolIds);

  for (const feature of blueprint.features ?? []) {
    const triggerSymbolIds =
      feature.kind === "free_spins"
        ? scatterIdsList
        : feature.kind === "pick_bonus" || feature.kind === "hold_and_win"
          ? bonusIdsList.length > 0
            ? bonusIdsList
            : scatterIdsList
          : [];
    const rawTriggerCount = feature.params.triggerCount;
    const triggerCount =
      typeof rawTriggerCount === "number" &&
      Number.isInteger(rawTriggerCount) &&
      rawTriggerCount > 0
        ? rawTriggerCount
        : 3;

    const normalizedFeature: NormalizedFeatureDefinition = Object.freeze({
      id: feature.id,
      name: feature.name,
      kind: feature.kind,
      enabled: Boolean(feature.enabled),
      triggerSymbolIds: Object.freeze([...triggerSymbolIds]),
      triggerCount,
      params: Object.freeze({ ...feature.params }),
    });
    features.push(normalizedFeature);
    featuresById.set(normalizedFeature.id, normalizedFeature);
  }

  const grid: NormalizedGridSpec = Object.freeze({
    columns,
    rows,
    reelHeights: Object.freeze(new Array<number>(columns).fill(rows)),
    evaluationMode,
    spinDirection: blueprint.reels.spinDirection ?? "down",
    weightsEnabled,
  });

  const sortedBetLevels = [...blueprint.math.betLevels].sort((a, b) => a - b);
  const defaultBet = sortedBetLevels.includes(1)
    ? 1
    : (sortedBetLevels[0] ?? 1);

  const math: NormalizedMathTargets = Object.freeze({
    rtpTarget: blueprint.math.rtpTarget,
    volatility: blueprint.math.volatility,
    maxWinX: blueprint.math.maxWinX,
    betLevels: Object.freeze(sortedBetLevels),
    defaultBet,
    hitFrequency: blueprint.math.hitFrequency,
  });

  const allReelIndexes = Array.from({ length: columns }, (_, idx) => idx);
  const nonRegularIds = symbols
    .filter((s) => s.role.isScatter || s.role.isBonus || s.role.isWild)
    .map((s) => s.id);
  const rawWildConfig = (
    blueprint as unknown as { wildConfiguration?: WildConfiguration }
  ).wildConfiguration;

  const wildSubstitutionRules: WildSubstitutionRule[] = rawWildConfig?.substitutionRules
    ? rawWildConfig.substitutionRules.map((rule) =>
        Object.freeze({
          wildSymbolId: rule.wildSymbolId,
          allowedSubstitutions:
            rule.allowedSubstitutions === "allRegular"
              ? ("allRegular" as const)
              : Object.freeze([...rule.allowedSubstitutions]),
          excludedSymbolIds: Object.freeze([...rule.excludedSymbolIds]),
          activeReels: Object.freeze([...rule.activeReels]),
          activeModes: Object.freeze([...rule.activeModes]),
          paysOnOwn: Boolean(rule.paysOnOwn),
          multiplier: rule.multiplier,
        }),
      )
    : symbols
        .filter((s) => s.role.isWild)
        .map((wSym) =>
          Object.freeze({
            wildSymbolId: wSym.id,
            allowedSubstitutions: "allRegular" as const,
            excludedSymbolIds: Object.freeze(
              wSym.role.substitutesScatter
                ? nonRegularIds.filter((id) => !scatterSymbolIds.has(id))
                : [...nonRegularIds],
            ),
            activeReels: Object.freeze([...allReelIndexes]),
            activeModes: Object.freeze([
              "base" as const,
              "freeSpins" as const,
              "bonus" as const,
            ]),
            paysOnOwn: Object.keys(wSym.payoutsByCount).length > 0,
            multiplier: wSym.role.wildMultiplier,
          }),
        );

  const wildConfiguration: WildConfiguration = Object.freeze({
    enabled: rawWildConfig?.enabled ?? wildSymbolIds.size > 0,
    symbolIds: Object.freeze(
      rawWildConfig?.symbolIds
        ? [...rawWildConfig.symbolIds]
        : Array.from(wildSymbolIds),
    ),
    substitutionRules: Object.freeze(wildSubstitutionRules),
  });

  const rawScatterConfig = (
    blueprint as unknown as { scatterConfiguration?: ScatterConfiguration }
  ).scatterConfiguration;
  const freeSpinFeature = features.find((f) => f.kind === "free_spins");

  const scatterRules: ScatterRule[] = rawScatterConfig?.rules
    ? rawScatterConfig.rules.map((r) =>
        Object.freeze({
          scatterSymbolId: r.scatterSymbolId,
          evaluatesAnywhere: Boolean(r.evaluatesAnywhere),
          independentOfPaylines: Boolean(r.independentOfPaylines),
          payoutReferenceSymbolId: r.payoutReferenceSymbolId,
          triggerFeatureId: r.triggerFeatureId,
          minimumTriggerCount: r.minimumTriggerCount,
          ...(r.minimumCount !== undefined
            ? { minimumCount: r.minimumCount }
            : {}),
          ...(r.payouts ? { payouts: Object.freeze({ ...r.payouts }) } : {}),
          ...(r.familyId !== undefined ? { familyId: r.familyId } : {}),
          ...(r.groupSymbolIds
            ? { groupSymbolIds: Object.freeze([...r.groupSymbolIds]) }
            : {}),
          ...(r.overCapPolicy !== undefined
            ? { overCapPolicy: r.overCapPolicy }
            : {}),
          ...(r.triggersFeature !== undefined
            ? { triggersFeature: r.triggersFeature }
            : {}),
        }),
      )
    : symbols
        .filter((s) => s.role.isScatter)
        .map((sSym) => {
          const configuredCounts = Object.keys(sSym.payoutsByCount)
            .map(Number)
            .filter((k) => Number.isInteger(k) && k > 0)
            .sort((a, b) => a - b);
          const minCount = configuredCounts[0] ?? sSym.role.scatterTriggerCount;
          return Object.freeze({
            scatterSymbolId: sSym.id,
            evaluatesAnywhere: true,
            independentOfPaylines: true,
            payoutReferenceSymbolId: sSym.id,
            triggerFeatureId:
              freeSpinFeature && freeSpinFeature.enabled
                ? freeSpinFeature.id
                : null,
            minimumTriggerCount: sSym.role.scatterTriggerCount,
            minimumCount: minCount,
            payouts: Object.freeze({ ...sSym.payoutsByCount }),
          });
        });

  const scatterConfiguration: ScatterConfiguration = Object.freeze({
    enabled: rawScatterConfig?.enabled ?? scatterSymbolIds.size > 0,
    symbolIds: Object.freeze(
      rawScatterConfig?.symbolIds
        ? [...rawScatterConfig.symbolIds]
        : Array.from(scatterSymbolIds),
    ),
    rules: Object.freeze(scatterRules),
    ...(rawScatterConfig?.overCapPolicy !== undefined
      ? { overCapPolicy: rawScatterConfig.overCapPolicy }
      : {}),
  });

  const rawWaysConfig = (
    blueprint as unknown as { waysConfiguration?: WaysConfiguration }
  ).waysConfiguration;

  const waysConfiguration: WaysConfiguration = Object.freeze({
    enabled: rawWaysConfig?.enabled ?? evaluationMode === "ways",
    startReelIndex: rawWaysConfig?.startReelIndex ?? 0,
    endReelIndex: rawWaysConfig?.endReelIndex ?? columns - 1,
    minimumConsecutiveReels: rawWaysConfig?.minimumConsecutiveReels ?? 3,
    countingRule:
      rawWaysConfig?.countingRule ?? "multiplyMatchingReelPositions",
    totalWaysCount:
      rawWaysConfig?.totalWaysCount ?? Math.pow(rows, columns),
    ...(rawWaysConfig?.maximumReels !== undefined
      ? { maximumReels: rawWaysConfig.maximumReels }
      : {}),
    ...(rawWaysConfig?.requireFullLength !== undefined
      ? { requireFullLength: rawWaysConfig.requireFullLength }
      : {}),
    ...(rawWaysConfig?.eligibleSymbols
      ? { eligibleSymbols: Object.freeze([...rawWaysConfig.eligibleSymbols]) }
      : {}),
    ...(rawWaysConfig?.familyCountingEnabled !== undefined
      ? { familyCountingEnabled: rawWaysConfig.familyCountingEnabled }
      : {}),
  });

  const rawClusterConfig = (
    blueprint as unknown as { clusterConfiguration?: ClusterConfiguration }
  ).clusterConfiguration;

  const clusterConfiguration: ClusterConfiguration = Object.freeze({
    enabled: rawClusterConfig?.enabled ?? evaluationMode === "cluster",
    minimumClusterSize: rawClusterConfig?.minimumClusterSize ?? 5,
    adjacency: rawClusterConfig?.adjacency ?? "edge",
    allowWildJoin: rawClusterConfig?.allowWildJoin ?? true,
    allowFamilyGrouping:
      rawClusterConfig?.allowFamilyGrouping ?? symbolFamiliesById.size > 0,
    ...(rawClusterConfig?.eligibleSymbols
      ? {
          eligibleSymbols: Object.freeze([
            ...rawClusterConfig.eligibleSymbols,
          ]),
        }
      : {}),
    ...(rawClusterConfig?.familyPayoutSymbolByFamilyId
      ? {
          familyPayoutSymbolByFamilyId: Object.freeze({
            ...rawClusterConfig.familyPayoutSymbolByFamilyId,
          }),
        }
      : {}),
    ...(rawClusterConfig?.hexGridOrientation !== undefined
      ? { hexGridOrientation: rawClusterConfig.hexGridOrientation }
      : {}),
  });

  const rawPayAnywhereConfig = (
    blueprint as unknown as {
      payAnywhereConfiguration?: PayAnywhereConfiguration;
    }
  ).payAnywhereConfiguration;

  const payAnywhereConfiguration: PayAnywhereConfiguration = Object.freeze({
    enabled:
      rawPayAnywhereConfig?.enabled ??
      (evaluationMode as string) === "payAnywhere",
    minimumMatchCount: rawPayAnywhereConfig?.minimumMatchCount ?? 8,
    symbolRules: Object.freeze(
      rawPayAnywhereConfig?.symbolRules
        ? rawPayAnywhereConfig.symbolRules.map((r) => Object.freeze({ ...r }))
        : [],
    ),
    ...(rawPayAnywhereConfig?.eligibleSymbols
      ? {
          eligibleSymbols: Object.freeze([
            ...rawPayAnywhereConfig.eligibleSymbols,
          ]),
        }
      : {}),
    ...(rawPayAnywhereConfig?.allowWildSubstitution !== undefined
      ? {
          allowWildSubstitution: Boolean(
            rawPayAnywhereConfig.allowWildSubstitution,
          ),
        }
      : {}),
    ...(rawPayAnywhereConfig?.allowFamilyGrouping !== undefined
      ? {
          allowFamilyGrouping: Boolean(
            rawPayAnywhereConfig.allowFamilyGrouping,
          ),
        }
      : {}),
  });

  return Object.freeze({
    gameId: blueprint.meta.id,
    title: blueprint.meta.title,
    slug: blueprint.meta.slug,
    schemaVersion: blueprint.meta.schemaVersion ?? blueprint.version,
    engineVersion: ENGINE_VERSION,
    grid,
    symbols: Object.freeze(symbols),
    symbolsById,
    symbolsByCode,
    variantsById,
    symbolFamiliesById,
    wildSymbolIds,
    scatterSymbolIds,
    bonusSymbolIds,
    wildConfiguration,
    scatterConfiguration,
    waysConfiguration,
    clusterConfiguration,
    payAnywhereConfiguration,
    reels: Object.freeze(reels),
    reelsById,
    paylines: Object.freeze(paylines),
    activePaylines: Object.freeze(activePaylines),
    paylinesById,
    paytableEntries: Object.freeze(paytableEntries),
    paytableBySymbolId,
    features: Object.freeze(features),
    featuresById,
    math,
  });
}

export function isGameConfig(
  candidate: GameBlueprint | GameConfig,
): candidate is GameConfig {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    "symbolsById" in candidate &&
    candidate.symbolsById instanceof Map
  );
}

export function serializeGameConfig(config: GameConfig): SerializedGameConfig {
  return {
    gameId: config.gameId,
    title: config.title,
    slug: config.slug,
    schemaVersion: config.schemaVersion,
    engineVersion: config.engineVersion,
    grid: config.grid,
    symbols: config.symbols,
    reels: config.reels,
    paylines: config.paylines,
    paytableEntries: config.paytableEntries,
    features: config.features,
    math: config.math,
  };
}
