import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import type { ProviderId, ProviderPostSettings, VideoMusicMode } from "@relay/core";
import { sql } from "@relay/database";

import { requireApiSession } from "../../../../../lib/api-session";
import { getR2Client, getR2Config, publicObjectUrl } from "../../../../../lib/r2";
import { renderVideoArtifact } from "../../../../../lib/video-renderer";
import { safeWebUrl, selectMusicTrack, serializeVideoProject, type VideoProjectRow } from "../../../../../lib/videos";

export const runtime = "nodejs";
export const maxDuration = 300;

interface BatchInput {
  projectId?: unknown; hooks?: unknown; musicMode?: unknown; musicFolderId?: unknown; musicUrl?: unknown;
  accountIds?: unknown; scheduledAt?: unknown; intervalMinutes?: unknown; captionTemplate?: unknown; clientRequestId?: unknown;
}

const musicFile = /\.(mp3|m4a|aac|wav|ogg|flac)$/i;
const settings = (provider: ProviderId, hook: string): ProviderPostSettings => provider === "instagram" ? { kind: "instagram", publishType: "reel" }
  : provider === "facebook" ? { kind: "facebook", publishType: "reel" }
    : provider === "youtube" ? { kind: "youtube", title: hook.slice(0, 100), tags: [], privacyStatus: "private", madeForKids: false }
      : { kind: "tiktok", privacyLevel: "SELF_ONLY", allowComments: true, allowDuet: false, allowStitch: false };

async function listKeys(prefix: string): Promise<string[]> {
  const config = getR2Config(); const client = getR2Client(); const keys: string[] = []; let cursor: string | undefined;
  do {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, MaxKeys: 1_000, ContinuationToken: cursor }));
    keys.push(...(listed.Contents ?? []).map((object) => object.Key).filter((key): key is string => Boolean(key)));
    cursor = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (cursor);
  return keys;
}

async function musicUrls(folderId: string, ownerId: string): Promise<string[]> {
  const config = getR2Config(); const client = getR2Client();
  if (folderId === "unfiled") return (await listKeys("music/")).filter((key) => musicFile.test(key)).map(publicObjectUrl);
  if (folderId === "all") {
    const [rootKeys, projectKeys] = await Promise.all([listKeys("music/"), listKeys("media-projects/")]);
    const manifestKeys = projectKeys.filter((key) => key.endsWith("/.project.json"));
    const ownedMusicPrefixes = (await Promise.all(manifestKeys.map(async (key) => {
      const manifest = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key })).then(async (object) => JSON.parse(await object.Body!.transformToString()) as { id?: string; ownerId?: string; kind?: string }).catch(() => null);
      return manifest?.ownerId === ownerId && manifest.kind === "music" && manifest.id ? `media-projects/${manifest.id}/music/` : null;
    }))).filter((prefix): prefix is string => Boolean(prefix));
    return [...rootKeys, ...projectKeys.filter((key) => ownedMusicPrefixes.some((prefix) => key.startsWith(prefix)))]
      .filter((key) => musicFile.test(key)).map(publicObjectUrl);
  }
  if (!/^[0-9a-f-]{36}$/i.test(folderId)) return [];
  const manifest = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: `media-projects/${folderId}/.project.json` })).then(async (object) => JSON.parse(await object.Body!.transformToString()) as { ownerId?: string; kind?: string }).catch(() => null);
  if (!manifest || manifest.ownerId !== ownerId || manifest.kind !== "music") return [];
  return (await listKeys(`media-projects/${folderId}/music/`)).filter((key) => musicFile.test(key)).map(publicObjectUrl);
}

export async function POST(request: Request) {
  const authorization = await requireApiSession(request, { apiKeyScope: "videos:write" }); if (authorization.response) return authorization.response;
  const body = await request.json().catch(() => null) as BatchInput | null;
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  const hooks = Array.isArray(body?.hooks) ? body.hooks.map((value) => typeof value === "string" ? value.trim().slice(0, 500) : "").filter(Boolean).slice(0, 20) : [];
  const accountIds = Array.isArray(body?.accountIds) ? [...new Set(body.accountIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))].slice(0, 12) : [];
  if (!projectId || !hooks.length) return Response.json({ error: "Choose a video project and provide between 1 and 20 hooks." }, { status: 400 });
  const [row] = await sql<VideoProjectRow[]>`SELECT * FROM "video_project" WHERE id=${projectId} AND owner_id=${authorization.session.user.id}`;
  if (!row) return Response.json({ error: "Video project not found." }, { status: 404 });
  const accounts = accountIds.length ? await sql<{ id: string; provider: ProviderId }[]>`SELECT id, provider FROM "social_account" WHERE id=ANY(${accountIds}) AND owner_id=${authorization.session.user.id} AND status='connected'` : [];
  if (accounts.length !== accountIds.length) return Response.json({ error: "One or more scheduling destinations were not found or need reconnecting." }, { status: 400 });
  const project = serializeVideoProject(row); const mode: VideoMusicMode = body?.musicMode === "fixed" || body?.musicMode === "rotate" || body?.musicMode === "random" ? body.musicMode : "none";
  const folderId = typeof body?.musicFolderId === "string" ? body.musicFolderId.trim() : project.musicFolderId ?? "";
  const folderMusic = mode === "rotate" || mode === "random" ? await musicUrls(folderId, authorization.session.user.id) : [];
  const fixedMusic = safeWebUrl(body?.musicUrl) || project.musicUrl;
  if (mode === "fixed" && !fixedMusic) return Response.json({ error: "Choose one music track for fixed music mode." }, { status: 400 });
  if ((mode === "rotate" || mode === "random") && !folderMusic.length) return Response.json({ error: "The selected music source has no supported audio files." }, { status: 400 });
  const start = typeof body?.scheduledAt === "string" && !Number.isNaN(new Date(body.scheduledAt).getTime()) ? new Date(body.scheduledAt) : null;
  const interval = Math.min(10_080, Math.max(1, Math.round(Number(body?.intervalMinutes) || 1_440)));
  const template = typeof body?.captionTemplate === "string" ? body.captionTemplate.slice(0, 2_200) : project.caption || "{hook}";
  const requestPrefix = typeof body?.clientRequestId === "string" ? body.clientRequestId.trim().slice(0, 190) : `video-batch-${crypto.randomUUID()}`;
  const outputFolderId = crypto.randomUUID();
  const outputFolderName = `${project.name.slice(0, 68)} · batch ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const outputConfig = getR2Config();
  await getR2Client().send(new PutObjectCommand({ Bucket: outputConfig.bucket, Key: `media-projects/${outputFolderId}/.project.json`, Body: JSON.stringify({ id: outputFolderId, name: outputFolderName, kind: "media", ownerId: authorization.session.user.id, createdAt: new Date().toISOString() }), ContentType: "application/json" }));
  const results: Array<Record<string, unknown>> = [];
  for (let index = 0; index < hooks.length; index += 1) {
    const hook = hooks[index]; const musicUrl = selectMusicTrack(mode, folderMusic, index, fixedMusic);
    try {
      const labels = project.labels.length ? project.labels.map((label, labelIndex) => labelIndex === 0 ? { ...label, text: hook } : label) : [{ id: crypto.randomUUID(), text: hook, x: .5, y: .18, width: .84, height: .12, fontSize: 72, font: "modern" as const, textColor: "#FFFFFF", background: "dark" as const, style: "dark" as const }];
      const safeHook = hook.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 64) || `video-${index + 1}`;
      const renderedUrl = await renderVideoArtifact({ projectId, sourceUrl: project.sourceUrl, musicUrl, labels, targetKey: `media-projects/${outputFolderId}/media/${String(index + 1).padStart(2, "0")}-${safeHook}.mp4` });
      let post: unknown = null;
      if (accounts.length) {
        const scheduledAt = start ? new Date(start.getTime() + index * interval * 60_000).toISOString() : undefined; const status = scheduledAt ? "scheduled" : "publishing";
        const internalOrigin = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
        const response = await fetch(new URL("/api/v1/posts", internalOrigin), { method: "POST", headers: { Authorization: request.headers.get("authorization") ?? "", Cookie: request.headers.get("cookie") ?? "", "Content-Type": "application/json" }, body: JSON.stringify({ clientRequestId: `${requestPrefix}-${index}`, brandId: project.brandId || undefined, text: template.replaceAll("{hook}", hook), mediaType: "video", mediaUrl: renderedUrl, status, scheduledAt, targets: accounts.map((account) => ({ accountId: account.id, settings: settings(account.provider, hook) })) }) });
        const payload = await response.json() as { data?: unknown; error?: string }; if (!response.ok) throw new Error(payload.error || "The video rendered but could not be scheduled."); post = payload.data;
      }
      results.push({ index, hook, renderedUrl, musicUrl: musicUrl ?? null, post, status: accounts.length ? "scheduled" : "rendered" });
    } catch (error) { results.push({ index, hook, error: error instanceof Error ? error.message : "Could not create this video.", status: "failed" }); }
  }
  const failed = results.filter((result) => result.status === "failed").length;
  return Response.json({ data: results, folder: { id: outputFolderId, name: outputFolderName }, summary: { created: results.length - failed, failed } }, { status: failed ? 207 : 201 });
}
