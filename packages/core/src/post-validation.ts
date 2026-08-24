import type { ProviderId, ProviderPostSettings } from "./index.ts";

export interface PostValidationIssue {
  provider?: ProviderId;
  field: "content" | "media" | "caption" | "settings" | "schedule";
  message: string;
}

const captionLimits: Record<ProviderId, number> = { instagram: 2_200, facebook: 63_206, tiktok: 2_200, youtube: 5_000 };

export function validatePostPlan(input: {
  text: string;
  mediaType: "none" | "image" | "video";
  mediaCount?: number;
  scheduledAt?: string | null;
  destinations: Array<{ provider: ProviderId; settings: ProviderPostSettings; textOverride?: string }>;
}): PostValidationIssue[] {
  const issues: PostValidationIssue[] = [];
  if (!input.text.trim() && input.mediaType === "none") issues.push({ field: "content", message: "Add a caption or media before publishing." });
  if (input.scheduledAt && (Number.isNaN(new Date(input.scheduledAt).getTime()) || new Date(input.scheduledAt).getTime() <= Date.now())) issues.push({ field: "schedule", message: "Choose a publishing time in the future." });
  for (const destination of input.destinations) {
    const caption = destination.textOverride?.trim() || input.text.trim();
    if (caption.length > captionLimits[destination.provider]) issues.push({ provider: destination.provider, field: "caption", message: `Caption exceeds the ${captionLimits[destination.provider].toLocaleString()} character limit.` });
    if (destination.provider === "youtube" && input.mediaType !== "video") issues.push({ provider: "youtube", field: "media", message: "YouTube publishing requires a video." });
    if (destination.provider === "instagram" && (input.mediaCount ?? 0) > 10) issues.push({ provider: "instagram", field: "media", message: "Instagram carousels support up to 10 slides." });
    if (destination.provider === "tiktok" && input.mediaType === "none") issues.push({ provider: "tiktok", field: "media", message: "TikTok publishing requires an image or video." });
    if (destination.settings.kind === "instagram" && destination.settings.publishType !== "feed" && input.mediaType === "none") issues.push({ provider: "instagram", field: "media", message: `Instagram ${destination.settings.publishType}s require media.` });
    if (destination.settings.kind === "instagram" && destination.settings.publishType !== "feed" && (input.mediaCount ?? 0) > 1) issues.push({ provider: "instagram", field: "settings", message: "Instagram carousels publish as feed posts." });
    if (destination.settings.kind === "facebook" && destination.settings.publishType === "reel" && input.mediaType !== "video") issues.push({ provider: "facebook", field: "media", message: "Facebook Reels require a video." });
    if (destination.settings.kind === "facebook" && destination.settings.publishType !== "feed" && (input.mediaCount ?? 0) > 1) issues.push({ provider: "facebook", field: "settings", message: "Facebook multi-photo posts publish to the feed." });
    if (destination.settings.kind === "youtube" && !destination.settings.title.trim()) issues.push({ provider: "youtube", field: "settings", message: "Add a YouTube title." });
  }
  return issues;
}
