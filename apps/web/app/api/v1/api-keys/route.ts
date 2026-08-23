import { sql } from "@relay/database";

import { agentApiKeyScopes, createApiKeySecret } from "../../../../lib/api-keys";
import { requireApiSession } from "../../../../lib/api-session";

export const runtime = "nodejs";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  last_used_at: string | Date | null;
  created_at: string | Date;
}

const serialize = (row: ApiKeyRow) => ({
  id: row.id,
  name: row.name,
  prefix: row.key_prefix,
  scopes: row.scopes,
  lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  createdAt: new Date(row.created_at).toISOString(),
});

export async function GET(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const rows = await sql<ApiKeyRow[]>`
    SELECT id, name, key_prefix, scopes, last_used_at, created_at
    FROM "api_key" WHERE owner_id = ${authorization.session.user.id} AND revoked_at IS NULL
    ORDER BY created_at DESC
  `;
  return Response.json({ data: rows.map(serialize) });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 80) : "";
  if (!name) return Response.json({ error: "API key name is required." }, { status: 400 });
  const id = crypto.randomUUID();
  const generated = createApiKeySecret();
  const [created] = await sql<ApiKeyRow[]>`
    INSERT INTO "api_key" (id, owner_id, name, key_prefix, key_hash, scopes)
    VALUES (${id}, ${authorization.session.user.id}, ${name}, ${generated.prefix}, ${generated.hash}, ${JSON.stringify(agentApiKeyScopes)}::jsonb)
    RETURNING id, name, key_prefix, scopes, last_used_at, created_at
  `;
  return Response.json({ data: { ...serialize(created), secret: generated.secret } }, { status: 201 });
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return Response.json({ error: "API key id is required." }, { status: 400 });
  const [revoked] = await sql<{ id: string }[]>`
    UPDATE "api_key" SET revoked_at = NOW()
    WHERE id = ${id} AND owner_id = ${authorization.session.user.id} AND revoked_at IS NULL
    RETURNING id
  `;
  if (!revoked) return Response.json({ error: "API key not found." }, { status: 404 });
  return Response.json({ data: revoked });
}
