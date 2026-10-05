import { expect, test, type Locator, type Page } from "@playwright/test";
import { normalizeVideoTimeline } from "../lib/video-timeline";

const sourceUrl = "https://media.example.test/camera-screen.svg";
const artwork = '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920"><rect width="1080" height="1920" fill="#304b45"/><rect x="160" y="680" width="760" height="450" rx="40" fill="#e7bd74"/></svg>';
async function editor(page: Page, limit = false) {
  const clip = { id: "recording", name: "App recording", sourceUrl, kind: "image", inMs: 0, outMs: 6000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 0, deviceFrame: { device: "iphone", background: "#E8E2D8", color: "#1D1D1F" } };
  let project: any = { id: "camera-demo", name: "Camera demo", caption: "", brandId: "", labels: [], revision: 1,
    createdAt: "2026-10-04T00:00:00Z", updatedAt: "2026-10-04T00:00:00Z",
    timeline: normalizeVideoTimeline({ version: 1, aspectRatio: "9:16", clips: [clip], layers: [{ ...clip, id: "watch", name: "Watch app", startMs: 0, deviceFrame: { ...clip.deviceFrame, device: "watch", x: .7, y: .6, scale: .3 } }],
      labels: [{ id: "title", text: "A closer look", x: .5, y: .18, width: .8, height: .1, fontSize: 64, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark", startMs: 0, endMs: 6000 }], music: { url: "", volume: .4, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0,
      ...(limit ? { camera: { zoom: 1, x: .5, y: .5, keyframes: Array.from({ length: 100 }, (_, index) => ({ timeMs: index * 50 + (index === 50 ? .25 : 0), zoom: 1 + index / 100, x: .5, y: .5 })) } } : {}) }), };
  const errors: string[] = [], compositions: any[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(sourceUrl, route => route.fulfill({ contentType: "image/svg+xml", body: artwork }));
  await page.route("**/api/v1/videos", route => {
    if (route.request().method() === "PATCH") {
      project = { ...route.request().postDataJSON(), timeline: normalizeVideoTimeline(route.request().postDataJSON().timeline), revision: project.revision + 1 };
      return route.fulfill({ json: { data: project } });
    }
    return route.fulfill({ json: { data: [project] } });
  });
  for (const path of ["videos/templates", "brands/kit", "videos/jobs*", "media/projects", "media?*"])
    await page.route(`**/api/v1/${path}`, route => route.fulfill({ json: { data: [] } }));
  await page.route("**/api/v1/videos/compose", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { data: { available: true } } });
    const request = route.request().postDataJSON(); compositions.push(request);
    return route.fulfill({ json: { data: { timeline: request.timeline, summary: "A cinematic focus move", warnings: [] } } });
  });
  await page.goto("/demo?view=videos");
  await page.getByRole("button", { name: /^Camera demo/ }).click();
  await expect(page.getByRole("region", { name: "Camera & focus", exact: true })).toBeVisible();
  await page.locator(".unified-video-studio").evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  return { project: () => project, errors, compositions };
}
async function range(input: Locator, value: number) {
  await input.evaluate((element, next) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, String(next));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

// Both desktop and mobile exercise the same saved camera document and controls.
test("camera zoom, focus picking, presets and keyframes persist while scene labels stay steady", async ({ page }, testInfo) => {
  if (testInfo.project.name === "chromium") await page.setViewportSize({ width: 1280, height: 720 });
  const state = await editor(page), controls = page.getByRole("region", { name: "Camera & focus", exact: true });
  const scene = page.locator(".unified-video-canvas > [data-camera-preview]"), labels = page.locator(".unified-video-canvas > .timeline-label-preview");
  const labelMarkup = await labels.innerHTML(), initialTransform = await scene.evaluate(element => (element as HTMLElement).style.transform);
  const beforeCanvas = await page.locator(".unified-video-canvas").boundingBox(), beforeTimeline = await page.locator("#video-timeline").boundingBox();
  await range(controls.getByLabel("Camera zoom", { exact: true }), 2);
  await expect(scene).toHaveCSS("transform", /matrix\(2, 0, 0, 2,/);
  await expect(labels).toHaveJSProperty("innerHTML", labelMarkup);
  await expect(scene.locator("[data-layer-preview='watch']")).toHaveCount(1);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(() => scene.evaluate(element => (element as HTMLElement).style.transform)).toBe(initialTransform);
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await controls.getByRole("button", { name: "Pick focus", exact: true }).click();
  const picker = page.getByRole("button", { name: "Pick camera focus on video", exact: true });
  await picker.scrollIntoViewIfNeeded(); const rect = (await picker.boundingBox())!;
  await picker.click({ position: { x: rect.width * .75, y: rect.height * .6 } });
  await expect.poll(async()=>Number(await controls.getByLabel("Camera focus horizontal", { exact: true }).inputValue())).toBeCloseTo(.625, 1);
  await controls.getByRole("button", { name: "Focus & return", exact: true }).click();
  await range(page.getByLabel("Timeline playhead", { exact: true }), 3000);
  await expect(controls.getByLabel("Camera zoom", { exact: true })).toHaveValue("2");
  await range(controls.getByLabel("Camera zoom", { exact: true }), 2.5);
  await controls.getByText("Camera keyframes", { exact: false }).click();
  await expect(controls.getByLabel(/Camera keyframe \d+ time/)).toHaveCount(5);
  const current = controls.locator("li").filter({ hasText: "3.00s" });
  await current.getByLabel(/easing/).selectOption("ease-out");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.project().timeline.camera.keyframes).toContainEqual(expect.objectContaining({ timeMs: 3000, zoom: 2.5, easing: "ease-out" }));
  if (testInfo.project.name === "chromium") {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)).toBeLessThanOrEqual(2);
    const afterCanvas = (await page.locator(".unified-video-canvas").boundingBox())!, afterTimeline = (await page.locator("#video-timeline").boundingBox())!;
    expect(afterCanvas.y).toBeCloseTo(beforeCanvas!.y); expect(afterTimeline.y).toBeCloseTo(beforeTimeline!.y);
    await controls.scrollIntoViewIfNeeded();
    await page.screenshot({path:"/tmp/relay-camera-focus-workspace.png",fullPage:true});
  } else await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.reload(); await page.getByRole("button", { name: /^Camera demo/ }).click();
  await range(page.getByLabel("Timeline playhead", { exact: true }), 3000);
  await expect(page.getByLabel("Camera zoom", { exact: true })).toHaveValue("2.5");
  await range(page.getByLabel("Timeline playhead", { exact: true }), 0);
  await expect(page.getByLabel("Camera zoom", { exact: true })).toHaveValue("1");
  expect(state.errors).toEqual([]);
});

test("bulk and AI composition previews carry the same camera animation beneath labels", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Shared preview rendering");
  const state = await editor(page), controls = page.getByRole("region", { name: "Camera & focus", exact: true });
  await controls.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.getByRole("button", { name: "Bulk text", exact: true }).click();
  const variants = page.getByRole("dialog", { name: "Create text variants", exact: true });
  await variants.getByLabel("Variant texts", { exact: true }).fill("See the details\nA new perspective");
  await range(variants.getByLabel("Variant preview playhead", { exact: true }), 5999);
  await expect.poll(()=>variants.locator("[data-camera-preview]").evaluate(element=>new DOMMatrix(getComputedStyle(element).transform).a)).toBeCloseTo(2, 2);
  await expect(variants.locator(".timeline-label-preview")).toContainText("See the details");
  await variants.getByRole("button", { name: "Close text variants", exact: true }).click();
  const composer = page.getByRole("region", { name: "AI video composer", exact: true });
  await composer.getByRole("button", { name: /Compose with AI/ }).click();
  await composer.getByLabel("Describe your video", { exact: true }).fill("Make a cinematic focus move to highlight my app.");
  await composer.getByRole("button", { name: "Generate composition", exact: true }).click();
  await expect(composer.locator('[aria-label="Review generated composition"]')).toBeVisible();
  await range(composer.getByLabel("Composition preview playhead", { exact: true }), 5999);
  await expect.poll(()=>composer.locator("[data-camera-preview]").evaluate(element=>new DOMMatrix(getComputedStyle(element).transform).a)).toBeCloseTo(2, 2);
  expect(state.compositions[0].timeline.camera.keyframes.length).toBeGreaterThan(1);
  await composer.getByRole("button", { name: "Apply composition", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.project().timeline.camera).toEqual(state.compositions[0].timeline.camera);
  expect(state.errors).toEqual([]);
});

test("camera keyframe limit allows editing existing poses and deleting before a new capture", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Camera editing limits");
  const state = await editor(page, true), controls = page.getByRole("region", { name: "Camera & focus", exact: true });
  await controls.getByText("Camera keyframes", { exact: false }).click();
  await controls.getByRole("button", { name: "Go to camera keyframe 51", exact: true }).click();
  await expect(controls.getByLabel("Camera zoom", { exact: true })).toBeEnabled();
  await range(controls.getByLabel("Camera zoom", { exact: true }), 2.2);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.project().timeline.camera.keyframes).toHaveLength(100);
  expect(state.project().timeline.camera.keyframes[50]).toMatchObject({timeMs:2500.25,zoom:2.2});
  expect(state.project().timeline.camera.keyframes.some((frame:{timeMs:number})=>frame.timeMs===2500)).toBe(false);
  await range(page.getByLabel("Timeline playhead", { exact: true }), 5100);
  await expect(controls.getByLabel("Camera zoom", { exact: true })).toBeDisabled();
  await expect(controls.getByRole("button", { name: "Capture camera at playhead", exact: true })).toBeDisabled();
  await controls.getByRole("button", { name: "Delete camera keyframe 100", exact: true }).click();
  await expect(controls.getByLabel("Camera zoom", { exact: true })).toBeEnabled();
  await controls.getByRole("button", { name: "Capture camera at playhead", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.project().timeline.camera.keyframes).toHaveLength(100);
  expect(state.project().timeline.camera.keyframes.at(-1).timeMs).toBe(5100);
  expect(state.errors).toEqual([]);
});

test("dragging a device under camera zoom keeps its position tied to the visible movement", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop pointer geometry");
  await page.setViewportSize({width:1440,height:900});
  const state=await editor(page);
  await range(page.getByLabel("Camera zoom",{exact:true}),2);
  const canvas=(await page.locator(".unified-video-canvas").boundingBox())!;
  const hit=page.getByRole("button",{name:"Select device layer: Watch app",exact:true});
  const device=(await hit.boundingBox())!;
  const x=Math.min(canvas.x+canvas.width-3,device.x+device.width/2),y=device.y+device.height/2;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-12,y,{steps:4});await page.mouse.up();
  await page.getByRole("button",{name:"Save draft",exact:true}).click();
  expect(state.project().timeline.layers[0].deviceFrame.x).toBeCloseTo(.7-12/(canvas.width*2),2);
  expect(state.project().timeline.camera.zoom).toBe(2);
  expect(state.errors).toEqual([]);
});
