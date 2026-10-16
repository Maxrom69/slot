/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B02 — Canonical Game Definition Schema Types
 *
 * Defines the formal, strongly-typed, versioned, serializable contract between
 * SECTION 1 (Frontend / Slots Studio Builder) and SECTION 2 (Backend Slot Game Engine).
 *
 * Purely declarative data describing WHAT THE GAME IS.
 * Never contains runtime state, UI/editor pointer state, functions, DOM nodes, or AI state.
 */

import type {
  AnimationFormat,
  AnimationMeta,
  AnimationSource,
  AssetFormat,
  BlendMode,
  ElementType,
  GameBlueprint,
  LayerTransform,
  SceneBackground,
  SceneComposedImageRef,
  SceneVisibilityState,
  StylePalette,
  SymbolTier,
  ValueTier,
  Volatility,
} from "@/lib/blueprint/types";

export const CANONICAL_SCHEMA_VERSION = "1.0" as const;

export type SchemaVersionLiteral = "1.0" | "1" | 1;

export interface EngineCompatibilitySpec {
  readonly schemaVersion: "1.0";
  readonly minEngineVersion: string;
  readonly targetEngineVersion: string;
}

/* -------------------------------------------------------------------------- */
/* 1. METADATA                                                                */
/* -------------------------------------------------------------------------- */

export interface GameMetadata {
  readonly id: string;
  readonly title: string;
  readonly slug: string;
  readonly description: string;
  readonly theme: string;
  readonly author: string;
  readonly studio: string;
  readonly version: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tags: readonly string[];
  readonly folderPath?: string;
  readonly thumbnail?: string | null;
  readonly notes?: string;
}

/* -------------------------------------------------------------------------- */
/* 2. GAME CONFIGURATION                                                      */
/* -------------------------------------------------------------------------- */

export type GameEvaluationMode =
  | "fixedPaylines"
  | "ways"
  | "clusters"
  | "payAnywhere"
  | "hybrid";

export interface DenominationConfig {
  readonly baseUnit: number;
  readonly currencyCode?: string | null;
}

export interface GameIdentityConfig {
  readonly gameId: string;
  readonly displayName: string;
  readonly gameMode: GameEvaluationMode;
  readonly supportedModes: readonly GameEvaluationMode[];
  readonly defaultBet: number;
  readonly betLevels: readonly number[];
  readonly rtpTarget: number;
  readonly volatility: Volatility;
  readonly maxWinX: number;
  readonly hitFrequencyTarget: number;
  readonly denomination?: DenominationConfig;
}

/* -------------------------------------------------------------------------- */
/* 3. STYLE / ART DIRECTION                                                   */
/* -------------------------------------------------------------------------- */

export interface CanonicalStyleGuide {
  readonly name: string;
  readonly description: string;
  readonly artStyle: string;
  readonly colorDirection: string;
  readonly lighting: string;
  readonly renderingStyle: string;
  readonly compositionGuidance: string;
  readonly characterGuidance: string;
  readonly symbolGuidance: string;
  readonly backgroundGuidance: string;
  readonly palette: StylePalette;
  readonly typography: {
    readonly display: string;
    readonly body: string;
  };
  readonly referenceAssetId?: string | null;
}

/* -------------------------------------------------------------------------- */
/* 4. GRID CONFIGURATION                                                      */
/* -------------------------------------------------------------------------- */

export interface CanonicalGridConfiguration {
  readonly reelCount: number;
  readonly rowCount: number;
  /** Compatibility aliases matching GameBlueprint GridConfiguration */
  readonly columns: number;
  readonly rows: number;
  readonly preset: "5x3" | "5x4" | "6x3" | "6x4" | "custom";
  readonly evaluation: "lines" | "ways" | "cluster";
  readonly cellWidth?: number;
  readonly cellHeight?: number;
  readonly aspectRatio?: string;
  readonly orientation: "landscape" | "portrait" | "responsive";
  readonly minReels?: number;
  readonly maxReels?: number;
  readonly minRows?: number;
  readonly maxRows?: number;
}

/* -------------------------------------------------------------------------- */
/* 5–9. SYMBOLS, ROLES, FAMILIES, VARIANTS & ASSET REFERENCES                 */
/* -------------------------------------------------------------------------- */

export type CanonicalSymbolType =
  | "character"
  | "deck-rank"
  | "suit"
  | "custom"
  | "special"
  | "royals"
  | "suits"
  | "seven"
  | "bar";

export type SymbolRoleType =
  | "regular"
  | "wild"
  | "scatter"
  | "bonus"
  | "multiplier"
  | "mystery"
  | "expanding"
  | "sticky"
  | "other";

export type SymbolRoleConfig =
  | { readonly role: "regular" }
  | {
      readonly role: "wild";
      readonly substitutesScatter: boolean;
      readonly multiplier: number;
    }
  | {
      readonly role: "scatter";
      readonly triggerCount: number;
      readonly awardsFreeSpins: number;
    }
  | {
      readonly role: "bonus";
      readonly triggerCount: number;
      readonly featureId?: string | null;
    }
  | {
      readonly role: "multiplier";
      readonly multiplier: number;
    }
  | {
      readonly role: "mystery";
      readonly targetSymbolIds: readonly string[];
    }
  | {
      readonly role: "expanding" | "sticky" | "other";
      readonly params?: Readonly<Record<string, number | string | boolean>>;
    };

export interface CropRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SchemaAssetReference {
  readonly assetId: string | null;
  readonly versionId?: string | null;
  readonly provider: "project" | "external" | "placeholder";
  readonly source?: string | null;
  readonly role?:
    | "primary"
    | "frame"
    | "background"
    | "thumbnail"
    | "variant"
    | "animation";
  readonly crop?: CropRect | null;
  readonly transform?: LayerTransform | null;
}

export interface CanonicalSymbolVariant {
  readonly id: string;
  readonly baseSymbolId: string;
  readonly name: string;
  readonly asset: SchemaAssetReference | null;
  readonly roles: readonly SymbolRoleType[];
  readonly familyId: string | null;
  readonly addressableInMath: boolean;
  readonly extras: Readonly<Record<string, number | string | boolean>>;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface CanonicalSymbolDefinition {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: CanonicalSymbolType;
  readonly tier: SymbolTier;
  readonly valueTier: ValueTier;
  readonly asset: SchemaAssetReference | null;
  readonly symbolSetId: string | null;
  readonly familyId: string | null;
  readonly roles: readonly SymbolRoleType[];
  readonly roleConfigs: readonly SymbolRoleConfig[];
  readonly variants: readonly CanonicalSymbolVariant[];
  readonly extras: Readonly<Record<string, number | string | boolean>>;
  readonly payouts: Readonly<Record<string, number>>;
  readonly reelWeight: number;
  readonly enabled: boolean;
  readonly description?: string;
  readonly tags?: readonly string[];
}

export interface SymbolFamilyDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly baseSymbolId: string | null;
  readonly memberIds: readonly string[];
  readonly allowMixedCounting: boolean;
}

/* -------------------------------------------------------------------------- */
/* 10. ASSET DEFINITIONS                                                      */
/* -------------------------------------------------------------------------- */

export type CanonicalAssetType =
  | "image"
  | "video"
  | "spriteSheet"
  | "audio"
  | "font"
  | "vector"
  | "other"
  | "sprite"
  | "spine";

export interface AssetDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: CanonicalAssetType;
  readonly source: string | null;
  readonly state: "placeholder" | "linked";
  readonly width: number | null;
  readonly height: number | null;
  readonly format: AssetFormat;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

/* -------------------------------------------------------------------------- */
/* 11. SYMBOL SETS                                                            */
/* -------------------------------------------------------------------------- */

export interface SymbolSetDefinition {
  readonly id: string;
  readonly name: string;
  readonly symbolType: CanonicalSymbolType;
  readonly tier: ValueTier;
  readonly description: string;
  readonly commonStyle?: string;
  readonly frame: SchemaAssetReference | null;
  readonly background: SchemaAssetReference | null;
  readonly symbolIds: readonly string[];
  readonly styleGuideReference?: string | null;
  readonly tags?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* 12. STANDALONE ELEMENTS                                                    */
/* -------------------------------------------------------------------------- */

export interface ElementDefinition {
  readonly id: string;
  readonly type: ElementType;
  readonly name: string;
  readonly group: string;
  readonly asset: SchemaAssetReference | null;
  readonly symbolIds: readonly string[];
  readonly variants: readonly CanonicalSymbolVariant[];
  readonly extras: Readonly<Record<string, number | string | boolean>>;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

/* -------------------------------------------------------------------------- */
/* 13–16. SCENES, CANVAS, LAYERS & LAYER GROUPS                               */
/* -------------------------------------------------------------------------- */

export interface CanvasConfiguration {
  readonly width: number;
  readonly height: number;
  readonly aspectRatio: string;
  readonly safeArea: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly orientation: "landscape" | "portrait" | "responsive";
  readonly backgroundColor?: string | null;
  readonly backgroundAssetId: string | null;
  readonly grid?: {
    readonly enabled: boolean;
    readonly size: number;
  };
  readonly guides?: {
    readonly enabled: boolean;
  };
  readonly snapSettings?: {
    readonly snapToGrid: boolean;
    readonly snapToObjects: boolean;
  };
}

export type CanonicalLayerType =
  | "background"
  | "reels"
  | "frame"
  | "ui"
  | "fx"
  | "overlay"
  | "custom"
  | "group"
  | "symbol"
  | "element"
  | "image"
  | "text"
  | "shape"
  | "stroke"
  | "animation";

export interface LayerSourceReference {
  readonly refKind: "none" | "element" | "asset" | "symbol" | "animation";
  readonly refId: string | null;
}

export interface NormalizedLayerTransform {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface LayerDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: CanonicalLayerType;
  readonly source: LayerSourceReference;
  readonly order: number;
  readonly visible: boolean;
  readonly locked: boolean;
  readonly opacity: number;
  readonly transform: NormalizedLayerTransform;
  readonly parentId: string | null;
  readonly groupId: string | null;
  readonly crop?: CropRect | null;
  readonly blendMode?: BlendMode;
  readonly mask?: string | null;
  readonly effects?: Readonly<Record<string, number | string | boolean>>;
}

export interface LayerGroupDefinition {
  readonly id: string;
  readonly name: string;
  readonly childLayerIds: readonly string[];
  readonly parentGroupId?: string | null;
}

export interface SceneDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: "intro" | "base" | "freespins" | "bonus" | "outro";
  readonly entryTransition: string;
  readonly canvas: CanvasConfiguration;
  readonly background: SceneBackground;
  readonly layerIds: readonly string[];
  readonly layers: readonly LayerDefinition[];
  readonly composedAssets?: readonly SceneComposedImageRef[];
  readonly visibilityOverrides?: SceneVisibilityState;
  readonly sceneMetadata?: Readonly<Record<string, string | number | boolean>>;
}

/* -------------------------------------------------------------------------- */
/* 17–20. REEL CONFIGURATION                                                  */
/* -------------------------------------------------------------------------- */

export interface ReelStopDefinition {
  readonly id: string;
  readonly position: number;
  readonly symbolId: string;
  readonly weight?: number;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

export interface ReelDefinition {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly visibleRows?: number;
  readonly stops: readonly ReelStopDefinition[];
}

export interface CanonicalReelConfiguration {
  readonly reelCount: number;
  readonly rowCount: number;
  readonly spinDirection: "down" | "up";
  readonly useWeights: boolean;
  readonly reels: readonly ReelDefinition[];
}

/* -------------------------------------------------------------------------- */
/* 21–22. PAYLINE CONFIGURATION                                               */
/* -------------------------------------------------------------------------- */

export interface PaylineDefinition {
  readonly id: string;
  readonly index: number;
  readonly name: string;
  readonly pattern: readonly number[];
  readonly enabled: boolean;
  readonly color: string;
}

export interface CanonicalPaylineConfiguration {
  readonly enabled: boolean;
  readonly reelCount: number;
  readonly rowCount: number;
  readonly paylines: readonly PaylineDefinition[];
}

/* -------------------------------------------------------------------------- */
/* 23. WIN EVALUATION MODEL                                                   */
/* -------------------------------------------------------------------------- */

export type WinEvaluationType =
  | "fixedPaylines"
  | "ways"
  | "clusters"
  | "payAnywhere"
  | "scatters";

export interface WinEvaluationDefinition {
  readonly primaryMode: WinEvaluationType;
  readonly enabledModes: readonly WinEvaluationType[];
  readonly direction: "leftToRight" | "bothWays" | "any";
  readonly highestWinOnlyPerLine: boolean;
  readonly allowSimultaneousLineAndScatterWins: boolean;
  readonly familyCountingEnabled: boolean;
}

/* -------------------------------------------------------------------------- */
/* 24–25. PAYTABLE DEFINITION                                                 */
/* -------------------------------------------------------------------------- */

export interface CanonicalPaytableSymbolEntry {
  readonly symbolId: string;
  /** Map of matchCount -> payoutMultiplier */
  readonly payouts: Readonly<Record<number, number>>;
}

export interface PaytableDefinition {
  readonly payoutType: "multiplier";
  readonly betBasis: "perLine" | "totalBet";
  readonly minMatchCount: number;
  readonly entries: readonly CanonicalPaytableSymbolEntry[];
}

/* -------------------------------------------------------------------------- */
/* 26–30. WILD, SCATTER, WAYS, CLUSTER & PAY-ANYWHERE CONFIGURATIONS          */
/* -------------------------------------------------------------------------- */

export interface WildSubstitutionRule {
  readonly wildSymbolId: string;
  readonly allowedSubstitutions: "allRegular" | readonly string[];
  readonly excludedSymbolIds: readonly string[];
  readonly activeReels: readonly number[];
  readonly activeModes: readonly ("base" | "freeSpins" | "bonus")[];
  readonly paysOnOwn: boolean;
  readonly multiplier: number;
}

export interface WildConfiguration {
  readonly enabled: boolean;
  readonly symbolIds: readonly string[];
  readonly substitutionRules: readonly WildSubstitutionRule[];
}

export type ScatterOverCapPolicy = "highestTier" | "exactOnly";

export interface ScatterRule {
  readonly scatterSymbolId: string;
  readonly evaluatesAnywhere: boolean;
  readonly independentOfPaylines: boolean;
  readonly payoutReferenceSymbolId: string | null;
  readonly triggerFeatureId: string | null;
  readonly minimumTriggerCount: number;
  /** Optional minimum paying count (defaults to lowest configured tier count or 1) */
  readonly minimumCount?: number;
  /** Optional explicit count -> multiplier payout ladder */
  readonly payouts?: Readonly<Record<number, number>>;
  /** Optional family/group ID or additional member symbol IDs counted together when family counting is enabled */
  readonly familyId?: string | null;
  readonly groupSymbolIds?: readonly string[];
  /** Explicit over-cap policy when count exceeds highest configured payout tier (default: "highestTier") */
  readonly overCapPolicy?: ScatterOverCapPolicy;
  /** Optional explicit flag for whether reaching minimumTriggerCount triggers a feature */
  readonly triggersFeature?: boolean;
}

export interface ScatterConfiguration {
  readonly enabled: boolean;
  readonly symbolIds: readonly string[];
  readonly rules: readonly ScatterRule[];
  readonly overCapPolicy?: ScatterOverCapPolicy;
}

export interface WaysConfiguration {
  readonly enabled: boolean;
  readonly startReelIndex: number;
  readonly endReelIndex: number;
  readonly minimumConsecutiveReels: number;
  readonly countingRule:
    | "multiplyMatchingReelPositions"
    | "singlePathPerReel";
  readonly totalWaysCount: number;
  /** Optional maximum participating reels cap (defaults to endReelIndex + 1 or board.reelCount) */
  readonly maximumReels?: number;
  /** Optional explicit flag requiring full-width Ways runs across all evaluated reels */
  readonly requireFullLength?: boolean;
  /** Optional explicit list of Ways-eligible symbol IDs */
  readonly eligibleSymbols?: readonly string[];
  /** Optional explicit flag enabling symbol-family Ways counting */
  readonly familyCountingEnabled?: boolean;
}

export type ClusterAdjacencyMode = "edge" | "hex";
export type HexGridOrientation = "odd-q" | "even-q" | "odd-r" | "even-r";

export interface ClusterConfiguration {
  readonly enabled: boolean;
  readonly minimumClusterSize: number;
  readonly adjacency: ClusterAdjacencyMode;
  readonly allowWildJoin: boolean;
  readonly allowFamilyGrouping: boolean;
  /** Optional explicit list of Cluster-eligible symbol IDs */
  readonly eligibleSymbols?: readonly string[];
  /** Optional explicit mapping of familyId -> payout symbolId when family grouping is enabled */
  readonly familyPayoutSymbolByFamilyId?: Readonly<Record<string, string>>;
  /** Optional hex grid column/row stagger convention when adjacency === "hex" (default: "odd-q") */
  readonly hexGridOrientation?: HexGridOrientation;
}

export interface PayAnywhereSymbolRule {
  readonly symbolId: string;
  readonly minCount: number;
  readonly maxCount?: number;
}

export interface PayAnywhereConfiguration {
  readonly enabled: boolean;
  readonly minimumMatchCount: number;
  readonly symbolRules: readonly PayAnywhereSymbolRule[];
  /** Explicit list of Pay-Anywhere eligible symbol IDs */
  readonly eligibleSymbols?: readonly string[];
  /** Optional explicit flag enabling B07 Wild substitution for Pay-Anywhere counts (default: false) */
  readonly allowWildSubstitution?: boolean;
  /** Optional explicit flag enabling B02 Symbol Family grouping for Pay-Anywhere counts (default: false) */
  readonly allowFamilyGrouping?: boolean;
}

/* -------------------------------------------------------------------------- */
/* 31–34. FEATURES, TRIGGERS, FREE SPINS & MULTIPLIERS                        */
/* -------------------------------------------------------------------------- */

export type CanonicalFeatureType =
  | "freeSpins"
  | "multiplier"
  | "tumble"
  | "cascade"
  | "boardResize"
  | "symbolInjection"
  | "symbolRemoval"
  | "mystery"
  | "colossal"
  | "lockedCells"
  | "reelNudge"
  | "linkedReels"
  | "variableReelHeights"
  | "bonus"
  | "free_spins"
  | "hold_and_win"
  | "pick_bonus"
  | "gamble"
  | "jackpot";

export type FeatureTriggerDefinition =
  | {
      readonly source: "scatterCount";
      readonly symbolId: string;
      readonly minCount: number;
    }
  | {
      readonly source: "symbolPattern";
      readonly symbolIds: readonly string[];
      readonly reelIndexes?: readonly number[];
    }
  | {
      readonly source: "win";
      readonly minMultiplier?: number;
    }
  | {
      readonly source: "reelStop";
      readonly reelIndex: number;
      readonly symbolId: string;
    }
  | {
      readonly source: "spinCount";
      readonly intervalSpins: number;
    }
  | {
      readonly source: "featureComplete";
      readonly sourceFeatureId: string;
    }
  | {
      readonly source: "external";
      readonly eventKey: string;
    };

export interface FeatureDefinition {
  readonly id: string;
  readonly type: CanonicalFeatureType;
  readonly name: string;
  readonly enabled: boolean;
  readonly trigger: FeatureTriggerDefinition | null;
  readonly configuration: Readonly<Record<string, number | string | boolean>>;
}

export interface FreeSpinsConfiguration {
  readonly enabled: boolean;
  readonly featureId: string | null;
  readonly initialSpins: number;
  readonly retriggers: boolean;
  readonly retriggerSpinsAwarded: number;
  readonly maxSpins: number;
  readonly multiplierMode: "fixed" | "progressive" | "none";
  readonly baseMultiplier: number;
  readonly reelConfigurationReference: string | null;
  readonly featureReferences: readonly string[];
}

export type MultiplierScope = "win" | "spin" | "feature" | "session";

export interface MultiplierConfiguration {
  readonly enabled: boolean;
  readonly baseMultiplier: number;
  readonly increment: number;
  readonly maximum: number;
  readonly scope: MultiplierScope;
}

/* -------------------------------------------------------------------------- */
/* 35–38. BOARD DYNAMICS & ADVANCED REEL MECHANICS                            */
/* -------------------------------------------------------------------------- */

export interface BoardDynamicsConfiguration {
  readonly cascades: {
    readonly enabled: boolean;
    readonly mode: "tumble" | "cascade";
    readonly maxCascades: number;
  };
  readonly boardResize: {
    readonly enabled: boolean;
    readonly minReels: number;
    readonly maxReels: number;
    readonly minRows: number;
    readonly maxRows: number;
  };
  readonly symbolInjection: {
    readonly enabled: boolean;
    readonly candidateSymbolIds: readonly string[];
  };
  readonly symbolRemoval: {
    readonly enabled: boolean;
    readonly removableSymbolIds: readonly string[];
  };
  readonly mysterySymbols: {
    readonly enabled: boolean;
    readonly mysterySymbolIds: readonly string[];
    readonly targetSymbolIds: readonly string[];
  };
  readonly colossalSymbols: {
    readonly enabled: boolean;
    readonly allowedSizes: readonly ("2x2" | "3x3" | "4x4")[];
    readonly eligibleSymbolIds: readonly string[];
  };
  readonly lockedCells: {
    readonly enabled: boolean;
    readonly maxLockedCells: number;
    readonly lockDurationSpins: number;
  };
}

export interface VariableReelHeightConfiguration {
  readonly enabled: boolean;
  readonly perReelRowCounts: readonly number[];
  readonly minRowsPerReel: number;
  readonly maxRowsPerReel: number;
}

export interface ReelNudgeConfiguration {
  readonly enabled: boolean;
  readonly maxNudgeSteps: number;
  readonly eligibleReels: readonly number[];
  readonly direction: "up" | "down" | "both";
}

export interface LinkedReelGroupSpec {
  readonly sourceReel: number;
  readonly targetReels: readonly number[];
  readonly mappingMode: "identical" | "mirrored";
}

export interface LinkedReelsConfiguration {
  readonly enabled: boolean;
  readonly links: readonly LinkedReelGroupSpec[];
}

/* -------------------------------------------------------------------------- */
/* 39–41. ANIMATION, EXPORT & EXTENSIONS                                      */
/* -------------------------------------------------------------------------- */

export type CanonicalAnimationType =
  | "background"
  | "symbolWin"
  | "standalone"
  | "hover"
  | "custom";

export interface AnimationDefinition {
  readonly id: string;
  readonly name: string;
  readonly elementId: string | null;
  readonly targetId: string;
  readonly type: CanonicalAnimationType;
  readonly source: AnimationSource;
  readonly format: AnimationFormat;
  readonly trigger: AnimationMeta["trigger"];
  readonly durationMs: number;
  readonly fps: number;
  readonly loop: boolean;
  readonly enabled: boolean;
  readonly videoAsset: SchemaAssetReference | null;
  readonly spriteSheetAsset: SchemaAssetReference | null;
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface CanonicalExportConfiguration {
  readonly format: "blueprint-json";
  readonly engineTarget: "section2-engine";
  readonly imageScale: "1x" | "2x";
  readonly includeAssets: boolean;
  readonly includeAnimations: boolean;
  readonly includeSprites: boolean;
  readonly includeGIF: boolean;
  readonly includeWebM: boolean;
  readonly includeVideo: boolean;
  readonly minify: boolean;
}

export interface SchemaExtensions {
  readonly namespaceVersion: "1.0";
  readonly customMechanics: Readonly<
    Record<string, Readonly<Record<string, string | number | boolean>>>
  >;
  readonly studioExtensions: Readonly<Record<string, unknown>>;
}

/* -------------------------------------------------------------------------- */
/* TOP-LEVEL CANONICAL GAME DEFINITION                                        */
/* -------------------------------------------------------------------------- */

/**
 * The canonical, normalized, versioned GameDefinition contract.
 * Extends and unifies GameBlueprint so Frontend and Backend share a single
 * authoritative game definition model without competing structures.
 */
export interface GameDefinition extends GameBlueprint {
  readonly schemaVersion: "1.0";
  readonly engineCompatibility: EngineCompatibilitySpec;
  readonly id: string;
  readonly metadata: GameMetadata;
  readonly game: GameIdentityConfig;
  readonly styleGuide: CanonicalStyleGuide;
  readonly grid: CanonicalGridConfiguration;
  readonly canonicalSymbols: readonly CanonicalSymbolDefinition[];
  readonly symbolFamilies: readonly SymbolFamilyDefinition[];
  readonly canonicalSymbolSets: readonly SymbolSetDefinition[];
  readonly canonicalAssets: readonly AssetDefinition[];
  readonly canonicalElements: readonly ElementDefinition[];
  readonly canonicalScenes: readonly SceneDefinition[];
  readonly canvasConfiguration: CanvasConfiguration;
  readonly canonicalLayers: readonly LayerDefinition[];
  readonly layerGroups: readonly LayerGroupDefinition[];
  readonly canonicalReels: CanonicalReelConfiguration;
  readonly canonicalPaylines: CanonicalPaylineConfiguration;
  readonly paytableDefinition: PaytableDefinition;
  readonly winEvaluation: WinEvaluationDefinition;
  readonly wildConfiguration: WildConfiguration;
  readonly scatterConfiguration: ScatterConfiguration;
  readonly waysConfiguration: WaysConfiguration;
  readonly clusterConfiguration: ClusterConfiguration;
  readonly payAnywhereConfiguration: PayAnywhereConfiguration;
  readonly canonicalFeatures: readonly FeatureDefinition[];
  readonly freeSpinsConfiguration: FreeSpinsConfiguration;
  readonly multiplierConfiguration: MultiplierConfiguration;
  readonly boardDynamics: BoardDynamicsConfiguration;
  readonly variableReelHeights: VariableReelHeightConfiguration;
  readonly reelNudges: ReelNudgeConfiguration;
  readonly linkedReels: LinkedReelsConfiguration;
  readonly canonicalAnimations: readonly AnimationDefinition[];
  readonly export: CanonicalExportConfiguration;
  readonly schemaExtensions: SchemaExtensions;
}
