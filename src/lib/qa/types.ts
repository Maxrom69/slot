import type { GameBlueprint, Volatility } from "@/lib/blueprint/types";

export type DataQaCategory =
  | "noDuplicateIds"
  | "noOrphanedReferences"
  | "noCorruptedScenes"
  | "noInvalidSymbols"
  | "noInvalidReelStops"
  | "noMalformedPaylines"
  | "noMalformedPaytableValues";

export type DataQaCheckId = DataQaCategory;

export interface DataQaIssue {
  category: DataQaCategory;
  severity: "error" | "warning";
  path: string;
  entityId?: string;
  message: string;
}

export interface DataQaCheckSummary {
  id: DataQaCategory;
  label: string;
  passed: boolean;
  issueCount: number;
  issues: DataQaIssue[];
}

export type DataQaCheckResult = DataQaCheckSummary;

export interface DataQaAuditReport {
  valid: boolean;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  checks: Record<DataQaCategory, DataQaCheckSummary>;
  issues: DataQaIssue[];
  summary: string;
}

export interface DataQaSanitizeResult {
  blueprint: GameBlueprint;
  repairedIssues: string[];
  audit: DataQaAuditReport;
}

export interface ArchitecturalBoundarySpec {
  studioRoot: "SLOT STUDIO";
  producers: {
    frontendBuilder: {
      label: "FRONTEND BUILDER";
      active: true;
      mode: "manual-deterministic";
    };
    futureAi: {
      label: "FUTURE AI (inactive)";
      active: false;
      status: "inactive";
      extensionPointReady: true;
    };
  };
  contractHub: {
    label: "GAME BLUEPRINT";
    schemaVersion: number;
    valid: boolean;
  };
  contractPillars: {
    artwork: {
      label: "ARTWORK";
      ready: boolean;
      symbolSetCount: number;
      symbolCount: number;
      variantCount: number;
      elementCount: number;
      assetCount: number;
      animationCount: number;
    };
    layout: {
      label: "LAYOUT";
      ready: boolean;
      sceneCount: number;
      activeSceneId: string | null;
      layerCount: number;
      sceneObjectCount: number;
      canvasSize: { width: number; height: number };
    };
    mathConfig: {
      label: "MATH CONFIG";
      ready: boolean;
      columns: number;
      rows: number;
      evaluation: "lines" | "ways" | "cluster";
      reelStripCount: number;
      totalStops: number;
      activePaylineCount: number;
      paytableRowCount: number;
      rtpTarget: number;
      volatility: Volatility;
      maxWinX: number;
    };
  };
  consumer: {
    label: "SECTION 2 — BACKEND SLOT GAME ENGINE";
    engineTarget: string;
    ready: boolean;
  };
}

export interface Section2EngineContractReport {
  ready: boolean;
  schemaVersion: number;
  engineTarget: string;
  worksWithoutAi: boolean;
  architecturalBoundary: ArchitecturalBoundarySpec;
  gridSpec: {
    columns: number;
    rows: number;
    evaluation: "lines" | "ways" | "cluster";
  };
  symbolSpec: {
    totalSymbols: number;
    wildSymbolId: string | null;
    scatterSymbolId: string | null;
    bonusSymbolIds: string[];
  };
  reelSpec: {
    stripCount: number;
    stopCountsPerReel: number[];
    weightsEnabled: boolean;
  };
  paylineSpec: {
    activePaylines: number;
    totalPaylines: number;
  };
  paytableSpec: {
    configuredSymbolCount: number;
    rtpTarget: number;
    volatility: Volatility;
    maxWinX: number;
  };
  presentationSpec: {
    sceneCount: number;
    layerCount: number;
    elementCount: number;
    animationCount: number;
    assetCount: number;
  };
  errors: string[];
  warnings: string[];
}

export interface PerformanceBenchmarkResult {
  id: string;
  label: string;
  itemCount: number;
  elapsedMs: number;
  budgetMs: number;
  passed: boolean;
  details: string;
}

export type PerformanceBenchmarkItem = PerformanceBenchmarkResult;

export interface StudioPerformanceReport {
  passed: boolean;
  totalElapsedMs: number;
  benchmarks: PerformanceBenchmarkResult[];
}
