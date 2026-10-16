"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { CommitInput } from "./CommitInput";
import type { AssetReference, SymbolVariant } from "@/lib/blueprint/types";

export function TagsInput({ value, onCommit, label }: { value: string[]; onCommit: (tags: string[]) => void; label: string }) {
  const [text, setText] = useState(value.join(", "));
  const [prev, setPrev] = useState(value);
  if (prev !== value) {
    setPrev(value);
    setText(value.join(", "));
  }
  const commit = () => {
    const tags = text.split(",").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, 12);
    if (tags.join("|") !== value.join("|")) onCommit(tags);
    else setText(value.join(", "));
  };
  return (
    <input
      aria-label={label}
      value={text}
      maxLength={200}
      placeholder="premium, night, …"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.stopPropagation();
          setText(value.join(", "));
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/70 px-2.5 py-1.5 text-sm text-ink-100 placeholder:text-ink-400/70 transition hover:border-white/20"
    />
  );
}

const EXTRA_KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export type ExtraValueType = "string" | "number" | "boolean";

export const EXTRA_PRESETS: {
  id: string;
  label: string;
  key: string;
  defaultValue: string | number | boolean;
  hint: string;
}[] = [
  { id: "split", label: "Split", key: "Split", defaultValue: true, hint: "Multi-way split behaviour" },
  { id: "expansion", label: "Expansion", key: "Expansion", defaultValue: "full_reel", hint: "Reel expansion mode" },
  { id: "hover", label: "Hover", key: "Hover", defaultValue: "highlight", hint: "Hover presentation state" },
  { id: "animation", label: "Animation", key: "Animation", defaultValue: "idle_loop", hint: "Animation clip / trigger" },
  { id: "custom", label: "Custom Extra", key: "Custom_Extra", defaultValue: "", hint: "User-defined metadata key" },
];

export function ExtrasEditor({
  value,
  onCommit,
}: {
  value: Record<string, number | string | boolean>;
  onCommit: (extras: Record<string, number | string | boolean>) => void;
}) {
  const entries = Object.entries(value);
  const [key, setKey] = useState("");
  const [newType, setNewType] = useState<ExtraValueType>("string");
  const [error, setError] = useState<string | null>(null);

  const defaultForType = (t: ExtraValueType): string | number | boolean =>
    t === "boolean" ? true : t === "number" ? 1 : "";

  const addCustom = () => {
    const k = key.trim();
    if (!EXTRA_KEY.test(k)) {
      setError("Keys start with a letter, using letters, numbers and _.");
      return;
    }
    if (k in value || entries.length >= 24) {
      setError(k in value ? "That key already exists." : "Up to 24 entries.");
      return;
    }
    onCommit({ ...value, [k]: defaultForType(newType) });
    setKey("");
    setError(null);
  };

  const addPreset = (preset: (typeof EXTRA_PRESETS)[number]) => {
    if (entries.length >= 24) {
      setError("Up to 24 entries.");
      return;
    }
    let candidate = preset.key;
    if (candidate in value) {
      if (preset.id !== "custom") {
        setError(`"${candidate}" is already added.`);
        return;
      }
      let n = 2;
      while (`${preset.key}_${n}` in value) n += 1;
      candidate = `${preset.key}_${n}`;
    }
    onCommit({ ...value, [candidate]: preset.defaultValue });
    setError(null);
  };

  return (
    <div>
      {/* Quick presets: Split, Expansion, Hover, Animation, Custom Extra */}
      <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
        <span className="text-[9.5px] font-medium tracking-wider text-ink-400 uppercase">Presets:</span>
        {EXTRA_PRESETS.map((preset) => {
          const exists = preset.id !== "custom" && preset.key in value;
          return (
            <button
              key={preset.id}
              type="button"
              disabled={exists}
              title={preset.hint}
              onClick={() => addPreset(preset)}
              className="focus-ring rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-ink-200 transition hover:border-white/25 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              + {preset.label}
            </button>
          );
        })}
      </div>

      {entries.length === 0 ? (
        <div
          data-empty-state="extras"
          className="rounded-lg border border-dashed border-white/10 bg-ink-950/40 px-3 py-3 text-center"
        >
          <p className="text-[11px] font-medium text-ink-300">No extra metadata configured</p>
          <p className="mt-0.5 text-[10px] text-ink-400">
            Add Split, Expansion, Hover, Animation, or a Custom Extra below.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {entries.map(([k, v]) => {
            const rowType: ExtraValueType =
              typeof v === "boolean" ? "boolean" : typeof v === "number" ? "number" : "string";
            return (
              <li key={k} className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate rounded border border-white/10 bg-ink-950/60 px-2 py-1 font-mono text-[10.5px] text-ink-200" title={k}>
                  {k}
                </span>
                <select
                  aria-label={`Extra ${k} type`}
                  value={rowType}
                  onChange={(e) => {
                    const nextType = e.target.value as ExtraValueType;
                    if (nextType === rowType) return;
                    const converted =
                      nextType === "boolean"
                        ? Boolean(v)
                        : nextType === "number"
                          ? (Number.isFinite(Number(v)) ? Number(v) : 1)
                          : String(v);
                    onCommit({ ...value, [k]: converted });
                  }}
                  className="focus-ring rounded border border-white/10 bg-ink-950/60 px-1.5 py-1 text-[10px] text-ink-300"
                >
                  <option value="string">Text</option>
                  <option value="number">Number</option>
                  <option value="boolean">Switch</option>
                </select>
                {typeof v === "boolean" ? (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={v}
                    aria-label={`Extra ${k}`}
                    onClick={() => onCommit({ ...value, [k]: !v })}
                    className={`focus-ring relative h-5 w-9 shrink-0 rounded-full border transition ${v ? "border-accent-500/60 bg-accent-600" : "border-white/15 bg-ink-750"}`}
                  >
                    <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white transition-all ${v ? "left-[18px]" : "left-0.5"}`} />
                  </button>
                ) : typeof v === "number" ? (
                  <input
                    aria-label={`Extra ${k} value`}
                    type="number"
                    value={v}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (e.target.value !== "" && Number.isFinite(n)) onCommit({ ...value, [k]: n });
                    }}
                    className="focus-ring w-24 shrink-0 rounded border border-white/10 bg-ink-950/60 px-2 py-1 font-mono text-[10.5px] text-ink-100"
                  />
                ) : (
                  <input
                    aria-label={`Extra ${k} value`}
                    value={v}
                    maxLength={300}
                    placeholder="Value…"
                    onChange={(e) => onCommit({ ...value, [k]: e.target.value.slice(0, 300) })}
                    className="focus-ring min-w-0 flex-1 rounded border border-white/10 bg-ink-950/60 px-2 py-1 text-[10.5px] text-ink-100"
                  />
                )}
                <button
                  type="button"
                  aria-label={`Remove extra ${k}`}
                  onClick={() => {
                    const next = { ...value };
                    delete next[k];
                    onCommit(next);
                  }}
                  className="focus-ring shrink-0 rounded p-1 text-ink-400 hover:text-rose-300"
                >
                  <Icon name="x" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          aria-label="New extra key"
          value={key}
          maxLength={40}
          placeholder="new_key"
          onChange={(e) => {
            setKey(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            addCustom();
          }}
          className="focus-ring min-w-0 flex-1 rounded border border-white/10 bg-ink-950/60 px-2 py-1 font-mono text-[10.5px] text-ink-100 placeholder:text-ink-400/60"
        />
        <select
          aria-label="New extra type"
          value={newType}
          onChange={(e) => setNewType(e.target.value as ExtraValueType)}
          className="focus-ring h-7 shrink-0 rounded border border-white/10 bg-ink-950/60 px-1.5 text-[10.5px] text-ink-200"
        >
          <option value="string">Text</option>
          <option value="number">Number</option>
          <option value="boolean">Switch</option>
        </select>
        <Button
          className="h-7 shrink-0 px-2 text-[10.5px]"
          onClick={addCustom}
        >
          <Icon name="plus" size={12} />Add
        </Button>
      </div>
      {error ? <p role="alert" className="mt-1 text-[10.5px] text-rose-300">{error}</p> : null}
    </div>
  );
}

export function AssetRefPicker({
  label,
  value,
  assets,
  allowNone = true,
  onChange,
}: {
  label: string;
  value: AssetReference | null;
  assets: { id: string; name: string; state: string }[];
  allowNone?: boolean;
  onChange: (ref: AssetReference | null) => void;
}) {
  const current = value?.provider === "project" ? (value.assetId ?? "") : value?.provider === "external" ? "__external__" : "";
  const [external, setExternal] = useState(value?.provider === "external" ? (value.uri ?? "") : "");
  return (
    <div className="space-y-1.5">
      <select
        aria-label={label}
        value={current}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) onChange(null);
          else if (v === "__external__") onChange({ provider: "external", uri: external || "" });
          else onChange({ provider: "project", assetId: v });
        }}
        className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/70 px-2.5 py-1.5 text-sm text-ink-100 transition hover:border-white/20"
      >
        {allowNone ? <option value="">None (placeholder)</option> : null}
        {assets
          .filter((a) => a.state === "linked")
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        <option value="__external__">External URL…</option>
      </select>
      {current === "__external__" ? (
        <input
          aria-label={`${label} URL`}
          value={external}
          maxLength={500}
          placeholder="https://…"
          onChange={(e) => {
            setExternal(e.target.value);
            onChange({ provider: "external", uri: e.target.value.slice(0, 500) });
          }}
          className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/70 px-2.5 py-1.5 font-mono text-[11px] text-ink-100 placeholder:text-ink-400/60"
        />
      ) : null}
    </div>
  );
}

export function VariantManager({
  variants,
  baseSymbolName,
  assets,
  onAdd,
  onRename,
  onDuplicate,
  onRemove,
  onImageChange,
}: {
  variants: SymbolVariant[];
  baseSymbolName?: string;
  assets?: { id: string; name: string; state: string }[];
  onAdd: (name?: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onImageChange?: (id: string, image: AssetReference | null) => void;
}) {
  const [newName, setNewName] = useState("");
  const submitNew = () => {
    const trimmed = newName.trim();
    if (trimmed) {
      onAdd(trimmed);
      setNewName("");
    } else {
      onAdd();
    }
  };
  return (
    <div>
      {variants.length === 0 ? (
        <div
          data-empty-state="variants"
          className="rounded-lg border border-dashed border-white/10 bg-ink-950/40 px-3 py-3 text-center"
        >
          <p className="text-[11px] font-medium text-ink-300">No variants configured</p>
          <p className="mt-0.5 text-[10px] text-ink-400">Each variant keeps its own stable id.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {variants.map((v) => (
            <li key={v.id} data-variant-id={v.id} className="rounded-md border border-white/[0.07] bg-ink-950/40 p-2">
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <CommitInput value={v.name} label={`Variant ${v.name} name`} maxLength={80} onCommit={(name) => onRename(v.id, name)} />
                </div>
                <button type="button" aria-label={`Duplicate variant ${v.name}`} title="Duplicate variant (new stable id)" onClick={() => onDuplicate(v.id)} className="focus-ring rounded p-1.5 text-ink-400 hover:text-ink-100">
                  <Icon name="copy" size={13} />
                </button>
                <button type="button" aria-label={`Remove variant ${v.name}`} title="Remove variant" onClick={() => onRemove(v.id)} className="focus-ring rounded p-1.5 text-ink-400 hover:text-rose-300">
                  <Icon name="trash" size={13} />
                </button>
              </div>
              <p className="mt-1 truncate font-mono text-[9.5px] text-ink-400" title={v.id}>
                id: {v.id}
              </p>
              {assets && onImageChange ? (
                <div className="mt-1.5 border-t border-white/[0.05] pt-1.5">
                  <AssetRefPicker
                    label={`Variant ${v.name} image`}
                    value={v.image ?? null}
                    assets={assets}
                    onChange={(ref) => onImageChange(v.id, ref)}
                  />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="text"
          aria-label="New variant name"
          value={newName}
          maxLength={80}
          placeholder={baseSymbolName ? `${baseSymbolName} — Collect` : "Variant name (optional)"}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submitNew();
            }
          }}
          className="focus-ring min-w-0 flex-1 rounded border border-white/10 bg-ink-950/60 px-2 py-1 text-[11px] text-ink-100 placeholder:text-ink-400/60"
        />
        <Button className="h-7 shrink-0 px-2.5 text-[11px]" onClick={submitNew}>
          <Icon name="plus" size={13} />Add variant
        </Button>
      </div>
      {baseSymbolName ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[9.5px] text-ink-500">Quick add:</span>
          {["Collect", "Major", "Mini"].map((suffix) => (
            <button
              key={suffix}
              type="button"
              onClick={() => onAdd(`${baseSymbolName} — ${suffix}`)}
              className="focus-ring rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-ink-300 transition hover:border-white/25 hover:text-ink-100"
            >
              + {suffix}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
