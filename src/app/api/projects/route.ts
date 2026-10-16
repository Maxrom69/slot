import { readJson, runRoute } from "@/app/api/_lib/handler";
import type { CreateProjectInput } from "@/lib/workspace/types";
import { createProject, getWorkspace } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export async function GET() {
  return runRoute(async () => (await getWorkspace()).projects);
}

export async function POST(request: Request) {
  return runRoute(async () => {
    const body = await readJson<CreateProjectInput>(request);
    return createProject(body);
  });
}
