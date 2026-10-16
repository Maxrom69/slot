import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = process.env.BASE_URL || "http://localhost:3000";
const title = `__F04_ACCEPTANCE_${Date.now()}`;

function png(color, size = 48) {
  const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const n = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([n, data]))); return Buffer.concat([len, n, data, sum]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => color).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}
const file = (name, color) => ({ name, mimeType: "image/png", buffer: png(color) });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/status of (409|422)/.test(m.text())) problems.push(`console: ${m.text()}`); });
let projectId;

const api = async (method, url, data) => {
  const res = await context.request.fetch(`${base}${url}`, { method, data, headers: { "content-type": "application/json" } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
};
const inspector = () => page.getByRole("complementary", { name: "Inspector" });
// Waits out the 800 ms autosave debounce first, so "Saved" can only mean the latest edit is stored.
const saved = async () => {
  await page.waitForTimeout(1100);
  await page.getByRole("status").filter({ hasText: /^\s*Saved\s*$/ }).waitFor({ timeout: 15000 });
};
const set = (name) => page.getByRole("region", { name: `${name} symbol set`, exact: true });
const toolbar = (name) => page.getByRole("toolbar", { name: `Actions for ${name}`, exact: true });
const pick = (name) => page.getByRole("button", { name: `Select ${name}`, exact: true });
const sets = () => page.locator('section[aria-label$="symbol set"]');
const addElement = async (label, fill) => {
  await page.getByRole("button", { name: "Add Element", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await fill(dialog);
  await dialog.getByRole("button", { name: "Add element", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
};
const exportBlueprint = async () => JSON.parse(await (await context.request.get(`${base}/api/projects/${projectId}/export`)).text());
const ownerCounts = (bp) => { const m = new Map(); bp.elements.forEach((e) => e.symbolIds.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1))); return m; };
const assertIntegrity = (bp) => {
  const ids = new Set(bp.symbols.map((s) => s.id));
  assert.ok(bp.paytable.every((r) => ids.has(r.symbolId)), "paytable references");
  assert.ok(bp.reels.strips.every((s) => s.every((id) => ids.has(id))), "strip references");
  assert.ok([...ownerCounts(bp).values()].every((n) => n === 1), "single owner");
  assert.ok(bp.symbols.every((s) => ownerCounts(bp).has(s.id)), "every symbol owned");
  assert.deepEqual(bp.symbolSets.map((s) => s.id), bp.elements.filter((e) => e.type === "symbol_set").map((e) => e.id), "derived sets");
  const assets = new Set(bp.assets.map((a) => a.id));
  assert.ok(bp.elements.every((e) => !e.assetId || assets.has(e.assetId)) && bp.symbols.every((s) => !s.assetId || assets.has(s.assetId)), "asset references");
};

try {
  /* -------- arrange: a real project made through the F03 creation pipeline -------- */
  const draft = { schema: 1, title, theme: "Roman Empire", folderPath: "__F04_ACCEPTANCE__", stylePreset: "cinematic", styleGuide: "", description: "", grid: { preset: "5x3", columns: 5, rows: 3 }, evaluation: "lines", paylineCount: 20, rtpTarget: 96, volatility: "medium", status: "draft",
    symbols: { royals: 4, medium: 2, high: 3, specials: ["wild", "scatter", "bonus"] }, elements: { gameTitle: true, backgrounds: 1, aspect: "16:9", reelFrames: 1, frameStyle: "themed", buttons: ["spin", "auto"] }, referenceImage: null, artwork: [] };
  const created = await api("POST", "/api/projects", { title, theme: draft.theme, draft });
  assert.equal(created.status, 200);
  projectId = created.body.id;

  /* ---------------------------------- layout ---------------------------------- */
  await page.goto(`${base}/projects/${projectId}`);
  await page.getByRole("heading", { name: "Game elements", exact: true }).waitFor();
  await page.getByRole("heading", { name: /^Symbol Sets/ }).waitFor();
  await page.getByRole("heading", { name: /^Standalone Elements/ }).waitFor();
  assert.ok(await page.getByRole("heading", { name: title, level: 1 }).isVisible(), "top bar title");
  for (const name of ["Project navigation", "Inspector"]) assert.ok(await page.getByRole("complementary", { name }).isVisible(), name);
  await saved();
  assert.equal(await sets().count(), 3);
  const royals = set("Royals");
  assert.ok(await royals.getByText("Royals", { exact: true }).first().isVisible());
  assert.match(await royals.innerText(), /Low value/);
  assert.match(await royals.innerText(), /Planned/);
  assert.match(await royals.innerText(), /4 symbols/);
  assert.match(await set("High Symbols").innerText(), /High value/);
  assert.equal(await royals.locator("[data-symbol-id]").count(), 4, "expanded by default, with symbol thumbnails");
  await page.screenshot({ path: "/tmp/design-overview.png" });

  /* ------------------------------ expand / collapse ------------------------------ */
  await page.getByRole("button", { name: "Collapse Royals", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Expand Royals", exact: true }).getAttribute("aria-expanded"), "false");
  assert.equal(await royals.locator("[data-symbol-id]").count(), 0);
  await page.getByRole("button", { name: "Collapse all" }).click();
  assert.equal(await page.locator("[data-symbol-id]").count(), 0);
  await page.getByRole("button", { name: "Expand all" }).click();
  assert.equal(await page.locator("[data-symbol-id]").count(), 9);
  await page.getByRole("button", { name: "Collapse Medium Symbols", exact: true }).click();
  await page.reload();
  await page.getByRole("heading", { name: "Game elements", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Expand Medium Symbols", exact: true }).getAttribute("aria-expanded"), "false", "collapse state persists");
  await page.getByRole("button", { name: "Expand Medium Symbols", exact: true }).click();

  /* ------------------------------ selection + inspector ------------------------------ */
  await pick("Game Title").click();
  assert.equal(await pick("Game Title").getAttribute("aria-pressed"), "true");
  assert.equal(await inspector().getByLabel("Element name").inputValue(), "Game Title");
  await pick("Royals").click();
  assert.equal(await inspector().getByLabel("Element name").inputValue(), "Royals");
  assert.equal(await inspector().getByLabel("Symbol type").inputValue(), "royals");
  await page.locator('[data-symbol-id]').first().click();
  assert.equal(await inspector().getByLabel("Symbol name").inputValue(), "Royal A", "symbol selection from a thumbnail");
  await page.keyboard.press("Escape");
  assert.match(await inspector().innerText(), /Project overview/);

  /* ---------------------------------- rename ---------------------------------- */
  await pick("Game Title").click();
  await inspector().getByLabel("Element name").fill("Eagle Title");
  await inspector().getByLabel("Element name").press("Enter");
  await pick("Eagle Title").waitFor();
  await saved();
  await inspector().getByLabel("Element name").fill("   ");
  await inspector().getByLabel("Element name").press("Enter");
  assert.equal(await inspector().getByLabel("Element name").inputValue(), "Eagle Title", "blank name rejected");
  await pick("Royals").click();
  await page.keyboard.press("F2");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Element name");
  await page.keyboard.type("Imperial Royals");
  await page.keyboard.press("Enter");
  await pick("Imperial Royals").waitFor();

  /* ------------------------------- undo / redo ------------------------------- */
  assert.equal(await page.getByRole("button", { name: "Redo", exact: true }).isDisabled(), true, "nothing to redo yet");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await pick("Royals").waitFor();
  assert.equal(await pick("Imperial Royals").count(), 0, "undo reverts the rename");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await pick("Imperial Royals").waitFor();
  await page.keyboard.press("Control+z");
  await pick("Royals").waitFor();
  await page.keyboard.press("Control+Shift+z");
  await pick("Imperial Royals").waitFor();
  await saved();
  await page.reload();
  await pick("Imperial Royals").waitFor();
  await pick("Eagle Title").waitFor();

  /* ------------------------------- quick actions ------------------------------- */
  await pick("Imperial Royals").click();
  const tools = toolbar("Imperial Royals");
  for (const name of ["Edit", "Replace image", "Duplicate", "Delete", "Download", "Open detail"]) {
    assert.ok(await tools.getByRole("button", { name: new RegExp(`^${name}`) }).count(), `quick action ${name}`);
  }
  assert.ok(await tools.getByRole("button", { name: "Replace image" }).isDisabled(), "set replace is disabled with a reason");
  assert.ok(await tools.getByRole("button", { name: /^Download/ }).isDisabled(), "no images yet");
  await tools.getByRole("button", { name: /^More actions/ }).click();
  for (const name of ["Regenerate with AI", "Generate variations"]) assert.ok(await page.getByRole("menuitem", { name: new RegExp(name) }).isDisabled(), `${name} reserved`);
  await page.keyboard.press("Escape");

  /* ---------------------------------- duplicate ---------------------------------- */
  await tools.getByRole("button", { name: "Duplicate" }).click();
  await set("Imperial Royals copy").waitFor();
  assert.equal(await sets().count(), 4);
  assert.equal(await set("Imperial Royals copy").locator("[data-symbol-id]").count(), 4);

  /* -------------------------------- delete + confirm -------------------------------- */
  await toolbar("Imperial Royals copy").getByRole("button", { name: "Delete" }).click();
  const confirm = page.getByRole("dialog", { name: /Delete symbol set/ });
  await confirm.waitFor();
  assert.match(await confirm.innerText(), /4 symbols/);
  assert.match(await confirm.innerText(), /paytable rows? (are|is) removed/);
  await confirm.getByRole("button", { name: "Cancel" }).click();
  assert.equal(await sets().count(), 4, "cancel keeps the element");
  await toolbar("Imperial Royals copy").getByRole("button", { name: "Delete" }).click();
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label$="symbol set"]').length === 3);
  await page.getByRole("button", { name: "Undo", exact: true }).first().click();
  await set("Imperial Royals copy").waitFor();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label$="symbol set"]').length === 3);
  await pick("Imperial Royals").click();
  await page.keyboard.press("Delete");
  await confirm.waitFor();
  await page.keyboard.press("Escape");
  await confirm.waitFor({ state: "detached" });
  assert.equal(await sets().count(), 3);
  await saved();
  assertIntegrity(await exportBlueprint());

  /* ----------------------------------- add element ----------------------------------- */
  await addElement("Symbol Set", async (d) => { await d.getByLabel("Element name").fill("Card Suits"); await d.getByLabel("Symbol type").selectOption("suits"); await d.getByLabel("Value tier").selectOption("low"); await d.getByLabel("starting symbols count").fill("4"); });
  assert.match(await set("Card Suits").innerText(), /Suits/);
  assert.match(await set("Card Suits").innerText(), /4 symbols/);
  await addElement("Symbol Set", async (d) => { await d.getByLabel("Element name").fill("Empty Set"); await d.getByLabel("starting symbols count").fill("0"); });
  assert.match(await set("Empty Set").innerText(), /Empty/);
  await addElement("Symbol A", async (d) => { await d.getByLabel("Element name").fill("Gold Idol"); await d.getByLabel("Value tier").selectOption("high"); });
  await addElement("Symbol A", async (d) => { await d.getByLabel("Element name").fill("Joker Wild"); await d.getByLabel("Special behaviour").selectOption("wild"); });
  await addElement("Game Title", async (d) => d.getByLabel("Element name").fill("Alt Logo"));
  await addElement("Reel Frame", async (d) => { await d.getByLabel("Element name").fill("Gold Frame"); await d.getByLabel("Frame style").selectOption("Ornate"); });
  await addElement("Game Background", async (d) => { await d.getByLabel("Element name").fill("Night Sky"); await d.getByLabel("Aspect ratio").selectOption("21:9"); });
  await addElement("Button Set", async (d) => { await d.getByLabel("Element name").fill("Neon Buttons"); await d.getByRole("button", { name: "Turbo", exact: true }).click(); });
  await addElement("Other", async (d) => { await d.getByLabel("Element name").fill("Banner Art"); await d.getByLabel("Group").fill("Marketing"); await d.getByLabel("Element image").setInputFiles(file("banner.png", [200, 40, 40])); });
  for (const name of ["Gold Idol", "Joker Wild", "Alt Logo", "Gold Frame", "Night Sky", "Neon Buttons", "Banner Art"]) await pick(name).waitFor();
  const banner = page.locator('article[aria-label="Banner Art"] img').first();
  await banner.waitFor();
  assert.ok((await banner.boundingBox()).width > 150, "artwork fills its card instead of its 48px natural size");
  await saved();
  let bp = await exportBlueprint();
  assertIntegrity(bp);
  assert.equal(bp.symbols.find((s) => s.name === "Joker Wild").tier, "special");
  assert.ok(bp.specialSymbols.some((s) => s.behaviour === "wild" && s.symbolId === bp.symbols.find((x) => x.name === "Joker Wild").id));
  assert.equal(bp.elements.find((e) => e.name === "Neon Buttons").params.buttons, "spin,turbo");
  assert.equal(bp.elements.filter((e) => e.type === "symbol_set").length, 5, "multiple symbol sets");

  /* ----------------------------------- import ----------------------------------- */
  await page.getByRole("button", { name: "Import", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Import artwork" });
  await dialog.getByLabel("Choose artwork files").setInputFiles([file("sky-background.png", [20, 60, 160]), file("totem-symbol.png", [30, 160, 60]), file("misc-art.png", [90, 90, 90])]);
  assert.equal(await dialog.getByLabel("Element type for sky-background.png").inputValue(), "game_background");
  assert.equal(await dialog.getByLabel("Element type for totem-symbol.png").inputValue(), "symbol");
  await dialog.getByLabel("Element type for misc-art.png").selectOption("symbol_set");
  await dialog.getByLabel("New set name").fill("Imported Totems");
  await dialog.getByRole("button", { name: /^Import 3 files/ }).click();
  await dialog.waitFor({ state: "detached" });
  await pick("sky-background").waitFor();
  await pick("totem-symbol").waitFor();
  await set("Imported Totems").waitFor();
  await page.locator('article[aria-label="sky-background"] img').first().waitFor();
  assert.match(await set("Imported Totems").innerText(), /Ready/);
  await saved();
  const workspace = await api("GET", "/api/workspace");
  assert.ok(workspace.body.projects.find((p) => p.id === projectId).thumbnailUri?.startsWith("/api/assets/"), "dashboard thumbnail follows the linked background");

  /* ------------------------------ replace / remove image ------------------------------ */
  await pick("Alt Logo").click();
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), toolbar("Alt Logo").getByRole("button", { name: "Replace image" }).click()]);
  await chooser.setFiles(file("logo.png", [220, 180, 20]));
  await page.locator('article[aria-label="Alt Logo"] img').first().waitFor();
  await saved();
  const [pngDownload] = await Promise.all([page.waitForEvent("download"), toolbar("Alt Logo").getByRole("button", { name: /^Download/ }).click()]);
  assert.equal(pngDownload.suggestedFilename(), "alt-logo.png");
  const [chooser2] = await Promise.all([page.waitForEvent("filechooser"), toolbar("Alt Logo").getByRole("button", { name: "Replace image" }).click()]);
  await chooser2.setFiles(file("logo-2.png", [20, 180, 220]));
  await page.waitForTimeout(400);
  await saved();
  await inspector().getByRole("button", { name: "Remove", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('article[aria-label="Alt Logo"] img'));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.locator('article[aria-label="Alt Logo"] img').first().waitFor();

  /* ---------------------------------- set download ---------------------------------- */
  const [zip] = await Promise.all([page.waitForEvent("download"), toolbar("Imported Totems").getByRole("button", { name: /^Download/ }).click()]);
  assert.equal(zip.suggestedFilename(), "imported-totems.zip");
  const zipPath = await zip.path();
  const listing = execFileSync("python3", ["-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('|'.join(z.namelist()))", zipPath]).toString().trim();
  assert.match(listing, /01-misc-art\.png/);
  assert.match(listing, /set\.json/);

  /* -------------------------------- detail navigation -------------------------------- */
  await pick("Card Suits").click();
  await toolbar("Card Suits").getByRole("button", { name: "Open detail" }).click();
  await page.waitForURL(/\?element=el-symbol-set/);
  await page.getByRole("navigation", { name: "Breadcrumb" }).waitFor();
  assert.equal(await page.getByLabel("Element name").first().inputValue(), "Card Suits");
  assert.equal(await page.locator("article[data-symbol-id]").count(), 4);
  await page.getByLabel("Name of Card Suits 1").fill("Spade");
  await page.getByLabel("Name of Card Suits 1").press("Enter");
  await page.getByLabel("Name of Spade").waitFor();
  await page.getByRole("button", { name: "Add symbol", exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll("article[data-symbol-id]").length === 5);
  await page.getByRole("button", { name: "Delete Card Suits 5" }).click();
  await page.getByRole("dialog", { name: /Delete symbol\?/ }).getByRole("button", { name: "Delete", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("article[data-symbol-id]").length === 4);
  await page.goBack();
  await page.getByRole("heading", { name: "Game elements", exact: true }).waitFor();
  assert.equal(new URL(page.url()).search, "");
  await saved();
  await page.goto(`${base}/projects/${projectId}?element=${encodeURIComponent(bp.elements.find((e) => e.name === "Card Suits").id)}`);
  await page.getByRole("navigation", { name: "Breadcrumb" }).waitFor();
  assert.ok(await page.getByLabel("Name of Spade").isVisible(), "deep link + persisted symbol rename");
  await page.keyboard.press("Escape");
  await page.getByRole("heading", { name: "Game elements", exact: true }).waitFor();
  await page.goto(`${base}/projects/${projectId}?element=missing`);
  await page.getByRole("heading", { name: "Element not found" }).waitFor();
  await page.goto(`${base}/projects/${projectId}`);

  /* --------------------------------- search + filter --------------------------------- */
  await page.getByLabel("Search elements").fill("totem");
  await pick("totem-symbol").waitFor();
  assert.equal(await pick("Alt Logo").count(), 0);
  await page.getByLabel("Search elements").fill("");
  await page.getByRole("button", { name: "Frames", exact: true }).click();
  assert.equal(await pick("Alt Logo").count(), 0);
  await pick("Gold Frame").waitFor();
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("radio", { name: "List", exact: true }).click();
  await pick("Gold Frame").waitFor();
  assert.equal(await page.getByRole("radio", { name: "List", exact: true }).getAttribute("aria-checked"), "true");
  await page.getByRole("radio", { name: "Grid", exact: true }).click();

  /* ---------------------------- persistence of everything ---------------------------- */
  await saved();
  const before = await exportBlueprint();
  assertIntegrity(before);
  await page.reload();
  await page.getByRole("heading", { name: "Game elements", exact: true }).waitFor();
  for (const name of ["Imported Totems", "Card Suits", "Empty Set", "Imperial Royals"]) await set(name).waitFor();
  for (const name of ["Eagle Title", "Gold Idol", "Joker Wild", "Gold Frame", "Night Sky", "Neon Buttons", "Banner Art", "sky-background", "Alt Logo"]) await pick(name).waitFor();
  await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
  assert.ok(await page.getByRole("button", { name: "Undo", exact: true }).isDisabled(), "history starts fresh after reload");
  assert.deepEqual((await exportBlueprint()).elements.map((e) => e.id), before.elements.map((e) => e.id));
  await context.request.get(`${base}/games`);

  /* ------------------------------------ conflicts ------------------------------------ */
  const live = await api("GET", `/api/projects/${projectId}`);
  const docOf = (b) => ({ elements: b.elements, symbols: b.symbols, specialSymbols: b.specialSymbols, assets: b.assets, paytable: b.paytable, strips: b.reels.strips, referenceAssetId: null });
  const bump = await api("PUT", `/api/projects/${projectId}/design`, { baseRevision: live.body.revision, doc: docOf(live.body.blueprint) });
  assert.equal(bump.status, 200);
  const stale = await api("PUT", `/api/projects/${projectId}/design`, { baseRevision: live.body.revision, doc: docOf(live.body.blueprint) });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, bump.body.revision);
  await pick("Eagle Title").click();
  await inspector().getByLabel("Element name").fill("Conflict Title");
  await inspector().getByLabel("Element name").press("Enter");
  await page.getByRole("alert").filter({ hasText: /changed in another tab/ }).waitFor({ timeout: 15000 });
  assert.match(await page.getByRole("status").innerText(), /Out of sync/);
  await page.getByRole("button", { name: "Overwrite with my version" }).click();
  await saved();
  assert.ok((await exportBlueprint()).elements.some((e) => e.name === "Conflict Title"));

  /* ------------------------------ server-side guarantees ------------------------------ */
  const now = await api("GET", `/api/projects/${projectId}`);
  const rev = now.body.revision;
  const send = (doc, extra = {}) => api("PUT", `/api/projects/${projectId}/design`, { baseRevision: rev, doc, ...extra });
  assert.equal((await send({})).status, 422);
  assert.equal((await send({ ...docOf(now.body.blueprint), elements: [{ ...now.body.blueprint.elements[0], type: "weapon" }] })).status, 422);
  const hostile = docOf(now.body.blueprint);
  hostile.assets = [...hostile.assets, { id: "evil", name: "x", kind: "image", uri: "https://evil.example/x.png", state: "linked", tags: [] }];
  hostile.elements = hostile.elements.map((e, i) => (i === 0 ? { ...e, type: e.type === "symbol_set" ? "other_asset" : e.type, symbolIds: [], assetId: "evil" } : e));
  assert.equal((await send(hostile)).status, 422, "external image URLs are rejected");
  assert.equal((await api("POST", `/api/projects/${projectId}/assets`, { name: "x.html", dataUrl: "data:text/html;base64,PGgxPg==" })).status, 422);
  assert.equal((await api("POST", `/api/projects/${projectId}/assets`, { name: "fake.png", dataUrl: `data:image/png;base64,${Buffer.from("not a png at all, just text").toString("base64")}` })).status, 422);
  assert.equal((await api("POST", `/api/projects/missing/assets`, { name: "a.png", dataUrl: `data:image/png;base64,${png([1, 2, 3]).toString("base64")}` })).status, 404);
  assertIntegrity(await exportBlueprint());

  /* ------------------------------------- responsive ------------------------------------- */
  for (const [width, label] of [[1024, "tablet"], [390, "phone"]]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await page.getByRole("heading", { name: "Game elements", exact: true }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no horizontal overflow at ${width}`);
    assert.equal(await page.getByRole("complementary", { name: "Inspector" }).isVisible(), false, `${label}: inspector collapsed`);
    await pick("Conflict Title").click();
    await page.getByRole("button", { name: "Toggle inspector" }).click();
    assert.equal(await inspector().getByLabel("Element name").inputValue(), "Conflict Title");
    await page.getByRole("button", { name: "Close inspector" }).first().click();
    if (width < 1024) {
      assert.equal(await page.getByRole("complementary", { name: "Project navigation" }).isVisible(), false);
      await page.getByRole("button", { name: "Toggle navigation" }).click();
      assert.ok(await page.getByRole("complementary", { name: "Project navigation" }).isVisible());
      await page.getByRole("button", { name: "Close navigation" }).click({ position: { x: 330, y: 300 } });
    }
    await page.screenshot({ path: `/tmp/design-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  /* -------------------------- existing routes keep working -------------------------- */
  await page.goto(`${base}/projects/${projectId}/settings?tab=blueprint`);
  await page.getByText("Game Blueprint (read-only JSON)").waitFor();
  await page.goto(`${base}/projects/${projectId}/settings`);
  await page.getByText("Project metadata").waitFor();
  await page.goto(`${base}/projects/prj_demo_roman_empire`);
  await page.getByRole("heading", { name: "Game elements", exact: true }).waitFor();
  assert.ok((await sets().count()) >= 3, "pre-F04 demo project opens with migrated symbol sets");
  await page.getByRole("link", { name: /Your Games/ }).click();
  await page.getByRole("heading", { name: "Roman Empire", exact: true }).waitFor();
  await page.getByRole("button", { name: "Open __F04_ACCEPTANCE__ folder" }).click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();

  assert.deepEqual(problems, []);
  console.log(JSON.stringify({ ok: true, projectId, checks: 18 }, null, 2));
} catch (error) {
  await page.screenshot({ path: "/tmp/design-failure.png" }).catch(() => undefined);
  console.error(error);
  console.error("problems:", problems);
  process.exitCode = 1;
} finally {
  if (projectId) {
    await context.request.delete(`${base}/api/projects/${projectId}`).catch(() => undefined);
    const ws = await (await context.request.get(`${base}/api/workspace`)).json().catch(() => ({ folders: [] }));
    for (const f of ws.folders.filter((x) => x.path.startsWith("__F04_ACCEPTANCE__")).sort((a, b) => b.path.length - a.path.length)) await context.request.delete(`${base}/api/folders/${f.id}`).catch(() => undefined);
  }
  await browser.close();
}
