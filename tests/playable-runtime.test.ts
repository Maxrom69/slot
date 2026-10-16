import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createGameRuntime, createSampleGameBlueprint, adaptBlueprintToGameConfig, normalizeGameDefinition, fingerprintVerificationData, RuntimeError, type RuntimeMechanics, type RuntimeSpinRequest } from "../src/engine";
import { A, K, Q, S, SC, ZERO_GRID, exactCase } from "./fixtures/verification-baseline";
const owner = { ownerId: "local-test-owner" };
const stops = [0,0,0,0,0], loss = [0,5,1,0,0], trigger = [3,3,3,0,0];
function game(mechanics?: RuntimeMechanics) { const b = createSampleGameBlueprint(); b.features = []; if (mechanics) b.extensions = { ...b.extensions, backendRuntime: mechanics }; return b; }
function setup(mechanics?: RuntimeMechanics, options: Parameters<typeof createGameRuntime>[0] = { verificationMode: true }, balance = 100) {
  const r = createGameRuntime(options), g = r.loadGame(game(mechanics));
  r.createSession(g.gameId, { sessionId: "session", seed: "b18", initialBalance: balance, bet: 5 }, owner);
  r.startSession("session", owner); return r;
}
const req = (id: string, extra: Partial<RuntimeSpinRequest> = {}): RuntimeSpinRequest => ({ requestId: id, epoch: 0, ...extra });
function code(expected: string) { return (e: unknown) => e instanceof RuntimeError && e.code === expected; }
function featureMechanics(extra: Partial<RuntimeMechanics> = {}): RuntimeMechanics {
  const config = adaptBlueprintToGameConfig(game());
  return { version: 1, featureConfig: { baseReels: config.reels, visibleRows: 3, features: [{ id: "fs", name: "Two spins", mode: "freeSpins", startingMultiplier: 2, alternateReels: config.reels,
    triggers: [{ id: "three", source: "symbolCount", targetFeatureId: "fs", symbolIds: [SC], threshold: 3 }], freeSpins: { initialSpins: 2, retriggerEnabled: false } }] }, ...extra };
}

describe("B18 playable GameRuntime", () => {
  it("lifecycle: create/start/state/reset/close and owner isolation", () => {
    const r = createGameRuntime(), g = r.loadGame(game());
    const created = r.createSession(g.gameId, { sessionId: "lifecycle", seed: 5, initialBalance: 20, bet: 5 }, owner);
    assert.equal(created.state.status, "created"); assert.equal(created.state.nextAction, "startSession");
    assert.throws(() => r.spin("lifecycle", req("early"), owner), code("RUNTIME_INVALID_TRANSITION"));
    assert.equal(r.startSession("lifecycle", owner).state.status, "ready");
    assert.equal(r.closeSession("lifecycle", owner).state.nextAction, "none");
    assert.throws(() => r.spin("lifecycle", req("closed"), owner), code("RUNTIME_INVALID_TRANSITION"));
    assert.throws(() => r.getSession("lifecycle", { ownerId: "other" }), code("RUNTIME_SESSION_NOT_FOUND"));
    const reset = r.resetSession("lifecycle", owner); assert.equal(reset.state.epoch, 1); assert.equal(reset.state.balance, 20);
    r.startSession("lifecycle", owner); assert.throws(() => r.spin("lifecycle", req("stale"), owner), code("RUNTIME_INVALID_TRANSITION"));
  });
  it("real fixed-stop base board, authored 9-credit payout, single debit/credit and replay", () => {
    const r = setup(); const out = r.spinForVerification("session", req("base"), owner, stops);
    assert.equal(out.totalPayout, 9); assert.equal(out.settlement.wager, 5); assert.equal(out.settlement.balanceAfter, 104);
    assert.deepEqual(out.board.cells.map((col) => col.map((cell) => cell.symbolId)), ZERO_GRID);
    const state = r.getSessionState("session", owner); assert.equal(state.totalWagered, 5); assert.equal(state.totalAwarded, 9); assert.equal(state.netResult, 4); assert.equal(state.completedSpinCount, 1);
    assert.deepEqual(r.replaySpin("session", out.spinId, owner), out);
    assert.equal(r.getSessionState("session", owner).balance, 104);
    assert.deepEqual(out.events.filter((e) => e.type === "WAGER_DEDUCTED").map((e) => e.payload.wager), [5]);
  });
  it("zero wins are real losses; insufficient balance is not a completed losing spin", () => {
    const r = setup(undefined, { verificationMode: true }, 5);
    const lossResult = r.spinForVerification("session", req("loss"), owner, loss); assert.equal(lossResult.totalPayout, 0); assert.equal(lossResult.settlement.balanceAfter, 0);
    const before = r.getSessionState("session", owner);
    assert.throws(() => r.spin("session", req("poor"), owner), code("RUNTIME_INSUFFICIENT_BALANCE"));
    assert.deepEqual(r.getSessionState("session", owner), before); assert.equal(r.getHistory("session", owner).length, 1);
    assert.equal(r.getSession("session", owner).errors.length, 1);
  });
  it("configured bet levels only; feature and production request payloads cannot bypass authority", () => {
    const r = setup(); assert.throws(() => r.spin("session", req("badbet", { bet: 123 }), owner), code("RUNTIME_INVALID_BET"));
    for (const extra of [{ fixedStops: stops }, { featureState: {} }, { operations: [] }, { seed: 4 }]) assert.throws(() => r.spin("session", { ...req("forged"), ...extra }, owner), code("RUNTIME_FORBIDDEN"));
    assert.throws(() => r.continueFeature("session", req("no-feature"), owner), code("RUNTIME_INVALID_TRANSITION"));
    const prod = setup(undefined, {}); assert.throws(() => prod.spinForVerification("session", req("fixed"), owner, stops), code("RUNTIME_FORBIDDEN"));
    assert.throws(() => prod.verifyCase("sample-b01-5x3", exactCase), code("RUNTIME_FORBIDDEN"));
    assert.equal(r.verifyCase("sample-b01-5x3", exactCase).status, "pass");
  });
  it("exact idempotency returns the same result, conflicting IDs never recharge", () => {
    const r = setup(); const a = r.spinForVerification("session", req("once"), owner, stops);
    assert.deepEqual(r.spinForVerification("session", req("once"), owner, stops), a);
    assert.throws(() => r.spinForVerification("session", req("once", { bet: 1 }), owner, stops), code("RUNTIME_IDEMPOTENCY_CONFLICT"));
    assert.equal(r.getSessionState("session", owner).completedSpinCount, 1); assert.equal(r.getSessionState("session", owner).balance, 104);
  });
  it("bounded history never forgets processed request IDs; ledger guard is explicit", () => {
    const r = setup(undefined, { verificationMode: true, historyLimit: 1, maxRequestsPerSession: 2 });
    r.spinForVerification("session", req("first"), owner, stops); r.spinForVerification("session", req("second"), owner, loss);
    assert.equal(r.getHistory("session", owner).length, 1);
    assert.throws(() => r.spinForVerification("session", req("first"), owner, stops), code("RUNTIME_RESULT_EXPIRED"));
    assert.throws(() => r.spin("session", req("third"), owner), code("RUNTIME_LIMIT_EXCEEDED"));
    assert.equal(r.getSessionState("session", owner).completedSpinCount, 2);
  });
  it("complete B12 feature lifecycle uses actual boards, x2 B14 payouts and no extra wager", () => {
    const r = setup(featureMechanics());
    const entered = r.spinForVerification("session", req("enter"), owner, trigger);
    assert.equal(entered.nextAction, "continueFeature"); assert.equal(entered.featureState.remainingSpins, 2);
    assert.throws(() => r.spin("session", req("bypass"), owner), code("RUNTIME_INVALID_TRANSITION"));
    const one = r.spinForVerification("session", req("free-1"), owner, stops);
    assert.equal(one.totalPayout, 18); assert.equal(one.settlement.wager, 0); assert.equal(one.featureState.remainingSpins, 1);
    const two = r.spinForVerification("session", req("free-2"), owner, stops);
    assert.equal(two.totalPayout, 18); assert.equal(two.nextAction, "spin"); assert.equal(two.featureState.status, "completed");
    assert.equal(two.featureState.accumulatedFeatureWin, 36);
    const state = r.getSessionState("session", owner); assert.equal(state.totalWagered, 5); assert.equal(state.totalAwarded, entered.totalPayout + 36); assert.equal(state.balance, 95 + entered.totalPayout + 36);
    assert.deepEqual(r.replaySpin("session", one.spinId, owner), one);
    assert.equal(state.multiplierSnapshot.multiplierState.featureMultiplier, null);
  });
  it("fresh reel resolution does not reuse the previous board", () => {
    const r = setup(); const a = r.spinForVerification("session", req("a"), owner, stops); const b = r.spinForVerification("session", req("b"), owner, loss);
    assert.notDeepEqual(a.board, b.board); assert.equal(b.totalPayout, 0);
  });
  it("B13 cascade evaluates refill once and does not duplicate initial award", () => {
    const final = [[K,K,K],[Q,Q,Q],[S,S,S],[K,Q,S],[Q,S,A]];
    const r = setup({ version: 1, tumbleConfig: { reelStrips: final } });
    const out = r.spinForVerification("session", req("cascade"), owner, stops);
    assert.equal(out.totalPayout, 9); assert.equal(out.statistics.cascadeCount, 1); assert.deepEqual(out.board.cells.map((col) => col.map((c) => c.symbolId)), final);
    assert.equal(out.wins.length, 2); assert.equal(out.settlement.balanceAfter, 104);
    assert.deepEqual(r.replaySpin("session", out.spinId, owner), out);
  });
  it("B15 session thresholds award once, losing trigger uses settled result and ordered nested actions", () => {
    const r = setup({ version: 1, meters: [{ meterId: "count", scope: "session", startingValue: 0, eventSource: { eventType: "spinsPlayed" }, thresholds: [{ thresholdId: "first", threshold: 1, actions: [{ actionId: "credit", type: "awardPrize", prizeAmount: 4 }] }] }] });
    assert.equal(r.spinForVerification("session", req("one"), owner, loss).totalPayout, 4);
    assert.equal(r.spinForVerification("session", req("two"), owner, loss).totalPayout, 0);
    assert.equal(r.getSessionState("session", owner).logicState.metersById.count?.currentValue, 2);
  });
  it("seeded stream progresses across actions, sessions are isolated, snapshot continuation is exact", () => {
    const r = setup(undefined, {}), g = r.loadGame(game());
    r.createSession(g.gameId, { sessionId: "isolated", seed: "b18", initialBalance: 100, bet: 5 }, owner); r.startSession("isolated", owner);
    const a = r.spin("session", req("r1"), owner), independent = r.spin("isolated", req("r1"), owner);
    assert.deepEqual(a.reelStops, independent.reelStops); assert.deepEqual(a.statistics.rngSnapshotAfter, independent.statistics.rngSnapshotAfter);
    const snapshot = r.snapshotSession("session", owner); const b = r.spin("session", req("r2"), owner);
    assert.equal(b.statistics.rngSnapshotBefore.drawCount, a.statistics.rngSnapshotAfter.drawCount); assert.ok(b.statistics.rngSnapshotAfter.drawCount > a.statistics.rngSnapshotAfter.drawCount);
    r.restoreSession(JSON.parse(JSON.stringify(snapshot)), owner); const restored = r.spin("session", req("r2"), owner); assert.deepEqual(restored, b);
    assert.equal(r.getSessionState("isolated", owner).completedSpinCount, 1);
  });
  it("issued snapshots reject tampering, recomputed unkeyed hash, and foreign owners", () => {
    const r = setup(), snapshot = r.snapshotSession("session", owner);
    const tampered = JSON.parse(JSON.stringify(snapshot)); tampered.state.balance += 100;
    assert.throws(() => r.restoreSession(tampered, owner), code("RUNTIME_INVALID_SNAPSHOT"));
    const { integrityHash: _old, ...forgedData } = tampered; void _old;
    tampered.integrityHash = fingerprintVerificationData(forgedData);
    assert.throws(() => r.restoreSession(tampered, owner), code("RUNTIME_INVALID_SNAPSHOT"));
    assert.throws(() => r.restoreSession(snapshot, { ownerId: "foreign" }), code("RUNTIME_INVALID_SNAPSHOT"));
    assert.throws(() => createGameRuntime().restoreSession(snapshot, owner), code("RUNTIME_INVALID_SNAPSHOT"));
  });
  it("execution failure rolls back all state and does not consume request ID", () => {
    const r = setup(); const before = r.getSessionState("session", owner);
    assert.throws(() => r.spinForVerification("session", req("retry"), owner, [99,0,0,0,0]), code("RUNTIME_EXECUTION_FAILED"));
    assert.deepEqual(r.getSessionState("session", owner), before); assert.equal(r.getHistory("session", owner).length, 0);
    assert.equal(r.spinForVerification("session", req("retry"), owner, stops).totalPayout, 9);
  });
  it("B02 validation rejects broken definitions and runtime reference/configuration errors", () => {
    const r = createGameRuntime(), bp = game(); bp.reels.strips[0]![0] = "missing";
    assert.throws(() => r.loadGame(bp));
    assert.throws(() => r.loadGame(game({ version: 1, operations: [{ id: "bad", scope: "step", target: "board", method: "anything" as "placeSymbols", at: "beforeWins", args: [{ placements: [] }] }] })), code("RUNTIME_INVALID_CONFIG"));
    assert.throws(() => r.loadGame(game({ version: 1, operations: [{ id: "missing", scope: "step", target: "board", method: "placeSymbols", at: "beforeWins", args: [{ placements: [{ position: { reelIndex: 0, rowIndex: 0 }, symbolId: "missing" }] }] }] })), code("RUNTIME_INVALID_CONFIG"));
  });
  it("B12 retriggers on the last free spin, caps batches, and finishes without autoplay", () => {
    const mechanics = featureMechanics(), f = mechanics.featureConfig!.features[0]!;
    const r = setup({ ...mechanics, featureConfig: { ...mechanics.featureConfig!, features: [{ ...f, freeSpins: { initialSpins: 1, retriggerEnabled: true, retriggerSymbolIds: [SC], retriggerThreshold: 3, retriggerSpins: 1, maxRetriggerBatches: 1 } }] } });
    r.spinForVerification("session", req("enter"), owner, trigger);
    const retrigger = r.spinForVerification("session", req("retrigger"), owner, trigger);
    assert.equal(retrigger.featureState.remainingSpins, 1); assert.equal(retrigger.featureState.retriggerBatchCount, 1);
    assert.ok(retrigger.events.some((e) => e.type === "FEATURE_RETRIGGERED"));
    const last = r.spinForVerification("session", req("capped"), owner, trigger);
    assert.equal(last.featureState.status, "completed"); assert.equal(last.featureState.retriggerBatchCount, 1); assert.equal(last.settlement.wager, 0);
  });
  it("B15 upgrades delegate to B12 and subsequent spin uses upgraded multiplier/reels", () => {
    const mechanics = featureMechanics(), config = mechanics.featureConfig!;
    const r = setup({ ...mechanics, featureConfig: { ...config, features: [...config.features, { id: "super", name: "Super", mode: "freeSpins", startingMultiplier: 3, alternateReels: config.baseReels, freeSpins: { initialSpins: 1, retriggerEnabled: false } }] },
      meters: [{ meterId: "upgrade-count", scope: "session", startingValue: 0, eventSource: { eventType: "spinsPlayed" }, thresholds: [{ thresholdId: "upgrade-on-two", threshold: 2, actions: [{ actionId: "upgrade", type: "featureRequest", requestType: "upgradeFeature", featureId: "fs", targetFeatureId: "super", extraSpins: 1, startingMultiplier: 3 }] }] }],
    });
    r.spinForVerification("session", req("enter"), owner, trigger);
    const upgraded = r.spinForVerification("session", req("upgrade"), owner, stops);
    assert.equal(upgraded.totalPayout, 18); assert.equal(upgraded.featureState.featureId, "super"); assert.equal(upgraded.featureState.currentMultiplier, 3); assert.equal(upgraded.featureState.remainingSpins, 2);
    assert.ok(upgraded.events.some((e) => e.type === "FEATURE_UPGRADED"));
    assert.equal(r.spinForVerification("session", req("super-one"), owner, stops).totalPayout, 27);
    assert.equal(r.spinForVerification("session", req("super-two"), owner, stops).totalPayout, 27);
    assert.equal(r.getSessionState("session", owner).featureRuntimeState.status, "completed");
  });
  it("B14 cell multiplier and real symbol-value collection settle exactly once", () => {
    const multipliers = setup({ version: 1, operations: [{ id: "x3", scope: "step", target: "multiplier", method: "addCellMultipliers", at: "beforeWins", args: [{ $ref: "board" }, [{ position: { reelIndex: 0, rowIndex: 0 }, value: 3, sourceConfigId: "x3" }]] }] });
    assert.equal(multipliers.spinForVerification("session", req("cell"), owner, stops).totalPayout, 27);
    const values = setup({ version: 1, multiplierConfig: { assignedValues: [{ id: "two", symbolIds: [A], mode: "fixed", fixedValue: 2 }], collection: { id: "collect", mode: "collect", collectorSymbolIds: [S], eligibleSourceSymbolIds: [A], sourcePersistence: "consume" } } });
    const out = values.spinForVerification("session", req("values"), owner, stops);
    assert.equal(out.totalPayout, 49); assert.equal(out.statistics.featureValueWinAmount, 40);
    assert.deepEqual(values.replaySpin("session", out.spinId, owner), out);
  });
  it("B15 losing-spin trigger excludes any actual win; nested actions preserve authored order", () => {
    const losing = setup({ version: 1, losingSpinCondition: { conditionId: "zero", kind: "losingSpin", actions: [{ actionId: "loss-credit", type: "awardPrize", prizeAmount: 3 }] } });
    assert.equal(losing.spinForVerification("session", req("loss"), owner, loss).totalPayout, 3);
    assert.equal(losing.spinForVerification("session", req("win"), owner, stops).totalPayout, 9);
    const ordered = setup({ version: 1, operations: [{ id: "ordered", scope: "session", target: "logic", method: "executeActionSequence", at: "afterLogic", args: [{ sequenceId: "outer", actions: [{ actionId: "nested", type: "nestedSequence", sequenceId: "inner", actions: [{ actionId: "two", type: "awardPrize", prizeAmount: 2 }] }, { actionId: "three", type: "awardPrize", prizeAmount: 3 }] }, { boardState: { $ref: "boardState" }, rng: { $ref: "rng" } }] }] });
    const first = ordered.spinForVerification("session", req("ordered"), owner, loss); assert.equal(first.totalPayout, 5);
    const sequence = first.transitions.find((o) => o.data.operationId === "ordered")!.data.result as { actionsExecuted: { actionId: string; observedPreviousActionId: string | null }[] };
    assert.deepEqual(sequence.actionsExecuted.map((a) => a.actionId), ["nested", "three"]); // B15 explicitly propagates the last child ID (see its ordered-sequence contract).
    assert.equal(sequence.actionsExecuted[1]!.observedPreviousActionId, "two");
    assert.equal(ordered.spinForVerification("session", req("not-again"), owner, loss).totalPayout, 0);
  });
  it("global cap is cumulative across free actions and B12 totals match settled feature awards", () => {
    const mechanics = featureMechanics(), f = mechanics.featureConfig!.features[0]!;
    const bp = game({ ...mechanics, featureConfig: { ...mechanics.featureConfig!, features: [{ ...f, triggers: [{ ...f.triggers![0]!, threshold: 1 }] }] } });
    // A real one-scatter losing base board triggers the authored feature without a scatter payout.
    // Two 9-credit boards at x2 would pay 36, but the configured 5x round cap is 25.
    bp.math.maxWinX = 5;
    const r = createGameRuntime({ verificationMode: true }), g = r.loadGame(bp);
    r.createSession(g.gameId, { sessionId: "session", seed: "cap", initialBalance: 100, bet: 5 }, owner); r.startSession("session", owner);
    const entered = r.spinForVerification("session", req("enter"), owner, loss); assert.equal(entered.totalPayout, 0); assert.equal(entered.nextAction, "continueFeature");
    assert.equal(r.spinForVerification("session", req("free-1"), owner, stops).totalPayout, 18);
    const last = r.spinForVerification("session", req("free-2"), owner, stops);
    assert.equal(last.totalPayout, 7); assert.equal(last.featureState.accumulatedFeatureWin, 25); assert.equal(last.featureState.status, "completed"); assert.equal(last.settlement.capReached, true);
    assert.equal(r.getSessionState("session", owner).totalAwarded, 25); assert.equal(r.getSessionState("session", owner).balance, 120);
  });
  it("mid-feature JSON snapshot gives identical continuation and replay without mutation", () => {
    const r = setup(featureMechanics()); r.spinForVerification("session", req("enter"), owner, trigger);
    const snapshot = JSON.parse(JSON.stringify(r.snapshotSession("session", owner)));
    const a = r.spinForVerification("session", req("free"), owner, stops);
    r.restoreSession(snapshot, owner); const b = r.spinForVerification("session", req("free"), owner, stops);
    assert.deepEqual(a, b); const before = r.getSessionState("session", owner);
    assert.deepEqual(r.replaySession("session", owner).map((o) => o.spinId), r.getHistory("session", owner).map((o) => o.spinId));
    assert.deepEqual(r.getSessionState("session", owner), before);
  });
  it("post-debit transition guard abort preserves RNG, board, meters, bankroll and history", () => {
    const r = setup(undefined, { verificationMode: true, maxTransitionsPerStep: 2 }), before = r.getSessionState("session", owner);
    assert.throws(() => r.spinForVerification("session", req("abort"), owner, stops), code("RUNTIME_LIMIT_EXCEEDED"));
    assert.deepEqual(r.getSessionState("session", owner), before); assert.equal(r.getLastResult("session", owner), null);
  });
  it("configured B13 locks persist over new reels without freezing unlocked cells", () => {
    const r = setup({ version: 1, operations: [{ id: "lock", scope: "session", target: "board", method: "applyLocks", at: "beforeWins", args: [[{ position: { reelIndex: 0, rowIndex: 0 }, lifetimeType: "spins", remainingSpins: 3 }]] }] });
    const first = r.spinForVerification("session", req("lock"), owner, stops);
    const second = r.spinForVerification("session", req("next"), owner, [1,1,1,1,1]);
    assert.equal(second.board.cells[0]![0]!.symbolId, A); assert.notEqual(second.board.cells[1]![0]!.symbolId, first.board.cells[1]![0]!.symbolId);
    assert.ok(second.transitions.some((o) => o.data.reason === "persistentLocks"));
  });

  it("B12 hold-and-win preserves authoritative locked symbols and pays its pool only once", () => {
    const reels = adaptBlueprintToGameConfig(game()).reels;
    const r = setup({ version: 1, featureConfig: { baseReels: reels, visibleRows: 3, features: [{ id: "hold", name: "Hold", mode: "holdAndWin", alternateReels: [[K,K,K],[Q,Q,Q],[S,S,S],[K,K,K],[Q,Q,Q]],
      triggers: [{ id: "hold-trigger", source: "symbolCount", targetFeatureId: "hold", symbolIds: [SC], threshold: 3 }], holdAndWin: { initialRespins: 2, lockableSymbolIds: [SC], defaultSymbolValue: 2 } }] } });
    const entry = r.spinForVerification("session", req("hold-enter"), owner, trigger); assert.equal(entry.nextAction, "continueFeature"); assert.equal(entry.featureState.lockedCells.length, 3);
    const first = r.spinForVerification("session", req("hold-1"), owner, stops); assert.equal(first.totalPayout, 0); assert.equal(first.featureState.lockedCells.length, 3);
    assert.equal(first.board.cells[0]![2]!.symbolId, SC);
    const last = r.spinForVerification("session", req("hold-2"), owner, stops); assert.equal(last.totalPayout, 6); assert.equal(last.featureState.status, "completed"); assert.equal(last.settlement.wager, 0);
    assert.deepEqual(r.spinForVerification("session", req("hold-2"), owner, stops), last);
    assert.equal(r.getSessionState("session", owner).totalAwarded, entry.totalPayout + 6);
  });
  it("transition guard rolls back a nonterminating configured cascade rather than accepting a loss", () => {
    const r = setup({ version: 1, tumbleConfig: { reelStrips: [[A,A,A],[A,A,A],[A,A,A],[A,A,A],[A,A,A]] } }), before = r.getSessionState("session", owner);
    assert.throws(() => r.spinForVerification("session", req("infinite"), owner, stops), code("RUNTIME_EXECUTION_FAILED"));
    assert.deepEqual(r.getSessionState("session", owner), before); assert.equal(r.getLastResult("session", owner), null);
  });

  it("runtime selects configured B09/B10/B11 engines instead of evaluating all win models", () => {
    // Authored counts: K=6 pays highest tier 20, Q=3 pays 4, STAR=3 pays 10, A=3 pays 2; totalBet=5 => 180.
    for (const [mode, key, award] of [["ways", "ways", 0], ["clusters", "clusters", 0], ["payAnywhere", "payAnywhere", 180]] as const) {
      const bp = game(); bp.reels.strips = [[K,K,K],[Q,Q,Q],[S,S,S],[A,A,A],[K,K,K]];
      const definition = normalizeGameDefinition(bp);
      const source = { ...definition, winEvaluation: { ...definition.winEvaluation, primaryMode: mode, enabledModes: [mode] }, waysConfiguration: { ...definition.waysConfiguration, enabled: mode === "ways" }, clusterConfiguration: { ...definition.clusterConfiguration, enabled: mode === "clusters" }, payAnywhereConfiguration: { ...definition.payAnywhereConfiguration, enabled: mode === "payAnywhere" } };
      const r = createGameRuntime({ verificationMode: true }), g = r.loadGame(source); r.createSession(g.gameId, { sessionId: "session", seed: 1, initialBalance: 100, bet: 5 }, owner); r.startSession("session", owner);
      const out = r.spinForVerification("session", req(key), owner, stops);
      const evaluation = out.wins[0]!.data.result as { wins: Record<string, unknown> };
      assert.equal(out.totalPayout, award); assert.ok(key in evaluation.wins); assert.equal("paylines" in evaluation.wins, false);
    }
  });

  it("configured early B15 prize is settled once before losing-spin detection", () => {
    const r = setup({ version: 1, operations: [{ id: "early", scope: "step", target: "logic", method: "executeActionSequence", at: "beforeWins", args: [{ sequenceId: "early", actions: [{ actionId: "early-prize", type: "awardPrize", prizeAmount: 2 }] }, {}] }], losingSpinCondition: { conditionId: "losing", kind: "losingSpin", actions: [{ actionId: "not-a-loss", type: "awardPrize", prizeAmount: 7 }] } });
    assert.equal(r.spinForVerification("session", req("early"), owner, loss).totalPayout, 2);
  });
  it("B14 consume-on-first-pay memory is not reapplied; session memory survives snapshots", () => {
    const r = setup({ version: 1, operations: [{ id: "memory", scope: "session", target: "multiplier", method: "recordSymbolMultiplierMemory", at: "beforeWins", args: [[{ symbolId: A, multiplier: 3, persistence: "consumeOnFirstPay" }]] }] });
    assert.equal(r.spinForVerification("session", req("first-pay"), owner, stops).totalPayout, 27);
    assert.equal(r.spinForVerification("session", req("consumed"), owner, stops).totalPayout, 9);
    const persistent = setup({ version: 1, operations: [{ id: "persistent-memory", scope: "session", target: "multiplier", method: "recordSymbolMultiplierMemory", at: "beforeWins", args: [[{ symbolId: A, multiplier: 2, persistence: "session" }]] }] });
    assert.equal(persistent.spinForVerification("session", req("one"), owner, stops).totalPayout, 18);
    const snapshot = persistent.snapshotSession("session", owner);
    assert.equal(persistent.spinForVerification("session", req("two"), owner, stops).totalPayout, 18);
    persistent.restoreSession(snapshot, owner); assert.equal(persistent.spinForVerification("session", req("two"), owner, stops).totalPayout, 18);
  });

  it("pins a private definition revision while caller edits and later reloads remain independent", () => {
    const bp = game(), r = createGameRuntime({ verificationMode: true }), old = r.loadGame(bp);
    r.createSession(old.gameId, { sessionId: "old", seed: 7, initialBalance: 100, bet: 5 }, owner); r.startSession("old", owner);
    assert.equal(Object.isFrozen(bp.math), false); bp.math.maxWinX = 1;
    const newer = r.loadGame(bp); assert.notEqual(newer.definitionHash, old.definitionHash);
    r.createSession(newer.gameId, { sessionId: "new", seed: 7, initialBalance: 100, bet: 5 }, owner); r.startSession("new", owner);
    assert.equal(r.spinForVerification("old", req("old"), owner, stops).totalPayout, 9);
    assert.equal(r.spinForVerification("new", req("new"), owner, stops).totalPayout, 5);
    assert.equal(r.getSession("old", owner).game.definitionHash, old.definitionHash);
  });
  it("numeric/byte seeds retain B03 identity through production replay, JSON snapshots and both algorithms", () => {
    for (const rngAlgorithm of ["mulberry32-v1", "sfc32-v1"] as const) for (const seed of [42, new Uint8Array([1,2,3])]) {
      const r = createGameRuntime(), g = r.loadGame(game());
      const initial = r.createSession(g.gameId, { sessionId: "seeded", seed, rngAlgorithm, initialBalance: 1000, bet: 5 }, owner); r.startSession("seeded", owner);
      const first = r.spin("seeded", req("first"), owner); assert.equal(first.statistics.rngSnapshotBefore.canonicalSeed, initial.state.rngState.canonicalSeed);
      assert.deepEqual(r.replaySpin("seeded", first.spinId, owner), first);
      const snapshot = JSON.parse(JSON.stringify(r.snapshotSession("seeded", owner))), next = r.spin("seeded", req("next"), owner);
      r.restoreSession(snapshot, owner); assert.deepEqual(r.spin("seeded", req("next"), owner), next);
    }
  });
  it("verification capability cannot be enabled through a truthy non-boolean option", () => {
    for (const verificationMode of ["true", 1, null]) assert.throws(() => createGameRuntime({ verificationMode: verificationMode as unknown as boolean }), code("RUNTIME_INVALID_CONFIG"));
  });

});
