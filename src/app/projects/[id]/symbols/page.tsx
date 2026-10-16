import { notFound } from "next/navigation";
import { SymbolsWorkspace } from "@/components/studio/SymbolsWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectsSymbolsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return <SymbolsWorkspace project={project} />;
}
