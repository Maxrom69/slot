"use client";

import { useEffect } from "react";

export type StudioShortcutId =
  | "select"
  | "brush"
  | "eraser"
  | "blur"
  | "eyedropper"
  | "delete"
  | "undo"
  | "redo"
  | "save"
  | "fullscreen";

export interface StudioShortcutDescriptor {
  id: StudioShortcutId;
  label: string;
  key: string;
  display: string;
  ctrlOrMeta?: boolean;
  shift?: boolean;
  allowInInputs?: boolean;
  available: boolean;
  unavailableReason?: string;
  description: string;
}

export const DEFAULT_STUDIO_SHORTCUTS: readonly StudioShortcutDescriptor[] = [
  {
    id: "select",
    label: "Select / Move",
    key: "v",
    display: "V",
    available: true,
    description: "Activate the Select / Move tool",
  },
  {
    id: "brush",
    label: "Brush",
    key: "b",
    display: "B",
    available: false,
    unavailableReason: "Raster pixel brush arrives in a later studio phase",
    description: "Select the Brush tool (reserved)",
  },
  {
    id: "eraser",
    label: "Eraser",
    key: "e",
    display: "E",
    available: false,
    unavailableReason: "Raster pixel eraser arrives in a later studio phase",
    description: "Select the Eraser tool (reserved)",
  },
  {
    id: "blur",
    label: "Blur",
    key: "u",
    display: "U",
    available: false,
    unavailableReason: "Raster blur tool arrives in a later studio phase",
    description: "Select the Blur tool (reserved)",
  },
  {
    id: "eyedropper",
    label: "Eyedropper",
    key: "i",
    display: "I",
    available: false,
    unavailableReason: "Pixel eyedropper arrives in a later studio phase",
    description: "Select the Eyedropper tool (reserved)",
  },
  {
    id: "delete",
    label: "Delete",
    key: "Delete",
    display: "Delete",
    available: true,
    description: "Delete the selected element(s)",
  },
  {
    id: "undo",
    label: "Undo",
    key: "z",
    display: "Ctrl/⌘ + Z",
    ctrlOrMeta: true,
    shift: false,
    available: true,
    description: "Undo the last editor command",
  },
  {
    id: "redo",
    label: "Redo",
    key: "z",
    display: "Ctrl/⌘ + Shift + Z",
    ctrlOrMeta: true,
    shift: true,
    available: true,
    description: "Redo the previously undone command",
  },
  {
    id: "save",
    label: "Save",
    key: "s",
    display: "Ctrl/⌘ + S",
    ctrlOrMeta: true,
    shift: false,
    allowInInputs: true,
    available: true,
    description: "Save the active project blueprint",
  },
  {
    id: "fullscreen",
    label: "Fullscreen",
    key: "f",
    display: "F",
    available: true,
    description: "Toggle fullscreen workspace mode",
  },
];

export interface ShortcutKeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  target?: unknown;
  preventDefault?: () => void;
}

function isEditableElement(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as { tagName?: string; isContentEditable?: boolean };
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function matchStudioShortcut(
  event: ShortcutKeyEventLike,
  shortcuts: readonly StudioShortcutDescriptor[] = DEFAULT_STUDIO_SHORTCUTS,
): StudioShortcutDescriptor | null {
  if (event.altKey) return null;
  const mod = Boolean(event.ctrlKey || event.metaKey);
  const shift = Boolean(event.shiftKey);
  const rawKey = event.key;
  const lowerKey = rawKey.toLowerCase();
  const inInput = isEditableElement(event.target);

  // Support Ctrl+Y as an alias for Redo
  if (mod && !shift && lowerKey === "y") {
    const redoDesc = shortcuts.find((s) => s.id === "redo") ?? null;
    if (redoDesc && (!inInput || redoDesc.allowInInputs)) return redoDesc;
  }

  for (const desc of shortcuts) {
    if (inInput && !desc.allowInInputs) continue;

    const wantMod = Boolean(desc.ctrlOrMeta);
    if (wantMod !== mod) continue;

    if (desc.shift !== undefined && desc.shift !== shift) continue;
    if (desc.shift === undefined && !wantMod && shift) continue;

    if (desc.id === "delete") {
      if (rawKey === "Delete" || rawKey === "Backspace") return desc;
      continue;
    }

    if (lowerKey === desc.key.toLowerCase()) {
      return desc;
    }
  }

  return null;
}

export type ShortcutHandlers = Partial<
  Record<StudioShortcutId, (descriptor: StudioShortcutDescriptor, event: ShortcutKeyEventLike) => void>
>;

export class KeyboardShortcutManager {
  private shortcuts: Map<StudioShortcutId, StudioShortcutDescriptor>;
  private handlers: ShortcutHandlers = {};

  constructor(initial: readonly StudioShortcutDescriptor[] = DEFAULT_STUDIO_SHORTCUTS) {
    this.shortcuts = new Map(initial.map((s) => [s.id, { ...s }]));
  }

  listShortcuts(): StudioShortcutDescriptor[] {
    return Array.from(this.shortcuts.values());
  }

  getShortcut(id: StudioShortcutId): StudioShortcutDescriptor | undefined {
    return this.shortcuts.get(id);
  }

  registerHandler(
    id: StudioShortcutId,
    handler: NonNullable<ShortcutHandlers[StudioShortcutId]>,
  ): () => void {
    this.handlers[id] = handler;
    return () => {
      if (this.handlers[id] === handler) {
        delete this.handlers[id];
      }
    };
  }

  setHandlers(handlers: ShortcutHandlers): void {
    this.handlers = { ...handlers };
  }

  handleKeyDown(event: ShortcutKeyEventLike): StudioShortcutDescriptor | null {
    const matched = matchStudioShortcut(event, this.listShortcuts());
    if (!matched) return null;
    const handler = this.handlers[matched.id];
    if (handler) {
      event.preventDefault?.();
      handler(matched, event);
    }
    return matched;
  }
}

export function useStudioShortcuts(
  handlers: ShortcutHandlers,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const manager = new KeyboardShortcutManager();
    manager.setHandlers(handlers);
    const onKeyDown = (event: KeyboardEvent) => {
      manager.handleKeyDown(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers, enabled]);
}
