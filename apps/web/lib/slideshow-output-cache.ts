import type { SlideshowProject, VideoRenderJob } from "@relay/core";
import { imageVideoSeconds } from "@relay/core/image-video";

export interface SlideshowVideoResult { projectId: string; url?: string; coverUrl?: string; durationMs: number }
export interface SlideshowOutputCache {
  fingerprint: string;
  job: VideoRenderJob | null;
  video: SlideshowVideoResult | null;
  result: SlideshowVideoResult | null;
}

export const slideshowOutputCacheKey = (id: string) => `relay-slideshow-output-v1:${id}`;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function slideshowOutputFingerprint(project: SlideshowProject): string {
  const format = project.output?.format ?? "images";
  const count = Math.max(1, project.slides.length);
  const stored = project.output?.imageSeconds;
  const valid = Number.isInteger(stored) && stored! >= (count === 1 ? 5 : 3) && stored! <= (count === 1 ? 10 : 5);
  return JSON.stringify(canonical({
    id: project.id, name: project.name, caption: project.caption, brandId: project.brandId,
    output: { format, ...(format === "video" ? { imageSeconds: imageVideoSeconds(count, valid ? stored : undefined) } : {}) },
    slides: project.slides.map(({ renderedUrl: _renderedUrl, ...source }) => source),
  }));
}

export function parseSlideshowOutputCache(value: string | null, project: SlideshowProject): SlideshowOutputCache | null {
  if (!value) return null;
  try {
    const cache = JSON.parse(value) as SlideshowOutputCache;
    if (cache.fingerprint !== slideshowOutputFingerprint(project)) return null;
    if (cache.job && (typeof cache.job.id !== "string" || typeof cache.job.projectId !== "string" || !["queued", "running", "failed", "cancelled", "completed"].includes(cache.job.status) || !Number.isFinite(cache.job.progress))) return null;
    if (cache.job && !cache.video) return null;
    for (const video of [cache.video, cache.result]) {
      if (video && (typeof video.projectId !== "string" || !Number.isFinite(video.durationMs) || video.durationMs <= 0 || (video.url !== undefined && (typeof video.url !== "string" || !/^https?:\/\//.test(video.url))))) return null;
      if (video && cache.job && video.projectId !== cache.job.projectId) return null;
    }
    if (!cache.job && !cache.result?.url) return null;
    return { ...cache, job: cache.job ?? null, video: cache.video ?? null, result: cache.result ?? null };
  } catch { return null; }
}
