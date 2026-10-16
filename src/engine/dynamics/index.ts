/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B13 — Board Dynamics Engine
 *
 * Pure, deterministic board-transformation subsystem implementing all 13
 * documented Slots Studio board-dynamics mechanics:
 *  1. Tumble / Cascade (remove winning non-locked cells, compact survivors,
 *     preserve attached cell state, refill from B04 strips or B03 weighted pool,
 *     and run cascade loops until no wins remain with safety cascade limit guard)
 *  2. Board Resize (grow/shrink rows top/bottom and reels left/right within
 *     configured bounds and per-session frequency limits)
 *  3. Held State Through Resize (locked/held symbols and attached prize values
 *     move with their cells on resize; newly inserted cells start empty & unlocked)
 *  4. Symbol Placement / Removal (inject symbols, clear symbols, expanding Wilds,
 *     and symbol upgrades without inventing payouts directly)
 *  5. Mystery Symbols (resolve before payment in board-wide sameSymbol mode or
 *     per-cell independent mode using B03 RandomSource weighted pools)
 *  6. Colossal Symbols (structured rectangular blocks with anchor, width, height,
 *     coveredCells, edge clipping, and instance identity preserved across board mutations)
 *  7. Locked Cells (central lock state with "round" or finite "spins" lifetimes,
 *     automatic expiration, and protection from tumble/sweep/removal/duplication)
 *  8. Reel Nudges (signed B04 strip-position offset with circular wrapping)
 *  9. Linked / Mirrored Reels (copy source reel visible symbols to target reels
 *     while retaining target reel identity and rejecting invalid cycles)
 * 10. Variable Reel Heights (shared or per-reel row-count ranges via B03 RandomSource,
 *     supporting ragged boards unambiguously)
 * 11. Symbol Duplication (duplicate landed symbols into consecutive reel cells
 *     respecting bounds, locks, and protected tags)
 * 12. Lane Sweeps (edge-entering row/reel sweepers with fireChance, sweepsCount,
 *     travelDistance, and protected tags/locks)
 * 13. Tagged Positions (random, onePerReel, or configured count with "spin" or
 *     "feature" lifetime, reusable by mystery/duplication/feature hooks)
 *
 * Zero Math.random() or Date.now() usage. Zero browser/DOM dependencies.
 * Zero duplicated win/paytable evaluation logic.
 */

import type { Board, Cell, Position, VisibleSymbol } from "../board";
import { positionKey } from "../board";
import type {
  NormalizedReelStop,
  NormalizedReelStrip,
  SymbolId,
} from "../config";
import {
  CascadeLimitExceededError,
  InvalidBoardError,
  InvalidColossalSymbolError,
  InvalidDuplicationOperationError,
  InvalidLaneSweepError,
  InvalidLinkedReelsError,
  InvalidLockOperationError,
  InvalidMysteryConfigurationError,
  InvalidReelNudgeError,
  InvalidResizeOperationError,
  InvalidTagOperationError,
  InvalidVariableHeightConfigurationError,
} from "../errors";
import { createBoardFromSymbolGrid } from "../paylines";
import type {
  RandomSource,
  RngStateSnapshot,
  WeightedItem,
} from "../rng";

/* -------------------------------------------------------------------------- */
/* CORE STATE & MODEL CONTRACTS                                               */
/* -------------------------------------------------------------------------- */

export interface BoardDimensions {
  readonly reelCount: number;
  readonly maxRowCount: number;
  readonly reelHeights: readonly number[];
}

export type LockLifetimeType = "round" | "spins";

export interface CellLockState {
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly locked: boolean;
  readonly lifetimeType: LockLifetimeType;
  readonly remainingSpins: number | null;
  readonly origin?: string;
}

export type TagLifetimeType = "spin" | "feature";

export interface CellTag {
  readonly tag: string;
  readonly lifetime: TagLifetimeType;
  readonly origin?: string;
}

export interface ColossalSymbolInstance {
  readonly instanceId: string;
  readonly symbolId: SymbolId;
  readonly anchor: Position;
  readonly width: number;
  readonly height: number;
  readonly coveredCells: readonly Position[];
  readonly clippedCells: readonly Position[];
  readonly isClipped: boolean;
  readonly locked: boolean;
  readonly attachedValue?: number;
}

export interface BoardState {
  readonly board: Board;
  readonly dimensions: BoardDimensions;
  readonly locksByCoord: Readonly<Record<string, CellLockState>>;
  readonly attachedValuesByCoord: Readonly<Record<string, number>>;
  readonly tagsByCoord: Readonly<Record<string, readonly CellTag[]>>;
  readonly colossalInstances: readonly ColossalSymbolInstance[];
  readonly reelStopIndexes: readonly number[];
  readonly resizeEventsUsedInSession: number;
}

export interface DynamicsRngUsage {
  readonly drawsConsumed: number;
  readonly snapshotBefore: RngStateSnapshot;
  readonly snapshotAfter: RngStateSnapshot;
}

/* -------------------------------------------------------------------------- */
/* OPERATION REQUEST & RESULT CONTRACTS                                       */
/* -------------------------------------------------------------------------- */

export interface MovedCellRecord {
  readonly from: Position;
  readonly to: Position;
  readonly symbolId: SymbolId;
  readonly attachedValue?: number;
}

export interface ChangedCellRecord {
  readonly position: Position;
  readonly previousSymbolId: SymbolId;
  readonly nextSymbolId: SymbolId;
  readonly attachedValue?: number;
}

export interface InsertedCellRecord {
  readonly position: Position;
  readonly symbolId: SymbolId;
}

export interface RemovedCellRecord {
  readonly position: Position;
  readonly symbolId: SymbolId;
  readonly attachedValue?: number;
}

export interface CascadeStepOptions {
  readonly reelStrips?:
    | readonly NormalizedReelStrip[]
    | readonly (readonly SymbolId[])[];
  readonly refillPool?: readonly WeightedItem<SymbolId>[] | readonly SymbolId[];
  readonly rng?: RandomSource;
  readonly reason?: string;
}

export interface CascadeResult {
  readonly operationType: "tumble";
  readonly beforeDimensions: BoardDimensions;
  readonly afterDimensions: BoardDimensions;
  readonly removedCells: readonly RemovedCellRecord[];
  readonly movedCells: readonly MovedCellRecord[];
  readonly insertedCells: readonly InsertedCellRecord[];
  readonly preservedLockedPositions: readonly Position[];
  readonly rngUsage: DynamicsRngUsage | null;
  readonly nextState: BoardState;
}

export interface CascadeLoopOptions extends CascadeStepOptions {
  readonly safetyMaxCascades?: number;
}

export interface CascadeLoopResult {
  readonly steps: readonly CascadeResult[];
  readonly cascadeCount: number;
  readonly settledBoard: Board;
  readonly finalState: BoardState;
}

export interface ResizeLimitsSpec {
  readonly minReels?: number;
  readonly maxReels?: number;
  readonly minRows?: number;
  readonly maxRows?: number;
  readonly maxResizeEventsPerSession?: number;
}

export interface ResizeRequest {
  readonly rowDelta?: number;
  readonly rowSide?: "top" | "bottom";
  readonly reelDelta?: number;
  readonly reelSide?: "left" | "right";
  readonly emptySymbolId?: SymbolId;
  readonly limits?: ResizeLimitsSpec;
  readonly throwOnConflict?: boolean;
  readonly reason?: string;
}

export interface ResizeResult {
  readonly operationType: "resize";
  readonly applied: boolean;
  readonly conflictReason:
    | "lockedCellConflict"
    | "dimensionLimitExceeded"
    | "sessionResizeLimitExceeded"
    | null;
  readonly beforeDimensions: BoardDimensions;
  readonly afterDimensions: BoardDimensions;
  readonly insertedCells: readonly InsertedCellRecord[];
  readonly removedCells: readonly RemovedCellRecord[];
  readonly movedCells: readonly MovedCellRecord[];
  readonly nextState: BoardState;
}

export interface MysteryResolutionRequest {
  readonly mysterySymbolIds: readonly SymbolId[];
  readonly mode: "sameSymbol" | "independent";
  readonly candidatePool:
    | readonly WeightedItem<SymbolId>[]
    | readonly SymbolId[];
  readonly targetTag?: string;
}

export interface MysteryResolvedCellRecord {
  readonly position: Position;
  readonly originalSymbolId: SymbolId;
  readonly resolvedSymbolId: SymbolId;
}

export interface MysteryResolutionResult {
  readonly operationType: "mysteryResolution";
  readonly mode: "sameSymbol" | "independent";
  readonly originalMysteryCells: readonly Position[];
  readonly resolvedCells: readonly MysteryResolvedCellRecord[];
  readonly rngUsage: DynamicsRngUsage | null;
  readonly nextState: BoardState;
}

export interface ColossalPlacementSpec {
  readonly instanceId: string;
  readonly symbolId: SymbolId;
  readonly anchor: Position;
  readonly width: number;
  readonly height: number;
  readonly locked?: boolean;
  readonly attachedValue?: number;
}

export interface SymbolPlacementItem {
  readonly position: Position;
  readonly symbolId: SymbolId;
  readonly attachedValue?: number;
  readonly respectLocks?: boolean;
}

export interface PlacementRequest {
  readonly placements?: readonly SymbolPlacementItem[];
  readonly colossal?: ColossalPlacementSpec;
  readonly upgradeFromSymbolId?: SymbolId;
  readonly upgradeToSymbolId?: SymbolId;
  readonly expandWildReelIndexes?: readonly number[];
  readonly wildSymbolId?: SymbolId;
  readonly targetTag?: string;
  readonly targetTagSymbolId?: SymbolId;
  readonly respectLocks?: boolean;
}

export interface PlacementResult {
  readonly operationType: "placeSymbols";
  readonly changedCells: readonly ChangedCellRecord[];
  readonly colossalPlaced: ColossalSymbolInstance | null;
  readonly nextState: BoardState;
}

export interface RemovalRequest {
  readonly positions?: readonly Position[];
  readonly symbolIds?: readonly SymbolId[];
  readonly targetTag?: string;
  readonly replacementSymbolId?: SymbolId;
  readonly respectLocks?: boolean;
}

export interface RemovalResult {
  readonly operationType: "removeCells";
  readonly removedCells: readonly RemovedCellRecord[];
  readonly protectedLockedPositions: readonly Position[];
  readonly nextState: BoardState;
}

export interface LockCellSpec {
  readonly position: Position;
  readonly lifetimeType: LockLifetimeType;
  readonly remainingSpins?: number;
  readonly attachedValue?: number;
  readonly origin?: string;
}

export interface LockOperationResult {
  readonly operationType: "locks";
  readonly lockedPositions: readonly Position[];
  readonly unlockedPositions: readonly Position[];
  readonly nextState: BoardState;
}

export interface ReelNudgeRequest {
  readonly reelIndex: number;
  readonly offsetSteps?: number;
  readonly direction?: "up" | "down";
  readonly steps?: number;
  readonly reelStrip: NormalizedReelStrip | readonly SymbolId[];
  readonly respectLocks?: boolean;
}

export interface NudgeResult {
  readonly operationType: "nudgeReel";
  readonly reelIndex: number;
  readonly signedOffset: number;
  readonly stopIndexBefore: number;
  readonly stopIndexAfter: number;
  readonly symbolIdsBefore: readonly SymbolId[];
  readonly symbolIdsAfter: readonly SymbolId[];
  readonly changedCells: readonly ChangedCellRecord[];
  readonly nextState: BoardState;
}

export interface LinkedReelSpec {
  readonly sourceReel: number;
  readonly targetReels: readonly number[];
  readonly mappingMode?: "identical" | "mirrored";
  readonly respectLocks?: boolean;
}

export interface LinkedReelResult {
  readonly operationType: "linkedReels";
  readonly linksApplied: readonly {
    readonly sourceReel: number;
    readonly targetReels: readonly number[];
    readonly mappingMode: "identical" | "mirrored";
  }[];
  readonly changedCells: readonly ChangedCellRecord[];
  readonly nextState: BoardState;
}

export interface VariableReelHeightSpec {
  readonly reelCount: number;
  readonly sharedRange?: {
    readonly minRows: number;
    readonly maxRows: number;
  };
  readonly perReelRanges?: readonly {
    readonly minRows: number;
    readonly maxRows: number;
  }[];
  readonly explicitReelHeights?: readonly number[];
  readonly reelStrips?:
    | readonly NormalizedReelStrip[]
    | readonly (readonly SymbolId[])[];
  readonly defaultSymbolId?: SymbolId;
}

export interface VariableReelHeightResult {
  readonly operationType: "variableReelHeights";
  readonly reelHeights: readonly number[];
  readonly rngUsage: DynamicsRngUsage | null;
  readonly nextState: BoardState;
}

export interface DuplicationRequest {
  readonly sourcePositions?: readonly Position[];
  readonly sourceSymbolId?: SymbolId;
  readonly targetTag?: string;
  readonly count: number;
  readonly direction?: "down" | "up" | "both";
  readonly respectLocks?: boolean;
  readonly protectedTags?: readonly string[];
}

export interface DuplicationResult {
  readonly operationType: "duplicateSymbols";
  readonly changedCells: readonly ChangedCellRecord[];
  readonly skippedProtectedPositions: readonly Position[];
  readonly nextState: BoardState;
}

export interface LaneSweepRequest {
  readonly entryEdge: "left" | "right" | "top" | "bottom";
  readonly targetIndex?: number;
  readonly targetIndexes?: readonly number[];
  readonly fireChance?: number;
  readonly sweepsCount?: number;
  readonly travelDistance?: number;
  readonly replacementSymbolId?: SymbolId;
  readonly protectedTags?: readonly string[];
  readonly respectLocks?: boolean;
}

export interface LaneSweepResult {
  readonly operationType: "laneSweep";
  readonly fired: boolean;
  readonly sweepsExecuted: number;
  readonly clearedCells: readonly RemovedCellRecord[];
  readonly changedCells: readonly ChangedCellRecord[];
  readonly protectedSkippedPositions: readonly Position[];
  readonly rngUsage: DynamicsRngUsage | null;
  readonly nextState: BoardState;
}

export interface TagPositionsRequest {
  readonly tag: string;
  readonly mode: "random" | "onePerReel" | "configured";
  readonly lifetime: TagLifetimeType;
  readonly count?: number;
  readonly positions?: readonly Position[];
  readonly origin?: string;
}

export interface TagOperationResult {
  readonly operationType: "tagPositions";
  readonly tag: string;
  readonly taggedPositions: readonly Position[];
  readonly rngUsage: DynamicsRngUsage | null;
  readonly nextState: BoardState;
}

/* -------------------------------------------------------------------------- */
/* INTERNAL BOARD REBUILDING HELPERS                                          */
/* -------------------------------------------------------------------------- */

function buildCell(
  reelIndex: number,
  rowIndex: number,
  symbolId: SymbolId,
  options: {
    readonly stopIndex?: number;
    readonly locked?: boolean;
    readonly multiplier?: number;
    readonly mysteryResolvedFrom?: SymbolId | null;
    readonly colossalGroupId?: string | null;
  } = {},
): Cell {
  const stopIndex = options.stopIndex ?? rowIndex;
  const position: Position = Object.freeze({ reelIndex, rowIndex });
  const upper = symbolId.toUpperCase();
  const visibleSymbol: VisibleSymbol = Object.freeze({
    symbolId,
    code: symbolId,
    name: symbolId,
    tier: "low",
    isWild: upper.includes("WILD") || symbolId === "W",
    isScatter: upper.includes("SCAT"),
    isBonus: upper.includes("BONUS"),
    wildMultiplier: 1,
    stopId: `reel-${reelIndex + 1}-stop-${stopIndex + 1}`,
    stripPosition: stopIndex + 1,
  });

  return Object.freeze({
    position,
    reelIndex,
    rowIndex,
    stopIndex,
    symbolId,
    symbol: visibleSymbol,
    locked: Boolean(options.locked),
    multiplier: options.multiplier ?? 1,
    mysteryResolvedFrom: options.mysteryResolvedFrom ?? null,
    colossalGroupId: options.colossalGroupId ?? null,
  });
}

function computeDimensions(board: Board): BoardDimensions {
  const reelCount = board.cells.length;
  const reelHeights = board.cells.map((col) => col.length);
  const maxRowCount = reelHeights.length > 0 ? Math.max(...reelHeights) : 0;
  return Object.freeze({
    reelCount,
    maxRowCount,
    reelHeights: Object.freeze(reelHeights),
  });
}

function recomputeColossalCoverage(
  instances: readonly ColossalSymbolInstance[],
  reelHeights: readonly number[],
  locksByCoord: Readonly<Record<string, CellLockState>>,
): readonly ColossalSymbolInstance[] {
  const reelCount = reelHeights.length;
  const updated: ColossalSymbolInstance[] = [];

  for (const inst of instances) {
    const covered: Position[] = [];
    const clipped: Position[] = [];
    let anyLocked = inst.locked;

    for (let dc = 0; dc < inst.width; dc++) {
      for (let dr = 0; dr < inst.height; dr++) {
        const c = inst.anchor.reelIndex + dc;
        const r = inst.anchor.rowIndex + dr;
        const pos = Object.freeze({ reelIndex: c, rowIndex: r });
        if (c >= 0 && c < reelCount && r >= 0 && r < (reelHeights[c] ?? 0)) {
          covered.push(pos);
          if (locksByCoord[`${c}:${r}`]?.locked) {
            anyLocked = true;
          }
        } else {
          clipped.push(pos);
        }
      }
    }

    if (covered.length > 0) {
      updated.push(
        Object.freeze({
          ...inst,
          coveredCells: Object.freeze(covered),
          clippedCells: Object.freeze(clipped),
          isClipped: clipped.length > 0,
          locked: anyLocked,
        }),
      );
    }
  }

  return Object.freeze(updated);
}

function rebuildBoardWithMetadata(
  columnsCells: readonly (readonly Cell[])[],
  locksByCoord: Readonly<Record<string, CellLockState>>,
  colossalInstances: readonly ColossalSymbolInstance[],
): Board {
  const colossalGroupByCoord = new Map<string, string>();
  for (const inst of colossalInstances) {
    for (const pos of inst.coveredCells) {
      colossalGroupByCoord.set(positionKey(pos), inst.instanceId);
    }
  }

  const reelHeights: number[] = [];
  const finalCols: (readonly Cell[])[] = [];

  for (let c = 0; c < columnsCells.length; c++) {
    const col = columnsCells[c]!;
    reelHeights.push(col.length);
    const rebuiltCol: Cell[] = [];

    for (let r = 0; r < col.length; r++) {
      const cell = col[r]!;
      const key = `${c}:${r}`;
      const isLocked = Boolean(locksByCoord[key]?.locked);
      const colossalGroupId =
        colossalGroupByCoord.get(key) ?? cell.colossalGroupId ?? null;

      rebuiltCol.push(
        buildCell(c, r, cell.symbolId, {
          stopIndex: cell.stopIndex,
          locked: isLocked,
          multiplier: cell.multiplier,
          mysteryResolvedFrom: cell.mysteryResolvedFrom,
          colossalGroupId,
        }),
      );
    }

    finalCols.push(Object.freeze(rebuiltCol));
  }

  const maxRows = reelHeights.length > 0 ? Math.max(...reelHeights) : 0;
  return Object.freeze({
    reelCount: finalCols.length,
    rowCount: maxRows,
    columns: finalCols.length,
    rows: maxRows,
    reelHeights: Object.freeze(reelHeights),
    cells: Object.freeze(finalCols),
  });
}

function normalizeCandidatePool(
  pool: readonly WeightedItem<SymbolId>[] | readonly SymbolId[],
): readonly WeightedItem<SymbolId>[] {
  if (!Array.isArray(pool) || pool.length === 0) {
    throw new InvalidMysteryConfigurationError(
      "Candidate symbol pool must be a non-empty array.",
      { pool },
    );
  }
  const first = pool[0];
  if (typeof first === "string") {
    return (pool as readonly SymbolId[]).map((sym) => ({
      value: sym,
      weight: 1,
    }));
  }
  return pool as readonly WeightedItem<SymbolId>[];
}

function extractStripSymbols(
  strip: NormalizedReelStrip | readonly SymbolId[],
): readonly SymbolId[] {
  if (Array.isArray(strip)) {
    return strip;
  }
  return (strip as NormalizedReelStrip).stops.map(
    (s: NormalizedReelStop) => s.symbolId,
  );
}

/* -------------------------------------------------------------------------- */
/* DETERMINISTIC BOARD DYNAMICS ENGINE                                        */
/* -------------------------------------------------------------------------- */

export class DeterministicBoardDynamicsEngine {
  /**
   * Creates an immutable BoardState from an authoritative B04 Board.
   */
  public createBoardState(
    board: Board,
    options: {
      readonly locksByCoord?: Readonly<Record<string, CellLockState>>;
      readonly attachedValuesByCoord?: Readonly<Record<string, number>>;
      readonly tagsByCoord?: Readonly<Record<string, readonly CellTag[]>>;
      readonly colossalInstances?: readonly ColossalSymbolInstance[];
      readonly reelStopIndexes?: readonly number[];
      readonly resizeEventsUsedInSession?: number;
    } = {},
  ): BoardState {
    if (!board || typeof board !== "object" || !Array.isArray(board.cells)) {
      throw new InvalidBoardError(
        "createBoardState requires a valid B04 Board with cells.",
        { board },
      );
    }

    const locks: Record<string, CellLockState> = {
      ...(options.locksByCoord ?? {}),
    };
    const values: Record<string, number> = {
      ...(options.attachedValuesByCoord ?? {}),
    };
    const tags: Record<string, readonly CellTag[]> = {};
    if (options.tagsByCoord) {
      for (const [k, list] of Object.entries(options.tagsByCoord)) {
        tags[k] = Object.freeze(list.map((t) => Object.freeze({ ...t })));
      }
    }

    const reelHeights = board.cells.map((col) => col.length);
    const colossal = recomputeColossalCoverage(
      options.colossalInstances ?? [],
      reelHeights,
      locks,
    );

    const rebuiltBoard = rebuildBoardWithMetadata(board.cells, locks, colossal);
    const dimensions = computeDimensions(rebuiltBoard);
    const stopIndexes =
      options.reelStopIndexes ??
      rebuiltBoard.cells.map((col) => col[0]?.stopIndex ?? 0);

    return Object.freeze({
      board: rebuiltBoard,
      dimensions,
      locksByCoord: Object.freeze(locks),
      attachedValuesByCoord: Object.freeze(values),
      tagsByCoord: Object.freeze(tags),
      colossalInstances: colossal,
      reelStopIndexes: Object.freeze([...stopIndexes]),
      resizeEventsUsedInSession: options.resizeEventsUsedInSession ?? 0,
    });
  }

  /**
   * 5. MYSTERY SYMBOLS
   * Resolves mystery cells into real symbols before payment/evaluation.
   * Supports board-wide "sameSymbol" mode and per-cell "independent" mode
   * using a weighted symbol pool through B03 RandomSource.
   */
  public resolveMysteries(
    state: BoardState,
    request: MysteryResolutionRequest,
    rng: RandomSource,
  ): MysteryResolutionResult {
    if (!rng) {
      throw new InvalidMysteryConfigurationError(
        "resolveMysteries requires a B03 RandomSource.",
      );
    }
    if (
      !Array.isArray(request.mysterySymbolIds) ||
      request.mysterySymbolIds.length === 0
    ) {
      throw new InvalidMysteryConfigurationError(
        "resolveMysteries requires a non-empty mysterySymbolIds array.",
        { mysterySymbolIds: request.mysterySymbolIds },
      );
    }

    const weightedPool = normalizeCandidatePool(request.candidatePool);
    const mysterySet = new Set<string>(request.mysterySymbolIds);
    const originalMysteryCells: Position[] = [];
    const resolvedCells: MysteryResolvedCellRecord[] = [];

    // Locate all target mystery cells on the board
    for (let c = 0; c < state.board.cells.length; c++) {
      const col = state.board.cells[c]!;
      for (let r = 0; r < col.length; r++) {
        const cell = col[r]!;
        const key = `${c}:${r}`;
        const hasTargetTag = request.targetTag
          ? (state.tagsByCoord[key] ?? []).some(
              (t) => t.tag === request.targetTag,
            )
          : false;

        if (mysterySet.has(cell.symbolId) || hasTargetTag) {
          originalMysteryCells.push(
            Object.freeze({ reelIndex: c, rowIndex: r }),
          );
        }
      }
    }

    if (originalMysteryCells.length === 0) {
      return Object.freeze({
        operationType: "mysteryResolution",
        mode: request.mode,
        originalMysteryCells: Object.freeze([]),
        resolvedCells: Object.freeze([]),
        rngUsage: null,
        nextState: state,
      });
    }

    const snapshotBefore = rng.snapshot();
    const drawsBefore = rng.getDrawCount();

    const resolvedByCoord = new Map<string, SymbolId>();
    if (request.mode === "sameSymbol") {
      const sharedSymbol = rng.weightedPick(weightedPool);
      for (const pos of originalMysteryCells) {
        resolvedByCoord.set(positionKey(pos), sharedSymbol);
      }
    } else {
      for (const pos of originalMysteryCells) {
        const pickedSymbol = rng.weightedPick(weightedPool);
        resolvedByCoord.set(positionKey(pos), pickedSymbol);
      }
    }

    const snapshotAfter = rng.snapshot();
    const drawsAfter = rng.getDrawCount();

    const newColumns: Cell[][] = [];
    for (let c = 0; c < state.board.cells.length; c++) {
      const col = state.board.cells[c]!;
      const nextCol: Cell[] = [];
      for (let r = 0; r < col.length; r++) {
        const cell = col[r]!;
        const key = `${c}:${r}`;
        const replacement = resolvedByCoord.get(key);
        if (replacement !== undefined) {
          resolvedCells.push(
            Object.freeze({
              position: Object.freeze({ reelIndex: c, rowIndex: r }),
              originalSymbolId: cell.symbolId,
              resolvedSymbolId: replacement,
            }),
          );
          nextCol.push(
            buildCell(c, r, replacement, {
              stopIndex: cell.stopIndex,
              locked: cell.locked,
              multiplier: cell.multiplier,
              mysteryResolvedFrom: cell.symbolId,
              colossalGroupId: cell.colossalGroupId,
            }),
          );
        } else {
          nextCol.push(cell);
        }
      }
      newColumns.push(nextCol);
    }

    const nextBoard = rebuildBoardWithMetadata(
      newColumns,
      state.locksByCoord,
      state.colossalInstances,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
    });

    return Object.freeze({
      operationType: "mysteryResolution",
      mode: request.mode,
      originalMysteryCells: Object.freeze(originalMysteryCells),
      resolvedCells: Object.freeze(resolvedCells),
      rngUsage: Object.freeze({
        drawsConsumed: drawsAfter - drawsBefore,
        snapshotBefore,
        snapshotAfter,
      }),
      nextState,
    });
  }

  /**
   * 7. LOCKED CELLS
   * Applies round-scoped or finite-spin locks (and optional attached values) to board positions.
   */
  public applyLocks(
    state: BoardState,
    locks: readonly LockCellSpec[],
  ): LockOperationResult {
    if (!Array.isArray(locks)) {
      throw new InvalidLockOperationError("applyLocks requires a locks array.");
    }

    const nextLocks: Record<string, CellLockState> = { ...state.locksByCoord };
    const nextValues: Record<string, number> = {
      ...state.attachedValuesByCoord,
    };
    const lockedPositions: Position[] = [];

    for (const spec of locks) {
      const { reelIndex, rowIndex } = spec.position;
      const col = state.board.cells[reelIndex];
      if (!col || rowIndex < 0 || rowIndex >= col.length) {
        throw new InvalidLockOperationError(
          `Cannot lock out-of-bounds position (${reelIndex}, ${rowIndex}).`,
          { position: spec.position },
        );
      }
      if (
        spec.lifetimeType === "spins" &&
        (typeof spec.remainingSpins !== "number" ||
          !Number.isInteger(spec.remainingSpins) ||
          spec.remainingSpins < 1)
      ) {
        throw new InvalidLockOperationError(
          `Lock at (${reelIndex}, ${rowIndex}) with lifetimeType "spins" must have remainingSpins >= 1.`,
          { spec },
        );
      }

      const key = `${reelIndex}:${rowIndex}`;
      nextLocks[key] = Object.freeze({
        reelIndex,
        rowIndex,
        locked: true,
        lifetimeType: spec.lifetimeType,
        remainingSpins:
          spec.lifetimeType === "spins" ? spec.remainingSpins! : null,
        ...(spec.origin !== undefined ? { origin: spec.origin } : {}),
      });

      if (spec.attachedValue !== undefined) {
        nextValues[key] = spec.attachedValue;
      }

      lockedPositions.push(Object.freeze({ reelIndex, rowIndex }));
    }

    const nextColossal = recomputeColossalCoverage(
      state.colossalInstances,
      state.dimensions.reelHeights,
      nextLocks,
    );
    const nextBoard = rebuildBoardWithMetadata(
      state.board.cells,
      nextLocks,
      nextColossal,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      locksByCoord: Object.freeze(nextLocks),
      attachedValuesByCoord: Object.freeze(nextValues),
      colossalInstances: nextColossal,
    });

    return Object.freeze({
      operationType: "locks",
      lockedPositions: Object.freeze(lockedPositions),
      unlockedPositions: Object.freeze([]),
      nextState,
    });
  }

  /**
   * Decrements finite-spin lock lifetimes at the spin boundary or releases round locks at round exit.
   */
  public expireLocks(
    state: BoardState,
    boundary: "spin" | "round",
  ): LockOperationResult {
    const nextLocks: Record<string, CellLockState> = {};
    const unlockedPositions: Position[] = [];
    const remainingLockedPositions: Position[] = [];

    for (const [key, lock] of Object.entries(state.locksByCoord)) {
      if (!lock.locked) continue;

      if (boundary === "round") {
        if (lock.lifetimeType === "round") {
          unlockedPositions.push(
            Object.freeze({
              reelIndex: lock.reelIndex,
              rowIndex: lock.rowIndex,
            }),
          );
          continue;
        }
        nextLocks[key] = lock;
        remainingLockedPositions.push(
          Object.freeze({
            reelIndex: lock.reelIndex,
            rowIndex: lock.rowIndex,
          }),
        );
      } else {
        // boundary === "spin"
        if (lock.lifetimeType === "spins" && lock.remainingSpins !== null) {
          const nextRemaining = lock.remainingSpins - 1;
          if (nextRemaining <= 0) {
            unlockedPositions.push(
              Object.freeze({
                reelIndex: lock.reelIndex,
                rowIndex: lock.rowIndex,
              }),
            );
            continue;
          }
          nextLocks[key] = Object.freeze({
            ...lock,
            remainingSpins: nextRemaining,
          });
          remainingLockedPositions.push(
            Object.freeze({
              reelIndex: lock.reelIndex,
              rowIndex: lock.rowIndex,
            }),
          );
        } else {
          nextLocks[key] = lock;
          remainingLockedPositions.push(
            Object.freeze({
              reelIndex: lock.reelIndex,
              rowIndex: lock.rowIndex,
            }),
          );
        }
      }
    }

    const nextColossal = recomputeColossalCoverage(
      state.colossalInstances,
      state.dimensions.reelHeights,
      nextLocks,
    );
    const nextBoard = rebuildBoardWithMetadata(
      state.board.cells,
      nextLocks,
      nextColossal,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      locksByCoord: Object.freeze(nextLocks),
      colossalInstances: nextColossal,
    });

    return Object.freeze({
      operationType: "locks",
      lockedPositions: Object.freeze(remainingLockedPositions),
      unlockedPositions: Object.freeze(unlockedPositions),
      nextState,
    });
  }

  /**
   * 4 & 6. SYMBOL PLACEMENT & COLOSSAL SYMBOLS
   * Injects symbols, upgrades symbols, expands Wilds, or places a Colossal Symbol block
   * (with edge clipping and structured instance tracking) without inventing payouts directly.
   */
  public placeSymbols(
    state: BoardState,
    request: PlacementRequest,
  ): PlacementResult {
    const respectLocks = request.respectLocks ?? true;
    const newColumns: Cell[][] = state.board.cells.map((col) => [...col]);
    const nextValues: Record<string, number> = {
      ...state.attachedValuesByCoord,
    };
    const nextLocks: Record<string, CellLockState> = { ...state.locksByCoord };
    const changedCells: ChangedCellRecord[] = [];
    let colossalPlaced: ColossalSymbolInstance | null = null;
    const nextColossalList: ColossalSymbolInstance[] = [
      ...state.colossalInstances,
    ];

    const setCellSymbol = (
      c: number,
      r: number,
      symbolId: SymbolId,
      attachedValue?: number,
      colossalGroupId?: string | null,
    ) => {
      const col = newColumns[c];
      if (!col || r < 0 || r >= col.length) return;
      const key = `${c}:${r}`;
      if (respectLocks && nextLocks[key]?.locked) {
        return;
      }
      const prev = col[r]!;
      col[r] = buildCell(c, r, symbolId, {
        stopIndex: prev.stopIndex,
        locked: Boolean(nextLocks[key]?.locked),
        multiplier: prev.multiplier,
        mysteryResolvedFrom: prev.mysteryResolvedFrom,
        colossalGroupId: colossalGroupId ?? prev.colossalGroupId,
      });
      if (attachedValue !== undefined) {
        nextValues[key] = attachedValue;
      }
      changedCells.push(
        Object.freeze({
          position: Object.freeze({ reelIndex: c, rowIndex: r }),
          previousSymbolId: prev.symbolId,
          nextSymbolId: symbolId,
          ...(attachedValue !== undefined ? { attachedValue } : {}),
        }),
      );
    };

    // 1. Explicit cell placements
    if (request.placements) {
      for (const item of request.placements) {
        setCellSymbol(
          item.position.reelIndex,
          item.position.rowIndex,
          item.symbolId,
          item.attachedValue,
        );
      }
    }

    // 2. Symbol upgrade across board
    if (request.upgradeFromSymbolId && request.upgradeToSymbolId) {
      for (let c = 0; c < newColumns.length; c++) {
        const col = newColumns[c]!;
        for (let r = 0; r < col.length; r++) {
          if (col[r]!.symbolId === request.upgradeFromSymbolId) {
            setCellSymbol(c, r, request.upgradeToSymbolId);
          }
        }
      }
    }

    // 3. Expanding Wilds on specified reels
    if (request.expandWildReelIndexes && request.wildSymbolId) {
      for (const c of request.expandWildReelIndexes) {
        const col = newColumns[c];
        if (!col) continue;
        for (let r = 0; r < col.length; r++) {
          setCellSymbol(c, r, request.wildSymbolId);
        }
      }
    }

    // 4. Placement on tagged positions
    if (request.targetTag && request.targetTagSymbolId) {
      for (const [key, tagList] of Object.entries(state.tagsByCoord)) {
        if (tagList.some((t) => t.tag === request.targetTag)) {
          const [cStr, rStr] = key.split(":");
          setCellSymbol(Number(cStr), Number(rStr), request.targetTagSymbolId);
        }
      }
    }

    // 5. Colossal Symbol placement (with edge clipping & structured instance tracking)
    if (request.colossal) {
      const colSpec = request.colossal;
      if (
        !colSpec.instanceId ||
        colSpec.width < 1 ||
        colSpec.height < 1 ||
        !Number.isInteger(colSpec.width) ||
        !Number.isInteger(colSpec.height)
      ) {
        throw new InvalidColossalSymbolError(
          "ColossalPlacementSpec must have a non-empty instanceId and integer width, height >= 1.",
          { colossal: colSpec },
        );
      }

      const covered: Position[] = [];
      const clipped: Position[] = [];

      for (let dc = 0; dc < colSpec.width; dc++) {
        for (let dr = 0; dr < colSpec.height; dr++) {
          const c = colSpec.anchor.reelIndex + dc;
          const r = colSpec.anchor.rowIndex + dr;
          const pos = Object.freeze({ reelIndex: c, rowIndex: r });
          if (
            c >= 0 &&
            c < newColumns.length &&
            r >= 0 &&
            r < (newColumns[c]?.length ?? 0)
          ) {
            covered.push(pos);
            setCellSymbol(
              c,
              r,
              colSpec.symbolId,
              colSpec.attachedValue,
              colSpec.instanceId,
            );
            if (colSpec.locked) {
              nextLocks[`${c}:${r}`] = Object.freeze({
                reelIndex: c,
                rowIndex: r,
                locked: true,
                lifetimeType: "round",
                remainingSpins: null,
                origin: `colossal:${colSpec.instanceId}`,
              });
            }
          } else {
            clipped.push(pos);
          }
        }
      }

      if (covered.length === 0) {
        throw new InvalidColossalSymbolError(
          `Colossal symbol "${colSpec.instanceId}" at anchor (${colSpec.anchor.reelIndex}, ${colSpec.anchor.rowIndex}) falls completely outside the board.`,
          { colossal: colSpec },
        );
      }

      colossalPlaced = Object.freeze({
        instanceId: colSpec.instanceId,
        symbolId: colSpec.symbolId,
        anchor: Object.freeze({ ...colSpec.anchor }),
        width: colSpec.width,
        height: colSpec.height,
        coveredCells: Object.freeze(covered),
        clippedCells: Object.freeze(clipped),
        isClipped: clipped.length > 0,
        locked: Boolean(colSpec.locked),
        ...(colSpec.attachedValue !== undefined
          ? { attachedValue: colSpec.attachedValue }
          : {}),
      });

      const filteredExisting = nextColossalList.filter(
        (i) => i.instanceId !== colSpec.instanceId,
      );
      filteredExisting.push(colossalPlaced);
      nextColossalList.length = 0;
      nextColossalList.push(...filteredExisting);
    }

    const reelHeights = newColumns.map((col) => col.length);
    const updatedColossal = recomputeColossalCoverage(
      nextColossalList,
      reelHeights,
      nextLocks,
    );
    const nextBoard = rebuildBoardWithMetadata(
      newColumns,
      nextLocks,
      updatedColossal,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      locksByCoord: Object.freeze(nextLocks),
      attachedValuesByCoord: Object.freeze(nextValues),
      colossalInstances: updatedColossal,
    });

    return Object.freeze({
      operationType: "placeSymbols",
      changedCells: Object.freeze(changedCells),
      colossalPlaced,
      nextState,
    });
  }

  /**
   * 4. SYMBOL REMOVAL
   * Removes/clears symbols from chosen positions while respecting locked cells.
   */
  public removeCells(
    state: BoardState,
    request: RemovalRequest,
  ): RemovalResult {
    const respectLocks = request.respectLocks ?? true;
    const replacementSymbolId = request.replacementSymbolId ?? "EMPTY";
    const targetCoords = new Set<string>();

    if (request.positions) {
      for (const pos of request.positions) {
        targetCoords.add(positionKey(pos));
      }
    }
    if (request.symbolIds) {
      const symSet = new Set<string>(request.symbolIds);
      for (let c = 0; c < state.board.cells.length; c++) {
        const col = state.board.cells[c]!;
        for (let r = 0; r < col.length; r++) {
          if (symSet.has(col[r]!.symbolId)) {
            targetCoords.add(`${c}:${r}`);
          }
        }
      }
    }
    if (request.targetTag) {
      for (const [key, tagList] of Object.entries(state.tagsByCoord)) {
        if (tagList.some((t) => t.tag === request.targetTag)) {
          targetCoords.add(key);
        }
      }
    }

    const removedCells: RemovedCellRecord[] = [];
    const protectedLockedPositions: Position[] = [];
    const newColumns: Cell[][] = state.board.cells.map((col) => [...col]);
    const nextValues: Record<string, number> = {
      ...state.attachedValuesByCoord,
    };

    for (const key of targetCoords) {
      const [cStr, rStr] = key.split(":");
      const c = Number(cStr);
      const r = Number(rStr);
      const col = newColumns[c];
      if (!col || r < 0 || r >= col.length) continue;

      if (respectLocks && state.locksByCoord[key]?.locked) {
        protectedLockedPositions.push(
          Object.freeze({ reelIndex: c, rowIndex: r }),
        );
        continue;
      }

      const prev = col[r]!;
      const attachedValue = nextValues[key];
      delete nextValues[key];

      removedCells.push(
        Object.freeze({
          position: Object.freeze({ reelIndex: c, rowIndex: r }),
          symbolId: prev.symbolId,
          ...(attachedValue !== undefined ? { attachedValue } : {}),
        }),
      );

      col[r] = buildCell(c, r, replacementSymbolId, {
        stopIndex: prev.stopIndex,
        locked: false,
      });
    }

    const updatedColossal = recomputeColossalCoverage(
      state.colossalInstances.filter((inst) =>
        inst.coveredCells.some(
          (pos) => !removedCells.some(
            (rem) =>
              rem.position.reelIndex === pos.reelIndex &&
              rem.position.rowIndex === pos.rowIndex,
          ),
        ),
      ),
      state.dimensions.reelHeights,
      state.locksByCoord,
    );

    const nextBoard = rebuildBoardWithMetadata(
      newColumns,
      state.locksByCoord,
      updatedColossal,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      attachedValuesByCoord: Object.freeze(nextValues),
      colossalInstances: updatedColossal,
    });

    return Object.freeze({
      operationType: "removeCells",
      removedCells: Object.freeze(removedCells),
      protectedLockedPositions: Object.freeze(protectedLockedPositions),
      nextState,
    });
  }

  /**
   * 1. TUMBLE / CASCADE
   * Deterministic single-step tumble pipeline:
   * - Excludes locked cells from removal
   * - Removes winning eligible cells provided by existing win engines
   * - Compacts surviving non-locked symbols downward into empty gaps per column
   * - Preserves cell-associated attachedValue and tags as survivors fall
   * - Refills newly empty top cells from B04 reel strips or B03 RandomSource weighted pool
   */
  public applyTumble(
    state: BoardState,
    winningPositions: readonly Position[],
    options: CascadeStepOptions = {},
  ): CascadeResult {
    const removalCoordSet = new Set<string>(
      winningPositions.map((p) => positionKey(p)),
    );

    const removedCells: RemovedCellRecord[] = [];
    const movedCells: MovedCellRecord[] = [];
    const insertedCells: InsertedCellRecord[] = [];
    const preservedLockedPositions: Position[] = [];

    const nextValues: Record<string, number> = {};
    const nextTags: Record<string, readonly CellTag[]> = {};
    const nextStopIndexes = [...state.reelStopIndexes];

    const snapshotBefore = options.rng ? options.rng.snapshot() : null;
    const drawsBefore = options.rng ? options.rng.getDrawCount() : 0;

    const weightedRefillPool = options.refillPool
      ? normalizeCandidatePool(options.refillPool)
      : null;

    const newColumns: Cell[][] = [];

    for (let c = 0; c < state.board.cells.length; c++) {
      const col = state.board.cells[c]!;
      const colHeight = col.length;
      const nextCol: (Cell | null)[] = new Array<Cell | null>(colHeight).fill(
        null,
      );

      // 1. Place locked cells at their fixed positions and collect surviving unlocked cells
      const survivors: {
        originalRow: number;
        cell: Cell;
        attachedValue?: number;
        tags?: readonly CellTag[];
      }[] = [];

      for (let r = 0; r < colHeight; r++) {
        const cell = col[r]!;
        const key = `${c}:${r}`;
        const isLocked = Boolean(state.locksByCoord[key]?.locked);

        if (isLocked) {
          preservedLockedPositions.push(
            Object.freeze({ reelIndex: c, rowIndex: r }),
          );
          nextCol[r] = cell;
          if (state.attachedValuesByCoord[key] !== undefined) {
            nextValues[key] = state.attachedValuesByCoord[key]!;
          }
          if (state.tagsByCoord[key]) {
            nextTags[key] = state.tagsByCoord[key]!;
          }
          continue;
        }

        if (removalCoordSet.has(key)) {
          removedCells.push(
            Object.freeze({
              position: Object.freeze({ reelIndex: c, rowIndex: r }),
              symbolId: cell.symbolId,
              ...(state.attachedValuesByCoord[key] !== undefined
                ? { attachedValue: state.attachedValuesByCoord[key] }
                : {}),
            }),
          );
          continue;
        }

        survivors.push({
          originalRow: r,
          cell,
          attachedValue: state.attachedValuesByCoord[key],
          tags: state.tagsByCoord[key],
        });
      }

      // 2. Compact survivors downward into available unlocked slots from bottom (colHeight - 1) to top (0)
      let survivorIdx = survivors.length - 1;
      for (let targetRow = colHeight - 1; targetRow >= 0; targetRow--) {
        if (nextCol[targetRow] !== null) {
          // Occupied by a locked cell
          continue;
        }
        if (survivorIdx >= 0) {
          const surv = survivors[survivorIdx]!;
          survivorIdx--;
          const targetKey = `${c}:${targetRow}`;
          nextCol[targetRow] = buildCell(c, targetRow, surv.cell.symbolId, {
            stopIndex: surv.cell.stopIndex,
            locked: false,
            multiplier: surv.cell.multiplier,
            mysteryResolvedFrom: surv.cell.mysteryResolvedFrom,
            colossalGroupId: surv.cell.colossalGroupId,
          });
          if (surv.attachedValue !== undefined) {
            nextValues[targetKey] = surv.attachedValue;
          }
          if (surv.tags) {
            nextTags[targetKey] = surv.tags;
          }
          if (surv.originalRow !== targetRow) {
            movedCells.push(
              Object.freeze({
                from: Object.freeze({
                  reelIndex: c,
                  rowIndex: surv.originalRow,
                }),
                to: Object.freeze({ reelIndex: c, rowIndex: targetRow }),
                symbolId: surv.cell.symbolId,
                ...(surv.attachedValue !== undefined
                  ? { attachedValue: surv.attachedValue }
                  : {}),
              }),
            );
          }
        }
      }

      // 3. Refill remaining empty top slots (from bottommost empty slot upward)
      const stripRaw = options.reelStrips?.[c];
      const stripSymbols = stripRaw ? extractStripSymbols(stripRaw) : null;
      let currentTopStop = nextStopIndexes[c] ?? 0;

      for (let targetRow = colHeight - 1; targetRow >= 0; targetRow--) {
        if (nextCol[targetRow] !== null) continue;

        let newSymbolId: SymbolId = "A";
        let newStopIndex = targetRow;

        if (stripSymbols && stripSymbols.length > 0) {
          currentTopStop =
            ((currentTopStop - 1) % stripSymbols.length +
              stripSymbols.length) %
            stripSymbols.length;
          newSymbolId = stripSymbols[currentTopStop]!;
          newStopIndex = currentTopStop;
        } else if (weightedRefillPool && options.rng) {
          newSymbolId = options.rng.weightedPick(weightedRefillPool);
        } else if (weightedRefillPool && weightedRefillPool.length > 0) {
          newSymbolId = weightedRefillPool[0]!.value;
        }

        nextCol[targetRow] = buildCell(c, targetRow, newSymbolId, {
          stopIndex: newStopIndex,
          locked: false,
        });
        insertedCells.push(
          Object.freeze({
            position: Object.freeze({ reelIndex: c, rowIndex: targetRow }),
            symbolId: newSymbolId,
          }),
        );
      }

      nextStopIndexes[c] = currentTopStop;
      newColumns.push(nextCol.map((cell) => cell!));
    }

    const snapshotAfter = options.rng ? options.rng.snapshot() : null;
    const drawsAfter = options.rng ? options.rng.getDrawCount() : 0;

    // Update colossal instances that moved or survived
    const updatedColossal = recomputeColossalCoverage(
      state.colossalInstances,
      state.dimensions.reelHeights,
      state.locksByCoord,
    );

    const nextBoard = rebuildBoardWithMetadata(
      newColumns,
      state.locksByCoord,
      updatedColossal,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      attachedValuesByCoord: Object.freeze(nextValues),
      tagsByCoord: Object.freeze(nextTags),
      colossalInstances: updatedColossal,
      reelStopIndexes: Object.freeze(nextStopIndexes),
    });

    return Object.freeze({
      operationType: "tumble",
      beforeDimensions: state.dimensions,
      afterDimensions: nextState.dimensions,
      removedCells: Object.freeze(removedCells),
      movedCells: Object.freeze(movedCells),
      insertedCells: Object.freeze(insertedCells),
      preservedLockedPositions: Object.freeze(preservedLockedPositions),
      rngUsage:
        snapshotBefore && snapshotAfter
          ? Object.freeze({
              drawsConsumed: drawsAfter - drawsBefore,
              snapshotBefore,
              snapshotAfter,
            })
          : null,
      nextState,
    });
  }

  /**
   * Runs a full tumble/cascade loop using an external win-position evaluator
   * until no removable winning positions remain, guarded by safetyMaxCascades.
   */
  public runCascadeLoop(
    initialState: BoardState,
    evaluateWinningPositions: (board: Board) => readonly Position[],
    options: CascadeLoopOptions = {},
  ): CascadeLoopResult {
    const safetyMax = options.safetyMaxCascades ?? 100;
    if (
      typeof safetyMax !== "number" ||
      !Number.isInteger(safetyMax) ||
      safetyMax < 1
    ) {
      throw new CascadeLimitExceededError(
        `safetyMaxCascades must be an integer >= 1, received ${String(safetyMax)}.`,
        { safetyMaxCascades: safetyMax },
      );
    }

    const steps: CascadeResult[] = [];
    let currentState = initialState;

    for (let stepIdx = 0; stepIdx <= safetyMax; stepIdx++) {
      const winPositions = evaluateWinningPositions(currentState.board);
      // Filter out locked cells since locked cells cannot be removed by tumble
      const removable = winPositions.filter(
        (p) => !currentState.locksByCoord[positionKey(p)]?.locked,
      );
      if (removable.length === 0) {
        return Object.freeze({
          steps: Object.freeze(steps),
          cascadeCount: steps.length,
          settledBoard: currentState.board,
          finalState: currentState,
        });
      }

      if (stepIdx === safetyMax) {
        throw new CascadeLimitExceededError(
          `Cascade loop exceeded safetyMaxCascades (${safetyMax}) without settling.`,
          { safetyMaxCascades: safetyMax, cascadeCount: steps.length },
        );
      }

      const stepRes = this.applyTumble(currentState, removable, options);
      steps.push(stepRes);
      currentState = stepRes.nextState;
    }

    return Object.freeze({
      steps: Object.freeze(steps),
      cascadeCount: steps.length,
      settledBoard: currentState.board,
      finalState: currentState,
    });
  }

  /**
   * 2 & 3. BOARD RESIZE & HELD STATE THROUGH RESIZE
   * Grows or shrinks rows (top/bottom) and reels (left/right), preserving
   * held/locked symbols and their attached prize values as coordinates shift,
   * leaving newly inserted cells empty and unlocked, and rejecting shrink
   * operations that conflict with locked cells or configured limits.
   */
  public resizeBoard(
    state: BoardState,
    request: ResizeRequest,
  ): ResizeResult {
    const rowDelta = request.rowDelta ?? 0;
    const rowSide = request.rowSide ?? "top";
    const reelDelta = request.reelDelta ?? 0;
    const reelSide = request.reelSide ?? "right";
    const emptySymbolId = request.emptySymbolId ?? "EMPTY";
    const throwOnConflict = request.throwOnConflict ?? false;

    const limits = request.limits;
    if (
      limits?.maxResizeEventsPerSession !== undefined &&
      state.resizeEventsUsedInSession >= limits.maxResizeEventsPerSession
    ) {
      if (throwOnConflict) {
        throw new InvalidResizeOperationError(
          `Maximum resize events per session (${limits.maxResizeEventsPerSession}) reached.`,
          {
            resizeEventsUsedInSession: state.resizeEventsUsedInSession,
            maxResizeEventsPerSession: limits.maxResizeEventsPerSession,
          },
        );
      }
      return Object.freeze({
        operationType: "resize",
        applied: false,
        conflictReason: "sessionResizeLimitExceeded",
        beforeDimensions: state.dimensions,
        afterDimensions: state.dimensions,
        insertedCells: Object.freeze([]),
        removedCells: Object.freeze([]),
        movedCells: Object.freeze([]),
        nextState: state,
      });
    }

    const currentReelCount = state.dimensions.reelCount;
    const nextReelCount = currentReelCount + reelDelta;
    const nextReelHeights = state.dimensions.reelHeights.map(
      (h) => h + rowDelta,
    );

    if (
      nextReelCount < (limits?.minReels ?? 1) ||
      (limits?.maxReels !== undefined && nextReelCount > limits.maxReels) ||
      nextReelHeights.some(
        (h) =>
          h < (limits?.minRows ?? 1) ||
          (limits?.maxRows !== undefined && h > limits.maxRows),
      )
    ) {
      if (throwOnConflict) {
        throw new InvalidResizeOperationError(
          "Requested board resize exceeds configured dimension limits.",
          {
            currentDimensions: state.dimensions,
            nextReelCount,
            nextReelHeights,
            limits,
          },
        );
      }
      return Object.freeze({
        operationType: "resize",
        applied: false,
        conflictReason: "dimensionLimitExceeded",
        beforeDimensions: state.dimensions,
        afterDimensions: state.dimensions,
        insertedCells: Object.freeze([]),
        removedCells: Object.freeze([]),
        movedCells: Object.freeze([]),
        nextState: state,
      });
    }

    // Check if shrinking would delete any locked cell
    if (reelDelta < 0 || rowDelta < 0) {
      for (const lock of Object.values(state.locksByCoord)) {
        if (!lock.locked) continue;
        const c = lock.reelIndex;
        const r = lock.rowIndex;
        const colHeight = state.dimensions.reelHeights[c] ?? 0;

        const removedByReelShrink =
          reelDelta < 0 &&
          (reelSide === "right"
            ? c >= currentReelCount + reelDelta
            : c < -reelDelta);
        const removedByRowShrink =
          rowDelta < 0 &&
          (rowSide === "bottom" ? r >= colHeight + rowDelta : r < -rowDelta);

        if (removedByReelShrink || removedByRowShrink) {
          if (throwOnConflict) {
            throw new InvalidResizeOperationError(
              `Cannot shrink board over locked cell at (${c}, ${r}).`,
              { lockedPosition: { reelIndex: c, rowIndex: r }, request },
            );
          }
          return Object.freeze({
            operationType: "resize",
            applied: false,
            conflictReason: "lockedCellConflict",
            beforeDimensions: state.dimensions,
            afterDimensions: state.dimensions,
            insertedCells: Object.freeze([]),
            removedCells: Object.freeze([]),
            movedCells: Object.freeze([]),
            nextState: state,
          });
        }
      }
    }

    const reelOffset = reelSide === "left" ? reelDelta : 0;
    const rowOffset = rowSide === "top" ? rowDelta : 0;

    const insertedCells: InsertedCellRecord[] = [];
    const removedCells: RemovedCellRecord[] = [];
    const movedCells: MovedCellRecord[] = [];

    const nextLocks: Record<string, CellLockState> = {};
    const nextValues: Record<string, number> = {};
    const nextTags: Record<string, readonly CellTag[]> = {};

    // Record removed cells when shrinking
    for (let oldC = 0; oldC < currentReelCount; oldC++) {
      const oldCol = state.board.cells[oldC]!;
      for (let oldR = 0; oldR < oldCol.length; oldR++) {
        const newC = oldC + reelOffset;
        const newR = oldR + rowOffset;
        const targetHeight = oldCol.length + rowDelta;
        if (
          newC < 0 ||
          newC >= nextReelCount ||
          newR < 0 ||
          newR >= targetHeight
        ) {
          const oldKey = `${oldC}:${oldR}`;
          removedCells.push(
            Object.freeze({
              position: Object.freeze({ reelIndex: oldC, rowIndex: oldR }),
              symbolId: oldCol[oldR]!.symbolId,
              ...(state.attachedValuesByCoord[oldKey] !== undefined
                ? { attachedValue: state.attachedValuesByCoord[oldKey] }
                : {}),
            }),
          );
        }
      }
    }

    const defaultNewReelHeight =
      nextReelHeights[0] ?? Math.max(1, 3 + rowDelta);
    const newColumns: Cell[][] = [];

    for (let newC = 0; newC < nextReelCount; newC++) {
      const oldC = newC - reelOffset;
      const hasOldReel = oldC >= 0 && oldC < currentReelCount;
      const oldCol = hasOldReel ? state.board.cells[oldC]! : null;
      const colHeight = oldCol ? oldCol.length + rowDelta : defaultNewReelHeight;
      const colCells: Cell[] = [];

      for (let newR = 0; newR < colHeight; newR++) {
        const oldR = newR - rowOffset;
        const hasOldCell =
          oldCol !== null && oldR >= 0 && oldR < oldCol.length;

        if (hasOldCell) {
          const oldCell = oldCol![oldR]!;
          const oldKey = `${oldC}:${oldR}`;
          const newKey = `${newC}:${newR}`;

          const lock = state.locksByCoord[oldKey];
          if (lock?.locked) {
            nextLocks[newKey] = Object.freeze({
              ...lock,
              reelIndex: newC,
              rowIndex: newR,
            });
          }

          const attachedValue = state.attachedValuesByCoord[oldKey];
          if (attachedValue !== undefined) {
            nextValues[newKey] = attachedValue;
          }

          const cellTags = state.tagsByCoord[oldKey];
          if (cellTags) {
            nextTags[newKey] = cellTags;
          }

          if (oldC !== newC || oldR !== newR) {
            movedCells.push(
              Object.freeze({
                from: Object.freeze({ reelIndex: oldC, rowIndex: oldR }),
                to: Object.freeze({ reelIndex: newC, rowIndex: newR }),
                symbolId: oldCell.symbolId,
                ...(attachedValue !== undefined ? { attachedValue } : {}),
              }),
            );
          }

          colCells.push(
            buildCell(newC, newR, oldCell.symbolId, {
              stopIndex: oldCell.stopIndex,
              locked: Boolean(lock?.locked),
              multiplier: oldCell.multiplier,
              mysteryResolvedFrom: oldCell.mysteryResolvedFrom,
              colossalGroupId: oldCell.colossalGroupId,
            }),
          );
        } else {
          // Newly inserted cell starts empty and unlocked
          colCells.push(
            buildCell(newC, newR, emptySymbolId, {
              stopIndex: newR,
              locked: false,
            }),
          );
          insertedCells.push(
            Object.freeze({
              position: Object.freeze({ reelIndex: newC, rowIndex: newR }),
              symbolId: emptySymbolId,
            }),
          );
        }
      }

      newColumns.push(colCells);
    }

    // Shift colossal anchors by (reelOffset, rowOffset) and recompute coverage
    const shiftedColossal = state.colossalInstances.map((inst) =>
      Object.freeze({
        ...inst,
        anchor: Object.freeze({
          reelIndex: inst.anchor.reelIndex + reelOffset,
          rowIndex: inst.anchor.rowIndex + rowOffset,
        }),
      }),
    );
    const updatedHeights = newColumns.map((col) => col.length);
    const updatedColossal = recomputeColossalCoverage(
      shiftedColossal,
      updatedHeights,
      nextLocks,
    );

    const nextBoard = rebuildBoardWithMetadata(
      newColumns,
      nextLocks,
      updatedColossal,
    );
    const afterDimensions = computeDimensions(nextBoard);

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      dimensions: afterDimensions,
      locksByCoord: Object.freeze(nextLocks),
      attachedValuesByCoord: Object.freeze(nextValues),
      tagsByCoord: Object.freeze(nextTags),
      colossalInstances: updatedColossal,
      reelStopIndexes: Object.freeze(
        newColumns.map((col) => col[0]?.stopIndex ?? 0),
      ),
      resizeEventsUsedInSession: state.resizeEventsUsedInSession + 1,
    });

    return Object.freeze({
      operationType: "resize",
      applied: true,
      conflictReason: null,
      beforeDimensions: state.dimensions,
      afterDimensions,
      insertedCells: Object.freeze(insertedCells),
      removedCells: Object.freeze(removedCells),
      movedCells: Object.freeze(movedCells),
      nextState,
    });
  }

  /**
   * 8. REEL NUDGES
   * Shifts a stopped reel up or down by a signed number of B04 circular strip
   * positions, rebuilding its visible cells deterministically.
   */
  public nudgeReel(
    state: BoardState,
    request: ReelNudgeRequest,
  ): NudgeResult {
    const { reelIndex } = request;
    if (
      typeof reelIndex !== "number" ||
      !Number.isInteger(reelIndex) ||
      reelIndex < 0 ||
      reelIndex >= state.board.cells.length
    ) {
      throw new InvalidReelNudgeError(
        `Invalid reelIndex (${String(reelIndex)}) for nudgeReel.`,
        { reelIndex, reelCount: state.board.cells.length },
      );
    }

    const stripSymbols = extractStripSymbols(request.reelStrip);
    if (!stripSymbols || stripSymbols.length === 0) {
      throw new InvalidReelNudgeError(
        `Reel strip for nudgeReel at reel ${reelIndex} must be non-empty.`,
        { reelIndex },
      );
    }

    let signedOffset = request.offsetSteps ?? 0;
    if (request.offsetSteps === undefined) {
      if (request.direction !== "up" && request.direction !== "down") {
        throw new InvalidReelNudgeError(
          `nudgeReel requires either offsetSteps or direction ("up" | "down").`,
          { request },
        );
      }
      const steps = request.steps ?? 1;
      if (!Number.isInteger(steps) || steps < 1) {
        throw new InvalidReelNudgeError(
          `nudgeReel steps must be a positive integer >= 1.`,
          { steps },
        );
      }
      // Nudging the reel strip "down" brings the stop above top stop into view (-steps);
      // nudging "up" advances the top stop index (+steps)
      signedOffset = request.direction === "up" ? steps : -steps;
    }

    const respectLocks = request.respectLocks ?? true;
    const stripLen = stripSymbols.length;
    const oldCol = state.board.cells[reelIndex]!;
    const stopIndexBefore =
      state.reelStopIndexes[reelIndex] ?? oldCol[0]?.stopIndex ?? 0;
    const stopIndexAfter =
      (((stopIndexBefore + signedOffset) % stripLen) + stripLen) % stripLen;

    const symbolIdsBefore = oldCol.map((c) => c.symbolId);
    const newColumns: Cell[][] = state.board.cells.map((col) => [...col]);
    const updatedReelCol: Cell[] = [];
    const changedCells: ChangedCellRecord[] = [];

    for (let r = 0; r < oldCol.length; r++) {
      const prevCell = oldCol[r]!;
      const key = `${reelIndex}:${r}`;
      if (respectLocks && state.locksByCoord[key]?.locked) {
        updatedReelCol.push(prevCell);
        continue;
      }

      const cellStopIdx = (stopIndexAfter + r) % stripLen;
      const nextSymId = stripSymbols[cellStopIdx]!;
      updatedReelCol.push(
        buildCell(reelIndex, r, nextSymId, {
          stopIndex: cellStopIdx,
          locked: false,
        }),
      );
      if (nextSymId !== prevCell.symbolId) {
        changedCells.push(
          Object.freeze({
            position: Object.freeze({ reelIndex, rowIndex: r }),
            previousSymbolId: prevCell.symbolId,
            nextSymbolId: nextSymId,
          }),
        );
      }
    }

    newColumns[reelIndex] = updatedReelCol;
    const nextStopIndexes = [...state.reelStopIndexes];
    nextStopIndexes[reelIndex] = stopIndexAfter;

    const updatedColossal = recomputeColossalCoverage(
      state.colossalInstances,
      state.dimensions.reelHeights,
      state.locksByCoord,
    );
    const nextBoard = rebuildBoardWithMetadata(
      newColumns,
      state.locksByCoord,
      updatedColossal,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      colossalInstances: updatedColossal,
      reelStopIndexes: Object.freeze(nextStopIndexes),
    });

    return Object.freeze({
      operationType: "nudgeReel",
      reelIndex,
      signedOffset,
      stopIndexBefore,
      stopIndexAfter,
      symbolIdsBefore: Object.freeze(symbolIdsBefore),
      symbolIdsAfter: Object.freeze(updatedReelCol.map((c) => c.symbolId)),
      changedCells: Object.freeze(changedCells),
      nextState,
    });
  }

  /**
   * 9. LINKED / MIRRORED REELS
   * Copies a source reel's visible symbols to target reels (identical or vertically mirrored),
   * retaining target reel identity and rejecting invalid cycles.
   */
  public applyLinkedReels(
    state: BoardState,
    links: readonly LinkedReelSpec[],
  ): LinkedReelResult {
    if (!Array.isArray(links) || links.length === 0) {
      throw new InvalidLinkedReelsError(
        "applyLinkedReels requires a non-empty links array.",
      );
    }

    const reelCount = state.board.cells.length;
    const allSources = new Set<number>();
    const allTargets = new Set<number>();

    for (const link of links) {
      if (
        !Number.isInteger(link.sourceReel) ||
        link.sourceReel < 0 ||
        link.sourceReel >= reelCount
      ) {
        throw new InvalidLinkedReelsError(
          `Invalid sourceReel (${String(link.sourceReel)}) in applyLinkedReels.`,
          { link, reelCount },
        );
      }
      if (!Array.isArray(link.targetReels) || link.targetReels.length === 0) {
        throw new InvalidLinkedReelsError(
          `Link for sourceReel ${link.sourceReel} must specify at least one targetReel.`,
          { link },
        );
      }
      allSources.add(link.sourceReel);
      for (const t of link.targetReels) {
        if (!Number.isInteger(t) || t < 0 || t >= reelCount) {
          throw new InvalidLinkedReelsError(
            `Invalid targetReel (${String(t)}) in applyLinkedReels.`,
            { link, reelCount },
          );
        }
        if (t === link.sourceReel) {
          throw new InvalidLinkedReelsError(
            `Reel ${t} cannot be linked to itself.`,
            { link },
          );
        }
        if (allTargets.has(t)) {
          throw new InvalidLinkedReelsError(
            `Target reel ${t} is targeted by multiple linked-reel rules.`,
            { targetReel: t },
          );
        }
        allTargets.add(t);
      }
    }

    // Reject any chain/cycle where a source reel is also a target reel
    for (const src of allSources) {
      if (allTargets.has(src)) {
        throw new InvalidLinkedReelsError(
          `Linked-reel cycle/chain detected: reel ${src} is both a source and a target.`,
          { reelIndex: src },
        );
      }
    }

    const newColumns: Cell[][] = state.board.cells.map((col) => [...col]);
    const changedCells: ChangedCellRecord[] = [];
    const linksApplied: {
      readonly sourceReel: number;
      readonly targetReels: readonly number[];
      readonly mappingMode: "identical" | "mirrored";
    }[] = [];

    for (const link of links) {
      const mappingMode = link.mappingMode ?? "identical";
      const respectLocks = link.respectLocks ?? true;
      const sourceCol = state.board.cells[link.sourceReel]!;
      const sourceSymbols = sourceCol.map((c) => c.symbolId);
      const orderedSymbols =
        mappingMode === "mirrored"
          ? [...sourceSymbols].reverse()
          : sourceSymbols;

      for (const targetReel of link.targetReels) {
        const targetCol = newColumns[targetReel]!;
        const nextTargetCol: Cell[] = [];

        for (let r = 0; r < targetCol.length; r++) {
          const prevCell = targetCol[r]!;
          const key = `${targetReel}:${r}`;
          if (respectLocks && state.locksByCoord[key]?.locked) {
            nextTargetCol.push(prevCell);
            continue;
          }

          const copiedSymbolId =
            orderedSymbols[r % orderedSymbols.length] ?? prevCell.symbolId;
          // Preserve target reel's own reelIndex & stopIndex while updating visible symbol
          nextTargetCol.push(
            buildCell(targetReel, r, copiedSymbolId, {
              stopIndex: prevCell.stopIndex,
              locked: false,
              multiplier: prevCell.multiplier,
            }),
          );
          if (copiedSymbolId !== prevCell.symbolId) {
            changedCells.push(
              Object.freeze({
                position: Object.freeze({ reelIndex: targetReel, rowIndex: r }),
                previousSymbolId: prevCell.symbolId,
                nextSymbolId: copiedSymbolId,
              }),
            );
          }
        }

        newColumns[targetReel] = nextTargetCol;
      }

      linksApplied.push(
        Object.freeze({
          sourceReel: link.sourceReel,
          targetReels: Object.freeze([...link.targetReels]),
          mappingMode,
        }),
      );
    }

    const updatedColossal = recomputeColossalCoverage(
      state.colossalInstances,
      state.dimensions.reelHeights,
      state.locksByCoord,
    );
    const nextBoard = rebuildBoardWithMetadata(
      newColumns,
      state.locksByCoord,
      updatedColossal,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      colossalInstances: updatedColossal,
    });

    return Object.freeze({
      operationType: "linkedReels",
      linksApplied: Object.freeze(linksApplied),
      changedCells: Object.freeze(changedCells),
      nextState,
    });
  }

  /**
   * 10. VARIABLE REEL HEIGHTS
   * Resolves per-reel visible row counts from either a shared range or per-reel
   * ranges via B03 RandomSource, producing an unambiguous ragged board.
   */
  public resolveVariableReelHeights(
    spec: VariableReelHeightSpec,
    rng?: RandomSource,
    existingState?: BoardState,
  ): VariableReelHeightResult {
    if (
      !spec ||
      !Number.isInteger(spec.reelCount) ||
      spec.reelCount < 1
    ) {
      throw new InvalidVariableHeightConfigurationError(
        "VariableReelHeightSpec.reelCount must be an integer >= 1.",
        { spec },
      );
    }

    const snapshotBefore = rng ? rng.snapshot() : null;
    const drawsBefore = rng ? rng.getDrawCount() : 0;

    const reelHeights: number[] = [];

    if (spec.explicitReelHeights) {
      if (spec.explicitReelHeights.length !== spec.reelCount) {
        throw new InvalidVariableHeightConfigurationError(
          `explicitReelHeights length (${spec.explicitReelHeights.length}) must match reelCount (${spec.reelCount}).`,
          { spec },
        );
      }
      for (const h of spec.explicitReelHeights) {
        if (!Number.isInteger(h) || h < 1) {
          throw new InvalidVariableHeightConfigurationError(
            `Each explicit reel height must be an integer >= 1, received ${String(h)}.`,
            { spec },
          );
        }
        reelHeights.push(h);
      }
    } else if (spec.perReelRanges) {
      if (spec.perReelRanges.length !== spec.reelCount) {
        throw new InvalidVariableHeightConfigurationError(
          `perReelRanges length (${spec.perReelRanges.length}) must match reelCount (${spec.reelCount}).`,
          { spec },
        );
      }
      if (!rng) {
        throw new InvalidVariableHeightConfigurationError(
          "resolveVariableReelHeights with perReelRanges requires a B03 RandomSource.",
        );
      }
      for (let c = 0; c < spec.reelCount; c++) {
        const range = spec.perReelRanges[c]!;
        if (
          !Number.isInteger(range.minRows) ||
          !Number.isInteger(range.maxRows) ||
          range.minRows < 1 ||
          range.maxRows < range.minRows
        ) {
          throw new InvalidVariableHeightConfigurationError(
            `Invalid row range [${String(range.minRows)}, ${String(range.maxRows)}] at reel ${c}.`,
            { reelIndex: c, range },
          );
        }
        const chosen =
          range.minRows === range.maxRows
            ? range.minRows
            : rng.nextInt(range.minRows, range.maxRows + 1);
        reelHeights.push(chosen);
      }
    } else if (spec.sharedRange) {
      const { minRows, maxRows } = spec.sharedRange;
      if (
        !Number.isInteger(minRows) ||
        !Number.isInteger(maxRows) ||
        minRows < 1 ||
        maxRows < minRows
      ) {
        throw new InvalidVariableHeightConfigurationError(
          `Invalid sharedRange [${String(minRows)}, ${String(maxRows)}].`,
          { sharedRange: spec.sharedRange },
        );
      }
      if (!rng) {
        throw new InvalidVariableHeightConfigurationError(
          "resolveVariableReelHeights with sharedRange requires a B03 RandomSource.",
        );
      }
      for (let c = 0; c < spec.reelCount; c++) {
        const chosen =
          minRows === maxRows ? minRows : rng.nextInt(minRows, maxRows + 1);
        reelHeights.push(chosen);
      }
    } else {
      throw new InvalidVariableHeightConfigurationError(
        "VariableReelHeightSpec must specify sharedRange, perReelRanges, or explicitReelHeights.",
        { spec },
      );
    }

    const snapshotAfter = rng ? rng.snapshot() : null;
    const drawsAfter = rng ? rng.getDrawCount() : 0;

    const defaultSym = spec.defaultSymbolId ?? "A";
    const symbolColumns: SymbolId[][] = [];

    for (let c = 0; c < spec.reelCount; c++) {
      const targetHeight = reelHeights[c]!;
      const colSyms: SymbolId[] = [];
      const stripRaw = spec.reelStrips?.[c];
      const stripSyms = stripRaw ? extractStripSymbols(stripRaw) : null;
      const existingCol = existingState?.board.cells[c];

      for (let r = 0; r < targetHeight; r++) {
        if (existingCol && r < existingCol.length) {
          colSyms.push(existingCol[r]!.symbolId);
        } else if (stripSyms && stripSyms.length > 0) {
          colSyms.push(stripSyms[r % stripSyms.length]!);
        } else {
          colSyms.push(defaultSym);
        }
      }
      symbolColumns.push(colSyms);
    }

    const raggedBoard = createBoardFromSymbolGrid(symbolColumns);
    const nextState = this.createBoardState(raggedBoard, {
      locksByCoord: existingState?.locksByCoord,
      attachedValuesByCoord: existingState?.attachedValuesByCoord,
      tagsByCoord: existingState?.tagsByCoord,
      colossalInstances: existingState?.colossalInstances,
      resizeEventsUsedInSession: existingState?.resizeEventsUsedInSession,
    });

    return Object.freeze({
      operationType: "variableReelHeights",
      reelHeights: Object.freeze(reelHeights),
      rngUsage:
        snapshotBefore && snapshotAfter
          ? Object.freeze({
              drawsConsumed: drawsAfter - drawsBefore,
              snapshotBefore,
              snapshotAfter,
            })
          : null,
      nextState,
    });
  }

  /**
   * 11. SYMBOL DUPLICATION
   * Duplicates a landed symbol into consecutive cells within its own reel,
   * respecting board bounds, locked cells, and protected tags.
   */
  public duplicateSymbols(
    state: BoardState,
    request: DuplicationRequest,
  ): DuplicationResult {
    if (
      typeof request.count !== "number" ||
      !Number.isInteger(request.count) ||
      request.count < 1
    ) {
      throw new InvalidDuplicationOperationError(
        `Duplication count must be a positive integer >= 1, received ${String(request.count)}.`,
        { request },
      );
    }

    const direction = request.direction ?? "down";
    const respectLocks = request.respectLocks ?? true;
    const protectedTagSet = new Set<string>(request.protectedTags ?? []);

    const sourcePositions: Position[] = [];
    if (request.sourcePositions) {
      for (const pos of request.sourcePositions) {
        sourcePositions.push(pos);
      }
    }
    if (request.sourceSymbolId) {
      for (let c = 0; c < state.board.cells.length; c++) {
        const col = state.board.cells[c]!;
        for (let r = 0; r < col.length; r++) {
          if (col[r]!.symbolId === request.sourceSymbolId) {
            sourcePositions.push({ reelIndex: c, rowIndex: r });
          }
        }
      }
    }
    if (request.targetTag) {
      for (const [key, tagList] of Object.entries(state.tagsByCoord)) {
        if (tagList.some((t) => t.tag === request.targetTag)) {
          const [cStr, rStr] = key.split(":");
          sourcePositions.push({
            reelIndex: Number(cStr),
            rowIndex: Number(rStr),
          });
        }
      }
    }

    const newColumns: Cell[][] = state.board.cells.map((col) => [...col]);
    const changedCells: ChangedCellRecord[] = [];
    const skippedProtectedPositions: Position[] = [];

    for (const src of sourcePositions) {
      const col = newColumns[src.reelIndex];
      if (!col || src.rowIndex < 0 || src.rowIndex >= col.length) continue;
      const sourceSymbolId = state.board.cells[src.reelIndex]![src.rowIndex]!.symbolId;

      const candidateRows: number[] = [];
      if (direction === "down" || direction === "both") {
        for (let step = 1; step <= request.count; step++) {
          candidateRows.push(src.rowIndex + step);
        }
      }
      if (direction === "up" || direction === "both") {
        for (let step = 1; step <= request.count; step++) {
          candidateRows.push(src.rowIndex - step);
        }
      }

      for (const targetRow of candidateRows) {
        if (targetRow < 0 || targetRow >= col.length) {
          // Respect reel boundaries
          continue;
        }
        const key = `${src.reelIndex}:${targetRow}`;
        const isLocked = respectLocks && Boolean(state.locksByCoord[key]?.locked);
        const hasProtectedTag =
          protectedTagSet.size > 0 &&
          (state.tagsByCoord[key] ?? []).some((t) =>
            protectedTagSet.has(t.tag),
          );

        if (isLocked || hasProtectedTag) {
          skippedProtectedPositions.push(
            Object.freeze({ reelIndex: src.reelIndex, rowIndex: targetRow }),
          );
          continue;
        }

        const prevCell = col[targetRow]!;
        col[targetRow] = buildCell(
          src.reelIndex,
          targetRow,
          sourceSymbolId,
          {
            stopIndex: prevCell.stopIndex,
            locked: false,
            multiplier: prevCell.multiplier,
          },
        );
        changedCells.push(
          Object.freeze({
            position: Object.freeze({
              reelIndex: src.reelIndex,
              rowIndex: targetRow,
            }),
            previousSymbolId: prevCell.symbolId,
            nextSymbolId: sourceSymbolId,
          }),
        );
      }
    }

    const updatedColossal = recomputeColossalCoverage(
      state.colossalInstances,
      state.dimensions.reelHeights,
      state.locksByCoord,
    );
    const nextBoard = rebuildBoardWithMetadata(
      newColumns,
      state.locksByCoord,
      updatedColossal,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      colossalInstances: updatedColossal,
    });

    return Object.freeze({
      operationType: "duplicateSymbols",
      changedCells: Object.freeze(changedCells),
      skippedProtectedPositions: Object.freeze(skippedProtectedPositions),
      nextState,
    });
  }

  /**
   * 12. LANE SWEEPS
   * Enters from a configured edge (left, right, top, bottom) and clears/replaces
   * cells along the target row or reel up to travelDistance while respecting
   * fireChance, sweepsCount, locked cells, and protected tags.
   */
  public applyLaneSweep(
    state: BoardState,
    request: LaneSweepRequest,
    rng?: RandomSource,
  ): LaneSweepResult {
    const fireChance = request.fireChance ?? 1;
    if (
      typeof fireChance !== "number" ||
      !Number.isFinite(fireChance) ||
      fireChance < 0 ||
      fireChance > 1
    ) {
      throw new InvalidLaneSweepError(
        `LaneSweep fireChance must be in [0, 1], received ${String(fireChance)}.`,
        { request },
      );
    }

    const sweepsCount = request.sweepsCount ?? 1;
    if (!Number.isInteger(sweepsCount) || sweepsCount < 1) {
      throw new InvalidLaneSweepError(
        `LaneSweep sweepsCount must be an integer >= 1, received ${String(sweepsCount)}.`,
        { request },
      );
    }

    const snapshotBefore = rng ? rng.snapshot() : null;
    const drawsBefore = rng ? rng.getDrawCount() : 0;

    let fired = true;
    if (fireChance < 1) {
      if (fireChance === 0) {
        fired = false;
      } else {
        if (!rng) {
          throw new InvalidLaneSweepError(
            "applyLaneSweep with fractional fireChance requires a B03 RandomSource.",
          );
        }
        fired = rng.nextBoolean(fireChance);
      }
    }

    if (!fired) {
      const snapshotAfter = rng ? rng.snapshot() : null;
      const drawsAfter = rng ? rng.getDrawCount() : 0;
      return Object.freeze({
        operationType: "laneSweep",
        fired: false,
        sweepsExecuted: 0,
        clearedCells: Object.freeze([]),
        changedCells: Object.freeze([]),
        protectedSkippedPositions: Object.freeze([]),
        rngUsage:
          snapshotBefore && snapshotAfter
            ? Object.freeze({
                drawsConsumed: drawsAfter - drawsBefore,
                snapshotBefore,
                snapshotAfter,
              })
            : null,
        nextState: state,
      });
    }

    const replacementSymbolId = request.replacementSymbolId ?? "EMPTY";
    const respectLocks = request.respectLocks ?? true;
    const protectedTagSet = new Set<string>(request.protectedTags ?? []);
    const reelCount = state.board.cells.length;
    const maxRows = state.dimensions.maxRowCount;

    const targetIndexes: number[] = [];
    if (request.targetIndexes && request.targetIndexes.length > 0) {
      targetIndexes.push(...request.targetIndexes.slice(0, sweepsCount));
    } else if (request.targetIndex !== undefined) {
      for (let i = 0; i < sweepsCount; i++) {
        targetIndexes.push(request.targetIndex + i);
      }
    } else {
      for (let i = 0; i < sweepsCount; i++) {
        targetIndexes.push(i);
      }
    }

    const newColumns: Cell[][] = state.board.cells.map((col) => [...col]);
    const clearedCells: RemovedCellRecord[] = [];
    const changedCells: ChangedCellRecord[] = [];
    const protectedSkippedPositions: Position[] = [];
    let sweepsExecuted = 0;

    for (const laneIdx of targetIndexes) {
      const pathPositions: Position[] = [];

      if (request.entryEdge === "left") {
        const dist = request.travelDistance ?? reelCount;
        for (let c = 0; c < Math.min(reelCount, dist); c++) {
          if (laneIdx >= 0 && laneIdx < (newColumns[c]?.length ?? 0)) {
            pathPositions.push({ reelIndex: c, rowIndex: laneIdx });
          }
        }
      } else if (request.entryEdge === "right") {
        const dist = request.travelDistance ?? reelCount;
        for (
          let step = 0;
          step < Math.min(reelCount, dist);
          step++
        ) {
          const c = reelCount - 1 - step;
          if (laneIdx >= 0 && laneIdx < (newColumns[c]?.length ?? 0)) {
            pathPositions.push({ reelIndex: c, rowIndex: laneIdx });
          }
        }
      } else if (request.entryEdge === "top") {
        const col = newColumns[laneIdx];
        if (col) {
          const dist = request.travelDistance ?? col.length;
          for (let r = 0; r < Math.min(col.length, dist); r++) {
            pathPositions.push({ reelIndex: laneIdx, rowIndex: r });
          }
        }
      } else if (request.entryEdge === "bottom") {
        const col = newColumns[laneIdx];
        if (col) {
          const dist = request.travelDistance ?? col.length;
          for (let step = 0; step < Math.min(col.length, dist); step++) {
            const r = col.length - 1 - step;
            pathPositions.push({ reelIndex: laneIdx, rowIndex: r });
          }
        }
      } else {
        throw new InvalidLaneSweepError(
          `Unsupported entryEdge "${String(request.entryEdge)}" in applyLaneSweep.`,
          { maxRows },
        );
      }

      if (pathPositions.length > 0) {
        sweepsExecuted++;
      }

      for (const pos of pathPositions) {
        const key = `${pos.reelIndex}:${pos.rowIndex}`;
        const isLocked =
          respectLocks && Boolean(state.locksByCoord[key]?.locked);
        const hasProtectedTag =
          protectedTagSet.size > 0 &&
          (state.tagsByCoord[key] ?? []).some((t) =>
            protectedTagSet.has(t.tag),
          );

        if (isLocked || hasProtectedTag) {
          protectedSkippedPositions.push(Object.freeze({ ...pos }));
          continue;
        }

        const prevCell = newColumns[pos.reelIndex]![pos.rowIndex]!;
        newColumns[pos.reelIndex]![pos.rowIndex] = buildCell(
          pos.reelIndex,
          pos.rowIndex,
          replacementSymbolId,
          {
            stopIndex: prevCell.stopIndex,
            locked: false,
          },
        );
        clearedCells.push(
          Object.freeze({
            position: Object.freeze({ ...pos }),
            symbolId: prevCell.symbolId,
          }),
        );
        changedCells.push(
          Object.freeze({
            position: Object.freeze({ ...pos }),
            previousSymbolId: prevCell.symbolId,
            nextSymbolId: replacementSymbolId,
          }),
        );
      }
    }

    const snapshotAfter = rng ? rng.snapshot() : null;
    const drawsAfter = rng ? rng.getDrawCount() : 0;

    const updatedColossal = recomputeColossalCoverage(
      state.colossalInstances,
      state.dimensions.reelHeights,
      state.locksByCoord,
    );
    const nextBoard = rebuildBoardWithMetadata(
      newColumns,
      state.locksByCoord,
      updatedColossal,
    );

    const nextState: BoardState = Object.freeze({
      ...state,
      board: nextBoard,
      colossalInstances: updatedColossal,
    });

    return Object.freeze({
      operationType: "laneSweep",
      fired: true,
      sweepsExecuted,
      clearedCells: Object.freeze(clearedCells),
      changedCells: Object.freeze(changedCells),
      protectedSkippedPositions: Object.freeze(protectedSkippedPositions),
      rngUsage:
        snapshotBefore && snapshotAfter
          ? Object.freeze({
              drawsConsumed: drawsAfter - drawsBefore,
              snapshotBefore,
              snapshotAfter,
            })
          : null,
      nextState,
    });
  }

  /**
   * 13. TAGGED POSITIONS
   * Tags board cells in "random", "onePerReel", or "configured" mode with
   * "spin" or "feature" lifetime using B03 RandomSource.
   */
  public tagPositions(
    state: BoardState,
    request: TagPositionsRequest,
    rng?: RandomSource,
  ): TagOperationResult {
    if (typeof request.tag !== "string" || request.tag.trim().length === 0) {
      throw new InvalidTagOperationError(
        "TagPositionsRequest.tag must be a non-empty string.",
        { request },
      );
    }

    const snapshotBefore = rng ? rng.snapshot() : null;
    const drawsBefore = rng ? rng.getDrawCount() : 0;

    const selectedPositions: Position[] = [];

    if (request.mode === "configured") {
      if (!Array.isArray(request.positions) || request.positions.length === 0) {
        throw new InvalidTagOperationError(
          'tagPositions in "configured" mode requires a non-empty positions array.',
          { request },
        );
      }
      const limit = request.count ?? request.positions.length;
      for (const pos of request.positions.slice(0, limit)) {
        const col = state.board.cells[pos.reelIndex];
        if (!col || pos.rowIndex < 0 || pos.rowIndex >= col.length) {
          throw new InvalidTagOperationError(
            `Configured tag position (${pos.reelIndex}, ${pos.rowIndex}) is out of bounds.`,
            { pos },
          );
        }
        selectedPositions.push(Object.freeze({ ...pos }));
      }
    } else if (request.mode === "onePerReel") {
      if (!rng) {
        throw new InvalidTagOperationError(
          'tagPositions in "onePerReel" mode requires a B03 RandomSource.',
        );
      }
      for (let c = 0; c < state.board.cells.length; c++) {
        const col = state.board.cells[c]!;
        if (col.length === 0) continue;
        const r = rng.nextInt(col.length);
        selectedPositions.push(Object.freeze({ reelIndex: c, rowIndex: r }));
      }
    } else if (request.mode === "random") {
      if (!rng) {
        throw new InvalidTagOperationError(
          'tagPositions in "random" mode requires a B03 RandomSource.',
        );
      }
      const count = request.count ?? 1;
      if (!Number.isInteger(count) || count < 1) {
        throw new InvalidTagOperationError(
          `tagPositions random count must be >= 1, received ${String(count)}.`,
          { count },
        );
      }
      const allCoords: Position[] = [];
      for (let c = 0; c < state.board.cells.length; c++) {
        const col = state.board.cells[c]!;
        for (let r = 0; r < col.length; r++) {
          allCoords.push({ reelIndex: c, rowIndex: r });
        }
      }
      const picks = Math.min(count, allCoords.length);
      for (let i = 0; i < picks; i++) {
        const idx = rng.nextInt(allCoords.length);
        const picked = allCoords[idx]!;
        selectedPositions.push(Object.freeze({ ...picked }));
        allCoords.splice(idx, 1);
      }
    } else {
      throw new InvalidTagOperationError(
        `Unsupported tagPositions mode "${String(request.mode)}".`,
        { request },
      );
    }

    const snapshotAfter = rng ? rng.snapshot() : null;
    const drawsAfter = rng ? rng.getDrawCount() : 0;

    const nextTags: Record<string, readonly CellTag[]> = {
      ...state.tagsByCoord,
    };
    const newTagEntry: CellTag = Object.freeze({
      tag: request.tag,
      lifetime: request.lifetime,
      ...(request.origin !== undefined ? { origin: request.origin } : {}),
    });

    for (const pos of selectedPositions) {
      const key = positionKey(pos);
      const existing = nextTags[key] ?? [];
      const filtered = existing.filter((t) => t.tag !== request.tag);
      nextTags[key] = Object.freeze([...filtered, newTagEntry]);
    }

    const nextState: BoardState = Object.freeze({
      ...state,
      tagsByCoord: Object.freeze(nextTags),
    });

    return Object.freeze({
      operationType: "tagPositions",
      tag: request.tag,
      taggedPositions: Object.freeze(selectedPositions),
      rngUsage:
        snapshotBefore && snapshotAfter
          ? Object.freeze({
              drawsConsumed: drawsAfter - drawsBefore,
              snapshotBefore,
              snapshotAfter,
            })
          : null,
      nextState,
    });
  }

  /**
   * Expires cell tags matching the given boundary ("spin" expires spin-scoped tags;
   * "feature" expires both spin-scoped and feature-scoped tags).
   */
  public expireTags(
    state: BoardState,
    boundary: "spin" | "feature",
  ): BoardState {
    const nextTags: Record<string, readonly CellTag[]> = {};
    for (const [key, list] of Object.entries(state.tagsByCoord)) {
      const kept =
        boundary === "feature"
          ? []
          : list.filter((t) => t.lifetime !== "spin");
      if (kept.length > 0) {
        nextTags[key] = Object.freeze(kept);
      }
    }

    return Object.freeze({
      ...state,
      tagsByCoord: Object.freeze(nextTags),
    });
  }

  /**
   * Returns all positions currently carrying the given tag (or any tag if omitted).
   */
  public getTaggedPositions(
    state: BoardState,
    tag?: string,
  ): readonly Position[] {
    const positions: Position[] = [];
    for (const [key, list] of Object.entries(state.tagsByCoord)) {
      if (!tag || list.some((t) => t.tag === tag)) {
        const [cStr, rStr] = key.split(":");
        positions.push(
          Object.freeze({ reelIndex: Number(cStr), rowIndex: Number(rStr) }),
        );
      }
    }
    return Object.freeze(
      positions.sort(
        (a, b) => a.reelIndex - b.reelIndex || a.rowIndex - b.rowIndex,
      ),
    );
  }
}

export function createBoardDynamicsEngine(): DeterministicBoardDynamicsEngine {
  return new DeterministicBoardDynamicsEngine();
}
