import test from "node:test";
import assert from "node:assert/strict";
import { effectiveMusicRange, emptyTimeline, layerSchedule, normalizeVideoTimeline, splitVideoClip, timelineDuration, subtitlesToLabels, labelsToSrt } from "./video-timeline.ts";
import { applyVideoTemplate, applySavedVideoTemplate } from "./video-templates.ts";
const clip={id:"one",sourceUrl:"https://media.example/one.mp4",name:"One",kind:"video" as const,inMs:1000,outMs:6000,fit:"cover" as const,x:.5,y:.5,zoom:1,volume:1};
test("simultaneous layers preserve order, independent ranges, and extend the timeline",()=>{
 const layers=[{...clip,id:"watch",startMs:1000,outMs:2500,deviceFrame:{device:"watch",background:"#abcdef",color:"#123456",motion:"orbit",motionDurationMs:1000}},{...clip,id:"phone",startMs:4000,outMs:4000}];
 const timeline=normalizeVideoTimeline({...emptyTimeline(),clips:[{...clip,outMs:2000}],layers});
 assert.equal(timelineDuration(timeline),7000);
 assert.deepEqual(layerSchedule(timeline).map(({clip,index,startMs,endMs,transitionMs})=>({id:clip.id,index,startMs,endMs,transitionMs})),[{id:"watch",index:0,startMs:1000,endMs:2500,transitionMs:0},{id:"phone",index:1,startMs:4000,endMs:7000,transitionMs:0}]);
 assert.equal(timeline.layers?.[0].deviceFrame?.device,"watch");
 assert.equal(timeline.layers?.[0].deviceFrame?.background,"#ABCDEF");
 assert.equal(timelineDuration(normalizeVideoTimeline({...emptyTimeline(),layers})),7000);
 assert.equal(Object.hasOwn(normalizeVideoTimeline({...emptyTimeline(),clips:[clip]}),"layers"),false);
});
test("layers share clip validation and reject ambiguous or unbounded composition",()=>{
 const base={...emptyTimeline(),clips:[clip]};
 const layer={...clip,id:"layer",startMs:0};
 for(const layers of [null,Array.from({length:13},(_,i)=>({...layer,id:`layer-${i}`})),[{...layer,id:clip.id}],[layer,layer],[{...layer,startMs:-1}],[{...layer,startMs:Infinity}],[{...layer,startMs:NaN}],[{...layer,startMs:899000}],[{...layer,transition:{kind:"crossfade",durationMs:200}}],[{...layer,sourceUrl:"file:///tmp/video"}],[{...layer,outMs:7000,sourceDurationMs:6000}],[{...layer,volume:2}]]) assert.throws(()=>normalizeVideoTimeline({...base,layers}));
});
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
test("normalizes optional device frame settings without changing unframed clips",()=>{
 const framed=normalizeVideoTimeline({...emptyTimeline(),clips:[{...clip,deviceFrame:{device:"browser",background:"#abcdef",color:"#123456"}}]});
 assert.deepEqual(framed.clips[0].deviceFrame,{device:"browser",background:"#ABCDEF",color:"#123456"});
 assert.equal(normalizeVideoTimeline({...emptyTimeline(),clips:[clip]}).clips[0].deviceFrame,undefined);
 assert.throws(()=>normalizeVideoTimeline({...emptyTimeline(),clips:[{...clip,deviceFrame:{device:"phone",background:"black",color:"#123456"}}]}));
});
test("persists video device motion and optional solid or gradient canvas backgrounds",()=>{
 const deviceFrame={device:"iphone-duo",background:"#aabbcc",color:"#123456",x:.3,y:.6,scale:.8,rotateX:15,rotateY:-10,rotateZ:20,foldAngle:140,motion:"fold-cycle",motionDurationMs:2000};
 const timeline=normalizeVideoTimeline({...emptyTimeline(),background:{color:"#abcdef",endColor:"#123456"},clips:[{...clip,deviceFrame}]});
 assert.deepEqual(timeline.background,{color:"#ABCDEF",endColor:"#123456"});
 assert.deepEqual(timeline.clips[0].deviceFrame,{...deviceFrame,background:"#AABBCC"});
 assert.deepEqual(normalizeVideoTimeline({...emptyTimeline(),background:{color:"#aabbcc"},clips:[clip]}).background,{color:"#AABBCC"});
 for(const background of ["#abcdef",{color:"red"},{color:"#abcdef",endColor:"transparent"}]) assert.throws(()=>normalizeVideoTimeline({...emptyTimeline(),background,clips:[clip]}));
});
test("old music settings still cover the full timeline",()=>{
 const timeline=normalizeVideoTimeline({...emptyTimeline(),clips:[clip],music:{url:"https://media.example/music.mp3",volume:.7,offsetMs:1200,fadeInMs:200,fadeOutMs:300}});
 assert.deepEqual(timeline.music,{url:"https://media.example/music.mp3",volume:.7,offsetMs:1200,fadeInMs:200,fadeOutMs:300});
 assert.deepEqual(effectiveMusicRange(timeline.music,timelineDuration(timeline)),{startMs:0,endMs:5000,durationMs:5000});
});
test("normalizes named music placement independently of the current video duration",()=>{
 const shortened=normalizeVideoTimeline({...emptyTimeline(),clips:[{...clip,outMs:3000}],music:{...emptyTimeline().music,url:"https://media.example/music.mp3",name:"  Theme song  ",startMs:4000,endMs:8000}});
 assert.equal(shortened.music.name,"Theme song");
 assert.equal(shortened.music.startMs,4000);
 assert.equal(shortened.music.endMs,8000);
 assert.equal(effectiveMusicRange(shortened.music,timelineDuration(shortened)),null);
 const overlapping={...shortened.music,startMs:1000,endMs:8000};
 assert.deepEqual(effectiveMusicRange(overlapping,timelineDuration(shortened)),{startMs:1000,endMs:2000,durationMs:1000});
});
test("rejects invalid music placement ranges",()=>{
 const base={...emptyTimeline(),clips:[clip]};
 for(const music of [
  {...base.music,startMs:-1,endMs:1000},
  {...base.music,startMs:0,endMs:Infinity},
  {...base.music,startMs:1000,endMs:1000},
  {...base.music,startMs:2000,endMs:1000},
  {...base.music,startMs:0,endMs:900001},
 ]) assert.throws(()=>normalizeVideoTimeline({...base,music}));
});

test("incoming transitions overlap only half of either adjacent clip and preserve animation data", async () => {
  const {clipSchedule} = await import("./video-timeline.ts");
  const base = emptyTimeline();
  const clips = [1000,400,2000].map((duration,i) => ({id:`transition-${i}`,sourceUrl:"https://example.com/a.mp4",kind:"video" as const,name:"Demo",inMs:0,outMs:duration,fit:"cover" as const,x:.5,y:.5,zoom:1,volume:1,transition:{kind:"crossfade" as const,durationMs:800,easing:"ease-in-out" as const}}));
  const normalized=normalizeVideoTimeline({...base,clips,labels:[{id:"animated",text:"Hello",x:.5,y:.2,startMs:0,endMs:500,animation:{entrance:{preset:"typewriter",durationMs:300},keyframes:[{timeMs:0,x:.2},{timeMs:500,x:.8}]}}]});
  assert.equal(timelineDuration(normalized),3000);
  assert.deepEqual(clipSchedule(normalized).map(({startMs,endMs,transitionMs})=>({startMs,endMs,transitionMs})),[{startMs:0,endMs:1000,transitionMs:0},{startMs:800,endMs:1200,transitionMs:200},{startMs:1000,endMs:3000,transitionMs:200}]);
  assert.equal(normalized.labels[0].animation?.entrance?.preset,"typewriter");
  assert.throws(()=>normalizeVideoTimeline({...base,clips:[{...clips[0],transition:{kind:"invalid",durationMs:100}}]}),/transition/);
});
