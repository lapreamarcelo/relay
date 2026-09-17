// Offline rendering integration check: synthetic sources, real FFmpeg, stubbed R2 I/O.
import assert from "node:assert/strict";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command,renderVideoArtifactDetails } from "../lib/video-renderer";
import { getR2Client } from "../lib/r2";
import { emptyTimeline } from "../lib/video-timeline";
Object.assign(process.env,{R2_ACCOUNT_ID:"test",R2_ACCESS_KEY_ID:"test",R2_SECRET_ACCESS_KEY:"test",R2_BUCKET_NAME:"test",R2_PUBLIC_URL:"https://media.example"});
const dir=await mkdtemp(join(tmpdir(),"relay-render-test-"));const originalFetch=globalThis.fetch;
try{
 const a=join(dir,"a.mp4"),b=join(dir,"b.mp4"),output=join(dir,"output.mp4");
 await command("ffmpeg",["-y","-f","lavfi","-i","color=c=red:s=320x240:d=2","-f","lavfi","-i","sine=frequency=440:duration=2","-map","0:v:0","-map","1:a:0","-map","1:a:0","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac","-shortest",a]);
 // Mimic a phone recording with usable primary audio and an unknown extra track.
 const source=await readFile(a);const first=source.indexOf(Buffer.from("mp4a"));const second=source.indexOf(Buffer.from("mp4a"),first+4);
 assert.ok(first>=0 && second>first,"fixture must contain two AAC sample entries");
 const descriptor=source.indexOf(Buffer.from("esds"),second+4);assert.ok(descriptor>second);
 source.write("zzzz",second,"ascii");source.write("free",descriptor,"ascii");await writeFile(a,source);
 const sourceProbe=JSON.parse(await command("ffprobe",["-v","error","-show_streams","-of","json",a]));
 assert.equal(sourceProbe.streams[1].codec_name,"aac");assert.equal(sourceProbe.streams[2].codec_type,"audio");assert.ok(!sourceProbe.streams[2].codec_name || sourceProbe.streams[2].codec_name==="unknown");
 await assert.rejects(command("ffmpeg",["-v","error","-i",a,"-map","0:a?","-c:a","aac","-f","null","-"]),/Decoder .*not found|no decoder found/i);
 await command("ffmpeg",["-y","-f","lavfi","-i","color=c=blue:s=240x320:d=2","-c:v","libx264","-pix_fmt","yuv420p",b]);
 globalThis.fetch=async(input)=>{const url=String(input);const path=url.endsWith("a.mp4")?a:b;return new Response(new Uint8Array(await readFile(path)));};
 const client=getR2Client();const send=client.send.bind(client);client.send=(async(input:{input:{Body:Uint8Array;ContentType?:string}})=>{if(input.input.ContentType==="video/mp4")await writeFile(output,input.input.Body);return {};}) as typeof client.send;
 for(const [sourceUrl,musicUrl,expectedAudio] of [
  ["https://media.example/a.mp4",undefined,1],
  ["https://media.example/a.mp4","https://media.example/a.mp4",1],
  ["https://media.example/b.mp4",undefined,0],
  ["https://media.example/b.mp4","https://media.example/a.mp4",1],
 ] as const) {
  await renderVideoArtifactDetails({projectId:"test",sourceUrl,musicUrl,labels:[]});
  const rendered=JSON.parse(await command("ffprobe",["-v","error","-show_entries","stream=codec_type,codec_name","-of","json",output]));
  const audio=rendered.streams.filter((s:{codec_type:string})=>s.codec_type==="audio");
  assert.equal(audio.length,expectedAudio);if(expectedAudio)assert.equal(audio[0].codec_name,"aac");
 }
 console.log("PASS: recipe render skips unsupported auxiliary audio, with/without music and source audio");
 const timeline=emptyTimeline();timeline.aspectRatio="1:1";timeline.clips=[a,b].map((path,i)=>({id:`c${i}`,sourceUrl:`https://media.example/${i?"b":"a"}.mp4`,name:path,kind:"video",inMs:500,outMs:1500,fit:i?"contain":"cover",x:.5,y:.5,zoom:1,volume:.5}));
 timeline.labels=[{id:"label",text:"Test",x:.5,y:.2,width:.84,height:.12,fontSize:64,font:"modern",textColor:"#FFFFFF",background:"dark",backgroundColor:"#000000",style:"dark",startMs:200,endMs:700}];
 const artifact=await renderVideoArtifactDetails({projectId:"test",sourceUrl:"",labels:[],timeline});
 assert.equal(artifact.durationMs,2000);
 const probe=JSON.parse(await command("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",output]));
 assert.equal(probe.streams.find((s:{codec_type:string})=>s.codec_type==="video").width,1080);assert.equal(probe.streams.find((s:{codec_type:string})=>s.codec_type==="video").height,1080);assert.ok(Math.abs(Number(probe.format.duration)-2)<.15);assert.ok(probe.streams.some((s:{codec_type:string})=>s.codec_type==="audio"));
 client.send=send;console.log("PASS: multi-clip trims, portrait/landscape normalization, silent source, timed overlay and audio export");
}finally{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
