# F06 — Layers System

## 1. Section ID and Name
- **Section ID**: `F06`
- **Section Name**: `LAYERS SYSTEM`
- **Purpose**: Provide a professional right-side layer hierarchy (`src/components/canvas/LayersPanel.tsx`) synchronized in real time with the Canvas, Inspector, and `GameBlueprint`, supporting Top = Foreground / Bottom = Background ordering, drag-and-drop and step reordering, Shift-click multi-selection, collapsible groups (`Create Group`, `Ungroup`, `Rename Group`, `Move Group`, `Duplicate Group`, `Delete Group`), a default-locked Background layer, and full 10-property layer state persistence.

## 2. Objective and Scope
### Intended Scope
- **Right-Side Layers Panel (`LayersPanel`)**:
  - Each layer row displays: `thumbnail`, `name` (with double-click inline rename), `visibility` toggle, `lock state` toggle, `selection state` (`aria-selected`), `drag handle`, `expand/collapse` chevron (for groups), `duplicate` action, and `delete` action.
- **Ordering & Reordering**:
  - Ordered **Top = Foreground** to **Bottom = Background**.
  - Supports HTML5 drag-and-drop reordering and explicit **Move layer up (foreground)** / **Move layer down (background)** buttons.
- **Multi-Selection**:
  - `Shift + click` adds or removes rows from the current selection.
- **Groups**:
  - Supports `Create Group`, `Ungroup`, `Rename Group`, `Move Group` (moves group container and all child objects together), `Duplicate Group` (clones group container and all children with new IDs), and `Delete Group` (removes group container and all children).
  - Grouped items appear nested under a collapsible group row.
- **Background Default Lock**:
  - The blueprint `Background` layer (`layer-bg`) defaults to `locked: true`.
- **Persisted Layer States**:
  - Stores `id`, `type`, `name`, `visible`, `locked`, `opacity`, `blendMode`, `transform`, `parentId`, and `groupId` in `GameBlueprint`.

### Explicitly Out of Scope
- Slot-game engine runtime layer animation playback (belongs to SECTION 2).

## 3. Implementation Summary
- Implemented `src/components/canvas/LayersPanel.tsx` (`role="complementary" aria-label="Layers panel"`) rendering the scene hierarchy in Top = Foreground / Bottom = Background order with live thumbnails, inline renaming (`CommitInput`), visibility/lock toggles, per-row and toolbar duplicate/delete buttons, group/ungroup buttons, up/down reorder buttons, and search filter.
- Implemented group and hierarchy operations in `src/lib/canvas/operations.ts` (`createGroup`, `ungroup`, `renameGroup`, `duplicateGroup`, `deleteGroup`, `toggleGroupExpand`, `expandGroupIds`, `reorderLayerItem`, `moveLayerItemToIndex`, `reorderBlueprintLayers`, `toggleLayer`).
- Updated `src/components/canvas/LayersPanel.tsx` so each row includes per-row `Duplicate <name>` and `Delete <name>` buttons in addition to the toolbar actions, replaced `draggedIdRef` with React state (`draggedId`) for React 19 lint compliance, and mapped visual Top-to-Bottom drop positions (`before`/`after`) to foreground/background array indices.
- Updated `src/lib/canvas/create.ts`, `src/lib/canvas/operations.ts`, and `src/lib/canvas/parse.ts` so every `SceneObject` always populates and synchronizes all 10 required layer state properties (`id`, `type`, `name`, `visible`, `locked`, `opacity`, `blendMode`, `transform`, `parentId`, `groupId`).
- Verified that `layer-bg` defaults to `locked: true` in `src/lib/blueprint/factory.ts`.

## 4. Files Created, Modified, or Deleted
- `src/components/canvas/LayersPanel.tsx` *(Modified)* — Right-side Layers Panel with Top = Foreground / Bottom = Background tree, per-row thumbnail/name/visibility/lock/selection/drag-handle/expand-collapse/duplicate/delete controls, toolbar group/ungroup/move-up/move-down/duplicate/delete buttons, and name filter.
- `src/components/canvas/CanvasApp.tsx` *(Modified)* — Wires `LayersPanelActions` (`onSelect`, `onToggleVisible`, `onToggleLock`, `onRename`, `onDuplicate`, `onDelete`, `onReorder`, `onMoveStep`, `onCreateGroup`, `onUngroup`, `onToggleExpand`, `onToggleLayerVisible`, `onToggleLayerLock`, `onReorderLayer`) and keyboard shortcuts (`Ctrl/⌘ + G`, `Ctrl/⌘ + Shift + G`) to `useCanvasEditor`.
- `src/components/canvas/ObjectInspector.tsx` *(Modified)* — Displays group container details (`Group Container (N items)`, `Ungroup` button), child membership banner (`Part of <Group>`, `Select group`, `Ungroup`), and `Blend Mode` selector (`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`).
- `src/lib/canvas/operations.ts` *(Modified)* — Group lifecycle functions (`createGroup`, `ungroup`, `renameGroup`, `duplicateGroup`, `deleteGroup`, `toggleGroupExpand`), hierarchy reordering (`reorderLayerItem`, `moveLayerItemToIndex`, `reorderBlueprintLayers`), and automatic `transform` synchronization on move/resize/rotate/patch.
- `src/lib/canvas/create.ts` *(Modified)* — Populates default `type`, `blendMode`, `parentId`, `groupId`, `expanded`, and `transform` on `newSceneObject`.
- `src/lib/canvas/parse.ts` *(Modified)* — Validates and preserves `type`, `blendMode`, `transform`, `parentId`, `groupId`, and `expanded` on both `SceneObject` (`parseObject`) and `LayerDef` (`parseLayer`).
- `src/lib/blueprint/factory.ts` *(Existing)* — Sets `locked: true` on the default `layer-bg` (`Background`) layer.
- `tests/layers.test.ts` *(Modified)* — Added end-to-end F06 persistence test (`F06 acceptance: layer hierarchy, groups, ordering, and all 10 layer states persist to GameBlueprint across refresh`); 14/14 tests pass.

## 5. Architecture and Dependencies
- **Hierarchy Model**:
  - Blueprint layers (`LayerDef[]`) define coarse z-buckets (`layer-bg` order 0, `layer-reels` order 1, `layer-frame` order 2, `layer-ui` order 3, `layer-fx` order 4).
  - Scene objects (`SceneObject[]`) belong to a `layerId` and optionally to a group container (`kind: "group"`, referenced by children via `groupId` and `parentId`).
  - `LayersPanel` sorts `layers` descending by `order` and reverses root objects within each layer so the top row in the panel corresponds to the front-most rendered object on the canvas.
- **Group Propagation**:
  - `expandGroupIds(objects, ids)` expands any selected group ID to include all of its children, so moving, rotating, scaling, aligning, duplicating, or deleting a group automatically transforms or removes all member objects together.
  - Toggling `visible` or `locked` on a group via `patchObject` propagates the visibility or lock state to all children of that group.

## 6. Data Flow and Persistence
1. User interacts with `LayersPanel` (clicking a row, Shift-clicking to multi-select, toggling eye/lock, dragging to reorder, clicking Move Up/Down, or clicking `Group`/`Ungroup`).
2. `CanvasApp` updates shared `selection` state and applies pure operations to `useCanvasEditor` (`content.objects` and `content.layers`).
3. Canvas (`CanvasStage`) and Inspector (`ObjectInspector`) re-render immediately from the shared `content` and `selection` state.
4. `useCanvasEditor` debounces (`700ms`) and sends `PUT /api/projects/[id]/canvas` with `{ baseRevision, sceneId, objects, background, layers }`.
5. `saveScene()` in `src/server/canvas-service.ts` validates and persists the updated `objects` and `layers` into `GameBlueprint`.

## 7. Integration Points
- **F05 (Canvas System)**: Selecting, hiding, locking, grouping, or reordering layers in `LayersPanel` immediately updates `CanvasStage` rendering, hit-testing, and transform handles.
- **F01 (`GameBlueprint`)**: All layer and group fields serialize directly into `blueprint.scenes[i].objects` and `blueprint.layers`.

## 8. Controls and Behaviors
- **Layer Row Controls**:
  - Click row: Select single layer/group.
  - `Shift + Click` row: Add/remove layer in multi-selection.
  - Double-click row name: Inline rename (`Enter` commits, `Escape` cancels).
  - Chevron button (on group rows): `Collapse <Group>` / `Expand <Group>`.
  - Eye button: `Hide <name>` / `Show <name>`.
  - Lock button: `Lock <name>` / `Unlock <name>`.
  - Copy button: `Duplicate <name>`.
  - Trash button: `Delete <name>`.
  - Drag handle: Drag and drop before/after another row to reorder.
- **Panel Toolbar Controls**:
  - `Group` (`Ctrl/⌘ + G`): Wraps selected objects in a new collapsible group container.
  - `Ungroup` (`Ctrl/⌘ + Shift + G`): Dissolves selected group container(s) and releases child objects.
  - `Move layer up (foreground)` (`↑`): Moves selected item towards foreground.
  - `Move layer down (background)` (`↓`): Moves selected item towards background.
  - `Duplicate selected layer`: Duplicates current selection.
  - `Delete selected layer`: Deletes current selection.
  - `Filter layers`: Filters displayed rows by name or kind.

## 9. Testing and Verification
- **Unit & Persistence Tests**:
  - Executed `npx tsx --test tests/layers.test.ts` (14/14 tests pass: `createGroup`, `ungroup`, `renameGroup`, `duplicateGroup`, `deleteGroup`, `toggleGroupExpand`, `moveObjects` on groups, `reorderLayerItem` up/down/top/bottom, `moveLayerItemToIndex`, `reorderBlueprintLayers`, `toggleLayer`, default `layer-bg` locked state, parsing of all 10 layer state fields, and end-to-end `saveScene`/`getProject` persistence).
- **Type Check & Lint**:
  - Executed `npm run typecheck` (0 errors) and `npx eslint src/components/canvas/LayersPanel.tsx src/components/canvas/CanvasApp.tsx src/lib/canvas/operations.ts src/lib/canvas/parse.ts tests/layers.test.ts` (0 errors).
- **Live HTTP Verification**:
  - Verified `/projects/prj_demo_roman_empire/canvas` and `/project/prj_demo_roman_empire/canvas` render the `Layers panel` landmark, toolbar controls, and synchronized `Object properties` inspector.

## 10. Known Issues and Limitations
- Currently, groups are single-level containers (`depth: 0` group containing `depth: 1` children); ungrouping releases children back to root level on their layer.
- `tests/layers.browser.mjs` is provided for external Playwright runners (`PLAYWRIGHT_MODULE`).

## 11. Requirements Status
| Requirement | Status | Evidence |
| --- | --- | --- |
| Right-side Layers Panel with thumbnail, name, visibility, lock, selection, drag handle, expand/collapse, duplicate, delete | `PASS` | `src/components/canvas/LayersPanel.tsx`, `tests/layers.test.ts` |
| Order: Top = foreground, Bottom = background | `PASS` | `src/components/canvas/LayersPanel.tsx`, `src/lib/canvas/operations.ts`, `tests/layers.test.ts` |
| Drag-and-drop reorder & explicit Move Up / Move Down actions | `PASS` | `src/components/canvas/LayersPanel.tsx`, `src/lib/canvas/operations.ts`, `tests/layers.test.ts` |
| `Shift + click` multi-selection | `PASS` | `src/components/canvas/LayersPanel.tsx` |
| Groups: Create, Ungroup, Rename, Move, Duplicate, Delete under collapsible group row | `PASS` | `src/lib/canvas/operations.ts`, `src/components/canvas/LayersPanel.tsx`, `tests/layers.test.ts` |
| Background layer defaults to locked (`locked: true`) | `PASS` | `src/lib/blueprint/factory.ts`, `tests/layers.test.ts` |
| Store `id`, `type`, `name`, `visible`, `locked`, `opacity`, `blendMode`, `transform`, `parentId`, `groupId` in `GameBlueprint` | `PASS` | `src/lib/canvas/{create,operations,parse}.ts`, `tests/layers.test.ts` |
| Real-time synchronization across Canvas, Layers Panel, Inspector, and `GameBlueprint` across refresh | `PASS` | `src/components/canvas/CanvasApp.tsx`, `src/server/canvas-service.ts`, `tests/layers.test.ts` |

## 12. Next Steps
- None required for F06; layer and group state integrates with F05 (Canvas System) and F07 (Asset Management).

---

## 13. Backup Information
- **Google Drive Backup Root**: `Slot Studio Backups` (Folder ID: `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Category Folder**: `Slot Studio Backups/F - Frontend` (Folder ID: `1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Backup Folder**: `Slot Studio Backups/F - Frontend/F06` (Folder ID: `1LnhMC8y20zcp-_q1GI-20EdNW15nLjdQ`)
- **Backup Timestamp (UTC)**: `2026-10-12T09:34:30Z`
- **Backup Status**: `SUCCESS`
