import { notFound } from "next/navigation";
import { DesignApp } from "@/components/design/DesignApp";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectsDesignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ element?: string }>;
}) {
  const { id } = await params;
  const { element } = await searchParams;
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
      initialElementId={typeof element === "string" && element ? element : null}
    />
  );
}
