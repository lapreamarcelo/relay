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

test("publishes an Instagram Reel with a selected cover frame", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [{ id: "container-1" }, { status_code: "FINISHED" }, { id: "media-1" }, { permalink: "https://www.instagram.com/reel/example/" }];
  const fetchImpl: typeof fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json(responses.shift()); };
  await new ProviderPublishRegistry(fetchImpl).publish({
    provider: "instagram", authMethod: "instagram-standalone", providerAccountId: "ig-1", providerMetadata: { metaGraphVersion: "v23.0" }, accessToken: "token",
    text: "Reel", mediaType: "video", mediaUrl: "https://media.example.com/reel.mp4", settings: { kind: "instagram", publishType: "reel", thumbOffsetMs: 4_250 },
  });
  assert.match(String(requests[0].init?.body), /thumb_offset=4250/);
  assert.doesNotMatch(String(requests[0].init?.body), /cover_url=/);
});

test("prefers an Instagram Reel cover URL over the frame offset", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [{ id: "container-1" }, { status_code: "FINISHED" }, { id: "media-1" }, {}];
  const fetchImpl: typeof fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json(responses.shift()); };
  await new ProviderPublishRegistry(fetchImpl).publish({
    provider: "instagram", authMethod: "instagram-facebook", providerAccountId: "ig-1", providerMetadata: {}, accessToken: "token",
    text: "Reel", mediaType: "video", mediaUrl: "https://media.example.com/reel.mp4", settings: { kind: "instagram", publishType: "reel", coverUrl: "https://media.example.com/cover.jpg", thumbOffsetMs: 4_250 },
  });
  assert.match(String(requests[0].init?.body), /cover_url=https%3A%2F%2Fmedia\.example\.com%2Fcover\.jpg/);
  assert.doesNotMatch(String(requests[0].init?.body), /thumb_offset=/);
});

test("starts and then confirms a TikTok Direct Post", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("creator_info")) return Response.json({ data: { privacy_level_options: ["MUTUAL_FOLLOW_FRIENDS"], comment_disabled: false, duet_disabled: false, stitch_disabled: false }, error: { code: "ok" } });
    if (init?.method === "HEAD") return new Response(null, { headers: { "content-length": "12" } });
    if (String(url).endsWith("video/init/")) return Response.json({ data: { publish_id: "publish-1", upload_url: "https://upload.tiktok.example/video" }, error: { code: "ok" } });
    if (String(url) === "https://media.example.com/video.mp4") return new Response("video bytes!", { status: 206, headers: { "content-type": "video/mp4" } });
    if (String(url).startsWith("https://upload.tiktok.example")) return new Response(null, { status: 201 });
    return Response.json({ data: { status: "PUBLISH_COMPLETE", publicaly_available_post_id: ["video-1"] }, error: { code: "ok" } });
  };
  const registry = new ProviderPublishRegistry(fetchImpl);
  const input = { provider: "tiktok" as const, authMethod: "tiktok" as const, providerAccountId: "open-id", providerMetadata: {}, accessToken: "token", text: "A video", mediaType: "video" as const, mediaUrl: "https://media.example.com/video.mp4", settings: { kind: "tiktok" as const, privacyLevel: "MUTUAL_FOLLOW_FRIENDS" as const, allowComments: true, allowDuet: false, allowStitch: false } };
  assert.deepEqual(await registry.publish(input), { state: "processing", providerPostId: "publish-1" });
  assert.deepEqual(await registry.check({ ...input, providerPostId: "publish-1" }), { state: "published", providerPostId: "video-1" });
  const init = requests.find((request) => request.url.endsWith("video/init/"));
  const initBody = JSON.parse(String(init?.init?.body)) as { post_info: { privacy_level: string; brand_content_toggle: boolean; brand_organic_toggle: boolean; is_aigc: boolean }; source_info: { source: string; video_size: number; chunk_size: number; total_chunk_count: number } };
  assert.equal(initBody.post_info.privacy_level, "MUTUAL_FOLLOW_FRIENDS");
  assert.deepEqual({ brandContent: initBody.post_info.brand_content_toggle, brandOrganic: initBody.post_info.brand_organic_toggle, ai: initBody.post_info.is_aigc }, { brandContent: false, brandOrganic: false, ai: false });
  assert.deepEqual(initBody.source_info, { source: "FILE_UPLOAD", video_size: 12, chunk_size: 12, total_chunk_count: 1 });
  const upload = requests.find((request) => request.url.startsWith("https://upload.tiktok.example"));
  assert.equal((upload?.init?.headers as Record<string, string>)["Content-Range"], "bytes 0-11/12");
});

test("sends a selected TikTok cover frame with a Direct Post", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).includes("creator_info")) return Response.json({ data: { privacy_level_options: ["PUBLIC_TO_EVERYONE"], comment_disabled: false, duet_disabled: false, stitch_disabled: false }, error: { code: "ok" } });
    if (init?.method === "HEAD") return new Response(null, { headers: { "content-length": "12" } });
    if (String(url).endsWith("video/init/")) return Response.json({ data: { publish_id: "publish-1", upload_url: "https://upload.tiktok.example/video" }, error: { code: "ok" } });
    if (String(url) === "https://media.example.com/video.mp4") return new Response("video bytes!", { status: 206, headers: { "content-type": "video/mp4" } });
    return new Response(null, { status: 201 });
  };
  await new ProviderPublishRegistry(fetchImpl).publish({ provider: "tiktok", authMethod: "tiktok", providerAccountId: "creator-1", providerMetadata: {}, accessToken: "token", text: "Video", mediaType: "video", mediaUrl: "https://media.example.com/video.mp4", settings: { kind: "tiktok", privacyLevel: "PUBLIC_TO_EVERYONE", allowComments: true, allowDuet: true, allowStitch: true, thumbOffsetMs: 3_500 } });
  const init = requests.find((request) => request.url.endsWith("video/init/"));
  assert.equal((JSON.parse(String(init?.init?.body)) as { post_info: { video_cover_timestamp_ms: number } }).post_info.video_cover_timestamp_ms, 3_500);
});

test("sends Only me photo posts to the TikTok inbox for manual publishing", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [{ data: { publish_id: "photo-upload-1" }, error: { code: "ok" } }];
  const fetchImpl: typeof fetch = async (url, init) => { requests.push({ url: String(url), init }); return Response.json(responses.shift()); };
  const result = await new ProviderPublishRegistry(fetchImpl).publish({
    provider: "tiktok", authMethod: "tiktok", providerAccountId: "open-id", providerMetadata: {}, accessToken: "token",
    text: "A photo story", mediaType: "image", mediaUrl: "https://media.example.com/one.png",
    mediaUrls: ["https://media.example.com/one.png", "https://media.example.com/two.png"],
    settings: { kind: "tiktok", privacyLevel: "SELF_ONLY", allowComments: true, allowDuet: false, allowStitch: false },
  });
  assert.deepEqual(result, { state: "processing", providerPostId: "photo-upload-1" });
  assert.equal(requests[0].url, "https://open.tiktokapis.com/v2/post/publish/content/init/");
  const body = JSON.parse(String(requests[0].init?.body)) as { post_mode: string; post_info: Record<string, unknown>; source_info: { photo_images: string[] } };
  assert.equal(body.post_mode, "MEDIA_UPLOAD");
  assert.equal(body.post_info.privacy_level, undefined);
  assert.deepEqual(body.source_info.photo_images, ["https://media.example.com/one.png", "https://media.example.com/two.png"]);
});

test("sends Only me videos to TikTok's inbox endpoint and completes on inbox delivery", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (init?.method === "HEAD") return new Response(null, { headers: { "content-length": "12" } });
    if (String(url).endsWith("inbox/video/init/")) return Response.json({ data: { publish_id: "inbox-1", upload_url: "https://upload.tiktok.example/inbox" }, error: { code: "ok" } });
    if (String(url) === "https://media.example.com/video.mp4") return new Response("video bytes!", { status: 206, headers: { "content-type": "video/mp4" } });
    if (String(url).startsWith("https://upload.tiktok.example")) return new Response(null, { status: 201 });
    return Response.json({ data: { status: "SEND_TO_USER_INBOX" }, error: { code: "ok" } });
  };
  const registry = new ProviderPublishRegistry(fetchImpl);
  const input = { provider: "tiktok" as const, authMethod: "tiktok" as const, providerAccountId: "open-id", providerMetadata: {}, accessToken: "token", text: "Manual video", mediaType: "video" as const, mediaUrl: "https://media.example.com/video.mp4", settings: { kind: "tiktok" as const, privacyLevel: "SELF_ONLY" as const, allowComments: false, allowDuet: false, allowStitch: false } };
  assert.deepEqual(await registry.publish(input), { state: "processing", providerPostId: "inbox-1" });
  assert.deepEqual(await registry.check({ ...input, providerPostId: "inbox-1" }), { state: "published", providerPostId: "inbox-1", externalUrl: "https://www.tiktok.com/messages?lang=en" });
  assert.equal(requests.some((request) => request.url.includes("creator_info")), false);
  const init = requests.find((request) => request.url.endsWith("inbox/video/init/"));
  const body = JSON.parse(String(init?.init?.body)) as Record<string, unknown>;
  assert.equal(body.post_info, undefined);
});

test("explains TikTok's unaudited-client restriction and preserves the provider log id", async () => {
  const responses = [
    { data: { privacy_level_options: ["MUTUAL_FOLLOW_FRIENDS"], comment_disabled: false }, error: { code: "ok" } },
    { data: {}, error: { code: "unaudited_client_can_only_post_to_private_accounts", message: "Please review our integration guidelines.", log_id: "tiktok-log-123" } },
  ];
  const fetchImpl: typeof fetch = async () => Response.json(responses.shift());
  await assert.rejects(() => new ProviderPublishRegistry(fetchImpl).publish({
    provider: "tiktok", authMethod: "tiktok", providerAccountId: "open-id", providerMetadata: {}, accessToken: "token",
    text: "Private test", mediaType: "image", mediaUrl: "https://media.example.com/one.png",
    settings: { kind: "tiktok", privacyLevel: "MUTUAL_FOLLOW_FRIENDS", allowComments: false, allowDuet: false, allowStitch: false },
  }), (error: unknown) => {
    assert.match(String(error), /request used TikTok Direct Post/);
    assert.match(String(error), /Choose Only me in Relay/);
    assert.match(String(error), /Direct Post audit/);
    assert.match(String(error), /unaudited_client_can_only_post_to_private_accounts/);
    assert.match(String(error), /tiktok-log-123/);
    return true;
  });
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

test("uploads a custom YouTube thumbnail after the video is created", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url) === "https://media.example.com/video.mp4") return new Response("video", { headers: { "content-type": "video/mp4", "content-length": "5" } });
    if (String(url).includes("upload/youtube/v3/videos")) return new Response(null, { status: 200, headers: { location: "https://upload.youtube.example/session" } });
    if (String(url) === "https://upload.youtube.example/session") return Response.json({ id: "youtube-video-1" });
    if (String(url) === "https://media.example.com/thumbnail.png") return new Response("thumbnail", { headers: { "content-type": "image/png", "content-length": "9" } });
    return Response.json({ items: [{ default: { url: "https://img.youtube.example/default.png" } }] });
  };
  const result = await new ProviderPublishRegistry(fetchImpl).publish({
    provider: "youtube", authMethod: "youtube", providerAccountId: "channel-1", providerMetadata: {}, accessToken: "token", text: "Description", mediaType: "video", mediaUrl: "https://media.example.com/video.mp4",
    settings: { kind: "youtube", title: "Title", tags: ["relay"], privacyStatus: "public", madeForKids: false, thumbnailUrl: "https://media.example.com/thumbnail.png" },
  });
  assert.deepEqual(result, { state: "published", providerPostId: "youtube-video-1", externalUrl: "https://www.youtube.com/watch?v=youtube-video-1" });
  const thumbnail = requests.find((request) => request.url.includes("thumbnails/set"));
  assert.equal(thumbnail?.url, "https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=youtube-video-1");
  assert.equal(thumbnail?.init?.method, "POST");
  assert.deepEqual(thumbnail?.init?.headers, { Authorization: "Bearer token", "Content-Type": "image/png", "Content-Length": "9" });
});

test("reports a thumbnail warning without retrying an already-uploaded YouTube video", async () => {
  let videoUploads = 0;
  const fetchImpl: typeof fetch = async (url) => {
    if (String(url) === "https://media.example.com/video.mp4") return new Response("video", { headers: { "content-type": "video/mp4", "content-length": "5" } });
    if (String(url).includes("upload/youtube/v3/videos")) return new Response(null, { status: 200, headers: { location: "https://upload.youtube.example/session" } });
    if (String(url) === "https://upload.youtube.example/session") { videoUploads += 1; return Response.json({ id: "youtube-video-1" }); }
    return new Response("too large", { headers: { "content-type": "image/jpeg", "content-length": String(2 * 1024 * 1024 + 1) } });
  };
  const result = await new ProviderPublishRegistry(fetchImpl).publish({
    provider: "youtube", authMethod: "youtube", providerAccountId: "channel-1", providerMetadata: {}, accessToken: "token", text: "Description", mediaType: "video", mediaUrl: "https://media.example.com/video.mp4",
    settings: { kind: "youtube", title: "Title", tags: [], privacyStatus: "private", madeForKids: false, thumbnailUrl: "https://media.example.com/thumbnail.jpg" },
  });
  assert.equal(result.state, "published");
  assert.match(result.warning ?? "", /video was published.*larger than YouTube's 2 MB limit.*YouTube Studio/i);
  assert.equal(videoUploads, 1);
});
