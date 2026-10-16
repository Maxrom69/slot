import { notFound } from "next/navigation";
import { AssetLibraryApp } from "@/components/assets/AssetLibraryApp";
import { getProject } from "@/server/workspace-service";
import { getProjectAssets } from "@/server/asset-service";

export const dynamic = "force-dynamic";

export default async function ProjectAssetsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();

  const assetsResponse = await getProjectAssets(id);

  return (
    <AssetLibraryApp
      project={{
        id: project.id,
        title: project.title,
        theme: project.theme,
        status: project.status,
        folderPath: project.folderPath,
      }}
      blueprint={project.blueprint}
      initialAssets={assetsResponse.assets}
      totalStorageBytes={assetsResponse.totalStorageBytes}
    />
  );
}
