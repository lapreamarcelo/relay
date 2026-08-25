import type { ProviderAuthMethod, ProviderId, ProviderPostSettings } from "@relay/core";

export interface ProviderPublishInput {
  provider: ProviderId;
  authMethod: ProviderAuthMethod;
  providerAccountId: string;
  providerMetadata: Record<string, unknown>;
  accessToken: string;
  text: string;
  mediaType: "none" | "image" | "video";
  mediaUrl?: string;
  mediaUrls?: string[];
  settings: ProviderPostSettings;
  providerPostId?: string;
}

export interface ProviderPublishResult {
  state: "published" | "processing";
  providerPostId: string;
  externalUrl?: string;
}

export class ProviderPublishError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); this.name = "ProviderPublishError"; }
}

type Fetch = typeof fetch;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : typeof value === "number" ? String(value) : undefined;
}

function tiktokErrorMessage(code: string | undefined, fallback: string | undefined): string | undefined {
  if (code === "unaudited_client_can_only_post_to_private_accounts") return "This TikTok app has not passed the Direct Post audit. During sandbox testing, the connected TikTok account must itself be Private and the post visibility must be Only me (SELF_ONLY). To post from public accounts, move the app to Production and complete TikTok's Direct Post audit.";
  if (code === "privacy_level_option_mismatch") return "TikTok rejected the visibility choice. Reopen the post, choose one of the creator's currently available visibility options, and use Only me (SELF_ONLY) for an unaudited app.";
  if (code === "reached_active_user_cap") return "This TikTok app reached its daily active-creator limit. An unaudited client can be used by at most five creator accounts in a 24-hour window.";
  if (code === "spam_risk_too_many_posts") return "This TikTok creator reached its 24-hour Direct Post limit. Wait before trying again.";
  if (code === "scope_not_authorized" || code === "scope_permission_missed") return "The TikTok connection does not include the video.publish permission. Reconnect the account after enabling Direct Post for the TikTok app.";
  return fallback;
}

async function requestJson<T>(fetchImpl: Fetch, url: string | URL, init: RequestInit, action: string): Promise<T> {
  let response: Response;
  try { response = await fetchImpl(url, init); }
  catch { throw new ProviderPublishError(`${action} could not reach the provider.`, true); }
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  const nested = payload.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : undefined;
  const code = stringValue(nested?.code);
  const providerLogId = stringValue(nested?.log_id) ?? stringValue(nested?.logid);
  const providerCode = stringValue(nested?.error_subcode) ?? stringValue(nested?.type) ?? stringValue(payload.code);
  const providerMessage = stringValue(nested?.message) ?? stringValue(payload.message);
  const tiktokError = nested && stringValue(nested.code) && stringValue(nested.code) !== "ok";
  if (!response.ok || tiktokError) {
    const retryable = response.status === 429 || response.status >= 500 || code === "1" || code === "internal_error" || code === "rate_limit_exceeded" || providerCode === "internal_error" || providerCode === "rate_limit_exceeded";
    const message = tiktokErrorMessage(tiktokError ? code : undefined, providerMessage);
    const details = message ? `: ${message}` : providerCode ? ` (${providerCode})` : code ? ` (${code})` : ` (HTTP ${response.status})`;
    throw new ProviderPublishError(`${action} failed${details}.${tiktokError && code ? ` TikTok code: ${code}.` : ""}${providerLogId ? ` TikTok log ID: ${providerLogId}.` : ""}`, retryable);
  }
  return payload as T;
}

function graphForm(values: Record<string, string | boolean | undefined>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) body.set(key, String(value));
  return body;
}

function wait(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

async function publishInstagram(input: ProviderPublishInput, fetchImpl: Fetch): Promise<ProviderPublishResult> {
  if (input.settings.kind !== "instagram") throw new ProviderPublishError("Instagram settings are invalid.");
  if (!input.mediaUrl || input.mediaType === "none") throw new ProviderPublishError("Instagram requires an image or video.");
  const version = stringValue(input.providerMetadata.metaGraphVersion) ?? "v23.0";
  const base = input.authMethod === "instagram-standalone" ? `https://graph.instagram.com/${version}` : `https://graph.facebook.com/${version}`;
  const mediaType = input.settings.publishType === "story" ? "STORIES" : input.mediaType === "video" || input.settings.publishType === "reel" ? "REELS" : undefined;
  const carouselUrls = input.mediaType === "image" && (input.mediaUrls?.length ?? 0) > 1 ? input.mediaUrls! : [];
  if (carouselUrls.length > 10) throw new ProviderPublishError("Instagram carousels support up to 10 slides.");
  if (carouselUrls.length && input.settings.publishType !== "feed") throw new ProviderPublishError("Instagram carousels publish as feed posts.");
  let created: { id?: unknown };
  if (carouselUrls.length) {
    const children: string[] = [];
    for (const imageUrl of carouselUrls) {
      const child = await requestJson<{ id?: unknown }>(fetchImpl, `${base}/${encodeURIComponent(input.providerAccountId)}/media`, { method: "POST", body: graphForm({ access_token: input.accessToken, image_url: imageUrl, is_carousel_item: true }) }, "Instagram carousel item preparation");
      const childId = stringValue(child.id);
      if (!childId) throw new ProviderPublishError("Instagram did not return a carousel item container.");
      children.push(childId);
    }
    created = await requestJson<{ id?: unknown }>(fetchImpl, `${base}/${encodeURIComponent(input.providerAccountId)}/media`, { method: "POST", body: graphForm({ access_token: input.accessToken, media_type: "CAROUSEL", children: children.join(","), caption: input.text }) }, "Instagram carousel preparation");
  } else {
    created = await requestJson<{ id?: unknown }>(fetchImpl, `${base}/${encodeURIComponent(input.providerAccountId)}/media`, {
      method: "POST", body: graphForm({ access_token: input.accessToken, image_url: input.mediaType === "image" ? input.mediaUrl : undefined, video_url: input.mediaType === "video" ? input.mediaUrl : undefined, media_type: mediaType, caption: input.settings.publishType === "story" ? undefined : input.text }),
    }, "Instagram media preparation");
  }
  const containerId = stringValue(created.id);
  if (!containerId) throw new ProviderPublishError("Instagram did not return a media container.");
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const status = await requestJson<{ status_code?: unknown; status?: unknown }>(fetchImpl, `${base}/${encodeURIComponent(containerId)}?fields=status_code,status&access_token=${encodeURIComponent(input.accessToken)}`, {}, "Instagram media processing");
    const value = stringValue(status.status_code) ?? stringValue(status.status);
    if (!value || value === "FINISHED") break;
    if (value === "ERROR" || value === "EXPIRED") throw new ProviderPublishError(`Instagram could not process the media (${value}).`);
    if (attempt === 59) throw new ProviderPublishError("Instagram is still processing the media. Relay will retry shortly.", true);
    await wait(2_000);
  }
  const published = await requestJson<{ id?: unknown }>(fetchImpl, `${base}/${encodeURIComponent(input.providerAccountId)}/media_publish`, { method: "POST", body: graphForm({ access_token: input.accessToken, creation_id: containerId }) }, "Instagram publishing");
  const mediaId = stringValue(published.id);
  if (!mediaId) throw new ProviderPublishError("Instagram did not confirm the published media.");
  const details = await requestJson<{ permalink?: unknown }>(fetchImpl, `${base}/${encodeURIComponent(mediaId)}?fields=permalink&access_token=${encodeURIComponent(input.accessToken)}`, {}, "Instagram permalink lookup").catch((): { permalink?: unknown } => ({}));
  return { state: "published", providerPostId: mediaId, externalUrl: stringValue(details.permalink) };
}

async function publishFacebook(input: ProviderPublishInput, fetchImpl: Fetch): Promise<ProviderPublishResult> {
  if (input.settings.kind !== "facebook") throw new ProviderPublishError("Facebook settings are invalid.");
  const version = stringValue(input.providerMetadata.metaGraphVersion) ?? "v23.0";
  const base = `https://graph.facebook.com/${version}/${encodeURIComponent(input.providerAccountId)}`;
  if (input.settings.publishType === "reel") {
    if (!input.mediaUrl || input.mediaType !== "video") throw new ProviderPublishError("Facebook Reels require a video.");
    const started = await requestJson<{ video_id?: unknown; upload_url?: unknown }>(fetchImpl, `${base}/video_reels`, { method: "POST", body: graphForm({ access_token: input.accessToken, upload_phase: "start" }) }, "Facebook Reel preparation");
    const videoId = stringValue(started.video_id); const uploadUrl = stringValue(started.upload_url);
    if (!videoId || !uploadUrl) throw new ProviderPublishError("Facebook did not return a Reel upload session.");
    await requestJson(fetchImpl, uploadUrl, { method: "POST", headers: { Authorization: `OAuth ${input.accessToken}`, file_url: input.mediaUrl } }, "Facebook Reel upload");
    await requestJson(fetchImpl, `${base}/video_reels`, { method: "POST", body: graphForm({ access_token: input.accessToken, upload_phase: "finish", video_id: videoId, video_state: "PUBLISHED", description: input.text }) }, "Facebook Reel publishing");
    return { state: "published", providerPostId: videoId, externalUrl: `https://www.facebook.com/reel/${encodeURIComponent(videoId)}` };
  }
  const carouselUrls = input.mediaType === "image" && (input.mediaUrls?.length ?? 0) > 1 ? input.mediaUrls! : [];
  if (carouselUrls.length) {
    const mediaIds: string[] = [];
    for (const imageUrl of carouselUrls) {
      const uploaded = await requestJson<{ id?: unknown }>(fetchImpl, `${base}/photos`, { method: "POST", body: graphForm({ access_token: input.accessToken, url: imageUrl, published: false }) }, "Facebook slideshow image preparation");
      const mediaId = stringValue(uploaded.id);
      if (!mediaId) throw new ProviderPublishError("Facebook did not return an uploaded photo id.");
      mediaIds.push(mediaId);
    }
    const published = await requestJson<{ id?: unknown; post_id?: unknown }>(fetchImpl, `${base}/feed`, { method: "POST", body: graphForm({ access_token: input.accessToken, message: input.text, attached_media: JSON.stringify(mediaIds.map((media_fbid) => ({ media_fbid }))) }) }, "Facebook slideshow publishing");
    const postId = stringValue(published.post_id) ?? stringValue(published.id);
    if (!postId) throw new ProviderPublishError("Facebook did not confirm the published slideshow.");
    return { state: "published", providerPostId: postId, externalUrl: `https://www.facebook.com/${encodeURIComponent(postId)}` };
  }
  const path = input.mediaType === "image" ? "photos" : input.mediaType === "video" ? "videos" : "feed";
  const payload = await requestJson<{ id?: unknown; post_id?: unknown }>(fetchImpl, `${base}/${path}`, { method: "POST", body: graphForm({ access_token: input.accessToken, message: input.mediaType === "none" ? input.text : undefined, link: input.mediaType === "none" ? input.settings.linkUrl : undefined, url: input.mediaType === "image" ? input.mediaUrl : undefined, caption: input.mediaType === "image" ? input.text : undefined, file_url: input.mediaType === "video" ? input.mediaUrl : undefined, description: input.mediaType === "video" ? input.text : undefined, published: true }) }, "Facebook publishing");
  const postId = stringValue(payload.post_id) ?? stringValue(payload.id);
  if (!postId) throw new ProviderPublishError("Facebook did not confirm the published post.");
  return { state: "published", providerPostId: postId, externalUrl: `https://www.facebook.com/${encodeURIComponent(postId)}` };
}

async function tiktokCreator(input: ProviderPublishInput, fetchImpl: Fetch): Promise<{ privacy_level_options?: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean }> {
  const payload = await requestJson<{ data?: { privacy_level_options?: string[]; comment_disabled?: boolean; duet_disabled?: boolean; stitch_disabled?: boolean } }>(fetchImpl, "https://open.tiktokapis.com/v2/post/publish/creator_info/query/", { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8" } }, "TikTok creator permissions");
  return payload.data ?? {};
}

const tiktokMaxSingleChunk = 64 * 1024 * 1024;
const tiktokChunkSize = 10 * 1024 * 1024;

function tiktokChunkPlan(videoSize: number): { chunkSize: number; totalChunkCount: number } {
  if (videoSize <= tiktokMaxSingleChunk) return { chunkSize: videoSize, totalChunkCount: 1 };
  return { chunkSize: tiktokChunkSize, totalChunkCount: Math.floor(videoSize / tiktokChunkSize) };
}

async function tiktokVideoSize(mediaUrl: string, fetchImpl: Fetch): Promise<number> {
  let response: Response;
  try { response = await fetchImpl(mediaUrl, { method: "HEAD", headers: { "Accept-Encoding": "identity" } }); }
  catch { throw new ProviderPublishError("Relay could not inspect the TikTok video in media storage.", true); }
  const size = Number(response.headers.get("content-length"));
  if (!response.ok || !Number.isSafeInteger(size) || size <= 0) throw new ProviderPublishError(`Relay could not determine the TikTok video size (HTTP ${response.status}).`, response.status >= 500);
  return size;
}

async function uploadTikTokVideo(uploadUrl: string, mediaUrl: string, videoSize: number, fetchImpl: Fetch): Promise<void> {
  const { chunkSize, totalChunkCount } = tiktokChunkPlan(videoSize);
  for (let index = 0; index < totalChunkCount; index += 1) {
    const start = index * chunkSize;
    const end = index === totalChunkCount - 1 ? videoSize - 1 : start + chunkSize - 1;
    let media: Response;
    try { media = await fetchImpl(mediaUrl, { headers: { Range: `bytes=${start}-${end}`, "Accept-Encoding": "identity" } }); }
    catch { throw new ProviderPublishError("Relay could not read the TikTok video from media storage.", true); }
    if (media.status !== 206 || !media.body) throw new ProviderPublishError("Media storage could not provide the byte range required by TikTok.");
    let uploaded: Response;
    try {
      uploaded = await fetchImpl(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": media.headers.get("content-type") || "video/mp4", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${videoSize}` },
        body: media.body,
        duplex: "half",
      } as RequestInit & { duplex: "half" });
    } catch {
      // TikTok may have received the bytes despite a broken response. The status
      // endpoint is authoritative, so do not re-init and risk a duplicate post.
      return;
    }
    if (![200, 201, 206].includes(uploaded.status)) {
      const detail = await uploaded.text().catch(() => "");
      throw new ProviderPublishError(`TikTok rejected the video upload${detail ? `: ${detail.slice(0, 300)}` : ` (HTTP ${uploaded.status})`}.`, uploaded.status >= 500);
    }
  }
}

async function publishTikTok(input: ProviderPublishInput, fetchImpl: Fetch): Promise<ProviderPublishResult> {
  if (input.settings.kind !== "tiktok") throw new ProviderPublishError("TikTok settings are invalid.");
  if (!input.mediaUrl || input.mediaType === "none") throw new ProviderPublishError("TikTok requires an image or video.");
  const creator = await tiktokCreator(input, fetchImpl);
  if (!creator.privacy_level_options?.includes(input.settings.privacyLevel)) throw new ProviderPublishError("The selected TikTok visibility is not available for this creator.");
  if (input.settings.allowComments && creator.comment_disabled) throw new ProviderPublishError("This TikTok creator has disabled comments.");
  if (input.mediaType === "video" && input.settings.allowDuet && creator.duet_disabled) throw new ProviderPublishError("This TikTok creator cannot enable Duet.");
  if (input.mediaType === "video" && input.settings.allowStitch && creator.stitch_disabled) throw new ProviderPublishError("This TikTok creator cannot enable Stitch.");
  const videoSize = input.mediaType === "video" ? await tiktokVideoSize(input.mediaUrl, fetchImpl) : undefined;
  const videoChunks = videoSize ? tiktokChunkPlan(videoSize) : undefined;
  const body = input.mediaType === "video" ? {
    post_info: { title: input.text, privacy_level: input.settings.privacyLevel, disable_comment: !input.settings.allowComments, disable_duet: !input.settings.allowDuet, disable_stitch: !input.settings.allowStitch, brand_content_toggle: false, brand_organic_toggle: false, is_aigc: false },
    source_info: { source: "FILE_UPLOAD", video_size: videoSize, chunk_size: videoChunks!.chunkSize, total_chunk_count: videoChunks!.totalChunkCount },
  } : {
    media_type: "PHOTO", post_mode: "DIRECT_POST",
    post_info: { title: input.text.slice(0, 90), description: input.text, privacy_level: input.settings.privacyLevel, disable_comment: !input.settings.allowComments, brand_content_toggle: false, brand_organic_toggle: false, auto_add_music: true },
    source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: input.mediaUrls?.length ? input.mediaUrls : [input.mediaUrl] },
  };
  const endpoint = input.mediaType === "video" ? "video/init" : "content/init";
  const payload = await requestJson<{ data?: { publish_id?: unknown; upload_url?: unknown } }>(fetchImpl, `https://open.tiktokapis.com/v2/post/publish/${endpoint}/`, { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) }, "TikTok publishing");
  const publishId = stringValue(payload.data?.publish_id);
  if (!publishId) throw new ProviderPublishError("TikTok did not return a publishing id.");
  if (input.mediaType === "video") {
    const uploadUrl = stringValue(payload.data?.upload_url);
    if (!uploadUrl) throw new ProviderPublishError("TikTok did not return a video upload URL.");
    await uploadTikTokVideo(uploadUrl, input.mediaUrl, videoSize!, fetchImpl);
  }
  return { state: "processing", providerPostId: publishId };
}

async function checkTikTok(input: ProviderPublishInput, fetchImpl: Fetch): Promise<ProviderPublishResult> {
  if (!input.providerPostId) throw new ProviderPublishError("TikTok publishing id is missing.");
  const payload = await requestJson<{ data?: { status?: unknown; fail_reason?: unknown; publicaly_available_post_id?: unknown[] } }>(fetchImpl, "https://open.tiktokapis.com/v2/post/publish/status/fetch/", { method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify({ publish_id: input.providerPostId }) }, "TikTok status check");
  const status = stringValue(payload.data?.status);
  if (status === "FAILED") throw new ProviderPublishError(`TikTok rejected the post${stringValue(payload.data?.fail_reason) ? `: ${stringValue(payload.data?.fail_reason)}` : ""}.`);
  if (status !== "PUBLISH_COMPLETE") return { state: "processing", providerPostId: input.providerPostId };
  const postId = stringValue(payload.data?.publicaly_available_post_id?.[0]);
  return { state: "published", providerPostId: postId ?? input.providerPostId };
}

async function publishYouTube(input: ProviderPublishInput, fetchImpl: Fetch): Promise<ProviderPublishResult> {
  if (input.settings.kind !== "youtube") throw new ProviderPublishError("YouTube settings are invalid.");
  if (!input.mediaUrl || input.mediaType !== "video") throw new ProviderPublishError("YouTube requires a video.");
  let media: Response;
  try { media = await fetchImpl(input.mediaUrl); } catch { throw new ProviderPublishError("Relay could not download the video from R2.", true); }
  if (!media.ok || !media.body) throw new ProviderPublishError(`Relay could not download the video from R2 (HTTP ${media.status}).`, media.status >= 500);
  const contentType = media.headers.get("content-type") || "video/mp4";
  const contentLength = media.headers.get("content-length");
  const initHeaders: Record<string, string> = { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": contentType };
  if (contentLength) initHeaders["X-Upload-Content-Length"] = contentLength;
  const session = await fetchImpl("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", { method: "POST", headers: initHeaders, body: JSON.stringify({ snippet: { title: input.settings.title, description: input.text, tags: input.settings.tags, categoryId: "22" }, status: { privacyStatus: input.settings.privacyStatus, selfDeclaredMadeForKids: input.settings.madeForKids } }) });
  if (!session.ok) {
    const detail = await session.json().catch(() => ({})) as { error?: { message?: string } };
    throw new ProviderPublishError(`YouTube upload preparation failed${detail.error?.message ? `: ${detail.error.message}` : ` (HTTP ${session.status})`}.`, session.status === 429 || session.status >= 500);
  }
  const uploadUrl = session.headers.get("location");
  if (!uploadUrl) throw new ProviderPublishError("YouTube did not return an upload session.");
  const uploadHeaders: Record<string, string> = { Authorization: `Bearer ${input.accessToken}`, "Content-Type": contentType };
  if (contentLength) uploadHeaders["Content-Length"] = contentLength;
  const uploaded = await fetchImpl(uploadUrl, { method: "PUT", headers: uploadHeaders, body: media.body, duplex: "half" } as RequestInit & { duplex: "half" });
  const result = await uploaded.json().catch(() => ({})) as { id?: unknown; error?: { message?: string } };
  if (!uploaded.ok) throw new ProviderPublishError(`YouTube upload failed${result.error?.message ? `: ${result.error.message}` : ` (HTTP ${uploaded.status})`}.`, uploaded.status === 429 || uploaded.status >= 500);
  const videoId = stringValue(result.id);
  if (!videoId) throw new ProviderPublishError("YouTube did not return a video id.");
  return { state: "published", providerPostId: videoId, externalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` };
}

export class ProviderPublishRegistry {
  constructor(private readonly fetchImpl: Fetch = fetch) {}
  publish(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    if (input.provider === "instagram") return publishInstagram(input, this.fetchImpl);
    if (input.provider === "facebook") return publishFacebook(input, this.fetchImpl);
    if (input.provider === "tiktok") return publishTikTok(input, this.fetchImpl);
    return publishYouTube(input, this.fetchImpl);
  }
  check(input: ProviderPublishInput): Promise<ProviderPublishResult> {
    if (input.provider === "tiktok") return checkTikTok(input, this.fetchImpl);
    throw new ProviderPublishError(`${input.provider} does not support asynchronous status checks.`);
  }
}
