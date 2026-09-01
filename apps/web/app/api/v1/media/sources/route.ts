import { requireApiSession } from "../../../../../lib/api-session";
import { normalizePexelsResults } from "../../../../../lib/external-image-sources";

export const runtime = "nodejs";

function string(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function providerError(status: number): string {
  if (status === 401 || status === 403) return "Pexels rejected this API key.";
  if (status === 429) return "Pexels rate limit reached. Try again later.";
  return `Pexels could not load images (HTTP ${status}).`;
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:read" });
  if (authorization.response) return authorization.response;
  return Response.json({ configured: Boolean(process.env.PEXELS_API_KEY?.trim()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:read" });
  if (authorization.response) return authorization.response;

  try {
    const body = await request.json() as { provider?: unknown; query?: unknown; page?: unknown };
    const provider = body.provider === "pexels" ? "pexels" as const : null;
    const credential = string(process.env.PEXELS_API_KEY, 4_096);
    if (!provider) return Response.json({ error: "Choose a supported image source." }, { status: 400 });
    if (!credential) return Response.json({ error: "Pexels is not configured. Add PEXELS_API_KEY to .env and restart Relay." }, { status: 503 });

    const query = string(body.query, 100);
    if (!query) return Response.json({ error: "Enter something to search for on Pexels." }, { status: 400 });
    const requestedPage = Number(body.page); const page = Number.isFinite(requestedPage) ? Math.min(80, Math.max(1, Math.floor(requestedPage))) : 1;
    const url = new URL("https://api.pexels.com/v1/search");
    url.searchParams.set("query", query); url.searchParams.set("orientation", "portrait"); url.searchParams.set("per_page", "30"); url.searchParams.set("page", String(page));
    const upstream = await fetch(url, { headers: { Authorization: credential }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!upstream.ok) return Response.json({ error: providerError(upstream.status) }, { status: upstream.status === 429 ? 429 : 502 });
    const payload = await upstream.json() as { next_page?: unknown };
    return Response.json({ provider, items: normalizePexelsResults(payload), page, hasMore: typeof payload.next_page === "string" && Boolean(payload.next_page) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return Response.json({ error: timedOut ? "The image source took too long to respond." : "Could not load the external image source." }, { status: 502 });
  }
}
