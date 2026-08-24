import type { ProviderAuthMethod, ProviderId, ProviderPostSettings } from "@relay/core";
import { sql } from "@relay/database";
import { ProviderPublishError, type ProviderPublishRegistry } from "@relay/providers/publish";
import type { TokenLifecycleService } from "./token-lifecycle.ts";
import { withFreshAccountToken } from "./publisher-auth.ts";

interface ClaimedTarget {
  id: string; post_id: string; owner_id: string; social_account_id: string | null; provider: ProviderId;
  status: "publishing" | "processing"; settings: ProviderPostSettings; provider_post_id: string | null;
  publish_attempts: number; created_at: string | Date; text: string; media_type: "none" | "image" | "video";
  media_url: string | null; auth_method: ProviderAuthMethod | null; provider_account_id: string | null;
  media_urls: string[];
  text_override: string | null;
  provider_metadata: Record<string, unknown> | null;
}

export interface PublishingSweepResult { examined: number; published: number; processing: number; failed: number; deferred: number }

function isoAfter(milliseconds: number): string { return new Date(Date.now() + milliseconds).toISOString(); }

export class PostPublishingService {
  private readonly workerId: string;
  constructor(private readonly lifecycle: TokenLifecycleService, private readonly providers: ProviderPublishRegistry, workerId = `publisher-${crypto.randomUUID()}`) { this.workerId = workerId; }

  private async claim(): Promise<ClaimedTarget | null> {
    return sql.begin(async (transaction) => {
      const [candidate] = await transaction<{ id: string }[]>`
        SELECT target.id FROM "post_target" target
        INNER JOIN "post" post ON post.id = target.post_id
        WHERE target.status IN ('scheduled', 'publishing', 'processing')
          AND target.publish_after <= NOW()
          AND (target.publish_lease_expires_at IS NULL OR target.publish_lease_expires_at <= NOW())
          AND (target.status <> 'scheduled' OR post.scheduled_at <= NOW())
        ORDER BY target.publish_after ASC
        FOR UPDATE OF target SKIP LOCKED LIMIT 1
      `;
      if (!candidate) return null;
      await transaction`
        UPDATE "post_target" SET status = CASE WHEN status = 'scheduled' THEN 'publishing' ELSE status END,
          publish_lease_owner = ${this.workerId}, publish_lease_expires_at = ${isoAfter(3 * 60_000)}, updated_at = NOW()
        WHERE id = ${candidate.id}
      `;
      const [row] = await transaction<ClaimedTarget[]>`
        SELECT target.id, target.post_id, post.owner_id, target.social_account_id, target.provider, target.status,
          target.settings, target.text_override, target.provider_post_id, target.publish_attempts, target.created_at, post.text, post.media_type,
          post.media_url, post.media_urls, account.auth_method, account.provider_account_id, account.provider_metadata
        FROM "post_target" target INNER JOIN "post" post ON post.id = target.post_id
        LEFT JOIN "social_account" account ON account.id = target.social_account_id
        WHERE target.id = ${candidate.id} AND target.publish_lease_owner = ${this.workerId}
      `;
      return row ?? null;
    });
  }

  private async updatePostStatus(postId: string): Promise<void> {
    const [counts] = await sql<{ scheduled: number; publishing: number; processing: number; published: number; failed: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
        count(*) FILTER (WHERE status = 'publishing')::int AS publishing,
        count(*) FILTER (WHERE status = 'processing')::int AS processing,
        count(*) FILTER (WHERE status = 'published')::int AS published,
        count(*) FILTER (WHERE status = 'failed')::int AS failed
      FROM "post_target" WHERE post_id = ${postId}
    `;
    if (!counts) return;
    const status = counts.scheduled > 0 && counts.publishing === 0 && counts.processing === 0 && counts.published === 0 && counts.failed === 0 ? "scheduled"
      : counts.publishing > 0 ? "publishing" : counts.processing > 0 ? "processing" : counts.failed > 0 ? "failed" : "published";
    await sql`
      UPDATE "post" SET status = ${status}, published_at = CASE WHEN ${status} = 'published' THEN COALESCE(published_at, NOW()) ELSE published_at END, updated_at = NOW()
      WHERE id = ${postId}
    `;
  }

  private async notify(target: ClaimedTarget, kind: "success" | "error", message: string, externalUrl?: string): Promise<void> {
    const title = kind === "success" ? `Post published on ${target.provider[0].toUpperCase() + target.provider.slice(1)}` : `${target.provider[0].toUpperCase() + target.provider.slice(1)} could not publish the post`;
    await sql`
      INSERT INTO "notification" (id, owner_id, event_key, post_id, target_id, provider, kind, title, message, external_url)
      VALUES (${crypto.randomUUID()}, ${target.owner_id}, ${`${target.post_id}:${target.id}:${kind === "success" ? "published" : "failed"}`}, ${target.post_id}, ${target.id}, ${target.provider}, ${kind}, ${title}, ${message}, ${externalUrl ?? null})
      ON CONFLICT (owner_id, event_key) DO NOTHING
    `;
  }

  private async complete(target: ClaimedTarget, providerPostId: string, externalUrl?: string): Promise<void> {
    await sql`
      UPDATE "post_target" SET status = 'published', provider_post_id = ${providerPostId}, external_url = ${externalUrl ?? null}, error = NULL,
        publish_lease_owner = NULL, publish_lease_expires_at = NULL, analytics_after = ${isoAfter(5 * 60_000)}, updated_at = NOW()
      WHERE id = ${target.id} AND publish_lease_owner = ${this.workerId}
    `;
    await this.updatePostStatus(target.post_id);
    await this.notify(target, "success", `The provider confirmed this post was published${providerPostId ? ` (id ${providerPostId})` : ""}.`, externalUrl);
  }

  private async processing(target: ClaimedTarget, providerPostId: string): Promise<void> {
    await sql`
      UPDATE "post_target" SET status = 'processing', provider_post_id = ${providerPostId}, error = NULL, publish_after = ${isoAfter(15_000)},
        publish_lease_owner = NULL, publish_lease_expires_at = NULL, updated_at = NOW()
      WHERE id = ${target.id} AND publish_lease_owner = ${this.workerId}
    `;
    await this.updatePostStatus(target.post_id);
  }

  private async fail(target: ClaimedTarget, error: unknown): Promise<"failed" | "deferred"> {
    const message = error instanceof Error ? error.message : "The provider returned an unknown publishing error.";
    const retryable = error instanceof ProviderPublishError && error.retryable;
    const attempts = target.publish_attempts + 1;
    if (retryable && attempts < 5) {
      const status = target.provider_post_id ? "processing" : "publishing";
      await sql`
        UPDATE "post_target" SET status = ${status}, publish_attempts = ${attempts}, error = ${message},
          publish_after = ${isoAfter(Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1)))}, publish_lease_owner = NULL,
          publish_lease_expires_at = NULL, updated_at = NOW()
        WHERE id = ${target.id} AND publish_lease_owner = ${this.workerId}
      `;
      await this.updatePostStatus(target.post_id); return "deferred";
    }
    await sql`
      UPDATE "post_target" SET status = 'failed', publish_attempts = ${attempts}, error = ${message},
        publish_lease_owner = NULL, publish_lease_expires_at = NULL, updated_at = NOW()
      WHERE id = ${target.id} AND publish_lease_owner = ${this.workerId}
    `;
    await this.updatePostStatus(target.post_id); await this.notify(target, "error", message); return "failed";
  }

  async sweep(limit = 10): Promise<PublishingSweepResult> {
    const result: PublishingSweepResult = { examined: 0, published: 0, processing: 0, failed: 0, deferred: 0 };
    for (let index = 0; index < limit; index += 1) {
      const target = await this.claim(); if (!target) break; result.examined += 1;
      if (!target.social_account_id || !target.auth_method || !target.provider_account_id) { const outcome = await this.fail(target, new ProviderPublishError("The destination account is no longer connected.")); result[outcome] += 1; continue; }
      if (target.status === "processing" && Date.now() - new Date(target.created_at).getTime() > 24 * 60 * 60_000) { const outcome = await this.fail(target, new ProviderPublishError("The provider did not finish processing this post within 24 hours.")); result[outcome] += 1; continue; }
      try {
        const providerResult = await withFreshAccountToken(this.lifecycle, target.social_account_id, (accessToken) => {
          const input = { provider: target.provider, authMethod: target.auth_method!, providerAccountId: target.provider_account_id!, providerMetadata: target.provider_metadata ?? {}, accessToken, text: target.text_override ?? target.text, mediaType: target.media_type, mediaUrl: target.media_url ?? undefined, mediaUrls: target.media_urls, settings: target.settings, providerPostId: target.provider_post_id ?? undefined };
          return target.status === "processing" ? this.providers.check(input) : this.providers.publish(input);
        });
        if (providerResult.state === "published") { await this.complete(target, providerResult.providerPostId, providerResult.externalUrl); result.published += 1; }
        else { await this.processing(target, providerResult.providerPostId); result.processing += 1; }
      } catch (error) { const outcome = await this.fail(target, error); result[outcome] += 1; }
    }
    return result;
  }
}
