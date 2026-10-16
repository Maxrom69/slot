import { notFound } from "next/navigation";
import { MathFeaturesWorkspace } from "@/components/studio/MathFeaturesWorkspace";
import { getProject } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectsMathPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  return <MathFeaturesWorkspace project={project} />;
}
