/**
 * SECTION 1 — FRONTEND / SLOTS STUDIO BUILDER
 * F17 — Preview Controls Unit & Integration Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createBlueprint } from "../src/lib/blueprint/factory";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { migrateBlueprint } from "../src/lib/design/migrate";
import {
  DEFAULT_PREVIEW_ZOOM,
  DisconnectedSlotRuntimeAdapter,
  MAX_PREVIEW_ZOOM,
  MIN_PREVIEW_ZOOM,
  RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE,
  buildPreviewPresentation,
  createDefaultPreviewState,
  createDisconnectedRuntimeAdapter,
  detectPreviewAnimationCapabilities,
  fitPreviewToViewport,
  invokeRuntimeSpin,
  recordPreviewSpinAttempt,
  resetPreviewLayerVisibility,
  resetPreviewView,
  selectPreviewPayline,
  selectPreviewScene,
  selectPreviewSymbol,
  setPreviewAnimationTrigger,
  setPreviewBetIndex,
  setPreviewPan,
  setPreviewStripOffset,
  setPreviewZoom,
  stepPreviewZoom,
  toggleBackgroundAnimation,
  togglePlayAnimationsAsSprites,
  togglePreviewFullscreen,
  togglePreviewGrid,
  togglePreviewGuides,
  togglePreviewLayerVisibility,
  togglePreviewPaylines,
  toggleSymbolWinAnimation,
  type RuntimeSpinRequest,
  type RuntimeSpinResponse,
  type SlotRuntimeAdapter,
} from "../src/lib/preview";

describe("F17 — Preview Controls & SlotRuntimeAdapter Boundary", () => {
  it("1. builds a deterministic presentation model covering background, reelFrame, reelArea, symbols, buttons, overlays, and standaloneLayers", () => {
    const bp = createBlueprint({
      id: "proj-preview-1",
      title: "Golden Pharaoh Preview",
      theme: "Ancient Egypt",
      columns: 5,
      rows: 3,
    });

    const state = createDefaultPreviewState(bp);
    const modelA = buildPreviewPresentation(bp, state);
    const modelB = buildPreviewPresentation(bp, state);

    // Deterministic output: identical inputs produce identical stage representations
    assert.deepEqual(modelA.stage, modelB.stage);

    assert.equal(modelA.projectId, "proj-preview-1");
    assert.equal(modelA.projectTitle, "Golden Pharaoh Preview");
    assert.equal(modelA.stage.background.visible, true);
    assert.equal(modelA.stage.reelFrame.visible, true);
    assert.equal(modelA.stage.reelArea.visible, true);
    assert.equal(modelA.stage.reelArea.columns, 5);
    assert.equal(modelA.stage.reelArea.rows, 3);
    assert.equal(modelA.stage.reelArea.cells.length, 3);
    assert.equal(modelA.stage.reelArea.cells[0]?.length, 5);

    // Buttons deck includes Spin and configured controls
    assert.equal(modelA.stage.buttons.visible, true);
    assert.ok(modelA.stage.buttons.items.some((b) => b.key === "spin" && b.primary));

    // Overlays include active paylines and guides
    assert.equal(modelA.stage.overlays.showPaylines, true);
    assert.ok(modelA.stage.overlays.paylines.length > 0);
    assert.equal(modelA.stage.overlays.showGuides, true);
    assert.equal(modelA.stage.overlays.showGrid, false);

    // Standalone layers include Game Title
    assert.ok(modelA.stage.standaloneLayers.titleElement);
    assert.equal(modelA.stage.standaloneLayers.titleElement?.type, "game_title");
  });

  it("2. supports all Preview Toolbar controls: Zoom, Fit, Fullscreen, Reset View, Show Grid, and Show Guides", () => {
    const bp = createBlueprint({
      id: "proj-toolbar",
      title: "Toolbar Slot",
      theme: "Classic",
      columns: 5,
      rows: 3,
    });
    let state = createDefaultPreviewState(bp);

    assert.equal(state.toolbar.zoom, DEFAULT_PREVIEW_ZOOM);
    assert.equal(state.toolbar.fitMode, true);
    assert.equal(state.toolbar.fullscreen, false);
    assert.equal(state.toolbar.showGrid, false);
    assert.equal(state.toolbar.showGuides, true);

    // Zoom in / out and clamp bounds
    state = stepPreviewZoom(state, 0.25);
    assert.equal(state.toolbar.zoom, 1.25);
    assert.equal(state.toolbar.fitMode, false);

    state = setPreviewZoom(state, 9.9);
    assert.equal(state.toolbar.zoom, MAX_PREVIEW_ZOOM);

    state = setPreviewZoom(state, 0.05);
    assert.equal(state.toolbar.zoom, MIN_PREVIEW_ZOOM);

    // Pan + Fit to viewport
    state = setPreviewPan(state, 40, -25);
    assert.equal(state.toolbar.panX, 40);
    assert.equal(state.toolbar.panY, -25);

    state = fitPreviewToViewport(state, 960, 540, 1920, 1080);
    assert.equal(state.toolbar.fitMode, true);
    assert.equal(state.toolbar.panX, 0);
    assert.equal(state.toolbar.panY, 0);
    assert.ok(state.toolbar.zoom >= MIN_PREVIEW_ZOOM && state.toolbar.zoom <= 1);

    // Reset View restores 100% zoom and zero pan
    state = resetPreviewView(state);
    assert.equal(state.toolbar.zoom, DEFAULT_PREVIEW_ZOOM);
    assert.equal(state.toolbar.fitMode, false);
    assert.equal(state.toolbar.panX, 0);
    assert.equal(state.toolbar.panY, 0);

    // Fullscreen, Show Grid, Show Guides toggles
    state = togglePreviewFullscreen(state);
    assert.equal(state.toolbar.fullscreen, true);
    state = togglePreviewFullscreen(state, false);
    assert.equal(state.toolbar.fullscreen, false);

    state = togglePreviewGrid(state);
    assert.equal(state.toolbar.showGrid, true);

    state = togglePreviewGuides(state);
    assert.equal(state.toolbar.showGuides, false);

    const presentation = buildPreviewPresentation(bp, state);
    assert.equal(presentation.stage.overlays.showGrid, true);
    assert.equal(presentation.stage.overlays.showGuides, false);
  });

  it("3. enforces Layers Animation Controls availability and toggles background, symbol win, and sprite animations", () => {
    const bp = createBlueprint({
      id: "proj-anim",
      title: "Anim Slot",
      theme: "Classic",
      columns: 5,
      rows: 3,
    });
    const baseCaps = detectPreviewAnimationCapabilities(bp);

    // Default preset has registered animations in bp.animations, but no sprite assets yet
    assert.equal(baseCaps.hasBackgroundAnimation, true);
    assert.equal(baseCaps.hasSymbolWinAnimation, true);
    assert.equal(baseCaps.hasSpriteAnimations, false);
    assert.match(baseCaps.spriteAnimationsReason, /Unavailable/i);

    let state = createDefaultPreviewState(bp);
    // Attempting to enable Play animations as sprites when no sprite assets exist stays false
    state = togglePlayAnimationsAsSprites(state, baseCaps, true);
    assert.equal(state.layerAnimations.playAnimationsAsSprites, false);

    // Toggle symbol win animation on
    state = toggleSymbolWinAnimation(state, baseCaps, true);
    assert.equal(state.layerAnimations.showSymbolWinAnimation, true);
    assert.equal(state.layerAnimations.activeAnimationTrigger, "win");

    const winModel = buildPreviewPresentation(bp, state);
    const hasAnimatedCell = winModel.stage.reelArea.cells.some((row) =>
      row.some((cell) => cell.winAnimationActive),
    );
    assert.equal(hasAnimatedCell, true);

    // Toggle background animation off and back on
    state = toggleBackgroundAnimation(state, baseCaps, false);
    assert.equal(
      buildPreviewPresentation(bp, state).stage.background.animationActive,
      false,
    );
    state = toggleBackgroundAnimation(state, baseCaps, true);
    assert.equal(
      buildPreviewPresentation(bp, state).stage.background.animationActive,
      true,
    );

    // Register a sprite asset in bp.assets and verify Play animations as sprites becomes available
    bp.assets.push({
      id: "asset-sprite-coin",
      name: "Coin Flip Sprite Sheet",
      kind: "sprite",
      state: "linked",
      uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      format: "png",
      tags: ["sprite", "animation"],
    });

    const spriteCaps = detectPreviewAnimationCapabilities(bp);
    assert.equal(spriteCaps.hasSpriteAnimations, true);
    assert.equal(spriteCaps.spriteAssets.length, 1);

    state = togglePlayAnimationsAsSprites(state, spriteCaps, true);
    assert.equal(state.layerAnimations.playAnimationsAsSprites, true);

    const spriteModel = buildPreviewPresentation(bp, state);
    assert.equal(
      spriteModel.stage.reelArea.cells[0]?.[0]?.spriteAnimationActive,
      true,
    );

    // Inspect animation trigger state
    state = setPreviewAnimationTrigger(state, "spin_start");
    const spinStartModel = buildPreviewPresentation(bp, state);
    assert.equal(
      spinStartModel.stage.overlays.activeAnimationTrigger,
      "spin_start",
    );
    assert.ok(
      spinStartModel.stage.overlays.matchingAnimations.some(
        (a) => a.trigger === "spin_start",
      ),
    );
  });

  it("4. supports scene-aware preview switching across Base Game, Free Spins, and Bonus Pick scenes", () => {
    const bp = createBlueprint({
      id: "proj-scenes",
      title: "Scenes Slot",
      theme: "Classic",
      columns: 5,
      rows: 3,
    });
    // Add a Bonus Pick scene to test multi-scene transitions
    bp.scenes.push({
      id: "scene-bonus",
      name: "Bonus Pick",
      kind: "bonus",
      layerIds: ["layer-bg", "layer-fx", "layer-ui"],
      entryTransition: "zoom",
    });

    let state = createDefaultPreviewState(bp);

    const basePresentation = buildPreviewPresentation(bp, state);
    assert.equal(basePresentation.activeScene.id, "scene-base");
    assert.equal(basePresentation.activeScene.kind, "base");
    assert.equal(basePresentation.stage.reelArea.visible, true);

    // Switch to Free Spins scene (id: "scene-free")
    state = selectPreviewScene(state, "scene-free");
    const fsPresentation = buildPreviewPresentation(bp, state);
    assert.equal(fsPresentation.activeScene.id, "scene-free");
    assert.equal(fsPresentation.activeScene.kind, "freespins");
    assert.equal(fsPresentation.activeScene.entryTransition, "wipe");
    assert.notEqual(
      fsPresentation.canvas.backgroundGradient,
      basePresentation.canvas.backgroundGradient,
    );
    // In scene-free, layer-frame is not in layerIds so reelFrame is hidden by scene membership
    assert.equal(fsPresentation.stage.reelFrame.visible, false);

    // Switch to Bonus Pick scene (which only includes layer-bg, layer-fx, layer-ui)
    state = selectPreviewScene(state, "scene-bonus");
    const bonusPresentation = buildPreviewPresentation(bp, state);
    assert.equal(bonusPresentation.activeScene.id, "scene-bonus");
    assert.equal(bonusPresentation.activeScene.kind, "bonus");
    const reelsLayerInBonus = bonusPresentation.layers.find(
      (l) => l.id === "layer-reels",
    );
    assert.equal(reelsLayerInBonus?.inActiveScene, false);
    assert.equal(reelsLayerInBonus?.effectiveVisible, false);
    assert.equal(bonusPresentation.stage.reelArea.visible, false);
  });

  it("5. supports static inspection of reel strip offsets, symbols, paylines, and layer visibility overrides", () => {
    const bp = createBlueprint({
      id: "proj-inspect",
      title: "Inspect Slot",
      theme: "Classic",
      columns: 5,
      rows: 3,
    });
    let state = createDefaultPreviewState(bp);

    // Scrub strip offset deterministically
    state = setPreviewStripOffset(state, 3);
    let model = buildPreviewPresentation(bp, state);
    assert.equal(model.stage.reelArea.stripOffset, 3);
    assert.equal(model.stage.reelArea.cells[0]?.[0]?.stopPosition, 4);

    // Select a symbol to inspect/highlight on grid
    const firstCellSymbolId = model.stage.reelArea.cells[0]?.[0]?.symbolId ?? null;
    assert.ok(firstCellSymbolId);
    state = selectPreviewSymbol(state, firstCellSymbolId);
    model = buildPreviewPresentation(bp, state);
    assert.equal(model.stage.reelArea.cells[0]?.[0]?.isSelectedSymbol, true);

    // Isolate a single payline
    const firstPaylineId = bp.paylines[0]?.id ?? null;
    assert.ok(firstPaylineId);
    state = selectPreviewPayline(state, firstPaylineId);
    model = buildPreviewPresentation(bp, state);
    assert.equal(model.stage.overlays.paylines.length, 1);
    assert.equal(model.stage.overlays.paylines[0]?.id, firstPaylineId);
    assert.equal(model.stage.overlays.paylines[0]?.selected, true);

    // Hide paylines completely
    state = togglePreviewPaylines(state, false);
    model = buildPreviewPresentation(bp, state);
    assert.equal(model.stage.overlays.paylines.length, 0);

    // Override layer visibility (hide background and UI buttons)
    state = togglePreviewLayerVisibility(state, "layer-bg", bp.layers);
    state = togglePreviewLayerVisibility(state, "layer-ui", bp.layers);
    model = buildPreviewPresentation(bp, state);
    assert.equal(model.stage.background.visible, false);
    assert.equal(model.stage.buttons.visible, false);

    // Reset layer visibility overrides
    state = resetPreviewLayerVisibility(state);
    model = buildPreviewPresentation(bp, state);
    assert.equal(model.stage.background.visible, true);
    assert.equal(model.stage.buttons.visible, true);
  });

  it("6. enforces the SlotRuntimeAdapter boundary and returns 'Runtime Engine Not Connected' with zero fake RNG", async () => {
    const bp = createBlueprint({
      id: "proj-runtime",
      title: "Runtime Slot",
      theme: "Classic",
      columns: 5,
      rows: 3,
    });
    let state = createDefaultPreviewState(bp);
    state = setPreviewBetIndex(state, 3, bp.math.betLevels.length);

    const disconnected = createDisconnectedRuntimeAdapter();
    assert.ok(disconnected instanceof DisconnectedSlotRuntimeAdapter);
    assert.equal(disconnected.isConnected(), false);
    assert.equal(
      disconnected.getStatusMessage(),
      RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE,
    );

    const spinResp = await invokeRuntimeSpin(disconnected, {
      projectId: bp.meta.id,
      sceneId: state.activeSceneId,
      betAmount: bp.math.betLevels[state.betIndex] ?? 1,
      blueprintVersion: bp.version,
    });

    assert.equal(spinResp.connected, false);
    assert.equal(spinResp.statusMessage, "Runtime Engine Not Connected");
    assert.equal(spinResp.engineResult, null);

    state = recordPreviewSpinAttempt(state, spinResp);
    const presentation = buildPreviewPresentation(bp, state, disconnected);
    assert.equal(presentation.runtime.connected, false);
    assert.equal(
      presentation.runtime.statusMessage,
      "Runtime Engine Not Connected",
    );
    assert.equal(
      presentation.runtime.lastSpinAttempt?.statusMessage,
      "Runtime Engine Not Connected",
    );

    // Verify a custom Section 2 SlotRuntimeAdapter implementation can plug into the boundary cleanly
    const mockSection2Bridge: SlotRuntimeAdapter = {
      id: "section2-test-bridge",
      name: "Section 2 Contract Verifier",
      connectionState: "connected",
      isConnected: () => true,
      getStatusMessage: () => "Connected to Section 2 Engine",
      requestSpin: async (req: RuntimeSpinRequest): Promise<RuntimeSpinResponse> => ({
        connected: true,
        statusMessage: `Engine acknowledged spin for ${req.projectId} at bet ${req.betAmount}`,
        timestamp: "2026-10-12T00:00:00.000Z",
        engineResult: null,
      }),
    };

    const customResp = await invokeRuntimeSpin(mockSection2Bridge, {
      projectId: bp.meta.id,
      sceneId: "scene-base",
      betAmount: 2,
      blueprintVersion: bp.version,
    });
    assert.equal(customResp.connected, true);
    assert.match(customResp.statusMessage, /Engine acknowledged spin/);
  });

  it("7. round-trips modified blueprint configurations through migrateBlueprint and reflects them in PreviewPresentationModel", () => {
    const bp = createBlueprint({
      id: "proj-f17-roundtrip",
      title: "F17 Preview Integration Slot",
      theme: "Cyberpunk Neon",
      columns: 5,
      rows: 4,
    });

    // Add a standalone custom element to verify standalone layers rendering
    bp.elements.push({
      id: "el-custom-banner",
      name: "Jackpot Neon Banner",
      type: "custom",
      group: "standalone",
      assetId: null,
      symbolIds: [],
      params: {},
      notes: "",
      origin: "imported",
      style: { opacity: 0.9, blendMode: "screen", tintColor: "#00ffcc" },
    });

    const check = validateBlueprint(bp);
    assert.equal(check.ok, true, check.issues.join("; "));

    const migrated = migrateBlueprint(bp);
    const state = createDefaultPreviewState(migrated);
    const model = buildPreviewPresentation(migrated, state);

    assert.equal(model.projectId, "proj-f17-roundtrip");
    assert.equal(model.projectTitle, "F17 Preview Integration Slot");
    assert.equal(model.stage.reelArea.columns, 5);
    assert.equal(model.stage.reelArea.rows, 4);
    assert.equal(model.stage.reelArea.cells.length, 4);
    assert.equal(model.stage.reelArea.cells[0]?.length, 5);
    assert.ok(
      model.stage.standaloneLayers.standaloneElements.some(
        (el) => el.name === "Jackpot Neon Banner",
      ),
    );
    assert.equal(
      model.runtime.statusMessage,
      RUNTIME_ENGINE_NOT_CONNECTED_MESSAGE,
    );
  });
});
