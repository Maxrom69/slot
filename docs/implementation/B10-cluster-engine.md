# B10 — Cluster Engine (`src/engine/clusters/index.ts`)

## 1. Section Identity
- **Section ID**: `B10`
- **Track**: Section 2 — Backend Slot Game Engine
- **Title**: Cluster Engine
- **Status**: Complete & Verified
- **Date**: 2026-10-13

---

## 2. Executive Summary
`B10` implements the **Cluster Engine** (`src/engine/clusters/index.ts`), the authoritative connected-component Cluster Pays evaluation subsystem of the Backend Slot Game Engine (`src/engine/`). It consumes a validated `GameConfig` / `ClusterConfiguration` (`B02`) and an authoritative visible `Board` (`B04`), discovers connected groups of matching symbols under configurable `"edge"` or `"hex"` adjacency using an explicit deterministic Breadth-First Search (BFS), integrates with `B07` (`WildEngine`) for Wild substitution and `B02` (`SymbolFamilyDefinition`) for optional family grouping, resolves configured `B06` paytable multipliers where defined, and returns an immutable, JSON-serializable `ClusterEvaluationResult`.

---

## 3. Architectural Purpose & Scope

### 3.1 What Makes a Cluster
In Cluster Pays games, wins are formed by spatially connected groups (connected components) of matching symbols anywhere on the board rather than fixed paylines (`B05`) or leftmost consecutive reels (`B09`). A set of cells forms a qualifying cluster when:
1. Every cell in the component matches the same effective target symbol (or configured `B02` symbol family when `allowFamilyGrouping === true`), including `B07` Wild substitutions when `allowWildJoin === true`.
2. Every cell in the component is reachable from every other cell in the component through steps defined by the configured adjacency topology (`"edge"` or `"hex"`).
3. The component contains at least one natural cell of the target symbol/family (preventing unrelated candidate symbols from claiming isolated Wilds).
4. The total number of cells in the connected component (`size`) is $\ge \text{minimumClusterSize}$.

### 3.2 Why B10 Does Not Perform Cascades or Mutate the Board
- **Board Immutability**: `B04` `Board` represents an immutable snapshot of a single board state. `B10` never removes winning cells, collapses columns, or injects new symbols.
- **Cascade Separation**: A future Cascade/Tumble engine will consume `ClusterEvaluationResult.clusters` and `ClusterEvaluationResult.winningCells` to remove winning coordinates, drop surviving symbols, refill empty positions, and invoke `B10` again on the next cascade board state. Keeping `B10` pure and stateless makes it reusable across initial spins and every subsequent cascade wave.

---

## 4. Adjacency Topologies & Connected-Component Algorithm

### 4.1 Coordinate System (from B04 Board)
- `reelIndex` ($c$): $0 \le c < \text{board.reelCount}$ (`0` = leftmost reel)
- `rowIndex` ($r$): $0 \le r < \text{board.cells}[c].\text{length}$ (`0` = top visible row)

### 4.2 Edge-Only Adjacency (`adjacency = "edge"`)
Under `"edge"` adjacency, two cells connect if and only if they share a horizontal or vertical edge (4-connected von Neumann neighborhood):
- North / Up: $(c, r - 1)$
- South / Down: $(c, r + 1)$
- West / Left: $(c - 1, r)$
- East / Right: $(c + 1, r)$

Corner-only (diagonal) contact $(c \pm 1, r \pm 1)$ is **never** connected in `"edge"` mode.

### 4.3 Hex Adjacency (`adjacency = "hex"`)
Under `"hex"` adjacency, `getAdjacentPositions(board, position, "hex", hexGridOrientation)` uses a deterministic 6-neighbor offset hex grid topology without visual pixel coordinates:
- Default orientation `"odd-q"` (vertical reel columns where odd-indexed reels $c \bmod 2 = 1$ are staggered down by $+0.5$ row relative to even-indexed reels):
  - Same-reel vertical neighbors: $(c, r - 1)$ and $(c, r + 1)$
  - Adjacent-reel same-row neighbors: $(c - 1, r)$ and $(c + 1, r)$
  - Staggered hex diagonal neighbors:
    - When $c$ is **even** ($c \bmod 2 = 0$): $(c - 1, r - 1)$ and $(c + 1, r - 1)$
    - When $c$ is **odd** ($c \bmod 2 = 1$): $(c - 1, r + 1)$ and $(c + 1, r + 1)$
- This neighbor relation is strictly **symmetric (undirected)**: $(0, 1)$ is hex-adjacent to $(1, 0)$ if and only if $(1, 0)$ is hex-adjacent to $(0, 1)$.
- Optional `"even-q"`, `"odd-r"`, and `"even-r"` orientations are also supported via `ClusterConfiguration.hexGridOrientation`.

### 4.4 Explicit BFS Connected-Component Discovery & Multiple Clusters
For each deduplicated candidate target symbol/family:
1. Allocate a flat `visited` `Uint8Array` of length `totalBoardCells` initialized to `0`.
2. Scan board coordinates in deterministic `(reelIndex, rowIndex)` order.
3. From each unvisited qualifying cell, run an explicit queue-based **Breadth-First Search (BFS)** marking neighbors in `visited` immediately upon enqueueing so no cell can ever appear twice in a component.
4. Disconnected groups of the same symbol naturally terminate in separate BFS passes and are returned as independent `ClusterWin` entries.

### 4.5 Wild Integration (`B07`) & Symbol-Family Integration (`B02`)
- **Wild Substitution (`B07`)**: When `allowWildJoin === true`, a Wild cell at `(reelIndex, rowIndex)` joins a candidate cluster for target $S$ if `wildEngine.isWild(wildId)`, `wildEngine.isWildActiveOnReel(wildId, reelIndex)`, and `wildEngine.canSubstitute(wildId, S)` all return `true`. Each `ClusterCell` preserves both `actualSymbolId` (`"WILD"`) and `effectiveSymbolId` (`"A"`). Because `visited` is scoped per candidate target, a physical Wild cell can independently join clusters for multiple different target symbols (`A` and `K`) on the same board.
- **Symbol Families (`B02`)**: When `allowFamilyGrouping === true`, symbols belonging to the same configured `B02` family are evaluated as a single family target (`familyId`), recording `participatingSymbols` and exact `symbolCounts`.
- **Family Payout Identity**: `B10` never invents a silent payout rule when multiple distinct family members participate in a cluster. It resolves `payoutSymbolId` and `baseMultiplier` only when:
  1. `familyPayoutSymbolByFamilyId[familyId]` explicitly defines the payout symbol,
  2. the paytable itself has an entry keyed by `familyId`, or
  3. only a single natural symbol ID participated in the cluster.
  Otherwise `payoutSymbolId` and `baseMultiplier` are left `undefined` while preserving `familyId`, `participatingSymbols`, and `symbolCounts` for downstream orchestrators.

---

## 5. Structured Error Model (`src/engine/errors/index.ts`)
| Error Class | Code | Trigger Condition |
|---|---|---|
| `InvalidClusterConfigurationError` | `INVALID_CLUSTER_CONFIG` | Missing/non-object cluster configuration, empty `eligibleSymbols`, or invalid serialized payload. |
| `InvalidMinimumClusterSizeError` | `INVALID_MINIMUM_CLUSTER_SIZE` | `minimumClusterSize <= 0` or non-integer. |
| `InvalidAdjacencyModeError` | `INVALID_ADJACENCY_MODE` | `adjacency` is neither `"edge"` nor `"hex"`. |
| `InvalidBoardError` | `INVALID_BOARD` | Empty board, mismatched `reelCount`, empty reel column, or invalid cell coordinates/symbol IDs. |
| `UnknownSymbolReferenceError` | `INVALID_SYMBOL_REFERENCE` | Board cell, `eligibleSymbols`, or family definition references a symbol ID not present in `symbolRegistry`. |
| `InvalidFamilyReferenceError` | `INVALID_FAMILY_REFERENCE` | Invalid/empty family ID, symbol assigned to conflicting families, or `familyPayoutSymbolByFamilyId` referencing an unknown family. |
| `InvalidPaytableReferenceError` | `INVALID_PAYTABLE_REFERENCE` | Malformed paytable source passed to `evaluateClusters`. |

---

## 6. Files Created & Modified in B10
| File Path | Action | Purpose |
|---|---|---|
| `src/engine/clusters/index.ts` | Created | Core `B10` Cluster Engine (`ClusterEngine`, `DeterministicClusterEngine`, `createClusterEngine`, `evaluateClusters`, `getAdjacentPositions`, `normalizeClusterConfiguration`, `validateBoardForClusters`, `serializeClusterEvaluationResult`, `deserializeClusterEvaluationResult`). |
| `src/engine/errors/index.ts` | Modified | Added `INVALID_CLUSTER_CONFIG`, `INVALID_MINIMUM_CLUSTER_SIZE`, `INVALID_ADJACENCY_MODE`, `INVALID_FAMILY_REFERENCE` and structured error classes `InvalidClusterConfigurationError`, `InvalidMinimumClusterSizeError`, `InvalidAdjacencyModeError`, `InvalidFamilyReferenceError`. |
| `src/engine/schema/types.ts` | Modified | Extended `ClusterConfiguration` with `ClusterAdjacencyMode`, `HexGridOrientation`, and optional `eligibleSymbols`, `familyPayoutSymbolByFamilyId`, and `hexGridOrientation`. |
| `src/engine/config/index.ts` | Modified | Added normalized `clusterConfiguration: ClusterConfiguration` to `GameConfig` and `adaptBlueprintToGameConfig`. |
| `src/engine/index.ts` | Modified | Exported `./clusters` from the root engine barrel. |
| `tests/cluster-engine.test.ts` | Created | Comprehensive unit and integration test suite (`TEST 1`–`TEST 23` + B02/B03/B04/B06/B07/B10 pipeline). |
| `docs/implementation/B10-cluster-engine.md` | Created | Section `B10` implementation report. |
| `docs/implementation/INDEX.md` | Modified | Added `B10` entry to the master implementation index. |
| `docs/backups/Backup-Manifest.md` | Modified | Recorded `B10` Google Drive backup folder and file IDs. |

---

## 7. Key Interfaces & Exports (`src/engine/clusters/index.ts`)
- `ClusterCell`: `{ readonly reelIndex: number; readonly rowIndex: number; readonly symbolId: string; readonly actualSymbolId: string; readonly effectiveSymbolId: string; readonly isWild: boolean; readonly stopIndex?: number }`
- `ClusterWin`: `{ readonly id: string; readonly symbolId: string; readonly familyId?: string; readonly size: number; readonly clusterSize: number; readonly cells: readonly ClusterCell[]; readonly participatingSymbols: readonly string[]; readonly symbolCounts: Readonly<Record<string, number>>; readonly minimumClusterSize: number; readonly adjacency: ClusterAdjacencyMode; readonly wildCount: number; readonly naturalCount: number; readonly baseMultiplier?: number; readonly totalPayout?: number; readonly payoutSymbolId?: string }`
- `ClusterEvaluationResult`: `{ readonly evaluationMode: "cluster"; readonly enabled: boolean; readonly minimumClusterSize: number; readonly adjacency: ClusterAdjacencyMode; readonly clusters: readonly ClusterWin[]; readonly qualifyingClusterCount: number; readonly totalClusterCells: number; readonly uniqueWinningCellCount: number; readonly winningCells: readonly Position[]; readonly totalBaseMultiplier?: number; readonly totalPayout?: number }`
- `ClusterEngine`: `{ evaluate(board, config?, options?): ClusterEvaluationResult; evaluateClusters(board, config?, options?): ClusterEvaluationResult }`

---

## 8. Integration with Other Engine Sections
- **B02 (`src/engine/schema/`, `src/engine/config/`)**: Consumes `ClusterConfiguration`, `CanonicalSymbolDefinition` / `NormalizedSymbolDefinition`, and `SymbolFamilyDefinition`.
- **B04 (`src/engine/board/`)**: Consumes authoritative `Board` (`board.cells[reelIndex][rowIndex]`), preserving exact `(reelIndex, rowIndex)` coordinates.
- **B06 (`src/engine/paytable/`)**: Uses `PaytableEngine` / `normalizePaytableLookup` to resolve `baseMultiplier` using `cluster.size` as the match count.
- **B07 (`src/engine/wilds/`)**: Reuses `WildEngine.isWild`, `WildEngine.isWildActiveOnReel`, and `WildEngine.canSubstitute`.

---

## 9. Verification & Test Coverage (`tests/cluster-engine.test.ts`)
All **23 mandatory B10 test scenarios** plus the full pipeline integration test pass:
- `TEST 1`: Basic edge cluster (`size = 4`, exact member cells verified)
- `TEST 2`: Exact minimum (`3` connected `A` cells $\Rightarrow$ `1` cluster)
- `TEST 3`: Below minimum (`2` connected `A` cells when `min = 3` $\Rightarrow$ `0` clusters)
- `TEST 4`: Large cluster (`7` connected `A` cells $\Rightarrow$ `1` cluster with all `7` cells)
- `TEST 5`: Two separate clusters (`2` disconnected `A` groups $\Rightarrow$ `2` independent `ClusterWin` entries)
- `TEST 6`: Diagonal only (corner-touching `A` cells do NOT form a cluster in `"edge"` mode)
- `TEST 7`: Edge adjacency (L-shaped horizontally and vertically touching cells form `1` cluster)
- `TEST 8`: Hex adjacency (hex-connected cells `(0,1)-(1,0)-(2,1)` form `1` cluster in `"hex"` mode and `0` in `"edge"` mode; neighbor symmetry verified)
- `TEST 9`: Disabled engine (`enabled: false` $\Rightarrow$ `0` clusters)
- `TEST 10`: Wild substitution (`Wild` joins `A` cluster via `B07`, preserving `actualSymbolId = "WILD"` and `effectiveSymbolId = "A"`)
- `TEST 11`: Wild cannot substitute (`B07` excluded symbol or `allowWildJoin: false` prevents `Wild` from joining)
- `TEST 12`: Multiple Wilds (`2` Wilds bridge and join an `A` cluster of `size = 4`)
- `TEST 13`: Symbol family (`B02` family members form `1` cluster when `allowFamilyGrouping: true`, preserving `participatingSymbols` and `symbolCounts` without inventing unconfigured payout rules)
- `TEST 14`: Non-family symbols (remain separate when `allowFamilyGrouping: false` or unrelated)
- `TEST 15`: Multiple symbol types (`A` cluster and `K` cluster on the same board produce independent results and can share a connecting `Wild`)
- `TEST 16`: No payline dependency (modifying or clearing `paylines` has zero effect on cluster results)
- `TEST 17`: No RNG (static source check + zero `Math.random` / `RandomSource` usage)
- `TEST 18`: Determinism (`100` identical runs produce deep-equal results and deterministic `symbolId -> anchor reelIndex -> anchor rowIndex` ordering)
- `TEST 19`: Input immutability (`Board`, `ClusterConfiguration`, and deeply frozen `ClusterEvaluationResult` verified)
- `TEST 20`: Serialization round-trip (`serializeClusterEvaluationResult` / `deserializeClusterEvaluationResult`)
- `TEST 21`: Invalid minimum (`minimumClusterSize <= 0` throws `InvalidMinimumClusterSizeError`)
- `TEST 22`: Invalid adjacency (unsupported adjacency mode throws `InvalidAdjacencyModeError`)
- `TEST 23`: Empty board & invalid symbol/family references throw structured errors (`InvalidBoardError`, `UnknownSymbolReferenceError`, `InvalidFamilyReferenceError`)

---

## 10. Build, Lint, and Typecheck Verification
- `npm run typecheck`: **0 errors**
- `npm run lint`: **0 errors, 0 warnings**
- `npx tsx --test tests/*.test.ts`: **191 / 191 passing** across `32` test suites
- `npm run build`: **Production Next.js build succeeded**

---

## 11. Determinism, Immutability, and Ordering Guarantees
- **Deterministic Ordering**:
  - Within each `ClusterWin`, `cells` are sorted by `reelIndex` ascending, then `rowIndex` ascending.
  - `participatingSymbols` are sorted lexicographically.
  - `ClusterEvaluationResult.clusters` are sorted by `symbolId` ascending, then anchor `cells[0].reelIndex` ascending, then anchor `cells[0].rowIndex` ascending.
- **Zero Side Effects**: Input `Board` and `ClusterConfiguration` are never mutated; output structures are deeply frozen via `Object.freeze`.

---

## 12. Edge Cases Handled
- Shared Wild cells bridging multiple distinct symbol clusters (`totalClusterCells` vs deduplicated `uniqueWinningCellCount` / `winningCells`).
- Clusters larger than the highest configured paytable match count tier fall back to the highest configured tier $\le \text{clusterSize}$.
- Multi-member symbol families without an explicit family payout rule preserve `familyId`, `participatingSymbols`, and `symbolCounts` without inventing a payout symbol.

---

## 13. Known Limitations & Deferred Responsibilities
- **Pay-Anywhere Evaluation (`B11`)**: Total board symbol count scatter-pay mechanics are deferred to `B11`.
- **Cascades / Tumbles (`B12+`)**: Removing `winningCells`, dropping surviving symbols, and refilling the board are deferred to later feature/cascade sections.
- **Unified Round Settlement (`B12+`)**: Combining line, ways, cluster, scatter, and feature wins into final round settlement is deferred to the win orchestrator.

---

## 14. Pre-Section & Post-Section File Manifest Comparison
- **Pre-`B10` file count** (`src`, `tests`, `docs`): `326` files (`/tmp/pre-b10-manifest.txt`).
- **Post-`B10` file count** (`src`, `tests`, `docs`): `329` files (`+3` new files: `src/engine/clusters/index.ts`, `tests/cluster-engine.test.ts`, `docs/implementation/B10-cluster-engine.md`; `6` modified files: `src/engine/errors/index.ts`, `src/engine/schema/types.ts`, `src/engine/config/index.ts`, `src/engine/index.ts`, `docs/implementation/INDEX.md`, `docs/backups/Backup-Manifest.md`).

---

## 15. Google Drive Backup Synchronization
All `9` created/modified files for `B10` are backed up under `Slot Studio Backups/B - Backend/B10/` and cataloged in `docs/backups/Backup-Manifest.md`.

---

## 16. Readiness Confirmation for B11
`B10 — Cluster Engine` is complete, verified, documented, and backed up. In accordance with the Arena Checkpoint Rule, execution stops here and awaits explicit approval before proceeding to `B11`.
