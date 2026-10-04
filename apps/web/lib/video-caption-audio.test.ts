import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { VideoClip } from "@relay/core";
import { captionAudioJoinFilter } from "./video-caption-audio.ts";
import { clipSchedule } from "./video-timeline.ts";

const clip=(id:string,duration:number):VideoClip=>({id,name:id,kind:"video",sourceUrl:"https://example.com/demo.mp4",inMs:0,outMs:duration,fit:"cover",x:.5,y:.5,zoom:1,volume:1});
test("caption audio uses actual capped transition overlap and sequential cuts",()=>{
 const clips=[clip("one",1000),{...clip("two",400),transition:{kind:"crossfade" as const,durationMs:800}},clip("three",700)];
 const filter=captionAudioJoinFilter(clips);
 assert.match(filter,/acrossfade=d=0\.2:c1=tri:c2=tri/);
 assert.match(filter,/\[joined1\]\[a2\]concat=n=2:v=0:a=1\[joined2\]/);
 assert.match(captionAudioJoinFilter([clips[0]]),/\[a0\]anull\[speech\]/);
 assert.throws(()=>captionAudioJoinFilter([]),/Add clips/);
});

test("FFmpeg caption audio duration matches the rendered timeline clock",()=>{
 const clips=[clip("one",1000),{...clip("two",400),transition:{kind:"wipe-left" as const,durationMs:800}},clip("three",700),{...clip("four",1000),transition:{kind:"zoom" as const,durationMs:300}}];
 // Audio ending before its video trim must leave silence rather than shift later speech.
 const inputs=clips.flatMap((clip,i)=>["-f","lavfi","-i",`sine=frequency=${300+i*100}:sample_rate=16000:duration=${(clip.outMs-clip.inMs)/1000-(i===0?.2:0)}`]);
 const output=execFileSync("ffmpeg",["-v","error",...inputs,"-filter_complex",captionAudioJoinFilter(clips),"-map","[speech]","-ac","1","-ar","16000","-f","s16le","pipe:1"]);
 const durationMs=output.length/2/16000*1000;
 assert.ok(Math.abs(durationMs-clipSchedule(clips).at(-1)!.endMs)<=1,`Audio was ${durationMs}ms`);
});

test("parallel caption audio keeps delayed source speech on the shared clock and respects mute",()=>{
 const layers=[{...clip("watch",700),startMs:0,volume:0},{...clip("phone",500),startMs:500,volume:.5}];
 const inputs=layers.flatMap(layer=>["-f","lavfi","-i",`sine=frequency=440:sample_rate=16000:duration=${(layer.outMs-layer.inMs)/1000}`]);
 const output=execFileSync("ffmpeg",["-v","error",...inputs,"-filter_complex",captionAudioJoinFilter([],layers),"-map","[speech]","-ac","1","-ar","16000","-f","s16le","pipe:1"]);
 assert.equal(output.length/2/16000*1000,1000);
 const energy=(start:number,end:number)=>{let sum=0;for(let sample=start*16;sample<end*16;sample++)sum+=Math.abs(output.readInt16LE(sample*2));return sum;};
 assert.equal(energy(0,400),0); assert.ok(energy(600,900)>10000);
});
