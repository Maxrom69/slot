"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  key: string;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onSelect: () => void;
}

interface MenuProps {
  items: MenuItem[];
  label?: string;
  trigger?: ReactNode;
  align?: "left" | "right";
  buttonClassName?: string;
}

function computeMenuCoords(
  btnRect: DOMRect,
  menuWidth: number,
  menuHeight: number,
  align: "left" | "right",
): { top: number; left: number } {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const margin = 8;
  const gap = 4;

  const spaceBelow = vh - btnRect.bottom - margin;
  const spaceAbove = btnRect.top - margin;

  let top: number;
  if (spaceBelow >= menuHeight || spaceBelow >= spaceAbove) {
    top = Math.min(btnRect.bottom + gap, Math.max(margin, vh - menuHeight - margin));
  } else {
    top = Math.max(margin, btnRect.top - menuHeight - gap);
  }

  const rawLeft = align === "right" ? btnRect.right - menuWidth : btnRect.left;
  const left = Math.max(margin, Math.min(rawLeft, vw - menuWidth - margin));

  return { top, left };
}

export function Menu({
  items,
  label = "More actions",
  trigger,
  align = "right",
  buttonClassName,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [initialCoords, setInitialCoords] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const syncMenuPosition = useCallback(() => {
    const btn = buttonRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const btnRect = btn.getBoundingClientRect();
    const menuWidth = menu.offsetWidth || 196;
    const menuHeight = menu.offsetHeight || items.length * 32 + 12;
    const { top, left } = computeMenuCoords(btnRect, menuWidth, menuHeight, align);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  }, [align, items.length]);

  useLayoutEffect(() => {
    if (!open) return;
    syncMenuPosition();
  }, [open, syncMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onScrollOrResize = () => {
      syncMenuPosition();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, syncMenuPosition]);

  const menuNode =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{
              position: "fixed",
              top: `${initialCoords.top}px`,
              left: `${initialCoords.left}px`,
              zIndex: 9999,
            }}
            onClick={(event) => event.stopPropagation()}
            className="animate-fade-in max-h-[calc(100vh-16px)] min-w-[190px] overflow-x-hidden overflow-y-auto rounded-lg border border-white/10 bg-ink-850 py-1 shadow-xl shadow-black/60"
          >
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.disabled ? item.disabledReason : undefined}
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect();
                }}
                className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-xs transition ${
                  item.disabled
                    ? "cursor-not-allowed text-ink-400/60"
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
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} data-menu-open={open ? "true" : undefined} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          if (!open && buttonRef.current) {
            const btnRect = buttonRef.current.getBoundingClientRect();
            const estHeight = items.length * 32 + 12;
            setInitialCoords(computeMenuCoords(btnRect, 196, estHeight, align));
          }
          setOpen((v) => !v);
        }}
        className={`focus-ring grid place-items-center rounded-md border border-white/10 bg-ink-850/90 text-ink-300 transition hover:border-white/20 hover:text-ink-100 ${buttonClassName ?? "h-7 w-7"}`}
      >
        {trigger ?? <span className="text-[13px] leading-none">⋯</span>}
      </button>
      {menuNode}
    </div>
  );
}
