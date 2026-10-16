# F03 — Project Creation

## 1. Section ID and Name
- **Section ID**: `F03`
- **Section Name**: `PROJECT CREATION`
- **Purpose**: Provide the project creation workflow (`/games/new` and `/project/new`) with a fully functional **Manual** creation mode and a clearly reserved, non-executing **Agent** tab (`AI Assistant — Coming Soon`), producing a validated `GameBlueprint`, persisting it to the studio database, and opening the new project in the Design workspace (`/projects/[id]`).

## 2. Objective and Scope
### Intended Scope
- **Creation Tabs**:
  - `Manual`: Active creation form for configuring a new slot game project.
  - `Agent`: Reserved informational tab displaying `"AI Assistant — Coming Soon"` (`ReservedAgentPanel`), with zero fake chat, fake tool calls, or LLM API usage.
- **Manual Creation Fields**:
  - `Game Title` (`title`), `Folder` (`folderPath` with existing folder chips or new subfolder path), `Theme` (`theme` with theme chips), `Style` (`stylePreset` + `styleGuide`), `Reference Image` (`referenceImage`), `Grid Preset` (`5x3`, `5x4`, `6x3`, `6x4`, `custom` with `columns` 3–8 and `rows` 2–6), `Paylines` (`paylineCount` + evaluation mode `lines`, `ways`, `cluster`), `Symbols` (`royals` 0–8, `medium` 0–8, `high` 0–8, `specials`: `wild`, `scatter`, `bonus`), `Elements` (`gameTitle`, `backgrounds`, `aspect`, `reelFrames`, `frameStyle`, `buttons`: `spin`, `max`, `auto`, `turbo`), and `Import Local Artwork` (`artwork[]` categorized into the 7 element types).
- **Acceptance**:
  - Creating a project builds a valid `GameBlueprint`, persists the project and its uploaded artwork in a transaction, updates the dashboard, and opens the Design workspace (`/projects/[id]`).

### Explicitly Out of Scope
- AI generation, LLM API calls, or fake AI chat workflows in the `Agent` tab.
- Real slot-game engine simulation or RTP certification (starter math/strip weights are declarative configuration for SECTION 2).

## 3. Implementation Summary
- Implemented `src/lib/creation/draft.ts` (typed `CreationDraft`, `ELEMENT_TYPES`, `GRID_PRESETS`, `STYLE_PRESETS`, `THEME_SUGGESTIONS`, `normalizeDraft`, `creationInputIssues`, `validateDraft`) and `src/lib/creation/blueprint-from-draft.ts` (`draftToBlueprint`).
- Implemented `src/lib/client/draft-store.ts` (IndexedDB + `localStorage` draft persistence storing both `form` and `blueprint`) and `src/lib/client/useDraftEditor.ts` (undo/redo history with typing coalescing and debounced autosave).
- Implemented `src/components/dashboard/NewGameWorkflow.tsx`, `src/components/creation/{ArtworkImport,BlueprintInspector,LayoutPreview,ReservedAgentPanel,fields}.tsx`, and route pages `src/app/games/new/page.tsx` and `src/app/project/new/page.tsx`.
- Resolved React 19 / ESLint compliance in `src/lib/creation/draft.ts`, `src/components/creation/ArtworkImport.tsx`, `src/components/dashboard/NewGameWorkflow.tsx`, and `src/components/creation/fields.tsx`.

## 4. Files Created, Modified, or Deleted
- `src/lib/creation/draft.ts` *(Modified)* — Typed manual creation draft model, catalogs (`ELEMENT_TYPES`, `GRID_PRESETS`, `STYLE_PRESETS`, `BUTTON_ROLES`), deterministic `normalizeDraft`, and validation (`creationInputIssues`, `validateDraft`).
- `src/lib/creation/blueprint-from-draft.ts` *(Existing)* — Pure converter from `CreationDraft` to `GameBlueprint`, preserving `blueprint.creation` metadata (`symbolPlan`, `elements`, `customGrid`, `requestedPaylineCount`).
- `src/lib/creation/images.ts` *(Existing)* — Client-side image decoding and downsizing (`PNG`, `JPEG`, `WebP`, max 1600px longest side, max 3 MB stored per image, 24 MB combined).
- `src/lib/creation/providers.ts` *(Existing)* — Inert reserved provider descriptor registry (`AI Assistant — Coming Soon`).
- `src/lib/client/draft-store.ts` *(Existing)* — IndexedDB (`slot-studio-drafts`) + `localStorage` draft persistence (`studio.newGame.draft.v2`).
- `src/lib/client/useDraftEditor.ts` *(Existing)* — Undo/redo and autosave hook for the creation workflow.
- `src/components/dashboard/NewGameWorkflow.tsx` *(Modified)* — Manual/Agent creation tabs, form sections, live preview, validation summary, JSON export, and submission to `POST /api/projects`.
- `src/components/creation/ArtworkImport.tsx` *(Modified)* — Reference image picker and multi-file local artwork import with element category selector (`symbol_set`, `symbol`, `game_title`, `reel_frame`, `game_background`, `button_set`, `other_asset`).
- `src/components/creation/LayoutPreview.tsx` *(Existing)* — Live non-playable visual preview of grid, symbols, title, frame, background, and control bar.
- `src/components/creation/BlueprintInspector.tsx` *(Existing)* — Read-only live `GameBlueprint` summary and JSON inspector.
- `src/components/creation/ReservedAgentPanel.tsx` *(Existing)* — Reserved `AI Assistant — Coming Soon` panel.
- `src/components/creation/fields.tsx` *(Modified)* — Accessible `Stepper` and `NumberField` controls.
- `src/app/games/new/page.tsx`, `src/app/project/new/page.tsx` *(Existing/Created)* — Server route pages rendering `NewGameWorkflow`.
- `tests/creation.test.ts` *(Modified)* — Unit and end-to-end persistence tests (13 tests covering all presets, custom grids, artwork categories, validation, and `createProject` persistence).

## 5. Architecture and Dependencies
- **Data Model**: `CreationDraft` (`src/lib/creation/draft.ts`) -> `draftToBlueprint()` (`src/lib/creation/blueprint-from-draft.ts`) -> `GameBlueprint` (`src/lib/blueprint/types.ts`).
- **Draft Storage**: Browser IndexedDB (`slot-studio-drafts/drafts`) with automatic migration from legacy `localStorage` drafts and full-document `localStorage` fallback.
- **Server Persistence**: `POST /api/projects` -> `createProject()` in `src/server/workspace-service.ts`, validating raster headers via `decodeArtwork()` (`src/server/artwork.ts`) and writing `folders`, `project_assets`, and `projects` inside a single DB transaction.

## 6. Data Flow and Persistence
1. User edits fields in `NewGameWorkflow` (`Manual` tab).
2. `useDraftEditor` normalizes the draft (`normalizeDraft`), records an undo step (coalescing rapid typing within 650 ms), derives the live `GameBlueprint` (`draftToBlueprint`), and saves `{ form, blueprint, savedAt }` to IndexedDB after 220 ms.
3. On clicking `Create Game` (or `Ctrl/⌘ + Enter`), `POST /api/projects` validates `creationInputIssues(draft)` and `validateBlueprint(blueprint)`, stores any imported artwork in `project_assets` (replacing data URLs with `/api/assets/<id>`), inserts the project row, clears the local draft, dispatches `studio:workspace-changed`, and navigates to `/projects/<id>`.

## 7. Integration Points
- **F02 (Dashboard)**: Reads existing folders (`getWorkspaceSnapshot`) for the folder selector and updates `/games` upon project creation.
- **F04 (Design View)**: Newly created projects open directly at `/projects/[id]` with all planned and imported symbol sets, standalone symbols, game title, reel frame, background, button set, and custom assets populated in `blueprint.elements`.

## 8. Controls and Behaviors
- **Tabs**: `Manual` (active form) and `Agent` (`Soon` badge -> displays `AI Assistant — Coming Soon` with `Use Manual Setup` button).
- **Grid Presets**: `5 × 3` (20 paylines), `5 × 4` (30 paylines), `6 × 3` (25 paylines), `6 × 4` (40 paylines), and `Custom` (columns 3–8, rows 2–6).
- **Evaluation Modes**: `Paylines` (`lines`), `Ways` (`ways`, `rows^columns` ways), and `Cluster` (`cluster`).
- **Keyboard Shortcuts**:
  - `Ctrl/⌘ + Z`: Undo draft edit
  - `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y`: Redo draft edit
  - `Ctrl/⌘ + S`: Flush draft save immediately
  - `Ctrl/⌘ + Enter`: Submit and create game (when valid in Manual mode)

## 9. Testing and Verification
- **Unit & Integration Tests**:
  - Executed `npx tsx --test tests/creation.test.ts` (13/13 tests pass, including `F03 acceptance: creating a project from a manual draft persists a valid GameBlueprint, updates dashboard, and opens in Design workspace`).
- **Type Check & Lint**:
  - Executed `npm run typecheck` (0 errors) and `npx eslint src/lib/creation src/components/creation src/components/dashboard/NewGameWorkflow.tsx tests/creation.test.ts` (0 errors).
- **Live HTTP Verification**:
  - Verified `GET /games/new`, `GET /project/new`, `POST /api/projects`, `GET /api/workspace`, and `GET /projects/<created-id>` on `http://localhost:3000`.

## 10. Known Issues and Limitations
- Starter paytable payouts and reel strip weights generated by `draftToBlueprint` are deterministic starter values for visual authoring, not certified math outputs from a SECTION 2 engine.
- `tests/creation.browser.mjs` is provided for external Playwright runners (`PLAYWRIGHT_MODULE`).

## 11. Requirements Status
| Requirement | Status | Evidence |
| --- | --- | --- |
| `Manual` and reserved `Agent` (`AI Assistant — Coming Soon`) tabs | `PASS` | `src/components/dashboard/NewGameWorkflow.tsx`, `src/components/creation/ReservedAgentPanel.tsx` |
| All manual fields (`Game Title`, `Folder`, `Theme`, `Style`, `Reference Image`, `Grid Preset`, `Paylines`, `Symbols`, `Elements`, `Import Local Artwork`) | `PASS` | `src/lib/creation/draft.ts`, `src/components/dashboard/NewGameWorkflow.tsx`, `tests/creation.test.ts` |
| Valid `GameBlueprint` creation, persistence, dashboard update, and Design workspace navigation | `PASS` | `src/server/workspace-service.ts`, `tests/creation.test.ts` |

## 12. Next Steps
- None required for F03; created projects hand off directly to F04 (Design View), F05 (Canvas), and F07 (Asset Management).

---

## 13. Backup Information
- **Google Drive Backup Root**: `Slot Studio Backups` (Folder ID: `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Category Folder**: `Slot Studio Backups/F - Frontend` (Folder ID: `1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Backup Folder**: `Slot Studio Backups/F - Frontend/F03` (Folder ID: `1P5c0BOuTQ81RlK2cFTM8jk0QSI2uRL2s`)
- **Backup Timestamp (UTC)**: `2026-10-12T09:34:30Z`
- **Backup Status**: `SUCCESS`
