// Offline rendering integration check: synthetic sources, real FFmpeg, stubbed R2 I/O.
import assert from "node:assert/strict";
import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { command,renderVideoArtifactDetails } from "../lib/video-renderer";
import { deviceFrameGeometry } from "../lib/device-frames";
import { getR2Client } from "../lib/r2";
import { emptyTimeline } from "../lib/video-timeline";
Object.assign(process.env,{R2_ACCOUNT_ID:"test",R2_ACCESS_KEY_ID:"test",R2_SECRET_ACCESS_KEY:"test",R2_BUCKET_NAME:"test",R2_PUBLIC_URL:"https://media.example"});
const dir=await mkdtemp(join(tmpdir(),"relay-render-test-"));const originalFetch=globalThis.fetch;
try{
 const a=join(dir,"a.mp4"),b=join(dir,"b.mp4"),c=join(dir,"c.png"),output=join(dir,"output.mp4");
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
 await sharp({create:{width:240,height:320,channels:3,background:"#20B050"}}).png().toFile(c);
 globalThis.fetch=async(input)=>{const url=String(input);const path=url.endsWith("a.mp4")?a:url.endsWith("b.mp4")?b:c;return new Response(new Uint8Array(await readFile(path)));};
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
 const timeline=emptyTimeline();timeline.aspectRatio="1:1";timeline.clips=[
  {id:"c0",sourceUrl:"https://media.example/a.mp4",name:a,kind:"video",inMs:500,outMs:1500,fit:"cover",x:.5,y:.5,zoom:1,volume:.5,deviceFrame:{device:"phone",background:"#123456",color:"#202020"}},
  {id:"c1",sourceUrl:"https://media.example/b.mp4",name:b,kind:"video",inMs:500,outMs:1500,fit:"contain",x:.5,y:.5,zoom:1,volume:.5,deviceFrame:{device:"tablet",background:"#DDE5EE",color:"#202020"}},
  {id:"c2",sourceUrl:"https://media.example/c.png",name:c,kind:"image",inMs:0,outMs:1000,fit:"cover",x:.5,y:.5,zoom:1,volume:0,deviceFrame:{device:"browser",background:"#EFE9DD",color:"#202020"}},
 ];
 timeline.labels=[{id:"label",text:"Test",x:.5,y:.2,width:.84,height:.12,fontSize:64,font:"modern",textColor:"#FFFFFF",background:"dark",backgroundColor:"#000000",style:"dark",startMs:200,endMs:700}];
 const artifact=await renderVideoArtifactDetails({projectId:"test",sourceUrl:"",labels:[],timeline});
 assert.equal(artifact.durationMs,3000);
 const probe=JSON.parse(await command("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",output]));
 assert.equal(probe.streams.find((s:{codec_type:string})=>s.codec_type==="video").width,1080);assert.equal(probe.streams.find((s:{codec_type:string})=>s.codec_type==="video").height,1080);assert.ok(Math.abs(Number(probe.format.duration)-3)<.15);assert.ok(probe.streams.some((s:{codec_type:string})=>s.codec_type==="audio"));
 const frame=join(dir,"framed.png");await command("ffmpeg",["-y","-ss","0.85","-i",output,"-frames:v","1",frame]);
 const geometry=deviceFrameGeometry(1080,1080,"phone");const {data,info}=await sharp(frame).raw().toBuffer({resolveWithObject:true});
 const pixel=(x:number,y:number)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];const close=(actual:number[],expected:number[])=>actual.every((channel,index)=>Math.abs(channel-expected[index])<35);
 assert.ok(close(pixel(4,4),[0x12,0x34,0x56]),"frame background must be visible");assert.ok(close(pixel(Math.round(geometry.screen.x+geometry.screen.width/2),Math.round(geometry.screen.y+geometry.screen.height*.7)),[255,0,0]),"video must be visible inside the device screen");
 client.send=send;console.log("PASS: multi-clip trims, device frame mask/background, silent source, timed overlay and audio export");
}finally{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
