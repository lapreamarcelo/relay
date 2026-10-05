import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import sharp from "sharp";
import { emptyTimeline } from "./video-timeline.ts";
import { normalizeVideoCamera, videoCameraFilter } from "./video-camera.ts";

const run = promisify(execFile);
const available = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
// Only storage and server-only adapters are stubbed; rendering/decoding is real.
const adapter = (dir: string) => `
import {registerHooks} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
registerHooks({resolve(specifier,context,next){
 if(specifier==='server-only')return {url:'data:text/javascript,export{}',shortCircuit:true};
 try{return next(specifier,context)}catch(error){if(specifier.startsWith('.')&&!/\\.[a-z]+$/i.test(specifier))return next(specifier+'.ts',context);throw error;}
}});
Object.assign(process.env,{R2_ACCOUNT_ID:'local',R2_ACCESS_KEY_ID:'local',R2_SECRET_ACCESS_KEY:'local',R2_BUCKET_NAME:'local',R2_PUBLIC_URL:'https://media.example.test'});
globalThis.fetch=async(url,{signal}={})=>{signal?.throwIfAborted();const name=new URL(String(url)).pathname.slice(1);if(!['scene.mp4','watch.mp4','music.wav'].includes(name))throw Error('Unexpected asset');return new Response(await readFile(${JSON.stringify(dir)}+'/'+name));};
const {getR2Client}=await import(${JSON.stringify(new URL("./r2.ts", import.meta.url).href)});
getR2Client().send=async command=>{await writeFile(${JSON.stringify(dir)}+'/'+(command.input.Key.endsWith('.mp4')?'output.mp4':'cover.jpg'),command.input.Body);return {};};
const {normalizeVideoTimeline}=await import(${JSON.stringify(new URL("./video-timeline.ts", import.meta.url).href)});
const {renderVideoArtifactDetails}=await import(${JSON.stringify(new URL("./video-renderer.ts", import.meta.url).href)});
const result=await renderVideoArtifactDetails({projectId:'camera-test',sourceUrl:'',labels:[],timeline:normalizeVideoTimeline(JSON.parse(await readFile(${JSON.stringify(join(dir, "timeline.json"))},'utf8'))),targetKey:'output.mp4'});
await writeFile(${JSON.stringify(join(dir, "result.json"))},JSON.stringify(result));
`;
const tone = (pcm: Buffer, start: number, frequency: number) => {
  const samples = 9600; let re = 0, im = 0;
  for (let i = 0; i < samples; i++) { const sample = pcm.readFloatLE((Math.round(start * 48000) + i) * 4), phase = i * frequency / 48000 * Math.PI * 2; re += sample * Math.cos(phase); im += sample * Math.sin(phase); }
  return Math.hypot(re, im) / samples;
};

test("production camera export zooms composited footage and Watch on the global clock while labels/music stay steady", { skip: !available, timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-camera-render-"));
  try {
    const longCamera = normalizeVideoCamera({ keyframes: Array.from({ length: 100 }, (_, i) => ({ timeMs: i * 100, zoom: 1 + i / 100, x: i / 100, y: 1 - i / 100, easing: "ease-in-out" })) })!;
    await run("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=red:size=64x64:rate=30", "-vf", videoCameraFilter(longCamera, 64, 64), "-frames:v", "1", "-f", "null", "-"]);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=red:size=320x320:rate=30:duration=4.2,drawbox=x=160:y=0:w=160:h=320:color=blue:t=fill", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", join(dir, "scene.mp4")]);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=lime:size=80x100:rate=30:duration=4.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", join(dir, "watch.mp4")]);
    await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=48000:duration=4.2", join(dir, "music.wav")]);
    const clip = { id: "first", name: "Scene", sourceUrl: "https://media.example.test/scene.mp4", kind: "video", inMs: 0, outMs: 2000, fit: "cover", x: .5, y: .5, zoom: 1, volume: .6 };
    const camera = { zoom: 1, x: .5, y: .5, keyframes: [{ timeMs: 0, zoom: 1, x: .5 }, { timeMs: 1000, zoom: 2, x: .25 }, { timeMs: 2000, zoom: 1, x: .5 }, { timeMs: 3000, zoom: 2, x: .75 }, { timeMs: 4000, zoom: 1, x: .5 }] };
    const timeline = { ...emptyTimeline(), aspectRatio: "1:1", camera, clips: [clip, { ...clip, id: "second", outMs: 2100 }], layers: [{ ...clip, id: "watch", name: "Watch", sourceUrl: "https://media.example.test/watch.mp4", startMs: 0, outMs: 4100, volume: 0, deviceFrame: { device: "watch", color: "#171717", background: "#000000", x: .25, y: .5, scale: .4 } }], labels: [{ id: "headline", text: "Demo", x: .5, y: .08, width: .4, height: .12, fontSize: 60, textColor: "#FFFFFF", background: "none", startMs: 0, endMs: 4100 }], music: { ...emptyTimeline().music, url: "https://media.example.test/music.wav", volume: .3 } };
    await writeFile(join(dir, "timeline.json"), JSON.stringify(timeline));
    await writeFile(join(dir, "render.mjs"), adapter(dir));
    await run(process.execPath, ["--experimental-transform-types", join(dir, "render.mjs")], { maxBuffer: 1024 * 1024 });
    assert.equal(JSON.parse(await readFile(join(dir, "result.json"), "utf8")).durationMs, 4100);
    const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height,r_frame_rate", "-of", "json", join(dir, "output.mp4")])).stdout);
    assert.ok(Math.abs(Number(probe.format.duration) - 4.1) < .08);
    assert.ok(probe.streams.some((s: { codec_name: string; width: number; height: number; r_frame_rate: string }) => s.codec_name === "h264" && s.width === 1080 && s.height === 1080 && s.r_frame_rate === "30/1"));
    assert.ok(probe.streams.some((s: { codec_name: string }) => s.codec_name === "aac"));
    const observations: Array<{ time: number; green: number; centerX: number; boundary: number; label: number[] }> = [];
    for (const time of [0, .5, 1, 2, 3, 4]) {
      const file = join(dir, `still-${time}.png`);
      await run("ffmpeg", ["-v", "error", "-y", "-ss", String(time), "-i", join(dir, "output.mp4"), "-frames:v", "1", file]);
      const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
      let green = 0, sumX = 0; const label = [1080, 1080, 0, 0];
      for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels, r = data[i], g = data[i + 1], b = data[i + 2];
        if (g > 150 && r < 70 && b < 70) { green++; sumX += x; }
        if (y < 200 && r > 220 && g > 220 && b > 220) { label[0] = Math.min(label[0], x); label[1] = Math.min(label[1], y); label[2] = Math.max(label[2], x); label[3] = Math.max(label[3], y); }
      }
      let boundary = 1080;
      for (let x = 0; x < info.width; x++) { const i = (900 * info.width + x) * info.channels; if (data[i] < 70 && data[i + 2] > 150) { boundary = x; break; } }
      observations.push({ time, green, centerX: sumX / green, boundary, label });
    }
    const [full, half, focused, returned, right, final] = observations;
    assert.ok(Math.abs(full.boundary - 540) < 5);
    assert.ok(Math.abs(half.boundary - 742.5) < 6, "halfway footage focus matches shared camera math");
    assert.ok(focused.boundary > 1070, "zooming left fills the canvas with the left footage region");
    assert.ok(right.boundary < 5, "camera uses global time after the second sequential clip starts");
    assert.ok(Math.abs(full.centerX - 270) < 5);
    assert.ok(Math.abs(half.centerX - 337.5) < 6);
    assert.ok(Math.abs(focused.centerX - 540) < 6, "the Watch moves with the composited scene");
    assert.ok(Math.abs(half.green / full.green - 2.25) < .1);
    assert.ok(Math.abs(focused.green / full.green - 4) < .15, "device frame/screen scales with camera zoom");
    assert.equal(right.green, 0, "the left Watch moves out of the right-focused viewport");
    for (const state of [returned, final]) { assert.ok(Math.abs(state.boundary - full.boundary) < 5); assert.ok(Math.abs(state.green / full.green - 1) < .05); }
    assert.ok(full.label[2] > full.label[0], "text rendered");
    for (const state of observations) for (let i = 0; i < 4; i++) assert.ok(Math.abs(state.label[i] - full.label[i]) < 3, `screen-aligned label at ${state.time}s`);
    const { stdout: pcm } = await run("ffmpeg", ["-v", "error", "-i", join(dir, "output.mp4"), "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"], { encoding: "buffer", maxBuffer: 2 * 1024 * 1024 });
    for (const frequency of [440, 880]) {
      const first = tone(pcm, .2, frequency); assert.ok(first > .005, `${frequency}Hz source/music is audible`);
      for (const time of [1.1, 2.2, 3.3]) assert.ok(Math.abs(tone(pcm, time, frequency) / first - 1) < .15, `camera leaves ${frequency}Hz audio unchanged at ${time}s`);
    }
    const cover = await sharp(join(dir, "cover.jpg")).metadata(); assert.equal(cover.width, 1080); assert.equal(cover.height, 1080);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
