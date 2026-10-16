"use client";

import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";

export function SectionCard({ title, aside, children, icon, number, description }: {
  title: string; aside?: ReactNode; children: ReactNode; icon?: IconName; number?: string; description?: string;
}) {
  return <section className="creation-panel overflow-hidden rounded-xl border border-white/[0.08]">
    <header className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? <span className="text-ink-300"><Icon name={icon} size={16} /></span> : null}
        <div><h2 className="text-[12.5px] font-semibold tracking-[-0.01em] text-ink-100">{title}</h2>
          {description ? <p className="mt-0.5 text-[10.5px] text-ink-300/75">{description}</p> : null}</div>
      </div>
      {aside ?? (number ? <span className="font-mono text-[10px] text-ink-400">{number}</span> : null)}
    </header>
    <div className="space-y-4 p-4">{children}</div>
  </section>;
}

export function Row({ label, hint, children, icon, tone = "text-ink-300" }: {
  label: string; hint?: string; children: ReactNode; icon?: IconName | "royals"; tone?: string;
}) {
  return <div className="flex items-center justify-between gap-3">
    <div className="flex min-w-0 items-center gap-2.5">
      {icon ? <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.07] bg-white/[0.025] ${tone}`}>
        {icon === "royals" ? <span className="font-serif text-[16px] font-bold">A</span> : <Icon name={icon} size={16} />}
      </span> : null}
      <div><div className="text-[12px] font-medium text-ink-200">{label}</div>
        {hint ? <div className="mt-0.5 text-[10px] text-ink-300/65">{hint}</div> : null}</div>
    </div>
    <div className="flex shrink-0 items-center gap-1.5">{children}</div>
  </div>;
}

export function Stepper({ value, min, max, onChange, label, disabled }: {
  value: number; min: number; max: number; onChange: (value: number) => void; label: string; disabled?: boolean;
}) {
  const btn = "focus-ring grid h-7 w-7 place-items-center text-ink-300 transition hover:bg-white/5 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-30";
  return <div className="flex items-center overflow-hidden rounded-md border border-white/10 bg-ink-950/50" role="group" aria-label={label}>
    <button type="button" className={btn} aria-label={`Decrease ${label}`} disabled={disabled || value <= min} onClick={() => onChange(value - 1)}><Icon name="minus" size={12} /></button>
    <input type="number" aria-label={`${label} count`} min={min} max={max} disabled={disabled} value={value}
      onChange={(event) => { const next = Number(event.target.value); if (event.target.value && Number.isInteger(next) && next >= min && next <= max) onChange(next); }}
      className="count-input focus-ring h-7 w-7 border-x border-white/[0.06] bg-transparent text-center font-mono text-[12px] text-ink-100" />
    <button type="button" className={btn} aria-label={`Increase ${label}`} disabled={disabled || value >= max} onClick={() => onChange(value + 1)}><Icon name="plus" size={12} /></button>
  </div>;
}

export function Chip({ active, onClick, children, title, disabled }: {
  active: boolean; onClick: () => void; children: ReactNode; title?: string; disabled?: boolean;
}) {
  return <button type="button" aria-pressed={active} title={title} disabled={disabled} onClick={onClick}
    className={`focus-ring inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[10.5px] font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-accent-500/40 bg-accent-500/[0.12] text-blue-200" : "border-white/10 bg-white/[0.015] text-ink-300 hover:border-white/25 hover:text-ink-100"}`}>
    {children}
  </button>;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
    className={`focus-ring relative h-[18px] w-8 shrink-0 rounded-full border transition ${checked ? "border-accent-500/60 bg-accent-500" : "border-white/15 bg-ink-700"}`}>
    <span className={`absolute top-[2px] h-3 w-3 rounded-full bg-white transition-all ${checked ? "left-[16px]" : "left-[2px]"}`} />
  </button>;
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p role="alert" className="mt-1.5 text-[11px] text-rose-300">{message}</p> : null;
}

/** Allows intermediate typing, but only commits supported numbers into structured state. */
export function NumberField({ value, onChange, min, max, step = 1, disabled, label }: {
  value: number; onChange: (value: number) => void; min: number; max: number; step?: number; disabled?: boolean; label: string;
}) {
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setText(String(value));
  }
  const commit = () => {
    const n = Number(text);
    if (text && Number.isFinite(n) && n >= min && n <= max && (step !== 1 || Number.isInteger(n))) onChange(n);
    else setText(String(value));
  };
  return <input type="number" value={text} min={min} max={max} step={step} disabled={disabled} aria-label={label}
    onChange={(event) => { setText(event.target.value); const n = Number(event.target.value); if (event.target.value && n >= min && n <= max && (step !== 1 || Number.isInteger(n))) onChange(n); }}
    onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); } }}
    className="focus-ring w-full rounded-md border border-white/10 bg-ink-950/50 px-2.5 py-2 text-[12px] text-ink-100 disabled:opacity-40" />;
}
