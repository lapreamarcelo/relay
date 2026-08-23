import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";
import { normalizeSlides, serializeSlideshow, type SlideshowRow } from "../../../../lib/slideshows";

export const runtime = "nodejs";

interface ProjectInput {
  id?: unknown;
  brandId?: unknown;
  name?: unknown;
  caption?: unknown;
  slides?: unknown;
}

function cleanString(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

async function validBrand(ownerId: string, value: unknown): Promise<string | null | false> {
  const brandId = cleanString(value, 240);
  if (!brandId) return null;
  const [brand] = await sql<{ id: string }[]>`SELECT id FROM "brand" WHERE id = ${brandId} AND owner_id = ${ownerId}`;
  return brand?.id ?? false;
}

async function createProject(ownerId: string, body: ProjectInput | null): Promise<Response> {
  const name = cleanString(body?.name, 120);
  const caption = typeof body?.caption === "string" ? body.caption.trim().slice(0, 2_200) : "";
  const slides = normalizeSlides(body?.slides);
  const brandId = await validBrand(ownerId, body?.brandId);
  if (!name || !slides) return Response.json({ error: "A slideshow needs a name and a valid ordered slides array (maximum 35)." }, { status: 400 });
  if (brandId === false) return Response.json({ error: "The selected brand was not found." }, { status: 400 });
  const id = crypto.randomUUID();
  const [created] = await sql<SlideshowRow[]>`
    INSERT INTO "slideshow_project" (id, owner_id, brand_id, name, caption, slides)
    VALUES (${id}, ${ownerId}, ${brandId}, ${name}, ${caption}, ${JSON.stringify(slides)}::jsonb)
    RETURNING id, brand_id, name, caption, slides, created_at, updated_at
  `;
  return Response.json({ data: serializeSlideshow(created) }, { status: 201 });
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "slideshows:read" });
  if (authorization.response) return authorization.response;
  const id = cleanString(new URL(request.url).searchParams.get("id"), 240);
  const rows = id
    ? await sql<SlideshowRow[]>`SELECT id, brand_id, name, caption, slides, created_at, updated_at FROM "slideshow_project" WHERE id = ${id} AND owner_id = ${authorization.session.user.id}`
    : await sql<SlideshowRow[]>`SELECT id, brand_id, name, caption, slides, created_at, updated_at FROM "slideshow_project" WHERE owner_id = ${authorization.session.user.id} ORDER BY updated_at DESC LIMIT 200`;
  if (id && !rows[0]) return Response.json({ error: "Slideshow not found." }, { status: 404 });
  return Response.json({ data: id ? serializeSlideshow(rows[0]) : rows.map(serializeSlideshow) });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "slideshows:write" });
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as (ProjectInput & { projects?: unknown }) | null;
  if (!Array.isArray(body?.projects)) return createProject(authorization.session.user.id, body);
  if (body.projects.length === 0 || body.projects.length > 50) return Response.json({ error: "Bulk generation accepts between 1 and 50 slideshow projects." }, { status: 400 });
  const results: Array<{ index: number; data?: unknown; error?: string; status: number }> = [];
  for (const [index, item] of body.projects.entries()) {
    const response = await createProject(authorization.session.user.id, item && typeof item === "object" ? item as ProjectInput : null);
    const payload = await response.json() as { data?: unknown; error?: string };
    results.push({ index, ...payload, status: response.status });
  }
  const failed = results.filter((result) => result.status >= 400).length;
  return Response.json({ data: results, summary: { created: results.length - failed, failed } }, { status: failed ? 207 : 201 });
}

export async function PATCH(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "slideshows:write" });
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as ProjectInput | null;
  const id = cleanString(body?.id, 240);
  const name = cleanString(body?.name, 120);
  const caption = typeof body?.caption === "string" ? body.caption.trim().slice(0, 2_200) : "";
  const slides = normalizeSlides(body?.slides);
  const brandId = await validBrand(authorization.session.user.id, body?.brandId);
  if (!id || !name || !slides) return Response.json({ error: "Slideshow id, name, and valid slides are required." }, { status: 400 });
  if (brandId === false) return Response.json({ error: "The selected brand was not found." }, { status: 400 });
  const [updated] = await sql<SlideshowRow[]>`
    UPDATE "slideshow_project" SET brand_id = ${brandId}, name = ${name}, caption = ${caption}, slides = ${JSON.stringify(slides)}::jsonb, updated_at = NOW()
    WHERE id = ${id} AND owner_id = ${authorization.session.user.id}
    RETURNING id, brand_id, name, caption, slides, created_at, updated_at
  `;
  if (!updated) return Response.json({ error: "Slideshow not found." }, { status: 404 });
  return Response.json({ data: serializeSlideshow(updated) });
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "slideshows:write" });
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown; ids?: unknown } | null;
  const single = cleanString(body?.id, 240);
  const ids = single ? [single] : Array.isArray(body?.ids) ? [...new Set(body.ids.map((value) => cleanString(value, 240)).filter(Boolean))].slice(0, 100) : [];
  if (!ids.length) return Response.json({ error: "One or more slideshow ids are required." }, { status: 400 });
  const result = await sql.begin(async (transaction) => {
    const existing = await transaction<{ id: string }[]>`SELECT id FROM "slideshow_project" WHERE id = ANY(${ids}) AND owner_id = ${authorization.session.user.id} FOR UPDATE`;
    if (existing.length !== ids.length) return null;
    return transaction<{ id: string }[]>`DELETE FROM "slideshow_project" WHERE id = ANY(${ids}) AND owner_id = ${authorization.session.user.id} RETURNING id`;
  });
  if (!result) return Response.json({ error: "One or more slideshows were not found." }, { status: 404 });
  return Response.json({ data: result });
}
