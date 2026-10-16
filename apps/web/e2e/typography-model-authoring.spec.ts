import { expect, test, type Page } from "@playwright/test";
import { normalizeVideoTimeline } from "../lib/video-timeline";

async function editor(page: Page) {
  let saved: any = { id: "typography-models", name: "Typography and models", caption: "", brandId: "", labels: [], revision: 1, createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z", timeline: {
    version: 1, aspectRatio: "16:9", clips: [{ id: "screen", name: "App screen", sourceUrl: "https://media.example.test/app.svg", kind: "image", inMs: 0, outMs: 6000, fit: "contain", x: .5, y: .5, zoom: 1, volume: 0, deviceFrame: { device: "tablet", background: "#071B28", color: "#1D1D1F" } }],
    labels: [{ id: "headline", text: "Café — a new rhythm", x: .5, y: .2, width: .8, height: .1, fontSize: 64, font: "modern", textColor: "#FFFFFF", background: "dark", backgroundColor: "#000000", style: "dark", startMs: 0, endMs: 6000 }], music: { url: "", volume: .4, offsetMs: 0, fadeInMs: 0, fadeOutMs: 0 }, coverMs: 0,
  } };
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("https://media.example.test/**", route => route.fulfill({ contentType: "image/svg+xml", headers:{"Access-Control-Allow-Origin":"*"}, body: '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1366"><rect width="1024" height="1366" fill="#45665c"/></svg>' }));
  await page.route("**/api/v1/videos", route => {
    if (route.request().method() === "PATCH") { const input = route.request().postDataJSON(); saved = { ...input, timeline: normalizeVideoTimeline(input.timeline), revision: saved.revision + 1 }; return route.fulfill({ json: { data: saved } }); }
    return route.fulfill({ json: { data: [saved] } });
  });
  for (const path of ["videos/templates", "brands/kit", "videos/jobs*", "media/projects", "media?*"]) await page.route(`**/api/v1/${path}`, route => route.fulfill({ json: { data: [] } }));
  await page.goto("/demo?view=videos"); await page.getByRole("button", { name: /^Typography and models/ }).click();
  return { saved: () => saved, errors };
}

test("typography style and original word effect survive a validated save", async ({ page }) => {
  const state = await editor(page);
  await page.getByText("Typography & text placement", { exact: true }).click();
  await page.getByLabel("Label weight", { exact: true }).selectOption("400");
  await page.getByLabel("Label alignment", { exact: true }).selectOption("left");
  await page.getByLabel("Label letter spacing", { exact: true }).fill("2.5");
  await page.getByLabel("Label font kerning", { exact: true }).uncheck();
  await page.getByLabel("Label italic", { exact: true }).check();
  await page.getByLabel("Label line spacing", { exact: true }).fill("1.4");
  await page.getByLabel("Label stroke width", { exact: true }).fill("2");
  await page.getByLabel("Label shadow blur", { exact: true }).fill("6");
  await page.getByLabel("Label background opacity", { exact: true }).fill("0.5");
  await page.getByLabel("Label background radius", { exact: true }).fill("10");
  await page.getByLabel("Label entrance animation", { exact: true }).selectOption("word-slide");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.saved().timeline.labels[0]).toMatchObject({ fontWeight: 400, textAlign: "left", letterSpacing: 2.5, kerning: false, italic: true, lineHeight: 1.4, strokeWidth: 2, shadowBlur: 6, backgroundOpacity: .5, backgroundRadius: 10, animation: { entrance: { preset: "word-slide" } } });
  await expect(page.locator(".timeline-label-preview svg path").first()).toBeAttached();
  expect(state.errors).toEqual([]);
});

test("switching to GPU model preserves a still pose until motion is explicitly selected", async ({ page }) => {
  const state = await editor(page);
  await page.getByLabel("Device rendering", { exact: true }).selectOption("gpu");
  await expect(page.getByLabel("Device 3D model", { exact: true })).toHaveValue("relay-tablet");
  await expect(page.getByLabel("Device animation", { exact: true })).toHaveValue("none");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const frame = state.saved().timeline.clips[0].deviceFrame;
  expect(frame.renderMode).toBe("gpu"); expect(frame.motion ?? "none").toBe("none"); expect(frame.animation).toBeUndefined();
  expect(frame.rotateX ?? 0).toBe(0); expect(frame.rotateY ?? 0).toBe(0); expect(frame.rotateZ ?? 0).toBe(0);
  await page.getByLabel("Device rendering", { exact: true }).selectOption("vector");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  expect(state.saved().timeline.clips[0].deviceFrame.renderMode).toBe("vector");
  expect(state.saved().timeline.clips[0].deviceFrame.animation).toBeUndefined(); expect(state.errors).toEqual([]);
});

test("3D preview matches HiDPI display density and resizes with the editor",async({browser})=>{
  test.setTimeout(120000);
  const context=await browser.newContext({viewport:{width:1600,height:1050},deviceScaleFactor:2}),page=await context.newPage();
  try{
    const state=await editor(page);await page.getByLabel("Device rendering",{exact:true}).selectOption("gpu");
    const dimensions=()=>page.locator(".video-gpu-preview canvas").evaluate(canvas=>{
      const el=canvas as HTMLCanvasElement,rect=el.getBoundingClientRect();return{width:el.width,expected:Math.round(Math.min(1920,Math.max(640,Math.ceil(rect.width*2))))};
    });
    await expect.poll(async()=>{const d=await dimensions();return Math.abs(d.width-d.expected);},{timeout:60000}).toBeLessThanOrEqual(2);
    const original=await dimensions();expect(original.width).toBeGreaterThan(960);
    await page.setViewportSize({width:1000,height:850});
    await expect.poll(async()=>{const d=await dimensions();return Math.abs(d.width-d.expected);},{timeout:60000}).toBeLessThanOrEqual(2);
    expect((await dimensions()).width).toBeLessThan(original.width);
    expect(state.errors).toEqual([]);
  }finally{await context.close();}
});
