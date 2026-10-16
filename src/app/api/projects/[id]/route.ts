import { readJson, runRoute } from "@/app/api/_lib/handler";
import type { GameBlueprint } from "@/lib/blueprint/types";
import type { UpdateProjectInput } from "@/lib/workspace/types";
import {
  WorkspaceError,
  deleteProject,
  getProject,
  saveProject,
  updateProject,
} from "@/server/workspace-service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return runRoute(async () => {
    const project = await getProject(id);
    if (!project) throw new WorkspaceError("Project not found", 404);
    return project;
  });
}

export async function PUT(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return runRoute(async () => {
    const body = await readJson<{ blueprint?: GameBlueprint } | GameBlueprint>(request);
    const blueprint =
      body && typeof body === "object" && "blueprint" in body && body.blueprint
        ? body.blueprint
        : (body as GameBlueprint);
    return saveProject(id, blueprint);
  });
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return runRoute(async () => {
    const body = await readJson<UpdateProjectInput>(request);
    return updateProject(id, body);
  });
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return runRoute(() => deleteProject(id));
}

