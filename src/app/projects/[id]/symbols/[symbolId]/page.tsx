import { notFound } from "next/navigation";
import { SymbolEditor } from "@/components/design/SymbolEditor";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectSymbolEditorPage({
  params,
}: {
  params: Promise<{ id: string; symbolId: string }>;
}) {
  const { id, symbolId } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  const symbol = project.blueprint.symbols.find((s) => s.id === symbolId);
  if (!symbol) notFound();
  const setId = symbol.symbolSetId ?? null;

  return (
    <SymbolEditor
      project={{ id: project.id, title: project.title, theme: project.theme, revision: project.revision }}
      blueprint={project.blueprint}
      symbolId={symbolId}
      setId={setId}
    />
  );
}
