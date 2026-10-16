import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getWorkspace, normalizePath } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
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

  return <DashboardShell snapshot={snapshot} initialFolder={initialFolder} />;
}
