import { maxPaylines } from "@/lib/blueprint/factory";
import type { ElementType, ProjectStatus, Volatility } from "@/lib/blueprint/types";
import { inlineImageInfo, MAX_STORED_BYTES, MAX_PROJECT_ART_BYTES } from "./artwork-policy";

/** Plain serializable editor input. draftToBlueprint is its only construction boundary. */
export type GridPresetId = "5x3" | "5x4" | "6x3" | "6x4" | "custom";
export type SpecialKind = "wild" | "scatter" | "bonus";
export type AspectId = "16:9" | "21:9" | "3:2" | "4:3" | "9:16";
export type ButtonId = "spin" | "max" | "auto" | "turbo" | "bet" | "menu";
export type FrameStyleId = "ornate" | "minimal" | "cabinet" | "themed";
export type StylePresetId = "cinematic" | "cartoon" | "painterly" | "neon" | "flat" | "custom";

export interface ImportedImage {
  id: string;
  name: string;
  dataUrl: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}
export interface ImportedArtwork extends ImportedImage { elementType: ElementType }
export interface NewGameDraft {
  schema: 1;
  title: string;
  theme: string;
  folderPath: string;
  stylePreset: StylePresetId;
  styleGuide: string;
  description: string;
  grid: { preset: GridPresetId; columns: number; rows: number };
  evaluation: "lines" | "ways" | "cluster";
  paylineCount: number;
  rtpTarget: number;
  volatility: Volatility;
  status: ProjectStatus;
  symbols: { royals: number; medium: number; high: number; specials: SpecialKind[] };
  elements: {
    gameTitle: boolean;
    backgrounds: number;
    aspect: AspectId;
    reelFrames: number;
    frameStyle: FrameStyleId;
    buttons: ButtonId[];
  };
  referenceImage: ImportedImage | null;
  artwork: ImportedArtwork[];
}

export const GRID_PRESETS: { id: GridPresetId; label: string; columns: number; rows: number }[] = [
  { id: "5x3", label: "5 × 3", columns: 5, rows: 3 },
  { id: "5x4", label: "5 × 4", columns: 5, rows: 4 },
  { id: "6x3", label: "6 × 3", columns: 6, rows: 3 },
  { id: "6x4", label: "6 × 4", columns: 6, rows: 4 },
];
export const GRID_LIMITS = { minColumns: 3, maxColumns: 8, minRows: 2, maxRows: 6 } as const;
export const ASPECTS: {
  id: AspectId; label: string; hint: string; width: number; height: number;
  orientation: "landscape" | "portrait";
}[] = [
  { id: "16:9", label: "16:9", hint: "Widescreen · 1920×1080", width: 1920, height: 1080, orientation: "landscape" },
  { id: "21:9", label: "21:9", hint: "Ultrawide · 2560×1080", width: 2560, height: 1080, orientation: "landscape" },
  { id: "3:2", label: "3:2", hint: "Classic · 1620×1080", width: 1620, height: 1080, orientation: "landscape" },
  { id: "4:3", label: "4:3", hint: "Standard · 1440×1080", width: 1440, height: 1080, orientation: "landscape" },
  { id: "9:16", label: "9:16", hint: "Portrait · 1080×1920", width: 1080, height: 1920, orientation: "portrait" },
];
export const BUTTONS: { id: ButtonId; label: string; required?: boolean }[] = [
  { id: "spin", label: "Spin", required: true }, { id: "max", label: "Max Bet" },
  { id: "auto", label: "Auto Play" }, { id: "turbo", label: "Turbo" },
  { id: "bet", label: "Bet +/−" }, { id: "menu", label: "Menu" },
];
export const FRAME_STYLES: { id: FrameStyleId; label: string }[] = [
  { id: "ornate", label: "Ornate" }, { id: "minimal", label: "Minimal" },
  { id: "cabinet", label: "Cabinet" }, { id: "themed", label: "Themed" },
];
export const STYLE_PRESETS: { id: StylePresetId; label: string; mood: string }[] = [
  { id: "cinematic", label: "Cinematic Realism", mood: "Cinematic realism, volumetric light, rich materials" },
  { id: "cartoon", label: "Stylized Cartoon", mood: "Stylized cartoon, bold shapes, saturated colour" },
  { id: "painterly", label: "Painterly Fantasy", mood: "Painterly fantasy, soft edges, illustrative detail" },
  { id: "neon", label: "Neon Retro", mood: "Retro-futurist, neon glow, chrome and scanlines" },
  { id: "flat", label: "Flat Vector", mood: "Flat vector, clean silhouettes, limited palette" },
  { id: "custom", label: "Custom", mood: "" },
];
export const THEME_PRESETS: { theme: string; style: string; preset: StylePresetId }[] = [
  { theme: "Roman Empire", style: "Gold leaf, marble, volumetric dusk light", preset: "cinematic" },
  { theme: "Jungle Temple", style: "Emerald rim light, carved stone, humid haze", preset: "cartoon" },
  { theme: "Neon Arcade", style: "Chrome, magenta/cyan neon, CRT scanlines", preset: "neon" },
  { theme: "Deep Abyss", style: "Bioluminescent deep sea, caustic light", preset: "painterly" },
  { theme: "Blossom Spring", style: "Soft pastel, bloom lighting, plush shapes", preset: "cartoon" },
];
export const SYMBOL_LIMITS = { royals: 6, medium: 6, high: 6 } as const;
export const MAX_ARTWORK = 24;
export const SPECIAL_KINDS: SpecialKind[] = ["wild", "scatter", "bonus"];
export const CREATION_ELEMENT_TYPE_IDS: ElementType[] = [
  "symbol_set",
  "symbol",
  "game_title",
  "reel_frame",
  "game_background",
  "button_set",
  "other_asset",
];
const ELEMENT_TYPE_IDS: ElementType[] = [
  ...CREATION_ELEMENT_TYPE_IDS,
  "uploaded",
  "custom",
];

export function createDefaultDraft(): NewGameDraft {
  return {
    schema: 1, title: "", theme: "", folderPath: "", stylePreset: "cinematic",
    styleGuide: "", description: "", grid: { preset: "5x3", columns: 5, rows: 3 },
    evaluation: "lines", paylineCount: 20, rtpTarget: 96, volatility: "medium", status: "draft",
    symbols: { royals: 4, medium: 2, high: 3, specials: ["wild", "scatter", "bonus"] },
    elements: { gameTitle: true, backgrounds: 1, aspect: "16:9", reelFrames: 1, frameStyle: "themed", buttons: ["spin", "auto"] },
    referenceImage: null, artwork: [],
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function num(value: unknown, min: number, max: number, fallback: number, integer = true) {
  const defaultValue = Math.min(max, Math.max(min, fallback));
  if (value === undefined || value === null || value === "") return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, integer ? Math.round(n) : n)) : defaultValue;
}
function str(value: unknown, fallback = "", max = 800) {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}
function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback;
}
function image(value: unknown, fallbackId: string): ImportedImage | null {
  const v = record(value);
  const info = typeof v.dataUrl === "string" ? inlineImageInfo(v.dataUrl) : null;
  if (!info || info.bytes === 0 || info.bytes > MAX_STORED_BYTES) return null;
  return {
    id: str(v.id, fallbackId, 64), name: str(v.name, "Artwork", 120),
    dataUrl: v.dataUrl as string, mime: info.mime,
    width: num(v.width, 1, 20000, 1), height: num(v.height, 1, 20000, 1), bytes: info.bytes,
  };
}

/** Forgiving restoration for older browser drafts. Server requests are checked first. */
export function normalizeDraft(raw: unknown): NewGameDraft {
  const d = createDefaultDraft();
  const r = record(raw), grid = record(r.grid), symbols = record(r.symbols), elements = record(r.elements);
  const columns = num(grid.columns, 3, 8, 5), rows = num(grid.rows, 2, 6, 3);
  const preset = GRID_PRESETS.find((p) => p.columns === columns && p.rows === rows)?.id ?? "custom";
  const specials = Array.isArray(symbols.specials) ? symbols.specials : d.symbols.specials;
  const buttons = Array.isArray(elements.buttons) ? elements.buttons : d.elements.buttons;
  const artwork: ImportedArtwork[] = [];
  if (Array.isArray(r.artwork)) r.artwork.slice(0, MAX_ARTWORK).forEach((rawImage, i) => {
    const img = image(rawImage, `import-${i + 1}`);
    if (img) artwork.push({ ...img, elementType: oneOf(record(rawImage).elementType, ELEMENT_TYPE_IDS, "other_asset") });
  });
  return {
    schema: 1, title: str(r.title, "", 80), theme: str(r.theme, "", 80),
    folderPath: str(r.folderPath, "", 200), styleGuide: str(r.styleGuide), description: str(r.description),
    stylePreset: oneOf(r.stylePreset, STYLE_PRESETS.map((p) => p.id), d.stylePreset),
    grid: { preset: grid.preset === "custom" ? "custom" : preset, columns, rows },
    evaluation: oneOf(r.evaluation, ["lines", "ways", "cluster"] as const, d.evaluation),
    paylineCount: num(r.paylineCount, 1, Math.min(100, maxPaylines(columns, rows)), d.paylineCount),
    rtpTarget: Math.round(num(r.rtpTarget, 80, 99, 96, false) * 10) / 10,
    volatility: oneOf(r.volatility, ["low", "medium", "high", "extreme"] as const, d.volatility),
    status: oneOf(r.status, ["draft", "blueprint", "math", "prototype", "team_review", "released"] as const, d.status),
    symbols: {
      royals: num(symbols.royals, 0, 6, d.symbols.royals),
      medium: num(symbols.medium, 0, 6, d.symbols.medium), high: num(symbols.high, 0, 6, d.symbols.high),
      specials: SPECIAL_KINDS.filter((k) => specials.includes(k)),
    },
    elements: {
      gameTitle: typeof elements.gameTitle === "boolean" ? elements.gameTitle : d.elements.gameTitle,
      backgrounds: num(elements.backgrounds, 0, 3, 1), reelFrames: num(elements.reelFrames, 0, 2, 1),
      aspect: oneOf(elements.aspect, ASPECTS.map((a) => a.id), d.elements.aspect),
      frameStyle: oneOf(elements.frameStyle, FRAME_STYLES.map((f) => f.id), d.elements.frameStyle),
      buttons: ["spin", ...BUTTONS.map((b) => b.id).filter((b) => b !== "spin" && buttons.includes(b))],
    },
    referenceImage: image(r.referenceImage, "reference-image"), artwork,
  };
}

/** Changes special count without unexpectedly changing the selected behaviours. */
export function specialsForCount(current: SpecialKind[], count: number): SpecialKind[] {
  const ordered = [...current, ...SPECIAL_KINDS.filter((kind) => !current.includes(kind))];
  return ordered.slice(0, Math.max(0, Math.min(3, count)));
}
export function normalizeFolderPath(path: string): string {
  return path.split("/").map((s) => s.trim()).filter(Boolean).join("/");
}
export function totalSymbols(draft: NewGameDraft) {
  return draft.symbols.royals + draft.symbols.medium + draft.symbols.high + draft.symbols.specials.length;
}

export interface DraftValidation {
  errors: Partial<Record<"title" | "theme" | "grid" | "paylines" | "rtp" | "symbols" | "folder" | "artwork", string>>;
  warnings: string[];
}
export function validateDraft(draft: NewGameDraft): DraftValidation {
  const errors: DraftValidation["errors"] = {}, warnings: string[] = [];
  if (!draft.title.trim()) errors.title = "Give your game a title.";
  if (!draft.theme.trim()) errors.theme = "Add a theme or choose a starting point.";
  const { columns, rows } = draft.grid;
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 3 || columns > 8 || rows < 2 || rows > 6)
    errors.grid = "Use 3–8 reels and 2–6 rows.";
  if (!Number.isFinite(draft.rtpTarget) || draft.rtpTarget < 80 || draft.rtpTarget > 99) errors.rtp = "RTP target must be 80–99%.";
  if (draft.evaluation === "lines" && (!Number.isInteger(draft.paylineCount) || draft.paylineCount < 1 || draft.paylineCount > Math.min(100, maxPaylines(columns, rows))))
    errors.paylines = "Choose a supported number of paylines.";
  if (totalSymbols(draft) === 0) errors.symbols = "Add at least one symbol.";
  if ([draft.symbols.high, draft.symbols.medium, draft.symbols.royals].some((n) => !Number.isInteger(n) || n < 0 || n > 6))
    errors.symbols = "Each symbol tier supports 0–6 symbols.";
  const segments = draft.folderPath.split("/").map((s) => s.trim()).filter(Boolean);
  if (segments.some((s) => s.length > 48 || s === "." || s === "..") || /[\\\u0000-\u001f]/.test(draft.folderPath))
    errors.folder = "Use folder names of up to 48 characters, separated by /.";
  const bytes = draft.artwork.reduce((sum, art) => sum + art.bytes, 0) + (draft.referenceImage?.bytes ?? 0);
  if (bytes > MAX_PROJECT_ART_BYTES) errors.artwork = "Combined artwork must be under 24 MB. Remove a file and try again.";
  if (draft.artwork.length > MAX_ARTWORK) errors.artwork = `A project supports up to ${MAX_ARTWORK} artwork files.`;
  if (draft.symbols.high === 0) warnings.push("No high-paying symbols are planned.");
  if (!draft.symbols.specials.length) warnings.push("No special symbols; no free-spin or bonus triggers are planned.");
  if (!draft.elements.backgrounds && !draft.artwork.some((a) => a.elementType === "game_background"))
    warnings.push("No background is planned. You can add one in a later phase.");
  return { errors, warnings };
}

/** Reject malformed submissions before forgiving normalization can discard data. */
export function creationInputIssues(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return ["A project draft must be an object."];
  const r = record(raw), issues: string[] = [];
  const numeric = (value: unknown, label: string, min: number, max: number, integer = true) => {
    if (value === undefined) return;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value)))
      issues.push(`${label} must be ${min}–${max}${integer ? " (whole numbers)" : ""}.`);
  };
  for (const [key, max] of [["title", 80], ["theme", 80], ["folderPath", 200], ["styleGuide", 800], ["description", 800]] as const)
    if (r[key] !== undefined && (typeof r[key] !== "string" || (r[key] as string).length > max)) issues.push(`${key} must be text of up to ${max} characters.`);
  for (const key of ["grid", "symbols", "elements"] as const)
    if (r[key] !== undefined && (!r[key] || typeof r[key] !== "object" || Array.isArray(r[key]))) issues.push(`${key} must be an object.`);
  const grid = record(r.grid), symbols = record(r.symbols), elements = record(r.elements);
  const choice = (value: unknown, options: readonly string[], label: string) => {
    if (value !== undefined && (typeof value !== "string" || !options.includes(value))) issues.push(`${label} is not supported.`);
  };
  choice(r.stylePreset, STYLE_PRESETS.map((p) => p.id), "Visual style");
  choice(r.evaluation, ["lines", "ways", "cluster"], "Evaluation");
  choice(r.volatility, ["low", "medium", "high", "extreme"], "Volatility");
  choice(r.status, ["draft", "blueprint", "math", "prototype", "team_review", "released"], "Status");
  choice(grid.preset, [...GRID_PRESETS.map((p) => p.id), "custom"], "Grid preset");
  choice(elements.aspect, ASPECTS.map((a) => a.id), "Canvas aspect");
  choice(elements.frameStyle, FRAME_STYLES.map((f) => f.id), "Frame style");
  if (elements.gameTitle !== undefined && typeof elements.gameTitle !== "boolean") issues.push("Game title inclusion must be a boolean.");
  numeric(grid.columns, "Reels", 3, 8); numeric(grid.rows, "Rows", 2, 6);
  numeric(r.paylineCount, "Paylines", 1, 100); numeric(r.rtpTarget, "RTP target", 80, 99, false);
  for (const key of ["royals", "medium", "high"] as const) numeric(symbols[key], `${key} symbols`, 0, 6);
  numeric(elements.backgrounds, "Backgrounds", 0, 3); numeric(elements.reelFrames, "Reel frames", 0, 2);
  if (symbols.specials !== undefined && (!Array.isArray(symbols.specials) || symbols.specials.some((s) => !SPECIAL_KINDS.includes(s as SpecialKind)) || new Set(symbols.specials).size !== symbols.specials.length))
    issues.push("Special symbols must be a unique selection of Wild, Scatter and Bonus.");
  if (elements.buttons !== undefined && (!Array.isArray(elements.buttons) || elements.buttons.some((b) => !BUTTONS.some((option) => option.id === b))))
    issues.push("Button set contains an unsupported control.");
  if (r.artwork !== undefined && (!Array.isArray(r.artwork) || r.artwork.length > MAX_ARTWORK)) issues.push(`Import no more than ${MAX_ARTWORK} artwork files.`);
  const inspect = (rawImage: unknown, label: string) => {
    const v = record(rawImage);
    const info = typeof v.dataUrl === "string" ? inlineImageInfo(v.dataUrl) : null;
    if (!info || info.bytes === 0) { issues.push(`${label} must be a PNG, JPEG or WebP image.`); return; }
    if (info.bytes > MAX_STORED_BYTES) issues.push(`${label} exceeds the 3 MB stored-image limit.`);
    if (v.mime !== undefined && v.mime !== info.mime) issues.push(`${label} has a mismatched image type.`);
    numeric(v.width, `${label} width`, 1, 20000); numeric(v.height, `${label} height`, 1, 20000);
  };
  if (r.referenceImage !== undefined && r.referenceImage !== null) inspect(r.referenceImage, "Reference image");
  if (Array.isArray(r.artwork)) r.artwork.forEach((art, i) => {
    inspect(art, `Artwork ${i + 1}`);
    if (!ELEMENT_TYPE_IDS.includes(record(art).elementType as ElementType)) issues.push(`Artwork ${i + 1} needs a supported element type.`);
  });
  return issues;
}
