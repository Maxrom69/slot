# F09 — Symbol Editor

## 1. Section ID and Name
- **Section ID**: `F09`
- **Section Name**: Symbol Editor
- **Layer**: `SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`
- **Status**: `COMPLETE`

---

## 2. Objective and Scope
Create the dedicated manual Symbol Editor workspace (`/projects/[id]/symbols/[symbolId]`) for inspecting, configuring, and persisting individual slot symbols within a project's `GameBlueprint`.

### Scope
- **Dedicated Workspace**:
  - **Image Preview**: Interactive visual artwork preview supporting checkerboard, dark, and light backdrop modes, aspect ratio and resolution display, asset badge, and non-destructive manual artwork actions (`Upload Replacement`, `Choose Existing Asset`, `Restore Previous Asset`, `Clear Artwork`, and optional revision note input).
  - **Symbol Metadata**: Editable `Name`, stable `ID` (`data-testid="symbol-id-display"`), `Description`, `Type` (`low`, `high`, `wild`, `scatter`, `bonus`), `Tier` (`1`–`5`), and `Symbol Family` (`low`, `mid`, `high`, `special`, `custom`, plus custom string families) with quick family preset buttons.
  - **Symbol Configuration (Role Flags)**: Configuration-only toggles for `Wild`, `Scatter`, `Bonus`, and `Regular` (`!isWild && !isScatter && !isBonus`) with explicit helper text stating that these flags store blueprint configuration only and do not execute runtime reel/math evaluation in the frontend builder.
  - **Variant Management**: Add, rename, assign/change/clear artwork (via upload or asset library picker), and delete symbol variants (`Normal`, `Gold`, `Expanded`, `Sticky`, etc.).
  - **Extras (Extensible Extra Metadata)**: Quick preset chips (`Split`, `Expansion`, `Hover`, `Animation`, `Custom Extra`) alongside full key/value/type (`string`, `number`, `boolean`, `json`) CRUD and an explicit empty state (`data-testid="extras-empty-state"`) when no extras exist.
  - **Math Metadata**: Paytable multipliers by match count (`3x`, `4x`, `5x`, plus dynamic `2x`/`6x`+ entries), add/remove match count rows, `Reel Weight`, and read-only parent `SymbolSet` membership summary.
  - **Image History**: Multi-version non-destructive revision timeline displaying each revision's `id`, `asset` reference (`kind`, `value`, `assetId`, `mimeType`), `createdAt` timestamp, `source` (`upload`, `library`, `seed`, `restore`, `manual`), and `notes`, with one-click `Restore` for any historical revision and top-level `Restore Previous Asset`.
- **Non-Goals / Guardrails**:
  - Do **not** fabricate AI generation, fake prompts, or simulated AI artwork workflows.
  - Do **not** implement backend slot-game spin/math execution in the frontend builder; role flags and math fields are configuration-only metadata persisted in `GameBlueprint`.

---

## 3. Implementation Summary
1. **Domain & Element System Extensions (`src/lib/design/types.ts`, `src/lib/elements/types.ts`, `src/lib/elements/blueprint-adapter.ts`, `src/lib/elements/service.ts`)**:
   - Extended `SymbolPatch` in `src/lib/design/types.ts` with `imageSource?: ImageRevisionSource`, `payouts?: Record<number, number>`, and `reelWeight?: number` so symbol metadata, math metadata, and artwork revision sources can be updated through a unified typed patch contract.
   - Extended `Symbol` in `src/lib/elements/types.ts` with `isBonus: boolean`, `family?: string`, and `imageHistory?: ImageRevision[]`.
   - Updated `src/lib/elements/blueprint-adapter.ts` and `src/lib/elements/service.ts` so `isBonus`, `family`, and `imageHistory` round-trip losslessly between `DesignDoc`, `ElementLibraryState`, and `GameBlueprint.elements.symbols` / `GameBlueprint.symbolSets`.
   - Fixed `parseDesignDoc` in `src/lib/design/parse.ts` so `symbol.family` is preserved when parsing persisted `DesignDoc` JSON from the database.
2. **Non-Destructive Artwork & Revision History Operations (`src/lib/design/operations.ts`)**:
   - Added `sameAssetRef(a, b)` for structural comparison of `AssetRef` records.
   - Enhanced `withImageChange(current, nextImage, history, notes, source)` so that whenever a symbol's image changes or is cleared, the outgoing non-none `AssetRef` is guaranteed to be recorded in `imageHistory` before appending the new revision, ensuring artwork replacement or clearing never destroys previous asset references.
   - Added `findPreviousImageRevision(current, history)` and `restorePreviousImageRevision(doc, target, notes?)` to locate and restore the most recent revision with a valid non-none `AssetRef` distinct from the active image (or the last non-none revision when current artwork is cleared).
   - Added convenience operations `replaceSymbolArtwork(doc, symbolId, image, options)` and `clearSymbolArtwork(doc, symbolId, notes?)`, and ensured `setElementImage` / `setSymbolImage` preserve existing `doc.assets` entries rather than deleting prior uploaded assets.
3. **Dedicated Manual Symbol Editor UI (`src/components/design/SymbolEditor.tsx`, `src/components/design/ElementFields.tsx`, `src/components/design/CommitInput.tsx`)**:
   - Rebuilt `src/components/design/SymbolEditor.tsx` into a comprehensive, two-column creative-tool workspace with:
     - Top bar with breadcrumb navigation back to the parent SymbolSet or Design View, dirty-state badge, Undo (`Ctrl/Cmd+Z`), Redo (`Ctrl/Cmd+Shift+Z` / `Ctrl/Cmd+Y`), `Save Symbol` (`Ctrl/Cmd+S`), and `Delete`.
     - **Left column**:
       - **Image Preview Card** (`data-testid="symbol-preview-frame"`) with checkerboard/dark/light backdrop toggles, resolution & source badges, revision note input (`data-testid="artwork-revision-note-input"`), and 4 explicit manual artwork buttons (`Upload Replacement`, `Choose Existing Asset`, `Restore Previous Asset`, `Clear Artwork`), plus an explicit notice that artwork management is 100% manual (no AI generation).
       - **Asset Library Picker Modal** (`data-testid="asset-library-picker"`) listing all uploaded project assets in `doc.assets` plus reusable artwork referenced across project symbols, variants, and elements, with search filtering and one-click selection.
       - **Image History Panel** (`data-testid="image-history-panel"`) listing all revisions in reverse chronological order with `id`, `source` badge, `createdAt` timestamp, `asset` reference summary (`assetId`/`value` + `mimeType`), `notes`, `Active` status badge, and per-revision `Restore` action (`data-testid="restore-revision-<id>"`).
     - **Right column**:
       - **Symbol Metadata Section**: `Name`, read-only `ID`, `Description` (`textarea`), `Type`, `Tier`, and `Symbol Family` (`CommitInput` + quick preset pills `low`, `mid`, `high`, `special`, `custom`).
       - **Symbol Configuration (Role Flags) Section**: 4 interactive role cards (`Regular`, `Wild`, `Scatter`, `Bonus`) that synchronize with `isWild`, `isScatter`, `isBonus`, and `symbolType`, paired with a clear configuration-only notice.
       - **Math Metadata Section**: Editable payout multipliers (`3x`, `4x`, `5x`, plus dynamic `2x`/`6x`+ rows via `+ Add Match Count`), `Reel Weight` input, and parent `SymbolSet` membership indicator.
       - **Variant Management Section** (`VariantsEditor`): Add variant by name, inline rename (`CommitInput`), per-variant artwork preview, upload/pick/clear variant image, and delete variant, with an explicit empty state (`data-testid="variants-empty-state"`).
       - **Extras (Extensible Metadata) Section** (`ExtrasEditor`): Quick preset chips (`+ Split`, `+ Expansion`, `+ Hover`, `+ Animation`, `+ Custom Extra`), typed key/value/valueType (`string`, `number`, `boolean`, `json`) editor rows, add custom key/value form, and an explicit empty state (`data-testid="extras-empty-state"`).

---

## 4. Files Created, Modified, or Deleted

| File Path | Action | Description |
| --- | --- | --- |
| `src/components/design/SymbolEditor.tsx` | Modified | Implemented full F09 manual Symbol Editor workspace with Image Preview, Artwork actions, Asset Library Picker, Symbol Metadata, Role Flags, Math Metadata, Variants, Extras, and Image History |
| `src/components/design/ElementFields.tsx` | Modified | Added `EXTRA_PRESETS` (`Split`, `Expansion`, `Hover`, `Animation`, `Custom Extra`), `valueType` selector (`string`, `number`, `boolean`, `json`), explicit empty states, and per-variant asset library picker support |
| `src/components/design/CommitInput.tsx` | Modified | Added optional `placeholder` prop to `CommitInput` |
| `src/lib/design/types.ts` | Modified | Extended `SymbolPatch` with `imageSource`, `payouts`, and `reelWeight` |
| `src/lib/design/operations.ts` | Modified | Added `sameAssetRef`, `findPreviousImageRevision`, `restorePreviousImageRevision`, `replaceSymbolArtwork`, `clearSymbolArtwork`, and non-destructive `withImageChange` / `updateSymbol` / `restoreImageRevision` |
| `src/lib/design/parse.ts` | Modified | Preserved `symbol.family` in `parseDesignDoc` when loading saved `DesignDoc` JSON |
| `src/lib/elements/types.ts` | Modified | Added `isBonus`, `family`, and `imageHistory` to `Symbol` |
| `src/lib/elements/service.ts` | Modified | Updated `updateSymbol` and `createSymbol` in `elements/service.ts` to support `isBonus`, `family`, `payouts`, `reelWeight`, `imageSource`, and non-destructive `imageHistory` |
| `src/lib/elements/blueprint-adapter.ts` | Modified | Preserved `isBonus`, `family`, and `imageHistory` across `GameBlueprint` <-> `ElementLibraryState` conversions |
| `tests/symbol-editor.test.ts` | Created | Added 5 comprehensive automated tests covering all F09 Symbol Editor requirements and persistence |
| `docs/implementation/F09-symbol-editor.md` | Created | 13-section implementation and backup report for `F09` |
| `docs/implementation/INDEX.md` | Modified | Registered `F09` as `COMPLETE` and updated cumulative test counts (`91/91`) |
| `docs/backups/Backup-Manifest.md` | Modified | Recorded verified Google Drive file IDs and metadata for `F09` |

*(0 files deleted.)*

---

## 5. Architecture and Dependencies
- **Pure State Transitions (`src/lib/design/operations.ts`)**: All symbol edits (`updateSymbol`, `replaceSymbolArtwork`, `clearSymbolArtwork`, `restoreImageRevision`, `restorePreviousImageRevision`, `addSymbolVariant`, `updateSymbolVariant`, `deleteSymbolVariant`, `upsertSymbolExtra`, `deleteSymbolExtra`) are pure, immutable `DesignDoc -> DesignDoc` functions wrapped by `useUndoHistory` in `SymbolEditor.tsx`.
- **Single Source of Truth (`GameBlueprint`)**: Saving in `SymbolEditor` invokes `saveDesign(projectId, doc)`, which validates the `DesignDoc`, updates `projects.design_doc` and `projects.blueprint` (via `syncDesignToBlueprint`), and persists to PostgreSQL / `.local/slot-studio-db.json`.
- **Asset Storage Integration**: Uploading artwork invokes the `uploadAsset` server action (`src/components/design/actions.ts` -> `src/server/asset-service.ts`), storing binary bytes and metadata in `project_assets` and registering an `AssetRecord` in `doc.assets` without deleting any prior assets.
- **No Unnecessary Dependencies**: Built entirely with existing React 19, Next.js 15 App Router, and TypeScript primitives.

---

## 6. Data Flow and Persistence
1. **Load**: `/projects/[id]/symbols/[symbolId]/page.tsx` loads the project via `getProject(id)`, parses `DesignDoc` (`parseDesignDoc`), and passes `initialDoc` and `symbolId` to `<SymbolEditor />`.
2. **Edit & Undo/Redo**: Every UI control dispatches a pure operation through `apply(fn)`, pushing the prior `DesignDoc` onto the undo stack and marking `dirty = true`.
3. **Artwork Revision Tracking**:
   - When `replaceSymbolArtwork` or `updateSymbol({ image })` runs, `withImageChange` ensures the outgoing image is preserved in `symbol.imageHistory` before appending the new `ImageRevision` (`{ id, asset, createdAt, source, notes }`).
   - When `clearSymbolArtwork` runs, the outgoing image remains in `symbol.imageHistory` while `symbol.image` becomes `{ kind: "none", value: "" }`.
   - When `restoreImageRevision` or `restorePreviousImageRevision` runs, the target revision's `AssetRef` becomes active and a new revision with `source: "restore"` is recorded so the audit trail remains append-only and non-destructive.
4. **Save & Round-Trip**: Clicking `Save Symbol` (or pressing `Ctrl/Cmd+S`) calls `saveDesign(projectId, doc)`, persisting both `DesignDoc` and the synchronized `GameBlueprint`. Reloading the route or converting via `blueprintToElementLibrary` / `applyElementLibraryToBlueprint` restores all metadata, role flags, variants, extras, math metadata, and `imageHistory`.

---

## 7. Integration Points
- **Route**: `/projects/[id]/symbols/[symbolId]` (`src/app/projects/[id]/symbols/[symbolId]/page.tsx`).
- **Symbol Sets (`F08`)**: Clicking `Edit Symbol →` in `SetEditor` (`/projects/[id]/sets/[setId]`) or in the Design View Inspector (`ElementDetail.tsx`) navigates directly to `/projects/[id]/symbols/[symbolId]`. The breadcrumb in `SymbolEditor` links directly back to `/projects/[id]/sets/[parentSet.id]` when the symbol belongs to a `SymbolSet`.
- **Asset Service (`src/server/asset-service.ts`)**: Used via `uploadAsset` server action for real binary PNG/WebP/SVG/JPEG uploads and `/api/projects/[id]/assets/[assetId]` for serving stored assets.
- **Element System (`F07`)**: `src/lib/elements/service.ts` and `src/lib/elements/blueprint-adapter.ts` synchronize `Symbol` definitions (`isBonus`, `family`, `imageHistory`, `variants`, `extras`, `payouts`, `reelWeight`) with `GameBlueprint`.

---

## 8. Controls and Behaviors

| Control / Area | Test ID / Selector | Behavior |
| --- | --- | --- |
| Back Navigation | `Link` to `/projects/[id]/sets/[setId]` or `/projects/[id]/design` | Returns to parent SymbolSet editor or Design View |
| Undo / Redo | `symbol-undo-btn` / `symbol-redo-btn` (`Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`) | Reverts or reapplies any symbol metadata, artwork, variant, extra, or math change |
| Save Symbol | `save-symbol-btn` (`Ctrl/Cmd+S`) | Persists `DesignDoc` and `GameBlueprint` via `saveDesign` |
| Delete Symbol | `delete-symbol-btn` | Deletes the symbol, persists, and navigates back |
| Backdrop Selector | `preview-backdrop-checker`, `preview-backdrop-dark`, `preview-backdrop-light` | Switches artwork preview canvas background |
| Revision Note Input | `artwork-revision-note-input` | Optional note attached to the next upload, library selection, or restore revision |
| Upload Replacement | `upload-replacement-btn` + `symbol-file-input` | Uploads an image file via `uploadAsset`, updates `symbol.image`, and appends an `"upload"` revision |
| Choose Existing Asset | `choose-existing-asset-btn` -> `asset-library-picker` | Opens modal of project & symbol assets; picking an asset updates `symbol.image` and appends a `"library"` revision |
| Restore Previous Asset | `restore-previous-asset-btn` | Restores the most recent distinct non-none `AssetRef` from `imageHistory` and appends a `"restore"` revision |
| Clear Artwork | `clear-artwork-btn` | Sets active `symbol.image` to `NONE_ASSET` while keeping all prior revisions in `imageHistory` |
| Image History List | `image-history-panel`, `image-revision-<id>`, `restore-revision-<id>` | Displays `id`, `source`, `createdAt`, `asset`, and `notes` for every revision with one-click `Restore` |
| Symbol Metadata | `symbol-name-input`, `symbol-id-display`, `symbol-description-input`, `symbol-type-select`, `symbol-tier-select`, `symbol-family-input`, `family-preset-*` | Edits `name`, `description`, `symbolType`, `tier`, and `family` |
| Role Flags | `role-flag-regular`, `role-flag-wild`, `role-flag-scatter`, `role-flag-bonus` | Toggles configuration-only role flags (`isWild`, `isScatter`, `isBonus`, `Regular`) |
| Math Metadata | `payout-input-<count>`, `add-payout-count-btn`, `reel-weight-input` | Edits payout multipliers by match count and reel weight |
| Variant Management | `variants-editor`, `new-variant-name-input`, `add-variant-btn` | Creates, renames, assigns/picks/clears variant artwork, and deletes variants |
| Extras Editor | `extras-editor`, `extra-preset-*`, `new-extra-key-input`, `new-extra-value-input`, `add-extra-btn` | Adds preset or custom extras (`string`, `number`, `boolean`, `json`), edits values/types, and deletes extras |

---

## 9. Testing and Verification

### Automated Test Suite (`tests/symbol-editor.test.ts`)
Created `tests/symbol-editor.test.ts` with 5 comprehensive tests:
1. **`F09.1 — Symbol metadata, role flags, family, variants, extras, and math metadata edit & persist`**: Verifies editing `name`, `description`, `symbolType`, `tier`, `family`, role flags (`Wild`, `Scatter`, `Bonus`, `Regular`), variants (`Normal`, `Gold`, `Expanded`), extras (`Split`, `Expansion`, `Hover`, `Animation`, `Custom Extra`), and math metadata (`payouts`, `reelWeight`), plus full round-trip persistence through `saveDesign` -> `getProject` -> `parseDesignDoc` and `blueprintToElementLibrary`.
2. **`F09.2 — Artwork replacement via real upload, choose existing asset, clear artwork, and imageHistory tracking`**: Uploads two real PNG assets via `uploadAsset`, replaces symbol artwork, selects an existing library asset, clears artwork, and verifies that `doc.assets` retains all uploaded assets and `imageHistory` records every revision (`id`, `asset`, `createdAt`, `source`, `notes`) without destroying prior references.
3. **`F09.3 — Restore previous asset & restore specific historical revision return symbol to prior state`**: Verifies `restorePreviousImageRevision` from a cleared state and from an active state, plus `restoreImageRevision` for a specific historical revision ID, confirming full persistence via `saveDesign`.
4. **`F09.4 — Variant artwork management preserves variant assets and supports clearing/reassigning`**: Verifies assigning, replacing, and clearing artwork on individual symbol variants while keeping `doc.assets` intact.
5. **`F09.5 — Element library service & blueprint adapter preserve F09 symbol fields and imageHistory`**: Verifies `updateElementSymbol` in `src/lib/elements/service.ts` and `applyElementLibraryToBlueprint` / `blueprintToElementLibrary` round-trip fidelity for `isBonus`, `family`, `payouts`, `reelWeight`, `variants`, `extras`, and `imageHistory`.

### Commands Executed & Results
- `npm run typecheck` -> **PASS** (`0` TypeScript errors)
- `npx tsx --test tests/*.test.ts` -> **PASS** (`91/91` tests passing across all 10 test suites, including `5/5` in `tests/symbol-editor.test.ts`)
- Live HTTP smoke check on `http://127.0.0.1:3000/projects/prj_demo_roman_empire/symbols/sym-low-a` -> **PASS** (`200 OK`, all F09 sections and test IDs rendered cleanly)

---

## 10. Known Issues and Limitations
- None (`0` known issues or open gaps). Role flags (`Wild`, `Scatter`, `Bonus`, `Regular`) and math metadata (`payouts`, `reelWeight`) are intentionally scoped to frontend blueprint configuration in accordance with Section 1 boundaries.

---

## 11. Requirements Status

| Requirement | Status | Evidence |
| --- | --- | --- |
| Dedicated workspace with Image Preview | `PASS` | `SymbolEditor.tsx` (`data-testid="symbol-preview-frame"`, backdrop toggles, asset badges) |
| Symbol metadata (`Name`, `ID`, `Description`, `Type`, `Tier`, `Symbol Family`) | `PASS` | `SymbolEditor.tsx` + `F09.1` in `tests/symbol-editor.test.ts` |
| Symbol configuration (`Wild`, `Scatter`, `Bonus`, `Regular` configuration flags only) | `PASS` | `SymbolEditor.tsx` (`role-flag-*`) + `F09.1` in `tests/symbol-editor.test.ts` |
| Variant management (add, rename, assign/pick/clear image, delete) | `PASS` | `ElementFields.tsx` (`VariantsEditor`) + `F09.1` & `F09.4` in `tests/symbol-editor.test.ts` |
| Extensible Extras (`Split`, `Expansion`, `Hover`, `Animation`, `Custom Extra`, empty states) | `PASS` | `ElementFields.tsx` (`ExtrasEditor`, `EXTRA_PRESETS`, `extras-empty-state`) + `F09.1` |
| Math metadata (payouts by match count, reel weight) | `PASS` | `SymbolEditor.tsx` (`payout-input-*`, `reel-weight-input`) + `F09.1` |
| Artwork actions (`upload replacement`, `choose existing asset`, `clear artwork`, `restore previous asset`, no fake AI) | `PASS` | `SymbolEditor.tsx` + `operations.ts` + `F09.2` & `F09.3` in `tests/symbol-editor.test.ts` |
| Image History (`id`, `asset` ref, `createdAt`, `source`, `notes`, view & restore) | `PASS` | `SymbolEditor.tsx` (`image-history-panel`) + `F09.2`, `F09.3`, `F09.5` |
| Symbol changes persist & artwork replacement never destroys previous references | `PASS` | `saveDesign` + `uploadAsset` verified in `F09.1`–`F09.5` (`tests/symbol-editor.test.ts`) |

---

## 12. Next Steps
- Proceed to the next scheduled Frontend section (`F10`) when requested by the user, reusing the `AssetRef`, `ImageRevision`, and `ElementFields` primitives established in `F07`–`F09`.

---

## 13. Backup Information
- **Google Drive Destination Folder**: `Slot Studio Backups/F - Frontend/F09/` (Folder ID: `1-utIlFbAhV51djdPZjb0Y478P_I_A0GT`)
- **Backup Status**: `SUCCESS` (`VERIFIED`)
- **Backup Timestamp (UTC)**: `2026-10-12T09:55:00Z`
- **Backed-Up Files & Google Drive IDs**:
  | Relative Path | Action | Google Drive File ID | Parent Folder ID | Size (Bytes) |
  | --- | --- | --- | --- | --- |
  | `src/components/design/SymbolEditor.tsx` | Modified | `1Yx11qflgf_U4Y46do5tbs7bpQR79Po_Z` | `1gl5eZVwFuOGpU6thHUQ7-X3xF_9wcGyD` | `41,048` |
  | `src/components/design/ElementFields.tsx` | Modified | `1ENX0KfdpCfJKe8mh-CuGMOvAANDLDIf5` | `1gl5eZVwFuOGpU6thHUQ7-X3xF_9wcGyD` | `16,557` |
  | `src/components/design/CommitInput.tsx` | Modified | `1Ozl9vbSe4EOMxr9VWQWx0u_js2D2L3su` | `1gl5eZVwFuOGpU6thHUQ7-X3xF_9wcGyD` | `2,247` |
  | `src/lib/design/types.ts` | Modified | `1FvyqQ0KGzEIcyktOv_2oAwvcPLXqwP-y` | `1tdLBVZlDYfBwF-UOyJE2fNw3GXBivA3V` | `3,353` |
  | `src/lib/design/operations.ts` | Modified | `1gbFTs9qpKbWk2MNiECLajtjGXGrxLWob` | `1tdLBVZlDYfBwF-UOyJE2fNw3GXBivA3V` | `36,436` |
  | `src/lib/design/parse.ts` | Modified | `1E8VLmvxVzs_CwRxvIxfWaCa7rJ2sdFFA` | `1tdLBVZlDYfBwF-UOyJE2fNw3GXBivA3V` | `12,800` |
  | `src/lib/elements/types.ts` | Modified | `1QBAbUJd1SAq99Ar1CEaMLTOzT_UDt8Tz` | `10nu05UOiIwniX1wr5PCqq3Da17ZHP85D` | `4,763` |
  | `src/lib/elements/service.ts` | Modified | `1nbZvb8EAIbXD6WjAdInOrDH_KJh6RzF7` | `10nu05UOiIwniX1wr5PCqq3Da17ZHP85D` | `23,557` |
  | `src/lib/elements/blueprint-adapter.ts` | Modified | `1Rm8euBdtfGTEdg8vPI-TO91HIDpJBrJO` | `10nu05UOiIwniX1wr5PCqq3Da17ZHP85D` | `11,069` |
  | `tests/symbol-editor.test.ts` | Created | `1vLgb7GEEeNQCgEcYslrSTvetkRTRNtMt` | `18GetUo8m--BR_2PtgygSpIRnRoipS97Y` | `17,717` |
  | `docs/implementation/F09-symbol-editor.md` | Created | `1HtCe-rmz44Qc9WKmFLj54XWrWIhL5fpI` | `1sDCRkVRGJ2f2qd1vEQePWjqU52KvfKHe` | `22,925` |
  | `docs/implementation/INDEX.md` | Modified | `1MSBARkXnt2DHiVmo08Ranx9UQiUvcGe0` | `1sDCRkVRGJ2f2qd1vEQePWjqU52KvfKHe` | `3,281` |
  | `docs/backups/Backup-Manifest.md` | Modified | `1-bJMuz3uTiqp_oCGuqZmr7KgPdWvOw5j` | `1tnIVgL4vkb0uQBf3mnsR9sTYPkqzXvff` | `11,508` |
