import "server-only";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { CreativeLabel, VideoClip, VideoTimeline } from "@relay/core";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import { clipSchedule, effectiveMusicRange, layerSchedule, timelineDuration, videoSizes } from "./video-timeline";
import { creativeLabelsSvg } from "./creative-label-svg";
import { deviceBackgroundSvg, deviceFrameLayerSvg } from "./device-frames";
import { deviceVideoSceneFilter } from "./device-motion";
import { animatedLabelsMarkup } from "./animated-label-markup";
import { timelineJoinFilter } from "./video-transition";
import { videoCameraFilter } from "./video-camera";
import { getR2Client, getR2Config, publicObjectUrl } from "./r2";

function allowedAssetUrl(value: string): boolean {
  try { const base = new URL(`${getR2Config().publicUrl}/`); const url = new URL(value); return url.protocol === "https:" && url.origin === base.origin && url.pathname.startsWith(base.pathname); } catch { return false; }
}

export async function download(url: string, maximum: number, signal?: AbortSignal): Promise<Buffer> {
  if (!allowedAssetUrl(url)) throw new Error("Video and music must come from this Relay R2 library.");
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000), redirect: "error" });
  if (!response.ok) throw new Error(`Could not download an R2 asset (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length") || 0) > maximum) throw new Error("An input asset exceeds the rendering size limit.");
  if (!response.body) throw new Error("The media response was empty.");
  const reader=response.body.getReader();const chunks:Buffer[]=[];let size=0;
  try { while(true) { const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>maximum){await reader.cancel();throw new Error("An input asset exceeds the rendering size limit.");}chunks.push(Buffer.from(chunk.value));} } finally {reader.releaseLock();}
  return Buffer.concat(chunks,size);
}

export async function command(binary: string, args: string[], signal?: AbortSignal, timeoutMs = 900_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], signal, timeout: timeoutMs }); let output = "";
    child.stdout.on("data", (chunk) => { output = (output + String(chunk)).slice(-100_000); }); child.stderr.on("data", (chunk) => { output = (output + String(chunk)).slice(-100_000); });
    child.on("error", (error) => reject(new Error(`${binary} could not start: ${error.message}`)));
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`${binary} failed: ${output.slice(-1_200)}`)));
  });
}

async function renderAnimatedLabels(timeline: VideoTimeline, width: number, height: number, output: string, signal?: AbortSignal): Promise<void> {
  const durationMs = timelineDuration(timeline);
  const encoder = spawn("ffmpeg", ["-v", "error", "-y", "-threads", "2", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${width}x${height}`, "-framerate", "30", "-i", "pipe:0", "-c:v", "qtrle", "-pix_fmt", "argb", output], { stdio: ["pipe", "ignore", "pipe"], signal, timeout: Math.max(900_000, durationMs * 12 + 60_000) });
  let error = "";
  encoder.stderr.on("data", chunk => { error = (error + String(chunk)).slice(-2000); });
  encoder.stdin.on("error", () => {}); // write callbacks propagate encoder failures
  const done = new Promise<void>((resolve, reject) => {
    encoder.once("error", reject);
    encoder.once("close", code => code === 0 ? resolve() : reject(new Error(`Animated labels failed: ${error}`)));
  });
  // Keep rejection observed while producing frames, then propagate it below.
  void done.catch(() => {});
  const cache = new Map<string, Buffer>();
  try {
    for (let frame = 0; frame < Math.ceil(durationMs / 1000 * 30); frame++) {
      signal?.throwIfAborted();
      const svg = animatedLabelsMarkup(timeline.labels, frame / 30 * 1000, width, height);
      let pixels = cache.get(svg);
      if (!pixels) {
        pixels = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer();
        if (cache.size >= 8) cache.delete(cache.keys().next().value!);
        cache.set(svg, pixels);
      }
      await new Promise<void>((resolve, reject) => encoder.stdin.write(pixels!, error => error ? reject(error) : resolve()));
    }
    encoder.stdin.end(); await done;
  } catch (error) { encoder.kill("SIGTERM"); await done.catch(() => {}); throw error; }
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
    const [sourceData, musicData] = await Promise.all([download(input.sourceUrl, 500 * 1024 * 1024, input.signal), input.musicUrl ? download(input.musicUrl, 100 * 1024 * 1024, input.signal) : Promise.resolve(null)]);
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
  if (!durationMs) throw new Error("Add clips or layers before rendering.");
  const [width,height] = videoSizes[timeline.aspectRatio];
  const dir = await mkdtemp(join(tmpdir(),"relay-timeline-"));
  // Animated projective maps cost more than realtime. Keep a bounded allowance
  // tied to media duration; the render worker renews its lease and cancellation
  // still terminates the child immediately.
  const run = (args: string[], seconds = 0) => command("ffmpeg",["-y","-threads","2",...args],input.signal,Math.max(900_000,Math.ceil(seconds*12_000+60_000)));
  try {
    const layers = layerSchedule(timeline);
    const totalSegments = timeline.clips.length + layers.length;
    let renderedSegments = 0;
    // Lossless alpha-bearing intermediates keep each device independent. The
    // opaque canvas is introduced only once, below all simultaneous layers.
    const renderSegment = async (c: VideoClip, key: string, transparent = false) => {
      input.signal?.throwIfAborted();
      const source=join(dir,`input-${key}`); const dest=join(dir,`clip-${key}.${transparent ? "mkv" : "mp4"}`);
      await writeFile(source,await download(c.sourceUrl,500*1024*1024,input.signal));
      const probe=JSON.parse(await command("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type","-of","json",source],input.signal)) as {format?:{duration?:string};streams?:Array<{codec_type?:string}>};
      const seconds=(c.outMs-c.inMs)/1000;
      if (c.kind === "video" && (!Number.isFinite(Number(probe.format?.duration)) || c.outMs > Number(probe.format?.duration)*1000+100)) throw new Error(`Trim exceeds duration of ${c.name}.`);
      const audio=c.kind === "video" && probe.streams?.some(s=>s.codec_type==="audio");
      const args=[...(c.kind==="image"?["-loop","1"]:["-ss",String(c.inMs/1000)]),"-i",source];
      if (c.deviceFrame) {
        const frame=join(dir,`frame-${key}.png`);
        await writeFile(frame,await sharp(Buffer.from(deviceFrameLayerSvg(width,height,c.deviceFrame))).png().toBuffer());
        args.push("-i",frame);
      }
      const backgroundIndex=c.deviceFrame ? 2 : 1;
      const background=join(dir,`background-${key}.png`);
      const color=timeline.background?.color ?? c.deviceFrame?.background ?? "#000000";
      const endColor=timeline.background ? timeline.background.endColor : c.deviceFrame?.backgroundEnd;
      await writeFile(background,transparent
        ? await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer()
        : await sharp(Buffer.from(deviceBackgroundSvg(width,height,color,endColor))).png().toBuffer());
      args.push("-i",background);
      const silentAudioIndex=backgroundIndex+1;
      if (!audio) args.push("-f","lavfi","-i","anullsrc=r=48000:cl=stereo");
      const sceneScript=join(dir,`scene-${key}.fffilter`);
      await writeFile(sceneScript,deviceVideoSceneFilter(width,height,c,backgroundIndex,c.outMs-c.inMs,transparent));
      args.push("-filter_complex_threads","1","-filter_complex_script",sceneScript);
      args.push("-t",String(seconds),"-af",`volume=${c.volume},aresample=48000,apad,atrim=duration=${seconds},asetpts=PTS-STARTPTS`,"-map","[framed]","-map",audio?"0:a:0":`${silentAudioIndex}:a:0`,
        ...(transparent ? ["-c:v","ffv1","-level","3","-pix_fmt","bgra"] : ["-c:v","libx264","-preset","veryfast","-crf","21"]),"-c:a","aac","-ac","2",dest);
      await run(args,seconds); await input.onProgress?.(Math.round(++renderedSegments/totalSegments*70));
      return dest;
    };
    const segments: string[]=[];
    for (let i=0;i<timeline.clips.length;i++) segments.push(await renderSegment(timeline.clips[i],String(i)));
    const layerSegments: string[]=[];
    for (const layer of layers) layerSegments.push(await renderSegment(layer.clip,`layer-${layer.index}`,true));
    const base=join(dir,"base.mp4");
    const baseDurationMs=clipSchedule(timeline).at(-1)?.endMs ?? 0;
    if (!segments.length) {
      const background=join(dir,"canvas.png");
      await writeFile(background,await sharp(Buffer.from(deviceBackgroundSvg(width,height,timeline.background?.color ?? "#000000",timeline.background?.endColor))).png().toBuffer());
      await run(["-loop","1","-framerate","30","-i",background,"-f","lavfi","-i","anullsrc=r=48000:cl=stereo","-t",String(durationMs/1000),"-c:v","libx264","-preset","veryfast","-crf","21","-pix_fmt","yuv420p","-c:a","aac",base],durationMs/1000);
    } else if (timeline.clips.some((clip, i) => i > 0 && clip.transition)) {
      const transitionScript=join(dir,"transitions.fffilter"); await writeFile(transitionScript,timelineJoinFilter(timeline.clips));
      await run([...segments.flatMap(segment => ["-i",segment]), "-filter_complex_threads","1","-filter_complex_script",transitionScript,"-map","[video]","-map","[audio]","-t",String(baseDurationMs/1000),"-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac",base],baseDurationMs/1000);
    } else {
      const list=join(dir,"concat.txt"); await writeFile(list,segments.map(path=>`file '${path}'`).join("\n"));
      await run(["-f","concat","-safe","0","-i",list,"-c","copy",base]);
    }
    // If a layer outlives the sequential footage, the canvas continues while
    // the old footage and its audio stop at their own scheduled end.
    let preparedBase=base;
    if (segments.length && durationMs>baseDurationMs) {
      const background=join(dir,"padding.png");
      await writeFile(background,await sharp(Buffer.from(deviceBackgroundSvg(width,height,timeline.background?.color ?? "#000000",timeline.background?.endColor))).png().toBuffer());
      preparedBase=join(dir,"padded-base.mp4");
      await run(["-i",base,"-loop","1","-framerate","30","-i",background,"-filter_complex_threads","1","-filter_complex",`[1:v][0:v]overlay=0:0:enable='lt(t,${baseDurationMs/1000})'[video];[0:a]apad,atrim=duration=${durationMs/1000}[audio]`,"-map","[video]","-map","[audio]","-t",String(durationMs/1000),"-c:v","libx264","-preset","veryfast","-crf","21","-c:a","aac",preparedBase],durationMs/1000);
    }
    const args=["-i",preparedBase]; const filters: string[]=[]; let video="0:v";
    const layerAudio: string[]=["0:a"];
    for (const layer of layers) {
      const index=layer.index+1;
      args.push("-i",layerSegments[layer.index]);
      filters.push(`[${index}:v]setpts=PTS-STARTPTS+${layer.startMs/1000}/TB[layer${layer.index}]`);
      const out=`vlayer${layer.index}`;
      filters.push(`[${video}][layer${layer.index}]overlay=0:0:format=auto:enable='gte(t,${layer.startMs/1000})*lt(t,${layer.endMs/1000})'[${out}]`);
      video=out;
      filters.push(`[${index}:a]atrim=duration=${(layer.endMs-layer.startMs)/1000},asetpts=PTS-STARTPTS,adelay=${layer.startMs}:all=1[alayer${layer.index}]`);
      layerAudio.push(`alayer${layer.index}`);
    }
    let audio="0:a";
    if (layers.length) {
      filters.push(`${layerAudio.map(name=>`[${name}]`).join("")}amix=inputs=${layerAudio.length}:duration=first:normalize=0[alayers]`);
      audio="alayers";
    }
    // The scene camera moves the composited footage and all device layers
    // together. Text remains screen-aligned and audio retains its original time.
    if (timeline.camera) {
      filters.push(`[${video}]${videoCameraFilter(timeline.camera,width,height)}[vcamera]`);
      video = "vcamera";
    }
    // Each label is composited only for its own half-open time interval.
    const animated = timeline.labels.some(label => label.animation && (label.animation.entrance || label.animation.exit || label.animation.keyframes?.length));
    let labelInputs = 0;
    if (animated) {
      const overlay = join(dir,"animated-labels.mov");
      await renderAnimatedLabels(timeline,width,height,overlay,input.signal);
      args.push("-i",overlay); labelInputs = 1;
      filters.push(`[${video}][${layers.length+1}:v]overlay=0:0:format=auto[vlabels]`); video = "vlabels";
    } else for(let i=0;i<timeline.labels.length;i++) {
      const label=timeline.labels[i]; const file=join(dir,`label-${i}.png`);
      await writeFile(file,await sharp(creativeLabelsSvg([label],width,height)).png().toBuffer());
      args.push("-loop","1","-i",file);
      const out=`v${i}`; filters.push(`[${video}][${i+layers.length+1}:v]overlay=0:0:enable='gte(t,${label.startMs/1000})*lt(t,${label.endMs/1000})'[${out}]`); video=out;
      labelInputs++;
    }
    const musicRange=effectiveMusicRange(timeline.music,durationMs);
    if(timeline.music.url&&musicRange) {
      const file=join(dir,"music"); await writeFile(file,await download(timeline.music.url,100*1024*1024,input.signal));
      const index=layers.length+labelInputs+1; args.push("-stream_loop","-1","-ss",String(timeline.music.offsetMs/1000),"-i",file);
      const activeSeconds=musicRange.durationMs/1000;
      const fadeIn=Math.min(musicRange.durationMs,timeline.music.fadeInMs)/1000, fadeOut=Math.min(musicRange.durationMs,timeline.music.fadeOutMs)/1000;
      const musicFilters=[`atrim=duration=${activeSeconds}`,"asetpts=PTS-STARTPTS",`volume=${timeline.music.volume}`];
      if(fadeIn>0) musicFilters.push(`afade=t=in:st=0:d=${fadeIn}`);
      if(fadeOut>0) musicFilters.push(`afade=t=out:st=${activeSeconds-fadeOut}:d=${fadeOut}`);
      if(musicRange.startMs>0) musicFilters.push(`adelay=${musicRange.startMs}:all=1`);
      filters.push(`[${index}:a]${musicFilters.join(",")}[music]`);
      filters.push(`[${audio}][music]amix=inputs=2:duration=first:normalize=0[audio]`); audio="audio";
    }
    if(filters.length) { const script=join(dir,"labels-audio.fffilter");await writeFile(script,filters.join(";"));args.push("-filter_complex_threads","1","-filter_complex_script",script); }
    const output=join(dir,"output.mp4");
    args.push("-map",video==="0:v"?video:`[${video}]`,"-map",audio==="0:a"?audio:`[${audio}]`,"-t",String(durationMs/1000),"-c:v","libx264","-preset","veryfast","-crf","21","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",output);
    await run(args,durationMs/1000); await input.onProgress?.(95); input.signal?.throwIfAborted();
    const key=input.targetKey ?? `videos/${input.projectId}/${crypto.randomUUID()}.mp4`; const config=getR2Config();
    await getR2Client().send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:await readFile(output),ContentType:"video/mp4",CacheControl:"public, max-age=31536000, immutable"}));
    const cover=join(dir,"cover.jpg");await run(["-ss",String(timeline.coverMs/1000),"-i",output,"-frames:v","1","-q:v","2",cover]);
    const coverKey=key.replace(/\.mp4$/, ".jpg");await getR2Client().send(new PutObjectCommand({Bucket:config.bucket,Key:coverKey,Body:await readFile(cover),ContentType:"image/jpeg",CacheControl:"public, max-age=31536000, immutable"}));
    return {url:publicObjectUrl(key),coverUrl:publicObjectUrl(coverKey),durationMs};
  } finally { await rm(dir,{recursive:true,force:true}); }
}
