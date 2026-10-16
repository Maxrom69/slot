import { readJson, runRoute } from "@/app/api/_lib/handler";
import { assignProjectAsset } from "@/server/asset-service";
import type { AssignTarget } from "@/lib/assets/usage";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

export async function POST(request: Request, ctx: Ctx) {
  const { id, assetId } = await ctx.params;
  return runRoute(async () => {
    const body = await readJson<AssignTarget>(request);
    return assignProjectAsset(id, assetId, body);
  });
}
