import {mediaPreviewUrl} from "./browser-library-media";
import {analyzeAudioPcm,type VideoAudioAnalysis} from './video-audio-analysis';
/** Client-only decoding; never executes remote code. No credentialed cross-origin fetch. */
export async function decodeAndAnalyzeAudio(url:string,signal?:AbortSignal):Promise<VideoAudioAnalysis> {
 let response:Response;
 try{response=await fetch(url,{signal,credentials:'omit'});}catch(error){
  if(signal?.aborted)throw error;
  if(!url.startsWith('https:')||new URL(url).origin===location.origin)throw error;
  response=await fetch(mediaPreviewUrl(url),{signal,credentials:'same-origin'});
 }if(!response.ok)throw new Error('Could not download audio for analysis.');if(Number(response.headers.get('content-length'))>100*1024*1024)throw new Error('Audio analysis supports files up to 100 MB.');
 let bytes:ArrayBuffer;if(response.body){const reader=response.body.getReader(),chunks:Uint8Array[]= [];let size=0;try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>100*1024*1024){await reader.cancel();throw new Error('Audio analysis supports files up to 100 MB.');}chunks.push(value);}}finally{reader.releaseLock();}const merged=new Uint8Array(size);let at=0;for(const chunk of chunks){merged.set(chunk,at);at+=chunk.length;}bytes=merged.buffer;}else{bytes=await response.arrayBuffer();if(bytes.byteLength>100*1024*1024)throw new Error('Audio analysis supports files up to 100 MB.');}const context=new AudioContext();try{const buffer=await context.decodeAudioData(bytes);if(signal?.aborted)throw new Error('Analysis cancelled.');if(buffer.duration>900)throw new Error('Analyze audio between 0 and 15 minutes.');return await analyzeAudioPcmAsync(Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i).slice()),buffer.sampleRate,signal);}finally{await context.close();}
}

/** PCM work runs off the editor UI thread; all workers are terminated on completion/cancel. */
export async function analyzeAudioPcmAsync(channels:Float32Array[],sampleRate:number,signal?:AbortSignal):Promise<VideoAudioAnalysis> {
 if(typeof Worker==='undefined')return analyzeAudioPcm(channels,sampleRate);
 return new Promise((resolve,reject)=>{const worker=new Worker(new URL('./video-audio-analysis-worker.ts',import.meta.url),{type:'module'});const finish=()=>{worker.terminate();signal?.removeEventListener('abort',abort);},abort=()=>{finish();reject(new Error('Analysis cancelled.'));};worker.onmessage=(event:MessageEvent<{analysis?:VideoAudioAnalysis;error?:string}>)=>{finish();if(event.data.analysis)resolve(event.data.analysis);else reject(new Error(event.data.error??'Audio analysis failed.'));};worker.onerror=()=>{finish();reject(new Error('Audio analysis worker could not start.'));};signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted){abort();return;}worker.postMessage({channels,sampleRate},channels.map(c=>c.buffer as ArrayBuffer));});
}
