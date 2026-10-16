"use client";

import { Menu, type MenuItem } from "@/components/ui/Menu";
import { Thumbnail } from "./Thumbnail";
import { STATUS_TONE, formatRelative } from "@/lib/workspace/selectors";
import { STATUS_LABELS, type ProjectSummary } from "@/lib/workspace/types";

export interface ProjectCardActions {
  onOpen: (project: ProjectSummary) => void;
  onRename: (project: ProjectSummary) => void;
  onDuplicate: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
  onMove: (project: ProjectSummary) => void;
  onExport: (project: ProjectSummary) => void;
}

function buildMenu(project: ProjectSummary, actions: ProjectCardActions): MenuItem[] {
  return [
    { key: "open", label: "Open", hint: "↵", onSelect: () => actions.onOpen(project) },
    { key: "rename", label: "Rename…", hint: "F2", onSelect: () => actions.onRename(project) },
    { key: "duplicate", label: "Duplicate", hint: "⌘D", onSelect: () => actions.onDuplicate(project) },
    { key: "move", label: "Move to folder…", hint: "⌘M", onSelect: () => actions.onMove(project) },
    { key: "export", label: "Export blueprint", onSelect: () => actions.onExport(project) },
    { key: "delete", label: "Delete", hint: "⌫", danger: true, onSelect: () => actions.onDelete(project) },
  ];
}

export function ProjectCard({
  project,
  actions,
  selected,
  onSelect,
}: {
  project: ProjectSummary;
  actions: ProjectCardActions;
  selected: boolean;
  onSelect: (project: ProjectSummary) => void;
}) {
  return (
    <article
      draggable
      aria-label={`${project.title} project`}
      data-project-id={project.id}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-studio-project", project.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onSelect(project)}
      onDoubleClick={() => actions.onOpen(project)}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-ink-900 transition ${
        selected
          ? "border-accent-500/60 shadow-lg shadow-accent-600/10"
          : "border-white/[0.07] hover:border-white/20"
      }`}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-ink-850">
        <Thumbnail project={project} />
        <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 has-[[data-menu-open=true]]:opacity-100">
          <Menu items={buildMenu(project, actions)} label={`More actions for ${project.title}`} />
        </div>
        <span
          className={`absolute top-2 left-2 rounded border px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider uppercase backdrop-blur ${STATUS_TONE[project.status]}`}
        >
          {STATUS_LABELS[project.status]}
        </span>
        <span className="absolute bottom-2 left-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-ink-200 backdrop-blur">
          {project.symbolCount} symbols · {project.assetCount} assets
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            actions.onOpen(project);
          }}
          className="focus-ring absolute right-2 bottom-2 rounded-md border border-white/15 bg-black/60 px-2.5 py-1 text-[11px] font-medium text-ink-100 opacity-0 backdrop-blur transition group-hover:opacity-100"
        >
          Open
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-1 px-3 py-2.5">
        <h3 className="truncate text-[13px] font-semibold text-ink-100">
          {project.title}
        </h3>
        <p className="truncate text-[11px] text-ink-400">
          {project.theme}
          {project.styleGuide ? ` · ${project.styleGuide}` : ""}
        </p>
        {project.folderPath ? (
          <p className="truncate font-mono text-[10px] text-ink-400/80">
            {project.folderPath}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2 text-[10.5px] text-ink-400">
        <span className="flex items-center gap-2">
          <span className="text-ink-200">
            {project.columns}×{project.rows}
          </span>
          <span className="text-ink-600">•</span>
          <span>
            {project.paylineCount > 0 ? `${project.paylineCount} lines` : "ways"}
          </span>
          <span className="text-ink-600">•</span>
          <span>RTP {project.rtpTarget.toFixed(1)}%</span>
        </span>
        <span suppressHydrationWarning>{formatRelative(project.updatedAt)}</span>
      </div>
    </article>
  );
}

export function ProjectRow({
  project,
  actions,
  selected,
  onSelect,
}: {
  project: ProjectSummary;
  actions: ProjectCardActions;
  selected: boolean;
  onSelect: (project: ProjectSummary) => void;
}) {
  return (
    <tr
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-studio-project", project.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={() => onSelect(project)}
      onDoubleClick={() => actions.onOpen(project)}
      className={`cursor-pointer border-b border-white/[0.05] transition ${
        selected ? "bg-accent-600/10" : "hover:bg-white/[0.03]"
      }`}
    >
      <td className="py-1.5 pl-3">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-14 shrink-0 overflow-hidden rounded border border-white/10">
            <Thumbnail project={project} dense />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-medium text-ink-100">
              {project.title}
            </div>
            <div className="truncate text-[10.5px] text-ink-400">{project.theme}</div>
          </div>
        </div>
      </td>
      <td className="px-3 text-[11px] text-ink-300">
        <span
          className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider uppercase ${STATUS_TONE[project.status]}`}
        >
          {STATUS_LABELS[project.status]}
        </span>
      </td>
      <td className="px-3 text-[11px] text-ink-300">
        {project.columns}×{project.rows}
      </td>
      <td className="px-3 text-[11px] text-ink-300">
        {project.paylineCount > 0 ? project.paylineCount : "ways"}
      </td>
      <td className="truncate px-3 font-mono text-[10.5px] text-ink-400">
        {project.folderPath || "—"}
      </td>
      <td className="px-3 text-[11px] text-ink-400" suppressHydrationWarning>
        {formatRelative(project.updatedAt)}
      </td>
      <td className="py-1.5 pr-3 text-right">
        <div className="flex justify-end">
          <Menu items={buildMenu(project, actions)} label={`More actions for ${project.title}`} />
        </div>
      </td>
    </tr>
  );
}
