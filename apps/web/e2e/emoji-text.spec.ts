import { expect, test } from "@playwright/test";
import sharp from "sharp";

const text = "Launch 🚀 👍🏽 👨‍👩‍👧‍👦 🇪🇸 ❤️";
const imageUrl = "https://media.example.test/black.png";
const dates = { createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z" };

for (const mode of ["videos", "slideshows"] as const) test(`${mode} emoji text renders in color and survives save and reopen`, async ({ page }) => {
  let project: any = mode === "videos"
    ? { id: "emoji-video", name: "Emoji video", brandId: "", caption: "", sourceUrl: "", labels: [], revision: 1, ...dates, timeline: { version: 1, aspectRatio: "9:16", clips: [{ id: "image", name: "Black image", sourceUrl: imageUrl, kind: "image", inMs: 0, outMs: 5000, fit: "cover", x: .5, y: .5, zoom: 1, volume: 0 }], labels: [{ id: "label", text: "Your title", x: .5, y: .5, width: .9, height: .12, fontSize: 100, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark", startMs: 0, endMs: 5000 }], music: { url: "", volume: .8, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0 } }
    : { id: "emoji-slides", name: "Emoji slides", brandId: "", caption: "", ...dates, slides: [{ id: "slide", mediaUrl: imageUrl, text: "Your title", fit: "cover", textPosition: "center", textX: .5, textY: .5, textWidth: .9, textHeight: .12, textSize: 100, textFont: "modern", textColor: "#FFFFFF", textBackground: "dark", textBackgroundColor: "#000000" }] };
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const black = await sharp({ create: { width: 108, height: 192, channels: 3, background: "#000000" } }).png().toBuffer();
  await page.route(imageUrl, route => route.fulfill({ contentType: "image/png", body: black }));
  for (const endpoint of ["media/projects", "brands/kit", "videos/jobs*", "media?*"]) await page.route(`**/api/v1/${endpoint}`, route => route.fulfill({ json: { data: [] } }));
  await page.route(`**/api/v1/${mode}`, route => {
    if (route.request().method() === "PATCH") project = { ...project, ...route.request().postDataJSON(), ...(mode === "videos" ? { revision: project.revision + 1 } : {}) };
    return route.fulfill({ json: { data: route.request().method() === "GET" ? [project] : project } });
  });
  await page.route("**/api/v1/slideshows/render", route => route.fulfill({ json: { data: project } }));
  await page.goto(`/demo?view=${mode}`);
  await page.getByRole("button", { name: mode === "videos" ? /^Emoji video/ : /Emoji slides/ }).first().click();
  await page.getByLabel("Label text", { exact: true }).fill(text);
  const canvas = page.locator(mode === "videos" ? ".video-label-canvas" : ".slide-stage .slide-canvas");
  await expect(canvas.locator("[data-label-emoji]")).toHaveCount(5);
  const screenshot = await canvas.screenshot();
  const { data, info } = await sharp(screenshot).raw().toBuffer({ resolveWithObject: true });
  let colored = 0;
  for (let i = 0; i < data.length; i += info.channels) if (Math.max(...data.subarray(i, i + 3)) - Math.min(...data.subarray(i, i + 3)) > 70) colored++;
  expect(colored).toBeGreaterThan(200);
  const save = page.getByRole("button", { name: mode === "videos" ? "Save draft" : "Save", exact: true });
  if (await save.isVisible()) await save.click();
  else await page.getByRole("button", { name: "Save to Media", exact: true }).click();
  await expect.poll(() => mode === "videos" ? project.timeline.labels[0].text : project.slides[0].text).toBe(text);
  if (mode === "videos") await page.getByRole("button", { name: "Back to videos", exact: true }).click();
  else await page.locator(".slideshow-editor-head > button").click();
  await page.getByRole("button", { name: mode === "videos" ? /^Emoji video/ : /Emoji slides/ }).first().click();
  await expect(page.getByLabel("Label text", { exact: true })).toHaveValue(text);
  await expect(canvas.locator("[data-label-emoji]")).toHaveCount(5);
  expect(errors).toEqual([]);
});
