import { notFound } from "next/navigation";
import { ReelEditorWorkspace } from "@/components/studio/ReelEditorWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectReelsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  return <ReelEditorWorkspace project={project} />;
}
