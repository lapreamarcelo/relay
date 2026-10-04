import type { VideoClip, VideoLayer } from "@relay/core";
import { clipSchedule } from "./video-timeline.ts";

/** Match the source-audio mix on the rendered timeline clock; music is excluded. */
export function captionAudioJoinFilter(clips: VideoClip[], layers: VideoLayer[] = [], durationMs?: number): string {
 if(!clips.length && !layers.length) throw new Error("Add clips or device layers before generating captions.");
 const schedule=clipSchedule(clips);
 const duration=durationMs ?? Math.max(schedule.at(-1)?.endMs ?? 0,...layers.map(layer=>layer.startMs+layer.outMs-layer.inMs));
 const filters=clips.map((clip,i)=>`[${i}:a]aresample=16000,volume=${clip.volume},apad,atrim=duration=${(clip.outMs-clip.inMs)/1000},asetpts=PTS-STARTPTS[a${i}]`);
 let previous="a0";
 for(let i=1;i<clips.length;i++) {
  const output=`joined${i}`;
  filters.push(schedule[i].transitionMs>0
   ? `[${previous}][a${i}]acrossfade=d=${schedule[i].transitionMs/1000}:c1=tri:c2=tri[${output}]`
   : `[${previous}][a${i}]concat=n=2:v=0:a=1[${output}]`);
  previous=output;
 }
 if (!layers.length) { filters.push(`[${previous}]anull[speech]`); return filters.join(";"); }
 if (clips.length) filters.push(`[${previous}]apad,atrim=duration=${duration/1000},asetpts=PTS-STARTPTS[base]`);
 else filters.push(`anullsrc=r=16000:cl=mono,atrim=duration=${duration/1000},asetpts=PTS-STARTPTS[base]`);
 layers.forEach((layer,index)=>filters.push(`[${clips.length+index}:a]aresample=16000,volume=${layer.volume},apad,atrim=duration=${(layer.outMs-layer.inMs)/1000},asetpts=PTS-STARTPTS,adelay=${layer.startMs}:all=1[layer${index}]`));
 filters.push(`[base]${layers.map((_,index)=>`[layer${index}]`).join("")}amix=inputs=${layers.length+1}:duration=first:normalize=0,atrim=duration=${duration/1000}[speech]`);
 return filters.join(";");
}
