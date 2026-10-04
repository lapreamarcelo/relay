import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import sharp from "sharp";
import { emptyTimeline } from "./video-timeline.ts";

const run=promisify(execFile);
const available=spawnSync("ffmpeg",["-version"],{stdio:"ignore"}).status===0;
// Isolate server-only/storage adapters from other tests. Encoding is real.
const adapter=(document:string,dir:string)=>`
import {registerHooks} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
registerHooks({resolve(specifier,context,next){
 if(specifier==='server-only') return {url:'data:text/javascript,export{}',shortCircuit:true};
 try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}
}});
Object.assign(process.env,{R2_ACCOUNT_ID:'local',R2_ACCESS_KEY_ID:'local',R2_SECRET_ACCESS_KEY:'local',R2_BUCKET_NAME:'local',R2_PUBLIC_URL:'https://media.example.test'});
globalThis.fetch=async (url,{signal}={})=>{signal?.throwIfAborted();const name=new URL(String(url)).pathname.slice(1);if(!['watch.mp4','phone.mp4'].includes(name))throw Error('Unexpected asset');return new Response(await readFile(${JSON.stringify(dir)}+'/'+name));};
const {getR2Client}=await import(${JSON.stringify(new URL("./r2.ts",import.meta.url).href)});
getR2Client().send=async command=>{await writeFile(${JSON.stringify(dir)}+'/'+(command.input.Key.endsWith('.mp4')?'output.mp4':'cover.jpg'),command.input.Body);return {};};
const {normalizeVideoTimeline}=await import(${JSON.stringify(new URL("./video-timeline.ts",import.meta.url).href)});
const {renderVideoArtifactDetails}=await import(${JSON.stringify(new URL("./video-renderer.ts",import.meta.url).href)});
const result=await renderVideoArtifactDetails({projectId:'layers-test',sourceUrl:'',labels:[],timeline:normalizeVideoTimeline(JSON.parse(await readFile(${JSON.stringify(document)},'utf8'))),targetKey:'output.mp4'});
await writeFile(${JSON.stringify(join(dir,"result.json"))},JSON.stringify(result));
`;
const footage=(id:string,startMs:number,inMs:number,outMs:number,device:"watch"|"iphone",x:number,volume:number)=>({id,name:id,sourceUrl:`https://media.example.test/${device==='watch'?'watch':'phone'}.mp4`,kind:"video" as const,startMs,inMs,outMs,fit:"contain" as const,x:.5,y:.5,zoom:1,volume,deviceFrame:{device,color:"#171717",background:"#FF00FF",x,y:.5,scale:.7,rotateY:12,motion:"orbit" as const,motionDurationMs:2000}});
const tone=(pcm:Buffer,start:number,seconds:number,frequency:number)=>{
 const samples=Math.round(seconds*48000);let re=0,im=0;
 for(let i=0;i<samples;i++){const sample=pcm.readFloatLE((Math.round(start*48000)+i)*4);const phase=i*frequency/48000*Math.PI*2;re+=sample*Math.cos(phase);im+=sample*Math.sin(phase);}
 return Math.hypot(re,im)/samples;
};
test("production export composites staggered Watch and iPhone layers with independent trim, audio and canvas duration",{skip:!available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-layer-render-"));
 try {
  // Watch changes from red to yellow before its selected trim begins.
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=yellow:size=80x100:rate=30:duration=2,drawbox=color=red:t=fill:enable='lt(t,0.5)'","-f","lavfi","-i","sine=frequency=440:sample_rate=48000:duration=2","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",join(dir,"watch.mp4")]);
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=blue:size=80x100:rate=30:duration=2","-f","lavfi","-i","sine=frequency=880:sample_rate=48000:duration=2","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",join(dir,"phone.mp4")]);
  const layers=[footage("watch",0,500,1500,"watch",.25,.2),footage("phone",500,0,1000,"iphone",.75,.8)];
  const timeline={...emptyTimeline(),aspectRatio:"1:1" as const,layers};
  const document=join(dir,"timeline.json");await writeFile(document,JSON.stringify(timeline));
  const script=join(dir,"render.mjs");await writeFile(script,adapter(document,dir));
  await run(process.execPath,["--experimental-transform-types",script],{maxBuffer:1024*1024});
  assert.equal(JSON.parse(await readFile(join(dir,"result.json"),"utf8")).durationMs,1500);
  const probe=JSON.parse((await run("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_name,width,height","-of","json",join(dir,"output.mp4")])).stdout);
  assert.ok(Math.abs(Number(probe.format.duration)-1.5)<.08);
  assert.ok(probe.streams.some((s:{codec_name:string})=>s.codec_name==="h264"));
  assert.ok(probe.streams.some((s:{codec_name:string})=>s.codec_name==="aac"));
  for(const [time,yellowExpected,blueExpected] of [[.2,true,false],[.7,true,true],[1.2,false,true]] as const) {
   const image=join(dir,`still-${time}.png`);await run("ffmpeg",["-v","error","-y","-ss",String(time),"-i",join(dir,"output.mp4"),"-frames:v","1",image]);
   const {data,info}=await sharp(image).raw().toBuffer({resolveWithObject:true});let yellow=0,blue=0,magenta=0;
   for(let i=0;i<data.length;i+=info.channels){if(data[i]>170&&data[i+1]>170&&data[i+2]<80)yellow++;if(data[i]<70&&data[i+1]<70&&data[i+2]>170)blue++;if(data[i]>150&&data[i+1]<80&&data[i+2]>150)magenta++;}
   assert.equal(yellow>1000,yellowExpected,`Watch screen at ${time}s`);
   assert.equal(blue>1000,blueExpected,`iPhone screen at ${time}s`);
   assert.equal(magenta,0,"device background cannot cover another layer or shared canvas");
   assert.ok(data[0]<20&&data[1]<20&&data[2]<20,"shared canvas survives outside both devices");
  }
  const {stdout:pcm}=await run("ffmpeg",["-v","error","-i",join(dir,"output.mp4"),"-vn","-ac","1","-ar","48000","-f","f32le","pipe:1"],{encoding:"buffer",maxBuffer:1024*1024});
  assert.ok(tone(pcm,.1,.2,440)>.002,"Watch audio is audible before iPhone starts");
  assert.ok(tone(pcm,.1,.2,880)<.0005,"iPhone audio waits for its layer start");
  assert.ok(tone(pcm,.6,.2,880)>tone(pcm,.6,.2,440)*2,"independent volume is preserved");
  assert.ok(tone(pcm,1.1,.2,440)<.0005,"Watch audio stops at its own end");
  assert.ok(tone(pcm,1.1,.2,880)>.005,"iPhone audio continues after Watch ends");
  // Short sequential footage must finish while longer layers keep running.
  const base={...layers[0],id:"base",inMs:0,outMs:300,volume:0,deviceFrame:undefined};
  const secondWatch={...layers[0],id:"second-watch",startMs:500,inMs:500,outMs:1500,volume:0,deviceFrame:{...layers[0].deviceFrame,x:.75,y:.2,scale:.3}};
  await writeFile(document,JSON.stringify({...timeline,background:{color:"#004400"},clips:[base],layers:[...layers,secondWatch],labels:[{id:"headline",text:"Together",x:.5,y:.07,width:.5,height:.12,fontSize:52,textColor:"#FFFFFF",background:"none",startMs:1000,endMs:1500}],music:{...timeline.music,url:layers[1].sourceUrl,volume:0,startMs:1200,endMs:1500}}));
  await run(process.execPath,["--experimental-transform-types",script],{maxBuffer:1024*1024});
  const still=join(dir,"padded.png");await run("ffmpeg",["-v","error","-y","-ss","1.2","-i",join(dir,"output.mp4"),"-frames:v","1",still]);
  const {data:pixels,info}=await sharp(still).raw().toBuffer({resolveWithObject:true});assert.ok(pixels[0]<20&&Math.abs(pixels[1]-68)<10&&pixels[2]<20,"canvas replaces ended sequential footage");
  let white=0,yellowTop=0;
  for(let y=0;y<300;y++)for(let x=0;x<info.width;x++){
   const offset=(y*info.width+x)*info.channels;
   if(pixels[offset]>200&&pixels[offset+1]>200&&pixels[offset+2]>200)white++;
   if(x>650&&pixels[offset]>170&&pixels[offset+1]>170&&pixels[offset+2]<80)yellowTop++;
  }
  assert.ok(white>300,"timed text composites above all device layers");
  assert.ok(yellowTop>300,"another Watch can coexist with the iPhone and original Watch");
 } finally {await rm(dir,{recursive:true,force:true});}
});
