import { expect, test, type Page } from "@playwright/test";
import { normalizeVideoTimeline, timelineDuration } from "../lib/video-timeline";
import type { VideoTimeline } from "@relay/core";

async function openEditor(page: Page, linked = false) {
  let timeline = normalizeVideoTimeline({
    version: 1, aspectRatio: "9:16", coverMs: 0,
    clips: ["a", "b", "c"].map((id, index) => ({
      id, name: `Clip ${id}`, sourceUrl: "https://media.example.test/clip.png", kind: "image",
      inMs: 0, outMs: 4000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 0,
      ...(linked && index < 2 ? { groupId: "linked", motionOffsetMs: index * 4000 } : {}),
      ...(!linked && id === "b" ? { transition: { kind: "crossfade", durationMs: 1000 } } : {}),
    })),
    labels: [{ id: "caption", text: "Last clip caption", startMs: 9000, endMs: 10000, x: .5, y: .5, width: .8, fontSize: 52, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark" }],
  });
  const project = () => ({ id: "regression", name: "Regression project", caption: "", brandId: "", labels: [], timeline, revision: 1, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" });
  await page.route("https://media.example.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#245b47"/></svg>' }));
  await page.route("**/api/v1/videos", route => {
    if (route.request().method() === "PATCH") { timeline = normalizeVideoTimeline(route.request().postDataJSON().timeline); return route.fulfill({ json: { data: project() } }); }
    return route.fulfill({ json: { data: [project()] } });
  });
  for (const endpoint of ["videos/templates", "brands/kit", "videos/jobs*", "media/projects", "media?*"])
    await page.route(`**/api/v1/${endpoint}`, route => route.fulfill({ json: { data: [] } }));
  await page.goto("/demo?view=videos");
  await page.getByRole("button", { name: /^Regression project/ }).click();
  await expect(page.locator(".timeline-clips > button")).toHaveCount(3);
  return () => timeline as VideoTimeline;
}

test("inspector trim keeps linked motion and later captions aligned", async ({ page }) => {
  const timeline = await openEditor(page, true);
  await page.locator(".timeline-clips > button").first().click();
  await page.getByLabel("Trim end (ms)", { exact: true }).fill("2000");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => timeline().clips[1].motionOffsetMs).toBe(2000);
  expect(timeline().labels[0].startMs).toBe(7000);
});

test("legacy Duplicate makes room for the full clip and later captions", async ({ page }) => {
  const timeline = await openEditor(page);
  await page.locator(".timeline-clips > button").nth(1).click();
  await page.locator(".video-source-settings").getByRole("button", { name: "Duplicate", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => timeline().clips).toHaveLength(4);
  expect(timeline().clips[2].transition).toBeUndefined();
  expect(timelineDuration(timeline())).toBe(15000);
  expect(timeline().labels[0].startMs).toBe(13000);
});

test("timeline trim handles keep linked motion and captions aligned", async ({ page }) => {
  const timeline = await openEditor(page, true);
  await page.getByRole("slider", { name: "Trim end of Clip a", exact: true }).press("ArrowLeft");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => timeline().clips[1].motionOffsetMs).toBe(3900);
  expect(timeline().labels[0].startMs).toBe(8900);
});
