"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { ConfirmDialog } from "./Dialogs";
import { SideNav } from "./SideNav";
import { AgentTab } from "@/components/creation/AgentTab";
import { AdvancedSettings } from "@/components/creation/AdvancedSettings";
import { ArtworkImportPanel } from "@/components/creation/ArtworkImport";
import { BlueprintDialog } from "@/components/creation/BlueprintDialog";
import { ElementsPanel } from "@/components/creation/ElementsPanel";
import { GameSettingsPanel } from "@/components/creation/GameSettingsPanel";
import { GridPanel } from "@/components/creation/GridPanel";
import { SummaryPanel } from "@/components/creation/SummaryPanel";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { projectPersistence } from "@/lib/persistence/project-persistence";
import { useDraftEditor } from "@/lib/client/useDraftEditor";
import { validateDraft } from "@/lib/creation/draft";
import { CREATION_PROVIDERS, type CreationProviderId } from "@/lib/creation/providers";
import type { FolderSummary } from "@/lib/workspace/types";

/** Page orchestration only. Draft construction, validation, history and storage live in services. */
export function NewGameWorkflow({ folders, initialFolder }: { folders: FolderSummary[]; initialFolder: string }) {
  const router = useRouter();
  const editor = useDraftEditor(initialFolder);
  const { draft, blueprint } = editor;
  const [tab, setTab] = useState<CreationProviderId>("manual");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [restoreDismissed, setRestoreDismissed] = useState(false);
  const [imports, setImports] = useState({ reference: false, artwork: false });
  const submitLock = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const manualTab = useRef<HTMLButtonElement>(null), agentTab = useRef<HTMLButtonElement>(null);
  const validation = useMemo(() => validateDraft(draft), [draft]);
  const blueprintCheck = useMemo(() => validateBlueprint(blueprint), [blueprint]);
  const importing = imports.reference || imports.artwork;
  const locked = submitting || !editor.hydrated;
  const reportError = useCallback((message: string) => setNotice(message), []);
  const referenceBusy = useCallback((reference: boolean) => setImports((current) => ({ ...current, reference })), []);
  const artworkBusy = useCallback((artwork: boolean) => setImports((current) => ({ ...current, artwork })), []);

  const create = useCallback(async () => {
    if (submitLock.current || !editor.hydrated) return;
    if (importing) { setNotice("Finish importing artwork before creating the project."); return; }
    setError(null);
    if (Object.keys(validation.errors).length || !blueprintCheck.ok) {
      setShowErrors(true);
      const first = Object.keys(validation.errors)[0];
      const selector = first === "title" ? "#game-title" : first === "theme" ? "#game-theme" : first === "folder" ? 'input[aria-label="Folder"]' : first === "symbols" ? 'input[aria-label="high symbols count"]' : 'input[aria-invalid="true"]';
      window.setTimeout(() => formRef.current?.querySelector<HTMLInputElement>(selector)?.focus(), 0);
      if (!Object.keys(validation.errors).length) setError(blueprintCheck.issues[0] ?? "Check the blueprint configuration.");
      return;
    }
    submitLock.current = true;
    setSubmitting(true);
    try {
      const project = await projectPersistence.createProject({ draft, title: draft.title, theme: draft.theme });
      await editor.discardStored();
      router.push(`/projects/${project.id}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the project. Your draft is preserved.");
      submitLock.current = false;
      setSubmitting(false);
    }
  }, [editor, importing, validation, blueprintCheck, draft, router]);

  const leave = useCallback(async (path = "") => {
    if (submitLock.current) return;
    await editor.flush();
    router.push(path ? `/games?folder=${encodeURIComponent(path)}` : "/games");
  }, [editor, router]);
  const closeInspect = useCallback(() => setInspectOpen(false), []);
  const closeReset = useCallback(() => setResetOpen(false), []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (tab !== "manual" || locked || inspectOpen || resetOpen || !(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z") { event.preventDefault(); if (event.shiftKey) editor.redo(); else editor.undo(); }
      else if (key === "y") { event.preventDefault(); editor.redo(); }
      else if (key === "s") { event.preventDefault(); void editor.flush(); }
      else if (key === "enter") { event.preventDefault(); void create(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editor, create, tab, locked, inspectOpen, resetOpen]);

  return <div className="creation-studio flex h-dvh min-h-0 overflow-hidden">
    <div className="hidden xl:block"><SideNav folders={folders} currentFolder={draft.folderPath} onNavigateFolder={(path) => void leave(path)} /></div>
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] bg-ink-900/70 px-5 sm:px-6">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[11px]">
          <button type="button" disabled={submitting} onClick={() => void leave()} className="focus-ring flex items-center gap-1.5 rounded text-ink-300 hover:text-ink-100"><Icon name="grid" size={14} />Your Games</button>
          <Icon name="chevron-right" size={11} className="text-ink-400" /><span className="text-ink-100">New Game</span>
        </nav>
        <div className="flex items-center gap-2.5 text-[10px]">
          <span role="status" aria-live="polite" className="hidden items-center gap-1.5 text-ink-300 sm:inline-flex">
            <span className={`h-1.5 w-1.5 rounded-full ${editor.saveState === "saved" ? "bg-emerald-400/80" : editor.saveState === "error" ? "bg-amber-400" : "bg-ink-400"}`} />
            {editor.saveState === "saved" ? "Draft saved locally" : editor.saveState === "saving" ? "Saving draft…" : editor.saveState === "error" ? "Draft not saved" : "Restoring draft…"}
          </span>
          <span className="mx-1 hidden h-4 w-px bg-white/10 sm:block" />
          <Button variant="ghost" aria-label="Undo" disabled={!editor.canUndo || locked || tab !== "manual"} onClick={editor.undo} title="Undo (Ctrl/⌘ Z)" className="h-7 px-1.5"><Icon name="undo" size={15} /></Button>
          <Button variant="ghost" aria-label="Redo" disabled={!editor.canRedo || locked || tab !== "manual"} onClick={editor.redo} title="Redo (Ctrl/⌘ Shift Z)" className="h-7 px-1.5"><Icon name="redo" size={15} /></Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto" onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => event.preventDefault()}>
        <div className="mx-auto max-w-[1540px] px-4 pt-6 pb-6 sm:px-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div><p className="mb-1.5 text-[9px] font-semibold tracking-[0.2em] text-accent-400 uppercase">Project setup</p><h1 className="text-[25px] leading-tight font-semibold tracking-[-0.035em] text-ink-100">Create a new game</h1>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-300/80">Start with an idea. Define the blueprint. Make it yours.</p></div>
            <span className="mt-2 hidden items-center gap-1.5 rounded-md border border-white/[0.07] px-2.5 py-1.5 text-[10px] text-ink-300 md:inline-flex"><Icon name="file" size={13} />Game Blueprint v1</span>
          </div>
          <div className="mb-5 flex items-center justify-between border-b border-white/[0.08]">
            <div role="tablist" aria-label="Creation mode" className="flex items-center gap-4" onKeyDown={(event) => {
              if (submitting || importing) return;
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? "manual" : event.key === "End" ? "agent" : tab === "manual" ? "agent" : "manual"; setTab(next); (next === "manual" ? manualTab : agentTab).current?.focus(); }
            }}>
              {CREATION_PROVIDERS.map((provider) => <button key={provider.id} ref={provider.id === "manual" ? manualTab : agentTab} type="button" role="tab" id={`creation-tab-${provider.id}`} aria-controls={`creation-panel-${provider.id}`} aria-selected={tab === provider.id} tabIndex={tab === provider.id ? 0 : -1} disabled={submitting || importing}
                onClick={() => setTab(provider.id)} className={`focus-ring -mb-px flex items-center gap-2 border-b-2 px-1 pt-1 pb-3 text-[12px] font-medium transition ${tab === provider.id ? "border-accent-500 text-ink-100" : "border-transparent text-ink-300/60 hover:text-ink-200"}`}>
                <Icon name={provider.id === "manual" ? "pencil" : "lock"} size={14} />{provider.label}
                {provider.badge ? <span className="rounded border border-white/10 bg-white/[0.015] px-1.5 py-0.5 text-[8px] font-medium tracking-wider text-ink-400 uppercase">Coming soon</span> : null}
              </button>)}
            </div>
            <span className="hidden pb-2.5 text-[10px] text-ink-300/60 sm:block">{tab === "manual" ? "Your creative direction. Full control." : "Reserved for a future phase."}</span>
          </div>

          {tab === "agent" ? <div role="tabpanel" id="creation-panel-agent" aria-labelledby="creation-tab-agent"><AgentTab onSwitchToManual={() => setTab("manual")} /></div> :
            <div role="tabpanel" id="creation-panel-manual" aria-labelledby="creation-tab-manual">
              {editor.restored && !restoreDismissed ? <div className="mb-4 flex items-center gap-2 rounded-lg border border-accent-500/15 bg-accent-500/[0.04] px-3 py-2 text-[11px] text-ink-300"><Icon name="save" size={13} className="text-accent-400" /><span className="flex-1">Your unfinished draft has been restored, including imported artwork.</span><button type="button" onClick={() => setRestoreDismissed(true)} aria-label="Dismiss restored draft notice" className="focus-ring rounded p-1"><Icon name="x" size={12} /></button></div> : null}
              {editor.persistWarning || notice || error ? <div role="alert" className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] p-3 text-[11px] text-amber-200"><Icon name="alert" size={15} className="shrink-0" /><p className="flex-1 leading-relaxed">{error || notice || editor.persistWarning}</p>{notice || error ? <button type="button" onClick={() => { setNotice(null); setError(null); }} aria-label="Dismiss error" className="focus-ring rounded p-0.5"><Icon name="x" size={12} /></button> : null}</div> : null}
              <form id="manual-project-form" ref={formRef} noValidate onSubmit={(event) => { event.preventDefault(); void create(); }}>
                <fieldset disabled={locked} className="m-0 min-w-0 border-0 p-0">
                  <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="min-w-0 space-y-4">
                      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2">
                        <GameSettingsPanel draft={draft} errors={validation.errors} showErrors={showErrors} folders={folders} patch={editor.patch} onError={reportError} onImportBusyChange={referenceBusy} />
                        <div className="min-w-0 space-y-4"><GridPanel draft={draft} errors={validation.errors} showErrors={showErrors} patch={editor.patch} /><ElementsPanel draft={draft} errors={validation.errors} showErrors={showErrors} update={editor.update} /></div>
                      </div>
                      <ArtworkImportPanel artwork={draft.artwork} onError={reportError} onBusyChange={artworkBusy} disabled={locked}
                        onAdd={(items) => editor.update((d) => ({ ...d, artwork: [...d.artwork, ...items] }))}
                        onChangeItem={(id, change) => editor.update((d) => ({ ...d, artwork: d.artwork.map((a) => a.id === id ? { ...a, ...change } : a) }), change.name !== undefined ? `artwork-name:${id}` : undefined)}
                        onRemove={(id) => editor.update((d) => ({ ...d, artwork: d.artwork.filter((a) => a.id !== id) }))} />
                      {showErrors && validation.errors.artwork ? <p role="alert" className="text-[11px] text-rose-300">{validation.errors.artwork}</p> : null}
                      <AdvancedSettings draft={draft} patch={editor.patch} errors={validation.errors} showErrors={showErrors} />
                    </div>
                    <div className="lg:sticky lg:top-5"><SummaryPanel draft={draft} blueprint={blueprint} blueprintCheck={blueprintCheck} validation={validation} onInspect={() => setInspectOpen(true)} /></div>
                  </div>
                </fieldset>
              </form>
            </div>}
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-white/[0.08] bg-[#10141c] px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-[10px] text-ink-300/70 md:inline-flex"><Icon name="shield" size={13} />Local workspace · no credits or billing</span>
          {tab === "manual" ? <button type="button" disabled={locked || importing} onClick={() => setResetOpen(true)} className="focus-ring rounded text-[10px] text-ink-400 transition hover:text-ink-200 disabled:opacity-40">Reset form</button> : null}
        </div>
        <div className="flex items-center gap-2.5"><Button variant="ghost" disabled={submitting} onClick={() => void leave()} className="px-4 py-2">Cancel</Button>
          {tab === "manual" ? <Button type="submit" form="manual-project-form" variant="primary" disabled={locked || importing} className="min-w-36 px-4 py-2.5" title="Create Game (Ctrl/⌘ Enter)"><Icon name={submitting ? "save" : "plus"} size={15} />{submitting ? "Saving project…" : "Create Game"}<kbd className="ml-2 hidden rounded border border-white/20 px-1 text-[9px] text-white/65 sm:block">⌘ ↵</kbd></Button> : null}</div>
      </footer>
    </main>
    <BlueprintDialog blueprint={blueprint} open={inspectOpen} onClose={closeInspect} />
    <ConfirmDialog open={resetOpen} title="Reset this draft?" message="Return all settings to their defaults and remove imported artwork from the draft. This can be undone with Ctrl/⌘ Z." destructive={false} confirmLabel="Reset draft" onCancel={closeReset} onConfirm={() => { editor.reset(); setShowErrors(false); setError(null); setNotice(null); closeReset(); }} />
  </div>;
}
