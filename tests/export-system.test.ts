import assert from "node:assert/strict";
import Module from "node:module";
import { describe, it } from "node:test";

// Allow importing server modules in Node tsx tests
const origLoad = (
  Module as unknown as {
    _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  }
)._load;
(
  Module as unknown as {
    _load: (req: string, parent: unknown, isMain: boolean) => unknown;
  }
)._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req === "server-only") return {};
  if (req === "next/cache") return { revalidatePath: () => {} };
  return origLoad.call(this, req, parent, isMain);
};

import { createBlueprint } from "../src/lib/blueprint/factory";
import type { GameBlueprint, SceneObject } from "../src/lib/blueprint/types";
import { crc32 } from "../src/lib/design/zip";
import {
  DEFAULT_ASSET_SHEET_VIEWPORT,
  EXPORT_TYPES,
  ExportBlockedError,
  applyExportSettingsToBlueprint,
  buildAssetSheetMetadata,
  exportBlueprintJson,
  exportPngAssetSheet,
  exportProjectJson,
  exportProjectZip,
  fitAssetSheetViewport,
  importBlueprintJson,
  importExportedJson,
  importProjectJson,
  panAssetSheetViewport,
  parsePngHeader,
  readZipArchiveEntries,
  validateBlueprintForExport,
  zoomAssetSheetViewport,
} from "../src/lib/export";
import { addSceneToBlueprint } from "../src/lib/scenes";

function createRichTestBlueprint(): GameBlueprint {
  const base = createBlueprint({
    id: "prj-export-f20",
    title: "Solaris Odyssey",
    description: "Cosmic 5x3 slot for F20 export system verification",
    theme: "Cosmic",
    styleGuide: "Cinematic Gold & Nebula",
    columns: 5,
    rows: 3,
    paylineCount: 20,
    rtpTarget: 96.4,
    volatility: "high",
    symbolArt: {
      WILD: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><rect width='128' height='128' fill='%236366f1'/></svg>",
      SCAT: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='128' height='128'><circle cx='64' cy='64' r='56' fill='%23ec4899'/></svg>",
    },
  });

  // Add a third scene and composed images on scene 1
  const added = addSceneToBlueprint(base, { name: "Bonus Vault" });
  let bp: GameBlueprint = {
    ...added.blueprint,
    scenes: added.blueprint.scenes.map((scene, idx) =>
      idx === 0
        ? {
            ...scene,
            composedImages: [
              {
                id: "comp-main-banner",
                name: "Main Header Composite",
                assetId: "symart-wild",
                uri: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='64'></svg>",
                refKind: "image",
                refId: null,
                layerId: added.blueprint.layers[0].id,
                x: 100,
                y: 40,
                width: 256,
                height: 64,
                rotation: 0,
                visible: true,
                order: 0,
              },
            ],
          }
        : scene,
    ),
  };

  // Add explicit video, webm, sprite-sheet, and gif animations
  bp = {
    ...bp,
    animations: [
      ...bp.animations,
      {
        id: "anim-video-intro",
        target: "layer-bg",
        trigger: "feature_enter",
        kind: "video_intro",
        name: "Feature Intro Video",
        animationType: "Background",
        source: "video",
        format: "mp4",
        durationMs: 1800,
        duration: 1.8,
        fps: 30,
        loop: false,
        easing: "linear",
        state: "enabled",
        videoReference: {
          assetId: null,
          uri: "https://example.invalid/intro.mp4",
          mimeType: "video/mp4",
          width: 1920,
          height: 1080,
        },
      },
      {
        id: "anim-webm-overlay",
        target: "layer-fx",
        trigger: "big_win",
        kind: "webm_fx",
        name: "Nebula Burst WebM",
        animationType: "Standalone",
        source: "video",
        format: "webm",
        durationMs: 2200,
        duration: 2.2,
        fps: 60,
        loop: false,
        easing: "linear",
        state: "enabled",
        videoReference: {
          assetId: null,
          uri: "https://example.invalid/nebula.webm",
          mimeType: "video/webm",
          width: 1280,
          height: 720,
        },
      },
      {
        id: "anim-sprite-wild",
        target: "layer-reels",
        trigger: "win",
        kind: "sprite_win",
        name: "Wild Spin Sprite Sheet",
        animationType: "Symbol Win",
        source: "sprite_sheet",
        format: "sprite-sheet",
        durationMs: 1000,
        duration: 1.0,
        fps: 24,
        loop: true,
        easing: "steps(8)",
        state: "enabled",
        spriteSheetReference: {
          assetId: "symart-wild",
          uri: null,
          columns: 4,
          rows: 2,
          frameWidth: 64,
          frameHeight: 64,
          frameCount: 8,
        },
      },
      {
        id: "anim-gif-sparkle",
        target: "layer-ui",
        trigger: "spin_start",
        kind: "gif_sparkle",
        name: "Spin Button Sparkle GIF",
        animationType: "Hover",
        source: "custom",
        format: "gif",
        durationMs: 800,
        duration: 0.8,
        fps: 15,
        loop: true,
        easing: "linear",
        state: "enabled",
      },
    ],
  };

  return JSON.parse(JSON.stringify(bp)) as GameBlueprint;
}

describe("F20 — Export System", () => {
  it("1. defines all 4 required export types and explicitly marks no server-side production exporter", () => {
    const ids = EXPORT_TYPES.map((t) => t.id);
    assert.deepEqual(ids, [
      "zip",
      "png-asset-sheet",
      "blueprint-json",
      "project-json",
    ]);

    const bp = createRichTestBlueprint();
    const projectExport = exportProjectJson(bp);
    assert.equal(projectExport.package.exporter.kind, "frontend-export-center");
    assert.equal(
      projectExport.package.exporter.serverProductionExporterExists,
      false,
    );

    const zipExport = exportProjectZip(bp);
    assert.equal(zipExport.manifest.exporter.kind, "frontend-export-center");
    assert.equal(
      zipExport.manifest.exporter.serverProductionExporterExists,
      false,
    );
  });

  it("2. packages real data in Download ZIP with 1x and 2x image scaling", () => {
    const bp = createRichTestBlueprint();

    const zip1x = exportProjectZip(bp, {
      imageScale: "1x",
      animationOptions: {
        includeVideo: true,
        includeWebm: true,
        includeSpriteSheets: true,
        includeGif: true,
      },
    });
    const zip2x = exportProjectZip(bp, {
      imageScale: "2x",
      animationOptions: {
        includeVideo: true,
        includeWebm: true,
        includeSpriteSheets: true,
        includeGif: true,
      },
    });

    assert.ok(
      zip1x.bytes.byteLength > 500,
      "1x ZIP contains real binary payload",
    );
    assert.ok(
      zip2x.bytes.byteLength > zip1x.bytes.byteLength,
      "2x ZIP has larger scaled raster payload than 1x ZIP",
    );
    assert.equal(zip1x.manifest.imageScale, "1x");
    assert.equal(zip1x.manifest.scaleFactor, 1);
    assert.equal(zip2x.manifest.imageScale, "2x");
    assert.equal(zip2x.manifest.scaleFactor, 2);

    // Parse binary ZIP entries and verify CRC32 integrity
    const entries1x = readZipArchiveEntries(zip1x.bytes);
    const entries2x = readZipArchiveEntries(zip2x.bytes);

    assert.ok(entries1x.some((e) => e.name === "blueprint.json"));
    assert.ok(entries1x.some((e) => e.name === "project.json"));
    assert.ok(entries1x.some((e) => e.name === "asset-sheet.png"));
    assert.ok(entries1x.some((e) => e.name === "manifest.json"));
    assert.ok(entries1x.some((e) => e.name.startsWith("assets/1x/")));
    assert.ok(entries2x.some((e) => e.name.startsWith("assets/2x/")));

    for (const entry of entries1x) {
      assert.ok(entry.sizeBytes > 0, `${entry.name} has non-zero bytes`);
      assert.equal(
        crc32(entry.data),
        entry.crc32,
        `${entry.name} CRC32 matches`,
      );
    }

    // Verify PNG dimensions inside ZIP scale from 1x to 2x
    const sheet1xEntry = entries1x.find((e) => e.name === "asset-sheet.png")!;
    const sheet2xEntry = entries2x.find((e) => e.name === "asset-sheet.png")!;
    const png1x = parsePngHeader(sheet1xEntry.data);
    const png2x = parsePngHeader(sheet2xEntry.data);
    assert.equal(png1x.validSignature, true);
    assert.equal(png2x.validSignature, true);
    assert.equal(png2x.width, png1x.width * 2);
    assert.equal(png2x.height, png1x.height * 2);
  });

  it("3. respects all 4 ZIP animation options (Include video, Include WebM, Include sprite sheets, Include GIF)", () => {
    const bp = createRichTestBlueprint();

    // All enabled
    const allIn = exportProjectZip(bp, {
      imageScale: "1x",
      animationOptions: {
        includeVideo: true,
        includeWebm: true,
        includeSpriteSheets: true,
        includeGif: true,
      },
    });
    const allNames = allIn.entries.map((e) => e.name);
    assert.ok(allNames.some((n) => n.startsWith("animations/video/")));
    assert.ok(allNames.some((n) => n.startsWith("animations/webm/")));
    assert.ok(allNames.some((n) => n.startsWith("animations/spritesheets/")));
    assert.ok(allNames.some((n) => n.startsWith("animations/gif/")));

    // Only video & sprite sheets enabled (WebM and GIF disabled)
    const filtered = exportProjectZip(bp, {
      imageScale: "1x",
      animationOptions: {
        includeVideo: true,
        includeWebm: false,
        includeSpriteSheets: true,
        includeGif: false,
      },
    });
    const filteredNames = filtered.entries.map((e) => e.name);
    assert.ok(filteredNames.some((n) => n.startsWith("animations/video/")));
    assert.ok(!filteredNames.some((n) => n.startsWith("animations/webm/")));
    assert.ok(
      filteredNames.some((n) => n.startsWith("animations/spritesheets/")),
    );
    assert.ok(!filteredNames.some((n) => n.startsWith("animations/gif/")));

    // None enabled
    const noneIn = exportProjectZip(bp, {
      imageScale: "1x",
      animationOptions: {
        includeVideo: false,
        includeWebm: false,
        includeSpriteSheets: false,
        includeGif: false,
      },
    });
    const noneNames = noneIn.entries.map((e) => e.name);
    assert.ok(!noneNames.some((n) => n.startsWith("animations/")));
  });

  it("4. builds PNG Asset Sheet with Asset Count, Image Count, zoom, pan, fit, and real binary PNG download", () => {
    const bp = createRichTestBlueprint();
    const meta1x = buildAssetSheetMetadata(bp, "1x");
    assert.equal(meta1x.assetCount, bp.assets.length);
    assert.ok(
      meta1x.imageCount >= 5,
      "Includes image assets, symbols, and composed images",
    );

    const sheetExport = exportPngAssetSheet(bp, "1x");
    assert.equal(sheetExport.mimeType, "image/png");
    assert.ok(sheetExport.filename.endsWith("-asset-sheet-1x.png"));
    assert.ok(sheetExport.bytes.byteLength > 200);

    const parsedPng = parsePngHeader(sheetExport.bytes);
    assert.equal(parsedPng.validSignature, true);
    assert.equal(parsedPng.width, meta1x.sheetWidth);
    assert.equal(parsedPng.height, meta1x.sheetHeight);
    assert.equal(
      parsedPng.textChunks.Software,
      "Slot Studio Frontend Export Center",
    );
    const embeddedCounts = JSON.parse(parsedPng.textChunks.AssetSheet);
    assert.equal(embeddedCounts.assetCount, meta1x.assetCount);
    assert.equal(embeddedCounts.imageCount, meta1x.imageCount);

    // Viewport controls: zoom, pan, fit
    let vp = { ...DEFAULT_ASSET_SHEET_VIEWPORT };
    vp = zoomAssetSheetViewport(vp, 1.75);
    assert.equal(vp.zoom, 1.75);
    vp = zoomAssetSheetViewport(vp, 99);
    assert.equal(vp.zoom, 4.0);
    vp = zoomAssetSheetViewport(vp, 0.05);
    assert.equal(vp.zoom, 0.25);

    vp = panAssetSheetViewport(vp, 48, -24);
    assert.equal(vp.panX, 48);
    assert.equal(vp.panY, -24);

    vp = fitAssetSheetViewport();
    assert.deepEqual(vp, { zoom: 1, panX: 0, panY: 0 });
  });

  it("5. displays validation Errors, Warnings, and Passed checks, and BLOCKS export on critical schema corruption", () => {
    const validBp = createRichTestBlueprint();
    const validReport = validateBlueprintForExport(validBp);
    assert.equal(validReport.canExport, true);
    assert.equal(validReport.blocked, false);
    assert.equal(validReport.errors.length, 0);
    assert.ok(
      validReport.warnings.length > 0,
      "Reports placeholder asset warnings",
    );
    assert.ok(
      validReport.passed.length >= 10,
      "Reports passed structural checks",
    );

    const corruptObject = {
      id: "obj-corrupt",
      name: "Corrupt Object",
      kind: "element",
      refId: validBp.elements[0].id,
      layerId: validBp.layers[0].id,
      x: 10,
      y: 20,
      width: -50,
      height: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      zIndex: 0,
      visible: true,
      locked: false,
    } as unknown as SceneObject;

    // Introduce critical schema corruption: broken symbol reference in reel strip + negative object width
    const corruptedBp: GameBlueprint = {
      ...structuredClone(validBp),
      reels: {
        ...validBp.reels,
        strips: [["non-existent-symbol-id"], [], [], [], []],
      },
      scenes: validBp.scenes.map((scene, idx) =>
        idx === 0
          ? {
              ...scene,
              objects: [corruptObject],
            }
          : scene,
      ),
    };

    const corruptReport = validateBlueprintForExport(corruptedBp);
    assert.equal(corruptReport.blocked, true);
    assert.equal(corruptReport.canExport, false);
    assert.equal(corruptReport.status, "blocked");
    assert.ok(corruptReport.errors.length >= 2);

    // Verify all 4 exports are blocked when critical schema corruption exists
    assert.throws(
      () => exportBlueprintJson(corruptedBp),
      (err: unknown) =>
        err instanceof ExportBlockedError && err.validation.blocked,
    );
    assert.throws(
      () => exportProjectJson(corruptedBp),
      (err: unknown) =>
        err instanceof ExportBlockedError && err.validation.blocked,
    );
    assert.throws(
      () => exportPngAssetSheet(corruptedBp),
      (err: unknown) =>
        err instanceof ExportBlockedError && err.validation.blocked,
    );
    assert.throws(
      () => exportProjectZip(corruptedBp),
      (err: unknown) =>
        err instanceof ExportBlockedError && err.validation.blocked,
    );

    // Also block completely malformed root payloads
    const malformedReport = validateBlueprintForExport({
      version: 0,
      meta: null,
    });
    assert.equal(malformedReport.blocked, true);
    assert.equal(malformedReport.canExport, false);
  });

  it("6. exports and imports Blueprint JSON and Project JSON without losing any structure", () => {
    let originalBp = createRichTestBlueprint();
    originalBp = applyExportSettingsToBlueprint(originalBp, {
      activeExportType: "blueprint-json",
      imageScale: "2x",
      animationOptions: {
        includeVideo: true,
        includeWebm: false,
        includeSpriteSheets: true,
        includeGif: true,
      },
    });

    // 1. Blueprint JSON round-trip
    const exportedBp = exportBlueprintJson(originalBp, {
      includeAssets: true,
      minify: false,
    });
    assert.ok(
      exportedBp.json.includes('\n  "version": 1,'),
      "Readable formatted JSON",
    );

    const importedBpResult = importBlueprintJson(exportedBp.json);
    assert.equal(importedBpResult.ok, true);
    assert.equal(importedBpResult.sourceKind, "blueprint-json");
    assert.deepEqual(importedBpResult.blueprint, originalBp);

    // 2. Project JSON round-trip
    const exportedProj = exportProjectJson(originalBp, {
      id: "prj-export-f20",
      title: "Solaris Odyssey",
      revision: 7,
      folderPath: "Cosmic Slots/2026",
    });
    const importedProjResult = importProjectJson(exportedProj.json);
    assert.equal(importedProjResult.ok, true);
    assert.equal(importedProjResult.sourceKind, "project-json");
    assert.equal(importedProjResult.projectMeta?.revision, 7);
    assert.equal(
      importedProjResult.projectMeta?.folderPath,
      "Cosmic Slots/2026",
    );
    assert.deepEqual(importedProjResult.blueprint, originalBp);

    // 3. Rejects corrupted JSON on import
    const badImport = importExportedJson('{"version": 1, "meta": null}');
    assert.equal(badImport.ok, false);
    assert.equal(badImport.blueprint, null);
    assert.ok(badImport.errors.length > 0);
  });

  it("7. round-trips blueprint.json and project.json extracted from Download ZIP and persists through workspace-service", async () => {
    const { createProject, updateProject, getProject } = await import(
      "../src/server/workspace-service"
    );

    const created = await createProject({
      title: "F20 Export RoundTrip Game",
      theme: "Cyberpunk",
      styleGuide: "Neon Chrome",
    });

    const zipResult = exportProjectZip(
      created.blueprint,
      {
        imageScale: "2x",
        animationOptions: {
          includeVideo: true,
          includeWebm: true,
          includeSpriteSheets: true,
          includeGif: true,
        },
      },
      {
        id: created.id,
        title: created.title,
        revision: created.revision,
        folderPath: created.folderPath,
      },
    );

    const entries = readZipArchiveEntries(zipResult.bytes);
    const decoder = new TextDecoder();
    const bpZipEntry = entries.find((e) => e.name === "blueprint.json")!;
    const projZipEntry = entries.find((e) => e.name === "project.json")!;

    const fromZipBp = importBlueprintJson(decoder.decode(bpZipEntry.data));
    const fromZipProj = importProjectJson(decoder.decode(projZipEntry.data));

    assert.equal(fromZipBp.ok, true);
    assert.equal(fromZipProj.ok, true);
    assert.deepEqual(
      fromZipBp.blueprint,
      JSON.parse(JSON.stringify(created.blueprint)),
    );
    assert.deepEqual(
      fromZipProj.blueprint,
      JSON.parse(JSON.stringify(created.blueprint)),
    );

    // Persist the imported blueprint back to the database and reload
    const updated = await updateProject(created.id, {
      blueprint: fromZipBp.blueprint!,
    });
    const reloaded = await getProject(created.id);
    assert.ok(reloaded);
    assert.equal(reloaded.id, created.id);
    assert.equal(reloaded.blueprint.symbols.length, created.blueprint.symbols.length);
    assert.equal(reloaded.blueprint.scenes.length, created.blueprint.scenes.length);
    assert.equal(reloaded.blueprint.paylines.length, created.blueprint.paylines.length);
    assert.equal(updated.revision, created.revision + 1);
  });
});
