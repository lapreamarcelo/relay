import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { normalizeVideoTimeline } from "../lib/video-timeline";

const run = promisify(execFile);
test.use({ actionTimeout: 15_000 });
const runtimeErrors = new WeakMap<import("@playwright/test").Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  runtimeErrors.set(page, errors);
});
test.afterEach(async ({ page }) => expect(runtimeErrors.get(page)).toEqual([]));

const screen = "https://media.example.test/demo-screen.png";
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#dce8e0"/><rect x="30" y="120" width="330" height="140" rx="20" fill="#376456"/><text x="35" y="90" font-size="34">Your app</text></svg>';

const backdropUrl = "https://media.example.test/backdrop.png";
const backdropArtwork = '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#224488"/><rect x="40" width="40" height="40" fill="#A4D6C3"/></svg>';

async function editor(page: import("@playwright/test").Page, realVideo = false, backgroundLibrary = false) {
  let project: any = { id: "motion-demo", name: "Animated app demo", caption: "", brandId: "", labels: [], revision: 1, createdAt: "2026-10-02T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z", timeline: { version: 1, aspectRatio: "9:16", clips: [{ id: "screen", name: "Screen recording", sourceUrl: realVideo ? "https://media.example.test/demo.mp4" : screen, kind: realVideo ? "video" : "image", inMs: realVideo ? 1000 : 0, outMs: realVideo ? 4000 : 5000, fit: "contain", x: .5, y: .5, zoom: 1, volume: realVideo ? .35 : 1 }], labels: [], music: { url: "", volume: 1, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0 } };
  await page.route("https://media.example.test/**", r => {
    if (r.request().url() === backdropUrl) return r.fulfill({contentType:"image/svg+xml",body:backdropArtwork});
    if (!r.request().url().endsWith(".mp4")) return r.fulfill({ contentType: "image/svg+xml", body: artwork });
    const file = readFileSync(new URL("./fixtures/device-demo.mp4",import.meta.url));
    const requested = /^bytes=(\d+)-(\d*)$/.exec(r.request().headers().range ?? "");
    if (!requested) return r.fulfill({ contentType: "video/mp4", headers: {"Accept-Ranges":"bytes"}, body: file });
    const start = Number(requested[1]), end = requested[2] ? Math.min(Number(requested[2]),file.length-1) : file.length-1;
    return r.fulfill({ status:206, contentType:"video/mp4", headers:{"Accept-Ranges":"bytes","Content-Range":`bytes ${start}-${end}/${file.length}`}, body:file.subarray(start,end+1) });
  });
  await page.route("**/api/v1/videos", r => {
    if (r.request().method() === "PATCH") {
      const document = r.request().postDataJSON();
      project = { ...document, timeline: normalizeVideoTimeline(document.timeline), revision: project.revision + 1 };
      return r.fulfill({ json: { data: project } });
    }
    return r.fulfill({ json: { data: [project] } });
  });
  for (const path of ["videos/templates", "brands/kit", "videos/jobs*", "media/projects", "media?*"]) await page.route(`**/api/v1/${path}`, r => r.fulfill({ json: { data: backgroundLibrary && r.request().url().includes("media?kind=media") ? [{key:"backdrop",name:"Backdrop.png",url:backdropUrl},{key:"recording",name:"Recording.mp4",url:"https://media.example.test/demo.mp4"}] : [] } }));
  await page.goto("/demo?view=videos");
  await page.getByRole("button", { name: /^Animated app demo/ }).click();
  return () => project;
}

async function range(page: import("@playwright/test").Page, name: string, value: string) {
  await page.getByLabel(name, { exact: true }).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, next);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

test("image backgrounds combine with dimensional iPhone rotation and survive save/reload", async ({ page }, testInfo) => {
  const project = await editor(page, false, true);
  await page.getByRole("group", {name:"Device frame",exact:true}).getByRole("button",{name:"iPhone",exact:true}).click();
  await page.getByLabel("Canvas background style",{exact:true}).selectOption("image");
  const library = page.getByRole("dialog",{name:"Video assets",exact:true});
  await expect(library.getByRole("button",{name:"Add Recording.mp4",exact:true})).toHaveCount(0);
  await library.getByRole("button",{name:"Add Backdrop.png",exact:true}).click();
  await expect(library).not.toBeVisible();
  const canvas = page.locator(".unified-video-canvas");
  await expect(canvas).toHaveCSS("background-image", /backdrop\.png/);
  await expect(canvas.locator('[data-device-preview="iphone"]')).toHaveCSS("background-image", /backdrop\.png/);
  await page.getByLabel("Background image fit",{exact:true}).selectOption("contain");
  await expect(canvas).toHaveCSS("background-size", /^contain/);
  await page.getByRole("button",{name:"3D rotation",exact:true}).click();
  await range(page,"Device rotation X","-18");
  await range(page,"Device rotation Y","32");
  await range(page,"Device rotation Z","-8");
  const front = canvas.locator("[data-device-panel]").first();
  const posed = await front.getAttribute("data-device-panel-transform");
  await expect(canvas.locator("[data-device-body]").first()).toBeVisible();
  await page.getByLabel("Device animation",{exact:true}).selectOption("orbit");
  await range(page,"Timeline playhead","1000");
  await expect.poll(()=>front.getAttribute("data-device-panel-transform")).not.toBe(posed);
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  expect(project().timeline.background).toMatchObject({imageUrl:backdropUrl,imageFit:"contain"});
  expect(project().timeline.clips).toHaveLength(1);
  expect(project().timeline.clips[0].deviceFrame).toMatchObject({device:"iphone",rotateX:-18,rotateY:32,rotateZ:-8,motion:"orbit"});
  await page.reload();
  await page.getByRole("button",{name:/^Animated app demo/}).click();
  await expect(page.getByLabel("Canvas background style",{exact:true})).toHaveValue("image");
  await expect(page.getByLabel("Background image fit",{exact:true})).toHaveValue("contain");
  await expect(canvas.locator("[data-device-body]").first()).toBeVisible();
  await page.getByLabel("Background image fit",{exact:true}).selectOption("cover");
  await page.getByRole("navigation",{name:"Video settings shortcuts"}).getByRole("button",{name:"Canvas settings",exact:true}).click();
  // Inspect actual rendered diagonal edges, rather than only comparing CSS
  // transforms. The previous double-scaled preview had no intermediate pixels
  // here and looked like a staircase, despite its geometry tests passing.
  const edgeCapture=await canvas.screenshot({path:`/tmp/relay-device-edge-${testInfo.project.name}.png`});
  const {data,info}=await sharp(edgeCapture).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let smoothRows=0;
  const firstRow=Math.ceil(info.height*.25),lastRow=Math.floor(info.height*.78);
  for(let y=firstRow;y<lastRow;y++) {
    let antialiased=false;
    for(let x=0;x<info.width*.44;x++) {
      const [r,g,b]=data.subarray((y*info.width+x)*3,(y*info.width+x)*3+3);
      if(r<130&&b-g>5&&b-g<61&&Math.abs(r-g)<20) antialiased=true;
    }
    if(antialiased) smoothRows++;
  }
  expect(smoothRows/(lastRow-firstRow)).toBeGreaterThan(.25);
  await page.screenshot({path:`/tmp/relay-image-background-${testInfo.project.name}.png`,fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"Remove background image",exact:true}).click();
  await expect(canvas).not.toHaveCSS("background-image",/backdrop\.png/);
  await page.getByRole("button",{name:"Undo",exact:true}).click();
  await expect(canvas).toHaveCSS("background-image",/backdrop\.png/);
  await page.getByRole("button",{name:"Add audio",exact:true}).click();
  await expect(library.getByRole("heading",{name:"Add to your video",exact:true})).toBeVisible();
  await expect(library.getByRole("button",{name:"audio",exact:true})).toHaveAttribute("aria-pressed","true");
  await expect(library.getByRole("button",{name:"text",exact:true})).toBeVisible();
  await library.getByRole("button",{name:"Close video assets",exact:true}).click();
  if(testInfo.project.name==="chromium") {
    const beforeResize=(await canvas.boundingBox())!.width;
    await page.setViewportSize({width:1920,height:1080});
    await expect.poll(async()=>(await canvas.boundingBox())!.width).toBeGreaterThan(beforeResize*1.4);
    await page.getByLabel("Safe area guide",{exact:true}).uncheck();
    await canvas.screenshot({path:"/tmp/relay-device-quality-canvas.png"});
    await page.screenshot({path:"/tmp/relay-device-quality-editor.png",fullPage:true});
  }
});

test("uploading a background image leaves footage unchanged and validates file types", async ({page}) => {
  const project = await editor(page);
  const clips = structuredClone(project().timeline.clips);
  let uploads = 0;
  await page.route("**/api/v1/media",route=>{uploads++;return route.fulfill({json:{key:"new-backdrop",url:backdropUrl,uploadUrl:"https://upload.example.test/background"}});});
  await page.route("https://upload.example.test/background",route=>route.fulfill({status:200}));
  // The editor uses a shared media input whose accept filter follows its destination.
  await page.getByRole("button",{name:"Upload image",exact:true}).click();
  const imageInput = page.locator('input[type="file"][accept^="image/png"]');
  await imageInput.setInputFiles({name:"Not an image.mp4",mimeType:"video/mp4",buffer:Buffer.from("invalid")});
  await expect(page.locator(".unified-video-studio").getByRole("alert")).toContainText("Choose a PNG, JPEG");
  expect(uploads).toBe(0);
  await page.getByRole("button",{name:"Dismiss",exact:true}).click();
  await imageInput.setInputFiles({name:"Backdrop.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=","base64")});
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  expect(uploads).toBe(1);
  expect(project().timeline.clips).toEqual(clips);
  expect(project().timeline.background).toMatchObject({imageUrl:backdropUrl,imageFit:"cover"});
});

test("Duo demo motion, placement and backgrounds persist and follow the playhead", async ({ page }) => {
  const project = await editor(page);
  await page.getByRole("group", { name: "Device frame", exact: true }).getByRole("button", { name: "iPhone Duo", exact: true }).click();
  await page.getByLabel("Device animation", { exact: true }).selectOption("fold-cycle");
  await page.getByLabel("Device animation duration", { exact: true }).fill("3");
  await range(page, "Duo fold angle", "25");
  await page.getByText("Position, scale & rotation", { exact: true }).click();
  await range(page, "Device horizontal position", "55");
  await range(page, "Device scale", "85");
  await range(page, "Device rotation Y", "18");
  await page.getByLabel("Canvas background style", { exact: true }).selectOption("gradient");
  await page.getByLabel("Canvas background color", { exact: true }).fill("#112233");
  await page.getByLabel("Canvas gradient end color", { exact: true }).fill("#445566");
  const panel = page.locator('[data-device-preview="iphone-duo"] [data-device-panel]').first();
  await expect(panel).toBeVisible();
  const before = await panel.getAttribute("data-device-panel-transform");
  await range(page, "Timeline playhead", "1500");
  await expect(page.locator('[data-device-preview="iphone-duo"]')).toHaveAttribute("data-device-time", "1500");
  await expect.poll(() => panel.getAttribute("data-device-panel-transform")).not.toBe(before);
  await expect.poll(() => project().timeline.clips[0].deviceFrame).toMatchObject({ device: "iphone-duo", motion: "fold-cycle", motionDurationMs: 3000, foldAngle: 25, x: .55, scale: .85, rotateY: 18 });
  await expect.poll(() => project().timeline.background).toMatchObject({ color: "#112233", endColor: "#445566" });
  await page.reload();
  await page.getByRole("button", { name: /^Animated app demo/ }).click();
  await expect(page.getByLabel("Device animation", { exact: true })).toHaveValue("fold-cycle");
  await expect(page.getByLabel("Duo fold angle", { exact: true })).toHaveValue("25");
  await expect(page.getByLabel("Canvas background style", { exact: true })).toHaveValue("gradient");
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: `/tmp/relay-app-demo-${test.info().project.name}.png`, fullPage: true, animations: "disabled" });
});

test("every device and animation preset works across promotion aspect ratios", async ({ page }) => {
  const project = await editor(page, true);
  const controls = page.getByRole("group", { name: "Device frame", exact: true });
  for (const [name, device] of [["Phone", "phone"], ["Tablet", "tablet"], ["Browser", "browser"], ["iPhone", "iphone"], ["Mac", "mac"], ["Watch", "watch"], ["Android", "android"], ["iPhone Duo", "iphone-duo"]]) {
    await controls.getByRole("button", { name, exact: true }).click();
    const preview = page.locator(`[data-device-preview="${device}"]`);
    await expect(preview).toBeVisible();
    await expect(preview.locator("[data-device-panel]")).toHaveCount(device === "iphone-duo" ? 2 : 1);
    for (const motion of device === "iphone-duo" ? ["none", "orbit", "float", "fold", "unfold", "fold-cycle"] : ["none", "orbit", "float"]) {
      await page.getByLabel("Device animation", { exact: true }).selectOption(motion);
      await range(page, "Timeline playhead", "0");
      const transforms = await preview.locator("[data-device-panel]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-device-panel-transform")));
      await range(page, "Timeline playhead", "1000");
      const next = await preview.locator("[data-device-panel]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-device-panel-transform")));
      if (motion === "none") expect(next).toEqual(transforms);
      else expect(next).not.toEqual(transforms);
      expect(next.every(value => value && !/NaN|Infinity/.test(value))).toBe(true);
    }
  }
  for (const ratio of ["9:16", "4:5", "1:1", "16:9"]) {
    await page.getByLabel("Aspect ratio", { exact: true }).selectOption(ratio);
    const bounds = (await page.locator(".unified-video-canvas").boundingBox())!;
    const [w, h] = ratio.split(":").map(Number);
    expect(bounds.width / bounds.height).toBeCloseTo(w / h, 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(project().timeline.clips[0].deviceFrame).toMatchObject({ device: "iphone-duo", motion: "fold-cycle" });
  await page.reload();
  await page.getByRole("button", { name: /^Animated app demo/ }).click();
  await expect(page.getByLabel("Aspect ratio", { exact: true })).toHaveValue("16:9");
  await expect(page.getByLabel("Device animation", { exact: true })).toHaveValue("fold-cycle");
  await controls.getByRole("button", { name: "None", exact: true }).click();
  await expect(page.locator("[data-device-panel]")).toHaveCount(0);
  await expect(page.locator(".unified-video-canvas video")).toHaveCount(1);
});

test("an edited promotion exports a real playable MP4 with its device, background and timed label", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const project = await editor(page, true, true);
  await page.getByLabel("Aspect ratio", { exact: true }).selectOption("1:1");
  await page.getByRole("group", { name: "Device frame", exact: true }).getByRole("button", { name: "iPhone Duo", exact: true }).click();
  await page.getByLabel("Device animation", { exact: true }).selectOption("fold-cycle");
  await page.getByLabel("Device animation duration", { exact: true }).fill("2");
  await page.getByLabel("Canvas background style", { exact: true }).selectOption("solid");
  await page.getByLabel("Canvas background color", { exact: true }).fill("#112233");
  await page.getByLabel("Canvas background style", { exact: true }).selectOption("image");
  await page.getByRole("button", {name:"Add Backdrop.png",exact:true}).click();
  await page.getByLabel("Device entrance animation", { exact: true }).selectOption("fade");
  await page.getByLabel("Device entrance duration", { exact: true }).fill("500");
  await page.getByLabel("Device exit animation", { exact: true }).selectOption("fade");
  await page.getByLabel("Device exit duration", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Add text label", exact: true }).click();
  await page.getByLabel("Label text", { exact: true }).fill("Launch your app");
  await range(page, "Label vertical position", "12");
  await page.getByLabel("Label background color", { exact: true }).fill("#ff00ff");
  await page.getByText("Label timing", { exact: true }).click();
  await page.getByLabel("Start (ms)", { exact: true }).fill("1000");
  await page.getByLabel("End (ms)", { exact: true }).fill("2000");
  await page.getByLabel("Label entrance animation", { exact: true }).selectOption("fade");
  await page.getByLabel("Label entrance duration", { exact: true }).fill("300");
  await page.getByLabel("Label exit animation", { exact: true }).selectOption("fade");
  await page.getByLabel("Label exit duration", { exact: true }).fill("300");
  await range(page, "Timeline playhead", "1000");
  await page.getByRole("button", { name: "Add label keyframe at playhead", exact: true }).click();
  await page.getByLabel("Label keyframe 1 opacity", { exact: true }).fill("0.2");
  await range(page, "Timeline playhead", "1500");
  await page.getByRole("button", { name: "Add label keyframe at playhead", exact: true }).click();
  await page.getByText("0.50s · Keyframe 2", { exact: true }).click();
  await page.getByLabel("Label keyframe 2 opacity", { exact: true }).fill("1");
  const dir = await mkdtemp(join(tmpdir(), "relay-promotion-e2e-"));
  let body: Buffer;
  let renderRevision = 0;
  try {
    await page.route("**/api/v1/videos/render", async route => {
      expect(route.request().postDataJSON()).toMatchObject({ id: project().id, async: true });
      renderRevision = project().revision;
      const document = join(dir, "timeline.json");
      await writeFile(document, JSON.stringify(project().timeline));
      await run(process.execPath, [fileURLToPath(new URL("./fixtures/render-demo.mjs", import.meta.url)), document, dir], { timeout: 90_000 });
      body = await readFile(join(dir, "output.mp4"));
      await route.fulfill({ status: 202, json: { job: { id: "real-render", projectId: project().id, revision: renderRevision, status: "queued", progress: 0 } } });
    });
    await page.route("**/api/v1/videos/jobs*", route => route.fulfill({ json: { data: { id: "real-render", projectId: project().id, revision: renderRevision, status: "completed", progress: 100, renderedUrl: "https://media.example.test/output.mp4" } } }));
    await page.route("**/api/v1/videos/download?**", route => route.fulfill({ contentType: "video/mp4", headers: { "Content-Disposition": 'attachment; filename="promotion.mp4"' }, body }));
    const downloaded = page.waitForEvent("download", { timeout: 100_000 });
    await page.getByRole("button", { name: "Save & download", exact: true }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("promotion.mp4");
    const output = join(dir, "download.mp4");
    await download.saveAs(output);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type,width,height", "-of", "json", output]);
    const probe = JSON.parse(stdout);
    expect(Number(probe.format.duration)).toBeCloseTo(3, 1);
    expect(probe.streams).toEqual(expect.arrayContaining([expect.objectContaining({ codec_name: "h264", width: 1080, height: 1080 }), expect.objectContaining({ codec_name: "aac", codec_type: "audio" })]));
    const pink: number[] = [];
    for (const time of ["0.5", "1.1", "1.5", "1.9", "2.5"]) {
      const image = join(dir, `frame-${time}.rgb`);
      await run("ffmpeg", ["-v", "error", "-y", "-ss", time, "-i", output, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", image]);
      const pixels = await readFile(image);
      [34, 68, 136].forEach((value, channel) => expect(Math.abs(pixels[channel] - value)).toBeLessThan(8));
      let count = 0;
      // The label sits above the device. Limit the check to that region so
      // magenta in the source recording cannot be mistaken for label pixels.
      for (let y = 80; y < 140; y++) for (let x = 110; x < 250; x++) {
        const i = (y * 1080 + x) * 3;
        if (pixels[i] > 180 && pixels[i + 1] < 70 && pixels[i + 2] > 180) count++;
      }
      pink.push(count);
    }
    expect(pink[0]).toBe(0);
    expect(pink[2]).toBeGreaterThan(1000);
    expect(pink[1]).toBeLessThan(pink[2] / 2);
    expect(pink[3]).toBeLessThan(pink[2] / 2);
    expect(pink[4]).toBe(0);
    await page.route("**/promotion-preview.mp4", route => {
      const match = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
      if (!match) return route.fulfill({ contentType: "video/mp4", body });
      const start = Number(match[1]), end = match[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1;
      return route.fulfill({ status: 206, contentType: "video/mp4", headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) });
    });
    await page.evaluate(() => { const video = document.createElement("video"); video.id = "export-check"; video.src = "/promotion-preview.mp4"; video.muted = true; video.controls = true; document.body.append(video); });
    const video = page.locator("#export-check");
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => ({ width: node.videoWidth, height: node.videoHeight, duration: node.duration }))).toEqual({ width: 1080, height: 1080, duration: 3 });
    await video.evaluate((node: HTMLVideoElement) => node.play());
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThan(.1);
    await video.evaluate((node: HTMLVideoElement) => node.pause());
    await testInfo.attach("Rendered promotion", { path: output, contentType: "video/mp4" });
    await page.screenshot({ path: `/tmp/relay-promotion-export-${testInfo.project.name}.png`, fullPage: true });
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a failed save keeps edits recoverable and export cancellation and retry preserve the project", async ({ page }) => {
  const project = await editor(page);
  let failSave = true;
  await page.route("**/api/v1/videos", route => failSave && route.request().method() === "PATCH" ? route.fulfill({ status: 503, json: { error: "Storage temporarily unavailable" } }) : route.fallback());
  await page.getByRole("button", { name: "Add text label", exact: true }).click();
  await page.getByLabel("Label text", { exact: true }).fill("My app launch");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".video-studio").getByRole("alert")).toContainText("Storage temporarily unavailable");
  failSave = false;
  await page.reload();
  await page.getByRole("button", { name: /^Animated app demo/ }).click();
  await expect(page.getByLabel("Label text", { exact: true })).toHaveValue("My app launch");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(project().timeline.labels[0].text).toBe("My app launch");
  let status = "running";
  const job = () => ({ id: "retry-render", projectId: project().id, revision: project().revision, status, progress: status === "completed" ? 100 : 20, ...(status === "completed" ? { renderedUrl: "https://media.example.test/output.mp4" } : {}) });
  await page.route("**/api/v1/videos/render", route => route.fulfill({ status: 202, json: { job: job() } }));
  await page.route("**/api/v1/videos/jobs*", route => {
    if (route.request().method() === "PATCH") status = route.request().postDataJSON().action === "cancel" ? "cancelled" : "running";
    return route.fulfill({ json: { data: job() } });
  });
  await page.getByRole("button", { name: "Save & download", exact: true }).click();
  await page.getByRole("button", { name: "Cancel render", exact: true }).click();
  await expect(page.getByText("Export cancelled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("Export running", { exact: true })).toBeVisible();
  status = "completed";
  await expect(page.getByRole("link", { name: "Download MP4", exact: true })).toBeVisible();
  expect(project().timeline.labels[0].text).toBe("My app launch");
});

test("a simple existing clip supports an editable, positioned and timed label", async ({ page }) => {
  const project = await editor(page);
  await page.getByRole("button", { name: "Add text label", exact: true }).click();
  await page.getByLabel("Label text", { exact: true }).fill("Meet your new app");
  await range(page, "Label horizontal position", "40");
  await range(page, "Label vertical position", "30");
  await page.getByText("Label timing", { exact: true }).click();
  await page.getByLabel("Start (ms)", { exact: true }).fill("1000");
  await page.getByLabel("End (ms)", { exact: true }).fill("4000");
  await range(page, "Timeline playhead", "1500");
  const label = page.getByRole("button", { name: "Edit text: Meet your new app", exact: true });
  await expect(label).toHaveCount(1);
  await label.hover();
  const canvas = await page.locator(".unified-video-canvas").boundingBox();
  const box = await label.boundingBox();
  if (!canvas || !box) throw new Error("Preview not laid out");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * .6, canvas.y + canvas.height * .5, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => project().timeline.labels[0]).toMatchObject({ text: "Meet your new app", startMs: 1000, endMs: 4000 });
  await expect.poll(() => project().timeline.labels[0].x).toBeCloseTo(.6, 1);
  await expect.poll(() => project().timeline.labels[0].y).toBeCloseTo(.5, 1);
  await range(page, "Timeline playhead", "4500");
  await expect(label).toHaveCount(0);
});


test("Duo recording copies share trim, playback and one source audio track", async ({ page }) => {
  await editor(page, true);
  await page.getByRole("group", { name: "Device frame", exact: true }).getByRole("button", { name: "iPhone Duo", exact: true }).click();
  const videos = page.locator('[data-device-preview="iphone-duo"] .device-frame-screen > video');
  await expect(videos).toHaveCount(2);
  await expect.poll(() => videos.evaluateAll(nodes => nodes.every(node => (node as HTMLVideoElement).readyState >= 2))).toBe(true);
  await range(page, "Timeline playhead", "1500");
  await expect.poll(() => videos.evaluateAll(nodes => nodes.map(node => Math.round((node as HTMLVideoElement).currentTime * 10) / 10))).toEqual([2.5,2.5]);
  await expect.poll(() => videos.evaluateAll(nodes => nodes.map(node => ({muted:(node as HTMLVideoElement).muted,volume:(node as HTMLVideoElement).volume})))).toEqual([{muted:true,volume:.35},{muted:false,volume:.35}]);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => videos.evaluateAll(nodes => nodes.every(node => !(node as HTMLVideoElement).paused))).toBe(true);
  await expect.poll(() => videos.last().evaluate(node => (node as HTMLVideoElement).currentTime)).toBeGreaterThan(2.6);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect.poll(() => videos.evaluateAll(nodes => nodes.every(node => (node as HTMLVideoElement).paused))).toBe(true);
  await page.getByRole("group", { name: "Device frame", exact: true }).getByRole("button", { name: "iPhone", exact: true }).click();
  const single = page.locator('[data-device-preview="iphone"] .device-frame-screen > video');
  await expect(single).toHaveCount(1);
  await expect.poll(() => single.evaluate(node => ({muted:(node as HTMLVideoElement).muted,volume:(node as HTMLVideoElement).volume}))).toEqual({muted:false,volume:.35});
});

test("text entrances, exits and custom keyframes remain editable after saving", async ({ page }) => {
  const project = await editor(page);
  await page.getByRole("button", { name: "Add text label", exact: true }).click();
  await page.getByLabel("Label text", { exact: true }).fill("Promote your app");
  for (const preset of ["fade", "slide-up", "slide-down", "slide-left", "slide-right", "pop", "zoom", "typewriter"]) {
    await page.getByLabel("Label entrance animation", { exact: true }).selectOption(preset);
    await page.getByLabel("Label entrance duration", { exact: true }).fill("1000");
    await range(page, "Timeline playhead", "0");
    const hit = page.locator("[data-label-preview]").first();
    if (preset === "typewriter") await expect(hit).toHaveAttribute("data-label-reveal", "0.000");
    else await expect(hit).toHaveAttribute("data-label-opacity", "0.000");
    await range(page, "Timeline playhead", "1200");
    await expect(hit).toHaveAttribute("data-label-opacity", "1.000");
    await expect(hit).toHaveAttribute("data-label-reveal", "1.000");
  }
  await page.getByLabel("Label exit animation", { exact: true }).selectOption("fade");
  await page.getByLabel("Label exit duration", { exact: true }).fill("1000");
  await page.getByLabel("Label exit easing", { exact: true }).selectOption("linear");
  await range(page, "Timeline playhead", "4500");
  await expect(page.locator("[data-label-preview]")).toHaveAttribute("data-label-opacity", "0.500");
  await page.getByLabel("Label entrance animation", { exact: true }).selectOption("none");
  await range(page, "Timeline playhead", "0");
  await page.getByRole("button", { name: "Add label keyframe at playhead", exact: true }).click();
  await page.getByLabel("Label keyframe 1 easing", { exact: true }).selectOption("linear");
  await range(page, "Timeline playhead", "2000");
  await page.getByRole("button", { name: "Add label keyframe at playhead", exact: true }).click();
  await page.getByText("2.00s · Keyframe 2", { exact: true }).click();
  await page.getByLabel("Label keyframe 2 horizontal", { exact: true }).fill("0.7");
  await page.getByLabel("Label keyframe 2 rotation", { exact: true }).fill("15");
  await range(page, "Timeline playhead", "1000");
  await expect.poll(() => page.locator("[data-label-preview]").evaluate(el => (el as HTMLElement).style.left)).toBe("60%");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(project().timeline.labels[0].animation).toMatchObject({ exit: { preset: "fade" }, keyframes: [{timeMs:0,easing:"linear"},{timeMs:2000,x:.7,rotateZ:15}] });
  await page.reload();
  await page.getByRole("button", { name: /^Animated app demo/ }).click();
  await expect(page.getByLabel("Label exit animation", { exact: true })).toHaveValue("fade");
  await expect(page.locator('[data-testid="label-animation-controls"] .video-keyframe')).toHaveCount(2);
  await page.getByText("2.00s · Keyframe 2", { exact: true }).click();
  await page.getByRole("button", { name: "Delete label keyframe 2", exact: true }).click();
  await expect(page.locator('[data-testid="label-animation-controls"] .video-keyframe')).toHaveCount(1);
  const hit = page.locator("[data-label-preview]");
  await hit.hover();
  const box = (await hit.boundingBox())!;
  const canvas = (await page.locator(".unified-video-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + canvas.width * .1, box.y + box.height / 2, {steps:5});
  await page.mouse.up();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(project().timeline.labels[0].x).toBeCloseTo(.6, 1);
  expect(project().timeline.labels[0].animation.keyframes[0].x).toBeCloseTo(.6, 1);
});

test("device entrance, exit, easing and Duo hinge keyframes preview and persist", async ({ page }) => {
  const project = await editor(page);
  await page.getByRole("group", { name: "Device frame", exact: true }).getByRole("button", { name: "iPhone Duo", exact: true }).click();
  await page.getByLabel("Device entrance animation", { exact: true }).selectOption("slide-up");
  await page.getByLabel("Device entrance duration", { exact: true }).fill("1000");
  await page.getByLabel("Device exit animation", { exact: true }).selectOption("zoom");
  await page.getByLabel("Device exit easing", { exact: true }).selectOption("ease-in-out");
  const scene = page.locator(".device-demo-scene");
  await range(page, "Timeline playhead", "0");
  await expect(scene).toHaveCSS("opacity", "0");
  await range(page, "Timeline playhead", "1200");
  await expect(scene).toHaveCSS("opacity", "1");
  await page.getByLabel("Device entrance animation", { exact: true }).selectOption("none");
  await range(page, "Timeline playhead", "0");
  await page.getByRole("button", { name: "Add device keyframe at playhead", exact: true }).click();
  await range(page, "Timeline playhead", "2000");
  await page.getByRole("button", { name: "Add device keyframe at playhead", exact: true }).click();
  await page.getByText("2.00s · Keyframe 2", { exact: true }).click();
  await page.getByLabel("Device keyframe 2 fold angle", { exact: true }).fill("110");
  await page.getByLabel("Device keyframe 2 tilt y", { exact: true }).fill("20");
  const panel = page.locator("[data-device-panel]").first();
  const closed = await panel.getAttribute("data-device-panel-transform");
  await range(page, "Timeline playhead", "0");
  await expect.poll(() => panel.getAttribute("data-device-panel-transform")).not.toBe(closed);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(project().timeline.clips[0].deviceFrame.animation).toMatchObject({ exit: { preset:"zoom",easing:"ease-in-out" },keyframes:[{timeMs:0},{timeMs:2000,foldAngle:110,rotateY:20}] });
  await page.reload();
  await page.getByRole("button", { name: /^Animated app demo/ }).click();
  await expect(page.getByLabel("Device exit animation", { exact: true })).toHaveValue("zoom");
  await page.getByText("2.00s · Keyframe 2", { exact: true }).click();
  await expect(page.getByLabel("Device keyframe 2 fold angle", { exact: true })).toHaveValue("110");
  await page.getByRole("group", { name: "Device frame", exact: true }).getByRole("button", { name: "iPhone", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(project().timeline.clips[0].deviceFrame.animation.keyframes.every((frame: any) => frame.foldAngle === undefined)).toBe(true);
});

test("every clip transition previews overlap with one source-audio crossfade and saves", async ({ page }) => {
  const project = await editor(page, true);
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.locator(".timeline-clips > button").last().click();
  for (const kind of ["crossfade", "slide-left", "slide-right", "wipe-left", "wipe-right", "zoom"]) {
    await page.getByLabel("Clip transition", { exact: true }).selectOption(kind);
    await page.getByLabel("Clip transition duration", { exact: true }).fill("600");
    await page.getByLabel("Clip transition easing", { exact: true }).selectOption("ease-in");
    await range(page, "Timeline playhead", "2700");
    const layers = page.locator(".video-clip-preview-layer");
    await expect(layers).toHaveCount(2);
    await expect(layers.last()).toHaveAttribute("data-transition-progress", "0.250");
    if (kind === "crossfade" || kind === "zoom") await expect(layers.last()).toHaveCSS("opacity", "0.25");
    if (kind.startsWith("wipe")) expect(await layers.last().evaluate(el => (el as HTMLElement).style.clipPath)).toContain("75%");
    if (kind.startsWith("slide") || kind === "zoom") expect(await layers.last().evaluate(el => (el as HTMLElement).style.transform)).not.toBe("");
    await expect.poll(() => layers.locator("video").evaluateAll(elements => elements.map(el => ({volume:el.volume,muted:el.muted,source:el.currentTime})))).toEqual([{volume:.175,muted:false,source:3.7},{volume:.175,muted:false,source:1.3}]);
  }
  await range(page, "Timeline playhead", "3100");
  await expect(page.locator(".video-clip-preview-layer")).toHaveCount(1);
  await expect.poll(() => page.locator(".video-clip-preview-layer video").evaluate(el => el.volume)).toBe(.35);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(project().timeline.clips[1].transition).toMatchObject({kind:"zoom",durationMs:600,easing:"ease-in"});
  await page.reload();
  await page.getByRole("button", { name: /^Animated app demo/ }).click();
  await page.locator(".timeline-clips > button").last().click();
  await expect(page.getByLabel("Clip transition", { exact: true })).toHaveValue("zoom");
  await expect(page.locator(".timeline-playback")).toContainText("5.40s");
});
