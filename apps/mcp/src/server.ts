import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { z } from "zod/v4";

export function createRelayMcpServer(relayUrl: string, apiKey: string, remote = false) {
async function relay(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${relayUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", ...init.headers },
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || `Relay returned HTTP ${response.status}.`);
  return payload;
}

const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value && typeof value === "object" ? value as Record<string, unknown> : { value },
});

const contentTypes: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".avif": "image/avif",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac",
};

function contentTypeFor(path: string, explicit?: string): string {
  const contentType = explicit?.trim().toLowerCase() || contentTypes[extname(path).toLowerCase()];
  if (!contentType) throw new Error("Could not infer the file content type; provide contentType.");
  return contentType;
}

const providerSettingsSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("instagram"), publishType: z.enum(["feed", "reel", "story"]), coverUrl: z.string().url().optional(), thumbOffsetMs: z.number().int().min(0).max(900_000).optional() }),
  z.object({ kind: z.literal("facebook"), publishType: z.enum(["feed", "reel"]), linkUrl: z.string().url().optional() }),
  z.object({ kind: z.literal("tiktok"), privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]), allowComments: z.boolean(), allowDuet: z.boolean(), allowStitch: z.boolean(), thumbOffsetMs: z.number().int().min(0).max(900_000).optional() }),
  z.object({ kind: z.literal("youtube"), title: z.string().min(1).max(100), tags: z.array(z.string().max(100)).max(50), privacyStatus: z.enum(["private", "unlisted", "public"]), madeForKids: z.boolean(), thumbnailUrl: z.string().url().optional() }),
]);

const postTargetSchema = z.object({
  accountId: z.string().min(1),
  settings: providerSettingsSchema,
  textOverride: z.string().max(63_206).optional(),
});

const postFields = {
  clientRequestId: z.string().min(1).max(240).optional(),
  brandId: z.string().max(240).optional(),
  campaignId: z.string().max(240).optional(),
  text: z.string().max(63_206).default(""),
  mediaType: z.enum(["none", "image", "video"]).default("none"),
  mediaUrl: z.string().url().optional(),
  mediaUrls: z.array(z.string().url()).max(35).optional(),
  status: z.enum(["draft", "scheduled"]).default("draft"),
  scheduledAt: z.string().datetime().optional(),
  targets: z.array(postTargetSchema).min(1).max(20),
};

const slideSchema = z.object({
  id: z.string().min(1).max(120).optional(),
  mediaUrl: z.string().url().describe("Public URL returned by Relay's media library"),
  text: z.string().max(500).optional().describe("Optional visible title for this slide; omit it for an image-only slide"),
  fit: z.enum(["cover", "contain"]).default("cover"),
  textPosition: z.enum(["top", "center", "bottom"]).default("bottom"),
  textX: z.number().min(.08).max(.92).default(.5).describe("Horizontal label center as a 0-1 canvas fraction"),
  textY: z.number().min(.06).max(.94).default(.78).describe("Vertical label center as a 0-1 canvas fraction"),
  textWidth: z.number().min(.25).max(.92).default(.87).describe("Label width as a 0-1 canvas fraction"),
  textHeight: z.number().min(.06).max(.35).default(.12).describe("Label height as a 0-1 canvas fraction"),
  textSize: z.number().int().min(28).max(160).default(64),
  textFont: z.enum(["modern", "editorial", "mono"]).default("modern"),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#FFFFFF"),
  textBackground: z.enum(["none", "dark", "light"]).default("dark"),
  textBackgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#000000"),
});

const projectSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  brandId: z.string().optional(),
  caption: z.string().max(2200).optional(),
  slides: z.array(slideSchema).max(35),
});

const slideshowTargetSchema = z.object({ accountId: z.string().min(1), settings: z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("instagram"), publishType: z.literal("feed") }),
  z.object({ kind: z.literal("facebook"), publishType: z.literal("feed"), linkUrl: z.string().url().optional() }),
  z.object({ kind: z.literal("tiktok"), privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]).default("SELF_ONLY"), allowComments: z.boolean().default(true), allowDuet: z.boolean().default(false), allowStitch: z.boolean().default(false) }),
]) });

const server = new McpServer({ name: "relay", version: "0.1.0" });

server.registerTool("list_destinations", { description: "List Relay's connected social accounts and their ids." }, async () => result(await relay("/api/v1/accounts")));

server.registerTool(
  "list_posts",
  {
    description:
      "List Relay posts, including drafts, scheduled posts, published posts, media types, dates, and destinations.",
    inputSchema: {
      status: z.enum(["draft", "scheduled", "publishing", "processing", "published", "failed"]).optional(),
      mediaType: z.enum(["none", "image", "video"]).optional(),
      accountId: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    },
  },
  async (input) => result(await relay(`/api/v1/posts?${new URLSearchParams(Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string")))}`)),
);

server.registerTool("create_post", {
  description: "Create a Relay draft or scheduled post. Use publish_post_now separately for immediate external publishing.",
  inputSchema: postFields,
}, async (input) => result(await relay("/api/v1/posts", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("create_posts", {
  description: "Bulk-create up to 100 Relay draft or scheduled posts.",
  inputSchema: { posts: z.array(z.object(postFields)).min(1).max(100) },
}, async (input) => result(await relay("/api/v1/posts", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("update_post", {
  description: "Replace the editable content, destinations, and draft or scheduled state of an existing post.",
  inputSchema: { id: z.string().min(1), ...postFields },
}, async (input) => result(await relay("/api/v1/posts", { method: "PATCH", body: JSON.stringify(input) })));

server.registerTool("reschedule_post", {
  description: "Reschedule an existing draft or scheduled post for a future ISO date.",
  inputSchema: { id: z.string().min(1), scheduledAt: z.string().datetime() },
}, async (input) => result(await relay("/api/v1/posts", { method: "PATCH", body: JSON.stringify(input) })));

server.registerTool("bulk_reschedule_posts", {
  description: "Reschedule up to 100 draft or scheduled posts, each to an explicit future ISO date.",
  inputSchema: { updates: z.array(z.object({ id: z.string().min(1), scheduledAt: z.string().datetime() })).min(1).max(100) },
}, async (input) => result(await relay("/api/v1/posts", { method: "PATCH", body: JSON.stringify(input) })));

server.registerTool("publish_post_now", {
  description: "Immediately hand an existing draft or scheduled post to its external publishing destinations.",
  inputSchema: { id: z.string().min(1), publishNow: z.literal(true) },
}, async ({ id }) => result(await relay("/api/v1/posts", { method: "PATCH", body: JSON.stringify({ id, scheduledAt: null }) })));

server.registerTool("retry_failed_targets", {
  description: "Immediately retry selected failed destination targets for one Relay post.",
  inputSchema: { id: z.string().min(1), targetIds: z.array(z.string().min(1)).min(1).max(20), retryNow: z.literal(true) },
}, async ({ id, targetIds }) => result(await relay("/api/v1/posts", { method: "PATCH", body: JSON.stringify({ id, retryTargetIds: targetIds }) })));

server.registerTool("assign_posts_to_campaign", {
  description: "Assign up to 100 posts to one campaign, or pass null to remove their campaign assignment.",
  inputSchema: { ids: z.array(z.string().min(1)).min(1).max(100), campaignId: z.string().min(1).nullable() },
}, async (input) => result(await relay("/api/v1/posts", { method: "PATCH", body: JSON.stringify(input) })));

server.registerTool("delete_posts", {
  description: "Permanently delete up to 100 posts that have not entered provider publishing or processing.",
  inputSchema: { ids: z.array(z.string().min(1)).min(1).max(100), confirmDelete: z.literal(true) },
}, async ({ ids }) => result(await relay("/api/v1/posts", { method: "DELETE", body: JSON.stringify({ ids }) })));

server.registerTool("delete_post", {
  description: "Permanently delete one post that has not entered provider publishing or processing.",
  inputSchema: { id: z.string().min(1), confirmDelete: z.literal(true) },
}, async ({ id }) => result(await relay("/api/v1/posts", { method: "DELETE", body: JSON.stringify({ id }) })));

server.registerTool("list_media", {
  description: "List reusable visual media or music in Relay's Cloudflare R2 asset library, optionally from one named folder.",
  inputSchema: { limit: z.number().int().min(1).max(100).default(100), cursor: z.string().optional(), folderId: z.string().optional(), kind: z.enum(["media", "music"]).default("media"), mediaType: z.enum(["image", "video"]).optional() },
}, async ({ limit, cursor, folderId, kind, mediaType }) => result(await relay(`/api/v1/media?${new URLSearchParams({ limit: String(limit), kind, ...(cursor ? { cursor } : {}), ...(folderId ? { project: folderId } : {}), ...(mediaType ? { mediaType } : {}) })}`)));

if (!remote) server.registerTool("upload_media", {
  description: "Upload one local image, video, or music file to Relay using a short-lived signed storage URL.",
  inputSchema: { filePath: z.string().min(1), folderId: z.string().optional(), kind: z.enum(["media", "music"]).default("media"), contentType: z.string().min(1).optional() },
}, async ({ filePath, folderId, kind, contentType: explicitContentType }) => {
  const path = resolve(filePath); const details = await stat(path);
  if (!details.isFile()) throw new Error("filePath must point to a regular file.");
  const contentType = contentTypeFor(path, explicitContentType);
  const prepared = await relay("/api/v1/media", { method: "POST", body: JSON.stringify({ fileName: basename(path), contentType, projectId: folderId, kind }) }) as { uploadUrl?: string; key?: string; url?: string };
  if (!prepared.uploadUrl) throw new Error("Relay did not return a direct upload URL.");
  const response = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": contentType, "Content-Length": String(details.size) }, body: createReadStream(path), duplex: "half" } as unknown as RequestInit);
  if (!response.ok) throw new Error(`R2 upload returned HTTP ${response.status}.`);
  return result({ data: { key: prepared.key, url: prepared.url, name: basename(path), size: details.size, kind, folderId: folderId ?? null } });
});

server.registerTool("rename_media", {
  description: "Rename one Relay media object; Relay updates owned references to its new public URL.",
  inputSchema: { key: z.string().min(1), name: z.string().min(1), kind: z.enum(["media", "music"]).optional() },
}, async (input) => result(await relay("/api/v1/media", { method: "PATCH", body: JSON.stringify(input) })));

server.registerTool("move_media", {
  description: "Move one Relay media object to a destination folder or to unfiled storage; Relay updates owned references.",
  inputSchema: { key: z.string().min(1), folderId: z.string().min(1), kind: z.enum(["media", "music"]) },
}, async ({ key, folderId, kind }) => result(await relay("/api/v1/media", { method: "PATCH", body: JSON.stringify({ key, projectId: folderId, kind }) })));

server.registerTool("delete_media", {
  description: "Permanently delete one Relay media object.",
  inputSchema: { key: z.string().min(1), confirmDelete: z.literal(true) },
}, async ({ key }) => result(await relay("/api/v1/media", { method: "DELETE", body: JSON.stringify({ key }) })));

server.registerTool("list_asset_folders", {
  description: "List named R2 folders available to agents, including whether each contains visual media or music.",
  inputSchema: { kind: z.enum(["media", "music"]).optional() },
}, async ({ kind }) => result(await relay(`/api/v1/media/projects${kind ? `?kind=${kind}` : ""}`)));

server.registerTool("create_asset_folder", {
  description: "Create a named visual-media or music folder in Relay's R2 library.",
  inputSchema: { name: z.string().min(1).max(100), kind: z.enum(["media", "music"]).default("media") },
}, async (input) => result(await relay("/api/v1/media/projects", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("rename_asset_folder", {
  description: "Rename a Relay asset folder without changing its stable id or contained media URLs.",
  inputSchema: { id: z.string().uuid(), name: z.string().min(1).max(100) },
}, async (input) => result(await relay("/api/v1/media/projects", { method: "PATCH", body: JSON.stringify(input) })));

server.registerTool("delete_asset_folder", {
  description: "Permanently delete a Relay asset folder and all media it contains.",
  inputSchema: {
    id: z.string().uuid(),
    deleteContents: z.literal(true).describe("Must be true to confirm permanent deletion of every asset in the folder"),
  },
}, async (input) => result(await relay("/api/v1/media/projects", { method: "DELETE", body: JSON.stringify(input) })));

server.registerTool("get_media_source_status", {
  description: "Check whether Relay's external stock-media source is configured.",
}, async () => result(await relay("/api/v1/media/sources")));

server.registerTool("search_stock_media", {
  description: "Search Relay's configured Pexels source for portrait-oriented images.",
  inputSchema: { query: z.string().min(1).max(100), page: z.number().int().min(1).max(80).default(1) },
}, async ({ query, page }) => result(await relay("/api/v1/media/sources", { method: "POST", body: JSON.stringify({ provider: "pexels", query, page }) })));

server.registerTool("import_stock_media", {
  description: "Import one selected Pexels image into a Relay folder or unfiled Media with source attribution.",
  inputSchema: { id: z.string().min(1), url: z.string().url(), sourceUrl: z.string().url().optional(), creator: z.string().max(200).optional(), attribution: z.string().max(500).optional(), folderId: z.string().optional() },
}, async ({ folderId, ...input }) => {
  const staged = await relay("/api/v1/media/import", { method: "POST", body: JSON.stringify({ provider: "pexels", ...input }) }) as { key?: string };
  if (!staged.key) throw new Error("Relay imported no staged media object.");
  return result(await relay("/api/v1/media", { method: "PATCH", body: JSON.stringify({ key: staged.key, kind: "media", projectId: folderId ?? "unfiled", commit: true }) }));
});

server.registerTool("list_slideshows", {
  description: "List saved reusable slideshow projects, or retrieve one project by id.",
  inputSchema: { id: z.string().optional() },
}, async ({ id }) => result(await relay(`/api/v1/slideshows${id ? `?id=${encodeURIComponent(id)}` : ""}`)));

server.registerTool("save_slideshow", {
  description: "Create or update a reusable slideshow. Each image may have its own optional visible text.",
  inputSchema: projectSchema.shape,
}, async (project) => result(await relay("/api/v1/slideshows", { method: project.id ? "PATCH" : "POST", body: JSON.stringify(project) })));

server.registerTool("create_slideshows", {
  description: "Bulk-create up to 50 slideshow project variants.",
  inputSchema: { projects: z.array(projectSchema.omit({ id: true })).min(1).max(50) },
}, async ({ projects }) => result(await relay("/api/v1/slideshows", { method: "POST", body: JSON.stringify({ projects }) })));

server.registerTool("delete_slideshow", {
  description: "Permanently delete a saved Relay slideshow project.",
  inputSchema: { id: z.string().min(1) },
}, async ({ id }) => result(await relay("/api/v1/slideshows", { method: "DELETE", body: JSON.stringify({ id }) })));

server.registerTool("render_slideshow", {
  description: "Render a saved slideshow to ordered 1080x1920 JPEGs in a new R2 Media folder. Returns ordered renderedUrl values.",
  inputSchema: { id: z.string().min(1), slideIds: z.array(z.string()).optional() },
}, async (input) => result(await relay("/api/v1/slideshows/render", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("schedule_slideshow", {
  description: "Render a saved slideshow into an ordered Media folder and schedule or immediately publish it to Instagram, Facebook, and/or TikTok accounts.",
  inputSchema: {
    projectId: z.string().min(1), scheduledAt: z.string().datetime().nullable().describe("ISO time, or null to publish now"), publishNow: z.literal(true).optional(), clientRequestId: z.string().max(240).optional(), campaignId: z.string().optional(), text: z.string().max(63_206).optional(),
    targets: z.array(slideshowTargetSchema).min(1).max(20),
  },
}, async ({ projectId, targets, scheduledAt, publishNow, clientRequestId, campaignId, text }) => {
  if (scheduledAt === null && publishNow !== true) throw new Error("Set publishNow to true to confirm immediate external publishing.");
  const rendered = await relay("/api/v1/slideshows/render", { method: "POST", body: JSON.stringify({ id: projectId }) }) as { data?: { brandId?: string; caption?: string; slides?: Array<{ renderedUrl?: string }> } };
  const urls = rendered.data?.slides?.map((slide) => slide.renderedUrl).filter((url): url is string => Boolean(url)) ?? [];
  if (!urls.length) throw new Error("Relay rendered no slideshow images.");
  return result(await relay("/api/v1/posts", { method: "POST", body: JSON.stringify({
    clientRequestId, brandId: rendered.data?.brandId || undefined, campaignId, text: text ?? rendered.data?.caption ?? "", mediaType: "image", mediaUrl: urls[0], mediaUrls: urls,
    status: scheduledAt === null ? "publishing" : "scheduled", scheduledAt: scheduledAt ?? undefined,
    targets,
  }) }));
});

server.registerTool("create_slideshow_batch", {
  description: "Bulk-create and render slideshow variants into separate ordered Media folders, then optionally schedule each variant to the same connected accounts.",
  inputSchema: {
    projects: z.array(projectSchema.omit({ id: true })).min(1).max(20),
    targets: z.array(slideshowTargetSchema).max(20).default([]),
    scheduledAt: z.string().datetime().nullable().default(null).describe("First ISO time; null publishes immediately when targets are supplied"),
    publishNow: z.literal(true).optional(),
    intervalMinutes: z.number().int().min(1).max(10080).default(1440),
    clientRequestId: z.string().max(190).optional(),
  },
}, async ({ projects, targets, scheduledAt, publishNow, intervalMinutes, clientRequestId }) => {
  if (targets.length && scheduledAt === null && publishNow !== true) throw new Error("Set publishNow to true to confirm immediate external publishing.");
  const created = await relay("/api/v1/slideshows", { method: "POST", body: JSON.stringify({ projects }) }) as { data?: Array<{ index: number; data?: { id: string; brandId?: string; caption?: string; name?: string }; error?: string }> };
  const results: Array<Record<string, unknown>> = [];
  for (const entry of created.data ?? []) {
    if (!entry.data?.id) { results.push({ index: entry.index, status: "failed", error: entry.error || "Could not create slideshow." }); continue; }
    try {
      const rendered = await relay("/api/v1/slideshows/render", { method: "POST", body: JSON.stringify({ id: entry.data.id }) }) as { data?: { brandId?: string; caption?: string; slides?: Array<{ renderedUrl?: string }> }; folder?: unknown };
      const urls = rendered.data?.slides?.map((slide) => slide.renderedUrl).filter((url): url is string => Boolean(url)) ?? [];
      if (!urls.length) throw new Error("Relay rendered no slideshow images.");
      let post: unknown = null;
      if (targets.length) {
        const time = scheduledAt ? new Date(new Date(scheduledAt).getTime() + entry.index * intervalMinutes * 60_000).toISOString() : null;
        post = await relay("/api/v1/posts", { method: "POST", body: JSON.stringify({ clientRequestId: `${clientRequestId || `slideshow-batch-${entry.data.id}`}-${entry.index}`, brandId: rendered.data?.brandId || undefined, text: rendered.data?.caption || "", mediaType: "image", mediaUrl: urls[0], mediaUrls: urls, status: time ? "scheduled" : "publishing", scheduledAt: time || undefined, targets }) });
      }
      results.push({ index: entry.index, projectId: entry.data.id, folder: rendered.folder, renderedUrls: urls, post, status: targets.length ? (scheduledAt ? "scheduled" : "publishing") : "rendered" });
    } catch (error) { results.push({ index: entry.index, projectId: entry.data.id, status: "failed", error: error instanceof Error ? error.message : "Could not finish slideshow." }); }
  }
  const failed = results.filter((entry) => entry.status === "failed").length;
  return result({ data: results, summary: { created: results.length - failed, failed } });
});

const creativeLabelSchema = z.object({
  id: z.string().optional(), text: z.string().min(1).max(500), x: z.number().min(.08).max(.92).default(.5), y: z.number().min(.06).max(.94).default(.18), width: z.number().min(.25).max(.92).default(.84), height: z.number().min(.06).max(.35).default(.12), fontSize: z.number().int().min(28).max(160).default(72), font: z.enum(["modern", "editorial", "mono"]).default("modern"),
  style: z.enum(["dark", "light", "outline"]).default("dark"), textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#FFFFFF"), background: z.enum(["dark", "light", "none"]).default("dark"), backgroundColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#000000"),
});

const timelineSchema = z.object({
  version: z.literal(1), aspectRatio: z.enum(["9:16", "4:5", "1:1", "16:9"]),
  clips: z.array(z.object({ id: z.string().optional(), sourceUrl: z.string().url(), name: z.string().max(120), kind: z.enum(["video", "image"]), inMs: z.number().min(0), outMs: z.number().min(100), sourceDurationMs: z.number().min(100).max(86400000).optional(), fit: z.enum(["cover", "contain"]).default("cover"), x: z.number().min(0).max(1).default(.5), y: z.number().min(0).max(1).default(.5), zoom: z.number().min(1).max(3).default(1), volume: z.number().min(0).max(1).default(1) })).max(50),
  labels: z.array(creativeLabelSchema.extend({startMs:z.number().min(0),endMs:z.number().min(100)})).max(200),
  music:z.object({url:z.string().default(""),volume:z.number().min(0).max(1).default(.8),offsetMs:z.number().min(0).default(0),fadeInMs:z.number().min(0).default(0),fadeOutMs:z.number().min(0).default(0)}),
  coverMs:z.number().min(0).default(0),
});

const videoSchema = z.object({
  timeline: timelineSchema.optional(), revision:z.number().int().positive().optional(), templateId:z.string().optional(),
  id: z.string().optional(), name: z.string().min(1).max(120), brandId: z.string().optional(), caption: z.string().max(2200).optional(), sourceUrl: z.string().url().optional(), sourceFolderId: z.string().optional(), musicUrl: z.string().url().optional(), musicFolderId: z.string().optional(), labels: z.array(creativeLabelSchema).max(12).default([]),
});

server.registerTool("list_videos", { description: "List reusable video-label recipes or retrieve one by id.", inputSchema: { id: z.string().optional() } }, async ({ id }) => result(await relay(`/api/v1/videos${id ? `?id=${encodeURIComponent(id)}` : ""}`)));

server.registerTool("save_video", { description: "Create or update a video. Supply timeline for multiple clips, trims, crops, timed text and audio. Pass the retrieved revision to detect conflicting saves.", inputSchema: videoSchema.shape }, async (video) => result(await relay("/api/v1/videos", { method: video.id ? "PATCH" : "POST", body: JSON.stringify(video) })));

server.registerTool("delete_video", {
  description: "Permanently delete a saved Relay video project.",
  inputSchema: { id: z.string().min(1), confirmDelete: z.literal(true) },
}, async ({ id }) => result(await relay("/api/v1/videos", { method: "DELETE", body: JSON.stringify({ id }) })));

server.registerTool("render_video", { description: "Render a saved video. Use async=true to return a durable job; poll get_video_render_job until completed, then use renderedUrl to create a post.", inputSchema: { id: z.string().min(1), async:z.boolean().optional() } }, async (input) => result(await relay("/api/v1/videos/render", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("schedule_video", {
  description: "Render a saved video into a new Media folder and schedule or immediately publish it to one or more connected accounts.",
  inputSchema: {
    projectId: z.string().min(1), scheduledAt: z.string().datetime().nullable().describe("ISO time, or null to publish now"), publishNow: z.literal(true).optional(), clientRequestId: z.string().max(240).optional(), campaignId: z.string().optional(), text: z.string().max(63_206).optional(),
    targets: z.array(z.object({ accountId: z.string().min(1), settings: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("instagram"), publishType: z.enum(["feed", "reel"]).default("reel"), coverUrl: z.string().url().refine((value) => value.startsWith("https://"), "Cover URL must use HTTPS").optional(), thumbOffsetMs: z.number().int().min(0).max(900_000).optional() }),
      z.object({ kind: z.literal("facebook"), publishType: z.enum(["feed", "reel"]).default("reel"), linkUrl: z.string().url().optional() }),
      z.object({ kind: z.literal("youtube"), title: z.string().min(1).max(100), tags: z.array(z.string()).max(30).default([]), privacyStatus: z.enum(["private", "public", "unlisted"]).default("private"), madeForKids: z.boolean().default(false), thumbnailUrl: z.string().url().refine((value) => value.startsWith("https://"), "Thumbnail URL must use HTTPS").optional() }),
      z.object({ kind: z.literal("tiktok"), privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]).default("SELF_ONLY"), allowComments: z.boolean().default(true), allowDuet: z.boolean().default(false), allowStitch: z.boolean().default(false), thumbOffsetMs: z.number().int().min(0).max(900_000).optional() }),
    ]) })).min(1).max(20),
  },
}, async ({ projectId, targets, scheduledAt, publishNow, clientRequestId, campaignId, text }) => {
  if (scheduledAt === null && publishNow !== true) throw new Error("Set publishNow to true to confirm immediate external publishing.");
  const rendered = await relay("/api/v1/videos/render", { method: "POST", body: JSON.stringify({ id: projectId }) }) as { data?: { brandId?: string; caption?: string; name?: string; renderedUrl?: string; labels?: Array<{ text?: string }> } };
  const video = rendered.data;
  if (!video?.renderedUrl) throw new Error("Relay rendered no video.");
  return result(await relay("/api/v1/posts", { method: "POST", body: JSON.stringify({
    clientRequestId, brandId: video.brandId || undefined, campaignId, text: text ?? video.caption ?? video.labels?.[0]?.text ?? video.name ?? "", mediaType: "video", mediaUrl: video.renderedUrl,
    status: scheduledAt === null ? "publishing" : "scheduled", scheduledAt: scheduledAt ?? undefined, targets,
  }) }));
});

server.registerTool("create_video_batch", {
  description: "Turn a list of hooks into rendered videos in one new Media folder and optionally schedule each one to several accounts. Music can be fixed, rotated in folder order, random from a folder, or omitted.",
  inputSchema: { projectId: z.string().min(1), hooks: z.array(z.string().min(1).max(500)).min(1).max(20), musicMode: z.enum(["none", "fixed", "rotate", "random"]).default("none"), musicFolderId: z.string().optional(), musicUrl: z.string().url().optional(), accountIds: z.array(z.string()).max(12).default([]), scheduledAt: z.string().datetime().nullable().default(null), publishNow: z.literal(true).optional(), intervalMinutes: z.number().int().min(1).max(10080).default(1440), captionTemplate: z.string().max(2200).default("{hook}"), clientRequestId: z.string().max(190).optional() },
}, async ({ publishNow, ...input }) => {
  if (input.accountIds.length && input.scheduledAt === null && publishNow !== true) throw new Error("Set publishNow to true to confirm immediate external publishing.");
  return result(await relay("/api/v1/videos/batch", { method: "POST", body: JSON.stringify(input) }));
});

server.registerTool("analytics_report", {
  description: "Get historical, period-over-period Relay analytics with filters, time series, and content ranking.",
  inputSchema: { from: z.string().datetime(), to: z.string().datetime(), postId: z.string().optional(), brandId: z.string().optional(), accountId: z.string().optional(), campaignId: z.string().optional(), provider: z.enum(["instagram", "facebook", "tiktok", "youtube"]).optional(), mediaType: z.enum(["image", "video", "none"]).optional() },
}, async (input) => result(await relay(`/api/v1/analytics?${new URLSearchParams(Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string")))}`)));

server.registerTool("list_analytics_reports", {
  description: "List scheduled weekly and monthly Relay analytics reports.",
}, async () => result(await relay("/api/v1/analytics/reports")));

server.registerTool("schedule_analytics_report", {
  description: "Schedule a weekly or monthly historical analytics report. Relay delivers it as an in-app notification with a downloadable CSV link.",
  inputSchema: {
    name: z.string().min(1).max(120), cadence: z.enum(["weekly", "monthly"]), days: z.number().int().min(1).max(366).optional(),
    brandId: z.string().optional(), accountId: z.string().optional(), campaignId: z.string().optional(), provider: z.enum(["instagram", "facebook", "tiktok", "youtube"]).optional(), mediaType: z.enum(["image", "video", "none"]).optional(),
  },
}, async ({ name, cadence, ...filters }) => result(await relay("/api/v1/analytics/reports", { method: "POST", body: JSON.stringify({ name, cadence, filters }) })));

server.registerTool("delete_analytics_report", {
  description: "Permanently delete a scheduled Relay analytics report.",
  inputSchema: { id: z.string().min(1), confirmDelete: z.literal(true) },
}, async ({ id }) => result(await relay("/api/v1/analytics/reports", { method: "DELETE", body: JSON.stringify({ id }) })));

server.registerTool("list_brands", { description: "List Relay brands." }, async () => result(await relay("/api/v1/brands")));

const brandFields = { name: z.string().min(1).max(60), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), timezone: z.string().min(1), accountIds: z.array(z.string().min(1)).max(100).default([]) };
server.registerTool("create_brand", { description: "Create a Relay brand and optionally assign connected accounts.", inputSchema: brandFields }, async (input) => result(await relay("/api/v1/brands", { method: "POST", body: JSON.stringify(input) })));
server.registerTool("update_brand", { description: "Update a Relay brand and its connected-account assignments.", inputSchema: { id: z.string().min(1), ...brandFields } }, async (input) => result(await relay("/api/v1/brands", { method: "PATCH", body: JSON.stringify(input) })));
server.registerTool("delete_brand", { description: "Permanently delete a Relay brand.", inputSchema: { id: z.string().min(1), confirmDelete: z.literal(true) } }, async ({ id }) => result(await relay("/api/v1/brands", { method: "DELETE", body: JSON.stringify({ id }) })));

server.registerTool("list_campaigns", { description: "List Relay campaigns and their post counts." }, async () => result(await relay("/api/v1/campaigns")));
server.registerTool("create_campaign", { description: "Create a Relay campaign.", inputSchema: { name: z.string().min(1).max(120), brandId: z.string().optional(), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional() } }, async (input) => result(await relay("/api/v1/campaigns", { method: "POST", body: JSON.stringify(input) })));
server.registerTool("update_campaign", { description: "Update or archive a Relay campaign.", inputSchema: { id: z.string().min(1), name: z.string().min(1).max(120), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), status: z.enum(["active", "archived"]).default("active") } }, async (input) => result(await relay("/api/v1/campaigns", { method: "PATCH", body: JSON.stringify(input) })));
server.registerTool("delete_campaign", { description: "Permanently delete a Relay campaign.", inputSchema: { id: z.string().min(1), confirmDelete: z.literal(true) } }, async ({ id }) => result(await relay("/api/v1/campaigns", { method: "DELETE", body: JSON.stringify({ id }) })));

server.registerTool("list_templates", { description: "List reusable Relay post templates." }, async () => result(await relay("/api/v1/templates")));
server.registerTool("create_template", { description: "Create a reusable Relay post template.", inputSchema: { name: z.string().min(1).max(120), brandId: z.string().optional(), text: z.string().max(63_206).default(""), mediaType: z.enum(["none", "image", "video"]).default("none"), settings: z.record(z.string(), z.unknown()).default({}) } }, async (input) => result(await relay("/api/v1/templates", { method: "POST", body: JSON.stringify(input) })));
server.registerTool("delete_template", { description: "Permanently delete a Relay post template.", inputSchema: { id: z.string().min(1), confirmDelete: z.literal(true) } }, async ({ id }) => result(await relay("/api/v1/templates", { method: "DELETE", body: JSON.stringify({ id }) })));

server.registerTool("get_publishing_settings", { description: "Get Relay's saved publishing defaults." }, async () => result(await relay("/api/v1/settings/publishing")));
server.registerTool("update_publishing_settings", {
  description: "Replace Relay's publishing defaults for future workflows that omit explicit platform settings.",
  inputSchema: {
    instagram: z.object({ imagePublishType: z.enum(["feed", "story"]), videoPublishType: z.enum(["feed", "reel", "story"]) }),
    facebook: z.object({ videoPublishType: z.enum(["feed", "reel"]) }),
    tiktok: z.object({ privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]), allowComments: z.boolean(), allowDuet: z.boolean(), allowStitch: z.boolean() }),
    youtube: z.object({ privacyStatus: z.enum(["private", "unlisted", "public"]), madeForKids: z.boolean() }),
  },
}, async (input) => result(await relay("/api/v1/settings/publishing", { method: "PUT", body: JSON.stringify(input) })));

server.registerTool("get_provider_status", { description: "List Relay publishing providers and whether their OAuth configuration is available." }, async () => result(await relay("/api/v1/providers")));
server.registerTool("health_check", { description: "Check Relay web, database, and publishing-worker health.", inputSchema: { deep: z.boolean().default(true) } }, async ({ deep }) => result(await relay(`/health${deep ? "?deep=1" : ""}`)));
server.registerTool("list_notifications", { description: "List the latest Relay publishing and report notifications." }, async () => result(await relay("/api/v1/notifications")));
server.registerTool("mark_notifications_read", { description: "Mark selected Relay notifications as read, or all unread notifications when ids is omitted.", inputSchema: { ids: z.array(z.string().min(1)).max(100).optional() } }, async (input) => result(await relay("/api/v1/notifications", { method: "PATCH", body: JSON.stringify(input) })));

server.registerTool("list_video_render_jobs", {description:"List recent video render jobs and their status."}, async()=>result(await relay("/api/v1/videos/jobs")));
server.registerTool("get_video_render_job", {description:"Read render progress and immutable output URL.",inputSchema:{id:z.string().min(1)}}, async({id})=>result(await relay(`/api/v1/videos/jobs?id=${encodeURIComponent(id)}`)));
server.registerTool("update_video_render_job", {description:"Cancel pending/running rendering, or retry a failed/cancelled job.",inputSchema:{id:z.string().min(1),action:z.enum(["cancel","retry"])}}, async(input)=>result(await relay("/api/v1/videos/jobs",{method:"PATCH",body:JSON.stringify(input)})));
server.registerTool("list_video_templates", {description:"List saved editable compositions and eight starter template slot definitions."}, async()=>result(await relay("/api/v1/videos/templates")));
server.registerTool("save_video_template", {description:"Save a reusable editable timeline template.",inputSchema:{name:z.string().min(1).max(120),description:z.string().max(500).optional(),timeline:timelineSchema}}, async(input)=>result(await relay("/api/v1/videos/templates",{method:"POST",body:JSON.stringify(input)})));
server.registerTool("delete_video_template", {description:"Delete a saved video template. Existing projects remain unchanged.",inputSchema:{id:z.string().min(1),confirmDelete:z.literal(true)}}, async({id})=>result(await relay("/api/v1/videos/templates",{method:"DELETE",body:JSON.stringify({id})})));

server.registerTool("list_queues",{description:"List account queues, weekly slots, pause state and upcoming times."},async()=>result(await relay("/api/v1/queues")));
server.registerTool("save_queue",{description:"Set weekly posting slots and pause state. Pausing affects future dispatches; already dispatched posts continue.",inputSchema:{accountId:z.string().min(1),timezone:z.string(),paused:z.boolean(),slots:z.array(z.object({day:z.number().int().min(0).max(6),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),category:z.string().max(80).optional()})).max(50)}},async(input)=>result(await relay("/api/v1/queues",{method:"PUT",body:JSON.stringify(input)})));
server.registerTool("fill_queue",{description:"Preview or schedule single-account drafts into free weekly slots. preview defaults to true.",inputSchema:{accountId:z.string().min(1),postIds:z.array(z.string()).min(1).max(100),category:z.string().optional(),preview:z.boolean().default(true)}},async(input)=>result(await relay("/api/v1/queues",{method:"POST",body:JSON.stringify(input)})));
server.registerTool("operate_campaign",{description:"Pause/resume pending campaign publishing or shift its future schedule by elapsed minutes. Shift previews by default; DST may change local clock times.",inputSchema:{id:z.string().min(1),action:z.enum(["shift","pause","resume"]),minutes:z.number().int().optional(),preview:z.boolean().default(true)}},async(input)=>result(await relay("/api/v1/campaigns/operations",{method:"POST",body:JSON.stringify(input)})));
server.registerTool("list_ideas",{description:"List the content idea inbox."},async()=>result(await relay("/api/v1/ideas")));
server.registerTool("save_idea",{description:"Create or update an idea with notes, a source link and content pillar.",inputSchema:{id:z.string().optional(),title:z.string().min(1).max(200),notes:z.string().max(10000).optional(),sourceUrl:z.string().optional(),pillar:z.string().max(80).optional(),brandId:z.string().optional(),status:z.enum(["idea","planned","used","archived"]).default("idea")}},async(input)=>result(await relay("/api/v1/ideas",{method:input.id?"PATCH":"POST",body:JSON.stringify(input)})));
server.registerTool("delete_idea",{description:"Permanently delete an idea.",inputSchema:{id:z.string().min(1),confirmDelete:z.literal(true)}},async({id})=>result(await relay("/api/v1/ideas",{method:"DELETE",body:JSON.stringify({id})})));
server.registerTool("list_brand_kits",{description:"Read brand colors, text styles, logo URLs, voice and guidelines."},async()=>result(await relay("/api/v1/brands/kit")));
server.registerTool("save_brand_kit",{description:"Replace a brand's reusable creative and writing guidelines.",inputSchema:{id:z.string().min(1),kit:z.object({textColor:z.string().optional(),backgroundColor:z.string().optional(),font:z.enum(["modern","editorial","mono"]).optional(),logoUrl:z.string().optional(),voice:z.string().max(5000).optional(),guidelines:z.string().max(10000).optional(),defaultCta:z.string().max(500).optional()})}},async(input)=>result(await relay("/api/v1/brands/kit",{method:"PUT",body:JSON.stringify(input)})));
server.registerTool("get_capabilities",{description:"Discover API version, authenticated scopes and creative workflow limits."},async()=>result(await relay("/api/v1/capabilities")));
server.registerTool("prepare_media_upload",{description:"Get a signed upload URL. Upload bytes with HTTP PUT from the agent's environment, then use the returned media URL.",inputSchema:{fileName:z.string().min(1),contentType:z.string().min(1),kind:z.enum(["media","music"]).default("media"),projectId:z.string().optional()}},async(input)=>result(await relay("/api/v1/media",{method:"POST",body:JSON.stringify(input)})));

server.registerTool("generate_video_captions",{description:"Queue automatic transcription of a saved timeline through the workspace's configured OpenAI account. Poll the returned job and apply its editable captions through save_video.",inputSchema:{id:z.string().min(1)}},async(input)=>result(await relay("/api/v1/videos/captions",{method:"POST",body:JSON.stringify(input)})));
server.registerTool("create_video_variants",{description:"Create editable timeline hook variants with stable retry ids. Optionally enqueue rendering; does not publish.",inputSchema:{id:z.string().min(1),hooks:z.array(z.string().min(1).max(500)).min(1).max(20),clientRequestId:z.string().min(1).max(190),render:z.boolean().default(false)}},async(input)=>result(await relay("/api/v1/videos/variants",{method:"POST",body:JSON.stringify(input)})));
server.registerTool("creative_analytics",{description:"Compare template and hook results in a common post-age observation window, within each account/platform.",inputSchema:{hours:z.enum(["24","72","168"]).default("72"),brandId:z.string().optional()}},async({hours,brandId})=>result(await relay(`/api/v1/analytics/creative?hours=${hours}${brandId?`&brandId=${encodeURIComponent(brandId)}`:""}`)));
server.registerTool("posting_time_recommendations",{description:"Get account-specific posting-time observations when enough comparable history exists.",inputSchema:{accountId:z.string().min(1)}},async({accountId})=>result(await relay(`/api/v1/analytics/timing?accountId=${encodeURIComponent(accountId)}`)));
server.registerTool("assist_content",{description:"Draft hooks, captions or a five-post plan grounded in the brief, owned brand guidance and previous posts. Requires configured OpenAI credentials; returns draft text without publishing.",inputSchema:{action:z.enum(["hooks","caption","plan"]),brief:z.string().min(1).max(10000),brandId:z.string().optional()}},async(input)=>result(await relay("/api/v1/creative/assist",{method:"POST",body:JSON.stringify(input)})));
server.registerTool("list_campaign_recipes",{description:"List reusable launch, tutorial and weekly-content campaign plans."},async()=>result(await relay("/api/v1/campaigns/recipes")));
server.registerTool("save_campaign_recipe",{description:"Save a reusable campaign plan with relative day offsets and suggested formats.",inputSchema:{name:z.string().min(1).max(120),entries:z.array(z.object({title:z.string().min(1).max(120),text:z.string().min(1).max(2200),dayOffset:z.number().int().min(0).max(365),format:z.enum(["video","image","text"])})).min(1).max(30)}},async(input)=>result(await relay("/api/v1/campaigns/recipes",{method:"POST",body:JSON.stringify(input)})));
server.registerTool("apply_campaign_recipe",{description:"Create a campaign of draft briefs. Does not publish or schedule; media and destination review are still required.",inputSchema:{recipeId:z.string().min(1),accountIds:z.array(z.string()).min(1).max(12),clientRequestId:z.string().min(1).max(190),startAt:z.string().datetime().optional()}},async(input)=>result(await relay("/api/v1/campaigns/recipes",{method:"POST",body:JSON.stringify({...input,action:"apply"})})));
server.registerTool("delete_campaign_recipe",{description:"Delete a saved campaign recipe.",inputSchema:{id:z.string().min(1),confirmDelete:z.literal(true)}},async({id})=>result(await relay("/api/v1/campaigns/recipes",{method:"DELETE",body:JSON.stringify({id})})));
return server;
}

