# B16 — Math Simulation & Statistics Engine

## 1. Section ID and confirmed name
**B16 — Math Simulation & Statistics Engine.** Re-audited and repaired on 2026-10-16. Implementation: **COMPLETED**. Stop at B16; no next-phase authorization is implied.

## 2. Objective and scope
Audit the existing B16 implementation against its report, repair missing execution and statistics behavior, and verify necessary code plus repository regressions. This is a source-code repair, not just a rerun of the original tests. Existing later-section work was already present at the repair baseline and is preserved, not resumed or attributed to this repair.

## 3. Requirements and explicit exclusions
Real B04–B15 outcomes, deterministic B03 RNG, complete paid rounds including feature continuations, exact monetary aggregation, statistics, authored verification expectations, replay, comparisons, guards, and target-compliance extension points. No frontend redesign, runtime/API additions, AI agents, manufactured wins, autonomous reel optimization, or next architectural phase. Class II/Class III remain model metadata, not a newly implemented Class II outcome-authority system.

## 4. Implementation summary
- Replaced incomplete feature continuation with `executeStatisticalRound`: one paid base step followed by real B12 feature steps using alternate reels, B13 cascades/locks, B14 multipliers/assigned-value collection, and B15 actions/meters on every step. Feature state and persistent board state are propagated and cleared according to their scopes.
- The configured global max-win cap applies to the entire paid round. Wager is charged once; source, base-game, feature, and total payouts reconcile in integer micro-units. Per-feature contributions follow actual B12 IDs, including upgraded features, rather than assigning every award to the initial feature.
- Added effective mechanics configuration to version-2 replay records, canonical configuration fingerprints, byte-seed transport, validation, optional raw samples/diagnostics, and fail-fast/collect-and-continue consistency. Failed attempts do not become wagers or losing spins.
- Canonical B02 definitions are validated and their enabled win-evaluation modes actually select B09/B10/B11; canonical free-spin count/retrigger/fixed-multiplier settings are honored. Advanced or non-free-spin feature policies require explicit B12 configuration rather than silent omission.
- Fixed a shared B03 dependency: snapshots now preserve optional active/root seed identities. Numeric/byte seeds and fork ancestry survive JSON restoration, including subsequent forks. Invalid seed lineage or namespace is rejected before state mutation.

## 5. Exact repair file list
The hash baseline was captured **after** the already-paused work: `/tmp/pre-b16-redo-sha256.txt` (359 files under `src`, `tests`, `docs`). Post-repair inventory: **362 files**; **3 created, 6 modified, 0 deleted**. No paused later-section-only file was changed or backed up.

| Path | Action | Reason |
| --- | --- | --- |
| `src/engine/math/simulation-support.ts` | Created | Canonical hashing, strict validation, safe fixed-point arithmetic and reporting-only source allocation. |
| `tests/math-simulation-repair.test.ts` | Created | 27 newly authored repair tests. |
| `docs/backups/Backup-Manifest-before-B16-repair.md` | Created | Byte-for-byte archive of the previous cumulative manifest; preserves all historical records while the active manifest is made concise and synchronized. |
| `src/engine/math/index.ts` | Modified | Complete rounds, canonical modes, statistics, guards, replay and validation repairs. |
| `src/engine/rng/index.ts` | Modified | Supporting seed-identity/lineage snapshot restoration fix. |
| `docs/implementation/B03-rng-system.md` | Modified | Supporting dependency-fix addendum; original B03 delivery remains historical. |
| `docs/implementation/B16-math-simulation-and-statistics-engine.md` | Modified | This replacement audit report, including corrected API names and limitations. |
| `docs/implementation/INDEX.md` | Modified | Current B16 repair evidence and cumulative verification. |
| `docs/backups/Backup-Manifest.md` | Modified | Current repair upload inventory, verification and historical archive reference. |

`tests/math-simulation-engine.test.ts` and the supplied original verification cases remain byte-for-byte unchanged. Existing errors, round-execution dispatcher, runtime, server and API files were not repair changes.

## 6. Architecture and dependencies
B16 consumes normalized blueprints/configuration using B02 and composes existing B03–B15 engines through the shared atomic round-step executor. It does not duplicate reel evaluation, feature-state authority, multipliers, meters or bankroll settlement in another engine. Existing dispatcher/runtime hooks in the shared math module predate this repair and remain compatible.

The master deterministic RNG advances once per executed base/feature board action; each action derives isolated reel/tumble/value streams. Failed collected attempts restore their pre-attempt state and consume one deterministic parent draw. Batch partitioning does not alter mechanics. An injected `monotonicNowMs` is required for elapsed-time guards; no host clock is read inside the engine.

## 7. Contracts and actual public APIs
Exports retain B01 `MathModel`, `deriveMathModel`, `SimulationRunConfig`, `SimulationRunner`, and compatible report fields. B16 contracts include simulation/run/spin/report/stats, feature contributions, replay, verification, comparison and target types.

Actual APIs on `createMathSimulationEngine({ monotonicNowMs? })`:
- `run(source, simulationConfig)` and B01-compatible `runSimulation(source, runConfig)`.
- `verifyCase(source, verificationCase, baseConfig?)` and **`verifyCases`**, not the old report's nonexistent `verifySuite` alias.
- `replaySpin(source, replayPackage, options?)`.
- **`compareReports`**, not `compareSimulationReports`.
- **`evaluateTargetCompliance`** and exported `evaluateMathTargetCompliance`; the old report's instance-method alias `evaluateTarget` does not exist.

Options include `maxFeatureStepsPerRound`, `maxCascadeStepsPerSpin`, `maxOperationsGuard`, `maxElapsedMsGuard`, `winDistributionBuckets`, `mechanicOperations`, `retainRawWinSamples`, and `includeDiagnostics`. Runtime validation rejects unsupported combinations instead of silently treating them as active.

## 8. Data flow and persistence
Simulation options are cloned, source configuration is validated/normalized, effective mechanics are resolved, and real complete-round results feed integer 10,000-units-per-credit accumulation, online Welford variance, frequency/distribution/percentile/MAD summaries, feature/source/cascade/multiplier/bankroll metrics and optional traces. Safe-integer overflow is rejected. Settlement source allocation is reporting-only and never creates an award.

Version-2 replay records carry mechanics, board/feature/meter state, step kind and fingerprints. Replay checks definition, algorithm, revision, version, paylines and conflicting caller overrides. Captured feature steps can also replay independently. Byte-array seeds survive report/replay JSON transport. The first **successful** spin supplies the sample replay; all-failed reports have none.

No persistent simulation database, worker queue or frontend state is introduced. Regression tests use an isolated seeded local database; the original database was restored and its SHA-256 verified equal afterward.

## 9. Integration points
B04 reels/boards; B05–B08 paylines/paytables/wilds/scatters; B09 ways; B10 clusters; B11 pay-anywhere; B12 authoritative lifecycle/retrigger/upgrade history and feature caps; B13 cascades/locks/persistent boards; B14 real multiplier and value settlement; B15 meters/actions and losing-spin policies. Existing B17/B18 code is covered only as regression evidence and remains paused.

## 10. UI controls and expected behavior
Not applicable: backend math only. No UI, keyboard shortcuts, frontend verification mode or browser dependencies were added. Expected behavior is exposed through the typed APIs and deterministic test fixtures, not hard-coded gameplay results.

## 11. Executed verification and actual results
All final code checks passed:

| Command/check | Actual result |
| --- | --- |
| `npx tsx --test tests/math-simulation-engine.test.ts tests/math-simulation-repair.test.ts` | **37/37 PASS**: original 10 plus 27 new tests. |
| `npx tsx --test --test-concurrency=1 tests/*.test.ts` | **345/345 PASS**, 174 top-level tests, 14 suites, 42 test files; isolated database seeded first with `npx tsx --test tests/dashboard.test.ts`. |
| `npm run typecheck` | PASS, no TypeScript errors. |
| `npm run lint` | PASS, no ESLint errors or warnings. |
| `npm run build` | PASS; production compilation and TypeScript completed. |
| Original local database restoration | SHA-256 equals the saved pre-test original. |
| Original B16 tests and preexisting later-section files | Baseline hash comparison unchanged, except shared math and the explicitly listed supporting RNG fix. |

Evidence logs: `/tmp/b16-redo-tests.log`, `/tmp/b16-redo-regression.log`, `/tmp/b16-redo-lint.log`, `/tmp/b16-redo-build.log`. These temporary logs are not recovery deliverables.

New expected amounts were authored from fixture arithmetic, not generated from engine output: two-spin 18/20 = 90% RTP and variance 0.81; two alternate-reel feature awards of 20 = 40 on one 5-credit wager; global-cap settlement 20+5 = 25; assigned-value collection 40 plus line win 9 = 49; explicit cascade policy settles 9+10 = 19 because only winning cells refill; upgrade awards 20+30+30 = 80, attributed 20 to `fs` and 60 to `super`; canonical anywhere fixture 5×(20+4+10+2) = 180 versus zero in the authored ways/cluster fixtures.

## 12. Requirement-by-requirement status
| Requirement | Status | Evidence |
| --- | --- | --- |
| Real complete paid rounds and B12–B15 feature continuation | PASS | Alternate reels, multiplier, feature cascades, persistent meter, value collection, upgrade attribution and losing-action fixtures. |
| Integer wager/payout/RTP, cap and overflow safety | PASS | Authored arithmetic, base/feature caps, strict currency validation and regression suites. |
| Hit/max-win/distribution/percentiles/variance/MAD | PASS | Original and repaired known-outcome fixtures, samples and diagnostics. |
| Feature/source/cascade/multiplier/bankroll reporting | PASS | Authoritative B12 history, upgraded feature IDs, reconciled awards and partial-win depletion checks. |
| Authored fixed-stop verification and structured differences | PASS | Original verification tests preserved; no expected results auto-filled. |
| Self-contained replay, seed transport, batch equivalence/comparison | PASS | JSON replay, independent child step, losing policy, seed lineage, conflicting options, hash and algorithm checks. |
| Strict validation and fail-fast/collect-and-continue | PASS | Invalid configurations, inner board/time/feature guards, all-failed reports and unsuccessful-attempt exclusion. |
| Canonical game definition mode/policy consumption | PASS | Validated B02 input; actual ways/cluster/anywhere selection; unsupported advanced policies require explicit configuration. |
| Target compliance and model metadata | PASS | Existing target tests plus malformed target rejection; optimization explicitly excluded. |
| Production checkpoint and current-workspace regressions | PASS | 345 tests, typecheck, lint and build above. |

## 13. Honest limitations and unverified behavior
- Exact percentiles and MAD retain a return-frequency map: **O(distinct returns)** memory, not O(1). Optional retained traces/raw samples add their own memory. A round temporarily retains its bounded feature steps even when output traces are disabled. No million-spin performance certification was performed.
- An explicitly authored cascade limit is a mechanic termination policy and may settle a still-winning board. The implicit default is instead a safety guard and rejects unfinished execution. There is no dedicated termination-reason field; inspect the effective replay configuration. Existing supplied cascade-cap cases were not rewritten.
- Fingerprints are canonical, noncryptographic FNV-style identity/checksum aids, **not signatures or tamper-proof authorization**.
- `losingSpinCondition` and `losingSpinActions` cannot be supplied together; custom `losingSpinActions.maxDepth` is rejected. Non-base `selectedModeId` is not a standalone simulation entry point: features enter through the base round. Explicit B12 policy is required for non-free-spin features and advanced canonical reel/progressive-multiplier feature settings.
- Legacy root RNG snapshots remain supported. Legacy fork/custom-seed snapshots without recoverable lineage are rejected rather than silently replayed under a different seed; new snapshots include `seedIdentity`.
- An injected elapsed-time guard is host-dependent by definition; no timing-independent wall-time claim is made. The operation budget counts board evaluations, not every low-level instruction; B12–B15 retain their own recursion/mechanic validation.
- No autonomous calibration optimizer, simulator UI, worker orchestration or persistent run store is claimed. Production payout certification and exhaustive combinations of every possible authored mechanic remain outside this checkpoint.

## 14. Remaining work and stop boundary
No observed failing tests or build errors remain in the verified scope. Keep the limitations above explicit. **STOP at B16. Do not continue to B17 or resume B18.** Future architecture work requires a new instruction.

## 15. Google Drive backup location and status
Incremental destination: `Slot Studio Backups/B - Backend/B16/`, folder `1nhOguGZBADUaZGWapx7-bpuBLvizGi5A`. The repair uses real nested `src/engine/{math,rng}`, `tests`, `docs/implementation`, and `docs/backups` folders. Earlier slash-named flat backups remain preserved as historical copies; the nested repair files are authoritative for this repair.

Status: **SUCCESS** (file identities, nested parents, byte sizes and MD5 checksums verified against the workspace; complete per-file records in the active manifest). Upload only the nine repair-created/modified files listed in section 5; do not upload unchanged original tests/errors, paused-work files, build caches, logs or the database. The active manifest records exact file IDs, sizes/checksums and verification; its previous full cumulative history is preserved verbatim in the archive. Synchronize the canonical root `Backup Manifest.md` (`1nPfzpYU4k3oZ2jYa6mqmDezVLDhuKXYn`) without creating another duplicate root file.

## 16. Last update date
**2026-10-16, America/Halifax.** Final B16 repair verification completed this date. This report supersedes the earlier B16 claims about API names, constant-memory statistics and incomplete feature-round execution.
