/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B10 — Cluster Engine
 *
 * Pure, deterministic connected-component Cluster Pays evaluation engine.
 * Consumes an authoritative B04 Board and B02 ClusterConfiguration,
 * detects connected groups of matching symbols under "edge" or "hex"
 * adjacency (reusing B07 Wild substitution and B02 Symbol Families when
 * configured), resolves configured B06 paytable multipliers where defined,
 * and returns an immutable, JSON-serializable ClusterEvaluationResult.
 *
 * Zero RNG dependencies. Zero Payline (B05), Ways (B09), Scatter (B08),
 * or Pay-Anywhere (B11) dependencies. Zero browser/UI dependencies.
 */

import type { Board, Cell, Position } from "../board";
import {
  type GameConfig,
  type NormalizedSymbolDefinition,
  isGameConfig,
} from "../config";
import {
  InvalidAdjacencyModeError,
  InvalidBoardError,
  InvalidClusterConfigurationError,
  InvalidFamilyReferenceError,
  InvalidMinimumClusterSizeError,
  InvalidPaytableReferenceError,
  UnknownSymbolReferenceError,
} from "../errors";
import {
  type PaytableEngine,
  type PaytableSource,
  type PayoutContext,
  normalizePaytableLookup,
  roundCurrency,
} from "../paytable";
import type {
  CanonicalSymbolDefinition,
  ClusterAdjacencyMode,
  ClusterConfiguration,
  GameDefinition,
  HexGridOrientation,
  SymbolFamilyDefinition,
} from "../schema/types";
import {
  type WildEngine,
  type WildEngineSource,
  createWildEngine,
} from "../wilds";

/* -------------------------------------------------------------------------- */
/* PUBLIC TYPES & CONTRACTS                                                   */
/* -------------------------------------------------------------------------- */

export type { ClusterAdjacencyMode, ClusterConfiguration, HexGridOrientation };

export interface ClusterSymbolInfo {
  readonly id: string;
  readonly isWild?: boolean;
  readonly isScatter?: boolean;
  readonly isBonus?: boolean;
  readonly familyId?: string | null;
}

export type ClusterSymbolRegistrySource =
  | GameConfig
  | GameDefinition
  | ReadonlyMap<
      string,
      ClusterSymbolInfo | NormalizedSymbolDefinition | CanonicalSymbolDefinition
    >
  | Readonly<
      Record<
        string,
        ClusterSymbolInfo | NormalizedSymbolDefinition | CanonicalSymbolDefinition
      >
    >
  | readonly (
      | ClusterSymbolInfo
      | NormalizedSymbolDefinition
      | CanonicalSymbolDefinition
    )[];

export type ClusterFamilySource =
  | ReadonlyMap<string, readonly string[]>
  | Readonly<Record<string, readonly string[]>>
  | readonly SymbolFamilyDefinition[];

export interface ClusterConfigInput {
  readonly enabled?: boolean;
  readonly minimumClusterSize: number;
  readonly adjacency?: ClusterAdjacencyMode;
  readonly allowWildJoin?: boolean;
  readonly allowFamilyGrouping?: boolean;
  readonly eligibleSymbols?: readonly string[];
  readonly familyPayoutSymbolByFamilyId?: Readonly<Record<string, string>>;
  readonly hexGridOrientation?: HexGridOrientation;
}

export interface NormalizedClusterConfiguration {
  readonly enabled: boolean;
  readonly minimumClusterSize: number;
  readonly adjacency: ClusterAdjacencyMode;
  readonly allowWildJoin: boolean;
  readonly allowFamilyGrouping: boolean;
  readonly eligibleSymbols: readonly string[] | null;
  readonly familyPayoutSymbolByFamilyId: Readonly<Record<string, string>>;
  readonly hexGridOrientation: HexGridOrientation;
}

export interface ClusterCell {
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly symbolId: string;
  readonly actualSymbolId: string;
  readonly effectiveSymbolId: string;
  readonly isWild: boolean;
  readonly stopIndex?: number;
}

export interface ClusterWin {
  readonly id: string;
  readonly symbolId: string;
  readonly familyId?: string;
  readonly size: number;
  readonly clusterSize: number;
  readonly cells: readonly ClusterCell[];
  readonly participatingSymbols: readonly string[];
  readonly symbolCounts: Readonly<Record<string, number>>;
  readonly minimumClusterSize: number;
  readonly adjacency: ClusterAdjacencyMode;
  readonly wildCount: number;
  readonly naturalCount: number;
  readonly baseMultiplier?: number;
  readonly totalPayout?: number;
  readonly payoutSymbolId?: string;
}

export interface ClusterEvaluationResult {
  readonly evaluationMode: "cluster";
  readonly enabled: boolean;
  readonly minimumClusterSize: number;
  readonly adjacency: ClusterAdjacencyMode;
  readonly clusters: readonly ClusterWin[];
  readonly qualifyingClusterCount: number;
  readonly totalClusterCells: number;
  readonly uniqueWinningCellCount: number;
  readonly winningCells: readonly Position[];
  readonly totalBaseMultiplier?: number;
  readonly totalPayout?: number;
}

export type ClusterPaytableOption =
  | PaytableSource
  | PaytableEngine
  | Readonly<Record<string, Readonly<Record<number, number>>>>;

export interface ClusterEvaluationOptions {
  readonly symbolRegistry?: ClusterSymbolRegistrySource | null;
  readonly wildEngine?: WildEngine | WildEngineSource | null;
  readonly paytable?: ClusterPaytableOption | null;
  readonly payoutContext?: PayoutContext;
  readonly families?: ClusterFamilySource | null;
}

export interface ClusterEngine {
  evaluate(
    board: Board,
    config?: ClusterConfigInput | ClusterConfiguration | GameConfig | GameDefinition,
    options?: ClusterEvaluationOptions,
  ): ClusterEvaluationResult;

  evaluateClusters(
    board: Board,
    config?: ClusterConfigInput | ClusterConfiguration | GameConfig | GameDefinition,
    options?: ClusterEvaluationOptions,
  ): ClusterEvaluationResult;
}

/* -------------------------------------------------------------------------- */
/* CONFIGURATION & BOARD VALIDATION                                           */
/* -------------------------------------------------------------------------- */

const VALID_ADJACENCY_MODES = new Set<ClusterAdjacencyMode>(["edge", "hex"]);
const VALID_HEX_ORIENTATIONS = new Set<HexGridOrientation>([
  "odd-q",
  "even-q",
  "odd-r",
  "even-r",
]);

function getBoardColumns(
  board: Board,
): readonly (readonly Cell[])[] | undefined {
  if (!board || typeof board !== "object") {
    return undefined;
  }
  if (Array.isArray(board.cells)) {
    return board.cells;
  }
  const legacyReels = (board as unknown as { reels?: readonly (readonly Cell[])[] })
    .reels;
  if (Array.isArray(legacyReels)) {
    return legacyReels;
  }
  return undefined;
}

/**
 * Validates the authoritative B04 Board before Cluster evaluation.
 */
export function validateBoardForClusters(board: Board): void {
  if (!board || typeof board !== "object") {
    throw new InvalidBoardError("Board must be a non-null object.", {
      board: String(board),
    });
  }

  const columnsMatrix = getBoardColumns(board);
  if (!Array.isArray(columnsMatrix)) {
    throw new InvalidBoardError(
      "Board.cells must be an array of reel columns.",
      {
        cells: String((board as unknown as Record<string, unknown>).cells),
      },
    );
  }

  const reelCount =
    typeof board.reelCount === "number" ? board.reelCount : board.columns;

  if (
    typeof reelCount !== "number" ||
    !Number.isInteger(reelCount) ||
    reelCount < 1 ||
    columnsMatrix.length !== reelCount
  ) {
    throw new InvalidBoardError(
      `Board.reelCount (${String(reelCount)}) must be a positive integer matching board.cells.length (${columnsMatrix.length}).`,
      {
        reelCount,
        reelsLength: columnsMatrix.length,
      },
    );
  }

  for (let reelIndex = 0; reelIndex < columnsMatrix.length; reelIndex++) {
    const column = columnsMatrix[reelIndex];
    if (!Array.isArray(column) || column.length < 1) {
      throw new InvalidBoardError(
        `Board reel column at index ${reelIndex} must be a non-empty array of cells.`,
        { reelIndex },
      );
    }

    for (let rowIndex = 0; rowIndex < column.length; rowIndex++) {
      const cell = column[rowIndex];
      if (!cell || typeof cell !== "object") {
        throw new InvalidBoardError(
          `Board cell at (${reelIndex}, ${rowIndex}) must be an object.`,
          { reelIndex, rowIndex },
        );
      }
      if (cell.reelIndex !== reelIndex || cell.rowIndex !== rowIndex) {
        throw new InvalidBoardError(
          `Board cell coordinate mismatch at (${reelIndex}, ${rowIndex}): found (${String(cell.reelIndex)}, ${String(cell.rowIndex)}).`,
          {
            expectedReelIndex: reelIndex,
            expectedRowIndex: rowIndex,
            actualReelIndex: cell.reelIndex,
            actualRowIndex: cell.rowIndex,
          },
        );
      }
      const symbolId =
        typeof cell.symbolId === "string"
          ? cell.symbolId
          : cell.symbol?.symbolId;
      if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
        throw new InvalidBoardError(
          `Board cell at (${reelIndex}, ${rowIndex}) must have a non-empty string symbolId.`,
          { reelIndex, rowIndex, symbolId },
        );
      }
    }
  }
}

/**
 * Extracts and normalizes ClusterConfiguration from a config input, GameConfig, or GameDefinition.
 */
export function normalizeClusterConfiguration(
  source: ClusterConfigInput | ClusterConfiguration | GameConfig | GameDefinition | undefined | null,
): NormalizedClusterConfiguration {
  if (!source || typeof source !== "object") {
    throw new InvalidClusterConfigurationError(
      "Cluster configuration source must be a non-null object.",
      { source: String(source) },
    );
  }

  let rawConfig: ClusterConfigInput | ClusterConfiguration;

  if (isGameConfig(source as GameConfig)) {
    const gc = source as GameConfig;
    if (gc.clusterConfiguration) {
      rawConfig = gc.clusterConfiguration;
    } else {
      rawConfig = {
        enabled: gc.grid.evaluationMode === "cluster",
        minimumClusterSize: 5,
        adjacency: "edge",
        allowWildJoin: true,
        allowFamilyGrouping: (gc.symbolFamiliesById?.size ?? 0) > 0,
      };
    }
  } else if (
    "clusterConfiguration" in source &&
    source.clusterConfiguration &&
    typeof source.clusterConfiguration === "object"
  ) {
    rawConfig = source.clusterConfiguration;
  } else {
    rawConfig = source as ClusterConfigInput;
  }

  const enabled = rawConfig.enabled === undefined ? true : Boolean(rawConfig.enabled);

  const minimumClusterSize = rawConfig.minimumClusterSize;
  if (
    typeof minimumClusterSize !== "number" ||
    !Number.isInteger(minimumClusterSize) ||
    minimumClusterSize < 1
  ) {
    throw new InvalidMinimumClusterSizeError(
      `minimumClusterSize must be a positive integer >= 1, received ${String(minimumClusterSize)}.`,
      { minimumClusterSize },
    );
  }

  const adjacency = (rawConfig.adjacency ?? "edge") as ClusterAdjacencyMode;
  if (typeof adjacency !== "string" || !VALID_ADJACENCY_MODES.has(adjacency)) {
    throw new InvalidAdjacencyModeError(
      `Invalid cluster adjacency mode "${String(adjacency)}". Supported values are "edge" and "hex".`,
      { adjacency },
    );
  }

  const hexGridOrientation = (rawConfig.hexGridOrientation ??
    "odd-q") as HexGridOrientation;
  if (
    typeof hexGridOrientation !== "string" ||
    !VALID_HEX_ORIENTATIONS.has(hexGridOrientation)
  ) {
    throw new InvalidClusterConfigurationError(
      `Invalid hexGridOrientation "${String(hexGridOrientation)}". Supported values are "odd-q", "even-q", "odd-r", "even-r".`,
      { hexGridOrientation },
    );
  }

  let eligibleSymbols: readonly string[] | null = null;
  if (rawConfig.eligibleSymbols !== undefined) {
    if (!Array.isArray(rawConfig.eligibleSymbols) || rawConfig.eligibleSymbols.length === 0) {
      throw new InvalidClusterConfigurationError(
        "eligibleSymbols must be a non-empty array of symbol IDs when provided.",
        { eligibleSymbols: rawConfig.eligibleSymbols },
      );
    }
    const seen = new Set<string>();
    const list: string[] = [];
    for (const symId of rawConfig.eligibleSymbols) {
      if (typeof symId !== "string" || symId.trim().length === 0) {
        throw new UnknownSymbolReferenceError(
          "eligibleSymbols entries must be non-empty string symbol IDs.",
          { symbolId: symId },
        );
      }
      if (!seen.has(symId)) {
        seen.add(symId);
        list.push(symId);
      }
    }
    eligibleSymbols = Object.freeze(list);
  }

  const familyPayoutSymbolByFamilyId: Record<string, string> = {};
  if (rawConfig.familyPayoutSymbolByFamilyId !== undefined) {
    if (
      !rawConfig.familyPayoutSymbolByFamilyId ||
      typeof rawConfig.familyPayoutSymbolByFamilyId !== "object" ||
      Array.isArray(rawConfig.familyPayoutSymbolByFamilyId)
    ) {
      throw new InvalidFamilyReferenceError(
        "familyPayoutSymbolByFamilyId must be a plain record mapping familyId -> symbolId.",
        { familyPayoutSymbolByFamilyId: rawConfig.familyPayoutSymbolByFamilyId },
      );
    }
    for (const [famId, symId] of Object.entries(rawConfig.familyPayoutSymbolByFamilyId)) {
      if (!famId.trim() || typeof symId !== "string" || !symId.trim()) {
        throw new InvalidFamilyReferenceError(
          `Invalid family payout mapping "${famId}" -> "${String(symId)}".`,
          { familyId: famId, symbolId: symId },
        );
      }
      familyPayoutSymbolByFamilyId[famId] = symId;
    }
  }

  return Object.freeze({
    enabled,
    minimumClusterSize,
    adjacency,
    allowWildJoin: rawConfig.allowWildJoin === undefined ? true : Boolean(rawConfig.allowWildJoin),
    allowFamilyGrouping:
      rawConfig.allowFamilyGrouping === undefined
        ? false
        : Boolean(rawConfig.allowFamilyGrouping),
    eligibleSymbols,
    familyPayoutSymbolByFamilyId: Object.freeze(familyPayoutSymbolByFamilyId),
    hexGridOrientation,
  });
}

/* -------------------------------------------------------------------------- */
/* SYMBOL REGISTRY & FAMILY NORMALIZATION                                     */
/* -------------------------------------------------------------------------- */

interface NormalizedClusterSymbol {
  readonly id: string;
  readonly isWild: boolean;
  readonly isScatter: boolean;
  readonly isBonus: boolean;
  readonly familyId: string | null;
}

function extractSymbolEntry(
  raw: ClusterSymbolInfo | NormalizedSymbolDefinition | CanonicalSymbolDefinition,
): NormalizedClusterSymbol {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string" || !raw.id.trim()) {
    throw new UnknownSymbolReferenceError(
      "Symbol definition in registry must have a non-empty string id.",
      { symbol: raw },
    );
  }

  if ("role" in raw && raw.role && typeof raw.role === "object") {
    const r = raw.role as NormalizedSymbolDefinition["role"];
    return Object.freeze({
      id: raw.id,
      isWild: Boolean(r.isWild),
      isScatter: Boolean(r.isScatter),
      isBonus: Boolean(r.isBonus),
      familyId: raw.familyId ?? null,
    });
  }

  if ("roles" in raw && Array.isArray(raw.roles)) {
    const symDef = raw as CanonicalSymbolDefinition;
    return Object.freeze({
      id: raw.id,
      isWild: symDef.roles.includes("wild"),
      isScatter: symDef.roles.includes("scatter"),
      isBonus: symDef.roles.includes("bonus"),
      familyId: symDef.familyId ?? null,
    });
  }

  const info = raw as ClusterSymbolInfo;
  return Object.freeze({
    id: info.id,
    isWild: Boolean(info.isWild),
    isScatter: Boolean(info.isScatter),
    isBonus: Boolean(info.isBonus),
    familyId: info.familyId ?? null,
  });
}

function normalizeSymbolRegistry(
  source: ClusterSymbolRegistrySource | undefined | null,
): ReadonlyMap<string, NormalizedClusterSymbol> | null {
  if (!source) {
    return null;
  }

  const map = new Map<string, NormalizedClusterSymbol>();

  if (isGameConfig(source as GameConfig)) {
    const gc = source as GameConfig;
    for (const [id, sym] of gc.symbolsById.entries()) {
      map.set(id, extractSymbolEntry(sym));
    }
    if (gc.variantsById) {
      for (const [id, sym] of gc.variantsById.entries()) {
        if (!map.has(id)) {
          map.set(id, extractSymbolEntry(sym));
        }
      }
    }
    return map;
  }

  if (source instanceof Map) {
    for (const [id, raw] of source.entries()) {
      const normalized = extractSymbolEntry(raw);
      map.set(id, normalized);
    }
    return map;
  }

  if (Array.isArray(source)) {
    for (const raw of source) {
      const normalized = extractSymbolEntry(raw);
      map.set(normalized.id, normalized);
    }
    return map;
  }

  if ("symbols" in source && Array.isArray((source as GameDefinition).symbols)) {
    const gd = source as GameDefinition;
    for (const sym of gd.symbols) {
      const normalized = extractSymbolEntry(sym);
      map.set(normalized.id, normalized);
    }
    return map;
  }

  if (typeof source === "object") {
    for (const [key, raw] of Object.entries(
      source as Record<
        string,
        ClusterSymbolInfo | NormalizedSymbolDefinition | CanonicalSymbolDefinition
      >,
    )) {
      const normalized = extractSymbolEntry(raw);
      map.set(key, normalized);
    }
    return map;
  }

  return null;
}

interface NormalizedFamilyRegistry {
  readonly familyMembersByFamilyId: ReadonlyMap<string, readonly string[]>;
  readonly familyIdBySymbolId: ReadonlyMap<string, string>;
}

function normalizeFamilyRegistry(
  symbolRegistry: ReadonlyMap<string, NormalizedClusterSymbol> | null,
  familySource: ClusterFamilySource | undefined | null,
  configSource?: unknown,
): NormalizedFamilyRegistry {
  const membersMap = new Map<string, Set<string>>();
  const symbolToFamily = new Map<string, string>();

  const registerMember = (familyId: string, symbolId: string) => {
    if (typeof familyId !== "string" || familyId.trim().length === 0) {
      throw new InvalidFamilyReferenceError(
        "Symbol family ID must be a non-empty string.",
        { familyId, symbolId },
      );
    }
    if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
      throw new InvalidFamilyReferenceError(
        `Symbol family "${familyId}" contains an invalid symbol ID.`,
        { familyId, symbolId },
      );
    }
    if (symbolRegistry && !symbolRegistry.has(symbolId)) {
      throw new UnknownSymbolReferenceError(
        `Symbol family "${familyId}" references unknown symbol "${symbolId}".`,
        { familyId, symbolId },
      );
    }
    const existingFamily = symbolToFamily.get(symbolId);
    if (existingFamily && existingFamily !== familyId) {
      throw new InvalidFamilyReferenceError(
        `Symbol "${symbolId}" cannot belong to multiple families ("${existingFamily}" and "${familyId}").`,
        { symbolId, existingFamily, familyId },
      );
    }
    symbolToFamily.set(symbolId, familyId);
    let set = membersMap.get(familyId);
    if (!set) {
      set = new Set<string>();
      membersMap.set(familyId, set);
    }
    set.add(symbolId);
  };

  // 1. Collect from symbolRegistry's per-symbol familyId
  if (symbolRegistry) {
    for (const sym of symbolRegistry.values()) {
      if (sym.familyId !== null && sym.familyId !== undefined) {
        if (typeof sym.familyId !== "string" || sym.familyId.trim().length === 0) {
          throw new InvalidFamilyReferenceError(
            `Symbol "${sym.id}" has an invalid empty family reference.`,
            { symbolId: sym.id, familyId: sym.familyId },
          );
        }
        registerMember(sym.familyId, sym.id);
      }
    }
  }

  // 2. Collect from GameConfig / GameDefinition if passed as configSource
  if (configSource && typeof configSource === "object") {
    if (isGameConfig(configSource as GameConfig)) {
      const gc = configSource as GameConfig;
      if (gc.symbolFamiliesById) {
        for (const [famId, symIds] of gc.symbolFamiliesById.entries()) {
          if (!Array.isArray(symIds) || symIds.length === 0) {
            throw new InvalidFamilyReferenceError(
              `Symbol family "${famId}" must contain at least one symbol ID.`,
              { familyId: famId },
            );
          }
          for (const symId of symIds) {
            registerMember(famId, symId);
          }
        }
      }
    } else if (
      "symbolFamilies" in configSource &&
      Array.isArray((configSource as GameDefinition).symbolFamilies)
    ) {
      for (const fam of (configSource as GameDefinition).symbolFamilies ?? []) {
        if (!fam || typeof fam.id !== "string" || !fam.id.trim()) {
          throw new InvalidFamilyReferenceError(
            "SymbolFamily definition must have a non-empty string id.",
            { family: fam },
          );
        }
        const members = fam.memberIds;
        if (!Array.isArray(members) || members.length === 0) {
          throw new InvalidFamilyReferenceError(
            `SymbolFamily "${fam.id}" must have a non-empty memberIds array.`,
            { familyId: fam.id },
          );
        }
        for (const symId of members) {
          registerMember(fam.id, symId);
        }
      }
    }
  }

  // 3. Collect from explicit familySource option
  if (familySource) {
    if (familySource instanceof Map) {
      for (const [famId, symIds] of familySource.entries()) {
        if (typeof famId !== "string" || !famId.trim() || !Array.isArray(symIds) || symIds.length === 0) {
          throw new InvalidFamilyReferenceError(
            `Invalid symbol family "${String(famId)}": must map to a non-empty array of symbol IDs.`,
            { familyId: famId },
          );
        }
        for (const symId of symIds) {
          registerMember(famId, symId);
        }
      }
    } else if (Array.isArray(familySource)) {
      for (const fam of familySource) {
        if (!fam || typeof fam.id !== "string" || !fam.id.trim()) {
          throw new InvalidFamilyReferenceError(
            "SymbolFamily must have a non-empty string id.",
            { family: fam },
          );
        }
        const members =
          "memberIds" in fam
            ? fam.memberIds
            : (fam as unknown as { symbolIds?: readonly string[] }).symbolIds;
        if (!Array.isArray(members) || members.length === 0) {
          throw new InvalidFamilyReferenceError(
            `SymbolFamily "${fam.id}" must have a non-empty memberIds array.`,
            { familyId: fam.id },
          );
        }
        for (const symId of members) {
          registerMember(fam.id, symId);
        }
      }
    } else if (typeof familySource === "object") {
      for (const [famId, symIds] of Object.entries(
        familySource as Record<string, readonly string[]>,
      )) {
        if (!famId.trim() || !Array.isArray(symIds) || symIds.length === 0) {
          throw new InvalidFamilyReferenceError(
            `Invalid symbol family "${famId}": must map to a non-empty array of symbol IDs.`,
            { familyId: famId },
          );
        }
        for (const symId of symIds) {
          registerMember(famId, symId);
        }
      }
    }
  }

  const frozenMembersByFamilyId = new Map<string, readonly string[]>();
  for (const [famId, set] of membersMap.entries()) {
    const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
    frozenMembersByFamilyId.set(famId, Object.freeze(sorted));
  }

  return {
    familyMembersByFamilyId: frozenMembersByFamilyId,
    familyIdBySymbolId: symbolToFamily,
  };
}

/* -------------------------------------------------------------------------- */
/* DETERMINISTIC ADJACENCY TOPOLOGY ("edge" vs "hex")                         */
/* -------------------------------------------------------------------------- */

/**
 * Returns the deterministic in-bounds neighbor coordinates for a given board position
 * under the configured adjacency mode ("edge" or "hex").
 *
 * Coordinate Convention (from B04 Board):
 * - `reelIndex` (column c): 0 <= c < board.reelCount (left to right)
 * - `rowIndex` (row r):     0 <= r < board.reels[c].length (top to bottom)
 *
 * 1. "edge" adjacency (4-connected orthogonal von Neumann neighborhood):
 *    - (c, r - 1) [North / Up]
 *    - (c, r + 1) [South / Down]
 *    - (c - 1, r) [West / Left]
 *    - (c + 1, r) [East / Right]
 *    Corner-only diagonal neighbors are NEVER adjacent in "edge" mode.
 *
 * 2. "hex" adjacency (6-connected hexagonal neighborhood):
 *    - Default orientation "odd-q" (vertical reel columns where odd-indexed reels
 *      c % 2 === 1 are shifted down by +0.5 row relative to even-indexed reels):
 *      - All 4 orthogonal neighbors: (c, r - 1), (c, r + 1), (c - 1, r), (c + 1, r)
 *      - Plus 2 staggered diagonal neighbors across adjacent reels:
 *        * When c is even (c % 2 === 0): (c - 1, r - 1) and (c + 1, r - 1)
 *        * When c is odd  (c % 2 === 1): (c - 1, r + 1) and (c + 1, r + 1)
 *      This defines a strictly symmetric (undirected) 6-regular hex graph.
 *    - Also supports "even-q", "odd-r", and "even-r" offset hex orientations.
 */
export function getAdjacentPositions(
  board: Board,
  position: Position,
  adjacency: ClusterAdjacencyMode,
  hexGridOrientation: HexGridOrientation = "odd-q",
): readonly Position[] {
  const c = position.reelIndex;
  const r = position.rowIndex;

  let candidateOffsets: ReadonlyArray<readonly [number, number]>;

  if (adjacency === "edge") {
    candidateOffsets = [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ];
  } else if (adjacency === "hex") {
    switch (hexGridOrientation) {
      case "odd-q": {
        const isOddCol = Math.abs(c % 2) === 1;
        candidateOffsets = isOddCol
          ? [
              [0, -1],
              [0, 1],
              [-1, 0],
              [1, 0],
              [-1, 1],
              [1, 1],
            ]
          : [
              [0, -1],
              [0, 1],
              [-1, 0],
              [1, 0],
              [-1, -1],
              [1, -1],
            ];
        break;
      }
      case "even-q": {
        const isEvenCol = Math.abs(c % 2) === 0;
        candidateOffsets = isEvenCol
          ? [
              [0, -1],
              [0, 1],
              [-1, 0],
              [1, 0],
              [-1, 1],
              [1, 1],
            ]
          : [
              [0, -1],
              [0, 1],
              [-1, 0],
              [1, 0],
              [-1, -1],
              [1, -1],
            ];
        break;
      }
      case "odd-r": {
        const isOddRow = Math.abs(r % 2) === 1;
        candidateOffsets = isOddRow
          ? [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
              [1, -1],
              [1, 1],
            ]
          : [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
              [-1, -1],
              [-1, 1],
            ];
        break;
      }
      case "even-r": {
        const isEvenRow = Math.abs(r % 2) === 0;
        candidateOffsets = isEvenRow
          ? [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
              [1, -1],
              [1, 1],
            ]
          : [
              [-1, 0],
              [1, 0],
              [0, -1],
              [0, 1],
              [-1, -1],
              [-1, 1],
            ];
        break;
      }
    }
  } else {
    throw new InvalidAdjacencyModeError(
      `Invalid cluster adjacency mode "${String(adjacency)}".`,
      { adjacency },
    );
  }

  const boardColumns = getBoardColumns(board);
  if (!boardColumns) {
    throw new InvalidBoardError("Board must contain a valid cells matrix.", {
      board: String(board),
    });
  }

  const neighbors: Position[] = [];
  for (const [dc, dr] of candidateOffsets) {
    const nc = c + dc;
    const nr = r + dr;
    if (nc >= 0 && nc < boardColumns.length) {
      const col = boardColumns[nc]!;
      if (nr >= 0 && nr < col.length) {
        neighbors.push(
          Object.freeze({
            reelIndex: nc,
            rowIndex: nr,
          }),
        );
      }
    }
  }

  return Object.freeze(neighbors);
}

/* -------------------------------------------------------------------------- */
/* CORE CLUSTER EVALUATION                                                    */
/* -------------------------------------------------------------------------- */

interface CandidateTarget {
  readonly kind: "symbol" | "family";
  readonly id: string;
  readonly familyId?: string;
  readonly memberSymbolIds: ReadonlySet<string>;
}

/**
 * Resolves the paytable multiplier for a given symbolId and cluster size (matchCount).
 * If clusterSize exceeds the highest configured matchCount tier in the paytable,
 * falls back to the highest configured tier <= clusterSize (standard cluster ladder behavior),
 * or exact tier if present.
 */
function lookupClusterBaseMultiplier(
  paytableLookup: ReadonlyMap<string, ReadonlyMap<number, number>> | null,
  paytableEngineInstance: PaytableEngine | null,
  symbolId: string,
  clusterSize: number,
): number | undefined {
  if (paytableEngineInstance) {
    if (!paytableEngineInstance.hasSymbol(symbolId)) {
      return undefined;
    }
    return paytableEngineInstance.getMultiplier(symbolId, clusterSize);
  }
  if (!paytableLookup) {
    return undefined;
  }
  const byCount = paytableLookup.get(symbolId);
  if (!byCount || byCount.size === 0) {
    return undefined;
  }
  const exact = byCount.get(clusterSize);
  if (exact !== undefined) {
    return exact;
  }
  // Check highest configured tier <= clusterSize (e.g. paytable defines up to 15+ and cluster is 18)
  let bestCount = -1;
  let bestMultiplier: number | undefined;
  for (const [tierCount, mult] of byCount.entries()) {
    if (tierCount <= clusterSize && tierCount > bestCount) {
      bestCount = tierCount;
      bestMultiplier = mult;
    }
  }
  return bestMultiplier;
}

/**
 * Evaluates all connected-component clusters on the given B04 Board.
 */
export function evaluateClusters(
  board: Board,
  configInput?: ClusterConfigInput | ClusterConfiguration | GameConfig | GameDefinition,
  options: ClusterEvaluationOptions = {},
): ClusterEvaluationResult {
  validateBoardForClusters(board);
  const boardColumns = getBoardColumns(board)!;

  const normalizedConfig = normalizeClusterConfiguration(
    configInput ?? {
      enabled: true,
      minimumClusterSize: 5,
      adjacency: "edge",
      allowWildJoin: true,
      allowFamilyGrouping: false,
    },
  );

  // Extract symbolRegistry from options or configInput
  const symbolRegistry = normalizeSymbolRegistry(
    options.symbolRegistry !== undefined
      ? options.symbolRegistry
      : isGameConfig(configInput as GameConfig) ||
          (configInput && typeof configInput === "object" && "symbols" in configInput)
        ? (configInput as GameConfig | GameDefinition)
        : null,
  );

  // Validate all board symbols and eligibleSymbols against symbolRegistry when provided
  if (symbolRegistry) {
    for (let c = 0; c < boardColumns.length; c++) {
      const col = boardColumns[c]!;
      for (let r = 0; r < col.length; r++) {
        const cell = col[r]!;
        if (!symbolRegistry.has(cell.symbolId)) {
          throw new UnknownSymbolReferenceError(
            `Board cell at (${c}, ${r}) references unknown symbol "${cell.symbolId}".`,
            { reelIndex: c, rowIndex: r, symbolId: cell.symbolId },
          );
        }
      }
    }
    if (normalizedConfig.eligibleSymbols) {
      for (const symId of normalizedConfig.eligibleSymbols) {
        if (!symbolRegistry.has(symId)) {
          throw new UnknownSymbolReferenceError(
            `Cluster eligibleSymbols references unknown symbol "${symId}".`,
            { symbolId: symId },
          );
        }
      }
    }
  }

  // Validate family registry when family grouping is enabled or families are provided
  const familyRegistry = normalizeFamilyRegistry(
    symbolRegistry,
    options.families,
    configInput,
  );

  if (normalizedConfig.allowFamilyGrouping) {
    for (const [famId, payoutSymId] of Object.entries(
      normalizedConfig.familyPayoutSymbolByFamilyId,
    )) {
      if (!familyRegistry.familyMembersByFamilyId.has(famId)) {
        throw new InvalidFamilyReferenceError(
          `familyPayoutSymbolByFamilyId references unknown family "${famId}".`,
          { familyId: famId, payoutSymbolId: payoutSymId },
        );
      }
      if (symbolRegistry && !symbolRegistry.has(payoutSymId)) {
        throw new UnknownSymbolReferenceError(
          `familyPayoutSymbolByFamilyId for family "${famId}" references unknown symbol "${payoutSymId}".`,
          { familyId: famId, payoutSymbolId: payoutSymId },
        );
      }
    }
  }

  // Resolve WildEngine (B07)
  let wildEngine: WildEngine | null = null;
  const wildPaysOnOwnSet = new Set<string>();

  if (options.wildEngine !== undefined && options.wildEngine !== null) {
    if (
      typeof (options.wildEngine as WildEngine).canSubstitute === "function" &&
      typeof (options.wildEngine as WildEngine).isWild === "function"
    ) {
      wildEngine = options.wildEngine as WildEngine;
    } else {
      const rawWildObj = options.wildEngine as WildEngineSource;
      wildEngine = createWildEngine(rawWildObj);
      if (
        rawWildObj &&
        typeof rawWildObj === "object" &&
        "substitutionRules" in rawWildObj &&
        Array.isArray(rawWildObj.substitutionRules)
      ) {
        for (const r of rawWildObj.substitutionRules) {
          if (r?.paysOnOwn) {
            wildPaysOnOwnSet.add(r.wildSymbolId);
          }
        }
      }
    }
  } else if (isGameConfig(configInput as GameConfig)) {
    const gc = configInput as GameConfig;
    if (
      gc.wildConfiguration
        ? gc.wildConfiguration.enabled
        : gc.wildSymbolIds.size > 0
    ) {
      wildEngine = createWildEngine(gc);
      for (const r of gc.wildConfiguration?.substitutionRules ?? []) {
        if (r.paysOnOwn) {
          wildPaysOnOwnSet.add(r.wildSymbolId);
        }
      }
    }
  } else if (
    configInput &&
    typeof configInput === "object" &&
    "wildConfiguration" in configInput &&
    (configInput as GameDefinition).wildConfiguration
  ) {
    const gd = configInput as GameDefinition;
    if (gd.wildConfiguration) {
      wildEngine = createWildEngine(gd.wildConfiguration);
      for (const r of gd.wildConfiguration.substitutionRules ?? []) {
        if (r.paysOnOwn) {
          wildPaysOnOwnSet.add(r.wildSymbolId);
        }
      }
    }
  }

  // Resolve Paytable lookup (B06) if provided
  let paytableLookup: ReadonlyMap<string, ReadonlyMap<number, number>> | null = null;
  let paytableEngineInstance: PaytableEngine | null = null;
  const rawPaytableSource =
    options.paytable !== undefined
      ? options.paytable
      : isGameConfig(configInput as GameConfig)
        ? (configInput as GameConfig)
        : configInput &&
            typeof configInput === "object" &&
            "paytable" in configInput &&
            (configInput as GameDefinition).paytable
          ? (configInput as GameDefinition)
          : null;

  if (rawPaytableSource !== null && rawPaytableSource !== undefined) {
    if (
      typeof (rawPaytableSource as PaytableEngine).getMultiplier === "function" &&
      typeof (rawPaytableSource as PaytableEngine).hasSymbol === "function"
    ) {
      paytableEngineInstance = rawPaytableSource as PaytableEngine;
    } else if (
      typeof rawPaytableSource === "object" &&
      !Array.isArray(rawPaytableSource) &&
      !isGameConfig(rawPaytableSource as GameConfig) &&
      !("entries" in rawPaytableSource) &&
      !("bySymbolId" in rawPaytableSource)
    ) {
      // Plain Record<symbolId, Record<matchCount, multiplier>>
      const map = new Map<string, ReadonlyMap<number, number>>();
      for (const [symId, ladderObj] of Object.entries(
        rawPaytableSource as Record<string, Record<number, number>>,
      )) {
        if (!ladderObj || typeof ladderObj !== "object") {
          throw new InvalidPaytableReferenceError(
            `Invalid paytable ladder for symbol "${symId}".`,
            { symbolId: symId },
          );
        }
        const inner = new Map<number, number>();
        for (const [cntStr, mult] of Object.entries(ladderObj)) {
          const cnt = Number(cntStr);
          if (
            !Number.isInteger(cnt) ||
            cnt < 1 ||
            typeof mult !== "number" ||
            !Number.isFinite(mult) ||
            mult < 0
          ) {
            throw new InvalidPaytableReferenceError(
              `Invalid paytable tier (${cntStr} -> ${String(mult)}) for symbol "${symId}".`,
              { symbolId: symId, matchCount: cntStr, multiplier: mult },
            );
          }
          inner.set(cnt, mult);
        }
        map.set(symId, inner);
      }
      paytableLookup = map;
    } else {
      try {
        const normalizedPt = normalizePaytableLookup(
          rawPaytableSource as PaytableSource,
        );
        paytableLookup = normalizedPt.bySymbolId;
      } catch (err) {
        throw new InvalidPaytableReferenceError(
          err instanceof Error
            ? err.message
            : "Invalid paytable source for ClusterEngine.",
          { cause: String(err) },
        );
      }
    }
  }

  // Early return when cluster engine is disabled
  if (!normalizedConfig.enabled) {
    return Object.freeze({
      evaluationMode: "cluster",
      enabled: false,
      minimumClusterSize: normalizedConfig.minimumClusterSize,
      adjacency: normalizedConfig.adjacency,
      clusters: Object.freeze([]),
      qualifyingClusterCount: 0,
      totalClusterCells: 0,
      uniqueWinningCellCount: 0,
      winningCells: Object.freeze([]),
      ...(paytableLookup || paytableEngineInstance ? { totalBaseMultiplier: 0 } : {}),
      ...(options.payoutContext ? { totalPayout: 0 } : {}),
    });
  }

  const eligibleSymbolSet = normalizedConfig.eligibleSymbols
    ? new Set<string>(normalizedConfig.eligibleSymbols)
    : null;

  const isSymbolWild = (symbolId: string): boolean => {
    if (wildEngine) {
      try {
        if (wildEngine.isWild(symbolId)) {
          return true;
        }
      } catch {
        // Symbol not in WildEngine strict catalog -> check symbolRegistry fallback
      }
    }
    const regSym = symbolRegistry?.get(symbolId);
    return Boolean(regSym?.isWild);
  };

  const isSymbolEligibleNaturalCandidate = (symbolId: string): boolean => {
    if (eligibleSymbolSet) {
      return eligibleSymbolSet.has(symbolId);
    }
    const regSym = symbolRegistry?.get(symbolId);
    if (regSym) {
      // Scatter and Bonus symbols are excluded unless explicitly configured in eligibleSymbols
      if (regSym.isScatter || regSym.isBonus) {
        return false;
      }
    }
    if (isSymbolWild(symbolId)) {
      // A Wild symbol only forms its own standalone candidate target if paysOnOwn is true
      // or if allowWildJoin is false
      if (!normalizedConfig.allowWildJoin) {
        return true;
      }
      return wildPaysOnOwnSet.has(symbolId);
    }
    return true;
  };

  // Discover distinct candidate targets present on the board
  const candidateTargetsById = new Map<string, CandidateTarget>();

  for (let c = 0; c < boardColumns.length; c++) {
    const col = boardColumns[c]!;
    for (let r = 0; r < col.length; r++) {
      const symbolId = col[r]!.symbolId;
      if (!isSymbolEligibleNaturalCandidate(symbolId)) {
        continue;
      }

      if (normalizedConfig.allowFamilyGrouping) {
        const famId = familyRegistry.familyIdBySymbolId.get(symbolId);
        if (famId) {
          const targetKey = `family:${famId}`;
          if (!candidateTargetsById.has(targetKey)) {
            const members = familyRegistry.familyMembersByFamilyId.get(famId) ?? [symbolId];
            candidateTargetsById.set(targetKey, {
              kind: "family",
              id: famId,
              familyId: famId,
              memberSymbolIds: new Set<string>(members),
            });
          }
          continue;
        }
      }

      const targetKey = `symbol:${symbolId}`;
      if (!candidateTargetsById.has(targetKey)) {
        candidateTargetsById.set(targetKey, {
          kind: "symbol",
          id: symbolId,
          memberSymbolIds: new Set<string>([symbolId]),
        });
      }
    }
  }

  // Deterministic candidate order
  const sortedCandidateTargets = Array.from(candidateTargetsById.values()).sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  // Precompute flat cell index mapping for O(1) visited tracking without mutating Board
  const reelOffsets: number[] = [];
  let totalBoardCells = 0;
  for (let c = 0; c < boardColumns.length; c++) {
    reelOffsets.push(totalBoardCells);
    totalBoardCells += boardColumns[c]!.length;
  }
  const toFlatIndex = (reelIndex: number, rowIndex: number): number =>
    reelOffsets[reelIndex]! + rowIndex;

  // Helper to check if a cell at (reelIndex, rowIndex) qualifies for a given CandidateTarget
  const checkCellMatch = (
    cell: Cell,
    target: CandidateTarget,
  ): {
    matches: boolean;
    isWildMatch: boolean;
    effectiveSymbolId: string;
  } => {
    const actualId = cell.symbolId;

    // 1. Direct natural match (exact symbol or member of target family)
    if (target.memberSymbolIds.has(actualId)) {
      return {
        matches: true,
        isWildMatch: false,
        effectiveSymbolId: target.kind === "symbol" ? target.id : actualId,
      };
    }

    // 2. B07 Wild substitution match (when allowWildJoin is true)
    if (
      normalizedConfig.allowWildJoin &&
      wildEngine &&
      isSymbolWild(actualId) &&
      wildEngine.isWildActiveOnReel(actualId, cell.reelIndex)
    ) {
      // For a single symbol target, check canSubstitute(wild, target.id)
      // For a family target, check if Wild can substitute for at least one member of the family
      for (const memberId of target.memberSymbolIds) {
        if (wildEngine.canSubstitute(actualId, memberId)) {
          return {
            matches: true,
            isWildMatch: true,
            effectiveSymbolId: target.kind === "symbol" ? target.id : memberId,
          };
        }
      }
    }

    return {
      matches: false,
      isWildMatch: false,
      effectiveSymbolId: actualId,
    };
  };

  const rawClusters: ClusterWin[] = [];

  // Run explicit BFS connected-component discovery for each candidate target
  for (const target of sortedCandidateTargets) {
    const visited = new Uint8Array(totalBoardCells);

    for (let startReel = 0; startReel < boardColumns.length; startReel++) {
      const col = boardColumns[startReel]!;
      for (let startRow = 0; startRow < col.length; startRow++) {
        const startFlatIdx = toFlatIndex(startReel, startRow);
        if (visited[startFlatIdx] === 1) {
          continue;
        }

        const startCell = col[startRow]!;
        const startMatch = checkCellMatch(startCell, target);
        if (!startMatch.matches) {
          visited[startFlatIdx] = 1;
          continue;
        }

        // BFS traversal across connected qualifying cells
        const queue: Position[] = [{ reelIndex: startReel, rowIndex: startRow }];
        visited[startFlatIdx] = 1;

        const componentCells: ClusterCell[] = [];
        let naturalCount = 0;
        let wildCount = 0;

        let head = 0;
        while (head < queue.length) {
          const currentPos = queue[head++]!;
          const currentCell =
            boardColumns[currentPos.reelIndex]![currentPos.rowIndex]!;
          const matchInfo = checkCellMatch(currentCell, target);

          if (matchInfo.isWildMatch) {
            wildCount++;
          } else {
            naturalCount++;
          }

          componentCells.push(
            Object.freeze({
              reelIndex: currentCell.reelIndex,
              rowIndex: currentCell.rowIndex,
              symbolId: currentCell.symbolId,
              actualSymbolId: currentCell.symbolId,
              effectiveSymbolId: matchInfo.effectiveSymbolId,
              isWild: matchInfo.isWildMatch,
              ...(currentCell.stopIndex !== undefined
                ? { stopIndex: currentCell.stopIndex }
                : {}),
            }),
          );

          const neighbors = getAdjacentPositions(
            board,
            currentPos,
            normalizedConfig.adjacency,
            normalizedConfig.hexGridOrientation,
          );

          for (let nIdx = 0; nIdx < neighbors.length; nIdx++) {
            const neighborPos = neighbors[nIdx]!;
            const neighborFlatIdx = toFlatIndex(
              neighborPos.reelIndex,
              neighborPos.rowIndex,
            );
            if (visited[neighborFlatIdx] === 1) {
              continue;
            }

            const neighborCell =
              boardColumns[neighborPos.reelIndex]![neighborPos.rowIndex]!;
            const neighborMatch = checkCellMatch(neighborCell, target);
            if (neighborMatch.matches) {
              visited[neighborFlatIdx] = 1;
              queue.push(neighborPos);
            }
          }
        }

        // A cluster for a regular symbol/family must include at least 1 natural cell
        // of that symbol/family (unless the target symbol itself is a Wild symbol)
        if (naturalCount === 0) {
          continue;
        }

        if (componentCells.length < normalizedConfig.minimumClusterSize) {
          continue;
        }

        // Deterministically sort member cells by reelIndex ASC, rowIndex ASC
        componentCells.sort(
          (a, b) => a.reelIndex - b.reelIndex || a.rowIndex - b.rowIndex,
        );

        // Compute participatingSymbols and symbolCounts
        const countsRecord: Record<string, number> = {};
        const naturalSymbolsSeen = new Set<string>();
        for (const cCell of componentCells) {
          countsRecord[cCell.actualSymbolId] =
            (countsRecord[cCell.actualSymbolId] ?? 0) + 1;
          if (!cCell.isWild) {
            naturalSymbolsSeen.add(cCell.actualSymbolId);
          }
        }

        const participatingSymbols = Object.freeze(
          Object.keys(countsRecord).sort((a, b) => a.localeCompare(b)),
        );

        const sortedCountsRecord: Record<string, number> = {};
        for (const symKey of participatingSymbols) {
          sortedCountsRecord[symKey] = countsRecord[symKey]!;
        }

        // Resolve payoutSymbolId and baseMultiplier according to configured policy
        let payoutSymbolId: string | undefined;
        if (target.kind === "symbol") {
          payoutSymbolId = target.id;
        } else if (target.familyId) {
          const explicitFamilyPayoutSymbol =
            normalizedConfig.familyPayoutSymbolByFamilyId[target.familyId];
          if (explicitFamilyPayoutSymbol) {
            payoutSymbolId = explicitFamilyPayoutSymbol;
          } else if (paytableLookup?.has(target.familyId)) {
            payoutSymbolId = target.familyId;
          } else if (naturalSymbolsSeen.size === 1) {
            payoutSymbolId = Array.from(naturalSymbolsSeen)[0];
          }
          // When multiple distinct family members participate and no explicit family payout rule
          // is configured, payoutSymbolId remains undefined so B10 never invents a silent rule.
        }

        const baseMultiplier =
          payoutSymbolId !== undefined
            ? lookupClusterBaseMultiplier(
                paytableLookup,
                paytableEngineInstance,
                payoutSymbolId,
                componentCells.length,
              )
            : undefined;

        const totalPayout =
          baseMultiplier !== undefined && options.payoutContext
            ? roundCurrency(baseMultiplier * options.payoutContext.bet)
            : undefined;

        const anchor = componentCells[0]!;
        const clusterId = `cluster:${target.id}:r${anchor.reelIndex}c${anchor.rowIndex}`;

        rawClusters.push(
          Object.freeze({
            id: clusterId,
            symbolId: target.id,
            ...(target.familyId !== undefined ? { familyId: target.familyId } : {}),
            size: componentCells.length,
            clusterSize: componentCells.length,
            cells: Object.freeze(componentCells),
            participatingSymbols,
            symbolCounts: Object.freeze(sortedCountsRecord),
            minimumClusterSize: normalizedConfig.minimumClusterSize,
            adjacency: normalizedConfig.adjacency,
            wildCount,
            naturalCount,
            ...(baseMultiplier !== undefined ? { baseMultiplier } : {}),
            ...(totalPayout !== undefined ? { totalPayout } : {}),
            ...(payoutSymbolId !== undefined ? { payoutSymbolId } : {}),
          }),
        );
      }
    }
  }

  // Deterministic ordering of clusters:
  // 1. symbolId ascending
  // 2. lowest anchor reelIndex ascending
  // 3. lowest anchor rowIndex ascending
  rawClusters.sort((a, b) => {
    const symCmp = a.symbolId.localeCompare(b.symbolId);
    if (symCmp !== 0) return symCmp;
    const aAnchor = a.cells[0]!;
    const bAnchor = b.cells[0]!;
    if (aAnchor.reelIndex !== bAnchor.reelIndex) {
      return aAnchor.reelIndex - bAnchor.reelIndex;
    }
    return aAnchor.rowIndex - bAnchor.rowIndex;
  });

  // Compute aggregate metrics and unique winning cells for future Cascade/Tumble compatibility
  let totalClusterCells = 0;
  let totalBaseMultiplier = 0;
  let hasAnyMultiplier =
    paytableLookup !== null || paytableEngineInstance !== null;
  let totalPayout = 0;
  const uniqueWinningPositionsMap = new Map<number, Position>();

  for (const cluster of rawClusters) {
    totalClusterCells += cluster.size;
    if (cluster.baseMultiplier !== undefined) {
      totalBaseMultiplier = roundCurrency(totalBaseMultiplier + cluster.baseMultiplier);
      hasAnyMultiplier = true;
    }
    if (cluster.totalPayout !== undefined) {
      totalPayout = roundCurrency(totalPayout + cluster.totalPayout);
    }
    for (const cell of cluster.cells) {
      const flatIdx = toFlatIndex(cell.reelIndex, cell.rowIndex);
      if (!uniqueWinningPositionsMap.has(flatIdx)) {
        uniqueWinningPositionsMap.set(
          flatIdx,
          Object.freeze({
            reelIndex: cell.reelIndex,
            rowIndex: cell.rowIndex,
          }),
        );
      }
    }
  }

  const winningCells = Object.freeze(
    Array.from(uniqueWinningPositionsMap.values()).sort(
      (a, b) => a.reelIndex - b.reelIndex || a.rowIndex - b.rowIndex,
    ),
  );

  return Object.freeze({
    evaluationMode: "cluster",
    enabled: true,
    minimumClusterSize: normalizedConfig.minimumClusterSize,
    adjacency: normalizedConfig.adjacency,
    clusters: Object.freeze(rawClusters),
    qualifyingClusterCount: rawClusters.length,
    totalClusterCells,
    uniqueWinningCellCount: winningCells.length,
    winningCells,
    ...(hasAnyMultiplier ? { totalBaseMultiplier } : {}),
    ...(options.payoutContext ? { totalPayout } : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* SERIALIZATION & DESERIALIZATION                                            */
/* -------------------------------------------------------------------------- */

export function serializeClusterEvaluationResult(
  result: ClusterEvaluationResult,
): string {
  return JSON.stringify(result);
}

export function deserializeClusterEvaluationResult(
  payload: string,
): ClusterEvaluationResult {
  if (typeof payload !== "string" || payload.trim().length === 0) {
    throw new InvalidClusterConfigurationError(
      "Serialized ClusterEvaluationResult payload must be a non-empty JSON string.",
      { payload },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (err) {
    throw new InvalidClusterConfigurationError(
      `Failed to parse serialized ClusterEvaluationResult JSON: ${err instanceof Error ? err.message : String(err)}`,
      { payload },
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidClusterConfigurationError(
      "Deserialized ClusterEvaluationResult must be an object.",
      { parsed },
    );
  }

  const candidate = parsed as Partial<ClusterEvaluationResult>;
  if (
    candidate.evaluationMode !== "cluster" ||
    typeof candidate.enabled !== "boolean" ||
    typeof candidate.minimumClusterSize !== "number" ||
    !VALID_ADJACENCY_MODES.has(candidate.adjacency as ClusterAdjacencyMode) ||
    !Array.isArray(candidate.clusters) ||
    typeof candidate.qualifyingClusterCount !== "number" ||
    typeof candidate.totalClusterCells !== "number"
  ) {
    throw new InvalidClusterConfigurationError(
      "Deserialized object does not match ClusterEvaluationResult contract.",
      { parsed },
    );
  }

  const frozenClusters: ClusterWin[] = candidate.clusters.map((cluster) => {
    const frozenCells = Array.isArray(cluster.cells)
      ? cluster.cells.map((cell: ClusterCell) =>
          Object.freeze({
            reelIndex: cell.reelIndex,
            rowIndex: cell.rowIndex,
            symbolId: cell.symbolId,
            actualSymbolId: cell.actualSymbolId ?? cell.symbolId,
            effectiveSymbolId: cell.effectiveSymbolId ?? cell.symbolId,
            isWild: Boolean(cell.isWild),
            ...(cell.stopIndex !== undefined ? { stopIndex: cell.stopIndex } : {}),
          }),
        )
      : [];

    return Object.freeze({
      id: cluster.id,
      symbolId: cluster.symbolId,
      ...(cluster.familyId !== undefined ? { familyId: cluster.familyId } : {}),
      size: cluster.size,
      clusterSize: cluster.clusterSize ?? cluster.size,
      cells: Object.freeze(frozenCells),
      participatingSymbols: Object.freeze([...(cluster.participatingSymbols ?? [])]),
      symbolCounts: Object.freeze({ ...(cluster.symbolCounts ?? {}) }),
      minimumClusterSize: cluster.minimumClusterSize,
      adjacency: cluster.adjacency,
      wildCount: cluster.wildCount ?? 0,
      naturalCount: cluster.naturalCount ?? frozenCells.length,
      ...(cluster.baseMultiplier !== undefined
        ? { baseMultiplier: cluster.baseMultiplier }
        : {}),
      ...(cluster.totalPayout !== undefined
        ? { totalPayout: cluster.totalPayout }
        : {}),
      ...(cluster.payoutSymbolId !== undefined
        ? { payoutSymbolId: cluster.payoutSymbolId }
        : {}),
    });
  });

  const frozenWinningCells = Array.isArray(candidate.winningCells)
    ? candidate.winningCells.map((pos) =>
        Object.freeze({
          reelIndex: pos.reelIndex,
          rowIndex: pos.rowIndex,
        }),
      )
    : [];

  return Object.freeze({
    evaluationMode: "cluster",
    enabled: candidate.enabled,
    minimumClusterSize: candidate.minimumClusterSize,
    adjacency: candidate.adjacency as ClusterAdjacencyMode,
    clusters: Object.freeze(frozenClusters),
    qualifyingClusterCount: candidate.qualifyingClusterCount,
    totalClusterCells: candidate.totalClusterCells,
    uniqueWinningCellCount:
      candidate.uniqueWinningCellCount ?? frozenWinningCells.length,
    winningCells: Object.freeze(frozenWinningCells),
    ...(candidate.totalBaseMultiplier !== undefined
      ? { totalBaseMultiplier: candidate.totalBaseMultiplier }
      : {}),
    ...(candidate.totalPayout !== undefined
      ? { totalPayout: candidate.totalPayout }
      : {}),
  });
}

/* -------------------------------------------------------------------------- */
/* CLUSTER ENGINE CLASS & FACTORY                                             */
/* -------------------------------------------------------------------------- */

export interface ClusterEngineDefaults {
  readonly config?:
    | ClusterConfigInput
    | ClusterConfiguration
    | GameConfig
    | GameDefinition;
  readonly options?: ClusterEvaluationOptions;
}

export class DeterministicClusterEngine implements ClusterEngine {
  private readonly defaultConfig?:
    | ClusterConfigInput
    | ClusterConfiguration
    | GameConfig
    | GameDefinition;
  private readonly defaultOptions: ClusterEvaluationOptions;

  constructor(defaults: ClusterEngineDefaults = {}) {
    this.defaultConfig = defaults.config;
    this.defaultOptions = defaults.options ?? {};
  }

  public evaluate(
    board: Board,
    config?:
      | ClusterConfigInput
      | ClusterConfiguration
      | GameConfig
      | GameDefinition,
    options?: ClusterEvaluationOptions,
  ): ClusterEvaluationResult {
    const effectiveConfig = config ?? this.defaultConfig;
    const effectiveOptions: ClusterEvaluationOptions = {
      ...this.defaultOptions,
      ...options,
    };
    return evaluateClusters(board, effectiveConfig, effectiveOptions);
  }

  public evaluateClusters(
    board: Board,
    config?:
      | ClusterConfigInput
      | ClusterConfiguration
      | GameConfig
      | GameDefinition,
    options?: ClusterEvaluationOptions,
  ): ClusterEvaluationResult {
    return this.evaluate(board, config, options);
  }
}

export function createClusterEngine(
  defaults: ClusterEngineDefaults = {},
): ClusterEngine {
  return new DeterministicClusterEngine(defaults);
}
