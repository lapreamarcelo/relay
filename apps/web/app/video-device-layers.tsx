import { useRef } from "react";
import type { VideoClip, VideoLayer, VideoTimeline } from "@relay/core";
import { Copy, FolderOpen, Layers, Plus, Trash2, Upload } from "lucide-react";
import { layerSchedule } from "../lib/video-timeline";
import { deviceScene } from "../lib/device-motion";
import { DeviceFramePreview } from "./device-frame-controls";

export function VideoDeviceLayers({ timeline, selected, source, time, onChange, onSelect, onMedia, onUpload }: {
  timeline: VideoTimeline; selected: string; source?: VideoClip; time: number;
  onChange: (timeline: VideoTimeline) => void; onSelect: (id: string, time?: number) => void;
  onMedia: () => void; onUpload: () => void;
}) {
  const layers = timeline.layers ?? [];
  const layer = layers.find(item => item.id === selected);
  const add = () => {
    if (!source || layers.length >= 12) return;
    const { transition: _transition, ...recording } = source;
    const next: VideoLayer = { ...recording, id: crypto.randomUUID(), name: `${source.name} layer`, startMs: Math.min(899900, Math.round(time)), volume: 0, deviceFrame: { ...(source.deviceFrame ?? { device: "iphone", color: "#1D1D1F", background: "#E8E2D8" }), x: .65, y: .5, scale: .6 } };
    next.outMs = Math.min(next.outMs,next.inMs+900000-next.startMs);
    onChange({ ...timeline, layers: [...layers, next] }); onSelect(next.id);
  };
  const update = (patch: Partial<VideoLayer>) => layer && onChange({ ...timeline, layers: layers.map(item => item.id === layer.id ? { ...item, ...patch } : item) });
  const reorder = (direction: number) => {
    if (!layer) return; const index = layers.indexOf(layer), target = index + direction;
    if (target < 0 || target >= layers.length) return;
    const next = [...layers]; [next[index], next[target]] = [next[target], next[index]];
    onChange({ ...timeline, layers: next });
  };
  return <section className="video-device-layers" aria-label="Device layers">
    <div className="device-demo-heading"><b><Layers size={14}/> Device layers</b><small>{layers.length} / 12</small></div>
    <p>Show several devices together. Each layer has its own recording, placement and animation. Copies start muted; adjust Source volume to enable their audio.</p>
    <div className="video-layer-add-actions">
      <button className="secondary-button" disabled={!source || layers.length >= 12} onClick={add}><Plus/>Layer selected footage</button>
      <button className="secondary-button" disabled={layers.length >= 12} onClick={onMedia}><FolderOpen/>Layer from Media</button>
      <button className="secondary-button" disabled={layers.length >= 12} onClick={onUpload}><Upload/>Upload layer</button>
    </div>
    {layers.length > 0 && <ol className="video-layer-list" aria-label="Device stacking order">
      {[...layers].reverse().map((item, index) => <li key={item.id}><button aria-pressed={selected === item.id} onClick={() => onSelect(item.id, item.startMs)}><span>{layers.length - index}</span><b>{item.name}</b><small>{item.deviceFrame?.device ?? "Media"} · {(item.startMs / 1000).toFixed(2)}s</small></button></li>)}
    </ol>}
    {layer && <div className="video-layer-edit" aria-label="Selected device layer">
      <label>Layer name<input aria-label="Layer name" maxLength={120} value={layer.name} onChange={event => update({ name: event.target.value })}/></label>
      <label>Appears at (ms)<input aria-label="Layer start time" type="number" min={0} max={900000 - (layer.outMs-layer.inMs)} step={100} value={layer.startMs} onChange={event => update({ startMs: Math.round(Math.max(0, Math.min(900000-(layer.outMs-layer.inMs), Number(event.target.value)))) })}/></label>
      <small>Source: {layer.sourceUrl.split("/").at(-1)}. Trim and screen crop in the timeline below; device motion above.</small>
      <div className="video-layer-actions">
        <button className="secondary-button" disabled={layers.indexOf(layer) === layers.length - 1} onClick={() => reorder(1)}>Bring forward</button>
        <button className="secondary-button" disabled={layers.indexOf(layer) === 0} onClick={() => reorder(-1)}>Send backward</button>
        <button className="secondary-button" disabled={layers.length >= 12} onClick={() => { const duplicate = { ...layer, id: crypto.randomUUID(), name: `${layer.name} copy`, volume: 0, deviceFrame: layer.deviceFrame ? { ...layer.deviceFrame, x: Math.min(.9, (layer.deviceFrame.x ?? .5) + .12) } : undefined }; onChange({ ...timeline, layers: [...layers, duplicate] }); onSelect(duplicate.id); }}><Copy/>Duplicate layer</button>
        <button className="secondary-button" onClick={() => { onChange({ ...timeline, layers: layers.filter(item => item.id !== layer.id) }); onSelect(""); }}><Trash2/>Remove layer</button>
      </div>
    </div>}
  </section>;
}

export function VideoDeviceLayerPreview({ timeline, time, playing, width, height, selected, onSelect, onChange }: {
  timeline: VideoTimeline; time: number; playing: boolean; width: number; height: number; selected: string;
  onSelect: (id: string) => void; onChange: (id: string, dx: number, dy: number) => void;
}) {
  const drag = useRef({ x: 0, y: 0 });
  return <div className="video-device-layer-stage">{layerSchedule(timeline).filter(entry => time >= entry.startMs && time < entry.endMs).map(entry => {
    const c = entry.clip, local = time - entry.startMs;
    const scene = c.deviceFrame ? deviceScene(width, height, c.deviceFrame, local, c.outMs-c.inMs) : undefined;
    const corners = scene?.panels.filter(panel => panel.visible).flatMap(panel => panel.corners) ?? [];
    const left = corners.length ? Math.min(...corners.map(point => point.x)) / width : 0;
    const top = corners.length ? Math.min(...corners.map(point => point.y)) / height : 0;
    const right = corners.length ? Math.max(...corners.map(point => point.x)) / width : 1;
    const bottom = corners.length ? Math.max(...corners.map(point => point.y)) / height : 1;
    return <div key={c.id} className="video-device-layer" data-layer-preview={c.id} data-layer-start={entry.startMs}>
      <DeviceFramePreview transparent advanced value={c.deviceFrame} width={width} height={height} timeMs={local} durationMs={c.outMs-c.inMs} sourceTimeMs={c.inMs+local} playing={playing} sourceVolume={c.volume}>
        {c.kind === "video" ? <video src={c.sourceUrl} playsInline preload="auto" style={{ objectFit:c.fit, objectPosition:`${c.x*100}% ${c.y*100}%`, transform:c.fit === "cover" ? `scale(${c.zoom})` : undefined, transformOrigin:`${c.x*100}% ${c.y*100}%` }}/> : <img src={c.sourceUrl} alt={c.name} style={{ objectFit:c.fit, objectPosition:`${c.x*100}% ${c.y*100}%`, transform:c.fit === "cover" ? `scale(${c.zoom})` : undefined, transformOrigin:`${c.x*100}% ${c.y*100}%` }}/>}
      </DeviceFramePreview>
      {(!scene || (scene.opacity > .01 && corners.length > 0)) && <button aria-label={`Select device layer: ${c.name}`} className={`video-layer-hit-area ${selected === c.id ? "selected" : ""}`} style={{ left:`${left*100}%`, top:`${top*100}%`, width:`${(right-left)*100}%`, height:`${(bottom-top)*100}%` }} onClick={() => onSelect(c.id)} onPointerDown={event => { event.stopPropagation(); drag.current = { x:event.clientX, y:event.clientY }; event.currentTarget.setPointerCapture(event.pointerId); onSelect(c.id); }} onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const bounds = event.currentTarget.parentElement!.getBoundingClientRect(); onChange(c.id,(event.clientX-drag.current.x)/bounds.width,(event.clientY-drag.current.y)/bounds.height); drag.current={x:event.clientX,y:event.clientY}; }}/>} 
    </div>;
  })}</div>;
}

export function VideoDeviceLayerTracks({ timeline, total, selected, onSelect }: { timeline: VideoTimeline; total: number; selected: string; onSelect:(id:string,time:number)=>void }) {
  return <div className="timeline-device-lanes" aria-label="Device layer tracks">{[...layerSchedule(timeline)].reverse().map(entry => <div className="timeline-device-lane" key={entry.clip.id}><button aria-label={`Layer track: ${entry.clip.name}`} className={selected === entry.clip.id ? "selected" : ""} style={{ left:`${entry.startMs/Math.max(1,total)*100}%`, width:`${(entry.endMs-entry.startMs)/Math.max(1,total)*100}%` }} onClick={() => onSelect(entry.clip.id,entry.startMs)}><Layers size={12}/><b>{entry.clip.name}</b><small>{((entry.endMs-entry.startMs)/1000).toFixed(2)}s</small></button></div>)}</div>;
}
