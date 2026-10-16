import { NewGameWorkflow } from "@/components/dashboard/NewGameWorkflow";
import { getWorkspace, normalizePath } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const { folder } = await searchParams;
  const snapshot = await getWorkspace();
  const requested = normalizePath(folder);
  const initialFolder = snapshot.folders.some((f) => f.path === requested)
    ? requested
    : "";

  return <NewGameWorkflow folders={snapshot.folders} initialFolder={initialFolder} />;
}
