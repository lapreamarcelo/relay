import type { Campaign } from "@relay/core";
import { sql } from "@relay/database";
import { requireApiSession } from "../../../../lib/api-session";

export const runtime = "nodejs";
const clean = (value: unknown, maximum = 120) => typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
const color = (value: unknown) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#ff5c35";
const toCampaign = (row: { id: string; brand_id: string | null; name: string; color: string; status: "active" | "archived"; post_count: number; created_at: string | Date; updated_at: string | Date }): Campaign => ({ id: row.id, brandId: row.brand_id ?? "", name: row.name, color: row.color, status: row.status, postCount: row.post_count, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });

export async function GET(request: Request) {
  const auth = await requireApiSession(request, { apiKeyScope: "posts:read" }); if (auth.response) return auth.response;
  const rows = await sql<Parameters<typeof toCampaign>[0][]>`SELECT campaign.id, campaign.brand_id, campaign.name, campaign.color, campaign.status, campaign.created_at, campaign.updated_at, count(post.id)::int AS post_count FROM "campaign" campaign LEFT JOIN "post" post ON post.campaign_id = campaign.id WHERE campaign.owner_id = ${auth.session.user.id} GROUP BY campaign.id ORDER BY campaign.updated_at DESC`;
  return Response.json({ data: rows.map(toCampaign) });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request, { apiKeyScope: "posts:write" }); if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { name?: unknown; brandId?: unknown; color?: unknown } | null;
  const name = clean(body?.name); const brandId = clean(body?.brandId, 240);
  if (!name) return Response.json({ error: "Campaign name is required." }, { status: 400 });
  if (brandId) { const [brand] = await sql<{ id: string }[]>`SELECT id FROM "brand" WHERE id = ${brandId} AND owner_id = ${auth.session.user.id}`; if (!brand) return Response.json({ error: "Brand not found." }, { status: 400 }); }
  const [row] = await sql<Parameters<typeof toCampaign>[0][]>`INSERT INTO "campaign" (id, owner_id, brand_id, name, color) VALUES (${crypto.randomUUID()}, ${auth.session.user.id}, ${brandId}, ${name}, ${color(body?.color)}) RETURNING id, brand_id, name, color, status, 0::int AS post_count, created_at, updated_at`;
  return Response.json({ data: toCampaign(row) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession(request, { apiKeyScope: "posts:write" }); if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; color?: unknown; status?: unknown } | null;
  const id = clean(body?.id, 240); const name = clean(body?.name); const status = body?.status === "archived" ? "archived" : "active";
  if (!id || !name) return Response.json({ error: "Campaign id and name are required." }, { status: 400 });
  const [row] = await sql<Parameters<typeof toCampaign>[0][]>`UPDATE "campaign" SET name = ${name}, color = ${color(body?.color)}, status = ${status}, updated_at = NOW() WHERE id = ${id} AND owner_id = ${auth.session.user.id} RETURNING id, brand_id, name, color, status, (SELECT count(*)::int FROM "post" WHERE campaign_id = ${id}) AS post_count, created_at, updated_at`;
  return row ? Response.json({ data: toCampaign(row) }) : Response.json({ error: "Campaign not found." }, { status: 404 });
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession(request, { apiKeyScope: "posts:write" }); if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { id?: unknown } | null; const id = clean(body?.id, 240);
  if (!id) return Response.json({ error: "Campaign id is required." }, { status: 400 });
  const deleted = await sql<{ id: string }[]>`DELETE FROM "campaign" WHERE id = ${id} AND owner_id = ${auth.session.user.id} RETURNING id`;
  return deleted.length ? Response.json({ data: deleted[0] }) : Response.json({ error: "Campaign not found." }, { status: 404 });
}
