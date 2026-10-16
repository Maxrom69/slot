import { notFound } from "next/navigation";
import { MathFeaturesWorkspace } from "@/components/studio/MathFeaturesWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectMathRoutePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await getProject(projectId);
  if (!project) notFound();

  return <MathFeaturesWorkspace project={project} />;
}
