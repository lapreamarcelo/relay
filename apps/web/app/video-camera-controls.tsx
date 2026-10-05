"use client";

import type { AnimationEasing, VideoCamera, VideoCameraKeyframe } from "@relay/core";
import { Crosshair, Plus, RotateCcw, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { animationEasings } from "../lib/video-animation";
import { defaultVideoCamera, videoCameraPreset, videoCameraPresets, videoCameraState } from "../lib/video-camera";

type Pose = { zoom: number; x: number; y: number };
const clock = (time: number) => (time / 1000).toFixed(2);
const cameraRecordTime = (frames: VideoCameraKeyframe[], timeMs: number) => frames.some(frame => frame.timeMs === timeMs) ? timeMs : Math.round(timeMs);
/** Static controls update the base pose; animated controls record at the global playhead. */
export function changeCameraPose(camera: VideoCamera | undefined, timeMs: number, patch: Partial<Pose>): VideoCamera {
  const value = camera ?? defaultVideoCamera;
  if (!value.keyframes?.length) return { ...value, ...patch };
  const time = cameraRecordTime(value.keyframes, timeMs), existing = value.keyframes.find(frame => frame.timeMs === time);
  if (!existing && value.keyframes.length >= 100) return value;
  const next = { ...videoCameraState(value, time), ...existing, ...patch, timeMs: time };
  return { ...value, keyframes: [...value.keyframes.filter(frame => frame.timeMs !== time), next].sort((a, b) => a.timeMs - b.timeMs) };
}

export function VideoCameraControls({ value, timeMs, durationMs, disabled, picking, onPick, onChange, onSeek }: {
  value?: VideoCamera; timeMs: number; durationMs: number; disabled?: boolean; picking: boolean;
  onPick: () => void; onChange: (camera?: VideoCamera) => void; onSeek: (time: number) => void;
}) {
  const camera = value ?? defaultVideoCamera, pose = videoCameraState(camera, timeMs), frames = camera.keyframes ?? [];
  const time = cameraRecordTime(frames, timeMs), atLimit = frames.length >= 100 && !frames.some(frame => frame.timeMs === time);
  const update = (patch: Partial<Pose>) => onChange(changeCameraPose(camera, timeMs, patch));
  const capture = () => {
    if (atLimit) return;
    if (frames.length) return update({});
    onChange({ ...camera, keyframes: time > 0 ? [{ timeMs: 0, ...pose }, { timeMs: time, ...pose, easing: "ease-in-out" }] : [{ timeMs: 0, ...pose, easing: "ease-in-out" }] });
  };
  const edit = (index: number, patch: Partial<VideoCameraKeyframe>) => {
    if (patch.timeMs !== undefined && frames.some((frame, row) => row !== index && frame.timeMs === patch.timeMs)) return;
    onChange({ ...camera, keyframes: frames.map((frame, row) => row === index ? { ...frame, ...patch } : frame).sort((a, b) => a.timeMs - b.timeMs) });
  };
  return <section className="video-camera-controls" aria-label="Camera & focus">
    <div className="device-demo-heading"><b><Crosshair size={14}/> Camera & focus</b><small>{pose.zoom.toFixed(2)}×</small></div>
    <p>Magnify the scene to highlight your app. Device frames move with the camera; text stays in place.</p>
    <div className="video-camera-actions">
      <button className="secondary-button" aria-label="Camera zoom out" disabled={disabled || atLimit || pose.zoom <= 1} onClick={() => update({ zoom: Math.max(1, Math.round((pose.zoom - .25) * 100) / 100) })}><ZoomOut size={14}/></button>
      <button className="secondary-button" aria-label="Camera zoom in" disabled={disabled || atLimit || pose.zoom >= 4} onClick={() => update({ zoom: Math.min(4, Math.round((pose.zoom + .25) * 100) / 100) })}><ZoomIn size={14}/></button>
      <button className="secondary-button" disabled={disabled || atLimit} aria-pressed={picking} onClick={onPick}><Crosshair size={14}/>{picking ? "Cancel picking" : "Pick focus"}</button>
      <button className="secondary-button" aria-label="Reset camera" disabled={disabled} onClick={() => onChange(undefined)}><RotateCcw size={14}/>Reset</button>
    </div>
    {(["zoom", "x", "y"] as const).map(key => <label className="video-camera-slider" key={key}>{key === "zoom" ? "Camera zoom" : key === "x" ? "Camera focus horizontal" : "Camera focus vertical"}<input aria-label={key === "zoom" ? "Camera zoom" : key === "x" ? "Camera focus horizontal" : "Camera focus vertical"} type="range" min={key === "zoom" ? 1 : 0} max={key === "zoom" ? 4 : 1} step={.01} value={pose[key]} disabled={disabled || atLimit} onChange={event => update({ [key]: Number(event.target.value) })}/><output>{key === "zoom" ? `${pose[key].toFixed(2)}×` : `${Math.round(pose[key] * 100)}%`}</output></label>)}
    <div className="video-camera-presets">{videoCameraPresets.map(preset => <button className="secondary-button" disabled={disabled} key={preset} onClick={() => onChange(videoCameraPreset(preset, durationMs, { ...pose, zoom: Math.max(2, pose.zoom) }))}>{preset === "zoom-in" ? "Zoom in" : preset === "zoom-out" ? "Zoom out" : "Focus & return"}</button>)}</div>
    <small>{frames.length ? `Controls record a keyframe at ${clock(time)}s.` : "Apply a motion preset, or capture poses to animate your own move."}</small>
    <button className="secondary-button video-camera-capture" disabled={disabled || atLimit} onClick={capture}><Plus size={14}/>Capture camera at playhead</button>
    {atLimit && <small role="status">100 keyframes reached. Select an existing keyframe to edit it.</small>}
    {!!frames.length && <details className="video-camera-keyframes"><summary>Camera keyframes <span>{frames.length} / 100</span></summary><ol>{frames.map((frame, index) => {
      const state = videoCameraState(camera, frame.timeMs);
      return <li key={index}><div className="video-camera-frame-heading"><button className="secondary-button" aria-label={`Go to camera keyframe ${index + 1}`} onClick={() => onSeek(frame.timeMs)}>{clock(frame.timeMs)}s · {state.zoom.toFixed(2)}×</button><button className="icon-button danger" aria-label={`Delete camera keyframe ${index + 1}`} onClick={() => onChange({ ...camera, keyframes: frames.filter((_, row) => row !== index) })}><Trash2 size={13}/></button></div><div className="video-camera-frame-fields"><label>Time (ms)<input aria-label={`Camera keyframe ${index + 1} time`} type="number" min={0} max={durationMs} step={100} value={frame.timeMs} onChange={event => edit(index, { timeMs: Math.round(Math.max(0, Math.min(durationMs, Number(event.target.value)))) })}/></label>{(["zoom", "x", "y"] as const).map(key => <label key={key}>{key === "zoom" ? "Zoom" : key === "x" ? "Focus X" : "Focus Y"}<input aria-label={`Camera keyframe ${index + 1} ${key}`} type="number" min={key === "zoom" ? 1 : 0} max={key === "zoom" ? 4 : 1} step={.01} value={state[key]} onChange={event => edit(index, { [key]: Math.max(key === "zoom" ? 1 : 0, Math.min(key === "zoom" ? 4 : 1, Number(event.target.value))) })}/></label>)}<label>Easing<select aria-label={`Camera keyframe ${index + 1} easing`} value={frame.easing ?? "linear"} onChange={event => edit(index, { easing: event.target.value as AnimationEasing })}>{animationEasings.map(easing => <option key={easing}>{easing}</option>)}</select></label></div></li>;
    })}</ol></details>}
  </section>;
}

export function VideoCameraTrack({ value, durationMs, onSeek, onEdit }: { value?: VideoCamera; durationMs: number; onSeek: (time: number) => void; onEdit: () => void }) {
  if (!value) return null;
  return <div className="timeline-camera-lane" aria-label="Camera track"><button className="timeline-camera-name" onClick={onEdit}><Crosshair size={11}/>Camera</button>{value.keyframes?.map((frame, index) => <button key={index} className="timeline-camera-keyframe" style={{ left: `${frame.timeMs / Math.max(1, durationMs) * 100}%` }} aria-label={`Camera keyframe at ${clock(frame.timeMs)} seconds`} title={`${clock(frame.timeMs)}s`} onClick={() => { onSeek(frame.timeMs); onEdit(); }}>◆</button>)}</div>;
}
