import test from "node:test";
import assert from "node:assert/strict";
import { compileMotionRecipe, motionRecipes, retimeMotion } from "./video-motion-presets.ts";

test("Relay recipes return to authored resting poses and compile to bounded, editable keys", () => {
  for (const recipe of motionRecipes) for (const duration of [1, 37, 6000]) for (const target of ["label", "device"] as const) {
    const base = { x: .99, y: .96, scale: target === "device" ? 1.5 : 3, rotateZ: 179, opacity: .75, rotateX: 12, rotateY: -8, foldAngle: 45 };
    const result = compileMotionRecipe(recipe.id, duration, base, target), frames = result.keyframes!;
    assert.equal(frames[0].timeMs, 0); assert.equal(frames.at(-1)!.timeMs, duration);
    assert.equal(frames.at(-1)!.x, base.x); assert.equal(frames.at(-1)!.y, base.y); assert.equal(frames.at(-1)!.scale, base.scale); assert.equal(frames.at(-1)!.rotateZ, base.rotateZ); assert.equal(frames.at(-1)!.opacity, base.opacity);
    frames.forEach((frame, index) => { assert.ok(index === 0 || frame.timeMs > frames[index - 1].timeMs); assert.ok(frame.x! >= 0 && frame.x! <= 1); assert.ok(frame.y! >= 0 && frame.y! <= 1); assert.ok(frame.scale! <= (target === "device" ? 1.5 : 3)); });
    assert.equal(frames[0].rotateX, target === "device" ? 12 : undefined);
    assert.equal(frames.at(-1)!.foldAngle, target === "device" ? 45 : undefined);
    if (target === "device") { assert.equal(frames.at(-1)!.rotateX, base.rotateX); assert.equal((frames.at(-1)!.rotateY! - base.rotateY) % 360, 0); }
  }
});
test("retiming scales fractional times without mutating source poses or curves", () => {
  const source = [{ timeMs: 0, scale: .5, easing: "spring", curve: { stiffness: 140 } }, { timeMs: 2500.25, scale: 1 }];
  const copy = structuredClone(source), result = retimeMotion(source, 5000, 2000);
  assert.deepEqual(source, copy); assert.equal(result[1].timeMs, 1000.1); assert.deepEqual(result[0].curve, source[0].curve);
  assert.throws(() => retimeMotion(source, 0, 2000)); assert.throws(() => compileMotionRecipe("settle", NaN));
});
