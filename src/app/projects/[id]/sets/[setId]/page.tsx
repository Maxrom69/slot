import { notFound } from "next/navigation";
import { SetEditor } from "@/components/design/SetEditor";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectSetEditorPage({
  params,
}: {
  params: Promise<{ id: string; setId: string }>;
}) {
  const { id, setId } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const matched = project.blueprint.elements.find(
    (e) =>
      e.type === "symbol_set" &&
      (e.id === setId || e.id === `el-${setId}` || e.id === `el-set-${setId}`),
  );
  if (!matched) notFound();

  return (
    <SetEditor
      project={{ id: project.id, title: project.title, theme: project.theme, revision: project.revision }}
      blueprint={project.blueprint}
      setId={matched.id}
    />
  );
}
