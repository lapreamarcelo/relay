import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import sharp from "sharp";
import { emptyTimeline } from "./video-timeline.ts";

const run=promisify(execFile), available=spawnSync("ffmpeg",["-version"],{stdio:"ignore"}).status===0;
const adapter=(dir:string)=>`
import {registerHooks} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
registerHooks({resolve(specifier,context,next){
 if(specifier==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};
 try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}
}});
Object.assign(process.env,{R2_ACCOUNT_ID:'local',R2_ACCESS_KEY_ID:'local',R2_SECRET_ACCESS_KEY:'local',R2_BUCKET_NAME:'local',R2_PUBLIC_URL:'https://media.example.test'});
globalThis.fetch=async(url,{signal}={})=>{signal?.throwIfAborted();return new Response(await readFile(${JSON.stringify(dir)}+'/'+new URL(String(url)).pathname.slice(1)));};
const {getR2Client}=await import(${JSON.stringify(new URL("./r2.ts",import.meta.url).href)});
const uploads=[];
getR2Client().send=async command=>{uploads.push({key:command.input.Key,contentType:command.input.ContentType});await writeFile(${JSON.stringify(dir)}+'/'+command.input.Key,command.input.Body);return {};};
const {normalizeVideoTimeline}=await import(${JSON.stringify(new URL("./video-timeline.ts",import.meta.url).href)});
const {renderVideoArtifactDetails,sourceAudioTempo}=await import(${JSON.stringify(new URL("./video-renderer.ts",import.meta.url).href)});
if(sourceAudioTempo(.25)!=='atempo=0.5,atempo=0.5,'||sourceAudioTempo(4)!=='atempo=2,atempo=2,')throw Error('Tempo chain');
const result=await renderVideoArtifactDetails({projectId:'advanced-test',sourceUrl:'',labels:[],timeline:normalizeVideoTimeline(JSON.parse(await readFile(${JSON.stringify(join(dir,"timeline.json"))},'utf8'))),targetKey:'output.mp4'});
await writeFile(${JSON.stringify(join(dir,"result.json"))},JSON.stringify({result,uploads}));
`;
const clip={id:"source",name:"Demo",sourceUrl:"https://media.example.test/source.mp4",kind:"video" as const,inMs:0,outMs:1000,fit:"cover" as const,x:.5,y:.5,zoom:1,volume:0};
const tone=(pcm:Buffer,start:number,frequency:number)=>{let re=0,im=0;const n=4800;for(let i=0;i<n;i++){const sample=pcm.readFloatLE((Math.round(start*48000)+i)*4),phase=i*frequency/48000*Math.PI*2;re+=sample*Math.cos(phase);im+=sample*Math.sin(phase);}return Math.hypot(re,im)/n;};

test("production renderer exports source-speed pointer and held frames with independent sound layers",{skip:!available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-advanced-render-"));
 try {
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=red:size=320x320:rate=60:duration=1,drawbox=color=blue:t=fill:enable='gte(t,0.5)'","-f","lavfi","-i","sine=frequency=330:sample_rate=48000:duration=1","-c:v","libx264","-pix_fmt","yuv420p","-c:a","aac",join(dir,"source.mp4")]);
  for (const frequency of [220,440,880]) await run("ffmpeg",["-v","error","-y","-f","lavfi","-i",`sine=frequency=${frequency}:sample_rate=48000:duration=1`,join(dir,`${frequency}.wav`)]);
  const pointer={events:[{timeMs:0,x:.15,y:.5,kind:"move"},{timeMs:1000,x:.8,y:.5,kind:"move"}],style:"touch",display:"continuous",color:"#00FF00",size:80,smoothing:0,idleMs:0,fadeMs:0};
  const timeline={...emptyTimeline(),aspectRatio:"1:1",exportSettings:{format:"mp4",fps:60,resolution:"720p",quality:"standard"},clips:[{...clip,speed:2,pointer},{...clip,id:"held",inMs:0,outMs:500,freezeMs:800}],music:{...emptyTimeline().music,url:"https://media.example.test/220.wav",volume:.8},audioTracks:[{id:"a",url:"https://media.example.test/440.wav",name:"First",startMs:0,endMs:500,offsetMs:0,volume:.5,fadeInMs:0,fadeOutMs:0},{id:"b",url:"https://media.example.test/880.wav",name:"Second",startMs:500,endMs:1000,offsetMs:0,volume:.8,fadeInMs:0,fadeOutMs:0}]};
  await writeFile(join(dir,"timeline.json"),JSON.stringify(timeline));await writeFile(join(dir,"render.mjs"),adapter(dir));
  await run(process.execPath,["--experimental-transform-types",join(dir,"render.mjs")],{maxBuffer:1024*1024,timeout:30000});
  const {result,uploads}=JSON.parse(await readFile(join(dir,"result.json"),"utf8"));assert.equal(result.durationMs,1000);assert.equal(uploads[0].contentType,"video/mp4");
  const probe=JSON.parse((await run("ffprobe",["-v","error","-show_entries","format=duration:stream=width,height,r_frame_rate","-of","json",join(dir,"output.mp4")])).stdout);
  assert.ok(probe.streams.some((s:{width:number;height:number;r_frame_rate:string})=>s.width===720&&s.height===720&&s.r_frame_rate==="60/1"));
  assert.ok(Math.abs(Number(probe.format.duration)-1)<.05);
  const states=[];
  for (const time of [.1,.3,.6,.85]) {
   const file=join(dir,`sample-${time}.png`);await run("ffmpeg",["-v","error","-y","-ss",String(time),"-i",join(dir,"output.mp4"),"-frames:v","1",file]);
   const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true});let green=0,sum=0;
   for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*info.channels;if(data[i]<80&&data[i+1]>150&&data[i+2]<80){green++;sum+=x;}}
   states.push({centerX:sum/green,red:data[0],blue:data[2],green});
  }
  assert.ok(Math.abs(states[0].centerX-(.15+.65*.2)*720)<12,`pointer time follows accelerated source ${JSON.stringify(states)}`);
  assert.ok(Math.abs(states[1].centerX-(.15+.65*.6)*720)<12,`pointer scrubbing/export uses source time ${JSON.stringify(states)}`);
  assert.ok(states[0].red>170&&states[0].blue<80);assert.ok(states[1].blue>170&&states[1].red<80);
  for(const held of states.slice(2)){assert.ok(held.blue>170&&held.red<80);assert.equal(held.green,0);}
  const {stdout:pcm}=await run("ffmpeg",["-v","error","-i",join(dir,"output.mp4"),"-vn","-ac","1","-ar","48000","-f","f32le","pipe:1"],{encoding:"buffer",maxBuffer:1024*1024});
  assert.ok(tone(pcm,.1,330)<.001,"muted source footage is silent even while the video plays at double speed");
  assert.ok(tone(pcm,.1,220)>.02,"the song still plays over muted source footage");
  assert.ok(tone(pcm,.7,220)>.02,"the song continues over later muted clips");
  assert.ok(tone(pcm,.1,440)>.01);assert.ok(tone(pcm,.1,880)<.001);
  assert.ok(tone(pcm,.7,880)>.02);assert.ok(tone(pcm,.7,440)<.001);
  assert.ok(tone(pcm,.7,330)<.001,"held footage does not continue source audio");
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("production video export renders animated color emoji without host emoji fonts",{skip:!available,timeout:60000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-emoji-render-"));
 try{
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=black:size=80x80:rate=24:duration=1","-c:v","libx264","-pix_fmt","yuv420p",join(dir,"source.mp4")]);
  const timeline={...emptyTimeline(),aspectRatio:"1:1",clips:[clip],labels:[{id:"emoji",text:"🚀 👍🏽 👨‍👩‍👧‍👦 🇪🇸 ❤️",x:.5,y:.5,width:.85,height:.12,fontSize:100,font:"modern",textColor:"#FFFFFF",background:"none",style:"outline",startMs:0,endMs:1000,animation:{entrance:{preset:"letter-rise",durationMs:300}}}],exportSettings:{format:"mp4",fps:24,resolution:"720p",quality:"draft"}};
  await writeFile(join(dir,"timeline.json"),JSON.stringify(timeline));await writeFile(join(dir,"render.mjs"),adapter(dir));
  await run(process.execPath,["--experimental-transform-types",join(dir,"render.mjs")],{maxBuffer:1024*1024,timeout:30000});
  const file=join(dir,"emoji.png");await run("ffmpeg",["-v","error","-y","-ss","0.7","-i",join(dir,"output.mp4"),"-frames:v","1",file]);
  const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true});let colored=0;
  for(let i=0;i<data.length;i+=info.channels)if(Math.max(...data.subarray(i,i+3))-Math.min(...data.subarray(i,i+3))>70)colored++;
  assert.ok(colored>5000,`export preserves color emoji sequences (${colored} colored pixels)`);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("production export supports WebM GIF PNG and JPEG with correct content types and cover frames",{skip:!available,timeout:180000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-export-formats-"));
 try{
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=red:size=80x80:rate=24:duration=0.3","-c:v","libx264","-pix_fmt","yuv420p",join(dir,"source.mp4")]);
  await writeFile(join(dir,"render.mjs"),adapter(dir));
  for(const [format,extension,contentType] of [["webm","webm","video/webm"],["gif","gif","image/gif"],["png","png","image/png"],["jpeg","jpg","image/jpeg"]]){
   const timeline={...emptyTimeline(),aspectRatio:"1:1",clips:[{...clip,outMs:250}],exportSettings:{format,fps:24,resolution:"720p",quality:"draft"},coverMs:100,audioTracks:[{id:"sound",url:"https://media.example.test/source.mp4",name:"silent placeholder",startMs:0,endMs:250,offsetMs:0,volume:0,fadeInMs:0,fadeOutMs:0}]};
   // Include a real audio input to exercise connected sound pads in image exports.
   await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","sine=frequency=440:sample_rate=48000:duration=0.3",join(dir,"tone.wav")]);
   timeline.audioTracks[0].url="https://media.example.test/tone.wav";
   await writeFile(join(dir,"timeline.json"),JSON.stringify(timeline));
   await run(process.execPath,["--experimental-transform-types",join(dir,"render.mjs")],{maxBuffer:1024*1024,timeout:30000});
   const {result,uploads}=JSON.parse(await readFile(join(dir,"result.json"),"utf8"));assert.equal(uploads[0].key,`output.${extension}`);assert.equal(uploads[0].contentType,contentType);assert.ok(result.coverUrl.endsWith(".jpg"));
   if(format==="webm"){const probe=JSON.parse((await run("ffprobe",["-v","error","-show_entries","stream=codec_name,r_frame_rate","-of","json",join(dir,`output.${extension}`)])).stdout);assert.ok(probe.streams.some((s:{codec_name:string})=>s.codec_name==="vp9"));assert.ok(probe.streams.some((s:{codec_name:string})=>s.codec_name==="opus"));}
   else {const image=await sharp(join(dir,`output.${extension}`)).metadata();assert.equal(image.width,720);assert.equal(image.height,720);}
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});


test("production mesh and animated text accept spring and custom curve camera graphs",{skip:!available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-curve-render-"));
 try{
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=blue:size=80x100:rate=24:duration=0.3","-c:v","libx264","-pix_fmt","yuv420p",join(dir,"source.mp4")]);
  const timeline={...emptyTimeline(),aspectRatio:"1:1",clips:[{...clip,outMs:250,deviceFrame:{device:"iphone",color:"#171717",background:"#000000",renderMode:"mesh",scale:.65,animation:{keyframes:[{timeMs:0,rotateY:-30,x:.4,easing:"spring",curve:{stiffness:140,damping:16,mass:1}},{timeMs:250,rotateY:25,x:.6}]}}}],camera:{zoom:1,x:.5,y:.5,keyframes:[{timeMs:0,zoom:1,easing:"cubic-bezier",curve:{controlPoints:[.2,.4,.8,1]}},{timeMs:250,zoom:1.2}]},scene:{version:1,environment:"softbox",exposure:1,roughness:.3,metallic:.8,shadow:.3,lightAngle:-30,focusDepth:0,aperture:.1,motionBlur:0,camera:{x:0,y:0,z:0,rotateX:0,rotateY:0,rotateZ:0,focalLength:50,keyframes:[{timeMs:0,rotateY:0,easing:"spring",curve:{stiffness:120,damping:12,mass:1}},{timeMs:250,rotateY:10}]}},labels:[{id:"text",text:"Motion",x:.5,y:.1,width:.8,fontSize:44,font:"modern",textColor:"#FFFFFF",background:"none",startMs:0,endMs:250,animation:{entrance:{preset:"word-spring",durationMs:100,easing:"spring",curve:{stiffness:150,damping:12,mass:1},staggerMs:20}}}],graphics:[{id:"ring",kind:"ring",x:.8,y:.7,width:.1,height:.1,color:"#FF0000",startMs:0,endMs:250,count:4,seed:1,speed:1}],exportSettings:{format:"mp4",fps:24,resolution:"720p",quality:"draft"}};
  await writeFile(join(dir,"timeline.json"),JSON.stringify(timeline));await writeFile(join(dir,"render.mjs"),adapter(dir));
  await run(process.execPath,["--experimental-transform-types",join(dir,"render.mjs")],{maxBuffer:1024*1024,timeout:90000});
  const probe=JSON.parse((await run("ffprobe",["-v","error","-count_frames","-show_entries","stream=nb_read_frames,width,height","-of","json",join(dir,"output.mp4")])).stdout);
  assert.ok(probe.streams.some((s:{width:number;nb_read_frames:string})=>s.width===720&&Number(s.nb_read_frames)>=5));
  assert.equal(JSON.parse(await readFile(join(dir,"result.json"),"utf8")).result.durationMs,250);
 }finally{await rm(dir,{recursive:true,force:true});}
});


test("mesh Duo routes outer pointer cues only to the visible rear cover display",{skip:!available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-duo-pointer-render-"));
 try{
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=blue:size=100x160:rate=24:duration=0.3","-c:v","libx264","-pix_fmt","yuv420p",join(dir,"source.mp4")]);
  const pointer={events:[{timeMs:0,x:.5,y:.5,kind:"move",screen:"outer"}],style:"touch",display:"continuous",color:"#00FF00",size:100,smoothing:0,idleMs:0,fadeMs:0};
  const deviceFrame={device:"iphone-duo",color:"#171717",background:"#000000",renderMode:"mesh",scale:.9,foldAngle:0};
  const timeline={...emptyTimeline(),aspectRatio:"1:1",clips:[{...clip,outMs:250,pointer,deviceFrame:{...deviceFrame,rotateY:0}},{...clip,id:"rear",outMs:250,pointer,deviceFrame:{...deviceFrame,rotateY:180}}],exportSettings:{format:"mp4",fps:24,resolution:"720p",quality:"draft"}};
  await writeFile(join(dir,"timeline.json"),JSON.stringify(timeline));await writeFile(join(dir,"render.mjs"),adapter(dir));
  await run(process.execPath,["--experimental-transform-types",join(dir,"render.mjs")],{maxBuffer:1024*1024,timeout:90000});
  const green=[];
  for(const time of [.1,.35]){const file=join(dir,`sample-${time}.png`);await run("ffmpeg",["-v","error","-y","-ss",String(time),"-i",join(dir,"output.mp4"),"-frames:v","1",file]);const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true});let count=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]<80&&data[i+1]>150&&data[i+2]<80)count++;green.push(count);}
  assert.equal(green[0],0,"outer cues never leak to front inner halves");assert.ok(green[1]>50,`rear screen displays its outer cue: ${green[1]}`);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("depth sorting retains each layer's original decoded source input",{skip:!available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-depth-render-"));
 try{
  for(const [name,color] of [["source.mp4","blue"],["red.mp4","red"]]) await run("ffmpeg",["-v","error","-y","-f","lavfi","-i",`color=${color}:size=80x100:rate=24:duration=0.3`,"-c:v","libx264","-pix_fmt","yuv420p",join(dir,name)]);
  const device={device:"watch",color:"#171717",background:"#000000",renderMode:"mesh",scale:.7};
  const timeline={...emptyTimeline(),aspectRatio:"1:1",layers:[{...clip,id:"front",sourceUrl:"https://media.example.test/red.mp4",startMs:0,outMs:250,deviceFrame:{...device,depth:.3}},{...clip,id:"back",startMs:0,outMs:250,deviceFrame:{...device,depth:-.3}}],exportSettings:{format:"mp4",fps:24,resolution:"720p",quality:"draft"}};
  await writeFile(join(dir,"timeline.json"),JSON.stringify(timeline));await writeFile(join(dir,"render.mjs"),adapter(dir));
  await run(process.execPath,["--experimental-transform-types",join(dir,"render.mjs")],{maxBuffer:1024*1024,timeout:30000});
  const file=join(dir,"sample.png");await run("ffmpeg",["-v","error","-y","-ss","0.1","-i",join(dir,"output.mp4"),"-frames:v","1",file]);
  const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true}),center=(360*info.width+360)*info.channels;
  assert.ok(data[center]>170&&data[center+2]<80,"red front layer keeps its source after depth reorder");
 }finally{await rm(dir,{recursive:true,force:true});}
});

test("static and animated text scale with output resolution from the canonical canvas",{skip:!available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-text-resolution-render-"));
 try{
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=blue:size=80x80:rate=24:duration=0.3","-c:v","libx264","-pix_fmt","yuv420p",join(dir,"source.mp4")]);
  await writeFile(join(dir,"render.mjs"),adapter(dir));
  for(const animated of [false,true]){
   const bounds=[];
   for(const resolution of ["720p","1080p"]){
    const timeline={...emptyTimeline(),aspectRatio:"1:1",clips:[{...clip,outMs:250}],labels:[{id:"text",text:"MMM",x:.5,y:.15,width:.7,fontSize:60,font:"modern",textColor:"#FFFFFF",background:"none",startMs:0,endMs:250,...(animated?{animation:{entrance:{preset:"fade",durationMs:100}}}:{})}],exportSettings:{format:"mp4",fps:24,resolution,quality:"high"}};
    await writeFile(join(dir,"timeline.json"),JSON.stringify(timeline));
    await run(process.execPath,["--experimental-transform-types",join(dir,"render.mjs")],{maxBuffer:1024*1024,timeout:30000});
    const file=join(dir,"sample.png");await run("ffmpeg",["-v","error","-y","-ss","0.17","-i",join(dir,"output.mp4"),"-frames:v","1",file]);
    const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true});let minX=info.width,maxX=0,minY=info.height,maxY=0;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){const i=(y*info.width+x)*info.channels;if(data[i]>220&&data[i+1]>220&&data[i+2]>220){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
    bounds.push({width:maxX-minX+1,height:maxY-minY+1});
   }
   assert.ok(bounds[0].height>10);
   assert.ok(Math.abs(bounds[0].height/bounds[1].height-2/3)<.06,`${animated?'animated':'static'} font height scales: ${JSON.stringify(bounds)}`);
   assert.ok(Math.abs(bounds[0].width/bounds[1].width-2/3)<.04,`${animated?'animated':'static'} text width scales: ${JSON.stringify(bounds)}`);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});


test("multi-second mesh pointer export finishes all frames through finite source EOF",{skip:!available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-long-pointer-render-"));
 try{
  await run("ffmpeg",["-v","error","-y","-f","lavfi","-i","color=blue:size=80x100:rate=24:duration=5.2","-c:v","libx264","-pix_fmt","yuv420p",join(dir,"source.mp4")]);
  const pointer={events:[{timeMs:0,x:.5,y:.5,kind:"move"},{timeMs:1000,x:.5,y:.5,kind:"down"},{timeMs:1150,x:.5,y:.5,kind:"up"},{timeMs:3600,x:.5,y:.5,kind:"down"},{timeMs:3750,x:.5,y:.5,kind:"up"}],style:"touch",display:"tap-only",color:"#00FF00",size:80,smoothing:0,idleMs:0,fadeMs:0};
  const timeline={...emptyTimeline(),aspectRatio:"1:1",clips:[{...clip,outMs:5000,pointer,deviceFrame:{device:"iphone",color:"#171717",background:"#000000",renderMode:"mesh",scale:.65,animation:{keyframes:[{timeMs:0,x:.42,rotateY:-18,rotateX:-3,rotateZ:-4},{timeMs:5000,x:.58,rotateY:18,rotateX:3,rotateZ:4}]}}}],scene:{version:1,environment:"softbox",exposure:1,roughness:.4,metallic:.5,shadow:.2,lightAngle:-30,focusDepth:0,aperture:0,motionBlur:0,camera:{x:0,y:0,z:0,rotateX:0,rotateY:0,rotateZ:0,focalLength:50,keyframes:[{timeMs:0,scale:1,x:0},{timeMs:5000,scale:1.03,x:.01}]}},exportSettings:{format:"mp4",fps:24,resolution:"720p",quality:"draft"}};
  await writeFile(join(dir,"timeline.json"),JSON.stringify(timeline));await writeFile(join(dir,"render.mjs"),adapter(dir));
  await run(process.execPath,["--experimental-transform-types",join(dir,"render.mjs")],{maxBuffer:1024*1024,timeout:90000});
  const probe=JSON.parse((await run("ffprobe",["-v","error","-count_frames","-show_entries","format=duration:stream=codec_type,nb_read_frames","-of","json",join(dir,"output.mp4")])).stdout);
  assert.ok(Math.abs(Number(probe.format.duration)-5)<.08);
  assert.equal(Number(probe.streams.find((s:{codec_type:string})=>s.codec_type==="video").nb_read_frames),120);
  for(const time of [1.05,3.65]){const file=join(dir,`sample-${time}.png`);await run("ffmpeg",["-v","error","-y","-ss",String(time),"-i",join(dir,"output.mp4"),"-frames:v","1",file]);const {data,info}=await sharp(file).raw().toBuffer({resolveWithObject:true});let green=0;for(let i=0;i<data.length;i+=info.channels)if(data[i]<80&&data[i+1]>150&&data[i+2]<80)green++;assert.ok(green>50,`pointer cue survives at ${time}s`);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
