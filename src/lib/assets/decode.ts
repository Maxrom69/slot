import type { AssetFormat, AssetKind } from "@/lib/blueprint/types";

export const MAX_STORED_BYTES = 5 * 1024 * 1024; // 5 MB per asset
const DATA_URL_PATTERN = /^data:([a-zA-Z0-9.+_-]+\/[a-zA-Z0-9.+_-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

export interface DecodedAsset {
  mime: string;
  dataBase64: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  format: AssetFormat;
  kind: AssetKind;
  hasAlpha: boolean;
}

export function parseDataUrl(uri: string) {
  const match = DATA_URL_PATTERN.exec(uri);
  if (!match || match[2].length % 4 !== 0) return null;
  const padding = match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0;
  return {
    mime: match[1].toLowerCase(),
    base64: match[2],
    bytes: (match[2].length * 3) / 4 - padding,
  };
}

/** Extracts dimensions from JPEG SOF markers. */
function parseJpegDimensions(data: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset < data.length - 8) {
    if (data[offset] !== 0xff) break;
    const marker = data[offset + 1];
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof) {
      const height = data.readUInt16BE(offset + 5);
      const width = data.readUInt16BE(offset + 7);
      return { width, height };
    }
    const len = data.readUInt16BE(offset + 2);
    offset += 2 + len;
  }
  return null;
}

/** Extracts dimensions and alpha flag from WebP chunks. */
function parseWebpInfo(data: Buffer): { width: number; height: number; hasAlpha: boolean } | null {
  if (data.length < 30) return null;
  const fourcc = data.toString("ascii", 12, 16);

  if (fourcc === "VP8X") {
    const hasAlpha = (data[20] & 0x10) !== 0 || data.includes(Buffer.from("ALPH"));
    const width = 1 + data.readUIntLE(24, 3);
    const height = 1 + data.readUIntLE(27, 3);
    return { width, height, hasAlpha };
  }

  if (fourcc === "VP8L") {
    if (data[20] !== 0x2f) return null;
    const b0 = data[21], b1 = data[22], b2 = data[23], b3 = data[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height, hasAlpha: true };
  }

  if (fourcc === "VP8 ") {
    if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return null;
    const width = data.readUInt16LE(26) & 0x3fff;
    const height = data.readUInt16LE(28) & 0x3fff;
    return { width, height, hasAlpha: false };
  }

  return null;
}

/** Extracts dimensions from SVG viewBox or width/height attributes. */
function parseSvgDimensions(text: string): { width: number; height: number } | null {
  const vbMatch = /viewBox\s*=\s*["']\s*([-\d.]+)\s+([-\d.]+)\s+([\d.]+)\s+([\d.]+)\s*["']/i.exec(text);
  if (vbMatch) {
    const w = parseFloat(vbMatch[3]);
    const h = parseFloat(vbMatch[4]);
    if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) };
  }
  const wMatch = /\bwidth\s*=\s*["']([\d.]+)p?x?["']/i.exec(text);
  const hMatch = /\bheight\s*=\s*["']([\d.]+)p?x?["']/i.exec(text);
  if (wMatch && hMatch) {
    const w = parseFloat(wMatch[1]);
    const h = parseFloat(hMatch[1]);
    if (w > 0 && h > 0) return { width: Math.round(w), height: Math.round(h) };
  }
  return { width: 512, height: 512 };
}

/**
 * Validates, decodes and extracts dimensions & format for all asset types.
 * Rejects corrupt binary, HTML, scripts, or unapproved types with clear errors.
 */
export function decodeArtwork(uri: string, name: string): DecodedAsset {
  const parsed = parseDataUrl(uri);
  if (!parsed || parsed.bytes === 0) {
    throw new Error(`“${name}” is not a valid data URL or has unsupported encoding.`);
  }

  const { mime, base64 } = parsed;
  const data = Buffer.from(base64, "base64");

  if (data.length > MAX_STORED_BYTES) {
    throw new Error(`“${name}” exceeds the 5 MB asset file size limit.`);
  }

  // 1. PNG / Transparent PNG
  if (mime === "image/png") {
    const validPng =
      data.length >= 33 &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      data.toString("ascii", 12, 16) === "IHDR";
    if (!validPng) throw new Error(`“${name}” does not contain valid PNG artwork.`);

    const width = data.readUInt32BE(16);
    const height = data.readUInt32BE(20);
    if (!width || !height || width > 20000 || height > 20000) {
      throw new Error(`“${name}” has unsupported image dimensions.`);
    }

    const colorType = data[25];
    const hasAlpha = colorType === 4 || colorType === 6 || data.includes(Buffer.from("tRNS"));
    return {
      mime,
      dataBase64: base64,
      sizeBytes: data.length,
      width,
      height,
      hasAlpha,
      format: hasAlpha ? "png-transparent" : "png",
      kind: "image",
    };
  }

  // 2. JPEG
  if (mime === "image/jpeg" || mime === "image/jpg") {
    const validJpeg = data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
    if (!validJpeg) throw new Error(`“${name}” does not contain valid JPEG artwork.`);

    const dims = parseJpegDimensions(data);
    const width = dims?.width ?? 1024;
    const height = dims?.height ?? 1024;
    if (!width || !height || width > 20000 || height > 20000) {
      throw new Error(`“${name}” has unsupported image dimensions.`);
    }

    return {
      mime: "image/jpeg",
      dataBase64: base64,
      sizeBytes: data.length,
      width,
      height,
      hasAlpha: false,
      format: "jpeg",
      kind: "image",
    };
  }

  // 3. WebP
  if (mime === "image/webp") {
    const validWebp = data.length >= 20 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
    if (!validWebp) throw new Error(`“${name}” does not contain valid WEBP artwork.`);

    const info = parseWebpInfo(data);
    const width = info?.width ?? 1024;
    const height = info?.height ?? 1024;
    if (!width || !height || width > 20000 || height > 20000) {
      throw new Error(`“${name}” has unsupported image dimensions.`);
    }

    return {
      mime,
      dataBase64: base64,
      sizeBytes: data.length,
      width,
      height,
      hasAlpha: info?.hasAlpha ?? false,
      format: "webp",
      kind: "image",
    };
  }

  // 4. Vector (SVG)
  if (mime === "image/svg+xml") {
    const text = data.toString("utf8");
    if (!text.includes("<svg") || text.includes("<script") || text.includes("javascript:")) {
      throw new Error(`“${name}” does not contain safe and valid SVG vector artwork.`);
    }
    const dims = parseSvgDimensions(text);
    return {
      mime,
      dataBase64: base64,
      sizeBytes: data.length,
      width: dims?.width ?? 512,
      height: dims?.height ?? 512,
      hasAlpha: true,
      format: "svg",
      kind: "image",
    };
  }

  // 5. Animation metadata (JSON)
  if (mime === "application/json" || mime === "text/json") {
    try {
      const obj = JSON.parse(data.toString("utf8"));
      if (!obj || typeof obj !== "object") throw new Error();
      let width: number | null = null;
      let height: number | null = null;
      if (typeof obj.w === "number" && typeof obj.h === "number") {
        width = Math.round(obj.w);
        height = Math.round(obj.h);
      }
      return {
        mime: "application/json",
        dataBase64: base64,
        sizeBytes: data.length,
        width,
        height,
        hasAlpha: true,
        format: "json-animation",
        kind: "spine",
      };
    } catch {
      throw new Error(`“${name}” does not contain valid animation JSON metadata.`);
    }
  }

  // 6. Audio
  if (mime.startsWith("audio/")) {
    const isAudio =
      mime === "audio/mpeg" ||
      mime === "audio/mp3" ||
      mime === "audio/wav" ||
      mime === "audio/ogg" ||
      mime === "audio/aac";
    if (!isAudio) throw new Error(`“${name}”: unsupported audio format.`);
    return {
      mime,
      dataBase64: base64,
      sizeBytes: data.length,
      width: null,
      height: null,
      hasAlpha: false,
      format: "audio",
      kind: "audio",
    };
  }

  // 7. Other (Font assets: WOFF, WOFF2, TTF, OTF)
  if (
    mime === "font/woff" ||
    mime === "font/woff2" ||
    mime === "font/ttf" ||
    mime === "font/otf" ||
    mime === "application/font-woff" ||
    mime === "application/font-woff2" ||
    mime === "application/x-font-ttf" ||
    mime === "application/x-font-opentype"
  ) {
    return {
      mime,
      dataBase64: base64,
      sizeBytes: data.length,
      width: null,
      height: null,
      hasAlpha: false,
      format: "other",
      kind: "font",
    };
  }

  throw new Error(`“${name}”: ${mime} is not a supported asset format.`);
}
