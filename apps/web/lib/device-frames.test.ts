import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { deviceFrameGeometry, deviceFrameSvg, normalizeDeviceFrame } from "./device-frames.ts";

test("normalizes supported device frames and rejects incomplete settings", () => {
  assert.deepEqual(normalizeDeviceFrame({ device: "phone", background: "#aabbcc", color: "#123456" }), { device: "phone", background: "#AABBCC", color: "#123456" });
  assert.equal(normalizeDeviceFrame(undefined), undefined);
  assert.throws(() => normalizeDeviceFrame({ device: "television", background: "#AABBCC", color: "#123456" }));
  assert.throws(() => normalizeDeviceFrame({ device: "tablet", background: "red", color: "#123456" }));
  assert.throws(() => normalizeDeviceFrame({ device: "browser", background: "#AABBCC" }));
});

test("validates motion bounds, restricts folding to Duo, and rejects motion for stills", () => {
  const frame = { device: "iphone-duo", background: "#aabbcc", color: "#123456", backgroundEnd: "#ffffff", x: .1, y: .8, scale: 1.5, rotateX: -60, rotateY: 60, rotateZ: 180, foldAngle: 165, motion: "fold-cycle", motionDurationMs: 500 };
  assert.deepEqual(normalizeDeviceFrame(frame, { allowMotion: true }), { ...frame, background: "#AABBCC", backgroundEnd: "#FFFFFF" });
  assert.throws(() => normalizeDeviceFrame(frame), /video timelines/);
  for (const invalid of [{ x: 1.01 }, { scale: .24 }, { rotateX: 61 }, { rotateY: NaN }, { foldAngle: 166 }, { motionDurationMs: 499 }, { motion: "spin" }, { backgroundEnd: "transparent" }]) {
    assert.throws(() => normalizeDeviceFrame({ ...frame, ...invalid }, { allowMotion: true }));
  }
  assert.throws(() => normalizeDeviceFrame({ ...frame, device: "iphone" }, { allowMotion: true }), /Duo/);
  for (const device of ["iphone", "iphone-duo", "mac", "watch", "android"]) assert.equal(normalizeDeviceFrame({ device, background: "#AABBCC", color: "#123456" })?.device, device);
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

test("video frame animation persists while stills reject animated settings", () => {
  const frame = {device:"iphone-duo",color:"#171717",background:"#FFFFFF",motionEasing:"ease-in-out",animation:{entrance:{preset:"zoom",durationMs:500},keyframes:[{timeMs:0,x:.2,foldAngle:30},{timeMs:1500,x:.8,foldAngle:150}]}};
  assert.equal(normalizeDeviceFrame(frame,{allowMotion:true})?.animation?.keyframes?.[1].foldAngle,150);
  assert.throws(()=>normalizeDeviceFrame(frame),/video/);
  assert.throws(()=>normalizeDeviceFrame({...frame,device:"iphone"},{allowMotion:true}),/Duo/);
});
