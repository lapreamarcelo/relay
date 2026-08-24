import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";
import { normalizeCreativeLabels } from "../../../../lib/creative-labels";
import { safeWebUrl, serializeVideoProject, type VideoProjectRow } from "../../../../lib/videos";

export const runtime = "nodejs";

interface VideoInput { id?: unknown; brandId?: unknown; name?: unknown; caption?: unknown; sourceUrl?: unknown; sourceFolderId?: unknown; musicUrl?: unknown; musicFolderId?: unknown; labels?: unknown }
const clean = (value: unknown, maximum: number) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";

async function brandFor(ownerId: string, value: unknown): Promise<string | null | false> {
  const id = clean(value, 240); if (!id) return null;
  const [brand] = await sql<{ id: string }[]>`SELECT id FROM "brand" WHERE id = ${id} AND owner_id = ${ownerId}`;
  return brand?.id ?? false;
}

async function parse(ownerId: string, body: VideoInput | null) {
  const name = clean(body?.name, 120); const caption = typeof body?.caption === "string" ? body.caption.trim().slice(0, 2_200) : "";
  const sourceUrl = safeWebUrl(body?.sourceUrl); const musicUrl = safeWebUrl(body?.musicUrl); const labels = normalizeCreativeLabels(body?.labels);
  const brandId = await brandFor(ownerId, body?.brandId);
  if (!name || labels === null) return { error: "A video project needs a name and up to 12 valid labels." } as const;
  if (brandId === false) return { error: "The selected brand was not found." } as const;
  return { name, caption, sourceUrl, musicUrl: musicUrl || null, sourceFolderId: clean(body?.sourceFolderId, 240) || null, musicFolderId: clean(body?.musicFolderId, 240) || null, labels, brandId };
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "videos:read" }); if (authorization.response) return authorization.response;
  const id = clean(new URL(request.url).searchParams.get("id"), 240);
  const rows = id
    ? await sql<VideoProjectRow[]>`SELECT * FROM "video_project" WHERE id = ${id} AND owner_id = ${authorization.session.user.id}`
    : await sql<VideoProjectRow[]>`SELECT * FROM "video_project" WHERE owner_id = ${authorization.session.user.id} ORDER BY updated_at DESC LIMIT 200`;
  if (id && !rows[0]) return Response.json({ error: "Video project not found." }, { status: 404 });
  return Response.json({ data: id ? serializeVideoProject(rows[0]) : rows.map(serializeVideoProject) });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "videos:write" }); if (authorization.response) return authorization.response;
  const input = await request.json().catch(() => null) as VideoInput | null; const parsed = await parse(authorization.session.user.id, input);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const [row] = await sql<VideoProjectRow[]>`INSERT INTO "video_project" (id, owner_id, brand_id, name, caption, source_url, source_folder_id, music_url, music_folder_id, labels) VALUES (${crypto.randomUUID()}, ${authorization.session.user.id}, ${parsed.brandId}, ${parsed.name}, ${parsed.caption}, ${parsed.sourceUrl}, ${parsed.sourceFolderId}, ${parsed.musicUrl}, ${parsed.musicFolderId}, ${JSON.stringify(parsed.labels)}::jsonb) RETURNING *`;
  return Response.json({ data: serializeVideoProject(row) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "videos:write" }); if (authorization.response) return authorization.response;
  const input = await request.json().catch(() => null) as VideoInput | null; const id = clean(input?.id, 240); const parsed = await parse(authorization.session.user.id, input);
  if (!id || "error" in parsed) return Response.json({ error: "Video id, name, and valid labels are required." }, { status: 400 });
  const [row] = await sql<VideoProjectRow[]>`UPDATE "video_project" SET brand_id=${parsed.brandId}, name=${parsed.name}, caption=${parsed.caption}, source_url=${parsed.sourceUrl}, source_folder_id=${parsed.sourceFolderId}, music_url=${parsed.musicUrl}, music_folder_id=${parsed.musicFolderId}, labels=${JSON.stringify(parsed.labels)}::jsonb, rendered_url=NULL, updated_at=NOW() WHERE id=${id} AND owner_id=${authorization.session.user.id} RETURNING *`;
  if (!row) return Response.json({ error: "Video project not found." }, { status: 404 });
  return Response.json({ data: serializeVideoProject(row) });
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "videos:write" }); if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown } | null; const id = clean(body?.id, 240);
  if (!id) return Response.json({ error: "A video id is required." }, { status: 400 });
  const rows = await sql<{ id: string }[]>`DELETE FROM "video_project" WHERE id=${id} AND owner_id=${authorization.session.user.id} RETURNING id`;
  return rows[0] ? Response.json({ data: rows[0] }) : Response.json({ error: "Video project not found." }, { status: 404 });
}
