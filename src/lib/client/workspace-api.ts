import type { GameBlueprint } from "@/lib/blueprint/types";
import type {
  CreateProjectInput,
  FolderSummary,
  ProjectDetail,
  ProjectSummary,
  UpdateProjectInput,
  WorkspaceSnapshot,
} from "@/lib/workspace/types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as
    | T
    | { error?: string };
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as { error?: string }).error ?? "Request failed")
        : "Request failed";
    throw new Error(message);
  }
  return payload as T;
}

export const workspaceApi = {
  snapshot: () => request<WorkspaceSnapshot>("/api/workspace"),

  listProjects: () => request<ProjectSummary[]>("/api/projects"),

  loadProject: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),

  createProject: async (input: CreateProjectInput) => {
    const project = await request<ProjectDetail>("/api/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("studio:workspace-changed"));
    }
    return project;
  },

  saveProject: async (id: string, blueprint: GameBlueprint) => {
    const project = await request<ProjectDetail>(`/api/projects/${id}`, {
      method: "PUT",
      body: JSON.stringify({ blueprint }),
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("studio:workspace-changed"));
    }
    return project;
  },

  updateProject: (id: string, patch: UpdateProjectInput) =>
    request<ProjectDetail>(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  duplicateProject: (id: string) =>
    request<ProjectDetail>(`/api/projects/${id}/duplicate`, { method: "POST" }),

  deleteProject: (id: string) =>
    request<{ id: string }>(`/api/projects/${id}`, { method: "DELETE" }),

  restoreProject: (id: string) =>
    request<ProjectDetail>(`/api/projects/${id}/restore`, { method: "POST" }),

  createFolder: (name: string, parentPath: string) =>
    request<FolderSummary>("/api/folders", {
      method: "POST",
      body: JSON.stringify({ name, parentPath }),
    }),

  renameFolder: (id: string, name: string) =>
    request<FolderSummary>(`/api/folders/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),

  deleteFolder: (id: string) =>
    request<{ id: string }>(`/api/folders/${id}`, { method: "DELETE" }),
};

export function toSummary(detail: ProjectDetail): ProjectSummary {
  const { ...rest } = detail;
  delete (rest as Partial<ProjectDetail>).blueprint;
  return rest as ProjectSummary;
}

export async function saveWorkspaceBlueprint(
  id: string,
  blueprint: GameBlueprint,
  expectedRevision?: number,
): Promise<
  | { ok: true; data: ProjectDetail }
  | {
      ok: false;
      message: string;
      conflict?: { currentRevision: number };
    }
> {
  try {
    const updated = await workspaceApi.updateProject(id, {
      blueprint,
      ...(expectedRevision !== undefined ? {} : {}),
    });
    return { ok: true, data: updated };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Failed to save blueprint",
    };
  }
}


