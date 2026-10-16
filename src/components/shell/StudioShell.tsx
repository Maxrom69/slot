"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ErrorBoundary, Toasts } from "@/components/ui";
import type { Toast } from "@/lib/client/useWorkspace";
import { useStudioEditor } from "@/lib/editor/EditorProvider";
import { useStudioShortcuts } from "@/lib/keyboard/shortcuts";
import { StudioHeader } from "./StudioHeader";
import { StudioNav, type StudioNavSection } from "./StudioNav";
import { StudioStatusBar } from "./StudioStatusBar";
import { ProjectTopNav } from "./ProjectTopNav";
import { BlueprintImportModal } from "@/components/studio/IntegrationModals";

export interface StudioShellProps {
  activeSection: StudioNavSection;
  sectionTitle: string;
  headerActions?: ReactNode;
  rightPanel?: ReactNode;
  rightPanelTitle?: string;
  children: ReactNode;
}

export function StudioShell({
  activeSection,
  sectionTitle,
  headerActions,
  rightPanel,
  rightPanelTitle = "Inspector",
  children,
}: StudioShellProps) {
  const editor = useStudioEditor();
  const [navOpen, setNavOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [mobileRightOpen, setMobileRightOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  const pushToast = useCallback(
    (message: string, tone: Toast["tone"] = "info", undoable = false) => {
      toastSeq.current += 1;
      const id = `shell-toast-${toastSeq.current}`;
      setToasts((prev) => [...prev, { id, message, tone, undoable }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    },
    [],
  );

  const handleSave = useCallback(async () => {
    if (!editor.state.activeProject) return;
    const ok = await editor.saveActiveProject();
    if (ok) {
      pushToast("Project blueprint saved locally", "success");
    } else {
      pushToast(editor.saveError ?? "Failed to save project", "error");
    }
  }, [editor, pushToast]);

  const toggleFullscreen = useCallback(() => {
    const next = !editor.state.viewport.fullscreen;
    editor.updateViewport({ fullscreen: next });
    if (typeof document !== "undefined") {
      if (next && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else if (!next && document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [editor]);

  const shortcutHandlers = useMemo(
    () => ({
      select: () => editor.setActiveTool("select"),
      brush: (desc: { unavailableReason?: string }) =>
        pushToast(desc.unavailableReason ?? "Brush tool is not available yet", "info"),
      eraser: (desc: { unavailableReason?: string }) =>
        pushToast(desc.unavailableReason ?? "Eraser tool is not available yet", "info"),
      blur: (desc: { unavailableReason?: string }) =>
        pushToast(desc.unavailableReason ?? "Blur tool is not available yet", "info"),
      eyedropper: (desc: { unavailableReason?: string }) =>
        pushToast(desc.unavailableReason ?? "Eyedropper tool is not available yet", "info"),
      delete: () => {
        if (editor.state.selectedElementIds.length === 0) return;
        for (const id of editor.state.selectedElementIds) {
          editor.dispatchCommand("DELETE_ELEMENT", { id }, "Delete selected element");
        }
        editor.clearSelection();
      },
      undo: () => {
        if (editor.canUndo) editor.undo();
      },
      redo: () => {
        if (editor.canRedo) editor.redo();
      },
      save: () => {
        void handleSave();
      },
      fullscreen: () => toggleFullscreen(),
    }),
    [editor, handleSave, pushToast, toggleFullscreen],
  );

  useStudioShortcuts(shortcutHandlers, true);

  const activeProject = editor.state.activeProject;
  const navProject = activeProject
    ? {
        id: activeProject.id,
        title: activeProject.blueprint.meta.title,
        theme: activeProject.blueprint.meta.theme,
        status: activeProject.blueprint.meta.status,
        folderPath: activeProject.blueprint.meta.folderPath,
        blueprint: activeProject.blueprint,
      }
    : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-ink-950 text-ink-100">
      {activeProject && !editor.state.viewport.fullscreen ? (
        <ProjectTopNav
          projectId={activeProject.id}
          projectTitle={activeProject.blueprint.meta.title}
        />
      ) : null}

      <StudioHeader
        sectionTitle={sectionTitle}
        projectTitle={activeProject?.blueprint.meta.title ?? null}
        projectId={activeProject?.id ?? null}
        dirty={editor.state.dirty}
        saving={editor.saving}
        saveError={editor.saveError}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        autosaveEnabled={editor.autosaveEnabled}
        activeTool={editor.state.activeTool}
        fullscreen={editor.state.viewport.fullscreen}
        hasRightPanel={Boolean(rightPanel)}
        rightPanelOpen={rightPanelOpen}
        actions={headerActions}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onSave={() => void handleSave()}
        onToggleAutosave={() => {
          const next = !editor.autosaveEnabled;
          editor.setAutosaveEnabled(next);
          pushToast(
            next
              ? "Autosave enabled — changes will save automatically"
              : "Autosave disabled — use Save (Ctrl/⌘ + S)",
            "info",
          );
        }}
        onOpenImportModal={() => setImportModalOpen(true)}
        onSelectTool={editor.setActiveTool}
        onToggleNav={() => setNavOpen((v) => !v)}
        onToggleRightPanel={() => {
          if (typeof window !== "undefined" && window.innerWidth < 1280) {
            setMobileRightOpen((v) => !v);
          } else {
            setRightPanelOpen((v) => !v);
          }
        }}
        onToggleFullscreen={toggleFullscreen}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!editor.state.viewport.fullscreen ? (
          <StudioNav
            activeSection={activeSection}
            project={navProject}
            open={navOpen}
            onClose={() => setNavOpen(false)}
          />
        ) : null}

        <main className="min-w-0 flex-1 overflow-y-auto bg-ink-950 p-3 sm:p-5">
          <ErrorBoundary fallbackTitle={`${sectionTitle} workspace encountered an error`}>
            {children}
          </ErrorBoundary>
        </main>

        {rightPanel && !editor.state.viewport.fullscreen ? (
          <>
            {mobileRightOpen ? (
              <button
                type="button"
                aria-label="Close inspector"
                onClick={() => setMobileRightOpen(false)}
                className="fixed inset-0 z-30 bg-black/60 xl:hidden"
              />
            ) : null}
            <aside
              aria-label={rightPanelTitle}
              className={`fixed inset-y-0 right-0 z-40 w-[320px] max-w-[92vw] shrink-0 flex-col border-l border-white/[0.07] bg-ink-900 transition-transform xl:static xl:z-auto ${
                mobileRightOpen ? "flex translate-x-0" : "hidden"
              } ${rightPanelOpen ? "xl:flex xl:translate-x-0" : "xl:hidden"}`}
            >
              <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5 text-[10.5px] font-semibold tracking-[0.15em] text-ink-300 uppercase">
                <span>{rightPanelTitle}</span>
                <button
                  type="button"
                  aria-label="Close inspector panel"
                  onClick={() => setMobileRightOpen(false)}
                  className="rounded p-1 text-ink-400 hover:bg-white/[0.05] hover:text-ink-100 xl:hidden"
                >
                  <span aria-hidden="true">✕</span>
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4">{rightPanel}</div>
            </aside>
          </>
        ) : null}
      </div>

      <StudioStatusBar state={editor.state} />

      {importModalOpen && activeProject ? (
        <BlueprintImportModal
          onClose={() => setImportModalOpen(false)}
          onImportSuccess={(importedBp, result) => {
            const nextBp = {
              ...importedBp,
              meta: {
                ...importedBp.meta,
                id: activeProject.id,
              },
            };
            editor.replaceBlueprint(
              nextBp,
              `Import blueprint "${nextBp.meta.title}"`,
            );
            setImportModalOpen(false);
            pushToast(
              result.migrated
                ? `Imported & migrated blueprint "${nextBp.meta.title}" (v${result.sourceVersion ?? 0} → v${result.targetVersion})`
                : `Imported blueprint "${nextBp.meta.title}"`,
              "success",
              true,
            );
          }}
        />
      ) : null}

      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((prev) => prev.filter((t) => t.id !== id))}
        onUndo={editor.undo}
        canUndo={editor.canUndo}
      />
    </div>
  );
}
