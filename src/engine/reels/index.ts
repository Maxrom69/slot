/**
 * SECTION 2 — BACKEND SLOT GAME ENGINE
 * B01 / B04 — Reel Engine & Circular Strip Stop Resolution
 *
 * Converts GameConfig.reels + B03 RandomSource + GridConfiguration into
 * deterministic reel stop selections, circular visible stop slices, and the
 * authoritative visible Board.
 *
 * CONVENTIONS:
 * - Circular strip: visibleStopIndexes[r] = (selectedStopIndex + r) % strip.length
 * - selectedStopIndex: represents the TOP visible symbol (rowIndex = 0)
 * - reelIndex: 0 = leftmost reel, reelCount - 1 = rightmost reel
 * - rowIndex: 0 = top visible row, visibleRows - 1 = bottom visible row
 * - Short-reel policy: strip.length < visibleRows is rejected with ShortReelStripError
 * - Weights: attached to physical stops; never reordered, sorted, or collapsed
 * - Zero win/paytable/feature evaluation in B04
 */

import { type Board, DefaultBoardBuilder } from "../board";
import type {
  GameConfig,
  NormalizedReelStop,
  NormalizedReelStrip,
  ReelId,
  SymbolId,
} from "../config";
import {
  EmptyReelError,
  InvalidReelCountError,
  InvalidReelResolutionError,
  InvalidReelWeightError,
  InvalidStopIndexError,
  InvalidVisibleRowCountError,
  ShortReelStripError,
  UnknownSymbolReferenceError,
  ZeroWeightReelError,
} from "../errors";
import type {
  RandomNumberGenerator,
  RandomSource,
  WeightedItem,
} from "../rng";

export type Reel = NormalizedReelStrip;
export type ReelStrip = NormalizedReelStrip;
export type ReelStop = NormalizedReelStop;

export interface ResolvedReelWindow {
  readonly reelId: ReelId;
  readonly reelIndex: number;
  readonly selectedStopIndex: number;
  readonly initialSelectedStopIndex: number;
  readonly nudgeOffset: number;
  readonly stopIndex: number;
  readonly stopPosition: number;
  readonly visibleRows: number;
  readonly visibleHeight: number;
  readonly visibleStopIndexes: readonly number[];
  readonly visibleStops: readonly NormalizedReelStop[];
  readonly visibleSymbolIds: readonly SymbolId[];
  readonly totalStops: number;
  readonly usedWeights: boolean;
  readonly rngStream: string | null;
  readonly drawCount: number;
}

export type SingleReelResult = ResolvedReelWindow;

export interface ReelDebugTraceEntry {
  readonly reelId: ReelId;
  readonly reelIndex: number;
  readonly mode: "random" | "explicit";
  readonly rngStream: string | null;
  readonly usedWeights: boolean;
  readonly totalStops: number;
  readonly visibleRows: number;
  readonly selectedStopIndex: number;
  readonly visibleStopIndexes: readonly number[];
  readonly visibleSymbolIds: readonly SymbolId[];
  readonly drawsConsumed: number;
}

export interface ReelResult {
  readonly stopIndexes: readonly number[];
  readonly stopPositions: readonly number[];
  readonly reelWindows: readonly ResolvedReelWindow[];
}

export interface ReelResolution extends ReelResult {
  readonly mode: "random" | "explicit";
  readonly reels: readonly SingleReelResult[];
  readonly board: Board;
  readonly selectedStopIndexes: readonly number[];
  readonly stopIndexes: readonly number[];
  readonly stopPositions: readonly number[];
  readonly reelWindows: readonly SingleReelResult[];
  readonly trace?: readonly ReelDebugTraceEntry[];
}

export interface ResolveSingleReelOptions {
  readonly visibleRows: number;
  readonly useWeights?: boolean;
  readonly rng?: RandomSource;
  readonly selectedStopIndex?: number;
  readonly validSymbolIds?: ReadonlySet<SymbolId>;
}

export interface ReelResolveOptions {
  readonly visibleRowCounts?: readonly number[];
  readonly trace?: boolean;
}

export interface ReelResolutionContext {
  readonly roundId: string;
  readonly reelHeights?: readonly number[];
  readonly linkedReels?: ReadonlyArray<readonly number[]>;
  readonly forcedStopIndexes?: readonly number[];
  readonly trace?: boolean;
}

export interface ReelResolver {
  resolveReels(
    config: GameConfig,
    rng: RandomNumberGenerator,
    context: ReelResolutionContext,
  ): ReelResult;
}

export interface ReelEngine extends ReelResolver {
  resolve(
    config: GameConfig,
    rng: RandomSource,
    options?: ReelResolveOptions,
  ): ReelResolution;

  resolveFromStops(
    config: GameConfig,
    stopIndexes: readonly number[],
    options?: ReelResolveOptions,
  ): ReelResolution;

  resolveReel(
    reel: NormalizedReelStrip,
    options: ResolveSingleReelOptions,
  ): SingleReelResult;
}

/**
 * Resolves a single physical circular reel strip into an immutable SingleReelResult.
 * Supports both Random Mode (using B03 RandomSource) and Explicit Stop Mode.
 */
export function resolveSingleReel(
  reel: NormalizedReelStrip,
  options: ResolveSingleReelOptions,
): SingleReelResult {
  if (!reel || typeof reel !== "object" || !Array.isArray(reel.stops)) {
    throw new InvalidReelResolutionError(
      "resolveReel requires a valid NormalizedReelStrip with a stops array.",
      { reel },
    );
  }
  if (
    typeof reel.index !== "number" ||
    !Number.isInteger(reel.index) ||
    reel.index < 0
  ) {
    throw new InvalidReelResolutionError(
      `Reel "${String(reel.id)}" has an invalid non-negative integer index: ${String(reel.index)}.`,
      { reelId: reel.id, reelIndex: reel.index },
    );
  }

  const stopCount = reel.stops.length;
  if (stopCount === 0) {
    throw new EmptyReelError(
      `Reel "${reel.id}" at index ${reel.index} must contain at least one stop.`,
      { reelId: reel.id, reelIndex: reel.index },
    );
  }

  if (!options || typeof options !== "object") {
    throw new InvalidReelResolutionError(
      "resolveReel requires an options object with visibleRows.",
      { reelId: reel.id },
    );
  }

  const visibleRows = options.visibleRows;
  if (
    typeof visibleRows !== "number" ||
    !Number.isInteger(visibleRows) ||
    visibleRows <= 0
  ) {
    throw new InvalidVisibleRowCountError(
      `Reel "${reel.id}" visibleRows must be a positive integer, received ${String(visibleRows)}.`,
      { reelId: reel.id, reelIndex: reel.index, visibleRows },
    );
  }

  if (stopCount < visibleRows) {
    throw new ShortReelStripError(
      `Reel "${reel.id}" at index ${reel.index} has ${stopCount} stops, which is fewer than visibleRows (${visibleRows}).`,
      {
        reelId: reel.id,
        reelIndex: reel.index,
        stopCount,
        visibleRows,
      },
    );
  }

  const validSymbols = options.validSymbolIds;
  for (let i = 0; i < stopCount; i += 1) {
    const stop = reel.stops[i];
    if (
      !stop ||
      typeof stop.symbolId !== "string" ||
      stop.symbolId.trim().length === 0
    ) {
      throw new UnknownSymbolReferenceError(
        `Reel "${reel.id}" stop at index ${i} is missing a valid symbolId.`,
        { reelId: reel.id, reelIndex: reel.index, stopIndex: i },
      );
    }
    if (validSymbols && !validSymbols.has(stop.symbolId)) {
      throw new UnknownSymbolReferenceError(
        `Reel "${reel.id}" stop at index ${i} references unknown symbol "${stop.symbolId}".`,
        {
          reelId: reel.id,
          reelIndex: reel.index,
          stopIndex: i,
          symbolId: stop.symbolId,
        },
      );
    }
  }

  const useWeights = Boolean(options.useWeights);
  let chosenStopIndex: number;
  let rngStream: string | null = null;
  let drawsConsumed = 0;

  if (options.selectedStopIndex !== undefined) {
    const explicitIdx = options.selectedStopIndex;
    if (
      typeof explicitIdx !== "number" ||
      !Number.isInteger(explicitIdx) ||
      explicitIdx < 0 ||
      explicitIdx >= stopCount
    ) {
      throw new InvalidStopIndexError(
        `Explicit stop index ${String(explicitIdx)} on reel "${reel.id}" (index ${reel.index}) is out of bounds [0, ${stopCount - 1}].`,
        {
          reelId: reel.id,
          reelIndex: reel.index,
          selectedStopIndex: explicitIdx,
          stopCount,
        },
      );
    }
    chosenStopIndex = explicitIdx;
  } else {
    const rng = options.rng;
    if (
      !rng ||
      typeof rng !== "object" ||
      typeof rng.nextInt !== "function" ||
      typeof rng.weightedPick !== "function"
    ) {
      throw new InvalidReelResolutionError(
        `Random reel resolution on reel "${reel.id}" requires a valid B03 RandomSource.`,
        { reelId: reel.id, reelIndex: reel.index },
      );
    }

    rngStream = rng.streamNamespace ?? null;
    const drawBefore =
      typeof rng.getDrawCount === "function" ? rng.getDrawCount() : 0;

    if (useWeights) {
      const weightedStops: WeightedItem<number>[] = new Array(stopCount);
      let totalWeight = 0;

      for (let i = 0; i < stopCount; i += 1) {
        const w = reel.stops[i].weight;
        if (typeof w !== "number" || Number.isNaN(w) || !Number.isFinite(w) || w < 0) {
          throw new InvalidReelWeightError(
            `Reel "${reel.id}" stop ${i} has invalid weight ${String(w)} (must be finite and >= 0).`,
            {
              reelId: reel.id,
              reelIndex: reel.index,
              stopIndex: i,
              weight: w,
            },
          );
        }
        totalWeight += w;
        if (!Number.isFinite(totalWeight)) {
          throw new InvalidReelWeightError(
            `Reel "${reel.id}" cumulative stop weight overflowed to Infinity at stop ${i}.`,
            { reelId: reel.id, reelIndex: reel.index, stopIndex: i },
          );
        }
        weightedStops[i] = { value: i, weight: w };
      }

      if (totalWeight <= 0) {
        throw new ZeroWeightReelError(
          `Reel "${reel.id}" at index ${reel.index} has total stop weight 0; at least one stop must have weight > 0.`,
          { reelId: reel.id, reelIndex: reel.index, totalWeight },
        );
      }

      chosenStopIndex = rng.weightedPick(weightedStops);
    } else {
      chosenStopIndex = rng.nextInt(0, stopCount);
    }

    const drawAfter =
      typeof rng.getDrawCount === "function" ? rng.getDrawCount() : drawBefore + 1;
    drawsConsumed = drawAfter - drawBefore;
  }

  const visibleStopIndexes: number[] = new Array<number>(visibleRows);
  const visibleStops: NormalizedReelStop[] = new Array<NormalizedReelStop>(
    visibleRows,
  );
  const visibleSymbolIds: SymbolId[] = new Array<SymbolId>(visibleRows);

  for (let rowOffset = 0; rowOffset < visibleRows; rowOffset += 1) {
    const wrappedStopIndex = (chosenStopIndex + rowOffset) % stopCount;
    const stop = reel.stops[wrappedStopIndex];
    visibleStopIndexes[rowOffset] = wrappedStopIndex;
    visibleStops[rowOffset] = stop;
    visibleSymbolIds[rowOffset] = stop.symbolId;
  }

  const topStop = reel.stops[chosenStopIndex];

  return Object.freeze({
    reelId: reel.id,
    reelIndex: reel.index,
    selectedStopIndex: chosenStopIndex,
    initialSelectedStopIndex: chosenStopIndex,
    nudgeOffset: 0,
    stopIndex: chosenStopIndex,
    stopPosition: topStop.position ?? chosenStopIndex + 1,
    visibleRows,
    visibleHeight: visibleRows,
    visibleStopIndexes: Object.freeze(visibleStopIndexes),
    visibleStops: Object.freeze(visibleStops),
    visibleSymbolIds: Object.freeze(visibleSymbolIds),
    totalStops: stopCount,
    usedWeights: useWeights,
    rngStream,
    drawCount: drawsConsumed,
  });
}

function validateConfigForReelEngine(
  config: GameConfig,
  options?: ReelResolveOptions,
): {
  readonly reelCount: number;
  readonly perReelRowCounts: readonly number[];
  readonly validSymbolIds: ReadonlySet<SymbolId>;
} {
  if (
    !config ||
    typeof config !== "object" ||
    !config.grid ||
    !Array.isArray(config.reels)
  ) {
    throw new InvalidReelResolutionError(
      "ReelEngine requires a valid normalized GameConfig.",
      { config },
    );
  }

  const reelCount = config.grid.columns;
  if (!Number.isInteger(reelCount) || reelCount <= 0) {
    throw new InvalidReelCountError(
      `GameConfig grid.columns must be a positive integer, received ${String(reelCount)}.`,
      { columns: reelCount },
    );
  }

  if (config.reels.length !== reelCount) {
    throw new InvalidReelCountError(
      `Reel count mismatch: grid specifies ${reelCount} reels, but GameConfig.reels has ${config.reels.length}.`,
      { expected: reelCount, actual: config.reels.length },
    );
  }

  const customHeights = options?.visibleRowCounts;
  if (customHeights !== undefined) {
    if (!Array.isArray(customHeights) || customHeights.length !== reelCount) {
      throw new InvalidVisibleRowCountError(
        `visibleRowCounts must have length ${reelCount} matching reelCount, received ${Array.isArray(customHeights) ? customHeights.length : "non-array"}.`,
        { expectedLength: reelCount },
      );
    }
  }

  const perReelRowCounts: number[] = new Array<number>(reelCount);
  for (let i = 0; i < reelCount; i += 1) {
    const reel = config.reels[i];
    if (!reel || reel.index !== i) {
      throw new InvalidReelResolutionError(
        `Reel at position ${i} has mismatched reel.index ${String(reel?.index)}.`,
        { expectedIndex: i, actualIndex: reel?.index },
      );
    }
    const rowCount =
      customHeights?.[i] ??
      config.grid.reelHeights?.[i] ??
      config.grid.rows;
    if (typeof rowCount !== "number" || !Number.isInteger(rowCount) || rowCount <= 0) {
      throw new InvalidVisibleRowCountError(
        `Invalid visible row count ${String(rowCount)} for reel ${i}.`,
        { reelIndex: i, visibleRows: rowCount },
      );
    }
    perReelRowCounts[i] = rowCount;
  }

  const validSymbolIds = new Set<SymbolId>();
  if (config.symbolsById instanceof Map) {
    for (const id of config.symbolsById.keys()) {
      validSymbolIds.add(id);
    }
  }
  if (config.variantsById instanceof Map) {
    for (const id of config.variantsById.keys()) {
      validSymbolIds.add(id);
    }
  }
  for (const sym of config.symbols ?? []) {
    validSymbolIds.add(sym.id);
  }

  return {
    reelCount,
    perReelRowCounts,
    validSymbolIds,
  };
}

export class DeterministicReelResolver implements ReelEngine {
  private readonly boardBuilder = new DefaultBoardBuilder();

  public resolveReel(
    reel: NormalizedReelStrip,
    options: ResolveSingleReelOptions,
  ): SingleReelResult {
    return resolveSingleReel(reel, options);
  }

  public resolve(
    config: GameConfig,
    rng: RandomSource,
    options?: ReelResolveOptions,
  ): ReelResolution {
    const { reelCount, perReelRowCounts, validSymbolIds } =
      validateConfigForReelEngine(config, options);

    if (
      !rng ||
      typeof rng !== "object" ||
      typeof rng.fork !== "function" ||
      typeof rng.nextInt !== "function"
    ) {
      throw new InvalidReelResolutionError(
        "ReelEngine.resolve requires a valid B03 RandomSource.",
      );
    }

    // Derive dedicated domain-separated substream for reels:
    // root -> reels -> reel-0, reel-1, ...
    const reelsStream = rng.fork("reels");

    const reels: SingleReelResult[] = new Array<SingleReelResult>(reelCount);
    const stopIndexes: number[] = new Array<number>(reelCount);
    const stopPositions: number[] = new Array<number>(reelCount);
    const traceEntries: ReelDebugTraceEntry[] | undefined = options?.trace
      ? new Array<ReelDebugTraceEntry>(reelCount)
      : undefined;

    for (let reelIndex = 0; reelIndex < reelCount; reelIndex += 1) {
      const reel = config.reels[reelIndex];
      const reelRng = reelsStream.fork(`reel-${reelIndex}`);

      const resolved = resolveSingleReel(reel, {
        visibleRows: perReelRowCounts[reelIndex],
        useWeights: config.grid.weightsEnabled,
        rng: reelRng,
        validSymbolIds,
      });

      reels[reelIndex] = resolved;
      stopIndexes[reelIndex] = resolved.selectedStopIndex;
      stopPositions[reelIndex] = resolved.stopPosition;

      if (traceEntries) {
        traceEntries[reelIndex] = Object.freeze({
          reelId: resolved.reelId,
          reelIndex: resolved.reelIndex,
          mode: "random",
          rngStream: resolved.rngStream,
          usedWeights: resolved.usedWeights,
          totalStops: resolved.totalStops,
          visibleRows: resolved.visibleRows,
          selectedStopIndex: resolved.selectedStopIndex,
          visibleStopIndexes: resolved.visibleStopIndexes,
          visibleSymbolIds: resolved.visibleSymbolIds,
          drawsConsumed: resolved.drawCount,
        });
      }
    }

    const frozenReels = Object.freeze(reels);
    const frozenStopIndexes = Object.freeze(stopIndexes);
    const frozenStopPositions = Object.freeze(stopPositions);

    const board = this.boardBuilder.buildBoard(config, {
      stopIndexes: frozenStopIndexes,
      stopPositions: frozenStopPositions,
      reelWindows: frozenReels,
    });

    return Object.freeze({
      mode: "random",
      reels: frozenReels,
      board,
      selectedStopIndexes: frozenStopIndexes,
      stopIndexes: frozenStopIndexes,
      stopPositions: frozenStopPositions,
      reelWindows: frozenReels,
      ...(traceEntries ? { trace: Object.freeze(traceEntries) } : {}),
    });
  }

  public resolveFromStops(
    config: GameConfig,
    stopIndexes: readonly number[],
    options?: ReelResolveOptions,
  ): ReelResolution {
    const { reelCount, perReelRowCounts, validSymbolIds } =
      validateConfigForReelEngine(config, options);

    if (!Array.isArray(stopIndexes)) {
      throw new InvalidStopIndexError(
        "resolveFromStops requires an array of explicit stop indexes.",
        { stopIndexes },
      );
    }

    if (stopIndexes.length !== reelCount) {
      throw new InvalidReelCountError(
        `Explicit stopIndexes length (${stopIndexes.length}) must match reelCount (${reelCount}).`,
        { expected: reelCount, actual: stopIndexes.length },
      );
    }

    const reels: SingleReelResult[] = new Array<SingleReelResult>(reelCount);
    const resolvedStopIndexes: number[] = new Array<number>(reelCount);
    const stopPositions: number[] = new Array<number>(reelCount);
    const traceEntries: ReelDebugTraceEntry[] | undefined = options?.trace
      ? new Array<ReelDebugTraceEntry>(reelCount)
      : undefined;

    for (let reelIndex = 0; reelIndex < reelCount; reelIndex += 1) {
      const reel = config.reels[reelIndex];
      const explicitStop = stopIndexes[reelIndex];

      const resolved = resolveSingleReel(reel, {
        visibleRows: perReelRowCounts[reelIndex],
        useWeights: config.grid.weightsEnabled,
        selectedStopIndex: explicitStop,
        validSymbolIds,
      });

      reels[reelIndex] = resolved;
      resolvedStopIndexes[reelIndex] = resolved.selectedStopIndex;
      stopPositions[reelIndex] = resolved.stopPosition;

      if (traceEntries) {
        traceEntries[reelIndex] = Object.freeze({
          reelId: resolved.reelId,
          reelIndex: resolved.reelIndex,
          mode: "explicit",
          rngStream: null,
          usedWeights: resolved.usedWeights,
          totalStops: resolved.totalStops,
          visibleRows: resolved.visibleRows,
          selectedStopIndex: resolved.selectedStopIndex,
          visibleStopIndexes: resolved.visibleStopIndexes,
          visibleSymbolIds: resolved.visibleSymbolIds,
          drawsConsumed: 0,
        });
      }
    }

    const frozenReels = Object.freeze(reels);
    const frozenStopIndexes = Object.freeze(resolvedStopIndexes);
    const frozenStopPositions = Object.freeze(stopPositions);

    const board = this.boardBuilder.buildBoard(config, {
      stopIndexes: frozenStopIndexes,
      stopPositions: frozenStopPositions,
      reelWindows: frozenReels,
    });

    return Object.freeze({
      mode: "explicit",
      reels: frozenReels,
      board,
      selectedStopIndexes: frozenStopIndexes,
      stopIndexes: frozenStopIndexes,
      stopPositions: frozenStopPositions,
      reelWindows: frozenReels,
      ...(traceEntries ? { trace: Object.freeze(traceEntries) } : {}),
    });
  }

  public resolveReels(
    config: GameConfig,
    rng: RandomNumberGenerator,
    context: ReelResolutionContext,
  ): ReelResult {
    const customHeights = context?.reelHeights;
    if (
      context?.forcedStopIndexes &&
      context.forcedStopIndexes.length === config.grid.columns
    ) {
      return this.resolveFromStops(config, context.forcedStopIndexes, {
        visibleRowCounts: customHeights,
        trace: context.trace,
      });
    }

    if (context?.linkedReels && context.linkedReels.length > 0) {
      // B01 linked-reel context compatibility
      const baseResolution = this.resolve(config, rng, {
        visibleRowCounts: customHeights,
        trace: context.trace,
      });
      const modifiedStops = [...baseResolution.selectedStopIndexes];
      for (const group of context.linkedReels) {
        if (group.length > 1) {
          const leader = group[0];
          for (let i = 1; i < group.length; i += 1) {
            const targetIdx = group[i];
            if (targetIdx >= 0 && targetIdx < config.reels.length) {
              modifiedStops[targetIdx] =
                modifiedStops[leader] % config.reels[targetIdx].stops.length;
            }
          }
        }
      }
      return this.resolveFromStops(config, modifiedStops, {
        visibleRowCounts: customHeights,
        trace: context.trace,
      });
    }

    return this.resolve(config, rng, {
      visibleRowCounts: customHeights,
      trace: context?.trace,
    });
  }
}

export function serializeReelResolution(resolution: ReelResolution): string {
  if (!resolution || typeof resolution !== "object") {
    throw new InvalidReelResolutionError(
      "serializeReelResolution requires a valid ReelResolution object.",
    );
  }
  return JSON.stringify(resolution);
}

export function deserializeReelResolution(serialized: string): ReelResolution {
  if (typeof serialized !== "string" || serialized.trim().length === 0) {
    throw new InvalidReelResolutionError(
      "deserializeReelResolution requires a non-empty JSON string.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (err) {
    throw new InvalidReelResolutionError(
      `Failed to parse ReelResolution JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as ReelResolution).reels) ||
    !(parsed as ReelResolution).board
  ) {
    throw new InvalidReelResolutionError(
      "Deserialized JSON is not a valid ReelResolution structure.",
    );
  }
  return parsed as ReelResolution;
}

export function createReelEngine(): ReelEngine {
  return new DeterministicReelResolver();
}

export function createReelResolver(): ReelEngine {
  return new DeterministicReelResolver();
}
