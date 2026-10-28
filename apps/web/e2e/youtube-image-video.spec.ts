import { expect, test, type Page } from "@playwright/test";

const slides = [1, 2, 3].map((number) => `https://media.example.com/youtube-slide-${number}.jpg`);

async function openImageComposer(page: Page, count: number, imageSeconds?: number) {
  await page.route("https://media.example.com/**", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#25483e"/></svg>' }));
  await page.addInitScript(({ urls, imageSeconds }) => {
    if (localStorage.getItem("relay-composer-draft-v1")) return;
    localStorage.setItem("relay-composer-draft-v1", JSON.stringify({ version: 1, text: "YouTube image conversion", brandId: "brand-aster", selected: ["account-instagram"],
      media: { name: "Launch images", type: "image", url: urls[0], previewUrl: urls[0], urls },
      youtube: { kind: "youtube", title: "Launch images", tags: [], privacyStatus: "private", madeForKids: false, imageSeconds }, schedule: false, scheduledAt: "2027-01-01T09:30" }));
  }, { urls: slides.slice(0, count), imageSeconds });
  await page.goto("/demo?view=posts");
  await page.getByRole("button", { name: /Create post/ }).first().click();
  const composer = page.getByRole("dialog", { name: "Create post" });
  const youtube = composer.locator(".destination-list button").filter({ hasText: "YouTube" });
  await expect(youtube).toBeEnabled();
  await youtube.click();
  return composer;
}

test("a single image defaults to eight seconds and retains timing and originals through recovery, edit and duplicate", async ({ page }) => {
  let composer = await openImageComposer(page, 1);
  await expect(composer.getByLabel("YouTube image video duration")).toHaveValue("8");
  await expect(composer.getByText("YouTube will publish this as a slideshow video · 8 seconds")).toBeVisible();
  await composer.getByLabel("YouTube image video duration").selectOption("10");
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("relay-composer-draft-v1")!).youtube.imageSeconds)).toBe(10);
  await page.reload();
  await page.getByRole("button", { name: /Create post/ }).first().click();
  composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.getByLabel("YouTube image video duration")).toHaveValue("10");
  await expect(composer.getByPlaceholder("Add a YouTube title")).toHaveValue("Launch images");
  await composer.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(composer).toBeHidden();
  const row = page.locator(".post-row").filter({ hasText: "YouTube image conversion" });
  await row.getByRole("button", { name: "Post actions" }).click();
  await row.getByRole("menuitem", { name: "Edit post", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "Edit post" });
  await expect(edit.getByLabel("YouTube image video duration")).toHaveValue("10");
  await expect(edit.locator(".preview-media img")).toHaveAttribute("src", slides[0]);
  await edit.getByRole("button", { name: "Save draft", exact: true }).click();
  await row.getByRole("button", { name: "Post actions" }).click();
  await row.getByRole("menuitem", { name: "Duplicate post", exact: true }).click();
  composer = page.getByRole("dialog", { name: "Create post" });
  await expect(composer.getByLabel("YouTube image video duration")).toHaveValue("10");
  await expect(composer.locator(".preview-media img")).toHaveAttribute("src", slides[0]);
});

test("YouTube carousels preview ordered hard cuts with duration, pause and replay controls", async ({ page }) => {
  const composer = await openImageComposer(page, 3);
  await expect(composer.getByLabel("YouTube seconds per image")).toHaveValue("4");
  await expect(composer.getByText("YouTube will publish this as a slideshow video · 12 seconds")).toBeVisible();
  await composer.getByLabel("YouTube seconds per image").selectOption("3");
  await expect(composer.getByText("YouTube will publish this as a slideshow video · 9 seconds")).toBeVisible();
  await composer.locator(".preview-provider-tabs").getByRole("button", { name: "YouTube", exact: true }).click();
  const preview = composer.getByRole("group", { name: "YouTube slideshow video preview" });
  await expect(preview.locator("img")).toHaveCSS("object-fit", "contain");
  const bounds = (await preview.boundingBox())!;
  expect(bounds.width / bounds.height).toBeCloseTo(9 / 16, 2);
  await page.clock.install();
  await preview.getByRole("button", { name: "Play slideshow preview", exact: true }).click();
  await page.clock.runFor(3_000);
  await expect(preview.locator("img")).toHaveAttribute("src", slides[1]);
  await preview.getByRole("button", { name: "Pause slideshow preview", exact: true }).click();
  const paused = await preview.getByRole("status").textContent();
  await page.clock.runFor(3_000);
  await expect(preview.getByRole("status")).toHaveText(paused!);
  await preview.getByRole("button", { name: "Play slideshow preview", exact: true }).click();
  await page.clock.runFor(6_000);
  await expect(preview.locator("img")).toHaveAttribute("src", slides[2]);
  await preview.getByRole("button", { name: "Replay slideshow preview", exact: true }).click();
  await expect(preview.locator("img")).toHaveAttribute("src", slides[0]);
  await composer.locator(".preview-provider-tabs").getByRole("button", { name: "Instagram", exact: true }).click();
  const carousel = composer.getByRole("group", { name: "Media preview", exact: true });
  await expect(carousel.getByRole("status")).toHaveText("1 / 3");
  await carousel.getByRole("button", { name: "Next slide", exact: true }).click();
  await expect(carousel.locator("img")).toHaveAttribute("src", slides[1]);
});

test("timing that belongs to a single image falls back to four seconds for a carousel", async ({ page }) => {
  const composer = await openImageComposer(page, 3, 10);
  await expect(composer.getByLabel("YouTube seconds per image")).toHaveValue("4");
  await expect(composer.getByText("YouTube will publish this as a slideshow video · 12 seconds")).toBeVisible();
});

test("templates preserve YouTube slideshow timing and retain image media", async ({ page }) => {
  let saved: { mediaType: string; settings: { youtube: { imageSeconds: number } } } | undefined;
  await page.route("**/api/v1/templates", async (route) => {
    saved = route.request().postDataJSON();
    await route.fulfill({ json: { data: { ...saved, id: "saved-slideshow-template" } } });
  });
  const composer = await openImageComposer(page, 3);
  await composer.getByLabel("YouTube seconds per image").selectOption("5");
  await composer.getByRole("button", { name: "Save template", exact: true }).click();
  await expect.poll(() => saved?.settings.youtube.imageSeconds).toBe(5);
  expect(saved?.mediaType).toBe("image");
  await composer.getByLabel("YouTube seconds per image").selectOption("3");
  await composer.getByLabel("Start from template").selectOption("saved-slideshow-template");
  // Applying a branded template clears destination selection; reselect YouTube.
  await composer.locator(".destination-list button").filter({ hasText: "YouTube" }).click();
  await expect(composer.getByLabel("YouTube seconds per image")).toHaveValue("5");
  await expect(composer.getByText("YouTube will publish this as a slideshow video · 15 seconds")).toBeVisible();
  await expect(composer.locator(".composer-media")).toContainText("3 ordered slides ready");
});
