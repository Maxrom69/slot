import type { ElementType } from "@/lib/blueprint/types";
import type { ImportedImage } from "./draft";

import { ACCEPTED_IMAGE_TYPES, MAX_SOURCE_BYTES, MAX_STORED_BYTES, inlineImageInfo } from "./artwork-policy";
export { ACCEPTED_IMAGE_TYPES, MAX_SOURCE_BYTES } from "./artwork-policy";
const SIZE_STEPS = [1600, 1280, 1024, 768];

export class ImageImportError extends Error {}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new ImageImportError("File could not be decoded as an image"));
    img.src = url;
  });
}

function dataUrlBytes(dataUrl: string): number {
  return inlineImageInfo(dataUrl)?.bytes ?? 0;
}

/**
 * Reads a user file, validates it and downsizes it so it can live inside a
 * project without bloating the blueprint. PNG transparency is preserved.
 */
export async function importImageFile(file: File): Promise<ImportedImage> {
  if (!ACCEPTED_IMAGE_TYPES.some((type) => type === file.type)) {
    throw new ImageImportError(`${file.name}: only PNG, JPEG and WebP images are supported`);
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new ImageImportError(`${file.name}: file is larger than 15 MB`);
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const keepAlpha = file.type !== "image/jpeg";
    const outType = keepAlpha ? "image/png" : "image/jpeg";

    let result: { dataUrl: string; width: number; height: number } | null = null;
    for (const maxSide of SIZE_STEPS) {
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new ImageImportError("Canvas is not available in this browser");
      context.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL(outType, 0.9);
      result = { dataUrl, width, height };
      if (dataUrlBytes(dataUrl) <= MAX_STORED_BYTES) break;
    }
    if (!result || dataUrlBytes(result.dataUrl) > MAX_STORED_BYTES) {
      throw new ImageImportError(`${file.name}: image is too complex to store (over 3 MB after resizing)`);
    }

    return {
      id: `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      dataUrl: result.dataUrl,
      mime: outType,
      width: result.width,
      height: result.height,
      bytes: dataUrlBytes(result.dataUrl),
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Light filename heuristics only; the user can always change the type. */
export function guessElementType(filename: string): ElementType {
  const name = filename.toLowerCase();
  if (/(logo|title)/.test(name)) return "game_title";
  if (/(background|\bbg\b|backdrop)/.test(name)) return "game_background";
  if (/(frame|border)/.test(name)) return "reel_frame";
  if (/(button|btn|spin)/.test(name)) return "button_set";
  if (/(symbol|icon)/.test(name)) return "symbol";
  return "uploaded";
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
