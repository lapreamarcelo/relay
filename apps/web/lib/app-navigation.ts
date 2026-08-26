export const relayViews = ["home", "calendar", "posts", "analytics", "slideshows", "videos", "media", "brands", "accounts", "settings", "docs"] as const;
export type RelayView = typeof relayViews[number];

export const viewLabel: Record<RelayView, string> = {
  home: "Home", calendar: "Calendar", posts: "Posts", analytics: "Analytics", slideshows: "Slide Studio", videos: "Video Studio",
  media: "Media", brands: "Brands", accounts: "Accounts", settings: "Settings", docs: "CLI & API",
};

export function parseRelayView(value: string | null | undefined): RelayView {
  return relayViews.includes(value as RelayView) ? value as RelayView : "home";
}

export function relayViewUrl(view: RelayView, current?: URL): string {
  const url = current ? new URL(current) : new URL("http://relay.local/");
  if (view === "home") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  return `${url.pathname}${url.search}${url.hash}`;
}
