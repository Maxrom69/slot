import type { ElementDef } from "@/lib/blueprint/types";
import { buildZip } from "@/lib/design/zip";
import { membersOf, symbolImage } from "@/lib/design/selectors";
import { SET_TYPE_LABELS, VALUE_TIER_LABELS } from "@/lib/design/model";
import type { DesignDoc } from "@/lib/design/types";

export const fileSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "artwork";

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function fetchImage(uri: string) {
  const response = await fetch(uri, { cache: "force-cache" });
  if (!response.ok) throw new Error("The image could not be downloaded.");
  const blob = await response.blob();
  return { blob, ext: EXTENSIONS[blob.type] ?? "png" };
}

export async function downloadImage(uri: string, name: string) {
  const { blob, ext } = await fetchImage(uri);
  triggerDownload(blob, `${fileSlug(name)}.${ext}`);
}

/** Symbol set download: every symbol image plus a set.json describing the set. */
export async function downloadSetArchive(doc: DesignDoc, element: ElementDef) {
  const symbols = membersOf(doc, element);
  const files: { name: string; data: Uint8Array }[] = [];
  const described = [];
  for (const [index, symbol] of symbols.entries()) {
    const asset = symbolImage(doc, symbol);
    let file: string | null = null;
    if (asset) {
      const { blob, ext } = await fetchImage(asset.uri);
      file = `${String(index + 1).padStart(2, "0")}-${fileSlug(symbol.name)}.${ext}`;
      files.push({ name: file, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    described.push({ code: symbol.code, name: symbol.name, tier: symbol.tier, image: file });
  }
  if (files.length === 0) throw new Error("This set has no symbol images to download yet.");
  files.push({
    name: "set.json",
    data: new TextEncoder().encode(
      JSON.stringify(
        {
          name: element.name,
          symbolType: SET_TYPE_LABELS[element.symbolSet?.symbolType ?? "custom"],
          valueTier: VALUE_TIER_LABELS[element.symbolSet?.valueTier ?? "medium"],
          symbols: described,
        },
        null,
        2,
      ),
    ),
  });
  triggerDownload(new Blob([buildZip(files)], { type: "application/zip" }), `${fileSlug(element.name)}.zip`);
}
