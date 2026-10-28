import { imageVideoSeconds } from "@relay/core/image-video";
import { sql } from "@relay/database";

interface ImageVideoTarget {
  id: string;
  lease_owner: string;
  media_urls: string[];
  media_url: string | null;
  settings: { kind: string; imageSeconds?: number };
  publish_attempts: number;
}

/** A null URL means rendering is queued/running; publishing attempts remain untouched. */
export async function youtubeImageVideoUrl(target: ImageVideoTarget): Promise<string | null> {
  const urls = target.media_urls.length ? target.media_urls : target.media_url ? [target.media_url] : [];
  const seconds = imageVideoSeconds(urls.length, target.settings.imageSeconds);
  await sql`
    INSERT INTO post_image_video_job (id, target_id, source_urls, image_seconds)
    SELECT ${crypto.randomUUID()}, id, ${JSON.stringify(urls)}::jsonb, ${seconds} FROM post_target
    WHERE id = ${target.id} AND publish_lease_owner = ${target.lease_owner}
    ON CONFLICT (target_id) DO NOTHING
  `;
  // Edits invalidate the snapshot. An explicit post retry resets publish_attempts;
  // only acknowledged render failures may start a new bounded render attempt set.
  await sql`
    UPDATE post_image_video_job SET source_urls = ${JSON.stringify(urls)}::jsonb, image_seconds = ${seconds},
      status = 'queued', attempts = 0, progress = 0, error = NULL, rendered_url = NULL,
      failure_acknowledged_at = NULL, lease_token = NULL, lease_until = NULL, created_at = NOW(), updated_at = NOW()
    WHERE target_id = ${target.id} AND (
      source_urls <> ${JSON.stringify(urls)}::jsonb OR image_seconds <> ${seconds}
      OR (status IN ('failed', 'cancelled') AND failure_acknowledged_at IS NOT NULL AND ${target.publish_attempts} = 0)
    )
      AND EXISTS (SELECT 1 FROM post_target WHERE id = target_id AND publish_lease_owner = ${target.lease_owner})
  `;
  await sql`
    UPDATE post_image_video_job SET status = 'failed', error = 'YouTube image video rendering did not finish within one hour.',
      lease_token = NULL, lease_until = NULL, updated_at = NOW()
    WHERE target_id = ${target.id} AND status IN ('queued', 'running') AND created_at < NOW() - INTERVAL '1 hour'
      AND EXISTS (SELECT 1 FROM post_target WHERE id = target_id AND publish_lease_owner = ${target.lease_owner})
  `;
  const [job] = await sql<{ status: string; rendered_url: string | null; error: string | null }[]>`
    SELECT status, rendered_url, error FROM post_image_video_job WHERE target_id = ${target.id}
  `;
  if (!job) throw new Error("The YouTube image video job could not be queued.");
  if (job.status === "completed" && job.rendered_url) return job.rendered_url;
  if (job.status === "failed" || job.status === "cancelled" || job.status === "completed") {
    await sql`
      UPDATE post_image_video_job SET status = CASE WHEN status = 'completed' THEN 'failed' ELSE status END,
        failure_acknowledged_at = NOW(), updated_at = NOW()
      WHERE target_id = ${target.id}
        AND EXISTS (SELECT 1 FROM post_target WHERE id = target_id AND publish_lease_owner = ${target.lease_owner})
    `;
    throw new Error(`YouTube image video conversion failed: ${job.error ?? (job.status === "cancelled" ? "Rendering was cancelled." : "The renderer did not return a video.")} Retry the post to render it again.`);
  }
  return null;
}
