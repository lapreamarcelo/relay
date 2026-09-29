import assert from "node:assert/strict";
import test from "node:test";

import { objectKeyFromPublicUrl, videoDownloadContentDisposition, videoDownloadFilename } from "./video-download.ts";

test("derives an R2 object key only from the configured public URL boundary", () => {
  assert.equal(
    objectKeyFromPublicUrl(
      "https://media.example.com/public/media-projects/job/media/final%20cut.mp4",
      "https://media.example.com/public",
    ),
    "media-projects/job/media/final cut.mp4",
  );
  assert.equal(
    objectKeyFromPublicUrl("https://media.example.com/publicity/video.mp4", "https://media.example.com/public"),
    null,
  );
  assert.equal(
    objectKeyFromPublicUrl("https://other.example.com/public/video.mp4", "https://media.example.com/public"),
    null,
  );
  assert.equal(
    objectKeyFromPublicUrl("https://media.example.com/public/folder%2Fsecret.mp4", "https://media.example.com/public"),
    null,
  );
  assert.equal(
    objectKeyFromPublicUrl("https://media.example.com/public/video.mp4?redirect=https://other.example", "https://media.example.com/public"),
    null,
  );
});

test("creates a safe attachment filename from the render snapshot name", () => {
  assert.equal(videoDownloadFilename("  Product / launch: final.mp4  "), "Product - launch- final.mp4");
  assert.equal(videoDownloadFilename("../../\r\nunsafe"), "unsafe.mp4");
  assert.equal(videoDownloadFilename(null), "video.mp4");
  assert.equal(
    videoDownloadContentDisposition("Café launch"),
    "attachment; filename=\"Caf- launch.mp4\"; filename*=UTF-8''Caf%C3%A9%20launch.mp4",
  );
  assert.equal(
    videoDownloadContentDisposition("新作"),
    "attachment; filename=\"video.mp4\"; filename*=UTF-8''%E6%96%B0%E4%BD%9C.mp4",
  );
});
