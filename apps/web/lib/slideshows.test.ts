import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSlides } from "./slideshows.ts";

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
