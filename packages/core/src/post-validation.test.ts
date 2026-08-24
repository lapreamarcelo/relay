import assert from "node:assert/strict";
import test from "node:test";
import { validatePostPlan } from "./post-validation.ts";

test("requires video for YouTube and Facebook reels", () => {
  const issues = validatePostPlan({ text: "Launch", mediaType: "image", destinations: [
    { provider: "youtube", settings: { kind: "youtube", title: "Launch", tags: [], privacyStatus: "private", madeForKids: false } },
    { provider: "facebook", settings: { kind: "facebook", publishType: "reel" } },
  ] });
  assert.deepEqual(issues.map((issue) => issue.provider), ["youtube", "facebook"]);
});

test("validates the per-network caption instead of only the base caption", () => {
  const issues = validatePostPlan({ text: "Base", mediaType: "image", destinations: [
    { provider: "instagram", textOverride: "x".repeat(2_201), settings: { kind: "instagram", publishType: "feed" } },
  ] });
  assert.equal(issues[0]?.field, "caption");
});

test("validates carousel limits and feed-only Meta settings", () => {
  const issues = validatePostPlan({ text: "Carousel", mediaType: "image", mediaCount: 11, destinations: [
    { provider: "instagram", settings: { kind: "instagram", publishType: "story" } },
    { provider: "facebook", settings: { kind: "facebook", publishType: "reel" } },
  ] });
  assert.deepEqual(issues.map((issue) => issue.message), ["Instagram carousels support up to 10 slides.", "Instagram carousels publish as feed posts.", "Facebook Reels require a video.", "Facebook multi-photo posts publish to the feed."]);
});
