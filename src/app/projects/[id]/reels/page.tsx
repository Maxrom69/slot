import { notFound } from "next/navigation";
import { ReelEditorWorkspace } from "@/components/studio/ReelEditorWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectsReelsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return <ReelEditorWorkspace project={project} />;
}
