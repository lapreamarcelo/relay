import "server-only";

import type { VideoTimeline } from "@relay/core";
import { getR2Config } from "./r2";
import { objectKeyFromPublicUrl } from "./video-download.ts";
import { normalizeVideoTimeline } from "./video-timeline.ts";

/** The client normalizer remains environment-independent. Production writes
 * reject third-party canvas images before saved projects can load them. */
export function assertVideoBackgroundLibraryUrl(timeline: VideoTimeline): void {
  const imageUrl = timeline.background?.imageUrl;
  if (!imageUrl) return;
  if (new URL(imageUrl).protocol !== "https:" || !objectKeyFromPublicUrl(imageUrl, getR2Config().publicUrl)) {
    throw new Error("Background images must come from this Relay R2 library. Choose an image from Media.");
  }
}

export function normalizeLibraryVideoTimeline(value: unknown): VideoTimeline {
  const timeline = normalizeVideoTimeline(value);
  assertVideoBackgroundLibraryUrl(timeline);
  return timeline;
}
