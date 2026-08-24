import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { requireApiSession } from "../../../../lib/api-session";
import { getR2Client, getR2Config, publicObjectUrl } from "../../../../lib/r2";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const MAX_SERVER_UPLOAD_SIZE = 100 * 1024 * 1024;
const PROJECT_ID_PATTERN = /^[0-9a-f-]{36}$/i;

type AssetKind = "media" | "music";

function mediaPrefix(projectId: string | null | undefined, kind: AssetKind): string | undefined {
  if (!projectId || projectId === "all") return undefined;
  if (projectId === "unfiled") return kind === "music" ? "music/" : "media/";
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Invalid media project");
  return `media-projects/${projectId}/${kind}/`;
}

async function assertProjectAccess(projectId: string | null | undefined, ownerId: string, kind: AssetKind): Promise<void> {
  if (!projectId || projectId === "all" || projectId === "unfiled") return;
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new Error("Invalid media project");
  const config = getR2Config();
  const object = await getR2Client().send(new GetObjectCommand({ Bucket: config.bucket, Key: `media-projects/${projectId}/.project.json` }));
  const manifest = JSON.parse(await object.Body!.transformToString()) as { ownerId?: string; kind?: string };
  if (!manifest.ownerId || manifest.ownerId !== ownerId || (manifest.kind === "music" ? "music" : "media") !== kind) throw new Error("Media project not found");
}

const musicExtension = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
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
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || DEFAULT_PAGE_SIZE);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedLimit)))
      : DEFAULT_PAGE_SIZE;
    const cursor = url.searchParams.get("cursor") || undefined;
    const kind: AssetKind = url.searchParams.get("kind") === "music" ? "music" : "media";
    const projectId = url.searchParams.get("project");
    await assertProjectAccess(projectId, authorization.session.user.id, kind);
    const prefix = mediaPrefix(projectId, kind);
    const config = getR2Config();
    const result = await getR2Client().send(new ListObjectsV2Command({
      Bucket: config.bucket,
      MaxKeys: limit,
      ContinuationToken: cursor,
      Prefix: prefix,
    }));

    const data = (result.Contents ?? [])
      .filter((object) => object.Key && !object.Key.endsWith("/") && !object.Key.endsWith("/.project.json") && isKind(object.Key, kind))
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
        nextCursor: result.IsTruncated ? result.NextContinuationToken ?? null : null,
        hasMore: Boolean(result.IsTruncated && result.NextContinuationToken),
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
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const entry = form.get("file");
      const projectId = typeof form.get("projectId") === "string" ? String(form.get("projectId")) : undefined;
      const kind: AssetKind = form.get("kind") === "music" ? "music" : "media";
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
      await assertProjectAccess(projectId, authorization.session.user.id, kind);
      const key = `${mediaPrefix(projectId, kind) ?? (kind === "music" ? "music/" : "media/")}${crypto.randomUUID()}-${fileName}`;
      await getR2Client().send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: entry.size,
        Body: new Uint8Array(await entry.arrayBuffer()),
      }));
      return Response.json({ key, name: fileName, url: publicObjectUrl(key), mode: "server" }, { status: 201 });
    }

    const body = await request.json() as { fileName?: unknown; contentType?: unknown; projectId?: unknown; kind?: unknown };
    const fileName = typeof body.fileName === "string" ? sanitizeFileName(body.fileName) : "";
    const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
    if (!fileName) return Response.json({ error: "A valid file name is required" }, { status: 400 });
    const kind: AssetKind = body.kind === "music" ? "music" : "media";
    if (kind === "music" ? !contentType.startsWith("audio/") : !contentType.startsWith("image/") && !contentType.startsWith("video/")) return Response.json({ error: kind === "music" ? "Only audio uploads are supported in music folders" : "Only image and video uploads are supported in media folders" }, { status: 400 });

    const config = getR2Config();
    const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
    await assertProjectAccess(projectId, authorization.session.user.id, kind);
    const key = `${mediaPrefix(projectId, kind) ?? (kind === "music" ? "music/" : "media/")}${crypto.randomUUID()}-${fileName}`;
    const command = new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 15 * 60 });
    return Response.json({ key, uploadUrl, url: publicObjectUrl(key), expiresIn: 15 * 60 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:write" });
  if (authorization.response) return authorization.response;

  try {
    const body = await request.json() as { key?: unknown; name?: unknown };
    const key = typeof body.key === "string" ? body.key : "";
    const name = typeof body.name === "string" ? sanitizeFileName(body.name) : "";
    if (!key || !name) return Response.json({ error: "Object key and a valid name are required" }, { status: 400 });

    const slash = key.lastIndexOf("/");
    const prefix = slash >= 0 ? key.slice(0, slash + 1) : "";
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
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    return Response.json({ key: nextKey, name, url: publicObjectUrl(nextKey) });
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
    const config = getR2Config();
    await getR2Client().send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
