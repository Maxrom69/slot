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
  addVariant,
  createNamedVariants,
  deleteSymbol,
  duplicateSymbol,
  duplicateVariant,
  editVariant,
  moveSymbolInSet,
  removeVariant,
  renameElement,
  renameSymbol,
  symbolDeletionImpact,
  updateElement,
  updateSymbol,
} from "../src/lib/design/operations";
import {
  findElement,
  findSymbol,
  findVariant,
  membersOf,
  selectSets,
  symbolImage,
} from "../src/lib/design/selectors";
import {
  externalAssetReference,
  findVariantInLibrary,
  isStableId,
  libraryFromBlueprint,
  placeholderReference,
  projectAssetReference,
} from "../src/lib/elements";

const NOW = "2026-01-01T00:00:00.000Z";
const ctx = { glyphs: ["☀️", "🏛️", "🦅", "🏺"] };

test("F08 Set Header & Set Configuration: name, type, tier, symbol count, style guide, frame, and background", () => {
  const bp = draftToBlueprint(
    { ...createDefaultDraft(), title: "Solar Empire", theme: "Ancient Sun Temple" },
    { id: "f08-header-test", now: NOW },
  );
  let doc = designDocFromBlueprint(bp);

  const created = addElement(
    doc,
    {
      type: "symbol_set",
      name: "Solar Relics",
      symbolType: "character",
      valueTier: "high",
      count: 3,
      styleGuide: "Hammered gold leaf with turquoise inlay",
      description: "High-tier temple artifacts",
      tags: ["solar", "high"],
    },
    ctx,
  );
  doc = created.doc;
  const setId = created.id;

  doc = renameElement(doc, setId, "Imperial Solar Relics");
  doc = updateElement(doc, setId, {
    symbolSet: {
      symbolType: "custom",
      valueTier: "high",
      styleGuide: "Polished obsidian and sunlit gold",
      description: "Updated temple relic set",
      frame: externalAssetReference("https://cdn.example.com/solar-frame.png", "Solar Frame"),
      background: placeholderReference("Temple Altar Backdrop"),
      tags: ["solar", "relics", "obsidian"],
    },
  });

  const set = findElement(doc, setId)!;
  const members = membersOf(doc, set);
  assert.equal(set.name, "Imperial Solar Relics");
  assert.equal(set.symbolSet?.symbolType, "custom");
  assert.equal(set.symbolSet?.valueTier, "high");
  assert.equal(members.length, 3);
  assert.equal(set.symbolSet?.styleGuide, "Polished obsidian and sunlit gold");
  assert.deepEqual(set.symbolSet?.frame, {
    provider: "external",
    uri: "https://cdn.example.com/solar-frame.png",
    name: "Solar Frame",
  });
  assert.deepEqual(set.symbolSet?.background, {
    provider: "placeholder",
    name: "Temple Altar Backdrop",
  });
  assert.deepEqual(set.symbolSet?.tags, ["solar", "relics", "obsidian"]);
});

test("F08 Symbol Grid operations & Stable IDs: add, rename, duplicate, reorder, delete, and never use display names as primary IDs", () => {
  const bp = draftToBlueprint(
    { ...createDefaultDraft(), title: "Solar Empire", theme: "Ancient Sun Temple" },
    { id: "f08-grid-test", now: NOW },
  );
  let doc = designDocFromBlueprint(bp);
  const set = doc.elements.find((e) => e.type === "symbol_set" && e.symbolSet?.valueTier === "high")!;
  const initialCount = set.symbolIds.length;

  // 1. Add symbol
  const added = addSymbols(doc, set.id, [{ name: "Sun Disk" }], ctx);
  doc = added.doc;
  const sunDiskId = added.ids[0];
  assert.ok(isStableId(sunDiskId));
  assert.notEqual(sunDiskId, "Sun Disk", "Primary ID is a generated stable ID, never the display name");
  assert.equal(membersOf(doc, findElement(doc, set.id)!).length, initialCount + 1);

  // 2. Rename symbol — stable ID must not change
  doc = renameSymbol(doc, sunDiskId, "Golden Sun Disk");
  const renamed = doc.symbols.find((s) => s.id === sunDiskId)!;
  assert.equal(renamed.id, sunDiskId, "Stable ID remains identical after rename");
  assert.equal(renamed.name, "Golden Sun Disk");

  // 3. Reorder symbol within set
  const orderBefore = [...findElement(doc, set.id)!.symbolIds];
  const lastIdx = orderBefore.indexOf(sunDiskId);
  assert.equal(lastIdx, orderBefore.length - 1);
  doc = moveSymbolInSet(doc, set.id, sunDiskId, -1);
  const orderAfterUp = findElement(doc, set.id)!.symbolIds;
  assert.equal(orderAfterUp.indexOf(sunDiskId), lastIdx - 1);
  doc = moveSymbolInSet(doc, set.id, sunDiskId, 1);
  assert.equal(findElement(doc, set.id)!.symbolIds.indexOf(sunDiskId), lastIdx);

  // 4. Duplicate symbol — receives a new stable ID while keeping original intact
  const dup = duplicateSymbol(doc, sunDiskId)!;
  doc = dup.doc;
  assert.ok(isStableId(dup.id));
  assert.notEqual(dup.id, sunDiskId);
  const dupSymbol = doc.symbols.find((s) => s.id === dup.id)!;
  assert.equal(dupSymbol.name, "Golden Sun Disk copy");
  assert.equal(dupSymbol.symbolSetId, set.id);
  assert.ok(findElement(doc, set.id)!.symbolIds.includes(dup.id));

  // 5. Delete duplicated symbol
  doc = deleteSymbol(doc, dup.id);
  assert.equal(doc.symbols.some((s) => s.id === dup.id), false);
  assert.equal(findElement(doc, set.id)!.symbolIds.includes(dup.id), false);
});

test("F08 Custom Variants & Sun Disk Variant Example: Sun Disk — Collect, Sun Disk — Major, Sun Disk — Mini are independently addressable", () => {
  const bp = draftToBlueprint(
    { ...createDefaultDraft(), title: "Sun Disk Feature", theme: "Solar Hold & Win" },
    { id: "f08-variants-test", now: NOW },
  );
  let doc = designDocFromBlueprint(bp);
  const set = doc.elements.find((e) => e.type === "symbol_set" && e.symbolSet?.valueTier === "high")!;

  const added = addSymbols(doc, set.id, [{ name: "Sun Disk" }], ctx);
  doc = added.doc;
  const sunDiskId = added.ids[0];

  // Create the documented Sun Disk variants: Collect, Major, Mini
  const createdVariants = createNamedVariants(doc, sunDiskId, ["Collect", "Major", "Mini"]);
  doc = createdVariants.doc;
  const [collectId, majorId, miniId] = createdVariants.ids;

  assert.equal(createdVariants.ids.length, 3);
  assert.equal(new Set([sunDiskId, collectId, majorId, miniId]).size, 4, "Base symbol and all 3 variants have distinct stable IDs");

  // Verify each variant is independently addressable in DesignDoc
  const collectResolved = findVariant(doc, collectId);
  const majorResolved = findVariant(doc, majorId);
  const miniResolved = findVariant(doc, miniId);

  assert.ok(collectResolved);
  assert.ok(majorResolved);
  assert.ok(miniResolved);
  assert.equal(collectResolved.variant.name, "Sun Disk — Collect");
  assert.equal(majorResolved.variant.name, "Sun Disk — Major");
  assert.equal(miniResolved.variant.name, "Sun Disk — Mini");
  assert.equal(collectResolved.symbol.id, sunDiskId);
  assert.equal(collectResolved.owner?.id, set.id);

  // Verify each variant is also independently addressable in ElementLibrary
  const lib = libraryFromBlueprint(applyDesign(bp, doc));
  assert.equal(findVariantInLibrary(lib, collectId)?.variant.name, "Sun Disk — Collect");
  assert.equal(findVariantInLibrary(lib, majorId)?.variant.name, "Sun Disk — Major");
  assert.equal(findVariantInLibrary(lib, miniId)?.variant.name, "Sun Disk — Mini");

  // Rename, duplicate, and delete variant
  doc = editVariant(doc, sunDiskId, miniId, { name: "Sun Disk — Mini Jackpot" });
  assert.equal(findVariant(doc, miniId)?.variant.name, "Sun Disk — Mini Jackpot");

  const dupMajor = duplicateVariant(doc, sunDiskId, majorId);
  doc = dupMajor.doc;
  assert.ok(isStableId(dupMajor.id));
  assert.notEqual(dupMajor.id, majorId);
  assert.equal(findVariant(doc, dupMajor.id)?.variant.name, "Sun Disk — Major copy");

  doc = removeVariant(doc, sunDiskId, dupMajor.id);
  assert.equal(findVariant(doc, dupMajor.id), null);
  assert.equal(doc.symbols.find((s) => s.id === sunDiskId)?.variants?.length, 3);
});

test("F08 Acceptance: editing a symbol updates every view referencing it, and deleting symbols reports reel/paytable dependency warnings", async () => {
  const { createProject, deleteProject, getProject } = await import("../src/server/workspace-service");
  const { saveDesign } = await import("../src/server/design-service");

  const project = await createProject({
    title: "F08 Acceptance Project",
    theme: "Roman Empire",
  });

  try {
    let doc = designDocFromBlueprint(project.blueprint);
    const highSet = doc.elements.find((e) => e.type === "symbol_set" && e.symbolSet?.valueTier === "high")!;
    const targetSymbolId = highSet.symbolIds[0];

    // 1. Edit symbol name, tier, Wild/Scatter badges, external image, and add a variant
    doc = updateSymbol(doc, targetSymbolId, {
      name: "Sun Disk",
      tier: "high",
      isWild: true,
      isScatter: true,
      mathId: "SYM_SUN_DISK",
      image: externalAssetReference("https://cdn.example.com/sun-disk.png", "SunDisk.png"),
      description: "Primary solar collector symbol",
      tags: ["solar", "collector"],
    });
    const varRes = addVariant(doc, targetSymbolId, { name: "Sun Disk — Collect" });
    doc = varRes.doc;

    // 2. Verify every view/selector referencing the symbol reflects the edits immediately:
    // (a) SetEditor / ElementDetail member selector (membersOf)
    const setMembers = membersOf(doc, findElement(doc, highSet.id)!);
    const inSetView = setMembers.find((s) => s.id === targetSymbolId)!;
    assert.equal(inSetView.name, "Sun Disk");
    assert.equal(inSetView.isWild, true);
    assert.equal(inSetView.isScatter, true);
    assert.equal(inSetView.variants?.length, 1);
    assert.equal(symbolImage(doc, inSetView)?.uri, "https://cdn.example.com/sun-disk.png");

    // (b) Design View ElementWorkspace / SymbolSetGroup selector (selectSets)
    const setView = selectSets(doc).find((v) => v.element.id === highSet.id)!;
    const inWorkspaceView = setView.symbols.find((s) => s.id === targetSymbolId)!;
    assert.equal(inWorkspaceView.name, "Sun Disk");
    assert.equal(inWorkspaceView.isWild, true);
    assert.equal(inWorkspaceView.isScatter, true);
    assert.equal(inWorkspaceView.variants?.[0].name, "Sun Disk — Collect");

    // (c) Inspector / SymbolEditor selector (findSymbol)
    const inspected = findSymbol(doc, targetSymbolId)!;
    assert.equal(inspected.symbol.name, "Sun Disk");
    assert.equal(inspected.owner?.id, highSet.id);

    // (d) Dependency warning before deletion when referenced by reel strips or paytable data
    const impact = symbolDeletionImpact(doc, targetSymbolId);
    assert.ok(impact, "Deletion impact is computed for the symbol");
    assert.equal(impact.kind, "symbol");
    assert.equal(impact.name, "Sun Disk");
    assert.ok(impact.stripPositions > 0, "Warns that the symbol is referenced by reel strip positions");
    assert.ok(impact.paytableRows > 0, "Warns that the symbol is referenced by paytable rows");

    // (e) Persist and verify reloaded blueprint reflects all edits
    await saveDesign(project.id, {
      baseRevision: project.revision,
      doc,
    });
    const reloaded = await getProject(project.id);
    assert.ok(reloaded);
    assert.equal(validateBlueprint(reloaded.blueprint).integrityOk, true);
    const persistedSymbol = reloaded.blueprint.symbols.find((s) => s.id === targetSymbolId)!;
    assert.equal(persistedSymbol.name, "Sun Disk");
    assert.equal(persistedSymbol.isWild, true);
    assert.equal(persistedSymbol.isScatter, true);
    assert.equal(persistedSymbol.variants?.[0].name, "Sun Disk — Collect");
  } finally {
    await deleteProject(project.id);
  }
});
