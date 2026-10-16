"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { Button, Field, SegmentedControl, Select, TextArea, TextInput } from "./Controls";
import { Icon, type IconName } from "./Icon";
import { Menu, type MenuItem } from "./Menu";
import { Modal } from "./Modal";
import { Toasts } from "./Toasts";

export { Button, Field, SegmentedControl, Select, TextArea, TextInput, Icon, Menu, Modal, Toasts };

/* ------------------------------------------------------------------ */
/* Input (alias / enhanced TextInput)                                  */
/* ------------------------------------------------------------------ */

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput {...props} />;
}

/* ------------------------------------------------------------------ */
/* IconButton                                                          */
/* ------------------------------------------------------------------ */

export function IconButton({
  icon,
  label,
  active = false,
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  active?: boolean;
  size?: "sm" | "md";
}) {
  const dims = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  return (
    <button
      type="button"
      aria-label={label}
      title={props.title ?? label}
      aria-pressed={active}
      {...props}
      className={`focus-ring inline-grid ${dims} place-items-center rounded-md border text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-accent-500/50 bg-accent-600/15 text-ink-100"
          : "border-white/10 bg-ink-850 text-ink-300 hover:border-white/20 hover:text-ink-100"
      } ${className}`}
    >
      <Icon name={icon} size={size === "sm" ? 13 : 15} />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* ToolbarButton                                                       */
/* ------------------------------------------------------------------ */

export function ToolbarButton({
  icon,
  label,
  shortcut,
  active = false,
  unavailableReason,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: IconName;
  label: string;
  shortcut?: string;
  active?: boolean;
  unavailableReason?: string;
}) {
  const isDisabled = Boolean(props.disabled || unavailableReason);
  const titleText = unavailableReason
    ? `${label} — ${unavailableReason}`
    : shortcut
      ? `${label} (${shortcut})`
      : label;

  return (
    <button
      type="button"
      disabled={isDisabled}
      aria-label={unavailableReason ? `${label} (unavailable)` : label}
      aria-pressed={active}
      title={titleText}
      {...props}
      className={`focus-ring inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-accent-500/60 bg-accent-500/15 text-ink-100"
          : unavailableReason
            ? "border-dashed border-white/10 text-ink-400"
            : "border-transparent text-ink-300 hover:bg-white/5 hover:text-ink-100"
      } ${className}`}
    >
      <Icon name={icon} size={14} />
      <span className="truncate">{label}</span>
      {shortcut ? (
        <kbd className="rounded border border-white/10 bg-ink-950/70 px-1 py-px font-mono text-[9.5px] text-ink-400">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Panel & PanelHeader                                                 */
/* ------------------------------------------------------------------ */

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "",
  ...props
}: HTMLAttributes<HTMLElement> & {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  bodyClassName?: string;
}) {
  return (
    <section
      {...props}
      className={`rounded-lg border border-white/[0.07] bg-ink-900 ${className}`}
    >
      {title ? (
        <PanelHeader title={title} subtitle={subtitle} actions={actions} />
      ) : null}
      <div className={title ? `p-4 ${bodyClassName}` : `p-4 ${bodyClassName}`}>
        {children}
      </div>
    </section>
  );
}

export function PanelHeader({
  title,
  subtitle,
  actions,
  className = "",
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={`flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-2.5 ${className}`}
    >
      <div className="min-w-0">
        <h2 className="truncate text-[10.5px] font-semibold tracking-[0.15em] text-ink-300 uppercase">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-0.5 truncate text-[11px] text-ink-400">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Tabs                                                                */
/* ------------------------------------------------------------------ */

export interface TabOption<T extends string = string> {
  id: T;
  label: string;
  badge?: string | number;
  disabled?: boolean;
  disabledReason?: string;
}

export function Tabs<T extends string = string>({
  tabs,
  activeTab,
  onChange,
  ariaLabel = "Tabs",
  className = "",
}: {
  tabs: TabOption<T>[];
  activeTab: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex items-center gap-1 border-b border-white/[0.07] ${className}`}
    >
      {tabs.map((tab) => {
        const isCurrent = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isCurrent}
            disabled={tab.disabled}
            title={tab.disabled ? tab.disabledReason : undefined}
            onClick={() => {
              if (!tab.disabled) onChange(tab.id);
            }}
            className={`focus-ring -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${
              isCurrent
                ? "border-accent-500 text-ink-100"
                : "border-transparent text-ink-400 hover:text-ink-200"
            }`}
          >
            <span>{tab.label}</span>
            {tab.badge !== undefined ? (
              <span className="rounded border border-white/10 bg-ink-850 px-1.5 py-px font-mono text-[9.5px] text-ink-300">
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* NumberInput                                                         */
/* ------------------------------------------------------------------ */

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  disabled,
  ariaLabel,
  className = "",
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const clamp = (n: number) => {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return Number(v.toFixed(4));
  };

  return (
    <div
      className={`inline-flex items-center rounded-md border border-white/10 bg-ink-950/70 ${className}`}
    >
      <button
        type="button"
        disabled={disabled || (min !== undefined && value <= min)}
        aria-label={ariaLabel ? `Decrease ${ariaLabel}` : "Decrease"}
        onClick={() => onChange(clamp(value - step))}
        className="focus-ring px-2 py-1 text-xs text-ink-400 transition hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <input
        type="number"
        aria-label={ariaLabel}
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (Number.isFinite(parsed)) onChange(clamp(parsed));
        }}
        className="w-16 bg-transparent px-1 py-1 text-center font-mono text-xs text-ink-100 focus:outline-none"
      />
      {unit ? <span className="pr-1.5 font-mono text-[10px] text-ink-400">{unit}</span> : null}
      <button
        type="button"
        disabled={disabled || (max !== undefined && value >= max)}
        aria-label={ariaLabel ? `Increase ${ariaLabel}` : "Increase"}
        onClick={() => onChange(clamp(value + step))}
        className="focus-ring px-2 py-1 text-xs text-ink-400 transition hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle                                                              */
/* ------------------------------------------------------------------ */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2.5 select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`focus-ring relative h-5 w-9 shrink-0 rounded-full border transition disabled:cursor-not-allowed disabled:opacity-45 ${
          checked
            ? "border-accent-400/60 bg-accent-600"
            : "border-white/15 bg-ink-850"
        }`}
      >
        <span
          className={`block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      {label || hint ? (
        <span className="min-w-0">
          {label ? <span className="block text-xs font-medium text-ink-200">{label}</span> : null}
          {hint ? <span className="block text-[10.5px] text-ink-400">{hint}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Slider                                                              */
/* ------------------------------------------------------------------ */

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
  label,
  disabled = false,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-lg bg-ink-800 accent-blue-500 disabled:cursor-not-allowed disabled:opacity-45"
      />
      <span className="w-12 text-right font-mono text-[11px] text-ink-300">
        {value}
        {unit}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dropdown                                                            */
/* ------------------------------------------------------------------ */

export function Dropdown({
  label,
  items,
  align = "left",
}: {
  label: ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
}) {
  return (
    <Menu
      items={items}
      align={align}
      label={typeof label === "string" ? label : "Dropdown menu"}
      trigger={<span className="px-2 text-xs">{label}</span>}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

export function Drawer({
  open,
  side = "right",
  title,
  onClose,
  children,
  widthClass = "w-80",
}: {
  open: boolean;
  side?: "left" | "right";
  title: string;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-xs"
      />
      <aside
        role="dialog"
        aria-label={title}
        className={`relative z-10 flex h-full ${widthClass} flex-col border-white/10 bg-ink-900 shadow-2xl ${
          side === "right" ? "ml-auto border-l" : "mr-auto border-r"
        }`}
      >
        <header className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
          <h2 className="text-xs font-semibold tracking-wider text-ink-200 uppercase">
            {title}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="focus-ring rounded p-1 text-ink-400 hover:text-ink-100"
          >
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

export function Tooltip({
  content,
  children,
}: {
  content: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <span className="group relative inline-flex" aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded border border-white/10 bg-ink-950 px-2 py-1 text-[10.5px] whitespace-nowrap text-ink-200 opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* ContextMenu                                                         */
/* ------------------------------------------------------------------ */

export function ContextMenu({
  items,
  children,
  className = "",
}: {
  items: MenuItem[];
  children: ReactNode;
  className?: string;
}) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!coords) return;
    const close = () => setCoords(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [coords]);

  return (
    <div
      ref={rootRef}
      onContextMenu={(e) => {
        e.preventDefault();
        setCoords({ x: e.clientX, y: e.clientY });
      }}
      className={`relative ${className}`}
    >
      {children}
      {coords ? (
        <div
          role="menu"
          style={{ left: coords.x, top: coords.y }}
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-50 min-w-[180px] rounded-lg border border-white/10 bg-ink-850 py-1 shadow-xl shadow-black/70"
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.disabled ? item.disabledReason : undefined}
              onClick={() => {
                if (item.disabled) return;
                setCoords(null);
                item.onSelect();
              }}
              className={`flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-xs transition ${
                item.disabled
                  ? "cursor-not-allowed text-ink-400/50"
                  : item.danger
                    ? "text-rose-300 hover:bg-rose-500/10"
                    : "text-ink-200 hover:bg-white/5 hover:text-ink-100"
              }`}
            >
              <span>{item.label}</span>
              {item.hint ? (
                <span className="font-mono text-[10px] text-ink-400">{item.hint}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EmptyState                                                          */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon = "layers",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/10 bg-ink-900/50 px-6 py-10 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 bg-ink-850 text-ink-300">
        <Icon name={icon} size={18} />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-ink-100">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-ink-400">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

export type BadgeTone = "default" | "accent" | "success" | "warning" | "danger" | "muted";

export function Badge({
  tone = "default",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    default: "border-white/10 bg-ink-850 text-ink-200",
    accent: "border-accent-500/40 bg-accent-600/15 text-blue-200",
    success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    warning: "border-amber-500/30 bg-amber-500/10 text-amber-200",
    danger: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    muted: "border-white/[0.07] bg-ink-900 text-ink-400",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* TreeRow                                                             */
/* ------------------------------------------------------------------ */

export function TreeRow({
  label,
  depth = 0,
  icon = "layers",
  selected = false,
  expanded,
  visible,
  locked,
  badge,
  onSelect,
  onToggleExpand,
  onToggleVisible,
  onToggleLocked,
}: {
  label: string;
  depth?: number;
  icon?: IconName;
  selected?: boolean;
  expanded?: boolean;
  visible?: boolean;
  locked?: boolean;
  badge?: ReactNode;
  onSelect?: () => void;
  onToggleExpand?: () => void;
  onToggleVisible?: () => void;
  onToggleLocked?: () => void;
}) {
  return (
    <div
      style={{ paddingLeft: `${8 + depth * 14}px` }}
      className={`group flex items-center justify-between gap-1.5 rounded-md py-1 pr-2 text-xs transition ${
        selected
          ? "bg-accent-600/15 text-ink-100"
          : "text-ink-300 hover:bg-white/5 hover:text-ink-100"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {onToggleExpand !== undefined ? (
          <button
            type="button"
            aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            className="focus-ring rounded p-0.5 text-ink-400 hover:text-ink-100"
          >
            <Icon name={expanded ? "chevron-down" : "chevron-right"} size={12} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={onSelect}
          className="focus-ring flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <Icon name={icon} size={13} className="shrink-0 text-ink-400" />
          <span className="truncate">{label}</span>
        </button>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {badge}
        {onToggleVisible !== undefined ? (
          <button
            type="button"
            aria-label={visible ? `Hide ${label}` : `Show ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleVisible();
            }}
            className="focus-ring rounded p-1 text-ink-400 hover:text-ink-100"
          >
            <Icon name={visible !== false ? "eye" : "eye-off"} size={12} />
          </button>
        ) : null}
        {onToggleLocked !== undefined ? (
          <button
            type="button"
            aria-label={locked ? `Unlock ${label}` : `Lock ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleLocked();
            }}
            className="focus-ring rounded p-1 text-ink-400 hover:text-ink-100"
          >
            <Icon name={locked ? "lock" : "unlock"} size={12} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Thumbnail                                                           */
/* ------------------------------------------------------------------ */

export function Thumbnail({
  src,
  alt,
  glyph = "◆",
  size = "md",
  checkerboard = false,
  className = "",
}: {
  src?: string | null;
  alt: string;
  glyph?: string;
  size?: "sm" | "md" | "lg";
  checkerboard?: boolean;
  className?: string;
}) {
  const dims =
    size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-20 w-20 text-xl" : "h-12 w-12 text-sm";
  return (
    <div
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-md border border-white/10 bg-ink-950 ${dims} ${
        checkerboard ? "studio-grid-bg" : ""
      } ${className}`}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-contain" />
      ) : (
        <span className="font-semibold text-ink-300" aria-hidden="true">
          {glyph}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PropertyRow, Section, Divider                                       */
/* ------------------------------------------------------------------ */

export function PropertyRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-2 py-1.5">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-ink-300">{label}</div>
        {hint ? <div className="truncate text-[10px] text-ink-400">{hint}</div> : null}
      </div>
      <div className="flex items-center justify-end">{children}</div>
    </div>
  );
}

export function Section({
  title,
  defaultOpen = true,
  actions,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/[0.07] py-3 last:border-b-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="focus-ring flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.15em] text-ink-400 uppercase hover:text-ink-200"
        >
          <Icon name={open ? "chevron-down" : "chevron-right"} size={12} />
          <span>{title}</span>
        </button>
        {actions ? <div className="flex items-center gap-1">{actions}</div> : null}
      </div>
      {open ? <div className="space-y-2">{children}</div> : null}
    </div>
  );
}

export function Divider({ vertical = false }: { vertical?: boolean }) {
  return vertical ? (
    <span aria-hidden="true" className="mx-1 h-4 w-px bg-white/[0.08]" />
  ) : (
    <hr className="my-2 border-white/[0.07]" />
  );
}
