# F07 — Element System

## 1. Section ID and Name
- **Section ID**: `F07`
- **Section Name**: `ELEMENT SYSTEM`
- **Classification**: `SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`

---

## 2. Objective and Scope
Create the typed element system used throughout the Slots Studio Builder so every visual game element is represented by a deterministic, storage-agnostic domain contract that serializes losslessly to and from the single `GameBlueprint`:
- **Element Types**:
  - `SymbolSet`
  - `Symbol`
  - `GameTitle`
  - `GameBackground`
  - `ReelFrame`
  - `ButtonSet`
  - `UploadedElement`
  - `CustomElement`
- **SymbolSet Properties**:
  - `id`, `name`, `symbolType`, `valueTier`, `frame`, `background`, `symbols[]`, `styleGuide`, `description`, `tags`
- **Conceptual Symbol Types**:
  - `Characters` (`"characters"` / `"character"`)
  - `Deck Ranks` (`"ranks"` / `"royals"`)
  - `Suits` (`"suits"`)
  - `Custom` (`"custom"`, plus legacy `"seven"` and `"bar"`)
- **Value Tiers**:
  - `High` (`"high"`)
  - `Medium` (`"medium"`)
  - `Low` (`"low"`)
  - `Special` (`"special"`)
- **Symbol Properties**:
  - `id`, `name`, `symbolSetId`, `symbolType`, `tier`, `image`, `variants[]`, `extras`, `mathId`, `isWild`, `isScatter`
  - Gameplay flags (`mathId`, `isWild`, `isScatter`) are persisted as declarative configuration only; no frontend payout evaluation is performed.
- **Custom Variants**:
  - Independent `SymbolVariant` entities (`id`, `name`, `image`, `extras`, `tags`), each assigned its own collision-free stable ID across creation and duplication.
- **Standalone Elements**:
  - Editable metadata (`name`, `description`, `tags`, `group`, `notes`, `params`, `aspect`, `style`, `buttons`) and image references.
- **Image References**:
  - Storage-provider-agnostic `AssetReference` abstraction (`provider: "project" | "external" | "placeholder"`, `assetId`, `uri`, `name`) with `AssetProvider` resolution.
- **Scope Exclusions**:
  - No slot math simulation, RNG, or payout evaluation in the frontend (reserved for Section 2 backend engine).
  - No live AI image generation or LLM calls (reserved behind deterministic `not_implemented` extension boundaries).

---

## 3. Implementation Summary
1. **Canonical Element Domain Model (`src/lib/elements/types.ts`, `src/lib/elements/index.ts`, `src/lib/blueprint/types.ts`)**:
   - Defined strongly typed interfaces for `SymbolSet`, `Symbol`, `GameTitle`, `GameBackground`, `ReelFrame`, `ButtonSet`, `UploadedElement`, `CustomElement`, `StandaloneElement`, `StudioElement`, and `ElementLibrary`.
   - Exported `CONCEPTUAL_SYMBOL_TYPES` (`["characters", "ranks", "suits", "custom"]`) with `SYMBOL_TYPE_LABELS` (`Characters`, `Deck Ranks`, `Suits`, `Custom`) and `VALUE_TIERS_LIST` (`["high", "medium", "low", "special"]`) with `VALUE_TIER_LABELS` (`High`, `Medium`, `Low`, `Special`).
   - Extended `SymbolSet.valueTier` and `CreateSetInput.valueTier` to accept all four value tiers (`High`, `Medium`, `Low`, `Special`).
2. **Storage-Agnostic Image Reference Abstraction (`src/lib/elements/assets.ts`)**:
   - Implemented `AssetReference` (`provider: "project" | "external" | "placeholder"`), `AssetProvider`, `projectAssetReference`, `externalAssetReference`, `placeholderReference`, `normalizeAssetReference`, `serializeAssetReference`, `createProjectAssetProvider`, and `projectAssetIdOf`.
3. **Pure Element Service & Design Operations (`src/lib/elements/service.ts`, `src/lib/elements/ids.ts`, `src/lib/design/operations.ts`, `src/lib/design/model.ts`)**:
   - Implemented pure, deterministic CRUD and duplication functions for sets (`createSymbolSet`, `editSymbolSet`, `duplicateSymbolSet`, `removeSymbolSet`), symbols (`createSymbol`, `editSymbol`, `moveSymbolToSet`, `duplicateSymbol`, `removeSymbol`), variants (`addVariant`, `editVariant`, `duplicateVariant`, `removeVariant`), and standalone elements (`createStandalone`, `editStandalone`, `duplicateStandalone`, `removeStandalone`), plus `membersOfSet`, `ownerOfSymbol`, and `validateLibrary`.
   - Updated `finalizeDoc` in `src/lib/design/model.ts` so `symbol.symbolSetId` points exclusively to owning `symbol_set` elements (`null` for standalone symbols), preserves `external` and `placeholder` asset reference names, and supports all 4 `ValueTier` values on `SymbolSet`.
   - Fixed `withImageChange` in `src/lib/design/operations.ts` to allocate collision-free revision IDs via `uniqueId(`${symbol.id}-rev`, existingIds)` even when multiple image updates occur within the same millisecond.
4. **Lossless Blueprint Adapter (`src/lib/elements/blueprint-adapter.ts`)**:
   - Implemented `libraryFromBlueprint`, `applyLibraryToSymbols`, `applyLibraryToElements`, and `applyLibraryToBlueprint` so `ElementLibrary` and `GameBlueprint` round-trip losslessly while preserving legacy presentation fields (`code`, `glyph`, `payouts`, `reelWeight`, `assetId`).
5. **Studio UI Editors (`src/components/design/SetEditor.tsx`, `src/components/design/SymbolEditor.tsx`, `src/components/design/ElementFields.tsx`, `src/components/design/Inspector.tsx`, `src/components/design/ElementDetail.tsx`, `src/app/projects/[id]/sets/[setId]/page.tsx`, `src/app/projects/[id]/symbols/[symbolId]/page.tsx`)**:
   - Dedicated Symbol Set editor (`/projects/[id]/sets/[setId]`) and Symbol editor (`/projects/[id]/symbols/[symbolId]`) with full editing for `frame`, `background`, `styleGuide`, `description`, `tags`, `variants[]`, `extras`, `mathId`, `isWild`, `isScatter`, and `imageHistory` revisions.
   - Enhanced the Design View `Inspector` and `ElementDetail` to surface stable IDs, `Style guide`, `Description`, `Tags`, `Custom parameters` (`ExtrasEditor` for `CustomElement`), and direct navigation to the Symbol Set and Symbol editors.

---

## 4. Files Created, Modified, or Deleted

| File Path | Action | Purpose |
|---|---|---|
| `src/lib/elements/index.ts` | Created | Barrel export for F07 element types, IDs, `AssetReference` helpers, pure element service, and blueprint adapters. |
| `src/lib/elements/types.ts` | Modified | Added `CONCEPTUAL_SYMBOL_TYPES`, `VALUE_TIERS_LIST`, `ConceptualSymbolTypeLabel`, and enabled all 4 `ValueTier` values on `SymbolSet`. |
| `src/lib/elements/service.ts` | Modified | Enabled all 4 `ValueTier` values in `CreateSetInput` and preserved variant `tags` across set, symbol, and variant duplication. |
| `src/lib/elements/blueprint-adapter.ts` | Modified | Preserved `description` and `tags` in `libraryFromBlueprint` and added `applyLibraryToElements` and `applyLibraryToBlueprint`. |
| `src/lib/design/model.ts` | Modified | Scoped `symbol.symbolSetId` in `finalizeDoc` to `symbol_set` owners (`null` for standalone symbols), preserved `AssetReference.name` across providers, and enabled `special` `valueTier` on symbol sets. |
| `src/lib/design/operations.ts` | Modified | Used collision-free `uniqueId` for `imageHistory` revisions in `withImageChange` and enabled all `ValueTier` values on symbol set creation. |
| `src/components/design/actions.ts` | Modified | Added `openSymbol` action to `DesignActions`. |
| `src/components/design/DesignApp.tsx` | Modified | Wired `openSymbol` to flush pending edits and navigate to `/projects/[id]/symbols/[symbolId]`. |
| `src/components/design/Inspector.tsx` | Modified | Added stable `ID` display, `Manage set` and `Edit symbol` actions, `Style guide`, `Description`, `Tags`, and `Custom parameters` (`ExtrasEditor`) editing. |
| `src/components/design/ElementDetail.tsx` | Modified | Added `Open symbol editor` button on member symbol cards. |
| `src/app/projects/[id]/sets/[setId]/page.tsx` | Modified | Resolved both element IDs (`el-set-...`) and raw set IDs (`set-...`) cleanly. |
| `tests/elements.test.ts` | Created | Comprehensive unit and integration test suite for the F07 Element System. |
| `docs/implementation/F07-element-system.md` | Created | Mandatory 12-section implementation report for `F07`. |
| `docs/implementation/INDEX.md` | Modified | Registered `F07 — Element System` in the master documentation index. |

---

## 5. Architecture and Dependencies
- **Domain & Service Layer**:
  - `src/lib/elements/types.ts` — Pure TypeScript definitions for all 8 element types, conceptual symbol types, value tiers, and `ElementLibrary`.
  - `src/lib/elements/ids.ts` — Deterministic stable ID generation (`isStableId`, `newStableId`, `copyStableId`, `copyName`).
  - `src/lib/elements/assets.ts` — Storage-provider-agnostic `AssetReference` and `AssetProvider`.
  - `src/lib/elements/service.ts` — Pure immutable state transitions (`(lib, args) -> lib`) and referential integrity checker (`validateLibrary`).
  - `src/lib/elements/blueprint-adapter.ts` — Bidirectional mapping between `GameBlueprint` and `ElementLibrary`.
- **Design Workspace & Persistence Layer**:
  - `src/lib/design/{model,operations,parse,migrate}.ts` — `DesignDoc` normalization, cross-reference pruning, and blueprint serialization.
  - `src/server/design-service.ts` — Optimistic concurrency revision check and persistence to PostgreSQL / `LocalPgPool`.
- **External Dependencies**:
  - Zero new external packages added.

---

## 6. Data Flow and Persistence
1. **Hydration**:
   - `GameBlueprint` is loaded from persistence via `getProject(projectId)` and normalized into `DesignDoc` (`designDocFromBlueprint`) or `ElementLibrary` (`libraryFromBlueprint`).
2. **Pure Mutations & Stable IDs**:
   - Every create, edit, duplicate, reorder, variant, or delete action executes a pure function (`addElement`, `updateElement`, `duplicateElement`, `deleteElement`, `updateSymbol`, `duplicateSymbol`, `addVariant`, `editVariant`, `duplicateVariant`, `removeVariant`) that allocates collision-free stable IDs and runs `finalizeDoc`.
3. **Referential Integrity**:
   - Duplicating a `SymbolSet` clones all member symbols and their custom `SymbolVariant` entries with fresh stable IDs and updates `symbolSetId` to the new set ID.
   - Deleting a `SymbolSet` or `Symbol` removes all references from `elements`, `symbolSets`, `specialSymbols`, `paytable`, and `reels.strips`, and prunes unreferenced non-library project assets.
4. **Serialization**:
   - `applyDesign(blueprint, doc)` / `applyLibraryToBlueprint(blueprint, lib)` writes `elements`, `symbols`, and `symbolSets` back into `GameBlueprint` and persists via `PUT /api/projects/[id]/design`.

---

## 7. Integration Points
- **Design View (`/projects/[id]`)**:
  - Uses `DesignApp`, `ElementWorkspace`, `ElementDetail`, and `Inspector` to create, inspect, edit, duplicate, and delete all 8 element types.
- **Symbol Set Editor (`/projects/[id]/sets/[setId]`)**:
  - Renders `SetEditor` for editing set `name`, `symbolType`, `valueTier`, `frame` (`AssetReference`), `background` (`AssetReference`), `styleGuide`, `description`, `tags`, and member `symbols[]` (add, import, reorder, duplicate, delete, open symbol editor).
- **Symbol Editor (`/projects/[id]/symbols/[symbolId]`)**:
  - Renders `SymbolEditor` for editing `name`, `tier`, `symbolSetId`, `symbolType`, `image` (`AssetReference`), `imageHistory` revisions (annotate/restore), `mathId`, `isWild`, `isScatter`, `isBonus`, `extras`, and independent `variants[]` (`SymbolVariant`).
- **Blueprint Validation (`src/lib/blueprint/validate.ts`)**:
  - Validates unique element IDs, single symbol ownership, valid `symbolSetId` links, unique `SymbolVariant` stable IDs, and valid `AssetReference` links across elements, symbols, variants, and image revisions.

---

## 8. Controls and Behaviors
- **Add Element Dialog (`AddElementDialog.tsx`)**:
  - Supports creating `Symbol Set`, `Symbol` (regular or special Wild/Scatter/Bonus), `Game Title`, `Game Background`, `Reel Frame`, `Button Set`, `Uploaded Element`, and `Custom Element`.
- **Design Inspector (`Inspector.tsx`)**:
  - Displays stable `ID`, `Name`, `Symbol type`, `Value tier`, `Style guide`, `Description`, `Tags`, `Notes`, `Custom parameters` (`ExtrasEditor`), image controls, and quick actions (`Manage set`, `Edit symbol`, `Duplicate`, `Delete`).
- **Set Editor (`SetEditor.tsx`)**:
  - Edits set metadata (`name`, `symbolType`, `valueTier`, `styleGuide`, `description`, `tags`), `frame` and `background` `AssetReference` pickers (upload file, external URI, placeholder, clear), and member symbol grid with reordering (`Move up` / `Move down`), duplication, deletion, and symbol editor navigation.
- **Symbol Editor (`SymbolEditor.tsx`)**:
  - Edits symbol metadata, primary `AssetReference` image, `imageHistory` revision log with restore & annotation, gameplay configuration flags (`mathId`, `isWild`, `isScatter`, `isBonus`), key/value `extras`, and custom `variants[]` (each displaying its stable ID badge and independent `name`, `image`, `tags`, and `extras`).

---

## 9. Testing and Verification
Executed the full automated test suite and TypeScript compiler verification:
```bash
npm run typecheck
npx tsx --test tests/*.test.ts
```
- **TypeScript (`npm run typecheck`)**: `0` errors (`tsc --noEmit`).
- **Automated Test Suite (`npx tsx --test tests/*.test.ts`)**: `82/82` tests passing (`0` failures), including the 5 dedicated F07 test suites in `tests/elements.test.ts`:
  - `F07 conceptual symbol types and value tiers cover documented labels and conversions`
  - `F07 AssetReference abstraction decouples image references from storage providers`
  - `F07 SymbolSet & Symbol CRUD, custom variants with stable IDs, and referential integrity in ElementLibrary`
  - `F07 Standalone Elements (GameTitle, GameBackground, ReelFrame, ButtonSet, UploadedElement, CustomElement) support CRUD, metadata, and AssetReference`
  - `F07 DesignDoc & GameBlueprint integration: SetEditor/SymbolEditor operations, image revisions, and lossless adapter round-trip`
- **Live Server Route Verification**:
  - `GET /projects/prj_demo_roman_empire/sets/el-set-set-royals` -> `200 OK`
  - `GET /projects/prj_demo_roman_empire/sets/set-royals` -> `200 OK`
  - `GET /projects/prj_demo_roman_empire/symbols/sym-low-a` -> `200 OK`

---

## 10. Known Issues and Limitations
- **Section 1 Architectural Boundary**: `mathId`, `isWild`, `isScatter`, `payouts`, and `reelWeight` are stored and validated as declarative configuration on `Symbol` and `GameBlueprint` without frontend payout evaluation or RNG simulation (reserved for Section 2 Backend Engine).
- **AI Generation Boundary**: AI variation buttons in the Inspector remain explicitly disabled and marked as reserved so the Element System is 100% functional without AI.

---

## 11. Requirements Status

| Requirement | Status | Evidence |
|---|---|---|
| Define robust types for `SymbolSet`, `Symbol`, `GameTitle`, `GameBackground`, `ReelFrame`, `ButtonSet`, `UploadedElement`, `CustomElement` | `PASS` | `src/lib/elements/types.ts`, `src/lib/blueprint/types.ts`, `tests/elements.test.ts` |
| `SymbolSet` properties: `id`, `name`, `symbolType`, `valueTier`, `frame`, `background`, `symbols[]`, `styleGuide`, `description`, `tags` | `PASS` | `src/lib/elements/types.ts`, `src/components/design/SetEditor.tsx`, `tests/elements.test.ts` |
| Conceptual Symbol Types: `Characters`, `Deck Ranks`, `Suits`, `Custom` | `PASS` | `CONCEPTUAL_SYMBOL_TYPES` & `SYMBOL_TYPE_LABELS` in `src/lib/elements/types.ts` |
| Value Tiers: `High`, `Medium`, `Low`, `Special` | `PASS` | `VALUE_TIERS_LIST` & `VALUE_TIER_LABELS` in `src/lib/elements/types.ts`, `VALUE_TIERS` in `src/lib/design/model.ts` |
| `Symbol` properties: `id`, `name`, `symbolSetId`, `symbolType`, `tier`, `image`, `variants[]`, `extras`, `mathId`, `isWild`, `isScatter` (configuration only) | `PASS` | `src/lib/elements/types.ts`, `src/components/design/SymbolEditor.tsx`, `tests/elements.test.ts` |
| Custom Variants represented independently with their own stable IDs | `PASS` | `SymbolVariant` in `src/lib/blueprint/types.ts`, `addVariant`/`duplicateVariant` in `src/lib/elements/service.ts` & `src/lib/design/operations.ts` |
| Standalone Elements support editable metadata and image references | `PASS` | `src/lib/elements/service.ts`, `src/components/design/Inspector.tsx`, `tests/elements.test.ts` |
| Storage-provider-agnostic `AssetReference` abstraction | `PASS` | `src/lib/elements/assets.ts`, `src/components/design/ElementFields.tsx`, `tests/elements.test.ts` |
| Acceptance: Elements can be created, edited, duplicated, and removed; symbol sets show member symbols; elements have stable IDs; all references remain valid after duplication and deletion | `PASS` | Verified in `tests/elements.test.ts` and `tests/design.test.ts` (`82/82` total tests passing) |

---

## 12. Next Steps
- Proceed to the next studio section (such as `F08 — Asset Management & Upload Pipeline` or subsequent Section 1 frontend editors) while preserving the `GameBlueprint` and `AssetReference` contracts established in `F01`–`F07`.

---

## 13. Backup Information
- **Google Drive Backup Root**: `Slot Studio Backups` (Folder ID: `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Category Folder**: `Slot Studio Backups/F - Frontend` (Folder ID: `1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Backup Folder**: `Slot Studio Backups/F - Frontend/F07` (Folder ID: `1Qlkk6lMvkrdf0CIM9GG_iNxGRVN_ywDU`)
- **Backup Timestamp (UTC)**: `2026-10-12T09:34:16Z`
- **Backup Status**: `SUCCESS`
- **Uploaded Files**:
  - `src/lib/elements/index.ts` — Drive ID `1Rd1NUMh-qQJEDUu6Y0x-YDbZuT9lFEoP` (`138` bytes, verified)
  - `src/lib/elements/types.ts` — Drive ID `1mpGuDwDNiX3wJzEYP-DphCaCyTKadawp` (`4,672` bytes, verified)
  - `src/lib/elements/blueprint-adapter.ts` — Drive ID `1jT4yCM4Tf268CrS1E2QpLznx1uI90wqd` (`10,549` bytes, verified)
  - `src/lib/design/model.ts` — Drive ID `1rn8Nmjuz3Rcalyf6cB0WVYF5AL9NWRL_` (`13,444` bytes, verified)
  - `src/components/design/actions.ts` — Drive ID `1q0T_cKNi5wUZ_PzR3ULNNOaI8IjtpeIu` (`1,832` bytes, verified)
  - `src/components/design/DesignApp.tsx` — Drive ID `1_eGwrFhvm_qF-lfN59q7Pi5HEYk7DY1t` (`28,003` bytes, verified)
  - `src/components/design/Inspector.tsx` — Drive ID `1Rv_MM-nrCaiQ1Dp1KxTY2L1S98Pyutja` (`20,334` bytes, verified)
  - `tests/elements.test.ts` — Drive ID `1FnMFxGZRLBt67-uudtroT_y6LI7T70O9` (`19,353` bytes, verified)
  - `docs/implementation/F07-element-system.md` — Uploaded into `F07/docs/implementation` (Folder ID: `1Xo5yQTw-Mq0J_a5wGO67ayid3pNw2V-y`)

