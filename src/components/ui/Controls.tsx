"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";

type ButtonVariant = "primary" | "ghost" | "outline" | "danger";

export function Button({
  variant = "outline",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-accent-600 text-white hover:bg-accent-500 border border-accent-500/60 shadow-lg shadow-accent-600/20",
    outline:
      "border border-white/10 bg-ink-850 text-ink-200 hover:border-white/20 hover:text-ink-100",
    ghost: "border border-transparent text-ink-300 hover:bg-white/5 hover:text-ink-100",
    danger:
      "border border-rose-500/40 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20",
  };
  return (
    <button
      type="button"
      {...props}
      className={`focus-ring inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    />
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-[11px] font-medium tracking-wide text-ink-300 uppercase">
        {label}
        {required ? <span className="text-accent-400">*</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[11px] text-ink-400">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  "focus-ring w-full rounded-md border border-white/10 bg-ink-950/70 px-2.5 py-1.5 text-sm text-ink-100 placeholder:text-ink-400/70 transition hover:border-white/20 focus:border-accent-500";

export function TextInput(
  props: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> },
) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`${inputClass} ${className}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = "", ...rest } = props;
  return <textarea {...rest} className={`${inputClass} resize-y ${className}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = "", ...rest } = props;
  return (
    <select {...rest} className={`${inputClass} appearance-none ${className}`} />
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-white/10 bg-ink-850 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title ?? option.label}
          onClick={() => onChange(option.value)}
          className={`focus-ring rounded-[5px] px-2.5 py-1 text-[11px] font-medium transition ${
            value === option.value
              ? "bg-white/10 text-ink-100"
              : "text-ink-400 hover:text-ink-200"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
