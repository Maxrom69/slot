import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createBlueprint } from "../src/lib/blueprint/factory";
import { getPaylineConfiguration } from "../src/lib/blueprint/model";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { migrateBlueprint } from "../src/lib/design/migrate";
import {
  createEditorCommand,
  executeEditorCommand,
} from "../src/lib/editor/commands";
import {
  addPayline,
  applyPaylineConfigurationToBlueprint,
  applyPaylinePreset,
  buildPatternShape,
  clearAllPaylines,
  clearPaylineColumn,
  computePaylinePathGeometry,
  deletePayline,
  detectPaylinePreset,
  duplicatePayline,
  getPaylineColor,
  PAYLINE_COLOR_PALETTE,
  paylineConfigurationFromBlueprint,
  repairMalformedPaylines,
  setAllPaylinesActive,
  setPaylineCell,
  setPaylinePattern,
  togglePaylineActive,
  validatePaylineConfiguration,
} from "../src/lib/paylines";
import { LocalProjectPersistenceService } from "../src/lib/persistence/project-persistence";

describe("F15 — Payline Editor", () => {
  it("1. Grid Cell Clicking & 1-Cell-Per-Reel Rule: creates arbitrary zigzag, V, inverted-V, and diagonal patterns", () => {
    const bp = createBlueprint({
      id: "prj_f15_patterns",
      title: "Imperial Lines",
      theme: "Roman Empire",
      columns: 5,
      rows: 3,
      paylineCount: 5,
    });

    let cfg = paylineConfigurationFromBlueprint(bp);
    assert.equal(cfg.columns, 5);
    assert.equal(cfg.rows, 3);
    assert.equal(cfg.paylines.length, 5);

    const line1Id = cfg.paylines[0]!.id;

    // Click cells across reels 0..4 to form an arbitrary V pattern [0, 1, 2, 1, 0]
    cfg = setPaylineCell(cfg, line1Id, 0, 0);
    cfg = setPaylineCell(cfg, line1Id, 1, 1);
    cfg = setPaylineCell(cfg, line1Id, 2, 2);
    cfg = setPaylineCell(cfg, line1Id, 3, 1);
    cfg = setPaylineCell(cfg, line1Id, 4, 0);

    assert.deepEqual(cfg.paylines[0]!.pattern, [0, 1, 2, 1, 0]);
    assert.equal(cfg.paylines[0]!.pattern.length, 5, "Each payline has 1 cell per reel");

    // Clicking another cell in reel 2 replaces the previous selection in reel 2 (never 2 cells in same reel)
    cfg = setPaylineCell(cfg, line1Id, 2, 0);
    assert.deepEqual(cfg.paylines[0]!.pattern, [0, 1, 0, 1, 0], "Updated to zigzag pattern [0, 1, 0, 1, 0]");

    // Verify canonical shape builders for V, inverted-V, zigzag, diagonal_down, diagonal_up
    const vShape = buildPatternShape(5, 3, "v");
    assert.deepEqual(vShape, [0, 1, 2, 1, 0]);

    const invVShape = buildPatternShape(5, 3, "inverted_v");
    assert.deepEqual(invVShape, [2, 1, 0, 1, 2]);

    const zigzagShape = buildPatternShape(5, 3, "zigzag");
    assert.deepEqual(zigzagShape, [0, 1, 0, 1, 0]);

    const diagDown = buildPatternShape(5, 3, "diagonal_down");
    assert.deepEqual(diagDown, [0, 1, 1, 2, 2]);

    const diagUp = buildPatternShape(5, 3, "diagonal_up");
    assert.deepEqual(diagUp, [2, 1, 1, 0, 0]);

    cfg = setPaylinePattern(cfg, line1Id, diagDown);
    assert.deepEqual(cfg.paylines[0]!.pattern, [0, 1, 1, 2, 2]);
  });

  it("2. Presets: supports 5 Lines, 10 Lines, 20 Lines, and Custom", () => {
    const bp = createBlueprint({
      id: "prj_f15_presets",
      title: "Preset Lines",
      theme: "Ancient Egypt",
      columns: 5,
      rows: 3,
      paylineCount: 20,
    });

    let cfg = paylineConfigurationFromBlueprint(bp);
    assert.equal(cfg.preset, "20");
    assert.equal(cfg.paylines.length, 20);

    // Apply 5 Lines preset
    cfg = applyPaylinePreset(cfg, "5");
    assert.equal(cfg.preset, "5");
    assert.equal(cfg.paylines.length, 5);
    assert.equal(detectPaylinePreset(cfg.paylines, cfg.columns, cfg.rows), "5");

    // Apply 10 Lines preset
    cfg = applyPaylinePreset(cfg, "10");
    assert.equal(cfg.preset, "10");
    assert.equal(cfg.paylines.length, 10);
    assert.equal(detectPaylinePreset(cfg.paylines, cfg.columns, cfg.rows), "10");

    // Apply 20 Lines preset
    cfg = applyPaylinePreset(cfg, "20");
    assert.equal(cfg.preset, "20");
    assert.equal(cfg.paylines.length, 20);
    assert.equal(detectPaylinePreset(cfg.paylines, cfg.columns, cfg.rows), "20");

    // Switch to Custom preset or edit a cell -> becomes "custom"
    cfg = applyPaylinePreset(cfg, "custom");
    assert.equal(cfg.preset, "custom");
    assert.equal(cfg.paylines.length, 20);
  });

  it("3. Actions & Payline List: Add Payline, Delete Payline, Duplicate, Clear All, and Active/Inactive toggles", () => {
    const bp = createBlueprint({
      id: "prj_f15_actions",
      title: "Action Lines",
      theme: "Norse",
      columns: 5,
      rows: 3,
      paylineCount: 5,
    });

    let cfg = paylineConfigurationFromBlueprint(bp);
    assert.equal(cfg.paylines.length, 5);

    // Add Payline
    cfg = addPayline(cfg);
    assert.equal(cfg.paylines.length, 6);
    assert.equal(cfg.paylines[5]!.index, 6);
    assert.equal(cfg.paylines[5]!.active, true);
    assert.equal(cfg.preset, "custom");

    // Duplicate Payline #2
    const secondId = cfg.paylines[1]!.id;
    const secondPattern = [...cfg.paylines[1]!.pattern];
    cfg = duplicatePayline(cfg, secondId);
    assert.equal(cfg.paylines.length, 7);
    assert.deepEqual(cfg.paylines[2]!.pattern, secondPattern);
    assert.deepEqual(
      cfg.paylines.map((l) => l.index),
      [1, 2, 3, 4, 5, 6, 7],
      "Sequential 1..N numbering preserved after duplicate",
    );

    // Toggle Active / Inactive state on Payline #3
    const thirdId = cfg.paylines[2]!.id;
    cfg = togglePaylineActive(cfg, thirdId, false);
    assert.equal(cfg.paylines[2]!.active, false);
    cfg = togglePaylineActive(cfg, thirdId);
    assert.equal(cfg.paylines[2]!.active, true);

    // Disable all / Enable all
    cfg = setAllPaylinesActive(cfg, false);
    assert.ok(cfg.paylines.every((l) => !l.active));
    cfg = setAllPaylinesActive(cfg, true);
    assert.ok(cfg.paylines.every((l) => l.active));

    // Delete Payline #3
    cfg = deletePayline(cfg, thirdId);
    assert.equal(cfg.paylines.length, 6);
    assert.deepEqual(
      cfg.paylines.map((l) => l.index),
      [1, 2, 3, 4, 5, 6],
    );

    // Clear All
    cfg = clearAllPaylines(cfg);
    assert.equal(cfg.paylines.length, 0);
    assert.equal(cfg.preset, "custom");
  });

  it("4. Deterministic Colors & SVG Path Geometry Preview across the grid", () => {
    const bp = createBlueprint({
      id: "prj_f15_colors",
      title: "Chromatic Lines",
      theme: "Cyberpunk",
      columns: 5,
      rows: 3,
      paylineCount: 10,
    });

    const cfg = paylineConfigurationFromBlueprint(bp);
    for (let i = 0; i < cfg.paylines.length; i += 1) {
      const line = cfg.paylines[i]!;
      assert.equal(line.color, getPaylineColor(i + 1));
      assert.equal(line.color, PAYLINE_COLOR_PALETTE[i]);
    }

    // Verify SVG path geometry preview for V-shape [0, 1, 2, 1, 0] on a 500x300 grid
    const vLine = {
      id: "line-v",
      color: getPaylineColor(1),
      pattern: [0, 1, 2, 1, 0],
    };
    const geo = computePaylinePathGeometry(vLine, 5, 3, 500, 300);
    assert.equal(geo.complete, true);
    assert.equal(geo.points.length, 5);
    // Column centers: 50, 150, 250, 350, 450; Row centers: 50, 150, 250
    assert.deepEqual(
      geo.points.map((p) => [p.x, p.y]),
      [
        [50, 50],
        [150, 150],
        [250, 250],
        [350, 150],
        [450, 50],
      ],
    );
    assert.equal(geo.polylinePoints, "50,50 150,150 250,250 350,150 450,50");
    assert.equal(geo.svgPathD, "M 50 50 L 150 150 L 250 250 L 350 150 L 450 50");
  });

  it("5. Validation: highlights invalid columns, prevents saving malformed paylines, and does not calculate winnings", () => {
    const bp = createBlueprint({
      id: "prj_f15_validation",
      title: "Validated Lines",
      theme: "Aztec",
      columns: 5,
      rows: 3,
      paylineCount: 5,
    });

    let cfg = paylineConfigurationFromBlueprint(bp);
    let report = validatePaylineConfiguration(cfg);
    assert.equal(report.valid, true);
    assert.equal(report.canSave, true);

    // Unset Reel 2 (column index 1) and Reel 4 (column index 3) on Payline #1
    const firstId = cfg.paylines[0]!.id;
    cfg = clearPaylineColumn(cfg, firstId, 1);
    cfg = clearPaylineColumn(cfg, firstId, 3);

    report = validatePaylineConfiguration(cfg);
    assert.equal(report.canSave, false, "Malformed payline blocks saving");
    assert.equal(report.checks.oneCellPerReelValid, false);
    assert.deepEqual(
      report.invalidColumnsByPaylineId[firstId],
      [1, 3],
      "Highlights exact invalid column indices [1, 3]",
    );

    // Attempt to save malformed configuration into GameBlueprint must throw
    assert.throws(
      () => applyPaylineConfigurationToBlueprint(bp, cfg),
      /missing cell selection/i,
    );

    // Also test out-of-bounds row index (e.g. row 9 on a 3-row grid)
    const secondId = cfg.paylines[1]!.id;
    cfg = setPaylinePattern(cfg, secondId, [0, 0, 9, 0, 0]);
    report = validatePaylineConfiguration(cfg);
    assert.equal(report.canSave, false);
    assert.equal(report.checks.rowBoundsValid, false);
    assert.deepEqual(report.invalidColumnsByPaylineId[secondId], [2]);

    // Repair malformed paylines and verify save succeeds
    cfg = repairMalformedPaylines(cfg);
    report = validatePaylineConfiguration(cfg);
    assert.equal(report.canSave, true);
    assert.equal(report.checks.oneCellPerReelValid, true);
    assert.equal(report.checks.rowBoundsValid, true);
    assert.equal(report.checks.uniquePatternsValid, true);
  });

  it("6. Saves into GameBlueprint.paylineConfiguration, survives migration, and persists locally without backend", async () => {
    const bp = createBlueprint({
      id: "prj_f15_persistence",
      title: "Saved Paylines",
      theme: "Roman Empire",
      columns: 5,
      rows: 3,
      paylineCount: 5,
    });

    let cfg = paylineConfigurationFromBlueprint(bp);
    // Customize Payline #1 to a deep W-zigzag [0, 2, 0, 2, 0]
    cfg = setPaylinePattern(cfg, cfg.paylines[0]!.id, [0, 2, 0, 2, 0]);
    // Add a 6th custom diagonal payline [0, 0, 1, 2, 2]
    cfg = addPayline(cfg, { pattern: [0, 0, 1, 2, 2] });

    const savedBp = applyPaylineConfigurationToBlueprint(bp, cfg);
    assert.ok(savedBp.paylineConfiguration, "GameBlueprint.paylineConfiguration is populated");
    assert.equal(savedBp.paylineConfiguration.paylines.length, 6);
    assert.deepEqual(savedBp.paylineConfiguration.paylines[0]!.pattern, [0, 2, 0, 2, 0]);
    assert.deepEqual(savedBp.paylineConfiguration.paylines[5]!.pattern, [0, 0, 1, 2, 2]);
    assert.equal(savedBp.paylines.length, 6);
    assert.equal(getPaylineConfiguration(savedBp).paylines.length, 6);

    // Blueprint validation passes
    const bpValidation = validateBlueprint(savedBp);
    assert.equal(bpValidation.ok, true);

    // Survives migrateBlueprint
    const migratedBp = migrateBlueprint(savedBp);
    assert.ok(migratedBp.paylineConfiguration);
    assert.equal(migratedBp.paylineConfiguration.paylines.length, 6);
    assert.deepEqual(migratedBp.paylineConfiguration.paylines[5]!.pattern, [0, 0, 1, 2, 2]);

    // Works with UPDATE_PAYLINE editor command
    const cmd = createEditorCommand("UPDATE_PAYLINE", {
      paylineConfiguration: cfg,
    });
    const cmdBp = executeEditorCommand(bp, cmd);
    assert.equal(cmdBp.paylineConfiguration?.paylines.length, 6);

    // Works with LocalProjectPersistenceService without backend
    const localStore = new LocalProjectPersistenceService("test:f15:paylines");
    const created = await localStore.createProject({
      title: savedBp.meta.title,
      theme: savedBp.meta.theme,
    });
    await localStore.saveProject(created.id, savedBp);

    const loaded = await localStore.loadProject(created.id);
    assert.ok(loaded);
    assert.equal(loaded.blueprint.paylineConfiguration?.paylines.length, 6);
    assert.deepEqual(
      loaded.blueprint.paylineConfiguration?.paylines[0]?.pattern,
      [0, 2, 0, 2, 0],
    );
  });
});
