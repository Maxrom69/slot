import "server-only";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectAssets, projects } from "@/db/schema";
import type { AssetRef, GameBlueprint } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { decodeArtwork } from "./artwork";
import { WorkspaceError, newId, normalizeBlueprint } from "./workspace-service";
import {
  findAssetUsage,
  safeUnbindAsset,
  assignAsset,
  detectAssetFormat,
  type AssignTarget,
  type AssetUsageItem,
} from "@/lib/assets/usage";

const MAX_PROJECT_STORAGE_BYTES = 64 * 1024 * 1024;

export interface ProjectAssetSummary extends AssetRef {
  usage: AssetUsageItem[];
  usageCount: number;
}

export interface ProjectAssetsResponse {
  assets: ProjectAssetSummary[];
  totalStorageBytes: number;
  maxStorageBytes: number;
}

/** Fetches all project assets enriched with usage counts, dimensions, and format detection. */
export async function getProjectAssets(projectId: string): Promise<ProjectAssetsResponse> {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId)))
    .limit(1);

  const row = rows[0];
  if (!row || row.deletedAt) throw new WorkspaceError("Project not found", 404);

  const bp = normalizeBlueprint(row.blueprint, row.folderPath);

  // Fetch binary asset records to get exact size and timestamps if available
  const storedAssets = await db
    .select({
      id: projectAssets.id,
      name: projectAssets.name,
      sizeBytes: projectAssets.sizeBytes,
      mime: projectAssets.mime,
      createdAt: projectAssets.createdAt,
    })
    .from(projectAssets)
    .where(eq(projectAssets.projectId, projectId));

  const storedMap = new Map(storedAssets.map((s) => [s.id, s]));

  const assets: ProjectAssetSummary[] = (bp.assets ?? []).map((asset) => {
    const usage = findAssetUsage(bp, asset.id);
    const stored = storedMap.get(asset.id);
    const formatInfo = detectAssetFormat(asset);
    const storedCreatedAt =
      stored?.createdAt instanceof Date
        ? stored.createdAt.toISOString()
        : typeof stored?.createdAt === "string"
        ? stored.createdAt
        : undefined;

    return {
      ...asset,
      sizeBytes: asset.sizeBytes ?? stored?.sizeBytes ?? 0,
      mime: asset.mime ?? stored?.mime ?? undefined,
      createdAt: asset.createdAt ?? storedCreatedAt ?? bp.meta.createdAt,
      format: asset.format ?? formatInfo.format,
      hasAlpha: asset.hasAlpha ?? formatInfo.isTransparent,
      usage,
      usageCount: usage.length,
    };
  });

  const totalStorage = storedAssets.reduce((sum, a) => sum + a.sizeBytes, 0);

  return {
    assets,
    totalStorageBytes: totalStorage,
    maxStorageBytes: MAX_PROJECT_STORAGE_BYTES,
  };
}

export interface UploadAssetInput {
  name: string;
  dataUrl: string;
  tags?: string[];
}

/** Validates and uploads a new asset file, storing the binary record and updating blueprint.assets. */
export async function uploadProjectAsset(
  projectId: string,
  input: UploadAssetInput,
): Promise<{ asset: ProjectAssetSummary }> {
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  if (!name || typeof input.dataUrl !== "string") {
    throw new WorkspaceError("An asset filename and file data are required.", 400);
  }

  let decoded: ReturnType<typeof decodeArtwork>;
  try {
    decoded = decodeArtwork(input.dataUrl, name);
  } catch (error) {
    throw new WorkspaceError(error instanceof Error ? error.message : "Unsupported asset file.", 422);
  }

  const result = await db.transaction(async (tx) => {
    const rows = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    const row = rows[0];
    if (!row || row.deletedAt) throw new WorkspaceError("Project not found", 404);

    const used = await tx
      .select({ total: sql<number>`coalesce(sum(${projectAssets.sizeBytes}), 0)::int` })
      .from(projectAssets)
      .where(eq(projectAssets.projectId, projectId));

    if ((used[0]?.total ?? 0) + decoded.sizeBytes > MAX_PROJECT_STORAGE_BYTES) {
      throw new WorkspaceError("This project has reached its 64 MB asset storage limit.", 413);
    }

    const id = newId("ast");
    await tx.insert(projectAssets).values({
      id,
      projectId,
      name,
      mime: decoded.mime,
      sizeBytes: decoded.sizeBytes,
      dataBase64: decoded.dataBase64,
    });

    const now = new Date().toISOString();
    const assetRef: AssetRef = {
      id,
      name,
      kind: decoded.kind,
      uri: `/api/assets/${id}`,
      state: "linked",
      tags: Array.isArray(input.tags) ? input.tags.slice(0, 12) : ["imported", "library"],
      width: decoded.width,
      height: decoded.height,
      format: decoded.format,
      mime: decoded.mime,
      sizeBytes: decoded.sizeBytes,
      hasAlpha: decoded.hasAlpha,
      createdAt: now,
      updatedAt: now,
      revisions: [
        {
          id: `${id}-rev-1`,
          uri: `/api/assets/${id}`,
          createdAt: now,
          source: "upload",
          notes: `Uploaded ${name}`,
        },
      ],
    };

    const bp = normalizeBlueprint(row.blueprint, row.folderPath);
    const existingAssets = (bp.assets ?? []).filter((a) => a.id !== id);
    const updatedBp: GameBlueprint = {
      ...bp,
      assets: [...existingAssets, assetRef],
    };

    const check = validateBlueprint(updatedBp);
    if (!check.integrityOk) {
      throw new WorkspaceError(`Asset upload failed validation: ${check.integrityIssues[0]}`, 422);
    }

    await tx
      .update(projects)
      .set({
        blueprint: { ...updatedBp, meta: { ...updatedBp.meta, updatedAt: now } },
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return {
      ...assetRef,
      usage: [],
      usageCount: 0,
    };
  });

  revalidatePath("/games");
  return { asset: result };
}

/** Updates asset metadata (filename, tags) in blueprint.assets and project_assets table. */
export async function updateProjectAsset(
  projectId: string,
  assetId: string,
  patch: { name?: string; tags?: string[] },
): Promise<{ asset: AssetRef }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    const row = rows[0];
    if (!row || row.deletedAt) throw new WorkspaceError("Project not found", 404);

    const bp = normalizeBlueprint(row.blueprint, row.folderPath);
    const target = bp.assets.find((a) => a.id === assetId);
    if (!target) throw new WorkspaceError("Asset not found in project.", 404);

    const newName = patch.name ? patch.name.replace(/\s+/g, " ").trim().slice(0, 120) : target.name;
    const newTags = patch.tags ? patch.tags.slice(0, 12) : target.tags;
    const now = new Date().toISOString();

    const updatedAsset: AssetRef = {
      ...target,
      name: newName,
      tags: newTags,
      updatedAt: now,
    };

    const updatedBp: GameBlueprint = {
      ...bp,
      assets: bp.assets.map((a) => (a.id === assetId ? updatedAsset : a)),
    };

    if (patch.name) {
      await tx
        .update(projectAssets)
        .set({ name: newName })
        .where(and(eq(projectAssets.id, assetId), eq(projectAssets.projectId, projectId)));
    }

    const revision = row.revision + 1;
    await tx
      .update(projects)
      .set({
        blueprint: { ...updatedBp, meta: { ...updatedBp.meta, updatedAt: now } },
        revision,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return { asset: updatedAsset };
  });
}

/** Safely deletes an asset, unbinding all references cleanly without blueprint corruption. */
export async function deleteProjectAsset(
  projectId: string,
  assetId: string,
): Promise<{ unlinkedCount: number; deletedId: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    const row = rows[0];
    if (!row || row.deletedAt) throw new WorkspaceError("Project not found", 404);

    const bp = normalizeBlueprint(row.blueprint, row.folderPath);
    const target = bp.assets.find((a) => a.id === assetId);
    if (!target) throw new WorkspaceError("Asset not found in project.", 404);

    const usage = findAssetUsage(bp, assetId);
    const unlinkedCount = usage.length;

    // Safely unbind from elements, symbols, scenes, canvas, style
    const cleanedBp = safeUnbindAsset(bp, assetId);

    const check = validateBlueprint(cleanedBp);
    if (!check.integrityOk) {
      throw new WorkspaceError(`Asset deletion failed validation: ${check.integrityIssues[0]}`, 422);
    }

    // Delete stored binary record if it exists
    await tx
      .delete(projectAssets)
      .where(and(eq(projectAssets.id, assetId), eq(projectAssets.projectId, projectId)));

    const now = new Date().toISOString();
    const revision = row.revision + 1;
    await tx
      .update(projects)
      .set({
        blueprint: { ...cleanedBp, meta: { ...cleanedBp.meta, updatedAt: now } },
        revision,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return { unlinkedCount, deletedId: assetId };
  });
}

/** Assigns an asset to a symbol, element, scene, or canvas background. */
export async function assignProjectAsset(
  projectId: string,
  assetId: string,
  target: AssignTarget,
): Promise<{ updatedBlueprint: GameBlueprint }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    const row = rows[0];
    if (!row || row.deletedAt) throw new WorkspaceError("Project not found", 404);

    const bp = normalizeBlueprint(row.blueprint, row.folderPath);
    const targetAsset = bp.assets.find((a) => a.id === assetId);
    if (!targetAsset) throw new WorkspaceError("Asset not found in project.", 404);

    const updatedBp = assignAsset(bp, assetId, target);

    const check = validateBlueprint(updatedBp);
    if (!check.integrityOk) {
      throw new WorkspaceError(`Asset assignment failed validation: ${check.integrityIssues[0]}`, 422);
    }

    const now = new Date().toISOString();
    const revision = row.revision + 1;
    await tx
      .update(projects)
      .set({
        blueprint: { ...updatedBp, meta: { ...updatedBp.meta, updatedAt: now } },
        revision,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));

    return { updatedBlueprint: updatedBp };
  });
}
