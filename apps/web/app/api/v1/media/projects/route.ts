import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

import { requireApiSession } from "../../../../../lib/api-session";
import { getR2Client, getR2Config } from "../../../../../lib/r2";

export const runtime = "nodejs";

interface MediaProjectManifest { id: string; name: string; createdAt: string }

function projectKey(id: string) { return `media-projects/${id}/.project.json`; }

function errorResponse(error: unknown) {
  console.error("R2 media project operation failed", error);
  return Response.json({ error: error instanceof Error ? error.message : "Could not manage media projects" }, { status: 500 });
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:read" });
  if (authorization.response) return authorization.response;
  try {
    const config = getR2Config(); const client = getR2Client();
    const listed = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: "media-projects/", MaxKeys: 1000 }));
    const manifestKeys = (listed.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key?.endsWith("/.project.json")));
    const manifests = await Promise.all(manifestKeys.map(async (key) => {
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      const manifest = JSON.parse(await result.Body!.transformToString()) as MediaProjectManifest;
      const prefix = `media-projects/${manifest.id}/media/`;
      const count = (listed.Contents ?? []).filter((item) => item.Key?.startsWith(prefix) && !item.Key.endsWith("/")).length;
      return { ...manifest, count };
    }));
    manifests.sort((first, second) => first.name.localeCompare(second.name));
    return Response.json({ data: manifests });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request);
  if (authorization.response) return authorization.response;
  try {
    const body = await request.json() as { name?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 100) : "";
    if (!name) return Response.json({ error: "A project name is required" }, { status: 400 });
    const manifest: MediaProjectManifest = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() };
    const config = getR2Config();
    await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: projectKey(manifest.id), Body: JSON.stringify(manifest), ContentType: "application/json" }));
    return Response.json({ data: { ...manifest, count: 0 } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
