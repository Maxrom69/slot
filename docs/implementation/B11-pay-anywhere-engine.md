# B11 — Pay-Anywhere Engine

## 1. Section Identifier & Title
- **Section ID**: `B11`
- **Title**: Pay-Anywhere Engine
- **Phase**: Section 2 — Backend Slot Game Engine (`src/engine/`)
- **Implementation Date**: 2026-10-16

---

## 2. Executive Summary
`B11` implements the deterministic, single-pass **Pay-Anywhere Engine** (`src/engine/payanywhere/index.ts`) for the Slot Studio Backend Game Engine. In Pay-Anywhere (All-Scatter / Gates-style) evaluation mode, a symbol wins when it appears at least $N$ times **anywhere** on the visible board (`B04`), with **no paylines**, **no adjacency requirement**, **no consecutive-reel requirement**, and **no positional requirement**. The engine scans the authoritative `Board` in a single pass ($O(\text{totalBoardCells})$), evaluates only configured eligible symbols (`eligibleSymbols` / `symbolRules`), optionally integrates with the `B07` `WildEngine` (`allowWildSubstitution`) and `B02` Symbol Families (`allowFamilyGrouping`), resolves count-tier multipliers through `B06` (`PaytableEngine` / `normalizePaytableLookup`), and returns an immutable, JSON-serializable `PayAnywhereEvaluationResult`.

---

## 3. Requirements & Acceptance Criteria Addressed
- **Single-Pass Board Counting (`B04` Input)**: Consumes the authoritative `Board` (`B04`) without deep-cloning or mutating it, building `cellsBySymbolId` and `wildCellsOnBoard` in one $O(\text{totalBoardCells})$ scan.
- **No Paylines, No Adjacency, No Consecutive Reels, Position Independence**: Matching symbols anywhere on the board (corners, edges, middle rows, non-adjacent checkerboard cells, or non-consecutive reels `0, 2, 4` with zero on `1, 3`) produce identical counts and count-tier multiplier awards.
- **Explicit Symbol Eligibility**: Evaluates only symbols configured in `eligibleSymbols` / `symbolRules`. Never automatically treats `SCATTER` or unconfigured symbols as Pay-Anywhere symbols.
- **Optional Wild Substitution (`B07` Integration)**: When `allowWildSubstitution === true`, delegates to `B07` `WildEngine` (`isWild`, `isWildActiveOnReel`, `canSubstitute`) so qualifying Wild cells contribute to each eligible symbol independently while preserving `actualSymbolId` (`"W"`) and `effectiveSymbolId` (`"A"`). When `allowWildSubstitution === false`, Wilds never contribute to non-Wild symbols.
- **Optional Family Grouping (`B02` Integration)**: When `allowFamilyGrouping === true`, groups configured `B02` family members (`SymbolFamilyDefinition`) into a single combined Pay-Anywhere count and payout evaluation.
- **Count-Tier Paytable Lookup (`B06` Integration)**: Resolves exact or highest-not-exceeding count tiers from `B06` (`8`, `9`, `10`, `12+`), keeping `count`, `baseMultiplier`, `effectiveMultiplier`, and optional `finalPayout` (`roundCurrency(effectiveMultiplier * bet)`) strictly separated.
- **Structured Error Model**: Validates configuration, symbol references, paytable references, and board structure with `InvalidPayAnywhereConfigurationError`, `UnknownPayAnywhereSymbolError`, `InvalidPaytableReferenceError`, and `InvalidBoardError`.

---

## 4. Architecture & Module Design

### 4.1 Core Evaluation Pipeline (`evaluatePayAnywhere`)
1. **Board Validation (`validateBoardForPayAnywhere`)**: Verifies `board.cells`, `board.reelCount`, column non-emptiness, cell coordinate consistency, and non-empty `symbolId`.
2. **Configuration & Symbol Registry Normalization (`normalizePayAnywhereConfiguration`)**: Validates `minimumMatchCount >= 1`, `eligibleSymbols`, and `symbolRules`, verifying all symbol references against `symbolRegistry` / `paytableLookup`.
3. **One-Pass Board Scan**: Iterates once through `board.cells` (`reelIndex` ASC, `rowIndex` ASC) to populate `cellsBySymbolId: Map<string, Cell[]>` and `wildCellsOnBoard: Cell[]`.
4. **Independent Eligible Symbol Evaluation**: For each configured eligible symbol (or family when `allowFamilyGrouping === true`):
   - Collects all natural matching cells from `cellsBySymbolId`.
   - When `allowWildSubstitution === true`, appends qualifying `B07` Wild cells (`actualSymbolId: wildId`, `effectiveSymbolId: targetSymbolId`, `isWild: true`).
   - Resolves `matchedTierCount` and `baseMultiplier` from `B06` paytable tiers.
   - Emits frozen `PayAnywhereWin` with `count`, `naturalCount`, `wildCount`, `qualifying`, `eligible`, `minimumCount`, `matchedTierCount`, `baseMultiplier`, `effectiveMultiplier`, `finalPayout`, and `matchedCells`.
5. **Immutable Result Aggregation**: Produces frozen `PayAnywhereEvaluationResult` with `wins`, `evaluatedSymbols`, `bySymbolId`, `evaluatedSymbolCount`, `qualifyingWinCount`, `totalBaseMultiplier`, `totalEffectiveMultiplier`, and optional `totalPayout`.

---

## 5. Files Created & Modified

| File Path | Action | Purpose |
| :--- | :--- | :--- |
| `src/engine/payanywhere/index.ts` | Created | Core `B11` Pay-Anywhere Engine (`evaluatePayAnywhere`, `DeterministicPayAnywhereEngine`, `createPayAnywhereEngine`, `normalizePayAnywhereConfiguration`, `validateBoardForPayAnywhere`, `serializePayAnywhereEvaluationResult`, `deserializePayAnywhereEvaluationResult`) |
| `src/engine/errors/index.ts` | Modified | Added `INVALID_PAY_ANYWHERE_CONFIG` and `UNKNOWN_PAY_ANYWHERE_SYMBOL` error codes and `InvalidPayAnywhereConfigurationError` and `UnknownPayAnywhereSymbolError` error classes |
| `src/engine/schema/types.ts` | Modified | Extended `PayAnywhereConfiguration` with optional `eligibleSymbols`, `allowWildSubstitution`, and `allowFamilyGrouping` |
| `src/engine/config/index.ts` | Modified | Added `payAnywhereConfiguration?: PayAnywhereConfiguration` on `GameConfig` and normalized it in `adaptBlueprintToGameConfig` |
| `src/engine/index.ts` | Modified | Exported `./payanywhere` from the engine barrel |
| `tests/payanywhere-engine.test.ts` | Created | 23-test suite covering `TEST 1` through `TEST 22`, Position Independence Test, and end-to-end B02+B03+B04+B06+B07+B11 integration |
| `docs/implementation/B11-pay-anywhere-engine.md` | Created | Section `B11` 16-item implementation report |
| `docs/implementation/INDEX.md` | Modified | Added `B11` entry to master implementation index |
| `docs/backups/Backup-Manifest.md` | Modified | Added `B11` Google Drive backup manifest entry |

---

## 6. Key Interfaces & Contracts

```ts
export interface PayAnywhereMatchedCell {
  readonly reelIndex: number;
  readonly rowIndex: number;
  readonly symbolId: string;
  readonly actualSymbolId: string;
  readonly effectiveSymbolId: string;
  readonly isWild: boolean;
  readonly stopIndex?: number;
}

export interface PayAnywhereWin {
  readonly symbolId: string;
  readonly familyId?: string;
  readonly count: number;
  readonly eligible: boolean;
  readonly qualifying: boolean;
  readonly minimumCount: number;
  readonly matchedTierCount: number | null;
  readonly baseMultiplier: number;
  readonly effectiveMultiplier: number;
  readonly finalPayout?: number;
  readonly totalPayout?: number;
  readonly wildCount: number;
  readonly naturalCount: number;
  readonly matchedCells: readonly PayAnywhereMatchedCell[];
}

export interface PayAnywhereEvaluationResult {
  readonly evaluationMode: "payAnywhere";
  readonly enabled: boolean;
  readonly wins: readonly PayAnywhereWin[];
  readonly evaluatedSymbols: readonly PayAnywhereWin[];
  readonly bySymbolId: Readonly<Record<string, PayAnywhereWin>>;
  readonly evaluatedSymbolCount: number;
  readonly qualifyingWinCount: number;
  readonly totalBaseMultiplier: number;
  readonly totalEffectiveMultiplier: number;
  readonly totalPayout?: number;
}
```

---

## 7. Integration with Existing Engine Modules
- **`B01` (`src/engine/config/index.ts`)**: `GameConfig` now carries frozen `payAnywhereConfiguration: PayAnywhereConfiguration`.
- **`B02` (`src/engine/schema/types.ts`)**: Consumes `PayAnywhereConfiguration`, `PayAnywhereSymbolRule`, and `SymbolFamilyDefinition`.
- **`B04` (`src/engine/board/index.ts`)**: Consumes authoritative `Board` and `Cell` coordinates (`reelIndex`, `rowIndex`, `symbolId`, `stopIndex`).
- **`B06` (`src/engine/paytable/index.ts`)**: Reuses `normalizePaytableLookup`, `PaytableEngine`, and `roundCurrency` for count-tier multiplier resolution and optional bet scaling.
- **`B07` (`src/engine/wilds/index.ts`)**: Reuses `WildEngine` (`isWild`, `isWildActiveOnReel`, `canSubstitute`) when `allowWildSubstitution === true`.

---

## 8. Error Handling & Validation
- `InvalidPayAnywhereConfigurationError` (`INVALID_PAY_ANYWHERE_CONFIG`): Thrown on null/non-object configuration, `minimumMatchCount < 1`, non-integer `minCount`, `maxCount < minCount`, or malformed serialized JSON payloads.
- `UnknownPayAnywhereSymbolError` (`UNKNOWN_PAY_ANYWHERE_SYMBOL`): Thrown when `eligibleSymbols`, `symbolRules`, family definitions, or board cells reference an unknown or empty symbol ID.
- `InvalidBoardError` (`INVALID_BOARD`): Thrown on null/empty boards, mismatched `reelCount`, or malformed cell coordinates.
- `InvalidPaytableReferenceError` (`INVALID_PAYTABLE_REFERENCE`): Thrown on malformed paytable tier tables.

---

## 9. Determinism & Immutability Guarantees
- **Zero RNG Usage**: `src/engine/payanywhere/index.ts` never imports or invokes any RNG, `Math.random()`, or `Date.now()`.
- **Deterministic Ordering**: `evaluatedSymbols` and `wins` follow the deterministic configuration order of `eligibleSymbols`, and `matchedCells` are sorted by `(reelIndex ASC, rowIndex ASC)`.
- **Deep Immutability**: All returned `PayAnywhereEvaluationResult`, `PayAnywhereWin`, and `PayAnywhereMatchedCell` objects are deeply frozen with `Object.freeze`, and the input `Board` is never mutated.

---

## 10. Testing & Verification Summary
Executed `npx tsx --test tests/payanywhere-engine.test.ts` (`23/23` tests passing):
- `TEST 1`: Qualifying Pay-Anywhere win (`8` scattered `A` symbols -> tier `8` win).
- `TEST 2`: Below-threshold count (`7` of `A` when min is `8` -> `qualifying: false`, `baseMultiplier: 0`).
- `TEST 3`: Higher count tier award (`12` of `A` -> tier `12` multiplier `15x`).
- `TEST 4`: Position independence (`Board A` corners/edges vs `Board B` middle rows -> identical count `8` and multiplier `2x`, distinct `matchedCells`).
- `TEST 5`: No adjacency required (`8` matching cells with Chebyshev distance $\ge 2$ -> awards Pay-Anywhere win).
- `TEST 6`: No consecutive reel requirement (`8` matching symbols only on reels `0`, `2`, `4` -> awards Pay-Anywhere win).
- `TEST 7`: Multiple symbols winning in same spin (`8` of `A`, `9` of `B`, `10` of `C` -> `3` independent `PayAnywhereWin` records).
- `TEST 8`: Non-eligible symbol (`X` appears `10` times, not in `eligibleSymbols` -> no win).
- `TEST 9`: Scatter exclusion (`SCATTER` appears `8` times, not in `eligibleSymbols` -> ignored by Pay-Anywhere Engine).
- `TEST 10`: Wild substitution disabled (`allowWildSubstitution: false`, `7` of `A` + `2` of `W` -> count stays `7`, no win).
- `TEST 11`: Wild substitution enabled (`allowWildSubstitution: true`, `7` of `A` + `2` of `W` -> count `9`, `matchedCells` preserves `actualSymbolId = "W"` and `effectiveSymbolId = "A"`).
- `TEST 12`: Wild blocked for restricted symbol (`W` excludes `SPECIAL` -> count stays `7`, no win).
- `TEST 13`: Wild reel restriction respected (`W` active only on `[1, 2, 3]`, `W` on reel `0` ignored).
- `TEST 14`: Wild contributes to multiple eligible symbols independently (`7` of `A`, `7` of `B`, `1` of `W` -> both `A` and `B` reach `8` and win).
- `TEST 15`: Family grouping disabled (`5` of `GEM_1` + `4` of `GEM_2` -> neither reaches `8`).
- `TEST 16`: Family grouping enabled (`5` of `GEM_1` + `4` of `GEM_2` -> combined count `9`, qualifying `GEM_FAMILY` win).
- `TEST 17`: Over-max count handling (`15` of `A` on `6x5` board, highest tier `12` -> count `15`, tier `12` multiplier awarded).
- `TEST 18`: Bet scaling (`effectiveMultiplier = 10`, `bet = 2.5` -> `finalPayout = 25`).
- `TEST 19`: Board immutability (`JSON.stringify(board)` identical before and after evaluation).
- `TEST 20`: Determinism (`100` identical runs produce deeply equal results).
- `TEST 21`: Invalid configuration rejection (`InvalidPayAnywhereConfigurationError`, `UnknownPayAnywhereSymbolError`, `InvalidBoardError`).
- `TEST 22`: Serialization round-trip (`serializePayAnywhereEvaluationResult` / `deserializePayAnywhereEvaluationResult`).
- `TEST 23`: End-to-end `B02 + B03 + B04 + B06 + B07 + B11` pipeline integration.

---

## 11. Build, Typecheck & Lint Results
- `npm run typecheck`: `0` errors
- `npm run lint`: `0` errors
- `npx tsx --test tests/*.test.ts`: `214/214` tests passing across `33` test suites
- `npm run build`: Production Next.js build succeeded cleanly

---

## 12. Performance Characteristics
- **Time Complexity**: $O(R \times C + |E| \times |W|)$ where $R \times C$ is the total number of board cells scanned once, $|E|$ is the number of configured eligible symbols, and $|W|$ is the number of Wild cells on the board.
- **Space Complexity**: $O(R \times C)$ for the single-pass bucket index and matched cell descriptors, with zero board cloning.

---

## 13. Security & Reliability Considerations
- All returned objects are frozen with `Object.freeze` to prevent downstream mutation.
- Unknown symbol IDs, negative/zero thresholds, and malformed boards fail fast with structured `SlotEngineError` subclasses.

---

## 14. Known Limitations & Deferred Scope
- `B11` strictly evaluates board-wide Pay-Anywhere counts and count-tier payouts for a single resolved `Board`.
- Unified multi-mode evaluation orchestration (`Paylines` + `Ways` + `Clusters` + `Pay-Anywhere` + `Scatters`) is deferred to `B12+`.
- Cascades/tumbles, symbol removal, feature state machines, Free Spins, and win multipliers are deferred to later backend phases (`B13+`).

---

## 15. Google Drive Backup Synchronization
All 9 files created or modified in `B11` are backed up under `Slot Studio Backups/B - Backend/B11/` (`src__engine__payanywhere__index.ts`, `src__engine__errors__index.ts`, `src__engine__schema__types.ts`, `src__engine__config__index.ts`, `src__engine__index.ts`, `tests__payanywhere-engine.test.ts`, `docs__implementation__B11-pay-anywhere-engine.md`, `docs__implementation__INDEX.md`, `docs__backups__Backup-Manifest.md`) and synchronized with the root `Backup Manifest.md`.

---

## 16. Next Architectural Phase Readiness
`B11 — Pay-Anywhere Engine` is complete, verified, documented, and backed up. Ready for `B12` upon explicit user instruction.
