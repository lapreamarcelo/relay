"use client";

import { useEffect } from "react";

const selector = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

export function useModalAccessibility(): void {
  useEffect(() => {
    let activeDialog: HTMLElement | null = null;
    let restoreTarget: HTMLElement | null = null;
    const sync = () => {
      const next = [...document.querySelectorAll<HTMLElement>("[aria-modal='true']")].at(-1) ?? null;
      if (next === activeDialog) return;
      if (!next && restoreTarget?.isConnected) restoreTarget.focus();
      if (next) {
        if (!activeDialog) restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        queueMicrotask(() => (next.querySelector<HTMLElement>("[autofocus],input,textarea,select,button,a[href]") ?? next).focus());
      }
      activeDialog = next;
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true }); sync();
    const keydown = (event: KeyboardEvent) => {
      if (!activeDialog) return;
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
    return () => { observer.disconnect(); document.removeEventListener("keydown", keydown); };
  }, []);
}
