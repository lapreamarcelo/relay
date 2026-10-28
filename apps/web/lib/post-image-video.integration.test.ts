import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import type { ProviderPublishInput } from "@relay/providers/publish";

test("YouTube image publishing queues renders, isolates destinations, and recovers safely", { skip: !process.env.RELAY_PUBLISHING_TEST_DATABASE_URL }, async t => {
  const databaseUrl = process.env.RELAY_PUBLISHING_TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname));
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_POOL_SIZE = "1";
  const { sql } = await import("@relay/database");
  const { PostPublishingService } = await import("../../worker/src/post-publishing.ts");
  const { ProviderPublishRegistry, ProviderPublishError } = await import("@relay/providers/publish");
  const { runNextPostImageVideoJob } = await import("./post-image-video-jobs.ts");
  const schemaName = `image_video_test_${randomUUID().replaceAll("-", "")}`;
  const directory = new URL("../../../packages/database/drizzle/", import.meta.url);
  const urls = ["https://media.example/second.png", "https://media.example/first.png"];
  const artifactUrl = "https://media.example/converted.mp4";
  const calls: ProviderPublishInput[] = [];
  let transient = false;
  class TestRegistry extends ProviderPublishRegistry {
    override async publish(input: ProviderPublishInput) {
      calls.push(input);
      if (transient) { transient = false; throw new ProviderPublishError("Try later", true); }
      return { state: "published" as const, providerPostId: "youtube-post" };
    }
  }
  let tokens = 0;
  const service = new PostPublishingService({ getValidAccessToken: async () => { tokens++; return "token"; }, markAuthorizationRejected: async () => {} }, new TestRegistry());
  const target = async () => (await sql`SELECT * FROM post_target WHERE id = 'target'`)[0];
  const job = async () => (await sql`SELECT * FROM post_image_video_job WHERE target_id = 'target'`)[0];
  const due = async () => { await sql`UPDATE post_target SET publish_after = NOW() - INTERVAL '1 second' WHERE id = 'target'`; };
  const reset = async () => {
    calls.length = 0; tokens = 0; transient = false;
    await sql`DELETE FROM post`;
    await sql`INSERT INTO post (id, owner_id, text, media_type, media_url, media_urls, status, scheduled_at)
      VALUES ('post', 'owner', 'Image post', 'image', ${urls[0]}, ${JSON.stringify(urls)}::jsonb, 'scheduled', NOW() - INTERVAL '1 minute')`;
    await sql`INSERT INTO post_target (id, post_id, social_account_id, provider, account_display_name, account_handle, status, settings, publish_after)
      VALUES ('target', 'post', 'account', 'youtube', 'Test', '@test', 'scheduled', '{"kind":"youtube","visibility":"public","imageSeconds":3}'::jsonb, NOW() - INTERVAL '1 minute')`;
  };
  const render = async () => runNextPostImageVideoJob(new AbortController().signal, async input => {
    assert.deepEqual(input.timeline.clips.map(clip => clip.sourceUrl), urls);
    assert.equal(input.timeline.clips[0].outMs, 3000);
    await input.onProgress(75);
    return { url: artifactUrl };
  });
  try {
    await sql.unsafe(`CREATE SCHEMA ${schemaName}`);
    await sql.unsafe(`SET search_path TO ${schemaName}`);
    for (const file of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) await sql.unsafe(await readFile(new URL(file, directory), "utf8"));
    await sql`INSERT INTO "user" (id, name, email) VALUES ('owner', 'Test', 'image-video@example.test')`;
    await sql`INSERT INTO social_account (id, owner_id, provider, auth_method, provider_account_id, username, display_name, access_token_encrypted)
      VALUES ('account', 'owner', 'youtube', 'youtube', 'channel', 'test', 'Test', 'encrypted')`;

    await t.test("pending rendering does not consume attempts or obtain provider tokens", async () => {
      await reset();
      assert.equal((await service.sweep(1)).deferred, 1);
      assert.equal((await target()).publish_attempts, 0);
      assert.equal((await job()).status, "queued");
      assert.deepEqual((await job()).source_urls, urls);
      assert.equal(calls.length, 0); assert.equal(tokens, 0);
      await due();
      assert.equal((await service.sweep(1)).deferred, 1);
      assert.equal((await sql`SELECT id FROM post_image_video_job`).length, 1);
      assert.equal((await target()).publish_attempts, 0);
    });

    await t.test("legacy single image URLs use the eight second default", async () => {
      await reset();
      await sql`UPDATE post SET media_urls = '[]'::jsonb WHERE id = 'post'`;
      await sql`UPDATE post_target SET settings = '{"kind":"youtube"}'::jsonb WHERE id = 'target'`;
      assert.equal((await service.sweep(1)).deferred, 1);
      assert.deepEqual((await job()).source_urls, [urls[0]]);
      assert.equal((await job()).image_seconds, 8);
    });

    await t.test("completion uses only the derived MP4 and reuses it across provider retries", async () => {
      await reset(); await service.sweep(1);
      assert.equal(await render(), true);
      assert.equal((await job()).progress, 100);
      transient = true; await due();
      assert.equal((await service.sweep(1)).deferred, 1);
      assert.equal((await target()).publish_attempts, 1);
      await due();
      assert.equal((await service.sweep(1)).published, 1);
      assert.equal((await job()).attempts, 1);
      assert.equal(await render(), false);
      assert.ok(calls.every(call => call.mediaType === "video" && call.mediaUrl === artifactUrl));
      assert.deepEqual(calls.map(call => call.mediaUrls), [[artifactUrl], [artifactUrl]]);
      assert.deepEqual((await sql`SELECT media_urls FROM post WHERE id = 'post'`)[0].media_urls, urls);
    });

    await t.test("explicit provider retries retain an already completed video", async () => {
      await reset(); await service.sweep(1); await render();
      const renderedJob = await job();
      await sql`UPDATE post_target SET status = 'scheduled', publish_attempts = 0, publish_after = NOW() WHERE id = 'target'`;
      assert.equal((await service.sweep(1)).published, 1);
      assert.equal((await job()).id, renderedJob.id); assert.equal((await job()).attempts, 1);
      assert.equal(calls[0].mediaUrl, artifactUrl);
    });

    await t.test("other destinations receive original images while YouTube waits", async () => {
      await reset();
      await sql`INSERT INTO post_target (id, post_id, social_account_id, provider, account_display_name, account_handle, status, settings, publish_after)
        VALUES ('facebook', 'post', 'account', 'facebook', 'Test', '@test', 'scheduled', '{"kind":"facebook"}'::jsonb, NOW() - INTERVAL '2 minutes')`;
      const result = await service.sweep(2);
      assert.equal(result.published, 1); assert.equal(result.deferred, 1);
      assert.equal(calls[0].provider, "facebook"); assert.equal(calls[0].mediaType, "image");
      assert.deepEqual(calls[0].mediaUrls, urls);
      assert.equal((await sql`SELECT id FROM post_image_video_job`).length, 1);
    });

    await t.test("renderer errors fail clearly and explicit post retry starts a fresh bounded render", async () => {
      await reset(); await service.sweep(1);
      await runNextPostImageVideoJob(new AbortController().signal, async () => { throw new Error("Image download failed"); });
      await due(); assert.equal((await service.sweep(1)).failed, 1);
      assert.match((await target()).error, /Image download failed/);
      assert.equal((await target()).publish_attempts, 1); assert.equal(calls.length, 0);
      await sql`UPDATE post_target SET status = 'scheduled', publish_attempts = 0, publish_after = NOW() WHERE id = 'target'`;
      assert.equal((await service.sweep(1)).deferred, 1);
      assert.equal((await job()).status, "queued"); assert.equal((await job()).attempts, 0);
      await render(); await due(); assert.equal((await service.sweep(1)).published, 1);
    });

    await t.test("stalled and cancelled conversions fail without uploading original images", async () => {
      for (const state of ["stalled", "cancelled"]) {
        await reset(); await service.sweep(1);
        if (state === "stalled") await sql`UPDATE post_image_video_job SET created_at = NOW() - INTERVAL '2 hours'`;
        else await sql`UPDATE post_image_video_job SET status = 'cancelled'`;
        await due(); assert.equal((await service.sweep(1)).failed, 1);
        assert.match((await target()).error, state === "stalled" ? /one hour/ : /cancelled/);
        assert.equal(calls.length, 0);
      }
    });

    await t.test("malformed completion fails clearly and can render again on explicit retry", async () => {
      await reset(); await service.sweep(1);
      await sql`UPDATE post_image_video_job SET status = 'completed', rendered_url = NULL`;
      await due(); assert.equal((await service.sweep(1)).failed, 1);
      assert.equal((await job()).status, "failed");
      assert.match((await target()).error, /did not return a video/);
      await sql`UPDATE post_target SET status = 'scheduled', publish_attempts = 0, publish_after = NOW() WHERE id = 'target'`;
      assert.equal((await service.sweep(1)).deferred, 1);
      assert.equal(await render(), true);
      await due(); assert.equal((await service.sweep(1)).published, 1);
    });

    await t.test("shutdown interrupts rendering and leaves a recoverable job", async () => {
      await reset(); await service.sweep(1);
      const shutdown = new AbortController();
      await runNextPostImageVideoJob(shutdown.signal, async input => {
        shutdown.abort(); input.signal.throwIfAborted(); return { url: artifactUrl };
      });
      assert.equal((await job()).status, "queued"); assert.equal((await job()).lease_token, null);
      assert.equal(await render(), true);
      await due(); assert.equal((await service.sweep(1)).published, 1);
    });

    await t.test("snapshot edits invalidate old artifacts and old lease tokens cannot finish them", async () => {
      await reset(); await service.sweep(1); await render();
      await sql`UPDATE post_target SET settings = '{"kind":"youtube","imageSeconds":5}'::jsonb WHERE id = 'target'`;
      await due(); assert.equal((await service.sweep(1)).deferred, 1);
      assert.equal((await job()).rendered_url, null); assert.equal((await job()).image_seconds, 5);
      await runNextPostImageVideoJob(new AbortController().signal, async () => {
        await sql`UPDATE post_image_video_job SET lease_token = 'replacement', lease_until = NOW() + INTERVAL '1 minute'`;
        return { url: "https://media.example/stale.mp4" };
      });
      assert.equal((await job()).status, "running"); assert.equal((await job()).rendered_url, null);
    });

    await t.test("expired worker leases recover up to three attempts and deleted targets cascade", async () => {
      await reset(); await service.sweep(1);
      await sql`UPDATE post_image_video_job SET status = 'running', attempts = 2, lease_until = NOW() - INTERVAL '1 minute', lease_token = 'lost'`;
      assert.equal(await render(), true); assert.equal((await job()).attempts, 3);
      await sql`UPDATE post_image_video_job SET status = 'running', lease_until = NOW() - INTERVAL '1 minute'`;
      assert.equal(await render(), false); assert.equal((await job()).status, "failed");
      await sql`DELETE FROM post_target WHERE id = 'target'`;
      assert.equal((await sql`SELECT id FROM post_image_video_job`).length, 0);
    });

    await t.test("posts removed from publication cancel queued rendering", async () => {
      await reset(); await service.sweep(1);
      await sql`UPDATE post_target SET status = 'draft' WHERE id = 'target'`;
      assert.equal(await render(), false); assert.equal((await job()).status, "cancelled");
    });
  } finally {
    await sql.unsafe(`DROP SCHEMA ${schemaName} CASCADE`);
    await sql.end();
  }
});
