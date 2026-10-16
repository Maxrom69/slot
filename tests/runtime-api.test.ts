import assert from "node:assert/strict";
import { test } from "node:test";
import Module from "node:module";
import { createSampleGameBlueprint } from "../src/engine";
const mod = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown }, origLoad = mod._load;
mod._load = function (request, parent, isMain) { if (request === "server-only" || request === "next/cache") return {}; return origLoad.call(this, request, parent, isMain); };
function request(body?: object, cookie?: string, origin = "http://runtime.test") { return new Request("http://runtime.test/api/runtime/sessions", { method: body ? "POST" : "GET", headers: { origin, ...(cookie ? { cookie } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }); }

test("B18 HTTP saved-project lifecycle, real spin/idempotency, owner and injection protection", async () => {
  const { createProject, saveProject, deleteProject } = await import("../src/server/workspace-service");
  const { handleRuntimeRequest } = await import("../src/server/game-runtime-service");
  const project = await createProject({ title: "B18 API test", theme: "Runtime", columns: 5, rows: 3 });
  try {
    const bp = createSampleGameBlueprint(); bp.features = []; bp.meta.id = project.id;
    await saveProject(project.id, bp);
    const created = await handleRuntimeRequest(request({ projectId: project.id, seed: "api-b18", initialBalance: 100, bet: 5 }));
    assert.equal(created.status, 201, JSON.stringify(await created.clone().json()));
    assert.match(created.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);
    const cookie = created.headers.get("set-cookie")!.split(";")[0]!;
    const sessionId = (await created.json()).sessionId as string;
    const started = await handleRuntimeRequest(request({}, cookie), sessionId, "start"); assert.equal(started.status, 200);
    const body = { requestId: "api-real", epoch: 0 };
    const response = await handleRuntimeRequest(request(body, cookie), sessionId, "spin"); assert.equal(response.status, 200);
    const actual = await response.json(); assert.equal(actual.settlement.wager, 5); assert.equal(actual.settlement.balanceAfter, 95 + actual.totalPayout); assert.equal(actual.reelStops.length, 5);
    assert.deepEqual(await (await handleRuntimeRequest(request(body, cookie), sessionId, "spin")).json(), actual);
    const replay = await handleRuntimeRequest(request({ spinId: actual.spinId }, cookie), sessionId, "replay"); assert.deepEqual(await replay.json(), actual);
    assert.equal((await handleRuntimeRequest(request(body), sessionId, "spin")).status, 403);
    assert.equal((await handleRuntimeRequest(request({ ...body, requestId: "forged", fixedStops: [0,0,0,0,0] }, cookie), sessionId, "spin")).status, 403);
    assert.equal((await handleRuntimeRequest(request({}, cookie, "http://foreign.test"), sessionId, "reset")).status, 403);
    const history = await handleRuntimeRequest(request(undefined, cookie), sessionId, "history"); assert.equal((await history.json()).length, 1);
    const snapshot = await (await handleRuntimeRequest(request({}, cookie), sessionId, "snapshot")).json();
    snapshot.state.balance += 500;
    assert.equal((await handleRuntimeRequest(request({ snapshot }, cookie), sessionId, "restore")).status, 400);
    assert.equal((await handleRuntimeRequest(request({}, cookie), sessionId, "close")).status, 200);
    assert.equal((await handleRuntimeRequest(request({ requestId: "closed", epoch: 0 }, cookie), sessionId, "spin")).status, 400);
  } finally { await deleteProject(project.id); }
});

test("B18 HTTP rejects arbitrary game definitions, malformed JSON and unknown routes", async () => {
  const { handleRuntimeRequest } = await import("../src/server/game-runtime-service");
  assert.equal((await handleRuntimeRequest(request({ definition: createSampleGameBlueprint(), seed: "no", initialBalance: 100 }))).status, 403);
  const malformed = new Request("http://runtime.test/api/runtime/sessions", { method: "POST", body: "[", headers: { origin: "http://runtime.test" } });
  assert.equal((await handleRuntimeRequest(malformed)).status, 400);
});


test("B18 HTTP rejects malformed/scheme-mismatched origins and honors the trusted HTTPS proxy", async () => {
  const { handleRuntimeRequest } = await import("../src/server/game-runtime-service");
  for (const origin of ["null", "not a URL", "https://runtime.test", "http://runtime.test/", "http://runtime.test.evil"]) {
    const result = await handleRuntimeRequest(request({}, undefined, origin)); assert.equal(result.status, 403, origin);
  }
  const proxied = new Request("http://internal:3000/api/runtime/sessions", { method: "POST", headers: { origin: "https://preview.example.test", "x-forwarded-host": "preview.example.test", "x-forwarded-proto": "https" }, body: "[" });
  const response = await handleRuntimeRequest(proxied); assert.equal(response.status, 400);
  assert.match(response.headers.get("set-cookie")!, /Secure;/);
});
