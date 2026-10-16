import { notFound } from "next/navigation";
import { ProjectOverviewWorkspace } from "@/components/studio/ProjectOverviewWorkspace";
import { getProject, getWorkspace } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectRootPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const [project, snapshot] = await Promise.all([
    getProject(projectId),
    getWorkspace(),
  ]);
  if (!project) notFound();

  return <ProjectOverviewWorkspace project={project} folders={snapshot.folders} />;
}
