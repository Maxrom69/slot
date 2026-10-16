/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B05 — FIXED PAYLINE ENGINE
 *
 * Consumes the authoritative Board produced by B04 and determines which
 * fixed paylines contain contiguous left-to-right matching symbol runs
 * starting at reel 0.
 *
 * STRICT ARCHITECTURAL BOUNDARY (B05):
 * - Consumes Board + PaylineDefinition[] (or GameConfig.paylines)
 * - Evaluates enabled fixed paylines left-to-right starting at reelIndex = 0
 * - Stops at the first incompatible symbol on each payline
 * - Produces at most one contiguous match result per enabled payline
 * - Uses exact symbol matching by default via SymbolMatchPolicy (extension point for B07)
 * - NEVER reconstructs the board from reel strips
 * - NEVER consumes RNG or calls Math.random()
 * - NEVER evaluates paytable payouts or money/credit values (reserved for B06)
 * - NEVER implements Wild substitution (reserved for B07)
 * - NEVER implements Scatter counting (reserved for B08)
 * - NEVER mutates Board, GameConfig, or PaylineDefinition inputs
 */

import type { Board, Cell, Position, VisibleSymbol } from "../board";
import type {
  GameConfig,
  NormalizedPayline,
  PaylineId,
  SymbolId,
} from "../config";
import { isGameConfig } from "../config";
import {
  InvalidBoardError,
  InvalidPaylineError,
  InvalidRowIndexError,
  MissingPaylineError,
  PaylineGridMismatchError,
} from "../errors";
import type { PaylineDefinition } from "../schema";

/* -------------------------------------------------------------------------- */
/* 1. SYMBOL MATCH POLICY (EXTENSION POINT FOR B07 WILD LOGIC)                */
/* -------------------------------------------------------------------------- */

/**
 * Extension point for symbol compatibility along a fixed payline.
 *
 * In B05, the default policy is `EXACT_SYMBOL_MATCH_POLICY` (`baseSymbolId === candidateSymbolId`).
 * B07 can later provide a Wild-aware policy without rewriting PaylineEngine.
 */
export interface SymbolMatchPolicy {
  readonly id: string;
  /**
   * Returns true if `candidateSymbolId` at `reelIndex` continues the contiguous
   * starting run for `baseSymbolId` (originating at reel 0).
   */
  matches(
    baseSymbolId: SymbolId,
    candidateSymbolId: SymbolId,
    reelIndex: number,
  ): boolean;
}

/**
 * Default B05 exact symbol matching policy.
 * Symbol A matches Symbol A only; Wild and Scatter receive no special treatment.
 */
export const EXACT_SYMBOL_MATCH_POLICY: SymbolMatchPolicy = Object.freeze({
  id: "exact",
  matches(baseSymbolId: SymbolId, candidateSymbolId: SymbolId): boolean {
    return baseSymbolId === candidateSymbolId;
  },
});

/* -------------------------------------------------------------------------- */
/* 2. PAYLINE INPUT & RESULT CONTRACTS                                        */
/* -------------------------------------------------------------------------- */

/**
 * Payline input accepted by B05. Compatible with both canonical B02
 * `PaylineDefinition` (`enabled`) and normalized B01 `NormalizedPayline` (`enabled` / `active`).
 */
export interface PaylineInput {
  readonly id: PaylineId;
  readonly index: number;
  readonly name?: string;
  readonly pattern: readonly number[];
  readonly enabled?: boolean;
  readonly active?: boolean;
  readonly color?: string;
}

/**
 * Matched board cell coordinate and symbol reference along a fixed payline.
 * Preserves enough information for frontend path highlighting without UI coordinates
 * or embedded full SymbolDefinition objects.
 */
export interface PaylineCellPosition {
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly symbolId: SymbolId;
  readonly stopIndex?: number;
}

/**
 * Serializable evaluation result for a single fixed payline.
 * Contains contiguous left-to-right match data starting at reel 0.
 * Intentionally excludes any payout or multiplier amounts (handled by B06).
 */
export interface PaylineMatch {
  readonly paylineId: PaylineId;
  readonly paylineIndex: number;
  readonly paylineName: string;
  readonly pattern: readonly number[];
  readonly color?: string;
  readonly symbolId: SymbolId;
  readonly baseSymbolId: SymbolId;
  readonly matchCount: number;
  readonly reelIndexes: readonly number[];
  readonly matchedReels: readonly number[];
  readonly cellPositions: readonly PaylineCellPosition[];
  readonly matchedStopIndexes: readonly number[];
}

/**
 * Aggregate serializable result of evaluating fixed paylines across a Board.
 * Intentionally excludes any payout or credit totals (handled by B06).
 */
export interface PaylineEvaluationResult {
  readonly matches: readonly PaylineMatch[];
  readonly evaluatedPaylineCount: number;
  readonly totalPaylineCount: number;
  readonly disabledPaylineCount: number;
  readonly winningPaylines: readonly PaylineId[];
  readonly totalMatchedLines: number;
}

export interface PaylineEvaluationOptions {
  /**
   * Symbol matching policy. Defaults to `EXACT_SYMBOL_MATCH_POLICY` in B05.
   */
  readonly matchPolicy?: SymbolMatchPolicy;
  /**
   * Optional minimum contiguous match count filter.
   * Defaults to `1` so B05 reports the actual contiguous run length from reel 0
   * without deciding whether a match count is payable (which belongs to B06).
   */
  readonly minMatchCount?: number;
}

export interface PaylineEngine {
  evaluate(
    board: Board,
    paylinesOrConfig:
      | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
      | GameConfig,
    options?: PaylineEvaluationOptions,
  ): PaylineEvaluationResult;

  evaluatePayline(
    board: Board,
    payline: PaylineDefinition | NormalizedPayline | PaylineInput,
    options?: PaylineEvaluationOptions,
  ): PaylineMatch | null;

  validate(
    board: Board,
    paylinesOrConfig:
      | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
      | GameConfig,
  ): void;
}

/* -------------------------------------------------------------------------- */
/* 3. VALIDATION (BOARD & PAYLINES)                                           */
/* -------------------------------------------------------------------------- */

function getBoardReelCount(board: Board): number {
  if (typeof board.reelCount === "number" && Number.isInteger(board.reelCount)) {
    return board.reelCount;
  }
  if (typeof board.columns === "number" && Number.isInteger(board.columns)) {
    return board.columns;
  }
  return -1;
}

/**
 * Validates that `board` is a well-formed B04 Board with at least 1 reel
 * and valid column-major cells (`board.cells[reelIndex][rowIndex]`).
 */
export function validateBoardForPaylines(board: Board): void {
  if (!board || typeof board !== "object") {
    throw new InvalidBoardError(
      "Payline evaluation requires a valid Board object.",
      { board },
    );
  }

  const reelCount = getBoardReelCount(board);
  if (reelCount < 1) {
    throw new InvalidBoardError(
      `Board must have reelCount >= 1; received ${String(reelCount)}.`,
      { reelCount },
    );
  }

  if (!Array.isArray(board.cells)) {
    throw new InvalidBoardError(
      "Board.cells must be a column-major 2D array of cells.",
      { reelCount },
    );
  }

  if (board.cells.length !== reelCount) {
    throw new InvalidBoardError(
      `Board.cells length (${board.cells.length}) does not match board.reelCount (${reelCount}).`,
      { cellsLength: board.cells.length, reelCount },
    );
  }

  if (
    typeof board.rowCount === "number" &&
    (!Number.isInteger(board.rowCount) || board.rowCount < 1)
  ) {
    throw new InvalidBoardError(
      `Board.rowCount must be a positive integer; received ${String(board.rowCount)}.`,
      { rowCount: board.rowCount },
    );
  }

  for (let reelIndex = 0; reelIndex < reelCount; reelIndex += 1) {
    const column = board.cells[reelIndex];
    if (!Array.isArray(column) || column.length < 1) {
      throw new InvalidBoardError(
        `Board column at reelIndex ${reelIndex} must be a non-empty cell array.`,
        { reelIndex },
      );
    }

    if (
      Array.isArray(board.reelHeights) &&
      board.reelHeights[reelIndex] !== undefined &&
      board.reelHeights[reelIndex] !== column.length
    ) {
      throw new InvalidBoardError(
        `Board column height (${column.length}) at reelIndex ${reelIndex} does not match board.reelHeights[${reelIndex}] (${board.reelHeights[reelIndex]}).`,
        {
          reelIndex,
          columnLength: column.length,
          expectedHeight: board.reelHeights[reelIndex],
        },
      );
    }

    for (let rowIndex = 0; rowIndex < column.length; rowIndex += 1) {
      const cell = column[rowIndex];
      if (!cell || typeof cell !== "object") {
        throw new InvalidBoardError(
          `Board cell at reel ${reelIndex}, row ${rowIndex} is missing or invalid.`,
          { reelIndex, rowIndex },
        );
      }

      const symbolId = cell.symbolId ?? cell.symbol?.symbolId;
      if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
        throw new InvalidBoardError(
          `Board cell at reel ${reelIndex}, row ${rowIndex} has a missing or empty symbolId.`,
          { reelIndex, rowIndex, symbolId },
        );
      }
    }
  }
}

function resolvePaylineEnabledState(payline: PaylineInput): boolean {
  const hasEnabled = "enabled" in payline && payline.enabled !== undefined;
  const hasActive = "active" in payline && payline.active !== undefined;

  if (hasEnabled) {
    if (typeof payline.enabled !== "boolean") {
      throw new InvalidPaylineError(
        `Payline "${String(payline.id)}" has an invalid enabled state: expected boolean, received ${typeof payline.enabled}.`,
        { paylineId: payline.id, enabled: payline.enabled },
      );
    }
    return payline.enabled;
  }

  if (hasActive) {
    if (typeof payline.active !== "boolean") {
      throw new InvalidPaylineError(
        `Payline "${String(payline.id)}" has an invalid active state: expected boolean, received ${typeof payline.active}.`,
        { paylineId: payline.id, active: payline.active },
      );
    }
    return payline.active;
  }

  throw new InvalidPaylineError(
    `Payline "${String(payline.id)}" is missing a boolean enabled state.`,
    { paylineId: payline.id },
  );
}

/**
 * Validates a single payline definition against `board` dimensions and row bounds.
 */
export function validatePaylineForBoard(
  board: Board,
  payline: PaylineInput,
): void {
  if (!payline || typeof payline !== "object") {
    throw new MissingPaylineError(
      "Payline definition is missing or not an object.",
      { payline },
    );
  }

  if (typeof payline.id !== "string" || payline.id.trim().length === 0) {
    throw new MissingPaylineError(
      "Payline definition is missing a non-empty id.",
      { paylineIndex: payline.index, id: payline.id },
    );
  }

  if (
    typeof payline.index !== "number" ||
    !Number.isInteger(payline.index) ||
    payline.index < 0
  ) {
    throw new InvalidPaylineError(
      `Payline "${payline.id}" has an invalid index (${String(payline.index)}); expected a non-negative integer.`,
      { paylineId: payline.id, index: payline.index },
    );
  }

  // Validate enabled/active boolean state
  resolvePaylineEnabledState(payline);

  if (!Array.isArray(payline.pattern)) {
    throw new InvalidPaylineError(
      `Payline "${payline.id}" pattern must be an array of row indexes.`,
      { paylineId: payline.id, pattern: payline.pattern },
    );
  }

  const reelCount = getBoardReelCount(board);
  if (payline.pattern.length !== reelCount) {
    throw new PaylineGridMismatchError(
      `Payline "${payline.id}" pattern length (${payline.pattern.length}) does not match board reelCount (${reelCount}).`,
      {
        paylineId: payline.id,
        patternLength: payline.pattern.length,
        reelCount,
      },
    );
  }

  for (let reelIndex = 0; reelIndex < reelCount; reelIndex += 1) {
    const rowIndex = payline.pattern[reelIndex];
    const reelColumn = board.cells[reelIndex];
    const maxRowsForReel = reelColumn.length;

    if (
      typeof rowIndex !== "number" ||
      !Number.isInteger(rowIndex) ||
      rowIndex < 0 ||
      rowIndex >= maxRowsForReel
    ) {
      throw new InvalidRowIndexError(
        `Payline "${payline.id}" has out-of-bounds row index ${String(rowIndex)} at reel ${reelIndex} (valid range: 0..${maxRowsForReel - 1}).`,
        {
          paylineId: payline.id,
          reelIndex,
          rowIndex,
          rowCount: maxRowsForReel,
        },
      );
    }
  }
}

/**
 * Validates an array of payline definitions against `board`, including
 * duplicate payline ID detection.
 */
export function validatePaylinesForBoard(
  board: Board,
  paylines: readonly PaylineInput[],
): void {
  validateBoardForPaylines(board);

  if (!Array.isArray(paylines)) {
    throw new MissingPaylineError(
      "Paylines collection is missing or not an array.",
      { paylines },
    );
  }

  const seenIds = new Set<string>();
  for (let i = 0; i < paylines.length; i += 1) {
    const payline = paylines[i];
    validatePaylineForBoard(board, payline);

    if (seenIds.has(payline.id)) {
      throw new InvalidPaylineError(
        `Duplicate payline id "${payline.id}" detected at index ${i}.`,
        { paylineId: payline.id, duplicateArrayIndex: i },
      );
    }
    seenIds.add(payline.id);
  }
}

/* -------------------------------------------------------------------------- */
/* 4. CORE LEFT-TO-RIGHT PAYLINE EVALUATION                                   */
/* -------------------------------------------------------------------------- */

function buildCellPosition(
  reelIndex: number,
  rowIndex: number,
  cell: Cell,
): PaylineCellPosition {
  const symbolId = cell.symbolId ?? cell.symbol.symbolId;
  const stopIdx =
    typeof cell.stopIndex === "number" && Number.isInteger(cell.stopIndex)
      ? cell.stopIndex
      : undefined;

  return Object.freeze({
    reelIndex,
    rowIndex,
    symbolId,
    ...(stopIdx !== undefined ? { stopIndex: stopIdx } : {}),
  });
}

function evaluateValidatedPayline(
  board: Board,
  payline: PaylineInput,
  matchPolicy: SymbolMatchPolicy,
  minMatchCount: number,
): PaylineMatch | null {
  const isEnabled = resolvePaylineEnabledState(payline);
  if (!isEnabled) {
    return null;
  }

  const reelCount = getBoardReelCount(board);

  // Step 1 & 2: Read configured row for reel 0 and its corresponding board cell.
  const row0 = payline.pattern[0];
  const cell0 = board.cells[0][row0];
  const baseSymbolId = cell0.symbolId ?? cell0.symbol.symbolId;

  const reelIndexes: number[] = [0];
  const cellPositions: PaylineCellPosition[] = [
    buildCellPosition(0, row0, cell0),
  ];
  const matchedStopIndexes: number[] =
    typeof cell0.stopIndex === "number" && Number.isInteger(cell0.stopIndex)
      ? [cell0.stopIndex]
      : [];

  // Step 4–6: Continue across adjacent reels 1..reelCount-1; stop at first mismatch.
  for (let reelIndex = 1; reelIndex < reelCount; reelIndex += 1) {
    const rowIndex = payline.pattern[reelIndex];
    const cell = board.cells[reelIndex][rowIndex];
    const candidateSymbolId = cell.symbolId ?? cell.symbol.symbolId;

    const isCompatible = matchPolicy.matches(
      baseSymbolId,
      candidateSymbolId,
      reelIndex,
    );

    if (!isCompatible) {
      break;
    }

    reelIndexes.push(reelIndex);
    cellPositions.push(buildCellPosition(reelIndex, rowIndex, cell));
    if (typeof cell.stopIndex === "number" && Number.isInteger(cell.stopIndex)) {
      matchedStopIndexes.push(cell.stopIndex);
    }
  }

  const matchCount = reelIndexes.length;
  if (matchCount < minMatchCount) {
    return null;
  }

  const frozenReelIndexes = Object.freeze(reelIndexes);

  return Object.freeze({
    paylineId: payline.id,
    paylineIndex: payline.index,
    paylineName:
      typeof payline.name === "string" && payline.name.trim().length > 0
        ? payline.name
        : `Line ${payline.index}`,
    pattern: Object.freeze([...payline.pattern]),
    ...(typeof payline.color === "string" && payline.color.trim().length > 0
      ? { color: payline.color }
      : {}),
    symbolId: baseSymbolId,
    baseSymbolId,
    matchCount,
    reelIndexes: frozenReelIndexes,
    matchedReels: frozenReelIndexes,
    cellPositions: Object.freeze(cellPositions),
    matchedStopIndexes: Object.freeze(matchedStopIndexes),
  });
}

function resolveOptions(options?: PaylineEvaluationOptions): {
  readonly matchPolicy: SymbolMatchPolicy;
  readonly minMatchCount: number;
} {
  const matchPolicy = options?.matchPolicy ?? EXACT_SYMBOL_MATCH_POLICY;
  const minMatchCount = options?.minMatchCount ?? 1;

  if (
    typeof minMatchCount !== "number" ||
    !Number.isInteger(minMatchCount) ||
    minMatchCount < 1
  ) {
    throw new InvalidPaylineError(
      `Invalid minMatchCount (${String(minMatchCount)}); expected an integer >= 1.`,
      { minMatchCount },
    );
  }

  return { matchPolicy, minMatchCount };
}

function extractPaylinesList(
  paylinesOrConfig:
    | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
    | GameConfig,
): readonly PaylineInput[] {
  if (Array.isArray(paylinesOrConfig)) {
    return paylinesOrConfig;
  }
  if (
    paylinesOrConfig &&
    typeof paylinesOrConfig === "object" &&
    isGameConfig(paylinesOrConfig as GameConfig)
  ) {
    return (paylinesOrConfig as GameConfig).paylines;
  }
  throw new MissingPaylineError(
    "Expected an array of PaylineDefinition items or a normalized GameConfig.",
    { paylinesOrConfig },
  );
}

/**
 * Evaluates a single fixed payline left-to-right starting at reel 0.
 * Returns `null` if the payline is disabled (or if its matchCount is below
 * an explicitly configured `options.minMatchCount`).
 */
export function evaluatePayline(
  board: Board,
  payline: PaylineDefinition | NormalizedPayline | PaylineInput,
  options?: PaylineEvaluationOptions,
): PaylineMatch | null {
  validateBoardForPaylines(board);
  validatePaylineForBoard(board, payline);
  const { matchPolicy, minMatchCount } = resolveOptions(options);
  return evaluateValidatedPayline(board, payline, matchPolicy, minMatchCount);
}

/**
 * Evaluates all enabled fixed paylines independently against `board`.
 * Disabled paylines are skipped and produce no results.
 */
export function evaluatePaylines(
  board: Board,
  paylinesOrConfig:
    | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
    | GameConfig,
  options?: PaylineEvaluationOptions,
): PaylineEvaluationResult {
  const paylines = extractPaylinesList(paylinesOrConfig);
  validatePaylinesForBoard(board, paylines);
  const { matchPolicy, minMatchCount } = resolveOptions(options);

  const matches: PaylineMatch[] = [];
  let evaluatedPaylineCount = 0;
  let disabledPaylineCount = 0;

  for (let i = 0; i < paylines.length; i += 1) {
    const payline = paylines[i];
    const isEnabled = resolvePaylineEnabledState(payline);
    if (!isEnabled) {
      disabledPaylineCount += 1;
      continue;
    }

    evaluatedPaylineCount += 1;
    const match = evaluateValidatedPayline(
      board,
      payline,
      matchPolicy,
      minMatchCount,
    );
    if (match) {
      matches.push(match);
    }
  }

  const winningPaylines = Object.freeze(matches.map((m) => m.paylineId));

  return Object.freeze({
    matches: Object.freeze(matches),
    evaluatedPaylineCount,
    totalPaylineCount: paylines.length,
    disabledPaylineCount,
    winningPaylines,
    totalMatchedLines: matches.length,
  });
}

/* -------------------------------------------------------------------------- */
/* 5. FIXED PAYLINE ENGINE CLASS & FACTORY                                    */
/* -------------------------------------------------------------------------- */

export class FixedPaylineEngine implements PaylineEngine {
  private readonly defaultOptions?: PaylineEvaluationOptions;

  constructor(defaultOptions?: PaylineEvaluationOptions) {
    this.defaultOptions = defaultOptions
      ? Object.freeze({ ...defaultOptions })
      : undefined;
  }

  public validate(
    board: Board,
    paylinesOrConfig:
      | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
      | GameConfig,
  ): void {
    const paylines = extractPaylinesList(paylinesOrConfig);
    validatePaylinesForBoard(board, paylines);
  }

  public evaluatePayline(
    board: Board,
    payline: PaylineDefinition | NormalizedPayline | PaylineInput,
    options?: PaylineEvaluationOptions,
  ): PaylineMatch | null {
    return evaluatePayline(board, payline, options ?? this.defaultOptions);
  }

  public evaluate(
    board: Board,
    paylinesOrConfig:
      | readonly (PaylineDefinition | NormalizedPayline | PaylineInput)[]
      | GameConfig,
    options?: PaylineEvaluationOptions,
  ): PaylineEvaluationResult {
    return evaluatePaylines(
      board,
      paylinesOrConfig,
      options ?? this.defaultOptions,
    );
  }
}

export function createPaylineEngine(
  defaultOptions?: PaylineEvaluationOptions,
): PaylineEngine {
  return new FixedPaylineEngine(defaultOptions);
}

/* -------------------------------------------------------------------------- */
/* 6. SERIALIZATION & DESERIALIZATION                                         */
/* -------------------------------------------------------------------------- */

export function serializePaylineEvaluationResult(
  result: PaylineEvaluationResult,
): string {
  return JSON.stringify(result);
}

export function deserializePaylineEvaluationResult(
  json: string,
): PaylineEvaluationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new InvalidPaylineError(
      `Failed to parse PaylineEvaluationResult JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new InvalidPaylineError(
      "Deserialized PaylineEvaluationResult must be a non-null object.",
    );
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    !Array.isArray(candidate.matches) ||
    typeof candidate.evaluatedPaylineCount !== "number" ||
    !Number.isInteger(candidate.evaluatedPaylineCount) ||
    candidate.evaluatedPaylineCount < 0
  ) {
    throw new InvalidPaylineError(
      "Deserialized PaylineEvaluationResult is missing valid matches or evaluatedPaylineCount.",
    );
  }

  const matches: PaylineMatch[] = candidate.matches.map((rawMatch, idx) => {
    if (!rawMatch || typeof rawMatch !== "object") {
      throw new InvalidPaylineError(
        `Invalid PaylineMatch at index ${idx} in serialized result.`,
      );
    }
    const m = rawMatch as Record<string, unknown>;
    if (
      typeof m.paylineId !== "string" ||
      typeof m.paylineIndex !== "number" ||
      typeof m.symbolId !== "string" ||
      typeof m.matchCount !== "number" ||
      !Array.isArray(m.reelIndexes) ||
      !Array.isArray(m.cellPositions)
    ) {
      throw new InvalidPaylineError(
        `Malformed PaylineMatch fields at index ${idx} in serialized result.`,
      );
    }

    const frozenReels = Object.freeze(
      (m.reelIndexes as number[]).map((r) => Number(r)),
    );
    const frozenPositions: PaylineCellPosition[] = (
      m.cellPositions as Array<Record<string, unknown>>
    ).map((cp) =>
      Object.freeze({
        reelIndex: Number(cp.reelIndex),
        rowIndex: Number(cp.rowIndex),
        symbolId: String(cp.symbolId),
        ...(typeof cp.stopIndex === "number"
          ? { stopIndex: cp.stopIndex }
          : {}),
      }),
    );
    const frozenStops = Array.isArray(m.matchedStopIndexes)
      ? Object.freeze((m.matchedStopIndexes as number[]).map((s) => Number(s)))
      : Object.freeze([]);
    const frozenPattern = Array.isArray(m.pattern)
      ? Object.freeze((m.pattern as number[]).map((p) => Number(p)))
      : Object.freeze([]);

    return Object.freeze({
      paylineId: m.paylineId,
      paylineIndex: m.paylineIndex,
      paylineName:
        typeof m.paylineName === "string"
          ? m.paylineName
          : `Line ${m.paylineIndex}`,
      pattern: frozenPattern,
      ...(typeof m.color === "string" ? { color: m.color } : {}),
      symbolId: m.symbolId,
      baseSymbolId:
        typeof m.baseSymbolId === "string" ? m.baseSymbolId : m.symbolId,
      matchCount: m.matchCount,
      reelIndexes: frozenReels,
      matchedReels: frozenReels,
      cellPositions: Object.freeze(frozenPositions),
      matchedStopIndexes: frozenStops,
    });
  });

  const winningPaylines = Array.isArray(candidate.winningPaylines)
    ? Object.freeze(candidate.winningPaylines.map((id) => String(id)))
    : Object.freeze(matches.map((m) => m.paylineId));

  const totalPaylineCount =
    typeof candidate.totalPaylineCount === "number"
      ? candidate.totalPaylineCount
      : candidate.evaluatedPaylineCount;
  const disabledPaylineCount =
    typeof candidate.disabledPaylineCount === "number"
      ? candidate.disabledPaylineCount
      : Math.max(0, totalPaylineCount - candidate.evaluatedPaylineCount);

  return Object.freeze({
    matches: Object.freeze(matches),
    evaluatedPaylineCount: candidate.evaluatedPaylineCount,
    totalPaylineCount,
    disabledPaylineCount,
    winningPaylines,
    totalMatchedLines: matches.length,
  });
}

/* -------------------------------------------------------------------------- */
/* 7. DETERMINISTIC BOARD FIXTURE BUILDER                                     */
/* -------------------------------------------------------------------------- */

/**
 * Constructs an immutable B04-compatible `Board` directly from column-major
 * symbol ID arrays (`columns[reelIndex][rowIndex]`).
 *
 * Useful for deterministic unit test fixtures (e.g., `Reel 0: ["A", "K", "Q"]`)
 * while preserving full B04 Board/Cell structural fidelity.
 */
export function createBoardFromSymbolGrid(
  columns: readonly (readonly SymbolId[])[],
  options?: { readonly stopIndexOffset?: number },
): Board {
  if (!Array.isArray(columns) || columns.length < 1) {
    throw new InvalidBoardError(
      "createBoardFromSymbolGrid requires a non-empty array of reel columns.",
    );
  }

  const stopOffset = options?.stopIndexOffset ?? 0;
  const reelCount = columns.length;
  const reelHeights: number[] = [];
  const cells: (readonly Cell[])[] = [];

  for (let reelIndex = 0; reelIndex < reelCount; reelIndex += 1) {
    const colSymbols = columns[reelIndex];
    if (!Array.isArray(colSymbols) || colSymbols.length < 1) {
      throw new InvalidBoardError(
        `Reel column ${reelIndex} in createBoardFromSymbolGrid must be non-empty.`,
        { reelIndex },
      );
    }

    reelHeights.push(colSymbols.length);
    const colCells: Cell[] = [];

    for (let rowIndex = 0; rowIndex < colSymbols.length; rowIndex += 1) {
      const symbolId = colSymbols[rowIndex];
      if (typeof symbolId !== "string" || symbolId.trim().length === 0) {
        throw new InvalidBoardError(
          `Symbol ID at reel ${reelIndex}, row ${rowIndex} must be a non-empty string.`,
          { reelIndex, rowIndex, symbolId },
        );
      }

      const stopIndex = stopOffset + rowIndex;
      const position: Position = Object.freeze({ reelIndex, rowIndex });
      const visibleSymbol: VisibleSymbol = Object.freeze({
        symbolId,
        code: symbolId,
        name: symbolId,
        tier: "low",
        isWild: symbolId.toUpperCase().includes("WILD"),
        isScatter: symbolId.toUpperCase().includes("SCAT"),
        isBonus: symbolId.toUpperCase().includes("BONUS"),
        wildMultiplier: 1,
        stopId: `reel-${reelIndex + 1}-stop-${stopIndex + 1}`,
        stripPosition: stopIndex + 1,
      });

      const cell: Cell = Object.freeze({
        position,
        reelIndex,
        rowIndex,
        stopIndex,
        symbolId,
        symbol: visibleSymbol,
        locked: false,
        multiplier: 1,
        mysteryResolvedFrom: null,
        colossalGroupId: null,
      });

      colCells.push(cell);
    }

    cells.push(Object.freeze(colCells));
  }

  const maxRowCount = Math.max(...reelHeights);

  return Object.freeze({
    reelCount,
    rowCount: maxRowCount,
    columns: reelCount,
    rows: maxRowCount,
    reelHeights: Object.freeze(reelHeights),
    cells: Object.freeze(cells),
  });
}
