import assert from "node:assert/strict";
import test from "node:test";
import { createBlueprint } from "../src/lib/blueprint/factory";
import { getPaytableConfiguration } from "../src/lib/blueprint/model";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { migrateBlueprint } from "../src/lib/design/migrate";
import {
  createEditorCommand,
  executeEditorCommand,
} from "../src/lib/editor/commands";
import {
  applyPaytableConfigurationToBlueprint,
  countModifiedPaytableCells,
  deriveMatchCountsFromReels,
  getModifiedMatchCountsForRow,
  isPayoutCellModified,
  isPaytableRowModified,
  paytableConfigurationFromBlueprint,
  resetAllPaytableToDefaults,
  resetPaytableRowToDefaults,
  setPaytableCellPayout,
  setSymbolFamily,
  syncPaytableWithReels,
  toggleSymbolBonus,
  toggleSymbolScatter,
  toggleSymbolWild,
  validatePaytableCellValue,
  validatePaytableConfiguration,
} from "../src/lib/paytable";
import { buildSymbolPalette } from "../src/lib/reels";

test("F16.1 — Layout & Match Counts derive from grid/reel configuration (e.g. 2, 3, 4, 5, 6)", () => {
  // 5x3 grid -> [2, 3, 4, 5]
  const bp5 = createBlueprint({
    id: "prj-f16-5x3",
    title: "Imperial Crown",
    theme: "Roman Empire",
    columns: 5,
    rows: 3,
  });
  const cfg5 = paytableConfigurationFromBlueprint(bp5);
  assert.equal(cfg5.columns, 5);
  assert.equal(cfg5.rows, 3);
  assert.deepEqual(cfg5.matchCounts, [2, 3, 4, 5]);
  assert.equal(cfg5.symbolRows.length, bp5.symbols.length);

  // 6x4 grid -> [2, 3, 4, 5, 6]
  const bp6 = createBlueprint({
    id: "prj-f16-6x4",
    title: "Olympus Megagrid",
    theme: "Greek Mythology",
    columns: 6,
    rows: 4,
    symbolArt: { H1: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" },
  });
  const cfg6 = paytableConfigurationFromBlueprint(bp6);
  assert.equal(cfg6.columns, 6);
  assert.equal(cfg6.rows, 4);
  assert.deepEqual(cfg6.matchCounts, [2, 3, 4, 5, 6]);

  // Verify deriveMatchCountsFromReels and syncPaytableWithReels
  assert.deepEqual(deriveMatchCountsFromReels(3, 2), [2, 3]);
  assert.deepEqual(deriveMatchCountsFromReels(6, 3), [3, 4, 5, 6]);

  const syncedTo6 = syncPaytableWithReels(cfg5, 6, 4, "ways", 2);
  assert.deepEqual(syncedTo6.matchCounts, [2, 3, 4, 5, 6]);
  assert.equal(syncedTo6.evaluation, "ways");
  for (const row of syncedTo6.symbolRows) {
    for (const mc of [2, 3, 4, 5, 6]) {
      assert.equal(typeof row.payouts[String(mc)], "number");
      assert.equal(typeof row.defaultPayouts[String(mc)], "number");
    }
  }

  // 3x3 grid (e.g. Neon Sevens) and shrinking 5x3 -> 3x3 prunes 4/5-of-a-kind and saves cleanly
  const bp3 = createBlueprint({
    id: "prj-f16-3x3",
    title: "Neon Sevens",
    theme: "Neon Arcade",
    columns: 3,
    rows: 3,
    paylineCount: 5,
  });
  const cfg3 = paytableConfigurationFromBlueprint(bp3);
  assert.deepEqual(cfg3.matchCounts, [2, 3]);
  const savedBp3 = applyPaytableConfigurationToBlueprint(bp3, cfg3);
  assert.equal(savedBp3.paytableConfiguration?.columns, 3);
  for (const sym of savedBp3.symbols) {
    assert.equal(sym.payouts["4"], undefined);
    assert.equal(sym.payouts["5"], undefined);
  }

  const shrunkTo3 = syncPaytableWithReels(cfg5, 3, 3, "lines", 2);
  assert.deepEqual(shrunkTo3.matchCounts, [2, 3]);
  const savedShrunk = applyPaytableConfigurationToBlueprint(
    { ...bp5, reels: { ...bp5.reels, columns: 3, rows: 3 } },
    shrunkTo3,
  );
  assert.equal(savedShrunk.paytableConfiguration?.columns, 3);
});

test("F16.2 — Symbol rows expose thumbnail, symbol name, tier, family, wild status, and scatter status", () => {
  const bp = createBlueprint({
    id: "prj-f16-rows",
    title: "Pharaoh Riches",
    theme: "Ancient Egypt",
    columns: 5,
    rows: 3,
    symbolArt: {
      H1: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    },
  });

  const cfg = paytableConfigurationFromBlueprint(bp);
  const high1 = cfg.symbolRows.find((r) => r.code === "H1");
  const royalA = cfg.symbolRows.find((r) => r.code === "A");
  const wildRow = cfg.symbolRows.find((r) => r.symbolId === "sym-wild");
  const scatterRow = cfg.symbolRows.find((r) => r.symbolId === "sym-scatter");
  const bonusRow = cfg.symbolRows.find((r) => r.symbolId === "sym-bonus");

  assert.ok(high1);
  assert.equal(high1.name, "High Symbol 1");
  assert.equal(high1.tier, "high");
  assert.equal(high1.family, "High Symbols");
  assert.ok(high1.thumbnailUri?.startsWith("data:image/png"));
  assert.equal(high1.isWild, false);
  assert.equal(high1.isScatter, false);

  assert.ok(royalA);
  assert.equal(royalA.tier, "low");
  assert.equal(royalA.family, "Royals");
  assert.equal(royalA.glyph, "A");

  assert.ok(wildRow);
  assert.equal(wildRow.tier, "special");
  assert.equal(wildRow.family, "Special");
  assert.equal(wildRow.isWild, true);
  assert.equal(wildRow.isScatter, false);

  assert.ok(scatterRow);
  assert.equal(scatterRow.tier, "special");
  assert.equal(scatterRow.isWild, false);
  assert.equal(scatterRow.isScatter, true);

  assert.ok(bonusRow);
  assert.equal(bonusRow.isBonus, true);
});

test("F16.3 — Editable payout cells, modified indicators, row reset, and Reset All", () => {
  const bp = createBlueprint({
    id: "prj-f16-overrides",
    title: "Viking Valor",
    theme: "Norse",
    columns: 5,
    rows: 3,
  });

  let cfg = paytableConfigurationFromBlueprint(bp);
  const targetA = cfg.symbolRows[0]!;
  const targetB = cfg.symbolRows[1]!;

  // Initially no cells or rows are modified
  assert.deepEqual(countModifiedPaytableCells(cfg), {
    modifiedRows: 0,
    modifiedCells: 0,
  });
  assert.equal(isPaytableRowModified(targetA, cfg.matchCounts), false);

  // Edit 3-of-a-kind and 5-of-a-kind on targetA, and 4-of-a-kind on targetB
  const defaultA3 = targetA.defaultPayouts["3"]!;
  const defaultA5 = targetA.defaultPayouts["5"]!;
  const defaultB4 = targetB.defaultPayouts["4"]!;

  cfg = setPaytableCellPayout(cfg, targetA.symbolId, 3, defaultA3 + 10);
  cfg = setPaytableCellPayout(cfg, targetA.symbolId, 5, defaultA5 + 50);
  cfg = setPaytableCellPayout(cfg, targetB.symbolId, 4, defaultB4 + 25);

  const updatedA = cfg.symbolRows.find((r) => r.symbolId === targetA.symbolId)!;
  const updatedB = cfg.symbolRows.find((r) => r.symbolId === targetB.symbolId)!;

  assert.equal(isPayoutCellModified(updatedA, 3), true);
  assert.equal(isPayoutCellModified(updatedA, 4), false);
  assert.equal(isPayoutCellModified(updatedA, 5), true);
  assert.deepEqual(getModifiedMatchCountsForRow(updatedA, cfg.matchCounts), [3, 5]);
  assert.equal(isPaytableRowModified(updatedA, cfg.matchCounts), true);
  assert.equal(isPaytableRowModified(updatedB, cfg.matchCounts), true);
  assert.deepEqual(countModifiedPaytableCells(cfg), {
    modifiedRows: 2,
    modifiedCells: 3,
  });

  // Row reset on targetA restores only targetA's defaults while preserving targetB's override
  cfg = resetPaytableRowToDefaults(cfg, targetA.symbolId);
  const resetA = cfg.symbolRows.find((r) => r.symbolId === targetA.symbolId)!;
  const stillModB = cfg.symbolRows.find((r) => r.symbolId === targetB.symbolId)!;

  assert.equal(resetA.payouts["3"], defaultA3);
  assert.equal(resetA.payouts["5"], defaultA5);
  assert.equal(isPaytableRowModified(resetA, cfg.matchCounts), false);
  assert.equal(isPaytableRowModified(stillModB, cfg.matchCounts), true);
  assert.deepEqual(countModifiedPaytableCells(cfg), {
    modifiedRows: 1,
    modifiedCells: 1,
  });

  // Reset All restores all rows to configured defaults
  cfg = resetAllPaytableToDefaults(cfg);
  assert.deepEqual(countModifiedPaytableCells(cfg), {
    modifiedRows: 0,
    modifiedCells: 0,
  });
});

test("F16.4 — Wild toggle, Scatter/Bonus role flags, and visibility across frontend models", () => {
  const bp = createBlueprint({
    id: "prj-f16-wild",
    title: "Golden Dragon",
    theme: "Asian Dynasty",
    columns: 5,
    rows: 3,
  });

  let cfg = paytableConfigurationFromBlueprint(bp);
  const high1 = cfg.symbolRows.find((r) => r.code === "H1")!;
  assert.equal(high1.isWild, false);

  // Toggle Wild ON for H1, Scatter ON for M1, Bonus ON for M2, and update H1 family
  const mid1 = cfg.symbolRows.find((r) => r.code === "M1")!;
  const mid2 = cfg.symbolRows.find((r) => r.code === "M2")!;
  cfg = toggleSymbolWild(cfg, high1.symbolId, true);
  cfg = toggleSymbolScatter(cfg, mid1.symbolId, true);
  cfg = toggleSymbolBonus(cfg, mid2.symbolId, true);
  cfg = setSymbolFamily(cfg, high1.symbolId, "Dragon Royals");

  const savedBp = applyPaytableConfigurationToBlueprint(bp, cfg);

  // Verify symbol flags persisted in GameBlueprint.symbols
  const savedH1 = savedBp.symbols.find((s) => s.id === high1.symbolId)!;
  const savedM1 = savedBp.symbols.find((s) => s.id === mid1.symbolId)!;
  const savedM2 = savedBp.symbols.find((s) => s.id === mid2.symbolId)!;
  assert.equal(savedH1.isWild, true);
  assert.equal(savedH1.family, "Dragon Royals");
  assert.equal(savedM1.isScatter, true);
  assert.equal(savedM2.isBonus, true);

  // Verify GameBlueprint.specialSymbols is synchronized so all frontend views see Wild/Scatter/Bonus
  assert.ok(
    savedBp.specialSymbols.some(
      (sp) => sp.symbolId === high1.symbolId && sp.behaviour === "wild",
    ),
  );
  assert.ok(
    savedBp.specialSymbols.some(
      (sp) => sp.symbolId === mid1.symbolId && sp.behaviour === "scatter",
    ),
  );
  assert.ok(
    savedBp.specialSymbols.some(
      (sp) => sp.symbolId === mid2.symbolId && sp.behaviour === "bonus",
    ),
  );

  // Verify Reel Editor symbol palette reflects the updated Wild/Scatter/Bonus status
  const palette = buildSymbolPalette(savedBp);
  const paletteH1 = palette.find((p) => p.id === high1.symbolId)!;
  assert.equal(paletteH1.isWild, true);
});

test("F16.5 — Validation rejects negative payouts, invalid numeric values, NaN, and invalid match counts", () => {
  const bp = createBlueprint({
    id: "prj-f16-validation",
    title: "Cyber Reels",
    theme: "Sci-Fi",
    columns: 5,
    rows: 3,
  });

  const baseCfg = paytableConfigurationFromBlueprint(bp);
  const symId = baseCfg.symbolRows[0]!.symbolId;

  // 1. Direct cell validator checks
  assert.equal(validatePaytableCellValue(-5, 3, 5).ok, false);
  assert.equal(validatePaytableCellValue(-5, 3, 5).kind, "negative_payout");
  assert.equal(validatePaytableCellValue(NaN, 3, 5).ok, false);
  assert.equal(validatePaytableCellValue(NaN, 3, 5).kind, "nan_payout");
  assert.equal(validatePaytableCellValue("NaN", 3, 5).kind, "nan_payout");
  assert.equal(validatePaytableCellValue("abc", 3, 5).ok, false);
  assert.equal(validatePaytableCellValue("abc", 3, 5).kind, "invalid_numeric");
  assert.equal(validatePaytableCellValue("", 3, 5).kind, "invalid_numeric");
  assert.equal(validatePaytableCellValue(Infinity, 3, 5).kind, "invalid_numeric");
  assert.equal(validatePaytableCellValue(10, 1, 5).ok, false);
  assert.equal(validatePaytableCellValue(10, 1, 5).kind, "invalid_match_count");
  assert.equal(validatePaytableCellValue(10, 7, 5).ok, false);
  assert.equal(validatePaytableCellValue(10, 7, 5).kind, "invalid_match_count");

  // 2. Negative payout in configuration blocks saving
  const negCfg = setPaytableCellPayout(baseCfg, symId, 3, -12);
  const negReport = validatePaytableConfiguration(negCfg);
  assert.equal(negReport.canSave, false);
  assert.equal(negReport.checks.noNegativePayouts, false);
  assert.ok(negReport.invalidCellsBySymbolId[symId]?.includes(3));
  assert.throws(
    () => applyPaytableConfigurationToBlueprint(bp, negCfg),
    /Cannot save invalid paytable/i,
  );

  // 3. NaN in configuration blocks saving
  const nanCfg = setPaytableCellPayout(baseCfg, symId, 4, Number.NaN);
  const nanReport = validatePaytableConfiguration(nanCfg);
  assert.equal(nanReport.canSave, false);
  assert.equal(nanReport.checks.noNaNOrInvalidNumeric, false);
  assert.ok(nanReport.invalidCellsBySymbolId[symId]?.includes(4));
  assert.throws(
    () => applyPaytableConfigurationToBlueprint(bp, nanCfg),
    /Cannot save invalid paytable/i,
  );

  // 4. Non-numeric string in configuration blocks saving
  const badNumCfg = setPaytableCellPayout(baseCfg, symId, 5, "12.3.4");
  const badNumReport = validatePaytableConfiguration(badNumCfg);
  assert.equal(badNumReport.canSave, false);
  assert.equal(badNumReport.checks.noNaNOrInvalidNumeric, false);

  // 5. Invalid match count (e.g. 7 on a 5-reel grid or 1-of-a-kind) blocks saving
  const badMatchCfg = setPaytableCellPayout(baseCfg, symId, 7, 250);
  const badMatchReport = validatePaytableConfiguration(badMatchCfg);
  assert.equal(badMatchReport.canSave, false);
  assert.equal(badMatchReport.checks.matchCountsValid, false);
  assert.throws(
    () => applyPaytableConfigurationToBlueprint(bp, badMatchCfg),
    /Cannot save invalid paytable/i,
  );
});

test("F16.6 — Paytable changes persist in GameBlueprint, survive migration & commands, and do not run math simulation", () => {
  const bp = createBlueprint({
    id: "prj-f16-persist",
    title: "Emerald Kingdom",
    theme: "Celtic Fantasy",
    columns: 6,
    rows: 4,
    rtpTarget: 96.4,
  });

  let cfg = paytableConfigurationFromBlueprint(bp);
  const symH1 = cfg.symbolRows.find((r) => r.code === "H1")!;

  cfg = setPaytableCellPayout(cfg, symH1.symbolId, 2, 5);
  cfg = setPaytableCellPayout(cfg, symH1.symbolId, 6, 1200);
  cfg = toggleSymbolWild(cfg, symH1.symbolId, true);

  // Execute via UPDATE_PAYTABLE editor command
  const cmd = createEditorCommand("UPDATE_PAYTABLE", {
    paytableConfiguration: cfg,
  });
  const updatedBp = executeEditorCommand(bp, cmd);

  // Blueprint remains structurally valid
  const bpCheck = validateBlueprint(updatedBp);
  assert.equal(bpCheck.ok, true, bpCheck.issues.join("; "));

  // Saved in GameBlueprint.paytableConfiguration, paytable, and symbols
  const modelView = getPaytableConfiguration(updatedBp);
  assert.ok(modelView.symbolRows);
  assert.deepEqual(modelView.matchCounts, [2, 3, 4, 5, 6]);

  const h1Symbol = updatedBp.symbols.find((s) => s.id === symH1.symbolId)!;
  assert.equal(h1Symbol.payouts["2"], 5);
  assert.equal(h1Symbol.payouts["6"], 1200);
  assert.equal(h1Symbol.isWild, true);

  const entry6 = updatedBp.paytable.find(
    (e) => e.symbolId === symH1.symbolId && e.ofAKind === 6,
  );
  assert.equal(entry6?.payout, 1200);

  // Survives migrateBlueprint round-trip including defaultPayouts override history
  const migrated = migrateBlueprint(updatedBp);
  const reloadedCfg = paytableConfigurationFromBlueprint(migrated);
  const reloadedH1 = reloadedCfg.symbolRows.find(
    (r) => r.symbolId === symH1.symbolId,
  )!;
  assert.equal(reloadedH1.payouts["6"], 1200);
  assert.equal(isPayoutCellModified(reloadedH1, 6), true);
  assert.equal(reloadedH1.isWild, true);

  // Declarative math targets (RTP target & hitFrequency) are untouched (no engine simulation run)
  assert.equal(migrated.math.rtpTarget, 96.4);
  assert.equal(migrated.math.hitFrequency, bp.math.hitFrequency);
});
