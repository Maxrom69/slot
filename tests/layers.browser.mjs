import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright"
);
const base = process.env.BASE_URL || "http://localhost:3000";
const title = `__F06_LAYERS_${Date.now()}`;

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
let projectId;

const api = async (method, url, data) => {
  const res = await context.request.fetch(`${base}${url}`, {
    method,
    data,
    headers: { "content-type": "application/json" },
  });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
};

const saved = async () => {
  await page.waitForTimeout(1000);
  await page.getByRole("status").filter({ hasText: /^\s*Saved\s*$/ }).waitFor({ timeout: 15000 });
};

const layersPanel = () => page.getByRole("complementary", { name: "Layers panel" });
const surface = () => page.getByRole("application", { name: "Scene canvas" });
const blueprint = async () => JSON.parse(await (await context.request.get(`${base}/api/projects/${projectId}/export`)).text());

try {
  // 1. Create a test project with shapes and elements
  const draft = {
    schema: 1,
    title,
    theme: "Jungle Temple",
    folderPath: "__F06_ACCEPTANCE__",
    stylePreset: "cartoon",
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

  // 2. Open Canvas
  await page.goto(`${base}/projects/${projectId}/canvas`);
  await surface().waitFor();
  await saved();

  // Check Background layer defaults to locked in blueprint
  let bp = await blueprint();
  const bgLayer = bp.layers.find((l) => l.kind === "background" || l.id === "layer-bg");
  assert.ok(bgLayer, "background layer exists in blueprint");
  assert.equal(bgLayer.locked, true, "background layer is locked by default");

  // 3. Right-side Layers Panel should be visible by default
  await page.getByRole("tab", { name: /^Layers/ }).waitFor();
  assert.ok(await layersPanel().isVisible(), "right-side layers panel is visible");
  assert.ok(await layersPanel().getByRole("heading", { name: "Layers", exact: true }).isVisible());

  // 4. Create some test objects on canvas
  const canvasBounds = await surface().boundingBox();
  const cx = canvasBounds.x + canvasBounds.width / 2;
  const cy = canvasBounds.y + canvasBounds.height / 2;

  // Add Rectangle
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await page.mouse.move(cx - 150, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx - 30, cy - 20);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Add Ellipse
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();
  await page.mouse.move(cx + 20, cy - 100);
  await page.mouse.down();
  await page.mouse.move(cx + 140, cy - 20);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Add Text
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await surface().click({ position: { x: 300, y: 150 } });
  await page.waitForTimeout(300);

  await saved();

  // Switch to Select tool
  await page.getByRole("button", { name: "Select", exact: true }).click();

  // 5. Inspect Layers Panel rows
  const rowCount = await page.locator("[data-layer-row-id]").count();
  assert.ok(rowCount >= 3, "layer rows created for objects");

  // Check each layer row has: thumbnail, name, visibility button, lock button
  const firstRow = page.locator("[data-layer-row-id]").first();
  assert.ok(await firstRow.locator("svg, img, span").count() > 0, "has thumbnail");
  assert.ok(await firstRow.getByRole("button", { name: /Hide|Show/ }).count() > 0, "has visibility toggle");
  assert.ok(await firstRow.getByRole("button", { name: /Lock|Unlock/ }).count() > 0, "has lock toggle");

  // 6. Test Multi-Selection with Shift-Click in Layers Panel
  const allRows = page.locator("[data-layer-row-id]");
  const r1 = allRows.nth(0);
  const r2 = allRows.nth(1);

  await r1.click();
  await page.waitForTimeout(100);
  assert.equal(await r1.getAttribute("aria-selected"), "true");
  assert.equal(await r2.getAttribute("aria-selected"), "false");

  // Shift-click second row
  await page.keyboard.down("Shift");
  await r2.click();
  await page.keyboard.up("Shift");
  await page.waitForTimeout(100);

  assert.equal(await r1.getAttribute("aria-selected"), "true");
  assert.equal(await r2.getAttribute("aria-selected"), "true");
  assert.match(await page.locator(".canvas-hud").innerText(), /2 selected/, "canvas selection synchronized with layers panel");

  // 7. Test Grouping: "Create Group"
  const groupBtn = layersPanel().getByRole("button", { name: "Group", exact: true });
  assert.equal(await groupBtn.isEnabled(), true, "group button is enabled when multi-selected");
  await groupBtn.click();
  await page.waitForTimeout(300);
  await saved();

  // Grouped item should appear with group icon and expand/collapse
  const groupRow = page.locator("[data-layer-row-id]").filter({ hasText: /Group/ }).first();
  await groupRow.waitFor();
  assert.ok(await groupRow.getByRole("button", { name: /Collapse|Expand/ }).isVisible(), "group has expand/collapse button");

  // Test Collapse & Expand Group
  await groupRow.getByRole("button", { name: /Collapse/ }).click();
  await page.waitForTimeout(150);
  assert.ok(await groupRow.getByRole("button", { name: /Expand/ }).isVisible(), "group is now collapsed");
  await groupRow.getByRole("button", { name: /Expand/ }).click();
  await page.waitForTimeout(150);
  assert.ok(await groupRow.getByRole("button", { name: /Collapse/ }).isVisible(), "group is now expanded");

  // Check group persistence in blueprint
  bp = await blueprint();
  const groupInBp = bp.scenes[0].objects.find((o) => o.kind === "group");
  assert.ok(groupInBp, "group object stored in blueprint");
  const childrenInBp = bp.scenes[0].objects.filter((o) => o.groupId === groupInBp.id);
  assert.equal(childrenInBp.length, 2, "children have groupId pointing to group");

  // 8. Test Layer Reordering: Move Up / Move Down buttons
  const initialTopId = await page.locator("[data-layer-row-id]").first().getAttribute("data-layer-row-id");
  await page.locator("[data-layer-row-id]").first().click();
  await layersPanel().getByRole("button", { name: "Move layer down (background)" }).click();
  await page.waitForTimeout(200);
  await saved();
  const newTopId = await page.locator("[data-layer-row-id]").first().getAttribute("data-layer-row-id");
  assert.notEqual(initialTopId, newTopId, "layer moved down, top item changed");

  // Move back up
  await page.locator(`[data-layer-row-id="${initialTopId}"]`).click();
  await layersPanel().getByRole("button", { name: "Move layer up (foreground)" }).click();
  await page.waitForTimeout(200);
  await saved();

  // 9. Test Visibility and Lock toggles on Layer Row
  const targetRow = page.locator("[data-layer-row-id]").first();
  const targetId = await targetRow.getAttribute("data-layer-row-id");

  // Toggle Visibility
  await targetRow.getByRole("button", { name: /Hide/ }).click();
  await page.waitForTimeout(200);
  await saved();
  bp = await blueprint();
  const hiddenObj = bp.scenes[0].objects.find((o) => o.id === targetId);
  if (hiddenObj) {
    assert.equal(hiddenObj.visible, false, "object visibility persisted as false");
  }

  // Toggle back visible
  await targetRow.getByRole("button", { name: /Show/ }).click();
  await page.waitForTimeout(200);

  // Toggle Lock
  await targetRow.getByRole("button", { name: /Lock/ }).click();
  await page.waitForTimeout(200);
  await saved();
  bp = await blueprint();
  const lockedObj = bp.scenes[0].objects.find((o) => o.id === targetId);
  if (lockedObj) {
    assert.equal(lockedObj.locked, true, "object lock persisted as true");
  }
  // Unlock
  await targetRow.getByRole("button", { name: /Unlock/ }).click();
  await page.waitForTimeout(200);

  // 10. Test Duplicate from Layers Panel
  const independentRow = page.locator("[data-layer-row-id]").filter({ hasNotText: /Group/ }).first();
  const indepId = await independentRow.getAttribute("data-layer-row-id");
  await independentRow.click();
  const countBeforeDup = await page.locator("[data-layer-row-id]").count();
  await layersPanel().getByRole("button", { name: "Duplicate selected layer" }).click();
  await page.waitForTimeout(300);
  await saved();
  const countAfterDup = await page.locator("[data-layer-row-id]").count();
  assert.ok(countAfterDup > countBeforeDup, "duplicate creates new row");

  // 11. Test Ungroup
  const groupRowToUngroup = page.locator(`[data-layer-row-id="${groupInBp.id}"]`);
  await groupRowToUngroup.click();
  const ungroupBtn = layersPanel().getByRole("button", { name: "Ungroup", exact: true });
  assert.equal(await ungroupBtn.isEnabled(), true, "ungroup button is enabled when group is selected");
  await ungroupBtn.click();
  await page.waitForTimeout(300);
  await saved();

  bp = await blueprint();
  assert.equal(bp.scenes[0].objects.some((o) => o.id === groupInBp.id), false, "group container removed in blueprint");
  assert.equal(bp.scenes[0].objects.some((o) => o.groupId === groupInBp.id), false, "children unlinked from group");

  // 12. Test Selection Synchronization between Layers Panel and Inspector Tab
  const sampleRow = page.locator("[data-layer-row-id]").first();
  const sampleId = await sampleRow.getAttribute("data-layer-row-id");
  await sampleRow.click();

  // Switch to Inspector tab
  await page.getByRole("tab", { name: "Inspector" }).click();
  await page.waitForTimeout(150);
  const inspectorName = await page.getByRole("complementary", { name: "Object properties" }).getByLabel("Object name").inputValue();
  assert.ok(inspectorName.length > 0, "inspector displays selected object properties");

  // Test Blend Mode selection in Inspector
  const blendSelect = page.getByRole("complementary", { name: "Object properties" }).getByLabel("Blend Mode");
  await blendSelect.selectOption("screen");
  await page.waitForTimeout(200);
  await saved();
  bp = await blueprint();
  const blendedObj = bp.scenes[0].objects.find((o) => o.id === sampleId);
  if (blendedObj) {
    assert.equal(blendedObj.blendMode, "screen", "blendMode persisted in blueprint");
  }

  // Switch back to Layers tab
  await page.getByRole("tab", { name: /^Layers/ }).click();
  await page.waitForTimeout(150);
  assert.ok(await layersPanel().isVisible(), "layers panel tab restored");

  // 13. Test Persistence across page reload
  await page.reload();
  await surface().waitFor();
  await page.waitForTimeout(600);
  await saved();

  bp = await blueprint();
  assert.ok(bp.scenes[0].objects.length >= 3, "objects persisted across reload");

  assert.deepEqual(problems, []);
  console.log(JSON.stringify({ ok: true, projectId, checks: "all F06 layer tests passed" }, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  if (projectId) {
    await context.request.delete(`${base}/api/projects/${projectId}`).catch(() => undefined);
    const ws = await (await context.request.get(`${base}/api/workspace`)).json().catch(() => ({ folders: [] }));
    for (const f of (ws.folders ?? []).filter((x) => x.path.startsWith("__F06_ACCEPTANCE__")).sort((a, b) => b.path.length - a.path.length)) {
      await context.request.delete(`${base}/api/folders/${f.id}`).catch(() => undefined);
    }
  }
  await browser.close();
}
