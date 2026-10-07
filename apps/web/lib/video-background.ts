import type { VideoTimeline } from "@relay/core";
import { deviceBackgroundSvg } from "./device-frames";

/** Match the export's centered cover/contain image over its color backdrop. */
export function videoBackgroundCss(width: number, height: number, background: NonNullable<VideoTimeline["background"]>): string {
  const base = background.endColor
    ? `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(deviceBackgroundSvg(width, height, background.color, background.endColor))}") center / 100% 100% no-repeat`
    : background.color;
  return background.imageUrl
    ? `url(${JSON.stringify(background.imageUrl)}) center / ${background.imageFit ?? "cover"} no-repeat, ${base}`
    : base;
}
