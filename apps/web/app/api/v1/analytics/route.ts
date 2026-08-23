import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";

interface SnapshotRow {
  id: string;
  target_id: string;
  provider: string;
  captured_at: string | Date;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  watch_time_seconds: number | null;
  average_watch_time_seconds: number | null;
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "posts:read" });
  if (authorization.response) return authorization.response;
  const postId = new URL(request.url).searchParams.get("postId")?.trim();
  if (!postId) return Response.json({ error: "A postId query parameter is required." }, { status: 400 });
  const rows = await sql<SnapshotRow[]>`
    SELECT snapshot.id, snapshot.target_id, target.provider, snapshot.captured_at,
      snapshot.views::float8 AS views, snapshot.reach::float8 AS reach, snapshot.likes::float8 AS likes,
      snapshot.comments::float8 AS comments, snapshot.shares::float8 AS shares, snapshot.saves::float8 AS saves,
      snapshot.watch_time_seconds::float8 AS watch_time_seconds, snapshot.average_watch_time_seconds
    FROM "post_metric_snapshot" snapshot
    INNER JOIN "post_target" target ON target.id = snapshot.target_id
    INNER JOIN "post" post ON post.id = target.post_id
    WHERE post.id = ${postId} AND post.owner_id = ${authorization.session.user.id}
    ORDER BY snapshot.captured_at ASC
  `;
  return Response.json({ data: rows.map((row) => ({
    id: row.id, targetId: row.target_id, provider: row.provider, capturedAt: new Date(row.captured_at).toISOString(),
    views: row.views ?? undefined, reach: row.reach ?? undefined, likes: row.likes ?? undefined,
    comments: row.comments ?? undefined, shares: row.shares ?? undefined, saves: row.saves ?? undefined,
    watchTimeSeconds: row.watch_time_seconds ?? undefined, averageWatchTimeSeconds: row.average_watch_time_seconds ?? undefined,
  })) });
}
