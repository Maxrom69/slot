"use client";

import { Icon, type IconName } from "@/components/ui/Icon";
import { Menu } from "@/components/ui/Menu";
import type { ElementDef } from "@/lib/blueprint/types";
import { elementImage, membersOf, symbolImage } from "@/lib/design/selectors";
import type { DesignDoc } from "@/lib/design/types";
import type { DesignActions } from "./actions";

const RESERVED = "Reserved — AI features are not part of this version.";
const BUTTON_BASE =
  "focus-ring grid place-items-center rounded-md text-ink-200 transition hover:bg-white/10 hover:text-ink-100 disabled:cursor-not-allowed disabled:text-ink-400/50 disabled:hover:bg-transparent";

/** Hover/focus toolbar. Everything here works or is disabled with a reason. */
export function QuickActions({ element, doc, actions, show = false, compact = false }: {
  element: ElementDef; doc: DesignDoc; actions: DesignActions; show?: boolean; compact?: boolean;
}) {
  const isSet = element.type === "symbol_set";
  const hasImage = isSet ? membersOf(doc, element).some((s) => symbolImage(doc, s)) : Boolean(elementImage(doc, element));
  const canReplace = !isSet && (element.type !== "symbol" || element.symbolIds.length > 0);
  const target = { kind: "element" as const, id: element.id };
  const btnSize = compact ? "h-6 w-6" : "h-7 w-7";

  const items: { key: string; icon: IconName; label: string; onClick: () => void; disabled?: boolean; reason?: string }[] = [
    { key: "edit", icon: "pencil", label: "Edit (F2)", onClick: () => actions.edit(element.id) },
    { key: "replace", icon: "replace", label: "Replace image", onClick: () => actions.replaceImage(target), disabled: !canReplace, reason: "Open the set to replace individual symbol images" },
    { key: "duplicate", icon: "copy", label: "Duplicate (Ctrl/⌘ D)", onClick: () => actions.duplicate(element.id) },
    { key: "delete", icon: "trash", label: "Delete (Del)", onClick: () => actions.requestDelete(target) },
    { key: "download", icon: "download", label: isSet ? "Download symbol images (.zip)" : "Download image", onClick: () => actions.download(target), disabled: !hasImage, reason: isSet ? "No symbol images to download yet" : "No image linked yet" },
    { key: "open", icon: "maximize", label: "Open detail (Enter)", onClick: () => actions.open(element.id) },
  ];

  return (
    <div role="toolbar" aria-label={`Actions for ${element.name}`}
      className={`flex flex-wrap items-center justify-end gap-0.5 rounded-lg border border-white/10 bg-ink-900/95 p-0.5 shadow-lg shadow-black/40 backdrop-blur transition ${show ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 has-[[data-menu-open=true]]:opacity-100"}`}>
      {items.map((item) => (
        <button key={item.key} type="button" className={`${BUTTON_BASE} ${btnSize}`} aria-label={item.label.replace(/ \(.*\)$/, "")} disabled={item.disabled}
          title={item.disabled ? item.reason : item.label} onClick={item.onClick}>
          <Icon name={item.icon} size={compact ? 13 : 14} />
        </button>
      ))}
      <Menu buttonClassName={btnSize} label={`More actions for ${element.name}`} items={[
        { key: "ai-regenerate", label: "Regenerate with AI", hint: "reserved", disabled: true, disabledReason: RESERVED, onSelect: () => undefined },
        { key: "ai-variations", label: "Generate variations", hint: "reserved", disabled: true, disabledReason: RESERVED, onSelect: () => undefined },
      ]} />
    </div>
  );
}
