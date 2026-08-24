import { normalizePublishingDefaults } from "@relay/core";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../../lib/api-session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "settings:read" });
  if (authorization.response) return authorization.response;
  const [row] = await sql<{ publishing_defaults: unknown }[]>`SELECT publishing_defaults FROM "user" WHERE id = ${authorization.session.user.id}`;
  if (!row) return Response.json({ error: "Account not found." }, { status: 404 });
  return Response.json({ data: normalizePublishingDefaults(row.publishing_defaults) });
}

export async function PUT(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "settings:write" });
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Publishing defaults are required." }, { status: 400 });
  const defaults = normalizePublishingDefaults(body);
  const [row] = await sql<{ id: string }[]>`
    UPDATE "user"
    SET publishing_defaults = ${JSON.stringify(defaults)}::jsonb, updated_at = NOW()
    WHERE id = ${authorization.session.user.id}
    RETURNING id
  `;
  if (!row) return Response.json({ error: "Account not found." }, { status: 404 });
  return Response.json({ data: defaults });
}
