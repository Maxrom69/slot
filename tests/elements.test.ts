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

import { validateBlueprint } from "../src/lib/blueprint/validate";
import { draftToBlueprint } from "../src/lib/creation/blueprint-from-draft";
import { createDefaultDraft } from "../src/lib/creation/draft";
import { applyDesign, designDocFromBlueprint } from "../src/lib/design/migrate";
import {
  addElement,
  addSymbols,
  addVariant as addDesignVariant,
  annotateImageRevision,
  deleteElement,
  deleteSymbol,
  duplicateElement,
  duplicateSymbol as duplicateDesignSymbol,
  duplicateVariant as duplicateDesignVariant,
  editVariant as editDesignVariant,
  moveSymbolInSet,
  removeVariant as removeDesignVariant,
  restoreImageRevision,
  updateElement,
  updateSymbol,
} from "../src/lib/design/operations";
import {
  CONCEPTUAL_SYMBOL_TYPES,
  EMPTY_LIBRARY,
  SYMBOL_TYPE_LABELS,
  VALUE_TIERS_LIST,
  VALUE_TIER_LABELS,
  addVariant,
  applyLibraryToBlueprint,
  canonicalSymbolType,
  createProjectAssetProvider,
  createStandalone,
  createSymbol,
  createSymbolSet,
  duplicateStandalone,
  duplicateSymbol,
  duplicateSymbolSet,
  duplicateVariant,
  editStandalone,
  editSymbol,
  editSymbolSet,
  editVariant,
  externalAssetReference,
  isStableId,
  libraryFromBlueprint,
  membersOfSet,
  moveSymbolToSet,
  normalizeAssetReference,
  ownerOfSymbol,
  placeholderReference,
  projectAssetIdOf,
  projectAssetReference,
  removeStandalone,
  removeSymbol,
  removeSymbolSet,
  removeVariant,
  serializeAssetReference,
  validateLibrary,
} from "../src/lib/elements";

const NOW = "2026-01-01T00:00:00.000Z";
const ctx = { glyphs: ["🦅", "🏛️", "⚔️"] };

test("F07 conceptual symbol types and value tiers cover documented labels and conversions", () => {
  assert.deepEqual(CONCEPTUAL_SYMBOL_TYPES, ["characters", "ranks", "suits", "custom"]);
  assert.deepEqual(
    CONCEPTUAL_SYMBOL_TYPES.map((t) => SYMBOL_TYPE_LABELS[t]),
    ["Characters", "Deck Ranks", "Suits", "Custom"],
  );
  assert.deepEqual(VALUE_TIERS_LIST, ["high", "medium", "low", "special"]);
  assert.deepEqual(
    VALUE_TIERS_LIST.map((t) => VALUE_TIER_LABELS[t]),
    ["High", "Medium", "Low", "Special"],
  );

  assert.equal(canonicalSymbolType("character"), "characters");
  assert.equal(canonicalSymbolType("royals"), "ranks");
  assert.equal(canonicalSymbolType("suits"), "suits");
  assert.equal(canonicalSymbolType("custom"), "custom");
  assert.equal(canonicalSymbolType("seven"), "custom");
  assert.equal(canonicalSymbolType("bar"), "custom");
});

test("F07 AssetReference abstraction decouples image references from storage providers", () => {
  const projRef = projectAssetReference("asset-hero", "Hero Portrait");
  const extRef = externalAssetReference("https://cdn.example.com/reel-frame.png", "CDN Frame");
  const phRef = placeholderReference("Draft Title");

  assert.deepEqual(projRef, { provider: "project", assetId: "asset-hero", name: "Hero Portrait" });
  assert.deepEqual(extRef, {
    provider: "external",
    uri: "https://cdn.example.com/reel-frame.png",
    name: "CDN Frame",
  });
  assert.deepEqual(phRef, { provider: "placeholder", name: "Draft Title" });
  assert.equal(projectAssetReference(null), null);

  const provider = createProjectAssetProvider([
    { id: "asset-hero", uri: "/api/assets/asset-hero", state: "linked" },
    { id: "asset-draft", uri: null, state: "placeholder" },
  ]);

  assert.equal(provider.resolve(projRef), "/api/assets/asset-hero");
  assert.equal(provider.resolve(projectAssetReference("asset-draft")), null);
  assert.equal(provider.resolve(projectAssetReference("asset-missing")), null);
  assert.equal(provider.resolve(extRef), "https://cdn.example.com/reel-frame.png");
  assert.equal(provider.resolve(phRef), null);
  assert.equal(provider.resolve(null), null);

  assert.equal(projectAssetIdOf(projRef), "asset-hero");
  assert.equal(projectAssetIdOf(extRef), null);
  assert.equal(projectAssetIdOf(phRef), null);

  assert.deepEqual(normalizeAssetReference(serializeAssetReference(projRef)), projRef);
  assert.deepEqual(normalizeAssetReference(serializeAssetReference(extRef)), extRef);
  assert.deepEqual(normalizeAssetReference(serializeAssetReference(phRef)), phRef);
  assert.deepEqual(normalizeAssetReference(null, "asset-hero"), {
    provider: "project",
    assetId: "asset-hero",
    name: undefined,
  });
});

test("F07 SymbolSet & Symbol CRUD, custom variants with stable IDs, and referential integrity in ElementLibrary", () => {
  let lib = EMPTY_LIBRARY;

  // 1. Create SymbolSet with all F07 properties
  const setRes = createSymbolSet(lib, {
    name: "Imperial Characters",
    symbolType: "characters",
    valueTier: "high",
    frame: projectAssetReference("asset-gold-frame", "Gold Frame"),
    background: externalAssetReference("https://cdn.example.com/set-bg.png", "Marble BG"),
    styleGuide: "Warm Rim Light, Chiselled Gold Edges",
    description: "Primary character symbols for the base and bonus reels",
    tags: ["premium", "characters", "roman"],
  });
  lib = setRes.library;
  const setId = setRes.id;
  assert.ok(isStableId(setId));

  const set = lib.sets.find((s) => s.id === setId)!;
  assert.equal(set.name, "Imperial Characters");
  assert.equal(set.symbolType, "characters");
  assert.equal(set.valueTier, "high");
  assert.deepEqual(set.frame, { provider: "project", assetId: "asset-gold-frame", name: "Gold Frame" });
  assert.deepEqual(set.background, {
    provider: "external",
    uri: "https://cdn.example.com/set-bg.png",
    name: "Marble BG",
  });
  assert.equal(set.styleGuide, "Warm Rim Light, Chiselled Gold Edges");
  assert.equal(set.description, "Primary character symbols for the base and bonus reels");
  assert.deepEqual(set.tags, ["premium", "characters", "roman"]);

  // 2. Create member Symbols and a standalone Symbol with gameplay configuration flags
  const s1Res = createSymbol(lib, {
    name: "Centurion",
    setId,
    symbolType: "characters",
    tier: "high",
    image: projectAssetReference("asset-centurion", "Centurion.png"),
    mathId: "SYM_CENTURION_H1",
    isWild: false,
    isScatter: false,
    description: "Lead warrior symbol",
    tags: ["hero", "high"],
  });
  lib = s1Res.library;

  const s2Res = createSymbol(lib, {
    name: "Empress",
    setId,
    symbolType: "characters",
    tier: "high",
    image: externalAssetReference("https://cdn.example.com/empress.png", "Empress.png"),
    mathId: "SYM_EMPRESS_H2",
    isWild: false,
    isScatter: false,
    description: "Empress premium symbol",
    tags: ["royalty"],
  });
  lib = s2Res.library;

  const wildRes = createSymbol(lib, {
    name: "Golden Eagle Wild",
    setId: null,
    symbolType: "custom",
    tier: "special",
    image: placeholderReference("Wild Eagle"),
    mathId: "SYM_WILD_EAGLE",
    isWild: true,
    isScatter: false,
    description: "Substitutes for all non-scatter symbols",
    tags: ["special", "wild"],
  });
  lib = wildRes.library;

  // Verify symbol set shows its member symbols
  const members = membersOfSet(lib, setId);
  assert.deepEqual(members.map((m) => m.name), ["Centurion", "Empress"]);
  assert.equal(ownerOfSymbol(lib, s1Res.id)?.id, setId);
  assert.equal(ownerOfSymbol(lib, wildRes.id), null);

  // Edit symbol extras & flags (kept as configuration only)
  lib = editSymbol(lib, s1Res.id, {
    extras: { expandOnWin: true, multiplierCap: 5, animSkin: "armored" },
    isScatter: true,
  });
  const s1 = lib.symbols.find((s) => s.id === s1Res.id)!;
  assert.equal(s1.mathId, "SYM_CENTURION_H1");
  assert.equal(s1.isWild, false);
  assert.equal(s1.isScatter, true);
  assert.deepEqual(s1.extras, { expandOnWin: true, multiplierCap: 5, animSkin: "armored" });

  // 3. Add, edit, duplicate, and remove Custom Variants with independent stable IDs
  const v1Res = addVariant(lib, s1Res.id, {
    name: "Golden Armor",
    image: projectAssetReference("asset-centurion-gold", "CenturionGold.png"),
    extras: { glowIntensity: 2, bonusOnly: true },
    tags: ["gold", "bonus"],
  });
  lib = v1Res.library;
  assert.ok(isStableId(v1Res.id));
  assert.notEqual(v1Res.id, s1Res.id);

  lib = editVariant(lib, s1Res.id, v1Res.id, {
    name: "Golden Armor V2",
    extras: { glowIntensity: 3, bonusOnly: true },
  });
  const vDupRes = duplicateVariant(lib, s1Res.id, v1Res.id);
  lib = vDupRes.library;
  assert.ok(isStableId(vDupRes.id));
  assert.notEqual(vDupRes.id, v1Res.id);

  const s1WithVariants = lib.symbols.find((s) => s.id === s1Res.id)!;
  assert.equal(s1WithVariants.variants.length, 2);
  assert.equal(s1WithVariants.variants[0].name, "Golden Armor V2");
  assert.equal(s1WithVariants.variants[1].name, "Golden Armor V2 copy");
  assert.deepEqual(s1WithVariants.variants[1].tags, ["gold", "bonus"]);

  // 4. Duplicate SymbolSet and verify all cloned symbols and variants get new stable IDs and valid references
  const dupSetRes = duplicateSymbolSet(lib, setId);
  lib = dupSetRes.library;
  const dupSet = lib.sets.find((s) => s.id === dupSetRes.id)!;
  assert.notEqual(dupSet.id, setId);
  assert.equal(dupSet.symbols.length, 2);
  assert.ok(dupSet.symbols.every((id) => !set.symbols.includes(id)));

  const dupMembers = membersOfSet(lib, dupSet.id);
  assert.equal(dupMembers.length, 2);
  assert.ok(dupMembers.every((m) => m.symbolSetId === dupSet.id));
  assert.equal(dupMembers[0].variants.length, 2);
  assert.ok(
    dupMembers[0].variants.every(
      (v) => isStableId(v.id) && !s1WithVariants.variants.some((origV) => origV.id === v.id),
    ),
  );
  assert.deepEqual(validateLibrary(lib), []);

  // 5. Move symbol between sets and remove duplicated set
  lib = moveSymbolToSet(lib, wildRes.id, dupSet.id);
  assert.equal(ownerOfSymbol(lib, wildRes.id)?.id, dupSet.id);
  lib = moveSymbolToSet(lib, wildRes.id, null);
  assert.equal(ownerOfSymbol(lib, wildRes.id), null);

  lib = removeVariant(lib, s1Res.id, vDupRes.id);
  assert.equal(lib.symbols.find((s) => s.id === s1Res.id)?.variants.length, 1);

  lib = removeSymbolSet(lib, dupSet.id);
  assert.equal(lib.sets.some((s) => s.id === dupSet.id), false);
  assert.ok(dupSet.symbols.every((sid) => !lib.symbols.some((s) => s.id === sid)));
  assert.deepEqual(validateLibrary(lib), []);

  // Remove a single member symbol and verify set membership updates cleanly
  lib = removeSymbol(lib, s2Res.id);
  assert.deepEqual(membersOfSet(lib, setId).map((m) => m.id), [s1Res.id]);
  assert.deepEqual(validateLibrary(lib), []);
});

test("F07 Standalone Elements (GameTitle, GameBackground, ReelFrame, ButtonSet, UploadedElement, CustomElement) support CRUD, metadata, and AssetReference", () => {
  let lib = EMPTY_LIBRARY;

  const kinds = [
    "game-title",
    "game-background",
    "reel-frame",
    "button-set",
    "uploaded",
    "custom",
  ] as const;

  const createdIds: Record<(typeof kinds)[number], string> = {} as never;
  for (const kind of kinds) {
    const res = createStandalone(lib, kind, {
      name: `Test ${kind}`,
      description: `Description for ${kind}`,
      tags: [kind, "f07"],
      image: projectAssetReference(`asset-${kind}`, `${kind}.png`),
      group: `Group ${kind}`,
    });
    lib = res.library;
    createdIds[kind] = res.id;
    assert.ok(isStableId(res.id));
  }

  assert.equal(lib.standalone.length, 6);

  // Edit standalone metadata, image reference, and type-specific properties
  lib = editStandalone(lib, createdIds["game-background"], {
    name: "Colosseum Night Sky",
    description: "21:9 widescreen amphitheatre backdrop",
    tags: ["background", "night"],
    aspect: "21:9",
    image: externalAssetReference("https://cdn.example.com/night.jpg", "night.jpg"),
  });
  lib = editStandalone(lib, createdIds["reel-frame"], {
    style: "Ornate Gold",
  });
  lib = editStandalone(lib, createdIds["button-set"], {
    buttons: ["spin", "autoplay", "turbo", "bet"],
  });
  lib = editStandalone(lib, createdIds["custom"], {
    group: "VFX Overlays",
    params: { particleCount: 40, additiveBlend: true, shaderPreset: "sparks" },
  });

  const bg = lib.standalone.find((e) => e.id === createdIds["game-background"])!;
  assert.equal(bg.kind, "game-background");
  assert.equal(bg.name, "Colosseum Night Sky");
  assert.equal(bg.aspect, "21:9");
  assert.equal(bg.image?.provider, "external");

  const custom = lib.standalone.find((e) => e.id === createdIds["custom"])!;
  assert.equal(custom.kind, "custom");
  assert.deepEqual(custom.params, {
    particleCount: 40,
    additiveBlend: true,
    shaderPreset: "sparks",
  });

  // Duplicate and remove standalone elements
  const dupCustom = duplicateStandalone(lib, createdIds["custom"]);
  lib = dupCustom.library;
  assert.notEqual(dupCustom.id, createdIds["custom"]);
  assert.equal(lib.standalone.length, 7);
  assert.deepEqual(validateLibrary(lib), []);

  lib = removeStandalone(lib, dupCustom.id);
  assert.equal(lib.standalone.length, 6);
  assert.deepEqual(validateLibrary(lib), []);
});

test("F07 DesignDoc & GameBlueprint integration: SetEditor/SymbolEditor operations, image revisions, and lossless adapter round-trip", async () => {
  const { createProject, deleteProject, getProject } = await import("../src/server/workspace-service");
  const { saveDesign } = await import("../src/server/design-service");

  const project = await createProject({
    title: "F07 Element System Verification",
    theme: "Roman Empire",
  });

  try {
    let doc = designDocFromBlueprint(project.blueprint);

    // 1. Add a SymbolSet with Special valueTier and Characters symbolType, plus UploadedElement and CustomElement
    const charSet = addElement(
      doc,
      {
        type: "symbol_set",
        name: "Gladiator Heroes",
        symbolType: "character",
        valueTier: "high",
        count: 2,
        styleGuide: "Painted bronze armour with crimson capes",
        description: "Heroic character set",
        tags: ["characters", "heroes"],
      },
      ctx,
    );
    doc = charSet.doc;

    const uploadedEl = addElement(
      doc,
      { type: "uploaded", name: "Marble Pillar Overlay", group: "Foreground Props" },
      ctx,
    );
    doc = uploadedEl.doc;

    const customEl = addElement(
      doc,
      { type: "custom", name: "Jackpot Meter Widget", group: "HUD Widgets" },
      ctx,
    );
    doc = customEl.doc;

    // 2. Edit SymbolSet frame, background, styleGuide, description, tags
    doc = updateElement(doc, charSet.id, {
      symbolSet: {
        frame: externalAssetReference("https://cdn.example.com/gladiator-frame.png", "Gladiator Frame"),
        background: placeholderReference("Arena Sand BG"),
        styleGuide: "Updated bronze & gold trim",
        description: "Updated heroic character set",
        tags: ["characters", "heroes", "arena"],
      },
    });

    // 3. Edit a member Symbol's F07 properties (image, mathId, isWild, isScatter, extras, variants, imageHistory)
    const setEl = doc.elements.find((e) => e.id === charSet.id)!;
    const symId = setEl.symbolIds[0];
    doc = updateSymbol(doc, symId, {
      name: "Spartacus",
      mathId: "MATH_SPARTACUS_01",
      isWild: true,
      isScatter: false,
      extras: { stackedHeight: 3, introVoiceover: "spartacus_roar" },
      description: "Expanding hero symbol",
      tags: ["hero", "expanding"],
    });
    doc = updateSymbol(doc, symId, {
      image: externalAssetReference("https://cdn.example.com/spartacus-v1.png", "Spartacus v1"),
      imageNotes: "Initial concept art",
    });
    doc = updateSymbol(doc, symId, {
      image: externalAssetReference("https://cdn.example.com/spartacus-v2.png", "Spartacus v2"),
      imageNotes: "Final polished render",
    });

    const symAfterImg = doc.symbols.find((s) => s.id === symId)!;
    assert.equal(symAfterImg.imageHistory?.length, 2);
    const firstRevId = symAfterImg.imageHistory![1].id;
    doc = annotateImageRevision(doc, symId, firstRevId, "Annotated v1 revision");
    doc = restoreImageRevision(doc, symId, firstRevId);
    assert.equal(doc.symbols.find((s) => s.id === symId)?.image?.uri, "https://cdn.example.com/spartacus-v1.png");

    // 4. Add, edit, duplicate, and remove custom variants on the symbol in DesignDoc
    const vAdded = addDesignVariant(doc, symId, {
      name: "Blood Moon Variant",
      image: externalAssetReference("https://cdn.example.com/spartacus-moon.png", "Spartacus Moon"),
      extras: { freeSpinsOnly: true, multiplier: 2 },
      tags: ["freespins"],
    });
    doc = vAdded.doc;
    doc = editDesignVariant(doc, symId, vAdded.id, { name: "Crimson Moon Variant" });
    const vDup = duplicateDesignVariant(doc, symId, vAdded.id);
    doc = vDup.doc;
    assert.equal(doc.symbols.find((s) => s.id === symId)?.variants?.length, 2);
    doc = removeDesignVariant(doc, symId, vDup.id);
    assert.equal(doc.symbols.find((s) => s.id === symId)?.variants?.length, 1);

    // 5. Reorder symbols in set and duplicate symbol in set
    doc = moveSymbolInSet(doc, charSet.id, symId, 1);
    assert.equal(doc.elements.find((e) => e.id === charSet.id)?.symbolIds[1], symId);
    const symDup = duplicateDesignSymbol(doc, symId)!;
    doc = symDup.doc;
    assert.equal(doc.elements.find((e) => e.id === charSet.id)?.symbolIds.length, 3);

    // 6. Verify adapter round-trip (Blueprint -> ElementLibrary -> Blueprint) and Blueprint validation
    const updatedBp = applyDesign(project.blueprint, doc);
    assert.deepEqual(validateBlueprint(updatedBp).integrityIssues, []);

    const lib = libraryFromBlueprint(updatedBp);
    assert.deepEqual(validateLibrary(lib), []);
    const libSet = lib.sets.find((s) => s.id === charSet.id)!;
    assert.equal(libSet.symbolType, "characters");
    assert.equal(libSet.styleGuide, "Updated bronze & gold trim");
    assert.deepEqual(libSet.tags, ["characters", "heroes", "arena"]);
    assert.equal(lib.standalone.some((e) => e.id === uploadedEl.id && e.kind === "uploaded"), true);
    assert.equal(lib.standalone.some((e) => e.id === customEl.id && e.kind === "custom"), true);

    const roundTrippedBp = applyLibraryToBlueprint(updatedBp, lib);
    assert.deepEqual(validateBlueprint(roundTrippedBp).integrityIssues, []);

    // 7. Save via design-service and reload from persistence
    const saved = await saveDesign(project.id, {
      baseRevision: project.revision,
      doc,
    });
    assert.ok(saved.revision > project.revision);

    const reloaded = await getProject(project.id);
    assert.ok(reloaded);
    const reloadedSym = reloaded.blueprint.symbols.find((s) => s.id === symId)!;
    assert.equal(reloadedSym.name, "Spartacus");
    assert.equal(reloadedSym.mathId, "MATH_SPARTACUS_01");
    assert.equal(reloadedSym.isWild, true);
    assert.equal(reloadedSym.symbolSetId, charSet.id);
    assert.equal(reloadedSym.variants?.length, 1);
    assert.equal(reloadedSym.variants?.[0].name, "Crimson Moon Variant");
  } finally {
    await deleteProject(project.id);
  }
});
