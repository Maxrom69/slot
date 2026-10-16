import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { draftToBlueprint } from "../src/lib/creation/blueprint-from-draft";
import { CREATION_ELEMENT_TYPE_IDS, createDefaultDraft, creationInputIssues, normalizeDraft, specialsForCount, validateDraft, GRID_PRESETS, type ImportedArtwork } from "../src/lib/creation/draft";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { inlineImageInfo } from "../src/lib/creation/artwork-policy";
import { draftDocument } from "../src/lib/client/draft-store";
import { CREATION_PROVIDERS } from "../src/lib/creation/providers";
import type { ElementType } from "../src/lib/blueprint/types";

const mod = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const origLoad = mod._load;
mod._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only" || request === "next/cache") {
    return { revalidatePath: () => undefined };
  }
  return origLoad.call(this, request, parent, isMain);
};

const NOW = "2026-01-01T00:00:00.000Z";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBJsAAAAASUVORK5CYII=";
const image = { id: "source-1", name: "Reference.png", dataUrl: PNG, mime: "image/png", width: 1, height: 1, bytes: inlineImageInfo(PNG)!.bytes };
const draft = () => ({ ...createDefaultDraft(), title: "Temple Blueprint", theme: "Jungle Temple" });

for (const preset of GRID_PRESETS) test(`${preset.label} produces a complete, distinct blueprint`, () => {
  const form = { ...draft(), grid: { preset: preset.id, columns: preset.columns, rows: preset.rows } };
  const bp = draftToBlueprint(form, { id: "test", now: NOW });
  assert.equal(validateBlueprint(bp).ok, true, validateBlueprint(bp).issues.join("\n"));
  assert.equal(bp.reels.columns, preset.columns); assert.equal(bp.reels.rows, preset.rows);
  assert.equal(bp.reels.strips.length, preset.columns); assert.equal(bp.paylines.length, 20);
  assert.equal(new Set(bp.paylines.map((l) => l.pattern.join(","))).size, 20);
});

test("all manual choices survive Game Blueprint serialization, including disabled element choices", () => {
  const form = normalizeDraft({
    ...draft(), folderPath: " Campaigns / Spring ", stylePreset: "neon", styleGuide: "Cyan chrome",
    description: "Manual production project", grid: { preset: "custom", columns: 7, rows: 5 },
    evaluation: "ways", paylineCount: 35, rtpTarget: 95.2, volatility: "high", status: "blueprint",
    symbols: { royals: 5, medium: 1, high: 4, specials: ["scatter"] },
    elements: { gameTitle: false, backgrounds: 0, aspect: "9:16", reelFrames: 0, frameStyle: "ornate", buttons: ["spin", "menu", "turbo"] },
    referenceImage: image,
  });
  const bp = JSON.parse(JSON.stringify(draftToBlueprint(form, { id: "test", now: NOW })));
  assert.equal(validateBlueprint(bp).ok, true);
  assert.equal(bp.meta.title, form.title); assert.equal(bp.meta.theme, form.theme);
  assert.equal(bp.meta.folderPath, "Campaigns/Spring"); assert.equal(bp.meta.styleGuide, form.styleGuide);
  assert.equal(bp.meta.description, form.description); assert.equal(bp.meta.status, form.status);
  assert.deepEqual(bp.creation.symbolPlan, form.symbols); assert.deepEqual(bp.creation.elements, form.elements);
  assert.equal(bp.creation.gridPreset, "custom"); assert.equal(bp.creation.stylePreset, "neon");
  assert.equal(bp.creation.requestedPaylineCount, 35); assert.equal(bp.creation.mathState, "unverified");
  assert.equal(bp.math.rtpTarget, 95.2); assert.equal(bp.math.volatility, "high");
  assert.equal(bp.canvas.width, 1080); assert.equal(bp.canvas.height, 1920);
  assert.equal(bp.canvas.backgroundAssetId, null); assert.equal(bp.paylines.length, 0);
  assert.equal(bp.style.referenceAssetId, "asset-reference");
  assert.equal(bp.assets.find((a: { id: string }) => a.id === "asset-reference").uri, PNG);
});

test("every documented artwork category is supported, bound and retained", () => {
  const types: ElementType[] = ["symbol_set", "symbol", "game_title", "reel_frame", "game_background", "button_set", "other_asset"];
  const artwork: ImportedArtwork[] = types.map((elementType, i) => ({ ...image, id: `source-${i}`, name: `${elementType}.png`, elementType }));
  const form = { ...draft(), artwork };
  assert.deepEqual(creationInputIssues(form), []);
  const bp = draftToBlueprint(form, { id: "test", now: NOW });
  assert.equal(validateBlueprint(bp).ok, true);
  for (const type of types) assert.ok(bp.elements.some((el) => el.type === type && el.origin === "imported"), type);
  assert.equal(bp.creation?.artwork.length, 7);
  assert.equal(bp.assets.filter((a) => a.state === "linked").length, 7);
  assert.equal(bp.assets.find((a) => a.id === bp.canvas.backgroundAssetId)?.uri, PNG);
});

test("custom smallest and largest grids create supported payline counts", () => {
  for (const [columns, rows] of [[3, 2], [8, 6]]) {
    const form = normalizeDraft({ ...draft(), grid: { preset: "custom", columns, rows }, paylineCount: 100 });
    const bp = draftToBlueprint(form, { id: "test", now: NOW });
    assert.equal(validateBlueprint(bp).ok, true);
    assert.equal(bp.paylines.length, Math.min(100, rows ** columns));
  }
});

test("normalization is deterministic and all partial defaults fit their grid", () => {
  const partial = { grid: { columns: 3, rows: 2 }, artwork: [{ ...image, id: undefined, elementType: "other_asset" }] };
  assert.deepEqual(normalizeDraft(partial), normalizeDraft(partial));
  assert.equal(normalizeDraft(partial).paylineCount, 8);
});

test("special count adjustments preserve selected behaviours", () => {
  assert.deepEqual(specialsForCount(["bonus"], 2), ["bonus", "wild"]);
  assert.deepEqual(specialsForCount(["scatter", "bonus"], 1), ["scatter"]);
  assert.deepEqual(specialsForCount(["wild"], 0), []);
});

test("missing required fields and empty symbol plans are not creatable", () => {
  const form = createDefaultDraft();
  assert.ok(validateDraft(form).errors.title); assert.ok(validateDraft(form).errors.theme);
  assert.equal(validateBlueprint(draftToBlueprint(form, { id: "test", now: NOW })).ok, false);
  const empty = { ...draft(), symbols: { royals: 0, medium: 0, high: 0, specials: [] } };
  assert.ok(validateDraft(empty).errors.symbols);
});

test("invalid submissions are rejected before normalization can discard artwork", () => {
  const bad = { ...image, dataUrl: "data:text/html;base64,PGgxPnRlc3Q8L2gxPg==", elementType: "other_asset" };
  assert.ok(creationInputIssues({ ...draft(), artwork: [bad] }).length);
  assert.ok(creationInputIssues({ ...draft(), artwork: [{ ...bad, dataUrl: "data:image/svg+xml;base64,AAAA" }] }).length);
  assert.ok(creationInputIssues({ ...draft(), artwork: [null] }).length);
  assert.ok(creationInputIssues({ ...draft(), grid: { columns: 99, rows: 3 } }).length);
  assert.ok(creationInputIssues({ ...draft(), evaluation: "simulated" }).length);
  assert.ok(creationInputIssues(null).length);
});

test("the persisted draft document contains the complete blueprint and artwork", () => {
  const form = { ...draft(), referenceImage: image, artwork: [{ ...image, elementType: "other_asset" as const }] };
  const document = draftDocument(form, "draft-test", NOW);
  assert.deepEqual(JSON.parse(JSON.stringify(document.form)), form);
  assert.equal(document.blueprint.assets.filter((a) => a.state === "linked").length, 2);
  assert.equal(document.blueprint.creation?.reference?.sourceId, image.id);
});

test("F03 acceptance: creating a project from a manual draft persists a valid GameBlueprint, updates dashboard, and opens in Design workspace", async () => {
  const { createProject, deleteFolder, deleteProject, getProject, getWorkspace } = await import(
    "../src/server/workspace-service"
  );

  // Verify Manual + reserved Agent tabs
  const manualProvider = CREATION_PROVIDERS.find((p) => p.id === "manual");
  const agentProvider = CREATION_PROVIDERS.find((p) => p.id === "agent");
  assert.equal(manualProvider?.available, true);
  assert.equal(agentProvider?.available, false);
  assert.equal(agentProvider?.badge, "Coming soon");

  // Verify all 7 documented F03 element categories
  assert.deepEqual(CREATION_ELEMENT_TYPE_IDS, [
    "symbol_set",
    "symbol",
    "game_title",
    "reel_frame",
    "game_background",
    "button_set",
    "other_asset",
  ]);

  const folderPath = `F03Accept_${Date.now().toString(36)}/Nested`;
  const manualDraft = normalizeDraft({
    ...createDefaultDraft(),
    title: "Obsidian Sun",
    theme: "Solar Aztec",
    folderPath,
    stylePreset: "cinematic",
    styleGuide: "Molten gold, carved basalt, dramatic rim light",
    description: "Manual-first F03 acceptance project",
    grid: { preset: "6x4", columns: 6, rows: 4 },
    evaluation: "lines",
    paylineCount: 25,
    rtpTarget: 96.2,
    volatility: "high",
    status: "blueprint",
    symbols: { royals: 4, medium: 2, high: 3, specials: ["wild", "scatter"] },
    elements: {
      gameTitle: true,
      backgrounds: 2,
      aspect: "16:9",
      reelFrames: 1,
      frameStyle: "ornate",
      buttons: ["spin", "max", "auto", "turbo"],
    },
    referenceImage: image,
    artwork: [
      { ...image, id: "art-bg", name: "SolarTempleBg.png", elementType: "game_background" },
      { ...image, id: "art-frame", name: "GoldFrame.png", elementType: "reel_frame" },
      { ...image, id: "art-title", name: "ObsidianLogo.png", elementType: "game_title" },
      { ...image, id: "art-other", name: "SunEmblem.png", elementType: "other_asset" },
    ],
  });

  const created = await createProject({
    draft: manualDraft,
    title: manualDraft.title,
    theme: manualDraft.theme,
    folderPath: manualDraft.folderPath,
  });

  try {
    assert.equal(validateBlueprint(created.blueprint).ok, true);
    assert.equal(created.title, "Obsidian Sun");
    assert.equal(created.folderPath, folderPath);
    assert.equal(created.blueprint.reels.columns, 6);
    assert.equal(created.blueprint.reels.rows, 4);

    // Dashboard immediately sees the project
    const ws = await getWorkspace();
    assert.ok(ws.projects.some((p) => p.id === created.id && p.title === "Obsidian Sun"));
    assert.ok(ws.folders.some((f) => f.path === folderPath));

    // Design workspace loads the project with all configured elements & linked assets
    const loaded = await getProject(created.id);
    assert.ok(loaded);
    assert.equal(validateBlueprint(loaded.blueprint).ok, true);
    assert.ok(loaded.blueprint.elements.some((el) => el.type === "game_background" && el.origin === "imported"));
    assert.ok(loaded.blueprint.elements.some((el) => el.type === "reel_frame" && el.origin === "imported"));
    assert.ok(loaded.blueprint.elements.some((el) => el.type === "game_title" && el.origin === "imported"));
    assert.ok(loaded.blueprint.elements.some((el) => el.type === "symbol_set"));
    assert.ok(loaded.blueprint.elements.some((el) => el.type === "symbol"));
    assert.ok(loaded.blueprint.elements.some((el) => el.type === "button_set"));
    assert.ok(loaded.blueprint.assets.some((a) => a.uri?.startsWith("/api/assets/")));
  } finally {
    await deleteProject(created.id);
    const wsAfter = await getWorkspace();
    const cleanupFolders = wsAfter.folders
      .filter((f) => f.path.startsWith(folderPath.split("/")[0]))
      .sort((a, b) => b.path.length - a.path.length);
    for (const f of cleanupFolders) {
      await deleteFolder(f.id);
    }
  }
});
