import type { GameBlueprint } from "@/lib/blueprint/types";
import type { BlueprintValidation } from "@/lib/blueprint/validate";
import type { ExportValidationReport } from "@/lib/export/types";

/* -------------------------------------------------------------------------- */
/* 1. End-to-End Studio Flow Stages                                           */
/* -------------------------------------------------------------------------- */

export type StudioFlowStageId =
  | "dashboard"
  | "new-game"
  | "project"
  | "design"
  | "symbol-set"
  | "symbol"
  | "canvas"
  | "layers"
  | "scenes"
  | "reels"
  | "paylines"
  | "paytable"
  | "preview"
  | "export";

export type IntegrationFlowStageId = StudioFlowStageId;

export interface StudioFlowStageMeta {
  id: StudioFlowStageId;
  order: number;
  label: string;
  description: string;
  href: (projectId: string, extraId?: string) => string;
}

export interface StudioFlowStageStatus {
  id: StudioFlowStageId;
  label: string;
  ready: boolean;
  status: "ready" | "warning" | "attention";
  itemCount: number;
  summary: string;
  detail: string;
  href: string;
}

export interface BlueprintFlowReadinessReport {
  projectId: string;
  projectTitle: string;
  allStagesReady: boolean;
  allReady: boolean;
  readyCount: number;
  totalCount: number;
  stages: StudioFlowStageStatus[];
  issues: string[];
}

/* -------------------------------------------------------------------------- */
/* 2. Delete Symbol Dependency Analysis                                       */
/* -------------------------------------------------------------------------- */

export type SymbolDependencyCategory =
  | "reel"
  | "paytable"
  | "payline"
  | "feature";

export interface SymbolDependencyWarningItem {
  category: SymbolDependencyCategory;
  severity: "warning" | "critical";
  title: string;
  message: string;
  targetId: string;
}

export interface SymbolReelReference {
  reelIndex: number;
  reelId: string;
  reelName: string;
  stopCount: number;
  totalStopsInReel: number;
  leavesReelEmpty: boolean;
}

export interface SymbolPaytableReference {
  ofAKind: number;
  payout: number;
  isCustomOverride: boolean;
}

export interface SymbolPaylineReference {
  id: string;
  label: string;
  detail: string;
}

export interface SymbolFeatureReference {
  featureId: string;
  featureName: string;
  featureKind: string;
  reason: string;
}

export interface SymbolDeleteDependencyReport {
  symbolId: string;
  symbolName: string;
  symbolCode: string;
  exists: boolean;
  hasWarnings: boolean;
  totalReferences: number;
  reelReferences: SymbolReelReference[];
  paytableReferences: SymbolPaytableReference[];
  paylineReferences: SymbolPaylineReference[];
  featureReferences: SymbolFeatureReference[];
  warnings: SymbolDependencyWarningItem[];
}

/* -------------------------------------------------------------------------- */
/* 3. Delete Element Dependency Analysis                                      */
/* -------------------------------------------------------------------------- */

export type ElementDependencyCategory =
  | "scene_layer"
  | "symbol_set"
  | "animation"
  | "asset_reference";

export interface ElementDependencyWarningItem {
  category: ElementDependencyCategory;
  severity: "warning" | "critical";
  title: string;
  message: string;
  targetId: string;
}

export interface ElementSceneLayerReference {
  sceneId: string;
  sceneName: string;
  layerId: string;
  layerName: string;
  objectId: string | null;
  objectName: string;
  detail: string;
}

export interface ElementSymbolSetReference {
  setId: string;
  setName: string;
  detail: string;
}

export interface ElementAnimationReference {
  animationId: string;
  animationName: string;
  trigger: string;
  detail: string;
}

export interface ElementAssetReference {
  assetId: string;
  assetName: string;
  role: "primary" | "revision" | "symbol_asset";
  detail: string;
}

export interface ElementDeleteDependencyReport {
  elementId: string;
  elementName: string;
  elementType: string;
  exists: boolean;
  hasWarnings: boolean;
  totalReferences: number;
  sceneLayerReferences: ElementSceneLayerReference[];
  symbolSetReferences: ElementSymbolSetReference[];
  animationReferences: ElementAnimationReference[];
  assetReferences: ElementAssetReference[];
  warnings: ElementDependencyWarningItem[];
}

/* -------------------------------------------------------------------------- */
/* 4. Change Grid Size Dependency Analysis                                    */
/* -------------------------------------------------------------------------- */

export type GridPaylineResolutionMode =
  | "adapt"
  | "clamp_rows"
  | "regenerate_standard"
  | "disable_incompatible"
  | "keep";

export interface GridChangeOptions {
  columns: number;
  rows: number;
  paylineResolution?: GridPaylineResolutionMode;
}

export interface IncompatiblePaylineEntry {
  paylineId: string;
  paylineName: string;
  paylineIndex: number;
  pattern: number[];
  outOfBoundsColumns: number[];
  lengthMismatch: boolean;
  reason: string;
  detail: string;
}

export interface IncompatibleReelEntry {
  reelIndex: number;
  reelId: string;
  action: "truncated" | "added";
  reason: string;
}

export interface IncompatibleLayoutEntry {
  sceneId: string;
  sceneName: string;
  targetId: string;
  targetName: string;
  kind: "layer" | "object" | "canvas" | "paytable";
  reason: string;
  detail: string;
}

export interface GridChangeWarningItem {
  category: "payline" | "layout" | "reel" | "paytable";
  severity: "warning" | "critical";
  title: string;
  message: string;
  targetId: string;
}

export interface GridSizeChangeDependencyReport {
  previousColumns: number;
  previousRows: number;
  nextColumns: number;
  nextRows: number;
  changed: boolean;
  hasWarnings: boolean;
  incompatiblePaylines: IncompatiblePaylineEntry[];
  incompatibleReels: IncompatibleReelEntry[];
  incompatibleLayouts: IncompatibleLayoutEntry[];
  sceneLayoutWarnings: IncompatibleLayoutEntry[];
  waysSummary: {
    previousWays: number;
    nextWays: number;
  };
  addedColumnsCount: number;
  truncatedColumnsCount: number;
  warnings: GridChangeWarningItem[];
}

export type GridSizeDependencyReport = GridSizeChangeDependencyReport;

/* -------------------------------------------------------------------------- */
/* 5. Blueprint Import & Legacy Migration                                     */
/* -------------------------------------------------------------------------- */

export interface BlueprintMigrationImportResult {
  ok: boolean;
  blueprint: GameBlueprint | null;
  sourceFormat: "blueprint-v1" | "blueprint-legacy" | "project-json" | "invalid";
  migrated: boolean;
  sourceVersion: number | null;
  targetVersion: number;
  migratedFromVersion: number | null;
  migrationsApplied: string[];
  migrationLog: string[];
  validation: BlueprintValidation | null;
  exportValidation: ExportValidationReport | null;
  errors: string[];
}

export type BlueprintImportResult = BlueprintMigrationImportResult;
