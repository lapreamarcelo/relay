import type { ProviderAuthMethod, ProviderId, ProviderPostSettings } from "@relay/core";

export interface ProviderAnalyticsInput {
  provider: ProviderId;
  authMethod: ProviderAuthMethod;
  providerAccountId: string;
  providerMetadata: Record<string, unknown>;
  accessToken: string;
  providerPostId: string;
  settings: ProviderPostSettings;
}

export interface ProviderAnalyticsResult {
  views?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  watchTimeSeconds?: number;
  averageWatchTimeSeconds?: number;
  raw: Record<string, unknown>;
}

export class ProviderAnalyticsError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); this.name = "ProviderAnalyticsError"; }
}

type Fetch = typeof fetch;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;
}

function count(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

async function requestJson<T>(fetchImpl: Fetch, url: string | URL, init: RequestInit, action: string): Promise<T> {
  let response: Response;
  try { response = await fetchImpl(url, init); }
  catch { throw new ProviderAnalyticsError(`${action} could not reach the provider.`, true); }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const nested = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : undefined;
  const message = stringValue(nested?.message) ?? stringValue(payload.message);
  const providerCode = stringValue(nested?.code) ?? stringValue(payload.code);
  const tiktokError = providerCode && providerCode !== "ok";
  if (!response.ok || tiktokError) {
    const retryable = response.status === 429 || response.status >= 500 || providerCode === "rate_limit_exceeded";
    throw new ProviderAnalyticsError(`${action} failed${message ? `: ${message}` : ` (HTTP ${response.status})`}.`, retryable);
  }
  return payload as T;
}

interface MetaInsight { name?: unknown; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }

function metaValue(insight: MetaInsight | undefined): number | undefined {
  return count(insight?.total_value?.value) ?? count(insight?.values?.[0]?.value);
}

function metaMap(payload: { data?: MetaInsight[] }): Map<string, number> {
  const values = new Map<string, number>();
  for (const item of payload.data ?? []) {
    const name = stringValue(item.name); const value = metaValue(item);
    if (name && value !== undefined) values.set(name, value);
  }
  return values;
}

async function instagram(input: ProviderAnalyticsInput, fetchImpl: Fetch): Promise<ProviderAnalyticsResult> {
  if (input.settings.kind !== "instagram") throw new ProviderAnalyticsError("Instagram analytics settings are invalid.");
  const version = stringValue(input.providerMetadata.metaGraphVersion) ?? "v23.0";
  const host = input.authMethod === "instagram-standalone" ? "graph.instagram.com" : "graph.facebook.com";
  const metrics = input.settings.publishType === "reel"
    ? ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"]
    : input.settings.publishType === "story" ? ["views", "reach", "likes", "replies", "shares"]
      : ["views", "reach", "likes", "comments", "saved", "shares", "total_interactions"];
  const url = new URL(`https://${host}/${version}/${encodeURIComponent(input.providerPostId)}/insights`);
  url.searchParams.set("metric", metrics.join(","));
  const payload = await requestJson<{ data?: MetaInsight[] }>(fetchImpl, url, { headers: { Authorization: `Bearer ${input.accessToken}` } }, "Instagram analytics");
  const values = metaMap(payload);
  const watchTimeMilliseconds = values.get("ig_reels_video_view_total_time");
  const averageWatchMilliseconds = values.get("ig_reels_avg_watch_time");
  return {
    views: values.get("views"), reach: values.get("reach"), likes: values.get("likes"), comments: values.get("comments"),
    shares: values.get("shares"), saves: values.get("saved"),
    watchTimeSeconds: watchTimeMilliseconds === undefined ? undefined : Math.round(watchTimeMilliseconds / 1_000),
    averageWatchTimeSeconds: averageWatchMilliseconds === undefined ? undefined : Math.round(averageWatchMilliseconds / 1_000),
    raw: payload as Record<string, unknown>,
  };
}

async function optionalFacebookInsights(input: ProviderAnalyticsInput, fetchImpl: Fetch, base: string): Promise<{ payload: Record<string, unknown>; values: Map<string, number> }> {
  for (const metrics of [["post_media_view", "post_media_view_unique"], ["post_impressions", "post_impressions_unique"]]) {
    const url = new URL(`${base}/${encodeURIComponent(input.providerPostId)}/insights`); url.searchParams.set("metric", metrics.join(","));
    try {
      const payload = await requestJson<{ data?: MetaInsight[] }>(fetchImpl, url, { headers: { Authorization: `Bearer ${input.accessToken}` } }, "Facebook view analytics");
      return { payload: payload as Record<string, unknown>, values: metaMap(payload) };
    } catch (error) { if (error instanceof ProviderAnalyticsError && error.retryable) throw error; }
  }
  return { payload: {}, values: new Map() };
}

async function facebook(input: ProviderAnalyticsInput, fetchImpl: Fetch): Promise<ProviderAnalyticsResult> {
  const version = stringValue(input.providerMetadata.metaGraphVersion) ?? "v23.0";
  const base = `https://graph.facebook.com/${version}`;
  const url = new URL(`${base}/${encodeURIComponent(input.providerPostId)}`);
  url.searchParams.set("fields", "reactions.limit(0).summary(true),comments.limit(0).summary(true),shares");
  const payload = await requestJson<{ reactions?: { summary?: { total_count?: unknown } }; comments?: { summary?: { total_count?: unknown } }; shares?: { count?: unknown } }>(fetchImpl, url, { headers: { Authorization: `Bearer ${input.accessToken}` } }, "Facebook engagement analytics");
  const insights = await optionalFacebookInsights(input, fetchImpl, base);
  return {
    views: insights.values.get("post_media_view") ?? insights.values.get("post_impressions"),
    reach: insights.values.get("post_media_view_unique") ?? insights.values.get("post_impressions_unique"),
    likes: count(payload.reactions?.summary?.total_count), comments: count(payload.comments?.summary?.total_count), shares: count(payload.shares?.count),
    raw: { engagement: payload, insights: insights.payload },
  };
}

async function tiktok(input: ProviderAnalyticsInput, fetchImpl: Fetch): Promise<ProviderAnalyticsResult> {
  const url = new URL("https://open.tiktokapis.com/v2/video/query/");
  url.searchParams.set("fields", "id,view_count,like_count,comment_count,share_count");
  const payload = await requestJson<{ data?: { videos?: Array<{ id?: unknown; view_count?: unknown; like_count?: unknown; comment_count?: unknown; share_count?: unknown }> } }>(fetchImpl, url, { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ filters: { video_ids: [input.providerPostId] } }) }, "TikTok analytics");
  const video = payload.data?.videos?.find((item) => stringValue(item.id) === input.providerPostId) ?? payload.data?.videos?.[0];
  if (!video) throw new ProviderAnalyticsError("TikTok did not return analytics for this post.");
  return { views: count(video.view_count), likes: count(video.like_count), comments: count(video.comment_count), shares: count(video.share_count), raw: payload as Record<string, unknown> };
}

async function youtube(input: ProviderAnalyticsInput, fetchImpl: Fetch): Promise<ProviderAnalyticsResult> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "statistics"); url.searchParams.set("id", input.providerPostId);
  const payload = await requestJson<{ items?: Array<{ id?: unknown; statistics?: { viewCount?: unknown; likeCount?: unknown; commentCount?: unknown } }> }>(fetchImpl, url, { headers: { Authorization: `Bearer ${input.accessToken}` } }, "YouTube analytics");
  const video = payload.items?.[0];
  if (!video) throw new ProviderAnalyticsError("YouTube did not return analytics for this video.");
  return { views: count(video.statistics?.viewCount), likes: count(video.statistics?.likeCount), comments: count(video.statistics?.commentCount), raw: payload as Record<string, unknown> };
}

export class ProviderAnalyticsRegistry {
  constructor(private readonly fetchImpl: Fetch = fetch) {}
  collect(input: ProviderAnalyticsInput): Promise<ProviderAnalyticsResult> {
    if (input.provider === "instagram") return instagram(input, this.fetchImpl);
    if (input.provider === "facebook") return facebook(input, this.fetchImpl);
    if (input.provider === "tiktok") return tiktok(input, this.fetchImpl);
    return youtube(input, this.fetchImpl);
  }
}
