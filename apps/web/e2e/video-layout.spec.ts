import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { normalizeVideoTimeline } from "../lib/video-timeline";

test.use({ actionTimeout: 15_000 });

const screen = "https://media.example.test/layout-screen.svg";
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#dce8e0"/><rect x="30" y="120" width="330" height="140" rx="20" fill="#376456"/></svg>';

async function editor(page: Page, layerCount = 0, empty = false) {
  const source = { id: "recording", name: "App recording", sourceUrl: screen, kind: "image", inMs: 0, outMs: 5000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 0 };
  let project: any = {
    id: "layout-demo", name: "Workspace layout demo", caption: "", brandId: "", labels: [], revision: 1,
    createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z",
    timeline: normalizeVideoTimeline({ version: 1, aspectRatio: "9:16", clips: empty ? [] : [source],
      layers: Array.from({ length: layerCount }, (_, index) => ({ ...source, id: `layer-${index}`, name: `Device ${index + 1}`, startMs: 0, deviceFrame: { device: "watch", color: "#1D1D1F", background: "#E8E2D8", x: .5, y: .5, scale: .5 } })),
      labels: [{ id: "title", text: "Your next app", x: .5, y: .18, width: .84, height: .12, fontSize: 72, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark", startMs: 0, endMs: 5000 }],
      music: { url: "https://media.example.test/layout-audio.mp4", name: "Launch music", volume: .4, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0 }),
  };
  if (empty) { project.timeline.labels = []; project.timeline.music.url = ""; }
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("https://media.example.test/**", route => route.request().url().endsWith(".svg")
    ? route.fulfill({ contentType: "image/svg+xml", body: artwork })
    : route.fulfill({ contentType: "video/mp4", body: readFileSync(new URL("./fixtures/device-demo.mp4", import.meta.url)) }));
  await page.route("**/api/v1/videos", route => {
    if (route.request().method() === "PATCH") {
      const next = route.request().postDataJSON();
      project = { ...next, timeline: normalizeVideoTimeline(next.timeline), revision: project.revision + 1 };
      return route.fulfill({ json: { data: project } });
    }
    return route.fulfill({ json: { data: [project] } });
  });
  for (const path of ["videos/templates", "brands/kit", "videos/jobs*", "media/projects", "media?*"])
    await page.route(`**/api/v1/${path}`, route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/videos/compose", route => route.fulfill({ json: { data: { available: false } } }));
  await page.goto("/demo?view=videos");
  await page.getByRole("button", { name: /^Workspace layout demo/ }).click();
  await expect(page.locator(".video-workbench")).toBeVisible();
  await page.locator(".unified-video-studio").evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  return { project: () => project, errors };
}

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  return (await locator.boundingBox())!;
}

async function pinnedWorkspace(page: Page) {
  const size = page.viewportSize()!;
  const canvas = await bounds(page.locator(".unified-video-canvas"));
  const timeline = await bounds(page.locator("#video-timeline"));
  const playback = await bounds(page.locator(".timeline-playback"));
  const inspector = await bounds(page.getByRole("complementary", { name: "Video settings", exact: true }));
  for (const rect of [canvas, timeline, playback, inspector]) {
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
    expect(rect.x).toBeGreaterThanOrEqual(-2);
    expect(rect.y).toBeGreaterThanOrEqual(-2);
    expect(rect.x + rect.width).toBeLessThanOrEqual(size.width + 2);
    expect(rect.y + rect.height).toBeLessThanOrEqual(size.height + 2);
  }
  expect(canvas.y + canvas.height).toBeLessThanOrEqual(timeline.y + 2);
  expect(timeline.x + timeline.width).toBeLessThanOrEqual(inspector.x + 2);
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollHeight - document.documentElement.clientHeight,
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  ))).toBeLessThanOrEqual(2);
  return { canvas, timeline };
}

async function range(locator: Locator, value: number) {
  await locator.evaluate((element, next) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function sharedAppPalette(page: Page) {
  const studio = page.locator(".unified-video-studio");
  const palette = await studio.evaluate(element => {
    const shared = getComputedStyle(document.documentElement), editor = getComputedStyle(element);
    return ["--bg", "--surface", "--surface-2", "--surface-3", "--ink", "--muted", "--line", "--accent", "--accent-soft"].map(name => ({
      name, app: shared.getPropertyValue(name).trim(), editor: editor.getPropertyValue(name).trim(),
    }));
  });
  for (const token of palette) expect(token.editor, token.name).toBe(token.app);
  await expect(studio).toHaveCSS("background-color", await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor));
  const appButton = page.getByRole("button", { name: "Create post", exact: true }).first();
  const saveButton = page.getByRole("button", { name: "Save & download", exact: true });
  for (const property of ["background-color", "color"])
    await expect(saveButton).toHaveCSS(property, await appButton.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property));
  await expect(page.getByRole("navigation", { name: "Video settings shortcuts" }).getByRole("button")).toHaveCount(6);
  await expect(page.getByRole("button", { name: "AI settings", exact: true })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "AI video composer", exact: true })).toHaveCount(0);
}

test("desktop preview and timeline fit every promotion ratio and remain fixed while settings scroll", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop workspace geometry");
  const state = await editor(page);
  const inspector = page.getByRole("complementary", { name: "Video settings", exact: true });
  for (const size of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(size);
    for (const ratio of ["9:16", "4:5", "1:1", "16:9"]) {
      await page.getByLabel("Aspect ratio", { exact: true }).selectOption(ratio);
      const before = await pinnedWorkspace(page);
      const [width, height] = ratio.split(":").map(Number);
      expect(before.canvas.width / before.canvas.height).toBeCloseTo(width / height, 2);
      await inspector.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await expect.poll(() => inspector.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      const after = await pinnedWorkspace(page);
      expect(Math.abs(after.canvas.y - before.canvas.y)).toBeLessThanOrEqual(2);
      expect(Math.abs(after.timeline.y - before.timeline.y)).toBeLessThanOrEqual(2);
      await inspector.evaluate(element => { element.scrollTop = 0; });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByLabel("Aspect ratio", { exact: true }).selectOption("9:16");
  await inspector.evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: "/tmp/relay-fixed-video-workspace.png", fullPage: true });
  expect(state.errors).toEqual([]);
});

test("timeline selection exposes clip and audio settings on the right without displacing the preview", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop settings containment");
  await page.setViewportSize({ width: 1280, height: 720 });
  const state = await editor(page);
  const inspector = page.getByRole("complementary", { name: "Video settings", exact: true });
  const before = await pinnedWorkspace(page);
  await page.locator(".timeline-clips > button").click();
  await inspector.getByLabel("Trim end (ms)", { exact: true }).fill("4500");
  await inspector.getByText("Clip adjustments", { exact: true }).click();
  await range(inspector.getByLabel("Source volume", { exact: true }), .25);
  await page.getByRole("button", { name: "Edit audio: Launch music", exact: true }).click();
  await inspector.getByLabel("Fade in (s)", { exact: true }).fill("0.5");
  await inspector.getByLabel("Fade out (s)", { exact: true }).fill("0.8");
  await expect(inspector.getByLabel("Audio volume", { exact: true })).toBeVisible();
  await expect(inspector.getByRole("region", { name: "AI video composer", exact: true })).toHaveCount(0);
  const after = await pinnedWorkspace(page);
  expect(Math.abs(after.canvas.y - before.canvas.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.timeline.y - before.timeline.y)).toBeLessThanOrEqual(2);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.project().timeline.clips[0]).toMatchObject({ outMs: 4500, volume: .25 });
  expect(state.project().timeline.music).toMatchObject({ fadeInMs: 500, fadeOutMs: 800 });
  expect(state.errors).toEqual([]);
});

test("many device tracks scroll inside the timeline while its ruler and playhead stay available", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop track scrolling");
  await page.setViewportSize({ width: 1024, height: 600 });
  const state = await editor(page, 12);
  const timeline = page.locator("#video-timeline");
  const ruler = timeline.locator(".timeline-ruler");
  const playhead = page.getByLabel("Timeline playhead", { exact: true });
  const before = await pinnedWorkspace(page);
  await page.getByRole("button", { name: "Layer track: Device 1", exact: true }).scrollIntoViewIfNeeded();
  await expect.poll(() => timeline.evaluate(element => [...element.querySelectorAll("*")].some(node => node.scrollTop > 0))).toBe(true);
  const timelineBounds = await bounds(timeline);
  for (const locator of [ruler, playhead]) {
    const rect = await bounds(locator);
    expect(rect.y).toBeGreaterThanOrEqual(timelineBounds.y - 2);
    expect(rect.y + rect.height).toBeLessThanOrEqual(timelineBounds.y + timelineBounds.height + 2);
  }
  await page.getByRole("button", { name: "Layer track: Device 1", exact: true }).click();
  await expect(page.getByLabel("Layer name", { exact: true })).toHaveValue("Device 1");
  await range(timeline.getByLabel("Zoom", { exact: true }), 4);
  const scroll = timeline.locator(".timeline-scroll");
  await expect.poll(() => scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await range(playhead, 2500);
  await expect(playhead).toHaveValue("2500");
  const after = await pinnedWorkspace(page);
  expect(Math.abs(after.canvas.y - before.canvas.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.timeline.y - before.timeline.y)).toBeLessThanOrEqual(2);
  expect(state.errors).toEqual([]);
});

test("mobile keeps ordinary page scrolling and settings remain reachable without horizontal overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile flow layout");
  const state = await editor(page, 2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight)).toBe(true);
  const inspector = page.getByRole("complementary", { name: "Video settings", exact: true });
  await inspector.getByLabel("Label text", { exact: true }).fill("Made for your wrist");
  await page.locator("#video-timeline").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Edit audio: Launch music", exact: true }).click();
  await inspector.getByLabel("Fade in (s)", { exact: true }).fill("0.3");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.project().timeline.labels[0].text).toBe("Made for your wrist");
  expect(state.project().timeline.music.fadeInMs).toBe(300);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(state.errors).toEqual([]);
});

test("empty desktop projects keep their media actions visible within the fixed workspace", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop empty workspace");
  await page.setViewportSize({ width: 1024, height: 600 });
  const state = await editor(page, 0, true);
  await pinnedWorkspace(page);
  const canvas = await bounds(page.locator(".unified-video-canvas"));
  for (const name of ["Browse Media", "Upload media"]) {
    const action = page.locator(".video-empty-actions").getByRole("button", { name, exact: true });
    const rect = await bounds(action);
    expect(rect.x).toBeGreaterThanOrEqual(canvas.x);
    expect(rect.y).toBeGreaterThanOrEqual(canvas.y);
    expect(rect.x + rect.width).toBeLessThanOrEqual(canvas.x + canvas.width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(canvas.y + canvas.height);
  }
  await page.locator(".video-empty-actions").getByRole("button", { name: "Browse Media", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Video assets", exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("studio shortcuts reach every inspector section and transport controls preserve the document", async ({ page }, testInfo) => {
  if (testInfo.project.name === "chromium") await page.setViewportSize({ width: 1440, height: 900 });
  const state = await editor(page);
  const shortcuts = page.getByRole("navigation", { name: "Video settings shortcuts" });
  const inspector = page.getByRole("complementary", { name: "Video settings", exact: true });
  const targets: Record<string, string> = {
    Camera: ".video-camera-controls", Device: "[data-device-settings]", Text: "[data-label-settings]",
    Canvas: "[data-canvas-settings]", Audio: "[data-audio-settings]", Export: ".slideshow-handoff",
  };
  const before = testInfo.project.name === "chromium" ? await pinnedWorkspace(page) : undefined;
  for (const [name, target] of Object.entries(targets)) {
    await shortcuts.getByRole("button", { name: `${name} settings`, exact: true }).click();
    const section = await bounds(inspector.locator(target));
    if (before) {
      const panel = await bounds(inspector), nav = await bounds(shortcuts);
      expect(section.y).toBeGreaterThanOrEqual(nav.y + nav.height - 2);
      expect(section.y).toBeLessThan(panel.y + panel.height);
      const after = await pinnedWorkspace(page);
      expect(after.canvas.y).toBeCloseTo(before.canvas.y);
      expect(after.timeline.y).toBeCloseTo(before.timeline.y);
    } else {
      expect(section.y).toBeLessThan(page.viewportSize()!.height);
    }
  }
  await page.getByRole("button", { name: "Go to end", exact: true }).click();
  await expect(page.getByLabel("Timeline playhead", { exact: true })).toHaveValue("4999");
  await page.getByRole("button", { name: "Go to start", exact: true }).click();
  await expect(page.getByLabel("Timeline playhead", { exact: true })).toHaveValue("0");
  await shortcuts.getByRole("button", { name: "Device settings", exact: true }).click();
  await inspector.getByRole("button", { name: "iPhone", exact: true }).click();
  await shortcuts.getByRole("button", { name: "Camera settings", exact: true }).click();
  await inspector.getByRole("button", { name: "Focus & return", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.project().timeline.clips[0].deviceFrame.device).toBe("iphone");
  expect(state.project().timeline.camera.keyframes).toHaveLength(4);
  expect(state.project().timeline.labels[0].text).toBe("Your next app");
  expect(state.project().timeline.music.name).toBe("Launch music");
  expect(state.errors).toEqual([]);
  if (before) await page.screenshot({ path: "/tmp/relay-matte-video-workspace.png", fullPage: true });
  else await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

for (const initialTheme of ["light", "dark"] as const) {
  test(`editor follows the saved ${initialTheme} website theme and switching preserves the video`, async ({ page }, testInfo) => {
    await page.addInitScript(theme => {
      if (!localStorage.getItem("relay-theme")) localStorage.setItem("relay-theme", theme);
    }, initialTheme);
    if (testInfo.project.name === "chromium") await page.setViewportSize({ width: 1440, height: 900 });
    const state = await editor(page);
    const studio = page.locator(".unified-video-studio"), inspector = page.getByRole("complementary", { name: "Video settings", exact: true });
    await inspector.getByRole("button", { name: "iPhone", exact: true }).click();
    await inspector.getByLabel("Label text", { exact: true }).fill("Your app, your way");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const document = structuredClone(state.project().timeline);
    const media = await page.locator(".unified-video-canvas").getAttribute("style");
    const labels = await page.locator(".unified-video-canvas > .timeline-label-preview").innerHTML();
    const before = testInfo.project.name === "chromium" ? await pinnedWorkspace(page) : undefined;
    const framedScreen = page.locator(".unified-video-canvas [data-device-panel]").first();
    await expect(framedScreen).toBeVisible();
    await expect(studio).toHaveCSS("color-scheme", initialTheme);
    await sharedAppPalette(page);
    const alternate = initialTheme === "dark" ? "light" : "dark";
    const originalPalette = await inspector.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    await page.getByRole("button", { name: `Switch to ${alternate} mode`, exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", alternate);
    await expect(studio).toHaveCSS("color-scheme", alternate);
    await sharedAppPalette(page);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("relay-theme"))).toBe(alternate);
    const nextPalette = await inspector.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }));
    expect(nextPalette.background).not.toBe(originalPalette.background);
    expect(nextPalette.color).not.toBe(originalPalette.color);
    expect(state.project().timeline).toEqual(document);
    await expect(page.locator(".unified-video-canvas")).toHaveAttribute("style", media!);
    await expect(page.locator(".unified-video-canvas > .timeline-label-preview")).toHaveJSProperty("innerHTML", labels);
    await expect(framedScreen).toBeVisible();
    if (before) {
      const after = await pinnedWorkspace(page);
      expect(after.canvas.y).toBeCloseTo(before.canvas.y);
      expect(after.timeline.y).toBeCloseTo(before.timeline.y);
    }
    await page.getByRole("button", { name: `Switch to ${initialTheme} mode`, exact: true }).click();
    await expect(studio).toHaveCSS("color-scheme", initialTheme);
    await page.getByRole("navigation", { name: "Video settings shortcuts" }).getByRole("button", { name: "Camera settings", exact: true }).click();
    if (initialTheme === "light") {
      await expect(framedScreen).toBeVisible();
      if (before) await page.locator(".unified-video-canvas").evaluate(async element => {
        await Promise.all([...element.querySelectorAll("img")].map(image => image.decode()));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      if (before) await page.screenshot({ path: "/tmp/relay-video-editor-light.png", fullPage: true, animations: "disabled" });
      await page.getByRole("button", { name: "Switch to dark mode", exact: true }).click();
      await expect(framedScreen).toBeVisible();
      if (before) await page.locator(".unified-video-canvas").evaluate(async element => {
        await Promise.all([...element.querySelectorAll("img")].map(image => image.decode()));
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      if (before) await page.screenshot({ path: "/tmp/relay-video-editor-dark.png", fullPage: true, animations: "disabled" });
    }
    await page.reload();
    await page.getByRole("button", { name: /^Workspace layout demo/ }).click();
    await expect(studio).toHaveCSS("color-scheme", "dark");
    expect(state.project().timeline).toEqual(document);
    await expect(inspector.getByLabel("Label text", { exact: true })).toHaveValue("Your app, your way");
    // Settings and the editor share the same state and local preference.
    await page.goto("/demo?view=settings");
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await expect(page.locator(".theme-options button.active")).toContainText("Dark");
    await page.locator(".theme-options button").filter({ hasText: "Light" }).click();
    await page.goto("/demo?view=videos");
    await page.getByRole("button", { name: /^Workspace layout demo/ }).click();
    await expect(studio).toHaveCSS("color-scheme", "light");
    expect(state.project().timeline).toEqual(document);
    if (before) await pinnedWorkspace(page);
    else await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(state.errors).toEqual([]);
  });
}
