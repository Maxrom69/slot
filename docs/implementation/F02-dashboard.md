# F02 — Dashboard

## 1. Section ID and Name
- **Section ID**: `F02`
- **Section Name**: `DASHBOARD`
- **Purpose**: Provide the project management hub (`/games` and `/dashboard`) for browsing, searching, sorting, organizing into folders, creating, renaming, moving, duplicating, and deleting slot game projects.

## 2. Objective and Scope
### Intended Scope
- Left navigation with `Your Games`, `New Game`, `Assets` (`projectcount · assetCount`), `Templates` (`Soon` badge), and `Settings`.
- Main workspace with `Your Games` heading, project search input, sort selector (`Last modified`, `Created`, `Name`), `New Folder` button, `New Game` CTA, folder breadcrumb navigation, folder tiles, and a responsive project card grid.
- Project card displaying key-art thumbnail (or procedural SVG fallback), project title, status badge (`Draft`, `Ready`, `Archived`), reel grid dimensions (`5×3`, `6×4`, etc.), paylines/ways summary, theme, relative last-modified timestamp, primary `Open` link, and context menu (`Rename…`, `Duplicate`, `Move to folder…`, `Delete`).
- Seeded starter projects (`Roman Empire`, `Temple of Riches`, `Neon Sevens`, `Spring Hatch`) and nested folders (`Concept Art`, `Prototype Builds`, `Prototype Builds/Q2 Hold & Spin`).
- Undoable soft-delete for projects (`⌘/Ctrl + Z` or Toast `Undo` button calls `/api/projects/[id]/restore`).

### Explicitly Out of Scope
- In-card game simulation or AI project generation.

## 3. Implementation Summary
- Implemented and refined `src/components/dashboard/{DashboardShell,SideNav,ProjectCard,FolderTile,Dialogs,ProceduralThumb}.tsx` and `src/lib/client/useWorkspace.ts`.
- Generated and stored deterministic key-art thumbnails in `public/thumbs/{roman-empire,temple-riches,neon-sevens,spring-hatch}.jpg` and symbol PNGs in `public/symbols/{key,idol,mask,priestess,chest,goblet}.png` so all seeded demo projects render crisp artwork without 404s.
- Fixed an effect dependency bug in `src/lib/client/useWorkspace.ts` where `refresh` depended on `activeFolder`, which previously caused creating a new subfolder and navigating into it to trigger an overlapping `/api/workspace` fetch that overwrote the optimistic folder list.
- Added responsive layout adjustments for `1440×900`, `1024×768`, and `390×844` viewports (mobile drawer toggle `Open navigation`, horizontal-overflow prevention, and accessible `role="navigation" aria-label="Breadcrumb"`).

## 4. Files Created, Modified, or Deleted
- `src/lib/client/useWorkspace.ts` *(Modified)* — Decoupled `refresh()` from `activeFolder` via `activeFolderRef` so folder creation + navigation stays consistent; manages search, sort, folder filtering, project/folder CRUD, toasts, and `⌘/Ctrl + Z` undo of project deletion.
- `src/components/dashboard/DashboardShell.tsx` *(Modified)* — Main dashboard layout, search input, sort dropdown, folder breadcrumbs, folder grid, project grid, empty states, and dialogs.
- `src/components/dashboard/SideNav.tsx` *(Modified)* — Left navigation sidebar with `Your Games`, `New Game`, `Assets`, `Templates (Soon)`, `Settings`, folder tree, and storage indicator.
- `src/components/dashboard/ProjectCard.tsx` *(Modified)* — Project card with thumbnail, status badge, grid/evaluation metadata, `Open` link, and accessible overflow menu (`Rename…`, `Duplicate`, `Move to folder…`, `Delete`).
- `src/components/dashboard/FolderTile.tsx` *(Modified)* — Folder tile with item counts and overflow menu (`Rename folder…`, `Move to…`, `Delete folder…`).
- `src/components/dashboard/Dialogs.tsx` *(Modified)* — Modal dialogs for `New Folder`, `Rename`, `Move to folder`, and `Delete` confirmation.
- `public/thumbs/{roman-empire,temple-riches,neon-sevens,spring-hatch}.jpg` *(Created)* — Key-art thumbnails for the 4 seeded demo projects.
- `public/symbols/{key,idol,mask,priestess,chest,goblet}.png` *(Created)* — Symbol artwork assets.
- `tests/dashboard.test.ts` *(Created)* — Unit and persistence tests for F02 (`F02.1` seeding, `F02.2` search, `F02.3` folder navigation/breadcrumbs/sorting, `F02.4` project & folder CRUD).
- `tests/dashboard.browser.mjs` *(Created)* — Playwright browser acceptance script for `/games`.

## 5. Architecture and Dependencies
- **Server Service**: `src/server/workspace-service.ts` (`getWorkspaceSnapshot`, `createProject`, `patchProject`, `duplicateProject`, `deleteProject`, `restoreProject`, `createFolder`, `patchFolder`, `deleteFolder`).
- **API Routes**:
  - `GET /api/workspace`
  - `POST /api/projects`, `PATCH /api/projects/[id]`, `DELETE /api/projects/[id]`, `POST /api/projects/[id]/duplicate`, `POST /api/projects/[id]/restore`
  - `POST /api/folders`, `PATCH /api/folders/[id]`, `DELETE /api/folders/[id]`
- **Client Hook**: `useWorkspace(initialSnapshot)` in `src/lib/client/useWorkspace.ts`.

## 6. Data Flow and Persistence
- Initial render of `/games` (`src/app/games/page.tsx`) or `/dashboard` (`src/app/dashboard/page.tsx`) fetches `getWorkspaceSnapshot()` on the server and passes it to `<DashboardShell initial={snapshot} />`.
- Mutations update state via `/api/projects/*` and `/api/folders/*`, persisting immediately to PostgreSQL / `LocalPgPool` (`.local/slot-studio-db.json`).
- Navigating back to `/games` (`pageshow` / `focus` / `studio:workspace-changed` events) triggers `refresh()` to keep the project index synchronized.

## 7. Integration Points
- **F01 (Studio Foundation)**: Shares `projects`, `folders`, and `project_assets` schema and `GameBlueprint` validation.
- **F03 (Project Creation)**: Clicking `New Game` navigates to `/games/new`; creating a project redirects to `/projects/[id]` and updates the dashboard index.
- **F04 (Design View)**: Clicking `Open` on a project card opens `/projects/[id]`.

## 8. Controls and Behaviors
- **Search (`Search projects`)**: Filters projects across `title`, `theme`, `styleGuide`, and `folderPath`. When a search query is active, matches across all folders are shown with their folder badge.
- **Sort (`Sort projects`)**: Sorts by `updated` (newest first), `created` (newest first), or `name` (alphabetical).
- **Folder Navigation**: Clicking a folder tile or sidebar folder scopes the view to that folder path and renders a `Breadcrumb` navigation bar (`All Games / Folder / Subfolder`).
- **Project Actions (`More actions for <title>`)**:
  - `Rename…`: Opens modal to update title, status (`draft`, `ready`, `archived`), or folder.
  - `Duplicate`: Clones the project and its `GameBlueprint` (`"<Title> Copy"`).
  - `Move to folder…`: Moves the project to root (`All Games`) or any folder.
  - `Delete`: Confirm dialog -> soft-deletes project (`deletedAt` timestamp) and shows an undoable toast (`⌘/Ctrl + Z` restores the project).

## 9. Testing and Verification
- **Unit & Persistence Tests**:
  - Executed `npx tsx --test tests/dashboard.test.ts` (4/4 tests pass: demo seeding, search across fields, folder navigation/breadcrumbs/sorting, and project/folder create/rename/move/duplicate/delete/restore).
- **Type Check & Lint**:
  - Executed `npm run typecheck` (0 errors) and `npx eslint src/components/dashboard src/lib/client/useWorkspace.ts tests/dashboard.test.ts` (0 errors).
- **Live HTTP Verification**:
  - Verified `GET /games`, `GET /api/workspace`, `POST /api/folders`, `PATCH /api/folders/[id]`, `POST /api/projects/[id]/duplicate`, `DELETE /api/projects/[id]`, and `POST /api/projects/[id]/restore` against `http://localhost:3000`.

## 10. Known Issues and Limitations
- The `Templates` item in the left navigation is intentionally marked `Soon` (disabled) as template libraries are outside F02 scope.
- `tests/dashboard.browser.mjs` is provided for external Playwright runners (`PLAYWRIGHT_MODULE`); in this sandbox environment without a local Chromium binary, all API/service/SSR flows were verified via `tests/dashboard.test.ts` and live HTTP requests.

## 11. Requirements Status
| Requirement | Status | Evidence |
| --- | --- | --- |
| Left navigation (`Your Games`, `New Game`, `Assets`, `Templates`, `Settings`) | `PASS` | `src/components/dashboard/SideNav.tsx` |
| Main area (`Your Games` header, search, sort, folder breadcrumbs, project grid) | `PASS` | `src/components/dashboard/DashboardShell.tsx`, `tests/dashboard.test.ts` |
| Project card (thumbnail, name, status badge, reel size, updated time, `Open`, overflow menu) | `PASS` | `src/components/dashboard/ProjectCard.tsx` |
| Actions: Create, Open, Rename, Move to folder, Duplicate, Delete with confirmation & Undo | `PASS` | `src/lib/client/useWorkspace.ts`, `src/server/workspace-service.ts`, `tests/dashboard.test.ts` |
| Sample projects seeded & changes persist | `PASS` | `src/lib/blueprint/samples.ts`, `tests/dashboard.test.ts` |

## 12. Next Steps
- None required for F02; dashboard integrates with F03 (`/games/new`) and F04 (`/projects/[id]`).

---

## 13. Backup Information
- **Google Drive Backup Root**: `Slot Studio Backups` (Folder ID: `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Category Folder**: `Slot Studio Backups/F - Frontend` (Folder ID: `1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Backup Folder**: `Slot Studio Backups/F - Frontend/F02` (Folder ID: `1EpmmG8fKVW57U9eD1SxOKf1RD27wg58P`)
- **Backup Timestamp (UTC)**: `2026-10-12T09:34:30Z`
- **Backup Status**: `SUCCESS`
