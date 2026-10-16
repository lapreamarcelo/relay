import { expect, test, type Page } from "@playwright/test";
import { normalizeVideoTimeline } from "../lib/video-timeline";

async function openEditor(page: Page) {
  let saved: any = { id: "relay-motion", name: "Motion authoring", caption: "", brandId: "", labels: [], revision: 1, createdAt: "2026-10-08T00:00:00Z", updatedAt: "2026-10-08T00:00:00Z", timeline: {
    version: 1, aspectRatio: "9:16", clips: [{ id: "screen", name: "App recording", sourceUrl: "https://media.example.test/motion.svg", kind: "image", inMs: 0, outMs: 6000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 0, deviceFrame: { device: "iphone", background: "#E8E2D8", color: "#1D1D1F" } }],
    labels: [{ id: "headline", text: "A new rhythm", x: .5, y: .2, width: .8, height: .1, fontSize: 64, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark", startMs: 0, endMs: 6000 }],
    music: { url: "", volume: .4, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0,
    camera: { zoom: 1, x: .5, y: .5, keyframes: [{ timeMs: 0, zoom: 1 }, { timeMs: 2000, zoom: 2 }, { timeMs: 5000, zoom: 1 }] },
  } };
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://media.example.test/**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="844"><rect width="390" height="844" fill="#45665c"/></svg>' }));
  await page.route("**/api/v1/videos", route => {
    if (route.request().method() === "PATCH") { const input = route.request().postDataJSON(); saved = { ...input, timeline: normalizeVideoTimeline(input.timeline), revision: saved.revision + 1 }; return route.fulfill({ json: { data: saved } }); }
    return route.fulfill({ json: { data: [saved] } });
  });
  for (const path of ["videos/templates", "brands/kit", "videos/jobs*", "media/projects", "media?*"]) await page.route(`**/api/v1/${path}`, route => route.fulfill({ json: { data: [] } }));
  await page.goto("/demo?view=videos"); await page.getByRole("button", { name: /^Motion authoring/ }).click();
  return { saved: () => saved, errors };
}

test("camera spring, custom curve, scale timing and keyboard keyframe edits persist", async ({ page }) => {
  const state = await openEditor(page), camera = page.getByRole("region", { name: "Camera & focus", exact: true });
  await camera.getByText("Camera keyframes", { exact: false }).click();
  await camera.getByLabel("Camera keyframe 1 easing", { exact: true }).selectOption("spring");
  await camera.getByLabel("Camera keyframe 1 spring stiffness", { exact: true }).fill("230");
  await camera.getByLabel("Camera keyframe 1 spring damping", { exact: true }).fill("18");
  await camera.getByLabel("Camera keyframe 2 easing", { exact: true }).selectOption("cubic-bezier");
  await camera.getByLabel("Camera keyframe 2 curve start time", { exact: true }).fill("0.3");
  await camera.getByLabel("Camera keyframe 2 curve start progress", { exact: true }).fill("1.2");
  await camera.getByLabel("Camera scale interpolation", { exact: true }).selectOption("perceptual");
  await camera.getByLabel("Camera after last keyframe", { exact: true }).selectOption("return");
  await camera.getByLabel("Camera return duration", { exact: true }).fill("500");
  const lane = camera.getByTestId("camera-keyframe-lane"), middle = lane.getByRole("button", { name: /Camera keyframe 2 at/ });
  await middle.focus(); await middle.press("Enter"); await middle.press("ArrowRight");
  await expect(lane.getByRole("button", { name: /Camera keyframe 2 at 2.10s local/ })).toBeVisible();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.saved().timeline.camera).toMatchObject({ scaleMode: "perceptual", returnMs: 500, keyframes: [ { easing: "spring", curve: { stiffness: 230, damping: 18 } }, { timeMs: 2100, easing: "cubic-bezier", curve: { controlPoints: [.3, 1.2, .36, 1] } }, {} ] });
  expect(state.errors).toEqual([]);
});

test("Relay recipes remain editable and text effects never appear in device entrance choices", async ({ page }) => {
  const state = await openEditor(page);
  await page.getByRole("button", { name: "Add text label", exact: true }).click();
  const text = page.getByTestId("label-animation-controls");
  await text.getByLabel("Label entrance animation", { exact: true }).selectOption("letter-rise");
  await text.getByLabel("Label entrance stagger", { exact: true }).fill("60");
  await text.getByText("Relay motion recipes", { exact: true }).click();
  await text.getByRole("button", { name: "Accent beat", exact: true }).click();
  await expect(text.getByTestId("label-keyframe-lane").getByRole("button", { name: /Label keyframe \d+ at/ })).toHaveCount(4);
  await text.getByLabel("Label motion length", { exact: true }).fill("3000");
  await text.getByRole("button", { name: "Retime label keys", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const animation = state.saved().timeline.labels.at(-1).animation;
  expect(animation.entrance).toMatchObject({ preset: "letter-rise", staggerMs: 60 });
  expect(animation.keyframes.at(-1).timeMs).toBe(3000); expect(animation.keyframes.at(-1).scale).toBe(1);
  await expect(page.getByLabel("Device entrance animation", { exact: true }).locator('option[value="letter-rise"]')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("dragging camera keys creates one undo transaction and selection supports duplication", async ({ page }, info) => {
  test.skip(info.project.name !== "chromium", "Desktop drag transaction");
  const state = await openEditor(page), lane = page.getByRole("region", { name: "Camera & focus", exact: true }).getByTestId("camera-keyframe-lane");
  const marker = lane.getByRole("button", { name: /Camera keyframe 2 at/ }); await marker.scrollIntoViewIfNeeded();
  const rect = (await marker.boundingBox())!, rail = (await lane.locator(".motion-lane-rail").boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down(); await page.mouse.move(rect.x + rect.width / 2 + rail.width / 6, rect.y + rect.height / 2, { steps: 8 }); await page.mouse.up();
  await expect(lane.getByRole("button", { name: /Camera keyframe 2 at 3.00s local/ })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(lane.getByRole("button", { name: /Camera keyframe 2 at 2.00s local/ })).toBeVisible();
  await lane.getByRole("button", { name: /Camera keyframe 2 at/ }).click();
  await lane.getByRole("button", { name: "Duplicate camera selected keyframes", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.saved().timeline.camera.keyframes.map((frame: { timeMs: number }) => frame.timeMs)).toEqual([0, 2000, 2100, 5000]); expect(state.errors).toEqual([]);
});
