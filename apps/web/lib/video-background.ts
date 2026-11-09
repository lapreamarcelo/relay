import type { VideoTimeline } from "@relay/core";
import { deviceBackgroundSvg } from "./device-frames.ts";

/** Match the export's centered cover/contain image over its color backdrop. */
export function videoBackgroundCss(width: number, height: number, background: NonNullable<VideoTimeline["background"]>): string {
  const base = background.endColor
    ? `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(deviceBackgroundSvg(width, height, background.color, background.endColor))}") center / 100% 100% no-repeat`
    : background.color;
  return background.imageUrl
    ? `url(${JSON.stringify(background.imageUrl)}) center / ${background.imageFit ?? "cover"} no-repeat, ${base}`
    : base;
}

export function normalizeVideoBackground(value: unknown): VideoTimeline["background"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Background must be an object.");
  const b = value as Record<string, unknown>;
  const color = (value: unknown) => { if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Background colors must be six-digit hex colors."); return value.toUpperCase(); };
  if (b.imageFit !== undefined && b.imageFit !== "cover" && b.imageFit !== "contain") throw new Error("Background image fit must be cover or contain.");
  let imageUrl: string | undefined;
  if (b.imageUrl !== undefined) {
    if (typeof b.imageUrl !== "string" || b.imageUrl.length > 2000) throw new Error("A media URL is required.");
    const parsed = new URL(b.imageUrl);
    if (parsed.protocol !== "https:") throw new Error("Media URLs must use HTTPS.");
    imageUrl = parsed.toString();
  }
  return { color: color(b.color), ...(b.endColor === undefined ? {} : { endColor: color(b.endColor) }), ...(imageUrl === undefined ? {} : { imageUrl }), ...(b.imageFit === undefined ? {} : { imageFit: b.imageFit }) };
}
