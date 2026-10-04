import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import type { VideoTimeline } from "@relay/core";
import type { VideoProjectRow } from "./videos.ts";
import { emptyTimeline, timelineDuration } from "./video-timeline.ts";

// Run the production route/serializers. Only authentication, database and
// render enqueue use local adapters, so no cloud services or workers are needed.
let source: VideoProjectRow;
let inserts = 0;
let queries = 0;
let failRenderAt = -1;
const variants = new Map<string, VideoProjectRow>();
const jobs = new Map<string, { id: string; projectId: string }>();
const enqueued: string[] = [];
Object.assign(globalThis, { __relayVideoVariantsAdapter: {
  sql: async (strings: TemplateStringsArray, ...values: unknown[]) => {
    queries++;
    if (strings.join("").startsWith("SELECT")) return values[0] === source.id && values[1] === "owner" ? [source] : [];
    assert.match(strings.join(""), /ON CONFLICT\(owner_id,client_request_id\).*DO UPDATE SET updated_at=video_project.updated_at/);
    assert.equal(values[1], "owner");
    inserts++;
    const key = String(values[8]);
    if (!variants.has(key)) variants.set(key, { ...source, id: String(values[0]), name: String(values[3]), caption: String(values[4]), source_url: String(values[5]), labels: [], timeline: JSON.parse(String(values[6])) });
    return [variants.get(key)];
  },
  enqueueRender: async (owner: string, id: string) => {
    assert.equal(owner, "owner");
    enqueued.push(id);
    if (enqueued.length - 1 === failRenderAt) throw new Error("Render queue unavailable");
    if (!jobs.has(id)) jobs.set(id, { id: `job-${id}`, projectId: id });
    return { job: jobs.get(id) };
  },
} });
registerHooks({ resolve(specifier, context, nextResolve) {
  let code: string | undefined;
  if (specifier === "@relay/database") code = "export const sql=globalThis.__relayVideoVariantsAdapter.sql";
  else if (specifier.endsWith("/render-jobs")) code = "export const enqueueRender=globalThis.__relayVideoVariantsAdapter.enqueueRender";
  else if (specifier.endsWith("/api-session")) code = `export async function requireApiSession(request,options){const token=request.headers.get('authorization');if(!token)return{response:Response.json({error:'Unauthorized'},{status:401})};if(token!=='Bearer write'||options.apiKeyScope!=='videos:write')return{response:Response.json({error:'Missing write scope'},{status:403})};return{session:{user:{id:'owner'}}}}`;
  if (code) return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { POST } = await import("../app/api/v1/videos/variants/route.ts");
const fixture = (): VideoTimeline => ({ ...emptyTimeline(), background: { color: "#112233", endColor: "#445566" }, clips: [{ id: "clip", name: "Phone recording", sourceUrl: "https://media.example.test/phone.mp4", kind: "video", inMs: 1000, outMs: 6000, fit: "contain", x: .5, y: .5, zoom: 1, volume: .4, deviceFrame: { device: "iphone", background: "#112233", color: "#171717", motion: "orbit", animation: { entrance: { preset: "pop", durationMs: 300 }, keyframes: [{ timeMs: 0, rotateY: -20 }, { timeMs: 2500, rotateY: 20 }] } } }], layers: [{ id: "watch", name: "Watch recording", sourceUrl: "https://media.example.test/watch.mp4", kind: "video", inMs: 0, outMs: 6000, startMs: 2000, fit: "contain", x: .3, y: .5, zoom: 1, volume: 0, deviceFrame: { device: "watch", background: "#112233", color: "#171717", motion: "float" } }], labels: ["brand", "hook"].map((id, index) => ({ id, text: index ? "Original hook" : "Brand stays", startMs: 500, endMs: 7500, x: .5, y: .2 + index * .2, width: .7, height: .12, fontSize: 64, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark", animation: { entrance: { preset: "typewriter", durationMs: 400 }, keyframes: [{ timeMs: 0, scale: .8 }, { timeMs: 1000, scale: 1.1 }] } })), music: { url: "https://media.example.test/music.wav", name: "Launch track", volume: .35, offsetMs: 200, startMs: 1000, endMs: 8000, fadeInMs: 400, fadeOutMs: 500 }, coverMs: 3000 });
function reset(timeline = fixture()) {
  source = { id: "source", brand_id: "brand", name: "App launch", caption: "Try {hook}: {hook}", source_url: "", source_folder_id: null, music_url: null, music_folder_id: null, labels: [], timeline, template_id: "saved-template", revision: 2, rendered_url: null, created_at: new Date(0), updated_at: new Date(0) };
  variants.clear(); jobs.clear(); enqueued.length = 0; inserts = 0; queries = 0; failRenderAt = -1;
}
const request = (body: unknown, token = "write") => POST(new Request("https://relay.test/api/v1/videos/variants", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
const input = (changes: Record<string, unknown> = {}) => ({ id: "source", labelId: "hook", clientRequestId: "batch-ten", hooks: Array.from({ length: 10 }, (_, i) => `  Hook ${i + 1}  `), ...changes });

test("ten selected-label variants preserve complete scenes and stable retry identities", async () => {
  reset(); const original = structuredClone(source);
  const response = await request(input()); assert.equal(response.status, 201);
  const { data } = await response.json(); assert.equal(data.length, 10); assert.equal(variants.size, 10);
  for (let i = 0; i < data.length; i++) {
    const expected = structuredClone(original.timeline!); expected.labels[1].text = `Hook ${i + 1}`;
    assert.deepEqual(data[i].project.timeline, expected);
    assert.equal(data[i].project.caption, `Try Hook ${i + 1}: Hook ${i + 1}`);
    assert.equal(data[i].project.templateId, "saved-template");
    assert.equal(data[i].project.sourceUrl, expected.clips[0].sourceUrl);
  }
  assert.deepEqual(source, original); assert.equal(enqueued.length, 0);
  const retry = await request(input({ hooks: Array.from({ length: 10 }, () => "Changed retry text") }));
  assert.deepEqual((await retry.json()).data, data, "retries return original project snapshots without overwriting edits");
  assert.equal(variants.size, 10);
});

test("partial enqueue failures keep every editable variant and allow an idempotent retry", async () => {
  reset(); failRenderAt = 3;
  const response = await request(input({ render: true })); assert.equal(response.status, 207);
  const { data } = await response.json(); assert.equal(data.length, 10); assert.equal(variants.size, 10); assert.equal(enqueued.length, 10);
  assert.equal(data[3].error, "Render queue unavailable"); assert.equal(data[3].job, undefined);
  assert.ok(data.filter((entry: { job?: unknown }) => entry.job).length === 9);
  failRenderAt = -1;
  const retry = await request(input({ render: true })); assert.equal(retry.status, 201);
  const retried = (await retry.json()).data;
  assert.deepEqual(retried.map((entry: { project: { id: string } }) => entry.project.id), data.map((entry: { project: { id: string } }) => entry.project.id));
  assert.equal(variants.size, 10); assert.equal(jobs.size, 10);
  for (const [index, entry] of data.entries()) if (entry.job) assert.deepEqual(retried[index].job, entry.job);
});

test("unknown or invalid label ids and invalid batches cannot mutate projects", async () => {
  for (const changes of [{ labelId: "missing" }, { labelId: "" }, { labelId: " " }, { labelId: null }, { labelId: 42 }, { hooks: [] }, { hooks: Array(21).fill("Hook") }, { hooks: [" "] }, { hooks: ["x".repeat(501)] }]) {
    reset(); const response = await request(input(changes)); assert.equal(response.status, 400, JSON.stringify(changes));
    assert.equal(inserts, 0); assert.equal(variants.size, 0); assert.equal(enqueued.length, 0);
  }
  reset({ ...fixture(), labels: [] });
  assert.equal((await request(input())).status, 400); assert.equal(inserts, 0);
});

test("legacy first-label and label-free layer-only variants remain compatible", async () => {
  reset(); let response = await request(input({ labelId: undefined, hooks: ["New first label"] }));
  assert.equal(response.status, 201); let timeline = (await response.json()).data[0].project.timeline;
  assert.equal(timeline.labels[0].text, "New first label"); assert.deepEqual(timeline.labels[1], source.timeline!.labels[1]);
  const layerOnly = { ...fixture(), clips: [], labels: [] }; reset(layerOnly);
  response = await request(input({ labelId: undefined, hooks: ["Layer-only launch"] })); assert.equal(response.status, 201);
  timeline = (await response.json()).data[0].project.timeline;
  assert.equal(timeline.labels[0].text, "Layer-only launch"); assert.equal(timeline.labels[0].endMs, Math.min(3000, timelineDuration(layerOnly)));
  assert.deepEqual(timeline.layers, layerOnly.layers); assert.deepEqual(timeline.music, layerOnly.music);
  assert.equal((await request(input({ labelId: undefined, hooks: ["Changed"] }))).status, 201);
  assert.equal(variants.size, 1);
});

test("variants route requires authenticated video write access before database reads", async () => {
  reset(); assert.equal((await request(input(), "")).status, 401); assert.equal((await request(input(), "read-only")).status, 403);
  assert.equal(queries, 0); assert.equal(inserts, 0);
});
