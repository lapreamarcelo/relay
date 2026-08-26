import type { PostStatus, ProviderId, ProviderPostSettings } from "@relay/core";
import { validatePostPlan } from "@relay/core/post-validation";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";
import { listPostsForOwner } from "../../../../lib/post-repository";

export const runtime = "nodejs";

interface PostInput {
  clientRequestId?: unknown;
  brandId?: unknown;
  campaignId?: unknown;
  text?: unknown;
  mediaType?: unknown;
  mediaUrl?: unknown;
  mediaUrls?: unknown;
  status?: unknown;
  scheduledAt?: unknown;
  targets?: Array<{ accountId?: unknown; settings?: unknown; textOverride?: unknown }>;
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
    const coverUrl = optionalString(settings.coverUrl, 2_000);
    const thumbOffsetMs = typeof settings.thumbOffsetMs === "number" && Number.isInteger(settings.thumbOffsetMs) && settings.thumbOffsetMs >= 0 && settings.thumbOffsetMs <= 900_000 ? settings.thumbOffsetMs : undefined;
    return settings.kind === "instagram" && ["feed", "reel", "story"].includes(String(settings.publishType))
      && (!coverUrl || isHttpsUrl(coverUrl))
      ? { kind: "instagram", publishType: settings.publishType as "feed" | "reel" | "story", coverUrl: coverUrl ?? undefined, thumbOffsetMs } : null;
  }
  if (provider === "facebook") {
    const linkUrl = optionalString(settings.linkUrl, 2_000);
    return settings.kind === "facebook" && ["feed", "reel"].includes(String(settings.publishType)) && (!linkUrl || isWebUrl(linkUrl))
      ? { kind: "facebook", publishType: settings.publishType as "feed" | "reel", linkUrl: linkUrl ?? undefined } : null;
  }
  if (provider === "tiktok") {
    const privacy = String(settings.privacyLevel);
    const thumbOffsetMs = typeof settings.thumbOffsetMs === "number" && Number.isInteger(settings.thumbOffsetMs) && settings.thumbOffsetMs >= 0 && settings.thumbOffsetMs <= 900_000 ? settings.thumbOffsetMs : undefined;
    return settings.kind === "tiktok"
      && ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"].includes(privacy)
      && typeof settings.allowComments === "boolean" && typeof settings.allowDuet === "boolean" && typeof settings.allowStitch === "boolean"
      ? { kind: "tiktok", privacyLevel: privacy as "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY", allowComments: settings.allowComments, allowDuet: settings.allowDuet, allowStitch: settings.allowStitch, thumbOffsetMs } : null;
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
  const campaignId = optionalString(body?.campaignId, 240);
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
  if (campaignId) {
    const [campaign] = await sql<{ id: string; brand_id: string | null }[]>`SELECT id, brand_id FROM "campaign" WHERE id = ${campaignId} AND owner_id = ${ownerId}`;
    if (!campaign || (campaign.brand_id && campaign.brand_id !== brandId)) return Response.json({ error: "The selected campaign does not belong to this brand." }, { status: 400 });
  }

  const destinations: Array<{ id: string; provider: ProviderId; displayName: string; handle: string; settings: ProviderPostSettings; textOverride?: string }> = [];
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
    const textOverride = optionalString(target.textOverride, 63_206) ?? undefined;
    destinations.push({ id: account.id, provider: account.provider, displayName: account.display_name, handle: account.username.startsWith("@") ? account.username : `@${account.username}`, settings, textOverride });
  }
  if (mediaUrls.length > 1 && destinations.some((destination) => destination.provider === "youtube")) {
    return Response.json({ error: "YouTube requires video and cannot receive image slideshows." }, { status: 400 });
  }
  const validationIssues = status === "draft" ? [] : validatePostPlan({ text, mediaType, mediaCount: mediaUrls.length, scheduledAt: status === "scheduled" ? scheduledAt : null, destinations });
  if (validationIssues.length > 0) return Response.json({ error: validationIssues[0].message, issues: validationIssues }, { status: 400 });

  const proposedPostId = crypto.randomUUID();
  const postId = await sql.begin(async (transaction) => {
    const [inserted] = await transaction<{ id: string }[]>`
      INSERT INTO "post" (id, owner_id, brand_id, campaign_id, client_request_id, text, media_type, media_url, media_urls, status, scheduled_at)
      VALUES (${proposedPostId}, ${ownerId}, ${brandId}, ${campaignId}, ${clientRequestId}, ${text}, ${mediaType}, ${mediaUrl}, ${JSON.stringify(mediaUrls)}::jsonb, ${status}, ${status === "scheduled" ? new Date(scheduledAt!).toISOString() : null})
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
        INSERT INTO "post_target" (id, post_id, social_account_id, provider, account_display_name, account_handle, status, settings, text_override, publish_after)
        VALUES (${targetId}, ${inserted.id}, ${destination.id}, ${destination.provider}, ${destination.displayName}, ${destination.handle}, ${status}, ${JSON.stringify(destination.settings)}::jsonb, ${destination.textOverride ?? null}, ${status === "scheduled" ? new Date(scheduledAt!).toISOString() : new Date().toISOString()})
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
  const body = await request.json().catch(() => null) as (PostInput & { id?: unknown; ids?: unknown; retryTargetIds?: unknown; updates?: unknown }) | null;
  const ownerId = authorization.session.user.id;

  if (Array.isArray(body?.ids) && body.campaignId !== undefined) {
    const ids = [...new Set(body.ids.map((value) => optionalString(value, 240)).filter((value): value is string => Boolean(value)))];
    const campaignId = optionalString(body.campaignId, 240);
    if (ids.length === 0 || ids.length > 100) return Response.json({ error: "Campaign assignment supports between 1 and 100 posts." }, { status: 400 });
    const result = await sql.begin(async (transaction) => {
      const posts = await transaction<{ id: string; brand_id: string | null }[]>`SELECT id, brand_id FROM "post" WHERE id = ANY(${ids}) AND owner_id = ${ownerId} FOR UPDATE`;
      if (posts.length !== ids.length) return { error: "One or more posts were not found.", status: 404 as const };
      if (campaignId) {
        const [campaign] = await transaction<{ brand_id: string | null }[]>`SELECT brand_id FROM "campaign" WHERE id = ${campaignId} AND owner_id = ${ownerId}`;
        if (!campaign) return { error: "Campaign not found.", status: 404 as const };
        if (campaign.brand_id && posts.some((post) => post.brand_id !== campaign.brand_id)) return { error: "Every selected post must belong to the campaign's brand.", status: 409 as const };
      }
      await transaction`UPDATE "post" SET campaign_id = ${campaignId}, updated_at = NOW() WHERE id = ANY(${ids}) AND owner_id = ${ownerId}`;
      return { data: ids };
    });
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ data: result.data });
  }

  if (Array.isArray(body?.updates)) {
    if (body.updates.length === 0 || body.updates.length > 100) return Response.json({ error: "Bulk rescheduling supports between 1 and 100 posts." }, { status: 400 });
    const updates = body.updates.map((item) => {
      const value = item && typeof item === "object" ? item as { id?: unknown; scheduledAt?: unknown } : {};
      return { id: optionalString(value.id, 240), scheduledAt: optionalString(value.scheduledAt, 100) };
    });
    if (updates.some((item) => !item.id || !item.scheduledAt || Number.isNaN(new Date(item.scheduledAt).getTime()) || new Date(item.scheduledAt).getTime() <= Date.now())) return Response.json({ error: "Every bulk update needs a post id and future schedule time." }, { status: 400 });
    const result = await sql.begin(async (transaction) => {
      const ids = updates.map((item) => item.id!);
      const posts = await transaction<{ id: string; status: PostStatus }[]>`SELECT id, status FROM "post" WHERE id = ANY(${ids}) AND owner_id = ${ownerId} FOR UPDATE`;
      if (posts.length !== ids.length) return { error: "One or more posts were not found.", status: 404 as const };
      if (posts.some((post) => post.status !== "draft" && post.status !== "scheduled")) return { error: "Only drafts and scheduled posts can be bulk rescheduled.", status: 409 as const };
      for (const update of updates) {
        const time = new Date(update.scheduledAt!).toISOString();
        await transaction`UPDATE "post" SET status = 'scheduled', scheduled_at = ${time}, updated_at = NOW() WHERE id = ${update.id}`;
        await transaction`UPDATE "post_target" SET status = 'scheduled', publish_after = ${time}, error = NULL, updated_at = NOW() WHERE post_id = ${update.id}`;
      }
      return { data: ids };
    });
    if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ data: result.data });
  }

  const id = optionalString(body?.id, 240);
  if (!id) return Response.json({ error: "A post id is required." }, { status: 400 });

  if (Array.isArray(body?.retryTargetIds)) {
    const targetIds = [...new Set(body.retryTargetIds.map((value) => optionalString(value, 240)).filter((value): value is string => Boolean(value)))];
    if (targetIds.length === 0 || targetIds.length > 20) return Response.json({ error: "Choose between 1 and 20 failed destinations to retry." }, { status: 400 });
    const retried = await sql.begin(async (transaction) => {
      const targets = await transaction<{ id: string; status: PostStatus }[]>`
        SELECT target.id, target.status FROM "post_target" target INNER JOIN "post" post ON post.id = target.post_id
        WHERE target.id = ANY(${targetIds}) AND target.post_id = ${id} AND post.owner_id = ${ownerId} FOR UPDATE OF target
      `;
      if (targets.length !== targetIds.length) return false;
      if (targets.some((target) => target.status !== "failed")) return false;
      await transaction`UPDATE "post_target" SET status = 'publishing', publish_attempts = 0, publish_after = NOW(), error = NULL, publish_lease_owner = NULL, publish_lease_expires_at = NULL, updated_at = NOW() WHERE id = ANY(${targetIds})`;
      await transaction`UPDATE "post" SET status = 'publishing', updated_at = NOW() WHERE id = ${id} AND owner_id = ${ownerId}`;
      return true;
    });
    if (!retried) return Response.json({ error: "Only failed destinations belonging to this post can be retried." }, { status: 409 });
    const [saved] = (await listPostsForOwner(ownerId)).filter((item) => item.id === id);
    return Response.json({ data: saved });
  }

  if (Array.isArray(body?.targets) && typeof body.text === "string") {
    const text = body.text.trim().slice(0, 63_206);
    const mediaType = typeof body.mediaType === "string" && mediaTypes.has(body.mediaType) ? body.mediaType as "none" | "image" | "video" : "none";
    const mediaUrl = optionalString(body.mediaUrl, 2_000);
    const mediaUrls = Array.isArray(body.mediaUrls) ? body.mediaUrls.map((value) => optionalString(value, 2_000)).filter((value): value is string => Boolean(value)) : mediaUrl ? [mediaUrl] : [];
    const brandId = optionalString(body.brandId, 240);
    const campaignId = optionalString(body.campaignId, 240);
    const status = body.status === "draft" ? "draft" : body.status === "scheduled" ? "scheduled" : body.status === "publishing" ? "publishing" : null;
    const scheduledAt = optionalString(body.scheduledAt, 100);
    if (!status || (status === "scheduled" && (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())))) return Response.json({ error: "Edited posts must be saved as a draft, scheduled, or published now." }, { status: 400 });
    if ((mediaType === "none" && mediaUrl) || (mediaType !== "none" && (!mediaUrl || !isWebUrl(mediaUrl)))) return Response.json({ error: "The selected media is invalid." }, { status: 400 });
    if (mediaUrls.length > 35 || mediaUrls.some((value) => !isWebUrl(value)) || (mediaUrls.length > 1 && (mediaType !== "image" || mediaUrl !== mediaUrls[0] || mediaUrls.some((value) => !isHttpsUrl(value))))) return Response.json({ error: "A slideshow needs between 1 and 35 valid HTTPS image URLs." }, { status: 400 });
    const destinations: Array<{ id: string; provider: ProviderId; displayName: string; handle: string; settings: ProviderPostSettings; textOverride?: string }> = [];
    for (const target of body.targets) {
      const accountId = optionalString(target.accountId, 240);
      const [account] = accountId ? await sql<{ id: string; provider: ProviderId; display_name: string; username: string }[]>`SELECT id, provider, display_name, username FROM "social_account" WHERE id = ${accountId} AND owner_id = ${ownerId}` : [];
      const settings = account ? parseSettings(account.provider, target.settings) : null;
      if (!account || !settings) return Response.json({ error: "One of the edited destinations or its settings is invalid." }, { status: 400 });
      destinations.push({ id: account.id, provider: account.provider, displayName: account.display_name, handle: account.username.startsWith("@") ? account.username : `@${account.username}`, settings, textOverride: optionalString(target.textOverride, 63_206) ?? undefined });
    }
    if (mediaUrls.length > 1 && destinations.some((destination) => destination.provider === "youtube")) return Response.json({ error: "YouTube requires video and cannot receive image slideshows." }, { status: 400 });
    const issues = status === "draft" ? [] : validatePostPlan({ text, mediaType, mediaCount: mediaUrls.length, scheduledAt: status === "scheduled" ? scheduledAt : null, destinations });
    if (issues.length > 0) return Response.json({ error: issues[0].message, issues }, { status: 400 });
    if (campaignId) {
      const [campaign] = await sql<{ brand_id: string | null }[]>`SELECT brand_id FROM "campaign" WHERE id = ${campaignId} AND owner_id = ${ownerId}`;
      if (!campaign || (campaign.brand_id && campaign.brand_id !== brandId)) return Response.json({ error: "The selected campaign does not belong to this brand." }, { status: 400 });
    }
    const edited = await sql.begin(async (transaction) => {
      const [post] = await transaction<{ status: PostStatus }[]>`SELECT status FROM "post" WHERE id = ${id} AND owner_id = ${ownerId} FOR UPDATE`;
      if (!post || (post.status !== "draft" && post.status !== "scheduled")) return false;
      await transaction`SELECT id FROM "post_target" WHERE post_id = ${id} FOR UPDATE`;
      const publishAfter = status === "scheduled" ? new Date(scheduledAt!).toISOString() : new Date().toISOString();
      await transaction`UPDATE "post" SET brand_id = ${brandId}, campaign_id = ${campaignId}, text = ${text}, media_type = ${mediaType}, media_url = ${mediaUrl}, media_urls = ${JSON.stringify(mediaUrls)}::jsonb, status = ${status}, scheduled_at = ${status === "scheduled" ? publishAfter : null}, updated_at = NOW() WHERE id = ${id}`;
      await transaction`DELETE FROM "post_target" WHERE post_id = ${id}`;
      for (const destination of destinations) await transaction`INSERT INTO "post_target" (id, post_id, social_account_id, provider, account_display_name, account_handle, status, settings, text_override, publish_after) VALUES (${crypto.randomUUID()}, ${id}, ${destination.id}, ${destination.provider}, ${destination.displayName}, ${destination.handle}, ${status}, ${JSON.stringify(destination.settings)}::jsonb, ${destination.textOverride ?? null}, ${publishAfter})`;
      return true;
    });
    if (!edited) return Response.json({ error: "Only drafts and scheduled posts can be edited." }, { status: 409 });
    const [saved] = (await listPostsForOwner(ownerId)).filter((item) => item.id === id);
    return Response.json({ data: saved });
  }

  const publishNow = body?.scheduledAt === null;
  const scheduledAt = optionalString(body?.scheduledAt, 100);
  if (!publishNow && (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime()))) {
    return Response.json({ error: "Set scheduledAt to an ISO date, or null to publish now." }, { status: 400 });
  }
  const [post] = await sql<{ id: string; status: PostStatus }[]>`
    SELECT id, status FROM "post" WHERE id = ${id} AND owner_id = ${ownerId}
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
      WHERE id = ${id} AND owner_id = ${ownerId} AND status IN ('draft', 'scheduled')
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
  const [saved] = (await listPostsForOwner(ownerId)).filter((item) => item.id === id);
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
