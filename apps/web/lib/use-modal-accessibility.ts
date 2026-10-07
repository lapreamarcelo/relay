"use client";

import { useEffect } from "react";
import { lockPageScroll } from "./page-scroll-lock";

const selector = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

export function useModalAccessibility(): void {
  useEffect(() => {
    let activeDialog: HTMLElement | null = null;
    let restoreTarget: HTMLElement | null = null;
    let releaseScroll: (() => void) | null = null;
    const sync = () => {
      const nativeDialog = [...document.querySelectorAll<HTMLElement>("dialog:modal")].at(-1);
      const next = nativeDialog ?? [...document.querySelectorAll<HTMLElement>("[aria-modal='true']")].at(-1) ?? null;
      if (next === activeDialog) return;
      if (!next) { releaseScroll?.(); releaseScroll = null; if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true }); }
      if (next) {
        releaseScroll ??= lockPageScroll();
        if (!activeDialog) restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        queueMicrotask(() => { if (next.isConnected) (next.querySelector<HTMLElement>("[autofocus],input,textarea,select,button,a[href]") ?? next).focus({ preventScroll: true }); });
      }
      activeDialog = next;
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["open"] }); sync();
    const keydown = (event: KeyboardEvent) => {
      if (!activeDialog || event.defaultPrevented) return;
      if (event.key === "Escape") {
        const scrim = activeDialog.closest(".modal-layer,.composer-layer,.notification-layer")?.querySelector<HTMLButtonElement>(".modal-scrim,.notification-scrim");
        if (scrim && !scrim.disabled) { event.preventDefault(); scrim.click(); }
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...activeDialog.querySelectorAll<HTMLElement>(selector)].filter((item) => item.offsetParent !== null);
      if (items.length === 0) { event.preventDefault(); activeDialog.focus(); return; }
      const first = items[0]; const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { observer.disconnect(); document.removeEventListener("keydown", keydown); releaseScroll?.(); };
  }, []);
}
