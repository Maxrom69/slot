# F18 — Animation System

## 1. Section ID and Name
- **Section ID**: `F18`
- **Section Name**: `Animation System`
- **Category**: `F - Frontend` (`SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`)

## 2. Objective and Scope
Build the frontend animation configuration layer (`F18`) for the Slots Studio Builder without generating animations with AI. Every element in the studio exposes a structured Animation Panel supporting `Animation Extra`, `Add Animation`, `Preview`, `Enable/Disable`, `Rename`, and `Delete`, interactive playback (`play`, `pause`, `restart`, `loop`), video and sprite-sheet configuration (`videoReference`, `spriteSheetReference`), serialization into `GameBlueprint.animations`, and placement of animations into scenes as standalone layers (`moveable`, `resizable`, `reorderable`, `visible/hidden`, `lockable`).

## 3. Requirements Covered and Explicit Exclusions
### Requirements Covered
- **Animation Model**: Each animation contains `id`, `elementId`, `name`, `source`, `format`, `duration`, `loop`, `fps`, `thumbnail`, `videoReference`, `spriteSheetReference`, and `state`.
- **Animation Types**: `Background`, `Symbol Win`, `Standalone`, `Hover`, `Custom`.
- **Animation Panel (for every element)**:
  - `Animation Extra`
  - `Add Animation`
  - `Preview`
  - `Enable/Disable`
  - `Rename`
  - `Delete`
- **Playback**: Supports `play`, `pause`, `restart`, and `loop` (plus timeline scrubbing and frame-by-frame progress calculation).
- **Standalone Animated Layers**: Animations can be added to a scene as their own layer (`kind: "animation"`, `refId`, `animationId`) and are `moveable`, `resizable`, `reorderable`, `visible/hidden`, and `lockable`.
- **Sprites**: Supports configuration for `video` (`VideoAnimationReference`) and `sprite sheet` (`SpriteSheetAnimationReference`, including deterministic frame rectangle slicing).
- **Acceptance**:
  - Animation references are serialized into `GameBlueprint`.
  - Animations can be placed into scenes as layers.

### Explicit Exclusions
- Does **not** generate animations or sprite sheets with AI or simulated AI workflows.
- Does **not** implement the Section 2 backend slot math/spin engine.

## 4. Implementation Summary
1. **Domain Model & Pure Operations (`src/lib/animations/{types,operations,index}.ts`)**:
   - Defined `AnimationModel` with all 12 required F18 fields (`id`, `elementId`, `name`, `source`, `format`, `duration`, `loop`, `fps`, `thumbnail`, `videoReference`, `spriteSheetReference`, `state`) plus `animationType` (`Background`, `Symbol Win`, `Standalone`, `Hover`, `Custom`), `animationExtra`, and `AnimationMeta` compatibility fields (`target`, `trigger`, `kind`, `durationMs`, `easing`).
   - Implemented pure element animation operations: `setElementAnimationExtra`, `addElementAnimation`, `renameElementAnimation`, `toggleElementAnimationState`, `updateElementAnimation`, `configureAnimationVideo`, `configureAnimationSpriteSheet`, `deleteElementAnimation`, `getElementAnimations`, `getAllAnimations`, `normalizeAnimationModel`, and `validateAnimationModel`.
   - Implemented pure playback state operations: `createAnimationPlaybackState`, `playAnimation`, `pauseAnimation`, `restartAnimation`, `setAnimationPlaybackLoop`, `seekAnimationPlayback`, `stepAnimationPlayback`, and `resolveSpriteFrameRect`.
   - Implemented standalone animated scene layer operations: `createStandaloneAnimationSceneObject`, `addAnimationLayerToScene`, `addAnimationLayerToDesignDoc`, `moveAnimationSceneLayer`, `resizeAnimationSceneLayer`, `reorderAnimationSceneLayer`, `setAnimationSceneLayerVisibility`, and `setAnimationSceneLayerLocked`.
2. **Blueprint & Design Schema / Validation / Parsing (`src/lib/blueprint/{types,validate}.ts`, `src/lib/design/{types,model,migrate,parse,operations}.ts`, `src/lib/canvas/parse.ts`, `src/server/canvas-service.ts`)**:
   - Extended `AnimationMeta`, `ElementDef` (`animationExtra`), and `SceneObject` (`kind: "animation"`, `animationId`) in `src/lib/blueprint/types.ts`.
   - Updated `parseDesignDoc` (`src/lib/design/parse.ts`) and `parseSceneDoc` (`src/lib/canvas/parse.ts`) to validate and preserve all F18 animation fields, `videoReference`, `spriteSheetReference`, `animationExtra`, and `"animation"` scene objects.
   - Updated `applyDesign` (`src/lib/design/migrate.ts`), `finalizeDoc` (`src/lib/design/model.ts`), `validateBlueprint` (`src/lib/blueprint/validate.ts`), and `saveScene` (`src/server/canvas-service.ts`) so animation assets are protected from pruning, standalone animated layers round-trip cleanly, and deleted/renamed animations synchronize with dependent scene layers.
3. **UI Components (`src/components/design/ElementAnimationPanel.tsx`, `src/components/design/ElementDetail.tsx`, `src/components/design/Inspector.tsx`, `src/components/canvas/{CanvasApp,ScenePanel,SceneObjectView,LayersPanel,ObjectInspector}.tsx`, `src/components/ui/Icon.tsx`)**:
   - Built `ElementAnimationPanel.tsx` providing `Animation Extra`, `Add Animation`, interactive `Preview` & Playback controls (`Play`, `Pause`, `Restart`, `Loop`, timeline scrubber, frame counter, sprite slice readout), per-animation `Rename`, `Enable/Disable`, `Delete`, `Add to Scene as Layer`, `Video Configuration`, and `Sprite Sheet Configuration`.
   - Integrated `ElementAnimationPanel` into `ElementDetail.tsx` and added an `Animation` summary section to `Inspector.tsx`.
   - Updated `ScenePanel.tsx`, `CanvasApp.tsx`, `SceneObjectView.tsx`, `LayersPanel.tsx`, and `ObjectInspector.tsx` so animations can be placed directly onto scenes as standalone animated layers and manipulated on the canvas and in the Layers panel.

## 5. Files Created, Modified, or Deleted
### Created
- `src/lib/animations/types.ts`
- `src/lib/animations/operations.ts`
- `src/lib/animations/index.ts`
- `src/components/design/ElementAnimationPanel.tsx`
- `tests/animations.test.ts`
- `docs/implementation/F18-animation-system.md`

### Modified
- `src/lib/blueprint/types.ts`
- `src/lib/blueprint/validate.ts`
- `src/lib/design/types.ts`
- `src/lib/design/model.ts`
- `src/lib/design/migrate.ts`
- `src/lib/design/parse.ts`
- `src/lib/design/operations.ts`
- `src/lib/canvas/parse.ts`
- `src/server/canvas-service.ts`
- `src/lib/preview/operations.ts`
- `src/components/ui/Icon.tsx`
- `src/components/design/ElementDetail.tsx`
- `src/components/design/Inspector.tsx`
- `src/components/canvas/SceneObjectView.tsx`
- `src/components/canvas/ScenePanel.tsx`
- `src/components/canvas/CanvasApp.tsx`
- `src/components/canvas/LayersPanel.tsx`
- `src/components/canvas/ObjectInspector.tsx`
- `docs/implementation/INDEX.md`
- `docs/backups/Backup-Manifest.md`

### Deleted
- None.

## 6. Architecture and Dependencies
- Pure TypeScript domain layer (`src/lib/animations/*`) with zero React/DOM dependencies so all animation model, playback, sprite slicing, and standalone scene layer operations are deterministically testable in Node.
- Reuses existing `src/lib/canvas/operations.ts` (`moveObjects`, `patchObject`, `reorderObjects`, `reorderLayerItem`) and `src/lib/design/model.ts` (`finalizeDoc`, `uniqueId`).
- No external npm dependencies added.

## 7. Relevant Components, Interfaces, Schemas, Stores, and APIs
- **Interfaces**: `AnimationModel`, `StudioAnimationType`, `AnimationSource`, `AnimationFormat`, `AnimationConfigState`, `VideoAnimationReference`, `SpriteSheetAnimationReference`, `AnimationPlaybackState`, `SpriteFrameRect`, `CreateAnimationInput`, `UpdateAnimationInput`, `StandaloneAnimationLayerInput`.
- **Operations**: `addElementAnimation`, `renameElementAnimation`, `toggleElementAnimationState`, `updateElementAnimation`, `deleteElementAnimation`, `setElementAnimationExtra`, `configureAnimationVideo`, `configureAnimationSpriteSheet`, `createAnimationPlaybackState`, `playAnimation`, `pauseAnimation`, `restartAnimation`, `setAnimationPlaybackLoop`, `seekAnimationPlayback`, `stepAnimationPlayback`, `resolveSpriteFrameRect`, `addAnimationLayerToScene`, `addAnimationLayerToDesignDoc`, `moveAnimationSceneLayer`, `resizeAnimationSceneLayer`, `reorderAnimationSceneLayer`, `setAnimationSceneLayerVisibility`, `setAnimationSceneLayerLocked`.
- **Components**: `ElementAnimationPanel`, `ElementDetail`, `Inspector`, `ScenePanel`, `CanvasApp`, `SceneObjectView`, `LayersPanel`, `ObjectInspector`.
- **APIs**: `PUT /api/projects/[id]/design` (`saveDesign`), `PUT /api/projects/[id]/canvas` (`saveScene`).

## 8. Data Flow and Persistence
1. User edits `Animation Extra` or adds/updates/renames/toggles/deletes an animation in `ElementAnimationPanel` (`ElementDetail.tsx`).
2. `onApply` commits the pure state transition through `useDesignEditor`, updating `DesignDoc.elements` and `DesignDoc.animations` with full undo/redo history and debounced persistence to `PUT /api/projects/[id]/design`.
3. `parseDesignDoc` validates all 12 F18 animation fields, `videoReference`, and `spriteSheetReference`, and `applyDesign` serializes them into `GameBlueprint.animations`.
4. When an animation is placed into a scene as a standalone layer (from `ElementAnimationPanel` or `ScenePanel` in `CanvasApp`), a `SceneObject` (`kind: "animation"`, `refId: anim.id`, `animationId: anim.id`) is added to `scene.objects` and persisted via `PUT /api/projects/[id]/canvas` (`saveScene`) and `GameBlueprint.scenes`.

## 9. Integration Points with Other Sections
- **F04 Design View & F11 Element Detail View**: `ElementDetail.tsx` and `Inspector.tsx` embed the F18 Animation Panel for every element.
- **F05 Canvas System & F06 Layers System**: Standalone animated layers (`kind: "animation"`) integrate with `CanvasApp`, `ScenePanel`, `SceneObjectView`, `LayersPanel`, and `ObjectInspector` as moveable, resizable, reorderable, visible/hidden, lockable layers.
- **F10 Asset Management**: `videoReference.assetId` and `spriteSheetReference.assetId` link to project assets and are protected from asset pruning in `finalizeDoc` and `sceneAssetIds`.
- **F17 Preview Controls**: `detectPreviewAnimationCapabilities` in `src/lib/preview/operations.ts` automatically detects F18 `Background`, `Symbol Win`, and `sprite_sheet` animations.

## 10. UI Controls, Keyboard Shortcuts, and Behaviors
- **Animation Panel (`ElementAnimationPanel.tsx`)**:
  - `Animation Extra`: Element-level textarea and per-animation input.
  - `Add Animation`: Name input, Animation Type selector (`Background`, `Symbol Win`, `Standalone`, `Hover`, `Custom`), Source selector (`preset`, `video`, `sprite_sheet`, `custom`), Format selector, Duration (ms), FPS, Loop checkbox, and `Add Animation` button.
  - `Preview & Playback Stage`: `Play`, `Pause`, `Restart`, `Loop` toggle, timeline scrubber, frame counter (`Frame X / Y`), sprite slice coordinate readout, and `Add to Scene as Layer` button.
  - `Configured Animations List`: Per-animation `Rename` input, `Preview` button, `Enable/Disable` toggle button, `Add Layer` button, `Delete` button, `Video Configuration` editor, and `Sprite Sheet Configuration` editor.
- **Canvas & Layers (`CanvasApp.tsx`, `LayersPanel.tsx`, `ObjectInspector.tsx`)**:
  - Place any animation onto the active scene under `Place on canvas -> Animations (Standalone Layers)`.
  - Move (drag / arrow nudge / X-Y inputs), resize (8 handles / W-H inputs), reorder (Layers panel drag-and-drop / Up-Down / Front-Back), toggle visibility (`Visible`), and toggle lock (`Lock`).

## 11. Tests, Typechecks, Builds Run and Actual Results
- `npm run typecheck`: **PASS** (`tsc --noEmit` exited with `0` errors).
- `npx tsx --test tests/*.test.ts`: **PASS** (`137/137` tests passing across all 18 test suites, `0` failures, including all 6 subtests in `tests/animations.test.ts`).

## 12. Requirement-by-Requirement Status Table
| Requirement | Status | Verification Evidence |
| --- | --- | --- |
| Animation Model (`id`, `elementId`, `name`, `source`, `format`, `duration`, `loop`, `fps`, `thumbnail`, `videoReference`, `spriteSheetReference`, `state`) | `PASS` | `src/lib/animations/types.ts`, `src/lib/animations/operations.ts`, `tests/animations.test.ts` (Subtest 1) |
| Animation Types (`Background`, `Symbol Win`, `Standalone`, `Hover`, `Custom`) | `PASS` | `STUDIO_ANIMATION_TYPES` in `src/lib/animations/types.ts`, `tests/animations.test.ts` (Subtest 1) |
| Animation Panel for every element (`Animation Extra`, `Add Animation`, `Preview`, `Enable/Disable`, `Rename`, `Delete`) | `PASS` | `src/components/design/ElementAnimationPanel.tsx`, `src/components/design/ElementDetail.tsx`, `tests/animations.test.ts` (Subtest 2) |
| Playback (`play`, `pause`, `restart`, `loop`) | `PASS` | `playAnimation`, `pauseAnimation`, `restartAnimation`, `setAnimationPlaybackLoop`, `stepAnimationPlayback`, `tests/animations.test.ts` (Subtest 3) |
| Sprites (`video` and `sprite sheet` configuration; no AI sprite generation) | `PASS` | `configureAnimationVideo`, `configureAnimationSpriteSheet`, `resolveSpriteFrameRect`, `tests/animations.test.ts` (Subtest 4) |
| Standalone Animated Layers (`moveable`, `resizable`, `reorderable`, `visible/hidden`, `lockable`) | `PASS` | `addAnimationLayerToScene`, `moveAnimationSceneLayer`, `resizeAnimationSceneLayer`, `reorderAnimationSceneLayer`, `setAnimationSceneLayerVisibility`, `setAnimationSceneLayerLocked`, `tests/animations.test.ts` (Subtest 5) |
| Acceptance: Animation references serialized into `GameBlueprint` & animations placed into scenes as layers | `PASS` | `parseDesignDoc`, `parseSceneDoc`, `applyDesign`, `validateBlueprint`, `tests/animations.test.ts` (Subtest 6) |

## 13. Known Issues and Limitations
- Sprite sheet generation is intentionally not automated or AI-generated per the F18 specification; users configure sprite sheet grid parameters (`columns`, `rows`, `frameWidth`, `frameHeight`, `frameCount`, `spacing`, `margin`) and bind uploaded assets or URIs.

## 14. Remaining Work and Recommended Next Steps
- Proceed to the next section (`F19` / Export or Math / Feature configuration as directed by the user).

## 15. Google Drive Backup Location and Verification Status
- **Section Folder**: `Slot Studio Backups/F - Frontend/F18/` (`1vzVNqpf7pAd3PrvH43n2o2lLfKgPSl2c`)
- **Summary Mirror**: `Slot Studio Backups/F - Frontend/F18-animation-system.md` (`10QBLvewdeE7QzeFUpeH1xIAPmlDqSIvo`) and `Slot Studio Backups/F - Frontend/F18/docs/implementation/F18-animation-system.md` (`1PbyfCNYbAvH6h8ek28LuaqGuAay1_IWw`)
- **Verification**: `SUCCESS` (`VERIFIED` — all 26 created and modified files for `F18` uploaded and verified by file ID, parent folder ID, MD5 checksum, and exact byte size in `docs/backups/Backup-Manifest.md`).

## 16. Last Update Date
- `2026-10-12`
