import type { ReactNode } from "react";
import { elementTypeMeta } from "@/lib/blueprint/elements";
import type { ElementDef, SymbolSetType, ValueTier } from "@/lib/blueprint/types";
import { SET_TYPE_LABELS, VALUE_TIER_LABELS } from "@/lib/design/model";
import type { StatusInfo, StatusKey } from "@/lib/design/selectors";

const STATUS_TONES: Record<StatusKey, string> = {
  empty: "border-white/10 text-ink-400",
  planned: "border-white/10 bg-white/[0.03] text-ink-300",
  partial: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  ready: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
};
const DOTS: Record<StatusKey, string> = { empty: "bg-ink-400", planned: "bg-ink-300", partial: "bg-amber-300", ready: "bg-emerald-400" };

export function StatusBadge({ status }: { status: StatusInfo }) {
  return (
    <span title={status.detail} className={`inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[9.5px] font-medium ${STATUS_TONES[status.key]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOTS[status.key]}`} />
      {status.label}
    </span>
  );
}

export function Pill({ children, tone = "border-white/10 text-ink-300" }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9.5px] font-medium ${tone}`}>{children}</span>;
}

export function TypeBadge({ element }: { element: ElementDef }) {
  const meta = elementTypeMeta(element.type);
  return <Pill tone={meta.tone}>{element.group && element.type !== "symbol_set" ? element.group : meta.label}</Pill>;
}

export function SetTypeBadge({ type }: { type: SymbolSetType }) {
  return <Pill tone="border-fuchsia-400/25 bg-fuchsia-400/[0.08] text-fuchsia-200">{SET_TYPE_LABELS[type]}</Pill>;
}

const TIER_TONES: Record<ValueTier, string> = {
  low: "border-sky-400/25 bg-sky-400/[0.08] text-sky-200",
  medium: "border-violet-400/25 bg-violet-400/[0.08] text-violet-200",
  high: "border-amber-400/30 bg-amber-400/[0.09] text-amber-200",
  special: "border-emerald-400/30 bg-emerald-400/[0.09] text-emerald-200",
};
export function TierBadge({ tier }: { tier: ValueTier }) {
  return <Pill tone={TIER_TONES[tier]}>{VALUE_TIER_LABELS[tier]} value</Pill>;
}
