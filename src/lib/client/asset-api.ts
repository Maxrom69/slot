import type { AssignTarget } from "@/lib/assets/usage";
import type { ProjectAssetSummary, ProjectAssetsResponse } from "@/server/asset-service";
import { ApiError } from "./design-api";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new ApiError(typeof payload.error === "string" ? payload.error : "Request failed", response.status, payload);
  }
  return payload as T;
}

export const assetApi = {
  fetchAssets: (projectId: string) =>
    call<ProjectAssetsResponse>(`/api/projects/${projectId}/assets`),

  uploadAsset: (projectId: string, input: { name: string; dataUrl: string; tags?: string[] }) =>
    call<{ asset: ProjectAssetSummary }>(`/api/projects/${projectId}/assets`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateAsset: (projectId: string, assetId: string, patch: { name?: string; tags?: string[] }) =>
    call<{ asset: ProjectAssetSummary }>(`/api/projects/${projectId}/assets/${assetId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteAsset: (projectId: string, assetId: string) =>
    call<{ unlinkedCount: number; deletedId: string }>(`/api/projects/${projectId}/assets/${assetId}`, {
      method: "DELETE",
    }),

  assignAsset: (projectId: string, assetId: string, target: AssignTarget) =>
    call<{ updatedBlueprint: unknown }>(`/api/projects/${projectId}/assets/${assetId}/assign`, {
      method: "POST",
      body: JSON.stringify(target),
    }),
};
