# B04 — Reel Engine

## 1. Section Metadata
- **Section ID**: `B04`
- **Section Name**: Reel Engine
- **Category**: `B - Backend` (`SECTION 2 — BACKEND / SLOT GAME ENGINE`)
- **Implementation Status**: `COMPLETE`
- **Date Completed**: `2026-10-12`
- **Primary Modules**: `src/engine/reels/index.ts`, `src/engine/board/index.ts`, `src/engine/errors/index.ts`

---

## 2. Executive Summary
`B04` implements the authoritative **Reel Engine** (`ReelEngine`, `DeterministicReelResolver`, `resolveSingleReel`, `DefaultBoardBuilder`) for the Slot Game Engine. Consuming the normalized `GameConfig` from `B02` and the deterministic `RandomSource` from `B03`, the Reel Engine resolves circular reel strips into physical stop selections, visible stop slices, and the immutable visible `Board` — with zero win, paytable, or feature evaluation logic.

---

## 3. Core Conventions & Mathematical Semantics

### 3.1 Circular Reel Model & Stop-Index Convention
- Each reel is an ordered circular strip of `N` physical stops (`0 <= stopIndex < N`).
- **`selectedStopIndex` Convention**: Represents the **top visible symbol** (`rowIndex = 0`) on that reel.
- For visible row count `R` (`visibleRows`), the visible physical stop index at row `r` (`0 <= r < R`) wraps deterministically around the end of the strip:
  $$\text{visibleStopIndexes}[r] = (\text{selectedStopIndex} + r) \bmod N$$
  $$\text{visibleSymbolIds}[r] = \text{reel.stops}[\text{visibleStopIndexes}[r]].\text{symbolId}$$

#### Example (5-Stop Strip `[A, B, C, D, E]`, `visibleRows = 3`)
- `selectedStopIndex = 0` → `visibleStopIndexes = [0, 1, 2]`, `visibleSymbolIds = ["A", "B", "C"]`
- `selectedStopIndex = 3` → `visibleStopIndexes = [3, 4, 0]`, `visibleSymbolIds = ["D", "E", "A"]`
- `selectedStopIndex = 4` → `visibleStopIndexes = [4, 0, 1]`, `visibleSymbolIds = ["E", "A", "B"]`

### 3.2 Board Orientation & Coordinate Convention
- **`reelIndex`**: `0` is the **leftmost** reel; `reelCount - 1` is the rightmost reel.
- **`rowIndex`**: `0` is the **top** visible row; `visibleRows - 1` is the bottom visible row.
- **Matrix Indexing**: Column-major `board.cells[reelIndex][rowIndex]`. Every `Cell` records `{ position: { reelIndex, rowIndex }, reelIndex, rowIndex, stopIndex, symbolId, symbol, locked, multiplier, mysteryResolvedFrom, colossalGroupId }`.

### 3.3 Physical Stop Identity, Duplicate Stops & Weighted Stops
- **Physical Stop as the Unit of Selection**: Reel stops are never reordered, sorted, or deduplicated.
- **Unweighted Mode (`useWeights = false`)**: Selects uniformly over physical stop indexes `0 .. N - 1` via `reelRng.nextInt(0, N)`. On strip `[A, A, B]`, stop `0` (`A`), stop `1` (`A`), and stop `2` (`B`) each have probability `1/3`, giving symbol `A` total probability `2/3` and `B` `1/3`.
- **Weighted Mode (`useWeights = true`)**: Attaches weights to **physical stops** (`{ value: stopIndex, weight: stop.weight }`) and delegates to B03's `reelRng.weightedPick(...)`.
  - Zero-weight stops (`weight === 0`) are never selected.
  - All-zero weighted reels (`totalWeight <= 0`) are rejected with `ZeroWeightReelError` (`ZERO_WEIGHT_REEL`).
  - Negative, `NaN`, or `Infinity` weights are rejected with `InvalidReelWeightError` (`INVALID_REEL_WEIGHT`).

### 3.4 Short-Reel Policy (`strip.length < visibleRows`)
- If a reel strip has fewer physical stops than `visibleRows` (`reel.stops.length < visibleRows`), resolution rejects the configuration with `ShortReelStripError` (`SHORT_REEL_STRIP`).
- A strip of length equal to `visibleRows` (including `strip.length === 1` with `visibleRows === 1`) is valid and wraps cleanly at the boundary.

### 3.5 B03 Substream Isolation & Explicit Stop Mode
- **Random Mode (`reelEngine.resolve(config, rng, options)`)**:
  - Forks the reels substream `const reelsStream = rng.fork("reels")`, then forks a dedicated stream per reel: `reelsStream.fork("reel-0")`, `reelsStream.fork("reel-1")`, etc. (`streamNamespace: "root/reels/reel-0"`, ...).
  - Unrelated draws on the root stream or sibling streams (`features`, `bonuses`, `diagnostics`) never alter the resolved reel stops.
- **Explicit Stop Mode (`reelEngine.resolveFromStops(config, stopIndexes, options)`)**:
  - Validates `0 <= stopIndexes[reelIndex] < reel.stops.length` (rejecting negative, out-of-bounds, or non-integer stop indexes with `InvalidStopIndexError` without wrapping external invalid indexes).
  - Resolves windows and builds the authoritative `Board` with **zero RNG dependency** (`drawCount = 0`, `rngStream = null`).
  - Passing `randResolution.selectedStopIndexes` into `resolveFromStops()` reproduces the exact same `Board`.

---

## 4. Result & Error Structures

### `SingleReelResult` (`ResolvedReelWindow`)
```ts
interface SingleReelResult {
  readonly reelId: ReelId;
  readonly reelIndex: number;
  readonly selectedStopIndex: number;
  readonly initialSelectedStopIndex: number; // preserved for future nudge mechanics
  readonly nudgeOffset: number;              // 0 in B04
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
```

### `ReelResolution`
```ts
interface ReelResolution {
  readonly mode: "random" | "explicit";
  readonly reels: readonly SingleReelResult[];
  readonly board: Board;
  readonly selectedStopIndexes: readonly number[];
  readonly stopIndexes: readonly number[];
  readonly stopPositions: readonly number[];
  readonly reelWindows: readonly SingleReelResult[];
  readonly trace?: readonly ReelDebugTraceEntry[];
}
```

### Structured B04 Error Classes (`src/engine/errors/index.ts`)
- `InvalidReelCountError` (`INVALID_REEL_COUNT`)
- `EmptyReelError` (`EMPTY_REEL`)
- `ShortReelStripError` (`SHORT_REEL_STRIP`)
- `InvalidStopIndexError` (`INVALID_STOP_INDEX`)
- `UnknownSymbolReferenceError` (`INVALID_SYMBOL_REFERENCE`)
- `InvalidReelWeightError` (`INVALID_REEL_WEIGHT`)
- `ZeroWeightReelError` (`ZERO_WEIGHT_REEL`)
- `InvalidVisibleRowCountError` (`INVALID_VISIBLE_ROW_COUNT`)
- `InvalidReelResolutionError` (`INVALID_REEL_RESOLUTION`)

---

## 5. Files Created & Modified in B04

### Created Files (`2` files)
1. `tests/reel-engine.test.ts`: Direct B04 test suite covering all 20 required test cases (`TEST 1`–`TEST 20`) and property-style invariant tests across 100 spins.
2. `docs/implementation/B04-reel-engine.md`: This implementation and architectural specification document.

### Modified Files (`5` files)
1. `src/engine/errors/index.ts`: Added the 9 structured `B04` Reel Engine error classes.
2. `src/engine/board/index.ts`: Enriched `Board` (`reelCount`, `rowCount`) and `Cell` (`reelIndex`, `rowIndex`, `stopIndex`, `symbolId`) and added runtime boundary checks in `DefaultBoardBuilder`.
3. `src/engine/reels/index.ts`: Implemented `ReelEngine`, `resolveSingleReel`, `DeterministicReelResolver.resolve`, `DeterministicReelResolver.resolveFromStops`, `serializeReelResolution`, `deserializeReelResolution`, B03 substream isolation (`reels/reel-i`), and optional debug trace generation.
4. `docs/implementation/INDEX.md`: Added `B04` completion entry and updated cumulative test counts.
5. `docs/backups/Backup-Manifest.md`: Recorded verified Google Drive backup entries for `B04`.

---

## 6. Acceptance Criteria Coverage (1–47)
All 47 `B04` acceptance criteria pass (`100%`):
- Reel definitions consumed from `GameConfig`, ordered circular strips, distinct duplicate physical stops, reel count / empty reel / invalid stop index validation (`1`–`6`, `12`)
- Uniform unweighted selection and physical-stop weighted selection via B03 `RandomSource`, zero-weight exclusion, and all-zero reel rejection (`7`–`11`)
- Visible row counts, `reel 0` leftmost, `row 0` top, `selectedStopIndexes`, `visibleStopIndexes`, `visibleSymbolIds`, and authoritative `Board` (`13`–`19`)
- Explicit stop mode (`resolveFromStops`) without RNG, deterministic seed reproducibility, non-intrusive debug trace, and B03 substream isolation (`20`–`24`)
- Zero `Math.random()`, zero frontend dependencies, immutable `GameConfig`/strips, JSON-serializable `ReelResolution`, all 20 test cases + property invariants passing, and zero win/paytable/feature/UI logic in `B04` (`25`–`47`).

---

## 7. Testing & Verification Results
- `npm run typecheck`: `0` errors
- `npm run lint`: `0` errors, `0` warnings
- `npx tsx --test tests/reel-engine.test.ts`: `3/3` passing (`B04.1`, `B04.2`, `B04.3` covering `TEST 1`–`TEST 20` + 100-spin invariant suite)
- `npx tsx --test tests/*.test.ts`: `175/175` passing across all `26` test suites (`F01`–`F22`, `B01`, `B02`, `B03`, `B04`)
- `npm run build`: Next.js 16.2.6 production build succeeded (`exit_code: 0`)

---

## 8. Known Limitations & Remaining Work for B05+
- Per `B04` scope boundaries, `B04` resolves circular reel strips and builds the visible `Board` without evaluating wins or executing post-stop modifiers:
  - **B05**: Fixed-payline evaluation consuming `ReelResolution.board`
  - **B06–B09**: Paytable calculation, Wild substitution, Scatter evaluation, Ways, Clusters, and Pay-Anywhere evaluation
  - **B10–B13**: Feature triggers, Free Spins, Multipliers, Cascades, and post-stop reel modifiers (nudges, linked reels)
  - **B14+**: RTP simulation, state management, and verification suites

---

## 9. Google Drive Incremental Backup Summary
- **Destination Folder**: `Slot Studio Backups/B - Backend/B04/`
- All files created or modified in `B04` are backed up and verified in Google Drive (exact file IDs recorded in `docs/backups/Backup-Manifest.md`).
