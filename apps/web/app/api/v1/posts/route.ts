import type { PostStatus, ProviderId, ProviderPostSettings } from "@relay/core";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";
import { listPostsForOwner } from "../../../../lib/post-repository";

export const runtime = "nodejs";

interface PostInput {
  brandId?: unknown;
  text?: unknown;
  mediaType?: unknown;
  mediaUrl?: unknown;
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
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  return Response.json({ data: await listPostsForOwner(authorization.session.user.id) });
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as PostInput | null;
  const text = typeof body?.text === "string" ? body.text.trim().slice(0, 63_206) : "";
  const mediaType = typeof body?.mediaType === "string" && mediaTypes.has(body.mediaType) ? body.mediaType as "none" | "image" | "video" : "none";
  const mediaUrl = optionalString(body?.mediaUrl, 2_000);
  const status = typeof body?.status === "string" && writableStatuses.has(body.status as PostStatus) ? body.status as PostStatus : null;
  const scheduledAt = optionalString(body?.scheduledAt, 100);
  const brandId = optionalString(body?.brandId, 240);
  if ((!text && !mediaUrl) || !status || !Array.isArray(body?.targets) || body.targets.length === 0 || body.targets.length > 20) {
    return Response.json({ error: "A post needs content, a valid status, and between 1 and 20 destinations." }, { status: 400 });
  }
  if ((mediaUrl && !isWebUrl(mediaUrl)) || (mediaType === "none" && mediaUrl) || (mediaType !== "none" && !mediaUrl)) {
    return Response.json({ error: "The selected media is invalid or has not finished uploading." }, { status: 400 });
  }
  if (status === "scheduled" && (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime()))) {
    return Response.json({ error: "A valid schedule time is required." }, { status: 400 });
  }
  if (brandId) {
    const [brand] = await sql<{ id: string }[]>`SELECT id FROM "brand" WHERE id = ${brandId} AND owner_id = ${authorization.session.user.id}`;
    if (!brand) return Response.json({ error: "The selected brand was not found." }, { status: 400 });
  }

  const destinations: Array<{ id: string; provider: ProviderId; displayName: string; handle: string; settings: ProviderPostSettings }> = [];
  const destinationIds = new Set<string>();
  for (const target of body.targets) {
    const accountId = optionalString(target.accountId, 240);
    if (!accountId || destinationIds.has(accountId)) return Response.json({ error: "Every destination must be a unique account with platform settings." }, { status: 400 });
    const [account] = await sql<{ id: string; provider: ProviderId; display_name: string; username: string }[]>`
      SELECT id, provider, display_name, username FROM "social_account"
      WHERE id = ${accountId} AND owner_id = ${authorization.session.user.id}
    `;
    const settings = account ? parseSettings(account.provider, target.settings) : null;
    if (!account || !settings) return Response.json({ error: "One of the selected destinations or its platform settings is invalid." }, { status: 400 });
    destinationIds.add(accountId);
    destinations.push({ id: account.id, provider: account.provider, displayName: account.display_name, handle: account.username.startsWith("@") ? account.username : `@${account.username}`, settings });
  }

  const postId = crypto.randomUUID();
  await sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO "post" (id, owner_id, brand_id, text, media_type, media_url, status, scheduled_at)
      VALUES (${postId}, ${authorization.session.user.id}, ${brandId}, ${text}, ${mediaType}, ${mediaUrl}, ${status}, ${status === "scheduled" ? new Date(scheduledAt!).toISOString() : null})
    `;
    for (const destination of destinations) {
      const targetId = crypto.randomUUID();
      await transaction`
        INSERT INTO "post_target" (id, post_id, social_account_id, provider, account_display_name, account_handle, status, settings, publish_after)
        VALUES (${targetId}, ${postId}, ${destination.id}, ${destination.provider}, ${destination.displayName}, ${destination.handle}, ${status}, ${JSON.stringify(destination.settings)}::jsonb, ${status === "scheduled" ? new Date(scheduledAt!).toISOString() : new Date().toISOString()})
      `;
    }
  });
  const [saved] = (await listPostsForOwner(authorization.session.user.id)).filter((post) => post.id === postId);
  return Response.json({ data: saved }, { status: 201 });
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  const id = optionalString(body?.id, 240);
  if (!id) return Response.json({ error: "A post id is required." }, { status: 400 });
  const [post] = await sql<{ status: PostStatus }[]>`SELECT status FROM "post" WHERE id = ${id} AND owner_id = ${authorization.session.user.id}`;
  if (!post) return Response.json({ error: "The post was not found." }, { status: 404 });
  if (post.status === "publishing" || post.status === "processing") return Response.json({ error: "This post has already been handed to the provider and can no longer be cancelled." }, { status: 409 });
  const deleted = await sql<{ id: string }[]>`
    DELETE FROM "post" WHERE id = ${id} AND owner_id = ${authorization.session.user.id} RETURNING id
  `;
  if (deleted.length === 0) return Response.json({ error: "The post changed while it was being removed. Refresh and try again." }, { status: 409 });
  return Response.json({ data: { id } });
}
