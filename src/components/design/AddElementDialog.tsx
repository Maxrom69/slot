"use client";

import { useRef, useState } from "react";
import { Chip, Stepper } from "@/components/creation/fields";
import { Button, Field, Select, TextInput } from "@/components/ui/Controls";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { AssetRef, ElementType, SymbolSetType, ValueTier } from "@/lib/blueprint/types";
import { ASPECTS, BUTTONS, FRAME_STYLES, type SpecialKind } from "@/lib/creation/draft";
import { ACCEPTED_IMAGE_TYPES } from "@/lib/creation/images";
import { DEFAULT_NAMES, SET_TYPES, VALUE_TIERS } from "@/lib/design/model";
import type { NewElementInput } from "@/lib/design/types";

const TYPES: { id: ElementType; icon: IconName; label: string; hint: string }[] = [
  { id: "symbol_set", icon: "layers", label: "Symbol Set", hint: "A group of related symbols with a type and value tier" },
  { id: "symbol", icon: "diamond", label: "Symbol", hint: "A standalone symbol, including Wild, Scatter or Bonus" },
  { id: "game_title", icon: "file", label: "Game Title", hint: "Logo and title lockup" },
  { id: "reel_frame", icon: "frame", label: "Reel Frame", hint: "Frame around the reel window" },
  { id: "game_background", icon: "image", label: "Game Background", hint: "Full-canvas scene background" },
  { id: "button_set", icon: "pointer", label: "Button Set", hint: "Spin, bet and utility controls" },
  { id: "other_asset", icon: "upload", label: "Other / Uploaded Asset", hint: "Custom or uploaded artwork asset" },
  { id: "uploaded", icon: "upload", label: "Uploaded Element", hint: "Artwork you bring, with editable metadata and image" },
  { id: "custom", icon: "settings", label: "Custom Element", hint: "A free-form element with its own parameters" },
];

interface Props {
  open: boolean;
  initialType?: ElementType;
  onClose: () => void;
  onAdd: (input: NewElementInput) => void;
  uploadImage: (file: File) => Promise<AssetRef | null>;
}

export function AddElementDialog({ open, initialType, onClose, onAdd, uploadImage }: Props) {
  const [type, setType] = useState<ElementType | null>(initialType ?? null);
  const [name, setName] = useState("");
  const [symbolType, setSymbolType] = useState<SymbolSetType>("custom");
  const [valueTier, setValueTier] = useState<ValueTier>("medium");
  const [count, setCount] = useState(3);
  const [behaviour, setBehaviour] = useState<SpecialKind | "">("");
  const [style, setStyle] = useState("Themed");
  const [aspect, setAspect] = useState("16:9");
  const [buttons, setButtons] = useState<string[]>(["spin"]);
  const [group, setGroup] = useState("");
  const [description, setDescription] = useState("");
  const [styleGuide, setStyleGuide] = useState("");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [prevKey, setPrevKey] = useState(`${open}:${initialType ?? ""}`);
  const fileRef = useRef<HTMLInputElement>(null);
  const parseTags = (raw: string) =>
    raw.split(",").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12);

  const nextKey = `${open}:${initialType ?? ""}`;
  if (prevKey !== nextKey) {
    setPrevKey(nextKey);
    if (open) {
      setType(initialType ?? null);
      setName(""); setSymbolType("custom"); setValueTier("medium"); setCount(3); setBehaviour("");
      setStyle("Themed"); setAspect("16:9"); setButtons(["spin"]); setGroup("");
      setDescription(""); setStyleGuide(""); setTags(""); setFile(null); setBusy(false);
    }
  }

  const submit = async () => {
    if (!type || busy) return;
    setBusy(true);
    let asset: AssetRef | undefined;
    if (file && type !== "symbol_set") {
      const uploaded = await uploadImage(file);
      if (!uploaded) { setBusy(false); return; }
      asset = uploaded;
    }
    const label = name.trim() || DEFAULT_NAMES[type];
    const input: NewElementInput =
      type === "symbol_set" ? { type, name: label, symbolType, valueTier, count, description, styleGuide, tags: parseTags(tags) }
        : type === "symbol" ? { type, name: label, valueTier, behaviour: behaviour || undefined, asset }
          : type === "reel_frame" ? { type, name: label, style, asset }
            : type === "game_background" ? { type, name: label, aspect, asset }
              : type === "button_set" ? { type, name: label, buttons, asset }
                : { type, name: label, group: group || undefined, asset };
    onAdd(input);
    setBusy(false);
  };

  const meta = TYPES.find((t) => t.id === type);
  return (
    <Modal open={open} onClose={onClose} width="md" title={meta ? `Add ${meta.label}` : "Add element"}
      description={meta ? meta.hint : "Choose what you want to add to this project."}
      footer={type ? (
        <>
          <Button variant="ghost" onClick={() => setType(null)} disabled={busy}><Icon name="arrow-left" size={13} />Back</Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy}>{busy ? "Adding…" : "Add element"}</Button>
        </>
      ) : <Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      {!type ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {TYPES.map((t) => (
            <button key={t.id} type="button" onClick={() => setType(t.id)}
              className="focus-ring flex items-start gap-3 rounded-lg border border-white/10 bg-ink-850 p-3 text-left transition hover:border-accent-500/40 hover:bg-white/[0.03]">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-white/10 text-ink-300"><Icon name={t.icon} size={16} /></span>
              <span><span className="block text-[12.5px] font-medium text-ink-100">{t.label}</span><span className="mt-0.5 block text-[10.5px] leading-snug text-ink-400">{t.hint}</span></span>
            </button>
          ))}
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <Field label="Name"><TextInput autoFocus aria-label="Element name" className="creation-input" value={name} maxLength={80} placeholder={DEFAULT_NAMES[type]} onChange={(e) => setName(e.target.value)} /></Field>

          {type === "symbol_set" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Symbol type"><Select aria-label="Symbol type" className="creation-input" value={symbolType} onChange={(e) => setSymbolType(e.target.value as SymbolSetType)}>{SET_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label} — {t.hint}</option>)}</Select></Field>
                <Field label="Value tier"><Select aria-label="Value tier" className="creation-input" value={valueTier} onChange={(e) => setValueTier(e.target.value as ValueTier)}>{VALUE_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/[0.07] px-3 py-2">
                <div><div className="text-[12px] text-ink-100">Starting symbols</div><div className="text-[10.5px] text-ink-400">You can add or import more later.</div></div>
                <Stepper label="starting symbols" value={count} min={0} max={12} onChange={setCount} />
              </div>
              <Field label="Description" hint="Optional notes stored on the set."><TextInput aria-label="Set description" className="creation-input" value={description} maxLength={800} placeholder="What this set is for" onChange={(e) => setDescription(e.target.value)} /></Field>
              <Field label="Style guide" hint="Optional art direction for this set."><TextInput aria-label="Set style guide" className="creation-input" value={styleGuide} maxLength={800} placeholder="Palette, lighting, materials" onChange={(e) => setStyleGuide(e.target.value)} /></Field>
              <Field label="Tags" hint="Comma-separated, up to 12."><TextInput aria-label="Set tags" className="creation-input" value={tags} maxLength={200} placeholder="premium, night, …" onChange={(e) => setTags(e.target.value)} /></Field>
            </>
          ) : null}

          {type === "symbol" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Value tier"><Select aria-label="Value tier" className="creation-input" value={valueTier} disabled={Boolean(behaviour)} onChange={(e) => setValueTier(e.target.value as ValueTier)}>{VALUE_TIERS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select></Field>
              <Field label="Special behaviour"><Select aria-label="Special behaviour" className="creation-input" value={behaviour} onChange={(e) => setBehaviour(e.target.value as SpecialKind | "")}><option value="">None — regular symbol</option><option value="wild">Wild</option><option value="scatter">Scatter</option><option value="bonus">Bonus</option></Select></Field>
            </div>
          ) : null}

          {type === "reel_frame" ? <Field label="Style"><Select aria-label="Frame style" className="creation-input" value={style} onChange={(e) => setStyle(e.target.value)}>{FRAME_STYLES.map((s) => <option key={s.id} value={s.label}>{s.label}</option>)}</Select></Field> : null}
          {type === "game_background" ? <Field label="Aspect ratio"><Select aria-label="Aspect ratio" className="creation-input" value={aspect} onChange={(e) => setAspect(e.target.value)}>{ASPECTS.map((a) => <option key={a.id} value={a.id}>{a.label} — {a.hint}</option>)}</Select></Field> : null}
          {type === "button_set" ? (
            <div role="group" aria-label="Buttons">
              <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-ink-300 uppercase">Buttons</span>
              <div className="flex flex-wrap gap-1.5">
                {BUTTONS.map((b) => <Chip key={b.id} active={buttons.includes(b.id)} disabled={b.required} onClick={() => setButtons((c) => c.includes(b.id) ? c.filter((x) => x !== b.id) : [...c, b.id])}>{b.label}</Chip>)}
              </div>
            </div>
          ) : null}
          {type === "uploaded" || type === "custom" || type === "other_asset" ? <Field label="Group" hint="Optional label used to organise uploaded art."><TextInput aria-label="Group" className="creation-input" value={group} maxLength={60} placeholder={type === "custom" ? "Other" : "Uploaded art"} onChange={(e) => setGroup(e.target.value)} /></Field> : null}

          {type !== "symbol_set" ? (
            <div>
              <span className="mb-1.5 block text-[11px] font-medium tracking-wide text-ink-300 uppercase">Image <span className="text-ink-400 normal-case">(optional)</span></span>
              <input ref={fileRef} type="file" hidden aria-label="Element image" accept={ACCEPTED_IMAGE_TYPES.join(",")} onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
              <div className="flex items-center gap-2">
                <Button onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="upload" size={13} />{file ? "Choose another" : "Choose image"}</Button>
                {file ? <span className="min-w-0 truncate text-[11px] text-ink-300">{file.name}</span> : <span className="text-[11px] text-ink-400">PNG, JPEG or WebP. You can also add it later.</span>}
                {file ? <button type="button" aria-label="Remove chosen image" onClick={() => setFile(null)} className="focus-ring rounded p-1 text-ink-400 hover:text-rose-300"><Icon name="x" size={12} /></button> : null}
              </div>
            </div>
          ) : null}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}
