"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StudioShell } from "@/components/shell/StudioShell";
import {
  IntegrationFlowBar,
  SymbolDeleteConfirmModal,
} from "@/components/studio/IntegrationModals";
import {
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  NumberInput,
  Panel,
  PropertyRow,
  Section,
  Select,
  Tabs,
  Thumbnail,
  Toggle,
} from "@/components/ui";
import type { SymbolDef, SymbolTier } from "@/lib/blueprint/types";
import { StudioEditorProvider, useStudioEditor } from "@/lib/editor/EditorProvider";
import type { ProjectDetail } from "@/lib/workspace/types";

export function SymbolsWorkspace({ project }: { project: ProjectDetail }) {
  return (
    <StudioEditorProvider
      initialProject={{
        id: project.id,
        title: project.title,
        revision: project.revision,
        blueprint: project.blueprint,
      }}
    >
      <SymbolsWorkspaceInner />
    </StudioEditorProvider>
  );
}

type TierFilter = "all" | SymbolTier;

function SymbolsWorkspaceInner() {
  const editor = useStudioEditor();
  const active = editor.state.activeProject;
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [query, setQuery] = useState("");
  const [pendingDeleteSymbolId, setPendingDeleteSymbolId] = useState<string | null>(null);

  const bp = active?.blueprint;

  const filteredSymbols = useMemo(() => {
    const symbols = bp?.symbols ?? [];
    const q = query.trim().toLowerCase();
    return symbols.filter((sym) => {
      if (tierFilter !== "all" && sym.tier !== tierFilter) return false;
      if (!q) return true;
      return (
        sym.name.toLowerCase().includes(q) ||
        sym.code.toLowerCase().includes(q)
      );
    });
  }, [bp?.symbols, query, tierFilter]);

  const assetMap = useMemo(
    () => new Map((bp?.assets ?? []).map((a) => [a.id, a.uri])),
    [bp?.assets],
  );

  if (!active || !bp) return null;

  const selectedId =
    editor.state.selectedElementIds[0] ?? bp.symbols[0]?.id ?? null;
  const selectedSymbol: SymbolDef | null =
    bp.symbols.find((s) => s.id === selectedId) ?? null;

  const rightPanel = selectedSymbol ? (
    <div className="space-y-4">
      <Section title="Symbol Identity">
        <Field label="Name">
          <Input
            aria-label="Symbol name"
            value={selectedSymbol.name}
            onChange={(e) =>
              editor.dispatchCommand(
                "UPDATE_SYMBOL",
                {
                  symbolId: selectedSymbol.id,
                  patch: { name: e.target.value },
                },
                `Rename symbol ${selectedSymbol.name}`,
              )
            }
          />
        </Field>
        <Field label="Code">
          <Input
            aria-label="Symbol code"
            value={selectedSymbol.code}
            onChange={(e) =>
              editor.dispatchCommand(
                "UPDATE_SYMBOL",
                {
                  symbolId: selectedSymbol.id,
                  patch: { code: e.target.value.toUpperCase() },
                },
                "Update symbol code",
              )
            }
          />
        </Field>
        <PropertyRow label="Tier">
          <Select
            aria-label="Symbol tier"
            value={selectedSymbol.tier}
            onChange={(e) =>
              editor.dispatchCommand(
                "UPDATE_SYMBOL",
                {
                  symbolId: selectedSymbol.id,
                  patch: { tier: e.target.value as SymbolTier },
                },
                "Change symbol tier",
              )
            }
            className="w-32"
          >
            <option value="low">Low</option>
            <option value="mid">Mid</option>
            <option value="high">High</option>
            <option value="special">Special</option>
          </Select>
        </PropertyRow>
        <PropertyRow label="Reel Weight">
          <NumberInput
            ariaLabel="Reel weight"
            value={selectedSymbol.reelWeight}
            min={1}
            max={100}
            onChange={(next) =>
              editor.dispatchCommand(
                "UPDATE_SYMBOL",
                {
                  symbolId: selectedSymbol.id,
                  patch: { reelWeight: next },
                },
                "Update symbol reel weight",
              )
            }
          />
        </PropertyRow>
      </Section>

      <Section title="Special Flags (Declarative)">
        <div className="space-y-2">
          <Toggle
            label="Wild Symbol"
            checked={Boolean(selectedSymbol.isWild)}
            onChange={(checked) =>
              editor.dispatchCommand(
                "UPDATE_SYMBOL",
                { symbolId: selectedSymbol.id, patch: { isWild: checked } },
                "Toggle Wild flag",
              )
            }
          />
          <Toggle
            label="Scatter Symbol"
            checked={Boolean(selectedSymbol.isScatter)}
            onChange={(checked) =>
              editor.dispatchCommand(
                "UPDATE_SYMBOL",
                { symbolId: selectedSymbol.id, patch: { isScatter: checked } },
                "Toggle Scatter flag",
              )
            }
          />
          <Toggle
            label="Bonus Symbol"
            checked={Boolean(selectedSymbol.isBonus)}
            onChange={(checked) =>
              editor.dispatchCommand(
                "UPDATE_SYMBOL",
                { symbolId: selectedSymbol.id, patch: { isBonus: checked } },
                "Toggle Bonus flag",
              )
            }
          />
        </div>
      </Section>

      <Section title="Payout Multipliers">
        <div className="space-y-1.5">
          {Object.entries(selectedSymbol.payouts).map(([count, mult]) => (
            <PropertyRow key={count} label={`${count} of a kind`}>
              <NumberInput
                ariaLabel={`${count} of a kind payout`}
                value={mult}
                min={0}
                max={50000}
                step={1}
                unit="x"
                onChange={(next) =>
                  editor.dispatchCommand(
                    "UPDATE_SYMBOL",
                    {
                      symbolId: selectedSymbol.id,
                      patch: {
                        payouts: { ...selectedSymbol.payouts, [count]: next },
                      },
                    },
                    `Update ${count}-of-a-kind payout`,
                  )
                }
              />
            </PropertyRow>
          ))}
        </div>
      </Section>

      <div className="space-y-2 pt-2">
        <Link
          href={`/projects/${active.id}/symbols/${selectedSymbol.id}`}
          className="focus-ring flex w-full items-center justify-center rounded-md border border-white/10 bg-ink-850 px-3 py-2 text-xs font-medium text-ink-200 transition hover:border-white/20 hover:text-ink-100"
        >
          Open Full Symbol Editor →
        </Link>
        <Link
          href={`/projects/${active.id}/paytable`}
          className="focus-ring flex w-full items-center justify-center rounded-md border border-accent-500/40 bg-accent-600/15 px-3 py-2 text-xs font-semibold text-ink-100 transition hover:bg-accent-600/25"
        >
          Open Paytable Configuration Editor (F16) →
        </Link>
        <Button
          variant="danger"
          data-testid={`delete-symbol-btn-${selectedSymbol.id}`}
          disabled={bp.symbols.length <= 1}
          onClick={() => setPendingDeleteSymbolId(selectedSymbol.id)}
          className="w-full"
        >
          Delete Symbol (Check Dependencies)…
        </Button>
      </div>
    </div>
  ) : (
    <p className="text-xs text-ink-400">Select a symbol to inspect and edit its configuration.</p>
  );

  return (
    <StudioShell
      activeSection="symbols"
      sectionTitle="Symbols & Sets"
      rightPanel={rightPanel}
      rightPanelTitle="Symbol Inspector"
    >
      <div className="space-y-5">
        <IntegrationFlowBar blueprint={bp} activeStage="symbol" compact />

        <Panel
          title="Symbol Sets"
          subtitle="Grouped symbol collections defined in the Game Blueprint"
        >
          {bp.symbolSets.length === 0 ? (
            <EmptyState
              title="No symbol sets defined"
              description="Add a symbol set in the Design workspace to organize symbols."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {bp.symbolSets.map((set) => (
                <div
                  key={set.id}
                  className="flex flex-col justify-between rounded-lg border border-white/[0.07] bg-ink-850 p-3.5"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-ink-100">{set.name}</span>
                      <Badge tone="accent">{set.valueTier ?? "standard"}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-ink-400">
                      {set.symbolIds.length} symbols · {set.symbolType ?? "custom"}
                    </p>
                  </div>
                  <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-2 text-[11px]">
                    <span className="font-mono text-ink-400">{set.id}</span>
                    <Link
                      href={`/projects/${active.id}/sets/${set.id}`}
                      className="text-accent-400 hover:underline"
                    >
                      Edit Set →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel
          title={`All Symbols (${filteredSymbols.length})`}
          subtitle="Select a symbol to edit its payouts, tier, and weights"
          actions={
            <div className="flex items-center gap-2">
              <Input
                aria-label="Filter symbols"
                placeholder="Search symbols…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-48 text-xs"
              />
              <Button
                variant="outline"
                data-testid="add-symbol-btn"
                onClick={() => {
                  const nextIdx = bp.symbols.length + 1;
                  const newSymId = `sym-custom-${Date.now().toString(36)}`;
                  const payouts: Record<string, number> = {};
                  for (let k = 3; k <= bp.reels.columns; k += 1) {
                    payouts[String(k)] = (k - 2) * 10;
                  }
                  const newSym: SymbolDef = {
                    id: newSymId,
                    code: `S${nextIdx}`,
                    name: `Symbol ${nextIdx}`,
                    tier: "mid",
                    glyph: "★",
                    assetId: null,
                    payouts,
                    reelWeight: 10,
                    symbolSetId: bp.symbolSets[0]?.id ?? null,
                  };
                  editor.dispatchCommand(
                    "ADD_SYMBOL",
                    {
                      symbol: newSym,
                      symbolSetId: bp.symbolSets[0]?.id ?? null,
                    },
                    `Add symbol ${newSym.name}`,
                  );
                  editor.selectElement(newSymId);
                }}
              >
                + Add Symbol
              </Button>
            </div>
          }
        >
          <Tabs
            ariaLabel="Symbol tier filter"
            activeTab={tierFilter}
            onChange={setTierFilter}
            tabs={[
              { id: "all", label: "All", badge: bp.symbols.length },
              {
                id: "high",
                label: "High",
                badge: bp.symbols.filter((s) => s.tier === "high").length,
              },
              {
                id: "mid",
                label: "Mid",
                badge: bp.symbols.filter((s) => s.tier === "mid").length,
              },
              {
                id: "low",
                label: "Low",
                badge: bp.symbols.filter((s) => s.tier === "low").length,
              },
              {
                id: "special",
                label: "Special",
                badge: bp.symbols.filter((s) => s.tier === "special").length,
              },
            ]}
            className="mb-4"
          />

          {filteredSymbols.length === 0 ? (
            <EmptyState
              icon="diamond"
              title="No matching symbols"
              description="Adjust your tier filter or search query."
            />
          ) : (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSymbols.map((sym) => {
                const isSelected = selectedSymbol?.id === sym.id;
                const imgUri = sym.assetId ? assetMap.get(sym.assetId) : null;
                return (
                  <button
                    key={sym.id}
                    type="button"
                    onClick={() => editor.selectElement(sym.id)}
                    className={`focus-ring flex items-center gap-3 rounded-lg border p-2.5 text-left transition ${
                      isSelected
                        ? "border-accent-500/60 bg-accent-600/15"
                        : "border-white/[0.07] bg-ink-850 hover:border-white/20"
                    }`}
                  >
                    <Thumbnail
                      src={imgUri}
                      alt={sym.name}
                      glyph={sym.glyph}
                      checkerboard
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="truncate text-xs font-semibold text-ink-100">
                          {sym.name}
                        </span>
                        <Badge
                          tone={
                            sym.tier === "special"
                              ? "warning"
                              : sym.tier === "high"
                                ? "accent"
                                : "default"
                          }
                        >
                          {sym.tier}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-ink-400">
                        <span>{sym.code}</span>
                        <span>·</span>
                        <span>wt {sym.reelWeight}</span>
                        {sym.isWild ? (
                          <span className="rounded bg-amber-500/25 px-1.5 py-px font-sans text-[9px] font-bold tracking-wider text-amber-200 uppercase">
                            Wild
                          </span>
                        ) : null}
                        {sym.isScatter ? (
                          <span className="rounded bg-emerald-500/25 px-1.5 py-px font-sans text-[9px] font-bold tracking-wider text-emerald-200 uppercase">
                            Scatter
                          </span>
                        ) : null}
                        {sym.isBonus ? (
                          <span className="rounded bg-fuchsia-500/25 px-1.5 py-px font-sans text-[9px] font-bold tracking-wider text-fuchsia-200 uppercase">
                            Bonus
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      {pendingDeleteSymbolId ? (
        <SymbolDeleteConfirmModal
          blueprint={bp}
          symbolId={pendingDeleteSymbolId}
          onCancel={() => setPendingDeleteSymbolId(null)}
          onConfirm={(replacementSymbolId) => {
            editor.dispatchCommand(
              "DELETE_SYMBOL",
              {
                symbolId: pendingDeleteSymbolId,
                replacementSymbolId,
              },
              `Delete symbol ${pendingDeleteSymbolId}`,
            );
            editor.clearSelection();
            setPendingDeleteSymbolId(null);
          }}
        />
      ) : null}
    </StudioShell>
  );
}
