/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * Game Blueprint typed model.
 *
 * The Game Blueprint is the single source of truth of the studio.
 * It is purely declarative data: no rendering, no engine logic.
 * SECTION 2 (backend slot engine) will consume this structure.
 */

export const BLUEPRINT_VERSION = 1 as const;

export type ProjectStatus =
  | "draft"
  | "blueprint"
  | "math"
  | "prototype"
  | "team_review"
  | "released";

export type Volatility = "low" | "medium" | "high" | "extreme";

export interface ProjectMeta {
  id: string;
  title: string;
  slug: string;
  description: string;
  status: ProjectStatus;
  theme: string;
  styleGuide: string;
  tags: string[];
  studio: string;
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
  /** Organisation is included in exports, not just in the dashboard index. */
  folderPath?: string;
}

export interface StylePalette {
  background: string;
  surface: string;
  accent: string;
  accentAlt: string;
  glow: string;
  text: string;
}

export interface ThemeStyle {
  paletteName: string;
  palette: StylePalette;
  mood: string;
  artDirection: string;
  typography: { display: string; body: string };
  /** optional reference artwork (asset id) supplied at creation */
  referenceAssetId?: string | null;
}

export type SymbolTier = "low" | "mid" | "high" | "special";

/** Documented symbol set categories and the value tier a set is designed for.
 * Canonical F07 conceptual types: Characters (character), Deck Ranks (royals),
 * Suits (suits), Custom (custom). `seven` and `bar` are legacy classic types
 * kept for backward compatibility with existing blueprints. */
export type SymbolSetType = "character" | "royals" | "suits" | "seven" | "bar" | "custom";
/** Canonical symbol-type names used by the F07 element system. */
export type CanonicalSymbolType = "characters" | "ranks" | "suits" | "custom";
export type ValueTier = "low" | "medium" | "high" | "special";
export interface SymbolSetMeta {
  symbolType: SymbolSetType;
  valueTier: ValueTier;
  /** Optional frame element or asset referenced by this set. */
  frame?: AssetReference | null;
  /** Optional background element or asset referenced by this set. */
  background?: AssetReference | null;
  styleGuide?: string;
  description?: string;
  tags?: string[];
}

/**
 * Storage-agnostic image reference. The studio never binds itself to one
 * provider: `project` resolves through the project's own asset store,
 * `external` is a plain URL, and `placeholder` renders a deterministic stand-in.
 */
export interface AssetReference {
  provider: "project" | "external" | "placeholder";
  /** project asset id when provider is `project`. */
  assetId?: string | null;
  /** direct URL when provider is `external`. */
  uri?: string | null;
  /** human label, never used as an identifier. */
  name?: string;
}

/** A custom variant of a symbol. Always carries its own stable id. */
export interface SymbolVariant {
  id: string;
  name: string;
  image: AssetReference | null;
  extras: Record<string, number | string | boolean>;
  tags?: string[];
  description?: string;
}

/** One recorded version of a symbol's or element's image. Older revisions stay addressable forever. */
export interface ImageRevision {
  id: string;
  /** Storage-agnostic reference to that version's image. */
  asset: AssetReference | null;
  createdAt: string;
  /** How this version came to be. */
  source: "create" | "import" | "upload" | "duplicate" | "variant" | "restore";
  /** Human-readable revision label displayed in the F12 Image History timeline/grid. */
  label?: string;
  notes?: string;
}

/** Extensible free-form extra metadata. Not evaluated by the studio. */
export interface SymbolExtra {
  key: string;
  value: number | string | boolean;
}

export interface SymbolDef {
  id: string;
  code: string;
  name: string;
  tier: SymbolTier;
  glyph: string;
  assetId: string | null;
  /** payout multiplier keyed by "of a kind" count */
  payouts: Record<string, number>;
  reelWeight: number;
  /** Owning symbol set element id. Null for standalone symbols. */
  symbolSetId?: string | null;
  /** Conceptual symbol type (characters / ranks / suits / custom + legacy). */
  symbolType?: SymbolSetType;
  /** Symbol family groups. */
  family?: string;
  /** Storage-agnostic image reference. Mirrors assetId for project assets. */
  image?: AssetReference | null;
  /** Recorded image versions on this symbol, newest first. */
  imageHistory?: ImageRevision[];
  /** Independent custom variants, each with its own stable id. */
  variants?: SymbolVariant[];
  /** Free-form custom data. Never evaluated by the studio. */
  extras?: Record<string, number | string | boolean>;
  /** Opaque gameplay identifier consumed only by the SECTION 2 engine. */
  mathId?: string | null;
  /** Gameplay flags kept strictly as configuration. No payout evaluation here. */
  isWild?: boolean;
  isScatter?: boolean;
  isBonus?: boolean;
  description?: string;
  tags?: string[];
}

export interface SymbolSetDef {
  id: string;
  name: string;
  description: string;
  symbolIds: string[];
  symbolType?: SymbolSetType;
  valueTier?: ValueTier;
  /** Optional frame reference for the set presentation. */
  frame?: AssetReference | null;
  /** Optional background reference for the set presentation. */
  background?: AssetReference | null;
  styleGuide?: string;
  tags?: string[];
}

export type SpecialBehaviour =
  | "wild"
  | "scatter"
  | "bonus"
  | "multiplier"
  | "expanding"
  | "sticky";

export interface SpecialSymbolDef {
  id: string;
  symbolId: string;
  behaviour: SpecialBehaviour;
  params: Record<string, number | string | boolean>;
}

export type AssetKind = "image" | "sprite" | "spine" | "audio" | "font";

export type AssetFormat =
  | "png"
  | "png-transparent"
  | "jpeg"
  | "webp"
  | "svg"
  | "json-animation"
  | "audio"
  | "other";

export interface AssetRevision {
  id: string;
  uri: string;
  createdAt: string;
  source?: string;
  notes?: string;
}

export interface AssetRef {
  id: string;
  name: string;
  kind: AssetKind;
  uri: string | null;
  /** placeholder = no binary bound yet (studio is art-tool agnostic) */
  state: "placeholder" | "linked";
  tags: string[];
  width?: number | null;
  height?: number | null;
  format?: AssetFormat;
  mime?: string;
  sizeBytes?: number;
  hasAlpha?: boolean;
  createdAt?: string;
  updatedAt?: string;
  revisions?: AssetRevision[];
}

/**
 * Creation / design element categories. These mirror the documented element
 * categories of the studio and are the unit shown in the Design workspace.
 */
export type ElementType =
  | "symbol_set"
  | "symbol"
  | "game_title"
  | "reel_frame"
  | "game_background"
  | "button_set"
  | "uploaded"
  | "custom"
  | "other_asset";

export interface ElementStyleConfig {
  styleGuide?: string;
  tintColor?: string;
  opacity?: number;
  blendMode?: BlendMode;
}

export interface ElementAnimationConfig {
  preset: "none" | "idle_pulse" | "float" | "spin_glow" | "win_pop" | "custom";
  trigger: "spin_start" | "reel_stop" | "win" | "big_win" | "feature_enter";
  durationMs: number;
  easing: string;
  loop: boolean;
}

export interface ElementDef {
  id: string;
  type: ElementType;
  name: string;
  /** free-form grouping label shown as a badge ("Royals", "Branding"…) */
  group: string;
  assetId: string | null;
  symbolIds: string[];
  notes: string;
  /** planned = structure only; imported = bound to user artwork */
  origin: "planned" | "imported";
  params: Record<string, number | string | boolean>;
  /** Present on symbol_set elements: symbolIds are the set members. */
  symbolSet?: SymbolSetMeta;
  /** Editable standalone metadata (F07). Optional for older blueprints. */
  description?: string;
  tags?: string[];
  /** Storage-agnostic image reference. Mirrors assetId for project assets. */
  image?: AssetReference | null;
  /** Recorded image versions on this element, newest first (F10). */
  imageHistory?: ImageRevision[];
  /** Element visual style configuration (F11). */
  style?: ElementStyleConfig;
  /** Custom variants of this standalone element with stable IDs (F11). */
  variants?: SymbolVariant[];
  /** Structured extra metadata key-values (F11). */
  extras?: Record<string, number | string | boolean>;
  /** Element animation configuration (F11). */
  animation?: ElementAnimationConfig;
  /** Element-level Animation Extra configuration notes / parameters (F18). */
  animationExtra?: string;
}

export interface SymbolPlan {
  royals: number;
  medium: number;
  high: number;
  specials: Array<"wild" | "scatter" | "bonus">;
}

export const DEFAULT_SYMBOL_PLAN: SymbolPlan = {
  royals: 4,
  medium: 2,
  high: 3,
  specials: ["wild", "scatter", "bonus"],
};

export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion";

export interface LayerTransform {
  x: number;
  y: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
}

export interface LayerDef {
  id: string;
  name: string;
  kind: "background" | "reels" | "frame" | "ui" | "fx" | "overlay" | "custom" | "group";
  type?: string;
  order: number;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode?: BlendMode;
  transform?: LayerTransform;
  parentId?: string | null;
  groupId?: string | null;
  expanded?: boolean;
}

export interface CanvasLayout {
  width: number;
  height: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
  orientation: "landscape" | "portrait" | "responsive";
  backgroundAssetId: string | null;
}

export type SceneObjectKind = "symbol" | "element" | "image" | "text" | "shape" | "stroke" | "group" | "animation";
export type ShapeKind = "rect" | "ellipse" | "triangle";

/**
 * One positioned item on a scene. `x`/`y` are the unrotated top-left in scene
 * coordinates; `rotation` is in degrees about the object centre. Pure layout
 * data: it describes composition and is evaluated only by the SECTION 2 engine.
 */
export interface SceneObject {
  id: string;
  name: string;
  kind: SceneObjectKind;
  type?: string;
  layerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  blur: number;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  radius: number;
  shape: ShapeKind | null;
  /** stroke objects only: draws an arrowhead on the end point */
  arrow: boolean;
  /** freehand paths, normalised 0..1 within the object box so resize/rotate stay cheap */
  points: Array<{ x: number; y: number }>;
  text: string | null;
  fontSize: number;
  fontWeight: number;
  align: "left" | "center" | "right";
  /** symbol id, element id, or animation id this object is an instance of */
  refId: string | null;
  /** Optional animation id when placed as a standalone animated scene layer (F18) */
  animationId?: string | null;
  assetId: string | null;
  blendMode?: BlendMode;
  transform?: LayerTransform;
  parentId?: string | null;
  groupId?: string | null;
  expanded?: boolean;
}

export interface SceneBackground {
  color: string | null;
  assetId: string | null;
  imageUri?: string | null;
  fit?: "cover" | "contain" | "stretch";
}

export interface SceneCanvasConfiguration {
  width: number;
  height: number;
  safeArea: { top: number; right: number; bottom: number; left: number };
  orientation: "landscape" | "portrait" | "responsive";
  gridVisible?: boolean;
  gridSize?: number;
  snapToGrid?: boolean;
}

export interface SceneVisibilityState {
  /** Overall scene visibility flag */
  sceneVisible: boolean;
  /** Per-layer visibility map (layerId -> visible) */
  layers: Record<string, boolean>;
  /** Per-object visibility map (objectId -> visible) */
  objects: Record<string, boolean>;
}

export interface SceneComposedImageRef {
  id: string;
  name: string;
  assetId: string | null;
  uri: string | null;
  refKind?: "symbol" | "element" | "image" | "animation";
  refId?: string | null;
  layerId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  visible: boolean;
  order: number;
}

export interface SceneLayoutMetadata {
  slotIndex: number;
  slotLabel: "Scene 1" | "Scene 2" | "Scene 3";
  activeLayerId?: string | null;
  zoom?: number;
  panX?: number;
  panY?: number;
  snapEnabled?: boolean;
  guidesVisible?: boolean;
  safeAreaVisible?: boolean;
  updatedAt?: string;
  notes?: string;
}

export interface SceneDef {
  id: string;
  name: string;
  kind: "intro" | "base" | "freespins" | "bonus" | "outro";
  layerIds: string[];
  entryTransition: string;
  /** Scene layout owned by the canvas editor. */
  objects?: SceneObject[];
  background?: SceneBackground;
  /** F19 Scenes and Layout Composition fields */
  canvasConfiguration?: SceneCanvasConfiguration;
  layers?: LayerDef[];
  visibility?: SceneVisibilityState;
  composedImages?: SceneComposedImageRef[];
  layoutMetadata?: SceneLayoutMetadata;
}

export interface ReelStopConfig {
  /** Unique stop instance identifier (used for drag-and-drop and corruption detection). */
  id: string;
  /** 1-based position along the reel strip (1..N). */
  position: number;
  /** Symbol ID referenced at this stop. */
  symbolId: string;
  /** Optional weight for this stop when per-stop weights are enabled. */
  weight?: number;
}

export interface ReelStripDef {
  /** Stable reel identifier (e.g., "reel-1"). */
  id: string;
  /** 0-based reel index (0..columns-1). */
  index: number;
  /** Human-readable reel label ("Reel 1", "Reel 2", ...). */
  name: string;
  /** Ordered stops on this reel. */
  stops: ReelStopConfig[];
}

export interface ReelConfigurationData {
  columns: number;
  rows: number;
  evaluation: "lines" | "ways" | "cluster";
  spinDirection: "down" | "up";
  strips: string[][];
  weightsEnabled: boolean;
  reels: ReelStripDef[];
  updatedAt?: string;
}

export interface ReelConfig {
  columns: number;
  rows: number;
  evaluation: "lines" | "ways" | "cluster";
  strips: string[][];
  spinDirection: "down" | "up";
  weightsEnabled?: boolean;
  reels?: ReelStripDef[];
}

export interface PaylineDef {
  id: string;
  index: number;
  /** row index per column */
  pattern: number[];
  active: boolean;
  /** Deterministic hex color assigned by F15 Payline Editor. */
  color?: string;
  /** Optional display name. */
  name?: string;
}

export interface PaylineItemConfig extends PaylineDef {
  color: string;
}

export interface PaylineConfigurationData {
  columns: number;
  rows: number;
  evaluation: "lines" | "ways" | "cluster";
  preset: "5" | "10" | "20" | "custom";
  paylines: PaylineItemConfig[];
  requestedCount?: number;
  updatedAt?: string;
}

export interface PaytableEntry {
  symbolId: string;
  ofAKind: number;
  payout: number;
}

export interface PaytableSymbolRowConfig {
  symbolId: string;
  code: string;
  name: string;
  tier: SymbolTier;
  family: string;
  symbolType?: SymbolSetType;
  glyph: string;
  assetId: string | null;
  thumbnailUri: string | null;
  isWild: boolean;
  isScatter: boolean;
  isBonus: boolean;
  defaultIsWild: boolean;
  defaultIsScatter: boolean;
  defaultIsBonus: boolean;
  payouts: Record<string, number>;
  defaultPayouts: Record<string, number>;
  rawInputs?: Record<string, string>;
}

export interface PaytableConfigurationData {
  columns: number;
  rows: number;
  evaluation: "lines" | "ways" | "cluster";
  minMatchCount: number;
  matchCounts: number[];
  symbolRows: PaytableSymbolRowConfig[];
  entries: PaytableEntry[];
  updatedAt?: string;
}

export interface FeatureConfig {
  id: string;
  name: string;
  kind: "free_spins" | "hold_and_win" | "pick_bonus" | "gamble" | "jackpot";
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export type StudioAnimationType =
  | "Background"
  | "Symbol Win"
  | "Standalone"
  | "Hover"
  | "Custom";

export type AnimationSource =
  | "preset"
  | "video"
  | "sprite_sheet"
  | "custom";

export type AnimationFormat =
  | "css"
  | "mp4"
  | "webm"
  | "sprite-sheet"
  | "webp"
  | "gif"
  | "json-animation";

export type AnimationConfigState = "enabled" | "disabled";

export interface VideoAnimationReference {
  assetId?: string | null;
  uri: string | null;
  mimeType?: string;
  width?: number;
  height?: number;
  playbackRate?: number;
  muted?: boolean;
}

export interface SpriteSheetAnimationReference {
  assetId?: string | null;
  uri: string | null;
  columns: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  startFrame?: number;
  endFrame?: number;
  spacing?: number;
  margin?: number;
}

export interface AnimationMeta {
  id: string;
  target: string;
  trigger: "spin_start" | "reel_stop" | "win" | "big_win" | "feature_enter";
  kind: string;
  durationMs: number;
  easing: string;
  /** F18 Animation System fields */
  elementId?: string;
  name?: string;
  animationType?: StudioAnimationType;
  source?: AnimationSource;
  format?: AnimationFormat;
  duration?: number;
  loop?: boolean;
  fps?: number;
  thumbnail?: string | null;
  videoReference?: VideoAnimationReference | null;
  spriteSheetReference?: SpriteSheetAnimationReference | null;
  state?: AnimationConfigState;
  animationExtra?: string;
}

export interface MathConfig {
  rtpTarget: number;
  volatility: Volatility;
  maxWinX: number;
  betLevels: number[];
  hitFrequency: number;
}

export type StudioExportType =
  | "zip"
  | "png-asset-sheet"
  | "blueprint-json"
  | "project-json";

export type ExportImageScale = "1x" | "2x";

export interface ExportAnimationOptions {
  includeVideo: boolean;
  includeWebm: boolean;
  includeSpriteSheets: boolean;
  includeGif: boolean;
}

export interface ExportConfig {
  format: "blueprint-json";
  engineTarget: "section2-engine";
  includeAssets: boolean;
  minify: boolean;
  /** F20 Export System options */
  activeExportType?: StudioExportType;
  imageScale?: ExportImageScale;
  animationOptions?: ExportAnimationOptions;
}

/**
 * Immutable record of the manual creation draft. Live design state lives in
 * elements/symbols/symbolSets/assets and may diverge from this record.
 */
export interface BlueprintCreation {
  version: 1;
  mode: "manual";
  folderPath: string;
  gridPreset: "5x3" | "5x4" | "6x3" | "6x4" | "custom";
  stylePreset: "cinematic" | "cartoon" | "painterly" | "neon" | "flat" | "custom";
  symbolPlan: SymbolPlan;
  requestedPaylineCount: number;
  elements: {
    gameTitle: boolean;
    backgrounds: number;
    aspect: "16:9" | "21:9" | "3:2" | "4:3" | "9:16";
    reelFrames: number;
    frameStyle: "ornate" | "minimal" | "cabinet" | "themed";
    buttons: Array<"spin" | "max" | "auto" | "turbo" | "bet" | "menu">;
  };
  artwork: Array<{
    sourceId: string;
    assetId: string;
    elementType: ElementType;
    name: string;
    mime: string;
    width: number;
    height: number;
    bytes: number;
  }>;
  reference: {
    sourceId: string;
    assetId: string;
    name: string;
    mime: string;
    width: number;
    height: number;
    bytes: number;
  } | null;
  /** These are editor starter values, not certified or simulated engine math. */
  mathState: "unverified";
}

export interface GameBlueprint {
  version: number;
  /** Optional for blueprints created before F03. */
  creation?: BlueprintCreation;
  meta: ProjectMeta;
  style: ThemeStyle;
  symbols: SymbolDef[];
  symbolSets: SymbolSetDef[];
  specialSymbols: SpecialSymbolDef[];
  assets: AssetRef[];
  elements: ElementDef[];
  layers: LayerDef[];
  canvas: CanvasLayout;
  scenes: SceneDef[];
  reels: ReelConfig;
  /** F14 Reel Configuration slice saved by the Reel Configuration Editor. */
  reelConfiguration?: ReelConfigurationData;
  paylines: PaylineDef[];
  /** F15 Payline Configuration slice saved by the Payline Configuration Editor. */
  paylineConfiguration?: PaylineConfigurationData;
  paytable: PaytableEntry[];
  /** F16 Paytable Configuration slice saved by the Paytable Configuration Editor. */
  paytableConfiguration?: PaytableConfigurationData;
  features: FeatureConfig[];
  animations: AnimationMeta[];
  math: MathConfig;
  exportConfig: ExportConfig;
  /** Optional explicit grid configuration view. */
  grid?: GridConfiguration;
  /**
   * Reserved, inert extension point for a future (SECTION 3) assistant.
   * The studio never writes to it and never requires it.
   */
  extensions: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* F01 Canonical Blueprint Configuration Type Aliases & Interfaces     */
/* ------------------------------------------------------------------ */

export type ProjectMetadata = ProjectMeta;

export type ThemeConfiguration = ThemeStyle;

export interface StyleGuideConfig {
  name: string;
  description: string;
  mood: string;
  artDirection: string;
  palette: StylePalette;
  typography: { display: string; body: string };
}

export type StyleGuide = string | StyleGuideConfig;

export interface GridConfiguration {
  columns: number;
  rows: number;
  reelCount?: number;
  rowCount?: number;
  preset?: "5x3" | "5x4" | "6x3" | "6x4" | "custom";
  evaluation?: "lines" | "ways" | "cluster";
  cellWidth?: number;
  cellHeight?: number;
  aspectRatio?: string;
  orientation?: "landscape" | "portrait" | "responsive";
  minReels?: number;
  maxReels?: number;
  minRows?: number;
  maxRows?: number;
}

export type SymbolSet = SymbolSetDef;

export type StandaloneElement = ElementDef;

export type Asset = AssetRef;

export type Scene = SceneDef;

export type ReelConfiguration = ReelConfig;

export interface PaylineConfiguration {
  columns?: number;
  rows?: number;
  evaluation: "lines" | "ways" | "cluster";
  preset?: "5" | "10" | "20" | "custom";
  paylines: PaylineDef[];
  requestedCount?: number;
  updatedAt?: string;
}

export interface PaytableConfiguration {
  entries: PaytableEntry[];
  columns?: number;
  rows?: number;
  evaluation?: "lines" | "ways" | "cluster";
  minMatchCount?: number;
  matchCounts?: number[];
  symbolRows?: PaytableSymbolRowConfig[];
  updatedAt?: string;
}

export type FeatureConfiguration = FeatureConfig;

export type AnimationConfiguration = AnimationMeta;

export type ExportConfiguration = ExportConfig;

