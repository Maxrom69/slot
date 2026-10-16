import { notFound } from "next/navigation";
import { PaytableEditorWorkspace } from "@/components/studio/PaytableEditorWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectPaytablePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  return <PaytableEditorWorkspace project={project} />;
}
