import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"
);
const base = process.env.BASE_URL || "http://localhost:3000";
const title = `__F10_ASSETS_${Date.now()}`;

function makePng(colorType = 6, width = 64, height = 64) {
  const table = Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
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
  head[8] = 8;
  head[9] = colorType;

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width * bytesPerPixel }, () => 180)),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", head),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeJpeg(width = 64, height = 64) {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(17);
  sof[0] = 0xff;
  sof[1] = 0xc0;
  sof.writeUInt16BE(15, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  sof[9] = 3;
  const footer = Buffer.from([0xff, 0xd9]);
  return Buffer.concat([header, sof, footer]);
}

const fileItem = (name, mimeType, buffer) => ({ name, mimeType, buffer });

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});
let projectId;

const api = async (method, url, data) => {
  const res = await context.request.fetch(`${base}${url}`, {
    method,
    data,
    headers: { "content-type": "application/json" },
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
};

const blueprint = async () =>
  JSON.parse(await (await context.request.get(`${base}/api/projects/${projectId}/export`)).text());

try {
  // 1. Create a project
  const draft = {
    schema: 1,
    title,
    theme: "Roman Empire",
    folderPath: "__F10_ACCEPTANCE__",
    stylePreset: "cinematic",
    styleGuide: "",
    description: "",
    grid: { preset: "5x3", columns: 5, rows: 3 },
    evaluation: "lines",
    paylineCount: 20,
    rtpTarget: 96,
    volatility: "medium",
    status: "draft",
    symbols: { royals: 4, medium: 2, high: 3, specials: ["wild"] },
    elements: { gameTitle: true, backgrounds: 1, aspect: "16:9", reelFrames: 1, frameStyle: "themed", buttons: ["spin"] },
    referenceImage: null,
    artwork: [],
  };

  const created = await api("POST", "/api/projects", { title, theme: draft.theme, draft });
  assert.equal(created.status, 200);
  projectId = created.body.id;

  // 2. Open Asset Library
  await page.goto(`${base}/projects/${projectId}/assets`);
  await page.getByRole("heading", { name: "Asset Library", exact: false }).waitFor();
  assert.ok(await page.getByRole("complementary", { name: "Asset details" }).isVisible());

  // 3. Upload assets of different types:
  // - Transparent PNG
  // - JPEG
  // - Vector SVG
  // - Animation JSON
  const transPngFile = fileItem("coin_gold_alpha.png", "image/png", makePng(6, 128, 128));
  const jpegFile = fileItem("desert_sky.jpg", "image/jpeg", readFileSync("public/thumbs/neon-sevens.jpg"));
  const svgFile = fileItem(
    "golden_frame.svg",
    "image/svg+xml",
    Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200" viewBox="0 0 300 200"><rect width="300" height="200" fill="gold"/></svg>')
  );
  const jsonAnimFile = fileItem(
    "win_particle.json",
    "application/json",
    Buffer.from(JSON.stringify({ v: "5.5.0", fr: 60, ip: 0, op: 90, w: 400, h: 400, layers: [] }))
  );

  const fileInput = page.getByLabel("Upload project assets");
  await fileInput.setInputFiles([transPngFile, jpegFile, svgFile, jsonAnimFile]);

  // Wait for all assets to appear in library
  await page.locator('[data-asset-card="coin_gold_alpha.png"], article:has-text("coin_gold_alpha.png")').first().waitFor({ timeout: 15000 });
  await page.locator('article:has-text("desert_sky.jpg")').first().waitFor();
  await page.locator('article:has-text("golden_frame.svg")').first().waitFor();
  await page.locator('article:has-text("win_particle.json")').first().waitFor();

  // 4. Test Type Filters
  // Filter: Transparent PNG
  await page.getByRole("tab", { name: "Transparent PNG", exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator('article:has-text("coin_gold_alpha.png")').isVisible());
  assert.equal(await page.locator('article:has-text("desert_sky.jpg")').count(), 0);

  // Filter: JPEG
  await page.getByRole("tab", { name: "JPEG", exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator('article:has-text("desert_sky.jpg")').isVisible());
  assert.equal(await page.locator('article:has-text("coin_gold_alpha.png")').count(), 0);

  // Filter: Vector (SVG)
  await page.getByRole("tab", { name: "Vector (SVG)", exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator('article:has-text("golden_frame.svg")').isVisible());

  // Filter: Animation Metadata
  await page.getByRole("tab", { name: "Animation Metadata", exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator('article:has-text("win_particle.json")').isVisible());

  // Reset to All
  await page.getByRole("tab", { name: "All Assets", exact: true }).click();
  await page.waitForTimeout(200);

  // 5. Test Search Filtering
  const searchInput = page.getByLabel("Search assets");
  await searchInput.fill("coin_gold");
  await page.waitForTimeout(200);
  assert.ok(await page.locator('article:has-text("coin_gold_alpha.png")').isVisible());
  assert.equal(await page.locator('article:has-text("desert_sky.jpg")').count(), 0);

  // Clear search
  await page.getByRole("button", { name: "Clear search" }).click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator('article:has-text("desert_sky.jpg")').isVisible());

  // 6. Test View Mode: Grid and List
  await page.getByRole("radio", { name: "List", exact: true }).click();
  await page.waitForTimeout(200);
  assert.ok(await page.getByRole("table", { name: "Assets table" }).isVisible());
  assert.ok(await page.locator('tr:has-text("coin_gold_alpha.png")').isVisible());

  // Switch back to Grid
  await page.getByRole("radio", { name: "Grid", exact: true }).click();
  await page.waitForTimeout(200);

  // 7. Test Asset Selection and Details Panel
  const coinCard = page.locator('article:has-text("coin_gold_alpha.png")').first();
  await coinCard.click();
  await page.waitForTimeout(200);

  const detailsPanel = page.getByRole("complementary", { name: "Asset details" });
  assert.ok(await detailsPanel.isVisible());
  console.log("DETAILS PANEL TEXT:\n", await detailsPanel.innerText());
   assert.ok(await detailsPanel.getByText("Transparent PNG", { exact: false }).first().isVisible());
  assert.ok(await detailsPanel.getByText("128 × 128 px", { exact: false }).first().isVisible());

  // 8. Test Renaming Asset
  const nameInput = detailsPanel.getByLabel("Asset filename");
  await nameInput.fill("imperial_coin_alpha.png");
  await nameInput.press("Enter");
  await page.waitForTimeout(500);

  // Check name updated in details and card
  assert.ok(await page.locator('article:has-text("imperial_coin_alpha.png")').first().isVisible());

  // 9. Test Tags
  const tagInput = detailsPanel.getByLabel("Add asset tag");
  await tagInput.fill("gold");
  await tagInput.press("Enter");
  await page.waitForTimeout(300);
  assert.ok(await detailsPanel.getByText("#gold").first().isVisible());

  // 10. Test Asset Assignment to an Element / Symbol
  await detailsPanel.getByRole("button", { name: "Assign Asset to Element / Symbol" }).click();
  const assignModal = page.getByRole("dialog", { name: "Assign Asset to Element" });
  await assignModal.waitFor();

  // Target type: Symbol Artwork
  await assignModal.getByLabel("Target type").selectOption("symbol");
  await assignModal.getByRole("button", { name: "Assign Asset" }).click();
  await assignModal.waitFor({ state: "detached" });
  await page.waitForTimeout(500);

  // Verify usage count updated!
  assert.ok(await detailsPanel.getByText("Used by (1)").first().isVisible());
  assert.ok(await detailsPanel.getByText("Active in project").first().isVisible());
  assert.ok(await detailsPanel.getByText(/Symbol:/).first().isVisible());

  // 11. Test Deletion Safety with In-Use Asset
  await detailsPanel.getByRole("button", { name: "Delete Asset" }).click();
  const deleteModal = page.getByRole("dialog", { name: "Delete Asset in Use?" });
  await deleteModal.waitFor();

  // Verify warning displays affected items
  assert.ok(await deleteModal.getByRole("alert").isVisible());
  assert.ok(await deleteModal.getByText("Warning: This asset is currently referenced by 1 item(s):").isVisible());
  assert.ok(await deleteModal.getByText("Symbol:").first().isVisible());

  // Confirm unbind & delete
  await deleteModal.getByRole("button", { name: "Unlink & Delete Asset" }).click();
  await deleteModal.waitFor({ state: "detached" });
  await page.waitForTimeout(500);

  // Verify asset was removed and blueprint remains 100% valid
  assert.equal(await page.locator('article:has-text("imperial_coin_alpha.png")').count(), 0);
  let bp = await blueprint();
  assert.equal(bp.assets.some((a) => a.name === "imperial_coin_alpha.png"), false);
  // Ensure symbol that used it was safely unlinked to null without corruption
  assert.equal(bp.symbols[0].assetId, null);

  // 12. Test Deleting an Unused Asset
  const skyCard = page.locator('article:has-text("desert_sky.jpg")').first();
  await skyCard.click();
  await detailsPanel.getByRole("button", { name: "Delete Asset" }).click();
  const deleteUnusedModal = page.getByRole("dialog", { name: "Delete Asset" });
  await deleteUnusedModal.waitFor();
  assert.ok(await deleteUnusedModal.getByText("This asset is not in use.").isVisible());
  await deleteUnusedModal.getByRole("button", { name: "Delete Asset" }).click();
  await deleteUnusedModal.waitFor({ state: "detached" });
  await page.waitForTimeout(500);
  assert.equal(await page.locator('article:has-text("desert_sky.jpg")').count(), 0);

  // 13. Test Persistence across page refresh
  await page.reload();
  await page.getByRole("heading", { name: "Asset Library", exact: false }).waitFor();
  await page.waitForTimeout(600);

  // Remaining assets (SVG and JSON anim) must still be present
  assert.ok(await page.locator('article:has-text("golden_frame.svg")').first().isVisible());
  assert.ok(await page.locator('article:has-text("win_particle.json")').first().isVisible());

  bp = await blueprint();
  assert.ok(bp.assets.some((a) => a.name === "golden_frame.svg"));
  assert.ok(bp.assets.some((a) => a.name === "win_particle.json"));

  assert.deepEqual(problems, []);
  console.log(JSON.stringify({ ok: true, projectId, checks: "all F10 asset library acceptance tests passed" }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (projectId) {
    await context.request.delete(`${base}/api/projects/${projectId}`).catch(() => undefined);
    const ws = await (await context.request.get(`${base}/api/workspace`)).json().catch(() => ({ folders: [] }));
    for (const f of (ws.folders ?? []).filter((x) => x.path.startsWith("__F10_ACCEPTANCE__")).sort((a, b) => b.path.length - a.path.length)) {
      await context.request.delete(`${base}/api/folders/${f.id}`).catch(() => undefined);
    }
  }
  await browser.close();
}
