import type { VideoClip, VideoLayer, VideoTimeline } from "@relay/core";
import { normalizeCreativeLabels } from "./creative-labels.ts";
import { normalizeClipTransition, normalizeLayerAnimation } from "./video-animation.ts";
import { normalizeDeviceFrame } from "./device-frames.ts";
import { normalizeVideoCamera } from "./video-camera.ts";

import {normalizePointer} from './video-pointer.ts';
import {normalizeAudioAnalysisTracks} from './video-audio-analysis.ts';
import {normalizeGraphics} from './video-graphics.ts';
import {normalizeExportSettings} from './video-export-settings.ts';
import {normalizeVideoScene} from './video-scene.ts';
export const videoSizes = { "9:16": [1080, 1920], "4:5": [1080, 1350], "1:1": [1080, 1080], "16:9": [1920, 1080] } as const;
/** Incoming transitions overlap the preceding clip. Half-duration caps keep
 * each clip's incoming and outgoing regions from overlapping each other. */
export function clipSchedule(value: VideoTimeline | VideoClip[]) {
  const clips = Array.isArray(value) ? value : value.clips;
  let endMs = 0;
  return clips.map((clip,index) => {
    const duration = clipDuration(clip);
    const previous = clips[index-1];
    const transitionMs = previous && clip.transition ? Math.min(clip.transition.durationMs, clipDuration(previous)/2, duration/2) : 0;
    const startMs = endMs-transitionMs;
    endMs = startMs+duration;
    return {clip,index,startMs,endMs,transitionMs};
  });
}
export function layerSchedule(timeline: VideoTimeline) {
  return (timeline.layers ?? []).map((clip,index) => ({clip,index,startMs:clip.startMs,endMs:clip.startMs+clipDuration(clip),transitionMs:0}));
}
/** Authored duration uses playback speed; a frozen source still occupies its full range. */
export const clipDuration = (clip: VideoClip) => (clip.outMs - clip.inMs) / (clip.speed ?? 1);
export function clipSourceTime(clip: VideoClip, localMs: number): number {
  return clip.freezeMs ?? Math.max(clip.inMs, Math.min(clip.outMs, clip.inMs + Math.max(0, localMs) * (clip.speed ?? 1)));
}
export const clipMotionTime = (clip: VideoClip, localMs: number) => Math.max(0, localMs) + (clip.motionOffsetMs ?? 0);
/** Only touching cuts share a motion span. Gaps and transitions begin a new span. */
export function clipMotionDuration(timeline: VideoTimeline, clip: VideoClip): number {
  if (!clip.groupId) return clipDuration(clip);
  const schedule = clipSchedule(timeline);
  const index = schedule.findIndex(row => row.clip.id === clip.id);
  if (index < 0) return clipDuration(clip) + (clip.motionOffsetMs ?? 0);
  let first = index, last = index;
  while (first > 0 && schedule[first - 1].clip.groupId === clip.groupId && Math.abs(schedule[first - 1].endMs - schedule[first].startMs) < .01) first--;
  while (last + 1 < schedule.length && schedule[last + 1].clip.groupId === clip.groupId && Math.abs(schedule[last].endMs - schedule[last + 1].startMs) < .01) last++;
  return Math.max(...schedule.slice(first, last + 1).map(row => (row.clip.motionOffsetMs ?? 0) + clipDuration(row.clip)));
}
export const timelineDuration = (timeline: VideoTimeline) => Math.max(0, clipSchedule(timeline).at(-1)?.endMs ?? 0, ...layerSchedule(timeline).map(layer => layer.endMs), ...(timeline.labels ?? []).map(label => label.endMs), ...(timeline.graphics ?? []).map(graphic => graphic.endMs), ...(timeline.audioTracks ?? []).map(audio => audio.endMs));
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
    const speed = c.speed === undefined ? undefined : number(c.speed,.25,4,1);
    if ((outMs-inMs)/(speed ?? 1) < 100) throw new Error("Each clip must play for at least 100ms.");
    const freezeMs = c.freezeMs === undefined ? undefined : number(c.freezeMs,0,sourceDurationMs ?? 3_600_000,0);
    const groupId = c.groupId === undefined ? undefined : c.groupId;
    if (groupId !== undefined && (typeof groupId !== "string" || !/^[\w-]{1,120}$/.test(groupId))) throw new Error("Use a valid linked clip id.");
    const motionOffsetMs = c.motionOffsetMs === undefined ? undefined : number(c.motionOffsetMs,0,900_000,0);
    const pointer=normalizePointer(c.pointer);
    return { id, ...(pointer?{pointer}:{}), ...(speed === undefined ? {} : {speed}), ...(freezeMs === undefined ? {} : {freezeMs}), ...(groupId === undefined ? {} : {groupId: groupId as string}), ...(motionOffsetMs === undefined ? {} : {motionOffsetMs}), sourceUrl: url(c.sourceUrl), name: typeof c.name === "string" ? c.name.slice(0,120) : "Clip", kind: c.kind, inMs, outMs, ...(sourceDurationMs === undefined ? {} : {sourceDurationMs}), fit: c.fit === "contain" ? "contain" : "cover", x: number(c.x,0,1,.5), y: number(c.y,0,1,.5), zoom: number(c.zoom,1,3,1), volume: number(c.volume,0,1,1), ...(deviceFrame ? { deviceFrame } : {}), ...(transition ? {transition} : {}) };
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
  let duration = timelineDuration({ clips, layers } as VideoTimeline);
  if (duration > 900_000) throw new Error("A timeline may be at most 15 minutes.");
  if (!Array.isArray(v.labels) || v.labels.length > 200) throw new Error("Use up to 200 timed labels.");
  const labels = v.labels.map(entry => { const l = object(entry); const normalized = normalizeCreativeLabels([l]); if (!normalized?.length) throw new Error("Labels need text."); const startMs = number(l.startMs,0,900_000,0); const endMs = number(l.endMs,100,900_000,duration || 5000); if (endMs <= startMs) throw new Error("Label end must follow its start."); return { ...normalized[0], startMs, endMs, ...(l.animation === undefined ? {} : { animation: normalizeLayerAnimation(l.animation,"label",false,normalized[0].sceneLayer === "scene") }) }; });
  if (new Set(labels.map(l => l.id)).size !== labels.length) throw new Error("Label ids must be unique.");
  let audioTracks: VideoTimeline["audioTracks"];
  if (v.audioTracks !== undefined) {
    if (!Array.isArray(v.audioTracks) || v.audioTracks.length > 12) throw new Error("Use up to 12 sound tracks.");
    audioTracks = v.audioTracks.map(entry => {
      const a = object(entry);
      if (typeof a.id !== "string" || !/^[\w-]{1,120}$/.test(a.id) || ids.has(a.id)) throw new Error("Sound track ids must be valid and unique.");
      ids.add(a.id);
      const startMs = number(a.startMs,0,900_000,0), endMs = number(a.endMs,100,900_000,duration || 5000);
      if (endMs-startMs < 100) throw new Error("Sound tracks must last at least 100ms.");
      return {id:a.id,url:url(a.url),name:typeof a.name === "string" ? a.name.trim().slice(0,120) : "Sound",startMs,endMs,offsetMs:number(a.offsetMs,0,3_600_000,0),volume:number(a.volume,0,1,1),fadeInMs:number(a.fadeInMs,0,endMs-startMs,0),fadeOutMs:number(a.fadeOutMs,0,endMs-startMs,0)};
    });
  }
  let beatGrid: VideoTimeline["beatGrid"];
  if (v.beatGrid !== undefined) { const b = object(v.beatGrid); beatGrid = {bpm:number(b.bpm,20,300,120),offsetMs:number(b.offsetMs,0,900_000,0)}; }
  const audioAnalysis=normalizeAudioAnalysisTracks(v.audioAnalysis)?.map(track=>({...track,sourceUrl:url(track.sourceUrl)}));
  const graphics=normalizeGraphics(v.graphics)?.map(graphic=>({...graphic,...(graphic.audioReactive?{audioReactive:{...graphic.audioReactive,sourceUrl:url(graphic.audioReactive.sourceUrl)}}:{})}));
  const analyzedSources=new Set(audioAnalysis?.map(track=>track.sourceUrl));
  if(graphics?.some(graphic=>graphic.audioReactive&&!analyzedSources.has(graphic.audioReactive.sourceUrl)))throw new Error('Audio-reactive graphics require analyzed audio.');
  const scene=normalizeVideoScene(v.scene);
  const exportSettings=normalizeExportSettings(v.exportSettings);
  duration = timelineDuration({clips,layers,labels,audioTracks,graphics} as VideoTimeline);
  if (duration > 900_000) throw new Error("A timeline may be at most 15 minutes.");
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
  return { version: 1, aspectRatio: v.aspectRatio as VideoTimeline["aspectRatio"], ...(background ? { background } : {}), ...(camera ? {camera} : {}), clips, ...(graphics?{graphics}:{}), ...(audioAnalysis===undefined?{}:{audioAnalysis}), ...(scene?{scene}:{}), ...(exportSettings?{exportSettings}:{}), ...(audioTracks === undefined ? {} : {audioTracks}), ...(beatGrid ? {beatGrid} : {}), ...(layers === undefined ? {} : {layers}), labels, music: { url: url(music.url,true), ...(musicName ? { name: musicName } : {}), volume: number(music.volume,0,1,.8), offsetMs: number(music.offsetMs,0,3_600_000,0), fadeInMs: number(music.fadeInMs,0,900_000,0), fadeOutMs: number(music.fadeOutMs,0,900_000,0), ...(hasMusicRange ? { startMs: musicStartMs, endMs: musicEndMs } : {}) }, coverMs: number(v.coverMs,0,Math.max(0,duration-1),0) };
}
export function splitVideoClip(timeline: VideoTimeline, id: string, localMs: number): VideoTimeline {
  const index = timeline.clips.findIndex(c => c.id === id); const clip = timeline.clips[index];
  const speed = clip?.speed ?? 1;
  if (!clip || timeline.clips.length >= 50 || !Number.isFinite(localMs) || localMs < Math.max(100,100/speed) || clipDuration(clip)-localMs < Math.max(100,100/speed)) return timeline;
  const schedule = clipSchedule(timeline);
  // A cut cannot shorten either overlap below its original half-duration cap.
  if (localMs < schedule[index].transitionMs*2 || clipDuration(clip)-localMs < (schedule[index+1]?.transitionMs ?? 0)*2) return timeline;
  const groupId = clip.groupId ?? crypto.randomUUID();
  const sourceMs = clip.inMs + localMs * speed;
  const next = [...timeline.clips]; next.splice(index,1,{...clip,outMs:sourceMs,groupId,motionOffsetMs:clip.motionOffsetMs ?? 0},{...clip,id:crypto.randomUUID(),inMs:sourceMs,groupId,motionOffsetMs:(clip.motionOffsetMs ?? 0)+localMs,transition:undefined}); return {...timeline,clips:next};
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
