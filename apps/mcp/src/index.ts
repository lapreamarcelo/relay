import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { z } from "zod/v4";

const relayUrl = process.env.RELAY_URL?.trim().replace(/\/$/, "");
const apiKey = process.env.RELAY_API_KEY?.trim();
if (!relayUrl || !apiKey) throw new Error("RELAY_URL and RELAY_API_KEY are required.");

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

server.registerTool("upload_media", {
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

const videoSchema = z.object({
  id: z.string().optional(), name: z.string().min(1).max(120), brandId: z.string().optional(), caption: z.string().max(2200).optional(), sourceUrl: z.string().url().optional(), sourceFolderId: z.string().optional(), musicUrl: z.string().url().optional(), musicFolderId: z.string().optional(), labels: z.array(creativeLabelSchema).max(12),
});

server.registerTool("list_videos", { description: "List reusable video-label recipes or retrieve one by id.", inputSchema: { id: z.string().optional() } }, async ({ id }) => result(await relay(`/api/v1/videos${id ? `?id=${encodeURIComponent(id)}` : ""}`)));

server.registerTool("save_video", { description: "Create or update a reusable video recipe with draggable labels and optional R2 music.", inputSchema: videoSchema.shape }, async (video) => result(await relay("/api/v1/videos", { method: video.id ? "PATCH" : "POST", body: JSON.stringify(video) })));

server.registerTool("delete_video", {
  description: "Permanently delete a saved Relay video project.",
  inputSchema: { id: z.string().min(1), confirmDelete: z.literal(true) },
}, async ({ id }) => result(await relay("/api/v1/videos", { method: "DELETE", body: JSON.stringify({ id }) })));

server.registerTool("render_video", { description: "Render a saved video recipe to a versioned 1080x1920 MP4 in a new R2 Media folder.", inputSchema: { id: z.string().min(1) } }, async (input) => result(await relay("/api/v1/videos/render", { method: "POST", body: JSON.stringify(input) })));

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

await server.connect(new StdioServerTransport());
