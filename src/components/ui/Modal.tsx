"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}

export function Modal({ open, title, description, onClose, children, footer, width = "sm" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]') ?? []).filter((el) => el.getClientRects().length > 0);
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      else if (event.key === "Tab") {
        const targets = focusables(), first = targets[0], last = targets[targets.length - 1];
        if (!first) { event.preventDefault(); panelRef.current?.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", handler, true);
    const initial = panelRef.current?.querySelector<HTMLElement>("input, select, textarea") ?? focusables()[0] ?? panelRef.current;
    initial?.focus();
    return () => { document.removeEventListener("keydown", handler, true); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;
  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-6">
    <button type="button" tabIndex={-1} aria-label="Close dialog" className="absolute inset-0 cursor-default" onClick={onClose} />
    <div ref={panelRef} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}
      className={`animate-fade-in relative mt-8 w-full ${widths[width]} rounded-xl border border-white/10 bg-ink-900 shadow-2xl shadow-black/60 sm:mt-16`}>
      <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-3.5"><div><h2 id={titleId} className="text-[13px] font-semibold tracking-wide text-ink-100">{title}</h2>{description ? <p id={descriptionId} className="mt-1 text-xs leading-relaxed text-ink-400">{description}</p> : null}</div>
        <button type="button" onClick={onClose} className="focus-ring rounded-md p-1 text-ink-400 transition hover:bg-white/5 hover:text-ink-100" aria-label="Close"><Icon name="x" size={15} /></button>
      </header>
      <div className="px-5 py-4">{children}</div>
      {footer ? <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/[0.07] px-5 py-3">{footer}</footer> : null}
    </div>
  </div>;
}
