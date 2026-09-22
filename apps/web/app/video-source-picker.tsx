"use client";
import type { AssetFolder } from "@relay/core";
import { Film, LoaderCircle, Upload, X } from "lucide-react";
import { useState } from "react";
import { flattenMediaProjects, mediaProjectOptionLabel } from "../lib/media-projects";
type Asset = { key:string; name:string; url:string };
function SourceVideoThumbnail({ asset }: { asset: Asset }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const chooseFrame = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    if (!Number.isFinite(video.duration) || video.duration <= .15) { setState("ready"); return; }
    video.currentTime = Math.min(1, Math.max(.1, video.duration * .08));
  };
  return <div className={`video-source-thumb ${state}`} data-state={state}><span className="video-source-thumb-fallback" aria-hidden="true"><Film/><small>{state === "error" ? "Preview unavailable" : "Loading preview"}</small></span><video src={asset.url} muted playsInline preload="metadata" aria-hidden="true" onLoadedMetadata={chooseFrame} onSeeked={() => setState("ready")} onError={() => setState("error")}/></div>;
}

export function SourcePicker({ folders, videos, folderId, loading, onFolder, onSelect, onUpload, onClose }: { folders: AssetFolder[]; videos: Asset[]; folderId: string; loading: boolean; onFolder: (id: string) => void; onSelect: (asset: Asset) => void; onUpload: () => void; onClose: () => void }) {
  const folderOptions = flattenMediaProjects(folders);
  return <div className="modal-layer video-source-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close video picker"/><section className="video-source-picker" role="dialog" aria-modal="true" aria-labelledby="video-source-title"><header><div><p className="eyebrow">Cloudflare R2 media</p><h2 id="video-source-title">Choose your source clip</h2><p>Pick a reusable video now; labels and music stay editable.</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><X/></button></header><div className="video-source-toolbar"><label>Media folder<select aria-label="Source media folder" value={folderId} onChange={(event) => onFolder(event.target.value)}><option value="">All media folders</option>{folderOptions.map(({ project: folder, depth }) => <option value={folder.id} key={folder.id}>{mediaProjectOptionLabel(`${folder.name} · ${folder.count}`, depth)}</option>)}</select></label><button className="secondary-button" onClick={onUpload}><Upload/> Upload from device</button></div>{loading ? <div className="video-source-empty"><LoaderCircle className="spin"/><b>Loading your clips…</b></div> : videos.length ? <div className="video-source-grid">{videos.map((video) => <button onClick={() => onSelect(video)} key={video.key}><SourceVideoThumbnail asset={video}/><span><Film/><b>{video.name}</b><small>Use this clip</small></span></button>)}</div> : <div className="video-source-empty"><span><Film/></span><b>No videos in this folder yet</b><p>Upload a clip from this device or choose another media folder.</p><button className="primary-button" onClick={onUpload}><Upload/> Upload a video</button></div>}</section></div>;
}
