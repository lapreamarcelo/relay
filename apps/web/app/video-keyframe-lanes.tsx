"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { LayerAnimation, LayerKeyframe, VideoCamera, VideoCameraKeyframe } from "@relay/core";
import "./motion-editor.css";

type Timed = { timeMs: number };
export interface KeyframeLaneProps<T extends Timed> {
  name: string; frames: T[]; durationMs: number; localDurationMs?: number; startMs?: number;
  timeMs?: number; disabled?: boolean; snapMs?: number;
  onChange: (frames: T[]) => void; onSeek?: (globalTime: number) => void; onEdit?: () => void;
}
const clock = (time: number) => `${(time / 1000).toFixed(2)}s`;
/** Preview retiming locally, commit one document change on pointer-up (one undo entry). */
export function KeyframeLane<T extends Timed>({ name, frames, durationMs, localDurationMs = durationMs, startMs = 0, timeMs, disabled, snapMs = 100, onChange, onSeek, onEdit }: KeyframeLaneProps<T>) {
  const [selection, setSelection] = useState<number[]>([]), [draft, setDraft] = useState<T[] | null>(null);
  const [status, setStatus] = useState("");
  const rail = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; origin: number; width: number; indices: number[]; frames: T[]; draft: T[]; changed: boolean } | null>(null);
  const visible = draft ?? frames;
  const selected = selection.filter(index => index < frames.length);
  const commit = (next: T[]) => { onChange(next.sort((a, b) => a.timeMs - b.timeMs)); setSelection([]); };
  const retime = (source: T[], indices: number[], delta: number, snap: boolean) => {
    const minimum = Math.min(...indices.map(index => source[index].timeMs)), maximum = Math.max(...indices.map(index => source[index].timeMs));
    let movement = Math.max(-minimum, Math.min(localDurationMs - maximum, delta));
    if (snap) movement = Math.round((minimum + movement) / snapMs) * snapMs - minimum;
    movement = Math.max(-minimum, Math.min(localDurationMs - maximum, movement));
    const next = source.map((frame, index) => indices.includes(index) ? { ...frame, timeMs: frame.timeMs + movement } : frame);
    if (new Set(next.map(frame => frame.timeMs)).size !== next.length) return source;
    return next;
  };
  const remove = () => { if (selected.length && !disabled) { commit(frames.filter((_, index) => !selected.includes(index))); setStatus(`${selected.length} keyframes deleted`); } };
  const duplicate = () => {
    if (!selected.length || disabled || frames.length + selected.length > 100) return;
    let offset = snapMs;
    while (offset <= localDurationMs && selected.some(index => frames[index].timeMs + offset > localDurationMs || frames.some(frame => frame.timeMs === frames[index].timeMs + offset))) offset += snapMs;
    if (offset > localDurationMs) return setStatus("No free space to duplicate these keyframes.");
    commit([...frames, ...selected.map(index => ({ ...frames[index], timeMs: frames[index].timeMs + offset }))]); setStatus(`${selected.length} keyframes duplicated`);
  };
  const keydown = (event: KeyboardEvent, index?: number) => {
    if (disabled) return;
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); remove(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); event.stopPropagation(); setSelection(frames.map((_, i) => i)); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") { event.preventDefault(); event.stopPropagation(); duplicate(); }
    else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault(); event.stopPropagation();
      const indices = selected.length ? selected : index === undefined ? [] : [index];
      if (indices.length) commit(retime(frames, indices, (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1000 : snapMs), false));
    } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); drag.current = null; setDraft(null); setSelection([]); }
  };
  const down = (event: PointerEvent<HTMLButtonElement>, index: number) => {
    event.stopPropagation();
    const modifier = event.shiftKey || event.metaKey || event.ctrlKey;
    const nextSelection = modifier ? (selected.includes(index) ? selected.filter(i => i !== index) : [...selected, index]) : selected.includes(index) ? selected : [index];
    setSelection(nextSelection); onSeek?.(startMs + frames[index].timeMs); onEdit?.();
    if (disabled || modifier || !nextSelection.length) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, origin: event.clientX, width: rail.current?.getBoundingClientRect().width ?? 1, indices: nextSelection, frames, draft: frames, changed: false };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const transaction = drag.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    const delta = (event.clientX - transaction.origin) / Math.max(1, transaction.width) * durationMs;
    const next = retime(transaction.frames, transaction.indices, delta, !event.altKey);
    transaction.changed = next.some((frame, index) => frame.timeMs !== transaction.frames[index].timeMs);
    transaction.draft = next; setDraft(next);
  };
  const finish = (event: PointerEvent<HTMLButtonElement>, cancel = false) => {
    const transaction = drag.current;
    if (!transaction || transaction.pointerId !== event.pointerId) return;
    drag.current = null; setDraft(null);
    if (!cancel && transaction.changed) { commit(transaction.draft); setStatus(`${transaction.indices.length} keyframes moved`); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div className="motion-keyframe-lane" aria-label={`${name} keyframe lane`} data-testid={`${name.toLowerCase().replaceAll(" ", "-")}-keyframe-lane`} onKeyDown={event => keydown(event)}>
    <div className="motion-lane-heading"><button type="button" className="motion-lane-name" onClick={onEdit}>{name}</button><span>{selected.length ? `${selected.length} selected` : `${frames.length} keys`}</span><button type="button" className="secondary-button" disabled={disabled || !selected.length || frames.length + selected.length > 100} aria-label={`Duplicate ${name.toLowerCase()} selected keyframes`} onClick={duplicate}>Duplicate</button><button type="button" className="secondary-button" disabled={disabled || !selected.length} aria-label={`Delete ${name.toLowerCase()} selected keyframes`} onClick={remove}>Delete</button></div>
    <div className="motion-lane-rail" ref={rail}>
      <div className="motion-lane-span" style={{ left: `${startMs / Math.max(1, durationMs) * 100}%`, width: `${localDurationMs / Math.max(1, durationMs) * 100}%` }}/>
      {timeMs !== undefined && <span className="motion-lane-playhead" style={{ left: `${timeMs / Math.max(1, durationMs) * 100}%` }}/>}
      {visible.map((frame, index) => <button type="button" key={index} className="motion-keyframe-marker" aria-pressed={selected.includes(index)} disabled={disabled} style={{ left: `${(startMs + frame.timeMs) / Math.max(1, durationMs) * 100}%` }} aria-label={`${name} keyframe ${index + 1} at ${clock(frame.timeMs)} local, ${clock(startMs + frame.timeMs)} global`} title={`${clock(frame.timeMs)} local · ${clock(startMs + frame.timeMs)} global`} onPointerDown={event => down(event, index)} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onClick={event => { if (event.detail === 0) { setSelection(event.shiftKey ? [...selected, index] : [index]); onSeek?.(startMs + frame.timeMs); onEdit?.(); } }} onKeyDown={event => keydown(event, index)}>◆</button>)}
    </div>
    <small className="motion-lane-hint">Drag to retime · Shift-click to select · arrows to nudge · Alt-drag skips snapping</small><span className="motion-lane-status" aria-live="polite">{status}</span>
  </div>;
}
export function LayerKeyframeLane({ value, onChange, ...props }: Omit<KeyframeLaneProps<LayerKeyframe>, "frames" | "onChange"> & { value?: LayerAnimation; onChange: (value: LayerAnimation) => void }) {
  return <KeyframeLane {...props} frames={value?.keyframes ?? []} onChange={keyframes => onChange({ ...value, keyframes })}/>;
}
export function CameraKeyframeLane({ value, onChange, ...props }: Omit<KeyframeLaneProps<VideoCameraKeyframe>, "frames" | "onChange" | "name"> & { value: VideoCamera; onChange: (value: VideoCamera) => void }) {
  return <KeyframeLane {...props} name="Camera" frames={value.keyframes ?? []} onChange={keyframes => onChange({ ...value, keyframes })}/>;
}
