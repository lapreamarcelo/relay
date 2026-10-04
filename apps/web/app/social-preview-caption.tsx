"use client";

import { useEffect, useRef, useState } from "react";

export default function SocialPreviewCaption({ text, className = "" }: { text: string; className?: string }) {
  const captionRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => { setExpanded(false); }, [text]);
  useEffect(() => {
    const caption = captionRef.current;
    if (!caption || expanded) return;
    const measure = () => setTruncated(caption.scrollHeight > caption.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(caption);
    return () => observer.disconnect();
  }, [text, expanded]);

  return <div className={`preview-caption ${className}`}>
    <p ref={captionRef} className={`preview-caption-text${expanded ? " expanded" : ""}`}>{text}</p>
    {truncated && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "less" : "more"}</button>}
  </div>;
}
