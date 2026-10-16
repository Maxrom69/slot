import { WorkspaceError } from "@/server/workspace-service";

export async function runRoute<T>(fn: () => Promise<T>): Promise<Response> {
  try { return Response.json(await fn()); }
  catch (error) {
    if (error instanceof WorkspaceError) return Response.json({ error: error.message, ...(error.data ?? {}) }, { status: error.status });
    console.error("Workspace request failed", error);
    return Response.json({ error: "The workspace could not be saved. Please try again." }, { status: 500 });
  }
}

/** Reject malformed JSON explicitly; do not turn it into an empty request. */
export async function readJson<T>(request: Request): Promise<T> {
  const maxBytes = 36 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new WorkspaceError("Project import is too large. Keep combined artwork under 24 MB.", 413);
  const text = await request.text();
  if (text.length > maxBytes) throw new WorkspaceError("Project import is too large.", 413);
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as T;
  } catch { throw new WorkspaceError("The request must contain a valid JSON object.", 400); }
}
