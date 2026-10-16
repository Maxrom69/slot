import { notFound } from "next/navigation";
import { PaylineEditorWorkspace } from "@/components/studio/PaylineEditorWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectsPaylinesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return <PaylineEditorWorkspace project={project} />;
}
