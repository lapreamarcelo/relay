import { PutObjectCommand } from "@aws-sdk/client-s3";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../../lib/api-session";
import { renderVideoArtifact } from "../../../../../lib/video-renderer";
import { getR2Client, getR2Config } from "../../../../../lib/r2";
import { serializeVideoProject, type VideoProjectRow } from "../../../../../lib/videos";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "videos:write" }); if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown } | null; const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return Response.json({ error: "A video project id is required." }, { status: 400 });
  const [project] = await sql<VideoProjectRow[]>`SELECT * FROM "video_project" WHERE id=${id} AND owner_id=${authorization.session.user.id}`;
  if (!project) return Response.json({ error: "Video project not found." }, { status: 404 });
  try {
    const serialized = serializeVideoProject(project);
    const folderId = crypto.randomUUID();
    const folderName = `${serialized.name.slice(0, 72)} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const config = getR2Config();
    await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: `media-projects/${folderId}/.project.json`, Body: JSON.stringify({ id: folderId, name: folderName, kind: "media", ownerId: authorization.session.user.id, createdAt: new Date().toISOString() }), ContentType: "application/json" }));
    const renderedUrl = await renderVideoArtifact({ projectId: id, sourceUrl: serialized.sourceUrl, musicUrl: serialized.musicUrl, labels: serialized.labels, targetKey: `media-projects/${folderId}/media/${serialized.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 72) || "video"}.mp4` });
    const [updated] = await sql<VideoProjectRow[]>`UPDATE "video_project" SET rendered_url=${renderedUrl}, updated_at=NOW() WHERE id=${id} AND owner_id=${authorization.session.user.id} RETURNING *`;
    return Response.json({ data: serializeVideoProject(updated), folder: { id: folderId, name: folderName } });
  } catch (error) { console.error("Video rendering failed", error); return Response.json({ error: error instanceof Error ? error.message : "Could not render the video." }, { status: 500 }); }
}
