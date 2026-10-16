import test from "node:test";
import assert from "node:assert/strict";
import { clipDuration, clipMotionDuration, clipMotionTime, clipSchedule, clipSourceTime, emptyTimeline, normalizeVideoTimeline, splitVideoClip, timelineDuration } from "./video-timeline.ts";
import { audioTrackVolume, beatTimes, duplicateVideoClip, freezeVideoClip, linkVideoClips, moveVideoClip, retimeTimeline, rippleDeleteVideoClip, setVideoClipSpeed, slipVideoClip, snapToBeat, trimVideoClip, unlinkVideoClip } from "./video-edit-operations.ts";
const clip = {id:"one",sourceUrl:"https://media.example/one.mp4",name:"One",kind:"video" as const,inMs:1000,outMs:5000,sourceDurationMs:10000,fit:"cover" as const,x:.5,y:.5,zoom:1,volume:1};
const sound = {id:"sound",url:"https://media.example/sound.mp3",name:"Sound",startMs:1000,endMs:9000,offsetMs:0,volume:.8,fadeInMs:1000,fadeOutMs:2000};
const label = {id:"label",text:"Hi",startMs:5000,endMs:7000,x:.5,y:.5,width:.8,fontSize:52,font:"modern" as const,textColor:"#FFFFFF",background:"dark" as const,backgroundColor:"#000000",style:"dark" as const};
const timeline = () => ({...emptyTimeline(),clips:[clip,{...clip,id:"two"}],labels:[label],audioTracks:[sound],camera:{zoom:1,x:.5,y:.5,keyframes:[{timeMs:0,zoom:1},{timeMs:6000,zoom:2}]},coverMs:6000});

test("speed adjusts schedule and source sampling while freeze retains authored duration",()=>{
 const fast={...clip,speed:2};
 assert.equal(clipDuration(fast),2000);
 assert.equal(clipSourceTime(fast,500),2000);
 assert.equal(clipSourceTime(fast,10000),5000);
 assert.equal(clipSourceTime({...fast,freezeMs:2200},500),2200);
 assert.equal(timelineDuration({...emptyTimeline(),clips:[fast]}),2000);
 const overlaps=clipSchedule([fast,{...clip,id:"next",speed:.5,transition:{kind:"crossfade",durationMs:1500}}]);
 assert.equal(overlaps[1].transitionMs,1000);
 assert.equal(overlaps[1].endMs,9000);
});
test("split continues linked motion without jumping its source or animation clock",()=>{
 const base={...emptyTimeline(),clips:[{...clip,speed:2}]};
 const split=splitVideoClip(base,clip.id,500);
 assert.equal(split.clips[0].outMs,2000);assert.equal(split.clips[1].inMs,2000);
 assert.equal(timelineDuration(split),2000);
 assert.equal(split.clips[0].groupId,split.clips[1].groupId);
 assert.equal(clipMotionTime(split.clips[1],0),500);
 assert.equal(clipMotionDuration(split,split.clips[1]),2000);
 assert.equal(clipSourceTime(split.clips[1],250),2500);
 assert.equal(splitVideoClip(base,clip.id,NaN),base);
});
test("normalization preserves bounded speed, freeze, sound lanes, and beats",()=>{
 const base={...emptyTimeline(),clips:[{...clip,speed:2,freezeMs:3000,groupId:"group",motionOffsetMs:500}],audioTracks:[sound],beatGrid:{bpm:123,offsetMs:400}};
 const normalized=normalizeVideoTimeline(base);
 assert.deepEqual(normalized.audioTracks,[sound]);assert.deepEqual(normalized.beatGrid,base.beatGrid);
 assert.equal(normalized.clips[0].speed,2);assert.equal(normalized.clips[0].freezeMs,3000);
 assert.equal(timelineDuration(normalized),9000);
 assert.equal(timelineDuration(normalizeVideoTimeline({...emptyTimeline(),labels:[label]})),7000);
 for (const change of [{speed:0},{speed:4.1},{speed:NaN},{freezeMs:10001},{groupId:"bad id"},{motionOffsetMs:-1}]) assert.throws(()=>normalizeVideoTimeline({...base,clips:[{...clip,...change}]}));
 for (const tracks of [[sound,sound],[{...sound,id:clip.id}],[{...sound,url:"http://media.example/sound"}],[{...sound,fadeInMs:9000}],[{...sound,endMs:1000}],Array.from({length:13},(_,i)=>({...sound,id:`s${i}`}))]) assert.throws(()=>normalizeVideoTimeline({...base,audioTracks:tracks}));
 assert.throws(()=>normalizeVideoTimeline({...base,beatGrid:{bpm:301,offsetMs:0}}));
 assert.throws(()=>normalizeVideoTimeline({...base,beatGrid:{bpm:120,offsetMs:-1}}));
});
test("speed ripple retimes text camera layers graphics and sound against one global clock",()=>{
 const base={...timeline(),layers:[{...clip,id:"layer",inMs:0,outMs:1000,startMs:6000}],graphics:[{id:"graphic",kind:"ring" as const,startMs:5500,endMs:7000,x:.5,y:.5,width:.2,height:.2,color:"#FFFFFF",seed:1,count:4,speed:1}]};
 const result=setVideoClipSpeed(base,"one",2);
 assert.equal(timelineDuration(result),7000);
 assert.deepEqual(result.labels.map(l=>[l.startMs,l.endMs]),[[3000,5000]]);
 assert.equal(result.camera?.keyframes?.[1].timeMs,4000);
 assert.equal(result.coverMs,4000);
 assert.equal(result.layers?.[0].startMs,4000);
 assert.equal(result.graphics?.[0].startMs,3500);
 assert.equal(result.audioTracks?.[0].startMs,500);
 assert.equal(result.audioTracks?.[0].endMs,7000);
 assert.equal(base.labels[0].startMs,5000);
 assert.equal(setVideoClipSpeed(base,"one",Infinity),base);
});
test("ripple delete collapses cues inside a cut and deduplicates camera keyframes",()=>{
 const base={...timeline(),labels:[{...label,startMs:1000,endMs:2000},label],camera:{zoom:1,x:.5,y:.5,keyframes:[{timeMs:0,zoom:1},{timeMs:1000,zoom:2},{timeMs:6000,zoom:3}]}};
 const result=rippleDeleteVideoClip(base,"one");
 assert.equal(result.clips.length,1);assert.equal(result.labels.length,1);
 assert.deepEqual(result.labels.map(l=>[l.startMs,l.endMs]),[[1000,3000]]);
 assert.deepEqual(result.camera?.keyframes?.map(k=>[k.timeMs,k.zoom]),[[0,2],[2000,3]]);
 assert.equal(result.audioTracks?.[0].endMs,5000);
 normalizeVideoTimeline(result);
});
test("slip, freeze and unlink preserve duration; links share pose and propagate offsets",()=>{
 const base=timeline(), slipped=slipVideoClip(base,"one",99999);
 assert.equal(slipped.clips[0].outMs,10000);assert.equal(clipDuration(slipped.clips[0]),4000);
 assert.equal(freezeVideoClip(base,"one",750).clips[0].freezeMs,1750);
 assert.equal(freezeVideoClip(freezeVideoClip(base,"one",750),"one").clips[0].freezeMs,undefined);
 const linked=linkVideoClips({...base,clips:[clip,{...clip,id:"two",x:.2}]},["one","two"]);
 assert.equal(linked.clips[1].x,.5);assert.equal(linked.clips[1].motionOffsetMs,4000);
 const shortened=trimVideoClip(linked,"one",1000,3000);
 assert.equal(shortened.clips[1].motionOffsetMs,2000);
 assert.equal(clipMotionDuration(shortened,shortened.clips[1]),6000);
 assert.equal(unlinkVideoClip(linked,"two").clips[1].groupId,undefined);
 const three=linkVideoClips({...base,clips:[clip,{...clip,id:"two"},{...clip,id:"three"}]},["one","two","three"]);
 assert.deepEqual(trimVideoClip(three,"one",1000,3000).clips.map(c=>c.motionOffsetMs),[0,2000,6000]);
});
test("duplicate opens room for later cues, move is bounded and edits preserve input",()=>{
 const base=timeline(), copy=duplicateVideoClip(base,"one");
 assert.equal(copy.clips.length,3);assert.notEqual(copy.clips[0].id,copy.clips[1].id);
 assert.equal(copy.labels[0].startMs,9000);
 assert.equal(copy.audioTracks?.[0].endMs,13000);
 assert.equal(base.clips.length,2);
 assert.equal(moveVideoClip(base,"one",-1),base);
 assert.equal(moveVideoClip(base,"one",1).clips[0].id,"two");
 assert.equal(trimVideoClip(base,"one",1000,1010),base);
 assert.equal(trimVideoClip(base,"one",1000,10001),base);
});
test("beat snapping and sound envelopes are deterministic and bounded",()=>{
 const grid={bpm:120,offsetMs:100};
 assert.equal(snapToBeat(830,grid),600);assert.equal(snapToBeat(900,grid),1100);
 assert.equal(snapToBeat(830,grid,false),830);
 assert.deepEqual(beatTimes(grid,1600),[100,600,1100,1600]);
 assert.equal(audioTrackVolume(sound,999),0);assert.equal(audioTrackVolume(sound,1500),.4);
 assert.equal(audioTrackVolume(sound,4000),.8);assert.equal(audioTrackVolume(sound,8000),.4);
 assert.equal(audioTrackVolume(sound,9000),0);
});
test("retiming maps relative text animation while preserving ordered sparse frames",()=>{
 const base={...timeline(),labels:[{...label,startMs:0,endMs:4000,animation:{keyframes:[{timeMs:0,x:.2},{timeMs:1000,x:.3},{timeMs:3000,x:.7}]}}]};
 const result=retimeTimeline(base,0,4000,2000);
 assert.deepEqual(result.labels[0].animation?.keyframes?.map(k=>k.timeMs),[0,500,1500]);
 assert.equal(result.labels[0].endMs,2000);
});


test("ripple retiming preserves brief captions and slip bounds an independently held frame",()=>{
 const base={...timeline(),clips:[{...clip,freezeMs:9000}],labels:[{...label,startMs:6000,endMs:6050}]};
 const slipped=slipVideoClip(base,"one",9000);
 assert.equal(slipped.clips[0].freezeMs,10000);assert.equal(slipped.clips[0].inMs,2000);
 normalizeVideoTimeline(slipped);
 const changed=retimeTimeline(base,0,4000,2000);
 assert.equal(changed.labels[0].startMs,4000);assert.equal(changed.labels[0].endMs,4050);
});
test("split leaves existing overlaps intact or declines a cut inside their duration cap",()=>{
 const next={...clip,id:"two",transition:{kind:"crossfade" as const,durationMs:500}};
 const base={...emptyTimeline(),clips:[clip,next]};
 assert.equal(splitVideoClip(base,"two",500),base);
 const split=splitVideoClip(base,"two",1500);
 assert.equal(timelineDuration(split),timelineDuration(base));
 assert.equal(clipSchedule(split)[1].transitionMs,500);
});
