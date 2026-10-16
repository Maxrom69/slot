/** Shared import policy; enforced by both the browser and the persistence service. */
export const ACCEPTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
export const MAX_STORED_BYTES = 3 * 1024 * 1024;
export const MAX_PROJECT_ART_BYTES = 24 * 1024 * 1024;
export const IMAGE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export function inlineImageInfo(uri: string) {
  const match = IMAGE_DATA_URL.exec(uri);
  if (!match || match[2].length % 4 !== 0) return null;
  const padding = match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0;
  return {
    mime: match[1],
    base64: match[2],
    bytes: (match[2].length * 3) / 4 - padding,
  };
}
