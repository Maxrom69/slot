/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 — Win Evaluation Layer & Pluggable Evaluator Boundary
 *
 * Defines WinEvaluator, EvaluationContext, WinLine, WinCombination, and
 * EvaluationResult (WinResult). B05–B09 will expand full line, ways,
 * cluster, pay-anywhere, and cascade evaluators without changing the core contract.
 */

import type { Board, Position } from "../board";
import { getBoardCell } from "../board";
import type {
  EngineEvaluationMode,
  GameConfig,
  NormalizedPayline,
  PaylineId,
  SymbolId,
} from "../config";
import type { PaytableResolver } from "../paytable";
import { createPaytableResolver, roundCurrency } from "../paytable";

export type WinCombinationKind =
  | "payline"
  | "ways"
  | "cluster"
  | "pay_anywhere"
  | "scatter";

export interface WinLine {
  readonly paylineId: PaylineId;
  readonly paylineIndex: number;
  readonly symbolId: SymbolId;
  readonly matchCount: number;
  readonly positions: readonly Position[];
  readonly wildCount: number;
  readonly baseMultiplier: number;
  readonly appliedMultiplier: number;
  readonly payout: number;
}

export interface WinCombination {
  readonly id: string;
  readonly kind: WinCombinationKind;
  readonly symbolId: SymbolId;
  readonly matchCount: number;
  readonly positions: readonly Position[];
  readonly paylineId: PaylineId | null;
  readonly waysCount: number;
  readonly wildCount: number;
  readonly baseMultiplier: number;
  readonly appliedMultiplier: number;
  readonly payout: number;
}

export interface EvaluationResult {
  readonly evaluationMode: EngineEvaluationMode;
  readonly totalWin: number;
  readonly totalWinMultiplier: number;
  readonly winLines: readonly WinLine[];
  readonly combinations: readonly WinCombination[];
  readonly scatterWins: readonly WinCombination[];
}

export type WinResult = EvaluationResult;

export interface EvaluationContext {
  readonly config: GameConfig;
  readonly bet: number;
  readonly activePaylineIds?: readonly PaylineId[];
  readonly roundMultiplier?: number;
  readonly paytableResolver?: PaytableResolver;
}

export interface WinEvaluator {
  evaluate(board: Board, context: EvaluationContext): EvaluationResult;
}

/**
 * Evaluates a single payline left-to-right using GameConfig symbol definitions,
 * wild substitution rules, and paytable lookups.
 */
function evaluateSinglePayline(
  board: Board,
  payline: NormalizedPayline,
  config: GameConfig,
  paytableResolver: PaytableResolver,
  betPerLine: number,
  roundMultiplier: number,
): WinLine | null {
  const columns = board.columns;
  const lineCells = [];

  for (let col = 0; col < columns; col += 1) {
    const rowIdx = payline.pattern[col];
    const cell = getBoardCell(board, col, rowIdx);
    if (!cell) return null;
    lineCells.push(cell);
  }

  // Determine the target paying symbol on the line (left-to-right).
  // Leading wilds can form a pure-wild win OR substitute for the first non-scatter/non-bonus symbol.
  let leadingWildCount = 0;
  let targetSymbolId: SymbolId | null = null;
  let firstWildSymbolId: SymbolId | null = null;

  for (const cell of lineCells) {
    const sym = cell.symbol;
    if (sym.isWild) {
      if (firstWildSymbolId === null) {
        firstWildSymbolId = sym.symbolId;
      }
      if (targetSymbolId === null) {
        leadingWildCount += 1;
      }
    } else if (sym.isScatter || sym.isBonus) {
      break;
    } else {
      if (targetSymbolId === null) {
        targetSymbolId = sym.symbolId;
      }
      break;
    }
  }

  // Evaluate candidate 1: target symbol with wild substitution
  let bestWin: WinLine | null = null;

  if (targetSymbolId !== null) {
    const positions: Position[] = [];
    let wildCount = 0;
    let wildMultiplierProduct = 1;

    for (const cell of lineCells) {
      const sym = cell.symbol;
      if (sym.symbolId === targetSymbolId) {
        positions.push(cell.position);
      } else if (sym.isWild) {
        positions.push(cell.position);
        wildCount += 1;
        if (sym.wildMultiplier > 1) {
          wildMultiplierProduct *= sym.wildMultiplier;
        }
      } else {
        break;
      }
    }

    const matchCount = positions.length;
    const appliedMultiplier = roundMultiplier * wildMultiplierProduct;
    const resolved = paytableResolver.resolvePayout(
      config,
      targetSymbolId,
      matchCount,
      betPerLine,
      appliedMultiplier,
    );

    if (resolved && resolved.amount > 0) {
      bestWin = Object.freeze({
        paylineId: payline.id,
        paylineIndex: payline.index,
        symbolId: targetSymbolId,
        matchCount,
        positions: Object.freeze(positions),
        wildCount,
        baseMultiplier: resolved.baseMultiplier,
        appliedMultiplier,
        payout: resolved.amount,
      });
    }
  }

  // Evaluate candidate 2: pure leading wilds if leadingWildCount > 0
  if (leadingWildCount > 0 && firstWildSymbolId !== null) {
    const wildPositions = lineCells
      .slice(0, leadingWildCount)
      .map((c) => c.position);
    const resolvedWild = paytableResolver.resolvePayout(
      config,
      firstWildSymbolId,
      leadingWildCount,
      betPerLine,
      roundMultiplier,
    );
    if (
      resolvedWild &&
      resolvedWild.amount > 0 &&
      (!bestWin || resolvedWild.amount > bestWin.payout)
    ) {
      bestWin = Object.freeze({
        paylineId: payline.id,
        paylineIndex: payline.index,
        symbolId: firstWildSymbolId,
        matchCount: leadingWildCount,
        positions: Object.freeze(wildPositions),
        wildCount: leadingWildCount,
        baseMultiplier: resolvedWild.baseMultiplier,
        appliedMultiplier: roundMultiplier,
        payout: resolvedWild.amount,
      });
    }
  }

  return bestWin;
}

export class ArchitecturalWinEvaluator implements WinEvaluator {
  public evaluate(board: Board, context: EvaluationContext): EvaluationResult {
    const { config, bet } = context;
    const paytableResolver =
      context.paytableResolver ?? createPaytableResolver();
    const roundMultiplier = context.roundMultiplier ?? 1;
    const evaluationMode = config.grid.evaluationMode;

    const winLines: WinLine[] = [];
    const combinations: WinCombination[] = [];
    const scatterWins: WinCombination[] = [];

    if (evaluationMode === "lines") {
      const activeSet = context.activePaylineIds
        ? new Set(context.activePaylineIds)
        : null;
      const linesToEvaluate = activeSet
        ? config.paylines.filter((l) => activeSet.has(l.id))
        : config.activePaylines;

      const lineCount = Math.max(1, linesToEvaluate.length);
      const betPerLine = bet / lineCount;

      for (const payline of linesToEvaluate) {
        const winLine = evaluateSinglePayline(
          board,
          payline,
          config,
          paytableResolver,
          betPerLine,
          roundMultiplier,
        );
        if (winLine) {
          winLines.push(winLine);
          combinations.push(
            Object.freeze({
              id: `win-line-${winLine.paylineId}-${winLine.symbolId}`,
              kind: "payline",
              symbolId: winLine.symbolId,
              matchCount: winLine.matchCount,
              positions: winLine.positions,
              paylineId: winLine.paylineId,
              waysCount: 1,
              wildCount: winLine.wildCount,
              baseMultiplier: winLine.baseMultiplier,
              appliedMultiplier: winLine.appliedMultiplier,
              payout: winLine.payout,
            }),
          );
        }
      }
    }

    // Evaluate scatter wins across the visible board
    for (const scatterId of config.scatterSymbolIds) {
      const scatterPositions: Position[] = [];
      for (const col of board.cells) {
        for (const cell of col) {
          if (cell.symbol.symbolId === scatterId) {
            scatterPositions.push(cell.position);
          }
        }
      }
      if (scatterPositions.length > 0) {
        const resolved = paytableResolver.resolvePayout(
          config,
          scatterId,
          scatterPositions.length,
          bet,
          roundMultiplier,
        );
        if (resolved && resolved.amount > 0) {
          const scatterWin: WinCombination = Object.freeze({
            id: `win-scatter-${scatterId}-${scatterPositions.length}`,
            kind: "scatter",
            symbolId: scatterId,
            matchCount: scatterPositions.length,
            positions: Object.freeze(scatterPositions),
            paylineId: null,
            waysCount: 1,
            wildCount: 0,
            baseMultiplier: resolved.baseMultiplier,
            appliedMultiplier: roundMultiplier,
            payout: resolved.amount,
          });
          scatterWins.push(scatterWin);
          combinations.push(scatterWin);
        }
      }
    }

    const totalWin = roundCurrency(
      combinations.reduce((sum, combo) => sum + combo.payout, 0),
    );
    const totalWinMultiplier =
      bet > 0 ? roundCurrency(totalWin / bet) : 0;

    return Object.freeze({
      evaluationMode,
      totalWin,
      totalWinMultiplier,
      winLines: Object.freeze(winLines),
      combinations: Object.freeze(combinations),
      scatterWins: Object.freeze(scatterWins),
    });
  }
}

export function createWinEvaluator(): WinEvaluator {
  return new ArchitecturalWinEvaluator();
}
