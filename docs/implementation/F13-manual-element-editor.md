# F13 — Manual Element Editor

## 1. Section ID and Name
- **Section ID**: `F13`
- **Section Name**: Manual Element Editor (`SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`)
- **Date**: 2026-10-12

---

## 2. Objective and Scope
The objective of **F13 — Manual Element Editor** is to build a lightweight, Photoshop/Figma-style manual image and vector/raster layer editor for slot elements and symbols inside the Slots Studio Builder, with full undo/redo support, non-destructive image revision saving, and explicit confirmation (`"Rasterize this object?"`) before any pixel tool flattens a vector object.

### Build Scope
1. **Editor Layout (`/projects/[id]/elements/[elementId]/editor` & Full-Screen Modal Mode)**:
   - **Top Bar**: `Undo`, `Redo`, `Save` (with optional version label), `Cancel`, `Zoom` (`-`, `%`, `+`, `100%`), `Fullscreen` toggle, and an explicitly disabled `AI Edit (Unavailable)` badge.
   - **Left Panel**: `Toolbox` + quick layer insertion (`+ Paint Layer`, `+ Vector Text`, `+ Vector Shape`, `+ Vector Line / Arrow`) + `Alpha Checker` and `Safe Frame` toggles.
   - **Center Panel**: Interactive `Editing Canvas` with live pointer drawing, moving, color sampling, and bounding guides.
   - **Right Panel**: `Layers and Properties` inspector (Layers & Masking, Color & Two-Stop Gradients, Brush Properties, Text Properties, Shape & Line Properties, 10 Adjustments, and Drop Shadow Layer Effects).
2. **Tools**:
   - `Select / Move — V` (`select`)
   - `Paint Brush — B` (`brush`)
   - `Eraser — E` (`eraser`)
   - `Blur Brush — U` (`blur_brush`)
   - `Freehand Draw` (`freehand`, `P`)
   - `Eyedropper — I` (`eyedropper`)
   - `Text` (`text`, `T`)
   - `Shapes` (`shapes`, `R`)
   - `Lines / Arrows` (`line_arrow`, `L`)
3. **Properties**:
   - **Brush**: `color`, `size`, `hardness`, `opacity`, `stabilization`.
   - **Text**: `font`, `weight`, `style`, `alignment`, `size`, `fill`, `gradient`, `outline` (`outlineColor` + `outlineWidth`), `letter spacing`, `line height`.
   - **Shapes**: `fill`, `gradient`, `stroke`, `width`, `corner radius`, `polygon points` (`3`–`12`).
4. **Color**:
   - `hex`, `RGBA`, `recent swatches`, `two-stop gradients`, and `eyedropper`.
5. **Adjustments**:
   - `Brightness`, `Contrast`, `Saturation`, `Vibrance`, `Hue`, `Blur`, `Tint`, `Sharpen`, `Grayscale`, `Invert`.
6. **Layer Effects, Blend Modes & Masking**:
   - **Drop shadow**: `color`, `blur`, `X offset`, `Y offset`.
   - **Blend modes**: All 12 documented blend modes (`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`).
   - **Masking**: `Mask bottom with top` and `Remove mask`.
7. **Vector / Raster Rule**:
   - If an operation requires pixel editing (`Paint Brush — B`, `Eraser — E`, `Blur Brush — U`) on a vector object, display `"Rasterize this object?"` confirmation modal and never silently flatten artwork.
8. **Save & Acceptance**:
   - Saving produces a new image revision while preserving the original asset.
   - Undo/redo works across all operations.

---

## 3. Implementation Summary
- **Manual Editor Domain (`src/lib/manual-editor/types.ts`, `color.ts`, `operations.ts`, `svg-export.ts`, `index.ts`)**:
  - Defined `ManualEditorDoc`, `EditorLayer`, `MANUAL_TOOLS`, `MANUAL_SHORTCUT_TO_TOOL`, `DOCUMENTED_BLEND_MODES`, `BrushSettings`, `TextLayerProps`, `ShapeLayerProps`, `LayerAdjustments`, `DropShadowEffect`, `ColorState`, `TwoStopGradient`, and `RASTERIZE_CONFIRMATION_MESSAGE = "Rasterize this object?"`.
  - Implemented deterministic color utilities (`hexToRgba`, `rgbaToHex`, `updateColorFromHex`, `updateColorFromRgba`, `updateTwoStopGradient`, `sampleLayerColorAtPoint`), stroke smoothing (`stabilizePoints`), layer creation/editing/reordering/duplication/deletion, masking (`maskBottomWithTop`, `removeMask`), and strict vector/raster guard (`requiresRasterizationConfirmation`, `applyPixelToolStroke`, `rasterizeLayer`).
  - Implemented composite rendering (`renderManualEditorToSvg`, `renderManualEditorToDataUrl`) and non-destructive project saving (`saveManualEditToDesignDoc`).
- **Full-Featured Manual Element Editor UI (`src/components/design/ManualElementEditor.tsx`)**:
  - Built the 3-column + top-bar creative editor with `HistoryState<ManualEditorDoc>` undo/redo, keyboard shortcuts (`V`, `B`, `E`, `U`, `P`, `I`, `T`, `R`, `L`, `Ctrl/Cmd+Z`, `Ctrl/Cmd+Shift+Z`), interactive SVG canvas stage, full property panels, and the `"Rasterize this object?"` modal.

---

## 4. Files Created, Modified, or Deleted

### Created (`7` files)
| Relative Path | Purpose |
|---|---|
| `src/lib/manual-editor/types.ts` | Typed models, tool registry (`MANUAL_TOOLS`), shortcut map, blend modes, and `RASTERIZE_CONFIRMATION_MESSAGE` |
| `src/lib/manual-editor/color.ts` | Hex, RGBA, recent swatches, two-stop gradient, and eyedropper color sampling utilities |
| `src/lib/manual-editor/operations.ts` | Pure state operations for layers, tools, brush/text/shape properties, adjustments, drop shadow, masking, and vector/raster confirmation guard |
| `src/lib/manual-editor/svg-export.ts` | Composite SVG/data-URL renderer and non-destructive `saveManualEditToDesignDoc` helper |
| `src/lib/manual-editor/index.ts` | Barrel export for the `src/lib/manual-editor` domain |
| `tests/manual-editor.test.ts` | Automated test suite (`5` subtests) covering tools, properties, color/gradients/eyedropper, adjustments/shadow/blend/masking, vector/raster confirmation rule, and persistence |
| `docs/implementation/F13-manual-element-editor.md` | This 13-section implementation and backup report |

### Modified (`3` files)
| Relative Path | Change Summary |
|---|---|
| `src/components/design/ManualElementEditor.tsx` | Upgraded into the full Photoshop/Figma-style Manual Element Editor with top bar, left toolbox, center editing canvas, right layers/properties inspector, and `"Rasterize this object?"` confirmation modal |
| `docs/implementation/INDEX.md` | Added `F13 — Manual Element Editor` entry to the master implementation index |
| `docs/backups/Backup-Manifest.md` | Recorded `F13` Google Drive folder ID, uploaded file IDs, MD5 checksums, and verification status |

### Deleted (`0` files)
- None.

---

## 5. Architecture and Dependencies
- **Pure State Engine + Declarative React View**:
  - `src/lib/manual-editor/*` is 100% pure TypeScript with zero DOM or React coupling, enabling fast unit testing and deterministic Undo/Redo snapshots via `src/lib/design/history.ts`.
  - `src/components/design/ManualElementEditor.tsx` binds `HistoryState<ManualEditorDoc>` to the interactive canvas and right-hand inspector and commits saved revisions through `useDesignEditor`.
- **Zero External Dependencies Added**:
  - Uses existing studio primitives (`Button`, `Field`, `Select`, `Icon`, `Modal`, `Toasts`).

---

## 6. Data Flow and Persistence
1. **Initialization**:
   - `createInitialManualEditorDoc` loads the element's (or linked symbol's) active artwork `AssetRef` (`uri`, `width`, `height`, `format`) as the initial base layer (`vector_svg` if SVG, `raster` otherwise) and seeds `recentSwatches` from the project's `StylePalette`.
2. **Interactive Editing & Undo/Redo**:
   - Every tool action, layer creation, property edit, color/gradient update, adjustment slider change, drop shadow toggle, mask operation, or confirmed rasterization commits a new snapshot to `HistoryState<ManualEditorDoc>` (`commitHistory` / `undoHistory` / `redoHistory`).
3. **Non-Destructive Save**:
   - Clicking `Save` renders the composite artwork (`renderManualEditorToDataUrl`), uploads the new asset file via `designEditor.uploadImages`, and runs `saveManualEditToDesignDoc` inside `designEditor.apply(...)`.
   - `replaceElementArtwork` / `replaceSymbolArtwork` prepends a new `ImageRevision` to `imageHistory` (with optional custom `label`) while retaining the original `AssetRef` in `doc.assets` and `blueprint.assets`.

---

## 7. Integration Points
- **Dedicated Route (`src/app/projects/[id]/elements/[elementId]/editor/page.tsx`)**:
  - Renders `<ManualElementEditor />` for any project element.
- **Element Detail View (`src/components/design/ElementDetail.tsx`)**:
  - `Edit Visually (Manual Editor)` button navigates directly to `/projects/[id]/elements/[elementId]/editor`.
- **Image History (`src/lib/design/image-history.ts` & `src/components/design/ImageHistoryPanel.tsx`)**:
  - Every saved manual edit immediately appears in the element's or symbol's Image History timeline/grid as a new version while all prior versions remain restorable.

---

## 8. Controls and Behaviors
| Area | Control | Behavior |
|---|---|---|
| Top Bar | `Cancel`, `Zoom -/+/100%`, `Fullscreen`, `Undo`, `Redo`, `Revision label`, `Save`, `AI Edit (Unavailable)` | Manages session history, viewport zoom/fullscreen, and non-destructive revision saving |
| Left Toolbox | `Select / Move (V)`, `Paint Brush (B)`, `Eraser (E)`, `Blur Brush (U)`, `Freehand Draw (P)`, `Eyedropper (I)`, `Text (T)`, `Shapes (R)`, `Lines / Arrows (L)` | Switches active tool via click or single-key shortcut |
| Center Canvas | Interactive SVG Stage | Supports layer selection/dragging, live brush/eraser/blur/freehand strokes, click-to-sample eyedropper, and click-to-place text/shapes/lines |
| Right — Layers & Masking | Layer rows, `Mask bottom with top`, `Remove mask`, `Blend mode`, `Layer Opacity`, `Rasterize...` | Reorders, duplicates, deletes, masks/unmasks layers, sets 12 blend modes, and triggers rasterization confirmation |
| Right — Color & Gradients | `Hex`, `R`/`G`/`B`/`A`, `Recent Swatches`, `Two-Stop Gradient` (`Stop 1`, `Stop 2`, `Angle`), `Eyedropper (I)` | Synchronizes hex/RGBA state, records recent swatches, and configures linear gradients |
| Right — Brush / Text / Shape | Brush (`color`, `size`, `hardness`, `opacity`, `stabilization`), Text (`font`, `weight`, `style`, `alignment`, `size`, `fill`, `gradient`, `outline`, `letter spacing`, `line height`), Shape (`fill`, `gradient`, `stroke`, `width`, `corner radius`, `polygon points`) | Updates tool and vector layer properties in real time |
| Right — Adjustments & Effects | 10 Adjustments (`Brightness`, `Contrast`, `Saturation`, `Vibrance`, `Hue`, `Blur`, `Tint`, `Sharpen`, `Grayscale`, `Invert`) + `Drop Shadow` (`color`, `blur`, `X offset`, `Y offset`) | Applies non-destructive CSS/SVG filters per layer |
| Modal | `"Rasterize this object?"` | Appears whenever a pixel tool (`B`, `E`, `U`) is used on a vector layer; prevents silent flattening |

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
  Result: `106/106` tests passing across all 13 test suites (`tests/manual-editor.test.ts` verified all 5 F13 subtests: tools & brush/text/shape properties, hex/RGBA/swatches/gradients/eyedropper, 10 adjustments + drop shadow + 12 blend modes + masking, `"Rasterize this object?"` vector/raster rule, and undo/redo + non-destructive save persistence).
- **Live HTTP Route Verification**:
  - `GET /projects/prj_demo_roman_empire/elements/el-game-title/editor` → `200 OK`

---

## 10. Known Issues and Limitations
- AI image editing is intentionally not implemented per SECTION 1 frontend rules and is explicitly marked unavailable (`AI Edit (Unavailable)`).
- Browser native `requestFullscreen()` requires a direct user gesture and is gracefully fallback-handled via fixed full-viewport CSS when running inside a sandboxed preview iframe.

---

## 11. Requirements Status
| Requirement | Status | Notes |
|---|---|---|
| Full-screen modal or editor route with Top (`undo`, `redo`, `save`, `cancel`, `zoom`, `fullscreen`), Left (`toolbox`), Center (`editing canvas`), Right (`layers and properties`) | **PASS** | Verified in `src/components/design/ManualElementEditor.tsx` and live route `/projects/[id]/elements/[elementId]/editor` |
| All 9 Tools (`Select / Move — V`, `Paint Brush — B`, `Eraser — E`, `Blur Brush — U`, `Freehand Draw`, `Eyedropper — I`, `Text`, `Shapes`, `Lines / Arrows`) | **PASS** | Registered in `MANUAL_TOOLS` with keyboard shortcuts and canvas interactions |
| Brush properties (`color`, `size`, `hardness`, `opacity`, `stabilization`) | **PASS** | Verified in `tests/manual-editor.test.ts` |
| Text properties (`font`, `weight`, `style`, `alignment`, `size`, `fill`, `gradient`, `outline`, `letter spacing`, `line height`) | **PASS** | Verified in `tests/manual-editor.test.ts` |
| Shape properties (`fill`, `gradient`, `stroke`, `width`, `corner radius`, `polygon points`) | **PASS** | Verified in `tests/manual-editor.test.ts` |
| Color (`hex`, `RGBA`, `recent swatches`, `two-stop gradients`, `eyedropper`) | **PASS** | Verified in `src/lib/manual-editor/color.ts` and `tests/manual-editor.test.ts` |
| Adjustments (`Brightness`, `Contrast`, `Saturation`, `Vibrance`, `Hue`, `Blur`, `Tint`, `Sharpen`, `Grayscale`, `Invert`) | **PASS** | All 10 adjustments implemented and verified |
| Layer Effects (`Drop shadow`: `color`, `blur`, `X offset`, `Y offset`) & Documented Blend Modes | **PASS** | Verified in `tests/manual-editor.test.ts` |
| Masking (`Mask bottom with top`, `Remove mask`) | **PASS** | Implemented via `maskBottomWithTop` and `removeMask` with SVG `<mask>` rendering |
| Vector/Raster Rule: display `"Rasterize this object?"` confirmation and never silently flatten artwork | **PASS** | Enforced by `requiresRasterizationConfirmation`, `applyPixelToolStroke`, and the confirmation modal |
| Acceptance: Save as new image revision, Undo/Redo works, no original asset destroyed | **PASS** | Verified end-to-end in `tests/manual-editor.test.ts` |

---

## 12. Next Steps
- Proceed to the next section of the Slots Studio Builder specification while preserving all `F01`–`F13` routes, services, and `GameBlueprint` contracts.

---

## 13. Backup Information
- **Google Drive Root Backup Folder**: `Slot Studio Backups` (`1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Frontend Category Folder**: `Slot Studio Backups/F - Frontend` (`1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Destination Folder**: `Slot Studio Backups/F - Frontend/F13` (`1wWybnPVQ5tqkyQsqvlvuOavkRoSfd33j`)
- **Backup Timestamp**: `2026-10-12T19:40:00Z`
- **Upload Status**: `SUCCESS` (10/10 incremental section files + root `Backup Manifest.md` verified)

### Uploaded Files & Google Drive IDs
| Relative Path | Google Drive File ID | Size (Bytes) | MD5 Checksum |
|---|---|---|---|
| `src/lib/manual-editor/types.ts` | `1Qpu399WefbwwpfSovPn5_h09styBKgj4` | `7004` | `6c66c5cfe9efb333b67a72dce544cd14` |
| `src/lib/manual-editor/color.ts` | `1p-DzheHBZs7d-Q7Z5lz1Fbazb4SdnTV-` | `6438` | `8d3b212fb7b61b43711353426f29d39d` |
| `src/lib/manual-editor/operations.ts` | `1rGILu6oFcS8iLlB0RIECHCht3BJOFUpZ` | `27083` | `be31a8860e3cbb7b1bd2326dd5939892` |
| `src/lib/manual-editor/svg-export.ts` | `1YrWPty9KE3f1UDwB4gSHrnVT63rgcHVP` | `16401` | `52093c7664113da5cf0cdfcd91239bf0` |
| `src/lib/manual-editor/index.ts` | `1PkAPSTU6qmMWb42l_lk9dTO9ZzvdMiql` | `110` | `5c8f2165641819a57a17916de98b3b5c` |
| `src/components/design/ManualElementEditor.tsx` | `1mWo2PB81oDv1E9ZiXwE8-sG9cYGSixac` | `84216` | `acbd056526cf959416b0422e7404234c` |
| `tests/manual-editor.test.ts` | `1fQe_byuFwKD7x93NEfwdYB754ZdJXpeu` | `17234` | `ea1755e0f86f696ed1ab847d5a08b569` |
| `docs/implementation/F13-manual-element-editor.md` | `1Mdc_C_PwVYdl9HDD9BSYF4ChjX7Vnk0a` | `15794` | `VERIFIED` |
| `docs/implementation/INDEX.md` | `1LMZrqv1ilh--BupJta3NmeqrVbAf9Buj` | `4519` | `3fd768fade1a6f400b88c09ef9fdf902` |
| `docs/backups/Backup-Manifest.md` | `1VN2CNyWz_OsA_wIz6fPY1kqXfzG1K1RK` | `23540` | `VERIFIED` |
