import type { GameBlueprint, ProjectStatus, Volatility } from "@/lib/blueprint/types";
import type { NewGameDraft } from "@/lib/creation/draft";

/** Light-weight project representation used by the dashboard. */
export interface ProjectSummary {
  id: string;
  title: string;
  theme: string;
  styleGuide: string;
  description: string;
  status: ProjectStatus;
  folderPath: string;
  thumbnailUri: string | null;
  columns: number;
  rows: number;
  paylineCount: number;
  rtpTarget: number;
  volatility: Volatility;
  isDemo: boolean;
  symbolCount: number;
  assetCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface FolderSummary {
  id: string;
  name: string;
  path: string;
  parentPath: string;
  projectCount: number;
  childFolderCount: number;
  createdAt: string;
}

export interface WorkspaceSnapshot {
  projects: ProjectSummary[];
  folders: FolderSummary[];
}

export interface ProjectDetail extends ProjectSummary {
  revision: number;
  blueprint: GameBlueprint;
}

export interface CreateProjectInput {
  /** Full creation draft (New Game workflow). When present it is authoritative. */
  draft?: NewGameDraft;
  title: string;
  theme: string;
  styleGuide?: string;
  description?: string;
  folderPath?: string;
  columns?: number;
  rows?: number;
  paylineCount?: number;
  rtpTarget?: number;
  volatility?: Volatility;
  status?: ProjectStatus;
  evaluation?: "lines" | "ways" | "cluster";
}

export interface UpdateProjectInput {
  title?: string;
  theme?: string;
  styleGuide?: string;
  description?: string;
  status?: ProjectStatus;
  folderPath?: string;
  blueprint?: GameBlueprint;
}

export const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: "Draft",
  blueprint: "Blueprint",
  math: "Math",
  prototype: "Prototype",
  team_review: "Team review",
  released: "Released",
};

export const STATUS_ORDER: ProjectStatus[] = [
  "draft",
  "blueprint",
  "math",
  "prototype",
  "team_review",
  "released",
];

export type SortKey = "updated" | "created" | "title" | "status";
export type ViewMode = "grid" | "list";
