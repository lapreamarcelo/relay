import { sql } from "@relay/database";

interface HealthMetrics {
  publishDue: number;
  publishing: number;
  failedLastHour: number;
  analyticsDue: number;
  tokenRefreshDue: number;
  oldestPublishDelaySeconds: number;
  analyticsFreshnessSeconds: number | null;
}

const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
  const timeout = setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true });
});

export async function collectWorkerHealth(): Promise<HealthMetrics> {
  const [metrics] = await sql<HealthMetrics[]>`
    SELECT
      (SELECT count(*)::int FROM "post_target" WHERE status = 'scheduled' AND publish_after <= NOW()) AS "publishDue",
      (SELECT count(*)::int FROM "post_target" WHERE status IN ('publishing', 'processing')) AS "publishing",
      (SELECT count(*)::int FROM "post_target" WHERE status = 'failed' AND updated_at >= NOW() - INTERVAL '1 hour') AS "failedLastHour",
      (SELECT count(*)::int FROM "post_target" WHERE status = 'published' AND analytics_after <= NOW()) AS "analyticsDue",
      (SELECT count(*)::int FROM "social_account" WHERE refresh_after_at <= NOW()) AS "tokenRefreshDue",
      COALESCE((SELECT GREATEST(0, EXTRACT(EPOCH FROM (NOW() - min(publish_after))))::int FROM "post_target" WHERE status = 'scheduled' AND publish_after <= NOW()), 0) AS "oldestPublishDelaySeconds",
      (SELECT EXTRACT(EPOCH FROM (NOW() - max(captured_at)))::int FROM "post_metric_snapshot") AS "analyticsFreshnessSeconds"
  `;
  return metrics ?? { publishDue: 0, publishing: 0, failedLastHour: 0, analyticsDue: 0, tokenRefreshDue: 0, oldestPublishDelaySeconds: 0, analyticsFreshnessSeconds: null };
}

export async function runHealthLoop(options: { intervalMs?: number; signal?: AbortSignal; workerId?: string } = {}): Promise<void> {
  const id = "primary";
  const workerId = options.workerId ?? `worker-${crypto.randomUUID()}`;
  const intervalMs = options.intervalMs ?? 30_000;
  while (!options.signal?.aborted) {
    try {
      const metrics = await collectWorkerHealth();
      await sql`
        INSERT INTO "worker_heartbeat" (id, worker_id, metrics, checked_at)
        VALUES (${id}, ${workerId}, ${JSON.stringify(metrics)}::jsonb, NOW())
        ON CONFLICT (id) DO UPDATE SET worker_id = EXCLUDED.worker_id, metrics = EXCLUDED.metrics, checked_at = NOW()
      `;
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: "Worker health collection failed", error: error instanceof Error ? error.message : "Unknown error" }));
    }
    await wait(intervalMs, options.signal);
  }
}
