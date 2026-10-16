import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  // 1. Open dashboard and verify demo projects & folders are rendered
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Your Games" }).waitFor();
  await page.getByRole("article", { name: "Roman Empire project" }).waitFor();
  await page.getByRole("article", { name: "Temple Riches project" }).waitFor();
  await page.getByRole("article", { name: "Campaigns folder" }).waitFor();
  await page.getByRole("article", { name: "Concepts folder" }).waitFor();

  // 2. Navigate into Campaigns -> Spring and return through breadcrumbs
  await page.getByRole("button", { name: "Open Campaigns folder" }).click();
  await page.getByRole("article", { name: "Spring folder" }).waitFor();
  await page.getByRole("button", { name: "Open Spring folder" }).click();
  await page.getByRole("article", { name: "Spring Hatch project" }).waitFor();

  const breadcrumbNav = page.getByRole("navigation", { name: "Breadcrumb" });
  await breadcrumbNav.getByRole("button", { name: "Campaigns" }).click();
  await page.getByRole("article", { name: "Winter folder" }).waitFor();
  await breadcrumbNav.getByRole("button", { name: "Your Games" }).click();
  await page.getByRole("article", { name: "Roman Empire project" }).waitFor();

  // 3. Search across title, theme, style guide, and folder path
  const searchInput = page.getByRole("textbox", { name: "Search projects" });
  await searchInput.fill("CRT scanlines");
  await page.getByRole("article", { name: "Neon Sevens project" }).waitFor();
  await searchInput.fill("Campaigns/Spring");
  await page.getByRole("article", { name: "Spring Hatch project" }).waitFor();
  await searchInput.fill("");
  await page.getByRole("article", { name: "Roman Empire project" }).waitFor();

  // 4. Create folder, duplicate project, rename project, move project, and verify persistence after reload
  const folderName = `StudioF02_${Date.now().toString(36)}`;
  await page.getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(folderName);
  await dialog.getByRole("button", { name: "Create folder" }).click();
  await page.getByRole("article", { name: `${folderName} folder` }).waitFor();

  // Duplicate Roman Empire
  await page.getByRole("button", { name: "More actions for Roman Empire" }).click();
  await page.getByRole("menuitem", { name: /Duplicate/ }).click();
  await page.getByRole("article", { name: /Roman Empire copy/ }).waitFor();

  // Rename the duplicated project
  const copyCard = page.getByRole("article", { name: /Roman Empire copy/ }).first();
  const copyTitle = await copyCard.locator("h3").innerText();
  const renamedTitle = `Legion_${Date.now().toString(36)}`;
  await page.getByRole("button", { name: `More actions for ${copyTitle}` }).click();
  await page.getByRole("menuitem", { name: /Rename/ }).click();
  const renameDialog = page.getByRole("dialog", { name: "Rename project" });
  await renameDialog.getByRole("textbox").fill(renamedTitle);
  await renameDialog.getByRole("button", { name: "Rename" }).click();
  await page.getByRole("article", { name: `${renamedTitle} project` }).waitFor();

  // Move the renamed project into our new folder
  await page.getByRole("button", { name: `More actions for ${renamedTitle}` }).click();
  await page.getByRole("menuitem", { name: /Move to folder/ }).click();
  const moveDialog = page.getByRole("dialog", { name: "Move to folder" });
  await moveDialog.locator("select").selectOption(folderName);
  await moveDialog.getByRole("button", { name: "Move here" }).click();

  // Open the folder and verify the moved project is inside
  await page.getByRole("button", { name: `Open ${folderName} folder` }).click();
  await page.getByRole("article", { name: `${renamedTitle} project` }).waitFor();

  // Reload page and verify persistence
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("article", { name: `${renamedTitle} project` }).waitFor();

  // Delete the test project and folder to leave workspace clean
  await page.getByRole("button", { name: `More actions for ${renamedTitle}` }).click();
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete project" });
  await deleteDialog.getByRole("button", { name: "Delete project" }).click();

  await breadcrumbNav.getByRole("button", { name: "Your Games" }).click();
  await page.getByRole("button", { name: `Actions for ${folderName}` }).click();
  await page.getByRole("menuitem", { name: /Delete folder/ }).click();
  const deleteFolderDialog = page.getByRole("dialog", { name: "Delete folder" });
  await deleteFolderDialog.getByRole("button", { name: "Delete folder" }).click();

  // 5. Verify Grid / List view toggle and New Game navigation
  await page.getByRole("button", { name: "List" }).click();
  assert.ok((await page.locator("table tbody tr").count()) >= 2);
  await page.getByRole("button", { name: "Grid" }).click();

  await page.getByRole("button", { name: /New Game/ }).click();
  await page.waitForURL(/\/games\/new/);

  console.log("dashboard.browser.mjs: ALL PASS");
} finally {
  await browser.close();
}
