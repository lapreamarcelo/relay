import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { SlideshowProject, SlideshowSlide, VideoTimeline } from "@relay/core";
import sharp from "sharp";
import { renderSlideshowImage } from "./slideshow-renderer.ts";
import { normalizeSlides, type SlideshowRow } from "./slideshows.ts";
import type { VideoProjectRow } from "./videos.ts";
import type { RenderJobRow } from "./render-jobs.ts";

type OwnedSlideshow = SlideshowRow & { owner_id: string };
type OwnedVideo = VideoProjectRow & { owner_id: string };
type OwnedJob = RenderJobRow & { owner_id: string };
const projects = new Map<string, OwnedSlideshow>();
const videos = new Map<string, OwnedVideo>();
const jobs = new Map<string, OwnedJob>();
const writes: Array<{ Key: string; Body: Buffer | string }> = [];
const flattened: SlideshowSlide[] = [];
const renders: Array<{ projectId: string; timeline: VideoTimeline; targetKey: string }> = [];
const removedKeys: string[] = [];
let encoderError: Error | undefined;
let cleanupError: Error | undefined;
let mutations = 0;
let inTransaction = false;
let beforeSourceUpdate: (() => void) | undefined;
const scopes = new Set(["slideshows:read", "slideshows:write", "videos:read", "videos:write"]);
const source = await sharp({ create: { width: 120, height: 180, channels: 3, background: "#E02020" } }).png().toBuffer();
const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const statement = strings.join("").replace(/\s+/g, " ").trim();
  if (statement.startsWith("SELECT") && statement.includes('FROM "brand"')) return values[0] === "brand" && values[1] === "owner" ? [{ id: "brand" }] : [];
  if (statement.startsWith("SELECT") && statement.includes('FROM "slideshow_project"')) {
    const single = statement.includes("WHERE id =");
    return [...projects.values()].filter(project => project.owner_id === values[single ? 1 : 0] && (!single || project.id === values[0])).map(project => structuredClone(project));
  }
  if (statement.startsWith('INSERT INTO "slideshow_project"')) {
    mutations++;
    const row: OwnedSlideshow = { id: String(values[0]), owner_id: String(values[1]), brand_id: values[2] as string | null, name: String(values[3]), caption: String(values[4]), slides: JSON.parse(String(values[5])), output: JSON.parse(String(values[6])), created_at: new Date(), updated_at: new Date() };
    projects.set(row.id, row); return [row];
  }
  if (statement.startsWith('UPDATE "slideshow_project"')) {
    const render = statement.includes("SET slides =");
    if (render && beforeSourceUpdate) { const update = beforeSourceUpdate; beforeSourceUpdate = undefined; update(); }
    const row = projects.get(String(values[render ? 1 : 5]));
    if (!row || row.owner_id !== values[render ? 2 : 6]) return [];
    if (render) {
      assert.match(statement, /AND slides = .*AND name = .*AND caption = /);
      assert.match(statement, /brand_id IS NOT DISTINCT FROM .*AND output = /);
      if (JSON.stringify(row.slides) !== values[3] || row.name !== values[4] || row.caption !== values[5] || row.brand_id !== values[6] || JSON.stringify(row.output ?? { format: "images" }) !== values[7]) return [];
    }
    mutations++;
    if (render) row.slides = JSON.parse(String(values[0]));
    else Object.assign(row, { brand_id: values[0], name: String(values[1]), caption: String(values[2]), slides: JSON.parse(String(values[3])), ...(values[4] === null ? {} : { output: JSON.parse(String(values[4])) }) });
    row.updated_at = new Date(); return [row];
  }
  if (statement.startsWith('INSERT INTO "video_project"')) {
    assert.ok(inTransaction, "video creation and source snapshot are atomic"); mutations++;
    const row: OwnedVideo = { id: String(values[0]), owner_id: String(values[1]), brand_id: values[2] as string | null, name: String(values[3]), caption: String(values[4]), source_url: "", source_folder_id: String(values[5]), music_url: null, music_folder_id: null, labels: [], timeline: JSON.parse(String(values[6])), revision: 1, rendered_url: values[7] as string | null, rendered_cover_url: values[8] as string | null, created_at: new Date(), updated_at: new Date() };
    videos.set(row.id, row); return [row];
  }
  if (statement.startsWith('INSERT INTO "video_render_job"')) {
    assert.ok(inTransaction, "queued render snapshot and derived project are atomic"); mutations++;
    const row: OwnedJob = { id: String(values[0]), owner_id: String(values[1]), project_id: String(values[2]), revision: Number(values[3]), snapshot: JSON.parse(String(values[4])), kind: "render", status: "queued", progress: 0, rendered_url: null, error: null };
    jobs.set(row.id, row); return [row];
  }
  if (statement.startsWith('UPDATE "video_project"')) {
    const row = videos.get(String(values[2]));
    if (!row || row.owner_id !== values[3] || row.revision !== values[4]) return [];
    mutations++; row.rendered_url = String(values[0]); row.rendered_cover_url = values[1] as string | null; return [row];
  }
  throw new Error(`Unexpected SQL: ${statement}`);
};
const sql = Object.assign(query, { begin: async (callback: (transaction: typeof query) => unknown) => {
  inTransaction = true;
  try { return await callback(query); } finally { inTransaction = false; }
} });
const publicUrl = "https://media.example.test";
const adapter = {
  sql,
  authorize: async (request: Request, options: { apiKeyScope: string }) => {
    if (!request.headers.has("authorization")) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
    if (!scopes.has(options.apiKeyScope)) return { response: Response.json({ error: `Missing ${options.apiKeyScope}` }, { status: 403 }) };
    return { session: { user: { id: "owner" } } };
  },
  r2: { send: async (command: { input: { Key?: string; Body?: Buffer | string; Delete?: { Objects: Array<{ Key: string }> } } }) => {
    if (command.input.Delete) {
      if (cleanupError) throw cleanupError;
      const keys = command.input.Delete.Objects.map(item => item.Key);
      removedKeys.push(...keys);
      for (let index = writes.length - 1; index >= 0; index--) if (keys.includes(writes[index].Key)) writes.splice(index, 1);
    } else { assert.ok(command.input.Key); assert.ok(command.input.Body); writes.push({ Key: command.input.Key, Body: command.input.Body }); }
    return {};
  } },
  flatten: async (bytes: Buffer, slide: SlideshowSlide) => { flattened.push(structuredClone(slide)); return renderSlideshowImage(bytes, slide); },
  render: async (input: { projectId: string; timeline: VideoTimeline; targetKey: string }) => {
    renders.push(input);
    assert.equal(mutations, 0, "synchronous encoding must succeed before database mutations");
    if (encoderError) throw encoderError;
    return { url: `${publicUrl}/${input.targetKey}`, coverUrl: `${publicUrl}/${input.targetKey.replace(/\.mp4$/, ".jpg")}`, durationMs: input.timeline.clips.reduce((sum, clip) => sum + clip.outMs - clip.inMs, 0) };
  },
};
Object.assign(globalThis, { __relaySlideshowRoutesAdapter: adapter });
registerHooks({ resolve(specifier, context, next) {
  let code: string | undefined;
  if (specifier === "@relay/database") code = "export const sql=globalThis.__relaySlideshowRoutesAdapter.sql";
  else if (specifier.endsWith("/api-session")) code = "export const requireApiSession=globalThis.__relaySlideshowRoutesAdapter.authorize";
  else if (specifier.endsWith("/r2")) code = `export const getR2Client=()=>globalThis.__relaySlideshowRoutesAdapter.r2;export const getR2Config=()=>({bucket:'local',publicUrl:'${publicUrl}'});export const publicObjectUrl=key=>'${publicUrl}/'+key`;
  else if (specifier.endsWith("/slideshow-renderer")) code = "export const renderSlideshowImage=globalThis.__relaySlideshowRoutesAdapter.flatten";
  else if (specifier.endsWith("/video-renderer")) code = "export const renderVideoArtifactDetails=globalThis.__relaySlideshowRoutesAdapter.render";
  if (code) return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
  try { return next(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context); throw error; }
} });
globalThis.fetch = async () => new Response(source);
const crud = await import("../app/api/v1/slideshows/route.ts");
const renderRoute = await import("../app/api/v1/slideshows/render/route.ts");
const defaultSlides = () => normalizeSlides([
  { id: "second", mediaUrl: `${publicUrl}/second.png`, text: "First overlay", fit: "contain", deviceFrame: { device: "phone", color: "#202020", background: "#123456" } },
  { id: "first", mediaUrl: `${publicUrl}/first.png`, renderedUrl: `${publicUrl}/stale.jpg`, text: "Second overlay", fit: "cover" },
])!;
function reset(output?: SlideshowProject["output"]) {
  projects.clear(); videos.clear(); jobs.clear(); writes.length = 0; flattened.length = 0; renders.length = 0; mutations = 0;
  beforeSourceUpdate = undefined; encoderError = undefined; cleanupError = undefined; removedKeys.length = 0;
  scopes.clear(); for (const scope of ["slideshows:read", "slideshows:write", "videos:read", "videos:write"]) scopes.add(scope);
  projects.set("slideshow", { id: "slideshow", owner_id: "owner", brand_id: "brand", name: "Launch", caption: "Original caption", slides: defaultSlides(), ...(output ? { output } : {}), created_at: new Date(), updated_at: new Date() });
}
const request = (body: unknown, authorize = true) => new Request("https://relay.test/api/v1/slideshows/render", { method: "POST", headers: authorize ? { authorization: "Bearer test" } : {}, body: JSON.stringify(body) });
const render = (body: unknown, authorize = true) => renderRoute.POST(request(body, authorize));

test("existing image renders stay synchronous and can select individual slides with only slideshow scope", async () => {
  reset(); scopes.delete("videos:write"); scopes.delete("videos:read");
  const response = await render({ id: "slideshow", slideIds: ["second"] });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.format, "images"); assert.equal(result.video, undefined);
  assert.equal(flattened.length, 1); assert.equal(flattened[0].id, "second");
  assert.equal(result.data.slides[1].renderedUrl, `${publicUrl}/stale.jpg`);
  assert.deepEqual(result.data.output, { format: "images" });
  assert.equal(videos.size, 0); assert.equal(jobs.size, 0);
});

test("video renders freshly flatten every designed slide in order and persist a reusable video project", async () => {
  reset({ format: "video", imageSeconds: 3 });
  const original = structuredClone(projects.get("slideshow")!.slides);
  const response = await render({ id: "slideshow" });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.format, "video"); assert.equal(result.video.durationMs, 6000);
  assert.match(result.video.url, /\/media\/slideshow\.mp4$/); assert.ok(result.video.coverUrl);
  assert.deepEqual(flattened, original, "original labels, device frames, fit, and slide order reach the image renderer unchanged");
  assert.equal(renders.length, 1);
  const timeline = renders[0].timeline;
  assert.equal(timeline.aspectRatio, "9:16"); assert.deepEqual(timeline.labels, []);
  assert.deepEqual(timeline.clips.map(clip => clip.sourceUrl), result.data.slides.map((slide: SlideshowSlide) => slide.renderedUrl));
  assert.ok(timeline.clips.every(clip => clip.sourceUrl !== `${publicUrl}/stale.jpg` && clip.outMs === 3000 && clip.volume === 0 && !clip.transition));
  assert.deepEqual(result.data.slides.map(({ renderedUrl: _renderedUrl, ...slide }: SlideshowSlide) => slide), original.map(({ renderedUrl: _renderedUrl, ...slide }) => slide));
  const video = videos.get(result.video.projectId)!;
  assert.equal(video.owner_id, "owner"); assert.equal(video.brand_id, "brand"); assert.equal(video.caption, "Original caption");
  assert.equal(video.rendered_url, result.video.url); assert.equal(video.rendered_cover_url, result.video.coverUrl);
  assert.equal(video.source_folder_id, result.folder.id); assert.deepEqual(video.timeline, timeline);
  assert.equal(jobs.size, 0);
});

test("async output creates a durable normal render job and skips inline encoding", async () => {
  reset({ format: "video" });
  const response = await render({ id: "slideshow", async: true });
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.video.durationMs, 8000); assert.equal(result.video.url, undefined);
  assert.equal(result.job.status, "queued"); assert.equal(result.job.progress, 0); assert.equal(result.job.revision, 1);
  assert.equal(result.job.projectId, result.video.projectId); assert.equal(result.folder.id, result.job.id);
  const stored = jobs.get(result.job.id)!;
  assert.equal(stored.owner_id, "owner"); assert.equal(stored.snapshot!.id, result.video.projectId);
  assert.deepEqual(stored.snapshot!.timeline, videos.get(result.video.projectId)!.timeline);
  assert.ok(stored.snapshot!.timeline!.clips.every(clip => clip.kind === "image" && clip.outMs === 4000));
  assert.equal(flattened.length, 2); assert.equal(renders.length, 0);
});

test("explicit output overrides do not change the saved preference", async () => {
  reset({ format: "video", imageSeconds: 3 });
  const images = await (await render({ id: "slideshow", format: "images" })).json();
  assert.equal(images.format, "images"); assert.equal(images.video, undefined);
  assert.deepEqual(images.data.output, { format: "video", imageSeconds: 3 });
  reset();
  const video = await (await render({ id: "slideshow", format: "video", imageSeconds: 5 })).json();
  assert.equal(video.video.durationMs, 10_000); assert.deepEqual(video.data.output, { format: "images" });
  reset({ format: "video", imageSeconds: 3 });
  const override = await (await render({ id: "slideshow", imageSeconds: 5 })).json();
  assert.equal(override.video.durationMs, 10_000); assert.equal(override.data.output.imageSeconds, 3);
});

test("single-slide video output defaults to eight seconds", async () => {
  reset(); projects.get("slideshow")!.slides.length = 1;
  const result = await (await render({ id: "slideshow", format: "video" })).json();
  assert.equal(result.video.durationMs, 8000);
});

test("invalid output, timing, async flags, and partial video requests fail before storage or mutations", async () => {
  for (const changes of [{ format: "gif" }, { async: "true" }, { format: "video", slideIds: [] }, { format: "video", slideIds: null }, ...[0, 2, 6, 4.5, "4", null].map(imageSeconds => ({ format: "video", imageSeconds }))]) {
    reset();
    assert.equal((await render({ id: "slideshow", ...changes })).status, 400, JSON.stringify(changes));
    assert.equal(writes.length, 0); assert.equal(flattened.length, 0); assert.equal(mutations, 0);
  }
});

test("video scopes and slideshow ownership are checked before creating storage, video projects, or jobs", async () => {
  reset(); assert.equal((await render({ id: "slideshow" }, false)).status, 401);
  for (const [missing, body] of [["slideshows:write", { id: "slideshow", format: "video" }], ["videos:write", { id: "slideshow", format: "video" }], ["videos:read", { id: "slideshow", format: "video", async: true }]] as const) {
    reset(); scopes.delete(missing);
    assert.equal((await render(body)).status, 403);
    assert.equal(writes.length, 0); assert.equal(mutations, 0);
  }
  reset(); scopes.delete("videos:read");
  assert.equal((await render({ id: "slideshow", format: "video" })).status, 200, "synchronous video output does not require polling scope");
  reset(); projects.get("slideshow")!.owner_id = "another-owner";
  assert.equal((await render({ id: "slideshow", format: "video" })).status, 404);
  assert.equal(writes.length, 0); assert.equal(mutations, 0);
});

test("CRUD persists optional video output and PATCH preserves it when omitted", async () => {
  reset();
  const body = { name: "Saved", caption: "Caption", slides: defaultSlides(), output: { format: "video", imageSeconds: 5 } };
  const created = await crud.POST(request(body));
  assert.equal(created.status, 201);
  const { data } = await created.json();
  assert.deepEqual(data.output, body.output);
  const updated = await crud.PATCH(request({ id: data.id, name: "Edited", slides: defaultSlides() }));
  assert.equal(updated.status, 200); assert.deepEqual((await updated.json()).data.output, body.output);
  const listed = await crud.GET(new Request(`https://relay.test/api/v1/slideshows?id=${data.id}`, { headers: { authorization: "Bearer test" } }));
  assert.deepEqual((await listed.json()).data.output, body.output);
  const changed = await crud.PATCH(request({ id: data.id, name: "Images", slides: defaultSlides(), output: { format: "images" } }));
  assert.deepEqual((await changed.json()).data.output, { format: "images" });
  reset();
  const legacy = await crud.POST(request({ name: "Legacy", slides: [] }));
  assert.equal(legacy.status, 201); assert.deepEqual((await legacy.json()).data.output, { format: "images" });
});

test("CRUD rejects invalid timing and unauthorized project edits without mutations", async () => {
  for (const output of [{ format: "mp4" }, { format: "video", imageSeconds: 8 }, { format: "video", imageSeconds: null }]) {
    reset();
    const response = await crud.POST(request({ name: "Invalid", slides: defaultSlides(), output }));
    assert.equal(response.status, 400); assert.equal(mutations, 0);
  }
  reset(); projects.get("slideshow")!.owner_id = "another-owner";
  assert.equal((await crud.PATCH(request({ id: "slideshow", name: "Changed", slides: defaultSlides(), output: { format: "video" } }))).status, 404);
  assert.equal(mutations, 0);
});

test("rendering cannot overwrite concurrent slideshow edits or queue a stale video snapshot", async () => {
  for (const format of ["images", "video"] as const) {
    for (const edit of ["slides", "name", "caption", "brand", "output", "delete"]) {
      reset({ format: "video", imageSeconds: 3 });
      beforeSourceUpdate = () => {
        const row = projects.get("slideshow")!;
        if (edit === "slides") row.slides[0].text = "Changed in another tab";
        if (edit === "name") row.name = "Changed in another tab";
        if (edit === "caption") row.caption = "Changed in another tab";
        if (edit === "brand") row.brand_id = null;
        if (edit === "output") row.output = { format: "images" };
        if (edit === "delete") projects.delete("slideshow");
      };
      const response = await render({ id: "slideshow", format, ...(format === "video" ? { async: true } : {}) });
      assert.equal(response.status, 409, `${format}: ${edit}`);
      assert.match((await response.json()).error, /Reload/);
      assert.equal(mutations, 0); assert.equal(videos.size, 0); assert.equal(jobs.size, 0); assert.equal(renders.length, 0);
      if (edit === "slides") assert.equal(projects.get("slideshow")!.slides[0].text, "Changed in another tab");
    }
  }
});

test("a synchronous encoder failure leaves no project, source mutation, or new media folder", async () => {
  reset({ format: "video" });
  const original = structuredClone(projects.get("slideshow"));
  encoderError = new Error("Encoder failed after upload");
  const originalError = console.error; console.error = () => {};
  let response: Response;
  try { response = await render({ id: "slideshow" }); } finally { console.error = originalError; }
  assert.equal(response.status, 500); assert.match((await response.json()).error, /Encoder failed after upload/);
  assert.deepEqual(projects.get("slideshow"), original);
  assert.equal(mutations, 0); assert.equal(videos.size, 0); assert.equal(jobs.size, 0); assert.equal(writes.length, 0);
  assert.ok(removedKeys.some(key => key.endsWith("/media/slideshow.mp4")));
  assert.ok(removedKeys.some(key => key.endsWith("/media/slideshow.jpg")));
  assert.ok(removedKeys.every(key => key.startsWith("media-projects/")));
  assert.equal(removedKeys.some(key => key.includes("stale.jpg") || key.includes("first.png") || key.includes("second.png")), false);
});

test("a source edit after synchronous encoding preserves the edit and removes the new artifacts", async () => {
  reset({ format: "video" });
  beforeSourceUpdate = () => { projects.get("slideshow")!.caption = "Changed during encoding"; };
  const response = await render({ id: "slideshow" });
  assert.equal(response.status, 409); assert.equal(renders.length, 1);
  assert.equal(projects.get("slideshow")!.caption, "Changed during encoding");
  assert.equal(mutations, 0); assert.equal(videos.size, 0); assert.equal(jobs.size, 0); assert.equal(writes.length, 0);
  assert.ok(removedKeys.some(key => key.endsWith("/media/slideshow.mp4")));
});

test("storage cleanup errors preserve the original synchronous render failure", async () => {
  reset({ format: "video" }); encoderError = new Error("Primary encoding failure"); cleanupError = new Error("Cleanup outage");
  const originalError = console.error; console.error = () => {};
  let response: Response;
  try { response = await render({ id: "slideshow" }); } finally { console.error = originalError; }
  assert.equal(response.status, 500); assert.match((await response.json()).error, /Primary encoding failure/);
  assert.equal(mutations, 0); assert.equal(videos.size, 0);
});
