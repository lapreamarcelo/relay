import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { objectKeyFromPublicUrl } from "./video-download.ts";

// Execute the production routes against an in-memory R2 bucket. Authentication,
// signing, database access and rendering are adapters; no cloud calls are made.
const objects = new Map<string, string>();
const getFailures = new Map<string, number>();
const mutations: Array<{ type: string; key: string }> = [];
const renderedMusic: string[] = [];
let referencedVideo: { sourceUrl: string; musicUrl: string; sourceFolderId: string | null; musicFolderId: string | null } | null = null;
const projectA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const projectB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const projectMusic = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ownedKey = (owner: string, kind = "media", name = "clip.png") => `media-owners/${encodeURIComponent(owner)}/${kind}/${name}`;
const missing = () => Object.assign(new Error("Not found"), { $metadata: { httpStatusCode: 404 } });
const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const statement = strings.join("");
  if (statement.includes('SELECT * FROM "video_project"')) return [{ id: "video" }];
  // Apply the parameterized CASE updates to an in-memory saved video reference.
  if (statement.includes('UPDATE "video_project"') && referencedVideo) {
    if (referencedVideo.sourceUrl === values[0]) referencedVideo.sourceFolderId = values[1] as string | null;
    if (referencedVideo.musicUrl === values[2]) referencedVideo.musicFolderId = values[3] as string | null;
    if (referencedVideo.sourceUrl === values[4]) referencedVideo.sourceUrl = values[5] as string;
    if (referencedVideo.musicUrl === values[6]) referencedVideo.musicUrl = values[7] as string;
  }
  return [];
};
Object.assign(globalThis, { __relayMediaAdapter: {
  sql: Object.assign(query, { begin: async (callback: (transaction: typeof query) => unknown) => callback(query) }),
  config: { bucket: "local", publicUrl: "https://media.example.test" },
  url: (key: string) => `https://media.example.test/${key.split("/").map(encodeURIComponent).join("/")}`,
  sign: async (_client: unknown, command: { input: { Key: string } }) => `https://upload.example.test/${command.input.Key}`,
  client: { send: async (command: { constructor: { name: string }; input: { Key?: string; Prefix?: string; CopySource?: string; Delete?: { Objects: Array<{ Key: string }> } } }) => {
    const type = command.constructor.name, input = command.input, key = input.Key ?? "";
    if (type === "ListObjectsV2Command") return { Contents: [...objects.keys()].filter((key) => key.startsWith(input.Prefix ?? "")).sort().map((Key) => ({ Key, Size: 1, LastModified: new Date() })) };
    if (type === "GetObjectCommand") {
      if (getFailures.has(key)) throw Object.assign(new Error("Storage unavailable"), { $metadata: { httpStatusCode: getFailures.get(key) } });
      if (!objects.has(key)) throw missing(); return { Body: { transformToString: async () => objects.get(key) } };
    }
    if (type === "HeadObjectCommand") { if (!objects.has(key)) throw missing(); return {}; }
    mutations.push({ type, key });
    if (type === "PutObjectCommand") objects.set(key, "uploaded");
    else if (type === "CopyObjectCommand") { const source = decodeURIComponent(input.CopySource!).slice("local/".length); if (!objects.has(source)) throw missing(); objects.set(key, objects.get(source)!); }
    else if (type === "DeleteObjectCommand") objects.delete(key);
    else if (type === "DeleteObjectsCommand") for (const entry of input.Delete!.Objects) objects.delete(entry.Key);
    else throw new Error(`Unexpected R2 command ${type}`);
    return {};
  } },
  render: async (input: { musicUrl: string }) => { renderedMusic.push(input.musicUrl); return { url: "https://media.example.test/render.mp4", durationMs: 1000 }; },
} });
registerHooks({ resolve(specifier, context, nextResolve) {
  let code: string | undefined;
  if (specifier === "server-only") code = "export{}";
  else if (specifier === "@relay/database") code = "export const sql=globalThis.__relayMediaAdapter.sql";
  else if (specifier === "@aws-sdk/s3-request-presigner") code = "export const getSignedUrl=globalThis.__relayMediaAdapter.sign";
  else if (specifier.endsWith("/r2")) code = "export const getR2Client=()=>globalThis.__relayMediaAdapter.client;export const getR2Config=()=>globalThis.__relayMediaAdapter.config;export const publicObjectUrl=globalThis.__relayMediaAdapter.url";
  else if (specifier.endsWith("/api-session")) code = "export async function requireApiSession(request){const owner=request.headers.get('authorization');return owner?{session:{user:{id:owner}}}:{response:Response.json({error:'Unauthorized'},{status:401})}}";
  else if (context.parentURL?.includes("videos/batch/route.ts")) {
    if (specifier.endsWith("/video-renderer")) code = "export const renderVideoArtifactDetails=globalThis.__relayMediaAdapter.render";
    else if (specifier.endsWith("/videos")) code = "export const safeWebUrl=()=>'';export const selectMusicTrack=(_mode,tracks,index)=>tracks[index%tracks.length];export const serializeVideoProject=()=>({id:'video',name:'Video',caption:'',sourceUrl:'https://media.example.test/source.mp4',labels:[]})";
    else if (specifier.endsWith("/video-timeline")) code = "export const timelineDuration=()=>1000";
    else if (specifier.endsWith("/automatic-post-settings")) code = "export const automaticInstagramSettings=()=>({})";
  }
  if (code) return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const media = await import("../app/api/v1/media/route.ts");
const batch = await import("../app/api/v1/videos/batch/route.ts");
function reset() {
  objects.clear(); getFailures.clear(); mutations.length = 0; renderedMusic.length = 0; referencedVideo = null; delete process.env.RELAY_LEGACY_MEDIA_OWNER_ID;
  for (const [id, ownerId] of [[projectA, "A"], [projectB, "B"]]) objects.set(`media-projects/${id}/.project.json`, JSON.stringify({ id, ownerId, kind: "media" }));
}
async function request(method: keyof typeof media, owner: string, body?: unknown, search = "") {
  return (media[method] as (request: Request) => Promise<Response>)(new Request(`https://relay.test/api/v1/media${search}`, { method, headers: { authorization: owner, ...(body instanceof FormData ? {} : { "content-type": "application/json" }) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) }));
}
async function upload(owner: string, kind = "media", changes: Record<string, unknown> = {}) {
  const response = await request("POST", owner, { fileName: kind === "music" ? "track.mp3" : "clip.png", contentType: kind === "music" ? "audio/mpeg" : "image/png", kind, ...changes });
  assert.equal(response.status, 200); const result = await response.json(); objects.set(result.key, "uploaded"); return result;
}
async function listed(owner: string, search = "") {
  const response = await request("GET", owner, undefined, search); assert.equal(response.status, 200); return (await response.json()).data.map((entry: { key: string }) => entry.key);
}

test("direct unfiled upload signing creates keys owned by the authenticated account", async () => {
  reset();
  for (const kind of ["media", "music"]) {
    const result = await upload("A", kind);
    assert.ok(result.key.startsWith(`media-owners/A/${kind}/`), result.key);
    assert.equal((await listed("B", `?kind=${kind}`)).includes(result.key), false);
  }
});

test("server multipart uploads stay owned for both media and music", async () => {
  reset();
  for (const kind of ["media", "music"]) {
    const form = new FormData(); form.set("kind", kind); form.set("projectId", "unfiled"); form.set("file", new File(["bytes"], kind === "music" ? "voice.wav" : "photo.png", { type: kind === "music" ? "audio/wav" : "image/png" }));
    const response = await request("POST", "A", form); assert.equal(response.status, 201); const result = await response.json();
    assert.ok(result.key.startsWith(`media-owners/A/${kind}/`), result.key);
    assert.deepEqual(await listed("B", `?project=unfiled&kind=${kind}`), []);
  }
});

test("an account cannot list another account's direct uploads in all or unfiled views", async () => {
  reset(); const mediaUpload = await upload("A"), musicUpload = await upload("A", "music");
  for (const project of ["", "all", "unfiled"]) {
    assert.equal((await listed("B", `?project=${project}`)).includes(mediaUpload.key), false);
    assert.equal((await listed("B", `?project=${project}&kind=music`)).includes(musicUpload.key), false);
  }
});

test("another account cannot delete, rename or move uploaded media or music", async () => {
  for (const kind of ["media", "music"]) for (const [method, changes] of [["DELETE", {}], ["PATCH", { name: "stolen.png" }], ["PATCH", { projectId: "unfiled" }], ["PATCH", { projectId: projectB }]] as const) {
    reset(); const result = await upload("A", kind); mutations.length = 0;
    const response = await request(method, "B", { key: result.key, kind, ...changes });
    assert.equal(response.status, 404, `${kind} ${method} ${JSON.stringify(changes)}`);
    assert.deepEqual(mutations, []); assert.ok(objects.has(result.key));
  }
});

test("staging commit to unfiled keeps ownership and rejects a different account", async () => {
  for (const kind of ["media", "music"]) {
    reset(); const staged = await upload("A", kind, { staged: true }); mutations.length = 0;
    assert.equal((await request("PATCH", "B", { key: staged.key, kind, commit: true })).status, 404); assert.deepEqual(mutations, []);
    const response = await request("PATCH", "A", { key: staged.key, kind, commit: true }); assert.equal(response.status, 200); const result = await response.json();
    assert.ok(result.key.startsWith(`media-owners/A/${kind}/`), result.key); assert.equal(objects.has(staged.key), false);
    assert.deepEqual(await listed("B", `?kind=${kind}`), []);
    mutations.length = 0; assert.equal((await request("DELETE", "B", { key: result.key })).status, 404); assert.deepEqual(mutations, []);
  }
});

test("moving an owned project asset to unfiled preserves isolation and owner operations", async () => {
  reset(); const source = `media-projects/${projectA}/media/clip.png`; objects.set(source, "image");
  const moved = await request("PATCH", "A", { key: source, projectId: null }); assert.equal(moved.status, 200); const { key } = await moved.json();
  assert.equal(key, ownedKey("A")); assert.deepEqual(await listed("A", "?project=unfiled"), [key]); assert.deepEqual(await listed("B"), []);
  const renamed = await request("PATCH", "A", { key, name: "new.png" }); assert.equal(renamed.status, 200); const next = (await renamed.json()).key;
  assert.equal(next, ownedKey("A", "media", "new.png")); assert.equal((await request("DELETE", "A", { key: next })).status, 204); assert.equal(objects.has(next), false);
});

test("owners can list, rename, move and delete new unfiled music", async () => {
  reset(); const track = await upload("A", "music"); assert.deepEqual(await listed("A", "?project=unfiled&kind=music"), [track.key]);
  const renamed = await request("PATCH", "A", { key: track.key, kind: "music", name: "new.mp3" }); assert.equal(renamed.status, 200); const next = (await renamed.json()).key;
  assert.equal(next, ownedKey("A", "music", "new.mp3")); assert.equal((await request("DELETE", "A", { key: next })).status, 204);
});

test("new owner paths preserve project operations and reject cross-owner project mutations", async () => {
  reset(); const result = await upload("A");
  const response = await request("PATCH", "A", { key: result.key, projectId: projectA }); assert.equal(response.status, 200);
  const projectKey = (await response.json()).key;
  assert.ok(projectKey.startsWith(`media-projects/${projectA}/media/`));
  assert.deepEqual(await listed("A", `?project=${projectA}`), [projectKey]);
  assert.deepEqual(await listed("A", "?project=unfiled"), []); assert.deepEqual(await listed("B"), []);
  for (const method of ["DELETE", "PATCH"] as const) {
    mutations.length = 0;
    assert.equal((await request(method, "B", { key: projectKey, name: "stolen.png" })).status, 404);
    assert.deepEqual(mutations, []); assert.ok(objects.has(projectKey));
  }
});

test("project access returns 404 for another account's folder", async () => {
  reset();
  const response = await request("GET", "B", undefined, `?project=${projectA}`);
  assert.equal(response.status, 404); assert.deepEqual(mutations, []);
});

test("project access returns 404 for missing manifests across reads and mutations", async () => {
  reset(); const missingProject = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const key = `media-projects/${missingProject}/media/clip.png`; objects.set(key, "image");
  assert.equal((await request("GET", "A", undefined, `?project=${missingProject}`)).status, 404);
  for (const method of ["DELETE", "PATCH"] as const) assert.equal((await request(method, "A", { key, name: "renamed.png" })).status, 404);
  assert.deepEqual(mutations, []); assert.ok(objects.has(key));
});

test("project access preserves infrastructure failures as server errors", async () => {
  reset(); const key = `media-projects/${projectA}/media/clip.png`; objects.set(key, "image");
  getFailures.set(`media-projects/${projectA}/.project.json`, 503);
  assert.equal((await request("GET", "A", undefined, `?project=${projectA}`)).status, 500);
  for (const method of ["DELETE", "PATCH"] as const) assert.equal((await request(method, "A", { key, name: "renamed.png" })).status, 500);
  assert.deepEqual(mutations, []); assert.ok(objects.has(key));
});

test("owner key boundaries survive public URL parsing and staged cancellation", async () => {
  for (const owner of ["A / %", "music"]) {
    reset(); const result = await upload(owner);
    assert.ok(result.key.startsWith(`media-owners/${encodeURIComponent(owner)}/media/`));
    assert.equal(objectKeyFromPublicUrl(result.url, "https://media.example.test"), result.key);
    assert.deepEqual(await listed("A"), []); assert.deepEqual(await listed(owner), [result.key]);
  }
  const staged = await upload("A", "music", { staged: true }); mutations.length = 0;
  assert.equal((await request("DELETE", "B", { key: staged.key })).status, 404); assert.deepEqual(mutations, []);
  assert.equal((await request("DELETE", "A", { key: staged.key })).status, 204); assert.equal(objects.has(staged.key), false);
});

test("music staging and project-to-unfiled moves use the same ownership policy", async () => {
  reset(); objects.set(`media-projects/${projectMusic}/.project.json`, JSON.stringify({ id: projectMusic, ownerId: "A", kind: "music" }));
  const staged = await upload("A", "music", { staged: true });
  const committed = await request("PATCH", "A", { key: staged.key, commit: true, kind: "music", projectId: projectMusic }); assert.equal(committed.status, 200);
  const committedKey = (await committed.json()).key; assert.ok(committedKey.startsWith(`media-projects/${projectMusic}/music/`));
  const moved = await request("PATCH", "A", { key: committedKey, kind: "music", projectId: "unfiled" }); assert.equal(moved.status, 200);
  const nextKey = (await moved.json()).key; assert.ok(nextKey.startsWith("media-owners/A/music/"));
  assert.deepEqual(await listed("A", "?kind=music&project=unfiled"), [nextKey]); assert.deepEqual(await listed("B", "?kind=music"), []);
});

test("renaming a project asset updates its URL while preserving saved video folder references", async () => {
  for (const kind of ["media", "music"]) {
    reset(); const projectId = kind === "music" ? projectMusic : projectA;
    objects.set(`media-projects/${projectId}/.project.json`, JSON.stringify({ id: projectId, ownerId: "A", kind }));
    const source = `media-projects/${projectId}/${kind}/${kind === "music" ? "track.mp3" : "clip.png"}`; objects.set(source, "asset");
    const url = `https://media.example.test/${source}`;
    referencedVideo = { sourceUrl: kind === "media" ? url : "other-source", musicUrl: kind === "music" ? url : "other-music", sourceFolderId: kind === "media" ? projectId : projectB, musicFolderId: kind === "music" ? projectId : projectB };
    const response = await request("PATCH", "A", { key: source, name: kind === "music" ? "renamed.mp3" : "renamed.png", kind }); assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(kind === "music" ? referencedVideo.musicUrl : referencedVideo.sourceUrl, result.url);
    assert.equal(kind === "music" ? referencedVideo.musicFolderId : referencedVideo.sourceFolderId, projectId, "ordinary renames must preserve the existing project folder");
    assert.equal(result.projectId, projectId);
    const moved = await request("PATCH", "A", { key: result.key, projectId: "unfiled", kind }); assert.equal(moved.status, 200);
    const movedResult = await moved.json();
    assert.equal(kind === "music" ? referencedVideo.musicUrl : referencedVideo.sourceUrl, movedResult.url);
    assert.equal(kind === "music" ? referencedVideo.musicFolderId : referencedVideo.sourceFolderId, null, "an explicit move to Unfiled clears the folder reference");
    assert.equal(kind === "music" ? referencedVideo.sourceFolderId : referencedVideo.musicFolderId, projectB, "unrelated references remain intact");
  }
});

test("legacy root files are hidden and immutable until an explicit owner is configured", async () => {
  reset(); objects.set("media/legacy.png", "image"); objects.set("music/legacy.mp3", "audio");
  for (const owner of ["A", "B"]) for (const kind of ["media", "music"]) {
    assert.deepEqual(await listed(owner, `?kind=${kind}`), []);
    const key = kind === "media" ? "media/legacy.png" : "music/legacy.mp3";
    for (const method of ["DELETE", "PATCH"] as const) assert.equal((await request(method, owner, { key, name: "rename.png" })).status, 404);
  }
  assert.deepEqual(mutations, []);
});

test("explicit legacy owner can recover files while other accounts remain denied", async () => {
  reset(); process.env.RELAY_LEGACY_MEDIA_OWNER_ID = "A";
  for (const [kind, key, name] of [["media", "media/legacy.png", "renamed.png"], ["music", "music/legacy.mp3", "renamed.mp3"]]) {
    objects.set(key, "legacy"); assert.deepEqual(await listed("A", `?project=unfiled&kind=${kind}`), [key]); assert.deepEqual(await listed("B", `?kind=${kind}`), []);
    mutations.length = 0; assert.equal((await request("DELETE", "B", { key })).status, 404); assert.deepEqual(mutations, []);
    const response = await request("PATCH", "A", { key, name }); assert.equal(response.status, 200); const next = (await response.json()).key;
    assert.equal(next, ownedKey("A", kind, name)); assert.equal(objects.has(key), false); assert.ok(objects.has(next));
  }
});

test("batch rotation selects only the owner's new unfiled music for unfiled and all", async () => {
  for (const musicFolderId of ["unfiled", "all"]) {
    reset(); objects.set(ownedKey("A", "music", "a.mp3"), "audio"); objects.set(ownedKey("B", "music", "b.mp3"), "audio"); objects.set("music/ambiguous.mp3", "legacy");
    const response = await batch.POST(new Request("https://relay.test/api/v1/videos/batch", { method: "POST", headers: { authorization: "A" }, body: JSON.stringify({ projectId: "video", hooks: ["Hook"], musicMode: "rotate", musicFolderId }) }));
    assert.equal(response.status, 201); assert.deepEqual(renderedMusic, ["https://media.example.test/media-owners/A/music/a.mp3"]);
  }
});

test("batch rotation excludes ambiguous legacy music and honors the configured legacy owner", async () => {
  for (const musicFolderId of ["unfiled", "all"]) {
    reset(); objects.set("music/legacy.mp3", "audio");
    const run = (owner: string) => batch.POST(new Request("https://relay.test/api/v1/videos/batch", { method: "POST", headers: { authorization: owner }, body: JSON.stringify({ projectId: "video", hooks: ["Hook"], musicMode: "rotate", musicFolderId }) }));
    assert.equal((await run("A")).status, 400); assert.deepEqual(mutations, []); assert.deepEqual(renderedMusic, []);
    process.env.RELAY_LEGACY_MEDIA_OWNER_ID = "A"; assert.equal((await run("B")).status, 400);
    assert.equal((await run("A")).status, 201); assert.deepEqual(renderedMusic, ["https://media.example.test/music/legacy.mp3"]);
  }
});
