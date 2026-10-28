import type { VideoTimeline } from "@relay/core";
import { imageVideoSeconds } from "@relay/core/image-video";

export function postImageVideoTimeline(urls: string[], imageSeconds?: number): VideoTimeline {
  const seconds = imageVideoSeconds(urls.length, imageSeconds);
  return {
    version: 1, aspectRatio: "9:16", background: { color: "#000000" },
    clips: urls.map((sourceUrl, index) => ({
      id: `image-${index}`, sourceUrl, name: `Image ${index + 1}`, kind: "image",
      inMs: 0, outMs: seconds * 1000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 0,
    })),
    labels: [], music: { url: "", volume: 0, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0,
    exportSettings: { format: "mp4", fps: 30, resolution: "1080p", quality: "standard" },
  };
}

type RenderInput = {
  projectId: string; sourceUrl: string; labels: []; timeline: VideoTimeline; targetKey: string;
  signal: AbortSignal; onProgress: (value: number) => Promise<void>;
};
type Render = (input: RenderInput) => Promise<{ url: string }>;

/** Shares the renderer process, so publishing workers never need FFmpeg. */
export async function runNextPostImageVideoJob(shutdown: AbortSignal, render?: Render): Promise<boolean> {
  const { sql } = await import("@relay/database");
  await sql`
    UPDATE post_image_video_job SET status = 'cancelled', error = 'The post is no longer awaiting publication.',
      lease_token = NULL, lease_until = NULL, updated_at = NOW()
    WHERE status IN ('queued', 'running') AND NOT EXISTS (
      SELECT 1 FROM post_target WHERE id = target_id AND status IN ('scheduled', 'publishing', 'processing')
    )
  `;
  await sql`
    UPDATE post_image_video_job SET status = 'failed', error = 'Image video renderer lease expired after three attempts.',
      lease_token = NULL, lease_until = NULL, updated_at = NOW()
    WHERE status IN ('queued', 'running') AND attempts >= 3 AND (lease_until IS NULL OR lease_until < NOW())
  `;
  if (shutdown.aborted) return false;
  const lease = crypto.randomUUID();
  const [job] = await sql<{ id: string; source_urls: string[]; image_seconds: number }[]>`
    UPDATE post_image_video_job SET status = 'running', attempts = attempts + 1, lease_token = ${lease},
      lease_until = NOW() + INTERVAL '60 seconds', updated_at = NOW()
    WHERE id = (
      SELECT id FROM post_image_video_job
      WHERE (status = 'queued' OR (status = 'running' AND lease_until < NOW())) AND attempts < 3
      ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING id, source_urls, image_seconds
  `;
  if (!job) return false;
  const abort = new AbortController();
  const signal = AbortSignal.any([abort.signal, shutdown, AbortSignal.timeout(60 * 60_000)]);
  let pending: Promise<void> | undefined;
  const heartbeat = setInterval(() => {
    if (pending) return;
    pending = sql`
      UPDATE post_image_video_job SET lease_until = NOW() + INTERVAL '60 seconds', updated_at = NOW()
      WHERE id = ${job.id} AND lease_token = ${lease} AND status = 'running'
        AND EXISTS (SELECT 1 FROM post_target WHERE id = target_id AND status IN ('scheduled', 'publishing', 'processing'))
      RETURNING id
    `.then(rows => { if (!rows.length) abort.abort(); }).catch(() => abort.abort()).finally(() => { pending = undefined; });
  }, 10_000);
  try {
    const renderer = render ?? (await import("./video-renderer")).renderVideoArtifactDetails;
    const artifact = await renderer({
      projectId: job.id, sourceUrl: job.source_urls[0], labels: [],
      timeline: postImageVideoTimeline(job.source_urls, job.image_seconds),
      targetKey: `post-image-videos/${job.id}/${lease}.mp4`, signal,
      onProgress: async progress => {
        signal.throwIfAborted();
        const owned = await sql`
          UPDATE post_image_video_job SET progress = ${Math.max(0, Math.min(99, Math.round(progress)))}, updated_at = NOW()
          WHERE id = ${job.id} AND lease_token = ${lease} AND status = 'running' RETURNING id
        `;
        if (!owned.length) { abort.abort(); signal.throwIfAborted(); }
      },
    });
    signal.throwIfAborted();
    await sql`
      UPDATE post_image_video_job SET status = 'completed', progress = 100, rendered_url = ${artifact.url},
        error = NULL, lease_token = NULL, lease_until = NULL, updated_at = NOW()
      WHERE id = ${job.id} AND lease_token = ${lease} AND status = 'running'
        AND EXISTS (SELECT 1 FROM post_target WHERE id = target_id AND status IN ('scheduled', 'publishing', 'processing'))
    `;
  } catch (error) {
    await sql`
      UPDATE post_image_video_job SET status = ${shutdown.aborted ? "queued" : "failed"},
        error = ${shutdown.aborted ? null : error instanceof Error ? error.message.slice(0, 1200) : "Image video rendering failed."},
        lease_token = NULL, lease_until = NULL, updated_at = NOW()
      WHERE id = ${job.id} AND lease_token = ${lease} AND status = 'running'
    `;
  } finally {
    clearInterval(heartbeat);
    await pending;
  }
  return true;
}
