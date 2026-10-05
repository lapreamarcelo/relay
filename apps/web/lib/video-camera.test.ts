import assert from "node:assert/strict";
import test from "node:test";
import type { VideoCamera } from "@relay/core";
import { defaultVideoCamera, normalizeVideoCamera, videoCameraFilter, videoCameraPreset, videoCameraState, videoCameraTransform, videoCameraViewport } from "./video-camera.ts";

test("camera defaults and sparse tracks interpolate independently with departing easing", () => {
  assert.equal(normalizeVideoCamera(undefined), undefined);
  assert.deepEqual(normalizeVideoCamera({}), defaultVideoCamera);
  const camera: VideoCamera = { zoom: 1, x: .5, y: .5, keyframes: [{ timeMs: 0, zoom: 1, easing: "ease-in" }, { timeMs: 1000, zoom: 3 }, { timeMs: 2000, x: .9 }] };
  assert.deepEqual(videoCameraState(camera, 500), { zoom: 1.5, x: .6, y: .5 });
  assert.deepEqual(videoCameraState(camera, 2500), { zoom: 3, x: .9, y: .5 });
  assert.deepEqual(videoCameraState(undefined, -10), defaultVideoCamera);
});

test("focus clamping fills the viewport and CSS centers the selected source point", () => {
  assert.deepEqual(videoCameraViewport({ zoom: 1, x: 0, y: 1 }, 0), { zoom: 1, centerX: .5, centerY: .5 });
  assert.deepEqual(videoCameraViewport({ zoom: 4, x: 0, y: 1 }, 0), { zoom: 4, centerX: .125, centerY: .875 });
  assert.equal(videoCameraTransform({ zoom: 2, x: .25, y: .75 }, 0), "translate(50%, -50%) scale(2)");
});

test("camera presets zoom in, out and return on the global timeline", () => {
  const focus = { zoom: 3, x: .25, y: .7 };
  const zoomIn = videoCameraPreset("zoom-in", 4000, focus);
  assert.deepEqual(videoCameraState(zoomIn, 0), defaultVideoCamera);
  assert.deepEqual(videoCameraState(zoomIn, 2000), { zoom: 2, x: .375, y: .6 });
  assert.deepEqual(videoCameraState(zoomIn, 4000), focus);
  const zoomOut = videoCameraPreset("zoom-out", 4000, focus);
  assert.deepEqual(videoCameraState(zoomOut, 0), focus);
  assert.deepEqual(videoCameraState(zoomOut, 4000), defaultVideoCamera);
  const returning = videoCameraPreset("focus-return", 4000, focus);
  for (const time of [1000, 2000, 3000]) assert.deepEqual(videoCameraState(returning, time), focus);
  assert.deepEqual(videoCameraState(returning, 4000), defaultVideoCamera);
});

test("camera normalization rejects unsupported, unsafe and ambiguous agent input", () => {
  for (const value of [null, [], 1, { z: 2 }, { zoom: 0 }, { zoom: 4.1 }, { x: NaN }, { y: Infinity }, { x: -.1 }, { y: 1.1 }, { keyframes: {} }, { keyframes: Array(101).fill({ timeMs: 0, zoom: 1 }) }]) assert.throws(() => normalizeVideoCamera(value));
  for (const keyframes of [[{ timeMs: 0 }], [{ timeMs: -1, zoom: 1 }], [{ timeMs: 900001, zoom: 1 }], [{ timeMs: 0, zoom: 1, easing: "elastic" }], [{ timeMs: 0, zoom: 1, unknown: 2 }], [{ timeMs: 0, zoom: 1 }, { timeMs: 0, x: .2 }], [{ timeMs: 2, zoom: 1 }, { timeMs: 1, x: .2 }]]) assert.throws(() => normalizeVideoCamera({ keyframes }));
  assert.deepEqual(normalizeVideoCamera({ zoom: 2, keyframes: [{ timeMs: 900000, x: 1, easing: "ease-out" }] }), { zoom: 2, x: .5, y: .5, keyframes: [{ timeMs: 900000, x: 1, easing: "ease-out" }] });
});

test("100 camera keyframes preserve preview/export easing parity without a linear-depth tree", () => {
  const camera = normalizeVideoCamera({ keyframes: Array.from({ length: 100 }, (_, i) => ({ timeMs: i * 100, zoom: 1 + i / 100, x: i / 100, y: 1 - i / 100, easing: "ease-in-out" })) })!;
  const filter = videoCameraFilter(camera, 1080, 1920);
  const symbolic = filter.match(/zoompan=z='([^']+)'/)![1];
  const evaluate = (time: number) => Function("on", "min", "max", "lt", "iff", `return ${symbolic.replaceAll("if(", "iff(")};`)(time / 1000 * 30, Math.min, Math.max, (a: number, b: number) => Number(a < b), (c: number, a: number, b: number) => c ? a : b);
  for (const time of [0, 55, 999, 5100, 9950]) assert.ok(Math.abs(evaluate(time) - videoCameraState(camera, time).zoom) < 1e-10);
  assert.match(filter, /d=1:s=1080x1920:fps=30$/);
});
