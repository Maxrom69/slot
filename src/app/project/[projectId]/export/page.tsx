import { notFound } from "next/navigation";
import { ExportWorkspace } from "@/components/studio/ExportWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectExportRoutePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  return <ExportWorkspace project={project} />;
}
