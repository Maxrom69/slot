/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — Engine Versioning & Strict GameBlueprint Validation
 *
 * Centralizes schema compatibility checks and structural/mathematical validation
 * before adapting a GameBlueprint into an immutable GameConfig.
 */

import { BLUEPRINT_VERSION, type GameBlueprint } from "@/lib/blueprint/types";
import {
  InvalidGameConfigError,
  InvalidPaylineConfigError,
  InvalidPaytableError,
  InvalidReelConfigError,
  InvalidSymbolReferenceError,
  UnsupportedGameSchemaError,
  type EngineErrorCode,
} from "../errors";

export const ENGINE_VERSION = "1.0.0" as const;

export const SUPPORTED_BLUEPRINT_SCHEMA_VERSIONS: readonly number[] =
  Object.freeze([BLUEPRINT_VERSION]);

export type EngineValidationCategory =
  | "SCHEMA"
  | "GAME"
  | "SYMBOLS"
  | "REELS"
  | "PAYLINES"
  | "PAYTABLE"
  | "FEATURES"
  | "MATH";

export interface EngineValidationIssue {
  readonly category: EngineValidationCategory;
  readonly code: EngineErrorCode;
  readonly path: string;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

export interface EngineValidationResult {
  readonly valid: boolean;
  readonly schemaVersion: number | null;
  readonly engineVersion: string;
  readonly issues: readonly EngineValidationIssue[];
}

export interface SchemaCompatibilityCheck {
  readonly compatible: boolean;
  readonly blueprintVersion: number | null;
  readonly metaSchemaVersion: number | null;
  readonly supportedVersions: readonly number[];
  readonly reason?: string;
}

const VALID_TIERS = new Set(["low", "mid", "high", "special"]);
const VALID_EVALUATION_MODES = new Set([
  "lines",
  "ways",
  "cluster",
  "pay_anywhere",
]);
const VALID_SPECIAL_BEHAVIOURS = new Set([
  "wild",
  "scatter",
  "bonus",
  "multiplier",
  "expanding",
  "sticky",
]);
const VALID_FEATURE_KINDS = new Set([
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

export function checkSchemaCompatibility(
  candidate: unknown,
): SchemaCompatibilityCheck {
  if (!candidate || typeof candidate !== "object") {
    return {
      compatible: false,
      blueprintVersion: null,
      metaSchemaVersion: null,
      supportedVersions: SUPPORTED_BLUEPRINT_SCHEMA_VERSIONS,
      reason: "Blueprint payload must be a non-null object.",
    };
  }

  const record = candidate as Record<string, unknown>;
  const rawVersion =
    typeof record.version === "number" && Number.isFinite(record.version)
      ? record.version
      : null;
  const metaRecord =
    record.meta && typeof record.meta === "object"
      ? (record.meta as Record<string, unknown>)
      : null;
  const metaSchemaVersion =
    metaRecord &&
    typeof metaRecord.schemaVersion === "number" &&
    Number.isFinite(metaRecord.schemaVersion)
      ? metaRecord.schemaVersion
      : null;

  if (
    rawVersion === null ||
    !SUPPORTED_BLUEPRINT_SCHEMA_VERSIONS.includes(rawVersion)
  ) {
    return {
      compatible: false,
      blueprintVersion: rawVersion,
      metaSchemaVersion,
      supportedVersions: SUPPORTED_BLUEPRINT_SCHEMA_VERSIONS,
      reason: `Unsupported blueprint version "${String(rawVersion)}". Supported versions: ${SUPPORTED_BLUEPRINT_SCHEMA_VERSIONS.join(", ")}.`,
    };
  }

  if (
    metaSchemaVersion !== null &&
    !SUPPORTED_BLUEPRINT_SCHEMA_VERSIONS.includes(metaSchemaVersion)
  ) {
    return {
      compatible: false,
      blueprintVersion: rawVersion,
      metaSchemaVersion,
      supportedVersions: SUPPORTED_BLUEPRINT_SCHEMA_VERSIONS,
      reason: `Unsupported meta.schemaVersion "${String(metaSchemaVersion)}". Supported versions: ${SUPPORTED_BLUEPRINT_SCHEMA_VERSIONS.join(", ")}.`,
    };
  }

  return {
    compatible: true,
    blueprintVersion: rawVersion,
    metaSchemaVersion: metaSchemaVersion ?? rawVersion,
    supportedVersions: SUPPORTED_BLUEPRINT_SCHEMA_VERSIONS,
  };
}

export function assertSupportedSchemaVersion(candidate: unknown): void {
  const compatibility = checkSchemaCompatibility(candidate);
  if (!compatibility.compatible) {
    throw new UnsupportedGameSchemaError(
      compatibility.reason ?? "Unsupported GameBlueprint schema version.",
      {
        blueprintVersion: compatibility.blueprintVersion,
        metaSchemaVersion: compatibility.metaSchemaVersion,
        supportedVersions: compatibility.supportedVersions,
        engineVersion: ENGINE_VERSION,
      },
    );
  }
}

export function validateBlueprintForEngine(
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

  const compatibility = checkSchemaCompatibility(candidate);
  if (!compatibility.compatible) {
    pushIssue(
      "SCHEMA",
      "UNSUPPORTED_GAME_SCHEMA",
      "version",
      compatibility.reason ?? "Unsupported GameBlueprint schema version.",
      {
        blueprintVersion: compatibility.blueprintVersion,
        metaSchemaVersion: compatibility.metaSchemaVersion,
        supportedVersions: compatibility.supportedVersions,
      },
    );
    return Object.freeze({
      valid: false,
      schemaVersion: compatibility.blueprintVersion,
      engineVersion: ENGINE_VERSION,
      issues: Object.freeze(issues),
    });
  }

  const bp = candidate as GameBlueprint;

  // 1. GAME identity & grid validation
  if (!bp.meta || typeof bp.meta.id !== "string" || !bp.meta.id.trim()) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "meta.id",
      "Game ID must be a non-empty string.",
    );
  }
  if (!bp.meta || typeof bp.meta.title !== "string" || !bp.meta.title.trim()) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "meta.title",
      "Game title must be a non-empty string.",
    );
  }

  const columns = bp.reels?.columns;
  const rows = bp.reels?.rows;
  const evaluation = bp.reels?.evaluation as string | undefined;

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
      "reels.columns",
      "Reel count (columns) must be an integer between 3 and 8.",
      { columns },
    );
  }
  if (!validRows) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "reels.rows",
      "Row count (rows) must be an integer between 2 and 6.",
      { rows },
    );
  }
  if (!evaluation || !VALID_EVALUATION_MODES.has(evaluation)) {
    pushIssue(
      "GAME",
      "INVALID_GAME_CONFIG",
      "reels.evaluation",
      `Unsupported evaluation mode "${String(evaluation)}".`,
      { evaluation },
    );
  }

  // 2. SYMBOLS validation
  const symbolIds = new Set<string>();
  const symbolCodes = new Set<string>();

  if (!Array.isArray(bp.symbols) || bp.symbols.length === 0) {
    pushIssue(
      "SYMBOLS",
      "INVALID_SYMBOL_REFERENCE",
      "symbols",
      "GameBlueprint must define at least one symbol.",
    );
  } else {
    bp.symbols.forEach((symbol, index) => {
      const path = `symbols[${index}]`;
      if (!symbol || typeof symbol.id !== "string" || !symbol.id.trim()) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.id`,
          "Symbol ID must be a non-empty string.",
        );
      } else if (symbolIds.has(symbol.id)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.id`,
          `Duplicate symbol ID "${symbol.id}".`,
          { symbolId: symbol.id },
        );
      } else {
        symbolIds.add(symbol.id);
      }

      if (typeof symbol.code !== "string" || !symbol.code.trim()) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.code`,
          `Symbol "${symbol?.id ?? index}" must have a non-empty code.`,
        );
      } else if (symbolCodes.has(symbol.code)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.code`,
          `Duplicate symbol code "${symbol.code}".`,
          { symbolId: symbol.id, code: symbol.code },
        );
      } else {
        symbolCodes.add(symbol.code);
      }

      if (!VALID_TIERS.has(symbol.tier)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.tier`,
          `Symbol "${symbol.id}" has invalid tier "${String(symbol.tier)}".`,
          { symbolId: symbol.id, tier: symbol.tier },
        );
      }

      if (
        !isFiniteNonNegative(symbol.reelWeight) ||
        !Number.isInteger(symbol.reelWeight)
      ) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.reelWeight`,
          `Symbol "${symbol.id}" must have a non-negative integer reelWeight.`,
          { symbolId: symbol.id, reelWeight: symbol.reelWeight },
        );
      }

      if (symbol.payouts && typeof symbol.payouts === "object") {
        for (const [rawMatch, payout] of Object.entries(symbol.payouts)) {
          const matchCount = Number(rawMatch);
          if (!Number.isInteger(matchCount) || matchCount < 1) {
            pushIssue(
              "PAYTABLE",
              "INVALID_PAYTABLE",
              `${path}.payouts["${rawMatch}"]`,
              `Symbol "${symbol.id}" has non-integer or non-positive match count "${rawMatch}".`,
              { symbolId: symbol.id, matchCount: rawMatch },
            );
          }
          if (!isFiniteNonNegative(payout)) {
            pushIssue(
              "PAYTABLE",
              "INVALID_PAYTABLE",
              `${path}.payouts["${rawMatch}"]`,
              `Symbol "${symbol.id}" has invalid payout value "${String(payout)}" for match count ${rawMatch}.`,
              { symbolId: symbol.id, matchCount: rawMatch, payout },
            );
          }
        }
      }

      if (Array.isArray(symbol.variants)) {
        symbol.variants.forEach((variant, vIdx) => {
          const vPath = `${path}.variants[${vIdx}]`;
          if (
            !variant ||
            typeof variant.id !== "string" ||
            !variant.id.trim()
          ) {
            pushIssue(
              "SYMBOLS",
              "INVALID_SYMBOL_REFERENCE",
              `${vPath}.id`,
              `Variant on symbol "${symbol.id}" must have a non-empty string ID.`,
            );
          } else if (symbolIds.has(variant.id)) {
            pushIssue(
              "SYMBOLS",
              "INVALID_SYMBOL_REFERENCE",
              `${vPath}.id`,
              `Duplicate symbol/variant ID "${variant.id}".`,
              { variantId: variant.id },
            );
          } else {
            symbolIds.add(variant.id);
          }
        });
      }
    });
  }

  // Validate symbolSets references
  if (Array.isArray(bp.symbolSets)) {
    bp.symbolSets.forEach((set, setIdx) => {
      set.symbolIds.forEach((symId, symIdx) => {
        if (!symbolIds.has(symId)) {
          pushIssue(
            "SYMBOLS",
            "INVALID_SYMBOL_REFERENCE",
            `symbolSets[${setIdx}].symbolIds[${symIdx}]`,
            `Symbol set "${set.id}" references unknown symbol "${symId}".`,
            { symbolSetId: set.id, symbolId: symId },
          );
        }
      });
    });
  }

  // Validate specialSymbols references and behaviours
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
      if (!VALID_SPECIAL_BEHAVIOURS.has(special.behaviour)) {
        pushIssue(
          "SYMBOLS",
          "INVALID_SYMBOL_REFERENCE",
          `specialSymbols[${idx}].behaviour`,
          `Special symbol "${special.id}" has unsupported behaviour "${String(special.behaviour)}".`,
          { specialId: special.id, behaviour: special.behaviour },
        );
      }
    });
  }

  // 3. REELS validation
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
        `Expected ${columns} reel strips to match reels.columns, but found ${strips.length}.`,
        { expectedColumns: columns, actualStrips: strips.length },
      );
    }

    strips.forEach((strip, reelIndex) => {
      if (!Array.isArray(strip) || strip.length === 0) {
        pushIssue(
          "REELS",
          "INVALID_REEL_CONFIG",
          `reels.strips[${reelIndex}]`,
          `Reel strip at index ${reelIndex} must not be empty.`,
          { reelIndex },
        );
        return;
      }

      strip.forEach((stopSymbolId, stopIndex) => {
        if (!symbolIds.has(stopSymbolId)) {
          pushIssue(
            "REELS",
            "INVALID_SYMBOL_REFERENCE",
            `reels.strips[${reelIndex}][${stopIndex}]`,
            `Reel ${reelIndex + 1} stop ${stopIndex + 1} references unknown symbol "${stopSymbolId}".`,
            { reelIndex, stopIndex, symbolId: stopSymbolId },
          );
        }
      });
    });
  }

  // Also validate detailed reelConfiguration / reels.reels if present
  const detailedReels = bp.reelConfiguration?.reels ?? bp.reels?.reels;
  const weightsEnabled = Boolean(
    bp.reelConfiguration?.weightsEnabled ?? bp.reels?.weightsEnabled,
  );
  if (Array.isArray(detailedReels) && detailedReels.length > 0) {
    if (validColumns && detailedReels.length !== columns) {
      pushIssue(
        "REELS",
        "INVALID_REEL_CONFIG",
        "reelConfiguration.reels",
        `Expected ${columns} detailed reel definitions, found ${detailedReels.length}.`,
        { expectedColumns: columns, actualReels: detailedReels.length },
      );
    }
    detailedReels.forEach((reelDef, reelIdx) => {
      if (!Array.isArray(reelDef.stops) || reelDef.stops.length === 0) {
        pushIssue(
          "REELS",
          "INVALID_REEL_CONFIG",
          `reelConfiguration.reels[${reelIdx}].stops`,
          `Detailed reel "${reelDef.id}" must contain at least one stop.`,
          { reelId: reelDef.id, reelIndex: reelIdx },
        );
        return;
      }
      reelDef.stops.forEach((stop, stopIdx) => {
        if (!symbolIds.has(stop.symbolId)) {
          pushIssue(
            "REELS",
            "INVALID_SYMBOL_REFERENCE",
            `reelConfiguration.reels[${reelIdx}].stops[${stopIdx}].symbolId`,
            `Detailed reel "${reelDef.id}" stop ${stopIdx + 1} references unknown symbol "${stop.symbolId}".`,
            { reelId: reelDef.id, stopId: stop.id, symbolId: stop.symbolId },
          );
        }
        if (weightsEnabled) {
          const weight = stop.weight ?? 1;
          if (!isFinitePositive(weight)) {
            pushIssue(
              "REELS",
              "INVALID_REEL_CONFIG",
              `reelConfiguration.reels[${reelIdx}].stops[${stopIdx}].weight`,
              `Stop "${stop.id}" on reel "${reelDef.id}" must have a positive finite weight when weights are enabled.`,
              { reelId: reelDef.id, stopId: stop.id, weight: stop.weight },
            );
          }
        }
      });
    });
  }

  // 4. PAYLINES validation
  const paylines = bp.paylines ?? [];
  const paylineIds = new Set<string>();
  const paylinePatterns = new Set<string>();

  if (evaluation === "lines") {
    const activeLines = paylines.filter((line) => line.active !== false);
    if (activeLines.length === 0) {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        "paylines",
        "Line-evaluated games must define at least one active payline.",
      );
    }
  }

  paylines.forEach((line, lineIdx) => {
    const path = `paylines[${lineIdx}]`;
    if (!line.id || typeof line.id !== "string") {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        `${path}.id`,
        "Payline must have a valid string ID.",
      );
    } else if (paylineIds.has(line.id)) {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        `${path}.id`,
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
        `${path}.pattern`,
        `Payline "${line.id}" pattern must be an array of row indexes.`,
      );
      return;
    }

    if (validColumns && line.pattern.length !== columns) {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        `${path}.pattern`,
        `Payline "${line.id}" must define exactly ${columns} row selections (one per reel), found ${line.pattern.length}.`,
        {
          paylineId: line.id,
          expectedColumns: columns,
          actualLength: line.pattern.length,
        },
      );
    }

    line.pattern.forEach((rowIdx, colIdx) => {
      if (
        typeof rowIdx !== "number" ||
        !Number.isInteger(rowIdx) ||
        rowIdx < 0 ||
        (validRows && rowIdx >= rows)
      ) {
        pushIssue(
          "PAYLINES",
          "INVALID_PAYLINE_CONFIG",
          `${path}.pattern[${colIdx}]`,
          `Payline "${line.id}" has out-of-range row index ${String(rowIdx)} at reel ${colIdx + 1} (valid range: 0..${(rows ?? 1) - 1}).`,
          { paylineId: line.id, column: colIdx, rowIndex: rowIdx, rows },
        );
      }
    });

    const patternKey = line.pattern.join(",");
    if (paylinePatterns.has(patternKey)) {
      pushIssue(
        "PAYLINES",
        "INVALID_PAYLINE_CONFIG",
        `${path}.pattern`,
        `Payline "${line.id}" duplicates an existing payline path [${patternKey}].`,
        { paylineId: line.id, pattern: line.pattern },
      );
    } else {
      paylinePatterns.add(patternKey);
    }
  });

  // 5. PAYTABLE validation
  const maxBoardSize = validColumns && validRows ? columns * rows : 48;
  if (!Array.isArray(bp.paytable) || bp.paytable.length === 0) {
    pushIssue(
      "PAYTABLE",
      "INVALID_PAYTABLE",
      "paytable",
      "Paytable must contain at least one payout entry.",
    );
  } else {
    bp.paytable.forEach((entry, entryIdx) => {
      const path = `paytable[${entryIdx}]`;
      if (!symbolIds.has(entry.symbolId)) {
        pushIssue(
          "PAYTABLE",
          "INVALID_SYMBOL_REFERENCE",
          `${path}.symbolId`,
          `Paytable entry ${entryIdx} references unknown symbol "${entry.symbolId}".`,
          { symbolId: entry.symbolId, entryIndex: entryIdx },
        );
      }
      if (
        typeof entry.ofAKind !== "number" ||
        !Number.isInteger(entry.ofAKind) ||
        entry.ofAKind < 1 ||
        entry.ofAKind > maxBoardSize
      ) {
        pushIssue(
          "PAYTABLE",
          "INVALID_PAYTABLE",
          `${path}.ofAKind`,
          `Paytable entry for "${entry.symbolId}" has invalid match count ${String(entry.ofAKind)} (must be integer 1..${maxBoardSize}).`,
          { symbolId: entry.symbolId, ofAKind: entry.ofAKind, maxBoardSize },
        );
      }
      if (!isFiniteNonNegative(entry.payout)) {
        pushIssue(
          "PAYTABLE",
          "INVALID_PAYTABLE",
          `${path}.payout`,
          `Paytable entry for "${entry.symbolId}" (${entry.ofAKind}-of-a-kind) has invalid payout ${String(entry.payout)} (must be finite and >= 0).`,
          {
            symbolId: entry.symbolId,
            ofAKind: entry.ofAKind,
            payout: entry.payout,
          },
        );
      }
    });
  }

  // 6. FEATURES validation
  const featureIds = new Set<string>();
  if (Array.isArray(bp.features)) {
    bp.features.forEach((feature, featIdx) => {
      const path = `features[${featIdx}]`;
      if (!feature.id || typeof feature.id !== "string") {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `${path}.id`,
          "Feature must have a non-empty string ID.",
        );
      } else if (featureIds.has(feature.id)) {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `${path}.id`,
          `Duplicate feature ID "${feature.id}".`,
          { featureId: feature.id },
        );
      } else {
        featureIds.add(feature.id);
      }

      if (!VALID_FEATURE_KINDS.has(feature.kind)) {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `${path}.kind`,
          `Feature "${feature.id}" has unsupported kind "${String(feature.kind)}".`,
          { featureId: feature.id, kind: feature.kind },
        );
      }

      if (!feature.params || typeof feature.params !== "object") {
        pushIssue(
          "FEATURES",
          "INVALID_GAME_CONFIG",
          `${path}.params`,
          `Feature "${feature.id}" must define a params object.`,
        );
      } else {
        for (const [paramKey, paramVal] of Object.entries(feature.params)) {
          if (typeof paramVal === "number" && !Number.isFinite(paramVal)) {
            pushIssue(
              "FEATURES",
              "INVALID_GAME_CONFIG",
              `${path}.params.${paramKey}`,
              `Feature "${feature.id}" parameter "${paramKey}" must be a finite number.`,
              { featureId: feature.id, paramKey, paramVal },
            );
          }
        }
        if (feature.kind === "free_spins" && feature.enabled) {
          const spins = feature.params.spins;
          if (
            spins !== undefined &&
            (typeof spins !== "number" ||
              !Number.isInteger(spins) ||
              spins <= 0)
          ) {
            pushIssue(
              "FEATURES",
              "INVALID_GAME_CONFIG",
              `${path}.params.spins`,
              `Free spins feature "${feature.id}" must specify a positive integer spins count.`,
              { featureId: feature.id, spins },
            );
          }
        }
      }
    });
  }

  // 7. MATH / BETS validation
  if (
    !bp.math ||
    typeof bp.math.rtpTarget !== "number" ||
    !Number.isFinite(bp.math.rtpTarget) ||
    bp.math.rtpTarget < 80 ||
    bp.math.rtpTarget > 99
  ) {
    pushIssue(
      "MATH",
      "INVALID_GAME_CONFIG",
      "math.rtpTarget",
      "math.rtpTarget must be a finite number between 80 and 99.",
      { rtpTarget: bp.math?.rtpTarget },
    );
  }
  if (
    !bp.math ||
    !Array.isArray(bp.math.betLevels) ||
    bp.math.betLevels.length === 0 ||
    !bp.math.betLevels.every((bet) => isFinitePositive(bet))
  ) {
    pushIssue(
      "MATH",
      "INVALID_GAME_CONFIG",
      "math.betLevels",
      "math.betLevels must be a non-empty array of positive finite bet amounts.",
      { betLevels: bp.math?.betLevels },
    );
  }

  return Object.freeze({
    valid: issues.length === 0,
    schemaVersion: compatibility.blueprintVersion,
    engineVersion: ENGINE_VERSION,
    issues: Object.freeze(issues),
  });
}

export function assertValidBlueprintForEngine(
  candidate: unknown,
): asserts candidate is GameBlueprint {
  const result = validateBlueprintForEngine(candidate);
  if (result.valid) return;

  const firstIssue = result.issues[0];
  const errorContext = {
    schemaVersion: result.schemaVersion,
    engineVersion: result.engineVersion,
    issueCount: result.issues.length,
    issues: result.issues,
  };

  if (firstIssue.code === "UNSUPPORTED_GAME_SCHEMA") {
    throw new UnsupportedGameSchemaError(firstIssue.message, errorContext);
  }
  if (firstIssue.code === "INVALID_SYMBOL_REFERENCE") {
    throw new InvalidSymbolReferenceError(firstIssue.message, errorContext);
  }
  if (firstIssue.code === "INVALID_REEL_CONFIG") {
    throw new InvalidReelConfigError(firstIssue.message, errorContext);
  }
  if (firstIssue.code === "INVALID_PAYLINE_CONFIG") {
    throw new InvalidPaylineConfigError(firstIssue.message, errorContext);
  }
  if (firstIssue.code === "INVALID_PAYTABLE") {
    throw new InvalidPaytableError(firstIssue.message, errorContext);
  }

  throw new InvalidGameConfigError(firstIssue.message, errorContext);
}
