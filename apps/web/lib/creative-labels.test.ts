import assert from "node:assert/strict";
import test from "node:test";

import { creativeLabelHeight, normalizeCreativeLabels, presetChanges } from "./creative-labels.ts";

test("normalizes draggable labels and clamps their canvas position", () => {
  const labels = normalizeCreativeLabels([{ text: " Hook ", x: 2, y: -1, width: .1, height: .9, fontSize: 300, style: "outline" }]);
  assert.deepEqual(labels?.map(({ text, x, y, width, height, fontSize, background, backgroundColor, textColor }) => ({ text, x, y, width, height, fontSize, background, backgroundColor, textColor })), [{ text: "Hook", x: .92, y: .06, width: .25, height: .35, fontSize: 160, background: "none", backgroundColor: "#000000", textColor: "#FFFFFF" }]);
});

test("the three shortcuts set legible foreground and backdrop pairs", () => {
  assert.deepEqual(presetChanges("dark"), { style: "dark", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000" });
  assert.deepEqual(presetChanges("light"), { style: "light", textColor: "#111111", background: "light", backgroundColor: "#FFFFFF" });
  assert.deepEqual(presetChanges("outline"), { style: "outline", textColor: "#FFFFFF", background: "none", backgroundColor: "#000000" });
});

test("label fonts normalize to bundled render-safe choices", () => {
  assert.equal(normalizeCreativeLabels([{ text: "Editorial", font: "editorial" }])?.[0].font, "editorial");
  assert.equal(normalizeCreativeLabels([{ text: "Fallback", font: "unknown" }])?.[0].font, "modern");
});

test("label height defaults to twelve percent of the canvas", () => {
  assert.equal(normalizeCreativeLabels([{ text: "Default height" }])?.[0].height, .12);
});

test("label backgrounds grow beyond their minimum height when text wraps", () => {
  const short = { text: "Short hook", width: .84, height: .12, fontSize: 72 };
  const long = { ...short, text: "A longer hook that wraps across several lines and needs the background to grow with the words" };
  assert.equal(creativeLabelHeight(short), Math.round(1920 * .12));
  assert.ok(creativeLabelHeight(long) > creativeLabelHeight(short));
});
