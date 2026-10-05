import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { compileVideoComposition, normalizeVideoCompositionRequest } from "../lib/video-composition";
import { normalizeVideoTimeline } from "../lib/video-timeline";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const sourceUrl = "https://media.example.test/recording.png";
const prompt = "Make a clean cinematic launch video with bold titles and dynamic iPhone moves.";
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#dce8e0"/><rect x="30" y="140" width="330" height="180" rx="20" fill="#376456"/><text x="30" y="90" font-size="32">Relay demo</text></svg>';

function composition(body: unknown, title = "Meet Relay") {
  const request = normalizeVideoCompositionRequest(body);
  const source = request.timeline.clips[0], middle = Math.floor((source.inMs + source.outMs) / 2), duration = middle - source.inMs;
  const shot = { sourceClipId: source.id, inMs: source.inMs, outMs: middle, fit: "contain", device: "iphone", camera: "push-in", position: "center", transition: "none", transitionDurationMs: Math.min(400, Math.floor(duration / 4)), entrance: "fade", exit: "fade", titles: [{ text: title, startMs: 0, endMs: duration, position: "top", font: "editorial", fontSize: 72, style: "dark", entrance: "typewriter", exit: "fade" }] };
  return compileVideoComposition(request, { summary: "A cinematic introduction with two device shots and editable titles.", background: "#112233", backgroundEnd: "#445566", shots: [shot, { ...shot, inMs: middle, outMs: source.outMs, camera: "pan-left", transition: "crossfade", titles: [] }] });
}

type Reply = { status?: number; data?: unknown; error?: string };
async function editor(page: Page, options: { empty?: boolean; available?: boolean; twoSources?: boolean; realVideo?: boolean; disjointTrims?: boolean } = {}) {
  const clip = { id: "screen", name: "Screen recording", sourceUrl: options.realVideo || options.disjointTrims ? "https://media.example.test/demo.mp4" : sourceUrl, kind: options.realVideo || options.disjointTrims ? "video" : "image", inMs: options.realVideo || options.disjointTrims ? 1000 : 0, outMs: options.realVideo || options.disjointTrims ? 3000 : 5000, sourceDurationMs: options.realVideo || options.disjointTrims ? 5000 : undefined, fit: "contain", x: .5, y: .5, zoom: 1, volume: .35 };
  const state = {
    project: { id: "composer-demo", name: "Relay launch", caption: "", brandId: "", labels: [], revision: 1, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", timeline: normalizeVideoTimeline({ version: 1, aspectRatio: options.realVideo ? "1:1" : "9:16", clips: options.empty ? [] : options.disjointTrims ? [clip, { ...clip, id: "last-trim", name: "Last trim", inMs: 4000, outMs: 5000 }] : options.twoSources ? [clip, { ...clip, id: "other-screen", name: "Other recording", sourceUrl: "https://media.example.test/other.png" }] : [clip], labels: [], music: { url: "", volume: .8, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0 }) },
    patches: [] as any[], posts: [] as any[],
    reply: async (body: unknown): Promise<Reply> => ({ data: composition(body) }),
  };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://media.example.test/**", route => {
    if (!route.request().url().endsWith(".mp4")) return route.fulfill({ contentType: "image/svg+xml", body: artwork });
    const file = readFileSync(new URL("./fixtures/device-demo.mp4", import.meta.url));
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
    if (!range) return route.fulfill({ contentType: "video/mp4", headers: { "Accept-Ranges": "bytes" }, body: file });
    const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), file.length - 1) : file.length - 1;
    return route.fulfill({ status: 206, contentType: "video/mp4", headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${file.length}` }, body: file.subarray(start, end + 1) });
  });
  await page.route("**/api/v1/videos", route => {
    if (route.request().method() === "PATCH") {
      const document = route.request().postDataJSON(); state.patches.push(document);
      state.project = { ...document, timeline: normalizeVideoTimeline(document.timeline), revision: state.project.revision + 1 };
      return route.fulfill({ json: { data: state.project } });
    }
    return route.fulfill({ json: { data: [state.project] } });
  });
  await page.route("**/api/v1/videos/compose", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: { available: options.available ?? true, provider: "openai" } } });
    const body = route.request().postDataJSON(); state.posts.push(body);
    const reply = await state.reply(body);
    await route.fulfill({ status: reply.status ?? 200, json: { data: reply.data, error: reply.error } }).catch(() => {});
  });
  for (const path of ["videos/templates", "brands/kit", "videos/jobs*", "media/projects", "media?*"]) await page.route(`**/api/v1/${path}`, route => route.fulfill({ json: { data: [] } }));
  await page.goto("/demo?view=videos");
  await page.getByRole("button", { name: /^Relay launch/ }).click();
  await page.getByRole("button", { name: /^Compose with AI/ }).click();
  return { state, errors };
}

async function playhead(page: Page, value: string) {
  await page.getByLabel("Composition preview playhead", { exact: true }).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("composition is reviewed separately, applied once, editable, undoable and persistent", async ({ page }, testInfo) => {
  const { state, errors } = await editor(page, { twoSources: true });
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  state.reply = async body => { await gate; return { data: composition(body) }; };
  await page.getByLabel("Describe your video", { exact: true }).fill(prompt);
  await page.getByText("Recordings & direction", { exact: false }).click();
  await page.getByRole("checkbox", { name: /^Other recording/ }).uncheck();
  await page.getByLabel("App or product name", { exact: true }).fill("Relay");
  await page.getByLabel("Target duration (seconds)", { exact: true }).fill("8");
  await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
  await expect(page.getByRole("button", { name: "Cancel generation", exact: true })).toBeVisible();
  expect(state.patches).toHaveLength(0);
  expect(state.project.timeline.labels).toHaveLength(0);
  await expect.poll(() => state.posts.length).toBe(1);
  expect(state.posts[0]).toMatchObject({ prompt, productName: "Relay", durationMs: 8000, timeline: { clips: [expect.objectContaining({ id: "screen" })] } });
  finish();
  // aria-label on a div is discoverable by label; keep this scoped away from the main canvas.
  const preview = page.locator('[aria-label="Review generated composition"]');
  await expect(preview).toBeVisible();
  await expect(preview.getByText("2 scenes · 1 text blocks", { exact: true })).toBeVisible();
  await expect(preview.locator('[data-device-preview="iphone"]')).toBeVisible();
  await expect(preview.getByText("The composition reuses selected footage in more than one shot.")).toBeVisible();
  const transform = await preview.locator("[data-device-panel]").first().getAttribute("data-device-panel-transform");
  await playhead(page, "1800");
  await expect.poll(() => preview.locator("[data-device-panel]").first().getAttribute("data-device-panel-transform")).not.toBe(transform);
  await page.getByRole("region", { name: "AI video composer" }).screenshot({ path: `/tmp/relay-composer-review-${testInfo.project.name}.png`, animations: "disabled" });
  expect(state.patches).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Apply composition", exact: true }).click();
  await expect(page.getByLabel("Label text", { exact: true })).toHaveValue("Meet Relay");
  await expect(page.getByLabel("Timeline playhead", { exact: true })).toHaveValue("0");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".video-label-tabs button")).toHaveCount(0);
  await expect(page.locator(".timeline-clips > button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByLabel("Label text", { exact: true }).fill("Launch Relay today");
  await expect.poll(() => state.project.timeline.labels[0]?.text).toBe("Launch Relay today");
  expect(state.project.timeline.clips[0].deviceFrame?.animation?.keyframes).toHaveLength(2);
  expect(state.project.timeline.clips[1].transition?.kind).toBe("crossfade");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/relay-composer-${testInfo.project.name}.png`, fullPage: true, animations: "disabled" });
  await page.reload();
  await page.getByRole("button", { name: /^Relay launch/ }).click();
  await expect(page.getByLabel("Label text", { exact: true })).toHaveValue("Launch Relay today");
  await expect(page.getByLabel("Device animation", { exact: true })).toHaveValue("none");
  expect(errors).toEqual([]);
});

test("errors retain the brief, retry works, and discarding leaves the edit unchanged", async ({ page }) => {
  const { state, errors } = await editor(page);
  state.reply = async () => ({ status: 502, error: "The composition service is busy. Try again." });
  await page.getByLabel("Describe your video", { exact: true }).fill(prompt);
  await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
  await expect(page.getByRole("region", { name: "AI video composer" }).getByRole("alert")).toHaveText("The composition service is busy. Try again.");
  await expect(page.getByLabel("Describe your video", { exact: true })).toHaveValue(prompt);
  state.reply = async body => ({ data: composition(body) });
  await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toBeVisible();
  await page.getByLabel("Describe your video", { exact: true }).fill(`${prompt} Try a different title.`);
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toBeDisabled();
  await expect(page.getByText("Your direction changed after this preview. Generate again before applying.", { exact: true })).toBeVisible();
  await page.getByLabel("Describe your video", { exact: true }).fill(prompt);
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toBeEnabled();
  await page.getByText("Recordings & direction", { exact: false }).click();
  await page.getByRole("checkbox", { name: /^Screen recording/ }).uncheck();
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: /^Screen recording/ }).check();
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Discard composition", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toHaveCount(0);
  expect(state.patches).toHaveLength(0);
  expect(state.project.timeline.labels).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("cancelled and stale requests cannot replace a newer preview or subsequent edit", async ({ page }) => {
  const { state, errors } = await editor(page);
  const finishes: Array<() => void> = [];
  state.reply = async body => { const number = finishes.length; await new Promise<void>(resolve => finishes.push(resolve)); return { data: composition(body, `Generation ${number + 1}`) }; };
  await page.getByLabel("Describe your video", { exact: true }).fill(prompt);
  await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
  await expect.poll(() => finishes.length).toBe(1);
  await page.getByRole("button", { name: "Cancel generation", exact: true }).click();
  await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
  await expect.poll(() => finishes.length).toBe(2);
  finishes[1]();
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toBeVisible();
  finishes[0]();
  await page.getByRole("button", { name: "Apply composition", exact: true }).click();
  await expect(page.getByLabel("Label text", { exact: true })).toHaveValue("Generation 2");
  await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
  await expect.poll(() => finishes.length).toBe(3);
  await page.getByLabel("Label text", { exact: true }).fill("My latest edit");
  await expect(page.getByRole("region", { name: "AI video composer" }).getByRole("alert")).toHaveText("Your timeline changed. Generate again to include your latest edits.");
  finishes[2]();
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toHaveCount(0);
  state.reply = async body => ({ data: composition(body) });
  await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toBeEnabled();
  await page.getByLabel("Label text", { exact: true }).fill("Keep this edit");
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toBeDisabled();
  await expect(page.getByText("Your timeline changed after this preview. Generate again before applying.", { exact: true })).toBeVisible();
  await expect.poll(() => state.project.timeline.labels[0]?.text).toBe("Keep this edit");
  expect(errors).toEqual([]);
});

test("malformed composition and unexpected recording or music URLs are rejected before preview", async ({ page }) => {
  const { state, errors } = await editor(page);
  await page.getByLabel("Describe your video", { exact: true }).fill(prompt);
  for (const kind of ["recording", "music", "malformed"] as const) {
    state.reply = async body => {
      const result = composition(body);
      if (kind === "recording") result.timeline.clips[0].sourceUrl = "https://outside.example.test/video.mp4";
      if (kind === "music") result.timeline.music.url = "https://outside.example.test/music.mp3";
      return { data: kind === "malformed" ? { timeline: { version: 99 }, summary: "Invalid", warnings: [] } : result };
    };
    await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
    await expect(page.getByRole("region", { name: "AI video composer" }).getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(?:Re)?generate composition$/i })).toBeEnabled();
  }
  expect(state.patches).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("empty media and an unconfigured provider offer actionable states without generation", async ({ page }) => {
  const { state, errors } = await editor(page, { empty: true, available: false });
  await page.getByLabel("Describe your video", { exact: true }).fill(prompt);
  await expect(page.getByText("Upload a video or choose media first, then describe the demo you want.", { exact: true })).toBeVisible();
  await expect(page.getByText("Video composition needs OpenAI to be configured for this workspace. You can keep editing manually.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(?:Re)?generate composition$/i })).toBeDisabled();
  expect(state.posts).toHaveLength(0);
  expect(state.patches).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("selected ranges stay bounded while separate trims of one recording remain usable", async ({ page }) => {
  const { state, errors } = await editor(page, { disjointTrims: true });
  await page.getByLabel("Describe your video", { exact: true }).fill(prompt);
  for (const trim of [{ inMs: 0, outMs: 2000 }, { inMs: 2500, outMs: 4500 }]) {
    state.reply = async body => { const result = composition(body); Object.assign(result.timeline.clips[0], trim); return { data: result }; };
    await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
    await expect(page.getByRole("region", { name: "AI video composer" }).getByRole("alert")).toHaveText("The composition used media outside your selected recordings. Try again.");
    await expect(page.getByRole("button", { name: /^(?:Re)?generate composition$/i })).toBeEnabled();
  }
  state.reply = async body => { const result = composition(body); Object.assign(result.timeline.clips[1], { inMs: 4000, outMs: 5000 }); return { data: result }; };
  await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
  await expect(page.getByRole("button", { name: "Apply composition", exact: true })).toBeEnabled();
  expect(state.patches).toHaveLength(0);
  expect(errors).toEqual([]);
});

test("an applied generated composition exports a real playable animated MP4", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { state, errors } = await editor(page, { realVideo: true });
  await page.getByLabel("Describe your video", { exact: true }).fill(prompt);
  await page.getByRole("button", { name: /^(?:Re)?generate composition$/i }).click();
  const preview = page.locator('[aria-label="Review generated composition"]');
  await expect(preview).toBeVisible();
  await playhead(page, "800");
  await expect.poll(() => preview.locator("video").first().evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(1.8, 1);
  await playhead(page, "900");
  await expect(preview.locator("video")).toHaveCount(2);
  await expect.poll(() => preview.locator("video").last().evaluate((node: HTMLVideoElement) => node.currentTime)).toBeCloseTo(2.15, 1);
  expect(state.patches).toHaveLength(0);
  await page.getByRole("button", { name: "Apply composition", exact: true }).click();
  await page.getByLabel("Label text", { exact: true }).fill("Launch Relay");
  await page.getByRole("region", { name: "Camera & focus", exact: true }).getByRole("button", { name: "Focus & return", exact: true }).click();
  const dir = await mkdtemp(join(tmpdir(), "relay-composed-export-"));
  let output: Buffer, revision = 0;
  try {
    await page.route("**/api/v1/videos/render", async route => {
      revision = state.project.revision;
      expect(state.project.timeline.labels[0].text).toBe("Launch Relay");
      expect(state.project.timeline.camera?.keyframes).toHaveLength(4);
      expect(state.project.timeline.camera?.keyframes?.[1].zoom).toBe(2);
      expect(state.project.timeline.clips[0].deviceFrame?.animation?.keyframes).toHaveLength(2);
      expect(state.project.timeline.clips[1].transition?.kind).toBe("crossfade");
      const document = join(dir, "timeline.json");
      await writeFile(document, JSON.stringify(state.project.timeline));
      await run(process.execPath, [fileURLToPath(new URL("./fixtures/render-demo.mjs", import.meta.url)), document, dir], { timeout: 90_000 });
      output = await readFile(join(dir, "output.mp4"));
      await route.fulfill({ status: 202, json: { job: { id: "composed-export", projectId: state.project.id, revision, status: "queued", progress: 0 } } });
    });
    await page.route("**/api/v1/videos/jobs*", route => route.fulfill({ json: { data: { id: "composed-export", projectId: state.project.id, revision, status: "completed", progress: 100, renderedUrl: "https://media.example.test/output.mp4" } } }));
    await page.route("**/api/v1/videos/download?**", route => route.fulfill({ contentType: "video/mp4", headers: { "Content-Disposition": 'attachment; filename="relay-launch.mp4"' }, body: output }));
    const downloaded = page.waitForEvent("download", { timeout: 100_000 });
    await page.getByRole("button", { name: "Save & download", exact: true }).click();
    const download = await downloaded, filename = join(dir, "download.mp4");
    expect(download.suggestedFilename()).toBe("relay-launch.mp4");
    await download.saveAs(filename);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type,width,height", "-of", "json", filename]);
    const probe = JSON.parse(stdout);
    expect(Number(probe.format.duration)).toBeCloseTo(1.75, 1);
    expect(probe.streams).toEqual(expect.arrayContaining([expect.objectContaining({ codec_name: "h264", width: 1080, height: 1080 }), expect.objectContaining({ codec_name: "aac", codec_type: "audio" })]));
    // A frame from the generated title verifies that animated text reached the export.
    const frame = join(dir, "title.rgb");
    await run("ffmpeg", ["-v", "error", "-y", "-ss", "0.5", "-i", filename, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", frame]);
    const pixels = await readFile(frame);
    let bright = 0;
    for (let y = 100; y < 230; y++) for (let x = 100; x < 980; x++) { const index = (y * 1080 + x) * 3; if (pixels[index] > 200 && pixels[index + 1] > 200 && pixels[index + 2] > 200) bright++; }
    expect(bright).toBeGreaterThan(300);
    await page.route("**/composed-preview.mp4", route => {
      const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
      if (!range) return route.fulfill({ contentType: "video/mp4", headers: { "Accept-Ranges": "bytes" }, body: output });
      const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), output.length - 1) : output.length - 1;
      return route.fulfill({ status: 206, contentType: "video/mp4", headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${output.length}` }, body: output.subarray(start, end + 1) });
    });
    await page.evaluate(() => { const video = document.createElement("video"); video.id = "composed-export-check"; video.src = "/composed-preview.mp4"; video.muted = true; video.controls = true; document.body.append(video); });
    const video = page.locator("#composed-export-check");
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.videoWidth)).toBe(1080);
    await video.evaluate((node: HTMLVideoElement) => node.play());
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.1);
    await video.evaluate((node: HTMLVideoElement) => node.pause());
    await testInfo.attach("Composed launch video", { path: filename, contentType: "video/mp4" });
  } finally { await rm(dir, { recursive: true, force: true }); }
  expect(errors).toEqual([]);
});

test("prompt preview supports staggered parallel devices and applies independently editable layers",async({page})=>{
  const {state,errors}=await editor(page);
  state.reply=async body=>{
    const request=normalizeVideoCompositionRequest(body);
    const source=request.timeline.clips[0];
    const layer={sourceClipId:source.id,inMs:0,outMs:4000,fit:"contain",device:"watch",camera:"orbit",entrance:"pop",exit:"fade",startMs:0,x:.3,y:.5,scale:.6,rotateX:0,rotateY:0,rotateZ:0,volume:0,titles:[]};
    return {data:compileVideoComposition(request,{summary:"Watch first, then iPhone",background:"#112233",backgroundEnd:"#445566",shots:[],layers:[layer,{...layer,device:"iphone",camera:"float",startMs:1000,outMs:3000,x:.7,scale:.5}]})};
  };
  await page.getByLabel("Describe your video",{exact:true}).fill("Show a rotating Apple Watch then an iPhone next to it.");
  await page.getByRole("button",{name:"Generate composition",exact:true}).click();
  const preview=page.locator('[aria-label="Review generated composition"]');
  await expect(preview).toBeVisible();
  await expect(preview.locator('[data-device-preview="watch"]')).toHaveCount(1);
  await expect(preview.locator('[data-device-preview="iphone"]')).toHaveCount(0);
  await playhead(page,"1500");
  await expect(preview.locator('[data-device-preview="watch"]')).toHaveCount(1);
  await expect(preview.locator('[data-device-preview="iphone"]')).toHaveCount(1);
  await expect(preview.getByText("0 scenes · 0 text blocks · 2 device layers",{exact:true})).toBeVisible();
  expect(state.patches).toHaveLength(0);
  await page.getByRole("button",{name:"Apply composition",exact:true}).click();
  await expect.poll(()=>state.project.timeline.layers?.length).toBe(2);
  expect(state.project.timeline.clips).toHaveLength(0);
  expect(state.project.timeline.layers?.map(layer=>[layer.startMs,layer.deviceFrame?.device])).toEqual([[0,"watch"],[1000,"iphone"]]);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(page.locator(".timeline-clips > button")).toHaveCount(1);
  expect(errors).toEqual([]);
});
