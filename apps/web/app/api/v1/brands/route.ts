import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";

function validTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const rows = await sql<{ id: string; name: string; monogram: string; color: string; timezone: string }[]>`
    SELECT id, name, monogram, color, timezone FROM "brand" WHERE "owner_id" = ${authorization.session.user.id} ORDER BY "created_at" ASC
  `;
  return Response.json({ data: rows });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;

  const body = await request.json().catch(() => null) as { name?: unknown; color?: unknown; timezone?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const color = typeof body?.color === "string" ? body.color.trim().toLowerCase() : "";
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "";
  if (!name || name.length > 60) return Response.json({ error: "Brand name must be between 1 and 60 characters." }, { status: 400 });
  if (!/^#[0-9a-f]{6}$/.test(color)) return Response.json({ error: "Choose a valid brand color." }, { status: 400 });
  if (!timezone || !validTimezone(timezone)) return Response.json({ error: "Choose a valid IANA timezone." }, { status: 400 });

  const monogram = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const id = crypto.randomUUID();
  const [created] = await sql<{ id: string; name: string; monogram: string; color: string; timezone: string }[]>`
    INSERT INTO "brand" (id, owner_id, name, monogram, color, timezone)
    VALUES (${id}, ${authorization.session.user.id}, ${name}, ${monogram}, ${color}, ${timezone})
    RETURNING id, name, monogram, color, timezone
  `;
  return Response.json({ data: created }, { status: 201 });
}
