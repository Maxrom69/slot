import { notFound } from "next/navigation";
import { PreviewWorkspace } from "@/components/studio/PreviewWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectsPreviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return <PreviewWorkspace project={project} />;
}
