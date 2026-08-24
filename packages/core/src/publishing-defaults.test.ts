import assert from "node:assert/strict";
import test from "node:test";

import { defaultPublishingDefaults, normalizePublishingDefaults } from "./index.ts";

test("publishing defaults are safe and media-aware by default", () => {
  assert.deepEqual(normalizePublishingDefaults(null), defaultPublishingDefaults);
  assert.equal(defaultPublishingDefaults.instagram.videoPublishType, "reel");
  assert.equal(defaultPublishingDefaults.tiktok.privacyLevel, "SELF_ONLY");
  assert.equal(defaultPublishingDefaults.youtube.privacyStatus, "public");
});

test("publishing defaults retain valid values and replace invalid input", () => {
  const normalized = normalizePublishingDefaults({
    instagram: { imagePublishType: "story", videoPublishType: "invalid" },
    facebook: { videoPublishType: "feed" },
    tiktok: { privacyLevel: "PUBLIC_TO_EVERYONE", allowComments: false, allowDuet: true, allowStitch: "yes" },
    youtube: { privacyStatus: "unlisted", madeForKids: true },
  });
  assert.deepEqual(normalized.instagram, { imagePublishType: "story", videoPublishType: "reel" });
  assert.deepEqual(normalized.facebook, { videoPublishType: "feed" });
  assert.deepEqual(normalized.tiktok, { privacyLevel: "PUBLIC_TO_EVERYONE", allowComments: false, allowDuet: true, allowStitch: false });
  assert.deepEqual(normalized.youtube, { privacyStatus: "unlisted", madeForKids: true });
});
