import { maxPaylines } from "./factory";
import type { GameBlueprint } from "./types";

export interface BlueprintCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  /** integrity: broken references/geometry (never saved). completeness: unfinished work. */
  severity: "integrity" | "completeness";
}

export interface BlueprintValidation {
  ok: boolean;
  integrityOk: boolean;
  checks: BlueprintCheck[];
  issues: string[];
  integrityIssues: string[];
}

/** Structural contract checks only. This is not RTP certification or engine execution. */
export function validateBlueprint(bp: GameBlueprint): BlueprintValidation {
  const checks: BlueprintCheck[] = [];
  const add = (
    id: string,
    label: string,
    ok: boolean,
    detail: string,
    severity: BlueprintCheck["severity"] = "integrity",
  ) => checks.push({ id, label, ok, detail: ok ? undefined : detail, severity });

  const symbolIds = new Set(bp.symbols.map((s) => s.id));
  const assetIds = new Set(bp.assets.map((a) => a.id));
  const layerIds = new Set(bp.layers.map((l) => l.id));
  const { columns, rows } = bp.reels;

  add("meta", "Project identity", Boolean(bp.meta.id && bp.meta.title.trim() && bp.meta.theme.trim()), "Add a game title and theme.");
  add("grid", "Supported grid", Number.isInteger(columns) && Number.isInteger(rows) && columns >= 3 && columns <= 8 && rows >= 2 && rows <= 6, "Use 3–8 reels and 2–6 rows.");
  add("symbols-present", "At least one symbol", bp.symbols.length > 0, "Add a symbol set or a standalone symbol.", "completeness");
  add("symbols", "Symbol definitions", symbolIds.size === bp.symbols.length && bp.symbols.every((s) => s.id && Number.isInteger(s.reelWeight) && s.reelWeight >= 0 && (s.assetId === null || assetIds.has(s.assetId))), "Symbols must be unique and reference known assets.");
  add("strips", "Reel strip references", bp.reels.strips.length === columns && bp.reels.strips.every((strip) => strip.every((id) => symbolIds.has(id))), "Every reel needs a strip of known symbol ids.");
  add("strips-complete", "Reel strips populated", bp.reels.strips.length === columns && bp.reels.strips.every((strip) => strip.length > 0), "Reel strips are empty until symbols exist.", "completeness");

  const linePatterns = new Set(bp.paylines.map((line) => line.pattern.join(",")));
  add("paylines", "Payline geometry", bp.reels.evaluation === "lines"
    ? bp.paylines.length <= maxPaylines(columns, rows) && linePatterns.size === bp.paylines.length && bp.paylines.every((line) => line.pattern.length === columns && line.pattern.every((r) => Number.isInteger(r) && r >= 0 && r < rows))
    : bp.paylines.length === 0, "Paylines must be distinct and fit the grid, or empty for ways/cluster.");
  add("paylines-complete", "Paylines defined", bp.reels.evaluation !== "lines" || bp.paylines.length > 0, "A line game needs at least one payline.", "completeness");
  add("paytable", "Paytable references", bp.paytable.every((entry) => symbolIds.has(entry.symbolId) && Number.isInteger(entry.ofAKind) && entry.ofAKind > 0 && Number.isFinite(entry.payout) && entry.payout >= 0), "Paytable entries must reference known symbols and non-negative multipliers.");
  add("sets", "Symbol set membership", bp.symbolSets.every((set) => set.symbolIds.every((id) => symbolIds.has(id))), "A symbol set references a missing symbol.");
  add("specials", "Special symbol references", bp.specialSymbols.every((special) => symbolIds.has(special.symbolId)), "A special symbol references a missing symbol.");
  add("assets", "Asset definitions", assetIds.size === bp.assets.length && bp.assets.every((a) => a.id && (a.state === "linked" ? Boolean(a.uri) : a.uri === null)), "Asset ids must be unique and linked assets need a URI.");

  const owners = new Map<string, number>();
  bp.elements.forEach((el) => el.symbolIds.forEach((id) => owners.set(id, (owners.get(id) ?? 0) + 1)));
  const projectAsset = (ref: { provider: string; assetId?: string | null } | null | undefined) =>
    !ref || ref.provider !== "project" || (ref.assetId && assetIds.has(ref.assetId));
  add("elements", "Element references", bp.elements.every((el) => (el.assetId === null || assetIds.has(el.assetId)) && el.symbolIds.every((id) => symbolIds.has(id)) && projectAsset(el.image) && (el.variants ?? []).every((v) => projectAsset(v.image)) && (el.imageHistory ?? []).every((r) => projectAsset(r.asset)) && projectAsset(el.symbolSet?.frame) && projectAsset(el.symbolSet?.background)), "An element references a missing asset or symbol.");
  add("element-ids", "Unique elements", new Set(bp.elements.map((e) => e.id)).size === bp.elements.length, "Element ids must be unique.");
  add("owners", "Single symbol owner", Array.from(owners.values()).every((n) => n === 1), "A symbol belongs to more than one element.");
  const variantIds = new Set<string>();
  const variantDupes = bp.symbols.some((s) => (s.variants ?? []).some((v) => variantIds.has(v.id) ? true : (variantIds.add(v.id), false)));
  const elVariantIds = new Set<string>();
  const elVariantDupes = bp.elements.some((el) => (el.variants ?? []).some((v) => elVariantIds.has(v.id) ? true : (elVariantIds.add(v.id), false)));
  add("variants", "Stable variant ids", !variantDupes && !elVariantDupes, "A symbol or element variant id is duplicated.");
  const elementIds = new Set(bp.elements.map((e) => e.id));
  add("symbol-sets", "Symbol set links", bp.symbols.every((s) => !s.symbolSetId || elementIds.has(s.symbolSetId)), "A symbol references a missing symbol set.");
  add("symbol-images", "Symbol image references", bp.symbols.every((s) => projectAsset(s.image) && (s.variants ?? []).every((v) => projectAsset(v.image)) && (s.imageHistory ?? []).every((r) => projectAsset(r.asset))), "A symbol, variant, or image revision references a missing asset.");
  add("canvas", "Canvas definition", Number.isFinite(bp.canvas.width) && Number.isFinite(bp.canvas.height) && bp.canvas.width > 0 && bp.canvas.height > 0 && (bp.canvas.backgroundAssetId === null || assetIds.has(bp.canvas.backgroundAssetId)), "Canvas dimensions must be positive and the background must resolve.");
  add("reference", "Style reference", !bp.style.referenceAssetId || assetIds.has(bp.style.referenceAssetId), "The style reference asset is missing.");
  add(
    "scenes",
    "Scene layer references",
    bp.scenes.length >= 1 &&
      bp.scenes.length <= 3 &&
      layerIds.size === bp.layers.length &&
      bp.scenes.every((scene) => {
        const sceneOwnLayerIds = new Set((scene.layers ?? []).map((l) => l.id));
        const validName =
          typeof scene.name === "string" &&
          scene.name.trim().length > 0 &&
          scene.name.trim().length <= 18;
        return (
          validName &&
          scene.layerIds.every((id) => layerIds.has(id) || sceneOwnLayerIds.has(id))
        );
      }),
    "Scenes (1–3, names up to 18 characters) must reference known layers.",
  );
  add(
    "animations",
    "Animation metadata targets",
    bp.animations.every(
      (animation) =>
        (animation.target === "standalone" ||
          layerIds.has(animation.target) ||
          symbolIds.has(animation.target) ||
          elementIds.has(animation.target)) &&
        Number.isFinite(animation.durationMs) &&
        animation.durationMs >= 0 &&
        (!animation.videoReference?.assetId || assetIds.has(animation.videoReference.assetId)) &&
        (!animation.spriteSheetReference?.assetId || assetIds.has(animation.spriteSheetReference.assetId)),
    ),
    "An animation references a missing target or unsupported duration.",
  );
  add("math", "Configuration targets", Number.isFinite(bp.math.rtpTarget) && bp.math.rtpTarget >= 80 && bp.math.rtpTarget <= 99, "RTP target must be 80–99%. It is a target, not an engine result.");
  if (bp.creation) add("creation", "Creation record", bp.creation.mode === "manual", "The creation record must describe manual creation.");

  const failing = checks.filter((check) => !check.ok);
  const describe = (check: BlueprintCheck) => `${check.label}: ${check.detail}`;
  return {
    ok: failing.length === 0,
    integrityOk: failing.every((check) => check.severity !== "integrity"),
    checks,
    issues: failing.map(describe),
    integrityIssues: failing.filter((check) => check.severity === "integrity").map(describe),
  };
}
