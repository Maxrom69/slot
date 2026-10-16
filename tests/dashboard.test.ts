import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import {
  breadcrumbsFor,
  folderPathOptions,
  formatRelative,
  matchesFolderQuery,
  matchesQuery,
  selectFolders,
  selectProjects,
  sortProjects,
} from "../src/lib/workspace/selectors";
import { DEMO_PROJECTS } from "../src/server/demo-data";
import { LocalProjectPersistenceService } from "../src/lib/persistence/project-persistence";

// Allow importing Next.js server-only modules in Node.js unit tests
const mod = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const origLoad = mod._load;
mod._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  return origLoad.call(this, request, parent, isMain);
};

test("F02.1 — Demo projects seed the dashboard on first launch with nested folders", async () => {
  const { ensureDemoWorkspace, getWorkspace } = await import(
    "../src/server/workspace-service"
  );
  await ensureDemoWorkspace();
  const snapshot = await getWorkspace();

  assert.ok(snapshot.projects.length >= DEMO_PROJECTS.length);
  for (const seed of DEMO_PROJECTS) {
    const match = snapshot.projects.find((p) => p.id === seed.id);
    assert.ok(match, `Expected seeded demo project ${seed.id} (${seed.title})`);
    assert.equal(match.theme, seed.theme);
    assert.equal(match.columns, seed.columns);
    assert.equal(match.rows, seed.rows);
  }

  const folderPaths = snapshot.folders.map((f) => f.path);
  assert.ok(folderPaths.includes("Concepts"));
  assert.ok(folderPaths.includes("Campaigns"));
  assert.ok(folderPaths.includes("Campaigns/Spring"));
  assert.ok(folderPaths.includes("Campaigns/Winter"));
});

test("F02.2 — Search matches across title, theme, style guide, and folder path", async () => {
  const { getWorkspace } = await import("../src/server/workspace-service");
  const snapshot = await getWorkspace();

  // Search by title
  const byTitle = selectProjects(snapshot.projects, {
    query: "Roman Empire",
    folderPath: "",
    statuses: [],
  });
  assert.ok(byTitle.some((p) => p.id === "prj_demo_roman_empire"));

  // Search by theme
  const byTheme = selectProjects(snapshot.projects, {
    query: "Deep Abyss",
    folderPath: "",
    statuses: [],
  });
  assert.ok(byTheme.some((p) => p.id === "prj_demo_abyss_fortune"));

  // Search by style guide
  const byStyleGuide = selectProjects(snapshot.projects, {
    query: "CRT scanlines",
    folderPath: "",
    statuses: [],
  });
  assert.ok(byStyleGuide.some((p) => p.id === "prj_demo_neon_sevens"));

  // Search by folder path
  const byFolderPath = selectProjects(snapshot.projects, {
    query: "Campaigns/Spring",
    folderPath: "",
    statuses: [],
  });
  assert.ok(byFolderPath.some((p) => p.id === "prj_demo_spring_hatch"));

  // Search folders
  const matchedFolders = selectFolders(snapshot.folders, "", "Winter");
  assert.ok(matchedFolders.some((f) => f.path === "Campaigns/Winter"));
  assert.equal(matchesFolderQuery(matchedFolders[0], "Campaigns Winter"), true);
});

test("F02.3 — Folder navigation, breadcrumbs, and sorting work deterministically", async () => {
  const { getWorkspace } = await import("../src/server/workspace-service");
  const snapshot = await getWorkspace();

  // Root view shows only root projects and root folders when not searching
  const rootProjects = selectProjects(snapshot.projects, {
    query: "",
    folderPath: "",
    statuses: [],
  });
  assert.ok(rootProjects.every((p) => p.folderPath === ""));

  const rootFolders = selectFolders(snapshot.folders, "", "");
  assert.ok(rootFolders.every((f) => f.parentPath === ""));

  // Navigating into Campaigns shows child folders Spring & Winter
  const campaignChildren = selectFolders(snapshot.folders, "Campaigns", "");
  const childNames = campaignChildren.map((f) => f.name);
  assert.ok(childNames.includes("Spring"));
  assert.ok(childNames.includes("Winter"));

  // Breadcrumbs for nested folder path
  const crumbs = breadcrumbsFor("Campaigns/Spring");
  assert.deepEqual(crumbs, [
    { label: "Your Games", path: "" },
    { label: "Campaigns", path: "Campaigns" },
    { label: "Spring", path: "Campaigns/Spring" },
  ]);

  // Sorting by title ascending/descending
  const asc = sortProjects(rootProjects, "title", "asc");
  const desc = sortProjects(rootProjects, "title", "desc");
  if (asc.length >= 2) {
    assert.ok(asc[0].title.localeCompare(asc[asc.length - 1].title) <= 0);
    assert.equal(asc[0].id, desc[desc.length - 1].id);
  }

  // Folder path options include root ""
  const options = folderPathOptions(snapshot.folders);
  assert.equal(options[0], "");
  assert.ok(options.includes("Concepts"));
  assert.ok(formatRelative(new Date().toISOString()).length > 0);
});

test("F02.4 — Create, rename, move, duplicate, and delete project + folder operations persist", async () => {
  const {
    createFolder,
    createProject,
    deleteFolder,
    deleteProject,
    duplicateProject,
    getWorkspace,
    renameFolder,
    restoreProject,
    updateProject,
  } = await import("../src/server/workspace-service");

  // Clean up any leftover test folders/projects from interrupted runs
  const pre = await getWorkspace();
  for (const p of pre.projects) {
    if (p.folderPath.startsWith("F02Studio") || p.folderPath.startsWith("F02Production")) {
      await deleteProject(p.id);
    }
  }
  const orderedCleanupFolders = pre.folders
    .filter((f) => f.path.startsWith("F02Studio") || f.path.startsWith("F02Production"))
    .sort((a, b) => b.path.length - a.path.length);
  for (const f of orderedCleanupFolders) {
    await deleteFolder(f.id);
  }

  // 1. Create folder and nested subfolder (both via parentPath and slash-separated nested path)
  const parentFolder = await createFolder("F02Studio", "");
  assert.equal(parentFolder.path, "F02Studio");
  const subFolder = await createFolder("Q4Launch/Holiday", "F02Studio");
  assert.equal(subFolder.path, "F02Studio/Q4Launch/Holiday");
  assert.equal(subFolder.parentPath, "F02Studio/Q4Launch");

  // 2. Create project in root
  const created = await createProject({
    title: "Golden Pharaoh",
    theme: "Ancient Egypt",
    styleGuide: "Obsidian & hammered gold",
    columns: 5,
    rows: 3,
    folderPath: "",
  });
  assert.equal(created.title, "Golden Pharaoh");
  assert.equal(created.folderPath, "");

  // 3. Rename project
  const renamed = await updateProject(created.id, { title: "Golden Pharaoh Deluxe" });
  assert.equal(renamed.title, "Golden Pharaoh Deluxe");

  // 4. Move project into nested folder
  const moved = await updateProject(created.id, { folderPath: "F02Studio/Q4Launch/Holiday" });
  assert.equal(moved.folderPath, "F02Studio/Q4Launch/Holiday");

  // 5. Safe folder delete blocks non-empty folder
  await assert.rejects(
    () => deleteFolder(subFolder.id),
    /Folder still contains projects/,
  );

  // 6. Rename parent folder cascades to child folder and project folderPath
  const renamedParent = await renameFolder(parentFolder.id, "F02Production");
  assert.equal(renamedParent.path, "F02Production");
  const afterCascade = await getWorkspace();
  const movedProjectAfterRename = afterCascade.projects.find((p) => p.id === created.id);
  assert.equal(movedProjectAfterRename?.folderPath, "F02Production/Q4Launch/Holiday");

  // 7. Duplicate project preserves folder and configuration
  const copy = await duplicateProject(created.id);
  assert.match(copy.title, /Golden Pharaoh Deluxe copy/);
  assert.equal(copy.folderPath, "F02Production/Q4Launch/Holiday");

  // 8. Delete projects and verify safe folder deletion succeeds once empty
  await deleteProject(created.id);
  await deleteProject(copy.id);
  const currentFolders = (await getWorkspace()).folders
    .filter((f) => f.path.startsWith("F02Production"))
    .sort((a, b) => b.path.length - a.path.length);
  assert.equal(currentFolders.length, 3);
  for (const f of currentFolders) {
    await deleteFolder(f.id);
  }

  // 9. Restore project to root and clean up
  await restoreProject(created.id);
  await deleteProject(created.id);

  // 10. Verify F01 LocalProjectPersistenceService also supports full F02 lifecycle
  const localService = new LocalProjectPersistenceService();
  const localProj = await localService.createProject({
    title: "Local Dashboard Slot",
    theme: "Cyberpunk",
  });
  assert.equal(matchesQuery(localProj, "Cyberpunk"), true);
  await localService.deleteProject(localProj.id);
});
