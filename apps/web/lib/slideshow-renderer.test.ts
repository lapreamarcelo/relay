import assert from "node:assert/strict";
import test from "node:test";
import type { SlideshowSlide } from "@relay/core";
import sharp from "sharp";

import { deviceFrameGeometry } from "./device-frames.ts";
import { renderSlideshowImage } from "./slideshow-renderer.ts";

test("renders a framed slide and preserves its title overlay", async () => {
  const source = await sharp({ create: { width: 240, height: 320, channels: 3, background: "#E02020" } }).png().toBuffer();
  const slide: SlideshowSlide = {
    id: "framed",
    mediaUrl: "https://media.example/source.png",
    fit: "cover",
    textPosition: "top",
    textX: .5,
    textY: .2,
    textWidth: .7,
    textHeight: .1,
    textSize: 64,
    textFont: "modern",
    textColor: "#FFFFFF",
    textBackground: "dark",
    textBackgroundColor: "#000000",
    deviceFrame: { device: "phone", background: "#123456", color: "#202020" },
  };
  const withoutTitle = await renderSlideshowImage(source, slide);
  const withTitle = await renderSlideshowImage(source, { ...slide, text: "Product demo" });
  const metadata = await sharp(withTitle).metadata();
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);

  const geometry = deviceFrameGeometry(1080, 1920, "phone");
  const { data, info } = await sharp(withTitle).raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
  const close = (actual: number[], expected: number[]) => actual.every((channel, index) => Math.abs(channel - expected[index]) < 12);
  assert.ok(close(pixel(4, 4), [0x12, 0x34, 0x56]), "background color should remain after adding a title");
  assert.ok(close(pixel(Math.round(geometry.screen.x + geometry.screen.width / 2), Math.round(geometry.screen.y + geometry.screen.height * .7)), [0xE0, 0x20, 0x20]), "source image should remain visible inside the screen");

  const plain = await sharp(withoutTitle).raw().toBuffer();
  let changed = 0;
  for (let index = 0; index < data.length; index += 3) if (Math.abs(data[index] - plain[index]) + Math.abs(data[index + 1] - plain[index + 1]) + Math.abs(data[index + 2] - plain[index + 2]) > 30) changed++;
  assert.ok(changed > 1_000, "title pixels should be composited over the framed slide");
});
