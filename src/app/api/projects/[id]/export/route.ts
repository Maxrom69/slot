import { getProject } from "@/server/workspace-service";
import { slugify } from "@/lib/blueprint/factory";

export const dynamic = "force-dynamic";

/** Exports the Game Blueprint as JSON — the artefact SECTION 2 will consume. */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) {
    return Response.json({ error: "Project not found" }, { status: 404 });
  }
  const body = JSON.stringify(project.blueprint, null, 2);
  return new Response(body, {
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="${slugify(project.title)}.blueprint.json"`,
    },
  });
}
