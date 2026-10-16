import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = process.env.BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [], projectPosts = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/projects") projectPosts.push(request); });
const title = `__F03_ACCEPTANCE_${Date.now()}`;
let createdId;

function pngNoise(width = 1100, height = 1100) {
  const table = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc = (buffer) => { let c = 0xffffffff; for (const byte of buffer) c = table[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4); size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, checksum]); };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let r = 0; r < height; r++) randomBytes(width * 3).copy(raw, r * (width * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const saved = async () => page.getByText("Draft saved locally", { exact: true }).waitFor();
const draftDocument = async () => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open("slots-studio", 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction("creation-drafts", "readonly"), read = tx.objectStore("creation-drafts").get("current-manual-project");
    read.onsuccess = () => { const doc = read.result; db.close(); resolve(doc ? { form: { ...doc.form, artwork: doc.form.artwork.map((a) => ({ ...a, dataUrl: "omitted" })), referenceImage: doc.form.referenceImage ? { ...doc.form.referenceImage, dataUrl: "omitted" } : null }, blueprint: { ...doc.blueprint, assets: doc.blueprint.assets.map((a) => ({ ...a, uri: a.uri?.startsWith("data:") ? "embedded" : a.uri })) } } : null); };
    read.onerror = () => reject(read.error);
  };
}));

try {
  await page.goto(`${base}/games`);
  await page.getByRole("button", { name: /New Game$/ }).click();
  await page.waitForURL("**/games/new"); await saved();
  assert.equal(await page.getByRole("tab", { name: "Manual" }).getAttribute("aria-selected"), "true");
  await page.screenshot({ path: "/tmp/creation-default.png", fullPage: false });

  await page.getByRole("button", { name: "Create Game" }).click();
  await page.getByText("Give your game a title.", { exact: true }).first().waitFor();
  assert.equal(await page.getByLabel("Game title", { exact: true }).evaluate((el) => el === document.activeElement), true);
  await page.getByRole("tab", { name: /Agent/ }).click();
  await page.getByRole("heading", { name: "AI Assistant — Coming Soon" }).waitFor();
  assert.equal(await page.locator("input, textarea").count(), 0);
  await page.keyboard.press("Control+Enter"); assert.equal(projectPosts.length, 0);
  await page.screenshot({ path: "/tmp/creation-agent.png" });
  await page.getByRole("button", { name: "Continue with Manual" }).click();

  await page.getByLabel("Game title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Neon Arcade", exact: true }).click();
  await page.getByLabel("Style guide", { exact: true }).fill("Cyan chrome with restrained magenta accents");
  await page.getByLabel("Folder", { exact: true }).fill("__F03_ACCEPTANCE__/Nested");
  for (const [preset, reels, rows] of [["5 × 3", 5, 3], ["5 × 4", 5, 4], ["6 × 3", 6, 3], ["6 × 4", 6, 4]]) {
    await page.getByRole("button", { name: preset, exact: true }).click();
    assert.equal(await page.getByLabel("reels count", { exact: true }).inputValue(), String(reels));
    assert.equal(await page.getByLabel("rows count", { exact: true }).inputValue(), String(rows));
  }
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await page.getByRole("button", { name: "Increase reels", exact: true }).click();
  assert.equal(await page.getByLabel("reels count").inputValue(), "7");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  assert.equal(await page.getByLabel("reels count").inputValue(), "6");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByLabel("rows count").fill("5");
  await page.getByLabel("high symbols count").fill("4");
  await page.getByLabel("medium symbols count").fill("1");
  await page.getByLabel("royals count").fill("5");
  await page.getByLabel("special symbols count").fill("2");
  await page.getByLabel("backgrounds count").fill("2");
  await page.getByRole("button", { name: "21:9", exact: true }).click();
  await page.getByRole("button", { name: "Ornate", exact: true }).click();
  await page.getByRole("button", { name: "Max Bet", exact: true }).click();
  await page.getByRole("button", { name: "Turbo", exact: true }).click();
  await page.locator("summary").filter({ hasText: "Add a project description" }).click();
  await page.getByLabel("Description").fill("An imported-art, manual-first test project.");
  await page.locator("summary").filter({ hasText: "Advanced configuration" }).click();
  await page.getByLabel("Evaluation", { exact: true }).selectOption("ways");
  await page.getByLabel("RTP target", { exact: true }).fill("95.2");
  await page.getByLabel("Volatility", { exact: true }).selectOption("high");
  await page.getByLabel("Initial status").selectOption("blueprint");

  await page.getByLabel("Import reference image").setInputFiles("public/thumbs/temple-riches.jpg");
  await page.getByAltText("Reference artwork", { exact: true }).waitFor();
  await page.getByLabel("Import game artwork").setInputFiles("public/thumbs/roman-empire.jpg");
  await page.getByLabel("Artwork name", { exact: true }).waitFor();
  await page.getByLabel("Artwork name", { exact: true }).fill("Imported Background.jpg");
  await page.getByLabel("Element type for Imported Background.jpg").selectOption("game_background");
  const noise = pngNoise();
  await page.getByLabel("Import game artwork").setInputFiles([1,2,3].map((n) => ({ name: `texture-${n}.png`, mimeType: "image/png", buffer: noise })));
  assert.equal(await page.getByRole("button", { name: "Create Game" }).isDisabled(), true);
  await page.getByLabel("Element type for texture-3.png").waitFor({ timeout: 45000 });
  await saved();
  await page.screenshot({ path: "/tmp/creation-filled.png" });
  const before = await draftDocument();
  assert.equal(before.form.artwork.length, 4);
  assert.ok(before.form.artwork.reduce((sum, a) => sum + a.bytes, 0) > 5 * 1024 * 1024, "Test exceeds the previous localStorage artwork limit");
  assert.equal(before.blueprint.creation.mode, "manual");
  assert.equal(before.blueprint.assets.filter((a) => a.uri === "embedded").length, 5);

  await page.reload(); await saved();
  assert.equal(await page.getByLabel("Game title", { exact: true }).inputValue(), title);
  assert.equal(await page.getByLabel("reels count").inputValue(), "7");
  assert.equal(await page.getByLabel("rows count").inputValue(), "5");
  assert.equal(await page.getByLabel("high symbols count").inputValue(), "4");
  assert.equal(await page.getByLabel("special symbols count").inputValue(), "2");
  assert.equal(await page.getByLabel("Artwork name", { exact: true }).count(), 4);
  await page.getByAltText("Reference artwork", { exact: true }).waitFor();
  const after = await draftDocument(); assert.deepEqual(after.form, before.form);

  await page.getByRole("button", { name: "Inspect Game Blueprint" }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download draft" }).click();
  const download = await downloading; assert.match(download.suggestedFilename(), /\.draft\.blueprint\.json$/);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).last().click();
  await page.getByRole("button", { name: "Reset form", exact: true }).click();
  await page.getByRole("button", { name: "Reset draft", exact: true }).click();
  assert.equal(await page.getByLabel("Game title", { exact: true }).inputValue(), "");
  await page.keyboard.press("Control+z");
  assert.equal(await page.getByLabel("Game title", { exact: true }).inputValue(), title);
  assert.equal(await page.getByLabel("Artwork name", { exact: true }).count(), 4);
  await saved();

  for (const width of [900, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
    assert.ok(await page.getByRole("button", { name: "Create Game" }).isVisible());
    await page.screenshot({ path: `/tmp/creation-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForURL("**/games");
  await page.getByRole("button", { name: /New Game$/ }).click();
  await saved();
  assert.equal(await page.getByLabel("Game title", { exact: true }).inputValue(), title);
  assert.equal(await page.getByLabel("Artwork name", { exact: true }).count(), 4);

  await page.getByRole("button", { name: "Create Game" }).click();
  await page.keyboard.press("Control+Enter");
  await page.waitForURL(/\/projects\/prj_/, { timeout: 45000 });
  createdId = new URL(page.url()).pathname.split("/").at(-1);
  await page.getByRole("heading", { name: "Game elements", exact: true }).waitFor();
  assert.equal(projectPosts.length, 1, "Repeated submit only creates one project");
  const response = await context.request.get(`${base}/api/projects/${createdId}`);
  assert.equal(response.status(), 200);
  const project = await response.json();
  assert.equal(project.title, title); assert.equal(project.folderPath, "__F03_ACCEPTANCE__/Nested");
  assert.equal(project.blueprint.reels.columns, 7); assert.equal(project.blueprint.reels.rows, 5);
  assert.equal(project.blueprint.creation.stylePreset, "neon");
  assert.equal(project.blueprint.creation.artwork.length, 4);
  assert.equal(project.blueprint.creation.symbolPlan.specials.length, 2);
  assert.equal(project.blueprint.creation.elements.frameStyle, "ornate");
  assert.deepEqual(project.blueprint.creation.elements.buttons, ["spin", "max", "auto", "turbo"]);
  assert.equal(project.blueprint.math.rtpTarget, 95.2);
  assert.equal(project.blueprint.canvas.width, 2560);
  assert.equal(project.blueprint.assets.filter((a) => a.uri?.startsWith("/api/assets/")).length, 5);
  const asset = await context.request.get(`${base}${project.thumbnailUri}`);
  assert.equal(asset.status(), 200); assert.equal(asset.headers()["content-type"], "image/jpeg");
  assert.equal(await draftDocument(), null, "Created draft is cleared after all prior writes complete");
  await page.screenshot({ path: "/tmp/creation-design.png" });

  await page.getByRole("link", { name: /Your Games/ }).click();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: title, exact: true }).waitFor();

  const good = { ...before.form, title: "Rejected input", folderPath: "__F03_REJECTED__/Nested", referenceImage: null, artwork: [] };
  const invalid = await context.request.post(`${base}/api/projects`, { data: { title: good.title, theme: good.theme, draft: { ...good, artwork: [{ ...imageStub(), elementType: "other_asset" }] } } });
  assert.equal(invalid.status(), 422);
  const invalidBinary = await context.request.post(`${base}/api/projects`, { data: { title: good.title, theme: good.theme, draft: { ...good, artwork: [{ ...imageStub(), dataUrl: `data:image/png;base64,${Buffer.from("not an actual PNG file").toString("base64")}`, elementType: "other_asset" }] } } });
  assert.equal(invalidBinary.status(), 422);
  const malformed = await context.request.post(`${base}/api/projects`, { data: "{", headers: { "content-type": "application/json" } });
  assert.equal(malformed.status(), 400);
  const workspace = await (await context.request.get(`${base}/api/workspace`)).json();
  assert.equal(workspace.folders.some((f) => f.path.startsWith("__F03_REJECTED__")), false, "Invalid artwork rolls back folder creation");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, checks: ["manual and reserved agent", "required fields", "all grid presets and custom", "all counts", "undo/redo", "large artwork import", "full draft and blueprint persistence", "cancel/resume", "draft download", "responsive layouts", "single atomic creation", "Design workspace", "live dashboard and refresh", "served artwork", "malformed imports rejected", "no browser errors"], projectId: createdId, persistedArtworkBytes: before.form.artwork.reduce((sum, a) => sum + a.bytes, 0) }, null, 2));
} catch (error) {
  await page.screenshot({ path: "/tmp/creation-failure.png" }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  if (createdId) {
    await context.request.delete(`${base}/api/projects/${createdId}`);
    const workspace = await (await context.request.get(`${base}/api/workspace`)).json();
    const folders = workspace.folders.filter((f) => f.path.startsWith("__F03_ACCEPTANCE__")).sort((a, b) => b.path.length - a.path.length);
    for (const folder of folders) await context.request.delete(`${base}/api/folders/${folder.id}`);
  }
  await browser.close();
}
function imageStub() { return { id: "invalid", name: "Invalid.html", dataUrl: "data:text/html;base64,PGgxPg==", mime: "image/png", width: 1, height: 1, bytes: 4 }; }
