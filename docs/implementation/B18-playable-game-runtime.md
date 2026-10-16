# B18 — Playable Game Runtime

## 1. Section identity
**B18 — Playable Game Runtime.** Headless, deterministic `GameRuntime` plus local saved-project Playtest API. Implementation: **COMPLETED**. This resumes the previously paused B18 work by explicit user selection; stop after B18.

## 2. Objective and scope
Complete the preserved playable-step executor, isolated sessions and API adapter without adding frontend gameplay, duplicating bankroll or implementing new slot rules. Preserve the intervening B16 repairs. Resume inspection found existing runtime/configuration/contracts, three routes, the service, shared-engine integration and 29 dedicated tests already present.

## 3. Requirements and exclusions
Reuse GameBlueprint/GameDefinition, B01 state/settlement, B03 deterministic RNG, B04–B15 outcomes and B17 verification. Support explicit session lifecycle, paid versus free steps, immutable state/results, exactly-once request handling, bounded history, deterministic replay/snapshots, rollback and local owner isolation. No UI, unrestricted fixed stops, request-authored mechanics, frontend feature-state changes, duplicate wallet, persistent casino account, remote authentication, distributed workers or real-money deployment.

## 4. Implementation summary
The paused implementation is retained. `createGameRuntime` provides revision-pinned sessions; the existing math executor exposes one base/feature action at a time. B12 owns feature lifecycle, B13 board persistence, B14 values/multipliers and B15 actions/meters. B01 performs the sole balance debit/credit. A successful result commits state/RNG/history/idempotency together; exceptions commit no partial gameplay.

Resume changes: compile from a private immutable definition copy; reject non-boolean verification capability; compare complete HTTP origins, including scheme, reject malformed/null origins, and honor trusted HTTPS proxy headers for secure cookies. Added revision-pinning, numeric/byte-seed replay/snapshot and origin tests. No source changes to the repaired B16 math/RNG modules were needed.

## 5. Files created, modified and deleted
**Accumulated B18 delivery** (including the paused, previously unbacked implementation): **10 created, 7 modified, 0 deleted**, 17 paths.

Created in B18:
- `src/engine/runtime/contracts.ts`
- `src/engine/runtime/configuration.ts`
- `src/engine/runtime/index.ts`
- `src/server/game-runtime-service.ts`
- `src/app/api/runtime/sessions/route.ts`
- `src/app/api/runtime/sessions/[id]/route.ts`
- `src/app/api/runtime/sessions/[id]/[action]/route.ts`
- `tests/playable-runtime.test.ts`
- `tests/runtime-api.test.ts`
- `docs/implementation/B18-playable-game-runtime.md`

Modified in accumulated B18:
- `src/engine/math/index.ts` — additive single-action boundary; current file also preserves the separately documented B16 repair.
- `src/engine/math/round-execution.ts` — additive playable execution/state inputs.
- `src/engine/state/index.ts` — shared settlement and explicit free-action debit policy.
- `src/engine/errors/index.ts` — structured runtime errors.
- `src/engine/index.ts` — runtime exports.
- `docs/implementation/INDEX.md`
- `docs/backups/Backup-Manifest.md`

**This resume only:** 1 created report, 7 modified files (runtime configuration/index, server service, both runtime test files, implementation index and manifest), 0 deleted; inventory 362 before / 363 after under `src`, `tests`, `docs`. Fresh baseline captured before edits. Original temporary pre-pause hashes were unavailable after workspace refresh: accumulated classification is recovered from preserved code, B17 reports/Drive metadata and prior delivery records, not claimed as a reconstructed complete original hash inventory. The 14 source/test delivery files include previously unbacked paused B18 changes, not just edits made today. No unrelated source is included. B16 math remains byte-identical to its verified repair backup.

## 6. Architecture and dependencies
`runtime/configuration` validates B02 and compiles authored `extensions.backendRuntime` policy; `runtime/index` orchestrates immutable session transactions; contracts extend existing GameState/GameSession/SpinResult rather than create a second rules engine. The service only loads saved projects, establishes local owner scope and delegates. It has no RNG outcome selection, evaluator or bankroll arithmetic. Crypto IDs/cookies stay outside the pure deterministic engine.

## 7. Public contracts and API
`GameRuntime`: `loadGame`, `createSession`, `startSession`, `getSession`, `getSessionState`, `spin`, `continueFeature`, `snapshotSession`, `restoreSession`, `replaySpin`, `replaySession`, `resetSession`, `closeSession`, `getLastResult`, `getHistory`, `verifyCase`.

Trusted in-process `verificationMode: true` enables `spinForVerification`; the HTTP service never enables it. Spin input is restricted to `requestId`, `epoch`, optional legal `bet`; feature actions retain the triggering bet. A fresh request cannot provide seed/stops/definition/board/mechanic/state overrides.

HTTP routes:
- `POST /api/runtime/sessions`: saved `projectId`, deterministic seed, initial balance, optional bet/session ID.
- `GET /api/runtime/sessions/:id`: immutable view.
- `GET /api/runtime/sessions/:id/history`: bounded history.
- `POST /api/runtime/sessions/:id/{start,spin,continueFeature,snapshot,restore,replay,reset,close}`: corresponding typed actions.

Replies use no-store and structured errors. Mutations require same-origin context; owners use HttpOnly/SameSite=Strict cookies, Secure behind HTTPS. Runtime ownership is local scope, not an account-authentication system.

## 8. Data flow and persistence
Load/validate/pin definition → create/start → validate action/epoch/ledger → private engine evaluation → one fixed-point settlement → atomic commit. Base wager charged once; free steps charge zero. Global max win is cumulative across a paid round and its features. B12 receives remaining cap budget. Calculated `statistics` remain engine observations; `settlement.award`/`totalPayout` are final capped money.

Session maps hold authoritative state, RNG identity, feature/board/multiplier/logic snapshots, operation scope history, bounded results and processed request IDs. Repeating identical request returns the original result; conflicting data rejects; expired result IDs never reexecute. Reset increments epoch and invalidates issued snapshots. Replay does not mutate the session.

Snapshots must match a receipt issued by this same runtime, owner and exact data; unkeyed fingerprints alone confer no restore authority. All runtime data is in memory. Existing project persistence is reused, not replaced. Checkpoint tests/server use `SLOT_STUDIO_LOCAL_DB_PATH` scratch databases; the normal `.local` database was absent on resume and remains untouched.

## 9. Integration and mechanics
The shared executor supplies real reels, paylines/ways/clusters/pay-anywhere/scatters, feature alternate reels and retriggers/upgrades/hold-and-win, cascades, locks, multipliers, cell values, memory and meters. Authored allowlisted operations are part of a pinned saved definition, never spin input. Enabled advanced policies without sufficient configuration reject rather than silently becoming fake mechanics. Existing B16/B17 tests remain unchanged and pass as regressions.

## 10. UI and lifecycle behavior
No UI or keyboard controls added. Stable states are created → ready → feature/ready → closed; next-action values enforce explicit start/spin/continueFeature/none. Synchronous execution represents transient spin/settlement stages in ordered events, not publicly writable intermediate state. No autoplay loop is started. Errors are separately recorded while pre-step gameplay state remains intact.

## 11. Actual verification results
- `npx tsx --test tests/playable-runtime.test.ts tests/runtime-api.test.ts`: **33/33 PASS** (30 runtime + 3 API tests).
- `npx tsx --test --test-concurrency=1 tests/*.test.ts`: **349/349 PASS**, 175 top-level tests, 14 suites, 42 test files; isolated DB seeded first using `tests/dashboard.test.ts`.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS, no errors/warnings.
- `npm run build`: PASS, production compilation and TypeScript completed.
- Production `next start --hostname 0.0.0.0 --port 3000` HTTP smoke: PASS; stopped afterward. Authored saved detailed reels contain only A. Five lines × 15 × (5/5) = **75** paid-board award; two x2 feature actions award **150 + 150**, wagers **5/0/0**, balance **100 → 470**. Idempotency, replay, JSON snapshot continuation, retained history, reset/stale epoch, close, forbidden fixed stops and owner isolation verified over actual routes.

The scratch smoke fixture was corrected to supply authored detailed reel records required by the existing saved-project normalizer; expected 75/150/150 values were not replaced with engine output. No supplied expected cases were changed. Evidence lives in scratch `.arena/b18-{tests,regression,typecheck,lint,build}.log` and `b18-http-smoke.json`; not uploaded as recovery data.

## 12. Requirement status
| Requirement | Status | Verification |
| --- | --- | --- |
| Isolated revision-pinned lifecycle and legal actions | PASS | Lifecycle, owner, revision-change and request-shape tests. |
| Real engine outcomes and explicit free continuation | PASS | Known boards, features, cascades, B14/B15 integration and live HTTP arithmetic. |
| Single settlement, cap, insufficient balance, idempotency | PASS | Exact payouts, cumulative caps, conflicting/expired IDs and rollback tests. |
| Deterministic RNG/replay/snapshot | PASS | Both algorithms; string/numeric/byte seeds; mid-feature state; exact continuation. |
| Immutable views, bounded history/ledger and rollback | PASS | Tamper, retention, guards and post-debit failure tests. |
| Production/verification authority split | PASS | Explicit boolean capability; HTTP injection and origin rejection. |
| Regression/production checkpoint | PASS | 349 tests, typecheck, lint, build and real routes above. |

## 13. Limitations and unverified scope
Single-process local Playtest only. Sessions/owners/receipts disappear on restart; no durable wallet, transactions across servers, multi-user project authorization or production gambling certification. Closed sessions and loaded revisions still consume bounded capacity; reset/owner-cookie handling is local-session management. Default limits: 64 sessions/revisions, 32 history entries, 10,000 request receipts/session, 512 retained observations/step, 256 issued snapshots; guards may reject overly large authored games rather than partially settle.

Snapshot restore intentionally rewinds a local session and its request ledger; it is not a financial recovery API. Issued receipts are bounded and snapshots are not portable to another runtime. ReplaySession covers retained history, not all historical actions. Fingerprints are noncryptographic; receipt ownership/exact data, not hash secrecy, protects restore. Proxy headers assume a trusted local deployment/proxy; this is not hostile multi-tenant infrastructure. No simulator UI, worker orchestration, wall-time SLA or exhaustive certification of every mechanic composition is claimed. B16's documented legacy RNG snapshot limits still apply.

## 14. Remaining work and boundary
No known failing tests or build errors in this verified scope. Backup synchronization is complete; **STOP after B18**. Further architecture/frontend/production hardening requires new authorization; do not start B19 automatically.

## 15. Incremental Google Drive backup
`Slot Studio Backups/B - Backend/B18/`, folder `1jMWkgTbWlt0HUiKzgw7HaMquZjby9joq`; existing nested folders are reused. Only the 17 confirmed accumulated B18 paths in section 5 are included. Paused files are being delivered, not falsely counted as newly written during this resume. No B16-only files, unchanged other sections, dependencies, scratch DBs, logs or build outputs are uploaded. Exact file IDs/parents/sizes/checksums and canonical root-manifest synchronization are recorded in `docs/backups/Backup-Manifest.md`. Backup: **SUCCESS**, exact destination parents, byte sizes and MD5 verified; canonical root manifest synchronized.

## 16. Last update
**2026-10-16, America/Halifax.** User explicitly selected resuming paused B18 after B16 completion.
