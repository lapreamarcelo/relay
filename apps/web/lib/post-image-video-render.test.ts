import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import sharp from "sharp";
import { renderSlideshowImage } from "./slideshow-renderer.ts";

const run = promisify(execFile);
const available = ["ffmpeg", "ffprobe"].every((binary) => spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0);

test("image videos encode exact timing, ordered cuts, complete images and designed slideshow frames", { skip: !available, timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "relay-image-video-render-"));
  try {
    for (const [name, color] of [["red", "#ee0000"], ["blue", "#0000ee"]]) {
      await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="${color}"/><rect width="8" height="80" fill="white"/><rect x="152" width="8" height="80" fill="white"/></svg>`)).png().toFile(join(directory, `${name}.png`));
    }
    for (const [index, name] of ["red", "blue"].entries()) {
      const slide = { id: name, mediaUrl: `https://media.example.test/${name}.png`, text: index ? "SECOND" : "FIRST", fit: "contain" as const, textPosition: "top" as const, textX: .5, textY: .2, textWidth: .8, textHeight: .12, textSize: 100, textFont: "modern" as const, textColor: "#FFFFFF", textBackground: "dark" as const, textBackgroundColor: "#000000", deviceFrame: { device: "phone" as const, background: "#123456", color: "#202020" } };
      await writeFile(join(directory, `${name}-designed.jpg`), await renderSlideshowImage(await readFile(join(directory, `${name}.png`)), slide));
    }
    const script = `
import { registerHooks } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
registerHooks({resolve(specifier, context, next) {
 if (specifier === 'server-only') return {url:'data:text/javascript,export{}',shortCircuit:true};
 try {return next(specifier,context)} catch(error) {if(specifier.startsWith('.')&&!/\\.[a-z]+$/i.test(specifier)) return next(specifier+'.ts',context);throw error;}
}});
Object.assign(process.env,{R2_ACCOUNT_ID:'local',R2_ACCESS_KEY_ID:'local',R2_SECRET_ACCESS_KEY:'local',R2_BUCKET_NAME:'local',R2_PUBLIC_URL:'https://media.example.test'});
globalThis.fetch = async (url, {signal} = {}) => {signal?.throwIfAborted();const name=new URL(String(url)).pathname.slice(1);if(!['red.png','blue.png','red-designed.jpg','blue-designed.jpg'].includes(name))throw Error('Unexpected asset');return new Response(await readFile(${JSON.stringify(directory)}+'/'+name));};
const {getR2Client} = await import(${JSON.stringify(new URL("./r2.ts", import.meta.url).href)});
getR2Client().send = async command => {await writeFile(${JSON.stringify(directory)}+'/'+command.input.Key,command.input.Body);return {};};
const {postImageVideoTimeline} = await import(${JSON.stringify(new URL("./post-image-video-jobs.ts", import.meta.url).href)});
const {renderVideoArtifactDetails} = await import(${JSON.stringify(new URL("./video-renderer.ts", import.meta.url).href)});
const single=await renderVideoArtifactDetails({projectId:'single',sourceUrl:'',labels:[],timeline:postImageVideoTimeline(['https://media.example.test/red.png']),targetKey:'single.mp4'});
const carousel=await renderVideoArtifactDetails({projectId:'carousel',sourceUrl:'',labels:[],timeline:postImageVideoTimeline(['https://media.example.test/red.png','https://media.example.test/blue.png'],3),targetKey:'carousel.mp4'});
const designed=await renderVideoArtifactDetails({projectId:'designed',sourceUrl:'',labels:[],timeline:postImageVideoTimeline(['https://media.example.test/red-designed.jpg','https://media.example.test/blue-designed.jpg'],3),targetKey:'designed.mp4'});
await writeFile(${JSON.stringify(join(directory, "results.json"))}, JSON.stringify({single,carousel,designed}));
`;
    const path = join(directory, "render.mjs");
    await writeFile(path, script);
    await run(process.execPath, ["--experimental-transform-types", path], { maxBuffer: 1024 * 1024 });
    const results = JSON.parse(await readFile(join(directory, "results.json"), "utf8"));
    assert.equal(results.single.durationMs, 8000);
    assert.equal(results.carousel.durationMs, 6000);
    assert.equal(results.designed.durationMs, 6000);
    for (const [name, duration] of [["single", 8], ["carousel", 6], ["designed", 6]] as const) {
      const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,width,height", "-of", "json", join(directory, `${name}.mp4`)])).stdout);
      const video = probe.streams.find((stream: { codec_name: string }) => stream.codec_name === "h264");
      assert.equal(video.width, 1080); assert.equal(video.height, 1920);
      assert.ok(probe.streams.some((stream: { codec_name: string }) => stream.codec_name === "aac"));
      assert.ok(Math.abs(Number(probe.format.duration) - duration) < .08, `${name} duration`);
    }
    for (const [name, time, blue] of [["single", 7.5, false], ["carousel", .2, false], ["carousel", 2.9, false], ["carousel", 3.1, true], ["carousel", 5.8, true]] as const) {
      const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", String(time), "-i", join(directory, `${name}.mp4`), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
      const { data, info } = await sharp(stdout).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
      assert.ok(pixel(540, 20).every((value) => value < 15), "unused vertical space stays black");
      assert.ok(pixel(20, 960).every((value) => value > 225), "left edge is retained");
      assert.ok(pixel(1060, 960).every((value) => value > 225), "right edge is retained");
      const [red, green, blueChannel] = pixel(540, 960);
      assert.ok(green < 20 && (blue ? blueChannel > 210 && red < 20 : red > 210 && blueChannel < 20), `${name} frame at ${time}s follows original order without blending`);
    }
    for (const [time, name] of [[.5, "red"], [3.5, "blue"]] as const) {
      const { stdout } = await run("ffmpeg", ["-v", "error", "-ss", String(time), "-i", join(directory, "designed.mp4"), "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "pipe:1"], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
      const expected = await sharp(join(directory, `${name}-designed.jpg`)).removeAlpha().raw().toBuffer();
      const { data, info } = await sharp(stdout).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let difference = 0, titlePixels = 0;
      for (let index = 0; index < data.length; index++) difference += Math.abs(data[index] - expected[index]);
      for (let y = 280; y < 480; y++) for (let x = 100; x < 980; x++) {
        const index = (y * info.width + x) * info.channels;
        if (data[index] > 210 && data[index + 1] > 210 && data[index + 2] > 210) titlePixels++;
      }
      assert.ok(difference / data.length < 5, "video preserves the designed slide's frame, background, image and positioning");
      assert.ok(titlePixels > 2000, "visible slide text remains inside the encoded MP4");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
