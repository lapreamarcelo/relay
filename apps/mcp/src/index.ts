import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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

server.registerTool("list_media", {
  description: "List reusable visual media or music in Relay's Cloudflare R2 asset library, optionally from one named folder.",
  inputSchema: { limit: z.number().int().min(1).max(100).default(100), cursor: z.string().optional(), folderId: z.string().optional(), kind: z.enum(["media", "music"]).default("media") },
}, async ({ limit, cursor, folderId, kind }) => result(await relay(`/api/v1/media?${new URLSearchParams({ limit: String(limit), kind, ...(cursor ? { cursor } : {}), ...(folderId ? { project: folderId } : {}) })}`)));

server.registerTool("list_asset_folders", {
  description: "List named R2 folders available to agents, including whether each contains visual media or music.",
  inputSchema: { kind: z.enum(["media", "music"]).optional() },
}, async ({ kind }) => result(await relay(`/api/v1/media/projects${kind ? `?kind=${kind}` : ""}`)));

server.registerTool("create_asset_folder", {
  description: "Create a named visual-media or music folder in Relay's R2 library.",
  inputSchema: { name: z.string().min(1).max(100), kind: z.enum(["media", "music"]).default("media") },
}, async (input) => result(await relay("/api/v1/media/projects", { method: "POST", body: JSON.stringify(input) })));

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

server.registerTool("render_slideshow", {
  description: "Render a saved slideshow to ordered 1080x1920 JPEGs in a new R2 Media folder. Returns ordered renderedUrl values.",
  inputSchema: { id: z.string().min(1), slideIds: z.array(z.string()).optional() },
}, async (input) => result(await relay("/api/v1/slideshows/render", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("schedule_slideshow", {
  description: "Render a saved slideshow into an ordered Media folder and schedule or immediately publish it to Instagram, Facebook, and/or TikTok accounts.",
  inputSchema: {
    projectId: z.string().min(1), scheduledAt: z.string().datetime().nullable().describe("ISO time, or null to publish now"), clientRequestId: z.string().max(240).optional(),
    targets: z.array(slideshowTargetSchema).min(1).max(20),
  },
}, async ({ projectId, targets, scheduledAt, clientRequestId }) => {
  const rendered = await relay("/api/v1/slideshows/render", { method: "POST", body: JSON.stringify({ id: projectId }) }) as { data?: { brandId?: string; caption?: string; slides?: Array<{ renderedUrl?: string }> } };
  const urls = rendered.data?.slides?.map((slide) => slide.renderedUrl).filter((url): url is string => Boolean(url)) ?? [];
  if (!urls.length) throw new Error("Relay rendered no slideshow images.");
  return result(await relay("/api/v1/posts", { method: "POST", body: JSON.stringify({
    clientRequestId, brandId: rendered.data?.brandId || undefined, text: rendered.data?.caption || "", mediaType: "image", mediaUrl: urls[0], mediaUrls: urls,
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
    intervalMinutes: z.number().int().min(1).max(10080).default(1440),
    clientRequestId: z.string().max(190).optional(),
  },
}, async ({ projects, targets, scheduledAt, intervalMinutes, clientRequestId }) => {
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

server.registerTool("render_video", { description: "Render a saved video recipe to a versioned 1080x1920 MP4 in a new R2 Media folder.", inputSchema: { id: z.string().min(1) } }, async (input) => result(await relay("/api/v1/videos/render", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("schedule_video", {
  description: "Render a saved video into a new Media folder and schedule or immediately publish it to one or more connected accounts.",
  inputSchema: {
    projectId: z.string().min(1), scheduledAt: z.string().datetime().nullable().describe("ISO time, or null to publish now"), clientRequestId: z.string().max(240).optional(),
    targets: z.array(z.object({ accountId: z.string().min(1), settings: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("instagram"), publishType: z.enum(["feed", "reel"]).default("reel"), coverUrl: z.string().url().refine((value) => value.startsWith("https://"), "Cover URL must use HTTPS").optional(), thumbOffsetMs: z.number().int().min(0).max(900_000).optional() }),
      z.object({ kind: z.literal("facebook"), publishType: z.enum(["feed", "reel"]).default("reel"), linkUrl: z.string().url().optional() }),
      z.object({ kind: z.literal("youtube"), title: z.string().min(1).max(100), tags: z.array(z.string()).max(30).default([]), privacyStatus: z.enum(["private", "public", "unlisted"]).default("private"), madeForKids: z.boolean().default(false), thumbnailUrl: z.string().url().refine((value) => value.startsWith("https://"), "Thumbnail URL must use HTTPS").optional() }),
      z.object({ kind: z.literal("tiktok"), privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]).default("SELF_ONLY"), allowComments: z.boolean().default(true), allowDuet: z.boolean().default(false), allowStitch: z.boolean().default(false), thumbOffsetMs: z.number().int().min(0).max(900_000).optional() }),
    ]) })).min(1).max(20),
  },
}, async ({ projectId, targets, scheduledAt, clientRequestId }) => {
  const rendered = await relay("/api/v1/videos/render", { method: "POST", body: JSON.stringify({ id: projectId }) }) as { data?: { brandId?: string; caption?: string; name?: string; renderedUrl?: string; labels?: Array<{ text?: string }> } };
  const video = rendered.data;
  if (!video?.renderedUrl) throw new Error("Relay rendered no video.");
  return result(await relay("/api/v1/posts", { method: "POST", body: JSON.stringify({
    clientRequestId, brandId: video.brandId || undefined, text: video.caption || video.labels?.[0]?.text || video.name || "", mediaType: "video", mediaUrl: video.renderedUrl,
    status: scheduledAt === null ? "publishing" : "scheduled", scheduledAt: scheduledAt ?? undefined, targets,
  }) }));
});

server.registerTool("create_video_batch", {
  description: "Turn a list of hooks into rendered videos in one new Media folder and optionally schedule each one to several accounts. Music can be fixed, rotated in folder order, random from a folder, or omitted.",
  inputSchema: { projectId: z.string().min(1), hooks: z.array(z.string().min(1).max(500)).min(1).max(20), musicMode: z.enum(["none", "fixed", "rotate", "random"]).default("none"), musicFolderId: z.string().optional(), musicUrl: z.string().url().optional(), accountIds: z.array(z.string()).max(12).default([]), scheduledAt: z.string().datetime().nullable().default(null), intervalMinutes: z.number().int().min(1).max(10080).default(1440), captionTemplate: z.string().max(2200).default("{hook}"), clientRequestId: z.string().max(190).optional() },
}, async (input) => result(await relay("/api/v1/videos/batch", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("analytics_report", {
  description: "Get historical, period-over-period Relay analytics with filters, time series, and content ranking.",
  inputSchema: { from: z.string().datetime(), to: z.string().datetime(), brandId: z.string().optional(), accountId: z.string().optional(), campaignId: z.string().optional(), provider: z.enum(["instagram", "facebook", "tiktok", "youtube"]).optional(), mediaType: z.enum(["image", "video", "none"]).optional() },
}, async (input) => result(await relay(`/api/v1/analytics?${new URLSearchParams(Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string")))}`)));

server.registerTool("schedule_analytics_report", {
  description: "Schedule a weekly or monthly historical analytics report. Relay delivers it as an in-app notification with a downloadable CSV link.",
  inputSchema: {
    name: z.string().min(1).max(120), cadence: z.enum(["weekly", "monthly"]), days: z.number().int().min(1).max(366).optional(),
    brandId: z.string().optional(), accountId: z.string().optional(), campaignId: z.string().optional(), provider: z.enum(["instagram", "facebook", "tiktok", "youtube"]).optional(), mediaType: z.enum(["image", "video", "none"]).optional(),
  },
}, async ({ name, cadence, ...filters }) => result(await relay("/api/v1/analytics/reports", { method: "POST", body: JSON.stringify({ name, cadence, filters }) })));

await server.connect(new StdioServerTransport());
