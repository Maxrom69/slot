import { getWorkspace } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getWorkspace();
  return Response.json(snapshot);
}
