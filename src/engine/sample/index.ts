/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — Minimal Deterministic Sample Game Configuration
 *
 * Provides a compact 5x3 GameBlueprint fixture for testing the engine
 * architecture, adapter, validation, determinism, and serialization.
 */

import {
  BLUEPRINT_VERSION,
  type GameBlueprint,
  type PaylineDef,
  type PaytableEntry,
  type SymbolDef,
} from "@/lib/blueprint/types";

export const SAMPLE_GAME_ID = "sample-b01-5x3" as const;

export function createSampleGameBlueprint(): GameBlueprint {
  const symbols: SymbolDef[] = [
    {
      id: "sym-low-a",
      code: "A",
      name: "Ace",
      tier: "low",
      glyph: "A",
      assetId: null,
      payouts: { "3": 2, "4": 5, "5": 15 },
      reelWeight: 4,
    },
    {
      id: "sym-low-k",
      code: "K",
      name: "King",
      tier: "low",
      glyph: "K",
      assetId: null,
      payouts: { "3": 3, "4": 8, "5": 20 },
      reelWeight: 3,
    },
    {
      id: "sym-low-q",
      code: "Q",
      name: "Queen",
      tier: "low",
      glyph: "Q",
      assetId: null,
      payouts: { "3": 4, "4": 10, "5": 25 },
      reelWeight: 3,
    },
    {
      id: "sym-high-star",
      code: "STAR",
      name: "Golden Star",
      tier: "high",
      glyph: "★",
      assetId: null,
      payouts: { "3": 10, "4": 30, "5": 100 },
      reelWeight: 2,
    },
    {
      id: "sym-wild",
      code: "WILD",
      name: "Wild Joker",
      tier: "special",
      glyph: "W",
      assetId: null,
      payouts: { "3": 20, "4": 60, "5": 200 },
      reelWeight: 1,
      isWild: true,
    },
    {
      id: "sym-scatter",
      code: "SCAT",
      name: "Scatter Gem",
      tier: "special",
      glyph: "S",
      assetId: null,
      payouts: { "3": 5, "4": 15, "5": 50 },
      reelWeight: 1,
      isScatter: true,
    },
  ];

  // Compact 6-stop strips per reel for deterministic testing
  const strips: string[][] = [
    ["sym-low-a", "sym-low-k", "sym-low-q", "sym-high-star", "sym-wild", "sym-scatter"],
    ["sym-low-a", "sym-low-k", "sym-low-q", "sym-high-star", "sym-wild", "sym-scatter"],
    ["sym-low-a", "sym-low-k", "sym-low-q", "sym-high-star", "sym-wild", "sym-scatter"],
    ["sym-low-k", "sym-low-q", "sym-high-star", "sym-low-a", "sym-wild", "sym-scatter"],
    ["sym-low-q", "sym-high-star", "sym-low-a", "sym-low-k", "sym-wild", "sym-scatter"],
  ];

  const paylines: PaylineDef[] = [
    { id: "line-1", index: 1, name: "Middle Row", pattern: [1, 1, 1, 1, 1], active: true },
    { id: "line-2", index: 2, name: "Top Row", pattern: [0, 0, 0, 0, 0], active: true },
    { id: "line-3", index: 3, name: "Bottom Row", pattern: [2, 2, 2, 2, 2], active: true },
    { id: "line-4", index: 4, name: "V Shape", pattern: [0, 1, 2, 1, 0], active: true },
    { id: "line-5", index: 5, name: "Inverted V", pattern: [2, 1, 0, 1, 2], active: true },
  ];

  const paytable: PaytableEntry[] = [];
  for (const sym of symbols) {
    for (const [ofAKind, payout] of Object.entries(sym.payouts)) {
      paytable.push({
        symbolId: sym.id,
        ofAKind: Number(ofAKind),
        payout,
      });
    }
  }

  return {
    version: BLUEPRINT_VERSION,
    meta: {
      id: SAMPLE_GAME_ID,
      title: "B01 Architectural Sample 5x3",
      slug: "b01-architectural-sample-5x3",
      description: "Minimal deterministic 5x3 slot game configuration for B01 engine architecture tests.",
      status: "blueprint",
      theme: "Classic Geometric",
      styleGuide: "Minimal Dark",
      tags: ["b01", "sample", "5x3"],
      studio: "Slot Studio Engine QA",
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
      schemaVersion: BLUEPRINT_VERSION,
    },
    style: {
      paletteName: "Obsidian Gold",
      palette: {
        background: "#0b0d14",
        surface: "#141824",
        accent: "#f5b041",
        accentAlt: "#5dade2",
        glow: "#f8c471",
        text: "#f2f4f8",
      },
      mood: "Clean",
      artDirection: "Geometric",
      typography: { display: "Inter", body: "Inter" },
      referenceAssetId: null,
    },
    symbols,
    symbolSets: [
      {
        id: "set-low",
        name: "Low Royals",
        description: "Low-tier card ranks",
        symbolIds: ["sym-low-a", "sym-low-k", "sym-low-q"],
        symbolType: "royals",
        valueTier: "low",
      },
      {
        id: "set-high",
        name: "High Symbols",
        description: "High-tier star symbol",
        symbolIds: ["sym-high-star"],
        symbolType: "custom",
        valueTier: "high",
      },
    ],
    specialSymbols: [
      {
        id: "special-wild",
        symbolId: "sym-wild",
        behaviour: "wild",
        params: { substitutesScatter: false, multiplier: 1 },
      },
      {
        id: "special-scatter",
        symbolId: "sym-scatter",
        behaviour: "scatter",
        params: { triggerCount: 3, awardsFreeSpins: 10 },
      },
    ],
    assets: [],
    elements: [],
    layers: [
      {
        id: "layer-reels",
        name: "Reels",
        kind: "reels",
        order: 0,
        visible: true,
        locked: false,
        opacity: 1,
      },
    ],
    canvas: {
      width: 1920,
      height: 1080,
      safeArea: { top: 64, right: 96, bottom: 96, left: 96 },
      orientation: "landscape",
      backgroundAssetId: null,
    },
    scenes: [
      {
        id: "scene-base",
        name: "Base Game",
        kind: "base",
        layerIds: ["layer-reels"],
        entryTransition: "fade",
      },
    ],
    reels: {
      columns: 5,
      rows: 3,
      evaluation: "lines",
      strips,
      spinDirection: "down",
    },
    paylines,
    paytable,
    features: [
      {
        id: "feature-free-spins",
        name: "Free Spins",
        kind: "free_spins",
        enabled: true,
        params: { spins: 10, retrigger: true, multiplier: 2, triggerCount: 3 },
      },
    ],
    animations: [],
    math: {
      rtpTarget: 96,
      volatility: "medium",
      maxWinX: 2500,
      betLevels: [0.2, 0.5, 1, 2, 5, 10],
      hitFrequency: 0.25,
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
