import type { ProviderId } from "@relay/core";

export const COMPOSER_DRAFT_KEY = "relay-composer-draft-v1";
export interface ComposerDraft {
  version: 1;
  text: string;
  brandId: string;
  campaignId: string;
  selected: string[];
  variants: Partial<Record<ProviderId, string>>;
  media?: { name: string; url: string; previewUrl: string; type: "image" | "video"; urls?: string[] };
  schedule: boolean;
  scheduledAt: string;
  updatedAt: string;
}

export function parseComposerDraft(value: string | null): ComposerDraft | null {
  if (!value) return null;
  try {
    const draft = JSON.parse(value) as Partial<ComposerDraft>;
    if (draft.version !== 1 || typeof draft.text !== "string" || typeof draft.brandId !== "string" || !Array.isArray(draft.selected) || typeof draft.scheduledAt !== "string") return null;
    const media = draft.media?.url ? { ...draft.media, urls: Array.isArray(draft.media.urls) ? draft.media.urls.filter((url): url is string => typeof url === "string" && /^https?:\/\//.test(url)).slice(0, 35) : undefined } : undefined;
    return { version: 1, text: draft.text, brandId: draft.brandId, campaignId: typeof draft.campaignId === "string" ? draft.campaignId : "", selected: draft.selected.filter((item): item is string => typeof item === "string"), variants: draft.variants && typeof draft.variants === "object" ? draft.variants : {}, media, schedule: draft.schedule !== false, scheduledAt: draft.scheduledAt, updatedAt: typeof draft.updatedAt === "string" ? draft.updatedAt : new Date(0).toISOString() };
  } catch { return null; }
}
