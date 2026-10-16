import { notFound } from "next/navigation";
import { SymbolsWorkspace } from "@/components/studio/SymbolsWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectSymbolsRoutePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  return <SymbolsWorkspace project={project} />;
}
