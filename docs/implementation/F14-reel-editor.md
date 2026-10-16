# F14 — Reel Editor

## 1. Section ID and Name
- **Section ID**: `F14`
- **Section Name**: Reel Editor (`SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`)
- **Date**: 2026-10-12

---

## 2. Objective and Scope
The objective of **F14 — Reel Editor** is to build the complete frontend Reel Configuration editor for the Slots Studio Builder.

**CONFIGURATION ONLY**:
- This editor manages declarative reel strip stops, stop positions, optional per-stop weights, reel count (`Add Reel`, `Remove Reel`, `Duplicate Reel`), text-view representation, and structural validation.
- The actual RNG and reel-spin evaluation engine belong strictly to **SECTION 2 — BACKEND / SLOT GAME ENGINE**. No RNG outcomes, spin simulations, or Monte Carlo calculations are performed in this frontend editor.

### Build Scope
1. **Layout**:
   - **Top**: `Reel 1`, `Reel 2`, `Reel 3`, ... selector tabs + `Add Reel`, `Duplicate Reel`, `Remove Reel`, `Undo`/`Redo`, `Stop Weights` toggle, `Text View` / `All Reels Board` toggles, validation status badge, and `Save Reels` action.
   - **Main**: Selected reel strip editor (center/left) + Symbol Palette & Validation inspector (right).
2. **Symbol Palette**:
   - Search by `symbol ID`, `name`, and `artwork` (asset ID, artwork name, artwork URI, or linked/placeholder status).
   - Displays thumbnails for every symbol.
   - Selecting a symbol appends a stop to the selected reel strip; selecting it again adds another stop with a distinct unique stop ID and incremented position.
3. **Reel Strips**:
   - Each stop displays: `position`, `thumbnail`, `symbol ID`, `name`, `weight` (when enabled), `duplicate`, and `remove` (plus reorder and move-to-reel controls).
4. **Drag & Reorder**:
   - Reorder stops within the active reel (`reorderStopInReel` + HTML5 drag-and-drop & up/down controls).
   - Move stops to another reel (`moveStopBetweenReels` + dragging onto any `Reel N` tab or column in the All Reels Board or using the `Move to…` selector).
5. **Reels Management**:
   - `Add Reel`, `Remove Reel`, `Duplicate Reel`.
6. **Text View**:
   - Text editor representation of reel stops accepting whitespace- or comma-separated symbol IDs (`parseReelStopsText`, `formatReelStopsToText`, `applyTextStopsToReel`) with live symbol ID validation.
7. **Weights**:
   - Optional toggle (`weightsEnabled`); when enabled, shows numeric weight input per stop.
8. **Validation**:
   - Detects `unknown symbol IDs`, `empty reel`, `invalid weights`, `duplicate stop corruption`, and `invalid reel count` (`3–8` reels) without calculating RNG outcomes.
9. **Save & Acceptance**:
   - Saves configuration into `GameBlueprint.reelConfiguration` (and synchronizes `GameBlueprint.reels`) locally and via project persistence.

---

## 3. Implementation Summary
- **Reel Configuration Domain (`src/lib/reels/types.ts`, `src/lib/reels/operations.ts`, `src/lib/reels/index.ts`)**:
  - Created `ReelStopConfig`, `ReelStripDef`, `ReelConfigurationData`, `SymbolPaletteItem`, `ReelValidationIssue`, `ReelValidationReport`, and `ReelTextParseResult`.
  - Implemented pure operations: `reelConfigurationFromBlueprint`, `applyReelConfigurationToBlueprint`, `buildSymbolPalette`, `filterSymbolPalette`, `appendStopToReel`, `insertStopInReel`, `duplicateStopInReel`, `removeStopFromReel`, `updateStopWeight`, `setWeightsEnabled`, `reorderStopInReel`, `moveStopBetweenReels`, `addReel`, `removeReel`, `duplicateReel`, `formatReelStopsToText`, `parseReelStopsText`, `applyTextStopsToReel`, `validateReelConfiguration`, and `repairStopCorruption`.
- **Blueprint & Migration Integration (`src/lib/blueprint/types.ts`, `src/lib/blueprint/model.ts`, `src/lib/editor/commands.ts`, `src/lib/design/migrate.ts`)**:
  - Extended `GameBlueprint` with `reelConfiguration?: ReelConfigurationData` and `ReelConfig` with `weightsEnabled?: boolean` and `reels?: ReelStripDef[]`.
  - Updated `getReelConfiguration`, `UPDATE_REEL` command execution, and `migrateBlueprint` to preserve custom `GameBlueprint.reelConfiguration` across reloads and migrations.
- **Reel Editor Workspace UI & Routes (`src/components/studio/ReelEditorWorkspace.tsx`, `src/app/projects/[id]/reels/page.tsx`, `src/app/project/[projectId]/reels/page.tsx`)**:
  - Built the full-screen Reel Configuration Editor with top `Reel 1 | Reel 2 | ...` tabs, interactive stop list, cross-reel drag-and-drop, searchable Symbol Palette with thumbnails, Text View editor with live ID validation, per-stop weight controls, and 5-category structural validator.
  - Enabled direct navigation to Reels from `LeftNav.tsx`, `ProjectWorkspace.tsx`, and `MathFeaturesWorkspace.tsx`.

---

## 4. Files Created, Modified, or Deleted

### Created (`8` files)
| Relative Path | Purpose |
|---|---|
| `src/lib/reels/types.ts` | Typed models for `ReelStopConfig`, `ReelStripDef`, `ReelConfigurationData`, `SymbolPaletteItem`, and validation/text-parse results |
| `src/lib/reels/operations.ts` | Pure state operations for symbol palette search, stop management, drag/reorder/cross-reel moves, reel add/remove/duplicate, text view parsing, and structural validation |
| `src/lib/reels/index.ts` | Barrel export for `src/lib/reels` |
| `src/components/studio/ReelEditorWorkspace.tsx` | Complete F14 Reel Configuration Editor React workspace |
| `src/app/projects/[id]/reels/page.tsx` | Next.js route `/projects/[id]/reels` |
| `src/app/project/[projectId]/reels/page.tsx` | Next.js route `/project/[projectId]/reels` |
| `tests/reel-editor.test.ts` | Automated test suite (`6` subtests) covering all F14 requirements |
| `docs/implementation/F14-reel-editor.md` | This 13-section implementation and backup report |

### Modified (`9` files)
| Relative Path | Change Summary |
|---|---|
| `src/lib/blueprint/types.ts` | Added `ReelStopConfig`, `ReelStripDef`, `ReelConfigurationData`, and `GameBlueprint.reelConfiguration` |
| `src/lib/blueprint/model.ts` | Updated `getReelConfiguration` to return `bp.reelConfiguration ?? bp.reels` |
| `src/lib/editor/commands.ts` | Extended `UPDATE_REEL` command payload and reducer to support `reelConfiguration` |
| `src/lib/design/migrate.ts` | Preserved custom `GameBlueprint.reelConfiguration` during `migrateBlueprint` |
| `src/components/design/LeftNav.tsx` | Promoted `Reels` from `"Soon"` to an active navigation item linking to `/projects/[id]/reels` |
| `src/components/project/ProjectWorkspace.tsx` | Linked `Reels` tab directly to `/projects/[id]/reels` |
| `src/components/studio/MathFeaturesWorkspace.tsx` | Added `Open Reel Configuration Editor (F14) →` link in Reel Grid Configuration panel |
| `docs/implementation/INDEX.md` | Added `F14 — Reel Editor` entry to the master implementation index |
| `docs/backups/Backup-Manifest.md` | Recorded `F14` Google Drive folder ID, uploaded file IDs, MD5 checksums, and verification status |

### Deleted (`0` files)
- None.

---

## 5. Architecture and Dependencies
- **Pure Configuration Layer + React Workspace**:
  - `src/lib/reels/*` contains zero DOM/browser dependencies and zero RNG/spin logic.
  - `ReelEditorWorkspace.tsx` manages undoable state via `HistoryState<ReelConfigurationData>` (`src/lib/design/history.ts`) and saves into `GameBlueprint.reelConfiguration`.
- **No New External Dependencies**:
  - Built entirely with existing TypeScript/React primitives (`Badge`, `Button`, `Icon`, `Select`, `TextArea`, `TextInput`, `Toggle`).

---

## 6. Data Flow and Persistence
1. **Initialization**:
   - `reelConfigurationFromBlueprint(blueprint)` reads `blueprint.reelConfiguration` if present, or derives structured `ReelStripDef[]` and `ReelStopConfig[]` from `blueprint.reels` and `blueprint.symbols`.
2. **Editing & Undo/Redo**:
   - Every stop append, duplicate, remove, weight edit, drag reorder, cross-reel move, reel add/remove/duplicate, or text-view apply records a snapshot in `HistoryState<ReelConfigurationData>`.
3. **Saving to `GameBlueprint.reelConfiguration`**:
   - `applyReelConfigurationToBlueprint(blueprint, config)` writes the normalized `ReelConfigurationData` to `blueprint.reelConfiguration` and synchronizes `blueprint.reels` (`columns`, `strips`, `weightsEnabled`, `reels`) and `blueprint.paylines`.
   - Saves locally to `LocalProjectPersistenceService` (`localStorage` / in-memory fallback) and to the workspace database via `workspaceApi.updateProject`.

---

## 7. Integration Points
- **Routes**: `/projects/[id]/reels` and `/project/[projectId]/reels`.
- **Design Workspace (`LeftNav.tsx`)**: Direct `Reels` sidebar link.
- **Math & Features (`MathFeaturesWorkspace.tsx`)**: Direct button to open the Reel Configuration Editor.
- **Blueprint Validation (`validateBlueprint`) & Migration (`migrateBlueprint`)**: Synchronized with `GameBlueprint.reelConfiguration` and `GameBlueprint.reels`.

---

## 8. Controls and Behaviors
| Area | Control | Behavior |
|---|---|---|
| Top Header | `Back to Design`, `Undo`, `Redo`, `Stop Weights` toggle, `Text View`, `All Reels Board`, `Save Reels` | Manages undo/redo history, weight visibility, view panels, and saves to `GameBlueprint.reelConfiguration` |
| Top Reel Bar | `Reel 1`, `Reel 2`, `Reel 3`, ... tabs + `Add Reel`, `Duplicate Reel`, `Remove Reel` | Selects active reel, accepts dropped stops from other reels, and adds/duplicates/removes reels |
| Selected Reel Strip | Stop row (`#position`, thumbnail, `symbolId`, `name`, `Weight` input, `↑`/`↓`, `Move to…`, `Duplicate`, `Remove`, drag handle) | Reorders stops within the reel, moves stops across reels, edits weights, duplicates, or removes stops |
| Text View | Separator selector (`Comma`, `Space`, `Newline`), `TextArea`, `Apply to Reel N`, live ID validation badge | Parses whitespace- or comma-separated symbol IDs, validates against project symbols, and updates the reel strip |
| Symbol Palette | Search input (`symbol ID`, `name`, `artwork`), Tier filter (`all`/`high`/`mid`/`low`/`special`), Artwork filter (`all`/`linked`/`placeholder`), symbol tiles with thumbnails | Filters symbols in real time; clicking a symbol appends a stop to the active reel; clicking again adds another stop |
| Validation Panel | 5 structural check rows + issue list + `Repair Stop Corruption` button | Reports unknown symbol IDs, empty reels, invalid weights, duplicate stop corruption, and invalid reel count without calculating RNG outcomes |

---

## 9. Testing and Verification
- **Typecheck**:
  ```bash
  npm run typecheck
  ```
  Result: `0` TypeScript errors.
- **Automated Unit & Integration Tests**:
  ```bash
  npx tsx --test tests/*.test.ts
  ```
  Result: `112/112` tests passing across `14` test suites (`tests/reel-editor.test.ts` verified all `6` F14 subtests).
- **Live HTTP Route Verification**:
  - `GET /projects/prj_demo_roman_empire/reels` → `200 OK`
  - `GET /project/prj_demo_roman_empire/reels` → `200 OK`

---

## 10. Known Issues and Limitations
- As required by SECTION 1 rules, this editor is strictly for reel configuration; RNG outcome generation, spin physics, and RTP simulation are deferred to SECTION 2.

---

## 11. Requirements Status
| Requirement | Status | Notes |
|---|---|---|
| Top layout (`Reel 1`, `Reel 2`, `Reel 3`, ...) & Main layout (`selected reel strip`, `symbol palette`) | **PASS** | Implemented in `src/components/studio/ReelEditorWorkspace.tsx` |
| Symbol Palette search by `symbol ID`, `name`, `artwork`, show thumbnails, click appends stop, click again adds another stop | **PASS** | Verified in `tests/reel-editor.test.ts` |
| Reel Strips show `position`, `thumbnail`, `symbol ID`, `name`, `weight when enabled`, `duplicate`, `remove` | **PASS** | Verified in `ReelEditorWorkspace.tsx` and `tests/reel-editor.test.ts` |
| Drag: reorder within reel & move stop to another reel | **PASS** | Verified in `reorderStopInReel` and `moveStopBetweenReels` |
| Reels: `Add Reel`, `Remove Reel`, `Duplicate Reel` | **PASS** | Verified in `addReel`, `removeReel`, `duplicateReel` |
| Text View: accept whitespace or comma-separated IDs and validate IDs | **PASS** | Verified in `parseReelStopsText`, `formatReelStopsToText`, `applyTextStopsToReel` |
| Weights: optional toggle; when enabled, show weight input per stop | **PASS** | Verified in `setWeightsEnabled` and `updateStopWeight` |
| Validation: detect `unknown symbol IDs`, `empty reel`, `invalid weights`, `duplicate stop corruption`, `invalid reel count`; do not calculate RNG outcomes | **PASS** | Verified in `validateReelConfiguration` and `repairStopCorruption` |
| Save configuration into `GameBlueprint.reelConfiguration` & work locally without backend | **PASS** | Verified in `applyReelConfigurationToBlueprint` and `LocalProjectPersistenceService` |

---

## 12. Next Steps
- Proceed to the next section of the Slots Studio Builder specification while preserving all `F01`–`F14` routes, components, and `GameBlueprint` contracts.

---

## 13. Backup Information
- **Google Drive Root Backup Folder**: `Slot Studio Backups` (`1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Frontend Category Folder**: `Slot Studio Backups/F - Frontend` (`1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Destination Folder**: `Slot Studio Backups/F - Frontend/F14` (`19pgGy21wZ6cGQClOYjuQker18qUbOyQ3`)
- **Backup Timestamp**: `2026-10-12T20:05:00Z`
- **Upload Status**: `SUCCESS` (17/17 incremental section files + root `Backup Manifest.md` verified)

### Uploaded Files & Google Drive IDs
| Relative Path | Google Drive File ID | Size (Bytes) | MD5 Checksum |
|---|---|---|---|
| `src/lib/reels/types.ts` | `1CVxLXYZahaRP7YzMdIfMjQK0yhYVkwgV` | `3962` | `f0334f32b16fda985905f754551017e5` |
| `src/lib/reels/operations.ts` | `1Dv4mdvYmv81jKtv6sq83LWkKlX2O1e7N` | `32690` | `9afd70555a89d965c8911de8559b46bd` |
| `src/lib/reels/index.ts` | `1dBCiTmNyJfMVTRxgWZce-sbpKmsEC5Hh` | `55` | `2fe23b516a3e95a6a02cbcd1145c6142` |
| `src/lib/blueprint/types.ts` | `1Dba1TSJN4uEaRHofpZRUbSqB2V3SKXnr` | `16931` | `755883c22b28a8c3c6ea52418cfb5474` |
| `src/lib/blueprint/model.ts` | `1xQP8oqPtP2twJBEdm2psOnuQfCA3KY4x` | `2518` | `01f19135f3c90b0e22ab0630b2566873` |
| `src/lib/editor/commands.ts` | `1bIxa57b7Kwg1eIs6E12NwSQwTZu0dZCx` | `13240` | `5ff312e25883aef0cb49682f72b6d095` |
| `src/lib/design/migrate.ts` | `1yhb3WWH4qXGtYTf9D2b-ojRxGF83mI2C` | `10895` | `2cb996135ba2743d391d6b5c6461484b` |
| `src/components/studio/ReelEditorWorkspace.tsx` | `1vk7JzcjMLWkYgS1AuGHJBlZalj3kaU8d` | `60320` | `338b521c093dd722ffc200fa451c1a27` |
| `src/components/studio/MathFeaturesWorkspace.tsx` | `1coeGtkFdF-s5s4omi8vmQ3VtM5p_gSHd` | `11061` | `8d54943dd83c231dbc2c60d40ec16e1f` |
| `src/components/design/LeftNav.tsx` | `1RF-acJ_F0o5Lq1MIzDpG2799w0Td9rZ2` | `8581` | `1d7f98460aeba16108cec077b79e8c26` |
| `src/components/project/ProjectWorkspace.tsx` | `1MjiQqTmdUyumV0DiXnfTyIom9_XZSaQd` | `13836` | `1560307806e60e4528d46293177b5492` |
| `src/app/projects/[id]/reels/page.tsx` | `1nSYRZ1e-IeVG3_YattKS_iu1pQXL_cCl` | `481` | `993b5d5607904abb52c3768dbefa3d60` |
| `src/app/project/[projectId]/reels/page.tsx` | `1xjKJVcoIlidaBTDEn37DzHwXEj6kcR3j` | `501` | `761e9ee4f9308d93a7dd0a74896cbc34` |
| `tests/reel-editor.test.ts` | `1byhPXmzsLwLsk_nAc3z70y5uYdhpA7SZ` | `14472` | `1038e1ba2599637cfe201e340db86b86` |
| `docs/implementation/F14-reel-editor.md` | `1qREhsRdKEm43aeu2pf3PHQoP3llmGsOg` | `15505` | `VERIFIED` |
| `docs/implementation/INDEX.md` | `1W6uT9jMS_mRs6ndKGTgxUIOZ5ii2rWv8` | `4818` | `2b3e815d411d68fd590b73f172904956` |
| `docs/backups/Backup-Manifest.md` | `1MOFV441N-3-KQoYaf0_on6jcLZa5tX1S` | `26910` | `VERIFIED` |
