"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Brand, RelayPost, SlideshowProject, SlideshowSlide, SocialAccount } from "@relay/core";
import {
  ArrowLeft, CalendarDays, Check, ChevronLeft, ChevronRight, Copy, Images, LoaderCircle,
  Folder, Plus, Save, Send, Sparkles, Trash2, Upload, WandSparkles, X,
} from "lucide-react";
import { ConfirmModal } from "./confirm-modal";

interface MediaObject { key: string; name: string; url: string }
interface MediaProject { id: string; name: string }

const tomorrowMorning = () => {
  const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(9, 30, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function newSlide(mediaUrl: string, text = ""): SlideshowSlide {
  return { id: crypto.randomUUID(), mediaUrl, text: text || undefined, fit: "cover", textPosition: "bottom", textSize: 64, textColor: "#FFFFFF", textBackground: "dark" };
}

function SlideCanvas({ slide, compact = false }: { slide: SlideshowSlide; compact?: boolean }) {
  const style = { "--slide-size": `${slide.textSize}px`, "--slide-color": slide.textColor } as React.CSSProperties;
  return <div className={`slide-canvas ${compact ? "compact" : ""}`} style={style}>
    <img src={slide.renderedUrl ?? slide.mediaUrl} alt="" />
    {!slide.renderedUrl && slide.text && <div className={`slide-title ${slide.textPosition} bg-${slide.textBackground}`}>{slide.text}</div>}
    {slide.renderedUrl && <span className="slide-rendered"><Check /> Rendered</span>}
  </div>;
}

function MediaPicker({ onAdd, onClose }: { onAdd: (url: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<MediaObject[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [projects, setProjects] = useState<MediaProject[]>([]); const [projectId, setProjectId] = useState("all");
  const [uploading, setUploading] = useState(false); const [uploadProgress, setUploadProgress] = useState(""); const fileInput = useRef<HTMLInputElement>(null);
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
  useEffect(() => { void fetch("/api/v1/media/projects", { cache: "no-store" }).then(async (response) => { const payload = await response.json() as { data?: MediaProject[] }; if (response.ok) setProjects(payload.data ?? []); }); }, []);
  const uploadOne = async (file: File) => {
    const uploadProjectId = projectId !== "all" && projectId !== "unfiled" ? projectId : undefined;
    const signedResponse = await fetch("/api/v1/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type, projectId: uploadProjectId }) });
    const signed = await signedResponse.json() as { uploadUrl?: string; url?: string; error?: string };
    if (!signedResponse.ok || !signed.uploadUrl || !signed.url) throw new Error(signed.error || `Could not prepare ${file.name}.`);
    try {
      const direct = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      if (direct.ok) return signed.url;
    } catch { /* The server upload below handles browsers where R2 CORS blocks direct PUTs. */ }
    const form = new FormData(); form.append("file", file); if (uploadProjectId) form.append("projectId", uploadProjectId);
    const fallbackResponse = await fetch("/api/v1/media", { method: "POST", body: form });
    const fallback = await fallbackResponse.json() as { url?: string; error?: string };
    if (!fallbackResponse.ok || !fallback.url) throw new Error(fallback.error || `Could not upload ${file.name}.`);
    return fallback.url;
  };
  const uploadFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((file) => file.type.startsWith("image/")).slice(0, 35);
    if (!files.length) return;
    setUploading(true); setError("");
    try {
      for (let index = 0; index < files.length; index += 1) {
        setUploadProgress(`Uploading ${index + 1} of ${files.length}…`);
        const url = await uploadOne(files[index]);
        onAdd(url);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not upload the selected images."); }
    finally { setUploading(false); setUploadProgress(""); if (fileInput.current) fileInput.current.value = ""; }
  };
  return <div className="modal-layer slideshow-media-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close media library" /><section className="slideshow-media-picker" role="dialog" aria-modal="true" aria-labelledby="slide-media-title"><header><div><p className="eyebrow">Add media</p><h2 id="slide-media-title">Add images to the slideshow</h2><p>Upload new images or choose ones already in your Media library.</p></div><button className="icon-button" onClick={onClose}><X /></button></header><div className="slideshow-upload-source"><div><Upload /><span><b>Upload from computer</b><small>Select several images and they’ll be added in order.</small></span></div><input ref={fileInput} hidden type="file" accept="image/*" multiple onChange={(event) => void uploadFiles(event.target.files)} /><button className="primary-button" disabled={uploading} onClick={() => fileInput.current?.click()}>{uploading ? <LoaderCircle className="spin" /> : <Upload />}{uploading ? uploadProgress : "Choose files"}</button></div><div className="slideshow-media-body"><label className="media-project-select"><Folder />Media project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="all">All media</option><option value="unfiled">Unsorted</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label><div className="slideshow-media-label"><div><Images /><span><b>Media library</b><small>Your existing images stored in Cloudflare.</small></span></div><span>{items.length} available</span></div>{error && <p className="composer-error">{error}</p>}{loading ? <div className="media-loading"><LoaderCircle className="spin" />Loading images…</div> : <div className="slideshow-media-grid">{items.map((item) => <button key={item.key} onClick={() => onAdd(item.url)}><img src={item.url} alt={item.name} /><span><Plus /> Add</span><b>{item.name}</b></button>)}{!items.length && <p>No images in this project yet. Upload some above.</p>}</div>}</div><footer><span>Select as many images as you need</span><button className="primary-button" onClick={onClose}>Done</button></footer></section></div>;
}

function ProjectEditor({ initial, accounts, brands, onBack, onSaved, onCreatePost }: { initial: SlideshowProject; accounts: SocialAccount[]; brands: Brand[]; onBack: () => void; onSaved: (project: SlideshowProject) => void; onCreatePost: (post: RelayPost) => Promise<boolean> }) {
  const [project, setProject] = useState(initial); const [activeId, setActiveId] = useState(initial.slides[0]?.id ?? "");
  const [picker, setPicker] = useState(false); const [bulkOpen, setBulkOpen] = useState(false); const [bulkTitles, setBulkTitles] = useState("");
  const [busy, setBusy] = useState<"save" | "render" | "schedule" | null>(null); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const [accountId, setAccountId] = useState(""); const [scheduledAt, setScheduledAt] = useState(tomorrowMorning); const [publishNow, setPublishNow] = useState(false);
  const [privacy, setPrivacy] = useState<"SELF_ONLY" | "FOLLOWER_OF_CREATOR" | "MUTUAL_FOLLOW_FRIENDS" | "PUBLIC_TO_EVERYONE">("SELF_ONLY");
  const active = project.slides.find((slide) => slide.id === activeId) ?? project.slides[0];
  const destinations = accounts.filter((account) => account.provider === "tiktok" && account.status === "connected" && account.brandId === (project.brandId || null));
  useEffect(() => { if (!destinations.some((account) => account.id === accountId)) setAccountId(destinations[0]?.id ?? ""); }, [project.brandId, destinations, accountId]);

  const replace = (next: SlideshowProject) => { setProject(next); onSaved(next); setActiveId((current) => next.slides.some((slide) => slide.id === current) ? current : next.slides[0]?.id ?? ""); };
  const updateSlide = (changes: Partial<SlideshowSlide>) => setProject((current) => ({ ...current, slides: current.slides.map((slide) => slide.id === active?.id ? { ...slide, ...changes, renderedUrl: undefined } : slide) }));
  const addImage = (url: string) => { const slide = newSlide(url); setProject((current) => { if (current.slides.length >= 35) return current; setActiveId(slide.id); return { ...current, slides: [...current.slides, slide] }; }); };
  const save = async (): Promise<SlideshowProject | null> => {
    setError(""); setMessage("");
    const response = await fetch("/api/v1/slideshows", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) });
    const payload = await response.json() as { data?: SlideshowProject; error?: string };
    if (!response.ok || !payload.data) { setError(payload.error || "Could not save the slideshow."); return null; }
    replace(payload.data); return payload.data;
  };
  const saveOnly = async () => { setBusy("save"); const saved = await save(); if (saved) setMessage("Project saved for reuse."); setBusy(null); };
  const render = async (): Promise<SlideshowProject | null> => {
    const saved = await save(); if (!saved) return null;
    const response = await fetch("/api/v1/slideshows/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: saved.id }) });
    const payload = await response.json() as { data?: SlideshowProject; error?: string };
    if (!response.ok || !payload.data) { setError(payload.error || "Could not render the slideshow."); return null; }
    replace(payload.data); return payload.data;
  };
  const renderOnly = async () => { if (!project.slides.length) return; setBusy("render"); const rendered = await render(); if (rendered) setMessage(`${rendered.slides.length} independent PNG${rendered.slides.length === 1 ? "" : "s"} saved to R2.`); setBusy(null); };
  const schedule = async () => {
    if (!accountId || !project.slides.length || (!publishNow && !scheduledAt)) return;
    setBusy("schedule"); setError(""); setMessage("");
    const rendered = await render();
    if (!rendered) { setBusy(null); return; }
    const urls = rendered.slides.map((slide) => slide.renderedUrl).filter((url): url is string => Boolean(url));
    const status = publishNow ? "publishing" as const : "scheduled" as const;
    const ok = await onCreatePost({ id: "", brandId: rendered.brandId, text: rendered.caption, mediaType: "image", mediaUrl: urls[0], mediaUrls: urls, status, scheduledAt: publishNow ? undefined : new Date(scheduledAt).toISOString(), targets: [{ id: "", accountId, provider: "tiktok", status, settings: { kind: "tiktok", privacyLevel: privacy, allowComments: true, allowDuet: false, allowStitch: false } }] });
    if (ok) setMessage(publishNow ? "Slideshow handed to TikTok publishing." : "Slideshow scheduled. This rendered version is now locked to the post.");
    else setError("The rendered slides were saved, but the post could not be scheduled.");
    setBusy(null);
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

  return <div className="slideshow-editor page-enter">
    <header className="slideshow-editor-head"><button className="icon-button" onClick={onBack}><ArrowLeft /></button><div><p className="eyebrow">Slideshow studio</p><input aria-label="Project name" value={project.name} maxLength={120} onChange={(event) => setProject({ ...project, name: event.target.value })} /></div><div><button className="secondary-button" onClick={() => setBulkOpen(true)}><WandSparkles /> Bulk titles</button><button className="secondary-button" disabled={busy !== null} onClick={() => void saveOnly()}>{busy === "save" ? <LoaderCircle className="spin" /> : <Save />} Save</button><button className="primary-button" disabled={busy !== null || !project.slides.length} onClick={() => void renderOnly()}>{busy === "render" ? <LoaderCircle className="spin" /> : <Sparkles />} Render all</button></div></header>
    {(error || message) && <div className={`slideshow-notice ${error ? "error" : "success"}`}>{error || message}<button onClick={() => { setError(""); setMessage(""); }}><X /></button></div>}
    <div className="slideshow-workbench">
      <aside className="slide-rail"><div><b>Slides</b><span>{project.slides.length}/35</span></div>{project.slides.map((slide, index) => <button key={slide.id} className={active?.id === slide.id ? "active" : ""} onClick={() => setActiveId(slide.id)}><em>{index + 1}</em><SlideCanvas slide={slide} compact /><span>{slide.text || "No text"}</span></button>)}<button className="add-slide" disabled={project.slides.length >= 35} onClick={() => setPicker(true)}><Plus /> Add images</button></aside>
      <main className="slide-stage">{active ? <><div className="slide-stage-actions"><button onClick={() => move(-1)} disabled={project.slides.indexOf(active) === 0}><ChevronLeft /> Move</button><button onClick={() => move(1)} disabled={project.slides.indexOf(active) === project.slides.length - 1}>Move <ChevronRight /></button><button onClick={duplicate} disabled={project.slides.length >= 35}><Copy /> Duplicate</button><button className="danger" onClick={remove}><Trash2 /> Remove</button></div><SlideCanvas slide={active} /></> : <button className="empty-slide-stage" onClick={() => setPicker(true)}><Images /><b>Add your first images</b><span>Upload from your computer or choose from Media.</span></button>}</main>
      <aside className="slide-inspector"><section><p className="eyebrow">Slide text <span>optional</span></p><textarea disabled={!active} value={active?.text ?? ""} maxLength={500} placeholder="This slide can stay visual-only…" onChange={(event) => updateSlide({ text: event.target.value || undefined })} /><small>{active?.text?.length ?? 0}/500 · Text is rendered into the PNG</small></section><section><label>Position<select disabled={!active} value={active?.textPosition ?? "bottom"} onChange={(event) => updateSlide({ textPosition: event.target.value as SlideshowSlide["textPosition"] })}><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select></label><label>Size<input disabled={!active} type="range" min="28" max="120" value={active?.textSize ?? 64} onChange={(event) => updateSlide({ textSize: Number(event.target.value) })} /><span>{active?.textSize ?? 64}px</span></label><label>Text color<input disabled={!active} type="color" value={active?.textColor ?? "#FFFFFF"} onChange={(event) => updateSlide({ textColor: event.target.value.toUpperCase() })} /></label><label>Backdrop<select disabled={!active} value={active?.textBackground ?? "dark"} onChange={(event) => updateSlide({ textBackground: event.target.value as SlideshowSlide["textBackground"] })}><option value="dark">Dark glass</option><option value="light">Light glass</option><option value="none">Outline only</option></select></label><label>Image fit<select disabled={!active} value={active?.fit ?? "cover"} onChange={(event) => updateSlide({ fit: event.target.value as SlideshowSlide["fit"] })}><option value="cover">Fill 9:16</option><option value="contain">Fit whole image</option></select></label></section><section className="slideshow-publish"><p className="eyebrow">Schedule to TikTok</p><label>Brand<select value={project.brandId} onChange={(event) => setProject({ ...project, brandId: event.target.value })}><option value="">Unassigned accounts</option>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select></label><label>Account<select value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Choose an account</option>{destinations.map((account) => <option value={account.id} key={account.id}>{account.displayName} · {account.handle}</option>)}</select></label>{!destinations.length && <small>No connected TikTok account is assigned to this project’s brand.</small>}<label>Caption<textarea value={project.caption} maxLength={2200} onChange={(event) => setProject({ ...project, caption: event.target.value })} placeholder="TikTok caption…" /></label><label>Visibility<select value={privacy} onChange={(event) => setPrivacy(event.target.value as typeof privacy)}><option value="SELF_ONLY">Only me</option><option value="MUTUAL_FOLLOW_FRIENDS">Friends</option><option value="FOLLOWER_OF_CREATOR">Followers</option><option value="PUBLIC_TO_EVERYONE">Everyone</option></select></label><div className="slideshow-schedule-mode"><button className={!publishNow ? "active" : ""} onClick={() => setPublishNow(false)}><CalendarDays /> Schedule</button><button className={publishNow ? "active" : ""} onClick={() => setPublishNow(true)}><Send /> Now</button></div>{!publishNow && <input type="datetime-local" min={new Date().toISOString().slice(0, 16)} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />}<button className="primary-button" disabled={busy !== null || !accountId || !project.slides.length} onClick={() => void schedule()}>{busy === "schedule" ? <LoaderCircle className="spin" /> : <Send />}{busy === "schedule" ? "Rendering…" : publishNow ? "Render & publish" : "Render & schedule"}</button></section></aside>
    </div>
    {picker && <MediaPicker onAdd={addImage} onClose={() => setPicker(false)} />}
    {bulkOpen && <div className="modal-layer"><button className="modal-scrim" onClick={() => setBulkOpen(false)} /><section className="bulk-title-modal"><header><div><p className="eyebrow">Bulk generation</p><h2>One title per slide</h2></div><button className="icon-button" onClick={() => setBulkOpen(false)}><X /></button></header><p>Relay cycles through the images already in this project. Use an em dash (—) for a visual-only slide.</p><textarea autoFocus value={bulkTitles} onChange={(event) => setBulkTitles(event.target.value)} placeholder={"Five mistakes slowing your growth\nThe first one is easy to miss\n—\nHere’s what to do instead"} /><footer><span>{bulkTitles.split("\n").filter(Boolean).length} slides</span><button className="secondary-button" onClick={() => setBulkOpen(false)}>Cancel</button><button className="primary-button" onClick={applyBulk}><WandSparkles /> Generate slides</button></footer></section></div>}
  </div>;
}

export default function SlideshowStudio({ accounts, brands, onCreatePost }: { accounts: SocialAccount[]; brands: Brand[]; onCreatePost: (post: RelayPost) => Promise<boolean> }) {
  const [projects, setProjects] = useState<SlideshowProject[]>([]); const [active, setActive] = useState<SlideshowProject | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(""); const [creating, setCreating] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SlideshowProject | null>(null); const [deleteBusy, setDeleteBusy] = useState(false); const [deleteError, setDeleteError] = useState("");
  useEffect(() => { void fetch("/api/v1/slideshows", { cache: "no-store" }).then(async (response) => { const payload = await response.json() as { data?: SlideshowProject[]; error?: string }; if (!response.ok) throw new Error(payload.error || "Could not load slideshows."); setProjects(payload.data ?? []); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load slideshows.")).finally(() => setLoading(false)); }, []);
  const saveInList = (project: SlideshowProject) => setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
  const create = async () => { setCreating(true); setError(""); const response = await fetch("/api/v1/slideshows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Untitled slideshow", caption: "", slides: [], brandId: "" }) }); const payload = await response.json() as { data?: SlideshowProject; error?: string }; if (response.ok && payload.data) { saveInList(payload.data); setActive(payload.data); } else setError(payload.error || "Could not create a slideshow."); setCreating(false); };
  const remove = async () => { if (!pendingDelete) return; setDeleteBusy(true); setDeleteError(""); const response = await fetch("/api/v1/slideshows", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: pendingDelete.id }) }); if (response.ok) { setProjects((current) => current.filter((item) => item.id !== pendingDelete.id)); setPendingDelete(null); } else setDeleteError("Could not delete the slideshow."); setDeleteBusy(false); };
  const visible = useMemo(() => projects, [projects]);
  if (active) return <ProjectEditor initial={active} accounts={accounts} brands={brands} onBack={() => setActive(null)} onSaved={(project) => { setActive(project); saveInList(project); }} onCreatePost={onCreatePost} />;
  return <div className="page slideshow-library page-enter"><div className="inline-heading"><div><p className="eyebrow">Reusable creative</p><h2>Slideshow studio</h2><p>Create 9:16 image stories and schedule them directly to TikTok.</p></div><button className="primary-button" disabled={creating} onClick={() => void create()}>{creating ? <LoaderCircle className="spin" /> : <Plus />} New slideshow</button></div>{error && <p className="composer-error">{error}</p>}{loading ? <div className="media-loading"><LoaderCircle className="spin" />Loading slideshows…</div> : visible.length ? <div className="slideshow-project-grid">{visible.map((project) => <article key={project.id}><button className="slideshow-project-cover" onClick={() => setActive(project)}>{project.slides[0] ? <SlideCanvas slide={project.slides[0]} compact /> : <span><Images /></span>}<em>{project.slides.length} slide{project.slides.length === 1 ? "" : "s"}</em></button><div><button onClick={() => setActive(project)}><b>{project.name}</b><span>Edited {new Date(project.updatedAt).toLocaleDateString()}</span></button><button className="icon-button danger" onClick={() => { setDeleteError(""); setPendingDelete(project); }}><Trash2 /></button></div></article>)}</div> : <div className="empty slideshow-empty"><span><Images /></span><h3>No slideshow projects yet</h3><p>Create one, upload images or choose from your Media library, and add optional text to each slide.</p><button className="primary-button" onClick={() => void create()}><Plus /> Create slideshow</button></div>}{pendingDelete && <ConfirmModal eyebrow="Delete slideshow" title={`Delete “${pendingDelete.name}”?`} body="The editable project will be removed. Images already attached to scheduled posts will stay available." confirmLabel="Delete slideshow" busy={deleteBusy} error={deleteError} onClose={() => setPendingDelete(null)} onConfirm={() => void remove()} />}</div>;
}
