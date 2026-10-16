"use client";

import { useEffect, useRef, useState } from "react";
import { Select, TextInput } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { ELEMENT_TYPES } from "@/lib/blueprint/elements";
import type { ElementType } from "@/lib/blueprint/types";
import { CREATION_ELEMENT_TYPE_IDS, MAX_ARTWORK, type ImportedArtwork, type ImportedImage } from "@/lib/creation/draft";
import { ACCEPTED_IMAGE_TYPES, formatBytes, importImageFile } from "@/lib/creation/images";
import { SectionCard } from "./fields";

const CREATION_ELEMENT_TYPES = ELEMENT_TYPES.filter((type) =>
  CREATION_ELEMENT_TYPE_IDS.includes(type.id),
);

function DropZone({ multiple, label, sublabel, onFiles, busy, compact, inputLabel, disabled = false }: {
  multiple: boolean; label: string; sublabel: string; onFiles: (files: File[]) => void;
  busy: boolean; compact?: boolean; inputLabel: string; disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const locked = busy || disabled;
  return <div data-dropzone="artwork" onDragOver={(event) => {
    if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.stopPropagation(); if (!locked) setOver(true); }
  }} onDragLeave={() => setOver(false)} onDrop={(event) => {
    event.preventDefault(); event.stopPropagation(); setOver(false);
    if (locked || event.currentTarget.closest("fieldset")?.disabled) return;
    const files = Array.from(event.dataTransfer.files); if (files.length) onFiles(multiple ? files : files.slice(0, 1));
  }} className={`rounded-lg border border-dashed transition ${compact ? "p-3" : "px-4 py-5"} ${over ? "border-accent-500/70 bg-accent-500/10" : "border-white/15 bg-ink-950/25 hover:border-white/25"}`}>
    <input ref={inputRef} type="file" aria-label={inputLabel} hidden disabled={locked} multiple={multiple} accept={ACCEPTED_IMAGE_TYPES.join(",")}
      onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length && !locked) onFiles(files); }} />
    <div className={compact ? "flex items-center gap-3" : "text-center"}>
      <span className={`grid shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-ink-300 ${compact ? "h-9 w-9" : "mx-auto mb-2.5 h-9 w-9"}`}><Icon name={compact ? "image" : "upload"} size={17} /></span>
      <div className="min-w-0"><p className="text-[11.5px] text-ink-200">{label}</p><p className="mt-1 text-[10px] leading-relaxed text-ink-300/65">{sublabel}</p>
        <button type="button" disabled={locked} onClick={() => inputRef.current?.click()}
          className={`focus-ring mt-2 text-[11px] font-medium text-accent-400 transition hover:text-blue-200 disabled:opacity-40 ${compact ? "" : "rounded-md border border-white/10 bg-white/[0.025] px-3 py-1.5 text-ink-200"}`}>
          {busy ? "Importing image…" : compact ? "Choose image" : "Browse files"}
        </button>
      </div>
    </div>
  </div>;
}

/** Import state is reported to the form so a half-decoded file can never be submitted. */
function useImportState(onBusyChange?: (busy: boolean) => void) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; if (pending.current) onBusyChange?.(false); }; }, [onBusyChange]);
  return {
    busy, active,
    start() { if (pending.current) return false; pending.current = true; setBusy(true); onBusyChange?.(true); return true; },
    finish() { pending.current = false; if (active.current) setBusy(false); onBusyChange?.(false); },
  };
}

export function ReferenceImageArea({ image, onChange, onError, onBusyChange }: {
  image: ImportedImage | null; onChange: (image: ImportedImage | null) => void;
  onError: (message: string) => void; onBusyChange?: (busy: boolean) => void;
}) {
  const importer = useImportState(onBusyChange);
  const handle = async (files: File[]) => {
    if (!files[0] || !importer.start()) return;
    try { const next = await importImageFile(files[0]); if (importer.active.current) onChange(next); }
    catch (error) { if (importer.active.current) onError(error instanceof Error ? error.message : "Image import failed."); }
    finally { importer.finish(); }
  };
  return <div>
    <div className="mb-2 flex items-center justify-between text-[10.5px] font-medium text-ink-300">
      <span>Reference image <span className="ml-1 text-ink-400">Optional</span></span>
      {image ? <div className="flex items-center gap-2">
        <button type="button" onClick={() => onChange(null)} aria-label="Remove reference image" className="focus-ring rounded p-1 text-ink-400 hover:text-rose-300"><Icon name="x" size={12} /></button>
      </div> : null}
    </div>
    {image ? <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-ink-950/30 p-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.dataUrl} alt="Reference artwork" className="h-14 w-20 shrink-0 rounded-md object-cover" />
      <div className="min-w-0"><div className="truncate text-[11px] text-ink-100" title={image.name}>{image.name}</div>
        <div className="mt-1 font-mono text-[9px] text-ink-300/70">{image.width}×{image.height} · {formatBytes(image.bytes)}</div>
        <p className="mt-1 text-[10px] text-ink-400">Stored as a style reference.</p></div>
    </div> : <DropZone multiple={false} compact busy={importer.busy} label="Drop a visual reference"
      sublabel="PNG, JPG or WebP. For your team's direction only." inputLabel="Import reference image" onFiles={(files) => void handle(files)} />}
  </div>;
}

export function ArtworkImportPanel({ artwork, onAdd, onChangeItem, onRemove, onError, onBusyChange, disabled }: {
  artwork: ImportedArtwork[]; onAdd: (items: ImportedArtwork[]) => void;
  onChangeItem: (id: string, patch: Partial<ImportedArtwork>) => void; onRemove: (id: string) => void;
  onError: (message: string) => void; onBusyChange?: (busy: boolean) => void; disabled?: boolean;
}) {
  const importer = useImportState(onBusyChange);
  const handle = async (files: File[]) => {
    if (disabled || !importer.start()) return;
    const room = Math.max(0, MAX_ARTWORK - artwork.length);
    const errors: string[] = [], added: ImportedArtwork[] = [];
    if (files.length > room) errors.push(`Up to ${MAX_ARTWORK} artwork files per project; extra files were skipped.`);
    try {
      for (const file of files.slice(0, room)) {
        if (!importer.active.current) break;
        try { const image = await importImageFile(file); added.push({ ...image, elementType: guessType(file.name) }); }
        catch (error) { errors.push(error instanceof Error ? error.message : `${file.name}: import failed.`); }
      }
      if (importer.active.current) { if (added.length) onAdd(added); if (errors.length) onError(errors.join(" ")); }
    } finally { importer.finish(); }
  };
  return <SectionCard title="Bring your own artwork" icon="upload" aside={<span className="font-mono text-[10px] text-ink-400">{artwork.length} / {MAX_ARTWORK}</span>}>
    <p className="text-[11px] leading-relaxed text-ink-300/75">Import existing art and choose its element type. No generation required. Title, background, frame and button artwork links to matching planned elements.</p>
    <DropZone multiple busy={importer.busy} disabled={disabled || artwork.length >= MAX_ARTWORK} label="Drag artwork here, or browse your files"
      sublabel="PNG, JPG, WebP · 15 MB per source file · resized up to 1600 px" inputLabel="Import game artwork" onFiles={(files) => void handle(files)} />
    {artwork.length ? <ul className="grid gap-2 lg:grid-cols-2">
      {artwork.map((item) => <li key={item.id} className="flex min-w-0 items-center gap-2.5 rounded-lg border border-white/[0.08] bg-ink-950/30 p-2.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={item.dataUrl} alt={item.name} className="artwork-checker h-12 w-12 shrink-0 rounded-md border border-white/10 object-contain" />
        <div className="grid min-w-0 flex-1 gap-1.5">
          <TextInput aria-label="Artwork name" value={item.name} maxLength={120} className="h-7 py-0 text-[11px]" onChange={(event) => onChangeItem(item.id, { name: event.target.value })} />
          <Select aria-label={`Element type for ${item.name}`} value={item.elementType} className="h-7 py-0 text-[10px]"
            onChange={(event) => onChangeItem(item.id, { elementType: event.target.value as ElementType })}>
            {CREATION_ELEMENT_TYPES.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
          </Select>
          <span className="font-mono text-[9px] text-ink-400">{item.width}×{item.height} · {formatBytes(item.bytes)}</span>
        </div>
        <button type="button" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.name}`} className="focus-ring rounded p-1 text-ink-400 hover:text-rose-300"><Icon name="x" size={13} /></button>
      </li>)}
    </ul> : null}
    {artwork.some((item) => item.elementType === "symbol" || item.elementType === "symbol_set") ? <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-300/70"><Icon name="info" size={13} className="mt-px shrink-0" />Imported symbol art is kept as an element. Assigning it to reel symbols is reserved for a later editor phase.</p> : null}
  </SectionCard>;
}

function guessType(filename: string): ElementType {
  const name = filename.toLowerCase();
  if (/(logo|title)/.test(name)) return "game_title";
  if (/(background|\bbg\b|backdrop)/.test(name)) return "game_background";
  if (/(frame|border)/.test(name)) return "reel_frame";
  if (/(button|btn|spin)/.test(name)) return "button_set";
  if (/(symbol|icon)/.test(name)) return "symbol";
  return "other_asset";
}
