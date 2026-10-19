import "server-only";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { CreativeLabel, VideoClip, VideoTimeline } from "@relay/core";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import { clipSchedule, effectiveMusicRange, layerSchedule, timelineDuration, videoSizes, clipDuration, clipSourceTime, clipMotionTime, clipMotionDuration } from "./video-timeline";
import { creativeLabelsSvg } from "./creative-label-svg";
import {preloadLabelEmoji} from "./label-emoji";
import { deviceBackgroundSvg, deviceBodyLayerSvg, deviceFrameLayerSvg } from "./device-frames";
import { deviceVideoSceneFilter, deviceMeshSvg } from "./device-motion";
import { animatedLabelsMarkup } from "./animated-label-markup";
import { timelineJoinFilter } from "./video-transition";
import { videoCameraFilter } from "./video-camera";
import { exportDimensions, exportProfile } from "./video-export-settings";
import { renderGpuScene } from "./video-gpu-export";
import {timelineAudioAnalysis} from "./video-audio-analysis";
import { graphicsMarkup } from "./video-graphics";
import { pointerSvg } from "./video-pointer";
import { sortSceneLayers } from "./video-scene";
import { getR2Client, getR2Config, publicObjectUrl } from "./r2";
import { assertVideoBackgroundLibraryUrl } from "./library-video-timeline";

function allowedAssetUrl(value: string): boolean {
  try { const base = new URL(`${getR2Config().publicUrl}/`); const url = new URL(value); return url.protocol === "https:" && url.origin === base.origin && url.pathname.startsWith(base.pathname); } catch { return false; }
}

/** Match the preview's centered object-fit, with the gradient showing through
 * letterboxing or transparency. Decode once, bounded independently of bytes. */
async function canvasBackground(width: number, height: number, background: VideoTimeline["background"], image?: Buffer): Promise<Buffer> {
  const backdrop = sharp(Buffer.from(deviceBackgroundSvg(width, height, background?.color ?? "#000000", background?.endColor)));
  if (!image) return backdrop.png().toBuffer();
  try {
    const source = sharp(image, { limitInputPixels: 40_000_000 });
    const metadata = await source.metadata();
    if ((metadata.pages ?? 1) > 1 || (metadata.delay?.length ?? 0) > 1) throw new Error("Use a still image for the canvas background; animated images are not supported.");
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 40_000_000) throw new Error("Background image exceeds the pixel limit.");
    if (!metadata.format || !["jpeg", "png", "webp", "heif", "avif", "gif"].includes(metadata.format)) throw new Error("Choose a PNG, JPEG, WebP or AVIF background image from Media.");
    const pixels = await source
      .rotate().resize(width, height, { fit: background?.imageFit ?? "cover", position: "centre", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png().toBuffer();
    return await backdrop.composite([{ input: pixels }]).png().toBuffer();
  } catch (error) {
    if (error instanceof Error && (error.message.startsWith("Use a still image") || error.message.startsWith("Choose a PNG"))) throw error;
    throw new Error("Choose a valid background image from Media (up to 30 MB and 40 megapixels).");
  }
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

/** atempo's universally supported range is .5..2; chain extreme rates. */
export function sourceAudioTempo(speed: number): string {
  if (!Number.isFinite(speed) || speed < .25 || speed > 4) throw new Error("Choose playback speed between .25 and 4.");
  const filters: string[]=[];
  let rate=speed;
  while (rate < .5) { filters.push("atempo=0.5"); rate/=.5; }
  while (rate > 2) { filters.push("atempo=2"); rate/=2; }
  if (rate !== 1) filters.push(`atempo=${rate}`);
  return filters.length ? `${filters.join(",")},` : "";
}

async function renderRgbaFrames(durationMs: number, fps: number, width: number, height: number, output: string, svgAt: (timeMs: number) => string, signal?: AbortSignal): Promise<void> {
  const encoder = spawn("ffmpeg", ["-v", "error", "-y", "-threads", "2", "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", `${width}x${height}`, "-framerate", String(fps), "-i", "pipe:0", "-c:v", "qtrle", "-pix_fmt", "argb", output], { stdio: ["pipe", "ignore", "pipe"], signal, timeout: Math.max(900_000, durationMs * 12 + 60_000) });
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
    for (let frame = 0; frame < Math.ceil(durationMs / 1000 * fps); frame++) {
      signal?.throwIfAborted();
      const svg = svgAt(frame / fps * 1000);
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
  await preloadLabelEmoji((input.timeline?.labels??input.labels).map(label=>label.text).join("\n"));
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
  const [width,height] = exportDimensions(timeline);
  const profile = exportProfile(timeline.exportSettings), fps = profile.fps;
  const [designWidth,designHeight] = videoSizes[timeline.aspectRatio];
  const dir = await mkdtemp(join(tmpdir(),"relay-timeline-"));
  // Animated projective maps cost more than realtime. Keep a bounded allowance
  // tied to media duration; the render worker renews its lease and cancellation
  // still terminates the child immediately.
  const run = (args: string[], seconds = 0) => command("ffmpeg",["-y","-threads","2",...args],input.signal,Math.max(900_000,Math.ceil(seconds*12_000+60_000)));
  try {
    // A project image is fetched and decoded once; each segment and the tail
    // reuse identical pixels. Independent device layers stay transparent.
    assertVideoBackgroundLibraryUrl(timeline);
    const backgroundImage = timeline.background?.imageUrl ? await download(timeline.background.imageUrl, 30 * 1024 * 1024, input.signal) : undefined;
    const sharedBackground = await canvasBackground(width, height, timeline.background, backgroundImage);
    const layers = layerSchedule(timeline);
    const totalSegments = timeline.clips.length + layers.length;
    let renderedSegments = 0;
    const gpuMedia=new Map<string,Buffer>();
    const gpuEnabled=[...timeline.clips,...(timeline.layers??[])].some(c=>c.deviceFrame?.renderMode==="gpu")||timeline.labels.some(l=>l.sceneLayer==="scene");
    // Lossless alpha-bearing intermediates keep each device independent. The
    // opaque canvas is introduced only once, below all simultaneous layers.
    const renderSegment = async (original: VideoClip, key: string, transparent = false, startMs = 0) => {
      const c = {...original,deviceFrame:original.deviceFrame ? {...original.deviceFrame,...(timeline.scene ? {scene:timeline.scene} : {})} : undefined};
      input.signal?.throwIfAborted();
      const source=join(dir,`input-${key}`); const dest=join(dir,`clip-${key}.${transparent ? "mkv" : "mp4"}`);
      const sourceBytes=gpuMedia.get(c.sourceUrl)??await download(c.sourceUrl,500*1024*1024,input.signal);
      if(c.deviceFrame?.renderMode==="gpu"){if(!gpuMedia.has(c.sourceUrl)&&[...gpuMedia.values()].reduce((sum,data)=>sum+data.length,0)+sourceBytes.length>512*1024*1024)throw new Error("The 3D scene media exceeds 512 MB. Trim or compress your recordings before export.");gpuMedia.set(c.sourceUrl,sourceBytes);}
      await writeFile(source,sourceBytes);
      const probe=JSON.parse(await command("ffprobe",["-v","error","-show_entries","format=duration:stream=codec_type,width,height","-of","json",source],input.signal)) as {format?:{duration?:string};streams?:Array<{codec_type?:string;width?:number;height?:number}>};
      const seconds=clipDuration(c)/1000;
      const motionDurationMs = clipMotionDuration(timeline,c);
      if (c.kind === "video" && (!Number.isFinite(Number(probe.format?.duration)) || c.outMs > Number(probe.format?.duration)*1000+100)) throw new Error(`Trim exceeds duration of ${c.name}.`);
      const audio=c.kind === "video" && c.freezeMs === undefined && probe.streams?.some(s=>s.codec_type==="audio");
      const sourceSeconds = Number(probe.format?.duration);
      if (c.freezeMs !== undefined && c.kind === "video" && c.freezeMs > sourceSeconds*1000) throw new Error(`Held frame exceeds duration of ${c.name}.`);
      const seekMs = c.freezeMs === undefined ? c.inMs : Math.min(c.freezeMs,Math.max(0,sourceSeconds*1000-1000/fps));
      if(c.deviceFrame?.renderMode==="gpu") {
        const background=join(dir,`gpu-base-${key}.png`);
        await writeFile(background,transparent?await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer():sharedBackground);
        const blank=["-loop","1","-framerate",String(fps),"-i",background,...(audio?["-ss",String(c.inMs/1000),"-i",source]:["-f","lavfi","-i","anullsrc=r=48000:cl=stereo"]),"-t",String(seconds),"-af",`${audio?sourceAudioTempo(c.speed??1):""}volume=${c.volume},aresample=48000,apad,atrim=duration=${seconds},asetpts=PTS-STARTPTS`,"-map","0:v","-map","1:a:0",...(transparent?["-c:v","ffv1","-level","3","-pix_fmt","bgra"]:["-c:v","libx264","-preset","veryfast","-crf",String(profile.crf),"-pix_fmt","yuv420p"]),"-c:a","aac","-ac","2",dest];
        await run(blank,seconds);await input.onProgress?.(Math.round(++renderedSegments/totalSegments*70));return dest;
      }

      const args=[...(c.kind==="image"?["-loop","1","-framerate",String(fps)]:["-ss",String(seekMs/1000)]),"-i",source];
      if (c.deviceFrame) {
        const frame=join(dir,`frame-${key}.png`);
        await writeFile(frame,await sharp(Buffer.from(deviceFrameLayerSvg(width,height,c.deviceFrame))).png().toBuffer());
        args.push("-i",frame);
        const body=join(dir,`body-${key}.${c.deviceFrame.renderMode === "mesh" ? "mov" : "png"}`);
        if (c.deviceFrame.renderMode === "mesh") await renderRgbaFrames(clipDuration(c),fps,width,height,body,time => deviceMeshSvg(width,height,c.deviceFrame!,clipMotionTime(c,time),motionDurationMs,startMs+time,fps),input.signal);
        else await writeFile(body,await sharp(Buffer.from(deviceBodyLayerSvg(width,height,c.deviceFrame))).png().toBuffer());
        args.push("-i",body);
      }
      const backgroundIndex=c.deviceFrame ? 3 : 1;
      const background=join(dir,`background-${key}.png`);
      const color=timeline.background?.color ?? c.deviceFrame?.background ?? "#000000";
      const endColor=timeline.background ? timeline.background.endColor : c.deviceFrame?.backgroundEnd;
      await writeFile(background,transparent
        ? await sharp({create:{width,height,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer()
        : timeline.background ? sharedBackground : await canvasBackground(width,height,{color,endColor}));
      args.push("-i",background);
      const silentAudioIndex=backgroundIndex+1;
      // Decode audio independently: atempo and framesync overlays can deadlock
      // when both consume differently paced streams from the same demuxer.
      if (audio) args.push("-ss",String(c.inMs/1000),"-i",source);
      else args.push("-f","lavfi","-i","anullsrc=r=48000:cl=stereo");
      const sceneScript=join(dir,`scene-${key}.fffilter`);
      const sourceFilters = c.kind === "image" ? `trim=duration=${seconds},setpts=PTS-STARTPTS,fps=${fps}` : c.freezeMs !== undefined ? `trim=duration=${1/fps},setpts=PTS-STARTPTS,fps=${fps},tpad=stop_mode=clone:stop_duration=${seconds}` : `trim=duration=${(c.outMs-c.inMs)/1000},setpts=(PTS-STARTPTS)/${c.speed ?? 1},fps=${fps}`;
      const prefix = [`[0:v]${sourceFilters}[timed]`];
      let sourceInput = "timed";
      let panelSourceInputs: {inner?:string;outer?:string} | undefined;
      if (c.pointer?.events.length) {
        const stream = probe.streams?.find(stream => stream.codec_type === "video");
        const pw=stream?.width ?? width, ph=stream?.height ?? height;
        if (pw*ph > 40_000_000 || pw > 8192 || ph > 8192) throw new Error("Pointer media exceeds the rendering pixel limit.");
        const pointerIndex = silentAudioIndex + 1;
        const duo = c.deviceFrame?.device === "iphone-duo", rear = duo && c.deviceFrame?.renderMode === "mesh";
        if (rear) {
          // Independent decoded panes avoid FFmpeg framesync stalls when split
          // source branches each have a finite pointer overlay and rejoin later.
          prefix.length=0;
          for (const [i,screen] of (["inner","outer"] as const).entries()) {
            const pointer=join(dir,`pointer-${key}-${screen}.mov`), pointed=join(dir,`pointed-${key}-${screen}.mov`);
            await renderRgbaFrames(clipDuration(c),fps,pw,ph,pointer,time => pointerSvg(clipSourceTime(c,time),pw,ph,c.pointer,screen),input.signal);
            await run([...(c.kind === "image" ? ["-loop","1","-framerate",String(fps)] : ["-ss",String(seekMs/1000)]),"-i",source,"-i",pointer,"-filter_complex_threads","1","-filter_complex",`[0:v]${sourceFilters}[timed];[timed][1:v]overlay=0:0:format=auto:shortest=1[pointed]`,"-map","[pointed]","-an","-t",String(seconds),"-c:v","qtrle","-pix_fmt","argb",pointed],seconds);
            args.push("-i",pointed);
          }
          sourceInput=`${pointerIndex}:v`;
          panelSourceInputs={inner:`${pointerIndex}:v`,outer:`${pointerIndex+1}:v`};
        } else {
          // Finish the finite source/pointer overlay before entering the scene's
          // infinite canvas/body framesync graph. Otherwise longer mesh clips
          // can stop with the encoder's last frames still queued at source EOF.
          const pointer=join(dir,`pointer-${key}.mov`), pointed=join(dir,`pointed-${key}.mov`);
          await renderRgbaFrames(clipDuration(c),fps,pw,ph,pointer,time => pointerSvg(clipSourceTime(c,time),pw,ph,c.pointer,duo ? "inner" : "outer"),input.signal);
          await run([...(c.kind === "image" ? ["-loop","1","-framerate",String(fps)] : ["-ss",String(seekMs/1000)]),"-i",source,"-i",pointer,"-filter_complex_threads","1","-filter_complex",`[0:v]${sourceFilters}[timed];[timed][1:v]overlay=0:0:format=auto:shortest=1[pointed]`,"-map","[pointed]","-an","-t",String(seconds),"-c:v","qtrle","-pix_fmt","argb",pointed],seconds);
          args.push("-i",pointed);
          prefix.length=0;
          sourceInput=`${pointerIndex}:v`;
        }
      }
      await writeFile(sceneScript,[...prefix,deviceVideoSceneFilter(width,height,c,backgroundIndex,motionDurationMs,transparent,c.deviceFrame ? 2 : undefined,startMs,sourceInput,fps,panelSourceInputs)].join(";"));
      args.push("-filter_complex_threads","1","-filter_complex_script",sceneScript);
      args.push("-t",String(seconds),"-af",`${audio ? sourceAudioTempo(c.speed ?? 1) : ""}volume=${c.volume},aresample=48000,apad,atrim=duration=${seconds},asetpts=PTS-STARTPTS`,"-map","[framed]","-map",`${silentAudioIndex}:a:0`,
        ...(transparent ? ["-c:v","ffv1","-level","3","-pix_fmt","bgra"] : ["-c:v","libx264","-preset","veryfast","-crf",String(profile.crf)]),"-c:a","aac","-ac","2",dest);
      await run(args,seconds); await input.onProgress?.(Math.round(++renderedSegments/totalSegments*70));
      return dest;
    };
    const segments: string[]=[];
    for (const row of clipSchedule(timeline)) segments.push(await renderSegment(row.clip,String(row.index),false,row.startMs));
    const layerSegments: string[]=[];
    for (const layer of layers) layerSegments.push(await renderSegment(layer.clip,`layer-${layer.index}`,true,layer.startMs));
    const base=join(dir,"base.mp4");
    const baseDurationMs=clipSchedule(timeline).at(-1)?.endMs ?? 0;
    if (!segments.length) {
      const background=join(dir,"canvas.png");
      await writeFile(background,sharedBackground);
      await run(["-loop","1","-framerate",String(fps),"-i",background,"-f","lavfi","-i","anullsrc=r=48000:cl=stereo","-t",String(durationMs/1000),"-c:v","libx264","-preset","veryfast","-crf",String(profile.crf),"-pix_fmt","yuv420p","-c:a","aac",base],durationMs/1000);
    } else if (timeline.clips.some((clip, i) => i > 0 && clip.transition)) {
      const transitionScript=join(dir,"transitions.fffilter"); await writeFile(transitionScript,timelineJoinFilter(timeline.clips,fps));
      await run([...segments.flatMap(segment => ["-i",segment]), "-filter_complex_threads","1","-filter_complex_script",transitionScript,"-map","[video]","-map","[audio]","-t",String(baseDurationMs/1000),"-c:v","libx264","-preset","veryfast","-crf",String(profile.crf),"-c:a","aac",base],baseDurationMs/1000);
    } else {
      const list=join(dir,"concat.txt"); await writeFile(list,segments.map(path=>`file '${path}'`).join("\n"));
      await run(["-f","concat","-safe","0","-i",list,"-c","copy",base]);
    }
    // If a layer outlives the sequential footage, the canvas continues while
    // the old footage and its audio stop at their own scheduled end.
    let preparedBase=base;
    if (segments.length && durationMs>baseDurationMs) {
      const background=join(dir,"padding.png");
      await writeFile(background,sharedBackground);
      preparedBase=join(dir,"padded-base.mp4");
      await run(["-i",base,"-loop","1","-framerate",String(fps),"-i",background,"-filter_complex_threads","1","-filter_complex",`[1:v][0:v]overlay=0:0:enable='lt(t,${baseDurationMs/1000})'[video];[0:a]apad,atrim=duration=${durationMs/1000}[audio]`,"-map","[video]","-map","[audio]","-t",String(durationMs/1000),"-c:v","libx264","-preset","veryfast","-crf",String(profile.crf),"-c:a","aac",preparedBase],durationMs/1000);
    }

    const backLabels=timeline.labels.filter(l=>l.sceneLayer==="back");
    if(backLabels.length){
      const backdrop=join(dir,"back-labels.mov"),withBack=join(dir,"base-back.mp4");
      await renderRgbaFrames(durationMs,fps,width,height,backdrop,time=>animatedLabelsMarkup(backLabels,time,designWidth,designHeight).replace(`width="${designWidth}" height="${designHeight}"`,`width="${width}" height="${height}"`),input.signal);
      await run(["-i",preparedBase,"-i",backdrop,"-filter_complex_threads","1","-filter_complex","[0:v][1:v]overlay=0:0:format=auto[v]","-map","[v]","-map","0:a","-c:v","libx264","-preset","veryfast","-crf",String(profile.crf),"-pix_fmt","yuv420p","-c:a","copy",withBack],durationMs/1000);preparedBase=withBack;
    }
    const overlayLabels=timeline.labels.filter(l=>!l.sceneLayer||l.sceneLayer==="overlay");
    let gpuFilterInsertion=-1,gpuUnder="";
    // AAC priming can shift concat video timestamps by one audio packet.
    // Reset both clocks before adding globally timed overlays and sound.
    const args=["-i",preparedBase]; const filters: string[]=["[0:v]setpts=PTS-STARTPTS[basevideo]","[0:a]asetpts=PTS-STARTPTS[baseaudio]"]; let video="basevideo";
    const layerAudio: string[]=["baseaudio"];
    args.push(...layerSegments.flatMap(segment => ["-i",segment]));
    for (const layer of sortSceneLayers(layers.map(layer => ({...layer,deviceFrame:layer.clip.deviceFrame})))) {
      const index=layer.index+1;
      filters.push(`[${index}:v]setpts=PTS-STARTPTS+${layer.startMs/1000}/TB[layer${layer.index}]`);
      const out=`vlayer${layer.index}`;
      filters.push(`[${video}][layer${layer.index}]overlay=0:0:format=auto:enable='gte(t,${layer.startMs/1000})*lt(t,${layer.endMs/1000})'[${out}]`);
      video=out;
      filters.push(`[${index}:a]atrim=duration=${(layer.endMs-layer.startMs)/1000},asetpts=PTS-STARTPTS,adelay=${layer.startMs}:all=1[alayer${layer.index}]`);
      layerAudio.push(`alayer${layer.index}`);
    }
    let audio="baseaudio";
    if (layers.length) {
      filters.push(`${layerAudio.map(name=>`[${name}]`).join("")}amix=inputs=${layerAudio.length}:duration=first:normalize=0[alayers]`);
      audio="alayers";
    }
    if(gpuEnabled){gpuFilterInsertion=filters.length;gpuUnder=video;video="vgpu";}
    // The scene camera moves the composited footage and all device layers
    // together. Text remains screen-aligned and audio retains its original time.
    if (timeline.camera) {
      filters.push(`[${video}]${videoCameraFilter(timeline.camera,width,height,fps)}[vcamera]`);
      video = "vcamera";
    }
    // Each label is composited only for its own half-open time interval.
    const animated = !!timeline.graphics?.length || overlayLabels.some(label => label.animation && (label.animation.entrance || label.animation.exit || label.animation.keyframes?.length));
    let labelInputs = 0;
    if (animated) {
      const overlay = join(dir,"animated-labels.mov");
      await renderRgbaFrames(durationMs,fps,width,height,overlay,time => {
        const labels = animatedLabelsMarkup(overlayLabels,time,designWidth,designHeight).replace(`width="${designWidth}" height="${designHeight}"`,`width="${width}" height="${height}"`);
        const first = labels.indexOf(">")+1;
        return labels.slice(0,first)+graphicsMarkup(timeline.graphics ?? [],time,designWidth,designHeight,timelineAudioAnalysis(timeline))+labels.slice(first);
      },input.signal);
      args.push("-i",overlay); labelInputs = 1;
      filters.push(`[${video}][${layers.length+1}:v]overlay=0:0:format=auto[vlabels]`); video = "vlabels";
    } else for(let i=0;i<overlayLabels.length;i++) {
      const label=overlayLabels[i]; const file=join(dir,`label-${i}.png`);
      await writeFile(file,await sharp(creativeLabelsSvg([label],designWidth,designHeight)).resize(width,height).png().toBuffer());
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
    let soundInput = layers.length+labelInputs+1+(timeline.music.url&&musicRange ? 1 : 0);
    for (const [i,track] of (timeline.audioTracks ?? []).entries()) {
      const file=join(dir,`sound-${i}`); await writeFile(file,await download(track.url,100*1024*1024,input.signal));
      args.push("-stream_loop","-1","-ss",String(track.offsetMs/1000),"-i",file);
      const seconds=(track.endMs-track.startMs)/1000, envelope=[`atrim=duration=${seconds}`,"asetpts=PTS-STARTPTS",`volume=${track.volume}`];
      if (track.fadeInMs > 0) envelope.push(`afade=t=in:st=0:d=${Math.min(seconds,track.fadeInMs/1000)}`);
      if (track.fadeOutMs > 0) { const fade=Math.min(seconds,track.fadeOutMs/1000); envelope.push(`afade=t=out:st=${seconds-fade}:d=${fade}`); }
      envelope.push(`adelay=${track.startMs}:all=1`);
      filters.push(`[${soundInput++}:a]${envelope.join(",")}[sound${i}]`,`[${audio}][sound${i}]amix=inputs=2:duration=first:normalize=0[asound${i}]`);
      audio=`asound${i}`;
    }
    if(gpuEnabled){
      const gpu=join(dir,"gpu-scene.mov");await renderGpuScene(timeline,width,height,fps,durationMs,gpu,gpuMedia,input.signal,async fraction=>{await input.onProgress?.(70+Math.round(fraction*20));});
      args.push("-i",gpu);filters.splice(gpuFilterInsertion,0,`[${gpuUnder}][${soundInput}:v]overlay=0:0:format=auto[vgpu]`);
    }
    if (profile.format === "gif") {
      filters.push(`[${video}]split[gifpalette][gifpixels]`,"[gifpalette]palettegen=stats_mode=diff[palette]","[gifpixels][palette]paletteuse=dither=sierra2_4a[vgif]");
      video="vgif";
    }
    if ((profile.still || profile.format === "gif") && audio !== "0:a") filters.push(`[${audio}]anullsink`);
    if(filters.length) { const script=join(dir,"labels-audio.fffilter");await writeFile(script,filters.join(";"));args.push("-filter_complex_threads","1","-filter_complex_script",script); }
    const output=join(dir,`output.${profile.extension}`);
    args.push("-map",video==="0:v"?video:`[${video}]`);
    if (profile.still || profile.format === "gif") args.push("-an");
    else args.push("-map",audio==="0:a"?audio:`[${audio}]`);
    if (profile.still) args.push("-ss",String(Math.min(timeline.coverMs,Math.max(0,durationMs-1000/fps))/1000),"-frames:v","1",...(profile.format === "jpeg" ? ["-q:v","2"] : []));
    else {
      args.push("-t",String(durationMs/1000),"-r",String(fps));
      if (profile.format === "webm") args.push("-c:v","libvpx-vp9","-crf",String(profile.crf),"-b:v","0","-deadline","good","-cpu-used","4","-pix_fmt","yuv420p","-c:a","libopus");
      else if (profile.format === "gif") args.push("-loop","0");
      else args.push("-c:v","libx264","-preset","veryfast","-crf",String(profile.crf),"-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart");
    }
    args.push(output);
    await run(args,durationMs/1000); await input.onProgress?.(95); input.signal?.throwIfAborted();
    const requestedKey=input.targetKey ?? `videos/${input.projectId}/${crypto.randomUUID()}.${profile.extension}`;
    const key=/\.[a-z0-9]+$/i.test(requestedKey) ? requestedKey.replace(/\.[a-z0-9]+$/i,`.${profile.extension}`) : `${requestedKey}.${profile.extension}`;
    const config=getR2Config();
    await getR2Client().send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:await readFile(output),ContentType:profile.contentType,CacheControl:"public, max-age=31536000, immutable"}));
    const cover=join(dir,"cover.jpg");
    if (profile.still) await sharp(await readFile(output)).jpeg({quality:90}).toFile(cover);
    else await run(["-ss",String(Math.min(timeline.coverMs,Math.max(0,durationMs-1000/fps))/1000),"-i",output,"-frames:v","1","-q:v","2",cover]);
    const coverKey=key.replace(/\.[a-z0-9]+$/i,profile.still ? ".cover.jpg" : ".jpg");await getR2Client().send(new PutObjectCommand({Bucket:config.bucket,Key:coverKey,Body:await readFile(cover),ContentType:"image/jpeg",CacheControl:"public, max-age=31536000, immutable"}));
    return {url:publicObjectUrl(key),coverUrl:publicObjectUrl(coverKey),durationMs};
  } finally { await rm(dir,{recursive:true,force:true}); }
}
