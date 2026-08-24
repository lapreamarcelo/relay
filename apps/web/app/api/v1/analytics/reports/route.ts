import { sql } from "@relay/database";

import { requireApiSession } from "../../../../../lib/api-session";

interface Row { id: string; name: string; cadence: "weekly" | "monthly"; filters: Record<string, unknown>; next_run_at: string | Date; last_sent_at: string | Date | null; created_at: string | Date }
const serialize = (row: Row) => ({ id: row.id, name: row.name, cadence: row.cadence, filters: row.filters, nextRunAt: new Date(row.next_run_at).toISOString(), lastSentAt: row.last_sent_at ? new Date(row.last_sent_at).toISOString() : null, createdAt: new Date(row.created_at).toISOString() });

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "analytics:read" }); if (authorization.response) return authorization.response;
  const rows = await sql<Row[]>`SELECT * FROM "analytics_report_schedule" WHERE owner_id=${authorization.session.user.id} ORDER BY created_at DESC`;
  return Response.json({ data: rows.map(serialize) });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "analytics:write" }); if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { name?: unknown; cadence?: unknown; filters?: unknown } | null; const name = typeof body?.name === "string" ? body.name.trim().slice(0,120) : ""; const cadence = body?.cadence === "monthly" ? "monthly" as const : "weekly" as const; const filters = body?.filters && typeof body.filters === "object" && !Array.isArray(body.filters) ? body.filters as Record<string, unknown> : {};
  if (!name) return Response.json({ error: "A report name is required." }, { status: 400 }); const next = new Date(); if (cadence === "weekly") next.setUTCDate(next.getUTCDate() + 7); else next.setUTCMonth(next.getUTCMonth() + 1); next.setUTCHours(8,0,0,0);
  const [row] = await sql<Row[]>`INSERT INTO "analytics_report_schedule" (id, owner_id, name, cadence, filters, next_run_at) VALUES (${crypto.randomUUID()}, ${authorization.session.user.id}, ${name}, ${cadence}, ${JSON.stringify(filters)}::jsonb, ${next.toISOString()}) RETURNING *`;
  return Response.json({ data: serialize(row) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "analytics:write" }); if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown } | null; const id = typeof body?.id === "string" ? body.id.trim() : ""; if (!id) return Response.json({ error: "A report id is required." }, { status: 400 });
  const rows = await sql<{ id: string }[]>`DELETE FROM "analytics_report_schedule" WHERE id=${id} AND owner_id=${authorization.session.user.id} RETURNING id`; return rows[0] ? Response.json({ data: rows[0] }) : Response.json({ error: "Report schedule not found." }, { status: 404 });
}
