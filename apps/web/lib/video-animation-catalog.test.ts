import test from "node:test";
import assert from "node:assert/strict";
import { videoAnimationCatalog } from "./video-animation-catalog.ts";
import { normalizeLayerAnimation, textOnlyPresets } from "./video-animation.ts";

test("published motion catalog exposes editable recipes, curves and only compatible device effects", () => {
  const catalog = videoAnimationCatalog();
  assert.ok(catalog.easings.includes("spring")); assert.ok(catalog.easings.includes("cubic-bezier"));
  for (const effect of textOnlyPresets) { assert.ok(catalog.textPresets.includes(effect)); assert.ok(!catalog.framePresets.includes(effect)); }
  for (const recipe of catalog.motionRecipes) { assert.doesNotThrow(() => normalizeLayerAnimation(recipe.example)); assert.equal(recipe.example.keyframes!.at(-1)!.timeMs, 2000); }
  assert.deepEqual(catalog.exportSettings.fps, [24,30,60]); assert.equal(catalog.pointers.maxEvents, 2000);
});
test('catalog describes safe drawings, source analysis and actual scene typography constraints',()=>{
 const catalog=videoAnimationCatalog();assert.equal(catalog.version,3);assert.ok(catalog.graphics.kinds.includes('code'));assert.equal(catalog.graphics.code.hostAccess,false);assert.equal(catalog.graphics.code.shapesPerFrame,512);assert.equal(catalog.audioAnalysis.maximumFrames,45000);assert.ok(catalog.scene.rendering.includes('gpu'));assert.deepEqual(catalog.typography.sceneLayer,['overlay','scene','back']);
});
