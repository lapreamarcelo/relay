import type { VideoTimeline } from "@relay/core";
import sharp from "sharp";
import { deviceBackgroundSvg } from "./device-frames.ts";

/** Match the preview's centered object-fit, with the gradient showing through
 * letterboxing or transparency. Decode once, bounded independently of bytes. */
export async function canvasBackground(width: number, height: number, background: VideoTimeline["background"], image?: Buffer): Promise<Buffer> {
  const backdrop = sharp(Buffer.from(deviceBackgroundSvg(width, height, background?.color ?? "#000000", background?.endColor)));
  if (!image) return backdrop.png().toBuffer();
  try {
    const source = sharp(image, { limitInputPixels: 40_000_000 });
    const metadata = await source.metadata();
    if ((metadata.pages ?? 1) > 1 || (metadata.delay?.length ?? 0) > 1) throw new Error("Use a still image for the canvas background; animated images are not supported.");
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) throw new Error("Background image exceeds the pixel limit.");
    if (!metadata.format || !["jpeg", "png", "webp", "heif", "avif", "gif"].includes(metadata.format)) throw new Error("Choose a PNG, JPEG, WebP or AVIF background image from Media.");
    const pixels = await source
      .rotate().resize(width, height, { fit: background?.imageFit ?? "cover", position: "centre", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    return await backdrop.composite([{ input: pixels }]).png().toBuffer();
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Use a still image") || error.message.startsWith("Choose a PNG"))) throw error;
    throw new Error("Choose a valid background image from Media (up to 30 MB and 40 megapixels).");
  }
}

