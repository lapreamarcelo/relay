import type { VideoPointerEvent, VideoPointerTrack } from "@relay/core";
import { normalizePointer } from "./video-pointer.ts";

export const MAX_RECORDING_BYTES = 100 * 1024 * 1024;
export const MAX_RECORDING_MS = 300_000;
export const MAX_RECORDING_EVENTS = 2000;
export interface RecordingAsset { key: string; name: string; url: string; durationMs: number; pointer?: VideoPointerTrack }

/** Import source-relative milliseconds and normalized screen coordinates, never OS pixels. */
export function importRecordingEvents(value: unknown, durationMs?: number): VideoPointerTrack {
  const candidate = Array.isArray(value) ? { events: value } : value;
  if (candidate && typeof candidate === "object" && "events" in candidate && Array.isArray(candidate.events)) {
    for (const event of candidate.events) {
      if (!event || typeof event !== "object" || ![event.timeMs, event.x, event.y].every(value => typeof value === "number" && Number.isFinite(value))) throw new Error("Each gesture needs numeric timeMs, x, and y values.");
    }
  }
  const track = normalizePointer(candidate);
  if (!track) throw new Error("Choose a pointer events JSON file.");
  if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs <= 0 || track.events.some(event => event.timeMs > durationMs))) {
    throw new Error("Gesture timestamps must fit within the source recording.");
  }
  return track;
}

export function recordingPointerEvent(kind: VideoPointerEvent["kind"], clientX: number, clientY: number, bounds: { left: number; top: number; width: number; height: number }, elapsedMs: number): VideoPointerEvent | undefined {
  if (![clientX, clientY, bounds.left, bounds.top, bounds.width, bounds.height, elapsedMs].every(Number.isFinite) || bounds.width <= 0 || bounds.height <= 0 || elapsedMs < 0) return;
  const x = (clientX - bounds.left) / bounds.width, y = (clientY - bounds.top) / bounds.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  return { kind, x, y, timeMs: Math.round(elapsedMs) };
}

/** Drop frequent move samples first so taps survive the renderer's event limit. */
export function appendRecordingEvent(events: VideoPointerEvent[], event: VideoPointerEvent): void {
  const last = events.at(-1);
  if (event.kind === "move" && last?.kind === "move" && event.timeMs - last.timeMs < 50) return;
  if (events.length >= MAX_RECORDING_EVENTS) {
    const moveIndex = events.findIndex(sample => sample.kind === "move");
    if (moveIndex < 0) return;
    events.splice(moveIndex, 1);
  }
  events.push(event);
}

export function recordingMimeType(supported: (mime: string) => boolean): string | undefined {
  return ["video/mp4;codecs=avc1.42E01E", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find(supported);
}

/** Reuse authenticated media storage and its CORS-safe server fallback. */
export async function uploadRecording(file: File, fetcher: typeof fetch = fetch): Promise<Omit<RecordingAsset, "durationMs" | "pointer">> {
  if (!file.size || file.size > MAX_RECORDING_BYTES || !file.type.startsWith("video/")) throw new Error("Choose a video recording up to 100 MB.");
  const prepared = await fetcher("/api/v1/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type, kind: "media" }) });
  const signed = await prepared.json() as { key?: string; url?: string; uploadUrl?: string; error?: string };
  if (!prepared.ok || !signed.key || !signed.url || !signed.uploadUrl) throw new Error(signed.error || "Could not prepare the recording upload.");
  try {
    const uploaded = await fetcher(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (uploaded.ok) return { key: signed.key, url: signed.url, name: file.name };
  } catch { /* R2 CORS may block direct browser PUT; use the authenticated server. */ }
  const body = new FormData(); body.append("file", file); body.append("kind", "media");
  const response = await fetcher("/api/v1/media", { method: "POST", body });
  const result = await response.json() as { key?: string; url?: string; error?: string };
  if (!response.ok || !result.key || !result.url) throw new Error(result.error || "Could not upload the recording.");
  return { key: result.key, url: result.url, name: file.name };
}
