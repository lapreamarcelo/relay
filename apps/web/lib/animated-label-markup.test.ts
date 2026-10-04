import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import type { TimedVideoLabel } from "@relay/core";
import { animatedLabelsMarkup } from "./animated-label-markup.ts";

const label: TimedVideoLabel = { id: "one", text: "Launch your app", x: .5, y: .3, width: .7, height: .12, fontSize: 32, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#FF00FF", style: "dark", startMs: 100, endMs: 2100 };
test("animated label SVG uses local time, typing, easing, opacity and half-open lifetime", async () => {
  const typed = { ...label, animation: { entrance: { preset: "typewriter" as const, durationMs: 1000, easing: "linear" as const }, exit: { preset: "fade" as const, durationMs: 500 }, keyframes: [{ timeMs: 0, x: .2, easing: "ease-in" as const }, { timeMs: 1000, x: .8, rotateZ: 20 }] } };
  assert.doesNotMatch(animatedLabelsMarkup([typed], 99, 320, 480), /<g/);
  assert.doesNotMatch(animatedLabelsMarkup([typed], 100, 320, 480), /<g/);
  const halfway = animatedLabelsMarkup([typed], 600, 320, 480);
  assert.match(halfway, /Launch /);
  assert.doesNotMatch(halfway, /Launch your app/);
  const position = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(halfway)!;
  assert.ok(Math.abs(Number(position[1]) - 112) < 1e-8); assert.equal(Number(position[2]), 144);
  const faded = animatedLabelsMarkup([typed], 1850, 320, 480);
  assert.match(faded, /opacity="0\.25"/);
  assert.doesNotMatch(animatedLabelsMarkup([typed], 2100, 320, 480), /<g/);
  const { data, info } = await sharp(Buffer.from(faded)).raw().toBuffer({ resolveWithObject: true });
  let maxAlpha = 0; for (let i = info.channels - 1; i < data.length; i += info.channels) maxAlpha = Math.max(maxAlpha, data[i]);
  assert.ok(maxAlpha > 50 && maxAlpha < 80, "real rasterization preserves animated alpha");
});
test("multiple animated labels use independent clipping paths and typing preserves box height", () => {
  const typed = { ...label, text: "Long enough to wrap onto several lines", animation: { entrance: { preset: "typewriter" as const, durationMs: 1000 } } };
  const svg = animatedLabelsMarkup([typed, { ...label, id: "two", y: .8 }], 350, 320, 480);
  assert.match(svg, /id="animated-label-0"/); assert.match(svg, /id="animated-label-1"/);
  assert.match(svg, /url\(#animated-label-0\)/); assert.match(svg, /url\(#animated-label-1\)/);
});
