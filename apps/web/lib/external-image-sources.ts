export type ExternalImageProvider = "pexels";

export interface ExternalImageResult {
  id: string;
  provider: ExternalImageProvider;
  title: string;
  previewUrl: string;
  importUrl: string;
  sourceUrl: string;
  creator?: string;
  creatorUrl?: string;
  attribution: string;
}

interface UnknownRecord { [key: string]: unknown }

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown, maximum = 2_000): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function httpUrl(value: unknown): string {
  const candidate = text(value);
  if (!candidate) return "";
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch { return ""; }
}

export function normalizePexelsResults(value: unknown): ExternalImageResult[] {
  const payload = record(value);
  const photos = Array.isArray(payload?.photos) ? payload.photos : [];
  return photos.flatMap((candidate) => {
    const photo = record(candidate); const src = record(photo?.src);
    const id = String(photo?.id ?? "").trim();
    const previewUrl = httpUrl(src?.medium || src?.small || src?.portrait);
    const importUrl = httpUrl(src?.large2x || src?.large || src?.portrait || src?.original || previewUrl);
    const sourceUrl = httpUrl(photo?.url);
    if (!id || !previewUrl || !importUrl || !sourceUrl) return [];
    const creator = text(photo?.photographer, 200) || "Pexels photographer";
    const creatorUrl = httpUrl(photo?.photographer_url) || undefined;
    return [{
      id: `pexels-${id}`,
      provider: "pexels" as const,
      title: text(photo?.alt, 300) || `Pexels photo ${id}`,
      previewUrl,
      importUrl,
      sourceUrl,
      creator,
      creatorUrl,
      attribution: `Photo by ${creator} on Pexels`,
    }];
  });
}

export function allowedExternalImageUrl(provider: ExternalImageProvider, value: unknown): URL | null {
  const candidate = httpUrl(value);
  if (!candidate) return null;
  const parsed = new URL(candidate);
  if (parsed.protocol !== "https:") return null;
  const hostname = parsed.hostname.toLowerCase();
  if (provider === "pexels" && hostname === "images.pexels.com") return parsed;
  return null;
}

export function safeExternalImageName(provider: ExternalImageProvider, id: unknown, contentType: string): string {
  const rawId = text(id, 120).replace(new RegExp(`^${provider}-`, "i"), "");
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || crypto.randomUUID();
  const extension = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : contentType === "image/avif" ? "avif" : contentType === "image/gif" ? "gif" : "jpg";
  return `${provider}-${safeId}.${extension}`;
}
