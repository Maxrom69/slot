"use client";

import { StudioShell } from "@/components/shell/StudioShell";
import {
  Badge,
  NumberInput,
  Panel,
  PropertyRow,
  Section,
  Select,
  Toggle,
} from "@/components/ui";
import type { Volatility } from "@/lib/blueprint/types";
import { StudioEditorProvider, useStudioEditor } from "@/lib/editor/EditorProvider";
import type { ProjectDetail } from "@/lib/workspace/types";

export function MathFeaturesWorkspace({ project }: { project: ProjectDetail }) {
  return (
    <StudioEditorProvider
      initialProject={{
        id: project.id,
        title: project.title,
        revision: project.revision,
        blueprint: project.blueprint,
      }}
    >
      <MathFeaturesInner />
    </StudioEditorProvider>
  );
}

function MathFeaturesInner() {
  const editor = useStudioEditor();
  const active = editor.state.activeProject;
  if (!active) return null;

  const bp = active.blueprint;
  const { math, reels, paylines, features } = bp;

  const rightPanel = (
    <div className="space-y-4">
      <Section title="Configuration Notice">
        <p className="text-[11px] leading-relaxed text-ink-400">
          Math and feature settings in SECTION 1 are declarative configuration data
          stored in the Game Blueprint. Actual Monte Carlo verification, RTP certification,
          and spin evaluation happen in SECTION 2 — Backend Slot Game Engine.
        </p>
      </Section>

      <Section title="Summary">
        <PropertyRow label="RTP Target">
          <span className="font-mono text-xs text-ink-100">{math.rtpTarget}%</span>
        </PropertyRow>
        <PropertyRow label="Volatility">
          <Badge tone="accent">{math.volatility}</Badge>
        </PropertyRow>
        <PropertyRow label="Active Lines">
          <span className="font-mono text-xs text-ink-100">
            {paylines.filter((p) => p.active).length} / {paylines.length}
          </span>
        </PropertyRow>
        <PropertyRow label="Wild Symbols">
          <span className="font-mono text-xs text-amber-200">
            {bp.symbols
              .filter(
                (s) =>
                  s.isWild ||
                  bp.specialSymbols.some(
                    (sp) => sp.symbolId === s.id && sp.behaviour === "wild",
                  ),
              )
              .map((s) => s.code)
              .join(", ") || "None"}
          </span>
        </PropertyRow>
        <PropertyRow label="Enabled Features">
          <span className="font-mono text-xs text-ink-100">
            {features.filter((f) => f.enabled).length} / {features.length}
          </span>
        </PropertyRow>
      </Section>
    </div>
  );

  return (
    <StudioShell
      activeSection="math"
      sectionTitle="Math & Features Configuration"
      rightPanel={rightPanel}
      rightPanelTitle="Math Summary"
    >
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel
          title="Math Target Configuration"
          subtitle="Declarative parameters for SECTION 2 engine"
        >
          <div className="space-y-3">
            <PropertyRow label="RTP Target (%)" hint="Target return to player">
              <NumberInput
                ariaLabel="RTP target"
                value={math.rtpTarget}
                min={80}
                max={99.5}
                step={0.1}
                unit="%"
                onChange={(next) =>
                  editor.dispatchCommand(
                    "UPDATE_MATH",
                    { patch: { rtpTarget: next } },
                    "Update RTP target",
                  )
                }
              />
            </PropertyRow>

            <PropertyRow label="Volatility" hint="Variance profile">
              <Select
                aria-label="Volatility"
                value={math.volatility}
                onChange={(e) =>
                  editor.dispatchCommand(
                    "UPDATE_MATH",
                    { patch: { volatility: e.target.value as Volatility } },
                    "Update volatility",
                  )
                }
                className="w-36 text-xs"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="extreme">Extreme</option>
              </Select>
            </PropertyRow>

            <PropertyRow label="Max Win Cap" hint="Multiplier of base bet">
              <NumberInput
                ariaLabel="Max win cap"
                value={math.maxWinX}
                min={100}
                max={100000}
                step={500}
                unit="x"
                onChange={(next) =>
                  editor.dispatchCommand(
                    "UPDATE_MATH",
                    { patch: { maxWinX: next } },
                    "Update max win cap",
                  )
                }
              />
            </PropertyRow>

            <PropertyRow label="Hit Frequency" hint="Target win rate (%)">
              <NumberInput
                ariaLabel="Hit frequency"
                value={math.hitFrequency}
                min={5}
                max={60}
                step={0.5}
                unit="%"
                onChange={(next) =>
                  editor.dispatchCommand(
                    "UPDATE_MATH",
                    { patch: { hitFrequency: next } },
                    "Update hit frequency",
                  )
                }
              />
            </PropertyRow>
          </div>
        </Panel>

        <Panel
          title="Reel Grid Configuration"
          subtitle="Columns, rows, evaluation mode, and spin direction"
        >
          <div className="space-y-3">
            <PropertyRow label="Columns (Reels)">
              <NumberInput
                ariaLabel="Reel columns"
                value={reels.columns}
                min={3}
                max={8}
                step={1}
                onChange={(next) =>
                  editor.dispatchCommand(
                    "UPDATE_REEL",
                    { patch: { columns: next } },
                    "Update reel columns",
                  )
                }
              />
            </PropertyRow>

            <PropertyRow label="Rows">
              <NumberInput
                ariaLabel="Reel rows"
                value={reels.rows}
                min={2}
                max={8}
                step={1}
                onChange={(next) =>
                  editor.dispatchCommand(
                    "UPDATE_REEL",
                    { patch: { rows: next } },
                    "Update reel rows",
                  )
                }
              />
            </PropertyRow>

            <PropertyRow label="Evaluation Mode">
              <Select
                aria-label="Evaluation mode"
                value={reels.evaluation}
                onChange={(e) =>
                  editor.dispatchCommand(
                    "UPDATE_REEL",
                    {
                      patch: {
                        evaluation: e.target.value as "lines" | "ways" | "cluster",
                      },
                    },
                    "Update evaluation mode",
                  )
                }
                className="w-36 text-xs"
              >
                <option value="lines">Lines</option>
                <option value="ways">Ways</option>
                <option value="cluster">Cluster</option>
              </Select>
            </PropertyRow>

            <PropertyRow label="Spin Direction">
              <Select
                aria-label="Spin direction"
                value={reels.spinDirection}
                onChange={(e) =>
                  editor.dispatchCommand(
                    "UPDATE_REEL",
                    {
                      patch: {
                        spinDirection: e.target.value as "down" | "up",
                      },
                    },
                    "Update spin direction",
                  )
                }
                className="w-36 text-xs"
              >
                <option value="down">Down</option>
                <option value="up">Up</option>
              </Select>
            </PropertyRow>

            <div className="pt-2">
              <a
                href={`/projects/${active.id}/reels`}
                className="focus-ring inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-accent-500/40 bg-accent-600/15 px-3 py-2 text-xs font-semibold text-ink-100 transition hover:bg-accent-600/25"
              >
                Open Reel Configuration Editor (F14) →
              </a>
            </div>
          </div>
        </Panel>

        <Panel
          title={`Features (${features.length})`}
          subtitle="Toggle bonus and gameplay features in the blueprint"
        >
          <div className="space-y-2.5">
            {features.map((feat) => (
              <div
                key={feat.id}
                className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-ink-850 px-3.5 py-2.5"
              >
                <div>
                  <div className="text-xs font-semibold text-ink-100">{feat.name}</div>
                  <div className="font-mono text-[10.5px] text-ink-400">
                    {feat.kind} ·{" "}
                    {Object.entries(feat.params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(", ")}
                  </div>
                </div>
                <Toggle
                  label={`Enable ${feat.name}`}
                  checked={feat.enabled}
                  onChange={(enabled) =>
                    editor.dispatchCommand(
                      "UPDATE_FEATURE",
                      { featureId: feat.id, patch: { enabled } },
                      `${enabled ? "Enable" : "Disable"} ${feat.name}`,
                    )
                  }
                />
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title={`Paylines (${paylines.length})`}
          subtitle="Configure active payline patterns across columns"
        >
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {paylines.map((line) => (
              <div
                key={line.id}
                className="flex items-center justify-between rounded-md border border-white/[0.07] bg-ink-850 px-3 py-1.5 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-[11px] font-semibold text-ink-200">
                    Line #{line.index}
                  </span>
                  <span className="font-mono text-[10.5px] text-ink-400">
                    [{line.pattern.join(", ")}]
                  </span>
                </div>
                <Toggle
                  label={`Toggle payline ${line.index}`}
                  checked={line.active}
                  onChange={(activeState) =>
                    editor.dispatchCommand(
                      "UPDATE_PAYLINE",
                      { paylineId: line.id, patch: { active: activeState } },
                      `Toggle payline #${line.index}`,
                    )
                  }
                />
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-white/[0.07] space-y-2">
            <a
              href={`/projects/${active.id}/paylines`}
              className="focus-ring inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-accent-500/40 bg-accent-600/15 px-3 py-2 text-xs font-semibold text-ink-100 transition hover:bg-accent-600/25"
            >
              Open Payline Configuration Editor (F15) →
            </a>
            <a
              href={`/projects/${active.id}/paytable`}
              className="focus-ring inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/25"
            >
              Open Paytable Configuration Editor (F16) →
            </a>
          </div>
        </Panel>
      </div>
    </StudioShell>
  );
}
