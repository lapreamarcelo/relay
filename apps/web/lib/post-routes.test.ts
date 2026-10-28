import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import type { ProviderId, ProviderPostSettings } from "@relay/core";

// Exercise the production handlers and shared validation. Authentication and SQL
// are local adapters; no database, worker or provider can be contacted.
type Post = { id: string; status: string; text: string; mediaType: string; mediaUrl: string | null; mediaUrls: string[]; scheduledAt: string | null };
type Target = { id: string; post_id: string; accountId: string; social_account_id: string; provider: ProviderId; settings: ProviderPostSettings; text_override: string | null; status: string; publishAfter: string; publish_lease_owner: string | null };
let post: Post;
let extraPosts: Post[] = [];
let targets: Target[];
let mutations = 0;
let queries = 0;
let inTransaction = false;
let onTransactionBegin: (() => void) | undefined;
const accounts = new Map([
  ["facebook", { id: "facebook", provider: "facebook", display_name: "Page", username: "page" }],
  ["instagram", { id: "instagram", provider: "instagram", display_name: "Profile", username: "profile" }],
  ["youtube", { id: "youtube", provider: "youtube", display_name: "Channel", username: "channel" }],
]);
const query = async (strings: TemplateStringsArray, ...values: unknown[]) => {
  queries++;
  const statement = strings.join("").replace(/\s+/g, " ").trim();
  if (statement.startsWith("SELECT") && statement.includes('FROM "social_account"')) return values[1] === "owner" ? [accounts.get(String(values[0]))].filter(Boolean) : [];
  if (statement.startsWith("SELECT") && /FROM "?post_target"?/.test(statement)) {
    if (statement.includes("settings") || statement.includes("publish_lease_owner")) { assert.ok(inTransaction); assert.match(statement, /FOR UPDATE/); }
    const ids = Array.isArray(values[0]) ? values[0] : [values[0]];
    return targets.filter((target) => ids.includes(target.post_id));
  }
  if (statement.startsWith("SELECT") && statement.includes('FROM "post"')) {
    if (statement.includes("media_type")) { assert.ok(inTransaction); assert.match(statement, /FOR UPDATE/); }
    const ids = Array.isArray(values[0]) ? values[0] : [values[0]];
    return values[1] === "owner" ? [post, ...extraPosts].filter((item) => ids.includes(item.id)).map((item) => ({ ...item, media_type: item.mediaType, media_url: item.mediaUrl, media_urls: item.mediaUrls })) : [];
  }
  if (statement.startsWith('INSERT INTO "post"')) {
    mutations++;
    post = { id: String(values[0]), text: String(values[5]), mediaType: String(values[6]), mediaUrl: values[7] as string | null, mediaUrls: JSON.parse(String(values[8])), status: String(values[9]), scheduledAt: values[10] as string | null };
    targets = [];
    return [{ id: post.id }];
  }
  if (statement.startsWith('UPDATE "post"')) {
    mutations++;
    if (statement.includes("creative_origin")) {
      post = { ...post, text: String(values[4]), mediaType: String(values[5]), mediaUrl: values[6] as string | null, mediaUrls: JSON.parse(String(values[7])), status: String(values[8]), scheduledAt: values[9] as string | null };
    } else if (statement.includes("status = 'scheduled'")) {
      const item = [post, ...extraPosts].find((item) => item.id === values[1]);
      assert.ok(item); item.status = "scheduled"; item.scheduledAt = String(values[0]);
    } else {
      post = { ...post, status: String(values[0]), scheduledAt: values[1] as string | null };
    }
    return [{ id: post.id }];
  }
  if (statement.startsWith('DELETE FROM "post_target"')) { mutations++; targets = []; return []; }
  if (statement.startsWith('INSERT INTO "post_target"')) {
    mutations++;
    targets.push({ id: String(values[0]), post_id: String(values[1]), accountId: String(values[2]), social_account_id: String(values[2]), provider: values[3] as ProviderId, settings: JSON.parse(String(values[7])), text_override: values[8] as string | null, status: String(values[6]), publishAfter: String(values[9]), publish_lease_owner: null });
    return [];
  }
  if (statement.startsWith('UPDATE "post_target"')) {
    mutations++;
    targets = statement.includes("status = 'scheduled'")
      ? targets.map((target) => target.post_id === values[1] ? { ...target, status: "scheduled", publishAfter: String(values[0]) } : target)
      : targets.map((target) => ({ ...target, status: String(values[0]), publishAfter: String(values[1]) }));
    return [];
  }
  throw new Error(`Unexpected SQL: ${statement}`);
};
const sql = Object.assign(query, { begin: async (callback: (transaction: typeof query) => unknown) => {
  onTransactionBegin?.(); inTransaction = true;
  try { return await callback(query); } finally { inTransaction = false; }
} });
Object.assign(globalThis, { __relayPostRoutesAdapter: { sql, listPostsForOwner: async () => [{ ...post, targets }] } });
registerHooks({ resolve(specifier, context, nextResolve) {
  let code: string | undefined;
  if (specifier === "@relay/database") code = "export const sql=globalThis.__relayPostRoutesAdapter.sql";
  else if (specifier.endsWith("/api-session")) code = `export async function requireApiSession(request, options){const token=request.headers.get('authorization');if(!token)return{response:Response.json({error:'Unauthorized'},{status:401})};if(token!=='Bearer write'||options.apiKeyScope!=='posts:write')return{response:Response.json({error:'Missing write scope'},{status:403})};return{session:{user:{id:'owner'}}}}`;
  else if (specifier.endsWith("/creative-origin")) code = "export async function creativeOrigin(){return null}";
  else if (specifier.endsWith("/post-repository")) code = "export const listPostsForOwner=globalThis.__relayPostRoutesAdapter.listPostsForOwner";
  if (code) return { url: `data:text/javascript,${encodeURIComponent(code)}`, shortCircuit: true };
  try { return nextResolve(specifier, context); }
  catch (error) { if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) return nextResolve(`${specifier}.ts`, context); throw error; }
} });
const { PATCH, POST } = await import("../app/api/v1/posts/route.ts");
const future = () => new Date(Date.now() + 86_400_000).toISOString();
function reset(status = "draft") {
  post = { id: "post", status, text: "Original", mediaType: "none", mediaUrl: null, mediaUrls: [], scheduledAt: status === "scheduled" ? future() : null };
  targets = [{ id: "target", post_id: post.id, accountId: "facebook", social_account_id: "facebook", provider: "facebook", settings: { kind: "facebook", publishType: "feed" }, text_override: null, status, publishAfter: future(), publish_lease_owner: null }];
  extraPosts = []; mutations = 0; queries = 0; onTransactionBegin = undefined;
}
const facebook = () => ({ accountId: "facebook", settings: { kind: "facebook", publishType: "feed" } });
const instagram = () => ({ accountId: "instagram", settings: { kind: "instagram", publishType: "feed" } });
const youtube = () => ({ accountId: "youtube", settings: { kind: "youtube", title: "Launch", tags: [], privacyStatus: "private", madeForKids: false } });
const input = (changes: Record<string, unknown> = {}) => ({ id: "post", text: "Edited", mediaType: "none", status: "draft", targets: [facebook()], ...changes });
const request = (method: "POST" | "PATCH", body: unknown, token = "write") => (method === "POST" ? POST : PATCH)(new Request("https://relay.test/api/v1/posts", { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
async function assertRejected(body: unknown, method: "POST" | "PATCH" = "PATCH") {
  const original = structuredClone({ post, extraPosts, targets });
  const response = await request(method, body);
  assert.equal(response.status, 400, JSON.stringify(body));
  assert.equal(mutations, 0, "validation must precede post/target mutations");
  assert.deepEqual({ post, extraPosts, targets }, original);
}

test("single-post rescheduling rejects past dates without changing the post or destinations", async () => {
  for (const status of ["draft", "scheduled"]) {
    reset(status);
    await assertRejected({ id: "post", scheduledAt: new Date(Date.now() - 86_400_000).toISOString() });
  }
});

test("editing rejects an empty destination list for drafts, schedules and publish now", async () => {
  for (const status of ["draft", "scheduled", "publishing"]) {
    reset();
    await assertRejected(input({ targets: [], status, scheduledAt: future() }));
  }
});

test("editing rejects duplicate accounts instead of creating duplicate deliveries", async () => {
  for (const status of ["draft", "scheduled", "publishing"]) {
    reset();
    await assertRejected(input({ targets: [facebook(), { ...facebook(), accountId: " facebook " }], status, scheduledAt: future() }));
  }
});

test("Instagram feed posts require media when created or edited for scheduling or publish now", async () => {
  for (const method of ["POST", "PATCH"] as const) {
    for (const status of ["scheduled", "publishing"]) {
      reset();
      await assertRejected(input({ targets: [instagram()], status, scheduledAt: future() }), method);
    }
  }
});

test("incomplete Instagram drafts remain editable and publishable media succeeds", async () => {
  for (const method of ["POST", "PATCH"] as const) {
    reset();
    assert.equal((await request(method, input({ targets: [instagram()] }))).status, method === "POST" ? 201 : 200);
    assert.equal(post.status, "draft"); assert.equal(targets.length, 1);
    reset();
    assert.equal((await request(method, input({ targets: [instagram()], status: "publishing", mediaType: "image", mediaUrl: "https://media.example.test/photo.jpg" }))).status, method === "POST" ? 201 : 200);
    assert.equal(post.status, "publishing"); assert.equal(targets[0].status, "publishing");
  }
});

test("valid destination edits, future rescheduling and publish now keep one delivery", async () => {
  reset();
  assert.equal((await request("PATCH", input())).status, 200);
  assert.equal(post.text, "Edited"); assert.equal(targets.length, 1); assert.equal(targets[0].accountId, "facebook");
  const scheduledAt = future();
  assert.equal((await request("PATCH", { id: post.id, scheduledAt })).status, 200);
  assert.equal(post.status, "scheduled"); assert.equal(post.scheduledAt, scheduledAt);
  assert.equal(targets[0].publishAfter, scheduledAt);
  assert.equal((await request("PATCH", { id: post.id, scheduledAt: null })).status, 200);
  assert.equal(post.status, "publishing"); assert.equal(post.scheduledAt, null);
  assert.equal(targets[0].status, "publishing"); assert.equal(targets.length, 1);
});

test("post writes require authentication and write scope before reading SQL", async () => {
  reset();
  for (const method of ["POST", "PATCH"] as const) {
    assert.equal((await request(method, input(), "")).status, 401);
    assert.equal((await request(method, input(), "read-only")).status, 403);
  }
  assert.equal(queries, 0); assert.equal(mutations, 0);
});

for (const platform of ["instagram", "youtube", "no destinations"] as const) {
  for (const promotion of ["single schedule", "publish now", "bulk schedule"] as const) {
    test(`${promotion} rejects a saved ${platform} draft that cannot publish`, async () => {
      reset();
      if (platform === "no destinations") targets = [];
      else {
        const destination = platform === "instagram" ? instagram() : youtube();
        assert.equal((await request("PATCH", input({ targets: [destination] }))).status, 200, "incomplete drafts can still be saved");
      }
      mutations = 0;
      await assertRejected(promotion === "bulk schedule" ? { updates: [{ id: post.id, scheduledAt: future() }] } : { id: post.id, scheduledAt: promotion === "publish now" ? null : future() });
    });
  }
}

test("bulk validation is atomic when a valid post precedes an incomplete draft", async () => {
  reset();
  extraPosts = [{ ...post, id: "incomplete" }];
  targets.push({ ...targets[0], id: "incomplete-target", post_id: "incomplete", provider: "instagram", settings: { kind: "instagram", publishType: "feed" } });
  await assertRejected({ updates: [{ id: post.id, scheduledAt: future() }, { id: "incomplete", scheduledAt: future() }] });
});

test("single promotion validates current content under the transaction lock", async () => {
  reset();
  onTransactionBegin = () => { post.text = " "; };
  const response = await request("PATCH", { id: post.id, scheduledAt: null });
  assert.equal(response.status, 400); assert.equal(mutations, 0);
  assert.equal(post.status, "draft"); assert.equal(targets[0].status, "draft");
});

test("valid media drafts promote through single and bulk schedules and publish now", async () => {
  for (const destination of [instagram(), youtube()]) {
    for (const promotion of ["single schedule", "publish now", "bulk schedule"]) {
      reset();
      assert.equal((await request("PATCH", input({ targets: [destination], mediaType: "video", mediaUrl: "https://media.example.test/video.mp4" }))).status, 200);
      const scheduledAt = future();
      const response = await request("PATCH", promotion === "bulk schedule" ? { updates: [{ id: post.id, scheduledAt }] } : { id: post.id, scheduledAt: promotion === "publish now" ? null : scheduledAt });
      assert.equal(response.status, 200);
      assert.equal(post.status, promotion === "publish now" ? "publishing" : "scheduled");
      assert.equal(targets[0].status, post.status);
      assert.equal(post.scheduledAt, promotion === "publish now" ? null : scheduledAt);
    }
  }
});

test("promotion preserves missing-post, publishing-status and worker-lease guards", async () => {
  reset();
  assert.equal((await request("PATCH", { id: "missing", scheduledAt: null })).status, 404);
  assert.equal(mutations, 0);
  for (const bulk of [false, true]) {
    reset("publishing");
    let body = bulk ? { updates: [{ id: post.id, scheduledAt: future() }] } : { id: post.id, scheduledAt: null };
    assert.equal((await request("PATCH", body)).status, 409); assert.equal(mutations, 0);
    reset();
    onTransactionBegin = () => { targets[0].publish_lease_owner = "worker"; };
    body = bulk ? { updates: [{ id: post.id, scheduledAt: future() }] } : { id: post.id, scheduledAt: null };
    assert.equal((await request("PATCH", body)).status, 409); assert.equal(mutations, 0);
  }
});

for (const targetStatus of ["publishing", "processing", "published", "failed"]) {
  test(`editing rejects a ${targetStatus} destination even while the parent is editable`, async () => {
    for (const parentStatus of ["draft", "scheduled"]) {
      reset(parentStatus);
      targets[0].status = targetStatus;
      const original = structuredClone({ post, targets });
      const response = await request("PATCH", input({ status: "scheduled", scheduledAt: future(), targets: [instagram()], mediaType: "image", mediaUrl: "https://media.example.test/photo.jpg" }));
      assert.equal(response.status, 409);
      assert.equal(mutations, 0, "claimed or completed deliveries must not be replaced");
      assert.deepEqual({ post, targets }, original);
    }
  });
}

test("editing rejects a worker lease acquired before the destination lock", async () => {
  reset("scheduled");
  onTransactionBegin = () => { targets[0].publish_lease_owner = "worker"; };
  const originalPost = structuredClone(post);
  const response = await request("PATCH", input({ targets: [instagram()], mediaType: "image", mediaUrl: "https://media.example.test/photo.jpg" }));
  assert.equal(response.status, 409);
  assert.equal(mutations, 0);
  assert.deepEqual(post, originalPost);
  assert.equal(targets.length, 1); assert.equal(targets[0].id, "target");
  assert.equal(targets[0].accountId, "facebook"); assert.equal(targets[0].publish_lease_owner, "worker");
});

test("YouTube image plans retain ordered originals and per-target timing on create, edit and promotion", async () => {
  const previous = process.env.R2_PUBLIC_URL;
  process.env.R2_PUBLIC_URL = "https://media.example.test";
  try {
    for (const method of ["POST", "PATCH"] as const) {
      for (const count of [1, 3]) {
        reset();
        const urls = Array.from({ length: count }, (_, index) => `https://media.example.test/${index}.jpg`);
        const imageSeconds = count === 1 ? 10 : 5;
        const destination = youtube();
        const response = await request(method, input({ mediaType: "image", mediaUrl: urls[0], mediaUrls: urls, status: "scheduled", scheduledAt: future(), targets: [facebook(), { ...destination, settings: { ...destination.settings, imageSeconds } }] }));
        assert.equal(response.status, method === "POST" ? 201 : 200, await response.text());
        assert.equal(post.mediaType, "image"); assert.deepEqual(post.mediaUrls, urls);
        assert.equal(targets.find((target) => target.provider === "youtube")?.settings.kind, "youtube");
        const settings = targets.find((target) => target.provider === "youtube")!.settings;
        assert.ok(settings.kind === "youtube"); assert.equal(settings.imageSeconds, imageSeconds);
        assert.equal((await request("PATCH", { id: post.id, scheduledAt: null })).status, 200);
      }
    }
  } finally { if (previous === undefined) delete process.env.R2_PUBLIC_URL; else process.env.R2_PUBLIC_URL = previous; }
});

test("YouTube image publishing rejects invalid timing and external sources before mutation", async () => {
  const previous = process.env.R2_PUBLIC_URL;
  process.env.R2_PUBLIC_URL = "https://media.example.test";
  try {
    for (const method of ["POST", "PATCH"] as const) {
      for (const changes of [
        { imageSeconds: "8" }, { imageSeconds: null }, { imageSeconds: 3 }, { imageSeconds: 11 }, { imageSeconds: 8.5 },
      ]) {
        reset(); const destination = youtube();
        await assertRejected(input({ mediaType: "image", mediaUrl: "https://media.example.test/first.jpg", status: "publishing", targets: [{ ...destination, settings: { ...destination.settings, ...changes } }] }), method);
      }
      for (const mediaUrls of [["https://external.example/first.jpg"], ["https://media.example.test/first.jpg", "https://external.example/second.jpg"], ["https://media.example.test/first.jpg", null]]) {
        reset();
        await assertRejected(input({ mediaType: "image", mediaUrl: mediaUrls[0], mediaUrls, status: "publishing", targets: [youtube()] }), method);
      }
      reset(); const destination = youtube();
      await assertRejected(input({ mediaType: "image", mediaUrl: "https://media.example.test/first.jpg", mediaUrls: ["https://media.example.test/first.jpg", "https://media.example.test/second.jpg"], status: "publishing", targets: [{ ...destination, settings: { ...destination.settings, imageSeconds: 8 } }] }), method);
    }
    reset();
    assert.equal((await request("PATCH", input({ mediaType: "image", mediaUrl: "https://external.example/first.jpg", targets: [youtube()] }))).status, 200, "draft can be saved before sources are ready");
    mutations = 0;
    await assertRejected({ id: post.id, scheduledAt: null });
  } finally { if (previous === undefined) delete process.env.R2_PUBLIC_URL; else process.env.R2_PUBLIC_URL = previous; }
});
