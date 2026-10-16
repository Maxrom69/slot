"use client";

import { useState } from "react";
import { Button, Field, Select } from "@/components/ui/Controls";
import { Icon } from "@/components/ui/Icon";
import { Modal } from "@/components/ui/Modal";
import type { GameBlueprint } from "@/lib/blueprint/types";
import type { AssignTarget, AssignTargetType } from "@/lib/assets/usage";
import type { ProjectAssetSummary } from "@/server/asset-service";

interface Props {
  asset: ProjectAssetSummary | null;
  blueprint: GameBlueprint;
  onCancel: () => void;
  onAssign: (target: AssignTarget) => Promise<void>;
}

export function AssetAssignDialog({ asset, blueprint, onCancel, onAssign }: Props) {
  const [targetType, setTargetType] = useState<AssignTargetType>("symbol");
  const [targetId, setTargetId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  if (!asset) return null;

  const symbols = blueprint.symbols ?? [];
  const variants = symbols.flatMap((s) =>
    (s.variants ?? []).map((v) => ({
      id: `${s.id}::${v.id}`,
      label: `${s.name} — ${v.name}`,
    })),
  );
  const elements = (blueprint.elements ?? []).filter((e) => e.type !== "symbol" && e.type !== "symbol_set");
  const symbolSets = (blueprint.elements ?? []).filter((e) => e.type === "symbol_set");
  const scenes = blueprint.scenes ?? [];

  const handleConfirm = async () => {
    let resolvedId = targetId;
    if (targetType === "symbol" && !resolvedId) resolvedId = symbols[0]?.id ?? "";
    if (targetType === "symbol_variant" && !resolvedId) resolvedId = variants[0]?.id ?? "";
    if (targetType === "element" && !resolvedId) resolvedId = elements[0]?.id ?? "";
    if (targetType === "symbol_set_frame" && !resolvedId) resolvedId = symbolSets[0]?.id ?? "";
    if (targetType === "symbol_set_bg" && !resolvedId) resolvedId = symbolSets[0]?.id ?? "";
    if (targetType === "scene_background" && !resolvedId) resolvedId = scenes[0]?.id ?? "";

    setSubmitting(true);
    try {
      await onAssign({ type: targetType, targetId: resolvedId });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={Boolean(asset)}
      onClose={submitting ? () => undefined : onCancel}
      title="Assign Asset to Element"
      width="md"
      description={`Choose where to assign “${asset.name}”.`}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleConfirm} disabled={submitting}>
            {submitting ? "Assigning…" : "Assign Asset"}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[12px]">
        <Field label="Assignment target">
          <Select
            aria-label="Target type"
            value={targetType}
            className="creation-input"
            onChange={(e) => {
              setTargetType(e.target.value as AssignTargetType);
              setTargetId("");
            }}
          >
            <option value="symbol">Symbol Artwork</option>
            {variants.length > 0 ? <option value="symbol_variant">Symbol Variant Artwork</option> : null}
            <option value="element">Standalone Element Artwork</option>
            <option value="symbol_set_frame">Symbol Set Frame Decoration</option>
            <option value="symbol_set_bg">Symbol Set Background Decoration</option>
            <option value="scene_background">Scene Background</option>
            <option value="canvas_background">Canvas Default Background</option>
            <option value="style_reference">Style / Art Reference</option>
          </Select>
        </Field>

        {targetType === "symbol" ? (
          <Field label="Select symbol">
            <Select
              aria-label="Target symbol"
              value={targetId || symbols[0]?.id || ""}
              className="creation-input"
              onChange={(e) => setTargetId(e.target.value)}
            >
              {symbols.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.glyph} {s.name} ({s.code}) {s.tier === "special" ? "— Special" : ""}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {targetType === "symbol_variant" ? (
          <Field label="Select symbol variant">
            <Select
              aria-label="Target symbol variant"
              value={targetId || variants[0]?.id || ""}
              className="creation-input"
              onChange={(e) => setTargetId(e.target.value)}
            >
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {targetType === "element" ? (
          <Field label="Select standalone element">
            <Select
              aria-label="Target element"
              value={targetId || elements[0]?.id || ""}
              className="creation-input"
              onChange={(e) => setTargetId(e.target.value)}
            >
              {elements.map((el) => (
                <option key={el.id} value={el.id}>
                  {el.name} ({el.type})
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {targetType === "symbol_set_frame" || targetType === "symbol_set_bg" ? (
          <Field label="Select symbol set">
            <Select
              aria-label="Target symbol set"
              value={targetId || symbolSets[0]?.id || ""}
              className="creation-input"
              onChange={(e) => setTargetId(e.target.value)}
            >
              {symbolSets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        {targetType === "scene_background" ? (
          <Field label="Select scene">
            <Select
              aria-label="Target scene"
              value={targetId || scenes[0]?.id || ""}
              className="creation-input"
              onChange={(e) => setTargetId(e.target.value)}
            >
              {scenes.map((sc) => (
                <option key={sc.id} value={sc.id}>
                  {sc.name} ({sc.kind})
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <p className="rounded-md border border-white/[0.07] bg-ink-950/40 p-2.5 text-[11px] leading-relaxed text-ink-300">
          Assigning this asset will update the GameBlueprint. If assigned to a symbol, it will also be recorded in the symbol&apos;s image history.
        </p>
      </div>
    </Modal>
  );
}
