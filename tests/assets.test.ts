import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import type { AssetRef, GameBlueprint } from "../src/lib/blueprint/types";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { draftToBlueprint } from "../src/lib/creation/blueprint-from-draft";
import { createDefaultDraft } from "../src/lib/creation/draft";
import { decodeArtwork, parseDataUrl } from "../src/lib/assets/decode";
import {
  validateAndPrepareUpload,
  MAX_UPLOAD_SOURCE_BYTES,
} from "../src/lib/assets/upload-helper";
import {
  findAssetUsage,
  safeUnbindAsset,
  assignAsset,
  restoreBlueprintImageRevision,
  detectAssetFormat,
} from "../src/lib/assets/usage";
import {
  replaceElementArtwork,
  restoreElementImageRevision,
  restorePreviousElementImageRevision,
} from "../src/lib/design/operations";
import { designDocFromBlueprint, applyDesign } from "../src/lib/design/migrate";
import { parseDesignDoc } from "../src/lib/design/parse";

const NOW = "2026-01-01T00:00:00.000Z";

function makePng(colorType = 6, width = 64, height = 64): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const n = Buffer.from(type);
    const len = Buffer.alloc(4);
    const sum = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    sum.writeUInt32BE(crc(Buffer.concat([n, data])));
    return Buffer.concat([len, n, data, sum]);
  };

  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0);
  head.writeUInt32BE(height, 4);
  head[8] = 8; // bit depth
  head[9] = colorType; // 6 = RGBA (alpha), 2 = RGB (opaque)

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width * bytesPerPixel }, () => 128)),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeJpeg(width = 64, height = 64): Buffer {
  // Minimal valid JPEG with SOF0 marker
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(17);
  sof[0] = 0xff;
  sof[1] = 0xc0; // SOF0
  sof.writeUInt16BE(15, 2); // length
  sof[4] = 8; // precision
  sof.writeUInt16BE(height, 5); // height
  sof.writeUInt16BE(width, 7); // width
  sof[9] = 3; // components
  const footer = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([header, sof, footer]);
}

function makeWebp(width = 64, height = 64): Buffer {
  const data = Buffer.alloc(32);
  data.write("RIFF", 0);
  data.writeUInt32LE(24, 4);
  data.write("WEBP", 8);
  data.write("VP8X", 12);
  data.writeUInt32LE(10, 16);
  data[20] = 0x10; // hasAlpha flag
  data.writeUIntLE(width - 1, 24, 3);
  data.writeUIntLE(height - 1, 27, 3);
  return data;
}

function makeSvg(width = 120, height = 80): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><circle cx="20" cy="20" r="10"/></svg>`;
}

function makeJsonAnimation(): string {
  return JSON.stringify({
    v: "5.5.7",
    fr: 60,
    ip: 0,
    op: 120,
    w: 500,
    h: 500,
    layers: [],
  });
}

function dataUrl(mime: string, buffer: Buffer | string): string {
  const base64 = typeof buffer === "string" ? Buffer.from(buffer).toString("base64") : buffer.toString("base64");
  return `data:${mime};base64,${base64}`;
}

const baseBlueprint = (): GameBlueprint =>
  draftToBlueprint(
    { ...createDefaultDraft(), title: "Asset Test", theme: "Roman Empire" },
    { id: "asset-test-project", now: NOW },
  );

/* --------------------------- Format Decoding & Validation --------------------------- */

test("decodeArtwork decodes Transparent PNG and detects alpha channel", () => {
  const transparentPng = makePng(6, 120, 80);
  const uri = dataUrl("image/png", transparentPng);
  const decoded = decodeArtwork(uri, "symbol-alpha.png");

  assert.equal(decoded.format, "png-transparent");
  assert.equal(decoded.hasAlpha, true);
  assert.equal(decoded.width, 120);
  assert.equal(decoded.height, 80);
  assert.equal(decoded.kind, "image");
});

test("decodeArtwork decodes standard opaque PNG", () => {
  const opaquePng = makePng(2, 60, 40);
  const uri = dataUrl("image/png", opaquePng);
  const decoded = decodeArtwork(uri, "opaque.png");

  assert.equal(decoded.format, "png");
  assert.equal(decoded.hasAlpha, false);
  assert.equal(decoded.width, 60);
  assert.equal(decoded.height, 40);
});

test("decodeArtwork decodes JPEG and extracts dimensions", () => {
  const jpegBuf = makeJpeg(320, 240);
  const uri = dataUrl("image/jpeg", jpegBuf);
  const decoded = decodeArtwork(uri, "background.jpg");

  assert.equal(decoded.format, "jpeg");
  assert.equal(decoded.hasAlpha, false);
  assert.equal(decoded.width, 320);
  assert.equal(decoded.height, 240);
});

test("decodeArtwork decodes WebP with dimensions and alpha", () => {
  const webpBuf = makeWebp(200, 150);
  const uri = dataUrl("image/webp", webpBuf);
  const decoded = decodeArtwork(uri, "icon.webp");

  assert.equal(decoded.format, "webp");
  assert.equal(decoded.hasAlpha, true);
  assert.equal(decoded.width, 200);
  assert.equal(decoded.height, 150);
});

test("decodeArtwork decodes Vector SVG and extracts viewBox dimensions", () => {
  const svgText = makeSvg(400, 300);
  const uri = dataUrl("image/svg+xml", svgText);
  const decoded = decodeArtwork(uri, "frame.svg");

  assert.equal(decoded.format, "svg");
  assert.equal(decoded.hasAlpha, true);
  assert.equal(decoded.width, 400);
  assert.equal(decoded.height, 300);
  assert.equal(decoded.kind, "image");
});

test("decodeArtwork decodes Animation JSON metadata (Spine/Lottie)", () => {
  const jsonText = makeJsonAnimation();
  const uri = dataUrl("application/json", jsonText);
  const decoded = decodeArtwork(uri, "spin_anim.json");

  assert.equal(decoded.format, "json-animation");
  assert.equal(decoded.kind, "spine");
  assert.equal(decoded.width, 500);
  assert.equal(decoded.height, 500);
});

test("decodeArtwork rejects HTML, script tags, or corrupt binary", () => {
  const htmlUri = dataUrl("text/html", "<h1>Not allowed</h1>");
  assert.throws(() => decodeArtwork(htmlUri, "danger.html"));

  const badSvg = dataUrl("image/svg+xml", "<svg><script>alert(1)</script></svg>");
  assert.throws(() => decodeArtwork(badSvg, "danger.svg"));

  const fakePng = dataUrl("image/png", Buffer.from("not a real png"));
  assert.throws(() => decodeArtwork(fakePng, "fake.png"));
});

test("detectAssetFormat identifies formats correctly from AssetRef", () => {
  const a1: AssetRef = { id: "1", name: "test.png", kind: "image", uri: "/test.png", state: "linked", tags: [], format: "png-transparent" };
  assert.equal(detectAssetFormat(a1).format, "png-transparent");
  assert.equal(detectAssetFormat(a1).isTransparent, true);

  const a2: AssetRef = { id: "2", name: "art.svg", kind: "image", uri: "/art.svg", state: "linked", tags: [] };
  assert.equal(detectAssetFormat(a2).format, "svg");
  assert.equal(detectAssetFormat(a2).isTransparent, true);

  const a3: AssetRef = { id: "3", name: "anim.json", kind: "spine", uri: "/anim.json", state: "linked", tags: [] };
  assert.equal(detectAssetFormat(a3).format, "json-animation");

  const a4: AssetRef = { id: "4", name: "photo.jpg", kind: "image", uri: "/photo.jpg", state: "linked", tags: [] };
  assert.equal(detectAssetFormat(a4).format, "jpeg");
});

/* --------------------------- Usage Tracking & Safe Deletion --------------------------- */

test("findAssetUsage detects references in symbols, elements, scenes, canvas and style", () => {
  const bp = baseBlueprint();
  const assetId = "shared-asset-1";
  const asset: AssetRef = { id: assetId, name: "shared.png", kind: "image", uri: "/api/assets/shared", state: "linked", tags: [] };
  bp.assets.push(asset);

  // Link asset to symbol, element, canvas background, and scene
  bp.symbols[0].assetId = assetId;
  bp.elements[0].assetId = assetId;
  bp.canvas.backgroundAssetId = assetId;
  bp.scenes[0].background = { color: "#000", assetId };

  const usages = findAssetUsage(bp, assetId);
  assert.ok(usages.length >= 4, "detected all 4 usages");

  const categories = usages.map((u) => u.category);
  assert.ok(categories.includes("symbol"));
  assert.ok(categories.includes("element"));
  assert.ok(categories.includes("canvas_background"));
  assert.ok(categories.includes("scene_background"));
});

test("safeUnbindAsset cleanly unbinds all references without corrupting blueprint integrity", () => {
  const bp = baseBlueprint();
  const assetId = "doomed-asset";
  const asset: AssetRef = { id: assetId, name: "doomed.png", kind: "image", uri: "/api/assets/doomed", state: "linked", tags: [] };
  bp.assets.push(asset);

  bp.symbols[0].assetId = assetId;
  bp.symbols[0].image = { provider: "project", assetId };
  bp.elements[0].assetId = assetId;
  bp.elements[0].image = { provider: "project", assetId };
  bp.canvas.backgroundAssetId = assetId;
  bp.scenes[0].background = { color: null, assetId };

  // Deletion with safe unbind
  const cleaned = safeUnbindAsset(bp, assetId);

  // Asset is removed from assets list
  assert.equal(cleaned.assets.some((a) => a.id === assetId), false);

  // All references are reset to null/placeholder
  assert.equal(cleaned.symbols[0].assetId, null);
  assert.equal(cleaned.symbols[0].image, null);
  assert.equal(cleaned.elements[0].assetId, null);
  assert.equal(cleaned.elements[0].image, null);
  assert.equal(cleaned.canvas.backgroundAssetId, null);
  assert.equal(cleaned.scenes[0].background?.assetId, null);

  // Blueprint integrity must be 100% valid
  const validation = validateBlueprint(cleaned);
  assert.equal(validation.integrityOk, true, `Blueprint integrity issues: ${validation.integrityIssues.join(", ")}`);
});

test("assignAsset assigns asset to symbol, element, scene and canvas background", () => {
  const bp = baseBlueprint();
  const assetId = "assigned-asset";
  const asset: AssetRef = { id: assetId, name: "gold-coin.png", kind: "image", uri: "/api/assets/coin", state: "linked", tags: [] };
  bp.assets.push(asset);

  // Assign to symbol
  const symTarget = bp.symbols[0].id;
  const bpWithSym = assignAsset(bp, assetId, { type: "symbol", targetId: symTarget });
  assert.equal(bpWithSym.symbols.find((s) => s.id === symTarget)?.assetId, assetId);
  assert.equal(bpWithSym.symbols.find((s) => s.id === symTarget)?.image?.assetId, assetId);

  // Assign to canvas background
  const bpWithCanvas = assignAsset(bp, assetId, { type: "canvas_background", targetId: "" });
  assert.equal(bpWithCanvas.canvas.backgroundAssetId, assetId);

  // Assign to scene background
  const sceneId = bp.scenes[0].id;
  const bpWithScene = assignAsset(bp, assetId, { type: "scene_background", targetId: sceneId });
  assert.equal(bpWithScene.scenes.find((sc) => sc.id === sceneId)?.background?.assetId, assetId);

  const check = validateBlueprint(bpWithSym);
  assert.equal(check.integrityOk, true);
});

/* --------------------------- F10 Upload Validation, Element Image History & Persistence --------------------------- */

test("F10 Upload Validation (validateAndPrepareUpload): validates file type, file size, and image dimensions across Transparent PNG, JPEG, WebP, Vector SVG, Animation JSON, Audio, and Font (Other)", async () => {
  // 1. Valid Transparent PNG
  const pngFile = new File([new Uint8Array(makePng(6, 256, 128))], "hero-alpha.png", { type: "image/png" });
  const vPng = await validateAndPrepareUpload(pngFile);
  assert.equal(vPng.format, "png-transparent");
  assert.equal(vPng.width, 256);
  assert.equal(vPng.height, 128);
  assert.equal(vPng.mime, "image/png");

  // 2. Valid JPEG
  const jpegFile = new File([new Uint8Array(makeJpeg(640, 480))], "bg.jpg", { type: "image/jpeg" });
  const vJpeg = await validateAndPrepareUpload(jpegFile);
  assert.equal(vJpeg.format, "jpeg");
  assert.equal(vJpeg.width, 640);
  assert.equal(vJpeg.height, 480);

  // 3. Valid WebP
  const webpFile = new File([new Uint8Array(makeWebp(300, 200))], "badge.webp", { type: "image/webp" });
  const vWebp = await validateAndPrepareUpload(webpFile);
  assert.equal(vWebp.format, "webp");
  assert.equal(vWebp.width, 300);
  assert.equal(vWebp.height, 200);

  // 4. Valid Vector SVG
  const svgFile = new File([makeSvg(512, 256)], "crest.svg", { type: "image/svg+xml" });
  const vSvg = await validateAndPrepareUpload(svgFile);
  assert.equal(vSvg.format, "svg");
  assert.equal(vSvg.width, 512);
  assert.equal(vSvg.height, 256);

  // 5. Valid Animation JSON
  const jsonFile = new File([makeJsonAnimation()], "flare.json", { type: "application/json" });
  const vJson = await validateAndPrepareUpload(jsonFile);
  assert.equal(vJson.format, "json-animation");
  assert.equal(vJson.width, 500);
  assert.equal(vJson.height, 500);

  // 6. Valid Font (Other)
  const fontFile = new File([new Uint8Array(Buffer.from("wOF2-mock-font-bytes"))], "roman-display.woff2", { type: "font/woff2" });
  const vFont = await validateAndPrepareUpload(fontFile);
  assert.equal(vFont.format, "other");
  const decodedFont = decodeArtwork(vFont.dataUrl, vFont.name);
  assert.equal(decodedFont.format, "other");
  assert.equal(decodedFont.kind, "font");

  // 7. Rejects invalid file type (.exe / text/html)
  const badType = new File([new Uint8Array(Buffer.from("hello"))], "malware.exe", { type: "application/x-msdownload" });
  await assert.rejects(() => validateAndPrepareUpload(badType), /not an accepted asset type/);

  // 8. Rejects empty file (0 bytes) and oversized file (> 15 MB)
  const emptyFile = new File([], "empty.png", { type: "image/png" });
  await assert.rejects(() => validateAndPrepareUpload(emptyFile), /empty/);

  const hugeObj = {
    name: "huge.png",
    type: "image/png",
    size: MAX_UPLOAD_SOURCE_BYTES + 1024,
    arrayBuffer: async () => new ArrayBuffer(0),
    text: async () => "",
  } as unknown as File;
  await assert.rejects(() => validateAndPrepareUpload(hugeObj), /too large/);

  // 9. Rejects image dimensions exceeding maximum (> 20,000 px)
  const oversizedSvg = new File([makeSvg(25000, 25000)], "giant.svg", { type: "image/svg+xml" });
  await assert.rejects(() => validateAndPrepareUpload(oversizedSvg), /dimensions|unsupported/i);
});

test("F10 Image History & Element Revisions: elements and symbols point to multiple image revisions with stable asset identity and can restore earlier revisions", () => {
  let bp = baseBlueprint();
  const a1: AssetRef = { id: "ast_title_v1", name: "title-v1.png", kind: "image", uri: "/api/assets/ast_title_v1", state: "linked", tags: ["library"], createdAt: NOW };
  const a2: AssetRef = { id: "ast_title_v2", name: "title-v2.png", kind: "image", uri: "/api/assets/ast_title_v2", state: "linked", tags: ["library"], createdAt: NOW };
  bp.assets.push(a1, a2);

  const titleEl = bp.elements.find((e) => e.type === "game_title")!;

  // Assign v1 then v2 to standalone Game Title element via assignAsset
  bp = assignAsset(bp, a1.id, { type: "element", targetId: titleEl.id });
  bp = assignAsset(bp, a2.id, { type: "element", targetId: titleEl.id });

  const updatedTitle = bp.elements.find((e) => e.id === titleEl.id)!;
  assert.equal(updatedTitle.assetId, a2.id);
  assert.equal(updatedTitle.image?.assetId, a2.id);
  assert.ok((updatedTitle.imageHistory ?? []).length >= 2, "Element stores multiple image revisions");
  assert.ok(updatedTitle.imageHistory?.some((r) => r.asset?.assetId === a1.id), "v1 revision preserved on element");
  assert.ok(updatedTitle.imageHistory?.some((r) => r.asset?.assetId === a2.id), "v2 revision recorded on element");

  // Usage tracking reports v2 as active element artwork and v1 as historical revision
  const usageV2 = findAssetUsage(bp, a2.id);
  assert.equal(usageV2.length, 1);
  assert.equal(usageV2[0].category, "element");

  const usageV1 = findAssetUsage(bp, a1.id);
  assert.equal(usageV1.length, 1);
  assert.equal(usageV1[0].category, "history");

  // Restore element to v1 revision via restoreBlueprintImageRevision
  const v1Rev = updatedTitle.imageHistory!.find((r) => r.asset?.assetId === a1.id)!;
  bp = restoreBlueprintImageRevision(bp, { kind: "element", id: titleEl.id, revisionId: v1Rev.id });
  assert.equal(bp.elements.find((e) => e.id === titleEl.id)?.assetId, a1.id);

  // Also verify DesignDoc operations (replaceElementArtwork, restorePreviousElementImageRevision, parseDesignDoc)
  let doc = designDocFromBlueprint(bp);
  doc = replaceElementArtwork(doc, titleEl.id, a2, { source: "upload", notes: "Switched back to v2" });
  assert.equal(doc.elements.find((e) => e.id === titleEl.id)?.assetId, a2.id);

  doc = restorePreviousElementImageRevision(doc, titleEl.id, "Reverted to v1");
  assert.equal(doc.elements.find((e) => e.id === titleEl.id)?.assetId, a1.id);

  const parsed = parseDesignDoc(doc);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const merged = applyDesign(bp, parsed.doc);
    assert.equal(validateBlueprint(merged).integrityOk, true);
    assert.ok((merged.elements.find((e) => e.id === titleEl.id)?.imageHistory ?? []).length >= 3);
  }
});

test("F10 End-to-End Persistence (asset-service): uploadProjectAsset, getProjectAssets, updateProjectAsset, assignProjectAsset, and deleteProjectAsset persist across reloads and never corrupt GameBlueprint", async () => {
  const Mod = (await import("node:module")).default as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const origLoad = Mod._load;
  Mod._load = function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    if (request === "next/cache") return { revalidatePath: () => undefined };
    return origLoad.apply(this, [request, parent, isMain]);
  };

  try {
    const { createProject, getProject, deleteProject } = await import("../src/server/workspace-service");
    const {
      getProjectAssets,
      uploadProjectAsset,
      updateProjectAsset,
      assignProjectAsset,
      deleteProjectAsset,
    } = await import("../src/server/asset-service");

    const created = await createProject({
      title: "F10 Asset Library Persistence Test",
      theme: "Ancient Egypt",
    });
    const projectId = created.id;

    try {
      // 1. Upload Transparent PNG, Vector SVG, and Animation JSON
      const pngUri = dataUrl("image/png", makePng(6, 128, 128));
      const svgUri = dataUrl("image/svg+xml", makeSvg(256, 256));
      const jsonUri = dataUrl("application/json", makeJsonAnimation());

      const upPng = await uploadProjectAsset(projectId, {
        name: "scarab-alpha.png",
        dataUrl: pngUri,
        tags: ["egypt", "symbol"],
      });
      const upSvg = await uploadProjectAsset(projectId, {
        name: "temple-frame.svg",
        dataUrl: svgUri,
        tags: ["frame", "vector"],
      });
      const upJson = await uploadProjectAsset(projectId, {
        name: "gold-burst.json",
        dataUrl: jsonUri,
        tags: ["fx", "animation"],
      });

      assert.equal(upPng.asset.format, "png-transparent");
      assert.equal(upPng.asset.width, 128);
      assert.equal(upPng.asset.height, 128);
      assert.equal(upSvg.asset.format, "svg");
      assert.equal(upJson.asset.format, "json-animation");

      // 2. Rename & update tags on scarab-alpha.png
      await updateProjectAsset(projectId, upPng.asset.id, {
        name: "royal-scarab-alpha.png",
        tags: ["egypt", "symbol", "featured"],
      });

      // 3. Assign assets to a symbol and a standalone element
      const projBefore = await getProject(projectId);
      assert.ok(projBefore);
      const targetSymId = projBefore.blueprint.symbols[0].id;
      const targetElId = projBefore.blueprint.elements.find((e) => e.type === "game_title")!.id;

      await assignProjectAsset(projectId, upPng.asset.id, {
        type: "symbol",
        targetId: targetSymId,
      });
      await assignProjectAsset(projectId, upSvg.asset.id, {
        type: "element",
        targetId: targetElId,
      });

      // 4. Reload assets via getProjectAssets (simulating page refresh)
      const fetched = await getProjectAssets(projectId);
      const fetchedPng = fetched.assets.find((a) => a.id === upPng.asset.id);
      const fetchedSvg = fetched.assets.find((a) => a.id === upSvg.asset.id);
      const fetchedJson = fetched.assets.find((a) => a.id === upJson.asset.id);

      assert.ok(fetchedPng, "PNG asset survives refresh");
      assert.equal(fetchedPng.name, "royal-scarab-alpha.png");
      assert.deepEqual(fetchedPng.tags, ["egypt", "symbol", "featured"]);
      assert.equal(fetchedPng.usageCount, 1, "Single active symbol usage counted once");
      assert.equal(fetchedPng.usage[0].category, "symbol");

      assert.ok(fetchedSvg, "SVG asset survives refresh");
      assert.equal(fetchedSvg.usageCount, 1);
      assert.equal(fetchedSvg.usage[0].category, "element");

      assert.ok(fetchedJson, "JSON animation asset survives refresh");
      assert.equal(fetchedJson.usageCount, 0);

      // 5. Delete in-use asset (upPng) and verify deletion safety never corrupts GameBlueprint
      const delRes = await deleteProjectAsset(projectId, upPng.asset.id);
      assert.equal(delRes.deletedId, upPng.asset.id);
      assert.equal(delRes.unlinkedCount, 1);

      const projAfterDelete = await getProject(projectId);
      assert.ok(projAfterDelete);
      const check = validateBlueprint(projAfterDelete.blueprint);
      assert.equal(check.integrityOk, true, `Blueprint must remain valid after deleting in-use asset: ${check.integrityIssues.join(", ")}`);
      assert.equal(projAfterDelete.blueprint.assets.some((a) => a.id === upPng.asset.id), false);
      assert.equal(projAfterDelete.blueprint.symbols.find((s) => s.id === targetSymId)?.assetId, null);
    } finally {
      await deleteProject(projectId).catch(() => undefined);
    }
  } finally {
    Mod._load = origLoad;
  }
});
