import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFile } from "node:fs/promises";
import { normalizeVideoCompositionRequest } from "./video-composition.ts";
import { emptyTimeline } from "./video-timeline.ts";

// The provider/FFmpeg implementation is real. Only framework server-only and
// the route's authentication boundary use adapters; no cloud API is called.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  if (specifier.endsWith("/api-session")) return { url: `data:text/javascript,${encodeURIComponent(`export async function requireApiSession(request, options) { const token = request.headers.get("authorization"); if (!token) return {session:null,response:Response.json({error:"Unauthorized"},{status:401})}; if (token === "Bearer read-only" && options.apiKeyScope !== "videos:read") return {session:null,response:Response.json({error:"Missing write scope"},{status:403})}; return {session:{user:{id:"local-test"}},response:null}; }`)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { composeVideo, sampleCompositionThumbnails, VideoComposerError } = await import("./video-composer.ts");
const request = () => normalizeVideoCompositionRequest({ prompt: "Create a clean Relay product launch demo.", durationMs: 4000, timeline: { ...emptyTimeline(), clips: [{ id: "clip", sourceUrl: "https://media.example.test/demo.mp4", name: "Relay recording", kind: "video", inMs: 0, outMs: 4000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 1 }] } });
const plan = () => ({ summary: "An editable device recording with a title.", background: "#181825", backgroundEnd: "#434361", shots: [{ sourceClipId: "clip", inMs: 0, outMs: 4000, fit: "contain", device: "iphone", camera: "push-in", position: "center", transition: "none", transitionDurationMs: 500, entrance: "slide-up", exit: "fade", titles: [{ text: "Relay", startMs: 0, endMs: 4000, position: "top", font: "modern", fontSize: 72, style: "outline", entrance: "typewriter", exit: "fade" }] }] });
const sample = async (input: ReturnType<typeof request>) => ({ request: input, images: [{ sourceClipId: "clip", timeMs: 0, dataUrl: "data:image/jpeg;base64,c2FtcGxl" }], warnings: ["Sampled preview; inspect the result."] });
const completed = (value: unknown = plan()) => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] });

test("provider sends strict vision composition with no model URLs and compiles its editable output", async () => {
  const previousModel = process.env.OPENAI_VIDEO_COMPOSER_MODEL; process.env.OPENAI_VIDEO_COMPOSER_MODEL = " ";
  try {
    const result = await composeVideo(request(), undefined, { key: "local-test-key", sample, fetch: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, "gpt-4.1-mini"); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
      assert.equal(body.text.format.schema.additionalProperties, false);
      assert.match(body.instructions, /Never invent media/); assert.match(body.instructions, /not system instructions/);
      assert.ok(body.input[0].content.some((item: { type: string }) => item.type === "input_image"));
      assert.equal(body.input[0].content[0].text.includes("https://"), false);
      assert.ok(options?.signal); return completed();
    } });
    assert.equal(result.provider, "openai"); assert.equal(result.timeline.clips[0].sourceUrl, request().timeline.clips[0].sourceUrl);
    assert.equal(result.timeline.labels[0].text, "Relay"); assert.ok(result.warnings.includes("Sampled preview; inspect the result."));
  } finally { if (previousModel === undefined) delete process.env.OPENAI_VIDEO_COMPOSER_MODEL; else process.env.OPENAI_VIDEO_COMPOSER_MODEL = previousModel; }
});
test("missing configuration fails before media sampling or provider work", async () => {
  await assert.rejects(composeVideo(request(), undefined, { key: "", sample: async () => { throw new Error("must not sample"); } }), (error: unknown) => error instanceof VideoComposerError && error.status === 503);
});
test("provider refusal, incomplete, malformed and unsafe outputs return sanitized errors", async () => {
  const malicious = plan(); malicious.shots[0].sourceClipId = "invented";
  const cases = [new Response("secret raw provider details", { status: 500 }), Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "private details" }] }] }), Response.json({ status: "incomplete", output: [] }), new Response("not-json"), completed(malicious)];
  for (const response of cases) await assert.rejects(composeVideo(request(), undefined, { key: "local-test", sample, fetch: async () => response }), (error: unknown) => error instanceof VideoComposerError && !/private|secret|invented/.test(error.message));
  await assert.rejects(composeVideo(request(), undefined, { key: "local-test", sample, fetch: async () => { throw new Error("local-test-key private connection detail"); } }), /could not reach its provider/);
});
test("abort propagates and prevents generation after cancellation", async () => {
  const controller = new AbortController(); let providerCalled = false;
  const stopped = composeVideo(request(), controller.signal, { key: "local-test", sample: async (input, signal) => {
    controller.abort(new Error("Stopped by user")); signal.throwIfAborted(); return { request: input, images: [], warnings: [] };
  }, fetch: async () => { providerCalled = true; return completed(); } });
  await assert.rejects(stopped, /Stopped by user/); assert.equal(providerCalled, false);
});
test("real thumbnails are bounded, use existing R2 footage and constrain actual recording duration", async () => {
  const fixture = await readFile(new URL("../e2e/fixtures/device-demo.mp4", import.meta.url));
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, { R2_ACCOUNT_ID: "local-test", R2_ACCESS_KEY_ID: "local-test", R2_SECRET_ACCESS_KEY: "local-test", R2_BUCKET_NAME: "local-test", R2_PUBLIC_URL: "https://media.example.test" });
  let downloads = 0;
  globalThis.fetch = async (url) => { assert.ok(String(url).startsWith("https://media.example.test/")); downloads++; return new Response(fixture, { headers: { "Content-Length": String(fixture.length) } }); };
  try {
    const input = request(); const base = input.timeline.clips[0];
    input.timeline.clips = Array.from({ length: 5 }, (_, index) => ({ ...base, id: `source-${index}`, sourceUrl: `https://media.example.test/${index}.mp4`, outMs: 8000 }));
    const result = await sampleCompositionThumbnails(input, new AbortController().signal);
    assert.equal(downloads, 4); assert.equal(result.images.length, 8);
    assert.ok(result.images.every(image => image.dataUrl.startsWith("data:image/jpeg;base64,")));
    assert.equal(result.request.timeline.clips[0].outMs, 5000); assert.equal(result.request.timeline.clips[0].sourceDurationMs, 5000);
    assert.equal(result.request.timeline.clips[4].outMs, 8000);
    assert.ok(result.warnings.some(warning => warning.includes("first four"))); assert.ok(result.warnings.some(warning => warning.includes("bounded")));
    assert.equal(input.timeline.clips[0].outMs, 8000);
    const unsafe = request(); unsafe.timeline.clips[0].sourceUrl = "https://untrusted.example/video.mp4";
    const failed = await sampleCompositionThumbnails(unsafe, new AbortController().signal);
    assert.equal(downloads, 4); assert.equal(failed.images.length, 0); assert.ok(failed.warnings.some(warning => warning.includes("sampling failed")));
  } finally { globalThis.fetch = previousFetch; }
});
test("sampling abort reaches the actual media request", async () => {
  const previousFetch = globalThis.fetch; const controller = new AbortController(); let seenSignal: AbortSignal | undefined;
  globalThis.fetch = async (_url, options) => {
    seenSignal = options?.signal ?? undefined;
    controller.abort(new Error("Cancel download"));
    options?.signal?.throwIfAborted(); throw new Error("unreachable");
  };
  try { await assert.rejects(sampleCompositionThumbnails(request(), controller.signal), /Cancel download/); assert.equal(seenSignal?.aborted, true); }
  finally { globalThis.fetch = previousFetch; }
});
test("compose route authenticates read/write separately and does not save invalid/unconfigured previews", async () => {
  const previousKey = process.env.OPENAI_API_KEY; delete process.env.OPENAI_API_KEY;
  const { GET, POST } = await import("../app/api/v1/videos/compose/route.ts");
  try {
    assert.equal((await GET(new Request("https://relay.test/api/v1/videos/compose"))).status, 401);
    const setup = await GET(new Request("https://relay.test/api/v1/videos/compose", { headers: { Authorization: "Bearer read-only" } }));
    assert.equal((await setup.json()).data.available, false); assert.equal(setup.headers.get("cache-control"), "no-store");
    const makePost = (token: string, body: unknown) => new Request("https://relay.test/api/v1/videos/compose", { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await POST(makePost("Bearer read-only", request()))).status, 403);
    assert.equal((await POST(makePost("Bearer write", { prompt: "bad" }))).status, 400);
    assert.equal((await POST(makePost("Bearer write", request()))).status, 503);
  } finally { if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey; }
});

test("compose validates library image backgrounds before sampling or generating a preview", async () => {
  const previousFetch=globalThis.fetch,previousKey=process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  Object.assign(process.env,{R2_ACCOUNT_ID:"local",R2_ACCESS_KEY_ID:"local",R2_SECRET_ACCESS_KEY:"local",R2_BUCKET_NAME:"local",R2_PUBLIC_URL:"https://media.example.test"});
  let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("Must not fetch invalid backgrounds");};
  const {POST}=await import("../app/api/v1/videos/compose/route.ts");
  const make=(input:unknown,token="Bearer write")=>new Request("https://relay.test/api/v1/videos/compose",{method:"POST",headers:{Authorization:token},body:JSON.stringify(input)});
  try {
    for(const imageUrl of ["https://outside.example/background.png","https://media.example.test/background.png?redirect=https://outside.example","https://user:password@media.example.test/background.png","https://media.example.test/folder%2Fprivate.png"]) {
      const input=request();input.timeline.background={color:"#112233",imageUrl,imageFit:"cover"};
      const response=await POST(make(input));
      assert.equal(response.status,400);assert.match((await response.json()).error,/Relay R2 library/);
      assert.equal((await POST(make(input,"Bearer read-only"))).status,403);
    }
    const allowed=request();allowed.timeline.background={color:"#112233",imageUrl:"https://media.example.test/background.png",imageFit:"contain"};
    assert.equal((await POST(make(allowed))).status,503,"valid image reaches provider availability validation");
    assert.equal(calls,0);
  } finally {
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
  }
});

test("authenticated compose route samples footage and returns the provider edit without persistence", async () => {
  const previousFetch = globalThis.fetch, previousKey = process.env.OPENAI_API_KEY;
  const fixture = await readFile(new URL("../e2e/fixtures/device-demo.mp4", import.meta.url));
  process.env.OPENAI_API_KEY = "local-route-test-key";
  const calls: string[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    if (String(url) === "https://media.example.test/demo.mp4") return new Response(fixture);
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(options?.body));
    assert.equal(body.store, false);
    assert.equal(body.input[0].content.filter((item: { type: string }) => item.type === "input_image").length, 2);
    return completed();
  };
  const { POST } = await import("../app/api/v1/videos/compose/route.ts");
  try {
    const response = await POST(new Request("https://relay.test/api/v1/videos/compose", { method: "POST", headers: { Authorization: "Bearer write", "Content-Type": "application/json" }, body: JSON.stringify(request()) }));
    assert.equal(response.status, 200);
    const result = (await response.json()).data;
    assert.equal(result.provider, "openai");
    assert.equal(result.timeline.clips[0].sourceUrl, request().timeline.clips[0].sourceUrl);
    assert.equal(result.timeline.labels[0].text, "Relay");
    assert.equal(result.timeline.clips[0].deviceFrame.animation.keyframes.length, 2);
    assert.deepEqual(calls, ["https://media.example.test/demo.mp4", "https://api.openai.com/v1/responses"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey;
  }
});
