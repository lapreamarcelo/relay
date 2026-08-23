import type { SlideshowProject, SlideshowSlide } from "@relay/core";

export interface SlideshowRow {
  id: string;
  brand_id: string | null;
  name: string;
  caption: string;
  slides: SlideshowSlide[];
  created_at: string | Date;
  updated_at: string | Date;
}

function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch { return null; }
}

function color(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
}

export function normalizeSlides(value: unknown): SlideshowSlide[] | null {
  if (!Array.isArray(value) || value.length > 35) return null;
  const slides: SlideshowSlide[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const input = candidate as Record<string, unknown>;
    const mediaUrl = webUrl(input.mediaUrl);
    if (!mediaUrl) return null;
    const renderedUrl = webUrl(input.renderedUrl);
    const text = typeof input.text === "string" ? input.text.trim().slice(0, 500) : "";
    const textSize = Math.min(120, Math.max(28, Math.round(Number(input.textSize) || 64)));
    const requestedId = typeof input.id === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(input.id) ? input.id : "";
    const id = requestedId && !ids.has(requestedId) ? requestedId : crypto.randomUUID();
    ids.add(id);
    slides.push({
      id,
      mediaUrl,
      renderedUrl: renderedUrl ?? undefined,
      text: text || undefined,
      fit: input.fit === "contain" ? "contain" : "cover",
      textPosition: input.textPosition === "top" || input.textPosition === "center" ? input.textPosition : "bottom",
      textSize,
      textColor: color(input.textColor, "#FFFFFF"),
      textBackground: input.textBackground === "none" || input.textBackground === "light" ? input.textBackground : "dark",
    });
  }
  return slides;
}

export function serializeSlideshow(row: SlideshowRow): SlideshowProject {
  return {
    id: row.id,
    brandId: row.brand_id ?? "",
    name: row.name,
    caption: row.caption,
    slides: row.slides,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
