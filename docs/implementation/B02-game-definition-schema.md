# B02 — Game Definition Schema

## 1. Section Metadata
- **Section ID**: `B02`
- **Section Name**: Game Definition Schema
- **Category**: `B - Backend` (`SECTION 2 — BACKEND / SLOT GAME ENGINE`)
- **Implementation Status**: `COMPLETE`
- **Date Completed**: `2026-10-12`
- **Canonical Schema Version**: `"1.0"` (`CANONICAL_SCHEMA_VERSION`)
- **Engine Compatibility**: `minEngineVersion: "1.0.0"`, `targetEngineVersion: "1.0.0"`

---

## 2. Executive Summary
`B02` establishes the canonical **Game Definition Schema** (`GameDefinition`, `GameDefinitionSchema`), unifying the authoring `GameBlueprint` produced by **SECTION 1 — Frontend / Slots Studio Builder** with the normalized declarative specification consumed by **SECTION 2 — Backend Slot Game Engine**. It enforces strict structural and cross-reference validation, blocks any transient runtime state or UI editor state from entering the persisted definition, provides deterministic normalization (`normalizeGameDefinition`), schema version migration (`migrateGameDefinition`), clone-safe identity rewriting (`cloneGameDefinition`), lossless JSON round-trip (`serializeGameDefinition` / `deserializeGameDefinition`), and direct conversion into an immutable runtime `GameConfig` (`toGameConfig`).

---

## 3. Architectural Relationship & Separation of Concerns

```text
Frontend Authoring (Slots Studio Builder)
        │
        ▼
GameBlueprint (Authoring Representation)
        │
        ▼  validateGameDefinition() / GameDefinitionSchema.validate()
Schema & Cross-Reference Validation
        │
        ▼  normalizeGameDefinition()
GameDefinition (Canonical Declarative Contract, schemaVersion: "1.0")
        │
        ▼  toGameConfig() / adaptBlueprintToGameConfig()
GameConfig (Immutable, Deep-Frozen Runtime-Ready Configuration + O(1) Lookups)
        │
        ▼
SlotGameEngine (GameConfig + SpinRequest + RNG -> SpinResult)
```

### Strict Six-Way Boundary Separation
1. **GAME DEFINITION (`GameDefinition` / `GameBlueprint`)**: *"What game have I designed?"* — Purely declarative, immutable, JSON-serializable game specification.
2. **GAME CONFIG (`GameConfig`)**: *"What normalized configuration can the engine execute?"* — Pre-indexed O(1) lookup maps derived from `GameDefinition`.
3. **RUNTIME STATE (`GameState`, `RoundState`, `FeatureState`)**: *"What is happening right now?"* — Session balance, round counter, current reel stops, current board, active free spins/multipliers, RNG state. Forbidden inside `GameDefinition`.
4. **SPIN REQUEST (`SpinRequest`)**: *"What execution was requested?"* — Game ID, seed/RNG source, bet amount, active paylines, round metadata.
5. **SPIN RESULT (`SpinResult`)**: *"What actually happened?"* — Resolved reel stops, visible board, wins, total payout, feature triggers, next state, replay record.
6. **ENGINE EVENTS & SIMULATION DATA (`EngineEvent`, `SimulationResult`)**: *"What occurred during execution / across many executions?"* — Domain events and statistical aggregates.

---

## 4. Top-Level Structure, Entity Relationships & Required vs. Optional Fields

### Top-Level `GameDefinition` Structure
- `schemaVersion`: `"1.0"` (**Required**)
- `version`: `1` (**Required**)
- `engineCompatibility`: `{ schemaVersion: "1.0", minEngineVersion: "1.0.0", targetEngineVersion: "1.0.0" }` (**Required**)
- `id`: Stable game identifier matching `metadata.id` (**Required**)
- `metadata` (`meta`): `GameMetadata` — `id`, `title`, `slug`, `description`, `theme`, `author`, `studio`, `version`, `schemaVersion`, `createdAt`, `updatedAt`, `tags` (**Required**); `folderPath`, `thumbnail`, `notes` (*Optional*)
- `game`: `GameIdentityConfig` — `gameId`, `displayName`, `gameMode`, `supportedModes`, `defaultBet`, `betLevels`, `rtpTarget`, `volatility`, `maxWinX`, `hitFrequencyTarget` (**Required**); `denomination` (*Optional*)
- `styleGuide` (`style`): `CanonicalStyleGuide` — `name`, `description`, `artStyle`, `colorDirection`, `lighting`, `renderingStyle`, `compositionGuidance`, `characterGuidance`, `symbolGuidance`, `backgroundGuidance`, `palette`, `typography` (**Required**); `referenceAssetId` (*Optional*)
- `grid`: `CanonicalGridConfiguration` — `reelCount` (`columns`), `rowCount` (`rows`), `preset`, `evaluation`, `orientation` (**Required**); `cellWidth`, `cellHeight`, `aspectRatio`, `minReels`, `maxReels`, `minRows`, `maxRows` (*Optional*)
- `canonicalSymbols` (`symbols`): `readonly CanonicalSymbolDefinition[]` — `id`, `code`, `name`, `type`, `tier`, `valueTier`, `asset` (*Optional/Nullable for math-only games*), `symbolSetId`, `familyId`, `roles`, `roleConfigs`, `variants`, `extras`, `payouts`, `reelWeight`, `enabled`
- `symbolFamilies`: `readonly SymbolFamilyDefinition[]` — `id`, `name`, `baseSymbolId`, `memberIds`, `allowMixedCounting`
- `canonicalSymbolSets` (`symbolSets`): `readonly SymbolSetDefinition[]` — `id`, `name`, `symbolType`, `tier`, `description`, `frame`, `background`, `symbolIds` (references only), `styleGuideReference`
- `canonicalAssets` (`assets`): `readonly AssetDefinition[]` — `id`, `name`, `type`, `source`, `state`, `width`, `height`, `format`, `tags`, `metadata`
- `canonicalElements` (`elements`): `readonly ElementDefinition[]` — `id`, `type`, `name`, `group`, `asset`, `symbolIds`, `variants`, `extras`, `metadata`
- `canonicalScenes` (`scenes`): `readonly SceneDefinition[]` — `id`, `name`, `kind`, `entryTransition`, `canvas`, `background`, `layerIds`, `layers`, `composedAssets` (*Optional*), `visibilityOverrides` (*Optional*)
- `canvasConfiguration` (`canvas`): `CanvasConfiguration` — `width`, `height`, `aspectRatio`, `safeArea`, `orientation`, `backgroundAssetId`, `grid`, `guides`, `snapSettings`
- `canonicalLayers` (`layers`) & `layerGroups`: `readonly LayerDefinition[]` & `readonly LayerGroupDefinition[]`
- `canonicalReels` (`reels`): `CanonicalReelConfiguration` — `reelCount`, `rowCount`, `spinDirection`, `useWeights`, `reels[]` (explicit `index: 0..reelCount-1`, `stops[]` referencing `symbolId` with optional `weight`)
- `canonicalPaylines` (`paylines`): `CanonicalPaylineConfiguration` — `enabled`, `reelCount`, `rowCount`, `paylines[]` (`id`, `index`, `name`, `pattern`, `enabled`, `color`)
- `paytableDefinition` (`paytable`): `PaytableDefinition` — `payoutType: "multiplier"`, `betBasis`, `minMatchCount`, `entries[]` (`symbolId`, `payouts: Record<matchCount, multiplier>`)
- `winEvaluation`: `WinEvaluationDefinition` — `primaryMode` (`fixedPaylines | ways | clusters | payAnywhere | scatters`), `enabledModes`, `direction`, `highestWinOnlyPerLine`, `allowSimultaneousLineAndScatterWins`, `familyCountingEnabled`
- `wildConfiguration`: `WildConfiguration` — `enabled`, `symbolIds`, `substitutionRules[]` (`wildSymbolId`, `allowedSubstitutions`, `excludedSymbolIds`, `activeReels`, `activeModes`, `paysOnOwn`, `multiplier`)
- `scatterConfiguration`: `ScatterConfiguration` — `enabled`, `symbolIds`, `rules[]` (`scatterSymbolId`, `evaluatesAnywhere`, `independentOfPaylines`, `payoutReferenceSymbolId`, `triggerFeatureId`, `minimumTriggerCount`)
- `waysConfiguration`, `clusterConfiguration`, `payAnywhereConfiguration`: Multi-mode evaluation configurations
- `canonicalFeatures` (`features`), `freeSpinsConfiguration`, `multiplierConfiguration`: Extensible feature definitions, discriminated-union `FeatureTriggerDefinition`, free-spin rules, and multiplier progression rules
- `boardDynamics`, `variableReelHeights`, `reelNudges`, `linkedReels`: Advanced board and reel mechanic configuration structures
- `canonicalAnimations` (`animations`), `export` (`exportConfig`), `schemaExtensions` (`extensions`)

### Cross-Reference Integrity Rules
Every entity reference uses stable string IDs (never array positions) and is validated before constructing a `GameConfig`:
- `reelStop.symbolId` → `symbols[].id` or `symbols[].variants[].id`
- `paytable.symbolId` → `symbols[].id` or `symbols[].variants[].id`
- `wildConfiguration.symbolIds` / `substitutionRules[].wildSymbolId` → `symbols[].id`
- `scatterConfiguration.symbolIds` / `rules[].scatterSymbolId` → `symbols[].id`
- `scatterConfiguration.rules[].triggerFeatureId` → `features[].id`
- `symbol.assetId` / `symbol.image.assetId` / `element.assetId` / `scene.background.assetId` / `canvas.backgroundAssetId` → `assets[].id`
- `symbol.symbolSetId` ↔ `symbolSets[].id`
- `symbol.family` / `variant.familyId` / `symbolFamilies[].memberIds` ↔ `symbolFamilies[].id`
- `scene.layerIds` / `layerGroups[].childLayerIds` → `layers[].id`
- `animation.elementId` / `animation.target` → `elements[].id` / `layers[].id` / `symbols[].id`

---

## 5. Canonical JSON Example (`Solar Dynasty 5x3` Excerpt)

```json
{
  "schemaVersion": "1.0",
  "version": 1,
  "engineCompatibility": {
    "schemaVersion": "1.0",
    "minEngineVersion": "1.0.0",
    "targetEngineVersion": "1.0.0"
  },
  "id": "sample-b02-5x3-canonical",
  "metadata": {
    "id": "sample-b02-5x3-canonical",
    "title": "Solar Dynasty 5x3",
    "slug": "solar-dynasty-5x3",
    "description": "Canonical B02 5x3 fixed-payline GameDefinition fixture.",
    "theme": "Solar Dynasty",
    "author": "Slot Studio Schema Architect",
    "studio": "Slot Studio Schema Architect",
    "version": "1.0.0",
    "schemaVersion": 1,
    "createdAt": "2026-10-12T00:00:00.000Z",
    "updatedAt": "2026-10-12T00:00:00.000Z",
    "tags": ["b02", "canonical-schema", "5x3"],
    "folderPath": "/Samples/B02",
    "thumbnail": null
  },
  "game": {
    "gameId": "sample-b02-5x3-canonical",
    "displayName": "Solar Dynasty 5x3",
    "gameMode": "fixedPaylines",
    "supportedModes": ["fixedPaylines"],
    "defaultBet": 1,
    "betLevels": [0.2, 0.5, 1, 2, 5, 10],
    "rtpTarget": 96,
    "volatility": "medium",
    "maxWinX": 5000,
    "hitFrequencyTarget": 0.26,
    "denomination": { "baseUnit": 1, "currencyCode": null }
  },
  "grid": {
    "reelCount": 5,
    "rowCount": 3,
    "columns": 5,
    "rows": 3,
    "preset": "5x3",
    "evaluation": "lines",
    "cellWidth": 274,
    "cellHeight": 216,
    "aspectRatio": "1920:1080",
    "orientation": "landscape",
    "minReels": 5,
    "maxReels": 5,
    "minRows": 3,
    "maxRows": 3
  },
  "winEvaluation": {
    "primaryMode": "fixedPaylines",
    "enabledModes": ["fixedPaylines", "scatters"],
    "direction": "leftToRight",
    "highestWinOnlyPerLine": true,
    "allowSimultaneousLineAndScatterWins": true,
    "familyCountingEnabled": true
  },
  "wildConfiguration": {
    "enabled": true,
    "symbolIds": ["sym-wild"],
    "substitutionRules": [
      {
        "wildSymbolId": "sym-wild",
        "allowedSubstitutions": "allRegular",
        "excludedSymbolIds": ["sym-scatter"],
        "activeReels": [0, 1, 2, 3, 4],
        "activeModes": ["base", "freeSpins", "bonus"],
        "paysOnOwn": true,
        "multiplier": 1
      }
    ]
  },
  "scatterConfiguration": {
    "enabled": true,
    "symbolIds": ["sym-scatter"],
    "rules": [
      {
        "scatterSymbolId": "sym-scatter",
        "evaluatesAnywhere": true,
        "independentOfPaylines": true,
        "payoutReferenceSymbolId": "sym-scatter",
        "triggerFeatureId": "feature-free-spins",
        "minimumTriggerCount": 3
      }
    ]
  }
}
```

---

## 6. Files Created & Modified in B02

### Created Files (`5` files)
1. `src/engine/schema/types.ts`: Strongly-typed canonical `GameDefinition` schema interfaces and discriminated unions across all 41 domain sections.
2. `src/engine/schema/operations.ts`: `GameDefinitionSchema`, `validateGameDefinition`, `assertValidGameDefinition`, `normalizeGameDefinition`, `migrateGameDefinition`, `cloneGameDefinition`, `serializeGameDefinition`, `deserializeGameDefinition`, `toGameConfig`, and `createSampleGameDefinition`.
3. `src/engine/schema/index.ts`: Barrel export for `@/engine/schema`.
4. `tests/game-definition-schema.test.ts`: Comprehensive `B02.1`, `B02.2`, and `B02.3` automated test suite covering all positive, negative, cross-reference, normalization, migration, clone, serialization, and `toGameConfig` requirements.
5. `docs/implementation/B02-game-definition-schema.md`: This implementation and schema specification document.

### Modified Files (`6` files)
1. `src/lib/blueprint/types.ts`: Extended `GridConfiguration` with optional canonical grid properties (`reelCount`, `rowCount`, `cellWidth`, `cellHeight`, `aspectRatio`, `orientation`, `minReels`, `maxReels`, `minRows`, `maxRows`).
2. `src/engine/index.ts`: Exported `./schema` from the engine barrel.
3. `src/engine/config/index.ts`: Indexed custom symbol variants (`variantsById` and `symbolsById` when referenced as independent math symbols) and `symbolFamiliesById` in `GameConfig`.
4. `src/engine/validation/index.ts`: Registered custom variant IDs (`symbol.variants[].id`) in the addressable symbol set during engine validation.
5. `docs/implementation/INDEX.md`: Added `B02` completion entry and updated cumulative test counts.
6. `docs/backups/Backup-Manifest.md`: Recorded verified Google Drive backup entries for `B02`.

---

## 7. Validation, Normalization, Migration & Cloning Summary
- **`validateGameDefinition` / `assertValidGameDefinition`**: Detects duplicate IDs, unknown reel symbols, invalid payline lengths, out-of-bounds payline row indexes, unknown paytable symbols, negative/`NaN`/`Infinity` payouts, invalid weights, unknown scene layers, unknown assets, unknown symbol sets, unknown wild/scatter symbols, unknown family/variant references, unsupported schema versions, forbidden runtime/UI properties, and non-serializable values.
- **`normalizeGameDefinition`**: Pure, deterministic, idempotent, and immutable (`deepFreeze`). Never mutates the input object and never silently repairs broken references.
- **`migrateGameDefinition`**: Explicitly migrates supported schema versions (`"0.9"` / `"1"` → `"1.0"`) and rejects unsupported source/target versions with `UnsupportedGameSchemaError`.
- **`cloneGameDefinition`**: Safely clones a `GameDefinition` under a new `gameId` and updated `metadata` while preserving all internal entity references.

---

## 8. Acceptance Criteria Coverage (1–43)
All 43 `B02` acceptance criteria pass (`100%`):
- Single canonical `GameDefinition` / `GameBlueprint` contract (`1`–`3`)
- All 23 domain configurations represented (`4`–`26`)
- UI state and Runtime state strictly excluded and rejected (`27`–`28`)
- Validation catches all dangling references, malformed reels, malformed paylines, and invalid paytable values (`29`–`32`, `37`)
- Deterministic normalization, JSON round-trip, and `toGameConfig` conversion verified (`33`–`36`)
- Automated tests (`tests/game-definition-schema.test.ts`), documentation, and production build verified with zero frontend rewrites, zero AI, and zero gameplay RNG/payout implementation in `B02` (`38`–`43`).

---

## 9. Testing & Verification Results
- `npm run typecheck`: `0` errors
- `npm run lint`: `0` errors, `0` warnings
- `npx tsx --test tests/game-definition-schema.test.ts`: `3/3` passing (`B02.1`, `B02.2`, `B02.3`)
- `npx tsx --test tests/*.test.ts`: `168/168` passing across all `24` test suites (`F01`–`F22`, `B01`, `B02`)
- `npm run build`: Next.js 16.2.6 production build succeeded (`exit_code: 0`)

---

## 10. Known Limitations & Remaining Work for B03+
- Per `B02` constraints, `B02` is strictly the schema, validation, normalization, migration, and `GameConfig` conversion foundation:
  - **B03**: Deterministic RNG subsystem & weighted selection algorithms
  - **B04**: Reel strip & stop resolution mechanics (nudges, linked reels, variable heights)
  - **B05–B09**: Payline, Wild/Scatter, Ways, Cluster, and Pay-Anywhere evaluation engines
  - **B10–B13**: Feature execution, Free Spins state machine, Multipliers, and Cascades/Board modifiers
  - **B14–B16+**: Mathematical simulation, RTP/volatility analysis, and verification suites

---

## 11. Google Drive Incremental Backup Summary
- **Destination Folder**: `Slot Studio Backups/B - Backend/B02/`
- All newly created and modified `B02` files are backed up and verified in Google Drive (exact file IDs recorded in `docs/backups/Backup-Manifest.md`).
