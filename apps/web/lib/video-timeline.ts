import type { VideoClip, VideoLayer, VideoTimeline } from "@relay/core";
import { normalizeCreativeLabels } from "./creative-labels.ts";
import { normalizeClipTransition, normalizeLayerAnimation } from "./video-animation.ts";
import { normalizeDeviceFrame } from "./device-frames.ts";
import { normalizeVideoCamera } from "./video-camera.ts";

export const videoSizes = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080] } as const;
/** Incoming transitions overlap the preceding clip. Half-duration caps keep
 * each clip's incoming and outgoing regions from overlapping each other. */
export function clipSchedule(value: VideoTimeline | VideoClip[]) {
  const clips = Array.isArray(value) ? value : value.clips;
  let endMs = 0;
  return clips.map((clip,index) => {
    const duration = clip.outMs-clip.inMs;
    const previous = clips[index-1];
    const transitionMs = previous && clip.transition ? Math.min(clip.transition.durationMs, (previous.outMs-previous.inMs)/2, duration/2) : 0;
    const startMs = endMs-transitionMs;
    endMs = startMs+duration;
    return {clip,index,startMs,endMs,transitionMs};
  });
}
export function layerSchedule(timeline: VideoTimeline) {
  return (timeline.layers ?? []).map((clip,index) => ({clip,index,startMs:clip.startMs,endMs:clip.startMs+clip.outMs-clip.inMs,transitionMs:0}));
}
export const timelineDuration = (timeline: VideoTimeline) => Math.max(clipSchedule(timeline).at(-1)?.endMs ?? 0, ...layerSchedule(timeline).map(layer => layer.endMs));
export function effectiveMusicRange(music: VideoTimeline["music"], durationMs: number): { startMs: number; endMs: number; durationMs: number } | null {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const startMs = Math.max(0, Math.min(duration, music.startMs ?? 0));
  const endMs = Math.max(0, Math.min(duration, music.endMs ?? duration));
  return endMs > startMs ? { startMs, endMs, durationMs: endMs - startMs } : null;
}
export const emptyTimeline = (): VideoTimeline => ({ version: 1, aspectRatio: "9:16", clips: [], labels: [], music: { url: "", volume: .8, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0 });
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected a timeline object."); return v as Record<string, unknown>; };
const number = (v: unknown, min: number, max: number, fallback: number): number => { const n = v === undefined ? fallback : v; if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new Error(`Expected a number between ${min} and ${max}.`); return n; };
const url = (v: unknown, optional = false) => { if (optional && (v === undefined || v === "")) return ""; if (typeof v !== "string" || v.length > 2000) throw new Error("A media URL is required."); const parsed = new URL(v); if (parsed.protocol !== "https:") throw new Error("Media URLs must use HTTPS."); return parsed.toString(); };
export function normalizeVideoTimeline(value: unknown): VideoTimeline {
  const v = object(value);
  if (v.version !== 1) throw new Error("Unsupported timeline version. Expected version 1.");
  if (typeof v.aspectRatio !== "string" || !Object.hasOwn(videoSizes,v.aspectRatio)) throw new Error("Choose 9:16, 4:5, 1:1, or 16:9.");
  if (!Array.isArray(v.clips) || v.clips.length > 50) throw new Error("Use up to 50 clips.");
  const ids = new Set<string>();
  const normalizeClip = (entry: unknown): VideoClip => {
    const c = object(entry); const id = typeof c.id === "string" && /^[\w-]{1,120}$/.test(c.id) ? c.id : crypto.randomUUID();
    if (ids.has(id)) throw new Error("Clip and layer ids must be unique."); ids.add(id);
    const inMs = number(c.inMs, 0, 3_600_000, 0); const outMs = number(c.outMs, 100, 3_600_000, 5000);
    const sourceDurationMs = c.sourceDurationMs === undefined ? undefined : number(c.sourceDurationMs,100,86_400_000,5000);
    if (c.kind === "video" && sourceDurationMs !== undefined && outMs > sourceDurationMs) throw new Error("Trim end exceeds source duration.");
    if (outMs - inMs < 100) throw new Error("Each clip must be at least 100ms long.");
    if (c.kind !== "video" && c.kind !== "image") throw new Error("Clip kind must be video or image.");
    if (c.fit !== undefined && c.fit !== "cover" && c.fit !== "contain") throw new Error("Clip fit must be cover or contain.");
    const deviceFrame = normalizeDeviceFrame(c.deviceFrame, { allowMotion: true });
    const transition = normalizeClipTransition(c.transition);
    return { id, sourceUrl: url(c.sourceUrl), name: typeof c.name === "string" ? c.name.slice(0,120) : "Clip", kind: c.kind, inMs, outMs, ...(sourceDurationMs === undefined ? {} : {sourceDurationMs}), fit: c.fit === "contain" ? "contain" : "cover", x: number(c.x,0,1,.5), y: number(c.y,0,1,.5), zoom: number(c.zoom,1,3,1), volume: number(c.volume,0,1,1), ...(deviceFrame ? { deviceFrame } : {}), ...(transition ? {transition} : {}) };
  };
  const clips = v.clips.map(normalizeClip);
  let layers: VideoLayer[] | undefined;
  if (v.layers !== undefined) {
    if (!Array.isArray(v.layers) || v.layers.length > 12) throw new Error("Use up to 12 simultaneous layers.");
    layers = v.layers.map(entry => {
      const layer = object(entry);
      if (layer.transition !== undefined) throw new Error("Layers use entrance and exit animations, not clip transitions.");
      return {...normalizeClip(layer),startMs:number(layer.startMs,0,900_000,0)};
    });
  }
  const duration = timelineDuration({ clips, layers } as VideoTimeline);
  if (duration > 900_000) throw new Error("A timeline may be at most 15 minutes.");
  if (!Array.isArray(v.labels) || v.labels.length > 200) throw new Error("Use up to 200 timed labels.");
  const labels = v.labels.map(entry => { const l = object(entry); const normalized = normalizeCreativeLabels([l]); if (!normalized?.length) throw new Error("Labels need text."); const startMs = number(l.startMs,0,900_000,0); const endMs = number(l.endMs,100,900_000,duration || 5000); if (endMs <= startMs) throw new Error("Label end must follow its start."); return { ...normalized[0], startMs, endMs, ...(l.animation === undefined ? {} : { animation: normalizeLayerAnimation(l.animation) }) }; });
  if (new Set(labels.map(l => l.id)).size !== labels.length) throw new Error("Label ids must be unique.");
  const music = v.music === undefined ? {} : object(v.music);
  const hasMusicRange = music.startMs !== undefined || music.endMs !== undefined;
  const musicStartMs = hasMusicRange ? number(music.startMs,0,900_000,0) : undefined;
  const musicEndMs = hasMusicRange ? number(music.endMs,0,900_000,duration) : undefined;
  if (musicStartMs !== undefined && musicEndMs !== undefined && musicEndMs <= musicStartMs) throw new Error("Audio end must follow its start.");
  const musicName = typeof music.name === "string" && music.name.trim() ? music.name.trim().slice(0,120) : undefined;
  let background: VideoTimeline["background"];
  if (v.background !== undefined) {
    const b = object(v.background);
    const color = (value: unknown) => { if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Background colors must be six-digit hex colors."); return value.toUpperCase(); };
    if (b.imageFit !== undefined && b.imageFit !== "cover" && b.imageFit !== "contain") throw new Error("Background image fit must be cover or contain.");
    background = { color: color(b.color), ...(b.endColor === undefined ? {} : { endColor: color(b.endColor) }), ...(b.imageUrl === undefined ? {} : {imageUrl: url(b.imageUrl)}), ...(b.imageFit === undefined ? {} : {imageFit: b.imageFit}) };
  }
  const camera = normalizeVideoCamera(v.camera);
  return { version: 1, aspectRatio: v.aspectRatio as VideoTimeline["aspectRatio"], ...(background ? { background } : {}), ...(camera ? {camera} : {}), clips, ...(layers === undefined ? {} : {layers}), labels, music: { url: url(music.url,true), ...(musicName ? { name: musicName } : {}), volume: number(music.volume,0,1,.8), offsetMs: number(music.offsetMs,0,3_600_000,0), fadeInMs: number(music.fadeInMs,0,900_000,0), fadeOutMs: number(music.fadeOutMs,0,900_000,0), ...(hasMusicRange ? { startMs: musicStartMs, endMs: musicEndMs } : {}) }, coverMs: number(v.coverMs,0,Math.max(0,duration-1),0) };
}
export function splitVideoClip(timeline: VideoTimeline, id: string, localMs: number): VideoTimeline {
  const index = timeline.clips.findIndex(c => c.id === id); const clip = timeline.clips[index];
  if (!clip || localMs < 100 || localMs > clip.outMs-clip.inMs-100) return timeline;
  const next = [...timeline.clips]; next.splice(index,1,{...clip,outMs:clip.inMs+localMs},{...clip,id:crypto.randomUUID(),inMs:clip.inMs+localMs,transition:undefined}); return {...timeline,clips:next};
}
export function subtitlesToLabels(srt: string): VideoTimeline["labels"] {
  const time = (v: string) => { const [h,m,s,ms] = v.split(/[:,.]/).map(Number); return ((h*60+m)*60+s)*1000+ms; };
  return srt.replace(/\r/g,"").trim().split(/\n\s*\n/).filter(Boolean).map(block => {
    const lines=block.split("\n"); const i=lines.findIndex(l => l.includes("-->")); const match=lines[i]?.match(/(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/);
    if (!match) throw new Error("Invalid SRT time range.");
    return { id:crypto.randomUUID(),text:lines.slice(i+1).join(" "),startMs:time(match[1]),endMs:time(match[2]),x:.5,y:.78,width:.84,height:.12,fontSize:52,font:"modern" as const,textColor:"#FFFFFF",background:"dark" as const,backgroundColor:"#000000",style:"dark" as const };
  });
}
export function labelsToSrt(labels: VideoTimeline["labels"]): string {
  const time=(ms:number)=>new Date(ms).toISOString().slice(11,23).replace(".",",");
  return [...labels].sort((a,b)=>a.startMs-b.startMs).map((l,i)=>`${i+1}\n${time(l.startMs)} --> ${time(l.endMs)}\n${l.text}\n`).join("\n");
}
