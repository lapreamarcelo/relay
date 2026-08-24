import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";

type Metric = "views" | "reach" | "likes" | "comments" | "shares" | "saves" | "watchTimeSeconds";
const metrics: Metric[] = ["views", "reach", "likes", "comments", "shares", "saves", "watchTimeSeconds"];

interface Row {
  id: string; target_id: string; post_id: string; provider: string; account_id: string | null; brand_id: string | null; campaign_id: string | null;
  caption: string; media_type: string; published_at: string | Date | null; captured_at: string | Date;
  views: number | null; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; watch_time_seconds: number | null; average_watch_time_seconds: number | null;
}

const value = (row: Row, metric: Metric): number | null => metric === "watchTimeSeconds" ? row.watch_time_seconds : row[metric];
const day = (date: Date) => date.toISOString().slice(0, 10);
const csv = (input: unknown) => `"${String(input ?? "").replaceAll('"', '""')}"`;
const rangeValue = (raw: string | null, fallback: Date) => { const parsed = raw ? new Date(raw) : fallback; return Number.isNaN(parsed.getTime()) ? fallback : parsed; };

function periodDelta(rows: Row[], start: Date, end: Date) {
  const byTarget = new Map<string, Row[]>();
  for (const row of rows) { const list = byTarget.get(row.target_id) ?? []; list.push(row); byTarget.set(row.target_id, list); }
  const totals = Object.fromEntries(metrics.map((metric) => [metric, null])) as Record<Metric, number | null>; const available = new Set<Metric>();
  for (const snapshots of byTarget.values()) {
    snapshots.sort((a, b) => new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime());
    const before = snapshots.filter((row) => new Date(row.captured_at) < start).at(-1);
    const last = snapshots.filter((row) => { const date = new Date(row.captured_at); return date >= start && date <= end; }).at(-1); if (!last) continue;
    for (const metric of metrics) { const lastValue = value(last, metric); if (lastValue === null) continue; available.add(metric); const baseline = before ? value(before, metric) : 0; totals[metric] = (totals[metric] ?? 0) + Math.max(0, lastValue - (baseline ?? 0)); }
  }
  return { totals, available: [...available] };
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "analytics:read" }); if (authorization.response) return authorization.response;
  const url = new URL(request.url); const postId = url.searchParams.get("postId")?.trim() || null; const to = rangeValue(url.searchParams.get("to"), new Date()); const defaultFrom = new Date(to); defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30);
  const from = rangeValue(url.searchParams.get("from"), defaultFrom); if (from >= to) return Response.json({ error: "Analytics from must be earlier than to." }, { status: 400 });
  if (to.getTime() - from.getTime() > 366 * 86_400_000) return Response.json({ error: "Analytics ranges are limited to 366 days." }, { status: 400 });
  const duration = to.getTime() - from.getTime(); const previousFrom = new Date(from.getTime() - duration);
  const brandId = url.searchParams.get("brandId")?.trim() || null; const provider = url.searchParams.get("provider")?.trim() || null; const accountId = url.searchParams.get("accountId")?.trim() || null; const campaignId = url.searchParams.get("campaignId")?.trim() || null; const mediaType = url.searchParams.get("mediaType")?.trim() || null;
  const rows = await sql<Row[]>`
    SELECT snapshot.id, snapshot.target_id, post.id AS post_id, target.provider, target.social_account_id AS account_id, post.brand_id, post.campaign_id,
      post.text AS caption, post.media_type, post.published_at, snapshot.captured_at, snapshot.views::float8 AS views, snapshot.reach::float8 AS reach,
      snapshot.likes::float8 AS likes, snapshot.comments::float8 AS comments, snapshot.shares::float8 AS shares, snapshot.saves::float8 AS saves,
      snapshot.watch_time_seconds::float8 AS watch_time_seconds, snapshot.average_watch_time_seconds
    FROM "post_metric_snapshot" snapshot INNER JOIN "post_target" target ON target.id = snapshot.target_id INNER JOIN "post" post ON post.id = target.post_id
    WHERE post.owner_id = ${authorization.session.user.id} AND (${postId}::text IS NOT NULL OR (snapshot.captured_at >= ${previousFrom.toISOString()} AND snapshot.captured_at <= ${to.toISOString()}))
      AND (${postId}::text IS NULL OR post.id = ${postId}) AND (${brandId}::text IS NULL OR post.brand_id = ${brandId})
      AND (${provider}::text IS NULL OR target.provider = ${provider}) AND (${accountId}::text IS NULL OR target.social_account_id = ${accountId})
      AND (${campaignId}::text IS NULL OR post.campaign_id = ${campaignId}) AND (${mediaType}::text IS NULL OR post.media_type = ${mediaType})
    ORDER BY snapshot.captured_at ASC LIMIT 100000
  `;
  if (postId) return Response.json({ data: rows.map((row) => ({ id: row.id, targetId: row.target_id, provider: row.provider, capturedAt: new Date(row.captured_at).toISOString(), views: row.views ?? undefined, reach: row.reach ?? undefined, likes: row.likes ?? undefined, comments: row.comments ?? undefined, shares: row.shares ?? undefined, saves: row.saves ?? undefined, watchTimeSeconds: row.watch_time_seconds ?? undefined, averageWatchTimeSeconds: row.average_watch_time_seconds ?? undefined })) });
  const current = periodDelta(rows, from, to); const previous = periodDelta(rows, previousFrom, from);
  const growth = Object.fromEntries(metrics.map((metric) => { const now = current.totals[metric]; const before = previous.totals[metric]; return [metric, now === null || before === null || before === 0 ? null : (now - before) / before * 100]; }));
  const increments: Array<{ row: Row; values: Partial<Record<Metric, number>> }> = []; const byTarget = new Map<string, Row[]>();
  for (const row of rows) { const list = byTarget.get(row.target_id) ?? []; list.push(row); byTarget.set(row.target_id, list); }
  for (const snapshots of byTarget.values()) for (let index = 0; index < snapshots.length; index += 1) { const row = snapshots[index]; const captured = new Date(row.captured_at); if (captured < from || captured > to) continue; const prior = snapshots[index - 1]; const values: Partial<Record<Metric, number>> = {}; for (const metric of metrics) { const next = value(row, metric); if (next !== null) values[metric] = Math.max(0, next - (prior ? value(prior, metric) ?? 0 : 0)); } increments.push({ row, values }); }
  const seriesMap = new Map<string, Record<Metric, number | null>>(); const rankingMap = new Map<string, { postId: string; targetId: string; provider: string; caption: string; mediaType: string; values: Record<Metric, number | null> }>();
  for (const item of increments) { const key = day(new Date(item.row.captured_at)); const point = seriesMap.get(key) ?? Object.fromEntries(metrics.map((metric) => [metric, null])) as Record<Metric, number | null>; for (const metric of metrics) if (item.values[metric] !== undefined) point[metric] = (point[metric] ?? 0) + item.values[metric]!; seriesMap.set(key, point); const rank = rankingMap.get(item.row.target_id) ?? { postId: item.row.post_id, targetId: item.row.target_id, provider: item.row.provider, caption: item.row.caption, mediaType: item.row.media_type, values: Object.fromEntries(metrics.map((metric) => [metric, null])) as Record<Metric, number | null> }; for (const metric of metrics) if (item.values[metric] !== undefined) rank.values[metric] = (rank.values[metric] ?? 0) + item.values[metric]!; rankingMap.set(item.row.target_id, rank); }
  const series = [...seriesMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, ...values })); const ranking = [...rankingMap.values()].sort((a, b) => (b.values.views ?? 0) - (a.values.views ?? 0));
  if (url.searchParams.get("format") === "csv") { const header = ["postId", "targetId", "provider", "caption", "mediaType", ...metrics].join(","); const body = ranking.map((row) => [row.postId, row.targetId, row.provider, row.caption, row.mediaType, ...metrics.map((metric) => row.values[metric])].map(csv).join(",")).join("\n"); return new Response(`${header}\n${body}\n`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="relay-analytics-${day(from)}-${day(to)}.csv"` } }); }
  return Response.json({ data: { range: { from: from.toISOString(), to: to.toISOString(), previousFrom: previousFrom.toISOString() }, summary: current.totals, previous: previous.totals, growth, available: current.available, series, ranking, sample: { snapshots: rows.length, destinations: byTarget.size }, filters: { brandId, provider, accountId, campaignId, mediaType } } });
}
