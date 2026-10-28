import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSlides, normalizeSlideshowOutput, serializeSlideshow } from "./slideshows.ts";

test("normalizes optional slide text and rendering controls", () => {
  const slides = normalizeSlides([
    { id: "slide-1", mediaUrl: "https://media.example.com/one.jpg", text: "Title", textSize: 999, textWidth: 4, textHeight: .01, textFont: "mono", textPosition: "top", textBackground: "none", textBackgroundColor: "#123abc", textColor: "#ff5c35", fit: "contain" },
    { id: "slide-2", mediaUrl: "https://media.example.com/two.jpg" },
  ]);
  assert.equal(slides?.length, 2);
  assert.equal(slides?.[0].textSize, 160);
  assert.equal(slides?.[0].textWidth, .92);
  assert.equal(slides?.[0].textHeight, .06);
  assert.equal(slides?.[0].textColor, "#FF5C35");
  assert.equal(slides?.[0].textFont, "mono");
  assert.equal(slides?.[0].textBackgroundColor, "#123ABC");
  assert.equal(slides?.[1].text, undefined);
  assert.equal(slides?.[1].textBackground, "dark");
  assert.equal(slides?.[1].textFont, "modern");
  assert.equal(slides?.[1].textWidth, .87);
  assert.equal(slides?.[1].textHeight, .12);
  assert.equal(slides?.[1].textBackgroundColor, "#000000");
});

test("rejects an invalid source URL or more than 35 slides", () => {
  assert.equal(normalizeSlides([{ mediaUrl: "file:///private/image.png" }]), null);
  assert.equal(normalizeSlides(Array.from({ length: 36 }, () => ({ mediaUrl: "https://media.example.com/image.png" }))), null);
});

test("normalizes device frames and rejects invalid frame colors", () => {
  const slides = normalizeSlides([{ mediaUrl: "https://media.example.com/one.jpg", deviceFrame: { device: "tablet", background: "#abcdef", color: "#123456" } }]);
  assert.deepEqual(slides?.[0].deviceFrame, { device: "tablet", background: "#ABCDEF", color: "#123456" });
  assert.equal(normalizeSlides([{ mediaUrl: "https://media.example.com/one.jpg", deviceFrame: { device: "tablet", background: "cream", color: "#123456" } }]), null);
});

test("legacy slideshow projects default to images and video timing is optional and bounded", () => {
  const project = serializeSlideshow({ id: "legacy", brand_id: null, name: "Legacy", caption: "", slides: [], created_at: "2026-10-25", updated_at: "2026-10-25" });
  assert.deepEqual(project.output, { format: "images" });
  assert.deepEqual(normalizeSlideshowOutput(undefined, 2), { format: "images" });
  assert.deepEqual(normalizeSlideshowOutput({ format: "video" }, 0), { format: "video" });
  assert.deepEqual(normalizeSlideshowOutput({ format: "video", imageSeconds: 8 }, 1), { format: "video", imageSeconds: 8 });
  assert.deepEqual(normalizeSlideshowOutput({ format: "video", imageSeconds: 3 }, 2), { format: "video", imageSeconds: 3 });
  for (const output of [null, [], "video", {}, { format: "mp4" }, { format: "video", imageSeconds: "4" }, { format: "video", imageSeconds: null }, { format: "video", imageSeconds: 3.5 }, { format: "video", imageSeconds: 8 }]) assert.equal(normalizeSlideshowOutput(output, 2), null);
});
