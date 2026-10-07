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
// Storage and HTTP are isolated; production decode, encoding and pixels are real.
const adapter=(dir:string,expectedError?:string)=>`
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
registerHooks({resolve(specifier,context,next){
 if(specifier==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};
 try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}
}});
Object.assign(process.env,{R2_ACCOUNT_ID:'local',R2_ACCESS_KEY_ID:'local',R2_SECRET_ACCESS_KEY:'local',R2_BUCKET_NAME:'local',R2_PUBLIC_URL:'https://media.example.test/library'});
const reads=[];
globalThis.fetch=async(url,options={})=>{
 options.signal?.throwIfAborted();assert.equal(options.redirect,'error');
 const parsed=new URL(String(url));assert.equal(parsed.origin,'https://media.example.test');assert.ok(parsed.pathname.startsWith('/library/'));
 const name=parsed.pathname.slice('/library/'.length);reads.push(name);
 if(name==='too-large.png')return new Response('x',{headers:{'content-length':String(31*1024*1024)}});
 return new Response(await readFile(${JSON.stringify(dir)}+'/'+name));
};
const {getR2Client}=await import(${JSON.stringify(new URL("./r2.ts",import.meta.url).href)});
getR2Client().send=async command=>{await writeFile(${JSON.stringify(dir)}+'/'+(command.input.Key.endsWith('.mp4')?'output.mp4':'cover.jpg'),command.input.Body);return {};};
const {normalizeVideoTimeline}=await import(${JSON.stringify(new URL("./video-timeline.ts",import.meta.url).href)});
const {renderVideoArtifactDetails}=await import(${JSON.stringify(new URL("./video-renderer.ts",import.meta.url).href)});
const render=async()=>renderVideoArtifactDetails({projectId:'background-test',sourceUrl:'',labels:[],timeline:normalizeVideoTimeline(JSON.parse(await readFile(${JSON.stringify(join(dir,"timeline.json"))},'utf8'))),targetKey:'output.mp4'});
${expectedError ? `await assert.rejects(render,new RegExp(${JSON.stringify(expectedError)}));` : `const result=await render();await writeFile(${JSON.stringify(join(dir,"result.json"))},JSON.stringify(result));`}
await writeFile(${JSON.stringify(join(dir,"reads.json"))},JSON.stringify(reads));
`;
const source={id:"screen",name:"App",sourceUrl:"https://media.example.test/library/screen.png",kind:"image" as const,inMs:0,outMs:1000,fit:"cover" as const,x:.5,y:.5,zoom:1,volume:0};
const background={color:"#FF00FF",imageUrl:"https://media.example.test/library/background.png",imageFit:"contain" as const};
async function execute(dir:string,timeline:unknown,expectedError?:string) {
 await writeFile(join(dir,"timeline.json"),JSON.stringify(timeline));
 await writeFile(join(dir,"render.mjs"),adapter(dir,expectedError));
 await run(process.execPath,["--experimental-transform-types",join(dir,"render.mjs")],{maxBuffer:1024*1024});
}
async function fixture(dir:string) {
 await writeFile(join(dir,"screen.png"),await sharp({create:{width:80,height:160,channels:3,background:"#FFFF00"}}).png().toBuffer());
 await writeFile(join(dir,"background.png"),await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><path fill="#FF0000" d="M0 0h100v100H0z"/><path fill="#00FF00" d="M100 0h100v100H100z"/><path fill="#0000FF" d="M200 0h100v100H200z"/></svg>')).png().toBuffer());
}
async function pixels(dir:string,time:number) {
 const image=join(dir,`still-${time}.png`);
 await run("ffmpeg",["-v","error","-y","-ss",String(time),"-i",join(dir,"output.mp4"),"-frames:v","1",image]);
 const {data,info}=await sharp(image).removeAlpha().raw().toBuffer({resolveWithObject:true});
 return (x:number,y:number)=>[...data.subarray((y*info.width+x)*info.channels,(y*info.width+x)*info.channels+3)];
}
function near(actual:number[],expected:number[]) { for(let i=0;i<3;i++)assert.ok(Math.abs(actual[i]-expected[i])<20,`${actual} expected ${expected}`); }

test("production layer-only export centers a contain background behind an independently tilted iPhone",{skip:!available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-image-canvas-"));
 try {
  await fixture(dir);
  await execute(dir,{...emptyTimeline(),aspectRatio:"1:1",background,layers:[{...source,startMs:0,deviceFrame:{device:"iphone",background:"#000000",color:"#171717",scale:.6,rotateY:20}}]});
  const pixel=await pixels(dir,.4);
  near(pixel(20,20),[255,0,255]);
  near(pixel(100,540),[255,0,0]);near(pixel(980,540),[0,0,255]);
  near(pixel(540,540),[255,255,0]);
  const reads=JSON.parse(await readFile(join(dir,"reads.json"),"utf8"));
  assert.equal(reads.filter((name:string)=>name==="background.png").length,1);
  assert.equal(JSON.parse(await readFile(join(dir,"result.json"),"utf8")).durationMs,1000);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test("production sequential export reuses a centered cover image during footage and after footage ends",{skip:!available,timeout:120000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-image-tail-"));
 try {
  await fixture(dir);
  await execute(dir,{...emptyTimeline(),aspectRatio:"1:1",background:{...background,imageFit:"cover"},clips:[{...source,outMs:500,deviceFrame:{device:"iphone",background:"#000000",color:"#171717",scale:.6}}],layers:[{...source,id:"watch",startMs:800,outMs:400,deviceFrame:{device:"watch",background:"#000000",color:"#171717",scale:.4}}]});
  const first=await pixels(dir,.2),gap=await pixels(dir,.65),last=await pixels(dir,1);
  for(const pixel of [first,gap,last])near(pixel(30,30),[0,255,0]);
  near(first(540,540),[255,255,0]);near(gap(540,540),[0,255,0]);near(last(540,540),[255,255,0]);
  const reads=JSON.parse(await readFile(join(dir,"reads.json"),"utf8"));
  assert.equal(reads.filter((name:string)=>name==="background.png").length,1,"one background download across segments and tail");
  assert.equal(JSON.parse(await readFile(join(dir,"result.json"),"utf8")).durationMs,1200);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test("production background validation rejects outside-library URLs, nonimages and unbounded inputs before encoding",{timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"relay-image-validation-"));
 try {
  await writeFile(join(dir,"not-image.png"),Buffer.from('This is not an image'));
  await writeFile(join(dir,"animated.gif"),await sharp(Buffer.concat([Buffer.alloc(10*10*3,0),Buffer.alloc(10*10*3,255)]),{raw:{width:10,height:20,channels:3,pageHeight:10}}).gif({delay:[100,100],loop:0}).toBuffer());
  await writeFile(join(dir,"vector.svg"),'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>');
  await writeFile(join(dir,"large.svg"),'<svg xmlns="http://www.w3.org/2000/svg" width="7000" height="6000"><rect width="7000" height="6000" fill="red"/></svg>');
  const base={...emptyTimeline(),aspectRatio:"1:1",clips:[source]};
  for(const [imageUrl,error,downloads] of [
   ["https://outside.example/background.png","Relay R2 library",0],
   ["https://media.example.test/library-neighbor/background.png","Relay R2 library",0],
   ["https://media.example.test/library/not-image.png","valid background image",1],
   ["https://media.example.test/library/too-large.png","size limit",1],
   ["https://media.example.test/library/large.svg","valid background image",1],
   ["https://media.example.test/library/animated.gif","Use a still image",1],
   ["https://media.example.test/library/vector.svg","Choose a PNG",1],
  ] as const) {
   await execute(dir,{...base,background:{color:"#000000",imageUrl}},error);
   assert.equal(JSON.parse(await readFile(join(dir,"reads.json"),"utf8")).length,downloads);
  }
 } finally {await rm(dir,{recursive:true,force:true});}
});
