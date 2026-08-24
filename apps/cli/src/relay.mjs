#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const commands = new Map(Object.entries({
  "health check": ["GET", "/health"],
  "accounts list": ["GET", "/api/v1/accounts"],
  "brands list": ["GET", "/api/v1/brands"], "brands create": ["POST", "/api/v1/brands"], "brands update": ["PATCH", "/api/v1/brands"], "brands delete": ["DELETE", "/api/v1/brands", "body-id"],
  "posts list": ["GET", "/api/v1/posts"], "posts create": ["POST", "/api/v1/posts"], "posts update": ["PATCH", "/api/v1/posts"], "posts delete": ["DELETE", "/api/v1/posts", "body-id"],
  "campaigns list": ["GET", "/api/v1/campaigns"], "campaigns create": ["POST", "/api/v1/campaigns"], "campaigns update": ["PATCH", "/api/v1/campaigns"], "campaigns delete": ["DELETE", "/api/v1/campaigns", "body-id"],
  "templates list": ["GET", "/api/v1/templates"], "templates create": ["POST", "/api/v1/templates"], "templates delete": ["DELETE", "/api/v1/templates", "body-id"],
  "media list": ["GET", "/api/v1/media"], "media update": ["PATCH", "/api/v1/media"], "media rename": ["PATCH", "/api/v1/media"], "media move": ["PATCH", "/api/v1/media"], "media delete": ["DELETE", "/api/v1/media"],
  "folders list": ["GET", "/api/v1/media/projects"], "folders create": ["POST", "/api/v1/media/projects"], "folders rename": ["PATCH", "/api/v1/media/projects"],
  "slideshows list": ["GET", "/api/v1/slideshows"], "slideshows get": ["GET", "/api/v1/slideshows", "query-id"], "slideshows create": ["POST", "/api/v1/slideshows"], "slideshows update": ["PATCH", "/api/v1/slideshows"], "slideshows delete": ["DELETE", "/api/v1/slideshows", "body-id"], "slideshows render": ["POST", "/api/v1/slideshows/render", "body-id"],
  "videos list": ["GET", "/api/v1/videos"], "videos get": ["GET", "/api/v1/videos", "query-id"], "videos create": ["POST", "/api/v1/videos"], "videos update": ["PATCH", "/api/v1/videos"], "videos delete": ["DELETE", "/api/v1/videos", "body-id"], "videos render": ["POST", "/api/v1/videos/render", "body-id"], "videos batch": ["POST", "/api/v1/videos/batch"],
  "analytics report": ["GET", "/api/v1/analytics"],
  "reports list": ["GET", "/api/v1/analytics/reports"], "reports create": ["POST", "/api/v1/analytics/reports"], "reports delete": ["DELETE", "/api/v1/analytics/reports", "body-id"],
  "settings get": ["GET", "/api/v1/settings/publishing"], "settings set": ["PUT", "/api/v1/settings/publishing"],
}));

const help = `Relay CLI — complete agent interface for Relay's REST API

Usage:
  relay <resource> <action> [--data JSON|@file|-] [--id ID] [--query key=value]
  relay media upload --file PATH [--project ID] [--kind media|music] [--content-type TYPE]
  relay request METHOD /api/path [--data JSON|@file|-] [--query key=value]

Environment:
  RELAY_URL       Browser-visible Relay origin, for example https://relay.example.com
  RELAY_API_KEY   Secret created once under Settings → API keys

Resources and actions:
  accounts list
  brands list|create|update|delete
  posts list|create|update|delete
  campaigns list|create|update|delete
  templates list|create|delete
  media list|upload|rename|move|delete
  folders list|create|rename
  slideshows list|get|create|update|delete|render|schedule
  videos list|get|create|update|delete|render|schedule|batch
  analytics report
  reports list|create|delete
  settings get|set
  health check

All output is JSON. Mutating resource commands accept the same JSON objects as Relay's /api/v1 endpoints.
Use --compact for one-line output. Repeat --query for filters. Use --help to show this text.`;

function parseArguments(argv) {
  const positionals = []; const options = { query: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) { positionals.push(token); continue; }
    const equal = token.indexOf("="); const key = token.slice(2, equal > 0 ? equal : undefined);
    if (key === "help" || key === "compact") { options[key] = true; continue; }
    const value = equal > 0 ? token.slice(equal + 1) : argv[++index];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} requires a value.`);
    if (key === "query") options.query.push(value); else options[key] = value;
  }
  return { positionals, options };
}

async function stdinText(stdin = process.stdin) {
  let value = ""; for await (const chunk of stdin) value += chunk; return value;
}

async function jsonInput(value, stdin) {
  if (value === undefined) return undefined;
  const text = value === "-" ? await stdinText(stdin) : value.startsWith("@") ? await readFile(resolve(value.slice(1)), "utf8") : value;
  try { return JSON.parse(text); } catch { throw new Error("--data must be valid JSON, @a JSON file, or - for JSON stdin."); }
}

function queryString(values = []) {
  const query = new URLSearchParams();
  for (const entry of values) {
    const split = entry.indexOf("="); if (split <= 0) throw new Error(`Invalid --query value '${entry}'; use key=value.`);
    query.append(entry.slice(0, split), entry.slice(split + 1));
  }
  const text = query.toString(); return text ? `?${text}` : "";
}

function withQuery(path, values) {
  const query = queryString(values); return query && path.includes("?") ? `${path}&${query.slice(1)}` : `${path}${query}`;
}

export function createRelayClient({ url, apiKey, fetchImpl = fetch }) {
  const origin = url?.trim().replace(/\/$/, ""); const secret = apiKey?.trim();
  if (!origin) throw new Error("RELAY_URL is required.");
  if (!/^https?:\/\//.test(origin)) throw new Error("RELAY_URL must be an http or https origin.");
  if (!secret) throw new Error("RELAY_API_KEY is required. Create one under Settings → API keys.");
  return {
    async request(path, init = {}) {
      const response = await fetchImpl(`${origin}${path}`, { ...init, headers: { Authorization: `Bearer ${secret}`, ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}), ...init.headers } });
      const text = await response.text(); let payload = null;
      if (text) { try { payload = JSON.parse(text); } catch { payload = { value: text }; } }
      if (!response.ok) throw new Error(payload?.error || `Relay returned HTTP ${response.status}.`);
      return payload;
    },
    async upload(uploadUrl, body, contentType, contentLength) {
      const response = await fetchImpl(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType, "Content-Length": String(contentLength) }, body, duplex: "half" });
      if (!response.ok) throw new Error(`R2 upload returned HTTP ${response.status}.`);
    },
  };
}

function contentTypeFor(path, explicit) {
  if (explicit) return explicit;
  const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".ogg": "audio/ogg", ".flac": "audio/flac" };
  const type = types[extname(path).toLowerCase()]; if (!type) throw new Error("Could not infer the file content type; pass --content-type."); return type;
}

async function uploadMedia(client, options) {
  if (!options.file) throw new Error("media upload requires --file PATH.");
  const path = resolve(options.file); const details = await stat(path); if (!details.isFile()) throw new Error("--file must point to a file.");
  const contentType = contentTypeFor(path, options["content-type"]); const kind = options.kind === "music" ? "music" : "media";
  const prepared = await client.request("/api/v1/media", { method: "POST", body: JSON.stringify({ fileName: basename(path), contentType, projectId: options.project, kind }) });
  if (!prepared?.uploadUrl) throw new Error("Relay did not return a direct upload URL.");
  await client.upload(prepared.uploadUrl, createReadStream(path), contentType, details.size);
  return { data: { key: prepared.key, url: prepared.url, name: basename(path), size: details.size, kind, projectId: options.project ?? null } };
}

async function scheduleCreative(client, kind, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error(`${kind} schedule requires a JSON object.`);
  const projectId = input.projectId; if (typeof projectId !== "string" || !projectId) throw new Error("projectId is required.");
  if (!Array.isArray(input.targets) || input.targets.length === 0) throw new Error("At least one target is required.");
  if (!(input.scheduledAt === null || typeof input.scheduledAt === "string")) throw new Error("scheduledAt must be an ISO timestamp or null for immediate publishing.");
  const rendered = await client.request(`/api/v1/${kind}/render`, { method: "POST", body: JSON.stringify({ id: projectId }) });
  const project = rendered?.data;
  const isSlideshow = kind === "slideshows";
  const mediaUrls = isSlideshow ? project?.slides?.map((slide) => slide.renderedUrl).filter(Boolean) ?? [] : undefined;
  const mediaUrl = isSlideshow ? mediaUrls[0] : project?.renderedUrl;
  if (!mediaUrl) throw new Error(`Relay rendered no ${isSlideshow ? "slideshow images" : "video"}.`);
  return client.request("/api/v1/posts", { method: "POST", body: JSON.stringify({
    clientRequestId: input.clientRequestId, brandId: project.brandId || undefined, campaignId: input.campaignId || undefined,
    text: input.text ?? project.caption ?? project.labels?.[0]?.text ?? project.name ?? "", mediaType: isSlideshow ? "image" : "video", mediaUrl, mediaUrls,
    status: input.scheduledAt === null ? "publishing" : "scheduled", scheduledAt: input.scheduledAt ?? undefined, targets: input.targets,
  }) });
}

export async function run(argv, io = {}) {
  const { positionals, options } = parseArguments(argv); const stdout = io.stdout ?? process.stdout; const env = io.env ?? process.env;
  if (options.help || positionals.length === 0) { stdout.write(`${help}\n`); return null; }
  const client = createRelayClient({ url: env.RELAY_URL, apiKey: env.RELAY_API_KEY, fetchImpl: io.fetchImpl });
  let result;
  if (positionals[0] === "request") {
    const method = positionals[1]?.toUpperCase(); const path = positionals[2];
    if (!method || !path?.startsWith("/")) throw new Error("request requires METHOD and an absolute API path.");
    const data = await jsonInput(options.data, io.stdin); result = await client.request(withQuery(path, options.query), { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  } else if (positionals[0] === "media" && positionals[1] === "upload") result = await uploadMedia(client, options);
  else if ((positionals[0] === "slideshows" || positionals[0] === "videos") && positionals[1] === "schedule") result = await scheduleCreative(client, positionals[0], await jsonInput(options.data, io.stdin));
  else {
    const key = `${positionals[0] ?? ""} ${positionals[1] ?? ""}`; const definition = commands.get(key);
    if (!definition) throw new Error(`Unknown command '${key.trim()}'. Run relay --help.`);
    const [method, basePath, idMode] = definition; let data = await jsonInput(options.data, io.stdin); const queries = [...options.query];
    if (idMode === "query-id") { if (!options.id) throw new Error(`${key} requires --id.`); queries.push(`id=${options.id}`); }
    if (idMode === "body-id" && options.id) data = { ...(data && typeof data === "object" && !Array.isArray(data) ? data : {}), id: options.id };
    if (method !== "GET" && data === undefined) {
      if (idMode === "body-id" && options.id) data = { id: options.id }; else throw new Error(`${key} requires --data JSON|@file|-`);
    }
    result = await client.request(withQuery(basePath, queries), { method, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  }
  stdout.write(`${JSON.stringify(result, null, options.compact ? 0 : 2)}\n`); return result;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) run(process.argv.slice(2)).catch((error) => { process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`); process.exitCode = 1; });
