import type { PostStatus, ProviderId, ProviderPostSettings, RelayPost } from "@relay/core";
import { sql } from "@relay/database";

interface PostRow {
  id: string;
  brand_id: string | null;
  text: string;
  media_type: "none" | "image" | "video";
  media_url: string | null;
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
}

function iso(value: string | Date | null): string | undefined {
  return value === null ? undefined : new Date(value).toISOString();
}

export async function listPostsForOwner(ownerId: string): Promise<RelayPost[]> {
  const posts = await sql<PostRow[]>`
    SELECT id, brand_id, text, media_type, media_url, status, scheduled_at, published_at, created_at
    FROM "post" WHERE owner_id = ${ownerId} ORDER BY created_at DESC LIMIT 500
  `;
  if (posts.length === 0) return [];
  const targets = await sql<TargetRow[]>`
    SELECT target.id, target.post_id, target.social_account_id, target.provider, target.status,
      target.settings, target.external_url, target.error
    FROM "post_target" target
    INNER JOIN "post" post ON post.id = target.post_id
    WHERE post.owner_id = ${ownerId}
    ORDER BY target.created_at ASC
  `;
  const byPost = new Map<string, TargetRow[]>();
  for (const target of targets) byPost.set(target.post_id, [...(byPost.get(target.post_id) ?? []), target]);
  return posts.map((post) => ({
    id: post.id,
    brandId: post.brand_id ?? "",
    text: post.text,
    mediaType: post.media_type,
    mediaUrl: post.media_url ?? undefined,
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
    })),
  }));
}
