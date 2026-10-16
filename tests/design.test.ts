import assert from "node:assert/strict";
import Module from "node:module";
import { test } from "node:test";
import { createBlueprint } from "../src/lib/blueprint/factory";

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
import type { AssetRef, ElementType, GameBlueprint } from "../src/lib/blueprint/types";
import { draftToBlueprint } from "../src/lib/creation/blueprint-from-draft";
import { createDefaultDraft } from "../src/lib/creation/draft";
import { commitHistory, createHistory, redoHistory, undoHistory } from "../src/lib/design/history";
import { applyDesign, designDocFromBlueprint, migrateBlueprint } from "../src/lib/design/migrate";
import { finalizeDoc } from "../src/lib/design/model";
import {
  addElement, addSymbols, deleteElement, deleteSymbol, deletionImpact, duplicateElement,
  importArtwork, renameElement, renameSymbol, setElementImage, setSymbolImage, setSymbolTier,
  symbolDeletionImpact, updateElement,
} from "../src/lib/design/operations";
import { parseDesignDoc } from "../src/lib/design/parse";
import { elementStatus, selectSets, selectStandalone } from "../src/lib/design/selectors";
import type { DesignDoc, NewElementInput } from "../src/lib/design/types";
import { buildZip, crc32 } from "../src/lib/design/zip";

const NOW = "2026-01-01T00:00:00.000Z";
const ctx = { glyphs: ["🦅", "🏛️", "⚔️"] };
const art = (id: string): AssetRef => ({ id, name: `${id}.png`, kind: "image", uri: `/api/assets/${id}`, state: "linked", tags: ["imported"] });
const baseBlueprint = (): GameBlueprint => draftToBlueprint({ ...createDefaultDraft(), title: "Design Test", theme: "Roman Empire" }, { id: "t", now: NOW });
let base = baseBlueprint();
const start = () => designDocFromBlueprint((base = baseBlueprint()));
const integrity = (doc: DesignDoc) => {
  const result = validateBlueprint(applyDesign(base, doc));
  assert.deepEqual(result.integrityIssues, []);
  return result;
};

test("new projects expose symbol sets with type + tier, and specials as standalone symbols", () => {
  const doc = start();
  const sets = selectSets(doc);
  assert.deepEqual(sets.map((s) => s.element.name), ["Royals", "Medium Symbols", "High Symbols"]);
  assert.deepEqual(sets.map((s) => [s.element.symbolSet?.symbolType, s.element.symbolSet?.valueTier]), [["royals", "low"], ["custom", "medium"], ["custom", "high"]]);
  assert.deepEqual(sets.map((s) => s.symbols.length), [4, 2, 3]);
  const standalone = selectStandalone(doc);
  assert.equal(standalone.filter((e) => e.type === "symbol").length, 3);
  assert.ok(standalone.some((e) => e.type === "game_title") && standalone.some((e) => e.type === "button_set"));
  integrity(doc);
});

test("every element type can be added, and a project holds several sets and standalone elements", () => {
  let doc = start();
  const inputs: NewElementInput[] = [
    { type: "symbol_set", name: "Suits", symbolType: "suits", valueTier: "low", count: 4 },
    { type: "symbol_set", name: "Sevens", symbolType: "seven", valueTier: "high", count: 2 },
    { type: "symbol_set", name: "Bars", symbolType: "bar", valueTier: "medium", count: 3 },
    { type: "symbol", name: "Idol", valueTier: "high" },
    { type: "symbol", name: "Joker", valueTier: "high", behaviour: "wild" },
    { type: "game_title", name: "Logo B" },
    { type: "reel_frame", name: "Gold Frame", style: "Ornate" },
    { type: "game_background", name: "Night", aspect: "21:9" },
    { type: "button_set", name: "Neon Buttons", buttons: ["spin", "turbo"] },
    { type: "other_asset", name: "Banner" },
  ];
  for (const input of inputs) {
    const added = addElement(doc, input, ctx);
    assert.ok(added.doc.elements.some((e) => e.id === added.id && e.name === input.name), input.name);
    doc = added.doc;
    integrity(doc);
  }
  assert.equal(selectSets(doc).length, 6);
  assert.ok(selectStandalone(doc).length >= 10);
  assert.equal(doc.symbols.find((s) => s.name === "Joker")?.tier, "special");
  assert.ok(doc.specialSymbols.some((s) => s.symbolId === doc.symbols.find((x) => x.name === "Joker")?.id));
  assert.deepEqual(selectSets(doc).find((s) => s.element.name === "Suits")?.symbols.map((s) => s.glyph), ["♠", "♥", "♦", "♣"]);
  assert.equal(new Set(doc.symbols.map((s) => s.id)).size, doc.symbols.length);
  assert.equal(new Set(doc.symbols.map((s) => s.code)).size, doc.symbols.length);
  assert.ok(doc.strips.every((strip) => strip.length > 0));
});

test("rename trims, rejects blanks, and keeps standalone symbol names in sync", () => {
  let doc = start();
  const set = doc.elements.find((e) => e.type === "symbol_set")!;
  doc = renameElement(doc, set.id, "  Imperial   Royals ");
  assert.equal(doc.elements.find((e) => e.id === set.id)?.name, "Imperial Royals");
  assert.equal(renameElement(doc, set.id, "   "), doc);
  const wild = doc.elements.find((e) => e.type === "symbol")!;
  doc = renameElement(doc, wild.id, "Eagle Wild");
  assert.equal(doc.symbols.find((s) => s.id === wild.symbolIds[0])?.name, "Eagle Wild");
  const inSet = doc.symbols.find((s) => set.symbolIds.includes(s.id))!;
  doc = renameSymbol(doc, inSet.id, "Ace");
  assert.equal(doc.symbols.find((s) => s.id === inSet.id)?.name, "Ace");
  integrity(doc);
});

test("duplicating a set clones its symbols with unique ids/codes and copies payout data", () => {
  let doc = start();
  const set = doc.elements.find((e) => e.type === "symbol_set" && e.name === "Royals")!;
  const result = duplicateElement(doc, set.id)!;
  doc = result.doc;
  const copy = doc.elements.find((e) => e.id === result.id)!;
  assert.equal(copy.name, "Royals copy");
  assert.equal(doc.elements.findIndex((e) => e.id === copy.id), doc.elements.findIndex((e) => e.id === set.id) + 1);
  assert.equal(copy.symbolIds.length, set.symbolIds.length);
  assert.ok(copy.symbolIds.every((id) => !set.symbolIds.includes(id)));
  assert.deepEqual(copy.symbolSet, set.symbolSet);
  assert.equal(new Set(doc.symbols.map((s) => s.code)).size, doc.symbols.length);
  assert.equal(duplicateElement(doc, set.id)!.doc.elements.some((e) => e.name === "Royals copy 2"), true);
  const wild = doc.elements.find((e) => e.type === "symbol")!;
  const wildCopy = duplicateElement(doc, wild.id)!;
  assert.equal(wildCopy.doc.specialSymbols.length, doc.specialSymbols.length + 1);
  integrity(wildCopy.doc);
  integrity(doc);
});

test("deleting a set removes its symbols and every reference, with an accurate impact report", () => {
  const doc = start();
  const set = doc.elements.find((e) => e.symbolSet?.valueTier === "high")!;
  const impact = deletionImpact(doc, set.id)!;
  assert.equal(impact.symbols, 3);
  assert.ok(impact.paytableRows >= 9 && impact.stripPositions > 0);
  const next = deleteElement(doc, set.id);
  assert.equal(next.elements.some((e) => e.id === set.id), false);
  assert.ok(set.symbolIds.every((id) => !next.symbols.some((s) => s.id === id)));
  assert.ok(next.paytable.every((r) => !set.symbolIds.includes(r.symbolId)));
  assert.ok(next.strips.every((strip) => strip.every((id) => !set.symbolIds.includes(id))));
  assert.equal(deletionImpact(next, set.id), null);
  integrity(next);
  const wild = doc.elements.find((e) => e.type === "symbol")!;
  const gone = deleteElement(doc, wild.id);
  assert.equal(gone.specialSymbols.some((s) => s.symbolId === wild.symbolIds[0]), false);
  integrity(gone);
});

test("a project may be emptied: integrity holds, completeness is reported", () => {
  let doc = start();
  for (const e of [...doc.elements]) doc = deleteElement(doc, e.id);
  assert.equal(doc.elements.length, 0);
  assert.equal(doc.symbols.length, 0);
  assert.ok(doc.strips.every((s) => s.length === 0));
  const result = integrity(doc);
  assert.equal(result.ok, false);
  assert.equal(result.integrityOk, true);
});

test("images: replace, remove, per-symbol, and asset pruning", () => {
  let doc = start();
  const title = doc.elements.find((e) => e.type === "game_title")!;
  doc = setElementImage(doc, title.id, art("a1"));
  assert.equal(doc.elements.find((e) => e.id === title.id)?.origin, "imported");
  doc = setElementImage(doc, title.id, art("a2"));
  assert.equal(doc.assets.some((a) => a.id === "a1"), false, "replaced asset is pruned");
  doc = setElementImage(doc, title.id, null);
  assert.equal(doc.assets.some((a) => a.id === "a2"), false);
  assert.equal(doc.elements.find((e) => e.id === title.id)?.origin, "planned");

  const set = doc.elements.find((e) => e.type === "symbol_set")!;
  doc = setSymbolImage(doc, set.symbolIds[0], art("s1"));
  const view = selectSets(doc).find((s) => s.element.id === set.id)!;
  assert.equal(view.status.key, "partial");
  assert.equal(elementStatus(doc, view.element).label, "Partial");
  assert.equal(setElementImage(doc, set.id, art("x")), doc, "sets have no single image");

  const bg = doc.elements.find((e) => e.type === "game_background")!;
  doc = setElementImage(doc, bg.id, art("bg1"));
  assert.equal(applyDesign(base, doc).canvas.backgroundAssetId, "bg1");
  integrity(doc);
});

test("the style reference asset is never pruned", () => {
  const withRef = { ...start(), assets: [...start().assets, art("ref")], referenceAssetId: "ref" };
  assert.ok(finalizeDoc(withRef).assets.some((a) => a.id === "ref"));
});

test("updateElement changes tiers coherently and addSymbols extends a set", () => {
  let doc = start();
  const set = doc.elements.find((e) => e.symbolSet?.valueTier === "medium")!;
  doc = updateElement(doc, set.id, { symbolSet: { valueTier: "high", symbolType: "suits" }, notes: "n" });
  const updated = doc.elements.find((e) => e.id === set.id)!;
  assert.equal(updated.group, "Suits");
  assert.ok(updated.symbolIds.every((id) => doc.symbols.find((s) => s.id === id)?.tier === "high"));
  const added = addSymbols(doc, set.id, [{ name: "Heart" }, { asset: art("h1") }], ctx);
  assert.equal(added.ids.length, 2);
  assert.equal(added.doc.elements.find((e) => e.id === set.id)?.symbolIds.length, 4);
  assert.ok(added.doc.strips.every((strip) => added.ids.every((id) => strip.includes(id))));
  assert.ok(added.doc.paytable.some((r) => r.symbolId === added.ids[0]));
  const one = deleteSymbol(added.doc, added.ids[0]);
  assert.equal(one.elements.find((e) => e.id === set.id)?.symbolIds.length, 3);
  assert.equal(symbolDeletionImpact(added.doc, added.ids[0])?.symbols, 1);
  const standalone = added.doc.elements.find((e) => e.type === "symbol")!;
  assert.equal(setSymbolTier(added.doc, standalone.symbolIds[0], "low"), added.doc, "special tier is fixed");
  integrity(one);
});

test("importing artwork creates typed elements and groups symbol-set images into one set", () => {
  const items = ([
    ["game_background", "sky.png"], ["symbol", "idol.png"], ["symbol_set", "a.png"], ["symbol_set", "b.png"],
    ["reel_frame", "frame.png"], ["button_set", "buttons.png"], ["game_title", "logo.png"], ["other_asset", "misc.png"],
  ] as [ElementType, string][]).map(([elementType, name], i) => ({ elementType, name, asset: art(`i${i}`) }));
  const { doc, ids } = importArtwork(start(), items, { name: "Imported Set", symbolType: "custom", valueTier: "medium" }, ctx);
  assert.equal(ids.length, 7);
  const set = doc.elements.find((e) => e.name === "Imported Set")!;
  assert.equal(set.symbolIds.length, 2);
  assert.equal(selectSets(doc).find((s) => s.element.id === set.id)?.status.key, "ready");
  assert.equal(doc.symbols.find((s) => s.name === "idol.png")?.assetId, "i1");
  assert.ok(doc.assets.filter((a) => a.state === "linked").length >= 8);
  integrity(doc);
});

test("legacy (pre-F04) blueprints migrate: sets split, specials standalone, idempotent, art-only symbols upgraded", () => {
  const legacy = createBlueprint({ id: "legacy", title: "Legacy", theme: "Neon Arcade" });
  legacy.symbolSets = [
    { id: "set-royals", name: "Royals", description: "", symbolIds: legacy.symbols.filter((s) => s.tier === "low").map((s) => s.id) },
    { id: "set-premium", name: "Premium", description: "", symbolIds: legacy.symbols.filter((s) => s.tier === "mid" || s.tier === "high").map((s) => s.id) },
    { id: "set-special", name: "Special", description: "", symbolIds: legacy.symbols.filter((s) => s.tier === "special").map((s) => s.id) },
  ];
  delete (legacy as Partial<GameBlueprint>).elements;
  const migrated = migrateBlueprint(legacy);
  const sets = migrated.elements.filter((e) => e.type === "symbol_set");
  assert.deepEqual(sets.map((s) => s.name), ["Royals", "Medium Symbols", "High Symbols"]);
  assert.equal(migrated.elements.filter((e) => e.type === "symbol").length, 3);
  assert.equal(migrated.symbolSets.length, 3);
  assert.deepEqual(validateBlueprint(migrated).integrityIssues, []);
  assert.deepEqual(migrateBlueprint(migrated), migrated, "idempotent");

  const withArt = structuredClone(migrated);
  withArt.assets.push(art("old"));
  withArt.elements.push({ id: "el-import-1", type: "symbol", name: "Old Art", group: "Standalone Symbol", assetId: "old", symbolIds: [], notes: "", origin: "imported", params: {} });
  const upgraded = migrateBlueprint(withArt);
  const element = upgraded.elements.find((e) => e.id === "el-import-1")!;
  assert.equal(element.symbolIds.length, 1);
  assert.equal(upgraded.symbols.find((s) => s.id === element.symbolIds[0])?.assetId, "old");
  assert.deepEqual(validateBlueprint(upgraded).integrityIssues, []);
});

test("parseDesignDoc accepts a real document and rejects hostile input", () => {
  const doc = start();
  const ok = parseDesignDoc(JSON.parse(JSON.stringify(doc)));
  assert.equal(ok.ok, true);
  const mutate = (fn: (d: Record<string, unknown>) => void) => {
    const copy = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    fn(copy);
    return parseDesignDoc(copy);
  };
  assert.equal(parseDesignDoc(null).ok, false);
  assert.equal(parseDesignDoc({}).ok, false);
  assert.equal(mutate((d) => ((d.elements as { type: string }[])[0].type = "weapon")).ok, false);
  assert.equal(mutate((d) => ((d.elements as { name: string }[])[0].name = "  ")).ok, false);
  assert.equal(mutate((d) => ((d.elements as { id: string }[])[0].id = "../etc")).ok, false);
  assert.equal(mutate((d) => ((d.symbols as { reelWeight: number }[])[0].reelWeight = -1)).ok, false);
  assert.equal(mutate((d) => ((d.elements as { params: unknown }[])[0].params = { __proto__x: { a: 1 } })).ok, false);
  assert.equal(mutate((d) => (d.elements = new Array(500).fill(d.elements))).ok, false);
});

test("history supports undo, redo, branching and typing coalescing", () => {
  let h = createHistory(0);
  h = commitHistory(h, 1, "one", { now: 0 });
  h = commitHistory(h, 2, "two", { now: 10 });
  const u = undoHistory(h)!;
  assert.equal(u.state.present, 1);
  assert.equal(u.label, "two");
  assert.equal(redoHistory(u.state)!.state.present, 2);
  const branched = commitHistory(u.state, 9, "nine", { now: 20 });
  assert.equal(branched.future.length, 0);
  assert.equal(redoHistory(branched), null);
  let typing = createHistory("");
  typing = commitHistory(typing, "a", "type", { key: "k", now: 0 });
  typing = commitHistory(typing, "ab", "type", { key: "k", now: 100 });
  assert.equal(typing.past.length, 1, "coalesced");
  typing = commitHistory(typing, "abc", "type", { key: "k", now: 5000 });
  assert.equal(typing.past.length, 2, "window elapsed");
  assert.equal(undoHistory(createHistory(1)), null);
});

test("zip writer produces a structurally valid archive", () => {
  const files = [
    { name: "01-eagle.png", data: new Uint8Array([1, 2, 3, 4, 5]) },
    { name: "set.json", data: new TextEncoder().encode('{"ünï":"cödé"}') },
  ];
  const zip = buildZip(files);
  const view = new DataView(zip.buffer);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  let p = view.getUint32(end + 16, true);
  files.forEach((file) => {
    assert.equal(view.getUint32(p, true), 0x02014b50);
    assert.equal(view.getUint32(p + 16, true), crc32(file.data));
    assert.equal(view.getUint32(p + 24, true), file.data.length);
    const nameLength = view.getUint16(p + 28, true);
    assert.equal(new TextDecoder().decode(zip.slice(p + 46, p + 46 + nameLength)), file.name);
    const local = view.getUint32(p + 42, true);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.deepEqual(zip.slice(local + 30 + nameLength, local + 30 + nameLength + file.data.length), file.data);
    p += 46 + nameLength;
  });
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("F04 acceptance: Design View edits (add, rename, duplicate, delete, import artwork) persist across reloads", async () => {
  const { createProject, deleteProject, getProject } = await import("../src/server/workspace-service");
  const { saveDesign, uploadAsset } = await import("../src/server/design-service");

  const created = await createProject({
    title: "F04 Persistence Test",
    theme: "Roman Empire",
  });

  try {
    let doc = designDocFromBlueprint(created.blueprint);

    // 1. Add a new Symbol Set and a Standalone Element ("other_asset")
    const addedSet = addElement(
      doc,
      { type: "symbol_set", name: "Legion Shields", symbolType: "custom", valueTier: "high", count: 3 },
      ctx,
    );
    doc = addedSet.doc;
    const addedOther = addElement(
      doc,
      { type: "other_asset", name: "Colosseum Banner", group: "Marketing" },
      ctx,
    );
    doc = addedOther.doc;

    // 2. Rename an element
    doc = renameElement(doc, addedSet.id, "Imperial Shields");

    // 3. Duplicate an element
    const dupResult = duplicateElement(doc, addedSet.id)!;
    doc = dupResult.doc;

    // 4. Delete the duplicated set after checking deletionImpact
    const impact = deletionImpact(doc, dupResult.id);
    assert.ok(impact && impact.symbols === 3);
    doc = deleteElement(doc, dupResult.id);

    // 5. Upload local artwork and link it to the standalone element
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBJsAAAAASUVORK5CYII=";
    const { asset: storedAsset } = await uploadAsset(created.id, {
      name: "banner.png",
      dataUrl: PNG,
    });
    doc = setElementImage(doc, addedOther.id, storedAsset);

    // 6. Persist DesignDoc via saveDesign and verify reload via getProject
    const saved = await saveDesign(created.id, {
      baseRevision: created.revision,
      doc,
    });
    assert.ok(saved.revision > created.revision);

    const reloaded = await getProject(created.id);
    assert.ok(reloaded);
    assert.ok(reloaded.blueprint.elements.some((e) => e.id === addedSet.id && e.name === "Imperial Shields"));
    assert.ok(
      reloaded.blueprint.elements.some(
        (e) => e.id === addedOther.id && e.name === "Colosseum Banner" && e.assetId === storedAsset.id,
      ),
    );
    assert.equal(reloaded.blueprint.elements.some((e) => e.id === dupResult.id), false);
    assert.equal(validateBlueprint(reloaded.blueprint).ok, true);
  } finally {
    await deleteProject(created.id);
  }
});
