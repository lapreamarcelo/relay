import {analyzeAudioPcm} from './video-audio-analysis';
const scope=self as unknown as {onmessage:((event:MessageEvent<{channels:Float32Array[];sampleRate:number}>)=>void)|null;postMessage:(message:unknown)=>void};
scope.onmessage=event=>{try{scope.postMessage({analysis:analyzeAudioPcm(event.data.channels,event.data.sampleRate)});}catch(error){scope.postMessage({error:error instanceof Error?error.message:'Audio analysis failed.'});}};
