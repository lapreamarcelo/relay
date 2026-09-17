import "server-only";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { CreativeLabel, VideoTimeline } from "@relay/core";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import { timelineDuration, videoSizes } from "./video-timeline";
import { creativeLabelsSvg } from "./creative-label-svg";
import { getR2Client, getR2Config, publicObjectUrl } from "./r2";

function allowedAssetUrl(value: string): boolean {
  try { const base = new URL(`${getR2Config().publicUrl}/`); const url = new URL(value); return url.protocol === "https:" && url.origin === base.origin && url.pathname.startsWith(base.pathname); } catch { return false; }
}

export async function download(url: string, maximum: number): Promise<Buffer> {
  if (!allowedAssetUrl(url)) throw new Error("Video and music must come from this Relay R2 library.");
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
  if (!response.ok) throw new Error(`Could not download an R2 asset (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length") || 0) > maximum) throw new Error("An input asset exceeds the rendering size limit.");
  if (!response.body) throw new Error("The media response was empty.");
  const reader=response.body.getReader();const chunks:Buffer[]=[];let size=0;
  try { while(true) { const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>maximum){await reader.cancel();throw new Error("An input asset exceeds the rendering size limit.");}chunks.push(Buffer.from(chunk.value));} } finally {reader.releaseLock();}
  return Buffer.concat(chunks,size);
}

export async function command(binary: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], signal, timeout: 900_000 }); let output = "";
    child.stdout.on("data", (chunk) => { output = (output + String(chunk)).slice(-100_000); }); child.stderr.on("data", (chunk) => { output = (output + String(chunk)).slice(-100_000); });
    child.on("error", (error) => reject(new Error(`${binary} could not start: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${binary} failed: ${output.slice(-1_200)}`)));
  });
}

export interface RenderedVideoArtifact {
  coverUrl?: string;
  url: string;
  durationMs: number;
}

export async function renderVideoArtifactDetails(input: { projectId: string; sourceUrl: string; musicUrl?: string | null; labels: CreativeLabel[]; targetKey?: string; timeline?: VideoTimeline; signal?: AbortSignal; onProgress?: (value: number) => Promise<void> }): Promise<RenderedVideoArtifact> {
  if (input.timeline) return renderTimeline(input as typeof input & { timeline: VideoTimeline });
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
    if (musicData && hasSourceAudio) { filter += ";[0:a:0]volume=0.2[a0];[2:a:0]volume=0.8[a1];[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[a]"; audioMap = ["-map", "[a]"]; }
    else if (musicData) { filter += ";[2:a:0]volume=0.85[a]"; audioMap = ["-map", "[a]"]; }
    // Phone videos can contain auxiliary audio tracks with unsupported codecs.
    // Export the primary audio track, as the timeline renderer does.
    else if (hasSourceAudio) audioMap = ["-map", "0:a:0?"];
    args.push("-filter_complex", filter, "-map", "[v]", ...audioMap, "-t", duration.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output);
    await command("ffmpeg", args, input.signal);
    const body = await readFile(output); const key = input.targetKey ?? `videos/${input.projectId}/${crypto.randomUUID()}.mp4`; const config = getR2Config();
    await getR2Client().send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body, ContentType: "video/mp4", CacheControl: "public, max-age=31536000, immutable" }));
    return { url: publicObjectUrl(key), durationMs: Math.round(duration * 1_000) };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function renderVideoArtifact(input: { projectId: string; sourceUrl: string; musicUrl?: string | null; labels: CreativeLabel[]; targetKey?: string; timeline?: VideoTimeline; signal?: AbortSignal; onProgress?: (value: number) => Promise<void> }): Promise<string> {
  return (await renderVideoArtifactDetails(input)).url;
}


async function renderTimeline(input: { projectId: string; timeline: VideoTimeline; targetKey?: string; signal?: AbortSignal; onProgress?: (value: number) => Promise<void> }): Promise<RenderedVideoArtifact> {
  const timeline = input.timeline; const durationMs = timelineDuration(timeline);
  if (!timeline.clips.length || !durationMs) throw new Error("Add clips before rendering.");
  const [width,height] = videoSizes[timeline.aspectRatio];
  const dir = await mkdtemp(join(tmpdir(),"relay-timeline-"));
  const run = (args: string[]) => command("ffmpeg",["-y","-threads","2",...args],input.signal);
  try {
    const segments: string[]=[];
    for (let i=0;i<timeline.clips.length;i++) {
      input.signal?.throwIfAborted();
      const c=timeline.clips[i]; const source=join(dir,`input-${i}`); const dest=join(dir,`clip-${i}.mp4`);
      await writeFile(source,await download(c.sourceUrl,500*1024*1024));
      const probe=JSON.parse(await command("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type","-of","json",source],input.signal)) as {format?:{duration?:string};streams?:Array<{codec_type?:string}>};
      const seconds=(c.outMs-c.inMs)/1000;
      if (c.kind === "video" && (!Number.isFinite(Number(probe.format?.duration)) || c.outMs > Number(probe.format?.duration)*1000+100)) throw new Error(`Trim exceeds duration of ${c.name}.`);
      const audio=c.kind === "video" && probe.streams?.some(s=>s.codec_type==="audio");
      const sw=Math.ceil(width*c.zoom/2)*2, sh=Math.ceil(height*c.zoom/2)*2;
      const fit=c.fit === "cover" ? `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${width}:${height}:(iw-ow)*${c.x}:(ih-oh)*${c.y}` : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)*${c.x}:(oh-ih)*${c.y}:black`;
      const args=[...(c.kind==="image"?["-loop","1"]:["-ss",String(c.inMs/1000)]),"-i",source];
      if (!audio) args.push("-f","lavfi","-i","anullsrc=r=48000:cl=stereo");
      args.push("-t",String(seconds),"-vf",`${fit},setsar=1,fps=30,format=yuv420p`,"-af",`volume=${c.volume},aresample=48000`,"-map","0:v:0","-map",audio?"0:a:0":"1:a:0","-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac","-ac","2",dest);
      await run(args); segments.push(dest); await input.onProgress?.(Math.round((i+1)/timeline.clips.length*70));
    }
    const list=join(dir,"concat.txt"); await writeFile(list,segments.map(path=>`file '${path}'`).join("\n"));
    const base=join(dir,"base.mp4"); await run(["-f","concat","-safe","0","-i",list,"-c","copy",base]);
    // Each label is composited only for its own half-open time interval.
    const args=["-i",base]; const filters: string[]=[]; let video="0:v";
    for(let i=0;i<timeline.labels.length;i++) {
      const label=timeline.labels[i]; const file=join(dir,`label-${i}.png`);
      await writeFile(file,await sharp(creativeLabelsSvg([label],width,height)).png().toBuffer());
      args.push("-loop","1","-i",file);
      const out=`v${i}`; filters.push(`[${video}][${i+1}:v]overlay=0:0:enable='gte(t,${label.startMs/1000})*lt(t,${label.endMs/1000})'[${out}]`); video=out;
    }
    let audio="0:a";
    if(timeline.music.url) {
      const file=join(dir,"music"); await writeFile(file,await download(timeline.music.url,100*1024*1024));
      const index=timeline.labels.length+1; args.push("-stream_loop","-1","-ss",String(timeline.music.offsetMs/1000),"-i",file);
      const fadeIn=Math.min(durationMs,timeline.music.fadeInMs)/1000, fadeOut=Math.min(durationMs,timeline.music.fadeOutMs)/1000;
      filters.push(`[${index}:a]volume=${timeline.music.volume},afade=t=in:st=0:d=${Math.max(.001,fadeIn)},afade=t=out:st=${durationMs/1000-fadeOut}:d=${Math.max(.001,fadeOut)}[music]`);
      filters.push("[0:a][music]amix=inputs=2:duration=first:normalize=0[audio]"); audio="audio";
    }
    if(filters.length) args.push("-filter_complex_threads","1","-filter_complex",filters.join(";"));
    const output=join(dir,"output.mp4");
    args.push("-map",video==="0:v"?video:`[${video}]`,"-map",audio==="0:a"?audio:`[${audio}]`,"-t",String(durationMs/1000),"-c:v","libx264","-preset","veryfast","-crf","21","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",output);
    await run(args); await input.onProgress?.(95); input.signal?.throwIfAborted();
    const key=input.targetKey ?? `videos/${input.projectId}/${crypto.randomUUID()}.mp4`; const config=getR2Config();
    await getR2Client().send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:await readFile(output),ContentType:"video/mp4",CacheControl:"public, max-age=31536000, immutable"}));
    const cover=join(dir,"cover.jpg");await run(["-ss",String(timeline.coverMs/1000),"-i",output,"-frames:v","1","-q:v","2",cover]);
    const coverKey=key.replace(/\.mp4$/, ".jpg");await getR2Client().send(new PutObjectCommand({Bucket:config.bucket,Key:coverKey,Body:await readFile(cover),ContentType:"image/jpeg",CacheControl:"public, max-age=31536000, immutable"}));
    return {url:publicObjectUrl(key),coverUrl:publicObjectUrl(coverKey),durationMs};
  } finally { await rm(dir,{recursive:true,force:true}); }
}
