# B07 — Wild Engine

| Field | Value |
| --- | --- |
| **Section ID** | `B07` |
| **Phase** | `B — Backend Engine` (`Section 2 — Backend Slot Game Engine`) |
| **Title** | Wild Engine |
| **Status** | `Complete & Verified` |
| **Date** | `2026-10-13` |
| **Dependencies** | `B01` (Engine Architecture), `B02` (Game Definition Schema), `B04` (Reel Engine & Board), `B05` (Fixed Payline Engine), `B06` (Paytable Engine) |

---

## 1. Section Identifier and Title

**`B07 — Wild Engine`** (`src/engine/wilds/index.ts`, `src/engine/errors/index.ts`, `src/engine/config/index.ts`, `src/engine/index.ts`, `tests/wild-engine.test.ts`).

---

## 2. Executive Summary

`B07` implements the deterministic, configuration-driven **Wild Engine** for Section 2 of the Slot Studio Backend Slot Game Engine. It evaluates fixed paylines with configurable Wild substitution rules without mutating the authoritative `B04` `Board`, without consuming RNG (`B03`), and without calculating final `bet * multiplier` payouts (`B06`).

Key capabilities delivered:
- **Zero Hard-Coded Symbol IDs**: A symbol is identified as a Wild (`isWild(symbolId)`) and replaces target symbols (`canSubstitute(wildSymbolId, targetSymbolId, context)`) solely based on `GameConfig` / `WildConfiguration` rules.
- **Explicit Substitution & Exclusion Rules**: Supports `allowedSubstitutions: "allRegular"` as well as explicit symbol ID lists (`allowedSubstitutions: ["A", "K", "Q"]`), plus `excludedSymbolIds` that always take precedence (preventing Wild from substituting for Scatters, Bonuses, or excluded regular symbols).
- **Per-Reel & Per-Mode Activation**: Supports `activeReels` (`isWildActiveOnReel(symbolId, reelIndex, context)`) and `activeModes` (`"base"`, `"freeSpins"`, `"bonus"`, `"fixedPaylines"`, `"lines"`, `"ways"`, `"clusters"`, `"payAnywhere"`).
- **Contiguous Payline Resolution with Starting & Multiple Wilds**:
  - `A WILD A` $\rightarrow$ `A A A` (`baseSymbolId: "A"`, `matchCount: 3`, `substitutions` at reel `1`)
  - `A WILD WILD A` $\rightarrow$ `A A A A` (`baseSymbolId: "A"`, `matchCount: 4`, `substitutions` at reels `1`, `2`)
  - `WILD A A` $\rightarrow$ `A A A` (`baseSymbolId: "A"`, `matchCount: 3`, `substitutions` at reel `0`)
  - `WILD K K` $\rightarrow$ `K K K` (`baseSymbolId: "K"`, `matchCount: 3`, `substitutions` at reel `0`)
  - `A WILD K` $\rightarrow$ `A A` (`baseSymbolId: "A"`, `matchCount: 2`; `K` stops the run and is never mutated)
- **`paysOnOwn` & All-Wild Resolution**:
  - When `paysOnOwn = true`, pure-Wild runs (e.g., `WILD WILD WILD` followed by an excluded symbol) resolve as a Wild combination (`baseSymbolId = wildSymbolId`).
  - When `paysOnOwn = false`, Wilds do not create an independent Wild-only combination when followed by an excluded symbol (`resolvePayline` returns `null`).
  - When all symbols on an enabled payline are active Wilds (`WILD WILD WILD WILD WILD`), `resolvePayline` uses the configured `B06` paytable lookup to resolve the line to the **highest-value eligible symbol** (`isAllWild: true`) without computing any cash/credit payout.
- **Dual Actual & Effective Symbol Preservation**: Every `WildResolvedMatch` preserves `actualSymbols`, `effectiveSymbols`, `substitutions[]`, and `cellPositions[]` (each containing `actualSymbolId`, `effectiveSymbolId`, and `isSubstituted`), and is structurally compatible with `B05` `PaylineMatch` so `B06` can evaluate payouts directly.

---

## 3. Scope Completed vs Deferred

### Completed in `B07`
1. Configurable Wild identification (`isWild`, `isWildActiveOnReel`) and substitution checks (`canSubstitute`).
2. `B05`-compatible `SymbolMatchPolicy` factory (`createMatchPolicy(baseSymbolId, context)`).
3. Wild-aware single-payline and multi-payline evaluation (`resolvePayline`, `resolvePaylineMatch`, `resolvePaylines`, `evaluate`).
4. Starting-Wild, multiple-Wild, reel-restricted Wild, excluded-symbol, `paysOnOwn`, and All-Wild paytable-backed highest-value symbol resolution.
5. `GameConfig` normalization in `src/engine/config/index.ts` populating `wildConfiguration` from `GameBlueprint`.
6. Structured B07 error hierarchy (`InvalidWildConfigurationError`, `UnknownWildSymbolError`, `InvalidSubstitutionRuleError`, `InvalidWildContextError`, `InvalidPaytableReferenceError`).
7. Deterministic JSON serialization & deserialization (`serializeWildResolvedMatch`, `deserializeWildResolvedMatch`, `serializeWildPaylineEvaluationResult`, `deserializeWildPaylineEvaluationResult`).
8. Comprehensive `tests/wild-engine.test.ts` covering `TEST 1` through `TEST 20` plus the `PAYTABLE INTEGRATION TEST` and full `B02 -> B04 -> B07 -> B06` pipeline verification.

### Explicitly Deferred (`B08+`)
- Scatter evaluation (`B08`)
- Ways / Cluster / Pay-Anywhere evaluation
- Expanding, Sticky, Walking, or Multiplier Wild feature mutations
- Free Spins, Respins, Hold & Spin, and Cascade state machines
- Full Spin Lifecycle orchestration and RTP simulation

---

## 4. Architectural Decisions and Rationale

1. **Non-Destructive Resolution (`actualSymbols` + `effectiveSymbols`)**:
   - Mutating `Board` cells to replace `"WILD"` with `"A"` would destroy auditability, break multi-payline evaluation where the same Wild cell participates in two different paylines as two different target symbols (e.g., `"A"` on Line 1 and `"K"` on Line 2), and corrupt downstream scatter/feature checks.
   - Instead, `B07` keeps `Board` deeply frozen and records `actualSymbols`, `effectiveSymbols`, and `substitutions[]` on each `WildResolvedMatch`.
2. **Paytable Lookup Reuse Without Payout Calculation**:
   - Resolving an All-Wild line (`WILD WILD WILD WILD WILD`) requires knowing which eligible target symbol has the highest multiplier in the paytable.
   - `B07` reuses `normalizePaytableLookup` from `B06` (`src/engine/paytable/index.ts`) strictly to compare symbol multipliers and select the winning `baseSymbolId`, leaving `bet * multiplier` credit calculation exclusively in `B06`.
3. **Seamless Interoperability with `B05` and `B06`**:
   - `WildResolvedMatch` satisfies the structural contract of `B05` `PaylineMatch` (`paylineId`, `paylineIndex`, `symbolId`, `matchCount`, `reelIndexes`, `cellPositions`, `matchedStopIndexes`) while adding `baseSymbolId`, `matchedReels`, `actualSymbols`, `effectiveSymbols`, `substitutions`, `wildCount`, and `isAllWild`. This allows `B06` (`paytableEngine.evaluate(wildResult.matches, { bet })`) to price `B07` matches directly.

---

## 5. Exact Files Created or Modified

| File Path | Action | Purpose |
| --- | --- | --- |
| `src/engine/wilds/index.ts` | Created | Core `B07` Wild Engine (`WildEngine`, `DeterministicWildEngine`, `createWildEngine`, `WildResolvedMatch`, `WildSubstitutionEntry`, `WildEvaluationContext`, and serialization helpers). |
| `src/engine/errors/index.ts` | Modified | Added `B07` structured error classes (`InvalidWildConfigurationError`, `UnknownWildSymbolError`, `InvalidSubstitutionRuleError`, `InvalidWildContextError`, `InvalidPaytableReferenceError`). |
| `src/engine/config/index.ts` | Modified | Extended `GameConfig` with `wildConfiguration?: WildConfiguration` populated during `adaptBlueprintToGameConfig`. |
| `src/engine/index.ts` | Modified | Exported `./wilds` from the Backend Slot Game Engine barrel. |
| `tests/wild-engine.test.ts` | Created | `B07` unit & integration test suite (`TEST 1`–`TEST 20` + Paytable Integration Test). |
| `docs/implementation/B07-wild-engine.md` | Created | This `B07` implementation report. |
| `docs/implementation/INDEX.md` | Modified | Added `B07` entry to the master implementation report index. |
| `docs/backups/Backup-Manifest.md` | Modified | Recorded `B07` incremental Google Drive backup entries and file IDs. |

---

## 6. Key Interfaces, Types, Functions, Classes, and Schemas

- `WildEngine` & `DeterministicWildEngine` (`src/engine/wilds/index.ts`):
  - `isWild(symbolId: SymbolId): boolean`
  - `isWildActiveOnReel(symbolId: SymbolId, reelIndex: number, context?: WildEvaluationContext): boolean`
  - `canSubstitute(wildSymbolId: SymbolId, targetSymbolId: SymbolId, context?: WildEvaluationContext): boolean`
  - `createMatchPolicy(baseSymbolId: SymbolId, context?: WildEvaluationContext): SymbolMatchPolicy`
  - `resolvePayline(board: Board, payline: PaylineInput, context?: WildEvaluationContext): WildResolvedMatch | null`
  - `resolvePaylines(board: Board, paylinesOrConfig: readonly PaylineInput[] | GameConfig, context?: WildEvaluationContext): WildPaylineEvaluationResult`
- `WildResolvedMatch`:
  - `paylineId`, `paylineIndex`, `paylineName`, `pattern`, `symbolId`, `baseSymbolId`, `matchCount`, `reelIndexes`, `matchedReels`, `actualSymbols`, `effectiveSymbols`, `substitutions`, `wildCount`, `isAllWild`, `cellPositions`, `matchedStopIndexes`.
- `WildSubstitutionEntry`:
  - `reelIndex`, `rowIndex`, `actualSymbolId`, `effectiveSymbolId`, `wildSymbolId`, `stopIndex?`.
- `WildEvaluationContext`:
  - `reelIndex?`, `mode?`, `winMode?`, `paytable?`, `minMatchCount?`.

---

## 7. Data Models, State Changes, and Persistence Impact

- **Engine In-Memory State**: `DeterministicWildEngine` compiles an immutable `NormalizedWildEngineState` with `O(1)` `Set` and `Map` lookups for Wild symbol IDs, allowed target symbol sets, excluded symbol sets, active reel sets, and active mode sets.
- **Database / Persistence Impact**: None. `B07` is a pure, stateless backend engine module with zero database or browser storage dependencies.

---

## 8. Validation Rules and Error Handling

| Error Class | Error Code | Trigger Condition |
| --- | --- | --- |
| `InvalidWildConfigurationError` | `INVALID_WILD_CONFIG` | Null/non-object config, non-boolean `enabled`, missing `substitutionRules`, or declared Wild symbol missing a substitution rule. |
| `UnknownWildSymbolError` | `UNKNOWN_WILD_SYMBOL` | Empty/non-string symbol ID or symbol ID not present in the game's `knownSymbolIds` catalog. |
| `InvalidSubstitutionRuleError` | `INVALID_SUBSTITUTION_RULE` | Contradictory `allowedSubstitutions` + `excludedSymbolIds`, duplicate rule for the same `wildSymbolId`, negative/out-of-range `activeReels`, unsupported `activeModes`, non-boolean `paysOnOwn`, or non-positive `multiplier`. |
| `InvalidWildContextError` | `INVALID_WILD_CONTEXT` | Negative or non-integer `reelIndex`, invalid round `mode`, invalid `winMode`, or `minMatchCount < 1`. |
| `InvalidPaytableReferenceError` | `INVALID_PAYTABLE_REFERENCE` | Malformed paytable passed in `WildEngineConfigObject` or `WildEvaluationContext`. |

---

## 9. Edge Cases Handled

1. **Starting Wilds (`WILD A A` vs `WILD K K`)**: Automatically adopts the first non-Wild symbol following the leading Wild run (`A` or `K`) provided all leading Wilds are allowed to substitute for that target symbol on their respective reels.
2. **Multiple Consecutive & Non-Consecutive Wilds (`A WILD WILD A`, `WILD A WILD A`)**: Evaluates contiguous substitution from Reel `0` through the first non-matching reel.
3. **Wild Followed by Excluded Symbol (`WILD WILD WILD Q K` where `Q` is excluded)**:
   - When `paysOnOwn = true`: resolves as a 3-of-a-kind `WILD` match (`actualSymbols: ["WILD", "WILD", "WILD"]`, `effectiveSymbols: ["WILD", "WILD", "WILD"]`).
   - When `paysOnOwn = false`: returns `null` (no independent Wild-only combination).
4. **All-Wild Payline (`WILD WILD WILD WILD WILD`)**: Selects the highest-value eligible symbol from the configured paytable (e.g. `K` at `50x` over `A` at `25x` and `Q` at `15x`).
5. **Per-Reel Wild Inactivity (`activeReels: [0, 2, 3, 4]`)**: A `"WILD"` landing on Reel `1` is treated as inactive on Reel `1` (`isWildActiveOnReel("WILD", 1) === false`) and does not bridge `A` on Reel `0` to `A` on Reel `2`.

---

## 10. Verification Steps and Commands Executed

```bash
npx tsx --test tests/wild-engine.test.ts tests/engine-architecture.test.ts
npm run typecheck
npm run lint
npx tsx --test tests/*.test.ts
npm run build
```

---

## 11. Build, Typecheck, Lint, and Test Results

- `npm run typecheck`: **0 errors** (`tsc --noEmit`).
- `npm run lint`: **0 errors, 0 warnings** (`eslint .`).
- `npx tsx --test tests/wild-engine.test.ts`: **3/3 subtests passing** covering all 20 required scenarios + Paytable Integration Test.
- `npx tsx --test tests/*.test.ts`: **184/184 tests passing** across **29 test files** (`0` failures).
- `npm run build`: **Production Next.js build succeeded**.

---

## 12. Known Limitations

- `B07` evaluates Wild substitution strictly for fixed paylines (`B05` / `B06`). Scatter evaluation (`B08`), Ways, Clusters, Pay-Anywhere, and stateful Wild features (Expanding/Sticky/Walking Wilds, Wild Multipliers) are intentionally deferred to subsequent backend milestones.

---

## 13. Handoff Notes for the Next Section (`B08 — Scatter Engine`)

- `B08` can use `GameConfig.scatterSymbolIds` and `WildEngine.canSubstitute` (which excludes Scatter symbols by default unless configured otherwise) while evaluating board-wide Scatter counts and payouts independently of paylines.

---

## 14. Backup Folder Path in Google Drive

- `Slot Studio Backups/B - Backend/B07/` (Folder ID: recorded in `docs/backups/Backup-Manifest.md`).

---

## 15. List of Files Uploaded to Google Drive for `B07`

1. `src/engine/wilds/index.ts`
2. `src/engine/errors/index.ts`
3. `src/engine/config/index.ts`
4. `src/engine/index.ts`
5. `tests/wild-engine.test.ts`
6. `docs/implementation/B07-wild-engine.md`
7. `docs/implementation/INDEX.md`
8. `docs/backups/Backup-Manifest.md`

---

## 16. Verification Result of the Google Drive Backup

- Verified via `google_drive` connector that only the 8 `B07` delta files were uploaded to `Slot Studio Backups/B - Backend/B07/` and synchronized with `Slot Studio Backups/Backup Manifest.md` (`1ywWDjEyBILzUwQisarTT_73FN5GNY9w_`).
