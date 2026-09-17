import test from "node:test";
import assert from "node:assert/strict";
import { emptyTimeline, normalizeVideoTimeline, splitVideoClip, timelineDuration, subtitlesToLabels, labelsToSrt } from "./video-timeline.ts";
import { applyVideoTemplate, applySavedVideoTemplate } from "./video-templates.ts";
const clip={id:"one",sourceUrl:"https://media.example/one.mp4",name:"One",kind:"video" as const,inMs:1000,outMs:6000,fit:"cover" as const,x:.5,y:.5,zoom:1,volume:1};
test("splitting preserves source range, playback duration and independent clip identities",()=>{const timeline={...emptyTimeline(),clips:[clip]};const split=splitVideoClip(timeline,"one",2000);assert.equal(timelineDuration(split),5000);assert.equal(split.clips[0].outMs,3000);assert.equal(split.clips[1].inMs,3000);assert.notEqual(split.clips[0].id,split.clips[1].id);assert.deepEqual(timeline.clips,[clip]);});
test("rejects unsafe, ambiguous or unbounded timeline input",()=>{const base={...emptyTimeline(),clips:[clip]};assert.throws(()=>normalizeVideoTimeline({...base,version:2}));assert.throws(()=>normalizeVideoTimeline({...base,clips:[clip,clip]}));for(const changes of [{outMs:500},{x:NaN},{volume:Infinity},{sourceUrl:"file:///etc/passwd"},{outMs:1_000_000}])assert.throws(()=>normalizeVideoTimeline({...base,clips:[{...clip,...changes}]}));});
test("subtitles round trip with millisecond precision",()=>{const srt="1\n00:00:01,250 --> 00:00:03,500\nA useful caption\n";const labels=subtitlesToLabels(srt);assert.equal(labels[0].startMs,1250);assert.equal(labels[0].endMs,3500);assert.equal(labelsToSrt(labels),srt);});
test("template timing follows actual replacement footage",()=>{const timeline={...emptyTimeline(),clips:[clip,{...clip,id:"two",outMs:11000}]};const result=applyVideoTemplate(timeline,"before-after");assert.deepEqual(result.labels.map(l=>[l.startMs,l.endMs]),[[0,5000],[5000,15000]]);assert.equal(timeline.labels.length,0);assert.throws(()=>applyVideoTemplate(timeline,"three-tips"));});

test("saved template text and cover timing follow unequal replacement durations",()=>{
 const template=applyVideoTemplate({...emptyTimeline(),clips:[clip,{...clip,id:"two",outMs:11000}]},"before-after");
 template.coverMs=10000;
 const result=applySavedVideoTemplate(template,{...emptyTimeline(),clips:[{...clip,outMs:3000},{...clip,id:"two",outMs:5000}]});
 assert.deepEqual(result.labels.map(l=>[l.startMs,l.endMs]),[[0,2000],[2000,6000]]);
 assert.equal(result.coverMs,4000);assert.equal(template.coverMs,10000);
 assert.throws(()=>applySavedVideoTemplate(template,{...emptyTimeline(),clips:[clip]}));
});
test("known source duration prevents invalid video trims",()=>{
 assert.throws(()=>normalizeVideoTimeline({...emptyTimeline(),clips:[{...clip,sourceDurationMs:5000}]}));
 assert.equal(normalizeVideoTimeline({...emptyTimeline(),clips:[{...clip,sourceDurationMs:6000}]}).clips[0].sourceDurationMs,6000);
});
