import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { labelGraphemes, labelWords, measureLabelText } from "./label-font-metrics.ts";
import { creativeLabelsMarkup, creativeLabelLayout } from "./creative-label-markup.ts";
import { creativeLabelHeight, normalizeLabelTypography, wrapCreativeLabel } from "./creative-labels.ts";
import { animatedLabelsMarkup } from "./animated-label-markup.ts";
import { animationPresets, textOnlyPresets } from "./video-animation.ts";
import type { TimedVideoLabel } from "@relay/core";

const label: TimedVideoLabel = { id: "type", text: "AV Café\nKeep score.", x: .5, y: .5, width: .85, height: .12, fontSize: 40, font: "modern", textColor: "#FFFFFF", background: "none", style: "outline", startMs: 0, endMs: 3000 };

test("bundled font advance widths and pair kerning match original TrueType tables", () => {
  // Independent expected values from the original DejaVu Sans Bold hmtx/kern tables (2048 units/em).
  for (const [text, expected] of [["iiii", 137.109375], ["WWWW", 441.2109375], ["AV", 147.998046875], ["To", 123.6328125], ["Café", 252.197265625], ["Racketly", 482.666015625]] as const) assert.equal(measureLabelText(text, 100).width, expected);
  assert.ok(measureLabelText("AV", 100).width < measureLabelText("A", 100).width + measureLabelText("V", 100).width);
  assert.equal(measureLabelText("AV", 100, { kerning: false }).width, measureLabelText("A", 100).width + measureLabelText("V", 100).width);
  assert.equal(measureLabelText("AV", 100, { letterSpacing: 3 }).width, 150.998046875);
  assert.ok(measureLabelText("Relay", 100, { fontWeight: 400 }).width < measureLabelText("Relay", 100).width);
  assert.equal(measureLabelText("Café", 100).width, measureLabelText("Cafe\u0301", 100).width);
});
test("wrapping uses measured glyph widths, explicit paragraphs, and grapheme-safe long-word breaks", () => {
  assert.equal(wrapCreativeLabel("iiii iiii", 40, 150).length, 1);
  assert.ok(wrapCreativeLabel("WWWW WWWW", 40, 150).length > 1);
  const lines = wrapCreativeLabel("Cafe\u0301Cafe\u0301Cafe\u0301", 40, 120);
  assert.ok(lines.every(line => !line.startsWith("\u0301")));
  assert.deepEqual(wrapCreativeLabel("First\n\nThird", 30, 300), ["First", "", "Third"]);
  assert.deepEqual(labelGraphemes("A👨‍👩‍👧‍👦e\u0301🇵🇹"), ["A", "👨‍👩‍👧‍👦", "e\u0301", "🇵🇹"]);
  assert.equal(labelWords("你好，世界!").join(""), "你好，世界!");
});
test("font paths include composed glyphs and unsupported codepoints have an explicit deterministic fallback", async () => {
  assert.ok(measureLabelText("Café", 40).glyphs[3].path.includes("Q"));
  assert.equal(measureLabelText("\u{10ffff}", 40).unsupported, true);
  assert.equal(measureLabelText("Σ Д é", 40).unsupported, false);
  const svg = creativeLabelsMarkup([{ ...label, italic: true, fontWeight: 400, strokeWidth: 2, shadowBlur: 4, shadowY: 2, backgroundRadius: 8 }], 600, 400);
  assert.match(svg, /skewX\(-12\)/); assert.match(svg, /vector-effect="non-scaling-stroke"/); assert.match(svg, /feDropShadow/);
  assert.doesNotMatch(svg, /<text\b/); // No host font substitution in either renderer.
  const { data, info } = await sharp(Buffer.from(svg)).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data.some((value, i) => i % info.channels === info.channels - 1 && value > 0));
});
test("text alignment and line spacing use the full layout through typewriter reveal", () => {
  const left = creativeLabelLayout({ ...label, textAlign: "left" }, 600, 400), right = creativeLabelLayout({ ...label, textAlign: "right" }, 600, 400);
  assert.equal(left.lines[0].x, left.left + 35);
  assert.equal(right.lines[0].x + right.lines[0].measured.width, right.left + right.boxWidth - 35);
  assert.ok(creativeLabelHeight({ ...label, lineHeight: 2 }, 600, 400) > creativeLabelHeight(label, 600, 400));
  const partial = creativeLabelsMarkup([label], 600, 400, { reveal: .2 }), complete = creativeLabelsMarkup([label], 600, 400);
  assert.equal(/<rect[^>]+height="([^"]+)"/.exec(partial)?.[1], /<rect[^>]+height="([^"]+)"/.exec(complete)?.[1]);
  assert.ok(complete.includes(/<path d="([^"]+)"[^>]*transform="([^"]+)"/.exec(partial)![0]));
});
test("every original text effect rasterizes and settles to the same glyph positions", async () => {
  assert.equal(animationPresets.length, 36); assert.equal(textOnlyPresets.size, 29);
  const staticRaster = await sharp(Buffer.from(creativeLabelsMarkup([label], 600, 400))).raw().toBuffer();
  for (const preset of textOnlyPresets) {
    const animated = { ...label, animation: { entrance: { preset, durationMs: 600 }, exit: { preset, durationMs: 600 } } };
    const entering = animatedLabelsMarkup([animated], 300, 600, 400), settled = animatedLabelsMarkup([animated], 1500, 600, 400), exiting = animatedLabelsMarkup([animated], 2700, 600, 400);
    assert.doesNotMatch(entering + settled + exiting, /NaN|Infinity/);
    await sharp(Buffer.from(entering)).png().toBuffer(); await sharp(Buffer.from(exiting)).png().toBuffer();
    const raster = await sharp(Buffer.from(settled)).raw().toBuffer();
    const difference = raster.reduce((total, value, i) => total + Math.abs(value - staticRaster[i]), 0);
    assert.ok(difference < 100, `${preset} settles to the same font path layout (${difference})`);
  }
});
test("typography input validation preserves defaults and clamps bounded style controls", () => {
  assert.deepEqual(normalizeLabelTypography({}), {});
  assert.deepEqual(normalizeLabelTypography({ fontWeight: 700, letterSpacing: 50, shadowBlur: 90, backgroundOpacity: -.5, sceneLayer: "scene", sceneDepth: 9 }), { fontWeight: 700, letterSpacing: 40, shadowBlur: 40, backgroundOpacity: 0, sceneLayer: "scene", sceneDepth: 2 });
  for (const input of [{ fontWeight: 500 }, { textAlign: "justify" }, { italic: "true" }, { shadowColor: "url(http://evil)" }, { letterSpacing: NaN }, { sceneLayer: "unknown" }]) assert.throws(() => normalizeLabelTypography(input));
});
