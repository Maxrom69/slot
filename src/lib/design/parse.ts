import type {
  AssetRef,
  ElementDef,
  PaytableEntry,
  SpecialSymbolDef,
  SymbolDef,
} from "@/lib/blueprint/types";
import type { DesignDoc } from "./types";

export type ParseResult = { ok: true; doc: DesignDoc } | { ok: false; error: string };

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const ELEMENT_TYPES = ["symbol_set", "symbol", "game_title", "reel_frame", "game_background", "button_set", "uploaded", "custom", "other_asset"] as const;
const TIERS = ["low", "mid", "high", "special"] as const;
const SET_TYPES = ["character", "royals", "suits", "seven", "bar", "custom"] as const;
const VALUE_TIERS = ["low", "medium", "high", "special"] as const;
const BEHAVIOURS = ["wild", "scatter", "bonus", "multiplier", "expanding", "sticky"] as const;
const ASSET_KINDS = ["image", "sprite", "spine", "audio", "font"] as const;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(`${label} must be a list.`);
  if ((value as unknown[]).length > max) fail(`${label} has too many entries (max ${max}).`);
  return value as unknown[];
}
function text(value: unknown, label: string, max: number, min = 0): string {
  if (typeof value !== "string" || value.length > max || value.trim().length < min) fail(`${label} must be text of ${min ? `${min}–` : "up to "}${max} characters.`);
  return value as string;
}
function id(value: unknown, label: string): string {
  if (typeof value !== "string" || !ID.test(value)) fail(`${label} is not a valid id.`);
  return value as string;
}
function nullableId(value: unknown, label: string): string | null {
  return value === null ? null : id(value, label);
}
function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) fail(`${label} is not supported.`);
  return value as T;
}
function num(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
    fail(`${label} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`);
  return value as number;
}
function primitives(value: unknown, label: string): Record<string, number | string | boolean> {
  const source = record(value, label);
  const keys = Object.keys(source);
  if (keys.length > 24) fail(`${label} has too many entries.`);
  const out: Record<string, number | string | boolean> = {};
  for (const key of keys) {
    const v = source[key];
    if (key.length > 40 || /^(__proto__|constructor|prototype)$/.test(key)) fail(`${label} contains an unsupported key.`);
    if (typeof v === "string") out[key] = text(v, `${label}.${key}`, 300);
    else if (typeof v === "number" && Number.isFinite(v)) out[key] = v;
    else if (typeof v === "boolean") out[key] = v;
    else fail(`${label}.${key} must be text, a number or a boolean.`);
  }
  return out;
}

function assetReference(raw: unknown, label: string): import("@/lib/blueprint/types").AssetReference | null {
  if (raw === null || raw === undefined) return null;
  const r = record(raw, label);
  const provider = choice(r.provider, ["project", "external", "placeholder"] as const, `${label} provider`);
  if (provider === "project") {
    const assetId = nullableId(r.assetId ?? null, `${label} asset`);
    if (!assetId) fail(`${label} needs a project asset id.`);
    return { provider, assetId, ...(typeof r.name === "string" ? { name: r.name.slice(0, 120) } : {}) };
  }
  if (provider === "external") {
    return { provider, uri: text(r.uri, `${label} uri`, 500, 1), ...(typeof r.name === "string" ? { name: r.name.slice(0, 120) } : {}) };
  }
  return { provider, ...(typeof r.name === "string" ? { name: r.name.slice(0, 120) } : {}) };
}

function tags(raw: unknown, label: string): string[] {
  if (raw === undefined) return [];
  return list(raw, label, 12).map((t) => text(t, "Tag", 40));
}

const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
] as const;
const ANIM_PRESETS = ["none", "idle_pulse", "float", "spin_glow", "win_pop", "custom"] as const;
const ANIM_TRIGGERS = ["spin_start", "reel_stop", "win", "big_win", "feature_enter"] as const;

function element(raw: unknown, i: number): ElementDef {
  const r = record(raw, `Element ${i + 1}`);
  const type = choice(r.type, ELEMENT_TYPES, `Element ${i + 1} type`);
  const out: ElementDef = {
    id: id(r.id, `Element ${i + 1} id`),
    type,
    name: text(r.name, `Element ${i + 1} name`, 80, 1),
    group: text(r.group, `Element ${i + 1} group`, 60),
    assetId: nullableId(r.assetId, `Element ${i + 1} asset`),
    symbolIds: list(r.symbolIds, `Element ${i + 1} symbols`, 64).map((v, k) => id(v, `Element ${i + 1} symbol ${k + 1}`)),
    notes: text(r.notes ?? "", `Element ${i + 1} notes`, 800),
    origin: choice(r.origin, ["planned", "imported"] as const, `Element ${i + 1} origin`),
    params: primitives(r.params ?? {}, `Element ${i + 1} params`),
    description: text(r.description ?? "", `Element ${i + 1} description`, 800),
    tags: tags(r.tags, `Element ${i + 1} tags`),
    image: r.image === undefined ? null : assetReference(r.image, `Element ${i + 1} image`),
    ...(r.imageHistory !== undefined
      ? { imageHistory: list(r.imageHistory, `Element ${i + 1} image history`, 100).map((v, k) => revision(v, i, k)) }
      : {}),
    ...(r.variants !== undefined
      ? { variants: list(r.variants, `Element ${i + 1} variants`, 24).map((v, k) => variant(v, i, k)) }
      : {}),
    ...(r.extras !== undefined
      ? { extras: primitives(r.extras ?? {}, `Element ${i + 1} extras`) }
      : {}),
    ...(typeof r.animationExtra === "string"
      ? { animationExtra: text(r.animationExtra, `Element ${i + 1} animationExtra`, 800) }
      : {}),
  };
  if (r.style !== undefined && r.style !== null) {
    const st = record(r.style, `Element ${i + 1} style`);
    out.style = {
      ...(typeof st.styleGuide === "string" ? { styleGuide: text(st.styleGuide, `Element ${i + 1} styleGuide`, 800) } : {}),
      ...(typeof st.tintColor === "string" ? { tintColor: text(st.tintColor, `Element ${i + 1} tintColor`, 32) } : {}),
      ...(typeof st.opacity === "number" ? { opacity: num(st.opacity, `Element ${i + 1} opacity`, 0, 1) } : {}),
      ...(typeof st.blendMode === "string" ? { blendMode: choice(st.blendMode, BLEND_MODES, `Element ${i + 1} blendMode`) } : {}),
    };
  }
  if (r.animation !== undefined && r.animation !== null) {
    const an = record(r.animation, `Element ${i + 1} animation`);
    out.animation = {
      preset: choice(an.preset ?? "none", ANIM_PRESETS, `Element ${i + 1} animation preset`),
      trigger: choice(an.trigger ?? "win", ANIM_TRIGGERS, `Element ${i + 1} animation trigger`),
      durationMs: num(an.durationMs ?? 600, `Element ${i + 1} animation duration`, 0, 60_000, true),
      easing: text(an.easing ?? "ease-out", `Element ${i + 1} animation easing`, 64),
      loop: boolFlag(an.loop, `Element ${i + 1} animation loop`),
    };
  }
  if (r.symbolSet !== undefined) {
    const s = record(r.symbolSet, `Element ${i + 1} symbol set`);
    out.symbolSet = {
      symbolType: choice(s.symbolType, SET_TYPES, `Element ${i + 1} symbol type`),
      valueTier: choice(s.valueTier, VALUE_TIERS, `Element ${i + 1} value tier`),
      frame: s.frame === undefined ? null : assetReference(s.frame, `Element ${i + 1} frame`),
      background: s.background === undefined ? null : assetReference(s.background, `Element ${i + 1} background`),
      styleGuide: text(s.styleGuide ?? "", `Element ${i + 1} style guide`, 800),
      description: text(s.description ?? "", `Element ${i + 1} set description`, 800),
      tags: tags(s.tags, `Element ${i + 1} set tags`),
    };
  }
  return out;
}

function variant(raw: unknown, i: number, j: number): import("@/lib/blueprint/types").SymbolVariant {
  const r = record(raw, `Symbol ${i + 1} variant ${j + 1}`);
  return {
    id: id(r.id, `Symbol ${i + 1} variant ${j + 1} id`),
    name: text(r.name, `Symbol ${i + 1} variant ${j + 1} name`, 80, 1),
    ...(typeof r.description === "string" ? { description: text(r.description, `Symbol ${i + 1} variant ${j + 1} description`, 800) } : {}),
    image: r.image === undefined ? null : assetReference(r.image, `Symbol ${i + 1} variant ${j + 1} image`),
    extras: primitives(r.extras ?? {}, `Symbol ${i + 1} variant ${j + 1} extras`),
    tags: tags(r.tags, `Symbol ${i + 1} variant ${j + 1} tags`),
  };
}

function boolFlag(value: unknown, label: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") fail(`${label} must be a boolean.`);
  return value as boolean;
}

function revision(raw: unknown, i: number, j: number): import("@/lib/blueprint/types").ImageRevision {
  const r = record(raw, `Symbol ${i + 1} revision ${j + 1}`);
  return {
    id: id(r.id, `Symbol ${i + 1} revision ${j + 1} id`),
    asset: r.asset === undefined ? null : assetReference(r.asset, `Symbol ${i + 1} revision ${j + 1} asset`),
    createdAt: text(r.createdAt, `Symbol ${i + 1} revision ${j + 1} createdAt`, 40),
    source: choice(r.source, ["create", "import", "upload", "duplicate", "variant", "restore"] as const, `Symbol ${i + 1} revision ${j + 1} source`),
    ...(typeof r.label === "string" && r.label.trim() ? { label: text(r.label, `Symbol ${i + 1} revision ${j + 1} label`, 120) } : {}),
    notes: text(r.notes ?? "", `Symbol ${i + 1} revision ${j + 1} notes`, 320),
  };
}

function symbol(raw: unknown, i: number): SymbolDef {
  const r = record(raw, `Symbol ${i + 1}`);
  const payouts = record(r.payouts, `Symbol ${i + 1} payouts`);
  if (Object.keys(payouts).length > 12) fail(`Symbol ${i + 1} has too many payout levels.`);
  return {
    id: id(r.id, `Symbol ${i + 1} id`),
    code: text(r.code, `Symbol ${i + 1} code`, 16, 1),
    name: text(r.name, `Symbol ${i + 1} name`, 80, 1),
    tier: choice(r.tier, TIERS, `Symbol ${i + 1} tier`),
    glyph: text(r.glyph, `Symbol ${i + 1} glyph`, 12),
    assetId: nullableId(r.assetId, `Symbol ${i + 1} asset`),
    payouts: Object.fromEntries(Object.entries(payouts).map(([k, v]) => [text(k, "Payout level", 4, 1), num(v, `Symbol ${i + 1} payout`, 0, 10_000_000)])),
    reelWeight: num(r.reelWeight, `Symbol ${i + 1} reel weight`, 0, 1000, true),
    symbolSetId: r.symbolSetId === undefined || r.symbolSetId === null ? null : id(r.symbolSetId, `Symbol ${i + 1} set`),
    symbolType: r.symbolType === undefined ? "custom" : choice(r.symbolType, SET_TYPES, `Symbol ${i + 1} symbol type`),
    image: r.image === undefined ? null : assetReference(r.image, `Symbol ${i + 1} image`),
    imageHistory: r.imageHistory === undefined ? [] : list(r.imageHistory, `Symbol ${i + 1} image history`, 100).map((v, k) => revision(v, i, k)),
    variants: r.variants === undefined ? [] : list(r.variants, `Symbol ${i + 1} variants`, 24).map((v, k) => variant(v, i, k)),
    extras: primitives(r.extras ?? {}, `Symbol ${i + 1} extras`),
    mathId: r.mathId === undefined || r.mathId === null ? null : text(r.mathId, `Symbol ${i + 1} math id`, 80),
    isWild: boolFlag(r.isWild, `Symbol ${i + 1} wild flag`),
    isScatter: boolFlag(r.isScatter, `Symbol ${i + 1} scatter flag`),
    isBonus: boolFlag(r.isBonus, `Symbol ${i + 1} bonus flag`),
    ...(typeof r.family === "string" && r.family.trim() ? { family: text(r.family.trim(), `Symbol ${i + 1} family`, 60) } : {}),
    description: text(r.description ?? "", `Symbol ${i + 1} description`, 800),
    tags: tags(r.tags, `Symbol ${i + 1} tags`),
  };
}

function special(raw: unknown, i: number): SpecialSymbolDef {
  const r = record(raw, `Special symbol ${i + 1}`);
  return {
    id: id(r.id, `Special symbol ${i + 1} id`),
    symbolId: id(r.symbolId, `Special symbol ${i + 1} symbol`),
    behaviour: choice(r.behaviour, BEHAVIOURS, `Special symbol ${i + 1} behaviour`),
    params: primitives(r.params ?? {}, `Special symbol ${i + 1} params`),
  };
}

const ASSET_FORMATS = [
  "png",
  "png-transparent",
  "jpeg",
  "webp",
  "svg",
  "json-animation",
  "audio",
  "other",
] as const;

function asset(raw: unknown, i: number): AssetRef {
  const r = record(raw, `Asset ${i + 1}`);
  const uri = r.uri === null ? null : text(r.uri, `Asset ${i + 1} uri`, 500, 1);
  return {
    id: id(r.id, `Asset ${i + 1} id`),
    name: text(r.name, `Asset ${i + 1} name`, 120, 1),
    kind: choice(r.kind, ASSET_KINDS, `Asset ${i + 1} kind`),
    uri,
    state: choice(r.state, ["placeholder", "linked"] as const, `Asset ${i + 1} state`),
    tags: list(r.tags ?? [], `Asset ${i + 1} tags`, 12).map((t) => text(t, "Asset tag", 40)),
    width: typeof r.width === "number" && Number.isFinite(r.width) ? r.width : null,
    height: typeof r.height === "number" && Number.isFinite(r.height) ? r.height : null,
    format: typeof r.format === "string" && (ASSET_FORMATS as readonly string[]).includes(r.format) ? r.format as AssetRef["format"] : undefined,
    mime: typeof r.mime === "string" ? text(r.mime, `Asset ${i + 1} mime`, 80) : undefined,
    sizeBytes: typeof r.sizeBytes === "number" && Number.isFinite(r.sizeBytes) ? r.sizeBytes : undefined,
    hasAlpha: typeof r.hasAlpha === "boolean" ? r.hasAlpha : undefined,
    createdAt: typeof r.createdAt === "string" ? text(r.createdAt, `Asset ${i + 1} createdAt`, 40) : undefined,
    updatedAt: typeof r.updatedAt === "string" ? text(r.updatedAt, `Asset ${i + 1} updatedAt`, 40) : undefined,
    ...(Array.isArray(r.revisions)
      ? {
          revisions: list(r.revisions, `Asset ${i + 1} revisions`, 100).map((rev, k) => {
            const rr = record(rev, `Asset ${i + 1} revision ${k + 1}`);
            return {
              id: id(rr.id, `Asset ${i + 1} revision ${k + 1} id`),
              uri: text(rr.uri, `Asset ${i + 1} revision ${k + 1} uri`, 500, 1),
              createdAt: text(rr.createdAt, `Asset ${i + 1} revision ${k + 1} createdAt`, 40),
              ...(typeof rr.source === "string" ? { source: text(rr.source, `Asset ${i + 1} revision ${k + 1} source`, 40) } : {}),
              ...(typeof rr.notes === "string" ? { notes: text(rr.notes, `Asset ${i + 1} revision ${k + 1} notes`, 320) } : {}),
            };
          }),
        }
      : {}),
  };
}

function row(raw: unknown, i: number): PaytableEntry {
  const r = record(raw, `Paytable row ${i + 1}`);
  return {
    symbolId: id(r.symbolId, `Paytable row ${i + 1} symbol`),
    ofAKind: num(r.ofAKind, `Paytable row ${i + 1} count`, 1, 20, true),
    payout: num(r.payout, `Paytable row ${i + 1} payout`, 0, 10_000_000),
  };
}

const STUDIO_ANIM_TYPES = ["Background", "Symbol Win", "Standalone", "Hover", "Custom"] as const;
const ANIM_SOURCES = ["preset", "video", "sprite_sheet", "custom"] as const;
const ANIM_FORMATS = ["css", "mp4", "webm", "sprite-sheet", "webp", "gif", "json-animation"] as const;
const ANIM_STATES = ["enabled", "disabled"] as const;

function videoReference(raw: unknown, label: string): import("@/lib/blueprint/types").VideoAnimationReference | null {
  if (raw === null || raw === undefined) return null;
  const r = record(raw, label);
  return {
    assetId: r.assetId === null || r.assetId === undefined ? null : id(r.assetId, `${label} assetId`),
    uri: r.uri === null || r.uri === undefined ? null : text(r.uri, `${label} uri`, 500),
    ...(typeof r.mimeType === "string" ? { mimeType: text(r.mimeType, `${label} mimeType`, 80) } : {}),
    ...(typeof r.width === "number" && Number.isFinite(r.width) ? { width: num(r.width, `${label} width`, 1, 8192, true) } : {}),
    ...(typeof r.height === "number" && Number.isFinite(r.height) ? { height: num(r.height, `${label} height`, 1, 8192, true) } : {}),
    ...(typeof r.playbackRate === "number" && Number.isFinite(r.playbackRate) ? { playbackRate: num(r.playbackRate, `${label} playbackRate`, 0.1, 4) } : {}),
    ...(typeof r.muted === "boolean" ? { muted: r.muted } : {}),
  };
}

function spriteSheetReference(raw: unknown, label: string): import("@/lib/blueprint/types").SpriteSheetAnimationReference | null {
  if (raw === null || raw === undefined) return null;
  const r = record(raw, label);
  const columns = num(r.columns ?? 4, `${label} columns`, 1, 128, true);
  const rows = num(r.rows ?? 4, `${label} rows`, 1, 128, true);
  const frameCount = num(r.frameCount ?? columns * rows, `${label} frameCount`, 1, 16384, true);
  return {
    assetId: r.assetId === null || r.assetId === undefined ? null : id(r.assetId, `${label} assetId`),
    uri: r.uri === null || r.uri === undefined ? null : text(r.uri, `${label} uri`, 500),
    columns,
    rows,
    frameWidth: num(r.frameWidth ?? 128, `${label} frameWidth`, 1, 4096, true),
    frameHeight: num(r.frameHeight ?? 128, `${label} frameHeight`, 1, 4096, true),
    frameCount,
    ...(typeof r.startFrame === "number" && Number.isFinite(r.startFrame) ? { startFrame: num(r.startFrame, `${label} startFrame`, 0, 16383, true) } : {}),
    ...(typeof r.endFrame === "number" && Number.isFinite(r.endFrame) ? { endFrame: num(r.endFrame, `${label} endFrame`, 0, 16383, true) } : {}),
    ...(typeof r.spacing === "number" && Number.isFinite(r.spacing) ? { spacing: num(r.spacing, `${label} spacing`, 0, 256, true) } : {}),
    ...(typeof r.margin === "number" && Number.isFinite(r.margin) ? { margin: num(r.margin, `${label} margin`, 0, 256, true) } : {}),
  };
}

function animationMeta(raw: unknown, i: number): import("@/lib/blueprint/types").AnimationMeta {
  const r = record(raw, `Animation ${i + 1}`);
  const durationVal = num(
    typeof r.durationMs === "number" ? r.durationMs : (r.duration ?? 600),
    `Animation ${i + 1} duration`,
    0,
    60_000,
    true,
  );
  return {
    id: id(r.id, `Animation ${i + 1} id`),
    target: id(r.target ?? r.elementId ?? "standalone", `Animation ${i + 1} target`),
    trigger: choice(r.trigger ?? "win", ANIM_TRIGGERS, `Animation ${i + 1} trigger`),
    kind: text(r.kind ?? "pulse", `Animation ${i + 1} kind`, 64, 1),
    durationMs: durationVal,
    easing: text(r.easing ?? "ease-out", `Animation ${i + 1} easing`, 64, 1),
    ...(typeof r.elementId === "string" && r.elementId.trim() ? { elementId: id(r.elementId, `Animation ${i + 1} elementId`) } : {}),
    ...(typeof r.name === "string" && r.name.trim() ? { name: text(r.name, `Animation ${i + 1} name`, 80, 1) } : {}),
    ...(typeof r.animationType === "string" ? { animationType: choice(r.animationType, STUDIO_ANIM_TYPES, `Animation ${i + 1} animationType`) } : {}),
    ...(typeof r.source === "string" ? { source: choice(r.source, ANIM_SOURCES, `Animation ${i + 1} source`) } : {}),
    ...(typeof r.format === "string" ? { format: choice(r.format, ANIM_FORMATS, `Animation ${i + 1} format`) } : {}),
    ...(typeof r.duration === "number" && Number.isFinite(r.duration) ? { duration: num(r.duration, `Animation ${i + 1} duration`, 0, 60_000, true) } : { duration: durationVal }),
    ...(typeof r.loop === "boolean" ? { loop: r.loop } : {}),
    ...(typeof r.fps === "number" && Number.isFinite(r.fps) ? { fps: num(r.fps, `Animation ${i + 1} fps`, 1, 240, true) } : {}),
    ...(r.thumbnail === null || typeof r.thumbnail === "string" ? { thumbnail: r.thumbnail === null ? null : text(r.thumbnail, `Animation ${i + 1} thumbnail`, 500) } : {}),
    ...(r.videoReference !== undefined ? { videoReference: videoReference(r.videoReference, `Animation ${i + 1} videoReference`) } : {}),
    ...(r.spriteSheetReference !== undefined ? { spriteSheetReference: spriteSheetReference(r.spriteSheetReference, `Animation ${i + 1} spriteSheetReference`) } : {}),
    ...(typeof r.state === "string" ? { state: choice(r.state, ANIM_STATES, `Animation ${i + 1} state`) } : {}),
    ...(typeof r.animationExtra === "string" ? { animationExtra: text(r.animationExtra, `Animation ${i + 1} animationExtra`, 800) } : {}),
  };
}

/** Strictly validates untrusted design data. Throws nothing; returns a readable error. */
export function parseDesignDoc(raw: unknown): ParseResult {
  try {
    const r = record(raw, "Design");
    return {
      ok: true,
      doc: {
        elements: list(r.elements, "Elements", 400).map(element),
        symbols: list(r.symbols, "Symbols", 1000).map(symbol),
        specialSymbols: list(r.specialSymbols, "Special symbols", 100).map(special),
        assets: list(r.assets, "Assets", 1000).map(asset),
        paytable: list(r.paytable, "Paytable", 12000).map(row),
        strips: list(r.strips, "Reel strips", 12).map((strip, k) =>
          list(strip, `Reel strip ${k + 1}`, 4000).map((v, n) => id(v, `Reel strip ${k + 1} position ${n + 1}`)),
        ),
        referenceAssetId: nullableId(r.referenceAssetId ?? null, "Reference asset"),
        ...(Array.isArray(r.animations)
          ? { animations: list(r.animations, "Animations", 200).map(animationMeta) }
          : {}),
      },
    };
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message };
    throw error;
  }
}
