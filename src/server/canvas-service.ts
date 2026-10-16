import "server-only";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects } from "@/db/schema";
import type { GameBlueprint, SceneBackground, SceneObject } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { parseSceneDoc } from "@/lib/canvas/parse";
import { WorkspaceError } from "./workspace-service";

const MAX_SCENE = 20000;

/** Cross-checks parsed scene layout against the rest of the blueprint. */
function validateScene(
  bp: GameBlueprint,
  sceneId: string,
  objects: SceneObject[],
  background: SceneBackground,
  customLayers?: import("@/lib/blueprint/types").LayerDef[],
): void {
  const scene = bp.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new WorkspaceError("That scene no longer exists. Reload the canvas.", 422);
  const effectiveLayers = customLayers && customLayers.length > 0 ? customLayers : bp.layers;
  const layerIds = new Set(effectiveLayers.map((l) => l.id));
  const assetIds = new Set(bp.assets.map((a) => a.id));
  const refIds = new Set([
    ...bp.symbols.map((s) => s.id),
    ...bp.elements.map((e) => e.id),
    ...(bp.animations ?? []).map((a) => a.id),
  ]);
  const seen = new Set<string>();
  for (const object of objects) {
    if (seen.has(object.id)) throw new WorkspaceError(`Duplicate object id “${object.id}”.`, 422);
    seen.add(object.id);
    if (!layerIds.has(object.layerId))
      throw new WorkspaceError(`“${object.name}” is on a layer that no longer exists.`, 422);
    if (object.assetId && !assetIds.has(object.assetId))
      throw new WorkspaceError(`“${object.name}” uses artwork that is not part of this project.`, 422);
    if (object.refId && !refIds.has(object.refId))
      throw new WorkspaceError(`“${object.name}” refers to an element, symbol or animation that no longer exists.`, 422);
    if (Math.abs(object.x) > MAX_SCENE || Math.abs(object.y) > MAX_SCENE)
      throw new WorkspaceError(`“${object.name}” is placed outside the supported scene area.`, 422);
  }
  if (background.assetId && !assetIds.has(background.assetId))
    throw new WorkspaceError("The scene background artwork is not part of this project.", 422);
}

/**
 * Persists one scene's layout into the Game Blueprint.
 * Row-locked and revision-checked like the Design save, so two editors cannot
 * silently overwrite each other. Only the scene slice is merged.
 */
export async function saveScene(projectId: string, body: unknown) {
  const input = (body ?? {}) as Record<string, unknown>;
  if (typeof input.baseRevision !== "number" || !Number.isInteger(input.baseRevision) || input.baseRevision < 0)
    throw new WorkspaceError("baseRevision is required.", 400);
  if (typeof input.sceneId !== "string" || !input.sceneId) throw new WorkspaceError("sceneId is required.", 400);

  const parsed = parseSceneDoc({
    objects: input.objects ?? [],
    background: input.background ?? {},
    layers: input.layers,
    name: input.name,
    canvasConfiguration: input.canvasConfiguration,
    visibility: input.visibility,
    composedImages: input.composedImages,
    layoutMetadata: input.layoutMetadata,
    scenes: input.scenes,
  });
  if (!parsed.ok) throw new WorkspaceError(parsed.error, 422);
  const {
    objects,
    background,
    layers,
    name,
    canvasConfiguration,
    visibility,
    composedImages,
    layoutMetadata,
    scenes: incomingScenes,
  } = parsed.value;
  const sceneId = input.sceneId as string;

  const result = await db.transaction(async (tx) => {
    const rows = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    const row = rows[0];
    if (!row || row.deletedAt) throw new WorkspaceError("Project not found", 404);
    if (input.force !== true && row.revision !== input.baseRevision)
      throw new WorkspaceError("This project was changed in another tab or window.", 409, { revision: row.revision });

    const stored: GameBlueprint = row.blueprint;
    const baseScenes = incomingScenes ?? stored.scenes;
    const validationTargetBp: GameBlueprint = { ...stored, scenes: baseScenes };

    validateScene(validationTargetBp, sceneId, objects, background, layers);
    if (incomingScenes) {
      for (const sc of incomingScenes) {
        if (sc.id !== sceneId) {
          validateScene(
            validationTargetBp,
            sc.id,
            sc.objects ?? [],
            sc.background ?? { color: null, assetId: null },
            sc.layers ?? layers,
          );
        }
      }
    }

    const blueprint: GameBlueprint = {
      ...stored,
      layers: layers && layers.length > 0 ? layers : stored.layers,
      scenes: baseScenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              ...(name !== undefined ? { name } : {}),
              objects,
              background,
              ...(layers && layers.length > 0 && scene.layers !== undefined ? { layers } : {}),
              ...(canvasConfiguration !== undefined ? { canvasConfiguration } : {}),
              ...(visibility !== undefined ? { visibility } : {}),
              ...(composedImages !== undefined ? { composedImages } : {}),
              ...(layoutMetadata !== undefined ? { layoutMetadata } : {}),
            }
          : scene,
      ),
    };

    const check = validateBlueprint(blueprint);
    if (!check.integrityOk) throw new WorkspaceError(`Scene failed validation: ${check.integrityIssues[0]}`, 422);

    const updatedAt = new Date();
    const revision = row.revision + 1;
    await tx
      .update(projects)
      .set({
        blueprint: { ...blueprint, meta: { ...blueprint.meta, updatedAt: updatedAt.toISOString() } },
        revision,
        updatedAt,
      })
      .where(eq(projects.id, projectId));
    return { revision, updatedAt: updatedAt.toISOString() };
  });

  revalidatePath("/games");
  return result;
}
