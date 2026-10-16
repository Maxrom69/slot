import { notFound } from "next/navigation";
import { DesignApp } from "@/components/design/DesignApp";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string; elementId: string }>;
}

export default async function ElementDetailPage({ params }: PageProps) {
  const { id, elementId } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  return (
    <DesignApp
      project={{
        id: project.id,
        title: project.title,
        theme: project.theme,
        status: project.status,
        folderPath: project.folderPath,
      }}
      blueprint={project.blueprint}
      revision={project.revision}
      initialElementId={decodeURIComponent(elementId)}
    />
  );
}
