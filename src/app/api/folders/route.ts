import { readJson, runRoute } from "@/app/api/_lib/handler";
import { createFolder, getWorkspace } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export async function GET() {
  return runRoute(async () => (await getWorkspace()).folders);
}

export async function POST(request: Request) {
  return runRoute(async () => {
    const body = await readJson<{ name?: string; parentPath?: string }>(request);
    return createFolder(body.name ?? "", body.parentPath ?? "");
  });
}
