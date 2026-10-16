/**
 * AssetReference abstraction. The application is never bound to one storage
 * provider: a reference describes *where* an image lives, and a provider
 * resolves it to a renderable URI. The default project provider reads the
 * project's own asset store; tests or future providers can supply their own.
 */

import type { AssetReference } from "@/lib/blueprint/types";

export interface AssetRecord {
  id: string;
  uri: string | null;
  state: "placeholder" | "linked";
}

export interface AssetProvider {
  resolve(ref: AssetReference | null | undefined): string | null;
}

export function projectAssetReference(assetId: string | null, name?: string): AssetReference | null {
  if (!assetId) return null;
  return { provider: "project", assetId, name };
}

export function externalAssetReference(uri: string, name?: string): AssetReference {
  return { provider: "external", uri, name };
}

export function placeholderReference(name?: string): AssetReference {
  return { provider: "placeholder", name };
}

export function normalizeAssetReference(
  raw: unknown,
  fallbackAssetId: string | null = null,
): AssetReference | null {
  if (!raw || typeof raw !== "object") {
    return fallbackAssetId ? projectAssetReference(fallbackAssetId) : null;
  }
  const r = raw as Record<string, unknown>;
  const provider = r.provider;
  if (provider === "project") {
    const assetId = typeof r.assetId === "string" ? r.assetId : fallbackAssetId;
    if (!assetId) return null;
    return {
      provider: "project",
      assetId,
      name: typeof r.name === "string" ? r.name.slice(0, 120) : undefined,
    };
  }
  if (provider === "external") {
    if (typeof r.uri !== "string" || !r.uri) return null;
    return {
      provider: "external",
      uri: r.uri.slice(0, 500),
      name: typeof r.name === "string" ? r.name.slice(0, 120) : undefined,
    };
  }
  if (provider === "placeholder") {
    return { provider: "placeholder", name: typeof r.name === "string" ? r.name.slice(0, 120) : undefined };
  }
  return fallbackAssetId ? projectAssetReference(fallbackAssetId) : null;
}

/** Serializes an AssetReference for blueprint storage (plain JSON). */
export function serializeAssetReference(ref: AssetReference | null | undefined): AssetReference | null {
  if (!ref) return null;
  if (ref.provider === "project") {
    if (!ref.assetId) return null;
    return { provider: "project", assetId: ref.assetId, ...(ref.name ? { name: ref.name } : {}) };
  }
  if (ref.provider === "external") {
    if (!ref.uri) return null;
    return { provider: "external", uri: ref.uri, ...(ref.name ? { name: ref.name } : {}) };
  }
  return { provider: "placeholder", ...(ref.name ? { name: ref.name } : {}) };
}

/**
 * Creates a provider backed by a project's asset map. Unknown or unlinked
 * assets resolve to null so callers render a deterministic placeholder.
 */
export function createProjectAssetProvider(assets: Map<string, AssetRecord> | AssetRecord[]): AssetProvider {
  const byId = Array.isArray(assets) ? new Map(assets.map((a) => [a.id, a])) : assets;
  return {
    resolve(ref) {
      if (!ref) return null;
      if (ref.provider === "external") return ref.uri ?? null;
      if (ref.provider === "placeholder") return null;
      if (!ref.assetId) return null;
      const record = byId.get(ref.assetId);
      if (!record || record.state !== "linked" || !record.uri) return null;
      return record.uri;
    },
  };
}

/** Extracts the project asset id when the reference points at one. */
export function projectAssetIdOf(ref: AssetReference | null | undefined): string | null {
  return ref?.provider === "project" ? (ref.assetId ?? null) : null;
}
