import { sql } from "@relay/database";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const base = { service: "relay-web", version: "0.1.0" };
  if (new URL(request.url).searchParams.get("deep") !== "1") return Response.json({ status: "ok", ...base });
  try {
    const [heartbeat] = await sql<{ worker_id: string; metrics: Record<string, unknown>; checked_at: string | Date; age_seconds: number }[]>`
      SELECT worker_id, metrics, checked_at, EXTRACT(EPOCH FROM (NOW() - checked_at))::int AS age_seconds
      FROM "worker_heartbeat" WHERE id = 'primary'
    `;
    const healthy = Boolean(heartbeat && heartbeat.age_seconds <= 120);
    return Response.json({ status: healthy ? "ok" : "degraded", ...base, database: "ok", worker: heartbeat ? { id: heartbeat.worker_id, checkedAt: new Date(heartbeat.checked_at).toISOString(), ageSeconds: heartbeat.age_seconds, metrics: heartbeat.metrics } : null }, { status: healthy ? 200 : 503 });
  } catch {
    return Response.json({ status: "error", ...base, database: "error" }, { status: 503 });
  }
}
