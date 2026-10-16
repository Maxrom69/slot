# B06 — Paytable Engine

## 1. Section Metadata
- **Section ID**: `B06`
- **Section Name**: Paytable Engine
- **Category**: `B — Backend Slot Game Engine`
- **Completion Status**: `COMPLETE`
- **Verification Date**: `2026-10-12`

---

## 2. Executive Summary
`B06` implements the deterministic Paytable Engine (`src/engine/paytable/index.ts`) for the Section 2 Backend Slot Game Engine. Consuming `PaylineMatch[]` (or `PaylineEvaluationResult` from `B05`), a normalized `GameConfig` / `PaytableDefinition` (from `B01`/`B02`), and a `PayoutContext` (`{ bet }`), `B06` performs O(1) payout multiplier lookup by `(symbolId, matchCount)`, calculates individual line payouts (`multiplier * bet`), and aggregates `totalPayout` across all evaluated lines without reconstructing the board, reevaluating paylines, consuming RNG, performing Wild substitution (`B07`), or counting Scatters (`B08`).

---

## 3. Architectural Conventions & Rules

### 3.1 Payout Ladder & O(1) Lookup
- Each symbol in the paytable defines a payout ladder mapping `matchCount -> multiplier` (e.g., `A: { 3: 5, 4: 10, 5: 25 }`).
- `normalizePaytableLookup(source)` indexes `GameConfig`, `PaytableDefinition`, `CanonicalPaytableSymbolEntry[]`, or `Record<SymbolId, Record<number, number>>` into an immutable `ReadonlyMap<SymbolId, ReadonlyMap<number, number>>` and `knownSymbolIds: ReadonlySet<SymbolId>` so hot-path multiplier lookups (`getMultiplier(symbolId, matchCount)` / `getPayoutMultiplier(symbolId, matchCount)`) execute in O(1) time without array scanning or deep-cloning.

### 3.2 Multiplier Semantics, Bet Calculation & Numeric Precision
- Paytable values are pure multipliers (`payoutMultiplier`). Currency assumptions are never embedded into the paytable.
- Given a validated `PayoutContext` (`{ bet }`), each line's payout is calculated as:
  - `payout = multiplier === 0 || bet === 0 ? 0 : roundCurrency(multiplier * bet)`
- Exact integers are preserved verbatim; fractional decimal values are cleaned to 4 decimal places via `roundCurrency` (`Math.round((value + Number.EPSILON) * 10000) / 10000`) to eliminate IEEE-754 binary floating-point drift (e.g., `0.1 + 0.2`) without rounding intermediate values prematurely.
- `totalPayout` is the sum of individual `line.payout` values across all evaluated matches.

### 3.3 Missing Payout Tiers vs. Zero Payout vs. Invalid Multipliers
- **Missing Match Count Tier**: If `symbolId` exists in the paytable (e.g., tiers `3, 4, 5` are configured) and `B05` reports `matchCount = 2` (or `1`), `B06` resolves `multiplier = 0`, `payout = 0`, `isPaying = false`. It never falls back to another match count.
- **Configured Zero Payout**: A match tier explicitly configured with `0` (e.g., `{ 3: 0, 4: 4, 5: 12 }`) is a valid non-paying tier that resolves to `multiplier = 0`, `payout = 0`, `isPaying = false`.
- **Invalid Payout Multipliers**: Negative values (`< 0`), `NaN`, `Infinity`, `-Infinity`, or non-numeric multipliers are rejected with `InvalidPayoutMultiplierError`.
- **Invalid Bet Values**: Negative bets (`< 0`), `NaN`, `Infinity`, `-Infinity`, or non-numeric bets are rejected with `InvalidBetError`. Zero bet (`bet = 0`) is valid and deterministically produces `payout = 0` while preserving the resolved `multiplier`.

### 3.4 Strict Separation from B07 (Wilds) and B08 (Scatters)
- **Why Wild Substitution is Outside B06**: `B06` consumes already-resolved `PaylineMatch` records from `B05` (or later `B07`). For `A WILD A` under `B05`'s exact matching policy (`symbolId = "A", matchCount = 1`), `B06` looks up `paytable["A"][1]` (`0x`) and never inspects the board or substitutes Wilds.
- **Why Scatter Evaluation is Outside B06**: Scatters evaluate independently of paylines in `B08`. `B06` exposes reusable `getMultiplier(symbolId, matchCount)` / `getPayoutMultiplier(symbolId, matchCount)` lookup methods for future `B08` (Scatter) and `B09` (Ways/Cluster/Pay-Anywhere) evaluators, but never counts board-wide scatter symbols itself.

---

## 4. Structured Error Hierarchy (`src/engine/errors/index.ts`)
All `B06` errors extend `InvalidPaytableError` / `SlotEngineError`:
- `UnknownPaytableSymbolError` (`code: "UNKNOWN_PAYTABLE_SYMBOL"`)
- `InvalidMatchCountError` (`code: "INVALID_MATCH_COUNT"`)
- `InvalidPayoutMultiplierError` (`code: "INVALID_PAYOUT_MULTIPLIER"`)
- `InvalidBetError` (`code: "INVALID_BET"`)

---

## 5. Files Created
1. `tests/paytable-engine.test.ts` — Automated test suite (`B06.1`–`B06.3` covering `TEST 1` through `TEST 16` plus `B04 + B05 + B06` integration).
2. `docs/implementation/B06-paytable-engine.md` — This implementation report.

---

## 6. Files Modified
1. `src/engine/errors/index.ts` — Added `B06` error codes and structured error classes (`UnknownPaytableSymbolError`, `InvalidMatchCountError`, `InvalidPayoutMultiplierError`, `InvalidBetError`).
2. `src/engine/paytable/index.ts` — Implemented `PaytableEngine`, `DeterministicPaytableEngine`, `PayoutContext`, `PaylinePayout`, `PaytableEvaluationResult`, `normalizePaytableLookup`, `validateBetContext`, `createPaytableEngine`, `getPayoutMultiplier`, `evaluatePaytable`, `serializePaytableEvaluationResult`, and `deserializePaytableEvaluationResult` while preserving `B01` `PaytableResolver` compatibility.
3. `docs/implementation/INDEX.md` — Added `B06` entry and updated cumulative test counts (`181/181` across `28` test files).
4. `docs/backups/Backup-Manifest.md` — Logged incremental backup metadata for `B06`.

---

## 7. Files Deleted
- None (`0` files deleted).

---

## 8. Acceptance Criteria Traceability (`TEST 1`–`TEST 16`)
| Test / Criterion | Verification Target | Status |
| --- | --- | --- |
| `TEST 1` | Three-match payout (`A` 3-match `5x` at `bet = 2` -> `multiplier = 5`, `payout = 10`) | PASS |
| `TEST 2` | Four-match payout (`A` 4-match `10x` -> `20`; `K` 4-match `6x` -> `12`) | PASS |
| `TEST 3` | Five-match payout (`A` 5-match `25x` -> `50`; `K` 5-match `15x` -> `30`) | PASS |
| `TEST 4` | Missing match count (`matchCount = 2` -> `multiplier = 0`, `payout = 0`, non-paying) | PASS |
| `TEST 5` | Zero payout (`Q` 3-match configured `0` -> valid non-paying zero payout) | PASS |
| `TEST 6` | Multiple paylines (`A` 3-match `10` + `K` 4-match `12` -> `totalPayout = 22`) | PASS |
| `TEST 7` | Unknown symbol throws `UnknownPaytableSymbolError` (or `0` when explicitly opted in) | PASS |
| `TEST 8` | Invalid payout multiplier (`< 0`, `NaN`, `Infinity`) throws `InvalidPayoutMultiplierError` | PASS |
| `TEST 9` | Invalid bet (`< 0`, `NaN`, `Infinity`) throws `InvalidBetError` | PASS |
| `TEST 10` | Zero bet (`bet = 0`) produces deterministic `payout = 0` while preserving `multiplier` | PASS |
| `TEST 11` | Determinism (same inputs produce deep-equal `PaytableEvaluationResult`) | PASS |
| `TEST 12` | No RNG (`SeededRNG` untouched, zero `Math.random()`) | PASS |
| `TEST 13` | Input immutability (`GameConfig`, `PaytableDefinition`, `PaylineMatch[]` unchanged) | PASS |
| `TEST 14` | Serialization (`serializePaytableEvaluationResult` / `deserializePaytableEvaluationResult`) | PASS |
| `TEST 15` | Wild boundary (`A WILD A` with B05 `matchCount = 1` resolves to `0`, no Wild substitution) | PASS |
| `TEST 16` | Scatter boundary (board-wide scatters are not counted by B06) | PASS |

---

## 9. Verification & Build Results
- `npm run typecheck`: **PASS** (`0` errors)
- `npm run lint`: **PASS** (`0` errors, `0` warnings)
- `npx tsx --test tests/paytable-engine.test.ts`: **PASS** (`3/3` subtests passing)
- `npx tsx --test tests/*.test.ts`: **PASS** (`181/181` tests passing across all `28` test files)
- `npm run build`: **PASS** (`exit_code: 0`, Next.js 16.2.6 production build verified)

---

## 10. Known Limitations & Scope Boundaries (`B07+`)
- `B06` resolves paytable multipliers and bet-scaled payouts for already-identified symbol combinations.
- Wild substitution (`B07`), Scatter evaluation (`B08`), Ways/Cluster/Pay-Anywhere evaluators (`B09+`), and feature multipliers/free spins are deferred to their dedicated sections.
