# F19 — Scenes and Layout Composition

## 1. Section Identifier and Name
- **Section ID**: `F19`
- **Section Name**: `Scenes and Layout Composition`
- **Category**: `SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`

---

## 2. Objective and Scope
Build the multi-scene composition system for Slot Studio (`F19`), supporting up to 3 independent scenes (`Scene 1`, `Scene 2`, `Scene 3`) with per-scene layout configuration (`id`, `name`, `canvas configuration`, `background`, `layers`, `visibility`, `composed images`, `layout metadata`), global shared game configuration (`reels`, `math configuration`, `symbol definitions`), scene selector cards placed directly near the preview and composition canvases, active scene highlighting, `Rename` (maximum 18 characters), `Duplicate`, `Delete`, and `Add Scene` actions, independent per-scene unsaved state tracking, an unsaved changes prompt (`Save`, `Discard`, `Cancel`) when switching scenes with unsaved edits, and active-scene-only layout saving (`Save Layout`).

---

## 3. Requirements Covered and Exclusions
### Requirements Covered
- **Scene Limit (Up to 3 Scenes)**:
  - Enforces `MIN_SCENES = 1` and `MAX_SCENES = 3` across domain state, blueprint helpers, canvas payload parsing (`parseSceneDoc`), and blueprint structural validation (`validateBlueprint`).
  - Each scene contains:
    - `id`
    - `name` (enforced `1..18` characters via `MAX_SCENE_NAME_LENGTH = 18`)
    - `canvasConfiguration` (`width`, `height`, `safeArea`, `orientation`, `gridVisible`, `gridSize`, `snapToGrid`)
    - `background` (`color`, `assetId`, `imageUri`, `fit`)
    - `layers` (`LayerDef[]`)
    - `visibility` (`sceneVisible`, per-layer `layers` map, per-object `objects` map)
    - `composedImages` (`SceneComposedImageRef[]`)
    - `layoutMetadata` (`slotIndex`, `slotLabel`, `activeLayerId`, `zoom`, `panX`, `panY`, `snapEnabled`, `guidesVisible`, `safeAreaVisible`, `updatedAt`, `notes`)
- **Shared Globally**:
  - `reels` (`reels`, `reelConfiguration`)
  - `math configuration` (`math`)
  - `symbol definitions` (`symbols`, `symbolSets`, `specialSymbols`, `paylines`, `paytable`)
- **Scene Selector**:
  - Scene cards (`Scene 1`, `Scene 2`, `Scene 3`) placed directly near the preview canvas (`PreviewWorkspace.tsx`) and composition canvas (`CanvasApp.tsx`).
- **Active Scene Highlight**:
  - Clearly highlights the active scene card with an `Active` badge, accent border/glow, and `data-active="true"`.
- **Scene Actions**:
  - `Rename` (enforces maximum 18 characters with live `N/18` counter and validation error feedback)
  - `Duplicate` (deep-clones the scene's independent layout with new object IDs and a unique name `<= 18` characters, up to 3 scenes)
  - `Delete` (deletes a scene and reindexes slot labels while protecting the last remaining scene)
  - `Add Scene` (adds a new scene up to the 3-scene limit)
- **Unsaved Changes Workflow**:
  - Tracks unsaved state (`isDirty`, `saved` snapshot vs. `draft` snapshot) independently per scene.
  - Switching away from a scene with unsaved changes opens the Unsaved Layout Changes modal with `Save`, `Discard`, and `Cancel`.
- **Save Layout**:
  - `Save Layout` (`saveActiveSceneLayout`) saves **only** the active scene's layout changes into `GameBlueprint.scenes` while leaving any unsaved draft changes on non-active scenes untouched in memory and preserving shared global configuration.
- **Independent Per-Scene Layout Storage**:
  - Each scene stores independently:
    - `positions` (`x`, `y` on objects and composed images)
    - `sizes` (`width`, `height` on objects, composed images, and canvas configuration)
    - `rotation` (`rotation` degrees on objects and composed images)
    - `layer order` (`layers` order and `objects` stacking order)
    - `visibility` (scene, layer, and object visibility flags)
    - `background selection` (`color`, `assetId`, `imageUri`, `fit`)
    - `composed image references` (`composedImages`)

### Explicit Exclusions
- No fake backend slot-game RNG execution or math simulation (`SECTION 2 — BACKEND / SLOT GAME ENGINE`).
- No AI generation, LLM APIs, or simulated AI workflows.

---

## 4. Implementation Summary
1. Created the `src/lib/scenes/` domain module (`types.ts`, `operations.ts`, `index.ts`) implementing `SceneModel`, `SceneCanvasConfiguration`, `SceneVisibilityState`, `SceneComposedImageRef`, `SceneLayoutMetadata`, `SceneSharedGlobalConfig`, `SceneLayoutSnapshot`, `PerSceneDraftRecord`, `PendingSceneSwitchPrompt`, `SceneSelectorCardModel`, and `SceneCompositionWorkspaceState`, along with pure operations for scene normalization, 18-character name validation, `Add Scene`, `Duplicate`, `Rename`, `Delete`, independent per-scene layout mutations (`positions`, `sizes`, `rotation`, `layer order`, `visibility`, `background selection`, `composed image references`), per-scene dirty tracking, `requestSceneSwitch` / `resolveUnsavedSceneSwitch` (`Save`, `Discard`, `Cancel`), and `saveActiveSceneLayout`.
2. Extended `src/lib/blueprint/types.ts` (`SceneDef`, `SceneBackground`, `SceneCanvasConfiguration`, `SceneVisibilityState`, `SceneComposedImageRef`, `SceneLayoutMetadata`), `src/lib/blueprint/validate.ts` (1–3 scenes, scene names `<= 18` chars, custom scene layers), `src/lib/design/migrate.ts` (`sceneAssetIds` protection for `composedImages`), `src/lib/canvas/parse.ts` (`parseSceneDoc`, `parseSceneEntry`, `parseCanvasConfiguration`, `parseVisibility`, `parseComposedImage`, `parseLayoutMetadata`), `src/server/canvas-service.ts` (`saveScene` multi-scene and F19 layout persistence), `src/lib/client/design-api.ts`, `src/lib/client/useCanvasEditor.ts`, and `src/lib/preview/operations.ts` (`buildPreviewPresentation` scene-specific layers, visibility, background, and canvas configuration).
3. Built `src/components/canvas/SceneSelectorCards.tsx` and integrated it directly near the preview canvas in `src/components/studio/PreviewWorkspace.tsx` and near the composition canvas in `src/components/canvas/CanvasApp.tsx`.
4. Added comprehensive automated tests in `tests/scenes.test.ts` covering all 7 F19 verification areas.

---

## 5. Files Created, Modified, or Deleted
### Created
- `src/lib/scenes/types.ts`
- `src/lib/scenes/operations.ts`
- `src/lib/scenes/index.ts`
- `src/components/canvas/SceneSelectorCards.tsx`
- `tests/scenes.test.ts`
- `docs/implementation/F19-scenes-and-layout-composition.md`

### Modified
- `src/lib/blueprint/types.ts`
- `src/lib/blueprint/validate.ts`
- `src/lib/canvas/parse.ts`
- `src/lib/client/design-api.ts`
- `src/lib/client/useCanvasEditor.ts`
- `src/lib/design/migrate.ts`
- `src/lib/preview/operations.ts`
- `src/server/canvas-service.ts`
- `src/components/canvas/CanvasApp.tsx`
- `src/components/studio/PreviewWorkspace.tsx`
- `docs/implementation/INDEX.md`
- `docs/backups/Backup-Manifest.md`

### Deleted
- None

---

## 6. Architecture and Dependencies
- Pure TypeScript functional domain layer (`src/lib/scenes/*`) decoupled from React UI components.
- Uses existing `@/lib/canvas/operations` (`duplicateObjects`, `reorderBlueprintLayers`, `reorderObjects`) and `@/lib/blueprint/*` types.
- Zero new third-party NPM dependencies added.

---

## 7. Relevant Components, Interfaces, Schemas, Stores, and APIs
- **Domain Interfaces (`src/lib/scenes/types.ts` & `src/lib/blueprint/types.ts`)**:
  - `SceneModel`, `SceneDef`, `SceneCanvasConfiguration`, `SceneVisibilityState`, `SceneComposedImageRef`, `SceneLayoutMetadata`, `SceneSharedGlobalConfig`, `SceneLayoutSnapshot`, `PerSceneDraftRecord`, `PendingSceneSwitchPrompt`, `SceneSelectorCardModel`, `SceneCompositionWorkspaceState`.
- **Pure Operations (`src/lib/scenes/operations.ts`)**:
  - `validateSceneName`, `sanitizeSceneName`, `uniqueSceneName`, `normalizeSceneModel`, `sceneModelToSceneDef`, `extractSharedGlobalConfig`, `createSceneCompositionState`, `buildSceneSelectorCards`, `addSceneToState`, `addSceneToBlueprint`, `duplicateSceneInState`, `duplicateSceneInBlueprint`, `renameSceneInState`, `renameSceneInBlueprint`, `deleteSceneFromState`, `deleteSceneFromBlueprint`, `updateSceneLayoutDraft`, `setSceneObjectPosition`, `setSceneObjectSize`, `setSceneObjectRotation`, `reorderSceneLayers`, `reorderSceneObjects`, `setSceneLayerVisibility`, `setSceneObjectVisibility`, `setSceneBackgroundSelection`, `upsertSceneComposedImage`, `removeSceneComposedImage`, `setSceneCanvasConfiguration`, `setSceneLayoutMetadata`, `saveActiveSceneLayout`, `discardSceneChanges`, `requestSceneSwitch`, `resolveUnsavedSceneSwitch`.
- **UI Components**:
  - `SceneSelectorCards` (`src/components/canvas/SceneSelectorCards.tsx`)
  - `CanvasApp` (`src/components/canvas/CanvasApp.tsx`)
  - `PreviewWorkspace` (`src/components/studio/PreviewWorkspace.tsx`)
- **Server Persistence**:
  - `PUT /api/projects/[id]/canvas` -> `saveScene` (`src/server/canvas-service.ts`) & `parseSceneDoc` (`src/lib/canvas/parse.ts`).

---

## 8. Data Flow and Persistence Behavior
1. On workspace initialization (`CanvasApp` or `PreviewWorkspace`), `createSceneCompositionState(blueprint)` normalizes up to 3 scenes into `SceneModel` instances and creates independent `saved` and `draft` `SceneLayoutSnapshot` records in `draftsBySceneId`.
2. Layout edits (`positions`, `sizes`, `rotation`, `layer order`, `visibility`, `background selection`, `composed image references`) mutate only the target scene's `draft` snapshot and recompute `isDirty = !areSceneLayoutsEqual(saved, draft)` for that scene alone.
3. Clicking `Save Layout` calls `saveActiveSceneLayout(state, blueprint)`, which commits only the active scene's `draft` into its `saved` snapshot and updates only the active scene in `blueprint.scenes` (persisted via `PUT /api/projects/[id]/canvas`), while keeping any non-active scene's unsaved draft untouched and preserving shared global `reels`, `math`, and `symbols`.
4. Switching away from a scene where `isDirty === true` sets `pendingSceneSwitch` and displays the modal offering `Save` (saves active scene layout and switches), `Discard` (reverts active scene draft to saved and switches), or `Cancel` (aborts switch and stays on current scene).

---

## 9. Integration Points with Other Sections
- **F05 Canvas System & F06 Layers System**: `CanvasApp` integrates `SceneSelectorCards` above the stage and scopes object transforms, background selection, and layer ordering/visibility per scene.
- **F10 Asset Management & F04 Design View**: `sceneAssetIds` in `src/lib/design/migrate.ts` protects assets referenced by `scene.background` and `scene.composedImages` across all scenes.
- **F14 Reel Editor, F15 Payline Editor, F16 Paytable Editor**: `reels`, `reelConfiguration`, `math`, `symbols`, `paylines`, and `paytable` are shared globally (`SceneSharedGlobalConfig`) and remain invariant across scene switches and layout saves.
- **F17 Preview Controls & F18 Animation System**: `PreviewWorkspace` renders `SceneSelectorCards` directly near the preview canvas and `buildPreviewPresentation` resolves per-scene `layers`, `visibility`, `background`, `canvasConfiguration`, and animated scene objects.

---

## 10. User-Facing Controls, Shortcuts, and Behaviors
- **Scene Selector Bar (`data-testid="scene-selector-bar"`)**:
  - Displays `Scene 1`, `Scene 2`, and `Scene 3` cards (`data-testid="scene-card-1..3"` or `scene-card-slot-1..3`), active badge, per-scene `Saved` / `Unsaved` badge, background color swatch, and object/layer/composed-image counts.
  - `Add Scene` button (`data-testid="scene-add-button"`) and empty slot `+ Add Scene N` buttons (`disabled` when 3 scenes exist).
  - `Save Layout` button (`data-testid="scene-save-layout-button"`) saving only the active scene's layout changes.
  - Per-card `Rename` button (`data-testid="scene-rename-btn-1..3"`) opening inline input (`maxLength={18}`, `Enter` to commit, `Escape` to cancel), `Duplicate` button (`data-testid="scene-duplicate-btn-1..3"`), and `Delete` button (`data-testid="scene-delete-btn-1..3"`).
  - Unsaved Layout Changes modal (`data-testid="unsaved-scene-switch-modal"`) with `Save` (`unsaved-switch-save`), `Discard` (`unsaved-switch-discard`), and `Cancel` (`unsaved-switch-cancel`).

---

## 11. Tests, Typechecks, and Builds Run + Actual Results
- `npm run typecheck`:
  - **Result**: `PASS` (`tsc --noEmit` completed with `0` errors).
- `npx tsx --test tests/*.test.ts`:
  - **Result**: `PASS` (`144/144` tests passing across all 19 test suites, `0` failures, including all 7 subtests in `tests/scenes.test.ts`).

---

## 12. Requirement-by-Requirement Verification Table
| Requirement | Status | Verification Evidence |
|---|---|---|
| Support up to 3 scenes (`Scene 1`, `Scene 2`, `Scene 3`) | `PASS` | `MAX_SCENES = 3` enforced in `src/lib/scenes/operations.ts`, `parseSceneDoc`, and `validateBlueprint`; verified in `tests/scenes.test.ts` subtest 1. |
| Per-scene `id`, `name`, `canvas configuration`, `background`, `layers`, `visibility`, `composed images`, `layout metadata` | `PASS` | `SceneModel` & `SceneDef` in `src/lib/scenes/types.ts` and `src/lib/blueprint/types.ts`; verified in `tests/scenes.test.ts` subtests 1, 4, 7. |
| Shared globally: `reels`, `math configuration`, `symbol definitions` | `PASS` | `extractSharedGlobalConfig` & `saveActiveSceneLayout`; verified in `tests/scenes.test.ts` subtests 1, 6, 7. |
| Scene Selector cards placed near the preview canvas showing `Scene 1`, `Scene 2`, `Scene 3` | `PASS` | `SceneSelectorCards` mounted in `PreviewWorkspace.tsx` and `CanvasApp.tsx`; verified in `tests/scenes.test.ts` subtest 2. |
| Active Scene highlighted clearly | `PASS` | `card.active` state, `Active` badge, accent border/glow in `SceneSelectorCards.tsx`; verified in `tests/scenes.test.ts` subtest 2. |
| Actions: `Rename` (max 18 chars), `Duplicate`, `Delete`, `Add Scene` | `PASS` | `MAX_SCENE_NAME_LENGTH = 18` enforced in `validateSceneName`, `renameSceneInState`, `parseSceneDoc`, `validateBlueprint`; verified in `tests/scenes.test.ts` subtest 3. |
| Unsaved Changes when switching scenes: `Save`, `Discard`, `Cancel` | `PASS` | `requestSceneSwitch` & `resolveUnsavedSceneSwitch` + modal in `SceneSelectorCards.tsx`; verified in `tests/scenes.test.ts` subtest 5. |
| `Save Layout` only saves the active scene's layout changes | `PASS` | `saveActiveSceneLayout` in `src/lib/scenes/operations.ts`; verified in `tests/scenes.test.ts` subtest 6. |
| Independent layout storage per scene (`positions`, `sizes`, `rotation`, `layer order`, `visibility`, `background selection`, `composed image references`) | `PASS` | Per-scene snapshots & layout mutators in `src/lib/scenes/operations.ts`; verified in `tests/scenes.test.ts` subtest 4. |
| Acceptance: Switching scenes changes visual composition while preserving shared config; unsaved state tracked independently per scene | `PASS` | Verified end-to-end in `tests/scenes.test.ts` subtests 5, 6, and 7. |

---

## 13. Known Issues and Limitations
- None. All F19 requirements and acceptance criteria are implemented and verified.

---

## 14. Remaining Work / Recommended Next Steps
- Proceed to the next scheduled frontend builder section (`F20+`) while preserving the multi-scene layout composition contract in `GameBlueprint.scenes`.

---

## 15. Google Drive Backup Location and Backup Verification Status
- **Google Drive Backup Folder**: `Slot Studio Backups/F - Frontend/F19/` (`1BqYzhdZlskmXFXs8SfatYSZxXCGe1lX9`)
- **Backup Verification Status**: Verified incremental upload of all 18 created/modified F19 files with matching relative paths, file IDs, and byte sizes in `docs/backups/Backup-Manifest.md`.

---

## 16. Last Update Date
- `2026-10-12`
