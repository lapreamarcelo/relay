import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSlides } from "./slideshows.ts";

test("normalizes optional slide text and rendering controls", () => {
  const slides = normalizeSlides([
    { id: "slide-1", mediaUrl: "https://media.example.com/one.jpg", text: "Title", textSize: 999, textPosition: "top", textBackground: "none", textColor: "#ff5c35", fit: "contain" },
    { id: "slide-2", mediaUrl: "https://media.example.com/two.jpg" },
  ]);
  assert.equal(slides?.length, 2);
  assert.equal(slides?.[0].textSize, 120);
  assert.equal(slides?.[0].textColor, "#FF5C35");
  assert.equal(slides?.[1].text, undefined);
  assert.equal(slides?.[1].textBackground, "dark");
});

test("rejects an invalid source URL or more than 35 slides", () => {
  assert.equal(normalizeSlides([{ mediaUrl: "file:///private/image.png" }]), null);
  assert.equal(normalizeSlides(Array.from({ length: 36 }, () => ({ mediaUrl: "https://media.example.com/image.png" }))), null);
});
