import { notFound } from "next/navigation";
import { PreviewWorkspace } from "@/components/studio/PreviewWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectPreviewRoutePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  return <PreviewWorkspace project={project} />;
}
