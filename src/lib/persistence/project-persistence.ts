import { createBlueprint, slugify } from "@/lib/blueprint/factory";
import type { GameBlueprint, ProjectStatus } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { workspaceApi, toSummary } from "@/lib/client/workspace-api";
import { draftToBlueprint } from "@/lib/creation/blueprint-from-draft";
import { createDefaultDraft, normalizeDraft } from "@/lib/creation/draft";
import { migrateBlueprint } from "@/lib/design/migrate";
import type {
  CreateProjectInput,
  ProjectDetail,
  ProjectSummary,
  UpdateProjectInput,
} from "@/lib/workspace/types";

export interface ProjectPersistenceService {
  createProject(input: CreateProjectInput): Promise<ProjectDetail>;
  loadProject(id: string): Promise<ProjectDetail | null>;
  saveProject(id: string, blueprint: GameBlueprint): Promise<ProjectDetail>;
  updateProject(id: string, patch: UpdateProjectInput): Promise<ProjectDetail>;
  deleteProject(id: string): Promise<{ id: string }>;
  duplicateProject(id: string): Promise<ProjectDetail>;
  listProjects(): Promise<ProjectSummary[]>;
}

const LOCAL_STORAGE_KEY = "slots-studio:projects:v1";

function generateProjectId(): string {
  return `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function detailFromBlueprint(
  id: string,
  blueprint: GameBlueprint,
  options?: { revision?: number; isDemo?: boolean; folderPath?: string },
): ProjectDetail {
  const migrated = migrateBlueprint(blueprint);
  const folderPath = options?.folderPath ?? migrated.meta.folderPath ?? "";
  const background = migrated.assets.find(
    (a) => a.id === migrated.canvas.backgroundAssetId && a.state === "linked",
  );
  return {
    id,
    title: migrated.meta.title,
    theme: migrated.meta.theme,
    styleGuide: migrated.meta.styleGuide,
    description: migrated.meta.description,
    status: migrated.meta.status,
    folderPath,
    thumbnailUri: background?.uri ?? null,
    columns: migrated.reels.columns,
    rows: migrated.reels.rows,
    paylineCount: migrated.paylines.length,
    rtpTarget: migrated.math.rtpTarget,
    volatility: migrated.math.volatility,
    isDemo: options?.isDemo ?? false,
    symbolCount: migrated.symbols.length,
    assetCount: migrated.assets.length,
    createdAt: migrated.meta.createdAt,
    updatedAt: migrated.meta.updatedAt,
    revision: options?.revision ?? 0,
    blueprint: {
      ...migrated,
      meta: { ...migrated.meta, id, folderPath },
    },
  };
}

/**
 * Deterministic local persistence adapter backed by browser `localStorage`
 * (with an in-memory map fallback when `window` is not present).
 */
export class LocalProjectPersistenceService implements ProjectPersistenceService {
  private memory = new Map<string, ProjectDetail>();
  private storageKey: string;

  constructor(storageKey = LOCAL_STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  private readAll(): Map<string, ProjectDetail> {
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        const raw = window.localStorage.getItem(this.storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as ProjectDetail[];
          if (Array.isArray(parsed)) {
            this.memory = new Map(parsed.map((item) => [item.id, item]));
          }
        }
      } catch {
        // Fallback to in-memory map
      }
    }
    return this.memory;
  }

  private writeAll(map: Map<string, ProjectDetail>): void {
    this.memory = map;
    if (typeof window !== "undefined" && window.localStorage) {
      try {
        window.localStorage.setItem(
          this.storageKey,
          JSON.stringify(Array.from(map.values())),
        );
      } catch {
        // Ignore quota errors in fallback cache
      }
    }
  }

  upsertCache(detail: ProjectDetail): void {
    const store = this.readAll();
    store.set(detail.id, detail);
    this.writeAll(store);
  }

  removeFromCache(id: string): void {
    const store = this.readAll();
    store.delete(id);
    this.writeAll(store);
  }

  async createProject(input: CreateProjectInput): Promise<ProjectDetail> {
    const id = generateProjectId();
    const title = (input.title || input.draft?.title || "").trim();
    if (!title) throw new Error("Project title is required");

    let blueprint: GameBlueprint;
    if (input.draft) {
      blueprint = draftToBlueprint(normalizeDraft(input.draft), { id });
    } else {
      const base = createDefaultDraft();
      const draft = normalizeDraft({
        ...base,
        title,
        theme: input.theme || "Studio Theme",
        styleGuide: input.styleGuide ?? "",
        description: input.description ?? "",
        folderPath: input.folderPath ?? "",
        grid: {
          preset: "custom",
          columns: input.columns ?? 5,
          rows: input.rows ?? 3,
        },
        evaluation: input.evaluation ?? "lines",
        paylineCount: input.paylineCount ?? 20,
        rtpTarget: input.rtpTarget ?? 96,
        volatility: input.volatility ?? "medium",
        status: input.status ?? "draft",
      });
      blueprint = draftToBlueprint(draft, { id });
    }

    const detail = detailFromBlueprint(id, blueprint, {
      revision: 0,
      folderPath: input.folderPath ?? blueprint.meta.folderPath ?? "",
    });
    const store = this.readAll();
    store.set(id, detail);
    this.writeAll(store);
    return detail;
  }

  async loadProject(id: string): Promise<ProjectDetail | null> {
    const store = this.readAll();
    return store.get(id) ?? null;
  }

  async saveProject(id: string, blueprint: GameBlueprint): Promise<ProjectDetail> {
    const store = this.readAll();
    const existing = store.get(id);
    const check = validateBlueprint(blueprint);
    if (!check.integrityOk) {
      throw new Error(`Blueprint integrity error: ${check.integrityIssues[0]}`);
    }
    const now = new Date().toISOString();
    const updatedBp: GameBlueprint = {
      ...blueprint,
      meta: {
        ...blueprint.meta,
        id,
        updatedAt: now,
      },
    };
    const next = detailFromBlueprint(id, updatedBp, {
      revision: (existing?.revision ?? 0) + 1,
      folderPath: updatedBp.meta.folderPath ?? existing?.folderPath ?? "",
    });
    store.set(id, next);
    this.writeAll(store);
    return next;
  }

  async updateProject(id: string, patch: UpdateProjectInput): Promise<ProjectDetail> {
    const store = this.readAll();
    const existing = store.get(id);
    if (!existing) throw new Error("Project not found");

    const nextTitle = (patch.title ?? existing.title).trim();
    if (!nextTitle) throw new Error("Project title cannot be empty");

    const now = new Date().toISOString();
    const baseBp = patch.blueprint ?? existing.blueprint;
    const folderPath = patch.folderPath ?? existing.folderPath;
    const status = (patch.status ?? existing.status) as ProjectStatus;
    const theme = patch.theme ?? existing.theme;
    const styleGuide = patch.styleGuide ?? existing.styleGuide;
    const description = patch.description ?? existing.description;

    const updatedBp: GameBlueprint = {
      ...baseBp,
      meta: {
        ...baseBp.meta,
        id,
        title: nextTitle,
        slug: slugify(nextTitle),
        theme,
        styleGuide,
        description,
        status,
        folderPath,
        updatedAt: now,
      },
    };

    const next = detailFromBlueprint(id, updatedBp, {
      revision: existing.revision + 1,
      folderPath,
    });
    store.set(id, next);
    this.writeAll(store);
    return next;
  }

  async deleteProject(id: string): Promise<{ id: string }> {
    const store = this.readAll();
    if (!store.has(id)) throw new Error("Project not found");
    store.delete(id);
    this.writeAll(store);
    return { id };
  }

  async duplicateProject(id: string): Promise<ProjectDetail> {
    const store = this.readAll();
    const existing = store.get(id);
    if (!existing) throw new Error("Project not found");

    const newId = generateProjectId();
    const taken = Array.from(store.values()).map((p) => p.title);
    const root = existing.title.replace(/\s+copy(\s+\d+)?$/i, "");
    let copyTitle = `${root} copy`;
    let n = 2;
    while (taken.includes(copyTitle)) {
      copyTitle = `${root} copy ${n}`;
      n += 1;
    }

    const now = new Date().toISOString();
    const duplicatedBp: GameBlueprint = {
      ...JSON.parse(JSON.stringify(existing.blueprint)),
      meta: {
        ...existing.blueprint.meta,
        id: newId,
        title: copyTitle,
        slug: slugify(copyTitle),
        createdAt: now,
        updatedAt: now,
      },
    };

    const copy = detailFromBlueprint(newId, duplicatedBp, {
      revision: 0,
      folderPath: existing.folderPath,
    });
    store.set(newId, copy);
    this.writeAll(store);
    return copy;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const store = this.readAll();
    return Array.from(store.values())
      .map(toSummary)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

/**
 * Hybrid Persistence Service:
 * Uses the Studio HTTP API (`/api/projects`) when running in the browser and
 * mirrors every read/write to `LocalProjectPersistenceService` (`localStorage`),
 * falling back to `LocalProjectPersistenceService` when offline or in tests.
 */
export class StudioProjectPersistenceService implements ProjectPersistenceService {
  readonly local = new LocalProjectPersistenceService();

  private hasBrowserFetch(): boolean {
    return typeof window !== "undefined" && typeof window.fetch === "function";
  }

  async createProject(input: CreateProjectInput): Promise<ProjectDetail> {
    if (this.hasBrowserFetch()) {
      const created = await workspaceApi.createProject(input);
      this.local.upsertCache(created);
      return created;
    }
    return this.local.createProject(input);
  }

  async loadProject(id: string): Promise<ProjectDetail | null> {
    if (this.hasBrowserFetch()) {
      try {
        const project = await workspaceApi.loadProject(id);
        this.local.upsertCache(project);
        return project;
      } catch {
        return this.local.loadProject(id);
      }
    }
    return this.local.loadProject(id);
  }

  async saveProject(id: string, blueprint: GameBlueprint): Promise<ProjectDetail> {
    if (this.hasBrowserFetch()) {
      const saved = await workspaceApi.saveProject(id, blueprint);
      this.local.upsertCache(saved);
      return saved;
    }
    return this.local.saveProject(id, blueprint);
  }

  async updateProject(id: string, patch: UpdateProjectInput): Promise<ProjectDetail> {
    if (this.hasBrowserFetch()) {
      const updated = await workspaceApi.updateProject(id, patch);
      this.local.upsertCache(updated);
      return updated;
    }
    return this.local.updateProject(id, patch);
  }

  async deleteProject(id: string): Promise<{ id: string }> {
    if (this.hasBrowserFetch()) {
      const res = await workspaceApi.deleteProject(id);
      this.local.removeFromCache(id);
      return res;
    }
    return this.local.deleteProject(id);
  }

  async duplicateProject(id: string): Promise<ProjectDetail> {
    if (this.hasBrowserFetch()) {
      const dup = await workspaceApi.duplicateProject(id);
      this.local.upsertCache(dup);
      return dup;
    }
    return this.local.duplicateProject(id);
  }

  async listProjects(): Promise<ProjectSummary[]> {
    if (this.hasBrowserFetch()) {
      try {
        const list = await workspaceApi.listProjects();
        return list;
      } catch {
        return this.local.listProjects();
      }
    }
    return this.local.listProjects();
  }
}

export const projectPersistence = new StudioProjectPersistenceService();

export const createProject = (input: CreateProjectInput) =>
  projectPersistence.createProject(input);
export const loadProject = (id: string) => projectPersistence.loadProject(id);
export const saveProject = (id: string, blueprint: GameBlueprint) =>
  projectPersistence.saveProject(id, blueprint);
export const updateProject = (id: string, patch: UpdateProjectInput) =>
  projectPersistence.updateProject(id, patch);
export const deleteProject = (id: string) => projectPersistence.deleteProject(id);
export const duplicateProject = (id: string) => projectPersistence.duplicateProject(id);
export const listProjects = () => projectPersistence.listProjects();
export { createBlueprint };
