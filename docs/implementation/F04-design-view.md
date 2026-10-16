# F04 — Design View

## 1. Section ID and Name
- **Section ID**: `F04`
- **Section Name**: `DESIGN VIEW`
- **Purpose**: Provide the primary visual asset-management workspace (`/projects/[id]` and `/project/[projectId]/design`) for organizing, inspecting, adding, importing, renaming, duplicating, and deleting `Symbol Sets` and `Standalone Elements` backed by the project's `GameBlueprint`.

## 2. Objective and Scope
### Intended Scope
- **4-Region Layout**:
  - **LEFT (`LeftNav`)**: Project context, completeness summary, navigation across `Design`, `Canvas`, `Assets`, and element outline.
  - **CENTER (`ElementWorkspace` / `ElementDetail`)**: Main element workspace and deep-linkable element detail view (`?element=<id>`).
  - **RIGHT (`Inspector`)**: Contextual inspector for the project or the selected element/symbol.
  - **TOP (`TopBar`)**: Breadcrumb & editable project title, save status (`Saved`, `Unsaved changes`, `Saving…`, `Save failed`, `Out of date`), `Undo`, `Redo`, zoom/density controls (`Compact`, `Comfortable`, `Spacious`, `−` / `+`), `Import`, and `Add Element`.
- **Element Organization**:
  - `Symbol Sets`: Expandable/collapsible groups showing set name, symbol type (`Royals`, `Card Suits`, `Sevens`, `Bars`, `Character`, `Custom`), value tier (`High`, `Medium`, `Low`), symbol thumbnails, readiness status (`Ready`, `Partial`, `Planned`, `Empty`), and symbol count.
  - `Standalone Elements`: `Game Title`, `Game Background`, `Reel Frame`, `Button Set`, standalone `Symbol` (`Wild`, `Scatter`, `Bonus`), `Other / Uploaded Asset` (`other_asset`), `Uploaded Element`, and `Custom Element`.
- **Quick Actions**:
  - Hover/focus toolbar with `Edit`, `Replace image` (or `Add symbol` on sets), `Duplicate`, `Delete`, `Download`, `Open detail`, and overflow menu with disabled/reserved future AI items (`Regenerate with AI`, `Generate variations`).
- **Add Element, Import Artwork & Detail Navigation**:
  - `Add Element` dialog supporting `Symbol Set`, `Symbol`, `Game Title`, `Reel Frame`, `Game Background`, `Button Set`, and `Other / Uploaded Asset` (`other_asset`), plus `Uploaded Element` and `Custom Element`.
  - `Import` dialog supporting multi-file local artwork import (`PNG`, `JPEG`, `WebP`, `SVG`) and grouping into symbol sets.
  - Clicking `Open detail` or double-clicking an element opens its detail workspace (`?element=<id>`).

### Explicitly Out of Scope
- Running a slot-game engine, spinning reels, or evaluating wins inside the Design view.
- Functional AI generation (`Regenerate with AI` and `Generate variations` are strictly disabled/reserved).

## 3. Implementation Summary
- Implemented pure design model, operations, selectors, blueprint migration, validation, undo/redo history, and ZIP export in `src/lib/design/{model,operations,selectors,migrate,parse,history,zip,types}.ts`.
- Implemented client editor hook `src/lib/client/useDesignEditor.ts` and server persistence `src/server/design-service.ts` (`saveDesign`, `uploadAsset`).
- Implemented UI components in `src/components/design/{DesignApp,TopBar,LeftNav,ElementWorkspace,SymbolSetGroup,ElementCard,QuickActions,AddElementDialog,ImportDialog,DeleteDialog,ElementDetail,Inspector,ElementFields,SetEditor,SymbolEditor,Badges,CommitInput,Thumb,actions}.tsx`.
- Updated `src/components/design/AddElementDialog.tsx` so `TYPES` explicitly exposes `{ id: "other_asset", label: "Other / Uploaded Asset" }` matching `TASK: F04` and `tests/design.browser.mjs`.
- Updated `src/components/design/DesignApp.tsx` so `openDetail` and `closeDetail` preserve `window.location.pathname`, working identically on `/projects/[id]` and `/project/[projectId]/design`.

## 4. Files Created, Modified, or Deleted
- `src/components/design/AddElementDialog.tsx` *(Modified)* — Added `other_asset` (`Other / Uploaded Asset`) to the element type selector alongside `symbol_set`, `symbol`, `game_title`, `reel_frame`, `game_background`, `button_set`, `uploaded`, and `custom`.
- `src/components/design/DesignApp.tsx` *(Modified)* — Preserves `window.location.pathname` during `?element=<id>` detail navigation; coordinates `TopBar`, `LeftNav`, `ElementWorkspace`, `ElementDetail`, `Inspector`, and dialogs.
- `src/components/design/{TopBar,LeftNav,ElementWorkspace,SymbolSetGroup,ElementCard,QuickActions,ImportDialog,DeleteDialog,ElementDetail,Inspector,ElementFields,SetEditor,SymbolEditor,Badges,CommitInput,Thumb,actions}.tsx` *(Existing)* — Complete F04 Design View component suite.
- `src/lib/design/{model,operations,selectors,migrate,parse,history,zip,types}.ts` *(Existing)* — Pure Design View domain logic, invariant restoration (`finalizeDoc`), blueprint migration (`migrateBlueprint`), and ZIP archiving (`buildZip`).
- `src/lib/client/useDesignEditor.ts` *(Existing)* — Client state, undo/redo, debounced autosave (`800ms`), and revision conflict handling (`409`).
- `src/server/design-service.ts` *(Existing)* — Server-side row-locked `saveDesign` and `uploadAsset` (`POST /api/projects/[id]/assets`, `PUT /api/projects/[id]/design`).
- `tests/design.test.ts` *(Modified)* — Added end-to-end F04 persistence test (`F04 acceptance: Design View edits (add, rename, duplicate, delete, import artwork) persist across reloads`); 15/15 tests pass.

## 5. Architecture and Dependencies
- **Domain Model (`DesignDoc` in `src/lib/design/types.ts`)**: Normalized slice of `GameBlueprint` containing `elements`, `symbols`, `specialSymbols`, `paytable`, `strips`, `assets`, `columns`, `rows`, `referenceAssetId`, and `protectedAssetIds`.
- **Invariants (`finalizeDoc` in `src/lib/design/model.ts`)**: Guarantees single ownership per symbol, rebuilds reel strips deterministically when symbols are added/removed, keeps paytable rows synchronized with symbols, prunes unreferenced assets while protecting scene and style-reference assets, and derives `blueprint.symbolSets`.
- **API Endpoints**:
  - `PUT /api/projects/[id]/design` -> `saveDesign()`
  - `POST /api/projects/[id]/assets` -> `uploadAsset()`

## 6. Data Flow and Persistence
1. Server loads project via `getProject(id)` (`src/app/projects/[id]/page.tsx` or `src/app/project/[projectId]/design/page.tsx`), upgrades legacy blueprints via `migrateBlueprint()`, and passes `blueprint` + `revision` to `<DesignApp />`.
2. User edits elements/symbols via `useDesignEditor`, which applies pure operations (`addElement`, `renameElement`, `duplicateElement`, `deleteElement`, `setElementImage`, `importArtwork`, etc.), pushes snapshots to `HistoryState`, and schedules a debounced `PUT /api/projects/[id]/design` after `800ms`.
3. `saveDesign` locks the project row, verifies `baseRevision` (returning HTTP `409` on conflict unless `force: true`), merges the `DesignDoc` into `GameBlueprint` via `applyDesign()`, validates blueprint integrity (`validateBlueprint`), increments `revision`, and persists to PostgreSQL / `LocalPgPool`.

## 7. Integration Points
- **F03 (Project Creation)**: Newly created projects open directly in Design View (`/projects/[id]`).
- **F05 & F06 (Canvas & Layers System)**: Symbols and elements managed in Design View are available for placement on scenes in the Canvas (`ScenePanel`), and `sceneAssetIds(stored)` protects canvas-referenced assets during Design saves.
- **F07 (Asset Management)**: Artwork uploaded in Design View is stored in `project_assets` and accessible in the Asset Library (`/projects/[id]/assets`).

## 8. Controls and Behaviors
- **Expand / Collapse**: Individual chevron toggle on each `SymbolSetGroup` plus `Expand all` / `Collapse all` buttons in `ElementWorkspace`; expansion state persists per project in `localStorage`.
- **Quick Actions (Hover/Focus Toolbar)**: `Edit`, `Replace image` (or `Add symbol`), `Duplicate`, `Delete` (opens `DeleteDialog` showing impact on symbols, paytable rows, and reel strip positions), `Download` (`.png`/`.webp`/`.svg` or `.zip` archive with `set.json`), `Open detail`, and overflow menu with disabled `Regenerate with AI (Soon)` and `Generate variations (Soon)`.
- **Keyboard Shortcuts**:
  - `Ctrl/⌘ + Z`: Undo
  - `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y`: Redo
  - `Ctrl/⌘ + S`: Flush save immediately
  - `N`: Open `Add Element` dialog
  - `/`: Focus element search
  - `↑` / `↓`: Move element selection
  - `←` / `→`: Collapse / expand selected symbol set
  - `Enter`: Open detail workspace for selected element
  - `F2`: Focus rename input in Inspector
  - `Ctrl/⌘ + D`: Duplicate selected element
  - `Delete` / `Backspace`: Open delete confirmation dialog
  - `Escape`: Exit detail workspace or clear selection

## 9. Testing and Verification
- **Unit & Persistence Tests**:
  - Executed `npx tsx --test tests/design.test.ts` (15/15 tests pass, covering symbol sets, standalone elements, all `Add Element` types, rename, duplicate, delete impact report, empty project integrity, image replacement/pruning, artwork import, legacy blueprint migration, hostile payload rejection, history undo/redo/coalescing, ZIP CRC32/archive structure, and database persistence).
- **Type Check & Lint**:
  - Executed `npm run typecheck` (0 errors) and `npx eslint src/components/design src/lib/design src/server/design-service.ts tests/design.test.ts` (0 errors).
- **Live HTTP Verification**:
  - Verified `GET /projects/prj_demo_roman_empire`, `GET /project/prj_demo_roman_empire/design`, and `GET /projects/prj_demo_roman_empire?element=el-game-title` return HTTP 200 with expected landmarks and content.

## 10. Known Issues and Limitations
- Replaced or unlinked binary rows in `project_assets` remain in database storage so in-session Undo can restore references without re-uploading.
- Reel strips are regenerated deterministically from symbol weights when symbols are added or deleted.
- `tests/design.browser.mjs` is provided for external Playwright runners (`PLAYWRIGHT_MODULE`).

## 11. Requirements Status
| Requirement | Status | Evidence |
| --- | --- | --- |
| 4-region layout (`LeftNav`, `ElementWorkspace`/`ElementDetail`, `Inspector`, `TopBar`) | `PASS` | `src/components/design/{DesignApp,TopBar,LeftNav,ElementWorkspace,ElementDetail,Inspector}.tsx` |
| `Symbol Sets` (expandable, name, type, tier, thumbnails, status, count) & `Standalone Elements` | `PASS` | `src/components/design/{SymbolSetGroup,ElementCard}.tsx`, `tests/design.test.ts` |
| Hover Quick Actions (`Edit`, `Replace Image`, `Duplicate`, `Delete`, `Download`, `Open Detail`) + disabled AI items | `PASS` | `src/components/design/QuickActions.tsx` |
| `Add Element` (`Symbol Set`, `Symbol`, `Game Title`, `Reel Frame`, `Game Background`, `Button Set`, `Other`) | `PASS` | `src/components/design/AddElementDialog.tsx`, `tests/design.test.ts` |
| Local artwork import & Detail workspace navigation (`?element=<id>`) | `PASS` | `src/components/design/{ImportDialog,ElementDetail}.tsx`, `tests/design.test.ts` |
| Expand/collapse, select, rename, duplicate, delete with confirmation, and persistence | `PASS` | `src/lib/design/operations.ts`, `src/server/design-service.ts`, `tests/design.test.ts` |

## 12. Next Steps
- None required for F04; elements and symbols authored here flow directly into F05 (Canvas System) and F07 (Asset Management).

---

## 13. Backup Information
- **Google Drive Backup Root**: `Slot Studio Backups` (Folder ID: `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Category Folder**: `Slot Studio Backups/F - Frontend` (Folder ID: `1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Backup Folder**: `Slot Studio Backups/F - Frontend/F04` (Folder ID: `1eJyw_cax4OtXGxyQbeAie_pTh9w9xvEz`)
- **Backup Timestamp (UTC)**: `2026-10-12T09:34:30Z`
- **Backup Status**: `SUCCESS`
