import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  STUDIO_ANIMATION_TYPES,
  addAnimationLayerToDesignDoc,
  addAnimationLayerToScene,
  addElementAnimation,
  configureAnimationSpriteSheet,
  configureAnimationVideo,
  createAnimationPlaybackState,
  deleteElementAnimation,
  getAllAnimations,
  getElementAnimations,
  moveAnimationSceneLayer,
  normalizeAnimationModel,
  pauseAnimation,
  playAnimation,
  renameElementAnimation,
  reorderAnimationSceneLayer,
  resizeAnimationSceneLayer,
  resolveSpriteFrameRect,
  restartAnimation,
  seekAnimationPlayback,
  serializeAnimationsToBlueprint,
  setAnimationPlaybackLoop,
  setAnimationSceneLayerLocked,
  setAnimationSceneLayerVisibility,
  setElementAnimationExtra,
  stepAnimationPlayback,
  toggleElementAnimationState,
  updateElementAnimation,
  validateAnimationModel,
} from "../src/lib/animations";
import { createBlueprint } from "../src/lib/blueprint/factory";
import { validateBlueprint } from "../src/lib/blueprint/validate";
import { parseSceneDoc } from "../src/lib/canvas/parse";
import { applyDesign, designDocFromBlueprint, migrateDoc } from "../src/lib/design/migrate";
import { parseDesignDoc } from "../src/lib/design/parse";
import { detectPreviewAnimationCapabilities } from "../src/lib/preview";

describe("F18 — Animation System", () => {
  it("1. enforces the complete 12-field Animation Model and supports all 5 Animation Types (Background, Symbol Win, Standalone, Hover, Custom)", () => {
    const bp = createBlueprint({
      id: "prj-f18-model",
      title: "Olympus Thunder",
      theme: "Greek Mythology",
    });
    let doc = migrateDoc(designDocFromBlueprint(bp));
    const bgElement = doc.elements.find((e) => e.type === "game_background")!;
    assert.ok(bgElement, "Expected game_background element");

    for (const animType of STUDIO_ANIMATION_TYPES) {
      const added = addElementAnimation(doc, {
        elementId: bgElement.id,
        name: `${animType} Spec Animation`,
        animationType: animType,
        duration: 900,
        fps: 30,
        loop: animType === "Background" || animType === "Standalone",
        thumbnail: `/thumbnails/${animType.toLowerCase().replace(/\s+/g, "-")}.png`,
      });
      doc = added.doc;
      const anim = added.animation;

      // Verify all 12 required Animation Model fields exist and are properly typed
      assert.equal(typeof anim.id, "string");
      assert.ok(anim.id.length > 0);
      assert.equal(anim.elementId, bgElement.id);
      assert.equal(anim.name, `${animType} Spec Animation`);
      assert.equal(anim.animationType, animType);
      assert.equal(anim.source, "preset");
      assert.equal(anim.format, "css");
      assert.equal(anim.duration, 900);
      assert.equal(anim.durationMs, 900);
      assert.equal(anim.loop, animType === "Background" || animType === "Standalone");
      assert.equal(anim.fps, 30);
      assert.equal(anim.thumbnail, `/thumbnails/${animType.toLowerCase().replace(/\s+/g, "-")}.png`);
      assert.equal(anim.videoReference, null);
      assert.equal(anim.spriteSheetReference, null);
      assert.equal(anim.state, "enabled");

      const validation = validateAnimationModel(anim);
      assert.equal(validation.valid, true, `Expected ${animType} animation to validate cleanly`);
      assert.deepEqual(validation.errors, []);
    }

    const elementAnims = getElementAnimations(doc, bgElement.id);
    assert.equal(elementAnims.length, 5);
    assert.deepEqual(
      elementAnims.map((a) => a.animationType),
      ["Background", "Symbol Win", "Standalone", "Hover", "Custom"],
    );
  });

  it("2. supports all Animation Panel operations for every element: Animation Extra, Add Animation, Enable/Disable, Rename, Delete", () => {
    const bp = createBlueprint({
      id: "prj-f18-panel",
      title: "Neon Cyber Spin",
      theme: "Cyberpunk",
    });
    let doc = migrateDoc(designDocFromBlueprint(bp));
    const frameEl = doc.elements.find((e) => e.type === "reel_frame")!;

    // 1. Animation Extra on the element
    doc = setElementAnimationExtra(doc, frameEl.id, "shader=neon_pulse; intensity=0.85");
    assert.equal(
      doc.elements.find((e) => e.id === frameEl.id)?.animationExtra,
      "shader=neon_pulse; intensity=0.85",
    );

    // 2. Add Animation
    const added = addElementAnimation(doc, {
      elementId: frameEl.id,
      name: "Neon Rim Pulse",
      animationType: "Hover",
      duration: 500,
      fps: 60,
      loop: true,
    });
    doc = added.doc;
    assert.equal(added.animation.animationExtra, "shader=neon_pulse; intensity=0.85");
    assert.equal(getElementAnimations(doc, frameEl.id).length, 1);

    // 3. Rename
    doc = renameElementAnimation(doc, added.id, "Cyber Frame Overdrive");
    let anim = getElementAnimations(doc, frameEl.id)[0]!;
    assert.equal(anim.name, "Cyber Frame Overdrive");

    // 4. Enable / Disable toggle
    assert.equal(anim.state, "enabled");
    doc = toggleElementAnimationState(doc, added.id);
    anim = getElementAnimations(doc, frameEl.id)[0]!;
    assert.equal(anim.state, "disabled");
    assert.equal(doc.elements.find((e) => e.id === frameEl.id)?.animation?.preset, "none");

    doc = toggleElementAnimationState(doc, added.id, true);
    anim = getElementAnimations(doc, frameEl.id)[0]!;
    assert.equal(anim.state, "enabled");

    // 5. Update per-animation Animation Extra & properties
    doc = updateElementAnimation(doc, added.id, {
      animationExtra: "glowRadius=24px",
      duration: 750,
    });
    anim = getElementAnimations(doc, frameEl.id)[0]!;
    assert.equal(anim.animationExtra, "glowRadius=24px");
    assert.equal(anim.duration, 750);
    assert.equal(anim.durationMs, 750);

    // 6. Delete
    doc = deleteElementAnimation(doc, added.id);
    assert.equal(getElementAnimations(doc, frameEl.id).length, 0);
  });

  it("3. supports Playback controls: play, pause, restart, loop, seek, and frame stepping", () => {
    const bp = createBlueprint({
      id: "prj-f18-playback",
      title: "Dragon Fire",
      theme: "Asian Fantasy",
    });
    const doc = migrateDoc(designDocFromBlueprint(bp));
    const titleEl = doc.elements.find((e) => e.type === "game_title")!;
    const { animation } = addElementAnimation(doc, {
      elementId: titleEl.id,
      name: "Dragon Breath Burst",
      animationType: "Symbol Win",
      duration: 1000,
      fps: 20,
      loop: false,
    });

    // Initial stopped state
    let pb = createAnimationPlaybackState(animation);
    assert.equal(pb.status, "stopped");
    assert.equal(pb.isPlaying, false);
    assert.equal(pb.totalFrames, 20);
    assert.equal(pb.currentFrame, 0);

    // Play
    pb = playAnimation(pb);
    assert.equal(pb.status, "playing");
    assert.equal(pb.isPlaying, true);

    // Step 250ms (25% through 1000ms -> frame 5 of 20)
    pb = stepAnimationPlayback(pb, 250);
    assert.equal(pb.elapsedMs, 250);
    assert.equal(pb.progress, 0.25);
    assert.equal(pb.currentFrame, 5);

    // Pause
    pb = pauseAnimation(pb);
    assert.equal(pb.status, "paused");
    assert.equal(pb.isPlaying, false);
    assert.equal(pb.isPaused, true);
    // Stepping while paused is a no-op
    pb = stepAnimationPlayback(pb, 300);
    assert.equal(pb.elapsedMs, 250);

    // Resume play and step past end when loop=false -> stops at end frame
    pb = playAnimation(pb);
    pb = stepAnimationPlayback(pb, 900);
    assert.equal(pb.isPlaying, false);
    assert.equal(pb.progress, 1);
    assert.equal(pb.currentFrame, 19);

    // Enable loop and restart
    pb = setAnimationPlaybackLoop(pb, true);
    assert.equal(pb.loop, true);
    pb = restartAnimation(pb, true);
    assert.equal(pb.isPlaying, true);
    assert.equal(pb.elapsedMs, 0);
    assert.equal(pb.currentFrame, 0);

    // Step 1300ms with loop=true -> wraps around to 300ms with cycleCount=1
    pb = stepAnimationPlayback(pb, 1300);
    assert.equal(pb.elapsedMs, 300);
    assert.equal(pb.cycleCount, 1);
    assert.equal(pb.currentFrame, 6);

    // Seek to 500ms
    pb = seekAnimationPlayback(pb, 500);
    assert.equal(pb.elapsedMs, 500);
    assert.equal(pb.progress, 0.5);
    assert.equal(pb.currentFrame, 10);
  });

  it("4. supports Video and Sprite Sheet configuration and frame rectangle slicing", () => {
    const bp = createBlueprint({
      id: "prj-f18-sprites",
      title: "Golden Scarab",
      theme: "Ancient Egypt",
    });
    let doc = migrateDoc(designDocFromBlueprint(bp));
    doc = {
      ...doc,
      assets: [
        ...doc.assets,
        {
          id: "ast_sprite_scarab",
          name: "scarab_sheet.png",
          kind: "sprite",
          uri: "/api/assets/ast_sprite_scarab",
          state: "linked",
          tags: ["sprite"],
          width: 512,
          height: 512,
        },
        {
          id: "ast_video_bg",
          name: "desert_wind.mp4",
          kind: "image",
          uri: "/api/assets/ast_video_bg",
          state: "linked",
          tags: ["video"],
          width: 1920,
          height: 1080,
        },
      ],
    };

    const symEl = doc.elements.find((e) => e.type === "symbol_set" || e.type === "symbol")!;
    const bgEl = doc.elements.find((e) => e.type === "game_background")!;

    // 1. Configure Sprite Sheet animation
    const spriteAdded = addElementAnimation(doc, {
      elementId: symEl.id,
      name: "Scarab Wing Flutter",
      animationType: "Symbol Win",
      source: "sprite_sheet",
    });
    doc = configureAnimationSpriteSheet(spriteAdded.doc, spriteAdded.id, {
      assetId: "ast_sprite_scarab",
      uri: "/api/assets/ast_sprite_scarab",
      columns: 4,
      rows: 4,
      frameWidth: 128,
      frameHeight: 128,
      frameCount: 16,
      startFrame: 0,
      endFrame: 15,
      spacing: 2,
      margin: 4,
    });

    const spriteAnim = getElementAnimations(doc, symEl.id)[0]!;
    assert.equal(spriteAnim.source, "sprite_sheet");
    assert.equal(spriteAnim.format, "sprite-sheet");
    assert.ok(spriteAnim.spriteSheetReference);
    assert.equal(spriteAnim.spriteSheetReference.assetId, "ast_sprite_scarab");
    assert.equal(spriteAnim.spriteSheetReference.columns, 4);
    assert.equal(spriteAnim.spriteSheetReference.rows, 4);
    assert.equal(spriteAnim.spriteSheetReference.frameCount, 16);

    // Verify frame slicing math (frame 5 -> row 1, col 1)
    const rect0 = resolveSpriteFrameRect(spriteAnim.spriteSheetReference, 0);
    assert.deepEqual(
      { col: rect0.column, row: rect0.row, x: rect0.x, y: rect0.y, w: rect0.width, h: rect0.height },
      { col: 0, row: 0, x: 4, y: 4, w: 128, h: 128 },
    );
    const rect5 = resolveSpriteFrameRect(spriteAnim.spriteSheetReference, 5);
    assert.deepEqual(
      { col: rect5.column, row: rect5.row, x: rect5.x, y: rect5.y, w: rect5.width, h: rect5.height },
      { col: 1, row: 1, x: 4 + 130, y: 4 + 130, w: 128, h: 128 },
    );

    // 2. Configure Video animation
    const videoAdded = addElementAnimation(doc, {
      elementId: bgEl.id,
      name: "Desert Sandstorm Loop",
      animationType: "Background",
      source: "video",
    });
    doc = configureAnimationVideo(
      videoAdded.doc,
      videoAdded.id,
      {
        assetId: "ast_video_bg",
        uri: "/api/assets/ast_video_bg",
        mimeType: "video/mp4",
        width: 1920,
        height: 1080,
        playbackRate: 1.25,
        muted: true,
      },
      "mp4",
    );

    const videoAnim = getElementAnimations(doc, bgEl.id)[0]!;
    assert.equal(videoAnim.source, "video");
    assert.equal(videoAnim.format, "mp4");
    assert.ok(videoAnim.videoReference);
    assert.equal(videoAnim.videoReference.assetId, "ast_video_bg");
    assert.equal(videoAnim.videoReference.playbackRate, 1.25);
    assert.equal(videoAnim.videoReference.width, 1920);
  });

  it("5. places animations into scenes as Standalone Animated Layers that are moveable, resizable, reorderable, visible/hidden, and lockable", () => {
    const bp = createBlueprint({
      id: "prj-f18-layers",
      title: "Viking Storm",
      theme: "Norse Mythology",
    });
    let doc = migrateDoc(designDocFromBlueprint(bp));
    const titleEl = doc.elements.find((e) => e.type === "game_title")!;

    const animA = addElementAnimation(doc, {
      elementId: titleEl.id,
      name: "Lightning Strike FX",
      animationType: "Standalone",
      duration: 1200,
      fps: 24,
      loop: true,
    });
    doc = animA.doc;

    const animB = addElementAnimation(doc, {
      elementId: titleEl.id,
      name: "Frost Aura Overlay",
      animationType: "Background",
      duration: 2400,
      fps: 30,
      loop: true,
    });
    doc = animB.doc;

    const updatedBp = applyDesign(bp, doc);

    // Place animA into scene as a standalone layer (with a dedicated LayerDef)
    const placedA = addAnimationLayerToScene(updatedBp, animA.id, {
      x: 200,
      y: 150,
      width: 400,
      height: 300,
      createDedicatedLayer: true,
    });
    assert.ok(placedA);
    assert.equal(placedA.object.kind, "animation");
    assert.equal(placedA.object.refId, animA.id);
    assert.equal(placedA.object.animationId, animA.id);
    assert.equal(placedA.object.x, 200);
    assert.equal(placedA.object.y, 150);
    assert.equal(placedA.object.width, 400);
    assert.equal(placedA.object.height, 300);
    assert.equal(placedA.object.visible, true);
    assert.equal(placedA.object.locked, false);

    // Place animB into the same scene on the same layer so we can test reordering
    const placedB = addAnimationLayerToScene(placedA.blueprint, animB.id, {
      sceneId: placedA.sceneId,
      layerId: placedA.layer.id,
      x: 100,
      y: 100,
      width: 600,
      height: 400,
    });
    assert.ok(placedB);

    let objects = placedB.blueprint.scenes.find((s) => s.id === placedB.sceneId)!.objects!;
    assert.equal(objects.length, 2);
    const idA = placedA.object.id;
    const idB = placedB.object.id;

    // 1. Moveable
    objects = moveAnimationSceneLayer(objects, idA, { x: 45, y: -25 });
    assert.equal(objects.find((o) => o.id === idA)?.x, 245);
    assert.equal(objects.find((o) => o.id === idA)?.y, 125);

    // 2. Resizable
    objects = resizeAnimationSceneLayer(objects, idA, { width: 520, height: 380 });
    assert.equal(objects.find((o) => o.id === idA)?.width, 520);
    assert.equal(objects.find((o) => o.id === idA)?.height, 380);

    // 3. Reorderable (move A to front -> index 1, then back -> index 0)
    assert.deepEqual(objects.map((o) => o.id), [idA, idB]);
    objects = reorderAnimationSceneLayer(objects, idA, "front");
    assert.deepEqual(objects.map((o) => o.id), [idB, idA]);
    objects = reorderAnimationSceneLayer(objects, idA, "back");
    assert.deepEqual(objects.map((o) => o.id), [idA, idB]);

    // 4. Visible / Hidden
    objects = setAnimationSceneLayerVisibility(objects, idA, false);
    assert.equal(objects.find((o) => o.id === idA)?.visible, false);
    objects = setAnimationSceneLayerVisibility(objects, idA, true);
    assert.equal(objects.find((o) => o.id === idA)?.visible, true);

    // 5. Lockable (when locked, move and resize are blocked)
    objects = setAnimationSceneLayerLocked(objects, idA, true);
    assert.equal(objects.find((o) => o.id === idA)?.locked, true);
    objects = moveAnimationSceneLayer(objects, idA, { x: 100, y: 100 });
    assert.equal(objects.find((o) => o.id === idA)?.x, 245, "Locked layer cannot be moved");
    objects = resizeAnimationSceneLayer(objects, idA, { width: 999, height: 999 });
    assert.equal(objects.find((o) => o.id === idA)?.width, 520, "Locked layer cannot be resized");

    // Unlock and verify move works again
    objects = setAnimationSceneLayerLocked(objects, idA, false);
    objects = moveAnimationSceneLayer(objects, idA, { x: 5, y: 5 });
    assert.equal(objects.find((o) => o.id === idA)?.x, 250);
  });

  it("6. serializes animation references and standalone animated scene layers into GameBlueprint and validates cleanly", () => {
    const bp = createBlueprint({
      id: "prj-f18-serialize",
      title: "Aztec Gold Megaways",
      theme: "Aztec",
    });
    let doc = migrateDoc(designDocFromBlueprint(bp));
    const bgEl = doc.elements.find((e) => e.type === "game_background")!;

    // Add a sprite sheet animation and place it into the DesignDoc scene
    const added = addElementAnimation(doc, {
      elementId: bgEl.id,
      name: "Temple Torch Flicker",
      animationType: "Background",
      source: "sprite_sheet",
      format: "sprite-sheet",
      duration: 1600,
      fps: 24,
      loop: true,
      thumbnail: "/thumbs/torch.png",
      spriteSheetReference: {
        uri: "/sprites/torch_sheet.png",
        columns: 8,
        rows: 2,
        frameWidth: 64,
        frameHeight: 128,
        frameCount: 16,
      },
      animationExtra: "blend=add",
    });
    doc = added.doc;

    const placedInDoc = addAnimationLayerToDesignDoc(doc, added.id, {
      x: 320,
      y: 180,
      width: 256,
      height: 512,
    });
    assert.ok(placedInDoc);
    doc = placedInDoc.doc;

    // Parse DesignDoc via parseDesignDoc
    const parsedDesign = parseDesignDoc(JSON.parse(JSON.stringify(doc)));
    assert.equal(parsedDesign.ok, true, parsedDesign.ok ? "" : parsedDesign.error);

    // Apply to GameBlueprint and validate
    const mergedBp = serializeAnimationsToBlueprint(
      applyDesign(bp, doc),
      applyDesign(bp, doc).animations,
    );
    const check = validateBlueprint(mergedBp);
    assert.equal(check.integrityOk, true, check.integrityIssues.join("; "));

    // Verify the serialized animation in GameBlueprint.animations preserves all 12 fields
    const serializedAnim = mergedBp.animations.find((a) => a.id === added.id)!;
    assert.ok(serializedAnim);
    assert.equal(serializedAnim.elementId, bgEl.id);
    assert.equal(serializedAnim.name, "Temple Torch Flicker");
    assert.equal(serializedAnim.animationType, "Background");
    assert.equal(serializedAnim.source, "sprite_sheet");
    assert.equal(serializedAnim.format, "sprite-sheet");
    assert.equal(serializedAnim.duration, 1600);
    assert.equal(serializedAnim.loop, true);
    assert.equal(serializedAnim.fps, 24);
    assert.equal(serializedAnim.thumbnail, "/thumbs/torch.png");
    assert.equal(serializedAnim.videoReference, null);
    assert.equal(serializedAnim.spriteSheetReference?.columns, 8);
    assert.equal(serializedAnim.spriteSheetReference?.frameCount, 16);
    assert.equal(serializedAnim.state, "enabled");

    // Verify scene object is serialized in mergedBp.scenes[0].objects and passes parseSceneDoc
    const sceneObjects = mergedBp.scenes[0]!.objects ?? [];
    assert.equal(sceneObjects.some((o) => o.kind === "animation" && o.animationId === added.id), true);
    const parsedScene = parseSceneDoc({
      objects: sceneObjects,
      background: mergedBp.scenes[0]!.background ?? { color: "#000000", assetId: null },
      layers: mergedBp.layers,
    });
    assert.equal(parsedScene.ok, true, parsedScene.ok ? "" : parsedScene.error);

    // Verify Preview capability detection recognizes the configured sprite sheet animation
    const previewCaps = detectPreviewAnimationCapabilities(mergedBp);
    assert.equal(previewCaps.hasBackgroundAnimation, true);
    assert.equal(previewCaps.hasSpriteAnimations, true);
    assert.ok(getAllAnimations(mergedBp).length >= 4);
    assert.ok(normalizeAnimationModel(serializedAnim, mergedBp.elements, mergedBp.assets).id === added.id);
  });
});
