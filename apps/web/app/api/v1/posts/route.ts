import type { PostStatus, ProviderId, ProviderPostSettings } from "@relay/core";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";
import { listPostsForOwner } from "../../../../lib/post-repository";

export const runtime = "nodejs";

interface PostInput {
  clientRequestId?: unknown;
  brandId?: unknown;
  text?: unknown;
  mediaType?: unknown;
  mediaUrl?: unknown;
  mediaUrls?: unknown;
  status?: unknown;
  scheduledAt?: unknown;
  targets?: Array<{ accountId?: unknown; settings?: unknown }>;
}

const mediaTypes = new Set(["none", "image", "video"]);
const writableStatuses = new Set<PostStatus>(["draft", "scheduled", "publishing"]);

function optionalString(value: unknown, maximum: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maximum) : null;
}

function isWebUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

function parseSettings(provider: ProviderId, value: unknown): ProviderPostSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || JSON.stringify(value).length > 10_000) return null;
  const settings = value as Record<string, unknown>;
  if (provider === "instagram") {
    return settings.kind === "instagram" && ["feed", "reel", "story"].includes(String(settings.publishType))
      ? { kind: "instagram", publishType: settings.publishType as "feed" | "reel" | "story" } : null;
  }
  if (provider === "facebook") {
    const linkUrl = optionalString(settings.linkUrl, 2_000);
    return settings.kind === "facebook" && ["feed", "reel"].includes(String(settings.publishType)) && (!linkUrl || isWebUrl(linkUrl))
      ? { kind: "facebook", publishType: settings.publishType as "feed" | "reel", linkUrl: linkUrl ?? undefined } : null;
  }
  if (provider === "tiktok") {
    const privacy = String(settings.privacyLevel);
    return settings.kind === "tiktok"
      && ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"].includes(privacy)
      && typeof settings.allowComments === "boolean" && typeof settings.allowDuet === "boolean" && typeof settings.allowStitch === "boolean"
      ? { kind: "tiktok", privacyLevel: privacy as "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY", allowComments: settings.allowComments, allowDuet: settings.allowDuet, allowStitch: settings.allowStitch } : null;
  }
  const title = optionalString(settings.title, 100);
  const tags = Array.isArray(settings.tags) ? settings.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 50).map((tag) => tag.trim().slice(0, 100)).filter(Boolean) : null;
  return settings.kind === "youtube" && title && tags && ["private", "unlisted", "public"].includes(String(settings.privacyStatus)) && typeof settings.madeForKids === "boolean"
    ? { kind: "youtube", title, tags, privacyStatus: settings.privacyStatus as "private" | "unlisted" | "public", madeForKids: settings.madeForKids } : null;
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "posts:read" });
  if (authorization.response) return authorization.response;
  return Response.json({ data: await listPostsForOwner(authorization.session.user.id) });
}

async function createPost(ownerId: string, body: PostInput | null) {
  const clientRequestId = optionalString(body?.clientRequestId, 240);
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 63_206) : "";
  const mediaType = typeof body?.mediaType === "string" && mediaTypes.has(body.mediaType) ? body.mediaType as "none" | "image" | "video" : "none";
  const mediaUrl = optionalString(body?.mediaUrl, 2_000);
  const rawMediaUrls = Array.isArray(body?.mediaUrls) ? body.mediaUrls : null;
  const mediaUrls = rawMediaUrls
    ? rawMediaUrls.map((value) => optionalString(value, 2_000)).filter((value): value is string => Boolean(value))
    : mediaUrl ? [mediaUrl] : [];
  const status = typeof body?.status === "string" && writableStatuses.has(body.status as PostStatus) ? body.status as PostStatus : null;
  const scheduledAt = optionalString(body?.scheduledAt, 100);
  const brandId = optionalString(body?.brandId, 240);
  if ((!text && !mediaUrl) || !status || !Array.isArray(body?.targets) || body.targets.length === 0 || body.targets.length > 20) {
    return Response.json({ error: "A post needs content, a valid status, and between 1 and 20 destinations." }, { status: 400 });
  }
  if ((mediaUrl && !isWebUrl(mediaUrl)) || (mediaType === "none" && mediaUrl) || (mediaType !== "none" && !mediaUrl)) {
    return Response.json({ error: "The selected media is invalid or has not finished uploading." }, { status: 400 });
  }
  if ((rawMediaUrls && mediaUrls.length !== rawMediaUrls.length) || mediaUrls.length > 35 || mediaUrls.some((value) => !isWebUrl(value)) || (mediaUrls.length > 1 && (mediaType !== "image" || mediaUrl !== mediaUrls[0] || mediaUrls.some((value) => !isHttpsUrl(value))))) {
    return Response.json({ error: "A slideshow needs between 1 and 35 valid HTTPS image URLs." }, { status: 400 });
  }
  if (status === "scheduled" && (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime()))) {
    return Response.json({ error: "A valid schedule time is required." }, { status: 400 });
  }
  if (brandId) {
    const [brand] = await sql<{ id: string }[]>`SELECT id FROM "brand" WHERE id = ${brandId} AND owner_id = ${ownerId}`;
    if (!brand) return Response.json({ error: "The selected brand was not found." }, { status: 400 });
  }

  const destinations: Array<{ id: string; provider: ProviderId; displayName: string; handle: string; settings: ProviderPostSettings }> = [];
  const destinationIds = new Set<string>();
  for (const target of body.targets) {
    const accountId = optionalString(target.accountId, 240);
    if (!accountId || destinationIds.has(accountId)) return Response.json({ error: "Every destination must be a unique account with platform settings." }, { status: 400 });
    const [account] = await sql<{ id: string; provider: ProviderId; display_name: string; username: string }[]>`
      SELECT id, provider, display_name, username FROM "social_account"
      WHERE id = ${accountId} AND owner_id = ${ownerId}
    `;
    const settings = account ? parseSettings(account.provider, target.settings) : null;
    if (!account || !settings) return Response.json({ error: "One of the selected destinations or its platform settings is invalid." }, { status: 400 });
    destinationIds.add(accountId);
    destinations.push({ id: account.id, provider: account.provider, displayName: account.display_name, handle: account.username.startsWith("@") ? account.username : `@${account.username}`, settings });
  }
  if (mediaUrls.length > 1 && destinations.some((destination) => destination.provider !== "tiktok")) {
    return Response.json({ error: "Multi-image slideshows currently publish to TikTok destinations only." }, { status: 400 });
  }

  const proposedPostId = crypto.randomUUID();
  const postId = await sql.begin(async (transaction) => {
    const [inserted] = await transaction<{ id: string }[]>`
      INSERT INTO "post" (id, owner_id, brand_id, client_request_id, text, media_type, media_url, media_urls, status, scheduled_at)
      VALUES (${proposedPostId}, ${ownerId}, ${brandId}, ${clientRequestId}, ${text}, ${mediaType}, ${mediaUrl}, ${JSON.stringify(mediaUrls)}::jsonb, ${status}, ${status === "scheduled" ? new Date(scheduledAt!).toISOString() : null})
      ON CONFLICT (owner_id, client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
      RETURNING id
    `;
    if (!inserted) {
      const [existing] = await transaction<{ id: string }[]>`SELECT id FROM "post" WHERE owner_id = ${ownerId} AND client_request_id = ${clientRequestId}`;
      return existing.id;
    }
    for (const destination of destinations) {
      const targetId = crypto.randomUUID();
      await transaction`
        INSERT INTO "post_target" (id, post_id, social_account_id, provider, account_display_name, account_handle, status, settings, publish_after)
        VALUES (${targetId}, ${inserted.id}, ${destination.id}, ${destination.provider}, ${destination.displayName}, ${destination.handle}, ${status}, ${JSON.stringify(destination.settings)}::jsonb, ${status === "scheduled" ? new Date(scheduledAt!).toISOString() : new Date().toISOString()})
      `;
    }
    return inserted.id;
  });
  const [saved] = (await listPostsForOwner(ownerId)).filter((post) => post.id === postId);
  return Response.json({ data: saved }, { status: 201 });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "posts:write" });
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as (PostInput & { posts?: unknown }) | null;
  if (!Array.isArray(body?.posts)) return createPost(authorization.session.user.id, body);
  if (body.posts.length === 0 || body.posts.length > 100) return Response.json({ error: "A bulk request needs between 1 and 100 posts." }, { status: 400 });

  const results: Array<{ index: number; data?: unknown; error?: string; status: number }> = [];
  for (const [index, item] of body.posts.entries()) {
    const response = await createPost(authorization.session.user.id, item && typeof item === "object" ? item as PostInput : null);
    const payload = await response.json() as { data?: unknown; error?: string };
    results.push({ index, ...payload, status: response.status });
  }
  const failed = results.filter((result) => result.status >= 400).length;
  return Response.json({ data: results, summary: { created: results.length - failed, failed } }, { status: failed === 0 ? 201 : 207 });
}

export async function PATCH(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "posts:write" });
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown; scheduledAt?: unknown } | null;
  const id = optionalString(body?.id, 240);
  if (!id) return Response.json({ error: "A post id is required." }, { status: 400 });
  const publishNow = body?.scheduledAt === null;
  const scheduledAt = optionalString(body?.scheduledAt, 100);
  if (!publishNow && (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime()))) {
    return Response.json({ error: "Set scheduledAt to an ISO date, or null to publish now." }, { status: 400 });
  }
  const [post] = await sql<{ id: string; status: PostStatus }[]>`
    SELECT id, status FROM "post" WHERE id = ${id} AND owner_id = ${authorization.session.user.id}
  `;
  if (!post) return Response.json({ error: "The post was not found." }, { status: 404 });
  if (post.status !== "draft" && post.status !== "scheduled") {
    return Response.json({ error: "Only a draft or scheduled post can be rescheduled or published now." }, { status: 409 });
  }
  const nextStatus: PostStatus = publishNow ? "publishing" : "scheduled";
  const publishAfter = publishNow ? new Date().toISOString() : new Date(scheduledAt!).toISOString();
  const updated = await sql.begin(async (transaction) => {
    const targets = await transaction<{ status: PostStatus; publish_lease_owner: string | null }[]>`
      SELECT status, publish_lease_owner FROM "post_target" WHERE post_id = ${id} FOR UPDATE
    `;
    if (targets.some((target) => target.status === "publishing" || target.status === "processing" || target.publish_lease_owner !== null)) return false;
    const [claimed] = await transaction<{ id: string }[]>`
      UPDATE "post" SET status = ${nextStatus}, scheduled_at = ${publishNow ? null : publishAfter}, updated_at = NOW()
      WHERE id = ${id} AND owner_id = ${authorization.session.user.id} AND status IN ('draft', 'scheduled')
      RETURNING id
    `;
    if (!claimed) return false;
    await transaction`
      UPDATE "post_target" SET status = ${nextStatus}, publish_after = ${publishAfter}, error = NULL, updated_at = NOW()
      WHERE post_id = ${id}
    `;
    return true;
  });
  if (!updated) return Response.json({ error: "The post started publishing while it was being changed." }, { status: 409 });
  const [saved] = (await listPostsForOwner(authorization.session.user.id)).filter((item) => item.id === id);
  return Response.json({ data: saved });
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "posts:write" });
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown; ids?: unknown } | null;
  const singleId = optionalString(body?.id, 240);
  const ids = singleId ? [singleId] : Array.isArray(body?.ids) && body.ids.length <= 100
    ? [...new Set(body.ids.map((id) => optionalString(id, 240)).filter((id): id is string => Boolean(id)))] : [];
  if (ids.length === 0) return Response.json({ error: "One or more post ids are required." }, { status: 400 });
  const result = await sql.begin(async (transaction) => {
    const posts = await transaction<{ id: string; status: PostStatus }[]>`
      SELECT id, status FROM "post" WHERE id = ANY(${ids}) AND owner_id = ${authorization.session.user.id} FOR UPDATE
    `;
    if (posts.length !== ids.length) return { error: "One or more posts were not found.", status: 404 as const };
    const protectedPost = posts.find((post) => post.status === "publishing" || post.status === "processing");
    if (protectedPost) return { error: `Post ${protectedPost.id} has already been handed to the provider and can no longer be cancelled.`, status: 409 as const };
    const targets = await transaction<{ post_id: string; status: PostStatus; publish_lease_owner: string | null }[]>`
      SELECT post_id, status, publish_lease_owner FROM "post_target" WHERE post_id = ANY(${ids}) FOR UPDATE
    `;
    const protectedTarget = targets.find((target) => target.status === "publishing" || target.status === "processing" || target.publish_lease_owner !== null);
    if (protectedTarget) return { error: `Post ${protectedTarget.post_id} has already been claimed by the publishing worker and can no longer be cancelled.`, status: 409 as const };
    const deleted = await transaction<{ id: string }[]>`
      DELETE FROM "post" WHERE id = ANY(${ids}) AND owner_id = ${authorization.session.user.id} RETURNING id
    `;
    return { data: deleted };
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ data: result.data });
}
