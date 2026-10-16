import { notFound } from "next/navigation";
import { PaylineEditorWorkspace } from "@/components/studio/PaylineEditorWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectPaylinesPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  return <PaylineEditorWorkspace project={project} />;
}
