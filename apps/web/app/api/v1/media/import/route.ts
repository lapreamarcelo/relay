import { PutObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";

import { requireApiSession } from "../../../../../lib/api-session";
import { allowedExternalImageUrl, safeExternalImageName, type ExternalImageProvider } from "../../../../../lib/external-image-sources";
import { getR2Client, getR2Config, publicObjectUrl } from "../../../../../lib/r2";

export const runtime = "nodejs";

const MAX_EXTERNAL_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);

function string(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function metadataValue(value: unknown, maximum = 500): string | undefined {
  const normalized = string(value, maximum).replace(/[^\x20-\x7E]/g, " ").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

async function readImageBytes(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_EXTERNAL_IMAGE_BYTES) throw new RangeError("external-image-too-large");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:write" });
  if (authorization.response) return authorization.response;

  try {
    const body = await request.json() as { provider?: unknown; id?: unknown; url?: unknown; sourceUrl?: unknown; creator?: unknown; attribution?: unknown };
    const provider: ExternalImageProvider | null = body.provider === "pexels" ? body.provider : null;
    if (!provider) return Response.json({ error: "Choose a supported image source." }, { status: 400 });
    const source = allowedExternalImageUrl(provider, body.url);
    if (!source) return Response.json({ error: "The image URL does not belong to the selected provider." }, { status: 400 });

    const upstream = await fetch(source, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!upstream.ok) return Response.json({ error: `Could not download the selected image (HTTP ${upstream.status}).` }, { status: 502 });
    const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) return Response.json({ error: "The selected source did not return a supported image." }, { status: 415 });
    const declaredLength = Number(upstream.headers.get("content-length") || 0);
    if (declaredLength > MAX_EXTERNAL_IMAGE_BYTES) return Response.json({ error: "External images are limited to 20 MB." }, { status: 413 });
    const bytes = await readImageBytes(upstream);
    if (!bytes.byteLength || bytes.byteLength > MAX_EXTERNAL_IMAGE_BYTES) return Response.json({ error: "External images are limited to 20 MB." }, { status: 413 });
    const image = await sharp(bytes, { animated: true }).metadata();
    if (!image.width || !image.height) return Response.json({ error: "The downloaded file is not a valid image." }, { status: 415 });

    const fileName = safeExternalImageName(provider, body.id, contentType);
    const key = `staging/${authorization.session.user.id}/media/${crypto.randomUUID()}-${fileName}`;
    const config = getR2Config();
    const metadata = Object.fromEntries(Object.entries({
      "source-provider": provider,
      "source-url": metadataValue(body.sourceUrl, 500),
      "source-creator": metadataValue(body.creator, 200),
      "source-attribution": metadataValue(body.attribution, 500),
    }).filter((entry): entry is [string, string] => Boolean(entry[1])));
    await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, ContentType: contentType, ContentLength: bytes.byteLength, Metadata: metadata }));
    return Response.json({ key, name: fileName, url: publicObjectUrl(key), staged: true, provider, width: image.width, height: image.height }, { status: 201 });
  } catch (error) {
    if (error instanceof RangeError && error.message === "external-image-too-large") return Response.json({ error: "External images are limited to 20 MB." }, { status: 413 });
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return Response.json({ error: timedOut ? "The selected image took too long to download." : "Could not import the selected image." }, { status: 502 });
  }
}
