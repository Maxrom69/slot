# B09 — Ways-to-Win Engine (`src/engine/ways/index.ts`)

## 1. Section Identity
- **Section ID**: `B09`
- **Track**: Section 2 — Backend Slot Game Engine
- **Title**: Ways-to-Win Engine
- **Status**: Complete & Verified
- **Date**: 2026-10-13

---

## 2. Executive Summary
`B09` implements the **Ways-to-Win Engine** (`src/engine/ways/index.ts`), the authoritative adjacent-reel Ways evaluation subsystem of the Backend Slot Game Engine (`src/engine/`). It consumes a validated `GameConfig` / `WaysConfiguration` (`B02`) and an authoritative visible `Board` (`B04`), evaluates leftmost consecutive adjacent-reel symbol matches starting on `reel 0`, counts every qualifying symbol occurrence per participating reel (including `B07` Wild substitutions), multiplies those per-reel symbol counts together (`waysCount = c0 × c1 × c2 × ...`), resolves base payouts from `B06` (`PaytableEngine`), and returns an immutable, JSON-serializable `WaysEvaluationResult`.

---

## 3. Architectural Purpose & Scope

### 3.1 Why B09 Exists
In a Ways-to-Win game (such as 243-Ways on a 5×3 board or 1024-Ways on a 5×4 board), wins are not bound to fixed payline row coordinates (`B05`). Instead:
1. Any qualifying symbol appearing on `reel 0` starts a candidate run.
2. That symbol continues across consecutive neighboring reels (`reel 0`, `reel 1`, `reel 2`, ...) and stops immediately at the first reel with zero qualifying occurrences.
3. Multiple occurrences of the symbol on the same reel do not collapse into a boolean flag—they multiply the total number of winning combinations (`waysCount`).

### 3.2 Responsibilities Included in B09
- Validating `WaysConfiguration` (`minimumConsecutiveReels`, `maximumReels`, `requireFullLength`, `eligibleSymbols`, `direction`, `familyCountingEnabled`) and `Board` dimensions (`B04`).
- Identifying candidate regular symbols from `reel 0` (plus an All-Wild run when `reel 0` contains active Wilds) and deduplicating candidates so each symbol produces at most one `WaysWin` per spin.
- Evaluating consecutive reel runs starting at `reel 0` and stopping at the first gap.
- Consulting `B07` (`WildEngine.isWildActiveOnReel` and `WildEngine.canSubstitute`) for Wild substitution without mutating the `Board` or creating a second Wild engine.
- Supporting optional `B02` Symbol Family grouping (`familyCountingEnabled: true`) while keeping exact symbol identity as the default (`familyCountingEnabled: false`).
- Computing multiplicative `waysCount` and `effectiveMultiplier = baseMultiplier × waysCount` with checked safe-integer / finite arithmetic (`WaysArithmeticOverflowError`).
- Returning per-reel breakdown (`reelCounts: WaysReelCount[]`) and physical `matchedCells: WaysMatchedCell[]` for frontend highlighting.

### 3.3 Responsibilities Excluded from B09
- `B09` does **not** use or consult `B05` Paylines.
- `B09` does **not** evaluate `B08` Scatters, Cluster adjacency (`B10`), or Pay-Anywhere counts (`B11`).
- `B09` does **not** call RNG (`B03`) or rebuild the `Board` (`B04`).
- `B09` does **not** perform game-wide credit settlement across multiple win channels (`B12+`).

---

## 4. Mathematical & Domain Model

### 4.1 The 243 / 1024 Ways Model
Given a board with $R$ reels where reel $i$ has height $H_i$:
- A full-board match on a **5×3** board has $3 \times 3 \times 3 \times 3 \times 3 = 3^5 = 243$ ways.
- A full-board match on a **5×4** board has $4 \times 4 \times 4 \times 4 \times 4 = 4^5 = 1024$ ways.
- Variable reel heights (e.g., `[3, 4, 4, 4, 3]`) are supported automatically by iterating `0 <= rowIndex < board.reels[reelIndex].length`.

### 4.2 Reel-by-Reel Counting & Consecutive Reel Rule
For each deduplicated candidate symbol $S$:
1. Inspect `reelIndex = 0, 1, ..., maxReels - 1`.
2. On reel $r$, collect all `rowIndexes` whose cell matches $S$ directly, via `B02` symbol family (when `familyCountingEnabled === true`), or via `B07` Wild substitution (`wildEngine.isWildActiveOnReel(wildSymbolId, r)` and `wildEngine.canSubstitute(wildSymbolId, S)`).
3. If `rowIndexes.length === 0`:
   - If $r = 0$, the candidate cannot start a Ways win.
   - If $r > 0$, the consecutive run stops immediately at reel $r - 1$; symbols on reels $> r$ are ignored.
4. Let $L$ be the number of consecutive reels starting from `reel 0`.
   - If $L < \text{minimumConsecutiveReels}$, no win is awarded.
   - If `requireFullLength === true` and $L < \text{maxReels}$, no win is awarded.
5. Compute:
   $$\text{waysCount} = \prod_{r=0}^{L-1} \text{count}_r$$
   $$\text{effectiveMultiplier} = \text{baseMultiplier}(S, L) \times \text{waysCount}$$

### 4.3 Wild Interaction & All-Wild Policy
- When a cell contains a Wild symbol $W$ and $S \neq W$, `B09` delegates to `B07` (`wildEngine.isWildActiveOnReel(W, r)` and `wildEngine.canSubstitute(W, S)`).
- Wild cells may participate in multiple different symbol Ways wins simultaneously on the same spin (e.g., `Reel 0 = [A, K, W]` allows `W` to count for both `A` and `K` on `Reel 0`).
- **All-Wild Run**: When `reel 0` contains active Wild cells, `B09` evaluates the consecutive pure-Wild run across reels `0..L_W-1`:
  - If the Wild has `paysOnOwn === true` and a positive paytable entry for length $L_W$, it is evaluated as a Wild candidate.
  - Otherwise, if no regular symbol already covers all pure-Wild reels `0..L_W-1`, `B09` resolves the highest-paying eligible substitutable symbol for length $L_W$ from `B06`.
  - To prevent double-counting when a Wild substitutes into a regular symbol $S$ across the exact same consecutive reels `0..L-1` with identical per-reel counts (`waysCount`), `B09` suppresses the redundant lower-or-equal pure-Wild duplicate while keeping whichever win pays higher (`wild_only` vs `substituted`).

### 4.4 Example Evaluations
1. **Single Path (3 Reels)**:
   - `Reel 0: [A, K, Q]`, `Reel 1: [J, A, 10]`, `Reel 2: [9, 8, A]`, `Reel 3: [J, Q, K]`, `Reel 4: [10, 9, 8]`
   - Symbol `A`: counts `[1, 1, 1]`, `reelLength = 3`, `waysCount = 1`, `baseMultiplier = 2` $\Rightarrow$ `effectiveMultiplier = 2`.
2. **Multi-Count Ways (4 Reels)**:
   - `Reel 0: [A, A, K]` (`2`), `Reel 1: [A, Q, A]` (`2`), `Reel 2: [A, A, A]` (`3`), `Reel 3: [K, A, Q]` (`1`), `Reel 4: [K, Q, J]` (`0`)
   - Symbol `A`: counts `[2, 2, 3, 1]`, `reelLength = 4`, `waysCount = 2 × 2 × 3 × 1 = 12`, `baseMultiplier = 5` $\Rightarrow$ `effectiveMultiplier = 60`.
3. **Wild + Symbol on Same Reel**:
   - `Reel 0: [A, W, K]` (`2`), `Reel 1: [A, Q, J]` (`1`), `Reel 2: [W, A, 10]` (`2`)
   - Symbol `A`: counts `[2, 1, 2]`, `reelLength = 3`, `waysCount = 4`, `Wilds used = 2`.

---

## 5. Structured Error Model (`src/engine/errors/index.ts`)
| Error Class | Code | Trigger Condition |
|---|---|---|
| `InvalidWaysConfigurationError` | `INVALID_WAYS_CONFIG` | Missing/non-object config, unsupported direction (`!= "left_to_right"`), invalid `maximumReels`, or empty `eligibleSymbols` array. |
| `InvalidMinimumReelCountError` | `INVALID_MINIMUM_REEL_COUNT` | `minimumConsecutiveReels < 1`, non-integer, or exceeds board reel count / `maximumReels`. |
| `InvalidBoardError` | `INVALID_BOARD` | Missing board, mismatched `reelCount`, empty reel column, or invalid cell coordinates/symbol IDs. |
| `UnknownWaysSymbolError` | `UNKNOWN_WAYS_SYMBOL` | Board cell or `eligibleSymbols` references a symbol ID not present in the symbol registry (`symbolsById`). |
| `InvalidPaytableReferenceError` | `INVALID_PAYTABLE_REFERENCE` | Missing or invalid paytable source passed to `evaluateWays`. |
| `WaysArithmeticOverflowError` | `WAYS_ARITHMETIC_OVERFLOW` | `waysCount` exceeds `Number.MAX_SAFE_INTEGER` or `effectiveMultiplier` overflows finite IEEE-754 bounds. |

---

## 6. Files Created & Modified in B09
| File Path | Action | Purpose |
|---|---|---|
| `src/engine/ways/index.ts` | Created | Core `B09` Ways-to-Win Engine (`WaysEngine`, `DeterministicWaysEngine`, `createWaysEngine`, `evaluateWays`, `normalizeWaysConfiguration`, `validateBoardForWays`, `safeMultiplyWaysCount`, `safeComputeEffectiveMultiplier`, `serializeWaysEvaluationResult`, `deserializeWaysEvaluationResult`). |
| `src/engine/errors/index.ts` | Modified | Added `INVALID_WAYS_CONFIG`, `INVALID_MINIMUM_REEL_COUNT`, `UNKNOWN_WAYS_SYMBOL`, `WAYS_ARITHMETIC_OVERFLOW` and structured error classes `InvalidWaysConfigurationError`, `InvalidMinimumReelCountError`, `UnknownWaysSymbolError`, `WaysArithmeticOverflowError`. |
| `src/engine/schema/types.ts` | Modified | Extended `WaysConfiguration` with optional `maximumReels`, `requireFullLength`, `eligibleSymbols`, and `familyCountingEnabled`. |
| `src/engine/config/index.ts` | Modified | Added normalized `waysConfiguration: WaysConfiguration` to `GameConfig` and `adaptBlueprintToGameConfig`. |
| `src/engine/index.ts` | Modified | Exported `./ways` from the root engine barrel. |
| `tests/ways-engine.test.ts` | Created | Comprehensive unit and integration test suite (`TEST 1`–`TEST 20` + 243/1024 sanity checks + variable reel heights + B02/B04/B06/B07/B09 pipeline). |
| `docs/implementation/B09-ways-to-win-engine.md` | Created | Section `B09` implementation report. |
| `docs/implementation/INDEX.md` | Modified | Added `B09` entry to the master implementation index. |
| `docs/backups/Backup-Manifest.md` | Modified | Recorded `B09` Google Drive backup folder and file IDs. |

---

## 7. Key Interfaces & Exports (`src/engine/ways/index.ts`)
- `WaysMatchedCell`: `{ readonly reelIndex: number; readonly rowIndex: number; readonly symbolId: string; readonly matchedViaWild: boolean }`
- `WaysReelCount`: `{ readonly reelIndex: number; readonly rowIndexes: readonly number[]; readonly count: number }`
- `WaysWin`: `{ readonly symbolId: string; readonly reelLength: number; readonly waysCount: number; readonly reelCounts: readonly WaysReelCount[]; readonly matchedCells: readonly WaysMatchedCell[]; readonly baseMultiplier: number; readonly effectiveMultiplier: number; readonly totalPayout?: number; readonly wildCount: number; readonly substitutionMode: "natural" | "substituted" | "wild_only" }`
- `WaysEvaluationResult`: `{ readonly evaluationMode: "ways"; readonly totalWaysWins: number; readonly wins: readonly WaysWin[]; readonly totalBaseMultiplier: number; readonly totalEffectiveMultiplier: number; readonly totalPayout?: number }`
- `WaysEngine`: `{ evaluateWays(board, waysConfig, symbolRegistry, wildEngine, paytable, payoutContext?): WaysEvaluationResult }`

---

## 8. Integration with Other Engine Sections
- **B02 (`src/engine/schema/`, `src/engine/config/`)**: Consumes `WaysConfiguration`, `SymbolDefinition`, and `GameConfig.waysConfiguration`.
- **B04 (`src/engine/board/`)**: Consumes authoritative `Board` (`board.reels[reelIndex][rowIndex]`), supporting both rectangular (`5x3`, `5x4`, `6x4`) and variable-height boards.
- **B06 (`src/engine/paytable/`)**: Resolves `baseMultiplier` for `(symbolId, reelLength)` and optional `totalPayout = roundCurrency(effectiveMultiplier * bet)`.
- **B07 (`src/engine/wilds/`)**: Reuses `WildEngine.isWildActiveOnReel` and `WildEngine.canSubstitute` for Wild substitution and All-Wild resolution.

---

## 9. Verification & Test Coverage (`tests/ways-engine.test.ts`)
All **20 mandatory B09 test scenarios** plus the **243-Ways (5×3)** and **1024-Ways (5×4)** mathematical sanity checks pass:
- `TEST 1`: Basic 3-reel Ways win (`1 × 1 × 1 = 1 way`)
- `TEST 2`: Basic 4-reel Ways win (`1 × 1 × 1 × 1 = 1 way`)
- `TEST 3`: Basic 5-reel Ways win (`1 × 1 × 1 × 1 × 1 = 1 way`)
- `TEST 4`: Multi-symbol per reel Ways win (`2 × 2 × 3 × 1 = 12 ways`)
- `TEST 5`: Non-consecutive gap stops win (`reel 0, 1, 3, 4` with gap on `reel 2` pays `2`-reel or `0` if `min=3`)
- `TEST 6`: Missing `reel 0` prevents win (`reels 1..4` with `0` on `reel 0` produces `0` wins)
- `TEST 7`: Below minimum consecutive reels (`2` reels when `min=3` produces `0` wins)
- `TEST 8`: Custom minimum consecutive reels (`2`-reel win when `minimumConsecutiveReels = 2`)
- `TEST 9`: Wild substitutes on middle reel (`[A]`, `[W]`, `[A]` $\Rightarrow$ `1 way` for `A`)
- `TEST 10`: Wild + natural symbol on same reel (`[A, W]` on `reel 0`, `[A]` on `reel 1`, `[W, A]` on `reel 2` $\Rightarrow$ `2 × 1 × 2 = 4 ways`)
- `TEST 11`: Restricted Wild reel (`B07` `activeReels: [1, 2, 3]` prevents Wild from counting on `reel 0`)
- `TEST 12`: Restricted Wild target (`B07` `substitutesFor` prevents Wild from substituting excluded symbol)
- `TEST 13`: Multiple winning symbols in one spin (`A` and `K` evaluated independently, sharing Wilds where applicable)
- `TEST 14`: Duplicate symbol on `reel 0` does not create duplicate `WaysWin` (`[A, A, A]` on `reel 0` produces one `WaysWin` with `count = 3`)
- `TEST 15`: No payline dependency (`paylines: []` has zero effect on Ways evaluation)
- `TEST 16`: Determinism (`100` identical evaluations produce deep-equal results)
- `TEST 17`: Immutability (`Board`, `WaysConfiguration`, and frozen `WaysEvaluationResult` cannot be mutated)
- `TEST 18`: Serialization round-trip (`serializeWaysEvaluationResult` / `deserializeWaysEvaluationResult`)
- `TEST 19`: Overflow protection (`WaysArithmeticOverflowError` thrown on unsafe product or multiplier overflow)
- `TEST 20`: Invalid configuration and board errors (`InvalidWaysConfigurationError`, `InvalidMinimumReelCountError`, `InvalidBoardError`, `UnknownWaysSymbolError`, `InvalidPaytableReferenceError`)
- **Mathematical Sanity Checks**:
  - `5 × 3` full board of `A` $\Rightarrow$ `3 × 3 × 3 × 3 × 3 = 243` ways.
  - `5 × 4` full board of `A` $\Rightarrow$ `4 × 4 × 4 × 4 × 4 = 1024` ways.

---

## 10. Build, Lint, and Typecheck Verification
- `npm run typecheck`: **0 errors**
- `npm run lint`: **0 errors, 0 warnings**
- `npx tsx --test tests/*.test.ts`: **189 / 189 passing**
- `npm run build`: **Production Next.js build succeeded**

---

## 11. Determinism, Immutability, and Purity Guarantees
- Zero RNG (`Math.random`, `B03` RNG) or time-based calls (`Date.now`, `performance.now`).
- Zero browser/UI dependencies (`window`, `document`, `localStorage`, React, DOM).
- Input `Board`, `WaysConfiguration`, `SymbolRegistry`, `WildEngine`, and `PaytableSource` are never mutated.
- Output `WaysEvaluationResult`, `WaysWin`, `WaysReelCount`, and `WaysMatchedCell` objects are deeply frozen via `Object.freeze`.

---

## 12. Edge Cases Handled
- Duplicate candidate symbols on `reel 0` (`[A, A, A]`) deduplicated into a single candidate pass.
- Pure-Wild prefix on `reel 0..k` vs regular symbol + Wild run on `reel 0..m` deduplicated when covering the exact same reels and `waysCount` so wins are not double-counted.
- Variable-height boards (`[3, 4, 4, 4, 3]`) evaluated safely using per-reel column length.
- Full-length enforcement (`requireFullLength: true`) rejecting partial consecutive runs shorter than `maxReels`.

---

## 13. Known Limitations & Deferred Responsibilities
- **Cluster Evaluation (`B10`)**: Orthogonal connected-component cluster wins are deferred to `B10`.
- **Pay-Anywhere Evaluation (`B11`)**: Total board count scatter-pay mechanics are deferred to `B11`.
- **Unified Spin Settlement (`B12+`)**: Combining Ways wins (`B09`) with Scatter awards (`B08`) into a single spin settlement ledger is deferred to `B12+`.

---

## 14. Pre-Section & Post-Section File Manifest Comparison
- **Pre-`B09` file count** (`src`, `tests`, `docs`): `323` files (`/tmp/pre-b09-manifest.txt`).
- **Post-`B09` file count** (`src`, `tests`, `docs`): `326` files (`+3` new files: `src/engine/ways/index.ts`, `tests/ways-engine.test.ts`, `docs/implementation/B09-ways-to-win-engine.md`; `6` modified files: `src/engine/errors/index.ts`, `src/engine/schema/types.ts`, `src/engine/config/index.ts`, `src/engine/index.ts`, `docs/implementation/INDEX.md`, `docs/backups/Backup-Manifest.md`).

---

## 15. Google Drive Backup Synchronization
All `9` created/modified files for `B09` are backed up under `Slot Studio Backups/B - Backend/B09/` and cataloged in `docs/backups/Backup-Manifest.md`.

---

## 16. Readiness Confirmation for B10
`B09 — Ways-to-Win Engine` is complete, verified, documented, and backed up. In accordance with the Arena Checkpoint Rule, execution stops here and awaits explicit approval before proceeding to `B10`.
