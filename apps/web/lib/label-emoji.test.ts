import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { TimedVideoLabel } from "@relay/core";
import { measureLabelText } from "./label-font-metrics.ts";
import { wrapCreativeLabel } from "./creative-labels.ts";
import { creativeLabelsMarkup, labelTextMarkup } from "./creative-label-markup.ts";
import { animatedLabelsMarkup } from "./animated-label-markup.ts";
import { textOnlyPresets } from "./video-animation.ts";
import { preloadLabelEmoji } from "./label-emoji.ts";

const samples = ["😀", "🚀", "✨", "❤️", "👍🏽", "👩🏽‍💻", "👨‍👩‍👧‍👦", "🇪🇸", "1️⃣", "🏳️‍🌈"];
const label: TimedVideoLabel = { id: "emoji", text: "Go 👩🏽‍💻 🇪🇸 🚀", font: "modern", fontSize: 48, x: .5, y: .5, width: .9, height: .12, textColor: "#FFFFFF", background: "none", style: "outline", startMs: 0, endMs: 3000 };
await preloadLabelEmoji(samples.join(" "));

test("loading artwork preserves reserved glyph width and refreshes pending measurements", async () => {
  const source = "A🦔B";
  const before = measureLabelText(source, 48);
  await Promise.all([preloadLabelEmoji(source), preloadLabelEmoji(source)]);
  const after = measureLabelText(source, 48);
  assert.equal(after.width, before.width);
  assert.equal(after.glyphs.length, 3);
  assert.ok(after.glyphs[1].emoji?.svg);
});

test("emoji sequences measure as one color glyph in every label font and wrap atomically", () => {
  for (const font of ["modern", "editorial", "mono"] as const) for (const sample of samples) {
    const measured = measureLabelText(sample, 48, { font });
    assert.equal(measured.unsupported, false, sample);
    assert.equal(measured.glyphs.length, 1, sample);
    assert.ok(measured.glyphs[0].emoji, sample);
    assert.equal(measured.width, 48);
    assert.deepEqual(wrapCreativeLabel(sample + sample, 48, 50, { font }), [sample, sample]);
    const mixed = measureLabelText(`A${sample}B`, 48, { font, letterSpacing: 3 });
    assert.equal(mixed.width, measureLabelText("A", 48, { font }).width + 48 + measureLabelText("B", 48, { font }).width + 6);
  }
  assert.equal(measureLabelText("❤\uFE0E", 48).glyphs[0].emoji, undefined, "explicit text presentation remains text");
});

test("typewriter reveal keeps joined emoji together and does not reveal the following letter early", () => {
  const typed = { ...label, text: "A👨‍👩‍👧‍👦B" };
  const before = creativeLabelsMarkup([typed], 600, 400, { reveal: 1 / 3 });
  const middle = creativeLabelsMarkup([typed], 600, 400, { reveal: 2 / 3 });
  const after = creativeLabelsMarkup([typed], 600, 400);
  assert.doesNotMatch(before, /data-label-emoji/);
  assert.equal((middle.match(/data-label-emoji=/g) ?? []).length, 1);
  const lastPath = measureLabelText("B", 48).glyphs[0].path;
  assert.equal(middle.includes(`d="${lastPath}"`), false);
  assert.ok(after.includes(`d="${lastPath}"`));
});

test("all text animation effects settle to identical colored emoji artwork", async () => {
  const expected = await sharp(Buffer.from(creativeLabelsMarkup([label], 600, 400))).ensureAlpha().raw().toBuffer();
  let colored = 0;
  for (let i = 0; i < expected.length; i += 4) if (expected[i + 3] > 100 && Math.max(...expected.subarray(i, i + 3)) - Math.min(...expected.subarray(i, i + 3)) > 70) colored++;
  assert.ok(colored > 1000, "export raster contains real color artwork, not missing-glyph outlines");
  for (const preset of textOnlyPresets) {
    const animated = { ...label, animation: { entrance: { preset, durationMs: 600 }, exit: { preset, durationMs: 600 } } };
    const settled = await sharp(Buffer.from(animatedLabelsMarkup([animated], 1500, 600, 400))).ensureAlpha().raw().toBuffer();
    const difference = settled.reduce((total, value, i) => total + Math.abs(value - expected[i]), 0);
    assert.ok(difference < 100, `${preset} keeps grapheme glyph ranges and positions (${difference})`);
    await sharp(Buffer.from(animatedLabelsMarkup([animated], 300, 600, 400))).png().toBuffer();
  }
});

test("DOM slideshow titles use the same artwork and escape arbitrary user text", () => {
  const markup = labelTextMarkup('<img src=x onerror="alert(1)"> 👩🏽‍💻 & ❤️');
  assert.doesNotMatch(markup, /<img|<script|<style|href=/);
  assert.match(markup, /&lt;img/);
  assert.match(markup, /&amp;/);
  assert.equal((markup.match(/data-label-emoji=/g) ?? []).length, 2);
});
