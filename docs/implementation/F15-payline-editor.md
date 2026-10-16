# F15 — Payline Editor

## 1. Section ID and Name
- **Section ID**: `F15`
- **Section Name**: Payline Editor (`SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`)
- **Date**: 2026-10-12

---

## 2. Objective and Scope
The objective of **F15 — Payline Editor** is to build the Payline Editor as a visual configuration tool for the Slots Studio Builder.

**CONFIGURATION ONLY (DO NOT CALCULATE WINNINGS)**:
- This editor defines geometric payline paths across the reel/row grid, presets (`5 Lines`, `10 Lines`, `20 Lines`, `Custom`), payline list management (`Add Payline`, `Delete Payline`, `Duplicate`, `Clear All`), deterministic color assignment, active/inactive states, and structural validation.
- It does **not** calculate winnings, symbol payouts, RNG outcomes, or RTP metrics (those belong strictly to **SECTION 2 — BACKEND / SLOT GAME ENGINE**).

### Build Scope
1. **Editor Grid & Path Highlighting**:
   - Displays the current `columns × rows` reel/row grid.
   - Each cell is clickable (`setPaylineCell`).
   - The current payline path is visually highlighted across the grid (`computePaylinePathGeometry` + SVG polyline/nodes + cell border glow).
2. **Rule (`1 Cell Per Reel`)**:
   - Each payline must contain exactly one cell per reel (`0..rows-1` for every column `0..columns-1`).
3. **Presets**:
   - `5 Lines`, `10 Lines`, `20 Lines`, `Custom`.
4. **Actions**:
   - `Add Payline`, `Delete Payline`, `Duplicate`, `Clear All`.
5. **Payline List**:
   - Each payline displays: `number` (`#1..#N`), `pattern preview` (mini SVG grid + coordinate pattern), `active/inactive` toggle, and `selected state`.
6. **Color**:
   - Assigns deterministic colors (`PAYLINE_COLOR_PALETTE` / `getPaylineColor`) to paylines for visual differentiation.
7. **Validation**:
   - Prevents saving malformed paylines (`validation.canSave === false` & `applyPaylineConfigurationToBlueprint` guard).
   - Highlights invalid columns (`invalidColumnsByPaylineId` + red column ring & header badge on the grid).
8. **Preview & Save**:
   - Shows the path across the grid.
   - Saves into `GameBlueprint.paylineConfiguration` (and synchronizes `GameBlueprint.paylines`).
9. **Acceptance**:
   - A designer can create arbitrary zigzag / V / diagonal patterns with no backend math required.

---

## 3. Implementation Summary
- **Payline Configuration Domain (`src/lib/paylines/types.ts`, `src/lib/paylines/operations.ts`, `src/lib/paylines/index.ts`)**:
  - Defined `PaylinePreset`, `PaylineShapeKind`, `PaylineItemConfig`, `PaylineConfigurationData`, `PaylineColumnIssue`, `PaylineValidationIssue`, `PaylineValidationReport`, `PaylinePathPoint`, and `PaylinePathGeometry`.
  - Implemented deterministic color assignment (`PAYLINE_COLOR_PALETTE`, `getPaylineColor`), blueprint serialization (`paylineConfigurationFromBlueprint`, `applyPaylineConfigurationToBlueprint`), cell clicking (`setPaylineCell`, `clearPaylineColumn`, `setPaylinePattern`), presets (`applyPaylinePreset`, `detectPaylinePreset`), list actions (`addPayline`, `deletePayline`, `duplicatePayline`, `clearAllPaylines`, `togglePaylineActive`, `setAllPaylinesActive`), shape generators (`buildPatternShape` for `top`, `middle`, `bottom`, `v`, `inverted_v`, `zigzag`, `zigzag_inv`, `diagonal_down`, `diagonal_up`), structural validation (`validatePaylineConfiguration`, `repairMalformedPaylines`), and SVG path geometry (`computePaylinePathGeometry`).
- **Blueprint & Command Integration (`src/lib/blueprint/types.ts`, `src/lib/blueprint/model.ts`, `src/lib/editor/commands.ts`, `src/lib/design/migrate.ts`)**:
  - Added `GameBlueprint.paylineConfiguration` (`PaylineConfigurationData`) and updated `getPaylineConfiguration`, `UPDATE_PAYLINE`, and `migrateBlueprint`.
- **Payline Editor Workspace UI & Routes (`src/components/studio/PaylineEditorWorkspace.tsx`, `src/app/projects/[id]/paylines/page.tsx`, `src/app/project/[projectId]/paylines/page.tsx`)**:
  - Built the 3-pane Payline Configuration Editor with top preset/action toolbar, left Payline List (with number, deterministic color badge, mini SVG pattern preview, active/inactive toggle, and selected state), center clickable Reel × Row Grid with SVG path overlay and invalid column highlighting, and right Validation & Blueprint Inspector.
  - Wired direct navigation links in `LeftNav.tsx`, `ProjectWorkspace.tsx`, and `MathFeaturesWorkspace.tsx`.

---

## 4. Files Created, Modified, or Deleted

### Created (`8` files)
| Relative Path | Purpose |
|---|---|
| `src/lib/paylines/types.ts` | Typed domain models for payline items, presets, shapes, validation reports, and SVG path geometry |
| `src/lib/paylines/operations.ts` | Pure operations for cell selection, presets, add/delete/duplicate/clear, deterministic colors, shape generators, SVG geometry, and validation |
| `src/lib/paylines/index.ts` | Barrel export for `src/lib/paylines` |
| `src/components/studio/PaylineEditorWorkspace.tsx` | Full F15 Payline Configuration Editor React workspace |
| `src/app/projects/[id]/paylines/page.tsx` | Next.js route `/projects/[id]/paylines` |
| `src/app/project/[projectId]/paylines/page.tsx` | Next.js route `/project/[projectId]/paylines` |
| `tests/payline-editor.test.ts` | Automated test suite (`6` subtests) covering all F15 requirements |
| `docs/implementation/F15-payline-editor.md` | This 13-section implementation and backup report |

### Modified (`9` files)
| Relative Path | Change Summary |
|---|---|
| `src/lib/blueprint/types.ts` | Added `PaylineItemConfig`, `PaylineConfigurationData`, and `GameBlueprint.paylineConfiguration` |
| `src/lib/blueprint/model.ts` | Updated `getPaylineConfiguration` to return `bp.paylineConfiguration` when present |
| `src/lib/editor/commands.ts` | Extended `UPDATE_PAYLINE` command payload and reducer to support `paylineConfiguration` |
| `src/lib/design/migrate.ts` | Preserved `GameBlueprint.paylineConfiguration` during `migrateBlueprint` |
| `src/components/design/LeftNav.tsx` | Added `Paylines` navigation item linking to `/projects/[id]/paylines` |
| `src/components/project/ProjectWorkspace.tsx` | Added `Paylines` tab linking to `/projects/[id]/paylines` |
| `src/components/studio/MathFeaturesWorkspace.tsx` | Added `Open Payline Configuration Editor (F15) →` link in Paylines panel |
| `docs/implementation/INDEX.md` | Added `F15 — Payline Editor` entry to the master implementation index |
| `docs/backups/Backup-Manifest.md` | Recorded `F15` Google Drive folder ID, uploaded file IDs, MD5 checksums, and verification status |

### Deleted (`0` files)
- None.

---

## 5. Architecture and Dependencies
- **Pure Configuration Layer + React Workspace**:
  - `src/lib/paylines/*` contains zero DOM dependencies and zero winnings/RNG calculation logic.
  - `PaylineEditorWorkspace.tsx` uses `HistoryState<PaylineConfigurationData>` (`src/lib/design/history.ts`) for full Undo/Redo support and persists into `GameBlueprint.paylineConfiguration`.
- **No New External Dependencies**:
  - Uses existing UI primitives (`Badge`, `Button`, `Icon`, `Toggle`).

---

## 6. Data Flow and Persistence
1. **Initialization**:
   - `paylineConfigurationFromBlueprint(blueprint)` reads `blueprint.paylineConfiguration` if present, or derives normalized `PaylineItemConfig[]` with deterministic colors and detected preset (`5`, `10`, `20`, or `custom`) from `blueprint.paylines`.
2. **Interactive Editing & Undo/Redo**:
   - Clicking any cell `(col, row)` updates `pattern[col] = row` for the selected payline and records an undoable history step.
   - Selecting presets (`5 Lines`, `10 Lines`, `20 Lines`, `Custom`) or executing actions (`Add Payline`, `Duplicate`, `Delete Payline`, `Clear All`) updates `HistoryState<PaylineConfigurationData>`.
3. **Validation & Save into `GameBlueprint.paylineConfiguration`**:
   - `validatePaylineConfiguration(config)` checks every payline and populates `invalidColumnsByPaylineId` and `canSave`.
   - When `canSave` is `true`, `applyPaylineConfigurationToBlueprint(blueprint, config)` writes `blueprint.paylineConfiguration` and synchronizes `blueprint.paylines`, persisting locally via `LocalProjectPersistenceService` and to the workspace store via `workspaceApi.updateProject`.

---

## 7. Integration Points
- **Routes**: `/projects/[id]/paylines` and `/project/[projectId]/paylines`.
- **Design Workspace (`LeftNav.tsx`)**: Direct `Paylines` sidebar navigation item.
- **Math & Features (`MathFeaturesWorkspace.tsx`)**: Direct button in the Paylines panel to open the F15 Payline Configuration Editor.
- **Reel Editor (`PaylineEditorWorkspace.tsx` ↔ `ReelEditorWorkspace.tsx`)**: Cross-linked header buttons between Reels Editor and Paylines Editor.

---

## 8. Controls and Behaviors
| Area | Control | Behavior |
|---|---|---|
| Top Header | `Back to Design`, `Reels Editor`, `Undo`, `Redo`, `Repair Malformed`, `Save Paylines` | Manages undo/redo, auto-repairs malformed columns when present, and saves to `GameBlueprint.paylineConfiguration` |
| Presets Bar | `5 Lines`, `10 Lines`, `20 Lines`, `Custom` | Generates 5, 10, or 20 canonical lines with deterministic colors or switches to Custom mode |
| Actions Bar | `Add Payline`, `Add Blank Draft`, `Duplicate`, `Delete Payline`, `Clear All` | Adds, duplicates, deletes, or clears all paylines |
| Payline List | Payline row (`#number`, deterministic color badge, mini SVG pattern preview, `[r1, r2, ...]` coordinates, `Active` toggle, `Selected` state, `Duplicate`, `Delete`) | Selects payline for grid editing, previews path on hover, toggles active/inactive state |
| Quick Pattern Shapes | `Top Row`, `Middle Row`, `Bottom Row`, `V-Shape`, `Inverted V`, `Zigzag`, `Zigzag Inv`, `Diagonal ↘`, `Diagonal ↗` | Applies canonical geometric pattern to the selected payline for rapid customization |
| Reel × Row Grid | Column headers (`Reel 1..C` + `Unset` button), clickable cells (`R{col}·Row {row}`), SVG Path Overlay (`polyline` + nodes) | Clicking a cell sets that reel column's row index (1 cell per reel), highlights the path across the grid, and highlights invalid columns in rose/red |
| Validation Inspector | 5 structural check badges + issue list with `Focus` buttons | Prevents saving malformed paylines and focuses any payline with invalid columns |

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
  Result: `118/118` tests passing across `15` test suites (`tests/payline-editor.test.ts` verified all `6` F15 subtests).
- **Live HTTP Route Verification**:
  - `GET /projects/prj_demo_roman_empire/paylines` → `200 OK`
  - `GET /project/prj_demo_roman_empire/paylines` → `200 OK`

---

## 10. Known Issues and Limitations
- Per SECTION 1 rules, the Payline Editor is strictly a visual configuration tool and does not calculate winnings or evaluate spin outcomes (deferred to SECTION 2).

---

## 11. Requirements Status
| Requirement | Status | Notes |
|---|---|---|
| Display current reel/row grid; each cell clickable; current payline path visually highlighted | **PASS** | Implemented in `PaylineEditorWorkspace.tsx` and verified in `tests/payline-editor.test.ts` |
| Rule: each payline must contain exactly one cell per reel | **PASS** | Enforced by `setPaylineCell` and `validatePaylineConfiguration` |
| Presets: `5 Lines`, `10 Lines`, `20 Lines`, `Custom` | **PASS** | Verified in `applyPaylinePreset` and `detectPaylinePreset` |
| Actions: `Add Payline`, `Delete Payline`, `Duplicate`, `Clear All` | **PASS** | Verified in `addPayline`, `deletePayline`, `duplicatePayline`, `clearAllPaylines` |
| Payline List displays `number`, `pattern preview`, `active/inactive`, `selected state` | **PASS** | Implemented in `PaylineEditorWorkspace.tsx` (`MiniPaylinePreview` + row controls) |
| Assign deterministic colors to paylines for visual differentiation | **PASS** | Verified in `getPaylineColor` and `PAYLINE_COLOR_PALETTE` |
| Validation: prevent saving malformed paylines & highlight invalid columns; do not calculate winnings | **PASS** | Verified in `validatePaylineConfiguration` and `applyPaylineConfigurationToBlueprint` |
| Preview path across the grid & save into `GameBlueprint.paylineConfiguration` | **PASS** | Verified in `computePaylinePathGeometry` and `applyPaylineConfigurationToBlueprint` |
| Acceptance: designer can create arbitrary zigzag/V/diagonal patterns without backend math | **PASS** | Verified in `tests/payline-editor.test.ts` |

---

## 12. Next Steps
- Proceed to the next section of the Slots Studio Builder specification while preserving all `F01`–`F15` routes, components, and `GameBlueprint` contracts.

---

## 13. Backup Information
- **Google Drive Root Backup Folder**: `Slot Studio Backups` (`1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Frontend Category Folder**: `Slot Studio Backups/F - Frontend` (`1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Destination Folder**: `Slot Studio Backups/F - Frontend/F15` (`1HLsYsL_tf9FRT6ELzgp7dzbXYUnUvDab`)
- **Backup Timestamp**: `2026-10-12T20:20:00Z`
- **Upload Status**: `SUCCESS` (17/17 incremental section files + root `Backup Manifest.md` verified)

### Uploaded Files & Google Drive IDs
| Relative Path | Google Drive File ID | Size (Bytes) | MD5 Checksum |
|---|---|---|---|
| `src/lib/paylines/types.ts` | `1rrbI8cELNJ2vpPvcIoxlpAec59qtVux9` | `4058` | `da331b704cfb11337cfd613d7650e7f9` |
| `src/lib/paylines/operations.ts` | `1-7FgfyIIkHSnJa8dwhw0pxdy9iVM7gkE` | `27581` | `4b2c241dc229790867c5a8775abe518c` |
| `src/lib/paylines/index.ts` | `1ZaAivaCmURGToGyVDCslNum8UQRZYfIy` | `55` | `2fe23b516a3e95a6a02cbcd1145c6142` |
| `src/lib/blueprint/types.ts` | `1F-GyIe9_ZXbzsYFmU-MXRXyODmAMRZSk` | `17622` | `be66fcc1ebcddb5af261ec17e17a7cf4` |
| `src/lib/blueprint/model.ts` | `1KACXLAKRKJvYT-wv7h79kINKSYu_zeZs` | `2647` | `a943c87ef3341b445829bb47db54fbe2` |
| `src/lib/editor/commands.ts` | `1umHjragm8CY-l7rgrtWNuhRjadurBxht` | `14332` | `ef0404fb98bff9a9c19d129ed81cddd9` |
| `src/lib/design/migrate.ts` | `1JLI49hMGy_MWUoyLxkg7NVmP4yP3Xaf3` | `11228` | `5d64e09d4069af32bb651b638dd53ab5` |
| `src/components/studio/PaylineEditorWorkspace.tsx` | `1MZov4pAoSZHTnIXXR8XCrO3-AxWVkkT4` | `55728` | `01024d0dd27d06c7909ce7fab6d8ecb4` |
| `src/components/studio/MathFeaturesWorkspace.tsx` | `1-OgnxQOQW1d6zsv0NtrD5nT1tH_o-7Gc` | `11531` | `b1988257d20b2403356b96c9fe7fa915` |
| `src/components/design/LeftNav.tsx` | `1oKhX5C02CB9KiQyRpc6BoIN2fjNsUjYf` | `8769` | `b61414a43f7029bba7ce0cd9b8d65336` |
| `src/components/project/ProjectWorkspace.tsx` | `1QCUeTgtlm676TH36yx34fjFN5_SUJ27v` | `14082` | `41a0c91b6811d9b41a26e3c5b272e9e8` |
| `src/app/projects/[id]/paylines/page.tsx` | `1WwKwHNuYRcpQrPmdQl9ce5KzikIS_w_h` | `493` | `2c89c5494201c01ca846bab772058791` |
| `src/app/project/[projectId]/paylines/page.tsx` | `1KdtYj8DKY9Bi9aBHd6ER41ohZjRL4iiO` | `513` | `b110b00c9760b6a84a5534ca2cbbde0e` |
| `tests/payline-editor.test.ts` | `1upk0EibOvE8iW3w0A4Q3QDyEyDT-RmdX` | `12034` | `bf18e809c73da5c3c75fe038de76fd7e` |
| `docs/implementation/F15-payline-editor.md` | `1Kws-cWBZPsIvuD2gDWFWorBC1syIOIgv` | `15393` | `VERIFIED` |
| `docs/implementation/INDEX.md` | `10G52iUqAQOy4B7JJ97CZ_102SBqJWQGb` | `5129` | `ad8d5c3ff56a8099f84ffe281e7b9e94` |
| `docs/backups/Backup-Manifest.md` | `1XF1ozN1_pQKJVk7Z7iFgUe5RqDm6EZiB` | `30302` | `VERIFIED` |
