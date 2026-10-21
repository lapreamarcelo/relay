import assert from "node:assert/strict";
import test from "node:test";
import { emptyMediaPostUsage, indexMediaPostUsage, matchesMediaUsage, type MediaUsageRow } from "./media-post-usage.ts";

const row = (changes: Partial<MediaUsageRow> = {}): MediaUsageRow => ({ id: "post", media_url: "image", media_urls: ["image", "carousel-image"], status: "scheduled", target_status: null, settings: null, ...changes });

test("counts posts once per URL and preserves scheduled and published destinations", () => {
  const index = indexMediaPostUsage([
    row({ target_status: "scheduled" }), row({ target_status: "scheduled" }),
    row({ status: "failed", target_status: "published" }),
    row({ id: "another-post", target_status: "published" }),
  ]);
  assert.deepEqual(index.get("image"), { scheduled: 1, published: 2, publishing: 0 });
  assert.deepEqual(index.get("carousel-image"), index.get("image"));
  assert.equal(matchesMediaUsage(index.get("image")!, "scheduled"), true);
  assert.equal(matchesMediaUsage(index.get("image")!, "published"), true);
  assert.equal(matchesMediaUsage(index.get("image")!, "none"), false);
});

test("active publishing, covers, and thumbnails retain their own destination status", () => {
  const index = indexMediaPostUsage([
    row({ target_status: "processing", settings: { kind: "instagram", coverUrl: "cover" } }),
    row({ target_status: "published", settings: { kind: "youtube", thumbnailUrl: "thumbnail" } }),
    row({ id: "publishing", media_url: "in-flight", media_urls: [], status: "publishing" }),
  ]);
  assert.deepEqual(index.get("cover"), { scheduled: 0, published: 0, publishing: 1 });
  assert.deepEqual(index.get("thumbnail"), { scheduled: 0, published: 1, publishing: 0 });
  assert.equal(matchesMediaUsage(index.get("in-flight")!, "publishing"), true);
  assert.equal(matchesMediaUsage(index.get("cover")!, "none"), false);
});

test("drafts and failed posts alone have no scheduled or published usage", () => {
  assert.equal(indexMediaPostUsage([row({ status: "draft" }), row({ status: "failed" })]).size, 0);
  assert.equal(matchesMediaUsage(emptyMediaPostUsage(), "none"), true);
  assert.equal(matchesMediaUsage(emptyMediaPostUsage(), "all"), true);
  assert.equal(matchesMediaUsage(emptyMediaPostUsage(), "published"), false);
});
