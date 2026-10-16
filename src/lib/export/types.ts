import type {
  ExportAnimationOptions,
  ExportImageScale,
  GameBlueprint,
  ProjectStatus,
  StudioExportType,
  Volatility,
} from "@/lib/blueprint/types";

export type {
  ExportAnimationOptions,
  ExportImageScale,
  StudioExportType,
};

export const EXPORT_TYPES: ReadonlyArray<{
  id: StudioExportType;
  label: string;
  shortLabel: string;
  description: string;
  extension: string;
}> = [
  {
    id: "zip",
    label: "Download ZIP",
    shortLabel: "ZIP Bundle",
    description:
      "Frontend studio archive containing scaled image assets (1x/2x), filtered animation files, PNG asset sheet, Blueprint JSON, Project JSON, and manifest.",
    extension: ".zip",
  },
  {
    id: "png-asset-sheet",
    label: "PNG Asset Sheet",
    shortLabel: "Asset Sheet",
    description:
      "Visual PNG contact sheet packing project image assets, symbol artwork, and scene elements with interactive zoom, pan, fit, and download controls.",
    extension: ".png",
  },
  {
    id: "blueprint-json",
    label: "Blueprint JSON",
    shortLabel: "Blueprint JSON",
    description:
      "Complete GameBlueprint serialized as readable JSON, validated for schema integrity before export and ready for lossless round-trip import.",
    extension: ".blueprint.json",
  },
  {
    id: "project-json",
    label: "Project JSON",
    shortLabel: "Project JSON",
    description:
      "Full Slot Studio project envelope combining workspace project metadata, export options, validation summary, and the embedded GameBlueprint.",
    extension: ".project.json",
  },
] as const;

export interface ZipExportOptions {
  imageScale: ExportImageScale;
  animationOptions: ExportAnimationOptions;
}

export interface AssetSheetViewportState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface AssetSheetItem {
  id: string;
  name: string;
  category: "asset" | "symbol" | "element" | "composed";
  kind: string;
  state: "linked" | "placeholder" | "generated";
  assetId: string | null;
  uri: string | null;
  isImage: boolean;
  baseWidth: number;
  baseHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  colorHex: string;
  glyph: string;
  tags: string[];
  cellIndex: number;
  column: number;
  row: number;
  cellX: number;
  cellY: number;
  cellWidth: number;
  cellHeight: number;
}

export interface AssetSheetMetadata {
  /** Total assets registered in the blueprint/project inventory. */
  assetCount: number;
  /** Total visual image items rendered on the asset sheet. */
  imageCount: number;
  scale: ExportImageScale;
  scaleFactor: 1 | 2;
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  padding: number;
  headerHeight: number;
  sheetWidth: number;
  sheetHeight: number;
  items: AssetSheetItem[];
}

export type ExportValidationSeverity = "error" | "warning" | "passed";

export interface ExportValidationItem {
  id: string;
  label: string;
  status: ExportValidationSeverity;
  detail: string;
  /** True when the check failure represents critical schema corruption that blocks export. */
  critical: boolean;
}

export interface ExportValidationReport {
  /** True when no critical schema corruption errors exist (`errors.length === 0`). */
  canExport: boolean;
  /** True when critical schema corruption exists (`errors.length > 0`) and export must be blocked. */
  blocked: boolean;
  blockReason: string | null;
  status: "passed" | "warnings" | "blocked";
  errors: ExportValidationItem[];
  warnings: ExportValidationItem[];
  passed: ExportValidationItem[];
  checks: ExportValidationItem[];
}

export interface ProjectExportMetadata {
  id: string;
  title: string;
  slug: string;
  theme: string;
  styleGuide: string;
  description: string;
  status: ProjectStatus;
  folderPath: string;
  revision: number;
  columns: number;
  rows: number;
  paylineCount: number;
  rtpTarget: number;
  volatility: Volatility;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectExportPackage {
  schema: "slot-studio.project-export";
  exportVersion: 1;
  exportedAt: string;
  exporter: {
    kind: "frontend-export-center";
    /** Explicit truthfulness contract: no server-side production game exporter exists. */
    serverProductionExporterExists: false;
    note: string;
  };
  project: ProjectExportMetadata;
  zipOptions: ZipExportOptions;
  validationSummary: {
    status: "passed" | "warnings" | "blocked";
    errorCount: number;
    warningCount: number;
    passedCount: number;
  };
  blueprint: GameBlueprint;
}

export interface ZipExportEntrySummary {
  name: string;
  category:
    | "blueprint"
    | "project"
    | "manifest"
    | "asset-sheet"
    | "image"
    | "animation";
  sizeBytes: number;
  scale?: ExportImageScale;
  format?: string;
}

export interface ZipExportManifest {
  schema: "slot-studio.zip-manifest";
  exportVersion: 1;
  exportedAt: string;
  exporter: {
    kind: "frontend-export-center";
    serverProductionExporterExists: false;
  };
  projectId: string;
  projectTitle: string;
  imageScale: ExportImageScale;
  scaleFactor: 1 | 2;
  animationOptions: ExportAnimationOptions;
  assetCount: number;
  imageCount: number;
  includedAnimationCount: number;
  omittedAnimationCount: number;
  validationSummary: {
    status: "passed" | "warnings" | "blocked";
    errorCount: number;
    warningCount: number;
    passedCount: number;
  };
  entries: ZipExportEntrySummary[];
}

export interface ZipExportPackageResult {
  filename: string;
  mimeType: "application/zip";
  bytes: Uint8Array;
  entries: ZipExportEntrySummary[];
  manifest: ZipExportManifest;
  assetSheet: AssetSheetMetadata;
  validation: ExportValidationReport;
}

export interface PngAssetSheetExportResult {
  filename: string;
  mimeType: "image/png";
  bytes: Uint8Array;
  metadata: AssetSheetMetadata;
  validation: ExportValidationReport;
}

export interface JsonExportResult {
  filename: string;
  mimeType: "application/json";
  json: string;
  bytes: Uint8Array;
  validation: ExportValidationReport;
}

export interface BlueprintImportResult {
  ok: boolean;
  sourceKind: "blueprint-json" | "project-json" | "invalid";
  blueprint: GameBlueprint | null;
  projectMeta: Partial<ProjectExportMetadata> | null;
  zipOptions: ZipExportOptions | null;
  validation: ExportValidationReport;
  errors: string[];
}
