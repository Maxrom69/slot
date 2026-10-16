import { notFound } from "next/navigation";
import { ExportWorkspace } from "@/components/studio/ExportWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectsExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return <ExportWorkspace project={project} />;
}
