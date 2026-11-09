import type { SlideshowSlide } from "@relay/core";
import sharp from "sharp";

import { creativeLabelsMarkup } from "./creative-label-markup.ts";
import { preloadLabelEmoji } from "./label-emoji.ts";
import { deviceFrameGeometry, deviceFrameSvg, deviceFrameLayerSvg } from "./device-frames.ts";
import { canvasBackground } from "./canvas-background-render.ts";

function titleOverlay(slide: SlideshowSlide): Buffer | null {
  if (!slide.text) return null;
  const style = slide.textBackground === "light" ? "light" : slide.textBackground === "none" ? "outline" : "dark";
  return Buffer.from(creativeLabelsMarkup([{ id: slide.id, text: slide.text, x: slide.textX ?? .5, y: slide.textY ?? (slide.textPosition === "top" ? .18 : slide.textPosition === "center" ? .5 : .78), width: slide.textWidth ?? .87, height: slide.textHeight ?? .12, fontSize: slide.textSize, font: slide.textFont, textColor: slide.textColor, background: slide.textBackground, backgroundColor: slide.textBackgroundColor, style }]));
}

export async function renderSlideshowImage(source: Buffer, slide: SlideshowSlide, backgroundImage?: Buffer): Promise<Buffer> {
  await preloadLabelEmoji(slide.text ?? "");
  let base: Buffer;
  if (slide.deviceFrame) {
    const geometry = deviceFrameGeometry(1080, 1920, slide.deviceFrame.device);
    let screen = await sharp(source).rotate().resize(geometry.screen.width, geometry.screen.height, { fit: slide.fit, position: "centre", background: "#11110f" }).png().toBuffer();
    if (slide.background) {
      const { width, height, radius } = geometry.screen;
      screen = await sharp(screen).composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" rx="${radius}" fill="white"/></svg>`), blend: "dest-in" }]).png().toBuffer();
    }
    const frame = await sharp(Buffer.from(slide.background ? deviceFrameLayerSvg(1080, 1920, slide.deviceFrame) : deviceFrameSvg(1080, 1920, slide.deviceFrame))).png().toBuffer();
    const canvas = slide.background ? sharp(await canvasBackground(1080, 1920, slide.background, backgroundImage)) : sharp({ create: { width: 1080, height: 1920, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
    base = await canvas.composite([
      { input: screen, top: geometry.screen.y, left: geometry.screen.x },
      { input: frame, top: 0, left: 0 },
    ]).png().toBuffer();
  } else if (slide.background) {
    const image = await sharp(source).rotate().resize(1080, 1920, { fit: slide.fit, position: "centre", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    base = await sharp(await canvasBackground(1080, 1920, slide.background, backgroundImage)).composite([{ input: image }]).png().toBuffer();
  } else {
    base = await sharp(source).rotate().resize(1080, 1920, { fit: slide.fit, position: "centre", background: "#11110f" }).png().toBuffer();
  }
  const overlay = titleOverlay(slide);
  const pipeline = sharp(base);
  if (overlay) pipeline.composite([{ input: overlay, top: 0, left: 0 }]);
  return pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
}
