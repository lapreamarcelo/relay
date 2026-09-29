import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { deviceFrameGeometry, deviceFrameSvg, normalizeDeviceFrame } from "./device-frames.ts";

test("normalizes supported device frames and rejects incomplete settings", () => {
  assert.deepEqual(normalizeDeviceFrame({ device: "phone", background: "#aabbcc", color: "#123456" }), { device: "phone", background: "#AABBCC", color: "#123456" });
  assert.equal(normalizeDeviceFrame(undefined), undefined);
  assert.throws(() => normalizeDeviceFrame({ device: "watch", background: "#AABBCC", color: "#123456" }));
  assert.throws(() => normalizeDeviceFrame({ device: "tablet", background: "red", color: "#123456" }));
  assert.throws(() => normalizeDeviceFrame({ device: "browser", background: "#AABBCC" }));
});

test("preserves device proportions across portrait, square, and landscape canvases", () => {
  for (const [width, height] of [[1080, 1920], [1080, 1080], [1920, 1080]]) {
    const phone = deviceFrameGeometry(width, height, "phone");
    const tablet = deviceFrameGeometry(width, height, "tablet");
    const browser = deviceFrameGeometry(width, height, "browser");
    assert.ok(Math.abs(phone.outer.width / phone.outer.height - 9 / 19.5) < .002);
    assert.ok(Math.abs(tablet.outer.width / tablet.outer.height - 3 / 4) < .002);
    assert.ok(Math.abs(browser.outer.width / browser.outer.height - 16 / 10) < .004);
    for (const geometry of [phone, tablet, browser]) {
      assert.ok(geometry.screen.x >= geometry.outer.x && geometry.screen.y >= geometry.outer.y);
      assert.ok(geometry.screen.x + geometry.screen.width <= geometry.outer.x + geometry.outer.width);
      assert.ok(geometry.screen.y + geometry.screen.height <= geometry.outer.y + geometry.outer.height);
    }
  }
});

test("renders an opaque background and a transparent rounded screen opening", async () => {
  const width = 360, height = 640;
  const geometry = deviceFrameGeometry(width, height, "phone");
  const { data, info } = await sharp(Buffer.from(deviceFrameSvg(width, height, { device: "phone", background: "#123456", color: "#ABCDEF" }))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
  assert.deepEqual(pixel(0, 0), [0x12, 0x34, 0x56, 255]);
  assert.deepEqual(pixel(Math.round(geometry.screen.x + geometry.screen.width / 2), Math.round(geometry.screen.y + geometry.screen.height / 2)), [0, 0, 0, 0]);
  assert.deepEqual(pixel(geometry.outer.x + 1, Math.round(geometry.outer.y + geometry.outer.height / 2)), [0xAB, 0xCD, 0xEF, 255]);
});
