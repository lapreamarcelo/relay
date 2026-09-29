import { GetObjectCommand } from "@aws-sdk/client-s3";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../../lib/api-session";
import { getR2Client, getR2Config } from "../../../../../lib/r2";
import { objectKeyFromPublicUrl, videoDownloadContentDisposition } from "../../../../../lib/video-download";

export const runtime = "nodejs";

interface DownloadRenderJobRow {
  rendered_url: string | null;
  snapshot: { name?: unknown } | null;
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "videos:read" });
  if (authorization.response) return authorization.response;

  const jobId = new URL(request.url).searchParams.get("jobId")?.trim();
  if (!jobId) return Response.json({ error: "A render job id is required." }, { status: 400 });

  const [job] = await sql<DownloadRenderJobRow[]>`
    SELECT rendered_url, snapshot
    FROM video_render_job
    WHERE id=${jobId}
      AND owner_id=${authorization.session.user.id}
      AND status='completed'
    LIMIT 1
  `;
  if (!job?.rendered_url) return Response.json({ error: "Completed render not found." }, { status: 404 });

  const config = getR2Config();
  const key = objectKeyFromPublicUrl(job.rendered_url, config.publicUrl);
  if (!key) {
    console.error("Completed render URL is outside the configured R2 public URL", { jobId });
    return Response.json({ error: "Rendered video is unavailable." }, { status: 404 });
  }

  try {
    const object = await getR2Client().send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    if (!object.Body) return Response.json({ error: "Rendered video is unavailable." }, { status: 404 });

    const headers = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Disposition": videoDownloadContentDisposition(job.snapshot?.name),
      "Content-Type": "video/mp4",
    });
    if (object.ContentLength !== undefined) headers.set("Content-Length", String(object.ContentLength));

    return new Response(object.Body.transformToWebStream(), { headers });
  } catch (error) {
    console.error("Could not stream completed video render", { jobId, error });
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404 ? 404 : 502;
    return Response.json({ error: "Rendered video is unavailable." }, { status });
  }
}
