import { runRoute } from "@/app/api/_lib/handler";
import { duplicateProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return runRoute(() => duplicateProject(id));
}
