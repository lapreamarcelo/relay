import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderAnalyticsInput } from "./analytics.ts";
import { ProviderAnalyticsRegistry } from "./analytics.ts";

const base: ProviderAnalyticsInput = { provider: "youtube", authMethod: "youtube", providerAccountId: "channel", providerMetadata: {}, accessToken: "token", providerPostId: "video-1", settings: { kind: "youtube", title: "Title", tags: [], privacyStatus: "public", madeForKids: false } };

test("normalizes YouTube counters", async () => {
  const registry = new ProviderAnalyticsRegistry(async () => Response.json({ items: [{ id: "video-1", statistics: { viewCount: "1200", likeCount: "94", commentCount: "11" } }] }));
  assert.deepEqual(await registry.collect(base), { views: 1200, likes: 94, comments: 11, raw: { items: [{ id: "video-1", statistics: { viewCount: "1200", likeCount: "94", commentCount: "11" } }] } });
});

test("normalizes TikTok counters and sends the public post id", async () => {
  let body = "";
  const registry = new ProviderAnalyticsRegistry(async (_url, init) => { body = String(init?.body); return Response.json({ data: { videos: [{ id: "post-7", view_count: 9000, like_count: 810, comment_count: 43, share_count: 72 }] }, error: { code: "ok" } }); });
  const result = await registry.collect({ ...base, provider: "tiktok", authMethod: "tiktok", providerPostId: "post-7", settings: { kind: "tiktok", privacyLevel: "PUBLIC_TO_EVERYONE", allowComments: true, allowDuet: false, allowStitch: false } });
  assert.deepEqual({ views: result.views, likes: result.likes, comments: result.comments, shares: result.shares }, { views: 9000, likes: 810, comments: 43, shares: 72 });
  assert.match(body, /post-7/);
});

test("normalizes Instagram insight values and milliseconds", async () => {
  const registry = new ProviderAnalyticsRegistry(async () => Response.json({ data: [
    { name: "views", values: [{ value: 4200 }] }, { name: "reach", total_value: { value: 3100 } }, { name: "likes", values: [{ value: 380 }] },
    { name: "ig_reels_avg_watch_time", values: [{ value: 8250 }] }, { name: "ig_reels_video_view_total_time", values: [{ value: 990000 }] },
  ] }));
  const result = await registry.collect({ ...base, provider: "instagram", authMethod: "instagram-standalone", providerPostId: "media-4", settings: { kind: "instagram", publishType: "reel" } });
  assert.deepEqual({ views: result.views, reach: result.reach, likes: result.likes, watchTimeSeconds: result.watchTimeSeconds, averageWatchTimeSeconds: result.averageWatchTimeSeconds }, { views: 4200, reach: 3100, likes: 380, watchTimeSeconds: 990, averageWatchTimeSeconds: 8 });
});

test("keeps Facebook engagement when view metrics are unavailable", async () => {
  let calls = 0;
  const registry = new ProviderAnalyticsRegistry(async () => {
    calls += 1;
    if (calls === 1) return Response.json({ reactions: { summary: { total_count: 18 } }, comments: { summary: { total_count: 4 } }, shares: { count: 3 } });
    return Response.json({ error: { code: 100, message: "Metric unavailable" } }, { status: 400 });
  });
  const result = await registry.collect({ ...base, provider: "facebook", authMethod: "facebook", providerPostId: "page_post", settings: { kind: "facebook", publishType: "feed" } });
  assert.deepEqual({ likes: result.likes, comments: result.comments, shares: result.shares, views: result.views }, { likes: 18, comments: 4, shares: 3, views: undefined });
});
