import type { AssetFormat } from "@/lib/blueprint/types";
import { decodeArtwork } from "./decode";

export const MAX_UPLOAD_SOURCE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_IMAGE_DIMENSION = 20000;

export interface ValidatedUpload {
  name: string;
  dataUrl: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  format: AssetFormat;
}

export class AssetValidationError extends Error {}

async function readAsDataUrl(file: File, fallbackMime?: string): Promise<string> {
  if (typeof FileReader !== "undefined") {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new AssetValidationError(`Could not read “${file.name}”.`));
      reader.readAsDataURL(file);
    });
  }
  const ab = await file.arrayBuffer();
  const base64 = Buffer.from(ab).toString("base64");
  const mime = fallbackMime || file.type || "application/octet-stream";
  return `data:${mime};base64,${base64}`;
}

function measureImage(dataUrl: string, fileName = "image"): Promise<{ width: number; height: number; format?: AssetFormat }> {
  if (typeof Image !== "undefined") {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new AssetValidationError("The file could not be decoded as a valid image."));
      img.src = dataUrl;
    });
  }
  return new Promise((resolve, reject) => {
    try {
      const decoded = decodeArtwork(dataUrl, fileName);
      if (!decoded.width || !decoded.height) {
        reject(new AssetValidationError(`“${fileName}” has invalid image dimensions.`));
        return;
      }
      resolve({ width: decoded.width, height: decoded.height, format: decoded.format });
    } catch (err) {
      reject(new AssetValidationError(err instanceof Error ? err.message : "The file could not be decoded as a valid image."));
    }
  });
}

/**
 * Validates file type, file size, and image dimensions.
 * Supports Transparent PNG, PNG, JPEG, WebP, Vector SVG, Animation JSON, Audio, and Fonts (Other).
 */
export async function validateAndPrepareUpload(file: File): Promise<ValidatedUpload> {
  if (file.size <= 0) {
    throw new AssetValidationError(`“${file.name}” is empty (0 bytes).`);
  }
  if (file.size > MAX_UPLOAD_SOURCE_BYTES) {
    throw new AssetValidationError(`“${file.name}” is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum allowed size is 15 MB.`);
  }

  const name = file.name.trim();
  const lowerName = name.toLowerCase();
  const rawMime = file.type.toLowerCase();

  // 1. Vector (SVG)
  if (rawMime === "image/svg+xml" || lowerName.endsWith(".svg")) {
    const text = await file.text();
    if (!text.includes("<svg") || text.includes("<script") || text.includes("javascript:")) {
      throw new AssetValidationError(`“${name}” does not contain safe and valid SVG vector artwork.`);
    }
    const dataUrl = await readAsDataUrl(file, "image/svg+xml");
    let dims = { width: 512, height: 512 };
    try {
      const measured = await measureImage(dataUrl, name);
      dims = { width: measured.width || 512, height: measured.height || 512 };
    } catch {
      // fallback for SVG without explicit pixel sizing
    }
    if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION) {
      throw new AssetValidationError(`“${name}” dimensions (${dims.width} × ${dims.height}) exceed maximum allowed (${MAX_IMAGE_DIMENSION} × ${MAX_IMAGE_DIMENSION}).`);
    }
    return {
      name,
      dataUrl,
      mime: "image/svg+xml",
      sizeBytes: file.size,
      width: dims.width || 512,
      height: dims.height || 512,
      format: "svg",
    };
  }

  // 2. Animation JSON / Spine / Lottie
  if (rawMime === "application/json" || lowerName.endsWith(".json")) {
    const text = await file.text();
    try {
      const obj = JSON.parse(text);
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error();
      const base64 =
        typeof Buffer !== "undefined"
          ? Buffer.from(text, "utf8").toString("base64")
          : btoa(unescape(encodeURIComponent(text)));
      const dataUrl = `data:application/json;base64,${base64}`;
      const width = typeof obj.w === "number" ? Math.round(obj.w) : null;
      const height = typeof obj.h === "number" ? Math.round(obj.h) : null;
      if ((width && width > MAX_IMAGE_DIMENSION) || (height && height > MAX_IMAGE_DIMENSION)) {
        throw new AssetValidationError(`“${name}” dimensions (${width} × ${height}) exceed maximum allowed (${MAX_IMAGE_DIMENSION} × ${MAX_IMAGE_DIMENSION}).`);
      }
      return {
        name,
        dataUrl,
        mime: "application/json",
        sizeBytes: file.size,
        width,
        height,
        format: "json-animation",
      };
    } catch (err) {
      if (err instanceof AssetValidationError) throw err;
      throw new AssetValidationError(`“${name}” is not valid animation JSON metadata.`);
    }
  }

  // 3. Audio
  if (rawMime.startsWith("audio/") || lowerName.match(/\.(mp3|wav|ogg|aac)$/)) {
    const mime = rawMime || (lowerName.endsWith(".wav") ? "audio/wav" : lowerName.endsWith(".ogg") ? "audio/ogg" : "audio/mpeg");
    const dataUrl = await readAsDataUrl(file, mime);
    return {
      name,
      dataUrl,
      mime,
      sizeBytes: file.size,
      width: null,
      height: null,
      format: "audio",
    };
  }

  // 4. Other (Fonts: WOFF, WOFF2, TTF, OTF)
  if (
    rawMime.startsWith("font/") ||
    lowerName.match(/\.(woff|woff2|ttf|otf)$/)
  ) {
    const mime =
      rawMime ||
      (lowerName.endsWith(".woff2")
        ? "font/woff2"
        : lowerName.endsWith(".woff")
        ? "font/woff"
        : lowerName.endsWith(".otf")
        ? "font/otf"
        : "font/ttf");
    const dataUrl = await readAsDataUrl(file, mime);
    return {
      name,
      dataUrl,
      mime,
      sizeBytes: file.size,
      width: null,
      height: null,
      format: "other",
    };
  }

  // 5. Raster Images: PNG, JPEG, WebP
  const isPng = rawMime === "image/png" || lowerName.endsWith(".png");
  const isJpeg = rawMime === "image/jpeg" || rawMime === "image/jpg" || lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg");
  const isWebp = rawMime === "image/webp" || lowerName.endsWith(".webp");

  if (!isPng && !isJpeg && !isWebp) {
    throw new AssetValidationError(`“${name}” is not an accepted asset type. Supported: PNG, JPEG, WebP, SVG Vector, Animation JSON, Audio, and Font.`);
  }

  const mime = isPng ? "image/png" : isJpeg ? "image/jpeg" : "image/webp";
  const dataUrl = await readAsDataUrl(file, mime);

  const dims = await measureImage(dataUrl, name);
  if (!dims.width || !dims.height || dims.width <= 0 || dims.height <= 0) {
    throw new AssetValidationError(`“${name}” has invalid image dimensions (${dims.width} × ${dims.height}).`);
  }
  if (dims.width > MAX_IMAGE_DIMENSION || dims.height > MAX_IMAGE_DIMENSION) {
    throw new AssetValidationError(`“${name}” dimensions (${dims.width} × ${dims.height}) exceed maximum allowed (${MAX_IMAGE_DIMENSION} × ${MAX_IMAGE_DIMENSION}).`);
  }

  const format: AssetFormat = dims.format ?? (isPng ? "png-transparent" : isJpeg ? "jpeg" : "webp");

  return {
    name,
    dataUrl,
    mime,
    sizeBytes: file.size,
    width: dims.width,
    height: dims.height,
    format,
  };
}
