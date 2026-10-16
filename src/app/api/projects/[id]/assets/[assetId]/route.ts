import { readJson, runRoute } from "@/app/api/_lib/handler";
import { deleteProjectAsset, updateProjectAsset } from "@/server/asset-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { id, assetId } = await ctx.params;
  return runRoute(async () => {
    const body = await readJson<{ name?: string; tags?: string[] }>(request);
    return updateProjectAsset(id, assetId, body);
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id, assetId } = await ctx.params;
  return runRoute(async () => deleteProjectAsset(id, assetId));
}
