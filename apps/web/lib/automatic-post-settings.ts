import type { ProviderPostSettings } from "@relay/core";

export function middleVideoFrameMs(durationMs: number | undefined): number | undefined {
  if (!Number.isFinite(durationMs) || durationMs === undefined || durationMs <= 0) return undefined;
  return Math.min(900_000, Math.round(durationMs / 2));
}

export function automaticInstagramSettings(
  publishType: "feed" | "reel" | "story",
  mediaType: "image" | "video",
  durationMs?: number,
): Extract<ProviderPostSettings, { kind: "instagram" }> {
  return {
    kind: "instagram",
    publishType,
    thumbOffsetMs: mediaType === "video" && publishType === "reel" ? middleVideoFrameMs(durationMs) : undefined,
  };
}
