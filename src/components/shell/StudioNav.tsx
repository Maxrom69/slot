"use client";

import Link from "next/link";
import { Badge, Icon, type IconName } from "@/components/ui";
import type { GameBlueprint, ProjectStatus } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { STATUS_TONE } from "@/lib/workspace/selectors";
import { STATUS_LABELS } from "@/lib/workspace/types";

export type StudioNavSection =
  | "dashboard"
  | "projects"
  | "design"
  | "symbols"
  | "assets"
  | "preview"
  | "math"
  | "scenes"
  | "export"
  | "settings";

export interface StudioNavItemConfig {
  id: StudioNavSection;
  label: string;
  icon: IconName;
  href: (projectId?: string | null) => string;
  requiresProject?: boolean;
  badge?: string;
}

export const STUDIO_NAV_ITEMS: readonly StudioNavItemConfig[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: "grid",
    href: () => "/dashboard",
  },
  {
    id: "projects",
    label: "Projects",
    icon: "folder",
    href: (projectId) => (projectId ? `/project/${projectId}` : "/games"),
  },
  {
    id: "design",
    label: "Design",
    icon: "layers",
    href: (projectId) => `/project/${projectId}/design`,
    requiresProject: true,
  },
  {
    id: "symbols",
    label: "Symbols",
    icon: "diamond",
    href: (projectId) => `/project/${projectId}/symbols`,
    requiresProject: true,
  },
  {
    id: "assets",
    label: "Assets",
    icon: "image",
    href: (projectId) => `/project/${projectId}/assets`,
    requiresProject: true,
  },
  {
    id: "preview",
    label: "Preview",
    icon: "frame",
    href: (projectId) => `/project/${projectId}/preview`,
    requiresProject: true,
    badge: "Static",
  },
  {
    id: "math",
    label: "Math & Features",
    icon: "sparkles",
    href: (projectId) => `/project/${projectId}/math`,
    requiresProject: true,
    badge: "Config",
  },
  {
    id: "scenes",
    label: "Scenes",
    icon: "reels",
    href: (projectId) => `/project/${projectId}/scenes`,
    requiresProject: true,
  },
  {
    id: "export",
    label: "Export",
    icon: "download",
    href: (projectId) => `/project/${projectId}/export`,
    requiresProject: true,
  },
  {
    id: "settings",
    label: "Settings",
    icon: "settings",
    href: () => "/settings",
  },
];

export interface StudioNavProps {
  activeSection: StudioNavSection;
  project?: {
    id: string;
    title: string;
    theme: string;
    status: ProjectStatus;
    folderPath?: string;
    blueprint: GameBlueprint;
  } | null;
  open: boolean;
  onClose: () => void;
}

export function StudioNav({ activeSection, project, open, onClose }: StudioNavProps) {
  const projectId = project?.id ?? null;
  const validation = project ? validateBlueprint(project.blueprint) : null;
  const palette = project?.blueprint.style.palette;

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close studio navigation"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        />
      ) : null}
      <aside
        aria-label="Studio navigation"
        className={`fixed inset-y-0 left-0 z-40 flex w-[240px] shrink-0 flex-col border-r border-white/[0.07] bg-ink-900 transition-transform lg:static lg:z-auto lg:translate-x-0 ${
          open ? "translate-x-0" : "invisible -translate-x-full lg:visible"
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/[0.07] px-3.5 py-3">
          <Link
            href="/dashboard"
            className="focus-ring flex items-center gap-2.5 rounded-md"
          >
            <div className="grid h-7 w-7 place-items-center rounded-md border border-accent-500/40 bg-accent-600/15">
              <Icon name="reels" size={16} className="text-accent-400" />
            </div>
            <div className="leading-tight">
              <div className="text-xs font-semibold tracking-tight text-ink-100">
                SLOTS<span className="text-accent-400">STUDIO</span>
              </div>
              <div className="text-[9.5px] tracking-[0.14em] text-ink-400 uppercase">
                Blueprint Builder
              </div>
            </div>
          </Link>
          <Link
            href="/project/new"
            title="Create new project"
            className="focus-ring grid h-7 w-7 place-items-center rounded-md border border-white/10 bg-ink-850 text-ink-300 transition hover:border-white/20 hover:text-ink-100"
          >
            <Icon name="plus" size={13} />
          </Link>
        </div>

        {project ? (
          <div className="border-b border-white/[0.07] px-3 py-3">
            <div className="rounded-lg border border-white/[0.07] bg-ink-850 p-2.5">
              {palette ? (
                <div className="mb-2 flex h-1.5 overflow-hidden rounded-full" aria-hidden="true">
                  {[palette.accent, palette.accentAlt, palette.glow, palette.surface].map(
                    (c, i) => (
                      <span key={`${c}-${i}`} className="flex-1" style={{ background: c }} />
                    ),
                  )}
                </div>
              ) : null}
              <div
                className="truncate text-xs font-semibold text-ink-100"
                title={project.title}
              >
                {project.title}
              </div>
              <div className="mt-0.5 truncate text-[10.5px] text-ink-400">
                {project.folderPath || "Root"} · {project.theme}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <span
                  className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-wider uppercase ${STATUS_TONE[project.status]}`}
                >
                  {STATUS_LABELS[project.status]}
                </span>
                <span className="font-mono text-[10px] text-ink-400">
                  {project.blueprint.reels.columns}×{project.blueprint.reels.rows}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-2.5 py-3">
          <div>
            <div className="px-2 pb-1.5 text-[9.5px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
              Studio Sections
            </div>
            <ul className="space-y-0.5">
              {STUDIO_NAV_ITEMS.map((item) => {
                const disabled = Boolean(item.requiresProject && !projectId);
                const current = item.id === activeSection;
                if (disabled) {
                  return (
                    <li key={item.id}>
                      <span
                        title="Open or select a project to access this workspace"
                        aria-disabled="true"
                        className="flex cursor-not-allowed items-center justify-between rounded-md px-2.5 py-1.5 text-xs text-ink-400/50"
                      >
                        <span className="flex items-center gap-2.5">
                          <Icon name={item.icon} size={14} />
                          <span>{item.label}</span>
                        </span>
                        <Badge tone="muted">Project</Badge>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href(projectId)}
                      aria-current={current ? "page" : undefined}
                      onClick={() => onClose()}
                      className={`focus-ring flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs transition ${
                        current
                          ? "border-accent-500/30 bg-accent-600/15 font-medium text-ink-100"
                          : "border-transparent text-ink-300 hover:bg-white/5 hover:text-ink-100"
                      }`}
                    >
                      <span className="flex items-center gap-2.5">
                        <Icon name={item.icon} size={14} />
                        <span>{item.label}</span>
                      </span>
                      {item.badge ? <Badge tone="muted">{item.badge}</Badge> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>

          {projectId ? (
            <div>
              <div className="px-2 pb-1.5 text-[9.5px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                Slot Configuration & Canvas
              </div>
              <ul className="space-y-0.5">
                {[
                  {
                    id: "canvas",
                    label: "Canvas & Layers",
                    href: `/project/${projectId}/canvas`,
                    badge: `${project?.blueprint.layers.length ?? 0}L`,
                  },
                  {
                    id: "reels",
                    label: "Reel Strips",
                    href: `/project/${projectId}/reels`,
                    badge: `${project?.blueprint.reels.columns ?? 5}×${project?.blueprint.reels.rows ?? 3}`,
                  },
                  {
                    id: "paylines",
                    label: "Paylines",
                    href: `/project/${projectId}/paylines`,
                    badge: `${project?.blueprint.paylines.length ?? 0}`,
                  },
                  {
                    id: "paytable",
                    label: "Paytable",
                    href: `/project/${projectId}/paytable`,
                    badge: `${project?.blueprint.paytable.length ?? 0}`,
                  },
                ].map((sub) => (
                  <li key={sub.id}>
                    <Link
                      href={sub.href}
                      onClick={() => onClose()}
                      className="focus-ring flex items-center justify-between rounded-md border border-transparent px-2.5 py-1.5 text-xs text-ink-300 transition hover:bg-white/5 hover:text-ink-100"
                    >
                      <span>{sub.label}</span>
                      <Badge tone="muted">{sub.badge}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </nav>

        <div className="space-y-2 border-t border-white/[0.07] p-3">
          {project && validation ? (
            <>
              <div
                className={`flex items-center gap-1.5 text-[10.5px] ${
                  validation.ok
                    ? "text-emerald-300"
                    : validation.integrityOk
                      ? "text-amber-200"
                      : "text-rose-300"
                }`}
              >
                <Icon name={validation.ok ? "shield" : "info"} size={13} />
                <span>
                  {validation.ok
                    ? "Blueprint valid"
                    : validation.integrityOk
                      ? `${validation.issues.length} completeness note(s)`
                      : "Integrity issues"}
                </span>
              </div>
              <a
                href={`/api/projects/${project.id}/export`}
                className="focus-ring flex w-full items-center justify-center gap-1.5 rounded-md border border-white/10 bg-ink-850 px-3 py-1.5 text-[11px] font-medium text-ink-200 transition hover:border-white/20 hover:text-ink-100"
              >
                <Icon name="download" size={13} />
                Export Blueprint
              </a>
            </>
          ) : (
            <p className="text-[10.5px] text-ink-400">
              Section 1 · Slot Studio Builder
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
