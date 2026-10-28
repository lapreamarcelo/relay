import assert from "node:assert/strict";
import test from "node:test";
import { youtubeImageMediaError } from "./youtube-image-media.ts";

const plan = { mediaType: "image", mediaUrl: "https://media.example.test/library/first.jpg", mediaUrls: ["https://media.example.test/library/first.jpg", "https://media.example.test/library/second.png"], destinations: [{ provider: "youtube" }] };
test("YouTube conversion requires all ordered source images inside the configured R2 URL", () => {
  assert.equal(youtubeImageMediaError(plan, "https://media.example.test/library"), undefined);
  assert.equal(youtubeImageMediaError({ ...plan, mediaUrls: [] }, "https://media.example.test/library/"), undefined);
  for (const url of ["https://evil.example/second.jpg", "https://media.example.test/library-other/second.jpg", "http://media.example.test/library/second.jpg", "https://media.example.test/library/../second.jpg", "invalid"]) {
    assert.ok(youtubeImageMediaError({ ...plan, mediaUrls: [plan.mediaUrl, url] }, "https://media.example.test/library"));
  }
  assert.ok(youtubeImageMediaError({ ...plan, mediaUrls: [...plan.mediaUrls].reverse() }, "https://media.example.test/library"));
  assert.ok(youtubeImageMediaError(plan, ""));
  assert.equal(youtubeImageMediaError({ ...plan, destinations: [{ provider: "facebook" }] }, ""), undefined);
  assert.equal(youtubeImageMediaError({ ...plan, mediaType: "video" }, ""), undefined);
});
