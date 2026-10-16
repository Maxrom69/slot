"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui";

export interface ProjectTopNavItem {
  id:
    | "overview"
    | "design"
    | "symbols"
    | "assets"
    | "canvas"
    | "scenes"
    | "reels"
    | "paylines"
    | "paytable"
    | "math"
    | "preview"
    | "export";
  label: string;
  icon: IconName;
  suffix: string;
}

export const PROJECT_TOP_NAV_ITEMS: ProjectTopNavItem[] = [
  { id: "overview", label: "Overview", icon: "folder", suffix: "" },
  { id: "design", label: "Design", icon: "layers", suffix: "/design" },
  { id: "symbols", label: "Symbols", icon: "diamond", suffix: "/symbols" },
  { id: "assets", label: "Assets", icon: "image", suffix: "/assets" },
  { id: "canvas", label: "Canvas", icon: "grid", suffix: "/canvas" },
  { id: "scenes", label: "Scenes", icon: "frame", suffix: "/scenes" },
  { id: "reels", label: "Reels", icon: "reels", suffix: "/reels" },
  { id: "paylines", label: "Paylines", icon: "line", suffix: "/paylines" },
  { id: "paytable", label: "Paytable", icon: "sparkles", suffix: "/paytable" },
  { id: "math", label: "Math", icon: "settings", suffix: "/math" },
  { id: "preview", label: "Preview", icon: "eye", suffix: "/preview" },
  { id: "export", label: "Export", icon: "download", suffix: "/export" },
];

export interface ProjectTopNavProps {
  projectId: string;
  projectTitle?: string;
}

export function ProjectTopNav({ projectId, projectTitle }: ProjectTopNavProps) {
  const pathname = usePathname() ?? "";
  const basePath = `/projects/${projectId}`;

  return (
    <div
      data-testid="project-top-nav"
      className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-950/95 px-3 select-none"
    >
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent-500/30 bg-gradient-to-br from-accent-500/25 to-gold-500/20 text-accent-400">
          <Icon name="sparkles" size={13} />
        </div>
        <Link
          href="/games"
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-ink-300 transition hover:bg-white/[0.05] hover:text-ink-50"
        >
          <Icon name="arrow-left" size={12} />
          <span>Your Games</span>
        </Link>
        {projectTitle ? (
          <>
            <span className="text-ink-500" aria-hidden="true">
              /
            </span>
            <span
              title={projectTitle}
              className="max-w-[120px] truncate text-[11.5px] font-semibold text-ink-100 sm:max-w-[180px]"
            >
              {projectTitle}
            </span>
          </>
        ) : null}
      </div>

      <nav
        aria-label="Project sections"
        className="flex min-w-0 flex-1 items-center justify-start gap-1 overflow-x-auto py-1 xl:justify-end"
      >
        {PROJECT_TOP_NAV_ITEMS.map((item) => {
          const href = `${basePath}${item.suffix}`;
          const isActive =
            item.suffix === ""
              ? pathname === basePath
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={item.id}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium transition ${
                isActive
                  ? "border border-accent-500/40 bg-accent-500/20 text-ink-50 shadow-sm"
                  : "border border-transparent text-ink-300 hover:bg-white/[0.05] hover:text-ink-100"
              }`}
            >
              <Icon
                name={item.icon}
                size={13}
                className={isActive ? "text-accent-300" : "text-ink-400"}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
