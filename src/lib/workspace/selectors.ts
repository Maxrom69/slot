import type { ProjectStatus } from "@/lib/blueprint/types";
import {
  STATUS_ORDER,
  type FolderSummary,
  type ProjectSummary,
  type SortKey,
} from "./types";

/** Search covers title, theme, style guide, folder path, description and tags. */
export function matchesQuery(project: ProjectSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const terms = q.split(/\s+/);
  const haystack = [
    project.title,
    project.theme,
    project.styleGuide,
    project.description,
    project.folderPath,
    project.status,
  ]
    .join(" \u0001 ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function matchesFolderQuery(folder: FolderSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return q
    .split(/\s+/)
    .every((term) => `${folder.name} ${folder.path}`.toLowerCase().includes(term));
}

export interface ProjectFilter {
  query: string;
  folderPath: string;
  statuses: ProjectStatus[];
}

export function selectProjects(
  projects: ProjectSummary[],
  filter: ProjectFilter,
): ProjectSummary[] {
  const searching = filter.query.trim().length > 0;
  return projects.filter((project) => {
    if (!searching && project.folderPath !== filter.folderPath) return false;
    if (searching && filter.folderPath) {
      const inSubtree =
        project.folderPath === filter.folderPath ||
        project.folderPath.startsWith(`${filter.folderPath}/`);
      if (!inSubtree) return false;
    }
    if (filter.statuses.length > 0 && !filter.statuses.includes(project.status))
      return false;
    return matchesQuery(project, filter.query);
  });
}

export function selectFolders(
  folders: FolderSummary[],
  parentPath: string,
  query: string,
): FolderSummary[] {
  const searching = query.trim().length > 0;
  return folders
    .filter((folder) => {
      if (searching) {
        const inSubtree = parentPath
          ? folder.path.startsWith(`${parentPath}/`)
          : true;
        return inSubtree && matchesFolderQuery(folder, query);
      }
      return folder.parentPath === parentPath;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function sortProjects(
  projects: ProjectSummary[],
  key: SortKey,
  direction: "asc" | "desc",
): ProjectSummary[] {
  const factor = direction === "asc" ? 1 : -1;
  return [...projects].sort((a, b) => {
    switch (key) {
      case "title":
        return a.title.localeCompare(b.title) * factor;
      case "created":
        return (Date.parse(a.createdAt) - Date.parse(b.createdAt)) * factor;
      case "status":
        return (
          (STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)) * factor
        );
      case "updated":
      default:
        return (Date.parse(a.updatedAt) - Date.parse(b.updatedAt)) * factor;
    }
  });
}

export interface Crumb {
  label: string;
  path: string;
}

export function breadcrumbsFor(path: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Your Games", path: "" }];
  if (!path) return crumbs;
  const segments = path.split("/");
  segments.forEach((segment, index) => {
    crumbs.push({ label: segment, path: segments.slice(0, index + 1).join("/") });
  });
  return crumbs;
}

export function folderPathOptions(folders: FolderSummary[]): string[] {
  return ["", ...folders.map((f) => f.path).sort((a, b) => a.localeCompare(b))];
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

export const STATUS_TONE: Record<ProjectStatus, string> = {
  draft: "text-ink-300 border-white/10 bg-white/5",
  blueprint: "text-sky-300 border-sky-400/25 bg-sky-400/10",
  math: "text-amber-300 border-amber-400/25 bg-amber-400/10",
  prototype: "text-emerald-300 border-emerald-400/25 bg-emerald-400/10",
  team_review: "text-violet-300 border-violet-400/25 bg-violet-400/10",
  released: "text-lime-300 border-lime-400/25 bg-lime-400/10",
};
