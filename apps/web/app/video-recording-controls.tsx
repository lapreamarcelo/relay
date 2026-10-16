"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoPointerEvent, VideoPointerTrack } from "@relay/core";
import { appendRecordingEvent, importRecordingEvents, MAX_RECORDING_BYTES, MAX_RECORDING_MS, recordingMimeType, recordingPointerEvent, uploadRecording, type RecordingAsset } from "../lib/video-recording";

type Take = { file: File; previewUrl: string; durationMs: number; pointer?: VideoPointerTrack };
export interface VideoRecordingControlsProps {
  onCaptured: (asset: RecordingAsset) => void | Promise<void>;
  onImportPointer?: (pointer: VideoPointerTrack) => void;
  /** Canvas capture is exact; unrelated screen shares cannot expose OS gesture events. */
  captureCanvas?: HTMLCanvasElement | null;
}

export function VideoRecordingControls({ onCaptured, onImportPointer, captureCanvas }: VideoRecordingControlsProps) {
  const [status, setStatus] = useState<"idle" | "choosing" | "recording" | "uploading">("idle");
  const [take, setTake] = useState<Take>();
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [withAudio, setWithAudio] = useState(false);
  const [supported, setSupported] = useState(false);
  const [importedEvents, setImportedEvents] = useState<number>();
  const active = useRef<MediaRecorder | null>(null);
  const mounted = useRef(true);
  const cleanup = useRef<() => void>(() => {});
  const preview = useRef<HTMLVideoElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    mounted.current = true;
    setSupported(typeof navigator.mediaDevices?.getDisplayMedia === "function" && typeof MediaRecorder !== "undefined");
    return () => { mounted.current = false; if (active.current?.state !== "inactive") active.current?.stop(); cleanup.current(); };
  }, []);
  const takeUrl = take?.previewUrl;
  useEffect(() => () => { if (takeUrl) URL.revokeObjectURL(takeUrl); }, [takeUrl]);
  const busy = status !== "idle";
  const stop = () => { if (active.current?.state === "recording") active.current.stop(); };
  const start = async (canvas = false) => {
    if (busy || active.current) return;
    setError(""); setStatus("choosing");
    let stream: MediaStream | undefined;
    try {
      if (typeof MediaRecorder === "undefined") throw new Error("This browser cannot record video. Import a recording instead.");
      stream = canvas && captureCanvas ? captureCanvas.captureStream(30) : await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: withAudio });
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const mimeType = recordingMimeType(mime => MediaRecorder.isTypeSupported(mime));
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 6_000_000 });
      const chunks: Blob[] = [], events: VideoPointerEvent[] = [];
      let bytes = 0, overflow = false, startedAt = 0, finished = false;
      const target = canvas ? captureCanvas : null;
      const collect = (event: PointerEvent) => {
        if (!startedAt || !target || !event.isPrimary) return;
        const kind = event.type === "pointerdown" ? "down" : event.type === "pointerup" || event.type === "pointercancel" ? "up" : "move";
        const sample = recordingPointerEvent(kind, event.clientX, event.clientY, target.getBoundingClientRect(), performance.now() - startedAt);
        if (sample) appendRecordingEvent(events, sample);
      };
      const eventNames = ["pointermove", "pointerdown", "pointerup", "pointercancel"] as const;
      const timer = window.setInterval(() => { if (startedAt && mounted.current) setElapsed(Math.min(MAX_RECORDING_MS, performance.now() - startedAt)); }, 200);
      const limit = window.setTimeout(stop, MAX_RECORDING_MS);
      cleanup.current = () => {
        window.clearInterval(timer); window.clearTimeout(limit);
        eventNames.forEach(name => target?.removeEventListener(name, collect));
        stream?.getTracks().forEach(track => track.stop());
      };
      recorder.onstart = () => { startedAt = performance.now(); if (mounted.current) { setElapsed(0); setStatus("recording"); } };
      recorder.ondataavailable = event => {
        bytes += event.data.size;
        if (bytes > MAX_RECORDING_BYTES) { overflow = true; stop(); return; }
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => { overflow = true; if (mounted.current) setError("Recording failed. Try another browser or import a video."); stop(); };
      recorder.onstop = () => {
        if (finished) return; finished = true;
        const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
        cleanup.current(); active.current = null;
        if (!mounted.current) return;
        setStatus("idle");
        if (overflow) { setError("The recording could not be saved. Keep recordings under 100 MB and five minutes."); return; }
        if (!chunks.length) { setError("No video was captured. Try recording again."); return; }
        const type = recorder.mimeType || chunks[0].type || mimeType || "video/webm";
        const extension = type.includes("mp4") ? "mp4" : "webm";
        const file = new File(chunks, `relay-recording-${new Date().toISOString().replaceAll(":", "-")}.${extension}`, { type });
        setTake({ file, durationMs, previewUrl: URL.createObjectURL(file), ...(events.length ? { pointer: importRecordingEvents(events, durationMs) } : {}) });
      };
      eventNames.forEach(name => target?.addEventListener(name, collect));
      stream.getVideoTracks()[0]?.addEventListener("ended", stop, { once: true });
      active.current = recorder;
      recorder.start(500);
    } catch (reason) {
      cleanup.current(); stream?.getTracks().forEach(track => track.stop()); active.current = null;
      if (mounted.current) { setStatus("idle"); setError(reason instanceof Error ? reason.message : "Could not begin recording."); }
    }
  };
  const loadVideo = async (file?: File) => {
    if (!file) return;
    setError("");
    if (!file.type.startsWith("video/") || !file.size || file.size > MAX_RECORDING_BYTES) { setError("Choose a video recording up to 100 MB."); return; }
    setTake({ file, previewUrl: URL.createObjectURL(file), durationMs: 0 });
  };
  const importEvents = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("Gesture JSON must be under 1 MB.");
      const pointer = importRecordingEvents(JSON.parse(await file.text()), take?.durationMs || undefined);
      if (take) setTake({ ...take, pointer });
      else if (onImportPointer) onImportPointer(pointer);
      else throw new Error("Import a recording first.");
      setImportedEvents(pointer.events.length);
      setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Invalid gesture file."); }
    finally { if (importInput.current) importInput.current.value = ""; }
  };
  const useTake = async () => {
    if (!take) return;
    setStatus("uploading"); setError("");
    try {
      if (!take.durationMs) throw new Error("Wait for the video metadata. If it cannot be read, convert the recording to MP4.");
      if (take.pointer) importRecordingEvents(take.pointer, take.durationMs);
      const asset = await uploadRecording(take.file);
      await onCaptured({ ...asset, durationMs: take.durationMs, ...(take.pointer ? { pointer: take.pointer } : {}) });
      setTake(undefined);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add the recording."); }
    finally { if (mounted.current) setStatus("idle"); }
  };
  return <section className="video-recording-controls" aria-label="Screen recording">
    <h3>Record a source</h3>
    <p>Choose a window or tab, review your recording, then add it to the timeline.</p>
    <label><input type="checkbox" checked={withAudio} disabled={busy} onChange={event => setWithAudio(event.target.checked)}/> Include shared audio when available</label>
    <div className="video-recording-actions" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      {status === "recording" ? <button type="button" className="primary-button" onClick={stop}>Stop recording · {Math.floor(elapsed / 1000)}s</button> : <button type="button" className="secondary-button" disabled={busy || !supported} onClick={() => void start()}>Record window or tab</button>}
      {captureCanvas && <button type="button" className="secondary-button" disabled={busy} onClick={() => void start(true)}>Record canvas with gestures</button>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => videoInput.current?.click()}>Import recording</button>
      <input ref={videoInput} type="file" accept="video/*" hidden disabled={busy} onChange={event => { void loadVideo(event.target.files?.[0]); event.target.value = ""; }}/>
    </div>
    {!supported && <p>Screen capture requires a supported browser on HTTPS or localhost. You can import a video here.</p>}
    <p className="muted">Screen sharing does not capture taps in other apps. Import gestures from the Simulator recorder to show those taps. Recordings stay on this device until you choose Add recording.</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => importInput.current?.click()}>Import gesture JSON</button>
    <input ref={importInput} type="file" accept=".json,application/json" hidden disabled={busy} onChange={event => void importEvents(event.target.files?.[0])}/>
    {importedEvents !== undefined && <p role="status">Imported {importedEvents} gesture {importedEvents === 1 ? "event" : "events"}.</p>}
    {take && <div className="video-recording-review">
      <video ref={preview} src={take.previewUrl} controls playsInline preload="metadata" onLoadedMetadata={event => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0) setTake(current => current?.file === take.file ? { ...current, durationMs: Math.round(duration * 1000) } : current); }} style={{ width: "100%", maxHeight: 240 }}/>
      <p>{take.file.name} · {(take.file.size / 1024 / 1024).toFixed(1)} MB · {take.pointer?.events.length ?? 0} gesture events</p>
      <button type="button" className="primary-button" disabled={busy || !take.durationMs} onClick={() => void useTake()}>{status === "uploading" ? "Adding recording…" : "Add recording"}</button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => setTake(undefined)}>Discard</button>
    </div>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
