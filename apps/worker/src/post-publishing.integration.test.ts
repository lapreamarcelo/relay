import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

// Run with RELAY_PUBLISHING_TEST_DATABASE_URL pointing to a disposable local
// PostgreSQL instance, using `node --import tsx --test` for workspace imports.
// All tables live in a unique schema; the normal worker unit suite skips this.
test("processing deadlines and recovery use provider sessions, not post age", { skip: !process.env.RELAY_PUBLISHING_TEST_DATABASE_URL }, async (t) => {
  const databaseUrl = process.env.RELAY_PUBLISHING_TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname), "Integration tests require a local database");
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_POOL_SIZE = "1";
  const { sql } = await import("@relay/database");
  const { PostPublishingService } = await import("./post-publishing.ts");
  const { ProviderPublishRegistry } = await import("@relay/providers/publish");
  const schemaName = `publishing_test_${randomUUID().replaceAll("-", "")}`;
  const directory = new URL("../../../packages/database/drizzle/", import.meta.url);
  const timeoutMigration = await readFile(new URL("0023_processing_timeout.sql", directory), "utf8");
  const timeoutMessage = "The provider did not finish processing this post within 24 hours.";
  const calls: string[] = [];
  let providerState = "PROCESSING_UPLOAD";
  const providers = new ProviderPublishRegistry(async (url, init) => {
    const path = String(url);
    calls.push(path);
    if (path.endsWith("status/fetch/")) return Response.json({ data: { status: providerState }, error: { code: "ok" } });
    if (path.endsWith("inbox/video/init/")) return Response.json({ data: { publish_id: "existing-session", upload_url: "https://upload.example/video" }, error: { code: "ok" } });
    if (path === "https://media.example/video.mp4") return new Response(init?.method === "HEAD" ? null : new Uint8Array(10000), { status: init?.method === "HEAD" ? 200 : 206, headers: { "content-length": "10000", "content-type": "video/mp4" } });
    if (path === "https://upload.example/video") return new Response(null, { status: 201 });
    throw new Error(`Unexpected provider request: ${path}`);
  });
  const service = new PostPublishingService({ getValidAccessToken: async () => "test-token", markAuthorizationRejected: async () => {} }, providers);
  const target = async () => (await sql<{ status: string; processing_started_at: Date | string | null; provider_post_id: string | null; error: string | null }[]>`SELECT status, processing_started_at, provider_post_id, error FROM post_target WHERE id = 'target'`)[0];
  const due = async () => { await sql`UPDATE post_target SET publish_after = NOW() - INTERVAL '1 second' WHERE id = 'target'`; };
  const reset = async (status = "scheduled") => {
    calls.length = 0;
    providerState = "PROCESSING_UPLOAD";
    await sql`DELETE FROM notification`;
    await sql`DELETE FROM post_target`;
    await sql`DELETE FROM post`;
    await sql`INSERT INTO post (id, owner_id, text, media_type, media_url, status, scheduled_at, created_at)
      VALUES ('post', 'owner', 'Scheduled days ahead', 'video', 'https://media.example/video.mp4', ${status}, NOW() - INTERVAL '1 minute', NOW() - INTERVAL '10 days')`;
    await sql`INSERT INTO post_target (id, post_id, social_account_id, provider, account_display_name, account_handle, status, settings, publish_after, created_at)
      VALUES ('target', 'post', 'account', 'tiktok', 'Test', '@test', ${status}, '{"kind":"tiktok","privacyLevel":"SELF_ONLY","allowComments":true,"allowDuet":false,"allowStitch":false}'::jsonb, NOW() - INTERVAL '1 minute', NOW() - INTERVAL '10 days')`;
  };
  try {
    await sql.unsafe(`CREATE SCHEMA ${schemaName}`);
    await sql.unsafe(`SET search_path TO ${schemaName}`);
    for (const file of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) await sql.unsafe(await readFile(new URL(file, directory), "utf8"));
    await sql`INSERT INTO "user" (id, name, email) VALUES ('owner', 'Test', 'publishing@example.test')`;
    await sql`INSERT INTO social_account (id, owner_id, provider, auth_method, provider_account_id, username, display_name, access_token_encrypted)
      VALUES ('account', 'owner', 'tiktok', 'tiktok', 'test-creator', 'test', 'Test', 'test-encrypted-token')`;

    await t.test("an old scheduled post gets a fresh, stable processing deadline", async () => {
      await reset();
      assert.equal((await service.sweep(1)).processing, 1, JSON.stringify(await target()));
      const startedAt = (await target()).processing_started_at!;
      assert.ok(Date.now() - new Date(startedAt).getTime() < 5000);
      await due();
      assert.equal((await service.sweep(1)).processing, 1);
      assert.equal(new Date((await target()).processing_started_at!).getTime(), new Date(startedAt).getTime());
      assert.equal(calls.filter(path => path.endsWith("inbox/video/init/")).length, 1);
      providerState = "SEND_TO_USER_INBOX";
      await due();
      assert.equal((await service.sweep(1)).published, 1);
      assert.equal((await target()).status, "published");
    });

    await t.test("delivery is checked before failing an expired processing deadline", async () => {
      await reset("processing");
      await sql`UPDATE post_target SET provider_post_id = 'existing-session', processing_started_at = NOW() - INTERVAL '25 hours'`;
      providerState = "SEND_TO_USER_INBOX";
      assert.equal((await service.sweep(1)).published, 1);
      assert.equal(calls.length, 1);
      assert.ok(calls[0].endsWith("status/fetch/"));
    });

    await t.test("a genuinely stuck upload still fails after 24 processing hours", async () => {
      await reset("processing");
      await sql`UPDATE post_target SET provider_post_id = 'existing-session', processing_started_at = NOW() - INTERVAL '25 hours'`;
      assert.equal((await service.sweep(1)).failed, 1);
      assert.equal((await target()).error, timeoutMessage);
      assert.equal(calls.length, 1);
    });

    await t.test("legacy processing rows initialize a deadline without using creation time", async () => {
      await reset("processing");
      await sql`UPDATE post_target SET provider_post_id = 'existing-session'`;
      assert.equal((await service.sweep(1)).processing, 1);
      assert.ok(Date.now() - new Date((await target()).processing_started_at!).getTime() < 5000);
      assert.equal(calls.length, 1);
    });

    await t.test("migration recovers old timeout sessions once and clears stale errors after delivery", async () => {
      await reset("failed");
      await sql`UPDATE post_target SET provider_post_id = 'existing-session', error = ${timeoutMessage}`;
      await sql`INSERT INTO notification (id, owner_id, event_key, post_id, target_id, provider, kind, title, message)
        VALUES ('old-error', 'owner', 'post:target:failed', 'post', 'target', 'tiktok', 'error', 'Old timeout', ${timeoutMessage})`;
      await sql.unsafe(timeoutMigration);
      assert.equal((await target()).status, "processing");
      assert.equal((await sql`SELECT id FROM notification WHERE kind = 'error'`).length, 0);
      assert.equal((await sql`SELECT status FROM post WHERE id = 'post'`)[0].status, "processing");
      const startedAt = new Date((await target()).processing_started_at!).getTime();
      await sql.unsafe(timeoutMigration);
      assert.equal(new Date((await target()).processing_started_at!).getTime(), startedAt);
      providerState = "SEND_TO_USER_INBOX";
      assert.equal((await service.sweep(1)).published, 1);
      assert.equal(calls.length, 1);
      assert.equal((await sql`SELECT id FROM notification WHERE kind = 'error'`).length, 0);
      assert.equal((await sql`SELECT title FROM notification WHERE kind = 'success'`)[0].title, "Sent to your TikTok inbox");
      await sql`UPDATE post_target SET status = 'failed', error = ${timeoutMessage}`;
      await sql.unsafe(timeoutMigration);
      assert.equal((await target()).status, "failed", "Later genuine timeouts must not be revived on every startup");
    });

    await t.test("recovery replaces the stale timeout notice with an actual provider rejection", async () => {
      await reset("failed");
      await sql`UPDATE post_target SET provider_post_id = 'existing-session', error = ${timeoutMessage}`;
      await sql`INSERT INTO notification (id, owner_id, event_key, post_id, target_id, provider, kind, title, message)
        VALUES ('old-error', 'owner', 'post:target:failed', 'post', 'target', 'tiktok', 'error', 'Old timeout', ${timeoutMessage})`;
      await sql.unsafe(timeoutMigration);
      providerState = "FAILED";
      assert.equal((await service.sweep(1)).failed, 1);
      const errors = await sql`SELECT message FROM notification WHERE kind = 'error'`;
      assert.equal(errors.length, 1);
      assert.equal(errors[0].message, "TikTok rejected the post.");
      assert.equal(calls.length, 1);
    });

    await t.test("migration leaves rejected or unknown uploads alone", async () => {
      await reset("failed");
      await sql`UPDATE post_target SET error = ${timeoutMessage}`;
      await sql.unsafe(timeoutMigration);
      assert.equal((await target()).status, "failed");
      await sql`UPDATE post_target SET provider_post_id = 'existing-session', error = 'TikTok rejected the post: spam_risk.'`;
      await sql.unsafe(timeoutMigration);
      assert.equal((await target()).status, "failed");
    });
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await sql.end();
  }
});
