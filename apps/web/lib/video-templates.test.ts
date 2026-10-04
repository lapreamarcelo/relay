import test from "node:test";
import assert from "node:assert/strict";
import type { VideoClip } from "@relay/core";
import { applySavedVideoTemplate, applyVideoTemplate } from "./video-templates.ts";
import { emptyTimeline, normalizeVideoTimeline, timelineDuration } from "./video-timeline.ts";

const clip=(id:string,duration:number):VideoClip=>({id,name:id,kind:"video",sourceUrl:`https://example.com/${id}.mp4`,inMs:1000,outMs:1000+duration,fit:"contain",x:.5,y:.5,zoom:1,volume:1});
const labelStyle={width:.84,fontSize:52,font:"modern" as const,textColor:"#FFFFFF",background:"dark" as const,backgroundColor:"#000000",style:"dark" as const};
const transition={kind:"crossfade" as const,durationMs:1000,easing:"ease-in-out" as const};

test("built-in labels align with overlapping clip lifetimes",()=>{
 const timeline={...emptyTimeline(),clips:[clip("one",4000),{...clip("two",4000),transition}]};
 const result=applyVideoTemplate(timeline,"before-after");
 assert.equal(timelineDuration(result),7000);
 assert.deepEqual(result.labels.map(label=>[label.startMs,label.endMs]),[[0,4000],[3000,7000]]);
 assert.deepEqual(result.clips,timeline.clips);
});

test("saved templates retain transitions, frame animation and local label keyframes on replacement",()=>{
 const frame={device:"iphone-duo" as const,background:"#112233",color:"#000000",motion:"fold-cycle" as const,motionDurationMs:2000,motionEasing:"ease-in" as const,animation:{entrance:{preset:"pop" as const,durationMs:500,easing:"ease-out" as const},exit:{preset:"fade" as const,durationMs:300},keyframes:[{timeMs:0,foldAngle:0},{timeMs:2000,foldAngle:100,easing:"ease-in-out" as const},{timeMs:4000,foldAngle:150}]}};
 const template={...emptyTimeline(),clips:[{...clip("one",4000),deviceFrame:frame},{...clip("two",4000),transition}],coverMs:3500,labels:[{...labelStyle,id:"label",text:"Try the app",x:.5,y:.2,startMs:3000,endMs:5000,animation:{entrance:{preset:"typewriter" as const,durationMs:600},exit:{preset:"slide-up" as const,durationMs:200,easing:"ease-in" as const},keyframes:[{timeMs:0,x:.2},{timeMs:1000,x:.5,easing:"ease-out" as const},{timeMs:2000,x:.8}]}}]};
 const replacement={...emptyTimeline(),clips:[{...clip("new-one",2000),deviceFrame:{device:"browser" as const,background:"#FFFFFF",color:"#000000"},transition:{kind:"zoom" as const,durationMs:100}},{...clip("new-two",6000)}]};
 const before=structuredClone(template);
 const result=applySavedVideoTemplate(template,replacement);
 assert.equal(timelineDuration(result),7000);
 assert.equal(result.clips[0].sourceUrl,replacement.clips[0].sourceUrl);
 assert.equal(result.clips[0].transition,undefined);
 assert.equal(result.clips[1].deviceFrame,undefined);
 assert.deepEqual(result.clips[1].transition,transition);
 assert.deepEqual(result.clips[0].deviceFrame,{...frame,animation:{...frame.animation,keyframes:frame.animation.keyframes.map(key=>({...key,timeMs:key.timeMs/2}))}});
 assert.deepEqual(result.labels.map(label=>[label.startMs,label.endMs]),[[1000,4000]]);
 assert.deepEqual(result.labels[0].animation,{...template.labels[0].animation,keyframes:template.labels[0].animation.keyframes.map(key=>({...key,timeMs:key.timeMs*1.5}))});
 assert.equal(result.coverMs,1750);
 assert.notEqual(result.labels[0].id,template.labels[0].id);
 assert.deepEqual(template,before);
 assert.doesNotThrow(()=>normalizeVideoTimeline(result));
});

test("mapping across an overlap boundary is monotonic and does not lose short animated labels",()=>{
 const template={...emptyTimeline(),clips:[clip("one",4000),{...clip("two",4000),transition}],labels:[{...labelStyle,id:"boundary",text:"Keep this label",x:.5,y:.2,startMs:2900,endMs:3100,animation:{keyframes:[{timeMs:0,opacity:0},{timeMs:1,opacity:.5},{timeMs:200,opacity:1}]}}]};
 const replacement={...emptyTimeline(),clips:[clip("new-one",2000),clip("new-two",6000)]};
 const result=applySavedVideoTemplate(template,replacement);
 assert.equal(result.labels.length,1);
 assert.deepEqual([result.labels[0].startMs,result.labels[0].endMs],[967,1150]);
 const keys=result.labels[0].animation!.keyframes!;
 assert.equal(keys[2].timeMs,183);
 assert.ok(keys[1].timeMs>keys[0].timeMs);
 assert.doesNotThrow(()=>normalizeVideoTimeline(result));
});

test("saved parallel-device templates replace each recording and retain independent local animation",()=>{
 const template={...emptyTimeline(),clips:[],layers:[{...clip("watch",4000),startMs:0,deviceFrame:{device:"watch" as const,background:"#112233",color:"#171717",x:.3,scale:.6,animation:{keyframes:[{timeMs:0,rotateY:-20},{timeMs:4000,rotateY:20}]}}},{...clip("phone",4000),startMs:1000,deviceFrame:{device:"iphone" as const,background:"#112233",color:"#171717",x:.7,scale:.5}}],coverMs:4000,labels:[{...labelStyle,id:"title",text:"A connected app",x:.5,y:.2,startMs:0,endMs:5000}]};
 const replacement={...emptyTimeline(),layers:[{...clip("new-watch",2000),startMs:0},{...clip("new-phone",2000),startMs:0}]};
 const result=applySavedVideoTemplate(template,replacement);
 assert.equal(timelineDuration(result),3000);
 assert.deepEqual(result.layers?.map(layer=>layer.sourceUrl),replacement.layers.map(layer=>layer.sourceUrl));
 assert.deepEqual(result.layers?.map(layer=>layer.startMs),[0,1000]);
 assert.equal(result.layers?.[0].deviceFrame?.animation?.keyframes?.[1].timeMs,2000);
 assert.equal(result.labels[0].endMs,3000);
 assert.equal(result.coverMs,2400);
 assert.doesNotThrow(()=>normalizeVideoTimeline(result));
 assert.throws(()=>applySavedVideoTemplate(template,{...replacement,layers:[replacement.layers[0]]}),/2 device layers/);
});
