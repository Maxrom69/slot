import assert from "node:assert/strict";
import test from "node:test";
import { createBlueprint } from "../src/lib/blueprint/factory";
import {
  getAnimationConfigurations,
  getAssets,
  getExportConfiguration,
  getFeatureConfigurations,
  getGridConfiguration,
  getPaylineConfiguration,
  getPaytableConfiguration,
  getProjectMetadata,
  getReelConfiguration,
  getScenes,
  getStandaloneElements,
  getStyleGuide,
  getSymbolSets,
  getThemeConfiguration,
} from "../src/lib/blueprint/model";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import {
  COMMAND_TYPES,
  createEditorCommand,
  executeEditorCommand,
} from "../src/lib/editor/commands";
import { StudioEditorStore } from "../src/lib/editor/store";
import { LocalProjectPersistenceService } from "../src/lib/persistence/project-persistence";
import {
  getAIService,
  NOT_IMPLEMENTED_AI_STATE,
  NOOP_AI_SERVICE,
} from "../src/lib/ai/boundary";
import {
  DEFAULT_STUDIO_SHORTCUTS,
  KeyboardShortcutManager,
  matchStudioShortcut,
} from "../src/lib/keyboard/shortcuts";
import { STUDIO_NAV_ITEMS } from "../src/components/shell/StudioNav";
import { studioToastStore } from "../src/lib/notifications/toast-store";

test("F01: GameBlueprint selectors expose all required typed configuration slices", () => {
  const bp = createBlueprint({
    id: "prj_f01_bp",
    title: "Olympus Gold",
    theme: "Mythology",
    styleGuide: "Golden marble & lightning",
    columns: 5,
    rows: 3,
    paylineCount: 20,
    rtpTarget: 96.2,
    volatility: "high",
  });

  const check = validateBlueprint(bp);
  assert.equal(check.integrityOk, true);

  assert.equal(getProjectMetadata(bp).title, "Olympus Gold");
  assert.equal(getThemeConfiguration(bp).paletteName.length > 0, true);
  assert.equal(getStyleGuide(bp).description, "Golden marble & lightning");

  const grid = getGridConfiguration(bp);
  assert.equal(grid.columns, 5);
  assert.equal(grid.rows, 3);
  assert.equal(grid.preset, "5x3");

  assert.ok(getSymbolSets(bp).length >= 1);
  assert.ok(getStandaloneElements(bp).length >= 1);
  assert.ok(getAssets(bp).length >= 1);
  assert.ok(getScenes(bp).length >= 2);
  assert.equal(getReelConfiguration(bp).columns, 5);
  assert.equal(getPaylineConfiguration(bp).paylines.length, 20);
  assert.ok(getPaytableConfiguration(bp).entries.length > 0);
  assert.ok(getFeatureConfigurations(bp).length > 0);
  assert.ok(getAnimationConfigurations(bp).length > 0);
  assert.equal(getExportConfiguration(bp).format, "blueprint-json");
});

test("F01: LocalProjectPersistenceService supports create, load, save, update, duplicate, list, and delete", async () => {
  const persistence = new LocalProjectPersistenceService("test:f01:projects");

  const created = await persistence.createProject({
    title: "Pharaoh Vault",
    theme: "Ancient Egypt",
    styleGuide: "Obsidian and gold leaf",
    columns: 5,
    rows: 4,
    paylineCount: 25,
    rtpTarget: 96.5,
    volatility: "high",
  });

  assert.ok(created.id.startsWith("prj_"));
  assert.equal(created.title, "Pharaoh Vault");
  assert.equal(created.columns, 5);
  assert.equal(created.rows, 4);

  const loaded = await persistence.loadProject(created.id);
  assert.ok(loaded);
  assert.equal(loaded.blueprint.meta.title, "Pharaoh Vault");

  // Save modified blueprint
  const modifiedBp = executeEditorCommand(
    loaded.blueprint,
    createEditorCommand("UPDATE_MATH", { patch: { rtpTarget: 95.5 } }),
  );
  const saved = await persistence.saveProject(created.id, modifiedBp);
  assert.equal(saved.rtpTarget, 95.5);
  assert.equal(saved.revision, 1);

  // Update metadata
  const updated = await persistence.updateProject(created.id, {
    title: "Pharaoh Vault Deluxe",
    status: "prototype",
  });
  assert.equal(updated.title, "Pharaoh Vault Deluxe");
  assert.equal(updated.status, "prototype");

  // Duplicate project
  const duplicate = await persistence.duplicateProject(created.id);
  assert.notEqual(duplicate.id, created.id);
  assert.equal(duplicate.title, "Pharaoh Vault Deluxe copy");

  // List projects
  const all = await persistence.listProjects();
  assert.equal(all.length, 2);

  // Delete project
  const deleted = await persistence.deleteProject(duplicate.id);
  assert.equal(deleted.id, duplicate.id);
  assert.equal(await persistence.loadProject(duplicate.id), null);
  assert.equal((await persistence.listProjects()).length, 1);
});

test("F01: StudioEditorStore manages activeProject, activeScene, selectedElementIds, activeTool, activePanel, undo/redo, dirty, and viewport", () => {
  const bp = createBlueprint({
    id: "prj_editor_state",
    title: "Cyber Reels",
    theme: "Neon",
  });

  const store = new StudioEditorStore({
    id: bp.meta.id,
    title: bp.meta.title,
    revision: 0,
    blueprint: bp,
  });

  assert.equal(store.getState().dirty, false);
  assert.equal(store.getState().activeTool, "select");
  assert.equal(store.getState().activeScene, bp.scenes[0].id);

  // Selection & tool & panel & viewport state updates
  store.dispatch({ type: "SET_SELECTED_ELEMENTS", ids: ["el-1", "el-2"] });
  assert.deepEqual(store.getState().selectedElementIds, ["el-1", "el-2"]);

  store.dispatch({ type: "SET_ACTIVE_TOOL", tool: "hand" });
  assert.equal(store.getState().activeTool, "hand");

  store.dispatch({ type: "SET_ACTIVE_PANEL", panel: "layers" });
  assert.equal(store.getState().activePanel, "layers");

  store.dispatch({
    type: "UPDATE_VIEWPORT",
    patch: { zoom: 1.5, panX: 40, panY: -20, fullscreen: true },
  });
  assert.equal(store.getState().viewport.zoom, 1.5);
  assert.equal(store.getState().viewport.panX, 40);
  assert.equal(store.getState().viewport.fullscreen, true);

  // Execute commands and verify dirty + undo/redo stack
  store.execute("UPDATE_REEL", { patch: { columns: 6, rows: 4 } }, "Resize grid to 6x4");
  assert.equal(store.getState().dirty, true);
  assert.equal(store.getState().activeProject?.blueprint.reels.columns, 6);
  assert.equal(store.canUndo(), true);
  assert.equal(store.canRedo(), false);

  store.undo();
  assert.equal(store.getState().activeProject?.blueprint.reels.columns, 5);
  assert.equal(store.getState().dirty, false);
  assert.equal(store.canUndo(), false);
  assert.equal(store.canRedo(), true);

  store.redo();
  assert.equal(store.getState().activeProject?.blueprint.reels.columns, 6);
  assert.equal(store.getState().dirty, true);

  store.dispatch({ type: "MARK_SAVED", revision: 1 });
  assert.equal(store.getState().dirty, false);
  assert.equal(store.getState().activeProject?.revision, 1);
});

test("F01: Command architecture supports all 12 core editor command types", () => {
  for (const requiredType of [
    "ADD_ELEMENT",
    "UPDATE_ELEMENT",
    "DELETE_ELEMENT",
    "MOVE_ELEMENT",
    "RESIZE_ELEMENT",
    "ROTATE_ELEMENT",
    "REORDER_LAYER",
    "TOGGLE_VISIBILITY",
    "TOGGLE_LOCK",
    "UPDATE_SYMBOL",
    "UPDATE_REEL",
    "UPDATE_PAYLINE",
  ] as const) {
    assert.ok(COMMAND_TYPES.includes(requiredType), `Command ${requiredType} is registered`);
  }

  let bp = createBlueprint({ id: "prj_cmd", title: "Command Test", theme: "Classic" });
  const sceneId = bp.scenes[0].id;
  const layerId = bp.layers[0].id;

  // 1. ADD_ELEMENT (sceneObject)
  bp = executeEditorCommand(
    bp,
    createEditorCommand("ADD_ELEMENT", {
      sceneId,
      sceneObject: {
        id: "obj_test_1",
        name: "Banner Rect",
        kind: "shape",
        layerId,
        x: 10,
        y: 20,
        width: 100,
        height: 50,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        blur: 0,
        fill: "#3b82f6",
        stroke: null,
        strokeWidth: 0,
        radius: 4,
        shape: "rect",
        arrow: false,
        points: [],
        text: null,
        fontSize: 16,
        fontWeight: 600,
        align: "center",
        refId: null,
        assetId: null,
      },
    }),
  );
  assert.equal(bp.scenes[0].objects?.length, 1);

  // 2. UPDATE_ELEMENT
  bp = executeEditorCommand(
    bp,
    createEditorCommand("UPDATE_ELEMENT", {
      id: "obj_test_1",
      sceneId,
      objectPatch: { name: "Updated Banner Rect" },
    }),
  );
  assert.equal(bp.scenes[0].objects?.[0].name, "Updated Banner Rect");

  // 3. MOVE_ELEMENT
  bp = executeEditorCommand(
    bp,
    createEditorCommand("MOVE_ELEMENT", { id: "obj_test_1", sceneId, x: 120, y: 240 }),
  );
  assert.equal(bp.scenes[0].objects?.[0].x, 120);
  assert.equal(bp.scenes[0].objects?.[0].y, 240);

  // 4. RESIZE_ELEMENT
  bp = executeEditorCommand(
    bp,
    createEditorCommand("RESIZE_ELEMENT", {
      id: "obj_test_1",
      sceneId,
      width: 300,
      height: 150,
    }),
  );
  assert.equal(bp.scenes[0].objects?.[0].width, 300);
  assert.equal(bp.scenes[0].objects?.[0].height, 150);

  // 5. ROTATE_ELEMENT
  bp = executeEditorCommand(
    bp,
    createEditorCommand("ROTATE_ELEMENT", {
      id: "obj_test_1",
      sceneId,
      rotation: 45,
    }),
  );
  assert.equal(bp.scenes[0].objects?.[0].rotation, 45);

  // 6. TOGGLE_VISIBILITY
  bp = executeEditorCommand(
    bp,
    createEditorCommand("TOGGLE_VISIBILITY", { id: "obj_test_1", sceneId }),
  );
  assert.equal(bp.scenes[0].objects?.[0].visible, false);

  // 7. TOGGLE_LOCK
  bp = executeEditorCommand(
    bp,
    createEditorCommand("TOGGLE_LOCK", { id: "obj_test_1", sceneId }),
  );
  assert.equal(bp.scenes[0].objects?.[0].locked, true);

  // 8. REORDER_LAYER
  const firstLayerId = bp.layers[0].id;
  bp = executeEditorCommand(
    bp,
    createEditorCommand("REORDER_LAYER", { layerId: firstLayerId, targetIndex: 2 }),
  );
  assert.equal(bp.layers[2].id, firstLayerId);
  assert.equal(bp.layers[2].order, 2);

  // 9. UPDATE_SYMBOL
  const symId = bp.symbols[0].id;
  bp = executeEditorCommand(
    bp,
    createEditorCommand("UPDATE_SYMBOL", {
      symbolId: symId,
      patch: { name: "Golden Crown", reelWeight: 12 },
    }),
  );
  assert.equal(bp.symbols[0].name, "Golden Crown");
  assert.equal(bp.symbols[0].reelWeight, 12);

  // 10. UPDATE_REEL
  bp = executeEditorCommand(
    bp,
    createEditorCommand("UPDATE_REEL", {
      patch: { evaluation: "ways", spinDirection: "up" },
    }),
  );
  assert.equal(bp.reels.evaluation, "ways");
  assert.equal(bp.reels.spinDirection, "up");

  // 11. UPDATE_PAYLINE
  const firstLineId = bp.paylines[0].id;
  bp = executeEditorCommand(
    bp,
    createEditorCommand("UPDATE_PAYLINE", {
      paylineId: firstLineId,
      patch: { active: false },
    }),
  );
  assert.equal(bp.paylines[0].active, false);

  // 12. DELETE_ELEMENT
  bp = executeEditorCommand(
    bp,
    createEditorCommand("DELETE_ELEMENT", { id: "obj_test_1", sceneId }),
  );
  assert.equal(bp.scenes[0].objects?.length, 0);
});

test("F01: Future AI boundary returns deterministic not_implemented state and never calls external providers", async () => {
  const service = getAIService();
  assert.equal(service, NOOP_AI_SERVICE);
  assert.equal(service.available, false);
  assert.deepEqual(service.getCapabilityState(), NOT_IMPLEMENTED_AI_STATE);

  const providers = service.listProviders();
  assert.equal(providers.length, 1);
  assert.equal(providers[0].available, false);

  const execResult = await service.execute({
    id: "cmd_ai_1",
    kind: "generate_concept",
  });
  assert.equal(execResult.implemented, false);
  assert.equal(execResult.status, "not_implemented");
});

test("F01: KeyboardShortcutManager matches all required studio shortcuts and respects editable inputs", () => {
  const manager = new KeyboardShortcutManager();
  const ids = DEFAULT_STUDIO_SHORTCUTS.map((s) => s.id);
  for (const expected of [
    "select",
    "brush",
    "eraser",
    "blur",
    "eyedropper",
    "delete",
    "undo",
    "redo",
    "save",
    "fullscreen",
  ] as const) {
    assert.ok(ids.includes(expected), `Shortcut ${expected} is registered`);
  }

  const triggered: string[] = [];
  manager.registerHandler("select", () => triggered.push("select"));
  manager.registerHandler("brush", () => triggered.push("brush"));
  manager.registerHandler("eraser", () => triggered.push("eraser"));
  manager.registerHandler("blur", () => triggered.push("blur"));
  manager.registerHandler("eyedropper", () => triggered.push("eyedropper"));
  manager.registerHandler("delete", () => triggered.push("delete"));
  manager.registerHandler("undo", () => triggered.push("undo"));
  manager.registerHandler("redo", () => triggered.push("redo"));
  manager.registerHandler("save", () => triggered.push("save"));
  manager.registerHandler("fullscreen", () => triggered.push("fullscreen"));

  manager.handleKeyDown({ key: "v" });
  manager.handleKeyDown({ key: "b" });
  manager.handleKeyDown({ key: "e" });
  manager.handleKeyDown({ key: "u" });
  manager.handleKeyDown({ key: "i" });
  manager.handleKeyDown({ key: "Delete" });
  manager.handleKeyDown({ key: "z", ctrlKey: true });
  manager.handleKeyDown({ key: "z", ctrlKey: true, shiftKey: true });
  manager.handleKeyDown({ key: "s", metaKey: true });
  manager.handleKeyDown({ key: "f" });

  assert.deepEqual(triggered, [
    "select",
    "brush",
    "eraser",
    "blur",
    "eyedropper",
    "delete",
    "undo",
    "redo",
    "save",
    "fullscreen",
  ]);

  // Inside an <input>, single-key shortcuts are ignored, but Ctrl/Cmd+S still works
  assert.equal(
    matchStudioShortcut({ key: "v", target: { tagName: "INPUT" } }),
    null,
  );
  assert.equal(
    matchStudioShortcut({ key: "s", ctrlKey: true, target: { tagName: "INPUT" } })?.id,
    "save",
  );
});

test("F01: Studio navigation anticipates all 10 required sections and ToastStore manages notifications", () => {
  const navLabels = STUDIO_NAV_ITEMS.map((item) => item.label);
  assert.deepEqual(navLabels, [
    "Dashboard",
    "Projects",
    "Design",
    "Symbols",
    "Assets",
    "Preview",
    "Math & Features",
    "Scenes",
    "Export",
    "Settings",
  ]);

  studioToastStore.clear();
  const t = studioToastStore.push("Saved project", "success");
  assert.equal(studioToastStore.getToasts().length, 1);
  studioToastStore.dismiss(t.id);
  assert.equal(studioToastStore.getToasts().length, 0);
});
