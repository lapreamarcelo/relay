import { objectKeyFromPublicUrl } from "./video-download.ts";

export const MAX_MEDIA_PREVIEW_BYTES = 500 * 1024 * 1024;
const MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/avif", "image/gif",
  "video/mp4", "video/webm", "video/quicktime", "video/x-m4v", "video/mpeg", "video/x-msvideo", "video/x-matroska",
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "audio/webm", "audio/flac", "audio/x-flac",
]);
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", "Content-Security-Policy": "default-src 'none'; sandbox" };
type Dependencies = {
  authorize: (request: Request) => Promise<Response | null>;
  publicUrl: () => string;
  fetcher?: typeof fetch;
  /** Injectable limits keep streaming overflow and timeout tests small. */
  maxBytes?: number;
  timeoutMs?: number;
};

function validRange(value: string, maxBytes: number): boolean {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1] ? Number(match[1]) : undefined, end = match[2] ? Number(match[2]) : undefined;
  if ((start !== undefined && (!Number.isSafeInteger(start) || start >= maxBytes)) || (end !== undefined && (!Number.isSafeInteger(end) || end > maxBytes))) return false;
  return start === undefined ? end! > 0 : end === undefined || end >= start;
}

/** Fetch public HTTP bytes only; never signs URLs or retrieves private S3 objects. */
export function createMediaPreviewHandler(dependencies: Dependencies) {
  return async function mediaPreview(request: Request): Promise<Response> {
    const authorization = await dependencies.authorize(request);
    if (authorization) return authorization;
    const error = (message: string, status: number) => Response.json({ error: message }, { status, headers: PRIVATE_HEADERS });
    const source = new URL(request.url).searchParams.get("url");
    let configured: string;
    try { configured = dependencies.publicUrl(); } catch { return error("Media storage is not configured.", 503); }
    if (!source || source.length > 4096 || !objectKeyFromPublicUrl(source, configured)) return error("Choose media from this Relay library.", 400);
    const maxBytes = dependencies.maxBytes ?? MAX_MEDIA_PREVIEW_BYTES;
    const range = request.headers.get("range");
    if (range && !validRange(range, maxBytes)) return error("Use a single valid byte range.", 416);
    const abort = new AbortController(); let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; abort.abort(); }, dependencies.timeoutMs ?? 120_000);
    timeout.unref?.();
    const requestAbort = () => abort.abort();
    request.signal.addEventListener("abort", requestAbort, { once: true });
    if (request.signal.aborted) abort.abort();
    const cleanup = () => { clearTimeout(timeout); request.signal.removeEventListener("abort", requestAbort); };
    let upstream: Response;
    try {
      upstream = await (dependencies.fetcher ?? fetch)(source, { headers: { "Accept-Encoding": "identity", ...(range ? { Range: range } : {}) }, redirect: "error", cache: "no-store", signal: abort.signal });
    } catch {
      cleanup(); abort.abort();
      return error(timedOut ? "Media preview timed out." : "Could not load public media.", timedOut ? 504 : 502);
    }
    const reject = async (message: string, status: number) => { cleanup(); abort.abort(); await upstream.body?.cancel().catch(() => {}); return error(message, status); };
    if (upstream.status !== 200 && upstream.status !== 206) return reject("Public media is unavailable.", upstream.status === 404 ? 404 : upstream.status === 416 ? 416 : 502);
    const mime = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
    if (!MIME_TYPES.has(mime)) return reject("Only bitmap images, audio, and video can be previewed.", 415);
    const rawLength = upstream.headers.get("content-length");
    const length = rawLength !== null && /^\d+$/.test(rawLength) ? Number(rawLength) : undefined;
    if (length !== undefined && (!Number.isSafeInteger(length) || length > maxBytes)) return reject("Media preview exceeds the 500 MB limit.", 413);
    const headers = new Headers({ ...PRIVATE_HEADERS, "Content-Type": mime });
    // Fetch decodes compressed responses; an encoded Content-Length must not be forwarded.
    const encoded = upstream.headers.get("content-encoding");
    if (length !== undefined && (!encoded || encoded === "identity")) headers.set("Content-Length", String(length));
    if (upstream.headers.get("accept-ranges") === "bytes") headers.set("Accept-Ranges", "bytes");
    if (upstream.status === 206) {
      const contentRange = upstream.headers.get("content-range") ?? "", match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(contentRange);
      if (!range || !match || (encoded && encoded !== "identity")) return reject("Invalid public media range response.", 502);
      const start = Number(match[1]), end = Number(match[2]), total = match[3] === "*" ? undefined : Number(match[3]);
      const requested = /^bytes=(\d*)-(\d*)$/.exec(range)!;
      const rangeMatches = requested[1] ? start === Number(requested[1]) && (!requested[2] || end <= Number(requested[2])) : total === undefined || (end === total - 1 && start === Math.max(0, total - Number(requested[2])));
      if (![start, end, ...(total === undefined ? [] : [total])].every(Number.isSafeInteger) || end < start || end >= maxBytes || !rangeMatches || (total !== undefined && (end >= total || total > maxBytes)) || end - start + 1 > maxBytes || (length !== undefined && length !== end - start + 1)) return reject("Invalid public media range response.", 502);
      headers.set("Content-Range", contentRange);
    }
    if (!upstream.body) { cleanup(); return new Response(null, { status: upstream.status, headers }); }
    const reader = upstream.body.getReader(); let bytes = 0, finished = false;
    let streamController: ReadableStreamDefaultController<Uint8Array>;
    const stop = () => { if (finished) return; finished = true; cleanup(); abort.signal.removeEventListener("abort", abortStream); };
    const abortStream = () => { if (finished) return; stop(); void reader.cancel().catch(() => {}); streamController.error(new Error(timedOut ? "Media preview timed out." : "Media preview canceled.")); };
    const body = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
      async pull(controller) {
        try {
          if (abort.signal.aborted) throw new Error(timedOut ? "Media preview timed out." : "Media preview canceled.");
          const { value, done } = await reader.read();
          if (finished) return;
          if (done) { stop(); controller.close(); return; }
          bytes += value.byteLength;
          if (bytes > maxBytes) throw new Error("Media preview exceeds the 500 MB limit.");
          controller.enqueue(value);
        } catch (error) { if (!finished) { stop(); abort.abort(); void reader.cancel().catch(() => {}); controller.error(error); } }
      },
      async cancel(reason) { stop(); abort.abort(); await reader.cancel(reason).catch(() => {}); },
    });
    abort.signal.addEventListener("abort", abortStream, { once: true });
    if (abort.signal.aborted) abortStream();
    return new Response(body, { status: upstream.status, headers });
  };
}
