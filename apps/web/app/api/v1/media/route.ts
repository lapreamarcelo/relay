import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../lib/api-session";
import { collectFilteredPage } from "../../../../lib/filtered-pagination";
import { getR2Client, getR2Config, publicObjectUrl } from "../../../../lib/r2";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const MAX_SERVER_UPLOAD_SIZE = 100 * 1024 * 1024;
const PROJECT_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const stagingCleanupAt = new Map<string, number>();

type AssetKind = "media" | "music";

function mediaPrefix(projectId: string | null | undefined, kind: AssetKind): string | undefined {
  if (!projectId || projectId === "all") return undefined;
  if (projectId === "unfiled") return kind === "music" ? "music/" : "media/";
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Invalid media project");
  return `media-projects/${projectId}/${kind}/`;
}

function stagingPrefix(ownerId: string, kind?: AssetKind): string {
  return `staging/${ownerId}/${kind ? `${kind}/` : ""}`;
}

function stagedKeyForOwner(key: string, ownerId: string, kind?: AssetKind): boolean {
  return key.startsWith(stagingPrefix(ownerId, kind));
}

async function cleanupStagedUploads(ownerId: string): Promise<void> {
  const now = Date.now();
  if ((stagingCleanupAt.get(ownerId) ?? 0) > now - 60 * 60 * 1_000) return;
  stagingCleanupAt.set(ownerId, now);
  const config = getR2Config(); const client = getR2Client();
  const listed = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: stagingPrefix(ownerId), MaxKeys: 1_000 }));
  const expired = (listed.Contents ?? []).filter((object) => object.Key && object.LastModified && now - object.LastModified.getTime() >= STAGING_MAX_AGE_MS).map((object) => ({ Key: object.Key! }));
  if (expired.length) await client.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: expired, Quiet: true } }));
}

async function assertProjectAccess(projectId: string | null | undefined, ownerId: string, kind: AssetKind): Promise<void> {
  if (!projectId || projectId === "all" || projectId === "unfiled") return;
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Invalid media project");
  const config = getR2Config();
  const object = await getR2Client().send(new GetObjectCommand({ Bucket: config.bucket, Key: `media-projects/${projectId}/.project.json` }));
  const manifest = JSON.parse(await object.Body!.transformToString()) as { ownerId?: string; kind?: string };
  if (!manifest.ownerId || manifest.ownerId !== ownerId || (manifest.kind === "music" ? "music" : "media") !== kind) throw new Error("Media project not found");
}

function projectIdForKey(key: string): string | null {
  const match = /^media-projects\/([0-9a-f-]{36})\/(media|music)\//i.exec(key);
  return match?.[1] ?? null;
}

function kindForKey(key: string): AssetKind | null {
  if (/^music\/[^/]+$/i.test(key) || /^media-projects\/[0-9a-f-]{36}\/music\/[^/]+$/i.test(key)) return "music";
  if (/^media\/[^/]+$/i.test(key) || /^media-projects\/[0-9a-f-]{36}\/media\/[^/]+$/i.test(key)) return "media";
  return null;
}

async function assertObjectAccess(key: string, ownerId: string, expectedKind?: AssetKind): Promise<AssetKind> {
  const kind = kindForKey(key);
  if (!kind || expectedKind && kind !== expectedKind) throw new Error("Media object not found");
  const projectId = projectIdForKey(key);
  if (projectId) await assertProjectAccess(projectId, ownerId, kind);
  return kind;
}

function replaceUrl(value: unknown, currentUrl: string, nextUrl: string): unknown {
  if (value === currentUrl) return nextUrl;
  if (Array.isArray(value)) return value.map((item) => replaceUrl(item, currentUrl, nextUrl));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceUrl(item, currentUrl, nextUrl)]));
  return value;
}

async function updateMediaReferences(ownerId: string, currentUrl: string, nextUrl: string, destinationProjectId: string | null): Promise<void> {
  await sql.begin(async (transaction) => {
    const posts = await transaction<{ id: string; media_url: string | null; media_urls: string[] }[]>`SELECT id, media_url, media_urls FROM "post" WHERE owner_id = ${ownerId}`;
    for (const post of posts) {
      const mediaUrl = post.media_url === currentUrl ? nextUrl : post.media_url;
      const mediaUrls = post.media_urls.map((url) => url === currentUrl ? nextUrl : url);
      if (mediaUrl !== post.media_url || mediaUrls.some((url, index) => url !== post.media_urls[index])) {
        await transaction`UPDATE "post" SET media_url = ${mediaUrl}, media_urls = ${JSON.stringify(mediaUrls)}::jsonb, updated_at = NOW() WHERE id = ${post.id} AND owner_id = ${ownerId}`;
      }
    }

    const slideshows = await transaction<{ id: string; slides: unknown }[]>`SELECT id, slides FROM "slideshow_project" WHERE owner_id = ${ownerId}`;
    for (const project of slideshows) {
      const slides = replaceUrl(project.slides, currentUrl, nextUrl);
      if (JSON.stringify(slides) !== JSON.stringify(project.slides)) await transaction`UPDATE "slideshow_project" SET slides = ${JSON.stringify(slides)}::jsonb, updated_at = NOW() WHERE id = ${project.id} AND owner_id = ${ownerId}`;
    }

    await transaction`
      UPDATE "video_project"
      SET source_folder_id = CASE WHEN source_url = ${currentUrl} THEN ${destinationProjectId} ELSE source_folder_id END,
          music_folder_id = CASE WHEN music_url = ${currentUrl} THEN ${destinationProjectId} ELSE music_folder_id END,
          source_url = CASE WHEN source_url = ${currentUrl} THEN ${nextUrl} ELSE source_url END,
          music_url = CASE WHEN music_url = ${currentUrl} THEN ${nextUrl} ELSE music_url END,
          rendered_url = CASE WHEN rendered_url = ${currentUrl} THEN ${nextUrl} ELSE rendered_url END,
          updated_at = NOW()
      WHERE owner_id = ${ownerId} AND (source_url = ${currentUrl} OR music_url = ${currentUrl} OR rendered_url = ${currentUrl})
    `;
  });
}

const musicExtension = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
const imageExtension = /\.(jpe?g|png|gif|webp|avif|svg|bmp)$/i;
const videoExtension = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
const isKind = (key: string, kind: AssetKind) => kind === "music" ? musicExtension.test(key) : !musicExtension.test(key) && !key.includes("/music/");

function sanitizeFileName(value: string): string {
  const normalized = value.normalize("NFKC").split(/[\\/]/).pop()?.trim() ?? "";
  const safe = normalized.replace(/[^a-zA-Z0-9._ -]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-");
  return safe.replace(/^\.+/, "").slice(0, 180);
}

function copySource(bucket: string, key: string): string {
  return encodeURIComponent(`${bucket}/${key}`).replace(/%2F/g, "/");
}

function errorResponse(error: unknown) {
  console.error("R2 media operation failed", error);
  const message = error instanceof Error && error.message.includes("is required for Cloudflare R2")
    ? error.message
    : "Cloudflare R2 operation failed";
  return Response.json({ error: message }, { status: 500 });
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:read" });
  if (authorization.response) return authorization.response;

  try {
    await cleanupStagedUploads(authorization.session.user.id).catch((error) => console.warn("Could not clean staged media", error));
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || DEFAULT_PAGE_SIZE);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedLimit)))
      : DEFAULT_PAGE_SIZE;
    const cursor = url.searchParams.get("cursor");
    const kind: AssetKind = url.searchParams.get("kind") === "music" ? "music" : "media";
    const requestedMediaType = url.searchParams.get("mediaType");
    const mediaType = requestedMediaType === "image" || requestedMediaType === "video" ? requestedMediaType : "all";
    const projectId = url.searchParams.get("project");
    await assertProjectAccess(projectId, authorization.session.user.id, kind);
    const prefix = mediaPrefix(projectId, kind);
    const config = getR2Config();
    const client = getR2Client();
    const projectOwnership = new Map<string, Promise<boolean>>();
    const ownsProject = (id: string) => {
      const cached = projectOwnership.get(id);
      if (cached) return cached;
      const pending = client.send(new GetObjectCommand({ Bucket: config.bucket, Key: `media-projects/${id}/.project.json` })).then(async (object) => {
        const manifest = JSON.parse(await object.Body!.transformToString()) as { ownerId?: string; kind?: string };
        return manifest.ownerId === authorization.session.user.id && (manifest.kind === "music" ? "music" : "media") === kind;
      }).catch((error: unknown) => {
        if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
        throw error;
      });
      projectOwnership.set(id, pending);
      return pending;
    };
    const page = await collectFilteredPage({
      cursor,
      limit,
      list: async (continuationToken) => {
        const result = await client.send(new ListObjectsV2Command({
          Bucket: config.bucket,
          MaxKeys: 250,
          ContinuationToken: continuationToken ?? undefined,
          Prefix: prefix,
        }));
        return { items: result.Contents ?? [], nextToken: result.IsTruncated ? result.NextContinuationToken ?? null : null };
      },
      include: async (object) => {
        if (!object.Key || object.Key.endsWith("/") || object.Key.endsWith("/.project.json") || kindForKey(object.Key) !== kind || !isKind(object.Key, kind)) return false;
        if (kind === "media" && mediaType === "image" && !imageExtension.test(object.Key)) return false;
        if (kind === "media" && mediaType === "video" && !videoExtension.test(object.Key)) return false;
        const objectProjectId = projectIdForKey(object.Key);
        if (!objectProjectId || projectId && projectId !== "all") return true;
        return ownsProject(objectProjectId);
      },
    });

    const data = page.items
      .map((object) => ({
        key: object.Key!,
        name: object.Key!.split("/").pop() || object.Key!,
        size: object.Size ?? 0,
        lastModified: object.LastModified?.toISOString() ?? null,
        etag: object.ETag?.replaceAll('"', "") ?? null,
        url: publicObjectUrl(object.Key!),
        kind,
      }));

    return Response.json({
      data,
      pagination: {
        nextCursor: page.nextCursor,
        hasMore: Boolean(page.nextCursor),
        limit,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:write" });
  if (authorization.response) return authorization.response;

  try {
    await cleanupStagedUploads(authorization.session.user.id).catch((error) => console.warn("Could not clean staged media", error));
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const entry = form.get("file");
      const projectId = typeof form.get("projectId") === "string" ? String(form.get("projectId")) : undefined;
      const kind: AssetKind = form.get("kind") === "music" ? "music" : "media";
      const staged = form.get("staged") === "true";
      if (!(entry instanceof File)) return Response.json({ error: "A media file is required" }, { status: 400 });
      if (entry.size > MAX_SERVER_UPLOAD_SIZE) {
        return Response.json({ error: "Server fallback uploads are limited to 100 MB. Configure R2 CORS for larger direct uploads." }, { status: 413 });
      }
      const fileName = sanitizeFileName(entry.name);
      const contentType = entry.type.trim().toLowerCase();
      if (!fileName) return Response.json({ error: "A valid file name is required" }, { status: 400 });
      if (kind === "music" ? !contentType.startsWith("audio/") : !contentType.startsWith("image/") && !contentType.startsWith("video/")) {
        return Response.json({ error: kind === "music" ? "Only audio uploads are supported in music folders" : "Only image and video uploads are supported in media folders" }, { status: 400 });
      }
      const config = getR2Config();
      if (!staged) await assertProjectAccess(projectId, authorization.session.user.id, kind);
      const key = `${staged ? stagingPrefix(authorization.session.user.id, kind) : mediaPrefix(projectId, kind) ?? (kind === "music" ? "music/" : "media/")}${crypto.randomUUID()}-${fileName}`;
      await getR2Client().send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: entry.size,
        Body: new Uint8Array(await entry.arrayBuffer()),
      }));
      return Response.json({ key, name: fileName, url: publicObjectUrl(key), mode: "server", staged }, { status: 201 });
    }

    const body = await request.json() as { fileName?: unknown; contentType?: unknown; projectId?: unknown; kind?: unknown; staged?: unknown };
    const fileName = typeof body.fileName === "string" ? sanitizeFileName(body.fileName) : "";
    const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
    if (!fileName) return Response.json({ error: "A valid file name is required" }, { status: 400 });
    const kind: AssetKind = body.kind === "music" ? "music" : "media";
    if (kind === "music" ? !contentType.startsWith("audio/") : !contentType.startsWith("image/") && !contentType.startsWith("video/")) return Response.json({ error: kind === "music" ? "Only audio uploads are supported in music folders" : "Only image and video uploads are supported in media folders" }, { status: 400 });

    const config = getR2Config();
    const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
    const staged = body.staged === true;
    if (!staged) await assertProjectAccess(projectId, authorization.session.user.id, kind);
    const key = `${staged ? stagingPrefix(authorization.session.user.id, kind) : mediaPrefix(projectId, kind) ?? (kind === "music" ? "music/" : "media/")}${crypto.randomUUID()}-${fileName}`;
    const command = new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 15 * 60 });
    return Response.json({ key, uploadUrl, url: publicObjectUrl(key), expiresIn: 15 * 60, staged });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:write" });
  if (authorization.response) return authorization.response;

  try {
    const body = await request.json() as { key?: unknown; name?: unknown; projectId?: unknown; kind?: unknown; commit?: unknown };
    const key = typeof body.key === "string" ? body.key : "";
    const committing = body.commit === true;
    const requestedName = typeof body.name === "string" ? sanitizeFileName(body.name) : "";
    const moving = Object.prototype.hasOwnProperty.call(body, "projectId");
    const projectId = body.projectId === null || body.projectId === "unfiled" ? "unfiled" : typeof body.projectId === "string" ? body.projectId : undefined;
    if (!key || !committing && !requestedName && !moving) return Response.json({ error: "Object key and a new name or destination folder are required" }, { status: 400 });
    if (moving && (!projectId || projectId === "all" || projectId !== "unfiled" && !PROJECT_ID_PATTERN.test(projectId))) return Response.json({ error: "A valid destination folder is required" }, { status: 400 });

    const expectedKind: AssetKind | undefined = body.kind === "music" ? "music" : body.kind === "media" ? "media" : undefined;
    if (committing) {
      const kind: AssetKind = expectedKind ?? "media";
      if (!stagedKeyForOwner(key, authorization.session.user.id, kind)) return Response.json({ error: "Staged media object not found" }, { status: 404 });
      const destination = projectId ?? "unfiled";
      if (destination !== "unfiled") await assertProjectAccess(destination, authorization.session.user.id, kind);
      const name = key.split("/").pop() || `${crypto.randomUUID()}-asset`;
      const nextKey = `${mediaPrefix(destination, kind)!}${name}`;
      const config = getR2Config(); const client = getR2Client();
      await client.send(new CopyObjectCommand({ Bucket: config.bucket, Key: nextKey, CopySource: copySource(config.bucket, key) }));
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      return Response.json({ key: nextKey, name, url: publicObjectUrl(nextKey), projectId: destination === "unfiled" ? null : destination, staged: false });
    }
    const kind = await assertObjectAccess(key, authorization.session.user.id, expectedKind);
    if (projectId && projectId !== "unfiled") await assertProjectAccess(projectId, authorization.session.user.id, kind);

    const slash = key.lastIndexOf("/");
    const currentName = slash >= 0 ? key.slice(slash + 1) : key;
    const name = requestedName || currentName;
    const prefix = moving ? mediaPrefix(projectId, kind)! : slash >= 0 ? key.slice(0, slash + 1) : "";
    const nextKey = `${prefix}${name}`;
    if (nextKey === key) return Response.json({ key, name, url: publicObjectUrl(key) });

    const config = getR2Config();
    const client = getR2Client();
    try {
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: nextKey }));
      return Response.json({ error: "An object with that name already exists" }, { status: 409 });
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status && status !== 404) throw error;
    }

    await client.send(new CopyObjectCommand({
      Bucket: config.bucket,
      Key: nextKey,
      CopySource: copySource(config.bucket, key),
    }));
    const currentUrl = publicObjectUrl(key);
    const nextUrl = publicObjectUrl(nextKey);
    try {
      await updateMediaReferences(authorization.session.user.id, currentUrl, nextUrl, projectId && projectId !== "unfiled" ? projectId : null);
    } catch (error) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: nextKey })).catch(() => undefined);
      throw error;
    }
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    return Response.json({ key: nextKey, name, url: nextUrl, projectId: projectId && projectId !== "unfiled" ? projectId : null });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:write" });
  if (authorization.response) return authorization.response;

  try {
    const body = await request.json() as { key?: unknown };
    const key = typeof body.key === "string" ? body.key : "";
    if (!key) return Response.json({ error: "Object key is required" }, { status: 400 });
    if (!stagedKeyForOwner(key, authorization.session.user.id)) await assertObjectAccess(key, authorization.session.user.id);
    const config = getR2Config();
    await getR2Client().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
