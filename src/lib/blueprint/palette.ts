import type { StylePalette } from "./types";

/** Deterministic string hash — same theme always yields the same look. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export interface NamedPalette extends StylePalette {
  name: string;
}

export const PALETTES: NamedPalette[] = [
  {
    name: "Imperial Gold",
    background: "#140d06",
    surface: "#241707",
    accent: "#f0b429",
    accentAlt: "#e0590d",
    glow: "#ffd97a",
    text: "#f8ecd7",
  },
  {
    name: "Jungle Relic",
    background: "#05140f",
    surface: "#0b241a",
    accent: "#34d399",
    accentAlt: "#0d9488",
    glow: "#a7f3d0",
    text: "#e4fbf1",
  },
  {
    name: "Neon Arcade",
    background: "#0a0618",
    surface: "#170d2e",
    accent: "#a855f7",
    accentAlt: "#22d3ee",
    glow: "#f0abfc",
    text: "#f1e9ff",
  },
  {
    name: "Deep Abyss",
    background: "#03101a",
    surface: "#06202f",
    accent: "#38bdf8",
    accentAlt: "#2563eb",
    glow: "#bae6fd",
    text: "#e2f4ff",
  },
  {
    name: "Blossom Spring",
    background: "#15080f",
    surface: "#2a0f1d",
    accent: "#fb7185",
    accentAlt: "#f59e0b",
    glow: "#fecdd3",
    text: "#ffeaf0",
  },
  {
    name: "Frost Vault",
    background: "#070d14",
    surface: "#101c2a",
    accent: "#7dd3fc",
    accentAlt: "#c4b5fd",
    glow: "#e0f2fe",
    text: "#eaf4ff",
  },
];

export function paletteForTheme(theme: string): NamedPalette {
  if (!theme.trim()) return PALETTES[0];
  return PALETTES[hashString(theme.toLowerCase()) % PALETTES.length];
}

const GLYPH_POOLS: string[][] = [
  ["🦅", "🏛️", "⚔️", "🛡️", "🏺", "👑", "📜", "🪙"],
  ["🗿", "🐍", "💎", "🗝️", "🧭", "🪬", "🏆", "🔥"],
  ["🍒", "🔔", "⭐", "💠", "🎰", "7️⃣", "🍋", "🍀"],
  ["🐙", "🔱", "🐚", "🧜", "🦈", "🪸", "💧", "🗺️"],
  ["🌸", "🐰", "🥕", "🦋", "🌼", "🍓", "🥚", "🐥"],
  ["❄️", "🐺", "🪓", "🛷", "🧊", "🌲", "🦌", "🔮"],
];

export function glyphsForTheme(theme: string): string[] {
  if (!theme.trim()) return GLYPH_POOLS[0];
  return GLYPH_POOLS[hashString(theme.toLowerCase()) % GLYPH_POOLS.length];
}
