# F05 — Canvas System

## 1. Section ID and Name
- **Section ID**: `F05`
- **Section Name**: `CANVAS SYSTEM`
- **Purpose**: Provide the central interactive visual scene canvas (`/projects/[id]/canvas` and `/project/[projectId]/canvas`) for composing slot game scenes with pan, zoom, single/multi-selection, move, resize, rotate, snapping, smart guides, grid, safe area bounds, configurable background, and tool architecture backed by `GameBlueprint`.

## 2. Objective and Scope
### Intended Scope
- **Canvas Viewport & Overlays**:
  - Pan (`Pan` tool `H`, `Space + drag`, middle-mouse drag, or wheel scroll) and Zoom (`Zoom in`, `Zoom out`, `Reset zoom to 100%`, `Zoom to fit`, `Ctrl/⌘ + wheel` cursor-anchored zoom).
  - Visual grid (`Grid` / `No grid` toggle, spacing slider `8px–200px`, optional grid snapping), smart alignment guides (`#f0b429`), scene bounds (`width × height`), safe canvas area frame (`Safe` toggle), and configurable scene background color/artwork.
- **Tool Infrastructure**:
  - Registered tools (`TOOLS` in `src/lib/canvas/tools.ts`): `Select` (`V`), `Pan` (`H`), `Text` (`T`), `Rectangle` (`R`), `Ellipse` (`O`), `Triangle` (`G`), `Line` (`L`), `Arrow` (`A`), `Draw` (`P`, normalized freehand path), `Paint` (`B`), `Eraser` (`E`), `Blur` (`U`), and `Eyedropper` (`I`).
  - Reserved raster pixel tools (`UNAVAILABLE_TOOLS`): `Pixel paint (unavailable)`, `Pixel eraser (unavailable)`, `Pixel blur (unavailable)`, and `Pixel eyedropper (unavailable)`, rendered disabled with explicit explanations.
- **Selection & Transform Handles**:
  - Single click selection, `Shift + click` additive/toggle multi-selection, and marquee drag selection on empty canvas.
  - 8 resize handles (`nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w`) keeping the opposite handle anchored in world space (even on rotated objects, with `Shift` aspect-ratio lock) plus 1 `rotate` handle arm (`Shift` 15° angle snapping).
- **Snapping**:
  - Center snapping, edge snapping, scene frame & safe area guide snapping, and optional grid snapping (`computeSnap` in `src/lib/canvas/snapping.ts`).
- **Keyboard & Persistence**:
  - `Arrow` = move by `1px`, `Shift + Arrow` = move by `10px`, `Delete` / `Backspace` = delete selection, `V` = select tool, `Ctrl/⌘ + D` = duplicate, `Ctrl/⌘ + Z` / `Ctrl/⌘ + Shift + Z` = undo / redo.
  - All scene objects render dynamically from `GameBlueprint` scene layout data (`scene.objects`, `scene.background`) and persist via `PUT /api/projects/[id]/canvas`.

### Explicitly Out of Scope
- Slot-game engine execution, reel spinning simulation, or win evaluation (belongs to SECTION 2).
- Raster pixel-level bitmap editing (`UNAVAILABLE_TOOLS` are explicitly marked unavailable).

## 3. Implementation Summary
- Implemented pure scene geometry (`src/lib/canvas/geometry.ts`), snapping & alignment (`src/lib/canvas/snapping.ts`), object creation (`src/lib/canvas/create.ts`), scene operations (`src/lib/canvas/operations.ts`), tool registry (`src/lib/canvas/tools.ts`), and strict payload validation (`src/lib/canvas/parse.ts`).
- Implemented client canvas editor state with drag-transaction undo/redo and debounced autosave (`src/lib/client/useCanvasEditor.ts`) and row-locked server persistence (`src/server/canvas-service.ts`).
- Implemented canvas UI components (`src/components/canvas/{CanvasApp,CanvasStage,CanvasTopBar,SceneObjectView,ScenePanel,ObjectInspector,LayersPanel}.tsx`) and route pages (`src/app/projects/[id]/canvas/page.tsx` and `src/app/project/[projectId]/canvas/page.tsx`).
- Updated `src/components/canvas/CanvasApp.tsx` and `src/components/canvas/ObjectInspector.tsx` so:
  - Both `LayersPanel` (`aria-label="Layers panel"`) and `ObjectInspector` (`aria-label="Object properties"`) are mounted and visible in the right-hand dock on desktop (`>= 1280px`) and toggleable as a responsive drawer below `1280px` (`Toggle inspector` / `Close properties`).
  - `ObjectInspector` exposes a `Scene Background` color picker when no object is selected.
- Updated `src/components/canvas/ScenePanel.tsx` so unlocked layers (`Reels`, `Frame`, `UI`, `FX`) appear first in `Layers Overview` ahead of the default-locked `Background` layer.
- Fixed React 19 ref-in-render lint issues in `src/components/canvas/CanvasStage.tsx` (`isPanning` state) and `src/components/canvas/CanvasApp.tsx` (`queueMicrotask` for `localStorage` hydration).

## 4. Files Created, Modified, or Deleted
- `src/lib/canvas/geometry.ts` *(Existing)* — Pure 2D transform math (`rotatePoint`, `aabbOf`, `objectContainsPoint`, `zoomViewport`, `fitViewport`, `handleWorld`, `rotateHandleWorld`, `resizeTransform`, `rotateAround`, `scaleTransforms`).
- `src/lib/canvas/snapping.ts` *(Existing)* — `computeSnap` (object edges/centers, canvas frame, safe area, grid) and `alignBoxes`.
- `src/lib/canvas/tools.ts` *(Existing)* — `TOOLS` (13 active vector/scene tools) and `UNAVAILABLE_TOOLS` (4 disabled raster pixel tools).
- `src/lib/canvas/create.ts` *(Modified)* — `newSceneObject`, `createTextObject`, `createShapeObject`, `createStrokeObject`, `createFreehandObject`, `createRefObject` with full default `transform`, `type`, and `blendMode` properties.
- `src/lib/canvas/operations.ts` *(Modified)* — Pure scene-layout operations (`moveObjects`, `applyTransforms`, `rotateObjects`, `scaleObjects`, `duplicateObjects`, `deleteObjects`, `alignObjects`, `distributeObjects`, `hitTestObjects`, `objectsInMarquee`, `nudgeDelta`) keeping `object.transform` synchronized.
- `src/lib/canvas/parse.ts` *(Modified)* — Strict validation of `SceneObject`, `SceneBackground`, and `LayerDef`.
- `src/lib/client/useCanvasEditor.ts` *(Existing)* — Undo/redo history (`apply`, `begin`, `preview`, `end`, `abandon`, `undo`, `redo`) and debounced autosave (`700ms`) to `PUT /api/projects/[id]/canvas`.
- `src/server/canvas-service.ts` *(Existing)* — Row-locked `saveScene()` with cross-reference validation against project layers, assets, symbols, and elements.
- `src/components/canvas/CanvasApp.tsx` *(Modified)* — Coordinates `ScenePanel`, `CanvasTopBar`, `CanvasStage`, `LayersPanel`, `ObjectInspector`, keyboard shortcuts, and responsive drawers.
- `src/components/canvas/CanvasStage.tsx` *(Modified)* — Interactive world-space scene surface, SVG selection/hover/guide overlay, 9 transform handles, marquee selection, and wheel/pointer handlers.
- `src/components/canvas/CanvasTopBar.tsx` *(Existing)* — History controls, save status badge, 17-button `Tools` toolbar, and viewport/overlay controls (`Zoom out`, `100%`, `Zoom in`, `Zoom to fit`, `Grid`/`No grid`, `Snap`, `Safe`).
- `src/components/canvas/SceneObjectView.tsx` *(Existing)* — Data-driven renderer for `shape`, `stroke`, `text`, `symbol`, `element`, and `image` objects.
- `src/components/canvas/ScenePanel.tsx` *(Modified)* — Scene switcher, `Layers Overview` (unlocked layers first), `Place on canvas` library picker, object list, and grid spacing/snap controls.
- `src/components/canvas/ObjectInspector.tsx` *(Modified)* — Selected object properties (`name`, `layer`, `visible`, `locked`, `X`, `Y`, `Width`, `Height`, `Rotation`, `Opacity`, `Blend Mode`, `Blur`, text/appearance fields, arrange/align/distribute, duplicate, delete) and `Scene Background` color configuration when nothing is selected.
- `src/app/project/[projectId]/canvas/page.tsx` *(Created)* — Route handler for `/project/[projectId]/canvas` matching `/projects/[id]/canvas`.
- `tests/canvas.test.ts` *(Modified)* — Added end-to-end F05 persistence test (`F05 acceptance: scene objects (select, move, resize, rotate, duplicate, delete, background) persist to GameBlueprint`); 13/13 tests pass.

## 5. Architecture and Dependencies
- **Coordinate Spaces**:
  - **World Space**: Scene coordinates (`0..scene.width` × `0..scene.height`, default `1920 × 1080`), independent of zoom or pan.
  - **Screen Space**: `screen = world * viewport.scale + viewport.pan`. Selection outlines, smart guides (`#f0b429`), and the 9 transform handles render in screen space so stroke widths and handle hit targets (`9px`) stay crisp at any zoom level.
- **Drag Transactions**:
  - `editor.begin(label)` captures the pre-drag snapshot once on `pointerdown`.
  - `editor.preview(fn)` computes transforms from the initial snapshot (`previewMove`, `previewResize`, `previewRotate`) on `pointermove` so repeated pointer events never compound rounding errors.
  - `editor.end()` commits a single undo entry on `pointerup`.

## 6. Data Flow and Persistence
1. Server route (`/projects/[id]/canvas` or `/project/[projectId]/canvas`) loads `project` via `getProject()` and passes `blueprint` + `revision` to `<CanvasApp />`.
2. User creates, places, selects, moves, resizes, rotates, duplicates, or deletes scene objects, or updates the scene background.
3. `useCanvasEditor` updates `present` (`{ objects, background, layers }`) and triggers `PUT /api/projects/[id]/canvas` after `700ms` (or immediately on `Ctrl/⌘ + S` / scene switch / tab hide).
4. `saveScene()` in `src/server/canvas-service.ts` validates the payload (`parseSceneDoc` + `validateScene` + `validateBlueprint`), checks `baseRevision` (returning `409` on conflict), updates `blueprint.scenes[i]` and `blueprint.layers`, increments `revision`, and writes to PostgreSQL / `LocalPgPool`.

## 7. Integration Points
- **F04 (Design View)**: Symbols and elements created in Design View appear in `ScenePanel` under `Place on canvas` and render live thumbnails/glyphs via `SceneObjectView`. Moreover, `sceneAssetIds()` ensures Design View never prunes artwork used on any scene.
- **F06 (Layers System)**: Shares `selection`, `content.objects`, and `content.layers` with `LayersPanel` and `ObjectInspector` in real time.
- **F07 (Asset Management)**: Assets assigned to scene objects or scene backgrounds from the Asset Library immediately render on the canvas.

## 8. Controls and Behaviors
- **Tools & Shortcuts**:
  - `V`: Select / Move / Resize / Rotate
  - `H` (or hold `Space`): Pan canvas
  - `T`: Text tool (click to place text)
  - `R`: Rectangle tool (drag to draw; `Shift` constrains square)
  - `O`: Ellipse tool (drag to draw; `Shift` constrains circle)
  - `G`: Triangle tool (drag to draw)
  - `L`: Line tool (drag to draw directional segment)
  - `A`: Arrow tool (drag to draw directional arrow)
  - `P`: Freehand Draw tool (drag to record normalized polyline path)
  - `B`: Paint tool (click object to apply current fill/stroke color)
  - `E`: Eraser tool (click/drag over objects to remove them)
  - `U`: Blur tool (click object to toggle 8px blur)
  - `I`: Eyedropper tool (click object or background to sample color)
- **Transform & Editing Shortcuts**:
  - `ArrowUp/Down/Left/Right`: Move selected objects by `1px`
  - `Shift + ArrowUp/Down/Left/Right`: Move selected objects by `10px`
  - `Delete` / `Backspace`: Delete selected objects
  - `Ctrl/⌘ + D`: Duplicate selection (`+24px` offset)
  - `Ctrl/⌘ + A`: Select all visible unlocked objects
  - `Ctrl/⌘ + G` / `Ctrl/⌘ + Shift + G`: Group / Ungroup selection
  - `Ctrl/⌘ + Z`: Undo
  - `Ctrl/⌘ + Shift + Z` / `Ctrl/⌘ + Y`: Redo
  - `+` / `=`: Zoom in, `-`: Zoom out, `0`: Reset zoom to 100%, `Shift + !`: Zoom to fit
  - `Alt` (during move/resize drag): Temporarily bypass snapping

## 9. Testing and Verification
- **Unit & Persistence Tests**:
  - Executed `npx tsx --test tests/canvas.test.ts` (13/13 tests pass: rotation/AABB math, opposite-handle anchored resize on rotated boxes, group rotation/scaling, cursor-anchored zoom, edge/center/frame/safe-area/grid snapping, move/resize/rotate/duplicate/delete/reorder/align/distribute, non-compounding drag previews, hit-testing & marquee selection, freehand path normalization, hostile input rejection, blueprint scene migration, tool registry completeness, and database persistence via `saveScene`).
- **Type Check & Lint**:
  - Executed `npm run typecheck` (0 errors) and `npx eslint src/components/canvas src/lib/canvas src/server/canvas-service.ts tests/canvas.test.ts` (0 errors).
- **Live HTTP Verification**:
  - Verified `GET /projects/prj_demo_roman_empire/canvas`, `GET /project/prj_demo_roman_empire/canvas`, `PUT /api/projects/<id>/canvas` (200 save + 409 stale revision conflict), and `GET /api/projects/<id>/export` on `http://localhost:3000`.

## 10. Known Issues and Limitations
- Raster pixel-level editing tools (`Pixel paint`, `Pixel eraser`, `Pixel blur`, `Pixel eyedropper`) are intentionally disabled with explanatory tooltips (`UNAVAILABLE_TOOLS`) because this phase operates on structured vector/scene objects rather than bitmap buffers.
- `tests/canvas.browser.mjs` is provided for external Playwright runners (`PLAYWRIGHT_MODULE`).

## 11. Requirements Status
| Requirement | Status | Evidence |
| --- | --- | --- |
| Pan, zoom, viewport controls (`-`, `100%`, `+`, `Fit`) | `PASS` | `src/lib/canvas/geometry.ts`, `src/components/canvas/{CanvasStage,CanvasTopBar}.tsx`, `tests/canvas.test.ts` |
| Single selection, Shift multi-selection, marquee drag selection, 9 transform handles | `PASS` | `src/components/canvas/CanvasStage.tsx`, `src/lib/canvas/operations.ts`, `tests/canvas.test.ts` |
| Move, resize, rotate, duplicate, delete | `PASS` | `src/lib/canvas/{geometry,operations}.ts`, `tests/canvas.test.ts` |
| Center, edge, guide (frame/safe area), and grid snapping + visual grid & safe area | `PASS` | `src/lib/canvas/snapping.ts`, `src/components/canvas/CanvasStage.tsx`, `tests/canvas.test.ts` |
| Configurable scene background & data-driven object rendering | `PASS` | `src/components/canvas/{SceneObjectView,ObjectInspector}.tsx`, `tests/canvas.test.ts` |
| Tool infrastructure (`Select`, `Pan`, `Paint`, `Eraser`, `Blur`, `Draw`, `Eyedropper`, `Text`, `Shapes`, `Lines/Arrows`) | `PASS` | `src/lib/canvas/tools.ts`, `src/components/canvas/CanvasTopBar.tsx`, `tests/canvas.test.ts` |
| Keyboard (`Arrow` 1px, `Shift+Arrow` 10px, `Delete`, `V` select, Undo/Redo) & `GameBlueprint` persistence | `PASS` | `src/components/canvas/CanvasApp.tsx`, `src/server/canvas-service.ts`, `tests/canvas.test.ts` |

## 12. Next Steps
- None required for F05; scene objects and layers integrate directly with F06 (Layers System) and F07 (Asset Management).

---

## 13. Backup Information
- **Google Drive Backup Root**: `Slot Studio Backups` (Folder ID: `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Category Folder**: `Slot Studio Backups/F - Frontend` (Folder ID: `1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Backup Folder**: `Slot Studio Backups/F - Frontend/F05` (Folder ID: `16eodGW1OZ9Wu9nnYfxJN6euSPKyyGcsX`)
- **Backup Timestamp (UTC)**: `2026-10-12T09:34:30Z`
- **Backup Status**: `SUCCESS`
