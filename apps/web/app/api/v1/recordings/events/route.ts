import { requireApiSession } from "../../../../../lib/api-session";
import { importRecordingEvents } from "../../../../../lib/video-recording";

/** Validate imported gestures without recording, executing commands, or storing files. */
export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:write" });
  if (authorization.response) return authorization.response;
  try {
    // Stream the request to enforce the limit even without Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return Response.json({ error: "A gesture JSON body is required." }, { status: 400 });
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) { await reader.cancel(); return Response.json({ error: "Gesture JSON must be under 1 MB." }, { status: 413 }); }
      chunks.push(value);
    }
    const body = JSON.parse(new TextDecoder().decode(Buffer.concat(chunks))) as { pointer?: unknown; durationMs?: unknown };
    if (body.durationMs !== undefined && (typeof body.durationMs !== "number" || !Number.isFinite(body.durationMs) || body.durationMs <= 0)) throw new Error("Use a positive source duration in milliseconds.");
    return Response.json({ pointer: importRecordingEvents(body.pointer ?? body, body.durationMs as number | undefined) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid recording gestures." }, { status: 400 });
  }
}
