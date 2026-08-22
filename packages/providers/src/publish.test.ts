import assert from "node:assert/strict";
import test from "node:test";
import { ProviderPublishRegistry } from "./publish.ts";

test("publishes an Instagram image container and returns its permalink", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (requests.length === 1) return Response.json({ id: "container-1" });
    if (requests.length === 2) return Response.json({ status_code: "FINISHED" });
    if (requests.length === 3) return Response.json({ id: "media-1" });
    return Response.json({ permalink: "https://www.instagram.com/p/example/" });
  };
  const result = await new ProviderPublishRegistry(fetchImpl).publish({
    provider: "instagram", authMethod: "instagram-standalone", providerAccountId: "ig-1", providerMetadata: { metaGraphVersion: "v23.0" }, accessToken: "secret-token",
    text: "Caption", mediaType: "image", mediaUrl: "https://media.example.com/image.jpg", settings: { kind: "instagram", publishType: "feed" },
  });
  assert.deepEqual(result, { state: "published", providerPostId: "media-1", externalUrl: "https://www.instagram.com/p/example/" });
  assert.match(requests[0].url, /^https:\/\/graph\.instagram\.com\/v23\.0\/ig-1\/media$/);
  assert.match(String(requests[0].init?.body), /image_url=https%3A%2F%2Fmedia\.example\.com%2Fimage\.jpg/);
  assert.match(String(requests[2].init?.body), /creation_id=container-1/);
});

test("starts and then confirms a TikTok Direct Post", async () => {
  const responses = [
    { data: { privacy_level_options: ["SELF_ONLY"], comment_disabled: false, duet_disabled: false, stitch_disabled: false }, error: { code: "ok" } },
    { data: { publish_id: "publish-1" }, error: { code: "ok" } },
    { data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["video-1"] }, error: { code: "ok" } },
  ];
  const fetchImpl: typeof fetch = async () => Response.json(responses.shift());
  const registry = new ProviderPublishRegistry(fetchImpl);
  const input = { provider: "tiktok" as const, authMethod: "tiktok" as const, providerAccountId: "open-id", providerMetadata: {}, accessToken: "token", text: "A video", mediaType: "video" as const, mediaUrl: "https://media.example.com/video.mp4", settings: { kind: "tiktok" as const, privacyLevel: "SELF_ONLY" as const, allowComments: true, allowDuet: false, allowStitch: false } };
  assert.deepEqual(await registry.publish(input), { state: "processing", providerPostId: "publish-1" });
  assert.deepEqual(await registry.check({ ...input, providerPostId: "publish-1" }), { state: "published", providerPostId: "video-1" });
});

test("publishes a Facebook Page photo with the page token", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => { request = { url: String(url), init }; return Response.json({ post_id: "page_post" }); };
  const result = await new ProviderPublishRegistry(fetchImpl).publish({ provider: "facebook", authMethod: "facebook", providerAccountId: "page-1", providerMetadata: { metaGraphVersion: "v23.0" }, accessToken: "page-token", text: "Photo caption", mediaType: "image", mediaUrl: "https://media.example.com/photo.jpg", settings: { kind: "facebook", publishType: "feed" } });
  assert.deepEqual(result, { state: "published", providerPostId: "page_post", externalUrl: "https://www.facebook.com/page_post" });
  assert.equal(request?.url, "https://graph.facebook.com/v23.0/page-1/photos");
  assert.match(String(request?.init?.body), /access_token=page-token/);
});
