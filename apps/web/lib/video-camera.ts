import type { VideoCamera, VideoCameraKeyframe } from "@relay/core";
import { animationExpressions, normalizeAnimationEasing } from "./video-animation.ts";

export const defaultVideoCamera: VideoCamera = { zoom: 1, x: .5, y: .5 };
export const videoCameraPresets = ["zoom-in", "zoom-out", "focus-return"] as const;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Camera settings must be an object.");
  return value as Record<string, unknown>;
}
function allowed(input: Record<string, unknown>, keys: string[]) {
  for (const key of Object.keys(input)) if (!keys.includes(key)) throw new Error(`Unknown camera property: ${key}.`);
}
function number(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`Camera value must be between ${min} and ${max}.`);
  return value;
}

/** Reject typos and unsupported camera properties rather than silently dropping them. */
export function normalizeVideoCamera(value: unknown): VideoCamera | undefined {
  if (value === undefined) return undefined;
  const input = object(value);
  allowed(input, ["zoom", "x", "y", "keyframes"]);
  const camera: VideoCamera = {
    zoom: input.zoom === undefined ? 1 : number(input.zoom, 1, 4),
    x: input.x === undefined ? .5 : number(input.x, 0, 1),
    y: input.y === undefined ? .5 : number(input.y, 0, 1),
  };
  if (input.keyframes !== undefined) {
    if (!Array.isArray(input.keyframes) || input.keyframes.length > 100) throw new Error("Use up to 100 camera keyframes.");
    let previous = -1;
    camera.keyframes = input.keyframes.map(value => {
      const frame = object(value);
      allowed(frame, ["timeMs", "zoom", "x", "y", "easing"]);
      const timeMs = number(frame.timeMs, 0, 900000);
      if (timeMs <= previous) throw new Error("Camera keyframe times must be unique and increasing.");
      previous = timeMs;
      const result: VideoCameraKeyframe = { timeMs };
      if (frame.easing !== undefined) result.easing = normalizeAnimationEasing(frame.easing);
      for (const key of ["zoom", "x", "y"] as const) {
        if (frame[key] !== undefined) result[key] = number(frame[key], key === "zoom" ? 1 : 0, key === "zoom" ? 4 : 1);
      }
      if (!["zoom", "x", "y"].some(key => frame[key] !== undefined)) throw new Error("Each camera keyframe needs an animated property.");
      return result;
    });
  }
  return camera;
}

function expressions(camera: VideoCamera | undefined, timeMs: number | string) {
  const base = camera ?? defaultVideoCamera;
  // Camera tracks use the same independent sparse interpolation and departing
  // easing as device and label tracks. Scale is the shared algebra's zoom field.
  const state = animationExpressions({ keyframes: base.keyframes?.map(({ zoom, ...frame }) => ({ ...frame, ...(zoom === undefined ? {} : { scale: zoom }) })) }, timeMs, 1, { scale: base.zoom, x: base.x, y: base.y });
  return { zoom: state.scale, x: state.x, y: state.y };
}

export function videoCameraState(camera: VideoCamera | undefined, timeMs: number): { zoom: number; x: number; y: number } {
  return expressions(camera, Math.max(0, timeMs)) as { zoom: number; x: number; y: number };
}

/** Bound the viewport, keeping the scene filled even when focus reaches an edge. */
export function videoCameraViewport(camera: VideoCamera | undefined, timeMs: number) {
  const { zoom, x, y } = videoCameraState(camera, timeMs);
  const half = .5 / zoom;
  return { zoom, centerX: Math.min(1 - half, Math.max(half, x)), centerY: Math.min(1 - half, Math.max(half, y)) };
}

/** Apply to a full-canvas wrapper with transform-origin: center. Labels stay outside. */
export function videoCameraTransform(camera: VideoCamera | undefined, timeMs: number): string {
  const { zoom, centerX, centerY } = videoCameraViewport(camera, timeMs);
  return `translate(${(.5 - centerX) * zoom * 100}%, ${(.5 - centerY) * zoom * 100}%) scale(${zoom})`;
}

/** One output frame per input frame; camera time is the global 30fps scene clock. */
export function videoCameraFilter(camera: VideoCamera, width: number, height: number): string {
  const state = expressions(camera, "on/30*1000");
  return `fps=30,setpts=PTS-STARTPTS,zoompan=z='${state.zoom}':x='max(0,min(iw-iw/zoom,iw*(${state.x})-iw/(2*zoom)))':y='max(0,min(ih-ih/zoom,ih*(${state.y})-ih/(2*zoom)))':d=1:s=${width}x${height}:fps=30`;
}

export function videoCameraPreset(preset: typeof videoCameraPresets[number], durationMs: number, focus: { zoom: number; x: number; y: number }): VideoCamera {
  if (!videoCameraPresets.includes(preset)) throw new Error("Choose a supported camera preset.");
  number(durationMs, 1, 900000);
  const target = normalizeVideoCamera(focus)!;
  const full = { zoom: 1, x: .5, y: .5 };
  const point = (timeMs: number, state: typeof full): VideoCameraKeyframe => ({ timeMs, ...state, easing: "ease-in-out" });
  if (preset === "zoom-out") return { ...target, keyframes: [point(0, target), point(durationMs, full)] };
  if (preset === "zoom-in") return { ...full, keyframes: [point(0, full), point(durationMs, target)] };
  return { ...full, keyframes: [point(0, full), point(durationMs / 4, target), point(durationMs * .75, target), point(durationMs, full)] };
}
