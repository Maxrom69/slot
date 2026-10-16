# F20 — Export System

## 1. Section ID and Name
- **Section ID**: `F20`
- **Section Name**: Export System (`TASK: F20 — EXPORT SYSTEM`)

## 2. Objective and Scope
Build the **Frontend Export Center** for Slot Studio Builder (`SECTION 1`), enabling creators to package, inspect, validate, export, and round-trip import real client-side studio deliverables across four export formats (`Download ZIP`, `PNG Asset Sheet`, `Blueprint JSON`, and `Project JSON`), with configurable ZIP image scaling (`1x`, `2x`), granular animation inclusion filters (`Include video`, `Include WebM when available`, `Include sprite sheets`, `Include GIF`), an interactive PNG Asset Sheet viewer (`Asset Count`, `Image Count`, `zoom`, `pan`, `fit`, `download`), categorized pre-export validation (`Errors`, `Warnings`, `Passed`) that blocks export when critical schema corruption exists, and lossless Blueprint/Project JSON round-trip import.

## 3. Requirements Covered and Explicit Exclusions
### Requirements Covered
- **Truthfulness Boundary**: Explicitly marks exports as client-side Frontend Export Center packages (`exporter.kind = "frontend-export-center"`, `exporter.serverProductionExporterExists = false`) and never claims that a server-side production game exporter exists.
- **4 Export Types (`EXPORT_TYPES`)**:
  1. `Download ZIP` (`zip`)
  2. `PNG Asset Sheet` (`png-asset-sheet`)
  3. `Blueprint JSON` (`blueprint-json`)
  4. `Project JSON` (`project-json`)
- **ZIP Options (`ZipExportOptions`)**:
  - **Image scale**: `1x`, `2x`
  - **Animation options**:
    - `Include video` (`includeVideo`)
    - `Include WebM when available` (`includeWebm`)
    - `Include sprite sheets` (`includeSpriteSheets`)
    - `Include GIF` (`includeGif`)
- **Asset Sheet (`AssetSheetMetadata` & Interactive Viewport)**:
  - Displays `Asset Count` and `Image Count`.
  - Provides interactive `zoom`, `pan`, `fit`, and `download` controls.
  - Generates a spec-compliant binary PNG (`Uint8Array` with `IHDR`, `tEXt`, `IDAT`, `IEND` chunks) at `1x` or `2x` scale.
- **Blueprint Export & Validation Results (`ExportValidationReport`)**:
  - Exports the entire `GameBlueprint` as readable JSON (`JSON.stringify(bp, null, 2)`).
  - Validates before export and displays categorized results:
    - `Errors`
    - `Warnings`
    - `Passed`
  - **Blocks export** (`ExportBlockedError` + disabled UI actions + alert banner) if critical schema corruption exists (`errors.length > 0`).
- **Acceptance**:
  - Downloads contain real binary/JSON data (`application/zip` with verified CRC32 entries, `image/png` with valid `IHDR`/`IDAT`/`IEND` scanlines, and readable UTF-8 `application/json`).
  - Blueprints and Project packages can be exported and imported again (`importBlueprintJson`, `importProjectJson`, `importExportedJson`) without losing any structure.

### Explicit Exclusions
- No server-side production slot engine compiler or fake backend deployment pipeline (`SECTION 2` remains strictly separated).
- No AI generation, LLM APIs, or simulated AI workflows (`SECTION 3` excluded).

## 4. Implementation Summary
1. **Export Domain Model (`src/lib/export/types.ts` & `src/lib/blueprint/types.ts`)**:
   - Defined `StudioExportType`, `ExportImageScale`, `ExportAnimationOptions`, `ZipExportOptions`, `AssetSheetViewportState`, `AssetSheetItem`, `AssetSheetMetadata`, `ExportValidationItem`, `ExportValidationReport`, `ProjectExportMetadata`, `ProjectExportPackage`, `ZipExportEntrySummary`, `ZipExportManifest`, `ZipExportPackageResult`, `PngAssetSheetExportResult`, `JsonExportResult`, and `BlueprintImportResult`.
   - Extended `ExportConfig` in `src/lib/blueprint/types.ts` with optional `activeExportType`, `imageScale`, and `animationOptions` fields so export settings participate in `UPDATE_EXPORT` commands and undo/redo history.
2. **Pure Export, Validation, Binary PNG/ZIP Packaging & Round-Trip Import Engine (`src/lib/export/operations.ts`)**:
   - Implemented `validateBlueprintForExport(candidate)` and `assertBlueprintCanExport(candidate)` to detect critical top-level or relational schema corruption (`errors`), completeness advisories (`warnings`), and verified checks (`passed`), throwing `ExportBlockedError` whenever `errors.length > 0`.
   - Implemented `buildAssetSheetMetadata(bp, scale)`, `generateAssetSheetPngBytes(metadata, bp)`, `generateSingleAssetPngBytes(...)`, `parsePngHeader(bytes)`, and `exportPngAssetSheet(bp, scale)` to generate real RGBA binary PNG files at `1x` and `2x` scale.
   - Implemented `exportProjectZip(bp, zipOptions, projectMeta)` and `readZipArchiveEntries(zipBytes)` to package `blueprint.json`, `project.json`, `asset-sheet.png`, scaled image files in `assets/<1x|2x>/`, filtered animation files in `animations/{video,webm,spritesheets,gif}/`, and `manifest.json` into a binary ZIP archive.
   - Implemented `exportBlueprintJson`, `exportProjectJson`, `importBlueprintJson`, `importProjectJson`, and `importExportedJson` for lossless round-trip serialization and restoration.
3. **Frontend Export Center Workspace (`src/components/studio/ExportWorkspace.tsx` & `src/components/project/ProjectWorkspace.tsx`)**:
   - Built the interactive Frontend Export Center UI with 4 export type cards (`Download ZIP`, `PNG Asset Sheet`, `Blueprint JSON`, `Project JSON`), `1x`/`2x` image scale selector, 4 animation option toggles, interactive PNG Asset Sheet viewer (`Asset Count`, `Image Count`, `zoom`, `pan`, `fit`, `download`), categorized Validation Results (`Errors`, `Warnings`, `Passed`) with critical schema corruption blocking, and an interactive Blueprint/Project JSON round-trip import drawer.

## 5. Files Created, Modified, or Deleted
### Files Created
- `src/lib/export/types.ts`
- `src/lib/export/operations.ts`
- `src/lib/export/index.ts`
- `tests/export-system.test.ts`
- `docs/implementation/F20-export-system.md`

### Files Modified
- `src/lib/blueprint/types.ts`
- `src/components/studio/ExportWorkspace.tsx`
- `src/components/project/ProjectWorkspace.tsx`
- `docs/implementation/INDEX.md`
- `docs/backups/Backup-Manifest.md`

### Files Deleted
- None (`0` files deleted).

## 6. Key Architectural Decisions and Dependencies
- **Zero External Binary Dependencies**: Uses deterministic, dependency-free Zlib store-block + Adler-32 + CRC32 RGBA PNG encoding (`generateAssetSheetPngBytes`, `generateSingleAssetPngBytes`) and store-mode ZIP encoding (`buildZip` / `readZipArchiveEntries`) so real binary `.png` and `.zip` files are generated identically in browser and Node environments.
- **Explicit Truthfulness Metadata**: Every `ProjectExportPackage` and `ZipExportManifest` embeds `exporter: { kind: "frontend-export-center", serverProductionExporterExists: false }`.

## 7. Relevant Components, Interfaces, Schemas, Stores, and APIs
- **Types (`src/lib/export/types.ts`)**: `EXPORT_TYPES`, `ZipExportOptions`, `AssetSheetMetadata`, `ExportValidationReport`, `ProjectExportPackage`, `ZipExportManifest`, `BlueprintImportResult`.
- **Operations (`src/lib/export/operations.ts`)**: `validateBlueprintForExport`, `assertBlueprintCanExport`, `buildAssetSheetMetadata`, `exportPngAssetSheet`, `exportBlueprintJson`, `exportProjectJson`, `exportProjectZip`, `readZipArchiveEntries`, `importBlueprintJson`, `importProjectJson`, `importExportedJson`, `zoomAssetSheetViewport`, `panAssetSheetViewport`, `fitAssetSheetViewport`.
- **UI Component (`src/components/studio/ExportWorkspace.tsx`)**: `ExportWorkspace` mounted at `/projects/[id]/export` and `/project/[projectId]/export`.

## 8. Data Flow and Persistence Behavior
- Toggling export types, `1x`/`2x` image scale, or animation options dispatches `UPDATE_EXPORT` through `useStudioEditor`, updating `blueprint.exportConfig` with undo/redo support.
- Importing a `Blueprint JSON` or `Project JSON` validates the JSON via `importExportedJson`; if valid, it updates the active `StudioEditorProvider` state and optionally persists to the database via `workspaceApi.saveProject(id, restoredBp)`.

## 9. Integration Points with Other Sections
- **F01/F03/F04 (`GameBlueprint` & Validation)**: Extends `validateBlueprint` into `validateBlueprintForExport` with `Errors`, `Warnings`, and `Passed` categorization.
- **F10 (`Asset Management`) & F18 (`Animation System`)**: Packages project assets at `1x`/`2x` scale and filters F18 video, WebM, sprite-sheet, and GIF animations according to `ZipExportOptions`.
- **F19 (`Scenes and Layout Composition`)**: Includes scene `composedImages` in the PNG Asset Sheet and preserves all 1–3 scenes and their layout metadata during JSON export/import round-trips.

## 10. User-Facing Controls, Shortcuts, and Visual Behaviors
- **Export Type Selector**: 4 interactive cards (`1. Download ZIP`, `2. PNG Asset Sheet`, `3. Blueprint JSON`, `4. Project JSON`).
- **ZIP Options Panel**: `1x` / `2x` image scale toggle buttons and `Include video`, `Include WebM when available`, `Include sprite sheets`, and `Include GIF` switches.
- **PNG Asset Sheet Panel**: Displays `Asset Count` and `Image Count` badges, `- Zoom`, `+ Zoom`, `← Pan`, `Pan →`, drag-to-pan canvas, `Fit`, and `Download`.
- **Validation Results Panel**: Summary cards and filter tabs for `Errors`, `Warnings`, and `Passed`, plus a prominent red alert banner blocking all exports when critical schema corruption exists.

## 11. Tests, Typechecks, and Build Verification Performed and Actual Results
- `npm run typecheck` (`tsc --noEmit`): **PASS (`0` errors)**.
- `npx tsx --test tests/export-system.test.ts`: **PASS (`7/7` subtests passing)**.
- `npx tsx --test tests/*.test.ts`: **PASS (`151/151` tests passing across 20 test suites, `0` failures)**.

## 12. Requirement-by-Requirement Status Table
| Requirement | Status | Verification Evidence |
| --- | --- | --- |
| Build frontend export center; do not claim server-side production exporter exists | `PASS` | `ExportWorkspace.tsx` truthfulness banner + `exporter.serverProductionExporterExists === false` verified in `tests/export-system.test.ts` #1 |
| Export Types: 1. Download ZIP, 2. PNG Asset Sheet, 3. Blueprint JSON, 4. Project JSON | `PASS` | `EXPORT_TYPES` & 4 export handlers verified in `tests/export-system.test.ts` #1–#6 |
| ZIP Options — Image scale: `1x`, `2x` | `PASS` | Verified in `tests/export-system.test.ts` #2 (`parsePngHeader` confirms exact 2× dimensions in `2x` ZIP) |
| ZIP Options — Animation options: `Include video`, `Include WebM when available`, `Include sprite sheets`, `Include GIF` | `PASS` | Verified in `tests/export-system.test.ts` #3 |
| Asset Sheet — Display `Asset Count` and `Image Count` | `PASS` | Verified in `tests/export-system.test.ts` #4 and `ExportWorkspace.tsx` (`data-testid="asset-sheet-counts"`) |
| Asset Sheet — Provide `zoom`, `pan`, `fit`, `download` | `PASS` | Verified in `tests/export-system.test.ts` #4 and `ExportWorkspace.tsx` |
| Blueprint Export — Export entire `GameBlueprint` as readable JSON and validate before export | `PASS` | Verified in `tests/export-system.test.ts` #5 & #6 |
| Display Validation Results: `Errors`, `Warnings`, `Passed` | `PASS` | Verified in `tests/export-system.test.ts` #5 and `ExportWorkspace.tsx` |
| BLOCK export if critical schema corruption exists | `PASS` | `ExportBlockedError` thrown on all 4 export functions when `errors.length > 0`; verified in `tests/export-system.test.ts` #5 |
| Acceptance: Downloads contain real data; Blueprint can be exported and imported again without losing structure | `PASS` | Verified in `tests/export-system.test.ts` #2, #4, #6, and #7 |

## 13. Known Issues and Limitations
- None. All `F20` requirements and acceptance criteria are implemented and verified.

## 14. Remaining Work or Recommended Next Steps
- Proceed to the next section in the specification (`F21` or next designated Frontend/Backend/Image Editor section).

## 15. Google Drive Backup Location and Verification Status
- **Google Drive Backup Folder**: `Slot Studio Backups/F - Frontend/F20/` (`1utZRmCg00DAiIpZL1sH0lkPwbLZnWNzw`)
- **Verification Status**: `VERIFIED` (recorded in `docs/backups/Backup-Manifest.md` and synchronized with root `Slot Studio Backups/Backup Manifest.md`).

## 16. Last Update Date
- `2026-10-12`
