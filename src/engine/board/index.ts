/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 / B04 — Board Layer & Authoritative Visible Board Construction
 *
 * Defines Position, VisibleSymbol, Cell, Board, and BoardBuilder.
 *
 * COORDINATE & ORIENTATION CONVENTIONS:
 * - reelIndex: 0 = leftmost reel, reelCount - 1 = rightmost reel
 * - rowIndex:  0 = top visible row, visibleRows - 1 = bottom visible row
 * - Matrix indexing: board.cells[reelIndex][rowIndex] (column-major)
 */

import type { SymbolTier } from "@/lib/blueprint/types";
import type { GameConfig, SymbolId } from "../config";
import {
  InvalidReelCountError,
  InvalidReelResolutionError,
  UnknownSymbolReferenceError,
} from "../errors";
import type { ReelResult } from "../reels";

export interface Position {
  readonly reelIndex: number;
  readonly rowIndex: number;
}

export interface VisibleSymbol {
  readonly symbolId: SymbolId;
  readonly code: string;
  readonly name: string;
  readonly tier: SymbolTier;
  readonly isWild: boolean;
  readonly isScatter: boolean;
  readonly isBonus: boolean;
  readonly wildMultiplier: number;
  readonly stopId: string;
  readonly stripPosition: number;
}

export interface Cell {
  readonly position: Position;
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly stopIndex: number;
  readonly symbolId: SymbolId;
  readonly symbol: VisibleSymbol;
  readonly locked: boolean;
  readonly multiplier: number;
  readonly mysteryResolvedFrom: SymbolId | null;
  readonly colossalGroupId: string | null;
}

export interface Board {
  readonly reelCount: number;
  readonly rowCount: number;
  readonly columns: number;
  readonly rows: number;
  readonly reelHeights: readonly number[];
  /** Column-major matrix: cells[reelIndex][rowIndex] (reel 0 = leftmost, row 0 = top) */
  readonly cells: readonly (readonly Cell[])[];
}

export interface BoardBuildContext {
  readonly lockedCells?: ReadonlyMap<string, Cell>;
  readonly cellMultipliers?: ReadonlyMap<string, number>;
}

export interface BoardBuilder {
  buildBoard(
    config: GameConfig,
    reelResult: ReelResult,
    context?: BoardBuildContext,
  ): Board;
}

export function positionKey(pos: Position): string {
  return `${pos.reelIndex}:${pos.rowIndex}`;
}

export class DefaultBoardBuilder implements BoardBuilder {
  public buildBoard(
    config: GameConfig,
    reelResult: ReelResult,
    context?: BoardBuildContext,
  ): Board {
    if (!config || typeof config !== "object" || !config.grid) {
      throw new InvalidReelResolutionError(
        "buildBoard requires a valid normalized GameConfig.",
      );
    }
    if (
      !reelResult ||
      typeof reelResult !== "object" ||
      !Array.isArray(reelResult.reelWindows)
    ) {
      throw new InvalidReelResolutionError(
        "buildBoard requires a valid ReelResult with reelWindows.",
      );
    }

    const columns = config.grid.columns;
    if (reelResult.reelWindows.length !== columns) {
      throw new InvalidReelCountError(
        `Board construction reel count mismatch: expected ${columns} reels, received ${reelResult.reelWindows.length}.`,
        { expected: columns, actual: reelResult.reelWindows.length },
      );
    }

    const reelHeights: number[] = [];
    const cells: (readonly Cell[])[] = [];

    for (let reelIndex = 0; reelIndex < columns; reelIndex += 1) {
      const reelSlice = reelResult.reelWindows[reelIndex];
      const height = reelSlice.visibleHeight;
      reelHeights.push(height);
      const columnCells: Cell[] = [];

      for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
        const position: Position = Object.freeze({ reelIndex, rowIndex });
        const key = positionKey(position);
        const lockedExisting = context?.lockedCells?.get(key);

        if (lockedExisting) {
          columnCells.push(
            Object.freeze({
              ...lockedExisting,
              position,
              reelIndex,
              rowIndex,
              locked: true,
            }),
          );
          continue;
        }

        const stop = reelSlice.visibleStops[rowIndex];
        const stopIndex =
          reelSlice.visibleStopIndexes?.[rowIndex] ??
          stop?.stopIndex ??
          (reelSlice.stopIndex + rowIndex) %
            (config.reels[reelIndex]?.stops.length || 1);
        const symbolId =
          reelSlice.visibleSymbolIds[rowIndex] ?? stop?.symbolId;

        const symbolDef =
          config.symbolsById.get(symbolId) ??
          config.variantsById?.get(symbolId);
        if (!symbolDef) {
          throw new UnknownSymbolReferenceError(
            `Board construction failed: symbol "${String(symbolId)}" at reel ${reelIndex}, row ${rowIndex} not found in GameConfig.`,
            { reelIndex, rowIndex, stopIndex, symbolId },
          );
        }

        const visibleSymbol: VisibleSymbol = Object.freeze({
          symbolId: symbolDef.id,
          code: symbolDef.code,
          name: symbolDef.name,
          tier: symbolDef.tier,
          isWild: symbolDef.role.isWild,
          isScatter: symbolDef.role.isScatter,
          isBonus: symbolDef.role.isBonus,
          wildMultiplier: symbolDef.role.wildMultiplier,
          stopId: stop?.id ?? `${reelSlice.reelId}-stop-${stopIndex + 1}`,
          stripPosition: stop?.position ?? stopIndex + 1,
        });

        const cellMultiplier = context?.cellMultipliers?.get(key) ?? 1;
        const cell: Cell = Object.freeze({
          position,
          reelIndex,
          rowIndex,
          stopIndex,
          symbolId: symbolDef.id,
          symbol: visibleSymbol,
          locked: false,
          multiplier: cellMultiplier,
          mysteryResolvedFrom: null,
          colossalGroupId: null,
        });
        columnCells.push(cell);
      }

      cells.push(Object.freeze(columnCells));
    }

    const maxRows = Math.max(...reelHeights, config.grid.rows);
    return Object.freeze({
      reelCount: columns,
      rowCount: maxRows,
      columns,
      rows: maxRows,
      reelHeights: Object.freeze(reelHeights),
      cells: Object.freeze(cells),
    });
  }
}

export function getBoardCell(
  board: Board,
  reelIndex: number,
  rowIndex: number,
): Cell | null {
  const column = board.cells[reelIndex];
  if (!column) return null;
  return column[rowIndex] ?? null;
}

export function flattenBoardCells(board: Board): readonly Cell[] {
  const flat: Cell[] = [];
  for (const col of board.cells) {
    for (const cell of col) {
      flat.push(cell);
    }
  }
  return Object.freeze(flat);
}

export function createBoardBuilder(): BoardBuilder {
  return new DefaultBoardBuilder();
}
