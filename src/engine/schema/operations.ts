/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B02 — Canonical Game Definition Schema Validation, Normalization,
 *       Migration, Cloning, Serialization & GameConfig Conversion
 *
 * Pure TypeScript implementation with zero UI, DOM, React, or RNG dependencies.
 */

import { slugify } from "@/lib/blueprint/factory";
import {
  BLUEPRINT_VERSION,
  type AssetFormat,
  type AssetRef,
  type ElementDef,
  type FeatureConfig,
  type GameBlueprint,
  type LayerDef,
  type PaylineDef,
  type PaytableEntry,
  type SceneDef,
  type SpecialBehaviour,
  type SymbolDef,
  type SymbolSetDef,
  type SymbolVariant,
  type ValueTier,
} from "@/lib/blueprint/types";
import { adaptBlueprintToGameConfig, type GameConfig } from "../config";
import {
  InvalidGameConfigError,
  InvalidPaylineConfigError,
  InvalidPaytableError,
  InvalidReelConfigError,
  InvalidSymbolReferenceError,
  UnsupportedGameSchemaError,
  type EngineErrorCode,
} from "../errors";
import {
  ENGINE_VERSION,
  type EngineValidationCategory,
  type EngineValidationIssue,
  type EngineValidationResult,
} from "../validation";
import {
  CANONICAL_SCHEMA_VERSION,
  type AnimationDefinition,
  type AssetDefinition,
  type BoardDynamicsConfiguration,
  type CanonicalAnimationType,
  type CanonicalAssetType,
  type CanonicalExportConfiguration,
  type CanonicalFeatureType,
  type CanonicalGridConfiguration,
  type CanonicalLayerType,
  type CanonicalPaylineConfiguration,
  type CanonicalPaytableSymbolEntry,
  type CanonicalReelConfiguration,
  type CanonicalStyleGuide,
  type CanonicalSymbolDefinition,
  type CanonicalSymbolType,
  type CanonicalSymbolVariant,
  type ClusterConfiguration,
  type ElementDefinition,
  type EngineCompatibilitySpec,
  type FeatureDefinition,
  type FeatureTriggerDefinition,
  type FreeSpinsConfiguration,
  type GameDefinition,
  type GameEvaluationMode,
  type GameIdentityConfig,
  type GameMetadata,
  type LayerDefinition,
  type LayerGroupDefinition,
  type LinkedReelsConfiguration,
  type MultiplierConfiguration,
  type PayAnywhereConfiguration,
  type PaylineDefinition,
  type PaytableDefinition,
  type ReelDefinition,
  type ReelNudgeConfiguration,
  type ReelStopDefinition,
  type ScatterConfiguration,
  type ScatterRule,
  type SceneDefinition,
  type SchemaAssetReference,
  type SchemaExtensions,
  type SymbolFamilyDefinition,
  type SymbolRoleConfig,
  type SymbolRoleType,
  type SymbolSetDefinition,
  type VariableReelHeightConfiguration,
  type WaysConfiguration,
  type WildConfiguration,
  type WildSubstitutionRule,
  type WinEvaluationDefinition,
  type WinEvaluationType,
} from "./types";

const FORBIDDEN_RUNTIME_STATE_KEYS = new Set([
  "currentBalance",
  "currentBet",
  "currentReelStops",
  "currentBoard",
  "currentWin",
  "currentMultiplierState",
  "currentFreeSpinCount",
  "currentCascadeNumber",
  "currentFeatureState",
  "currentRngState",
  "currentSessionState",
]);

const FORBIDDEN_UI_STATE_KEYS = new Set([
  "selectedLayer",
  "selectedSymbol",
  "activeTool",
  "openPanel",
  "cursorPosition",
  "hoverState",
  "dragState",
  "undoStack",
  "redoStack",
  "modalState",
]);

const SUPPORTED_SCHEMA_VERSION_STRINGS = new Set(["1.0", "1"]);
const SUPPORTED_MIGRATION_SOURCES = new Set(["0.9", "1", "1.0", 1]);
const SUPPORTED_MIGRATION_TARGETS = new Set(["1.0", "1", 1]);

const VALID_SYMBOL_TIERS = new Set(["low", "mid", "high", "special"]);
const VALID_EVALUATION_MODES = new Set([
  "lines",
  "ways",
  "cluster",
  "pay_anywhere",
]);
const VALID_WIN_EVALUATION_TYPES = new Set<WinEvaluationType>([
  "fixedPaylines",
  "ways",
  "clusters",
  "payAnywhere",
  "scatters",
]);
const VALID_CLUSTER_ADJACENCY = new Set(["edge", "hex"]);
const VALID_FEATURE_TYPES = new Set<string>([
  "freeSpins",
  "multiplier",
  "tumble",
  "cascade",
  "boardResize",
  "symbolInjection",
  "symbolRemoval",
  "mystery",
  "colossal",
  "lockedCells",
  "reelNudge",
  "linkedReels",
  "variableReelHeights",
  "bonus",
  "free_spins",
  "hold_and_win",
  "pick_bonus",
  "gamble",
  "jackpot",
]);

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object" || Object.isFrozen(obj)) {
    return obj;
  }
  Object.freeze(obj);
  if (Array.isArray(obj)) {
    for (const item of obj) {
      deepFreeze(item);
    }
  } else {
    for (const val of Object.values(obj as Record<string, unknown>)) {
      deepFreeze(val);
    }
  }
  return obj;
}

function inspectJsonSerializability(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
  onError: (path: string, message: string) => void,
): void {
  if (value === null || value === undefined) return;
  const t = typeof value;
  if (t === "string" || t === "boolean") return;
  if (t === "number") {
    if (!Number.isFinite(value)) {
      onError(
        path,
        `Non-finite number (${String(value)}) is not allowed in a serializable GameDefinition.`,
      );
    }
    return;
  }
  if (t === "function" || t === "symbol" || t === "bigint") {
    onError(
      path,
      `Non-serializable value of type "${t}" is not allowed in GameDefinition.`,
    );
    return;
  }
  if (t === "object") {
    const obj = value as object;
    if (seen.has(obj)) {
      onError(path, "Circular reference detected in GameDefinition.");
      return;
    }
    if (obj instanceof Map || obj instanceof Set) {
      onError(
        path,
        `Raw ${obj instanceof Map ? "Map" : "Set"} instance is not allowed in serialized GameDefinition.`,
      );
      return;
    }
    const proto = Object.getPrototypeOf(obj);
    if (proto !== null && proto !== Object.prototype && !Array.isArray(obj)) {
      onError(
        path,
        `Class instance (${proto.constructor?.name ?? "Object"}) is not allowed in serialized GameDefinition.`,
      );
      return;
    }
    seen.add(obj);
    if (Array.isArray(obj)) {
      obj.forEach((child, idx) =>
        inspectJsonSerializability(child, `${path}[${idx}]`, seen, onError),
      );
    } else {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        inspectJsonSerializability(
          v,
          path ? `${path}.${k}` : k,
          seen,
          onError,
        );
      }
    }
    seen.delete(obj);
  }
}

/**
 * Validates any GameBlueprint or GameDefinition candidate against the full B02
 * structural, cross-reference, serializability, and forbidden-state rules.
 */
export function validateGameDefinition(
  candidate: unknown,
): EngineValidationResult {
  const issues: EngineValidationIssue[] = [];
  const pushIssue = (
    category: EngineValidationCategory,
    code: EngineErrorCode,
    path: string,
    message: string,
    context?: Record<string, unknown>,
  ) => {
    issues.push(
      Object.freeze({
        category,
        code,
        path,
        message,
        ...(context ? { context: Object.freeze({ ...context }) } : {}),
      }),
    );
  };

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    pushIssue(
      "SCHEMA",
      "UNSUPPORTED_GAME_SCHEMA",
      "",
      "GameDefinition payload must be a non-null plain object.",
    );
    return Object.freeze({
      valid: false,
      schemaVersion: null,
      engineVersion: ENGINE_VERSION,
      issues: Object.freeze(issues),
    });
  }

  const record = candidate as Record<string, unknown>;

  // 1. Check schemaVersion and version compatibility
  const rawSchemaVersion = record.schemaVersion;
  const rawVersion = record.version;
  const metaRecord =
    record.meta && typeof record.meta === "object"
      ? (record.meta as Record<string, unknown>)
      : null;
  const metaSchemaVersion = metaRecord?.schemaVersion;

  if (
    rawSchemaVersion !== undefined &&
    typeof rawSchemaVersion !== "number" &&
    typeof rawSchemaVersion !== "string"
  ) {
    pushIssue(
      "SCHEMA",
      "UNSUPPORTED_GAME_SCHEMA",
      "schemaVersion",
      `Unsupported schemaVersion "${String(rawSchemaVersion)}".`,
      { schemaVersion: rawSchemaVersion },
    );
  } else if (
    rawSchemaVersion !== undefined &&
    !SUPPORTED_SCHEMA_VERSION_STRINGS.has(String(rawSchemaVersion))
  ) {
    pushIssue(
      "SCHEMA",
      "UNSUPPORTED_GAME_SCHEMA",
      "schemaVersion",
      `Unsupported schemaVersion "${String(rawSchemaVersion)}". Supported: "1.0", 1.`,
      { schemaVersion: rawSchemaVersion },
    );
  }

  if (
    rawVersion === undefined ||
    (rawVersion !== BLUEPRINT_VERSION && rawVersion !== "1.0")
  ) {
    pushIssue(
      "SCHEMA",
      "UNSUPPORTED_GAME_SCHEMA",
      "version",
      `Unsupported blueprint version "${String(rawVersion)}". Supported: 1.`,
      { version: rawVersion },
    );
  }

  if (
    metaSchemaVersion !== undefined &&
    metaSchemaVersion !== BLUEPRINT_VERSION &&
    metaSchemaVersion !== "1.0"
  ) {
    pushIssue(
      "SCHEMA",
      "UNSUPPORTED_GAME_SCHEMA",
      "meta.schemaVersion",
      `Unsupported meta.schemaVersion "${String(metaSchemaVersion)}".`,
      { metaSchemaVersion },
    );
  }

  if (issues.some((i) => i.code === "UNSUPPORTED_GAME_SCHEMA")) {
    return Object.freeze({
      valid: false,
      schemaVersion: typeof rawVersion === "number" ? rawVersion : null,
      engineVersion: ENGINE_VERSION,
      issues: Object.freeze(issues),
    });
  }

  // 2. Check forbidden Runtime State and UI State keys (Rules 55 & 56)
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_RUNTIME_STATE_KEYS.has(key)) {
      pushIssue(
        "GAME",
        "INVALID_GAME_CONFIG",
        key,
        `Runtime state property "${key}" is forbidden inside GameDefinition.`,
        { forbiddenKey: key },
      );
    }
    if (FORBIDDEN_UI_STATE_KEYS.has(key)) {
      pushIssue(
        "GAME",
        "INVALID_GAME_CONFIG",
        key,
        `Transient UI editor state property "${key}" is forbidden inside GameDefinition.`,
        { forbiddenKey: key },
      );
    }
  }

  // 3. Check JSON serializability (no functions, Maps, Sets, circular refs, NaN/Infinity)
  inspectJsonSerializability(record, "", new WeakSet(), (errPath, message) => {
    const isPaytablePath =
      errPath.startsWith("paytable") ||
      errPath.includes(".payouts") ||
      errPath.startsWith("paytableDefinition");
    pushIssue(
      isPaytablePath ? "PAYTABLE" : "GAME",
      isPaytablePath ? "INVALID_PAYTABLE" : "INVALID_GAME_CONFIG",
      errPath || "root",
      message,
    );
  });

  const bp = candidate as Partial<GameDefinition> & GameBlueprint;

  // 4. Validate Metadata & Game Identity
  if (!bp.meta || typeof bp.meta.id !== "string" || !bp.meta.id.trim()) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "meta.id",
      "Game metadata must have a non-empty string id.",
    );
  }
  if (!bp.meta || typeof bp.meta.title !== "string" || !bp.meta.title.trim()) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "meta.title",
      "Game metadata must have a non-empty string title.",
    );
  }
  if (bp.id !== undefined && bp.meta?.id && bp.id !== bp.meta.id) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "id",
      `Top-level id "${bp.id}" does not match meta.id "${bp.meta.id}".`,
      { id: bp.id, metaId: bp.meta.id },
    );
  }

  // 5. Validate Grid Configuration
  const columns =
    bp.grid?.reelCount ?? bp.grid?.columns ?? bp.reels?.columns ?? 0;
  const rows = bp.grid?.rowCount ?? bp.grid?.rows ?? bp.reels?.rows ?? 0;
  const evaluation = bp.reels?.evaluation ?? "lines";

  const validColumns =
    typeof columns === "number" &&
    Number.isInteger(columns) &&
    columns >= 3 &&
    columns <= 8;
  const validRows =
    typeof rows === "number" &&
    Number.isInteger(rows) &&
    rows >= 2 &&
    rows <= 6;

  if (!validColumns) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "grid.reelCount",
      `Grid reelCount/columns must be an integer between 3 and 8, received ${String(columns)}.`,
      { columns },
    );
  }
  if (!validRows) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "grid.rowCount",
      `Grid rowCount/rows must be an integer between 2 and 6, received ${String(rows)}.`,
      { rows },
    );
  }
  if (!VALID_EVALUATION_MODES.has(evaluation)) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "reels.evaluation",
      `Invalid evaluation mode "${String(evaluation)}".`,
      { evaluation },
    );
  }

  // 6. Validate Assets first so symbol/element/scene/animation asset references can be verified
  const assetIds = new Set<string>();
  if (Array.isArray(bp.assets)) {
    bp.assets.forEach((asset, idx) => {
      const path = `assets[${idx}]`;
      if (!asset || typeof asset.id !== "string" || !asset.id.trim()) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `${path}.id`,
          "Asset must have a non-empty string id.",
        );
      } else if (assetIds.has(asset.id)) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `${path}.id`,
          `Duplicate asset ID "${asset.id}".`,
          { assetId: asset.id },
        );
      } else {
        assetIds.add(asset.id);
      }
    });
  }
  if (Array.isArray(bp.canonicalAssets)) {
    bp.canonicalAssets.forEach((asset, idx) => {
      if (!assetIds.has(asset.id)) {
        assetIds.add(asset.id);
      } else if (
        bp.canonicalAssets!.findIndex((a) => a.id === asset.id) !== idx
      ) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `canonicalAssets[${idx}].id`,
          `Duplicate canonical asset ID "${asset.id}".`,
          { assetId: asset.id },
        );
      }
    });
  }

  const checkAssetRef = (
    assetId: string | null | undefined,
    path: string,
    provider: "project" | "external" | "placeholder" = "project",
  ) => {
    if (!assetId) return;
    if (provider === "project" && !assetIds.has(assetId)) {
      pushIssue(
        "GAME",
        "INVALID_GAME_CONFIG",
        path,
        `Dangling asset reference "${assetId}" at ${path}.`,
        { assetId, path },
      );
    }
  };

  // 7. Collect Symbol Sets & Elements IDs for cross-reference checks
  const symbolSetIds = new Set<string>();
  if (Array.isArray(bp.symbolSets)) {
    bp.symbolSets.forEach((set, idx) => {
      if (!set.id || typeof set.id !== "string") {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `symbolSets[${idx}].id`,
          "SymbolSet must have a non-empty string ID.",
        );
      } else if (symbolSetIds.has(set.id)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `symbolSets[${idx}].id`,
          `Duplicate symbolSet ID "${set.id}".`,
          { symbolSetId: set.id },
        );
      } else {
        symbolSetIds.add(set.id);
      }
    });
  }

  const elementIds = new Set<string>();
  if (Array.isArray(bp.elements)) {
    bp.elements.forEach((el, idx) => {
      if (!el.id || typeof el.id !== "string") {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `elements[${idx}].id`,
          "Element must have a non-empty string ID.",
        );
      } else if (elementIds.has(el.id)) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `elements[${idx}].id`,
          `Duplicate element ID "${el.id}".`,
          { elementId: el.id },
        );
      } else {
        elementIds.add(el.id);
      }
      if (el.type === "symbol_set") {
        symbolSetIds.add(el.id);
      }
      checkAssetRef(el.assetId, `elements[${idx}].assetId`);
      if (el.image?.provider === "project") {
        checkAssetRef(el.image.assetId, `elements[${idx}].image.assetId`);
      }
    });
  }

  // 8. Collect Symbol Family IDs
  const familyIds = new Set<string>();
  if (Array.isArray(bp.symbolFamilies)) {
    bp.symbolFamilies.forEach((family, idx) => {
      const path = `symbolFamilies[${idx}]`;
      if (!family.id || typeof family.id !== "string") {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.id`,
          "SymbolFamily must have a non-empty string ID.",
        );
      } else if (familyIds.has(family.id)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.id`,
          `Duplicate symbol family ID "${family.id}".`,
          { familyId: family.id },
        );
      } else {
        familyIds.add(family.id);
      }
    });
  }

  // 9. Validate Symbols & Variants
  const symbolIds = new Set<string>();
  const symbolCodes = new Set<string>();
  const variantIds = new Set<string>();
  const mathAddressableIds = new Set<string>();

  if (!Array.isArray(bp.symbols) || bp.symbols.length === 0) {
    pushIssue(
      "SYMBOLS",
      "INVALID_SYMBOL_REFERENCE",
      "symbols",
      "GameDefinition must define at least one symbol.",
    );
  } else {
    bp.symbols.forEach((sym, idx) => {
      const path = `symbols[${idx}]`;
      if (!sym || typeof sym.id !== "string" || !sym.id.trim()) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.id`,
          "Symbol must have a non-empty string ID.",
        );
      } else if (symbolIds.has(sym.id)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.id`,
          `Duplicate symbol ID "${sym.id}".`,
          { symbolId: sym.id },
        );
      } else {
        symbolIds.add(sym.id);
        mathAddressableIds.add(sym.id);
      }

      if (!sym.code || typeof sym.code !== "string" || !sym.code.trim()) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.code`,
          `Symbol "${sym?.id ?? idx}" must have a non-empty string code.`,
        );
      } else if (symbolCodes.has(sym.code)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.code`,
          `Duplicate symbol code "${sym.code}".`,
          { symbolId: sym.id, code: sym.code },
        );
      } else {
        symbolCodes.add(sym.code);
      }

      if (!VALID_SYMBOL_TIERS.has(sym.tier)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.tier`,
          `Symbol "${sym.id}" has invalid tier "${String(sym.tier)}".`,
          { symbolId: sym.id, tier: sym.tier },
        );
      }

      if (
        !isFiniteNonNegative(sym.reelWeight) ||
        !Number.isInteger(sym.reelWeight)
      ) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.reelWeight`,
          `Symbol "${sym.id}" must have a non-negative integer reelWeight.`,
          { symbolId: sym.id, reelWeight: sym.reelWeight },
        );
      }

      checkAssetRef(sym.assetId, `${path}.assetId`);
      if (sym.image?.provider === "project") {
        checkAssetRef(sym.image.assetId, `${path}.image.assetId`);
      }

      if (sym.symbolSetId && !symbolSetIds.has(sym.symbolSetId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.symbolSetId`,
          `Symbol "${sym.id}" references unknown symbolSet "${sym.symbolSetId}".`,
          { symbolId: sym.id, symbolSetId: sym.symbolSetId },
        );
      }

      if (
        sym.family &&
        Array.isArray(bp.symbolFamilies) &&
        bp.symbolFamilies.length > 0 &&
        !familyIds.has(sym.family)
      ) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.family`,
          `Symbol "${sym.id}" references unknown symbol family "${sym.family}".`,
          { symbolId: sym.id, familyId: sym.family },
        );
      }

      if (sym.payouts && typeof sym.payouts === "object") {
        for (const [rawCount, payout] of Object.entries(sym.payouts)) {
          const matchCount = Number(rawCount);
          if (!Number.isInteger(matchCount) || matchCount < 1) {
            pushIssue(
              "PAYTABLE",
              "INVALID_PAYTABLE",
              `${path}.payouts["${rawCount}"]`,
              `Symbol "${sym.id}" has invalid match count "${rawCount}".`,
              { symbolId: sym.id, matchCount: rawCount },
            );
          }
          if (!isFiniteNonNegative(payout)) {
            pushIssue(
              "PAYTABLE",
              "INVALID_PAYTABLE",
              `${path}.payouts["${rawCount}"]`,
              `Symbol "${sym.id}" has invalid payout "${String(payout)}" for match count ${rawCount}.`,
              { symbolId: sym.id, matchCount: rawCount, payout },
            );
          }
        }
      }

      if (Array.isArray(sym.variants)) {
        sym.variants.forEach((variant, vIdx) => {
          const vPath = `${path}.variants[${vIdx}]`;
          if (!variant.id || typeof variant.id !== "string") {
            pushIssue(
              "SYMBOLS",
              "INVALID_SYMBOL_REFERENCE",
              `${vPath}.id`,
              `Variant on symbol "${sym.id}" must have a valid string ID.`,
            );
          } else if (
            variantIds.has(variant.id) ||
            symbolIds.has(variant.id)
          ) {
            pushIssue(
              "SYMBOLS",
              "INVALID_SYMBOL_REFERENCE",
              `${vPath}.id`,
              `Duplicate variant ID "${variant.id}".`,
              { variantId: variant.id, symbolId: sym.id },
            );
          } else {
            variantIds.add(variant.id);
            mathAddressableIds.add(variant.id);
          }

          if (variant.image?.provider === "project") {
            checkAssetRef(variant.image.assetId, `${vPath}.image.assetId`);
          }
        });
      }
    });
  }

  // Validate canonicalSymbols cross-references if provided
  if (Array.isArray(bp.canonicalSymbols)) {
    bp.canonicalSymbols.forEach((cSym: CanonicalSymbolDefinition, idx: number) => {
      const path = `canonicalSymbols[${idx}]`;
      if (cSym.familyId && !familyIds.has(cSym.familyId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.familyId`,
          `Canonical symbol "${cSym.id}" references unknown familyId "${cSym.familyId}".`,
          { symbolId: cSym.id, familyId: cSym.familyId },
        );
      }
      if (cSym.asset?.provider === "project") {
        checkAssetRef(cSym.asset.assetId, `${path}.asset.assetId`);
      }
      if (cSym.symbolSetId && !symbolSetIds.has(cSym.symbolSetId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.symbolSetId`,
          `Canonical symbol "${cSym.id}" references unknown symbolSetId "${cSym.symbolSetId}".`,
          { symbolId: cSym.id, symbolSetId: cSym.symbolSetId },
        );
      }
      cSym.variants.forEach((v: CanonicalSymbolVariant, vIdx: number) => {
        if (v.familyId && !familyIds.has(v.familyId)) {
          pushIssue(
            "SYMBOLS",
            "INVALID_SYMBOL_REFERENCE",
            `${path}.variants[${vIdx}].familyId`,
            `Variant "${v.id}" references unknown familyId "${v.familyId}".`,
            { variantId: v.id, familyId: v.familyId },
          );
        }
        if (v.asset?.provider === "project") {
          checkAssetRef(
            v.asset.assetId,
            `${path}.variants[${vIdx}].asset.assetId`,
          );
        }
      });
    });
  }

  // Validate symbolSets -> symbolIds
  if (Array.isArray(bp.symbolSets)) {
    bp.symbolSets.forEach((set, sIdx) => {
      set.symbolIds.forEach((symId, mIdx) => {
        if (!symbolIds.has(symId)) {
          pushIssue(
            "SYMBOLS",
            "INVALID_SYMBOL_REFERENCE",
            `symbolSets[${sIdx}].symbolIds[${mIdx}]`,
            `SymbolSet "${set.id}" references unknown symbol "${symId}".`,
            { symbolSetId: set.id, symbolId: symId },
          );
        }
      });
      if (set.frame?.provider === "project") {
        checkAssetRef(set.frame.assetId, `symbolSets[${sIdx}].frame.assetId`);
      }
      if (set.background?.provider === "project") {
        checkAssetRef(
          set.background.assetId,
          `symbolSets[${sIdx}].background.assetId`,
        );
      }
    });
  }

  // Validate symbolFamilies -> baseSymbolId & memberIds
  if (Array.isArray(bp.symbolFamilies)) {
    bp.symbolFamilies.forEach((family, fIdx) => {
      const path = `symbolFamilies[${fIdx}]`;
      if (family.baseSymbolId && !symbolIds.has(family.baseSymbolId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.baseSymbolId`,
          `SymbolFamily "${family.id}" references unknown baseSymbolId "${family.baseSymbolId}".`,
          { familyId: family.id, baseSymbolId: family.baseSymbolId },
        );
      }
      if (!Array.isArray(family.memberIds) || family.memberIds.length === 0) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.memberIds`,
          `SymbolFamily "${family.id}" must have at least one member ID.`,
          { familyId: family.id },
        );
      } else {
        family.memberIds.forEach((memberId: string, mIdx: number) => {
          if (!mathAddressableIds.has(memberId)) {
            pushIssue(
              "SYMBOLS",
              "INVALID_SYMBOL_REFERENCE",
              `${path}.memberIds[${mIdx}]`,
              `SymbolFamily "${family.id}" references unknown member symbol/variant "${memberId}".`,
              { familyId: family.id, memberId },
            );
          }
        });
      }
    });
  }

  // Validate specialSymbols
  if (Array.isArray(bp.specialSymbols)) {
    bp.specialSymbols.forEach((special, idx) => {
      if (!symbolIds.has(special.symbolId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `specialSymbols[${idx}].symbolId`,
          `Special symbol "${special.id}" references unknown symbol "${special.symbolId}".`,
          { specialId: special.id, symbolId: special.symbolId },
        );
      }
    });
  }

  // 10. Validate Features (needed before scatter/freeSpins cross-references)
  const featureIds = new Set<string>();
  if (Array.isArray(bp.features)) {
    bp.features.forEach((feat, idx) => {
      const path = `features[${idx}]`;
      if (!feat.id || typeof feat.id !== "string") {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `${path}.id`,
          "Feature must have a non-empty string ID.",
        );
      } else if (featureIds.has(feat.id)) {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `${path}.id`,
          `Duplicate feature ID "${feat.id}".`,
          { featureId: feat.id },
        );
      } else {
        featureIds.add(feat.id);
      }
      if (!VALID_FEATURE_TYPES.has(feat.kind)) {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `${path}.kind`,
          `Feature "${feat.id}" has unsupported kind "${String(feat.kind)}".`,
          { featureId: feat.id, kind: feat.kind },
        );
      }
    });
  }
  if (Array.isArray(bp.canonicalFeatures)) {
    bp.canonicalFeatures.forEach((feat, idx) => {
      const path = `canonicalFeatures[${idx}]`;
      if (!VALID_FEATURE_TYPES.has(feat.type)) {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `${path}.type`,
          `Canonical feature "${feat.id}" has invalid type "${String(feat.type)}".`,
        );
      }
      if (feat.trigger) {
        if (
          feat.trigger.source === "scatterCount" &&
          !symbolIds.has(feat.trigger.symbolId)
        ) {
          pushIssue(
            "FEATURES",
            "INVALID_SYMBOL_REFERENCE",
            `${path}.trigger.symbolId`,
            `Feature "${feat.id}" scatterCount trigger references unknown symbol "${feat.trigger.symbolId}".`,
          );
        }
        if (
          feat.trigger.source === "featureComplete" &&
          !featureIds.has(feat.trigger.sourceFeatureId)
        ) {
          pushIssue(
            "FEATURES",
            "INVALID_GAME_CONFIG",
            `${path}.trigger.sourceFeatureId`,
            `Feature "${feat.id}" trigger references unknown feature "${feat.trigger.sourceFeatureId}".`,
          );
        }
      }
    });
  }

  // Validate WildConfiguration if present
  if (bp.wildConfiguration) {
    bp.wildConfiguration.symbolIds.forEach((wId, idx) => {
      if (!symbolIds.has(wId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `wildConfiguration.symbolIds[${idx}]`,
          `WildConfiguration references unknown wild symbol "${wId}".`,
          { symbolId: wId },
        );
      }
    });
    bp.wildConfiguration.substitutionRules.forEach((rule, rIdx) => {
      const rPath = `wildConfiguration.substitutionRules[${rIdx}]`;
      if (!symbolIds.has(rule.wildSymbolId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${rPath}.wildSymbolId`,
          `WildSubstitutionRule references unknown wildSymbolId "${rule.wildSymbolId}".`,
          { symbolId: rule.wildSymbolId },
        );
      }
      if (Array.isArray(rule.allowedSubstitutions)) {
        rule.allowedSubstitutions.forEach((allowedId, aIdx) => {
          if (!symbolIds.has(allowedId)) {
            pushIssue(
              "SYMBOLS",
              "INVALID_SYMBOL_REFERENCE",
              `${rPath}.allowedSubstitutions[${aIdx}]`,
              `WildSubstitutionRule references unknown allowed symbol "${allowedId}".`,
              { symbolId: allowedId },
            );
          }
        });
      }
      rule.excludedSymbolIds.forEach((exId, eIdx) => {
        if (!symbolIds.has(exId)) {
          pushIssue(
            "SYMBOLS",
            "INVALID_SYMBOL_REFERENCE",
            `${rPath}.excludedSymbolIds[${eIdx}]`,
            `WildSubstitutionRule references unknown excluded symbol "${exId}".`,
            { symbolId: exId },
          );
        }
      });
    });
  }

  // Validate ScatterConfiguration if present
  if (bp.scatterConfiguration) {
    bp.scatterConfiguration.symbolIds.forEach((sId, idx) => {
      if (!symbolIds.has(sId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `scatterConfiguration.symbolIds[${idx}]`,
          `ScatterConfiguration references unknown scatter symbol "${sId}".`,
          { symbolId: sId },
        );
      }
    });
    bp.scatterConfiguration.rules.forEach((rule, rIdx) => {
      const rPath = `scatterConfiguration.rules[${rIdx}]`;
      if (!symbolIds.has(rule.scatterSymbolId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${rPath}.scatterSymbolId`,
          `ScatterRule references unknown scatterSymbolId "${rule.scatterSymbolId}".`,
          { symbolId: rule.scatterSymbolId },
        );
      }
      if (
        rule.payoutReferenceSymbolId &&
        !symbolIds.has(rule.payoutReferenceSymbolId)
      ) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${rPath}.payoutReferenceSymbolId`,
          `ScatterRule references unknown payoutReferenceSymbolId "${rule.payoutReferenceSymbolId}".`,
          { symbolId: rule.payoutReferenceSymbolId },
        );
      }
      if (rule.triggerFeatureId && !featureIds.has(rule.triggerFeatureId)) {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `${rPath}.triggerFeatureId`,
          `ScatterRule references unknown triggerFeatureId "${rule.triggerFeatureId}".`,
          { featureId: rule.triggerFeatureId },
        );
      }
    });
  }

  // Validate FreeSpinsConfiguration if present
  if (bp.freeSpinsConfiguration) {
    if (
      bp.freeSpinsConfiguration.featureId &&
      !featureIds.has(bp.freeSpinsConfiguration.featureId)
    ) {
      pushIssue(
        "FEATURES",
        "INVALID_GAME_CONFIG",
        "freeSpinsConfiguration.featureId",
        `FreeSpinsConfiguration references unknown featureId "${bp.freeSpinsConfiguration.featureId}".`,
      );
    }
    bp.freeSpinsConfiguration.featureReferences.forEach((fId, idx) => {
      if (!featureIds.has(fId)) {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `freeSpinsConfiguration.featureReferences[${idx}]`,
          `FreeSpinsConfiguration references unknown feature "${fId}".`,
        );
      }
    });
  }

  // 11. Validate Reels, Reel Indexing, Stop References & Weights
  const strips = bp.reels?.strips;
  if (!Array.isArray(strips)) {
    pushIssue(
      "REELS",
      "INVALID_REEL_CONFIG",
      "reels.strips",
      "reels.strips must be an array of reel strips.",
    );
  } else {
    if (validColumns && strips.length !== columns) {
      pushIssue(
        "REELS",
        "INVALID_REEL_CONFIG",
        "reels.strips",
        `Expected ${columns} reel strips, found ${strips.length}.`,
        { expected: columns, actual: strips.length },
      );
    }
    strips.forEach((strip, rIdx) => {
      if (!Array.isArray(strip) || strip.length === 0) {
        pushIssue(
          "REELS",
          "INVALID_REEL_CONFIG",
          `reels.strips[${rIdx}]`,
          `Reel strip at index ${rIdx} must not be empty.`,
          { reelIndex: rIdx },
        );
        return;
      }
      strip.forEach((stopSymId, sIdx) => {
        if (!mathAddressableIds.has(stopSymId)) {
          pushIssue(
            "REELS",
            "INVALID_SYMBOL_REFERENCE",
            `reels.strips[${rIdx}][${sIdx}]`,
            `Reel ${rIdx + 1} stop ${sIdx + 1} references unknown symbol "${stopSymId}".`,
            { reelIndex: rIdx, stopIndex: sIdx, symbolId: stopSymId },
          );
        }
      });
    });
  }

  const detailedReels =
    bp.canonicalReels?.reels ??
    bp.reelConfiguration?.reels ??
    bp.reels?.reels;
  const useWeights = Boolean(
    bp.canonicalReels?.useWeights ??
      bp.reelConfiguration?.weightsEnabled ??
      bp.reels?.weightsEnabled,
  );

  if (Array.isArray(detailedReels) && detailedReels.length > 0) {
    if (validColumns && detailedReels.length !== columns) {
      pushIssue(
        "REELS",
        "INVALID_REEL_CONFIG",
        "canonicalReels.reels",
        `Expected ${columns} reel definitions, found ${detailedReels.length}.`,
        { expected: columns, actual: detailedReels.length },
      );
    }
    const reelIds = new Set<string>();
    const reelIndexes = new Set<number>();

    detailedReels.forEach((reelDef, rIdx) => {
      const rPath = `reels[${rIdx}]`;
      if (!reelDef.id || typeof reelDef.id !== "string") {
        pushIssue(
          "REELS",
          "INVALID_REEL_CONFIG",
          `${rPath}.id`,
          `Reel at index ${rIdx} must have a valid string ID.`,
        );
      } else if (reelIds.has(reelDef.id)) {
        pushIssue(
          "REELS",
          "INVALID_REEL_CONFIG",
          `${rPath}.id`,
          `Duplicate reel ID "${reelDef.id}".`,
        );
      } else {
        reelIds.add(reelDef.id);
      }

      if (
        typeof reelDef.index !== "number" ||
        !Number.isInteger(reelDef.index) ||
        reelDef.index < 0 ||
        (validColumns && reelDef.index >= columns) ||
        reelIndexes.has(reelDef.index)
      ) {
        pushIssue(
          "REELS",
          "INVALID_REEL_CONFIG",
          `${rPath}.index`,
          `Reel "${reelDef.id}" has invalid or duplicate index ${String(reelDef.index)}.`,
          { reelId: reelDef.id, index: reelDef.index },
        );
      } else {
        reelIndexes.add(reelDef.index);
      }

      if (!Array.isArray(reelDef.stops) || reelDef.stops.length === 0) {
        pushIssue(
          "REELS",
          "INVALID_REEL_CONFIG",
          `${rPath}.stops`,
          `Reel "${reelDef.id}" must contain at least one stop.`,
        );
        return;
      }

      const stopIds = new Set<string>();
      reelDef.stops.forEach((stop, sIdx) => {
        const sPath = `${rPath}.stops[${sIdx}]`;
        if (stop.id) {
          if (stopIds.has(stop.id)) {
            pushIssue(
              "REELS",
              "INVALID_REEL_CONFIG",
              `${sPath}.id`,
              `Duplicate stop ID "${stop.id}" on reel "${reelDef.id}".`,
            );
          } else {
            stopIds.add(stop.id);
          }
        }
        if ("symbol" in (stop as unknown as Record<string, unknown>)) {
          pushIssue(
            "REELS",
            "INVALID_REEL_CONFIG",
            `${sPath}.symbol`,
            `Reel stop must reference symbolId only, not an embedded symbol object.`,
          );
        }
        if (!mathAddressableIds.has(stop.symbolId)) {
          pushIssue(
            "REELS",
            "INVALID_SYMBOL_REFERENCE",
            `${sPath}.symbolId`,
            `Reel "${reelDef.id}" stop ${sIdx + 1} references unknown symbol "${stop.symbolId}".`,
            { reelId: reelDef.id, stopIndex: sIdx, symbolId: stop.symbolId },
          );
        }
        if (stop.weight !== undefined || useWeights) {
          const w = stop.weight ?? 1;
          if (!isFinitePositive(w)) {
            pushIssue(
              "REELS",
              "INVALID_REEL_CONFIG",
              `${sPath}.weight`,
              `Reel "${reelDef.id}" stop ${sIdx + 1} has invalid weight "${String(stop.weight)}" (must be finite and > 0).`,
              { reelId: reelDef.id, stopIndex: sIdx, weight: stop.weight },
            );
          }
        }
      });
    });
  }

  // 12. Validate Paylines
  const paylinesToCheck =
    bp.canonicalPaylines?.paylines ?? bp.paylines ?? [];
  const paylineIds = new Set<string>();
  const paylinePatterns = new Set<string>();

  if (evaluation === "lines") {
    const activeLines = paylinesToCheck.filter(
      (l) => ("enabled" in l ? l.enabled : l.active) !== false,
    );
    if (activeLines.length === 0) {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        "paylines",
        "Line-evaluated games must define at least one enabled payline.",
      );
    }
  }

  paylinesToCheck.forEach((line, lIdx) => {
    const lPath = `paylines[${lIdx}]`;
    if (!line.id || typeof line.id !== "string") {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        `${lPath}.id`,
        "Payline must have a non-empty string ID.",
      );
    } else if (paylineIds.has(line.id)) {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        `${lPath}.id`,
        `Duplicate payline ID "${line.id}".`,
        { paylineId: line.id },
      );
    } else {
      paylineIds.add(line.id);
    }

    if (!Array.isArray(line.pattern)) {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        `${lPath}.pattern`,
        `Payline "${line.id}" pattern must be an array of row indexes.`,
      );
      return;
    }

    if (validColumns && line.pattern.length !== columns) {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        `${lPath}.pattern`,
        `Payline "${line.id}" pattern length (${line.pattern.length}) must equal reelCount (${columns}).`,
        {
          paylineId: line.id,
          expected: columns,
          actual: line.pattern.length,
        },
      );
    }

    line.pattern.forEach((rowIdx, cIdx) => {
      if (
        typeof rowIdx !== "number" ||
        !Number.isInteger(rowIdx) ||
        rowIdx < 0 ||
        (validRows && rowIdx >= rows)
      ) {
        pushIssue(
          "PAYLINES",
          "INVALID_PAYLINE_CONFIG",
          `${lPath}.pattern[${cIdx}]`,
          `Payline "${line.id}" has out-of-bounds row index ${String(rowIdx)} at reel ${cIdx + 1} (valid: 0..${rows - 1}).`,
          { paylineId: line.id, reelIndex: cIdx, rowIndex: rowIdx, rows },
        );
      }
    });

    const patternKey = line.pattern.join(",");
    if (paylinePatterns.has(patternKey)) {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        `${lPath}.pattern`,
        `Duplicate payline pattern [${patternKey}] on payline "${line.id}".`,
        { paylineId: line.id, pattern: line.pattern },
      );
    } else {
      paylinePatterns.add(patternKey);
    }
  });

  // 13. Validate Paytable
  const maxBoardCells = validColumns && validRows ? columns * rows : 48;
  if (!Array.isArray(bp.paytable) || bp.paytable.length === 0) {
    pushIssue(
      "PAYTABLE",
      "INVALID_PAYTABLE",
      "paytable",
      "Paytable must contain at least one payout entry.",
    );
  } else {
    bp.paytable.forEach((entry, idx) => {
      const pPath = `paytable[${idx}]`;
      if (!mathAddressableIds.has(entry.symbolId)) {
        pushIssue(
          "PAYTABLE",
          "INVALID_SYMBOL_REFERENCE",
          `${pPath}.symbolId`,
          `Paytable entry ${idx} references unknown symbol "${entry.symbolId}".`,
          { symbolId: entry.symbolId, entryIndex: idx },
        );
      }
      if (
        typeof entry.ofAKind !== "number" ||
        !Number.isInteger(entry.ofAKind) ||
        entry.ofAKind < 1 ||
        entry.ofAKind > maxBoardCells
      ) {
        pushIssue(
          "PAYTABLE",
          "INVALID_PAYTABLE",
          `${pPath}.ofAKind`,
          `Paytable entry for "${entry.symbolId}" has invalid match count ${String(entry.ofAKind)}.`,
          { symbolId: entry.symbolId, ofAKind: entry.ofAKind },
        );
      }
      if (!isFiniteNonNegative(entry.payout)) {
        pushIssue(
          "PAYTABLE",
          "INVALID_PAYTABLE",
          `${pPath}.payout`,
          `Paytable entry for "${entry.symbolId}" (${entry.ofAKind}-of-a-kind) has invalid payout ${String(entry.payout)}.`,
          {
            symbolId: entry.symbolId,
            ofAKind: entry.ofAKind,
            payout: entry.payout,
          },
        );
      }
    });
  }

  if (bp.paytableDefinition) {
    bp.paytableDefinition.entries.forEach((entry, idx) => {
      const pPath = `paytableDefinition.entries[${idx}]`;
      if (!mathAddressableIds.has(entry.symbolId)) {
        pushIssue(
          "PAYTABLE",
          "INVALID_SYMBOL_REFERENCE",
          `${pPath}.symbolId`,
          `PaytableDefinition entry references unknown symbol "${entry.symbolId}".`,
          { symbolId: entry.symbolId },
        );
      }
      for (const [rawMatch, mult] of Object.entries(entry.payouts)) {
        const matchCount = Number(rawMatch);
        if (
          !Number.isInteger(matchCount) ||
          matchCount < 1 ||
          matchCount > maxBoardCells
        ) {
          pushIssue(
            "PAYTABLE",
            "INVALID_PAYTABLE",
            `${pPath}.payouts["${rawMatch}"]`,
            `PaytableDefinition entry for "${entry.symbolId}" has invalid match count "${rawMatch}".`,
          );
        }
        if (!isFiniteNonNegative(mult)) {
          pushIssue(
            "PAYTABLE",
            "INVALID_PAYTABLE",
            `${pPath}.payouts["${rawMatch}"]`,
            `PaytableDefinition entry for "${entry.symbolId}" has invalid multiplier "${String(mult)}".`,
          );
        }
      }
    });
  }

  // 14. Validate WinEvaluation, Ways, Cluster, PayAnywhere
  if (bp.winEvaluation) {
    if (!VALID_WIN_EVALUATION_TYPES.has(bp.winEvaluation.primaryMode)) {
      pushIssue(
        "GAME",
        "INVALID_GAME_CONFIG",
        "winEvaluation.primaryMode",
        `Invalid winEvaluation.primaryMode "${String(bp.winEvaluation.primaryMode)}".`,
      );
    }
    bp.winEvaluation.enabledModes.forEach((mode, idx) => {
      if (!VALID_WIN_EVALUATION_TYPES.has(mode)) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `winEvaluation.enabledModes[${idx}]`,
          `Invalid winEvaluation mode "${String(mode)}".`,
        );
      }
    });
  }

  if (bp.clusterConfiguration) {
    if (!VALID_CLUSTER_ADJACENCY.has(bp.clusterConfiguration.adjacency)) {
      pushIssue(
        "GAME",
        "INVALID_GAME_CONFIG",
        "clusterConfiguration.adjacency",
        `Invalid cluster adjacency "${String(bp.clusterConfiguration.adjacency)}".`,
      );
    }
    if (
      !Number.isInteger(bp.clusterConfiguration.minimumClusterSize) ||
      bp.clusterConfiguration.minimumClusterSize < 2
    ) {
      pushIssue(
        "GAME",
        "INVALID_GAME_CONFIG",
        "clusterConfiguration.minimumClusterSize",
        "clusterConfiguration.minimumClusterSize must be an integer >= 2.",
      );
    }
  }

  if (bp.payAnywhereConfiguration) {
    bp.payAnywhereConfiguration.symbolRules.forEach((rule, idx) => {
      if (!mathAddressableIds.has(rule.symbolId)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `payAnywhereConfiguration.symbolRules[${idx}].symbolId`,
          `PayAnywhere rule references unknown symbol "${rule.symbolId}".`,
        );
      }
    });
  }

  // 15. Validate Layers, Layer Groups, Canvas & Scenes
  const layerIds = new Set<string>();
  if (Array.isArray(bp.layers)) {
    bp.layers.forEach((layer, idx) => {
      if (!layer.id || typeof layer.id !== "string") {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `layers[${idx}].id`,
          "Layer must have a non-empty string ID.",
        );
      } else if (layerIds.has(layer.id)) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `layers[${idx}].id`,
          `Duplicate layer ID "${layer.id}".`,
        );
      } else {
        layerIds.add(layer.id);
      }
    });
  }

  if (bp.canvas) {
    checkAssetRef(bp.canvas.backgroundAssetId, "canvas.backgroundAssetId");
  }

  if (Array.isArray(bp.layerGroups)) {
    const groupIds = new Set<string>();
    bp.layerGroups.forEach((group, gIdx) => {
      const gPath = `layerGroups[${gIdx}]`;
      if (!group.id || groupIds.has(group.id)) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `${gPath}.id`,
          `Invalid or duplicate layerGroup ID "${String(group.id)}".`,
        );
      } else {
        groupIds.add(group.id);
      }
      group.childLayerIds.forEach((childId: string, cIdx: number) => {
        if (!layerIds.has(childId)) {
          pushIssue(
            "GAME",
            "INVALID_GAME_CONFIG",
            `${gPath}.childLayerIds[${cIdx}]`,
            `LayerGroup "${group.id}" references unknown child layer "${childId}".`,
          );
        }
      });
    });
  }

  if (Array.isArray(bp.scenes)) {
    const sceneIds = new Set<string>();
    bp.scenes.forEach((scene, sIdx) => {
      const sPath = `scenes[${sIdx}]`;
      if (!scene.id || sceneIds.has(scene.id)) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `${sPath}.id`,
          `Invalid or duplicate scene ID "${String(scene.id)}".`,
        );
      } else {
        sceneIds.add(scene.id);
      }
      const sceneOwnLayerIds = new Set(
        (scene.layers ?? []).map((l) => l.id),
      );
      scene.layerIds.forEach((lId, lIdx) => {
        if (!layerIds.has(lId) && !sceneOwnLayerIds.has(lId)) {
          pushIssue(
            "GAME",
            "INVALID_GAME_CONFIG",
            `${sPath}.layerIds[${lIdx}]`,
            `Scene "${scene.id}" references unknown layer "${lId}".`,
            { sceneId: scene.id, layerId: lId },
          );
        }
      });
      if (scene.background?.assetId) {
        checkAssetRef(
          scene.background.assetId,
          `${sPath}.background.assetId`,
        );
      }
      (scene.objects ?? []).forEach((obj, oIdx) => {
        const oPath = `${sPath}.objects[${oIdx}]`;
        if (!layerIds.has(obj.layerId) && !sceneOwnLayerIds.has(obj.layerId)) {
          pushIssue(
            "GAME",
            "INVALID_GAME_CONFIG",
            `${oPath}.layerId`,
            `Scene object "${obj.id}" references unknown layer "${obj.layerId}".`,
          );
        }
        checkAssetRef(obj.assetId, `${oPath}.assetId`);
      });
    });
  }

  // 16. Validate Animations
  const animationIds = new Set<string>();
  if (Array.isArray(bp.animations)) {
    bp.animations.forEach((anim, aIdx) => {
      const aPath = `animations[${aIdx}]`;
      if (!anim.id || animationIds.has(anim.id)) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `${aPath}.id`,
          `Invalid or duplicate animation ID "${String(anim.id)}".`,
        );
      } else {
        animationIds.add(anim.id);
      }
      if (anim.elementId && !elementIds.has(anim.elementId)) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `${aPath}.elementId`,
          `Animation "${anim.id}" references unknown elementId "${anim.elementId}".`,
        );
      }
      if (
        anim.target &&
        anim.target !== "standalone" &&
        !layerIds.has(anim.target) &&
        !symbolIds.has(anim.target) &&
        !elementIds.has(anim.target)
      ) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `${aPath}.target`,
          `Animation "${anim.id}" references unknown target "${anim.target}".`,
        );
      }
      checkAssetRef(
        anim.videoReference?.assetId,
        `${aPath}.videoReference.assetId`,
      );
      checkAssetRef(
        anim.spriteSheetReference?.assetId,
        `${aPath}.spriteSheetReference.assetId`,
      );
    });
  }

  if (Array.isArray(bp.canonicalAnimations)) {
    bp.canonicalAnimations.forEach((anim, aIdx) => {
      const aPath = `canonicalAnimations[${aIdx}]`;
      if (anim.elementId && !elementIds.has(anim.elementId)) {
        pushIssue(
          "GAME",
          "INVALID_GAME_CONFIG",
          `${aPath}.elementId`,
          `Canonical animation "${anim.id}" references unknown elementId "${anim.elementId}".`,
        );
      }
      if (anim.videoAsset?.provider === "project") {
        checkAssetRef(
          anim.videoAsset.assetId,
          `${aPath}.videoAsset.assetId`,
        );
      }
      if (anim.spriteSheetAsset?.provider === "project") {
        checkAssetRef(
          anim.spriteSheetAsset.assetId,
          `${aPath}.spriteSheetAsset.assetId`,
        );
      }
    });
  }

  return Object.freeze({
    valid: issues.length === 0,
    schemaVersion: BLUEPRINT_VERSION,
    engineVersion: ENGINE_VERSION,
    issues: Object.freeze(issues),
  });
}

export function assertValidGameDefinition(
  candidate: unknown,
): asserts candidate is GameBlueprint | GameDefinition {
  const result = validateGameDefinition(candidate);
  if (result.valid) return;

  const first = result.issues[0];
  const context = {
    schemaVersion: result.schemaVersion,
    engineVersion: result.engineVersion,
    issueCount: result.issues.length,
    issues: result.issues,
  };

  if (first.code === "UNSUPPORTED_GAME_SCHEMA") {
    throw new UnsupportedGameSchemaError(first.message, context);
  }
  if (first.code === "INVALID_SYMBOL_REFERENCE") {
    throw new InvalidSymbolReferenceError(first.message, context);
  }
  if (first.code === "INVALID_REEL_CONFIG") {
    throw new InvalidReelConfigError(first.message, context);
  }
  if (first.code === "INVALID_PAYLINE_CONFIG") {
    throw new InvalidPaylineConfigError(first.message, context);
  }
  if (first.code === "INVALID_PAYTABLE") {
    throw new InvalidPaytableError(first.message, context);
  }

  throw new InvalidGameConfigError(first.message, context);
}

/* -------------------------------------------------------------------------- */
/* DETERMINISTIC NORMALIZATION: GameBlueprint / GameDefinition -> GameDefinition */
/* -------------------------------------------------------------------------- */

function mapTierToValueTier(tier: SymbolDef["tier"]): ValueTier {
  if (tier === "mid") return "medium";
  return tier;
}

function deriveSymbolType(sym: SymbolDef): CanonicalSymbolType {
  if (sym.symbolType) return sym.symbolType;
  if (sym.tier === "special" || sym.isWild || sym.isScatter || sym.isBonus) {
    return "special";
  }
  if (sym.tier === "low") return "deck-rank";
  if (sym.tier === "high") return "character";
  return "custom";
}

function toSchemaAssetReference(
  assetId: string | null | undefined,
  imageRef?: SymbolDef["image"],
  role: SchemaAssetReference["role"] = "primary",
): SchemaAssetReference | null {
  if (imageRef) {
    return Object.freeze({
      assetId: imageRef.assetId ?? assetId ?? null,
      versionId: null,
      provider: imageRef.provider,
      source: imageRef.uri ?? null,
      role,
      crop: null,
      transform: null,
    });
  }
  if (assetId) {
    return Object.freeze({
      assetId,
      versionId: null,
      provider: "project" as const,
      source: null,
      role,
      crop: null,
      transform: null,
    });
  }
  return null;
}

/**
 * Deterministically normalizes a valid GameBlueprint or GameDefinition into a
 * complete, deep-frozen, canonical GameDefinition (`schemaVersion: "1.0"`).
 * Never mutates the input object and never repairs invalid references.
 */
export function normalizeGameDefinition(
  input: GameBlueprint | GameDefinition,
): GameDefinition {
  assertValidGameDefinition(input);

  const cloned = structuredClone(input) as Partial<GameDefinition> &
    GameBlueprint;

  const columns = cloned.reels.columns;
  const rows = cloned.reels.rows;
  const evaluation = cloned.reels.evaluation;
  const presetKey = `${columns}x${rows}`;
  const gridPreset: CanonicalGridConfiguration["preset"] =
    presetKey === "5x3" ||
    presetKey === "5x4" ||
    presetKey === "6x3" ||
    presetKey === "6x4"
      ? presetKey
      : "custom";

  const engineCompatibility: EngineCompatibilitySpec = Object.freeze({
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    minEngineVersion: "1.0.0",
    targetEngineVersion: ENGINE_VERSION,
  });

  // 1. Metadata
  const metadata: GameMetadata = Object.freeze({
    id: cloned.meta.id,
    title: cloned.meta.title,
    slug: cloned.meta.slug || slugify(cloned.meta.title),
    description: cloned.meta.description ?? "",
    theme: cloned.meta.theme,
    author: cloned.metadata?.author ?? cloned.meta.studio ?? "Slot Studio",
    studio: cloned.meta.studio ?? "Slot Studio",
    version: cloned.metadata?.version ?? "1.0.0",
    schemaVersion: BLUEPRINT_VERSION,
    createdAt: cloned.meta.createdAt,
    updatedAt: cloned.meta.updatedAt,
    tags: Object.freeze([...(cloned.meta.tags ?? [])]),
    ...(cloned.meta.folderPath ? { folderPath: cloned.meta.folderPath } : {}),
    thumbnail: cloned.metadata?.thumbnail ?? null,
    ...(cloned.metadata?.notes ? { notes: cloned.metadata.notes } : {}),
  });

  // 2. Game Identity Configuration
  const primaryGameMode: GameEvaluationMode =
    evaluation === "ways"
      ? "ways"
      : evaluation === "cluster"
        ? "clusters"
        : "fixedPaylines";
  const sortedBets = [...cloned.math.betLevels].sort((a, b) => a - b);
  const defaultBet = sortedBets.includes(1) ? 1 : (sortedBets[0] ?? 1);

  const game: GameIdentityConfig = Object.freeze({
    gameId: cloned.meta.id,
    displayName: cloned.meta.title,
    gameMode: cloned.game?.gameMode ?? primaryGameMode,
    supportedModes: Object.freeze(
      cloned.game?.supportedModes
        ? [...cloned.game.supportedModes]
        : [primaryGameMode],
    ),
    defaultBet: cloned.game?.defaultBet ?? defaultBet,
    betLevels: Object.freeze(sortedBets),
    rtpTarget: cloned.math.rtpTarget,
    volatility: cloned.math.volatility,
    maxWinX: cloned.math.maxWinX,
    hitFrequencyTarget: cloned.math.hitFrequency,
    denomination: Object.freeze({
      baseUnit: cloned.game?.denomination?.baseUnit ?? 1,
      currencyCode: cloned.game?.denomination?.currencyCode ?? null,
    }),
  });

  // 3. Style Guide
  const styleGuide: CanonicalStyleGuide = Object.freeze({
    name: cloned.styleGuide?.name ?? cloned.style.paletteName,
    description:
      cloned.styleGuide?.description ??
      (cloned.meta.styleGuide || cloned.style.artDirection),
    artStyle: cloned.styleGuide?.artStyle ?? cloned.style.artDirection,
    colorDirection:
      cloned.styleGuide?.colorDirection ?? cloned.style.paletteName,
    lighting: cloned.styleGuide?.lighting ?? cloned.style.mood,
    renderingStyle:
      cloned.styleGuide?.renderingStyle ??
      (cloned.creation?.stylePreset ?? "cinematic"),
    compositionGuidance:
      cloned.styleGuide?.compositionGuidance ??
      "Balanced reel framing with clear symbol silhouette separation.",
    characterGuidance:
      cloned.styleGuide?.characterGuidance ??
      "High-tier character symbols use distinct focal silhouettes.",
    symbolGuidance:
      cloned.styleGuide?.symbolGuidance ??
      "Consistent tier hierarchy from low royals to special symbols.",
    backgroundGuidance:
      cloned.styleGuide?.backgroundGuidance ??
      "High-contrast backdrop keeping the reel grid legible.",
    palette: Object.freeze({ ...cloned.style.palette }),
    typography: Object.freeze({ ...cloned.style.typography }),
    referenceAssetId: cloned.style.referenceAssetId ?? null,
  });

  // 4. Grid Configuration
  const aspect =
    cloned.grid?.aspectRatio ??
    cloned.creation?.elements.aspect ??
    `${cloned.canvas.width}:${cloned.canvas.height}`;
  const grid: CanonicalGridConfiguration = Object.freeze({
    reelCount: columns,
    rowCount: rows,
    columns,
    rows,
    preset: cloned.grid?.preset ?? cloned.creation?.gridPreset ?? gridPreset,
    evaluation,
    cellWidth:
      cloned.grid?.cellWidth ?? Math.floor(cloned.canvas.width / (columns + 2)),
    cellHeight:
      cloned.grid?.cellHeight ?? Math.floor(cloned.canvas.height / (rows + 2)),
    aspectRatio: aspect,
    orientation: cloned.canvas.orientation,
    minReels: cloned.grid?.minReels ?? columns,
    maxReels: cloned.grid?.maxReels ?? columns,
    minRows: cloned.grid?.minRows ?? rows,
    maxRows: cloned.grid?.maxRows ?? rows,
  });

  // 5–8. Symbols, Roles, Variants & Families
  const specialsBySymbolId = new Map<
    string,
    Array<{
      behaviour: SpecialBehaviour;
      params: Record<string, number | string | boolean>;
    }>
  >();
  for (const sp of cloned.specialSymbols ?? []) {
    const list = specialsBySymbolId.get(sp.symbolId) ?? [];
    list.push({ behaviour: sp.behaviour, params: { ...sp.params } });
    specialsBySymbolId.set(sp.symbolId, list);
  }

  const canonicalSymbols: CanonicalSymbolDefinition[] = cloned.symbols.map(
    (sym) => {
      const specials = specialsBySymbolId.get(sym.id) ?? [];
      const rolesSet = new Set<SymbolRoleType>();
      const roleConfigs: SymbolRoleConfig[] = [];

      if (sym.isWild || specials.some((s) => s.behaviour === "wild")) {
        rolesSet.add("wild");
        const wSpec = specials.find((s) => s.behaviour === "wild");
        roleConfigs.push(
          Object.freeze({
            role: "wild",
            substitutesScatter: Boolean(
              wSpec?.params.substitutesScatter ?? false,
            ),
            multiplier:
              typeof wSpec?.params.multiplier === "number"
                ? wSpec.params.multiplier
                : 1,
          }),
        );
      }
      if (sym.isScatter || specials.some((s) => s.behaviour === "scatter")) {
        rolesSet.add("scatter");
        const sSpec = specials.find((s) => s.behaviour === "scatter");
        roleConfigs.push(
          Object.freeze({
            role: "scatter",
            triggerCount:
              typeof sSpec?.params.triggerCount === "number"
                ? sSpec.params.triggerCount
                : 3,
            awardsFreeSpins:
              typeof sSpec?.params.awardsFreeSpins === "number"
                ? sSpec.params.awardsFreeSpins
                : 10,
          }),
        );
      }
      if (sym.isBonus || specials.some((s) => s.behaviour === "bonus")) {
        rolesSet.add("bonus");
        const bSpec = specials.find((s) => s.behaviour === "bonus");
        roleConfigs.push(
          Object.freeze({
            role: "bonus",
            triggerCount:
              typeof bSpec?.params.triggerCount === "number"
                ? bSpec.params.triggerCount
                : 3,
            featureId: null,
          }),
        );
      }
      for (const sp of specials) {
        if (sp.behaviour === "multiplier") {
          rolesSet.add("multiplier");
          roleConfigs.push(
            Object.freeze({
              role: "multiplier",
              multiplier:
                typeof sp.params.multiplier === "number"
                  ? sp.params.multiplier
                  : 2,
            }),
          );
        } else if (sp.behaviour === "expanding" || sp.behaviour === "sticky") {
          rolesSet.add(sp.behaviour);
          roleConfigs.push(
            Object.freeze({
              role: sp.behaviour,
              params: Object.freeze({ ...sp.params }),
            }),
          );
        }
      }
      if (rolesSet.size === 0) {
        rolesSet.add("regular");
        roleConfigs.push(Object.freeze({ role: "regular" }));
      }

      const roles = Object.freeze(Array.from(rolesSet));
      const familyId = sym.family ?? null;

      const variants: CanonicalSymbolVariant[] = (sym.variants ?? []).map(
        (v: SymbolVariant) =>
          Object.freeze({
            id: v.id,
            baseSymbolId: sym.id,
            name: v.name,
            asset: toSchemaAssetReference(null, v.image, "variant"),
            roles,
            familyId,
            addressableInMath: true,
            extras: Object.freeze({ ...(v.extras ?? {}) }),
            ...(v.description ? { description: v.description } : {}),
            ...(v.tags ? { tags: Object.freeze([...v.tags]) } : {}),
          }),
      );

      const payoutsCopy: Record<string, number> = {};
      for (const [k, val] of Object.entries(sym.payouts ?? {}).sort(
        (a, b) => Number(a[0]) - Number(b[0]),
      )) {
        payoutsCopy[k] = val;
      }

      return Object.freeze({
        id: sym.id,
        code: sym.code,
        name: sym.name,
        type: deriveSymbolType(sym),
        tier: sym.tier,
        valueTier: mapTierToValueTier(sym.tier),
        asset: toSchemaAssetReference(sym.assetId, sym.image, "primary"),
        symbolSetId: sym.symbolSetId ?? null,
        familyId,
        roles,
        roleConfigs: Object.freeze(roleConfigs),
        variants: Object.freeze(variants),
        extras: Object.freeze({ ...(sym.extras ?? {}) }),
        payouts: Object.freeze(payoutsCopy),
        reelWeight: sym.reelWeight,
        enabled: true,
        ...(sym.description ? { description: sym.description } : {}),
        ...(sym.tags ? { tags: Object.freeze([...sym.tags]) } : {}),
      });
    },
  );

  // Derive or preserve symbolFamilies
  let symbolFamilies: SymbolFamilyDefinition[] = [];
  if (
    Array.isArray(cloned.symbolFamilies) &&
    cloned.symbolFamilies.length > 0
  ) {
    symbolFamilies = cloned.symbolFamilies.map((f) =>
      Object.freeze({
        id: f.id,
        name: f.name,
        ...(f.description ? { description: f.description } : {}),
        baseSymbolId: f.baseSymbolId ?? null,
        memberIds: Object.freeze([...f.memberIds]),
        allowMixedCounting: Boolean(f.allowMixedCounting),
      }),
    );
  } else {
    const membersByFamily = new Map<string, string[]>();
    for (const cSym of canonicalSymbols) {
      if (cSym.familyId) {
        const list = membersByFamily.get(cSym.familyId) ?? [];
        list.push(cSym.id);
        for (const v of cSym.variants) {
          list.push(v.id);
        }
        membersByFamily.set(cSym.familyId, list);
      }
    }
    for (const [famId, members] of membersByFamily.entries()) {
      symbolFamilies.push(
        Object.freeze({
          id: famId,
          name: famId,
          baseSymbolId: members[0] ?? null,
          memberIds: Object.freeze(members),
          allowMixedCounting: true,
        }),
      );
    }
  }

  // 10. Canonical Assets
  const canonicalAssets: AssetDefinition[] = (cloned.assets ?? []).map(
    (asset: AssetRef) => {
      const mappedType: CanonicalAssetType =
        asset.kind === "sprite"
          ? "spriteSheet"
          : asset.kind === "image" && asset.format === "svg"
            ? "vector"
            : asset.kind;
      const format: AssetFormat = asset.format ?? "png";
      return Object.freeze({
        id: asset.id,
        name: asset.name,
        type: mappedType,
        source: asset.uri ?? null,
        state: asset.state,
        width: asset.width ?? null,
        height: asset.height ?? null,
        format,
        tags: Object.freeze([...(asset.tags ?? [])]),
        metadata: Object.freeze({
          ...(asset.mime ? { mime: asset.mime } : {}),
          ...(typeof asset.sizeBytes === "number"
            ? { sizeBytes: asset.sizeBytes }
            : {}),
          ...(typeof asset.hasAlpha === "boolean"
            ? { hasAlpha: asset.hasAlpha }
            : {}),
        }),
      });
    },
  );

  // 11. Canonical Symbol Sets
  const canonicalSymbolSets: SymbolSetDefinition[] = (
    cloned.symbolSets ?? []
  ).map((set: SymbolSetDef) =>
    Object.freeze({
      id: set.id,
      name: set.name,
      symbolType: (set.symbolType ?? "custom") as CanonicalSymbolType,
      tier: set.valueTier ?? "low",
      description: set.description ?? "",
      ...(set.styleGuide ? { commonStyle: set.styleGuide } : {}),
      frame: toSchemaAssetReference(null, set.frame, "frame"),
      background: toSchemaAssetReference(null, set.background, "background"),
      symbolIds: Object.freeze([...set.symbolIds]),
      styleGuideReference: set.styleGuide ?? styleGuide.name,
      ...(set.tags ? { tags: Object.freeze([...set.tags]) } : {}),
    }),
  );

  // 12. Canonical Standalone Elements
  const canonicalElements: ElementDefinition[] = (cloned.elements ?? []).map(
    (el: ElementDef) =>
      Object.freeze({
        id: el.id,
        type: el.type,
        name: el.name,
        group: el.group,
        asset: toSchemaAssetReference(el.assetId, el.image, "primary"),
        symbolIds: Object.freeze([...(el.symbolIds ?? [])]),
        variants: Object.freeze(
          (el.variants ?? []).map((v) =>
            Object.freeze({
              id: v.id,
              baseSymbolId: el.id,
              name: v.name,
              asset: toSchemaAssetReference(null, v.image, "variant"),
              roles: Object.freeze(["regular" as const]),
              familyId: null,
              addressableInMath: false,
              extras: Object.freeze({ ...(v.extras ?? {}) }),
            }),
          ),
        ),
        extras: Object.freeze({ ...(el.extras ?? {}) }),
        metadata: Object.freeze({
          origin: el.origin,
          notes: el.notes ?? "",
          ...(el.description ? { description: el.description } : {}),
          ...(el.animationExtra ? { animationExtra: el.animationExtra } : {}),
        }),
      }),
  );

  // 13–16. Canvas, Layers, Layer Groups & Scenes
  const canvasConfiguration = Object.freeze({
    width: cloned.canvas.width,
    height: cloned.canvas.height,
    aspectRatio: aspect,
    safeArea: Object.freeze({ ...cloned.canvas.safeArea }),
    orientation: cloned.canvas.orientation,
    backgroundColor: styleGuide.palette.background,
    backgroundAssetId: cloned.canvas.backgroundAssetId,
    grid: Object.freeze({ enabled: true, size: 16 }),
    guides: Object.freeze({ enabled: true }),
    snapSettings: Object.freeze({ snapToGrid: true, snapToObjects: true }),
  });

  const normalizeLayer = (layer: LayerDef, idx: number): LayerDefinition =>
    Object.freeze({
      id: layer.id,
      name: layer.name,
      type: (layer.type ?? layer.kind) as CanonicalLayerType,
      source: Object.freeze({
        refKind: "none" as const,
        refId: null,
      }),
      order: typeof layer.order === "number" ? layer.order : idx,
      visible: layer.visible !== false,
      locked: Boolean(layer.locked),
      opacity: typeof layer.opacity === "number" ? layer.opacity : 1,
      transform: Object.freeze({
        x: layer.transform?.x ?? 0,
        y: layer.transform?.y ?? 0,
        width: layer.transform?.width ?? cloned.canvas.width,
        height: layer.transform?.height ?? cloned.canvas.height,
        rotation: layer.transform?.rotation ?? 0,
        scaleX: layer.transform?.scaleX ?? 1,
        scaleY: layer.transform?.scaleY ?? 1,
      }),
      parentId: layer.parentId ?? null,
      groupId: layer.groupId ?? null,
      blendMode: layer.blendMode ?? "normal",
    });

  const canonicalLayers: LayerDefinition[] = [...(cloned.layers ?? [])]
    .sort((a, b) => a.order - b.order)
    .map(normalizeLayer);

  const layerGroups: LayerGroupDefinition[] = cloned.layerGroups
    ? cloned.layerGroups.map((g) =>
        Object.freeze({
          id: g.id,
          name: g.name,
          childLayerIds: Object.freeze([...g.childLayerIds]),
          parentGroupId: g.parentGroupId ?? null,
        }),
      )
    : canonicalLayers
        .filter((l) => l.type === "group")
        .map((groupLayer) =>
          Object.freeze({
            id: groupLayer.id,
            name: groupLayer.name,
            childLayerIds: Object.freeze(
              canonicalLayers
                .filter(
                  (child) =>
                    child.groupId === groupLayer.id ||
                    child.parentId === groupLayer.id,
                )
                .map((child) => child.id),
            ),
            parentGroupId: groupLayer.parentId,
          }),
        );

  const canonicalScenes: SceneDefinition[] = (cloned.scenes ?? []).map(
    (scene: SceneDef) => {
      const sceneLayerDefs =
        scene.layers && scene.layers.length > 0
          ? scene.layers.map(normalizeLayer)
          : canonicalLayers.filter((l) => scene.layerIds.includes(l.id));

      return Object.freeze({
        id: scene.id,
        name: scene.name,
        kind: scene.kind,
        entryTransition: scene.entryTransition || "fade",
        canvas: scene.canvasConfiguration
          ? Object.freeze({
              ...canvasConfiguration,
              width: scene.canvasConfiguration.width,
              height: scene.canvasConfiguration.height,
              safeArea: Object.freeze({
                ...scene.canvasConfiguration.safeArea,
              }),
              orientation: scene.canvasConfiguration.orientation,
            })
          : canvasConfiguration,
        background: Object.freeze({
          color: scene.background?.color ?? styleGuide.palette.background,
          assetId:
            scene.background?.assetId ?? cloned.canvas.backgroundAssetId,
          ...(scene.background?.imageUri
            ? { imageUri: scene.background.imageUri }
            : {}),
          fit: scene.background?.fit ?? "cover",
        }),
        layerIds: Object.freeze([...scene.layerIds]),
        layers: Object.freeze(sceneLayerDefs),
        ...(scene.composedImages
          ? { composedAssets: Object.freeze([...scene.composedImages]) }
          : {}),
        ...(scene.visibility
          ? { visibilityOverrides: Object.freeze({ ...scene.visibility }) }
          : {}),
      });
    },
  );

  // 17–20. Canonical Reel Configuration
  const useWeights = Boolean(
    cloned.canonicalReels?.useWeights ??
      cloned.reelConfiguration?.weightsEnabled ??
      cloned.reels.weightsEnabled,
  );
  const detailedReelSource =
    cloned.canonicalReels?.reels ??
    cloned.reelConfiguration?.reels ??
    cloned.reels.reels;

  const reelDefinitions: ReelDefinition[] = [];
  for (let rIdx = 0; rIdx < columns; rIdx += 1) {
    const existingReel = detailedReelSource?.[rIdx];
    const reelId = existingReel?.id ?? `reel-${rIdx + 1}`;
    const reelName = existingReel?.name ?? `Reel ${rIdx + 1}`;
    const stops: ReelStopDefinition[] =
      existingReel && existingReel.stops.length > 0
        ? existingReel.stops.map((st, sIdx) =>
            Object.freeze({
              id: st.id || `${reelId}-stop-${sIdx + 1}`,
              position: st.position || sIdx + 1,
              symbolId: st.symbolId,
              ...(useWeights || st.weight !== undefined
                ? { weight: st.weight ?? 1 }
                : {}),
            }),
          )
        : cloned.reels.strips[rIdx].map((symId, sIdx) =>
            Object.freeze({
              id: `${reelId}-stop-${sIdx + 1}`,
              position: sIdx + 1,
              symbolId: symId,
              ...(useWeights ? { weight: 1 } : {}),
            }),
          );

    reelDefinitions.push(
      Object.freeze({
        id: reelId,
        index: rIdx,
        name: reelName,
        visibleRows: rows,
        stops: Object.freeze(stops),
      }),
    );
  }

  const canonicalReels: CanonicalReelConfiguration = Object.freeze({
    reelCount: columns,
    rowCount: rows,
    spinDirection: cloned.reels.spinDirection ?? "down",
    useWeights,
    reels: Object.freeze(reelDefinitions),
  });

  // 21–22. Canonical Payline Configuration
  const DEFAULT_PAYLINE_COLORS = [
    "#f5b041",
    "#5dade2",
    "#58d68d",
    "#ec7063",
    "#af7ac5",
    "#48c9b0",
    "#f4d03f",
    "#eb984e",
  ];
  const paylineDefs: PaylineDefinition[] = (cloned.paylines ?? []).map(
    (line: PaylineDef, idx: number) =>
      Object.freeze({
        id: line.id,
        index: line.index || idx + 1,
        name: line.name ?? `Line ${line.index || idx + 1}`,
        pattern: Object.freeze([...line.pattern]),
        enabled: line.active !== false,
        color:
          line.color ??
          DEFAULT_PAYLINE_COLORS[idx % DEFAULT_PAYLINE_COLORS.length],
      }),
  );

  const canonicalPaylines: CanonicalPaylineConfiguration = Object.freeze({
    enabled: evaluation === "lines",
    reelCount: columns,
    rowCount: rows,
    paylines: Object.freeze(paylineDefs),
  });

  // 23. Win Evaluation Model
  const primaryWinEvalMode: WinEvaluationType =
    evaluation === "ways"
      ? "ways"
      : evaluation === "cluster"
        ? "clusters"
        : "fixedPaylines";
  const hasScatters = canonicalSymbols.some((s) =>
    s.roles.includes("scatter"),
  );
  const enabledWinModes: WinEvaluationType[] = [primaryWinEvalMode];
  if (hasScatters && !enabledWinModes.includes("scatters")) {
    enabledWinModes.push("scatters");
  }

  const winEvaluation: WinEvaluationDefinition = Object.freeze({
    primaryMode: cloned.winEvaluation?.primaryMode ?? primaryWinEvalMode,
    enabledModes: Object.freeze(
      cloned.winEvaluation?.enabledModes
        ? [...cloned.winEvaluation.enabledModes]
        : enabledWinModes,
    ),
    direction: cloned.winEvaluation?.direction ?? "leftToRight",
    highestWinOnlyPerLine:
      cloned.winEvaluation?.highestWinOnlyPerLine ?? true,
    allowSimultaneousLineAndScatterWins:
      cloned.winEvaluation?.allowSimultaneousLineAndScatterWins ?? true,
    familyCountingEnabled:
      cloned.winEvaluation?.familyCountingEnabled ??
      symbolFamilies.length > 0,
  });

  // 24–25. Paytable Definition
  const payoutsBySymbol = new Map<string, Map<number, number>>();
  for (const sym of canonicalSymbols) {
    const map = new Map<number, number>();
    for (const [k, v] of Object.entries(sym.payouts)) {
      map.set(Number(k), v);
    }
    payoutsBySymbol.set(sym.id, map);
  }
  for (const entry of cloned.paytable ?? []) {
    const map =
      payoutsBySymbol.get(entry.symbolId) ?? new Map<number, number>();
    map.set(entry.ofAKind, entry.payout);
    payoutsBySymbol.set(entry.symbolId, map);
  }

  const canonicalPaytableEntries: CanonicalPaytableSymbolEntry[] = [];
  let minMatchCount = columns;
  for (const [symId, map] of payoutsBySymbol.entries()) {
    const payoutsObj: Record<number, number> = {};
    for (const [cnt, mult] of Array.from(map.entries()).sort(
      (a, b) => a[0] - b[0],
    )) {
      payoutsObj[cnt] = mult;
      if (cnt < minMatchCount) minMatchCount = cnt;
    }
    canonicalPaytableEntries.push(
      Object.freeze({
        symbolId: symId,
        payouts: Object.freeze(payoutsObj),
      }),
    );
  }

  const paytableDefinition: PaytableDefinition = Object.freeze({
    payoutType: "multiplier",
    betBasis: evaluation === "lines" ? "perLine" : "totalBet",
    minMatchCount: Number.isFinite(minMatchCount) ? minMatchCount : 3,
    entries: Object.freeze(canonicalPaytableEntries),
  });

  // 26. Wild Configuration
  const wildSymbols = canonicalSymbols.filter((s) =>
    s.roles.includes("wild"),
  );
  const nonRegularIds = canonicalSymbols
    .filter((s) => s.roles.includes("scatter") || s.roles.includes("bonus"))
    .map((s) => s.id);
  const allReelIndexes = Array.from({ length: columns }, (_, i) => i);

  const wildSubstitutionRules: WildSubstitutionRule[] =
    cloned.wildConfiguration?.substitutionRules
      ? cloned.wildConfiguration.substitutionRules.map((r) =>
          Object.freeze({
            wildSymbolId: r.wildSymbolId,
            allowedSubstitutions: Array.isArray(r.allowedSubstitutions)
              ? Object.freeze([...r.allowedSubstitutions])
              : "allRegular",
            excludedSymbolIds: Object.freeze([...r.excludedSymbolIds]),
            activeReels: Object.freeze([...r.activeReels]),
            activeModes: Object.freeze([...r.activeModes]),
            paysOnOwn: Boolean(r.paysOnOwn),
            multiplier: r.multiplier,
          }),
        )
      : wildSymbols.map((wSym) => {
          const wRole = wSym.roleConfigs.find((rc) => rc.role === "wild");
          const substitutesScatter =
            wRole && "substitutesScatter" in wRole
              ? wRole.substitutesScatter
              : false;
          const mult =
            wRole && "multiplier" in wRole ? wRole.multiplier : 1;
          return Object.freeze({
            wildSymbolId: wSym.id,
            allowedSubstitutions: "allRegular" as const,
            excludedSymbolIds: Object.freeze(
              substitutesScatter ? [] : [...nonRegularIds],
            ),
            activeReels: Object.freeze([...allReelIndexes]),
            activeModes: Object.freeze([
              "base" as const,
              "freeSpins" as const,
              "bonus" as const,
            ]),
            paysOnOwn: Object.keys(wSym.payouts).length > 0,
            multiplier: mult,
          });
        });

  const wildConfiguration: WildConfiguration = Object.freeze({
    enabled:
      cloned.wildConfiguration?.enabled ?? wildSymbols.length > 0,
    symbolIds: Object.freeze(
      cloned.wildConfiguration?.symbolIds
        ? [...cloned.wildConfiguration.symbolIds]
        : wildSymbols.map((s) => s.id),
    ),
    substitutionRules: Object.freeze(wildSubstitutionRules),
  });

  // 27. Scatter Configuration
  const scatterSymbols = canonicalSymbols.filter((s) =>
    s.roles.includes("scatter"),
  );
  const freeSpinFeature = (cloned.features ?? []).find(
    (f) => f.kind === "free_spins",
  );
  const scatterRules: ScatterRule[] = cloned.scatterConfiguration?.rules
    ? cloned.scatterConfiguration.rules.map((r) =>
        Object.freeze({
          scatterSymbolId: r.scatterSymbolId,
          evaluatesAnywhere: Boolean(r.evaluatesAnywhere),
          independentOfPaylines: Boolean(r.independentOfPaylines),
          payoutReferenceSymbolId: r.payoutReferenceSymbolId,
          triggerFeatureId: r.triggerFeatureId,
          minimumTriggerCount: r.minimumTriggerCount,
        }),
      )
    : scatterSymbols.map((sSym) => {
        const sRole = sSym.roleConfigs.find((rc) => rc.role === "scatter");
        const triggerCount =
          sRole && "triggerCount" in sRole ? sRole.triggerCount : 3;
        return Object.freeze({
          scatterSymbolId: sSym.id,
          evaluatesAnywhere: true,
          independentOfPaylines: true,
          payoutReferenceSymbolId: sSym.id,
          triggerFeatureId: freeSpinFeature?.id ?? null,
          minimumTriggerCount: triggerCount,
        });
      });

  const scatterConfiguration: ScatterConfiguration = Object.freeze({
    enabled:
      cloned.scatterConfiguration?.enabled ?? scatterSymbols.length > 0,
    symbolIds: Object.freeze(
      cloned.scatterConfiguration?.symbolIds
        ? [...cloned.scatterConfiguration.symbolIds]
        : scatterSymbols.map((s) => s.id),
    ),
    rules: Object.freeze(scatterRules),
  });

  // 28–30. Ways, Cluster & PayAnywhere Configurations
  const waysConfiguration: WaysConfiguration = Object.freeze({
    enabled: cloned.waysConfiguration?.enabled ?? evaluation === "ways",
    startReelIndex: cloned.waysConfiguration?.startReelIndex ?? 0,
    endReelIndex: cloned.waysConfiguration?.endReelIndex ?? columns - 1,
    minimumConsecutiveReels:
      cloned.waysConfiguration?.minimumConsecutiveReels ?? 3,
    countingRule:
      cloned.waysConfiguration?.countingRule ??
      "multiplyMatchingReelPositions",
    totalWaysCount:
      cloned.waysConfiguration?.totalWaysCount ?? Math.pow(rows, columns),
  });

  const clusterConfiguration: ClusterConfiguration = Object.freeze({
    enabled:
      cloned.clusterConfiguration?.enabled ?? evaluation === "cluster",
    minimumClusterSize:
      cloned.clusterConfiguration?.minimumClusterSize ?? 5,
    adjacency: cloned.clusterConfiguration?.adjacency ?? "edge",
    allowWildJoin: cloned.clusterConfiguration?.allowWildJoin ?? true,
    allowFamilyGrouping:
      cloned.clusterConfiguration?.allowFamilyGrouping ??
      symbolFamilies.length > 0,
  });

  const payAnywhereConfiguration: PayAnywhereConfiguration = Object.freeze({
    enabled: cloned.payAnywhereConfiguration?.enabled ?? false,
    minimumMatchCount:
      cloned.payAnywhereConfiguration?.minimumMatchCount ?? 8,
    symbolRules: Object.freeze(
      cloned.payAnywhereConfiguration?.symbolRules
        ? cloned.payAnywhereConfiguration.symbolRules.map((r) =>
            Object.freeze({ ...r }),
          )
        : [],
    ),
  });

  // 31–34. Canonical Features, Triggers, Free Spins & Multipliers
  const defaultScatterId = scatterSymbols[0]?.id ?? null;
  const canonicalFeatures: FeatureDefinition[] = cloned.canonicalFeatures
    ? cloned.canonicalFeatures.map((f) =>
        Object.freeze({
          id: f.id,
          type: f.type,
          name: f.name,
          enabled: Boolean(f.enabled),
          trigger: f.trigger ? Object.freeze({ ...f.trigger }) : null,
          configuration: Object.freeze({ ...f.configuration }),
        }),
      )
    : (cloned.features ?? []).map((feat: FeatureConfig) => {
        const mappedType: CanonicalFeatureType =
          feat.kind === "free_spins" ? "freeSpins" : feat.kind;
        let trigger: FeatureTriggerDefinition | null = null;
        if (feat.kind === "free_spins" && defaultScatterId) {
          trigger = Object.freeze({
            source: "scatterCount" as const,
            symbolId: defaultScatterId,
            minCount:
              typeof feat.params.triggerCount === "number"
                ? feat.params.triggerCount
                : 3,
          });
        }
        return Object.freeze({
          id: feat.id,
          type: mappedType,
          name: feat.name,
          enabled: Boolean(feat.enabled),
          trigger,
          configuration: Object.freeze({ ...feat.params }),
        });
      });

  const fsSpinsParam = freeSpinFeature?.params.spins;
  const fsMultParam = freeSpinFeature?.params.multiplier;
  const freeSpinsConfiguration: FreeSpinsConfiguration = Object.freeze({
    enabled:
      cloned.freeSpinsConfiguration?.enabled ??
      Boolean(freeSpinFeature?.enabled),
    featureId:
      cloned.freeSpinsConfiguration?.featureId ??
      (freeSpinFeature?.id ?? null),
    initialSpins:
      cloned.freeSpinsConfiguration?.initialSpins ??
      (typeof fsSpinsParam === "number" ? fsSpinsParam : 10),
    retriggers:
      cloned.freeSpinsConfiguration?.retriggers ??
      Boolean(freeSpinFeature?.params.retrigger ?? true),
    retriggerSpinsAwarded:
      cloned.freeSpinsConfiguration?.retriggerSpinsAwarded ??
      (typeof fsSpinsParam === "number" ? fsSpinsParam : 10),
    maxSpins: cloned.freeSpinsConfiguration?.maxSpins ?? 100,
    multiplierMode:
      cloned.freeSpinsConfiguration?.multiplierMode ?? "fixed",
    baseMultiplier:
      cloned.freeSpinsConfiguration?.baseMultiplier ??
      (typeof fsMultParam === "number" ? fsMultParam : 2),
    reelConfigurationReference:
      cloned.freeSpinsConfiguration?.reelConfigurationReference ?? null,
    featureReferences: Object.freeze(
      cloned.freeSpinsConfiguration?.featureReferences
        ? [...cloned.freeSpinsConfiguration.featureReferences]
        : freeSpinFeature
          ? [freeSpinFeature.id]
          : [],
    ),
  });

  const multiplierConfiguration: MultiplierConfiguration = Object.freeze({
    enabled: cloned.multiplierConfiguration?.enabled ?? false,
    baseMultiplier: cloned.multiplierConfiguration?.baseMultiplier ?? 1,
    increment: cloned.multiplierConfiguration?.increment ?? 1,
    maximum: cloned.multiplierConfiguration?.maximum ?? 10,
    scope: cloned.multiplierConfiguration?.scope ?? "spin",
  });

  // 35–38. Board Dynamics & Advanced Reel Mechanics
  const boardDynamics: BoardDynamicsConfiguration = Object.freeze({
    cascades: Object.freeze({
      enabled: cloned.boardDynamics?.cascades.enabled ?? false,
      mode: cloned.boardDynamics?.cascades.mode ?? "tumble",
      maxCascades: cloned.boardDynamics?.cascades.maxCascades ?? 20,
    }),
    boardResize: Object.freeze({
      enabled: cloned.boardDynamics?.boardResize.enabled ?? false,
      minReels: cloned.boardDynamics?.boardResize.minReels ?? columns,
      maxReels: cloned.boardDynamics?.boardResize.maxReels ?? columns,
      minRows: cloned.boardDynamics?.boardResize.minRows ?? rows,
      maxRows: cloned.boardDynamics?.boardResize.maxRows ?? rows,
    }),
    symbolInjection: Object.freeze({
      enabled: cloned.boardDynamics?.symbolInjection.enabled ?? false,
      candidateSymbolIds: Object.freeze([
        ...(cloned.boardDynamics?.symbolInjection.candidateSymbolIds ?? []),
      ]),
    }),
    symbolRemoval: Object.freeze({
      enabled: cloned.boardDynamics?.symbolRemoval.enabled ?? false,
      removableSymbolIds: Object.freeze([
        ...(cloned.boardDynamics?.symbolRemoval.removableSymbolIds ?? []),
      ]),
    }),
    mysterySymbols: Object.freeze({
      enabled: cloned.boardDynamics?.mysterySymbols.enabled ?? false,
      mysterySymbolIds: Object.freeze([
        ...(cloned.boardDynamics?.mysterySymbols.mysterySymbolIds ?? []),
      ]),
      targetSymbolIds: Object.freeze([
        ...(cloned.boardDynamics?.mysterySymbols.targetSymbolIds ?? []),
      ]),
    }),
    colossalSymbols: Object.freeze({
      enabled: cloned.boardDynamics?.colossalSymbols.enabled ?? false,
      allowedSizes: Object.freeze(
        cloned.boardDynamics?.colossalSymbols.allowedSizes
          ? [...cloned.boardDynamics.colossalSymbols.allowedSizes]
          : (["2x2", "3x3"] as const),
      ),
      eligibleSymbolIds: Object.freeze([
        ...(cloned.boardDynamics?.colossalSymbols.eligibleSymbolIds ?? []),
      ]),
    }),
    lockedCells: Object.freeze({
      enabled: cloned.boardDynamics?.lockedCells.enabled ?? false,
      maxLockedCells:
        cloned.boardDynamics?.lockedCells.maxLockedCells ?? columns * rows,
      lockDurationSpins:
        cloned.boardDynamics?.lockedCells.lockDurationSpins ?? 1,
    }),
  });

  const variableReelHeights: VariableReelHeightConfiguration = Object.freeze({
    enabled: cloned.variableReelHeights?.enabled ?? false,
    perReelRowCounts: Object.freeze(
      cloned.variableReelHeights?.perReelRowCounts
        ? [...cloned.variableReelHeights.perReelRowCounts]
        : new Array<number>(columns).fill(rows),
    ),
    minRowsPerReel: cloned.variableReelHeights?.minRowsPerReel ?? rows,
    maxRowsPerReel: cloned.variableReelHeights?.maxRowsPerReel ?? rows,
  });

  const reelNudges: ReelNudgeConfiguration = Object.freeze({
    enabled: cloned.reelNudges?.enabled ?? false,
    maxNudgeSteps: cloned.reelNudges?.maxNudgeSteps ?? 1,
    eligibleReels: Object.freeze(
      cloned.reelNudges?.eligibleReels
        ? [...cloned.reelNudges.eligibleReels]
        : [...allReelIndexes],
    ),
    direction: cloned.reelNudges?.direction ?? "both",
  });

  const linkedReels: LinkedReelsConfiguration = Object.freeze({
    enabled: cloned.linkedReels?.enabled ?? false,
    links: Object.freeze(
      cloned.linkedReels?.links
        ? cloned.linkedReels.links.map((l) =>
            Object.freeze({
              sourceReel: l.sourceReel,
              targetReels: Object.freeze([...l.targetReels]),
              mappingMode: l.mappingMode,
            }),
          )
        : [],
    ),
  });

  // 39–41. Canonical Animations, Export & Schema Extensions
  const mapAnimType = (
    rawType?: string,
  ): CanonicalAnimationType => {
    if (rawType === "Background") return "background";
    if (rawType === "Symbol Win") return "symbolWin";
    if (rawType === "Standalone") return "standalone";
    if (rawType === "Hover") return "hover";
    return "custom";
  };

  const canonicalAnimations: AnimationDefinition[] = (
    cloned.animations ?? []
  ).map((anim) =>
    Object.freeze({
      id: anim.id,
      name: anim.name ?? anim.id,
      elementId: anim.elementId ?? null,
      targetId: anim.target,
      type: mapAnimType(anim.animationType),
      source: anim.source ?? "preset",
      format: anim.format ?? "css",
      trigger: anim.trigger,
      durationMs: anim.durationMs,
      fps: anim.fps ?? 60,
      loop: Boolean(anim.loop),
      enabled: anim.state !== "disabled",
      videoAsset: anim.videoReference
        ? Object.freeze({
            assetId: anim.videoReference.assetId ?? null,
            versionId: null,
            provider: anim.videoReference.assetId
              ? ("project" as const)
              : ("external" as const),
            source: anim.videoReference.uri,
            role: "animation" as const,
            crop: null,
            transform: null,
          })
        : null,
      spriteSheetAsset: anim.spriteSheetReference
        ? Object.freeze({
            assetId: anim.spriteSheetReference.assetId ?? null,
            versionId: null,
            provider: anim.spriteSheetReference.assetId
              ? ("project" as const)
              : ("external" as const),
            source: anim.spriteSheetReference.uri,
            role: "animation" as const,
            crop: null,
            transform: null,
          })
        : null,
      metadata: Object.freeze({
        kind: anim.kind,
        easing: anim.easing,
        ...(anim.animationExtra
          ? { animationExtra: anim.animationExtra }
          : {}),
      }),
    }),
  );

  const exportConfigNormalized: CanonicalExportConfiguration = Object.freeze({
    format: "blueprint-json",
    engineTarget: "section2-engine",
    imageScale: cloned.exportConfig.imageScale ?? "1x",
    includeAssets: Boolean(cloned.exportConfig.includeAssets),
    includeAnimations:
      cloned.export?.includeAnimations ??
      Boolean(
        cloned.exportConfig.animationOptions?.includeVideo ??
          cloned.exportConfig.animationOptions?.includeSpriteSheets ??
          true,
      ),
    includeSprites:
      cloned.export?.includeSprites ??
      Boolean(cloned.exportConfig.animationOptions?.includeSpriteSheets ?? true),
    includeGIF:
      cloned.export?.includeGIF ??
      Boolean(cloned.exportConfig.animationOptions?.includeGif ?? false),
    includeWebM:
      cloned.export?.includeWebM ??
      Boolean(cloned.exportConfig.animationOptions?.includeWebm ?? false),
    includeVideo:
      cloned.export?.includeVideo ??
      Boolean(cloned.exportConfig.animationOptions?.includeVideo ?? false),
    minify: Boolean(cloned.exportConfig.minify),
  });

  const schemaExtensions: SchemaExtensions = Object.freeze({
    namespaceVersion: "1.0",
    customMechanics: Object.freeze({
      ...(cloned.schemaExtensions?.customMechanics ?? {}),
    }),
    studioExtensions: Object.freeze({ ...(cloned.extensions ?? {}) }),
  });

  const normalized: GameDefinition = {
    ...cloned,
    version: BLUEPRINT_VERSION,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    engineCompatibility,
    id: metadata.id,
    metadata,
    game,
    styleGuide,
    grid,
    canonicalSymbols: Object.freeze(canonicalSymbols),
    symbolFamilies: Object.freeze(symbolFamilies),
    canonicalSymbolSets: Object.freeze(canonicalSymbolSets),
    canonicalAssets: Object.freeze(canonicalAssets),
    canonicalElements: Object.freeze(canonicalElements),
    canonicalScenes: Object.freeze(canonicalScenes),
    canvasConfiguration,
    canonicalLayers: Object.freeze(canonicalLayers),
    layerGroups: Object.freeze(layerGroups),
    canonicalReels,
    canonicalPaylines,
    paytableDefinition,
    winEvaluation,
    wildConfiguration,
    scatterConfiguration,
    waysConfiguration,
    clusterConfiguration,
    payAnywhereConfiguration,
    canonicalFeatures: Object.freeze(canonicalFeatures),
    freeSpinsConfiguration,
    multiplierConfiguration,
    boardDynamics,
    variableReelHeights,
    reelNudges,
    linkedReels,
    canonicalAnimations: Object.freeze(canonicalAnimations),
    export: exportConfigNormalized,
    schemaExtensions,
  };

  return deepFreeze(normalized);
}

/* -------------------------------------------------------------------------- */
/* MIGRATION BOUNDARY                                                         */
/* -------------------------------------------------------------------------- */

export function migrateGameDefinition(
  definition: unknown,
  fromVersion: string | number,
  toVersion: string | number = CANONICAL_SCHEMA_VERSION,
): GameDefinition {
  if (!SUPPORTED_MIGRATION_SOURCES.has(fromVersion)) {
    throw new UnsupportedGameSchemaError(
      `Cannot migrate GameDefinition from unsupported source schema version "${String(fromVersion)}".`,
      {
        fromVersion,
        toVersion,
        supportedSources: Array.from(SUPPORTED_MIGRATION_SOURCES),
      },
    );
  }
  if (!SUPPORTED_MIGRATION_TARGETS.has(toVersion)) {
    throw new UnsupportedGameSchemaError(
      `Cannot migrate GameDefinition to unsupported target schema version "${String(toVersion)}".`,
      {
        fromVersion,
        toVersion,
        supportedTargets: Array.from(SUPPORTED_MIGRATION_TARGETS),
      },
    );
  }
  if (!definition || typeof definition !== "object") {
    throw new InvalidGameConfigError(
      "Cannot migrate a non-object GameDefinition payload.",
      { fromVersion, toVersion },
    );
  }

  const candidate = structuredClone(definition) as Record<string, unknown>;
  if (fromVersion === "0.9") {
    candidate.version = BLUEPRINT_VERSION;
    if (candidate.meta && typeof candidate.meta === "object") {
      (candidate.meta as Record<string, unknown>).schemaVersion =
        BLUEPRINT_VERSION;
    }
  }
  candidate.schemaVersion = CANONICAL_SCHEMA_VERSION;

  return normalizeGameDefinition(candidate as unknown as GameBlueprint);
}

/* -------------------------------------------------------------------------- */
/* CLONING                                                                    */
/* -------------------------------------------------------------------------- */

export interface CloneGameDefinitionOptions {
  readonly newGameId: string;
  readonly newTitle?: string;
  readonly newAuthor?: string;
  readonly folderPath?: string;
  readonly timestamp?: string;
}

export function cloneGameDefinition(
  definition: GameBlueprint | GameDefinition,
  options: CloneGameDefinitionOptions,
): GameDefinition {
  if (!options.newGameId || !options.newGameId.trim()) {
    throw new InvalidGameConfigError(
      "cloneGameDefinition requires a non-empty newGameId.",
      { newGameId: options.newGameId },
    );
  }

  const normalized = normalizeGameDefinition(definition);
  const rawCopy = structuredClone(normalized) as unknown as GameBlueprint &
    Record<string, unknown>;

  const now = options.timestamp ?? normalized.metadata.updatedAt;
  const nextTitle = options.newTitle ?? `${normalized.metadata.title} (Copy)`;

  rawCopy.id = options.newGameId;
  rawCopy.meta = {
    ...rawCopy.meta,
    id: options.newGameId,
    title: nextTitle,
    slug: slugify(nextTitle),
    createdAt: now,
    updatedAt: now,
    ...(options.folderPath !== undefined
      ? { folderPath: options.folderPath }
      : {}),
  };
  if (options.newAuthor && rawCopy.metadata) {
    (rawCopy.metadata as Record<string, unknown>).author = options.newAuthor;
  }

  return normalizeGameDefinition(rawCopy);
}

/* -------------------------------------------------------------------------- */
/* SERIALIZATION & DESERIALIZATION                                            */
/* -------------------------------------------------------------------------- */

export function serializeGameDefinition(
  definition: GameBlueprint | GameDefinition,
  pretty = false,
): string {
  const normalized = normalizeGameDefinition(definition);
  return JSON.stringify(normalized, null, pretty ? 2 : undefined);
}

export function deserializeGameDefinition(json: string): GameDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new InvalidGameConfigError(
      `Failed to parse GameDefinition JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return normalizeGameDefinition(parsed as GameBlueprint);
}

/* -------------------------------------------------------------------------- */
/* ENGINE CONVERSION (GameDefinition -> GameConfig)                           */
/* -------------------------------------------------------------------------- */

export function toGameConfig(
  definitionOrBlueprint: GameDefinition | GameBlueprint,
): GameConfig {
  const normalized = normalizeGameDefinition(definitionOrBlueprint);
  return adaptBlueprintToGameConfig(normalized);
}

/* -------------------------------------------------------------------------- */
/* CANONICAL SCHEMA OBJECT (Zod-style parse / safeParse / validate API)       */
/* -------------------------------------------------------------------------- */

export const GameDefinitionSchema = Object.freeze({
  schemaVersion: CANONICAL_SCHEMA_VERSION,
  validate: validateGameDefinition,
  assertValid: assertValidGameDefinition,
  parse(input: unknown): GameDefinition {
    assertValidGameDefinition(input);
    return normalizeGameDefinition(input);
  },
  safeParse(input: unknown):
    | { readonly success: true; readonly data: GameDefinition }
    | { readonly success: false; readonly issues: readonly EngineValidationIssue[] } {
    const validation = validateGameDefinition(input);
    if (!validation.valid) {
      return Object.freeze({
        success: false,
        issues: validation.issues,
      });
    }
    return Object.freeze({
      success: true,
      data: normalizeGameDefinition(input as GameBlueprint),
    });
  },
});

/* -------------------------------------------------------------------------- */
/* SAMPLE VALID GAME DEFINITION (5x3 Fixed-Payline Canonical Sample)          */
/* -------------------------------------------------------------------------- */

export const SAMPLE_B02_GAME_ID = "sample-b02-5x3-canonical" as const;

export function createSampleGameDefinition(): GameDefinition {
  const symbols: SymbolDef[] = [
    {
      id: "sym-low-a",
      code: "A",
      name: "Royal Ace",
      tier: "low",
      glyph: "A",
      assetId: null,
      symbolSetId: "set-royals",
      symbolType: "royals",
      payouts: { "3": 2, "4": 5, "5": 15 },
      reelWeight: 4,
    },
    {
      id: "sym-low-k",
      code: "K",
      name: "Royal King",
      tier: "low",
      glyph: "K",
      assetId: null,
      symbolSetId: "set-royals",
      symbolType: "royals",
      payouts: { "3": 3, "4": 8, "5": 20 },
      reelWeight: 3,
    },
    {
      id: "sym-low-q",
      code: "Q",
      name: "Royal Queen",
      tier: "low",
      glyph: "Q",
      assetId: null,
      symbolSetId: "set-royals",
      symbolType: "royals",
      payouts: { "3": 4, "4": 10, "5": 25 },
      reelWeight: 3,
    },
    {
      id: "sym-high-sun-disk",
      code: "SUN",
      name: "Sun Disk",
      tier: "high",
      glyph: "☀",
      assetId: "asset-sym-sun",
      symbolSetId: "set-high",
      symbolType: "character",
      family: "family-sun-disk",
      image: {
        provider: "project",
        assetId: "asset-sym-sun",
        name: "Sun Disk Artwork",
      },
      payouts: { "3": 10, "4": 30, "5": 100 },
      reelWeight: 2,
      variants: [
        {
          id: "var-sun-disk-collect",
          name: "Sun Disk — Collect",
          image: {
            provider: "project",
            assetId: "asset-sym-sun",
            name: "Sun Disk Collect",
          },
          extras: { variantRole: "collect", multiplier: 1 },
        },
        {
          id: "var-sun-disk-major",
          name: "Sun Disk — Major",
          image: {
            provider: "project",
            assetId: "asset-sym-sun",
            name: "Sun Disk Major",
          },
          extras: { variantRole: "major", jackpotMultiplier: 50 },
        },
        {
          id: "var-sun-disk-mini",
          name: "Sun Disk — Mini",
          image: {
            provider: "project",
            assetId: "asset-sym-sun",
            name: "Sun Disk Mini",
          },
          extras: { variantRole: "mini", jackpotMultiplier: 10 },
        },
      ],
    },
    {
      id: "sym-wild",
      code: "WILD",
      name: "Golden Wild",
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
      name: "Temple Scatter",
      tier: "special",
      glyph: "S",
      assetId: null,
      payouts: { "3": 5, "4": 15, "5": 50 },
      reelWeight: 1,
      isScatter: true,
    },
  ];

  const strips: string[][] = [
    ["sym-low-a", "sym-low-k", "sym-low-q", "sym-high-sun-disk", "sym-wild", "sym-scatter"],
    ["sym-low-a", "sym-low-k", "sym-low-q", "sym-high-sun-disk", "sym-wild", "sym-scatter"],
    ["sym-low-a", "sym-low-k", "sym-low-q", "sym-high-sun-disk", "sym-wild", "sym-scatter"],
    ["sym-low-k", "sym-low-q", "sym-high-sun-disk", "sym-low-a", "sym-wild", "sym-scatter"],
    ["sym-low-q", "sym-high-sun-disk", "sym-low-a", "sym-low-k", "sym-wild", "sym-scatter"],
  ];

  const paylines: PaylineDef[] = [
    { id: "line-1", index: 1, name: "Middle Horizontal", pattern: [1, 1, 1, 1, 1], active: true, color: "#f5b041" },
    { id: "line-2", index: 2, name: "Top Horizontal", pattern: [0, 0, 0, 0, 0], active: true, color: "#5dade2" },
    { id: "line-3", index: 3, name: "Bottom Horizontal", pattern: [2, 2, 2, 2, 2], active: true, color: "#58d68d" },
    { id: "line-4", index: 4, name: "V-Shape", pattern: [0, 1, 2, 1, 0], active: true, color: "#ec7063" },
    { id: "line-5", index: 5, name: "Inverted V", pattern: [2, 1, 0, 1, 2], active: true, color: "#af7ac5" },
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

  const rawBlueprint: GameBlueprint = {
    version: BLUEPRINT_VERSION,
    meta: {
      id: SAMPLE_B02_GAME_ID,
      title: "Solar Dynasty 5x3",
      slug: "solar-dynasty-5x3",
      description: "Canonical B02 5x3 fixed-payline GameDefinition fixture.",
      status: "blueprint",
      theme: "Solar Dynasty",
      styleGuide: "Obsidian & Solar Gold",
      tags: ["b02", "canonical-schema", "5x3"],
      studio: "Slot Studio Schema Architect",
      createdAt: "2026-10-12T00:00:00.000Z",
      updatedAt: "2026-10-12T00:00:00.000Z",
      schemaVersion: BLUEPRINT_VERSION,
      folderPath: "/Samples/B02",
    },
    style: {
      paletteName: "Solar Gold",
      palette: {
        background: "#0b0d14",
        surface: "#141824",
        accent: "#f5b041",
        accentAlt: "#5dade2",
        glow: "#f8c471",
        text: "#f2f4f8",
      },
      mood: "Majestic, crisp, high-contrast",
      artDirection: "Solar Dynasty — Carved Gold & Obsidian",
      typography: { display: "Display Grotesk", body: "Inter" },
      referenceAssetId: null,
    },
    symbols,
    symbolSets: [
      {
        id: "set-royals",
        name: "Royal Ranks",
        description: "Low-tier deck rank symbols",
        symbolIds: ["sym-low-a", "sym-low-k", "sym-low-q"],
        symbolType: "royals",
        valueTier: "low",
      },
      {
        id: "set-high",
        name: "Solar Relics",
        description: "High-tier relic symbols and Sun Disk family",
        symbolIds: ["sym-high-sun-disk"],
        symbolType: "character",
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
    assets: [
      {
        id: "asset-bg-temple",
        name: "Solar Temple Background",
        kind: "image",
        uri: null,
        state: "placeholder",
        tags: ["background"],
        width: 1920,
        height: 1080,
        format: "png",
      },
      {
        id: "asset-frame-gold",
        name: "Ornate Gold Reel Frame",
        kind: "image",
        uri: null,
        state: "placeholder",
        tags: ["frame"],
        width: 1400,
        height: 820,
        format: "png-transparent",
      },
      {
        id: "asset-sym-sun",
        name: "Sun Disk Primary Art",
        kind: "image",
        uri: null,
        state: "placeholder",
        tags: ["symbol"],
        width: 256,
        height: 256,
        format: "png-transparent",
      },
    ],
    elements: [
      {
        id: "el-bg",
        type: "game_background",
        name: "Temple Backdrop",
        group: "Environment",
        assetId: "asset-bg-temple",
        symbolIds: [],
        notes: "Primary base scene backdrop",
        origin: "planned",
        params: {},
      },
      {
        id: "el-frame",
        type: "reel_frame",
        name: "Solar Reel Frame",
        group: "Frame",
        assetId: "asset-frame-gold",
        symbolIds: [],
        notes: "5x3 reel border",
        origin: "planned",
        params: {},
      },
    ],
    layers: [
      {
        id: "layer-bg",
        name: "Background",
        kind: "background",
        type: "background",
        order: 0,
        visible: true,
        locked: true,
        opacity: 1,
      },
      {
        id: "layer-reels",
        name: "Reels",
        kind: "reels",
        type: "reels",
        order: 1,
        visible: true,
        locked: false,
        opacity: 1,
      },
      {
        id: "layer-frame",
        name: "Reel Frame",
        kind: "frame",
        type: "frame",
        order: 2,
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
      backgroundAssetId: "asset-bg-temple",
    },
    scenes: [
      {
        id: "scene-base",
        name: "Base Game",
        kind: "base",
        layerIds: ["layer-bg", "layer-reels", "layer-frame"],
        entryTransition: "fade",
        background: {
          color: "#0b0d14",
          assetId: "asset-bg-temple",
          fit: "cover",
        },
      },
    ],
    reels: {
      columns: 5,
      rows: 3,
      evaluation: "lines",
      strips,
      spinDirection: "down",
      weightsEnabled: false,
    },
    paylines,
    paytable,
    features: [
      {
        id: "feature-free-spins",
        name: "Solar Free Spins",
        kind: "free_spins",
        enabled: true,
        params: { spins: 10, retrigger: true, multiplier: 2, triggerCount: 3 },
      },
    ],
    animations: [
      {
        id: "anim-sun-win",
        name: "Sun Disk Win Pulse",
        elementId: "el-frame",
        target: "sym-high-sun-disk",
        trigger: "win",
        kind: "symbol_pulse",
        animationType: "Symbol Win",
        source: "preset",
        format: "css",
        durationMs: 800,
        easing: "easeOutBack",
        loop: false,
        fps: 60,
        state: "enabled",
      },
    ],
    math: {
      rtpTarget: 96,
      volatility: "medium",
      maxWinX: 5000,
      betLevels: [0.2, 0.5, 1, 2, 5, 10],
      hitFrequency: 0.26,
    },
    exportConfig: {
      format: "blueprint-json",
      engineTarget: "section2-engine",
      includeAssets: false,
      minify: false,
      imageScale: "1x",
    },
    extensions: {},
  };

  return normalizeGameDefinition(rawBlueprint);
}
