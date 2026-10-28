import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { SlideshowProject, VideoRenderJob } from "@relay/core";

const videoUrl = "https://media.example.test/slideshow.mp4";
const coverUrl = "https://media.example.test/cover.jpg";
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#25483e"/></svg>';

async function editor(page: Page, count = 2) {
  const state = {
    project: { id: "output-slides", name: "Output slideshow", caption: "A slideshow for every destination", brandId: "brand-aster", createdAt: "2026-10-25T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z", slides: Array.from({ length: count }, (_, index) => ({ id: `slide-${index}`, mediaUrl: `https://media.example.test/slide-${index}.jpg`, text: `Slide ${index + 1}`, fit: "contain", textPosition: "bottom", textSize: 64, textColor: "#FFFFFF", textBackground: "none" })) } as SlideshowProject,
    job: { id: "slideshow-job", projectId: "slideshow-video", revision: 1, status: "queued", progress: 0 } as VideoRenderJob,
    renders: [] as Array<{ id: string; format: string; imageSeconds?: number; async?: boolean }>,
    actions: [] as string[], polls: 0, pollFails: false,
  };
  await page.route("https://media.example.test/**", (route) => route.request().url().endsWith(".mp4")
    ? route.fulfill({ contentType: "video/mp4", body: readFileSync(new URL("./fixtures/device-demo.mp4", import.meta.url)) })
    : route.fulfill({ contentType: "image/svg+xml", body: artwork }));
  await page.route("**/api/v1/slideshows", (route) => {
    if (route.request().method() === "PATCH") { state.project = { ...route.request().postDataJSON(), updatedAt: new Date().toISOString() }; return route.fulfill({ json: { data: state.project } }); }
    return route.fulfill({ json: { data: [state.project] } });
  });
  await page.route("**/api/v1/slideshows/render", (route) => {
    const body = route.request().postDataJSON(); state.renders.push(body);
    if (body.format === "video") return route.fulfill({ status: 202, json: { data: state.project, folder: { id: "media-folder", name: "Output slideshow" }, video: { projectId: state.job.projectId, durationMs: state.project.slides.length * (body.imageSeconds ?? 4) * 1_000 }, job: state.job } });
    state.project = { ...state.project, slides: state.project.slides.map((slide, index) => ({ ...slide, renderedUrl: `https://media.example.test/rendered-${index}.jpg` })) };
    return route.fulfill({ json: { data: state.project, folder: { id: "media-folder", name: "Output slideshow" } } });
  });
  await page.route("**/api/v1/videos/jobs*", (route) => {
    if (route.request().method() === "PATCH") {
      const action = route.request().postDataJSON().action; state.actions.push(action);
      state.job = { ...state.job, status: action === "cancel" ? "cancelled" : "queued", error: undefined, progress: 0 };
      return route.fulfill({ json: { data: state.job } });
    }
    state.polls++;
    return state.pollFails ? route.fulfill({ status: 503, json: { error: "Progress service unavailable" } }) : route.fulfill({ json: { data: state.job } });
  });
  await page.goto("/demo?view=slideshows");
  await page.getByRole("button", { name: /^Output slideshow/ }).click();
  return state;
}

test("Back waits for the queued job handle before allowing navigation", async ({ page }) => {
  await editor(page);
  let release!: () => void;
  const responseReady = new Promise<void>((resolve) => { release = resolve; });
  let received = false;
  await page.route("**/api/v1/slideshows/render", async (route) => { received = true; await responseReady; await route.fallback(); });
  try {
    await page.getByRole("group", { name: "Output format" }).getByRole("button", { name: "Video", exact: true }).click();
    await page.getByRole("button", { name: "Save to Media", exact: true }).click();
    await expect.poll(() => received).toBe(true);
    await expect(page.getByRole("button", { name: "Back to slideshows" })).toBeDisabled();
    release();
    await expect(page.locator(".slideshow-render-status").getByRole("status")).toHaveText("Video queued");
    await expect(page.getByRole("button", { name: "Back to slideshows" })).toBeEnabled();
  } finally { release(); }
});

test("slideshow output timing saves, reopens and adapts from one slide to a carousel", async ({ page }) => {
  const state = await editor(page, 1);
  const formats = page.getByRole("group", { name: "Output format" });
  await expect(formats.getByRole("button", { name: "Images", exact: true })).toHaveAttribute("aria-pressed", "true");
  await formats.getByRole("button", { name: "Video", exact: true }).click();
  await expect(page.getByLabel("Slideshow video seconds per image")).toHaveValue("8");
  await page.getByLabel("Slideshow video seconds per image").selectOption("10");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.project.output).toEqual({ format: "video", imageSeconds: 10 });
  await page.reload();
  await page.getByRole("button", { name: /^Output slideshow/ }).click();
  await expect(page.getByLabel("Slideshow video seconds per image")).toHaveValue("10");
  await page.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(page.getByLabel("Slideshow video seconds per image")).toHaveValue("4");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => state.project.output).toEqual({ format: "video", imageSeconds: 4 });
  expect(state.project.slides.map((slide) => slide.mediaUrl)).toEqual([state.project.slides[0].mediaUrl, state.project.slides[0].mediaUrl]);
});

test("video output shows render progress and opens the MP4 in the composer for Reels and TikTok", async ({ page }) => {
  const state = await editor(page);
  await page.getByRole("group", { name: "Output format" }).getByRole("button", { name: "Video", exact: true }).click();
  await page.getByLabel("Slideshow video seconds per image").selectOption("5");
  await page.getByRole("button", { name: "Save to Media", exact: true }).click();
  await expect(page.locator(".slideshow-render-status").getByRole("status")).toHaveText("Video queued");
  expect(state.renders).toEqual([{ id: state.project.id, format: "video", imageSeconds: 5, async: true }]);
  await expect(page.getByLabel("Project name")).toBeDisabled();
  await expect(page.getByLabel("Slideshow video seconds per image")).toBeDisabled();
  state.job = { ...state.job, status: "running", progress: 35 };
  await expect(page.locator(".slideshow-render-status").getByRole("status")).toHaveText("Video running");
  await expect(page.getByRole("progressbar", { name: "Video render progress" })).toHaveAttribute("value", "35");
  state.job = { ...state.job, status: "completed", progress: 100, renderedUrl: videoUrl, coverUrl };
  await expect(page.getByLabel("Rendered slideshow video")).toHaveAttribute("src", videoUrl);
  await expect(page.getByLabel("Rendered slideshow video")).toHaveAttribute("poster", coverUrl);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect(page.getByLabel("Rendered slideshow video")).toHaveAttribute("src", videoUrl);
  await page.locator(".slideshow-handoff").getByRole("button", { name: "Create post", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.locator(".composer-media")).toContainText("Output slideshow.mp4");
  expect(state.renders).toHaveLength(1);
  await composer.locator(".destination-list button").filter({ hasText: "Instagram" }).click();
  await expect(composer.getByLabel("Publish as")).toHaveValue("reel");
  await composer.locator(".destination-list button").filter({ hasText: "TikTok" }).click();
  await expect(composer.getByRole("button", { name: "Choose frame", exact: true }).first()).toBeVisible();
  await expect(composer.locator(".reel-media video")).toHaveAttribute("src", videoUrl);
});

test("video renders recover from polling errors and allow retry and cancellation", async ({ page }) => {
  const state = await editor(page); state.pollFails = true;
  await page.getByRole("group", { name: "Output format" }).getByRole("button", { name: "Video", exact: true }).click();
  await page.getByRole("button", { name: "Save to Media", exact: true }).click();
  await expect(page.locator(".slideshow-render-status").getByRole("alert")).toHaveText("Progress service unavailable");
  state.pollFails = false; state.job = { ...state.job, status: "failed", error: "Renderer unavailable" };
  await page.getByRole("button", { name: "Check progress", exact: true }).click();
  await expect(page.locator(".slideshow-render-status").getByRole("alert")).toHaveText("Renderer unavailable");
  await page.getByRole("button", { name: "Retry render", exact: true }).click();
  await expect(page.locator(".slideshow-render-status").getByRole("status")).toHaveText("Video queued");
  await page.getByRole("button", { name: "Cancel render", exact: true }).click();
  await expect(page.locator(".slideshow-render-status").getByRole("status")).toHaveText("Video cancelled");
  await expect(page.getByLabel("Project name")).toBeEnabled();
  expect(state.actions).toEqual(["retry", "cancel"]);
  await page.getByRole("button", { name: "Retry render", exact: true }).click();
  state.job = { ...state.job, status: "completed", progress: 100, renderedUrl: videoUrl };
  await expect(page.getByLabel("Rendered slideshow video")).toHaveAttribute("src", videoUrl);
});

test("Create post waits for a queued video and images retain the legacy carousel handoff", async ({ page }) => {
  const state = await editor(page);
  await page.getByRole("button", { name: "Save to Media", exact: true }).click();
  await expect(page.locator(".slideshow-notice")).toContainText("2 ordered JPEGs saved");
  expect(state.renders[0]).toEqual({ id: state.project.id, format: "images" });
  await page.locator(".slideshow-handoff").getByRole("button", { name: "Create post", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.locator(".composer-media")).toContainText("2 ordered slides ready");
  await page.keyboard.press("Escape");
  await page.getByRole("group", { name: "Output format" }).getByRole("button", { name: "Video", exact: true }).click();
  await page.locator(".slideshow-handoff").getByRole("button", { name: "Create post", exact: true }).click();
  await expect(page.locator(".slideshow-render-status").getByRole("status")).toHaveText("Video queued");
  await expect(composer).toBeHidden();
  state.job = { ...state.job, status: "completed", progress: 100, renderedUrl: videoUrl, coverUrl };
  await expect(composer.locator(".composer-media")).toContainText("Output slideshow.mp4");
});

test("editing a failed export dismisses its retry and uses a fresh render snapshot", async ({ page }) => {
  const state = await editor(page);
  state.job = { ...state.job, status: "failed", error: "Render failed" };
  await page.getByRole("group", { name: "Output format" }).getByRole("button", { name: "Video", exact: true }).click();
  await page.locator(".slideshow-handoff").getByRole("button", { name: "Create post", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry render", exact: true })).toBeVisible();
  await page.getByLabel("Project name").fill("Updated slideshow");
  await expect(page.getByRole("button", { name: "Retry render", exact: true })).toHaveCount(0);
  state.job = { ...state.job, status: "queued", error: undefined };
  await page.locator(".slideshow-handoff").getByRole("button", { name: "Create post", exact: true }).click();
  await expect.poll(() => state.renders.length).toBe(2);
  expect(state.project.name).toBe("Updated slideshow");
  state.job = { ...state.job, status: "completed", progress: 100, renderedUrl: videoUrl };
  await expect(page.getByRole("dialog", { name: "Create post" }).locator(".composer-media")).toContainText("Updated slideshow.mp4");
});

test("a queued render resumes after back and reload without exporting twice or automatically opening the composer", async ({ page }) => {
  const state = await editor(page);
  await page.getByRole("group", { name: "Output format" }).getByRole("button", { name: "Video", exact: true }).click();
  await page.locator(".slideshow-handoff").getByRole("button", { name: "Create post", exact: true }).click();
  await expect(page.locator(".slideshow-render-status").getByRole("status")).toHaveText("Video queued");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("relay-slideshow-output-v1:output-slides") ?? "null")?.job?.id)).toBe(state.job.id);
  await page.getByRole("button", { name: "Back to slideshows", exact: true }).click();
  await page.getByRole("button", { name: /^Output slideshow/ }).click();
  await expect(page.locator(".slideshow-render-status").getByRole("status")).toHaveText("Video queued");
  await expect(page.getByLabel("Project name")).toBeDisabled();
  const beforeReload = state.polls;
  await page.reload();
  await page.getByRole("button", { name: /^Output slideshow/ }).click();
  await expect(page.locator(".slideshow-render-status").getByRole("status")).toHaveText("Video queued");
  await expect.poll(() => state.polls).toBeGreaterThan(beforeReload);
  state.job = { ...state.job, status: "completed", progress: 100, renderedUrl: videoUrl, coverUrl };
  await expect(page.getByLabel("Rendered slideshow video")).toHaveAttribute("src", videoUrl);
  await expect(page.getByRole("dialog", { name: "Create post" })).toHaveCount(0);
  expect(state.renders).toHaveLength(1);
  await page.getByRole("button", { name: "Back to slideshows", exact: true }).click();
  await page.getByRole("button", { name: /^Output slideshow/ }).click();
  await expect(page.getByLabel("Rendered slideshow video")).toHaveAttribute("src", videoUrl);
  await page.locator(".slideshow-handoff").getByRole("button", { name: "Create post", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Create post" }).locator(".composer-media")).toContainText("Output slideshow.mp4");
  expect(state.renders).toHaveLength(1);
});
