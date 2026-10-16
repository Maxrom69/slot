# F12 — Image History

## 1. Section ID and Name
- **Section ID**: `F12`
- **Section Name**: Image History (`SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`)
- **Date**: 2026-10-12

---

## 2. Objective and Scope
The objective of **F12 — Image History** is to provide a reliable, non-destructive image-version history interface across the Slots Studio Builder so that symbols and standalone elements retain multiple previous image versions, allow side-by-side timeline or grid inspection, support restoring any earlier version as a normal undoable state change, and block deleting a revision if another component still requires it without showing a dependency warning.

### Documented Expectation
- The system keeps multiple previous image versions.

### Build Scope
1. **History Timeline / Grid**:
   - Interactive `Timeline` and `Grid` view modes in `ImageHistoryPanel`.
   - Every revision displays:
     - `thumbnail` (rendered image preview or vector/placeholder badge)
     - `timestamp` (ISO timestamp + localized formatted date/time)
     - `source` (`Created`, `Imported`, `Uploaded`, `Duplicated`, `From variant`, `Restored`)
     - `label` (editable version label and notes, e.g., `v3 — Final polished gold bezel`)
     - `current indicator` (`Current` badge when matching the active element/symbol artwork)
2. **Revision Actions**:
   - `Preview`: Full-resolution modal inspection with checkerboard alpha backdrop, dimensions, format, file size, asset reference, timestamp, source badge, and quick `Set as Current` / `Download` actions.
   - `Set as Current`: Restores any historical revision as the active artwork, records the restoration in `imageHistory` (`source: "restore"`), and commits a normal state change to `useDesignEditor` so it is 100% undoable (`Ctrl/Cmd+Z`) and redoable (`Ctrl/Cmd+Shift+Z`).
   - `Download`: Downloads the revision's underlying image asset (`data:` or external URI) with a deterministic versioned filename.
   - `Delete revision`: Computes cross-project dependencies via `checkRevisionDeletionImpact` and **refuses to delete** a version if another component (active artwork, variant, element, symbol, scene object/background, canvas background, or style reference) still requires it unless the user confirms in the **Revision Dependency Warning Modal**.
3. **Acceptance Criteria**:
   - Image history survives project persistence (`GameBlueprint` / `saveDesign` / `getProject`).
   - Changing current artwork does not erase the prior version.

---

## 3. Implementation Summary
- **Extended `ImageRevision` Model & Parser (`src/lib/blueprint/types.ts`, `src/lib/design/model.ts`, `src/lib/design/parse.ts`)**:
  - Added optional `label?: string` to `ImageRevision` alongside `id`, `asset`, `createdAt`, `source`, and `notes`.
  - Updated `sanitizeImageRevision` and `parseImageRevision` so custom revision labels round-trip losslessly through `DesignDoc` and `GameBlueprint`.
- **Image History Domain Service (`src/lib/design/image-history.ts`)**:
  - `getImageHistoryItems(doc, target)`: Normalizes a symbol's or element's `imageHistory` into `RevisionViewItem[]` with `versionNumber`, `displayLabel`, `notes`, `thumbnailUri`, `assetName`, `assetRefText`, `dimensionsText`, `formatText`, `sizeText`, `timestamp`, `formattedTimestamp`, `source`, `sourceLabel`, and `isCurrent`.
  - `checkRevisionDeletionImpact(doc, target, revisionId, blueprint)`: Inspects active current artwork, element/symbol variants, other elements and symbols, symbol set frames/backgrounds, scene objects and scene backgrounds, canvas background, and project style reference. Sets `requiresWarning = isCurrentActive || dependencies.length > 0`.
  - `deleteImageRevision(doc, target, revisionId, options)`: Blocks deletion (`deleted: false, blockedByDependencies: true`) whenever `impact.requiresWarning` is true and `options?.confirmWithDependencies !== true`. When confirmed, removes the revision entry while adding any still-referenced project `assetId` to `protectedAssetIds` so `finalizeDoc` never garbage-collects an asset required by another component.
  - `setRevisionAsCurrent(doc, target, revisionId, options)`: Restores the selected revision as the active artwork via `restoreImageRevision` / `restoreElementImageRevision`, preserving all existing revisions and creating a standard `DesignDoc` state transition for Undo/Redo.
  - `updateImageRevisionLabel(doc, target, revisionId, patch)`: Updates `label` and `notes` on a specific revision.
- **Reusable Image History UI (`src/components/design/ImageHistoryPanel.tsx`)**:
  - Provides a `Timeline` / `Grid` view switcher, version counter, current-asset summary badge, per-revision cards with thumbnail, version number, `Current` badge, `source` pill, `timestamp`, `label`/`notes` inline editor, and `Preview`, `Set as Current`, `Download`, and `Delete` buttons.
  - Includes the **Revision Preview Modal** and **Revision Dependency Warning Modal**.
- **Integrated into Element Detail View & Symbol Editor (`src/components/design/ElementDetail.tsx`, `src/components/design/SymbolEditor.tsx`)**:
  - Wired `ImageHistoryPanel` into Section 7 (`History`) of `ElementDetail.tsx` and Section 6 (`Image history`) of `SymbolEditor.tsx`.

---

## 4. Files Created, Modified, or Deleted

### Created (`4` files)
| Relative Path | Purpose |
|---|---|
| `src/lib/design/image-history.ts` | F12 domain service for revision view items, dependency impact analysis, guarded revision deletion, `Set as Current` restoration, and label editing |
| `src/components/design/ImageHistoryPanel.tsx` | Reusable F12 Image History `Timeline` / `Grid` component with `Preview` modal, `Set as Current`, `Download`, inline `Label` editing, and `Revision Dependency Warning Modal` |
| `tests/image-history.test.ts` | Comprehensive F12 automated unit & persistence test suite (`4` subtests covering display fields, undoable restore, dependency-guarded deletion, and database persistence) |
| `docs/implementation/F12-image-history.md` | This 13-section implementation and backup report |

### Modified (`7` files)
| Relative Path | Change Summary |
|---|---|
| `src/lib/blueprint/types.ts` | Added optional `label?: string` field to `ImageRevision` |
| `src/lib/design/model.ts` | Updated `sanitizeImageRevision` to preserve and sanitize `label` (`slice(0, 120)`) |
| `src/lib/design/parse.ts` | Updated `parseImageRevision` to validate and preserve `label` during server/client payload parsing |
| `src/components/design/ElementDetail.tsx` | Replaced basic history list in Section 7 (`History`) with `ImageHistoryPanel` (`Timeline`/`Grid`, `Preview`, `Set as Current`, `Download`, `Label`, guarded `Delete`) |
| `src/components/design/SymbolEditor.tsx` | Replaced basic history list in Section 6 (`Image history`) with `ImageHistoryPanel` |
| `docs/implementation/INDEX.md` | Added `F12 — Image History` entry to the master implementation index |
| `docs/backups/Backup-Manifest.md` | Recorded `F12` Google Drive folder ID, uploaded file IDs, MD5 checksums, and verification status |

### Deleted (`0` files)
- None.

---

## 5. Architecture and Dependencies
- **Clean Separation of Concerns**:
  - `src/lib/design/image-history.ts` contains pure, deterministic state transformations (`getImageHistoryItems`, `checkRevisionDeletionImpact`, `deleteImageRevision`, `setRevisionAsCurrent`, `updateImageRevisionLabel`) with zero React or DOM dependencies.
  - `src/components/design/ImageHistoryPanel.tsx` renders the `Timeline` and `Grid` views and modals, delegating state commits to `editor.commit(label, fn)` so every mutation participates in the studio's Undo/Redo stack.
- **No Unnecessary Dependencies**:
  - Built entirely with React 19, Next.js 15, TypeScript 5.8, and existing studio design primitives.

---

## 6. Data Flow and Persistence
1. **Artwork Replacement / Upload / Assignment**:
   - Whenever artwork is uploaded, replaced, cleared, or promoted from a variant (`replaceSymbolArtwork`, `replaceElementArtwork`, `clearSymbolArtwork`, `clearElementArtwork`, `promoteVariantToPrimary`, `promoteElementVariantToPrimary`), `appendImageRevision` ensures the outgoing project asset is recorded in `imageHistory` before prepending the new `ImageRevision` entry (`id`, `asset`, `createdAt`, `source`, `label`, `notes`).
   - `collectReferencedAssetIds` in `src/lib/design/model.ts` walks every revision in `el.imageHistory` and `sym.imageHistory` so `finalizeDoc` retains all historical `AssetRef` entries in `doc.assets`.
2. **Restore (`Set as Current`) & Undo/Redo**:
   - Clicking `Set as Current` calls `setRevisionAsCurrent(doc, target, revisionId)` inside `editor.commit(...)`, updating the active `assetId`/`image`, appending a `restore` revision entry, and pushing a snapshot onto `HistoryState<DesignDoc>`. Pressing `Ctrl/Cmd+Z` immediately reverts to the previous active artwork.
3. **Persistence Round-Trip**:
   - `useDesignEditor` autosaves `DesignDoc` via `PUT /api/projects/[id]/design` (`saveDesign` in `src/server/design-service.ts`), which validates via `parseDesignDoc` and writes the updated `GameBlueprint` to PostgreSQL / `.local/slot-studio-db.json`.

---

## 7. Integration Points
- **Element Detail View (`src/components/design/ElementDetail.tsx`)**:
  - Section 7 (`History`) renders `ImageHistoryPanel` for both standalone elements (`target={{ kind: "element", id: el.id }}`) and symbol-backed elements (`target={{ kind: "symbol", id: linkedSymbol.id }}`).
- **Symbol Editor (`src/components/design/SymbolEditor.tsx`)**:
  - Section 6 (`Image history`) renders `ImageHistoryPanel` (`target={{ kind: "symbol", id: sym.id }}`) inside the Design View symbol inspector.
- **Element System Adapter (`src/lib/elements/blueprint-adapter.ts`)**:
  - Preserves `imageHistory` losslessly when converting between `GameBlueprint` and `ElementLibrary`.

---

## 8. Controls and Behaviors
| Control | Location | Behavior |
|---|---|---|
| `Timeline` / `Grid` Toggle | `ImageHistoryPanel` Header | Switches between chronological vertical timeline cards and multi-column visual grid cards |
| Revision Card | `ImageHistoryPanel` Body | Displays `thumbnail`, `versionNumber` (`vN`), `label`, `Current` indicator badge, `source` pill (`Created`, `Uploaded`, `Imported`, `Duplicated`, `From variant`, `Restored`), `timestamp`, dimensions, and asset reference |
| `Preview` | Revision Card & Modal | Opens full-size **Revision Preview Modal** with checkerboard alpha backdrop, metadata table, `Download`, and `Set as Current` |
| `Set as Current` | Revision Card & Preview Modal | Restores the selected revision as the active artwork via `editor.commit(...)` (undoable with `Ctrl/Cmd+Z`); disabled when already current |
| `Download` | Revision Card & Preview Modal | Triggers browser download of the revision's image asset with a versioned filename |
| `Label` (`Edit`) | Revision Card | Opens inline editor for custom revision `label` and `notes`, saved via `updateImageRevisionLabel` |
| `Delete` | Revision Card | Runs `checkRevisionDeletionImpact`; deletes immediately if unused, or opens **Revision Dependency Warning Modal** listing all dependent components before allowing confirmation |

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
  Result: `101/101` tests passing across all 12 test suites (`tests/image-history.test.ts` verified all 4 F12 subtests: display fields & label editing, `Set as Current` + Undo/Redo, dependency warning blocking unconfirmed deletion, and full database persistence round-trip).
- **Live HTTP Route Verification**:
  - `GET /projects/prj_demo_roman_empire/design` → `200 OK`
  - `GET /projects/prj_demo_roman_empire/elements/el-game-title` → `200 OK`
  - `GET /projects/prj_demo_roman_empire/elements/el-game-title/editor` → `200 OK`

---

## 10. Known Issues and Limitations
- Maximum stored revisions per element or symbol is capped at `100` (`MAX_IMAGE_REVISIONS = 100`) in `src/lib/design/operations.ts` and `src/lib/design/parse.ts` to keep blueprint payloads bounded.
- Revisions referencing a cleared placeholder state (`asset: null`) display a placeholder badge and disable the `Download` button since there is no binary file URI to download.

---

## 11. Requirements Status
| Requirement | Status | Notes |
|---|---|---|
| Keep multiple previous image versions | **PASS** | Verified in `src/lib/design/operations.ts` and `tests/image-history.test.ts` |
| History timeline / grid view modes | **PASS** | Implemented in `src/components/design/ImageHistoryPanel.tsx` (`Timeline` and `Grid` toggle) |
| Each revision displays `thumbnail`, `timestamp`, `source`, `label`, `current indicator` | **PASS** | Provided by `getImageHistoryItems` and rendered in both `Timeline` and `Grid` modes |
| Actions: `Preview`, `Set as Current`, `Download`, `Delete revision` | **PASS** | All 4 actions + inline `Label` editing wired and functional |
| Do NOT delete a version if another component still requires it without showing a dependency warning | **PASS** | Enforced by `checkRevisionDeletionImpact`, `deleteImageRevision`, and the **Revision Dependency Warning Modal** |
| Restoring an image creates a normal state change and is undoable | **PASS** | `setRevisionAsCurrent` commits to `HistoryState<DesignDoc>` (`commitHistory` / `undoHistory` / `redoHistory`) |
| Image history survives project persistence & changing current artwork does not erase prior version | **PASS** | Verified end-to-end via `saveDesign` and `getProject` in `tests/image-history.test.ts` |

---

## 12. Next Steps
- Proceed to the next section of the Slots Studio Builder specification while preserving all `F01`–`F12` routes, services, and `GameBlueprint` contracts.

---

## 13. Backup Information
- **Google Drive Root Backup Folder**: `Slot Studio Backups` (`1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Frontend Category Folder**: `Slot Studio Backups/F - Frontend` (`1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Destination Folder**: `Slot Studio Backups/F - Frontend/F12` (`1nGGpPzJCIxpITIleAcfTL8kMV7tVD0Jo`)
- **Backup Timestamp**: `2026-10-12T19:15:00Z`
- **Upload Status**: `SUCCESS` (11/11 incremental section files + root `Backup Manifest.md` verified)

### Uploaded Files & Google Drive IDs
| Relative Path | Google Drive File ID | Size (Bytes) | MD5 Checksum |
|---|---|---|---|
| `src/lib/blueprint/types.ts` | `192aKJdjp5xhgQ8sj3mQb2ieLJsbzi74f` | `15826` | `357c75abb1059af9693947ce81754f36` |
| `src/lib/design/model.ts` | `1bkAz3nHU2X7djW24kVYDdqZp7KKlok-T` | `14691` | `e6ba1f2266c69ffa2d35dd2edb0e6561` |
| `src/lib/design/parse.ts` | `1NTzT0lAJHzTqKQUtad3nfLplMuiY__TL` | `16612` | `efc66f94657ce014a8e5c4f791f0c142` |
| `src/lib/design/image-history.ts` | `19E5sCZ5ZKVHy-tyiQggoccC0ZUwPZTKC` | `17332` | `ed4749db2e533619d0dfd944ed80ff13` |
| `src/components/design/ImageHistoryPanel.tsx` | `1DWDBQ7xngN2ipjXT7FmCi8BBom8gEwpH` | `31963` | `06a6609e3fad6cdd42b845ce89b062ea` |
| `src/components/design/ElementDetail.tsx` | `1Jz8mipNJU8aiMkrVQtq_udX2Y_rAtw_2` | `57951` | `2a57ac40e037a83e44af80d5cd835f93` |
| `src/components/design/SymbolEditor.tsx` | `1zEB2Ehk-jcc6BVpblASiUX4jL3AO-bIn` | `34973` | `299820639fcfa38bfebca50468a5c3a2` |
| `tests/image-history.test.ts` | `1V4ubMz282Jg2GUmZne-TEdN-mHcW6aBX` | `15495` | `c4fa71320c85c169a3bc5e03c59a497d` |
| `docs/implementation/F12-image-history.md` | `112oDB2DpXNJtKt5oc8kYcTYUKsXXzF9r` | `15772` | `VERIFIED` |
| `docs/implementation/INDEX.md` | `1nTPJAeYtOrpPmjtSNKuV-Pkx8F-t00SL` | `4196` | `c56811b9906904191452de140b99ed6b` |
| `docs/backups/Backup-Manifest.md` | `1BA7WzTpW5qbz8aZTtlS3R1bFUVxBrUX_` | `21170` | `VERIFIED` |
