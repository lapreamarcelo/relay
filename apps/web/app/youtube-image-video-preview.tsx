"use client";

import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import "./youtube-image-video-preview.css";

export default function YoutubeImageVideoPreview({ name, urls, seconds, onImageLoad }: {
  name: string;
  urls: string[];
  seconds: number;
  onImageLoad: (width: number, height: number) => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const duration = urls.length * seconds;
  const finished = elapsed >= duration;
  const slide = Math.min(urls.length - 1, Math.floor(elapsed / seconds));
  useEffect(() => {
    if (!playing || finished) return;
    const timer = window.setInterval(() => setElapsed((current) => Math.min(duration, current + 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [playing, finished, duration]);

  return <div className="reel-media youtube-image-video" role="group" aria-label="YouTube slideshow video preview">
    <img src={urls[slide]} alt={`${name} · Slide ${slide + 1} of ${urls.length}`} onLoad={(event) => onImageLoad(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
    <div className="youtube-image-video-controls">
      <button type="button" aria-label={finished ? "Replay slideshow preview" : playing ? "Pause slideshow preview" : "Play slideshow preview"} onClick={() => { if (finished) { setElapsed(0); setPlaying(true); } else setPlaying((current) => !current); }}>
        {finished ? <RotateCcw /> : playing ? <Pause /> : <Play />}
      </button>
      <span role="status" aria-label="Slideshow playback time">{elapsed}s / {duration}s · {slide + 1} / {urls.length}</span>
    </div>
  </div>;
}
