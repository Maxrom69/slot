# B13 — Board Dynamics Engine Implementation Report

## 1. Section Identification
- **Section ID**: `B13`
- **Section Title**: Board Dynamics Engine
- **Architectural Layer**: Section 2 — Backend Slot Game Engine (`src/engine/dynamics/`)
- **Implementation Date**: 2026-10-16

---

## 2. Executive Summary
Implemented the **B13 Board Dynamics Engine** (`src/engine/dynamics/index.ts`), a headless, deterministic, immutable, JSON-serializable board-state transformation subsystem for the Backend Slot Game Engine (`src/engine/`). `DeterministicBoardDynamicsEngine` (`createBoardDynamicsEngine`) owns all 13 documented board-dynamics mechanics (`createBoardState`, `resolveMysteries`, `removeCells`, `placeSymbols`, `applyTumble`, `runCascadeLoop`, `resizeBoard`, `applyLocks`, `expireLocks`, `nudgeReel`, `applyLinkedReels`, `resolveVariableReelHeights`, `duplicateSymbols`, `applyLaneSweep`, `tagPositions`, `expireTags`, `getTaggedPositions`), integrating cleanly with `B03` (`RandomSource`), `B04` (`Board`, `Cell`, `ReelEngine`), `B05`–`B11` win evaluation engines, and `B12` (`FeatureEngine`) without inventing win rules or calling browser/UI APIs.

---

## 3. Requirements & Specification Coverage

| Requirement | Status | Implementation Reference |
| --- | --- | --- |
| 1. **Tumble / Cascade (`applyTumble`, `runCascadeLoop`)**: Exclude locked cells from removal, remove winning cells, compact survivors downward preserving cell-associated state, refill gaps from B04 circular strips or weighted B03 pools, return full transition (`removedCells`, `movedCells`, `refilledCells`), and loop until no wins remain with a safety cascade cap | COMPLETE | `DeterministicBoardDynamicsEngine.applyTumble`, `runCascadeLoop` (`src/engine/dynamics/index.ts`) |
| 2. **Board Resize (`resizeBoard`)**: Grow/shrink rows (`top`/`bottom`) and reels (`left`/`right`) within configurable min/max bounds and per-session resize event limits | COMPLETE | `DeterministicBoardDynamicsEngine.resizeBoard` (`src/engine/dynamics/index.ts`) |
| 3. **Held State Through Resize**: Preserve locked cells, tags, and attached prize values (`attachedValuesByCoord`) at shifted coordinates; leave newly inserted cells empty and unlocked; reject shrinking over locked cells | COMPLETE | `DeterministicBoardDynamicsEngine.resizeBoard` (`src/engine/dynamics/index.ts`) |
| 4. **Symbol Placement / Removal (`placeSymbols`, `removeCells`)**: Inject single symbols, expand Wilds across full reels, upgrade symbol IDs across the board, or clear cells while protecting locked positions | COMPLETE | `DeterministicBoardDynamicsEngine.placeSymbols`, `removeCells` (`src/engine/dynamics/index.ts`) |
| 5. **Mystery Symbols (`resolveMysteries`)**: Resolve mystery cells before payment in board-wide `sameSymbol` mode or per-cell `independent` mode from a weighted pool via `B03` `RandomSource` | COMPLETE | `DeterministicBoardDynamicsEngine.resolveMysteries` (`src/engine/dynamics/index.ts`) |
| 6. **Colossal Symbols**: Structured `ColossalSymbolInstance` (`instanceId`, `symbolId`, `anchor`, `width`, `height`, `coveredCells`, `clippedCells`, `isClipped`, `locked`, `attachedValue`) with deterministic edge clipping and single-instance identity preservation across board resizes | COMPLETE | `ColossalSymbolInstance`, `computeColossalCoverage` (`src/engine/dynamics/index.ts`) |
| 7. **Locked Cells (`applyLocks`, `expireLocks`)**: Central lock registry supporting `"round"` and finite `"spins"` lifetimes (`remainingSpins`), automatic expiration at spin/round boundaries, and protection against tumble, sweep, removal, and duplication | COMPLETE | `DeterministicBoardDynamicsEngine.applyLocks`, `expireLocks` (`src/engine/dynamics/index.ts`) |
| 8. **Reel Nudges (`nudgeReel`)**: Signed strip-position offset (`direction` + `steps` or `offsetSteps`) wrapping circularly around B04 reel strips and returning before/after stops and visible symbols | COMPLETE | `DeterministicBoardDynamicsEngine.nudgeReel` (`src/engine/dynamics/index.ts`) |
| 9. **Linked / Mirrored Reels (`applyLinkedReels`)**: Copy source reel visible symbols (`identical` or `mirrored`) to target reels while retaining target reel identity and rejecting self-links or cycles | COMPLETE | `DeterministicBoardDynamicsEngine.applyLinkedReels` (`src/engine/dynamics/index.ts`) |
| 10. **Variable Reel Heights (`resolveVariableReelHeights`)**: Resolve per-reel visible row counts from shared or per-reel `[minRows, maxRows]` ranges via `B03` `RandomSource` and produce unambiguous ragged boards | COMPLETE | `DeterministicBoardDynamicsEngine.resolveVariableReelHeights` (`src/engine/dynamics/index.ts`) |
| 11. **Symbol Duplication (`duplicateSymbols`)**: Duplicate source symbols into consecutive cells (`down`, `up`, `both`) within their reel while respecting reel bounds, locks, and protected tags | COMPLETE | `DeterministicBoardDynamicsEngine.duplicateSymbols` (`src/engine/dynamics/index.ts`) |
| 12. **Lane Sweeps (`applyLaneSweep`)**: Edge-entering sweeper (`left`, `right`, `top`, `bottom`) clearing rows or reels with configurable `fireChance`, `sweepsCount`, `travelDistance`, and `protectedTags` | COMPLETE | `DeterministicBoardDynamicsEngine.applyLaneSweep` (`src/engine/dynamics/index.ts`) |
| 13. **Tagged Positions (`tagPositions`, `expireTags`, `getTaggedPositions`)**: Tag cells in `random`, `onePerReel`, or `configured` mode with `"spin"` or `"feature"` lifetime via `B03` `RandomSource` | COMPLETE | `DeterministicBoardDynamicsEngine.tagPositions`, `expireTags`, `getTaggedPositions` (`src/engine/dynamics/index.ts`) |

---

## 4. Architecture & Module Design
- **`BoardState` Envelope**: Wraps the immutable `B04` `Board` along with deeply frozen, JSON-serializable state maps: `locksByCoord`, `tagsByCoord`, `colossalInstances`, `attachedValuesByCoord`, `reelHeights`, `reelStopIndexes`, and `resizeEventsCount`.
- **Canonical Execution Ordering**:
  1. Variable Reel Height Resolution (`resolveVariableReelHeights`)
  2. Initial Reel / Board Generation (`B04` `ReelEngine.resolve`)
  3. Linked Reel Copy (`applyLinkedReels`)
  4. Reel Nudges (`nudgeReel`)
  5. Tagged Position Selection (`tagPositions`)
  6. Colossal / Symbol Placement (`placeSymbols`)
  7. Mystery Resolution (`resolveMysteries`)
  8. Symbol Duplication (`duplicateSymbols`)
  9. Lane Sweeps (`applyLaneSweep`)
  10. Win Evaluation (`B05`–`B11`)
  11. Tumble / Cascade Loop (`applyTumble` / `runCascadeLoop`)
  12. Spin-End Lock & Tag Expiration (`expireLocks`, `expireTags`)

---

## 5. Files Created
1. `src/engine/dynamics/index.ts` — Full implementation of `DeterministicBoardDynamicsEngine`, `createBoardDynamicsEngine`, `BoardState`, and all 13 board-dynamics contracts.
2. `tests/board-dynamics-engine.test.ts` — Comprehensive 12-part verification suite covering all 13 board-dynamics mechanics and end-to-end integration with `B04`, `B10`, `B11`, and `B12`.
3. `docs/implementation/B13-board-dynamics-engine.md` — This implementation report.

---

## 6. Files Modified
1. `src/engine/errors/index.ts` — Added 12 structured B13 error codes (`INVALID_BOARD_DYNAMICS_CONFIG`, `INVALID_RESIZE_OPERATION`, `INVALID_MYSTERY_CONFIG`, `INVALID_COLOSSAL_SYMBOL`, `INVALID_LOCK_OPERATION`, `INVALID_REEL_NUDGE`, `INVALID_LINKED_REELS`, `INVALID_VARIABLE_HEIGHT_CONFIG`, `INVALID_DUPLICATION_OPERATION`, `INVALID_LANE_SWEEP`, `INVALID_TAG_OPERATION`, `CASCADE_LIMIT_EXCEEDED`) and corresponding error classes.
2. `src/engine/index.ts` — Exported `./dynamics` from the main engine barrel.
3. `docs/implementation/INDEX.md` — Added `B13` entry and updated cumulative test counts (`237/237` tests across `35` test files).
4. `docs/backups/Backup-Manifest.md` — Added `B13` incremental backup entry.

---

## 7. Files Deleted
- None (`0` files deleted).

---

## 8. Key Data Structures & Interfaces
- `BoardState`: `{ board, locksByCoord, tagsByCoord, colossalInstances, attachedValuesByCoord, reelHeights, reelStopIndexes, resizeEventsCount }`
- `TumbleResult` & `CascadeLoopResult`: `{ nextState, removedCells, movedCells, refilledCells, preservedLockedPositions, rngUsage }`
- `BoardResizeResult`: `{ nextState, applied, conflictReason, beforeDimensions, afterDimensions, addedPositions, removedPositions }`
- `MysteryResolutionResult`: `{ nextState, mode, originalMysteryCells, resolvedCells, rngUsage }`
- `ColossalSymbolInstance`: `{ instanceId, symbolId, anchor, width, height, coveredCells, clippedCells, isClipped, locked, attachedValue }`
- `LockRecord`, `LockUpdateResult`: `{ position, locked, lifetimeType, remainingSpins, attachedValue }`
- `ReelNudgeResult`, `LinkedReelsResult`, `VariableReelHeightResult`, `SymbolDuplicationResult`, `LaneSweepResult`, `PositionTagResult`.

---

## 9. Determinism, Immutability & Serialization Guarantees
- **Zero Ambient Randomness**: All stochastic choices (`resolveMysteries`, `applyTumble` weighted refill, `resolveVariableReelHeights`, `applyLaneSweep` fireChance, `tagPositions` random/onePerReel) require and consume a `B03` `RandomSource`. Zero `Math.random()` or `Date.now()` calls exist anywhere in `src/engine/dynamics/index.ts`.
- **Deep Immutability**: Every `BoardState` and operation result is recursively frozen (`deepFreeze`), and existing `Board` / `BoardState` inputs are never mutated in place.
- **JSON-Serializable State**: `BoardState` uses plain records (`Record<string, LockRecord>`, `Record<string, readonly PositionTagEntry[]>`, `Record<string, number>`) and arrays, with zero class instances, functions, or `Map`/`Set` fields.

---

## 10. Error Handling & Validation Model
- Structured subclasses of `SlotEngineError`:
  - `InvalidBoardDynamicsConfigurationError` (`INVALID_BOARD_DYNAMICS_CONFIG`)
  - `InvalidResizeOperationError` (`INVALID_RESIZE_OPERATION`)
  - `InvalidMysteryConfigurationError` (`INVALID_MYSTERY_CONFIG`)
  - `InvalidColossalSymbolError` (`INVALID_COLOSSAL_SYMBOL`)
  - `InvalidLockOperationError` (`INVALID_LOCK_OPERATION`)
  - `InvalidReelNudgeError` (`INVALID_REEL_NUDGE`)
  - `InvalidLinkedReelsError` (`INVALID_LINKED_REELS`)
  - `InvalidVariableHeightConfigurationError` (`INVALID_VARIABLE_HEIGHT_CONFIG`)
  - `InvalidDuplicationOperationError` (`INVALID_DUPLICATION_OPERATION`)
  - `InvalidLaneSweepError` (`INVALID_LANE_SWEEP`)
  - `InvalidTagOperationError` (`INVALID_TAG_OPERATION`)
  - `CascadeLimitExceededError` (`CASCADE_LIMIT_EXCEEDED`)

---

## 11. Testing & Verification Results
- **TypeScript Typecheck (`npm run typecheck`)**: `PASS` (`0` errors)
- **ESLint (`npm run lint`)**: `PASS` (`0` errors, `0` warnings)
- **B13 Unit & Integration Suite (`npx tsx --test tests/board-dynamics-engine.test.ts`)**: `PASS` (`12/12` subtests passing)
- **Full Repository Test Suite (`npx tsx --test --test-concurrency=1 tests/*.test.ts`)**: `PASS` (`237/237` tests passing across `35` test files)
- **Production Build (`npm run build`)**: `PASS` (Next.js 16.2.6 production build succeeded cleanly)

---

## 12. Integration with Existing Sections
- **B03 (`rng`)**: Used for deterministic weighted mystery selection, weighted tumble refills, variable reel height selection, lane sweep fire-chance rolls, and random/one-per-reel position tagging.
- **B04 (`board`, `reels`)**: Consumes and produces canonical `Board` and `Cell` structures (`locked`, `colossalGroupId`, `stopId`, `tags`) and wraps circular reel strips during `nudgeReel` and `applyTumble`.
- **B05–B11 (`paylines`, `ways`, `clusters`, `payanywhere`)**: Consumes winning cell positions from any evaluation engine during `applyTumble` / `runCascadeLoop` and emits updated `Board` snapshots ready for re-evaluation (including ragged boards).
- **B12 (`features`)**: `FeatureEngine` `boardModHook` actions coordinate cleanly with `BoardDynamicsEngine` without duplicating board mutation logic.

---

## 13. Edge Cases & Boundary Conditions Handled
- Locked cells inside a winning cluster or tumble removal set are automatically excluded from removal and remain anchored at their coordinates while unlocked cells above/around them compact.
- Shrinking a board (`resizeBoard`) when a locked cell occupies a row or reel scheduled for removal is safely rejected (`applied: false, conflictReason: "lockedCellConflict"`) or throws `InvalidResizeOperationError` when `throwOnConflict: true`.
- Colossal symbols anchored near the right or bottom board edge are deterministically clipped (`isClipped: true`, `clippedCells` populated) and automatically recompute their `coveredCells` if the board subsequently grows or shrinks.
- Linked reel specifications with self-links (`0 -> 0`), duplicate targets, or multi-step cycles (`0 -> 1` and `1 -> 2`) throw `InvalidLinkedReelsError`.
- Runaway cascade loops throw `CascadeLimitExceededError` once `safetyMaxCascades` is reached.

---

## 14. Known Limitations & Deferred Scope
- None within `B13` scope. Full spin-round orchestration combining base spin, board dynamics, win evaluation, multipliers, and feature triggers into a single unified spin lifecycle is deferred to `B14+`.

---

## 15. Google Drive Backup Synchronization
- **Target Folder**: `Slot Studio Backups/B - Backend/B13/`
- **Delta Files Backed Up**:
  1. `src/engine/dynamics/index.ts` (Created)
  2. `src/engine/errors/index.ts` (Modified)
  3. `src/engine/index.ts` (Modified)
  4. `tests/board-dynamics-engine.test.ts` (Created)
  5. `docs/implementation/B13-board-dynamics-engine.md` (Created)
  6. `docs/implementation/INDEX.md` (Modified)
  7. `docs/backups/Backup-Manifest.md` (Modified)

---

## 16. Next Section Readiness (`B14`)
- `B13 — Board Dynamics Engine` is complete, verified, documented, and backed up.
- Per the Arena Checkpoint Rule, execution stops here and awaits explicit user confirmation before proceeding to `B14`.
