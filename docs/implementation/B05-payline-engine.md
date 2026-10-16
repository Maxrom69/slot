# B05 — Payline Engine

## 1. Section Metadata
- **Section ID**: `B05`
- **Section Name**: Payline Engine
- **Category**: `B — Backend Slot Game Engine`
- **Completion Status**: `COMPLETE`
- **Verification Date**: `2026-10-12`

---

## 2. Executive Summary
`B05` implements the deterministic Fixed Payline Engine (`src/engine/paylines/index.ts`) for the Section 2 Backend Slot Game Engine. Consuming the authoritative `Board` produced by `B04` and fixed payline definitions (`PaylineDefinition[]` or `GameConfig.paylines` from `B01`/`B02`), `B05` evaluates each enabled payline independently from left to right starting at `reelIndex = 0`, determines the contiguous matching symbol run using an injectable `SymbolMatchPolicy` (defaulting to exact symbol matching `EXACT_SYMBOL_MATCH_POLICY`), and returns immutable, serializable `PaylineEvaluationResult` structures without reconstructing the board, consuming RNG, calculating paytable payouts (`B06`), performing Wild substitution (`B07`), or counting Scatters (`B08`).

---

## 3. Architectural Conventions & Rules

### 3.1 Payline Pattern & Coordinate Convention
- Every fixed payline has a `pattern` array of row indexes whose length MUST equal `board.reelCount` (`board.columns`).
- Following `B04`'s authoritative orientation:
  - `reelIndex = 0` is the leftmost reel (`0 <= reelIndex < board.reelCount`).
  - `rowIndex = 0` is the top visible row (`0 <= rowIndex < board.cells[reelIndex].length`).
- Example on a `5x3` board: `pattern = [0, 1, 2, 1, 0]` maps:
  - `reel 0 -> row 0`
  - `reel 1 -> row 1`
  - `reel 2 -> row 2`
  - `reel 3 -> row 1`
  - `reel 4 -> row 0`

### 3.2 Left-to-Right Contiguous Evaluation & Best-Combination-Per-Line Rule
- For each enabled payline:
  1. Read `row0 = payline.pattern[0]` and `cell0 = board.cells[0][row0]`.
  2. Set `baseSymbolId = cell0.symbolId`.
  3. Advance across adjacent reels `reelIndex = 1 .. board.reelCount - 1`.
  4. Test compatibility via `matchPolicy.matches(baseSymbolId, candidateSymbolId, reelIndex)`.
  5. Stop immediately at the first incompatible symbol (`A K A A A` produces `matchCount = 1`, `reelIndexes = [0]`).
- Each enabled payline produces at most one evaluated combination beginning at reel `0`; overlapping or non-starting runs on the same payline are never produced.
- `B05` reports the actual contiguous match count starting at reel `0` (`1 <= matchCount <= board.reelCount`) without deciding whether that match count is payable (which is `B06`'s responsibility).

### 3.3 Disabled Paylines & Independent Multi-Line Evaluation
- Disabled paylines (`enabled === false` or `active === false`) are validated for structural integrity and skipped during evaluation (`evaluatePayline` returns `null`, and `evaluate` increments `disabledPaylineCount`).
- Every enabled payline is evaluated independently; separate payline matches remain separate in `result.matches` and never combine match counts.

### 3.4 Strict Separation from B06 (Paytable), B07 (Wilds), and B08 (Scatters)
- **Why Payout Calculation is Outside B05**: `B05` answers *"Which symbol and how many consecutive reels matched along this fixed payline?"* while `B06` later answers *"How much is that combination worth given the paytable and bet?"* `PaylineMatch` and `PaylineEvaluationResult` contain zero payout, credit, or multiplier fields.
- **Why Wild Substitution is Outside B05**: Wild substitution rules (leading wilds, pure wild wins vs. substituted wins, reel restrictions, excluded symbols, wild multipliers) belong to `B07`. `B05` defines the clean `SymbolMatchPolicy` interface (`EXACT_SYMBOL_MATCH_POLICY` by default) so `B07` can inject Wild-aware matching without rewriting `PaylineEngine`.
- **Why Scatter Evaluation is Outside B05**: Scatters evaluate anywhere on the board independently of paylines in `B08`. In `B05`, a scatter symbol on a payline is treated as an ordinary symbol ID that only exact-matches itself along contiguous reels starting at reel `0`.

---

## 4. Structured Error Hierarchy (`src/engine/errors/index.ts`)
All `B05` errors extend `InvalidPaylineConfigError` / `SlotEngineError`:
- `InvalidBoardError` (`code: "INVALID_BOARD"`)
- `InvalidPaylineError` (`code: "INVALID_PAYLINE"`)
- `MissingPaylineError` (`code: "MISSING_PAYLINE"`)
- `PaylineGridMismatchError` (`code: "PAYLINE_GRID_MISMATCH"`)
- `InvalidRowIndexError` (`code: "INVALID_ROW_INDEX"`)

---

## 5. Files Created
1. `src/engine/paylines/index.ts` — Fixed Payline Engine (`PaylineEngine`, `FixedPaylineEngine`, `SymbolMatchPolicy`, `EXACT_SYMBOL_MATCH_POLICY`, `PaylineCellPosition`, `PaylineMatch`, `PaylineEvaluationResult`, `evaluatePayline`, `evaluatePaylines`, `validateBoardForPaylines`, `validatePaylineForBoard`, `validatePaylinesForBoard`, `serializePaylineEvaluationResult`, `deserializePaylineEvaluationResult`, `createBoardFromSymbolGrid`, `createPaylineEngine`).
2. `tests/payline-engine.test.ts` — Automated test suite (`B05.1`–`B05.3` covering `TEST 1` through `TEST 15` plus Wild/Scatter boundary tests and `B04` integration).
3. `docs/implementation/B05-payline-engine.md` — This implementation report.

---

## 6. Files Modified
1. `src/engine/errors/index.ts` — Added `B05` error codes and structured error classes (`InvalidBoardError`, `InvalidPaylineError`, `MissingPaylineError`, `PaylineGridMismatchError`, `InvalidRowIndexError`).
2. `src/engine/config/index.ts` — Enriched `NormalizedPayline` with `enabled: boolean` and `color: string` alongside `active: boolean` for seamless `B01`/`B02`/`B05` interoperability.
3. `src/engine/index.ts` — Exported `./paylines` from the engine barrel.
4. `docs/implementation/INDEX.md` — Added `B05` entry and updated cumulative test counts (`178/178` across `27` test files).
5. `docs/backups/Backup-Manifest.md` — Logged incremental backup metadata for `B05`.

---

## 7. Files Deleted
- None (`0` files deleted).

---

## 8. Acceptance Criteria Traceability (`TEST 1`–`TEST 15` + Boundaries)
| Test / Criterion | Verification Target | Status |
| --- | --- | --- |
| `TEST 1` | Horizontal 5-of-a-kind (`[0,0,0,0,0]` -> `A A A A A`, `matchCount = 5`) | PASS |
| `TEST 2` | Three matches then mismatch (`A A A K Q` -> `matchCount = 3`, `reelIndexes = [0,1,2]`) | PASS |
| `TEST 3` | One match / mismatch on reel 1 (`A K A A A` -> `matchCount = 1`, `reelIndexes = [0]`) | PASS |
| `TEST 4` | Diagonal / V-shape (`[0,1,2,1,0]`) reads exact cells `(0,0),(1,1),(2,2),(3,1),(4,0)` | PASS |
| `TEST 5` | Zigzag (`[2,0,2,0,2]`) reads exact cells `(0,2),(1,0),(2,2),(3,0),(4,2)` | PASS |
| `TEST 6` | Multiple paylines produce independent `PaylineMatch` results | PASS |
| `TEST 7` | Disabled paylines are skipped and produce no results | PASS |
| `TEST 8` | Invalid payline pattern length throws `PaylineGridMismatchError` | PASS |
| `TEST 9` | Out-of-bounds or non-integer row index throws `InvalidRowIndexError` | PASS |
| `TEST 10` | Missing/duplicate payline IDs, invalid enabled state, or malformed board throws structured errors | PASS |
| `TEST 11` | Deterministic output for identical `Board` + `GameConfig.paylines` | PASS |
| `TEST 12` | Zero RNG usage (`SeededRNG` untouched, zero `Math.random()`) | PASS |
| `TEST 13` | Zero paytable payout/multiplier fields and zero embedded `SymbolDefinition` objects | PASS |
| `TEST 14` | Input immutability (`Board`, `GameConfig`, `PaylineDefinition[]` unchanged; outputs frozen) | PASS |
| `TEST 15` | Clean JSON serialization round-trip (`serializePaylineEvaluationResult` / `deserializePaylineEvaluationResult`) | PASS |
| Wild Boundary | `A WILD A A A` with `EXACT_SYMBOL_MATCH_POLICY` produces `matchCount = 1` | PASS |
| Scatter Boundary | Off-line scatters are never counted as payline matches | PASS |

---

## 9. Verification & Build Results
- `npm run typecheck`: **PASS** (`0` errors)
- `npm run lint`: **PASS** (`0` errors, `0` warnings)
- `npx tsx --test tests/payline-engine.test.ts`: **PASS** (`3/3` subtests passing)
- `npx tsx --test tests/*.test.ts`: **PASS** (`178/178` tests passing across all `27` test files)
- `npm run build`: **PASS** (`exit_code: 0`, Next.js 16.2.6 production build verified)

---

## 10. Known Limitations & Scope Boundaries (`B06+`)
- `B05` strictly evaluates contiguous left-to-right symbol matches along fixed paylines using exact symbol matching.
- Paytable payout calculation (`B06`), Wild substitution rules (`B07`), Scatter evaluation (`B08`), and Ways/Cluster/Pay-Anywhere evaluators (`B09+`) are intentionally deferred to their dedicated sections.
