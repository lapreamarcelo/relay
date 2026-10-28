"use client";

import { useRef, useState } from "react";
import YoutubeImageVideoPreview from "./youtube-image-video-preview";
import { ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";

interface PreviewMedia {
  name: string;
  previewUrl: string;
  type: "image" | "video";
  urls?: string[];
}

export default function SocialPreviewMedia({ media, immersive, aspectRatio, busy, onImageLoad, onVideoLoad, imageSeconds }: {
  media: PreviewMedia;
  imageSeconds?: number;
  immersive: boolean;
  aspectRatio: number;
  busy: boolean;
  onImageLoad: (width: number, height: number) => void;
  onVideoLoad: (video: HTMLVideoElement) => void;
}) {
  const [slide, setSlide] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const urls = media.urls?.length ? media.urls : [media.previewUrl];
  const carousel = urls.length > 1;
  const source = slide === 0 ? media.previewUrl : urls[slide];
  const move = (index: number) => setSlide(Math.max(0, Math.min(urls.length - 1, index)));

  if (media.type === "image" && imageSeconds !== undefined) return <YoutubeImageVideoPreview name={media.name} urls={[media.previewUrl, ...urls.slice(1)]} seconds={imageSeconds} onImageLoad={onImageLoad} />;

  return <div
    className={`${immersive ? "reel-media" : "preview-media"}${carousel ? " preview-carousel" : ""}`}
    style={immersive ? undefined : { aspectRatio }}
    role={carousel ? "group" : undefined}
    aria-roledescription={carousel ? "carousel" : undefined}
    aria-label={carousel ? "Media preview" : undefined}
    tabIndex={carousel ? 0 : undefined}
    onKeyDown={carousel ? (event) => {
      if (event.target instanceof HTMLVideoElement) return;
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      move(event.key === "Home" ? 0 : event.key === "End" ? urls.length - 1 : slide + (event.key === "ArrowLeft" ? -1 : 1));
    } : undefined}
    onTouchStart={carousel ? (event) => {
      const touch = event.touches[0];
      touchStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null;
    } : undefined}
    onTouchEnd={carousel ? (event) => {
      const start = touchStart.current;
      touchStart.current = null;
      if (!start) return;
      const touch = event.changedTouches[0];
      const deltaX = touch.clientX - start.x;
      if (Math.abs(deltaX) >= 40 && Math.abs(deltaX) > Math.abs(touch.clientY - start.y)) move(slide + (deltaX < 0 ? 1 : -1));
    } : undefined}
    onTouchCancel={() => { touchStart.current = null; }}
  >
    {media.type === "video" ? <video key={source} src={source} muted controls={!immersive} playsInline loop={immersive} autoPlay={immersive} onLoadedMetadata={(event) => onVideoLoad(event.currentTarget)} /> : <img key={source} src={source} alt={carousel ? `${media.name} · Slide ${slide + 1} of ${urls.length}` : media.name} onLoad={(event) => onImageLoad(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />}
    {carousel && <>
      <div className="preview-slide-count" role="status" aria-live="polite" aria-atomic="true">{slide + 1} / {urls.length}</div>
      <button type="button" className="preview-slide-arrow previous" aria-label="Previous slide" disabled={slide === 0} onClick={() => move(slide - 1)}><ChevronLeft /></button>
      <button type="button" className="preview-slide-arrow next" aria-label="Next slide" disabled={slide === urls.length - 1} onClick={() => move(slide + 1)}><ChevronRight /></button>
    </>}
    {busy && <span><LoaderCircle className="spin" />Uploading…</span>}
  </div>;
}
