import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

test("publishing concurrency, refresh recovery, and target analytics regressions", { skip: !process.env.RELAY_PUBLISHING_TEST_DATABASE_URL }, async (t) => {
  const databaseUrl = process.env.RELAY_PUBLISHING_TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname));
  process.env.DATABASE_URL = databaseUrl;
  process.env.DATABASE_POOL_SIZE = "1";
  const { sql } = await import("@relay/database");
  const { PostPublishingService } = await import("./post-publishing.ts");
  const { PostAnalyticsService } = await import("./post-analytics.ts");
  const { TokenLifecycleService } = await import("./token-lifecycle.ts");
  const { PostgresAccountCredentialRepository } = await import("./postgres-account-credential-repository.ts");
  const { AesGcmTokenCipher } = await import("@relay/core/token-encryption");
  const { ProviderRefreshRegistry, ProviderAuthorizationError } = await import("@relay/providers/token-refresh");
  const { ProviderPublishRegistry } = await import("@relay/providers/publish");
  const { ProviderAnalyticsRegistry } = await import("@relay/providers/analytics");
  const schemaName = `worker_regressions_${randomUUID().replaceAll("-", "")}`;
  const directory = new URL("../../../packages/database/drizzle/", import.meta.url);
  const cipher = new AesGcmTokenCipher(randomBytes(32));
  const refreshers = new ProviderRefreshRegistry();
  const lifecycle = new TokenLifecycleService(new PostgresAccountCredentialRepository(), cipher, refreshers);
  let publishCalls = 0;
  let publish = async () => ({ state: "published" as const, providerPostId: "provider-post" });
  class TestPublishRegistry extends ProviderPublishRegistry {
    override async publish() { publishCalls += 1; return publish(); }
  }
  class TestAnalyticsRegistry extends ProviderAnalyticsRegistry {
    override async collect() { return { views: 12, raw: {} }; }
  }
  const providers = new TestPublishRegistry();
  const service = new PostPublishingService(lifecycle, providers);
  const target = async () => (await sql`SELECT * FROM post_target WHERE id = 'target'`)[0];
  const due = async () => { await sql`UPDATE post_target SET publish_after = NOW() - INTERVAL '1 second' WHERE id = 'target'`; };
  const reset = async () => {
    publishCalls = 0;
    publish = async () => ({ state: "published", providerPostId: "provider-post" });
    await sql`DELETE FROM notification`;
    await sql`DELETE FROM post_target`;
    await sql`DELETE FROM post`;
    await sql`UPDATE social_account SET status = 'connected', refresh_after_at = NOW() + INTERVAL '1 hour',
      refresh_lease_owner = NULL, refresh_lease_expires_at = NULL, connection_error = NULL WHERE id = 'account'`;
    await sql`INSERT INTO post (id, owner_id, text, media_type, status, scheduled_at, created_at)
      VALUES ('post', 'owner', 'Old draft, fresh publication', 'none', 'scheduled', NOW() - INTERVAL '1 minute', NOW() - INTERVAL '100 days')`;
    await sql`INSERT INTO post_target (id, post_id, social_account_id, provider, account_display_name, account_handle, status, settings, publish_after, created_at)
      VALUES ('target', 'post', 'account', 'facebook', 'Test', '@test', 'scheduled', '{"kind":"facebook"}'::jsonb, NOW() - INTERVAL '1 minute', NOW() - INTERVAL '100 days')`;
  };
  try {
    await sql.unsafe(`CREATE SCHEMA ${schemaName}`);
    await sql.unsafe(`SET search_path TO ${schemaName}`);
    for (const file of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) await sql.unsafe(await readFile(new URL(file, directory), "utf8"));
    await sql`INSERT INTO "user" (id, name, email) VALUES ('owner', 'Test', 'worker-regressions@example.test')`;
    await sql`INSERT INTO social_account (id, owner_id, provider, auth_method, provider_account_id, username, display_name, access_token_encrypted, refresh_token_encrypted)
      VALUES ('account', 'owner', 'facebook', 'facebook', 'provider-account', 'test', 'Test', ${cipher.encrypt("access-old")}, ${cipher.encrypt("refresh-old")})`;

    await t.test("a slow upload remains owned when a second worker sweeps after the original lease duration", async () => {
      await reset();
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { started = resolve; });
      publish = async () => { started(); if (publishCalls === 1) await gate; return { state: "published", providerPostId: "provider-post" }; };
      const first = new PostPublishingService(lifecycle, providers, "first", { leaseMs: 300, leaseRenewalMs: 50 });
      const second = new PostPublishingService(lifecycle, providers, "second");
      const pending = first.sweep(1);
      await entered;
      // Compress the pre-fix three-minute lease to keep the real two-worker test fast.
      await sql`UPDATE post_target SET publish_lease_expires_at = NOW() + INTERVAL '300 milliseconds' WHERE id = 'target'`;
      try {
        await new Promise(resolve => setTimeout(resolve, 650));
        const competing = await second.sweep(1);
        assert.equal(competing.examined, 0, "A live upload must not be reclaimed and uploaded twice");
      } finally { release(); await pending; }
      assert.equal(publishCalls, 1);
      assert.equal((await target()).status, "published");
      assert.equal((await target()).publish_lease_owner, null);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal((await target()).publish_lease_owner, null, "A stopped renewal must not resurrect the completed lease");
    });

    await t.test("token refresh contention defers publishing and later recovers", async () => {
      await reset();
      await sql`UPDATE social_account SET refresh_after_at = NOW() - INTERVAL '1 minute', refresh_lease_owner = 'maintenance', refresh_lease_expires_at = NOW() + INTERVAL '1 minute'`;
      assert.equal((await service.sweep(1)).deferred, 1);
      assert.equal((await target()).status, "publishing");
      assert.equal(publishCalls, 0);
      assert.equal((await sql`SELECT * FROM notification WHERE kind = 'error'`).length, 0);
      await sql`UPDATE social_account SET refresh_after_at = NOW() + INTERVAL '1 hour', refresh_lease_owner = NULL, refresh_lease_expires_at = NULL`;
      await due();
      assert.equal((await service.sweep(1)).published, 1);
    });

    await t.test("a stale claim cannot finish or notify after another claim from the same worker takes over", async () => {
      await reset();
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { started = resolve; });
      publish = async () => {
        if (publishCalls === 1) { started(); await gate; return { state: "published", providerPostId: "stale-post" }; }
        return { state: "published", providerPostId: "winning-post" };
      };
      const first = new PostPublishingService(lifecycle, providers, "shared-worker", { leaseMs: 300, leaseRenewalMs: 50 });
      const second = new PostPublishingService(lifecycle, providers, "shared-worker");
      const pending = first.sweep(1);
      await entered;
      try {
        await sql`UPDATE post_target SET publish_lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = 'target'`;
        assert.equal((await second.sweep(1)).published, 1);
      } finally { release(); }
      assert.equal((await pending).deferred, 1);
      assert.equal((await target()).provider_post_id, "winning-post");
      const notices = await sql`SELECT message FROM notification WHERE kind = 'success'`;
      assert.equal(notices.length, 1);
      assert.match(notices[0].message, /winning-post/);
    });

    await t.test("a failed lease renewal stops writes and notifications after the provider returns", async () => {
      await reset();
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const entered = new Promise<void>(resolve => { started = resolve; });
      publish = async () => { started(); await gate; return { state: "published", providerPostId: "unconfirmed-post" }; };
      const publisher = new PostPublishingService(lifecycle, providers, "renewal-failure", { leaseMs: 300, leaseRenewalMs: 50 });
      const pending = publisher.sweep(1);
      await entered;
      // Renaming only this test schema's table simulates a database renewal error.
      await sql`ALTER TABLE post_target RENAME TO unavailable_post_target`;
      try { await new Promise(resolve => setTimeout(resolve, 130)); }
      finally { await sql`ALTER TABLE unavailable_post_target RENAME TO post_target`; release(); }
      assert.equal((await pending).deferred, 1);
      assert.equal((await target()).status, "publishing");
      assert.equal((await target()).provider_post_id, null);
      assert.equal((await sql`SELECT * FROM notification`).length, 0);
      const leaseExpiry = new Date((await target()).publish_lease_expires_at).getTime();
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(new Date((await target()).publish_lease_expires_at).getTime(), leaseExpiry, "A failed renewal must stop its timer");
    });

    await t.test("a token refresh outage defers publishing and successful refresh resumes it", async () => {
      await reset();
      await sql`UPDATE social_account SET refresh_after_at = NOW() - INTERVAL '1 minute'`;
      refreshers.register("facebook", async () => { throw new Error("Provider temporarily unavailable"); });
      assert.equal((await service.sweep(1)).deferred, 1);
      assert.equal((await target()).status, "publishing");
      assert.equal((await sql`SELECT status FROM social_account WHERE id = 'account'`)[0].status, "warning");
      assert.equal(publishCalls, 0);
      refreshers.register("facebook", async () => ({ accessToken: "access-new", expiresAt: new Date(Date.now() + 3_600_000), refreshAfterAt: new Date(Date.now() + 3_000_000) }));
      await due();
      assert.equal((await service.sweep(1)).published, 1);
      assert.equal(publishCalls, 1);
    });

    await t.test("revoked refresh authorization remains terminal", async () => {
      await reset();
      await sql`UPDATE social_account SET refresh_after_at = NOW() - INTERVAL '1 minute'`;
      refreshers.register("facebook", async () => { throw new ProviderAuthorizationError("Authorization revoked", true); });
      assert.equal((await service.sweep(1)).failed, 1);
      assert.equal((await target()).status, "failed");
      assert.equal((await sql`SELECT status FROM social_account WHERE id = 'account'`)[0].status, "expired");
      assert.equal(publishCalls, 0);
    });

    await t.test("fresh target analytics continue on an old draft with a failed sibling", async () => {
      await reset();
      await sql`INSERT INTO post_target (id, post_id, provider, account_display_name, account_handle, status)
        VALUES ('sibling', 'post', 'tiktok', 'Other', '@other', 'failed')`;
      assert.equal((await service.sweep(1)).published, 1);
      assert.equal((await sql`SELECT published_at FROM post WHERE id = 'post'`)[0].published_at, null);
      await sql`UPDATE post_target SET analytics_after = NOW() - INTERVAL '1 second' WHERE id = 'target'`;
      const analytics = await new PostAnalyticsService(lifecycle, new TestAnalyticsRegistry()).sweep(1);
      assert.equal(analytics.collected, 1);
      assert.equal(analytics.stopped, 0, "A freshly published target must not inherit the old draft's age");
      assert.ok(new Date((await target()).published_at).getTime() > Date.now() - 5000);
      assert.ok(new Date((await target()).analytics_after).getTime() > Date.now());
    });

    await t.test("legacy target publication age is backfilled once without using old draft creation", async () => {
      await reset();
      await sql`UPDATE post_target SET status = 'published', published_at = NULL, updated_at = NOW() - INTERVAL '2 days'`;
      const migration = await readFile(new URL("0024_target_published_at.sql", directory), "utf8");
      await sql.unsafe(migration);
      const origin = new Date((await target()).published_at).getTime();
      assert.ok(Math.abs(Date.now() - origin - 2 * 24 * 60 * 60_000) < 5000);
      await sql`UPDATE post_target SET updated_at = NOW()`;
      await sql.unsafe(migration);
      assert.equal(new Date((await target()).published_at).getTime(), origin);
    });

    await t.test("analytics captures a stable age for legacy partial targets inserted after migration", async () => {
      await reset();
      await sql`UPDATE post_target SET status = 'published', provider_post_id = 'legacy-post', published_at = NULL,
        analytics_after = NOW() - INTERVAL '1 second', updated_at = NOW() - INTERVAL '2 days'`;
      const analytics = new PostAnalyticsService(lifecycle, new TestAnalyticsRegistry());
      assert.equal((await analytics.sweep(1)).stopped, 0);
      const origin = new Date((await target()).published_at).getTime();
      assert.ok(Math.abs(Date.now() - origin - 2 * 24 * 60 * 60_000) < 5000);
      await sql`UPDATE post_target SET analytics_after = NOW() - INTERVAL '1 second'`;
      await analytics.sweep(1);
      assert.equal(new Date((await target()).published_at).getTime(), origin);
    });

    for (const sameWorkerId of [false, true]) {
      await t.test(`stale analytics success cannot add a snapshot after takeover (${sameWorkerId ? "same" : "different"} worker ID)`, async () => {
        await reset();
        await service.sweep(1);
        await sql`UPDATE post_target SET analytics_after = NOW() - INTERVAL '1 second' WHERE id = 'target'`;
        let release!: () => void;
        let started!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const entered = new Promise<void>(resolve => { started = resolve; });
        class SlowAnalytics extends ProviderAnalyticsRegistry {
          override async collect() { started(); await gate; return { views: 1, raw: {} }; }
        }
        const first = new PostAnalyticsService(lifecycle, new SlowAnalytics(), "analytics-first");
        const second = new PostAnalyticsService(lifecycle, new TestAnalyticsRegistry(), sameWorkerId ? "analytics-first" : "analytics-second");
        const pending = first.sweep(1);
        await entered;
        let nextPoll: number;
        try {
          await sql`UPDATE post_target SET analytics_lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = 'target'`;
          assert.equal((await second.sweep(1)).collected, 1);
          nextPoll = new Date((await target()).analytics_after).getTime();
        } finally { release(); }
        const stale = await pending;
        const snapshots = await sql`SELECT views FROM post_metric_snapshot WHERE target_id = 'target'`;
        assert.equal(snapshots.length, 1, "The old collector must not insert a stale metric snapshot");
        assert.equal(Number(snapshots[0].views), 12);
        assert.equal(new Date((await target()).analytics_after).getTime(), nextPoll!);
        assert.equal(stale.collected, 0);
        assert.equal(stale.failed, 0);
      });
    }

    await t.test("a stale analytics failure cannot clear a newer claim from the same worker", async () => {
      await reset();
      await service.sweep(1);
      await sql`UPDATE post_target SET analytics_after = NOW() - INTERVAL '1 second' WHERE id = 'target'`;
      let releaseFirst!: () => void;
      let releaseSecond!: () => void;
      let startedFirst!: () => void;
      let startedSecond!: () => void;
      const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
      const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
      const firstEntered = new Promise<void>(resolve => { startedFirst = resolve; });
      const secondEntered = new Promise<void>(resolve => { startedSecond = resolve; });
      class FailedAnalytics extends ProviderAnalyticsRegistry {
        override async collect(): Promise<never> { startedFirst(); await firstGate; throw new Error("Old request failed"); }
      }
      class NewAnalytics extends ProviderAnalyticsRegistry {
        override async collect() { startedSecond(); await secondGate; return { views: 99, raw: {} }; }
      }
      const first = new PostAnalyticsService(lifecycle, new FailedAnalytics(), "shared-analytics");
      const second = new PostAnalyticsService(lifecycle, new NewAnalytics(), "shared-analytics");
      const oldPending = first.sweep(1);
      await firstEntered;
      await sql`UPDATE post_target SET analytics_lease_expires_at = NOW() - INTERVAL '1 second' WHERE id = 'target'`;
      const newPending = second.sweep(1);
      await secondEntered;
      const freshClaim = await target();
      try {
        releaseFirst();
        assert.equal((await oldPending).failed, 0, "An obsolete request must not count a failure");
        const row = await target();
        assert.equal(row.analytics_lease_owner, freshClaim.analytics_lease_owner);
        assert.equal(new Date(row.analytics_after).getTime(), new Date(freshClaim.analytics_after).getTime());
        assert.equal(row.analytics_attempts, 0);
        assert.equal(row.analytics_last_error, null);
      } finally { releaseFirst(); releaseSecond(); await Promise.all([oldPending, newPending]); }
      assert.equal((await sql`SELECT views FROM post_metric_snapshot WHERE target_id = 'target'`).length, 1);
    });
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
    await sql.end();
  }
});
