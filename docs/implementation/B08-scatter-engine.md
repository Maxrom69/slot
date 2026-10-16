# B08 — Scatter Engine

| Field | Value |
| --- | --- |
| **Section ID** | `B08` |
| **Phase** | `B — Backend Engine` (`Section 2 — Backend Slot Game Engine`) |
| **Title** | Scatter Engine |
| **Status** | `Complete & Verified` |
| **Date** | `2026-10-13` |
| **Dependencies** | `B01` (Engine Architecture), `B02` (Game Definition Schema), `B04` (Reel Engine & Board), `B06` (Paytable Engine) |

---

## 1. Section Identifier and Title

**`B08 — Scatter Engine`** (`src/engine/scatters/index.ts`, `src/engine/errors/index.ts`, `src/engine/schema/types.ts`, `src/engine/config/index.ts`, `src/engine/index.ts`, `tests/scatter-engine.test.ts`).

---

## 2. Executive Summary

`B08` implements the deterministic, configuration-driven **Scatter Engine** for Section 2 of the Slot Studio Backend Slot Game Engine. It evaluates configured Scatter symbols across the authoritative `B04` `Board` by their **total count anywhere on the board**, completely independent of fixed paylines (`B05`), ways, or adjacency, and reports both Scatter payouts (`B06` multiplier $\times$ bet) and feature trigger eligibility without mutating the `Board`, consuming RNG (`B03`), performing Wild substitution (`B07`), or executing features (`B12`).

### Documented Scatter Mechanics
1. **Board-Wide Counting & Position Independence**:
   - Each configured Scatter rule scans `board.cells[reelIndex][rowIndex]` across all reels and rows.
   - Moving the same number of Scatter symbols to any coordinates on the board produces the exact same `count`, `eligible`, `payoutMultiplier`, `payout`, and `triggerEligible` result.
   -Matched `positions` (`ScatterCellPosition[]`) are returned for frontend highlighting and replay diagnostics without influencing qualification.
2. **Why Paylines Are Not Involved**:
   - Fixed paylines (`B05`) evaluate left-to-right contiguous symbol sequences along geometric row patterns. Scatters by definition pay and trigger regardless of reel alignment or payline geometry; therefore `B08` never inspects `PaylineMatch` data.
3. **Configurable Payout Tiers & Minimum Count**:
   - Scatter payout ladders map symbol counts (`2`, `3`, `4`, `5`, ...) to configured payout multipliers, reusing `B06` (`normalizePaytableLookup` and `roundCurrency`) or explicit rule-level `payouts`.
   - The minimum paying count (`minimumCount`) comes strictly from configuration (never hard-coded to `3`). Counts below `minimumCount` or counts with no configured tier return a non-paying result (`eligible = false`, `payoutMultiplier = 0`, `payout = 0`).
   - A configured tier with multiplier `0` returns a valid non-paying result (`matchedTier = count`, `eligible = false`, `payoutMultiplier = 0`, `payout = 0`).
4. **Over-Cap Count Policy**:
   - When the board contains more Scatter symbols than the highest configured payout tier (`count > maxConfiguredTier`), `B08` applies the explicit `overCapPolicy`:
     - `"highestTier"` (default preferred policy): awards the highest configured payout tier that applies (`matchedTier = maxConfiguredTier`, `overCapApplied = true`).
     - `"exactOnly"`: requires an exact tier match and returns non-paying when `count` exceeds `maxConfiguredTier`.
5. **Payout Calculation & Additive Behavior**:
   - Given `PayoutContext { bet }` (validated as finite and non-negative), `payout = roundCurrency(payoutMultiplier * bet)`.
   - Scatter payouts are strictly **additive** to regular `B05`/`B06`/`B07` line payouts (`combineLineAndScatterPayouts`), never replacing line wins.
   - When multiple independent Scatter symbol types are configured, each is evaluated according to its own rule and summed into `totalScatterPayout`.
6. **Trigger Separation & Feature Non-Execution**:
   - Payout eligibility (`eligible`) and feature trigger eligibility (`triggerEligible`, `triggerFeatureId`, `minimumTriggerCount`) are evaluated independently: a Scatter count can pay without triggering a feature, or trigger a feature with a `0` payout.
   - `B08` reports `triggerEligible` and `triggered` for downstream `B12` consumption and **never** starts Free Spins or mutates feature session state.
7. **Wild Interaction**:
   - Wild symbols are **never** automatically counted as Scatters. Only symbols explicitly configured for a Scatter rule (or its configured `groupSymbolIds` / `familyId` when family counting is enabled) are counted.

---

## 3. Scope Completed vs Deferred

### Completed in `B08`
1. `ScatterEngine` & `DeterministicScatterEngine` (`createScatterEngine`, `evaluateScatters`, `normalizeScatterConfiguration`, `validateBoardForScatters`, `validateScatterPayoutContext`).
2. Support for `GameConfig`, `GameDefinition`, `ScatterConfiguration`, and `ScatterEngineConfigObject` sources.
3. Board-wide, position-independent Scatter counting with multiple independent Scatter symbol support and explicit family/group support.
4. Count-based payout ladder resolution with configurable `minimumCount`, `overCapPolicy` (`"highestTier"` and `"exactOnly"`), and `B06` paytable lookup reuse.
5. Separate payout qualification (`eligible`, `payoutMultiplier`, `payout`) and feature trigger reporting (`triggerEligible`, `triggerFeatureId`, `minimumTriggerCount`, `triggered`, `triggeredFeatureIds`).
6. Additive payout combiner (`combineLineAndScatterPayouts`) and lossless JSON serialization (`serializeScatterEvaluationResult`, `deserializeScatterEvaluationResult`).
7. Structured `B08` error classes (`InvalidScatterConfigurationError`, `UnknownScatterSymbolError`, `InvalidScatterThresholdError`, `InvalidScatterPayoutError`, plus `InvalidBetError` and `InvalidBoardError`).
8. Comprehensive `tests/scatter-engine.test.ts` covering `TEST 1` through `TEST 18`, over-cap policies, multi-scatter summation, structured error validation, and full `B02 -> B04 -> B05 -> B06 -> B07 -> B08` pipeline integration.

### Explicitly Deferred (`B09+`)
- Ways Engine (`B09`)
- Cluster & Pay-Anywhere Engines
- Feature Engine / Free Spins state transitions (`B12`)
- Full Spin Lifecycle orchestration and RTP simulation

---

## 4. Architectural Decisions and Rationale

1. **Direct Consumption of Authoritative `B04` `Board`**:
   - `B08` reads `board.cells[reelIndex][rowIndex]` directly and validates board integrity with `InvalidBoardError`, guaranteeing that Scatter evaluation sees the exact landed grid without touching reel strips or RNG.
2. **Reuse of `B06` Paytable Infrastructure**:
   - `B08` reuses `normalizePaytableLookup` and `roundCurrency` from `src/engine/paytable/index.ts` so Scatter tier multipliers stored in the canonical paytable and currency rounding rules share a single authoritative implementation.
3. **Strict Trigger vs. Payout Decoupling**:
   - Keeping `eligible` (payout $> 0$) and `triggerEligible` (`hasTrigger && count >= minimumTriggerCount`) independent allows games to configure paying non-triggering counts (e.g., 2 Scatters pay `2x`, 3+ trigger Free Spins) as well as non-paying trigger-only Scatters (`0x` payout, 3+ trigger Free Spins) while leaving feature execution to `B12`.

---

## 5. Exact Files Created or Modified

| File Path | Action | Purpose |
| --- | --- | --- |
| `src/engine/scatters/index.ts` | Created | Core `B08` Scatter Engine (`ScatterEngine`, `DeterministicScatterEngine`, `createScatterEngine`, `evaluateScatters`, `ScatterResult`, `ScatterEvaluationResult`, `combineLineAndScatterPayouts`, and serialization helpers). |
| `src/engine/errors/index.ts` | Modified | Added `B08` structured error codes and classes (`InvalidScatterConfigurationError`, `UnknownScatterSymbolError`, `InvalidScatterThresholdError`, `InvalidScatterPayoutError`). |
| `src/engine/schema/types.ts` | Modified | Extended `ScatterRule` and `ScatterConfiguration` with optional `minimumCount`, `payouts`, `familyId`, `groupSymbolIds`, `overCapPolicy`, and `triggersFeature`. |
| `src/engine/config/index.ts` | Modified | Extended `GameConfig` with `scatterConfiguration?: ScatterConfiguration` populated during `adaptBlueprintToGameConfig`. |
| `src/engine/index.ts` | Modified | Exported `./scatters` from the Backend Slot Game Engine barrel. |
| `tests/scatter-engine.test.ts` | Created | `B08` unit & integration test suite (`TEST 1`–`TEST 18`, over-cap policies, error validation, and `B02`–`B08` pipeline integration). |
| `docs/implementation/B08-scatter-engine.md` | Created | This `B08` implementation report. |
| `docs/implementation/INDEX.md` | Modified | Added `B08` entry to the master implementation report index. |
| `docs/backups/Backup-Manifest.md` | Modified | Recorded `B08` incremental Google Drive backup entries and file IDs. |

---

## 6. Key Interfaces, Types, Functions, Classes, and Schemas

- `ScatterEngine` & `DeterministicScatterEngine` (`src/engine/scatters/index.ts`):
  - `evaluate(board: Board, configOrContext?: ScatterEngineSource | PayoutContext, maybeContext?: PayoutContext): ScatterEvaluationResult`
  - `evaluateSymbol(board: Board, symbolId: SymbolId, configOrContext?: ScatterEngineSource | PayoutContext, maybeContext?: PayoutContext): ScatterResult`
  - `isScatterSymbol(symbolId: SymbolId, config?: ScatterEngineSource): boolean`
  - `getNormalizedConfig(config?: ScatterEngineSource): NormalizedScatterConfig`
- `ScatterResult` (`ScatterEvaluation`):
  - `symbolId`, `countedSymbolIds`, `count`, `minimumCount`, `matchedTier`, `overCapApplied`, `eligible`, `payoutMultiplier`, `payout`, `triggerEligible`, `minimumTriggerCount`, `triggerFeatureId`, `positions`.
- `ScatterEvaluationResult`:
  - `scatters`, `bet`, `totalScatterMultiplier`, `totalScatterPayout`, `triggered`, `triggeredFeatureIds`.

---

## 7. Data Models, State Changes, and Persistence Impact

- **Engine In-Memory State**: `DeterministicScatterEngine` compiles an immutable `NormalizedScatterConfig` with `O(1)` `Map` and `Set` lookups for Scatter symbol IDs, counted family/group symbol IDs, and count-to-multiplier tiers.
- **Database / Persistence Impact**: None. `B08` is a pure, stateless backend engine module with zero database or browser storage dependencies.

---

## 8. Validation Rules and Error Handling

| Error Class | Error Code | Trigger Condition |
| --- | --- | --- |
| `InvalidScatterConfigurationError` | `INVALID_SCATTER_CONFIG` | Null/non-object config, missing `rules`/`symbolIds`, duplicate rule for the same `scatterSymbolId`, `evaluatesAnywhere: false`, `independentOfPaylines: false`, or unsupported `overCapPolicy`. |
| `UnknownScatterSymbolError` | `UNKNOWN_SCATTER_SYMBOL` | `scatterSymbolId`, `payoutReferenceSymbolId`, or `groupSymbolId` not present in `knownSymbolIds`, or `evaluateSymbol` called for a non-Scatter symbol. |
| `InvalidScatterThresholdError` | `INVALID_SCATTER_THRESHOLD` | Non-integer or $< 1$ `minimumCount`, `minimumTriggerCount`, or payout tier count key. |
| `InvalidScatterPayoutError` | `INVALID_SCATTER_PAYOUT` | Negative, `NaN`, `Infinity`, or non-numeric payout multiplier in `payouts` or paytable reference. |
| `InvalidBetError` | `INVALID_BET` | Negative, `NaN`, `Infinity`, or non-numeric `bet` in `PayoutContext`. |
| `InvalidBoardError` | `INVALID_BOARD` | Null/malformed `Board`, invalid `reelCount`/`rowCount`, column length mismatch, or cell missing `symbolId`. |

---

## 9. Edge Cases Handled

1. **Position Independence**: Scatters stacked on a single reel (`reelIndex = 4`) or scattered off all active paylines produce the exact same count, payout, and trigger eligibility as Scatters on paylines.
2. **Over-Cap Counts (`count > maxConfiguredTier`)**: Defaults to `"highestTier"` (e.g., 6 Scatters on a 5-tier ladder awards the 5-Scatter tier with `overCapApplied: true`), while supporting `"exactOnly"` when configured.
3. **Missing Intermediate Tier**: If tiers `3` and `5` are configured without tier `4`, landing `4` Scatters returns a non-paying result (`matchedTier: null`, `eligible: false`, `payout: 0`) rather than silently downgrading.
4. **Zero-Payout Trigger Tier**: A configured tier with multiplier `0` and `minimumTriggerCount = 3` returns `eligible: false`, `payout: 0`, and `triggerEligible: true`.
5. **Multiple Scatter Symbols**: Evaluates each configured Scatter symbol independently and sums their payouts into `totalScatterPayout`.

---

## 10. Verification Steps and Commands Executed

```bash
npx tsx --test tests/scatter-engine.test.ts tests/engine-architecture.test.ts
npm run typecheck
npm run lint
rm -f .local/slot-studio-db.json && npx tsx --test tests/dashboard.test.ts && npx tsx --test tests/*.test.ts
npm run build
```

---

## 11. Build, Typecheck, Lint, and Test Results

- `npm run typecheck`: **0 errors** (`tsc --noEmit`).
- `npm run lint`: **0 errors, 0 warnings** (`eslint .`).
- `npx tsx --test tests/scatter-engine.test.ts`: **3/3 subtests passing** covering `TEST 1` through `TEST 18`, over-cap policies, multi-scatter summation, structured errors, and `B02`–`B08` pipeline integration.
- `npx tsx --test tests/*.test.ts`: **187/187 tests passing** across **30 test files** (`0` failures).
- `npm run build`: **Production Next.js build succeeded** with `0` errors and `0` warnings.

---

## 12. Known Limitations

- `B08` evaluates count-based Scatter payouts and reports feature trigger eligibility (`triggerEligible`, `triggeredFeatureIds`). Actual feature state transitions (starting Free Spins, bonus rounds, or respins) are intentionally deferred to `B12` (Feature Engine), and Ways/Cluster/Pay-Anywhere evaluations are deferred to `B09+`.

---

## 13. Handoff Notes for the Next Section (`B09`)

- Downstream evaluators and the Spin Lifecycle orchestrator can invoke `scatterEngine.evaluate(board, gameConfig, { bet })` alongside `B05`/`B06`/`B07` payline evaluation and combine their payouts additively via `combineLineAndScatterPayouts(linePayoutResult, scatterResult)`.
- `B12` (Feature Engine) can consume `scatterResult.triggered`, `scatterResult.triggeredFeatureIds`, and each `ScatterResult.triggerEligible` / `triggerFeatureId` / `count` directly.

---

## 14. Backup Folder Path in Google Drive

- `Slot Studio Backups/B - Backend/B08/` (Folder ID: recorded in `docs/backups/Backup-Manifest.md`).

---

## 15. List of Files Uploaded to Google Drive for `B08`

1. `src/engine/scatters/index.ts`
2. `src/engine/errors/index.ts`
3. `src/engine/schema/types.ts`
4. `src/engine/config/index.ts`
5. `src/engine/index.ts`
6. `tests/scatter-engine.test.ts`
7. `docs/implementation/B08-scatter-engine.md`
8. `docs/implementation/INDEX.md`
9. `docs/backups/Backup-Manifest.md`

---

## 16. Verification Result of the Google Drive Backup

- Verified via `google_drive` connector that all 9 `B08` delta files were uploaded to `Slot Studio Backups/B - Backend/B08/` preserving relative paths and synchronized with `Slot Studio Backups/Backup Manifest.md`.
