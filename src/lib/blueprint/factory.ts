import { deriveElements } from "./elements";
import { glyphsForTheme, paletteForTheme } from "./palette";
import {
  BLUEPRINT_VERSION,
  DEFAULT_SYMBOL_PLAN,
  type GameBlueprint,
  type PaylineDef,
  type PaytableEntry,
  type ProjectStatus,
  type SpecialSymbolDef,
  type SymbolDef,
  type SymbolPlan,
  type SymbolSetType,
  type ValueTier,
  type Volatility,
} from "./types";

export interface BlueprintInput {
  id: string;
  title: string;
  description?: string;
  theme: string;
  styleGuide?: string;
  status?: ProjectStatus;
  columns?: number;
  rows?: number;
  paylineCount?: number;
  rtpTarget?: number;
  volatility?: Volatility;
  evaluation?: "lines" | "ways" | "cluster";
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  symbolPlan?: SymbolPlan;
  canvas?: {
    width: number;
    height: number;
    orientation: "landscape" | "portrait" | "responsive";
  };
  /** Optional pre-rendered art, keyed by symbol code -> static URI. */
  symbolArt?: Record<string, string>;
}

export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "untitled-game"
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Maximum number of distinct payline patterns a grid can hold. */
export function maxPaylines(columns: number, rows: number): number {
  return Math.min(1000, Math.pow(rows, columns));
}

/**
 * Deterministic payline patterns for an arbitrary grid.
 * Always returns min(count, distinct patterns possible) lines.
 */
export function generatePaylines(
  columns: number,
  rows: number,
  count: number,
): PaylineDef[] {
  const target = Math.max(0, Math.min(count, maxPaylines(columns, rows)));
  const patterns: number[][] = [];
  const seen = new Set<string>();
  const push = (pattern: number[]) => {
    const key = pattern.join(",");
    if (seen.has(key)) return;
    seen.add(key);
    patterns.push(pattern);
  };

  // straight lines
  for (let r = 0; r < rows; r += 1) push(new Array(columns).fill(r));
  // V shapes
  for (let r = 0; r < rows; r += 1) {
    push(
      Array.from({ length: columns }, (_, c) => {
        const mid = (columns - 1) / 2;
        const depth = Math.round((rows - 1) * (Math.abs(c - mid) / Math.max(mid, 1)));
        return clamp(r === 0 ? depth : r - depth, 0, rows - 1);
      }),
    );
  }
  // zig-zags of varying period
  for (let period = 1; period <= 3; period += 1) {
    for (let r = 0; r < rows; r += 1) {
      push(
        Array.from({ length: columns }, (_, c) =>
          clamp(r + (Math.floor(c / period) % 2 === 0 ? 0 : 1), 0, rows - 1),
        ),
      );
      push(
        Array.from({ length: columns }, (_, c) =>
          clamp(r - (Math.floor(c / period) % 2 === 0 ? 0 : 1), 0, rows - 1),
        ),
      );
    }
  }
  // diagonal sweeps
  for (let r = 0; r < rows; r += 1) {
    push(Array.from({ length: columns }, (_, c) => clamp(r + c, 0, rows - 1)));
    push(Array.from({ length: columns }, (_, c) => clamp(r - c, 0, rows - 1)));
  }

  // seeded random walks (deterministic) to fill larger counts
  if (patterns.length < target) {
    let seed = 1234567 + columns * 31 + rows * 17;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let attempts = 0;
    while (patterns.length < target && attempts < 4000) {
      attempts += 1;
      let row = Math.floor(rand() * rows);
      const pattern = [row];
      for (let c = 1; c < columns; c += 1) {
        row = clamp(row + Math.floor(rand() * 3) - 1, 0, rows - 1);
        pattern.push(row);
      }
      push(pattern);
    }
  }

  // guaranteed fallback: enumerate patterns in base-`rows`
  if (patterns.length < target) {
    const total = Math.pow(rows, columns);
    for (let n = 0; n < total && patterns.length < target; n += 1) {
      let value = n;
      const pattern: number[] = [];
      for (let c = 0; c < columns; c += 1) {
        pattern.push(value % rows);
        value = Math.floor(value / rows);
      }
      push(pattern);
    }
  }

  return patterns.slice(0, target).map((pattern, index) => ({
    id: `line-${index + 1}`,
    index: index + 1,
    pattern,
    active: true,
  }));
}

export const ROYAL_CODES = ["A", "K", "Q", "J", "10", "9"];

/** Starter payout/weight configuration per tier (declarative; not engine math). */
export function defaultSymbolStats(
  tier: "low" | "mid" | "high" | "special",
  i: number,
): { payouts: Record<string, number>; reelWeight: number } {
  if (tier === "low")
    return { payouts: { "3": 2 + i * 0.5, "4": 5 + i, "5": 15 + i * 3 }, reelWeight: Math.max(4, 14 - i) };
  if (tier === "mid")
    return { payouts: { "3": 6 + i * 2, "4": 20 + i * 5, "5": 60 + i * 15 }, reelWeight: Math.max(3, 9 - i) };
  return { payouts: { "3": 15 + i * 5, "4": 50 + i * 20, "5": 150 + i * 75 }, reelWeight: Math.max(2, 6 - i) };
}

const SPECIAL_DEFS = {
  wild: {
    id: "sym-wild",
    code: "WILD",
    name: "Wild",
    glyph: "🃏",
    payouts: { "3": 25, "4": 100, "5": 500 },
    weight: 3,
    params: { substitutesScatter: false, multiplier: 1 } as SpecialSymbolDef["params"],
  },
  scatter: {
    id: "sym-scatter",
    code: "SCAT",
    name: "Scatter",
    glyph: "✴️",
    payouts: { "3": 5, "4": 20, "5": 100 },
    weight: 2,
    params: { triggerCount: 3, awardsFreeSpins: 10 } as SpecialSymbolDef["params"],
  },
  bonus: {
    id: "sym-bonus",
    code: "BONUS",
    name: "Bonus",
    glyph: "🎁",
    payouts: { "3": 10, "4": 40, "5": 200 },
    weight: 2,
    params: { triggerCount: 3, feature: "pick_bonus" } as SpecialSymbolDef["params"],
  },
} as const;

function buildSymbols(theme: string, plan: SymbolPlan, art?: Record<string, string>): SymbolDef[] {
  const glyphs = glyphsForTheme(theme);
  const symbols: SymbolDef[] = [];
  const artId = (code: string) => (art && art[code] ? `symart-${slugify(code)}` : null);

  for (let i = 0; i < plan.royals; i += 1) {
    const code = ROYAL_CODES[i];
    symbols.push({
      id: `sym-low-${code.toLowerCase()}`,
      code,
      name: `Royal ${code}`,
      tier: "low",
      glyph: code,
      assetId: artId(code),
      ...defaultSymbolStats("low", i),
    });
  }

  for (let i = 0; i < plan.medium; i += 1) {
    symbols.push({
      id: `sym-mid-${i + 1}`,
      code: `M${i + 1}`,
      name: `Mid Symbol ${i + 1}`,
      tier: "mid",
      glyph: glyphs[i % glyphs.length],
      assetId: artId(`M${i + 1}`),
      ...defaultSymbolStats("mid", i),
    });
  }

  for (let i = 0; i < plan.high; i += 1) {
    symbols.push({
      id: `sym-high-${i + 1}`,
      code: `H${i + 1}`,
      name: `High Symbol ${i + 1}`,
      tier: "high",
      glyph: glyphs[(plan.medium + i) % glyphs.length],
      assetId: artId(`H${i + 1}`),
      ...defaultSymbolStats("high", i),
    });
  }

  plan.specials.forEach((behaviour) => {
    const def = SPECIAL_DEFS[behaviour];
    symbols.push({
      id: def.id,
      code: def.code,
      name: def.name,
      tier: "special",
      glyph: def.glyph,
      assetId: artId(def.code),
      payouts: { ...def.payouts },
      reelWeight: def.weight,
      isWild: behaviour === "wild",
      isScatter: behaviour === "scatter",
      isBonus: behaviour === "bonus",
    });
  });

  return symbols;
}

export function buildStrips(symbols: SymbolDef[], columns: number): string[][] {
  const pool: string[] = [];
  symbols.forEach((symbol) => {
    for (let i = 0; i < symbol.reelWeight; i += 1) pool.push(symbol.id);
  });
  if (pool.length === 0) return Array.from({ length: columns }, () => []);
  return Array.from({ length: columns }, (_, c) =>
    pool.map((_, i) => pool[(i + c * 3) % pool.length]),
  );
}

export function buildPaytable(symbols: SymbolDef[]): PaytableEntry[] {
  const entries: PaytableEntry[] = [];
  symbols.forEach((symbol) => {
    Object.entries(symbol.payouts).forEach(([ofAKind, payout]) => {
      entries.push({ symbolId: symbol.id, ofAKind: Number(ofAKind), payout });
    });
  });
  return entries;
}

export function createBlueprint(input: BlueprintInput): GameBlueprint {
  const now = input.updatedAt ?? new Date().toISOString();
  const createdAt = input.createdAt ?? now;
  const columns = input.columns ?? 5;
  const rows = input.rows ?? 3;
  const evaluation = input.evaluation ?? "lines";
  const plan = input.symbolPlan ?? DEFAULT_SYMBOL_PLAN;
  const paylineCount = evaluation === "lines" ? (input.paylineCount ?? 20) : 0;
  const palette = paletteForTheme(input.theme || input.title);
  const symbols = buildSymbols(input.theme || input.title, plan, input.symbolArt);
  const hasScatter = plan.specials.includes("scatter");
  const hasBonus = plan.specials.includes("bonus");

  const symbolSets: GameBlueprint["symbolSets"] = [];
  const addSet = (
    id: string,
    name: string,
    description: string,
    tier: SymbolDef["tier"],
    symbolType: SymbolSetType,
    valueTier: ValueTier,
  ) => {
    const symbolIds = symbols.filter((s) => s.tier === tier).map((s) => s.id);
    if (symbolIds.length) symbolSets.push({ id, name, description, symbolIds, symbolType, valueTier });
  };
  addSet("set-royals", "Royals", "Low paying card ranks", "low", "royals", "low");
  addSet("set-medium", "Medium Symbols", "Theme-driven mid payers", "mid", "custom", "medium");
  addSet("set-high", "High Symbols", "Theme-driven premium payers", "high", "custom", "high");

  const specialSymbols: SpecialSymbolDef[] = plan.specials.map((behaviour) => ({
    id: `special-${behaviour}`,
    symbolId: SPECIAL_DEFS[behaviour].id,
    behaviour,
    params: { ...SPECIAL_DEFS[behaviour].params },
  }));

  const symbolArtAssets: GameBlueprint["assets"] = Object.entries(input.symbolArt ?? {}).map(
    ([code, uri]) => ({
      id: `symart-${slugify(code)}`,
      name: code,
      kind: "image" as const,
      uri,
      state: "linked" as const,
      tags: ["symbol", "symbol-art"],
    }),
  );
  const assets: GameBlueprint["assets"] = [
    ...symbolArtAssets,
    { id: "asset-bg", name: "Base background", kind: "image", uri: null, state: "placeholder", tags: ["background"] },
    { id: "asset-frame", name: "Reel frame", kind: "image", uri: null, state: "placeholder", tags: ["frame"] },
    { id: "asset-logo", name: "Game logo", kind: "image", uri: null, state: "placeholder", tags: ["logo"] },
    { id: "asset-spin-sfx", name: "Spin SFX", kind: "audio", uri: null, state: "placeholder", tags: ["sfx"] },
  ];

  const features: GameBlueprint["features"] = [
    {
      id: "feature-free-spins",
      name: "Free Spins",
      kind: "free_spins",
      enabled: hasScatter,
      params: { spins: 10, retrigger: true, multiplier: 2 },
    },
    {
      id: "feature-hold-and-win",
      name: "Hold & Win",
      kind: "hold_and_win",
      enabled: false,
      params: { respins: 3, grid: `${columns}x${rows}` },
    },
  ];
  if (hasBonus) {
    features.push({
      id: "feature-pick-bonus",
      name: "Pick Bonus",
      kind: "pick_bonus",
      enabled: true,
      params: { picks: 3 },
    });
  }

  return {
    version: BLUEPRINT_VERSION,
    meta: {
      id: input.id,
      title: input.title,
      slug: slugify(input.title),
      description: input.description ?? "",
      status: input.status ?? "draft",
      theme: input.theme,
      styleGuide: input.styleGuide ?? "",
      tags: input.tags ?? [],
      studio: "Local workspace",
      createdAt,
      updatedAt: now,
      schemaVersion: BLUEPRINT_VERSION,
    },
    style: {
      paletteName: palette.name,
      palette: {
        background: palette.background,
        surface: palette.surface,
        accent: palette.accent,
        accentAlt: palette.accentAlt,
        glow: palette.glow,
        text: palette.text,
      },
      mood: input.styleGuide || "Premium, cinematic, high-contrast",
      artDirection: `${input.theme || "Original"} — ${palette.name}`,
      typography: { display: "Display Grotesk", body: "Inter" },
      referenceAssetId: null,
    },
    symbols,
    symbolSets,
    specialSymbols,
    assets,
    elements: deriveElements({ symbols, symbolSets, specialSymbols, assets }),
    layers: [
      { id: "layer-bg", name: "Background", kind: "background", type: "background", order: 0, visible: true, locked: true, opacity: 1, blendMode: "normal" },
      { id: "layer-reels", name: "Reels", kind: "reels", type: "reels", order: 1, visible: true, locked: false, opacity: 1, blendMode: "normal" },
      { id: "layer-frame", name: "Frame", kind: "frame", type: "frame", order: 2, visible: true, locked: false, opacity: 1, blendMode: "normal" },
      { id: "layer-ui", name: "UI", kind: "ui", type: "ui", order: 3, visible: true, locked: false, opacity: 1, blendMode: "normal" },
      { id: "layer-fx", name: "FX", kind: "fx", type: "fx", order: 4, visible: true, locked: false, opacity: 1, blendMode: "normal" },
    ],
    canvas: {
      width: input.canvas?.width ?? 1920,
      height: input.canvas?.height ?? 1080,
      safeArea: { top: 64, right: 96, bottom: 96, left: 96 },
      orientation: input.canvas?.orientation ?? "landscape",
      backgroundAssetId: "asset-bg",
    },
    scenes: [
      { id: "scene-base", name: "Base game", kind: "base", layerIds: ["layer-bg", "layer-reels", "layer-frame", "layer-ui"], entryTransition: "fade" },
      { id: "scene-free", name: "Free spins", kind: "freespins", layerIds: ["layer-bg", "layer-reels", "layer-fx"], entryTransition: "wipe" },
    ],
    reels: {
      columns,
      rows,
      evaluation,
      strips: buildStrips(symbols, columns),
      spinDirection: "down",
    },
    paylines: generatePaylines(columns, rows, paylineCount),
    paytable: buildPaytable(symbols),
    features,
    animations: [
      { id: "anim-spin", target: "layer-reels", trigger: "spin_start", kind: "reel_spin", durationMs: 600, easing: "easeInOutCubic" },
      { id: "anim-win", target: "layer-fx", trigger: "win", kind: "symbol_pulse", durationMs: 900, easing: "easeOutBack" },
      { id: "anim-bigwin", target: "layer-fx", trigger: "big_win", kind: "coin_burst", durationMs: 2400, easing: "linear" },
    ],
    math: {
      rtpTarget: input.rtpTarget ?? 96,
      volatility: input.volatility ?? "medium",
      maxWinX: 5000,
      betLevels: [0.2, 0.5, 1, 2, 5, 10, 25, 50],
      hitFrequency: 0.28,
    },
    exportConfig: {
      format: "blueprint-json",
      engineTarget: "section2-engine",
      includeAssets: false,
      minify: false,
    },
    extensions: {},
  };
}
