"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoAudioTrack as Sound, VideoTimeline } from "@relay/core";
import { VideoAudioControls, VideoAudioTrack } from "./video-audio-track";
import { beatTimes, snapToBeat } from "../lib/video-edit-operations";
import { decodeAndAnalyzeAudio } from "../lib/video-audio-decoder";
import { waveformPoints, type VideoAudioAnalysisTrack } from "../lib/video-audio-analysis";
import { timelineDuration } from "../lib/video-timeline";

type AnalyzedTimeline = VideoTimeline & {audioAnalysis?:VideoAudioAnalysisTrack[]};
type Props = { timeline: AnalyzedTimeline; timeMs: number; onChange: (timeline: VideoTimeline) => void; onImport?: () => void; onBrowse?: () => void };
export function VideoSoundControls({ timeline, timeMs, onChange, onImport, onBrowse }: Props) {
 const [selectedId,setSelectedId] = useState<string | null>(null), [snapping,setSnapping] = useState(true);
 const latest=useRef(timeline);latest.current=timeline;const cancellation=useRef<AbortController|null>(null);useEffect(()=>()=>cancellation.current?.abort(),[]);
 const [analyzing,setAnalyzing]=useState(false),[analysisError,setAnalysisError]=useState(''),[source,setSource]=useState('');
 const tracks = timeline.audioTracks ?? [], selected = tracks.find(track => track.id === selectedId), total = Math.max(100,timelineDuration(timeline));
 const change = (track: Sound) => onChange({...timeline,audioTracks:track.url ? tracks.map(item => item.id === track.id ? track : item) : tracks.filter(item => item.id !== track.id)});
 const grid = timeline.beatGrid;
 const sources=[...(timeline.music.url?[{url:timeline.music.url,name:timeline.music.name??'Music',startMs:timeline.music.startMs??0,endMs:timeline.music.endMs??total,offsetMs:timeline.music.offsetMs,volume:timeline.music.volume}]:[]),...tracks],chosen=sources.find(t=>t.url===source)??sources[0],analysis=timeline.audioAnalysis?.find(a=>a.sourceUrl===chosen?.url)?.analysis;
 const analyze=async()=>{if(!chosen)return;setAnalyzing(true);setAnalysisError('');const abort=new AbortController();cancellation.current=abort;try{const analysis=await decodeAndAnalyzeAudio(chosen.url,abort.signal);const current=latest.current;if(current.music.url!==chosen.url&&!current.audioTracks?.some(t=>t.url===chosen.url))return;onChange({...current,audioAnalysis:[...(current.audioAnalysis??[]).filter(a=>a.sourceUrl!==chosen.url),{sourceUrl:chosen.url,startMs:chosen.startMs,endMs:chosen.endMs,offsetMs:chosen.offsetMs,volume:chosen.volume,analysis}]} as AnalyzedTimeline);}catch(e){setAnalysisError(e instanceof Error?e.message:'Could not analyze audio.');}finally{setAnalyzing(false);}};

 return <fieldset className="video-sound-controls"><legend>Sound layers</legend>
  <div className="video-edit-actions">
   {onImport && <button type="button" className="secondary-button" disabled={tracks.length >= 12} onClick={onImport}>Import sound</button>}
   {onBrowse && <button type="button" className="secondary-button" disabled={tracks.length >= 12} onClick={onBrowse}>Browse sounds</button>}
   <label className="video-beat-toggle"><input type="checkbox" checked={!!grid} onChange={e => onChange({...timeline,beatGrid:e.target.checked ? {bpm:120,offsetMs:0} : undefined})}/>Show beats</label>
  </div>
  {grid && <div className="video-edit-fields">
   <label>Tempo (BPM)<input type="number" min="20" max="300" step="1" value={grid.bpm} onChange={e => { const bpm=e.target.valueAsNumber; if (Number.isFinite(bpm) && bpm >= 20 && bpm <= 300) onChange({...timeline,beatGrid:{...grid,bpm}}); }}/></label>
   <label>First beat (s)<input type="number" min="0" max="900" step="0.01" value={grid.offsetMs/1000} onChange={e => { const offsetMs=e.target.valueAsNumber*1000; if (Number.isFinite(offsetMs) && offsetMs >= 0 && offsetMs <= 900000) onChange({...timeline,beatGrid:{...grid,offsetMs}}); }}/></label>
   <label className="video-beat-toggle"><input type="checkbox" checked={snapping} onChange={e => setSnapping(e.target.checked)}/>Snap sound to beats</label>
  </div>}
  {!!sources.length&&<details><summary>Analyze music and sound</summary><div className="video-edit-fields"><label>Sound source<select value={chosen?.url??''} onChange={e=>setSource(e.target.value)}>{sources.map((s,i)=><option key={`${s.url}-${i}`} value={s.url}>{s.name}</option>)}</select></label><button type="button" className="secondary-button" disabled={analyzing} onClick={()=>void analyze()}>{analyzing?'Analyzing…':analysis?'Analyze again':'Detect beats and sections'}</button></div>{analysisError&&<p role="alert">{analysisError}</p>}{analysis&&<><svg role="img" aria-label="Analyzed audio waveform" viewBox="0 0 320 64" style={{width:'100%',height:64}}>{waveformPoints(analysis,160).map((p,i)=><line key={i} x1={i*2} x2={i*2} y1={32-p.max*30} y2={32+p.max*30} stroke="currentColor"/>)}</svg><p>{analysis.bpm.toFixed(1)} BPM · {Math.round(analysis.confidence*100)}% rhythm confidence · {analysis.beats.length} beats · {analysis.bars.length} bars · {analysis.drops.length} energy rises · {analysis.quiet.length} quiet sections</p><button type="button" className="secondary-button" disabled={analysis.confidence<.08} onClick={()=>{if(!chosen)return;const period=60000/analysis.bpm,offsetMs=((chosen.startMs+analysis.offsetMs-chosen.offsetMs)%period+period)%period;onChange({...timeline,beatGrid:{bpm:analysis.bpm,offsetMs}});}}>Apply detected beat grid</button>{analysis.confidence<.08&&<p>No reliable pulse detected. Set tempo manually.</p>}<small>Bar markers assume 4/4 time. Energy rises estimate drops; inspect the track before cutting.</small>{!!analysis.drops.length&&<p>Energy rises: {analysis.drops.map(t=>(t/1000).toFixed(1)+'s').join(', ')}</p>}{!!analysis.quiet.length&&<p>Quiet sections: {analysis.quiet.map(q=>`${(q.startMs/1000).toFixed(1)}–${(q.endMs/1000).toFixed(1)}s`).join(', ')}</p>}</>}</details>}
  <div className="video-sound-lanes">
   {!!grid && <div className="video-beat-ruler" aria-label={`Beat grid at ${grid.bpm} beats per minute`}>{beatTimes(grid,total).filter((_,i,all) => i % Math.max(1,Math.ceil(all.length/200)) === 0).map((beat,i) => <span key={beat} style={{left:`${beat/total*100}%`}}>{i%4===0 ? (beat/1000).toFixed(1) : ""}</span>)}</div>}
   {tracks.map(track => <VideoAudioTrack key={track.id} audio={track} total={total} selected={selectedId===track.id} onSelect={() => setSelectedId(track.id)} onChange={audio => change({...track,...audio,startMs:audio.startMs ?? track.startMs,endMs:audio.endMs ?? track.endMs})} snapTime={value => snapToBeat(value,grid,snapping)}/>)}
   {!tracks.length && <p className="video-edit-empty">Add narration, music or a sound cue. Each layer has its own timing, volume and fades.</p>}
  </div>
  {selected && <><VideoAudioControls audio={selected} total={total} onChange={audio => change({...selected,...audio,startMs:audio.startMs ?? selected.startMs,endMs:audio.endMs ?? selected.endMs})}/><button type="button" className="secondary-button" onClick={() => { const startMs=Math.max(0,Math.min(900000-(selected.endMs-selected.startMs),snapToBeat(timeMs,grid,snapping))); change({...selected,startMs,endMs:startMs+selected.endMs-selected.startMs}); }}>Start sound at playhead</button></>}
 </fieldset>;
}
