"use client";

import { useRef, useState, type ComponentPropsWithRef } from "react";
import { mediaPreviewUrl } from "../lib/browser-library-media";

/** Retry unavailable public storage through the authenticated media endpoint. */
export function LibraryAudio({ src, onError, onPlay, onPause, onLoadedMetadata, ...props }: ComponentPropsWithRef<"audio"> & { src: string }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const resume = useRef(false);
  const fallback = failedSource === src;
  return <audio {...props} preload={fallback && props.preload === "none" ? "metadata" : props.preload} src={fallback ? mediaPreviewUrl(src) : src} onPlay={event => {
    resume.current = true;
    onPlay?.(event);
  }} onPause={event => {
    if (!event.currentTarget.error) resume.current = false;
    onPause?.(event);
  }} onLoadedMetadata={event => {
    onLoadedMetadata?.(event);
    // Timeline players synchronize playback themselves; only native controls
    // need their interrupted user play request resumed here.
    if (props.controls && fallback && resume.current) void event.currentTarget.play().catch(() => {});
  }} onError={event => {
    if (!fallback && /^https:\/\//i.test(src) && new URL(src).origin !== location.origin) setFailedSource(src);
    else onError?.(event);
  }}/>;
}
