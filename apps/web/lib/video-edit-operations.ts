import type { VideoAudioTrack, VideoClip, VideoTimeline } from "@relay/core";
import { clipDuration, clipSchedule, clipSourceTime, timelineDuration } from "./video-timeline.ts";

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const MAX = 900_000;

/** Beat positions are deterministic, including non-integer tempos. */
export function snapToBeat(timeMs: number, grid: VideoTimeline["beatGrid"], enabled = true): number {
  if (!enabled || !grid || !Number.isFinite(timeMs)) return clamp(Number.isFinite(timeMs) ? timeMs : 0, 0, MAX);
  const beat = 60_000 / grid.bpm;
  const result = grid.offsetMs + Math.round((timeMs - grid.offsetMs) / beat) * beat;
  return clamp(result, 0, MAX);
}
export function beatTimes(grid: VideoTimeline["beatGrid"], duration: number): number[] {
  if (!grid || !Number.isFinite(grid.bpm) || grid.bpm < 20 || grid.bpm > 300) return [];
  const beat = 60_000 / grid.bpm, result: number[] = [];
  for (let i = Math.ceil(-grid.offsetMs / beat); i <= Math.floor((Math.min(MAX, duration) - grid.offsetMs) / beat); i++) result.push(grid.offsetMs + i * beat);
  return result;
}
export function audioTrackVolume(track: VideoAudioTrack, timeMs: number): number {
  if (timeMs < track.startMs || timeMs >= track.endMs) return 0;
  const local = timeMs - track.startMs, remaining = track.endMs - timeMs;
  return track.volume * Math.min(1, track.fadeInMs > 0 ? local / track.fadeInMs : 1, track.fadeOutMs > 0 ? remaining / track.fadeOutMs : 1);
}

/** Replace a timeline interval while preserving all other tracks against the same clock. */
export function retimeTimeline(timeline: VideoTimeline, startMs: number, endMs: number, newDurationMs: number): VideoTimeline {
  const oldDuration = endMs - startMs, delta = newDurationMs - oldDuration;
  const map = (time: number, rangeEnd = false) => clamp(oldDuration === 0 && time === startMs ? time + (rangeEnd ? 0 : newDurationMs) : time <= startMs ? time : time >= endMs ? time + delta : startMs + (oldDuration ? (time-startMs)/oldDuration * newDurationMs : 0), 0, MAX);
  const range = <T extends { startMs: number; endMs: number }>(entry: T, minimum = 1): T | null => {
    const start = map(entry.startMs), end = map(entry.endMs,true);
    return end-start < minimum ? null : {...entry,startMs:start,endMs:end};
  };
  const animation = <T extends { keyframes?: {timeMs:number}[] }>(value: T | undefined, origin: number): T | undefined => {
    if (!value?.keyframes) return value;
    const frames = new Map<number, T["keyframes"] extends (infer K)[] | undefined ? K : never>();
    for (const frame of value.keyframes) {
      const timeMs = map(origin+frame.timeMs)-map(origin);
      frames.set(timeMs, {...frame,timeMs} as never);
    }
    return {...value,keyframes:[...frames.values()]};
  };
  const labels = timeline.labels.flatMap(label => {
    const changed = range(label);
    return changed ? [{...changed,animation:animation(label.animation,label.startMs)}] : [];
  });
  const graphics = timeline.graphics?.flatMap(graphic => {
    const changed = range(graphic);
    return changed ? [{...changed,animation:animation(graphic.animation,graphic.startMs)}] : [];
  });
  const layers = timeline.layers?.flatMap(layer => {
    const changed = range({...layer,endMs:layer.startMs+clipDuration(layer)},100);
    if (!changed) return [];
    const {endMs, ...rest} = changed;
    const duration = endMs-changed.startMs;
    const sourceEnd = Math.min(layer.sourceDurationMs ?? 3_600_000,layer.outMs);
    const speed = clamp((sourceEnd-layer.inMs)/duration,.25,4);
    const outMs = Math.min(sourceEnd,layer.inMs+duration*speed);
    return [{...rest,speed,outMs,deviceFrame:layer.deviceFrame ? {...layer.deviceFrame,animation:animation(layer.deviceFrame.animation,layer.startMs)} : undefined}];
  });
  const audioTracks = timeline.audioTracks?.flatMap(track => {
    const changed = range(track,100);
    return changed ? [{...changed,fadeInMs:Math.min(track.fadeInMs,changed.endMs-changed.startMs),fadeOutMs:Math.min(track.fadeOutMs,changed.endMs-changed.startMs)}] : [];
  });
  const camera = timeline.camera ? {...timeline.camera,keyframes:animation(timeline.camera,0)?.keyframes} : undefined;
  const scene=timeline.scene?{...timeline.scene,camera:{...timeline.scene.camera,keyframes:animation(timeline.scene.camera,0)?.keyframes}}:undefined;
  let music = timeline.music;
  if (music.startMs !== undefined || music.endMs !== undefined) {
    const changed = range({...music,startMs:music.startMs ?? 0,endMs:music.endMs ?? timelineDuration(timeline)},100);
    music = changed ?? {...music,url:"",name:undefined,startMs:undefined,endMs:undefined};
  }
  return {...timeline,...(scene?{scene}:{}),labels,...(graphics ? {graphics} : {}),...(layers ? {layers} : {}),...(audioTracks ? {audioTracks} : {}),...(camera ? {camera} : {}),music,coverMs:map(timeline.coverMs),...(timeline.beatGrid ? {beatGrid:{...timeline.beatGrid,offsetMs:map(timeline.beatGrid.offsetMs)}} : {})};
}

/** Recalculate adjacent linked cuts after an edit, retaining the first cut's clock. */
function refreshLinks(timeline: VideoTimeline): VideoTimeline {
  const schedule = clipSchedule(timeline);
  const clips = schedule.map((row,index) => {
    const clip = row.clip, previous = schedule[index-1];
    if (!clip.groupId || !previous || previous.clip.groupId !== clip.groupId || Math.abs(previous.endMs-row.startMs) > .01) return clip;
    const offset = (schedule[index-1].clip.motionOffsetMs ?? 0)+clipDuration(previous.clip);
    const next = {...clip,motionOffsetMs:offset};
    // Keep the schedule's copied references current for runs longer than two cuts.
    row.clip = next;
    return next;
  });
  return {...timeline,clips};
}
function bounded(original: VideoTimeline, changed: VideoTimeline): VideoTimeline {
  return timelineDuration(changed) > MAX ? original : {...changed,coverMs:clamp(changed.coverMs,0,Math.max(0,timelineDuration(changed)-1))};
}
function replaceClip(timeline: VideoTimeline, id: string, patch: Partial<VideoClip>, ripple: boolean): VideoTimeline {
  const old = clipSchedule(timeline), row = old.find(row => row.clip.id === id);
  if (!row) return timeline;
  const updated = {...row.clip,...patch};
  if (updated.inMs < 0 || updated.outMs-updated.inMs < 100 || clipDuration(updated) < 100 || updated.outMs > 3_600_000 || updated.kind === "video" && updated.sourceDurationMs !== undefined && updated.outMs > updated.sourceDurationMs) return timeline;
  let result = {...timeline,clips:timeline.clips.map(clip => clip.id === id ? updated : clip)};
  const delta = (clipSchedule(result).at(-1)?.endMs ?? 0)-(old.at(-1)?.endMs ?? 0);
  if (ripple && Math.abs(delta) > .001) result = retimeTimeline(result,row.startMs,row.endMs,Math.max(0,row.endMs-row.startMs+delta));
  return bounded(timeline,refreshLinks(result));
}
export function trimVideoClip(timeline: VideoTimeline, id: string, inMs: number, outMs: number, ripple = true): VideoTimeline {
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return timeline;
  return replaceClip(timeline,id,{inMs,outMs},ripple);
}
export function setVideoClipSpeed(timeline: VideoTimeline, id: string, speed: number, ripple = true): VideoTimeline {
  if (!Number.isFinite(speed) || speed < .25 || speed > 4) return timeline;
  return replaceClip(timeline,id,{speed},ripple);
}
export function slipVideoClip(timeline: VideoTimeline, id: string, deltaMs: number): VideoTimeline {
  const clip = timeline.clips.find(clip => clip.id === id);
  if (!clip || clip.kind !== "video" || !Number.isFinite(deltaMs)) return timeline;
  const sourceEnd = clip.sourceDurationMs ?? 3_600_000;
  const delta = clamp(deltaMs,Math.max(-clip.inMs,clip.freezeMs === undefined ? -Infinity : -clip.freezeMs),Math.min(sourceEnd-clip.outMs,clip.freezeMs === undefined ? Infinity : sourceEnd-clip.freezeMs));
  return replaceClip(timeline,id,{inMs:clip.inMs+delta,outMs:clip.outMs+delta,...(clip.freezeMs === undefined ? {} : {freezeMs:clip.freezeMs+delta})},false);
}
export function freezeVideoClip(timeline: VideoTimeline, id: string, localMs?: number): VideoTimeline {
  const clip = timeline.clips.find(clip => clip.id === id);
  if (!clip || clip.kind !== "video" || localMs !== undefined && !Number.isFinite(localMs)) return timeline;
  return replaceClip(timeline,id,{freezeMs:localMs === undefined ? undefined : clipSourceTime({...clip,freezeMs:undefined},localMs)},false);
}
export function rippleDeleteVideoClip(timeline: VideoTimeline, id: string): VideoTimeline {
  const old = clipSchedule(timeline), row = old.find(row => row.clip.id === id);
  if (!row) return timeline;
  const result = {...timeline,clips:timeline.clips.filter(clip => clip.id !== id)};
  const removed = (old.at(-1)?.endMs ?? 0)-(clipSchedule(result).at(-1)?.endMs ?? 0);
  return bounded(timeline,refreshLinks(retimeTimeline(result,row.startMs,row.endMs,Math.max(0,clipDuration(row.clip)-removed))));
}
export function duplicateVideoClip(timeline: VideoTimeline, id: string): VideoTimeline {
  if (timeline.clips.length >= 50) return timeline;
  const row = clipSchedule(timeline).find(row => row.clip.id === id);
  if (!row) return timeline;
  const clips = [...timeline.clips];
  clips.splice(row.index+1,0,{...row.clip,id:crypto.randomUUID(),groupId:undefined,motionOffsetMs:undefined,transition:undefined});
  const result = {...timeline,clips};
  const delta = (clipSchedule(result).at(-1)?.endMs ?? 0)-(clipSchedule(timeline).at(-1)?.endMs ?? 0);
  return bounded(timeline,retimeTimeline(result,row.endMs,row.endMs,delta));
}
export function moveVideoClip(timeline: VideoTimeline, id: string, direction: -1 | 1): VideoTimeline {
  const index = timeline.clips.findIndex(clip => clip.id === id), target = index+direction;
  if (index < 0 || target < 0 || target >= timeline.clips.length) return timeline;
  const clips = [...timeline.clips];
  [clips[index],clips[target]] = [clips[target],clips[index]];
  return bounded(timeline,refreshLinks({...timeline,clips}));
}
export function linkVideoClips(timeline: VideoTimeline, ids: string[]): VideoTimeline {
  const selected = timeline.clips.filter(clip => ids.includes(clip.id));
  if (selected.length < 2 || selected.some((clip,i) => i > 0 && timeline.clips.indexOf(clip) !== timeline.clips.indexOf(selected[i-1])+1)) return timeline;
  const anchor = selected[0], groupId = anchor.groupId ?? crypto.randomUUID();
  let offset = 0;
  return {...timeline,clips:timeline.clips.map(clip => {
    if (!ids.includes(clip.id)) return clip;
    const next = {...clip,groupId,motionOffsetMs:offset,x:anchor.x,y:anchor.y,zoom:anchor.zoom,deviceFrame:anchor.deviceFrame,pointer:anchor.pointer};
    offset += clipDuration(clip);
    return next;
  })};
}
export function unlinkVideoClip(timeline: VideoTimeline, id: string): VideoTimeline {
  return {...timeline,clips:timeline.clips.map(clip => clip.id === id ? {...clip,groupId:undefined,motionOffsetMs:undefined} : clip)};
}

/** Editing a linked pose updates only the touching run containing the selected clip. */
export function updateVideoClipMotion(timeline: VideoTimeline, id: string, patch: Pick<Partial<VideoClip>, "x" | "y" | "zoom" | "deviceFrame" | "pointer">): VideoTimeline {
  const rows = clipSchedule(timeline), index = rows.findIndex(row => row.clip.id === id);
  if (index < 0) return timeline;
  let first = index, last = index;
  const groupId = rows[index].clip.groupId;
  if (groupId) {
    while (first > 0 && rows[first-1].clip.groupId === groupId && Math.abs(rows[first-1].endMs-rows[first].startMs) < .01) first--;
    while (last+1 < rows.length && rows[last+1].clip.groupId === groupId && Math.abs(rows[last].endMs-rows[last+1].startMs) < .01) last++;
  }
  return {...timeline,clips:timeline.clips.map((clip,i) => i >= first && i <= last ? {...clip,...patch} : clip)};
}
