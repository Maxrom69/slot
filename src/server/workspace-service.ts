import "server-only";

import { and, asc, eq, isNull, like, or } from "drizzle-orm";
import { db } from "@/db";
import { folders, projectAssets, projects, type FolderRow, type ProjectRow } from "@/db/schema";
import { createBlueprint, slugify } from "@/lib/blueprint/factory";
import { revalidatePath } from "next/cache";
import { decodeArtwork } from "./artwork";
import { migrateBlueprint } from "@/lib/design/migrate";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { draftToBlueprint } from "@/lib/creation/blueprint-from-draft";
import { createDefaultDraft, creationInputIssues, normalizeDraft, validateDraft, type NewGameDraft } from "@/lib/creation/draft";
import type { GameBlueprint, ProjectStatus, Volatility } from "@/lib/blueprint/types";
import type {
  CreateProjectInput,
  FolderSummary,
  ProjectDetail,
  ProjectSummary,
  UpdateProjectInput,
  WorkspaceSnapshot,
} from "@/lib/workspace/types";
import { DEMO_PROJECTS } from "./demo-data";

export class WorkspaceError extends Error {
  status: number;
  data?: Record<string, unknown>;
  constructor(message: string, status = 400, data?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

/* ------------------------------------------------------------------ */
/* path helpers                                                        */
/* ------------------------------------------------------------------ */

export function normalizePath(path: string | null | undefined): string {
  if (!path) return "";
  return path
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

export function sanitizeFolderName(name: string): string {
  const clean = name.replace(/[/\\]/g, " ").trim().replace(/\s+/g, " ");
  if (!clean) throw new WorkspaceError("Folder name is required");
  if (clean.length > 48) return clean.slice(0, 48);
  return clean;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/* ------------------------------------------------------------------ */
/* mappers                                                             */
/* ------------------------------------------------------------------ */

function toProjectSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    title: row.title,
    theme: row.theme,
    styleGuide: row.styleGuide,
    description: row.description,
    status: row.status as ProjectStatus,
    folderPath: row.folderPath,
    thumbnailUri: row.thumbnailUri,
    columns: row.columns,
    rows: row.rows,
    paylineCount: row.paylineCount,
    rtpTarget: row.rtpTarget,
    volatility: row.volatility as Volatility,
    isDemo: row.isDemo,
    symbolCount: row.blueprint?.symbols?.length ?? 0,
    assetCount: row.blueprint?.assets?.length ?? 0,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Every read upgrades older blueprints to the current Design model (idempotent). */
export function normalizeBlueprint(raw: GameBlueprint, folderPath?: string): GameBlueprint {
  const bp = migrateBlueprint(raw);
  return {
    ...bp,
    meta: { ...bp.meta, ...(folderPath !== undefined ? { folderPath } : {}) },
    ...(bp.creation && folderPath !== undefined ? { creation: { ...bp.creation, folderPath } } : {}),
  };
}

function toProjectDetail(row: ProjectRow): ProjectDetail {
  return {
    ...toProjectSummary(row),
    revision: row.revision,
    blueprint: normalizeBlueprint(row.blueprint, row.folderPath),
  };
}

function toFolderSummary(
  row: FolderRow,
  projectRows: ProjectRow[],
  folderRows: FolderRow[],
): FolderSummary {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    parentPath: row.parentPath,
    projectCount: projectRows.filter(
      (p) => p.folderPath === row.path || p.folderPath.startsWith(`${row.path}/`),
    ).length,
    childFolderCount: folderRows.filter((f) => f.parentPath === row.path).length,
    createdAt: row.createdAt.toISOString(),
  };
}

/* ------------------------------------------------------------------ */
/* seeding                                                             */
/* ------------------------------------------------------------------ */

let seedChecked = false;

export async function ensureDemoWorkspace(): Promise<void> {
  if (seedChecked) return;

  // Seed each missing demo independently so an existing production database
  // cannot hide the built-in demos when it already contains user projects.
  const folderPaths = Array.from(
    new Set(
      DEMO_PROJECTS.map((p) => p.folderPath).filter((p): p is string => Boolean(p)),
    ),
  );
  const allPaths = new Set<string>();
  folderPaths.forEach((path) => {
    const segments = path.split("/");
    segments.forEach((_, i) => allPaths.add(segments.slice(0, i + 1).join("/")));
  });

  for (const path of Array.from(allPaths).sort()) {
    const segments = path.split("/");
    await db
      .insert(folders)
      .values({
        id: newId("fld"),
        name: segments[segments.length - 1],
        parentPath: segments.slice(0, -1).join("/"),
        path,
      })
      .onConflictDoNothing();
  }

  const now = Date.now();
  for (const demo of DEMO_PROJECTS) {
    const updatedAt = new Date(now - demo.updatedMinutesAgo * 60_000);
    const createdAt = new Date(now - demo.createdDaysAgo * 86_400_000);
    const blueprint = createBlueprint({
      id: demo.id,
      title: demo.title,
      description: demo.description,
      theme: demo.theme,
      styleGuide: demo.styleGuide,
      status: demo.status,
      columns: demo.columns,
      rows: demo.rows,
      paylineCount: demo.paylineCount,
      rtpTarget: demo.rtpTarget,
      volatility: demo.volatility,
      tags: demo.tags,
      symbolArt: demo.symbolArt,
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });

    await db
      .insert(projects)
      .values({
        id: demo.id,
        title: demo.title,
        theme: demo.theme,
        styleGuide: demo.styleGuide,
        description: demo.description,
        status: demo.status,
        folderPath: demo.folderPath ?? "",
        thumbnailUri: demo.thumbnailUri ?? null,
        columns: demo.columns,
        rows: demo.rows,
        paylineCount: demo.paylineCount,
        rtpTarget: demo.rtpTarget,
        volatility: demo.volatility,
        isDemo: true,
        blueprint,
        createdAt,
        updatedAt,
      })
      .onConflictDoNothing();
  }

  // Upgrade older demo rows after inserting any that were missing.
  await upgradeDemoBlueprints();
  seedChecked = true;
}

/* ------------------------------------------------------------------ */
/* one-time demo blueprint upgrade                                     */
/* ------------------------------------------------------------------ */

async function upgradeDemoBlueprints(): Promise<void> {
  for (const demo of DEMO_PROJECTS) {
    if (!demo.symbolArt) continue;
    const rows = await db.select({ blueprint: projects.blueprint }).from(projects).where(eq(projects.id, demo.id)).limit(1);
    const row = rows[0];
    if (!row) continue;
    const hasArt = (row.blueprint?.assets ?? []).some((a) => a.id.startsWith("symart-"));
    if (hasArt) continue;
    const now = Date.now();
    const blueprint = createBlueprint({
      id: demo.id,
      title: demo.title,
      description: demo.description,
      theme: demo.theme,
      styleGuide: demo.styleGuide,
      status: demo.status,
      columns: demo.columns,
      rows: demo.rows,
      paylineCount: demo.paylineCount,
      rtpTarget: demo.rtpTarget,
      volatility: demo.volatility,
      tags: demo.tags,
      symbolArt: demo.symbolArt,
      createdAt: new Date(now - demo.createdDaysAgo * 86_400_000).toISOString(),
      updatedAt: new Date(now - demo.updatedMinutesAgo * 60_000).toISOString(),
    });
    await db
      .update(projects)
      .set({ blueprint, thumbnailUri: demo.thumbnailUri ?? null, updatedAt: new Date(now - demo.updatedMinutesAgo * 60_000) })
      .where(eq(projects.id, demo.id));
  }
}

/* ------------------------------------------------------------------ */
/* reads                                                               */
/* ------------------------------------------------------------------ */

function safeRevalidatePath(routePath: string): void {
  try {
    revalidatePath(routePath);
  } catch {
    // No-op when called outside a Next.js request context (e.g., CLI/unit tests)
  }
}

export async function getWorkspace(): Promise<WorkspaceSnapshot> {
  await ensureDemoWorkspace();
  const [projectRows, folderRows] = await Promise.all([
    db.select().from(projects).where(isNull(projects.deletedAt)),
    db.select().from(folders).orderBy(asc(folders.path)),
  ]);

  return {
    projects: projectRows.map(toProjectSummary),
    folders: folderRows.map((row) => toFolderSummary(row, projectRows, folderRows)),
  };
}

export async function getProject(id: string): Promise<ProjectDetail | null> {
  await ensureDemoWorkspace();
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) return null;
  return toProjectDetail(row);
}

export async function loadProject(id: string): Promise<ProjectDetail | null> {
  return getProject(id);
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const snapshot = await getWorkspace();
  return snapshot.projects;
}

/* ------------------------------------------------------------------ */
/* project mutations                                                   */
/* ------------------------------------------------------------------ */

function legacyToDraft(input: CreateProjectInput): NewGameDraft {
  const base = createDefaultDraft();
  return normalizeDraft({
    ...base,
    title: input.title,
    theme: input.theme,
    styleGuide: input.styleGuide ?? "",
    description: input.description ?? "",
    folderPath: input.folderPath ?? "",
    grid: { preset: "custom", columns: input.columns ?? 5, rows: input.rows ?? 3 },
    evaluation: input.evaluation ?? "lines",
    paylineCount: input.paylineCount ?? 20,
    rtpTarget: input.rtpTarget ?? 96,
    volatility: input.volatility ?? "medium",
    status: input.status ?? "draft",
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Moves inline data-URL artwork into asset storage and rewrites blueprint URIs. */
async function persistInlineAssets(
  tx: Tx,
  projectId: string,
  blueprint: GameBlueprint,
): Promise<GameBlueprint> {
  const assets = [];
  for (const asset of blueprint.assets) {
    if (!asset.uri || !asset.uri.startsWith("data:")) {
      assets.push(asset);
      continue;
    }
    let image: ReturnType<typeof decodeArtwork>;
    try { image = decodeArtwork(asset.uri, asset.name); }
    catch (error) { throw new WorkspaceError(error instanceof Error ? error.message : "Invalid artwork", 422); }
    const storedId = newId("ast");
    await tx.insert(projectAssets).values({
      id: storedId,
      projectId,
      name: asset.name,
      ...image,
    });
    assets.push({ ...asset, uri: `/api/assets/${storedId}` });
  }
  return { ...blueprint, assets };
}

export async function createProject(input: CreateProjectInput): Promise<ProjectDetail> {
  if (input.draft !== undefined) {
    const issues = creationInputIssues(input.draft);
    if (issues.length) throw new WorkspaceError(issues[0], 422);
  }
  const draft = input.draft !== undefined ? normalizeDraft(input.draft) : legacyToDraft(input);

  const validation = validateDraft(draft);
  const firstError = Object.values(validation.errors)[0];
  if (firstError) throw new WorkspaceError(firstError, 422);

  const folderPath = normalizePath(draft.folderPath);
  const id = newId("prj");

  const draftBlueprint = draftToBlueprint(draft, { id });
  const check = validateBlueprint(draftBlueprint);
  if (!check.ok) {
    throw new WorkspaceError(`Blueprint validation failed: ${check.issues[0]}`, 422);
  }

  const inserted = await db.transaction(async (tx) => {
    if (folderPath) await ensureFolderPath(folderPath, tx);
    const blueprint = await persistInlineAssets(tx, id, draftBlueprint);
    const backgroundAsset = blueprint.assets.find(
      (a) => a.id === blueprint.canvas.backgroundAssetId && a.state === "linked",
    );
    const rows = await tx
      .insert(projects)
      .values({
        id,
        title: blueprint.meta.title,
        theme: blueprint.meta.theme,
        styleGuide: blueprint.meta.styleGuide,
        description: blueprint.meta.description,
        status: blueprint.meta.status,
        folderPath,
        thumbnailUri: backgroundAsset?.uri ?? null,
        columns: blueprint.reels.columns,
        rows: blueprint.reels.rows,
        paylineCount: blueprint.paylines.length,
        rtpTarget: blueprint.math.rtpTarget,
        volatility: blueprint.math.volatility,
        blueprint,
      })
      .returning();
    return rows[0];
  });

  safeRevalidatePath("/games");
  safeRevalidatePath("/games/new");
  safeRevalidatePath("/dashboard");
  return toProjectDetail(inserted);
}

export async function saveProject(
  id: string,
  nextBlueprint: GameBlueprint,
): Promise<ProjectDetail> {
  return db.transaction(async (tx) => {
    const current = await tx.select().from(projects).where(eq(projects.id, id)).for("update");
    const row = current[0];
    if (!row || row.deletedAt) throw new WorkspaceError("Project not found", 404);

    const updatedAt = new Date();
    const folderPath =
      nextBlueprint.meta?.folderPath !== undefined
        ? normalizePath(nextBlueprint.meta.folderPath)
        : row.folderPath;
    if (folderPath && folderPath !== row.folderPath) await ensureFolderPath(folderPath, tx);

    const normalized = normalizeBlueprint(nextBlueprint, folderPath);
    const title = (normalized.meta.title || row.title).trim();
    if (!title) throw new WorkspaceError("Title cannot be empty");

    const blueprint: GameBlueprint = {
      ...normalized,
      meta: {
        ...normalized.meta,
        id,
        title,
        slug: slugify(title),
        folderPath,
        updatedAt: updatedAt.toISOString(),
      },
    };

    const check = validateBlueprint(blueprint);
    if (!check.integrityOk) {
      throw new WorkspaceError(`Blueprint failed integrity check: ${check.integrityIssues[0]}`, 422);
    }

    const revision = row.revision + 1;
    const updated = await tx
      .update(projects)
      .set({
        title,
        theme: blueprint.meta.theme,
        styleGuide: blueprint.meta.styleGuide,
        description: blueprint.meta.description,
        status: blueprint.meta.status,
        folderPath,
        columns: blueprint.reels.columns,
        rows: blueprint.reels.rows,
        paylineCount: blueprint.paylines.length,
        rtpTarget: blueprint.math.rtpTarget,
        volatility: blueprint.math.volatility,
        revision,
        blueprint,
        updatedAt,
      })
      .where(eq(projects.id, id))
      .returning();

    safeRevalidatePath("/games");
    safeRevalidatePath("/dashboard");
    return toProjectDetail(updated[0]);
  });
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput,
): Promise<ProjectDetail> {
  // Row-locked so a concurrent Design save cannot be overwritten by a metadata edit.
  return db.transaction(async (tx) => {
    const current = await tx.select().from(projects).where(eq(projects.id, id)).for("update");
    const row = current[0];
    if (!row) throw new WorkspaceError("Project not found", 404);

    const baseBlueprint = patch.blueprint ?? row.blueprint;
    const nextTitle =
      patch.title !== undefined
        ? patch.title.trim()
        : patch.blueprint?.meta?.title !== undefined
          ? patch.blueprint.meta.title.trim()
          : row.title;
    if (!nextTitle) throw new WorkspaceError("Title cannot be empty");

    const nextFolder =
      patch.folderPath !== undefined
        ? normalizePath(patch.folderPath)
        : patch.blueprint?.meta?.folderPath !== undefined
          ? normalizePath(patch.blueprint.meta.folderPath)
          : row.folderPath;
    if (nextFolder && nextFolder !== row.folderPath) await ensureFolderPath(nextFolder, tx);

    const updatedAt = new Date();
    const stored = normalizeBlueprint(baseBlueprint, nextFolder);
    const nextTheme = patch.theme ?? stored.meta.theme ?? row.theme;
    const nextStyleGuide = patch.styleGuide ?? stored.meta.styleGuide ?? row.styleGuide;
    const nextDescription = patch.description ?? stored.meta.description ?? row.description;
    const nextStatus = (patch.status ?? stored.meta.status ?? row.status) as ProjectStatus;

    const blueprint: GameBlueprint = {
      ...stored,
      meta: {
        ...stored.meta,
        title: nextTitle,
        slug: slugify(nextTitle),
        folderPath: nextFolder,
        theme: nextTheme,
        styleGuide: nextStyleGuide,
        description: nextDescription,
        status: nextStatus,
        updatedAt: updatedAt.toISOString(),
      },
    };

    const updated = await tx
      .update(projects)
      .set({
        title: nextTitle,
        theme: nextTheme,
        styleGuide: nextStyleGuide,
        description: nextDescription,
        status: nextStatus,
        folderPath: nextFolder,
        columns: blueprint.reels.columns,
        rows: blueprint.reels.rows,
        paylineCount: blueprint.paylines.length,
        rtpTarget: blueprint.math.rtpTarget,
        volatility: blueprint.math.volatility,
        revision: patch.blueprint ? row.revision + 1 : row.revision,
        blueprint,
        updatedAt,
      })
      .where(eq(projects.id, id))
      .returning();

    safeRevalidatePath("/games");
    safeRevalidatePath("/dashboard");
    return toProjectDetail(updated[0]);
  });
}

export async function duplicateProject(id: string): Promise<ProjectDetail> {
  const rows = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  const row = rows[0];
  if (!row || row.deletedAt) throw new WorkspaceError("Project not found", 404);

  const siblings = await db
    .select({ title: projects.title })
    .from(projects)
    .where(and(isNull(projects.deletedAt), like(projects.title, `${row.title}%`)));
  const title = uniqueCopyTitle(
    row.title,
    siblings.map((s) => s.title),
  );

  const newProjectId = newId("prj");
  const now = new Date();
  const blueprint: GameBlueprint = {
    ...row.blueprint,
    meta: {
      ...row.blueprint.meta,
      id: newProjectId,
      title,
      slug: slugify(title),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  };

  const inserted = await db
    .insert(projects)
    .values({
      id: newProjectId,
      title,
      theme: row.theme,
      styleGuide: row.styleGuide,
      description: row.description,
      status: row.status,
      folderPath: row.folderPath,
      thumbnailUri: row.thumbnailUri,
      columns: row.columns,
      rows: row.rows,
      paylineCount: row.paylineCount,
      rtpTarget: row.rtpTarget,
      volatility: row.volatility,
      isDemo: false,
      blueprint,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return toProjectDetail(inserted[0]);
}

/** Soft delete so the dashboard can offer a real undo. */
export async function deleteProject(id: string): Promise<{ id: string }> {
  const updated = await db
    .update(projects)
    .set({ deletedAt: new Date() })
    .where(eq(projects.id, id))
    .returning({ id: projects.id });
  if (updated.length === 0) throw new WorkspaceError("Project not found", 404);
  return { id: updated[0].id };
}

export async function restoreProject(id: string): Promise<ProjectDetail> {
  const updated = await db
    .update(projects)
    .set({ deletedAt: null })
    .where(eq(projects.id, id))
    .returning();
  if (updated.length === 0) throw new WorkspaceError("Project not found", 404);
  return toProjectDetail(updated[0]);
}

/* ------------------------------------------------------------------ */
/* folder mutations                                                    */
/* ------------------------------------------------------------------ */

export async function ensureFolderPath(path: string, transaction?: Tx): Promise<void> {
  const client = transaction ?? db;
  const normalized = normalizePath(path);
  if (!normalized) return;
  const segments = normalized.split("/");
  for (let i = 0; i < segments.length; i += 1) {
    const currentPath = segments.slice(0, i + 1).join("/");
    const existing = await client
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.path, currentPath))
      .limit(1);
    if (existing.length === 0) {
      await client.insert(folders).values({
        id: newId("fld"),
        name: segments[i],
        parentPath: segments.slice(0, i).join("/"),
        path: currentPath,
      });
    }
  }
}

export async function createFolder(
  name: string,
  parentPath: string,
): Promise<FolderSummary> {
  const rawSegments = name
    .split(/[/\\]+/)
    .map((seg) => sanitizeFolderName(seg))
    .filter(Boolean);
  if (rawSegments.length === 0) {
    throw new WorkspaceError("Folder name is required");
  }

  const baseParent = normalizePath(parentPath);
  const ancestorSegments = [
    ...(baseParent ? baseParent.split("/") : []),
    ...rawSegments.slice(0, -1),
  ];
  const safeName = rawSegments[rawSegments.length - 1];
  const parent = ancestorSegments.join("/");
  const path = parent ? `${parent}/${safeName}` : safeName;

  if (parent) {
    await ensureFolderPath(parent);
  }

  const existing = await db
    .select({ id: folders.id })
    .from(folders)
    .where(eq(folders.path, path))
    .limit(1);
  if (existing.length > 0) throw new WorkspaceError("A folder with that name already exists", 409);

  const inserted = await db
    .insert(folders)
    .values({ id: newId("fld"), name: safeName, parentPath: parent, path })
    .returning();

  return {
    id: inserted[0].id,
    name: inserted[0].name,
    path: inserted[0].path,
    parentPath: inserted[0].parentPath,
    projectCount: 0,
    childFolderCount: 0,
    createdAt: inserted[0].createdAt.toISOString(),
  };
}

export async function renameFolder(id: string, name: string): Promise<FolderSummary> {
  const safeName = sanitizeFolderName(name);
  const rows = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new WorkspaceError("Folder not found", 404);

  const newPath = row.parentPath ? `${row.parentPath}/${safeName}` : safeName;
  if (newPath !== row.path) {
    const clash = await db
      .select({ id: folders.id })
      .from(folders)
      .where(eq(folders.path, newPath))
      .limit(1);
    if (clash.length > 0) throw new WorkspaceError("A folder with that name already exists", 409);
  }

  const oldPrefix = `${row.path}/`;
  const rewrite = (value: string) =>
    value === row.path ? newPath : `${newPath}${value.slice(row.path.length)}`;

  const descendantFolders = await db
    .select()
    .from(folders)
    .where(like(folders.path, `${oldPrefix}%`));
  const affectedProjects = await db
    .select()
    .from(projects)
    .where(
      or(eq(projects.folderPath, row.path), like(projects.folderPath, `${oldPrefix}%`)),
    );

  await db.transaction(async (tx) => {
    await tx
      .update(folders)
      .set({ name: safeName, path: newPath, updatedAt: new Date() })
      .where(eq(folders.id, id));

    // descendants: rewrite materialized paths
    for (const descendant of descendantFolders) {
      await tx
        .update(folders)
        .set({
          path: rewrite(descendant.path),
          parentPath: rewrite(descendant.parentPath),
          updatedAt: new Date(),
        })
        .where(eq(folders.id, descendant.id));
    }

    for (const affected of affectedProjects) {
      await tx
        .update(projects)
        .set({ folderPath: rewrite(affected.folderPath), blueprint: normalizeBlueprint(affected.blueprint, rewrite(affected.folderPath)) })
        .where(eq(projects.id, affected.id));
    }
  });

  const refreshed = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  const projectRows = await db.select().from(projects).where(isNull(projects.deletedAt));
  const folderRows = await db.select().from(folders);
  return toFolderSummary(refreshed[0], projectRows, folderRows);
}

export async function deleteFolder(id: string): Promise<{ id: string }> {
  const rows = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new WorkspaceError("Folder not found", 404);

  const childFolders = await db
    .select({ id: folders.id })
    .from(folders)
    .where(like(folders.path, `${row.path}/%`))
    .limit(1);
  if (childFolders.length > 0)
    throw new WorkspaceError("Folder still contains sub-folders", 409);

  const childProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.folderPath, row.path), isNull(projects.deletedAt)))
    .limit(1);
  if (childProjects.length > 0)
    throw new WorkspaceError("Folder still contains projects", 409);

  await db.delete(folders).where(eq(folders.id, id));
  return { id };
}

/* ------------------------------------------------------------------ */
/* utils                                                               */
/* ------------------------------------------------------------------ */

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function uniqueCopyTitle(base: string, taken: string[]): string {
  const root = base.replace(/\s+copy(\s+\d+)?$/i, "");
  let candidate = `${root} copy`;
  let n = 2;
  while (taken.includes(candidate)) {
    candidate = `${root} copy ${n}`;
    n += 1;
  }
  return candidate;
}
