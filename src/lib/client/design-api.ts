import type { AssetRef } from "@/lib/blueprint/types";
import type { ImportedImage } from "@/lib/creation/draft";
import type { DesignDoc } from "@/lib/design/types";

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json" }, cache: "no-store" });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(typeof payload.error === "string" ? payload.error : "Request failed", response.status, payload);
  }
  return payload as T;
}

export const canvasApi = {
  save: (
    projectId: string,
    body: {
      baseRevision: number;
      sceneId: string;
      objects: unknown;
      background: unknown;
      layers?: unknown;
      name?: string;
      canvasConfiguration?: unknown;
      visibility?: unknown;
      composedImages?: unknown;
      layoutMetadata?: unknown;
      scenes?: unknown;
      force?: boolean;
    },
  ) =>
    call<{ revision: number; updatedAt: string }>(`/api/projects/${projectId}/canvas`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
};

export const designApi = {
  save: (projectId: string, body: { baseRevision: number; doc: DesignDoc; force?: boolean }) =>
    call<{ revision: number; updatedAt: string }>(`/api/projects/${projectId}/design`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),

  async upload(projectId: string, image: ImportedImage): Promise<AssetRef> {
    const result = await call<{ asset: AssetRef }>(`/api/projects/${projectId}/assets`, {
      method: "POST",
      body: JSON.stringify({ name: image.name, dataUrl: image.dataUrl }),
    });
    return result.asset;
  },
};
