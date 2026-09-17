import type { VideoClip, VideoTimeline } from "@relay/core";
import { normalizeCreativeLabels } from "./creative-labels.ts";

export const videoSizes = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080] } as const;
export const timelineDuration = (timeline: VideoTimeline) => timeline.clips.reduce((sum, clip) => sum + clip.outMs - clip.inMs, 0);
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
  const clips: VideoClip[] = v.clips.map((entry) => {
    const c = object(entry); const id = typeof c.id === "string" && /^[\w-]{1,120}$/.test(c.id) ? c.id : crypto.randomUUID();
    if (ids.has(id)) throw new Error("Clip ids must be unique."); ids.add(id);
    const inMs = number(c.inMs, 0, 3_600_000, 0); const outMs = number(c.outMs, 100, 3_600_000, 5000);
    const sourceDurationMs = c.sourceDurationMs === undefined ? undefined : number(c.sourceDurationMs,100,86_400_000,5000);
    if (c.kind === "video" && sourceDurationMs !== undefined && outMs > sourceDurationMs) throw new Error("Trim end exceeds source duration.");
    if (outMs - inMs < 100) throw new Error("Each clip must be at least 100ms long.");
    if (c.kind !== "video" && c.kind !== "image") throw new Error("Clip kind must be video or image.");
    if (c.fit !== undefined && c.fit !== "cover" && c.fit !== "contain") throw new Error("Clip fit must be cover or contain.");
    return { id, sourceUrl: url(c.sourceUrl), name: typeof c.name === "string" ? c.name.slice(0,120) : "Clip", kind: c.kind, inMs, outMs, ...(sourceDurationMs === undefined ? {} : {sourceDurationMs}), fit: c.fit === "contain" ? "contain" : "cover", x: number(c.x,0,1,.5), y: number(c.y,0,1,.5), zoom: number(c.zoom,1,3,1), volume: number(c.volume,0,1,1) };
  });
  const duration = clips.reduce((sum, c) => sum + c.outMs-c.inMs,0);
  if (duration > 900_000) throw new Error("A timeline may be at most 15 minutes.");
  if (!Array.isArray(v.labels) || v.labels.length > 200) throw new Error("Use up to 200 timed labels.");
  const labels = v.labels.map(entry => { const l = object(entry); const normalized = normalizeCreativeLabels([l]); if (!normalized?.length) throw new Error("Labels need text."); const startMs = number(l.startMs,0,900_000,0); const endMs = number(l.endMs,100,900_000,duration || 5000); if (endMs <= startMs) throw new Error("Label end must follow its start."); return { ...normalized[0], startMs, endMs }; });
  if (new Set(labels.map(l => l.id)).size !== labels.length) throw new Error("Label ids must be unique.");
  const music = v.music === undefined ? {} : object(v.music);
  return { version: 1, aspectRatio: v.aspectRatio as VideoTimeline["aspectRatio"], clips, labels, music: { url: url(music.url,true), volume: number(music.volume,0,1,.8), offsetMs: number(music.offsetMs,0,3_600_000,0), fadeInMs: number(music.fadeInMs,0,900_000,0), fadeOutMs: number(music.fadeOutMs,0,900_000,0) }, coverMs: number(v.coverMs,0,Math.max(0,duration-1),0) };
}
export function splitVideoClip(timeline: VideoTimeline, id: string, localMs: number): VideoTimeline {
  const index = timeline.clips.findIndex(c => c.id === id); const clip = timeline.clips[index];
  if (!clip || localMs < 100 || localMs > clip.outMs-clip.inMs-100) return timeline;
  const next = [...timeline.clips]; next.splice(index,1,{...clip,outMs:clip.inMs+localMs},{...clip,id:crypto.randomUUID(),inMs:clip.inMs+localMs}); return {...timeline,clips:next};
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
