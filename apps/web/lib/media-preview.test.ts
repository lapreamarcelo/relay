import test from "node:test";
import assert from "node:assert/strict";
import { createMediaPreviewHandler } from "./media-preview.ts";
import { mediaPreviewUrl } from "./browser-library-media.ts";
const publicUrl = "https://media.example.test/public";
const request = (url = `${publicUrl}/media/video.mp4`, range?: string) => new Request(`https://relay.test${mediaPreviewUrl(url)}`, { headers: range ? { Range: range } : {} });
const authorized = async () => null;

test("media preview authorizes before reading configuration, validating URLs, or fetching", async () => {
  const handler = createMediaPreviewHandler({ authorize: async () => Response.json({ error: "Unauthorized" }, { status: 401 }), publicUrl: () => { throw new Error("must not read config"); }, fetcher: async () => { throw new Error("must not fetch"); } });
  assert.equal((await handler(request("https://evil.test/file.mp4"))).status, 401);
});
test("unknown origins, base-path escapes, credentials, and query redirects never fetch", async () => {
  let calls = 0;
  const handler = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, fetcher: async () => { calls++; return new Response(); } });
  for (const url of ["https://evil.test/media.mp4", "https://media.example.test/publicity/file.mp4", "https://user:pass@media.example.test/public/file.mp4", `${publicUrl}/file.mp4?redirect=https://evil.test`, `${publicUrl}/media%2fsecret.mp4`, "file:///etc/passwd"]) assert.equal((await handler(request(url))).status, 400);
  assert.equal(calls, 0);
});
test("public HTTP fetch omits credentials, disallows redirects, and streams validated ranges", async () => {
  let fetched = false;
  const handler = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, fetcher: async (url, options) => {
    fetched = true; assert.equal(url, `${publicUrl}/media/video.mp4`); assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    const headers = new Headers(options?.headers); assert.equal(headers.get("Range"), "bytes=0-3"); assert.equal(headers.get("Authorization"), null); assert.equal(headers.get("Cookie"), null);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.enqueue(new Uint8Array([3, 4])); controller.close(); } }), { status: 206, headers: { "Content-Type": "video/mp4", "Content-Range": "bytes 0-3/10", "Content-Length": "4", "Accept-Ranges": "bytes", "Set-Cookie": "external=secret" } });
  } });
  const response = await handler(request(undefined, "bytes=0-3"));
  assert.equal(response.status, 206); assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3, 4]);
  assert.equal(response.headers.get("Content-Range"), "bytes 0-3/10"); assert.equal(response.headers.get("Set-Cookie"), null);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff"); assert.equal(response.headers.get("Cache-Control"), "private, no-store"); assert.equal(fetched, true);
});
test("malformed ranges, redirects, active MIME types, and oversized declarations are rejected", async () => {
  let calls = 0;
  const badRange = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, fetcher: async () => { calls++; return new Response(); } });
  for (const range of ["bytes=0-4,8-12", "bytes=-", "bytes=10-5", "bytes=-0", "bytes=NaN-", "bytes=9999999999999999999-"]) assert.equal((await badRange(request(undefined, range))).status, 416);
  assert.equal(calls, 0);
  for (const type of ["text/html", "image/svg+xml", "application/javascript", "application/octet-stream", "video/html"]) {
    const handler = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, fetcher: async () => new Response("bad", { headers: { "Content-Type": type } }) });
    assert.equal((await handler(request())).status, 415);
  }
  const redirect = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, fetcher: async (_url, options) => { assert.equal(options?.redirect, "error"); throw new TypeError("redirect is prohibited"); } });
  assert.equal((await redirect(request())).status, 502);
  const tooLarge = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, maxBytes: 4, fetcher: async () => new Response("12345", { headers: { "Content-Type": "audio/mpeg", "Content-Length": "5" } }) });
  assert.equal((await tooLarge(request())).status, 413);
});
test("unknown-length streams are bounded and cancellation aborts the upstream fetch", async () => {
  let canceled = false, signal: AbortSignal | null | undefined;
  const handler = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, maxBytes: 3, fetcher: async (_url, options) => {
    signal = options?.signal;
    return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1, 2])); }, cancel() { canceled = true; } }), { headers: { "Content-Type": "image/png" } });
  } });
  const response = await handler(request());
  await assert.rejects(response.arrayBuffer(), /500 MB/); assert.equal(canceled, true); assert.equal(signal?.aborted, true);
});
test("preview timeout aborts a stalled public request", async () => {
  const handler = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, timeoutMs: 5, fetcher: async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) });
  // The real network socket keeps the event loop alive; this timer does so for the fake.
  const keepAlive = setTimeout(() => {}, 100);
  try { assert.equal((await handler(request())).status, 504); } finally { clearTimeout(keepAlive); }
});
test("a stalled body times out even after headers were returned, and client cancellation aborts fetch", async () => {
  let canceled = false, signal: AbortSignal | null | undefined;
  const handler = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, timeoutMs: 10, fetcher: async (_url, options) => {
    signal = options?.signal;
    return new Response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { canceled = true; } }), { headers: { "Content-Type": "audio/mpeg" } });
  } });
  const keepAlive = setTimeout(() => {}, 100);
  try {
    const response = await handler(request());
    await assert.rejects(response.arrayBuffer(), /timed out/); assert.equal(canceled, true); assert.equal(signal?.aborted, true);
  } finally { clearTimeout(keepAlive); }
  const fast = createMediaPreviewHandler({ authorize: authorized, publicUrl: () => publicUrl, fetcher: async (_url, options) => { signal = options?.signal; return new Response(new Uint8Array([1, 2]), { headers: { "Content-Type": "video/mp4" } }); } });
  const response = await fast(request()); await response.body!.cancel(); assert.equal(signal?.aborted, true);
});
