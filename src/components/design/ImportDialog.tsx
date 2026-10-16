"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Select, TextInput } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import { ELEMENT_TYPES } from "@/lib/blueprint/elements";
import type { ElementType, SymbolSetType, ValueTier } from "@/lib/blueprint/types";
import { ACCEPTED_IMAGE_TYPES, formatBytes, guessElementType } from "@/lib/creation/images";
import { SET_TYPES, VALUE_TIERS } from "@/lib/design/model";
import type { ImportSetOptions } from "@/lib/design/types";

export interface ImportRow {
  key: string;
  file: File;
  name: string;
  type: ElementType;
}

interface Props {
  open: boolean;
  /** When set, every file becomes a symbol of this set and the type choices are hidden. */
  intoSet?: { id: string; name: string } | null;
  initialFiles?: File[];
  onClose: () => void;
  onImport: (rows: ImportRow[], set: ImportSetOptions) => Promise<void>;
}

const MAX_FILES = 24;

export function ImportDialog({ open, intoSet, initialFiles, onClose, onImport }: Props) {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [setName, setSetName] = useState("Imported Set");
  const [symbolType, setSymbolType] = useState<SymbolSetType>("custom");
  const [valueTier, setValueTier] = useState<ValueTier>("medium");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  const inputRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const seq = useRef(0);

  const revoke = useCallback(() => {
    urls.current.forEach((url) => URL.revokeObjectURL(url));
    urls.current = [];
  }, []);

  const addFiles = useCallback((files: File[]) => {
    const accepted = files.filter((f) => ACCEPTED_IMAGE_TYPES.some((t) => t === f.type));
    const skipped = files.length - accepted.length;
    setRows((current) => {
      const room = Math.max(0, MAX_FILES - current.length);
      const added = accepted.slice(0, room).map((file): ImportRow => {
        seq.current += 1;
        const key = `import-${seq.current}`;
        const url = URL.createObjectURL(file);
        urls.current.push(url);
        setPreviews((p) => ({ ...p, [key]: url }));
        return { key, file, name: file.name.replace(/\.[a-z0-9]+$/i, ""), type: intoSet ? "symbol_set" : guessElementType(file.name) };
      });
      const dropped = accepted.length - added.length;
      setNotice(skipped || dropped ? `${skipped ? `${skipped} file(s) skipped — only PNG, JPEG and WebP are supported. ` : ""}${dropped ? `Up to ${MAX_FILES} files per import.` : ""}` : null);
      return [...current, ...added];
    });
  }, [intoSet]);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setRows([]); setPreviews({}); setSetName("Imported Set"); setSymbolType("custom"); setValueTier("medium"); setBusy(false); setNotice(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    revoke();
    const timer = initialFiles?.length ? window.setTimeout(() => addFiles(initialFiles), 0) : null;
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      revoke();
    };
  }, [open, initialFiles, addFiles, revoke]);

  const hasSetRows = rows.some((r) => r.type === "symbol_set");
  const submit = async () => {
    if (!rows.length || busy) return;
    setBusy(true);
    try {
      await onImport(rows, { name: setName.trim() || "Imported Set", symbolType, valueTier });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} width="lg"
      title={intoSet ? `Import images into “${intoSet.name}”` : "Import artwork"}
      description={intoSet ? "Each image becomes a symbol with its artwork linked." : "Choose an element type for each file. Images typed “Symbol Set” are grouped into one new set."}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={busy || rows.length === 0}>{busy ? "Importing…" : `Import ${rows.length || ""} ${rows.length === 1 ? "file" : "files"}`.trim()}</Button>
      </>}>
      <div className="space-y-4">
        <input ref={inputRef} type="file" hidden multiple aria-label="Choose artwork files" accept={ACCEPTED_IMAGE_TYPES.join(",")} onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <div onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(Array.from(e.dataTransfer.files)); }}
          className={`rounded-lg border border-dashed px-4 py-5 text-center transition ${over ? "border-accent-500/70 bg-accent-500/10" : "border-white/15 bg-ink-950/30"}`}>
          <Icon name="upload" size={18} className="mx-auto text-ink-300" />
          <p className="mt-1.5 text-[12px] text-ink-200">Drop images here, or <button type="button" onClick={() => inputRef.current?.click()} className="focus-ring rounded font-medium text-accent-400 hover:text-blue-200">browse files</button></p>
          <p className="mt-1 text-[10.5px] text-ink-400">PNG, JPEG or WebP · large images are resized for storage</p>
        </div>
        {notice ? <p role="alert" className="text-[11px] text-amber-200">{notice}</p> : null}

        {rows.length > 0 ? (
          <ul className="max-h-[38vh] space-y-2 overflow-y-auto pr-1">
            {rows.map((row) => (
              <li key={row.key} className="flex items-center gap-2.5 rounded-lg border border-white/[0.08] bg-ink-950/30 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previews[row.key]} alt="" className="artwork-checker h-11 w-11 shrink-0 rounded-md border border-white/10 object-contain" />
                <div className="grid min-w-0 flex-1 gap-1.5 sm:grid-cols-[1fr_180px]">
                  <TextInput aria-label={`Name for ${row.file.name}`} className="creation-input h-8 py-0" value={row.name} maxLength={80}
                    onChange={(e) => setRows((c) => c.map((r) => (r.key === row.key ? { ...r, name: e.target.value } : r)))} />
                  {intoSet ? <span className="self-center text-[11px] text-ink-400">Symbol · {formatBytes(row.file.size)}</span> : (
                    <Select aria-label={`Element type for ${row.file.name}`} className="creation-input h-8 py-0" value={row.type}
                      onChange={(e) => setRows((c) => c.map((r) => (r.key === row.key ? { ...r, type: e.target.value as ElementType } : r)))}>
                      {ELEMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </Select>
                  )}
                </div>
                <button type="button" aria-label={`Remove ${row.file.name}`} disabled={busy} onClick={() => setRows((c) => c.filter((r) => r.key !== row.key))} className="focus-ring rounded p-1.5 text-ink-400 hover:text-rose-300"><Icon name="x" size={13} /></button>
              </li>
            ))}
          </ul>
        ) : null}

        {hasSetRows && !intoSet ? (
          <fieldset className="grid gap-3 rounded-lg border border-white/[0.07] p-3 sm:grid-cols-3">
            <legend className="px-1 text-[10px] tracking-wider text-ink-400 uppercase">New symbol set</legend>
            <Field label="Set name"><TextInput aria-label="New set name" className="creation-input" value={setName} maxLength={80} onChange={(e) => setSetName(e.target.value)} /></Field>
            <Field label="Symbol type"><Select aria-label="New set symbol type" className="creation-input" value={symbolType} onChange={(e) => setSymbolType(e.target.value as SymbolSetType)}>{SET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
            <Field label="Value tier"><Select aria-label="New set value tier" className="creation-input" value={valueTier} onChange={(e) => setValueTier(e.target.value as ValueTier)}>{VALUE_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
          </fieldset>
        ) : null}
      </div>
    </Modal>
  );
}
