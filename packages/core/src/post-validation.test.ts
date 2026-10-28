import assert from "node:assert/strict";
import test from "node:test";
import { validatePostPlan } from "./post-validation.ts";

test("allows automatic YouTube image videos while Facebook reels still require video", () => {
  const issues = validatePostPlan({ text: "Launch", mediaType: "image", destinations: [
    { provider: "youtube", settings: { kind: "youtube", title: "Launch", tags: [], privacyStatus: "private", madeForKids: false } },
    { provider: "facebook", settings: { kind: "facebook", publishType: "reel" } },
  ] });
  assert.deepEqual(issues.map((issue) => issue.provider), ["facebook"]);
});

test("YouTube requires media and validates image timing by slide count", () => {
  const youtube = { provider: "youtube" as const, settings: { kind: "youtube" as const, title: "Images", tags: [], privacyStatus: "private" as const, madeForKids: false } };
  assert.equal(validatePostPlan({ text: "Text only", mediaType: "none", destinations: [youtube] })[0]?.field, "media");
  for (const [mediaCount, imageSeconds, valid] of [[1, undefined, true], [1, 5, true], [1, 10, true], [1, 4, false], [3, undefined, true], [3, 3, true], [3, 5, true], [3, 8, false], [35, 5, true], [36, 4, false], [0, 4, false], [2, 3.5, false]] as const) {
    const issues = validatePostPlan({ text: "Images", mediaType: "image", mediaCount, destinations: [{ ...youtube, settings: { ...youtube.settings, imageSeconds } }] });
    assert.equal(issues.length === 0, valid, `${mediaCount} images at ${imageSeconds}s`);
  }
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

test("Instagram requires media for feed, reel and story publication", () => {
  for (const publishType of ["feed", "reel", "story"] as const) {
    const destinations = [{ provider: "instagram" as const, settings: { kind: "instagram" as const, publishType } }];
    const issues = validatePostPlan({ text: "Caption-only draft", mediaType: "none", destinations });
    assert.ok(issues.some((issue) => issue.provider === "instagram" && issue.field === "media"), publishType);
    for (const mediaType of ["image", "video"] as const) {
      assert.deepEqual(validatePostPlan({ text: "Ready to publish", mediaType, mediaCount: 1, destinations }), []);
    }
  }
  assert.deepEqual(validatePostPlan({ text: "Text feed", mediaType: "none", destinations: [{ provider: "facebook", settings: { kind: "facebook", publishType: "feed" } }] }), []);
});
