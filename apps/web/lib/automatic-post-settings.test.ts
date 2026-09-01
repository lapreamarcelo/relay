import assert from "node:assert/strict";
import test from "node:test";

import { automaticInstagramSettings, middleVideoFrameMs } from "./automatic-post-settings.ts";

test("selects the middle video frame for automated Instagram Reels", () => {
  assert.deepEqual(automaticInstagramSettings("reel", "video", 12_500), {
    kind: "instagram",
    publishType: "reel",
    thumbOffsetMs: 6_250,
  });
});

test("does not send a frame for Instagram posts that are not video Reels", () => {
  assert.equal(automaticInstagramSettings("feed", "video", 12_500).thumbOffsetMs, undefined);
  assert.equal(automaticInstagramSettings("reel", "image", 12_500).thumbOffsetMs, undefined);
});

test("normalizes automated frame offsets to Meta's accepted range", () => {
  assert.equal(middleVideoFrameMs(undefined), undefined);
  assert.equal(middleVideoFrameMs(Number.NaN), undefined);
  assert.equal(middleVideoFrameMs(10_001), 5_001);
  assert.equal(middleVideoFrameMs(2_000_000), 900_000);
});
