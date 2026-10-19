"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Match SSR during hydration, then display the browser's locale and timezone. */
export function LocalDate({ value, kind = "date", options }: { value: string | number; kind?: "date" | "time" | "dateTime"; options?: Intl.DateTimeFormatOptions }) {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return <span>—</span>;
  const locale = hydrated ? undefined : "en-US";
  const settings = hydrated ? options : { ...options, timeZone: options?.timeZone ?? "UTC" };
  const formatted = kind === "time" ? date.toLocaleTimeString(locale, settings) : kind === "dateTime" ? date.toLocaleString(locale, settings) : date.toLocaleDateString(locale, settings);
  return <time dateTime={date.toISOString()}>{formatted}</time>;
}
