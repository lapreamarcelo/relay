import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import type { DeviceFrame, TimedVideoLabel, VideoClip, VideoTimeline } from "@relay/core";
import { emptyTimeline, normalizeVideoTimeline } from "../lib/video-timeline";
import { defaultVideoScene } from "../lib/video-scene";

declare global { interface Window { relayGpu: { prepare(timeline: VideoTimeline, width: number, height: number): Promise<void>; frame(timeMs: number): Promise<string>; dispose(): void }; gpuTestTimeline: VideoTimeline } }
const size = 512;
const fixture = (color: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1920"><rect width="960" height="1920" fill="${color}"/></svg>`;
const source = (name = "green") => `http://127.0.0.1:3022/gpu-fixtures/${name}.svg`;
const clip = (id: string, device: DeviceFrame["device"], color = "green"): VideoClip => ({ id, name: id, sourceUrl: source(color), kind: "image", inMs: 0, outMs: 2000, fit: "cover", x: .5, y: .5, zoom: 1, volume: 0, deviceFrame: { device, background: "#000000", color: "#25272C", renderMode: "gpu", motion: "none", x: .5, y: .5, scale: device === "watch" ? .65 : .85, rotateX: 0, rotateY: 0, rotateZ: 0 } });
const timelineDocument = (clips: VideoClip[] = []): VideoTimeline => ({ ...emptyTimeline(), aspectRatio: "1:1", clips, scene: { ...defaultVideoScene, camera: { ...defaultVideoScene.camera }, shadow: 0, motionBlur: 0, aperture: 0 } });

async function boot(page: Page) {
  const failures: string[] = [], requests: string[] = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => { if (message.type() === "error") failures.push(message.text().slice(0, 2000)); });
  page.on("request", request => { if (request.url().includes("/devices/")) requests.push(new URL(request.url()).pathname); });
  await page.route("**/gpu-fixtures/*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: fixture(route.request().url().includes("red") ? "#FF0000" : "#00FF00") }));
  // A real same-origin response, with no React application or API side effects.
  await page.goto("/devices/ATTRIBUTION.json");
  await page.setContent('<!doctype html><html><body style="margin:0;background:#202732"></body></html>');
  await page.addScriptTag({ url: new URL("/renderer/scene.js", page.url()).href });
  return { failures, requests };
}
async function prepare(page: Page, timeline: VideoTimeline) {
  await page.evaluate(async ({ timeline, size }) => { window.gpuTestTimeline = timeline; await window.relayGpu.prepare(timeline, size, size); }, { timeline, size });
  await expect(page.locator("canvas")).toHaveCount(1);
}
async function pixels(page: Page, timeMs: number) {
  const png = await page.evaluate(time => window.relayGpu.frame(time), timeMs);
  const { data, info } = await sharp(Buffer.from(png, "base64")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { png, data, width: info.width, height: info.height };
}
type Pixels = Awaited<ReturnType<typeof pixels>>;
const green = (data: Buffer, i: number) => data[i + 1] > 150 && data[i + 1] > data[i] * 1.3 && data[i + 1] > data[i + 2] * 1.8 && data[i + 3] > 220;
function bounds(image: Pixels, predicate: (data: Buffer, i: number) => boolean) {
  let left = image.width, right = -1, top = image.height, bottom = -1, count = 0, sumX = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) { const i = (y * image.width + x) * 4; if (predicate(image.data, i)) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); count++; sumX += x; } }
  return { left, right, top, bottom, width: Math.max(0, right - left + 1), height: Math.max(0, bottom - top + 1), count, centerX: sumX / Math.max(1, count) };
}
function screenHoles(image: Pixels) {
  const box = bounds(image, green); let holes = 0, interior = 0;
  for (let y = Math.ceil(box.top + box.height * .3); y < box.top + box.height * .7; y++) {
    const row: number[] = []; for (let x = box.left; x <= box.right; x++) if (green(image.data, (y * image.width + x) * 4)) row.push(x);
    if (row.length < 12) continue;
    for (let x = row[0] + 3; x < row.at(-1)! - 3; x++) { interior++; if (!green(image.data, (y * image.width + x) * 4)) holes++; }
  }
  return { box, ratio: holes / Math.max(1, interior), interior };
}
function difference(a: Pixels, b: Pixels, region: "body" | "all" = "all") {
  let total = 0; for (let i = 0; i < a.data.length; i += 4) if (region === "all" || !green(a.data, i) && !green(b.data, i)) for (let channel = 0; channel < 4; channel++) total += Math.abs(a.data[i + channel] - b.data[i + channel]); return total;
}

test.beforeEach(({}, info) => { test.skip(info.project.name !== "chromium", "The export engine runs desktop Chromium."); });

test("licensed Watch bezel has smooth fractional coverage at its outer silhouette", async ({ page }, info) => {
  // Software WebGL needs time for the first model and shader compilation.
  test.setTimeout(180000);
  const state=await boot(page),timeline=timelineDocument([clip("watch","watch")]);
  timeline.clips[0].deviceFrame={...timeline.clips[0].deviceFrame!,rotateZ:17,rotateY:-20};
  await prepare(page,timeline);const frame=await pixels(page,0);
  let covered=0;const levels=new Set<number>();
  // Only measure the external silhouette: internal screen/glass transparency
  // cannot satisfy this regression, and the fixture disables shadows and blur.
  for(let y=1;y<frame.height-1;y++)for(let x=1;x<frame.width-1;x++){
    const alpha=frame.data[(y*frame.width+x)*4+3];if(alpha===0||alpha===255)continue;
    const outside=[[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy])=>frame.data[((y+dy)*frame.width+x+dx)*4+3]===0);
    if(outside){covered++;levels.add(alpha);}
  }
  expect(covered,"diagonal hardware edges need subpixel coverage, not binary stair steps").toBeGreaterThan(100);
  expect(levels.size,"coverage has multiple resolved sample levels").toBeGreaterThanOrEqual(3);
  expect(frame.data[3]).toBe(0);expect(state.failures).toEqual([]);
  await info.attach("watch-smoothed-bezel",{body:Buffer.from(frame.png,"base64"),contentType:"image/png"});
});

test("licensed Watch and iPhone stay static, rotate with their screens, and keep screen interiors intact", async ({ page }, info) => {
  test.setTimeout(180000);
  const state = await boot(page);
  for (const device of ["watch", "iphone"] as const) {
    const timeline = timelineDocument([clip(device, device)]); await prepare(page, timeline);
    const front = await pixels(page, 0), still = await pixels(page, 1000);
    expect(still.png, `${device}: time alone cannot create motion`).toBe(front.png);
    const screen = screenHoles(front); expect(screen.box.count, `${device}: native screen is filled by fixture`).toBeGreaterThan(500); expect(screen.interior).toBeGreaterThan(100); expect(screen.ratio, `${device}: no white/glass fragments over center screen`).toBeLessThan(.02);
    const center = (Math.round((screen.box.top + screen.box.bottom) / 2) * size + Math.round((screen.box.left + screen.box.right) / 2)) * 4;
    expect([...front.data.subarray(center, center + 4)], `${device}: native recording colors bypass hardware tone mapping`).toEqual([0, 255, 0, 255]);
    timeline.clips[0].deviceFrame = { ...timeline.clips[0].deviceFrame!, rotateX: 12, rotateY: -32 };
    await prepare(page, timeline); const turned = await pixels(page, 0), turnedScreen = screenHoles(turned);
    expect(difference(front, turned, "body"), `${device}: physical body perspective changes`).toBeGreaterThan(10000);
    expect(turnedScreen.box.count, `${device}: recording remains visible while turned`).toBeGreaterThan(500);
    expect(Math.abs(turnedScreen.box.count - screen.box.count), `${device}: screen turns with bezel`).toBeGreaterThan(screen.box.count * .04);
    expect(turnedScreen.ratio, `${device}: rotating must not expose the original model screen through the recording`).toBeLessThan(.03);
    await info.attach(`${device}-front`, { body: Buffer.from(front.png, "base64"), contentType: "image/png" });
    await info.attach(`${device}-turned`, { body: Buffer.from(turned.png, "base64"), contentType: "image/png" });
  }
  expect(state.requests).toContain("/devices/watch-ultra-2.glb"); expect(state.requests).toContain("/devices/iphone-15-pro-max.glb"); expect(state.failures).toEqual([]);
});

test("depth-of-field output retains transparent canvas corners and scene labels retain 3D keys", async ({ page }) => {
  test.setTimeout(120000); const state = await boot(page), timeline = timelineDocument([clip("phone", "iphone")]);
  timeline.scene = { ...timeline.scene!, aperture: .8, focusDepth: .6 };
  await prepare(page, timeline); const blur = await pixels(page, 500);
  const transparent = bounds(blur, (data, i) => data[i + 3] === 0);
  expect(transparent.count, "Bokeh must preserve alpha outside the device").toBeGreaterThan(size * size * .3);
  for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) expect(blur.data[(y * size + x) * 4 + 3]).toBe(0);
  const label: TimedVideoLabel = { id: "scene-text", text: "Inside the scene", x: .5, y: .5, width: .8, fontSize: 110, font: "modern", fontWeight: 400, kerning: true, textColor: "#FFFFFF", background: "none", strokeWidth: 0, style: "outline", sceneLayer: "scene", sceneDepth: .1, startMs: 0, endMs: 2000, animation: { keyframes: [{ timeMs: 0, rotateX: 0, rotateY: 0, depth: 0 }, { timeMs: 1000, rotateX: 25, rotateY: 60, depth: .15 }] } };
  const textTimeline = normalizeVideoTimeline({ ...timelineDocument(), labels: [label] });
  expect(textTimeline.labels[0]).toMatchObject({ sceneLayer: "scene", sceneDepth: .1, kerning: true, animation: { keyframes: [{ rotateX: 0, rotateY: 0, depth: 0 }, { rotateX: 25, rotateY: 60, depth: .15 }] } });
  await prepare(page, textTimeline); const straight = await pixels(page, 0), tilted = await pixels(page, 1000);
  expect(bounds(straight, (data, i) => data[i + 3] > 100).count).toBeGreaterThan(100);
  expect(bounds(tilted, (data, i) => data[i + 3] > 100).count).toBeGreaterThan(100);
  expect(difference(straight, tilted), "3D text tilt/depth changes the rendered plane").toBeGreaterThan(10000);
  expect(state.failures).toEqual([]);
});

test("GPU transitions affect geometry, screen clipping and opacity rather than all becoming crossfades", async ({ page }, info) => {
  test.setTimeout(180000); const state = await boot(page), outgoing = clip("out", "iphone", "red"), incoming = clip("in", "iphone");
  incoming.transition = { kind: "crossfade", durationMs: 1000, easing: "linear" };
  await prepare(page, timelineDocument([outgoing, incoming]));
  const samples = new Map<string, Pixels>();
  for (const kind of ["crossfade", "slide-left", "slide-right", "wipe-left", "wipe-right", "zoom"] as const) {
    await page.evaluate(kind => { window.gpuTestTimeline.clips[1].transition!.kind = kind; }, kind);
    const image = await pixels(page, 1500); samples.set(kind, image);
    await info.attach(kind, { body: Buffer.from(image.png, "base64"), contentType: "image/png" });
  }
  expect(new Set([...samples.values()].map(image => image.png)).size, "each transition has its own rendering").toBe(6);
  const body = (image: Pixels) => bounds(image, (data, i) => data[i + 3] > 80);
  const crossfade = body(samples.get("crossfade")!);
  expect(body(samples.get("slide-left")!).width, "slide moves the pair across the viewport").toBeGreaterThan(crossfade.width * 1.4);
  expect(body(samples.get("slide-right")!).width).toBeGreaterThan(crossfade.width * 1.4);
  const left = bounds(samples.get("wipe-left")!, green), right = bounds(samples.get("wipe-right")!, green);
  expect(left.count).toBeGreaterThan(100); expect(right.count).toBeGreaterThan(100);
  expect(left.centerX - right.centerX, "wipes expose opposite halves of the incoming screen").toBeGreaterThan(15);
  expect(body(samples.get("zoom")!).width, "zoom changes device size").toBeGreaterThan(crossfade.width * 1.03);
  expect(state.failures).toEqual([]);
});

test("the editor uses one shared GPU canvas for simultaneous iPhone and Watch layers", async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/gpu-fixtures/*.svg", route => route.fulfill({ contentType: "image/svg+xml", body: fixture("#00FF00") }));
  const timeline = timelineDocument(); timeline.aspectRatio = "16:9";
  timeline.layers = ["watch", "iphone"].map((device, index) => ({ ...clip(device, device as "watch" | "iphone"), startMs: 0, outMs: 6000, deviceFrame: { ...clip(device, device as "watch" | "iphone").deviceFrame!, x: index ? .7 : .3, scale: .6 } }));
  let saved = { id: "shared-gpu", name: "Shared GPU devices", caption: "", brandId: "", labels: [], revision: 1, createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z", timeline };
  await page.route("**/api/v1/videos", route => { if (route.request().method() === "PATCH") saved = { ...saved, ...route.request().postDataJSON() }; return route.fulfill({ json: { data: route.request().method() === "PATCH" ? saved : [saved] } }); });
  for (const path of ["videos/templates", "brands/kit", "videos/jobs*", "media/projects", "media?*"]) await page.route(`**/api/v1/${path}`, route => route.fulfill({ json: { data: [] } }));
  await page.goto("/demo?view=videos"); await page.getByRole("button", { name: /^Shared GPU devices/ }).click();
  await expect(page.getByLabel("3D device scene", { exact: true })).toHaveCount(1);
  await expect(page.locator('.device-frame-preview[data-device-rendering="gpu"]')).toHaveCount(2);
  await expect.poll(async () => page.getByLabel("3D device scene", { exact: true }).evaluate((canvas: HTMLCanvasElement) => {
    const copy = document.createElement("canvas"); copy.width = canvas.width; copy.height = canvas.height; const ctx = copy.getContext("2d")!; ctx.drawImage(canvas, 0, 0); const pixels = ctx.getImageData(0, 0, copy.width, copy.height).data; let opaque = 0; for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 128) opaque++; return opaque;
  }), { timeout: 60000 }).toBeGreaterThan(500);
  await expect(page.locator(".video-gpu-preview canvas")).toHaveCount(1); expect(errors).toEqual([]);
});

test("GPU media recovers from a failed direct HTTPS decode through the authenticated same-origin preview", async ({ page }) => {
  test.setTimeout(60000);
  const state = await boot(page), external = "https://media.example.test/private-library/no-cors.png";
  const png = await sharp(Buffer.from(fixture("#00FF00"))).png().toBuffer();
  let directAttempts = 0; const previews: string[] = [];
  await page.route(external, route => { directAttempts++; return route.abort("failed"); });
  await page.route("**/api/v1/media/preview?*", route => {
    const request = new URL(route.request().url());
    expect(request.origin).toBe("http://127.0.0.1:3022");
    previews.push(request.searchParams.get("url") ?? "");
    return route.fulfill({ contentType: "image/png", body: png });
  });
  const timeline = timelineDocument([{ ...clip("cors-fallback", "phone"), sourceUrl: external }]);
  await prepare(page, timeline); const frame = await pixels(page, 500), screen = screenHoles(frame);
  expect(directAttempts).toBe(1); expect(previews).toEqual([external]);
  expect(screen.box.count, "proxied bytes become the GPU screen texture").toBeGreaterThan(500);
  expect(screen.ratio, "the recovered screen is continuous").toBeLessThan(.01);
  const center = (Math.round((screen.box.top + screen.box.bottom) / 2) * size + Math.round((screen.box.left + screen.box.right) / 2)) * 4;
  expect([...frame.data.subarray(center, center + 4)]).toEqual([0, 255, 0, 255]);
  // Chromium logs the intentionally aborted direct request. Shader/runtime errors remain failures.
  expect(state.failures.filter(error => !error.includes("Failed to load resource: net::ERR_FAILED"))).toEqual([]);
});
