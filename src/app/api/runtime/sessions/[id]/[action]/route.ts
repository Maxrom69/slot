import { handleRuntimeRequest } from "@/server/game-runtime-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string; action: string }> };
export async function POST(request: Request, ctx: Ctx) { const { id, action } = await ctx.params; return handleRuntimeRequest(request, id, action); }
export async function GET(request: Request, ctx: Ctx) { const { id, action } = await ctx.params; return handleRuntimeRequest(request, id, action); }
