"use client";

import { useEffect, useRef, useState } from "react";
import type { VideoProject, VideoRenderJob, VideoTimeline } from "@relay/core";
import { Copy, Download, LoaderCircle, Send, X } from "lucide-react";
import { timelineDuration } from "../lib/video-timeline";
import { CompositionPreview } from "./video-composer";

type Entry = { project: VideoProject; job?: VideoRenderJob; error?: string };
type Props = {
  open: boolean; onClose: () => void; timeline: VideoTimeline;
  save: () => Promise<VideoProject | undefined>;
  onSaved: (project: VideoProject) => void;
  onOpen: (project: VideoProject) => void;
  onCompose: (seed: { media: { name: string; url: string; previewUrl: string; type: "video"; coverUrl?: string; thumbOffsetMs?: number }; text: string; brandId: string }) => void;
};

async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api/v1/${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Could not create the videos. Retry with the same texts.");
  return payload;
}

export function VideoVariants({ open, onClose, timeline, save, onSaved, onOpen, onCompose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [texts, setTexts] = useState("");
  const [labelId, setLabelId] = useState("");
  const [render, setRender] = useState(true);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [time, setTime] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [createdLabelId, setCreatedLabelId] = useState("");
  const [exporting, setExporting] = useState<string[]>([]);
  const attempt = useRef<{ signature: string; id: string } | null>(null);
  const hooks = texts.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
  const target = timeline.labels.find(label => label.id === labelId) ?? timeline.labels[0];
  const total = timelineDuration(timeline);
  const invalid = hooks.length > 20 ? "Use up to 20 texts in one batch." : hooks.some(text => text.length > 500) ? "Each text can contain up to 500 characters." : "";
  const index = Math.min(previewIndex, Math.max(0, hooks.length - 1));
  const preview = target ? { ...timeline, labels: timeline.labels.map(label => label.id === target.id ? { ...label, text: hooks[index] ?? target.text } : label) } : timeline;
  const activeJobs = entries.filter(entry => entry.job && ["queued", "running"].includes(entry.job.status)).map(entry => entry.job!.id).join("|");

  useEffect(() => {
    if (open) dialog.current?.showModal(); else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    if (open && target) setTime(Math.min(total - 1, target.startMs + Math.min(1200, (target.endMs - target.startMs) / 2)));
  }, [open, target?.id]);
  useEffect(() => {
    if (!open || !activeJobs) return;
    let active = true, polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      const results = await Promise.allSettled(activeJobs.split("|").map(async id => (await request(`videos/jobs?id=${encodeURIComponent(id)}`)).data as VideoRenderJob));
      polling = false;
      if (!active) return;
      const jobs = results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
      setEntries(previous => previous.map(entry => { const job = jobs.find(job => job.id === entry.job?.id); return job ? { ...entry, job } : entry; }));
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => { active = false; clearInterval(timer); };
  }, [open, activeJobs]);

  const create = async () => {
    if (!target || !hooks.length || invalid || pending) return;
    setPending(true); setError("");
    try {
      const project = await save();
      if (!project) throw new Error("Save the source video before creating variants.");
      const signature = JSON.stringify({ id: project.id, revision: project.revision, hooks, labelId: target.id, render });
      if (attempt.current?.signature !== signature) attempt.current = { signature, id: crypto.randomUUID() };
      const payload = await request("videos/variants", "POST", { id: project.id, hooks, labelId: target.id, render, clientRequestId: attempt.current.id });
      const created = payload.data as Entry[];
      if (!Array.isArray(created) || created.some(entry => !entry.project?.id)) throw new Error("The batch response could not be read. Retry with the same texts.");
      setEntries(created); setCreatedLabelId(target.id);
      created.forEach(entry => onSaved(entry.project));
    } catch (failure) { setError((failure as Error).message); }
    finally { setPending(false); }
  };
  const exportEntry = async (entry: Entry) => {
    setExporting(previous => [...previous, entry.project.id]); setError("");
    try {
      const payload = entry.job && ["failed", "cancelled"].includes(entry.job.status)
        ? await request("videos/jobs", "PATCH", { id: entry.job.id, action: "retry" })
        : await request("videos/render", "POST", { id: entry.project.id, async: true });
      const job = payload.job ?? payload.data;
      setEntries(previous => previous.map(item => item.project.id === entry.project.id ? { project: item.project, job } : item));
    } catch (failure) { setEntries(previous => previous.map(item => item.project.id === entry.project.id ? { ...item, error: (failure as Error).message } : item)); }
    finally { setExporting(previous => previous.filter(id => id !== entry.project.id)); }
  };
  const editEntry = async (entry: Entry) => {
    setPending(true); setError("");
    try { await save(); onOpen(entry.project); }
    catch (failure) { setError((failure as Error).message); }
    finally { setPending(false); }
  };

  return <dialog ref={dialog} className="video-variants-dialog" aria-labelledby="video-variants-title" onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>{open && <>
    <header><div><p className="eyebrow">Bulk text · up to 20 videos</p><h2 id="video-variants-title">Create text variants</h2><p>Your footage, camera moves, device animations, label styling and music carry into every version.</p></div><button className="icon-button" aria-label="Close text variants" disabled={pending} onClick={onClose}><X/></button></header>
    <div className="video-variants-layout">
      <div className="video-variants-inputs">
        <label>Label to vary<select aria-label="Label to vary" value={target?.id ?? ""} disabled={pending || !timeline.labels.length} onChange={event => setLabelId(event.target.value)}>{timeline.labels.map((label, index) => <option key={label.id} value={label.id}>{index + 1} · {label.text || "Empty label"}</option>)}</select></label>
        {!target && <p className="video-variants-notice">Add a text label in the editor to use its style and timing for every video.</p>}
        <label htmlFor="video-variant-texts">Texts · one per line</label>
        <textarea id="video-variant-texts" aria-label="Variant texts" rows={10} disabled={pending} placeholder={"Your first headline\nYour second headline\nYour third headline"} value={texts} onChange={event => { setTexts(event.target.value); setError(""); }}/>
        <div className="video-variants-meta"><small>Blank lines are ignored. Up to 500 characters per text.</small><span>{hooks.length} / 20</span></div>
        <label className="video-variants-checkbox"><input type="checkbox" checked={render} disabled={pending} onChange={event => setRender(event.target.checked)}/>Render MP4s after creating</label>
        {(invalid || error) && <p className="video-variants-error" role="alert">{invalid || error}</p>}
        <button className="primary-button" disabled={pending || !target || !total || !hooks.length || !!invalid} onClick={() => void create()}>{pending ? <LoaderCircle className="spin"/> : <Copy/>}{pending ? "Creating videos…" : `${render ? "Create & render" : "Create"} ${hooks.length || ""} ${hooks.length === 1 ? "video" : "videos"}`}</button>
        <small>Each version is saved as an editable video. Exports run in the queue.</small>
      </div>
      <section className="video-variants-preview" aria-label="Text variant preview"><p className="eyebrow">Preview · {hooks.length ? `${index + 1} of ${hooks.length}` : "source video"}</p><CompositionPreview label="Variant canvas preview" timeline={preview} timeMs={Math.min(time, Math.max(0, total - 1))}/><label>Scrub preview<input aria-label="Variant preview playhead" type="range" min={0} max={Math.max(0,total - 1)} value={Math.min(time, Math.max(0,total - 1))} onChange={event => setTime(Number(event.target.value))}/></label><ol>{hooks.map((hook, row) => <li key={row}><button aria-label={`Preview variant ${row + 1}`} aria-pressed={row === index} onClick={() => setPreviewIndex(row)}><span>{String(row + 1).padStart(2,"0")}</span><b>{hook}</b></button></li>)}</ol></section>
    </div>
    {!!entries.length && <section className="video-variants-results" aria-label="Created video variants"><header><h3>{entries.length} videos created</h3><small>Open any version to continue editing, or use its completed export.</small></header><ol>{entries.map((entry, index) => {
      const job = entry.job, ready = job?.status === "completed" && !!job.renderedUrl, exportingNow = exporting.includes(entry.project.id);
      return <li key={entry.project.id}><div className="video-variant-result-heading"><span>{String(index + 1).padStart(2,"0")}</span><div><b>{entry.project.timeline?.labels.find(label => label.id === createdLabelId)?.text ?? entry.project.name}</b><small role="status">{entry.error || job?.error || (ready ? "MP4 ready" : job ? `${job.status} · ${job.progress}%` : "Editable draft saved")}</small></div></div>{job && !ready && ["queued","running"].includes(job.status) && <progress value={job.progress} max={100}/>}<div className="video-variant-result-actions"><button className="secondary-button" disabled={pending} onClick={() => void editEntry(entry)}>Edit video {index + 1}</button>{(!job || entry.error || ["failed","cancelled"].includes(job.status)) && <button className="secondary-button" disabled={exportingNow} onClick={() => void exportEntry(entry)}>{exportingNow ? "Queuing…" : job || entry.error ? "Retry export" : "Render MP4"}</button>}{ready && <><a className="secondary-button" href={`/api/v1/videos/download?jobId=${encodeURIComponent(job.id)}`}><Download/>Download video {index + 1}</a><button className="secondary-button" onClick={() => onCompose({ media: { name: `${entry.project.name}.mp4`, url: job.renderedUrl!, previewUrl: job.renderedUrl!, type:"video", coverUrl:job.coverUrl, thumbOffsetMs:job.coverMs }, text:entry.project.caption, brandId:entry.project.brandId })}><Send/>Create post for video {index + 1}</button></>}</div>{ready && <details><summary>Preview exported video {index + 1}</summary><video controls playsInline preload="none" src={job.renderedUrl} aria-label={`Exported variant ${index + 1}`}/></details>}</li>;
    })}</ol></section>}
  </>}</dialog>;
}
