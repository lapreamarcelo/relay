import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";

export const runtime = "nodejs";

const providers = new Set(["instagram", "facebook", "tiktok", "youtube"]);
const kinds = new Set(["success", "error", "scheduled", "info"]);

interface NotificationInput {
  eventKey?: unknown;
  postId?: unknown;
  targetId?: unknown;
  provider?: unknown;
  kind?: unknown;
  title?: unknown;
  message?: unknown;
  externalUrl?: unknown;
}

function optionalString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const rows = await sql<{
    id: string; event_key: string; post_id: string | null; target_id: string | null; provider: string | null;
    kind: string; title: string; message: string; external_url: string | null; read_at: string | Date | null; created_at: string | Date;
  }[]>`
    SELECT id, event_key, post_id, target_id, provider, kind, title, message, external_url, read_at, created_at
    FROM "notification" WHERE owner_id = ${authorization.session.user.id}
    ORDER BY created_at DESC LIMIT 100
  `;
  return Response.json({ data: rows.map((row) => ({
    id: row.id, eventKey: row.event_key, postId: row.post_id, targetId: row.target_id, provider: row.provider,
    kind: row.kind, title: row.title, message: row.message, externalUrl: row.external_url,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null, createdAt: new Date(row.created_at).toISOString(),
  })) });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { notifications?: NotificationInput[] } | null;
  if (!Array.isArray(body?.notifications) || body.notifications.length === 0 || body.notifications.length > 20) {
    return Response.json({ error: "Provide between 1 and 20 notifications." }, { status: 400 });
  }

  const saved: string[] = [];
  await sql.begin(async (transaction) => {
    for (const item of body.notifications!) {
      const eventKey = optionalString(item.eventKey, 240);
      const kind = optionalString(item.kind, 20);
      const title = optionalString(item.title, 180);
      const message = optionalString(item.message, 2_000);
      const provider = optionalString(item.provider, 30);
      if (!eventKey || !kind || !kinds.has(kind) || !title || !message || (provider && !providers.has(provider))) {
        throw new Error("INVALID_NOTIFICATION");
      }
      const id = crypto.randomUUID();
      const [row] = await transaction<{ id: string }[]>`
        INSERT INTO "notification" (id, owner_id, event_key, post_id, target_id, provider, kind, title, message, external_url)
        VALUES (${id}, ${authorization.session.user.id}, ${eventKey}, ${optionalString(item.postId, 240)}, ${optionalString(item.targetId, 240)},
          ${provider}, ${kind}, ${title}, ${message}, ${optionalString(item.externalUrl, 2_000)})
        ON CONFLICT (owner_id, event_key) DO UPDATE SET
          kind = EXCLUDED.kind, title = EXCLUDED.title, message = EXCLUDED.message, external_url = EXCLUDED.external_url
        RETURNING id
      `;
      if (row) saved.push(row.id);
    }
  }).catch((error) => {
    if (error instanceof Error && error.message === "INVALID_NOTIFICATION") return;
    throw error;
  });
  if (saved.length !== body.notifications.length) return Response.json({ error: "One or more notifications were invalid." }, { status: 400 });
  return Response.json({ saved: saved.length }, { status: 201 });
}

export async function PATCH(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => ({})) as { ids?: unknown };
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string").slice(0, 100) : [];
  if (ids.length > 0) {
    await sql`UPDATE "notification" SET read_at = NOW() WHERE owner_id = ${authorization.session.user.id} AND id = ANY(${ids})`;
  } else {
    await sql`UPDATE "notification" SET read_at = NOW() WHERE owner_id = ${authorization.session.user.id} AND read_at IS NULL`;
  }
  return new Response(null, { status: 204 });
}
