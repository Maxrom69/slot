"use client";

import Link from "next/link";
import {
  Badge,
  Button,
  Divider,
  Icon,
  IconButton,
} from "@/components/ui";
import type { StudioToolId } from "@/lib/editor/store";
import type { ReactNode } from "react";

export interface StudioHeaderProps {
  sectionTitle: string;
  projectTitle?: string | null;
  projectId?: string | null;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  autosaveEnabled?: boolean;
  activeTool: StudioToolId;
  fullscreen: boolean;
  hasRightPanel: boolean;
  rightPanelOpen: boolean;
  actions?: ReactNode;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onToggleAutosave?: () => void;
  onOpenImportModal?: () => void;
  onSelectTool: (tool: StudioToolId) => void;
  onToggleNav: () => void;
  onToggleRightPanel: () => void;
  onToggleFullscreen: () => void;
}

export function StudioHeader({
  sectionTitle,
  projectTitle,
  projectId,
  dirty,
  saving,
  saveError,
  canUndo,
  canRedo,
  autosaveEnabled = false,
  fullscreen,
  hasRightPanel,
  rightPanelOpen,
  actions,
  onUndo,
  onRedo,
  onSave,
  onToggleAutosave,
  onOpenImportModal,
  onToggleNav,
  onToggleRightPanel,
  onToggleFullscreen,
}: StudioHeaderProps) {
  return (
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-900/85 px-4 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onToggleNav}
          aria-label="Toggle studio navigation"
          className="focus-ring rounded-md p-1.5 text-ink-300 hover:text-ink-100 lg:hidden"
        >
          <Icon name="panel-left" size={16} />
        </button>

        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-xs">
          <Link
            href="/games"
            className="focus-ring rounded px-1 py-0.5 text-ink-400 transition hover:text-ink-100"
          >
            Studio
          </Link>
          {projectTitle && projectId ? (
            <>
              <span className="text-ink-400/60">/</span>
              <Link
                href={`/projects/${projectId}`}
                className="focus-ring max-w-[200px] truncate rounded px-1 py-0.5 font-medium text-ink-200 transition hover:text-ink-100"
              >
                {projectTitle}
              </Link>
            </>
          ) : null}
          <span className="text-ink-400/60">/</span>
          <h1 className="truncate font-semibold text-ink-100">{sectionTitle}</h1>
        </nav>

        {projectId ? (
          <span data-testid="studio-dirty-indicator">
            <Badge
              tone={
                saveError
                  ? "danger"
                  : saving
                    ? "accent"
                    : dirty
                      ? "warning"
                      : "success"
              }
            >
              {saveError
                ? "Save failed"
                : saving
                  ? "Saving…"
                  : dirty
                    ? "Unsaved"
                    : "Saved"}
            </Badge>
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {projectId ? (
          <>
            <div role="group" aria-label="Editor history" className="flex items-center gap-1">
              <IconButton
                icon="undo"
                label="Undo"
                title="Undo (Ctrl/⌘ + Z)"
                disabled={!canUndo}
                onClick={onUndo}
              />
              <IconButton
                icon="redo"
                label="Redo"
                title="Redo (Ctrl/⌘ + Shift + Z)"
                disabled={!canRedo}
                onClick={onRedo}
              />
            </div>

            <Divider vertical />
          </>
        ) : null}

        {actions}

        {projectId && onOpenImportModal ? (
          <Button
            variant="outline"
            onClick={onOpenImportModal}
            data-testid="studio-import-blueprint-btn"
            title="Import & migrate GameBlueprint JSON"
          >
            <Icon name="upload" size={13} />
            Import
          </Button>
        ) : null}

        {projectId && onToggleAutosave ? (
          <button
            type="button"
            role="switch"
            aria-checked={autosaveEnabled}
            data-testid="studio-autosave-toggle"
            onClick={onToggleAutosave}
            title="Toggle optional automatic blueprint saving"
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${
              autosaveEnabled
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                : "border-white/[0.1] bg-white/[0.03] text-ink-300 hover:border-white/[0.2] hover:text-ink-100"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                autosaveEnabled ? "bg-emerald-400" : "bg-ink-400"
              }`}
            />
            Autosave {autosaveEnabled ? "On" : "Off"}
          </button>
        ) : null}

        {projectId ? (
          <Button
            variant="primary"
            disabled={!dirty || saving}
            onClick={onSave}
            data-testid="studio-save-btn"
            title="Save project blueprint (Ctrl/⌘ + S)"
          >
            <Icon name="save" size={13} />
            {saving ? "Saving…" : "Save"}
          </Button>
        ) : null}

        <IconButton
          icon="maximize"
          label="Toggle fullscreen"
          title="Fullscreen (F)"
          active={fullscreen}
          onClick={onToggleFullscreen}
        />

        {hasRightPanel ? (
          <IconButton
            icon="panel-right"
            label="Toggle inspector panel"
            active={rightPanelOpen}
            onClick={onToggleRightPanel}
          />
        ) : null}
      </div>
    </header>
  );
}
