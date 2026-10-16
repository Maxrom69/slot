import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const base = process.env.BASE_URL || "http://localhost:3000";
const title = `__F05_ACCEPTANCE_${Date.now()}`;

function png(rgb, size = 64) {
  const table = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const n = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([n, data]))); return Buffer.concat([len, n, data, sum]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(size, 0); head.writeUInt32BE(size, 4); head[8] = 8; head[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
let projectId;

const api = async (method, url, data) => {
  const res = await context.request.fetch(`${base}${url}`, { method, data, headers: { "content-type": "application/json" } });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
};
const saved = async () => { await page.waitForTimeout(1000); await page.getByRole("status").filter({ hasText: /^\s*Saved\s*$/ }).waitFor({ timeout: 15000 }); };
const surface = () => page.getByRole("application", { name: "Scene canvas" });
const centre = async () => { const b = (await surface().boundingBox()); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const drag = async (from, to, options = {}) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const step of options.via ?? []) await page.mouse.move(step.x, step.y, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: options.steps ?? 10 });
  await page.mouse.up();
};
const objectBox = async (index) => (await page.locator("[data-object-id]").nth(index).boundingBox());
const objects = () => page.locator("[data-object-id]").count();
// style.left/top are scene (world) coordinates, so assertions stay zoom-independent.
const worldLeft = async (index) => Number((await page.locator("[data-object-id]").nth(index).evaluate((el) => el.style.left)).replace("px", ""));
const worldTop = async (index) => Number((await page.locator("[data-object-id]").nth(index).evaluate((el) => el.style.top)).replace("px", ""));
const worldWidth = async (index) => Number((await page.locator("[data-object-id]").nth(index).evaluate((el) => el.style.width)).replace("px", ""));
const props = () => page.getByRole("complementary", { name: "Object properties" });
const selectedCount = async () => Number(await page.locator(".canvas-hud").innerText().then((t) => /(\d+) selected/.exec(t)?.[1] ?? "0"));
const blueprint = async () => JSON.parse(await (await context.request.get(`${base}/api/projects/${projectId}/export`)).text());

try {
  const draft = { schema: 1, title, theme: "Neon Arcade", folderPath: "__F05_ACCEPTANCE__", stylePreset: "neon", styleGuide: "", description: "", grid: { preset: "5x3", columns: 5, rows: 3 }, evaluation: "lines", paylineCount: 20, rtpTarget: 96, volatility: "medium", status: "draft",
    symbols: { royals: 4, medium: 2, high: 3, specials: ["wild"] }, elements: { gameTitle: true, backgrounds: 1, aspect: "16:9", reelFrames: 1, frameStyle: "themed", buttons: ["spin"] }, referenceImage: null, artwork: [] };
  const created = await api("POST", "/api/projects", { title, theme: draft.theme, draft });
  assert.equal(created.status, 200);
  projectId = created.body.id;

  await page.goto(`${base}/projects/${projectId}/canvas`);
  await surface().waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/canvas-empty.png" });

  /* ------------------------------- tool infrastructure ------------------------------- */
  const toolbar = page.getByRole("toolbar", { name: "Tools" });
  const toolButtons = await toolbar.getByRole("button").count();
  assert.equal(toolButtons, 17, "13 working tools plus 4 reserved raster tools");
  // Raster pixel tools are registered but not implemented: shown disabled with a reason.
  for (const label of ["Pixel paint (unavailable)", "Pixel eraser (unavailable)", "Pixel blur (unavailable)", "Pixel eyedropper (unavailable)"]) {
    const button = toolbar.getByRole("button", { name: label, exact: true });
    await button.waitFor();
    assert.equal(await button.isDisabled(), true, `${label} is disabled`);
    assert.match(await button.getAttribute("title"), /not part of this phase|raster editing/);
  }
  assert.equal(await toolbar.getByRole("button", { name: "Select", exact: true }).getAttribute("aria-pressed"), "true");

  /* ------------------------------- create with tools ------------------------------- */
  const origin = await centre();
  await page.getByRole("button", { name: "Rectangle", exact: true }).click();
  await drag({ x: origin.x - 140, y: origin.y - 100 }, { x: origin.x - 20, y: origin.y }, { via: [{ x: origin.x - 80, y: origin.y - 40 }] });
  assert.equal(await objects(), 1, "shape tool created an object");
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();
  await drag({ x: origin.x + 20, y: origin.y - 120 }, { x: origin.x + 120, y: origin.y - 20 });
  assert.equal(await objects(), 2);
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await surface().click({ position: { x: 300, y: 90 } });
  assert.equal(await objects(), 3);
  await page.getByRole("button", { name: "Line", exact: true }).click();
  await drag({ x: origin.x - 160, y: origin.y + 40 }, { x: origin.x + 40, y: origin.y + 90 });
  assert.equal(await objects(), 4);
  await page.getByRole("button", { name: "Arrow", exact: true }).click();
  await drag({ x: origin.x + 60, y: origin.y + 60 }, { x: origin.x + 170, y: origin.y + 110 });
  assert.equal(await objects(), 5);
  await page.getByRole("button", { name: "Draw", exact: true }).click();
  await drag(origin, { x: origin.x + 130, y: origin.y + 150 }, { via: [{ x: origin.x + 60, y: origin.y + 100 }] });
  assert.equal(await objects(), 6);
  await page.getByRole("button", { name: "Triangle", exact: true }).click();
  await drag({ x: origin.x + 190, y: origin.y - 40 }, { x: origin.x + 250, y: origin.y + 20 });
  assert.equal(await objects(), 7);
  await saved();
  let bp = await blueprint();
  assert.equal(bp.scenes[0].objects.length, 7, "all created objects persisted");
  assert.equal(bp.scenes[0].objects[0].shape, "rect");
  assert.equal(bp.scenes[0].objects[3].points.length, 2, "line keeps its direction");
  assert.equal(bp.scenes[0].objects[5].points.length > 2, true, "freehand path stored");

  /* --------------------------------- select + handles --------------------------------- */
  await page.getByRole("button", { name: "Select", exact: true }).click();
  const first = await objectBox(0);
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2);
  assert.equal(await selectedCount(), 1, "click selects");
  await page.screenshot({ path: "/tmp/canvas-selected.png" });
  const handles = await page.locator("[data-handle]").count();
  assert.equal(handles, 9, "eight resize handles plus the rotate handle");
  assert.equal(await props().getByLabel("Object name").inputValue(), "Rect 1");

  await page.keyboard.down("Shift");
  const second = await objectBox(1);
  await page.mouse.click(second.x + second.width / 2, second.y + second.height / 2);
  await page.keyboard.up("Shift");
  assert.equal(await selectedCount(), 2, "shift-click adds to the selection");
  assert.ok(await props().getByText(/2 objects selected/).isVisible(), "multi-selection reported");

  /* ----------------------------------- marquee ----------------------------------- */
  await page.keyboard.press("Escape");
  assert.equal(await selectedCount(), 0);
  await drag({ x: origin.x - 170, y: origin.y - 140 }, { x: origin.x + 140, y: origin.y + 20 }, { steps: 6 });
  assert.equal(await selectedCount(), 2, "drag selection picks intersecting objects");

  /* ------------------------------------- move ------------------------------------- */
  const before = await objectBox(0);
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  const after = await objectBox(0);
  assert.ok(Math.abs(after.x - before.x - 60) < 14, `moved right (${Math.round(after.x - before.x)}px)`);
  await saved();

  /* ------------------------------ keyboard nudging ------------------------------ */
  await page.keyboard.press("Escape");
  await page.mouse.click((await objectBox(0)).x + 8, (await objectBox(0)).y + 8);
  const nx = await worldLeft(0), ny = await worldTop(0);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(120);
  assert.equal(await worldLeft(0), nx + 1, "arrow moves 1px");
  assert.equal(await worldTop(0), ny + 1);
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  await page.waitForTimeout(120);
  assert.equal(await worldLeft(0), nx + 11, "shift+arrow moves 10px more");
  await saved();

  /* ----------------------------- resize + rotate ----------------------------- */
  await page.keyboard.press("Escape");
  const target = await objectBox(0);
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
  const corner = { x: target.x + target.width, y: target.y + target.height };
  await drag(corner, { x: corner.x + 40, y: corner.y + 30 });
  const resizedWorld = await worldWidth(0);
  assert.ok(resizedWorld > (await worldWidth(0)) - resizedWorld + 20, "resized larger");
  await saved();

  const rotateArm = page.locator('[data-handle="rotate"]');
  assert.equal(await rotateArm.count(), 1);
  const box = await objectBox(0);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const arm = await rotateArm.boundingBox();
  await drag({ x: arm.x + arm.width / 2, y: arm.y + arm.height / 2 }, { x: arm.x + arm.width / 2 + 60, y: arm.y + arm.height / 2 + 40 });
  await saved();
  assert.ok((await blueprint()).scenes[0].objects[0].rotation !== 0, "rotation persisted");
  await page.screenshot({ path: "/tmp/canvas-transformed.png" });

  /* ---------------------------------- snapping ---------------------------------- */
  const guides = async () => page.locator("svg line[stroke='#f0b429']").count();
  await page.keyboard.press("Escape");
  const snapSource = await objectBox(1);
  await page.mouse.click(snapSource.x + snapSource.width / 2, snapSource.y + snapSource.height / 2);
  await page.mouse.move(snapSource.x + snapSource.width / 2, snapSource.y + snapSource.height / 2);
  await page.mouse.down();
  await page.mouse.move(snapSource.x + snapSource.width / 2 - 6, snapSource.y + snapSource.height / 2, { steps: 5 });
  const guideCount = await guides();
  await page.mouse.up();
  assert.ok(guideCount > 0, "a snap guide is drawn while dragging near another object");
  await saved();

  /* ------------------------------ grid / snap / safe ------------------------------ */
  const overlays = async () => page.locator(".canvas-grid").count();
  await page.getByRole("radio", { name: "No grid", exact: true }).click();
  assert.equal(await overlays(), 0);
  await page.getByRole("radio", { name: "Grid", exact: true }).click();
  assert.equal(await overlays(), 1);
  const safe = async () => page.locator(".canvas-safe").count();
  await page.getByRole("button", { name: "Safe", exact: true }).click();
  assert.equal(await safe(), 0);
  await page.getByRole("button", { name: "Safe", exact: true }).click();
  assert.equal(await safe(), 1);
  await page.getByRole("button", { name: "Snap", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Snap", exact: true }).getAttribute("aria-pressed"), "false");
  await page.getByRole("button", { name: "Snap", exact: true }).click();

  /* ------------------------------- pan and zoom ------------------------------- */
  const hud = () => page.locator(".canvas-hud").innerText();
  const startPercent = Number(/(\d+)%/.exec(await hud())[1]);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.ok(Number(/(\d+)%/.exec(await hud())[1]) > startPercent, "zoom in increases the scale");
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  assert.equal(Number(/(\d+)%/.exec(await hud())[1]), startPercent, "zoom out restores it");
  await page.getByRole("button", { name: "Reset zoom to 100%" }).click();
  assert.equal(Number(/(\d+)%/.exec(await hud())[1]), 100, "reset returns to 100%");
  // Plain wheel pans; ctrl/cmd+wheel zooms about the cursor.
  await surface().dispatchEvent("wheel", { deltaY: 40, deltaX: 0, clientX: origin.x, clientY: origin.y, cancelable: true });
  await page.waitForTimeout(150);
  assert.equal(Number(/(\d+)%/.exec(await hud())[1]), 100, "plain wheel pans without zooming");
  await surface().dispatchEvent("wheel", { deltaY: -240, ctrlKey: true, clientX: origin.x, clientY: origin.y, cancelable: true });
  await page.waitForTimeout(150);
  assert.ok(Number(/(\d+)%/.exec(await hud())[1]) > 100, "ctrl+wheel zooms in");
  await page.getByRole("button", { name: "Zoom to fit" }).click();
  assert.match(await hud(), /100%|[4-9]\d%/);
  // space+drag pans
  const fitScale = Number(/(\d+)%/.exec(await hud())[1]) / 100;
  await page.keyboard.down(" ");
  const panFrom = await centre();
  await drag(panFrom, { x: panFrom.x + 70, y: panFrom.y + 40 });
  await page.keyboard.up(" ");
  assert.match(await hud(), /100%|[4-9]\d%/, "panning does not change zoom");
  await page.getByRole("button", { name: "Zoom to fit" }).click();

  /* --------------------------- library placement + panels --------------------------- */
  await page.getByRole("complementary", { name: "Canvas panel" }).getByTitle("Place Wild", { exact: true }).click();
  assert.equal(await objects(), 8, "placing a symbol adds an object");
  await page.getByRole("complementary", { name: "Canvas panel" }).getByRole("button", { name: /Game Title/ }).first().click();
  assert.equal(await objects(), 9);
  await saved();
  bp = await blueprint();
  assert.equal(bp.scenes[0].objects[7].kind, "symbol");
  assert.equal(bp.scenes[0].objects[7].refId, bp.symbols.find((s) => s.name === "Wild").id);

  // layers: hide the first layer and check its objects stop rendering
  const layerToggle = page.getByRole("complementary", { name: "Canvas panel" }).getByRole("button", { name: /^Hide / }).first();
  await layerToggle.click();
  await page.waitForTimeout(200);
  assert.ok((await objects()) < 9, "hiding a layer hides its objects");
  await page.getByRole("complementary", { name: "Canvas panel" }).getByRole("button", { name: /^Show / }).first().click();
  await page.waitForTimeout(200);
  assert.equal(await objects(), 9);

  /* ------------------------- properties: rename, fields, order ------------------------- */
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Inspector" }).click();
  const renameTarget = await objectBox(2);
  await page.mouse.click(renameTarget.x + renameTarget.width / 2, renameTarget.y + renameTarget.height / 2);
  await props().getByLabel("Object name").fill("Headline");
  await props().getByLabel("Object name").press("Enter");
  await page.waitForTimeout(200);
  assert.equal(await props().getByLabel("Object name").inputValue(), "Headline");
  await props().getByLabel("X position").fill("120");
  await props().getByLabel("X position").press("Tab");
  await page.waitForTimeout(150);
  await props().getByLabel("Rotation").fill("20");
  await props().getByLabel("Rotation").press("Tab");
  await page.waitForTimeout(150);
  await saved();
  const stored = (await blueprint()).scenes[0].objects.find((o) => o.name === "Headline");
  assert.equal(stored.x, 120);
  assert.equal(Math.round(stored.rotation), 20);

  await props().getByRole("button", { name: "Duplicate" }).click();
  assert.equal(await objects(), 10);
  assert.equal(await props().getByLabel("Object name").inputValue(), "Headline copy");
  await saved();
  await props().getByRole("button", { name: "Back", exact: true }).click();
  await props().getByRole("button", { name: "Front", exact: true }).click();
  await saved();

  /* ------------------- paint / eraser / blur / eyedropper on objects ------------------- */
  await page.keyboard.press("Escape");
  const paintTarget = await objectBox(0);
  await page.getByRole("button", { name: "Paint", exact: true }).click();
  await page.mouse.click(paintTarget.x + paintTarget.width / 2, paintTarget.y + paintTarget.height / 2);
  await page.getByRole("button", { name: "Blur", exact: true }).click();
  await page.mouse.click(paintTarget.x + paintTarget.width / 2, paintTarget.y + paintTarget.height / 2);
  await saved();
  const softened = (await blueprint()).scenes[0].objects[0];
  assert.equal(softened.blur, 8, "blur applied to the object");
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  const eraseTarget = await objectBox(1);
  await page.mouse.click(eraseTarget.x + eraseTarget.width / 2, eraseTarget.y + eraseTarget.height / 2);
  await page.getByRole("dialog", { name: /Delete/ }).waitFor({ state: "detached" }).catch(() => undefined);
  await page.waitForTimeout(250);
  assert.equal(await objects(), 9, "eraser removed an object");
  await page.getByRole("button", { name: "Select", exact: true }).click();

  /* --------------------------- delete with keyboard + undo --------------------------- */
  const doomed = await objectBox(3);
  await page.mouse.click(doomed.x + doomed.width / 2, doomed.y + doomed.height / 2);
  const countBefore = await objects();
  await page.keyboard.press("Delete");
  await page.waitForTimeout(250);
  assert.equal(await objects(), countBefore - 1, "Delete removes the selection");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await objects(), countBefore, "undo restores it");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await objects(), countBefore - 1, "redo re-applies it");
  await saved();

  /* ------------------------------- undo/redo across saves ------------------------------- */
  await page.reload();
  await surface().waitFor();
  await page.waitForTimeout(700);
  assert.equal(await objects(), 9, "every change survived a reload");
  assert.equal(await page.getByRole("button", { name: "Undo", exact: true }).isDisabled(), true, "history starts clean after reload");
  const persisted = await blueprint();
  assert.equal(persisted.scenes[0].objects.length, 9);
  assert.ok(persisted.scenes[0].objects.some((o) => o.name === "Headline copy"));
  assert.ok(persisted.scenes[0].objects[0].rotation !== 0);

  /* ------------------------------------ conflicts ------------------------------------ */
  const current = await api("GET", `/api/projects/${projectId}`);
  const payload = { objects: current.body.blueprint.scenes[0].objects, background: current.body.blueprint.scenes[0].background ?? {}, layers: current.body.blueprint.layers };
  const bump = await api("PUT", `/api/projects/${projectId}/canvas`, { baseRevision: current.body.revision, sceneId: persisted.scenes[0].id, ...payload });
  assert.equal(bump.status, 200);
  const stale = await api("PUT", `/api/projects/${projectId}/canvas`, { baseRevision: current.body.revision, sceneId: persisted.scenes[0].id, ...payload });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.revision, bump.body.revision);

  await page.getByRole("complementary", { name: "Canvas panel" }).getByRole("button", { name: "Objects" }).locator("..").getByRole("button").first().click().catch(() => undefined);
  const ConflictName = "Conflict Object";
  await page.getByRole("tab", { name: "Inspector" }).click();
  const shape = (await objectBox(0));
  await page.mouse.click(shape.x + shape.width / 2, shape.y + shape.height / 2);
  await props().getByLabel("Object name").fill(ConflictName);
  await props().getByLabel("Object name").press("Enter");
  await page.getByRole("alert").filter({ hasText: /changed in another tab/ }).waitFor({ timeout: 15000 });
  assert.match(await page.getByRole("status").innerText(), /Out of sync/);
  await page.getByRole("button", { name: "Overwrite with my version" }).click();
  await saved();
  assert.ok((await blueprint()).scenes[0].objects.some((o) => o.name === ConflictName));

  /* ------------------------------ server-side validation ------------------------------ */
  const fresh = await api("GET", `/api/projects/${projectId}`);
  const doc = { objects: fresh.body.blueprint.scenes[0].objects, background: fresh.body.blueprint.scenes[0].background ?? {}, layers: fresh.body.blueprint.layers };
  assert.equal((await api("PUT", `/api/projects/${projectId}/canvas`, { baseRevision: fresh.body.revision, sceneId: persisted.scenes[0].id, objects: [] })).status, 422, "objects are required");
  const hostile = JSON.parse(JSON.stringify(doc));
  hostile.objects = [{ ...hostile.objects[0], id: "bad-1", kind: "portal", layerId: "layer-bg" }];
  assert.equal((await api("PUT", `/api/projects/${projectId}/canvas`, { baseRevision: fresh.body.revision, sceneId: persisted.scenes[0].id, ...hostile })).status, 422);
  const foreign = JSON.parse(JSON.stringify(doc));
  foreign.objects = [{ ...foreign.objects[0], id: "bad-2", layerId: "layer-bg", assetId: "asset-not-in-project" }];
  assert.equal((await api("PUT", `/api/projects/${projectId}/canvas`, { baseRevision: fresh.body.revision, sceneId: persisted.scenes[0].id, ...foreign })).status, 422);
  const offLayer = JSON.parse(JSON.stringify(doc));
  offLayer.objects = [{ ...offLayer.objects[0], id: "bad-3", layerId: "layer-missing" }];
  assert.equal((await api("PUT", `/api/projects/${projectId}/canvas`, { baseRevision: fresh.body.revision, sceneId: persisted.scenes[0].id, ...offLayer })).status, 422);
  assert.equal((await api("PUT", `/api/projects/${projectId}/canvas`, { baseRevision: fresh.body.revision, sceneId: "scene-missing", ...doc })).status, 422);
  assert.deepEqual(await blueprint(), await blueprint());

  /* ------------------------- design view still sees the same data ------------------------- */
  await page.goto(`${base}/projects/${projectId}`);
  await page.getByRole("heading", { name: "Game elements", exact: true }).waitFor();
  await page.getByRole("link", { name: "Canvas" }).click();
  await surface().waitFor();
  await page.waitForTimeout(500);
  assert.equal(await objects(), 9, "canvas reopens with its scene");
  await page.screenshot({ path: "/tmp/canvas-final.png" });

  /* ------------------------------------- responsive ------------------------------------- */
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.reload();
    await surface().waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no overflow at ${width}`);
    if (width < 1024) {
      assert.equal(await page.getByRole("complementary", { name: "Object properties" }).isVisible(), false);
      await page.getByRole("button", { name: "Toggle inspector" }).click();
      assert.ok(await props().isVisible());
      await page.getByRole("button", { name: "Close properties" }).click();
      assert.equal(await page.getByRole("complementary", { name: "Canvas panel" }).isVisible(), false);
      await page.getByRole("button", { name: "Toggle panel" }).click();
      assert.ok(await page.getByRole("complementary", { name: "Canvas panel" }).isVisible());
      await page.getByRole("button", { name: "Close panel" }).click({ position: { x: 340, y: 300 } });
    }
    await page.screenshot({ path: `/tmp/canvas-${width}.png` });
  }

  assert.deepEqual(problems, []);
  console.log(JSON.stringify({ ok: true, projectId, objects: 9, tools: 13 }, null, 2));
} catch (error) {
  await page.screenshot({ path: "/tmp/canvas-failure.png" }).catch(() => undefined);
  console.error(error);
  console.error("problems:", problems.slice(0, 6));
  process.exitCode = 1;
} finally {
  if (projectId) {
    await context.request.delete(`${base}/api/projects/${projectId}`).catch(() => undefined);
    const ws = await (await context.request.get(`${base}/api/workspace`)).json().catch(() => ({ folders: [] }));
    for (const f of (ws.folders ?? []).filter((x) => x.path.startsWith("__F05_ACCEPTANCE__")).sort((a, b) => b.path.length - a.path.length))
      await context.request.delete(`${base}/api/folders/${f.id}`).catch(() => undefined);
  }
  await browser.close();
}
