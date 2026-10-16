import "server-only";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectAssets, projects } from "@/db/schema";
import type { AssetRef } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { applyDesign, sceneAssetIds } from "@/lib/design/migrate";
import { finalizeDoc } from "@/lib/design/model";
import { parseDesignDoc } from "@/lib/design/parse";
import { decodeArtwork } from "./artwork";
import { WorkspaceError, newId, normalizeBlueprint } from "./workspace-service";

const ASSET_URI = /^\/api\/assets\/(ast_[A-Za-z0-9_]+)$/;
const MAX_PROJECT_STORAGE_BYTES = 64 * 1024 * 1024;

/**
 * Persists the Design slice of a project's Game Blueprint.
 *  - the stored row is locked, so concurrent saves serialise
 *  - only the design slice is merged; metadata/folder edits made elsewhere are preserved
 *  - stale writers get 409 unless they explicitly overwrite
 *  - broken references are rejected; unfinished work (e.g. no symbols) is allowed
 */
export async function saveDesign(projectId: string, body: unknown) {
  const input = (body ?? {}) as { baseRevision?: unknown; force?: unknown; doc?: unknown };
  if (typeof input.baseRevision !== "number" || !Number.isInteger(input.baseRevision) || input.baseRevision < 0) {
    throw new WorkspaceError("baseRevision is required.", 400);
  }
  const parsed = parseDesignDoc(input.doc);
  if (!parsed.ok) throw new WorkspaceError(parsed.error, 422);

  const result = await db.transaction(async (tx) => {
    const rows = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    const row = rows[0];
    if (!row || row.deletedAt) throw new WorkspaceError("Project not found", 404);
    if (input.force !== true && row.revision !== input.baseRevision) {
      throw new WorkspaceError("This project was changed in another tab or window.", 409, { revision: row.revision });
    }

    const stored = normalizeBlueprint(row.blueprint, row.folderPath);
    const doc = finalizeDoc({
      ...parsed.doc,
      referenceAssetId: stored.style.referenceAssetId ?? null,
      protectedAssetIds: sceneAssetIds(stored),
    });
    const merged = applyDesign(stored, doc);

    // Linked artwork must be a stored image of this project (or already part of it).
    const unchanged = new Map(stored.assets.map((a: AssetRef) => [a.id, a.uri]));
    const wanted = new Map<string, string>();
    for (const asset of merged.assets) {
      if (asset.state !== "linked" || !asset.uri) continue;
      if (unchanged.get(asset.id) === asset.uri) continue;
      const match = ASSET_URI.exec(asset.uri);
      if (!match) throw new WorkspaceError(`Artwork “${asset.name}” must be uploaded through the studio.`, 422);
      wanted.set(match[1], asset.name);
    }
    if (wanted.size > 0) {
      const found = await tx
        .select({ id: projectAssets.id })
        .from(projectAssets)
        .where(and(eq(projectAssets.projectId, projectId), inArray(projectAssets.id, Array.from(wanted.keys()))));
      const have = new Set(found.map((r) => r.id));
      for (const [id, name] of wanted) {
        if (!have.has(id)) throw new WorkspaceError(`Artwork “${name}” was not found in this project.`, 422);
      }
    }

    const check = validateBlueprint(merged);
    if (!check.integrityOk) throw new WorkspaceError(`Design failed validation: ${check.integrityIssues[0]}`, 422);

    const updatedAt = new Date();
    const background = merged.assets.find((a) => a.id === merged.canvas.backgroundAssetId);
    const backgroundUri = background && background.state === "linked" ? background.uri : null;
    const thumbnailUri =
      backgroundUri ?? (row.thumbnailUri?.startsWith("/api/assets/") ? null : row.thumbnailUri);
    const revision = row.revision + 1;

    await tx
      .update(projects)
      .set({
        blueprint: { ...merged, meta: { ...merged.meta, updatedAt: updatedAt.toISOString() } },
        thumbnailUri,
        revision,
        updatedAt,
      })
      .where(eq(projects.id, projectId));
    return { revision, updatedAt: updatedAt.toISOString() };
  });

  revalidatePath("/games");
  return result;
}

/** Validates and stores one image for a project; the caller links it via a Design save. */
export async function uploadAsset(projectId: string, body: unknown) {
  const input = (body ?? {}) as { name?: unknown; dataUrl?: unknown };
  const name = typeof input.name === "string" ? input.name.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  if (!name || typeof input.dataUrl !== "string") throw new WorkspaceError("An image name and data are required.", 400);

  const project = await db.select({ id: projects.id, deletedAt: projects.deletedAt }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project[0] || project[0].deletedAt) throw new WorkspaceError("Project not found", 404);

  let image: ReturnType<typeof decodeArtwork>;
  try {
    image = decodeArtwork(input.dataUrl, name);
  } catch (error) {
    throw new WorkspaceError(error instanceof Error ? error.message : "Unsupported image.", 422);
  }

  const used = await db
    .select({ total: sql<number>`coalesce(sum(${projectAssets.sizeBytes}), 0)::int` })
    .from(projectAssets)
    .where(eq(projectAssets.projectId, projectId));
  if ((used[0]?.total ?? 0) + image.sizeBytes > MAX_PROJECT_STORAGE_BYTES) {
    throw new WorkspaceError("This project has reached its 64 MB artwork storage limit.", 413);
  }

  const id = newId("ast");
  await db.insert(projectAssets).values({ id, projectId, name, ...image });
  const asset: AssetRef = { id, name, kind: "image", uri: `/api/assets/${id}`, state: "linked", tags: ["imported"] };
  return { asset, mime: image.mime, bytes: image.sizeBytes };
}
