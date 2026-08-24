import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { SlideshowSlide } from "@relay/core";
import { sql } from "@relay/database";
import sharp from "sharp";

import { requireApiSession } from "../../../../../lib/api-session";
import { getR2Client, getR2Config, publicObjectUrl } from "../../../../../lib/r2";
import { creativeLabelsSvg } from "../../../../../lib/creative-label-svg";
import { serializeSlideshow, type SlideshowRow } from "../../../../../lib/slideshows";

export const runtime = "nodejs";
export const maxDuration = 300;

function titleOverlay(slide: SlideshowSlide): Buffer | null {
  if (!slide.text) return null;
  const style = slide.textBackground === "light" ? "light" : slide.textBackground === "none" ? "outline" : "dark";
  return creativeLabelsSvg([{ id: slide.id, text: slide.text, x: slide.textX ?? .5, y: slide.textY ?? (slide.textPosition === "top" ? .18 : slide.textPosition === "center" ? .5 : .78), width: slide.textWidth ?? .87, height: slide.textHeight ?? .12, fontSize: slide.textSize, font: slide.textFont, textColor: slide.textColor, background: slide.textBackground, backgroundColor: slide.textBackgroundColor, style }]);
}

function allowedMediaUrl(value: string): boolean {
  const publicBase = new URL(`${getR2Config().publicUrl}/`);
  const candidate = new URL(value);
  return candidate.protocol === "https:" && candidate.origin === publicBase.origin && candidate.pathname.startsWith(publicBase.pathname);
}

async function renderSlide(folderId: string, index: number, slide: SlideshowSlide): Promise<string> {
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
  const output = await pipeline.jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
  const key = `media-projects/${folderId}/media/${String(index + 1).padStart(2, "0")}-${slide.id}.jpg`;
  const config = getR2Config();
  await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: output, ContentType: "image/jpeg", CacheControl: "public, max-age=31536000, immutable" }));
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
    const folderId = crypto.randomUUID();
    const folderName = `${project.name.slice(0, 72)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const config = getR2Config();
    await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: `media-projects/${folderId}/.project.json`, Body: JSON.stringify({ id: folderId, name: folderName, kind: "media", ownerId: authorization.session.user.id, createdAt: new Date().toISOString() }), ContentType: "application/json" }));
    const slides: SlideshowSlide[] = [];
    for (const [index, slide] of project.slides.entries()) {
      slides.push(!selected || selected.has(slide.id) ? { ...slide, renderedUrl: await renderSlide(folderId, index, slide) } : slide);
    }
    const [updated] = await sql<SlideshowRow[]>`
      UPDATE "slideshow_project" SET slides = ${JSON.stringify(slides)}::jsonb, updated_at = NOW()
      WHERE id = ${project.id} AND owner_id = ${authorization.session.user.id}
      RETURNING id, brand_id, name, caption, slides, created_at, updated_at
    `;
    return Response.json({ data: serializeSlideshow(updated), folder: { id: folderId, name: folderName } });
  } catch (error) {
    console.error("Slideshow rendering failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not render the slideshow." }, { status: 500 });
  }
}
