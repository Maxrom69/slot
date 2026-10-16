import type {
  AnimationConfiguration,
  Asset,
  ExportConfiguration,
  FeatureConfiguration,
  GameBlueprint,
  GridConfiguration,
  PaylineConfiguration,
  PaytableConfiguration,
  ProjectMetadata,
  ReelConfiguration,
  Scene,
  StandaloneElement,
  StyleGuideConfig,
  SymbolSet,
  ThemeConfiguration,
} from "./types";

export function getProjectMetadata(bp: GameBlueprint): ProjectMetadata {
  return bp.meta;
}

export function getThemeConfiguration(bp: GameBlueprint): ThemeConfiguration {
  return bp.style;
}

export function getStyleGuide(bp: GameBlueprint): StyleGuideConfig {
  return {
    name: bp.style.paletteName,
    description: bp.meta.styleGuide || bp.style.artDirection,
    mood: bp.style.mood,
    artDirection: bp.style.artDirection,
    palette: bp.style.palette,
    typography: bp.style.typography,
  };
}

export function getGridConfiguration(bp: GameBlueprint): GridConfiguration {
  if (bp.grid) return bp.grid;
  const { columns, rows, evaluation } = bp.reels;
  const presetKey = `${columns}x${rows}`;
  const preset =
    presetKey === "5x3" || presetKey === "5x4" || presetKey === "6x3" || presetKey === "6x4"
      ? presetKey
      : "custom";
  return {
    columns,
    rows,
    preset: bp.creation?.gridPreset ?? preset,
    evaluation,
  };
}

export function getSymbolSets(bp: GameBlueprint): SymbolSet[] {
  return bp.symbolSets;
}

export function getStandaloneElements(bp: GameBlueprint): StandaloneElement[] {
  return bp.elements.filter((el) => el.type !== "symbol_set");
}

export function getAssets(bp: GameBlueprint): Asset[] {
  return bp.assets;
}

export function getScenes(bp: GameBlueprint): Scene[] {
  return bp.scenes;
}

export function getReelConfiguration(bp: GameBlueprint): ReelConfiguration {
  return bp.reelConfiguration ?? bp.reels;
}

export function getPaylineConfiguration(bp: GameBlueprint): PaylineConfiguration {
  if (bp.paylineConfiguration) {
    return bp.paylineConfiguration;
  }
  return {
    columns: bp.reels.columns,
    rows: bp.reels.rows,
    evaluation: bp.reels.evaluation,
    paylines: bp.paylines,
    requestedCount: bp.creation?.requestedPaylineCount ?? bp.paylines.length,
  };
}

export function getPaytableConfiguration(bp: GameBlueprint): PaytableConfiguration {
  if (bp.paytableConfiguration) {
    return bp.paytableConfiguration;
  }
  return {
    entries: bp.paytable,
  };
}

export function getFeatureConfigurations(bp: GameBlueprint): FeatureConfiguration[] {
  return bp.features;
}

export function getAnimationConfigurations(bp: GameBlueprint): AnimationConfiguration[] {
  return bp.animations;
}

export function getExportConfiguration(bp: GameBlueprint): ExportConfiguration {
  return bp.exportConfig;
}
