import assert from "node:assert/strict";
import test from "node:test";
import { imageVideoSeconds } from "./image-video.ts";

test("image video defaults and timing boundaries", () => {
  assert.equal(imageVideoSeconds(1), 8);
  assert.equal(imageVideoSeconds(2), 4);
  assert.equal(imageVideoSeconds(1, 5), 5);
  assert.equal(imageVideoSeconds(1, 10), 10);
  assert.equal(imageVideoSeconds(35, 5), 5);
  for (const count of [0, -1, 1.5, 36, NaN, Infinity]) assert.throws(() => imageVideoSeconds(count));
  for (const seconds of [NaN, Infinity, 0, 4, 11, 5.5]) assert.throws(() => imageVideoSeconds(1, seconds));
  for (const seconds of [0, 2, 6, 8, 3.5]) assert.throws(() => imageVideoSeconds(2, seconds));
});
