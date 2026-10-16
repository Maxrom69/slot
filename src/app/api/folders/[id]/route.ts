import { readJson, runRoute } from "@/app/api/_lib/handler";
import { deleteFolder, renameFolder } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return runRoute(async () => {
    const body = await readJson<{ name?: string }>(request);
    return renameFolder(id, body.name ?? "");
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return runRoute(() => deleteFolder(id));
}
