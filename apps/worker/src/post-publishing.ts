import type { ProviderAuthMethod, ProviderId, ProviderPostSettings } from "@relay/core";
import { sql } from "@relay/database";
import { ProviderPublishError, type ProviderPublishRegistry } from "@relay/providers/publish";
import { TokenRefreshTransientError, type TokenLifecycleService } from "./token-lifecycle.ts";
import { withFreshAccountToken } from "./publisher-auth.ts";
import { youtubeImageVideoUrl } from "./post-image-video.ts";

interface ClaimedTarget {
  lease_owner: string;
  id: string; post_id: string; owner_id: string; social_account_id: string | null; provider: ProviderId;
  status: "publishing" | "processing"; settings: ProviderPostSettings; provider_post_id: string | null;
  publish_attempts: number; processing_started_at: string | Date | null; text: string; media_type: "none" | "image" | "video";
  media_url: string | null; auth_method: ProviderAuthMethod | null; provider_account_id: string | null;
  media_urls: string[];
  text_override: string | null;
  provider_metadata: Record<string, unknown> | null;
}

export interface PublishingSweepResult { examined: number; published: number; processing: number; failed: number; deferred: number }

export interface PublishingLeaseOptions { leaseMs?: number; leaseRenewalMs?: number }

class PublishingLeaseLostError extends Error {
  constructor() { super("The publishing claim is no longer owned by this worker."); }
}

function isoAfter(milliseconds: number): string { return new Date(Date.now() + milliseconds).toISOString(); }

function isTikTokInboxUpload(target: ClaimedTarget): boolean {
  return target.provider === "tiktok" && target.settings.kind === "tiktok" && target.settings.privacyLevel === "SELF_ONLY";
}

export class PostPublishingService {
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly leaseRenewalMs: number;
  constructor(private readonly lifecycle: Pick<TokenLifecycleService, "getValidAccessToken" | "markAuthorizationRejected">, private readonly providers: ProviderPublishRegistry, workerId = `publisher-${crypto.randomUUID()}`, options: PublishingLeaseOptions = {}) {
    this.workerId = workerId;
    this.leaseMs = options.leaseMs ?? 3 * 60_000;
    this.leaseRenewalMs = options.leaseRenewalMs ?? this.leaseMs / 3;
    if (!Number.isFinite(this.leaseMs) || !Number.isFinite(this.leaseRenewalMs) || this.leaseMs <= 0 || this.leaseRenewalMs <= 0 || this.leaseRenewalMs >= this.leaseMs) throw new Error("Publishing lease renewal must be positive and shorter than the lease.");
  }

  private renewLease(target: ClaimedTarget) {
    let stopped = false;
    let lost = false;
    let pending: Promise<void> = Promise.resolve();
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        pending = (async () => {
          try {
            const rows = await sql`
              UPDATE "post_target" SET publish_lease_expires_at = ${isoAfter(this.leaseMs)}
              WHERE id = ${target.id} AND publish_lease_owner = ${target.lease_owner} AND publish_lease_expires_at > NOW()
              RETURNING id
            `;
            if (rows.length === 0) lost = true;
          } catch { lost = true; }
          if (!stopped && !lost) schedule();
        })();
      }, this.leaseRenewalMs);
    };
    schedule();
    return {
      check: () => { if (lost) throw new PublishingLeaseLostError(); },
      stop: async () => { stopped = true; clearTimeout(timer); await pending; },
    };
  }

  private async claim(): Promise<ClaimedTarget | null> {
    return sql.begin(async (transaction) => {
      const [candidate] = await transaction<{ id: string }[]>`
        SELECT target.id FROM "post_target" target
        INNER JOIN "post" post ON post.id = target.post_id
        WHERE target.status IN ('scheduled', 'publishing', 'processing')
          AND target.publish_after <= NOW()
          AND (target.publish_lease_expires_at IS NULL OR target.publish_lease_expires_at <= NOW())
          AND (target.status <> 'scheduled' OR (post.scheduled_at <= NOW()
            AND NOT EXISTS (SELECT 1 FROM publishing_queue q WHERE q.account_id=target.social_account_id AND q.paused)
            AND NOT EXISTS (SELECT 1 FROM campaign c WHERE c.id=post.campaign_id AND c.paused)))
        ORDER BY target.publish_after ASC
        FOR UPDATE OF target SKIP LOCKED LIMIT 1
      `;
      if (!candidate) return null;
      const leaseOwner = `${this.workerId}:${crypto.randomUUID()}`;
      await transaction`
        UPDATE "post_target" SET status = CASE WHEN status = 'scheduled' THEN 'publishing' ELSE status END,
          processing_started_at = CASE WHEN status = 'processing' THEN COALESCE(processing_started_at, NOW()) ELSE processing_started_at END,
          publish_lease_owner = ${leaseOwner}, publish_lease_expires_at = ${isoAfter(this.leaseMs)}, updated_at = NOW()
        WHERE id = ${candidate.id}
      `;
      const [row] = await transaction<ClaimedTarget[]>`
        SELECT target.id, target.publish_lease_owner AS lease_owner, target.post_id, post.owner_id, target.social_account_id, target.provider, target.status,
          target.settings, target.text_override, target.provider_post_id, target.publish_attempts, target.processing_started_at, post.text, post.media_type,
          post.media_url, post.media_urls, account.auth_method, account.provider_account_id, account.provider_metadata
        FROM "post_target" target INNER JOIN "post" post ON post.id = target.post_id
        LEFT JOIN "social_account" account ON account.id = target.social_account_id
        WHERE target.id = ${candidate.id} AND target.publish_lease_owner = ${leaseOwner}
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
    const inboxUpload = isTikTokInboxUpload(target);
    const title = inboxUpload
      ? kind === "success" ? "Sent to your TikTok inbox" : "TikTok could not receive the inbox upload"
      : kind === "success" ? `Post published on ${target.provider[0].toUpperCase() + target.provider.slice(1)}` : `${target.provider[0].toUpperCase() + target.provider.slice(1)} could not publish the post`;
    await sql`
      INSERT INTO "notification" (id, owner_id, event_key, post_id, target_id, provider, kind, title, message, external_url)
      VALUES (${crypto.randomUUID()}, ${target.owner_id}, ${`${target.post_id}:${target.id}:${kind === "success" ? "published" : "failed"}`}, ${target.post_id}, ${target.id}, ${target.provider}, ${kind}, ${title}, ${message}, ${externalUrl ?? null})
      ON CONFLICT (owner_id, event_key) DO NOTHING
    `;
  }

  private async complete(target: ClaimedTarget, providerPostId: string, externalUrl?: string, warning?: string): Promise<void> {
    const inboxUpload = isTikTokInboxUpload(target);
    const updated = await sql`
      UPDATE "post_target" SET status = 'published', provider_post_id = ${providerPostId}, external_url = ${externalUrl ?? null}, error = ${warning ?? null},
        published_at = COALESCE(published_at, NOW()),
        publish_lease_owner = NULL, publish_lease_expires_at = NULL, analytics_after = ${inboxUpload ? null : isoAfter(5 * 60_000)}, updated_at = NOW()
      WHERE id = ${target.id} AND publish_lease_owner = ${target.lease_owner} RETURNING id
    `;
    if (updated.length === 0) throw new PublishingLeaseLostError();
    await sql`
      DELETE FROM "notification"
      WHERE owner_id = ${target.owner_id} AND target_id = ${target.id} AND kind = 'error'
    `;
    await this.updatePostStatus(target.post_id);
    await this.notify(target, "success", inboxUpload
      ? "TikTok received the media. Open TikTok to review and publish it manually."
      : warning ?? `The provider confirmed this post was published${providerPostId ? ` (id ${providerPostId})` : ""}.`, externalUrl);
  }

  private async processing(target: ClaimedTarget, providerPostId: string): Promise<void> {
    const updated = await sql`
      UPDATE "post_target" SET status = 'processing', provider_post_id = ${providerPostId}, error = NULL, publish_after = ${isoAfter(15_000)},
        processing_started_at = COALESCE(processing_started_at, NOW()),
        publish_lease_owner = NULL, publish_lease_expires_at = NULL, updated_at = NOW()
      WHERE id = ${target.id} AND publish_lease_owner = ${target.lease_owner} RETURNING id
    `;
    if (updated.length === 0) throw new PublishingLeaseLostError();
    await this.updatePostStatus(target.post_id);
  }

  private async fail(target: ClaimedTarget, error: unknown): Promise<"failed" | "deferred"> {
    const message = error instanceof Error ? error.message : "The provider returned an unknown publishing error.";
    const retryable = (error instanceof ProviderPublishError && error.retryable) || error instanceof TokenRefreshTransientError;
    const attempts = target.publish_attempts + 1;
    if (retryable && attempts < 5) {
      const status = target.provider_post_id ? "processing" : "publishing";
      const updated = await sql`
        UPDATE "post_target" SET status = ${status}, publish_attempts = ${attempts}, error = ${message},
          publish_after = ${isoAfter(Math.min(15 * 60_000, 30_000 * 2 ** (attempts - 1)))}, publish_lease_owner = NULL,
          publish_lease_expires_at = NULL, updated_at = NOW()
        WHERE id = ${target.id} AND publish_lease_owner = ${target.lease_owner} RETURNING id
      `;
      if (updated.length === 0) return "deferred";
      await this.updatePostStatus(target.post_id); return "deferred";
    }
    const updated = await sql`
      UPDATE "post_target" SET status = 'failed', publish_attempts = ${attempts}, error = ${message},
        publish_lease_owner = NULL, publish_lease_expires_at = NULL, updated_at = NOW()
      WHERE id = ${target.id} AND publish_lease_owner = ${target.lease_owner} RETURNING id
    `;
    if (updated.length === 0) return "deferred";
    await this.updatePostStatus(target.post_id); await this.notify(target, "error", message); return "failed";
  }

  async sweep(limit = 10): Promise<PublishingSweepResult> {
    const result: PublishingSweepResult = { examined: 0, published: 0, processing: 0, failed: 0, deferred: 0 };
    for (let index = 0; index < limit; index += 1) {
      const target = await this.claim(); if (!target) break; result.examined += 1;
      const renewal = this.renewLease(target);
      try {
        if (!target.social_account_id || !target.auth_method || !target.provider_account_id) throw new ProviderPublishError("The destination account is no longer connected.");
        let mediaType = target.media_type;
        let mediaUrl = target.media_url ?? undefined;
        let mediaUrls = target.media_urls;
        if (target.provider === "youtube" && mediaType === "image") {
          const videoUrl = await youtubeImageVideoUrl(target);
          renewal.check();
          if (!videoUrl) {
            const deferred = await sql`
              UPDATE post_target SET publish_after = ${isoAfter(15_000)}, publish_lease_owner = NULL,
                publish_lease_expires_at = NULL, error = NULL, updated_at = NOW()
              WHERE id = ${target.id} AND publish_lease_owner = ${target.lease_owner} RETURNING id
            `;
            if (!deferred.length) throw new PublishingLeaseLostError();
            await this.updatePostStatus(target.post_id);
            result.deferred += 1;
            continue;
          }
          mediaType = "video";
          mediaUrl = videoUrl;
          mediaUrls = [videoUrl];
        }
        const providerResult = await withFreshAccountToken(this.lifecycle, target.social_account_id, (accessToken) => {
          renewal.check();
          const input = { provider: target.provider, authMethod: target.auth_method!, providerAccountId: target.provider_account_id!, providerMetadata: target.provider_metadata ?? {}, accessToken, text: target.text_override ?? target.text, mediaType, mediaUrl, mediaUrls, settings: target.settings, providerPostId: target.provider_post_id ?? undefined };
          return target.status === "processing" ? this.providers.check(input) : this.providers.publish(input);
        });
        await renewal.stop();
        renewal.check();
        if (providerResult.state === "published") { await this.complete(target, providerResult.providerPostId, providerResult.externalUrl, providerResult.warning); result.published += 1; }
        else if (target.status === "processing" && target.processing_started_at && Date.now() - new Date(target.processing_started_at).getTime() > 24 * 60 * 60_000) {
          const outcome = await this.fail(target, new ProviderPublishError("The provider did not finish processing this post within 24 hours.")); result[outcome] += 1;
        } else { await this.processing(target, providerResult.providerPostId); result.processing += 1; }
      } catch (error) {
        await renewal.stop();
        try { renewal.check(); } catch { error = new PublishingLeaseLostError(); }
        const outcome = error instanceof PublishingLeaseLostError ? "deferred" : await this.fail(target, error);
        result[outcome] += 1;
      } finally { await renewal.stop(); }
    }
    return result;
  }
}
