import "server-only";
import type {VideoTimeline} from "@relay/core";
import {chromium} from "playwright";
import {spawn} from "node:child_process";
import {readFile,access} from "node:fs/promises";
import {join} from "node:path";
import sharp from "sharp";
import {deviceModels} from "./device-model-catalog";

async function publicRoot(){for(const path of [join(process.cwd(),"public"),join(process.cwd(),"apps/web/public")])try{await access(join(path,"renderer/scene.js"));return path;}catch{}throw new Error("3D renderer bundle is missing. Run the Relay web build before exporting.");}

/** Local-only browser rendering: supplied library bytes and bundled assets are
 * the only reachable URLs. No project URL is navigated or executed. */
export async function renderGpuScene(timeline:VideoTimeline,width:number,height:number,fps:number,durationMs:number,output:string,media:Map<string,Buffer>,signal?:AbortSignal,onProgress?:(fraction:number)=>Promise<void>){
  signal?.throwIfAborted();const root=await publicRoot();
  const origin="http://relay-gpu.local",assets=new Map<string,Buffer>(),urls=new Map<string,string>(),copy=structuredClone(timeline);
  for(const clip of [...copy.clips,...(copy.layers??[])])if(clip.deviceFrame?.renderMode==="gpu"){
    const data=media.get(clip.sourceUrl);if(!data)throw new Error("3D scene input was not downloaded from the media library.");let key=urls.get(clip.sourceUrl);if(!key){key=`/media/${assets.size}`;urls.set(clip.sourceUrl,key);assets.set(key,data);}clip.sourceUrl=origin+key;
  }
  const files=new Set(["/renderer/scene.js","/devices/draco/draco_decoder.wasm","/devices/draco/draco_wasm_wrapper.js","/devices/draco/draco_decoder.js",...deviceModels.flatMap(m=>"file"in m?[`/devices/${m.file}`]:[])]);
  const browser=await chromium.launch({headless:true,args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"],...(process.env.RELAY_CHROMIUM_EXECUTABLE?{executablePath:process.env.RELAY_CHROMIUM_EXECUTABLE}:{})}).catch(()=>{throw new Error("3D export needs Chromium. Run pnpm --filter @relay/web exec playwright install chromium on the render host.");});
  const abort=()=>{void browser.close();};signal?.addEventListener("abort",abort,{once:true});
  if(signal?.aborted){await browser.close();signal.throwIfAborted();}
  const deadline=setTimeout(abort,Math.max(900000,durationMs*30+60000));
  const encoder=spawn("ffmpeg",["-v","error","-y","-threads","2","-f","rawvideo","-pixel_format","rgba","-video_size",`${width}x${height}`,"-framerate",String(fps),"-i","pipe:0","-c:v","qtrle","-pix_fmt","argb",output],{stdio:["pipe","ignore","pipe"],signal,timeout:Math.max(900000,durationMs*30+60000)});
  let stderr="";encoder.stderr.on("data",c=>{stderr=(stderr+String(c)).slice(-2000);});encoder.stdin.on("error",()=>{});
  const done=new Promise<void>((resolve,reject)=>{encoder.once("error",reject);encoder.once("close",code=>code===0?resolve():reject(new Error(`3D frame encoding failed: ${stderr}`)));});void done.catch(()=>{});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(60000);
    await page.route("**/*",async route=>{
      const url=new URL(route.request().url());if(url.origin!==origin){await route.abort();return;}
      if(url.pathname==="/"){await route.fulfill({contentType:"text/html",body:"<!doctype html><body style='margin:0'>"});return;}
      let data=assets.get(url.pathname),mime="application/octet-stream";
      if(!data&&files.has(url.pathname)){data=await readFile(join(root,url.pathname));mime=url.pathname.endsWith(".js")?"application/javascript":url.pathname.endsWith(".wasm")?"application/wasm":"model/gltf-binary";}
      if(!data){await route.abort();return;}
      const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
      if(range){const start=Number(range[1]),end=Math.min(data.length-1,range[2]?Number(range[2]):data.length-1);if(start> end){await route.fulfill({status:416,headers:{"Content-Range":`bytes */${data.length}`}});return;}await route.fulfill({status:206,contentType:mime,headers:{"Accept-Ranges":"bytes","Content-Range":`bytes ${start}-${end}/${data.length}`},body:data.subarray(start,end+1)});}
      else await route.fulfill({contentType:mime,headers:{"Accept-Ranges":"bytes"},body:data});
    });
    await page.goto(origin);await page.addScriptTag({url:origin+"/renderer/scene.js"});
    await page.evaluate(async ({timeline,width,height})=>{await (window as unknown as {relayGpu:{prepare(t:VideoTimeline,w:number,h:number):Promise<void>}}).relayGpu.prepare(timeline,width,height);},{timeline:copy,width,height});
    const count=Math.ceil(durationMs/1000*fps);let reported=-1;
    for(let frame=0;frame<count;frame++){
      signal?.throwIfAborted();
      const png=await page.evaluate(async time=>(window as unknown as {relayGpu:{frame(t:number):Promise<string>}}).relayGpu.frame(time),frame/fps*1000);
      const pixels=await sharp(Buffer.from(png,"base64")).ensureAlpha().raw().toBuffer();
      await new Promise<void>((resolve,reject)=>encoder.stdin.write(pixels,error=>error?reject(error):resolve()));
      const progress=Math.floor((frame+1)/count*20);if(progress!==reported){reported=progress;await onProgress?.((frame+1)/count);}
    }
    encoder.stdin.end();await done;
  }catch(error){encoder.kill("SIGTERM");await done.catch(()=>{});throw error;}
  finally{clearTimeout(deadline);signal?.removeEventListener("abort",abort);await browser.close();}
}
