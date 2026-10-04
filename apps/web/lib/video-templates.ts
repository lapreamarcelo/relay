import type { LayerAnimation, VideoTimeline } from "@relay/core";
import { clipSchedule, timelineDuration } from "./video-timeline.ts";
export const videoTemplateCatalog = [
 {id:"hook-demo-cta",name:"Hook → demo → CTA",description:"Open with a promise, show the product, close with an action.",slots:["Your opening hook","Show it in action","Try it today"]},
 {id:"three-tips",name:"Three quick tips",description:"A useful tip on each of three short clips.",slots:["1. Start here","2. Try this","3. Keep it simple"]},
 {id:"before-after",name:"Before / after",description:"A clear sequential comparison.",slots:["Before","After"]},
 {id:"walkthrough",name:"Product walkthrough",description:"Guide viewers through three steps.",slots:["Step 1","Step 2","Step 3"]},
 {id:"testimonial",name:"Customer story",description:"Use your customer's actual words and footage.",slots:["Customer story","Add their actual quote","Discover more"]},
 {id:"b-roll-story",name:"B-roll story",description:"Tell a story across three scenes.",slots:["It started with…","Then we discovered…","Here's what changed"]},
 {id:"announcement",name:"Feature announcement",description:"Introduce a new feature with proof.",slots:["Introducing…","See how it works","Available now"]},
 {id:"weekly-recap",name:"Weekly recap",description:"Your week's most memorable moments.",slots:["This week","The highlight","What's next"]},
];
export function applyVideoTemplate(timeline:VideoTimeline,id:string):VideoTimeline {
 const template=videoTemplateCatalog.find(t=>t.id===id); if(!template)throw new Error("Unknown template.");
 if(timeline.clips.length<template.slots.length)throw new Error(`Add at least ${template.slots.length} clips for this template.`);
 const schedule=clipSchedule(timeline);
 const labels=template.slots.map((text,i)=>({id:crypto.randomUUID(),text,startMs:schedule[i].startMs,endMs:schedule[i].endMs,x:.5,y:i===template.slots.length-1?.75:.2,width:.84,height:.12,fontSize:64,font:"modern" as const,textColor:"#FFFFFF",background:"dark" as const,backgroundColor:"#000000",style:"dark" as const}));
 return {...timeline,labels};
}

// Remap saved timing through corresponding clip boundaries when replacing footage.
function remapAnimation(animation: LayerAnimation | undefined, oldDuration: number, newDuration: number): LayerAnimation | undefined {
 if (!animation) return undefined;
 const result=structuredClone(animation);
 // Keep fractional milliseconds so shortening footage cannot collapse distinct keys.
 if(result.keyframes) result.keyframes=result.keyframes.map(key=>({...key,timeMs:key.timeMs*newDuration/oldDuration}));
 return result;
}
export function applySavedVideoTemplate(template: VideoTimeline, replacement: VideoTimeline): VideoTimeline {
 if (!replacement.clips.length && !replacement.layers?.length) return structuredClone(template);
 if (template.clips.length !== replacement.clips.length) throw new Error(`This template needs ${template.clips.length} clips. Add or remove clips before applying it.`);
 const clips=replacement.clips.map((clip,i)=>{
  const {deviceFrame:_replacementFrame,transition:_replacementTransition,...media}=structuredClone(clip);
  const original=template.clips[i];
  const deviceFrame=original.deviceFrame ? structuredClone(original.deviceFrame) : undefined;
  if(deviceFrame?.animation) deviceFrame.animation=remapAnimation(deviceFrame.animation,original.outMs-original.inMs,clip.outMs-clip.inMs);
  return {...media,...(original.transition ? {transition:structuredClone(original.transition)} : {}),...(deviceFrame ? {deviceFrame} : {})};
 });
 if ((template.layers?.length ?? 0) !== (replacement.layers?.length ?? 0)) throw new Error(`This template needs ${template.layers?.length ?? 0} device layers. Add or remove layers before applying it.`);
 const layers = replacement.layers?.map((layer,index)=>{
  const original=template.layers![index];
  const deviceFrame=original.deviceFrame ? structuredClone(original.deviceFrame) : undefined;
  if(deviceFrame?.animation) deviceFrame.animation=remapAnimation(deviceFrame.animation,original.outMs-original.inMs,layer.outMs-layer.inMs);
  return {...structuredClone(layer),startMs:original.startMs,...(deviceFrame ? {deviceFrame} : {deviceFrame:undefined})};
 });
 const oldSchedule=clipSchedule(template),newSchedule=clipSchedule(clips);
 const oldDuration=timelineDuration(template),duration=timelineDuration({...template,clips,layers});
 const mapTime = (time: number) => {
  if(!oldSchedule.length) return Math.round(Math.max(0,Math.min(time,oldDuration))*duration/Math.max(1,oldDuration));
  const oldClipEnd=oldSchedule.at(-1)!.endMs,newClipEnd=newSchedule.at(-1)!.endMs;
  if(time>oldClipEnd && oldDuration>oldClipEnd) return Math.round(newClipEnd+(Math.min(time,oldDuration)-oldClipEnd)/(oldDuration-oldClipEnd)*(duration-newClipEnd));
  const bounded=Math.max(0,Math.min(time,oldClipEnd));
  // The incoming clip owns overlap times, matching the editor's active clip.
  const index=oldSchedule.findLastIndex(entry=>entry.startMs<=bounded);
  const before=oldSchedule[index],after=newSchedule[index];
  // Map ownership spans, rather than full overlapping clip durations, to keep
  // time monotonic when replacement footage has different transition caps.
  const oldEnd=oldSchedule[index+1]?.startMs ?? before.endMs;
  const newEnd=newSchedule[index+1]?.startMs ?? after.endMs;
  return Math.round(after.startMs+(bounded-before.startMs)/(oldEnd-before.startMs)*(newEnd-after.startMs));
 };
 const labels=template.labels.map(label=>{
  const startMs=mapTime(label.startMs),endMs=mapTime(label.endMs);
  return {...structuredClone(label),id:crypto.randomUUID(),startMs,endMs,...(label.animation ? {animation:remapAnimation(label.animation,label.endMs-label.startMs,endMs-startMs)} : {})};
 }).filter(label=>label.endMs>label.startMs);
 return {...structuredClone(template),clips,...(layers ? {layers} : {}),coverMs:Math.max(0,Math.min(duration-1,mapTime(template.coverMs))),labels};
}
