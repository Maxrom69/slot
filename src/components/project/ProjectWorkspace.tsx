"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select, TextArea, TextInput } from "@/components/ui/Controls";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";
import { saveWorkspaceBlueprint, workspaceApi } from "@/lib/client/workspace-api";
import {
  BlueprintImportModal,
  IntegrationFlowBar,
} from "@/components/studio/IntegrationModals";
import { STATUS_TONE, formatRelative } from "@/lib/workspace/selectors";
import {
  STATUS_LABELS,
  type FolderSummary,
  type ProjectDetail,
} from "@/lib/workspace/types";
import type { ProjectStatus } from "@/lib/blueprint/types";

type Tab = "overview" | "blueprint";

export function ProjectWorkspace({
  project: initialProject,
  folders,
  initialTab = "overview",
}: {
  project: ProjectDetail;
  folders: FolderSummary[];
  initialTab?: Tab;
}) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [draft, setDraft] = useState({
    title: initialProject.title,
    theme: initialProject.theme,
    styleGuide: initialProject.styleGuide,
    description: initialProject.description,
    status: initialProject.status,
    folderPath: initialProject.folderPath,
  });
  const [saving, setSaving] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const dirty = useMemo(
    () =>
      draft.title !== project.title ||
      draft.theme !== project.theme ||
      draft.styleGuide !== project.styleGuide ||
      draft.description !== project.description ||
      draft.status !== project.status ||
      draft.folderPath !== project.folderPath,
    [draft, project],
  );

  const save = useCallback(async () => {
    if (!dirty || !draft.title.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      const updated = await workspaceApi.updateProject(project.id, draft);
      setProject(updated);
      setMessage("Saved to the project store");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [dirty, draft, project.id, router]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);

  useEffect(() => {
    if (!autosaveEnabled || !dirty || saving) return;
    const timer = setTimeout(() => {
      void save();
    }, 900);
    return () => clearTimeout(timer);
  }, [autosaveEnabled, dirty, saving, save]);

  const bp = project.blueprint;

  return (
    <div className="flex min-h-screen flex-col bg-ink-950">
      <ProjectTopNav projectId={project.id} projectTitle={project.title} />

      <header className="flex flex-wrap items-center gap-3 border-b border-white/[0.07] bg-ink-900/80 px-5 py-2.5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">
            {project.title}
          </h1>
          <p className="truncate text-[11px] text-ink-400">
            {project.folderPath || "Root"} · {project.theme} · updated{" "}
            {formatRelative(project.updatedAt)}
          </p>
        </div>
        <span
          className={`rounded border px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wider uppercase ${STATUS_TONE[project.status]}`}
        >
          {STATUS_LABELS[project.status]}
        </span>
        <span
          data-testid="project-workspace-dirty-indicator"
          className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase ${
            dirty
              ? "border-amber-400/40 bg-amber-500/15 text-amber-200"
              : "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {saving ? "Saving…" : dirty ? "Unsaved" : "Saved"}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button onClick={() => setImportModalOpen(true)}>
            Import blueprint
          </Button>
          <Button
            onClick={() => {
              window.location.href = `/api/projects/${project.id}/export`;
            }}
          >
            Export blueprint
          </Button>
          <button
            type="button"
            role="switch"
            aria-checked={autosaveEnabled}
            onClick={() => setAutosaveEnabled((v) => !v)}
            className={`rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition ${
              autosaveEnabled
                ? "border-emerald-400/50 bg-emerald-500/15 text-emerald-200"
                : "border-white/10 bg-ink-850 text-ink-300 hover:text-ink-100"
            }`}
          >
            Autosave {autosaveEnabled ? "On" : "Off"}
          </button>
          <Button variant="primary" disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1 border-b border-white/[0.07] bg-ink-900/40 px-5">
        {(["overview", "blueprint"] as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`focus-ring -mb-px border-b-2 px-3 py-2 text-[12px] capitalize transition ${
              tab === item
                ? "border-accent-500 text-ink-100"
                : "border-transparent text-ink-400 hover:text-ink-200"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div
        className={`flex-1 overflow-y-auto p-5 ${
          "grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]"
        }`}
      >
        <aside className="space-y-3">
          <section className="rounded-lg border border-white/[0.07] bg-ink-900 p-4">
            <h2 className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
              Project metadata
            </h2>
            <div className="grid gap-3">
              <Field label="Title" required>
                <TextInput
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, title: event.target.value }))
                  }
                />
              </Field>
              <Field label="Theme">
                <TextInput
                  value={draft.theme}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, theme: event.target.value }))
                  }
                />
              </Field>
              <Field label="Style guide">
                <TextInput
                  value={draft.styleGuide}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, styleGuide: event.target.value }))
                  }
                />
              </Field>
              <Field label="Description">
                <TextArea
                  rows={3}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, description: event.target.value }))
                  }
                />
              </Field>
              <Field label="Status">
                <Select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((d) => ({
                      ...d,
                      status: event.target.value as ProjectStatus,
                    }))
                  }
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Folder">
                <Select
                  value={draft.folderPath}
                  onChange={(event) =>
                    setDraft((d) => ({ ...d, folderPath: event.target.value }))
                  }
                >
                  <option value="">Your Games (root)</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.path}>
                      {folder.path}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {message ? (
              <p className="mt-3 text-[11px] text-ink-300">{message}</p>
            ) : null}
            <p className="mt-3 text-[10.5px] text-ink-400">
              ⌘S saves. Changes are written to the project store immediately.
            </p>
          </section>
        </aside>

        <section className="space-y-4">
          <IntegrationFlowBar blueprint={bp} activeStage="project" />
          {tab === "overview" ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Metric label="Grid" value={`${bp.reels.columns}×${bp.reels.rows}`} />
                <Metric label="Evaluation" value={bp.reels.evaluation} />
                <Metric label="Paylines" value={String(bp.paylines.length)} />
                <Metric label="Symbols" value={String(bp.symbols.length)} />
                <Metric label="RTP target" value={`${bp.math.rtpTarget}%`} />
                <Metric label="Volatility" value={bp.math.volatility} />
                <Metric label="Scenes" value={String(bp.scenes.length)} />
                <Metric label="Assets" value={String(bp.assets.length)} />
              </div>

              <Panel title="Symbols">
                <div className="flex flex-wrap gap-1.5">
                  {bp.symbols.map((symbol) => (
                    <span
                      key={symbol.id}
                      className="flex items-center gap-1.5 rounded-md border border-white/10 bg-ink-850 px-2 py-1 text-[11px]"
                      title={`${symbol.name} · ${symbol.tier}`}
                    >
                      <span>{symbol.glyph}</span>
                      <span className="text-ink-300">{symbol.name}</span>
                      <span className="font-mono text-[10px] text-ink-400">
                        {symbol.tier}
                      </span>
                    </span>
                  ))}
                </div>
              </Panel>

              <Panel title="Features">
                <ul className="grid gap-1.5 text-[11.5px]">
                  {bp.features.map((feature) => (
                    <li
                      key={feature.id}
                      className="flex items-center justify-between rounded-md border border-white/[0.07] bg-ink-850 px-2.5 py-1.5"
                    >
                      <span className="text-ink-200">{feature.name}</span>
                      <span
                        className={
                          feature.enabled ? "text-emerald-300" : "text-ink-400"
                        }
                      >
                        {feature.enabled ? "enabled" : "disabled"}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel title="Layers & scenes">
                <div className="grid gap-3 md:grid-cols-2">
                  <ul className="space-y-1 text-[11.5px] text-ink-300">
                    {bp.layers.map((layer) => (
                      <li key={layer.id} className="flex justify-between">
                        <span>{layer.name}</span>
                        <span className="font-mono text-[10px] text-ink-400">
                          {layer.kind} · z{layer.order}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <ul className="space-y-1 text-[11.5px] text-ink-300">
                    {bp.scenes.map((scene) => (
                      <li key={scene.id} className="flex justify-between">
                        <span>{scene.name}</span>
                        <span className="font-mono text-[10px] text-ink-400">
                          {scene.layerIds.length} layers
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>

              <Panel title="Runtime">
                <p className="text-[11.5px] leading-relaxed text-ink-400">
                  Playable spin logic is not part of the studio. The blueprint above
                  is the contract for the SECTION 2 slot-game engine; no spin results
                  are simulated here.
                </p>
              </Panel>
            </>
          ) : (
            <Panel title="Game Blueprint (read-only JSON)">
              <pre className="max-h-[70vh] overflow-auto rounded-md border border-white/[0.07] bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-ink-300">
                {JSON.stringify(bp, null, 2)}
              </pre>
            </Panel>
          )}
        </section>
      </div>

      {importModalOpen ? (
        <BlueprintImportModal
          onClose={() => setImportModalOpen(false)}
          onImportSuccess={async (importedBp, result) => {
            const nextBp = {
              ...importedBp,
              meta: {
                ...importedBp.meta,
                id: project.id,
              },
            };
            const saved = await saveWorkspaceBlueprint(
              project.id,
              nextBp,
              project.revision,
            );
            if (saved.ok) {
              setProject(saved.data);
              setDraft({
                title: saved.data.title,
                theme: saved.data.theme,
                styleGuide: saved.data.styleGuide,
                description: saved.data.description,
                status: saved.data.status,
                folderPath: saved.data.folderPath,
              });
              setMessage(
                result.migrated
                  ? `Imported & migrated blueprint (v${result.sourceVersion ?? 0} → v${result.targetVersion})`
                  : "Imported blueprint and saved to project store",
              );
              router.refresh();
            } else {
              setMessage(saved.message ?? "Failed to save imported blueprint");
            }
            setImportModalOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-ink-900 px-3 py-2.5">
      <div className="text-[10px] tracking-wider text-ink-400 uppercase">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-ink-100 capitalize">
        {value}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-white/[0.07] bg-ink-900 p-4">
      <h2 className="mb-3 text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}
