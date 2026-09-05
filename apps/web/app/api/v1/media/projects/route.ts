import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

import { requireApiSession } from "../../../../../lib/api-session";
import { getR2Client, getR2Config } from "../../../../../lib/r2";

export const runtime = "nodejs";

interface MediaProjectManifest { id: string; name: string; kind?: "media" | "music"; ownerId?: string; createdAt: string; parentId?: string | null }
type MediaProjectRecord = Omit<MediaProjectManifest, "kind" | "parentId"> & { kind: "media" | "music"; parentId: string | null; count: number };

const PROJECT_ID_PATTERN = /^[0-9a-f-]{36}$/i;

class ProjectRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function projectKey(id: string) { return `media-projects/${id}/.project.json`; }

function parseParentId(value: unknown, present: boolean): string | null | undefined {
  if (!present) return undefined;
  if (value === null || value === "" || value === "root") return null;
  if (typeof value !== "string" || !PROJECT_ID_PATTERN.test(value)) throw new ProjectRequestError(400, "A valid parent folder is required");
  return value;
}

async function readManifest(client: ReturnType<typeof getR2Client>, id: string): Promise<MediaProjectManifest> {
  let object;
  try { object = await client.send(new GetObjectCommand({ Bucket: getR2Config().bucket, Key: projectKey(id) })); }
  catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) throw new ProjectRequestError(404, "Folder not found");
    throw error;
  }
  const manifest = JSON.parse(await object.Body!.transformToString()) as MediaProjectManifest;
  return { ...manifest, id, kind: manifest.kind === "music" ? "music" : "media", parentId: manifest.parentId ?? null };
}

async function assertParentAccess(client: ReturnType<typeof getR2Client>, parentId: string, ownerId: string, kind: "media" | "music", movingId?: string): Promise<void> {
  const seen = new Set<string>();
  let currentId: string | null = parentId;
  while (currentId) {
    if (!PROJECT_ID_PATTERN.test(currentId)) throw new ProjectRequestError(400, "A valid parent folder is required");
    if (movingId && currentId === movingId) throw new ProjectRequestError(400, "A folder cannot be moved inside itself or one of its children");
    if (seen.has(currentId)) throw new ProjectRequestError(400, "The folder hierarchy contains a cycle");
    seen.add(currentId);
    const parent = await readManifest(client, currentId);
    if (!parent.ownerId || parent.ownerId !== ownerId) throw new ProjectRequestError(404, "Destination folder not found");
    if ((parent.kind === "music" ? "music" : "media") !== kind) throw new ProjectRequestError(400, "A folder can only contain folders of the same type");
    currentId = parent.parentId ?? null;
  }
}

function errorResponse(error: unknown) {
  console.error("R2 media project operation failed", error);
  if (error instanceof ProjectRequestError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Could not manage media projects" }, { status: 500 });
}

export async function GET(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:read" });
  if (authorization.response) return authorization.response;
  try {
    const config = getR2Config(); const client = getR2Client();
    const listed = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: "media-projects/", MaxKeys: 1000 }));
    const manifestKeys = (listed.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key?.endsWith("/.project.json")));
    const requestedKind = new URL(request.url).searchParams.get("kind");
    const manifests = (await Promise.all(manifestKeys.map(async (key) => {
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
      const manifest = JSON.parse(await result.Body!.transformToString()) as MediaProjectManifest;
      const kind = manifest.kind === "music" ? "music" : "media";
      if (manifest.ownerId && manifest.ownerId !== authorization.session.user.id) return null;
      const prefix = `media-projects/${manifest.id}/${kind}/`;
      const count = (listed.Contents ?? []).filter((item) => item.Key?.startsWith(prefix) && !item.Key.endsWith("/")).length;
      return { ...manifest, kind, parentId: manifest.parentId ?? null, count };
    }))).filter((manifest): manifest is MediaProjectRecord => Boolean(manifest))
      .filter((manifest) => requestedKind !== "media" && requestedKind !== "music" || manifest.kind === requestedKind);
    manifests.sort((first, second) => first.name.localeCompare(second.name));
    return Response.json({ data: manifests });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:write" });
  if (authorization.response) return authorization.response;
  try {
    const body = await request.json() as { name?: unknown; kind?: unknown; parentId?: unknown };
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 100) : "";
    const kind = body.kind === "music" ? "music" as const : "media" as const;
    if (!name) return Response.json({ error: "A project name is required" }, { status: 400 });
    const parentId = parseParentId(body.parentId, Object.prototype.hasOwnProperty.call(body, "parentId")) ?? null;
    const config = getR2Config(); const client = getR2Client();
    if (parentId) await assertParentAccess(client, parentId, authorization.session.user.id, kind);
    const manifest: MediaProjectManifest = { id: crypto.randomUUID(), name, kind, ownerId: authorization.session.user.id, createdAt: new Date().toISOString(), parentId };
    await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: projectKey(manifest.id), Body: JSON.stringify(manifest), ContentType: "application/json" }));
    return Response.json({ data: { ...manifest, count: 0 } }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:write" });
  if (authorization.response) return authorization.response;
  try {
    const body = await request.json() as { id?: unknown; name?: unknown; parentId?: unknown };
    const id = typeof body.id === "string" && PROJECT_ID_PATTERN.test(body.id) ? body.id : "";
    const hasName = Object.prototype.hasOwnProperty.call(body, "name");
    const hasParent = Object.prototype.hasOwnProperty.call(body, "parentId");
    const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ").slice(0, 100) : "";
    if (!id || !hasName && !hasParent || hasName && !name) return Response.json({ error: "Folder id and a name or destination are required" }, { status: 400 });

    const config = getR2Config(); const client = getR2Client();
    const manifest = await readManifest(client, id);
    if (!manifest.ownerId || manifest.ownerId !== authorization.session.user.id) return Response.json({ error: "Folder not found" }, { status: 404 });
    const parentId = hasParent ? parseParentId(body.parentId, true) ?? null : manifest.parentId ?? null;
    if (hasParent && parentId) await assertParentAccess(client, parentId, authorization.session.user.id, manifest.kind === "music" ? "music" : "media", id);
    const updated = { ...manifest, name: hasName ? name : manifest.name, parentId };
    await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: projectKey(id), Body: JSON.stringify(updated), ContentType: "application/json" }));
    const listed = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: `media-projects/${id}/${manifest.kind === "music" ? "music" : "media"}/` }));
    const count = (listed.Contents ?? []).filter((item) => item.Key && !item.Key.endsWith("/")).length;
    return Response.json({ data: { ...updated, kind: manifest.kind === "music" ? "music" : "media", parentId, count } });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "media:write" });
  if (authorization.response) return authorization.response;
  try {
    const body = await request.json() as { id?: unknown };
    const id = typeof body.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : "";
    if (!id) return Response.json({ error: "A valid folder id is required" }, { status: 400 });

    const config = getR2Config(); const client = getR2Client();
    const manifestKey = projectKey(id);
    const manifest = await readManifest(client, id);
    if (!manifest.ownerId || manifest.ownerId !== authorization.session.user.id) return Response.json({ error: "Folder not found" }, { status: 404 });

    const allProjects = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: "media-projects/", MaxKeys: 1_000 }));
    const childManifests = await Promise.all((allProjects.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key?.endsWith("/.project.json"))).map(async (key) => {
      try { return JSON.parse(await (await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))).Body!.transformToString()) as MediaProjectManifest; }
      catch { return null; }
    }));
    if (childManifests.some((child) => child?.ownerId === authorization.session.user.id && child.parentId === id)) return Response.json({ error: "Move or delete child folders before deleting this folder" }, { status: 409 });

    const prefix = `media-projects/${id}/`;
    let deleted = 0;
    while (true) {
      const listed = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, MaxKeys: 1_000 }));
      const keys = (listed.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key && key !== manifestKey));
      if (!keys.length) break;
      const result = await client.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
      if (result.Errors?.length) throw new Error(`Could not delete ${result.Errors.length} object${result.Errors.length === 1 ? "" : "s"} from the folder`);
      deleted += keys.length;
    }
    const result = await client.send(new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: [{ Key: manifestKey }], Quiet: true } }));
    if (result.Errors?.length) throw new Error("Could not delete the folder manifest");
    return Response.json({ data: { id, deleted } });
  } catch (error) { return errorResponse(error); }
}
