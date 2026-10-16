import { notFound } from "next/navigation";
import { PaytableEditorWorkspace } from "@/components/studio/PaytableEditorWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectsPaytablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return <PaytableEditorWorkspace project={project} />;
}
