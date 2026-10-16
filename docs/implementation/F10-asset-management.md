# F10 — Asset Management

## 1. Section ID and Name
- **Section ID**: `F10`
- **Section Name**: Asset Management
- **Phase**: Section 1 — Frontend / Slots Studio Builder
- **Completion Date**: 2026-10-12

---

## 2. Objective and Scope
Implement a centralized project Asset Library (`/projects/[id]/assets`) that provides:
- **Asset Browser**:
  - Thumbnail grid view (`AssetCard`) and tabular list view (`AssetRow`) with instant view-mode toggle.
  - Full-text search across asset filename, stable asset ID, format label, MIME type, and tags.
  - Category/type filter pills with live counts across `All Assets`, `Images`, `Transparent PNG`, `JPEG`, `WebP`, `Animation metadata`, `Vector`, and `Other`.
  - Tag pills, pixel dimensions (`width × height px`), usage count badges (`In use (N)` / `Unused`), and explicit selected state (`data-selected`, `aria-selected`, and visual focus ring).
- **Asset Types**:
  - First-class detection, decoding, and classification for `Images`, `Transparent PNG` (`png-transparent`), `PNG` (`png`), `JPEG` (`jpeg`), `WebP` (`webp`), `Animation metadata` (`json-animation`), `Vector` (`svg`), and `Other` (`audio`, `font`, `other`).
- **Upload & Validation**:
  - Drag-and-drop and file-picker multi-file upload (`AssetUploadZone`) with live per-file progress and status reporting.
  - Client-side (`validateAndPrepareUpload`) and server-side (`decodeArtwork`) validation of **file type**, **file size** (non-empty up to `15 MB`), and **image dimensions** (up to `20,000 × 20,000 px`), plus binary header magic-number inspection, PNG IHDR/tRNS alpha detection, JPEG SOF dimension extraction, WebP VP8/VP8L/VP8X parsing, SVG script/event sanitization, and JSON Spine/Lottie metadata parsing.
- **Asset Details Inspector**:
  - Dedicated right-hand inspector (`AssetDetailsPanel`) displaying large preview (with checkerboard alpha backdrop for transparent assets), inline-editable filename, dimensions, format, file size, MIME type, created date, interactive tag editor, `Used by` reference breakdown (distinguishing active references from historical revisions), `Assign Asset to Element / Symbol`, `Download`, and `Delete Asset`.
- **Usage Tracking & Deletion Safety**:
  - Deep reference inspection (`findAssetUsage`) across symbols, symbol variants, symbol image history, standalone elements, standalone element image history, symbol set frames/backgrounds, scene backgrounds, canvas background, and style moodboard references.
  - Safe deletion dialog (`AssetDeleteDialog`) that warns before deleting an in-use asset, lists all affected symbols/elements/scenes, and invokes `safeUnbindAsset` so deleting an asset never leaves dangling references or corrupts the `GameBlueprint`.
- **Image History**:
  - Revision-aware asset identity (`AssetRevision` on `AssetRef.revisions` and `ImageRevision` on both `SymbolDef.imageHistory` and `ElementDef.imageHistory`) so both symbols and standalone elements can point to multiple image revisions and restore prior revisions without losing earlier asset references.

---

## 3. Implementation Summary
1. **Asset Decoding & Multi-Format Classification (`src/lib/assets/decode.ts`, `src/lib/assets/upload-helper.ts`)**:
   - Implemented binary header & format inspection in `decodeArtwork` for Transparent PNG (`png-transparent`), Opaque PNG (`png`), JPEG (`jpeg`), WebP (`webp`), SVG Vector (`svg`), Animation JSON (`json-animation`), Audio (`audio`), and Font/Other (`other`).
   - Implemented `validateAndPrepareUpload` in `src/lib/assets/upload-helper.ts` with both browser (`FileReader`, `Image`) and Node.js (`arrayBuffer`, `decodeArtwork`) support to validate file type, file size (`0 < size <= 15 MB`), and image dimensions (`1 <= width, height <= 20,000 px`).
2. **Usage Tracking, Assignment, Image History & Safe Unbinding (`src/lib/assets/usage.ts`, `src/lib/blueprint/types.ts`, `src/lib/blueprint/validate.ts`, `src/lib/design/model.ts`, `src/lib/design/parse.ts`, `src/lib/design/operations.ts`)**:
   - Extended `ElementDef` in `src/lib/blueprint/types.ts` with `imageHistory?: ImageRevision[]` and updated `validateBlueprint` (`src/lib/blueprint/validate.ts`), `finalizeDoc` (`src/lib/design/model.ts`), and `parseDesignDoc` (`src/lib/design/parse.ts`) to validate, retain, and serialize standalone element image history alongside symbol image history.
   - Added `replaceElementArtwork`, `findPreviousElementImageRevision`, `restoreElementImageRevision`, and `restorePreviousElementImageRevision` in `src/lib/design/operations.ts`.
   - Updated `assignAsset` and `restoreBlueprintImageRevision` in `src/lib/assets/usage.ts` so assigning an asset to either a symbol or a standalone element records a non-destructive `ImageRevision` entry and preserves any previous active artwork in `imageHistory`, while also supporting `symbol_variant`, `symbol_set_frame`, `symbol_set_bg`, `scene_background`, and `canvas_background`.
   - Updated `findAssetUsage` to track active references and non-active historical revisions without double-counting when an asset is both the active artwork and the latest history revision, and updated `safeUnbindAsset` to cleanly remove deleted asset IDs from active slots and `imageHistory` arrays across both symbols and standalone elements.
3. **Server Persistence & Asset Browser UI (`src/server/asset-service.ts`, `src/components/assets/*`)**:
   - Updated `uploadProjectAsset` in `src/server/asset-service.ts` to initialize `AssetRef.revisions` on upload and preserve `projects.revision` compatibility with concurrent Design View sessions.
   - Enhanced `AssetCard.tsx`, `AssetRow.tsx`, `AssetDetailsPanel.tsx`, and `AssetAssignDialog.tsx` with explicit `aria-selected` / `data-selected` states, tag pills in list view, active vs. history badges in `Used by`, and `symbol_variant` assignment support.

---

## 4. Files Created, Modified, or Deleted

| Path | Action | Size (Bytes) | Purpose |
|---|---|---:|---|
| `src/lib/blueprint/types.ts` | Modified | 14,913 | Added `imageHistory?: ImageRevision[]` to `ElementDef` alongside `SymbolDef.imageHistory` and `AssetRef.revisions` |
| `src/lib/blueprint/validate.ts` | Modified | 7,233 | Validated `el.imageHistory` asset references in `validateBlueprint` |
| `src/lib/design/model.ts` | Modified | 13,682 | Generalized `sanitizeRevisions` and retained `el.imageHistory` and library assets (`createdAt`) in `finalizeDoc` |
| `src/lib/design/parse.ts` | Modified | 13,754 | Preserved `ElementDef.imageHistory` and `AssetRef.revisions` during design document parsing |
| `src/lib/design/operations.ts` | Modified | 41,316 | Added `replaceElementArtwork`, `findPreviousElementImageRevision`, `restoreElementImageRevision`, and `restorePreviousElementImageRevision` |
| `src/lib/assets/usage.ts` | Modified | 17,454 | Updated `findAssetUsage`, `safeUnbindAsset`, `assignAsset` (with symbol/element `imageHistory` & `symbol_variant`), and added `restoreBlueprintImageRevision` |
| `src/lib/assets/decode.ts` | Modified | 8,822 | Added `other` (font binary) decoding alongside PNG/alpha, JPEG, WebP, SVG, JSON animation, and Audio |
| `src/lib/assets/upload-helper.ts` | Modified | 7,568 | Validated file type, file size, and image dimensions across all F10 asset categories in both browser and Node.js |
| `src/server/asset-service.ts` | Modified | 10,660 | Initialized `AssetRef.revisions` on upload and normalized `createdAt` and project revision handling |
| `src/components/assets/AssetCard.tsx` | Modified | 6,763 | Added `data-selected` and `aria-selected` attributes on thumbnail grid cards |
| `src/components/assets/AssetRow.tsx` | Modified | 5,376 | Added `data-selected`, `aria-selected`, and tag pills in list view rows |
| `src/components/assets/AssetDetailsPanel.tsx` | Modified | 11,115 | Added `Active Reference` vs. `History Revision` badges in `Used by` and test/accessibility hooks for all details fields |
| `src/components/assets/AssetAssignDialog.tsx` | Modified | 6,818 | Filtered standalone elements (`e.type !== "symbol" && e.type !== "symbol_set"`) and added `symbol_variant` target support |
| `tests/assets.test.ts` | Modified | 22,458 | Expanded F10 unit and server persistence test suite to 14 tests covering decoding, upload validation, image history, usage tracking, safe deletion, and DB persistence |
| `docs/implementation/F10-asset-management.md` | Created | 20,675 | 13-section F10 implementation and verification report |
| `docs/implementation/INDEX.md` | Modified | 3,568 | Updated master implementation index with `F10` status and report link |
| `docs/backups/Backup-Manifest.md` | Modified | 14,835 | Recorded `F10` incremental Google Drive backup file IDs and verification |

---

## 5. Architecture and Dependencies
- **Centralized Asset Service (`src/server/asset-service.ts`)**:
  - Coordinates binary storage in `project_assets` (`id`, `project_id`, `mime`, `size_bytes`, `data_base64`, `created_at`) and metadata synchronization in `projects.blueprint.assets`.
- **Format & Usage Domain Layer (`src/lib/assets/`)**:
  - `decode.ts`: Pure binary parser for PNG, JPEG, WebP, SVG, JSON animation, Audio, and Font binaries.
  - `upload-helper.ts`: Pre-upload validator enforcing file type, file size (`15 MB` max), and pixel dimensions (`20,000 × 20,000 px` max).
  - `usage.ts`: Pure `GameBlueprint` query/transform layer (`detectAssetFormat`, `matchesFilterCategory`, `findAssetUsage`, `safeUnbindAsset`, `assignAsset`, `restoreBlueprintImageRevision`).
- **No Unnecessary Dependencies**:
  - Zero external image-processing or AI dependencies added; PNG/JPEG/WebP/SVG/JSON header inspection is implemented in deterministic TypeScript.

---

## 6. Data Flow and Persistence
1. **Upload Flow**:
   - Dragging or picking files in `AssetUploadZone` runs `validateAndPrepareUpload(file)` to verify file type, size, and dimensions, then sends `POST /api/projects/[id]/assets` (`uploadProjectAsset`).
   - `uploadProjectAsset` runs `decodeArtwork` on the server, inserts the binary payload into `project_assets`, appends a complete `AssetRef` (including initial `revisions` metadata) to `blueprint.assets`, validates the blueprint via `validateBlueprint`, and persists to the database.
2. **Assignment & Image History Flow**:
   - Assigning an asset via `POST /api/projects/[id]/assets/[assetId]/assign` (`assignProjectAsset`) updates the target symbol, symbol variant, standalone element, symbol set frame/background, scene background, or canvas background, records an `ImageRevision` entry on `symbol.imageHistory` or `element.imageHistory`, and persists the updated `GameBlueprint`.
3. **Safe Deletion Flow**:
   - Deleting an asset via `DELETE /api/projects/[id]/assets/[assetId]` (`deleteProjectAsset`) invokes `safeUnbindAsset(bp, assetId)` inside a transaction, clearing any active or historical references to `assetId`, validating `GameBlueprint` integrity, and deleting the row from `project_assets`.

---

## 7. Integration Points
- **Route**: `/projects/[id]/assets` (`src/app/projects/[id]/assets/page.tsx`) renders `AssetLibraryApp` inside `WorkspaceShell`.
- **API Endpoints**:
  - `GET /api/projects/[id]/assets` & `POST /api/projects/[id]/assets` (`src/app/api/projects/[id]/assets/route.ts`)
  - `PATCH /api/projects/[id]/assets/[assetId]` & `DELETE /api/projects/[id]/assets/[assetId]` (`src/app/api/projects/[id]/assets/[assetId]/route.ts`)
  - `POST /api/projects/[id]/assets/[assetId]/assign` (`src/app/api/projects/[id]/assets/[assetId]/assign/route.ts`)
  - `GET /api/assets/[id]` (`src/app/api/assets/[id]/route.ts`) serves raw binary bytes with `Cache-Control` headers.
- **Design View & Symbol Editor Integration**:
  - Assets uploaded in `/projects/[id]/assets` are immediately available in the Design View (`ElementDetail`, `SetEditor`) and Symbol Editor (`SymbolEditor`) asset pickers, and vice versa.

---

## 8. Controls and Behaviors

| Control / Surface | Location | Behavior |
|---|---|---|
| **Category Filter Pills** | Left Sidebar (`AssetLibraryApp`) | Filters assets by `All Assets`, `Images`, `Transparent PNG`, `JPEG`, `WebP`, `Animation metadata`, `Vector`, or `Other` with live counts |
| **Tag Filter Pills** | Left Sidebar (`AssetLibraryApp`) | Filters assets by project tag (`#imported`, `#library`, custom tags) |
| **Search Input** | Top Sub-Toolbar (`AssetLibraryApp`) | Filters assets by filename, ID, format label, MIME type, or tag |
| **Grid / List View Toggle** | Top Sub-Toolbar (`AssetLibraryApp`) | Switches between thumbnail grid (`AssetCard`) and table list view (`AssetRow`) |
| **Upload Zone / Button** | Top Sub-Toolbar & Collapsible Dropzone | Supports drag-and-drop and multi-file picker upload with validation feedback |
| **Asset Card / Row** | Center Browser | Displays preview, format badge, alpha indicator, filename, dimensions, tags, usage badge, and selected state |
| **Asset Details Inspector** | Right Sidebar (`AssetDetailsPanel`) | Shows preview, inline filename input, format, dimensions, size, MIME, created date, tags editor, `Used by` list, `Assign`, `Download`, and `Delete` |
| **Assign Asset Modal** | `AssetAssignDialog` | Assigns selected asset to Symbol, Symbol Variant, Standalone Element, Symbol Set Frame/Background, Scene Background, or Canvas Background |
| **Deletion Safety Modal** | `AssetDeleteDialog` | Warns when an asset is in use, lists every affected symbol/element/scene, and safely unbinds references on confirm |

---

## 9. Testing and Verification
- **TypeScript Verification**:
  - Command: `npm run typecheck`
  - Result: `0` errors (`tsc --noEmit` exit code `0`).
- **Automated Unit & Persistence Test Suite**:
  - Command: `npx tsx --test tests/*.test.ts`
  - Result: **94 / 94 tests passing** (`0` failures), including **14 / 14 F10 tests** in `tests/assets.test.ts`:
    1. `decodeArtwork decodes Transparent PNG and detects alpha channel` — `PASS`
    2. `decodeArtwork decodes standard opaque PNG` — `PASS`
    3. `decodeArtwork decodes JPEG and extracts dimensions` — `PASS`
    4. `decodeArtwork decodes WebP with dimensions and alpha` — `PASS`
    5. `decodeArtwork decodes Vector SVG and extracts viewBox dimensions` — `PASS`
    6. `decodeArtwork decodes Animation JSON metadata (Spine/Lottie)` — `PASS`
    7. `decodeArtwork rejects HTML, script tags, or corrupt binary` — `PASS`
    8. `detectAssetFormat identifies formats correctly from AssetRef` — `PASS`
    9. `findAssetUsage detects references in symbols, elements, scenes, canvas and style` — `PASS`
    10. `safeUnbindAsset cleanly unbinds all references without corrupting blueprint integrity` — `PASS`
    11. `assignAsset assigns asset to symbol, element, scene and canvas background` — `PASS`
    12. `F10 Upload Validation (validateAndPrepareUpload): validates file type, file size, and image dimensions across Transparent PNG, JPEG, WebP, Vector SVG, Animation JSON, Audio, and Font (Other)` — `PASS`
    13. `F10 Image History & Element Revisions: elements and symbols point to multiple image revisions with stable asset identity and can restore earlier revisions` — `PASS`
    14. `F10 End-to-End Persistence (asset-service): uploadProjectAsset, getProjectAssets, updateProjectAsset, assignProjectAsset, and deleteProjectAsset persist across reloads and never corrupt GameBlueprint` — `PASS`
- **Live HTTP Verification**:
  - Verified `GET http://127.0.0.1:3000/projects/prj_demo_roman_empire/assets` returns `200 OK` with full Asset Library UI (`Asset Library`, `Asset Details`, `Transparent PNG`, `Vector (SVG)`, `Animation Metadata`, `Search assets`).
  - Verified `GET http://127.0.0.1:3000/api/projects/prj_demo_roman_empire/assets` returns `200 OK` JSON summary of project assets and usage counts.

---

## 10. Known Issues and Limitations
- None within the scope of `F10`. Built-in procedural image editing (crop/trim/rotate/recolor/background removal) and animation timeline authoring belong to their respective upcoming sections (`F11` / `C - Image Editor`).

---

## 11. Requirements Status

| Requirement | Status | Notes |
|---|---|---|
| Asset browser with thumbnail grid, list view, search, type filter, tags, dimensions, usage count, selected state | `PASS` | Implemented in `AssetLibraryApp`, `AssetCard`, and `AssetRow` |
| Asset Types: `Images`, `Transparent PNG`, `JPEG`, `WebP`, `Animation metadata`, `Vector`, `Other` | `PASS` | Implemented in `decode.ts`, `upload-helper.ts`, and `usage.ts` |
| Drag-and-drop upload validating `file type`, `file size`, `image dimensions` | `PASS` | Implemented in `AssetUploadZone`, `validateAndPrepareUpload`, and `decodeArtwork` |
| Asset Details: `preview`, `filename`, `dimensions`, `format`, `created date`, `used by`, `download`, `delete` | `PASS` | Implemented in `AssetDetailsPanel` |
| Usage Tracking: track which elements reference each asset | `PASS` | Implemented in `findAssetUsage` across symbols, variants, elements, frames, backgrounds, scenes, canvas, and history |
| Deletion Safety: warn before deletion if in use, show affected elements, do not silently break references | `PASS` | Implemented in `AssetDeleteDialog` and `safeUnbindAsset` |
| Image History: prepare asset identity so an element can point to multiple image revisions | `PASS` | Implemented via `ElementDef.imageHistory`, `SymbolDef.imageHistory`, `AssetRef.revisions`, `replaceElementArtwork`, and `restoreBlueprintImageRevision` |
| Acceptance: Uploaded assets can be assigned to elements | `PASS` | Verified in `tests/assets.test.ts` and `AssetAssignDialog` |
| Acceptance: Assets survive refresh | `PASS` | Verified via `uploadProjectAsset` + `getProjectAssets` in `tests/assets.test.ts` |
| Acceptance: Deleting an asset never silently corrupts the `GameBlueprint` | `PASS` | Verified via `validateBlueprint` after `safeUnbindAsset` and `deleteProjectAsset` |

---

## 12. Next Steps
- Proceed to the next section requested by the user (`F11` or subsequent frontend/editor task) while maintaining incremental documentation and Google Drive backups.

---

## 13. Backup Information
- **Google Drive Destination**: `Slot Studio Backups/F - Frontend/F10/` (Folder ID: `1ZyUieApdBF6_KqjaA5-Z-ThV4bf9HrN1`)
- **Backup Status**: `SUCCESS`
- **Backup Timestamp**: `2026-10-12T10:15:00Z`
- **Backed-Up Subfolders**:
  - `F10/src`: `1PT4t57tYOGaqV4HvMGrDoWoG1Ho_038E`
  - `F10/src/lib`: `1eL91H1PEL7tacpChVuppky1L0AQzVfrE`
  - `F10/src/lib/blueprint`: `193a0ZX4dJpLX81-CfATMOU4sm0Fbjywf`
  - `F10/src/lib/design`: `1YvxNcpzFHbHimETUyPjX9gYuI7mkvnFM`
  - `F10/src/lib/assets`: `1cLnecNRPTp8XZGTwjzSulqBX8dx4jr5H`
  - `F10/src/components`: `1JJBoiBs0NUpxnh41PYulNvEAxnR1mMfI`
  - `F10/src/components/assets`: `1gn3Qr9xkBFB6OHBvFrWF6gnxbIbZU4qH`
  - `F10/src/server`: `1JAf4pbdhnZMbwyaqyDOKTWQAjTXvFITl`
  - `F10/tests`: `1Y4tzCAftsYS9qLyWkQzN8QG9EyxooY_w`
  - `F10/docs`: `178CR-2oJerGLe7MVEOvEymkmjDMOkkI6`
  - `F10/docs/implementation`: `1YYNem0lEAS8Lh91WW1n7Jx8jMG0ZSnAN`
  - `F10/docs/backups`: `11hqBHQpxVPjGF1UJ9_Jj07KrkAYKkDFx`
- **Uploaded Code & Test Files**:
  - `src/lib/blueprint/types.ts`: `1korRQbS50z3oMLD-K4dLFbH15XqVEFdB` (`14,913` bytes)
  - `src/lib/blueprint/validate.ts`: `1shf2iE_bLhaFh8GI-PTKfhJDtY9o4RZp` (`7,233` bytes)
  - `src/lib/design/model.ts`: `1f-qvdG0iFje9j9SHXcub5PGTw3hZ6lzp` (`13,682` bytes)
  - `src/lib/design/parse.ts`: `1dtDD7-3M2ScRVV9tYRR5fJ4PE8xwsZKA` (`13,754` bytes)
  - `src/lib/design/operations.ts`: `1pdjJWuDbGdnVU6B2CIgr1SfZoc0d2WE2` (`41,316` bytes)
  - `src/lib/assets/usage.ts`: `11DyjeAyFp8Oxnv3hhXDxwIFNzvFeAIuN` (`17,454` bytes)
  - `src/lib/assets/decode.ts`: `1F1_93moUpSyifsazDc8CQkRIiwLbTREL` (`8,822` bytes)
  - `src/lib/assets/upload-helper.ts`: `1mOTfih52CvMvFIVCLlXwX8UuWs55j_9R` (`7,568` bytes)
  - `src/server/asset-service.ts`: `1aw5AVHnYlSKXvp6BfYQHH5-eYEGlLDfk` (`10,660` bytes)
  - `src/components/assets/AssetCard.tsx`: `1H_z1WBBkmkX5gFd9_LsAr0xLtgG20g35` (`6,763` bytes)
  - `src/components/assets/AssetRow.tsx`: `14UUPkwDYCmVfK3RrTQ_FQW5LgjpGpMDh` (`5,376` bytes)
  - `src/components/assets/AssetDetailsPanel.tsx`: `1mc2erXnWVvsvjWcWVsY3E0mBy0GmfjKy` (`11,115` bytes)
  - `src/components/assets/AssetAssignDialog.tsx`: `1sjdbZcFTUOuQ3Wp6U7AKP3AnKyeTXmA0` (`6,818` bytes)
  - `tests/assets.test.ts`: `1hp_jeL27oo973n4A2sUNpYbcR9hHpWlV` (`22,458` bytes)
  - `docs/implementation/F10-asset-management.md`: `1mt1Ju_aCRoPMh5aWpOFepRceRapzvWcO` (`20,675` bytes)
  - `docs/implementation/INDEX.md`: `17SyY-5aeYwlxmSscP4KLLIajOTU9L-UC` (`3,568` bytes)
  - `docs/backups/Backup-Manifest.md`: `1ldb5T_GCIkdZZZnn7fWOlxznk3eyr0J8` (`14,835` bytes)
  - `Slot Studio Backups/Backup Manifest.md` (Root): `1nPfzpYU4k3oZ2jYa6mqmDezVLDhuKXYn` (`14,835` bytes)
