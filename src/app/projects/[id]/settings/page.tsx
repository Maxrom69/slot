import { notFound } from "next/navigation";
import { ProjectWorkspace } from "@/components/project/ProjectWorkspace";
import { getProject, getWorkspace } from "@/server/workspace-service";

export const dynamic = "force-dynamic";

export default async function ProjectSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab } = await searchParams;
  const [project, snapshot] = await Promise.all([getProject(id), getWorkspace()]);
  if (!project) notFound();

  return (
    <ProjectWorkspace
      project={project}
      folders={snapshot.folders}
      initialTab={tab === "blueprint" ? "blueprint" : "overview"}
    />
  );
}
