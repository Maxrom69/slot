import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { createGameRuntime, RuntimeError, SlotEngineError, type RuntimeSpinRequest, type SessionSnapshot } from "@/engine";
import { getProject, WorkspaceError } from "./workspace-service";

/** Local Playtest service only: one process, bounded in-memory sessions, no remote auth. */
const shared = globalThis as typeof globalThis & { slotPlayableRuntime?: ReturnType<typeof createGameRuntime>; slotRuntimeOwners?: Set<string> };
const runtime = shared.slotPlayableRuntime ??= createGameRuntime(); // Never enable verification through HTTP.
const owners = shared.slotRuntimeOwners ??= new Set<string>();
const COOKIE = "slot_runtime_owner";
function requestOrigin(request: Request): string {
  const target = new URL(request.url);
  const protocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? target.protocol.slice(0, -1);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? target.host;
  if (protocol !== "http" && protocol !== "https") throw new RuntimeError("RUNTIME_FORBIDDEN", "Invalid runtime request origin.");
  try { return new URL(`${protocol}://${host}`).origin; }
  catch { throw new RuntimeError("RUNTIME_FORBIDDEN", "Invalid runtime request origin."); }
}
function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  if (site === "cross-site" || (origin !== null && origin !== requestOrigin(request))) throw new RuntimeError("RUNTIME_FORBIDDEN", "Cross-origin runtime mutations are not allowed.");
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const max = 4 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > max) throw new WorkspaceError("Runtime request is too large.", 413);
  const text = await request.text();
  if (Buffer.byteLength(text) > max) throw new WorkspaceError("Runtime request is too large.", 413);
  try { const data: unknown = text ? JSON.parse(text) : {}; if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(); return data as Record<string, unknown>; }
  catch { throw new RuntimeError("RUNTIME_INVALID_REQUEST", "A JSON object is required."); }
}
function fields(body: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw new RuntimeError("RUNTIME_FORBIDDEN", "Unsupported request field.", { key });
}
function owner(request: Request, create: boolean): { ownerId: string; newCookie: boolean } {
  const token = request.headers.get("cookie")?.split(";").map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (token && owners.has(token)) return { ownerId: token, newCookie: false };
  if (!create || token) throw new RuntimeError("RUNTIME_FORBIDDEN", "A valid local runtime owner cookie is required.");
  if (owners.size >= 256) throw new RuntimeError("RUNTIME_LIMIT_EXCEEDED", "Local owner limit reached.");
  const ownerId = randomBytes(32).toString("hex"); owners.add(ownerId); return { ownerId, newCookie: true };
}
/** Route adapter has no bankroll, evaluator, RNG, feature logic or arbitrary definition endpoint. */
export async function handleRuntimeRequest(request: Request, sessionId?: string, action?: string): Promise<Response> {
  const headers = new Headers({ "cache-control": "no-store" });
  try {
    if (request.method !== "GET" && request.method !== "POST") throw new WorkspaceError("Method not allowed.", 405);
    if (request.method === "POST") checkOrigin(request);
    const access = owner(request, !sessionId && request.method === "POST");
    if (access.newCookie) headers.set("set-cookie", `${COOKIE}=${access.ownerId}; HttpOnly; SameSite=Strict; Path=/api/runtime;${requestOrigin(request).startsWith("https://") ? " Secure;" : ""}`);
    if (request.method === "GET") {
      if (!sessionId) throw new WorkspaceError("Session ID required.", 400);
      if (action === "history") return Response.json(runtime.getHistory(sessionId, access), { headers });
      if (action) throw new WorkspaceError("Runtime action not found.", 404);
      return Response.json(runtime.getSession(sessionId, access), { headers });
    }
    const body = await readBody(request);
    if (!sessionId) {
      fields(body, ["projectId", "sessionId", "seed", "initialBalance", "bet"]);
      if (typeof body.projectId !== "string" || (typeof body.seed !== "string" && typeof body.seed !== "number") || typeof body.initialBalance !== "number" || (body.bet !== undefined && typeof body.bet !== "number") || (body.sessionId !== undefined && typeof body.sessionId !== "string")) throw new RuntimeError("RUNTIME_INVALID_REQUEST", "projectId, deterministic seed and initialBalance are required.");
      const project = await getProject(body.projectId);
      if (!project) throw new WorkspaceError("Saved project not found.", 404);
      const game = runtime.loadGame(project.blueprint);
      const session = runtime.createSession(game.gameId, { sessionId: body.sessionId as string | undefined ?? randomUUID(), seed: body.seed, initialBalance: body.initialBalance, ...(body.bet !== undefined ? { bet: body.bet as number } : {}) }, access);
      return Response.json(session, { status: 201, headers });
    }
    let result: unknown;
    switch (action) {
      case "start": fields(body, []); result = runtime.startSession(sessionId, access); break;
      case "spin": result = runtime.spin(sessionId, body as unknown as RuntimeSpinRequest, access); break;
      case "continueFeature": result = runtime.continueFeature(sessionId, body as unknown as RuntimeSpinRequest, access); break;
      case "snapshot": fields(body, []); result = runtime.snapshotSession(sessionId, access); break;
      case "restore": {
        fields(body, ["snapshot"]);
        const snapshot = body.snapshot as SessionSnapshot;
        if (snapshot?.state?.sessionId !== sessionId) throw new RuntimeError("RUNTIME_INVALID_SNAPSHOT", "Snapshot/session ID mismatch.");
        result = runtime.restoreSession(snapshot, access); break;
      }
      case "replay": fields(body, ["spinId"]); if (typeof body.spinId !== "string") throw new RuntimeError("RUNTIME_INVALID_REQUEST", "spinId is required."); result = runtime.replaySpin(sessionId, body.spinId, access); break;
      case "reset": fields(body, []); result = runtime.resetSession(sessionId, access); break;
      case "close": fields(body, []); result = runtime.closeSession(sessionId, access); break;
      default: throw new WorkspaceError("Runtime action not found.", 404);
    }
    return Response.json(result, { headers });
  } catch (cause) {
    const status = cause instanceof WorkspaceError ? cause.status : cause instanceof RuntimeError ? cause.code === "RUNTIME_SESSION_NOT_FOUND" ? 404 : cause.code === "RUNTIME_FORBIDDEN" ? 403 : cause.code === "RUNTIME_EXECUTION_FAILED" ? 422 : 400 : cause instanceof SlotEngineError ? 422 : 500;
    const error = cause instanceof SlotEngineError ? cause.toJSON() : { code: "LOCAL_RUNTIME_ERROR", message: cause instanceof WorkspaceError ? cause.message : "Local runtime request failed." };
    return Response.json({ error }, { status, headers });
  }
}
