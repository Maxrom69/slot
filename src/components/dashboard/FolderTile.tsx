"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import type { FolderSummary } from "@/lib/workspace/types";

export function FolderTile({ folder, onOpen, onRename, onDelete, onDropProject }: {
  folder: FolderSummary;
  onOpen: (folder: FolderSummary) => void;
  onRename: (folder: FolderSummary) => void;
  onDelete: (folder: FolderSummary) => void;
  onDropProject: (projectId: string, folder: FolderSummary) => void;
}) {
  const [over, setOver] = useState(false);
  const empty = folder.projectCount === 0 && folder.childFolderCount === 0;
  return <article aria-label={`${folder.name} folder`}
    onDragOver={(event) => {
      if (event.dataTransfer.types.includes("application/x-studio-project")) {
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = "move"; setOver(true);
      }
    }} onDragLeave={() => setOver(false)} onDrop={(event) => {
      event.preventDefault(); event.stopPropagation(); setOver(false);
      const id = event.dataTransfer.getData("application/x-studio-project");
      if (id) onDropProject(id, folder);
    }} className={`group flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 transition ${over ? "border-accent-500/70 bg-accent-600/15" : "border-white/[0.07] bg-ink-900 hover:border-white/20 hover:bg-ink-850"}`}>
    <button type="button" onClick={() => onOpen(folder)} aria-label={`Open ${folder.name} folder`} className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md text-left">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/10 bg-ink-850 text-ink-300"><Icon name="folder" size={17} /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium text-ink-100">{folder.name}</span>
        <span className="block truncate text-[10.5px] text-ink-400">{folder.projectCount} project{folder.projectCount === 1 ? "" : "s"}{folder.childFolderCount > 0 ? ` · ${folder.childFolderCount} folder${folder.childFolderCount === 1 ? "" : "s"}` : ""}</span>
      </span>
    </button>
    <div className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 has-[[data-menu-open=true]]:opacity-100"><Menu label={`Actions for ${folder.name}`} items={[
      { key: "open", label: "Open folder", onSelect: () => onOpen(folder) },
      { key: "rename", label: "Rename…", onSelect: () => onRename(folder) },
      { key: "delete", label: "Delete folder", danger: true, disabled: !empty, disabledReason: "Folder must be empty before it can be deleted", onSelect: () => onDelete(folder) },
    ]} /></div>
  </article>;
}
