import type { VideoTimeline } from "@relay/core";
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
 let time=0;
 const labels=template.slots.map((text,i)=>{const startMs=time;time+=timeline.clips[i].outMs-timeline.clips[i].inMs;return {id:crypto.randomUUID(),text,startMs,endMs:time,x:.5,y:i===template.slots.length-1?.75:.2,width:.84,height:.12,fontSize:64,font:"modern" as const,textColor:"#FFFFFF",background:"dark" as const,backgroundColor:"#000000",style:"dark" as const};});
 return {...timeline,labels};
}

// Remap saved timing through corresponding clip boundaries when replacing footage.
export function applySavedVideoTemplate(template: VideoTimeline, replacement: VideoTimeline): VideoTimeline {
 if (!replacement.clips.length) return structuredClone(template);
 if (template.clips.length !== replacement.clips.length) throw new Error(`This template needs ${template.clips.length} clips. Add or remove clips before applying it.`);
 const mapTime = (time: number) => {
  let before = 0, after = 0;
  for (let i = 0; i < template.clips.length; i++) {
   const oldDuration = template.clips[i].outMs - template.clips[i].inMs;
   const newDuration = replacement.clips[i].outMs - replacement.clips[i].inMs;
   if (time <= before + oldDuration) return Math.round(after + Math.max(0, time - before) / oldDuration * newDuration);
   before += oldDuration; after += newDuration;
  }
  return after;
 };
 const duration = replacement.clips.reduce((sum, c) => sum + c.outMs - c.inMs, 0);
 return {...structuredClone(template), clips:replacement.clips, coverMs:Math.min(duration-1,mapTime(template.coverMs)), labels:template.labels.map(l=>({...l,id:crypto.randomUUID(),startMs:mapTime(l.startMs),endMs:mapTime(l.endMs)})).filter(l=>l.endMs>l.startMs)};
}
