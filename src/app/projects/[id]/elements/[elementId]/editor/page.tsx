import { notFound } from "next/navigation";
import { ManualElementEditor } from "@/components/design/ManualElementEditor";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string; elementId: string }>;
}

export default async function ManualElementEditorPage({ params }: PageProps) {
  const { id, elementId } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  return (
    <ManualElementEditor
      project={{
        id: project.id,
        title: project.title,
        theme: project.theme,
        status: project.status,
        folderPath: project.folderPath,
      }}
      blueprint={project.blueprint}
      revision={project.revision}
      elementId={decodeURIComponent(elementId)}
    />
  );
}
