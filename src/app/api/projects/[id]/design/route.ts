import { readJson, runRoute } from "@/app/api/_lib/handler";
import { saveDesign } from "@/server/design-service";

export const dynamic = "force-dynamic";

export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return runRoute(async () => saveDesign(id, await readJson<unknown>(request)));
}
