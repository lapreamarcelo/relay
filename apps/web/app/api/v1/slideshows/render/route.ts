import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { SlideshowSlide } from "@relay/core";
import { imageVideoSeconds } from "@relay/core/image-video";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../../lib/api-session";
import { getR2Client, getR2Config, publicObjectUrl } from "../../../../../lib/r2";
import { serializeSlideshow, type SlideshowRow } from "../../../../../lib/slideshows";
import { renderSlideshowImage } from "../../../../../lib/slideshow-renderer";
import { postImageVideoTimeline } from "../../../../../lib/post-image-video-jobs";
import { renderVideoArtifactDetails } from "../../../../../lib/video-renderer";
import { serializeVideoProject, type VideoProjectRow } from "../../../../../lib/videos";
import { serializeRenderJob, type RenderJobRow } from "../../../../../lib/render-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

class SlideshowChangedError extends Error {
  constructor() { super("The slideshow changed or was deleted while rendering. Reload it before rendering again."); }
}

function allowedMediaUrl(value: string): boolean {
  const publicBase = new URL(`${getR2Config().publicUrl}/`);
  const candidate = new URL(value);
  return candidate.protocol === "https:" && candidate.origin === publicBase.origin && candidate.pathname.startsWith(publicBase.pathname);
}

async function renderSlide(folderId: string, index: number, slide: SlideshowSlide, createdKeys: Set<string>): Promise<string> {
  if (!allowedMediaUrl(slide.mediaUrl)) throw new Error("Slides can only render media from this Relay R2 library.");
  const response = await fetch(slide.mediaUrl, { signal: AbortSignal.timeout(30_000), redirect: "error" });
  if (!response.ok) throw new Error(`Could not download ${slide.mediaUrl} (HTTP ${response.status}).`);
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 30 * 1024 * 1024) throw new Error("A source image exceeds the 30 MB rendering limit.");
  if (!response.body) throw new Error("A source image was empty.");
  const chunks: Buffer[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 30 * 1024 * 1024) { await reader.cancel(); throw new Error("A source image exceeds the 30 MB rendering limit."); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  const source = Buffer.concat(chunks, size);
  const output = await renderSlideshowImage(source, slide);
  const key = `media-projects/${folderId}/media/${String(index + 1).padStart(2, "0")}-${slide.id}.jpg`;
  createdKeys.add(key);
  const config = getR2Config();
  await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: output, ContentType: "image/jpeg", CacheControl: "public, max-age=31536000, immutable" }));
  return publicObjectUrl(key);
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "slideshows:write" });
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown; slideIds?: unknown; format?: unknown; imageSeconds?: unknown; async?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  const selected = Array.isArray(body?.slideIds) ? new Set(body.slideIds.filter((value): value is string => typeof value === "string")) : null;
  if (!id) return Response.json({ error: "A slideshow id is required." }, { status: 400 });
  if (body?.format !== undefined && body.format !== "images" && body.format !== "video") return Response.json({ error: "Choose images or video output." }, { status: 400 });
  if (body?.async !== undefined && typeof body.async !== "boolean") return Response.json({ error: "Async must be a boolean." }, { status: 400 });
  const [project] = await sql<SlideshowRow[]>`SELECT id, brand_id, name, caption, slides, output, created_at, updated_at FROM "slideshow_project" WHERE id = ${id} AND owner_id = ${authorization.session.user.id}`;
  if (!project) return Response.json({ error: "Slideshow not found." }, { status: 404 });
  if (!project.slides.length) return Response.json({ error: "Add at least one slide before rendering." }, { status: 400 });
  const format = body?.format ?? project.output?.format ?? "images";
  let imageSeconds: number | undefined;
  if (format === "video") {
    if (body?.slideIds !== undefined) return Response.json({ error: "Video output must render every slide. Remove slideIds." }, { status: 400 });
    try {
      const requestedSeconds = body?.imageSeconds !== undefined ? body.imageSeconds : project.output?.imageSeconds;
      if (requestedSeconds !== undefined && typeof requestedSeconds !== "number") throw new Error("Duration per slide must be a number.");
      imageSeconds = imageVideoSeconds(project.slides.length, requestedSeconds);
    }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Choose a valid duration per slide." }, { status: 400 }); }
    const videoAuthorization = await requireApiSession(request, { apiKeyScope: "videos:write" });
    if (videoAuthorization.response) return videoAuthorization.response;
    if (body?.async === true) {
      const pollAuthorization = await requireApiSession(request, { apiKeyScope: "videos:read" });
      if (pollAuthorization.response) return pollAuthorization.response;
    }
  }
  const createdKeys = new Set<string>();
  let committed = false;
  try {
    const folderId = crypto.randomUUID();
    const folderName = `${project.name.slice(0, 72)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const config = getR2Config();
    const manifestKey = `media-projects/${folderId}/.project.json`;
    createdKeys.add(manifestKey);
    await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: manifestKey, Body: JSON.stringify({ id: folderId, name: folderName, kind: "media", ownerId: authorization.session.user.id, createdAt: new Date().toISOString() }), ContentType: "application/json" }));
    const slides: SlideshowSlide[] = [];
    for (const [index, slide] of project.slides.entries()) {
      slides.push(!selected || selected.has(slide.id) ? { ...slide, renderedUrl: await renderSlide(folderId, index, slide, createdKeys) } : slide);
    }
    if (format === "images") {
      const [updated] = await sql<SlideshowRow[]>`
        UPDATE "slideshow_project" SET slides = ${JSON.stringify(slides)}::jsonb, updated_at = NOW()
        WHERE id = ${project.id} AND owner_id = ${authorization.session.user.id}
          AND slides = ${JSON.stringify(project.slides)}::jsonb AND name = ${project.name} AND caption = ${project.caption}
          AND brand_id IS NOT DISTINCT FROM ${project.brand_id} AND output = ${JSON.stringify(project.output ?? { format: "images" })}::jsonb
        RETURNING id, brand_id, name, caption, slides, output, created_at, updated_at
      `;
      if (!updated) throw new SlideshowChangedError();
      committed = true;
      return Response.json({ data: serializeSlideshow(updated), folder: { id: folderId, name: folderName }, format });
    }
    const timeline = postImageVideoTimeline(slides.map(slide => slide.renderedUrl!), imageSeconds);
    const projectId = crypto.randomUUID();
    const durationMs = timeline.clips.reduce((sum, clip) => sum + clip.outMs - clip.inMs, 0);
    let artifact: Awaited<ReturnType<typeof renderVideoArtifactDetails>> | undefined;
    if (body?.async !== true) {
      const targetKey = `media-projects/${folderId}/media/slideshow.mp4`;
      // Track prospective keys too: an encoder/upload can fail between the MP4
      // and cover writes. None of these keys existed before this request.
      createdKeys.add(targetKey);
      createdKeys.add(targetKey.replace(/\.mp4$/, ".jpg"));
      artifact = await renderVideoArtifactDetails({ projectId, sourceUrl: "", labels: [], timeline, targetKey });
    }
    const { updated, job } = await sql.begin(async transaction => {
      const [updated] = await transaction<SlideshowRow[]>`
        UPDATE "slideshow_project" SET slides = ${JSON.stringify(slides)}::jsonb, updated_at = NOW()
        WHERE id = ${project.id} AND owner_id = ${authorization.session.user.id}
          AND slides = ${JSON.stringify(project.slides)}::jsonb AND name = ${project.name} AND caption = ${project.caption}
          AND brand_id IS NOT DISTINCT FROM ${project.brand_id} AND output = ${JSON.stringify(project.output ?? { format: "images" })}::jsonb
        RETURNING id, brand_id, name, caption, slides, output, created_at, updated_at
      `;
      if (!updated) throw new SlideshowChangedError();
      const [row] = await transaction<VideoProjectRow[]>`
        INSERT INTO "video_project" (id, owner_id, brand_id, name, caption, source_url, source_folder_id, labels, timeline, rendered_url, rendered_cover_url)
        VALUES (${projectId}, ${authorization.session.user.id}, ${project.brand_id}, ${`${project.name.slice(0, 112)} · Video`},
          ${project.caption}, '', ${folderId}, '[]'::jsonb, ${JSON.stringify(timeline)}::jsonb, ${artifact?.url ?? null}, ${artifact?.coverUrl ?? null}) RETURNING *
      `;
      const videoProject = serializeVideoProject(row);
      let job;
      if (body?.async === true) {
        const [jobRow] = await transaction<RenderJobRow[]>`
          INSERT INTO "video_render_job" (id, owner_id, project_id, revision, snapshot, kind)
          VALUES (${folderId}, ${authorization.session.user.id}, ${projectId}, ${videoProject.revision ?? 1}, ${JSON.stringify(videoProject)}::jsonb, 'render') RETURNING *
        `;
        job = serializeRenderJob(jobRow);
      }
      return { updated, job };
    });
    committed = true;
    const result = { data: serializeSlideshow(updated), folder: { id: folderId, name: folderName }, format, video: { projectId, durationMs } };
    if (job) return Response.json({ ...result, job }, { status: 202 });
    return Response.json({ ...result, video: { ...result.video, url: artifact!.url, coverUrl: artifact!.coverUrl } });
  } catch (error) {
    if (!committed && createdKeys.size) {
      try {
        await getR2Client().send(new DeleteObjectsCommand({
          Bucket: getR2Config().bucket, Delete: { Objects: [...createdKeys].map(Key => ({ Key })), Quiet: true },
        }));
      } catch { /* Cleanup must preserve the original render or concurrency error. */ }
    }
    if (error instanceof SlideshowChangedError) return Response.json({ error: error.message }, { status: 409 });
    console.error("Slideshow rendering failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "Could not render the slideshow." }, { status: 500 });
  }
}
