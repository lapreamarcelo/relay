import assert from "node:assert/strict";
import test from "node:test";

import { selectMusicTrack } from "./videos.ts";

test("bulk music can stay fixed or rotate deterministically", () => {
  assert.equal(selectMusicTrack("fixed", ["a", "b"], 4, "theme"), "theme");
  assert.equal(selectMusicTrack("rotate", ["a", "b"], 3), "b");
  assert.equal(selectMusicTrack("none", ["a"], 0), undefined);
});

test("random bulk music remains inside the selected folder", () => {
  assert.equal(selectMusicTrack("random", ["a", "b", "c"], 0, undefined, () => .99), "c");
});
