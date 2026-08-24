import { sql } from "@relay/database";

interface DueReport { id: string; owner_id: string; name: string; cadence: "weekly" | "monthly"; filters: Record<string, unknown>; next_run_at: string | Date }
const wait = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve) => { const timeout = setTimeout(resolve, milliseconds); signal?.addEventListener("abort", () => { clearTimeout(timeout); resolve(); }, { once: true }); });

export async function deliverDueAnalyticsReports(): Promise<number> {
  return sql.begin(async (transaction) => {
    const reports = await transaction<DueReport[]>`SELECT id, owner_id, name, cadence, filters, next_run_at FROM "analytics_report_schedule" WHERE next_run_at <= NOW() ORDER BY next_run_at ASC LIMIT 20 FOR UPDATE SKIP LOCKED`;
    for (const report of reports) {
      const to = new Date(); const days = Number(report.filters.days) || (report.cadence === "weekly" ? 7 : 30); const from = new Date(to.getTime() - Math.min(366, Math.max(1, days)) * 86_400_000); const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), format: "csv" });
      for (const key of ["brandId","accountId","campaignId","provider","mediaType"]) if (typeof report.filters[key] === "string" && report.filters[key]) params.set(key, String(report.filters[key]));
      await transaction`INSERT INTO "notification" (id, owner_id, event_key, kind, title, message, external_url) VALUES (${crypto.randomUUID()}, ${report.owner_id}, ${`analytics-report:${report.id}:${new Date(report.next_run_at).toISOString()}`}, 'info', ${`${report.name} is ready`}, ${`${report.cadence === "weekly" ? "Weekly" : "Monthly"} analytics report generated from stored metric snapshots.`}, ${`/api/v1/analytics?${params}`}) ON CONFLICT (owner_id, event_key) DO NOTHING`;
      await transaction`UPDATE "analytics_report_schedule" SET last_sent_at=NOW(), next_run_at=CASE WHEN cadence='weekly' THEN next_run_at + INTERVAL '7 days' ELSE next_run_at + INTERVAL '1 month' END WHERE id=${report.id}`;
    }
    return reports.length;
  });
}

export async function runAnalyticsReportLoop(options: { intervalMs?: number; signal?: AbortSignal } = {}): Promise<void> {
  while (!options.signal?.aborted) { try { const delivered = await deliverDueAnalyticsReports(); if (delivered) console.info(JSON.stringify({ level:"info", message:"Analytics reports delivered", delivered })); } catch (error) { console.error(JSON.stringify({ level:"error", message:"Analytics report delivery failed", error:error instanceof Error ? error.message : "Unknown error" })); } await wait(options.intervalMs ?? 3_600_000, options.signal); }
}
