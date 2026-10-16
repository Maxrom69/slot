import { handleRuntimeRequest } from "@/server/game-runtime-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handleRuntimeRequest(request, (await ctx.params).id);
}
