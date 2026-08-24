import type { PostStatus, ProviderId, ProviderPostSettings, RelayPost } from "@relay/core";
import { sql } from "@relay/database";

interface PostRow {
  id: string;
  brand_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  text: string;
  media_type: "none" | "image" | "video";
  media_url: string | null;
  media_urls: string[];
  status: PostStatus;
  scheduled_at: string | Date | null;
  published_at: string | Date | null;
  created_at: string | Date;
}

interface TargetRow {
  id: string;
  post_id: string;
  social_account_id: string | null;
  provider: ProviderId;
  status: PostStatus;
  settings: ProviderPostSettings;
  external_url: string | null;
  error: string | null;
  text_override: string | null;
  analytics_captured_at: string | Date | null;
  analytics_views: number | null;
  analytics_reach: number | null;
  analytics_likes: number | null;
  analytics_comments: number | null;
  analytics_shares: number | null;
  analytics_saves: number | null;
  analytics_watch_time_seconds: number | null;
  analytics_average_watch_time_seconds: number | null;
}

function iso(value: string | Date | null): string | undefined {
  return value === null ? undefined : new Date(value).toISOString();
}

export async function listPostsForOwner(ownerId: string): Promise<RelayPost[]> {
  const posts = await sql<PostRow[]>`
    SELECT post.id, post.brand_id, post.campaign_id, campaign.name AS campaign_name, post.text, post.media_type, post.media_url, post.media_urls, post.status, post.scheduled_at, post.published_at, post.created_at
    FROM "post" LEFT JOIN "campaign" campaign ON campaign.id = post.campaign_id
    WHERE post.owner_id = ${ownerId} ORDER BY post.created_at DESC LIMIT 500
  `;
  if (posts.length === 0) return [];
  const targets = await sql<TargetRow[]>`
    SELECT target.id, target.post_id, target.social_account_id, target.provider, target.status,
      target.settings, target.text_override, target.external_url, target.error, metric.captured_at AS analytics_captured_at,
      metric.views::float8 AS analytics_views, metric.reach::float8 AS analytics_reach, metric.likes::float8 AS analytics_likes,
      metric.comments::float8 AS analytics_comments, metric.shares::float8 AS analytics_shares, metric.saves::float8 AS analytics_saves,
      metric.watch_time_seconds::float8 AS analytics_watch_time_seconds, metric.average_watch_time_seconds AS analytics_average_watch_time_seconds
    FROM "post_target" target
    INNER JOIN "post" post ON post.id = target.post_id
    LEFT JOIN LATERAL (
      SELECT captured_at, views, reach, likes, comments, shares, saves, watch_time_seconds, average_watch_time_seconds
      FROM "post_metric_snapshot" WHERE target_id = target.id ORDER BY captured_at DESC LIMIT 1
    ) metric ON true
    WHERE post.owner_id = ${ownerId}
    ORDER BY target.created_at ASC
  `;
  const byPost = new Map<string, TargetRow[]>();
  for (const target of targets) byPost.set(target.post_id, [...(byPost.get(target.post_id) ?? []), target]);
  return posts.map((post) => ({
    id: post.id,
    brandId: post.brand_id ?? "",
    campaignId: post.campaign_id ?? undefined,
    campaignName: post.campaign_name ?? undefined,
    text: post.text,
    mediaType: post.media_type,
    mediaUrl: post.media_url ?? undefined,
    mediaUrls: post.media_urls,
    status: post.status,
    scheduledAt: iso(post.scheduled_at),
    publishedAt: iso(post.published_at),
    createdAt: iso(post.created_at),
    targets: (byPost.get(post.id) ?? []).map((target) => ({
      id: target.id,
      accountId: target.social_account_id ?? "",
      provider: target.provider,
      status: target.status,
      settings: target.settings,
      externalUrl: target.external_url ?? undefined,
      error: target.error ?? undefined,
      textOverride: target.text_override ?? undefined,
      analytics: target.analytics_captured_at ? {
        capturedAt: new Date(target.analytics_captured_at).toISOString(),
        views: target.analytics_views ?? undefined,
        reach: target.analytics_reach ?? undefined,
        likes: target.analytics_likes ?? undefined,
        comments: target.analytics_comments ?? undefined,
        shares: target.analytics_shares ?? undefined,
        saves: target.analytics_saves ?? undefined,
        watchTimeSeconds: target.analytics_watch_time_seconds ?? undefined,
        averageWatchTimeSeconds: target.analytics_average_watch_time_seconds ?? undefined,
      } : undefined,
    })),
  }));
}
