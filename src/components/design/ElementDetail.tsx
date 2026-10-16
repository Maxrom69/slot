"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { elementTypeMeta } from "@/lib/blueprint/elements";
import type {
  AssetRef,
  AssetReference,
  BlendMode,
  ElementAnimationConfig,
  ElementDef,
  GameBlueprint,
  ImageRevision,
  StylePalette,
  SymbolDef,
  ValueTier,
} from "@/lib/blueprint/types";
import { ASPECTS, BUTTONS, FRAME_STYLES } from "@/lib/creation/draft";
import { computeElementUsage } from "@/lib/design/element-usage";
import { SET_TYPES, VALUE_TIERS, valueOfTier } from "@/lib/design/model";
import {
  addElementAnimationCue,
  addElementVariant,
  annotateElementImageRevision,
  clearElementArtwork,
  duplicateElementVariant,
  editElementVariant,
  findPreviousElementImageRevision,
  findPreviousImageRevision,
  removeElementAnimationCue,
  removeElementVariant,
  replaceElementArtwork,
  restoreElementImageRevision,
  restorePreviousElementImageRevision,
  sameAssetRef,
  updateElement,
  updateElementAnimationCue,
} from "@/lib/design/operations";
import { elementImage, elementStatus, membersOf, symbolImage } from "@/lib/design/selectors";
import type { DesignDoc, Selection } from "@/lib/design/types";
import type { DesignActions } from "./actions";
import { SetTypeBadge, StatusBadge, TierBadge, TypeBadge } from "./Badges";
import { CommitInput, CommitTextArea } from "./CommitInput";
import { ElementAnimationPanel } from "./ElementAnimationPanel";
import { AssetRefPicker, ExtrasEditor, TagsInput, VariantManager } from "./ElementFields";
import { ImageHistoryPanel } from "./ImageHistoryPanel";
import { ElementThumb, SymbolThumb } from "./Thumb";

const BLEND_MODE_OPTIONS: { id: BlendMode; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "multiply", label: "Multiply" },
  { id: "screen", label: "Screen" },
  { id: "overlay", label: "Overlay" },
  { id: "darken", label: "Darken" },
  { id: "lighten", label: "Lighten" },
  { id: "color-dodge", label: "Color Dodge" },
  { id: "color-burn", label: "Color Burn" },
  { id: "hard-light", label: "Hard Light" },
  { id: "soft-light", label: "Soft Light" },
  { id: "difference", label: "Difference" },
  { id: "exclusion", label: "Exclusion" },
];

const ANIMATION_PRESETS: { id: ElementAnimationConfig["preset"]; label: string }[] = [
  { id: "none", label: "None (Static)" },
  { id: "idle_pulse", label: "Idle Pulse" },
  { id: "float", label: "Floating Motion" },
  { id: "spin_glow", label: "Spin Glow" },
  { id: "win_pop", label: "Win Pop & Scale" },
  { id: "custom", label: "Custom Clip" },
];

const ANIMATION_TRIGGERS: { id: ElementAnimationConfig["trigger"]; label: string }[] = [
  { id: "spin_start", label: "Spin Start" },
  { id: "reel_stop", label: "Reel Stop" },
  { id: "win", label: "Win Line" },
  { id: "big_win", label: "Big Win" },
  { id: "feature_enter", label: "Feature Enter" },
];

const EASING_OPTIONS = [
  "ease-out",
  "ease-in-out",
  "linear",
  "cubic-bezier(0.22, 1, 0.36, 1)",
  "spring",
];

const SOURCE_LABEL: Record<ImageRevision["source"], string> = {
  create: "Created",
  import: "Imported",
  upload: "Uploaded",
  duplicate: "Duplicated",
  variant: "From variant",
  restore: "Restored",
};

function formatAssetRef(ref: AssetReference | null | undefined): string {
  if (!ref) return "none (placeholder)";
  if (ref.provider === "project") return `project:${ref.assetId ?? "—"}`;
  if (ref.provider === "external") return `external:${ref.uri ?? "—"}`;
  return `placeholder:${ref.name ?? "default"}`;
}

function assetNameOf(ref: AssetReference | null | undefined, assets: AssetRef[]): string {
  if (!ref) return "None linked";
  if (ref.provider === "project" && ref.assetId) {
    return assets.find((a) => a.id === ref.assetId)?.name ?? ref.name ?? ref.assetId;
  }
  if (ref.provider === "external" && ref.uri) return ref.name ?? ref.uri;
  return ref.name ?? "Placeholder";
}

function formatTimestamp(ts: string): string {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return ts;
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

export interface ElementDetailProps {
  doc: DesignDoc;
  element: ElementDef | null;
  palette: StylePalette;
  title: string;
  zoom: number;
  selection: Selection;
  actions: DesignActions;
  onBack: () => void;
  projectId?: string;
  blueprint?: GameBlueprint | null;
  saveState?: "saved" | "dirty" | "saving" | "conflict" | "error";
  onSave?: () => void;
  onApply?: (label: string, fn: (doc: DesignDoc) => DesignDoc) => void;
  onRun?: <T>(label: string, fn: (doc: DesignDoc) => { doc: DesignDoc; value: T }) => T;
}

function SymbolCard({
  symbol,
  doc,
  palette,
  selected,
  setId,
  actions,
}: {
  symbol: SymbolDef;
  doc: DesignDoc;
  palette: StylePalette;
  selected: boolean;
  setId: string;
  actions: DesignActions;
}) {
  const has = Boolean(symbolImage(doc, symbol));
  const variants = symbol.variants ?? [];
  const target = { kind: "symbol" as const, id: symbol.id };
  const btn =
    "focus-ring grid h-7 w-7 place-items-center rounded-md text-ink-300 transition hover:bg-white/10 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-30";
  return (
    <article
      data-symbol-id={symbol.id}
      aria-label={`Symbol ${symbol.name}`}
      onClick={() => actions.select({ kind: "symbol", id: symbol.id, elementId: setId })}
      className={`rounded-xl border bg-ink-900 p-2 transition ${
        selected ? "border-accent-500/70 shadow-lg shadow-accent-600/10" : "border-white/[0.07] hover:border-white/20"
      }`}
    >
      <div className="relative">
        <SymbolThumb doc={doc} symbol={symbol} palette={palette} className="aspect-square w-full rounded-lg" />
        {symbol.isWild || symbol.isScatter ? (
          <div className="absolute top-1 right-1 flex flex-wrap justify-end gap-1">
            {symbol.isWild ? (
              <span className="rounded border border-accent-400/40 bg-accent-500/80 px-1.5 py-0.5 text-[9px] font-semibold text-white uppercase">
                Wild
              </span>
            ) : null}
            {symbol.isScatter ? (
              <span className="rounded border border-emerald-400/40 bg-emerald-500/80 px-1.5 py-0.5 text-[9px] font-semibold text-white uppercase">
                Scatter
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-2 space-y-1.5" onClick={(event) => event.stopPropagation()}>
        <span className="block truncate font-mono text-[9.5px] text-ink-500" title={symbol.id}>
          {symbol.id}
        </span>
        <CommitInput
          value={symbol.name}
          label={`Name of ${symbol.name}`}
          className="h-7 py-0 text-[11.5px]"
          onCommit={(name) => actions.renameSymbol(symbol.id, name)}
        />
        <div className="flex flex-wrap items-center gap-1">
          <TierBadge tier={valueOfTier(symbol.tier)} />
          {variants.length > 0 ? (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-ink-300"
              title={variants.map((v) => v.name).join(" · ")}
            >
              <Icon name="copy" size={10} />
              {variants.length} variant{variants.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-1">
          <span
            className="font-mono text-[9.5px] text-ink-400"
            title={Object.entries(symbol.payouts)
              .map(([k, v]) => `${k}× ${v}`)
              .join(" · ")}
          >
            {symbol.code} · w{symbol.reelWeight}
          </span>
          <div className="flex items-center">
            <button
              type="button"
              className={btn}
              aria-label={`Edit ${symbol.name}`}
              title="Open symbol editor"
              onClick={() => actions.openSymbol?.(symbol.id)}
            >
              <Icon name="settings" size={13} />
            </button>
            <button
              type="button"
              className={btn}
              aria-label={`Replace image of ${symbol.name}`}
              title="Replace image"
              onClick={() => actions.replaceImage(target)}
            >
              <Icon name="replace" size={13} />
            </button>
            <button
              type="button"
              className={btn}
              aria-label={`Download image of ${symbol.name}`}
              title={has ? "Download image" : "No image linked yet"}
              disabled={!has}
              onClick={() => actions.download(target)}
            >
              <Icon name="download" size={13} />
            </button>
            <button
              type="button"
              className={btn}
              aria-label={`Delete ${symbol.name}`}
              title="Delete symbol"
              onClick={() => actions.requestDelete({ kind: "symbol", id: symbol.id })}
            >
              <Icon name="trash" size={13} />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * F11 — Element Detail View.
 * Detailed configuration workspace for an individual element with:
 * - Header: Back, Element name, Save, Dirty indicator
 * - Main: Large artwork preview, actions (Save, Duplicate, Delete, Replace Image, Download), and Edit Image entry point
 * - Right: Configuration panel with sections Identity, Artwork, Style, Variants, Extras, Animation, History, and Usage
 */
export function ElementDetail({
  doc,
  element,
  palette,
  title,
  zoom,
  selection,
  actions,
  onBack,
  projectId,
  blueprint,
  saveState = "saved",
  onSave,
  onApply,
}: ElementDetailProps) {
  const router = useRouter();
  const [copiedId, setCopiedId] = useState(false);
  const [checkerboard, setCheckerboard] = useState(true);
  const [editingRevId, setEditingRevId] = useState<string | null>(null);
  const [revNotesDraft, setRevNotesDraft] = useState("");

  const usage = useMemo(
    () => (element ? computeElementUsage(doc, blueprint, element.id) : null),
    [doc, blueprint, element],
  );

  if (!element) {
    return (
      <div className="mx-auto max-w-md px-6 py-20 text-center">
        <h2 className="text-[15px] font-semibold text-ink-100">Element not found</h2>
        <p className="mt-2 text-[12px] text-ink-400">It may have been deleted or the link is out of date.</p>
        <Button className="mt-5" variant="primary" onClick={onBack}>
          <Icon name="arrow-left" size={13} />
          Back to Design
        </Button>
      </div>
    );
  }

  const isSet = element.type === "symbol_set";
  const members = membersOf(doc, element);
  const image = elementImage(doc, element);
  const withArt = members.filter((s) => symbolImage(doc, s)).length;
  const meta = elementTypeMeta(element.type);
  const symbol = element.type === "symbol" ? members[0] : undefined;
  const buttons = String(element.params.buttons ?? "spin").split(",").filter(Boolean);

  const pickerAssets = doc.assets
    .filter((a) => a.kind === "image" && a.state === "linked")
    .map((a) => ({ id: a.id, name: a.name, state: a.state }));

  const currentImageRef: AssetReference | null = symbol
    ? (symbol.image ?? (symbol.assetId ? { provider: "project", assetId: symbol.assetId } : null))
    : (element.image ?? (element.assetId ? { provider: "project", assetId: element.assetId } : null));

  const imageHistory: ImageRevision[] = symbol
    ? (symbol.imageHistory ?? [])
    : (element.imageHistory ?? []);

  const previousRevision = symbol
    ? findPreviousImageRevision(symbol)
    : findPreviousElementImageRevision(element);

  const variants = symbol ? (symbol.variants ?? []) : (element.variants ?? []);

  const extrasValue: Record<string, number | string | boolean> = {
    ...element.params,
    ...(symbol?.extras ?? {}),
    ...(element.extras ?? {}),
  };

  const animConfig: ElementAnimationConfig = element.animation ?? {
    preset: "none",
    trigger: "win",
    durationMs: 600,
    easing: "ease-out",
    loop: false,
  };

  const elementCues = (doc.animations ?? blueprint?.animations ?? []).filter(
    (c) => c.target === element.id || (symbol && c.target === symbol.id),
  );

  const applyDocChange = (label: string, fn: (d: DesignDoc) => DesignDoc) => {
    if (onApply) {
      onApply(label, fn);
    }
  };

  const setParams = (params: Record<string, string | number>, label: string) =>
    actions.updateElement(element.id, { params }, label);

  const copyId = () => {
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1200);
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(element.id).catch(() => undefined);
    }
  };

  const openManualElementEditor = () => {
    if (onSave) onSave();
    if (projectId) {
      router.push(`/projects/${encodeURIComponent(projectId)}/elements/${encodeURIComponent(element.id)}/editor`);
    }
  };

  const isDirty = saveState === "dirty" || saveState === "saving";
  const dirtyLabel =
    saveState === "saving"
      ? "Saving…"
      : saveState === "dirty"
      ? "Unsaved changes"
      : saveState === "conflict"
      ? "Out of sync"
      : saveState === "error"
      ? "Save error"
      : "Saved";

  return (
    <div
      data-testid="element-detail-view"
      className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6"
      style={{ "--tile": `${zoom}px` } as CSSProperties}
    >
      {/* Breadcrumb navigation */}
      <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-[11px] text-ink-400">
        <button
          type="button"
          onClick={onBack}
          className="focus-ring flex items-center gap-1 rounded text-ink-300 hover:text-ink-100"
        >
          <Icon name="arrow-left" size={12} />
          Design
        </button>
        <Icon name="chevron-right" size={11} />
        <span>{isSet ? "Symbol Sets" : "Standalone Elements"}</span>
        <Icon name="chevron-right" size={11} />
        <span className="text-ink-100">{element.name}</span>
      </nav>

      {/* F11 Header: Back, Element name, Save, Dirty indicator, and Primary Actions */}
      <header
        data-testid="element-detail-header"
        className="mb-5 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-white/[0.07] bg-ink-900/70 p-4"
      >
        <div className="flex min-w-0 flex-1 basis-80 items-start gap-3">
          <button
            type="button"
            aria-label="Back"
            onClick={onBack}
            className="focus-ring mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-ink-950/60 text-ink-200 transition hover:border-white/25 hover:text-ink-100"
            title="Back to Design View"
          >
            <Icon name="arrow-left" size={14} />
          </button>
          <div className="min-w-0 flex-1">
            <h2 className="sr-only">{element.name} detail</h2>
            <CommitInput
              value={element.name}
              label="Element name"
              className="max-w-md text-[16px] font-semibold"
              onCommit={(name) => actions.rename(element.id, name)}
            />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {isSet ? (
                <>
                  <SetTypeBadge type={element.symbolSet?.symbolType ?? "custom"} />
                  <TierBadge tier={element.symbolSet?.valueTier ?? "medium"} />
                </>
              ) : (
                <TypeBadge element={element} />
              )}
              <StatusBadge status={elementStatus(doc, element)} />
              {isSet ? (
                <span className="font-mono text-[10.5px] text-ink-300">
                  {members.length} symbols · {withArt} with artwork
                </span>
              ) : null}

              {/* Dirty Indicator */}
              <span
                data-testid="element-dirty-indicator"
                data-dirty={isDirty ? "true" : "false"}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                  isDirty
                    ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                    : saveState === "conflict" || saveState === "error"
                    ? "border-rose-500/40 bg-rose-500/15 text-rose-200"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isDirty
                      ? "bg-amber-400"
                      : saveState === "conflict" || saveState === "error"
                      ? "bg-rose-400"
                      : "bg-emerald-400"
                  }`}
                />
                {dirtyLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Header Actions: Save, Replace Image, Download, Duplicate, Delete */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="primary"
            data-testid="element-save-btn"
            aria-label="Save"
            onClick={() => onSave?.()}
          >
            <Icon name="check" size={13} />
            Save
          </Button>
          {isSet ? (
            <>
              <Button onClick={() => actions.addSymbol(element.id)}>
                <Icon name="plus" size={13} />
                Add symbol
              </Button>
              <Button onClick={() => actions.manageSet(element.id)}>
                <Icon name="settings" size={13} />
                Manage set
              </Button>
              <Button onClick={() => actions.importIntoSet(element.id)}>
                <Icon name="upload" size={13} />
                Import images
              </Button>
              <Button
                disabled={withArt === 0}
                title={withArt === 0 ? "No symbol images to download yet" : "Download every symbol image as a .zip"}
                onClick={() => actions.download({ kind: "element", id: element.id })}
              >
                <Icon name="package" size={13} />
                Download .zip
              </Button>
            </>
          ) : (
            <>
              <Button
                data-testid="element-replace-image-btn"
                onClick={() => actions.replaceImage({ kind: "element", id: element.id })}
              >
                <Icon name="replace" size={13} />
                {image ? "Replace image" : "Add image"}
              </Button>
              <Button
                disabled={!image}
                onClick={() => actions.removeImage({ kind: "element", id: element.id })}
              >
                <Icon name="x" size={13} />
                Remove
              </Button>
              <Button
                data-testid="element-download-btn"
                disabled={!image}
                onClick={() => actions.download({ kind: "element", id: element.id })}
              >
                <Icon name="download" size={13} />
                Download
              </Button>
            </>
          )}
          <Button
            data-testid="element-duplicate-btn"
            onClick={() => actions.duplicate(element.id)}
          >
            <Icon name="copy" size={13} />
            Duplicate
          </Button>
          <Button
            variant="danger"
            data-testid="element-delete-btn"
            onClick={() => actions.requestDelete({ kind: "element", id: element.id })}
          >
            <Icon name="trash" size={13} />
            Delete
          </Button>
        </div>
      </header>

      {/* Main + Right Layout */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* MAIN COLUMN: Large Artwork Preview & Edit Image Entry Point */}
        <div className="space-y-4">
          <section
            data-testid="element-large-preview"
            aria-label="Large artwork preview"
            className="rounded-xl border border-white/[0.07] bg-ink-900/70 p-4"
          >
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-[10.5px] font-semibold tracking-[0.16em] text-ink-300 uppercase">
                  Large Artwork Preview
                </h3>
                <span className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] text-ink-400">
                  {image ? `${image.width ?? "Auto"} × ${image.height ?? "Auto"} px` : "Placeholder"}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCheckerboard((c) => !c)}
                  className={`focus-ring rounded border px-2 py-0.5 text-[10px] transition ${
                    checkerboard
                      ? "border-accent-500/40 bg-accent-500/15 text-blue-200"
                      : "border-white/10 text-ink-400 hover:text-ink-200"
                  }`}
                >
                  Alpha Grid: {checkerboard ? "On" : "Off"}
                </button>
              </div>
            </div>

            <div
              className={`relative overflow-hidden rounded-xl border border-white/10 ${
                checkerboard ? "artwork-checker" : "bg-ink-950"
              }`}
              style={{
                opacity: element.style?.opacity ?? 1,
                mixBlendMode: (element.style?.blendMode ?? "normal") as CSSProperties["mixBlendMode"],
              }}
            >
              <ElementThumb
                doc={doc}
                element={element}
                palette={palette}
                title={title}
                className="aspect-[16/10] w-full"
              />
              {element.style?.tintColor ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundColor: element.style.tintColor,
                    mixBlendMode: "color",
                    opacity: 0.35,
                  }}
                />
              ) : null}
            </div>

            {/* Edit Image Entry Point + Disabled AI Edit Action */}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-ink-950/60 p-3">
              <div>
                <p className="text-[11px] font-semibold text-ink-100">Edit Image</p>
                <p className="text-[10px] text-ink-400">
                  Open the manual Element Editor for crop, trim, transform, and non-destructive image adjustments.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="primary"
                  data-testid="open-manual-element-editor"
                  aria-label="Open manual Element Editor"
                  onClick={openManualElementEditor}
                >
                  <Icon name="settings" size={13} />
                  Open Element Editor
                </Button>
                <button
                  type="button"
                  disabled
                  data-testid="ai-edit-image-disabled"
                  aria-label="AI Edit Image (Future functionality)"
                  title="Future functionality — AI image editing is not implemented in this version."
                  className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-white/15 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-ink-400/60"
                >
                  <Icon name="sparkles" size={12} />
                  AI Edit Image · Future Functionality
                </button>
              </div>
            </div>
          </section>

          {/* When element is a symbol_set, also render its member symbol cards in Main */}
          {isSet ? (
            <section className="rounded-xl border border-white/[0.07] bg-ink-900/60 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[10.5px] font-semibold tracking-[0.16em] text-ink-300 uppercase">
                  Set Member Symbols ({members.length})
                </h3>
                <Button onClick={() => actions.addSymbol(element.id)}>
                  <Icon name="plus" size={13} />
                  Add symbol
                </Button>
              </div>
              {members.length === 0 ? (
                <div className="grid place-items-center rounded-xl border border-dashed border-white/10 px-6 py-12 text-center">
                  <div className="max-w-xs">
                    <p className="text-[13px] font-semibold text-ink-100">This set is empty</p>
                    <p className="mt-1.5 text-[11.5px] text-ink-400">
                      Add a placeholder symbol, or import images to create symbols with artwork.
                    </p>
                    <div className="mt-4 flex justify-center gap-2">
                      <Button onClick={() => actions.importIntoSet(element.id)}>
                        <Icon name="upload" size={13} />
                        Import images
                      </Button>
                      <Button variant="primary" onClick={() => actions.addSymbol(element.id)}>
                        <Icon name="plus" size={13} />
                        Add symbol
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: "repeat(auto-fill, minmax(max(150px, var(--tile)), 1fr))" }}
                >
                  {members.map((s) => (
                    <SymbolCard
                      key={s.id}
                      symbol={s}
                      doc={doc}
                      palette={palette}
                      setId={element.id}
                      actions={actions}
                      selected={selection?.kind === "symbol" && selection.id === s.id}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}
        </div>

        {/* RIGHT COLUMN: Configuration Panel (8 Required F11 Sections) */}
        <aside
          aria-label="Element configuration panel"
          data-testid="element-config-panel"
          className="space-y-4 rounded-xl border border-white/[0.07] bg-ink-900 p-4 text-[11.5px]"
        >
          {/* SECTION 1: Identity */}
          <section data-section="identity" className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                1. Identity
              </h3>
              <span className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 font-mono text-[9.5px] text-ink-300">
                {meta.label}
              </span>
            </div>
            <p className="leading-relaxed text-ink-400">{meta.description}</p>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-ink-400">Element ID</dt>
              <dd className="flex items-center justify-end gap-1.5 font-mono text-ink-200">
                <span className="truncate">{element.id}</span>
                <button
                  type="button"
                  aria-label="Copy element ID"
                  onClick={copyId}
                  className="focus-ring rounded p-0.5 text-ink-400 hover:text-ink-100"
                >
                  <Icon name="copy" size={11} />
                </button>
                {copiedId ? <span className="text-[9.5px] text-emerald-300">Copied</span> : null}
              </dd>
              <dt className="text-ink-400">Origin</dt>
              <dd className="text-right capitalize text-ink-200">{element.origin}</dd>
            </dl>

            <Field label="Group">
              <CommitInput
                value={element.group}
                label="Element group"
                maxLength={60}
                onCommit={(group) => actions.updateElement(element.id, { group }, `Change group of ${element.name}`)}
              />
            </Field>

            <Field label="Description">
              <CommitTextArea
                value={isSet ? (element.symbolSet?.description ?? element.description ?? "") : (element.description ?? "")}
                label="Element description"
                placeholder="Describe this element’s role in the game"
                onCommit={(description) =>
                  actions.updateElement(
                    element.id,
                    isSet ? { description, symbolSet: { description } } : { description },
                    `Edit description of ${element.name}`,
                  )
                }
              />
            </Field>

            <Field label="Tags">
              <TagsInput
                value={isSet ? (element.symbolSet?.tags ?? element.tags ?? []) : (element.tags ?? [])}
                label="Element tags"
                onCommit={(tags) =>
                  actions.updateElement(
                    element.id,
                    isSet ? { tags, symbolSet: { tags } } : { tags },
                    `Edit tags of ${element.name}`,
                  )
                }
              />
            </Field>
          </section>

          {/* SECTION 2: Artwork */}
          <section data-section="artwork" className="space-y-3 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                2. Artwork
              </h3>
              <span className="font-mono text-[9.5px] text-ink-400">
                {formatAssetRef(currentImageRef)}
              </span>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px]">
              <dt className="text-ink-400">Linked Asset</dt>
              <dd className="truncate text-right text-ink-200">
                {image ? image.name : assetNameOf(currentImageRef, doc.assets)}
              </dd>
              {image?.format ? (
                <>
                  <dt className="text-ink-400">Format</dt>
                  <dd className="text-right font-mono text-ink-300">{image.format}</dd>
                </>
              ) : null}
            </dl>

            {!isSet ? (
              <>
                <Field label="Choose existing asset">
                  <AssetRefPicker
                    label="Element artwork asset"
                    value={currentImageRef}
                    assets={pickerAssets}
                    onChange={(ref) => {
                      if (onApply) {
                        applyDocChange(ref ? "Assign element artwork" : "Clear element artwork", (d) =>
                          replaceElementArtwork(d, element.id, ref, {
                            source: "upload",
                            notes: ref ? "Assigned asset from library" : "Cleared artwork",
                          }),
                        );
                      } else {
                        actions.updateElement(
                          element.id,
                          { image: ref, imageSource: "upload", imageNotes: "Updated artwork reference" },
                          `Update artwork of ${element.name}`,
                        );
                      }
                    }}
                  />
                </Field>

                <div className="flex flex-wrap gap-1.5">
                  <Button
                    className="h-7 px-2.5 text-[11px]"
                    onClick={() => actions.replaceImage({ kind: "element", id: element.id })}
                  >
                    <Icon name="replace" size={12} />
                    {image ? "Replace Image" : "Upload Image"}
                  </Button>
                  <Button
                    className="h-7 px-2.5 text-[11px]"
                    disabled={!image && !currentImageRef}
                    onClick={() => {
                      if (onApply) {
                        applyDocChange("Clear element artwork", (d) => clearElementArtwork(d, element.id));
                      } else {
                        actions.removeImage({ kind: "element", id: element.id });
                      }
                    }}
                  >
                    <Icon name="x" size={12} />
                    Clear
                  </Button>
                  <Button
                    className="h-7 px-2.5 text-[11px]"
                    disabled={!previousRevision}
                    title={previousRevision ? `Restore revision ${previousRevision.id}` : "No previous revision"}
                    onClick={() => {
                      if (!previousRevision) return;
                      applyDocChange("Restore previous element artwork", (d) =>
                        restorePreviousElementImageRevision(d, element.id),
                      );
                    }}
                  >
                    <Icon name="refresh-ccw" size={12} />
                    Restore Previous
                  </Button>
                  <Button
                    className="h-7 px-2.5 text-[11px]"
                    disabled={!image}
                    onClick={() => actions.download({ kind: "element", id: element.id })}
                  >
                    <Icon name="download" size={12} />
                    Download
                  </Button>
                </div>
              </>
            ) : (
              <div className="space-y-2.5">
                <Field label="Set Frame Artwork">
                  <AssetRefPicker
                    label="Set frame asset"
                    value={element.symbolSet?.frame ?? null}
                    assets={pickerAssets}
                    onChange={(frame) =>
                      actions.updateElement(element.id, { symbolSet: { frame } }, `Set frame of ${element.name}`)
                    }
                  />
                </Field>
                <Field label="Set Background Artwork">
                  <AssetRefPicker
                    label="Set background asset"
                    value={element.symbolSet?.background ?? null}
                    assets={pickerAssets}
                    onChange={(background) =>
                      actions.updateElement(element.id, { symbolSet: { background } }, `Set background of ${element.name}`)
                    }
                  />
                </Field>
              </div>
            )}
          </section>

          {/* SECTION 3: Style */}
          <section data-section="style" className="space-y-3 border-t border-white/[0.07] pt-4">
            <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
              3. Style
            </h3>

            <Field label="Style guide & visual direction">
              <CommitTextArea
                value={isSet ? (element.symbolSet?.styleGuide ?? "") : (element.style?.styleGuide ?? "")}
                label="Element style guide"
                placeholder="Material, lighting, stroke, and palette rules for this element"
                onCommit={(styleGuide) =>
                  actions.updateElement(
                    element.id,
                    isSet ? { symbolSet: { styleGuide } } : { style: { styleGuide } },
                    `Update style guide of ${element.name}`,
                  )
                }
              />
            </Field>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Blend mode">
                <Select
                  aria-label="Element blend mode"
                  className="creation-input"
                  value={element.style?.blendMode ?? "normal"}
                  onChange={(e) =>
                    actions.updateElement(
                      element.id,
                      { style: { blendMode: e.target.value as BlendMode } },
                      `Change blend mode of ${element.name}`,
                    )
                  }
                >
                  {BLEND_MODE_OPTIONS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={`Opacity (${Math.round((element.style?.opacity ?? 1) * 100)}%)`}>
                <input
                  type="range"
                  aria-label="Element opacity"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={element.style?.opacity ?? 1}
                  onChange={(e) =>
                    actions.updateElement(
                      element.id,
                      { style: { opacity: Number(e.target.value) } },
                      `Change opacity of ${element.name}`,
                    )
                  }
                  className="mt-2 w-full accent-accent-500"
                />
              </Field>
            </div>

            <Field label="Tint color (optional)">
              <CommitInput
                value={element.style?.tintColor ?? ""}
                label="Element tint color"
                allowEmpty
                maxLength={32}
                placeholder="#d4af37 or leave blank"
                onCommit={(tintColor) =>
                  actions.updateElement(
                    element.id,
                    { style: { tintColor: tintColor.trim() || undefined } },
                    `Change tint color of ${element.name}`,
                  )
                }
              />
            </Field>

            {isSet ? (
              <div className="grid grid-cols-2 gap-2.5">
                <Field label="Symbol type">
                  <Select
                    aria-label="Symbol type"
                    className="creation-input"
                    value={element.symbolSet?.symbolType ?? "custom"}
                    onChange={(e) =>
                      actions.updateElement(
                        element.id,
                        { symbolSet: { symbolType: e.target.value as never } },
                        `Change symbol type of ${element.name}`,
                      )
                    }
                  >
                    {SET_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Value tier">
                  <Select
                    aria-label="Value tier"
                    className="creation-input"
                    value={element.symbolSet?.valueTier ?? "medium"}
                    onChange={(e) =>
                      actions.updateElement(
                        element.id,
                        { symbolSet: { valueTier: e.target.value as never } },
                        `Change value tier of ${element.name}`,
                      )
                    }
                  >
                    {VALUE_TIERS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}

            {element.type === "reel_frame" ? (
              <Field label="Frame style">
                <Select
                  aria-label="Frame style"
                  className="creation-input"
                  value={String(element.params.style ?? "Themed")}
                  onChange={(e) => setParams({ style: e.target.value }, `Change frame style of ${element.name}`)}
                >
                  {FRAME_STYLES.map((s) => (
                    <option key={s.id} value={s.label}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {element.type === "game_background" ? (
              <Field label="Aspect ratio">
                <Select
                  aria-label="Aspect ratio"
                  className="creation-input"
                  value={String(element.params.aspect ?? "16:9")}
                  onChange={(e) => setParams({ aspect: e.target.value }, `Change aspect of ${element.name}`)}
                >
                  {ASPECTS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label} — {a.hint}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            {element.type === "button_set" ? (
              <Field label="Included buttons">
                <div className="flex flex-wrap gap-1.5">
                  {BUTTONS.map((b) => {
                    const on = buttons.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        type="button"
                        aria-pressed={on}
                        disabled={b.required}
                        title={b.required ? "Spin is required" : undefined}
                        onClick={() => {
                          const next = on ? buttons.filter((x) => x !== b.id) : [...buttons, b.id];
                          setParams({ buttons: next.join(","), count: next.length }, `Change buttons of ${element.name}`);
                        }}
                        className={`focus-ring rounded-md border px-2 py-1 text-[10.5px] transition disabled:cursor-not-allowed ${
                          on
                            ? "border-accent-500/40 bg-accent-500/[0.12] text-blue-200"
                            : "border-white/10 text-ink-300 hover:text-ink-100"
                        }`}
                      >
                        {b.label}
                      </button>
                    );
                  })}
                </div>
              </Field>
            ) : null}

            {symbol ? (
              <Field label="Symbol value tier">
                <Select
                  aria-label="Symbol value tier"
                  className="creation-input"
                  disabled={symbol.tier === "special"}
                  value={valueOfTier(symbol.tier)}
                  onChange={(e) => actions.setSymbolTier(symbol.id, e.target.value as ValueTier)}
                >
                  {VALUE_TIERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <Field label="Notes">
              <CommitTextArea
                value={element.notes}
                label="Notes"
                placeholder="Production notes for your team"
                onCommit={(notes) => actions.updateElement(element.id, { notes }, `Edit notes of ${element.name}`)}
              />
            </Field>
          </section>

          {/* SECTION 4: Variants */}
          <section data-section="variants" className="space-y-3 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                4. Variants ({variants.length})
              </h3>
              <span className="text-[10px] text-ink-400">Independent stable IDs</span>
            </div>
            <VariantManager
              baseSymbolName={element.name}
              variants={variants}
              assets={pickerAssets}
              onAdd={(name) => {
                if (symbol) {
                  actions.addVariant(symbol.id);
                } else {
                  applyDocChange(`Add variant to ${element.name}`, (d) => addElementVariant(d, element.id, { name }).doc);
                }
              }}
              onRename={(vid, name) => {
                if (symbol) {
                  actions.renameVariant(symbol.id, vid, name);
                } else {
                  applyDocChange("Rename element variant", (d) => editElementVariant(d, element.id, vid, { name }));
                }
              }}
              onDuplicate={(vid) => {
                if (symbol) {
                  actions.duplicateVariant(symbol.id, vid);
                } else {
                  applyDocChange("Duplicate element variant", (d) =>
                    duplicateElementVariant(d, element.id, vid).doc,
                  );
                }
              }}
              onRemove={(vid) => {
                if (symbol) {
                  actions.removeVariant(symbol.id, vid);
                } else {
                  applyDocChange("Remove element variant", (d) => removeElementVariant(d, element.id, vid));
                }
              }}
              onImageChange={(vid, img) => {
                if (symbol) {
                  actions.setVariantImage(symbol.id, vid, img);
                } else {
                  applyDocChange("Set element variant image", (d) =>
                    editElementVariant(d, element.id, vid, { image: img }),
                  );
                }
              }}
            />
          </section>

          {/* SECTION 5: Extras */}
          <section data-section="extras" className="space-y-3 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                5. Extras
              </h3>
              <span className="text-[10px] text-ink-400">Custom parameters &amp; flags</span>
            </div>
            <ExtrasEditor
              value={extrasValue}
              onCommit={(next) => {
                const params: Record<string, string | number | boolean> = {};
                for (const [k, v] of Object.entries(next)) {
                  params[k] = v;
                }
                actions.updateElement(
                  element.id,
                  { extras: next, params },
                  `Update extras of ${element.name}`,
                );
              }}
            />
          </section>

          {/* SECTION 6: Animation */}
          <section data-section="animation" className="space-y-3 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                6. Animation
              </h3>
              <Button
                className="h-6 px-2 text-[10px]"
                onClick={() =>
                  applyDocChange(`Add animation cue for ${element.name}`, (d) =>
                    addElementAnimationCue(d, element.id).doc,
                  )
                }
              >
                <Icon name="plus" size={11} />
                Add Cue
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Animation preset">
                <Select
                  aria-label="Animation preset"
                  className="creation-input"
                  value={animConfig.preset}
                  onChange={(e) =>
                    actions.updateElement(
                      element.id,
                      { animation: { ...animConfig, preset: e.target.value as ElementAnimationConfig["preset"] } },
                      `Change animation preset of ${element.name}`,
                    )
                  }
                >
                  {ANIMATION_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Default trigger">
                <Select
                  aria-label="Animation trigger"
                  className="creation-input"
                  value={animConfig.trigger}
                  onChange={(e) =>
                    actions.updateElement(
                      element.id,
                      { animation: { ...animConfig, trigger: e.target.value as ElementAnimationConfig["trigger"] } },
                      `Change animation trigger of ${element.name}`,
                    )
                  }
                >
                  {ANIMATION_TRIGGERS.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Field label="Duration (ms)">
                <input
                  type="number"
                  aria-label="Animation duration ms"
                  min={0}
                  max={60000}
                  step={50}
                  value={animConfig.durationMs}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n) && n >= 0) {
                      actions.updateElement(
                        element.id,
                        { animation: { ...animConfig, durationMs: Math.round(n) } },
                        `Change animation duration of ${element.name}`,
                      );
                    }
                  }}
                  className="creation-input font-mono text-[11px]"
                />
              </Field>

              <Field label="Easing">
                <Select
                  aria-label="Animation easing"
                  className="creation-input"
                  value={animConfig.easing}
                  onChange={(e) =>
                    actions.updateElement(
                      element.id,
                      { animation: { ...animConfig, easing: e.target.value } },
                      `Change animation easing of ${element.name}`,
                    )
                  }
                >
                  {EASING_OPTIONS.map((eas) => (
                    <option key={eas} value={eas}>
                      {eas}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <label className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-ink-950/40 px-3 py-2 text-[11px]">
              <span className="text-ink-200">Loop animation continuously</span>
              <input
                type="checkbox"
                aria-label="Loop animation"
                checked={Boolean(animConfig.loop)}
                onChange={(e) =>
                  actions.updateElement(
                    element.id,
                    { animation: { ...animConfig, loop: e.target.checked } },
                    `Toggle animation loop of ${element.name}`,
                  )
                }
                className="h-3.5 w-3.5 accent-accent-500"
              />
            </label>

            {elementCues.length > 0 ? (
              <ul className="space-y-1.5 pt-1">
                {elementCues.map((cue) => (
                  <li
                    key={cue.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-white/[0.07] bg-ink-950/60 px-2.5 py-1.5 text-[10.5px]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 font-medium text-ink-100">
                        <span>{cue.name ?? cue.kind}</span>
                        <span className="rounded border border-white/10 px-1 py-0 text-[9px] text-ink-400">
                          {cue.animationType ?? cue.trigger}
                        </span>
                      </div>
                      <div className="font-mono text-[9.5px] text-ink-400">
                        {cue.duration ?? cue.durationMs}ms · {cue.fps ?? 24}fps · {cue.state ?? "enabled"}
                      </div>
                    </div>
                    <Select
                      aria-label={`Trigger for cue ${cue.id}`}
                      value={cue.trigger}
                      className="h-6 rounded border border-white/10 bg-ink-900 px-1.5 text-[10px]"
                      onChange={(e) =>
                        applyDocChange("Update animation cue trigger", (d) =>
                          updateElementAnimationCue(d, cue.id, {
                            trigger: e.target.value as ElementAnimationConfig["trigger"],
                          }),
                        )
                      }
                    >
                      {ANIMATION_TRIGGERS.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      aria-label={`Remove animation cue ${cue.id}`}
                      onClick={() =>
                        applyDocChange("Remove animation cue", (d) => removeElementAnimationCue(d, cue.id))
                      }
                      className="focus-ring rounded p-1 text-ink-400 hover:text-rose-300"
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {/* F18 Animation Panel (Animation Extra, Add Animation, Preview, Enable/Disable, Rename, Delete, Playback, Sprites/Video, Standalone Layer) */}
            <div className="pt-2">
              <ElementAnimationPanel
                doc={doc}
                element={element}
                palette={palette}
                projectId={projectId}
                blueprint={blueprint}
                onApply={applyDocChange}
              />
            </div>
          </section>

          {/* SECTION 7: History */}
          <section data-section="history" className="space-y-3 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                7. History ({imageHistory.length})
              </h3>
            </div>

            <ImageHistoryPanel
              doc={doc}
              blueprint={blueprint}
              target={{ kind: "element", id: element.id }}
              palette={palette}
              fallbackGlyph={symbol?.glyph ?? "◆"}
              onApply={(label, fn) => applyDocChange(label, fn)}
            />
          </section>

          {/* SECTION 8: Usage (Symbol Sets, Scenes, Layers, Reels, Paytable, Animations) */}
          <section data-section="usage" className="space-y-3 border-t border-white/[0.07] pt-4">
            <div className="flex items-center justify-between">
              <h3 className="text-[10px] font-semibold tracking-[0.16em] text-ink-400 uppercase">
                8. Usage ({usage?.totalCount ?? 0})
              </h3>
              <span className="text-[10px] text-ink-400">6 dependent categories</span>
            </div>

            <div className="space-y-2.5">
              {(
                [
                  ["Symbol Sets", usage?.symbolSets ?? []],
                  ["Scenes", usage?.scenes ?? []],
                  ["Layers", usage?.layers ?? []],
                  ["Reels", usage?.reels ?? []],
                  ["Paytable", usage?.paytable ?? []],
                  ["Animations", usage?.animations ?? []],
                ] as const
              ).map(([categoryLabel, entries]) => (
                <div
                  key={categoryLabel}
                  data-usage-category={categoryLabel}
                  className="rounded-lg border border-white/[0.06] bg-ink-950/40 p-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] font-semibold text-ink-200">{categoryLabel}</span>
                    <span
                      className={`rounded border px-1.5 py-0 font-mono text-[9.5px] ${
                        entries.length > 0
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                          : "border-white/10 text-ink-500"
                      }`}
                    >
                      {entries.length}
                    </span>
                  </div>
                  {entries.length === 0 ? (
                    <p className="mt-1 text-[10px] text-ink-500">Not referenced in {categoryLabel.toLowerCase()}.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {entries.map((entry) => (
                        <li key={entry.id} className="text-[10px] leading-snug">
                          <span className="font-medium text-ink-100">{entry.label}</span>
                          <span className="text-ink-400"> — {entry.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
