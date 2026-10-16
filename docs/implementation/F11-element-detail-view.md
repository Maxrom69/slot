# F11 — Element Detail View

## 1. Section ID and Name
- **Section ID**: `F11`
- **Section Name**: `ELEMENT DETAIL VIEW`
- **Phase**: `SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`

---

## 2. Objective and Scope
Build the detailed configuration workspace for an individual element (`/projects/[id]/elements/[elementId]` and `/projects/[id]/design?element=<elementId>`), providing:
- **Layout**:
  - **Header**: `Back`, `Element name`, `Save`, `Dirty indicator`
  - **Main**: `Large artwork preview`
  - **Right**: `Configuration panel`
- **Sections** (`Right` configuration panel):
  1. `Identity`
  2. `Artwork`
  3. `Style`
  4. `Variants`
  5. `Extras`
  6. `Animation`
  7. `History`
  8. `Usage`
- **Actions**:
  - `Save`
  - `Duplicate`
  - `Delete`
  - `Replace Image`
  - `Download`
- **Edit Image**:
  - Provide an entry point for the manual Element Editor (`/projects/[id]/elements/[elementId]/editor`).
  - Do not implement AI image editing.
  - AI edit action is explicitly disabled (`disabled={true}`) and labeled as future functionality (`AI Edit Image · Future Functionality`).
- **Usage**:
  - Display where the element is used across all 6 dependent studio domains:
    - `Symbol Sets`
    - `Scenes`
    - `Layers`
    - `Reels`
    - `Paytable`
    - `Animations`
- **Acceptance**:
  - Editing an element updates all dependent views (`Design View`, `Symbol Sets`, `Scenes / Canvas`, `Layers`, `Reels`, `Paytable`, and `Animations`).

---

## 3. Implementation Summary
1. **Extended Blueprint & Design Domain Model for Full Element Detail Configuration (`src/lib/blueprint/types.ts`, `src/lib/blueprint/validate.ts`, `src/lib/design/{types,model,parse}.ts`, `src/lib/elements/{types,blueprint-adapter}.ts`)**:
   - Added `ElementStyleConfig` (`styleGuide`, `tintColor`, `opacity`, `blendMode`) and `ElementAnimationConfig` (`preset`, `trigger`, `durationMs`, `easing`, `loop`) to `src/lib/blueprint/types.ts`.
   - Extended `ElementDef` with optional `style`, `variants` (`SymbolVariant[]`), `extras` (`Record<string, number | string | boolean>`), and `animation` (`ElementAnimationConfig`).
   - Updated `validateBlueprint` (`src/lib/blueprint/validate.ts`) so element variant asset references (`el.variants`) are checked against `bp.assets`, element variant IDs are verified globally unique across symbols and elements, and `bp.animations` can target `elementIds` in addition to `layerIds` and `symbolIds`.
   - Updated `finalizeDoc` (`src/lib/design/model.ts`) and `parseDesignDoc` (`src/lib/design/parse.ts`) to sanitize, preserve, and protect asset references for element `style`, `variants`, `extras`, `animation`, `imageHistory`, and `animations`.
   - Updated `StandaloneElement` (`src/lib/elements/types.ts`) and `libraryFromBlueprint` / `applyLibraryToBlueprint` (`src/lib/elements/blueprint-adapter.ts`) so all `F11` element properties round-trip losslessly.
2. **Implemented Element Artwork, Variant, Animation Cue, and Dependent View Synchronization Operations (`src/lib/design/operations.ts`, `src/lib/design/migrate.ts`, `src/components/canvas/SceneObjectView.tsx`)**:
   - Added `clearElementArtwork`, `annotateElementImageRevision`, `addElementVariant`, `editElementVariant`, `duplicateElementVariant`, `removeElementVariant`, `addElementAnimationCue`, `updateElementAnimationCue`, and `removeElementAnimationCue` in `src/lib/design/operations.ts`.
   - Enhanced `updateElement` and `duplicateElement` to support `style`, `variants`, `extras`, `animation`, and image revision tracking.
   - Enhanced `applyDesign` (`src/lib/design/migrate.ts`) so renaming, re-linking artwork, or deleting an element or symbol automatically propagates to dependent `bp.scenes` (`SceneObject.name`, `SceneObject.assetId`, and `refId` unbinding), `bp.symbolSets`, `bp.canvas.backgroundAssetId`, and `bp.animations`.
   - Updated `SceneObjectView.tsx` so scene objects referencing an element or symbol resolve live artwork from `resolvers.elements` / `resolvers.symbols` when `object.assetId` is unset.
3. **Implemented 6-Category Element Usage Analyzer (`src/lib/design/element-usage.ts`)**:
   - Created `computeElementUsage(doc, blueprint, elementId)` returning structured `UsageEntry[]` lists across `Symbol Sets`, `Scenes`, `Layers`, `Reels`, `Paytable`, and `Animations`, plus `totalCount`.
4. **Built F11 Element Detail View & Manual Element Editor Entry Point (`src/components/design/ElementDetail.tsx`, `src/components/design/ManualElementEditor.tsx`, `src/components/design/DesignApp.tsx`, `src/app/projects/[id]/elements/[elementId]/page.tsx`, `src/app/projects/[id]/elements/[elementId]/editor/page.tsx`)**:
   - Upgraded `ElementDetail.tsx` with the complete `F11` layout:
     - **Header**: `Back` button, `Element name` inline commit input, `Save` button, `Dirty indicator` badge (`Saved` / `Unsaved changes` / `Saving…` / `Out of sync` / `Save error`), and primary action buttons (`Save`, `Replace Image`, `Download`, `Duplicate`, `Delete`).
     - **Main**: Large artwork preview with checkerboard alpha-grid toggle, live tint/opacity/blend preview, `Edit Image` bar with active `Open Element Editor` button and disabled `AI Edit Image · Future Functionality` button, plus set member symbol cards when viewing a `symbol_set` element.
     - **Right Configuration Panel**: All 8 required sections (`1. Identity`, `2. Artwork`, `3. Style`, `4. Variants`, `5. Extras`, `6. Animation`, `7. History`, `8. Usage`).
   - Created dedicated routes `/projects/[id]/elements/[elementId]` and `/projects/[id]/elements/[elementId]/editor` (`ManualElementEditor`).

---

## 4. Files Created, Modified, or Deleted

### Created (6)
- `src/lib/design/element-usage.ts` — Computes live element usage across `Symbol Sets`, `Scenes`, `Layers`, `Reels`, `Paytable`, and `Animations`.
- `src/components/design/ManualElementEditor.tsx` — Manual Element Editor workspace entry point with zoom, alpha grid, safe-area guides, manual artwork upload/replacement, manual blend/opacity/tint adjustments, and disabled future AI Edit Image control.
- `src/app/projects/[id]/elements/[elementId]/page.tsx` — Dedicated server route for `/projects/[id]/elements/[elementId]`.
- `src/app/projects/[id]/elements/[elementId]/editor/page.tsx` — Dedicated server route for `/projects/[id]/elements/[elementId]/editor`.
- `tests/element-detail.test.ts` — Unit and integration test suite verifying all 8 F11 sections, 6 usage categories, 5 primary actions, and dependent view propagation + persistence.
- `docs/implementation/F11-element-detail-view.md` — This 13-section implementation report.

### Modified (14)
- `src/lib/blueprint/types.ts` — Added `ElementStyleConfig`, `ElementAnimationConfig`, `SymbolVariant.description`, and optional `style`, `variants`, `extras`, and `animation` fields on `ElementDef`.
- `src/lib/blueprint/validate.ts` — Validated element variant asset references, element variant ID uniqueness, and element-targeted animation cues.
- `src/lib/design/types.ts` — Extended `DesignDoc` (`animations`, `scenes`, `layers`) and `ElementPatch` (`style`, `variants`, `extras`, `animation`, `imageSource`, `imageNotes`).
- `src/lib/design/model.ts` — Updated `finalizeDoc` and `sanitizeVariants` to preserve `ElementDef` `style`, `variants`, `extras`, `animation`, and `DesignDoc` `animations`/`scenes`/`layers`.
- `src/lib/design/parse.ts` — Extended `parseDesignDoc` to validate and preserve element `style`, `variants`, `extras`, `animation`, and `animations`.
- `src/lib/design/migrate.ts` — Updated `designDocFromBlueprint` and `applyDesign` so editing or deleting an element updates dependent scenes, symbolSets, canvas background, and animations while remaining idempotent when unchanged.
- `src/lib/design/operations.ts` — Added `clearElementArtwork`, `annotateElementImageRevision`, `addElementVariant`, `editElementVariant`, `duplicateElementVariant`, `removeElementVariant`, `addElementAnimationCue`, `updateElementAnimationCue`, and `removeElementAnimationCue`, and enhanced `updateElement` and `duplicateElement`.
- `src/lib/elements/types.ts` — Extended `ElementBase` with optional `imageHistory`, `variants`, `extras`, `styleConfig`, and `animation`.
- `src/lib/elements/blueprint-adapter.ts` — Updated `standaloneFromDef` and `applyLibraryToElements` to round-trip `imageHistory`, `variants`, `extras`, `style`, and `animation`.
- `src/components/canvas/SceneObjectView.tsx` — Added fallback asset resolution from `resolvers.elements` and `resolvers.symbols` when a scene object references an element or symbol.
- `src/components/design/ElementDetail.tsx` — Upgraded to the full F11 Element Detail View (`Header`, `Main` large artwork preview + `Edit Image` controls, and `Right` 8-section configuration panel).
- `src/components/design/DesignApp.tsx` — Connected `ElementDetail` with `projectId`, `blueprint`, `saveState`, `onSave`, `onApply`, and `replaceElementArtwork` revision tracking.
- `docs/implementation/INDEX.md` — Added `F11` entry to the master implementation index.
- `docs/backups/Backup-Manifest.md` — Recorded `F11` Google Drive folder and file IDs.

### Deleted (0)
- None.

---

## 5. Architecture and Dependencies
- **Single Source of Truth**: All element configuration lives on `ElementDef` (and `SymbolDef` / `AnimationMeta`) inside `GameBlueprint`.
- **Service & Selector Boundaries**:
  - `src/lib/design/operations.ts` provides pure, deterministic state transitions for undo/redo and persistence.
  - `src/lib/design/element-usage.ts` computes cross-domain usage without coupling UI components to internal reel/scene traversal.
  - `src/lib/design/migrate.ts` (`applyDesign`) synchronizes dependent blueprint slices whenever an element is modified.
- **No External Dependencies Added**: Built entirely with existing React 19, Next.js 15, TypeScript, and local Drizzle/PostgreSQL persistence.

---

## 6. Data Flow and Persistence
1. **Load**: `getProject(id)` loads the `GameBlueprint` from `projects`; `designDocFromBlueprint(blueprint)` hydrates `DesignDoc` including `elements`, `symbols`, `assets`, `paytable`, `strips`, `animations`, `scenes`, and `layers`.
2. **Edit**: User edits in `ElementDetail` invoke `actions.updateElement`, `actions.rename`, `replaceElementArtwork`, or `onApply(label, fn)`, pushing a labeled snapshot onto the undo/redo stack in `useDesignEditor` and marking `saveState = "dirty"`.
3. **Propagate (`applyDesign`)**:
   - Renaming or updating artwork on an element updates any `SceneObject` with `kind === "element" && refId === element.id` (and for `symbol` elements, any `SceneObject` with `kind === "symbol"`).
   - Updating a `game_background` element's artwork updates `bp.canvas.backgroundAssetId`.
   - Updating a `symbol_set` element updates `bp.symbolSets`.
   - Updating element animation cues updates `bp.animations`.
4. **Persist**: `useDesignEditor` auto-saves (or flushes immediately when clicking `Save`) via `PUT /api/projects/[id]/design` -> `saveDesign` (`src/server/design-service.ts`), validating via `parseDesignDoc` and `validateBlueprint` before committing the updated `GameBlueprint` and incrementing `revision`.

---

## 7. Integration Points
- **Design View (`/projects/[id]/design` & `/projects/[id]`)**: Clicking `Open` on any `ElementCard`, double-clicking a card, or clicking `Open detail view` in `Inspector` opens `ElementDetail` (`?element=<id>`).
- **Direct Element Route (`/projects/[id]/elements/[elementId]`)**: Opens the Element Detail View directly for any element ID.
- **Manual Element Editor Route (`/projects/[id]/elements/[elementId]/editor`)**: Launched from the `Open Element Editor` button in the `Edit Image` bar.
- **Canvas / Scenes (`/projects/[id]/canvas`)**: Scene objects referencing the element automatically reflect updated element names and artwork.
- **Asset Library (`/projects/[id]/assets`)**: Element artwork and variant artwork pickers bind directly to linked project assets, and `findAssetUsage` tracks element and revision usage.

---

## 8. Controls and Behaviors
- **Header**:
  - `Back`: Returns to the Design View overview (or navigates back to `/projects/[id]/design`).
  - `Element name`: Inline `CommitInput` that renames the element on Enter or blur while keeping `element.id` immutable.
  - `Save`: Immediately flushes pending edits to the server (`editor.flush()`).
  - `Dirty indicator`: Displays live persistence state (`Saved`, `Unsaved changes`, `Saving…`, `Out of sync`, `Save error`).
- **Primary Actions**:
  - `Save`, `Duplicate`, `Delete` (with dependency impact confirmation), `Replace Image` (file upload), and `Download` (single image or `.zip` archive for symbol sets).
- **Edit Image Bar**:
  - `Open Element Editor`: Navigates to `/projects/[id]/elements/[elementId]/editor` for manual zoom, alpha grid, safe-area guide inspection, manual image replacement, and manual blend/opacity/tint adjustments.
  - `AI Edit Image · Future Functionality`: Explicitly disabled (`disabled={true}`) with explanatory tooltip.
- **Right Configuration Panel (8 Sections)**:
  1. `Identity`: Element ID + copy button, category badge, origin, Group, Description, and Tags.
  2. `Artwork`: Linked asset metadata, `AssetRefPicker` (project asset / external URL / placeholder), `Replace Image`, `Clear`, `Restore Previous`, and `Download`.
  3. `Style`: Style guide, Blend mode (`normal`, `multiply`, `screen`, `overlay`, etc.), Opacity slider (`10%–100%`), Tint color, category-specific parameters (`Frame style`, `Aspect ratio`, `Included buttons`, `Symbol type`, `Value tier`), and production `Notes`.
  4. `Variants`: `VariantManager` to create, rename, duplicate, delete, and assign artwork to variants with independent stable IDs.
  5. `Extras`: `ExtrasEditor` with quick presets (`Split`, `Expansion`, `Hover`, `Animation`, `Custom Extra`) and typed custom `Text` / `Number` / `Switch` keys.
  6. `Animation`: Element animation preset (`none`, `idle_pulse`, `float`, `spin_glow`, `win_pop`, `custom`), default trigger, duration (ms), easing, loop toggle, and project `AnimationMeta` cue list (`Add Cue`, trigger selector, delete cue).
  7. `History`: Chronological list of `ImageRevision` entries with version number (`v1`, `v2`, …), source badge, timestamp, asset reference, inline note editor, and `Restore` button.
  8. `Usage`: Live counts and itemized entries across `Symbol Sets`, `Scenes`, `Layers`, `Reels`, `Paytable`, and `Animations`.

---

## 9. Testing and Verification
Executed verification commands:
```bash
npm run typecheck
npx tsx --test tests/*.test.ts
```
- **TypeScript (`npm run typecheck`)**: `0` errors.
- **Automated Test Suite (`npx tsx --test tests/*.test.ts`)**: `97/97` tests passing (`0` failures), including 3 comprehensive `F11` test suites in `tests/element-detail.test.ts`:
  1. `F11 Sections 1–7: Identity, Artwork, Style, Variants, Extras, Animation, and History on an Element` — PASS
  2. `F11 Section 8 — Usage: computeElementUsage reports Symbol Sets, Scenes, Layers, Reels, Paytable, and Animations` — PASS
  3. `F11 Acceptance: editing, duplicating, or deleting an element updates all dependent views and persists to GameBlueprint` — PASS
- **Live HTTP Route Verification**:
  - `GET /projects/prj_demo_roman_empire?element=el-symbol-set` -> `200 OK`
  - `GET /projects/prj_demo_roman_empire/elements/el-symbol-set` -> `200 OK`
  - `GET /projects/prj_demo_roman_empire/elements/el-symbol-set/editor` -> `200 OK`

---

## 10. Known Issues and Limitations
- Full pixel-level raster/vector brush and layer editing inside the standalone Image Editor belongs to `SECTION 3 — IMAGE EDITOR`; in `F11`, `Open Element Editor` provides the manual Element Editor entry point (`/projects/[id]/elements/[elementId]/editor`) with manual artwork replacement, zoom/alpha/safe-guide inspection, and non-destructive blend/opacity/tint adjustments.
- AI image editing is intentionally unimplemented per project rules and is represented by a disabled control labeled `AI Edit Image · Future Functionality`.

---

## 11. Requirements Status
| Requirement | Status | Notes |
| :--- | :--- | :--- |
| Header: `Back`, `Element name`, `Save`, `Dirty indicator` | `PASS` | Implemented in `ElementDetail.tsx` (`data-testid="element-detail-header"`). |
| Main: `Large artwork preview` | `PASS` | Implemented in `ElementDetail.tsx` (`data-testid="element-large-preview"`). |
| Right: `Configuration panel` | `PASS` | Implemented in `ElementDetail.tsx` (`data-testid="element-config-panel"`). |
| Section 1: `Identity` | `PASS` | Name, immutable ID + copy, type, origin, group, description, tags. |
| Section 2: `Artwork` | `PASS` | AssetRefPicker, Upload/Replace, Clear, Restore Previous, Download. |
| Section 3: `Style` | `PASS` | Style guide, blend mode, opacity, tint color, category parameters, notes. |
| Section 4: `Variants` | `PASS` | Create, rename, duplicate, delete, and assign artwork with stable IDs. |
| Section 5: `Extras` | `PASS` | Presets + custom typed `string | number | boolean` key-value pairs. |
| Section 6: `Animation` | `PASS` | Element animation preset/trigger/duration/easing/loop + blueprint cues. |
| Section 7: `History` | `PASS` | Non-destructive `ImageRevision[]` list with notes editing and restore. |
| Section 8: `Usage` (`Symbol Sets`, `Scenes`, `Layers`, `Reels`, `Paytable`, `Animations`) | `PASS` | Computed by `computeElementUsage` and rendered in Section 8. |
| Actions: `Save`, `Duplicate`, `Delete`, `Replace Image`, `Download` | `PASS` | All 5 actions wired and verified. |
| Edit Image: Manual Element Editor entry point + disabled AI Edit action | `PASS` | `Open Element Editor` navigates to `/projects/[id]/elements/[elementId]/editor`; AI button is disabled and labeled as future functionality. |
| Acceptance: Editing an element updates all dependent views | `PASS` | Verified across `scenes`, `symbolSets`, `canvas`, `reels`, `paytable`, and `animations` in `tests/element-detail.test.ts`. |

---

## 12. Next Steps
- Proceed to the next frontend studio section (`F12` or as directed by the user), building upon the `ElementDef` style, variant, animation, and usage infrastructure established in `F11`.

---

## 13. Backup Information
- **Google Drive Category Folder**: `Slot Studio Backups/F - Frontend/` (`1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Google Drive Section Folder**: `Slot Studio Backups/F - Frontend/F11/` (`1IoGGxSbGbrIcKj6CTgPBAHSDsBxXSzhp`)
- **Backup Timestamp (UTC)**: `2026-10-12T11:48:00Z`
- **Upload & Verification Status**: `SUCCESS` (`VERIFIED`)
- **Uploaded Files & Google Drive IDs**:
  | Relative Path | Action | Google Drive File ID | Parent Folder ID | Size (Bytes) |
  | :--- | :--- | :--- | :--- | :--- |
  | `src/lib/blueprint/types.ts` | Modified | `1BeL6XjR2fVPCz1uDXV-CnhENxnkK28-4` | `12ZOGEJUTeRWmSp_OJNb3GjrU6AGjy1DQ` | `15,706` |
  | `src/lib/blueprint/validate.ts` | Modified | `1lyjJO5uwJYHw-NbbUyefBWBlNsBFI0h6` | `12ZOGEJUTeRWmSp_OJNb3GjrU6AGjy1DQ` | `7,549` |
  | `src/lib/design/types.ts` | Modified | `1B0FsG-YXC2USKaWgFjGp9QGftMyU4JM0` | `1CQ3U4dhjKzFwr70EYVBVFraB0ogKfeIk` | `4,017` |
  | `src/lib/design/model.ts` | Modified | `16lKDXGnKmPhuf2K73-Es4J3NRiyo6ChU` | `1CQ3U4dhjKzFwr70EYVBVFraB0ogKfeIk` | `14,586` |
  | `src/lib/design/parse.ts` | Modified | `1NNGkN3Yqml5HXf2Zssno_IikiwXFRXZj` | `1CQ3U4dhjKzFwr70EYVBVFraB0ogKfeIk` | `16,476` |
  | `src/lib/design/migrate.ts` | Modified | `1fiI4dYpoSxqUZMSCob79ZF0oDF8hvCJO` | `1CQ3U4dhjKzFwr70EYVBVFraB0ogKfeIk` | `9,901` |
  | `src/lib/design/operations.ts` | Modified | `1KbA1iFT05gR6jIbKe1uRMGlJXaWEupuu` | `1CQ3U4dhjKzFwr70EYVBVFraB0ogKfeIk` | `52,699` |
  | `src/lib/design/element-usage.ts` | Created | `1f2iXXHd6aGRifjFlG0e36BGQZv1AEr4g` | `1CQ3U4dhjKzFwr70EYVBVFraB0ogKfeIk` | `8,273` |
  | `src/lib/elements/types.ts` | Modified | `1HEqrNTe3GuXqFc77zKmUn3Ue3sn9uNJ6` | `1Fpxou1QWXgz_jHtSk_ny_0KPe9jckyFE` | `5,003` |
  | `src/lib/elements/blueprint-adapter.ts` | Modified | `1e2flukkOoEr8eVoHdtrm8nKCnYaau2-x` | `1Fpxou1QWXgz_jHtSk_ny_0KPe9jckyFE` | `12,454` |
  | `src/components/canvas/SceneObjectView.tsx` | Modified | `1BjLU_QNXcIRF14d-KIpBcDLyg5w0tKnG` | `1XURohMSZ2U6uh1d9sRAv4m_y92Xl_wT4` | `8,262` |
  | `src/components/design/ElementDetail.tsx` | Modified | `1RlEHrgVt5qEu450ZYz7Vds8yV028gnz3` | `1gHgVo4ptxz0TEn9G1MnAwqjChlYs6iNJ` | `62,704` |
  | `src/components/design/DesignApp.tsx` | Modified | `1zRfRwGadqK5HvkIy6cnZkdYFDTkZhHoy` | `1gHgVo4ptxz0TEn9G1MnAwqjChlYs6iNJ` | `28,637` |
  | `src/components/design/ManualElementEditor.tsx` | Created | `1XvdtrHWYWcnCYtIUth9jHhgNjqMdSoTJ` | `1gHgVo4ptxz0TEn9G1MnAwqjChlYs6iNJ` | `11,721` |
  | `src/app/projects/[id]/elements/[elementId]/page.tsx` | Created | `1K6ZBWfz33fZ1HNf2fMp66cnZqff9DZzZ` | `1AqZT1s4vk2YNqqK1kWcwAby2ZNjdI4q4` | `811` |
  | `src/app/projects/[id]/elements/[elementId]/editor/page.tsx` | Created | `1rdOcHRteTiqL67nH8ePPESdXi8XNXO63` | `1yxw7ZBWPnLUPXxvxsRVV4oX2NzEgD6FC` | `840` |
  | `tests/element-detail.test.ts` | Created | `1Y6V6ojkRhxEY8ye9xEB5VILRcBuC0qLj` | `1Mxyjzrfvw_KVmIauAmc-2sfMj_KY1aHs` | `16,250` |
  | `docs/implementation/F11-element-detail-view.md` | Created | `1xJyPVTYUl8i6GEs_d3JmyIjyWtl6pqUv` | `1rT7PjpWOKf8MZACEBAvymiTGVdmCfAER` | `21,692` |
  | `docs/implementation/INDEX.md` | Modified | `1aOCO51Ge6fvZ__WQmhrW50Ghuqexce2i` | `1rT7PjpWOKf8MZACEBAvymiTGVdmCfAER` | `3,887` |
  | `docs/backups/Backup-Manifest.md` | Modified | `1LHOBRdFBm4tOT46WNU8JN25D3cygbGoZ` | `1XkqAnclMqnLfTlid-HUMR0Hb3CmH8PRR` | `18,622` |
  | `Backup Manifest.md` (Root) | Modified | `1nPfzpYU4k3oZ2jYa6mqmDezVLDhuKXYn` | `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM` | `18,622` |
