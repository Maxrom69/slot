/**
 * F09 — Symbol Editor verification suite.
 *
 * Verifies:
 *  1. Symbol Metadata (Name, ID stability, Description, Type, Tier, Symbol Family).
 *  2. Role Flags (Wild, Scatter, Bonus, Regular) as configuration flags only, plus payout/reel configuration.
 *  3. Artwork Management (upload replacement, choose existing asset, clear artwork, restore previous asset)
 *     without destroying previous asset references.
 *  4. Image History revisions (id, asset reference, createdAt, source, notes), annotation, and restoration
 *     to any previous version.
 *  5. Variant Management (create, rename, variant artwork, duplicate with new stable ID, remove) and
 *     Extensible Extras (Split, Expansion, Hover, Animation, Custom Extra).
 *  6. Math Metadata (mathId, code, glyph, tags) and end-to-end persistence via workspace-service / design-service
 *     + ElementLibrary adapter round-trip.
 */

import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";

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

import { EXTRA_PRESETS } from "../src/components/design/ElementFields";
import type { AssetRef } from "../src/lib/blueprint/types";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { draftToBlueprint } from "../src/lib/creation/blueprint-from-draft";
import { createDefaultDraft } from "../src/lib/creation/draft";
import { applyDesign, designDocFromBlueprint, migrateDoc } from "../src/lib/design/migrate";
import {
  addVariant,
  annotateImageRevision,
  clearSymbolArtwork,
  createNamedVariants,
  duplicateVariant,
  editVariant,
  findPreviousImageRevision,
  removeVariant,
  renameSymbol,
  replaceSymbolArtwork,
  restoreImageRevision,
  restorePreviousImageRevision,
  sameAssetRef,
  updateSymbol,
} from "../src/lib/design/operations";
import { parseDesignDoc } from "../src/lib/design/parse";
import { applyLibraryToBlueprint, libraryFromBlueprint } from "../src/lib/elements";

const NOW = "2026-01-01T00:00:00.000Z";

function makeAsset(id: string, name = `Art ${id}`): AssetRef {
  return {
    id,
    name,
    kind: "image",
    uri: `/api/assets/${id}`,
    mime: "image/png",
    width: 512,
    height: 512,
    state: "linked",
    tags: [],
  };
}

function createSampleDoc() {
  const bp = draftToBlueprint(
    { ...createDefaultDraft(), title: "Sun Temple", theme: "Aztec Sun Temple" },
    { id: "f09-test-project", now: NOW },
  );
  const doc = migrateDoc(designDocFromBlueprint(bp));
  return { bp, doc };
}

test("F09 Metadata & Math Metadata: edits Name, preserves stable ID, updates Description, Type, Tier, Symbol Family, Math ID, Code, Glyph, and Tags", () => {
  const { doc: initial } = createSampleDoc();
  let doc = initial;
  const target = doc.symbols.find((s) => s.tier !== "special")!;
  const stableId = target.id;

  doc = renameSymbol(doc, stableId, "Golden Jaguar");
  doc = updateSymbol(doc, stableId, {
    description: "Apex temple guardian symbol",
    symbolType: "character",
    tier: "high",
    family: "temple-guardians",
    mathId: "MATH_JAGUAR_HIGH_01",
    code: "JAG1",
    glyph: "🐆",
    tags: ["guardian", "high-pay", "aztec"],
  });

  const updated = doc.symbols.find((s) => s.id === stableId)!;
  assert.equal(updated.id, stableId, "Symbol ID remains stable after rename and metadata edits");
  assert.equal(updated.name, "Golden Jaguar");
  assert.equal(updated.description, "Apex temple guardian symbol");
  assert.equal(updated.symbolType, "character");
  assert.equal(updated.tier, "high");
  assert.equal(updated.family, "temple-guardians");
  assert.equal(updated.mathId, "MATH_JAGUAR_HIGH_01");
  assert.equal(updated.code, "JAG1");
  assert.equal(updated.glyph, "🐆");
  assert.deepEqual(updated.tags, ["guardian", "high-pay", "aztec"]);
});

test("F09 Role Flags & Symbol Configuration: toggles Wild, Scatter, Bonus, and Regular configuration flags and syncs payout/reel configuration", () => {
  const { doc: initial } = createSampleDoc();
  let doc = initial;
  const symId = doc.symbols[0].id;

  // Wild role preset
  doc = updateSymbol(doc, symId, { isWild: true, isScatter: false, isBonus: false });
  let sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.isWild, true);
  assert.equal(sym.isScatter, false);
  assert.equal(sym.isBonus, false);

  // Scatter role preset
  doc = updateSymbol(doc, symId, { isWild: false, isScatter: true, isBonus: false });
  sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.isWild, false);
  assert.equal(sym.isScatter, true);
  assert.equal(sym.isBonus, false);

  // Bonus role preset
  doc = updateSymbol(doc, symId, { isWild: false, isScatter: false, isBonus: true });
  sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.isWild, false);
  assert.equal(sym.isScatter, false);
  assert.equal(sym.isBonus, true);

  // Regular role preset (clears special role flags)
  doc = updateSymbol(doc, symId, { isWild: false, isScatter: false, isBonus: false });
  sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.isWild, false);
  assert.equal(sym.isScatter, false);
  assert.equal(sym.isBonus, false);

  // Payout and reelWeight configuration
  doc = updateSymbol(doc, symId, {
    payouts: { "3": 15, "4": 60, "5": 250 },
    reelWeight: 7,
  });
  sym = doc.symbols.find((s) => s.id === symId)!;
  assert.deepEqual(sym.payouts, { "3": 15, "4": 60, "5": 250 });
  assert.equal(sym.reelWeight, 7);
  const payRow5 = doc.paytable.find((r) => r.symbolId === symId && r.ofAKind === 5);
  assert.equal(payRow5?.payout, 250, "Paytable row stays synchronized with symbol payout configuration");
});

test("F09 Artwork & Image History: upload replacement, choose existing asset, clear artwork, and restore previous asset preserve all prior references", () => {
  const { bp, doc: initial } = createSampleDoc();
  let doc = initial;
  const symId = doc.symbols[0].id;

  // Seed symbol with an initial asset BEFORE any history exists (simulating pre-existing symbol art)
  const initialAsset = makeAsset("asset-initial", "Sun Idol v0.png");
  doc = {
    ...doc,
    assets: [...doc.assets, initialAsset],
    symbols: doc.symbols.map((s) =>
      s.id === symId
        ? { ...s, assetId: initialAsset.id, image: { provider: "project", assetId: initialAsset.id, name: initialAsset.name }, imageHistory: [] }
        : s,
    ),
  };

  // 1. Upload replacement artwork (v1)
  const uploadedV1 = makeAsset("asset-upload-v1", "Sun Idol v1.png");
  doc = replaceSymbolArtwork(doc, symId, uploadedV1, {
    source: "upload",
    notes: "Uploaded painted v1 replacement",
  });

  let sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.image?.assetId, "asset-upload-v1");
  assert.equal(sym.imageHistory?.length, 2, "Both initial artwork and uploaded v1 are recorded in imageHistory");
  assert.equal(sym.imageHistory![0].asset?.assetId, "asset-upload-v1");
  assert.equal(sym.imageHistory![0].source, "upload");
  assert.equal(sym.imageHistory![0].notes, "Uploaded painted v1 replacement");
  assert.ok(sym.imageHistory![0].id && sym.imageHistory![0].createdAt);
  assert.equal(sym.imageHistory![1].asset?.assetId, "asset-initial", "Initial asset was preserved as baseline revision");
  assert.ok(doc.assets.some((a) => a.id === "asset-initial"), "Initial asset is NOT destroyed in doc.assets");
  assert.ok(doc.assets.some((a) => a.id === "asset-upload-v1"), "Uploaded v1 asset is stored in doc.assets");

  // 2. Choose existing asset (v2)
  const existingV2 = makeAsset("asset-existing-v2", "Sun Idol Gold v2.png");
  doc = { ...doc, assets: [...doc.assets, existingV2] };
  doc = replaceSymbolArtwork(
    doc,
    symId,
    { provider: "project", assetId: existingV2.id, name: existingV2.name },
    { source: "upload", notes: "Switched to existing Gold v2 asset" },
  );

  sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.image?.assetId, "asset-existing-v2");
  assert.equal(sym.imageHistory?.length, 3);
  assert.ok(doc.assets.some((a) => a.id === "asset-initial"));
  assert.ok(doc.assets.some((a) => a.id === "asset-upload-v1"));
  assert.ok(doc.assets.some((a) => a.id === "asset-existing-v2"));

  // 3. Clear artwork
  doc = clearSymbolArtwork(doc, symId, "Temporarily cleared for review");
  sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.image, null);
  assert.equal(sym.assetId, null);
  assert.equal(sym.imageHistory?.length, 4);
  assert.equal(sym.imageHistory![0].asset, null);
  assert.equal(sym.imageHistory![0].notes, "Temporarily cleared for review");
  // Previous assets remain intact!
  assert.ok(doc.assets.some((a) => a.id === "asset-initial"), "asset-initial preserved after clear");
  assert.ok(doc.assets.some((a) => a.id === "asset-upload-v1"), "asset-upload-v1 preserved after clear");
  assert.ok(doc.assets.some((a) => a.id === "asset-existing-v2"), "asset-existing-v2 preserved after clear");

  // 4. Restore previous asset (from cleared -> returns to v2)
  const prevBeforeRestore = findPreviousImageRevision(sym);
  assert.ok(prevBeforeRestore);
  assert.equal(prevBeforeRestore.asset?.assetId, "asset-existing-v2");
  doc = restorePreviousImageRevision(doc, symId, "Restored v2 after review");
  sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.image?.assetId, "asset-existing-v2");
  assert.equal(sym.imageHistory![0].source, "restore");
  assert.equal(sym.imageHistory![0].notes, "Restored v2 after review");

  // 5. Restore specific earlier revision (v0 initial asset) and annotate revision notes
  const initialRev = sym.imageHistory!.find((r) => r.asset?.assetId === "asset-initial")!;
  doc = annotateImageRevision(doc, symId, initialRev.id, "Original concept art v0");
  assert.equal(
    doc.symbols.find((s) => s.id === symId)!.imageHistory!.find((r) => r.id === initialRev.id)?.notes,
    "Original concept art v0",
  );

  doc = restoreImageRevision(doc, symId, initialRev.id, "Reverted all the way to initial v0");
  sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.image?.assetId, "asset-initial");
  assert.equal(sym.imageHistory![0].source, "restore");
  assert.equal(sym.imageHistory![0].notes, "Reverted all the way to initial v0");

  // Verify sameAssetRef across cloned/serialized references
  assert.equal(
    sameAssetRef(sym.image, JSON.parse(JSON.stringify(sym.image))),
    true,
    "sameAssetRef matches across JSON serialization boundaries",
  );

  // Blueprint validation passes with all historical revisions
  const mergedBp = applyDesign(bp, doc);
  const report = validateBlueprint(mergedBp);
  assert.equal(report.integrityOk, true);
});

test("F09 Variants & Extras: supports Split, Expansion, Hover, Animation, Custom Extra presets and variant artwork/duplication", () => {
  const { doc: initial } = createSampleDoc();
  let doc = initial;
  const symId = doc.symbols[0].id;

  // Verify all 5 documented extra presets exist in EXTRA_PRESETS
  const presetLabels = EXTRA_PRESETS.map((p) => p.label);
  assert.deepEqual(presetLabels, ["Split", "Expansion", "Hover", "Animation", "Custom Extra"]);

  const extrasPayload: Record<string, string | number | boolean> = {
    Split: true,
    Expansion: "full_reel",
    Hover: "highlight",
    Animation: "idle_loop",
    Custom_Extra: "2x_multiplier_glow",
    MaxSplitCount: 4,
  };
  doc = updateSymbol(doc, symId, { extras: extrasPayload });
  assert.deepEqual(doc.symbols.find((s) => s.id === symId)?.extras, extrasPayload);

  // Variants: create named variants, assign variant artwork, duplicate, and remove
  doc = renameSymbol(doc, symId, "Sun Disk");
  const named = createNamedVariants(doc, symId, ["Collect", "Major", "Mini"]);
  doc = named.doc;
  assert.equal(named.ids.length, 3);

  const varAsset = makeAsset("asset-var-collect", "Sun Disk Collect.png");
  doc = { ...doc, assets: [...doc.assets, varAsset] };
  doc = editVariant(doc, symId, named.ids[0], {
    image: { provider: "project", assetId: varAsset.id, name: varAsset.name },
    extras: { Split: false, collectorValue: 10 },
    tags: ["collect"],
  });

  const dup = duplicateVariant(doc, symId, named.ids[0]);
  doc = dup.doc;
  assert.notEqual(dup.id, named.ids[0], "Duplicated variant gets a new independent stable ID");

  const sym = doc.symbols.find((s) => s.id === symId)!;
  assert.equal(sym.variants?.length, 4);
  assert.equal(sym.variants![0].image?.assetId, "asset-var-collect");
  assert.equal(sym.variants![3].image?.assetId, "asset-var-collect");

  doc = removeVariant(doc, symId, dup.id);
  assert.equal(doc.symbols.find((s) => s.id === symId)?.variants?.length, 3);
});

test("F09 Persistence & Adapter Round-Trip: symbol changes, role flags, extras, variants, and image history persist through design-service and ElementLibrary", async () => {
  const { createProject, deleteProject, getProject } = await import("../src/server/workspace-service");
  const { saveDesign, uploadAsset } = await import("../src/server/design-service");

  const project = await createProject({
    title: "F09 Symbol Editor Persistence Test",
    theme: "Aztec Sun Temple",
  });

  try {
    let doc = designDocFromBlueprint(project.blueprint);
    const symId = doc.symbols[0].id;

    const svg1 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" fill="#f59e0b"/></svg>`;
    const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" fill="#10b981"/></svg>`;
    const up1 = await uploadAsset(project.id, {
      name: "Temple Mask v1.svg",
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg1).toString("base64")}`,
    });
    const up2 = await uploadAsset(project.id, {
      name: "Temple Mask v2.svg",
      dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg2).toString("base64")}`,
    });

    doc = replaceSymbolArtwork(doc, symId, up1.asset, { source: "upload", notes: "First upload" });
    doc = replaceSymbolArtwork(doc, symId, up2.asset, { source: "upload", notes: "Second upload" });
    doc = restorePreviousImageRevision(doc, symId, "Restored v1");

    doc = updateSymbol(doc, symId, {
      name: "Temple Mask",
      description: "Sacred golden mask",
      symbolType: "character",
      tier: "high",
      family: "sacred-masks",
      isWild: false,
      isScatter: false,
      isBonus: true,
      extras: {
        Split: true,
        Expansion: "full_reel",
        Hover: "gold_shimmer",
        Animation: "mask_awaken",
        Custom_Extra: "bonus_trigger",
      },
      mathId: "MATH_MASK_BONUS",
      code: "MASK",
      glyph: "🎭",
      tags: ["mask", "bonus"],
    });

    const vRes = addVariant(doc, symId, {
      name: "Temple Mask — Awakened",
      extras: { Animation: "awakened_loop" },
      tags: ["awakened"],
    });
    doc = vRes.doc;

    // Verify parseDesignDoc accepts all F09 fields
    const parsed = parseDesignDoc(JSON.parse(JSON.stringify(doc)));
    assert.equal(parsed.ok, true);

    // Save to DB via saveDesign
    await saveDesign(project.id, {
      baseRevision: project.revision,
      doc,
    });

    // Reload from DB and verify persistence
    const reloaded = await getProject(project.id);
    assert.ok(reloaded);
    assert.equal(validateBlueprint(reloaded.blueprint).integrityOk, true);
    const persistedSym = reloaded.blueprint.symbols.find((s) => s.id === symId)!;
    assert.equal(persistedSym.name, "Temple Mask");
    assert.equal(persistedSym.description, "Sacred golden mask");
    assert.equal(persistedSym.symbolType, "character");
    assert.equal(persistedSym.tier, "high");
    assert.equal(persistedSym.family, "sacred-masks");
    assert.equal(persistedSym.isBonus, true);
    assert.equal(persistedSym.mathId, "MATH_MASK_BONUS");
    assert.equal(persistedSym.code, "MASK");
    assert.equal(persistedSym.glyph, "🎭");
    assert.deepEqual(persistedSym.tags, ["mask", "bonus"]);
    assert.equal(persistedSym.extras?.Split, true);
    assert.equal(persistedSym.extras?.Expansion, "full_reel");
    assert.equal(persistedSym.extras?.Hover, "gold_shimmer");
    assert.equal(persistedSym.extras?.Animation, "mask_awaken");
    assert.equal(persistedSym.extras?.Custom_Extra, "bonus_trigger");
    assert.equal(persistedSym.variants?.length, 1);
    assert.equal(persistedSym.variants![0].id, vRes.id);
    assert.equal(persistedSym.image?.assetId, up1.asset.id);
    assert.equal(persistedSym.imageHistory?.length, 3);
    assert.equal(persistedSym.imageHistory![0].source, "restore");
    assert.equal(persistedSym.imageHistory![0].notes, "Restored v1");
    assert.ok(reloaded.blueprint.assets.some((a) => a.id === up1.asset.id), "up1 asset preserved in blueprint");
    assert.ok(reloaded.blueprint.assets.some((a) => a.id === up2.asset.id), "up2 asset preserved in blueprint (not destroyed)");

    // Verify ElementLibrary adapter lossless round-trip preserves family, isBonus, and imageHistory
    const lib = libraryFromBlueprint(reloaded.blueprint);
    const roundTripped = applyLibraryToBlueprint(reloaded.blueprint, lib);
    const rtSym = roundTripped.symbols.find((s) => s.id === symId)!;
    assert.equal(rtSym.family, "sacred-masks");
    assert.equal(rtSym.isBonus, true);
    assert.equal(rtSym.imageHistory?.length, 3);
  } finally {
    await deleteProject(project.id);
  }
});
