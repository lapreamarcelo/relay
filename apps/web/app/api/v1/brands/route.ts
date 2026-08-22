import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";

function validTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; }
  catch { return false; }
}

function parseBrandInput(body: { name?: unknown; color?: unknown; timezone?: unknown } | null) {
  const name = typeof body?.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const color = typeof body?.color === "string" ? body.color.trim().toLowerCase() : "";
  const timezone = typeof body?.timezone === "string" ? body.timezone.trim() : "";
  if (!name || name.length > 60) return { error: "Brand name must be between 1 and 60 characters." } as const;
  if (!/^#[0-9a-f]{6}$/.test(color)) return { error: "Choose a valid brand color." } as const;
  if (!timezone || !validTimezone(timezone)) return { error: "Choose a valid IANA timezone." } as const;
  const monogram = name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return { name, color, timezone, monogram } as const;
}

function parseAccountIds(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100 || value.some((id) => typeof id !== "string" || !id.trim())) return null;
  return [...new Set(value.map((id) => (id as string).trim()))];
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

  const body = await request.json().catch(() => null) as { name?: unknown; color?: unknown; timezone?: unknown; accountIds?: unknown } | null;
  const input = parseBrandInput(body);
  if ("error" in input) return Response.json({ error: input.error }, { status: 400 });
  const accountIds = parseAccountIds(body?.accountIds);
  if (!accountIds) return Response.json({ error: "Choose a valid list of connected accounts." }, { status: 400 });
  const { name, color, timezone, monogram } = input;
  const id = crypto.randomUUID();
  const result = await sql.begin(async (tx) => {
    const [created] = await tx<{ id: string; name: string; monogram: string; color: string; timezone: string }[]>`
      INSERT INTO "brand" (id, owner_id, name, monogram, color, timezone)
      VALUES (${id}, ${authorization.session.user.id}, ${name}, ${monogram}, ${color}, ${timezone})
      RETURNING id, name, monogram, color, timezone
    `;
    const accountAssignments: { id: string; brandId: string }[] = [];
    for (const accountId of accountIds) {
      const [updatedAccount] = await tx<{ id: string }[]>`UPDATE "social_account" SET "brand_id" = ${id}, "updated_at" = NOW() WHERE "id" = ${accountId} AND "owner_id" = ${authorization.session.user.id} RETURNING "id"`;
      if (updatedAccount) accountAssignments.push({ id: updatedAccount.id, brandId: id });
    }
    return { data: created, accountAssignments };
  });
  return Response.json(result, { status: 201 });
}

export async function PATCH(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; color?: unknown; timezone?: unknown; accountIds?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return Response.json({ error: "Brand id is required." }, { status: 400 });
  const input = parseBrandInput(body);
  if ("error" in input) return Response.json({ error: input.error }, { status: 400 });
  const accountIds = parseAccountIds(body?.accountIds);
  if (!accountIds) return Response.json({ error: "Choose a valid list of connected accounts." }, { status: 400 });
  const result = await sql.begin(async (tx) => {
    const [updated] = await tx<{ id: string; name: string; monogram: string; color: string; timezone: string }[]>`
      UPDATE "brand" SET "name" = ${input.name}, "monogram" = ${input.monogram}, "color" = ${input.color}, "timezone" = ${input.timezone}, "updated_at" = NOW()
      WHERE "id" = ${id} AND "owner_id" = ${authorization.session.user.id}
      RETURNING id, name, monogram, color, timezone
    `;
    if (!updated) return null;
    const accountAssignments: { id: string; brandId: string }[] = [];
    for (const accountId of accountIds) {
      const [updatedAccount] = await tx<{ id: string }[]>`UPDATE "social_account" SET "brand_id" = ${id}, "updated_at" = NOW() WHERE "id" = ${accountId} AND "owner_id" = ${authorization.session.user.id} RETURNING "id"`;
      if (updatedAccount) accountAssignments.push({ id: updatedAccount.id, brandId: id });
    }
    return { data: updated, accountAssignments };
  });
  if (!result) return Response.json({ error: "Brand not found." }, { status: 404 });
  return Response.json(result);
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return Response.json({ error: "Brand id is required." }, { status: 400 });
  const [deleted] = await sql<{ id: string }[]>`
    DELETE FROM "brand" WHERE "id" = ${id} AND "owner_id" = ${authorization.session.user.id} RETURNING id
  `;
  if (!deleted) return Response.json({ error: "Brand not found." }, { status: 404 });
  return Response.json({ data: deleted });
}
