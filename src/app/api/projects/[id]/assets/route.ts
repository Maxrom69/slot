import { readJson, runRoute } from "@/app/api/_lib/handler";
import { getProjectAssets, uploadProjectAsset, type UploadAssetInput } from "@/server/asset-service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return runRoute(async () => getProjectAssets(id));
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return runRoute(async () => uploadProjectAsset(id, await readJson<UploadAssetInput>(request)));
}
