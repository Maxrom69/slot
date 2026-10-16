# F08 — Symbol Sets

## 1. Section ID and Name
- **Section ID**: `F08`
- **Section Name**: `SYMBOL SETS`
- **Classification**: `SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER`

---

## 2. Objective and Scope
Build the dedicated Symbol Set management interface (`/projects/[id]/sets/[setId]`) so slot game designers can inspect, organize, configure, and extend symbol sets, member symbols, and custom symbol variants in a single structured workspace:
- **Layout**:
  - `Set overview` (`<header aria-label="Set overview">`)
  - `Symbol grid` (`<div role="region" aria-label="Symbol grid">`)
  - `Symbol metadata panel` (`<section aria-label="Symbol metadata">`)
  - `Set configuration panel` (`<section aria-label="Set configuration">`)
- **Set Header (`Set overview`)**:
  - Shows `name`, `type`, `tier`, `symbol count`, `style guide`, `frame`, and `background`.
- **Symbol Grid**:
  - Each symbol card displays its `thumbnail`, stable `symbol ID`, `name`, `tier`, `Wild` / `Scatter` badges, and `variant indicator`.
  - Supports `add symbol`, `rename symbol`, `duplicate symbol`, `delete symbol`, `reorder symbol` (`Move up` / `Move down`), and `open detail` (`/projects/[id]/symbols/[symbolId]`).
- **Symbol IDs**:
  - Generates collision-free stable IDs (`sym-...`) and never uses display names as primary identifiers.
- **Custom Variants**:
  - Supports creating, naming/renaming, duplicating, and deleting custom variants (`SymbolVariant`), including named variants such as `Sun Disk — Collect`, `Sun Disk — Major`, and `Sun Disk — Mini`, where each variant has its own independent stable ID and is independently addressable.
- **Acceptance**:
  - Editing a symbol updates every view referencing it (`SetEditor`, `ElementWorkspace` / `SymbolSetGroup`, `ElementDetail`, `Inspector`, `SymbolEditor`, and persisted `GameBlueprint`).
  - Deleting a symbol displays dependency warnings when the symbol is referenced by reel strip configurations or paytable rows.

---

## 3. Implementation Summary
1. **Dedicated Symbol Set Editor Layout & Set Header (`src/components/design/SetEditor.tsx`, `src/app/projects/[id]/sets/[setId]/page.tsx`)**:
   - Structured `SetEditor` into four semantic regions (`Set overview`, `Symbol grid`, `Symbol metadata`, and `Set configuration`).
   - Consolidated the Set Header (`Set overview`) so it displays all seven required fields (`name`, `type`, `tier`, `symbol count`, `style guide`, `frame`, and `background`) and supports inline set renaming, undo/redo, and adding symbols.
   - Enhanced `/projects/[id]/sets/[setId]/page.tsx` to resolve both canonical element IDs (`el-set-...`) and raw set IDs (`set-...`).
2. **Symbol Grid Cards & Actions (`src/components/design/SetEditor.tsx`)**:
   - Each `SymbolCard` renders `SymbolThumb` (with non-overlapping `Wild` and `Scatter` corner badges), a click-to-copy stable `symbol.id` badge, inline `CommitInput` for renaming, `TierBadge`, a `variant indicator` badge listing variant names and IDs on hover, and action buttons for reordering (`Move up` / `Move down`), opening the symbol detail editor (`Open <name> detail`), duplicating (`Duplicate <name>`), and deleting (`Delete <name>`).
3. **Custom Variants & `Sun Disk` Variant Workflow (`src/components/design/ElementFields.tsx`, `src/lib/design/operations.ts`, `src/lib/design/selectors.ts`, `src/lib/elements/service.ts`)**:
   - Enhanced `VariantManager` with an inline variant name input (`New variant name`), quick-add preset buttons (`+ Collect`, `+ Major`, `+ Mini` producing `<Base Symbol> — Collect`, `<Base Symbol> — Major`, `<Base Symbol> — Mini`), inline rename, duplicate, and delete controls, and `data-variant-id={v.id}` on each variant row.
   - Added `createNamedVariants(doc, symbolId, suffixes)` in `src/lib/design/operations.ts` and `findVariant(doc, variantId)` / `findVariantInLibrary(lib, variantId)` so every variant is independently addressable by its stable ID across the project.
4. **Cross-View Synchronization & Dependency Warnings (`src/lib/design/operations.ts`, `src/lib/design/selectors.ts`, `src/components/design/DeleteDialog.tsx`, `src/components/design/SymbolSetGroup.tsx`, `src/components/design/ElementDetail.tsx`)**:
   - Updated `updateSymbol` and `withImageChange` so multi-field symbol updates and external/project image changes propagate across `symbolImage`, `membersOf`, `selectSets`, `findSymbol`, `SymbolSetGroup`, `ElementDetail`, `Inspector`, and `SetEditor`.
   - Verified `symbolDeletionImpact(doc, symbolId)` and `DeleteDialog.tsx` display a `Dependency warning — this symbol is referenced by • X reel strip positions • Y paytable rows` alert before deleting any symbol referenced by reel strips or paytable entries.

---

## 4. Files Created, Modified, or Deleted

| File Path | Action | Purpose |
|---|---|---|
| `src/components/design/SetEditor.tsx` | Modified | Added semantic region labels (`Set overview`, `Symbol grid`, `Symbol metadata`, `Set configuration`), unified the 7-field Set Header, fixed multi-badge layout on `SymbolCard`, wired named variant creation, and flushed pending saves before route transitions. |
| `src/components/design/ElementFields.tsx` | Modified | Enhanced `VariantManager` with `New variant name` input, `+ Collect` / `+ Major` / `+ Mini` quick presets, and `data-variant-id` attributes. |
| `src/components/design/ElementDetail.tsx` | Modified | Displayed stable `symbol.id`, `Wild`/`Scatter` badges, and variant count indicators on symbol cards in the Design detail view. |
| `src/components/design/SymbolSetGroup.tsx` | Modified | Displayed `Wild`/`Scatter` badges and variant count indicators on symbol tiles in the Design overview workspace. |
| `src/lib/design/operations.ts` | Modified | Added `createNamedVariants`, updated `withImageChange` to sync `assetId`, and ensured `updateSymbol` applies all patch fields and syncs standalone element names. |
| `src/lib/design/selectors.ts` | Modified | Added `findVariant(doc, variantId)` and extended `symbolImage` / `elementImage` to resolve external URI `AssetReference` objects. |
| `src/lib/elements/service.ts` | Modified | Added `findVariantInLibrary(lib, variantId)` for independent variant resolution. |
| `src/app/projects/[id]/sets/[setId]/page.tsx` | Modified | Resolved both `el-set-...` and `set-...` route parameters. |
| `tests/symbol-sets.test.ts` | Created | Dedicated unit and integration test suite for `F08 — SYMBOL SETS`. |
| `docs/implementation/F08-symbol-sets.md` | Created | Mandatory 12-section implementation report for `F08`. |
| `docs/implementation/INDEX.md` | Modified | Added `F08 — Symbol Sets` entry to the implementation index. |

---

## 5. Architecture and Dependencies
- **Route Entry**: `src/app/projects/[id]/sets/[setId]/page.tsx` loads the project on the server and mounts `SetEditor`.
- **Client State & History**: `SetEditor` uses `useDesignEditor` (`src/lib/client/useDesignEditor.ts`) for undo/redo history (`createHistory`, `commitHistory`, `undoHistory`, `redoHistory`) and debounced + explicit (`flush()`) persistence to `PUT /api/projects/[id]/design`.
- **Pure Domain Operations**: All set, symbol, and variant mutations are pure functions in `src/lib/design/operations.ts` normalized by `finalizeDoc` in `src/lib/design/model.ts`.
- **Dependencies**: Zero new external packages added.

---

## 6. Data Flow and Persistence
1. **Load**: `/projects/[id]/sets/[setId]` fetches the project record from PostgreSQL / `LocalPgPool` and derives `DesignDoc` via `designDocFromBlueprint(project.blueprint)`.
2. **Edit & Undo/Redo**:
   - Editing set configuration (`symbolType`, `valueTier`, `styleGuide`, `description`, `frame`, `background`, `tags`) invokes `updateElement(doc, setId, { symbolSet: patch })`.
   - Adding, renaming, reordering, duplicating, or deleting symbols invokes `addSymbols`, `renameSymbol`, `moveSymbolInSet`, `duplicateSymbol`, or `deleteSymbol`.
   - Creating, renaming, duplicating, or removing variants invokes `addVariant` / `createNamedVariants`, `editVariant`, `duplicateVariant`, or `removeVariant`.
3. **Save & Cross-View Sync**:
   - Every operation runs `finalizeDoc`, keeping `elements`, `symbols`, `symbolSets`, `paytable`, and `strips` coherent, and persists via `saveDesign(projectId, { baseRevision, doc })`.
   - Navigating back to `/projects/[id]` or forward to `/projects/[id]/symbols/[symbolId]` flushes any pending changes first so every view immediately reflects the updated symbol state.

---

## 7. Integration Points
- **Design View (`/projects/[id]`)**:
  - `SymbolSetGroup`, `ElementDetail`, and `Inspector` each include a `Manage set` button (`actions.manageSet(setId)`) that navigates to `/projects/[id]/sets/[setId]`.
- **Symbol Detail Editor (`/projects/[id]/symbols/[symbolId]`)**:
  - Each `SymbolCard` in `SetEditor` includes an `Open <symbol> detail` button that navigates to `/projects/[id]/symbols/[symbolId]`, and `SymbolEditor`'s breadcrumb links back to `/projects/[id]/sets/[setId]`.
- **Delete Confirmation (`src/components/design/DeleteDialog.tsx`)**:
  - Computes `symbolDeletionImpact(doc, symbolId)` and displays reel strip position counts and paytable row counts in an alert box before confirming symbol deletion.

---

## 8. Controls and Behaviors
- **Set Overview Header (`aria-label="Set overview"`)**:
  - Editable `Set name` input, `SetTypeBadge`, `TierBadge`, `{N} symbols` counter, `Undo` / `Redo` buttons, `Add symbol` button, and overview facts for `Style guide`, `Frame`, and `Background`.
- **Symbol Grid (`aria-label="Symbol grid"`)**:
  - Responsive grid of `SymbolCard` items plus a trailing `+ Add symbol` tile.
  - Each card supports selecting the symbol for metadata editing, copying its stable ID, inline renaming, moving up/down in set order, opening the full Symbol Editor, duplicating under a fresh stable ID, and deleting with dependency warning confirmation.
- **Symbol Metadata Panel (`aria-label="Symbol metadata"`)**:
  - Displays read-only `Symbol ID` and `Code`, and edits `Name`, `Tier`, `Symbol type`, `Wild` switch, `Scatter` switch, `Math ID`, `Image` (`AssetRefPicker`), `Description`, `Tags`, `Custom data (extras)`, and `Custom variants` (`VariantManager` with `New variant name` input and `+ Collect`, `+ Major`, `+ Mini` presets).
- **Set Configuration Panel (`aria-label="Set configuration"`)**:
  - Edits `Symbol type`, `Value tier`, `Style guide`, `Description`, `Frame` (`AssetRefPicker`), `Background` (`AssetRefPicker`), and `Tags`.

---

## 9. Testing and Verification
Executed TypeScript typecheck and the full unit/integration test suite:
```bash
npm run typecheck
npx tsx --test tests/*.test.ts
```
- **TypeScript (`npm run typecheck`)**: `0` errors (`tsc --noEmit`).
- **Automated Tests (`npx tsx --test tests/*.test.ts`)**: `86/86` tests passing (`0` failures), including the 4 dedicated F08 test suites in `tests/symbol-sets.test.ts`:
  - `F08 Set Header & Set Configuration: name, type, tier, symbol count, style guide, frame, and background`
  - `F08 Symbol Grid operations & Stable IDs: add, rename, duplicate, reorder, delete, and never use display names as primary IDs`
  - `F08 Custom Variants & Sun Disk Variant Example: Sun Disk — Collect, Sun Disk — Major, Sun Disk — Mini are independently addressable`
  - `F08 Acceptance: editing a symbol updates every view referencing it, and deleting symbols reports reel/paytable dependency warnings`

---

## 10. Known Issues and Limitations
- **Section 1 Scope Boundary**: `mathId`, `isWild`, `isScatter`, `payouts`, and `reelWeight` are managed as declarative configuration only; payout evaluation and reel simulation belong to Section 2 (Backend / Slot Game Engine).

---

## 11. Requirements Status

| Requirement | Status | Evidence |
|---|---|---|
| Layout provides `set overview`, `symbol grid`, `symbol metadata panel`, and `set configuration panel` | `PASS` | `SetEditor.tsx` (`aria-label="Set overview"`, `"Symbol grid"`, `"Symbol metadata"`, `"Set configuration"`) |
| Set Header shows `name`, `type`, `tier`, `symbol count`, `style guide`, `frame`, `background` | `PASS` | `SetEditor.tsx` lines 112–147, `tests/symbol-sets.test.ts` |
| Symbol Grid cards show `thumbnail`, `symbol ID`, `name`, `tier`, `wild/scatter badges`, `variant indicator` | `PASS` | `SymbolCard` in `SetEditor.tsx` lines 253–326 |
| User can `add symbol`, `rename symbol`, `duplicate symbol`, `delete symbol`, `reorder symbol`, `open detail` | `PASS` | `SetEditor.tsx` & `tests/symbol-sets.test.ts` |
| Symbol IDs are stable and never use display names as primary identifiers | `PASS` | `uniqueId` in `src/lib/design/operations.ts`, verified in `tests/symbol-sets.test.ts` |
| Custom Variants support `create variant`, `name variant`, `duplicate variant`, `delete variant` (`Sun Disk — Collect / Major / Mini` independently addressable) | `PASS` | `VariantManager` in `ElementFields.tsx`, `createNamedVariants` in `operations.ts`, `findVariant` in `selectors.ts`, `tests/symbol-sets.test.ts` |
| Acceptance: Editing a symbol updates every view referencing it | `PASS` | Verified across `membersOf`, `selectSets`, `findSymbol`, and persisted `GameBlueprint` in `tests/symbol-sets.test.ts` |
| Acceptance: Deleting symbols displays dependency warnings when referenced by reel configurations or paytable data | `PASS` | `symbolDeletionImpact` in `operations.ts` + `DeleteDialog.tsx` lines 28–42, verified in `tests/symbol-sets.test.ts` |

---

## 12. Next Steps
- Proceed to the next studio section (such as `F09 — Individual Symbol Editor` or `F10 — Asset Management`) building on the `SetEditor`, `SymbolEditor`, and `GameBlueprint` element contracts.

---

## 13. Backup Information
- **Google Drive Backup Root**: `Slot Studio Backups` (Folder ID: `1KbJujCuFnukvn7XQMaXgMRqiVYJhm7pM`)
- **Category Folder**: `Slot Studio Backups/F - Frontend` (Folder ID: `1PSoT-AA0p6-l9OGAOiQGVESI7DAjHM0t`)
- **Section Backup Folder**: `Slot Studio Backups/F - Frontend/F08` (Folder ID: `13Unt4fZYRdrtH6Kurn3GsAd_sKOdwjiA`)
- **Backup Timestamp (UTC)**: `2026-10-12T09:32:12Z`
- **Backup Status**: `SUCCESS` (all created/modified source, test, and documentation files uploaded and verified by Drive file ID and byte size)
- **Uploaded Files**:
  - `src/components/design/SetEditor.tsx` — Drive ID `1uRv3rVhZMepZrcFGYNuXC3UomgaeMkYT` (`25,596` bytes, verified)
  - `src/components/design/ElementFields.tsx` — Drive ID `1QYONE6KRzjVC8i5Naf70eLKTB2D-5slj` (`11,701` bytes, verified)
  - `src/components/design/ElementDetail.tsx` — Drive ID `1WKWr-C5gGJGI1EKpOOQpR8dMBfLErRFS` (`11,758` bytes, verified)
  - `src/components/design/SymbolSetGroup.tsx` — Drive ID `1pCIhUpnSDZvZKusA59px_iFY70FTBa6E` (`6,840` bytes, verified)
  - `src/lib/design/operations.ts` — Drive ID `13pTL3mnrlLOUSBoeBxHZO7tKZKA2iFPm` (`31,937` bytes, verified)
  - `src/lib/design/selectors.ts` — Drive ID `1bIOWLfjqZWb27_Vi03jhpycFM_FJ4n7E` (`5,453` bytes, verified)
  - `src/lib/elements/service.ts` — Drive ID `1dUas_sYY7xadq1fnX-yCJznr_UsS0l6x` (`22,989` bytes, verified)
  - `src/app/projects/[id]/sets/[setId]/page.tsx` — Drive ID `1BH6_GGbI4tVaVHHiuJusO_62fwLH4LPf` (`848` bytes, verified)
  - `tests/symbol-sets.test.ts` — Drive ID `1uH3pPlQP-mY-PsE8k6F4ygnD2aEFMpxk` (`12,112` bytes, verified)
  - `docs/implementation/F08-symbol-sets.md` — Drive ID `1Dl0ruZ30KtOxVopbol_eQtCznl8ukE4x` (Folder ID: `109kwn9k7hsvtVGb8VtA_SSAdUOxFxLS0`, verified)
  - `docs/implementation/INDEX.md` — Drive ID `12sqqWKVlHpEojzv28BRJanTXitvoCnUF` (Folder ID: `109kwn9k7hsvtVGb8VtA_SSAdUOxFxLS0`, verified)

