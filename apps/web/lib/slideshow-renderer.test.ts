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

test("slideshow JPEG exports preserve color emoji sequences alongside title text", async () => {
  const source = await sharp({ create: { width: 108, height: 192, channels: 3, background: "#000000" } }).png().toBuffer();
  const rendered = await renderSlideshowImage(source, { id: "emoji", mediaUrl: "https://media.example/source.png", fit: "cover", text: "Launch 🚀 👍🏽 👨‍👩‍👧‍👦 🇪🇸 ❤️", textPosition: "center", textSize: 100, textFont: "modern", textColor: "#FFFFFF", textBackground: "dark", textBackgroundColor: "#000000" });
  const { data, info } = await sharp(rendered).raw().toBuffer({ resolveWithObject: true });
  let colored = 0;
  for (let i = 0; i < data.length; i += info.channels) if (Math.max(...data.subarray(i, i + 3)) - Math.min(...data.subarray(i, i + 3)) > 70) colored++;
  assert.ok(colored > 10_000, "exported title includes colored emoji artwork on its monochrome slide");
});

test("image backgrounds render behind every still device with centered cover and contain", async () => {
  const source = await sharp({ create: { width: 80, height: 160, channels: 3, background: "#FFFF00" } }).png().toBuffer();
  const backdrop = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#00FF00" } }).png().toBuffer();
  for (const device of ["phone", "tablet", "browser"] as const) for (const imageFit of ["cover", "contain"] as const) {
    const slide: SlideshowSlide = { id: "background", mediaUrl: "https://media.example/screen.png", fit: "cover", textPosition: "bottom", textSize: 64, textFont: "modern", textColor: "#FFFFFF", textBackground: "none", deviceFrame: { device, background: "#000000", color: "#171717" }, background: { color: "#FF00FF", imageUrl: "https://media.example/background.png", imageFit } };
    const output = await renderSlideshowImage(source, slide, backdrop);
    const { data, info } = await sharp(output).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
    const near = (actual: number[], expected: number[]) => assert.ok(actual.every((value, i) => Math.abs(value - expected[i]) < 12), `${device}/${imageFit}: ${actual} expected ${expected}`);
    near(pixel(5, 5), imageFit === "cover" ? [0, 255, 0] : [255, 0, 255]);
    near(pixel(5, 960), [0, 255, 0]);
    near(pixel(540, 960), [255, 255, 0]);
    const { screen } = deviceFrameGeometry(1080, 1920, device);
    if (device !== "browser") assert.ok(pixel(screen.x, screen.y)[0] < 80 || pixel(screen.x, screen.y)[1] < 80, "screen corners do not leak yellow source pixels");
  }
});

test("unframed contain images reveal the canvas background", async () => {
  const source = await sharp({ create: { width: 300, height: 100, channels: 3, background: "#FFFF00" } }).png().toBuffer();
  const slide: SlideshowSlide = { id: "plain", mediaUrl: "https://media.example/screen.png", fit: "contain", textPosition: "bottom", textSize: 64, textFont: "modern", textColor: "#FFFFFF", textBackground: "none", background: { color: "#00FF00" } };
  const { data, info } = await sharp(await renderSlideshowImage(source, slide)).raw().toBuffer({ resolveWithObject: true });
  assert.ok(data[1] > 240 && data[0] < 12, "letterboxing shows the chosen canvas color");
  const center = (960 * info.width + 540) * info.channels;
  assert.ok(data[center] > 240 && data[center + 1] > 240, "source image stays visible");
});
