import { expect, test, type Page } from "@playwright/test";

async function recordingEditor(page: Page) {
  let project = { id: "recording-ui", name: "Recording test", caption: "", brandId: "", labels: [], revision: 1, createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z", timeline: { version: 1, aspectRatio: "16:9", clips: [{ id: "source", name: "Sample", sourceUrl: "https://recording.test/screen.svg", kind: "image", inMs: 0, outMs: 6000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 0 }], labels: [], music: { url: "", volume: .8, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0 } };
  const errors: string[] = []; let uploads = 0, payload = Buffer.alloc(0), contentType = "video/webm";
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://recording.test/screen.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"><rect width="400" height="800" fill="#325875"/></svg>' }));
  await page.route("https://recording.test/upload", async route => { payload = route.request().postDataBuffer()!; await route.fulfill({ status: 200 }); });
  await page.route("https://recording.test/take", route => route.fulfill({ contentType, body: payload }));
  await page.route("**/api/v1/media?*", route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/media", route => {
    if (route.request().method() === "POST") { uploads++; contentType = route.request().postDataJSON().contentType.split(";")[0]; return route.fulfill({ json: { key: "media/take", url: "https://recording.test/take", uploadUrl: "https://recording.test/upload" } }); }
    return route.fulfill({ json: { data: [] } });
  });
  await page.route("**/api/v1/videos", route => {
    if (route.request().method() === "PATCH") { project = { ...project, ...route.request().postDataJSON(), revision: project.revision + 1 }; return route.fulfill({ json: { data: project } }); }
    return route.fulfill({ json: { data: [project] } });
  });
  for (const endpoint of ["videos/templates", "brands/kit", "videos/jobs*", "media/projects"]) await page.route(`**/api/v1/${endpoint}`, route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/videos/compose", route => route.fulfill({ json: { data: { available: false } } }));
  await page.goto("/demo?view=videos");
  await page.getByRole("button", { name: /^Recording test/ }).click();
  await page.locator(".unified-video-studio").evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  await page.getByRole("button", { name: "Record settings", exact: true }).click();
  return { project: () => project, uploads: () => uploads, errors };
}

test("browser recording is explicit, cancellation recovers, preview stays local, and source gestures persist", async ({ page }) => {
  // Use real MediaRecorder + canvas stream; replace only the OS chooser.
  await page.addInitScript(() => {
    const state = { calls: 0, frames: 0, stops: 0, audio: false };
    (window as any).__relayCapture = state;
    const media = navigator.mediaDevices;
    if (!media) return;
    Object.defineProperty(media, "getDisplayMedia", { configurable: true, value: async (options: DisplayMediaStreamOptions) => {
      state.calls++; state.audio = options.audio === true;
      if (state.calls === 1) throw new DOMException("Capture chooser canceled", "NotAllowedError");
      const canvas = document.createElement("canvas"); canvas.width = 400; canvas.height = 800;
      const context = canvas.getContext("2d")!;
      const draw = () => { state.frames++; context.fillStyle = state.frames % 2 ? "#325875" : "#63967a"; context.fillRect(0, 0, canvas.width, canvas.height); };
      draw(); const timer = setInterval(draw, 33);
      const stream = canvas.captureStream(30);
      const track = stream.getVideoTracks()[0], nativeStop = track.stop.bind(track);
      track.stop = () => { state.stops++; clearInterval(timer); nativeStop(); };
      return stream;
    } });
  });
  const state = await recordingEditor(page), panel = page.locator(".video-recording-controls");
  expect(await page.evaluate(() => (window as any).__relayCapture.calls)).toBe(0);
  await panel.getByRole("button", { name: "Record window or tab", exact: true }).click();
  await expect(panel.getByRole("alert")).toHaveText("Capture chooser canceled");
  await panel.getByRole("checkbox", { name: "Include shared audio when available" }).check();
  await panel.getByRole("button", { name: "Record window or tab", exact: true }).click();
  await page.waitForFunction(() => (window as any).__relayCapture.frames >= 30);
  await panel.getByRole("button", { name: /^Stop recording/ }).click();
  await expect(panel.locator("video")).toHaveAttribute("src", /^blob:/);
  expect(state.uploads()).toBe(0);
  expect(await page.evaluate(() => (window as any).__relayCapture.stops)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).__relayCapture.audio)).toBe(true);
  const events = { events: [{ kind: "down", timeMs: 100, x: .3, y: .4 }, { kind: "up", timeMs: 200, x: .3, y: .4 }], style: "touch", display: "tap-only" };
  await panel.locator('input[accept=".json,application/json"]').setInputFiles({ name: "take.events.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(events)) });
  await expect(panel.getByRole("status").filter({hasText:"Imported 2 gesture events."})).toBeVisible();
  await panel.getByRole("button", { name: "Add recording", exact: true }).click();
  await expect(panel.locator("video")).toHaveCount(0);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.uploads()).toBe(1);
  const clip = state.project().timeline.clips.at(-1) as any;
  expect(clip.sourceUrl).toBe("https://recording.test/take"); expect(Number.isFinite(clip.outMs)).toBe(true);
  expect(clip.sourceDurationMs).toBe(clip.outMs); expect(clip.pointer.events).toEqual(events.events);
  expect(state.errors).toEqual([]);
});

test("gesture imports attach to selected source and reject timestamps beyond its duration", async ({ page }) => {
  const state = await recordingEditor(page), panel = page.locator(".video-recording-controls");
  await panel.locator('input[accept=".json,application/json"]').setInputFiles({ name: "gestures.json", mimeType: "application/json", buffer: Buffer.from('[{"kind":"down","timeMs":400,"x":0.5,"y":0.6}]') });
  await expect(panel.getByRole("status")).toHaveText("Imported 1 gesture event.");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect((state.project().timeline.clips[0] as any).pointer.events[0]).toMatchObject({ kind: "down", timeMs: 400 });
  await panel.locator('input[accept=".json,application/json"]').setInputFiles({ name: "invalid-gestures.json", mimeType: "application/json", buffer: Buffer.from('[{"kind":"down","timeMs":6001,"x":0.5,"y":0.6}]') });
  await expect(panel.getByRole("alert")).toHaveText("Gesture timestamps must fit within the source recording.");
  expect((state.project().timeline.clips[0] as any).pointer.events[0].timeMs).toBe(400);
  expect(state.errors).toEqual([]);
});
