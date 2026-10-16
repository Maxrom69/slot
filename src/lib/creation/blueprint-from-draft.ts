import { createBlueprint } from "@/lib/blueprint/factory";
import type {
  AssetRef,
  ElementDef,
  ElementType,
  GameBlueprint,
} from "@/lib/blueprint/types";
import { elementTypeMeta } from "@/lib/blueprint/elements";
import { migrateBlueprint } from "@/lib/design/migrate";
import {
  ASPECTS,
  BUTTONS,
  FRAME_STYLES,
  STYLE_PRESETS,
  normalizeDraft,
  normalizeFolderPath,
  type NewGameDraft,
} from "./draft";

const BINDABLE: ElementType[] = ["game_title", "game_background", "reel_frame", "button_set"];

/**
 * Pure conversion: NewGameDraft -> GameBlueprint.
 * Imported artwork is kept inline as data URLs here; the persistence service
 * moves them into asset storage and rewrites the URIs.
 */
export function draftToBlueprint(
  rawDraft: NewGameDraft,
  ctx: { id: string; now?: string },
): GameBlueprint {
  const draft = normalizeDraft(rawDraft);
  const aspect = ASPECTS.find((a) => a.id === draft.elements.aspect) ?? ASPECTS[0];
  const preset = STYLE_PRESETS.find((p) => p.id === draft.stylePreset) ?? STYLE_PRESETS[0];

  const base = createBlueprint({
    id: ctx.id,
    title: draft.title.trim(),
    description: draft.description.trim(),
    theme: draft.theme.trim(),
    styleGuide: draft.styleGuide.trim(),
    status: draft.status,
    columns: draft.grid.columns,
    rows: draft.grid.rows,
    paylineCount: draft.paylineCount,
    rtpTarget: draft.rtpTarget,
    volatility: draft.volatility,
    evaluation: draft.evaluation,
    tags: preset.id === "custom" ? [] : [preset.label],
    symbolPlan: {
      royals: draft.symbols.royals,
      medium: draft.symbols.medium,
      high: draft.symbols.high,
      specials: draft.symbols.specials,
    },
    canvas: { width: aspect.width, height: aspect.height, orientation: aspect.orientation },
    createdAt: ctx.now,
    updatedAt: ctx.now,
  });

  const assets: AssetRef[] = [...base.assets];
  const ensureAsset = (id: string, name: string, tag: string) => {
    if (!assets.some((a) => a.id === id)) {
      assets.push({ id, name, kind: "image", uri: null, state: "placeholder", tags: [tag] });
    }
    return id;
  };

  const elements: ElementDef[] = [];
  const planned = (
    id: string,
    type: ElementType,
    name: string,
    group: string,
    assetId: string | null,
    params: ElementDef["params"] = {},
    notes = "",
  ): ElementDef => ({
    id,
    type,
    name,
    group,
    assetId,
    symbolIds: [],
    notes,
    origin: "planned",
    params,
  });

  if (draft.elements.gameTitle) {
    elements.push(planned("el-game-title", "game_title", "Game Title", "Branding", "asset-logo"));
  }
  for (let i = 0; i < draft.elements.backgrounds; i += 1) {
    elements.push(
      planned(
        `el-background-${i + 1}`,
        "game_background",
        `Game Background ${i + 1}`,
        "Backgrounds",
        i === 0 ? "asset-bg" : ensureAsset(`asset-bg-${i + 1}`, `Background ${i + 1}`, "background"),
        { aspect: aspect.id },
      ),
    );
  }
  const frameStyle = FRAME_STYLES.find((f) => f.id === draft.elements.frameStyle)?.label ?? "Themed";
  for (let i = 0; i < draft.elements.reelFrames; i += 1) {
    elements.push(
      planned(
        `el-reel-frame-${i + 1}`,
        "reel_frame",
        `Reel Frame ${i + 1}`,
        "Frames",
        i === 0 ? "asset-frame" : ensureAsset(`asset-frame-${i + 1}`, `Reel frame ${i + 1}`, "frame"),
        { style: frameStyle, grid: `${draft.grid.columns}x${draft.grid.rows}` },
      ),
    );
  }
  if (draft.elements.buttons.length > 0) {
    const labels = draft.elements.buttons.map(
      (id) => BUTTONS.find((b) => b.id === id)?.label ?? id,
    );
    elements.push(
      planned(
        "el-button-set",
        "button_set",
        "Button Set",
        "Controls",
        ensureAsset("asset-buttons", "Button set", "buttons"),
        { buttons: draft.elements.buttons.join(","), count: labels.length },
        labels.join(" · "),
      ),
    );
  }
  base.symbolSets.forEach((set) => {
    elements.push({
      ...planned(`el-${set.id}`, "symbol_set", set.name, set.name, null, {}, set.description),
      symbolIds: set.symbolIds,
      symbolSet: { symbolType: set.symbolType ?? "custom", valueTier: set.valueTier ?? "medium" },
    });
  });
  base.specialSymbols.forEach((special) => {
    const symbol = base.symbols.find((s) => s.id === special.symbolId);
    if (!symbol) return;
    elements.push({
      ...planned(`el-special-${special.id}`, "symbol", symbol.name, "Special", null, {}, `Behaviour: ${special.behaviour}`),
      symbolIds: [symbol.id],
    });
  });

  /* ---- imported artwork: bind to a planned element, else add a new one ---- */
  draft.artwork.forEach((art, index) => {
    const assetId = `asset-imp-${index + 1}`;
    assets.push({
      id: assetId,
      name: art.name,
      kind: "image",
      uri: art.dataUrl,
      state: "linked",
      tags: ["imported", art.elementType],
    });
    const target = BINDABLE.includes(art.elementType)
      ? elements.find((e) => e.type === art.elementType && e.origin === "planned")
      : undefined;
    if (target) {
      target.assetId = assetId;
      target.origin = "imported";
      target.notes = target.notes ? `${target.notes} · artwork: ${art.name}` : `Artwork: ${art.name}`;
      return;
    }
    const meta = elementTypeMeta(art.elementType);
    elements.push({
      id: `el-import-${index + 1}`,
      type: art.elementType,
      name: art.name.replace(/\.[a-z0-9]+$/i, "") || meta.label,
      group: meta.label,
      assetId,
      symbolIds: [],
      notes:
        art.elementType === "symbol" || art.elementType === "symbol_set"
          ? "Imported artwork. Not yet assigned to reel strips or a symbol set."
          : "Imported artwork.",
      origin: "imported",
      params: { width: art.width, height: art.height },
    });
  });

  let referenceAssetId: string | null = null;
  if (draft.referenceImage) {
    referenceAssetId = "asset-reference";
    assets.push({
      id: referenceAssetId,
      name: draft.referenceImage.name,
      kind: "image",
      uri: draft.referenceImage.dataUrl,
      state: "linked",
      tags: ["reference"],
    });
  }

  const backgroundAssetId =
    elements.find((e) => e.type === "game_background")?.assetId ?? null;

  const referenced = new Set<string>();
  elements.forEach((e) => e.assetId && referenced.add(e.assetId));
  if (backgroundAssetId) referenced.add(backgroundAssetId);
  if (referenceAssetId) referenced.add(referenceAssetId);
  const keptAssets = assets.filter((a) => a.kind === "audio" || referenced.has(a.id));

  const folderPath = normalizeFolderPath(draft.folderPath);
  return migrateBlueprint({
    ...base,
    meta: { ...base.meta, folderPath },
    creation: {
      version: 1,
      mode: "manual",
      folderPath,
      gridPreset: draft.grid.preset,
      stylePreset: draft.stylePreset,
      symbolPlan: { ...draft.symbols, specials: [...draft.symbols.specials] },
      requestedPaylineCount: draft.paylineCount,
      elements: { ...draft.elements, buttons: [...draft.elements.buttons] },
      artwork: draft.artwork.map((art, index) => ({
        sourceId: art.id,
        assetId: `asset-imp-${index + 1}`,
        elementType: art.elementType,
        name: art.name,
        mime: art.mime,
        width: art.width,
        height: art.height,
        bytes: art.bytes,
      })),
      reference: draft.referenceImage ? {
        sourceId: draft.referenceImage.id,
        assetId: "asset-reference",
        name: draft.referenceImage.name,
        mime: draft.referenceImage.mime,
        width: draft.referenceImage.width,
        height: draft.referenceImage.height,
        bytes: draft.referenceImage.bytes,
      } : null,
      mathState: "unverified",
    },
    style: {
      ...base.style,
      mood: draft.styleGuide.trim() || preset.mood || base.style.mood,
      artDirection: `${preset.label} — ${draft.theme.trim() || "Original"}`,
      referenceAssetId,
    },
    assets: keptAssets,
    elements,
    canvas: { ...base.canvas, backgroundAssetId },
    exportConfig: {
      ...base.exportConfig,
      includeAssets: keptAssets.some((a) => a.state === "linked"),
    },
  });
}
