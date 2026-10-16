import { handleRuntimeRequest } from "@/server/game-runtime-service";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request) { return handleRuntimeRequest(request); }
