# F17 — Preview Controls: Implementation Report

## 1. Section ID & Name
- **Section ID**: `F17`
- **Section Name**: Preview Controls (`SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`)

## 2. Objective & Scope
Build the frontend presentation preview environment (`F17 — Preview Controls`) that consumes the single source of truth `GameBlueprint` via a deterministic preview adapter (`buildPreviewPresentation`), rendering the full presentation stage (`background`, `reel frame`, `reel area`, `symbols`, `buttons`, `overlays`, and `standalone layers`) with interactive Preview Toolbar controls (`Zoom`, `Fit`, `Fullscreen`, `Reset View`, `Show Grid`, `Show Guides`), Layers & Animation Controls (`Show background animation`, `Show symbol win animation`, `Play animations as sprites`), scene-aware preview switching across `bp.scenes`, and a strict `SlotRuntimeAdapter` boundary that displays `"Runtime Engine Not Connected"` without generating fake RNG or fake payout results.

## 3. Requirements & Explicit Exclusions
### Requirements Covered
1. **Presentation Stage**:
   - Consumes `GameBlueprint` and renders a large presentation canvas representing `background`, `reel frame`, `reel area`, `symbols`, `buttons`, `overlays`, and `standalone layers`.
2. **Deterministic Static Preview Inspection**:
   - Allows the designer to inspect `layout`, `symbols`, `paylines`, `layers`, `visibility`, and `animation states` deterministically without invoking RNG.
3. **Preview Toolbar**:
   - Provides interactive `Zoom` (`−`, percentage selector `25%`–`250%`, `+`), `Fit`, `Fullscreen`, `Reset View`, `Show Grid`, and `Show Guides` controls.
4. **Layers & Animation Controls**:
   - Provides `Show background animation`, `Show symbol win animation`, and `Play animations as sprites`, operating on registered animation/sprite assets or remaining explicitly unavailable with an explanation when no animation/sprite asset exists.
5. **Scene-Aware Preview**:
   - Supports switching across `bp.scenes` (`Base game`, `Free spins`, `Bonus`, etc.), honoring each scene's `layerIds`, `background`, `entryTransition`, and positioned `objects`.
6. **Spin Boundary & `SlotRuntimeAdapter`**:
   - Does not pretend to perform a real mathematical spin when only frontend configuration exists.
   - Displays `"Runtime Engine Not Connected"` when Spin is invoked without a connected Section 2 backend engine, and exposes the clean `SlotRuntimeAdapter` interface boundary for Section 2 integration.

### Explicit Exclusions
- **No Fake RNG or Fake Payout Generation**: `DisconnectedSlotRuntimeAdapter` and `invokeRuntimeSpin` return `engineResult: null` and never fabricate spin stops, random outcomes, or simulated payout totals.
- **No AI Generation or Fake AI UI**: No LLM calls, fake chat, or simulated AI workflows.

## 4. Implementation Summary
- Created the `src/lib/preview/` domain module (`types.ts`, `runtime-adapter.ts`, `operations.ts`, `index.ts`) encapsulating all preview state, `SlotRuntimeAdapter` contracts, capability detection (`detectPreviewAnimationCapabilities`), toolbar/layer/scene state transitions, and the deterministic `buildPreviewPresentation` adapter.
- Upgraded `src/components/studio/PreviewWorkspace.tsx` to render the full F17 Preview Controls experience:
  - Top **Preview Toolbar** with Scene selector, `Zoom` (`−`, level selector, `+`), `Fit`, `Reset View`, `Fullscreen`, `Show Grid`, `Show Guides`, `Paylines` toggle, and live `Runtime Engine Not Connected` status badge.
  - **Layers Controls Bar** with checkboxes for `Show background animation`, `Show symbol win animation`, and `Play animations as sprites` (automatically disabled with reason tooltip when no sprite assets are registered), plus deterministic Reel Strip Stop scrubber (`◀ Stop #N / M ▶`).
  - **Presentation Stage** rendering background artwork/gradients, alignment grid overlay, safe-area & center-axis guides overlay, standalone game title & scene objects (`SceneObjectView`), styled reel frame (`ornate`, `minimal`, `cabinet`, `themed`), interactive `columns × rows` reel grid with role badges (`Wild`, `Scat`, `Bonus`) and SVG payline paths, and bottom button control deck (`MENU`, `BET`, `AUTO`, `TURBO`, `MAX BET`, `SPIN`).
  - **Preview Inspector** right sidebar with 6 dedicated inspection tabs: `Scenes`, `Layers`, `Animations`, `Symbols`, `Paylines`, and `Runtime`.
- Added a direct `Preview` navigation tab in `src/components/project/ProjectWorkspace.tsx` alongside existing links in `StudioNav.tsx` and `LeftNav.tsx`.

## 5. Files Created, Modified, or Deleted
| Action | Relative Path | Size (Bytes) | MD5 Checksum | Description |
|---|---|---|---|---|
| Created | `src/lib/preview/types.ts` | `7,902` | `af81987246ae8d6bcc7ede2799b3f5c2` | Typed models for `SlotRuntimeAdapter`, `PreviewState`, `PreviewToolbarState`, `PreviewLayerAnimationControls`, and `PreviewPresentationModel`. |
| Created | `src/lib/preview/runtime-adapter.ts` | `1,893` | `90a0cc73ff7bc1b71589a4230c0fad8b` | `DisconnectedSlotRuntimeAdapter`, `createDisconnectedRuntimeAdapter`, and `invokeRuntimeSpin` boundary returning `"Runtime Engine Not Connected"`. |
| Created | `src/lib/preview/operations.ts` | `30,618` | `1752b4a9dfda17414874c941a2bb4a04` | Pure deterministic operations for toolbar zoom/fit/reset/fullscreen/grid/guides, scene selection, layer visibility overrides, animation capabilities, and `buildPreviewPresentation`. |
| Created | `src/lib/preview/index.ts` | `90` | `3abedc4061c79af4923863a3dabef36f` | Barrel export for `@/lib/preview`. |
| Modified | `src/components/studio/PreviewWorkspace.tsx` | `59,416` | `409199036463c75a8ef24e1b98d195c8` | Full F17 Preview Controls & Presentation Stage UI workspace. |
| Modified | `src/components/project/ProjectWorkspace.tsx` | `14,560` | `15787d355d445a48f3fcc69e941358e1` | Added `Preview` tab link to `/projects/${project.id}/preview`. |
| Created | `tests/preview-controls.test.ts` | `16,972` | `1762d1996be96c56b438747eceab3ab2` | 7 unit and integration tests verifying all F17 requirements and the `SlotRuntimeAdapter` boundary. |
| Created | `docs/implementation/F17-preview-controls.md` | — | — | F17 implementation report. |

*(Deleted files: None)*

## 6. Architecture & Dependencies
- **Zero new external npm dependencies**: Built entirely with TypeScript, React 19, and Next.js 15 App Router primitives.
- **Strict Separation of Concerns**:
  - `src/lib/preview/` is 100% pure TypeScript with zero React or DOM dependencies, making `buildPreviewPresentation` and all preview state transitions directly testable in Node and reusable by future export/runtime bridges.
  - `src/components/studio/PreviewWorkspace.tsx` is a declarative React client view consuming `buildPreviewPresentation(bp, previewState, runtimeAdapter)`.

## 7. Relevant Components, Interfaces, Schemas, Stores & APIs
- **Interfaces (`src/lib/preview/types.ts`)**:
  - `SlotRuntimeAdapter`: `{ id, name, connectionState, isConnected(), getStatusMessage(), requestSpin(request) }`
  - `RuntimeSpinRequest` / `RuntimeSpinResponse`: `{ connected: boolean, statusMessage: string, timestamp: string, engineResult: null }`
  - `PreviewToolbarState`: `{ zoom, fitMode, panX, panY, fullscreen, showGrid, showGuides }`
  - `PreviewLayerAnimationControls`: `{ showBackgroundAnimation, showSymbolWinAnimation, playAnimationsAsSprites, activeAnimationTrigger }`
  - `PreviewPresentationModel`: Complete deterministic presentation stage model (`canvas`, `activeScene`, `scenes`, `layers`, `stage.{background, reelFrame, reelArea, buttons, overlays, standaloneLayers}`, `animationCapabilities`, `runtime`).
- **Pages & Routes**:
  - `/projects/[id]/preview` (`src/app/projects/[id]/preview/page.tsx`)
  - `/project/[projectId]/preview` (`src/app/project/[projectId]/preview/page.tsx`)

## 8. Data Flow & Persistence
- `PreviewWorkspace` receives `project: ProjectDetail` hydrated from the database via `getProject(id)` on the server page and initializes `StudioEditorProvider` + `createDefaultPreviewState(project.blueprint)`.
- Any edits saved in Design, Reels (`reelConfiguration`), Paylines (`paylineConfiguration`), Paytable (`paytableConfiguration`), Canvas (`scenes`, `layers`), or Assets (`assets`) are immediately reflected by `buildPreviewPresentation(bp, previewState)`.
- Switching scenes in Preview calls both `selectPreviewScene(previewState, sceneId)` and `editor.setActiveScene(sceneId)`.

## 9. Integration Points with Other Sections
- **F05 (Canvas System) & F06 (Layers System)**: Reads `bp.canvas`, `bp.layers`, and `bp.scenes`, rendering `SceneObjectView` instances and honoring per-scene `layerIds` and layer `opacity`/`blendMode`.
- **F07–F13 (Elements, Symbols & Assets)**: Resolves symbol thumbnails, background artwork, frame style (`ornate`, `minimal`, `cabinet`, `themed`), standalone elements (`game_title`, `custom`, `uploaded`), and sprite assets (`kind === "sprite" | "spine"` or `format === "json-animation"`).
- **F14 (Reel Editor)**: Reads `bp.reelConfiguration` (falling back to `bp.reels`) for `columns`, `rows`, `evaluation`, `spinDirection`, and `strips`.
- **F15 (Payline Editor) & F16 (Paytable Editor)**: Renders SVG payline overlays using `PAYLINE_COLOR_PALETTE` and displays symbol payout tables and `Wild`/`Scatter`/`Bonus` badges in the Symbols inspector.
- **Section 2 (Backend Slot Game Engine)**: Connects via the `SlotRuntimeAdapter` interface boundary (`src/lib/preview/runtime-adapter.ts`).

## 10. UI Controls, Shortcuts & Behaviors
- **Preview Toolbar**:
  - `Scene` selector: Switches active scene (`Base game`, `Free spins`, `Bonus`, etc.).
  - `Zoom Out (−)` / `Zoom Level (%)` / `Zoom In (+)`: Adjusts presentation stage zoom between `25%` and `250%` (shortcuts: `Ctrl/Cmd + -`, `Ctrl/Cmd + =`).
  - `Fit`: Fits presentation canvas to the stage viewport container.
  - `Reset View`: Resets zoom to `100%` and pan to `(0, 0)` (shortcut: `Ctrl/Cmd + 0`).
  - `Fullscreen`: Toggles browser fullscreen presentation mode.
  - `Show Grid`: Toggles the 32px coordinate grid overlay on the presentation canvas.
  - `Show Guides`: Toggles the safe-area inset boundary and center-axis crosshairs overlay.
  - `Paylines`: Toggles visibility of active SVG payline paths on the reel grid.
- **Layers Controls Bar & Inspector**:
  - `Show background animation`: Toggles ambient background animation when available.
  - `Show symbol win animation`: Toggles deterministic symbol win highlight pulse on the reel grid.
  - `Play animations as sprites`: Enabled when sprite/JSON-animation assets exist in `bp.assets`; otherwise disabled with explicit `"No Sprite Assets"` status.
  - `Spin` button: Calls `invokeRuntimeSpin` via `SlotRuntimeAdapter` and displays `"Runtime Engine Not Connected"` without generating fake RNG or fake payouts.

## 11. Tests, Typechecks, Builds & Actual Results
- **Typecheck**: `npm run typecheck` (`tsc --noEmit`) → **PASS** (`0` errors).
- **Unit & Integration Test Suite**: `npx tsx --test tests/*.test.ts` → **PASS** (`131/131` tests passing across 17 test suites, `0` failures; includes 7 new subtests in `tests/preview-controls.test.ts`).
- **SSR Route Verification**: Verified `GET /projects/prj_demo_roman_empire/preview` (`200 OK`) and `GET /project/prj_demo_roman_empire/preview` (`200 OK`) contain all F17 toolbar, layer animation, and `"Runtime Engine Not Connected"` controls.

## 12. Requirement-by-Requirement Status Table
| # | Requirement | Status | Verification Evidence |
|---|---|---|---|
| 1 | Preview consumes `GameBlueprint` via a clean preview adapter without fake RNG | `PASS` | `buildPreviewPresentation` in `src/lib/preview/operations.ts`; Subtest 1 in `tests/preview-controls.test.ts` |
| 2 | Large presentation canvas representing `background`, `reel frame`, `reel area`, `symbols`, `buttons`, `overlays`, `standalone layers` | `PASS` | `PreviewWorkspace.tsx` + Subtest 1 & Subtest 7 in `tests/preview-controls.test.ts` |
| 3 | Static preview allows inspection of `layout`, `symbols`, `paylines`, `layers`, `visibility`, `animation states` | `PASS` | `PreviewWorkspace.tsx` 6-tab inspector + Subtests 3, 4, 5 in `tests/preview-controls.test.ts` |
| 4 | Preview Toolbar: `Zoom`, `Fit`, `Fullscreen`, `Reset View`, `Show Grid`, `Show Guides` | `PASS` | `PreviewWorkspace.tsx` toolbar + Subtest 2 in `tests/preview-controls.test.ts` |
| 5 | Layers Controls: `Show background animation`, `Show symbol win animation`, `Play animations as sprites` (operating on registered assets or remaining unavailable) | `PASS` | `detectPreviewAnimationCapabilities` & toggles + Subtest 3 in `tests/preview-controls.test.ts` |
| 6 | Spin does NOT pretend to perform a real mathematical spin; displays `"Runtime Engine Not Connected"` and provides clean `SlotRuntimeAdapter` boundary | `PASS` | `DisconnectedSlotRuntimeAdapter`, `invokeRuntimeSpin`, + Subtest 6 in `tests/preview-controls.test.ts` |
| 7 | Scene-aware preview across `bp.scenes` | `PASS` | `selectPreviewScene` & scene-aware layer visibility + Subtest 4 in `tests/preview-controls.test.ts` |

## 13. Known Issues & Limitations
- When no sprite or JSON-animation assets (`kind: "sprite" | "spine"` or `format: "json-animation"`) have been uploaded to the project's Asset Library, the `Play animations as sprites` toggle is intentionally disabled with the explanation `"Unavailable — no sprite or JSON animation assets uploaded in Asset Library"`.
- Full mathematical spin evaluation and RNG simulation remain deferred to `SECTION 2 — BACKEND / SLOT GAME ENGINE` behind the `SlotRuntimeAdapter` interface.

## 14. Remaining Work / Next Steps
- Proceed to the remaining Section 1 Frontend tasks (`F18` Export / Packaging or subsequent requested section) or connect a live `SlotRuntimeAdapter` implementation when `SECTION 2 — BACKEND / SLOT GAME ENGINE` is built.

## 15. Google Drive Backup Location & Verification Status
- **Drive Folder Path**: `Slot Studio Backups/F - Frontend/F17/`
- **Drive Folder ID**: `13Pe4FsMckhfJbgk_PhPnNRW3zMEElGAp`
- **Uploaded & Verified Files**:
  - `src/lib/preview/types.ts` → File ID `1GSmRf31Ao6RpWFCMaXcZPL4IMgbKzoOg` (`7,902` B, MD5 `af81987246ae8d6bcc7ede2799b3f5c2`)
  - `src/lib/preview/runtime-adapter.ts` → File ID `1DoiNc_o9XOuiAnLh43RiHNTLuj8tZCPW` (`1,893` B, MD5 `90a0cc73ff7bc1b71589a4230c0fad8b`)
  - `src/lib/preview/operations.ts` → File ID `1JDtHz9_soGAuU1mO8dMrIZrd3vnGEDg_` (`30,618` B, MD5 `1752b4a9dfda17414874c941a2bb4a04`)
  - `src/lib/preview/index.ts` → File ID `164j-wSBCUg9Beg2b0yytsIRXf0m_cScU` (`90` B, MD5 `3abedc4061c79af4923863a3dabef36f`)
  - `src/components/studio/PreviewWorkspace.tsx` → File ID `1aZAXrVwPuTvJr-1KYRFrAmm4QlUtzXXj` (`59,416` B, MD5 `409199036463c75a8ef24e1b98d195c8`)
  - `src/components/project/ProjectWorkspace.tsx` → File ID `1ZJErZbAS9VOF36IdQVo_tU24Jjxue8Jq` (`14,560` B, MD5 `15787d355d445a48f3fcc69e941358e1`)
  - `tests/preview-controls.test.ts` → File ID `1kHLfeuNoCh__1xrO_aCH16kfMuU2WWsJ` (`16,972` B, MD5 `1762d1996be96c56b438747eceab3ab2`)

## 16. Last Update Date
- **Date**: `2026-10-12`
