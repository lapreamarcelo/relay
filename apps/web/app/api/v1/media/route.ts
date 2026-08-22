import {
  CopyObjectCommand,
  DeleteObjectCommand,
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
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;

  try {
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit") || DEFAULT_PAGE_SIZE);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedLimit)))
      : DEFAULT_PAGE_SIZE;
    const cursor = url.searchParams.get("cursor") || undefined;
    const config = getR2Config();
    const result = await getR2Client().send(new ListObjectsV2Command({
      Bucket: config.bucket,
      MaxKeys: limit,
      ContinuationToken: cursor,
    }));

    const data = (result.Contents ?? [])
      .filter((object) => object.Key && !object.Key.endsWith("/"))
      .map((object) => ({
        key: object.Key!,
        name: object.Key!.split("/").pop() || object.Key!,
        size: object.Size ?? 0,
        lastModified: object.LastModified?.toISOString() ?? null,
        etag: object.ETag?.replaceAll('"', "") ?? null,
        url: publicObjectUrl(object.Key!),
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
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;

  try {
    if (request.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await request.formData();
      const entry = form.get("file");
      if (!(entry instanceof File)) return Response.json({ error: "A media file is required" }, { status: 400 });
      if (entry.size > MAX_SERVER_UPLOAD_SIZE) {
        return Response.json({ error: "Server fallback uploads are limited to 100 MB. Configure R2 CORS for larger direct uploads." }, { status: 413 });
      }
      const fileName = sanitizeFileName(entry.name);
      const contentType = entry.type.trim().toLowerCase();
      if (!fileName) return Response.json({ error: "A valid file name is required" }, { status: 400 });
      if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
        return Response.json({ error: "Only image and video uploads are supported" }, { status: 400 });
      }
      const config = getR2Config();
      const key = `media/${crypto.randomUUID()}-${fileName}`;
      await getR2Client().send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: entry.size,
        Body: new Uint8Array(await entry.arrayBuffer()),
      }));
      return Response.json({ key, name: fileName, url: publicObjectUrl(key), mode: "server" }, { status: 201 });
    }

    const body = await request.json() as { fileName?: unknown; contentType?: unknown };
    const fileName = typeof body.fileName === "string" ? sanitizeFileName(body.fileName) : "";
    const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
    if (!fileName) return Response.json({ error: "A valid file name is required" }, { status: 400 });
    if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
      return Response.json({ error: "Only image and video uploads are supported" }, { status: 400 });
    }

    const config = getR2Config();
    const key = `media/${crypto.randomUUID()}-${fileName}`;
    const command = new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(getR2Client(), command, { expiresIn: 15 * 60 });
    return Response.json({ key, uploadUrl, url: publicObjectUrl(key), expiresIn: 15 * 60 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const authorization = await requireApiSession(request);
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
  const authorization = await requireApiSession(request);
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
