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
  textSize: z.number().int().min(28).max(120).default(64),
  textColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#FFFFFF"),
  textBackground: z.enum(["none", "dark", "light"]).default("dark"),
});

const projectSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  brandId: z.string().optional(),
  caption: z.string().max(2200).optional(),
  slides: z.array(slideSchema).max(35),
});

const server = new McpServer({ name: "relay", version: "0.1.0" });

server.registerTool("list_destinations", { description: "List Relay's connected social accounts and their ids." }, async () => result(await relay("/api/v1/accounts")));

server.registerTool("list_media", {
  description: "List reusable media in Relay's Cloudflare R2 library. Use image URLs from this result in slideshow slides.",
  inputSchema: { limit: z.number().int().min(1).max(100).default(100), cursor: z.string().optional() },
}, async ({ limit, cursor }) => result(await relay(`/api/v1/media?${new URLSearchParams({ limit: String(limit), ...(cursor ? { cursor } : {}) })}`)));

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
  description: "Render a saved slideshow to independent 1080x1920 PNGs in R2. Returns ordered renderedUrl values.",
  inputSchema: { id: z.string().min(1), slideIds: z.array(z.string()).optional() },
}, async (input) => result(await relay("/api/v1/slideshows/render", { method: "POST", body: JSON.stringify(input) })));

server.registerTool("schedule_slideshow", {
  description: "Render a saved slideshow and schedule or immediately publish it to one connected TikTok account.",
  inputSchema: {
    projectId: z.string().min(1), accountId: z.string().min(1), scheduledAt: z.string().datetime().nullable().describe("ISO time, or null to publish now"),
    privacyLevel: z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]).default("SELF_ONLY"),
    allowComments: z.boolean().default(true), clientRequestId: z.string().max(240).optional(),
  },
}, async ({ projectId, accountId, scheduledAt, privacyLevel, allowComments, clientRequestId }) => {
  const rendered = await relay("/api/v1/slideshows/render", { method: "POST", body: JSON.stringify({ id: projectId }) }) as { data?: { brandId?: string; caption?: string; slides?: Array<{ renderedUrl?: string }> } };
  const urls = rendered.data?.slides?.map((slide) => slide.renderedUrl).filter((url): url is string => Boolean(url)) ?? [];
  if (!urls.length) throw new Error("Relay rendered no slideshow images.");
  return result(await relay("/api/v1/posts", { method: "POST", body: JSON.stringify({
    clientRequestId, brandId: rendered.data?.brandId || undefined, text: rendered.data?.caption || "", mediaType: "image", mediaUrl: urls[0], mediaUrls: urls,
    status: scheduledAt === null ? "publishing" : "scheduled", scheduledAt: scheduledAt ?? undefined,
    targets: [{ accountId, settings: { kind: "tiktok", privacyLevel, allowComments, allowDuet: false, allowStitch: false } }],
  }) }));
});

await server.connect(new StdioServerTransport());
