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

test("preserves image order in an Instagram carousel", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [{ id: "child-1" }, { id: "child-2" }, { id: "carousel-1" }, { status_code: "FINISHED" }, { id: "media-carousel" }, { permalink: "https://www.instagram.com/p/carousel/" }];
  const fetchImpl: typeof fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json(responses.shift()); };
  const result = await new ProviderPublishRegistry(fetchImpl).publish({ provider: "instagram", authMethod: "instagram-standalone", providerAccountId: "ig-1", providerMetadata: { metaGraphVersion: "v23.0" }, accessToken: "token", text: "Carousel", mediaType: "image", mediaUrl: "https://media.example.com/01.png", mediaUrls: ["https://media.example.com/01.png", "https://media.example.com/02.png"], settings: { kind: "instagram", publishType: "feed" } });
  assert.deepEqual(result, { state: "published", providerPostId: "media-carousel", externalUrl: "https://www.instagram.com/p/carousel/" });
  assert.match(String(requests[0].init?.body), /image_url=https%3A%2F%2Fmedia\.example\.com%2F01\.png/);
  assert.match(String(requests[1].init?.body), /image_url=https%3A%2F%2Fmedia\.example\.com%2F02\.png/);
  assert.match(String(requests[2].init?.body), /media_type=CAROUSEL/);
  assert.match(String(requests[2].init?.body), /children=child-1%2Cchild-2/);
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

test("preserves ordered slideshow images in a TikTok photo post", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    { data: { privacy_level_options: ["SELF_ONLY"], comment_disabled: false }, error: { code: "ok" } },
    { data: { publish_id: "photo-publish-1" }, error: { code: "ok" } },
  ];
  const fetchImpl: typeof fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json(responses.shift()); };
  const result = await new ProviderPublishRegistry(fetchImpl).publish({
    provider: "tiktok", authMethod: "tiktok", providerAccountId: "open-id", providerMetadata: {}, accessToken: "token",
    text: "A photo story", mediaType: "image", mediaUrl: "https://media.example.com/one.png",
    mediaUrls: ["https://media.example.com/one.png", "https://media.example.com/two.png"],
    settings: { kind: "tiktok", privacyLevel: "SELF_ONLY", allowComments: true, allowDuet: false, allowStitch: false },
  });
  assert.deepEqual(result, { state: "processing", providerPostId: "photo-publish-1" });
  assert.equal(requests[1].url, "https://open.tiktokapis.com/v2/post/publish/content/init/");
  const body = JSON.parse(String(requests[1].init?.body)) as { source_info: { photo_images: string[] } };
  assert.deepEqual(body.source_info.photo_images, ["https://media.example.com/one.png", "https://media.example.com/two.png"]);
});

test("publishes a Facebook Page photo with the page token", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const fetchImpl: typeof fetch = async (url, init) => { request = { url: String(url), init }; return Response.json({ post_id: "page_post" }); };
  const result = await new ProviderPublishRegistry(fetchImpl).publish({ provider: "facebook", authMethod: "facebook", providerAccountId: "page-1", providerMetadata: { metaGraphVersion: "v23.0" }, accessToken: "page-token", text: "Photo caption", mediaType: "image", mediaUrl: "https://media.example.com/photo.jpg", settings: { kind: "facebook", publishType: "feed" } });
  assert.deepEqual(result, { state: "published", providerPostId: "page_post", externalUrl: "https://www.facebook.com/page_post" });
  assert.equal(request?.url, "https://graph.facebook.com/v23.0/page-1/photos");
  assert.match(String(request?.init?.body), /access_token=page-token/);
});

test("preserves image order in a Facebook Page multi-photo post", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [{ id: "photo-1" }, { id: "photo-2" }, { id: "page_carousel" }];
  const fetchImpl: typeof fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json(responses.shift()); };
  const result = await new ProviderPublishRegistry(fetchImpl).publish({ provider: "facebook", authMethod: "facebook", providerAccountId: "page-1", providerMetadata: { metaGraphVersion: "v23.0" }, accessToken: "page-token", text: "Carousel", mediaType: "image", mediaUrl: "https://media.example.com/01.png", mediaUrls: ["https://media.example.com/01.png", "https://media.example.com/02.png"], settings: { kind: "facebook", publishType: "feed" } });
  assert.deepEqual(result, { state: "published", providerPostId: "page_carousel", externalUrl: "https://www.facebook.com/page_carousel" });
  assert.equal(requests[0].url, "https://graph.facebook.com/v23.0/page-1/photos");
  assert.equal(requests[1].url, "https://graph.facebook.com/v23.0/page-1/photos");
  assert.equal(requests[2].url, "https://graph.facebook.com/v23.0/page-1/feed");
  const attached = new URLSearchParams(String(requests[2].init?.body)).get("attached_media");
  assert.deepEqual(JSON.parse(attached || "[]"), [{ media_fbid: "photo-1" }, { media_fbid: "photo-2" }]);
});
