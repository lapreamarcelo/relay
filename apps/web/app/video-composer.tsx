"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { VideoTimeline } from "@relay/core";
import { ChevronDown, LoaderCircle, Sparkles, X } from "lucide-react";
import { clipSchedule, layerSchedule, normalizeVideoTimeline, timelineDuration, videoSizes } from "../lib/video-timeline";
import { animationEase } from "../lib/video-animation";
import { animatedLabelsMarkup } from "../lib/animated-label-markup";
import { DeviceFramePreview } from "./device-frame-controls";

type Composition = { timeline: VideoTimeline; summary: string; warnings: string[]; signature: string; timelineSignature: string };
type Props = { timeline: VideoTimeline; projectName: string; onApply: (timeline: VideoTimeline) => void };

// Treat provider output as untrusted, even when the server already validated it.
function readComposition(value: unknown, source: VideoTimeline, signature: string, timelineSignature: string): Composition {
  if (!value || typeof value !== "object") throw new Error("The composition could not be read. Try again.");
  const result = value as Record<string, unknown>;
  if (typeof result.summary !== "string" || result.summary.length > 2000 || !Array.isArray(result.warnings) || result.warnings.length > 30 || result.warnings.some(warning => typeof warning !== "string" || warning.length > 2000)) throw new Error("The composition could not be read. Try again.");
  const next = normalizeVideoTimeline(result.timeline);
  const originals = [...source.clips, ...(source.layers ?? [])];
  const outputMedia = [...next.clips, ...(next.layers ?? [])];
  if (!outputMedia.length || outputMedia.some(clip => !originals.some(original =>
    new URL(original.sourceUrl).toString() === clip.sourceUrl && original.kind === clip.kind && clip.inMs >= original.inMs && clip.outMs <= original.outMs && (original.sourceDurationMs === undefined || clip.outMs <= original.sourceDurationMs)
  )) || next.music.url !== (source.music.url ? new URL(source.music.url).toString() : "")) throw new Error("The composition used media outside your selected recordings. Try again.");
  return { timeline: next, summary: result.summary, warnings: result.warnings as string[], signature, timelineSignature };
}

export function CompositionPreview({ timeline, timeMs, label = "Generated composition preview" }: { timeline: VideoTimeline; timeMs: number; label?: string }) {
  const [width, height] = videoSizes[timeline.aspectRatio];
  const active = clipSchedule(timeline).filter(entry => timeMs >= entry.startMs && timeMs < entry.endMs);
  const incoming = active.length > 1 ? active[1] : undefined;
  const raw = incoming ? Math.min(1, Math.max(0, (timeMs - incoming.startMs) / incoming.transitionMs)) : 1;
  const progress = incoming ? Number(animationEase(raw, incoming.clip.transition?.easing)) : 1;
  const layers = layerSchedule(timeline).filter(entry => timeMs >= entry.startMs && timeMs < entry.endMs);
  const color = timeline.background?.color ?? active.at(-1)?.clip.deviceFrame?.background ?? "#000000";
  const endColor = timeline.background ? timeline.background.endColor : active.at(-1)?.clip.deviceFrame?.backgroundEnd;
  return <div className="video-composer-canvas" style={{ background: endColor ? `linear-gradient(135deg,${color},${endColor})` : color, aspectRatio: `${width}/${height}`, width: `min(100%, ${300 * width / height}px)` }} aria-label={label}>
    {[...active,...layers].map((entry, index) => {
      const clip = entry.clip, local = timeMs - entry.startMs, kind = incoming?.clip.transition?.kind;
      const style: CSSProperties = {};
      const overlay = index >= active.length;
      if (incoming && !overlay) {
        if ((kind === "crossfade" || kind === "zoom") && index > 0) style.opacity = progress;
        if (kind === "zoom" && index > 0) style.transform = `scale(${1.2 - .2 * progress})`;
        if (kind === "slide-left" || kind === "slide-right") style.transform = `translateX(${(index > 0 ? 1 - progress : -progress) * (kind === "slide-left" ? 100 : -100)}%)`;
        if (kind === "wipe-left" && index > 0) style.clipPath = `inset(0 0 0 ${(1 - progress) * 100}%)`;
        if (kind === "wipe-right" && index > 0) style.clipPath = `inset(0 ${(1 - progress) * 100}% 0 0)`;
      }
      return <div className="video-clip-preview-layer" key={clip.id} style={style}>
        <DeviceFramePreview advanced transparent={overlay} value={clip.deviceFrame} width={width} height={height} timeMs={local} durationMs={clip.outMs - clip.inMs} sourceTimeMs={clip.inMs + local} sourceVolume={0} background={timeline.background}>
          {clip.kind === "video" ? <video src={clip.sourceUrl} muted playsInline preload="metadata" style={{ objectFit: clip.fit, objectPosition: `${clip.x * 100}% ${clip.y * 100}%`, transform: clip.fit === "cover" ? `scale(${clip.zoom})` : undefined, transformOrigin: `${clip.x * 100}% ${clip.y * 100}%` }} /> : <img src={clip.sourceUrl} alt="" style={{ objectFit: clip.fit, objectPosition: `${clip.x * 100}% ${clip.y * 100}%`, transform: clip.fit === "cover" ? `scale(${clip.zoom})` : undefined, transformOrigin: `${clip.x * 100}% ${clip.y * 100}%` }} />}
        </DeviceFramePreview>
      </div>;
    })}
    <div className="timeline-label-preview" aria-hidden="true" dangerouslySetInnerHTML={{ __html: animatedLabelsMarkup(timeline.labels, timeMs, width, height) }} />
  </div>;
}

export function VideoComposer({ timeline, projectName, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [productName, setProductName] = useState(projectName);
  const [duration, setDuration] = useState("15");
  const sources = [...timeline.clips, ...(timeline.layers ?? [])];
  const [selected, setSelected] = useState(sources.map(clip => clip.id));
  const [available, setAvailable] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<Composition | null>(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const knownIds = useRef(new Set(sources.map(clip => clip.id)));
  const timelineSignature = JSON.stringify(timeline);
  const signature = JSON.stringify({ timeline, prompt: prompt.trim(), productName: productName.trim(), duration: Number(duration), selectedClipIds: sources.filter(clip => selected.includes(clip.id)).map(clip => clip.id) });
  const currentSignature = useRef(signature);
  currentSignature.current = signature;
  const sourceIds = sources.map(clip => clip.id).join("|");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/videos/compose", { signal: controller.signal }).then(async response => {
      if (!response.ok) return;
      const result = await response.json();
      if (!controller.signal.aborted && typeof result.data?.available === "boolean") setAvailable(result.data.available);
    }).catch(() => {});
    return () => { controller.abort(); request.current?.abort(); generation.current++; };
  }, []);

  useEffect(() => {
    const newlyAdded = sources.filter(clip => !knownIds.current.has(clip.id)).map(clip => clip.id);
    setSelected(previous => {
      const valid = previous.filter(id => sources.some(clip => clip.id === id));
      // Newly added media is selected; a user can still deselect any recording.
      return [...valid, ...newlyAdded];
    });
    knownIds.current = new Set(sources.map(clip => clip.id));
  }, [sourceIds]);

  useEffect(() => {
    if (request.current) {
      request.current.abort(); request.current = null; generation.current++;
      setPending(false); setError("Your timeline changed. Generate again to include your latest edits.");
    }
  }, [timelineSignature]);

  const selectedClips = sources.filter(clip => selected.includes(clip.id));
  const seconds = Number(duration);
  const canGenerate = available !== false && selectedClips.length > 0 && prompt.trim().length >= 10 && prompt.trim().length <= 4000 && productName.length <= 120 && Number.isFinite(seconds) && seconds >= 1 && seconds <= 60;
  const stale = preview !== null && preview.signature !== signature;
  const cancel = () => {
    request.current?.abort(); request.current = null; generation.current++; setPending(false); setNotice("Generation cancelled. Your edit is unchanged.");
  };
  const generate = async () => {
    if (!canGenerate) return;
    request.current?.abort();
    const controller = new AbortController(), id = ++generation.current;
    request.current = controller; setPending(true); setError(""); setNotice("");
    const source: VideoTimeline = { ...timeline, clips: timeline.clips.filter(clip => selected.includes(clip.id)), ...(timeline.layers ? { layers: timeline.layers.filter(clip => selected.includes(clip.id)) } : {}) };
    try {
      const response = await fetch("/api/v1/videos/compose", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ prompt: prompt.trim(), timeline: source, ...(productName.trim() ? { productName: productName.trim() } : {}), durationMs: Math.round(seconds * 1000) }) });
      const result = await response.json();
      if (controller.signal.aborted || generation.current !== id || currentSignature.current !== signature) return;
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Could not generate your composition. Try again.");
      const composition = readComposition(result.data, source, signature, timelineSignature);
      setPreview(composition); setPreviewTime(Math.min(500, timelineDuration(composition.timeline) - 1));
    } catch (failure) {
      if (!controller.signal.aborted && generation.current === id) setError(failure instanceof Error ? failure.message : "Could not generate your composition. Try again.");
    } finally {
      if (generation.current === id) { setPending(false); request.current = null; }
    }
  };

  return <section className={`video-composer ${open ? "is-open" : ""}`} aria-label="AI video composer">
    <button className="video-composer-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}><span><Sparkles size={15} /><b>Compose with AI</b><small>Turn a recording into a launch video</small></span><ChevronDown size={15} /></button>
    {open && <div className="video-composer-body">
      <label htmlFor="video-composer-prompt">Describe your video</label>
      <textarea id="video-composer-prompt" maxLength={4000} rows={3} value={prompt} disabled={pending} placeholder="Make a clean cinematic launch video for my app, with bold titles and dynamic device moves…" onChange={event => setPrompt(event.target.value)} />
      <div className="video-composer-meta"><small>Your prompt and selected recording frames are sent to your configured OpenAI account. Review the result before applying.</small><span>{prompt.length}/4000</span></div>
      <details className="video-composer-options"><summary>Recordings & direction <span>{selectedClips.length} selected · {duration || "—"}s</span></summary><div className="video-composer-fields"><label>App or product name<input maxLength={120} value={productName} disabled={pending} onChange={event => setProductName(event.target.value)} /></label><label>Target duration (seconds)<input type="number" min={1} max={60} step={1} value={duration} disabled={pending} onChange={event => setDuration(event.target.value)} /></label></div><fieldset><legend>Use these recordings</legend>{sources.map(clip => <label key={clip.id}><input type="checkbox" checked={selected.includes(clip.id)} disabled={pending} onChange={event => setSelected(ids => event.target.checked ? [...ids, clip.id] : ids.filter(id => id !== clip.id))} /><span>{clip.name}</span><small>{((clip.outMs - clip.inMs) / 1000).toFixed(1)}s</small></label>)}</fieldset></details>
      {!sources.length && <p className="video-composer-message">Upload a video or choose media first, then describe the demo you want.</p>}
      {sources.length > 0 && !selectedClips.length && <p className="video-composer-message">Select at least one recording to compose your video.</p>}
      {available === false && <p className="video-composer-message">Video composition needs OpenAI to be configured for this workspace. You can keep editing manually.</p>}
      {error && <p className="video-composer-message error" role="alert">{error}</p>}
      {notice && <p className="video-composer-message" role="status">{notice}</p>}
      <div className="video-composer-actions"><button className="primary-button" disabled={!canGenerate || pending} onClick={() => void generate()}>{pending ? <LoaderCircle className="video-composer-spinner" size={14} /> : <Sparkles size={14} />}{pending ? "Composing your video…" : preview ? "Regenerate composition" : "Generate composition"}</button>{pending && <button className="secondary-button" onClick={cancel}>Cancel generation</button>}</div>
      {preview && <div className="video-composer-review" aria-label="Review generated composition"><div className="video-composer-review-head"><div><p className="eyebrow">Ready for review</p><h3>A new cut of your recording</h3></div><button className="icon-button" aria-label="Discard composition" disabled={pending} onClick={() => { setPreview(null); setNotice("Composition discarded. Your edit is unchanged."); }}><X size={15} /></button></div><p>{preview.summary}</p><div className="video-composer-preview-layout"><div><CompositionPreview timeline={preview.timeline} timeMs={previewTime} /><label className="video-composer-scrubber">Preview playhead<input aria-label="Composition preview playhead" type="range" min={0} max={Math.max(0, timelineDuration(preview.timeline) - 1)} step={1} value={previewTime} onChange={event => setPreviewTime(Number(event.target.value))} /><output>{(previewTime / 1000).toFixed(1)} / {(timelineDuration(preview.timeline) / 1000).toFixed(1)}s</output></label></div><div className="video-composer-scene-list"><p><b>{preview.timeline.clips.length}</b> scenes · <b>{preview.timeline.labels.length}</b> text blocks{preview.timeline.layers?.length ? ` · ${preview.timeline.layers.length} device layers` : ""}</p><ol>{[...clipSchedule(preview.timeline),...layerSchedule(preview.timeline)].map(entry => <li key={entry.clip.id}><button onClick={() => setPreviewTime(entry.startMs)}><span>{(entry.startMs / 1000).toFixed(1)}s</span><b>{entry.clip.name}</b><small>{entry.clip.deviceFrame?.device.replaceAll("-", " ") ?? "Full frame"}{"transition" in entry.clip && entry.clip.transition ? ` · ${entry.clip.transition.kind.replaceAll("-", " ")}` : ""}</small></button></li>)}</ol></div></div>{preview.warnings.length > 0 && <ul className="video-composer-warnings">{preview.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}{stale && <p className="video-composer-message" role="status">{preview.timelineSignature !== timelineSignature ? "Your timeline changed after this preview. Generate again before applying." : "Your direction changed after this preview. Generate again before applying."}</p>}<div className="video-composer-actions"><button className="primary-button" disabled={pending || stale} onClick={() => { if (preview.signature !== currentSignature.current) return; onApply(preview.timeline); setPreview(null); setNotice("Composition applied. Every scene, label and animation is editable. Use Undo to restore your previous edit."); }}>Apply composition</button><small>Replaces this timeline in one undoable edit.</small></div></div>}
    </div>}
  </section>;
}
