import "server-only";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { CreativeLabel } from "@relay/core";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import { creativeLabelsSvg } from "./creative-label-svg";
import { getR2Client, getR2Config, publicObjectUrl } from "./r2";

function allowedAssetUrl(value: string): boolean {
  try { const base = new URL(`${getR2Config().publicUrl}/`); const url = new URL(value); return url.protocol === "https:" && url.origin === base.origin && url.pathname.startsWith(base.pathname); } catch { return false; }
}

async function download(url: string, maximum: number): Promise<Buffer> {
  if (!allowedAssetUrl(url)) throw new Error("Video and music must come from this Relay R2 library.");
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not download an R2 asset (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length") || 0) > maximum) throw new Error("An input asset exceeds the rendering size limit.");
  const data = Buffer.from(await response.arrayBuffer()); if (data.length > maximum) throw new Error("An input asset exceeds the rendering size limit."); return data;
}

async function command(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] }); let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); }); child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("error", (error) => reject(new Error(`${binary} could not start: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${binary} failed: ${output.slice(-1_200)}`)));
  });
}

export interface RenderedVideoArtifact {
  url: string;
  durationMs: number;
}

export async function renderVideoArtifactDetails(input: { projectId: string; sourceUrl: string; musicUrl?: string | null; labels: CreativeLabel[]; targetKey?: string }): Promise<RenderedVideoArtifact> {
  if (!input.sourceUrl) throw new Error("Choose a source video before rendering.");
  const directory = await mkdtemp(join(tmpdir(), "relay-video-"));
  const source = join(directory, "source.mp4"); const overlay = join(directory, "overlay.png"); const music = join(directory, "music"); const output = join(directory, "output.mp4");
  try {
    const [sourceData, musicData] = await Promise.all([download(input.sourceUrl, 500 * 1024 * 1024), input.musicUrl ? download(input.musicUrl, 100 * 1024 * 1024) : Promise.resolve(null)]);
    await Promise.all([writeFile(source, sourceData), writeFile(overlay, await sharp(creativeLabelsSvg(input.labels)).png().toBuffer()), ...(musicData ? [writeFile(music, musicData)] : [])]);
    const probe = JSON.parse(await command("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-show_entries", "stream=codec_type", "-of", "json", source])) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
    const duration = Number(probe.format?.duration || 0); if (!duration || duration > 300) throw new Error("Source videos must be between one second and five minutes.");
    const hasSourceAudio = probe.streams?.some((stream) => stream.codec_type === "audio") ?? false;
    const args = ["-y", "-i", source, "-loop", "1", "-i", overlay]; if (musicData) args.push("-stream_loop", "-1", "-i", music);
    const videoFilter = "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[base];[base][1:v]overlay=0:0:format=auto[v]";
    let filter = videoFilter; let audioMap: string[] = [];
    if (musicData && hasSourceAudio) { filter += ";[0:a]volume=0.2[a0];[2:a]volume=0.8[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]"; audioMap = ["-map", "[a]"]; }
    else if (musicData) { filter += ";[2:a]volume=0.85[a]"; audioMap = ["-map", "[a]"]; }
    else if (hasSourceAudio) audioMap = ["-map", "0:a?"];
    args.push("-filter_complex", filter, "-map", "[v]", ...audioMap, "-t", duration.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output);
    await command("ffmpeg", args);
    const body = await readFile(output); const key = input.targetKey ?? `videos/${input.projectId}/${crypto.randomUUID()}.mp4`; const config = getR2Config();
    await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: "video/mp4", CacheControl: "public, max-age=31536000, immutable" }));
    return { url: publicObjectUrl(key), durationMs: Math.round(duration * 1_000) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function renderVideoArtifact(input: { projectId: string; sourceUrl: string; musicUrl?: string | null; labels: CreativeLabel[]; targetKey?: string }): Promise<string> {
  return (await renderVideoArtifactDetails(input)).url;
}
