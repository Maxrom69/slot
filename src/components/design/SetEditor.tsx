"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import type { AssetReference, StylePalette, SymbolDef, SymbolSetMeta, SymbolSetType, SymbolTier, ValueTier } from "@/lib/blueprint/types";
import { glyphsForTheme } from "@/lib/blueprint/palette";
import { useDesignEditor } from "@/lib/client/useDesignEditor";
import { designDocFromBlueprint } from "@/lib/design/migrate";
import { DEFAULT_SET_META, SET_TYPES, SET_TYPE_LABELS, VALUE_TIERS, tierOfValue, valueOfTier } from "@/lib/design/model";
import {
  addSymbols, addVariant, deleteSymbol, duplicateSymbol, duplicateVariant, editVariant,
  moveSymbolInSet, removeVariant, renameElement, renameSymbol, updateElement, updateSymbol, symbolDeletionImpact,
} from "@/lib/design/operations";
import { membersOf } from "@/lib/design/selectors";
import type { DeletionImpact, SymbolPatch } from "@/lib/design/types";
import type { GameBlueprint } from "@/lib/blueprint/types";
import { AssetRefPicker, ExtrasEditor, TagsInput, VariantManager } from "./ElementFields";
import { CommitInput, CommitTextArea } from "./CommitInput";
import { SymbolThumb } from "./Thumb";
import { SetTypeBadge, TierBadge } from "./Badges";
import { DeleteDialog, type DeleteTarget } from "./DeleteDialog";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";

function assetLabel(ref: AssetReference | null | undefined, assets: { id: string; name: string }[]): string {
  if (!ref) return "—";
  if (ref.provider === "project" && ref.assetId) return assets.find((a) => a.id === ref.assetId)?.name ?? ref.name ?? "Linked asset";
  if (ref.provider === "external" && ref.uri) {
    try {
      const u = new URL(ref.uri);
      const last = u.pathname.split("/").filter(Boolean).pop();
      return last || ref.uri;
    } catch {
      return ref.uri.length > 40 ? `…${ref.uri.slice(-38)}` : ref.uri;
    }
  }
  return "Placeholder";
}

interface PickerAsset { id: string; name: string; state: string }

interface SetEditorProps {
  project: { id: string; title: string; theme: string; revision: number };
  blueprint: GameBlueprint;
  setId: string;
}

export function SetEditor({ project, blueprint, setId }: SetEditorProps) {
  const router = useRouter();
  const initialDoc = designDocFromBlueprint(blueprint);
  const { doc, run, apply, flush, canUndo, canRedo, undo, redo, pushToast } = useDesignEditor({
    projectId: project.id,
    initialDoc,
    initialRevision: project.revision,
    glyphs: glyphsForTheme(project.theme),
  });
  const [selectedSymbolId, setSelectedSymbolId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = doc.elements.find((e) => e.id === setId && e.type === "symbol_set") ?? null;
  const meta: SymbolSetMeta = set?.symbolSet ?? DEFAULT_SET_META;
  const members = set ? membersOf(doc, set) : [];
  const selected = selectedSymbolId ? doc.symbols.find((s) => s.id === selectedSymbolId) ?? null : null;
  const palette = blueprint.style.palette;
  const pickerAssets: PickerAsset[] = doc.assets
    .filter((a) => a.state === "linked")
    .map((a) => ({ id: a.id, name: a.name, state: a.state }));
  const refAssets = doc.assets.map((a) => ({ id: a.id, name: a.name, uri: a.uri }));

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const copyId = (id: string) => {
    const done = () => {
      setCopiedId(id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1200);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(id).then(done).catch(done);
    else done();
  };

  if (!set) {
    return (
      <div className="grid h-dvh place-items-center bg-ink-950 text-center">
        <div>
          <p className="text-[15px] font-semibold text-ink-100">Symbol set not found</p>
          <p className="mt-1 text-[12px] text-ink-400">It may have been deleted.</p>
          <Button className="mt-5" onClick={() => history.back()}><Icon name="arrow-left" size={13} />Go back</Button>
        </div>
      </div>
    );
  }

  const addNewSymbol = () => {
    const ids = run("Add symbol", (d, context) => {
      const r = addSymbols(d, setId, [{}], context);
      return { doc: r.doc, value: r.ids };
    });
    if (ids?.[0]) {
      setSelectedSymbolId(ids[0]);
      pushToast("Symbol added with a stable id", "success");
    }
  };

  const confirmDelete = (symbolId: string) => {
    const symbol = doc.symbols.find((s) => s.id === symbolId);
    if (!symbol) return;
    const impact = symbolDeletionImpact(doc, symbolId);
    setDeleteTarget({
      kind: "symbol",
      id: symbolId,
      name: symbol.name,
      label: "symbol",
      impact: (impact ?? { kind: "symbol", name: symbol.name, symbols: 1, paytableRows: 0, stripPositions: 0 }) as DeletionImpact,
    });
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-950 text-ink-100">
      <ProjectTopNav projectId={project.id} projectTitle={project.title} />

      {/* Set header (set overview) */}
      <header aria-label="Set overview" className="shrink-0 border-b border-white/[0.07] bg-ink-900/70">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3">
          <button
            type="button"
            onClick={() => {
              void flush().then(() => {
                router.push(`/projects/${project.id}/design`);
              });
            }}
            className="focus-ring rounded-md border border-white/10 p-1.5 text-ink-300 hover:text-ink-100"
            aria-label="Back"
          >
            <Icon name="arrow-left" size={15} />
          </button>
          <div className="min-w-0 flex-1">
            <CommitInput value={set.name} label="Set name" className="text-[19px] font-semibold" onCommit={(name) => apply("Rename set", (d) => renameElement(d, setId, name))} />
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <SetTypeBadge type={meta.symbolType ?? "custom"} />
              <TierBadge tier={meta.valueTier ?? "medium"} />
              <span className="font-mono text-[10.5px] text-ink-400">{members.length} symbols</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘ Z)" aria-label="Undo"><Icon name="undo" size={14} /></Button>
            <Button variant="ghost" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/⌘ Shift Z)" aria-label="Redo"><Icon name="redo" size={14} /></Button>
            <Button variant="primary" onClick={addNewSymbol}><Icon name="plus" size={13} />Add symbol</Button>
          </div>
        </div>

        {/* Set overview strip: style guide, frame, background */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-white/[0.06] bg-ink-900/40 px-5 py-2 text-[11px] text-ink-400">
          <Fact label="Style guide" value={meta.styleGuide || "—"} />
          <Fact label="Frame" value={assetLabel(meta.frame ?? null, refAssets)} />
          <Fact label="Background" value={assetLabel(meta.background ?? null, refAssets)} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
        {/* Symbol grid */}
        <div role="region" aria-label="Symbol grid" className="min-h-0 overflow-y-auto p-5">
          {members.length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-dashed border-white/10 px-6 py-16 text-center">
              <div className="max-w-xs">
                <p className="text-[13px] font-semibold text-ink-100">This set is empty</p>
                <p className="mt-1.5 text-[11.5px] text-ink-400">Add a symbol to start building this set.</p>
                <Button variant="primary" className="mt-4" onClick={addNewSymbol}><Icon name="plus" size={13} />Add symbol</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
              {members.map((symbol, index) => (
                <SymbolCard
                  key={symbol.id}
                  doc={doc}
                  symbol={symbol}
                  palette={palette}
                  index={index}
                  count={members.length}
                  selected={symbol.id === selectedSymbolId}
                  copiedId={copiedId}
                  onSelect={() => setSelectedSymbolId(symbol.id)}
                  onCopyId={() => copyId(symbol.id)}
                  onRename={(name) => apply("Rename symbol", (d) => renameSymbol(d, symbol.id, name))}
                  onMove={(delta) => apply(delta > 0 ? "Move symbol down" : "Move symbol up", (d) => moveSymbolInSet(d, setId, symbol.id, delta))}
                  onOpenDetail={() => {
                    void flush().then(() => {
                      router.push(`/projects/${project.id}/symbols/${encodeURIComponent(symbol.id)}`);
                    });
                  }}
                  onDuplicate={() => {
                    const id = run("Duplicate symbol", (d) => {
                      const r = duplicateSymbol(d, symbol.id);
                      return r ? { doc: r.doc, value: r.id } : { doc: d, value: null };
                    });
                    if (id) {
                      setSelectedSymbolId(id);
                      pushToast("Symbol duplicated with a new stable id", "success");
                    }
                  }}
                  onDelete={() => confirmDelete(symbol.id)}
                />
              ))}
              <button type="button" onClick={addNewSymbol} aria-label="Add symbol"
                className="focus-ring grid place-items-center rounded-xl border border-dashed border-white/10 text-ink-400 transition hover:border-white/25 hover:text-ink-200">
                <span className="grid justify-items-center gap-1 text-[11px]"><Icon name="plus" size={18} />Add symbol</span>
              </button>
            </div>
          )}
        </div>

        {/* Right column: symbol metadata + set configuration */}
        <aside className="min-h-0 space-y-4 overflow-y-auto border-t border-white/[0.07] bg-ink-900/30 p-4 lg:border-t-0 lg:border-l">
          <SymbolMetadataPanel
            doc={doc}
            symbol={selected}
            assets={pickerAssets}
            onCommit={(patch, label) => selected && apply(label, (d) => updateSymbol(d, selected.id, patch))}
            onAddVariant={(name) => {
              if (!selected) return;
              const id = run("Add variant", (d) => {
                const r = addVariant(d, selected.id, name ? { name } : {});
                return { doc: r.doc, value: r.id };
              });
              if (id) pushToast("Variant created with its own stable id", "success");
            }}
            onRenameVariant={(variantId, name) => selected && apply("Rename variant", (d) => editVariant(d, selected.id, variantId, { name }))}
            onDuplicateVariant={(variantId) => {
              if (!selected) return;
              const id = run("Duplicate variant", (d) => {
                const r = duplicateVariant(d, selected.id, variantId);
                return { doc: r.doc, value: r.id };
              });
              if (id) pushToast("Variant duplicated with a new stable id", "success");
            }}
            onRemoveVariant={(variantId) => selected && apply("Remove variant", (d) => removeVariant(d, selected.id, variantId))}
          />
          <SetConfigPanel
            meta={meta}
            assets={pickerAssets}
            onCommit={(patch, label) => apply(label, (d) => updateElement(d, setId, { symbolSet: patch }))}
          />
        </aside>
      </div>

      <DeleteDialog
        target={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return;
          const id = deleteTarget.id;
          setDeleteTarget(null);
          apply("Delete symbol", (d) => deleteSymbol(d, id));
          if (selectedSymbolId === id) setSelectedSymbolId(null);
        }}
      />
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="text-ink-500">{label}:</span>
      <span className="max-w-[240px] truncate text-ink-200">{value}</span>
    </span>
  );
}

/* -------------------------------- Symbol card -------------------------------- */

function SymbolCard({
  doc, symbol, palette, index, count, selected, copiedId, onSelect, onCopyId, onRename, onMove, onOpenDetail, onDuplicate, onDelete,
}: {
  doc: Parameters<typeof membersOf>[0];
  symbol: SymbolDef;
  palette: StylePalette;
  index: number;
  count: number;
  selected: boolean;
  copiedId: string | null;
  onSelect: () => void;
  onCopyId: () => void;
  onRename: (name: string) => void;
  onMove: (delta: number) => void;
  onOpenDetail: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const variants = symbol.variants ?? [];
  const actionBtn =
    "focus-ring grid h-6 w-6 place-items-center rounded text-ink-400 transition hover:bg-white/10 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-30";
  return (
    <article
      data-symbol-card={symbol.id}
      onClick={onSelect}
      className={`group cursor-pointer rounded-xl border bg-ink-900 p-2 transition ${
        selected ? "border-accent-500/70 shadow-lg shadow-accent-600/10" : "border-white/[0.07] hover:border-white/20"
      }`}
    >
      <div className="relative">
        <SymbolThumb doc={doc} symbol={symbol} palette={palette} className="aspect-square w-full rounded-lg" />
        {symbol.isWild || symbol.isScatter ? (
          <div className="absolute right-1 top-1 flex flex-wrap justify-end gap-1">
            {symbol.isWild ? <CornerBadge label="Wild" tone="wild" /> : null}
            {symbol.isScatter ? <CornerBadge label="Scatter" tone="scatter" /> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-2" onClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={onCopyId} title={copiedId === symbol.id ? "Copied" : `Copy id ${symbol.id}`}
          aria-label={`Copy symbol id ${symbol.id}`}
          className="focus-ring min-w-0 w-full truncate rounded font-mono text-left text-[9.5px] text-ink-500 hover:text-ink-300">
          {copiedId === symbol.id ? "copied ✓" : symbol.id}
        </button>
        <div onClick={(event) => event.stopPropagation()}>
          <CommitInput value={symbol.name} label={`Rename symbol ${symbol.name}`} className="mt-1 h-7 py-0 text-[12px] font-medium" onCommit={onRename} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <TierBadge tier={valueOfTier(symbol.tier)} />
          {variants.length > 0 ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-ink-300"
              title={variants.map((v) => `${v.name} (${v.id})`).join(" · ")}
            >
              <Icon name="copy" size={10} />{variants.length} variant{variants.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-0.5 border-t border-white/[0.06] pt-1.5" onClick={(event) => event.stopPropagation()}>
        <button type="button" className={actionBtn} disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move ${symbol.name} up`} title="Move up"><Icon name="arrow-up" size={13} /></button>
        <button type="button" className={actionBtn} disabled={index === count - 1} onClick={() => onMove(1)} aria-label={`Move ${symbol.name} down`} title="Move down"><Icon name="arrow-down" size={13} /></button>
        <span className="flex-1" />
        <button type="button" className={actionBtn} onClick={onOpenDetail} aria-label={`Open ${symbol.name} detail`} title="Open symbol editor"><Icon name="settings" size={13} /></button>
        <button type="button" className={actionBtn} onClick={onDuplicate} aria-label={`Duplicate ${symbol.name}`} title="Duplicate (new stable id)"><Icon name="copy" size={13} /></button>
        <button type="button" className={`${actionBtn} hover:text-rose-300`} onClick={onDelete} aria-label={`Delete ${symbol.name}`} title="Delete"><Icon name="trash" size={13} /></button>
      </div>
    </article>
  );
}

function CornerBadge({ label, tone }: { label: string; tone: "wild" | "scatter" }) {
  return (
    <span data-badge={tone} className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
      tone === "wild" ? "border-accent-400/40 bg-accent-500/80 text-white" : "border-emerald-400/40 bg-emerald-500/80 text-white"
      }`}>
      {label}
    </span>
  );
}

/* ----------------------------- Symbol metadata panel ----------------------------- */

function SymbolMetadataPanel({
  doc, symbol, assets, onCommit, onAddVariant, onRenameVariant, onDuplicateVariant, onRemoveVariant,
}: {
  doc: Parameters<typeof membersOf>[0];
  symbol: SymbolDef | null;
  assets: PickerAsset[];
  onCommit: (patch: SymbolPatch, label: string) => void;
  onAddVariant: (name?: string) => void;
  onRenameVariant: (id: string, name: string) => void;
  onDuplicateVariant: (id: string) => void;
  onRemoveVariant: (id: string) => void;
}) {
  if (!symbol) {
    return (
      <section aria-label="Symbol metadata" className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4">
        <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Symbol metadata</h3>
        <p className="mt-2 text-[11.5px] text-ink-400">Select a symbol in the grid to edit its metadata.</p>
      </section>
    );
  }
  const isSpecial = symbol.tier === "special";
  const tiers = isSpecial ? VALUE_TIERS.filter((t) => t.id === "special") : VALUE_TIERS.filter((t) => t.id !== "special");
  return (
    <section aria-label="Symbol metadata" className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4">
      <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Symbol metadata</h3>
      <dl className="mt-2 space-y-1 text-[11px]">
        <MetaRow label="Symbol ID">
          <code className="truncate font-mono text-[10.5px] text-ink-200">{symbol.id}</code>
        </MetaRow>
        <MetaRow label="Code"><code className="font-mono text-ink-200">{symbol.code}</code></MetaRow>
      </dl>

      <div className="mt-3 space-y-3">
        <Field label="Name">
          <CommitInput value={symbol.name} label="Symbol name" onCommit={(name) => onCommit({ name }, "Rename symbol")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tier">
            <Select aria-label="Symbol tier" className="creation-input" value={valueOfTier(symbol.tier)} disabled={isSpecial}
              onChange={(e) => onCommit({ tier: tierOfValue(e.target.value as ValueTier) as SymbolTier }, "Change symbol tier")}>
              {tiers.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Symbol type">
            <Select aria-label="Symbol type" className="creation-input" value={symbol.symbolType ?? "custom"}
              onChange={(e) => onCommit({ symbolType: e.target.value as SymbolSetType }, "Change symbol type")}>
              {SET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <ToggleRow label="Wild" checked={Boolean(symbol.isWild)} onChange={(v) => onCommit({ isWild: v }, v ? "Mark as wild" : "Unmark wild")} />
          <ToggleRow label="Scatter" checked={Boolean(symbol.isScatter)} onChange={(v) => onCommit({ isScatter: v }, v ? "Mark as scatter" : "Unmark scatter")} />
        </div>
        <Field label="Math ID" hint="Opaque id for the SECTION 2 engine">
          <CommitInput value={symbol.mathId ?? ""} label="Math id" allowEmpty maxLength={80} onCommit={(v) => onCommit({ mathId: v || null }, "Update math id")} />
        </Field>
        <Field label="Image">
          <AssetRefPicker label="Symbol image" value={symbol.image ?? null} assets={assets} onChange={(ref) => onCommit({ image: ref }, "Set symbol image")} />
        </Field>
        <Field label="Description">
          <CommitTextArea value={symbol.description ?? ""} label="Symbol description" placeholder="Notes about this symbol" onCommit={(v) => onCommit({ description: v }, "Update symbol description")} />
        </Field>
        <Field label="Tags" hint="Comma-separated, up to 12">
          <TagsInput value={symbol.tags ?? []} label="Symbol tags" onCommit={(tags) => onCommit({ tags }, "Update symbol tags")} />
        </Field>
        <Field label="Custom data (extras)">
          <ExtrasEditor value={symbol.extras ?? {}} onCommit={(extras) => onCommit({ extras }, "Update symbol extras")} />
        </Field>

        <div className="border-t border-white/[0.06] pt-3">
          <h4 className="mb-2 text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Custom variants</h4>
          <VariantManager
            variants={symbol.variants ?? []}
            baseSymbolName={symbol.name}
            onAdd={onAddVariant}
            onRename={onRenameVariant}
            onDuplicate={onDuplicateVariant}
            onRemove={onRemoveVariant}
          />
        </div>
      </div>
    </section>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-ink-400">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className="focus-ring flex items-center justify-between rounded-lg border border-white/10 bg-ink-950/40 px-2.5 py-1.5">
      <span className="text-[11.5px] text-ink-200">{label}</span>
      <span className={`relative h-5 w-9 rounded-full border transition ${checked ? "border-accent-500/60 bg-accent-600" : "border-white/15 bg-ink-750"}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/* ------------------------------- Set configuration ------------------------------- */

function SetConfigPanel({
  meta, assets, onCommit,
}: {
  meta: SymbolSetMeta;
  assets: PickerAsset[];
  onCommit: (patch: Partial<SymbolSetMeta>, label: string) => void;
}) {
  return (
    <section aria-label="Set configuration" className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4">
      <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Set configuration</h3>
      <div className="mt-3 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Symbol type">
            <Select aria-label="Set symbol type" className="creation-input" value={meta.symbolType ?? "custom"}
              onChange={(e) => onCommit({ symbolType: e.target.value as SymbolSetType }, "Change set type")}>
              {SET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Value tier">
            <Select aria-label="Set value tier" className="creation-input" value={meta.valueTier ?? "medium"}
              onChange={(e) => onCommit({ valueTier: e.target.value as ValueTier }, "Change set tier")}>
              {VALUE_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Style guide">
          <CommitTextArea value={meta.styleGuide ?? ""} label="Set style guide" rows={2} placeholder="Palette, lighting, materials"
            onCommit={(v) => onCommit({ styleGuide: v }, "Update style guide")} />
        </Field>
        <Field label="Description">
          <CommitTextArea value={meta.description ?? ""} label="Set description" rows={2} placeholder="What this set is for"
            onCommit={(v) => onCommit({ description: v }, "Update set description")} />
        </Field>
        <Field label="Frame">
          <AssetRefPicker label="Set frame" value={meta.frame ?? null} assets={assets} onChange={(ref) => onCommit({ frame: ref }, "Update set frame")} />
        </Field>
        <Field label="Background">
          <AssetRefPicker label="Set background" value={meta.background ?? null} assets={assets} onChange={(ref) => onCommit({ background: ref }, "Update set background")} />
        </Field>
        <Field label="Tags" hint="Comma-separated, up to 12">
          <TagsInput value={meta.tags ?? []} label="Set tags" onCommit={(tags) => onCommit({ tags }, "Update set tags")} />
        </Field>
      </div>
    </section>
  );
}
