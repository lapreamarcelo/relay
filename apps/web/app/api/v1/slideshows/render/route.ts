import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { SlideshowSlide } from "@relay/core";
import { sql } from "@relay/database";
import sharp from "sharp";

import { requireApiSession } from "../../../../../lib/api-session";
import { getR2Client, getR2Config, publicObjectUrl } from "../../../../../lib/r2";
import { serializeSlideshow, type SlideshowRow } from "../../../../../lib/slideshows";

export const runtime = "nodejs";
export const maxDuration = 300;

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function wrapTitle(value: string, size: number): string[] {
  const limit = Math.max(10, Math.floor(820 / (size * .58)));
  const lines: string[] = [];
  for (const paragraph of value.split(/\n/)) {
    let current = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (!current || `${current} ${word}`.length <= limit) current = current ? `${current} ${word}` : word;
      else { lines.push(current); current = word; }
    }
    if (current) lines.push(current);
  }
  return lines.slice(0, 8);
}

function titleOverlay(slide: SlideshowSlide): Buffer | null {
  if (!slide.text) return null;
  const lines = wrapTitle(slide.text, slide.textSize);
  const lineHeight = Math.round(slide.textSize * 1.18);
  const height = lines.length * lineHeight + 78;
  const y = slide.textPosition === "top" ? 150 : slide.textPosition === "center" ? Math.round((1920 - height) / 2) : 1920 - height - 230;
  const fill = slide.textBackground === "dark" ? "rgba(0,0,0,.72)" : slide.textBackground === "light" ? "rgba(255,255,255,.88)" : "none";
  const stroke = slide.textBackground === "none" ? (slide.textColor === "#FFFFFF" ? "#111111" : "#FFFFFF") : "none";
  const tspans = lines.map((line, index) => `<tspan x="540" y="${y + 50 + slide.textSize + index * lineHeight}">${escapeXml(line)}</tspan>`).join("");
  return Buffer.from(`<svg width="1080" height="1920" xmlns="http://www.w3.org/2000/svg"><rect x="70" y="${y}" width="940" height="${height}" rx="28" fill="${fill}"/><text text-anchor="middle" fill="${slide.textColor}" stroke="${stroke}" stroke-width="6" paint-order="stroke" font-family="Arial,Helvetica,sans-serif" font-weight="800" font-size="${slide.textSize}">${tspans}</text></svg>`);
}

function allowedMediaUrl(value: string): boolean {
  const publicBase = new URL(`${getR2Config().publicUrl}/`);
  const candidate = new URL(value);
  return candidate.protocol === "https:" && candidate.origin === publicBase.origin && candidate.pathname.startsWith(publicBase.pathname);
}

async function renderSlide(projectId: string, slide: SlideshowSlide): Promise<string> {
  if (!allowedMediaUrl(slide.mediaUrl)) throw new Error("Slides can only render media from this Relay R2 library.");
  const response = await fetch(slide.mediaUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not download ${slide.mediaUrl} (HTTP ${response.status}).`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 30 * 1024 * 1024) throw new Error("A source image exceeds the 30 MB rendering limit.");
  const source = Buffer.from(await response.arrayBuffer());
  if (source.length > 30 * 1024 * 1024) throw new Error("A source image exceeds the 30 MB rendering limit.");
  let pipeline = sharp(source).rotate().resize(1080, 1920, { fit: slide.fit, position: "centre", background: "#11110f" });
  const overlay = titleOverlay(slide);
  if (overlay) pipeline = pipeline.composite([{ input: overlay, top: 0, left: 0 }]);
  const output = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  const key = `slideshows/${projectId}/${slide.id}-${crypto.randomUUID()}.png`;
  const config = getR2Config();
  await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: output, ContentType: "image/png", CacheControl: "public, max-age=31536000, immutable" }));
  return publicObjectUrl(key);
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "slideshows:write" });
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown; slideIds?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const selected = Array.isArray(body?.slideIds) ? new Set(body.slideIds.filter((value): value is string => typeof value === "string")) : null;
  if (!id) return Response.json({ error: "A slideshow id is required." }, { status: 400 });
  const [project] = await sql<SlideshowRow[]>`SELECT id, brand_id, name, caption, slides, created_at, updated_at FROM "slideshow_project" WHERE id = ${id} AND owner_id = ${authorization.session.user.id}`;
  if (!project) return Response.json({ error: "Slideshow not found." }, { status: 404 });
  if (!project.slides.length) return Response.json({ error: "Add at least one slide before rendering." }, { status: 400 });
  try {
    const slides: SlideshowSlide[] = [];
    for (const slide of project.slides) {
      slides.push(!selected || selected.has(slide.id) ? { ...slide, renderedUrl: await renderSlide(project.id, slide) } : slide);
    }
    const [updated] = await sql<SlideshowRow[]>`
      UPDATE "slideshow_project" SET slides = ${JSON.stringify(slides)}::jsonb, updated_at = NOW()
      WHERE id = ${project.id} AND owner_id = ${authorization.session.user.id}
      RETURNING id, brand_id, name, caption, slides, created_at, updated_at
    `;
    return Response.json({ data: serializeSlideshow(updated) });
  } catch (error) {
    console.error("Slideshow rendering failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not render the slideshow." }, { status: 500 });
  }
}
