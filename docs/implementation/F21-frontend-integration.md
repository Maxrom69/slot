# F21 — Frontend Integration

## 1. Section ID and Name
- **Section ID**: `F21`
- **Section Name**: `FRONTEND INTEGRATION`
- **Category**: `SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER` (`F - Frontend`)

## 2. Objective and Scope
Connect every frontend module of the Slot Studio Builder (`F01`–`F20`) through the central `GameBlueprint` single source of truth, eliminating duplicate authoritative state across editors, verifying the 14-stage end-to-end creation-to-export pipeline, enforcing cross-module dependency warnings (`Delete symbol`, `Delete element`, `Change grid size`), implementing Blueprint Import with schema validation and legacy `v0` version migration, providing manual Save + optional Autosave + Dirty Indicator, and guaranteeing consistent Undo/Redo and reload persistence across editors.

## 3. Requirements and Exclusions
### Functional Requirements
1. **Verify End-to-End Studio Flows (14 Stages)**:
   - `Dashboard` → `New Game` → `Project` → `Design` → `Symbol Set` → `Symbol` → `Canvas` → `Layers` → `Scenes` → `Reels` → `Paylines` → `Paytable` → `Preview` → `Export`.
2. **Central State Integration Rule**:
   - Every editor modifies central structured state (`GameBlueprint`).
   - No component keeps authoritative duplicate state that can drift away from `GameBlueprint`.
   - `reconcileBlueprintState(bp)` synchronizes `grid`, `reels`, `reelConfiguration`, `symbols`, `specialSymbols`, `symbolSets`, `elements`, `paylines`, `paylineConfiguration`, `paytable`, `paytableConfiguration`, `scenes`, and `animations`.
3. **Cross-Module Dependency Warnings & Safe Mutations**:
   - **Delete symbol** (`analyzeDeleteSymbolDependencies`, `deleteSymbolFromBlueprint`, `SymbolDeleteConfirmModal`):
     - Warns if referenced by `reel` (stop counts, empty-reel impact), `paytable` (of-a-kind payout multipliers and custom overrides), `payline-related configuration` (wild substitution across active paylines, minimum symbol threshold, full-line coverage), or `feature configuration` (Free Spins scatter trigger, Hold & Win / Pick Bonus trigger, Expanding Wilds, or explicit feature parameter references).
   - **Delete element** (`analyzeDeleteElementDependencies`, `deleteElementFromBlueprint`, `ElementDeleteConfirmModal`):
     - Warns if used by `scene layer` (placed scene objects, composed images, background artwork), `symbol set` (set ownership or frame/background reference), `animation` (animations targeting the element, its owned symbols, or its asset), or `asset reference` (primary asset, image history revisions, member symbol assets).
   - **Change grid size** (`analyzeGridSizeChangeDependencies`, `changeBlueprintGridSize`, `GridSizeChangeConfirmModal`):
     - Warns about incompatible paylines (`lengthMismatch`, `outOfBoundsColumns`), reel strip additions/truncations, way-evaluation capacity changes, and scene layout structures (`reels` layer and `reel_frame` / `symbol_set` scene objects).
4. **Blueprint Import, Schema Validation & Legacy Migration**:
   - `importAndMigrateBlueprint` and `BlueprintImportModal` import `v1` `GameBlueprint` JSON, `ProjectExportPackage` JSON, and legacy `v0` / unversioned blueprints.
   - Validates schema integrity via `validateBlueprint` and `validateBlueprintForExport`.
   - Migrates older versions (`v0` → `v1`, `reels.cols` → `reels.columns`, root `title`/`theme` → `meta`, derived `elements[]`, `reelConfiguration`, `paylineConfiguration`, and `paytableConfiguration`) and logs all applied migration steps.
5. **Save, Optional Autosave & Dirty Indicator**:
   - Manual `Save` button (`Ctrl/Cmd + S`), optional `Autosave` toggle (`900ms` debounced save when `autosaveEnabled && dirty`), and live `Saved` / `Unsaved` / `Saving…` dirty indicator across `StudioHeader`, `ProjectWorkspace`, `ReelEditorWorkspace`, `PaylineEditorWorkspace`, and `PaytableEditorWorkspace`.
6. **Consistent Cross-Editor Undo/Redo & Reload Persistence**:
   - `StudioEditorStore` and `StudioEditorProvider` maintain a unified command history stack (`undoStack`, `redoStack`) across editors (`crossRouteEditorCache`) and persist to both server (`saveWorkspaceBlueprint` / `workspaceApi.updateProject`) and local (`projectPersistence.saveProject`) stores so reloading the project never loses changes.

### Exclusions (Strictly Enforced)
- No Section 2 backend slot-game RNG, spin outcome generation, or fake math simulation.
- No AI generation, LLM APIs, or simulated AI chat/thinking workflows.
- No non-functional placeholder `"soon"` navigation items in integrated project workspaces.

## 4. Implementation Summary
- Created `src/lib/integration/types.ts`, `src/lib/integration/operations.ts`, and `src/lib/integration/index.ts` implementing:
  - `INTEGRATION_FLOW_STAGES` (all 14 studio flow stages) and `verifyBlueprintFlowReadiness(bp)`.
  - `reconcileBlueprintState(bp)` for deterministic zero-drift synchronization across all blueprint slices.
  - `analyzeDeleteSymbolDependencies(bp, symbolId)` and `deleteSymbolFromBlueprint(bp, symbolId, options)`.
  - `analyzeDeleteElementDependencies(bp, elementId)` and `deleteElementFromBlueprint(bp, elementId)`.
  - `analyzeGridSizeChangeDependencies(bp, nextColumns, nextRows)` and `changeBlueprintGridSize(bp, options)`.
  - `importAndMigrateBlueprint(rawInput, options)` for schema validation and `v0` → `v1` migration.
- Extended `src/lib/editor/commands.ts`, `src/lib/editor/store.ts`, and `src/lib/editor/EditorProvider.tsx` with `ADD_SYMBOL`, `DELETE_SYMBOL`, `CHANGE_GRID_SIZE`, `REPLACE_BLUEPRINT`, `autosaveEnabled`, `crossRouteEditorCache`, `importBlueprintJson`, and dual server + local persistence.
- Created `src/components/studio/IntegrationModals.tsx` providing `IntegrationFlowBar`, `SymbolDeleteConfirmModal`, `ElementDeleteConfirmModal`, `GridSizeChangeConfirmModal`, and `BlueprintImportModal`.
- Updated `StudioHeader.tsx`, `StudioShell.tsx`, `StudioNav.tsx`, `LeftNav.tsx`, `ProjectWorkspace.tsx`, `ProjectOverviewWorkspace.tsx`, `SymbolsWorkspace.tsx`, `ReelEditorWorkspace.tsx`, `PaylineEditorWorkspace.tsx`, and `PaytableEditorWorkspace.tsx` to expose the complete 14-stage navigation, dependency warning modals, Blueprint Import modal, dirty indicators, and optional Autosave toggles.

## 5. Files Created, Modified, or Deleted
### Created
- `src/lib/integration/types.ts`
- `src/lib/integration/operations.ts`
- `src/lib/integration/index.ts`
- `src/components/studio/IntegrationModals.tsx`
- `tests/frontend-integration.test.ts`
- `docs/implementation/F21-frontend-integration.md`

### Modified
- `src/lib/client/workspace-api.ts`
- `src/lib/editor/commands.ts`
- `src/lib/editor/store.ts`
- `src/lib/editor/EditorProvider.tsx`
- `src/components/shell/StudioHeader.tsx`
- `src/components/shell/StudioShell.tsx`
- `src/components/shell/StudioNav.tsx`
- `src/components/design/LeftNav.tsx`
- `src/components/project/ProjectWorkspace.tsx`
- `src/components/studio/ProjectOverviewWorkspace.tsx`
- `src/components/studio/SymbolsWorkspace.tsx`
- `src/components/studio/ReelEditorWorkspace.tsx`
- `src/components/studio/PaylineEditorWorkspace.tsx`
- `src/components/studio/PaytableEditorWorkspace.tsx`
- `docs/implementation/INDEX.md`
- `docs/backups/Backup-Manifest.md`

### Deleted
- None

## 6. Architecture and Dependencies
- Pure TypeScript integration domain layer (`src/lib/integration/*`) with zero React/DOM dependencies so all flow readiness checks, state reconciliations, dependency analyzers, and schema migrations are deterministically testable in Node.
- Reuses existing domain operations from `@/lib/blueprint/*`, `@/lib/design/migrate`, `@/lib/reels/operations`, `@/lib/paylines/operations`, `@/lib/paytable/operations`, `@/lib/scenes/operations`, and `@/lib/export/operations`.
- Zero external npm dependencies added.

## 7. Relevant Components, Interfaces, Schemas, Stores, and APIs
- **Interfaces (`src/lib/integration/types.ts`)**: `StudioFlowStageId`, `BlueprintFlowReadinessReport`, `SymbolDeleteDependencyReport`, `ElementDeleteDependencyReport`, `GridSizeChangeDependencyReport`, `GridChangeOptions`, `BlueprintMigrationImportResult`.
- **Operations (`src/lib/integration/operations.ts`)**: `INTEGRATION_FLOW_STAGES`, `verifyBlueprintFlowReadiness`, `reconcileBlueprintState`, `analyzeDeleteSymbolDependencies`, `deleteSymbolFromBlueprint`, `analyzeDeleteElementDependencies`, `deleteElementFromBlueprint`, `analyzeGridSizeChangeDependencies`, `changeBlueprintGridSize`, `importAndMigrateBlueprint`.
- **Store & Provider (`src/lib/editor/store.ts`, `src/lib/editor/EditorProvider.tsx`)**: `StudioEditorStore`, `StudioEditorProvider`, `crossRouteEditorCache`, `clearCrossRouteEditorCache`, `saveWorkspaceBlueprint`.
- **UI Components (`src/components/studio/IntegrationModals.tsx`)**: `IntegrationFlowBar`, `SymbolDeleteConfirmModal`, `ElementDeleteConfirmModal`, `GridSizeChangeConfirmModal`, `BlueprintImportModal`.

## 8. Data Flow and Persistence
1. User edits any slice in a studio workspace or dispatches an `EditorCommand` (`ADD_SYMBOL`, `UPDATE_SYMBOL`, `DELETE_SYMBOL`, `DELETE_ELEMENT`, `CHANGE_GRID_SIZE`, `UPDATE_REEL`, `UPDATE_PAYLINE`, `UPDATE_PAYTABLE`, `UPDATE_META`, `REPLACE_BLUEPRINT`).
2. `executeEditorCommand` applies the mutation and runs `reconcileBlueprintState(bp)` so every derived slice (`grid`, `reels`, `reelConfiguration`, `symbols`, `specialSymbols`, `symbolSets`, `elements`, `paylines`, `paylineConfiguration`, `paytable`, `paytableConfiguration`, `scenes`) updates atomically in a single immutable `GameBlueprint`.
3. `StudioEditorStore` records `{ command, before, after }` on `undoStack`, clears `redoStack`, sets `dirty = true`, and updates `crossRouteEditorCache`.
4. On manual `Save` (`Ctrl/Cmd + S`) or when `autosaveEnabled` triggers after `900ms`, `saveActiveProject()` persists to both `PATCH /api/projects/[id]` (`saveWorkspaceBlueprint`) and `localProjectPersistence.saveProject`, then dispatches `MARK_SAVED`.

## 9. Integration Points with Other Sections
- Connects `F01` (Foundation/Commands/Store), `F02` (Dashboard), `F03` (New Game), `F04` (Design View), `F05` (Canvas), `F06` (Layers), `F07` (Elements), `F08` (Symbol Sets), `F09` (Symbol Editor), `F10` (Assets), `F11` (Element Detail), `F12` (Image History), `F13` (Manual Editor), `F14` (Reel Editor), `F15` (Payline Editor), `F16` (Paytable Editor), `F17` (Preview Controls), `F18` (Animation System), `F19` (Scenes & Layout Composition), and `F20` (Export System).

## 10. UI Controls, Keyboard Shortcuts, and User Behaviors
- **14-Stage Flow Bar**: Interactive pipeline bar showing live readiness status and item counts for all 14 stages (`Dashboard` → `Export`).
- **Delete Symbol Modal**: Inspects references in Reels, Paytable, Paylines, and Features; allows selecting a replacement symbol for reel stops before confirming deletion.
- **Delete Element Modal**: Inspects references in Scene Layers, Symbol Sets, Animations, and Asset References before confirming deletion.
- **Change Grid Size Modal**: Inspects incompatible paylines, way-evaluation capacity changes, and scene layout structures; allows selecting payline resolution strategy (`adapt`, `regenerate_standard`, `disable_incompatible`).
- **Import Blueprint Modal**: File upload or JSON paste with live schema validation, legacy `v0` → `v1` migration preview, and migration step log.
- **Save / Autosave / Undo / Redo**: `Ctrl/Cmd + S` (Save), `Ctrl/Cmd + Z` (Undo), `Ctrl/Cmd + Shift + Z` (Redo), plus header `Autosave On/Off` switch and `Saved`/`Unsaved` badge.

## 11. Tests, Typechecks, Builds Run and Actual Results
- `npm run typecheck`: **PASS** (`tsc --noEmit` — `0` errors).
- `npx tsx --test tests/frontend-integration.test.ts`: **PASS** (`7/7` subtests passing).
- `npx tsx --test tests/*.test.ts`: **PASS** (`158/158` tests passing across all 21 test suites `F01`–`F21`).

## 12. Requirement-by-Requirement Status Table
| Requirement | Status | Verification |
| :--- | :---: | :--- |
| Verify 14-stage flow (`Dashboard` → `New Game` → `Project` → `Design` → `Symbol Set` → `Symbol` → `Canvas` → `Layers` → `Scenes` → `Reels` → `Paylines` → `Paytable` → `Preview` → `Export`) | `PASS` | `F21.1` in `tests/frontend-integration.test.ts` + `IntegrationFlowBar` |
| Central `GameBlueprint` rule (no authoritative duplicate state drift) | `PASS` | `F21.2` in `tests/frontend-integration.test.ts` + `reconcileBlueprintState` |
| Delete symbol dependency warnings (`reel`, `paytable`, `payline`, `feature`) | `PASS` | `F21.3` in `tests/frontend-integration.test.ts` + `SymbolDeleteConfirmModal` |
| Delete element dependency warnings (`scene layer`, `symbol set`, `animation`, `asset reference`) | `PASS` | `F21.4` in `tests/frontend-integration.test.ts` + `ElementDeleteConfirmModal` |
| Change grid size dependency warnings (incompatible paylines & layout structures) | `PASS` | `F21.5` in `tests/frontend-integration.test.ts` + `GridSizeChangeConfirmModal` |
| Blueprint import with schema validation and legacy version migration | `PASS` | `F21.6` in `tests/frontend-integration.test.ts` + `BlueprintImportModal` |
| Manual Save, optional Autosave, and Dirty Indicator | `PASS` | `F21.7` in `tests/frontend-integration.test.ts` + `StudioHeader` / workspace headers |
| Consistent Undo/Redo across editors & reload persistence without losing changes | `PASS` | `F21.7` in `tests/frontend-integration.test.ts` + `StudioEditorStore` / `EditorProvider` |

## 13. Known Issues and Limitations
- None. All 21 frontend sections (`F01`–`F21`) are integrated and verified.

## 14. Remaining Work / Recommended Next Steps
- **SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER (`F01`–`F21`)** is complete.
- Next phase when requested: **SECTION 2 — BACKEND / SLOT GAME ENGINE** (connecting `SlotRuntimeAdapter` to a real backend math/RNG evaluation engine consuming the exported `GameBlueprint`).

## 15. Google Drive Backup Location and Backup Status
- **Section Folder**: `Slot Studio Backups/F - Frontend/F21/` (`1nFcinqjqn2gBbA_NCYLcyThrkckoTliS`)
- **Section Report Mirror**: `Slot Studio Backups/F - Frontend/F21/F21-frontend-integration.md` (`1E-TUn-UEuCf5mrw9gw6RhcT3vFYGdYze`)
- **Category Report Mirror**: `Slot Studio Backups/F - Frontend/F21-frontend-integration.md` (`15sxaiB2RGXAHEjgj4y-VDZytOtGioNt6`)
- **Relative Path Report**: `Slot Studio Backups/F - Frontend/F21/docs/implementation/F21-frontend-integration.md` (`1y3lAtVMGwtAnNEJ9N5KV5BOvS1Nkm5h-`)
- **Status**: Synchronized and verified in `docs/backups/Backup-Manifest.md`.

## 16. Last Update Date
- **Date**: `2026-10-12`
