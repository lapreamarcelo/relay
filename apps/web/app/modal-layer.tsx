"use client";

import { useEffect, useState, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";

// Keep fixed overlays outside animated pages and other containing blocks.
export default function ModalLayer({ children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted ? createPortal(<div {...props}>{children}</div>, document.body) : null;
}
