import { requireApiSession } from "../../../../../lib/api-session";
import { composeVideo, VideoComposerError, videoComposerAvailable } from "../../../../../lib/video-composer";
import { normalizeVideoCompositionRequest, videoComposerCatalog } from "../../../../../lib/video-composition";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "videos:read" });
  if (authorization.response) return authorization.response;
  return Response.json({ data: videoComposerCatalog(videoComposerAvailable()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "videos:write" });
  if (authorization.response) return authorization.response;
  let input;
  try { input = normalizeVideoCompositionRequest(await request.json()); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Invalid composition request." }, { status: 400 }); }
  try { return Response.json({ data: await composeVideo(input, request.signal) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    if (request.signal.aborted) return Response.json({ error: "Prompt composition was cancelled." }, { status: 499 });
    return Response.json({ error: error instanceof VideoComposerError ? error.message : "Prompt composition failed." }, { status: error instanceof VideoComposerError ? error.status : 502 });
  }
}
