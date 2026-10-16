"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import type { FolderSummary } from "@/lib/workspace/types";

const PIPELINE = [
  { key: "art", label: "Art & Assets", glyph: "▦" },
  { key: "math", label: "Math Lab", glyph: "∑" },
  { key: "features", label: "Features", glyph: "✦" },
  { key: "build", label: "Build & QA", glyph: "⚙" },
  { key: "playtest", label: "Playtest", glyph: "▶" },
  { key: "review", label: "Team Review", glyph: "◍" },
  { key: "export", label: "Export", glyph: "⇪" },
];

export function SideNav({
  folders,
  currentFolder,
  onNavigateFolder,
  onDropProject,
}: {
  folders: FolderSummary[];
  currentFolder: string;
  onNavigateFolder: (path: string) => void;
  onDropProject?: (projectId: string, folderPath: string) => void;
}) {
  const pathname = usePathname();
  const isGamesRoute = pathname === "/games" || pathname === "/dashboard";
  const rootFolders = folders
    .filter((folder) => folder.parentPath === "")
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-white/[0.07] bg-ink-900">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="grid h-8 w-8 place-items-center rounded-md border border-accent-500/40 bg-accent-600/15 text-[13px]">
          <Icon name="reels" size={22} className="text-accent-400" />
        </div>
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">
            SLOTS<span className="text-accent-400">STUDIO</span>
          </div>
          <div className="text-[10px] tracking-[0.14em] text-ink-400 uppercase">
            Blueprint builder
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <nav className="px-2.5">
          <SectionLabel>Workspace</SectionLabel>
          <Link
            href="/games"
            onClick={(event) => {
              if (isGamesRoute) {
                event.preventDefault();
                onNavigateFolder("");
              }
            }}
            className={`focus-ring flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition ${
              isGamesRoute
                ? "border border-accent-500/30 bg-accent-600/15 text-ink-100"
                : "border border-transparent text-ink-300 hover:bg-white/5 hover:text-ink-100"
            }`}
          >
            <Icon name="grid" size={14} /> Your Games
          </Link>
          <Link
            href="/games/new"
            className={`focus-ring mt-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition ${
              pathname === "/games/new" || pathname === "/project/new"
                ? "border border-accent-500/30 bg-accent-600/15 text-ink-100"
                : "border border-transparent text-ink-300 hover:bg-white/5 hover:text-ink-100"
            }`}
          >
            <Icon name="plus" size={14} /> New Game
          </Link>
          <Link
            href="/settings"
            className={`focus-ring mt-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition ${
              pathname === "/settings"
                ? "border border-accent-500/30 bg-accent-600/15 text-ink-100"
                : "border border-transparent text-ink-300 hover:bg-white/5 hover:text-ink-100"
            }`}
          >
            <Icon name="settings" size={14} /> Studio Settings
          </Link>
        </nav>

        <div className="mt-5 px-2.5">
          <SectionLabel>Folders</SectionLabel>
          <button
            type="button"
            onClick={() => onNavigateFolder("")}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("application/x-studio-project")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }
            }}
            onDrop={(e) => {
              const projectId = e.dataTransfer.getData("application/x-studio-project");
              if (projectId && onDropProject) onDropProject(projectId, "");
            }}
            className={`focus-ring flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition ${
              currentFolder === "" && isGamesRoute
                ? "text-ink-100"
                : "text-ink-400 hover:bg-white/5 hover:text-ink-100"
            }`}
          >
            <span className="w-4 text-center text-xs">⌂</span> Root
          </button>
          <div className="max-h-[28vh] overflow-y-auto">
            {rootFolders.map((folder) => (
              <FolderBranch
                key={folder.id}
                folder={folder}
                folders={folders}
                depth={1}
                currentFolder={currentFolder}
                onNavigateFolder={onNavigateFolder}
                onDropProject={onDropProject}
              />
            ))}
            {rootFolders.length === 0 ? (
              <p className="px-2.5 py-1 text-[11px] text-ink-400">No folders yet</p>
            ) : null}
          </div>
        </div>

        <div className="mt-5 px-2.5">
          <SectionLabel>Pipeline</SectionLabel>
          {PIPELINE.map((item) => (
            <div
              key={item.key}
              title="Not implemented yet — arrives in a later studio phase"
              className="flex cursor-not-allowed items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] text-ink-400/70"
            >
              <span className="flex items-center gap-2.5">
                <span className="w-4 text-center text-xs">{item.glyph}</span>
                {item.label}
              </span>
              <span className="rounded border border-white/10 px-1 py-px text-[9px] tracking-wider text-ink-400 uppercase">
                Soon
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-3 pt-2 pb-4">
        <div className="rounded-lg border border-white/[0.07] bg-ink-850 p-3">
          <div className="text-[11px] font-medium text-ink-200">Assistant slot</div>
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink-400">
            Reserved extension point. No assistant is implemented — the studio is
            fully usable without one.
          </p>
        </div>
        <p className="mt-3 text-[10px] text-ink-400">
          Local workspace · v0.2.0 · Blueprint-driven
        </p>
      </div>
    </aside>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1.5 text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
      {children}
    </div>
  );
}

function FolderBranch({
  folder,
  folders,
  depth,
  currentFolder,
  onNavigateFolder,
  onDropProject,
}: {
  folder: FolderSummary;
  folders: FolderSummary[];
  depth: number;
  currentFolder: string;
  onNavigateFolder: (path: string) => void;
  onDropProject?: (projectId: string, folderPath: string) => void;
}) {
  const children = folders
    .filter((f) => f.parentPath === folder.path)
    .sort((a, b) => a.name.localeCompare(b.name));
  const active = currentFolder === folder.path;

  return (
    <div>
      <button
        type="button"
        onClick={() => onNavigateFolder(folder.path)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("application/x-studio-project")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(e) => {
          const projectId = e.dataTransfer.getData("application/x-studio-project");
          if (projectId && onDropProject) onDropProject(projectId, folder.path);
        }}
        style={{ paddingLeft: `${10 + depth * 14}px` }}
        className={`focus-ring flex w-full items-center justify-between gap-2 rounded-md py-1.5 pr-2.5 text-left text-[13px] transition ${
          active
            ? "bg-white/[0.06] text-ink-100"
            : "text-ink-300 hover:bg-white/5 hover:text-ink-100"
        }`}
      >
        <span className="truncate">
          <span className="mr-2 text-xs text-ink-400">▸</span>
          {folder.name}
        </span>
        {folder.projectCount > 0 ? (
          <span className="text-[10px] text-ink-400">{folder.projectCount}</span>
        ) : null}
      </button>
      {children.map((child) => (
        <FolderBranch
          key={child.id}
          folder={child}
          folders={folders}
          depth={depth + 1}
          currentFolder={currentFolder}
          onNavigateFolder={onNavigateFolder}
          onDropProject={onDropProject}
        />
      ))}
    </div>
  );
}
