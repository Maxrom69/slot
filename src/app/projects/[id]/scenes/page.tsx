import { notFound } from "next/navigation";
import { CanvasApp } from "@/components/canvas/CanvasApp";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectsScenesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return (
    <CanvasApp
      project={{ id: project.id, title: project.title }}
      blueprint={project.blueprint}
      revision={project.revision}
    />
  );
}
