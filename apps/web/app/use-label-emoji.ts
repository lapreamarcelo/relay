"use client";

import { useEffect, useState } from "react";
import { preloadLabelEmoji } from "../lib/label-emoji";

/** Repaint reserved emoji slots once their local artwork is ready. */
export function useLabelEmoji(text: string): string {
  const [, refresh] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void preloadLabelEmoji(text).then(() => {
      if (active) { setError(""); refresh(version => version + 1); }
    }).catch(() => { if (active) setError("Could not load emoji artwork. Reload the editor to try again."); });
    return () => { active = false; };
  }, [text]);
  return error;
}
