# F16 — Paytable Editor

## 1. Section ID and Name
- **Section ID**: `F16`
- **Section Name**: Paytable Editor (`TASK: F16 — PAYTABLE EDITOR`)

---

## 2. Objective and Scope
Build a professional paytable configuration interface for **Slot Studio (SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER)**.
- **Important**: This is a **math configuration UI**, not the slot-game math engine (`SECTION 2 — BACKEND / SLOT GAME ENGINE`). It stores structured payout rules and symbol role flags (`isWild`, `isScatter`, `isBonus`) in `GameBlueprint` without calculating RTP, calculating hit rate, or running spin simulations.
- **Layout**:
  - **Rows = symbols** (filterable by symbol search, tier/role filter, or modified-only filter).
  - **Columns = match count** (e.g., `2`, `3`, `4`, `5`, `6`), where visible match counts derive automatically from the grid/reel configuration (`2..reels`).
- **Symbol Row**:
  - Displays `thumbnail` (with glyph fallback), `symbol name`, `tier` (`special`, `high`, `medium`, `low`), `family` (e.g., `Special Symbols`, `High Tier`, `Medium Tier`, `Low Royals`, or custom `symbolFamily`), `wild status`, and `scatter status`.
- **Payout Cells**:
  - Editable numeric input fields for every visible match count column (`2×` through `N×`).
- **Overrides**:
  - Modified values (cells where `payouts[count] !== defaultPayouts[count]`) receive a visual `MODIFIED` indicator badge and amber cell framing, plus a tooltip/comparison showing the configured default value.
  - A per-row `Reset Row` action restores that symbol row's configured default payouts.
  - A global `Reset All` action restores all symbol rows in the paytable to their configured defaults.
- **Wild & Role Flags**:
  - Provides an interactive `Wild` toggle on each symbol row, alongside `Scatter` and `Bonus` role flags.
  - Synchronizes `isWild`, `isScatter`, and `isBonus` across `GameBlueprint.paytableConfiguration`, `GameBlueprint.symbolLibrary`, `GameBlueprint.math.paytable`, `GameBlueprint.math.specialSymbols`, and `GameBlueprint.symbols.special`, making Wild/Scatter/Bonus configuration visible throughout the frontend (Paytable Editor, Symbols Workspace, Symbol Editor, Math & Features Workspace, Reel Editor Symbol Palette, and Preview Workspace).
- **Future Math Compatibility**:
  - Represents payout rules and role flags in structured `PaytableConfiguration` and `PaytableEntry[]` inside `GameBlueprint`.
  - Explicitly does **not** calculate RTP, does **not** calculate hit rate, and does **not** implement spin simulation.
- **Validation**:
  - Rejects `negative payouts`, `invalid numeric values`, `NaN`, and `invalid match count` (e.g., `matchCount < 1`, non-integer match counts, or `matchCount > reels` with a non-zero payout).
  - Highlights invalid cells and rows and prevents saving an invalid paytable configuration into `GameBlueprint`.

---

## 3. Implementation Summary
1. **Paytable Domain Model (`src/lib/paytable/types.ts`)**:
   - Defined `PaytableMatchCount`, `PaytableRowModel`, `PaytableConfiguration`, `PaytableValidationIssueCode` (`negative_payout`, `nan_payout`, `invalid_numeric_value`, `invalid_match_count`, `empty_paytable`, `duplicate_symbol_id`), `PaytableValidationIssue`, and `PaytableValidationReport`.
2. **Paytable Operations & Validation (`src/lib/paytable/operations.ts`)**:
   - Implemented `deriveMatchCountsFromReels(reels)` (`[2, 3, ..., reels]`), `computeCanonicalSymbolDefaults(symbol, reels, tierRank)`, `resolveSymbolThumbnailUri(symbol, blueprint)`, and `resolveSymbolFamily(symbol, blueprint)`.
   - Implemented `paytableConfigurationFromBlueprint(blueprint)` to hydrate a complete `PaytableConfiguration` from `GameBlueprint.paytableConfiguration`, `GameBlueprint.symbolLibrary`, `GameBlueprint.math.paytable`, `GameBlueprint.math.specialSymbols`, and `GameBlueprint.reelConfiguration`.
   - Implemented `isPayoutCellModified`, `getModifiedMatchCountsForRow`, `isPaytableRowModified`, `countModifiedPaytableCells`, `setPaytableCellPayout`, `resetPaytableRowToDefaults`, `resetAllPaytableToDefaults`, `setSymbolRoleFlags`, `toggleSymbolWild`, `toggleSymbolScatter`, and `toggleSymbolBonus`.
   - Implemented `validatePaytableCellValue` and `validatePaytableConfiguration` to reject negative payouts, `NaN`, non-finite numbers, invalid numeric values, and invalid match counts (`< 1`, non-integer, or `> reels`).
   - Implemented `applyPaytableConfigurationToBlueprint(blueprint, config)` to validate and persist paytable rows and role flags across `paytableConfiguration`, `symbolLibrary`, `math.paytable`, `math.specialSymbols`, and `symbols.special`.
3. **Blueprint, Command, Migration & Reel Palette Integration**:
   - Extended `GameBlueprint` in `src/lib/blueprint/types.ts` with optional `paytableConfiguration?: BlueprintPaytableConfigurationSnapshot`.
   - Updated `buildSymbols` in `src/lib/blueprint/factory.ts` so initial `WILD`, `SCAT`, and `BONUS` symbols always carry explicit `isWild`, `isScatter`, and `isBonus` boolean flags.
   - Updated `cloneBlueprint` in `src/lib/blueprint/model.ts` and `migrateBlueprint` in `src/lib/design/migrate.ts` so `paytableConfiguration` and `specialSymbols` survive deep-cloning and design-doc round-tripping.
   - Added `UPDATE_PAYTABLE` to `StudioCommand` in `src/lib/editor/commands.ts` and enhanced `UPDATE_SYMBOL` so toggling `isWild`/`isScatter`/`isBonus` on a symbol also synchronizes `math.specialSymbols`, `symbols.special`, and `paytableConfiguration`.
   - Extended `SymbolPaletteItem` in `src/lib/reels/types.ts` and `buildSymbolPalette` in `src/lib/reels/operations.ts` with `isWild`, `isScatter`, and `isBonus`.
4. **Paytable Configuration Editor UI (`src/components/studio/PaytableEditorWorkspace.tsx`) & Routes**:
   - Built the interactive Paytable Configuration Editor with:
     - Top bar: grid & match-count badges, modified cell counter, Wild/Scatter/Bonus counts, Undo/Redo (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y`), `Reset All`, and `Save Paytable` (`Ctrl/Cmd+S`).
     - Search & filter bar: filter by symbol name/ID/family, tier/role filter (`All`, `Special`, `High`, `Medium`, `Low`, `Wild Only`, `Scatter Only`), and `Modified Only` toggle.
     - Paytable matrix table: Symbol (`thumbnail`, `name`, `code`, `id`), Tier badge, Family badge, interactive Role Flag buttons (`WILD`, `SCATTER`, `BONUS`), dynamic match-count columns (`2×`..`N×`) with editable numeric inputs, `MODIFIED` badges, `Default: X` labels, inline validation error messages, and per-row `Reset Row` action.
     - Right-hand inspector sidebar: Selected Symbol Inspector (thumbnail, metadata, interactive Wild/Scatter/Bonus role toggles, match-count payout breakdown vs. default, `Reset Symbol Row to Defaults`, and deep link to Symbol Editor), Validation Status panel, and Math Engine Boundary note (explicitly stating no RTP, hit rate, or simulation is computed here).
   - Created routes `/projects/[id]/paytable` (`src/app/projects/[id]/paytable/page.tsx`) and `/project/[projectId]/paytable` (`src/app/project/[projectId]/paytable/page.tsx`), plus navigation links in `LeftNav.tsx`, `ProjectWorkspace.tsx`, `MathFeaturesWorkspace.tsx`, and Wild/Scatter/Bonus badges across `SymbolsWorkspace.tsx`, `ReelEditorWorkspace.tsx`, `MathFeaturesWorkspace.tsx`, and `PreviewWorkspace.tsx`.

---

## 4. Files Created, Modified, or Deleted

### Created Files (`8`)
| Relative Path | Purpose |
| --- | --- |
| `src/lib/paytable/types.ts` | Typed domain model for F16 Paytable Editor (`PaytableConfiguration`, `PaytableRowModel`, validation types) |
| `src/lib/paytable/operations.ts` | Pure operations for match count derivation, canonical defaults, cell edits, override detection, row/global resets, role toggles, validation, and `GameBlueprint` persistence |
| `src/lib/paytable/index.ts` | Barrel export for `@/lib/paytable` |
| `src/components/studio/PaytableEditorWorkspace.tsx` | Full F16 Paytable Configuration Editor UI workspace component |
| `src/app/projects/[id]/paytable/page.tsx` | Next.js route `/projects/[id]/paytable` |
| `src/app/project/[projectId]/paytable/page.tsx` | Next.js route `/project/[projectId]/paytable` |
| `tests/paytable-editor.test.ts` | Automated test suite (`F16.1`–`F16.6`) verifying all F16 requirements |
| `docs/implementation/F16-paytable-editor.md` | 13-section implementation and backup report for F16 |

### Modified Files (`15`)
| Relative Path | Summary of Changes |
| --- | --- |
| `src/lib/blueprint/types.ts` | Added `BlueprintPaytableRowSnapshot`, `BlueprintPaytableConfigurationSnapshot`, and `GameBlueprint.paytableConfiguration` |
| `src/lib/blueprint/factory.ts` | Initialized `isWild`, `isScatter`, and `isBonus` on special symbols in `buildSymbols` |
| `src/lib/blueprint/model.ts` | Deep-cloned `paytableConfiguration` in `cloneBlueprint` |
| `src/lib/editor/commands.ts` | Added `UPDATE_PAYTABLE` command and synchronized `specialSymbols`, `symbols.special`, and `paytableConfiguration` in `UPDATE_SYMBOL` |
| `src/lib/design/migrate.ts` | Preserved and synchronized `paytableConfiguration` and `math.specialSymbols` during `migrateBlueprint` |
| `src/lib/reels/types.ts` | Added `isWild`, `isScatter`, and `isBonus` fields to `SymbolPaletteItem` |
| `src/lib/reels/operations.ts` | Populated `isWild`, `isScatter`, and `isBonus` in `buildSymbolPalette` from symbol flags and `math.specialSymbols` |
| `src/components/studio/MathFeaturesWorkspace.tsx` | Added `Open Paytable Editor` button, Wild/Scatter/Bonus role indicators in the payout table, and `UPDATE_PAYTABLE` integration |
| `src/components/studio/SymbolsWorkspace.tsx` | Added `WILD`, `SCATTER`, and `BONUS` badges on symbol cards and inspector role configuration summary |
| `src/components/studio/ReelEditorWorkspace.tsx` | Added `WILD`, `SCAT`, and `BONUS` role badges in the Reel Editor Symbol Palette |
| `src/components/studio/PreviewWorkspace.tsx` | Displayed active `Wild`, `Scatter`, and `Bonus` symbol summary badges in the Preview stage |
| `src/components/design/LeftNav.tsx` | Added `Paytable Editor` quick-launch link in the Design View left navigation |
| `src/components/project/ProjectWorkspace.tsx` | Added `Paytable Editor` header button and `UPDATE_PAYTABLE` persistence handler |
| `docs/implementation/INDEX.md` | Registered `F16` in the master implementation index and updated cumulative test counts (`124/124`) |
| `docs/backups/Backup-Manifest.md` | Added `F16` incremental Google Drive backup manifest entry |

### Deleted Files (`0`)
None (`0` files deleted).

---

## 5. Architecture and Dependencies
- **Clean Separation of Concerns**:
  - `src/lib/paytable/types.ts` and `src/lib/paytable/operations.ts` contain pure, framework-agnostic TypeScript logic with zero React or DOM dependencies.
  - `src/components/studio/PaytableEditorWorkspace.tsx` consumes `@/lib/paytable` and `@/lib/design/history` (`createHistory`, `commitHistory`, `undoHistory`, `redoHistory`) for deterministic state transitions and full undo/redo history.
- **No Unnecessary Dependencies**:
  - Implemented using existing TypeScript, React 19, Next.js 15, and internal UI primitives (`@/components/ui/Primitives`, `@/components/ui/Controls`).

---

## 6. Data Flow and Persistence
1. **Hydration (`paytableConfigurationFromBlueprint`)**:
   - Reads the active reel count (`reelConfiguration.reels` or `grid.columns`) and row count (`reelConfiguration.rows` or `grid.rows`).
   - Derives visible match counts `2..reels` via `deriveMatchCountsFromReels(reels)`.
   - Hydrates each symbol row from `symbolLibrary` merged with `paytableConfiguration.rows`, `math.paytable`, and `math.specialSymbols`, computing deterministic `defaultPayouts` so modified cells (`payouts[k] !== defaultPayouts[k]`) can be tracked across saves and reloads.
2. **Editing & Undo/Redo**:
   - Every cell payout edit, row reset, global reset, or Wild/Scatter/Bonus role toggle creates a new immutable `PaytableConfiguration` snapshot and commits it to the undo/redo history stack.
3. **Validation & Persistence (`applyPaytableConfigurationToBlueprint`)**:
   - Validates the configuration via `validatePaytableConfiguration(config)`. If any error exists, throws a descriptive error and prevents saving.
   - Updates `GameBlueprint.paytableConfiguration`, `GameBlueprint.symbolLibrary` (`payouts`, `isWild`, `isScatter`, `isBonus`, `tier`), `GameBlueprint.math.paytable`, `GameBlueprint.math.specialSymbols`, and `GameBlueprint.symbols.special`.
   - Persists to local browser storage (`useStudioStore.replaceBlueprint`) and via `PATCH /api/projects/[id]` (`updateBlueprint`) when a server project record exists.

---

## 7. Integration Points
- **Design View (`LeftNav.tsx`)**: Links directly to `/projects/[id]/paytable` alongside `Reel Editor` and `Payline Editor`.
- **Project Workspace (`ProjectWorkspace.tsx`)**: Exposes a `Paytable Editor` action button in the top bar and handles `UPDATE_PAYTABLE` commands.
- **Math & Features Workspace (`MathFeaturesWorkspace.tsx`)**: Links to `/projects/[id]/paytable`, displays `WILD` / `SCATTER` / `BONUS` badges in its summary table, and dispatches `UPDATE_PAYTABLE` on cell edits.
- **Symbol Sets & Symbol Editor (`SymbolSetGroup.tsx`, `SymbolEditor.tsx`, `SymbolsWorkspace.tsx`)**: Displays `WILD`, `SCATTER`, and `BONUS` badges and synchronizes role flags with `math.specialSymbols` and `paytableConfiguration`.
- **Reel Editor (`ReelEditorWorkspace.tsx`)**: Displays `WILD`, `SCAT`, and `BONUS` badges on symbols in the Symbol Palette.
- **Preview Workspace (`PreviewWorkspace.tsx`)**: Shows active `Wild`, `Scatter`, and `Bonus` symbols in the bottom stage summary bar.

---

## 8. Controls and Behaviors
| Control / Element | Behavior |
| --- | --- |
| **Match Count Columns (`2×`..`N×`)** | Automatically derived from the grid/reel count (`deriveMatchCountsFromReels(reels)`). |
| **Symbol Row Metadata** | Shows symbol thumbnail (or glyph), display name, code/ID, tier badge (`special`, `high`, `medium`, `low`), family badge, and interactive `WILD`, `SCATTER`, and `BONUS` role toggles. |
| **Editable Payout Cell** | Numeric input (`min=0`, `step=any`) for each match count column. Supports valid integers and decimals (`>= 0`). |
| **Modified Indicator** | Cells whose value differs from `defaultPayouts[count]` show an amber border, `MODIFIED` badge, and `Default: <value>` indicator. |
| **Reset Row** | Restores all match count payouts for a single symbol row back to `defaultPayouts` (enabled whenever the row has overrides or invalid raw input). |
| **Reset All** | Restores all symbol rows in the paytable back to their configured `defaultPayouts`. |
| **Wild / Scatter / Bonus Toggles** | Toggles `isWild`, `isScatter`, or `isBonus` on the symbol row and synchronizes `symbolLibrary` and `math.specialSymbols` on save. |
| **Undo / Redo** | Toolbar buttons and keyboard shortcuts (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`, `Ctrl/Cmd+Y`). |
| **Save Paytable** | Validates the entire paytable (`Ctrl/Cmd+S` or `Save Paytable` button); disabled when `validation.valid === false`. |

---

## 9. Testing and Verification
Executed TypeScript typecheck, full automated unit/integration test suites (`tests/*.test.ts`), and live HTTP route verification:
- `npm run typecheck`: **PASS** (`0` errors)
- `npx tsx --test tests/paytable-editor.test.ts`: **PASS** (`6/6` subtests passing: `F16.1`–`F16.6`)
- `npx tsx --test tests/*.test.ts`: **PASS** (`124/124` tests passing across `16` test suites)
- Live HTTP route verification:
  - `GET /projects/prj_demo_roman_empire/paytable` → `200 OK`
  - `GET /project/prj_demo_roman_empire/paytable` → `200 OK`

---

## 10. Known Issues and Limitations
- None (`0` open issues). As required by the specification, RTP calculation, hit-rate calculation, and Monte Carlo / spin simulation are intentionally excluded from this frontend configuration editor and reserved for `SECTION 2 — BACKEND / SLOT GAME ENGINE`.

---

## 11. Requirements Status
| Requirement | Status | Verification Evidence |
| --- | --- | --- |
| Rows = symbols; Columns = match count (`2..N`) derived from grid/reel configuration | **PASS** | `deriveMatchCountsFromReels` + `F16.1` in `tests/paytable-editor.test.ts` |
| Symbol row shows thumbnail, symbol name, tier, family, wild status, scatter status | **PASS** | `PaytableEditorWorkspace.tsx` + `F16.2` in `tests/paytable-editor.test.ts` |
| Editable numeric payout cells | **PASS** | `setPaytableCellPayout` + `PaytableEditorWorkspace.tsx` + `F16.3` |
| Modified values receive visual modified indicator; row reset & `Reset All` restore defaults | **PASS** | `isPayoutCellModified`, `resetPaytableRowToDefaults`, `resetAllPaytableToDefaults` + `F16.3` |
| Wild toggle provided; Scatter & Bonus role flags visible and synchronized across frontend | **PASS** | `toggleSymbolWild`, `toggleSymbolScatter`, `toggleSymbolBonus` + `F16.4` |
| Structured configuration for future math compatibility; no RTP, hit rate, or simulation | **PASS** | `PaytableConfiguration` + `F16.6` in `tests/paytable-editor.test.ts` |
| Validation rejects negative payouts, invalid numeric values, `NaN`, and invalid match counts | **PASS** | `validatePaytableCellValue`, `validatePaytableConfiguration` + `F16.5` |
| Acceptance: Paytable changes persist in `GameBlueprint` and Wild configuration is visible throughout frontend | **PASS** | `applyPaytableConfigurationToBlueprint`, `UPDATE_PAYTABLE` + `F16.4` & `F16.6` |

---

## 12. Next Steps
- Proceed to the next scheduled frontend section (`F17+`) when requested by the user, reusing `GameBlueprint.paytableConfiguration` and `GameBlueprint.math.paytable` as the single source of truth for symbol payouts and role flags.

---

## 13. Backup Information
- **Google Drive Backup Destination**: `Slot Studio Backups/F - Frontend/F16/` (Folder ID: `1bLKP2buMTL9f0DeJiiMOgj6Le4b9qa2A`)
- **Backup Status**: `SUCCESS` (`VERIFIED`)
- **Backup Timestamp (UTC)**: `2026-10-12T20:55:00Z`
- **Backed-Up Files & Google Drive File IDs**:
  - `src/lib/paytable/types.ts` → `13yHzWEgtm3L-l8jj-nM-hJAxJadx1oJ6` (`4,242` B)
  - `src/lib/paytable/operations.ts` → `1yuHG23DzKeuy-HaqWUTNZLsP6rojeije` (`33,716` B)
  - `src/lib/paytable/index.ts` → `12PQC2moHwEch3mofs7yXs3Sl1SJzKIQo` (`55` B)
  - `src/lib/blueprint/types.ts` → `16NBogOXMiXPN16cGTT3N8L6HtBuCopgK` (`18,725` B)
  - `src/lib/blueprint/factory.ts` → `1t1rYmXeAea4LdfidHRIx6bx3UOAKlKmG` (`14,651` B)
  - `src/lib/blueprint/model.ts` → `1HiVvfoOshffY8ilwc8BbBmRLMoflAQvW` (`2,722` B)
  - `src/lib/editor/commands.ts` → `1TfRwjY5J0i0pFba2VZ7kTpM-iq1Q1TXL` (`16,517` B)
  - `src/lib/design/migrate.ts` → `11lSn1hXtEhRijWAxGyHGbIr-eGGtx7xF` (`11,693` B)
  - `src/lib/reels/types.ts` → `1J4owUdw-CHhKeJKLWdWP06yHdiVlXrEL` (`4,026` B)
  - `src/lib/reels/operations.ts` → `1iEhjnj5Oq0zxrdmyCl5MSK88cwiqFOIC` (`33,512` B)
  - `src/components/studio/PaytableEditorWorkspace.tsx` → `1omrfcMhAVXpXWhrYKbtyOMmikKKfgfo_` (`47,408` B)
  - `src/components/studio/MathFeaturesWorkspace.tsx` → `1jVDvYz75IRzga7SctfUWJG11E_7HFS5A` (`12,400` B)
  - `src/components/studio/SymbolsWorkspace.tsx` → `1pOQuzGr71zjih_OZrUaMdSTowYoXMhph` (`14,031` B)
  - `src/components/studio/ReelEditorWorkspace.tsx` → `1J08vyXbOchbngwi1edqLFgHYeasR3zDx` (`60,937` B)
  - `src/components/studio/PreviewWorkspace.tsx` → `1jVqbC4bFAeCIH5HVQJVVaypFItFf2Awe` (`8,259` B)
  - `src/components/design/LeftNav.tsx` → `1e-ZIBQeBIWStWOnVnabmsGHON60SywOq` (`8,948` B)
  - `src/components/project/ProjectWorkspace.tsx` → `1ZuEEFFjMItiSs3VUt1tu7C0mVgsZVPaD` (`14,316` B)
  - `src/app/projects/[id]/paytable/page.tsx` → `1NXZBIo0abba-DOS7_O6AxOhvwSluuOOz` (`496` B)
  - `src/app/project/[projectId]/paytable/page.tsx` → `1kaG1V_zQD53skAYpuNWENwoC_3BvM5gy` (`516` B)
  - `tests/paytable-editor.test.ts` → `1tzLScuVejy3Imz1vUJ91CN41pFqFXYW5` (`14,148` B)
  - `docs/implementation/F16-paytable-editor.md` → `1eL5G8LzMGu8xDt4e0KiwicKzsrM8jSgv` (`20,207` B)
  - `docs/implementation/INDEX.md` → `14gkKiCcVsfDO5AU3f3VgUEHnawnKW2HO` (`5,444` B)
  - `docs/backups/Backup-Manifest.md` → `1FjZw2602Uxo9xTtXNalJK1m35J5cgmHw` (`34,619` B)
  - `Backup Manifest.md` (Root) → `1nPfzpYU4k3oZ2jYa6mqmDezVLDhuKXYn` (`34,619` B)
