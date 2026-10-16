"use client";

import { useMemo } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { slugify } from "@/lib/blueprint/factory";
import type { GameBlueprint } from "@/lib/blueprint/types";

export function BlueprintDialog({ blueprint, open, onClose }: { blueprint: GameBlueprint; open: boolean; onClose: () => void }) {
  const display = useMemo(() => JSON.stringify(blueprint, (key, value) =>
    key === "uri" && typeof value === "string" && value.startsWith("data:") ? "[embedded artwork — included in the download]" : value, 2), [blueprint]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(blueprint, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${slugify(blueprint.meta.title || "new-game")}.draft.blueprint.json`;
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <Modal open={open} title="Game Blueprint draft" description="The current structured configuration. Embedded artwork is hidden here, but kept in the download." width="lg" onClose={onClose}
    footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={download}><Icon name="download" size={14} />Download draft</Button></>}>
    <pre tabIndex={0} className="focus-ring max-h-[55vh] overflow-auto rounded-lg border border-white/10 bg-ink-950 p-4 font-mono text-[11px] leading-relaxed text-ink-300">{display}</pre>
  </Modal>;
}
