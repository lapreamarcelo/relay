import { mkdtemp,readFile,writeFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { TimedVideoLabel,VideoTimeline } from "@relay/core";
import { command,download } from "./video-renderer";
export async function transcribeTimeline(timeline:VideoTimeline,signal:AbortSignal,onProgress:(p:number)=>Promise<void>):Promise<TimedVideoLabel[]>{
 const key=process.env.OPENAI_API_KEY;if(!key)throw new Error("Set OPENAI_API_KEY on the renderer to enable automatic captions.");
 const dir=await mkdtemp(join(tmpdir(),"relay-captions-"));
 try{
  const segments:string[]=[];
  for(let i=0;i<timeline.clips.length;i++){
   signal.throwIfAborted();const clip=timeline.clips[i];const source=join(dir,`source-${i}`),output=join(dir,`audio-${i}.wav`);let hasAudio=false;
   if(clip.kind==="video"){await writeFile(source,await download(clip.sourceUrl,500*1024*1024));const probe=JSON.parse(await command("ffprobe",["-v","error","-show_entries","stream=codec_type","-of","json",source],signal));hasAudio=probe.streams?.some((s:{codec_type:string})=>s.codec_type==="audio")??false;}
   await command("ffmpeg",["-y",...(hasAudio?["-ss",String(clip.inMs/1000),"-i",source]:["-f","lavfi","-i","anullsrc=r=16000:cl=mono"]),"-t",String((clip.outMs-clip.inMs)/1000),"-vn","-ac","1","-ar","16000","-c:a","pcm_s16le",output],signal);segments.push(output);await onProgress(Math.round((i+1)/timeline.clips.length*60));
  }
  const list=join(dir,"list.txt");await writeFile(list,segments.map(s=>`file '${s}'`).join("\n"));const output=join(dir,"speech.mp3");await command("ffmpeg",["-y","-f","concat","-safe","0","-i",list,"-c:a","libmp3lame","-b:a","64k",output],signal);
  const bytes=await readFile(output);if(bytes.length>25*1024*1024)throw new Error("Audio exceeds transcription upload limit.");
  const form=new FormData();form.set("file",new Blob([new Uint8Array(bytes)],{type:"audio/mpeg"}),"speech.mp3");form.set("model","whisper-1");form.set("response_format","verbose_json");form.append("timestamp_granularities[]","segment");
  await onProgress(70);
  const response=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${key}`},body:form,signal:AbortSignal.any([signal,AbortSignal.timeout(240000)])});
  if(!response.ok)throw new Error(`Transcription provider returned HTTP ${response.status}.`);
  const data=await response.json() as {segments?:Array<{text:string;start:number;end:number}>};
  const segmentsOut=data.segments?.filter(s=>s.text?.trim()&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start)??[];
  if(segmentsOut.length>200)throw new Error("Transcription has over 200 segments; split the project into shorter videos.");
  return segmentsOut.map(s=>({id:crypto.randomUUID(),text:s.text.trim().slice(0,500),startMs:Math.round(s.start*1000),endMs:Math.round(s.end*1000),x:.5,y:.78,width:.84,height:.12,fontSize:52,font:"modern",textColor:"#FFFFFF",background:"dark",backgroundColor:"#000000",style:"dark"}));
 }finally{await rm(dir,{recursive:true,force:true});}
}
