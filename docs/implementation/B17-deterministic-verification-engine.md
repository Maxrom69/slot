# B17 — Deterministic Verification Engine

## 1. Section identity
- Section 2 — Backend Slot Game Engine; B17.
- Last updated: **2026-10-16**.
- Implementation: **COMPLETE**; no B18 implementation.

## 2. Objective and scope
Provide exact, reproducible, fixed-stop verification of the existing backend, independently of statistical tolerances. GameBlueprint, GameDefinition and normalized GameConfig are accepted. Cases contain authored expectations, inputs, stable IDs and optional version constraints; the verifier does not infer expected outcomes.

## 3. Requirements and exclusions
Reuse B01–B16 public contracts, B03 seeded streams and B04 circular-strip representation. Observe real wins, features, cascades, B14 values/multipliers, B15 meter actions and settlement. No UI, React, AI, external gameplay API, new payout algorithm, reel implementation, balancing algorithm or expected-result updater was introduced.

## 4. Implementation summary
`createVerificationEngine()` constructs the stateless `DeterministicVerificationEngine`. `runCase`, `runSuite` and `replay` invoke B16's existing complete-round executor. Optional instrumentation copies and freezes observations without giving observers writable production state. Case execution clones supplied inputs; it never freezes or repairs caller-owned cases.

The existing B16 `VerificationCase` is extended additively rather than replaced. The B01 outcome-only helper and its existing API remain available; B17 exact checks do not use that helper's legacy payout tolerance. B01 `VerificationResult` is extended with optional detail fields, and B17 `VerificationRun` requires the full detailed result contract.

Two shared-runner integration defects discovered during testing were corrected: cascade progression now requires an initialized B14 tumble state; B15 event-triggered threshold prizes and action results are no longer discarded before settlement. No existing regression expectations were changed. B17's explicit execution input also supports active feature reels, starting runtime snapshots and bounded feature/cascade execution.

## 5. Files created, modified and deleted
Created:
- `src/engine/math/round-execution.ts` — shared observation/input contracts and dispatch to existing public mechanic APIs.
- `src/engine/verification/deterministic.ts` — verification, validation, first differences, reports, baseline protection and replay.
- `tests/deterministic-verification-engine.test.ts` — 20 deterministic tests.
- `tests/fixtures/verification-baseline.ts` — explicitly authored stable baseline, not generated actuals.
- `docs/implementation/B17-deterministic-verification-engine.md` — this report.

Modified:
- `src/engine/math/index.ts` — additive case fields and read-only observations in the existing complete-round runner; integration corrections described above.
- `src/engine/verification/index.ts` — backward-compatible contracts and B17 exports.
- `src/engine/errors/index.ts` — structured suite, revision, expectation, execution, replay and baseline errors.
- `docs/implementation/INDEX.md` — B17 entry and cumulative results.
- `docs/backups/Backup-Manifest.md` — incremental backup inventory.

Deleted: **none**. No frontend source, existing expected-result fixture, package manifest or schema version changed.

## 6. Architecture and dependencies
Actual execution remains in `DeterministicMathSimulationEngine.executeSingleRound`, shared with B16, with its real B04 resolver, board builder, active B05–B11 evaluators, B12 lifecycle, B13 transforms, B14 state/value logic and B15 meters. Verifier code only validates case inputs, invokes that executor, compares observations and constructs diagnostics.

For targeted mechanics, `MechanicOperation` selects an allowlisted existing public method on board, feature, multiplier or logic engines. Argument tuples derive from those authoritative TypeScript method signatures with state prefixes supplied by the shared executor. Serializable references such as `{$ref:"board"}`, `{$ref:"rng"}`, `{$ref:"boardState"}` and `{$ref:"featureEngine"}` supply real current context. No operation code receives expectations or implements a mechanic.

Operations are placed at `beforeWins`, `afterValues`, `beforeFeatures` or `afterLogic`. Raw method results are inspectable independently; configuration-driven settlement still follows B16's real currency/source accounting. Do not assume every raw intermediate value-returning API automatically awards credits: author settlement configuration or check its actual returned result, as appropriate.

## 7. Contracts and public APIs
Exports through `src/engine/index.ts` include:
- `VerificationEngine`, `DeterministicVerificationEngine`, `createVerificationEngine`.
- Existing `VerificationCase`, extended with `definitionRevision`, `definitionHash`, `engineVersion`, tags, suite IDs, metadata, `input`, `checks`, `expectedEventSequence` and losing-spin condition configuration.
- `VerificationInput`, `VerificationSuite`, `VerificationRun`, `VerificationStatus`, `VerificationDifference`, `VerificationReport`, `VerificationReplayMetadata`.
- `BoardExpectation`, `WinExpectation`, `FeatureExpectation`, `MultiplierExpectation`, `ValueExpectation`, `MeterExpectation`, `TraceExpectation`, `StructuralExpectation`.
- `createVerificationBaseline`, `fingerprintVerificationData`, `exportVerificationActual`.

`StageExpectation` selects a stage and zero-based occurrence, with an explicitly authored object. Object fields present in the expectation are recursively compared; arrays have exact length and ordering; numbers are compared exactly without tolerance or re-rounding. Omitted object fields are intentionally not asserted. Missing actual properties are distinguishable from explicit null values.

```ts
const verifier = createVerificationEngine();
const result = verifier.runCase(blueprint, {
  caseId: "WF-003",
  seed: "b17-manual-replay",
  bet: 5,
  fixedReelStops: [0, 0, 0, 0, 0],
  expected: { totalWin: 12 }, // intentionally failing authored expectation
});
const reproduced = verifier.replay(blueprint, result.replayMetadata!);
```

Suite execution supports case-ID, suite-ID and any-tag filters (different filters intersect), stable input ordering, early failure and continue-on-failure. Suite reports contain pass/fail/blocked counts, not-run IDs, versions/hashes, metadata, case results, failure summaries and reproduction fingerprints.

## 8. Data flow, state and persistence
Normalize/validate configuration → validate authored case → clone case → establish B03 state → capture revision/input fingerprint → invoke existing complete-round runner → compare explicit observations in execution order → retain first divergence → produce frozen result and replay metadata.

No database, filesystem or network writes occur in the verifier. `exportVerificationActual` returns a review-only JSON string. The authored case, including starting runtime state, seed/fixed stops, selected bet/paylines/mode, operations and expectations, is retained in replay metadata. Full normalized-config fingerprints include Sets, Maps, math, caps and other fields, not only reel/paytable subsets.

## 9. Integration and mechanic coverage
- B04 explicit stops retain circular wraparound, stop indexes and visible strip positions; trace states `fixedStops` versus `rng`.
- Different explicit reel heights use B04's real context; nudges, linked reels, locks and tags dispatch to B13.
- Base and feature boards, feature entry/remaining spins, cap/end reasons and alternate reels are independently observable.
- B13's atomic tumble result supplies removed, moved and inserted cells plus the resulting board. No synthetic unexposed post-removal board is fabricated; separate authored removal operations can inspect B13 `removeCells` directly.
- B14 cell multipliers, assigned values, collectors/transfers, meters, memory and ladders remain their real returned/state contracts.
- B15 thresholds, chance results, selected outcomes, nested action results and inline board modifications remain their real returned/state contracts.
- All allowlisted methods dispatch to existing implementations. This is infrastructure plus representative fixtures, not an exhaustive authored baseline for every possible game/mechanic combination.
- B16 statistical reports remain separate and are never used as tolerance bands for exact verification.

## 10. Controls and expected behavior
Backend APIs only; no frontend controls, actions or shortcuts changed.
- Status: `pass`, `fail` or `blocked` (invalid input/unavailable required configuration).
- Trace retention: `none`, `failures` (default), or `all`; `maxTraceEntries` defaults to 256 and explicitly marks truncation.
- Stages: ENGINE INPUT, REELS, BOARD, WIN EVALUATION, BOARD TRANSFORM, FEATURE LOGIC, MULTIPLIER/VALUE, METER/LOGIC, SETTLEMENT, FINAL STATE.
- Optional `expectedEventSequence` checks actual stage order, not just matching snapshots.
- Detailed comparison stops at the first divergence. Execution can finish to capture diagnostic metadata; suite `earlyFailure` prevents subsequent cases from running.

## 11. Tests, checks, build and manual verification
- `npm run typecheck`: PASS, zero errors.
- `npm run lint`: PASS, zero errors/warnings.
- `npx tsx --test tests/deterministic-verification-engine.test.ts`: **20/20 PASS**; all 16 requested areas plus stage order, starting feature runtime/caps, missing intermediate expectations, comprehensive fingerprints and byte-seed replay.
- `npx tsx --test --test-concurrency=1 tests/*.test.ts`: **289/289 PASS across 39 test files** (B01–B16 and frontend regressions included).
- `npm run build`: PASS, Next.js 16.2.6 production compilation/type validation/static and dynamic routes.
- Manual CLI: WF-003, fixed stops `[0,0,0,0,0]`, bet 5, expected payout 12 → actual payout 9; exact path `totalWin`, stage SETTLEMENT, seed/algorithm captured. JSON-round-tripped replay returned an identical full result.
- Cascade and free-spin alternate-reel scenarios were checked board-by-board, including a deliberately changed cascade cell and feature remaining-spin expectation.
- Initial full-regression attempt had three dashboard seeding failures because a non-demo project database was present. Rerun used a fresh temporary seeded test database; the original workspace database was preserved and restored. No frontend source change was needed.
- Dependencies were restored with `npm ci` after the workspace runtime no longer contained `node_modules`; package files were unchanged.

## 12. Requirement status
| Requirement | Status | Evidence |
| --- | --- | --- |
| Dedicated backend verifier; no duplicated mechanics/UI | PASS | B17 delegates production execution; architecture purity regression |
| Exact fixed stops, circular strips, variable heights, nudges/links | PASS | Tests 1, 8; actual B04/B13 contracts |
| Seed/state, RNG algorithm/version and replay | PASS | Tests 9, 10, 18, 20; manual replay |
| Exact board, payout, feature, multiplier/value and meter diffs | PASS | Tests 2–6 |
| Cascades and feature boards; first divergence | PASS | Tests 4, 7, 17, 19 |
| Targeted mechanic infrastructure without reimplementation | PASS | Signature-derived dispatch and existing B12–B15 regression suites |
| Immutable authored baseline; no automatic expectation writes | PASS | Tests 12–13; review export has no I/O |
| Individual/suite/tag filtering and early failure | PASS | Test 11 |
| Validation: definition/revision/stops/IDs/dimensions/numbers | PASS | Test 14 and production API validation |
| Trace retention/report/reproduction contracts | PASS | Tests 1, 10–11, 16–17 |
| B16 separate statistics, existing APIs/regressions | PASS | Test 15; 289 regression tests |
| Every possible configured-mechanic combination has a baseline | NOT VERIFIED | Not claimed; authors add intentional game-specific cases |

## 13. Known limitations and unverified behavior
- Suite execution is deliberately sequential. External workers may schedule isolated cases; no built-in worker pool or shared mutable RNG exists.
- `executionTimeMs` is null unless the host supplies an optional monotonic `clock`; timing is not fabricated or used in deterministic outcomes. Tests verify injected measurement.
- Fingerprints detect accidental drift, not malicious tampering; they are not cryptographic signatures.
- The verifier can only observe/execute mechanics already provided by the backend. It neither invents missing combined lifecycle behavior nor certifies a game solely because a few smoke cases pass.
- Trace retention can truncate; exact first diff and reproduction metadata remain available. Full traces are opt-in and finite guards may block incomplete flows.
- Non-base mode requires an explicit matching starting feature runtime state rather than guessed feature entry. Invalid stops, unused authored feature stops and inconsistent inputs are not silently repaired.

## 14. Remaining work and next steps
B17 infrastructure is implemented and tested. Add explicit game/revision-specific baseline cases as content is authored, not by copying actual output automatically. Worker scheduling/persistent report storage are outside this section. **Stop at B17; do not start B18.**

## 15. Incremental backup and manifest
- Destination: `Slot Studio Backups/B - Backend/B17/`.
- Folder ID: `11nqwfKGoqABR5RqLB3wveSi3HsIZfFiK`.
- Only the five created and five modified files listed in section 5 are included; source/test/doc paths are preserved as nested folders. No dependency/cache/build artifacts are uploaded.
- Upload IDs, byte sizes and verification outcomes are recorded in `docs/backups/Backup-Manifest.md`; its final content is mirrored to the backup root. Manifest self-references use destination paths to avoid an upload-ID/size self-rewrite loop.
- Pre-section inventory: 345 source/test/doc files. Post-section inventory: 350 files; five created, five modified, none deleted. Existing untracked repository content belongs to earlier sections and is not bulk-uploaded.

## 16. Last update and sign-off
2026-10-16. B17 implementation, representative production-flow verification, first-divergence diagnostics, replay, regression checks and production build completed. Backup verification is tracked separately in the manifest; no B18 work performed.
