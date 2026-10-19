import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

function wave() {
  const rate = 8000, samples = rate * 2, bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / rate * Math.PI * 440) * 6000), 44 + i * 2);
  return bytes;
}
const songUrl = "https://media.example.test/song.wav";
async function editor(page: Page, withVideo = false) {
  let project: any = { id: "audio-recovery", name: "Audio recovery", brandId: "", caption: "", sourceUrl: "", labels: [], revision: 1, createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z", timeline: { version: 1, aspectRatio: "9:16", clips: [{ id: "image", sourceUrl: "https://media.example.test/image.png", name: "Image", kind: "image", inMs: 0, outMs: 8000, fit: "cover", x: .5, y: .5, zoom: 1, volume: 0 }], labels: [], music: { url: "", volume: .8, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0 } };
  if (withVideo) {
    const source = { ...project.timeline.clips[0], kind: "video", sourceUrl: "https://media.example.test/source.mp4", volume: .65 };
    project.timeline.clips = [source, { ...source, id: "second", name: "Second clip", volume: .45 }];
    project.timeline.layers = [{ ...source, id: "device", name: "Device video", startMs: 0, volume: .35 }];
    project.timeline.music = { ...project.timeline.music, url: songUrl, name: "Song" };
    project.timeline.audioTracks = [{ id: "voice", name: "Voice", url: songUrl, startMs: 0, endMs: 8000, offsetMs: 0, volume: .4, fadeInMs: 0, fadeOutMs: 0 }];
  }
  await page.route("https://media.example.test/source.mp4", route => route.fulfill({ contentType: "video/mp4", body: readFileSync(new URL("./fixtures/source.mp4", import.meta.url)) }));
  await page.route("https://media.example.test/**", route => route.request().url().endsWith("source.mp4") ? route.fallback() : route.request().url().endsWith(".png") ? route.fulfill({ contentType: "image/png", body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64") }) : route.abort("failed"));
  await page.route("**/api/v1/media/preview?**", route => route.fulfill({ contentType: "audio/wav", body: wave() }));
  await page.route("**/api/v1/videos", route => {
    if (route.request().method() === "PATCH") project = { ...project, ...route.request().postDataJSON(), revision: project.revision + 1 };
    return route.fulfill({ json: { data: route.request().method() === "GET" ? [project] : project } });
  });
  for (const endpoint of ["media/projects", "brands/kit", "videos/jobs*"]) await page.route(`**/api/v1/${endpoint}`, route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/media?**", route => route.fulfill({ json: { data: route.request().url().includes("kind=music") ? [{ key: "music/song.wav", name: "Existing song.wav", url: songUrl }] : [] } }));
  await page.goto("/demo?view=videos");
  await page.getByRole("button", { name: /^Audio recovery/ }).click();
  await expect(page.locator(".unified-video-studio")).toBeVisible();
  return () => project;
}

test("existing songs recover preview and timeline playback without changing saved URLs", async ({ page }) => {
  const saved = await editor(page);
  await page.getByRole("button", { name: "Add audio", exact: true }).last().click();
  const preview = page.getByLabel("Preview Existing song.wav");
  await preview.evaluate((audio: HTMLAudioElement) => audio.play().catch(() => {}));
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(1);
  await expect(preview).toHaveAttribute("src", `/api/v1/media/preview?url=${encodeURIComponent(songUrl)}`);
  await expect.poll(() => preview.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await page.getByRole("button", { name: "Use audio", exact: true }).click();
  const music = page.locator(".video-preview-music");
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(1);
  expect(await music.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => music.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => saved().timeline.music.url).toBe(songUrl);
  await page.getByRole("button", { name: "Browse sounds", exact: true }).click();
  await page.getByRole("button", { name: "Use audio", exact: true }).click();
  const sound = page.locator("audio[hidden]");
  await expect.poll(() => sound.evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThanOrEqual(1);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => sound.evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
});

test("mute original audio silences all footage, preserves songs and supports undo and saved drafts", async ({ page }) => {
  const saved = await editor(page, true);
  const mute = page.getByRole("checkbox", { name: "Mute original video audio", exact: true });
  await expect(mute).not.toBeChecked();
  await mute.check();
  const videos = page.locator(".video-label-canvas video");
  await expect.poll(() => videos.evaluateAll(nodes => nodes.every(node => (node as HTMLVideoElement).volume === 0))).toBe(true);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => saved().timeline.clips.map((clip: any) => clip.volume)).toEqual([0, 0]);
  expect(saved().timeline.layers[0].volume).toBe(0);
  expect(saved().timeline.music.volume).toBe(.8);
  expect(saved().timeline.audioTracks[0].volume).toBe(.4);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.locator(".video-preview-music").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await mute.uncheck();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => saved().timeline.clips.map((clip: any) => clip.volume)).toEqual([.65, .45]);
  expect(saved().timeline.layers[0].volume).toBe(.35);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(mute).toBeChecked();
  await page.getByRole("button", { name: "Back to videos", exact: true }).click();
  await page.getByRole("button", { name: /^Audio recovery/ }).click();
  await expect(mute).toBeChecked();
});

test("blocked uploads use the server asset and show failures inside the picker", async ({ page }) => {
  const saved = await editor(page);
  let fallbacks = 0, fail = true;
  await page.route("**/api/v1/media", route => {
    if (route.request().headers()["content-type"]?.includes("application/json")) return route.fulfill({ json: { key: "music/direct.wav", url: "https://media.example.test/direct.wav", uploadUrl: "https://media.example.test/upload" } });
    fallbacks++;
    expect(route.request().postDataBuffer()?.toString()).toContain('name="kind"\r\n\r\nmusic');
    if (fail) return route.fulfill({ status: 503, json: { error: "Audio storage unavailable" } });
    return route.fulfill({ status: 201, json: { key: "music/server.wav", url: "https://media.example.test/server.wav" } });
  });
  await page.getByRole("button", { name: "Add audio", exact: true }).last().click();
  const input = page.locator('input[type="file"][accept="audio/*"]');
  await input.setInputFiles({ name: "Upload.wav", mimeType: "audio/wav", buffer: wave() });
  const dialog = page.getByRole("dialog", { name: "Video assets" });
  await expect(dialog.getByRole("alert")).toHaveText("Audio storage unavailable");
  fail = false;
  await input.setInputFiles({ name: "Upload.wav", mimeType: "audio/wav", buffer: wave() });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Edit audio: Upload.wav", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => saved().timeline.music.url).toBe("https://media.example.test/server.wav");
  expect(fallbacks).toBe(2);
});
