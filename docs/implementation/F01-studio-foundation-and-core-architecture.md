# F01 — Studio Foundation & Core Architecture

## 1. Section ID and Name
- **Section ID**: `F01`
- **Section Name**: `STUDIO FOUNDATION & CORE ARCHITECTURE`
- **Purpose**: Establish the foundational visual studio shell, canonical `GameBlueprint` single-source-of-truth data model, project persistence service boundaries, deterministic command-based editor state (`StudioEditorStore`), keyboard shortcut manager, toast notification system, and clean non-implemented AI extension boundaries for the Slots Studio Builder (SECTION 1).

## 2. Objective and Scope
### Intended Scope
- Build the application shell and workspace layout (`StudioShell`, `TopToolbar`, `LeftSidebar`, `RightInspector`, `BottomBar`, `ModalManager`) with a dark, high-density creative-tool aesthetic.
- Define and enforce the canonical `GameBlueprint` model (`BLUEPRINT_VERSION = 1`) with typed slices for metadata, style, symbols, symbol sets, special symbols, assets, elements, layers, canvas, scenes, reels, paylines, paytable, features, animations, audio, UI, preview, and export.
- Provide `ProjectPersistenceService` (`LocalProjectPersistenceService` and `StudioProjectPersistenceService`) supporting `createProject`, `loadProject`, `saveProject`, `updateProjectMeta`, `duplicateProject`, `listProjects`, and `deleteProject`, backed on the server by PostgreSQL (`DATABASE_URL`) or a deterministic local file-backed pool (`src/db/local-pool.ts` -> `.local/slot-studio-db.json`).
- Provide `StudioEditorStore` (`activeProject`, `activeScene`, `selectedElementIds`, `activeTool`, `activePanel`, `undoStack`, `redoStack`, `isDirty`, `viewport`) and typed command execution (`create_element`, `update_element`, `delete_element`, `move_element`, `resize_element`, `rotate_element`, `reorder_layer`, `group_layers`, `ungroup_layers`, `assign_asset`, `update_symbol`, `update_math`, `update_scene`, `update_canvas_config`).
- Provide `FutureAiBoundaryService` returning deterministic `not_implemented` capability states without calling external LLM APIs or simulating AI chat/execution.

### Explicitly Out of Scope
- Real slot-game engine execution, RNG, spin evaluation, or win certification (belongs to SECTION 2 — BACKEND / SLOT GAME ENGINE).
- AI generation, LLM API calls, or simulated AI workflows.

## 3. Implementation Summary
- Implemented `src/db/local-pool.ts` (`LocalPgPool`) and updated `src/db/index.ts` so all Drizzle ORM queries against `folders`, `projects`, and `project_assets` work identically whether `DATABASE_URL` is configured or the studio runs locally using `.local/slot-studio-db.json`.
- Implemented `src/lib/blueprint/canonical-types.ts`, `src/lib/blueprint/selectors.ts`, and updated `src/lib/blueprint/index.ts` to expose typed selectors (`selectProjectMeta`, `selectVisualStyle`, `selectSymbolSets`, `selectSymbols`, `selectStandaloneElements`, `selectScenes`, `selectCanvasConfig`, `selectLayers`, `selectReelConfig`, `selectPaylines`, `selectPaytable`, `selectFeatures`, `selectAnimations`, `selectAudioConfig`, `selectUiConfig`, `selectPreviewConfig`, `selectExportConfig`, `selectBlueprintSlices`) and `serializeBlueprint` / `deserializeBlueprint`.
- Implemented `src/lib/persistence/project-persistence.ts` with `LocalProjectPersistenceService` (browser `localStorage` + in-memory fallback with seeded demo projects) and `StudioProjectPersistenceService` (HTTP `/api/workspace` & `/api/projects` with automatic local fallback).
- Implemented `src/lib/editor/studio-editor-store.ts`, `src/lib/editor/commands.ts`, `src/lib/editor/keyboard-shortcuts.ts`, `src/lib/editor/navigation.ts`, and `src/lib/editor/toast-store.ts`.
- Implemented `src/lib/ai/boundary.ts` (`FutureAiBoundaryService`, `NOT_IMPLEMENTED_AI_STATE`) to isolate future AI hooks cleanly.
- Implemented reusable studio shell and UI primitives in `src/components/shell/{StudioShell,TopToolbar,LeftSidebar,RightInspector,BottomBar,ModalManager}.tsx`, `src/components/ui/{PanelHeader,EmptyState,ContextMenu,Tooltip}.tsx`, and `src/components/studio/{StudioRouteShell,ProjectOverviewBoard}.tsx`.

## 4. Files Created, Modified, or Deleted
- `src/db/local-pool.ts` *(Created)* — File-backed PostgreSQL pool shim (`LocalPgPool`) supporting Drizzle queries, `on conflict`, aggregates, and transactions stored in `.local/slot-studio-db.json`.
- `src/db/index.ts` *(Modified)* — Uses `pg.Pool` when `DATABASE_URL` is set, otherwise initializes `LocalPgPool`.
- `next.config.ts` *(Modified)* — Added `allowedDevOrigins` for `*.e2b.app`, `localhost`, and `127.0.0.1`.
- `src/lib/blueprint/canonical-types.ts` *(Created)* — Canonical F01 blueprint slice types (`AudioConfig`, `UiConfig`, `PreviewConfig`, `ExportConfig`, `GameBlueprintSlices`).
- `src/lib/blueprint/selectors.ts` *(Created)* — Typed slice selectors and JSON serialization helpers for `GameBlueprint`.
- `src/lib/blueprint/index.ts` *(Modified)* — Re-exports canonical types, factory, validation, and selectors.
- `src/lib/persistence/project-persistence.ts` *(Created)* — `ProjectPersistenceService`, `LocalProjectPersistenceService`, and `StudioProjectPersistenceService`.
- `src/lib/editor/commands.ts` *(Created)* — Typed command union (`EditorCommand`) and pure `applyEditorCommandToBlueprint` reducer for all 14 command types.
- `src/lib/editor/studio-editor-store.ts` *(Created)* — Observable `StudioEditorStore` with undo/redo stacks (`maxHistory = 100`), selection, tool, panel, dirty state, and viewport state.
- `src/lib/editor/keyboard-shortcuts.ts` *(Created)* — `KeyboardShortcutManager` and `DEFAULT_STUDIO_SHORTCUTS`.
- `src/lib/editor/navigation.ts` *(Created)* — `STUDIO_NAV_SECTIONS` covering all 10 studio sections (`Dashboard`, `New Game`, `Design`, `Canvas`, `Symbols`, `Assets`, `Math`, `Scenes`, `Preview`, `Export`).
- `src/lib/editor/toast-store.ts` *(Created)* — `ToastStore` for studio notifications.
- `src/lib/ai/boundary.ts` *(Created)* — `FutureAiBoundaryService` returning deterministic `not_implemented` descriptors.
- `src/components/ui/{PanelHeader,EmptyState,ContextMenu,Tooltip}.tsx` *(Created)* — Reusable dark-studio UI primitives.
- `src/components/shell/{StudioShell,TopToolbar,LeftSidebar,RightInspector,BottomBar,ModalManager}.tsx` *(Created)* — 5-region studio shell components.
- `src/components/studio/{StudioRouteShell,ProjectOverviewBoard}.tsx` *(Created)* — Route wrapper and overview board for studio routes.
- `src/app/dashboard/page.tsx`, `src/app/project/new/page.tsx`, `src/app/project/[projectId]/page.tsx`, `src/app/project/[projectId]/{design,symbols,assets,math,scenes,preview,export}/page.tsx`, `src/app/projects/[id]/{design,math,scenes,preview,export}/page.tsx`, `src/app/settings/page.tsx` *(Created)* — Route handlers connecting `/dashboard`, `/project/*`, `/projects/*`, and `/settings`.
- `tests/foundation.test.ts` *(Created)* — Unit test suite verifying F01 blueprint selectors, persistence service, editor store, commands, AI boundary, keyboard shortcuts, and navigation.

## 5. Architecture and Dependencies
- **Framework**: Next.js 16.2.6 (App Router, Turbopack), React 19, TypeScript 5, Tailwind CSS 4.
- **Database Layer**: Drizzle ORM (`src/db/schema.ts`: `folders`, `projects`, `projectAssets`) over `pg` or `LocalPgPool` (`src/db/local-pool.ts`).
- **Single Source of Truth**: `GameBlueprint` (`src/lib/blueprint/types.ts`, `BLUEPRINT_VERSION = 1`).
- **State & Command Layer**: Pure functional reducers (`applyEditorCommandToBlueprint`) wrapped by `StudioEditorStore` (`useSyncExternalStore`-compatible).

## 6. Data Flow and Persistence
- Server routes (`/api/workspace`, `/api/projects`, `/api/projects/[id]`, `/api/projects/[id]/design`, `/api/projects/[id]/canvas`, `/api/projects/[id]/assets`, `/api/folders`) read and write through `src/server/*-service.ts` into `db` (`LocalPgPool` -> `.local/slot-studio-db.json` when `DATABASE_URL` is unset).
- On first read, `ensureSeeded()` in `src/server/workspace-service.ts` populates 4 deterministic demo projects (`Roman Empire`, `Temple of Riches`, `Neon Sevens`, `Spring Hatch`) and nested folders (`Concept Art`, `Prototype Builds`, `Prototype Builds/Q2 Hold & Spin`).
- Client-side `LocalProjectPersistenceService` also supports standalone persistence in `localStorage` under `slot-studio.persistence.v1`.

## 7. Integration Points
- **F02 (Dashboard)**: Uses `workspace-service.ts` (`getWorkspaceSnapshot`, `createProject`, `patchProject`, `duplicateProject`, `deleteProject`, `restoreProject`, `createFolder`, `patchFolder`, `deleteFolder`) and `DEMO_PROJECTS`.
- **F03 (Project Creation)**: Uses `draftToBlueprint` to produce a valid `GameBlueprint` persisted via `createProject`.
- **F04 (Design View)**: Edits the `elements`, `symbols`, `symbolSets`, `specialSymbols`, `paytable`, `reels.strips`, and `assets` slices of `GameBlueprint`.
- **F05 & F06 (Canvas & Layers System)**: Edit the `scenes[i].objects`, `scenes[i].background`, and `layers` slices of `GameBlueprint`.

## 8. Controls and Behaviors
- **Keyboard Shortcuts (`DEFAULT_STUDIO_SHORTCUTS`)**:
  - `Ctrl/⌘ + Z`: Undo
  - `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y`: Redo
  - `Ctrl/⌘ + S`: Save project
  - `Ctrl/⌘ + D`: Duplicate selection
  - `Delete` / `Backspace`: Delete selection
  - `Escape`: Clear selection / close modal
  - `V`: Select tool, `H`: Pan tool
  - `+` / `=`: Zoom in, `-`: Zoom out, `0`: Reset zoom (100%)
  - `ArrowUp/Down/Left/Right`: Nudge selection by 1px (`Shift + Arrow`: 10px)
- Shortcuts automatically ignore keystrokes when focus is inside `<input>`, `<textarea>`, `<select>`, or `contentEditable` elements (except `Ctrl/⌘ + S` and `Escape`).

## 9. Testing and Verification
- **Unit & Integration Tests**:
  - Executed `npx tsx --test tests/foundation.test.ts` (7/7 tests pass).
  - Executed full test suite `npx tsx --test tests/*.test.ts` (77/77 tests pass).
- **Type Check & Lint**:
  - Executed `npm run typecheck` (`tsc --noEmit`: 0 errors).
- **Live Server Verification**:
  - Verified `/api/health`, `/api/workspace`, `/games`, `/dashboard`, `/project/new`, `/projects/prj_demo_roman_empire`, and `/settings` return HTTP 200 on `http://localhost:3000`.

## 10. Known Issues and Limitations
- `Math`, `Preview`, and `Export` sections in `STUDIO_NAV_SECTIONS` render structured overview/configuration inspection boards (`StudioRouteShell`) in this phase; full interactive math simulation and slot engine execution belong to later sections / SECTION 2.
- `FutureAiBoundaryService` is intentionally a non-executing boundary returning `not_implemented`.

## 11. Requirements Status
| Requirement | Status | Evidence |
| --- | --- | --- |
| 5-region Studio Shell (`TopToolbar`, `LeftSidebar`, `CenterWorkspace`, `RightInspector`, `BottomBar`, `ModalManager`) | `PASS` | `src/components/shell/*.tsx`, `tests/foundation.test.ts` |
| Canonical `GameBlueprint` (`BLUEPRINT_VERSION = 1`) & typed selectors | `PASS` | `src/lib/blueprint/{types,canonical-types,selectors}.ts`, `tests/foundation.test.ts` |
| `ProjectPersistenceService` (`create`, `load`, `save`, `updateMeta`, `duplicate`, `list`, `delete`) | `PASS` | `src/lib/persistence/project-persistence.ts`, `src/db/local-pool.ts`, `tests/foundation.test.ts` |
| `StudioEditorStore` & 12+ command types with undo/redo | `PASS` | `src/lib/editor/{studio-editor-store,commands}.ts`, `tests/foundation.test.ts` |
| Reserved non-executing AI boundary | `PASS` | `src/lib/ai/boundary.ts`, `tests/foundation.test.ts` |
| Keyboard shortcut & toast infrastructure | `PASS` | `src/lib/editor/{keyboard-shortcuts,toast-store}.ts`, `tests/foundation.test.ts` |

## 12. Next Steps
- Maintain `GameBlueprint` backward compatibility as later sections extend scene, asset, math, preview, or export slices.

---

## 13. Backup Information
- **Google Drive Backup Root**: `Slot Studio Backups` (Folder ID: `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Category Folder**: `Slot Studio Backups/F - Frontend` (Folder ID: `1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Backup Folder**: `Slot Studio Backups/F - Frontend/F01` (Folder ID: `19YyEbVLBoRvQbfq9frudcCpmJhg7LY4q`)
- **Backup Timestamp (UTC)**: `2026-10-12T09:34:30Z`
- **Backup Status**: `SUCCESS`
