"use client";

import { useRef, useState } from "react";
import type { VideoTimeline } from "@relay/core";
import { Music2, Trash2 } from "lucide-react";

type Audio = VideoTimeline["music"];
type Props = { audio: Audio; total: number; selected: boolean; onSelect: () => void; onChange: (audio: Audio) => void };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function VideoAudioControls({ audio, total, onChange }: Pick<Props, "audio" | "total" | "onChange">) {
 const start = Math.min(audio.startMs ?? 0, Math.max(0, total - 100));
 const end = Math.max(start + 100, Math.min(audio.endMs ?? total, total));
 const timing = (key: "startMs" | "endMs" | "offsetMs" | "fadeInMs" | "fadeOutMs", value: number) => {
  if (!Number.isFinite(value)) return;
  const ms = Math.round(value * 1000);
  onChange({ ...audio, startMs: start, endMs: end, [key]: key === "startMs" ? clamp(ms, 0, end - 100) : key === "endMs" ? clamp(ms, start + 100, total) : clamp(ms, 0, key === "offsetMs" ? 3600000 : end - start) });
 };
 return <div className="video-trim-controls video-audio-controls" aria-label="Audio timeline controls">
  <b><Music2 size={14}/> {audio.name || "Audio track"}</b>
  <label>Audio starts at (s)<input type="number" min="0" max={(end - 100) / 1000} step="0.1" value={start / 1000} onChange={e => timing("startMs", e.target.valueAsNumber)}/></label>
  <label>Audio ends at (s)<input type="number" min={(start + 100) / 1000} max={total / 1000} step="0.1" value={end / 1000} onChange={e => timing("endMs", e.target.valueAsNumber)}/></label>
  <label>Trim audio from (s)<input type="number" min="0" max="3600" step="0.1" value={audio.offsetMs / 1000} onChange={e => timing("offsetMs", e.target.valueAsNumber)}/></label>
  <label>Audio volume<input type="range" min="0" max="1" step="0.01" value={audio.volume} onChange={e => onChange({ ...audio, volume: Number(e.target.value) })}/></label>
  <label>Fade in (s)<input type="number" min="0" max={(end - start) / 1000} step="0.1" value={audio.fadeInMs / 1000} onChange={e => timing("fadeInMs", e.target.valueAsNumber)}/></label>
  <label>Fade out (s)<input type="number" min="0" max={(end - start) / 1000} step="0.1" value={audio.fadeOutMs / 1000} onChange={e => timing("fadeOutMs", e.target.valueAsNumber)}/></label>
  <button className="secondary-button" onClick={() => onChange({ ...audio, url: "", name: undefined })}><Trash2/>Remove audio</button>
  <small>Drag the track to move it; drag its edges to trim. Short tracks repeat to fill this range.</small>
 </div>;
}

export function VideoAudioTrack({ audio, total, selected, onSelect, onChange }: Props) {
 const [draft, setDraft] = useState<Audio | null>(null);
 const lane = useRef<HTMLDivElement>(null);
 const drag = useRef<{ x: number; start: number; end: number; width: number; mode: "move" | "start" | "end" } | null>(null);
 const shown = draft ?? audio;
 const start = Math.min(shown.startMs ?? 0, total);
 const end = Math.min(shown.endMs ?? total, total);
 const commit = () => { if (draft) onChange(draft); drag.current = null; setDraft(null); };
 if (end <= start) return <div className="video-audio-lane"><button className="secondary-button" onClick={() => { onChange({ ...audio, startMs: 0, endMs: Math.min(total, Math.max(100, (audio.endMs ?? total) - (audio.startMs ?? 0))) }); onSelect(); }}>Audio outside video · Move to start</button></div>;
 return <div className="video-audio-lane" ref={lane}>
  <button type="button" aria-label={`Edit audio: ${audio.name || "Audio track"}`} aria-pressed={selected} className={`video-audio-block ${selected ? "selected" : ""}`} style={{ left: `${start / Math.max(1, total) * 100}%`, width: `${Math.max(0, end - start) / Math.max(1, total) * 100}%` }}
   onClick={onSelect}
   onPointerDown={e => { if (!total) return; onSelect(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, start, end, width: lane.current?.getBoundingClientRect().width || 1, mode: (e.target as HTMLElement).dataset.edge as "start" | "end" || "move" }; }}
   onPointerMove={e => { const d = drag.current; if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return; const delta = Math.round((e.clientX - d.x) / d.width * total / 100) * 100; const nextStart = d.mode === "end" ? d.start : clamp(d.start + delta, d.mode === "start" ? Math.max(0, d.start - audio.offsetMs) : 0, d.mode === "start" ? Math.min(d.end - 100, d.start + 3600000 - audio.offsetMs) : total - (d.end - d.start)); const nextEnd = d.mode === "move" ? nextStart + d.end - d.start : d.mode === "start" ? d.end : clamp(d.end + delta, d.start + 100, total); setDraft({ ...audio, startMs: nextStart, endMs: nextEnd, offsetMs: d.mode === "start" ? audio.offsetMs + nextStart - d.start : audio.offsetMs }); }}
   onPointerUp={commit} onPointerCancel={() => { drag.current = null; setDraft(null); }}
   onKeyDown={e => { if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return; e.preventDefault(); const nextStart = clamp(start + (e.key === "ArrowRight" ? 100 : -100), 0, total - (end - start)); onChange({ ...audio, startMs: nextStart, endMs: nextStart + end - start }); }}>
   <span className="video-audio-edge" data-edge="start"/><Music2 size={14}/><span>{audio.name || "Audio track"} · {((end - start) / 1000).toFixed(1)}s</span><span className="video-audio-edge end" data-edge="end"/>
  </button>
 </div>;
}
