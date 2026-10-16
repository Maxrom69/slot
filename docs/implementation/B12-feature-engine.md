# B12 — Feature Engine

## 1. Section Identifier & Title
- **Section ID**: `B12`
- **Title**: Feature Engine
- **Phase**: Section 2 — Backend Slot Game Engine (`src/engine/`)
- **Implementation Date**: 2026-10-16

---

## 2. Executive Summary
`B12` implements the deterministic **Feature Engine** (`src/engine/features/index.ts`) for the Slot Studio Backend Game Engine. The `DeterministicFeatureEngine` (`createFeatureEngine`) provides complete runtime orchestration for all documented Slot Studio feature mechanics while keeping `FeatureRuntimeState` strictly separated from `GameDefinition` / `GameConfig` and preserving all `B01`–`B11` contracts. It implements exact-threshold board triggers (`scatterCount`, `zoneCount`, `reelPresence`, `symbolCount`, `boardCondition`) with fire-once-per-board guarantees, separate feature runtime modes with alternate reel strips and base-reel restoration on exit, Free Spins with trigger-count scaling, retriggers, and retrigger batch caps, cumulative feature win accounting without fabricated zero-win summaries, Hold & Win / Respin state (`lockedCells`, respin counter reset on new lock, and single pool payout on completion), Feature Buy (`direct` entry and `guaranteedTriggerSpin` via `B03` `RandomSource`), Bonus Games (`wheel`, `pick`, `trail`, `crash`, `instantReveal`) with `B03` weighted outcomes and without-replacement multi-pick, Feature Upgrades carrying unspent spins forward, trigger-defined starting multipliers, and round controls (`winCap` exact trimming + spin termination and `winningSpinCap` counting winning spins rather than cascades).

---

## 3. Authoritative Feature Rules Implemented
1. **Feature Triggers**:
   - Supports `scatterCount` (with `B08` `ScatterEvaluationResult` or direct board counting), `zoneCount` (configured `reelIndexes`, `rowIndexes`, or `positions`), `reelPresence` (symbols appearing on specific reels with `requireAllReels`), `symbolCount`, and `boardCondition`.
   - Trigger thresholds are exact (`>= threshold` or `=== threshold`), and each qualifying board evaluation fires a trigger at most once (`firedEvaluationKeys`).
2. **Feature Modes & Alternate Reels**:
   - Features run in a separate runtime mode (`"freeSpins"`, `"holdAndWin"`, `"bonus"`, `"custom"`), activating feature-specific alternate reel strips (`activeReelSource: "feature"`) and restoring base-game reels (`activeReelSource: "base"`) when the feature exits.
3. **Free Spins**:
   - Supports initial free-spin awards (`initialSpins`), trigger-count scaling (`spinsByTriggerCount`), retriggers (`retriggerEnabled`, `retriggerSpins`, `retriggerSpinsByCount`), and optional retrigger batch caps (`maxRetriggerBatches`).
4. **Feature Win Accounting**:
   - Tracks `accumulatedFeatureWin` across all feature steps and exposes `featureWinSummary` on completion **only** when `accumulatedFeatureWin > 0` (never fabricates a zero-value feature-win event for a feature that paid nothing).
5. **Hold & Win / Respin State**:
   - Tracks `lockedCells`, `respinsRemaining`, `lockedSymbolCount`, `lockedPoolTotalValue`, `lockedPoolReadyToPay`, and `lockedPoolPaidOnce`. Newly locked symbols reset `respinsRemaining` to `initialRespins`; when the counter reaches `0` (or the board is full), the locked pool pays once.
6. **Feature Buy**:
   - Supports `"direct"` feature entry and `"guaranteedTriggerSpin"`, which uses `B03` `RandomSource` to construct a deterministic board guaranteed to land the exact required trigger-symbol count before entering the feature.
7. **Bonus Games**:
   - Supports `"wheel"`, `"pick"`, `"trail"`, `"crash"`, and `"instantReveal"` weighted outcome pools (`BonusOutcomeSector` containing `credits`, `action`/`actions`, or both). Uses `B03` `RandomSource.weightedPick`, enforces without-replacement multi-pick selection, and sums credits across selections.
8. **Feature Upgrades**:
   - `upgradeFeature(...)` carries unspent spins (`carriedSpins`), adds the target feature's awarded spins (`addedSpins`), activates the upgraded feature's mode, multiplier, and alternate reels, and records the transition in `upgradeHistory`.
9. **Feature Starting Multiplier**:
   - Triggers can define a fixed `startingMultiplier` or count-scaled `startingMultiplierByCount` so larger trigger counts open a feature at a higher multiplier.
10. **Round Control (`winCap` & `winningSpinCap`)**:
    - When `winCap` is reached or exceeded, trims `stepWinAwarded` to exact `winCap - featureWinBefore`, sets `accumulatedFeatureWin = winCap`, and terminates remaining spins (`endReason: "winCapReached"`).
    - `winningSpinCap` counts winning spins rather than cascades: a spin containing multiple cascades (`cascadeWins: [5, 10, 4, 6]`) still counts as **one** winning spin.

---

## 4. Architecture & Module Design

### 4.1 Core Separation of Concerns
- **`FeatureSpec` / `FeatureEngineConfiguration`**: Immutable declarative feature, trigger, free-spin, Hold & Win, bonus-game, feature-buy, and round-control specifications.
- **`FeatureTriggerSpec` & `FeatureTriggerEvaluation`**: Declarative board trigger conditions and structured evaluation output (`matched`, `alreadyFired`, `measuredValue`, `threshold`, `selectedFeatureId`, `matchedPositions`, `awardedSpins`, `startingMultiplier`).
- **`FeatureAction`**: Discriminated union of typed feature state transitions (`awardSpins`, `retrigger`, `enterFeature`, `upgradeFeature`, `addCredits`, `setMeter`, `incrementMeter`, `modifyFeatureState`, `boardModHook`, `endFeature`).
- **`FeatureRuntimeState`**: Immutable, JSON-serializable runtime state completely separate from `GameDefinition`, with `snapshot(state)` and `restore(json)` methods.
- **`FeatureEngineResult`**: Complete state-transition result contract for runtime continuation, replay verification, and future preview integration.

---

## 5. Files Created & Modified

| File Path | Action | Purpose |
| :--- | :--- | :--- |
| `src/engine/features/index.ts` | Modified | Implemented `B12` `DeterministicFeatureEngine`, `createFeatureEngine`, trigger evaluation, Free Spins, Hold & Win, Bonus Games, Feature Buy, Feature Upgrades, Round Caps, and `snapshot`/`restore` while preserving `B01` `FeatureProcessor` exports |
| `src/engine/errors/index.ts` | Modified | Added `INVALID_FEATURE_CONFIG`, `UNKNOWN_FEATURE_REFERENCE`, `INVALID_FEATURE_TRIGGER`, `INVALID_BONUS_POOL`, `INVALID_FEATURE_STATE`, `INVALID_FEATURE_ACTION` error codes and structured error classes |
| `tests/feature-engine.test.ts` | Created | Deterministic unit and integration test suite covering Categories `A` through `K` and all B12 edge cases |
| `docs/implementation/B12-feature-engine.md` | Created | Section `B12` 16-item implementation report |
| `docs/implementation/INDEX.md` | Modified | Added `B12` entry to master implementation index |
| `docs/backups/Backup-Manifest.md` | Modified | Added `B12` Google Drive backup manifest entry |

---

## 6. Key Interfaces & Contracts

```ts
export class DeterministicFeatureEngine {
  createInitialState(): FeatureRuntimeState;
  getActiveReels(state: FeatureRuntimeState): readonly NormalizedReelStrip[];
  evaluateTriggers(
    board: Board,
    state?: FeatureRuntimeState,
    options?: {
      readonly evaluationId?: string;
      readonly scatterResult?: ScatterEvaluationResult;
    },
  ): {
    readonly triggerResults: readonly FeatureTriggerEvaluation[];
    readonly nextState: FeatureRuntimeState;
  };
  startFeature(
    featureId: string,
    options?: {
      readonly previousState?: FeatureRuntimeState;
      readonly triggerCount?: number;
      readonly awardedSpinsOverride?: number;
      readonly startingMultiplierOverride?: number;
      readonly initialLockedCells?: readonly LockedFeatureCell[];
      readonly board?: Board;
      readonly cellValuesByCoord?: Readonly<Record<string, number>>;
    },
  ): FeatureEngineResult;
  runFeatureStep(
    state: FeatureRuntimeState,
    input?: FeatureStepInput,
  ): FeatureEngineResult;
  upgradeFeature(
    state: FeatureRuntimeState,
    targetFeatureId: string,
    options?: {
      readonly additionalSpinsOverride?: number;
      readonly multiplierOverride?: number;
    },
  ): FeatureEngineResult;
  buyFeature(
    featureId: string,
    options?: {
      readonly rng?: RandomSource;
      readonly previousState?: FeatureRuntimeState;
      readonly fillerSymbolIds?: readonly string[];
    },
  ): FeatureEngineResult;
  endFeature(
    state: FeatureRuntimeState,
    reason?: FeatureEndReason,
  ): FeatureEngineResult;
  applyAction(
    state: FeatureRuntimeState,
    action: FeatureAction,
  ): FeatureEngineResult;
  snapshot(state: FeatureRuntimeState): string;
  restore(serializedSnapshot: string): FeatureRuntimeState;
}
```

---

## 7. Integration with Existing Engine Modules
- **`B01` (`src/engine/config/index.ts`, `src/engine/core/index.ts`)**: `DeterministicFeatureEngine` accepts `GameConfig` directly or `FeatureEngineConfiguration`, and preserves `ArchitecturalFeatureProcessor` and `createFeatureProcessor`.
- **`B03` (`src/engine/rng/index.ts`)**: All weighted bonus selections (`rng.weightedPick`) and guaranteed-trigger feature-buy spins (`rng.nextInt`, `rng.pick`) use `RandomSource` and record `FeatureRngMetadata` (`drawsConsumed`, `snapshotBefore`, `snapshotAfter`).
- **`B04` (`src/engine/board/index.ts`)**: Consumes authoritative `Board` and `Position` coordinates for trigger evaluation and Hold & Win cell locking.
- **`B06` (`src/engine/paytable/index.ts`)**: Uses `roundCurrency` for exact currency/multiplier arithmetic without duplicating paytable lookup logic.
- **`B08` (`src/engine/scatters/index.ts`)**: Consumes `ScatterEvaluationResult` in `evaluateTriggers` when provided.

---

## 8. Error Handling & Validation
- `InvalidFeatureConfigurationError` (`INVALID_FEATURE_CONFIG`)
- `UnknownFeatureReferenceError` (`UNKNOWN_FEATURE_REFERENCE`)
- `InvalidFeatureTriggerError` (`INVALID_FEATURE_TRIGGER`)
- `InvalidBonusPoolError` (`INVALID_BONUS_POOL`)
- `InvalidFeatureStateError` (`INVALID_FEATURE_STATE`)
- `InvalidFeatureActionError` (`INVALID_FEATURE_ACTION`)

---

## 9. Determinism & Immutability Guarantees
- **Zero `Math.random()` / `Date.now()`**: All random decisions use `B03` `RandomSource`.
- **Deep Immutability**: Every `FeatureRuntimeState` and `FeatureEngineResult` is deeply frozen with `Object.freeze`.
- **Snapshot/Restore Equivalence**: Mid-feature `snapshot()` and `restore()` restores the exact runtime state, alternate reel bindings, meters, locked cells, and retrigger counters so subsequent steps produce identical results.

---

## 10. Testing & Verification Summary
Executed `npx tsx --test tests/feature-engine.test.ts` (`11/11` comprehensive test blocks passing):
- `A`: Scatter-triggered feature (exact threshold triggers, below threshold does not trigger, qualifying board fires once, and starting multiplier scales by count).
- `B`: Zone/reel trigger (symbol count inside configured area/zone, symbol presence on configured reels, and multiple triggers on one board).
- `C`: Free spins (initial award, trigger-count scaling, retrigger on final available spin, and retrigger batch cap).
- `D`: Alternate reels (feature reels activate during feature and base reels restore on exit).
- `E`: Feature accounting (cumulative feature win, no fake zero-win presentation when feature pays `0`, and `winCap` exact trimming + immediate termination).
- `F`: Winning-spin cap (counts winning spins accurately and treats multiple cascades on one spin as a single winning spin).
- `G`: Hold & Win (locked state persists, new lock resets respin counter, and zero counter ends feature and pays locked pool once).
- `H`: Bonus game weighted outcomes (deterministic seeded result, without-replacement multi-pick, pool exhaustion, and credit summation).
- `I`: Feature upgrade & Feature Buy (unspent spins carry forward, upgrade with `0` remaining spins, new spins added, upgraded mode & reels active, and direct + guaranteed-trigger Feature Buy).
- `J`: Determinism & structured validation errors (`UnknownFeatureReferenceError`, `InvalidBonusPoolError`, `InvalidFeatureTriggerError`, `InvalidFeatureConfigurationError`).
- `K`: Snapshot/restore (mid-feature snapshot & restore produces identical future trajectory as uninterrupted execution).

---

## 11. Build, Typecheck & Lint Results
- `npm run typecheck`: `0` errors
- `npm run lint`: `0` errors
- `npx tsx --test tests/*.test.ts`: `225/225` tests passing across `34` test suites
- `npm run build`: Production Next.js build succeeded cleanly

---

## 12. Performance Characteristics
- Trigger evaluation and Hold & Win cell locking run in $O(\text{totalBoardCells})$ single-pass board scans.
- State transitions and action applications are $O(1)$ per step.

---

## 13. Security & Reliability Considerations
- No silent repair of invalid feature configurations, empty bonus pools, or non-positive thresholds.
- Retrigger batch caps, win caps, and winning-spin caps prevent unbounded feature loops.

---

## 14. Known Limitations & Deferred Scope
- `B12` implements the Feature Engine, trigger evaluation, Free Spins, Hold & Win state, Bonus Games, Feature Buy, Feature Upgrades, Starting Multipliers, and Round Caps.
- Dedicated multiplier engine progression rules, cascade/tumble board re-fill loops, and board modifier execution (`symbolInjection`, `symbolRemoval`, `mystery`, `colossal`, `reelNudge`, `linkedReels`) are deferred to `B13+`.

---

## 15. Google Drive Backup Synchronization
All 6 files created or modified in `B12` are backed up under `Slot Studio Backups/B - Backend/B12/` and synchronized with the root `Backup Manifest.md`.

---

## 16. Next Architectural Phase Readiness
`B12 — Feature Engine` is complete, verified, documented, and backed up. Ready for `B13` upon explicit user instruction.
