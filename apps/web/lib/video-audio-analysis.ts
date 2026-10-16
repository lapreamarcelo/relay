/** Serialized source-time analysis: the exact same values drive preview and export. */
export interface VideoAudioFrame { rms: number; peak: number; bass: number; mid: number; treble: number }
export interface VideoAudioAnalysis {
 version: 1; durationMs: number; frameMs: number; frames: VideoAudioFrame[];
 bpm: number; offsetMs: number; confidence: number; beats: number[]; bars: number[];
 drops: number[]; quiet: {startMs:number;endMs:number}[];
}
export interface VideoAudioAnalysisTrack { sourceUrl:string; startMs:number; endMs?:number; offsetMs:number; volume:number; fadeInMs?:number; fadeOutMs?:number; loop?:boolean; analysis:VideoAudioAnalysis }
export type AudioSignal = 'envelope'|'bass'|'mid'|'treble';
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
function spectrum(samples:Float64Array):[number,number,number] {
 const n=samples.length,re=new Float64Array(n),im=new Float64Array(n);
 for(let i=0;i<n;i++){let j=0;for(let k=i,b=n>>1;b;k>>=1,b>>=1)if(k&1)j|=b;re[j]=samples[i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));}
 for(let size=2;size<=n;size*=2)for(let base=0;base<n;base+=size)for(let j=0;j<size/2;j++){const a=-2*Math.PI*j/size,c=Math.cos(a),s=Math.sin(a),i=base+j,k=i+size/2,tr=re[k]*c-im[k]*s,ti=re[k]*s+im[k]*c;re[k]=re[i]-tr;im[k]=im[i]-ti;re[i]+=tr;im[i]+=ti;}
 const bands=[0,0,0],counts=[0,0,0];for(let i=1;i<n/2;i++){const hz=i*8000/n,band=hz<250?0:hz<2000?1:2;bands[band]+=re[i]**2+im[i]**2;counts[band]++;}return bands.map((v,i)=>Math.sqrt(v/Math.max(1,counts[i]))/(n/4)) as [number,number,number];
}
/** PCM input avoids browser/server decoder differences. Work is capped at 15 min, 8 kHz, 50 frames/sec. */
export function analyzeAudioPcm(channels:readonly Float32Array[],sampleRate:number):VideoAudioAnalysis {
 if(!channels.length||channels.length>8||!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw new Error('Unsupported PCM audio.');
 const length=channels[0].length;if(!length||channels.some(c=>c.length!==length)||length/sampleRate>900)throw new Error('Analyze audio between 0 and 15 minutes.');
 const frameMs=20,durationMs=length/sampleRate*1000,frames:VideoAudioFrame[]=[],window=new Float64Array(256);
 for(let t=0;t<durationMs;t+=frameMs){let squares=0,peak=0,count=0;for(let i=0;i<256;i++){const index=Math.floor((t/1000+i/8000)*sampleRate);let v=0;if(index<length){for(const channel of channels){const sample=channel[index];if(!Number.isFinite(sample))throw new Error('PCM samples must be finite.');if(Math.abs(sample)>Math.abs(v))v=sample;}if(i<160){squares+=v*v;peak=Math.max(peak,Math.abs(v));count++;}}window[i]=v;}const [bass,mid,treble]=spectrum(window);frames.push({rms:clamp(Math.sqrt(squares/Math.max(1,count))),peak:clamp(peak),bass:clamp(bass),mid:clamp(mid),treble:clamp(treble)});}
 const onset=frames.map((f,i)=>Math.max(0,f.rms-(frames[i-1]?.rms??f.rms))+.6*Math.max(0,f.bass-(frames[i-1]?.bass??f.bass))),energy=onset.reduce((a,b)=>a+b*b,0);
 let bestLag=25,best=0;for(let lag=13;lag<=75;lag++){let score=0;for(let i=lag;i<onset.length;i++)score+=onset[i]*onset[i-lag];score/=Math.max(1,onset.length-lag);if(score>best){best=score;bestLag=lag;}}
 let phase=0,phaseEnergy=-1;for(let i=0;i<bestLag;i++){let sum=0;for(let j=i;j<onset.length;j+=bestLag)sum+=onset[j];if(sum>phaseEnergy){phaseEnergy=sum;phase=i;}}
 const confidence=energy?clamp(best*onset.length/energy):0,bpm=confidence>.08?60000/(bestLag*frameMs):120,offsetMs=confidence>.08?phase*frameMs:0,period=60000/bpm,beats:number[]=[];
 for(let beat=offsetMs;beat<durationMs;beat+=period)beats.push(Math.min(durationMs,Math.round(beat)));
 const quiet:VideoAudioAnalysis['quiet']=[];let quietStart:number|null=null;const peakRms=Math.max(...frames.map(f=>f.rms)),threshold=Math.max(.008,peakRms*.045);
 for(let i=0;i<=frames.length;i++){if(i<frames.length&&frames[i].rms<threshold){quietStart??=i*frameMs;}else if(quietStart!==null){if(i*frameMs-quietStart>=500)quiet.push({startMs:quietStart,endMs:Math.min(durationMs,i*frameMs)});quietStart=null;}}
 const drops:number[]=[];for(let i=50;i<frames.length-25;i++){let before=0,after=0;for(let j=i-50;j<i;j++)before+=frames[j].rms/50;for(let j=i;j<i+25;j++)after+=frames[j].rms/25;if(onset[i]>Math.max(.005,peakRms*.02)&&after>.08&&after>before*1.8&&after-before>peakRms*.15&&(!drops.length||i*frameMs-drops[drops.length-1]>1500))drops.push(i*frameMs);}
 return {version:1,durationMs,frameMs,frames,bpm:Number(bpm.toFixed(3)),offsetMs,confidence:Number(confidence.toFixed(3)),beats,bars:beats.filter((_,i)=>i%4===0),drops,quiet};
}
export function audioSignalAt(track:VideoAudioAnalysisTrack,timeMs:number,signal:AudioSignal='envelope'):number {
 if(timeMs<track.startMs||(track.endMs!==undefined&&timeMs>=track.endMs))return 0;const analysis=track.analysis,local=timeMs-track.startMs,rawSource=local+track.offsetMs,source=track.loop?rawSource%analysis.durationMs:rawSource;if(source<0||source>=analysis.durationMs)return 0;
 const frame=audioFrameAt(analysis,source),key=signal==='envelope'?'rms':signal;const span=(track.endMs??900000)-track.startMs,fadeIn=track.fadeInMs?Math.min(1,local/Math.min(span,track.fadeInMs)):1,fadeOut=track.fadeOutMs&&track.endMs!==undefined?Math.min(1,(track.endMs-timeMs)/Math.min(span,track.fadeOutMs)):1;return clamp(frame[key]*track.volume*fadeIn*fadeOut);
}
export function audioFrameAt(analysis:VideoAudioAnalysis,sourceMs:number):VideoAudioFrame {
 const zero={rms:0,peak:0,bass:0,mid:0,treble:0};if(sourceMs<0||sourceMs>=analysis.durationMs)return zero;const index=sourceMs/analysis.frameMs,a=analysis.frames[Math.floor(index)],b=analysis.frames[Math.min(analysis.frames.length-1,Math.floor(index)+1)];if(!a||!b)return zero;for(const key of ['rms','peak','bass','mid','treble'] as const)zero[key]=a[key]+(b[key]-a[key])*(index%1);return zero;
}
export function waveformPoints(analysis:VideoAudioAnalysis,count=160):{min:number;max:number;rms:number}[] {const size=Math.max(1,Math.min(1000,Math.round(count)));return Array.from({length:size},(_,i)=>{const slice=analysis.frames.slice(Math.floor(i*analysis.frames.length/size),Math.max(Math.floor(i*analysis.frames.length/size)+1,Math.floor((i+1)*analysis.frames.length/size))),peak=Math.max(0,...slice.map(f=>f.peak));return {min:-peak,max:peak,rms:slice.reduce((a,b)=>a+b.rms,0)/Math.max(1,slice.length)};});}
export function normalizeAudioAnalysisTracks(input:unknown):VideoAudioAnalysisTrack[]|undefined {
 if(input===undefined)return undefined;if(!Array.isArray(input)||input.length>13)throw new Error('Use up to 13 analyzed sound sources.');
 const sources=new Set<string>();const number=(v:unknown,min:number,max:number)=>{if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new Error('Invalid audio analysis value.');return v;};
 return input.map(raw=>{const t=raw as VideoAudioAnalysisTrack;if(!t||typeof t.sourceUrl!=='string'||t.sourceUrl.length>4096||!/^https?:\/\//.test(t.sourceUrl))throw new Error('Audio analysis requires a media URL.');if(sources.has(t.sourceUrl))throw new Error('Analyze each sound source once.');sources.add(t.sourceUrl);if(t.loop!==undefined&&typeof t.loop!=='boolean')throw new Error('Invalid audio loop flag.');const a=t.analysis;if(!a||a.version!==1)throw new Error('Unsupported audio analysis.');const durationMs=number(a.durationMs,1,900000),frameMs=number(a.frameMs,20,1000);if(!Array.isArray(a.frames)||a.frames.length!==Math.ceil(durationMs/frameMs)||a.frames.length>45000)throw new Error('Invalid audio analysis frames.');const frames=a.frames.map(f=>({rms:number(f.rms,0,1),peak:number(f.peak,0,1),bass:number(f.bass,0,1),mid:number(f.mid,0,1),treble:number(f.treble,0,1)}));const markers=(v:unknown)=>{if(!Array.isArray(v)||v.length>45000)throw new Error('Invalid audio markers.');let last=-1;return v.map(x=>{const n=number(x,0,durationMs);if(n<last)throw new Error('Audio markers must be ordered.');last=n;return n;});};if(!Array.isArray(a.quiet)||a.quiet.length>1800)throw new Error('Invalid quiet sections.');return {sourceUrl:t.sourceUrl,startMs:number(t.startMs,0,900000),...(t.endMs===undefined?{}:{endMs:number(t.endMs,t.startMs,900000)}),offsetMs:number(t.offsetMs,0,900000),volume:number(t.volume,0,1),...(t.fadeInMs===undefined?{}:{fadeInMs:number(t.fadeInMs,0,900000)}),...(t.fadeOutMs===undefined?{}:{fadeOutMs:number(t.fadeOutMs,0,900000)}),...(t.loop===undefined?{}:{loop:t.loop}),analysis:{version:1,durationMs,frameMs,frames,bpm:number(a.bpm,20,300),offsetMs:number(a.offsetMs,0,durationMs),confidence:number(a.confidence,0,1),beats:markers(a.beats),bars:markers(a.bars),drops:markers(a.drops),quiet:a.quiet.map(q=>{const startMs=number(q.startMs,0,durationMs),endMs=number(q.endMs,startMs,durationMs);return {startMs,endMs};})}};});
}
/** Refresh source timing/gain from current sound edits without decoding again. */
export function timelineAudioAnalysis(timeline:{audioAnalysis?:VideoAudioAnalysisTrack[];music:{url:string;startMs?:number;endMs?:number;offsetMs:number;volume:number;fadeInMs?:number;fadeOutMs?:number};audioTracks?:{url:string;startMs:number;endMs:number;offsetMs:number;volume:number;fadeInMs?:number;fadeOutMs?:number}[]}):VideoAudioAnalysisTrack[] {
 return (timeline.audioAnalysis??[]).flatMap(track=>{const sounds=timeline.audioTracks?.filter(s=>s.url===track.sourceUrl)??[];if(timeline.music.url===track.sourceUrl)sounds.push({...timeline.music,startMs:timeline.music.startMs??0,endMs:timeline.music.endMs??900000});return sounds.map(sound=>({...track,startMs:sound.startMs,endMs:sound.endMs,offsetMs:sound.offsetMs,volume:sound.volume,fadeInMs:sound.fadeInMs,fadeOutMs:sound.fadeOutMs,loop:true}));});
}

