"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Toasts } from "@/components/ui/Toasts";
import { ProjectTopNav } from "@/components/shell/ProjectTopNav";
import type {
  AssetRef,
  AssetReference,
  GameBlueprint,
  StylePalette,
  SymbolDef,
  SymbolSetType,
  SymbolTier,
  ValueTier,
} from "@/lib/blueprint/types";
import { glyphsForTheme } from "@/lib/blueprint/palette";
import { useDesignEditor } from "@/lib/client/useDesignEditor";
import { designDocFromBlueprint } from "@/lib/design/migrate";
import { SET_TYPES, VALUE_TIERS, tierOfValue, valueOfTier } from "@/lib/design/model";
import {
  addVariant,
  annotateImageRevision,
  clearSymbolArtwork,
  duplicateVariant,
  editVariant,
  findPreviousImageRevision,
  removeVariant,
  renameSymbol,
  replaceSymbolArtwork,
  restoreImageRevision,
  restorePreviousImageRevision,
  sameAssetRef,
  updateSymbol,
} from "@/lib/design/operations";
import type { SymbolPatch } from "@/lib/design/types";
import { AssetRefPicker, ExtrasEditor, TagsInput, VariantManager } from "./ElementFields";
import { CommitInput, CommitTextArea } from "./CommitInput";
import { TierBadge } from "./Badges";
import { ImageHistoryPanel } from "./ImageHistoryPanel";

type RoleFlag = "regular" | "wild" | "scatter" | "bonus";

const ROLE_OPTIONS: { id: RoleFlag; label: string; hint: string; icon: IconName }[] = [
  { id: "regular", label: "Regular", hint: "Standard paying symbol", icon: "check" },
  { id: "wild", label: "Wild", hint: "Behaviour flag only", icon: "diamond" },
  { id: "scatter", label: "Scatter", hint: "Behaviour flag only", icon: "sparkles" },
  { id: "bonus", label: "Bonus", hint: "Behaviour flag only", icon: "gift" },
];

function roleOf(symbol: SymbolDef): RoleFlag {
  if (symbol.isBonus) return "bonus";
  if (symbol.isWild) return "wild";
  if (symbol.isScatter) return "scatter";
  return "regular";
}

function assetUri(ref: AssetReference | null | undefined, assets: AssetRef[]): string | null {
  if (!ref) return null;
  if (ref.provider === "project" && ref.assetId) return assets.find((a) => a.id === ref.assetId)?.uri ?? null;
  if (ref.provider === "external" && ref.uri) return ref.uri;
  return null;
}

function assetName(ref: AssetReference | null | undefined, assets: AssetRef[]): string {
  if (!ref) return "None";
  if (ref.provider === "project" && ref.assetId) return assets.find((a) => a.id === ref.assetId)?.name ?? ref.name ?? ref.assetId;
  if (ref.provider === "external" && ref.uri) {
    try {
      const u = new URL(ref.uri);
      return u.pathname.split("/").filter(Boolean).pop() || u.hostname;
    } catch {
      return ref.uri.length > 32 ? `…${ref.uri.slice(-30)}` : ref.uri;
    }
  }
  return ref.name ?? "Placeholder";
}

function formatAssetReference(ref: AssetReference | null | undefined): string {
  if (!ref) return "none (cleared)";
  if (ref.provider === "project") return `project:${ref.assetId ?? "—"}`;
  if (ref.provider === "external") return `external:${ref.uri ?? "—"}`;
  return `placeholder:${ref.name ?? "default"}`;
}

const SOURCE_LABEL: Record<NonNullable<SymbolDef["imageHistory"]>[number]["source"], string> = {
  create: "Created",
  import: "Imported",
  upload: "Uploaded",
  duplicate: "Duplicated",
  variant: "From variant",
  restore: "Restored",
};

const SOURCE_ICON: Record<NonNullable<SymbolDef["imageHistory"]>[number]["source"], IconName> = {
  create: "plus",
  import: "upload",
  upload: "upload",
  duplicate: "copy",
  variant: "copy",
  restore: "refresh-ccw",
};

function fmt(ts: string): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

interface SymbolEditorProps {
  project: { id: string; title: string; theme: string; revision: number };
  blueprint: GameBlueprint;
  symbolId: string;
  setId: string | null;
}

export function SymbolEditor({ project, blueprint, symbolId, setId }: SymbolEditorProps) {
  const router = useRouter();
  const initialDoc = designDocFromBlueprint(blueprint);
  const {
    doc,
    run,
    apply,
    flush,
    canUndo,
    canRedo,
    undo,
    redo,
    saveState,
    uploading,
    uploadImages,
    toasts,
    pushToast,
    dismissToast,
  } = useDesignEditor({
    projectId: project.id,
    initialDoc,
    initialRevision: project.revision,
    glyphs: glyphsForTheme(project.theme),
  });
  const symbol = doc.symbols.find((s) => s.id === symbolId) ?? null;
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [imageNotes, setImageNotes] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const palette = blueprint.style.palette;

  useEffect(() => {
    const t = copiedId ? window.setTimeout(() => setCopiedId(null), 1200) : undefined;
    return () => { if (t) window.clearTimeout(t); };
  }, [copiedId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const assets: AssetRef[] = doc.assets.filter((a) => a.kind === "image");
  const pickerAssets = assets.map((a) => ({ id: a.id, name: a.name, state: a.state }));
  const variants = symbol?.variants ?? [];
  const imgHistory = symbol?.imageHistory ?? [];
  const previousRevision = symbol ? findPreviousImageRevision(symbol) : null;
  const currentImageUri = symbol ? assetUri(symbol.image, assets) : null;
  const familyList = useMemo(() => {
    const seen = new Set<string>();
    for (const s of doc.symbols) if (s.family) seen.add(s.family);
    return Array.from(seen).sort();
  }, [doc.symbols]);

  if (!symbol) {
    return (
      <div className="grid h-dvh place-items-center bg-ink-950 text-center">
        <div>
          <p className="text-[15px] font-semibold text-ink-100">Symbol not found</p>
          <p className="mt-1 text-[12px] text-ink-400">It may have been deleted.</p>
          <Button className="mt-5" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={13} />Go back
          </Button>
        </div>
      </div>
    );
  }

  const applyPatch = (patch: SymbolPatch, label: string) => apply(label, (d) => updateSymbol(d, symbolId, patch));

  const setRole = (role: RoleFlag) => {
    applyPatch(
      role === "bonus" ? { isBonus: true, isWild: false, isScatter: false }
        : role === "wild" ? { isWild: true, isBonus: false, isScatter: false }
          : role === "scatter" ? { isScatter: true, isWild: false, isBonus: false }
            : { isWild: false, isScatter: false, isBonus: false },
      role === "regular" ? "Clear role flags" : `Set role to ${role}`,
    );
  };

  const toggleFlag = (flag: "isWild" | "isScatter" | "isBonus", nextVal: boolean) => {
    applyPatch({ [flag]: nextVal }, `${nextVal ? "Enable" : "Disable"} ${flag.replace(/^is/, "")} flag`);
  };

  const onUploadFileChosen = async (file: File | undefined) => {
    if (!file) return;
    const [result] = await uploadImages([file]);
    if (!result?.asset) {
      pushToast(result?.error ?? "The image could not be uploaded.", "error");
      return;
    }
    const uploadedAsset = result.asset;
    const notesToRecord = imageNotes.trim() || `Uploaded ${uploadedAsset.name}`;
    setImageNotes("");
    apply("Upload replacement artwork", (d) =>
      replaceSymbolArtwork(d, symbolId, uploadedAsset, { source: "upload", notes: notesToRecord }),
    );
    pushToast(`Uploaded replacement artwork “${uploadedAsset.name}”`, "success");
  };

  const copyId = (id: string) => {
    const done = () => setCopiedId(id);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(id).then(done).catch(done);
    else done();
  };

  const ownerSet = (symbol.symbolSetId ?? setId)
    ? doc.elements.find((e) => e.id === (symbol.symbolSetId ?? setId))
    : null;
  const isSpecial = symbol.tier === "special";
  const isRegular = !symbol.isWild && !symbol.isScatter && !symbol.isBonus;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-950 text-ink-100">
      <ProjectTopNav projectId={project.id} projectTitle={project.title} />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        aria-label="Upload replacement file input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          void onUploadFileChosen(file);
        }}
      />

      {/* Header */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-3 border-b border-white/[0.07] bg-ink-900/70 px-5 py-3">
        <button
          type="button"
          onClick={() => {
            void flush().then(() => {
              if (ownerSet) router.push(`/projects/${project.id}/sets/${encodeURIComponent(ownerSet.id)}`);
              else window.history.back();
            });
          }}
          className="focus-ring rounded-md border border-white/10 p-1.5 text-ink-300 hover:text-ink-100"
          aria-label="Back"
        >
          <Icon name="arrow-left" size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <CommitInput
            value={symbol.name}
            label="Symbol name"
            className="text-[19px] font-semibold"
            onCommit={(name) => apply("Rename symbol", (d) => renameSymbol(d, symbolId, name))}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <TierBadge tier={valueOfTier(symbol.tier)} />
            {ownerSet ? (
              <button
                type="button"
                onClick={() => {
                  void flush().then(() => router.push(`/projects/${project.id}/sets/${encodeURIComponent(ownerSet.id)}`));
                }}
                className="focus-ring rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-ink-300 transition hover:border-white/25 hover:text-ink-100"
              >
                Set: {ownerSet.name}
              </button>
            ) : (
              <span className="rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-ink-400">
                Standalone symbol
              </span>
            )}
            <span className="font-mono text-[10.5px] text-ink-400">{symbol.code}</span>
            <span className="font-mono text-[10px] text-ink-500">({saveState})</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" onClick={undo} disabled={!canUndo} title="Undo (Ctrl/⌘ Z)" aria-label="Undo">
            <Icon name="undo" size={14} />
          </Button>
          <Button variant="ghost" onClick={redo} disabled={!canRedo} title="Redo (Ctrl/⌘ Shift Z)" aria-label="Redo">
            <Icon name="redo" size={14} />
          </Button>
        </div>
      </header>

      {/* Main layout */}
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[320px_minmax(0,1fr)] lg:overflow-hidden">
        {/* Left: image preview + artwork */}
        <aside className="min-h-0 space-y-4 overflow-y-auto border-b border-white/[0.07] bg-ink-900/30 p-4 lg:border-b-0 lg:border-r">
          <section className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Image preview</h3>
              <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9.5px] text-ink-400">
                {imgHistory.length} {imgHistory.length === 1 ? "version" : "versions"}
              </span>
            </div>
            <div
              className="relative mt-3 aspect-square w-full overflow-hidden rounded-lg border border-white/10"
              style={previewStyle(currentImageUri, palette)}
            >
              {!currentImageUri ? (
                <div className="grid h-full place-items-center text-[56px] font-bold text-[color:var(--glow)]">
                  {symbol.glyph}
                </div>
              ) : null}
            </div>
            <dl className="mt-3 space-y-1 text-[11px]">
              <MetaRow label="Asset">{symbol.image ? assetName(symbol.image, assets) : "None (placeholder)"}</MetaRow>
              <MetaRow label="Reference">
                <span className="font-mono text-[10px]">{formatAssetReference(symbol.image)}</span>
              </MetaRow>
            </dl>

            {/* Artwork controls: upload replacement, choose existing asset, clear artwork, restore previous asset */}
            <div className="mt-3 space-y-3 border-t border-white/[0.06] pt-3">
              <div>
                <p className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-ink-400 uppercase">Artwork</p>
                <Button
                  className="h-8 w-full justify-center text-[11px]"
                  disabled={uploading}
                  aria-label="Upload replacement"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Icon name="upload" size={13} />
                  {uploading ? "Uploading…" : "Upload replacement"}
                </Button>
              </div>

              <Field label="Choose existing asset">
                <AssetRefPicker
                  label="Symbol image"
                  value={symbol.image ?? null}
                  assets={pickerAssets}
                  onChange={(ref) => {
                    const notesToRecord = imageNotes.trim() || (ref ? "Selected existing asset" : "Cleared artwork");
                    setImageNotes("");
                    apply(ref ? "Choose existing asset" : "Clear artwork", (d) =>
                      replaceSymbolArtwork(d, symbolId, ref, { source: "upload", notes: notesToRecord }),
                    );
                  }}
                />
              </Field>

              <div className="grid grid-cols-2 gap-1.5">
                <Button
                  className="h-7 justify-center px-2 text-[10.5px]"
                  disabled={!symbol.image}
                  aria-label="Clear artwork"
                  onClick={() => {
                    const notesToRecord = imageNotes.trim() || "Cleared artwork";
                    setImageNotes("");
                    apply("Clear artwork", (d) => clearSymbolArtwork(d, symbolId, notesToRecord));
                    pushToast("Artwork cleared (previous references preserved in history)", "info");
                  }}
                >
                  <Icon name="x" size={12} />Clear artwork
                </Button>
                <Button
                  className="h-7 justify-center px-2 text-[10.5px]"
                  disabled={!previousRevision}
                  aria-label="Restore previous asset"
                  title={previousRevision ? `Restore revision ${previousRevision.id}` : "No previous version available"}
                  onClick={() => {
                    if (!previousRevision) return;
                    const notesToRecord = imageNotes.trim() || undefined;
                    setImageNotes("");
                    apply("Restore previous asset", (d) => restorePreviousImageRevision(d, symbolId, notesToRecord));
                    pushToast("Restored previous artwork version", "success");
                  }}
                >
                  <Icon name="refresh-ccw" size={12} />Restore previous
                </Button>
              </div>

              <Field label="Revision / restore notes (optional)" hint="Recorded with the next artwork replacement or restore">
                <CommitTextArea
                  value={imageNotes}
                  label="Restore notes"
                  rows={2}
                  maxLength={320}
                  placeholder="Why this change?"
                  onCommit={(v) => setImageNotes(v)}
                />
              </Field>
            </div>
          </section>
        </aside>

        {/* Right: sections */}
        <div className="min-h-0 space-y-4 overflow-y-auto p-4">
          {/* 1. Symbol metadata */}
          <section className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4">
            <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Symbol metadata</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Name">
                <CommitInput
                  value={symbol.name}
                  label="Symbol name"
                  onCommit={(name) => applyPatch({ name }, "Rename symbol")}
                />
              </Field>
              <Field label="ID">
                <div className="flex items-center gap-1.5 rounded-md border border-white/10 bg-ink-950/70 px-2.5 py-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-200">{symbol.id}</code>
                  <button
                    type="button"
                    onClick={() => copyId(symbol.id)}
                    aria-label={`Copy id ${symbol.id}`}
                    className="focus-ring shrink-0 rounded p-0.5 text-ink-400 hover:text-ink-100"
                  >
                    <Icon name="copy" size={12} />
                  </button>
                  {copiedId === symbol.id ? <span className="text-[9.5px] text-accent-300">Copied</span> : null}
                </div>
              </Field>
              <Field label="Type">
                <Select
                  aria-label="Symbol type"
                  className="creation-input"
                  value={symbol.symbolType ?? "custom"}
                  onChange={(e) => applyPatch({ symbolType: e.target.value as SymbolSetType }, "Change symbol type")}
                >
                  {SET_TYPES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tier">
                <Select
                  aria-label="Symbol tier"
                  className="creation-input"
                  value={valueOfTier(symbol.tier)}
                  disabled={isSpecial}
                  onChange={(e) => applyPatch({ tier: tierOfValue(e.target.value as ValueTier) as SymbolTier }, "Change symbol tier")}
                >
                  {VALUE_TIERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Symbol family" hint="Free-form family group">
                <div className="space-y-1.5">
                  <CommitInput
                    value={symbol.family ?? ""}
                    label="Symbol family"
                    allowEmpty
                    maxLength={60}
                    placeholder="e.g. shrine-totems"
                    onCommit={(v) => applyPatch({ family: v || undefined }, "Update symbol family")}
                  />
                  {familyList.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="text-[9px] text-ink-500">Existing:</span>
                      {familyList.map((fam) => (
                        <button
                          key={fam}
                          type="button"
                          onClick={() => applyPatch({ family: fam }, "Update symbol family")}
                          className={`focus-ring rounded border px-1.5 py-0.5 font-mono text-[9px] transition ${
                            symbol.family === fam
                              ? "border-accent-500/60 bg-accent-500/[0.12] text-accent-200"
                              : "border-white/10 bg-white/[0.03] text-ink-400 hover:border-white/25 hover:text-ink-200"
                          }`}
                        >
                          {fam}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Field>
              <Field label="Description" hint="Notes about this symbol">
                <CommitTextArea
                  value={symbol.description ?? ""}
                  label="Symbol description"
                  placeholder="What is this symbol?"
                  onCommit={(v) => applyPatch({ description: v }, "Update description")}
                />
              </Field>
            </div>
          </section>

          {/* 2. Symbol configuration & role flags */}
          <section className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                  Symbol configuration &amp; role flags
                </h3>
                <p className="mt-1 text-[10.5px] text-ink-400">
                  Configuration flags only — behaviour is evaluated by the SECTION 2 engine.
                </p>
              </div>
              <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-ink-300">
                Active role: <strong className="font-semibold text-ink-100 capitalize">{roleOf(symbol)}</strong>
              </span>
            </div>

            {/* Primary role preset buttons */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ROLE_OPTIONS.map((opt) => {
                const active = roleOf(symbol) === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setRole(opt.id)}
                    aria-pressed={active}
                    className={`focus-ring flex flex-col items-start gap-1 rounded-lg border px-3 py-2 text-left transition ${
                      active
                        ? "border-accent-500/60 bg-accent-500/[0.1]"
                        : "border-white/10 bg-ink-950/40 hover:border-white/25"
                    }`}
                  >
                    <span className={`flex items-center gap-1.5 text-[11px] font-medium ${active ? "text-ink-100" : "text-ink-200"}`}>
                      <Icon name={opt.icon} size={12} />
                      {opt.label}
                    </span>
                    <span className="text-[9.5px] leading-snug text-ink-400">{opt.hint}</span>
                  </button>
                );
              })}
            </div>

            {/* Individual configuration flag toggles + payout / reel weight config */}
            <div className="mt-3 grid gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-ink-950/40 px-3 py-2 text-[11px]">
                <span className="text-ink-200">Wild flag</span>
                <input
                  type="checkbox"
                  aria-label="Wild flag"
                  checked={Boolean(symbol.isWild)}
                  onChange={(e) => toggleFlag("isWild", e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent-500"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-ink-950/40 px-3 py-2 text-[11px]">
                <span className="text-ink-200">Scatter flag</span>
                <input
                  type="checkbox"
                  aria-label="Scatter flag"
                  checked={Boolean(symbol.isScatter)}
                  onChange={(e) => toggleFlag("isScatter", e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent-500"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-ink-950/40 px-3 py-2 text-[11px]">
                <span className="text-ink-200">Bonus flag</span>
                <input
                  type="checkbox"
                  aria-label="Bonus flag"
                  checked={Boolean(symbol.isBonus)}
                  onChange={(e) => toggleFlag("isBonus", e.target.checked)}
                  className="h-3.5 w-3.5 accent-accent-500"
                />
              </label>
              <label className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-ink-950/40 px-3 py-2 text-[11px]">
                <span className="text-ink-200">Regular flag</span>
                <input
                  type="checkbox"
                  aria-label="Regular flag"
                  checked={isRegular}
                  onChange={(e) => {
                    if (e.target.checked) setRole("regular");
                  }}
                  className="h-3.5 w-3.5 accent-accent-500"
                />
              </label>
            </div>

            <div className="mt-3 grid gap-3 border-t border-white/[0.06] pt-3 sm:grid-cols-4">
              <Field label="3-of-a-kind payout">
                <input
                  type="number"
                  min={0}
                  aria-label="3-of-a-kind payout"
                  value={symbol.payouts["3"] ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) applyPatch({ payouts: { ...symbol.payouts, "3": n } }, "Update 3x payout");
                  }}
                  className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/70 px-2.5 py-1.5 font-mono text-xs text-ink-100"
                />
              </Field>
              <Field label="4-of-a-kind payout">
                <input
                  type="number"
                  min={0}
                  aria-label="4-of-a-kind payout"
                  value={symbol.payouts["4"] ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) applyPatch({ payouts: { ...symbol.payouts, "4": n } }, "Update 4x payout");
                  }}
                  className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/70 px-2.5 py-1.5 font-mono text-xs text-ink-100"
                />
              </Field>
              <Field label="5-of-a-kind payout">
                <input
                  type="number"
                  min={0}
                  aria-label="5-of-a-kind payout"
                  value={symbol.payouts["5"] ?? 0}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) applyPatch({ payouts: { ...symbol.payouts, "5": n } }, "Update 5x payout");
                  }}
                  className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/70 px-2.5 py-1.5 font-mono text-xs text-ink-100"
                />
              </Field>
              <Field label="Reel weight" hint="0–100 strip weight">
                <input
                  type="number"
                  min={0}
                  max={100}
                  aria-label="Reel weight"
                  value={symbol.reelWeight}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) applyPatch({ reelWeight: n }, "Update reel weight");
                  }}
                  className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/70 px-2.5 py-1.5 font-mono text-xs text-ink-100"
                />
              </Field>
            </div>
          </section>

          {/* 3. Variant management */}
          <section className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4">
            <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Variant management</h3>
            <p className="mt-1 text-[10.5px] text-ink-400">
              Independently addressable custom variants. Each keeps its own stable id — duplicates get new ids.
            </p>
            <div className="mt-3">
              <VariantManager
                variants={variants}
                baseSymbolName={symbol.name}
                assets={pickerAssets}
                onAdd={(name) => {
                  const id = run("Add variant", (d) => {
                    const r = addVariant(d, symbolId, name ? { name } : {});
                    return { doc: r.doc, value: r.id };
                  });
                  if (id) pushToast("Variant created with its own stable id", "success");
                }}
                onRename={(id, name) => apply("Rename variant", (d) => editVariant(d, symbolId, id, { name }))}
                onDuplicate={(id) => {
                  const newId = run("Duplicate variant", (d) => {
                    const r = duplicateVariant(d, symbolId, id);
                    return { doc: r.doc, value: r.id };
                  });
                  if (newId) pushToast("Variant duplicated with a new stable id", "success");
                }}
                onRemove={(id) => apply("Remove variant", (d) => removeVariant(d, symbolId, id))}
                onImageChange={(id, image) =>
                  apply("Update variant artwork", (d) => editVariant(d, symbolId, id, { image }))
                }
              />
            </div>
          </section>

          {/* 4. Extras */}
          <section className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4">
            <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Extras</h3>
            <p className="mt-1 text-[10.5px] text-ink-400">
              Extensible extra metadata (Split, Expansion, Hover, Animation, Custom Extra). Stored as configuration only.
            </p>
            <div className="mt-3">
              <ExtrasEditor value={symbol.extras ?? {}} onCommit={(extras) => applyPatch({ extras }, "Update extras")} />
            </div>
          </section>

          {/* 5. Math metadata */}
          <section className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4">
            <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Math metadata</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Math ID" hint="Opaque id for the SECTION 2 engine">
                <CommitInput
                  value={symbol.mathId ?? ""}
                  label="Math id"
                  allowEmpty
                  maxLength={80}
                  onCommit={(v) => applyPatch({ mathId: v || null }, "Update math id")}
                />
              </Field>
              <Field label="Code">
                <CommitInput
                  value={symbol.code}
                  label="Symbol code"
                  onCommit={(v) => applyPatch({ code: v }, "Update code")}
                />
              </Field>
              <Field label="Glyph" hint="Fallback glyph when no image is linked">
                <CommitInput
                  value={symbol.glyph}
                  label="Symbol glyph"
                  maxLength={12}
                  onCommit={(v) => applyPatch({ glyph: v }, "Update glyph")}
                />
              </Field>
              <Field label="Tags" hint="Comma-separated, up to 12">
                <TagsInput
                  value={symbol.tags ?? []}
                  label="Symbol tags"
                  onCommit={(tags) => applyPatch({ tags }, "Update tags")}
                />
              </Field>
            </div>
          </section>

          {/* 6. Image history */}
          <section className="rounded-xl border border-white/[0.07] bg-ink-900/50 p-4">
            <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">Image history</h3>
            <p className="mt-1 text-[10.5px] text-ink-400">
              Recorded versions of this symbol&apos;s image (thumbnail, timestamp, source, label, current indicator). Preview, set as current, download, or delete any revision with full dependency checks.
            </p>
            <div className="mt-3">
              <ImageHistoryPanel
                doc={doc}
                blueprint={blueprint}
                target={{ kind: "symbol", id: symbolId }}
                palette={palette}
                fallbackGlyph={symbol.glyph}
                onApply={(label, fn) => apply(label, fn)}
                onNotify={(msg, kind) => pushToast(msg, kind ?? "info")}
              />
            </div>
          </section>
        </div>
      </div>

      <Toasts toasts={toasts} onDismiss={dismissToast} onUndo={undo} canUndo={canUndo} />
    </div>
  );
}

function previewStyle(uri: string | null, palette: StylePalette): CSSProperties {
  if (!uri) {
    return {
      background: `radial-gradient(120% 100% at 50% 0%, ${palette.accent}22, ${palette.surface} 60%, ${palette.background})`,
    };
  }
  return {
    backgroundImage: `url("${uri}")`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}

function revStyle(uri: string | null, palette: StylePalette): CSSProperties {
  if (!uri) {
    return {
      background: `radial-gradient(110% 100% at 50% 0%, ${palette.accent}2e, ${palette.surface} 55%, ${palette.background})`,
    };
  }
  return { backgroundImage: `url("${uri}")`, backgroundSize: "cover", backgroundPosition: "center" };
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-ink-400">{label}</dt>
      <dd className="min-w-0 text-right text-ink-200">{children}</dd>
    </div>
  );
}
