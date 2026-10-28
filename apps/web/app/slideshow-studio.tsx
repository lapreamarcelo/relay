"use client";

import ModalLayer from "./modal-layer";
import "./slideshow-output.css";
import { imageVideoSeconds } from "@relay/core/image-video";
import { parseSlideshowOutputCache, slideshowOutputCacheKey, slideshowOutputFingerprint, type SlideshowVideoResult } from "../lib/slideshow-output-cache";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LabelStylePreset, SlideshowProject, SlideshowSlide, VideoRenderJob } from "@relay/core";
import {
  ArrowLeft, Check, ChevronLeft, ChevronRight, CircleAlert, Copy, ExternalLink, Images, LoaderCircle,
  Folder, Plus, Save, Search, Sparkles, Trash2, Upload, Video, WandSparkles, X,
} from "lucide-react";
import { ConfirmModal } from "./confirm-modal";
import { CreativePublishHandoff } from "./creative-publish-handoff";
import { DeviceFrameControls, DeviceFramePreview } from "./device-frame-controls";
import { LabelControls, type LabelControlValue } from "./label-controls";
import { labelFonts } from "../lib/creative-labels";
import { LocalDate } from "./local-date";
import { labelTextMarkup } from "../lib/creative-label-markup";
import { useLabelEmoji } from "./use-label-emoji";
import type { ExternalImageResult } from "../lib/external-image-sources";
import { flattenMediaProjects, mediaProjectOptionLabel } from "../lib/media-projects";

interface MediaObject { key: string; name: string; url: string }
interface MediaProject { id: string; name: string; kind?: "media" | "music"; parentId?: string | null }
interface StagedMedia { key: string; url: string; projectId?: string }

function newSlide(mediaUrl: string, text = ""): SlideshowSlide {
  return { id: crypto.randomUUID(), mediaUrl, text: text || undefined, fit: "cover", textPosition: "bottom", textX: .5, textY: .78, textWidth: .87, textHeight: .12, textSize: 64, textFont: "modern", textColor: "#FFFFFF", textBackground: "dark", textBackgroundColor: "#000000" };
}

function SlideCanvas({ slide, compact = false, onMove }: { slide: SlideshowSlide; compact?: boolean; onMove?: (x: number, y: number) => void }) {
  const emojiError = useLabelEmoji(slide.text ?? "");
  const ref = useRef<HTMLDivElement>(null); const [dragging, setDragging] = useState(false);
  const style = { "--slide-size": `${slide.textSize}px`, "--slide-color": slide.textColor, fontFamily: labelFonts[slide.textFont ?? "modern"].css } as React.CSSProperties;
  const x = slide.textX ?? .5; const y = slide.textY ?? (slide.textPosition === "top" ? .18 : slide.textPosition === "center" ? .5 : .78);
  return <div ref={ref} className={`slide-canvas ${compact ? "compact" : ""}`} style={style} onPointerMove={(event) => { if (!dragging || !ref.current || !onMove) return; const rect = ref.current.getBoundingClientRect(); onMove(Math.min(.92, Math.max(.08, (event.clientX - rect.left) / rect.width)), Math.min(.94, Math.max(.06, (event.clientY - rect.top) / rect.height))); }} onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}>
    <DeviceFramePreview value={slide.renderedUrl ? undefined : slide.deviceFrame} width={1080} height={1920}>
      <img src={slide.renderedUrl ?? slide.mediaUrl} alt="" style={{ objectFit: slide.renderedUrl ? "cover" : slide.fit }} />
    </DeviceFramePreview>
    {!slide.renderedUrl && slide.text && <div className={`slide-title movable bg-${slide.textBackground}`} style={{ left: `${x * 100}%`, top: `${y * 100}%`, width: `${(slide.textWidth ?? .87) * 100}%`, minHeight: `${(slide.textHeight ?? .12) * 100}%`, maxHeight: "88%", backgroundColor: slide.textBackground === "none" ? undefined : slide.textBackgroundColor }} onPointerDown={(event) => { if (!onMove) return; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}><span dangerouslySetInnerHTML={{__html:labelTextMarkup(slide.text)}}/></div>}
    {slide.renderedUrl && <span className="slide-rendered"><Check /> Rendered</span>}
    {emojiError && !compact && <span className="slide-rendered" role="alert">{emojiError}</span>}
  </div>;
}

type MediaSourceTab = "library" | "pexels";

function MediaPicker({ onAdd, onClose }: { onAdd: (asset: { url: string; staged?: StagedMedia }) => void; onClose: () => void }) {
  const [items, setItems] = useState<MediaObject[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [projects, setProjects] = useState<MediaProject[]>([]); const [projectId, setProjectId] = useState("all");
  const [uploading, setUploading] = useState(false); const [uploadProgress, setUploadProgress] = useState(""); const [dragActive, setDragActive] = useState(false); const dragDepth = useRef(0); const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<MediaSourceTab>("library");
  const [pexelsConfigured, setPexelsConfigured] = useState<boolean | null>(null); const [pexelsQuery, setPexelsQuery] = useState("");
  const [pexelsPage, setPexelsPage] = useState(1); const [pexelsHasMore, setPexelsHasMore] = useState(false);
  const [externalItems, setExternalItems] = useState<ExternalImageResult[]>([]); const [externalLoading, setExternalLoading] = useState(false);
  const [importingId, setImportingId] = useState("");
  const folderOptions = useMemo(() => flattenMediaProjects(projects), [projects]);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "100", project: projectId });
    void fetch(`/api/v1/media?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as { data?: MediaObject[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load media.");
      setItems((payload.data ?? []).filter((item) => /\.(png|jpe?g|webp|avif|gif)$/i.test(item.name)));
    }).catch((reason) => { if (reason?.name !== "AbortError") setError(reason instanceof Error ? reason.message : "Could not load media."); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, [projectId]);
  useEffect(() => { void fetch("/api/v1/media/projects?kind=media", { cache: "no-store" }).then(async (response) => { const payload = await response.json() as { data?: MediaProject[] }; if (response.ok) setProjects(payload.data ?? []); }); }, []);
  useEffect(() => {
    void fetch("/api/v1/media/sources", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { configured?: boolean };
      setPexelsConfigured(response.ok && payload.configured === true);
    }).catch(() => setPexelsConfigured(false));
  }, []);
  const uploadOne = async (file: File) => {
    const uploadProjectId = projectId !== "all" && projectId !== "unfiled" ? projectId : undefined;
    const signedResponse = await fetch("/api/v1/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type, staged: true }) });
    const signed = await signedResponse.json() as { key?: string; uploadUrl?: string; url?: string; error?: string };
    if (!signedResponse.ok || !signed.key || !signed.uploadUrl || !signed.url) throw new Error(signed.error || `Could not prepare ${file.name}.`);
    try {
      const direct = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (direct.ok) return { url: signed.url, staged: { key: signed.key, url: signed.url, projectId: uploadProjectId } };
    } catch { /* The server upload below handles browsers where R2 CORS blocks direct PUTs. */ }
    const form = new FormData(); form.append("file", file); form.append("staged", "true");
    const fallbackResponse = await fetch("/api/v1/media", { method: "POST", body: form });
    const fallback = await fallbackResponse.json() as { key?: string; url?: string; error?: string };
    if (!fallbackResponse.ok || !fallback.key || !fallback.url) throw new Error(fallback.error || `Could not upload ${file.name}.`);
    return { url: fallback.url, staged: { key: fallback.key, url: fallback.url, projectId: uploadProjectId } };
  };
  const uploadFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/")).slice(0, 35);
    if (!files.length) return;
    setUploading(true); setError("");
    try {
      for (let index = 0; index < files.length; index += 1) {
        setUploadProgress(`Uploading ${index + 1} of ${files.length}…`);
        onAdd(await uploadOne(files[index]));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not upload the selected images."); }
    finally { setUploading(false); setUploadProgress(""); if (fileInput.current) fileInput.current.value = ""; }
  };
  const isFileDrag = (event: React.DragEvent<HTMLElement>) => Array.from(event.dataTransfer.items).some((item) => item.kind === "file") || Array.from(event.dataTransfer.types).includes("Files");
  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => { if (uploading || !isFileDrag(event)) return; event.preventDefault(); dragDepth.current += 1; setDragActive(true); };
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => { if (uploading || !isFileDrag(event)) return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; };
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => { if (!dragActive) return; event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragActive(false); };
  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => { if (!dragActive && !isFileDrag(event)) return; event.preventDefault(); dragDepth.current = 0; setDragActive(false); if (!uploading) void uploadFiles(event.dataTransfer.files); };
  const loadExternal = async (append = false) => {
    if (!pexelsConfigured) { setError("Pexels is not configured. Add PEXELS_API_KEY to .env and restart Relay."); return; }
    if (!pexelsQuery.trim()) { setError("Enter something to search for on Pexels."); return; }
    const requestedPage = append ? pexelsPage + 1 : 1;
    setExternalLoading(true); setError("");
    try {
      const response = await fetch("/api/v1/media/sources", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "pexels", query: pexelsQuery, page: requestedPage }) });
      const payload = await response.json() as { items?: ExternalImageResult[]; page?: number; hasMore?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load images.");
      setExternalItems((current) => append ? [...current, ...(payload.items ?? [])] : payload.items ?? []);
      setPexelsPage(payload.page ?? requestedPage); setPexelsHasMore(payload.hasMore === true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load images."); }
    finally { setExternalLoading(false); }
  };
  const importExternal = async (item: ExternalImageResult) => {
    setImportingId(item.id); setError("");
    try {
      const response = await fetch("/api/v1/media/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: item.provider, id: item.id, url: item.importUrl, sourceUrl: item.sourceUrl, creator: item.creator, attribution: item.attribution }) });
      const payload = await response.json() as { key?: string; url?: string; error?: string };
      if (!response.ok || !payload.key || !payload.url) throw new Error(payload.error || "Could not import the selected image.");
      const targetProjectId = projectId !== "all" && projectId !== "unfiled" ? projectId : undefined;
      onAdd({ url: payload.url, staged: { key: payload.key, url: payload.url, projectId: targetProjectId } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not import the selected image."); }
    finally { setImportingId(""); }
  };
  const showSource = (next: MediaSourceTab) => { setSource(next); setError(""); setExternalItems([]); setPexelsPage(1); setPexelsHasMore(false); };
  const providerGrid = <div className="slideshow-media-grid external-media-grid">{externalItems.map((item) => <article key={item.id}><button disabled={Boolean(importingId)} onClick={() => void importExternal(item)}><img src={item.previewUrl} alt={item.title} /><span>{importingId === item.id ? <LoaderCircle className="spin" /> : <Plus />} {importingId === item.id ? "Importing" : "Add"}</span></button><b title={item.title}>{item.title}</b><small>{item.attribution}</small><a href={item.sourceUrl} target="_blank" rel="noreferrer">View source <ExternalLink /></a></article>)}{!externalLoading && !externalItems.length && <p>Search Pexels for portrait photos to use in your slides.</p>}</div>;
  return <ModalLayer className="modal-layer slideshow-media-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close media library" /><section className="slideshow-media-picker" role="dialog" aria-modal="true" aria-labelledby="slide-media-title"><header><div><p className="eyebrow">Add media</p><h2 id="slide-media-title">Add images to the slideshow</h2><p>Imported images stay temporary until you save or render.</p></div><button className="icon-button" onClick={onClose}><X /></button></header><nav className="slideshow-source-tabs" aria-label="Image source"><button className={source === "library" ? "active" : ""} onClick={() => showSource("library")}><Images />Library & upload</button><button className={source === "pexels" ? "active" : ""} onClick={() => showSource("pexels")}><Search />Pexels</button></nav><div className="slideshow-media-body"><label className="media-project-select"><Folder />Save selected images to<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="all">Unsorted Media</option>{folderOptions.map(({ project, depth }) => <option value={project.id} key={project.id}>{mediaProjectOptionLabel(project.name, depth)}</option>)}</select></label>{source === "library" && <><div className={`slideshow-upload-source${dragActive ? " drag-active" : ""}`} onDragEnter={handleDragEnter} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}><div><Upload /><span><b>{dragActive ? "Drop images to upload" : "Upload from computer"}</b><small>{dragActive ? "Release to add them to the slideshow." : "Choose several images or drag them here—they’ll be added in order."}</small></span></div><input ref={fileInput} hidden type="file" accept="image/*" multiple onChange={(event) => void uploadFiles(event.target.files)} /><button className="primary-button" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle className="spin" /> : <Upload />}{uploading ? uploadProgress : "Choose files"}</button></div><div className="slideshow-media-label"><div><Images /><span><b>Media library</b><small>Your existing images stored in Cloudflare.</small></span></div><span>{items.length} available</span></div>{error && <p className="composer-error">{error}</p>}{loading ? <div className="media-loading"><LoaderCircle className="spin" />Loading images…</div> : <div className="slideshow-media-grid">{items.map((item) => <button key={item.key} onClick={() => onAdd({ url: item.url })}><img src={item.url} alt={item.name} /><span><Plus /> Add</span><b>{item.name}</b></button>)}{!items.length && <p>No images in this project yet. Upload some above.</p>}</div>}</>}{source === "pexels" && <>{pexelsConfigured === null ? <div className="media-loading"><LoaderCircle className="spin" />Checking Pexels configuration…</div> : pexelsConfigured ? <section className="external-source-setup"><form className="external-search pexels-search" onSubmit={(event) => { event.preventDefault(); void loadExternal(); }}><label><span>Search Pexels photos</span><input aria-label="Search Pexels" value={pexelsQuery} onChange={(event) => setPexelsQuery(event.target.value)} placeholder="Editorial workspace, coastal morning…" /></label><button className="primary-button" disabled={externalLoading}>{externalLoading ? <LoaderCircle className="spin" /> : <Search />} Search</button></form></section> : <section className="external-source-setup external-source-missing"><div className="external-source-heading"><CircleAlert /><span><b>Pexels API key required</b><small>Add <code>PEXELS_API_KEY=your_key</code> to the server’s <code>.env</code> file, then restart Relay.</small></span></div></section>}{pexelsConfigured && <>{error && <p className="composer-error">{error}</p>}{externalLoading && !externalItems.length ? <div className="media-loading"><LoaderCircle className="spin" />Loading images…</div> : providerGrid}{pexelsHasMore && <button className="secondary-button external-load-more" disabled={externalLoading} onClick={() => void loadExternal(true)}>{externalLoading ? <LoaderCircle className="spin" /> : <Plus />} Load more photos</button>}{externalItems.length > 0 && <p className="external-provider-credit">Photos provided by <a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a>. Photographer credit and source links are preserved with each import.</p>}</>}</>}</div><footer><span>Select as many images as you need</span><button className="primary-button" onClick={onClose}>Done</button></footer></section></ModalLayer>;
}

interface SlideshowComposerSeed { media: { name: string; url: string; previewUrl: string; type: "image" | "video"; urls?: string[]; coverUrl?: string }; text: string; brandId: string }
interface SlideshowRenderResponse { data?: SlideshowProject; video?: SlideshowVideoResult; job?: VideoRenderJob; error?: string }

function ProjectEditor({ initial, onBack, onSaved, onCompose }: { initial: SlideshowProject; onBack: () => void; onSaved: (project: SlideshowProject) => void; onCompose: (seed: SlideshowComposerSeed) => void }) {
  const [project, setProject] = useState(initial); const [activeId, setActiveId] = useState(initial.slides[0]?.id ?? "");
  const [stagedMedia, setStagedMedia] = useState<Record<string, StagedMedia>>({});
  const [picker, setPicker] = useState(false); const [bulkOpen, setBulkOpen] = useState(false); const [bulkTitles, setBulkTitles] = useState("");
  const [busy, setBusy] = useState<"save" | "render" | "compose" | null>(null); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [job, setJob] = useState<VideoRenderJob | null>(null);
  const [pollError, setPollError] = useState(""); const [pollAttempt, setPollAttempt] = useState(0);
  const [jobActionBusy, setJobActionBusy] = useState(false);
  const [videoResult, setVideoResult] = useState<SlideshowVideoResult | null>(null);
  const [cacheRestored, setCacheRestored] = useState(false);
  const renderProject = useRef<SlideshowProject | null>(null);
  const renderVideo = useRef<SlideshowVideoResult | null>(null);
  const renderIntent = useRef<"render" | "compose">("render");
  const polling = useRef<AbortController | null>(null);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; polling.current?.abort(); request.current?.abort(); }; }, []);
  useEffect(() => {
    try {
      const cached = parseSlideshowOutputCache(window.localStorage.getItem(slideshowOutputCacheKey(initial.id)), initial);
      if (cached) {
        renderProject.current = initial; renderVideo.current = cached.video; renderIntent.current = "render";
        setJob(cached.job); setVideoResult(cached.result);
        if (cached.job && ["queued", "running"].includes(cached.job.status)) setBusy("render");
      }
    } catch { /* Rendering remains available when browser storage is disabled. */ }
    setCacheRestored(true);
  }, []);
  const fingerprint = slideshowOutputFingerprint(project);
  const renderMatches = renderProject.current !== null && slideshowOutputFingerprint(renderProject.current) === fingerprint;
  useEffect(() => {
    if (!cacheRestored) return;
    try {
      const key = slideshowOutputCacheKey(project.id);
      if (!renderMatches || (!job && !videoResult?.url)) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify({ fingerprint, job, video: renderVideo.current, result: videoResult }));
    } catch { /* Storage quotas and privacy settings must not block publishing. */ }
  }, [cacheRestored, fingerprint, renderMatches, job, videoResult, project.id]);
  const outputFormat = project.output?.format ?? "images";
  const count = Math.max(1, project.slides.length);
  const storedSeconds = project.output?.imageSeconds;
  const seconds = imageVideoSeconds(count, Number.isInteger(storedSeconds) && storedSeconds! >= (count === 1 ? 5 : 3) && storedSeconds! <= (count === 1 ? 10 : 5) ? storedSeconds : undefined);
  useEffect(() => {
    if (busy || !job || !["failed", "cancelled", "completed"].includes(job.status) || renderMatches) return;
    setJob(null); setVideoResult(null); setPollError(""); renderProject.current = null; renderVideo.current = null; renderIntent.current = "render";
  }, [fingerprint, renderMatches, busy, job]);
  const currentVideo = videoResult?.url && renderMatches ? videoResult : null;
  const composeVideo = (rendered: SlideshowProject, video: SlideshowVideoResult) => {
    if (!video.url) throw new Error("The video finished without a usable MP4 URL.");
    onCompose({ media: { name: `${rendered.name}.mp4`, url: video.url, previewUrl: video.url, type: "video", coverUrl: video.coverUrl }, text: rendered.caption, brandId: rendered.brandId });
  };
  useEffect(() => {
    if (!cacheRestored || !job || !["queued", "running"].includes(job.status) || pollError) return;
    const controller = new AbortController(); polling.current = controller; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/v1/videos/jobs?id=${encodeURIComponent(job.id)}`, { cache: "no-store", signal: controller.signal });
        const payload = await response.json() as { data?: VideoRenderJob; error?: string };
        if (!response.ok || !payload.data) throw new Error(payload.error || "Could not check video progress.");
        if (controller.signal.aborted) return;
        const next = payload.data;
        if (next.status === "completed" && !next.renderedUrl) { setJob({ ...next, status: "failed", error: "The video finished without a usable MP4 URL. Retry the render." }); setBusy(null); return; }
        setJob(next);
        if (next.status === "completed") {
          if (!next.renderedUrl) throw new Error("The video finished without a usable MP4 URL.");
          const video = { projectId: next.projectId, durationMs: renderVideo.current?.durationMs ?? 0, url: next.renderedUrl, coverUrl: next.coverUrl };
          setVideoResult(video); setBusy(null); setMessage("Video saved to Media.");
          if (renderIntent.current === "compose" && renderProject.current) composeVideo(renderProject.current, video);
        } else if (["failed", "cancelled"].includes(next.status)) { setBusy(null); }
        else timer = setTimeout(() => void poll(), 1_500);
      } catch (reason) {
        if (!controller.signal.aborted) setPollError(reason instanceof Error ? reason.message : "Could not check video progress.");
      }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [cacheRestored, job?.id, job?.status, pollAttempt, pollError]);
  const changeJob = async (action: "retry" | "cancel") => {
    if (!job || jobActionBusy) return;
    polling.current?.abort(); setJobActionBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/videos/jobs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: job.id, action }) });
      const payload = await response.json() as { data?: VideoRenderJob; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || `Could not ${action} this render.`);
      if (!mounted.current) return;
      setJob(payload.data); setPollError(""); setPollAttempt((current) => current + 1);
      setBusy(["queued", "running"].includes(payload.data.status) ? renderIntent.current : null);
    } catch (reason) { if (mounted.current) { setError(reason instanceof Error ? reason.message : "Could not update the video render."); setPollAttempt((current) => current + 1); } }
    finally { if (mounted.current) setJobActionBusy(false); }
  };
  const active = project.slides.find((slide) => slide.id === activeId) ?? project.slides[0];

  const replace = (next: SlideshowProject) => { setProject(next); onSaved(next); setActiveId((current) => next.slides.some((slide) => slide.id === current) ? current : next.slides[0]?.id ?? ""); };
  const updateSlide = (changes: Partial<SlideshowSlide>) => setProject((current) => ({ ...current, slides: current.slides.map((slide) => slide.id === active?.id ? { ...slide, ...changes, renderedUrl: undefined } : slide) }));
  const addImage = (asset: { url: string; staged?: StagedMedia }) => { const slide = newSlide(asset.url); if (asset.staged) setStagedMedia((current) => ({ ...current, [asset.url]: asset.staged! })); setProject((current) => { if (current.slides.length >= 35) return current; setActiveId(slide.id); return { ...current, slides: [...current.slides, slide] }; }); };
  const discardStaged = async (assets = Object.values(stagedMedia)) => { await Promise.all(assets.map((asset) => fetch("/api/v1/media", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: asset.key }) }).catch(() => undefined))); };
  const commitStaged = async (): Promise<SlideshowProject> => {
    let next = project; const remaining = { ...stagedMedia }; const referenced = new Set(project.slides.map((slide) => slide.mediaUrl));
    for (const asset of Object.values(stagedMedia)) {
      if (!referenced.has(asset.url)) { await discardStaged([asset]); delete remaining[asset.url]; setStagedMedia({ ...remaining }); continue; }
      const response = await fetch("/api/v1/media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: asset.key, kind: "media", projectId: asset.projectId ?? "unfiled", commit: true }) });
      const payload = await response.json() as { url?: string; error?: string }; if (!response.ok || !payload.url) throw new Error(payload.error || "Could not save a staged slideshow image.");
      next = { ...next, slides: next.slides.map((slide) => slide.mediaUrl === asset.url ? { ...slide, mediaUrl: payload.url! } : slide) };
      delete remaining[asset.url]; setProject(next); setStagedMedia({ ...remaining });
    }
    return next;
  };
  const save = async (): Promise<SlideshowProject | null> => {
    setError(""); setMessage("");
    let savable: SlideshowProject; try { savable = await commitStaged(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save staged images."); return null; }
    const response = await fetch("/api/v1/slideshows", { signal: request.current?.signal, method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...savable, output: { format: outputFormat, ...(outputFormat === "video" ? { imageSeconds: seconds } : {}) } }) });
    const payload = await response.json() as { data?: SlideshowProject; folder?: { id: string; name: string }; error?: string };
    if (!response.ok || !payload.data) { setError(payload.error || "Could not save the slideshow."); return null; }
    if (!mounted.current) return null;
    replace(payload.data); return payload.data;
  };
  const saveOnly = async () => {
    request.current = new AbortController(); setBusy("save");
    try { const saved = await save(); if (saved) setMessage("Project saved for reuse."); }
    catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not save the slideshow."); }
    finally { if (mounted.current) setBusy(null); }
  };
  const exportProject = async (intent: "render" | "compose") => {
    if (!project.slides.length || busy) return;
    if (intent === "compose" && outputFormat === "video" && currentVideo) { composeVideo(project, currentVideo); return; }
    request.current = new AbortController(); setBusy(intent); setError(""); setMessage(""); setPollError(""); setJob(null); setVideoResult(null); renderIntent.current = intent;
    let pending = false;
    try {
      const saved = await save(); if (!saved || !mounted.current) return;
      const videoOutput = (saved.output?.format ?? "images") === "video";
      const response = await fetch("/api/v1/slideshows/render", { signal: request.current?.signal, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: saved.id, format: videoOutput ? "video" : "images", ...(videoOutput ? { imageSeconds: seconds, async: true } : {}) }) });
      const payload = await response.json() as SlideshowRenderResponse;
      if (!response.ok || !payload.data) throw new Error(payload.error || "Could not render the slideshow.");
      if (!mounted.current) return;
      replace(payload.data); renderProject.current = payload.data;
      renderVideo.current = payload.video ?? (payload.job ? { projectId: payload.job.projectId, durationMs: payload.data.slides.length * seconds * 1_000 } : null);
      if (videoOutput) {
        if (payload.video?.url) {
          setVideoResult(payload.video); setMessage("Video saved to Media.");
          if (intent === "compose") composeVideo(payload.data, payload.video);
        } else if (payload.job) { setJob(payload.job); pending = ["queued", "running"].includes(payload.job.status); }
        else throw new Error("Relay did not return a video or a render job. Try again.");
      } else {
        const urls = payload.data.slides.map((slide) => slide.renderedUrl).filter((url): url is string => Boolean(url));
        if (!urls.length) throw new Error("The slideshow rendered without usable image URLs.");
        setMessage(`${urls.length} ordered JPEG${urls.length === 1 ? "" : "s"} saved in a new Media folder.`);
        if (intent === "compose") onCompose({ media: { name: `${payload.data.name} · ${urls.length} slides`, url: urls[0], previewUrl: urls[0], type: "image", urls }, text: payload.data.caption, brandId: payload.data.brandId });
      }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : "Could not render the slideshow."); }
    finally { if (mounted.current && !pending) setBusy(null); }
  };
  const remove = () => { if (!active) return; const index = project.slides.findIndex((slide) => slide.id === active.id); const slides = project.slides.filter((slide) => slide.id !== active.id); setProject({ ...project, slides }); setActiveId(slides[Math.min(index, slides.length - 1)]?.id ?? ""); };
  const duplicate = () => { if (!active || project.slides.length >= 35) return; const copy = { ...active, id: crypto.randomUUID(), renderedUrl: undefined }; const index = project.slides.findIndex((slide) => slide.id === active.id); const slides = [...project.slides]; slides.splice(index + 1, 0, copy); setProject({ ...project, slides }); setActiveId(copy.id); };
  const move = (direction: number) => { if (!active) return; const index = project.slides.findIndex((slide) => slide.id === active.id); const next = index + direction; if (next < 0 || next >= project.slides.length) return; const slides = [...project.slides]; [slides[index], slides[next]] = [slides[next], slides[index]]; setProject({ ...project, slides }); };
  const applyBulk = () => {
    const titles = bulkTitles.split("\n").map((title) => title.trim()).slice(0, 35);
    const sources = project.slides.length ? project.slides : [];
    if (!titles.length || !sources.length) { setError("Add at least one image, then enter one title per line."); return; }
    const slides = titles.map((title, index) => ({ ...sources[index % sources.length], id: crypto.randomUUID(), text: title === "—" ? undefined : title || undefined, renderedUrl: undefined }));
    setProject({ ...project, slides }); setActiveId(slides[0].id); setBulkOpen(false); setMessage(`${slides.length} slides generated. Use an em dash (—) for a slide without text.`);
  };
  const labelStyle: LabelStylePreset = active?.textBackground === "light" ? "light" : active?.textBackground === "none" ? "outline" : "dark";
  const labelValue: LabelControlValue = { text: active?.text ?? "", font: active?.textFont ?? "modern", fontSize: active?.textSize ?? 64, width: active?.textWidth ?? .87, height: active?.textHeight ?? .12, textColor: active?.textColor ?? "#FFFFFF", background: active?.textBackground ?? "dark", backgroundColor: active?.textBackgroundColor ?? (active?.textBackground === "light" ? "#FFFFFF" : "#000000"), style: labelStyle };
  const updateLabelControls = (changes: Partial<LabelControlValue>) => updateSlide({
    ...(changes.text !== undefined ? { text: changes.text || undefined } : {}),
    ...(changes.font !== undefined ? { textFont: changes.font } : {}),
    ...(changes.fontSize !== undefined ? { textSize: changes.fontSize } : {}),
    ...(changes.width !== undefined ? { textWidth: changes.width } : {}),
    ...(changes.height !== undefined ? { textHeight: changes.height } : {}),
    ...(changes.textColor !== undefined ? { textColor: changes.textColor } : {}),
    ...(changes.background !== undefined ? { textBackground: changes.background } : {}),
    ...(changes.backgroundColor !== undefined ? { textBackgroundColor: changes.backgroundColor } : {}),
  });

  return <div className="slideshow-editor page-enter">
    <header className="slideshow-editor-head"><button className="icon-button" aria-label="Back to slideshows" disabled={busy !== null && !job} onClick={() => void discardStaged().finally(onBack)}><ArrowLeft /></button><div><p className="eyebrow">Slideshow studio</p><input aria-label="Project name" disabled={busy !== null} value={project.name} maxLength={120} onChange={(event) => setProject({ ...project, name: event.target.value })} /></div><div><button className="secondary-button" disabled={busy !== null} onClick={() => setBulkOpen(true)}><WandSparkles /> Bulk titles</button><button className="secondary-button" aria-label="Save" disabled={busy !== null} onClick={() => void saveOnly()}>{busy === "save" ? <LoaderCircle className="spin" /> : <Save />} Save</button><button className="primary-button" disabled={busy !== null || !project.slides.length} onClick={() => void exportProject("render")}>{busy === "render" ? <LoaderCircle className="spin" /> : <Sparkles />} Save to Media</button></div></header>
    {(error || message) && <div className={`slideshow-notice ${error ? "error" : "success"}`}>{error || message}<button onClick={() => { setError(""); setMessage(""); }}><X /></button></div>}
    <div className="slideshow-workbench">
      <aside className="slide-rail"><div><b>Slides</b><span>{project.slides.length}/35</span></div>{project.slides.map((slide, index) => <button key={slide.id} className={active?.id === slide.id ? "active" : ""} onClick={() => setActiveId(slide.id)}><em>{index + 1}</em><SlideCanvas slide={slide} compact /><span>{slide.text || "No text"}</span></button>)}<button className="add-slide" disabled={busy !== null || project.slides.length >= 35} onClick={() => setPicker(true)}><Plus /> Add images</button></aside>
      <main className="slide-stage">{active ? <><div className="slide-stage-actions"><button onClick={() => move(-1)} disabled={busy !== null || project.slides.indexOf(active) === 0}><ChevronLeft /> Move</button><button onClick={() => move(1)} disabled={busy !== null || project.slides.indexOf(active) === project.slides.length - 1}>Move <ChevronRight /></button><button onClick={duplicate} disabled={busy !== null || project.slides.length >= 35}><Copy /> Duplicate</button><button className="danger" disabled={busy !== null} onClick={remove}><Trash2 /> Remove</button></div><SlideCanvas slide={active} onMove={busy ? undefined : (x, y) => updateSlide({ textX: x, textY: y })} /></> : <button className="empty-slide-stage" disabled={busy !== null} onClick={() => setPicker(true)}><Images /><b>Add your first images</b><span>Upload from your computer or choose from Media.</span></button>}</main>
      <aside className="slide-inspector"><section className="slideshow-output" aria-label="Slideshow output"><p className="eyebrow">Output</p><div className="segmented" role="group" aria-label="Output format">{(["images", "video"] as const).map((format) => <button key={format} disabled={busy !== null} aria-pressed={outputFormat === format} className={outputFormat === format ? "active" : ""} onClick={() => { if (format === outputFormat) return; setProject({ ...project, output: { format, imageSeconds: seconds } }); setJob(null); setVideoResult(null); }}>{format === "images" ? <Images /> : <Video />}{format === "images" ? "Images" : "Video"}</button>)}</div>{outputFormat === "video" ? <><label>{count === 1 ? "Duration" : "Per image"}<select aria-label="Slideshow video seconds per image" disabled={busy !== null} value={seconds} onChange={(event) => setProject({ ...project, output: { format: "video", imageSeconds: Number(event.target.value) } })}>{(count === 1 ? [5, 6, 7, 8, 9, 10] : [3, 4, 5]).map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label><small>{project.slides.length * seconds} seconds · Vertical MP4 · Labels and frames included</small></> : <small>Ordered JPEG images for carousels and photo posts.</small>}{job && renderMatches && <div className="slideshow-render-status"><b role="status">{job.status === "completed" ? "Video saved to Media" : `Video ${job.status}`}</b><progress aria-label="Video render progress" max="100" value={job.progress}/>{job.error && <p role="alert">{job.error}</p>}{pollError && <p role="alert">{pollError}</p>}{pollError && <button className="secondary-button" onClick={() => { setPollError(""); setPollAttempt((current) => current + 1); }}>Check progress</button>}{["queued", "running"].includes(job.status) && <button className="secondary-button" disabled={jobActionBusy} onClick={() => void changeJob("cancel")}>Cancel render</button>}{["failed", "cancelled"].includes(job.status) && <button className="secondary-button" disabled={jobActionBusy} onClick={() => void changeJob("retry")}>Retry render</button>}</div>}{currentVideo?.url && <video aria-label="Rendered slideshow video" src={currentVideo.url} poster={currentVideo.coverUrl} controls playsInline preload="metadata" />}</section><section><p className="eyebrow">Device frame <span>optional</span></p><DeviceFrameControls value={active?.deviceFrame} disabled={!active || busy !== null} onChange={(deviceFrame) => updateSlide({ deviceFrame })}/><small>Wrap the image in a reusable generic device. Labels stay on the full canvas.</small><p className="eyebrow device-frame-label-heading">Label <span>optional</span></p><LabelControls value={labelValue} disabled={!active || busy !== null} helper="Rendered into the PNG" placeholder="This slide can stay visual-only…" onChange={updateLabelControls}/><small>Drag the label on the slide for precise placement.</small><label>Position<select disabled={!active || busy !== null} value={active?.textPosition ?? "bottom"} onChange={(event) => { const textPosition = event.target.value as SlideshowSlide["textPosition"]; updateSlide({ textPosition, textY: textPosition === "top" ? .18 : textPosition === "center" ? .5 : .78 }); }}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label><label>Image fit<select disabled={!active || busy !== null} value={active?.fit ?? "cover"} onChange={(event) => updateSlide({ fit: event.target.value as SlideshowSlide["fit"] })}><option value="cover">Fill / crop</option><option value="contain">Fit whole image</option></select></label></section><CreativePublishHandoff description={outputFormat === "video" ? "Relay saves one vertical MP4 to Media, then opens Create Post for Reels, TikTok, YouTube, and your other destinations." : "Relay saves these slides in order to a new Media folder, then opens the regular composer for destinations, captions, platform options, and timing."} busy={busy === "compose"} disabled={busy !== null || !project.slides.length} busyLabel={outputFormat === "video" ? "Preparing video…" : "Preparing slides…"} onCreate={() => void exportProject("compose")} /></aside>
    </div>
    {picker && <MediaPicker onAdd={addImage} onClose={() => setPicker(false)} />}
    {bulkOpen && <ModalLayer className="modal-layer"><button className="modal-scrim" onClick={() => setBulkOpen(false)} /><section className="bulk-title-modal" role="dialog" aria-modal="true" aria-label="One title per slide"><header><div><p className="eyebrow">Bulk generation</p><h2>One title per slide</h2></div><button className="icon-button" onClick={() => setBulkOpen(false)}><X /></button></header><p>Relay cycles through the images already in this project. Use an em dash (—) for a visual-only slide.</p><textarea autoFocus value={bulkTitles} onChange={(event) => setBulkTitles(event.target.value)} placeholder={"Five mistakes slowing your growth\nThe first one is easy to miss\n—\nHere’s what to do instead"} /><footer><span>{bulkTitles.split("\n").filter(Boolean).length} slides</span><button className="secondary-button" onClick={() => setBulkOpen(false)}>Cancel</button><button className="primary-button" onClick={applyBulk}><WandSparkles /> Generate slides</button></footer></section></ModalLayer>}
  </div>;
}

export default function SlideshowStudio({ onCompose, demoMode = false, initialProjects = [] }: { onCompose: (seed: SlideshowComposerSeed) => void; demoMode?: boolean; initialProjects?: SlideshowProject[] }) {
  const [projects, setProjects] = useState<SlideshowProject[]>(initialProjects); const [active, setActive] = useState<SlideshowProject | null>(null); const [loading, setLoading] = useState(!demoMode); const [error, setError] = useState(""); const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SlideshowProject | null>(null); const [deleteBusy, setDeleteBusy] = useState(false); const [deleteError, setDeleteError] = useState("");
  useEffect(() => { void fetch("/api/v1/slideshows", { cache: "no-store" }).then(async (response) => { const payload = await response.json() as { data?: SlideshowProject[]; error?: string }; if (!response.ok) throw new Error(payload.error || "Could not load slideshows."); if (!demoMode || (payload.data?.length ?? 0) > 0) setProjects(payload.data ?? []); }).catch((reason) => { if (!demoMode) setError(reason instanceof Error ? reason.message : "Could not load slideshows."); }).finally(() => setLoading(false)); }, [demoMode]);
  const saveInList = (project: SlideshowProject) => setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
  const create = async () => { setCreating(true); setError(""); const response = await fetch("/api/v1/slideshows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Untitled slideshow", caption: "", slides: [], brandId: "" }) }); const payload = await response.json() as { data?: SlideshowProject; error?: string }; if (response.ok && payload.data) { saveInList(payload.data); setActive(payload.data); } else setError(payload.error || "Could not create a slideshow."); setCreating(false); };
  const remove = async () => { if (!pendingDelete) return; setDeleteBusy(true); setDeleteError(""); const response = await fetch("/api/v1/slideshows", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: pendingDelete.id }) }); if (response.ok) { setProjects((current) => current.filter((item) => item.id !== pendingDelete.id)); setPendingDelete(null); } else setDeleteError("Could not delete the slideshow."); setDeleteBusy(false); };
  const visible = useMemo(() => projects, [projects]);
  if (active) return <ProjectEditor initial={active} onBack={() => setActive(null)} onSaved={(project) => { setActive(project); saveInList(project); }} onCompose={onCompose} />;
  return <div className="page slideshow-library page-enter"><div className="inline-heading"><div><p className="eyebrow">Reusable creative</p><h2>Slideshow studio</h2><p>Create ordered 9:16 image stories or videos, save them to Media, and publish through Create Post.</p></div><button className="primary-button" disabled={creating} onClick={() => void create()}>{creating ? <LoaderCircle className="spin" /> : <Plus />} New slideshow</button></div>{error && <p className="composer-error">{error}</p>}{loading ? <div className="media-loading"><LoaderCircle className="spin" />Loading slideshows…</div> : visible.length ? <div className="slideshow-project-grid">{visible.map((project) => <article key={project.id}><button className="slideshow-project-cover" onClick={() => setActive(project)}>{project.slides[0] ? <SlideCanvas slide={project.slides[0]} compact /> : <span><Images /></span>}<em>{project.slides.length} slide{project.slides.length === 1 ? "" : "s"}</em></button><div><button onClick={() => setActive(project)}><b>{project.name}</b><span>Edited <LocalDate value={project.updatedAt}/></span></button><button className="icon-button danger" onClick={() => { setDeleteError(""); setPendingDelete(project); }}><Trash2 /></button></div></article>)}</div> : <div className="empty slideshow-empty"><span><Images /></span><h3>No slideshow projects yet</h3><p>Create one, upload images or choose from your Media library, and add optional text to each slide.</p><button className="primary-button" onClick={() => void create()}><Plus /> Create slideshow</button></div>}{pendingDelete && <ConfirmModal eyebrow="Delete slideshow" title={`Delete “${pendingDelete.name}”?`} body="The editable project will be removed. Images already attached to scheduled posts will stay available." confirmLabel="Delete slideshow" busy={deleteBusy} error={deleteError} onClose={() => setPendingDelete(null)} onConfirm={() => void remove()} />}</div>;
}
