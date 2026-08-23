import type { PostStatus, ProviderAuthMethod, ProviderId, ProviderPostSettings } from "@relay/core";
import { sql } from "@relay/database";
import { ProviderAnalyticsError, type ProviderAnalyticsRegistry, type ProviderAnalyticsResult } from "@relay/providers/analytics";

import type { TokenLifecycleService } from "./token-lifecycle.ts";
import { withFreshAccountToken } from "./publisher-auth.ts";
import { nextAnalyticsDelay } from "./analytics-schedule.ts";

interface ClaimedAnalyticsTarget {
  id: string;
  post_id: string;
  social_account_id: string | null;
  provider: ProviderId;
  provider_post_id: string;
  settings: ProviderPostSettings;
  analytics_attempts: number;
  published_at: string | Date | null;
  created_at: string | Date;
  auth_method: ProviderAuthMethod | null;
  provider_account_id: string | null;
  provider_metadata: Record<string, unknown> | null;
}

export interface AnalyticsSweepResult { examined: number; collected: number; failed: number; stopped: number }

function isoAfter(milliseconds: number): string { return new Date(Date.now() + milliseconds).toISOString(); }

export class PostAnalyticsService {
  private readonly workerId: string;

  constructor(private readonly lifecycle: TokenLifecycleService, private readonly providers: ProviderAnalyticsRegistry, workerId = `analytics-${crypto.randomUUID()}`) {
    this.workerId = workerId;
  }

  private async claim(): Promise<ClaimedAnalyticsTarget | null> {
    return sql.begin(async (transaction) => {
      const [candidate] = await transaction<{ id: string }[]>`
        SELECT target.id FROM "post_target" target
        WHERE target.status = 'published' AND target.provider_post_id IS NOT NULL
          AND target.analytics_after IS NOT NULL AND target.analytics_after <= NOW()
          AND (target.analytics_lease_expires_at IS NULL OR target.analytics_lease_expires_at <= NOW())
        ORDER BY target.analytics_after ASC
        FOR UPDATE OF target SKIP LOCKED LIMIT 1
      `;
      if (!candidate) return null;
      await transaction`
        UPDATE "post_target" SET analytics_lease_owner = ${this.workerId}, analytics_lease_expires_at = ${isoAfter(2 * 60_000)}, updated_at = NOW()
        WHERE id = ${candidate.id}
      `;
      const [row] = await transaction<ClaimedAnalyticsTarget[]>`
        SELECT target.id, target.post_id, target.social_account_id, target.provider, target.provider_post_id, target.settings,
          target.analytics_attempts, post.published_at, target.created_at, account.auth_method, account.provider_account_id, account.provider_metadata
        FROM "post_target" target
        INNER JOIN "post" post ON post.id = target.post_id
        LEFT JOIN "social_account" account ON account.id = target.social_account_id
        WHERE target.id = ${candidate.id} AND target.analytics_lease_owner = ${this.workerId}
      `;
      return row ?? null;
    });
  }

  private async save(target: ClaimedAnalyticsTarget, result: ProviderAnalyticsResult): Promise<boolean> {
    const origin = new Date(target.published_at ?? target.created_at).getTime();
    const delay = nextAnalyticsDelay(Math.max(0, Date.now() - origin));
    await sql.begin(async (transaction) => {
      await transaction`
        INSERT INTO "post_metric_snapshot" (id, target_id, views, reach, likes, comments, shares, saves, watch_time_seconds, average_watch_time_seconds, raw_metrics)
        VALUES (${crypto.randomUUID()}, ${target.id}, ${result.views ?? null}, ${result.reach ?? null}, ${result.likes ?? null}, ${result.comments ?? null}, ${result.shares ?? null}, ${result.saves ?? null}, ${result.watchTimeSeconds ?? null}, ${result.averageWatchTimeSeconds ?? null}, ${JSON.stringify(result.raw)}::jsonb)
      `;
      await transaction`
        UPDATE "post_target" SET analytics_after = ${delay === null ? null : isoAfter(delay)}, analytics_attempts = 0,
          analytics_last_error = NULL, analytics_lease_owner = NULL, analytics_lease_expires_at = NULL, updated_at = NOW()
        WHERE id = ${target.id} AND analytics_lease_owner = ${this.workerId}
      `;
    });
    return delay === null;
  }

  private async fail(target: ClaimedAnalyticsTarget, error: unknown): Promise<void> {
    const attempts = target.analytics_attempts + 1;
    const message = error instanceof Error ? error.message : "The provider returned an unknown analytics error.";
    const retryable = error instanceof ProviderAnalyticsError && error.retryable;
    const delay = retryable ? Math.min(6 * 60 * 60_000, 15 * 60_000 * 2 ** Math.min(attempts - 1, 5)) : 24 * 60 * 60_000;
    await sql`
      UPDATE "post_target" SET analytics_attempts = ${attempts}, analytics_last_error = ${message}, analytics_after = ${isoAfter(delay)},
        analytics_lease_owner = NULL, analytics_lease_expires_at = NULL, updated_at = NOW()
      WHERE id = ${target.id} AND analytics_lease_owner = ${this.workerId}
    `;
  }

  async sweep(limit = 10): Promise<AnalyticsSweepResult> {
    const result: AnalyticsSweepResult = { examined: 0, collected: 0, failed: 0, stopped: 0 };
    for (let index = 0; index < limit; index += 1) {
      const target = await this.claim();
      if (!target) break;
      result.examined += 1;
      if (!target.social_account_id || !target.auth_method || !target.provider_account_id) {
        await this.fail(target, new ProviderAnalyticsError("The destination account is no longer connected.")); result.failed += 1; continue;
      }
      try {
        const metrics = await withFreshAccountToken(this.lifecycle, target.social_account_id, (accessToken) => this.providers.collect({
          provider: target.provider, authMethod: target.auth_method!, providerAccountId: target.provider_account_id!, providerMetadata: target.provider_metadata ?? {}, accessToken,
          providerPostId: target.provider_post_id, settings: target.settings,
        }));
        const stopped = await this.save(target, metrics); result.collected += 1; if (stopped) result.stopped += 1;
      } catch (error) { await this.fail(target, error); result.failed += 1; }
    }
    return result;
  }
}
