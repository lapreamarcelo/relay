import type { PostTemplate, ProviderId, ProviderPostSettings } from "@relay/core";
import { sql } from "@relay/database";
import { requireApiSession } from "../../../../lib/api-session";

export const runtime = "nodejs";
const clean = (value: unknown, maximum = 120) => typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
interface Row { id: string; brand_id: string | null; name: string; text: string; media_type: "none" | "image" | "video"; settings: Partial<Record<ProviderId, ProviderPostSettings>>; created_at: string | Date; updated_at: string | Date }
const map = (row: Row): PostTemplate => ({ id: row.id, brandId: row.brand_id ?? "", name: row.name, text: row.text, mediaType: row.media_type, settings: row.settings, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() });

export async function GET(request: Request) {
  const auth = await requireApiSession(request, { apiKeyScope: "posts:read" }); if (auth.response) return auth.response;
  const rows = await sql<Row[]>`SELECT id, brand_id, name, text, media_type, settings, created_at, updated_at FROM "post_template" WHERE owner_id = ${auth.session.user.id} ORDER BY updated_at DESC LIMIT 200`;
  return Response.json({ data: rows.map(map) });
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request, { apiKeyScope: "posts:write" }); if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { name?: unknown; brandId?: unknown; text?: unknown; mediaType?: unknown; settings?: unknown } | null;
  const name = clean(body?.name); const brandId = clean(body?.brandId, 240); const text = typeof body?.text === "string" ? body.text.slice(0, 63_206) : ""; const mediaType = ["none", "image", "video"].includes(String(body?.mediaType)) ? body?.mediaType as Row["media_type"] : "none";
  const settings = body?.settings && typeof body.settings === "object" && !Array.isArray(body.settings) && JSON.stringify(body.settings).length < 30_000 ? body.settings : {};
  if (!name) return Response.json({ error: "Template name is required." }, { status: 400 });
  const [row] = await sql<Row[]>`INSERT INTO "post_template" (id, owner_id, brand_id, name, text, media_type, settings) VALUES (${crypto.randomUUID()}, ${auth.session.user.id}, ${brandId}, ${name}, ${text}, ${mediaType}, ${JSON.stringify(settings)}::jsonb) RETURNING id, brand_id, name, text, media_type, settings, created_at, updated_at`;
  return Response.json({ data: map(row) }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession(request, { apiKeyScope: "posts:write" }); if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { id?: unknown } | null; const id = clean(body?.id, 240);
  if (!id) return Response.json({ error: "Template id is required." }, { status: 400 });
  const deleted = await sql<{ id: string }[]>`DELETE FROM "post_template" WHERE id = ${id} AND owner_id = ${auth.session.user.id} RETURNING id`;
  return deleted.length ? Response.json({ data: deleted[0] }) : Response.json({ error: "Template not found." }, { status: 404 });
}
