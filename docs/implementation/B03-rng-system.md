# B03 — RNG System

## 1. Section Metadata
- **Section ID**: `B03`
- **Section Name**: RNG System
- **Category**: `B - Backend` (`SECTION 2 — BACKEND / SLOT GAME ENGINE`)
- **Implementation Status**: `COMPLETE`
- **Date Completed**: `2026-10-12`
- **Default PRNG Algorithm**: `mulberry32` (`algorithmVersion: 1`, `algorithm: "mulberry32-v1"`)
- **Additional Versioned PRNG Algorithm**: `sfc32` (`algorithmVersion: 1`, `algorithm: "sfc32-v1"`)

---

## 2. Executive Summary
`B03` implements the deterministic, testable, headless **Random Number Generation (RNG) Subsystem** (`src/engine/rng/index.ts`) for the Slot Game Engine. All gameplay randomness flows through the explicit `RandomSource` / `DeterministicGameRng` abstraction — never through `Math.random()`, `Date.now()`, `performance.now()`, browser APIs, or global mutable singletons. It provides deterministic seed normalization, domain-separated substream derivation (`fork`), unbiased rejection-sampled bounded integer generation (`nextInt`), uniform float generation (`nextFloat`), probability boolean generation (`nextBoolean`), uniform array selection (`pick`), relative-weight selection (`weightedPick`), serializable state snapshots (`snapshot` / `restore`), optional diagnostic audit trails (`recordAudit`), and versioned algorithm routing for deterministic replay.

---

## 3. Selected PRNG Algorithms & Explicit Versioning

### 3.1 Primary Default Algorithm: `mulberry32-v1`
- **Identifier**: `algorithm: "mulberry32-v1"`, `algorithmName: "mulberry32"`, `algorithmVersion: 1`
- **Design**: 32-bit Weyl-sequence PRNG designed by Tommy Ettinger. Each draw increments the 32-bit state word by `0x6D2B79F5` modulo `2^32` and applies two 32-bit integer avalanche multiplications (`Math.imul`) with xorshifts.
- **Properties**: Pure 32-bit integer arithmetic (`Math.imul`, unsigned right-shift `>>> 0`), zero heap allocation per draw, identical bit-exact output across Node.js, V8, Web Workers, and headless simulation runtimes.

### 3.2 Secondary Versioned Algorithm: `sfc32-v1`
- **Identifier**: `algorithm: "sfc32-v1"`, `algorithmName: "sfc32"`, `algorithmVersion: 1`
- **Design**: Chris Doty-Humphrey's 128-bit **Small Fast Counting (`SFC32`)** PRNG (three 32-bit mixing words + one 32-bit Weyl counter word).
- **Purpose**: Registered in `SUPPORTED_RNG_ALGORITHMS` to support 128-bit state streams and demonstrate explicit multi-algorithm/multi-version replay routing via `resolveRngAlgorithmId(algorithm, version)` and `createRngFromReplayInput()`. Unsupported algorithms or versions throw `UnsupportedRngAlgorithmError` (`UNSUPPORTED_RNG_ALGORITHM`).

### 3.3 Cryptographic Security Distinction
- `DeterministicGameRng` (`SeededRNG`) is a **deterministic gameplay, simulation, verification, and replay PRNG**. It is **NOT** a cryptographically secure PRNG (`CSPRNG`) and is never advertised as one.
- A separate `SecureRandomSource` interface boundary (`{ readonly isCryptographic: true; randomBytes(byteLength: number): Uint8Array }`) is declared so non-gameplay cryptographic needs remain strictly separated from deterministic gameplay execution.

---

## 4. Seed Format, Normalization & Substream Derivation (`fork`)

### 4.1 Supported `SeedInput` Formats & `normalizeSeed(input)`
`normalizeSeed(input: SeedInput): CanonicalSeed` deterministically converts:
- **Strings** (e.g. `"B03-test-seed"`) → `canonical: "str:B03-test-seed"`
- **Finite Numbers** (e.g. `42`, `0`, `-0` normalized to `"0"`) → `canonical: "num:42"`
- **Byte / Word Arrays** (`Uint8Array` or `readonly number[]` of finite integers) → `canonical: "bytes:00000001:00000002:..."`
- **`CanonicalSeed`** objects (idempotent pass-through)

Each `CanonicalSeed` carries:
- `primaryUint32`: Non-zero 32-bit FNV-1a hash word (`fnv1aUint32`) for `mulberry32-v1`.
- `seedWords`: 4 × 32-bit words derived via `cyrb128` + MurmurHash3 `fmix32` avalanche mixing for 128-bit `sfc32-v1`.
- Empty strings, whitespace-only strings, `null`, `undefined`, `NaN`, `Infinity`, `-Infinity`, and empty byte arrays are rejected with `InvalidSeedError` (`INVALID_SEED`).

### 4.2 Domain-Separated Substreams (`rng.fork(namespace)` & `deriveSeed`)
```text
Root RNG ("root")
 ├── rng.fork("reels")      -> streamNamespace: "root/reels"
 ├── rng.fork("features")   -> streamNamespace: "root/features"
 ├── rng.fork("bonuses")    -> streamNamespace: "root/bonuses"
 ├── rng.fork("board")      -> streamNamespace: "root/board"
 └── rng.fork("simulation") -> streamNamespace: "root/simulation"
```
- **Explicit Fork Model**: Calling `rng.fork(namespace)` derives a child `SeededRNG` deterministically from `(rootCanonicalSeed, "${this.streamNamespace}/${namespace}")` via `deriveSeed()`.
- **Stream Isolation Guarantees**:
  1. Calling `rng.fork(namespace)` **never mutates or advances** the parent stream's internal state or `getDrawCount()`.
  2. Consuming draws on a sibling stream (e.g. `features` or `diagnostics`) **never alters** the sequence produced by `reels` or the parent stream.
  3. The same root seed + same namespace path always produces the exact same child sequence regardless of when `fork()` is called.

---

## 5. Core RNG Operations & Numerical Contracts

### 5.1 `nextUint32(): number`
- Returns an unsigned 32-bit integer in the closed interval `[0, 4294967295]` (`[0, 2^32 - 1]`).

### 5.2 `nextFloat(): number`
- Returns a uniform double-precision float in the half-open interval `[0, 1)` (`0 <= value < 1`), computed as `nextUint32() / 4294967296` (`2^-32` step resolution).

### 5.3 `nextInt(minInclusive, maxExclusive)` & `nextInt(maxExclusive)`
- **Range Contract**: Half-open `[minInclusive, maxExclusive)` (or `[0, maxExclusive)` when called with 1 argument).
- **Unbiased Rejection Sampling**:
  - Eliminates both floating-point multiplication bias (`Math.floor(nextFloat() * range)`) and naive modulo bias (`r % range`).
  - For `range = maxExclusive - minInclusive` (`1 <= range <= 2^32`):
    - Computes `threshold = 2^32 - (2^32 % range)`, the largest exact multiple of `range` within `2^32`.
    - Draws `r = drawRawUint32()` until `r < threshold`, then returns `minInclusive + (r % range)`.
  - Every integer in `[minInclusive, maxExclusive)` has exact probability `1 / range`.
  - Invalid bounds (`min >= max`, non-integers, `NaN`, `Infinity`, or `range > 2^32`) throw `InvalidRangeError` (`INVALID_RANGE`).

### 5.4 `nextBoolean(probability = 0.5): boolean`
- Validates `0 <= probability <= 1` (finite number); otherwise throws `InvalidProbabilityError` (`INVALID_PROBABILITY`).
- `probability === 0` always returns `false`; `probability === 1` always returns `true` (consuming 1 draw for uniform stream advancement).

### 5.5 `pick<T>(items: readonly T[]): T`
- Rejects empty arrays with `EmptySelectionError` (`EMPTY_SELECTION`).
- Selects uniformly via unbiased `this.nextInt(0, items.length)` without mutating `items`.

### 5.6 `weightedPick<T>(items: readonly WeightedItem<T>[]): T`
- Validates every entry has a finite, non-negative numeric `weight`; rejects negative, `NaN`, `Infinity`, or overflow weights with `InvalidWeightError` (`INVALID_WEIGHT`), empty arrays with `EmptySelectionError` (`EMPTY_SELECTION`), and zero total weight with `ZeroTotalWeightError` (`ZERO_TOTAL_WEIGHT`).
- **Scale Invariance & Zero-Weight Exclusion**:
  - Computes `target = (drawRawUint32() / 2^32) * totalWeight`, so proportional weights (e.g. `[1, 2, 7]` and `[10, 20, 70]`) produce the exact same selection on every draw.
  - Skips `weight <= 0` items during cumulative traversal and clamps any upper-boundary float rounding to `lastPositiveIndex`, guaranteeing zero-weight items (even at the end of the array) are **never** selected.

---

## 6. State Snapshot, Restoration, Replay & Audit Trail

- **`snapshot()` / `getState()`**: Returns an immutable, JSON-serializable `RngStateSnapshot` containing `algorithm`, `algorithmName`, `algorithmVersion`, `originalSeed`, `canonicalSeed`, `streamNamespace`, `internalState`, `stateWords`, `callCount`, and `drawCount`.
- **`restore(snapshot)`**: Validates algorithm compatibility, seed, state words, and draw count (throwing `InvalidRngStateError` on corruption) and restores the stream so subsequent draws match the original sequence identically.
- **`serializeRngState(snapshot)` & `deserializeRngState(json)`**: Lossless JSON serialization and restoration into a new `DeterministicGameRng` instance.
- **`createRngFromReplayInput(input)`**: Reconstructs the exact versioned RNG stream from a `ReplayRngInput` (`seed`, `rngAlgorithm`, `algorithmVersion`, `streamNamespace`, optional `stateSnapshot`).
- **Optional Audit Trail (`recordAudit: true`)**: Disabled by default for zero simulation overhead; when enabled, records structured `RngAuditRecord` items (`streamNamespace`, `operation`, `drawIndexBefore`, `drawIndexAfter`, `request`, `result`) inspectable via `getAuditTrail()`.

---

## 7. Files Created & Modified in B03

### Created Files (`3` files)
1. `tests/rng-system.test.ts`: Comprehensive `B03.1`–`B03.4` automated test suite covering fixed-seed vectors, seed normalization, algorithm versioning, unbiased bounded integers, float/boolean/pick contracts, weighted selection scale invariance & zero-weight exclusion, state snapshot/restore/serialization, substream fork isolation, multi-engine isolation, audit trail, and static `Math.random()` verification.
2. `docs/implementation/B03-rng-system.md`: This implementation and architectural specification document.

### Modified Files (`4` files)
1. `src/engine/errors/index.ts`: Added `RngError`, `InvalidSeedError`, `InvalidRangeError`, `InvalidProbabilityError`, `EmptySelectionError`, `InvalidWeightError`, `ZeroTotalWeightError`, `InvalidRngStateError`, and `UnsupportedRngAlgorithmError`.
2. `src/engine/rng/index.ts`: Implemented the complete `B03` RNG subsystem (`RandomSource`, `DeterministicGameRng`, `SecureRandomSource`, `SeededRNG` with `mulberry32-v1` and `sfc32-v1`, `normalizeSeed`, `deriveSeed`, unbiased `nextInt`, `nextBoolean`, `pick`, `weightedPick`, `fork`, `snapshot`, `restore`, `serializeRngState`, `deserializeRngState`, `createRandomSource`, `createRngFromReplayInput`, and optional audit recording).
3. `docs/implementation/INDEX.md`: Added `B03` completion entry and updated cumulative test counts.
4. `docs/backups/Backup-Manifest.md`: Recorded verified Google Drive backup entries for `B03`.

---

## 8. Acceptance Criteria Coverage (1–42)
All 42 `B03` acceptance criteria pass (`100%`):
- Formal `RandomSource` / `DeterministicGameRng` abstraction & versioned `mulberry32-v1` / `sfc32-v1` PRNG (`1`–`4`)
- Deterministic `normalizeSeed`, identical seed reproducibility, distinct seed independence (`5`–`7`)
- Documented `nextFloat()` `[0, 1)` and unbiased `nextInt(min, max)` `[min, max)` rejection sampling (`8`–`10`)
- `nextBoolean()`, `pick()`, and `weightedPick()` with full rejection of negative, `NaN`, `Infinity`, zero-total, and empty inputs, and strict exclusion of zero-weight items (`11`–`19`)
- State `snapshot()`, `restore()`, JSON serialization, domain-separated `fork(namespace)`, multi-engine isolation, and replay routing (`20`–`30`)
- Fixed-seed, weighted-selection, bounded-integer, snapshot/restore, fork, engine-isolation, and serialization tests (`31`–`37`)
- High-throughput allocation-free primitive draw loop suitable for headless simulation, zero `Math.random()`, zero browser dependencies, zero UI/slot mechanics/AI added in `B03`, and existing frontend build verified (`25`–`27`, `38`–`42`).

---

## 9. Testing & Verification Results
- `npm run typecheck`: `0` errors
- `npm run lint`: `0` errors, `0` warnings
- `npx tsx --test tests/rng-system.test.ts`: `4/4` passing (`B03.1`, `B03.2`, `B03.3`, `B03.4`)
- `npx tsx --test tests/*.test.ts`: `172/172` passing across all `25` test suites (`F01`–`F22`, `B01`, `B02`, `B03`)
- `npm run build`: Next.js 16.2.6 production build succeeded (`exit_code: 0`)

---

## 10. Known Limitations & Remaining Work for B04+
- **Cryptographic Distinction**: `SeededRNG` (`mulberry32-v1` / `sfc32-v1`) is a deterministic gameplay and simulation PRNG, not a CSPRNG.
- ** bounded integer span**: `nextInt(min, max)` supports any safe integer range up to `2^32` (`4,294,967,296`) per single 32-bit rejection-sampled draw.
- **Remaining Backend Sections (`B04+`)**:
  - `B04`: Reel strip & stop resolution mechanics consuming `RandomSource`
  - `B05`–`B09`: Payline, Wild/Scatter, Ways, Cluster, and Pay-Anywhere evaluation engines
  - `B10`–`B13`: Feature triggers, Free Spins, Multipliers, Cascades, and Board modifiers
  - `B14+`: RTP simulation, state management, and verification suites

---

## 11. Google Drive Incremental Backup Summary
- **Destination Folder**: `Slot Studio Backups/B - Backend/B03/`
- All files created or modified in `B03` are backed up and verified in Google Drive (exact file IDs recorded in `docs/backups/Backup-Manifest.md`).


## Supporting repair during B16 audit — 2026-10-16
The B16 replay audit found that `restore` normalized the saved `originalSeed` string again, changing numeric/byte seed identity and losing the root lineage used for future forks. `src/engine/rng/index.ts` now adds optional immutable `seedIdentity.active/root` records to snapshots, restores them, validates their shape and lineage plus stream namespace before mutation, and preserves JSON round trips. Legacy root snapshots are supported; fork/custom legacy snapshots without recoverable identity are rejected explicitly rather than silently changing replay behavior.

This is a necessary dependency fix within **B16**, not a new architectural phase. Its exact delta and incremental backup belong to the B16 repair record. `tests/math-simulation-repair.test.ts` exercises numeric, byte and string seeds, root/child streams and future forks under both algorithms. Original B03 tests and all **345/345** current repository tests pass, along with typecheck, lint and production build. See `docs/implementation/B16-math-simulation-and-statistics-engine.md` for the current checkpoint, exact files and limitations; stop after B16.
